// Shared writer plumbing: a byte builder that spills to Blob parts (so large outputs are not one giant string),
// incremental SHA-1 (WebCrypto has no streaming digest), base64, XML escaping and binary-array encoding.
import { zlibSync } from 'fflate';
import { encodeLinear, encodePic, encodeSlof } from '@/lib/ms/numpress';
import type { SpectrumRecord, SpectrumSource } from '../model';

const enc = new TextEncoder();
/** zlib level for binary arrays: 6 (zlib's and msconvert's default); levels 1–6 measured the same speed and size on float arrays. */
export const ZLIB_LEVEL = 6;

/** Accumulates output bytes; flushes to Blob parts every few MB. Tracks the total length for offsets. */
export class ByteBuilder {
  private parts: BlobPart[] = [];
  private pending: Uint8Array[] = [];
  private pendingLen = 0;
  length = 0;
  hash: Sha1 | null;
  constructor(hash = false) { this.hash = hash ? new Sha1() : null; }
  push(x: string | Uint8Array) {
    const b = typeof x === 'string' ? enc.encode(x) : x;
    this.pending.push(b); this.pendingLen += b.length; this.length += b.length;
    this.hash?.update(b);
    if (this.pendingLen > 8 << 20) this.flush();
  }
  /** Append a Blob without holding it in memory (hashing it by streaming when a hash is kept). */
  async pushBlob(b: Blob) {
    this.flush();
    if (this.hash) { const r = (b.stream() as ReadableStream<Uint8Array>).getReader(); for (;;) { const { value, done } = await r.read(); if (value) this.hash.update(value); if (done) break; } }
    this.parts.push(b); this.length += b.size;
  }
  private flush() { if (this.pending.length) { this.parts.push(new Blob(this.pending as BlobPart[])); this.pending = []; this.pendingLen = 0; } }
  blob(type = 'application/octet-stream'): Blob { this.flush(); return new Blob(this.parts, { type }); }
}

/** Streaming SHA-1 (FIPS 180-4). Used for the mzML <fileChecksum>. */
export class Sha1 {
  private h = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);
  private buf = new Uint8Array(64); private bl = 0; private total = 0;
  private w = new Uint32Array(80);
  update(d: Uint8Array) {
    this.total += d.length;
    let i = 0;
    if (this.bl) { const n = Math.min(64 - this.bl, d.length); this.buf.set(d.subarray(0, n), this.bl); this.bl += n; i = n; if (this.bl === 64) { this.block(this.buf, 0); this.bl = 0; } }
    for (; i + 64 <= d.length; i += 64) this.block(d, i);
    if (i < d.length) { this.buf.set(d.subarray(i), 0); this.bl = d.length - i; }
  }
  private block(d: Uint8Array, o: number) {
    const w = this.w;
    for (let t = 0; t < 16; t++) { const q = o + 4 * t; w[t] = (d[q] << 24) | (d[q + 1] << 16) | (d[q + 2] << 8) | d[q + 3]; }
    for (let t = 16; t < 80; t++) { const x = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]; w[t] = (x << 1) | (x >>> 31); }
    const h = this.h;
    let a = h[0] | 0, b = h[1] | 0, c = h[2] | 0, dd = h[3] | 0, e = h[4] | 0, tmp = 0;
    // four 20-round stages without per-round branching (hot path for the mzML <fileChecksum>)
    for (let t = 0; t < 20; t++) { tmp = (((a << 5) | (a >>> 27)) + ((b & c) | (~b & dd)) + e + 0x5a827999 + w[t]) | 0; e = dd; dd = c; c = (b << 30) | (b >>> 2); b = a; a = tmp; }
    for (let t = 20; t < 40; t++) { tmp = (((a << 5) | (a >>> 27)) + (b ^ c ^ dd) + e + 0x6ed9eba1 + w[t]) | 0; e = dd; dd = c; c = (b << 30) | (b >>> 2); b = a; a = tmp; }
    for (let t = 40; t < 60; t++) { tmp = (((a << 5) | (a >>> 27)) + ((b & c) | (b & dd) | (c & dd)) + e + 0x8f1bbcdc + w[t]) | 0; e = dd; dd = c; c = (b << 30) | (b >>> 2); b = a; a = tmp; }
    for (let t = 60; t < 80; t++) { tmp = (((a << 5) | (a >>> 27)) + (b ^ c ^ dd) + e + 0xca62c1d6 + w[t]) | 0; e = dd; dd = c; c = (b << 30) | (b >>> 2); b = a; a = tmp; }
    h[0] += a; h[1] += b; h[2] += c; h[3] += dd; h[4] += e;
  }
  hex(): string {
    const len = this.total * 8;
    const pad = new Uint8Array(((this.bl < 56 ? 56 : 120) - this.bl) + 8);
    pad[0] = 0x80;
    const dv = new DataView(pad.buffer); dv.setUint32(pad.length - 8, Math.floor(len / 2 ** 32)); dv.setUint32(pad.length - 4, len >>> 0);
    const total = this.total; this.update(pad); this.total = total;
    return Array.from(this.h, (x) => x.toString(16).padStart(8, '0')).join('');
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64C = Array.from(B64, (c) => c.charCodeAt(0));
/** Base64 as ASCII bytes (no intermediate string for large arrays). */
export function base64Bytes(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(b.length / 3) * 4);
  let o = 0, i = 0;
  for (; i + 2 < b.length; i += 3) {
    const n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
    out[o++] = B64C[n >> 18]; out[o++] = B64C[(n >> 12) & 63]; out[o++] = B64C[(n >> 6) & 63]; out[o++] = B64C[n & 63];
  }
  if (i < b.length) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8);
    out[o++] = B64C[n >> 18]; out[o++] = B64C[(n >> 12) & 63];
    out[o++] = i + 1 < b.length ? B64C[(n >> 6) & 63] : 61; out[o++] = 61;
  }
  return out;
}

