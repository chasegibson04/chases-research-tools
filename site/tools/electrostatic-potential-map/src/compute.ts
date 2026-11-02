// Electrostatic potential map generator: structure -> closed-shell Hartree-Fock -> density, ESP and orbital grids.
// Runs inside the shared Web Worker; the interactive surface/figure is built from these grids on the main thread.
import type { ComputeFn } from '@/lib/types';
import { AU_TO_DEBYE, BOHR_PER_ANGSTROM, EA0SQ_TO_BUCKINGHAM, ANGSTROM_PER_BOHR, MAX_Z, formulaOf, symbolOf } from './chem';
import { buildStructure, findRings, standardOrientation, type Ring } from './geometry';
import { buildShells, supportedElements, type Atom, type BasisName } from './qm/basis';
import { EspEvaluator } from './qm/esp';
import { OrbitalEvaluator, densityMask, evalDensityGrid, evalEspGrid, gridSize, makeGrid, sampleGrid, type GridSpec } from './qm/grid';
import { multipoles, populationCharges, tracelessQuadrupole } from './qm/properties';
import { runRHF } from './qm/scf';

/** Default and absolute limits on basis functions. The packed two-electron integrals take n^4/8 doubles: 120 -> 210 MB, 150 -> 513 MB. */
export const MAX_BASIS_FUNCTIONS = 120;
export const HARD_MAX_BASIS_FUNCTIONS = 150;

export interface GridData extends GridSpec { data: Float32Array }
export interface WaveData {
  basis: BasisName;
  z: number[];
  /** bohr, 3 per atom, in the standard frame used for every grid */
  bohr: Float64Array;
  charge: number;
  nocc: number;
  nbf: number;
  /** C[mu * nbf + i] */
  C: Float64Array;
}
export interface RingReport {
  atoms: number[];
  size: number;
  centroid: [number, number, number];
  normal: [number, number, number];
  rms: number;
  pi: boolean;
  /** ESP (a.u.) at fixed distances (Angstrom) above (+normal) and below (-normal) the ring centroid */
  probes: Array<{ distance: number; above: number; below: number }>;
  profile: { distance: number[]; above: number[]; below: number[] };
}

export interface SliceSpec {
  /** Angstrom, standard frame */
  origin: [number, number, number];
  u: [number, number, number];
  v: [number, number, number];
  uMin: number; uMax: number; vMin: number; vMax: number;
  nu: number; nv: number;
}

export interface Input {
  op?: 'full' | 'orbital' | 'slice';
  source: 'smiles' | 'xyz' | 'molfile';
  structure: string;
  basis: BasisName;
  charge?: number;
  optimize?: boolean;
  seed?: number;
  reorient?: boolean;
  /** quality: fine density grid spacing and coarse ESP grid spacing, in bohr */
  gridSpacing?: number;
  espSpacing?: number;
  margin?: number;
  maxBasis?: number;
  // op = orbital | slice
  wave?: WaveData;
  grid?: GridSpec;
  orbitals?: number[];
  slice?: SliceSpec;
  property?: 'esp' | 'density' | number;
}

export interface Output {
  op: 'full' | 'orbital' | 'slice';
  // ---- full
  structure?: {
    z: number[];
    symbols: string[];
    /** Angstrom, standard frame */
    xyz: Float64Array;
    bonds: Array<[number, number, number]>;
    charge: number;
    formula: string;
    smiles?: string;
    molfile2d?: string;
    notes: string[];
    origin: 'smiles' | 'molfile' | 'xyz';
  };
  qm?: {
    method: string;
    basis: BasisName;
    nbf: number;
    nelec: number;
    nocc: number;
    energy: number;
    eNuc: number;
    eElec: number;
    iterations: number;
    converged: boolean;
    eps: Float64Array;
    homo: number;
    lumo: number | null;
    gapEv: number | null;
    timings: { geometry: number; integrals: number; scf: number; grids: number; total: number };
  };
  charges?: { mulliken: number[]; lowdin: number[] };
  moments?: { dipoleDebye: [number, number, number]; dipoleNorm: number; quadrupoleBuckingham: number[][]; origin: [number, number, number] };
  rings?: RingReport[];
  density?: GridData;
  esp?: GridData;
  orbitalGrids?: Array<{ index: number; energy: number; label: string; data: Float32Array }>;
  wave?: WaveData;
  // ---- orbital
  orbitals?: Array<{ index: number; data: Float32Array }>;
  // ---- slice
  slice?: { nu: number; nv: number; data: Float32Array; property: string; spec: SliceSpec };
}

