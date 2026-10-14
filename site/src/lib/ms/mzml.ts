// Streaming mzML / MGF reader for the browser. Nothing is uploaded: the File is read in slices inside the worker.
//   indexSpectra(): one pass over the bytes, recording each spectrum's byte range and parsing only its header
//                   (works for plain and indexed mzML; the embedded index is not trusted, see README).
//   readSpectrum(): decodes the binary arrays of one spectrum from its byte range (base64 → zlib → Numpress → floats).
// Accession numbers are from the PSI-MS controlled vocabulary (psi-ms.obo 4.2.x).
import { unzlibSync } from 'fflate';
import { decodeLinear, decodePic, decodeSlof } from './numpress';

export type Source = Blob;

export interface SpectrumMeta {
  index: number;
  id: string;
  scan: number | null;
  msLevel: number;
  rt: number | null; // minutes
  tic: number | null;
  basePeakMz: number | null;
  basePeakIntensity: number | null;
  centroided: boolean | null;
  polarity: '+' | '-' | null;
  precursorMz: number | null;
  /** Charge written by the converter (often unreliable for Thermo files; the UI lets you override it). */
  charge: number | null;
  isoLower: number | null;
  isoUpper: number | null;
  activation: string; // from cvParams, refined by the filter string
  energy: number | null;
  filter: string;
  points: number;
  /** FAIMS compensation voltage (V), when present. */
  faimsCv: number | null;
  start: number; // byte range in the file
  end: number;
  /** MGF only: the block's peak text is parsed on demand from the same range. */
}

export interface FileInfo {
  format: 'mzML' | 'MGF' | 'mzXML';
  name: string;
  size: number;
  indexed: boolean;
  software: string[];
  instrument: string;
  paramGroups: Record<string, string>; // id → raw cvParam XML (expanded at read time)
}

const ACT: Record<string, string> = {
  'MS:1000422': 'HCD', 'MS:1000133': 'CID', 'MS:1002472': 'CID', 'MS:1000598': 'ETD', 'MS:1000250': 'ECD', 'MS:1003246': 'UVPD',
  'MS:1000435': 'PD', 'MS:1002631': 'EThcD', 'MS:1000262': 'IRMPD',
};

const num = (s: string | undefined | null) => (s == null || s === '' ? null : Number(s));
function cv(xml: string, acc: string): string | null {
  const re = new RegExp(`<cvParam[^>]*accession="${acc}"[^>]*>`);
  const m = re.exec(xml);
  if (!m) return null;
  const v = /value="([^"]*)"/.exec(m[0]);
  return v ? v[1] : '';
}
const hasCv = (xml: string, acc: string) => xml.includes(`accession="${acc}"`);
const expandGroups = (xml: string, groups: Record<string, string>) =>
  xml.replace(/<referenceableParamGroupRef\s+ref="([^"]+)"\s*\/>/g, (_, id) => groups[id] ?? '');

/**
 * Activation from the Thermo filter string, which is more reliable than the converter's cvParams
 * (ThermoRawFileParser and msconvert both mislabel IR, EThcD and ETciD). "@etd50.00@hcd30.00" = EThcD,
 * "@modeC" = IR laser, "sa" = supplemental activation.
 */
export function activationFromFilter(filter: string): { activation: string | null; energy: number | null } {
  const acts = [...filter.matchAll(/@([a-zA-Z]+)(\d+(?:\.\d+)?)/g)].map((m) => [m[1].toLowerCase(), Number(m[2])] as [string, number]);
  if (!acts.length) return { activation: null, energy: null };
  // MS2 portion: the activations after the last precursor in an MSn filter are the last stage
  const stage = filter.split(/\s(?=\d+\.\d+@)/).pop() ?? filter;
  const st = [...stage.matchAll(/@([a-zA-Z]+)(\d+(?:\.\d+)?)/g)].map((m) => [m[1].toLowerCase(), Number(m[2])] as [string, number]);
  const kinds = new Set(st.map((a) => a[0]));
  const ir = kinds.has('modec') || kinds.has('ir');
  let activation: string;
  if (kinds.has('etd') && kinds.has('hcd')) activation = 'EThcD';
  else if (kinds.has('etd') && kinds.has('cid')) activation = 'ETciD';
  else if (kinds.has('etd') && ir) activation = 'IR-ETD';
  else if (kinds.has('etd')) activation = 'ETD';
  else if (kinds.has('hcd')) activation = 'HCD';
  else if (kinds.has('cid')) activation = 'CID';
  else if (ir) activation = 'IRMPD';
  else if (kinds.has('uvpd')) activation = 'UVPD';
  else activation = st[0][0].toUpperCase();
  const energyAct = st.find((a) => a[0] === 'hcd' || a[0] === 'cid') ?? st[0];
  return { activation, energy: energyAct ? energyAct[1] : null };
}

