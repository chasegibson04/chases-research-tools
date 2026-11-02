// Element data for the ESP tool: symbols, radii, display colours. Supported by the quantum engine: Z = 1..20 (H to Ca).
export const SYMBOLS = ['', 'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe'];
export const MAX_Z = 20;
export const BOHR_PER_ANGSTROM = 1 / 0.529177210903;
export const ANGSTROM_PER_BOHR = 0.529177210903;
export const HARTREE_TO_KCAL = 627.5094740631;
export const HARTREE_TO_KJ = 2625.4996394799;
export const HARTREE_TO_EV = 27.211386245988;
/** 1 e*bohr^2 in Debye*Angstrom (Buckingham). */
export const EA0SQ_TO_BUCKINGHAM = 1.3450342;
export const AU_TO_DEBYE = 2.541746473;

export const zOf = (symbol: string): number => {
  const s = symbol.trim();
  const key = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const i = SYMBOLS.indexOf(key);
  if (i < 1) throw new Error(`Unknown element symbol "${symbol}".`);
  return i;
};
export const symbolOf = (z: number): string => SYMBOLS[z] ?? `Z${z}`;

// Cordero et al. 2008 covalent radii (Angstrom) and Bondi/Alvarez van der Waals radii (Angstrom), H..Ca.
const COV = [0, 0.31, 0.28, 1.28, 0.96, 0.84, 0.76, 0.71, 0.66, 0.57, 0.58, 1.66, 1.41, 1.21, 1.11, 1.07, 1.05, 1.02, 1.06, 2.03, 1.76];
const VDW = [0, 1.2, 1.4, 1.82, 1.53, 1.92, 1.7, 1.55, 1.52, 1.47, 1.54, 2.27, 1.73, 1.84, 2.1, 1.8, 1.8, 1.75, 1.88, 2.75, 2.31];
export const covalentRadius = (z: number) => COV[z] ?? 1.5;
export const vdwRadius = (z: number) => VDW[z] ?? 2.0;

// Jmol-style CPK colours.
const CPK: Record<number, string> = { 1: '#ffffff', 2: '#d9ffff', 3: '#cc80ff', 4: '#c2ff00', 5: '#ffb5b5', 6: '#909090', 7: '#3050f8', 8: '#ff0d0d', 9: '#90e050', 10: '#b3e3f5', 11: '#ab5cf2', 12: '#8aff00', 13: '#bfa6a6', 14: '#f0c8a0', 15: '#ff8000', 16: '#ffff30', 17: '#1ff01f', 18: '#80d1e3', 19: '#8f40d4', 20: '#3dff00' };
export const cpkColor = (z: number) => CPK[z] ?? '#c0a0ff';

/** Hill-system molecular formula (C, H first, then alphabetical; charge appended). */
export function formulaOf(zs: number[], charge = 0): string {
  const count = new Map<string, number>();
  for (const z of zs) count.set(symbolOf(z), (count.get(symbolOf(z)) ?? 0) + 1);
  const syms = [...count.keys()];
  const hasC = count.has('C');
  syms.sort((a, b) => (hasC ? (a === 'C' ? -1 : b === 'C' ? 1 : a === 'H' ? -1 : b === 'H' ? 1 : 0) : 0) || a.localeCompare(b));
  const body = syms.map((s) => `${s}${count.get(s)! > 1 ? count.get(s) : ''}`).join('');
  return charge === 0 ? body : `${body}${Math.abs(charge) > 1 ? Math.abs(charge) : ''}${charge > 0 ? '+' : '−'}`;
}
