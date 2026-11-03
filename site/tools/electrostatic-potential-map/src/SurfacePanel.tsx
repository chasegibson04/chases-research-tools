import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Panel } from '@/components/tool/Panel';
import { downloadText } from '@/lib/export';
import type { Output } from './compute';
import { colorsToBytes, buildSurface, DEFAULT_FIGURE, LOOKS, saveFigureSettings, type BuiltSurface, type FigureSettings } from './surface/figure';
import { COLORMAPS, colorAt, cssGradient, setCustomStops, stopsOf, type ColormapName } from './surface/colormap';
import { EspViewer, type ViewPreset } from './surface/viewer3d';
import { toOBJ, toPLY } from './exporters';
import { UNIT_LABEL, UNIT_NAMES, UNIT_FACTOR, niceNumber, type EspUnit } from './units';
import { Field, Group, NumberBox, Seg, downloadURL } from './ui';
import { orbitalLabel } from './labels';

interface Props {
  result: Output;
  settings: FigureSettings;
  onChange: (patch: Partial<FigureSettings>) => void;
  /** orbital amplitude grids on the density grid, by MO index (HOMO and LUMO come with the first result) */
  orbitals: Map<number, Float32Array>;
  requestOrbital: (index: number) => void;
  orbitalBusy: boolean;
  onBuilt?: (b: BuiltSurface | null) => void;
}

const ISO_PRESETS: Array<[number, string]> = [[0.001, '0.001'], [0.002, '0.002'], [0.004, '0.004'], [0.01, '0.01']];

export function figureCaption(r: Output, s: FigureSettings, b: BuiltSurface | null): string {
  const st = r.structure!, qm = r.qm!;
  const name = st.smiles ? `${st.formula} (SMILES ${st.smiles})` : st.formula;
  const geom = st.origin === 'xyz' ? 'the supplied geometry' : 'an MMFF94s-refined geometry';
  const level = `${qm.method}`;
  if (s.property === 'orbital') {
    const idx = s.orbitalIndex < 0 ? r.wave!.nocc - 1 : s.orbitalIndex;
    return `${orbitalLabel(idx, r.wave!.nocc)} of ${name}, drawn as the ±${s.orbitalIso} (e/bohr³)^½ isosurface (${s.posColor === '#2f6fed' ? 'blue' : 'positive'} and ${s.negColor === '#e5484d' ? 'red' : 'negative'} phases). Computed at the ${level} level on ${geom}.`;
  }
  if (s.property === 'plain' || !b?.stats) return `Electron-density isosurface (${s.isovalue} e/bohr³) of ${name}, computed at the ${level} level on ${geom}.`;
  const [lo, hi] = b.stats.range;
  const neg = COLORMAPS[s.colormap].diverging ? 'red' : 'the low end of the scale';
  return `Electrostatic potential mapped onto the ${s.isovalue} e/bohr³ electron-density isosurface of ${name}, computed at the ${level} level on ${geom}. Colour scale ${niceNumber(lo)} to ${niceNumber(hi)} ${UNIT_LABEL[s.units]}${s.colormap === 'rwb' && !s.reverse ? ' (red, negative potential, electron-rich; blue, positive potential)' : s.colormap === 'rainbow' && !s.reverse ? ' (red, most negative; blue, most positive)' : ` (${neg} = most negative)`}.`;
}