export function parseSpectrumHeader(xml: string, groups: Record<string, string>, start: number, end: number, index: number): SpectrumMeta {
  const x = expandGroups(xml, groups);
  const head = /<spectrum\b[^>]*>/.exec(x)?.[0] ?? '';
  const id = /\bid="([^"]*)"/.exec(head)?.[1] ?? `index=${index}`;
  const idx = Number(/\bindex="(\d+)"/.exec(head)?.[1] ?? index);
  const points = Number(/defaultArrayLength="(\d+)"/.exec(head)?.[1] ?? 0);
  const scan = num(/scan=(\d+)/.exec(id)?.[1] ?? null);
  const rtRaw = /<cvParam[^>]*accession="MS:1000016"[^>]*>/.exec(x)?.[0];
  let rt: number | null = null;
  if (rtRaw) { const v = Number(/value="([^"]*)"/.exec(rtRaw)?.[1]); rt = /UO:0000010|unitName="second"/.test(rtRaw) ? v / 60 : v; }
  const filter = cv(x, 'MS:1000512') ?? '';
  const precursorBlock = /<precursor\b[\s\S]*?<\/precursor>/g;
  let lastPrec = '';
  for (let m; (m = precursorBlock.exec(x));) lastPrec = m[0]; // MSn: use the last precursor
  const target = num(cv(lastPrec, 'MS:1000827'));
  const lo = num(cv(lastPrec, 'MS:1000828')), hi = num(cv(lastPrec, 'MS:1000829'));
  let activation = '';
  for (const [acc, name] of Object.entries(ACT)) if (hasCv(lastPrec, acc)) { activation = activation ? `${activation}+${name}` : name; }
  if (hasCv(lastPrec, 'MS:1002678')) activation = activation === 'ETD' ? 'EThcD' : activation; // supplemental beam-type CID
  if (hasCv(lastPrec, 'MS:1002679')) activation = activation === 'ETD' ? 'ETciD' : activation;
  let energy = num(cv(lastPrec, 'MS:1000045'));
  const fromFilter = activationFromFilter(filter);
  if (fromFilter.activation) { activation = fromFilter.activation; if (fromFilter.energy != null) energy = fromFilter.energy; }
  const msLevel = Number(cv(x, 'MS:1000511') ?? (lastPrec ? 2 : 1));
  // Some writers (e.g. MZmine/MSDK exports) omit <precursor>; the Thermo filter string still has it.
  const filterPrec = [...filter.matchAll(/ms\d+\s+([\d.]+)@|\s([\d.]+)@[a-z]/gi)].map((m) => Number(m[1] ?? m[2])).filter(Number.isFinite).pop() ?? null;
  return {
    index: idx, id, scan, msLevel, rt,
    tic: num(cv(x, 'MS:1000285')), basePeakMz: num(cv(x, 'MS:1000504')), basePeakIntensity: num(cv(x, 'MS:1000505')),
    centroided: hasCv(x, 'MS:1000127') ? true : hasCv(x, 'MS:1000128') ? false : null,
    polarity: hasCv(x, 'MS:1000130') ? '+' : hasCv(x, 'MS:1000129') ? '-' : null,
    precursorMz: num(cv(lastPrec, 'MS:1000744')) ?? target ?? (msLevel > 1 ? filterPrec : null), charge: num(cv(lastPrec, 'MS:1000041')),
    isoLower: target != null && lo != null ? target - lo : null, isoUpper: target != null && hi != null ? target + hi : null,
    activation: msLevel > 1 ? activation || 'unknown' : '', energy: msLevel > 1 ? energy : null, filter, points, start, end,
    faimsCv: num(cv(x, 'MS:1001581')),
  };
}

