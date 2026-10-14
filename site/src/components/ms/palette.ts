import { useEffect, useState } from 'preact/hooks';
// Resolve theme tokens into concrete colours for canvas drawing and standalone SVG export.
import type { SvgPalette } from '@/lib/ms/structureSvg';
import type { IonType } from '@/lib/ms/fragments';

const v = (name: string, fallback: string) =>
  (typeof getComputedStyle !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : '') || fallback;

/** Re-render counter that bumps when the page theme changes (theme picker), for memoised palettes. */
export function useThemeTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const mo = new MutationObserver(() => setTick((t) => t + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return tick;
}

export interface MsPalette extends SvgPalette { line: string; accent: string; internal: string; immonium: string; precursor: string; unassigned: string; err: string; ok: string }

export function screenPalette(): MsPalette {
  return {
    fg: v('--fg', '#1c1a17'), muted: v('--fg-muted', '#5c574f'), faint: v('--fg-faint', '#9a948a'), bg: v('--bg-panel', '#ffffff'),
    band: v('--accent-soft', 'rgba(139,38,53,.1)'), font: v('--font-sans', 'sans-serif'), line: v('--line', '#ddd'), accent: v('--accent', '#8b2635'),
    ion: { a: v('--ion-a', '#009e73'), b: v('--ion-b', '#0072b2'), c: v('--ion-c', '#56b4e9'), x: v('--ion-x', '#cc79a7'), y: v('--ion-y', '#d55e00'), z: v('--ion-z', '#e69f00') },
    internal: v('--ion-internal', '#8a7f72'), immonium: v('--ion-immonium', '#6f6a63'), precursor: v('--ion-precursor', '#7a4f9e'), unassigned: v('--ion-unassigned', '#9a948a'),
    err: v('--err', '#b3261e'), ok: v('--ok', '#2f7d4f'),
  };
}
/** Print/export palette: white background, black text, same ion colours. */
export function printPalette(screen: MsPalette): MsPalette {
  return { ...screen, fg: '#000000', muted: '#444444', faint: '#888888', bg: '#ffffff', line: '#cccccc', font: 'Arial, Helvetica, sans-serif', band: 'rgba(0,114,178,0.14)' };
}

export function ionColor(p: MsPalette, type: IonType): string {
  switch (type) {
    case 'a': case 'internal-a': return type === 'a' ? p.ion.a : p.internal;
    case 'b': case 'b+H2O': return p.ion.b;
    case 'c': case 'c-1': return p.ion.c;
    case 'x': return p.ion.x;
    case 'y': return p.ion.y;
    case 'z': case 'z•': case 'z+1': case 'z+2': case 'w': return p.ion.z;
    case 'cz•': case 'cz+1': return p.ion.c;
    case 'immonium': return p.immonium;
    case 'precursor': return p.precursor;
    default: return p.internal;
  }
}
/** Which side of the structure diagram an ion's marker lives on. */
export const ionSide = (type: IonType): 'n' | 'c' | null =>
  ['a', 'b', 'c', 'c-1', 'b+H2O', 'cz•', 'cz+1'].includes(type) ? 'n' : ['x', 'y', 'z', 'z•', 'z+1', 'z+2'].includes(type) ? 'c' : null;
