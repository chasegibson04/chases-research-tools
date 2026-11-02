// Restricted closed-shell Hartree-Fock with DIIS (Pulay, Chem. Phys. Lett. 73, 393 (1980)).
import { buildShellPairs, computeERI, oneElectron, triIndex } from './integrals';
import { eigh, matmul, symFunc } from './linalg';
import type { Atom, Shell } from './basis';

export interface ScfOptions {
  charge: number;
  maxIter?: number;
  energyTol?: number;
  errorTol?: number;
  onProgress?: (fraction: number, message: string) => void;
  signal?: AbortSignal;
}

export interface ScfResult {
  nbf: number;
  nocc: number;
  nelec: number;
  energy: number;
  eNuc: number;
  eElec: number;
  /** MO energies ascending (Hartree). */
  eps: Float64Array;
  /** MO coefficients, C[mu * nbf + i] = coefficient of AO mu in MO i. */
  C: Float64Array;
  /** Total (alpha+beta) density matrix, row-major. */
  P: Float64Array;
  S: Float64Array;
  H: Float64Array;
  iterations: number;
  converged: boolean;
  timings: { integrals: number; scf: number };
}

export function nuclearRepulsion(atoms: Atom[]): number {
  let e = 0;
  for (let i = 0; i < atoms.length; i++)
    for (let j = 0; j < i; j++) e += (atoms[i].z * atoms[j].z) / Math.hypot(atoms[i].x - atoms[j].x, atoms[i].y - atoms[j].y, atoms[i].z3 - atoms[j].z3);
  return e;
}

export function buildJK(eri: Float64Array, n: number, P: Float64Array, J: Float64Array, K: Float64Array): void {
  J.fill(0);
  K.fill(0);
  let idx = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      const ij = (i * (i + 1)) / 2 + j;
      const fij = i === j ? 0.5 : 1;
      for (let k = 0; k <= i; k++) {
        const lmax = k === i ? j : k;
        for (let l = 0; l <= lmax; l++) {
          const v0 = eri[idx++];
          if (v0 === 0 || (v0 < 1e-13 && v0 > -1e-13)) continue;
          const kl = (k * (k + 1)) / 2 + l;
          const v = v0 * fij * (k === l ? 0.5 : 1) * (ij === kl ? 0.5 : 1);
          // all 8 index images: J[a][b] += P[c][d] v ; K[a][c] += P[b][d] v
          const Pij = P[i * n + j], Pji = P[j * n + i], Pkl = P[k * n + l], Plk = P[l * n + k];
          J[i * n + j] += Pkl * v; J[j * n + i] += Pkl * v; J[i * n + j] += Plk * v; J[j * n + i] += Plk * v;
          J[k * n + l] += Pij * v; J[l * n + k] += Pij * v; J[k * n + l] += Pji * v; J[l * n + k] += Pji * v;
          K[i * n + k] += P[j * n + l] * v; K[j * n + k] += P[i * n + l] * v; K[i * n + l] += P[j * n + k] * v; K[j * n + l] += P[i * n + k] * v;
          K[k * n + i] += P[l * n + j] * v; K[l * n + i] += P[k * n + j] * v; K[k * n + j] += P[l * n + i] * v; K[l * n + j] += P[k * n + i] * v;
        }
      }
    }
  }
}
void triIndex;

function densityFromC(C: Float64Array, n: number, nocc: number, out: Float64Array) {
  for (let mu = 0; mu < n; mu++)
    for (let nu = 0; nu <= mu; nu++) {
      let s = 0;
      for (let i = 0; i < nocc; i++) s += C[mu * n + i] * C[nu * n + i];
      out[mu * n + nu] = 2 * s;
      out[nu * n + mu] = 2 * s;
    }
}

