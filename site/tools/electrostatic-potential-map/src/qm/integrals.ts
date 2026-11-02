// McMurchie-Davidson Gaussian integrals for s and p shells (Cartesian p: x, y, z).
// References: McMurchie & Davidson, J. Comput. Phys. 26, 218 (1978); Helgaker, Jorgensen, Olsen, "Molecular Electronic-Structure Theory" ch. 9.
import { boys } from './boys';
import type { Atom, Shell } from './basis';

/** Hermite Gaussian index tables ordered by total degree; used identically for bra, ket and ESP evaluation. */
export const HERM: Array<Array<[number, number, number]>> = [
  [[0, 0, 0]],
  [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]],
  [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [2, 0, 0], [0, 2, 0], [0, 0, 2], [1, 1, 0], [1, 0, 1], [0, 1, 1]],
];
const COMPS: Array<Array<[number, number, number]>> = [[[0, 0, 0]], [[1, 0, 0], [0, 1, 0], [0, 0, 1]]];
const R_STRIDE = 5; // R tensors up to total order 4 are stored as [t][u][v] with stride 5
const R_N = R_STRIDE * R_STRIDE * R_STRIDE;

/** 1D Hermite expansion coefficient E_t^{ij} (Helgaker eq. 9.5.6 and 9.5.7); includes exp(-q Qx^2). */
export function E1(i: number, j: number, t: number, Qx: number, a: number, b: number): number {
  if (t < 0 || t > i + j) return 0;
  const p = a + b;
  const q = (a * b) / p;
  if (i === 0 && j === 0 && t === 0) return Math.exp(-q * Qx * Qx);
  if (j === 0) return (1 / (2 * p)) * E1(i - 1, j, t - 1, Qx, a, b) - ((q * Qx) / a) * E1(i - 1, j, t, Qx, a, b) + (t + 1) * E1(i - 1, j, t + 1, Qx, a, b);
  return (1 / (2 * p)) * E1(i, j - 1, t - 1, Qx, a, b) + ((q * Qx) / b) * E1(i, j - 1, t, Qx, a, b) + (t + 1) * E1(i, j - 1, t + 1, Qx, a, b);
}

const rTmp = new Float64Array((5 + 1) * R_N);
const bTmp = new Float64Array(16);

/** Hermite Coulomb integrals R_{tuv}(alpha, X, Y, Z) for t+u+v <= L into out[(t*5+u)*5+v]. */
export function hermiteR(L: number, alpha: number, X: number, Y: number, Z: number, out: Float64Array): void {
  const T = alpha * (X * X + Y * Y + Z * Z);
  boys(L, T, bTmp);
  const m2a = -2 * alpha;
  let pw = 1;
  for (let n = 0; n <= L; n++) {
    rTmp[n * R_N] = pw * bTmp[n];
    pw *= m2a;
  }
  for (let d = 1; d <= L; d++) {
    for (let n = 0; n <= L - d; n++) {
      const nb = n * R_N;
      const nb1 = (n + 1) * R_N;
      for (let t = 0; t <= d; t++) {
        for (let u = 0; u <= d - t; u++) {
          const v = d - t - u;
          let val: number;
          if (t > 0) val = X * rTmp[nb1 + ((t - 1) * 5 + u) * 5 + v] + (t > 1 ? (t - 1) * rTmp[nb1 + ((t - 2) * 5 + u) * 5 + v] : 0);
          else if (u > 0) val = Y * rTmp[nb1 + (t * 5 + (u - 1)) * 5 + v] + (u > 1 ? (u - 1) * rTmp[nb1 + (t * 5 + (u - 2)) * 5 + v] : 0);
          else val = Z * rTmp[nb1 + (t * 5 + u) * 5 + (v - 1)] + (v > 1 ? (v - 1) * rTmp[nb1 + (t * 5 + u) * 5 + (v - 2)] : 0);
          rTmp[nb + (t * 5 + u) * 5 + v] = val;
        }
      }
    }
  }
  for (let d = 0; d <= L; d++) for (let t = 0; t <= d; t++) for (let u = 0; u <= d - t; u++) {
    const v = d - t - u;
    out[(t * 5 + u) * 5 + v] = rTmp[(t * 5 + u) * 5 + v];
  }
}

/** All primitive pairs of one shell pair with their Hermite expansion coefficients. */
export interface ShellPair {
  a: number; // shell indices (a >= b)
  b: number;
  na: number; // functions in each shell
  nb: number;
  ncomp: number; // na * nb
  L: number; // la + lb
  nh: number; // Hermite functions for L
  nprim: number;
  p: Float64Array; // exponent sum
  P: Float64Array; // 3 per primitive pair
  /** E[(prim * ncomp + comp) * nh + h], comp = ca * nb + cb; includes both contraction coefficients. */
  E: Float64Array;
  /** Schwarz bound sqrt(max (ab|ab)). */
  q: number;
}

