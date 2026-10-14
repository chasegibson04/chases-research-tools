// MOBILion .mbi reader (SLIM ion mobility + Agilent 6545/6546 QTOF). An .mbi file is HDF5:
//   /data-description/global-description          attributes: acq-*, adc-* (adc-sample-rate, adc-mass-spec-range), smp-*
//   /data-description/frame-N-metadata            attributes: frm-start-time (s), frm-dt-period (ms per drift bin),
//                                                 frm-polarity, frm-frag-energy, cal-ms-traditional (JSON)
//   /data-cubes/frame-N-data                      zero-suppressed drift × TOF cube:
//       index-positions[i]  cumulative end row in data-positions for drift scan i (0-based)
//       index-counts[i]     cumulative end sample in data-counts for drift scan i
//       data-positions      int32 [rows, 2]: [first TOF index, end TOF index) of each non-zero gate
//       data-counts         intensities of the gate samples, concatenated
//   /rt-tic                                       per-frame TIC (before zero suppression)
// frm-start-time is in seconds (frames are ~1 s apart; msconvert also writes seconds for spectra).
// m/z of TOF index k: t = k / sampleRate (µs); m/z = (slope · (t − intercept))²; with a residual fit
// (mz_residual_terms) the result is scaled by (1 − Σ c_j t^j · 10⁻⁶) (residual in ppm). Derived from the file's own
// metadata and validated against ProteoWizard (MBI SDK) output to < 0.1 ppm; the MBI SDK itself is not used.
// Output follows msconvert without --combineIonMobilitySpectra: one profile spectrum per non-empty drift scan,
// nativeID "frame=F scan=S" (scan S = rows index-positions[S−1]..[S]), drift time (S−1)·frm-dt-period, zero points padded around each gate.
// HDF5 is read with h5wasm (lazy-loaded); inside a Web Worker the File is mounted with WORKERFS (random access,
// nothing is copied), elsewhere it is copied into the in-memory file system.
import { CV, asciiOf, readHead, type InputFormat, type SpectrumRecord, type CvParam, type RunMetadata, type ChromatogramRecord } from '../../model';

type H5 = typeof import('h5wasm');
type H5File = InstanceType<H5['File']>;
type H5Dataset = InstanceType<H5['Dataset']>;

const DRIFT_TIME: CvParam = { accession: 'MS:1002476', name: 'ion mobility drift time', unitAccession: 'UO:0000028', unitName: 'millisecond' };
const MS_UNIT: CvParam = { accession: 'UO:0000028', name: 'millisecond' };

let h5Promise: Promise<H5> | null = null;
async function loadH5(): Promise<H5> {
  if (!h5Promise) h5Promise = import('h5wasm').then(async (m) => { await m.ready; return m; });
  return h5Promise;
}

let mountSeq = 0;
/** Make a Blob visible to HDF5. Returns the path and a cleanup function. */
async function mount(h5: H5, blob: Blob, name: string): Promise<{ path: string; release: () => void }> {
  const FS = h5.FS as any;
  const dir = `/mbi${++mountSeq}`;
  const safe = name.replace(/[^\w.-]+/g, '_') || 'input.mbi';
  FS.mkdir(dir);
  if (typeof (globalThis as any).FileReaderSync !== 'undefined' && FS.filesystems?.WORKERFS) {
    FS.mount(FS.filesystems.WORKERFS, { blobs: [{ name: safe, data: blob }] }, dir);
    return { path: `${dir}/${safe}`, release: () => { try { FS.unmount(dir); FS.rmdir(dir); } catch { /* already gone */ } } };
  }
  FS.writeFile(`${dir}/${safe}`, new Uint8Array(await blob.arrayBuffer()));
  return { path: `${dir}/${safe}`, release: () => { try { FS.unlink(`${dir}/${safe}`); FS.rmdir(dir); } catch { /* already gone */ } } };
}

function attrs(obj: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (!obj?.attrs) return out;
  for (const [k, a] of Object.entries<any>(obj.attrs)) {
    try { const v = a.value; out[k] = typeof v === 'string' ? v : ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>).join(',') : String(v); } catch { /* unreadable attribute type */ }
  }
  return out;
}

const num = (s: string | undefined) => { if (s == null || s.trim() === '') return undefined; const v = Number(s); return Number.isFinite(v) ? v : undefined; };

export interface MbiCalibration { slope: number; intercept: number; residual: number[]; sampleRate: number }
export function parseMbiCal(json: string | undefined, sampleRate: number): MbiCalibration | null {
  if (!json) return null;
  try {
    const c = JSON.parse(json);
    if (typeof c.slope !== 'number' || typeof c.intercept !== 'number') return null;
    const res = (c.mz_residual_terms ?? c.residual_terms ?? []) as number[];
    return { slope: c.slope, intercept: c.intercept, residual: Array.isArray(res) ? res.filter((v) => typeof v === 'number') : [], sampleRate };
  } catch { return null; }
}
export function mbiIndexToMz(k: number, c: MbiCalibration): number {
  const t = (k / c.sampleRate) * 1e6;
  const r = c.slope * (t - c.intercept);
  let mz = r * r;
  if (c.residual.length) { let e = 0, p = 1; for (const cj of c.residual) { e += cj * p; p *= t; } mz *= 1 - e * 1e-6; }
  return mz;
}

