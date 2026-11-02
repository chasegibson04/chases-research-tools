// Turns a user structure (SMILES, drawn molfile, XYZ, MOL/SDF) into 3D atoms, plus bonds, rings and a standard orientation.
// OpenChemLib (BSD-3) supplies SMILES parsing, 3D conformer generation and the MMFF94s force field.
import { covalentRadius, symbolOf, zOf, MAX_Z } from './chem';
import { eigh } from './qm/linalg';

export interface Structure {
  z: number[];
  /** Angstrom, 3 per atom. */
  xyz: Float64Array;
  charge: number;
  /** [i, j, order] */
  bonds: Array<[number, number, number]>;
  smiles?: string;
  /** Molfile with 2D coordinates for drawing, when the input was a molecule graph. */
  molfile2d?: string;
  origin: 'smiles' | 'molfile' | 'xyz';
  notes: string[];
}

export interface Ring {
  atoms: number[];
  centroid: [number, number, number];
  normal: [number, number, number];
  /** RMS distance of ring atoms from the best plane (Angstrom). */
  rms: number;
  /** Planar 5-7 membered ring made of sp2-like atoms: a candidate pi system. */
  pi: boolean;
}

type OclModule = any;
let oclPromise: Promise<OclModule> | null = null;

/** Loads OpenChemLib and registers its resource file (browser: fetch the bundled asset; Node/tests: read from disk). */
export function loadOCL(): Promise<OclModule> {
  if (!oclPromise) {
    oclPromise = (async () => {
      const mod: any = await import('openchemlib');
      const OCL = mod.default ?? mod;
      const isNode = typeof process !== 'undefined' && !!process.versions?.node && typeof (globalThis as any).WorkerGlobalScope === 'undefined' && typeof document === 'undefined';
      if (isNode) {
        const fs = await import(/* @vite-ignore */ 'node:fs');
        const path = await import(/* @vite-ignore */ 'node:path');
        const url = await import(/* @vite-ignore */ 'node:url');
        const here = path.dirname(url.fileURLToPath(import.meta.url));
        OCL.Resources.register(fs.readFileSync(path.join(here, 'runtime', 'openchemlib-resources.json'), 'utf8'));
      } else {
        const url = (await import('./runtime/openchemlib-resources.json?url')).default as string;
        await OCL.Resources.registerFromUrl(new URL(url, (globalThis as any).location?.href ?? 'http://localhost/').href);
      }
      return OCL;
    })();
    oclPromise.catch(() => { oclPromise = null; });
  }
  return oclPromise;
}

// ---- XYZ ---------------------------------------------------------------------------------------
export function parseXYZ(text: string): { z: number[]; xyz: Float64Array } {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter((l, i) => l.length > 0 || i < 2);
  let body = lines;
  // standard XYZ: first line = atom count, second = comment
  if (/^\d+$/.test(lines[0] ?? '')) {
    const n = parseInt(lines[0], 10);
    body = lines.slice(2, 2 + n);
    if (body.length < n) throw new Error(`XYZ header promises ${n} atoms but only ${body.length} coordinate lines follow.`);
  }
  body = body.filter((l) => l.length > 0);
  const z: number[] = [];
  const xyz: number[] = [];
  body.forEach((line, i) => {
    const f = line.split(/\s+/);
    if (f.length < 4) throw new Error(`XYZ line ${i + 1} needs "element x y z": "${line}".`);
    const el = /^\d+$/.test(f[0]) ? parseInt(f[0], 10) : zOf(f[0].replace(/[^A-Za-z]/g, ''));
    const c = [f[1], f[2], f[3]].map(Number);
    if (c.some((v) => !Number.isFinite(v))) throw new Error(`XYZ line ${i + 1} has a non-numeric coordinate: "${line}".`);
    z.push(el);
    xyz.push(...c);
  });
  if (z.length === 0) throw new Error('No atoms found. Paste XYZ text: one "element x y z" line per atom (Angstrom).');
  return { z, xyz: Float64Array.from(xyz) };
}

// ---- bonds and rings ---------------------------------------------------------------------------
export function inferBonds(z: number[], xyz: Float64Array): Array<[number, number, number]> {
  const bonds: Array<[number, number, number]> = [];
  for (let i = 0; i < z.length; i++)
    for (let j = 0; j < i; j++) {
      const d = Math.hypot(xyz[i * 3] - xyz[j * 3], xyz[i * 3 + 1] - xyz[j * 3 + 1], xyz[i * 3 + 2] - xyz[j * 3 + 2]);
      if (d > 0.4 && d < covalentRadius(z[i]) + covalentRadius(z[j]) + 0.4) bonds.push([j, i, 1]);
    }
  return bonds;
}

