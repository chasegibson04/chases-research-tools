// Loading spectra from an mzML/MGF file for the MS tools: scan groups, block reads, averaging, charge inference.
import type { ComputeContext } from '@/lib/types';
import { parseSpectrumText, indexSpectra, type FileInfo, type SpectrumMeta, type RawSpectrum } from './mzml';
import { averageSpectra, centroid, looksProfile, filterPeaks } from './average';

export interface ScanGroup { key: string; msLevel: number; precursorMz: number | null; activation: string; energy: number | null; charge: number | null; indices: number[]; label: string }
export interface SpectrumResult { mz: Float64Array; intensity: Float64Array; count?: Uint16Array; scans: number; profile: boolean; points: number }
export interface AverageOptions { ranges: Array<{ start: number; end: number; centroided: boolean | null }>; info: Pick<FileInfo, 'format' | 'paramGroups'>; averageTolPpm?: number; minFraction?: number; minRelIntensity?: number }
export const MAX_SCANS = 5000;

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
async function readMany(file: Blob, ranges: AverageOptions['ranges'], info: AverageOptions['info'], ctx: ComputeContext): Promise<RawSpectrum[]> {
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

export async function averageRanges(file: Blob, input: AverageOptions, ctx: ComputeContext): Promise<SpectrumResult> {
  const ranges = (input.ranges ?? []).slice(0, MAX_SCANS);
  if (!ranges.length) throw new Error('No scans selected.');
  const raws = await readMany(file, ranges, input.info!, ctx);
  const profile = ranges.some((r) => r.centroided === false);
  ctx.progress(0.85, `Averaging ${raws.length} scan${raws.length > 1 ? 's' : ''}`);
  const avg = averageSpectra(raws, Number(input.averageTolPpm) || 10, raws.length > 1 ? Math.max(0, Math.min(1, input.minFraction ?? 0.3)) : 0);
  const filtered = filterPeaks(avg, Math.max(0, Number(input.minRelIntensity) || 0) / 100);
  return { mz: filtered.mz, intensity: filtered.intensity, count: avg.count && filtered.mz.length === avg.mz.length ? avg.count : undefined, scans: raws.length, profile, points: raws.reduce((n, r) => n + r.mz.length, 0) };
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


/** Index a file, pick the largest MS2 group (or MS1 if none), and average it: the default "peak list from a file". */
export async function loadDefaultSpectrum(file: Blob, name: string, ctx: ComputeContext, opts: { averageTolPpm?: number; minFraction?: number; preferPrecursors?: number[] } = {}) {
  const { info, spectra } = await indexSpectra(file, name, (f) => ctx.progress(0.05 + 0.3 * f, `Indexing ${name} ${Math.round(f * 100)}%`), ctx.signal);
  const groups = groupScans(spectra);
  // When the peptide is known, use the MS2 group isolated at one of its [M+zH] values (±0.05 Th); else the largest.
  const near = (g: ScanGroup) => g.msLevel > 1 && g.precursorMz != null && (opts.preferPrecursors ?? []).some((mz) => Math.abs(mz - g.precursorMz!) < 0.05);
  const group = groups.filter(near).sort((a, b) => b.indices.length - a.indices.length)[0] ?? groups[0];
  const ranges = group.indices.slice(0, MAX_SCANS).map((i) => ({ start: spectra[i].start, end: spectra[i].end, centroided: spectra[i].centroided }));
  const spectrum = await averageRanges(file, { ranges, info, averageTolPpm: opts.averageTolPpm ?? 10, minFraction: opts.minFraction ?? 0.3 }, ctx);
  return { info, spectra, groups, group, spectrum, inferredCharge: group.msLevel > 1 ? inferCharge(spectrum, group.precursorMz) : null };
}

/** Sniff the first bytes: mzML/MGF are read as spectrum files, anything else as a text peak list. */
export async function sniffSpectrumFile(file: Blob): Promise<'mzML' | 'MGF' | 'mzXML' | 'text' | 'binary'> {
  const head = new TextDecoder('latin1').decode(await file.slice(0, 64 * 1024).arrayBuffer());
  if (/<mzXML/.test(head)) return 'mzXML';
  if (/<mzML|<indexedmzML/.test(head)) return 'mzML';
  if (/BEGIN IONS/.test(head)) return 'MGF';
  if (/[\u0000-\u0008\u000e-\u001f]/.test(head.slice(0, 4096))) return 'binary'; // control bytes => not a text peak list
  return 'text';
}
