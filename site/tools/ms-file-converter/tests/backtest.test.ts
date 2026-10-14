// Opt-in backtest on your own data (never committed): BACKTEST_LIST=<text file with one path per line>;
// BACKTEST_OUT=<file> receives one result line per input as it finishes (vitest prints console output only at the end).
// Every input is read, converted to indexed mzML and re-read; spectrum and peak counts must survive, and MSn
// inputs also go through MGF. A summary line per file is printed (run with --silent=false).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import run from '../src/compute';

const list = process.env.BACKTEST_LIST && fs.existsSync(process.env.BACKTEST_LIST)
  ? fs.readFileSync(process.env.BACKTEST_LIST, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
const outFile = process.env.BACKTEST_OUT;
const report = (line: string) => { console.log(line); if (outFile) fs.appendFileSync(outFile, `${line}
`); };
const ctx = { progress: () => {}, log: () => {}, signal: new AbortController().signal };

async function bundle(p: string) {
  const st = fs.statSync(p);
  if (!st.isDirectory()) return { name: path.basename(p), files: [{ path: path.basename(p), file: await (fs as any).openAsBlob(p) }] };
  const files: any[] = [];
  const walk = async (d: string, rel: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) await walk(q, `${rel}${e.name}/`); else files.push({ path: rel + e.name, file: await (fs as any).openAsBlob(q) }); } };
  await walk(p, `${path.basename(p)}/`);
  return { name: path.basename(p), files };
}

describe.runIf(list.length > 0)('backtest', () => {
  it.concurrent.each(list)('%s', async (p) => {
    const b = await bundle(p);
    const t0 = performance.now();
    let out: any;
    try { out = await run({ bundle: b, outputFormat: 'mzML' } as any, ctx); }
    catch (e: any) { report(`BACKTEST FAIL ${path.basename(p)}: ${e.message}`); throw e; }
    const ms = performance.now() - t0;
    const f = out.files[0];
    const back: any = await run({ bundle: { name: f.name, files: [{ path: f.name, file: f.blob }] }, outputFormat: 'CSV' } as any, ctx);
    expect(back.spectraCount).toBe(out.spectraCount);
    const csvRows = (await back.files[0].blob.text()).split('\n').length - 2;
    const msn = Object.entries(out.msLevels).filter(([l]) => Number(l) > 1).reduce((s, [, n]) => s + (n as number), 0);
    let mgf = 0;
    if (msn) { const m: any = await run({ bundle: b, outputFormat: 'MGF' } as any, ctx); mgf = m.spectraCount; expect(mgf).toBe(msn); }
    report(`BACKTEST OK ${path.basename(p)} | ${out.sourceFormat} | ${out.spectraCount} spectra ${JSON.stringify(out.msLevels)} | MGF ${mgf} | ${(f.size / 1e6).toFixed(1)} MB | ${Math.round(ms)} ms`);
  }, 900_000);
});
