// mzML / MGF spectrum viewer and MS/MS annotator. Runs in a Web Worker; the file never leaves the computer.
// Operations (the UI calls run() several times; each call is a fresh worker, so state travels in the input):
//   load      index the file, group scans, average the largest MS2 group, annotate if a sequence is given
//   spectrum  read + average a chosen set of scans
//   annotate  match a peak list against theoretical fragments (same chemistry as the fragment predictor)
import type { ComputeFn, ComputeContext } from '@/lib/types';
import { parseSequence, type Peptide } from '@/lib/ms/sequence';
import { generateFragments, peptideMass, type Ion, type IonType } from '@/lib/ms/fragments';
import { matchPeaks, coverage, deisotope, decoyMatches, type Coverage, type MatchResult, type Peak } from '@/lib/ms/match';
import { PRESETS, presetFor, parseFixedMods } from '@/lib/ms/presets';
import { formatFormula, PROTON } from '@/lib/ms/elements';
import type { Activation } from '@/lib/ms/predict';
import { indexSpectra, openSource, type FileInfo, type SpectrumMeta } from '@/lib/ms/mzml';
import { groupScans, averageRanges, inferCharge, MAX_SCANS, type ScanGroup, type SpectrumResult } from '@/lib/ms/spectrumFile';
export { groupScans, inferCharge, type ScanGroup, type SpectrumResult };

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
  scrambling?: boolean;
  sideChainLosses?: boolean;
  /** Detect ¹³C envelopes and only match ions at the charge the envelope shows. */
  deisotope?: boolean;
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
  /** Ion-mobility window "lo-hi" (e.g. "0.85-1.05"); empty = all. Applied before centroiding/averaging. */
  mobilityWindow?: string;
  /** annotate op */
  peaks?: { mz: number[]; intensity: number[] };
}

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
  /** Readable reason when a sequence was given but could not be annotated (bad residue, mod, …). */
  annotationError?: string;
  /** Echo of the scan context used for annotation. */
  scanActivation?: string;
  scanCharge?: number | null;
  inferredCharge?: number | null;
  writtenCharge?: number | null;
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
    losses: { h2o: losses, nh3: losses, mod: o.modLosses !== false, sideChain: !!o.sideChainLosses, maxLosses: losses ? Math.max(1, Math.min(3, Number(o.maxLosses) || 2)) : 1 },
    adducts: o.adducts ?? [], immonium: o.immonium !== false, precursor: o.precursorIons !== false, cyclicHydrolysis: !!o.cyclicHydrolysis, scrambling: !!o.scrambling,
  });
  const tol = { value: Math.max(0.0001, Number(o.tolerance) || 10), unit: (o.toleranceUnit === 'Da' ? 'Da' : 'ppm') as 'ppm' | 'Da' };
  const iso = o.deisotope !== false ? deisotope(peaks, tol, Math.max(1, Math.min(6, z))) : null;
  const match = matchPeaks(peaks, ions, tol, { peakCharge: iso?.charge });
  const { mono, formula } = peptideMass(peptide);
  return {
    peptide, mono, formula: formatFormula(formula), precursorCharge: z, activation,
    precursors: Array.from({ length: z }, (_, i) => ({ z: i + 1, mz: (mono + (i + 1) * PROTON) / (i + 1) })),
    ions, ionTypes, match, coverage: { ...coverage(peaks, ions, match, peptide.residues.length, peptide.cyclic), chanceMatches: decoyMatches(peaks, ions, tol) },
  };
}

/** Annotation never fails the whole operation: errors come back as a message for the structure panel. */
function safeAnnotate(peaks: Peak[], o: AnnotateOptions, act?: string, z?: number | null): { annotation: Annotation | null; annotationError?: string } {
  try { return { annotation: annotate(peaks, o, act, z ?? null) }; } catch (e) { return { annotation: null, annotationError: (e as Error).message }; }
}

export function parseWindow(s?: string): [number, number] | null {
  const m = /^\s*([\d.]+)\s*[-–:]\s*([\d.]+)\s*$/.exec(s ?? '');
  return m ? [Math.min(Number(m[1]), Number(m[2])), Math.max(Number(m[1]), Number(m[2]))] : null;
}

const toPeaks = (s: { mz: ArrayLike<number>; intensity: ArrayLike<number> }): Peak[] => Array.from({ length: s.mz.length }, (_, i) => ({ mz: s.mz[i], intensity: s.intensity[i] }));

async function sourceOf(input: Input): Promise<Blob> {
  if (input.file) return openSource(input.file);
  if (input.url) {
    const r = await fetch(input.url);
    if (!r.ok) throw new Error(`Could not load the demo file (${r.status}).`);
    return openSource(await r.blob());
  }
  throw new Error('Choose an mzML or MGF file (it is read locally and never uploaded).');
}

const run: ComputeFn<Input, Output> = async (input, ctx) => {
  const op = input.op ?? 'load';
  if (op === 'annotate') {
    const peaks = toPeaks({ mz: input.peaks?.mz ?? [], intensity: input.peaks?.intensity ?? [] });
    return { op, ...safeAnnotate(peaks, input, input.scanActivation, input.scanCharge ?? null) };
  }
  const file = await sourceOf(input);
  if (op === 'spectrum') {
    const spectrum = await averageRanges(file, { ...input, ranges: input.ranges ?? [], info: input.info!, mobilityWindow: parseWindow(input.mobilityWindow) }, ctx);
    const inferred = inferCharge(spectrum, input.precursorMz ?? null);
    ctx.progress(0.95, 'Annotating');
    const charge = Number(input.precursorCharge) || inferred || input.scanCharge || null;
    return { op, spectrum, ...safeAnnotate(toPeaks(spectrum), input, input.scanActivation, charge), inferredCharge: inferred, scanCharge: charge };
  }
  ctx.progress(0.01, 'Indexing');
  const name = input.fileName || (file as File).name || input.url?.split('/').pop() || 'spectra';
  const { info, spectra } = await indexSpectra(file, name, (f) => ctx.progress(0.02 + 0.33 * f, `Indexing ${Math.round(f * 100)}%`), ctx.signal);
  const groups = groupScans(spectra);
  const g = groups[0];
  const ranges = g.indices.slice(0, MAX_SCANS).map((i) => ({ start: spectra[i].start, end: spectra[i].end, centroided: spectra[i].centroided }));
  const spectrum = await averageRanges(file, { ...input, ranges, info, mobilityWindow: parseWindow(input.mobilityWindow) }, ctx);
  const inferred = g.msLevel > 1 ? inferCharge(spectrum, g.precursorMz) : null;
  const charge = Number(input.precursorCharge) || inferred || g.charge || null;
  ctx.progress(0.95, 'Annotating');
  const ann = safeAnnotate(toPeaks(spectrum), input, g.activation, charge);
  return { op, info, spectra, groups, group: g.key, spectrum, ...ann, scanActivation: g.activation, scanCharge: charge, inferredCharge: inferred, writtenCharge: g.charge };
};
export default run;
