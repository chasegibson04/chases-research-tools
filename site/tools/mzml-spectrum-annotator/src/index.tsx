import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ToolProps } from '@/lib/types';
import { Panel } from '@/components/tool/Panel';
import { ToolShell, type RunState } from '@/components/tool/ToolShell';
import { ExportMenu } from '@/components/tool/ExportMenu';
import { PeptideStructure } from '@/components/ms/PeptideStructure';
import { SpectrumCanvas, type SpecAnnotation } from '@/components/ms/SpectrumCanvas';
import { IonTypePicker } from '@/components/ms/IonTypePicker';
import { screenPalette, ionColor, useThemeTick } from '@/components/ms/palette';
import { familiesFor, ionsForMarker, complementOf, structureHighlight, observedBonds, focusedIons, ionForLabel, frameMz, type Focus } from '@/components/ms/linking';
import { deltaLookup, lowerBound, tolDa, ppmError, type Peak } from '@/lib/ms/match';
import { PRESETS, presetFor } from '@/lib/ms/presets';
import { downloadJSON } from '@/lib/export';
import { spectralCosine } from '@/lib/ms/spectrumFile';
import type { Ion, IonType } from '@/lib/ms/fragments';
import { SeriesToggles, seriesOf, ionVisible, type SeriesKey } from '@/components/ms/SeriesToggles';
import '@/components/ms/ms.css';
import { ScanChart } from './ScanChart';
import type { Input, Output, ScanGroup, SpectrumResult, Annotation } from './compute';
import type { FileInfo, SpectrumMeta } from '@/lib/ms/mzml';

const CUSTOM = new Set(['ionTypes']);
const f4 = (x: number) => x.toFixed(4);
type Override = { ionId: string | null; label?: string };
interface Assigned { peak: number; ion?: Ion; label: string; color: string; manual: boolean; isotope?: boolean; errorPpm?: number; theo?: number }

