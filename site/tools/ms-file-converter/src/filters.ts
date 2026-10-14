// msconvert-style filters, applied in the order given (like msconvert's --filter list). Each filter maps an
// async stream of SpectrumRecords to another; filters that change a spectrum's metadata drop its original mzML
// XML so the writer regenerates it. Names and semantics follow ProteoWizard's msconvert where they overlap.
import { centroid } from '@/lib/ms/average';
import { deisotope } from '@/lib/ms/match';
import { inferCharge } from '@/lib/ms/spectrumFile';
import type { SpectrumRecord, SpectrumSource, CvParam } from './model';
import { CV } from './model';
import { ticOf, basePeak } from './writers/util';

export type Filter =
  | { type: 'msLevel'; levels: string }
  | { type: 'scanNumber'; ranges: string }
  | { type: 'index'; ranges: string }
  | { type: 'scanTime'; fromSec: number; toSec: number }
  | { type: 'polarity'; polarity: '+' | '-' }
  | { type: 'activation'; method: 'HCD' | 'CID' | 'ETD' | 'EThcD' | 'ECD' | 'UVPD' | 'IRMPD'; keep: boolean }
  | { type: 'analyzer'; analyzer: 'FTMS' | 'ITMS' | 'TOF' | 'Quad' }
  | { type: 'stripIT' }
  | { type: 'peakPicking'; msLevels: string; minRel: number }
  | { type: 'zeroSamples'; mode: 'removeExtra' | 'removeAll' }
  | { type: 'mzWindow'; lo: number; hi: number }
  | { type: 'threshold'; mode: 'count' | 'absolute' | 'bpi-relative' | 'tic-cutoff'; value: number; orientation: 'most-intense' | 'least-intense'; msLevels: string }
  | { type: 'mzShift'; ppm: number; da: number; msLevels: string }
  | { type: 'metadataFixer' }
  | { type: 'chargeStatePredictor'; overrideExisting: boolean; maxZ: number; singleChargeFraction: number }
  | { type: 'MS2Deisotope'; tolPpm: number; maxZ: number }
  | { type: 'scanSumming'; precursorTolMz: number; rtTolSec: number }
  | { type: 'sortByScanTime' }
  | { type: 'limit'; first: number };

/** "1-3 5 7-" → predicate. Open-ended ranges allowed; empty string matches everything. */
export function rangeSet(spec: string): (n: number) => boolean {
  const parts = spec.split(/[\s,]+/).filter(Boolean).map((p) => {
    const m = /^(\d*)(?:(-)(\d*))?$/.exec(p);
    if (!m) throw new Error(`Bad range "${p}" (use e.g. "1-3 5 7-").`);
    const lo = m[1] ? Number(m[1]) : -Infinity;
    const hi = m[2] ? (m[3] ? Number(m[3]) : Infinity) : lo;
    return [lo, hi] as const;
  });
  return parts.length ? (n) => parts.some(([a, b]) => n >= a && n <= b) : () => true;
}

const actOf = (s: SpectrumRecord) => {
  const a = s.precursors[0]?.activation ?? [];
  const has = (c: CvParam) => a.some((x) => x.accession === c.accession);
  if ((has(CV.etd) && a.some((x) => /beam-type|supplemental/.test(x.name))) || has(CV.ethcd)) return 'EThcD';
  if (has(CV.etd)) return 'ETD';
  if (has(CV.ecd)) return 'ECD';
  if (has(CV.hcd)) return 'HCD';
  if (has(CV.uvpd)) return 'UVPD';
  if (has(CV.irmpd)) return 'IRMPD';
  if (has(CV.cid) || has(CV.trapCid)) return 'CID';
  return '';
};
const changed = (s: SpectrumRecord): SpectrumRecord => ({ ...s, sourceXml: undefined });
const subset = (s: SpectrumRecord, keep: (i: number) => boolean): SpectrumRecord => {
  const idx: number[] = []; for (let i = 0; i < s.mz.length; i++) if (keep(i)) idx.push(i);
  const pick = (a: Float64Array) => Float64Array.from(idx, (i) => a[i]);
  return { ...s, mz: pick(s.mz), intensity: pick(s.intensity), arrays: s.arrays?.map((a) => (a.values.length === s.mz.length ? { ...a, values: pick(a.values) } : a)) };
};
const refreshStats = (s: SpectrumRecord): SpectrumRecord => {
  const [bpm, bpi] = basePeak(s);
  return { ...s, sourceXml: undefined, tic: ticOf(s), basePeakMz: s.mz.length ? bpm : undefined, basePeakIntensity: s.mz.length ? bpi : undefined, lowMz: s.mz.length ? s.mz[0] : undefined, highMz: s.mz.length ? s.mz[s.mz.length - 1] : undefined };
};

