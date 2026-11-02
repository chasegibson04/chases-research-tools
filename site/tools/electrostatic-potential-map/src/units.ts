import { HARTREE_TO_EV, HARTREE_TO_KCAL, HARTREE_TO_KJ } from './chem';

export type EspUnit = 'kcal' | 'kj' | 'au' | 'ev';
export const UNIT_FACTOR: Record<EspUnit, number> = { kcal: HARTREE_TO_KCAL, kj: HARTREE_TO_KJ, au: 1, ev: HARTREE_TO_EV };
export const UNIT_LABEL: Record<EspUnit, string> = { kcal: 'kcal/mol', kj: 'kJ/mol', au: 'a.u.', ev: 'eV' };
export const UNIT_NAMES: Record<EspUnit, string> = { kcal: 'kcal/mol', kj: 'kJ/mol', au: 'atomic units (Eh/e)', ev: 'eV (volts)' };

export function niceNumber(v: number): string {
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  if (a >= 0.1) return v.toFixed(3);
  return v.toFixed(4);
}

/** Rounds a magnitude to a "nice" value (1, 2, 2.5, 5 x 10^n) for default colour ranges. */
export function niceRange(v: number): number {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  const n = m <= 1 ? 1 : m <= 1.5 ? 1.5 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 3 ? 3 : m <= 4 ? 4 : m <= 5 ? 5 : m <= 7.5 ? 7.5 : 10;
  return n * p;
}
