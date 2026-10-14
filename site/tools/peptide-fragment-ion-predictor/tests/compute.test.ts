import { describe, it, expect } from 'vitest';
import run, { parseFixedMods, type Input } from '../src/compute';
import angiotensin from '../examples/angiotensin-ii-hcd.json';
import gramicidin from '../examples/gramicidin-s.json';
import csa from '../examples/cyclosporin-a.json';
import phospho from '../examples/phospho-etd.json';

const ctx = { progress: () => {}, log: () => {}, signal: new AbortController().signal };
const ion = (out: Awaited<ReturnType<typeof run>>, type: string, size: number, z = 1) =>
  out.ions.find((i) => i.type === type && i.size === size && i.charge === z && !i.loss && i.carrier === 'H')!;
const prec = (out: Awaited<ReturnType<typeof run>>, z: number) => out.precursors.find((p) => p.z === z)!.mz;

describe('peptide-fragment-ion-predictor golden examples', () => {
  it('angiotensin II (ProteinProspector values)', async () => {
    const out = await run(angiotensin.input as Input, ctx);
    const e = angiotensin.expected;
    expect(out.formula).toBe(e.formula);
    expect(out.mono).toBeCloseTo(e.mono, 3);
    expect(prec(out, 1)).toBeCloseTo(e.mz1, 3);
    expect(prec(out, 2)).toBeCloseTo(e.mz2, 3);
    expect(ion(out, 'b', 2).mz).toBeCloseTo(e.b2, 3);
    expect(ion(out, 'y', 1).mz).toBeCloseTo(e.y1, 3);
    expect(ion(out, 'y', 2).mz).toBeCloseTo(e.y2, 3);
    expect(out.ionTypes).toEqual(['b', 'y', 'a']);
  });
  it('gramicidin S (cyclic, ornithine, D-Phe)', async () => {
    const out = await run(gramicidin.input as Input, ctx);
    expect(out.formula).toBe(gramicidin.expected.formula);
    expect(out.mono).toBeCloseTo(gramicidin.expected.mono, 3);
    expect(prec(out, 2)).toBeCloseTo(gramicidin.expected.mz2, 3);
    expect(out.ions.some((i) => i.type === 'y')).toBe(false); // no termini, no y ions
  });
  it('cyclosporin A (N-methyl residues, MeBmt) with sodium adducts', async () => {
    const out = await run(csa.input as Input, ctx);
    expect(out.formula).toBe(csa.expected.formula);
    expect(out.mono).toBeCloseTo(csa.expected.mono, 3);
    expect(prec(out, 1)).toBeCloseTo(csa.expected.mz1, 3);
    expect(out.ions.some((i) => i.carrier === 'Na')).toBe(true);
  });
  it('phospho-kemptide ETD c/z• ions', async () => {
    const out = await run(phospho.input as Input, ctx);
    expect(out.mono).toBeCloseTo(phospho.expected.mono, 3);
    expect(prec(out, 3)).toBeCloseTo(phospho.expected.mz3, 3);
    expect(ion(out, 'c', 1).mz).toBeCloseTo(phospho.expected.c1, 3);
    expect(ion(out, 'z•', 1).mz).toBeCloseTo(phospho.expected['z•1'], 3);
    expect(out.ions.some((i) => i.loss === 'H₃PO₄')).toBe(true);
  });
});

describe('validation and invariants', () => {
  const base = angiotensin.input as Input;
  it('rejects bad input with readable errors', async () => {
    await expect(run({ ...base, sequence: '' }, ctx)).rejects.toThrow(/Enter/);
    await expect(run({ ...base, sequence: 'PEPXJ' }, ctx)).rejects.toThrow(/Unknown residue/);
    await expect(run({ ...base, activation: 'ETD', precursorCharge: 1 }, ctx)).rejects.toThrow(/at least 2\+/);
    expect(() => parseFixedMods('Carbamidomethyl')).toThrow(/needs a site/);
  });
  it('complementary b/y pairs sum to [M+2H] for every cleavage', async () => {
    const out = await run({ ...base, losses: false }, ctx);
    const n = out.peptide.residues.length;
    for (let i = 1; i < n; i++) expect(ion(out, 'b', i).mz + ion(out, 'y', n - i).mz).toBeCloseTo(out.mono + 2 * 1.00727646658, 5);
  });
  it('matches a pasted peak list and reports coverage', async () => {
    const observed = '166.0864 100\n263.1392 60\n272.1355 40\n513.2800 30\n784.4099 25\n999.9999 5';
    const out = await run({ ...base, observed }, ctx);
    expect(out.observed!.peaks).toHaveLength(6);
    expect(out.match!.byPeak.size).toBeGreaterThanOrEqual(4);
    expect(out.coverage!.sitesObserved).toBeGreaterThanOrEqual(3);
  });
  it('predicted spectrum is normalised and y-dominated for HCD', async () => {
    const out = await run(base, ctx);
    expect(Math.max(...out.predicted.map((p) => p.intensity))).toBeCloseTo(100, 6);
    const top = out.predicted.slice().sort((a, b) => b.intensity - a.intensity)[0];
    expect(out.ions.find((i) => i.id === top.ionId)!.type).toBe('y');
  });
});