export function runRHF(shells: Shell[], atoms: Atom[], nbf: number, opts: ScfOptions): ScfResult {
  const t0 = performance.now();
  const nelec = atoms.reduce((s, a) => s + a.z, 0) - opts.charge;
  if (nelec <= 0) throw new Error('No electrons: check the charge.');
  if (nelec % 2 !== 0) throw new Error(`The molecule has an odd number of electrons (${nelec}); this closed-shell (RHF) engine cannot treat radicals or odd-electron ions. Change the charge or the structure.`);
  const nocc = nelec / 2;
  if (nocc > nbf) throw new Error('Basis set too small for this number of electrons.');
  opts.onProgress?.(0.02, 'One-electron integrals');
  const { S, T, V } = oneElectron(shells, atoms, nbf);
  const H = new Float64Array(nbf * nbf);
  for (let i = 0; i < H.length; i++) H[i] = T[i] + V[i];
  const pairs = buildShellPairs(shells);
  opts.onProgress?.(0.05, 'Two-electron integrals');
  const eri = computeERI(shells, pairs, nbf, { signal: opts.signal, onProgress: (f) => opts.onProgress?.(0.05 + 0.4 * f, 'Two-electron integrals') });
  const t1 = performance.now();
  const eNuc = nuclearRepulsion(atoms);
  const X = symFunc(S, nbf, (w) => 1 / Math.sqrt(Math.max(w, 1e-10)));
  const n = nbf;

  const diag = (F: Float64Array) => {
    const Fp = matmul(matmul(X, F, n), X, n);
    const { values, vectors } = eigh(Fp, n);
    const C = matmul(X, vectors, n);
    return { values, C };
  };

  // generalized Wolfsberg-Helmholz guess
  let F = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) F[i * n + j] = i === j ? H[i * n + i] : 0.875 * S[i * n + j] * (H[i * n + i] + H[j * n + j]);
  let { values: eps, C } = diag(F);
  const P = new Float64Array(n * n);
  densityFromC(C, n, nocc, P);

  const J = new Float64Array(n * n), K = new Float64Array(n * n);
  const maxIter = opts.maxIter ?? 120;
  const eTol = opts.energyTol ?? 1e-10, errTol = opts.errorTol ?? 3e-9;
  const Fs: Float64Array[] = [], Es: Float64Array[] = [];
  let eOld = 0, energy = 0, converged = false, iter = 0, eElec = 0;
  for (iter = 1; iter <= maxIter; iter++) {
    if (opts.signal?.aborted) throw new Error('Cancelled');
    buildJK(eri, n, P, J, K);
    for (let i = 0; i < n * n; i++) F[i] = H[i] + J[i] - 0.5 * K[i];
    eElec = 0;
    for (let i = 0; i < n * n; i++) eElec += 0.5 * P[i] * (H[i] + F[i]);
    energy = eElec + eNuc;
    // DIIS error e = X^T (F P S - S P F) X
    const FPS = matmul(matmul(F, P, n), S, n);
    const err = new Float64Array(n * n);
    const SPF = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) SPF[i * n + j] = FPS[j * n + i]; // (FPS)^T = S P F for symmetric matrices
    for (let i = 0; i < n * n; i++) err[i] = FPS[i] - SPF[i];
    const errO = matmul(matmul(X, err, n), X, n);
    let emax = 0;
    for (let i = 0; i < n * n; i++) emax = Math.max(emax, Math.abs(errO[i]));
    opts.onProgress?.(0.45 + 0.5 * Math.min(1, iter / 25), `SCF iteration ${iter}: E = ${energy.toFixed(8)} Eh`);
    if (iter > 1 && Math.abs(energy - eOld) < eTol && emax < errTol) { converged = true; break; }
    eOld = energy;
    Fs.push(F.slice()); Es.push(errO);
    if (Fs.length > 8) { Fs.shift(); Es.shift(); }
    let Fx = F;
    if (Fs.length >= 2) {
      const m = Fs.length;
      const B: number[][] = Array.from({ length: m + 1 }, () => new Array(m + 1).fill(0));
      for (let a = 0; a < m; a++) for (let b = 0; b <= a; b++) {
        let d = 0;
        for (let i = 0; i < n * n; i++) d += Es[a][i] * Es[b][i];
        B[a][b] = d; B[b][a] = d;
      }
      for (let a = 0; a < m; a++) { B[a][m] = -1; B[m][a] = -1; }
      const rhs = new Array(m + 1).fill(0); rhs[m] = -1;
      // scale for conditioning
      const sc = Math.max(...B.slice(0, m).map((r, i) => r[i])) || 1;
      for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) B[a][b] /= sc;
      const c = solve(B, rhs);
      if (c) {
        Fx = new Float64Array(n * n);
        for (let a = 0; a < m; a++) for (let i = 0; i < n * n; i++) Fx[i] += c[a] * Fs[a][i];
      }
    }
    ({ values: eps, C } = diag(Fx));
    densityFromC(C, n, nocc, P);
  }
  // final orbitals from the converged Fock matrix
  if (converged) ({ values: eps, C } = diag(F));
  const t2 = performance.now();
  return { nbf, nocc, nelec, energy, eNuc, eElec, eps, C, P: converged ? (() => { const Pn = new Float64Array(n * n); densityFromC(C, n, nocc, Pn); return Pn; })() : P, S, H, iterations: iter, converged, timings: { integrals: t1 - t0, scf: t2 - t1 } };
}
import { solve } from './linalg';
