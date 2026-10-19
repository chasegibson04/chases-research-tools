// Peptide sequence parsing: a ProForma 2.0 subset plus the notations used for cyclic/nonribosomal peptides.
//   PEPTIDE                         one-letter, uppercase = L-residue, lowercase = D-residue (e.g. RGDfV)
//   PEPM[Oxidation]S[+79.9663]K     residue modifications by Unimod name / alias / U:id, mass delta, or Formula:…
//   [Acetyl]-PEPTIDE-[Amidated]     N- and C-terminal modifications (linear only)
//   G(Orn)L(MeLeu)(D-Phe)           non-standard residues in parentheses (see residues.ts)
//   cyclo(RGDfV) / cyclo(-Arg-Gly-Asp-D-Phe-Val-)   head-to-tail cyclic
import { addFormula, monoMass, type Formula } from './elements';
import { RESIDUES, resolveResidue, type ResidueDef } from './residues';
import { resolveMod, type AppliedMod } from './mods';

export interface Residue {
  def: ResidueDef;
  /** Display token: one letter, or the short name for non-standard residues. */
  token: string;
  dForm: boolean;
  nMethyl: boolean;
  mods: AppliedMod[];
  formula: Formula; // residue + mods (elements only; pure mass deltas are in massDelta)
  massDelta: number; // mass from mods with no known composition
  mass: number; // monoisotopic residue mass including all mods
}

export interface Peptide {
  residues: Residue[];
  cyclic: boolean;
  nTermMods: AppliedMod[];
  cTermMods: AppliedMod[];
  /** Canonical string (ProForma-like) for labels and file names. */
  text: string;
}

export interface FixedMod { mod: string; residues: string[] }

const N_METHYL: Formula = { C: 1, H: 2 };

function makeResidue(token: string, mods: AppliedMod[] = []): Residue {
  const r = resolveResidue(token);
  if (!r) throw new Error(`Unknown residue "${token}". Use one-letter codes, or names in parentheses such as (Orn), (Aib), (MeLeu), (D-Phe).`);
  let formula = r.def.formula;
  if (r.nMethyl && !r.def.nMethyl) formula = addFormula(formula, N_METHYL);
  let massDelta = 0;
  for (const m of mods) { if (m.formula) formula = addFormula(formula, m.formula); else massDelta += m.mass; }
  const display = r.def.code.length === 1 ? (r.dForm ? r.def.code.toLowerCase() : r.def.code) : r.def.code;
  return {
    def: r.def, token: (r.nMethyl && !r.def.nMethyl ? 'Me' : '') + (r.dForm && r.def.code.length > 1 ? 'D-' : '') + display,
    dForm: r.dForm, nMethyl: r.nMethyl || !!r.def.nMethyl, mods, formula, massDelta, mass: monoMass(formula) + massDelta,
  };
}

/** Recompute a residue's composition after adding a modification. */
export function withMod(res: Residue, mod: AppliedMod): Residue {
  const mods = [...res.mods, mod];
  const formula = mod.formula ? addFormula(res.formula, mod.formula) : res.formula;
  const massDelta = res.massDelta + (mod.formula ? 0 : mod.mass);
  return { ...res, mods, formula, massDelta, mass: monoMass(formula) + massDelta };
}

/** "[Orn]" style residue tokens (cycfrag notation): the bracket names a residue and is not a modification. */
function isResidueBracket(body: string) {
  if (!resolveResidue(body) || body.length < 2) return false;
  try { resolveMod(body); return false; } catch { return true; }
}

function readBracket(s: string, i: number, open: string, close: string): [string, number] {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === open) depth++;
    else if (s[j] === close && --depth === 0) return [s.slice(i + 1, j), j + 1];
  }
  throw new Error(`Unclosed "${open}" in sequence.`);
}

/** "Arg-Gly-Asp-D-Phe-Val" → tokens, keeping the "D-" / "N-Me-" prefixes attached. */
function splitThreeLetter(body: string): string[] {
  const parts = body.split('-').filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    let p = parts[i];
    while ((/^(D|L)$/i.test(p) || /^N$/i.test(p) || /^Me$/i.test(p) || /^N-?Me$/i.test(p)) && i + 1 < parts.length) p = `${p}-${parts[++i]}`;
    out.push(p);
  }
  return out;
}

const SUBSCRIPT = '₀₁₂₃₄₅₆₇₈₉';
/**
 * Turn the notations people paste into the dash form the parser reads: arrows (MAA→7W2→…), commas, slashes and spaces
 * between residue names, position subscripts (MAA_{1}, MAA₁), and cyclo[…] / cyclo{…} / cyclic(…) wrappers.
 * Brackets and parentheses are left alone, so "[Gln->pyro-Glu]" keeps its text.
 */
