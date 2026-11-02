import { describe, it, expect } from 'vitest';
import run, { type Input, type Output } from '../src/compute';
import { HARTREE_TO_KCAL, BOHR_PER_ANGSTROM } from '../src/chem';

const ctx = { progress: () => {}, log: () => {}, signal: new AbortController().signal };
const benzeneXYZ = (R: number, RX: number, X: string) => {
  let t = '';
  for (let k = 0; k < 6; k++) t += `C ${R * Math.cos((Math.PI * k) / 3)} ${R * Math.sin((Math.PI * k) / 3)} 0\n`;
  for (let k = 0; k < 6; k++) t += `${X} ${RX * Math.cos((Math.PI * k) / 3)} ${RX * Math.sin((Math.PI * k) / 3)} 0\n`;
  return t;
};

describe('full pipeline', () => {
  it('benzene vs hexafluorobenzene: the pi-face potential reverses sign (the cation-pi slide)', async () => {
    const bz = await run({ source: 'xyz', structure: benzeneXYZ(1.397, 2.481, 'H'), basis: 'sto-3g', charge: 0, gridSpacing: 0.45, espSpacing: 0.7 } as Input, ctx) as Output;
    const hf = await run({ source: 'xyz', structure: benzeneXYZ(1.394, 2.721, 'F'), basis: 'sto-3g', charge: 0, gridSpacing: 0.45, espSpacing: 0.7 } as Input, ctx) as Output;
    expect(bz.qm!.converged && hf.qm!.converged).toBe(true);
    expect(bz.qm!.energy).toBeCloseTo(-227.89060057, 6); // PySCF
    expect(hf.qm!.energy).toBeCloseTo(-812.61181523, 6);
    const above = (o: Output, d: number) => o.rings![0].probes.find((p) => p.distance === d)!;
    expect(above(bz, 3.0).above).toBeLessThan(0); // electron-rich pi face attracts a cation
    expect(above(hf, 3.0).above).toBeGreaterThan(0); // fluorines withdraw pi density
    expect(above(bz, 3.0).above * HARTREE_TO_KCAL).toBeLessThan(-3);
    expect(above(hf, 3.0).above * HARTREE_TO_KCAL).toBeGreaterThan(3);
    // symmetric faces for a planar D6h molecule
    expect(above(bz, 3.0).above).toBeCloseTo(above(bz, 3.0).below, 5);
    // quadrupole sign: benzene Qzz < 0, hexafluorobenzene Qzz > 0 (experiment: -8.7 and +9.5 B)
    expect(bz.moments!.quadrupoleBuckingham[2][2]).toBeLessThan(0);
    expect(hf.moments!.quadrupoleBuckingham[2][2]).toBeGreaterThan(0);
    expect(bz.moments!.dipoleNorm).toBeLessThan(1e-3);
    // output shape
    expect(bz.density!.data.length).toBe(bz.density!.n[0] * bz.density!.n[1] * bz.density!.n[2]);
    expect(Number.isFinite(Math.max(...bz.esp!.data.filter((v) => !Number.isNaN(v))))).toBe(true);
    expect(bz.structure!.formula).toBe('C6H6');
    void BOHR_PER_ANGSTROM;
  }, 120000);

  it('handles single-atom ions and anions (energies match PySCF)', async () => {
    const na = await run({ source: 'smiles', structure: '[Na+]', basis: '6-31g', gridSpacing: 0.5, espSpacing: 0.7 } as Input, ctx) as Output;
    expect(na.qm!.energy).toBeCloseTo(-161.65927657, 6);
    expect(na.structure!.charge).toBe(1);
    expect(na.rings).toEqual([]);
    expect(na.moments!.dipoleNorm).toBeLessThan(1e-6);
    const ac = await run({ source: 'smiles', structure: 'CC(=O)[O-]', basis: 'sto-3g', gridSpacing: 0.5, espSpacing: 0.7 } as Input, ctx) as Output;
    expect(ac.structure!.charge).toBe(-1);
    expect(ac.structure!.formula).toBe('C2H3O2−');
    const vals = ac.esp!.data.filter((v) => !Number.isNaN(v));
    expect(vals.every(Number.isFinite)).toBe(true);
    expect(Math.min(...vals.filter((_, i) => i % 3 === 0))).toBeLessThan(-0.05); // the anion has a clearly negative region
    expect(ac.charges!.mulliken.reduce((a, b) => a + b, 0)).toBeCloseTo(-1, 6);
  }, 120000);

  it('runs a drug-sized molecule (caffeine, 146 functions) only when the size limit is raised', async () => {
    const caff = 'CN1C=NC2=C1C(=O)N(C(=O)N2C)C';
    await expect(run({ source: 'smiles', structure: caff, basis: '3-21g' } as Input, ctx)).rejects.toThrow(/Advanced options/);
    const o = await run({ source: 'smiles', structure: caff, basis: '3-21g', maxBasis: 150, gridSpacing: 0.6, espSpacing: 0.9 } as Input, ctx) as Output;
    expect(o.qm!.nbf).toBe(146);
    expect(o.qm!.converged).toBe(true);
    expect(o.structure!.formula).toBe('C8H10N4O2');
    expect(o.moments!.dipoleNorm).toBeGreaterThan(1); // caffeine is polar
  }, 300000);

  it('rejects odd-electron input and oversize jobs with readable messages', async () => {
    await expect(run({ source: 'xyz', structure: 'H 0 0 0\nH 0 0 0.74\nH 0 0 1.5', basis: 'sto-3g', charge: 0 } as Input, ctx)).rejects.toThrow(/odd number of electrons/);
    await expect(run({ source: 'smiles', structure: 'CCCCCCCCCCCCCCCCCCCCCC', basis: '6-31g' } as Input, ctx)).rejects.toThrow(/basis functions/);
    await expect(run({ source: 'smiles', structure: 'C', basis: 'sto-3g', maxBasis: 3 } as Input, ctx)).rejects.toThrow(/limit/);
  }, 60000);

  it('orbital and slice follow-ups reuse the wavefunction', async () => {
    const o = await run({ source: 'smiles', structure: 'O', basis: 'sto-3g', gridSpacing: 0.5, espSpacing: 0.8 } as Input, ctx) as Output;
    const homo = o.orbitalGrids![0];
    expect(homo.label).toBe('HOMO');
    const again = await run({ op: 'orbital', source: 'smiles', structure: '', basis: 'sto-3g', wave: o.wave, grid: o.density, orbitals: [homo.index] } as Input, ctx) as Output;
    const a = again.orbitals![0].data;
    for (let i = 0; i < a.length; i += 997) expect(a[i]).toBeCloseTo(homo.data[i], 6);
    const sl = await run({ op: 'slice', source: 'smiles', structure: '', basis: 'sto-3g', wave: o.wave, property: 'esp', slice: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], uMin: -3, uMax: 3, vMin: -3, vMax: 3, nu: 12, nv: 12 } } as Input, ctx) as Output;
    expect(sl.slice!.data.length).toBe(144);
    expect(sl.slice!.data.some((v) => Number.isFinite(v))).toBe(true);
  }, 60000);
});