export function findRings(z: number[], xyz: Float64Array, bonds: Array<[number, number, number]>, maxSize = 8): Ring[] {
  const n = z.length;
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of bonds) { adj[a].push(b); adj[b].push(a); }
  const seen = new Set<string>();
  const rings: number[][] = [];
  for (const [a, b] of bonds) {
    // shortest path from a to b that avoids the direct bond
    const prev = new Int32Array(n).fill(-2);
    prev[a] = -1;
    const queue = [a];
    let found = false;
    for (let qi = 0; qi < queue.length && !found; qi++) {
      const u = queue[qi];
      for (const v of adj[u]) {
        if ((u === a && v === b) || prev[v] !== -2) continue;
        prev[v] = u;
        if (v === b) { found = true; break; }
        queue.push(v);
      }
    }
    if (!found) continue;
    const path: number[] = [];
    for (let v = b; v !== -1; v = prev[v]) path.push(v);
    if (path.length > maxSize) continue;
    const key = [...path].sort((x, y) => x - y).join(',');
    if (!seen.has(key)) { seen.add(key); rings.push(path); }
  }
  return rings.map((atoms) => {
    const c: [number, number, number] = [0, 0, 0];
    for (const i of atoms) for (let k = 0; k < 3; k++) c[k] += xyz[i * 3 + k] / atoms.length;
    const cov = new Float64Array(9);
    for (const i of atoms) for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) cov[r * 3 + s] += (xyz[i * 3 + r] - c[r]) * (xyz[i * 3 + s] - c[s]);
    const { values, vectors } = eigh(cov, 3);
    const normal: [number, number, number] = [vectors[0], vectors[3], vectors[6]];
    const rms = Math.sqrt(Math.max(values[0], 0) / atoms.length);
    const sp2 = atoms.every((i) => adj[i].length <= 3);
    return { atoms, centroid: c, normal, rms, pi: atoms.length >= 5 && atoms.length <= 7 && rms < 0.15 && sp2 };
  });
}

// ---- orientation -------------------------------------------------------------------------------
/** Translates to the centroid and rotates onto the principal axes of the coordinate distribution (x longest, z shortest). */
export function standardOrientation(xyz: Float64Array): { xyz: Float64Array; rotation: number[] } {
  const n = xyz.length / 3;
  const c = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) c[k] += xyz[i * 3 + k] / n;
  const cov = new Float64Array(9);
  for (let i = 0; i < n; i++) for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) cov[r * 3 + s] += (xyz[i * 3 + r] - c[r]) * (xyz[i * 3 + s] - c[s]);
  if (n === 1) return { xyz: new Float64Array(3), rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
  const { vectors } = eigh(cov, 3); // ascending variance: columns 0 (smallest) .. 2 (largest)
  const ex = [vectors[2], vectors[5], vectors[8]], ey = [vectors[1], vectors[4], vectors[7]];
  const ez = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]]; // right-handed
  const R = [...ex, ...ey, ...ez];
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const p = [xyz[i * 3] - c[0], xyz[i * 3 + 1] - c[1], xyz[i * 3 + 2] - c[2]];
    for (let r = 0; r < 3; r++) out[i * 3 + r] = R[r * 3] * p[0] + R[r * 3 + 1] * p[1] + R[r * 3 + 2] * p[2];
  }
  return { xyz: out, rotation: R };
}

// ---- structure builders ------------------------------------------------------------------------
function structureFromOclMolecule(mol: any, notes: string[], origin: Structure['origin']): Structure {
  const n = mol.getAllAtoms();
  const z: number[] = [];
  const xyz = new Float64Array(n * 3);
  let charge = 0;
  for (let i = 0; i < n; i++) {
    z.push(mol.getAtomicNo(i));
    xyz[i * 3] = mol.getAtomX(i); xyz[i * 3 + 1] = mol.getAtomY(i); xyz[i * 3 + 2] = mol.getAtomZ(i);
    charge += mol.getAtomCharge(i);
    if (mol.getAtomRadical(i) !== 0) throw new Error('Radicals are not supported: this tool computes closed-shell molecules.');
  }
  const bonds: Array<[number, number, number]> = [];
  for (let b = 0; b < mol.getAllBonds(); b++) bonds.push([mol.getBondAtom(0, b), mol.getBondAtom(1, b), Math.max(1, Math.min(3, mol.getBondOrder(b)))]);
  return { z, xyz, charge, bonds, origin, notes };
}

