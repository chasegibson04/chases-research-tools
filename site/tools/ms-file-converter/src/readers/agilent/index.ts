// Agilent MassHunter .d reader (no vendor DLLs). Reverse-engineered from the files themselves, with the public
// structure notes of rainbow-api (LGPL, used as documentation only; no code copied) and checked against
// ProteoWizard's Reader_Agilent test outputs (which use the Agilent MHDAC DLLs).
//   AcqData/MSScan.xsd   record layout of MSScan.bin (parsed, so each instrument generation's layout is honoured)
//   AcqData/MSScan.bin   header (0x4C blocks per record, 0x54 padding bytes, 0x58 first record) + one record per scan
//   AcqData/MSProfile.bin / MSPeak.bin   spectrum segments (decode.ts)
//   AcqData/MSMassCal.bin / DefaultMassCal.xml   TOF calibration (calibration.ts)
//   AcqData/MSTS.xml     time segments (scan count; MSScan.bin may be preallocated)
//   AcqData/IMSFrame.bin + IMSFrame.xsd   ion-mobility frames (ims.ts)
// MRM (ScanType 256) and SIM (2) scans become chromatograms, as in msconvert; every other scan is a spectrum.
import { CV, type InputBundle, type InputFormat, type SpectrumRecord, type SpectrumSource, type ReaderContext, type ChromatogramRecord, type Precursor } from '../../model';
import { parseXsd, layoutOf, readField, type Layout } from './xsd';
import { tofToMz } from './calibration';
import { acqFiles, readMeta, loadCalibration, MS, type AcqFiles } from './common';
import { decodePeaks, decodeProfile, trimZeros, type Decoded } from './decode';
import { openIms } from './ims';

export const SCAN_TYPE: Record<number, string> = {
  1: 'Scan', 2: 'SelectedIon', 4: 'HighResolutionScan', 8: 'TotalIon', 16: 'MultipleReaction (unspecified)', 256: 'MultipleReaction',
  512: 'ProductIon', 1024: 'PrecursorIon', 2048: 'NeutralLoss', 4096: 'NeutralGain',
};

interface ScanRec {
  scanId: number; timeMin: number; msLevel: number; scanType: number; tic: number; bpMz: number; bpInt: number;
  calId?: number; polarity?: number; fragmentor?: number; ce?: number; mzOfInterest?: number; rangeMin?: number; rangeMax?: number;
  massCalOffset?: number;
  blocks: Array<{ fmt: number; offset: number; bytes: number; points: number; uncompressed?: number; minX?: number; maxX?: number }>;
}

export interface MsScanIndex { recs: ScanRec[]; blocksPerRecord: number }

export async function readMsScan(files: AcqFiles): Promise<MsScanIndex> {
  const xsd = await files['msscan.xsd']!.file.text();
  const types = parseXsd(xsd);
  if (!types.has('ScanRecordType') || !types.has('SpectrumParamsType')) throw new Error('MSScan.xsd: ScanRecordType/SpectrumParamsType not found (unsupported MassHunter layout).');
  const scalar: Layout = layoutOf(types, 'ScanRecordType', 'SpectrumParamValues');
  const block: Layout = layoutOf(types, 'SpectrumParamsType');
  const buf = await files['msscan.bin']!.file.arrayBuffer();
  const dv = new DataView(buf);
  if (buf.byteLength < 0x60) throw new Error('MSScan.bin is too short.');
  let nb = dv.getInt32(0x4c, true);
  const pad = Math.max(0, dv.getInt32(0x54, true));
  const start = dv.getInt32(0x58, true);
  const body = buf.byteLength - start;
  let msts: number | null = null;
  if (files['msts.xml']) {
    const t = await files['msts.xml'].file.text();
    const counts = [...t.matchAll(/<NumOfScans>\s*(\d+)\s*<\/NumOfScans>/g)].map((m) => Number(m[1]));
    if (counts.length) msts = counts.reduce((a, b) => a + b, 0);
  }
  if (!(nb >= 1 && nb <= 8)) {
    // Older/unknown header: infer the block count from the file geometry.
    nb = 1;
    for (let k = 1; k <= 8; k++) { const s = scalar.size + k * block.size + pad; if (body % s === 0 && (msts == null || body / s === msts)) { nb = k; break; } }
  }
  const stride = scalar.size + nb * block.size + pad;
  let n = Math.floor(body / stride);
  if (msts != null && msts < n) n = msts; // preallocated MSScan.bin
  const f = (name: string, base: number) => readField(dv, base, scalar.fields.get(name));
  const recs: ScanRec[] = [];
  for (let i = 0; i < n; i++) {
    const b = start + i * stride;
    const blocks: ScanRec['blocks'] = [];
    for (let k = 0; k < nb; k++) {
      const bb = b + scalar.size + k * block.size;
      const g = (name: string) => readField(dv, bb, block.fields.get(name));
      blocks.push({ fmt: g('SpectrumFormatID') ?? 0, offset: g('SpectrumOffset') ?? 0, bytes: g('ByteCount') ?? 0, points: g('PointCount') ?? 0, uncompressed: g('UncompressedByteCount'), minX: g('MinX'), maxX: g('MaxX') });
    }
    recs.push({
      scanId: f('ScanID', b) ?? i + 1, timeMin: f('ScanTime', b) ?? 0, msLevel: f('MSLevel', b) ?? 1, scanType: f('ScanType', b) ?? 1,
      tic: f('TIC', b) ?? 0, bpMz: f('BasePeakMZ', b) ?? 0, bpInt: f('BasePeakValue', b) ?? 0, calId: f('CalibrationID', b), polarity: f('IonPolarity', b),
      fragmentor: f('Fragmentor', b), ce: f('CollisionEnergy', b), mzOfInterest: f('MzOfInterest', b), rangeMin: f('MeasuredMassRangeMin', b), rangeMax: f('MeasuredMassRangeMax', b),
      massCalOffset: f('MassCalOffset', b), blocks,
    });
  }
  // A preallocated MSScan.bin without MSTS.xml ends in empty records.
  while (recs.length > 1 && msts == null && recs[recs.length - 1].scanId === 0 && recs[recs.length - 1].timeMin === 0) recs.pop();
  return { recs, blocksPerRecord: nb };
}

