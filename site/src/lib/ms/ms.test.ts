import { describe, it, expect } from 'vitest';
import { parseFormula, monoMass, isotopePattern, PROTON, formatFormula } from './elements';
import { parseSequence } from './sequence';
import { generateFragments, peptideMass, type FragmentOptions } from './fragments';
import { matchPeaks, deltaLookup, coverage } from './match';

const base: FragmentOptions = { ionTypes: ['a', 'b', 'c', 'x', 'y', 'z•'], maxCharge: 1, precursorCharge: 2, losses: { h2o: false, nh3: false, mod: false, maxLosses: 0 } };
const find = (ions: ReturnType<typeof generateFragments>, label: string) => ions.find((i) => i.label === label);

describe('elements', () => {
  it('parses and formats formulas', () => {
    expect(formatFormula(parseFormula('C2H3NO'))).toBe('C2H3NO');
    expect(monoMass(parseFormula('H2O'))).toBeCloseTo(18.0105647, 6);
    expect(parseFormula('H-1N-1O1')).toEqual({ H: -1, N: -1, O: 1 });
    expect(() => parseFormula('Xx2')).toThrow(/Unknown element/);
  });
  it('isotope pattern of a ~1 kDa peptide has a dominant M peak', () => {
    const d = isotopePattern({ C: 50, H: 71, N: 13, O: 12 }, 4);
    expect(d[0]).toBe(1);
    expect(d[1]).toBeGreaterThan(0.5); expect(d[1]).toBeLessThan(0.65);
  });
  it('uses the CODATA proton mass', () => expect(PROTON).toBeCloseTo(1.00727646658, 10));
});

describe('sequence parsing', () => {
  it('reads ProForma-style terminal and residue modifications', () => {
    const p = parseSequence('[Acetyl]-PEPM[Oxidation]K-[Amidated]');
    expect(p.residues.map((r) => r.token).join('')).toBe('PEPMK');
    expect(p.nTermMods[0].name).toBe('Acetyl');
    expect(p.cTermMods[0].name).toBe('Amidated');
    expect(p.residues[3].mods[0].name).toBe('Oxidation');
  });
  it('reads mass deltas, D-residues, non-standard and N-methyl residues', () => {
    const p = parseSequence('cyclo(RGDf(MeV))');
    expect(p.cyclic).toBe(true);
    expect(p.residues[3].dForm).toBe(true);
    expect(p.residues[4].nMethyl).toBe(true);
    // Cilengitide, C27H40N8O7, monoisotopic 588.3020
    expect(peptideMass(p).mono).toBeCloseTo(588.3020, 3);
    expect(parseSequence('PEPS[+79.96633]K').residues[3].mass).toBeCloseTo(87.03203 + 79.96633, 4);
  });
  it('reads three-letter cyclo notation', () => {
    const p = parseSequence('cyclo(-Arg-Gly-Asp-D-Phe-Val-)');
    expect(p.residues.map((r) => r.token).join('')).toBe('RGDfV');
  });
  it('applies fixed modifications and rejects nonsense', () => {
    const p = parseSequence('ACDC', { fixedMods: [{ mod: 'Carbamidomethyl', residues: ['C'] }] });
    expect(p.residues.filter((r) => r.mods.length)).toHaveLength(2);
    expect(() => parseSequence('PEP[Bogus]')).toThrow(/Unknown modification/);
    expect(() => parseSequence('PEPB')).toThrow(/Unknown residue/);
    expect(() => parseSequence('')).toThrow(/Enter/);
  });
});

describe('linear fragments (angiotensin II, DRVYIHPF)', () => {
  const p = parseSequence('DRVYIHPF');
  const ions = generateFragments(p, { ...base, precursor: true });
  it('matches published b/y/a/c/z• values', () => {
    expect(find(ions, 'b₂')!.mz).toBeCloseTo(272.13533, 4);
    expect(find(ions, 'a₂')!.mz).toBeCloseTo(244.14042, 4);
    expect(find(ions, 'c₂')!.mz).toBeCloseTo(289.16188, 4);
    expect(find(ions, 'y₁')!.mz).toBeCloseTo(166.08626, 4);
    expect(find(ions, 'y₂')!.mz).toBeCloseTo(263.13902, 4);
    expect(find(ions, 'z₁•')!.mz).toBeCloseTo(150.06753, 4);
    expect(find(ions, '[M+H]⁺')!.mz).toBeCloseTo(1046.5418, 4);
  });
  it('pairs complementary ions and their m/z sum to [M+2H]', () => {
    const b3 = find(ions, 'b₃')!, y5 = find(ions, 'y₅')!;
    expect(b3.pair).toBe(y5.id);
    expect(b3.mz + y5.mz).toBeCloseTo(peptideMass(p).mono + 2 * PROTON, 6);
    expect(b3.bonds).toEqual(y5.bonds);
  });
  it('skips c/z cleavage N-terminal to proline', () => {
    expect(find(ions, 'c₆')).toBeUndefined(); // bond H|P
    expect(find(ions, 'z₂•')).toBeUndefined();
  });
  it('applies residue-gated losses and charge caps', () => {
    const lossy = generateFragments(p, { ...base, ionTypes: ['b', 'y'], maxCharge: 3, precursorCharge: 2, losses: { h2o: true, nh3: true, mod: false, maxLosses: 1 } });
    expect(find(lossy, 'b₁−H₂O')).toBeDefined(); // D can lose water
    expect(find(lossy, 'y₁−H₂O')).toBeUndefined(); // F cannot
    expect(lossy.every((i) => i.charge <= 2)).toBe(true);
  });
});

