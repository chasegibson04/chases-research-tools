// Theoretical fragment ions for linear and head-to-tail cyclic peptides.
// Ion definitions follow Roepstorff–Fohlman/Biemann nomenclature with Mascot's neutral-formula conventions:
//   prefix P = Σ residues(1..i) + N-term mods  → b = P, a = P − CO, c = P + NH3, c−1 = P + NH2
//   suffix S = Σ residues(j..n) + C-term mods  → y = S + H2O, x = S + CO2, z = S + O − NH (y − NH3), z• = y − NH2, z+2 = z• + H
// m/z = (neutral + z·carrier) / z. Cyclic: contiguous b/a-type fragments of every ring opening (no y ions exist).
import { addFormula, monoMass, formatFormula, PROTON, CARRIERS, type Formula } from './elements';
import type { Peptide, Residue } from './sequence';

export type IonType = 'a' | 'b' | 'c' | 'c-1' | 'x' | 'y' | 'z' | 'z•' | 'z+1' | 'z+2' | 'cz•' | 'cz+1' | 'immonium' | 'internal-b' | 'internal-a' | 'precursor' | 'b+H2O';
/** Cyclic ETD-type arc ions (offsets relative to Σ residues, as in cycfrag/fragments.py). */
export const CYCLIC_ETD_TYPES: IonType[] = ['cz•', 'cz+1', 'c', 'c-1', 'z•', 'z+1'];
export const N_TERM_TYPES: IonType[] = ['a', 'b', 'c', 'c-1'];
export const C_TERM_TYPES: IonType[] = ['x', 'y', 'z', 'z•', 'z+2'];

const F = (o: Formula) => o;
const ION_DELTA: Record<string, Formula> = {
  a: F({ C: -1, O: -1 }), b: {}, c: F({ N: 1, H: 3 }), 'c-1': F({ N: 1, H: 2 }),
  y: F({ H: 2, O: 1 }), x: F({ C: 1, O: 2 }), z: F({ H: -1, N: -1, O: 1 }), 'z•': F({ N: -1, O: 1 }), 'z+2': F({ H: 1, N: -1, O: 1 }),
  'internal-b': {}, 'internal-a': F({ C: -1, O: -1 }), 'b+H2O': F({ H: 2, O: 1 }),
};
const CYCLIC_ETD_DELTA: Record<string, Formula> = { 'cz•': { H: 1 }, 'cz+1': { H: 2 }, c: { N: 1, H: 3 }, 'c-1': { N: 1, H: 2 }, 'z•': { N: -1 }, 'z+1': { N: -1, H: 1 } };
/** Complementary ion type (same cleavage, other side). */
// ETD pairs: c′ + z• and c• (c−1) + z′ (z+2) each sum to [M+H]. The even-electron "z" (y − NH3) is paired with c by convention.
export const COMPLEMENT: Partial<Record<IonType, IonType>> = { a: 'x', b: 'y', c: 'z•', 'c-1': 'z+2', x: 'a', y: 'b', z: 'c', 'z•': 'c', 'z+2': 'c-1' };

export interface Loss { name: string; formula: Formula }
export const LOSS_H2O: Loss = { name: 'H₂O', formula: { H: 2, O: 1 } };
export const LOSS_NH3: Loss = { name: 'NH₃', formula: { N: 1, H: 3 } };
export const LOSS_CO: Loss = { name: 'CO', formula: { C: 1, O: 1 } };
const H2O_RES = new Set(['S', 'T', 'E', 'D']);
const NH3_RES = new Set(['R', 'K', 'Q', 'N']);