export { acqFiles, type AcqFiles };

const isChromScan = (t: number) => t === 256 || t === 2;
const MULTI_STAGE = new Set([512, 1024, 2048, 4096]);

function precursorsOf(r: ScanRec, window: [number, number] | undefined): Precursor[] {
  if (r.msLevel < 2 && !MULTI_STAGE.has(r.scanType)) return [];
  const ce = r.ce != null ? Math.abs(r.ce) : undefined;
  const activation = [CV.hcd];
  if (r.scanType === 512 || !window) return r.mzOfInterest ? [{ mz: r.mzOfInterest, isolationTarget: r.mzOfInterest, activation, collisionEnergy: ce }] : [];
  // Precursor-ion / neutral-loss scans: the first quadrupole sweeps the scan range.
  const c = (window[0] + window[1]) / 2, h = (window[1] - window[0]) / 2;
  return [{ mz: c, isolationTarget: c, isolationLower: h, isolationUpper: h, activation, collisionEnergy: ce }];
}

export async function openMassHunter(input: InputBundle, ctx: ReaderContext): Promise<SpectrumSource> {
  const files = acqFiles(input);
  if (files['imsframe.bin']) return openIms(input, files, ctx);
  const meta = await readMeta(files, input.name);
  ctx.progress(0.01, 'Reading MSScan.bin');
  const { recs, blocksPerRecord } = await readMsScan(files);
  const cal = await loadCalibration(files);
  const profile = files['msprofile.bin']?.file, peak = files['mspeak.bin']?.file;
  if (!profile && !peak) throw new Error('Agilent .d: neither MSProfile.bin nor MSPeak.bin is present in AcqData.');

  /** Which block/file holds the data for this scan. Two blocks = profile then peak. With one block the
   *  SpectrumFormatID is not reliable across instrument generations, so: MRM/SIM scans and format 3 → MSPeak.bin. */
  const pick = (r: ScanRec, preferPeak: boolean) => {
    const one = r.blocks[0];
    const onePeak = !!peak && (!profile || one.fmt === 3 || isChromScan(r.scanType));
    const prof = blocksPerRecord >= 2 ? r.blocks[0] : onePeak ? undefined : one;
    const pk = blocksPerRecord >= 2 ? r.blocks[1] : onePeak ? one : undefined;
    const fit = (b: ScanRec['blocks'][number] | undefined, f: Blob | undefined) => !!(b && f && b.points > 0 && b.offset >= 0 && b.offset + b.bytes <= f.size);
    const useProf = fit(prof, profile), usePeak = fit(pk, peak);
    if (usePeak && (preferPeak || !useProf)) return { block: pk!, file: peak!, centroid: true };
    if (useProf) return { block: prof!, file: profile!, centroid: false };
    return null;
  };

  const decode = async (r: ScanRec, i: number, which: NonNullable<ReturnType<typeof pick>>): Promise<Decoded & { window?: [number, number] }> => {
    const { block, file, centroid } = which;
    const seg = new Uint8Array(await file.slice(block.offset, block.offset + block.bytes).arrayBuffer());
    const d = centroid ? decodePeaks(seg, block.points) : decodeProfile(seg, block.points, block.uncompressed);
    if (!d.isMz) {
      const c = cal.forScan(r.calId, r.massCalOffset, i);
      // Peaks of quadrupole instruments (no calibration files) are already m/z.
      if (!c && !centroid) throw new Error('Agilent .d: TOF profile data but no DefaultMassCal.xml / MSMassCal.bin calibration.');
      if (c) { const x = d.x; for (let k = 0; k < x.length; k++) x[k] = tofToMz(x[k], c); }
      d.isMz = true;
    }
    const window: [number, number] | undefined = r.rangeMin != null && r.rangeMax != null && r.rangeMax > r.rangeMin ? [r.rangeMin, r.rangeMax]
      : !centroid && d.x.length ? [d.x[0], d.x[d.x.length - 1]] : undefined;
    return { ...d, window };
  };

  const spectrumIdx = recs.map((r, i) => (isChromScan(r.scanType) ? -1 : i)).filter((i) => i >= 0);
  return {
    meta,
    count: spectrumIdx.length,
    async *spectra() {
      let out = 0;
      for (let j = 0; j < spectrumIdx.length; j++) {
        if (ctx.signal.aborted) throw new DOMException('Cancelled.', 'AbortError');
        const i = spectrumIdx[j], r = recs[i];
        const which = pick(r, false);
        if (!which) continue; // segment missing (truncated acquisition) or empty scan
        const d = await decode(r, i, which);
        const { x, y } = which.centroid ? d : trimZeros(d.x, d.y);
        const rec: SpectrumRecord = {
          index: out++, nativeId: `scanId=${r.scanId}`, scan: r.scanId, msLevel: Math.max(1, r.msLevel), rtSeconds: r.timeMin * 60,
          polarity: r.polarity === 1 ? '-' : r.polarity === 0 ? '+' : undefined, centroided: which.centroid,
          tic: r.tic, basePeakMz: r.bpMz, basePeakIntensity: r.bpInt, lowMz: x.length ? x[0] : undefined, highMz: x.length ? x[x.length - 1] : undefined,
          scanWindow: d.window, precursors: precursorsOf(r, d.window), mz: x, intensity: y,
          cvParams: r.scanType === 2048 || r.scanType === 4096 ? [MS('MS:1000326', 'constant neutral loss spectrum')] : r.scanType === 1024 ? [MS('MS:1000341', 'precursor ion spectrum')] : undefined,
          userParams: [{ name: 'Agilent scan type', value: SCAN_TYPE[r.scanType] ?? String(r.scanType) }, ...(r.fragmentor != null ? [{ name: 'Agilent fragmentor voltage', value: String(Math.abs(r.fragmentor)) }] : [])],
        };
        if (r.scanType === 2048 || r.scanType === 4096 || r.scanType === 1024) rec.userParams!.push({ name: 'analyzer scan offset', value: String(r.mzOfInterest ?? '') });
        yield rec;
        if (j % 25 === 0) ctx.progress(0.05 + 0.95 * (j / spectrumIdx.length), 'Reading spectra');
      }
      ctx.progress(1);
    },
    async *chromatograms() {
      const tic: ChromatogramRecord = { index: 0, id: 'TIC', time: Float64Array.from(recs, (r) => r.timeMin), intensity: Float64Array.from(recs, (r) => r.tic), type: CV.ticChrom };
      yield tic;
      // SRM/SIM traces: one per (polarity, Q1, CE, transition index within the scan); Q3 from the first scan.
      const traces = new Map<string, { q1: number; q3?: number; pol?: number; ce?: number; srm: boolean; t: number[]; y: number[] }>();
      for (let i = 0; i < recs.length; i++) {
        const r = recs[i];
        if (!isChromScan(r.scanType)) continue;
        if (ctx.signal.aborted) throw new DOMException('Cancelled.', 'AbortError');
        const which = pick(r, true);
        if (!which) continue;
        const d = await decode(r, i, which);
        const q1 = r.mzOfInterest ?? 0, srm = r.scanType === 256;
        const n = srm ? d.x.length : Math.min(1, d.x.length);
        for (let k = 0; k < n; k++) {
          const key = `${srm}|${r.polarity}|${q1}|${r.ce ?? ''}|${k}`;
          let tr = traces.get(key);
          if (!tr) { tr = { q1, q3: srm ? Math.round(d.x[k] * 1e4) / 1e4 : undefined, pol: r.polarity, ce: r.ce, srm, t: [], y: [] }; traces.set(key, tr); }
          tr.t.push(r.timeMin); tr.y.push(srm ? d.y[k] : d.y.reduce((a, b) => a + b, 0));
        }
      }
      let idx = 1;
      for (const tr of traces.values()) {
        const pre = tr.pol === 1 ? '- ' : ''; // msconvert's id convention
        yield {
          index: idx++, id: tr.srm ? `${pre}SRM SIC Q1=${tr.q1} Q3=${tr.q3}` : `${pre}SIM SIC Q1=${tr.q1}`,
          time: Float64Array.from(tr.t), intensity: Float64Array.from(tr.y), type: tr.srm ? CV.srmChrom : MS('MS:1001472', 'selected ion monitoring chromatogram'),
          precursorMz: tr.q1, productMz: tr.q3,
        };
      }
    },
  };
}

export const agilentD: InputFormat = {
  id: 'agilent-d',
  label: 'Agilent MassHunter .d',
  async detect(input) {
    const f = acqFiles(input);
    return !!(f['msscan.bin'] && f['msscan.xsd'] && (f['msprofile.bin'] || f['mspeak.bin']));
  },
  open: openMassHunter,
};

