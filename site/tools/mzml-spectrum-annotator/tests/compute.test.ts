import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, openAsBlob } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import run, { groupScans, annotate, type Input, type Output } from '../src/compute';
import { activationFromFilter, indexSpectra, readSpectrum, decodeArray } from '@/lib/ms/mzml';
import { averageSpectra, centroid } from '@/lib/ms/average';
import { decodeLinear, decodePic, decodeSlof, encodeLinear, encodePic, encodeSlof } from '@/lib/ms/numpress';
import { parseSequence } from '@/lib/ms/sequence';
import { generateFragments } from '@/lib/ms/fragments';
import { predictSpectrum } from '@/lib/ms/predict';
import { PROTON } from '@/lib/ms/elements';
import demoEx from '../examples/demo-gramicidin.json';
import lunaEx from '../examples/demo-luna18.json';

const ctx = { progress: () => {}, log: () => {}, signal: new AbortController().signal };
const DEMO = join(process.cwd(), 'public', 'tools', 'mzml-spectrum-annotator', 'demo-synthetic.mzML');

// ---------- synthetic demo file (deterministic) ----------
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const b64 = (a: Float64Array) => deflateSync(Buffer.from(a.buffer)).toString('base64');
function spectrumXml(i: number, msLevel: number, rt: number, mz: number[], it: number[], prec?: { mz: number; z: number; filter: string }) {
  const arr = (vals: number[], acc: string, name: string) => { const enc = b64(Float64Array.from(vals)); return `<binaryDataArray encodedLength="${enc.length}"><cvParam cvRef="MS" accession="MS:1000523" name="64-bit float" value=""/><cvParam cvRef="MS" accession="MS:1000574" name="zlib compression" value=""/><cvParam cvRef="MS" accession="${acc}" name="${name}" value=""/><binary>${enc}</binary></binaryDataArray>`; };
  const tic = it.reduce((s, v) => s + v, 0);
  const filter = prec ? prec.filter : 'FTMS + p ESI Full ms [200-1500]';
  const precXml = prec ? `<precursorList count="1"><precursor><isolationWindow><cvParam cvRef="MS" accession="MS:1000827" name="isolation window target m/z" value="${prec.mz.toFixed(4)}"/><cvParam cvRef="MS" accession="MS:1000828" name="isolation window lower offset" value="0.7"/><cvParam cvRef="MS" accession="MS:1000829" name="isolation window upper offset" value="0.7"/></isolationWindow><selectedIonList count="1"><selectedIon><cvParam cvRef="MS" accession="MS:1000744" name="selected ion m/z" value="${prec.mz.toFixed(4)}"/><cvParam cvRef="MS" accession="MS:1000041" name="charge state" value="${prec.z}"/></selectedIon></selectedIonList><activation><cvParam cvRef="MS" accession="MS:1000422" name="beam-type collision-induced dissociation" value=""/><cvParam cvRef="MS" accession="MS:1000045" name="collision energy" value="30"/></activation></precursor></precursorList>` : '';
  return `<spectrum index="${i}" id="controllerType=0 controllerNumber=1 scan=${i + 1}" defaultArrayLength="${mz.length}"><cvParam cvRef="MS" accession="MS:1000511" name="ms level" value="${msLevel}"/><cvParam cvRef="MS" accession="${msLevel === 1 ? 'MS:1000579' : 'MS:1000580'}" name="spectrum"/><cvParam cvRef="MS" accession="MS:1000130" name="positive scan" value=""/><cvParam cvRef="MS" accession="MS:1000127" name="centroid spectrum" value=""/><cvParam cvRef="MS" accession="MS:1000285" name="total ion current" value="${tic.toFixed(1)}"/><scanList count="1"><cvParam cvRef="MS" accession="MS:1000795" name="no combination" value=""/><scan><cvParam cvRef="MS" accession="MS:1000016" name="scan start time" value="${rt.toFixed(4)}" unitCvRef="UO" unitAccession="UO:0000031" unitName="minute"/><cvParam cvRef="MS" accession="MS:1000512" name="filter string" value="${filter}"/></scan></scanList>${precXml}<binaryDataArrayList count="2">${arr(mz, 'MS:1000514', 'm/z array')}${arr(it, 'MS:1000515', 'intensity array')}</binaryDataArrayList></spectrum>`;
}
const GRAM_PEPTIDES = [
  { seq: 'cyclo(V(Orn)LfPV(Orn)LfP)', z: 2 },
  { seq: 'DRVYIHPF', z: 2 },
];
// LUNA18 (paluratide, C73H105F5N12O12): 11-residue N-methylated macrocycle, written as in PDB 7YV1 / the literature.
const LUNA18 = 'cyclo(Maa-W2-Vn-Sar-O2a-P-Ac5-Vu-Mad-Mle-I)';
function buildDemo(peptides: Array<{ seq: string; z: number }> = GRAM_PEPTIDES, seed = 20261014, id = 'demo-synthetic'): string {
  const r = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  const specs: string[] = [];
  let i = 0, rt = 0.05;
  for (const pep of peptides) {
    const p = parseSequence(pep.seq);
    const ions = generateFragments(p, { ionTypes: p.cyclic ? ['b', 'a'] : ['b', 'y', 'a'], maxCharge: 2, precursorCharge: pep.z, losses: { h2o: true, nh3: true, mod: true, maxLosses: p.cyclic ? 2 : 1 }, immonium: true, precursor: true });
    const pred = predictSpectrum(p, ions, 'HCD').filter((q) => q.intensity > 0.8);
    const precMz = ions.find((x) => x.type === 'precursor' && !x.loss && x.charge === pep.z)!.mz;
    // MS1 survey
    const ms1mz: number[] = [], ms1it: number[] = [];
    for (let k = 0; k < 5; k++) { ms1mz.push(precMz + (k * 1.003355) / pep.z); ms1it.push(1e7 * [1, 0.63, 0.22, 0.06, 0.01][k]); }
    for (let k = 0; k < 40; k++) { ms1mz.push(200 + r() * 1200); ms1it.push(1e4 * (1 + 5 * r())); }
    const o1 = ms1mz.map((_, k) => k).sort((a, b) => ms1mz[a] - ms1mz[b]);
    specs.push(spectrumXml(i++, 1, rt, o1.map((k) => ms1mz[k]), o1.map((k) => ms1it[k]))); rt += 0.01;
    for (let s = 0; s < 12; s++) {
      const mz: number[] = [], it: number[] = [];
      for (const q of pred) {
        if (r() < 0.12) continue; // dropout
        mz.push(q.mz * (1 + gauss() * 1.5e-6)); it.push(q.intensity * 1e5 * (0.6 + 0.8 * r()));
      }
      for (let k = 0; k < 60; k++) { mz.push(110 + r() * (precMz * pep.z - 110)); it.push(1e5 * (0.5 + 3 * r())); } // chemical noise
      const order = mz.map((_, k) => k).sort((a, b) => mz[a] - mz[b]);
      specs.push(spectrumXml(i++, 2, rt, order.map((k) => mz[k]), order.map((k) => it[k]), { mz: precMz, z: pep.z, filter: `FTMS + c ESI d Full ms2 ${precMz.toFixed(4)}@hcd30.00 [100-${Math.round(precMz * pep.z + 50)}]` }));
      rt += 0.01;
    }
  }
  return `<?xml version="1.0" encoding="utf-8"?>\n<mzML xmlns="http://psi.hupo.org/ms/mzml" version="1.1.0" id="${id}"><cvList count="1"><cv id="MS" fullName="PSI-MS" URI="https://raw.githubusercontent.com/HUPO-PSI/psi-ms-CV/master/psi-ms.obo"/></cvList><fileDescription><fileContent><cvParam cvRef="MS" accession="MS:1000580" name="MSn spectrum" value=""/></fileContent></fileDescription><softwareList count="1"><software id="crt-demo" version="1.0"><userParam name="Chase's Research Tools synthetic demo (not real data)"/></software></softwareList><instrumentConfigurationList count="1"><instrumentConfiguration id="IC1"><cvParam cvRef="MS" accession="MS:1000483" name="Thermo Fisher Scientific instrument model" value=""/></instrumentConfiguration></instrumentConfigurationList><run id="demo" defaultInstrumentConfigurationRef="IC1"><spectrumList count="${i}">\n${specs.join('\n')}\n</spectrumList></run></mzML>\n`;
}

