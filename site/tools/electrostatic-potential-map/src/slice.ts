// Pure helpers for the 2D slice figure: marching-squares contours, nice axis ticks, and the SVG document.
import { colorAt, type ColormapName } from './surface/colormap';
import { cpkColor } from './chem';
import { niceNumber } from './units';

/** Contour segments of f (row-major j*nu+i, i along u, j along v) at one level, in grid coordinates. */
export function contourSegments(f: Float32Array, nu: number, nv: number, level: number): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  const at = (i: number, j: number) => f[j * nu + i];
  for (let j = 0; j < nv - 1; j++) {
    for (let i = 0; i < nu - 1; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d))) continue;
      const pts: Array<[number, number, number]> = []; // x, y, edge id (0 bottom, 1 right, 2 top, 3 left)
      const cross = (v0: number, v1: number) => (v0 > level) !== (v1 > level);
      const t = (v0: number, v1: number) => (level - v0) / (v1 - v0);
      if (cross(a, b)) pts.push([i + t(a, b), j, 0]);
      if (cross(b, c)) pts.push([i + 1, j + t(b, c), 1]);
      if (cross(d, c)) pts.push([i + t(d, c), j + 1, 2]);
      if (cross(a, d)) pts.push([i, j + t(a, d), 3]);
      if (pts.length === 2) out.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]]);
      else if (pts.length === 4) {
        const byId = (id: number) => pts.find((p) => p[2] === id)!;
        if (a > level) { out.push([byId(0)[0], byId(0)[1], byId(3)[0], byId(3)[1]], [byId(1)[0], byId(1)[1], byId(2)[0], byId(2)[1]]); }
        else { out.push([byId(0)[0], byId(0)[1], byId(1)[0], byId(1)[1]], [byId(2)[0], byId(2)[1], byId(3)[0], byId(3)[1]]); }
      }
    }
  }
  return out;
}

export function niceTicks(lo: number, hi: number, target = 6): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  const step = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

export interface SliceSvgInput {
  imageHref: string;
  nu: number; nv: number;
  data: Float32Array;
  uMin: number; uMax: number; vMin: number; vMax: number;
  uLabel: string; vLabel: string;
  lo: number; hi: number;
  colormap: ColormapName; reverse: boolean;
  /** data are already in display units; this is only for the colour bar title */
  unitLabel: string; propertyLabel: string;
  contourStep: number;
  atoms: Array<{ u: number; v: number; d: number; z: number; label: string }>;
  title?: string;
  /** ignore atoms further from the plane than this (Angstrom) when drawing solid; fainter beyond */
  near?: number;
}

export const sliceLayout = (hasTitle: boolean) => {
  const W = 760, H = 640, ml = 64, mr = 112, mt = hasTitle ? 44 : 20, mb = 58;
  return { W, H, ml, mr, mt, mb, pw: W - ml - mr, ph: H - mt - mb };
};