/** mzXML <scan> header (attributes + precursorMz element). Nested MS2 scans are indexed as their own entries. */
function parseMzxmlHeader(xml: string, start: number, end: number, index: number): SpectrumMeta {
  const tag = /<scan\b[^>]*>/.exec(xml)?.[0] ?? '';
  const attr = (k: string) => new RegExp(`\\b${k}="([^"]*)"`).exec(tag)?.[1] ?? null;
  const rtRaw = attr('retentionTime');
  const rtM = rtRaw ? /^PT?([\d.]+)(S|M)?$/i.exec(rtRaw) : null;
  const rt = rtM ? (rtM[2]?.toUpperCase() === 'M' ? Number(rtM[1]) : Number(rtM[1]) / 60) : null;
  const pm = /<precursorMz\b([^>]*)>\s*([\d.eE+-]+)\s*<\/precursorMz>/.exec(xml);
  const pAttr = (k: string) => (pm ? new RegExp(`\\b${k}="([^"]*)"`).exec(pm[1])?.[1] ?? null : null);
  const filter = attr('filterLine') ?? '';
  const msLevel = Number(attr('msLevel') ?? 1);
  const fromFilter = activationFromFilter(filter);
  const act = (pAttr('activationMethod') ?? '').toUpperCase();
  return {
    index, id: `scan=${attr('num') ?? index + 1}`, scan: num(attr('num')), msLevel, rt,
    tic: num(attr('totIonCurrent')), basePeakMz: num(attr('basePeakMz')), basePeakIntensity: num(attr('basePeakIntensity')),
    centroided: attr('centroided') == null ? null : attr('centroided') === '1', polarity: attr('polarity') === '-' ? '-' : attr('polarity') === '+' ? '+' : null,
    precursorMz: pm ? Number(pm[2]) : null, charge: num(pAttr('precursorCharge')), isoLower: null, isoUpper: null,
    activation: msLevel > 1 ? fromFilter.activation ?? (act === 'HCD' ? 'HCD' : act === 'CID' ? 'CID' : act === 'ETD' ? 'ETD' : act || 'unknown') : '',
    energy: msLevel > 1 ? fromFilter.energy ?? num(attr('collisionEnergy')) : null, filter, points: Number(attr('peaksCount') ?? 0), start, end, faimsCv: null,
  };
}

/** Decompress .mzML.gz / .mgf.gz into an in-memory Blob (gzip has no random access). Other files pass through. */
export async function openSource(file: Blob): Promise<Blob> {
  const magic = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (magic[0] !== 0x1f || magic[1] !== 0x8b) return file;
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress .gz files; unzip the file first.');
  return await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).blob();
}

function parseMgfHeader(block: string, start: number, end: number, index: number): SpectrumMeta {
  const get = (k: string) => new RegExp(`^${k}=(.*)$`, 'mi').exec(block)?.[1]?.trim() ?? null;
  const pep = get('PEPMASS');
  const title = get('TITLE') ?? `spectrum ${index + 1}`;
  const rtSec = num(get('RTINSECONDS'));
  const filter = /FTMS|ITMS|ASTMS/.test(title) ? title : '';
  const act = activationFromFilter(title);
  const lines = block.split('\n').filter((l) => /^\s*\d/.test(l));
  return {
    index, id: title, scan: num(get('SCANS')?.split(/[-,]/)[0] ?? null), msLevel: Number(get('MSLEVEL') ?? 2), rt: rtSec != null ? rtSec / 60 : null,
    tic: null, basePeakMz: null, basePeakIntensity: null, centroided: true, polarity: null,
    precursorMz: pep ? Number(pep.split(/\s+/)[0]) : null, charge: num(get('CHARGE')?.replace(/[^0-9]/g, '') ?? null), isoLower: null, isoUpper: null,
    activation: act.activation ?? 'unknown', energy: act.energy, filter, points: lines.length, start, end, faimsCv: null,
  };
}

