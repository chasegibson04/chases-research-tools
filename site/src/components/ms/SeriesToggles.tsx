import type { Ion } from '@/lib/ms/fragments';
import type { MsPalette } from './palette';

/** Plot layers that can be hidden. Ion series hide their annotations (the peak stays, drawn as unassigned). */
export type SeriesKey = 'a' | 'b' | 'c' | 'x' | 'y' | 'z' | 'internal' | 'immonium' | 'precursor' | 'scrambled' | 'losses' | 'isotopes' | 'unassigned' | 'labels';

export function seriesOf(ion: Ion): SeriesKey {
  switch (ion.type) {
    case 'a': return 'a';
    case 'b': case 'b+H2O': return 'b';
    case 'c': case 'c-1': case 'cz•': case 'cz+1': return 'c';
    case 'x': return 'x';
    case 'y': return 'y';
    case 'z': case 'z•': case 'z+1': case 'z+2': case 'w': return 'z';
    case 'immonium': return 'immonium';
    case 'precursor': return 'precursor';
    case 'b-scr': return 'scrambled';
    default: return 'internal';
  }
}
/** Is this ion visible under the current toggles? */
export const ionVisible = (ion: Ion, hidden: Set<SeriesKey>) => !hidden.has(seriesOf(ion)) && !(ion.loss && hidden.has('losses'));

const ORDER: Array<[SeriesKey, string]> = [['a', 'a'], ['b', 'b'], ['c', 'c'], ['x', 'x'], ['y', 'y'], ['z', 'z'], ['internal', 'internal'], ['scrambled', 'scrambled'], ['immonium', 'immonium'], ['precursor', 'precursor'], ['losses', 'losses'], ['isotopes', '¹³C'], ['unassigned', 'unassigned'], ['labels', 'labels']];

interface Props { present: Set<SeriesKey>; hidden: Set<SeriesKey>; onChange: (h: Set<SeriesKey>) => void; palette: MsPalette }

/** Compact show/hide chips for plot layers; only series present in the current result are offered. */
export function SeriesToggles({ present, hidden, onChange, palette }: Props) {
  const col: Partial<Record<SeriesKey, string>> = { a: palette.ion.a, b: palette.ion.b, c: palette.ion.c, x: palette.ion.x, y: palette.ion.y, z: palette.ion.z, internal: palette.internal, scrambled: palette.internal, immonium: palette.immonium, precursor: palette.precursor };
  const keys = ORDER.filter(([k]) => present.has(k) || ['losses', 'isotopes', 'unassigned', 'labels'].includes(k));
  const toggle = (k: SeriesKey) => { const n = new Set(hidden); if (n.has(k)) n.delete(k); else n.add(k); onChange(n); };
  return (
    <div class="series-toggles" role="group" aria-label="Show or hide plot layers">
      <span class="small faint">Show:</span>
      {keys.map(([k, label]) => (
        <button type="button" class="chip chip-xs" aria-pressed={!hidden.has(k)} onClick={() => toggle(k)} title={`${hidden.has(k) ? 'Show' : 'Hide'} ${label}`}
          style={!hidden.has(k) && col[k] ? { borderColor: col[k], color: col[k] } : undefined}>{label}</button>
      ))}
      {hidden.size > 0 && <button type="button" class="linklike small" onClick={() => onChange(new Set())}>show all</button>}
    </div>
  );
}
