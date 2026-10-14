// Peptide fragment ion predictor: theoretical ions for linear and head-to-tail cyclic peptides, an illustrative
// spectrum, and optional matching against a pasted peak list. Chemistry lives in @/lib/ms (shared with the
// mzML annotator; see docs/DECISIONS.md ADR-009).
import type { ComputeFn } from '@/lib/types';
import { parseSequence, type Peptide, type FixedMod } from '@/lib/ms/sequence';
import { generateFragments, peptideMass, type Ion, type IonType } from '@/lib/ms/fragments';
import { predictSpectrum, type Activation, type PredictedPeak } from '@/lib/ms/predict';
import { matchPeaks, coverage, type Coverage, type MatchResult, type Peak } from '@/lib/ms/match';
import { parsePeakList } from '@/lib/ms/peaklist';
import { formatFormula, PROTON } from '@/lib/ms/elements';

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
  observed?: string;
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
  observed?: { peaks: Peak[]; title?: string; precursorMz?: number };
  match?: MatchResult;
  coverage?: Coverage;
}

/** Ion series per activation (linear). Cyclic presets mirror cycfrag METHOD_IONS. */
export const PRESETS: Record<Activation, { linear: IonType[]; cyclic: IonType[] }> = {
  HCD: { linear: ['b', 'y', 'a'], cyclic: ['b', 'a'] },
  CID: { linear: ['b', 'y', 'a'], cyclic: ['b', 'a'] },
  ETD: { linear: ['c', 'z•', 'z+2', 'y'], cyclic: ['b', 'cz•', 'cz+1', 'c', 'c-1', 'z•', 'z+1'] },
  EThcD: { linear: ['b', 'y', 'c', 'z•'], cyclic: ['b', 'a', 'cz•', 'cz+1', 'c', 'c-1', 'z•', 'z+1'] },
  UVPD: { linear: ['a', 'b', 'c', 'x', 'y', 'z•'], cyclic: ['b', 'a'] },
};

/** "Carbamidomethyl@C, Oxidation@M" → fixed modifications. */
export function parseFixedMods(s = ''): FixedMod[] {
  return s.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const [mod, sites] = x.split('@');
    if (!sites) throw new Error(`Fixed modification "${x}" needs a site, e.g. Carbamidomethyl@C or Acetyl@N-term.`);
    return { mod: mod.trim(), residues: sites.split(/[+/ ]+/).map((r) => r.trim()).filter(Boolean) };
  });
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
    losses: { h2o: !!input.losses, nh3: !!input.losses, mod: input.modLosses !== false, maxLosses: input.losses ? Math.max(1, Math.min(3, Number(input.maxLosses) || 1)) : (input.modLosses !== false ? 1 : 0) },
    adducts: input.adducts ?? [], immonium: !!input.immonium,
    internal: { enabled: !!input.internal && !peptide.cyclic, maxLength: Math.max(2, Number(input.internalMaxLength) || 4) },
    precursor: input.precursorIons !== false, cyclicHydrolysis: !!input.cyclicHydrolysis,
  });
  if (ions.length > 200000) throw new Error('Too many ions; reduce charge states, losses or internal fragments.');
  ctx.progress(0.55, 'Representative spectrum');
  const predicted = predictSpectrum(peptide, ions, activation);
  const { mono, formula } = peptideMass(peptide);
  const precursors = Array.from({ length: z }, (_, i) => ({ z: i + 1, mz: (mono + (i + 1) * PROTON) / (i + 1) }));

  let observed: Output['observed'], match: MatchResult | undefined, cov: Coverage | undefined;
  if (input.observed && input.observed.trim()) {
    ctx.progress(0.75, 'Matching observed peaks');
    const parsed = parsePeakList(input.observed);
    observed = { peaks: parsed.peaks, title: parsed.title, precursorMz: parsed.precursorMz };
    const tol = { value: Math.max(0.0001, Number(input.tolerance) || 10), unit: (input.toleranceUnit === 'Da' ? 'Da' : 'ppm') as 'ppm' | 'Da' };
    match = matchPeaks(parsed.peaks, ions, tol);
    cov = coverage(parsed.peaks, ions, match, peptide.residues.length, peptide.cyclic);
  }
  ctx.progress(1, 'Done');
  return { peptide, mono, formula: formatFormula(formula), precursors, ions, ionTypes, predicted, observed, match, coverage: cov };
};
export default run;