/** One pass over the file. Calls onProgress(fraction). Works on Blob/File (browser) and on Node Blobs (tests). */
export async function indexSpectra(file: Source, name: string, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<{ info: FileInfo; spectra: SpectrumMeta[] }> {
  const dec = new TextDecoder('latin1'); // one char per byte, so string offsets are byte offsets
  const headText = dec.decode(await file.slice(0, Math.min(file.size, 256 * 1024)).arrayBuffer());
  const isMzxml = /<mzXML/.test(headText);
  const isMgf = !isMzxml && /BEGIN IONS/.test(headText) && !/<mzML/.test(headText);
  if (!isMgf && !isMzxml && !/<mzML/.test(headText)) throw new Error('This does not look like an mzML, mzXML or MGF file. Convert vendor files first (e.g. ThermoRawFileParser -f 2, or msconvert --mzML).');
  const groups: Record<string, string> = {};
  for (const m of headText.matchAll(/<referenceableParamGroup\s+id="([^"]+)"\s*>([\s\S]*?)<\/referenceableParamGroup>/g)) groups[m[1]] = m[2];
  const software = [...headText.matchAll(/<software\b[^>]*>[\s\S]*?<\/software>/g)].map((m) => {
    const ver = /version="([^"]*)"/.exec(m[0])?.[1] ?? '';
    const nm = /<(?:cvParam|userParam)[^>]*name="([^"]*)"/.exec(m[0])?.[1] ?? /id="([^"]*)"/.exec(m[0])?.[1] ?? '';
    return `${nm} ${ver}`.trim();
  });
  const instrument = /<instrumentConfiguration\b[\s\S]*?<cvParam[^>]*name="([^"]*)"/.exec(headText)?.[1] ?? '';
  const info: FileInfo = { format: isMgf ? 'MGF' : isMzxml ? 'mzXML' : 'mzML', name, size: file.size, indexed: /<indexedmzML/.test(headText), software, instrument, paramGroups: groups };

  const OPEN = isMgf ? 'BEGIN IONS' : isMzxml ? '<scan ' : '<spectrum ';
  const HEADER_END = isMgf ? 'END IONS' : isMzxml ? '<peaks' : '<binaryDataArrayList';
  const CLOSE = isMgf ? 'END IONS' : isMzxml ? '</peaks>' : '</spectrum>';
  const spectra: SpectrumMeta[] = [];
  const reader = (file.stream() as ReadableStream<Uint8Array>).getReader();
  let buf = '', base = 0, read = 0;
  let state: 'seek' | 'header' | 'body' = 'seek';
  let start = 0, header = '';
  for (;;) {
    if (signal?.aborted) throw new Error('Cancelled.');
    const { value, done } = await reader.read();
    if (value) { buf += dec.decode(value, { stream: true }); read += value.length; onProgress?.(read / file.size); }
    for (;;) {
      if (state === 'seek') {
        const i = buf.indexOf(OPEN);
        if (i < 0) { const keep = Math.min(buf.length, OPEN.length); base += buf.length - keep; buf = buf.slice(buf.length - keep); break; }
        start = base + i; base += i; buf = buf.slice(i); state = 'header';
      }
      if (state === 'header') {
        let i = buf.indexOf(HEADER_END);
        const close = buf.indexOf(CLOSE);
        if (i < 0 && close >= 0) i = close; // spectrum without arrays
        if (i < 0) { if (buf.length > 4e6) throw new Error('Spectrum header too large; the file may be malformed.'); break; }
        header = buf.slice(0, isMgf ? i : i); state = 'body';
        base += i; buf = buf.slice(i);
      }
      if (state === 'body') {
        const i = buf.indexOf(CLOSE);
        if (i < 0) { const keep = Math.min(buf.length, CLOSE.length); base += buf.length - keep; buf = buf.slice(buf.length - keep); break; }
        const end = base + i + CLOSE.length;
        spectra.push(isMgf ? parseMgfHeader(header, start, end, spectra.length) : isMzxml ? parseMzxmlHeader(header, start, end, spectra.length) : parseSpectrumHeader(header, groups, start, end, spectra.length));
        base += i + CLOSE.length; buf = buf.slice(i + CLOSE.length); state = 'seek';
      }
    }
    if (done) break;
  }
  if (!spectra.length) throw new Error('No spectra found in the file.');
  return { info, spectra };
}

