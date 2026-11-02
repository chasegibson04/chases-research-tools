// Regular grids, orbital/density evaluation and ESP sampling on them.
import type { Atom, Shell } from './basis';
import { EspEvaluator } from './esp';

export interface GridSpec {
  /** Position of grid point (0,0,0) in bohr. */
  origin: [number, number, number];
  /** Spacing in bohr. */
  h: number;
  n: [number, number, number];
}
export const gridSize = (g: GridSpec) => g.n[0] * g.n[1] * g.n[2];

/** Grid covering all atoms plus `margin` bohr; spacing grows if the point count would exceed maxPoints. */
export function makeGrid(atoms: Atom[], margin: number, h: number, maxPoints = 3_000_000): GridSpec {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const a of atoms) {
    const p = [a.x, a.y, a.z3];
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  }
  let step = h;
  for (;;) {
    const n = [0, 1, 2].map((k) => Math.ceil((hi[k] - lo[k] + 2 * margin) / step) + 1) as [number, number, number];
    if (n[0] * n[1] * n[2] <= maxPoints) return { origin: [lo[0] - margin, lo[1] - margin, lo[2] - margin], h: step, n };
    step *= 1.08;
  }
}

/** Evaluates the occupied orbitals (and chosen virtuals) at arbitrary points. */
export class OrbitalEvaluator {
  readonly ncols: number;
  /** Orbital amplitudes at the last evaluated point (indices 0..ncols-1). */
  readonly psi: Float64Array;
  private rc2: number[];
  private nzIdx: Int32Array;
  private nzVal: Float64Array;
  constructor(private shells: Shell[], private nbf: number, private C: Float64Array, private nocc: number, keep: number[] = []) {
    this.ncols = Math.max(nocc, ...keep.map((k) => k + 1));
    this.psi = new Float64Array(this.ncols);
    this.nzIdx = new Int32Array(nbf);
    this.nzVal = new Float64Array(nbf);
    this.rc2 = shells.map((s) => {
      let r = 0;
      for (let i = 0; i < s.exps.length; i++) r = Math.max(r, Math.log(Math.max(Math.abs(s.coefs[i]) * 20, 1e-300) / 1e-10) / s.exps[i]);
      return r;
    });
  }
  /** Returns the electron density (e/bohr^3) at (x,y,z) in bohr; fills this.psi. */
  eval(x: number, y: number, z: number): number {
    const { shells, nbf, C, psi, nzIdx, nzVal, rc2, ncols, nocc } = this;
    let m = 0;
    for (let s = 0; s < shells.length; s++) {
      const sh = shells[s];
      const dx = x - sh.x, dy = y - sh.y, dz = z - sh.z;
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 > rc2[s]) continue;
      let radial = 0;
      for (let k = 0; k < sh.exps.length; k++) radial += sh.coefs[k] * Math.exp(-sh.exps[k] * r2);
      if (sh.l === 0) { nzIdx[m] = sh.first; nzVal[m++] = radial; }
      else { nzIdx[m] = sh.first; nzVal[m++] = radial * dx; nzIdx[m] = sh.first + 1; nzVal[m++] = radial * dy; nzIdx[m] = sh.first + 2; nzVal[m++] = radial * dz; }
    }
    psi.fill(0);
    for (let q = 0; q < m; q++) {
      const row = nzIdx[q] * nbf, v = nzVal[q];
      for (let i = 0; i < ncols; i++) psi[i] += v * C[row + i];
    }
    let d = 0;
    for (let i = 0; i < nocc; i++) d += psi[i] * psi[i];
    return 2 * d;
  }
}

/** Evaluates occupied orbitals on the grid to get the density, and keeps the orbitals listed in `keep`. */
export function evalDensityGrid(
  shells: Shell[], nbf: number, C: Float64Array, nocc: number, keep: number[], grid: GridSpec,
  opts: { onProgress?: (f: number) => void; signal?: AbortSignal } = {},
): { rho: Float32Array; orbitals: Map<number, Float32Array> } {
  const [nx, ny, nz] = grid.n;
  const total = nx * ny * nz;
  const rho = new Float32Array(total);
  const orbitals = new Map<number, Float32Array>(keep.map((k) => [k, new Float32Array(total)]));
  const ev = new OrbitalEvaluator(shells, nbf, C, nocc, keep);
  const keepArr = keep.map((k) => [k, orbitals.get(k)!] as const);
  let ptr = 0;
  for (let ix = 0; ix < nx; ix++) {
    if (opts.signal?.aborted) throw new Error('Cancelled');
    const x = grid.origin[0] + ix * grid.h;
    for (let iy = 0; iy < ny; iy++) {
      const y = grid.origin[1] + iy * grid.h;
      for (let iz = 0; iz < nz; iz++, ptr++) {
        rho[ptr] = ev.eval(x, y, grid.origin[2] + iz * grid.h);
        for (const [k, arr] of keepArr) arr[ptr] = ev.psi[k];
      }
    }
    opts.onProgress?.((ix + 1) / nx);
  }
  return { rho, orbitals };
}