export interface FragmentOptions {
  ionTypes: IonType[];
  /** Highest fragment charge; capped at precursorCharge. */
  maxCharge: number;
  precursorCharge: number;
  losses: { h2o: boolean; nh3: boolean; mod: boolean; maxLosses: number; anyResidue?: boolean };
  /** Extra charge carriers besides H⁺, e.g. ['Na'] produces [b+Na]⁺ variants. */
  adducts?: string[];
  immonium?: boolean;
  internal?: { enabled: boolean; maxLength: number };
  precursor?: boolean;
  /** Cyclic only: also generate b+H2O ions (ring opened by hydrolysis; common for depsipeptides). */
  cyclicHydrolysis?: boolean;
}

export interface Ion {
  id: string;
  type: IonType;
  /** Number of residues in the fragment. */
  size: number;
  /** First and last residue index (0-based, inclusive). For cyclic fragments `end` may wrap past n. */
  start: number;
  end: number;
  charge: number;
  carrier: string; // 'H' or adduct key
  loss: string | null;
  mz: number;
  neutral: number;
  formula: string;
  /** Residue tokens covered, in order. */
  seq: string;
  label: string;
  /** Backbone bonds broken to form this ion (see bondIndex). One for linear terminal ions, two for internal/cyclic. */
  bonds: number[];
  /** All alternative ring openings giving the same fragment (cyclic): [start, end] pairs. */
  origins?: Array<[number, number]>;
  /** Id of the complementary ion (linear terminal ions, same charge and carrier). */
  pair?: string;
}

/**
 * Backbone bonds are numbered along the chain: residue k contributes bonds 3k (N–Cα), 3k+1 (Cα–C) and 3k+2 (C–N to residue k+1).
 * So the b/y cleavage after residue i (0-based) is 3i+2, a/x is 3i+1 and c/z is 3(i+1).
 */
export const bondIndex = { aX: (i: number) => 3 * i + 1, bY: (i: number) => 3 * i + 2, cZ: (i: number) => 3 * (i + 1) };

const SUP: Record<string, string> = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺' };
const SUB: Record<string, string> = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
export const sup = (s: string) => [...s].map((c) => SUP[c] ?? c).join('');
export const sub = (s: string) => [...s].map((c) => SUB[c] ?? c).join('');
export const chargeLabel = (z: number) => (z === 1 ? '⁺' : sup(`${z}+`));

function residueSum(res: Residue[]): { formula: Formula; delta: number } {
  let formula: Formula = {}; let delta = 0;
  for (const r of res) { formula = addFormula(formula, r.formula); delta += r.massDelta; }
  return { formula, delta };
}
const modSum = (mods: Peptide['nTermMods']) => mods.reduce((acc, m) => ({ formula: m.formula ? addFormula(acc.formula, m.formula) : acc.formula, delta: acc.delta + (m.formula ? 0 : m.mass) }), { formula: {} as Formula, delta: 0 });

/** Neutral monoisotopic mass of the peptide (linear: + H2O; cyclic: residues only). */
export function peptideMass(p: Peptide): { mono: number; formula: Formula } {
  const r = residueSum(p.residues);
  if (p.cyclic) return { mono: monoMass(r.formula) + r.delta, formula: r.formula };
  const n = modSum(p.nTermMods), c = modSum(p.cTermMods);
  const formula = addFormula(addFormula(addFormula(r.formula, n.formula), c.formula), { H: 2, O: 1 });
  return { mono: monoMass(formula) + r.delta + n.delta + c.delta, formula };
}