describe('synthetic demo file', () => {
  it('is up to date (set MAKE_DEMO=1 to regenerate) and parses', async () => {
    const xml = buildDemo();
    if (process.env.MAKE_DEMO || !existsSync(DEMO)) { mkdirSync(join(DEMO, '..'), { recursive: true }); writeFileSync(DEMO, xml); }
    expect(readFileSync(DEMO, 'utf8')).toBe(xml);
    const { info, spectra } = await indexSpectra(new Blob([xml]), 'demo-synthetic.mzML');
    expect(info.format).toBe('mzML');
    expect(spectra).toHaveLength(26);
    expect(spectra.filter((s) => s.msLevel === 2)).toHaveLength(24);
    expect(spectra[1].activation).toBe('HCD');
    expect(spectra[1].energy).toBe(30);
    expect(spectra[1].charge).toBe(2);
    expect(spectra[1].rt).toBeCloseTo(0.06, 6);
    const groups = groupScans(spectra);
    expect(groups.filter((g) => g.msLevel === 2).map((g) => g.indices.length)).toEqual([12, 12]);
    const sp = await readSpectrum(new Blob([xml]), spectra[1], info);
    expect(sp.mz.length).toBe(spectra[1].points);
    for (let k = 1; k < sp.mz.length; k++) expect(sp.mz[k]).toBeGreaterThanOrEqual(sp.mz[k - 1]);
  });
  it('the demo example loads, averages 12 scans and annotates gramicidin S', async () => {
    const out = (await run({ ...(demoEx.input as Input), url: undefined, file: new Blob([readFileSync(DEMO)]) }, ctx)) as Output;
    expect(out.spectra).toHaveLength(26);
    expect(out.spectrum!.scans).toBe(12);
    expect(out.annotation!.precursors[1].mz).toBeCloseTo(demoEx.expected.precursorMz, 3);
    expect(out.annotation!.coverage.explainedIntensityPct).toBeGreaterThan(60);
    expect(out.annotation!.coverage.sitesObserved).toBe(10);
    // averaging lowers mass error: the median |ppm| of matched peaks is below the 1.5 ppm per-scan noise
    const errs = [...out.annotation!.match.byIon.values()].map((m) => Math.abs(m.errorPpm)).sort((a, b) => a - b);
    expect(errs[Math.floor(errs.length / 2)]).toBeLessThan(1.5);
  });
});

