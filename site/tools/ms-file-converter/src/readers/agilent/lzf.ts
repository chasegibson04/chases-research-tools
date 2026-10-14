// LZF decompressor (Marc Lehmann's liblzf format, BSD-2). Agilent MassHunter stores TOF profile segments of
// MSProfile.bin and IMS frame spectra with it. Format: a control byte c; c < 32 → copy c+1 literal bytes;
// otherwise a back-reference of length (c >> 5) + 2 (7 → plus the next byte) at distance ((c & 31) << 8 | next) + 1.
export function lzfDecompress(src: Uint8Array, outLen: number): Uint8Array {
  const out = new Uint8Array(outLen);
  let ip = 0, op = 0;
  const n = src.length;
  while (ip < n) {
    const ctrl = src[ip++];
    if (ctrl < 32) {
      const len = ctrl + 1;
      if (op + len > outLen || ip + len > n) throw new Error('LZF: literal run past end of buffer');
      out.set(src.subarray(ip, ip + len), op);
      ip += len; op += len;
    } else {
      let len = ctrl >> 5;
      if (len === 7) len += src[ip++];
      len += 2;
      const ref = op - ((ctrl & 0x1f) << 8) - src[ip++] - 1;
      if (ref < 0 || op + len > outLen) throw new Error('LZF: back-reference out of range');
      for (let k = 0; k < len; k++) out[op++] = out[ref + k];
    }
  }
  return op === outLen ? out : out.subarray(0, op);
}
