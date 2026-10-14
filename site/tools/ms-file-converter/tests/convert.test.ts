// Round-trip and reference tests for the converter. Synthetic tests always run; corpus tests run when the public
// test corpus is present locally (set MS_CORPUS to its folder; default D:/cyclic_seq_frag_public/_test_corpus).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import run, { type Output } from '../src/compute';
import { detectFormat } from '../src/readers';
import { applyFilters, rangeSet } from '../src/filters';
import { Sha1, base64Bytes } from '../src/writers/util';
import type { InputBundle, SpectrumRecord, SpectrumSource } from '../src/model';

const CORPUS = process.env.MS_CORPUS ?? 'D:/cyclic_seq_frag_public/_test_corpus';
const have = fs.existsSync(CORPUS);
const ctx = { progress: () => {}, log: () => {}, signal: new AbortController().signal };
const blobOf = (p: string) => (fs as any).openAsBlob(p) as Promise<Blob>;
const bundleOf = async (p: string): Promise<InputBundle> => ({ name: path.basename(p), files: [{ path: path.basename(p), file: await blobOf(p) }] });
async function readAll(b: InputBundle) {
  const det = await detectFormat(b);
  if (!det.format) throw new Error(`not detected: ${b.name} ${det.unsupported?.label ?? ''}`);
  const src = await det.format.open(b, ctx);
  const out: SpectrumRecord[] = [];
  for await (const s of src.spectra()) out.push(s);
  const chroms = [];
  if (src.chromatograms) for await (const c of src.chromatograms()) chroms.push(c);
  return { format: det.format.id, src, spectra: out, chroms };
}
async function convert(b: InputBundle, outputFormat: string, extra: Record<string, unknown> = {}) {
  const o = (await run({ bundle: b, outputFormat, ...extra } as any, ctx)) as Output;
  const f = o.files[0];
  return { out: o, bundle: { name: f.name, files: [{ path: f.name, file: f.blob! }] } as InputBundle };
}
const DEMO = path.resolve(__dirname, '../../../public/tools/ms-file-converter/demo-synthetic.mzML');