/**
 * ESP on a (coarse) grid, evaluated only where `mask` is set (everything else NaN).
 * mask: Uint8Array of length gridSize; undefined = everywhere.
 */
export function evalEspGrid(ev: EspEvaluator, grid: GridSpec, mask: Uint8Array | undefined, opts: { onProgress?: (f: number) => void; signal?: AbortSignal } = {}): Float32Array {
  const [nx, ny, nz] = grid.n;
  const out = new Float32Array(nx * ny * nz).fill(NaN);
  let ptr = 0;
  for (let ix = 0; ix < nx; ix++) {
    if (opts.signal?.aborted) throw new Error('Cancelled');
    const x = grid.origin[0] + ix * grid.h;
    for (let iy = 0; iy < ny; iy++) {
      const y = grid.origin[1] + iy * grid.h;
      for (let iz = 0; iz < nz; iz++, ptr++) {
        if (mask && !mask[ptr]) continue;
        out[ptr] = ev.at(x, y, grid.origin[2] + iz * grid.h);
      }
    }
    opts.onProgress?.((ix + 1) / nx);
  }
  return out;
}

/** Mask of points whose density exceeds `min`, dilated by `dilate` cells in every direction (2 for tricubic sampling). */
export function densityMask(rho: Float32Array, grid: GridSpec, min: number, dilate = 2): Uint8Array {
  const [nx, ny, nz] = grid.n;
  const mask = new Uint8Array(rho.length);
  for (let ix = 0; ix < nx; ix++) for (let iy = 0; iy < ny; iy++) for (let iz = 0; iz < nz; iz++) {
    if (rho[(ix * ny + iy) * nz + iz] < min) continue;
    for (let a = Math.max(0, ix - dilate); a <= Math.min(nx - 1, ix + dilate); a++)
      for (let b = Math.max(0, iy - dilate); b <= Math.min(ny - 1, iy + dilate); b++)
        for (let c = Math.max(0, iz - dilate); c <= Math.min(nz - 1, iz + dilate); c++) mask[(a * ny + b) * nz + c] = 1;
  }
  return mask;
}

/** Trilinear sample of a grid field at a point in bohr (NaN outside the grid or next to NaN corners). */
export function sampleGrid(field: Float32Array, g: GridSpec, x: number, y: number, z: number): number {
  const fx = (x - g.origin[0]) / g.h, fy = (y - g.origin[1]) / g.h, fz = (z - g.origin[2]) / g.h;
  const [nx, ny, nz] = g.n;
  if (fx < 0 || fy < 0 || fz < 0 || fx > nx - 1 || fy > ny - 1 || fz > nz - 1) return NaN;
  const i = Math.min(Math.floor(fx), nx - 2), j = Math.min(Math.floor(fy), ny - 2), k = Math.min(Math.floor(fz), nz - 2);
  const tx = fx - i, ty = fy - j, tz = fz - k;
  const at = (a: number, b: number, c: number) => field[((i + a) * ny + (j + b)) * nz + (k + c)];
  const c00 = at(0, 0, 0) * (1 - tx) + at(1, 0, 0) * tx, c10 = at(0, 1, 0) * (1 - tx) + at(1, 1, 0) * tx;
  const c01 = at(0, 0, 1) * (1 - tx) + at(1, 0, 1) * tx, c11 = at(0, 1, 1) * (1 - tx) + at(1, 1, 1) * tx;
  return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
}

const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));

/** Tricubic (Catmull-Rom) sample; falls back to trilinear next to the grid edge or masked (NaN) points. */
export function sampleGridCubic(field: Float32Array, g: GridSpec, x: number, y: number, z: number): number {
  const fx = (x - g.origin[0]) / g.h, fy = (y - g.origin[1]) / g.h, fz = (z - g.origin[2]) / g.h;
  const [nx, ny, nz] = g.n;
  const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
  if (i < 1 || j < 1 || k < 1 || i > nx - 3 || j > ny - 3 || k > nz - 3 || fx < 0 || fy < 0 || fz < 0) return sampleGrid(field, g, x, y, z);
  const tx = fx - i, ty = fy - j, tz = fz - k;
  const col = new Float64Array(4), plane = new Float64Array(4);
  for (let a = 0; a < 4; a++) {
    for (let b = 0; b < 4; b++) {
      const base = ((i - 1 + a) * ny + (j - 1 + b)) * nz + (k - 1);
      const v0 = field[base], v1 = field[base + 1], v2 = field[base + 2], v3 = field[base + 3];
      if (v0 !== v0 || v1 !== v1 || v2 !== v2 || v3 !== v3) return sampleGrid(field, g, x, y, z);
      col[b] = cr(v0, v1, v2, v3, tz);
    }
    plane[a] = cr(col[0], col[1], col[2], col[3], ty);
  }
  return cr(plane[0], plane[1], plane[2], plane[3], tx);
}
