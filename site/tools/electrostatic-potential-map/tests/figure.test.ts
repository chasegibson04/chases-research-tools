import { describe, it, expect } from 'vitest';
import { buildSurface, DEFAULT_FIGURE, LOOKS, colorsToBytes } from '../src/surface/figure';
import { COLORMAPS } from '../src/surface/colormap';
import type { GridSpec } from '../src/qm/grid';

const grid = (): { g: GridSpec & { data: Float32Array }; esp: GridSpec & { data: Float32Array } } => {
  const R = 3, h = 0.25, n = Math.ceil((2 * R + 4) / h) + 1;
  const base: GridSpec = { origin: [-(R + 2), -(R + 2), -(R + 2)], h, n: [n, n, n] };
  const rho = new Float32Array(n ** 3), v = new Float32Array(n ** 3);
  let p = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++, p++) {
    const x = base.origin[0] + i * h, y = base.origin[1] + j * h, z = base.origin[2] + k * h;
    rho[p] = 0.1 * Math.exp(-(x * x + y * y + z * z) / 4); // gaussian ball
    v[p] = z * 0.01; // potential grows with z: negative below, positive above
  }
  return { g: { ...base, data: rho }, esp: { ...base, data: v } };
};

describe('buildSurface', () => {
  it('colours an ESP surface with a symmetric range, red negative and blue positive', () => {
    const { g, esp } = grid();
    const b = buildSurface(g, esp, undefined, { ...DEFAULT_FIGURE, isovalue: 0.01, units: 'au' });
    expect(b.stats!.vmin).toBeLessThan(0);
    expect(b.stats!.vmax).toBeGreaterThan(0);
    expect(b.stats!.range[0]).toBeCloseTo(-b.stats!.range[1], 8);
    expect(b.stats!.fracPositive).toBeGreaterThan(0.4);
    expect(b.stats!.fracPositive).toBeLessThan(0.6);
    expect(b.stats!.area).toBeGreaterThan(10);
    const bytes = colorsToBytes(b.colors);
    const nv = b.mesh.positions.length / 3;
    let lo = 0, hi = 0;
    for (let i = 0; i < nv; i++) { if (b.mesh.positions[i * 3 + 2] < b.mesh.positions[lo * 3 + 2]) lo = i; if (b.mesh.positions[i * 3 + 2] > b.mesh.positions[hi * 3 + 2]) hi = i; }
    expect(bytes[lo * 3]).toBeGreaterThan(bytes[lo * 3 + 2]); // lowest vertex: red
    expect(bytes[hi * 3 + 2]).toBeGreaterThan(bytes[hi * 3]); // highest vertex: blue
  });
  it('honours a manual range, units and reverse', () => {
    const { g, esp } = grid();
    const a = buildSurface(g, esp, undefined, { ...DEFAULT_FIGURE, isovalue: 0.01, units: 'kcal', rangeMode: 'manual', vmin: -5, vmax: 5 });
    expect(a.stats!.range).toEqual([-5, 5]);
    const au = buildSurface(g, esp, undefined, { ...DEFAULT_FIGURE, isovalue: 0.01, units: 'au' }).stats!.vmax;
    expect(a.stats!.vmax / au).toBeCloseTo(627.5, 0);
    const r = buildSurface(g, esp, undefined, { ...DEFAULT_FIGURE, isovalue: 0.01, units: 'au', reverse: true });
    const nr = buildSurface(g, esp, undefined, { ...DEFAULT_FIGURE, isovalue: 0.01, units: 'au' });
    expect(Array.from(r.colors.slice(0, 3))).not.toEqual(Array.from(nr.colors.slice(0, 3)));
  });
  it('builds two-lobe orbital surfaces and plain surfaces', () => {
    const { g } = grid();
    const n = g.n[0];
    const o2 = new Float32Array(g.data.length); // p-like orbital: positive for z>0, negative for z<0
    let p = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++, p++) o2[p] = (g.origin[2] + k * g.h) * Math.exp(-((g.origin[0] + i * g.h) ** 2 + (g.origin[1] + j * g.h) ** 2 + (g.origin[2] + k * g.h) ** 2) / 4);
    const b = buildSurface(g, undefined, o2, { ...DEFAULT_FIGURE, property: 'orbital', orbitalIso: 0.1 });
    expect(b.mesh.indices.length).toBeGreaterThan(100);
    const total = b.mesh.positions.length / 3;
    const reds = [...Array(total).keys()].filter((i) => b.colors[i * 3] > b.colors[i * 3 + 2]).length;
    expect(reds).toBeGreaterThan(10);
    expect(reds).toBeLessThan(total - 10);
    const plain = buildSurface(g, undefined, undefined, { ...DEFAULT_FIGURE, property: 'plain', isovalue: 0.01 });
    expect(plain.stats!.volume).toBeGreaterThan(1);
  });

  it('custom gradients recolour the surface, and every look names a real colour map', () => {
    const { g, esp } = grid();
    const base = { ...DEFAULT_FIGURE, isovalue: 0.01, units: 'au' as const, colormap: 'custom' as const };
    const a = buildSurface(g, esp, undefined, { ...base, customStops: ['#000000', '#ffffff'] });
    const b = buildSurface(g, esp, undefined, { ...base, customStops: ['#ff0000', '#00ff00'] });
    expect(Array.from(a.colors.slice(0, 12))).not.toEqual(Array.from(b.colors.slice(0, 12)));
    // black-to-white: every vertex is a grey (r = g = b)
    for (let i = 0; i < a.colors.length; i += 3) expect(Math.abs(a.colors[i] - a.colors[i + 2])).toBeLessThan(1e-6);
    for (const l of LOOKS) if (l.patch.colormap) expect(Object.keys(COLORMAPS)).toContain(l.patch.colormap);
    expect(LOOKS.map((l) => l.id)).toContain('slide');
  });
});
