// Shared linking logic between the structure diagram, the spectrum and the ion table.
import type { Ion, IonType } from '@/lib/ms/fragments';
import type { Peptide } from '@/lib/ms/sequence';
import { ionSide } from './palette';
import type { StructureHighlight } from './PeptideStructure';

/** Marker families to draw on the structure for the selected ion types. */
export function familiesFor(types: IonType[], cyclic: boolean): { n: Array<'a' | 'b' | 'c'>; c: Array<'x' | 'y' | 'z'> } {
  const has = (...t: IonType[]) => t.some((x) => types.includes(x));
  const n: Array<'a' | 'b' | 'c'> = [];
  if (has('a')) n.push('a');
  if (has('b', 'b+H2O') || cyclic) n.push('b');
  if (has('c', 'c-1', 'cz•', 'cz+1') || (cyclic && has('z•', 'z+1'))) n.push('c');
  const c: Array<'x' | 'y' | 'z'> = [];
  if (!cyclic) { if (has('x')) c.push('x'); if (has('y')) c.push('y'); if (has('z', 'z•', 'z+2')) c.push('z'); }
  return { n, c };
}

const BACKBONE = new Set<IonType>(['a', 'b', 'c', 'c-1', 'x', 'y', 'z', 'z•', 'z+1', 'z+2', 'cz•', 'cz+1', 'b+H2O']);

/** Ions (no losses, protonated) whose cleavage includes this marker. */
export function ionsForMarker(ions: Ion[], bond: number, side: 'n' | 'c', cyclic: boolean): Ion[] {
  return ions.filter((i) => BACKBONE.has(i.type) && !i.loss && i.carrier === 'H' && (cyclic || ionSide(i.type) === side)
    && (cyclic ? (i.origins ?? [[i.start, i.end]]).length > 0 && i.bonds.includes(bond) : i.bonds[0] === bond));
}

/** Complementary ion: linear = the paired series; cyclic = the arc covering the rest of the ring (b-type, same charge). */
export function complementOf(ion: Ion, ions: Ion[], p: Peptide): Ion | undefined {
  if (!p.cyclic) return ion.pair ? ions.find((i) => i.id === ion.pair) : undefined;
  if (!['b', 'a'].includes(ion.type) || ion.loss) return undefined;
  const n = p.residues.length;
  const start = (ion.end + 1) % n, size = n - ion.size;
  return ions.find((i) => i.type === 'b' && !i.loss && i.carrier === 'H' && i.charge === ion.charge && i.size === size && (i.origins ?? [[i.start, i.end]]).some(([s]) => s % n === start));
}

export function structureHighlight(sel: Ion[], p: Peptide): StructureHighlight {
  const n = p.residues.length;
  const marks: StructureHighlight['marks'] = [];
  const residues = new Set<number>();
  for (const ion of sel) {
    if (ion.type === 'precursor') { for (let k = 0; k < n; k++) residues.add(k); continue; }
    if (ion.type === 'immonium') { residues.add(ion.start); continue; }
    const side = p.cyclic ? 'n' : ionSide(ion.type) ?? 'n';
    const origins = p.cyclic ? (ion.origins ?? [[ion.start, ion.end]]).slice(0, 1) : [[ion.start, ion.end]];
    for (const b of ion.bonds) marks.push({ bond: b % (3 * n), side });
    for (const [s, e] of origins) for (let k = s; k <= e; k++) residues.add(k % n);
  }
  return { marks, residues: [...residues] };
}

/** Bonds supported by matched ions, per marker side (for solid vs dotted markers). */
export function observedBonds(matchedIons: Ion[], cyclic: boolean): { n: Set<number>; c: Set<number> } {
  const n = new Set<number>(), c = new Set<number>();
  for (const ion of matchedIons) {
    if (!BACKBONE.has(ion.type)) continue;
    const side = cyclic ? 'n' : ionSide(ion.type);
    for (const b of ion.bonds) (side === 'c' ? c : n).add(b);
  }
  return { n, c };
}
