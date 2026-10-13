import type { ComputeFn } from '@/lib/types';

export interface Input { sequence: string; maxCharge: number; carbamidomethyl?: boolean; cyclic?: boolean; isotopePeaks?: number }
export interface Output {
  cleanSequence: string; length: number; formula: string; mono: number; average: number;
  mz: Array<{ z: number; mz: number }>;
  isotopes: Array<{ k: number; mz: number; mass: number; relIntensity: number }>;
}

type Formula = Record<'C' | 'H' | 'N' | 'O' | 'S', number>;
const RESIDUES: Record<string, Formula> = {
  G: { C: 2, H: 3, N: 1, O: 1, S: 0 }, A: { C: 3, H: 5, N: 1, O: 1, S: 0 }, S: { C: 3, H: 5, N: 1, O: 2, S: 0 }, P: { C: 5, H: 7, N: 1, O: 1, S: 0 },
  V: { C: 5, H: 9, N: 1, O: 1, S: 0 }, T: { C: 4, H: 7, N: 1, O: 2, S: 0 }, C: { C: 3, H: 5, N: 1, O: 1, S: 1 }, L: { C: 6, H: 11, N: 1, O: 1, S: 0 },
  I: { C: 6, H: 11, N: 1, O: 1, S: 0 }, N: { C: 4, H: 6, N: 2, O: 2, S: 0 }, D: { C: 4, H: 5, N: 1, O: 3, S: 0 }, Q: { C: 5, H: 8, N: 2, O: 2, S: 0 },
  K: { C: 6, H: 12, N: 2, O: 1, S: 0 }, E: { C: 5, H: 7, N: 1, O: 3, S: 0 }, M: { C: 5, H: 9, N: 1, O: 1, S: 1 }, H: { C: 6, H: 7, N: 3, O: 1, S: 0 },
  F: { C: 9, H: 9, N: 1, O: 1, S: 0 }, R: { C: 6, H: 12, N: 4, O: 1, S: 0 }, Y: { C: 9, H: 9, N: 1, O: 2, S: 0 }, W: { C: 11, H: 10, N: 2, O: 1, S: 0 },
};
const MONO = { C: 12.0, H: 1.0078250319, N: 14.0030740052, O: 15.9949146221, S: 31.97207069 };
const AVG = { C: 12.0107, H: 1.00794, N: 14.0067, O: 15.9994, S: 32.065 };
export const PROTON = 1.00727646688;
const WATER: Formula = { C: 0, H: 2, N: 0, O: 1, S: 0 };
const CAM: Formula = { C: 2, H: 3, N: 1, O: 1, S: 0 };
// Isotope abundance vectors indexed by nominal mass offset.
const ISO: Record<keyof Formula, number[]> = {
  C: [0.9893, 0.0107], H: [0.999885, 0.000115], N: [0.99632, 0.00368], O: [0.99757, 0.00038, 0.00205], S: [0.9493, 0.0076, 0.0429, 0, 0.0002],
};
const NEUTRON_SPACING = 1.00335;

export function cleanSequence(s: string) { return s.toUpperCase().replace(/[^A-Z]/g, ''); }

export function composition(seq: string, opts: { carbamidomethyl?: boolean; cyclic?: boolean } = {}): Formula {
  const f: Formula = { C: 0, H: 0, N: 0, O: 0, S: 0 };
  for (const aa of seq) {
    const r = RESIDUES[aa];
    if (!r) throw new Error(`Unknown residue "${aa}". Only the 20 standard amino acids are supported.`);
    for (const k of Object.keys(f) as (keyof Formula)[]) f[k] += r[k];
    if (aa === 'C' && opts.carbamidomethyl) for (const k of Object.keys(f) as (keyof Formula)[]) f[k] += CAM[k];
  }
  if (!opts.cyclic) for (const k of Object.keys(f) as (keyof Formula)[]) f[k] += WATER[k];
  return f;
}
export const formulaString = (f: Formula) => (['C', 'H', 'N', 'O', 'S'] as const).filter((k) => f[k] > 0).map((k) => `${k}${f[k] > 1 ? f[k] : ''}`).join('');
export const monoMass = (f: Formula) => (Object.keys(f) as (keyof Formula)[]).reduce((m, k) => m + f[k] * MONO[k], 0);
export const avgMass = (f: Formula) => (Object.keys(f) as (keyof Formula)[]).reduce((m, k) => m + f[k] * AVG[k], 0);

function convolve(a: number[], b: number[], max: number) {
  const out = new Array(Math.min(max, a.length + b.length - 1)).fill(0);
  for (let i = 0; i < a.length; i++) { if (!a[i]) continue; for (let j = 0; j < b.length && i + j < max; j++) out[i + j] += a[i] * b[j]; }
  return out;
}
function power(v: number[], n: number, max: number) { // exponentiation by squaring
  let result = [1], base = v;
  while (n > 0) { if (n & 1) result = convolve(result, base, max); n >>= 1; if (n) base = convolve(base, base, max); }
  return result;
}
export function isotopeDistribution(f: Formula, peaks = 8) {
  let dist = [1];
  for (const k of Object.keys(f) as (keyof Formula)[]) if (f[k] > 0) dist = convolve(dist, power(ISO[k], f[k], peaks), peaks);
  const maxI = Math.max(...dist);
  return dist.map((p) => p / maxI);
}

const run: ComputeFn<Input, Output> = async (input, ctx) => {
  const seq = cleanSequence(String(input.sequence ?? ''));
  if (!seq) throw new Error('Enter a peptide sequence.');
  if (seq.length > 5000) throw new Error('Sequence too long (max 5000 residues).');
  const maxZ = Math.max(1, Math.min(20, Math.floor(Number(input.maxCharge) || 1)));
  const peaks = Math.max(3, Math.min(30, Math.floor(Number(input.isotopePeaks) || 8)));
  ctx.progress(0.2, 'Composition');
  const f = composition(seq, input);
  const mono = monoMass(f), average = avgMass(f);
  const mz = Array.from({ length: maxZ }, (_, i) => ({ z: i + 1, mz: (mono + (i + 1) * PROTON) / (i + 1) }));
  ctx.progress(0.5, 'Isotopes');
  const rel = isotopeDistribution(f, peaks);
  const isotopes = rel.map((relIntensity, k) => ({ k, mass: mono + k * NEUTRON_SPACING, mz: mono + k * NEUTRON_SPACING + PROTON, relIntensity }));
  ctx.progress(1, 'Done');
  return { cleanSequence: seq, length: seq.length, formula: formulaString(f), mono, average, mz, isotopes };
};
export default run;
