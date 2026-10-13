import { describe, it, expect } from 'vitest';
import run, { composition, formulaString, isotopeDistribution, monoMass } from '../src/compute';
import angiotensin from '../examples/angiotensin-ii.json';
import cyclic from '../examples/cyclic-cysteine.json';

const ctx = { progress: () => {}, log: () => {}, signal: new AbortController().signal };

describe('peptide-mass-calculator', () => {
  it('matches the angiotensin II golden values', async () => {
    const out = await run(angiotensin.input as any, ctx);
    expect(out.formula).toBe(angiotensin.expected.formula);
    expect(out.mono).toBeCloseTo(angiotensin.expected.mono, 3);
    expect(out.mz[0].mz).toBeCloseTo(angiotensin.expected.mz1, 3);
    expect(out.mz[1].mz).toBeCloseTo(angiotensin.expected.mz2, 3);
    expect(out.isotopes).toHaveLength(8);
    expect(out.isotopes[0].relIntensity).toBe(1); // M peak dominates for a ~1 kDa peptide
  });
  it('handles cyclic + carbamidomethyl', async () => {
    const out = await run(cyclic.input as any, ctx);
    expect(out.mono).toBeCloseTo(cyclic.expected.mono, 3);
  });
  it('glycine composition and water', () => {
    const f = composition('G');
    expect(formulaString(f)).toBe('C2H5NO2');
    expect(monoMass(f)).toBeCloseTo(75.0320, 3);
  });
  it('isotope distribution is normalised to the base peak', () => {
    const d = isotopeDistribution(composition('DRVYIHPF'), 6);
    expect(Math.max(...d)).toBe(1);
    expect(d[1]).toBeGreaterThan(0.4); // ~50 carbons => M+1 around 55%
  });
  it('rejects empty and unknown residues', async () => {
    await expect(run({ sequence: '', maxCharge: 1 }, ctx)).rejects.toThrow(/Enter/);
    await expect(run({ sequence: 'ABZ', maxCharge: 1 }, ctx)).rejects.toThrow(/Unknown/);
  });
});