export function buildShellPairs(shells: Shell[], primCut = 1e-15): ShellPair[] {
  const pairs: ShellPair[] = [];
  for (let a = 0; a < shells.length; a++) {
    for (let b = 0; b <= a; b++) {
      const A = shells[a];
      const B = shells[b];
      const L = A.l + B.l;
      const herm = HERM[L];
      const nh = herm.length;
      const na = A.size;
      const nb = B.size;
      const ncomp = na * nb;
      const ps: number[] = [];
      const Ps: number[] = [];
      const Es: number[] = [];
      const ABx = A.x - B.x, ABy = A.y - B.y, ABz = A.z - B.z;
      for (let i = 0; i < A.exps.length; i++) {
        for (let j = 0; j < B.exps.length; j++) {
          const ea = A.exps[i];
          const eb = B.exps[j];
          const p = ea + eb;
          const Pc: [number, number, number] = [(ea * A.x + eb * B.x) / p, (ea * A.y + eb * B.y) / p, (ea * A.z + eb * B.z) / p];
          const block = new Float64Array(ncomp * nh);
          const cc = A.coefs[i] * B.coefs[j];
          let mx = 0;
          for (let ca = 0; ca < na; ca++) {
            const [ax, ay, az] = COMPS[A.l][ca];
            for (let cb = 0; cb < nb; cb++) {
              const [bx, by, bz] = COMPS[B.l][cb];
              for (let h = 0; h < nh; h++) {
                const [t, u, v] = herm[h];
                const val = cc * E1(ax, bx, t, ABx, ea, eb) * E1(ay, by, u, ABy, ea, eb) * E1(az, bz, v, ABz, ea, eb);
                block[(ca * nb + cb) * nh + h] = val;
                if (Math.abs(val) > mx) mx = Math.abs(val);
              }
            }
          }
          if (mx < primCut) continue;
          ps.push(p);
          Ps.push(Pc[0], Pc[1], Pc[2]);
          for (let k = 0; k < block.length; k++) Es.push(block[k]);
        }
      }
      pairs.push({ a, b, na, nb, ncomp, L, nh, nprim: ps.length, p: Float64Array.from(ps), P: Float64Array.from(Ps), E: Float64Array.from(Es), q: 0 });
    }
  }
  return pairs;
}

const rBuf = new Float64Array(R_N);
const scratchW = new Float64Array(10 * 9);
const SIGN = HERM.map((h) => Float64Array.from(h.map(([t, u, v]) => ((t + u + v) % 2 === 0 ? 1 : -1))));

/** Contracted electron-repulsion block (ab|cd) into block[(ab * ncd) + cd] (ab = ca*nb+cb, cd = cc*nd+cd). */
export function eriBlock(bra: ShellPair, ket: ShellPair, block: Float64Array): void {
  const nab = bra.ncomp, ncd = ket.ncomp, nhb = bra.nh, nhk = ket.nh;
  const Lt = bra.L + ket.L;
  block.fill(0, 0, nab * ncd);
  const hb = HERM[bra.L], hk = HERM[ket.L], sgn = SIGN[ket.L];
  const twoPi52 = 2 * Math.pow(Math.PI, 2.5);
  for (let bp = 0; bp < bra.nprim; bp++) {
    const p = bra.p[bp];
    const Px = bra.P[bp * 3], Py = bra.P[bp * 3 + 1], Pz = bra.P[bp * 3 + 2];
    const eb = bp * nab * nhb;
    for (let kp = 0; kp < ket.nprim; kp++) {
      const q = ket.p[kp];
      const alpha = (p * q) / (p + q);
      const X = Px - ket.P[kp * 3], Y = Py - ket.P[kp * 3 + 1], Z = Pz - ket.P[kp * 3 + 2];
      const pref = twoPi52 / (p * q * Math.sqrt(p + q));
      const ek = kp * ncd * nhk;
      if (Lt === 0) {
        hermiteR(0, alpha, X, Y, Z, rBuf);
        const f = pref * rBuf[0];
        for (let ab = 0; ab < nab; ab++) {
          const ebv = bra.E[eb + ab] * f;
          for (let cd = 0; cd < ncd; cd++) block[ab * ncd + cd] += ebv * ket.E[ek + cd];
        }
        continue;
      }
      hermiteR(Lt, alpha, X, Y, Z, rBuf);
      for (let h1 = 0; h1 < nhb; h1++) {
        const [t, u, v] = hb[h1];
        // W[cd] = sum_h2 M[h1][h2] * Ek[cd][h2]
        for (let cd = 0; cd < ncd; cd++) {
          let w = 0;
          for (let h2 = 0; h2 < nhk; h2++) {
            const [t2, u2, v2] = hk[h2];
            w += sgn[h2] * rBuf[((t + t2) * 5 + (u + u2)) * 5 + (v + v2)] * ket.E[ek + cd * nhk + h2];
          }
          scratchW[cd] = w * pref;
        }
        for (let ab = 0; ab < nab; ab++) {
          const e = bra.E[eb + ab * nhb + h1];
          if (e === 0) continue;
          for (let cd = 0; cd < ncd; cd++) block[ab * ncd + cd] += e * scratchW[cd];
        }
      }
    }
  }
}

