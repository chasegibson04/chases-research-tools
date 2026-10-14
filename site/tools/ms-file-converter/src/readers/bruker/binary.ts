// Byte-level helpers for Bruker *_bin files: ranged Blob reads, LZF (TDF compression type 1), zstd (types 2/3, via
// fzstd, MIT) and the byte-plane "shuffle" Bruker applies before zstd.
// Frame layouts ported from timsrust (MIT, MannLabs): crates/timsrust-tdf/src/frame_reader/compression{1,2}.rs and
// crates/timsrust-tsf/src/blobs.rs. One deliberate deviation in compression 1 is documented at decodeCompression1.
import { decompress as zstdDecompress } from 'fzstd';

/** Read [start, end) of a Blob. Never loads the whole (possibly multi-GB) file. */
export async function readRange(file: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(start, Math.min(end, file.size)).arrayBuffer());
}

export const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export function zstd(data: Uint8Array): Uint8Array {
  return zstdDecompress(data);
}

/** Undo Bruker's byte shuffle: value i is bytes [i, i+n, i+2n, i+3n] (little-endian planes). */
export function unshuffleU32(b: Uint8Array): Uint32Array {
  const n = b.length >>> 2, out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = (b[i] | (b[i + n] << 8) | (b[i + 2 * n] << 16) | (b[i + 3 * n] << 24)) >>> 0;
  return out;
}

/** LZF decompression (liblzf format, no header), as used per scan in TDF compression type 1. */
export function lzfDecompress(src: Uint8Array, sizeHint = src.length * 4): Uint8Array {
  let out = new Uint8Array(Math.max(16, sizeHint));
  let op = 0, ip = 0;
  const ensure = (n: number) => {
    if (op + n <= out.length) return;
    let len = out.length * 2;
    while (len < op + n) len *= 2;
    const bigger = new Uint8Array(len); bigger.set(out.subarray(0, op)); out = bigger;
  };
  while (ip < src.length) {
    const ctrl = src[ip++];
    if (ctrl < 32) { // literal run of ctrl+1 bytes
      const n = ctrl + 1;
      if (ip + n > src.length) throw new Error('LZF: literal run past end of input');
      ensure(n); out.set(src.subarray(ip, ip + n), op); op += n; ip += n;
    } else { // back reference
      let len = ctrl >> 5;
      if (len === 7) len += src[ip++];
      let ref = op - ((ctrl & 0x1f) << 8) - src[ip++] - 1;
      if (ref < 0) throw new Error('LZF: back reference before start of output');
      len += 2; ensure(len);
      while (len--) out[op++] = out[ref++];
    }
  }
  return out.subarray(0, op);
}

/** Peaks of one TDF frame: per-scan offsets into flat tof/intensity arrays (tof indices are 0-based). */
export interface FrameIons { scanCount: number; scanOffsets: Uint32Array; tof: Uint32Array; intensity: Uint32Array }

const EMPTY: FrameIons = { scanCount: 0, scanOffsets: new Uint32Array(1), tof: new Uint32Array(0), intensity: new Uint32Array(0) };

/**
 * TDF compression type 2: [u32 byteCount][u32 scanCount][zstd(shuffled u32 data)]. Decompressed values:
 * v[0] = scan count, v[1..scanCount-1] = 2·(peaks in scan i-1), then interleaved (tof delta, intensity) pairs.
 * TOF index = cumulative delta − 1 within a scan. Ported from timsrust (MIT, MannLabs) compression2.rs.
 */
export function decodeCompression2(blob: Uint8Array): FrameIons {
  if (blob.length <= 8) return EMPTY;
  const v = unshuffleU32(zstd(blob.subarray(8)));
  if (!v.length) return EMPTY;
  const scanCount = v[0];
  const peakCount = (v.length - scanCount) >>> 1;
  const scanOffsets = new Uint32Array(scanCount + 1);
  for (let s = 0; s < scanCount - 1; s++) scanOffsets[s + 1] = scanOffsets[s] + (v[s + 1] >>> 1);
  scanOffsets[scanCount] = peakCount;
  const tof = new Uint32Array(peakCount), intensity = new Uint32Array(peakCount);
  for (let s = 0; s < scanCount; s++) {
    let sum = 0;
    for (let p = scanOffsets[s]; p < scanOffsets[s + 1]; p++) {
      sum += v[scanCount + 2 * p];
      tof[p] = sum - 1;
      intensity[p] = v[scanCount + 1 + 2 * p];
    }
  }
  return { scanCount, scanOffsets, tof, intensity };
}

