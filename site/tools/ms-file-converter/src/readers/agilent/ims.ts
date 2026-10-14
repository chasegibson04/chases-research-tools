// Agilent 6560 IM-QTOF (.d with IMSFrame.bin). Each frame (IMSFrame.bin, layout from IMSFrame.xsd) is one
// retention time; MSScan.bin then holds one record per (frame, drift bin) — layout from this run's MSScan.xsd —
// plus a drift-bin-0 record per frame carrying the frame's summed spectrum (skipped: it duplicates the bins).
// Spectrum segments in MSProfile.bin are the same run-length TOF profiles as plain QTOF data.
// Output follows msconvert without --combineIonMobilitySpectra: one spectrum per non-empty drift scan, with
// nativeID "scanId=(frame−1)·(MaxMsPerFrame−1) + driftBin−1" and drift time (driftBin−1)·FrameDtPeriod.
import { CV, type InputBundle, type ReaderContext, type SpectrumSource, type SpectrumRecord, type CvParam } from '../../model';
import { readMeta, loadCalibration, type AcqFiles } from './common';
import { parseXsd, layoutOf, readField, type Layout } from './xsd';
import { decodeProfile, trimZeros } from './decode';
import { tofToMz } from './calibration';

const DRIFT_TIME: CvParam = { accession: 'MS:1002476', name: 'ion mobility drift time', unitAccession: 'UO:0000028', unitName: 'millisecond' };
const MS_UNIT: CvParam = { accession: 'UO:0000028', name: 'millisecond' };

interface FrameMethod { dtPeriod: number; maxMsPerFrame: number; polarity?: number; calId?: number; fragOpMode?: number; fragEnergy?: number; ramp: Array<[number, number]> }

const num = (s: string | undefined) => (s == null || s === '' ? undefined : Number(s));
const tag = (x: string, t: string) => new RegExp(`<${t}>\\s*([^<]*?)\\s*</${t}>`).exec(x)?.[1];

function parseFrameMethods(xml: string): Map<number, FrameMethod> {
  const out = new Map<number, FrameMethod>();
  for (const m of xml.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<FrameMethod\s+FrameMethId="(\d+)"\s*>([\s\S]*?)<\/FrameMethod>/g)) {
    const b = m[2];
    const ramp = [...b.matchAll(/<EndPoint\s+db="([\d.]+)"\s+e="([-\d.]+)"/g)].map((e) => [Number(e[1]), Number(e[2])] as [number, number]);
    out.set(Number(m[1]), {
      dtPeriod: num(tag(b, 'FrameDtPeriod')) ?? 0, maxMsPerFrame: num(tag(b, 'MaxMsPerFrame')) ?? 0, polarity: num(tag(b, 'IonPolarity')),
      calId: num(tag(b, 'DefMassCalId')), fragOpMode: num(tag(b, 'FragOpMode')), fragEnergy: num(tag(b, 'FragEnergy')), ramp,
    });
  }
  return out;
}

/** Collision energy at a drift bin: piecewise-linear ramp (FragEnergySegments) or the fixed FragEnergy. */
function energyAt(m: FrameMethod | undefined, frameEnergy: number | undefined, bin: number): number | undefined {
  if (m?.ramp.length) {
    const r = m.ramp;
    if (bin <= r[0][0]) return r[0][1];
    for (let k = 1; k < r.length; k++) if (bin <= r[k][0]) { const [x0, y0] = r[k - 1], [x1, y1] = r[k]; return x1 === x0 ? y1 : y0 + ((y1 - y0) * (bin - x0)) / (x1 - x0); }
    return r[r.length - 1][1];
  }
  const e = frameEnergy != null && Number.isFinite(frameEnergy) && frameEnergy !== 0 ? frameEnergy : m?.fragEnergy;
  return e != null && Number.isFinite(e) ? Math.abs(e) : undefined;
}

function recordsOf(buf: ArrayBuffer, layout: Layout, startAt: number, pad = 0): { dv: DataView; start: number; stride: number; n: number } {
  const dv = new DataView(buf);
  let start = buf.byteLength >= startAt + 4 ? dv.getInt32(startAt, true) : -1;
  const stride = layout.size + pad;
  if (!(start > 0 && start < buf.byteLength)) start = buf.byteLength % stride; // fall back to "records fill the tail"
  return { dv, start, stride, n: Math.floor((buf.byteLength - start) / stride) };
}