export const triIndex = (i: number, j: number) => (i >= j ? (i * (i + 1)) / 2 + j : (j * (j + 1)) / 2 + i);
export const eriSize = (nbf: number) => {
  const np = (nbf * (nbf + 1)) / 2;
  return (np * (np + 1)) / 2;
};

export interface EriOptions { schwarz?: number; onProgress?: (fraction: number) => void; signal?: AbortSignal }

/** Packed unique two-electron integrals (ij|kl), index = tri(tri(i,j), tri(k,l)). */
export function computeERI(shells: Shell[], pairs: ShellPair[], nbf: number, opts: EriOptions = {}): Float64Array {
  const thresh = opts.schwarz ?? 1e-11;
  const eri = new Float64Array(eriSize(nbf));
  const block = new Float64Array(81);
  // Schwarz estimates from the diagonal quartets
  for (const pr of pairs) {
    eriBlock(pr, pr, block);
    let m = 0;
    for (let ab = 0; ab < pr.ncomp; ab++) m = Math.max(m, Math.abs(block[ab * pr.ncomp + ab]));
    pr.q = Math.sqrt(m);
  }
  const total = (pairs.length * (pairs.length + 1)) / 2;
  let done = 0;
  for (let ip = 0; ip < pairs.length; ip++) {
    const bra = pairs[ip];
    if (opts.signal?.aborted) throw new Error('Cancelled');
    const A = shells[bra.a], B = shells[bra.b];
    for (let jp = 0; jp <= ip; jp++) {
      done++;
      const ket = pairs[jp];
      if (bra.q * ket.q < thresh) continue;
      eriBlock(bra, ket, block);
      const C = shells[ket.a], D = shells[ket.b];
      for (let ca = 0; ca < bra.na; ca++) {
        const mu = A.first + ca;
        for (let cb = 0; cb < bra.nb; cb++) {
          const nu = B.first + cb;
          const ab = ca * bra.nb + cb;
          const ij = triIndex(mu, nu);
          for (let cc = 0; cc < ket.na; cc++) {
            const la = C.first + cc;
            for (let cd = 0; cd < ket.nb; cd++) {
              const si = D.first + cd;
              const kl = triIndex(la, si);
              eri[ij >= kl ? (ij * (ij + 1)) / 2 + kl : (kl * (kl + 1)) / 2 + ij] = block[ab * ket.ncomp + cc * ket.nb + cd];
            }
          }
        }
      }
    }
    opts.onProgress?.(done / total);
  }
  return eri;
}

// ---- one-electron integrals ----------------------------------------------------------------------
export interface OneElectron { S: Float64Array; T: Float64Array; V: Float64Array }

function forEachPrimPair(shells: Shell[], fn: (A: Shell, B: Shell, ia: number, ib: number, a: number, b: number, ci: number, cj: number) => void) {
  for (let sa = 0; sa < shells.length; sa++)
    for (let sb = 0; sb <= sa; sb++) {
      const A = shells[sa], B = shells[sb];
      for (let i = 0; i < A.exps.length; i++)
        for (let j = 0; j < B.exps.length; j++) fn(A, B, sa, sb, A.exps[i], B.exps[j], A.coefs[i], B.coefs[j]);
    }
}

