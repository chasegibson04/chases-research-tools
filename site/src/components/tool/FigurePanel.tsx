import { useEffect, useRef, useState } from 'preact/hooks';
import { loadPlotly, baseLayout, PLOT_CONFIG, exportFigure, themePalette, type FigureStyle } from '@/lib/figure';

interface Props { traces: any[]; style?: FigureStyle; filename?: string; onReady?: () => void; customizable?: boolean }

/** Interactive, themed, exportable figure with a built-in customization strip. */
export function FigurePanel({ traces, style: initialStyle = {}, filename = 'figure', customizable = true }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<FigureStyle>({ gridlines: true, showLegend: true, fontSize: 13, ...initialStyle });
  const [opts, setOpts] = useState(false);
  const [dpi, setDpi] = useState(300);
  const [size, setSize] = useState({ w: 6.5, h: 4.5 });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    loadPlotly().then((Plotly) => {
      if (!alive || !el.current) return;
      const coloured = traces.map((t, i) => ({ marker: { color: (style.palette ?? themePalette())[i % 8] }, ...t }));
      Plotly.react(el.current, coloured, baseLayout(style), PLOT_CONFIG).then(() => setReady(true));
    });
    return () => { alive = false; };
  }, [traces, style]);

  const doExport = async (format: 'png' | 'svg') => {
    if (!el.current) return;
    const Plotly = await loadPlotly();
    // Temporarily restyle for print, export, then restore the screen theme.
    await Plotly.relayout(el.current, baseLayout(style, true));
    await exportFigure(el.current, { format, filename, widthIn: size.w, heightIn: size.h, dpi });
    await Plotly.relayout(el.current, baseLayout(style, false));
  };
  const set = (k: keyof FigureStyle) => (e: Event) => setStyle({ ...style, [k]: (e.target as HTMLInputElement).type === 'checkbox' ? (e.target as HTMLInputElement).checked : (e.target as HTMLInputElement).value });

  return (
    <div class="fig" data-ready={ready}>
      <div class="fig-bar">
        <strong>{style.title || 'Figure'}</strong>
        <span class="spacer" />
        {customizable && <button class="btn-sm" type="button" onClick={() => setOpts(!opts)} aria-expanded={opts}>Customize</button>}
        <button class="btn-sm" type="button" onClick={() => doExport('png')}>PNG</button>
        <button class="btn-sm" type="button" onClick={() => doExport('svg')}>SVG</button>
      </div>
      {opts && (
        <div class="fig-opts">
          <label>Title<input value={style.title ?? ''} onInput={set('title')} /></label>
          <label>X axis<input value={style.xTitle ?? ''} onInput={set('xTitle')} /></label>
          <label>Y axis<input value={style.yTitle ?? ''} onInput={set('yTitle')} /></label>
          <label>Font size<input type="number" min={8} max={24} value={style.fontSize} onInput={(e) => setStyle({ ...style, fontSize: Number((e.target as HTMLInputElement).value) })} /></label>
          <label>Width (in)<input type="number" step={0.5} value={size.w} onInput={(e) => setSize({ ...size, w: Number((e.target as HTMLInputElement).value) })} /></label>
          <label>Height (in)<input type="number" step={0.5} value={size.h} onInput={(e) => setSize({ ...size, h: Number((e.target as HTMLInputElement).value) })} /></label>
          <label>DPI<select value={dpi} onChange={(e) => setDpi(Number((e.target as HTMLSelectElement).value))}><option>150</option><option>300</option><option>600</option></select></label>
          <label><input type="checkbox" checked={style.gridlines} onChange={set('gridlines')} style={{ width: 'auto' }} /> Gridlines</label>
          <label><input type="checkbox" checked={style.showLegend} onChange={set('showLegend')} style={{ width: 'auto' }} /> Legend</label>
        </div>
      )}
      <div class="fig-plot" ref={el} />
    </div>
  );
}