// ---- binary decoding ----------------------------------------------------------------------------
const B64 = (() => { const t = new Uint8Array(256).fill(255); 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.split('').forEach((c, i) => (t[c.charCodeAt(0)] = i)); return t; })();
export function base64ToBytes(s: string): Uint8Array {
  const anyU8 = Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array };
  const clean = s.replace(/\s+/g, '');
  if (anyU8.fromBase64) { try { return anyU8.fromBase64(clean); } catch { /* fall back */ } }
  const len = clean.length, pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const out = new Uint8Array(((len * 3) >> 2) - pad);
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const a = B64[clean.charCodeAt(i)], b = B64[clean.charCodeAt(i + 1)], c = B64[clean.charCodeAt(i + 2)], d = B64[clean.charCodeAt(i + 3)];
    const v = (a << 18) | (b << 12) | ((c & 63) << 6) | (d & 63);
    if (o < out.length) out[o++] = (v >> 16) & 255;
    if (o < out.length) out[o++] = (v >> 8) & 255;
    if (o < out.length) out[o++] = v & 255;
  }
  return out;
}

/** Ion-mobility array accessions: mean/raw inverse reduced IM, drift time, generic IM array. */
const MOBILITY = /MS:1002893|MS:1003006|MS:1003007|MS:1003008|MS:1002477|MS:1003153|MS:1003156|MS:1002816/;
export function decodeArray(cvXml: string, b64: string): { kind: 'mz' | 'intensity' | 'mobility' | 'other'; values: Float64Array } {
  const kind = cvXml.includes('MS:1000514') ? 'mz' : cvXml.includes('MS:1000515') ? 'intensity' : MOBILITY.test(cvXml) ? 'mobility' : 'other';
  let bytes = base64ToBytes(b64);
  if (!bytes.length) return { kind, values: new Float64Array(0) };
  if (/MS:100378[0-5]/.test(cvXml)) throw new Error('zstd-compressed arrays are not supported in the browser yet; re-convert with zlib.');
  const zlib = /MS:1000574|MS:100274[678]|MS:100308[89]|MS:1003090/.test(cvXml);
  if (zlib) bytes = unzlibSync(bytes);
  if (/MS:1002312|MS:1002746/.test(cvXml)) return { kind, values: decodeLinear(bytes) };
  if (/MS:1002313|MS:1002747/.test(cvXml)) return { kind, values: decodePic(bytes) };
  if (/MS:1002314|MS:1002748/.test(cvXml)) return { kind, values: decodeSlof(bytes) };
  const copy = bytes.slice(); // align
  const dv = new DataView(copy.buffer);
  if (cvXml.includes('MS:1000521')) { const n = copy.length >> 2, v = new Float64Array(n); for (let i = 0; i < n; i++) v[i] = dv.getFloat32(i * 4, true); return { kind, values: v }; }
  if (cvXml.includes('MS:1000519')) { const n = copy.length >> 2, v = new Float64Array(n); for (let i = 0; i < n; i++) v[i] = dv.getInt32(i * 4, true); return { kind, values: v }; }
  if (cvXml.includes('MS:1000522')) { const n = copy.length >> 3, v = new Float64Array(n); for (let i = 0; i < n; i++) v[i] = Number(dv.getBigInt64(i * 8, true)); return { kind, values: v }; }
  const n = copy.length >> 3, v = new Float64Array(n); for (let i = 0; i < n; i++) v[i] = dv.getFloat64(i * 8, true);
  return { kind, values: v };
}

export interface RawSpectrum { mz: Float64Array; intensity: Float64Array; mobility?: Float64Array }

export async function readSpectrum(file: Source, meta: Pick<SpectrumMeta, 'start' | 'end'>, info: Pick<FileInfo, 'format' | 'paramGroups'>): Promise<RawSpectrum> {
  return parseSpectrumText(new TextDecoder('latin1').decode(await file.slice(meta.start, meta.end).arrayBuffer()), info);
}