export const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r?\n/g, '&#10;').replace(/\t/g, '&#9;')
  // drop characters XML 1.0 cannot carry
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

export type Numpress = 'none' | 'linear' | 'pic' | 'slof';
export interface ArrayEncoding { bits: 32 | 64; zlib: boolean; numpress: Numpress }

const NUMPRESS_CV = {
  linear: ['MS:1002312', 'MS-Numpress linear prediction compression', 'MS:1002746', 'MS-Numpress linear prediction compression followed by zlib compression'],
  pic: ['MS:1002313', 'MS-Numpress positive integer compression', 'MS:1002747', 'MS-Numpress positive integer compression followed by zlib compression'],
  slof: ['MS:1002314', 'MS-Numpress short logged float compression', 'MS:1002748', 'MS-Numpress short logged float compression followed by zlib compression'],
} as const;
/** Bytes of one array before zlib: MS-Numpress or IEEE floats. */
function rawArrayBytes(values: Float64Array, e: ArrayEncoding): Uint8Array {
  if (e.numpress !== 'none') return e.numpress === 'linear' ? encodeLinear(values) : e.numpress === 'pic' ? encodePic(values) : encodeSlof(values);
  if (e.bits === 64) return new Uint8Array(values.buffer.slice(values.byteOffset, values.byteOffset + values.byteLength));
  return new Uint8Array(Float32Array.from(values).buffer);
}
/** mzML cvParams describing an encoding (numpress arrays decode to 64-bit floats). */
function encodingCvs(e: ArrayEncoding): Array<[string, string]> {
  if (e.numpress !== 'none') { const c = NUMPRESS_CV[e.numpress]; return [['MS:1000523', '64-bit float'], e.zlib ? [c[2], c[3]] : [c[0], c[1]]]; }
  return [e.bits === 64 ? ['MS:1000523', '64-bit float'] : ['MS:1000521', '32-bit float'], e.zlib ? ['MS:1000574', 'zlib compression'] : ['MS:1000576', 'no compression']];
}
export type EncodedArray = { bytes: Uint8Array; cvs: Array<[string, string]> };

/** Encode one array; returns the bytes before base64 plus the mzML cvParams describing the encoding. */
export function encodeArray(values: Float64Array, e: ArrayEncoding): EncodedArray {
  const raw = rawArrayBytes(values, e);
  return { bytes: e.zlib ? zlibSync(raw, { level: ZLIB_LEVEL }) : raw, cvs: encodingCvs(e) };
}

const nativeDeflate = typeof CompressionStream !== 'undefined';
const deflate = async (b: Uint8Array) => new Uint8Array(await new Response(new Blob([b as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
/**
 * Encode many arrays at once. Where the platform has CompressionStream ('deflate' is zlib, RFC 1950, as mzML
 * requires), the arrays are compressed concurrently by the native zlib, about 3x faster than fflate.
 */
export async function encodeArrays(jobs: Array<{ values: Float64Array; e: ArrayEncoding }>): Promise<EncodedArray[]> {
  if (!nativeDeflate) return jobs.map((j) => encodeArray(j.values, j.e));
  return Promise.all(jobs.map(async (j) => { const raw = rawArrayBytes(j.values, j.e); return { bytes: j.e.zlib ? await deflate(raw) : raw, cvs: encodingCvs(j.e) }; }));
}

/** zlib-compress many buffers, concurrently with the native zlib when available (fflate otherwise). */
export async function zlibMany(list: Uint8Array[]): Promise<Uint8Array[]> {
  if (!nativeDeflate) return list.map((b) => zlibSync(b, { level: ZLIB_LEVEL }));
  return Promise.all(list.map(deflate));
}

/** Output of a writer: one or more files (mzML is one; some exports write companions such as imzML + .ibd). */
export interface WrittenFile { name: string; blob: Blob; mime: string }
export interface WriteContext {
  progress: (fraction: number, message?: string) => void;
  signal: AbortSignal;
  log: (msg: string) => void;
  /** Base name of the output without extension. */
  baseName: string;
  /** Converter version for softwareList. */
  version: string;
  /** Processing steps applied by filters, recorded in dataProcessing. */
  processing: Array<{ cv?: [string, string]; user?: string }>;
}
export interface OutputFormat {
  id: string;
  label: string;
  ext: string;
  /** Vendor formats are listed for completeness but cannot be written (no open writer exists). */
  writable: boolean;
  reason?: string;
  write?(src: SpectrumSource, opts: Record<string, unknown>, ctx: WriteContext): Promise<WrittenFile[]>;
}

export const fmt = (x: number) => (Number.isInteger(x) ? String(x) : String(+x.toPrecision(15)));
export function ticOf(s: SpectrumRecord) { let t = 0; for (let i = 0; i < s.intensity.length; i++) t += s.intensity[i]; return t; }
export function basePeak(s: SpectrumRecord): [number, number] {
  let bi = -1, bv = -Infinity;
  for (let i = 0; i < s.intensity.length; i++) if (s.intensity[i] > bv) { bv = s.intensity[i]; bi = i; }
  return bi < 0 ? [0, 0] : [s.mz[bi], bv];
}
