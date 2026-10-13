// Plotly wrapper: lazy-loaded (only on tool pages that use figures), themed, exportable at print resolution.
// docs/FIGURES_AND_EXPORTS.md
let plotlyPromise: Promise<any> | null = null;
export function loadPlotly(): Promise<any> {
  if (!plotlyPromise) plotlyPromise = import('plotly.js-basic-dist-min').then((m) => m.default ?? m);
  return plotlyPromise;
}

export interface FigureStyle {
  title?: string; xTitle?: string; yTitle?: string;
  fontFamily?: string; fontSize?: number;
  width?: number; height?: number;
  palette?: string[]; showLegend?: boolean; gridlines?: boolean; transparentBg?: boolean;
}

function cssVar(name: string, fallback: string) {
  if (typeof getComputedStyle === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
export function themePalette(): string[] {
  return Array.from({ length: 8 }, (_, i) => cssVar(`--viz-${i + 1}`, '#1f77b4'));
}

/** Layout that follows the site theme on screen but exports cleanly (white bg, black text) when `forExport`. */
export function baseLayout(style: FigureStyle = {}, forExport = false) {
  const fg = forExport ? '#000000' : cssVar('--fg', '#222');
  const muted = forExport ? '#444444' : cssVar('--fg-muted', '#666');
  const line = forExport ? '#cccccc' : cssVar('--line', '#ddd');
  const bg = forExport ? (style.transparentBg ? 'rgba(0,0,0,0)' : '#ffffff') : 'rgba(0,0,0,0)';
  const font = { family: style.fontFamily ?? (forExport ? 'Arial, Helvetica, sans-serif' : cssVar('--font-sans', 'sans-serif')), size: style.fontSize ?? (forExport ? 14 : 13), color: fg };
  return {
    title: style.title ? { text: style.title, font: { ...font, size: font.size + 2 } } : undefined,
    font,
    paper_bgcolor: bg,
    plot_bgcolor: bg,
    colorway: style.palette ?? themePalette(),
    showlegend: style.showLegend ?? true,
    margin: { l: 64, r: 24, t: style.title ? 48 : 24, b: 56 },
    xaxis: { title: { text: style.xTitle ?? '' }, gridcolor: line, zerolinecolor: line, linecolor: muted, showgrid: style.gridlines ?? true, ticks: 'outside', mirror: false },
    yaxis: { title: { text: style.yTitle ?? '' }, gridcolor: line, zerolinecolor: line, linecolor: muted, showgrid: style.gridlines ?? true, ticks: 'outside' },
    hovermode: 'closest',
    autosize: !(style.width && style.height),
    width: style.width, height: style.height,
  };
}

export const PLOT_CONFIG = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['lasso2d', 'select2d', 'toImage'], scrollZoom: true };

/** Export at publication resolution. `dpi` scales a nominal `widthIn` x `heightIn` inch figure. */
export async function exportFigure(el: HTMLElement, opts: { format: 'png' | 'svg' | 'jpeg' | 'webp'; filename: string; widthIn?: number; heightIn?: number; dpi?: number }) {
  const Plotly = await loadPlotly();
  const widthIn = opts.widthIn ?? 6.5, heightIn = opts.heightIn ?? 4.5, dpi = opts.dpi ?? 300;
  const base = 96; // CSS px per inch
  const width = Math.round(widthIn * base), height = Math.round(heightIn * base);
  const scale = opts.format === 'svg' ? 1 : dpi / base;
  return Plotly.downloadImage(el, { format: opts.format, width, height, scale, filename: opts.filename });
}
