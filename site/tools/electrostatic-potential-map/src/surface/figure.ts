// Figure settings and the surface builder: grids -> isosurface mesh with per-vertex colours and statistics.
import { ANGSTROM_PER_BOHR } from '../chem';
import { UNIT_FACTOR, niceRange, type EspUnit } from '../units';
import { sampleGridCubic, type GridSpec } from '../qm/grid';
import { isoSurface, meshStats, type Mesh } from './marching';
import { colorAt, COLORMAPS, type ColormapName } from './colormap';
import { DEFAULT_VIEWER_STYLE, type ViewerStyle } from './viewer3d';

export type SurfaceProperty = 'esp' | 'orbital' | 'plain';
export interface FigureSettings extends ViewerStyle {
  property: SurfaceProperty;
  isovalue: number;
  orbitalIndex: number;
  orbitalIso: number;
  colormap: ColormapName;
  reverse: boolean;
  rangeMode: 'auto-sym' | 'auto' | 'manual';
  vmin: number;
  vmax: number;
  units: EspUnit;
  posColor: string;
  negColor: string;
  plainColor: string;
  title: string;
  showBar: boolean;
  barPosition: 'right' | 'bottom';
  labels: 'none' | 'element' | 'index' | 'charge';
  exportWidthIn: number;
  exportDpi: number;
  exportAspect: 'screen' | '1:1' | '4:3' | '3:2' | '16:9';
}

export const DEFAULT_FIGURE: FigureSettings = {
  ...DEFAULT_VIEWER_STYLE,
  property: 'esp', isovalue: 0.002, orbitalIndex: -1, orbitalIso: 0.04,
  colormap: 'rwb', reverse: false, rangeMode: 'auto-sym', vmin: -30, vmax: 30, units: 'kcal',
  posColor: '#2f6fed', negColor: '#e5484d', plainColor: '#9aa7b5',
  title: '', showBar: true, barPosition: 'right', labels: 'none',
  exportWidthIn: 6.5, exportDpi: 300, exportAspect: 'screen',
};

export interface SurfaceStats {
  area: number; // Angstrom^2
  volume: number; // Angstrom^3
  vmin: number; vmax: number; // display units
  vminAt: [number, number, number]; vmaxAt: [number, number, number]; // Angstrom
  vavg: number; // area-weighted mean, display units
  fracPositive: number; // fraction of surface area with V > 0
  range: [number, number]; // colour scale in display units
}
export interface BuiltSurface { mesh: Mesh; colors: Float32Array; stats: SurfaceStats | null }

const hexToRgb01 = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

function merge(a: Mesh, b: Mesh): Mesh {
  const off = a.positions.length / 3;
  const idx = new Uint32Array(a.indices.length + b.indices.length);
  idx.set(a.indices); for (let i = 0; i < b.indices.length; i++) idx[a.indices.length + i] = b.indices[i] + off;
  const cat = (x: Float32Array, y: Float32Array) => { const o = new Float32Array(x.length + y.length); o.set(x); o.set(y, x.length); return o; };
  return { positions: cat(a.positions, b.positions), normals: cat(a.normals, b.normals), indices: idx };
}

