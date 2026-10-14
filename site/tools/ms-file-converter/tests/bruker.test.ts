// Bruker TDF/TSF reader vs ProteoWizard (Bruker TIMS SDK) reference mzML from the public pwiz test data
// (Reader_Bruker_Test.data). Local-only: skipped when the corpus folder is missing.
import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, readdirSync, statSync, openAsBlob } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { indexSpectra, parseSpectrumText, type SpectrumMeta, type FileInfo } from '@/lib/ms/mzml';
import type { InputBundle, ReaderContext, SpectrumRecord } from '../src/model';
import { brukerTdf, brukerTsf, createBrukerTdf, createBrukerTsf } from '../src/readers/bruker';
import { lzfDecompress, unshuffleU32, decodeCompression2 } from '../src/readers/bruker/binary';
import { MzConverter, ImConverter } from '../src/readers/bruker/calibration';

const DATA = process.env.BRUKER_TEST_DATA ?? 'D:/cyclic_seq_frag_public/_test_corpus/vendor_raw/pwiz/Bruker/Reader_Bruker_Test.data';
const ctx: ReaderContext = { progress: () => {}, log: () => {}, signal: new AbortController().signal };

async function bundle(dir: string): Promise<InputBundle> {
  const name = basename(dir);
  const files: InputBundle['files'] = [];
  const walk = async (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) await walk(p);
      else files.push({ path: `${name}/${relative(dir, p).replace(/\\/g, '/')}`, file: await openAsBlob(p) });
    }
  };
  await walk(dir);
  return { name, files };
}

async function collect(src: { spectra(): AsyncIterable<SpectrumRecord> }) {
  const out: SpectrumRecord[] = [];
  for await (const s of src.spectra()) out.push(s);
  return out;
}

interface RefSpectrum { meta: SpectrumMeta; mz: Float64Array; intensity: Float64Array; mobility?: Float64Array; im: number | null; xml: string }
async function readRef(path: string): Promise<{ info: FileInfo; spectra: RefSpectrum[]; head: string }> {
  const file = await openAsBlob(path);
  const { info, spectra } = await indexSpectra(file, basename(path));
  const out: RefSpectrum[] = [];
  for (const m of spectra) {
    const xml = new TextDecoder('latin1').decode(await file.slice(m.start, m.end).arrayBuffer());
    const raw = parseSpectrumText(xml, info);
    const im = /accession="MS:1002815"[^>]*value="([^"]+)"/.exec(xml.slice(0, xml.indexOf('<binaryDataArrayList')));
    out.push({ meta: m, ...raw, im: im ? Number(im[1]) : null, xml });
  }
  const head = new TextDecoder('latin1').decode(await file.slice(0, 16384).arrayBuffer());
  return { info, spectra: out, head };
}

interface Row { dataset: string; mode: string; spectra: string; msLevels: string; rt: string; precursor: string; peaks: string; mzPpm: string; intensity: string; im: string }
const table: Row[] = [];

