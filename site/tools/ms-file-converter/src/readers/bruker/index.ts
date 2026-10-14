// Bruker timsTOF readers: TDF (PASEF / diaPASEF / prm-PASEF, with ion mobility) and TSF (no mobility, incl. MALDI).
// Input is the files of a ".d" folder; only analysis.tdf/.tsf (SQLite, read whole) and byte ranges of the
// *_bin file (Blob.slice, one frame at a time) are read. Logic ported from timsrust (MIT, MannLabs), with
// calibration and output semantics matched to ProteoWizard msconvert — see tdf.ts, tsf.ts and calibration.ts.
import { findFile, type InputBundle, type InputFormat } from '../../model';
import { openTdf, type TdfOptions } from './tdf';
import { openTsf, type TsfOptions } from './tsf';

export type { TdfOptions } from './tdf';
export type { TsfOptions } from './tsf';

/** Locate "<x>/analysis.<ext>" and its "_bin" sibling in the same folder. */
function pair(input: InputBundle, ext: 'tdf' | 'tsf') {
  const main = findFile(input, `analysis.${ext}`);
  if (!main) return null;
  const binPath = `${main.path}_bin`.toLowerCase();
  const bin = input.files.find((f) => f.path.toLowerCase() === binPath) ?? findFile(input, `analysis.${ext}_bin`);
  return bin ? { main, bin } : null;
}

/**
 * Default `combineIonMobility: true` — one spectrum per MS1 frame / per PASEF or DIA window (msconvert
 * --combineIonMobilitySpectra). ProteoWizard's own default is per-scan output (`false`); pass that to match the
 * pwiz reference files without the "-combineIMS" suffix.
 */
export function createBrukerTdf(opts: Partial<TdfOptions> = {}): InputFormat {
  const o: TdfOptions = { combineIonMobility: opts.combineIonMobility ?? true };
  return {
    id: 'Bruker TDF', label: 'Bruker timsTOF .d (TDF)',
    async detect(input) { return pair(input, 'tdf') != null; },
    async open(input, ctx) {
      const p = pair(input, 'tdf');
      if (!p) throw new Error('A Bruker TDF .d folder needs analysis.tdf and analysis.tdf_bin.');
      return openTdf(input, p.main, p.bin, ctx, o);
    },
  };
}

export function createBrukerTsf(opts: Partial<TsfOptions> = {}): InputFormat {
  const o: TsfOptions = { spectra: opts.spectra ?? 'auto' };
  return {
    id: 'Bruker TSF', label: 'Bruker timsTOF .d (TSF)',
    async detect(input) { return pair(input, 'tsf') != null; },
    async open(input, ctx) {
      const p = pair(input, 'tsf');
      if (!p) throw new Error('A Bruker TSF .d folder needs analysis.tsf and analysis.tsf_bin.');
      return openTsf(input, p.main, p.bin, ctx, o);
    },
  };
}

export const brukerTdf: InputFormat = createBrukerTdf();
export const brukerTsf: InputFormat = createBrukerTsf();
