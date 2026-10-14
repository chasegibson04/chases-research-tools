// Amino-acid residue table (residue = amino acid − H2O, i.e. the repeating unit −NH−CαHR−CO−).
// Formulas from Unimod / NIST; non-standard residues cover what is common in cyclic and nonribosomal peptides.
import { parseFormula, type Formula } from './elements';

export interface ResidueDef {
  /** Token used in sequences: one letter for the 22 proteinogenic residues, otherwise a short name, e.g. "Orn". */
  code: string;
  three: string;
  name: string;
  formula: Formula;
  /** Condensed side chain for the structure diagram (R group on Cα). */
  side: string;
  /** Side chain as SMILES with the attachment atom first (empty for Gly). Used by full-structure drawings. */
  sideSmiles: string;
  /** Backbone nitrogen carries a methyl instead of H (N-methyl residues, sarcosine). */
  nMethyl?: boolean;
  /** Side chain closes a ring onto the backbone N (proline-like). */
  ringToN?: boolean;
  /** Cα carries a second substituent (Aib). */
  alphaMethyl?: boolean;
  /** Residues with identical elemental composition (cannot be told apart by mass). */
  isobaricWith?: string[];
  /** Hydroxy acid in a depsipeptide: the backbone link is an ester (−O−) instead of an amide (−NH−). */
  ester?: boolean;
}

const R = (code: string, three: string, name: string, formula: string, side: string, sideSmiles: string, extra: Partial<ResidueDef> = {}): ResidueDef =>
  ({ code, three, name, formula: parseFormula(formula), side, sideSmiles, ...extra });

const STANDARD: ResidueDef[] = [
  R('G', 'Gly', 'Glycine', 'C2H3NO', 'H', ''),
  R('A', 'Ala', 'Alanine', 'C3H5NO', 'CH₃', 'C', { isobaricWith: ['Sar'] }),
  R('S', 'Ser', 'Serine', 'C3H5NO2', 'CH₂OH', 'CO'),
  R('P', 'Pro', 'Proline', 'C5H7NO', '(CH₂)₃', 'CCC', { ringToN: true }),
  R('V', 'Val', 'Valine', 'C5H9NO', 'CH(CH₃)₂', 'C(C)C', { isobaricWith: ['Nva'] }),
  R('T', 'Thr', 'Threonine', 'C4H7NO2', 'CH(OH)CH₃', 'C(O)C', { isobaricWith: ['Hse'] }),
  R('C', 'Cys', 'Cysteine', 'C3H5NOS', 'CH₂SH', 'CS'),
  R('L', 'Leu', 'Leucine', 'C6H11NO', 'CH₂CH(CH₃)₂', 'CC(C)C', { isobaricWith: ['I', 'Nle'] }),
  R('I', 'Ile', 'Isoleucine', 'C6H11NO', 'CH(CH₃)C₂H₅', 'C(C)CC', { isobaricWith: ['L', 'Nle'] }),
  R('N', 'Asn', 'Asparagine', 'C4H6N2O2', 'CH₂CONH₂', 'CC(N)=O'),
  R('D', 'Asp', 'Aspartic acid', 'C4H5NO3', 'CH₂COOH', 'CC(=O)O'),
  R('Q', 'Gln', 'Glutamine', 'C5H8N2O2', '(CH₂)₂CONH₂', 'CCC(N)=O'),
  R('K', 'Lys', 'Lysine', 'C6H12N2O', '(CH₂)₄NH₂', 'CCCCN'),
  R('E', 'Glu', 'Glutamic acid', 'C5H7NO3', '(CH₂)₂COOH', 'CCC(=O)O'),
  R('M', 'Met', 'Methionine', 'C5H9NOS', '(CH₂)₂SCH₃', 'CCSC'),
  R('H', 'His', 'Histidine', 'C6H7N3O', 'CH₂-Im', 'Cc1cnc[nH]1'),
  R('F', 'Phe', 'Phenylalanine', 'C9H9NO', 'CH₂Ph', 'Cc1ccccc1'),
  R('R', 'Arg', 'Arginine', 'C6H12N4O', '(CH₂)₃NHC(NH)NH₂', 'CCCNC(=N)N'),
  R('Y', 'Tyr', 'Tyrosine', 'C9H9NO2', 'CH₂C₆H₄OH', 'Cc1ccc(O)cc1'),
  R('W', 'Trp', 'Tryptophan', 'C11H10N2O', 'CH₂-Ind', 'Cc1c[nH]c2ccccc12'),
  R('U', 'Sec', 'Selenocysteine', 'C3H5NOSe', 'CH₂SeH', 'C[SeH]'),
  R('O', 'Pyl', 'Pyrrolysine', 'C12H19N3O2', '(CH₂)₄NH-Pyl', 'CCCCNC(=O)C1CCC=N1'),
];

