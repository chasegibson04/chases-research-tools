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

## 3D and 2D-slice figures (`tools/electrostatic-potential-map`)
For property-on-surface chemistry figures the ESP tool shows what a publication-grade, customizable figure needs; reuse these ideas for new tools.
- **3D view** (`src/surface/viewer3d.ts`, three.js, lazy-loaded): trackball rotate, pan, zoom (wheel zoom only after clicking the view or with Ctrl/Cmd, so page scrolling is never trapped), face-on / edge-on / end-on / angled presets, perspective or orthographic projection, cut-away plane, opaque or translucent surface (translucent = back faces then front faces, no sorting artifacts), ball-and-stick / stick / space-filling / hidden atoms, atom labels, dark / white / transparent / custom background.
- **Colour scale**: diverging maps with white at zero (red–white–blue, red–yellow–blue), colour-blind-safe orange–purple and brown–teal, rainbow for classic ESP, viridis and grey; automatic symmetric, automatic min–max or manual range; kcal/mol, kJ/mol, a.u. or eV; colour bar with ticks and units drawn into the image.
- **Print export**: PNG at a physical width in inches × dpi (150/300/600, capped by the GPU, about 8000 px) with any aspect ratio; the colour bar, title and labels are composited into the file. Meshes go out as binary PLY and OBJ with vertex colours (Å), volumetric data as Gaussian cube files (bohr).
- **Reproducibility**: a generated caption states method, geometry, isovalue, colour scale and units; "Copy settings" / "Paste settings" round-trip every figure option as JSON.
- **2D slice** (`src/slice.ts`): raster heatmap + vector contours (marching squares), atoms, ticks and colour bar in one self-contained SVG (also PNG). Plotly's basic bundle has no heatmap/contour trace, so this is custom and small.
- **Guideline**: a figure the user will publish must state the method, the isovalue or level, the colour scale with units, and what the colours mean; offer a fixed range so panels of several molecules are comparable.

## Data exports (`ExportMenu`, `src/lib/export.ts`)
- `downloadCSV/TSV(filename, rows, header?)` (RFC 4180 quoting, CRLF, UTF-8), `downloadJSON`, `downloadText`, `downloadBlob`.
- `ExportMenu` renders buttons for the formats listed in the manifest `exports`. Name files `<tool-id>-<descriptor>.<ext>`.
- Large outputs: build the Blob in the worker (transfer an `ArrayBuffer`) rather than stringifying on the main thread.
- Round-trip rule: anything a tool imports (CSV/TSV/JSON) it should also export in the same schema, so users can chain tools.

## Figure quality checklist (manual pass)
Axis titles with units; tick labels legible at 300 DPI; colorblind-safe palette; no clipped text; exported SVG has real text (not outlines) and real vector marks; legend only when > 1 series.
