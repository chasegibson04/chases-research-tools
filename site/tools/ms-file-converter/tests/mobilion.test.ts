// MOBILion .mbi reader vs ProteoWizard reference mzML (Reader_Mobilion_Test.data, public pwiz test data; msconvert
// uses the MBI SDK). The references hold the first 101 spectra. Skipped when the local corpus is absent.
import { describe, it, expect } from 'vitest';
import { existsSync, openAsBlob } from 'node:fs';
import { join } from 'node:path';
import { indexSpectra, readSpectrum } from '@/lib/ms/mzml';
import { mobilionMbi, padGates, mbiIndexToMz } from '../src/readers/mobilion';
import type { ReaderContext, SpectrumRecord } from '../src/model';

// Public test corpus folder (README there); tests skip when MS_CORPUS is unset.
const DIR = process.env.MS_CORPUS ? `${process.env.MS_CORPUS}/vendor_raw/pwiz/Mobilion/Reader_Mobilion_Test.data` : '';
const ctx = (): ReaderContext => ({ progress: () => {}, signal: new AbortController().signal, log: () => {} });

describe('Mobilion helpers', () => {
  it('pads each zero-suppressed gate with flanking zeros (msconvert convention)', () => {
    const { idx, y } = padGates([10, 11, 20], [5, 6, 7]);
    expect(Array.from(idx)).toEqual([9, 10, 11, 12, 19, 20, 21]);
    expect(Array.from(y)).toEqual([0, 5, 6, 0, 0, 7, 0]);
  });
  it('TOF index → m/z with traditional calibration', () => {
    // ExampleTuneMix_binned5 frame 1: index 103658 is m/z 326.90701 in the pwiz output.
    expect(mbiIndexToMz(103658, { slope: 0.346008670516262, intercept: -0.425672191441404, residual: [], sampleRate: 2e9 })).toBeCloseTo(326.90701, 4);
  });
});

describe.skipIf(!DIR || !existsSync(DIR))('Mobilion .mbi vs ProteoWizard', () => {
  for (const name of ['ExampleTuneMix_binned5', '2024-02-16-16.02.20-CCS Calibration_02']) {
    it(name, async () => {
      const file = await openAsBlob(join(DIR, name + '.mbi'));
      const input = { name: name + '.mbi', files: [{ path: name + '.mbi', file }] };
      expect(await mobilionMbi.detect(input)).toBe(true);
      const src = await mobilionMbi.open(input, ctx());
      const ours: SpectrumRecord[] = [];
      for await (const s of src.spectra()) { ours.push(s); if (ours.length >= 400) break; }
      const chroms = [];
      for await (const c of src.chromatograms!()) chroms.push(c);
      src.close?.();
      const refFile = await openAsBlob(join(DIR, name + '.mzML'));
      const { info, spectra: ref } = await indexSpectra(refFile, name);
      const refText = await refFile.text();
      const byId = new Map(ours.map((s) => [s.nativeId, s]));
      let found = 0, pts = 0, ppmMax = 0, intRel = 0, dtMax = 0, rtMax = 0, lvl = 0, pol = 0;
      const dts = new Map(refText.split('<spectrum ').slice(1).map((b) => [/id="([^"]+)"/.exec(b)![1], Number(/ion mobility drift time" value="([^"]+)"/.exec(b)?.[1])]));
      for (const m of ref) {
        const s = byId.get(m.id);
        if (!s) continue;
        found++;
        if (s.msLevel === m.msLevel) lvl++;
        if ((s.polarity ?? null) === m.polarity) pol++;
        rtMax = Math.max(rtMax, Math.abs((s.rtSeconds ?? 0) - (m.rt ?? 0) * 60)); // mzml.ts reports minutes
        dtMax = Math.max(dtMax, Math.abs((s.ionMobility?.value ?? NaN) - (dts.get(m.id) ?? NaN)));
        const r = await readSpectrum(refFile, m, info);
        if (r.mz.length !== s.mz.length) continue;
        pts++;
        for (let k = 0; k < r.mz.length; k++) {
          ppmMax = Math.max(ppmMax, (Math.abs(r.mz[k] - s.mz[k]) / r.mz[k]) * 1e6);
          intRel = Math.max(intRel, Math.abs(r.intensity[k] - s.intensity[k]) / Math.max(1, r.intensity[k]));
        }
      }
      const row = { name, ref: ref.length, found, sameLength: pts, levelOk: lvl, polOk: pol, rtMax, dtMax, ppmMax, intRel, ticPoints: chroms[0]?.time.length };
      console.log(JSON.stringify(row));
      expect(found).toBe(ref.length);
      expect(pts).toBe(ref.length);
      expect(lvl).toBe(ref.length);
      expect(pol).toBe(ref.length);
      expect(dtMax).toBeLessThan(1e-6);
      expect(rtMax).toBeLessThan(1e-6);
      expect(ppmMax).toBeLessThan(0.2);
      expect(intRel).toBe(0);
    }, 120_000);
  }
});
