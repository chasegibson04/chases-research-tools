// Bruker timsTOF TDF reader (analysis.tdf SQLite + analysis.tdf_bin frames): DDA-PASEF, diaPASEF, prm-PASEF and
// plain MS/MS frames. Frame decoding and quadrupole-settings logic ported from timsrust (MIT, MannLabs):
// crates/timsrust-tdf/src/{frame_reader.rs, quad_settings_reader.rs, precursor_reader/dda.rs}; calibration in
// ./calibration.ts. Output semantics follow ProteoWizard msconvert (checked against the pwiz reference mzML):
//   combineIonMobility = false (msconvert default): one spectrum per (frame, scan), empty scans included,
//     nativeID "frame=F scan=S" (S = 0-based scan + 1), spectrum-level 1/K0, precursor on scans inside a window.
//   combineIonMobility = true (msconvert --combineIonMobilitySpectra): one spectrum per MS1 frame and one per
//     (MS2 frame, isolation window), nativeID "merged=K frame=F scanStart=A scanEnd=B"; peaks of all scans are
//     concatenated and sorted by m/z (identical TOF indices are NOT summed, like pwiz) with a per-peak
//     "mean inverse reduced ion mobility array".
import type { Database } from 'sql.js';
import { CV, type CvParam, type InputBundle, type Precursor, type ReaderContext, type SpectrumRecord, type SpectrumSource, type UserParam } from '../../model';
import { readTdfFrame, type FrameIons } from './binary';
import { ImConverter, MzConverter } from './calibration';
import { buildMetadata } from './metadata';
import { hasTable, num, openDatabase, query, type Row } from './sqlite';

export interface TdfOptions { combineIonMobility: boolean }

interface Frame {
  id: number; time: number; polarity?: '+' | '-'; msMsType: number; timsId: number; numScans: number;
  mzCal: number; timsCal: number; t1: number; t2: number;
}

/** One quadrupole isolation window inside a frame, scans [scanBegin, scanEnd) 0-based. */
interface Window {
  scanBegin: number; scanEnd: number; isolationMz: number; isolationWidth: number; collisionEnergy?: number;
  kind: 'pasef' | 'dia' | 'prm' | 'frame';
  precursor?: { mz: number; charge?: number; intensity?: number; scanNumber?: number; largestPeakMz?: number };
  windowGroup?: number; target?: number; triggerCharge?: number;
}

const msLevelOf = (msMsType: number) => (msMsType === 0 ? 1 : 2);

function loadFrames(db: Database): Frame[] {
  return query(db, 'SELECT * FROM Frames ORDER BY Id').map((r) => ({
    id: Number(r.Id), time: Number(r.Time), polarity: r.Polarity === '+' || r.Polarity === '-' ? r.Polarity : undefined,
    msMsType: Number(r.MsMsType ?? 0), timsId: Number(r.TimsId ?? 0), numScans: Number(r.NumScans ?? 0),
    mzCal: Number(r.MzCalibration ?? 1), timsCal: Number(r.TimsCalibration ?? 1), t1: Number(r.T1 ?? 0), t2: Number(r.T2 ?? 0),
  }));
}