const NONSTANDARD: ResidueDef[] = [
  R('Orn', 'Orn', 'Ornithine', 'C5H10N2O', '(CH₂)₃NH₂', 'CCCN'),
  R('Dab', 'Dab', '2,4-Diaminobutyric acid', 'C4H8N2O', '(CH₂)₂NH₂', 'CCN'),
  R('Dap', 'Dap', '2,3-Diaminopropionic acid', 'C3H6N2O', 'CH₂NH₂', 'CN'),
  R('Hyp', 'Hyp', '4-Hydroxyproline', 'C5H7NO2', 'CH₂CH(OH)CH₂', 'CC(O)C', { ringToN: true }),
  R('Aib', 'Aib', 'α-Aminoisobutyric acid', 'C4H7NO', 'CH₃', 'C', { alphaMethyl: true, isobaricWith: ['Abu'] }),
  R('Abu', 'Abu', '2-Aminobutyric acid', 'C4H7NO', 'CH₂CH₃', 'CC', { isobaricWith: ['Aib'] }),
  R('Nva', 'Nva', 'Norvaline', 'C5H9NO', '(CH₂)₂CH₃', 'CCC', { isobaricWith: ['V'] }),
  R('Nle', 'Nle', 'Norleucine', 'C6H11NO', '(CH₂)₃CH₃', 'CCCC', { isobaricWith: ['L', 'I'] }),
  R('Hse', 'Hse', 'Homoserine', 'C4H7NO2', '(CH₂)₂OH', 'CCO', { isobaricWith: ['T'] }),
  R('Cit', 'Cit', 'Citrulline', 'C6H11N3O2', '(CH₂)₃NHCONH₂', 'CCCNC(N)=O'),
  R('Sar', 'Sar', 'Sarcosine (N-methylglycine)', 'C3H5NO', 'H', '', { nMethyl: true, isobaricWith: ['A'] }),
  R('pGlu', 'pGlu', 'Pyroglutamic acid', 'C5H5NO2', '(CH₂)₂CO', 'CCC(=O)', { ringToN: true }),
  R('Phg', 'Phg', 'Phenylglycine', 'C8H7NO', 'Ph', 'c1ccccc1'),
  R('Cha', 'Cha', 'Cyclohexylalanine', 'C9H15NO', 'CH₂C₆H₁₁', 'CC1CCCCC1'),
  R('Nal', 'Nal', '3-(2-Naphthyl)alanine', 'C13H11NO', 'CH₂-Naph', 'Cc1ccc2ccccc2c1'),
  R('Tle', 'Tle', 'tert-Leucine', 'C6H11NO', 'C(CH₃)₃', 'C(C)(C)C', { isobaricWith: ['L', 'I'] }),
  R('Bal', 'βAla', 'β-Alanine', 'C3H5NO', 'H', '', { isobaricWith: ['A', 'Sar'] }),
  // Building blocks from nonribosomal / cyanobacterial / synthetic macrocycles (masses match cycfrag/chem.py).
  R('Dhb', 'Dhb', 'Dehydrobutyrine', 'C4H5NO', '=CHCH₃', '', { isobaricWith: ['Mdha', 'Aze'] }),
  R('Dha', 'Dha', 'Dehydroalanine', 'C3H3NO', '=CH₂', ''),
  R('Mdha', 'Mdha', 'N-Methyldehydroalanine', 'C4H5NO', '=CH₂', '', { nMethyl: true, isobaricWith: ['Dhb', 'Aze'] }),
  R('Mdhb', 'Mdhb', 'N-Methyldehydrobutyrine', 'C5H7NO', '=CHCH₃', '', { nMethyl: true }),
  R('Bmt', 'Bmt', '(4R)-4-[(E)-2-Butenyl]-4-methyl-L-threonine', 'C9H15NO2', 'CH(OH)CH(CH₃)CH₂CH=CHCH₃', 'C(O)C(C)CC=CC'),
  R('MeBmt', 'MeBmt', 'N-Methyl-Bmt', 'C10H17NO2', 'CH(OH)CH(CH₃)CH₂CH=CHCH₃', 'C(O)C(C)CC=CC', { nMethyl: true }),
  R('Adda', 'Adda', 'Adda (microcystin β-amino acid)', 'C20H27NO2', 'Adda side chain', ''),
  R('Hty', 'Hty', 'Homotyrosine', 'C10H11NO2', '(CH₂)₂C₆H₄OH', 'CCc1ccc(O)cc1'),
  R('Hil', 'Hil', 'Homoisoleucine', 'C7H13NO', 'CH₂CH(CH₃)C₂H₅', 'CC(C)CC'),
  R('S5', 'S5', '(S)-2-(4-Pentenyl)alanine (staple)', 'C8H13NO', '(CH₂)₃CH=CH₂', 'CCCC=C', { alphaMethyl: true, isobaricWith: ['MeCpg'] }),
  R('R8', 'R8', '(R)-2-(7-Octenyl)alanine (staple)', 'C11H19NO', '(CH₂)₆CH=CH₂', 'CCCCCCC=C', { alphaMethyl: true }),
  R('MeDhF', 'MeDhF', 'N-Methyl-dehydrophenylalanine', 'C10H9NO', '=CHPh', '', { nMethyl: true }),
  R('pY', 'pTyr', 'Phosphotyrosine', 'C9H10NO5P', 'CH₂C₆H₄OPO₃H₂', 'Cc1ccc(OP(=O)(O)O)cc1'),
  R('pT', 'pThr', 'Phosphothreonine', 'C4H8NO5P', 'CH(OPO₃H₂)CH₃', 'C(OP(=O)(O)O)C'),
  R('pS', 'pSer', 'Phosphoserine', 'C3H6NO5P', 'CH₂OPO₃H₂', 'COP(=O)(O)O'),
  R('Ac5c', 'Ac5c', '1-Aminocyclopentane-1-carboxylic acid', 'C6H9NO', 'c-C₄H₈', '', { alphaMethyl: true }),
  R('hPheF5', 'hPheF5', 'homoPhe(3,5-F₂-4-CF₃)', 'C11H8F5NO', '(CH₂)₂C₆H₂F₂CF₃', 'CCc1cc(F)c(C(F)(F)F)c(F)c1'),
  R('EtPhe4Me', 'EtPhe4Me', 'N-Ethyl-4-methylphenylalanine', 'C12H15NO', 'CH₂C₆H₄CH₃ (N-Et)', 'Cc1ccc(C)cc1'),
  R('Aze', 'Aze', 'Azetidine-2-carboxylic acid', 'C4H5NO', '(CH₂)₂', 'CC', { ringToN: true, isobaricWith: ['Dhb', 'Mdha'] }),
  R('MeAspNMe2', 'MeAspNMe2', 'N-Me-Asp β-dimethylamide', 'C7H12N2O2', 'CH₂CON(CH₃)₂', 'CC(=O)N(C)C', { nMethyl: true }),
  R('MeCpg', 'MeCpg', 'N-Methylcyclopentylglycine', 'C8H13NO', 'c-C₅H₉', 'C1CCCC1', { nMethyl: true, isobaricWith: ['S5'] }),
  // Hydroxy-acid "residues" of depsipeptides (ester-linked: −O− replaces −NH−).
  R('Hiv', 'Hiv', '2-Hydroxyisovaleric acid', 'C5H8O2', 'CH(CH₃)₂', 'C(C)C', { ester: true }),
  R('Lac', 'Lac', 'Lactic acid', 'C3H4O2', 'CH₃', 'C', { ester: true }),
  R('HMOA', 'HMOA', '3-Hydroxy-4-methyloctanoic acid', 'C9H16O2', '3-OH-4-Me-octanoyl', '', { ester: true }),
  R('bHFA13', 'bHFA13', 'β-Hydroxy C13 fatty acid', 'C13H24O2', 'β-OH-C13 acyl', '', { ester: true }),
  R('bHFA14', 'bHFA14', 'β-Hydroxy C14 fatty acid', 'C14H26O2', 'β-OH-C14 acyl', '', { ester: true }),
  R('bHFA15', 'bHFA15', 'β-Hydroxy C15 fatty acid', 'C15H28O2', 'β-OH-C15 acyl', '', { ester: true }),
];
/** Aliases from other notations (cycfrag uses [MeG] for sarcosine and [pE] for pyroglutamate). */
export const RESIDUE_ALIASES: Record<string, string> = { MeG: 'Sar', pE: 'pGlu', Pyr: 'pGlu', pGlu: 'pGlu' };

