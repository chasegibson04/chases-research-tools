// Loading spectra from an mzML/MGF file for the MS tools: scan groups, block reads, averaging, charge inference.
import type { ComputeContext } from '@/lib/types';
import { parseSpectrumText, indexSpectra, filterMobility, openSource, type FileInfo, type SpectrumMeta, type RawSpectrum } from './mzml';
import { averageSpectra, centroid, looksProfile, filterPeaks } from './average';

export interface ScanGroup { key: string; msLevel: number; precursorMz: number | null; activation: string; energy: number | null; charge: number | null; indices: number[]; label: string; /** scans that actually contain peaks */ nonEmpty: number }
export interface SpectrumResult { mz: Float64Array; intensity: Float64Array; count?: Uint16Array; scans: number; profile: boolean; points: number; hasMobility?: boolean }
export interface AverageOptions { ranges: Array<{ start: number; end: number; centroided: boolean | null }>; info: Pick<FileInfo, 'format' | 'paramGroups'>; averageTolPpm?: number; minFraction?: number; minRelIntensity?: number; mobilityWindow?: [number, number] | null }
export interface SpectrumResultExtra { hasMobility: boolean }
export const MAX_SCANS = 5000;
let lastSawMobility = false;

export function groupScans(spectra: SpectrumMeta[]): ScanGroup[] {
  const map = new Map<string, ScanGroup>();
  // indices are positions in `spectra` (a file's own index attributes need not be 0..n-1)
  spectra.forEach((s, pos) => {
    const cvTag = s.faimsCv != null ? `|CV${s.faimsCv}` : '';
    const key = (s.msLevel === 1 ? 'MS1' : `MS${s.msLevel}|${s.precursorMz?.toFixed(2)}|${s.activation}|${s.energy ?? ''}`) + cvTag;
    let g = map.get(key);
    if (!g) {
      const lbl = (s.msLevel === 1 ? 'MS1 scans' : `MS${s.msLevel} ${s.precursorMz?.toFixed(4) ?? '?'} · ${s.activation}${s.energy != null ? ` ${s.energy}` : ''}`) + (s.faimsCv != null ? ` · CV ${s.faimsCv}` : '');
      g = { key, msLevel: s.msLevel, precursorMz: s.precursorMz, activation: s.activation, energy: s.energy, charge: s.charge, indices: [], label: lbl, nonEmpty: 0 };
      map.set(key, g);
    }
    g.indices.push(pos);
    if (s.points > 0) g.nonEmpty++;
  });
  // Groups with peaks first, then MSn before MS1, then by the number of scans that contain peaks (some files hold many empty scans).
  return [...map.values()].sort((a, b) => (b.nonEmpty > 0 ? 1 : 0) - (a.nonEmpty > 0 ? 1 : 0) || (b.msLevel > 1 ? 1 : 0) - (a.msLevel > 1 ? 1 : 0) || b.nonEmpty - a.nonEmpty || b.indices.length - a.indices.length);
}

/** Read several spectra, merging nearby byte ranges into one read (consecutive direct-infusion scans). */
async function readMany(file: Blob, ranges: AverageOptions['ranges'], info: AverageOptions['info'], ctx: ComputeContext, mobilityWindow?: [number, number] | null): Promise<RawSpectrum[]> {
  const out: RawSpectrum[] = new Array(ranges.length);
  let sawMobility = false;
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
      if (s.mobility) sawMobility = true;
      if (mobilityWindow && s.mobility) s = filterMobility(s, mobilityWindow[0], mobilityWindow[1]);
      // very sparse "profile" spectra (a handful of points) have no interior maxima; keep their points
      if (looksProfile(s, r.centroided)) { const c = centroid(s); if (c.mz.length || !s.mz.length) s = c; }
      out[r.i] = s;
    }
    ctx.progress(0.35 + 0.45 * ((j + 1) / order.length), `Reading spectra ${j + 1}/${order.length}`);
    k = j + 1;
  }
  lastSawMobility = sawMobility;
  return out;
}

