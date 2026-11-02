// Electrostatic potential V(r) = sum_A Z_A/|R_A - r| - sum_{mu nu} P_{mu nu} (mu nu | r), evaluated through the
// Hermite expansion of every primitive pair (McMurchie-Davidson), so a point costs one Boys evaluation per pair.
import { boys } from './boys';
import { buildShellPairs } from './integrals';
import type { Atom, Shell } from './basis';

const TWO_PI = 2 * Math.PI;
const F = new Float64Array(4);

interface Group { n: number; p: Float64Array; X: Float64Array; D: Float64Array; stride: number }

export class EspEvaluator {
  private groups: Group[];
  private atoms: Atom[];
  pairsKept = 0;

  constructor(shells: Shell[], atoms: Atom[], P: Float64Array, nbf: number, cut = 1e-13) {
    this.atoms = atoms;
    const pairs = buildShellPairs(shells);
    const acc = [0, 1, 2].map(() => ({ p: [] as number[], X: [] as number[], D: [] as number[] }));
    for (const pr of pairs) {
      const A = shells[pr.a], B = shells[pr.b];
      const w = pr.a === pr.b ? 1 : 2;
      for (let k = 0; k < pr.nprim; k++) {
        const D = new Float64Array(pr.nh);
        for (let ca = 0; ca < pr.na; ca++)
          for (let cb = 0; cb < pr.nb; cb++) {
            const pmn = P[(A.first + ca) * nbf + (B.first + cb)] * w;
            if (pmn === 0) continue;
            const base = (k * pr.ncomp + ca * pr.nb + cb) * pr.nh;
            for (let h = 0; h < pr.nh; h++) D[h] += pmn * pr.E[base + h];
          }
        let mx = 0;
        for (let h = 0; h < pr.nh; h++) mx = Math.max(mx, Math.abs(D[h]));
        if (mx < cut) continue;
        const g = acc[pr.L];
        g.p.push(pr.p[k]);
        g.X.push(pr.P[k * 3], pr.P[k * 3 + 1], pr.P[k * 3 + 2]);
        for (let h = 0; h < pr.nh; h++) g.D.push(D[h]);
      }
    }
    const strides = [1, 4, 10];
    this.groups = acc.map((g, L) => ({ n: g.p.length, p: Float64Array.from(g.p), X: Float64Array.from(g.X), D: Float64Array.from(g.D), stride: strides[L] }));
    this.pairsKept = this.groups.reduce((s, g) => s + g.n, 0);
  }

  /** Potential in atomic units at (x, y, z) in bohr. Positive = repels a +1 probe charge. */
  at(x: number, y: number, z: number): number {
    let v = 0;
    for (const a of this.atoms) v += a.z / Math.hypot(a.x - x, a.y - y, a.z3 - z);
    let e = 0;
    const [g0, g1, g2] = this.groups;
    for (let i = 0; i < g0.n; i++) {
      const p = g0.p[i];
      const dx = g0.X[i * 3] - x, dy = g0.X[i * 3 + 1] - y, dz = g0.X[i * 3 + 2] - z;
      boys(0, p * (dx * dx + dy * dy + dz * dz), F);
      e += (TWO_PI / p) * g0.D[i] * F[0];
    }
    for (let i = 0; i < g1.n; i++) {
      const p = g1.p[i];
      const dx = g1.X[i * 3] - x, dy = g1.X[i * 3 + 1] - y, dz = g1.X[i * 3 + 2] - z;
      boys(1, p * (dx * dx + dy * dy + dz * dz), F);
      const a = -2 * p * F[1], o = i * 4;
      e += (TWO_PI / p) * (g1.D[o] * F[0] + a * (g1.D[o + 1] * dx + g1.D[o + 2] * dy + g1.D[o + 3] * dz));
    }
    for (let i = 0; i < g2.n; i++) {
      const p = g2.p[i];
      const dx = g2.X[i * 3] - x, dy = g2.X[i * 3 + 1] - y, dz = g2.X[i * 3 + 2] - z;
      boys(2, p * (dx * dx + dy * dy + dz * dz), F);
      const a = -2 * p, a1 = a * F[1], a2 = a * a * F[2], o = i * 10, D = g2.D;
      e += (TWO_PI / p) * (
        D[o] * F[0] + a1 * (D[o + 1] * dx + D[o + 2] * dy + D[o + 3] * dz) +
        D[o + 4] * (a1 + a2 * dx * dx) + D[o + 5] * (a1 + a2 * dy * dy) + D[o + 6] * (a1 + a2 * dz * dz) +
        a2 * (D[o + 7] * dx * dy + D[o + 8] * dx * dz + D[o + 9] * dy * dz));
    }
    return v - e;
  }
}
