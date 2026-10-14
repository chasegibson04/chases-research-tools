// mzML / MGF spectrum viewer and MS/MS annotator. Runs in a Web Worker; the file never leaves the computer.
// Operations (the UI calls run() several times; each call is a fresh worker, so state travels in the input):
//   load      index the file, group scans, average the largest MS2 group, annotate if a sequence is given
//   spectrum  read + average a chosen set of scans
//   annotate  match a peak list against theoretical fragments (same chemistry as the fragment predictor)
import type { ComputeFn, ComputeContext } from '@/lib/types';
import { parseSequence, type Peptide } from '@/lib/ms/sequence';
import { generateFragments, peptideMass, type Ion, type IonType } from '@/lib/ms/fragments';
import { matchPeaks, coverage, type Coverage, type MatchResult, type Peak } from '@/lib/ms/match';
import { PRESETS, presetFor, parseFixedMods } from '@/lib/ms/presets';
import { formatFormula, PROTON } from '@/lib/ms/elements';
import type { Activation } from '@/lib/ms/predict';
import { indexSpectra, parseSpectrumText, type FileInfo, type SpectrumMeta, type RawSpectrum } from './mzml';
import { averageSpectra, centroid, looksProfile, filterPeaks } from './average';

export interface AnnotateOptions {
  sequence?: string;
  topology?: 'linear' | 'cyclic';
  /** 0 = use the charge from the file (or 2 if missing). */
  precursorCharge?: number;
  /** 'auto' = from the scan's activation. */
  activation?: Activation | 'auto';
  ionTypes?: IonType[];
  maxFragmentCharge?: number;
  losses?: boolean;
  maxLosses?: number;
  modLosses?: boolean;
  fixedMods?: string;
  adducts?: string[];
  immonium?: boolean;
  precursorIons?: boolean;
  cyclicHydrolysis?: boolean;
  tolerance?: number;
  toleranceUnit?: 'ppm' | 'Da';
}

export interface Input extends AnnotateOptions {
  op?: 'load' | 'spectrum' | 'annotate';
  file?: Blob | null;
  url?: string;
  fileName?: string;
  /** spectrum op: which spectra (from a previous load) */
  ranges?: Array<{ start: number; end: number; centroided: boolean | null }>;
  info?: Pick<FileInfo, 'format' | 'paramGroups'>;
  scanActivation?: string;
  scanCharge?: number | null;
  precursorMz?: number | null;
  averageTolPpm?: number;
  minFraction?: number;
  minRelIntensity?: number;
  /** annotate op */
  peaks?: { mz: number[]; intensity: number[] };
}

export interface ScanGroup { key: string; msLevel: number; precursorMz: number | null; activation: string; energy: number | null; charge: number | null; indices: number[]; label: string }

export interface SpectrumResult { mz: Float64Array; intensity: Float64Array; count?: Uint16Array; scans: number; profile: boolean; points: number }

export interface Annotation {
  peptide: Peptide; mono: number; formula: string; precursorCharge: number; activation: Activation;
  precursors: Array<{ z: number; mz: number }>; ions: Ion[]; ionTypes: IonType[]; match: MatchResult; coverage: Coverage;
}

export interface Output {
  op: 'load' | 'spectrum' | 'annotate';
  info?: FileInfo;
  spectra?: SpectrumMeta[];
  groups?: ScanGroup[];
  group?: string;
  spectrum?: SpectrumResult;
  annotation?: Annotation | null;
  /** Echo of the scan context used for annotation. */
  scanActivation?: string;
  scanCharge?: number | null;
  inferredCharge?: number | null;
  writtenCharge?: number | null;
}

const MAX_SCANS = 5000;

export function groupScans(spectra: SpectrumMeta[]): ScanGroup[] {
  const map = new Map<string, ScanGroup>();
  for (const s of spectra) {
    const key = s.msLevel === 1 ? 'MS1' : `MS${s.msLevel}|${s.precursorMz?.toFixed(2)}|${s.activation}|${s.energy ?? ''}`;
    let g = map.get(key);
    if (!g) {
      const lbl = s.msLevel === 1 ? 'MS1 scans' : `MS${s.msLevel} ${s.precursorMz?.toFixed(4) ?? '?'} · ${s.activation}${s.energy != null ? ` ${s.energy}` : ''}`;
      g = { key, msLevel: s.msLevel, precursorMz: s.precursorMz, activation: s.activation, energy: s.energy, charge: s.charge, indices: [], label: lbl };
      map.set(key, g);
    }
    g.indices.push(s.index);
  }
  return [...map.values()].sort((a, b) => (b.msLevel > 1 ? 1 : 0) - (a.msLevel > 1 ? 1 : 0) || b.indices.length - a.indices.length);
}

