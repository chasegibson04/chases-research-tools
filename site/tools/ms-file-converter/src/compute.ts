// MS File Converter compute: detect → open → filter → write → save. Runs in the tool's Web Worker; nothing is
// uploaded. With a folder chosen via the File System Access API the worker writes the output there directly;
// otherwise the result is returned as a Blob for the page to download.
import type { ComputeFn } from '@/lib/types';
import type { InputBundle, SpectrumSource } from './model';
import { detectFormat } from './readers';
import { applyFilters, describe, parseFilters, type Filter } from './filters';
import { outputById, OUTPUT_FORMATS } from './writers';
import type { WrittenFile } from './writers/util';

export const CONVERTER_VERSION = '0.1.0';

export interface Input {
  op?: 'inspect' | 'convert';
  /** One input: a single file, or every file of a vendor folder (relative paths). */
  bundle?: InputBundle | null;
  /** Convenience for single-file runs and examples. */
  file?: Blob | null;
  url?: string;
  fileName?: string;
  outputFormat: string;
  // mzML
  indexed?: boolean; mzBits?: 32 | 64; intensityBits?: 32 | 64; zlib?: boolean;
  mzNumpress?: 'none' | 'linear'; intensityNumpress?: 'none' | 'pic' | 'slof'; passthrough?: boolean;
  // MGF
  titleTemplate?: string; includeMs1?: boolean;
  gzip?: boolean;
  /** timsTOF: combine mobility scans (one spectrum per frame / PASEF window). */
  combineIonMobility?: boolean;
  filters?: Filter[];
  /** msconvert-style filter lines; used when `filters` is not given. */
  filterText?: string;
  /** Output folder (FileSystemDirectoryHandle) chosen on the page. */
  outDir?: any;
  outName?: string;
  overwrite?: boolean;
}

export interface OutputFileInfo { name: string; size: number; savedTo?: string; blob?: Blob }
export interface Output {
  sourceFormat: string;
  inputName: string;
  spectraCount: number;
  chromatogramCount: number;
  msLevels: Record<string, number>;
  rtRange: [number, number] | null;
  instrument?: string;
  startTimeStamp?: string;
  files: OutputFileInfo[];
  log: string[];
  /** First spectra summary for the preview table. */
  preview: Array<{ index: number; id: string; msLevel: number; rt: number | null; precursorMz: number | null; charge: number | null; peaks: number; centroided: boolean }>;
  unsupported?: { label: string; reason: string };
}

const stem = (n: string) => n.replace(/\/+$/, '').split('/').pop()!.replace(/\.(gz)$/i, '').replace(/\.(mzML|mzXML|mgf|raw|d|cdf|mzdata|ms1|ms2|imzML|xml)$/i, '');

/** Wrap a source to count what is actually written (after filters) for the summary. */
function tally(src: SpectrumSource, out: Output) {
  const levels: Record<string, number> = {};
  let lo = Infinity, hi = -Infinity, n = 0, nc = 0;
  return {
    ...src,
    async *spectra() {
      for await (const s of src.spectra()) {
        levels[s.msLevel] = (levels[s.msLevel] ?? 0) + 1;
        if (s.rtSeconds != null) { lo = Math.min(lo, s.rtSeconds); hi = Math.max(hi, s.rtSeconds); }
        if (out.preview.length < 200) out.preview.push({ index: s.index, id: s.nativeId, msLevel: s.msLevel, rt: s.rtSeconds ?? null, precursorMz: s.precursors[0]?.mz ?? null, charge: s.precursors[0]?.charge ?? null, peaks: s.mz.length, centroided: s.centroided });
        n++;
        yield s;
      }
      out.spectraCount = n; out.msLevels = levels; out.rtRange = Number.isFinite(lo) ? [lo, hi] : null;
    },
    chromatograms: src.chromatograms ? async function* () { for await (const c of src.chromatograms!()) { nc++; out.chromatogramCount = nc; yield c; } } : undefined,
  } as SpectrumSource;
}

async function save(f: WrittenFile, gzip: boolean, outDir: any, overwrite: boolean, log: (m: string) => void): Promise<OutputFileInfo> {
  let blob = f.blob, name = f.name;
  if (gzip) {
    blob = await new Response((f.blob.stream() as any).pipeThrough(new CompressionStream('gzip'))).blob();
    name += '.gz';
  }
  if (outDir) {
    if (!overwrite) {
      try { await outDir.getFileHandle(name); throw new Error(`"${name}" already exists in ${outDir.name}. Tick "Overwrite existing files" or pick another folder.`); }
      catch (e: any) { if (e?.name !== 'NotFoundError' && e?.name !== 'TypeError') throw e; }
    }
    const h = await outDir.getFileHandle(name, { create: true });
    const w = await h.createWritable();
    await blob.stream().pipeTo(w);
    log(`Saved ${name} (${(blob.size / 1e6).toFixed(1)} MB) to ${outDir.name}.`);
    return { name, size: blob.size, savedTo: outDir.name };
  }
  return { name, size: blob.size, blob };
}