export default function Annotator({ manifest, examples, run }: ToolProps<Input, Output>) {
  const defaults = Object.fromEntries(manifest.inputs.map((i) => [i.name, i.default])) as Partial<Input>;
  const [values, setValues] = useState<Partial<Input>>(defaults);
  const [state, setState] = useState<RunState>('idle');
  const [msg, setMsg] = useState<string>();
  const [progress, setProgress] = useState(0);
  const handle = useRef<ReturnType<typeof run>>();
  // file state
  const [info, setInfo] = useState<FileInfo>();
  const [spectra, setSpectra] = useState<SpectrumMeta[]>([]);
  const [groups, setGroups] = useState<ScanGroup[]>([]);
  const [current, setCurrent] = useState<{ label: string; indices: number[]; key: string } | null>(null);
  const [spectrum, setSpectrum] = useState<SpectrumResult>();
  const [ann, setAnn] = useState<Annotation | null>(null);
  const [charges, setCharges] = useState<{ used: number | null; inferred: number | null; written: number | null }>({ used: null, inferred: null, written: null });
  const [source, setSource] = useState<{ file?: Blob | null; url?: string; name: string } | null>(null);
  // interaction
  const [selected, setSelected] = useState<number[]>([]);
  const [hoverIons, setHoverIons] = useState<string[] | null>(null);
  const [overrides, setOverrides] = useState<Map<string, Override>>(new Map());
  const [view, setView] = useState<[number, number] | undefined>();
  const [msLevel, setMsLevel] = useState<number | 'all'>(2);
  const [tableFilter, setTableFilter] = useState<'assigned' | 'unassigned' | 'all'>('assigned');
  const [custom, setCustom] = useState('');
  /** Mass-scale correction in ppm applied to all observed m/z (recalibration from assigned peaks). */
  const [calPpm, setCalPpm] = useState(0);
  const [annError, setAnnError] = useState<string | undefined>();
  /** Pinned structure selection (a cleavage or one ion) that zooms the spectrum and greys out the rest. */
  const [focus, setFocus] = useState<Focus>(null);
  const [xicText, setXicText] = useState('');
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set());
  /** Reference peak: every assigned peak shows its neutral-mass difference to it (ChemCalc-style read-off). */
  const [refPeak, setRefPeak] = useState<number | null>(null);
  const [xic, setXic] = useState<Array<{ label: string; values: Map<number, number> }>>([]);
  /** Pinned reference spectrum for a mirror comparison. */
  const [reference, setReference] = useState<{ label: string; mz: Float64Array; intensity: Float64Array } | null>(null);
  const themeTick = useThemeTick();
  const palette = useMemo(() => screenPalette(), [spectrum, themeTick]);
  const loaded = !!info;

  const shellManifest = useMemo(() => ({ ...manifest, inputs: manifest.inputs.filter((i) => !CUSTOM.has(i.name)) }), [manifest]);
  const cyclicInput = values.topology === 'cyclic' || /^\s*cyclo\(/i.test(String(values.sequence ?? ''));
  const scanAct = current ? spectra[current.indices[0]]?.activation ?? 'HCD' : 'HCD';
  const actPreset = values.activation && values.activation !== 'auto' ? values.activation : presetFor(scanAct);
  const preset = PRESETS[actPreset as keyof typeof PRESETS]?.[cyclicInput ? 'cyclic' : 'linear'] ?? [];
  /** Fragmentation method behind the automatic ion-type choice, in words. */
  const detectedText = values.activation && values.activation !== 'auto' ? `${actPreset}, set under Fragmentation` : current ? `${actPreset}, read from the scan` : `${actPreset} until a scan is open`;
  const annOpts = () => ({ ...values, topology: cyclicInput ? 'cyclic' : 'linear' } as Input);

  const exec = (input: Input, onDone: (o: Output, ms: number) => void) => {
    handle.current?.cancel();
    setState('running'); setProgress(0);
    const t0 = performance.now();
    const h = run(input, (f, m) => { setProgress(f); setMsg(m); });
    handle.current = h;
    h.promise.then((o) => { onDone(o, performance.now() - t0); setState('done'); }).catch((e) => { setState('error'); setMsg(e.message); });
  };

  // ---- Run: load a file (or the example's demo URL) ----------------------------------------------
  const onRun = () => {
    const file = (values.file as Blob | null | undefined) ?? null;
    const url = !file && values.url ? new URL(values.url, location.href).href : undefined;
    if (!file && !url) { setState('error'); setMsg('Choose a file (or switch to Example and pick one), then press Run.'); return; }
    const name = file ? (file as File).name : (values.url ?? '').split('/').pop() ?? 'demo';
    setSource({ file, url, name });
    exec({ ...annOpts(), op: 'load', file, url, fileName: name }, (o, ms) => {
      setInfo(o.info); setSpectra(o.spectra ?? []); setGroups(o.groups ?? []);
      const g = o.groups?.find((x) => x.key === o.group);
      setCurrent(g ? { label: g.label, indices: g.indices, key: g.key } : null);
      setMsLevel(g?.msLevel ?? 2);
      setSpectrum(o.spectrum); setAnn(o.annotation ?? null); setAnnError(o.annotationError); setSelected([]); setView(undefined); setCalPpm(0); setFocus(null);
      setCharges({ used: o.scanCharge ?? null, inferred: o.inferredCharge ?? null, written: o.writtenCharge ?? null });
      setOverrides(loadOverrides(name, g?.key ?? '', String(values.sequence ?? '')));
      setMsg(`${o.spectra?.length.toLocaleString()} spectra indexed · ${o.spectrum?.scans} scan(s) averaged · ${(ms / 1000).toFixed(1)} s`);
    });
  };

  const pickScans = (indices: number[], label?: string, key?: string) => {
    if (!source || !info || !indices.length) return;
    const ranges = indices.map((i) => ({ start: spectra[i].start, end: spectra[i].end, centroided: spectra[i].centroided }));
    const first = spectra[indices[0]];
    const lbl = label ?? (indices.length === 1 ? `Scan ${first.scan ?? first.index + 1}${first.rt != null ? ` · ${first.rt.toFixed(3)} min` : ''}` : `${indices.length} scans averaged`);
    exec({ ...annOpts(), op: 'spectrum', file: source.file, url: source.url, ranges, info: { format: info.format, paramGroups: info.paramGroups }, scanActivation: first.activation, scanCharge: first.charge, precursorMz: first.precursorMz }, (o, ms) => {
      setCurrent({ label: lbl, indices, key: key ?? `sel:${indices.length}:${indices[0]}` });
      setSpectrum(o.spectrum); setAnn(o.annotation ?? null); setAnnError(o.annotationError); setSelected([]); setView(undefined); setCalPpm(0); setFocus(null);
      setCharges({ used: o.scanCharge ?? null, inferred: o.inferredCharge ?? null, written: first.charge });
      setOverrides(loadOverrides(source.name, key ?? lbl, String(values.sequence ?? '')));
      setMsg(`${lbl} · ${o.spectrum?.mz.length} peaks · ${Math.round(ms)} ms`);
    });
  };

  // Re-annotate when annotation settings change after a file is loaded.
  useEffect(() => {
    if (!loaded || !spectrum) return;
    const t = setTimeout(() => {
      exec({ ...annOpts(), op: 'annotate', peaks: { mz: Array.from(spectrum.mz, (m) => m * (1 - calPpm * 1e-6)), intensity: Array.from(spectrum.intensity) }, scanActivation: scanAct, scanCharge: charges.used }, (o) => { setAnn(o.annotation ?? null); setAnnError(o.annotationError); setFocus(null); });
    }, 400);
    return () => clearTimeout(t);
  }, [calPpm, values.sequence, values.topology, values.precursorCharge, values.activation, values.ionTypes, values.tolerance, values.toleranceUnit, values.losses, values.maxLosses, values.modLosses, values.fixedMods, values.adducts, values.immonium, values.precursorIons, values.cyclicHydrolysis, values.maxFragmentCharge]);

  const runXic = () => {
    if (!source || !info) return;
    const targets = xicText.split(/[\s,;]+/).map(Number).filter((x) => x > 0);
    const level = msLevel === 'all' ? null : msLevel;
    const idx = spectra.filter((s) => level == null || s.msLevel === level).map((s) => s.index);
    const ranges = idx.map((i) => ({ start: spectra[i].start, end: spectra[i].end, centroided: spectra[i].centroided }));
    exec({ ...annOpts(), op: 'xic', file: source.file, url: source.url, ranges, info: { format: info.format, paramGroups: info.paramGroups }, xicTargets: targets, xicTolPpm: Number(values.tolerance) || 10 }, (o, ms) => {
      setXic(targets.map((t, ti) => ({ label: t.toFixed(4), values: new Map(idx.map((sIdx, k) => [sIdx, o.xic![ti][k]])) })));
      setMsg(`XIC of ${targets.length} m/z over ${idx.length} scans · ${(ms / 1000).toFixed(1)} s`);
    });
  };

  // ---- assignments ---------------------------------------------------------------------------------
  const peaks: Peak[] = useMemo(() => (spectrum ? Array.from(spectrum.mz, (mz, i) => ({ mz: mz * (1 - calPpm * 1e-6), intensity: spectrum.intensity[i] })) : []), [spectrum, calPpm]);
  /** Overrides are keyed by the uncorrected m/z so recalibration does not lose manual work. */
  const keyAt = (k: number) => (spectrum ? spectrum.mz[k].toFixed(4) : '');
  const maxI = useMemo(() => peaks.reduce((m, p) => Math.max(m, p.intensity), 0) || 1, [peaks]);
  const ionById = useMemo(() => new Map((ann?.ions ?? []).map((i) => [i.id, i])), [ann]);
  const assigned = useMemo(() => {
    const out = new Map<number, Assigned>();
    peaks.forEach((p, k) => {
      const ov = overrides.get(keyAt(k));
      if (ov) {
        if (ov.ionId && ionById.get(ov.ionId)) { const ion = ionById.get(ov.ionId)!; out.set(k, { peak: k, ion, label: ion.label, color: ionColor(palette, ion.type), manual: true, errorPpm: ppmError(p.mz, ion.mz), theo: ion.mz }); }
        else if (ov.label) out.set(k, { peak: k, label: ov.label, color: palette.accent, manual: true });
        return;
      }
      const best = ann?.match.byPeak.get(k)?.[0];
      if (best) out.set(k, { peak: k, ion: best.ion, label: best.ion.label, color: ionColor(palette, best.ion.type), manual: false, errorPpm: best.errorPpm, theo: best.ion.mz });
    });
    if (ann) for (const [k, mono] of ann.match.isotopeOf) { const a = out.get(mono); if (a && !out.has(k) && !overrides.has(keyAt(k))) out.set(k, { ...a, peak: k, label: '', isotope: true, manual: false }); }
    return out;
  }, [peaks, ann, overrides, ionById, palette]);

  const stats = useMemo(() => {
    if (!ann) return null;
    const n = ann.peptide.residues.length;
    let explained = 0, total = 0; for (const p of peaks) total += p.intensity;
    for (const a of assigned.values()) explained += peaks[a.peak].intensity;
    const ions = [...assigned.values()].filter((a) => a.ion && !a.isotope).map((a) => a.ion!);
    const obs = observedBonds(ions, ann.peptide.cyclic);
    const bonds = new Set([...obs.n, ...obs.c].map((b) => Math.floor(b / 3)));
    return { peaksAssigned: [...assigned.values()].filter((a) => !a.isotope).length, explainedPct: (explained / (total || 1)) * 100, bondsCovered: Math.min(bonds.size, ann.peptide.cyclic ? n : n - 1), bondsTotal: ann.peptide.cyclic ? n : n - 1, observed: obs };
  }, [assigned, ann, peaks]);

  // persist manual work per file + scan selection + sequence
  useEffect(() => { if (source && current) saveOverrides(source.name, current.key, String(values.sequence ?? ''), overrides); }, [overrides]);

  // ---- highlighting ---------------------------------------------------------------------------------
  const pinned = useMemo(() => (ann ? focusedIons(focus, ann.ions, ann.peptide.cyclic) : []), [focus, ann]);
  const pinnedSet = useMemo(() => new Set(pinned.map((i) => i.id)), [pinned]);
  const focusPeak = selected[selected.length - 1];
  const focusIons = useMemo(() => {
    const ids = hoverIons ?? (pinned.length ? pinned.map((i) => i.id) : focusPeak != null && assigned.get(focusPeak)?.ion ? [assigned.get(focusPeak)!.ion!.id] : []);
    return ids.map((id) => ionById.get(id)).filter(Boolean) as Ion[];
  }, [hoverIons, focusPeak, assigned, ionById, ann, pinned]);
  /** Complements of a small selection: shown as markers and peaks, without shading residues. */
  const focusPairs = useMemo(() => (ann && focusIons.length <= 3 ? focusIons.map((ion) => complementOf(ion, ann.ions, ann.peptide)).filter((c): c is Ion => !!c && !focusIons.includes(c)) : []), [focusIons, ann]);
  const structureHl = useMemo(() => {
    if (!ann) return undefined;
    const sel = [...focusIons];
    if (selected.length >= 2) for (const k of selected.slice(-2)) { const a = assigned.get(k); if (a?.ion) sel.push(a.ion); }
    return structureHighlight(sel, ann.peptide, focusPairs);
  }, [focusIons, focusPairs, selected, assigned, ann]);

  const pinnedPeaks = useMemo(() => [...assigned.values()].filter((a) => !a.isotope && a.ion && pinnedSet.has(a.ion.id)), [assigned, pinnedSet]);
  useEffect(() => {
    if (!focus) { setView(undefined); return; }
    setView(frameMz(pinnedPeaks.length ? pinnedPeaks.map((a) => peaks[a.peak].mz) : pinned.map((i) => i.mz), focus.kind === 'ion'));
  }, [focus, pinnedPeaks]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { setFocus(null); setSelected([]); } };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, []);

  const topLayer = useMemo(() => {
    const annotations = new Map<number, SpecAnnotation>();
    for (const a of assigned.values()) {
      if (a.ion && !ionVisible(a.ion, hidden)) continue;
      if (a.isotope && hidden.has('isotopes')) continue;
      const inFocus = !focus || (a.ion && pinnedSet.has(a.ion.id));
      annotations.set(a.peak, inFocus ? { label: hidden.has('labels') ? '' : a.label, color: a.color, dim: a.isotope } : { label: '', color: palette.faint, dim: true });
    }
    const highlight = new Set<number>();
    const hovered = new Set(hoverIons ?? []);
    for (const a of assigned.values()) if (a.ion && hovered.has(a.ion.id)) highlight.add(a.peak);
    return { peaks, annotations, highlight, label: current?.label };
  }, [peaks, assigned, hoverIons, current, focus, pinnedSet, palette, hidden]);
  /** Assigned ions that pass the show/hide chips: what the sequence view flags. */
  const visibleIons = useMemo(() => {
    const seen = new Map<string, Ion>();
    for (const a of assigned.values()) if (a.ion && !a.isotope && ionVisible(a.ion, hidden)) seen.set(a.ion.id, a.ion);
    return [...seen.values()];
  }, [assigned, hidden]);
  const figFamilies = useMemo(() => {
    if (!ann) return { n: [], c: [] } as ReturnType<typeof familiesFor>;
    const f = familiesFor(ann.ionTypes, ann.peptide.cyclic);
    return { n: f.n.filter((k) => !hidden.has(k)), c: f.c.filter((k) => !hidden.has(k)) };
  }, [ann, hidden]);
  const theoretical = useMemo(() => new Set<SeriesKey>([...figFamilies.n, ...figFamilies.c]), [figFamilies]);
  const presentSeries = useMemo(() => new Set([...assigned.values()].filter((a) => a.ion).map((a) => seriesOf(a.ion!))), [assigned]);
  /** Neutral mass of a peak: uses its assigned charge (or 1). */
  const neutralOf = (k: number) => { const z = assigned.get(k)?.ion?.charge ?? 1; return peaks[k].mz * z - z * 1.00727646658; };
  const refDelta = (k: number) => {
    if (refPeak == null || k === refPeak) return null;
    const d = neutralOf(k) - neutralOf(refPeak);
    const best = deltaLookup(d, Math.max(peaks[k].mz, peaks[refPeak].mz), { value: Number(values.tolerance) || 10, unit: (values.toleranceUnit ?? 'ppm') as 'ppm' | 'Da' }, 1)[0];
    return { d, best };
  };
  const topScale = focus && pinnedPeaks.length ? Math.max(...pinnedPeaks.map((a) => peaks[a.peak].intensity)) : undefined;

  // ---- Δm measurement --------------------------------------------------------------------------------
  const delta = useMemo(() => {
    if (selected.length < 2) return null;
    const [a, b] = selected.slice(-2).map((k) => peaks[k]).sort((x, y) => x.mz - y.mz);
    const tol = { value: Number(values.tolerance) || 10, unit: (values.toleranceUnit ?? 'ppm') as 'ppm' | 'Da' };
    const extra = ann ? [...new Map(ann.peptide.residues.filter((r) => r.mods.length || r.token.length > 1).map((r) => [r.token + r.mods.map((m) => m.label).join(''), { label: `${r.token}${r.mods.map((m) => `[${m.label}]`).join('')}`, mass: r.mass }])).values()] : undefined;
    return { a, b, d: b.mz - a.mz, cands: deltaLookup(b.mz - a.mz, b.mz, tol, Math.max(1, charges.used ?? 2), extra).slice(0, 14) };
  }, [selected, peaks, values.tolerance, values.toleranceUnit, ann, charges.used]);

  // ---- candidates for manual assignment of the focused peak ---------------------------------------------
  const candidates = useMemo(() => {
    if (focusPeak == null || !ann) return [];
    const mz = peaks[focusPeak].mz;
    const d = tolDa(mz, { value: (Number(values.tolerance) || 10) * 3, unit: (values.toleranceUnit ?? 'ppm') as 'ppm' | 'Da' });
    const sorted = ann.ions; // already sorted by m/z
    const out: Ion[] = [];
    for (let i = lowerBound(sorted.length, (k) => sorted[k].mz, mz - d); i < sorted.length && sorted[i].mz <= mz + d; i++) out.push(sorted[i]);
    return out.sort((x, y) => Math.abs(x.mz - mz) - Math.abs(y.mz - mz)).slice(0, 12);
  }, [focusPeak, ann, peaks, values.tolerance, values.toleranceUnit]);
  const setOverride = (k: number, o: Override | null) => {
    const m = new Map(overrides); const key = keyAt(k);
    if (o) m.set(key, o); else m.delete(key);
    setOverrides(m);
  };

  // ---- exports -------------------------------------------------------------------------------------
  const peakRows = () => peaks.map((p, k) => {
    const a = assigned.get(k);
    return { mz: +p.mz.toFixed(5), intensity: +p.intensity.toPrecision(6), rel_intensity: +((p.intensity / maxI) * 100).toFixed(2), scans_present: spectrum?.count ? spectrum.count[k] : '', assignment: a ? (a.isotope ? `${[...assigned.values()].find((x) => x.ion?.id === a.ion?.id && !x.isotope)?.label ?? ''} (13C)` : a.label) : '', ion_type: a?.ion?.type ?? '', sequence: a?.ion?.seq ?? '', theoretical_mz: a?.theo ? +a.theo.toFixed(5) : '', error_ppm: a?.errorPpm != null ? +a.errorPpm.toFixed(2) : '', source: a ? (a.manual ? 'manual' : a.isotope ? 'isotope' : 'auto') : '' };
  });
  const mgf = () => spectrum ? `BEGIN IONS\nTITLE=${source?.name ?? 'spectrum'} ${current?.label ?? ''}\n${current && spectra[current.indices[0]]?.precursorMz ? `PEPMASS=${f4(spectra[current.indices[0]].precursorMz!)}\n` : ''}${charges.used ? `CHARGE=${charges.used}+\n` : ''}${peaks.map((p) => `${p.mz.toFixed(5)} ${p.intensity.toPrecision(6)}`).join('\n')}\nEND IONS\n` : '';
  const session = () => ({ tool: manifest.id, version: manifest.version, file: source?.name, selection: current, sequence: values.sequence, settings: { ...values, file: undefined }, overrides: [...overrides].map(([mz, o]) => ({ mz, ...o })) });
  const loadSession = async (f: File | null) => {
    if (!f) return;
    const s = JSON.parse(await f.text());
    if (s.settings) setValues({ ...values, ...s.settings, file: values.file });
    if (Array.isArray(s.overrides)) setOverrides(new Map(s.overrides.map((o: { mz: string; ionId: string | null; label?: string }) => [o.mz, { ionId: o.ionId, label: o.label }])));
  };

  const activeSet = useMemo(() => new Set(current?.indices ?? []), [current]);
  const [tableInView, setTableInView] = useState(true);
  const tableRows = useMemo(() => peaks.map((p, k) => ({ p, k, a: assigned.get(k) }))
    .filter((r) => !tableInView || !view || (r.p.mz >= view[0] && r.p.mz <= view[1]))
    .filter((r) => tableFilter === 'all' || (tableFilter === 'assigned' ? r.a && !r.a.isotope : !r.a)), [peaks, assigned, tableFilter, view, tableInView]);
  const errPts = [...assigned.values()].filter((a) => a.errorPpm != null && !a.isotope);
  const errMax = Math.max(Number(values.tolerance) || 10, ...errPts.map((a) => Math.abs(a.errorPpm!)));
  // Median error of the 30 most intense automatic, unambiguous backbone assignments (robust calibration estimate).
  const medErr = (() => {
    const pts = errPts.filter((a) => !a.manual && a.ion && !a.ion.loss && a.ion.type !== 'immonium').sort((x, y) => peaks[y.peak].intensity - peaks[x.peak].intensity).slice(0, 30).map((a) => a.errorPpm!).sort((x, y) => x - y);
    return pts.length >= 5 ? pts[Math.floor(pts.length / 2)] : null;
  })();

  const header = loaded && spectrum ? (
          <div class="ms-summary">
            <dl class="ms-stat"><dt>File</dt><dd title={info!.name}>{info!.name}</dd></dl>
            <dl class="ms-stat"><dt>Spectra</dt><dd data-output="spectraCount">{spectra.length}</dd></dl>
            <dl class="ms-stat"><dt>Showing</dt><dd title={current?.label}>{current?.label}</dd></dl>
            <dl class="ms-stat"><dt>Averaged</dt><dd data-output="scansAveraged">{spectrum.scans}</dd></dl>
            <dl class="ms-stat"><dt>Peaks</dt><dd>{peaks.length}{spectrum.profile ? ' (centroided)' : ''}</dd></dl>
            <dl class="ms-stat"><dt>z</dt><dd>{charges.used ?? '–'}{charges.inferred != null && charges.written != null && charges.inferred !== charges.written ? <span class="small" style={{ color: 'var(--warn)' }}> (file says {charges.written})</span> : null}</dd></dl>
            {ann && <dl class="ms-stat"><dt>[M+{ann.precursorCharge > 1 ? ann.precursorCharge : ''}H]{ann.precursorCharge > 1 ? `${ann.precursorCharge}+` : '+'}</dt><dd data-output="precursorMz">{f4(ann.precursors[ann.precursorCharge - 1].mz)}</dd></dl>}
            {stats && <>
              <dl class="ms-stat"><dt>Assigned</dt><dd>{stats.peaksAssigned}/{peaks.length}</dd></dl>
              <dl class="ms-stat"><dt>Intensity</dt><dd>{stats.explainedPct.toFixed(1)}%</dd></dl>
              <dl class="ms-stat"><dt>Bonds</dt><dd>{stats.bondsCovered}/{stats.bondsTotal}</dd></dl>
              {ann?.coverage.chanceMatches != null && <dl class="ms-stat" title="Peaks expected to match by chance at this tolerance (ions shifted by ±7.7/11.3/17.1 Da)"><dt>Chance</dt><dd>≈{Math.round(ann.coverage.chanceMatches)}</dd></dl>}
            </>}
          </div>
  ) : null;

  return (
    <ToolShell manifest={shellManifest} examples={examples} values={values} state={state} message={msg} progress={progress} header={header}
      onChange={(k, v) => setValues({ ...values, [k]: v })} onLoadExample={(ex) => setValues({ ...defaults, ...ex.input })} onRun={onRun}
      sourceChoice={{ onChange: (mode) => setValues((v) => (mode === 'file' ? { ...v, url: undefined } : { ...v, file: null })) }} onCancel={() => { handle.current?.cancel(); setState('idle'); }}
      extraInputs={<>
        <IonTypePicker cyclic={cyclicInput} value={(values.ionTypes ?? []) as IonType[]} preset={preset} detected={detectedText} onChange={(v) => setValues({ ...values, ionTypes: v })} help={manifest.inputs.find((i) => i.name === 'ionTypes')!.help} />
        <p class="small faint" style={{ margin: 0 }}>Files are read locally and never uploaded. Vendor files (.raw, .d): convert them first with the <a href="/tools/ms-file-converter/">MS File Converter</a> or <code>msconvert --mzML --zlib</code>.</p>
      </>}>
      {loaded && spectrum && (
        <div class="ms-tool">
          <Panel id="annotator:scans" title="Scans">
            <div class="fig-bar">
              <span class="small muted">{info!.format}{info!.indexed ? ' (indexed)' : ''} · {info!.software.slice(0, 2).join(', ')}{info!.instrument ? ` · ${info!.instrument}` : ''}</span>
              <span class="spacer" />
              <select class="input-sm" value={String(msLevel)} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; setMsLevel(v === 'all' ? 'all' : Number(v)); }} aria-label="MS level shown">
                <option value="all">All levels</option><option value="1">MS1</option><option value="2">MS2</option><option value="3">MS3</option>
              </select>
              <button type="button" class="btn-sm" disabled={!groups[0] || current?.key === groups[0].key} onClick={() => groups[0] && pickScans(groups[0].indices.slice(0, 5000), `${groups[0].label} · ${groups[0].indices.length} scans`, groups[0].key)} title="Average all scans of the main precursor group again">Reset</button>
            </div>
            <>
            <div class="scan-groups">
              {groups.slice(0, 12).map((g) => (
                <button type="button" class="btn-sm" aria-pressed={current?.key === g.key} onClick={() => pickScans(g.indices.slice(0, 5000), `${g.label} · ${g.indices.length} scans`, g.key)}>
                  {g.label} <span class="muted">×{g.indices.length}</span>
                </button>
              ))}
              {groups.length > 12 && <span class="small muted">+{groups.length - 12} more groups (pick scans in the strip)</span>}
            </div>
            <ScanChart spectra={spectra} active={activeSet} msLevel={msLevel} onPick={(idx) => pickScans(idx)} xic={xic} />
            <div class="ts-bar" style={{ padding: '0 var(--space-3) var(--space-2)' }}>
              <input class="input-sm" placeholder="XIC m/z, e.g. 589.2729 1046.54" value={xicText} onInput={(e) => setXicText((e.target as HTMLInputElement).value)} aria-label="m/z values for an extracted-ion chromatogram" onKeyDown={(e) => e.key === 'Enter' && runXic()} />
              <button type="button" class="btn-sm" disabled={!xicText.trim()} onClick={runXic}>Show XIC</button>
              {xic.length > 0 && <button type="button" class="btn-sm" onClick={() => setXic([])}>Clear XIC</button>}
              <span class="spacer" />
              {reference
                ? <><span class="small muted">Reference: {reference.label} · cosine {spectralCosine(spectrum, reference, Number(values.tolerance) || 10).toFixed(3)}</span><button type="button" class="btn-sm" onClick={() => setReference(null)}>Clear reference</button></>
                : <button type="button" class="btn-sm" onClick={() => setReference({ label: current?.label ?? 'reference', mz: spectrum.mz, intensity: spectrum.intensity })} title="Keep this spectrum and compare it (mirrored below) with the next one you open">Pin as reference</button>}
            </div>
            <p class="small faint" style={{ margin: '0 var(--space-3) var(--space-2)' }}>Click a scan to view it; drag across scans to average them; buttons average a whole precursor group.</p>
            </>
          </Panel>

          <Panel id="annotator:spectrum" title="Spectrum">
            <SeriesToggles present={presentSeries} hidden={hidden} onChange={setHidden} palette={palette} />
            <SpectrumCanvas hideUnassigned={hidden.has('unassigned')} top={topLayer} height={reference ? 460 : 380} mirror={reference ? { peaks: Array.from(reference.mz, (mz, i) => ({ mz, intensity: reference.intensity[i] })), label: `Reference: ${reference.label}` } : undefined} title={current?.label ?? 'Spectrum'} filename={`${(source?.name ?? 'spectrum').replace(/\.[^.]+$/, '')}-annotated`}
              selected={selected} view={view} onView={setView} topScale={topScale}
              measureLabel={delta ? `Δ ${delta.d.toFixed(4)}${delta.cands[0] ? ` · ${delta.cands[0].label}${delta.cands[0].charge > 1 ? ` (${delta.cands[0].charge}+)` : ''}` : ''}` : undefined}
              markers={current && spectra[current.indices[0]]?.precursorMz ? [{ mz: spectra[current.indices[0]].precursorMz!, label: 'precursor' }] : []}
              labelUnassigned={!ann}
              onHover={(h) => { const a = h ? assigned.get(h.index) : undefined; setHoverIons(a?.ion ? [a.ion.id] : null); }}
              onPeakClick={(h, e) => setSelected((s) => (e.shift ? [...s.slice(-1), h.index] : s.length === 1 && s[0] === h.index ? [] : [h.index]))} />
            <div class="ms-info">
              {focusPeak != null ? (<>
                <span class="mono"><strong>m/z {peaks[focusPeak].mz.toFixed(4)}</strong></span>
                <span class="small muted">{((peaks[focusPeak].intensity / maxI) * 100).toFixed(1)}%{spectrum.count ? ` · in ${spectrum.count[focusPeak]}/${spectrum.scans} scans` : ''}</span>
                {assigned.get(focusPeak) && <span style={{ color: assigned.get(focusPeak)!.color, fontWeight: 700 }}>{assigned.get(focusPeak)!.label || 'isotope'}{assigned.get(focusPeak)!.manual ? ' (manual)' : ''}</span>}
                {assigned.get(focusPeak)?.errorPpm != null && <span class="small">{assigned.get(focusPeak)!.errorPpm!.toFixed(1)} ppm</span>}
                <span class="small faint">shift-click another peak to measure the gap</span>
                <span class="spacer" />
                {refPeak === focusPeak
                  ? <button type="button" class="btn-sm" onClick={() => setRefPeak(null)}>Clear reference peak</button>
                  : <button type="button" class="btn-sm" onClick={() => setRefPeak(focusPeak)} title="Show every peak's mass difference to this peak in the table, with the residue that explains it">Set as reference peak</button>}
              </>) : <span class="small muted">Click a peak to inspect or assign it; shift-click a second peak to measure the mass difference.</span>}
            </div>
          </Panel>

          {(delta || (focusPeak != null && ann)) && (
            <div class="ms-grid-2">
              {focusPeak != null && ann && (
                <Panel id="annotator:assign" title="Assign peak">
                  <div class="fig-bar"><strong>Assign m/z {peaks[focusPeak].mz.toFixed(4)}</strong><span class="spacer" />
                    <button type="button" class="btn-sm" onClick={() => setOverride(focusPeak, { ionId: null })}>Unassign</button>
                    {overrides.has(keyAt(focusPeak)) && <button type="button" class="btn-sm" onClick={() => setOverride(focusPeak, null)}>Reset to auto</button>}
                  </div>
                  <div class="results-table" style={{ maxHeight: '240px', border: 0 }}>
                    <table class="ion-list"><thead><tr><th>Ion</th><th>Sequence</th><th>m/z</th><th>ppm</th><th /></tr></thead><tbody>
                      {candidates.map((ion) => (
                        <tr class={assigned.get(focusPeak)?.ion?.id === ion.id ? 'matched' : ''} onMouseEnter={() => setHoverIons([ion.id])} onMouseLeave={() => setHoverIons(null)}>
                          <td style={{ color: ionColor(palette, ion.type), fontWeight: 600 }}>{ion.label}</td><td class="mono small">{ion.seq}</td><td class="mono">{f4(ion.mz)}</td><td class="mono">{ppmError(peaks[focusPeak].mz, ion.mz).toFixed(1)}</td>
                          <td><button type="button" class="btn-sm" onClick={() => setOverride(focusPeak, { ionId: ion.id })}>Assign</button></td>
                        </tr>
                      ))}
                      {!candidates.length && <tr><td colSpan={5} class="small muted">No theoretical ion within 3× the tolerance.</td></tr>}
                    </tbody></table>
                  </div>
                  <div class="ts-bar" style={{ padding: 'var(--space-2) var(--space-3)' }}>
                    <input class="input-sm" placeholder="Custom label, e.g. b5* or contaminant" value={custom} onInput={(e) => setCustom((e.target as HTMLInputElement).value)} aria-label="Custom label" />
                    <button type="button" class="btn-sm" disabled={!custom.trim()} onClick={() => { setOverride(focusPeak, { ionId: null, label: custom.trim() }); setCustom(''); }}>Label</button>
                  </div>
                </Panel>
              )}
              {delta && (
                <Panel id="annotator:delta" title="Mass difference">
                  <div class="fig-bar"><strong>Δm/z {delta.d.toFixed(4)}</strong><span class="small muted">{f4(delta.a.mz)} → {f4(delta.b.mz)}</span></div>
                  <div class="results-table" style={{ maxHeight: '280px', border: 0 }}>
                    <table class="ion-list"><thead><tr><th>Candidate</th><th>Kind</th><th>z</th><th>Mass</th><th>Error (mDa)</th><th>ppm</th></tr></thead><tbody>
                      {delta.cands.map((c) => <tr><td><strong>{c.label}</strong></td><td class="small muted">{c.kind}</td><td>{c.charge}+</td><td class="mono">{c.mass.toFixed(4)}</td><td class="mono">{(c.errorDa * 1000).toFixed(2)}</td><td class="mono">{c.errorPpm.toFixed(1)}</td></tr>)}
                      {!delta.cands.length && <tr><td colSpan={6} class="small muted">No residue, dipeptide or common loss within tolerance.</td></tr>}
                    </tbody></table>
                  </div>
                </Panel>
              )}
            </div>
          )}

          <Panel id="annotator:structure" title="Structure">
            {ann ? (<>
              <SeriesToggles present={presentSeries} hidden={hidden} onChange={setHidden} palette={palette} />
              <PeptideStructure peptide={ann.peptide} families={figFamilies} observed={stats?.observed} highlight={structureHl} filename={`${manifest.id}-structure`}
                ions={visibleIons} theoretical={theoretical} hoverIds={hoverIons ?? undefined}
                onHover={(m) => setHoverIons(m ? (m.ids ? m.ids : m.label ? [ionForLabel(ann.ions, m.type, m.size, m.side, ann.peptide.cyclic, m.bond)?.id].filter(Boolean) as string[] : ionsForMarker(ann.ions, m.bond, m.side, ann.peptide.cyclic).filter((i) => [...assigned.values()].some((a) => a.ion?.id === i.id)).map((i) => i.id)) : null)}
                onClick={(m) => {
                  if (m.ids?.length) { const id = [...m.ids].sort((x, y) => (ionById.get(x)?.charge ?? 9) - (ionById.get(y)?.charge ?? 9))[0]; setFocus((f) => (f?.kind === 'ion' && f.id === id ? null : { kind: 'ion', id })); return; }
                  if (m.label) { const ion = ionForLabel(ann.ions, m.type, m.size, m.side, ann.peptide.cyclic, m.bond); setFocus((f) => (ion && !(f?.kind === 'ion' && f.id === ion.id) ? { kind: 'ion', id: ion.id } : null)); return; }
                  setFocus((f) => (f?.kind === 'bond' && f.bond === m.bond && f.side === m.side ? null : { kind: 'bond', bond: m.bond, side: m.side }));
                }} />
              <div class="ms-info">
                <span class="small muted">{focus ? `${pinnedPeaks.length} assigned peak${pinnedPeaks.length === 1 ? '' : 's'} for this ${focus.kind === 'bond' ? 'cleavage' : 'ion'}` : 'Click a cleavage line to show only its fragments in the spectrum, or an ion label (b₃, y₅…) to zoom to that ion.'}</span>
                {focus && <><span class="spacer" /><button type="button" class="btn-sm" onClick={() => setFocus(null)}>Clear selection (Esc)</button></>}
              </div>
            </>) : (
              <div class="ms-empty">
                <strong>Peptide structure</strong>
                <p class="small muted">{annError ? <span style={{ color: 'var(--err)' }}>Could not annotate: {annError}</span> : 'Enter the peptide sequence on the left (e.g. cyclo(V(Orn)LfPV(Orn)LfP) or DRVYIHPF) to draw its structure and annotate this spectrum. Changes apply immediately.'}</p>
              </div>
            )}
          </Panel>

          <div class="ms-grid-2">
            <Panel id="annotator:peaks" title="Peaks" class="ion-table">
              <div class="ts-bar">
                <strong class="small">Peaks</strong>
                <div class="seg" role="group" aria-label="Peak filter">
                  {(['assigned', 'unassigned', 'all'] as const).map((f) => <button type="button" class="btn-sm" aria-pressed={tableFilter === f} onClick={() => setTableFilter(f)}>{f}</button>)}
                </div>
                <span class="small muted">{tableRows.length} rows</span>
                {view && <label class="small"><input type="checkbox" checked={tableInView} onChange={(e) => setTableInView((e.target as HTMLInputElement).checked)} style={{ width: 'auto' }} /> in view only</label>}
              </div>
              <div class="results-table">
                <table class="ion-list"><thead><tr><th>m/z</th><th>Rel. %</th><th>Assignment</th><th>Theo.</th><th>ppm</th>{refPeak != null && <th title={`Neutral-mass difference to the reference peak m/z ${peaks[refPeak]?.mz.toFixed(4)}`}>Δ ref</th>}<th /></tr></thead><tbody>
                  {tableRows.slice(0, 1500).map(({ p, k, a }) => (
                    <tr class={`${a ? 'matched' : ''}${selected.includes(k) ? ' hl' : ''}`} onClick={() => { setSelected([k]); setView([p.mz - 15, p.mz + 15]); }}
                      onMouseEnter={() => setHoverIons(a?.ion ? [a.ion.id] : null)} onMouseLeave={() => setHoverIons(null)} style={a?.ion && !ionVisible(a.ion, hidden) ? { opacity: 0.4 } : undefined}>
                      <td class="mono">{p.mz.toFixed(4)}</td><td class="mono">{((p.intensity / maxI) * 100).toFixed(1)}</td>
                      <td style={{ color: a?.color, fontWeight: 600 }}>{a ? (a.isotope ? '¹³C' : a.label) : ''}</td>
                      <td class="mono">{a?.theo ? f4(a.theo) : ''}</td><td class="mono">{a?.errorPpm != null ? a.errorPpm.toFixed(1) : ''}</td>
                      {refPeak != null && (() => { const r = refDelta(k); return <td class="mono small">{k === refPeak ? 'ref' : r ? <>{r.d >= 0 ? '+' : ''}{r.d.toFixed(4)}{r.best ? <strong> {r.best.label}</strong> : null}</> : ''}</td>; })()}
                      <td class="small muted">{a?.manual ? 'manual' : ''}</td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            </Panel>
            <Panel id="annotator:error" title="Mass error">
              <div class="fig-bar"><strong>Mass error</strong><span class="small muted">{errPts.length} assigned · median {medErr != null ? `${medErr.toFixed(2)} ppm` : '–'}{calPpm ? ` · corrected by ${(-calPpm).toFixed(2)} ppm` : ''}</span><span class="spacer" />
                {medErr != null && Math.abs(medErr) > 0.3 && <button type="button" class="btn-sm" onClick={() => setCalPpm(calPpm + medErr)} title="Shift all observed m/z by the median error of the strongest assignments, then consider a tighter tolerance">Recalibrate</button>}
                {calPpm !== 0 && <button type="button" class="btn-sm" onClick={() => setCalPpm(0)}>Undo</button>}
              </div>
              <svg viewBox="0 0 400 200" class="err-plot" role="img" aria-label="Mass error of assigned peaks versus m/z">
                {(() => {
                  const lo = peaks[0]?.mz ?? 0, hi = peaks[peaks.length - 1]?.mz ?? 1;
                  const X = (mz: number) => 40 + ((mz - lo) / (hi - lo || 1)) * 350, Y = (e: number) => 100 - (e / errMax) * 85;
                  return <>
                    <line x1="40" y1="100" x2="390" y2="100" stroke="var(--line-strong)" />
                    <line x1="40" y1="15" x2="40" y2="185" stroke="var(--line-strong)" />
                    <text x="34" y="18" text-anchor="end" font-size="10" fill="var(--fg-muted)">+{errMax.toFixed(0)}</text>
                    <text x="34" y="188" text-anchor="end" font-size="10" fill="var(--fg-muted)">−{errMax.toFixed(0)}</text>
                    <text x="34" y="104" text-anchor="end" font-size="10" fill="var(--fg-muted)">0</text>
                    <text x="215" y="198" text-anchor="middle" font-size="10" fill="var(--fg-muted)">m/z (ppm error vs theoretical)</text>
                    {errPts.map((a) => <circle cx={X(peaks[a.peak].mz)} cy={Y(a.errorPpm!)} r={2 + 4 * Math.sqrt(peaks[a.peak].intensity / maxI)} fill={a.color} fill-opacity="0.7" />)}
                  </>;
                })()}
              </svg>
            </Panel>
          </div>

          <div class="ts-bar">
            <ExportMenu filename={`${(source?.name ?? 'spectrum').replace(/\.[^.]+$/, '')}-peaks`} rows={peakRows()} json={session()} text={mgf()} formats={['csv', 'tsv', 'json', 'txt']} />
            <button type="button" class="btn-sm" onClick={() => downloadJSON(`${(source?.name ?? 'spectrum').replace(/\.[^.]+$/, '')}-session.json`, session())}>Save session</button>
            <label class="btn btn-sm">Load session<input type="file" accept=".json" style={{ display: 'none' }} onChange={(e) => loadSession((e.target as HTMLInputElement).files?.[0] ?? null)} /></label>
          </div>
          <p class="small faint" style={{ margin: 0 }}>JSON = session (settings + manual assignments); TXT = the current (averaged) spectrum as MGF. Manual assignments are also remembered in this browser for this file and scan selection.</p>
        </div>
      )}
    </ToolShell>
  );
}

// ---- per-browser persistence of manual assignments (localStorage, best effort) ----------------------
const storeKey = (file: string, sel: string, seq: string) => `crt:mzml-annotator:${file}|${sel}|${seq}`;
function loadOverrides(file: string, sel: string, seq: string): Map<string, Override> {
  try { const raw = localStorage.getItem(storeKey(file, sel, seq)); return raw ? new Map(JSON.parse(raw)) : new Map(); } catch { return new Map(); }
}
function saveOverrides(file: string, sel: string, seq: string, m: Map<string, Override>) {
  try { if (m.size) localStorage.setItem(storeKey(file, sel, seq), JSON.stringify([...m])); else localStorage.removeItem(storeKey(file, sel, seq)); } catch { /* storage unavailable */ }
}
