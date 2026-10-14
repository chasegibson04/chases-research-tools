// Agilent MassHunter .d reader vs ProteoWizard reference mzML (Reader_Agilent_Test.data, public pwiz test data;
// msconvert uses the Agilent MHDAC DLLs). Skipped when the local corpus is absent.
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, statSync, openAsBlob } from 'node:fs';
import { join, relative } from 'node:path';
import { indexSpectra, readSpectrum, decodeArray } from '@/lib/ms/mzml';
import { agilentD } from '../src/readers/agilent';
import { lzfDecompress } from '../src/readers/agilent/lzf';
import { parseXsd, layoutOf } from '../src/readers/agilent/xsd';
import { tofToMz, parseDefaultMassCal } from '../src/readers/agilent/calibration';
import { decodeRle, decodeProfile } from '../src/readers/agilent/decode';
import type { InputBundle, ReaderContext, SpectrumRecord, ChromatogramRecord } from '../src/model';

const DIR = 'D:/cyclic_seq_frag_public/_test_corpus/vendor_raw/pwiz/Agilent/Reader_Agilent_Test.data';

async function bundleOf(dir: string): Promise<InputBundle> {
  const files: InputBundle['files'] = [];
  const base = join(dir, '..');
  const walk = async (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) await walk(p);
      else files.push({ path: relative(base, p).replace(/\\/g, '/'), file: await openAsBlob(p) });
    }
  };
  await walk(dir);
  return { name: dir.split(/[\\/]/).pop()!, files };
}
const ctx = (): ReaderContext => ({ progress: () => {}, signal: new AbortController().signal, log: () => {} });

async function readAll(dPath: string) {
  const src = await agilentD.open(await bundleOf(dPath), ctx());
  const spectra: SpectrumRecord[] = [];
  for await (const s of src.spectra()) spectra.push(s);
  const chroms: ChromatogramRecord[] = [];
  if (src.chromatograms) for await (const c of src.chromatograms()) chroms.push(c);
  return { src, spectra, chroms };
}

interface Cmp { dtMax?: number; name: string; ours: number; ref: number; levelOk: number; rtMax: number; polOk: number; pts: number; ppmMax: number; intRel: number; precOk: number; chroms: string }