export async function averageRanges(file: Blob, input: AverageOptions, ctx: ComputeContext): Promise<SpectrumResult> {
  const ranges = (input.ranges ?? []).slice(0, MAX_SCANS);
  if (!ranges.length) throw new Error('No scans selected.');
  const all = await readMany(file, ranges, input.info!, ctx, input.mobilityWindow);
  // Empty scans would dilute the minimum-presence rule; average only scans with peaks.
  const raws = all.filter((r) => r.mz.length > 0);
  if (!raws.length) return { mz: new Float64Array(0), intensity: new Float64Array(0), scans: 0, profile: false, points: 0, hasMobility: lastSawMobility };
  const profile = ranges.some((r) => r.centroided === false);
  ctx.progress(0.85, `Averaging ${raws.length} scan${raws.length > 1 ? 's' : ''}`);
  let avg = averageSpectra(raws, Number(input.averageTolPpm) || 10, raws.length > 1 ? Math.max(0, Math.min(1, input.minFraction ?? 0.3)) : 0);
  // Sparse scans (e.g. MSn chains with one or two peaks each) can lose everything to the presence rule: fall back to the union.
  if (!avg.mz.length && raws.length > 1) avg = averageSpectra(raws, Number(input.averageTolPpm) || 10, 0);
  const filtered = filterPeaks(avg, Math.max(0, Number(input.minRelIntensity) || 0) / 100);
  return { mz: filtered.mz, intensity: filtered.intensity, count: avg.count && filtered.mz.length === avg.mz.length ? avg.count : undefined, scans: raws.length, profile, points: raws.reduce((n, r) => n + r.mz.length, 0), hasMobility: lastSawMobility };
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
export async function loadDefaultSpectrum(fileIn: Blob, name: string, ctx: ComputeContext, opts: { averageTolPpm?: number; minFraction?: number; preferPrecursors?: number[] } = {}) {
  const file = await openSource(fileIn);
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
  if (head.charCodeAt(0) === 0x1f && head.charCodeAt(1) === 0x8b) return sniffSpectrumFile(await openSource(file));
  if (/<mzXML/.test(head)) return 'mzXML';
  if (/<mzML|<indexedmzML/.test(head)) return 'mzML';
  if (/BEGIN IONS/.test(head)) return 'MGF';
  if (/[\u0000-\u0008\u000e-\u001f]/.test(head.slice(0, 4096))) return 'binary'; // control bytes => not a text peak list
  return 'text';
}

/**
 * Extracted-ion chromatogram: summed intensity within ±tolPpm of each target m/z, for every spectrum range given.
 * Reads the file in merged blocks (same as averaging). Returns one intensity per range per target.
 */
export async function extractIonChromatogram(file: Blob, ranges: AverageOptions['ranges'], info: AverageOptions['info'], targets: number[], tolPpm: number, ctx: ComputeContext): Promise<number[][]> {
  const out = targets.map(() => new Array(ranges.length).fill(0));
  const order = ranges.map((r, i) => ({ ...r, i })).sort((a, b) => a.start - b.start);
  let k = 0;
  while (k < order.length) {
    let j = k; const blockStart = order[k].start; let blockEnd = order[k].end;
    while (j + 1 < order.length && order[j + 1].start - blockEnd < 64 * 1024 && order[j + 1].end - blockStart < 48 * 1024 * 1024) { j++; blockEnd = order[j].end; }
    const text = new TextDecoder('latin1').decode(await file.slice(blockStart, blockEnd).arrayBuffer());
    for (let q = k; q <= j; q++) {
      if (ctx.signal.aborted) throw new Error('Cancelled.');
      const r = order[q];
      const sp = parseSpectrumText(text.slice(r.start - blockStart, r.end - blockStart), info);
      targets.forEach((t, ti) => {
        const d = (t * tolPpm) / 1e6;
        let lo = 0, hi = sp.mz.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (sp.mz[mid] < t - d) lo = mid + 1; else hi = mid; }
        let sum = 0; for (let x = lo; x < sp.mz.length && sp.mz[x] <= t + d; x++) sum += sp.intensity[x];
        out[ti][r.i] = sum;
      });
    }
    ctx.progress(0.05 + 0.9 * ((j + 1) / order.length), `XIC ${j + 1}/${order.length}`);
    k = j + 1;
  }
  return out;
}

/** Cosine similarity of two centroided spectra (peaks paired within tolPpm, √intensity weighting). */
export function spectralCosine(a: { mz: ArrayLike<number>; intensity: ArrayLike<number> }, b: { mz: ArrayLike<number>; intensity: ArrayLike<number> }, tolPpm = 10): number {
  let i = 0, j = 0, dot = 0, na = 0, nb = 0;
  for (let x = 0; x < a.mz.length; x++) na += a.intensity[x];
  for (let x = 0; x < b.mz.length; x++) nb += b.intensity[x];
  while (i < a.mz.length && j < b.mz.length) {
    const d = ((a.mz[i] - b.mz[j]) / b.mz[j]) * 1e6;
    if (Math.abs(d) <= tolPpm) { dot += Math.sqrt(a.intensity[i] * b.intensity[j]); i++; j++; }
    else if (d < 0) i++; else j++;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
