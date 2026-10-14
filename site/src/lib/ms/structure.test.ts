import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { parseSequence } from './sequence';
import { layoutStructure } from './structure';
import { structureToSvg, type SvgPalette } from './structureSvg';
import { generateFragments } from './fragments';

const palette: SvgPalette = { fg: '#1c1a17', muted: '#5c574f', faint: '#9a948a', bg: '#ffffff', band: 'rgb(139 38 53 / 0.12)', font: 'Arial, sans-serif', ion: { a: '#009e73', b: '#0072b2', c: '#56b4e9', x: '#cc79a7', y: '#d55e00', z: '#e69f00' } };
const fam = { n: ['a', 'b', 'c'] as Array<'a' | 'b' | 'c'>, c: ['x', 'y', 'z'] as Array<'x' | 'y' | 'z'> };

describe('structure layout', () => {
  it('linear: one marker family per backbone bond, bonds match the fragment engine', () => {
    const p = parseSequence('DRVYIHPF');
    const s = layoutStructure(p, 'full');
    expect(s.markers).toHaveLength(3 * 7);
    const ions = generateFragments(p, { ionTypes: ['b', 'y', 'a', 'x', 'c', 'z•'], maxCharge: 1, precursorCharge: 1, losses: { h2o: false, nh3: false, mod: false, maxLosses: 0 } });
    const markerBonds = new Set(s.markers.map((m) => m.bond));
    for (const ion of ions) for (const b of ion.bonds) expect(markerBonds.has(b)).toBe(true);
    expect(s.atoms.find((a) => a.role === 'term' && a.label === 'H₂N')).toBeDefined();
    expect(s.atoms.find((a) => a.role === 'term' && a.label === 'COOH')).toBeDefined();
  });
  it('cyclic: backbone atoms on a circle with 3 markers per residue', () => {
    const p = parseSequence('cyclo(V(Orn)LfPV(Orn)LfP)');
    const s = layoutStructure(p, 'full');
    expect(s.cyclic).toBe(true);
    expect(s.markers).toHaveLength(30);
    const r = s.ring!.r;
    for (const a of s.atoms.filter((x) => x.role === 'backbone')) expect(Math.hypot(a.x, a.y)).toBeCloseTo(r, 6);
  });
  it('renders SVG with interactive data attributes (writes previews when PEP_PREVIEW_DIR is set)', () => {
    const cases: Array<[string, string, 'full' | 'condensed']> = [
      ['angiotensin-full', 'DRVYIHPF', 'full'], ['angiotensin-condensed', 'DRVYIHPF', 'condensed'], ['mods-full', '[Acetyl]-PEPS[Phospho]M[Oxidation]WK-[Amidated]', 'full'],
      ['gramicidin-full', 'cyclo(V(Orn)LfPV(Orn)LfP)', 'full'], ['cilengitide-full', 'cyclo(RGDf(MeV))', 'full'], ['cilengitide-condensed', 'cyclo(RGDf(MeV))', 'condensed'],
    ];
    const dir = process.env.PEP_PREVIEW_DIR;
    if (dir) mkdirSync(dir, { recursive: true });
    for (const [name, seq, mode] of cases) {
      const svg = structureToSvg(layoutStructure(parseSequence(seq), mode), { palette, families: fam, title: seq });
      expect(svg).toContain('data-bond=');
      expect(svg.startsWith('<svg')).toBe(true);
      if (dir) writeFileSync(`${dir}/${name}.svg`, svg);
    }
  });
});