/** Quadrupole settings per frame, ported from timsrust quad_settings_reader.rs (DDA / DIA / PRM tables). */
function loadWindows(db: Database, frames: Frame[]): Map<number, Window[]> {
  const out = new Map<number, Window[]>();
  const add = (f: number, w: Window) => { const a = out.get(f); if (a) a.push(w); else out.set(f, [w]); };
  if (hasTable(db, 'PasefFrameMsMsInfo')) {
    const prec = new Map<number, Row>();
    if (hasTable(db, 'Precursors')) for (const r of query(db, 'SELECT * FROM Precursors')) prec.set(Number(r.Id), r);
    for (const r of query(db, 'SELECT * FROM PasefFrameMsMsInfo ORDER BY Frame, ScanNumBegin')) {
      const p = r.Precursor != null ? prec.get(Number(r.Precursor)) : undefined;
      add(Number(r.Frame), {
        kind: 'pasef', scanBegin: Number(r.ScanNumBegin), scanEnd: Number(r.ScanNumEnd), isolationMz: Number(r.IsolationMz),
        isolationWidth: Number(r.IsolationWidth), collisionEnergy: num(r.CollisionEnergy),
        precursor: p ? {
          mz: num(p.MonoisotopicMz) ?? Number(p.LargestPeakMz), largestPeakMz: num(p.LargestPeakMz), charge: num(p.Charge),
          intensity: num(p.Intensity), scanNumber: num(p.ScanNumber),
        } : undefined,
      });
    }
  }
  if (hasTable(db, 'DiaFrameMsMsInfo') && hasTable(db, 'DiaFrameMsMsWindows')) {
    const groups = new Map<number, Row[]>();
    for (const r of query(db, 'SELECT * FROM DiaFrameMsMsWindows ORDER BY WindowGroup, ScanNumBegin')) {
      const g = Number(r.WindowGroup); const a = groups.get(g); if (a) a.push(r); else groups.set(g, [r]);
    }
    for (const r of query(db, 'SELECT * FROM DiaFrameMsMsInfo ORDER BY Frame')) {
      const g = Number(r.WindowGroup);
      for (const w of groups.get(g) ?? []) add(Number(r.Frame), {
        kind: 'dia', windowGroup: g, scanBegin: Number(w.ScanNumBegin), scanEnd: Number(w.ScanNumEnd), isolationMz: Number(w.IsolationMz),
        isolationWidth: Number(w.IsolationWidth), collisionEnergy: num(w.CollisionEnergy),
      });
    }
  }
  if (hasTable(db, 'PrmFrameMsMsInfo')) {
    for (const r of query(db, 'SELECT * FROM PrmFrameMsMsInfo ORDER BY Frame, ScanNumBegin')) add(Number(r.Frame), {
      kind: 'prm', scanBegin: Number(r.ScanNumBegin), scanEnd: Number(r.ScanNumEnd), isolationMz: Number(r.IsolationMz),
      isolationWidth: Number(r.IsolationWidth), collisionEnergy: num(r.CollisionEnergy), target: num(r.Target),
    });
  }
  if (hasTable(db, 'FrameMsMsInfo')) {
    const byId = new Map(frames.map((f) => [f.id, f]));
    for (const r of query(db, 'SELECT * FROM FrameMsMsInfo ORDER BY Frame')) {
      const fid = Number(r.Frame);
      if (out.has(fid)) continue;
      add(fid, {
        kind: 'frame', scanBegin: 0, scanEnd: byId.get(fid)?.numScans ?? 0, isolationMz: Number(r.TriggerMass),
        isolationWidth: Number(r.IsolationWidth), collisionEnergy: num(r.CollisionEnergy), triggerCharge: num(r.PrecursorCharge),
      });
    }
  }
  for (const a of out.values()) a.sort((x, y) => x.scanBegin - y.scanBegin);
  return out;
}

function precursorOf(w: Window): Precursor {
  const half = w.isolationWidth / 2;
  const p: Precursor = {
    mz: w.precursor?.mz ?? w.isolationMz, isolationTarget: w.isolationMz, isolationLower: half, isolationUpper: half,
    activation: [CV.cid], collisionEnergy: w.collisionEnergy != null ? Math.abs(w.collisionEnergy) : undefined,
  };
  const charge = w.precursor?.charge ?? w.triggerCharge;
  if (charge) p.charge = charge;
  if (w.precursor?.intensity != null) p.intensity = w.precursor.intensity;
  return p;
}

const imParam = (value: number) => ({ value, cv: { accession: CV.invMobility.accession, name: CV.invMobility.name } as CvParam, unit: { accession: 'MS:1002814', name: 'volt-second per square centimeter' } as CvParam });

function summarize(rec: SpectrumRecord): SpectrumRecord {
  const { mz, intensity } = rec;
  let tic = 0, bpi = 0, bpm = 0, lo = Infinity, hi = -Infinity;
  for (let i = 0; i < mz.length; i++) {
    const v = intensity[i]; tic += v;
    if (v > bpi) { bpi = v; bpm = mz[i]; }
    if (mz[i] < lo) lo = mz[i]; if (mz[i] > hi) hi = mz[i];
  }
  rec.tic = tic;
  if (mz.length) { rec.basePeakMz = bpm; rec.basePeakIntensity = bpi; rec.lowMz = lo; rec.highMz = hi; }
  return rec;
}