function availableLosses(res: Residue[], o: FragmentOptions['losses']): Loss[] {
  const out: Loss[] = [];
  if (o.h2o && (o.anyResidue || res.some((r) => H2O_RES.has(r.def.code)))) out.push(LOSS_H2O);
  if (o.nh3 && (o.anyResidue || res.some((r) => NH3_RES.has(r.def.code)))) out.push(LOSS_NH3);
  if (o.mod) for (const r of res) for (const m of r.mods) if (m.loss && !out.some((l) => l.name === m.loss!.name)) out.push({ name: m.loss.name, formula: m.loss.formula });
  return out;
}
/** Loss combinations up to maxLosses. H2O and NH3 may repeat (b−2H2O, b−H2O−NH3); modification losses occur once. */
function lossCombos(losses: Loss[], max: number): Array<Loss[]> {
  const combos: Array<Loss[]> = [[]];
  const rec = (start: number, cur: Loss[]) => {
    if (cur.length >= max) return;
    for (let k = start; k < losses.length; k++) {
      const repeatable = losses[k] === LOSS_H2O || losses[k] === LOSS_NH3;
      const next = [...cur, losses[k]]; combos.push(next); rec(repeatable ? k : k + 1, next);
    }
  };
  rec(0, []);
  return combos;
}
const lossLabel = (combo: Loss[]) => {
  const counts = new Map<string, number>();
  for (const l of combo) counts.set(l.name, (counts.get(l.name) ?? 0) + 1);
  return [...counts].map(([n, c]) => `${c > 1 ? c : ''}${n}`).join('−');
};

interface Emit { type: IonType; size: number; start: number; end: number; base: Formula; baseDelta: number; residues: Residue[]; bonds: number[]; labelCore: string; seq: string }

