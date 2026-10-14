// Illustrative ("representative") MS/MS spectrum from theoretical ions. This is a transparent rule set, NOT a
// trained intensity model: relative weights by ion type and activation, well-known cleavage preferences, and
// each ion's isotope envelope. Rules: proline effect (enhanced cleavage N-terminal to Pro, suppressed C-terminal
// to Pro), aspartic-acid effect (cleavage C-terminal to Asp/Glu), weak b1, charge states limited by basic sites.
// References: Paizs & Suhai, Mass Spectrom Rev 24, 508 (2005); Huang et al., Anal Chem 77, 5800 (2005);
// cyclic ring-opening preference at Xxx–Pro is a heuristic (see the tool README).
import { isotopePattern, parseFormula, NEUTRON } from './elements';
import type { Ion, IonType } from './fragments';
import type { Peptide } from './sequence';

export type Activation = 'HCD' | 'CID' | 'ETD' | 'EThcD' | 'UVPD';

const TYPE_WEIGHT: Record<Activation, Partial<Record<IonType, number>>> = {
  HCD: { y: 1, b: 0.55, a: 0.12, x: 0.02, c: 0.02, 'z•': 0.02, immonium: 0.2, 'internal-b': 0.06, 'internal-a': 0.03, precursor: 0.12, 'b+H2O': 0.1 },
  CID: { y: 1, b: 0.8, a: 0.1, immonium: 0.05, 'internal-b': 0.04, precursor: 0.3, 'b+H2O': 0.1 },
  ETD: { c: 0.9, 'z•': 1, 'z+2': 0.3, 'c-1': 0.2, y: 0.12, b: 0.05, z: 0.1, precursor: 0.6 },
  EThcD: { b: 0.5, y: 0.9, c: 0.7, 'z•': 0.7, 'z+2': 0.2, a: 0.08, immonium: 0.1, precursor: 0.2 },
  UVPD: { a: 0.6, x: 0.5, b: 0.5, y: 0.8, c: 0.3, 'z•': 0.3, immonium: 0.1, precursor: 0.3 },
};
const BASIC = new Set(['K', 'R', 'H']);

export interface PredictedPeak { mz: number; intensity: number; ionId: string; isotope: number }

export function predictSpectrum(p: Peptide, ions: Ion[], activation: Activation, isotopes = 3): PredictedPeak[] {
  const n = p.residues.length;
  const w = TYPE_WEIGHT[activation];
  const peaks: PredictedPeak[] = [];
  for (const ion of ions) {
    let I = w[ion.type] ?? 0.03;
    if (!I) continue;
    const res = p.residues;
    if (!p.cyclic && ['a', 'b', 'c', 'c-1', 'x', 'y', 'z', 'z•', 'z+2'].includes(ion.type)) {
      const isN = ['a', 'b', 'c', 'c-1'].includes(ion.type);
      const k = isN ? ion.end : ion.start - 1; // cleavage after residue k
      const left = res[k]?.def.code, right = res[k + 1]?.def.code;
      if (right === 'P') I *= 3.5;
      if (left === 'P') I *= 0.35;
      if (left === 'D' || left === 'E') I *= 2;
      if (left === 'G' || right === 'G') I *= 0.75;
      if (ion.size === 1) I *= isN ? (ion.type === 'b' ? 0.05 : 0.3) : (BASIC.has(res[n - 1].def.code) ? 1.1 : 0.5);
      if (ion.type === 'a' && ion.size === 2) I *= 4; // a2 is characteristic in HCD
      if (ion.size > 0.85 * n) I *= 0.45;
    }
    if (p.cyclic && (ion.type === 'b' || ion.type === 'a')) {
      if (res[ion.start % n].def.ringToN || res[ion.start % n].nMethyl) I *= 2.5; // opened N-terminal to Pro / N-Me
      if (ion.size <= 1) I *= 0.2;
      if (ion.size === n - 1) I *= 1.4;
      I *= 1 / Math.sqrt(ion.origins?.length ?? 1) * (ion.origins?.length ?? 1) ** 0.5; // keep degeneracy neutral
    }
    if (ion.loss) I *= 0.18 ** ion.loss.split('−').length;
    if (ion.carrier !== 'H') I *= 0.4;
    if (ion.charge > 1 && ion.type !== 'precursor') {
      const covered = p.cyclic ? [] : res.slice(ion.start, ion.end + 1);
      const sites = covered.filter((r) => BASIC.has(r.def.code)).length + (ion.start === 0 && !p.cyclic ? 1 : 0);
      I *= sites >= ion.charge ? 0.6 : 0.12;
      if (ion.mz * ion.charge < 400) I *= 0.2;
    }
    if (ion.type === 'immonium' && ['H', 'F', 'Y', 'W', 'L', 'I', 'P'].includes(ion.seq.charAt(0).toUpperCase())) I *= 2;
    let pattern = [1];
    try { pattern = isotopePattern(parseFormula(ion.formula), isotopes); } catch { /* formula with mass-only mods */ }
    pattern.forEach((rel, k) => { if (rel > 0.02) peaks.push({ mz: ion.mz + (k * NEUTRON) / ion.charge, intensity: I * rel, ionId: ion.id, isotope: k }); });
  }
  const max = peaks.reduce((m, q) => Math.max(m, q.intensity), 0) || 1;
  return peaks.map((q) => ({ ...q, intensity: (q.intensity / max) * 100 })).sort((a, b) => a.mz - b.mz);
}