export async function openIms(input: InputBundle, files: AcqFiles, ctx: ReaderContext): Promise<SpectrumSource> {
  for (const k of ['imsframe.xsd', 'msscan.xsd', 'msscan.bin', 'msprofile.bin']) if (!files[k]) throw new Error(`Agilent IMS .d: AcqData/${k} is missing.`);
  const meta = await readMeta(files, input.name);
  meta.sourceFormat = 'Agilent MassHunter .d (ion mobility)';
  const cal = await loadCalibration(files);
  const methods = files['imsframemeth.xml'] ? parseFrameMethods(await files['imsframemeth.xml'].file.text()) : new Map<number, FrameMethod>();
  const binsPerFrame = Math.max(1, ...[...methods.values()].map((m) => m.maxMsPerFrame)) - 1;

  // Frames
  const ft = parseXsd(await files['imsframe.xsd']!.file.text());
  const fl = layoutOf(ft, 'FrameRecordType');
  const fbuf = await files['imsframe.bin']!.file.arrayBuffer();
  const fr = recordsOf(fbuf, fl, 0x48);
  const frames = new Map<number, { method: number; rt: number; fragClass?: number; fragEnergy?: number; tic?: number; massCalOffset?: number }>();
  for (let i = 0; i < fr.n; i++) {
    const b = fr.start + i * fr.stride;
    const g = (n: string) => readField(fr.dv, b, fl.fields.get(n));
    frames.set(g('FrameId') ?? i + 1, { method: g('FrameMethodId') ?? 1, rt: g('FrameScanTime') ?? 0, fragClass: g('FragClass'), fragEnergy: g('FragEnergy'), tic: g('FrameTic'), massCalOffset: g('MassCalOffset') });
  }

  // Drift scans
  const st = parseXsd(await files['msscan.xsd']!.file.text());
  const sl = layoutOf(st, 'ScanRecordType');
  if (!sl.fields.has('FrameID') || !sl.fields.has('MsProfOffset')) throw new Error('Agilent IMS .d: unrecognised MSScan.xsd layout (no FrameID/MsProfOffset).');
  const sbuf = await files['msscan.bin']!.file.arrayBuffer();
  const pad = sbuf.byteLength >= 0x58 ? Math.max(0, new DataView(sbuf).getInt32(0x54, true)) : 0;
  const sr = recordsOf(sbuf, sl, 0x58, pad);
  interface Scan { frame: number; bin: number; offset: number; bytes: number; points: number; full?: number; tic: number }
  const scans: Scan[] = [];
  const profile = files['msprofile.bin']!.file;
  for (let i = 0; i < sr.n; i++) {
    const b = sr.start + i * sr.stride;
    const g = (n: string) => readField(sr.dv, b, sl.fields.get(n));
    const bin = g('DriftBin') ?? 0, points = g('MsProfPointCount') ?? 0, bytes = g('MsProfByteCount') ?? 0, offset = g('MsProfOffset') ?? -1;
    if (bin <= 0 || points <= 0 || bytes <= 0 || offset < 0 || offset + bytes > profile.size) continue;
    scans.push({ frame: g('FrameID') ?? 0, bin, offset, bytes, points, full: g('MsProfFullByteCount'), tic: g('TIC') ?? 0 });
  }

  return {
    meta, count: scans.length,
    async *spectra() {
      for (let i = 0; i < scans.length; i++) {
        if (ctx.signal.aborted) throw new DOMException('Cancelled.', 'AbortError');
        const s = scans[i];
        const f = frames.get(s.frame);
        const m = methods.get(f?.method ?? 1);
        const seg = new Uint8Array(await profile.slice(s.offset, s.offset + s.bytes).arrayBuffer());
        const d = decodeProfile(seg, s.points, s.full);
        const c = cal.forScan(m?.calId, f?.massCalOffset, i);
        if (!d.isMz) { if (!c) throw new Error('Agilent IMS .d: no mass calibration (DefaultMassCal.xml).'); for (let k = 0; k < d.x.length; k++) d.x[k] = tofToMz(d.x[k], c); }
        const lower = d.x.length ? d.x[0] : undefined;
        const { x, y } = trimZeros(d.x, d.y);
        let bpI = 0, bpM = 0;
        for (let k = 0; k < y.length; k++) if (y[k] > bpI) { bpI = y[k]; bpM = x[k]; }
        const msLevel = f?.fragClass === 2 ? 2 : 1;
        const high = x.length ? x[x.length - 1] : lower;
        const window: [number, number] | undefined = lower != null && high != null ? [lower, high] : undefined;
        const ce = msLevel === 2 ? energyAt(m, f?.fragEnergy, s.bin - 1) : undefined;
        const rec: SpectrumRecord = {
          index: i, nativeId: `scanId=${(s.frame - 1) * binsPerFrame + s.bin - 1}`, msLevel, rtSeconds: (f?.rt ?? 0) * 60,
          polarity: m?.polarity === 1 ? '-' : m?.polarity === 0 ? '+' : undefined, centroided: false,
          tic: s.tic, basePeakMz: bpM, basePeakIntensity: bpI, lowMz: x.length ? x[0] : undefined, highMz: high, scanWindow: window,
          ionMobility: m?.dtPeriod ? { value: (s.bin - 1) * m.dtPeriod, cv: DRIFT_TIME, unit: MS_UNIT } : undefined,
          // All-ions (no isolation): the precursor "window" is the scanned m/z range, as msconvert writes it.
          precursors: msLevel === 2 && window ? [{ mz: (window[0] + window[1]) / 2, isolationTarget: (window[0] + window[1]) / 2, isolationLower: (window[1] - window[0]) / 2, isolationUpper: (window[1] - window[0]) / 2, activation: [CV.cid], collisionEnergy: ce }] : [],
          mz: x, intensity: y,
          userParams: [{ name: 'Agilent frame', value: String(s.frame) }, { name: 'Agilent drift bin', value: String(s.bin) }],
        };
        yield rec;
        if (i % 100 === 0) ctx.progress(i / scans.length, 'Reading drift scans');
      }
      ctx.progress(1);
    },
    async *chromatograms() {
      const ids = [...frames.keys()].sort((a, b) => a - b);
      yield { index: 0, id: 'TIC', time: Float64Array.from(ids, (k) => frames.get(k)!.rt), intensity: Float64Array.from(ids, (k) => { const t = frames.get(k)!.tic; return t != null && Number.isFinite(t) ? t : 0; }), type: CV.ticChrom };
    },
  };
}