/** Compare our spectra with the reference, matched by nativeID (the reference may hold a subset of the spectra). */
function compare(dataset: string, mode: string, ours: SpectrumRecord[], ref: RefSpectrum[]) {
  const byId = new Map(ours.map((s) => [s.nativeId, s]));
  let minOff = Infinity, intMaxDiff = 0, missing = 0, levelBad = 0, rtMax = 0, precMax = 0, precN = 0, peakBad = 0, ppmMax = 0, intBad = 0, imMax = 0, imN = 0, nPeaks = 0;
  for (const r of ref) {
    const s = byId.get(r.meta.id);
    if (!s) { missing++; continue; }
    if (s.msLevel !== r.meta.msLevel) levelBad++;
    if (r.meta.rt != null) rtMax = Math.max(rtMax, Math.abs((s.rtSeconds ?? NaN) - r.meta.rt * 60));
    if (r.meta.precursorMz != null) { precN++; precMax = Math.max(precMax, Math.abs((s.precursors[0]?.mz ?? NaN) - r.meta.precursorMz)); }
    if (r.im != null) { imN++; imMax = Math.max(imMax, Math.abs((s.ionMobility?.value ?? NaN) - r.im)); }
    // peaks: sort both by (m/z, intensity) so that pwiz's unstable ordering of equal-m/z peaks does not matter
    // (m/z is rounded to 1e-5 for the tie-break: pwiz's values for one TOF index can differ in the last bits)
    const key = (mz: Float64Array, it: Float64Array, mob?: Float64Array) => Array.from(mz, (m, i) => [m, it[i], mob ? mob[i] : 0, Math.round(m * 1e5)])
      .sort((a, b) => a[3] - b[3] || a[1] - b[1] || a[2] - b[2]);
    const mob = s.arrays?.find((a) => a.cv.accession === 'MS:1003006')?.values;
    const A = key(s.mz, s.intensity, r.mobility ? mob : undefined), B = key(r.mz, r.intensity, r.mobility);
    if (A.length !== B.length) { peakBad++; continue; }
    for (let i = 0; i < A.length; i++) {
      ppmMax = Math.max(ppmMax, Math.abs((A[i][0] - B[i][0]) / B[i][0] * 1e6));
      if (A[i][1] !== B[i][1]) { intBad++; intMaxDiff = Math.max(intMaxDiff, Math.abs(A[i][1] - B[i][1])); minOff = Math.min(minOff, B[i][1]); }
      if (r.mobility) { imN++; imMax = Math.max(imMax, Math.abs(A[i][2] - B[i][2])); }
    }
    nPeaks += A.length;
  }
  table.push({
    dataset, mode,
    spectra: `${ours.length} / ${ref.length}${missing ? ` (${missing} missing)` : ''}`,
    msLevels: levelBad ? `${levelBad} differ` : 'ok',
    rt: ref.some((r) => r.meta.rt != null) ? `max ${rtMax.toExponential(1)} s` : 'n/a (none in ref)',
    precursor: precN ? `max ${precMax.toExponential(1)} (n=${precN})` : '-',
    peaks: `${peakBad ? peakBad + ' spectra differ' : 'exact'} (${nPeaks} peaks)`,
    mzPpm: ppmMax.toFixed(4),
    intensity: intBad ? `${intBad} differ by <= ${intMaxDiff} (all >= ${minOff})` : 'exact',
    im: imN ? `max ${imMax.toExponential(1)} (n=${imN})` : '-',
  });
  return { missing, levelBad, rtMax, precMax, peakBad, ppmMax, intBad, intMaxDiff, imMax, minOff };
}

describe('bruker binary helpers', () => {
  it('decodes LZF literals and back references', () => {
    // "abcabcabc": literal "abc" (ctrl 2) + back ref len 6 (ctrl (4<<5)|0, offset 2)
    const out = lzfDecompress(Uint8Array.from([2, 97, 98, 99, 4 << 5, 2]));
    expect(new TextDecoder().decode(out)).toBe('abcabcabc');
  });
  it('unshuffles byte planes', () => {
    expect(Array.from(unshuffleU32(Uint8Array.from([1, 2, 0, 0, 0, 0, 0, 1])))).toEqual([1, 0x01000002]);
  });
  it('rejects an empty frame gracefully', () => {
    expect(decodeCompression2(new Uint8Array(8)).scanCount).toBe(0);
  });
  it('m/z calibration is monotonic and 1/K0 decreases with scan', () => {
    const mzc = new MzConverter({ ModelType: 1, DigitizerTimebase: 0.2, DigitizerDelay: 24832, T1: 25.6, T2: 26.3, dC1: 31.1, dC2: 0, C0: 319.2, C1: 157987.1, C2: 0.0047, C3: 0, C4: 0 }, 25.6, 26.3);
    expect(mzc.convert(200000)).toBeGreaterThan(mzc.convert(100000));
    const imc = new ImConverter({ ModelType: 2, C0: 1, C1: 984, C2: 214.69, C3: 75.21, C4: 33, C5: 1, C6: 0.0076, C7: 132.55, C8: 13.06, C9: 2046.64 }, 0.6, 1.5, 984);
    expect(imc.convert(100)).toBeLessThan(imc.convert(0));
  });
});

