import { describe, it, expect } from 'vitest';
import { contourSegments, niceTicks, buildSliceSvg } from '../src/slice';

describe('slice helpers', () => {
  it('contours a radial field into a closed ring of the right radius', () => {
    const n = 61, f = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) f[j * n + i] = Math.hypot(i - 30, j - 30);
    const segs = contourSegments(f, n, n, 10);
    expect(segs.length).toBeGreaterThan(40);
    for (const [x1, y1, x2, y2] of segs) {
      expect(Math.hypot(x1 - 30, y1 - 30)).toBeCloseTo(10, 0);
      expect(Math.hypot(x2 - 30, y2 - 30)).toBeCloseTo(10, 0);
    }
    expect(contourSegments(f, n, n, 1000)).toHaveLength(0);
  });
  it('picks readable ticks', () => {
    const t = niceTicks(-4.2, 4.1);
    expect(t).toContain(0);
    expect(t.length).toBeGreaterThanOrEqual(4);
    expect(t.length).toBeLessThanOrEqual(10);
    const steps = t.slice(1).map((v, i) => +(v - t[i]).toFixed(9));
    expect(new Set(steps).size).toBe(1);
    expect(t[0]).toBeGreaterThanOrEqual(-4.2);
    expect(t[t.length - 1]).toBeLessThanOrEqual(4.1);
    expect(niceTicks(0, 1)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(3, 3)).toEqual([3]);
  });
  it('builds a standalone SVG with image, contours, atoms, ticks and colour bar', () => {
    const n = 20, f = Float32Array.from({ length: n * n }, (_, k) => Math.sin(k / 9));
    const svg = buildSliceSvg({ imageHref: 'data:image/png;base64,AAAA', nu: n, nv: n, data: f, uMin: -4, uMax: 4, vMin: -4, vMax: 4, uLabel: 'x (Å)', vLabel: 'y (Å)', lo: -1, hi: 1, colormap: 'rwb', reverse: false, unitLabel: 'kcal/mol', propertyLabel: 'ESP', contourStep: 0.5, atoms: [{ u: 0, v: 0, d: 0, z: 6, label: 'C' }, { u: 1, v: 1, d: 2, z: 1, label: 'H' }], title: 'Test' });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('<image');
    expect(svg).toContain('<path');
    expect(svg).toContain('linearGradient');
    expect(svg).toContain('>C</text>');
    expect(svg).toContain('Test');
    expect(svg.endsWith('</svg>')).toBe(true);
  });
});