const LUNA_FILE = join(process.cwd(), 'public', 'tools', 'mzml-spectrum-annotator', 'demo-luna18.mzML');
describe('LUNA18 synthetic demo', () => {
  it('file is up to date (MAKE_DEMO=1 regenerates)', () => {
    const xml = buildDemo([{ seq: LUNA18, z: 2 }], 20261019, 'demo-luna18');
    if (process.env.MAKE_DEMO || !existsSync(LUNA_FILE)) writeFileSync(LUNA_FILE, xml);
    expect(readFileSync(LUNA_FILE, 'utf8')).toBe(xml);
  });
  it('the LUNA18 example annotates the macrocycle written in the pasted notation', async () => {
    const out = (await run({ ...(lunaEx.input as Input), url: undefined, file: new Blob([readFileSync(LUNA_FILE)]) }, ctx)) as Output;
    expect(out.annotation!.peptide.residues).toHaveLength(11);
    expect(out.annotation!.precursors[1].mz).toBeCloseTo(lunaEx.expected.precursorMz, 3);
    expect(out.annotation!.coverage.explainedIntensityPct).toBeGreaterThan(50);
    expect(out.spectrum!.scans).toBe(12);
  });
});

describe('filter strings and activation', () => {
  it('parses Thermo filter strings (more reliable than converter cvParams)', () => {
    expect(activationFromFilter('FTMS + p ESI Full ms2 719.4000@hcd30.00 [150-1600]')).toEqual({ activation: 'HCD', energy: 30 });
    expect(activationFromFilter('FTMS + p ESI Full ms2 652.3300@etd50.00 [150-1204]').activation).toBe('ETD');
    expect(activationFromFilter('FTMS + p ESI sa Full ms2 1094.5900@etd50.00@hcd30.00 [150-2000]').activation).toBe('EThcD');
    expect(activationFromFilter('FTMS + p ESI Full ms2 589.2730@etd50.00@modeC40.00 [100-2000]').activation).toBe('IR-ETD');
    expect(activationFromFilter('FTMS + p ESI Full ms2 589.2730@modeC40.00 [100-2000]').activation).toBe('IRMPD');
    expect(activationFromFilter('FTMS + c NSI Full ms3 589.2730@etd50.00@modeC40.00 1003.4250@hcd30.00 [100-2000]')).toEqual({ activation: 'HCD', energy: 30 });
  });
});