async function embed3D(OCL: OclModule, mol: any, seed: number, optimize: boolean, notes: string[]): Promise<any> {
  const gen = new OCL.ConformerGenerator(seed);
  const conf = gen.getOneConformerAsMolecule(mol);
  if (!conf) throw new Error('Could not generate a 3D conformer for this structure. Check the valences, or supply an XYZ geometry instead.');
  if (optimize) {
    try {
      const ff = new OCL.ForceFieldMMFF94(conf, 'MMFF94s');
      const rc = ff.minimise({ maxIts: 4000 });
      if (rc !== 0) notes.push('MMFF94s minimisation stopped before full convergence.');
    } catch {
      notes.push('MMFF94s could not parametrise every atom; the raw embedded geometry is used.');
    }
  }
  return conf;
}

export interface GeometryRequest { source: 'smiles' | 'xyz' | 'molfile'; text: string; charge?: number; seed?: number; optimize?: boolean }

export async function buildStructure(req: GeometryRequest): Promise<Structure> {
  const notes: string[] = [];
  const text = (req.text ?? '').trim();
  if (!text) throw new Error('Enter a structure first: a SMILES string, XYZ coordinates, or a MOL file.');
  let s: Structure;
  if (req.source === 'xyz') {
    const { z, xyz } = parseXYZ(text);
    s = { z, xyz, charge: Math.round(req.charge ?? 0), bonds: inferBonds(z, xyz), origin: 'xyz', notes };
    notes.push('Geometry used exactly as supplied (Angstrom).');
  } else {
    const OCL = await loadOCL();
    let mol: any;
    if (req.source === 'smiles') {
      const smi = text.split(/\s+/)[0];
      if (smi.includes('.')) throw new Error('Disconnected structures (a "." in the SMILES) cannot be embedded in 3D automatically. Provide an XYZ geometry for complexes and salts.');
      try { mol = OCL.Molecule.fromSmiles(smi); } catch (e: any) { throw new Error(`Could not parse the SMILES: ${e?.message ?? e}`); }
    } else {
      try { mol = OCL.Molecule.fromMolfile(text); } catch (e: any) { throw new Error(`Could not parse the MOL file: ${e?.message ?? e}`); }
    }
    mol.ensureHelperArrays?.(OCL.Molecule.cHelperNeighbours);
    const bad = [...Array(mol.getAllAtoms())].map((_, i) => mol.getAtomicNo(i)).find((zz: number) => zz > MAX_Z || zz < 1);
    if (bad) throw new Error(`Element ${symbolOf(bad)} is not supported. This tool covers hydrogen to calcium.`);
    // keep a 2D copy for drawing before embedding adds hydrogens and 3D coordinates
    const flat = mol.getCompactCopy();
    flat.inventCoordinates?.();
    const molfile2d = (() => { try { return flat.toMolfile(); } catch { return undefined; } })();
    const smiles = (() => { try { return flat.toSmiles(); } catch { return undefined; } })();
    const has3d = req.source === 'molfile' && [...Array(mol.getAllAtoms())].some((_, i) => Math.abs(mol.getAtomZ(i)) > 1e-3);
    let conf: any;
    if (has3d) { mol.addImplicitHydrogens?.(); conf = mol; notes.push('3D coordinates from the MOL file used as supplied.'); }
    else conf = await embed3D(OCL, mol, req.seed ?? 42, req.optimize !== false, notes);
    s = structureFromOclMolecule(conf, notes, req.source);
    s.smiles = smiles;
    s.molfile2d = molfile2d;
    if (!has3d) notes.push(`3D geometry: OpenChemLib conformer (seed ${req.seed ?? 42})${req.optimize !== false ? ' refined with MMFF94s' : ''}. Flexible molecules show one conformer.`);
    if (req.charge !== undefined && req.charge !== s.charge && req.source === 'molfile') s.charge = Math.round(req.charge);
  }
  if (s.z.length > 200) throw new Error('Too many atoms for an in-browser quantum calculation.');
  return s;
}
