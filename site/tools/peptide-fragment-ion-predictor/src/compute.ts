// Peptide fragment ion predictor: theoretical ions for linear and head-to-tail cyclic peptides, an illustrative
// spectrum, and optional matching against a pasted peak list. Chemistry lives in @/lib/ms (shared with the
// mzML annotator; see docs/DECISIONS.md ADR-009).
import type { ComputeFn } from '@/lib/types';
import { parseSequence, type Peptide } from '@/lib/ms/sequence';
import { generateFragments, peptideMass, type Ion, type IonType } from '@/lib/ms/fragments';
import { predictSpectrum, type Activation, type PredictedPeak } from '@/lib/ms/predict';
import { matchPeaks, coverage, type Coverage, type MatchResult, type Peak } from '@/lib/ms/match';
import { parsePeakList } from '@/lib/ms/peaklist';
import { formatFormula, PROTON } from '@/lib/ms/elements';
import { PRESETS, parseFixedMods } from '@/lib/ms/presets';
import { loadDefaultSpectrum, sniffSpectrumFile } from '@/lib/ms/spectrumFile';
export { PRESETS, parseFixedMods };

export interface Input {
  sequence: string;
  topology: 'linear' | 'cyclic';
  precursorCharge: number;
  activation: Activation;
  /** Empty = use the activation preset. */
  ionTypes?: IonType[];
  maxFragmentCharge: number;
  losses: boolean;
  maxLosses: number;
  modLosses?: boolean;
  fixedMods?: string;
  adducts?: string[];
  immonium?: boolean;
  internal?: boolean;
  internalMaxLength?: number;
  precursorIons?: boolean;
  cyclicHydrolysis?: boolean;
  scrambling?: boolean;
  sideChainLosses?: boolean;
  observed?: string;
  /** A peak-list or spectrum file (text, MGF or mzML). mzML is averaged over its largest MS2 group. */
  observedFile?: Blob | null;
  observedFileName?: string;
  tolerance?: number;
  toleranceUnit?: 'ppm' | 'Da';
}

export interface Output {
  peptide: Peptide;
  mono: number;
  formula: string;
  precursors: Array<{ z: number; mz: number }>;
  ions: Ion[];
  ionTypes: IonType[];
  predicted: PredictedPeak[];
  observed?: { peaks: Peak[]; title?: string; precursorMz?: number; source?: string };
  match?: MatchResult;
  coverage?: Coverage;
}

const run: ComputeFn<Input, Output> = async (input, ctx) => {
  const cyclic = input.topology === 'cyclic';
  ctx.progress(0.05, 'Parsing sequence');
  const peptide = parseSequence(String(input.sequence ?? ''), { cyclic, fixedMods: parseFixedMods(input.fixedMods) });
  const z = Math.max(1, Math.min(10, Math.floor(Number(input.precursorCharge) || 1)));
  const activation: Activation = (['HCD', 'CID', 'ETD', 'EThcD', 'UVPD'] as const).includes(input.activation) ? input.activation : 'HCD';
  const preset = PRESETS[activation][peptide.cyclic ? 'cyclic' : 'linear'];
  const ionTypes = (input.ionTypes?.length ? input.ionTypes : preset) as IonType[];
  if ((activation === 'ETD' || activation === 'EThcD') && z < 2) throw new Error('ETD/EThcD needs a precursor charge of at least 2+.');

  ctx.progress(0.25, 'Fragment ions');
  const ions = generateFragments(peptide, {
    ionTypes, maxCharge: Math.max(1, Math.floor(Number(input.maxFragmentCharge) || 1)), precursorCharge: z,
    losses: { h2o: !!input.losses, nh3: !!input.losses, mod: input.modLosses !== false, sideChain: !!input.sideChainLosses, maxLosses: input.losses || input.sideChainLosses ? Math.max(1, Math.min(3, Number(input.maxLosses) || 1)) : (input.modLosses !== false ? 1 : 0) },
    adducts: input.adducts ?? [], immonium: !!input.immonium,
    internal: { enabled: !!input.internal && !peptide.cyclic, maxLength: Math.max(2, Number(input.internalMaxLength) || 4) },
    precursor: input.precursorIons !== false, cyclicHydrolysis: !!input.cyclicHydrolysis, scrambling: !!input.scrambling,
  });
  if (ions.length > 200000) throw new Error('Too many ions; reduce charge states, losses or internal fragments.');
  ctx.progress(0.55, 'Representative spectrum');
  const predicted = predictSpectrum(peptide, ions, activation);
  const { mono, formula } = peptideMass(peptide);
  const precursors = Array.from({ length: z }, (_, i) => ({ z: i + 1, mz: (mono + (i + 1) * PROTON) / (i + 1) }));

  let observed: Output['observed'], match: MatchResult | undefined, cov: Coverage | undefined;
  if (input.observedFile) {
    const name = input.observedFileName || (input.observedFile as File).name || 'peak list';
    const kind = await sniffSpectrumFile(input.observedFile);
    if (kind === 'mzML' || kind === 'MGF' || kind === 'mzXML') {
      const r = await loadDefaultSpectrum(input.observedFile, name, ctx, { preferPrecursors: precursors.map((p) => p.mz) });
      const peaks = Array.from(r.spectrum.mz, (mz, i) => ({ mz, intensity: r.spectrum.intensity[i] }));
      if (!peaks.length) throw new Error(`No peaks found in ${name}.`);
      observed = { peaks, precursorMz: r.group.precursorMz ?? undefined, title: `${name} · ${r.group.label} · ${r.spectrum.scans} scan${r.spectrum.scans > 1 ? 's' : ''} averaged`, source: kind };
    } else if (kind === 'binary') {
      throw new Error(`${name} is not a text peak list, MGF or mzML file. Vendor files (.raw, .d, .wiff) must be converted to mzML first.`);
    } else {
      if (input.observedFile.size > 50 * 1024 * 1024) throw new Error(`${name} is too large for a text peak list (over 50 MB).`);
      const parsed = parsePeakList(await input.observedFile.text());
      observed = { peaks: parsed.peaks, title: parsed.title ?? name, precursorMz: parsed.precursorMz, source: 'text' };
    }
  } else if (input.observed && input.observed.trim()) {
    if (input.observed.length > 20e6) throw new Error('The pasted peak list is too large; load it as a file instead.');
    const parsed = parsePeakList(input.observed);
    observed = { peaks: parsed.peaks, title: parsed.title, precursorMz: parsed.precursorMz, source: 'pasted' };
  }
  if (observed) {
    ctx.progress(0.85, 'Matching observed peaks');
    const tol = { value: Math.max(0.0001, Number(input.tolerance) || 10), unit: (input.toleranceUnit === 'Da' ? 'Da' : 'ppm') as 'ppm' | 'Da' };
    match = matchPeaks(observed.peaks, ions, tol);
    cov = coverage(observed.peaks, ions, match, peptide.residues.length, peptide.cyclic);
  }
  ctx.progress(1, 'Done');
  return { peptide, mono, formula: formatFormula(formula), precursors, ions, ionTypes, predicted, observed, match, coverage: cov };
};
export default run;
