// Matching observed peaks to theoretical ions, isotope-peak recognition, coverage statistics, and Δm → residue lookup.
import { NEUTRON, monoMass, parseFormula } from './elements';
import { RESIDUES, STANDARD_CODES } from './residues';
import type { Ion } from './fragments';

export interface Peak { mz: number; intensity: number }
export interface Tolerance { value: number; unit: 'ppm' | 'Da' }

export const tolDa = (mz: number, t: Tolerance) => (t.unit === 'ppm' ? (mz * t.value) / 1e6 : t.value);
export const ppmError = (obs: number, theo: number) => ((obs - theo) / theo) * 1e6;

/** Index of the first element with value ≥ x in a sorted numeric accessor. */
export function lowerBound(n: number, get: (i: number) => number, x: number) {
  let lo = 0, hi = n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (get(mid) < x) lo = mid + 1; else hi = mid; }
  return lo;
}

export interface Match { ion: Ion; peak: number; obs: number; errorPpm: number; errorDa: number; intensity: number }
export interface MatchResult {
  /** Best match per ion id (most intense peak within tolerance; ties → smallest error). */
  byIon: Map<string, Match>;
  /** All candidate ions per peak index, best (smallest |error|) first. */
  byPeak: Map<number, Match[]>;
  /** Peak index → index of the monoisotopic peak it is an isotope of (13C envelope of an annotated peak). */
  isotopeOf: Map<number, number>;
}

/** peaks must be sorted by m/z. */
export function matchPeaks(peaks: Peak[], ions: Ion[], tol: Tolerance, opts: { minRelIntensity?: number } = {}): MatchResult {
  const byIon = new Map<string, Match>();
  const byPeak = new Map<number, Match[]>();
  const maxI = peaks.reduce((m, p) => Math.max(m, p.intensity), 0) || 1;
  const minI = (opts.minRelIntensity ?? 0) * maxI;
  for (const ion of ions) {
    const d = tolDa(ion.mz, tol);
    let k = lowerBound(peaks.length, (i) => peaks[i].mz, ion.mz - d);
    let best: Match | undefined;
    for (; k < peaks.length && peaks[k].mz <= ion.mz + d; k++) {
      const pk = peaks[k];
      if (pk.intensity < minI) continue;
      const m: Match = { ion, peak: k, obs: pk.mz, errorDa: pk.mz - ion.mz, errorPpm: ppmError(pk.mz, ion.mz), intensity: pk.intensity };
      if (!byPeak.has(k)) byPeak.set(k, []);
      byPeak.get(k)!.push(m);
      if (!best || pk.intensity > best.intensity || (pk.intensity === best.intensity && Math.abs(m.errorDa) < Math.abs(best.errorDa))) best = m;
    }
    if (best) byIon.set(ion.id, best);
  }
  for (const list of byPeak.values()) list.sort((a, b) => Math.abs(a.errorPpm) - Math.abs(b.errorPpm) || priority(a.ion) - priority(b.ion));

  // Isotope peaks: M+1, M+2 of an annotated monoisotopic peak at the ion's charge.
  const isotopeOf = new Map<number, number>();
  for (const [k, list] of byPeak) {
    const z = list[0].ion.charge;
    for (let iso = 1; iso <= 3; iso++) {
      const target = peaks[k].mz + (iso * NEUTRON) / z;
      const d = tolDa(target, tol) * 1.5;
      const j = lowerBound(peaks.length, (i) => peaks[i].mz, target - d);
      if (j < peaks.length && Math.abs(peaks[j].mz - target) <= d && !byPeak.has(j) && !isotopeOf.has(j)) isotopeOf.set(j, k); else break;
    }
  }
  return { byIon, byPeak, isotopeOf };
}

/** Prefer backbone ions over losses/internal/immonium when errors tie. */
function priority(ion: Ion) {
  const base = ['b', 'y', 'c', 'z•', 'a', 'x', 'z', 'z+2', 'c-1', 'precursor', 'b+H2O', 'immonium', 'internal-b', 'internal-a'].indexOf(ion.type);
  return base + (ion.loss ? 20 : 0) + (ion.carrier !== 'H' ? 10 : 0) + ion.charge;
}

export interface Coverage {
  annotatedPeaks: number; totalPeaks: number;
  explainedIntensityPct: number;
  /** Backbone cleavage sites (linear: n−1 amide bonds; cyclic: n) supported by at least one backbone ion. */
  sitesObserved: number; sitesTotal: number;
  ionsMatched: number; ionsTotal: number;
}
export function coverage(peaks: Peak[], ions: Ion[], m: MatchResult, residues: number, cyclic: boolean): Coverage {
  const total = peaks.reduce((s, p) => s + p.intensity, 0) || 1;
  let explained = 0;
  for (const k of m.byPeak.keys()) explained += peaks[k].intensity;
  for (const k of m.isotopeOf.keys()) explained += peaks[k].intensity;
  const sites = new Set<number>();
  for (const match of m.byIon.values()) {
    const ion = match.ion;
    if (['immonium', 'precursor'].includes(ion.type)) continue;
    if (cyclic) for (const [s, e] of ion.origins ?? [[ion.start, ion.end]]) { sites.add(((s - 1) % residues + residues) % residues); sites.add(e % residues); }
    else if (!ion.type.startsWith('internal')) sites.add(ion.start === 0 ? ion.end : ion.start - 1);
  }
  return {
    annotatedPeaks: m.byPeak.size + m.isotopeOf.size, totalPeaks: peaks.length,
    explainedIntensityPct: (explained / total) * 100,
    sitesObserved: sites.size, sitesTotal: cyclic ? residues : residues - 1,
    ionsMatched: m.byIon.size, ionsTotal: ions.length,
  };
}

