import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildShells, type BasisName, type Atom } from '../src/qm/basis';
import { runRHF } from '../src/qm/scf';
import { populationCharges, multipoles } from '../src/qm/properties';
import { EspEvaluator } from '../src/qm/esp';
import { evalDensityGrid, makeGrid, sampleGrid } from '../src/qm/grid';
import { zOf, BOHR_PER_ANGSTROM } from '../src/chem';

const ref = (name: string, basis: string) => JSON.parse(readFileSync(new URL(`./reference/${name}.${basis}.json`, import.meta.url), 'utf8'));
const atomsOf = (r: any): Atom[] => r.atoms.map((a: any) => ({ z: zOf(a[0]), x: a[1] * BOHR_PER_ANGSTROM, y: a[2] * BOHR_PER_ANGSTROM, z3: a[3] * BOHR_PER_ANGSTROM }));
const CASES: Array<[string, BasisName]> = [['water', 'sto-3g'], ['methanol', '3-21g'], ['formamide', '6-31g'], ['acetate', '3-21g'], ['ammonium', 'sto-3g'], ['chloromethane', '3-21g'], ['benzene', 'sto-3g'], ['fluorobenzene', '3-21g'], ['sodium-cation', '6-31g']];

describe('properties vs PySCF', () => {
  for (const [name, basis] of CASES) {
    it(`${name} ${basis}: charges, moments, density and ESP at probe points`, () => {
      const r = ref(name, basis);
      const atoms = atomsOf(r);
      const { shells, nbf } = buildShells(atoms, basis);
      const res = runRHF(shells, atoms, nbf, { charge: r.charge });
      const q = populationCharges(shells, atoms, res.P, res.S, nbf);
      r.mulliken.forEach((x: number, i: number) => expect(q.mulliken[i]).toBeCloseTo(x, 6));
      r.lowdin.forEach((x: number, i: number) => expect(q.lowdin[i]).toBeCloseTo(x, 6));
      const mp = multipoles(shells, atoms, res.P, nbf, [0, 0, 0]);
      r.dipole_au.forEach((x: number, k: number) => expect(mp.dipole[k]).toBeCloseTo(x, 6));
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) expect(mp.second[a][b]).toBeCloseTo(r.second_moment_au[a][b], 5);
      const ev = new EspEvaluator(shells, atoms, res.P, nbf);
      // density at probes through the orbital grid routine on a one-point-wide trick: build tiny grids at each probe
      for (const p of r.probes) {
        expect(ev.at(...(p.r_bohr as [number, number, number]))).toBeCloseTo(p.esp, 6);
        const g = { origin: p.r_bohr as [number, number, number], h: 1, n: [1, 1, 1] as [number, number, number] };
        const { rho } = evalDensityGrid(shells, nbf, res.C, res.nocc, [], g);
        expect(Math.abs(rho[0] - p.rho)).toBeLessThan(1e-6 * Math.max(1, Math.abs(p.rho)) + 1e-7);
      }
      void makeGrid; void sampleGrid;
    });
  }
});
