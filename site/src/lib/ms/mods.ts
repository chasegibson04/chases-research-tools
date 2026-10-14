// Modification table (a curated Unimod subset) with residue-gated neutral losses.
// Masses/compositions: Unimod (https://www.unimod.org), accessed 2026-10. Losses: Mascot / ProteinProspector conventions.
import { parseFormula, monoMass, type Formula } from './elements';

export interface ModDef {
  name: string;
  /** Alternative spellings accepted in sequences, e.g. "Ox", "U:35". */
  aliases: string[];
  unimod?: number;
  formula: Formula;
  /** Residues (one-letter) or 'N-term' / 'C-term' where it is usually placed; informational and for the picker. */
  sites: string[];
  /** Characteristic neutral loss from fragments that carry this modification. */
  loss?: { name: string; formula: Formula };
}

const M = (name: string, aliases: string[], unimod: number | undefined, formula: string, sites: string[], loss?: [string, string]): ModDef =>
  ({ name, aliases, unimod, formula: parseFormula(formula), sites, loss: loss ? { name: loss[0], formula: parseFormula(loss[1]) } : undefined });

export const MODS: ModDef[] = [
  M('Oxidation', ['Ox', 'ox', 'Hydroxylation'], 35, 'O', ['M', 'W', 'P', 'K', 'C'], ['CH₄SO', 'C1H4S1O1']),
  M('Phospho', ['Phos', 'ph', 'p'], 21, 'HPO3', ['S', 'T', 'Y', 'H'], ['H₃PO₄', 'H3PO4']),
  M('Carbamidomethyl', ['CAM', 'cam', 'IAA'], 4, 'C2H3NO', ['C']),
  M('Acetyl', ['Ac', 'ac'], 1, 'C2H2O', ['N-term', 'K', 'S', 'T']),
  M('Amidated', ['Amide', 'NH2', 'amide'], 2, 'H1N1O-1', ['C-term']),
  M('Deamidated', ['Deam', 'deam'], 7, 'H-1N-1O1', ['N', 'Q', 'R']),
  M('Methyl', ['Me', 'methyl'], 34, 'CH2', ['K', 'R', 'E', 'D', 'H', 'C-term', 'N-term']),
  M('Dimethyl', ['diMe'], 36, 'C2H4', ['K', 'R', 'N-term']),
  M('Trimethyl', ['triMe'], 37, 'C3H6', ['K']),
  M('Formyl', ['For'], 122, 'CO', ['N-term', 'K', 'S', 'T']),
  M('Gln->pyro-Glu', ['pyroGlu-Q', 'Pyro-glu'], 28, 'H-3N-1', ['Q']),
  M('Glu->pyro-Glu', ['pyroGlu-E'], 27, 'H-2O-1', ['E']),
  M('Carbamyl', ['Carbamylation'], 5, 'HCNO', ['N-term', 'K', 'R', 'C']),
  M('Dehydrated', ['-H2O', 'Dehydration'], 23, 'H-2O-1', ['S', 'T', 'D', 'C-term']),
  M('Sulfo', ['Sulfation'], 40, 'O3S', ['Y', 'S', 'T'], ['SO₃', 'O3S']),
  M('Nitro', ['Nitration'], 354, 'H-1NO2', ['Y', 'W']),
  M('GG', ['GlyGly', 'ubiquitin'], 121, 'C4H6N2O2', ['K']),
  M('Succinyl', ['Succ'], 64, 'C4H4O3', ['K', 'N-term']),
  M('Crotonyl', [], 1363, 'C4H4O', ['K']),
  M('Myristoyl', ['Myr'], 45, 'C14H26O', ['N-term', 'G', 'K']),
  M('Palmitoyl', ['Palm'], 47, 'C16H30O', ['C', 'K', 'S', 'T', 'N-term']),
  M('Biotin', [], 3, 'C10H14N2O2S', ['K', 'N-term']),
  M('Citrullination', ['Cit'], 7, 'H-1N-1O1', ['R']),
  M('Dioxidation', ['diOx'], 425, 'O2', ['M', 'W', 'C']),
  M('Trioxidation', ['Cysteic'], 345, 'O3', ['C']),
  M('Disulfide', ['-2H', 'Dehydro'], 374, 'H-1', ['C']),
  M('Cation:Na', ['Na'], 30, 'H-1Na', ['D', 'E', 'C-term']),
  M('Cation:K', ['K+'], 530, 'H-1K', ['D', 'E', 'C-term']),
  M('TMT6plex', ['TMT', 'TMT10plex', 'TMT11plex'], 737, 'C12H20N2O2', ['K', 'N-term']),
  M('TMTpro', ['TMT16plex', 'TMT18plex'], 2016, 'C15H25N3O3', ['K', 'N-term']),
  M('iTRAQ4plex', ['iTRAQ'], 214, 'C7H12N2O', ['K', 'N-term']),
  M('Label:13C(6)15N(2)', ['SILAC-K8', 'K8'], 259, '', ['K']),
  M('Label:13C(6)15N(4)', ['SILAC-R10', 'R10'], 267, '', ['R']),
  M('Propionyl', ['Prop'], 58, 'C3H4O', ['K', 'N-term']),
  M('Lipoyl', [], 42, 'C8H12OS2', ['K']),
  M('Hex', ['Hexose', 'Glycation'], 41, 'C6H10O5', ['K', 'N-term', 'S', 'T']),
  M('HexNAc', ['GlcNAc', 'O-GlcNAc'], 43, 'C8H13NO5', ['S', 'T', 'N'], ['HexNAc', 'C8H13NO5']),
];

/** Exact delta masses for isotope labels, whose composition can't be written with natural-abundance elements. */
const ISOTOPE_DELTA: Record<string, number> = { 'Label:13C(6)15N(2)': 8.014199, 'Label:13C(6)15N(4)': 10.008269 };

const LOOKUP = new Map<string, ModDef>();
for (const m of MODS) {
  for (const k of [m.name, ...m.aliases, ...(m.unimod ? [`U:${m.unimod}`, `UNIMOD:${m.unimod}`] : [])]) LOOKUP.set(k.toLowerCase(), m);
}

export interface AppliedMod { name: string; mass: number; formula: Formula | null; loss?: ModDef['loss']; label: string }

/**
 * Resolve the text inside a bracket: a named mod ("Oxidation", "U:35"), a mass delta ("+15.9949", "-18.0106")
 * or a formula ("Formula:C2H2O").
 */
export function resolveMod(token: string): AppliedMod {
  const t = token.trim();
  if (/^[+-]\d*\.?\d+$/.test(t)) { const mass = Number(t); return { name: t, mass, formula: null, label: `${mass >= 0 ? '+' : ''}${mass.toFixed(4)}` }; }
  const fm = /^formula:\s*(.+)$/i.exec(t);
  if (fm) { const f = parseFormula(fm[1]); return { name: t, mass: monoMass(f), formula: f, label: fm[1] }; }
  const def = LOOKUP.get(t.toLowerCase());
  if (!def) throw new Error(`Unknown modification "${t}". Use a Unimod name (e.g. Oxidation, Phospho), a mass delta like +15.9949, or Formula:C2H2O.`);
  const iso = ISOTOPE_DELTA[def.name];
  return { name: def.name, mass: iso ?? monoMass(def.formula), formula: iso ? null : def.formula, loss: def.loss, label: def.name };
}
