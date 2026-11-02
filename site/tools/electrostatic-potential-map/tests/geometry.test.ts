import { describe, it, expect } from 'vitest';
import { buildStructure, parseXYZ, findRings, inferBonds, standardOrientation } from '../src/geometry';
import { zOf } from '../src/chem';

const dist = (xyz: Float64Array, i: number, j: number) => Math.hypot(xyz[i * 3] - xyz[j * 3], xyz[i * 3 + 1] - xyz[j * 3 + 1], xyz[i * 3 + 2] - xyz[j * 3 + 2]);

describe('geometry', () => {
  it('parses XYZ with header, without header, and with atomic numbers', () => {
    const a = parseXYZ('3\nwater\nO 0 0 0\nH 0.96 0 0\nH -0.24 0.93 0\n');
    expect(a.z).toEqual([8, 1, 1]);
    const b = parseXYZ('O 0 0 0\nH 0.96 0 0');
    expect(b.z).toEqual([8, 1]);
    expect(parseXYZ('6 0 0 0\n1 1 0 0').z).toEqual([6, 1]);
    expect(() => parseXYZ('3\nx\nO 0 0 0')).toThrow(/promises 3 atoms/);
    expect(() => parseXYZ('O 0 0')).toThrow(/element x y z/);
    expect(() => parseXYZ('Xx 0 0 0')).toThrow(/Unknown element/);
  });

  it('embeds benzene from SMILES with a planar, correctly sized ring and finds the pi ring', async () => {
    const s = await buildStructure({ source: 'smiles', text: 'c1ccccc1' });
    expect(s.z.filter((z) => z === 6)).toHaveLength(6);
    expect(s.z.filter((z) => z === 1)).toHaveLength(6);
    expect(s.charge).toBe(0);
    const cc = s.bonds.filter(([a, b]) => s.z[a] === 6 && s.z[b] === 6).map(([a, b]) => dist(s.xyz, a, b));
    expect(cc).toHaveLength(6);
    for (const d of cc) expect(d).toBeGreaterThan(1.37), expect(d).toBeLessThan(1.42);
    const rings = findRings(s.z, s.xyz, s.bonds);
    expect(rings).toHaveLength(1);
    expect(rings[0].pi).toBe(true);
    expect(rings[0].rms).toBeLessThan(0.05);
  });

  it('carries formal charge from SMILES and rejects what it cannot do', async () => {
    expect((await buildStructure({ source: 'smiles', text: 'C[NH3+]' })).charge).toBe(1);
    expect((await buildStructure({ source: 'smiles', text: 'CC(=O)[O-]' })).charge).toBe(-1);
    await expect(buildStructure({ source: 'smiles', text: 'c1ccccc1.[Na+]' })).rejects.toThrow(/Disconnected/);
    await expect(buildStructure({ source: 'smiles', text: 'CBr' })).rejects.toThrow(/Br is not supported/);
    await expect(buildStructure({ source: 'smiles', text: 'not a smiles(' })).rejects.toThrow();
    await expect(buildStructure({ source: 'smiles', text: '   ' })).rejects.toThrow(/Enter a structure/);
  });

  it('keeps XYZ coordinates and infers bonds and rings', async () => {
    const R = 1.397, RH = 2.481;
    let txt = '';
    for (let k = 0; k < 6; k++) txt += `C ${R * Math.cos((Math.PI * k) / 3)} ${R * Math.sin((Math.PI * k) / 3)} 0\n`;
    for (let k = 0; k < 6; k++) txt += `H ${RH * Math.cos((Math.PI * k) / 3)} ${RH * Math.sin((Math.PI * k) / 3)} 0\n`;
    const s = await buildStructure({ source: 'xyz', text: txt, charge: 0 });
    expect(s.bonds).toHaveLength(12);
    expect(findRings(s.z, s.xyz, s.bonds)[0].pi).toBe(true);
    void zOf; void inferBonds;
  });

  it('standard orientation puts a planar molecule in the xy plane', async () => {
    const s = await buildStructure({ source: 'smiles', text: 'c1ccncc1' });
    const o = standardOrientation(s.xyz);
    let zmax = 0;
    for (let i = 0; i < s.z.length; i++) zmax = Math.max(zmax, Math.abs(o.xyz[i * 3 + 2]));
    expect(zmax).toBeLessThan(0.1);
    const r = o.rotation;
    const det = r[0] * (r[4] * r[8] - r[5] * r[7]) - r[1] * (r[3] * r[8] - r[5] * r[6]) + r[2] * (r[3] * r[7] - r[4] * r[6]);
    expect(det).toBeCloseTo(1, 8);
  });
});