/** Self-contained SVG: raster heatmap, vector contours, atoms, axes with ticks, colour bar. */
export function buildSliceSvg(p: SliceSvgInput): string {
  const { W, H, ml, mr, mt, mb, pw, ph } = sliceLayout(!!p.title);
  void mb;
  const sx = (u: number) => ml + ((u - p.uMin) / (p.uMax - p.uMin)) * pw;
  const sy = (v: number) => mt + ph - ((v - p.vMin) / (p.vMax - p.vMin)) * ph;
  const gx = (i: number) => ml + (i / (p.nu - 1)) * pw;
  const gy = (j: number) => mt + ph - (j / (p.nv - 1)) * ph;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Source Sans 3, Segoe UI, Helvetica, Arial, sans-serif" font-size="13">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  if (p.title) parts.push(`<text x="${ml}" y="26" font-size="16" font-weight="600" fill="#15171a">${esc(p.title)}</text>`);
  parts.push(`<image href="${p.imageHref}" x="${ml}" y="${mt}" width="${pw}" height="${ph}" preserveAspectRatio="none"/>`);
  // contours
  if (p.contourStep > 0) {
    const levels: number[] = [];
    for (let l = p.contourStep; l <= Math.max(Math.abs(p.lo), Math.abs(p.hi)) + 1e-9; l += p.contourStep) { if (l <= p.hi + 1e-9) levels.push(l); if (-l >= p.lo - 1e-9) levels.push(-l); }
    levels.push(0);
    for (const level of levels) {
      const segs = contourSegments(p.data, p.nu, p.nv, level);
      if (!segs.length) continue;
      const d = segs.map(([x1, y1, x2, y2]) => `M${gx(x1).toFixed(1)} ${gy(y1).toFixed(1)}L${gx(x2).toFixed(1)} ${gy(y2).toFixed(1)}`).join('');
      parts.push(`<path d="${d}" fill="none" stroke="${level === 0 ? '#000000' : '#333333'}" stroke-opacity="${level === 0 ? 0.9 : 0.45}" stroke-width="${level === 0 ? 1.4 : 0.8}"${level < 0 ? ' stroke-dasharray="4 3"' : ''}/>`);
    }
  }
  parts.push(`<rect x="${ml}" y="${mt}" width="${pw}" height="${ph}" fill="none" stroke="#15171a" stroke-width="1"/>`);
  // atoms
  const near = p.near ?? 0.6;
  const pxPerA = pw / (p.uMax - p.uMin);
  for (const a of p.atoms) {
    if (a.u < p.uMin || a.u > p.uMax || a.v < p.vMin || a.v > p.vMax) continue;
    const onPlane = Math.abs(a.d) <= near;
    const r = Math.max(3, (a.z === 1 ? 0.25 : 0.4) * pxPerA);
    parts.push(`<circle cx="${sx(a.u).toFixed(1)}" cy="${sy(a.v).toFixed(1)}" r="${r.toFixed(1)}" fill="${onPlane ? cpkColor(a.z) : 'none'}" fill-opacity="0.95" stroke="#15171a" stroke-width="${onPlane ? 1 : 0.7}" stroke-opacity="${onPlane ? 1 : 0.45}"${onPlane ? '' : ' stroke-dasharray="2 2"'}/>`);
    if (onPlane && a.z !== 1) parts.push(`<text x="${sx(a.u).toFixed(1)}" y="${(sy(a.v) + 4).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="600" fill="#15171a">${esc(a.label)}</text>`);
  }
  // axes
  for (const t of niceTicks(p.uMin, p.uMax)) { const x = sx(t); parts.push(`<line x1="${x}" y1="${mt + ph}" x2="${x}" y2="${mt + ph + 5}" stroke="#15171a"/><text x="${x}" y="${mt + ph + 20}" text-anchor="middle" fill="#15171a">${niceNumber(t)}</text>`); }
  for (const t of niceTicks(p.vMin, p.vMax)) { const y = sy(t); parts.push(`<line x1="${ml - 5}" y1="${y}" x2="${ml}" y2="${y}" stroke="#15171a"/><text x="${ml - 9}" y="${y + 4}" text-anchor="end" fill="#15171a">${niceNumber(t)}</text>`); }
  parts.push(`<text x="${ml + pw / 2}" y="${H - 14}" text-anchor="middle" fill="#15171a">${esc(p.uLabel)}</text>`);
  parts.push(`<text transform="translate(16 ${mt + ph / 2}) rotate(-90)" text-anchor="middle" fill="#15171a">${esc(p.vLabel)}</text>`);
  // colour bar
  const bx = W - mr + 28, by = mt, bh = ph, bw = 14;
  const stops = Array.from({ length: 24 }, (_, k) => { const t = k / 23; const c = colorAt(p.colormap, t, p.reverse); return `<stop offset="${(1 - t) * 100}%" stop-color="rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})"/>`; });
  parts.push(`<defs><linearGradient id="cb" x1="0" y1="0" x2="0" y2="1">${stops.reverse().join('')}</linearGradient></defs>`);
  parts.push(`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="url(#cb)" stroke="#15171a"/>`);
  const cbTicks = niceTicks(p.lo, p.hi, 5);
  for (const t of cbTicks) { const y = by + bh - ((t - p.lo) / (p.hi - p.lo)) * bh; parts.push(`<line x1="${bx + bw}" y1="${y}" x2="${bx + bw + 4}" y2="${y}" stroke="#15171a"/><text x="${bx + bw + 8}" y="${y + 4}" fill="#15171a">${niceNumber(t)}</text>`); }
  parts.push(`<text transform="translate(${bx + bw + 62} ${by + bh / 2}) rotate(90)" text-anchor="middle" fill="#4a4f57" font-size="12">${esc(p.propertyLabel)} (${esc(p.unitLabel)})</text>`);
  parts.push('</svg>');
  return parts.join('');
}
