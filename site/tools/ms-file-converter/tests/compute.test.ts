// Golden examples: each example's input, run through compute, reproduces its "expected" values.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import run from '../src/compute';

const ctx = { progress: () => {}, log: () => {}, signal: new AbortController().signal };
const dir = path.resolve(__dirname, '../examples');
const pub = path.resolve(__dirname, '../../../public');

describe('ms-file-converter examples', () => {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const ex = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    it(`${f}: ${ex.label}`, async () => {
      const file = await (fs as any).openAsBlob(path.join(pub, ex.input.url));
      const out: any = await run({ ...ex.input, url: undefined, file }, ctx);
      const got: Record<string, unknown> = { sourceFormat: out.sourceFormat, spectraCount: out.spectraCount, outputFile: out.files.map((x: any) => x.name).join(', ') };
      for (const [k, v] of Object.entries(ex.expected)) expect(got[k]).toBe(v);
    });
  }
  it('rejects a missing input and an unknown filter', async () => {
    await expect(run({ outputFormat: 'mzML' } as any, ctx)).rejects.toThrow(/Choose a file/);
    const file = await (fs as any).openAsBlob(path.join(pub, 'tools/ms-file-converter/demo-synthetic.mzML'));
    await expect(run({ file, fileName: 'x.mzML', outputFormat: 'mzML', filterText: 'frobnicate 3' } as any, ctx)).rejects.toThrow(/unknown filter/);
  });
});

describe('cancellation', () => {
  it('stops a conversion when the signal is aborted', async () => {
    const ac = new AbortController(); ac.abort();
    const file = await (fs as any).openAsBlob(path.join(pub, 'tools/ms-file-converter/demo-synthetic.mzML'));
    await expect(run({ file, fileName: 'demo.mzML', outputFormat: 'mzML' } as any, { ...ctx, signal: ac.signal })).rejects.toThrow(/Cancel/);
  });
});