async function compare(dName: string, refName = dName.replace(/\.d$/, '.mzML'), maxSpectra = Infinity): Promise<Cmp> {
  const { spectra, chroms } = await readAll(join(DIR, dName));
  const refFile = await openAsBlob(join(DIR, refName));
  const refText = await refFile.text();
  // Chromatograms: TIC length and the SRM/SIM traces (count, lengths and summed intensity per Q1).
  const refChroms = [...refText.matchAll(/<chromatogram [^>]*id="([^"]*)"[^>]*defaultArrayLength="(\d+)"/g)].map((m) => ({ id: m[1], n: Number(m[2]) }));
  const sig = (cs: Array<{ id: string; n: number }>) => [...new Set(cs.filter((c) => /S[RI]M SIC/.test(c.id)).map((c) => `${Number(/Q1=([\d.]+)/.exec(c.id)![1]).toFixed(1)}:${c.n}`))].sort().join(',');
  const oursSig = sig(chroms.map((c) => ({ id: c.id, n: c.time.length })));
  // SRM/SIM intensities: per-Q1 totals (msconvert can split one transition into near-duplicate Q3 traces, so
  // only files whose trace count matches are compared exactly).
  const refSums = new Map<string, number>();
  for (const blk of refText.split('<chromatogram ').slice(1)) {
    const id = /id="([^"]*)"/.exec(blk)![1];
    if (!/S[RI]M SIC/.test(id)) continue;
    const arrays = [...blk.matchAll(/<binaryDataArray [\s\S]*?<\/binaryDataArray>/g)].map((m) => m[0]);
    const it = arrays.find((a) => /MS:1000515/.test(a));
    if (!it) continue;
    const v = decodeArray(it, /<binary>([^<]*)<\/binary>/.exec(it)![1]).values;
    const q1 = Number(/Q1=([\d.]+)/.exec(id)![1]).toFixed(1);
    refSums.set(q1, (refSums.get(q1) ?? 0) + v.reduce((a, b) => a + b, 0));
  }
  const ourSums = new Map<string, number>();
  for (const c of chroms) if (c.precursorMz != null) { const q1 = c.precursorMz.toFixed(1); ourSums.set(q1, (ourSums.get(q1) ?? 0) + c.intensity.reduce((a, b) => a + b, 0)); }
  const sumsMatch = [...refSums].every(([k, v]) => Math.abs((ourSums.get(k) ?? -1) - v) <= 1e-6 * Math.max(1, v));
  const chromSummary = `TIC ${chroms[0]?.time.length}/${refChroms.find((c) => c.id === 'TIC')?.n}; SRM/SIM ${oursSig === sig(refChroms) ? 'match' : `${oursSig} vs ${sig(refChroms)}`}${refSums.size ? (sumsMatch ? ' (intensities equal)' : ' (intensities differ)') : ''}`;
  if (!/<spectrum /.test(refText)) return { name: dName, ours: spectra.length, ref: 0, levelOk: 1, rtMax: 0, polOk: 1, pts: 1, ppmMax: 0, intRel: 0, precOk: 1, chroms: chromSummary };
  const { info, spectra: ref } = await indexSpectra(refFile, refName);
  const refMs = ref.filter((m) => !/^merged=\d+ row=/.test(m.id)); // DAD UV spectra are not MS data
  const byId = new Map(spectra.map((s) => [s.nativeId, s]));
  let levelOk = 0, polOk = 0, precOk = 0, rtMax = 0, ppmMax = 0, intRel = 0, pts = 0;
  for (const m of refMs.slice(0, maxSpectra)) {
    const s = byId.get(m.id);
    if (!s) continue;
    if (s.msLevel === m.msLevel) levelOk++;
    if ((s.polarity ?? null) === m.polarity) polOk++;
    if (m.precursorMz == null ? !s.precursors.length : Math.abs((s.precursors[0]?.mz ?? 0) - m.precursorMz) < 1e-3) precOk++;
    rtMax = Math.max(rtMax, Math.abs((s.rtSeconds ?? 0) / 60 - (m.rt ?? 0)) * 60);
    const r = await readSpectrum(refFile, m, info);
    if (r.mz.length === s.mz.length) {
      pts++;
      for (let k = 0; k < r.mz.length; k++) {
        if (r.mz[k] > 0) ppmMax = Math.max(ppmMax, (Math.abs(r.mz[k] - s.mz[k]) / r.mz[k]) * 1e6);
        const den = Math.max(1, Math.abs(r.intensity[k]));
        intRel = Math.max(intRel, Math.abs(r.intensity[k] - s.intensity[k]) / den);
      }
    }
  }
  // Drift times (IMS): msconvert writes MS:1002476 per spectrum.
  let dtMax: number | undefined;
  for (const blk of refText.split('<spectrum ').slice(1)) {
    const dt = /MS:1002476" name="ion mobility drift time" value="([^"]+)"/.exec(blk);
    if (!dt) continue;
    const s = byId.get(/id="([^"]+)"/.exec(blk)![1]);
    dtMax = Math.max(dtMax ?? 0, Math.abs((s?.ionMobility?.value ?? NaN) - Number(dt[1])));
  }
  const n = Math.min(refMs.length, maxSpectra);
  return { dtMax, name: dName, ours: spectra.length, ref: refMs.length, levelOk: levelOk / n, rtMax, polOk: polOk / n, pts: pts / n, ppmMax, intRel, precOk: precOk / n, chroms: chromSummary };
}