/** Concatenate the peaks of scans [s0, s1) and sort them by TOF index (stable, i.e. ties keep scan order). */
function combineScans(ions: FrameIons, s0: number, s1: number, mzc: MzConverter, imOfScan: Float64Array) {
  s1 = Math.min(s1, ions.scanCount);
  s0 = Math.max(0, s0);
  if (s1 <= s0) return { mz: new Float64Array(0), intensity: new Float64Array(0), im: new Float64Array(0) };
  const p0 = ions.scanOffsets[s0], p1 = ions.scanOffsets[s1], n = p1 - p0;
  let maxTof = 0;
  for (let p = p0; p < p1; p++) if (ions.tof[p] > maxTof) maxTof = ions.tof[p];
  // Counting sort on the TOF index: O(n + maxTof), stable.
  const counts = new Uint32Array(maxTof + 2);
  for (let p = p0; p < p1; p++) counts[ions.tof[p] + 1]++;
  for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1];
  const mz = new Float64Array(n), intensity = new Float64Array(n), im = new Float64Array(n);
  const tofOut = new Uint32Array(n);
  for (let s = s0; s < s1; s++) {
    const k = imOfScan[s];
    for (let p = ions.scanOffsets[s]; p < ions.scanOffsets[s + 1]; p++) {
      const t = ions.tof[p], o = counts[t]++;
      tofOut[o] = t; intensity[o] = ions.intensity[p]; im[o] = k;
    }
  }
  let lastTof = -1, lastMz = 0;
  for (let i = 0; i < n; i++) { if (tofOut[i] !== lastTof) { lastTof = tofOut[i]; lastMz = mzc.convert(lastTof); } mz[i] = lastMz; }
  return { mz, intensity, im };
}

