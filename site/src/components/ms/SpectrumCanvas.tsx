import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { screenPalette, printPalette, type MsPalette } from './palette';
import { downloadSvg, downloadPng } from './exportImage';
import { lowerBound } from '@/lib/ms/match';

export interface SpecPeak { mz: number; intensity: number }
export interface SpecAnnotation { label: string; color: string; dim?: boolean }
export interface SpecLayer { peaks: SpecPeak[]; annotations?: Map<number, SpecAnnotation>; label?: string; highlight?: Set<number> }

interface Props {
  top: SpecLayer;
  mirror?: SpecLayer;
  /** Peak indices in the top layer that are selected (measure mode draws a bracket between the first two). */
  selected?: number[];
  measureLabel?: string;
  markers?: Array<{ mz: number; label: string }>;
  view?: [number, number];
  onView?: (v: [number, number]) => void;
  onHover?: (hit: { layer: 'top' | 'mirror'; index: number } | null) => void;
  onPeakClick?: (hit: { layer: 'top' | 'mirror'; index: number }, e: { shift: boolean; ctrl: boolean }) => void;
  height?: number;
  title?: string;
  filename?: string;
  /** Show labels for unannotated peaks too (m/z values of the strongest peaks). */
  labelUnassigned?: boolean;
}

const M = { l: 58, r: 14, t: 22, b: 38 };

function extent(layers: SpecLayer[]): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const L of layers) for (const p of L.peaks) { if (p.mz < lo) lo = p.mz; if (p.mz > hi) hi = p.mz; }
  if (!Number.isFinite(lo)) return [0, 1000];
  const pad = Math.max(5, (hi - lo) * 0.04);
  return [Math.max(0, lo - pad), hi + pad];
}

function niceTicks(lo: number, hi: number, n = 8): number[] {
  const span = hi - lo; if (span <= 0) return [lo];
  const step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= step0) ?? mag * 10;
  const out: number[] = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

interface Scene {
  W: number; H: number; plotH: number; mirrorTop: number; split: boolean;
  x: (mz: number) => number; inv: (px: number) => number;
  yTop: (rel: number) => number; yBot: (rel: number) => number;
  maxTop: number; maxBot: number; view: [number, number];
}
function makeScene(W: number, H: number, view: [number, number], top: SpecLayer, mirror?: SpecLayer): Scene {
  const split = !!mirror;
  const plotH = H - M.t - M.b;
  const half = split ? plotH / 2 : plotH;
  const [v0, v1] = view;
  const x = (mz: number) => M.l + ((mz - v0) / (v1 - v0)) * (W - M.l - M.r);
  const inv = (px: number) => v0 + ((px - M.l) / (W - M.l - M.r)) * (v1 - v0);
  const maxIn = (L?: SpecLayer) => {
    if (!L) return 1; let m = 0;
    const a = lowerBound(L.peaks.length, (i) => L.peaks[i].mz, v0);
    for (let i = a; i < L.peaks.length && L.peaks[i].mz <= v1; i++) m = Math.max(m, L.peaks[i].intensity);
    return m || 1;
  };
  const maxTop = maxIn(top), maxBot = maxIn(mirror);
  const base = M.t + half;
  return {
    W, H, plotH, mirrorTop: base, split, x, inv, view,
    yTop: (rel) => base - rel * (half - 14), yBot: (rel) => base + rel * (half - 14), maxTop, maxBot,
  };
}

interface Label { x: number; y: number; text: string; color: string; w: number }
function placeLabels(cands: Array<{ x: number; y: number; text: string; color: string; pri: number }>, ctxMeasure: (s: string) => number, below: boolean, bounds: [number, number, number], max = 40): Label[] {
  const placed: Label[] = [];
  const boxes: Array<[number, number, number, number]> = [];
  for (const c of cands.sort((a, b) => b.pri - a.pri)) {
    if (placed.length >= max) break;
    if (!c.text) continue;
    const w = ctxMeasure(c.text) + 4, h = 13;
    for (let k = 0; k < 4; k++) {
      const yy = below ? c.y + 4 + k * h : c.y - 4 - k * h;
      const box: [number, number, number, number] = [c.x - w / 2, below ? yy : yy - h, c.x + w / 2, below ? yy + h : yy];
      if (box[0] < bounds[0] || box[2] > bounds[1]) continue;
      if (!below && box[1] < bounds[2]) continue;
      if (boxes.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) continue;
      boxes.push(box); placed.push({ x: c.x, y: below ? yy + h - 3 : yy - 3, text: c.text, color: c.color, w });
      break;
    }
  }
  return placed;
}

