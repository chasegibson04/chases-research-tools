// Decoders for the spectrum segments of MSProfile.bin and MSPeak.bin. A segment is located by the
// SpectrumOffset / ByteCount / PointCount of its MSScan.bin block. Layouts seen in MassHunter data:
//   Quadrupole profile   float32 first m/z, float32 step, int32 × N                 (ByteCount = 8 + 4N)
//   TOF profile, raw     72-byte range header (N, 1, …, N @64, first flight-time bin @68), int32 × N (ByteCount = 72 + 4N)
//   TOF profile, RLE     float64 first t, float64 Δt, then 0x90-tagged run-length intensity stream
//   TOF profile, LZF     LZF( float64 first t, float64 Δt, uint32 × N )               (UncompressedByteCount)
//   Peaks (centroid)     x × N then intensity × N; 8 B/peak float32+int32 (m/z), 12 B float64+float32 and
//                        16 B float64+float64 (TOF flight times, calibrated by the caller).
import { lzfDecompress } from './lzf';

export interface Decoded {
  /** m/z when `isMz`, otherwise TOF flight time to be calibrated. */
  x: Float64Array;
  y: Float64Array;
  isMz: boolean;
}

export function isRle(seg: Uint8Array, n: number): boolean {
  if (seg.length < 20) return false;
  const w = new DataView(seg.buffer, seg.byteOffset, seg.byteLength).getUint32(16, true);
  return (w & 0xffffff) === (n & 0xffffff) && w >>> 24 === 0x90;
}

/** Run-length stream after the 16-byte header: [count|0x90][−leading zeros] then tokens (see README / rainbow). */
export function decodeRle(seg: Uint8Array, n: number): Float64Array {
  const dv = new DataView(seg.buffer, seg.byteOffset, seg.byteLength);
  const out = new Float64Array(n);
  let idx = -dv.getInt32(20, true);
  if (idx < 0) throw new Error('Agilent RLE segment: bad leading-zero count');
  let o = 24, width = 4;
  const end = seg.length;
  while (o + width <= end) {
    const v = width === 4 ? dv.getInt32(o, true) : width === 2 ? dv.getInt16(o, true) : dv.getInt8(o);
    o += width;
    if (v >= 0) { if (idx < n) out[idx] = v; idx++; }
    else {
      const a = -v;
      idx += Math.floor(a / 4);
      const f = a % 4;
      width = f === 1 ? 1 : f === 2 ? 2 : f === 3 ? 4 : 0;
      if (!width) throw new Error('Agilent RLE segment: bad width flag');
    }
  }
  return out;
}

const grid = (start: number, step: number, n: number) => { const x = new Float64Array(n); for (let i = 0; i < n; i++) x[i] = start + i * step; return x; };

export function decodeProfile(seg: Uint8Array, n: number, uncompressed: number | undefined): Decoded {
  const dv = new DataView(seg.buffer, seg.byteOffset, seg.byteLength);
  if (n <= 0) return { x: new Float64Array(0), y: new Float64Array(0), isMz: true };
  if (isRle(seg, n)) return { x: grid(dv.getFloat64(0, true), dv.getFloat64(8, true), n), y: decodeRle(seg, n), isMz: false };
  if (seg.length === 72 + 4 * n && dv.getInt32(0, true) === n && dv.getInt32(64, true) === n) {
    const first = dv.getInt32(68, true);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = dv.getInt32(72 + 4 * i, true);
    return { x: grid(first, 1, n), y, isMz: false };
  }
  if (seg.length === 8 + 4 * n) {
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = dv.getInt32(8 + 4 * i, true);
    // The step is stored truncated (0.1 is written as 0x3DCCD000 = 0.1000061); MassHunter's axis is the decimal
    // step (instrument steps are 0.1, 0.05, 0.01 …), so round it to 4 significant digits and the start to 7.
    const sig = (v: number, d: number) => Number(v.toPrecision(d));
    return { x: grid(sig(dv.getFloat32(0, true), 7), sig(dv.getFloat32(4, true), 4), n), y, isMz: true };
  }
  const raw = seg.length === 16 + 4 * n ? seg : lzfDecompress(seg, uncompressed && uncompressed > 0 ? uncompressed : 16 + 4 * n);
  if (raw.length < 16 + 4 * n) throw new Error(`Agilent profile segment: ${raw.length} bytes for ${n} points`);
  const rv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] = rv.getUint32(16 + 4 * i, true);
  return { x: grid(rv.getFloat64(0, true), rv.getFloat64(8, true), n), y, isMz: false };
}

export function decodePeaks(seg: Uint8Array, n: number): Decoded {
  if (n <= 0) return { x: new Float64Array(0), y: new Float64Array(0), isMz: true };
  const bpp = Math.floor(seg.length / n);
  const dv = new DataView(seg.buffer, seg.byteOffset, seg.byteLength);
  const x = new Float64Array(n), y = new Float64Array(n);
  if (bpp === 8) {
    for (let i = 0; i < n; i++) { x[i] = dv.getFloat32(4 * i, true); y[i] = dv.getInt32(4 * n + 4 * i, true); }
    return { x, y, isMz: true };
  }
  if (bpp === 12) {
    for (let i = 0; i < n; i++) { x[i] = dv.getFloat64(8 * i, true); y[i] = dv.getFloat32(8 * n + 4 * i, true); }
    return { x, y, isMz: false };
  }
  if (bpp >= 16) {
    for (let i = 0; i < n; i++) { x[i] = dv.getFloat64(8 * i, true); y[i] = dv.getFloat64(8 * n + 8 * i, true); }
    return { x, y, isMz: false };
  }
  throw new Error(`Agilent peak segment: ${seg.length} bytes for ${n} peaks`);
}

/** Drop zero-intensity profile points except those next to a non-zero point (keeps peak shapes closed). */
export function trimZeros(x: Float64Array, y: Float64Array): { x: Float64Array; y: Float64Array } {
  const n = y.length;
  let k = 0;
  const keep = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (y[i] !== 0 || (i > 0 && y[i - 1] !== 0) || (i + 1 < n && y[i + 1] !== 0)) { keep[i] = 1; k++; }
  const ox = new Float64Array(k), oy = new Float64Array(k);
  for (let i = 0, j = 0; i < n; i++) if (keep[i]) { ox[j] = x[i]; oy[j++] = y[i]; }
  return { x: ox, y: oy };
}