type Stream = AsyncIterable<SpectrumRecord>;
function map(src: Stream, f: (s: SpectrumRecord) => SpectrumRecord | null): Stream {
  return { async *[Symbol.asyncIterator]() { for await (const s of src) { const r = f(s); if (r) yield r; } } };
}

/** Human-readable processing steps for the output's dataProcessing block. */
export function describe(f: Filter): { cv?: [string, string]; user?: string } {
  switch (f.type) {
    case 'peakPicking': return { cv: ['MS:1000035', 'peak picking'] };
    case 'threshold': return { cv: ['MS:1000801', 'area peak picking'], user: `threshold ${f.mode} ${f.value} ${f.orientation}` };
    case 'chargeStatePredictor': return { cv: ['MS:1000778', 'charge state prediction'] };
    case 'MS2Deisotope': return { cv: ['MS:1000033', 'deisotoping'] };
    case 'scanSumming': return { user: `scanSumming precursorTol=${f.precursorTolMz} rtTol=${f.rtTolSec}s` };
    case 'mzShift': return { cv: ['MS:1001485', 'm/z calibration'] };
    default: return { user: `filter ${Object.entries(f).map(([k, v]) => (k === 'type' ? v : `${k}=${v}`)).join(' ')}` };
  }
}

export function applyFilters(src: SpectrumSource, filters: Filter[], log: (m: string) => void): SpectrumSource {
  let count = src.count;
  const build = (): Stream => {
    let st: Stream = src.spectra();
    for (const f of filters) {
      switch (f.type) {
        case 'msLevel': { const ok = rangeSet(f.levels); st = map(st, (s) => (ok(s.msLevel) ? s : null)); count = null; break; }
        case 'scanNumber': { const ok = rangeSet(f.ranges); st = map(st, (s) => (s.scan != null && ok(s.scan) ? s : null)); count = null; break; }
        case 'index': { const ok = rangeSet(f.ranges); st = map(st, (s) => (ok(s.index) ? s : null)); count = null; break; }
        case 'scanTime': st = map(st, (s) => (s.rtSeconds != null && s.rtSeconds >= f.fromSec && s.rtSeconds <= f.toSec ? s : null)); count = null; break;
        case 'polarity': st = map(st, (s) => (s.polarity === f.polarity ? s : null)); count = null; break;
        case 'activation': st = map(st, (s) => (s.msLevel < 2 || (actOf(s) === f.method) === f.keep ? s : null)); count = null; break;
        case 'analyzer': {
          const re = { FTMS: /^FTMS|orbitrap|FT-ICR/i, ITMS: /^ITMS|ion trap/i, TOF: /TOF|time-of-flight/i, Quad: /^[TS]QMS|quadrupole/i }[f.analyzer];
          st = map(st, (s) => (re.test(s.filter ?? '') || (s.cvParams ?? []).some((c) => re.test(c.name)) ? s : null)); count = null; break;
        }
        case 'stripIT': st = map(st, (s) => (s.msLevel === 1 && /^ITMS/.test(s.filter ?? '') ? null : s)); count = null; break;
        case 'peakPicking': {
          const ok = rangeSet(f.msLevels);
          st = map(st, (s) => {
            if (s.centroided || !ok(s.msLevel)) return s;
            const c = centroid({ mz: s.mz, intensity: s.intensity }, f.minRel);
            return refreshStats({ ...s, mz: c.mz, intensity: c.intensity, centroided: true, arrays: undefined });
          });
          break;
        }
        case 'zeroSamples': st = map(st, (s) => {
          const y = s.intensity;
          const keep = f.mode === 'removeAll' ? (i: number) => y[i] > 0 : (i: number) => y[i] > 0 || (i > 0 && y[i - 1] > 0) || (i < y.length - 1 && y[i + 1] > 0);
          return changed(subset(s, keep));
        }); break;
        case 'mzWindow': st = map(st, (s) => refreshStats(subset(s, (i) => s.mz[i] >= f.lo && s.mz[i] <= f.hi))); break;
        case 'threshold': {
          const ok = rangeSet(f.msLevels);
          st = map(st, (s) => {
            if (!ok(s.msLevel) || !s.mz.length) return s;
            const y = s.intensity; const n = y.length;
            const most = f.orientation === 'most-intense';
            let keep: (i: number) => boolean;
            if (f.mode === 'count') {
              const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => (most ? y[b] - y[a] : y[a] - y[b]));
              const set = new Set(order.slice(0, Math.max(0, Math.floor(f.value)))); keep = (i) => set.has(i);
            } else if (f.mode === 'absolute') keep = (i) => (most ? y[i] >= f.value : y[i] <= f.value);
            else if (f.mode === 'bpi-relative') { let m = 0; for (const v of y) m = Math.max(m, v); keep = (i) => (most ? y[i] >= f.value * m : y[i] <= f.value * m); }
            else {
              // keep the most intense peaks that together make up `value` (0–1) of the TIC
              const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => (most ? y[b] - y[a] : y[a] - y[b]));
              const tic = ticOf(s); const set = new Set<number>(); let acc = 0;
              for (const i of order) { if (acc >= f.value * tic) break; set.add(i); acc += y[i]; }
              keep = (i) => set.has(i);
            }
            return refreshStats(subset(s, keep));
          });
          break;
        }
        case 'mzShift': {
          const ok = rangeSet(f.msLevels);
          st = map(st, (s) => (ok(s.msLevel) ? refreshStats({ ...s, mz: s.mz.map((m) => m * (1 + f.ppm / 1e6) + f.da) }) : s));
          break;
        }
        case 'metadataFixer': st = map(st, (s) => refreshStats(s)); break;
        case 'chargeStatePredictor': {
          let lastMs1: SpectrumRecord | null = null;
          st = map(st, (s) => {
            if (s.msLevel === 1) { lastMs1 = s; return s; }
            const p = s.precursors[0];
            if (!p || (p.charge && !f.overrideExisting)) return s;
            // 1) isotope spacing of the precursor in the preceding MS1; 2) msconvert's rule: almost all fragment
            // intensity below the precursor m/z means 1+.
            let z = lastMs1 ? inferCharge(lastMs1, p.mz, f.maxZ) : null;
            if (!z) {
              let below = 0; for (let i = 0; i < s.mz.length; i++) if (s.mz[i] < p.mz) below += s.intensity[i];
              const t = ticOf(s); if (t > 0 && below / t >= f.singleChargeFraction) z = 1;
            }
            return z ? changed({ ...s, precursors: [{ ...p, charge: z }, ...s.precursors.slice(1)] }) : s;
          });
          break;
        }
        case 'MS2Deisotope': st = map(st, (s) => {
          if (s.msLevel < 2 || !s.mz.length) return s;
          const peaks = Array.from(s.mz, (mz, i) => ({ mz, intensity: s.intensity[i] }));
          const { isotopeOf } = deisotope(peaks, { value: f.tolPpm, unit: 'ppm' }, f.maxZ);
          return refreshStats(subset(s, (i) => !isotopeOf.has(i)));
        }); break;
        case 'scanSumming': {
          const inner = st;
          st = { async *[Symbol.asyncIterator]() {
            let group: SpectrumRecord[] = [];
            const flush = function* () {
              if (!group.length) return;
              if (group.length === 1) { yield group[0]; group = []; return; }
              const all = group.flatMap((g) => Array.from(g.mz, (m, i) => [m, g.intensity[i]] as const)).sort((a, b) => a[0] - b[0]);
              const mz: number[] = [], it: number[] = [];
              for (const [m, v] of all) { const k = mz.length - 1; if (k >= 0 && m - mz[k] <= m * 10e-6) { mz[k] = (mz[k] * it[k] + m * v) / (it[k] + v || 1); it[k] += v; } else { mz.push(m); it.push(v); } }
              yield refreshStats({ ...group[0], mz: Float64Array.from(mz), intensity: Float64Array.from(it), userParams: [...(group[0].userParams ?? []), { name: 'summed scans', value: group.map((g) => g.scan ?? g.index).join(' ') }] });
              group = [];
            };
            for await (const s of inner) {
              if (s.msLevel < 2) { yield* flush(); yield s; continue; }
              const g0 = group[0];
              if (g0 && Math.abs(g0.precursors[0]?.mz - s.precursors[0]?.mz) <= f.precursorTolMz && Math.abs((s.rtSeconds ?? 0) - (g0.rtSeconds ?? 0)) <= f.rtTolSec && g0.msLevel === s.msLevel) group.push(s);
              else { yield* flush(); group = [s]; }
            }
            yield* flush();
          } };
          count = null; break;
        }
        case 'sortByScanTime': {
          const inner = st;
          st = { async *[Symbol.asyncIterator]() { const all: SpectrumRecord[] = []; for await (const s of inner) all.push(s); all.sort((a, b) => (a.rtSeconds ?? 0) - (b.rtSeconds ?? 0)); yield* all; } };
          log('sortByScanTime holds every spectrum in memory before writing.');
          break;
        }
        case 'limit': {
          const inner = st;
          st = { async *[Symbol.asyncIterator]() { let n = 0; if (f.first <= 0) return; for await (const s of inner) { yield s; if (++n >= f.first) return; } } };
          count = count == null ? null : Math.min(count, f.first); break;
        }
      }
    }
    // renumber output indices
    return map(st, ((): (s: SpectrumRecord) => SpectrumRecord => { let i = 0; return (s) => ({ ...s, index: i++ }); })());
  };
  build(); // validate specs eagerly (rangeSet throws on bad input)
  // Chromatograms pass through unchanged (as msconvert does).
  return { ...src, count, spectra: build };
}