describe('cyclic fragments (gramicidin S)', () => {
  const p = parseSequence('cyclo(V(Orn)LfPV(Orn)LfP)');
  const ions = generateFragments(p, { ...base, ionTypes: ['b', 'a'], maxCharge: 2, precursor: true });
  it('has the right precursor m/z', () => {
    expect(find(ions, '[M+2H]²⁺')!.mz).toBeCloseTo(571.36025, 4);
    expect(find(ions, '[M+H]⁺')!.mz).toBeCloseTo(1141.71321, 4);
  });
  it('deduplicates symmetric ring openings and records every origin', () => {
    const pv = ions.find((i) => i.type === 'b' && i.seq === 'P-V' && i.charge === 1)!;
    expect(pv.mz).toBeCloseTo(97.052764 + 99.068414 + PROTON, 4);
    expect(pv.origins).toHaveLength(2);
    expect(ions.filter((i) => i.type === 'b' && i.charge === 1 && i.size === 3)).toHaveLength(5);
  });
});

describe('cycfrag compatibility', () => {
  it('parses bracketed residue tokens (LUNA18 / microcystin notation)', () => {
    const luna = parseSequence('cyclo([Ac5c]P[hPheF5][Sar][EtPhe4Me][Aze][MeA]I[MeL][MeAspNMe2][MeCpg])');
    expect(luna.residues).toHaveLength(11);
    // Σ residues from cycfrag/chem.py
    const expected = 111.06841391 + 97.05276385 + 265.05260498 + 71.03711379 + 189.11536411 + 83.03711378 + 85.05276385 + 113.08406398 + 127.09971405 + 156.08987763 + 139.09971404;
    expect(peptideMass(luna).mono).toBeCloseTo(expected, 3);
    expect(parseSequence('A[Orn]K').residues.map((r) => r.token)).toEqual(['A', 'Orn', 'K']);
    expect(parseSequence('PEPM[Oxidation]').residues[3].mods[0].name).toBe('Oxidation');
  });
  it('generates cyclic ETD arcs with cycfrag offsets and repeated losses', () => {
    // cyclo(RGDfK), a published integrin ligand: C27H41N9O7, monoisotopic 603.3129
    const p = parseSequence('cyclo(RGDfK)');
    expect(peptideMass(p).mono).toBeCloseTo(603.3129, 3);
    const ions = generateFragments(p, { ionTypes: ['b', 'cz•', 'z•', 'c'], maxCharge: 1, precursorCharge: 2, losses: { h2o: true, nh3: true, mod: false, maxLosses: 2 } });
    const af = (t: string) => ions.find((i) => i.type === t && i.seq === 'R-G' && !i.loss)!;
    const sum = 156.10111103 + 57.02146372;
    expect(af('cz•').mz).toBeCloseTo(sum + 1.00782503 + PROTON, 4);
    expect(af('z•').mz).toBeCloseTo(sum - 15.010899 + 1.00782503 + PROTON, 4);
    expect(ions.some((i) => i.loss === '2H₂O')).toBe(true);
    expect(ions.some((i) => i.loss === 'H₂O−NH₃')).toBe(true);
  });
});

describe('matching and Δm lookup', () => {
  const p = parseSequence('DRVYIHPF');
  const ions = generateFragments(p, { ...base, ionTypes: ['b', 'y'] });
  const peaks = [{ mz: 166.0864, intensity: 100 }, { mz: 167.0897, intensity: 9 }, { mz: 263.1393, intensity: 50 }, { mz: 272.1350, intensity: 30 }, { mz: 500.0, intensity: 5 }].sort((a, b) => a.mz - b.mz);
  it('matches within ppm tolerance, flags the 13C isotope, and reports coverage', () => {
    const m = matchPeaks(peaks, ions, { value: 10, unit: 'ppm' });
    expect(m.byPeak.get(0)![0].ion.label).toBe('y₁');
    expect(m.isotopeOf.get(1)).toBe(0);
    expect(m.byPeak.has(4)).toBe(false);
    const c = coverage(peaks, ions, m, 8, false);
    expect(c.explainedIntensityPct).toBeGreaterThan(95);
    expect(c.sitesObserved).toBe(3);
  });
  it('suggests glycine for a 57.021 gap and handles 2+ gaps', () => {
    expect(deltaLookup(57.0215, 300, { value: 10, unit: 'ppm' })[0].label).toBe('G');
    const two = deltaLookup(113.08406 / 2, 600, { value: 10, unit: 'ppm' });
    expect(two.some((c) => c.charge === 2 && c.label.includes('L'))).toBe(true);
  });
});