const orbitalLabel = (i: number, nocc: number) => (i === nocc - 1 ? 'HOMO' : i === nocc ? 'LUMO' : i < nocc ? `HOMO−${nocc - 1 - i}` : `LUMO+${i - nocc}`);

function atomsFromWave(w: WaveData): Atom[] {
  return w.z.map((z, i) => ({ z, x: w.bohr[i * 3], y: w.bohr[i * 3 + 1], z3: w.bohr[i * 3 + 2] }));
}
function densityMatrix(C: Float64Array, nbf: number, nocc: number): Float64Array {
  const P = new Float64Array(nbf * nbf);
  for (let m = 0; m < nbf; m++) for (let n = 0; n < nbf; n++) { let s = 0; for (let i = 0; i < nocc; i++) s += C[m * nbf + i] * C[n * nbf + i]; P[m * nbf + n] = 2 * s; }
  return P;
}

const run: ComputeFn<Input, Output> = async (input, ctx) => {
  const op = input.op ?? 'full';
  if (op === 'orbital' || op === 'slice') return runFollowUp(input, ctx);
  const tAll = performance.now();
  const basis = input.basis;
  if (!['sto-3g', '3-21g', '6-31g'].includes(basis)) throw new Error(`Unknown basis set "${basis}".`);
  ctx.progress(0.01, 'Building the 3D structure');
  const t0 = performance.now();
  const st = await buildStructure({ source: input.source, text: input.structure, charge: input.charge, seed: input.seed, optimize: input.optimize });
  const unsupported = st.z.find((z) => !supportedElements(basis).includes(z));
  if (unsupported) throw new Error(`Element ${symbolOf(unsupported)} is not available in ${basis} here (hydrogen to calcium only).`);
  const xyzAng = input.reorient === false ? st.xyz : standardOrientation(st.xyz).xyz;
  const atoms: Atom[] = st.z.map((z, i) => ({ z, x: xyzAng[i * 3] * BOHR_PER_ANGSTROM, y: xyzAng[i * 3 + 1] * BOHR_PER_ANGSTROM, z3: xyzAng[i * 3 + 2] * BOHR_PER_ANGSTROM }));
  const { shells, nbf } = buildShells(atoms, basis);
  const cap = Math.min(input.maxBasis ?? MAX_BASIS_FUNCTIONS, HARD_MAX_BASIS_FUNCTIONS);
  if (nbf > cap) throw new Error(`This molecule needs ${nbf} basis functions in ${basis}; the limit is ${cap} so the browser does not run out of memory. Try STO-3G, a smaller molecule${cap < HARD_MAX_BASIS_FUNCTIONS ? `, or raise the size limit under Advanced options (up to ${HARD_MAX_BASIS_FUNCTIONS}, needs about ${Math.round((Math.pow((nbf * (nbf + 1)) / 2, 2) / 2) * 8 / 1e6)} MB)` : ''}.`);
  const tGeom = performance.now() - t0;

  const scf = runRHF(shells, atoms, nbf, {
    charge: st.charge, signal: ctx.signal,
    onProgress: (f, m) => ctx.progress(0.03 + 0.5 * f, m),
  });
  if (!scf.converged) throw new Error(`The SCF did not converge in ${scf.iterations} iterations. The geometry may be unusual; try the MMFF refinement or a different starting structure.`);

  // ---- grids
  const tG = performance.now();
  const h = Math.max(0.12, Math.min(0.8, input.gridSpacing ?? 0.3));
  const hE = Math.max(0.2, Math.min(1.2, input.espSpacing ?? 0.5));
  const margin = input.margin ?? 7;
  const grid = makeGrid(atoms, margin, h);
  const keep = [scf.nocc - 1, ...(scf.nocc < nbf ? [scf.nocc] : [])];
  ctx.progress(0.55, 'Electron density on the grid');
  const { rho, orbitals } = evalDensityGrid(shells, nbf, scf.C, scf.nocc, keep, grid, { signal: ctx.signal, onProgress: (f) => ctx.progress(0.55 + 0.15 * f, 'Electron density on the grid') });
  const eGrid = makeGrid(atoms, margin, hE);
  const coarseMask = (() => {
    const m = new Float32Array(gridSize(eGrid));
    let k = 0;
    for (let i = 0; i < eGrid.n[0]; i++) for (let j = 0; j < eGrid.n[1]; j++) for (let l = 0; l < eGrid.n[2]; l++, k++) m[k] = sampleGrid(rho, grid, eGrid.origin[0] + i * hE, eGrid.origin[1] + j * hE, eGrid.origin[2] + l * hE);
    return densityMask(m.map((v) => (Number.isNaN(v) ? 0 : v)), eGrid, 5e-6);
  })();
  ctx.progress(0.7, 'Electrostatic potential');
  const ev = new EspEvaluator(shells, atoms, scf.P, nbf);
  const espData = evalEspGrid(ev, eGrid, coarseMask, { signal: ctx.signal, onProgress: (f) => ctx.progress(0.7 + 0.25 * f, 'Electrostatic potential') });
  const tGrids = performance.now() - tG;

  ctx.progress(0.96, 'Properties');
  const q = populationCharges(shells, atoms, scf.P, scf.S, nbf);
  const totalZ = atoms.reduce((s, a) => s + a.z, 0);
  const origin: [number, number, number] = [0, 1, 2].map((k) => atoms.reduce((s, a) => s + a.z * [a.x, a.y, a.z3][k], 0) / totalZ) as [number, number, number];
  const mp = multipoles(shells, atoms, scf.P, nbf, origin);
  const dip = mp.dipole.map((v) => v * AU_TO_DEBYE) as [number, number, number];
  const quad = tracelessQuadrupole(mp.second).map((r) => r.map((v) => v * EA0SQ_TO_BUCKINGHAM));

  // ---- aromatic / pi ring probes (cation-pi relevant)
  const rings: RingReport[] = findRings(st.z, xyzAng, st.bonds).filter((r) => r.pi).map((r: Ring) => {
    const pt = (d: number, s: number) => ev.at((r.centroid[0] + s * d * r.normal[0]) * BOHR_PER_ANGSTROM, (r.centroid[1] + s * d * r.normal[1]) * BOHR_PER_ANGSTROM, (r.centroid[2] + s * d * r.normal[2]) * BOHR_PER_ANGSTROM);
    const distance: number[] = [];
    for (let d = 0.5; d <= 6.0001; d += 0.25) distance.push(+d.toFixed(2));
    return {
      atoms: r.atoms, size: r.atoms.length, centroid: r.centroid, normal: r.normal, rms: r.rms, pi: r.pi,
      probes: [1.5, 2.0, 2.5, 3.0, 3.5, 4.0].map((d) => ({ distance: d, above: pt(d, 1), below: pt(d, -1) })),
      profile: { distance, above: distance.map((d) => pt(d, 1)), below: distance.map((d) => pt(d, -1)) },
    };
  });

  const wave: WaveData = { basis, z: st.z, bohr: Float64Array.from(atoms.flatMap((a) => [a.x, a.y, a.z3])), charge: st.charge, nocc: scf.nocc, nbf, C: scf.C };
  const eV = 27.211386245988;
  ctx.progress(1, 'Done');
  return {
    op: 'full',
    structure: { z: st.z, symbols: st.z.map(symbolOf), xyz: xyzAng, bonds: st.bonds, charge: st.charge, formula: formulaOf(st.z, st.charge), smiles: st.smiles, molfile2d: st.molfile2d, notes: st.notes, origin: st.origin },
    qm: {
      method: `RHF/${basis === 'sto-3g' ? 'STO-3G' : basis === '3-21g' ? '3-21G' : '6-31G'}`, basis, nbf, nelec: scf.nelec, nocc: scf.nocc, energy: scf.energy, eNuc: scf.eNuc, eElec: scf.eElec,
      iterations: scf.iterations, converged: scf.converged, eps: scf.eps, homo: scf.eps[scf.nocc - 1],
      lumo: scf.nocc < nbf ? scf.eps[scf.nocc] : null, gapEv: scf.nocc < nbf ? (scf.eps[scf.nocc] - scf.eps[scf.nocc - 1]) * eV : null,
      timings: { geometry: tGeom, integrals: scf.timings.integrals, scf: scf.timings.scf, grids: tGrids, total: performance.now() - tAll },
    },
    charges: { mulliken: Array.from(q.mulliken), lowdin: Array.from(q.lowdin) },
    moments: { dipoleDebye: dip, dipoleNorm: Math.hypot(...dip), quadrupoleBuckingham: quad, origin: origin.map((v) => v * ANGSTROM_PER_BOHR) as [number, number, number] },
    rings,
    density: { ...grid, data: rho },
    esp: { ...eGrid, data: espData },
    orbitalGrids: keep.map((k) => ({ index: k, energy: scf.eps[k], label: orbitalLabel(k, scf.nocc), data: orbitals.get(k)! })),
    wave,
  };
};
export default run;