export default function SurfacePanel({ result, settings: s, onChange, orbitals, requestOrbital, orbitalBusy, onBuilt }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<EspViewer | null>(null);
  const [built, setBuilt] = useState<BuiltSurface | null>(null);
  const [busy, setBusy] = useState(true);
  const [glError, setGlError] = useState<string | null>(null);
  const [copied, setCopied] = useState('');
  setCustomStops(s.customStops);
  const nocc = result.wave!.nocc;
  const nbf = result.wave!.nbf;
  const orbIndex = s.orbitalIndex < 0 ? nocc - 1 : s.orbitalIndex;
  const orbData = orbitals.get(orbIndex);
  const hasEsp = !!result.esp;

  // viewer lifecycle
  useEffect(() => {
    if (!canvas.current) return;
    try { viewer.current = new EspViewer(canvas.current, overlay.current); }
    catch (e: any) { setGlError(e?.message ?? 'WebGL is not available in this browser.'); return; }
    viewer.current.setStyle(s);
    return () => { viewer.current?.dispose(); viewer.current = null; };
  }, []);

  // structure
  const atoms = useMemo(() => {
    const st = result.structure!;
    return st.z.map((z, i) => ({ z, x: st.xyz[i * 3], y: st.xyz[i * 3 + 1], zc: st.xyz[i * 3 + 2] }));
  }, [result]);
  const labelTexts = useMemo(() => {
    const st = result.structure!;
    return st.z.map((_, i) => s.labels === 'element' ? st.symbols[i] : s.labels === 'index' ? `${st.symbols[i]}${i + 1}` : s.labels === 'charge' ? result.charges!.mulliken[i].toFixed(2) : '');
  }, [result, s.labels]);
  useEffect(() => { viewer.current?.setStructure(atoms, result.structure!.bonds, labelTexts); viewer.current?.resetView('top'); }, [atoms]);
  useEffect(() => { viewer.current?.setOverlay(overlayState(), labelTexts, labelColor()); }, [labelTexts]);

  // surface (debounced)
  const depKey = [s.property, s.isovalue, orbIndex, s.orbitalIso, s.colormap, s.reverse, s.rangeMode, s.vmin, s.vmax, s.units, s.posColor, s.negColor, s.plainColor, s.customStops.join(',')].join('|');
  useEffect(() => {
    if (!viewer.current) return;
    if (s.property === 'orbital' && !orbData) { if (!orbitalBusy) requestOrbital(orbIndex); return; }
    setBusy(true);
    const t = setTimeout(() => {
      try {
        const b = buildSurface(result.density!, result.esp, orbData, s);
        setBuilt(b);
        viewer.current?.setSurface(b.mesh, b.colors);
        onBuilt?.(b);
      } catch (e) { console.error(e); }
      setBusy(false);
    }, 30);
    return () => clearTimeout(t);
  }, [result, depKey, orbData, orbitalBusy]);

  // style + overlay
  useEffect(() => { viewer.current?.setStyle(s); }, [s.atomStyle, s.atomScale, s.opacity, s.shininess, s.wireframe, s.background, s.bgColor, s.projection, s.cutaway, s.cutOffset]);
  const labelColor = () => (s.background === 'white' || s.background === 'transparent' ? '#15171a' : s.background === 'custom' ? '#f2f0eb' : '#f2f0eb');
  const overlayState = () => ({
    bar: s.showBar && s.property === 'esp' && built?.stats && Number.isFinite(built.stats.range[0]) && built.stats.range[1] !== built.stats.range[0]
      ? { colormap: s.colormap, reverse: s.reverse, vmin: built.stats.range[0], vmax: built.stats.range[1], label: `Electrostatic potential (${UNIT_LABEL[s.units]})`, position: s.barPosition, diverging: COLORMAPS[s.colormap].diverging }
      : null,
    title: s.title,
    subtitle: s.title ? `${result.qm!.method} · ${s.property === 'orbital' ? orbitalLabel(orbIndex, nocc) : `${s.isovalue} e/bohr³ surface`}` : undefined,
  });
  useEffect(() => { viewer.current?.setOverlay(overlayState(), labelTexts, labelColor()); }, [built, s.showBar, s.barPosition, s.title, s.units, s.colormap, s.reverse, s.property, s.background, s.orbitalIndex, s.isovalue]);
  useEffect(() => { saveFigureSettings(s); }, [s]);

  const exportPx = () => {
    const w = Math.round(s.exportWidthIn * s.exportDpi);
    const stage = canvas.current!;
    const ratio = s.exportAspect === 'screen' ? stage.clientHeight / stage.clientWidth : s.exportAspect === '1:1' ? 1 : s.exportAspect === '4:3' ? 3 / 4 : s.exportAspect === '3:2' ? 2 / 3 : 9 / 16;
    return [w, Math.round(w * ratio)] as const;
  };
  const savePNG = async () => {
    if (!viewer.current) return;
    const [w, h] = exportPx();
    const blob = await viewer.current.exportPNG(w, h);
    downloadURL(`${result.structure!.formula.replace(/[^A-Za-z0-9]/g, '')}-${s.property === 'orbital' ? orbitalLabel(orbIndex, nocc).replace('−', '-') : 'esp'}.png`, blob);
  };
  const saveMesh = (kind: 'ply' | 'obj') => {
    if (!built) return;
    const colors = colorsToBytes(built.colors);
    const base = result.structure!.formula.replace(/[^A-Za-z0-9]/g, '');
    if (kind === 'ply') downloadURL(`${base}-surface.ply`, new Blob([toPLY(built.mesh, colors)], { type: 'application/octet-stream' }));
    else downloadText(`${base}-surface.obj`, toOBJ(built.mesh, colors, `${base}-surface`), 'text/plain');
  };
  const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 1600); } catch { /* clipboard blocked */ } };

  const stats = built?.stats;
  const f = UNIT_FACTOR[s.units];
  const unitLabel = UNIT_LABEL[s.units];
  const view = (p: ViewPreset) => viewer.current?.resetView(p);
  const orbOptions: number[] = [];
  for (let i = Math.max(0, nocc - 6); i <= Math.min(nbf - 1, nocc + 5); i++) orbOptions.push(i);
  const [exW, exH] = canvas.current ? exportPx() : [0, 0];
  const caption = figureCaption(result, s, built);

  return (
    <Panel title="Surface figure" id="esp-surface" meta={<span>{result.structure!.formula} · {result.qm!.method}</span>}>
      <div class="esp-fig">
        <div>
          <div class="esp-stage" data-testid="esp-stage" data-ready={!busy && !!built}>
            <canvas ref={canvas} aria-label="3D electrostatic potential surface. Drag to rotate, scroll to zoom, shift-drag to pan." role="img" />
            <canvas ref={overlay} class="overlay" aria-hidden="true" />
            <span class="esp-hint">drag: rotate · click, then wheel: zoom · shift-drag: pan · double-click: reset</span>
            {(busy || orbitalBusy) && <div class="esp-busy">{orbitalBusy ? 'Evaluating orbital…' : 'Building surface…'}</div>}
            {glError && <div class="esp-busy" role="alert">3D view unavailable: {glError}</div>}
          </div>
          {stats && s.property !== 'orbital' && (
            <div class="esp-stats" data-output-group="surface-stats">
              {s.property === 'esp' && <>
                <div><span class="k">V<sub>s,min</sub> ({unitLabel})</span><span class="v" data-output="vsmin">{stats.vmin.toFixed(2)}</span></div>
                <div><span class="k">V<sub>s,max</sub> ({unitLabel})</span><span class="v" data-output="vsmax">{stats.vmax.toFixed(2)}</span></div>
                <div><span class="k">Mean V<sub>s</sub> (area-weighted)</span><span class="v">{stats.vavg.toFixed(2)}</span></div>
                <div><span class="k">Positive surface area</span><span class="v">{(stats.fracPositive * 100).toFixed(0)} %</span></div>
              </>}
              <div><span class="k">Surface area</span><span class="v">{stats.area.toFixed(1)} Å²</span></div>
              <div><span class="k">Enclosed volume</span><span class="v">{stats.volume.toFixed(1)} Å³</span></div>
            </div>
          )}
          <div class="esp-caption">
            <p data-testid="esp-caption">{caption}</p>
            <button type="button" class="btn-sm" onClick={() => copy(caption, 'caption')}>{copied === 'caption' ? 'Copied' : 'Copy caption'}</button>
          </div>
        </div>

        <div class="esp-controls" aria-label="Figure controls">
          <Field label="Look" help="One-click styles that set the colour map, range, background and surface together. 'Lecture slide' reproduces the dark rainbow ESP maps from the cation–π slides; 'Journal' gives a white, zero-centred figure. You can still change every setting afterwards.">
            <select value="" data-testid="look-select" onChange={(e) => { const l = LOOKS.find((x) => x.id === (e.target as HTMLSelectElement).value); if (l) onChange({ ...l.patch, property: l.patch.property ?? 'esp' }); }}>
              <option value="">Choose a look…</option>
              {LOOKS.map((l) => <option value={l.id} title={l.note}>{l.label}</option>)}
            </select>
          </Field>
          <Group id="surface" title="Surface">
            <Field label="Colour by" help="ESP paints the electrostatic potential on the density surface (red negative, blue positive with the default map). Orbital shows the two phases of one molecular orbital. Density only draws the bare surface in one colour.">
              <select value={s.property} onChange={(e) => onChange({ property: (e.target as HTMLSelectElement).value as FigureSettings['property'] })}>
                <option value="esp" disabled={!hasEsp}>Electrostatic potential</option>
                <option value="orbital">Molecular orbital</option>
                <option value="plain">Density surface only</option>
              </select>
            </Field>
            {s.property !== 'orbital' ? (
              <Field label="Density isovalue" unit="e/bohr³" help="The electron-density level that defines the surface. 0.002 e/bohr³ is the common choice for a van der Waals-like envelope (Bader used 0.001). Larger values shrink the surface towards the nuclei; smaller values inflate it.">
                <NumberBox value={s.isovalue} onChange={(v) => onChange({ isovalue: Math.min(0.1, Math.max(0.0002, v)) })} min={0.0002} max={0.1} step={0.0005} />
                <div class="esp-presets">{ISO_PRESETS.map(([v, t]) => <button type="button" class="btn-sm" aria-pressed={s.isovalue === v} onClick={() => onChange({ isovalue: v })}>{t}</button>)}</div>
              </Field>
            ) : (<>
              <Field label="Orbital" help="Which molecular orbital to draw. HOMO is the highest occupied and LUMO the lowest unoccupied orbital. Orbitals other than HOMO and LUMO are evaluated on demand, which takes a moment.">
                <select value={orbIndex} onChange={(e) => onChange({ orbitalIndex: Number((e.target as HTMLSelectElement).value) })}>
                  {orbOptions.map((i) => <option value={i}>{orbitalLabel(i, nocc)} ({(result.qm!.eps[i] * 27.2114).toFixed(2)} eV)</option>)}
                </select>
              </Field>
              <Field label="Orbital isovalue" unit="(e/bohr³)^½" help="Amplitude of the orbital at which the lobes are drawn. 0.04 to 0.05 is typical; lower values give fatter lobes.">
                <NumberBox value={s.orbitalIso} onChange={(v) => onChange({ orbitalIso: Math.min(0.5, Math.max(0.002, v)) })} min={0.002} max={0.5} step={0.005} />
              </Field>
              <div class="esp-pair">
                <Field label="Positive lobe" help="Colour of the positive phase of the orbital."><input type="color" value={s.posColor} onInput={(e) => onChange({ posColor: (e.target as HTMLInputElement).value })} /></Field>
                <Field label="Negative lobe" help="Colour of the negative phase of the orbital."><input type="color" value={s.negColor} onInput={(e) => onChange({ negColor: (e.target as HTMLInputElement).value })} /></Field>
              </div>
            </>)}
            {s.property === 'plain' && <Field label="Surface colour" help="Single colour for the density-only surface."><input type="color" value={s.plainColor} onInput={(e) => onChange({ plainColor: (e.target as HTMLInputElement).value })} /></Field>}
            <Field label="Opacity" help="Lower values make the surface see-through so the atoms inside show. Fully opaque (1) gives the cleanest colours for print.">
              <input type="range" min={0.2} max={1} step={0.02} value={s.opacity} onInput={(e) => onChange({ opacity: Number((e.target as HTMLInputElement).value) })} />
            </Field>
            <label class="small" style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" style="width:auto" checked={s.wireframe} onChange={(e) => onChange({ wireframe: (e.target as HTMLInputElement).checked })} /> Mesh only<span class="faint">(wireframe)</span></label>
            <label class="small" style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" style="width:auto" checked={s.cutaway} onChange={(e) => onChange({ cutaway: (e.target as HTMLInputElement).checked })} /> Cut-away view</label>
            {s.cutaway && <Field label="Cut position" unit="Å" help="Slices the model with a plane parallel to the screen so you can see the inside of the surface. Drag the slider to move the plane through the molecule."><input type="range" min={-8} max={8} step={0.1} value={s.cutOffset} onInput={(e) => onChange({ cutOffset: Number((e.target as HTMLInputElement).value) })} /></Field>}
          </Group>

          {s.property === 'esp' && (
            <Group id="colour" title="Colour scale">
              <Field label="Colour map" help="Red-to-blue diverging maps put white at zero potential. The orange-purple and brown-teal maps stay readable with red-green colour blindness. Rainbow matches the classic ESP look.">
                <select value={s.colormap} onChange={(e) => onChange({ colormap: (e.target as HTMLSelectElement).value as ColormapName })}>
                  {(Object.keys(COLORMAPS) as ColormapName[]).map((k) => <option value={k}>{COLORMAPS[k].label}</option>)}
                </select>
                <div class="esp-bar-preview" style={{ background: cssGradient(s.colormap, s.reverse) }} aria-hidden="true" />
              </Field>
              <label class="small" style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" style="width:auto" checked={s.reverse} onChange={(e) => onChange({ reverse: (e.target as HTMLInputElement).checked })} /> Reverse colours</label>
              {s.colormap === 'custom' && (
                <div class="esp-custom" data-testid="custom-gradient">
                  <p class="small muted" style="margin:0">Colours run from the most negative potential (left) to the most positive (right), evenly spaced.</p>
                  <div class="esp-stops">
                    {s.customStops.map((c, i) => (
                      <input type="color" aria-label={`Gradient colour ${i + 1} of ${s.customStops.length}`} value={c} onInput={(e) => { const n = [...s.customStops]; n[i] = (e.target as HTMLInputElement).value; onChange({ customStops: n }); }} />
                    ))}
                  </div>
                  <div class="esp-presets">
                    <button type="button" class="btn-sm" disabled={s.customStops.length >= 8} onClick={() => onChange({ customStops: [...s.customStops, s.customStops[s.customStops.length - 1]] })}>Add colour</button>
                    <button type="button" class="btn-sm" disabled={s.customStops.length <= 2} onClick={() => onChange({ customStops: s.customStops.slice(0, -1) })}>Remove last</button>
                    <button type="button" class="btn-sm" onClick={() => onChange({ customStops: [...s.customStops].reverse() })}>Flip order</button>
                  </div>
                  <label class="small muted" for="esp-start-from">Start from</label>
                  <select id="esp-start-from" value="" onChange={(e) => {
                    const name = (e.target as HTMLSelectElement).value as ColormapName;
                    if (!name) return;
                    const n = Math.min(7, stopsOf(name).length);
                    const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
                    onChange({ customStops: Array.from({ length: n }, (_, k) => { const [r, g, b] = colorAt(name, k / (n - 1)); return `#${hex(r)}${hex(g)}${hex(b)}`; }) });
                  }}>
                    <option value="">an existing map…</option>
                    {(Object.keys(COLORMAPS) as ColormapName[]).filter((k) => k !== 'custom').map((k) => <option value={k}>{COLORMAPS[k].label}</option>)}
                  </select>
                </div>
              )}
              <Field label="Units" help="Units for the colour scale and the extrema: kcal/mol and kJ/mol are the energy a +1 charge would gain or lose at that point; a.u. is hartree per electron; eV is volts.">
                <select value={s.units} onChange={(e) => {
                  const next = (e.target as HTMLSelectElement).value as EspUnit;
                  const k = UNIT_FACTOR[next] / f;
                  onChange({ units: next, vmin: +(s.vmin * k).toPrecision(4), vmax: +(s.vmax * k).toPrecision(4) });
                }}>{(Object.keys(UNIT_NAMES) as EspUnit[]).map((u) => <option value={u}>{UNIT_NAMES[u]}</option>)}</select>
              </Field>
              <Field label="Range" help="Automatic symmetric centres the scale on zero (best for diverging maps and for comparing molecules: use the same manual range for every figure in a series). Automatic min–max stretches the scale to the data. Manual lets you type limits.">
                <select value={s.rangeMode} onChange={(e) => onChange({ rangeMode: (e.target as HTMLSelectElement).value as FigureSettings['rangeMode'] })}>
                  <option value="auto-sym">Automatic, symmetric about 0</option>
                  <option value="auto">Automatic, min to max</option>
                  <option value="manual">Manual</option>
                </select>
              </Field>
              <div class="esp-pair">
                <Field label="Minimum" unit={unitLabel} help="Value at the low end of the colour bar (most negative potential for the default map)."><NumberBox value={s.rangeMode === 'manual' ? s.vmin : stats?.range[0] ?? s.vmin} disabled={s.rangeMode !== 'manual'} onChange={(v) => onChange({ vmin: v })} /></Field>
                <Field label="Maximum" unit={unitLabel} help="Value at the high end of the colour bar (most positive potential for the default map)."><NumberBox value={s.rangeMode === 'manual' ? s.vmax : stats?.range[1] ?? s.vmax} disabled={s.rangeMode !== 'manual'} onChange={(v) => onChange({ vmax: v })} /></Field>
              </div>
              {s.rangeMode !== 'manual' && stats && <button type="button" class="btn-sm" onClick={() => onChange({ rangeMode: 'manual', vmin: +stats.range[0].toPrecision(4), vmax: +stats.range[1].toPrecision(4) })}>Fix this range</button>}
              <label class="small" style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" style="width:auto" checked={s.showBar} onChange={(e) => onChange({ showBar: (e.target as HTMLInputElement).checked })} /> Show colour bar</label>
              {s.showBar && <Seg label="Colour bar position" value={s.barPosition} onChange={(v) => onChange({ barPosition: v })} options={[['right', 'Right'], ['bottom', 'Bottom']]} />}
            </Group>
          )}

          <Group id="atoms" title="Atoms and labels" open={false}>
            <Field label="Atom style" help="Ball-and-stick, sticks only, space-filling spheres, or hide the atoms. With an opaque surface the atoms are hidden inside it; lower the opacity or use the cut-away view to see them.">
              <select value={s.atomStyle} onChange={(e) => onChange({ atomStyle: (e.target as HTMLSelectElement).value as FigureSettings['atomStyle'] })}>
                <option value="ballstick">Ball and stick</option><option value="stick">Sticks</option><option value="spacefill">Space-filling</option><option value="none">Hidden</option>
              </select>
            </Field>
            <Field label="Atom size" help="Scales the atom spheres."><input type="range" min={0.5} max={1.6} step={0.05} value={s.atomScale} onInput={(e) => onChange({ atomScale: Number((e.target as HTMLInputElement).value) })} /></Field>
            <Field label="Labels" help="Text next to each atom: element symbol, symbol with number (matches the atom table), or its Mulliken charge.">
              <select value={s.labels} onChange={(e) => onChange({ labels: (e.target as HTMLSelectElement).value as FigureSettings['labels'] })}>
                <option value="none">None</option><option value="element">Element</option><option value="index">Element and number</option><option value="charge">Mulliken charge</option>
              </select>
            </Field>
          </Group>

          <Group id="view" title="View and background" open={false}>
            <div class="esp-presets" role="group" aria-label="View presets">
              {(['top', 'side', 'front', 'iso'] as ViewPreset[]).map((p) => <button type="button" class="btn-sm" onClick={() => view(p)}>{p === 'top' ? 'Face-on' : p === 'side' ? 'Edge-on' : p === 'front' ? 'End-on' : 'Angled'}</button>)}
            </div>
            <Field label="Projection" help="Perspective looks natural; orthographic removes foreshortening, which is the better choice when atoms or surfaces must be compared by size in a figure.">
              <Seg label="Projection" value={s.projection} onChange={(v) => onChange({ projection: v })} options={[['perspective', 'Perspective'], ['orthographic', 'Orthographic']]} />
            </Field>
            <Field label="Background" help="Dark matches the site. White is best for journals. Transparent exports a PNG without a background so you can place the figure on any slide or panel.">
              <select value={s.background} onChange={(e) => onChange({ background: (e.target as HTMLSelectElement).value as FigureSettings['background'] })}>
                <option value="dark">Dark</option><option value="white">White</option><option value="black">Black</option><option value="transparent">Transparent (PNG)</option><option value="custom">Custom colour</option>
              </select>
            </Field>
            {s.background === 'custom' && <Field label="Background colour" help="Any background colour."><input type="color" value={s.bgColor} onInput={(e) => onChange({ bgColor: (e.target as HTMLInputElement).value })} /></Field>}
            <Field label="Shininess" help="Strength of the specular highlight on the surface. Low values give a matte, print-friendly look."><input type="range" min={0} max={120} step={5} value={s.shininess} onInput={(e) => onChange({ shininess: Number((e.target as HTMLInputElement).value) })} /></Field>
            <Field label="Figure title" help="Optional title drawn on the figure and in the exported PNG. A second line gives the method and isovalue."><input type="text" value={s.title} placeholder="e.g. Benzene" onInput={(e) => onChange({ title: (e.target as HTMLInputElement).value })} /></Field>
          </Group>

          <Group id="export" title="Export image">
            <div class="esp-pair">
              <Field label="Width" unit="in" help="Physical width of the exported image. A single-column journal figure is about 3.3 in wide, a double-column figure about 7 in."><NumberBox value={s.exportWidthIn} min={1} max={20} step={0.1} onChange={(v) => onChange({ exportWidthIn: v })} /></Field>
              <Field label="Resolution" unit="dpi" help="Dots per inch. 300 is standard for print; 600 for line-art-like figures. The pixel size is limited by your graphics card (up to about 8000 px)."><select value={s.exportDpi} onChange={(e) => onChange({ exportDpi: Number((e.target as HTMLSelectElement).value) })}><option>150</option><option>300</option><option>600</option></select></Field>
            </div>
            <Field label="Shape" help="Aspect ratio of the exported image. 'Same as screen' keeps what you see.">
              <select value={s.exportAspect} onChange={(e) => onChange({ exportAspect: (e.target as HTMLSelectElement).value as FigureSettings['exportAspect'] })}>
                <option value="screen">Same as screen</option><option value="1:1">Square (1:1)</option><option value="4:3">4:3</option><option value="3:2">3:2</option><option value="16:9">16:9</option>
              </select>
            </Field>
            <p class="small faint" style="margin:0">{exW} × {exH} px</p>
            <div class="esp-presets">
              <button type="button" class="btn-primary btn-sm" onClick={savePNG} disabled={busy || !built} data-action="save-png">Save PNG</button>
              <button type="button" class="btn-sm" onClick={() => saveMesh('ply')} disabled={!built} title="Coloured mesh in Angstrom for PyMOL, ChimeraX, Blender, MeshLab">PLY mesh</button>
              <button type="button" class="btn-sm" onClick={() => saveMesh('obj')} disabled={!built}>OBJ mesh</button>
            </div>
            <div class="esp-presets">
              <button type="button" class="btn-sm" onClick={() => copy(JSON.stringify(s), 'settings')} title="Copy every figure setting so you can reproduce this figure later">{copied === 'settings' ? 'Copied' : 'Copy settings'}</button>
              <button type="button" class="btn-sm" onClick={async () => { try { const t = await navigator.clipboard.readText(); onChange({ ...DEFAULT_FIGURE, ...JSON.parse(t) }); } catch { /* not JSON or blocked */ } }}>Paste settings</button>
              <button type="button" class="btn-sm" onClick={() => onChange({ ...DEFAULT_FIGURE })}>Reset</button>
            </div>
          </Group>
        </div>
      </div>
    </Panel>
  );
}