// ---------- Δm lookup (distance between two peaks → residue / dipeptide / loss) ----------

export interface DeltaCandidate { label: string; kind: 'residue' | 'dipeptide' | 'modified' | 'loss'; mass: number; charge: number; errorDa: number; errorPpm: number }

const COMMON_LOSSES: Array<[string, string]> = [['H₂O', 'H2O'], ['NH₃', 'NH3'], ['CO', 'CO'], ['CO₂', 'CO2'], ['H₃PO₄', 'H3PO4'], ['HPO₃', 'HPO3'], ['CH₄SO', 'CH4SO'], ['C₂H₄', 'C2H4'], ['C₃H₆', 'C3H6']];
const MOD_RESIDUES: Array<[string, string, string]> = [['M(ox)', 'M', 'O'], ['S(ph)', 'S', 'HPO3'], ['T(ph)', 'T', 'HPO3'], ['Y(ph)', 'Y', 'HPO3'], ['C(cam)', 'C', 'C2H3NO'], ['K(ac)', 'K', 'C2H2O'], ['K(me)', 'K', 'CH2'], ['K(me2)', 'K', 'C2H4'], ['K(me3)', 'K', 'C3H6'], ['N(deam)', 'N', 'H-1N-1O'], ['Q(deam)', 'Q', 'H-1N-1O'], ['R(me)', 'R', 'CH2']];

let deltaTable: Array<{ label: string; kind: DeltaCandidate['kind']; mass: number }> | null = null;
function buildDeltaTable(extra: Array<{ label: string; mass: number }> = []) {
  const t: Array<{ label: string; kind: DeltaCandidate['kind']; mass: number }> = [];
  const isoGroups = new Map<string, string[]>();
  for (const r of Object.values(RESIDUES)) {
    const m = monoMass(r.formula).toFixed(5);
    isoGroups.set(m, [...(isoGroups.get(m) ?? []), r.code]);
  }
  for (const [m, codes] of isoGroups) t.push({ label: codes.join('/'), kind: 'residue', mass: Number(m) });
  // N-methylated standard residues (+CH2) are frequent in cyclic natural products.
  for (const c of STANDARD_CODES.filter((c) => !['U', 'O'].includes(c))) t.push({ label: `Me${c}`, kind: 'modified', mass: monoMass(RESIDUES[c].formula) + monoMass({ C: 1, H: 2 }) });
  for (const [label, base, mod] of MOD_RESIDUES) t.push({ label, kind: 'modified', mass: monoMass(RESIDUES[base].formula) + monoMass(parseFormula(mod)) });
  const std = STANDARD_CODES.filter((c) => !['U', 'O', 'I'].includes(c));
  for (let i = 0; i < std.length; i++) for (let j = i; j < std.length; j++) {
    const a = std[i], b = std[j];
    t.push({ label: a === b ? `${a}${b}` : `${a}${b}/${b}${a}`, kind: 'dipeptide', mass: monoMass(RESIDUES[a].formula) + monoMass(RESIDUES[b].formula) });
  }
  for (const [label, f] of COMMON_LOSSES) t.push({ label, kind: 'loss', mass: monoMass(parseFormula(f)) });
  for (const e of extra) t.push({ ...e, kind: 'residue' });
  return t;
}

/**
 * Candidates for a mass difference between two peaks. `delta` is the m/z difference; for charge z the
 * neutral difference is delta·z. Tolerance is applied to the larger of the two peak m/z values.
 */
export function deltaLookup(delta: number, refMz: number, tol: Tolerance, maxCharge = 2, extra?: Array<{ label: string; mass: number }>): DeltaCandidate[] {
  if (!deltaTable || extra) deltaTable = buildDeltaTable(extra);
  const out: DeltaCandidate[] = [];
  const d = Math.abs(delta);
  for (let z = 1; z <= maxCharge; z++) {
    const mass = d * z;
    // Error of a difference: both peaks contribute; use √2 × the per-peak tolerance.
    const allow = tolDa(refMz, tol) * Math.SQRT2 * z;
    for (const c of deltaTable) {
      const err = mass - c.mass;
      if (Math.abs(err) <= allow) out.push({ label: c.label, kind: c.kind, mass: c.mass, charge: z, errorDa: err / z, errorPpm: ((err / z) / refMz) * 1e6 });
    }
  }
  const kindRank = { residue: 0, modified: 1, loss: 2, dipeptide: 3 };
  return out.sort((a, b) => a.charge - b.charge || Math.abs(a.errorDa) - Math.abs(b.errorDa) || kindRank[a.kind] - kindRank[b.kind]);
}
