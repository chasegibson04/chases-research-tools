// Readers for the open formats other than mzML: mzXML, MGF, MS1/MS2/CMS1-style text, mzData, imzML (+ .ibd),
// and netCDF ANDI-MS (.cdf, the common GC-MS export). All stream or read by byte range.
import { indexSpectra, parseSpectrumText, openSource, base64ToBytes, type SpectrumMeta } from '@/lib/ms/mzml';
import { unzlibSync } from 'fflate';
import { CV, findFile, readHead, asciiOf, type InputFormat, type InputBundle, type SpectrumSource, type SpectrumRecord, type RunMetadata, type ReaderContext, type CvParam } from '../model';
import { cvParams } from './mzml';

const actCv = (a: string): CvParam[] => {
  const x = a.toUpperCase();
  if (x.includes('ETHCD')) return [CV.ethcd];
  if (x.includes('ETD')) return [CV.etd];
  if (x.includes('HCD')) return [CV.hcd];
  if (x.includes('IRMPD')) return [CV.irmpd];
  if (x.includes('UVPD')) return [CV.uvpd];
  if (x.includes('CID')) return [CV.cid];
  return [];
};

function fromMeta(m: SpectrumMeta, mz: Float64Array, intensity: Float64Array, index: number): SpectrumRecord {
  return {
    index, nativeId: m.id, scan: m.scan ?? undefined, msLevel: m.msLevel, rtSeconds: m.rt != null ? m.rt * 60 : undefined, polarity: m.polarity ?? undefined,
    centroided: m.centroided ?? true, filter: m.filter || undefined, tic: m.tic ?? undefined, basePeakMz: m.basePeakMz ?? undefined, basePeakIntensity: m.basePeakIntensity ?? undefined,
    faimsCv: m.faimsCv ?? undefined,
    precursors: m.msLevel > 1 && m.precursorMz != null ? [{ mz: m.precursorMz, charge: m.charge ?? undefined, activation: actCv(m.activation), collisionEnergy: m.energy ?? undefined }] : [],
    mz, intensity,
  };
}

/** mzXML and MGF via the shared indexer (byte-range reads). */
function indexedFormat(id: 'mzXML' | 'MGF', label: string, test: (head: string) => boolean): InputFormat {
  return {
    id, label,
    async detect(input) { return input.files.length === 1 && test(asciiOf(await readHead(await openSource(input.files[0].file), 8192))); },
    async open(input, ctx) {
      const file = await openSource(input.files[0].file);
      const { info, spectra } = await indexSpectra(file, input.name, (f) => ctx.progress(0.3 * f, 'Indexing'), ctx.signal);
      const meta: RunMetadata = { sourceFormat: id, sourceFiles: [{ id: 'SF1', name: input.name }], software: info.software.map((s, i) => ({ id: `sw${i}`, name: s, version: '' })) };
      return {
        meta, count: spectra.length,
        async *spectra() {
          // Read neighbouring spectra in one block (≤ 32 MB) instead of one slice per spectrum.
          const dec = new TextDecoder('latin1');
          let k = 0;
          while (k < spectra.length) {
            let j = k; const bs = spectra[k].start; let be = spectra[k].end;
            while (j + 1 < spectra.length && spectra[j + 1].start >= be && spectra[j + 1].start - be < 65536 && spectra[j + 1].end - bs < 32e6) { j++; be = spectra[j].end; }
            const text = dec.decode(await file.slice(bs, be).arrayBuffer());
            for (let q = k; q <= j; q++) {
              if (ctx.signal.aborted) throw new Error('Cancelled.');
              const sp = parseSpectrumText(text.slice(spectra[q].start - bs, spectra[q].end - bs), info);
              yield fromMeta(spectra[q], sp.mz, sp.intensity, q);
            }
            ctx.progress(0.3 + 0.7 * ((j + 1) / spectra.length));
            k = j + 1;
          }
        },
      };
    },
  };
}
export const mzxmlFormat = indexedFormat('mzXML', 'mzXML', (h) => /<mzXML/.test(h));
export const mgfFormat = indexedFormat('MGF', 'MGF (Mascot Generic Format)', (h) => /BEGIN IONS/.test(h));