/** Orbital grids or a 2D plane of a property, from a saved wavefunction (no SCF is repeated). */
async function runFollowUp(input: Input, ctx: Parameters<ComputeFn<Input, Output>>[1]): Promise<Output> {
  const w = input.wave;
  if (!w) throw new Error('Run the calculation first.');
  const atoms = atomsFromWave(w);
  const { shells } = buildShells(atoms, w.basis);
  if (input.op === 'orbital') {
    const idx = [...new Set(input.orbitals ?? [])].filter((i) => i >= 0 && i < w.nbf);
    if (!idx.length || !input.grid) throw new Error('No orbital selected.');
    ctx.progress(0.1, 'Evaluating orbitals');
    const { orbitals } = evalDensityGrid(shells, w.nbf, w.C, w.nocc, idx, input.grid, { signal: ctx.signal, onProgress: (f) => ctx.progress(0.1 + 0.9 * f, 'Evaluating orbitals') });
    return { op: 'orbital', orbitals: idx.map((index) => ({ index, data: orbitals.get(index)! })) };
  }
  const s = input.slice;
  if (!s) throw new Error('No plane given.');
  const prop = input.property ?? 'esp';
  const nu = Math.max(8, Math.min(400, s.nu)), nv = Math.max(8, Math.min(400, s.nv));
  const data = new Float32Array(nu * nv);
  const pt = (a: number, b: number) => [0, 1, 2].map((k) => (s.origin[k] + a * s.u[k] + b * s.v[k]) * BOHR_PER_ANGSTROM) as [number, number, number];
  const P = densityMatrix(w.C, w.nbf, w.nocc);
  const ev = prop === 'esp' ? new EspEvaluator(shells, atoms, P, w.nbf) : null;
  const oe = prop === 'esp' ? null : new OrbitalEvaluator(shells, w.nbf, w.C, w.nocc, typeof prop === 'number' ? [prop] : []);
  for (let j = 0; j < nv; j++) {
    if (ctx.signal.aborted) throw new Error('Cancelled');
    for (let i = 0; i < nu; i++) {
      const [x, y, z] = pt(s.uMin + ((s.uMax - s.uMin) * i) / (nu - 1), s.vMin + ((s.vMax - s.vMin) * j) / (nv - 1));
      data[j * nu + i] = ev ? ev.at(x, y, z) : (() => { const d = oe!.eval(x, y, z); return typeof prop === 'number' ? oe!.psi[prop] : d; })();
    }
    ctx.progress((j + 1) / nv, 'Evaluating the plane');
  }
  return { op: 'slice', slice: { nu, nv, data, property: typeof prop === 'number' ? `orbital ${prop}` : prop, spec: s } };
}
void MAX_Z;
