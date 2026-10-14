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

// ---- encoders (used only by tests to round-trip the decoders) ---------------------------------
function encodeInt(x: number, out: number[]) {
  // returns half-bytes
  const v = x >>> 0;
  let l: number;
  const nibbles = (y: number) => Array.from({ length: 8 }, (_, i) => (y >>> (4 * i)) & 0xf);
  const nb = nibbles(v);
  if ((v & 0xf0000000) === 0) {
    l = 8; for (let i = 7; i >= 0; i--) { if (nb[i] !== 0) { l = 7 - i; break; } }
    out.push(l); for (let i = 0; i < 8 - l; i++) out.push(nb[i]);
  } else {
    l = 0; for (let i = 7; i >= 0; i--) { if (nb[i] === 0xf) l++; else break; }
    l = Math.min(l, 7);
    out.push(l + 8); for (let i = 0; i < 8 - l; i++) out.push(nb[i]);
  }
}
const packNibbles = (n: number[]) => { const b: number[] = []; for (let i = 0; i < n.length; i += 2) b.push((n[i] << 4) | (n[i + 1] ?? 0)); return b; };
const fpBytes = (fp: number) => { const dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, fp, false); return Array.from(new Uint8Array(dv.buffer)); };

export function encodeLinearForTest(x: number[], fp: number): Uint8Array {
  const ints = x.map((v) => Math.round(v * fp));
  const head = new DataView(new ArrayBuffer(8));
  head.setUint32(0, ints[0], true); head.setUint32(4, ints[1], true);
  const nib: number[] = [];
  for (let i = 2; i < ints.length; i++) encodeInt(ints[i] - (2 * ints[i - 1] - ints[i - 2]), nib);
  return Uint8Array.from([...fpBytes(fp), ...new Uint8Array(head.buffer), ...packNibbles(nib)]);
}
export function encodePicForTest(x: number[]): Uint8Array { const nib: number[] = []; for (const v of x) encodeInt(Math.round(v), nib); return Uint8Array.from(packNibbles(nib)); }
export function encodeSlofForTest(x: number[], fp: number): Uint8Array {
  const b = [...fpBytes(fp)];
  for (const v of x) { const s = Math.round(Math.log(v + 1) * fp); b.push(s & 0xff, (s >> 8) & 0xff); }
  return Uint8Array.from(b);
}