export function normalizeSequenceText(input: string): string {
  let t = input.trim().replace(/\text\{([^}]*)\}/g, '$1').replace(/^\s*cyclic/i, 'cyclo');
  const m = /^cyclo\s*[([{](.*)[)\]}]\s*$/is.exec(t);
  const wrap = !!m;
  if (m) t = m[1];
  // split on separators at bracket depth 0
  const parts: string[] = [];
  let depth = 0, cur = '';
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if ('[('.includes(ch)) depth++;
    else if (')]'.includes(ch)) depth = Math.max(0, depth - 1);
    const arrow = depth === 0 && (ch === '→' || ch === '⟶' || (ch === '-' && t[i + 1] === '>'));
    if (depth === 0 && (/[\s,;|/·•]/.test(ch) || arrow)) { if (ch === '-') i++; parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  const cleaned = parts.map((x) => x.replace(/_\{?\d+\}?/g, '').replace(new RegExp(`[${SUBSCRIPT}]+$`), '')).filter(Boolean);
  // several residue names separated by spaces/commas/arrows: join them with dashes
  const single = (x: string) => !!x && !/[[\]()]/.test(x) && (x.length === 1 ? /[A-Za-z]/.test(x) : !!resolveResidue(x));
  const bracketed = (x: string) => /^[([]/.test(x);
  const joined = cleaned.length > 1 && cleaned.every((x) => single(x) || bracketed(x)) ? cleaned.join('-') : cleaned.join('');
  return wrap ? `cyclo(${joined})` : joined;
}

export function parseSequence(input: string, opts: { cyclic?: boolean; fixedMods?: FixedMod[] } = {}): Peptide {
  let s = normalizeSequenceText(input);
  if (!s) throw new Error('Enter a peptide sequence.');
  let cyclic = !!opts.cyclic;
  const cyc = /^cyclo\((.*)\)$/i.exec(s);
  if (cyc) { cyclic = true; s = cyc[1].replace(/^-|-$/g, ''); }
  // Dash-separated residue names (Maa-W2-Vn-Sar, possibly mixed with (Orn) / [MeL] tokens): read whole names, not letters.
  const dashNames = /[A-Za-z0-9)\]]-[A-Za-z0-9([]/.test(s.replace(/\[[^\]]*\]-/g, '[]|').replace(/-\[[^\]]*\]$/, ''));

  const residues: Residue[] = [];
  const nTermMods: AppliedMod[] = [];
  const cTermMods: AppliedMod[] = [];

  // Three-letter dash notation: every token is ≥ 3 letters (allowing D-/Me- prefixes) and there are no brackets.
  if (s.includes('-') && !/[[\]()]/.test(s) && splitThreeLetter(s).every((t) => resolveResidue(t) && t.replace(/^(D-|L-|N-?Me-?|Me)/i, '').length >= 3)) {
    for (const t of splitThreeLetter(s)) residues.push(makeResidue(t));
  } else {
    let i = 0;
    // N-terminal modifications: one or more [..] followed by '-'
    while (s[i] === '[') {
      const [body, j] = readBracket(s, i, '[', ']');
      if (s[j] !== '-') break;
      nTermMods.push(resolveMod(body)); i = j + 1;
    }
    while (i < s.length) {
      const ch = s[i];
      if (ch === '-' && s[i + 1] === '[') { // C-terminal modification(s)
        i++;
        while (s[i] === '[') { const [body, j] = readBracket(s, i, '[', ']'); cTermMods.push(resolveMod(body)); i = j; }
        if (i < s.length) throw new Error('Nothing may follow a C-terminal modification.');
        break;
      }
      let token: string;
      if (ch === '(') { const [body, j] = readBracket(s, i, '(', ')'); token = body; i = j; }
      else if (ch === '[') {
        const [body, j] = readBracket(s, i, '[', ']');
        if (!isResidueBracket(body)) throw new Error(`Modification [${body}] must follow a residue (or start the sequence as "[${body}]-").`);
        token = body; i = j;
      }
      else if (ch === '-' && dashNames) { i++; continue; }
      else if (dashNames && /[A-Za-z0-9]/.test(ch)) {
        const run = /^[A-Za-z0-9]+/.exec(s.slice(i))![0];
        if (run.length > 1 && !resolveResidue(run)) throw new Error(`Unknown residue "${run}". Use one-letter codes, or names such as Orn, MeLeu, D-Phe, or PDB-style codes such as Maa, 7W2, Mle.`);
        token = run; i += run.length;
      }
      else if (/[A-Za-z]/.test(ch)) { token = ch; i++; }
      else if (/[0-9.]/.test(ch)) { i++; continue; } // ignore stray numbering
      else throw new Error(`Unexpected character "${ch}" in sequence.`);
      const mods: AppliedMod[] = [];
      while (s[i] === '[') {
        const [body, j] = readBracket(s, i, '[', ']');
        if (isResidueBracket(body)) break; // next residue, e.g. A[Orn]
        mods.push(resolveMod(body)); i = j;
      }
      let res = makeResidue(token);
      for (const m of mods) res = withMod(res, m.name === 'Oxidation' && res.def.code !== 'M' ? { ...m, loss: undefined } : m);
      residues.push(res);
    }
  }
  if (!residues.length) throw new Error('No residues found in the sequence.');
  if (residues.length > 300) throw new Error('Sequence too long (max 300 residues).');
  if (cyclic && residues.length < 2) throw new Error('A cyclic peptide needs at least 2 residues.');
  if (cyclic && (nTermMods.length || cTermMods.length)) throw new Error('Head-to-tail cyclic peptides have no termini; remove the terminal modifications.');

  for (const fm of opts.fixedMods ?? []) {
    const mod = resolveMod(fm.mod);
    const targets = new Set(fm.residues.map((r) => r.toUpperCase()));
    if (targets.has('N-TERM') && !cyclic && !nTermMods.length) nTermMods.push(mod);
    if (targets.has('C-TERM') && !cyclic && !cTermMods.length) cTermMods.push(mod);
    residues.forEach((r, k) => { if (targets.has(r.def.code.toUpperCase()) && !r.mods.some((m) => m.name === mod.name)) residues[k] = withMod(r, mod); });
  }

  const tokenText = (r: Residue) => (r.token.length === 1 ? r.token : `(${r.token})`) + r.mods.map((m) => `[${m.label}]`).join('');
  const body = residues.map(tokenText).join('');
  const text = cyclic ? `cyclo(${body})` : `${nTermMods.map((m) => `[${m.label}]-`).join('')}${body}${cTermMods.map((m) => `-[${m.label}]`).join('')}`;
  return { residues, cyclic, nTermMods, cTermMods, text };
}

export const residueList = () => Object.values(RESIDUES);