/** MS1 / MS2 / CMS1-like text (McDonald et al. 2004): H header lines, S scan lines, I info, Z charge, then peaks. */
export const msTextFormat: InputFormat = {
  id: 'MS1/MS2', label: 'MS1 / MS2 text',
  async detect(input) {
    if (input.files.length !== 1 || !/\.(ms1|ms2|cms1|cms2|bms1|bms2)$/i.test(input.files[0].path)) return false;
    return /^(H|S)\s/m.test(asciiOf(await readHead(input.files[0].file, 2048)));
  },
  async open(input, ctx) {
    const text = await input.files[0].file.text();
    const ms2 = /\.c?ms2$/i.test(input.files[0].path);
    const recs: SpectrumRecord[] = [];
    let cur: SpectrumRecord | null = null; let mz: number[] = [], it: number[] = [];
    const flush = () => { if (cur) { cur.mz = Float64Array.from(mz); cur.intensity = Float64Array.from(it); recs.push(cur); } mz = []; it = []; };
    for (const line of text.split(/\r?\n/)) {
      const f = line.trim().split(/\s+/);
      if (f[0] === 'S') {
        flush();
        const scan = Number(f[1]);
        cur = { index: recs.length, nativeId: `scan=${scan}`, scan, msLevel: ms2 ? 2 : 1, centroided: true, precursors: ms2 && f[3] ? [{ mz: Number(f[3]), activation: [] }] : [], mz: new Float64Array(0), intensity: new Float64Array(0) };
      } else if (f[0] === 'I' && cur) {
        if (/^RTime$/i.test(f[1])) cur.rtSeconds = Number(f[2]) * 60;
        if (/^ActivationType$/i.test(f[1]) && cur.precursors[0]) cur.precursors[0].activation = actCv(f[2]);
      } else if (f[0] === 'Z' && cur && cur.precursors[0]) cur.precursors[0].charge = Number(f[1]);
      else if (cur && /^[\d.]/.test(f[0]) && f.length >= 2) { mz.push(Number(f[0])); it.push(Number(f[1])); }
    }
    flush();
    ctx.progress(1);
    return { meta: { sourceFormat: ms2 ? 'MS2' : 'MS1', sourceFiles: [{ id: 'SF1', name: input.name }], software: [] }, count: recs.length, async *spectra() { yield* recs; } };
  },
};

/** mzData 1.05 (legacy PSI format). */
export const mzdataFormat: InputFormat = {
  id: 'mzData', label: 'mzData',
  async detect(input) { return input.files.length === 1 && /<mzData\b/.test(asciiOf(await readHead(input.files[0].file, 4096))); },
  async open(input, ctx) {
    const xml = await input.files[0].file.text();
    const arr = (blk: string | undefined) => {
      if (!blk) return new Float64Array(0);
      const d = /<data\b([^>]*)>([\s\S]*?)<\/data>/.exec(blk);
      if (!d) return new Float64Array(0);
      const p64 = /precision="64"/.test(d[1]), big = /endian="big"/.test(d[1]);
      const bytes = base64ToBytes(d[2]); const dv = new DataView(bytes.slice().buffer);
      const n = bytes.length / (p64 ? 8 : 4); const out = new Float64Array(n);
      for (let i = 0; i < n; i++) out[i] = p64 ? dv.getFloat64(i * 8, !big) : dv.getFloat32(i * 4, !big);
      return out;
    };
    const recs: SpectrumRecord[] = [...xml.matchAll(/<spectrum\b[^>]*id="([^"]*)"[\s\S]*?<\/spectrum>/g)].map((m, i) => {
      const s = m[0];
      const level = Number(/msLevel="(\d+)"/.exec(s)?.[1] ?? 1);
      const cvp = (n: string) => new RegExp(`<cvParam[^>]*name="${n}"[^>]*value="([^"]*)"`, 'i').exec(s)?.[1];
      const rt = cvp('TimeInMinutes') ?? cvp('time.min') ?? cvp('RetentionTime');
      const pmz = cvp('MassToChargeRatio') ?? cvp('mz');
      return {
        index: i, nativeId: `spectrum=${m[1]}`, scan: Number(m[1]) || undefined, msLevel: level, rtSeconds: rt ? Number(rt) * 60 : undefined, centroided: !/spectrumType="continuous"/.test(s),
        precursors: level > 1 && pmz ? [{ mz: Number(pmz), charge: cvp('ChargeState') ? Number(cvp('ChargeState')) : undefined, activation: [] }] : [],
        mz: arr(/<mzArrayBinary>[\s\S]*?<\/mzArrayBinary>/.exec(s)?.[0]), intensity: arr(/<intenArrayBinary>[\s\S]*?<\/intenArrayBinary>/.exec(s)?.[0]),
      };
    });
    ctx.progress(1);
    return { meta: { sourceFormat: 'mzData', sourceFiles: [{ id: 'SF1', name: input.name }], software: [] }, count: recs.length, async *spectra() { yield* recs; } };
  },
};

