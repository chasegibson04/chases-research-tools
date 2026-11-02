import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildShells, type BasisName, type Atom } from '../src/qm/basis';
import { runRHF } from '../src/qm/scf';
import { zOf, BOHR_PER_ANGSTROM } from '../src/chem';

const ref = (name: string, basis: string) => JSON.parse(readFileSync(new URL(`./reference/${name}.${basis}.json`, import.meta.url), 'utf8'));
const atomsOf = (r: any): Atom[] => r.atoms.map((a: any) => ({ z: zOf(a[0]), x: a[1] * BOHR_PER_ANGSTROM, y: a[2] * BOHR_PER_ANGSTROM, z3: a[3] * BOHR_PER_ANGSTROM }));

describe('RHF engine vs PySCF', () => {
  for (const [name, basis] of [['water', 'sto-3g'], ['methane', 'sto-3g'], ['water', '3-21g']] as const) {
    it(`${name} ${basis}`, () => {
      const r = ref(name, basis);
      const atoms = atomsOf(r);
      const { shells, nbf } = buildShells(atoms, basis as BasisName);
      expect(nbf).toBe(r.nbf);
      const res = runRHF(shells, atoms, nbf, { charge: r.charge });
      expect(res.converged).toBe(true);
      expect(res.eNuc).toBeCloseTo(r.e_nuc, 8);
      expect(res.energy).toBeCloseTo(r.e_tot, 7);
    });
  }
});