const kv = (args: string[]) => Object.fromEntries(args.filter((a) => a.includes('=')).map((a) => a.split('=') as [string, string]));
const pos = (args: string[]) => args.filter((a) => !a.includes('='));
const interval = (s: string | undefined, what: string): [number, number] => {
  const m = /^\[?\s*([-\d.eE+]*)\s*,\s*([-\d.eE+]*)\s*\]?$/.exec(s ?? '');
  if (!m) throw new Error(`${what} needs an interval like [300,600].`);
  return [m[1] ? Number(m[1]) : -Infinity, m[2] ? Number(m[2]) : Infinity];
};

/** msconvert-style filter lines ("msLevel 2-", "peakPicking true 1-", "threshold count 150 most-intense"). */
export const FILTER_HELP: Array<{ example: string; text: string }> = [
  { example: 'msLevel 2-', text: 'keep MS levels (ranges: "1", "2-", "1 3")' },
  { example: 'scanNumber 100-500', text: 'keep scan numbers' },
  { example: 'index 0-99', text: 'keep spectrum indices (0-based)' },
  { example: 'scanTime [300,900]', text: 'keep retention times in seconds' },
  { example: 'polarity positive', text: 'positive | negative' },
  { example: 'activation HCD', text: 'keep MSn of one activation: HCD CID ETD EThcD ECD UVPD IRMPD (prefix ! to drop)' },
  { example: 'analyzer FTMS', text: 'keep one analyzer: FTMS ITMS TOF Quad' },
  { example: 'stripIT', text: 'drop ion-trap MS1 scans' },
  { example: 'peakPicking true 1-', text: 'centroid profile spectra at these MS levels (local maxima, Gaussian apex)' },
  { example: 'zeroSamples removeExtra', text: 'removeExtra keeps one zero beside each peak; removeAll drops all zeros' },
  { example: 'mzWindow [100,2000]', text: 'keep peaks in an m/z window' },
  { example: 'threshold count 150 most-intense', text: 'count | absolute | bpi-relative | tic-cutoff, value, most-intense | least-intense [msLevels]' },
  { example: 'mzShift 2.5ppm', text: 'shift m/z by ppm (2.5ppm) or Da (0.001)' },
  { example: 'metadataFixer', text: 'recompute TIC, base peak and m/z range from the peaks' },
  { example: 'chargeStatePredictor overrideExistingCharge=false maxMultipleCharge=4 singleChargeFractionTIC=0.9', text: 'assign missing precursor charges' },
  { example: 'MS2Deisotope ppm=10 maxCharge=4', text: 'remove isotope peaks from MSn spectra' },
  { example: 'scanSumming precursorTol=0.05 scanTimeTol=10', text: 'sum consecutive MSn scans of the same precursor' },
  { example: 'sortByScanTime', text: 'order spectra by retention time (holds all spectra in memory)' },
  { example: 'limit 100', text: 'stop after N spectra (quick previews)' },
];