export const RESIDUES: Record<string, ResidueDef> = Object.fromEntries([...STANDARD, ...NONSTANDARD].map((r) => [r.code, r]));
export const STANDARD_CODES = STANDARD.map((r) => r.code);

const BY_THREE: Record<string, ResidueDef> = Object.fromEntries([...STANDARD, ...NONSTANDARD].map((r) => [r.three.toLowerCase(), r]));

/**
 * Resolve a residue token: one letter ("F"), lowercase one letter = D-enantiomer ("f"), three-letter or
 * short name ("Phe", "Orn"), with optional "D-" prefix and "Me"/"N-Me-" prefix for N-methylation
 * ("MeLeu", "N-Me-Leu"). Returns the definition plus stereo/N-methyl flags.
 */
export function resolveResidue(token: string): { def: ResidueDef; dForm: boolean; nMethyl: boolean } | null {
  let t = token.trim();
  let dForm = false, nMethyl = false;
  const exact = RESIDUES[t] ?? RESIDUES[RESIDUE_ALIASES[t] ?? ''];
  if (exact && t.length > 1) return { def: exact, dForm: false, nMethyl: false };
  if (/^[a-z]$/.test(t) && RESIDUES[t.toUpperCase()]) return { def: RESIDUES[t.toUpperCase()], dForm: t !== 'g', nMethyl: false };
  if (/^D-/i.test(t)) { dForm = true; t = t.slice(2); }
  else if (/^L-/i.test(t)) t = t.slice(2);
  if (/^N-?Me-?/i.test(t)) { nMethyl = true; t = t.replace(/^N-?Me-?/i, ''); }
  else if (/^Me(?=[A-Z])/.test(t)) { nMethyl = true; t = t.slice(2); }
  if (/^D-/i.test(t)) { dForm = true; t = t.slice(2); }
  t = RESIDUE_ALIASES[t] ?? t;
  const def = RESIDUES[t] ?? RESIDUES[t.toUpperCase().length === 1 ? t.toUpperCase() : ''] ?? BY_THREE[t.toLowerCase()];
  if (!def) return null;
  return { def, dForm, nMethyl };
}
