// Vendor folder → mzML → re-read, through the full compute path (detect, open, write, index). Runs when the
// ProteoWizard vendor test data is present (MS_CORPUS, default D:/cyclic_seq_frag_public/_test_corpus).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import run from '../src/compute';
import { detectFormat } from '../src/readers';
import type { InputBundle } from '../src/model';

const CORPUS = process.env.MS_CORPUS ?? 'D:/cyclic_seq_frag_public/_test_corpus';
const PWIZ = path.join(CORPUS, 'vendor_raw/pwiz');
const ctx = { progress: () => {}, log: () => {}, signal: new AbortController().signal };

async function folderBundle(dir: string): Promise<InputBundle> {
  const files: InputBundle['files'] = [];
  const walk = (d: string, rel: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, `${rel}${e.name}/`); else files.push({ path: `${rel}${e.name}`, file: undefined as any, _p: p } as any); } };
  walk(dir, `${path.basename(dir)}/`);
  for (const f of files as any[]) f.file = await (fs as any).openAsBlob(f._p);
  return { name: path.basename(dir), files };
}
const vendorDirs = (sub: string) => {
  const d = path.join(PWIZ, sub);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d, { recursive: true, withFileTypes: true } as any)
    .filter((e: any) => e.isDirectory() && /\.d$/i.test(e.name))
    .map((e: any) => path.join(e.parentPath ?? e.path, e.name))
    .filter((p: string) => !/\.d[\\/]/i.test(path.relative(d, p)));
};

describe.each([['Bruker'], ['Agilent']])('%s .d → mzML', (vendor) => {
  const dirs = vendorDirs(vendor);
  it.runIf(dirs.length > 0).each(dirs.map((d) => [path.basename(d), d]))('%s', async (_n, dir) => {
    const b = await folderBundle(dir as string);
    const det = await detectFormat(b);
    if (!det.format) { console.warn(`not readable: ${dir} ${det.unsupported?.label ?? ''}`); return; }
    for (const combine of [true, false]) {
      const out: any = await run({ bundle: b, outputFormat: 'mzML', combineIonMobility: combine } as any, ctx);
      const f = out.files[0];
      const back = { name: f.name, files: [{ path: f.name, file: f.blob }] };
      const re: any = await run({ bundle: back, outputFormat: 'MGF', includeMs1: true, op: 'convert' } as any, ctx);
      expect(re.spectraCount).toBe(out.spectraCount);
      // MRM/SIM-only runs hold chromatograms and no spectra (as in msconvert)
      expect(out.spectraCount + out.chromatogramCount).toBeGreaterThan(0);
      const text = await f.blob.slice(0, 20000).text();
      expect(text).toMatch(/<sourceFile /);
      if (!/TDF/.test(det.format.id)) break;
    }
  }, 300_000);
});