/** imzML: an mzML-like XML whose arrays live in the companion .ibd file (external offsets per array). */
export const imzmlFormat: InputFormat = {
  id: 'imzML', label: 'imzML + .ibd (imaging)',
  async detect(input) { return !!findFile(input, '.imzml') && !!findFile(input, '.ibd'); },
  async open(input, ctx) {
    const x = await findFile(input, '.imzml')!.file.text();
    const ibd = findFile(input, '.ibd')!.file;
    const groups: Record<string, string> = {};
    for (const m of x.matchAll(/<referenceableParamGroup\s+id="([^"]+)"\s*>([\s\S]*?)<\/referenceableParamGroup>/g)) groups[m[1]] = m[2];
    const specs = [...x.matchAll(/<spectrum\b[\s\S]*?<\/spectrum>/g)].map((m) => m[0]);
    return {
      meta: { sourceFormat: 'imzML', sourceFiles: [{ id: 'SF1', name: input.name }], software: [] }, count: specs.length,
      async *spectra() {
        for (let i = 0; i < specs.length; i++) {
          const s = specs[i].replace(/<referenceableParamGroupRef\s+ref="([^"]+)"\s*\/>/g, (_, id) => groups[id] ?? '');
          const arrays = [...s.matchAll(/<binaryDataArray\b[\s\S]*?<\/binaryDataArray>/g)].map((b) => {
            const p = cvParams(b[0]); const v = (acc: string) => Number(p.find((c) => c.accession === acc)?.value);
            const off = v('IMS:1000102'), len = v('IMS:1000103'), enc = v('IMS:1000104');
            return { p, off, len, enc, kind: p.some((c) => c.accession === 'MS:1000514') ? 'mz' : 'int', b64: p.some((c) => c.accession === 'MS:1000523') ? 8 : 4, zlib: p.some((c) => c.accession === 'MS:1000574'), int: p.some((c) => /^IMS:1000141|^MS:1000519$/.test(c.accession)) };
          });
          const read = async (a: (typeof arrays)[number]) => {
            let bytes = new Uint8Array(await ibd.slice(a.off, a.off + a.enc).arrayBuffer());
            if (a.zlib) bytes = unzlibSync(bytes);
            const dv = new DataView(bytes.slice().buffer); const n = a.len; const out = new Float64Array(n);
            for (let k = 0; k < n; k++) out[k] = a.b64 === 8 ? dv.getFloat64(k * 8, true) : a.int ? dv.getInt32(k * 4, true) : dv.getFloat32(k * 4, true);
            return out;
          };
          const mz = arrays.find((a) => a.kind === 'mz'), it = arrays.find((a) => a.kind === 'int');
          const pos = cvParams(s).filter((c) => /^IMS:100005[012]$/.test(c.accession));
          yield {
            index: i, nativeId: /\bid="([^"]*)"/.exec(s)?.[1] ?? `index=${i}`, msLevel: 1, centroided: /MS:1000127/.test(s),
            precursors: [], mz: mz ? await read(mz) : new Float64Array(0), intensity: it ? await read(it) : new Float64Array(0),
            userParams: pos.map((c) => ({ name: c.name, value: c.value })),
          } as SpectrumRecord;
          if (i % 100 === 0) ctx.progress(i / specs.length);
        }
      },
    };
  },
};

