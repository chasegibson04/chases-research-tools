// Activation presets and option builders shared by the MS tools.
import type { FixedMod } from './sequence';
import type { IonType } from './fragments';
import type { Activation } from './predict';

/** Ion series per activation (linear). Cyclic presets mirror the owner's cycfrag METHOD_IONS. */
export const PRESETS: Record<Activation, { linear: IonType[]; cyclic: IonType[] }> = {
  HCD: { linear: ['b', 'y', 'a'], cyclic: ['b', 'a'] },
  CID: { linear: ['b', 'y', 'a'], cyclic: ['b', 'a'] },
  ETD: { linear: ['c', 'z•', 'z+2', 'y'], cyclic: ['b', 'cz•', 'cz+1', 'c', 'c-1', 'z•', 'z+1'] },
  EThcD: { linear: ['b', 'y', 'c', 'z•'], cyclic: ['b', 'a', 'cz•', 'cz+1', 'c', 'c-1', 'z•', 'z+1'] },
  UVPD: { linear: ['a', 'b', 'c', 'x', 'y', 'z•'], cyclic: ['b', 'a'] },
};

/** Map an instrument activation label (from mzML/filter strings) onto a preset. */
export function presetFor(activation: string): Activation {
  const a = activation.toUpperCase();
  if (a.includes('ETHCD') || a.includes('ETCID') || a.includes('IR-ETD') || a === 'EThcD'.toUpperCase()) return 'EThcD';
  if (a.includes('ETD') || a.includes('ECD')) return 'ETD';
  if (a.includes('UVPD')) return 'UVPD';
  if (a.includes('CID') && !a.includes('HCD')) return 'CID';
  return 'HCD';
}

/** "Carbamidomethyl@C, Oxidation@M" → fixed modifications. */
export function parseFixedMods(s = ''): FixedMod[] {
  return s.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const [mod, sites] = x.split('@');
    if (!sites) throw new Error(`Fixed modification "${x}" needs a site, e.g. Carbamidomethyl@C or Acetyl@N-term.`);
    return { mod: mod.trim(), residues: sites.split(/[+/ ]+/).map((r) => r.trim()).filter(Boolean) };
  });
}

/** Extra fragment options exposed by both MS tools (advanced inputs). */
export interface ExtraFragmentOptions { scrambling?: boolean; sideChainLosses?: boolean }
