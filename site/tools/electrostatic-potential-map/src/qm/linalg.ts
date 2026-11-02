// Small dense linear algebra for the SCF (row-major n x n Float64Array matrices).

/** Symmetric eigenproblem by cyclic Jacobi rotations. Eigenvalues ascending; vectors[i*n+k] is component i of vector k. */
export function eigh(A: Float64Array, n: number): { values: Float64Array; vectors: Float64Array } {
  const a = A.slice();
  const v = new Float64Array(n * n);
  for (let i = 0; i < n; i++) v[i * n + i] = 1;
  let scale = 0;
  for (let i = 0; i < n * n; i++) scale += a[i] * a[i];
  const tol = 1e-30 * scale + 1e-300;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) off += a[p * n + q] * a[p * n + q];
    if (off < tol) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q];
        if (Math.abs(apq) < 1e-300) continue;
        const app = a[p * n + p], aqq = a[q * n + q];
        const theta = (aqq - app) / (2 * apq);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          if (k === p || k === q) continue;
          const akp = a[k * n + p], akq = a[k * n + q];
          const np_ = c * akp - s * akq, nq = s * akp + c * akq;
          a[k * n + p] = np_; a[p * n + k] = np_;
          a[k * n + q] = nq; a[q * n + k] = nq;
        }
        a[p * n + p] = app - t * apq;
        a[q * n + q] = aqq + t * apq;
        a[p * n + q] = 0; a[q * n + p] = 0;
        for (let k = 0; k < n; k++) {
          const vkp = v[k * n + p], vkq = v[k * n + q];
          v[k * n + p] = c * vkp - s * vkq;
          v[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((x, y) => a[x * n + x] - a[y * n + y]);
  const values = new Float64Array(n);
  const vectors = new Float64Array(n * n);
  order.forEach((src, dst) => {
    values[dst] = a[src * n + src];
    for (let i = 0; i < n; i++) vectors[i * n + dst] = v[i * n + src];
  });
  return { values, vectors };
}

export function matmul(A: Float64Array, B: Float64Array, n: number, out = new Float64Array(n * n)): Float64Array {
  out.fill(0);
  for (let i = 0; i < n; i++)
    for (let k = 0; k < n; k++) {
      const aik = A[i * n + k];
      if (aik === 0) continue;
      const bo = k * n, oo = i * n;
      for (let j = 0; j < n; j++) out[oo + j] += aik * B[bo + j];
    }
  return out;
}

export function transpose(A: Float64Array, n: number): Float64Array {
  const t = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) t[j * n + i] = A[i * n + j];
  return t;
}

/** Function of a symmetric matrix: U f(w) U^T. */
export function symFunc(A: Float64Array, n: number, f: (w: number) => number): Float64Array {
  const { values, vectors } = eigh(A, n);
  const out = new Float64Array(n * n);
  for (let k = 0; k < n; k++) {
    const fk = f(values[k]);
    for (let i = 0; i < n; i++) {
      const vik = vectors[i * n + k] * fk;
      for (let j = 0; j < n; j++) out[i * n + j] += vik * vectors[j * n + k];
    }
  }
  return out;
}

/** Solves A x = b (small dense, partial pivoting). Returns null if singular. */
export function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-300) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}
