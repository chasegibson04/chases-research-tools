// Bruker TSF reader (timsTOF without ion mobility, incl. timsTOF fleX MALDI): analysis.tsf SQLite + analysis.tsf_bin.
// One spectrum per frame, nativeID "frame=F". Line-spectrum decoding ported from timsrust (MIT, MannLabs)
// crates/timsrust-tsf/src/{blobs.rs, spectrum.rs}; the profile spectrum and the calibrated m/z are our additions.
// Like ProteoWizard, profile spectra are emitted when the file has them (TOF samples with signal plus one zero
// on each side, plus the first and last sample), otherwise the centroided line spectra.
import { CV, type InputBundle, type Precursor, type ReaderContext, type SpectrumRecord, type SpectrumSource, type UserParam } from '../../model';
import { readTsfFrame } from './binary';
import { MzConverter } from './calibration';
import { buildMetadata } from './metadata';
import { hasTable, num, openDatabase, query, type Row } from './sqlite';

export interface TsfOptions {
  /** 'auto' (default) = profile when the file has profile spectra (msconvert default), else line spectra. */
  spectra: 'auto' | 'profile' | 'centroid';
}

export async function openTsf(input: InputBundle, tsf: { path: string; file: Blob }, bin: { path: string; file: Blob }, ctx: ReaderContext, opts: TsfOptions): Promise<SpectrumSource> {
  ctx.progress(0, 'Reading analysis.tsf');
  const db = await openDatabase(tsf.file);
  const g: Record<string, string> = {};
  for (const r of query(db, 'SELECT Key, Value FROM GlobalMetadata')) g[String(r.Key)] = r.Value == null ? '' : String(r.Value);
  const frames = query(db, 'SELECT * FROM Frames ORDER BY Id');
  const mzCals = new Map<number, Row>(query(db, 'SELECT * FROM MzCalibration').map((r) => [Number(r.Id), r]));
  const msms = new Map<number, Row>(hasTable(db, 'FrameMsMsInfo') ? query(db, 'SELECT * FROM FrameMsMsInfo').map((r) => [Number(r.Frame), r]) : []);
  const maldi = new Map<number, Row>(hasTable(db, 'MaldiFrameInfo') ? query(db, 'SELECT * FROM MaldiFrameInfo').map((r) => [Number(r.Frame), r]) : []);
  db.close();

  const hasProfile = g.HasProfileSpectra === '1';
  const hasLine = g.HasLineSpectra !== '0';
  const wantProfile = opts.spectra === 'profile' ? true : opts.spectra === 'centroid' ? false : hasProfile || !hasLine;
  if (wantProfile && !hasProfile) throw new Error('This TSF file has no profile spectra; choose centroid (line) spectra.');
  if (!wantProfile && !hasLine) throw new Error('This TSF file has no line (centroid) spectra; choose profile spectra.');
  const scanWindow: [number, number] | undefined = g.MzAcqRangeLower != null && g.MzAcqRangeUpper != null ? [Number(g.MzAcqRangeLower), Number(g.MzAcqRangeUpper)] : undefined;
  const meta = buildMetadata('TSF', input, tsf.path, bin.path, g);

  async function* spectra(): AsyncIterable<SpectrumRecord> {
    for (let i = 0; i < frames.length; i++) {
      if (ctx.signal.aborted) throw new Error('Cancelled.');
      const f = frames[i];
      const id = Number(f.Id);
      const cal = mzCals.get(Number(f.MzCalibration ?? 1)) ?? mzCals.values().next().value;
      if (!cal) throw new Error('analysis.tsf has no MzCalibration table rows.');
      const mzc = new MzConverter(cal, Number(f.T1 ?? 0), Number(f.T2 ?? 0));
      const fr = await readTsfFrame(bin.file, Number(f.TimsId), Number(f.NumPeaks ?? 0), wantProfile);
      let mz: Float64Array, intensity: Float64Array;
      if (wantProfile && fr.profile) {
        const p = fr.profile, n = p.length;
        const keep = new Uint8Array(n);
        if (n) { keep[0] = 1; keep[n - 1] = 1; }
        for (let k = 0; k < n; k++) if (p[k]) { keep[k] = 1; if (k > 0) keep[k - 1] = 1; if (k + 1 < n) keep[k + 1] = 1; }
        let m = 0; for (let k = 0; k < n; k++) m += keep[k];
        mz = new Float64Array(m); intensity = new Float64Array(m);
        for (let k = 0, o = 0; k < n; k++) if (keep[k]) { mz[o] = mzc.convert(k); intensity[o] = p[k]; o++; }
      } else if (wantProfile) {
        mz = new Float64Array(0); intensity = new Float64Array(0);
      } else {
        mz = new Float64Array(fr.lineTof.length); intensity = fr.lineIntensity;
        for (let k = 0; k < mz.length; k++) mz[k] = mzc.convert(fr.lineTof[k]);
      }
      const msMsType = Number(f.MsMsType ?? 0);
      const precursors: Precursor[] = [];
      const info = msms.get(id);
      if (msMsType !== 0 && info) {
        const half = Number(info.IsolationWidth) / 2, ce = num(info.CollisionEnergy);
        const p: Precursor = { mz: Number(info.TriggerMass), isolationTarget: Number(info.TriggerMass), isolationLower: half, isolationUpper: half, activation: [CV.cid] };
        if (ce != null) p.collisionEnergy = Math.abs(ce);
        const z = num(info.PrecursorCharge); if (z) p.charge = z;
        if (info.Parent != null) p.spectrumRef = `frame=${Number(info.Parent)}`;
        precursors.push(p);
      }
      const userParams: UserParam[] = [];
      const spot = maldi.get(id);
      if (spot) userParams.push({ name: 'spotID', value: `chip=${spot.Chip ?? 0} spot=${spot.SpotName ?? ''}` });
      let tic = 0, bpi = 0, bpm = 0;
      for (let k = 0; k < mz.length; k++) { tic += intensity[k]; if (intensity[k] > bpi) { bpi = intensity[k]; bpm = mz[k]; } }
      const rec: SpectrumRecord = {
        index: i, nativeId: `frame=${id}`, msLevel: msMsType === 0 ? 1 : 2,
        rtSeconds: spot ? undefined : Number(f.Time), polarity: f.Polarity === '+' || f.Polarity === '-' ? f.Polarity : undefined,
        centroided: !wantProfile, scanWindow, precursors, mz, intensity, tic,
        ...(mz.length ? { basePeakMz: bpm, basePeakIntensity: bpi, lowMz: mz[0], highMz: mz[mz.length - 1] } : {}),
        ...(userParams.length ? { userParams } : {}),
      };
      yield rec;
      ctx.progress((i + 1) / frames.length, `Frame ${id} of ${frames.length}`);
    }
  }
  return { meta, count: frames.length, spectra };
}