describe.skipIf(!existsSync(DATA))('Bruker readers vs ProteoWizard reference mzML', () => {
  afterAll(() => {
    if (!table.length) return;
    const cols = Object.keys(table[0]) as (keyof Row)[];
    const w = cols.map((c) => Math.max(c.length, ...table.map((r) => r[c].length)));
    const line = (vals: string[]) => '| ' + vals.map((v, i) => v.padEnd(w[i])).join(' | ') + ' |';
    console.log(['', line(cols), line(w.map((n) => '-'.repeat(n))), ...table.map((r) => line(cols.map((c) => r[c])))].join('\n'));
  });

  const hela = join(DATA, 'Hela_QC_PASEF_Slot1-first-6-frames.d');
  it.skipIf(!existsSync(hela))('TDF ddaPASEF (compression 1), per scan = msconvert default', async () => {
    const input = await bundle(hela);
    expect(await brukerTdf.detect(input)).toBe(true);
    expect(await brukerTsf.detect(input)).toBe(false);
    const src = await createBrukerTdf({ combineIonMobility: false }).open(input, ctx);
    const ours = await collect(src);
    const ref = await readRef(join(DATA, 'Hela_QC_PASEF_Slot1-first-6-frames.mzML'));
    expect(src.count).toBe(ours.length);
    expect(ours.length).toBe(ref.spectra.length);
    expect(ours.map((s) => s.nativeId)).toEqual(ref.spectra.map((r) => r.meta.id));
    const c = compare('Hela ddaPASEF (TDF, LZF)', 'per scan', ours, ref.spectra);
    expect(c.levelBad + c.peakBad + c.intBad).toBe(0);
    expect(c.rtMax).toBeLessThan(1e-3);
    expect(c.precMax).toBeLessThan(0.01);
    expect(c.ppmMax).toBeLessThan(0.1);
    expect(c.imMax).toBeLessThan(1e-9);
    expect(src.meta.sourceFiles[0].nativeIdFormat?.accession).toBe('MS:1002818');
    expect(ref.head).toContain('MS:1002818');
    expect(src.meta.software[0].name).toBe('micrOTOFcontrol');
  }, 120_000);

  it.skipIf(!existsSync(hela))('TDF ddaPASEF, combined ion mobility = msconvert --combineIonMobilitySpectra', async () => {
    const input = await bundle(hela);
    const src = await brukerTdf.open(input, ctx);
    const ours = await collect(src);
    const ref = await readRef(join(DATA, 'Hela_QC_PASEF_Slot1-first-6-frames-combineIMS-centroid.mzML'));
    expect(ours.map((s) => s.nativeId)).toEqual(ref.spectra.map((r) => r.meta.id));
    const c = compare('Hela ddaPASEF (TDF, LZF)', 'combined IMS', ours, ref.spectra);
    expect(c.levelBad + c.peakBad + c.intBad).toBe(0);
    expect(c.precMax).toBeLessThan(0.01);
    expect(c.ppmMax).toBeLessThan(0.01);
    expect(c.imMax).toBeLessThan(1e-9);
    const p = ours[0].precursors[0];
    expect(p.charge).toBe(1);
    expect(p.intensity).toBe(38916);
    expect(p.isolationTarget).toBeCloseTo(1222.596039590997, 9);
    expect(p.isolationLower).toBe(1.5);
    expect(p.collisionEnergy).toBe(42);
    expect(p.activation[0].accession).toBe('MS:1000133');
    // 2018 pwiz wrote the precursor's 1/K0 (at Precursors.ScanNumber) on the merged spectrum
    expect(ours[0].ionMobility?.value).toBeCloseTo(1.383376379421, 9);
  }, 120_000);

  const dia = join(DATA, 'diaPASEF.d');
  it.skipIf(!existsSync(dia))('TDF diaPASEF (compression 2, zstd), per scan', async () => {
    const input = await bundle(dia);
    const src = await createBrukerTdf({ combineIonMobility: false }).open(input, ctx);
    const ours = await collect(src);
    // Reference was written with msLevel 2 / noMsMsWithoutPrecursor / m/z+mobility spectrum filters: it holds
    // 99 of the 4635 per-scan spectra (frame 5, scans 420-518), each complete.
    const ref = await readRef(join(DATA, 'diaPASEF-ms2-noMsMsWithoutPrecursor-centroid-mzMobilityFilter.mzML'));
    expect(ours.length).toBe(5 * 927);
    const c = compare('diaPASEF (TDF, zstd)', 'per scan (99-spectrum ref)', ours, ref.spectra);
    expect(c.missing + c.levelBad + c.peakBad).toBe(0);
    // Known difference: a few very intense peaks read one count higher than the Bruker SDK reports (cause unknown;
    // Frames.MaxIntensity agrees with the SDK). Seen only above ~6000 counts.
    expect(c.intBad).toBeLessThan(0.005 * 46495);
    expect(c.intMaxDiff).toBeLessThanOrEqual(1);
    expect(c.minOff).toBeGreaterThan(5000);
    expect(c.rtMax).toBeLessThan(1e-3);
    expect(c.precMax).toBeLessThan(0.01);
    expect(c.ppmMax).toBeLessThan(0.05);
    expect(c.imMax).toBeLessThan(1e-9);
    const s = ours.find((x) => x.nativeId === 'frame=5 scan=420')!;
    expect(s.precursors[0].isolationTarget).toBe(888);
    expect(s.precursors[0].isolationLower).toBe(13);
    expect(s.userParams?.find((u) => u.name === 'windowGroup')?.value).toBe('4');
    expect(src.meta.instrument?.name).toBe('timsTOF Pro');
  }, 120_000);

  it.skipIf(!existsSync(dia))('TDF diaPASEF, combined: one spectrum per MS1 frame and per DIA window', async () => {
    const src = await brukerTdf.open(await bundle(dia), ctx);
    const ours = await collect(src);
    expect(ours.length).toBe(1 + 4 * 2);
    expect(ours[0].msLevel).toBe(1);
    expect(ours[1].nativeId).toBe('merged=1 frame=2 scanStart=1 scanEnd=648');
    expect(ours[1].precursors[0].mz).toBe(813);
    table.push({ dataset: 'diaPASEF (TDF, zstd)', mode: 'combined IMS', spectra: `${ours.length} (no pwiz ref)`, msLevels: '-', rt: '-', precursor: '-', peaks: `${ours.reduce((a, s) => a + s.mz.length, 0)} peaks`, mzPpm: '-', intensity: '-', im: '-' });
  }, 120_000);

  const thy = join(DATA, 'ThyroglobMRM000003.d');
  it.skipIf(!existsSync(thy))('TDF schema 1 MRM frames (compression 1), per scan and combined', async () => {
    const input = await bundle(thy);
    const ours = await collect(await createBrukerTdf({ combineIonMobility: false }).open(input, ctx));
    const ref = await readRef(join(DATA, 'ThyroglobMRM000003.mzML'));
    const c = compare('ThyroglobMRM (TDF v1, MRM)', 'per scan', ours, ref.spectra);
    expect(c.missing + c.levelBad + c.peakBad + c.intBad).toBe(0);
    expect(c.ppmMax).toBeLessThan(0.1);
    const comb = await collect(await brukerTdf.open(input, ctx));
    const refc = await readRef(join(DATA, 'ThyroglobMRM000003-combineIMS-centroid.mzML'));
    const c2 = compare('ThyroglobMRM (TDF v1, MRM)', 'combined IMS', comb, refc.spectra);
    expect(c2.missing + c2.peakBad + c2.intBad).toBe(0);
  }, 120_000);

  const urine = join(DATA, 'timsTOF_autoMSMS_Urine_50s_neg.d');
  it.skipIf(!existsSync(urine))('TSF auto-MS/MS (calibration ModelType 2), profile = msconvert default', async () => {
    const input = await bundle(urine);
    expect(await brukerTsf.detect(input)).toBe(true);
    expect(await brukerTdf.detect(input)).toBe(false);
    const src = await brukerTsf.open(input, ctx);
    const ours = await collect(src);
    const ref = await readRef(join(DATA, 'timsTOF_autoMSMS_Urine_50s_neg.mzML'));
    expect(ours.map((s) => s.nativeId)).toEqual(ref.spectra.map((r) => r.meta.id));
    const c = compare('Urine auto-MS/MS (TSF)', 'profile', ours, ref.spectra);
    expect(c.levelBad + c.peakBad + c.intBad).toBe(0);
    expect(c.rtMax).toBeLessThan(1e-3);
    expect(c.precMax).toBeLessThan(0.01);
    expect(c.ppmMax).toBeLessThan(0.1);
    expect(ours.every((s) => !s.centroided && s.polarity === '-')).toBe(true);
    expect(src.meta.sourceFiles[0].nativeIdFormat?.accession).toBe('MS:1003283');
    expect(ref.head).toContain('MS:1003283');
    expect(src.meta.software[0].cv?.accession).toBe('MS:1000712');
  }, 120_000);

  it.skipIf(!existsSync(urine))('TSF auto-MS/MS, line spectra = msconvert peakPicking vendor', async () => {
    const ours = await collect(await createBrukerTsf({ spectra: 'centroid' }).open(await bundle(urine), ctx));
    for (const lvl of [1, 2]) {
      const ref = await readRef(join(DATA, `timsTOF_autoMSMS_Urine_50s_neg-ms${lvl}-centroid.mzML`));
      const mine = ours.filter((s) => s.msLevel === lvl);
      expect(mine.length).toBe(ref.spectra.length);
      const c = compare('Urine auto-MS/MS (TSF)', `line, MS${lvl}`, mine, ref.spectra);
      expect(c.levelBad + c.peakBad + c.intBad).toBe(0);
      expect(c.ppmMax).toBeLessThan(0.1);
    }
  }, 120_000);

  const maldi = join(DATA, '20percLaser_100fold_1_0_H6_MS.d');
  it.skipIf(!existsSync(maldi))('TSF MALDI (calibration ModelType 1), profile and line', async () => {
    const input = await bundle(maldi);
    const prof = await collect(await brukerTsf.open(input, ctx));
    const c = compare('MALDI fleX (TSF)', 'profile', prof, (await readRef(join(DATA, '20percLaser_100fold_1_0_H6_MS.mzML'))).spectra);
    expect(c.peakBad + c.intBad).toBe(0);
    expect(c.ppmMax).toBeLessThan(0.1);
    expect(prof[0].rtSeconds).toBeUndefined();
    expect(prof[0].userParams?.[0].value).toBe('chip=0 spot=H6');
    const line = await collect(await createBrukerTsf({ spectra: 'centroid' }).open(input, ctx));
    const c2 = compare('MALDI fleX (TSF)', 'line', line, (await readRef(join(DATA, '20percLaser_100fold_1_0_H6_MS-ms1-centroid.mzML'))).spectra);
    expect(c2.peakBad + c2.intBad).toBe(0);
    expect(c2.ppmMax).toBeLessThan(0.1);
  }, 120_000);

  it.skipIf(!existsSync(hela))('honours cancellation', async () => {
    const ac = new AbortController();
    const src = await createBrukerTdf({ combineIonMobility: false }).open(await bundle(hela), { ...ctx, signal: ac.signal });
    let n = 0;
    await expect((async () => { for await (const _ of src.spectra()) { if (++n === 10) ac.abort(); } })()).rejects.toThrow(/Cancel/);
  }, 60_000);
});