const run: ComputeFn<Input, Output> = async (input, ctx) => {
  const log: string[] = [];
  const say = (m: string) => { log.push(m); ctx.log(m); };
  let bundle = input.bundle ?? null;
  if (!bundle) {
    let file = input.file ?? null;
    if (!file && input.url) {
      const r = await fetch(input.url);
      if (!r.ok) throw new Error(`Could not fetch ${input.url} (${r.status}).`);
      file = await r.blob();
    }
    if (!file) throw new Error('Choose a file (or a vendor folder) to convert.');
    const name = input.fileName ?? (file as File).name ?? input.url?.split('/').pop() ?? 'input';
    bundle = { name, files: [{ path: name, file }] };
  }
  if (!bundle.files.length) throw new Error('The selected folder is empty.');
  const out: Output = { sourceFormat: '', inputName: bundle.name, spectraCount: 0, chromatogramCount: 0, msLevels: {}, rtRange: null, files: [], log, preview: [] };

  ctx.progress(0, 'Detecting format');
  const det = await detectFormat(bundle, { combineIonMobility: !!input.combineIonMobility });
  if (!det.format) {
    if (det.unsupported) { out.unsupported = det.unsupported; throw new Error(`${det.unsupported.label}: ${det.unsupported.reason}`); }
    throw new Error(`Unrecognised input "${bundle.name}". Supported: ${OUTPUT_FORMATS.length ? 'mzML, mzXML, MGF, mzData, MS1/MS2, imzML, netCDF (ANDI), Thermo .raw and vendor folders listed on the page' : ''}.`);
  }
  out.sourceFormat = det.format.label;
  say(`Input: ${bundle.name} — ${det.format.label}.`);
  const fmt = outputById(input.outputFormat ?? 'mzML');
  if (!fmt) throw new Error(`Unknown output format "${input.outputFormat}".`);
  if (!fmt.writable || !fmt.write) throw new Error(`${fmt.label} cannot be written: ${fmt.reason}`);

  // Reader gets the first 45% of the bar when converting (reading and writing interleave, so this is approximate).
  const readerCtx = { progress: (f: number, m?: string) => ctx.progress(Math.min(0.95, f * 0.95), m), signal: ctx.signal, log: say };
  const src0 = await det.format.open(bundle, readerCtx);
  try {
    out.instrument = src0.meta.instrument?.name ?? src0.meta.instrument?.model?.name;
    out.startTimeStamp = src0.meta.startTimeStamp;
    const filters = input.filters ?? parseFilters(input.filterText ?? '');
    // Formats that hold only some MS levels get that as an implicit last filter, so counts reflect what is written.
    const implicit: Filter[] = fmt.id === 'MGF' && !input.includeMs1 ? [{ type: 'msLevel', levels: '2-' }] : fmt.id === 'MS2' ? [{ type: 'msLevel', levels: '2-' }] : fmt.id === 'MS1' ? [{ type: 'msLevel', levels: '1' }] : [];
    const src = tally(applyFilters(src0, [...filters, ...implicit], say), out);
    if (input.op === 'inspect') {
      const it = src.spectra()[Symbol.asyncIterator]();
      for (let i = 0; i < 200; i++) { const r = await it.next(); if (r.done) break; }
      out.spectraCount = src0.count ?? out.preview.length;
      say(`${src0.count ?? '?'} spectra in the input.`);
      return out;
    }
    const baseName = input.outName?.trim() || stem(bundle.name);
    const opts = Object.fromEntries(Object.entries({
      indexed: input.indexed, mzBits: input.mzBits && Number(input.mzBits), intensityBits: input.intensityBits && Number(input.intensityBits), zlib: input.zlib, mzNumpress: input.mzNumpress,
      intensityNumpress: input.intensityNumpress, passthrough: input.passthrough,
      titleTemplate: input.titleTemplate, includeMs1: input.includeMs1, bits: input.mzBits && Number(input.mzBits),
    }).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    const files = await fmt.write(src, opts, { progress: (f, m) => ctx.progress(Math.min(0.97, f), m), signal: ctx.signal, log: say, baseName, version: CONVERTER_VERSION, processing: filters.map(describe) });
    ctx.progress(0.97, input.outDir ? 'Saving' : 'Preparing download');
    for (const f of files) out.files.push(await save(f, !!input.gzip, input.outDir, !!input.overwrite, say));
    say(`Wrote ${out.spectraCount} spectra${out.chromatogramCount ? ` and ${out.chromatogramCount} chromatograms` : ''} as ${fmt.label}.`);
    ctx.progress(1, 'Done');
    return out;
  } finally {
    src0.close?.();
  }
};
export default run;