// ---- netCDF classic (CDF-1/2) reader, just enough for ANDI-MS (ASTM E2078) ------------------------------
interface NcVar { name: string; dims: number[]; type: number; begin: number; size: number; attrs: Record<string, string | number[]> }
async function readNetcdf(file: Blob): Promise<{ dims: Array<{ name: string; len: number }>; vars: NcVar[]; recLen: number; numRecs: number; attrs: Record<string, string | number[]> }> {
  const headBytes = new Uint8Array(await file.slice(0, Math.min(file.size, 4 << 20)).arrayBuffer());
  const dv = new DataView(headBytes.buffer);
  if (String.fromCharCode(...headBytes.slice(0, 3)) !== 'CDF') throw new Error('Not a netCDF classic file (HDF5-based netCDF-4 is not supported).');
  const v2 = headBytes[3] === 2; let o = 4;
  const u32 = () => { const v = dv.getUint32(o, false); o += 4; return v; };
  const off = () => { if (v2) { const hi = dv.getUint32(o, false), lo = dv.getUint32(o + 4, false); o += 8; return hi * 2 ** 32 + lo; } return u32(); };
  const name = () => { const n = u32(); const s = new TextDecoder().decode(headBytes.slice(o, o + n)); o += Math.ceil(n / 4) * 4; return s; };
  const SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 4, 6: 8 };
  const values = (type: number, n: number): string | number[] => {
    if (type === 2) { const s = new TextDecoder('latin1').decode(headBytes.slice(o, o + n)).replace(/\0+$/, ''); o += Math.ceil(n / 4) * 4; return s; }
    const out: number[] = [];
    for (let i = 0; i < n; i++) { const p = o + i * SIZE[type]; out.push(type === 1 ? dv.getInt8(p) : type === 3 ? dv.getInt16(p, false) : type === 4 ? dv.getInt32(p, false) : type === 5 ? dv.getFloat32(p, false) : dv.getFloat64(p, false)); }
    o += Math.ceil((n * SIZE[type]) / 4) * 4; return out;
  };
  const attrList = () => { const tag = u32(); const n = u32(); const a: Record<string, string | number[]> = {}; if (tag === 0 && n === 0) return a; for (let i = 0; i < n; i++) { const nm = name(); const t = u32(); const cnt = u32(); a[nm] = values(t, cnt); } return a; };
  const numRecs = u32();
  const dims: Array<{ name: string; len: number }> = [];
  { const tag = u32(); const n = u32(); if (tag || n) for (let i = 0; i < n; i++) { const nm = name(); dims.push({ name: nm, len: u32() }); } }
  const attrs = attrList();
  const vars: NcVar[] = [];
  { const tag = u32(); const n = u32(); if (tag || n) for (let i = 0; i < n; i++) { const nm = name(); const nd = u32(); const d: number[] = []; for (let k = 0; k < nd; k++) d.push(u32()); const va = attrList(); const t = u32(); const size = u32(); const begin = off(); vars.push({ name: nm, dims: d, type: t, begin, size, attrs: va }); } }
  const recVars = vars.filter((v) => v.dims.length && dims[v.dims[0]].len === 0);
  const recLen = recVars.reduce((s, v) => s + v.size, 0);
  return { dims, vars, recLen, numRecs, attrs };
}
async function readVar(file: Blob, v: NcVar, n: number): Promise<Float64Array> {
  const SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 4, 6: 8 };
  const bytes = new Uint8Array(await file.slice(v.begin, v.begin + n * SIZE[v.type]).arrayBuffer());
  const dv = new DataView(bytes.buffer); const out = new Float64Array(n);
  for (let i = 0; i < n; i++) { const p = i * SIZE[v.type]; out[i] = v.type === 3 ? dv.getInt16(p, false) : v.type === 4 ? dv.getInt32(p, false) : v.type === 5 ? dv.getFloat32(p, false) : v.type === 6 ? dv.getFloat64(p, false) : dv.getInt8(p); }
  return out;
}
export const andiFormat: InputFormat = {
  id: 'ANDI', label: 'netCDF ANDI-MS (.cdf, GC-MS/LC-MS)',
  async detect(input) { return input.files.length === 1 && /\.(cdf|nc)$/i.test(input.files[0].path) && asciiOf(await readHead(input.files[0].file, 4)).startsWith('CDF'); },
  async open(input, ctx) {
    const file = input.files[0].file;
    const nc = await readNetcdf(file);
    const V = (n: string) => nc.vars.find((v) => v.name === n);
    const lenOf = (v: NcVar) => v.dims.reduce((p, d) => p * (nc.dims[d].len || nc.numRecs), 1);
    const scanIndex = await readVar(file, V('scan_index')!, lenOf(V('scan_index')!));
    const pointCount = await readVar(file, V('point_count')!, lenOf(V('point_count')!));
    const times = await readVar(file, V('scan_acquisition_time')!, lenOf(V('scan_acquisition_time')!));
    const tic = V('total_intensity') ? await readVar(file, V('total_intensity')!, lenOf(V('total_intensity')!)) : null;
    const massV = V('mass_values')!, intV = V('intensity_values')!;
    const SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 4, 6: 8 };
    const mScale = Number((massV.attrs.scale_factor as number[] | undefined)?.[0] ?? 1), iScale = Number((intV.attrs.scale_factor as number[] | undefined)?.[0] ?? 1);
    const g = nc.attrs;
    const meta: RunMetadata = {
      sourceFormat: 'netCDF ANDI-MS', sourceFiles: [{ id: 'SF1', name: input.name }],
      software: [{ id: 'andi', name: String(g.source_file_format ?? 'ANDI-MS'), version: String(g.ms_template_revision ?? '') }],
      startTimeStamp: typeof g.experiment_date_time_stamp === 'string' ? g.experiment_date_time_stamp : undefined,
      instrument: typeof g.instrument_name === 'string' ? { name: g.instrument_name } : undefined,
      extra: Object.fromEntries(Object.entries(g).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, String(v)])),
    };
    const n = scanIndex.length;
    return {
      meta, count: n,
      async *spectra() {
        for (let i = 0; i < n; i++) {
          if (ctx.signal.aborted) throw new Error('Cancelled.');
          const start = scanIndex[i], cnt = pointCount[i];
          const read = async (v: NcVar, scale: number) => {
            const sz = SIZE[v.type];
            const bytes = new Uint8Array(await file.slice(v.begin + start * sz, v.begin + (start + cnt) * sz).arrayBuffer());
            const dv = new DataView(bytes.buffer); const out = new Float64Array(cnt);
            for (let k = 0; k < cnt; k++) { const p = k * sz; out[k] = (v.type === 3 ? dv.getInt16(p, false) : v.type === 4 ? dv.getInt32(p, false) : v.type === 5 ? dv.getFloat32(p, false) : dv.getFloat64(p, false)) * scale; }
            return out;
          };
          yield { index: i, nativeId: `scan=${i + 1}`, scan: i + 1, msLevel: 1, rtSeconds: times[i], centroided: true, tic: tic?.[i], precursors: [], mz: await read(massV, mScale), intensity: await read(intV, iScale) } as SpectrumRecord;
          if (i % 100 === 0) ctx.progress(i / n, `Scan ${i + 1}/${n}`);
        }
      },
    };
  },
};
export type { InputBundle };