/** One drift scan: gates [start, end) of TOF indices with their counts → msconvert-style zero-padded profile. */
export function padGates(tof: Int32Array | number[], counts: ArrayLike<number>): { idx: Float64Array; y: Float64Array } {
  const n = counts.length;
  if (!n) return { idx: new Float64Array(0), y: new Float64Array(0) };
  let gaps = 0;
  for (let i = 1; i < n; i++) if (tof[i] - tof[i - 1] > 1) gaps++;
  const m = n + 2 + 2 * gaps;
  const idx = new Float64Array(m), y = new Float64Array(m);
  let p = 0;
  idx[p] = tof[0] - 1; y[p++] = 0;
  idx[p] = tof[0]; y[p++] = counts[0];
  for (let i = 1; i < n; i++) {
    if (tof[i] - tof[i - 1] > 1) { idx[p] = tof[i - 1] + 1; y[p++] = 0; idx[p] = tof[i] - 1; y[p++] = 0; }
    idx[p] = tof[i]; y[p++] = counts[i];
  }
  idx[p] = tof[n - 1] + 1; y[p++] = 0;
  return { idx, y };
}

export const mobilionMbi: InputFormat = {
  id: 'mobilion-mbi',
  label: 'MOBILion .mbi (HDF5)',
  async detect(input) {
    if (input.files.length !== 1 || !/\.mbi$/i.test(input.files[0].path)) return false;
    return asciiOf(await readHead(input.files[0].file, 8)).startsWith(' HDF');
  },
  async open(input, ctx) {
    ctx.progress(0, 'Loading HDF5 library');
    const h5 = await loadH5();
    const blob = input.files[0].file;
    const m = await mount(h5, blob, input.files[0].path.split('/').pop() ?? input.name);
    let f: H5File;
    try { f = new h5.File(m.path, 'r'); } catch (e) { m.release(); throw new Error(`MOBILion .mbi: HDF5 open failed (${(e as Error).message}).`); }
    const get = (p: string): any => { try { return f.get(p); } catch { return null; } };
    const g = attrs(get('data-description/global-description'));
    const sampleRate = num(g['adc-sample-rate']) ?? 2e9;
    const msRange = num(g['adc-mass-spec-range']);
    const cubes = get('data-cubes');
    if (!cubes) { f.close(); m.release(); throw new Error('MOBILion .mbi: no /data-cubes group.'); }
    const frames = (cubes.keys() as string[]).map((k) => /^frame-(\d+)-data$/.exec(k)).filter((x): x is RegExpExecArray => !!x).map((x) => Number(x[1])).sort((a, b) => a - b);
    const ts = g['acq-timestamp'];
    const meta: RunMetadata = {
      sourceFormat: 'MOBILion MBI',
      sourceFiles: [{ id: 'MBI', name: input.name, nativeIdFormat: { accession: 'MS:1001186', name: 'Mobilion MBI nativeID format' }, fileFormat: { accession: 'MS:1001185', name: 'Mobilion MBI format' } }],
      instrument: { model: { accession: 'MS:1000490', name: 'Agilent instrument model' }, name: ['MOBILion MOBIE', g['acq-ms-model']].filter(Boolean).join(' + ') || undefined },
      software: g['acq-software-version'] ? [{ id: 'EyeOn', name: 'MOBILion EyeOn', version: g['acq-software-version'] }] : [],
      startTimeStamp: ts ? ts.replace(' ', 'T').replace(/(\.\d{3})\d*/, '$1').replace('+00:00', 'Z') : undefined,
      sampleName: g['smp-type'] || undefined,
      extra: Object.fromEntries(Object.entries(g).filter(([k, v]) => /^(acq|adc|smp)-/.test(k) && v && v.length < 200).map(([k, v]) => [`MBI ${k}`, v])),
    };

    interface FrameData { frame: number; rtSec: number; dtPeriod: number; polarity?: '+' | '-'; ce?: number; cal: MbiCalibration; ip: ArrayLike<number>; ic: ArrayLike<number>; dp: ArrayLike<number>; dc: ArrayLike<number> }
    const readFrame = (fr: number): FrameData => {
      const md = attrs(get(`data-description/frame-${fr}-metadata`));
      const cal = parseMbiCal(md['cal-ms-traditional'], sampleRate);
      if (!cal) throw new Error(`MOBILion .mbi: frame ${fr} has no usable cal-ms-traditional calibration.`);
      const v = (n: string) => { const d = get(`data-cubes/frame-${fr}-data/${n}`) as H5Dataset | null; return (d ? d.value : new Int32Array(0)) as unknown as ArrayLike<number>; };
      const pol = (md['frm-polarity'] ?? '').toLowerCase();
      return {
        frame: fr, rtSec: num(md['frm-start-time']) ?? 0, dtPeriod: num(md['frm-dt-period']) ?? 0,
        polarity: pol.startsWith('pos') ? '+' : pol.startsWith('neg') ? '-' : undefined, ce: num(md['frm-frag-energy']), cal,
        ip: v('index-positions'), ic: v('index-counts'), dp: v('data-positions'), dc: v('data-counts'),
      };
    };

    // Frame TIC = sum of the frame's counts (what msconvert writes); filled while spectra() runs.
    const frameTic = new Map<number, number>();
    let closed = false;
    const close = () => { if (!closed) { closed = true; try { f.close(); } catch { /* ignore */ } m.release(); } };

    return {
      meta, count: null, close,
      async *spectra() {
        let out = 0;
        for (let fi = 0; fi < frames.length; fi++) {
          if (ctx.signal.aborted) throw new DOMException('Cancelled.', 'AbortError');
          const fd = readFrame(frames[fi]);
          const msLevel = fd.ce != null && fd.ce > 0 ? 2 : 1;
          let sum = 0;
          for (let k = 0; k < fd.dc.length; k++) sum += Number(fd.dc[k]);
          frameTic.set(fd.frame, sum);
          const nScans = fd.ip.length;
          for (let i = 0; i < nScans; i++) {
            const r0 = i ? Number(fd.ip[i - 1]) : 0, r1 = Number(fd.ip[i]);
            if (r1 <= r0) continue;
            let c = i ? Number(fd.ic[i - 1]) : 0;
            const c1 = Number(fd.ic[i]);
            const tof: number[] = [];
            const counts: number[] = [];
            for (let r = r0; r < r1; r++) {
              const a = Number(fd.dp[2 * r]), b = Number(fd.dp[2 * r + 1]);
              for (let k = a; k < b && c < c1; k++) { tof.push(k); counts.push(Number(fd.dc[c++])); }
            }
            if (!counts.length) continue;
            const { idx, y } = padGates(tof, counts);
            const mz = new Float64Array(idx.length);
            for (let k = 0; k < idx.length; k++) mz[k] = mbiIndexToMz(idx[k], fd.cal);
            let tic = 0, bpI = 0, bpM = 0;
            for (let k = 0; k < y.length; k++) { tic += y[k]; if (y[k] > bpI) { bpI = y[k]; bpM = mz[k]; } }
            const scan = i; // msconvert numbering: scan S spans index-positions[S−1]..index-positions[S]
            const win: [number, number] | undefined = msRange ? [0, msRange] : undefined;
            const rec: SpectrumRecord = {
              index: out++, nativeId: `frame=${fd.frame} scan=${scan}`, scan, msLevel, rtSeconds: fd.rtSec, polarity: fd.polarity, centroided: false,
              tic, basePeakMz: bpM, basePeakIntensity: bpI, lowMz: mz[0], highMz: mz[mz.length - 1], scanWindow: win,
              ionMobility: { value: (scan - 1) * fd.dtPeriod, cv: DRIFT_TIME, unit: MS_UNIT },
              // All-ions fragmentation: no isolation, so the precursor is the centre of the scan range (as msconvert).
              precursors: msLevel === 2 && msRange ? [{ mz: msRange / 2, isolationTarget: msRange / 2, isolationLower: msRange / 2, isolationUpper: msRange / 2, activation: [CV.hcd], collisionEnergy: fd.ce }] : [],
              mz, intensity: y,
            };
            yield rec;
          }
          ctx.progress((fi + 1) / frames.length, `Frame ${fi + 1}/${frames.length}`);
        }
      },
      async *chromatograms() {
        const rt = new Float64Array(frames.length);
        for (let i = 0; i < frames.length; i++) rt[i] = (num(attrs(get(`data-description/frame-${frames[i]}-metadata`))['frm-start-time']) ?? 0) / 60;
        let tic: Float64Array;
        if (frameTic.size === frames.length) tic = Float64Array.from(frames, (fr) => frameTic.get(fr) ?? 0);
        else {
          // spectra() not (fully) iterated: use the acquisition's own per-frame TIC (includes counts below the
          // zero-suppression threshold, so it is slightly higher than the sum of stored counts).
          const d = get('rt-tic') as H5Dataset | null;
          const v = (d ? d.value : []) as unknown as ArrayLike<number | bigint>;
          tic = Float64Array.from({ length: frames.length }, (_, i) => Number(v[i] ?? 0));
        }
        const c: ChromatogramRecord = { index: 0, id: 'TIC', time: rt, intensity: tic, type: CV.ticChrom };
        yield c;
      },
    };
  },
};