/**
 * TDF compression type 1 (older timsTOF files): [u32 byteCount][u32 scanCount][(scanCount+1) u32 scan offsets
 * relative to the blob start][LZF chunk per scan]. Each LZF chunk decodes to i32 values: a positive value is the
 * intensity at the next TOF index, a negative value −n skips n TOF indices.
 * Structure ported from timsrust (MIT, MannLabs) compression1.rs. Deviation: timsrust advances the TOF index by
 * n−1 for a skip of −n, which is off by one per gap; advancing by n reproduces ProteoWizard/Bruker SDK m/z values
 * exactly (checked on Hela_QC_PASEF_Slot1-first-6-frames.d, see tests/bruker.test.ts).
 */
export function decodeCompression1(blob: Uint8Array, maxPeaksPerScan = 0, scanLimit = Infinity): FrameIons {
  if (blob.length <= 12) return EMPTY;
  // Only the scans listed in Frames.NumScans are decoded (truncated test files carry offsets past the end).
  const scanCount = Math.min(u32(blob, 4), scanLimit, Math.floor((blob.length - 12) / 4));
  const offs = new Array<number>(scanCount + 1);
  for (let i = 0; i <= scanCount; i++) offs[i] = Math.min(u32(blob, 8 + 4 * i), blob.length);
  const tofs: number[] = [], ints: number[] = [];
  const scanOffsets = new Uint32Array(scanCount + 1);
  for (let s = 0; s < scanCount; s++) {
    const a = offs[s], b = offs[s + 1];
    if (b > a) {
      const raw = lzfDecompress(blob.subarray(a, b), maxPeaksPerScan > 0 ? maxPeaksPerScan * 8 : (b - a) * 4);
      const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      let idx = -1;
      for (let o = 0; o + 4 <= raw.length; o += 4) {
        const x = dv.getInt32(o, true);
        if (x > 0) { idx += 1; tofs.push(idx); ints.push(x); } else idx -= x;
      }
    }
    scanOffsets[s + 1] = tofs.length;
  }
  return { scanCount, scanOffsets, tof: Uint32Array.from(tofs), intensity: Uint32Array.from(ints) };
}

/** Read and decode one TDF frame blob at `offset` (Frames.TimsId) without touching the rest of the file. */
export async function readTdfFrame(bin: Blob, offset: number, compression: number, maxPeaksPerScan: number, numScans = Infinity): Promise<FrameIons> {
  const head = await readRange(bin, offset, offset + 8);
  if (head.length < 8) return EMPTY;
  const byteCount = u32(head, 0);
  if (byteCount <= 8) return EMPTY;
  const blob = await readRange(bin, offset, offset + byteCount);
  return compression === 1 ? decodeCompression1(blob, maxPeaksPerScan, numScans) : decodeCompression2(blob);
}

/** One TSF frame: line spectrum (fractional TOF indices, f32 intensities) and/or profile (one u32 per TOF sample). */
export interface TsfFrame { lineTof: Float64Array; lineIntensity: Float64Array; profile: Uint32Array | null }

/**
 * TSF blob: [u32 chunkBytes][u32 lineZstdBytes][zstd line spectrum][zstd shuffled u32 profile (optional)].
 * Line spectrum = numPeaks f64 TOF indices followed by numPeaks f32 intensities. The line part is ported from
 * timsrust (MIT, MannLabs) crates/timsrust-tsf/src/blobs.rs; the profile part (which timsrust does not read) was
 * worked out from the test files: it spans the rest of the chunk and holds DigitizerNumSamples shuffled u32 values.
 */
export async function readTsfFrame(bin: Blob, offset: number, numPeaks: number, wantProfile: boolean): Promise<TsfFrame> {
  const head = await readRange(bin, offset, offset + 8);
  const chunk = u32(head, 0), lineLen = u32(head, 4);
  const end = wantProfile ? offset + chunk : offset + 8 + lineLen;
  const blob = await readRange(bin, offset, end);
  let lineTof = new Float64Array(0), lineIntensity = new Float64Array(0);
  if (lineLen > 0 && numPeaks > 0) {
    const dec = zstd(blob.subarray(8, 8 + lineLen));
    const n = Math.min(numPeaks, Math.floor(dec.length / 12));
    const dv = new DataView(dec.buffer, dec.byteOffset, dec.byteLength);
    lineTof = new Float64Array(n); lineIntensity = new Float64Array(n);
    for (let i = 0; i < n; i++) { lineTof[i] = dv.getFloat64(8 * i, true); lineIntensity[i] = dv.getFloat32(8 * numPeaks + 4 * i, true); }
  }
  let profile: Uint32Array | null = null;
  if (wantProfile && chunk > 8 + lineLen + 4) {
    const rest = blob.subarray(8 + lineLen, chunk);
    if (u32(rest, 0) === 0xfd2fb528) profile = unshuffleU32(zstd(rest));
  }
  return { lineTof, lineIntensity, profile };
}