/** Fast interactive stick spectrum (canvas) with optional mirror layer, labels, selection and measurement. */
export function SpectrumCanvas(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [W, setW] = useState(800);
  const H = p.height ?? 320;
  const full = useMemo(() => extent([p.top, ...(p.mirror ? [p.mirror] : [])]), [p.top, p.mirror]);
  const [ownView, setOwnView] = useState<[number, number] | null>(null);
  const view = p.view ?? ownView ?? full;
  const setView = (v: [number, number] | null) => { const nv = v ?? full; if (p.onView) p.onView(nv); else setOwnView(v); };
  const [hover, setHover] = useState<{ layer: 'top' | 'mirror'; index: number; px: number; py: number } | null>(null);
  const [band, setBand] = useState<[number, number] | null>(null);
  const drag = useRef<{ x0: number; v: [number, number]; pan: boolean; moved: boolean } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => { setOwnView(null); }, [full[0], full[1]]);
  useEffect(() => {
    const ro = new ResizeObserver(() => wrap.current && setW(Math.max(320, wrap.current.clientWidth)));
    if (wrap.current) ro.observe(wrap.current);
    const mo = new MutationObserver(() => setTick((t) => t + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, []);

  const scene = useMemo(() => makeScene(W, H, view, p.top, p.mirror), [W, H, view[0], view[1], p.top, p.mirror]);

  // ---- drawing -------------------------------------------------------------------------------
  useEffect(() => {
    const c = cv.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, scene, screenPalette(), p, hover, band);
  }, [scene, p.top, p.mirror, p.selected, p.markers, hover, band, tick, p.labelUnassigned, p.measureLabel]);

  // ---- interaction ---------------------------------------------------------------------------
  const hit = (px: number, py: number): { layer: 'top' | 'mirror'; index: number } | null => {
    const layer: 'top' | 'mirror' = p.mirror && py > scene.mirrorTop ? 'mirror' : 'top';
    const L = layer === 'top' ? p.top : p.mirror!;
    const lo = scene.inv(px - 6), hi = scene.inv(px + 6);
    let best = -1, bestScore = -Infinity;
    for (let i = lowerBound(L.peaks.length, (k) => L.peaks[k].mz, lo); i < L.peaks.length && L.peaks[i].mz <= hi; i++) {
      const s = L.peaks[i].intensity * (L.annotations?.has(i) ? 3 : 1) - Math.abs(scene.x(L.peaks[i].mz) - px) * 1e-9;
      if (s > bestScore) { bestScore = s; best = i; }
    }
    return best >= 0 ? { layer, index: best } : null;
  };
  const local = (e: MouseEvent) => { const r = cv.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const onMove = (e: MouseEvent) => {
    const [px, py] = local(e);
    if (drag.current) {
      const d = drag.current; if (Math.abs(px - d.x0) > 4) d.moved = true;
      if (d.pan) { const span = d.v[1] - d.v[0]; const shift = ((d.x0 - px) / (W - M.l - M.r)) * span; setView([d.v[0] + shift, d.v[1] + shift]); }
      else if (d.moved) setBand([Math.min(d.x0, px), Math.max(d.x0, px)]);
      return;
    }
    const h = hit(px, py);
    setHover(h ? { ...h, px, py } : null);
    p.onHover?.(h);
  };
  const onDown = (e: MouseEvent) => { const [px] = local(e); drag.current = { x0: px, v: view, pan: e.shiftKey || e.button === 1, moved: false }; };
  const onUp = (e: MouseEvent) => {
    const d = drag.current; drag.current = null;
    const [px, py] = local(e);
    if (d && d.moved && !d.pan && band) {
      const a = scene.inv(band[0]), b = scene.inv(band[1]);
      if (b - a > 0.01) setView([a, b]);
      setBand(null); return;
    }
    setBand(null);
    if (d && !d.moved) { const h = hit(px, py); if (h) p.onPeakClick?.(h, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }); }
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const [px] = local(e);
    const c = scene.inv(px), f = e.deltaY > 0 ? 1.25 : 0.8;
    let a = c - (c - view[0]) * f, b = c + (view[1] - c) * f;
    if (b - a > full[1] - full[0]) { a = full[0]; b = full[1]; }
    setView([Math.max(0, a), b]);
  };
  useEffect(() => {
    const c = cv.current; if (!c) return;
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  });

  const exportSvg = () => toSvg(makeScene(W, H, view, p.top, p.mirror), printPalette(screenPalette()), p);
  const tip = hover ? (() => {
    const L = hover.layer === 'top' ? p.top : p.mirror!;
    const pk = L.peaks[hover.index]; const an = L.annotations?.get(hover.index);
    return { pk, an, x: hover.px, y: hover.py };
  })() : null;

  return (
    <div class="spec">
      <div class="fig-bar">
        <strong>{p.title ?? 'Spectrum'}</strong>
        <span class="small muted">m/z {view[0].toFixed(1)}–{view[1].toFixed(1)}</span>
        <span class="spacer" />
        <span class="small faint hide-sm">drag = zoom · shift-drag = pan · wheel · double-click = reset</span>
        <button type="button" class="btn-sm" onClick={() => setView(null)}>Reset</button>
        <button type="button" class="btn-sm" onClick={() => downloadSvg(`${p.filename ?? 'spectrum'}.svg`, exportSvg())}>SVG</button>
        <button type="button" class="btn-sm" onClick={() => downloadPng(`${p.filename ?? 'spectrum'}.png`, exportSvg(), 3)}>PNG</button>
      </div>
      <div ref={wrap} class="spec-wrap" style={{ height: `${H}px` }}>
        <canvas ref={cv} style={{ width: `${W}px`, height: `${H}px` }} role="img" aria-label={p.title ?? 'Mass spectrum'}
          onMouseMove={onMove} onMouseDown={onDown} onMouseUp={onUp} onMouseLeave={() => { setHover(null); p.onHover?.(null); drag.current = null; setBand(null); }}
          onDblClick={() => setView(null)} />
        {tip && (
          <div class="spec-tip" style={{ left: `${Math.min(tip.x + 12, W - 200)}px`, top: `${Math.max(4, tip.y - 54)}px` }}>
            <div><strong>m/z {tip.pk.mz.toFixed(4)}</strong></div>
            <div class="muted">int {tip.pk.intensity.toPrecision(4)}</div>
            {tip.an && <div style={{ color: tip.an.color }}>{tip.an.label}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- rendering shared by canvas and SVG export --------------------------------------------------
type Prim = { t: 'line'; x1: number; y1: number; x2: number; y2: number; c: string; w: number; dash?: boolean } | { t: 'text'; x: number; y: number; s: string; c: string; size: number; anchor: 'start' | 'middle' | 'end'; weight?: number; rot?: number };

function primitives(s: Scene, pal: MsPalette, p: Props, hover?: { layer: string; index: number } | null): Prim[] {
  const out: Prim[] = [];
  const { W, H } = s;
  const x0 = M.l, x1 = W - M.r;
  // axes
  const ticks = niceTicks(s.view[0], s.view[1], Math.max(4, Math.floor((W - 80) / 90)));
  const axisY = s.split ? H - M.b : s.mirrorTop;
  out.push({ t: 'line', x1: x0, y1: axisY, x2: x1, y2: axisY, c: pal.muted, w: 1 });
  if (s.split) out.push({ t: 'line', x1: x0, y1: s.mirrorTop, x2: x1, y2: s.mirrorTop, c: pal.line, w: 1 });
  for (const v of ticks) { const xx = s.x(v); out.push({ t: 'line', x1: xx, y1: axisY, x2: xx, y2: axisY + 4, c: pal.muted, w: 1 }, { t: 'text', x: xx, y: axisY + 16, s: String(+v.toFixed(2)), c: pal.muted, size: 11, anchor: 'middle' }); }
  out.push({ t: 'text', x: (x0 + x1) / 2, y: H - 6, s: 'm/z', c: pal.muted, size: 11, anchor: 'middle' });
  out.push({ t: 'line', x1: x0, y1: M.t, x2: x0, y2: s.split ? H - M.b : s.mirrorTop, c: pal.muted, w: 1 });
  for (const r of [0, 0.25, 0.5, 0.75, 1]) {
    const yy = s.yTop(r); out.push({ t: 'line', x1: x0 - 4, y1: yy, x2: x0, y2: yy, c: pal.muted, w: 1 }, { t: 'text', x: x0 - 7, y: yy + 4, s: `${Math.round(r * 100)}`, c: pal.muted, size: 10, anchor: 'end' });
    if (s.split && r > 0) { const yb = s.yBot(r); out.push({ t: 'line', x1: x0 - 4, y1: yb, x2: x0, y2: yb, c: pal.muted, w: 1 }, { t: 'text', x: x0 - 7, y: yb + 4, s: `${Math.round(r * 100)}`, c: pal.muted, size: 10, anchor: 'end' }); }
  }
  out.push({ t: 'text', x: 14, y: s.split ? (M.t + s.mirrorTop) / 2 : s.mirrorTop / 2 + 8, s: 'Rel. intensity (%)', c: pal.muted, size: 11, anchor: 'middle', rot: -90 });
  if (p.top.label) out.push({ t: 'text', x: x1 - 4, y: M.t + 2, s: p.top.label, c: pal.muted, size: 11, anchor: 'end' });
  if (s.split && p.mirror?.label) out.push({ t: 'text', x: x1 - 4, y: H - M.b - 6, s: p.mirror.label, c: pal.muted, size: 11, anchor: 'end' });

  const layer = (L: SpecLayer, max: number, y: (r: number) => number, which: 'top' | 'mirror') => {
    const a = lowerBound(L.peaks.length, (i) => L.peaks[i].mz, s.view[0]);
    // tallest unannotated peak per pixel column
    const col = new Map<number, number>();
    const ann: number[] = [];
    for (let i = a; i < L.peaks.length && L.peaks[i].mz <= s.view[1]; i++) {
      if (L.annotations?.has(i) || L.highlight?.has(i)) { ann.push(i); continue; }
      const px = Math.round(s.x(L.peaks[i].mz));
      const prev = col.get(px);
      if (prev === undefined || L.peaks[prev].intensity < L.peaks[i].intensity) col.set(px, i);
    }
    const base = y(0);
    for (const i of col.values()) out.push({ t: 'line', x1: s.x(L.peaks[i].mz), y1: base, x2: s.x(L.peaks[i].mz), y2: y(Math.min(1, L.peaks[i].intensity / max)), c: pal.unassigned, w: 1 });
    const cands: Array<{ x: number; y: number; text: string; color: string; pri: number }> = [];
    for (const i of ann) {
      const an = L.annotations?.get(i);
      const hl = L.highlight?.has(i) || (hover && hover.layer === which && hover.index === i);
      const xx = s.x(L.peaks[i].mz), yy = y(Math.min(1, L.peaks[i].intensity / max));
      out.push({ t: 'line', x1: xx, y1: base, x2: xx, y2: yy, c: hl ? pal.accent : an ? (an.dim ? pal.faint : an.color) : pal.accent, w: hl ? 3 : 1.6 });
      if (an) cands.push({ x: xx, y: yy, text: an.label, color: an.dim ? pal.faint : an.color, pri: L.peaks[i].intensity / max + (hl ? 10 : 0) + (an.dim ? -1 : 0) });
    }
    if (p.labelUnassigned && which === 'top') {
      const top = [...col.values()].sort((u, v) => L.peaks[v].intensity - L.peaks[u].intensity).slice(0, 12);
      for (const i of top) cands.push({ x: s.x(L.peaks[i].mz), y: y(Math.min(1, L.peaks[i].intensity / max)), text: L.peaks[i].mz.toFixed(2), color: pal.muted, pri: (L.peaks[i].intensity / max) * 0.5 });
    }
    return cands;
  };
  const measure = (t: string) => t.length * 6.2;
  const topC = layer(p.top, s.maxTop, s.yTop, 'top');
  const maxLabels = Math.max(12, Math.round((x1 - x0) / 22));
  for (const l of placeLabels(topC, measure, false, [x0, x1, 4], maxLabels)) out.push({ t: 'text', x: l.x, y: l.y, s: l.text, c: l.color, size: 11, anchor: 'middle', weight: 600 });
  if (p.mirror) {
    const botC = layer(p.mirror, s.maxBot, s.yBot, 'mirror');
    for (const l of placeLabels(botC, measure, true, [x0, x1, 0], maxLabels)) out.push({ t: 'text', x: l.x, y: l.y, s: l.text, c: l.color, size: 11, anchor: 'middle', weight: 600 });
  }
  for (const mk of p.markers ?? []) {
    if (mk.mz < s.view[0] || mk.mz > s.view[1]) continue;
    const xx = s.x(mk.mz);
    out.push({ t: 'line', x1: xx, y1: M.t, x2: xx, y2: s.split ? H - M.b : s.mirrorTop, c: pal.precursor, w: 1, dash: true }, { t: 'text', x: xx + 3, y: M.t + 10, s: mk.label, c: pal.precursor, size: 10, anchor: 'start' });
  }
  // measurement bracket
  const sel = (p.selected ?? []).filter((i) => p.top.peaks[i]);
  if (sel.length >= 2) {
    const [i, j] = sel.slice(-2).sort((u, v) => p.top.peaks[u].mz - p.top.peaks[v].mz);
    const xa = s.x(p.top.peaks[i].mz), xb = s.x(p.top.peaks[j].mz);
    const ya = Math.min(s.yTop(Math.min(1, p.top.peaks[i].intensity / s.maxTop)), s.yTop(Math.min(1, p.top.peaks[j].intensity / s.maxTop))) - 22;
    const yy = Math.max(M.t + 12, ya);
    out.push({ t: 'line', x1: xa, y1: yy, x2: xb, y2: yy, c: pal.accent, w: 1.5 }, { t: 'line', x1: xa, y1: yy - 4, x2: xa, y2: yy + 4, c: pal.accent, w: 1.5 }, { t: 'line', x1: xb, y1: yy - 4, x2: xb, y2: yy + 4, c: pal.accent, w: 1.5 });
    out.push({ t: 'text', x: (xa + xb) / 2, y: yy - 5, s: p.measureLabel ?? `Δ ${(p.top.peaks[j].mz - p.top.peaks[i].mz).toFixed(4)}`, c: pal.accent, size: 11, anchor: 'middle', weight: 700 });
  }
  for (const i of sel) { const xx = s.x(p.top.peaks[i].mz); out.push({ t: 'line', x1: xx, y1: s.yTop(0), x2: xx, y2: s.yTop(Math.min(1, p.top.peaks[i].intensity / s.maxTop)), c: pal.accent, w: 3 }); }
  return out;
}

function draw(ctx: CanvasRenderingContext2D, s: Scene, pal: MsPalette, p: Props, hover: { layer: string; index: number } | null, band: [number, number] | null) {
  ctx.clearRect(0, 0, s.W, s.H);
  for (const pr of primitives(s, pal, p, hover)) {
    if (pr.t === 'line') {
      ctx.strokeStyle = pr.c; ctx.lineWidth = pr.w; ctx.setLineDash(pr.dash ? [4, 3] : []);
      ctx.beginPath(); ctx.moveTo(Math.round(pr.x1) + 0.5, pr.y1); ctx.lineTo(Math.round(pr.x2) + 0.5, pr.y2); ctx.stroke();
    } else {
      ctx.fillStyle = pr.c; ctx.font = `${pr.weight ?? 400} ${pr.size}px ${pal.font}`; ctx.textAlign = pr.anchor === 'middle' ? 'center' : pr.anchor === 'end' ? 'right' : 'left';
      if (pr.rot) { ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate((pr.rot * Math.PI) / 180); ctx.fillText(pr.s, 0, 0); ctx.restore(); } else ctx.fillText(pr.s, pr.x, pr.y);
    }
  }
  ctx.setLineDash([]);
  if (band) { ctx.fillStyle = pal.band; ctx.fillRect(band[0], M.t, band[1] - band[0], s.H - M.t - M.b); }
}

function toSvg(s: Scene, pal: MsPalette, p: Props): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const body = primitives(s, pal, p, null).map((pr) => pr.t === 'line'
    ? `<line x1="${pr.x1.toFixed(1)}" y1="${pr.y1.toFixed(1)}" x2="${pr.x2.toFixed(1)}" y2="${pr.y2.toFixed(1)}" stroke="${pr.c}" stroke-width="${pr.w}"${pr.dash ? ' stroke-dasharray="4 3"' : ''}/>`
    : `<text x="${pr.x.toFixed(1)}" y="${pr.y.toFixed(1)}" fill="${pr.c}" font-size="${pr.size}" text-anchor="${pr.anchor}"${pr.weight ? ` font-weight="${pr.weight}"` : ''}${pr.rot ? ` transform="rotate(${pr.rot} ${pr.x.toFixed(1)} ${pr.y.toFixed(1)})"` : ''}>${esc(pr.s)}</text>`).join('');
  const title = p.title ? `<text x="${(s.W / 2).toFixed(0)}" y="14" text-anchor="middle" font-size="13" font-weight="600" fill="${pal.fg}">${esc(p.title)}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s.W} ${s.H}" width="${s.W}" height="${s.H}" font-family="${pal.font}"><rect width="100%" height="100%" fill="#ffffff"/>${title}${body}</svg>`;
}