/** Read several spectra, merging nearby byte ranges into one read (consecutive direct-infusion scans). */
async function readMany(file: Blob, ranges: NonNullable<Input['ranges']>, info: NonNullable<Input['info']>, ctx: ComputeContext): Promise<RawSpectrum[]> {
  const out: RawSpectrum[] = new Array(ranges.length);
  const order = ranges.map((r, i) => ({ ...r, i })).sort((a, b) => a.start - b.start);
  let k = 0;
  while (k < order.length) {
    let j = k; const blockStart = order[k].start; let blockEnd = order[k].end;
    while (j + 1 < order.length && order[j + 1].start - blockEnd < 64 * 1024 && order[j + 1].end - blockStart < 48 * 1024 * 1024) { j++; blockEnd = order[j].end; }
    const text = new TextDecoder('latin1').decode(await file.slice(blockStart, blockEnd).arrayBuffer());
    for (let q = k; q <= j; q++) {
      if (ctx.signal.aborted) throw new Error('Cancelled.');
      const r = order[q];
      let s = parseSpectrumText(text.slice(r.start - blockStart, r.end - blockStart), info);
      if (looksProfile(s, r.centroided)) s = centroid(s);
      out[r.i] = s;
    }
    ctx.progress(0.35 + 0.45 * ((j + 1) / order.length), `Reading spectra ${j + 1}/${order.length}`);
    k = j + 1;
  }
  return out;
}

async function averageRanges(file: Blob, input: Input, ctx: ComputeContext): Promise<SpectrumResult> {
  const ranges = (input.ranges ?? []).slice(0, MAX_SCANS);
  if (!ranges.length) throw new Error('No scans selected.');
  const raws = await readMany(file, ranges, input.info!, ctx);
  const profile = ranges.some((r) => r.centroided === false);
  ctx.progress(0.85, `Averaging ${raws.length} scan${raws.length > 1 ? 's' : ''}`);
  const avg = averageSpectra(raws, Number(input.averageTolPpm) || 10, raws.length > 1 ? Math.max(0, Math.min(1, input.minFraction ?? 0.3)) : 0);
  const filtered = filterPeaks(avg, Math.max(0, Number(input.minRelIntensity) || 0) / 100);
  return { mz: filtered.mz, intensity: filtered.intensity, count: avg.count && filtered.mz.length === avg.mz.length ? avg.count : undefined, scans: raws.length, profile, points: raws.reduce((n, r) => n + r.mz.length, 0) };
}

