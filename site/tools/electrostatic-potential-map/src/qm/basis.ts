import BASIS from './basis.json';
import { MAX_Z, SYMBOLS, symbolOf } from '../chem';

export type BasisName = 'sto-3g' | '3-21g' | '6-31g';
export const BASIS_LABELS: Record<BasisName, string> = { 'sto-3g': 'STO-3G', '3-21g': '3-21G', '6-31g': '6-31G' };
type RawShell = [number, number[], number[]];
const DATA = BASIS as unknown as Record<string, Record<string, RawShell[]>>;

export interface Shell {
  /** Angular momentum: 0 = s, 1 = p (Cartesian x, y, z). */
  l: number;
  atom: number;
  /** Centre in bohr. */
  x: number; y: number; z: number;
  exps: Float64Array;
  /** Contraction coefficients that include primitive and contraction normalisation. */
  coefs: Float64Array;
  /** Index of the first basis function of the shell and number of functions (1 or 3). */
  first: number;
  size: number;
}

export interface Atom { z: number; x: number; y: number; z3: number }

export function supportedElements(basis: BasisName): number[] {
  return Object.keys(DATA[basis]).map((s) => SYMBOLS.indexOf(s)).filter((z) => z > 0 && z <= MAX_Z);
}

/** Builds the shell list for atoms with positions in bohr: {z, x, y, z3}. */
export function buildShells(atoms: Atom[], basis: BasisName): { shells: Shell[]; nbf: number } {
  const table = DATA[basis];
  if (!table) throw new Error(`Unknown basis set "${basis}".`);
  const shells: Shell[] = [];
  let nbf = 0;
  atoms.forEach((a, ia) => {
    const raw = table[symbolOf(a.z)];
    if (!raw || a.z > MAX_Z) throw new Error(`Element ${symbolOf(a.z)} is not supported (hydrogen to calcium only).`);
    for (const [l, es, cs] of raw) {
      const exps = Float64Array.from(es);
      const c0 = Float64Array.from(cs); // coefficients of *normalised* primitives (Gaussian94 convention)
      const pn = (a: number) => Math.pow((2 * a) / Math.PI, 0.75) * (l === 1 ? 2 * Math.sqrt(a) : 1); // primitive normalisation
      // contracted overlap built from normalised primitives: <g_i|g_j> = (2 sqrt(ab)/(a+b))^(l+3/2)
      let s = 0;
      for (let i = 0; i < exps.length; i++)
        for (let j = 0; j < exps.length; j++) s += c0[i] * c0[j] * Math.pow((2 * Math.sqrt(exps[i] * exps[j])) / (exps[i] + exps[j]), l + 1.5);
      const f = 1 / Math.sqrt(s);
      // coefficients multiplying the *un-normalised* primitives x^l exp(-a r^2), contraction normalised to 1
      const coefs = Float64Array.from(c0, (c, i) => c * pn(exps[i]) * f);
      const size = l === 0 ? 1 : 3;
      shells.push({ l, atom: ia, x: a.x, y: a.y, z: a.z3, exps, coefs, first: nbf, size });
      nbf += size;
    }
  });
  return { shells, nbf };
}