/** Overlap, kinetic and nuclear-attraction matrices (full symmetric, row-major nbf x nbf). */
export function oneElectron(shells: Shell[], atoms: Atom[], nbf: number): OneElectron {
  const S = new Float64Array(nbf * nbf), T = new Float64Array(nbf * nbf), V = new Float64Array(nbf * nbf);
  forEachPrimPair(shells, (A, B, sa, sb, a, b, ca0, cb0) => {
    const p = a + b;
    const cc = ca0 * cb0;
    const Pc = [(a * A.x + b * B.x) / p, (a * A.y + b * B.y) / p, (a * A.z + b * B.z) / p];
    const Q = [A.x - B.x, A.y - B.y, A.z - B.z];
    const sq = Math.sqrt(Math.PI / p);
    const L = A.l + B.l;
    const herm = HERM[L];
    // R tensors for every nucleus
    const Rn = atoms.map((at) => {
      const out = new Float64Array(R_N);
      hermiteR(L, p, Pc[0] - at.x, Pc[1] - at.y, Pc[2] - at.z3, out);
      return out;
    });
    for (let ia = 0; ia < A.size; ia++) {
      const la = COMPS[A.l][ia];
      for (let ib = 0; ib < B.size; ib++) {
        const lb = COMPS[B.l][ib];
        // 1D overlaps and kinetic pieces
        const s1 = [0, 1, 2].map((d) => E1(la[d], lb[d], 0, Q[d], a, b) * sq);
        const sj2 = [0, 1, 2].map((d) => E1(la[d], lb[d] + 2, 0, Q[d], a, b) * sq);
        const sjm = [0, 1, 2].map((d) => (lb[d] >= 2 ? E1(la[d], lb[d] - 2, 0, Q[d], a, b) * sq : 0));
        const t1 = [0, 1, 2].map((d) => -2 * b * b * sj2[d] + b * (2 * lb[d] + 1) * s1[d] - 0.5 * lb[d] * (lb[d] - 1) * sjm[d]);
        const s = s1[0] * s1[1] * s1[2];
        const t = t1[0] * s1[1] * s1[2] + s1[0] * t1[1] * s1[2] + s1[0] * s1[1] * t1[2];
        // nuclear attraction
        let v = 0;
        for (let h = 0; h < herm.length; h++) {
          const [tt, uu, vv] = herm[h];
          const e = E1(la[0], lb[0], tt, Q[0], a, b) * E1(la[1], lb[1], uu, Q[1], a, b) * E1(la[2], lb[2], vv, Q[2], a, b);
          let rsum = 0;
          for (let n = 0; n < atoms.length; n++) rsum -= atoms[n].z * Rn[n][(tt * 5 + uu) * 5 + vv];
          v += e * rsum;
        }
        v *= (2 * Math.PI) / p;
        const mu = A.first + ia, nu = B.first + ib;
        // same-shell pairs visit both (mu,nu) and (nu,mu): write one entry each; distinct shells write both
        S[mu * nbf + nu] += cc * s; T[mu * nbf + nu] += cc * t; V[mu * nbf + nu] += cc * v;
        if (sa !== sb) { S[nu * nbf + mu] += cc * s; T[nu * nbf + mu] += cc * t; V[nu * nbf + mu] += cc * v; }
      }
    }
  });
  return { S, T, V };
}

/** Dipole (x,y,z) and second-moment (xx,yy,zz,xy,xz,yz) matrices about `origin` (bohr). Returns 9 matrices. */
export function multipoleMatrices(shells: Shell[], nbf: number, origin: [number, number, number]): Float64Array[] {
  const mats = Array.from({ length: 9 }, () => new Float64Array(nbf * nbf));
  forEachPrimPair(shells, (A, B, sa, sb, a, b, ca0, cb0) => {
    const p = a + b;
    const cc = ca0 * cb0;
    const Pc = [(a * A.x + b * B.x) / p, (a * A.y + b * B.y) / p, (a * A.z + b * B.z) / p];
    const Q = [A.x - B.x, A.y - B.y, A.z - B.z];
    const sq = Math.sqrt(Math.PI / p);
    for (let ia = 0; ia < A.size; ia++) {
      const la = COMPS[A.l][ia];
      for (let ib = 0; ib < B.size; ib++) {
        const lb = COMPS[B.l][ib];
        const m0 = [0, 0, 0], m1 = [0, 0, 0], m2 = [0, 0, 0];
        for (let d = 0; d < 3; d++) {
          const e0 = E1(la[d], lb[d], 0, Q[d], a, b), e1 = E1(la[d], lb[d], 1, Q[d], a, b), e2 = E1(la[d], lb[d], 2, Q[d], a, b);
          const pc = Pc[d] - origin[d];
          m0[d] = e0 * sq;
          m1[d] = (e1 + pc * e0) * sq;
          m2[d] = (2 * e2 + 2 * pc * e1 + (pc * pc + 1 / (2 * p)) * e0) * sq;
        }
        const vals = [
          m1[0] * m0[1] * m0[2], m0[0] * m1[1] * m0[2], m0[0] * m0[1] * m1[2],
          m2[0] * m0[1] * m0[2], m0[0] * m2[1] * m0[2], m0[0] * m0[1] * m2[2],
          m1[0] * m1[1] * m0[2], m1[0] * m0[1] * m1[2], m0[0] * m1[1] * m1[2],
        ];
        const mu = A.first + ia, nu = B.first + ib;
        for (let k = 0; k < 9; k++) {
          mats[k][mu * nbf + nu] += cc * vals[k];
          if (sa !== sb) mats[k][nu * nbf + mu] += cc * vals[k];
        }
      }
    }
  });
  return mats;
}
