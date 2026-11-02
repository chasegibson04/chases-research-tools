// Boys function F_m(T) = integral_0^1 t^(2m) exp(-T t^2) dt, for m = 0..BOYS_MAX.
// Table + 6th-order Taylor interpolation for T < T_MAX, upward-recursed asymptotic expansion beyond.
export const BOYS_MAX = 8;
const T_MAX = 40;
const STEP = 0.1;
const NT = Math.round(T_MAX / STEP) + 1;
const NM = BOYS_MAX + 7; // extra orders for the Taylor series
const TABLE = new Float64Array(NT * NM);

function boysSeries(m: number, T: number): number {
  // F_m(T) = exp(-T) * sum_k (2T)^k / ((2m+1)(2m+3)...(2m+2k+1))
  let term = 1 / (2 * m + 1);
  let sum = term;
  for (let k = 1; k < 400; k++) {
    term *= (2 * T) / (2 * m + 2 * k + 1);
    sum += term;
    if (term < 1e-17 * sum) break;
  }
  return Math.exp(-T) * sum;
}
for (let k = 0; k < NT; k++) for (let m = 0; m < NM; m++) TABLE[k * NM + m] = boysSeries(m, k * STEP);

const FACT = [1, 1, 2, 6, 24, 120, 720];

/** Fills out[0..mmax] with F_0(T)..F_mmax(T). mmax <= BOYS_MAX. */
export function boys(mmax: number, T: number, out: Float64Array): void {
  if (T < T_MAX) {
    const k = Math.round(T / STEP);
    const d = k * STEP - T; // T_k - T; F_m(T) = sum_j F_{m+j}(T_k) (T_k - T)^j / j!
    const base = k * NM + mmax;
    let f = 0;
    let dp = 1;
    for (let j = 0; j <= 6; j++) {
      f += (TABLE[base + j] * dp) / FACT[j];
      dp *= d;
    }
    out[mmax] = f;
    if (mmax > 0) {
      const e = Math.exp(-T);
      const t2 = 2 * T;
      for (let m = mmax; m > 0; m--) out[m - 1] = (t2 * out[m] + e) / (2 * m - 1);
    }
  } else {
    const f0 = 0.5 * Math.sqrt(Math.PI / T);
    out[0] = f0;
    const inv = 1 / (2 * T);
    for (let m = 0; m < mmax; m++) out[m + 1] = (2 * m + 1) * out[m] * inv; // exp(-T) term negligible (< 4e-18)
  }
}
