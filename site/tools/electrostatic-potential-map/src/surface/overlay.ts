// 2D overlay drawn on top of the 3D view and onto exported PNGs: colour bar, title, atom labels.
import { colorAt, type ColormapName } from './colormap';
import { niceNumber } from '../units';

export interface OverlayState {
  /** background luminance decides text colour */
  dark: boolean;
  /** colour bar; null hides it */
  bar: null | { colormap: ColormapName; reverse: boolean; vmin: number; vmax: number; label: string; position: 'right' | 'bottom'; diverging: boolean };
  title: string;
  labels: Array<{ x: number; y: number; text: string; color: string }>;
  /** extra lines under the title (e.g. method) */
  subtitle?: string;
}

export function drawOverlay(ctx: CanvasRenderingContext2D, W: number, H: number, scale: number, st: OverlayState): void {
  const ink = st.dark ? '#f2f0eb' : '#15171a';
  const faint = st.dark ? 'rgba(242,240,235,0.65)' : 'rgba(21,23,26,0.65)';
  const font = (px: number, weight = 400) => `${weight} ${Math.round(px * scale)}px "Source Sans 3", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif`;
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  if (st.title) {
    ctx.fillStyle = ink;
    ctx.font = font(15, 600);
    ctx.fillText(st.title, 14 * scale, 24 * scale);
    if (st.subtitle) { ctx.fillStyle = faint; ctx.font = font(12); ctx.fillText(st.subtitle, 14 * scale, 42 * scale); }
  }
  for (const l of st.labels) {
    ctx.font = font(12, 600);
    ctx.lineWidth = 3 * scale;
    ctx.strokeStyle = st.dark ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.85)';
    ctx.lineJoin = 'round';
    ctx.strokeText(l.text, l.x * scale, l.y * scale);
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, l.x * scale, l.y * scale);
  }
  const bar = st.bar;
  if (bar) {
    const vertical = bar.position === 'right';
    const len = Math.min(vertical ? H * 0.5 : W * 0.5, 320 * scale), th = 12 * scale;
    const x0 = vertical ? W - 64 * scale : (W - len) / 2, y0 = vertical ? (H - len) / 2 : H - 52 * scale;
    const steps = 64;
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const c = colorAt(bar.colormap, t, bar.reverse);
      ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      if (vertical) ctx.fillRect(x0, y0 + len - ((i + 1) * len) / steps, th, len / steps + 1); // low values at the bottom
      else ctx.fillRect(x0 + (i * len) / steps, y0, len / steps + 1, th);
    }
    ctx.strokeStyle = faint;
    ctx.lineWidth = 1 * scale;
    ctx.strokeRect(x0, y0, vertical ? th : len, vertical ? len : th);
    // ticks: min, (0), max
    const ticks: Array<[number, string]> = [[0, niceNumber(bar.vmin)], [1, niceNumber(bar.vmax)]];
    if (bar.vmin < 0 && bar.vmax > 0) ticks.splice(1, 0, [-bar.vmin / (bar.vmax - bar.vmin), '0']);
    ctx.fillStyle = ink;
    ctx.font = font(11);
    for (const [t, txt] of ticks) {
      if (vertical) {
        const y = y0 + len - t * len;
        ctx.beginPath(); ctx.moveTo(x0 + th, y); ctx.lineTo(x0 + th + 4 * scale, y); ctx.stroke();
        ctx.textAlign = 'left'; ctx.fillText(txt, x0 + th + 7 * scale, y + 4 * scale);
      } else {
        const x = x0 + t * len;
        ctx.beginPath(); ctx.moveTo(x, y0 + th); ctx.lineTo(x, y0 + th + 4 * scale); ctx.stroke();
        ctx.textAlign = 'center'; ctx.fillText(txt, x, y0 + th + 18 * scale);
      }
    }
    ctx.fillStyle = faint;
    ctx.font = font(11);
    if (vertical) { ctx.save(); ctx.translate(x0 - 8 * scale, y0 + len / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(bar.label, 0, 0); ctx.restore(); }
    else { ctx.textAlign = 'center'; ctx.fillText(bar.label, x0 + len / 2, y0 - 6 * scale); }
  }
  ctx.restore();
}