export function buildSurface(
  density: GridSpec & { data: Float32Array },
  esp: (GridSpec & { data: Float32Array }) | undefined,
  orbital: Float32Array | undefined,
  s: FigureSettings,
): BuiltSurface {
  if (s.property === 'orbital' && orbital) {
    const pos = isoSurface(orbital, density, Math.abs(s.orbitalIso), 1);
    const neg = isoSurface(orbital, density, -Math.abs(s.orbitalIso), -1);
    const mesh = merge(pos, neg);
    const colors = new Float32Array(mesh.positions.length);
    const pc = hexToRgb01(s.posColor), nc = hexToRgb01(s.negColor);
    const np = pos.positions.length / 3;
    for (let i = 0; i < mesh.positions.length / 3; i++) { const c = i < np ? pc : nc; colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2]; }
    return { mesh, colors, stats: null };
  }
  const mesh = isoSurface(density.data, density, s.isovalue, 1);
  const nv = mesh.positions.length / 3;
  const colors = new Float32Array(nv * 3);
  const { area, volume } = meshStats(mesh);
  if (s.property === 'plain' || !esp) {
    const c = hexToRgb01(s.plainColor);
    for (let i = 0; i < nv; i++) { colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2]; }
    return { mesh, colors, stats: { area: area * ANGSTROM_PER_BOHR ** 2, volume: volume * ANGSTROM_PER_BOHR ** 3, vmin: NaN, vmax: NaN, vminAt: [0, 0, 0], vmaxAt: [0, 0, 0], vavg: NaN, fracPositive: NaN, range: [0, 0] } };
  }
  // ESP on the surface
  const f = UNIT_FACTOR[s.units];
  const vals = new Float32Array(nv);
  let vmin = Infinity, vmax = -Infinity, imin = 0, imax = 0;
  for (let i = 0; i < nv; i++) {
    const v = sampleGridCubic(esp.data, esp, mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]) * f;
    vals[i] = v;
    if (v < vmin) { vmin = v; imin = i; }
    if (v > vmax) { vmax = v; imax = i; }
  }
  // area weights for the mean and the positive-area fraction
  const w = new Float64Array(nv);
  const p = mesh.positions;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t] * 3, b = mesh.indices[t + 1] * 3, c = mesh.indices[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const ar = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 3;
    w[mesh.indices[t]] += ar; w[mesh.indices[t + 1]] += ar; w[mesh.indices[t + 2]] += ar;
  }
  let sw = 0, swv = 0, swp = 0;
  for (let i = 0; i < nv; i++) { if (!Number.isFinite(vals[i])) continue; sw += w[i]; swv += w[i] * vals[i]; if (vals[i] > 0) swp += w[i]; }
  // colour range
  let lo = s.vmin, hi = s.vmax;
  if (s.rangeMode !== 'manual') {
    const finite = Float32Array.from(vals.filter((v) => Number.isFinite(v)));
    finite.sort();
    const q = (x: number) => finite[Math.min(finite.length - 1, Math.max(0, Math.floor(x * (finite.length - 1))))] ?? 0;
    if (s.rangeMode === 'auto-sym') { const r = niceRange(Math.max(Math.abs(q(0.02)), Math.abs(q(0.98)))); lo = -r; hi = r; }
    else { lo = q(0.01); hi = q(0.99); if (hi - lo < 1e-9) { lo -= 1; hi += 1; } }
  }
  for (let i = 0; i < nv; i++) {
    const [r, g, b] = colorAt(s.colormap, (vals[i] - lo) / (hi - lo), s.reverse);
    if (!Number.isFinite(vals[i])) { colors[i * 3] = 0.5; colors[i * 3 + 1] = 0.5; colors[i * 3 + 2] = 0.5; continue; }
    colors[i * 3] = r / 255; colors[i * 3 + 1] = g / 255; colors[i * 3 + 2] = b / 255;
  }
  const at = (i: number): [number, number, number] => [p[i * 3] * ANGSTROM_PER_BOHR, p[i * 3 + 1] * ANGSTROM_PER_BOHR, p[i * 3 + 2] * ANGSTROM_PER_BOHR];
  return { mesh, colors, stats: { area: area * ANGSTROM_PER_BOHR ** 2, volume: volume * ANGSTROM_PER_BOHR ** 3, vmin, vmax, vminAt: at(imin), vmaxAt: at(imax), vavg: sw ? swv / sw : NaN, fracPositive: sw ? swp / sw : NaN, range: [lo, hi] } };
}

/** Per-vertex RGB bytes for PLY export, from the float colours. */
export const colorsToBytes = (c: Float32Array) => Uint8Array.from(c, (v) => Math.round(Math.min(1, Math.max(0, v)) * 255));

export function isDiverging(name: ColormapName) { return COLORMAPS[name].diverging; }

// ---- persisted settings --------------------------------------------------------------------------
const KEY = 'crt-esp-figure-settings-v1';
export function loadFigureSettings(): FigureSettings {
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...DEFAULT_FIGURE, ...JSON.parse(raw) }; } catch { /* storage blocked */ }
  return { ...DEFAULT_FIGURE };
}
export function saveFigureSettings(s: FigureSettings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked */ } }
