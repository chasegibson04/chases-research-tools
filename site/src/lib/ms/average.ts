// Peak picking for profile spectra and averaging of several scans.
// Averaging follows the owner's cycfrag/spectra.py convention: pool all peaks, cluster greedily within a ppm
// tolerance around the running intensity-weighted mean, keep clusters present in ≥ minFraction of the scans,
// report the weighted m/z and the mean intensity (missing scans count as zero, so the scale matches one scan).
import type { RawSpectrum } from './mzml';

/** Local maxima of a profile spectrum with Gaussian (log-parabola) apex refinement. */
export function centroid(s: RawSpectrum, minRel = 0): RawSpectrum {
  const { mz, intensity: y } = s;
  const n = mz.length;
  let maxY = 0; for (let i = 0; i < n; i++) if (y[i] > maxY) maxY = y[i];
  const floor = maxY * minRel;
  const om: number[] = [], oi: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    const a = y[i - 1], b = y[i], c = y[i + 1];
    if (!(b > a && b >= c) || b <= floor || a <= 0 || c <= 0) continue;
    const la = Math.log(a), lb = Math.log(b), lc = Math.log(c);
    const den = la - 2 * lb + lc;
    let x = mz[i], h = b;
    if (den < 0) {
      const d = (0.5 * (la - lc)) / den; // offset in points, within (−0.5, 0.5)
      if (Math.abs(d) < 1) {
        const step = d >= 0 ? mz[i + 1] - mz[i] : mz[i] - mz[i - 1];
        x = mz[i] + d * step;
        h = Math.exp(lb - 0.25 * (la - lc) * d);
      }
    }
    om.push(x); oi.push(h);
  }
  return { mz: Float64Array.from(om), intensity: Float64Array.from(oi) };
}

/** Is this spectrum profile-mode? Explicit flag wins; otherwise detect dense, evenly sampled points with zeros. */
export function looksProfile(s: RawSpectrum, flag: boolean | null): boolean {
  if (flag !== null) return !flag;
  if (s.mz.length < 50) return false;
  let zeros = 0; for (let i = 0; i < s.intensity.length; i++) if (s.intensity[i] === 0) zeros++;
  return zeros > s.intensity.length * 0.2;
}

export interface AveragedSpectrum extends RawSpectrum { count: Uint16Array; scans: number }

export function averageSpectra(list: RawSpectrum[], tolPpm = 10, minFraction = 0.3, mode: 'mean' | 'sum' = 'mean'): AveragedSpectrum {
  const N = list.length;
  if (N === 0) return { mz: new Float64Array(0), intensity: new Float64Array(0), count: new Uint16Array(0), scans: 0 };
  if (N === 1) return { ...list[0], count: new Uint16Array(list[0].mz.length).fill(1), scans: 1 };
  let total = 0; for (const s of list) total += s.mz.length;
  const mz = new Float64Array(total), it = new Float64Array(total), src = new Uint32Array(total);
  let k = 0;
  list.forEach((s, j) => { for (let i = 0; i < s.mz.length; i++) { mz[k] = s.mz[i]; it[k] = s.intensity[i]; src[k] = j; k++; } });
  const order = Uint32Array.from({ length: total }, (_, i) => i).sort((a, b) => mz[a] - mz[b]);
  const om: number[] = [], oi: number[] = [], oc: number[] = [];
  const need = Math.max(1, Math.ceil(minFraction * N - 1e-9));
  let cw = 0, cmz = 0, cnt = 0, seen = new Set<number>();
  const flush = () => {
    if (cnt === 0) return;
    if (seen.size >= need) { om.push(cmz / (cw || 1)); oi.push(mode === 'mean' ? cw / N : cw); oc.push(seen.size); }
    cw = 0; cmz = 0; cnt = 0; seen = new Set();
  };
  for (let q = 0; q < total; q++) {
    const i = order[q];
    const center = cw > 0 ? cmz / cw : 0;
    if (cnt > 0 && ((mz[i] - center) / center) * 1e6 > tolPpm) flush();
    const w = Math.max(it[i], 1e-12);
    cw += w; cmz += mz[i] * w; cnt++; seen.add(src[i]);
  }
  flush();
  return { mz: Float64Array.from(om), intensity: Float64Array.from(oi), count: Uint16Array.from(oc), scans: N };
}

/** Keep peaks above a relative threshold (fraction of the base peak) and optionally the top-N per 100 m/z window. */
export function filterPeaks(s: RawSpectrum, minRel = 0, topPer100 = 0): RawSpectrum {
  let max = 0; for (let i = 0; i < s.intensity.length; i++) if (s.intensity[i] > max) max = s.intensity[i];
  const keep: number[] = [];
  for (let i = 0; i < s.mz.length; i++) if (s.intensity[i] >= max * minRel) keep.push(i);
  let idx = keep;
  if (topPer100 > 0) {
    const bins = new Map<number, number[]>();
    for (const i of keep) { const b = Math.floor(s.mz[i] / 100); if (!bins.has(b)) bins.set(b, []); bins.get(b)!.push(i); }
    idx = [...bins.values()].flatMap((l) => l.sort((a, b) => s.intensity[b] - s.intensity[a]).slice(0, topPer100)).sort((a, b) => a - b);
  }
  return { mz: Float64Array.from(idx, (i) => s.mz[i]), intensity: Float64Array.from(idx, (i) => s.intensity[i]) };
}