export function parseFilters(text: string): Filter[] {
  const out: Filter[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [name, ...args] = line.split(/\s+/);
    const o = kv(args), p = pos(args);
    const fail = (msg: string) => { throw new Error(`Filter "${line}": ${msg}`); };
    switch (name.toLowerCase()) {
      case 'mslevel': out.push({ type: 'msLevel', levels: p.join(' ') }); rangeSet(p.join(' ')); break;
      case 'scannumber': out.push({ type: 'scanNumber', ranges: p.join(' ') }); rangeSet(p.join(' ')); break;
      case 'index': out.push({ type: 'index', ranges: p.join(' ') }); rangeSet(p.join(' ')); break;
      case 'scantime': { const [a, b] = interval(p.join(''), 'scanTime'); out.push({ type: 'scanTime', fromSec: a, toSec: b }); break; }
      case 'polarity': if (!/^(positive|negative|\+|-)$/i.test(p[0] ?? '')) fail('use positive or negative'); out.push({ type: 'polarity', polarity: /^(positive|\+)$/i.test(p[0]) ? '+' : '-' }); break;
      case 'activation': {
        const v = (p[0] ?? '').replace(/^!/, '');
        const m = ['HCD', 'CID', 'ETD', 'EThcD', 'ECD', 'UVPD', 'IRMPD'].find((x) => x.toLowerCase() === v.toLowerCase());
        if (!m) fail('use HCD, CID, ETD, EThcD, ECD, UVPD or IRMPD'); out.push({ type: 'activation', method: m as any, keep: !p[0].startsWith('!') }); break;
      }
      case 'analyzer': {
        const m = ['FTMS', 'ITMS', 'TOF', 'Quad'].find((x) => x.toLowerCase() === (p[0] ?? '').toLowerCase() || (x === 'FTMS' && /^orbi/i.test(p[0] ?? '')));
        if (!m) fail('use FTMS, ITMS, TOF or Quad'); out.push({ type: 'analyzer', analyzer: m as any }); break;
      }
      case 'stripit': out.push({ type: 'stripIT' }); break;
      case 'peakpicking': {
        const levels = o.msLevel ?? p.find((x) => /^\d|-/.test(x)) ?? '1-';
        out.push({ type: 'peakPicking', msLevels: levels, minRel: Number(o.minRel ?? 0) }); rangeSet(levels); break;
      }
      case 'zerosamples': out.push({ type: 'zeroSamples', mode: /all/i.test(p[0] ?? '') ? 'removeAll' : 'removeExtra' }); break;
      case 'mzwindow': { const [a, b] = interval(p.join(''), 'mzWindow'); out.push({ type: 'mzWindow', lo: a, hi: b }); break; }
      case 'threshold': {
        const mode = (['count', 'absolute', 'bpi-relative', 'tic-cutoff'] as const).find((m) => m === (p[0] ?? '').toLowerCase());
        if (!mode || !Number.isFinite(Number(p[1]))) fail('use: threshold count|absolute|bpi-relative|tic-cutoff <value> most-intense|least-intense [msLevels]');
        out.push({ type: 'threshold', mode: mode!, value: Number(p[1]), orientation: /least/i.test(p[2] ?? '') ? 'least-intense' : 'most-intense', msLevels: p.slice(3).join(' ') }); break;
      }
      case 'mzshift': {
        const v = p[0] ?? ''; const ppm = /ppm$/i.test(v);
        const n = Number(v.replace(/ppm$/i, '')); if (!Number.isFinite(n)) fail('use e.g. mzShift 2.5ppm or mzShift 0.001');
        out.push({ type: 'mzShift', ppm: ppm ? n : 0, da: ppm ? 0 : n, msLevels: p.slice(1).join(' ') }); break;
      }
      case 'metadatafixer': out.push({ type: 'metadataFixer' }); break;
      case 'chargestatepredictor': out.push({ type: 'chargeStatePredictor', overrideExisting: o.overrideExistingCharge === 'true', maxZ: Number(o.maxMultipleCharge ?? 4), singleChargeFraction: Number(o.singleChargeFractionTIC ?? 0.9) }); break;
      case 'ms2deisotope': out.push({ type: 'MS2Deisotope', tolPpm: Number(o.ppm ?? 10), maxZ: Number(o.maxCharge ?? 4) }); break;
      case 'scansumming': out.push({ type: 'scanSumming', precursorTolMz: Number(o.precursorTol ?? 0.05), rtTolSec: Number(o.scanTimeTol ?? 10) }); break;
      case 'sortbyscantime': out.push({ type: 'sortByScanTime' }); break;
      case 'limit': { const n = Number(p[0]); if (!Number.isInteger(n) || n < 0) fail('use limit <N>'); out.push({ type: 'limit', first: n }); break; }
      default: fail(`unknown filter. Known: ${FILTER_HELP.map((h) => h.example.split(' ')[0]).join(', ')}.`);
    }
  }
  return out;
}