export function generateFragments(p: Peptide, opts: FragmentOptions): Ion[] {
  const n = p.residues.length;
  const types = new Set(opts.ionTypes);
  const zMax = Math.max(1, Math.min(opts.maxCharge, opts.precursorCharge));
  const carriers = ['H', ...(opts.adducts ?? []).filter((a) => a !== 'H' && CARRIERS[a])];
  const ions: Ion[] = [];
  const emitted = new Map<string, Ion>();

  const push = (e: Emit, allowLosses = true) => {
    const losses = allowLosses ? lossCombos(availableLosses(e.residues, opts.losses), Math.max(0, opts.losses.maxLosses)) : [[]];
    for (const combo of losses) {
      let f = e.base;
      for (const l of combo) f = addFormula(f, l.formula, -1);
      const neutral = monoMass(f) + e.baseDelta;
      const lossName = combo.length ? lossLabel(combo) : null;
      for (const carrier of carriers) {
        for (let z = 1; z <= zMax; z++) {
          // Adduct ions carry one metal cation plus (z−1) protons.
          const cm = carrier === 'H' ? z * PROTON : CARRIERS[carrier].mass + (z - 1) * PROTON;
          const mz = (neutral + cm) / z;
          if (mz < 30) continue;
          const lossTxt = lossName ? `−${lossName}` : '';
          const carrierTxt = carrier === 'H' ? '' : `+${carrier}`;
          const label = `${e.labelCore}${lossTxt}${carrierTxt}${z > 1 ? sup(`${z}+`) : ''}`;
          const id = `${e.type}|${e.start}|${e.size}|${lossName ?? ''}|${carrier}|${z}`;
          const ion: Ion = {
            id, type: e.type, size: e.size, start: e.start, end: e.end, charge: z, carrier, loss: lossName, mz, neutral,
            formula: formatFormula(addFormula(f, carrier === 'H' ? { H: z } : addFormula(CARRIERS[carrier].formula, { H: z - 1 }))),
            seq: e.seq, label, bonds: e.bonds,
          };
          if (p.cyclic) {
            // Deduplicate identical fragments arising from different ring openings.
            const key = `${e.type}|${e.seq}|${lossName ?? ''}|${carrier}|${z}`;
            const prev = emitted.get(key);
            if (prev) { prev.origins!.push([e.start, e.end]); continue; }
            ion.origins = [[e.start, e.end]];
            emitted.set(key, ion);
          }
          ions.push(ion);
        }
      }
    }
  };

  const tok = (rs: Residue[]) => rs.map((r) => r.token).join(p.cyclic ? '-' : '');

  if (!p.cyclic) {
    const nt = modSum(p.nTermMods), ct = modSum(p.cTermMods);
    for (let i = 1; i < n; i++) {
      const pre = p.residues.slice(0, i), suf = p.residues.slice(i);
      const P = residueSum(pre), S = residueSum(suf);
      const pf = addFormula(P.formula, nt.formula), pd = P.delta + nt.delta;
      const sf = addFormula(S.formula, ct.formula), sd = S.delta + ct.delta;
      const k = i - 1; // index of last prefix residue
      for (const t of N_TERM_TYPES) if (types.has(t)) {
        const bond = t === 'a' ? bondIndex.aX(k) : t === 'b' ? bondIndex.bY(k) : bondIndex.cZ(k);
        if ((t === 'c' || t === 'c-1') && suf[0].def.ringToN) continue; // no c/z N-terminal to Pro (ring bond)
        push({ type: t, size: i, start: 0, end: k, base: addFormula(pf, ION_DELTA[t]), baseDelta: pd, residues: pre, bonds: [bond], labelCore: `${t === 'c-1' ? 'c' : t}${sub(String(i))}${t === 'c-1' ? '−1' : ''}`, seq: tok(pre) });
      }
      const j = n - i;
      for (const t of C_TERM_TYPES) if (types.has(t)) {
        const bond = t === 'x' ? bondIndex.aX(k) : t === 'y' ? bondIndex.bY(k) : bondIndex.cZ(k);
        if (t.startsWith('z') && suf[0].def.ringToN) continue;
        const core = t === 'z•' ? `z${sub(String(j))}•` : t === 'z+2' ? `z${sub(String(j))}+2` : `${t}${sub(String(j))}`;
        push({ type: t, size: j, start: i, end: n - 1, base: addFormula(sf, ION_DELTA[t]), baseDelta: sd, residues: suf, bonds: [bond], labelCore: core, seq: tok(suf) });
      }
    }
    // Pair complementary terminal ions (same charge/carrier, no losses on either side).
    const byId = new Map(ions.map((ion) => [ion.id, ion]));
    for (const ion of ions) {
      const other = COMPLEMENT[ion.type];
      if (!other || ion.loss) continue;
      const isN = N_TERM_TYPES.includes(ion.type);
      const start = isN ? ion.size : 0, size = n - ion.size;
      const m = byId.get(`${other}|${start}|${size}||${ion.carrier}|${ion.charge}`);
      if (m) ion.pair = m.id;
    }
    if (opts.internal?.enabled) {
      const maxL = Math.max(2, opts.internal.maxLength);
      for (let s = 1; s < n - 1; s++) for (let e = s + 1; e < Math.min(n - 1, s + maxL); e++) {
        const rs = p.residues.slice(s, e + 1), R = residueSum(rs);
        const bonds = [bondIndex.bY(s - 1), bondIndex.bY(e)];
        if (types.has('b') || types.has('internal-b')) push({ type: 'internal-b', size: rs.length, start: s, end: e, base: R.formula, baseDelta: R.delta, residues: rs, bonds, labelCore: `[${tok(rs)}]`, seq: tok(rs) });
        if (types.has('a') || types.has('internal-a')) push({ type: 'internal-a', size: rs.length, start: s, end: e, base: addFormula(R.formula, ION_DELTA['internal-a']), baseDelta: R.delta, residues: rs, bonds: [bondIndex.bY(s - 1), bondIndex.aX(e)], labelCore: `[${tok(rs)}]−CO`, seq: tok(rs) }, false);
      }
    }
  } else {
    // Ring opening at the amide bond before residue s, second cleavage after residue s+L−1.
    for (let L = 1; L < n; L++) for (let s = 0; s < n; s++) {
      const rs = Array.from({ length: L }, (_, k) => p.residues[(s + k) % n]);
      const R = residueSum(rs);
      const e = s + L - 1;
      const before = bondIndex.bY((s - 1 + n) % n), after = bondIndex.bY(e % n);
      const seq = tok(rs);
      const core = (t: string) => `${t}${sub(String(L))}`;
      if (types.has('b')) push({ type: 'b', size: L, start: s, end: e, base: R.formula, baseDelta: R.delta, residues: rs, bonds: [before, after], labelCore: core('b'), seq });
      if (types.has('a')) push({ type: 'a', size: L, start: s, end: e, base: addFormula(R.formula, ION_DELTA.a), baseDelta: R.delta, residues: rs, bonds: [before, bondIndex.aX(e % n)], labelCore: core('a'), seq });
      for (const t of CYCLIC_ETD_TYPES) if (types.has(t)) {
        const nCut = t === 'c' || t === 'c-1' ? before : 3 * (s % n); // N–Cα of the first residue for z•/cz types
        const cCut = t === 'z•' || t === 'z+1' ? after : bondIndex.cZ(e % n) % (3 * n);
        const core = t === 'cz•' ? `cz${sub(String(L))}•` : t === 'cz+1' ? `cz${sub(String(L))}+1` : t === 'z•' ? `z${sub(String(L))}•` : t === 'c-1' ? `c${sub(String(L))}−1` : `${t.replace('+1', '')}${sub(String(L))}${t.endsWith('+1') ? '+1' : ''}`;
        push({ type: t, size: L, start: s, end: e, base: addFormula(R.formula, CYCLIC_ETD_DELTA[t]), baseDelta: R.delta, residues: rs, bonds: [nCut, cCut], labelCore: core, seq }, t === 'c' || t === 'cz+1');
      }
      if (opts.cyclicHydrolysis) push({ type: 'b+H2O', size: L, start: s, end: e, base: addFormula(R.formula, ION_DELTA['b+H2O']), baseDelta: R.delta, residues: rs, bonds: [before, after], labelCore: `${core('b')}+H₂O`, seq }, false);
    }
  }

  if (opts.immonium) {
    const seen = new Set<string>();
    p.residues.forEach((r, k) => {
      const key = r.token + r.mods.map((m) => m.name).join();
      if (seen.has(key)) return; seen.add(key);
      const f = addFormula(addFormula(r.formula, { C: -1, O: -1 }), { H: 1 });
      const mz = monoMass(f) + r.massDelta - 1.00782503223 + PROTON;
      ions.push({ id: `imm|${key}`, type: 'immonium', size: 1, start: k, end: k, charge: 1, carrier: 'H', loss: null, mz, neutral: mz - PROTON, formula: formatFormula(f), seq: r.token, label: `Im(${r.token})`, bonds: [] });
    });
  }

  if (opts.precursor) {
    const { mono, formula } = peptideMass(p);
    const all = p.residues;
    const precLosses = lossCombos(availableLosses(all, opts.losses), Math.max(1, opts.losses.maxLosses));
    for (const combo of precLosses) {
      let f = formula; for (const l of combo) f = addFormula(f, l.formula, -1);
      const neutral = mono - combo.reduce((m, l) => m + monoMass(l.formula), 0);
      for (const carrier of carriers) for (let z = 1; z <= opts.precursorCharge; z++) {
        const cm = carrier === 'H' ? z * PROTON : CARRIERS[carrier].mass + (z - 1) * PROTON;
        const lossName = combo.length ? lossLabel(combo) : null;
        ions.push({
          id: `prec|${lossName ?? ''}|${carrier}|${z}`, type: 'precursor', size: n, start: 0, end: n - 1, charge: z, carrier, loss: lossName,
          mz: (neutral + cm) / z, neutral, formula: formatFormula(f), seq: tok(all),
          label: `[M+${carrier === 'H' ? (z > 1 ? `${z}H` : 'H') : `${carrier}${z > 1 ? `+${z - 1}H` : ''}`}]${z > 1 ? sup(`${z}+`) : '⁺'}${lossName ? `−${lossName}` : ''}`, bonds: [],
        });
      }
    }
  }
  return ions.sort((a, b) => a.mz - b.mz);
}