export function annotate(peaks: Peak[], o: AnnotateOptions, scanActivation = 'HCD', scanCharge: number | null = null): Annotation | null {
  const seq = String(o.sequence ?? '').trim();
  if (!seq) return null;
  const cyclic = o.topology === 'cyclic' || /^cyclo\(/i.test(seq);
  const peptide = parseSequence(seq, { cyclic, fixedMods: parseFixedMods(o.fixedMods) });
  const activation: Activation = !o.activation || o.activation === 'auto' ? presetFor(scanActivation) : o.activation;
  const z = Math.max(1, Math.min(10, Math.floor(Number(o.precursorCharge) || scanCharge || 2)));
  const ionTypes = (o.ionTypes?.length ? o.ionTypes : PRESETS[activation][peptide.cyclic ? 'cyclic' : 'linear']) as IonType[];
  const losses = o.losses !== false;
  const ions = generateFragments(peptide, {
    ionTypes, maxCharge: Math.max(1, Number(o.maxFragmentCharge) || 2), precursorCharge: z,
    losses: { h2o: losses, nh3: losses, mod: o.modLosses !== false, maxLosses: losses ? Math.max(1, Math.min(3, Number(o.maxLosses) || 2)) : 1 },
    adducts: o.adducts ?? [], immonium: o.immonium !== false, precursor: o.precursorIons !== false, cyclicHydrolysis: !!o.cyclicHydrolysis,
  });
  const tol = { value: Math.max(0.0001, Number(o.tolerance) || 10), unit: (o.toleranceUnit === 'Da' ? 'Da' : 'ppm') as 'ppm' | 'Da' };
  const match = matchPeaks(peaks, ions, tol);
  const { mono, formula } = peptideMass(peptide);
  return {
    peptide, mono, formula: formatFormula(formula), precursorCharge: z, activation,
    precursors: Array.from({ length: z }, (_, i) => ({ z: i + 1, mz: (mono + (i + 1) * PROTON) / (i + 1) })),
    ions, ionTypes, match, coverage: coverage(peaks, ions, match, peptide.residues.length, peptide.cyclic),
  };
}

/**
 * Precursor charge from the residual precursor isotope envelope in an MS2 spectrum: look for peaks at
 * precursor + k·1.00336/z (k = 1, 2) within 10 ppm and return the highest z with a consistent series.
 * Thermo converters often write a wrong charge state, so this is offered as the default.
 */
export function inferCharge(s: { mz: ArrayLike<number>; intensity: ArrayLike<number> }, precMz: number | null, maxZ = 6): number | null {
  if (!precMz) return null;
  const find = (target: number) => {
    const tol = target * 10e-6; let best = -1, bi = 0;
    for (let i = 0; i < s.mz.length; i++) if (Math.abs(s.mz[i] - target) <= tol && s.intensity[i] > bi) { bi = s.intensity[i]; best = i; }
    return best;
  };
  const mono = find(precMz);
  if (mono < 0) return null;
  for (let z = maxZ; z >= 1; z--) {
    const k1 = find(precMz + 1.003355 / z);
    if (k1 >= 0 && s.intensity[k1] < s.intensity[mono] * 3) {
      if (z === 1 || find(precMz + 1.003355 / (2 * z)) < 0) return z; // reject z if a half-spacing peak exists (then it is 2z)
    }
  }
  return null;
}

const toPeaks = (s: { mz: ArrayLike<number>; intensity: ArrayLike<number> }): Peak[] => Array.from({ length: s.mz.length }, (_, i) => ({ mz: s.mz[i], intensity: s.intensity[i] }));

async function sourceOf(input: Input): Promise<Blob> {
  if (input.file) return input.file;
  if (input.url) {
    const r = await fetch(input.url);
    if (!r.ok) throw new Error(`Could not load the demo file (${r.status}).`);
    return await r.blob();
  }
  throw new Error('Choose an mzML or MGF file (it is read locally and never uploaded).');
}

const run: ComputeFn<Input, Output> = async (input, ctx) => {
  const op = input.op ?? 'load';
  if (op === 'annotate') {
    const peaks = toPeaks({ mz: input.peaks?.mz ?? [], intensity: input.peaks?.intensity ?? [] });
    return { op, annotation: annotate(peaks, input, input.scanActivation, input.scanCharge ?? null) };
  }
  const file = await sourceOf(input);
  if (op === 'spectrum') {
    const spectrum = await averageRanges(file, input, ctx);
    const inferred = inferCharge(spectrum, input.precursorMz ?? null);
    ctx.progress(0.95, 'Annotating');
    const charge = Number(input.precursorCharge) || inferred || input.scanCharge || null;
    return { op, spectrum, annotation: annotate(toPeaks(spectrum), input, input.scanActivation, charge), inferredCharge: inferred, scanCharge: charge };
  }
  ctx.progress(0.01, 'Indexing');
  const name = input.fileName || (file as File).name || input.url?.split('/').pop() || 'spectra';
  const { info, spectra } = await indexSpectra(file, name, (f) => ctx.progress(0.02 + 0.33 * f, `Indexing ${Math.round(f * 100)}%`), ctx.signal);
  const groups = groupScans(spectra);
  const g = groups[0];
  const ranges = g.indices.slice(0, MAX_SCANS).map((i) => ({ start: spectra[i].start, end: spectra[i].end, centroided: spectra[i].centroided }));
  const spectrum = await averageRanges(file, { ...input, ranges, info }, ctx);
  const inferred = g.msLevel > 1 ? inferCharge(spectrum, g.precursorMz) : null;
  const charge = Number(input.precursorCharge) || inferred || g.charge || null;
  ctx.progress(0.95, 'Annotating');
  const annotation = annotate(toPeaks(spectrum), input, g.activation, charge);
  return { op, info, spectra, groups, group: g.key, spectrum, annotation, scanActivation: g.activation, scanCharge: charge, inferredCharge: inferred, writtenCharge: g.charge };
};
export default run;