describe('binary decoding', () => {
  it('MS-Numpress linear / pic / slof round-trip', () => {
    const mz = [100.12345, 100.2, 150.5, 300.000001, 999.9999, 1001.5];
    const lin = decodeLinear(encodeLinear(mz, 1e5));
    mz.forEach((v, i) => expect(lin[i]).toBeCloseTo(v, 4));
    const ints = [0, 1, 15, 1234, 99999, 7];
    expect(Array.from(decodePic(encodePic(ints)))).toEqual(ints);
    const it = [10, 2500.5, 1e6];
    const sl = decodeSlof(encodeSlof(it, 2000));
    it.forEach((v, i) => expect(Math.abs(sl[i] - v) / v).toBeLessThan(5e-4));
  });
  it('decodes 32-bit uncompressed arrays', () => {
    const f = new Float32Array([1.5, 2.25, 300.125]);
    const out = decodeArray('accession="MS:1000521" accession="MS:1000576" accession="MS:1000514"', Buffer.from(f.buffer).toString('base64'));
    expect(out.kind).toBe('mz');
    expect(Array.from(out.values)).toEqual([1.5, 2.25, 300.125]);
  });
});

describe('averaging and centroiding', () => {
  it('clusters peaks within tolerance and applies the minimum fraction', () => {
    const a = { mz: Float64Array.from([100, 200, 300]), intensity: Float64Array.from([10, 10, 10]) };
    const b = { mz: Float64Array.from([100.0005, 200.0004, 400]), intensity: Float64Array.from([30, 10, 10]) };
    const avg = averageSpectra([a, b], 10, 1);
    expect(Array.from(avg.mz).map((x) => +x.toFixed(4))).toEqual([100.0004, 200.0002]);
    expect(avg.intensity[0]).toBeCloseTo(20, 6); // mean of 10 and 30
    expect(averageSpectra([a, b], 10, 0.5).mz).toHaveLength(4);
  });
  it('centroids a Gaussian profile peak to its true apex', () => {
    const mz = Float64Array.from({ length: 41 }, (_, i) => 500 + (i - 20) * 0.002);
    const y = Float64Array.from(mz, (x) => 1000 * Math.exp(-((x - 500.0007) ** 2) / (2 * 0.003 ** 2)));
    const c = centroid({ mz, intensity: y });
    expect(c.mz).toHaveLength(1);
    expect(c.mz[0]).toBeCloseTo(500.0007, 5);
  });
});

