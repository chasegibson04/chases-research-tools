import { multipoleMatrices } from './integrals';
import { symFunc } from './linalg';
import type { Atom, Shell } from './basis';

/** Net atomic charges from Mulliken (PS diagonal) and Lowdin (S^1/2 P S^1/2 diagonal) population analyses. */
export function populationCharges(shells: Shell[], atoms: Atom[], P: Float64Array, S: Float64Array, nbf: number): { mulliken: Float64Array; lowdin: Float64Array } {
  const mull = new Float64Array(atoms.length), low = new Float64Array(atoms.length);
  const half = symFunc(S, nbf, (w) => Math.sqrt(Math.max(w, 0)));
  const tmp = new Float64Array(nbf * nbf);
  for (let i = 0; i < nbf; i++) for (let j = 0; j < nbf; j++) { let s = 0; for (let k = 0; k < nbf; k++) s += half[i * nbf + k] * P[k * nbf + j]; tmp[i * nbf + j] = s; }
  const atomOf = new Int32Array(nbf);
  for (const sh of shells) for (let k = 0; k < sh.size; k++) atomOf[sh.first + k] = sh.atom;
  for (let mu = 0; mu < nbf; mu++) {
    let ps = 0, ls = 0;
    for (let k = 0; k < nbf; k++) { ps += P[mu * nbf + k] * S[k * nbf + mu]; ls += tmp[mu * nbf + k] * half[k * nbf + mu]; }
    mull[atomOf[mu]] -= ps;
    low[atomOf[mu]] -= ls;
  }
  atoms.forEach((a, i) => { mull[i] += a.z; low[i] += a.z; });
  return { mulliken: mull, lowdin: low };
}

export interface Multipoles {
  /** Dipole (e*bohr) about `origin`. */
  dipole: [number, number, number];
  /** Raw second moments sum q r_a r_b (e*bohr^2) about `origin`. */
  second: number[][];
}

export function multipoles(shells: Shell[], atoms: Atom[], P: Float64Array, nbf: number, origin: [number, number, number]): Multipoles {
  const m = multipoleMatrices(shells, nbf, origin);
  const dot = (M: Float64Array) => { let s = 0; for (let i = 0; i < nbf * nbf; i++) s += P[i] * M[i]; return s; };
  const R = atoms.map((a) => [a.x - origin[0], a.y - origin[1], a.z3 - origin[2]]);
  const dipole = [0, 1, 2].map((k) => atoms.reduce((s, a, i) => s + a.z * R[i][k], 0) - dot(m[k])) as [number, number, number];
  const pairs: Array<[number, number, number]> = [[0, 0, 3], [1, 1, 4], [2, 2, 5], [0, 1, 6], [0, 2, 7], [1, 2, 8]];
  const second = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const [a, b, idx] of pairs) {
    const v = atoms.reduce((s, at, i) => s + at.z * R[i][a] * R[i][b], 0) - dot(m[idx]);
    second[a][b] = v;
    second[b][a] = v;
  }
  return { dipole, second };
}

/** Traceless (Buckingham) quadrupole: Theta_ab = 1/2 (3 Q_ab - delta_ab Tr Q) in e*bohr^2. */
export function tracelessQuadrupole(second: number[][]): number[][] {
  const tr = second[0][0] + second[1][1] + second[2][2];
  return second.map((row, a) => row.map((q, b) => 0.5 * (3 * q - (a === b ? tr : 0))));
}