describe('Agilent helpers', () => {
  it('LZF round trip of a known stream', () => {
    // "aaaaaaaa": literal 'a' then back-reference length 7 at distance 1.
    const enc = Uint8Array.from([0x00, 0x61, 0xa0, 0x00]);
    expect(new TextDecoder().decode(lzfDecompress(enc, 8))).toBe('aaaaaaaa');
  });
  it('parses an MSScan.xsd layout, skipping comments and padding', () => {
    const xsd = `<xs:schema><xs:complexType name="ScanRecordType"><xs:sequence>
      <xs:element name="ScanID" type="xs:int"/><!-- <xs:element name="Gone" type="xs:double"/> -->
      <xs:element name="ScanTime" type="xs:double"/><xs:element name="SpectrumParamValues" type="SpectrumParamsType" maxOccurs="unbounded"/>
      <xs:element name="Padding" minOccurs="0"><xs:complexType><xs:sequence><xs:element name="PadBytes" type="xs:byte"/></xs:sequence></xs:complexType></xs:element>
      </xs:sequence></xs:complexType><xs:complexType name="SpectrumParamsType"><xs:sequence><xs:element name="SpectrumOffset" type="xs:long"/></xs:sequence></xs:complexType></xs:schema>`;
    const t = parseXsd(xsd);
    const l = layoutOf(t, 'ScanRecordType', 'SpectrumParamValues');
    expect(l.size).toBe(12);
    expect(l.fields.get('ScanTime')?.offset).toBe(4);
    expect(layoutOf(t, 'SpectrumParamsType').size).toBe(8);
  });
  it('TOF calibration: traditional + odd-order polynomial', () => {
    const cal = parseDefaultMassCal(`<DefaultCalibration DefaultCalibrationID="1"><Step Number="1"><CalibrationFormula>Traditional</CalibrationFormula><Values><Value Number="1">0.0005526</Value><Value Number="2">1177</Value></Values></Step></DefaultCalibration>`).byId.get(1)!;
    expect(tofToMz(19273, cal)).toBeCloseTo(99.99699, 4); // pwiz scan window lower limit of Neg_MS_002_1scan
  });
  it('LZF-compressed TOF profile segment (literal-only stream)', () => {
    const n = 3;
    const raw = new Uint8Array(16 + 4 * n);
    const dv = new DataView(raw.buffer);
    dv.setFloat64(0, 20000, true); dv.setFloat64(8, 0.5, true); dv.setUint32(16, 0, true); dv.setUint32(20, 42, true); dv.setUint32(24, 7, true);
    const enc: number[] = [];
    for (let o = 0; o < raw.length; o += 32) { const chunk = raw.subarray(o, Math.min(o + 32, raw.length)); enc.push(chunk.length - 1, ...chunk); }
    const d = decodeProfile(Uint8Array.from(enc), n, raw.length);
    expect(d.isMz).toBe(false);
    expect(Array.from(d.x)).toEqual([20000, 20000.5, 20001]);
    expect(Array.from(d.y)).toEqual([0, 42, 7]);
  });
  it('RLE intensity stream', () => {
    // header (16 B), [n|0x90], -0 leading zeros, literal 5 (4 B), switch to 1-byte with 2 zeros (-(2*4+1) = -9), 7
    const n = 5;
    const b = new Uint8Array(16 + 4 + 4 + 4 + 4 + 1);
    const dv = new DataView(b.buffer);
    dv.setUint32(16, n | (0x90 << 24), true); dv.setInt32(20, 0, true); dv.setInt32(24, 5, true); dv.setInt32(28, -9, true); dv.setInt8(32, 7);
    expect(Array.from(decodeRle(b, n))).toEqual([5, 0, 0, 7, 0]);
  });
});

describe.skipIf(!existsSync(DIR))('Agilent .d vs ProteoWizard', () => {
  const rows: Cmp[] = [];
  const cases: Array<[string, string?]> = [
    ['Neg_MS_002_1scan.d'], ['TOFsulfasMS4GHzDualMode+DADSpectra+UVSignal272-NoProfile.d'], ['GFb_4Scan_TimeSegs_1530_100ng.d'],
    ['RS080806_APCI_PIscan_CE35.d'], ['RS080806_NL_448.2_001.d'], ['RS080906_MMI_PIscan_CE35_250ms.d'], ['Thyrxox 5 TS Diff Scan B.d'],
    ['MRM Neg C5.d'], ['reserpine-MS2sim-010.d'], ['ImsSynthCCS.d'], ['ImsSynthAllIons.d'], ['ImsSynth_Chrom.d'],
  ];
  for (const [d, ref] of cases) {
    it(d, async () => {
      if (!existsSync(join(DIR, d))) return;
      const c = await compare(d, ref);
      rows.push(c);
      console.log(JSON.stringify(c));
      expect(await agilentD.detect(await bundleOf(join(DIR, d)))).toBe(true);
      expect(c.ours).toBe(c.ref);
      expect(c.chroms).toMatch(/^TIC (\d+)\/\1; SRM\/SIM match/);
      if (/^(MRM Neg C5|reserpine)/.test(d)) expect(c.chroms).toContain('intensities equal');
      if (c.ref) {
        expect(c.levelOk).toBe(1); expect(c.polOk).toBe(1); expect(c.precOk).toBe(1);
        expect(c.rtMax).toBeLessThan(1e-3);
        expect(c.pts).toBeGreaterThan(0.95);
        expect(c.ppmMax).toBeLessThan(0.5);
        expect(c.intRel).toBeLessThan(1e-3);
        if (c.dtMax !== undefined) expect(c.dtMax).toBeLessThan(1e-6);
      }
    }, 120_000);
  }
});
