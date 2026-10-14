// Elemental masses, formula arithmetic and isotope patterns shared by the mass-spectrometry tools.
// Monoisotopic masses: AME2020 (Wang et al., Chinese Phys. C 45, 030003, 2021). Average masses and
// isotopic abundances: IUPAC CIAAW 2021 / Meija et al. Pure Appl. Chem. 88, 293 (2016).

export const ELECTRON = 0.000548579909;
export const MONO: Record<string, number> = {
  H: 1.00782503223, C: 12, N: 14.00307400443, O: 15.99491461957, S: 31.9720711744, P: 30.97376199842,
  Na: 22.989769282, K: 38.9637064864, Li: 7.0160034366, Se: 79.9165218, Cl: 34.968852682, Br: 78.9183376,
  I: 126.9044719, F: 18.99840316273, Ca: 39.962590863, Mg: 23.985041697, Fe: 55.93493633, Cu: 62.92959772, Zn: 63.92914201,
};
export const AVG: Record<string, number> = {
  H: 1.00794, C: 12.0107, N: 14.0067, O: 15.9994, S: 32.065, P: 30.973762, Na: 22.98977, K: 39.0983, Li: 6.941,
  Se: 78.971, Cl: 35.453, Br: 79.904, I: 126.90447, F: 18.998403, Ca: 40.078, Mg: 24.305, Fe: 55.845, Cu: 63.546, Zn: 65.38,
};
/** Relative isotope abundances indexed by nominal mass offset from the lightest stable isotope. */
const ISO: Record<string, number[]> = {
  H: [0.999885, 0.000115], C: [0.9893, 0.0107], N: [0.99636, 0.00364], O: [0.99757, 0.00038, 0.00205],
  S: [0.9499, 0.0075, 0.0425, 0, 0.0001], P: [1], Na: [1], F: [1], I: [1], Li: [0.0759, 0.9241],
  K: [0.932581, 0.000117, 0.067302], Cl: [0.7576, 0, 0.2424], Br: [0.5069, 0, 0.4931],
  Se: [0.0089, 0, 0.0937, 0.0763, 0.2377, 0, 0.4961, 0, 0.0873], Ca: [0.96941, 0, 0.00647, 0.00135, 0.02086],
  Mg: [0.7899, 0.1, 0.1101], Fe: [0.05845, 0, 0.91754, 0.02119, 0.00282], Cu: [0.6915, 0, 0.3085], Zn: [0.4917, 0, 0.2773, 0.0404, 0.1845, 0, 0.0061],
};
/** Offset (in nominal mass units) of the monoisotopic peak inside ISO[el]; Li-7 and Se-80 are not the lightest isotopes. */
const MONO_INDEX: Record<string, number> = { Li: 1, Se: 6, Fe: 2 };

export const PROTON = 1.0072764665789; // CODATA 2022 (H atom − e⁻ differs by the 13.6 eV binding energy, ~1e−8 u)
/** Charge-carrier masses (cation = atom − e⁻). Used for adduct ions such as [M+Na]+. */
export const CARRIERS: Record<string, { label: string; mass: number; formula: Formula }> = {
  H: { label: 'H⁺', mass: PROTON, formula: { H: 1 } },
  Na: { label: 'Na⁺', mass: 22.989769282 - ELECTRON, formula: { Na: 1 } },
  K: { label: 'K⁺', mass: 38.9637064864 - ELECTRON, formula: { K: 1 } },
  Li: { label: 'Li⁺', mass: 7.0160034366 - ELECTRON, formula: { Li: 1 } },
  NH4: { label: 'NH₄⁺', mass: 14.00307400443 + 4 * 1.00782503223 - ELECTRON, formula: { N: 1, H: 4 } },
};
export const NEUTRON = 1.00335483; // 13C − 12C, the dominant isotope spacing for organic ions

export type Formula = Record<string, number>;

const FORMULA_RE = /([A-Z][a-z]?)(-?\d*)/g;
/** Parse "C2H3NO", "H-1N-1O1" or "C6H12O6" into an element-count map. */
export function parseFormula(s: string): Formula {
  const f: Formula = {};
  const clean = s.replace(/\s+/g, '');
  if (!/^([A-Z][a-z]?-?\d*)*$/.test(clean)) throw new Error(`Cannot read formula "${s}". Use element symbols and counts, e.g. C2H3NO or H-1N-1O1.`);
  for (const [, el, n] of clean.matchAll(FORMULA_RE)) {
    if (!(el in MONO)) throw new Error(`Unknown element "${el}" in formula "${s}".`);
    const c = n === '' ? 1 : n === '-' ? -1 : Number(n);
    f[el] = (f[el] ?? 0) + c;
  }
  return f;
}

export function addFormula(a: Formula, b: Formula, times = 1): Formula {
  const out: Formula = { ...a };
  for (const [el, n] of Object.entries(b)) {
    const v = (out[el] ?? 0) + n * times;
    if (v === 0) delete out[el]; else out[el] = v;
  }
  return out;
}
export const sumFormulas = (fs: Formula[]) => fs.reduce((acc, f) => addFormula(acc, f), {} as Formula);

export function monoMass(f: Formula): number { let m = 0; for (const [el, n] of Object.entries(f)) m += n * MONO[el]; return m; }
export function avgMass(f: Formula): number { let m = 0; for (const [el, n] of Object.entries(f)) m += n * AVG[el]; return m; }

/** Hill order (C, H, then alphabetical); negative counts are shown as e.g. "N-1". */
export function formatFormula(f: Formula): string {
  const els = Object.keys(f).filter((e) => f[e] !== 0);
  const order = els.includes('C') ? ['C', 'H', ...els.filter((e) => e !== 'C' && e !== 'H').sort()] : els.sort();
  return order.filter((e) => f[e] !== undefined && f[e] !== 0).map((e) => `${e}${f[e] === 1 ? '' : f[e]}`).join('');
}

function convolve(a: number[], b: number[], max: number) {
  const out = new Array(Math.min(max, a.length + b.length - 1)).fill(0);
  for (let i = 0; i < a.length; i++) { if (!a[i]) continue; for (let j = 0; j < b.length && i + j < max; j++) out[i + j] += a[i] * b[j]; }
  return out;
}
function power(v: number[], n: number, max: number) {
  let result = [1], base = v;
  while (n > 0) { if (n & 1) result = convolve(result, base, max); n >>= 1; if (n) base = convolve(base, base, max); }
  return result;
}
/**
 * Aggregated isotope distribution by nominal offset from the monoisotopic peak, normalised to the most
 * intense peak. Peak k sits at roughly mono + k·NEUTRON (fine structure is not resolved).
 * Elements with negative counts (formula deltas) are ignored.
 */
export function isotopePattern(f: Formula, peaks = 6): number[] {
  let dist = [1];
  let shift = 0;
  for (const [el, n] of Object.entries(f)) {
    if (n <= 0) continue;
    const iso = ISO[el] ?? [1];
    shift += (MONO_INDEX[el] ?? 0) * n;
    dist = convolve(dist, power(iso, n, peaks + shift + 2), peaks + shift + 2);
  }
  const out = dist.slice(shift, shift + peaks);
  const max = Math.max(...out);
  return out.map((p) => p / max);
}