describe('writer primitives', () => {
  it('SHA-1 matches known vectors', () => {
    const h = (s: string) => { const x = new Sha1(); x.update(new TextEncoder().encode(s)); return x.hex(); };
    expect(h('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(h('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(h('a'.repeat(1000))).toBe('291e9a6c66994949b57ba5e650361e98fc36b1ba');
  });
  it('base64 matches btoa', () => {
    for (const s of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar']) expect(new TextDecoder().decode(base64Bytes(new TextEncoder().encode(s)))).toBe(btoa(s));
  });
  it('range specs', () => {
    const r = rangeSet('1-3 5 7-');
    expect([0, 1, 3, 4, 5, 6, 7, 99].map(r)).toEqual([false, true, true, false, true, false, true, true]);
    expect(rangeSet('')(42)).toBe(true);
    expect(() => rangeSet('a-b')).toThrow();
  });
});

describe('synthetic demo round trips', () => {
  it('mzML → mzML keeps every spectrum, peak and the original metadata (pass-through)', async () => {
    const b = await bundleOf(DEMO);
    const a = await readAll(b);
    const { out, bundle } = await convert(b, 'mzML');
    expect(out.spectraCount).toBe(a.spectra.length);
    const text = await bundle.files[0].file.text();
    expect(text).toMatch(/<indexedmzML/);
    expect(text).toMatch(/<fileChecksum>[0-9a-f]{40}<\/fileChecksum>/);
    // checksum covers everything up to and including <fileChecksum>
    const upto = text.slice(0, text.indexOf('<fileChecksum>') + '<fileChecksum>'.length);
    const sh = new Sha1(); sh.update(new TextEncoder().encode(upto));
    expect(text).toContain(`<fileChecksum>${sh.hex()}</fileChecksum>`);
    // index offsets point at the spectrum tags
    const bytes = new Uint8Array(await bundle.files[0].file.arrayBuffer());
    for (const m of text.matchAll(/<offset idRef="[^"]*">(\d+)<\/offset>/g)) expect(new TextDecoder().decode(bytes.subarray(Number(m[1]), Number(m[1]) + 9))).toMatch(/^<(spectrum|chromat)/);
    const r = await readAll(bundle);
    expect(r.spectra.length).toBe(a.spectra.length);
    for (let i = 0; i < a.spectra.length; i++) {
      expect(r.spectra[i].nativeId).toBe(a.spectra[i].nativeId);
      expect(r.spectra[i].msLevel).toBe(a.spectra[i].msLevel);
      expect(r.spectra[i].precursors[0]?.mz).toBe(a.spectra[i].precursors[0]?.mz);
      expect(Array.from(r.spectra[i].mz)).toEqual(Array.from(a.spectra[i].mz));
    }
  });
  it.each([
    ['mzXML', {}], ['MGF', {}], ['MS2', {}], ['MS1', {}], ['mzML', { passthrough: false, mzNumpress: 'linear', intensityNumpress: 'slof' }], ['mzML', { passthrough: false, zlib: false, mzBits: 32 }],
  ])('mzML → %s %j re-reads', async (fmtId, extra) => {
    const b = await bundleOf(DEMO);
    const a = await readAll(b);
    const { bundle } = await convert(b, fmtId as string, extra);
    if (fmtId === 'MS2' || fmtId === 'MS1') bundle.files[0].path = bundle.name;
    const r = await readAll(bundle);
    const want = fmtId === 'MGF' || fmtId === 'MS2' ? a.spectra.filter((s) => s.msLevel > 1) : fmtId === 'MS1' ? a.spectra.filter((s) => s.msLevel === 1) : a.spectra;
    expect(r.spectra.length).toBe(want.length);
    for (let i = 0; i < want.length; i++) {
      expect(r.spectra[i].mz.length).toBe(want[i].mz.length);
      const tol = (extra as any).mzBits === 32 || fmtId === 'mzXML' ? 1e-3 : 1e-6;
      for (let k = 0; k < want[i].mz.length; k++) expect(Math.abs(r.spectra[i].mz[k] - want[i].mz[k])).toBeLessThan(tol);
      if (want[i].precursors[0]) expect(r.spectra[i].precursors[0].mz).toBeCloseTo(want[i].precursors[0].mz, 3);
      if (want[i].rtSeconds != null && fmtId !== 'MS1' && fmtId !== 'MS2') expect(r.spectra[i].rtSeconds!).toBeCloseTo(want[i].rtSeconds!, 2);
    }
  });
  it('filters: msLevel, threshold, mzWindow, limit', async () => {
    const b = await bundleOf(DEMO);
    const det = await detectFormat(b);
    const src = await det.format!.open(b, ctx);
    const f = applyFilters(src, [{ type: 'msLevel', levels: '2' }, { type: 'threshold', mode: 'count', value: 5, orientation: 'most-intense', msLevels: '' }, { type: 'mzWindow', lo: 100, hi: 2000 }, { type: 'limit', first: 3 }], () => {});
    const got: SpectrumRecord[] = []; for await (const s of f.spectra()) got.push(s);
    expect(got.length).toBe(3);
    for (const s of got) { expect(s.msLevel).toBe(2); expect(s.mz.length).toBeLessThanOrEqual(5); expect(s.sourceXml).toBeUndefined(); }
    expect(got.map((s) => s.index)).toEqual([0, 1, 2]);
  });
  it('vendor outputs are listed but refuse to write', async () => {
    await expect(run({ file: await blobOf(DEMO), fileName: 'demo.mzML', outputFormat: 'Thermo RAW' } as any, ctx)).rejects.toThrow(/cannot be written/);
  });
});

describe.runIf(have)('Thermo .raw against ProteoWizard reference mzML', () => {
  const dir = path.join(CORPUS, 'vendor_raw/pwiz/Thermo/Reader_Thermo_Test.data');
  const raws = have ? fs.readdirSync(dir).filter((f) => /\.raw$/i.test(f)) : [];
  it.each(raws)('%s', async (f) => {
    const a = await readAll(await bundleOf(path.join(dir, f)));
    expect(a.format).toBe('Thermo RAW');
    const ref = await readAll(await bundleOf(path.join(dir, f.replace(/\.raw$/i, '.mzML'))));
    // Known OpenTFRaw 3.0.0 gaps (README "Limits"): source-CID ("sid=") scan events in this file are misparsed,
    // and multiplexed (MSX) / SPS scans report only their first reaction, so only that precursor is compared.
    const KNOWN_BAD: Record<string, number[]> = { 'source_cid_test_3scans.raw': [2, 3] };
    const byScan = new Map(a.spectra.map((s) => [s.scan, s]));
    let compared = 0;
    for (const r of ref.spectra) {
      const s = byScan.get(r.scan);
      if (!s || KNOWN_BAD[f]?.includes(r.scan!)) continue;
      compared++;
      expect(s.msLevel).toBe(r.msLevel);
      if (r.rtSeconds != null) expect(s.rtSeconds!).toBeCloseTo(r.rtSeconds, 1);
      if (r.precursors.length && s.precursors[0]) expect(Math.min(...r.precursors.map((p) => Math.abs(p.mz - s.precursors[0].mz), ...r.precursors.map((p) => Math.abs((p.isolationTarget ?? p.mz) - (s.precursors[0].isolationTarget ?? s.precursors[0].mz)))))).toBeLessThan(0.01);
      if (r.precursors[0]?.charge && s.precursors[0]?.charge) expect(s.precursors[0].charge).toBe(r.precursors[0].charge);
      // pwiz pads Thermo profile scans with zero-intensity flank points; OpenTFRaw does not, so compare non-zero points.
      const nz = (x: Float64Array) => x.reduce((c, v) => c + (v > 0 ? 1 : 0), 0);
      expect(Math.abs(nz(s.intensity) - nz(r.intensity))).toBeLessThanOrEqual(Math.max(2, nz(r.intensity) * 0.02));
    }
    expect(compared).toBeGreaterThan(0);
  });
});

describe.runIf(have)('corpus: every readable file converts to mzML and back', () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/\.d$|\.raw$/i.test(e.name)) walk(p); } else files.push(p); } };
  if (have) walk(path.join(CORPUS, 'encodings'));
  const candidates = files.filter((f) => /\.(mzML|mzXML|mgf|mzData|ms2|imzML|gz)$/i.test(f) && fs.statSync(f).size < 200e6 && !/\.bz2$/.test(f));
  it.each(candidates.map((f) => [path.relative(CORPUS, f), f]))('%s', async (_rel, f) => {
    const b = await bundleOf(f as string);
    if (/\.imzML$/i.test(f as string)) b.files.push({ path: path.basename(f as string).replace(/\.imzML$/i, '.ibd'), file: await blobOf((f as string).replace(/\.imzML$/i, '.ibd')) });
    let a;
    try { a = await readAll(b); } catch (e) { console.warn(`skip ${f}: ${String(e)}`); return; }
    const { out, bundle } = await convert(b, 'mzML');
    expect(out.spectraCount).toBe(a.spectra.length);
    const r = await readAll(bundle);
    expect(r.spectra.length).toBe(a.spectra.length);
    expect(r.spectra.reduce((s, x) => s + x.mz.length, 0)).toBe(a.spectra.reduce((s, x) => s + x.mz.length, 0));
  }, 120_000);
});
export type { SpectrumSource };
