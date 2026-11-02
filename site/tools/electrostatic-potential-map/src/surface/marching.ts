// Marching tetrahedra isosurface extraction on a regular grid (every cube split into six tetrahedra around its main
// diagonal, so neighbouring cubes agree on shared faces and the mesh is closed). Indexed, with vertex normals taken from
// the field gradient and consistently outward-facing triangles.
import type { GridSpec } from '../qm/grid';

export interface Mesh {
  /** xyz in bohr */
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

const TETS = [[0, 1, 3, 7], [0, 1, 5, 7], [0, 2, 3, 7], [0, 2, 6, 7], [0, 4, 5, 7], [0, 4, 6, 7]];
const CX = [0, 1, 0, 1, 0, 1, 0, 1], CY = [0, 0, 1, 1, 0, 0, 1, 1], CZ = [0, 0, 0, 0, 1, 1, 1, 1];

/**
 * @param sign +1 extracts {field > iso} (density: inside = high), -1 extracts {field < iso} (the negative orbital lobe).
 */
export function isoSurface(field: Float32Array, g: GridSpec, iso: number, sign: 1 | -1 = 1): Mesh {
  const [nx, ny, nz] = g.n;
  const N = nx * ny * nz;
  const val = (idx: number) => sign * field[idx];
  const level = sign * iso;
  const pos: number[] = [];
  const nrm: number[] = [];
  const tri: number[] = [];
  const edgeMap = new Map<number, number>();
  const gradAt = (i: number, j: number, k: number, out: number[]) => {
    const f = (a: number, b: number, c: number) => val((Math.min(nx - 1, Math.max(0, a)) * ny + Math.min(ny - 1, Math.max(0, b))) * nz + Math.min(nz - 1, Math.max(0, c)));
    out[0] = f(i + 1, j, k) - f(i - 1, j, k);
    out[1] = f(i, j + 1, k) - f(i, j - 1, k);
    out[2] = f(i, j, k + 1) - f(i, j, k - 1);
  };
  const ga = [0, 0, 0], gb = [0, 0, 0];
  const vertex = (n1: number, n2: number): number => {
    const lo = Math.min(n1, n2), hi = Math.max(n1, n2);
    const key = lo * N + hi;
    const hit = edgeMap.get(key);
    if (hit !== undefined) return hit;
    const fa = val(lo), fb = val(hi);
    const t = fb === fa ? 0.5 : (level - fa) / (fb - fa);
    const dec = (n: number) => { const k = n % nz; const j = ((n - k) / nz) % ny; const i = (n - k - j * nz) / (ny * nz); return [i, j, k]; };
    const [ia, ja, ka] = dec(lo), [ib, jb, kb] = dec(hi);
    pos.push(g.origin[0] + (ia + t * (ib - ia)) * g.h, g.origin[1] + (ja + t * (jb - ja)) * g.h, g.origin[2] + (ka + t * (kb - ka)) * g.h);
    gradAt(ia, ja, ka, ga); gradAt(ib, jb, kb, gb);
    let nxv = -((1 - t) * ga[0] + t * gb[0]), nyv = -((1 - t) * ga[1] + t * gb[1]), nzv = -((1 - t) * ga[2] + t * gb[2]);
    const len = Math.hypot(nxv, nyv, nzv) || 1;
    nrm.push(nxv / len, nyv / len, nzv / len);
    const id = pos.length / 3 - 1;
    edgeMap.set(key, id);
    return id;
  };

  const node = new Int32Array(8);
  const f8 = new Float64Array(8);
  for (let i = 0; i < nx - 1; i++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let k = 0; k < nz - 1; k++) {
        let mn = Infinity, mx = -Infinity;
        for (let c = 0; c < 8; c++) {
          const idx = ((i + CX[c]) * ny + (j + CY[c])) * nz + (k + CZ[c]);
          node[c] = idx;
          const v = val(idx);
          f8[c] = v;
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
        if (!(mn <= level && mx > level) || Number.isNaN(mn + mx)) continue;
        for (const t of TETS) {
          const ins: number[] = [], out: number[] = [];
          for (const c of t) (f8[c] > level ? ins : out).push(c);
          if (ins.length === 0 || ins.length === 4) continue;
          if (ins.length === 1) {
            const a = ins[0];
            tri.push(vertex(node[a], node[out[0]]), vertex(node[a], node[out[1]]), vertex(node[a], node[out[2]]));
          } else if (ins.length === 3) {
            const a = out[0];
            tri.push(vertex(node[a], node[ins[0]]), vertex(node[a], node[ins[1]]), vertex(node[a], node[ins[2]]));
          } else {
            const [a, b] = ins, [c, d] = out;
            const ac = vertex(node[a], node[c]), ad = vertex(node[a], node[d]), bd = vertex(node[b], node[d]), bc = vertex(node[b], node[c]);
            tri.push(ac, ad, bd, ac, bd, bc);
          }
        }
      }
    }
  }
  // orient every triangle so its geometric normal agrees with the (outward) gradient normal
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const dot = fx * (nrm[a] + nrm[b] + nrm[c]) + fy * (nrm[a + 1] + nrm[b + 1] + nrm[c + 1]) + fz * (nrm[a + 2] + nrm[b + 2] + nrm[c + 2]);
    if (dot < 0) { const tmp = tri[t + 1]; tri[t + 1] = tri[t + 2]; tri[t + 2] = tmp; }
  }
  return { positions: Float32Array.from(pos), normals: Float32Array.from(nrm), indices: Uint32Array.from(tri) };
}

/** Surface area (bohr^2) and enclosed volume (bohr^3) of a closed, outward-oriented mesh. */
export function meshStats(m: Mesh): { area: number; volume: number } {
  let area = 0, vol = 0;
  const p = m.positions;
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t] * 3, b = m.indices[t + 1] * 3, c = m.indices[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    area += 0.5 * Math.hypot(cx, cy, cz);
    vol += (p[a] * cx + p[a + 1] * cy + p[a + 2] * cz) / 6;
  }
  return { area, volume: vol };
}
