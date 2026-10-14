// MS-Numpress decoders (linear prediction, positive integer "pic", short logged float "slof").
// Reimplemented from the published algorithm (Teleman et al., Mol Cell Proteomics 13, 1537 (2014);
// reference implementation github.com/ms-numpress/ms-numpress, BSD-3/Apache-2.0).
// Layout: the fixed point is an 8-byte big-endian double; integers are "half-byte truncated" values.

function fixedPoint(d: Uint8Array): number {
  const b = new DataView(new ArrayBuffer(8));
  for (let i = 0; i < 8; i++) b.setUint8(i, d[i]); // stored big-endian
  return b.getFloat64(0, false);
}

/** Decode one half-byte-truncated 32-bit integer. State is [byteIndex, half]. */
function decodeInt(d: Uint8Array, st: { di: number; half: number }, max: number): number {
  let head: number;
  if (st.half === 0) head = d[st.di] >> 4; else { head = d[st.di] & 0xf; st.di++; }
  st.half = 1 - st.half;
  let res = 0, n: number;
  if (head <= 8) n = head;
  else { n = head - 8; for (let i = 0; i < n; i++) res |= (0xf0000000 >>> (4 * i)); }
  if (n === 8) return res | 0;
  if (st.di + ((8 - n) - (1 - st.half)) / 2 >= max) throw new Error('Corrupt MS-Numpress data.');
  for (let i = n; i < 8; i++) {
    let hb: number;
    if (st.half === 0) hb = d[st.di] >> 4; else { hb = d[st.di] & 0xf; st.di++; }
    res |= hb << ((i - n) * 4);
    st.half = 1 - st.half;
  }
  return res | 0;
}

export function decodeLinear(d: Uint8Array): Float64Array {
  if (d.length < 8) return new Float64Array(0);
  const fp = fixedPoint(d);
  if (d.length < 12) return new Float64Array(0);
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const out: number[] = [];
  let i1 = dv.getUint32(8, true);
  out.push(i1 / fp);
  if (d.length < 16) return Float64Array.from(out);
  let i2 = dv.getUint32(12, true);
  out.push(i2 / fp);
  const st = { di: 16, half: 0 };
  let i0: number;
  while (st.di < d.length) {
    if (st.di === d.length - 1 && st.half === 1 && (d[st.di] & 0xf) === 0) break;
    const r = decodeInt(d, st, d.length);
    i0 = i1; i1 = i2;
    const y = i1 + (i1 - i0) + r; // extrapolation + residual (Number math is exact here)
    out.push(y / fp);
    i2 = y;
  }
  return Float64Array.from(out);
}

export function decodePic(d: Uint8Array): Float64Array {
  const out: number[] = [];
  const st = { di: 0, half: 0 };
  while (st.di < d.length) {
    if (st.di === d.length - 1 && st.half === 1 && (d[st.di] & 0xf) === 0) break;
    out.push(decodeInt(d, st, d.length) >>> 0);
  }
  return Float64Array.from(out);
}

export function decodeSlof(d: Uint8Array): Float64Array {
  if (d.length < 8) return new Float64Array(0);
  const fp = fixedPoint(d);
  const n = (d.length - 8) >> 1;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.exp((d[8 + 2 * i] | (d[9 + 2 * i] << 8)) / fp) - 1;
  return out;
}

// ---- encoders (used by the MS File Converter's mzML writer and by the round-trip tests) ----------
/** Half-byte truncation of one 32-bit integer (appends half-bytes to `out`). */
function encodeInt(x: number, out: number[]) {
  const v = x >>> 0;
  const nb = Array.from({ length: 8 }, (_, i) => (v >>> (4 * i)) & 0xf); // nb[7] is the most significant
  const top = nb[7];
  if (top === 0) {
    let l = 0; while (l < 8 && nb[7 - l] === 0) l++;
    out.push(l); for (let i = 0; i < 8 - l; i++) out.push(nb[i]);
  } else if (top === 0xf) {
    let l = 0; while (l < 8 && nb[7 - l] === 0xf) l++;
    l = Math.min(l, 7);
    out.push(l + 8); for (let i = 0; i < 8 - l; i++) out.push(nb[i]);
  } else {
    out.push(0); for (let i = 0; i < 8; i++) out.push(nb[i]);
  }
}
const packNibbles = (n: number[]) => { const b = new Uint8Array((n.length + 1) >> 1); for (let i = 0; i < n.length; i += 2) b[i >> 1] = (n[i] << 4) | (n[i + 1] ?? 0); return b; };
const fpBytes = (fp: number) => { const dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, fp, false); return new Uint8Array(dv.buffer); };
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let k = 0; for (const x of a) { o.set(x, k); k += x.length; } return o; };

/** Largest fixed point that keeps every linear-prediction residual inside a 32-bit integer (reference algorithm). */
export function optimalLinearFixedPoint(x: ArrayLike<number>): number {
  if (x.length === 0) return 0;
  if (x.length === 1) return Math.floor(0xffffffff / x[0]);
  let max = Math.max(x[0], x[1]);
  for (let i = 2; i < x.length; i++) { const e = x[i - 1] + (x[i - 1] - x[i - 2]); max = Math.max(max, Math.ceil(Math.abs(x[i] - e) + 1)); }
  return Math.floor(0x7fffffff / max);
}
/** Fixed point for a target absolute error per value (e.g. 2e-9 m/z, msconvert's default for m/z). */
export const linearFixedPointForError = (absError: number) => 0.5 / absError;
export function encodeLinear(x: ArrayLike<number>, fixedPoint?: number): Uint8Array {
  const fp = Math.min(fixedPoint ?? optimalLinearFixedPoint(x), optimalLinearFixedPoint(x) || Infinity);
  const ints = Array.from(x, (v) => Math.floor(v * fp + 0.5));
  const head = new DataView(new ArrayBuffer(8));
  if (ints.length > 0) head.setUint32(0, ints[0] >>> 0, true);
  if (ints.length > 1) head.setUint32(4, ints[1] >>> 0, true);
  const nib: number[] = [];
  for (let i = 2; i < ints.length; i++) encodeInt(ints[i] - (2 * ints[i - 1] - ints[i - 2]), nib);
  return cat(fpBytes(fp), new Uint8Array(head.buffer, 0, Math.min(ints.length, 2) * 4), packNibbles(nib));
}
/** Positive integer compression: values are rounded to integers. */
export function encodePic(x: ArrayLike<number>): Uint8Array { const nib: number[] = []; for (let i = 0; i < x.length; i++) encodeInt(Math.floor(x[i] + 0.5), nib); return packNibbles(nib); }
export function optimalSlofFixedPoint(x: ArrayLike<number>): number {
  let max = 1; for (let i = 0; i < x.length; i++) max = Math.max(max, Math.log(x[i] + 1));
  return Math.floor(0xffff / max);
}
/** Short logged float: 2 bytes per value, ~relative error 1/fp. */
export function encodeSlof(x: ArrayLike<number>, fixedPoint?: number): Uint8Array {
  const fp = fixedPoint ?? optimalSlofFixedPoint(x);
  const b = new Uint8Array(8 + 2 * x.length); b.set(fpBytes(fp));
  for (let i = 0; i < x.length; i++) { const s = Math.min(0xffff, Math.floor(Math.log(x[i] + 1) * fp + 0.5)); b[8 + 2 * i] = s & 0xff; b[9 + 2 * i] = s >> 8; }
  return b;
}
