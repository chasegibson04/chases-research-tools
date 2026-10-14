// Command-line use of the converter (same code as the web page), for batch checks and local workflows:
//   npx vite-node --config vitest.config.ts tools/ms-file-converter/scripts/convert-cli.ts -- <input file or .d folder> <output dir> [format] [filter lines separated by ;]
// e.g. ... -- run.raw out/ mzML "peakPicking true 1-;msLevel 1-"
import fs from 'node:fs';
import path from 'node:path';
import run from '../src/compute';

const args = process.argv.slice(2).filter((a) => a !== '--');
const [input, outDir, outputFormat = 'mzML', filters = ''] = args;
if (!input || !outDir) { console.error('usage: convert-cli <input> <outDir> [format] [filters;...]'); process.exit(2); }

async function bundle(p: string) {
  if (!fs.statSync(p).isDirectory()) return { name: path.basename(p), files: [{ path: path.basename(p), file: await (fs as any).openAsBlob(p) }] };
  const files: any[] = [];
  const walk = async (d: string, rel: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) await walk(q, `${rel}${e.name}/`); else files.push({ path: rel + e.name, file: await (fs as any).openAsBlob(q) }); } };
  await walk(p, `${path.basename(p)}/`);
  return { name: path.basename(p), files };
}

const t0 = Date.now();
const out: any = await run({ bundle: await bundle(input), outputFormat, filterText: filters.split(';').join('\n') } as any, {
  progress: () => {}, log: (m: string) => console.error(m), signal: new AbortController().signal,
});
fs.mkdirSync(outDir, { recursive: true });
for (const f of out.files) {
  const dest = path.join(outDir, f.name);
  fs.writeFileSync(dest, Buffer.from(await f.blob.arrayBuffer()));
  console.log(`${dest}\t${out.sourceFormat}\t${out.spectraCount} spectra\t${(f.size / 1e6).toFixed(1)} MB\t${Date.now() - t0} ms`);
}
