# Figures and data exports

## Figures (`FigurePanel`)
`site/src/components/tool/FigurePanel.tsx` wraps Plotly (basic bundle, lazy-loaded on first draw):
- **Interactive**: wheel zoom, drag pan, box zoom, hover tooltips, double-click reset, legend toggling (Plotly modebar with the logo and lasso/select removed).
- **Themed**: colours, grid, fonts come from CSS tokens (`--viz-1…8` Okabe–Ito colorblind-safe palette, `--fg`, `--line`) so figures match the site theme on screen.
- **Publication export**: PNG at 150/300/600 DPI for a chosen physical size (inches), or SVG (vector, editable in Illustrator/Inkscape). On export the layout temporarily switches to print styling (white background, black text, Arial) and reverts.
- **Customize strip**: title, axis titles, font size, size, DPI, gridlines, legend. Extend here (not per tool) when a new option is needed by more than one tool: line widths, marker size, log axes, palette picker, axis ranges, tick formats, annotation, dark-export toggle are the planned next additions (ROADMAP).

Usage in a tool:
```tsx
<FigurePanel traces={[{ type: 'scatter', mode: 'lines', x, y, name: 'Signal' }]} filename="my-figure" style={{ title: 'Spectrum', xTitle: 'm/z', yTitle: 'Intensity' }} />
```
Memoize `traces` with `useMemo` so re-renders don't redraw. Multiple figures per tool are fine. For heatmaps, 3D, contour, etc., import the full `plotly.js-dist-min` inside the tool chunk and note `bundleSizeKB`.

## Data exports (`ExportMenu`, `src/lib/export.ts`)
- `downloadCSV/TSV(filename, rows, header?)` (RFC 4180 quoting, CRLF, UTF-8), `downloadJSON`, `downloadText`, `downloadBlob`.
- `ExportMenu` renders buttons for the formats listed in the manifest `exports`. Name files `<tool-id>-<descriptor>.<ext>`.
- Large outputs: build the Blob in the worker (transfer an `ArrayBuffer`) rather than stringifying on the main thread.
- Round-trip rule: anything a tool imports (CSV/TSV/JSON) it should also export in the same schema, so users can chain tools.

## Figure quality checklist (manual pass)
Axis titles with units; tick labels legible at 300 DPI; colorblind-safe palette; no clipped text; exported SVG has real text (not outlines) and real vector marks; legend only when > 1 series.
