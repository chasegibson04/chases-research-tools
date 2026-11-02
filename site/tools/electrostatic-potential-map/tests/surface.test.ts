import { describe, it, expect } from 'vitest';
import { isoSurface, meshStats } from '../src/surface/marching';
import { colorAt, COLORMAPS, cssGradient, type ColormapName } from '../src/surface/colormap';
import { sampleGridCubic, type GridSpec } from '../src/qm/grid';
import { toCube, toOBJ, toPLY, toXYZ } from '../src/exporters';
import run, { type Input, type Output } from '../src/compute';
import { buildShells } from '../src/qm/basis';
import { EspEvaluator } from '../src/qm/esp';

const sphereGrid = (R: number, h: number): { g: GridSpec; f: Float32Array } => {
  const n = Math.ceil((2 * R + 2) / h) + 1;
  const g: GridSpec = { origin: [-(R + 1), -(R + 1), -(R + 1)], h, n: [n, n, n] };
  const f = new Float32Array(n * n * n);
  let p = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++, p++) f[p] = R * R - ((g.origin[0] + i * h) ** 2 + (g.origin[1] + j * h) ** 2 + (g.origin[2] + k * h) ** 2);
  return { g, f };
};

describe('marching tetrahedra', () => {
  it('reproduces sphere area and volume with outward orientation and unit normals', () => {
    const R = 3;
    const { g, f } = sphereGrid(R, 0.2);
    const m = isoSurface(f, g, 0);
    const s = meshStats(m);
    expect(s.area / (4 * Math.PI * R * R)).toBeGreaterThan(0.99);
    expect(s.area / (4 * Math.PI * R * R)).toBeLessThan(1.01);
    expect(s.volume / ((4 / 3) * Math.PI * R ** 3)).toBeGreaterThan(0.985);
    expect(s.volume).toBeGreaterThan(0); // positive volume means outward-facing triangles
    // normals point away from the centre
    let bad = 0;
    for (let i = 0; i < m.positions.length / 3; i++) {
      const dot = m.positions[i * 3] * m.normals[i * 3] + m.positions[i * 3 + 1] * m.normals[i * 3 + 1] + m.positions[i * 3 + 2] * m.normals[i * 3 + 2];
      if (dot < 0 || Math.abs(Math.hypot(m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]) - 1) > 1e-3) bad++;
    }
    expect(bad).toBe(0);
  });
  it('is closed: every edge is shared by exactly two triangles', () => {
    const { g, f } = sphereGrid(2, 0.25);
    const m = isoSurface(f, g, 0);
    const edges = new Map<string, number>();
    for (let t = 0; t < m.indices.length; t += 3) for (let k = 0; k < 3; k++) {
      const a = m.indices[t + k], b = m.indices[t + ((k + 1) % 3)];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
    expect([...edges.values()].every((c) => c === 2)).toBe(true);
  });
  it('extracts the negative lobe with sign = -1 and returns nothing for an empty level', () => {
    const { g, f } = sphereGrid(2, 0.25);
    const neg = Float32Array.from(f, (v) => -v);
    expect(meshStats(isoSurface(neg, g, 0, -1)).volume).toBeGreaterThan(0);
    expect(isoSurface(f, g, 1e6).indices.length).toBe(0);
  });
});

describe('colormaps and exporters', () => {
  it('every colormap is defined on [0,1], reversible and has a CSS gradient', () => {
    for (const name of Object.keys(COLORMAPS) as ColormapName[]) {
      const a = colorAt(name, 0), b = colorAt(name, 1), mid = colorAt(name, 0.5), rev = colorAt(name, 0, true);
      for (const c of [a, b, mid, rev]) c.forEach((v) => { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(255); });
      expect(rev).toEqual(b);
      expect(cssGradient(name)).toContain('linear-gradient');
    }
    expect(colorAt('rwb', 0)[0]).toBeGreaterThan(colorAt('rwb', 0)[2]); // negative end is red
    expect(colorAt('rwb', 1)[2]).toBeGreaterThan(colorAt('rwb', 1)[0]); // positive end is blue
  });
  it('writes cube, XYZ, OBJ and PLY that read back consistently', () => {
    const { g, f } = sphereGrid(1.5, 0.5);
    const cube = toCube({ ...g, data: f }, [8, 1], [0, 0, 0, 1, 0, 0], 0, 'title', 'q').split('\n');
    expect(cube[2].trim().startsWith('2')).toBe(true);
    expect(parseInt(cube[3].trim().split(/\s+/)[0], 10)).toBe(g.n[0]);
    const dataLines = cube.slice(6 + 2).filter((l) => l.trim());
    expect(dataLines.join(' ').trim().split(/\s+/)).toHaveLength(g.n[0] * g.n[1] * g.n[2]);
    expect(toXYZ([8, 1], [0, 0, 0, 0.96, 0, 0], 'c').split('\n')[0]).toBe('2');
    const m = isoSurface(f, g, 0);
    const colors = new Uint8Array((m.positions.length / 3) * 3).fill(128);
    const obj = toOBJ(m, colors, 'x').split('\n');
    expect(obj.filter((l) => l.startsWith('v ')).length).toBe(m.positions.length / 3);
    expect(obj.filter((l) => l.startsWith('f ')).length).toBe(m.indices.length / 3);
    const ply = toPLY(m, colors);
    const head = new TextDecoder().decode(ply.slice(0, 400));
    expect(head).toContain(`element vertex ${m.positions.length / 3}`);
    expect(head).toContain(`element face ${m.indices.length / 3}`);
  });
});

describe('ESP interpolated from the coarse grid matches the exact potential on the isosurface', () => {
  it('benzene 0.002 e/bohr^3 surface, error < 0.3 kcal/mol (default 0.4 bohr coarse grid)', async () => {
    const o = await run({ source: 'smiles', structure: 'c1ccccc1', basis: '3-21g', gridSpacing: 0.3, espSpacing: 0.4 } as Input, { progress: () => {}, log: () => {}, signal: new AbortController().signal }) as Output;
    const mesh = isoSurface(o.density!.data, o.density!, 0.002);
    expect(mesh.indices.length).toBeGreaterThan(1000);
    const w = o.wave!;
    const atoms = w.z.map((z, i) => ({ z, x: w.bohr[i * 3], y: w.bohr[i * 3 + 1], z3: w.bohr[i * 3 + 2] }));
    const { shells } = buildShells(atoms, w.basis);
    const P = new Float64Array(w.nbf * w.nbf);
    for (let a = 0; a < w.nbf; a++) for (let b = 0; b < w.nbf; b++) { let s = 0; for (let i = 0; i < w.nocc; i++) s += w.C[a * w.nbf + i] * w.C[b * w.nbf + i]; P[a * w.nbf + b] = 2 * s; }
    const ev = new EspEvaluator(shells, atoms, P, w.nbf);
    const nv = mesh.positions.length / 3;
    let worst = 0;
    for (let n = 0; n < 120; n++) {
      const i = Math.floor((n * 7919) % nv);
      const [x, y, z] = [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]];
      const approx = sampleGridCubic(o.esp!.data, o.esp!, x, y, z);
      expect(Number.isFinite(approx)).toBe(true);
      worst = Math.max(worst, Math.abs(approx - ev.at(x, y, z)) * 627.5);
    }
    expect(worst).toBeLessThan(0.3);
  }, 120000);
});