/** Decode one spectrum from its text (latin1-decoded bytes of the <spectrum> element or MGF block). */
export function parseSpectrumText(text: string, info: Pick<FileInfo, 'format' | 'paramGroups'>): RawSpectrum {
  if (info.format === 'MGF') {
    const mz: number[] = [], it: number[] = [];
    for (const line of text.split('\n')) {
      const m = /^\s*([0-9.eE+-]+)[\s,;]+([0-9.eE+-]+)/.exec(line);
      if (m && !line.includes('=')) { mz.push(Number(m[1])); it.push(Number(m[2])); }
    }
    return sortPair(Float64Array.from(mz), Float64Array.from(it));
  }
  if (info.format === 'mzXML') return parseMzxmlPeaks(text);
  let mz: Float64Array = new Float64Array(0), intensity: Float64Array = new Float64Array(0);
  let mobility: Float64Array | undefined;
  for (const m of text.matchAll(/<binaryDataArray\b[\s\S]*?<\/binaryDataArray>/g)) {
    const block = expandGroups(m[0], info.paramGroups);
    const bin = /<binary>([\s\S]*?)<\/binary>/.exec(block)?.[1] ?? '';
    const cvs = block.slice(0, block.indexOf('<binary>'));
    const arr = decodeArray(cvs, bin);
    if (arr.kind === 'mz') mz = arr.values; else if (arr.kind === 'intensity') intensity = arr.values; else if (arr.kind === 'mobility') mobility = arr.values;
  }
  const n = Math.min(mz.length, intensity.length);
  return sortPair(mz.subarray(0, n), intensity.subarray(0, n), mobility && mobility.length >= n ? mobility.subarray(0, n) : undefined);
}

/** mzXML <peaks>: interleaved (m/z, intensity) pairs, big-endian ("network") 32/64-bit, optionally zlib. */
function parseMzxmlPeaks(text: string): RawSpectrum {
  const m = /<peaks\b([^>]*)>([\s\S]*?)<\/peaks>/.exec(text);
  if (!m || !m[2].trim()) return { mz: new Float64Array(0), intensity: new Float64Array(0) };
  const a = (k: string) => new RegExp(`\\b${k}="([^"]*)"`).exec(m[1])?.[1] ?? '';
  let bytes = base64ToBytes(m[2]);
  if (a('compressionType') === 'zlib') bytes = unzlibSync(bytes);
  const p64 = a('precision') === '64';
  const little = a('byteOrder') === 'little';
  const dv = new DataView(bytes.slice().buffer);
  const step = p64 ? 8 : 4, n = Math.floor(bytes.length / (2 * step));
  const mz = new Float64Array(n), it = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const o = 2 * i * step;
    mz[i] = p64 ? dv.getFloat64(o, little) : dv.getFloat32(o, little);
    it[i] = p64 ? dv.getFloat64(o + step, little) : dv.getFloat32(o + step, little);
  }
  return sortPair(mz, it);
}

function sortPair(mz: Float64Array, it: Float64Array, mob?: Float64Array): RawSpectrum {
  let sorted = true;
  for (let i = 1; i < mz.length; i++) if (mz[i] < mz[i - 1]) { sorted = false; break; }
  if (sorted) return mob ? { mz, intensity: it, mobility: mob } : { mz, intensity: it };
  const idx = Array.from(mz.keys()).sort((a, b) => mz[a] - mz[b]);
  const out: RawSpectrum = { mz: Float64Array.from(idx, (i) => mz[i]), intensity: Float64Array.from(idx, (i) => it[i]) };
  if (mob) out.mobility = Float64Array.from(idx, (i) => mob[i]);
  return out;
}

/** Keep only points inside an ion-mobility window (e.g. 1/K0 0.85–1.05 V·s/cm²). */
export function filterMobility(s: RawSpectrum, lo: number, hi: number): RawSpectrum {
  if (!s.mobility) return s;
  const keep: number[] = [];
  for (let i = 0; i < s.mz.length; i++) if (s.mobility[i] >= lo && s.mobility[i] <= hi) keep.push(i);
  return { mz: Float64Array.from(keep, (i) => s.mz[i]), intensity: Float64Array.from(keep, (i) => s.intensity[i]), mobility: Float64Array.from(keep, (i) => s.mobility![i]) };
}
