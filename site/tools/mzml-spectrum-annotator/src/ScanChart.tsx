import { useEffect, useRef, useState } from 'preact/hooks';
import type { SpectrumMeta } from '@/lib/ms/mzml';

interface Props {
  spectra: SpectrumMeta[];
  /** indices currently averaged / shown */
  active: Set<number>;
  msLevel: number | 'all';
  onPick: (indices: number[]) => void;
  height?: number;
  /** Extracted-ion chromatograms: spectrum index → intensity, one map per target (drawn as lines). */
  xic?: Array<{ label: string; values: Map<number, number> }>;
}

/** Scan strip: TIC (or base peak) of every scan against RT (or scan order). Click = one scan; drag = range. */
export function ScanChart({ spectra, active, msLevel, onPick, height = 120, xic }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [W, setW] = useState(800);
  const [drag, setDrag] = useState<[number, number] | null>(null);
  const shown = spectra.filter((s) => msLevel === 'all' || s.msLevel === msLevel);
  const useRt = shown.some((s) => s.rt != null) && new Set(shown.map((s) => s.rt)).size > 1;
  const xs = shown.map((s, i) => (useRt ? s.rt ?? i : i));
  const ys = shown.map((s) => s.tic ?? s.basePeakIntensity ?? s.points);
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || 1, yMax = Math.max(1, ...ys);
  const L = 46, R = 10, T = 8, B = 22;
  const X = (v: number) => L + ((v - x0) / (x1 - x0 || 1)) * (W - L - R);
  const invX = (px: number) => x0 + ((px - L) / (W - L - R)) * (x1 - x0 || 1);

  useEffect(() => {
    const ro = new ResizeObserver(() => wrap.current && setW(Math.max(300, wrap.current.clientWidth)));
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const c = cv.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = W * dpr; c.height = height * dpr;
    const ctx = c.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const col = (n: string, f: string) => css.getPropertyValue(n).trim() || f;
    ctx.clearRect(0, 0, W, height);
    ctx.strokeStyle = col('--fg-muted', '#666'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L, height - B + 0.5); ctx.lineTo(W - R, height - B + 0.5); ctx.stroke();
    ctx.fillStyle = col('--fg-muted', '#666'); ctx.font = `10px ${col('--font-sans', 'sans-serif')}`; ctx.textAlign = 'center';
    for (let k = 0; k <= 5; k++) { const v = x0 + ((x1 - x0) * k) / 5; ctx.fillText(useRt ? v.toFixed(2) : String(Math.round(v)), X(v), height - 8); }
    ctx.textAlign = 'left'; ctx.fillText(useRt ? 'RT (min)' : 'scan order', W - R - 52, height - B - 4);
    shown.forEach((s, i) => {
      const px = Math.round(X(xs[i])) + 0.5, h = (ys[i] / yMax) * (height - T - B);
      ctx.strokeStyle = active.has(s.index) ? col('--accent', '#8b2635') : s.msLevel === 1 ? col('--fg-faint', '#aaa') : col('--ion-b', '#0072b2');
      ctx.globalAlpha = active.has(s.index) ? 1 : 0.55;
      ctx.beginPath(); ctx.moveTo(px, height - B); ctx.lineTo(px, height - B - Math.max(1, h)); ctx.stroke();
    });
    ctx.globalAlpha = 1;
    // XIC overlays, each scaled to its own maximum
    const xicCols = [col('--ion-y', '#d55e00'), col('--ion-a', '#009e73'), col('--ion-x', '#cc79a7'), col('--ion-z', '#e69f00')];
    (xic ?? []).forEach((tr, ti) => {
      const pts = shown.map((s, i) => [X(xs[i]), tr.values.get(s.index) ?? 0] as [number, number]);
      const mx = Math.max(1e-9, ...pts.map((p) => p[1]));
      ctx.strokeStyle = xicCols[ti % xicCols.length]; ctx.lineWidth = 1.5; ctx.beginPath();
      pts.forEach(([px, v], i) => { const y = height - B - (v / mx) * (height - T - B); if (i) ctx.lineTo(px, y); else ctx.moveTo(px, y); });
      ctx.stroke();
      ctx.fillStyle = xicCols[ti % xicCols.length]; ctx.textAlign = 'left'; ctx.fillText(`XIC ${tr.label}`, L + 6 + ti * 110, T + 10);
    });
    if (drag) { ctx.fillStyle = col('--accent-soft', 'rgba(0,0,0,.1)'); ctx.fillRect(Math.min(...drag), T, Math.abs(drag[1] - drag[0]), height - T - B); }
  }, [spectra, active, msLevel, W, drag, xic]);

  const local = (e: MouseEvent) => e.clientX - cv.current!.getBoundingClientRect().left;
  const pickRange = (a: number, b: number) => {
    const lo = invX(Math.min(a, b)), hi = invX(Math.max(a, b));
    const sel = shown.filter((_, i) => xs[i] >= lo && xs[i] <= hi).map((s) => s.index);
    if (sel.length) onPick(sel);
  };
  const nearest = (px: number) => {
    let best = -1, bd = Infinity;
    shown.forEach((_, i) => { const d = Math.abs(X(xs[i]) - px); if (d < bd) { bd = d; best = i; } });
    return best >= 0 && bd < 8 ? shown[best].index : null;
  };
  return (
    <div ref={wrap} class="scan-chart" style={{ height: `${height}px` }}>
      <canvas ref={cv} style={{ width: `${W}px`, height: `${height}px` }} role="img" aria-label="Scans over time; click to view a scan, drag to average a range"
        onMouseDown={(e) => { const x = local(e); setDrag([x, x]); }}
        onMouseMove={(e) => drag && setDrag([drag[0], local(e)])}
        onMouseUp={(e) => { if (!drag) return; const x = local(e); if (Math.abs(x - drag[0]) < 4) { const n = nearest(x); if (n != null) onPick([n]); } else pickRange(drag[0], x); setDrag(null); }}
        onMouseLeave={() => setDrag(null)} />
    </div>
  );
}
