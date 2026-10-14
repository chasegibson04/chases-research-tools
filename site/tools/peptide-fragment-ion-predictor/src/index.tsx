import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ToolProps } from '@/lib/types';
import { ToolShell, type RunState } from '@/components/tool/ToolShell';
import { ExportMenu } from '@/components/tool/ExportMenu';
import { PeptideStructure } from '@/components/ms/PeptideStructure';
import { SpectrumCanvas, type SpecAnnotation } from '@/components/ms/SpectrumCanvas';
import { IonTable } from '@/components/ms/IonTable';
import { IonTypePicker } from '@/components/ms/IonTypePicker';
import { screenPalette, ionColor } from '@/components/ms/palette';
import { familiesFor, ionsForMarker, complementOf, structureHighlight, observedBonds, focusedIons, ionForLabel, frameMz, type Focus } from '@/components/ms/linking';
import type { Ion, IonType } from '@/lib/ms/fragments';
import { SeriesToggles, seriesOf, ionVisible, type SeriesKey } from '@/components/ms/SeriesToggles';
import '@/components/ms/ms.css';
import { PRESETS, type Input, type Output } from './compute';

const CUSTOM = new Set(['ionTypes']);
const f4 = (x: number) => x.toFixed(4);

export default function FragmentPredictor({ manifest, examples, run }: ToolProps<Input, Output>) {
  const defaults = Object.fromEntries(manifest.inputs.map((i) => [i.name, i.default])) as Partial<Input>;
  const [values, setValues] = useState<Partial<Input>>(defaults);
  const [state, setState] = useState<RunState>('idle');
  const [msg, setMsg] = useState<string>();
  const [progress, setProgress] = useState(0);
  const [out, setOut] = useState<Output>();
  const handle = useRef<ReturnType<typeof run>>();
  const ran = useRef(false);
  const [hover, setHover] = useState<string[] | null>(null);
  const [focus, setFocus] = useState<Focus>(null);
  const [view, setView] = useState<[number, number] | undefined>();
  const [obsFile, setObsFile] = useState<File | null>(null);
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set());
  const visible = (ion: Ion) => ionVisible(ion, hidden);
  const palette = useMemo(() => screenPalette(), [out]);

  const shellManifest = useMemo(() => ({ ...manifest, inputs: manifest.inputs.filter((i) => !CUSTOM.has(i.name)) }), [manifest]);
  const cyclicInput = values.topology === 'cyclic' || /^\s*cyclo\(/i.test(String(values.sequence ?? ''));
  const preset = PRESETS[(values.activation ?? 'HCD') as Input['activation']]?.[cyclicInput ? 'cyclic' : 'linear'] ?? [];

  const doRun = (v: Partial<Input>, file: File | null = obsFile) => {
    handle.current?.cancel();
    setState('running'); setProgress(0);
    const t0 = performance.now();
    const h = run({ ...v, topology: cyclicInput ? 'cyclic' : 'linear', observedFile: file, observedFileName: file?.name } as Input, (f, m) => { setProgress(f); setMsg(m); });
    handle.current = h;
    h.promise.then((o) => { setOut(o); setState('done'); setMsg(`${o.ions.length.toLocaleString()} ions · ${Math.round(performance.now() - t0)} ms`); ran.current = true; })
      .catch((e) => { setState('error'); setMsg(e.message); });
  };
  // After the first run, recompute as the user edits (debounced).
  useEffect(() => {
    if (!ran.current) return;
    const t = setTimeout(() => doRun(values), 350);
    return () => clearTimeout(t);
  }, [values]);
  // Esc clears a pinned selection.
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setFocus(null); };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, []);
  useEffect(() => { setFocus(null); setView(undefined); }, [out?.peptide.text]);

  const ionById = useMemo(() => new Map((out?.ions ?? []).map((i) => [i.id, i])), [out]);
  const pinned = useMemo(() => (out ? focusedIons(focus, out.ions, out.peptide.cyclic) : []), [focus, out]);
  const pinnedSet = useMemo(() => new Set(pinned.map((i) => i.id)), [pinned]);
  const hlIons = useMemo(() => {
    const ids = hover ?? pinned.map((i) => i.id);
    const list = ids.map((id) => ionById.get(id)).filter(Boolean) as Ion[];
    const withPairs = [...list];
    if (out && list.length <= 3) for (const ion of list) { const c = complementOf(ion, out.ions, out.peptide); if (c) withPairs.push(c); }
    return withPairs;
  }, [hover, pinned, ionById, out]);
  const hlSet = useMemo(() => new Set(hlIons.map((i) => i.id)), [hlIons]);
  /** Peaks drawn in the accent colour: only what the pointer is on (pinned ions keep their ion colours). */
  const hoverSet = useMemo(() => new Set(hover ?? []), [hover]);

  // ---- spectrum layers: with a pinned selection, only its ions keep colour + labels ------------------
  const predictedLayer = useMemo(() => {
    if (!out) return null;
    const peaks = out.predicted.map((p) => ({ mz: p.mz, intensity: p.intensity }));
    const annotations = new Map<number, SpecAnnotation>();
    out.predicted.forEach((p, k) => {
      const ion = ionById.get(p.ionId); if (!ion) return;
      if (!ionVisible(ion, hidden) || (p.isotope > 0 && hidden.has('isotopes'))) return;
      const inFocus = !focus || pinnedSet.has(ion.id);
      annotations.set(k, inFocus ? { label: p.isotope === 0 && !hidden.has('labels') ? ion.label : '', color: ionColor(palette, ion.type), dim: p.isotope > 0 } : { label: '', color: palette.faint, dim: true });
    });
    const highlight = new Set<number>();
    out.predicted.forEach((p, k) => { if (hoverSet.has(p.ionId)) highlight.add(k); });
    return { peaks, annotations, highlight, label: 'Representative (illustrative intensities)' };
  }, [out, hoverSet, palette, focus, pinnedSet, hidden]);

  const observedLayer = useMemo(() => {
    if (!out?.observed || !out.match) return null;
    const annotations = new Map<number, SpecAnnotation>();
    for (const [k, list] of out.match.byPeak) {
      const vis = list.filter((m) => ionVisible(m.ion, hidden));
      if (!vis.length) continue;
      const best = (focus ? vis.find((m) => pinnedSet.has(m.ion.id)) : undefined) ?? vis[0];
      const inFocus = !focus || pinnedSet.has(best.ion.id);
      annotations.set(k, inFocus ? { label: hidden.has('labels') ? '' : best.ion.label, color: ionColor(palette, best.ion.type) } : { label: '', color: palette.faint, dim: true });
    }
    if (!hidden.has('isotopes')) for (const [k, mono] of out.match.isotopeOf) { const a = annotations.get(mono); if (a) annotations.set(k, { label: '', color: a.color, dim: true }); }
    const highlight = new Set<number>();
    for (const id of hoverSet) { const m = out.match.byIon.get(id); if (m) highlight.add(m.peak); }
    return { peaks: out.observed.peaks, annotations, highlight, label: out.observed.title ?? 'Observed' };
  }, [out, hoverSet, palette, focus, pinnedSet, hidden]);
  const presentSeries = useMemo(() => new Set((out?.ions ?? []).map(seriesOf)), [out]);

  // Zoom to the pinned ions: all fragments of a cleavage, or one ion with its isotopes.
  const scales = useMemo(() => {
    if (!out || !pinned.length) return { top: undefined as number | undefined, mirror: undefined as number | undefined };
    const pred = out.predicted.filter((p) => pinnedSet.has(p.ionId));
    const obs = out.match ? pinned.map((i) => out.match!.byIon.get(i.id)).filter(Boolean).map((m) => m!.intensity) : [];
    const predMax = Math.max(0, ...pred.map((p) => p.intensity));
    return observedLayer ? { top: obs.length ? Math.max(...obs) : undefined, mirror: predMax || undefined } : { top: predMax || undefined, mirror: undefined };
  }, [pinned, out, pinnedSet, observedLayer]);
  useEffect(() => {
    if (!out || !pinned.length) { setView(undefined); return; }
    const mzs = pinned.flatMap((i) => [i.mz, ...(out.match?.byIon.get(i.id) ? [out.match.byIon.get(i.id)!.obs] : [])]);
    setView(frameMz(mzs, focus?.kind === 'ion'));
  }, [pinned]);

  const structureHl = useMemo(() => (out ? structureHighlight(hlIons, out.peptide) : undefined), [hlIons, out]);
  const families = useMemo(() => familiesFor(out?.ionTypes ?? [], !!out?.peptide.cyclic), [out]);
  const observed = useMemo(() => (out?.match ? observedBonds([...out.match.byIon.values()].map((m) => m.ion), out.peptide.cyclic) : undefined), [out]);
  const maxObs = useMemo(() => Math.max(1, ...(out?.observed?.peaks.map((p) => p.intensity) ?? [1])), [out]);

  const focusIon = hlIons[0];
  const pair = focusIon && out ? complementOf(focusIon, out.ions, out.peptide) : undefined;
  const pinIon = (id: string | null) => setFocus((f) => (id && !(f?.kind === 'ion' && f.id === id) ? { kind: 'ion', id } : null));

  const rows = () => (out?.ions ?? []).map((i) => {
    const m = out?.match?.byIon.get(i.id);
    return { ion: i.label, type: i.type, size: i.size, charge: i.charge, loss: i.loss ?? '', carrier: i.carrier, sequence: i.seq, mz: +f4(i.mz), formula: i.formula, observed_mz: m ? +f4(m.obs) : '', error_ppm: m ? +m.errorPpm.toFixed(2) : '', intensity: m ? m.intensity : '', origins: i.origins?.map(([s, e]) => `${s + 1}-${e + 1}`).join(' ') ?? '' };
  });
  const mgf = () => out ? `BEGIN IONS\nTITLE=Predicted ${out.peptide.text} (${values.activation})\nPEPMASS=${f4(out.precursors[out.precursors.length - 1].mz)}\nCHARGE=${out.precursors.length}+\n${out.predicted.filter((p) => p.intensity > 0.5).map((p) => `${f4(p.mz)} ${p.intensity.toFixed(2)}`).join('\n')}\nEND IONS\n` : '';

  const header = out && (
    <div class="ms-summary">
      <dl class="ms-stat"><dt>Peptide</dt><dd title={out.peptide.text}>{out.peptide.text}</dd></dl>
      <dl class="ms-stat"><dt>Formula</dt><dd data-output="formula">{out.formula}</dd></dl>
      <dl class="ms-stat"><dt>Mono</dt><dd data-output="mono">{f4(out.mono)} Da</dd></dl>
      {out.precursors.map((p) => <dl class="ms-stat"><dt>[M+{p.z > 1 ? p.z : ''}H]{p.z > 1 ? `${p.z}+` : '+'}</dt><dd data-output={`mz${p.z}`}>{f4(p.mz)}</dd></dl>)}
      {out.coverage && <>
        <dl class="ms-stat"><dt>Peaks</dt><dd>{out.coverage.annotatedPeaks}/{out.coverage.totalPeaks}</dd></dl>
        <dl class="ms-stat"><dt>Intensity</dt><dd>{out.coverage.explainedIntensityPct.toFixed(1)}%</dd></dl>
        <dl class="ms-stat"><dt>Bonds</dt><dd>{out.coverage.sitesObserved}/{out.coverage.sitesTotal}</dd></dl>
      </>}
    </div>
  );

  return (
    <ToolShell manifest={shellManifest} examples={examples} values={values} state={state} message={msg} progress={progress} header={header}
      onChange={(k, v) => setValues({ ...values, [k]: v })} onLoadExample={(ex) => { setValues(ex.input); setFocus(null); }} onRun={() => doRun(values)} onCancel={() => { handle.current?.cancel(); setState('idle'); }}
      extraInputs={<>
        <IonTypePicker cyclic={cyclicInput} value={(values.ionTypes ?? []) as IonType[]} preset={preset} onChange={(v) => setValues({ ...values, ionTypes: v })} help={manifest.inputs.find((i) => i.name === 'ionTypes')!.help} />
        <div class="field">
          <label class="small muted">Or load a spectrum file (text peak list, MGF or mzML; read locally, never uploaded)</label>
          {obsFile
            ? <div class="ts-bar"><span class="tag mono">{obsFile.name} ({(obsFile.size / 1e6).toFixed(1)} MB)</span><button type="button" class="btn-sm" onClick={() => { setObsFile(null); if (ran.current) doRun(values, null); }}>Remove</button></div>
            : <input type="file" accept=".txt,.csv,.tsv,.xy,.mgf,.mzML,.mzml,.mzXML,.mzxml,.gz" onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0] ?? null; setObsFile(f); if (f && ran.current) doRun(values, f); }} />}
        </div>
      </>}>
      {out && (
        <div class="ms-tool">
          <div class="ms-card">
            <PeptideStructure peptide={out.peptide} families={families} observed={observed} highlight={structureHl}
              filename={`${manifest.id}-structure`}
              onHover={(m) => setHover(m ? (m.label ? [ionForLabel(out.ions, m.type, m.size, m.side, out.peptide.cyclic, m.bond)?.id].filter(Boolean) as string[] : ionsForMarker(out.ions, m.bond, m.side, out.peptide.cyclic).map((i) => i.id)) : null)}
              onClick={(m) => {
                if (m.label) { pinIon(ionForLabel(out.ions, m.type, m.size, m.side, out.peptide.cyclic, m.bond)?.id ?? null); return; }
                setFocus((f) => (f?.kind === 'bond' && f.bond === m.bond && f.side === m.side ? null : { kind: 'bond', bond: m.bond, side: m.side }));
              }} />
            <div class="ms-info" aria-live="polite">
              {focusIon ? (<>
                <span style={{ color: ionColor(palette, focusIon.type), fontWeight: 700 }}>{focusIon.label}</span>
                <span class="mono">{f4(focusIon.mz)}</span>
                <span class="tag">{focusIon.seq}</span>
                <span class="small muted">{focusIon.formula}</span>
                {out.match?.byIon.get(focusIon.id) && <span class="small" style={{ color: 'var(--ok)' }}>observed {f4(out.match.byIon.get(focusIon.id)!.obs)} ({out.match.byIon.get(focusIon.id)!.errorPpm.toFixed(1)} ppm)</span>}
                {pair && <span class="small">pair: <strong style={{ color: ionColor(palette, pair.type) }}>{pair.label}</strong> <span class="mono">{f4(pair.mz)}</span></span>}
                {focusIon.origins && focusIon.origins.length > 1 && <span class="small muted">{focusIon.origins.length} ring openings give this fragment</span>}
                {focus?.kind === 'bond' && pinned.length > 1 && <span class="small muted">{pinned.length} ions at this cleavage</span>}
              </>) : <span class="small muted">Click a cleavage line to focus all its fragments, or an ion label (b₃, y₅…) for one ion. Solid = observed, dotted = theoretical.</span>}
              {focus && <><span class="spacer" /><button type="button" class="btn-sm" onClick={() => setFocus(null)}>Clear selection (Esc)</button></>}
            </div>
          </div>

          <div class="ms-card">
            <SeriesToggles present={presentSeries} hidden={hidden} onChange={setHidden} palette={palette} />
            {observedLayer
              ? <SpectrumCanvas top={observedLayer} mirror={predictedLayer!} height={380} title="Observed (top) vs representative (bottom)" filename={`${manifest.id}-mirror`}
                  view={view} onView={setView} topScale={scales.top} mirrorScale={scales.mirror} hideUnassigned={hidden.has('unassigned')}
                  markers={out.precursors.slice(-1).map((p) => ({ mz: p.mz, label: 'precursor' }))}
                  onHover={(h) => { if (!h) { setHover(null); return; } if (h.layer === 'top') { const l = out.match!.byPeak.get(h.index); setHover(l ? [l[0].ion.id] : null); } else setHover([out.predicted[h.index].ionId]); }}
                  onPeakClick={(h) => { if (h.layer === 'top') { const l = out.match!.byPeak.get(h.index); pinIon(l?.[0].ion.id ?? null); } else pinIon(out.predicted[h.index].ionId); }} />
              : <SpectrumCanvas top={predictedLayer!} height={320} title="Representative spectrum" filename={`${manifest.id}-spectrum`}
                  view={view} onView={setView} topScale={scales.top} hideUnassigned={hidden.has('unassigned')}
                  markers={out.precursors.slice(-1).map((p) => ({ mz: p.mz, label: 'precursor' }))}
                  onHover={(h) => setHover(h ? [out.predicted[h.index].ionId] : null)} onPeakClick={(h) => pinIon(out.predicted[h.index].ionId)} />}
          </div>

          <div class="ms-card">
            <IonTable peptide={out.peptide} ions={out.ions} matches={out.match?.byIon} maxIntensity={maxObs} highlight={hlSet} palette={palette}
              onHover={(ids) => setHover(ids)} onSelect={(ion) => pinIon(ion.id)} mzRange={view} isVisible={visible} />
          </div>
          <ExportMenu filename={`${manifest.id}-${out.peptide.text.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40)}`} rows={rows()} json={{ peptide: out.peptide.text, mono: out.mono, formula: out.formula, precursors: out.precursors, ions: rows() }} text={mgf()} formats={['csv', 'tsv', 'json', 'txt']} />
          <p class="small faint" style={{ margin: 0 }}>TXT exports the representative spectrum as MGF. Intensities are illustrative (rule-based), not a trained prediction.</p>
        </div>
      )}
    </ToolShell>
  );
}