describe('annotation', () => {
  it('uses the scan activation and charge when set to auto', () => {
    const p = parseSequence('DRVYIHPF');
    const peaks = generateFragments(p, { ionTypes: ['c', 'z•'], maxCharge: 1, precursorCharge: 2, losses: { h2o: false, nh3: false, mod: false, maxLosses: 0 } }).map((i) => ({ mz: i.mz, intensity: 100 }));
    const a = annotate(peaks, { sequence: 'DRVYIHPF', activation: 'auto' }, 'ETD', 3)!;
    expect(a.activation).toBe('ETD');
    expect(a.precursorCharge).toBe(3);
    expect(a.coverage.sitesObserved).toBe(6); // 7 bonds, no c/z at H|P
    expect(a.precursors[0].mz).toBeCloseTo(1045.5345 + PROTON, 3);
  });
  it('returns null without a sequence and rejects missing files', async () => {
    expect(annotate([], {})).toBeNull();
    await expect(run({ op: 'load' } as Input, ctx)).rejects.toThrow(/Choose an mzML/);
  });
});

// Opt-in: LOCAL_MZML="path1;path2" runs the reader on your own files (never committed).
const local = (process.env.LOCAL_MZML ?? '').split(';').filter(Boolean);
describe.skipIf(!local.length)('local files', () => {
  for (const path of local) {
    it(`indexes and averages ${path.split(/[\\/]/).pop()}`, async () => {
      const blob = await openAsBlob(path);
      const t0 = performance.now();
      const out = (await run({ op: 'load', file: blob, fileName: path }, ctx)) as Output;
      const ms = performance.now() - t0;
      const g = out.groups![0];
      console.log(`${path.split(/[\\/]/).pop()}: ${out.spectra!.length} spectra, ${out.groups!.length} groups, top group "${g.label}" (${g.indices.length} scans, written z=${g.charge}, inferred z=${out.inferredCharge}, precursor ${g.precursorMz}), averaged ${out.spectrum!.mz.length} peaks from ${out.spectrum!.points} points, profile=${out.spectrum!.profile}, ${Math.round(ms)} ms`);
      expect(out.spectrum!.mz.length).toBeGreaterThan(0);
    }, 600_000);
  }
});

describe('mzXML', () => {
  it('reads nested scans with big-endian zlib peaks', async () => {
    const pairs = (vals: number[]) => { const b = Buffer.alloc(vals.length * 4); vals.forEach((v, i) => b.writeFloatBE(v, i * 4)); return deflateSync(b).toString('base64'); };
    const xml = `<?xml version="1.0"?><mzXML><msRun scanCount="2"><scan num="1" msLevel="1" peaksCount="2" retentionTime="PT60.0S" centroided="1"><peaks precision="32" byteOrder="network" compressionType="zlib" contentType="m/z-int">${pairs([400, 100, 500, 200])}</peaks><scan num="2" msLevel="2" peaksCount="2" retentionTime="PT61.2S" filterLine="FTMS + c ESI d Full ms2 500.0000@hcd30.00 [100-1000]"><precursorMz precursorCharge="2" activationMethod="HCD">500.0</precursorMz><peaks precision="32" byteOrder="network" compressionType="zlib" contentType="m/z-int">${pairs([150, 10, 250, 20])}</peaks></scan></scan></msRun></mzXML>`;
    const { info, spectra } = await indexSpectra(new Blob([xml]), 'tiny.mzXML');
    expect(info.format).toBe('mzXML');
    expect(spectra.map((s) => s.msLevel)).toEqual([1, 2]);
    expect(spectra[1].precursorMz).toBe(500);
    expect(spectra[1].activation).toBe('HCD');
    expect(spectra[1].rt).toBeCloseTo(61.2 / 60, 6);
    const sp = await readSpectrum(new Blob([xml]), spectra[1], info);
    expect(Array.from(sp.mz)).toEqual([150, 250]);
    expect(Array.from(sp.intensity)).toEqual([10, 20]);
  });
});

describe('cancellation', () => {
  it('stops loading a file when the signal is aborted', async () => {
    const ac = new AbortController(); ac.abort();
    await expect(run({ op: 'load', file: await openAsBlob(DEMO), fileName: 'demo.mzML' } as Input, { ...ctx, signal: ac.signal })).rejects.toThrow(/Cancel/);
  });
});