export async function openTdf(input: InputBundle, tdf: { path: string; file: Blob }, bin: { path: string; file: Blob }, ctx: ReaderContext, opts: TdfOptions): Promise<SpectrumSource> {
  ctx.progress(0, 'Reading analysis.tdf');
  const db = await openDatabase(tdf.file);
  const g: Record<string, string> = {};
  for (const r of query(db, 'SELECT Key, Value FROM GlobalMetadata')) g[String(r.Key)] = r.Value == null ? '' : String(r.Value);
  const compression = Number(g.TimsCompressionType ?? 2);
  if (compression !== 1 && compression !== 2) throw new Error(`Unsupported TDF compression type ${compression}.`);
  const maxPeaksPerScan = Number(g.MaxNumPeaksPerScan ?? 0);
  const frames = loadFrames(db);
  const windows = loadWindows(db, frames);
  const mzCals = new Map<number, Row>(query(db, 'SELECT * FROM MzCalibration').map((r) => [Number(r.Id), r]));
  const timsCals = new Map<number, Row>(hasTable(db, 'TimsCalibration') ? query(db, 'SELECT * FROM TimsCalibration').map((r) => [Number(r.Id), r]) : []);
  const isMaldi = hasTable(db, 'MaldiFrameInfo');
  db.close();
  const imLo = Number(g.OneOverK0AcqRangeLower ?? 0), imHi = Number(g.OneOverK0AcqRangeUpper ?? 0);
  const maxScans = frames.reduce((m, f) => Math.max(m, f.numScans), 0);
  const imConv = new Map<number, ImConverter>();
  const imFor = (id: number) => { let c = imConv.get(id); if (!c) imConv.set(id, (c = new ImConverter(timsCals.get(id), imLo, imHi, maxScans))); return c; };
  const scanWindow: [number, number] | undefined = g.MzAcqRangeLower != null && g.MzAcqRangeUpper != null ? [Number(g.MzAcqRangeLower), Number(g.MzAcqRangeUpper)] : undefined;

  const meta = buildMetadata('TDF', input, tdf.path, bin.path, g);
  let count = 0;
  for (const f of frames) {
    if (!opts.combineIonMobility) count += f.numScans;
    else count += msLevelOf(f.msMsType) === 1 ? 1 : Math.max(1, windows.get(f.id)?.length ?? 0);
  }

  async function* spectra(): AsyncIterable<SpectrumRecord> {
    let index = 0, merged = 0;
    for (let fi = 0; fi < frames.length; fi++) {
      if (ctx.signal.aborted) throw new Error('Cancelled.');
      const f = frames[fi];
      const cal = mzCals.get(f.mzCal) ?? mzCals.values().next().value;
      if (!cal) throw new Error('analysis.tdf has no MzCalibration table rows.');
      const mzc = new MzConverter(cal, f.t1, f.t2);
      const imc = imFor(f.timsCal);
      const ions = await readTdfFrame(bin.file, f.timsId, compression, maxPeaksPerScan, f.numScans);
      const nScans = f.numScans;
      const imOfScan = new Float64Array(Math.max(nScans, ions.scanCount));
      for (let s = 0; s < imOfScan.length; s++) imOfScan[s] = imc.convert(s);
      const msLevel = msLevelOf(f.msMsType);
      const ws = msLevel === 1 ? [] : windows.get(f.id) ?? [];
      const base = (): Omit<SpectrumRecord, 'index' | 'nativeId' | 'mz' | 'intensity'> => ({
        msLevel, rtSeconds: isMaldi ? undefined : f.time, polarity: f.polarity, centroided: true, scanWindow, precursors: [],
      });

      if (opts.combineIonMobility) {
        const groups: Array<{ s0: number; s1: number; w?: Window }> = ws.length ? ws.map((w) => ({ s0: w.scanBegin, s1: w.scanEnd, w })) : [{ s0: 0, s1: nScans }];
        for (const grp of groups) {
          const s1 = Math.min(grp.s1, nScans);
          const c = combineScans(ions, grp.s0, s1, mzc, imOfScan);
          const userParams: UserParam[] = [
            { name: 'ion mobility lower limit', value: String(imc.convert(Math.max(grp.s0, s1 - 1))), type: 'xsd:double' },
            { name: 'ion mobility upper limit', value: String(imc.convert(grp.s0)), type: 'xsd:double' },
          ];
          if (grp.w?.windowGroup != null) userParams.push({ name: 'windowGroup', value: String(grp.w.windowGroup) });
          const rec: SpectrumRecord = {
            ...base(), index, nativeId: `merged=${merged} frame=${f.id} scanStart=${grp.s0 + 1} scanEnd=${s1}`,
            mz: c.mz, intensity: c.intensity,
            arrays: [{ name: 'mean inverse reduced ion mobility array', cv: CV.meanInvMobilityArray, values: c.im }],
            precursors: grp.w ? [precursorOf(grp.w)] : [],
            userParams,
          };
          if (grp.w?.precursor?.scanNumber != null) rec.ionMobility = imParam(imc.convert(grp.w.precursor.scanNumber));
          yield summarize(rec);
          index++; merged++;
        }
      } else {
        let wi = 0;
        for (let s = 0; s < nScans; s++) {
          if (ctx.signal.aborted) throw new Error('Cancelled.');
          while (wi < ws.length && ws[wi].scanEnd <= s) wi++;
          const w = wi < ws.length && ws[wi].scanBegin <= s && s < ws[wi].scanEnd ? ws[wi] : undefined;
          let mz: Float64Array, intensity: Float64Array;
          if (s < ions.scanCount) {
            const p0 = ions.scanOffsets[s], p1 = ions.scanOffsets[s + 1];
            mz = new Float64Array(p1 - p0); intensity = new Float64Array(p1 - p0);
            for (let p = p0; p < p1; p++) { mz[p - p0] = mzc.convert(ions.tof[p]); intensity[p - p0] = ions.intensity[p]; }
          } else { mz = new Float64Array(0); intensity = new Float64Array(0); }
          const rec: SpectrumRecord = {
            ...base(), index, nativeId: `frame=${f.id} scan=${s + 1}`, mz, intensity,
            ionMobility: imParam(imOfScan[s]), precursors: w ? [precursorOf(w)] : [],
          };
          if (w?.windowGroup != null) rec.userParams = [{ name: 'windowGroup', value: String(w.windowGroup) }];
          yield summarize(rec);
          index++;
        }
      }
      if (fi % 4 === 0) ctx.progress((fi + 1) / frames.length, `Frame ${f.id} of ${frames.length}`);
    }
    ctx.progress(1, 'Done');
  }

  return { meta, count, spectra };
}
