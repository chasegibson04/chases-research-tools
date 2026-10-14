// Layout of a peptide as a 2D structure diagram with backbone cleavage markers (pure; no DOM).
// Units: 1 = one backbone bond length; +y is up (the renderer flips for SVG).
//   linear: H2N–Cα–C(=O)–N(H)–Cα–…–COOH on a straight line (as in the classic CID/ETD figure)
//   cyclic: the same backbone atoms around a circle, side chains pointing outward, C=O and N–H inward
// Side chains come from sidechains.json (RDKit-generated, see sidechains/generate_sidechains.py).
import sideData from './sidechains/sidechains.json';
import type { Peptide, Residue } from './sequence';
import { bondIndex } from './fragments';

export type StructureMode = 'condensed' | 'full';
export interface SAtom { x: number; y: number; label: string; anchor?: 'start' | 'middle' | 'end'; residue: number; role: 'backbone' | 'side' | 'h' | 'o' | 'term'; small?: boolean }
export interface SBond { x1: number; y1: number; x2: number; y2: number; order: number; residue: number; role: 'backbone' | 'side' | 'h' | 'o'; offset?: -1 | 0 | 1; inner?: [number, number] }
/** A cleavable backbone bond with its marker geometry. */
export interface SMarker {
  bond: number; // bondIndex value
  family: 'ax' | 'by' | 'cz';
  /** Midpoint of the bond. */
  x: number; y: number;
  /** Unit normal pointing to the "top" side (x/y/z side in linear condensed; outward in cyclic). */
  nx: number; ny: number;
  /** Unit tangent pointing toward the C-terminus (linear) / clockwise (cyclic). */
  tx: number; ty: number;
  nIndex: number; // N-terminal ion index (a/b/c), linear
  cIndex: number; // C-terminal ion index (x/y/z), linear
}
export interface SResidueSpan { residue: number; x0: number; x1: number; cx: number; cy: number; angle0?: number; angle1?: number }
export interface StructureScene {
  atoms: SAtom[]; bonds: SBond[]; markers: SMarker[]; spans: SResidueSpan[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  cyclic: boolean; mode: StructureMode;
  /** Cyclic only: ring centre and radius. */
  ring?: { cx: number; cy: number; r: number };
  /** Linear: marker rows (y of hooks) so the renderer can stack labels. */
  rows: { top: number; bottom: number; bottom2: number };
}

interface SideFrag { atoms: Array<{ el: string; x: number; y: number; h: number; q: number; ar: boolean }>; bonds: Array<{ a: number; b: number; o: number; ar: boolean }>; attach: number | null; attach2?: number; closesN: number | null; bbox: number[] }
const SIDE = (sideData as unknown as { residues: Record<string, SideFrag> }).residues;

const SUBS: Record<string, string> = { 2: '₂', 3: '₃', 4: '₄' };
const hLabel = (n: number) => (n === 0 ? '' : n === 1 ? 'H' : `H${SUBS[n] ?? n}`);
function atomLabel(el: string, h: number, q: number, terminalLeft = false) {
  const charge = q > 0 ? '⁺' : q < 0 ? '⁻' : '';
  if (el === 'C') return '';
  const hs = hLabel(h);
  return (terminalLeft && hs ? hs + el : el + hs) + charge;
}

/** Pick a precomputed side chain: modified variant if available ("M+Oxidation"), else the base residue. */
function sideFor(r: Residue): { frag: SideFrag | null; modNote: string } {
  for (const m of r.mods) {
    const key = `${r.def.code}+${m.name}`;
    if (SIDE[key]) return { frag: SIDE[key], modNote: r.mods.filter((x) => x !== m).map((x) => x.label).join(',') };
  }
  return { frag: SIDE[r.def.code] ?? null, modNote: r.mods.map((m) => m.label).join(',') };
}

const MOD_CONDENSED: Record<string, string> = {
  'M+Oxidation': '(CH₂)₂S(O)CH₃', 'S+Phospho': 'CH₂OPO₃H₂', 'T+Phospho': 'CH(OPO₃H₂)CH₃', 'Y+Phospho': 'CH₂C₆H₄OPO₃H₂',
  'C+Carbamidomethyl': 'CH₂SCH₂CONH₂', 'K+Acetyl': '(CH₂)₄NHAc', 'K+Methyl': '(CH₂)₄NHCH₃', 'K+Dimethyl': '(CH₂)₄N(CH₃)₂', 'K+Trimethyl': '(CH₂)₄N(CH₃)₃⁺',
};
function condensedLabel(r: Residue) {
  for (const m of r.mods) { const k = `${r.def.code}+${m.name}`; if (MOD_CONDENSED[k]) return { text: MOD_CONDENSED[k], extra: r.mods.filter((x) => x !== m).map((x) => x.label) }; }
  return { text: r.def.side, extra: r.mods.map((m) => m.label) };
}
/** Rough text width in bond-length units for the label font (0.42 units tall). */
const textW = (s: string) => [...s].reduce((w, c) => w + (/[₀-₉⁺⁻]/.test(c) ? 0.2 : /[()\-·]/.test(c) ? 0.16 : /[A-Z]/.test(c) ? 0.33 : 0.27), 0);

/** Side-chain points in the local residue frame, each with a clearance radius (labels need more room). */
function sidePoints(r: Residue, mode: StructureMode): Array<[number, number, number]> {
  if (mode === 'condensed' && !r.def.ringToN) {
    const { text, extra } = condensedLabel(r);
    const w = textW(r.def.code === 'G' && !r.mods.length ? 'H' : text);
    const pts: Array<[number, number, number]> = [];
    for (let x = -w / 2; x <= w / 2 + 1e-9; x += 0.25) pts.push([x, 1.72, 0.2]);
    extra.forEach((e, i) => { const we = textW(`+${e}`) * 0.78; for (let x = -we / 2; x <= we / 2; x += 0.25) pts.push([x, 2.15 + i * 0.4, 0.18]); });
    return pts;
  }
  const f = sideFor(r).frag;
  if ((!f || !f.atoms.length) && r.def.side && r.def.side !== 'H' && !SIDE[r.def.code]) return sidePoints(r, 'condensed');
  if (!f || !f.atoms.length) return [[0, 1, 0.3]];
  return f.atoms.map((a) => [a.x, a.y, a.el === 'C' ? 0.42 : 0.5 + 0.12 * (a.h + (a.q ? 1 : 0))]);
}

const nTermLabel = (p: Peptide, r0: Residue) => {
  const mod = p.nTermMods.map((m) => m.label).join('·');
  if (r0.def.ringToN) return mod ? `${mod}–N` : 'HN';
  if (r0.nMethyl) return mod ? `${mod}–N(CH₃)` : 'H(CH₃)N';
  return mod ? `${mod}–HN` : 'H₂N';
};
const cTermLabel = (p: Peptide) => {
  const m = p.cTermMods[0];
  if (!m) return 'COOH';
  if (m.name === 'Amidated') return 'CONH₂';
  if (m.name === 'Methyl') return 'COOCH₃';
  return `CO–[${m.label}]`;
};

/** Side-chain extent in local frame including the condensed label or full fragment. */
function sideExtent(r: Residue, mode: StructureMode): [number, number, number] {
  if (mode === 'condensed' && !r.def.ringToN) {
    const { text, extra } = condensedLabel(r);
    const w = Math.max(textW(text), ...extra.map((e) => textW(`+${e}`) * 0.8));
    return [-w / 2, w / 2, 1.3 + (extra.length ? 0.45 : 0)];
  }
  const f = sideFor(r).frag;
  if (!f || !f.atoms.length) return [-0.3, 0.3, 1];
  return [f.bbox[0] - 0.3, f.bbox[2] + 0.3, f.bbox[3] + 0.3];
}

export function layoutStructure(p: Peptide, mode: StructureMode = 'full'): StructureScene {
  return p.cyclic ? layoutCyclic(p, mode) : layoutLinear(p, mode);
}

// ---------------------------------------------------------------------------------------------
function placeSide(r: Residue, k: number, mode: StructureMode, ca: [number, number], up: [number, number], right: [number, number], atoms: SAtom[], bonds: SBond[], nPos: [number, number] | null) {
  const T = (x: number, y: number): [number, number] => [ca[0] + right[0] * x + up[0] * y, ca[1] + right[1] * x + up[1] * y];
  const isRing = !!r.def.ringToN;
  if (mode === 'condensed' && !isRing) {
    const { text, extra } = condensedLabel(r);
    const [lx, ly] = T(0, 1.72);
    bonds.push({ x1: ca[0], y1: ca[1], x2: T(0, 1.42)[0], y2: T(0, 1.42)[1], order: 1, residue: k, role: 'side' });
    atoms.push({ x: lx, y: ly, label: r.def.code === 'G' && !r.mods.length ? 'H' : text, residue: k, role: 'side' });
    extra.forEach((e, i) => { const [ex, ey] = T(0, 2.15 + i * 0.4); atoms.push({ x: ex, y: ey, label: `+${e}`, residue: k, role: 'side', small: true }); });
    return;
  }
  const { frag, modNote } = sideFor(r);
  if ((!frag || !frag.atoms.length) && r.def.side && r.def.side !== 'H' && !SIDE[r.def.code]) {
    // No precomputed geometry: fall back to the condensed formula.
    placeSide(r, k, 'condensed', ca, up, right, atoms, bonds, nPos);
    return;
  }
  if (!frag || !frag.atoms.length) {
    const [hx, hy] = T(0, 1);
    bonds.push({ x1: ca[0], y1: ca[1], x2: T(0, 0.7)[0], y2: T(0, 0.7)[1], order: 1, residue: k, role: 'h' });
    atoms.push({ x: hx, y: hy, label: 'H', residue: k, role: 'h' });
    return;
  }
  const pts = frag.atoms.map((a) => T(a.x, a.y));
  const labels = frag.atoms.map((a, i) => {
    const deg = frag.bonds.filter((b) => b.a === i || b.b === i).length + (frag.attach === i ? 1 : 0) + (frag.closesN === i ? 1 : 0);
    const lbl = a.el === 'C' && (a.q !== 0) ? 'C' + (a.q > 0 ? '⁺' : '⁻') : atomLabel(a.el, a.h, a.q, deg <= 1 && a.x < -0.2);
    return lbl;
  });
  pts.forEach(([x, y], i) => { if (labels[i]) atoms.push({ x, y, label: labels[i], residue: k, role: 'side' }); });
  // ring centroids for inner double-bond offsets
  const centroidFor = (a: number, b: number): [number, number] | undefined => {
    const nb = (i: number) => frag.bonds.filter((x) => x.ar && (x.a === i || x.b === i)).map((x) => (x.a === i ? x.b : x.a));
    const ring = new Set([a, b, ...nb(a), ...nb(b)]);
    if (ring.size < 4) return undefined;
    const arr = [...ring].map((i) => pts[i]);
    return [arr.reduce((s, q) => s + q[0], 0) / arr.length, arr.reduce((s, q) => s + q[1], 0) / arr.length];
  };
  for (const b of frag.bonds) {
    const [x1, y1] = pts[b.a], [x2, y2] = pts[b.b];
    bonds.push({ x1, y1, x2, y2, order: b.o, residue: k, role: 'side', inner: b.o === 2 && b.ar ? centroidFor(b.a, b.b) : undefined, offset: b.o === 2 && !b.ar ? 0 : undefined });
  }
  if (frag.attach != null) bonds.push({ x1: ca[0], y1: ca[1], x2: pts[frag.attach][0], y2: pts[frag.attach][1], order: 1, residue: k, role: 'side' });
  if (frag.attach2 != null) bonds.push({ x1: ca[0], y1: ca[1], x2: pts[frag.attach2][0], y2: pts[frag.attach2][1], order: 1, residue: k, role: 'side' });
  if (frag.closesN != null && nPos) bonds.push({ x1: pts[frag.closesN][0], y1: pts[frag.closesN][1], x2: nPos[0], y2: nPos[1], order: 1, residue: k, role: 'side' });
  if (modNote) {
    const top = Math.max(...frag.atoms.map((a) => a.y));
    const [mx, my] = T(frag.bbox[0] + (frag.bbox[2] - frag.bbox[0]) / 2, top + 0.55);
    atoms.push({ x: mx, y: my, label: `+${modNote}`, residue: k, role: 'side', small: true });
  }
}

function layoutLinear(p: Peptide, mode: StructureMode): StructureScene {
  const n = p.residues.length;
  const atoms: SAtom[] = [], bonds: SBond[] = [], markers: SMarker[] = [], spans: SResidueSpan[] = [];
  const pts = p.residues.map((r) => sidePoints(r, mode));
  // x positions of N, Cα, C per residue; widen the amide bond only where atoms of neighbouring
  // side chains (or the previous carbonyl O) would come closer than their clearance radii.
  const xs: Array<[number, number, number]> = [];
  let x = 0;
  for (let k = 0; k < n; k++) {
    if (k > 0) {
      const prevCa = xs[k - 1][1];
      const prev: Array<[number, number, number]> = [...pts[k - 1].map(([px, py, pr]) => [prevCa + px, py, pr] as [number, number, number]), [xs[k - 1][2], 1, 0.35]];
      if (k > 1) prev.push(...pts[k - 2].map(([px, py, pr]) => [xs[k - 2][1] + px, py, pr] as [number, number, number]));
      let gap = 0;
      const clash = (g: number) => pts[k].some(([px, py, pr]) => prev.some(([qx, qy, qr]) => Math.hypot(x + g + 1 + px - qx, py - qy) < pr + qr));
      while (gap < 8 && clash(gap)) gap += 0.2;
      x += gap;
    }
    xs.push([x, x + 1, x + 2]);
    x += 3;
  }
  const up: [number, number] = [0, 1], right: [number, number] = [1, 0];
  for (let k = 0; k < n; k++) {
    const r = p.residues[k];
    const [xn, xa, xc] = xs[k];
    // N
    if (k === 0) atoms.push({ x: xn + 0.18, y: 0, label: nTermLabel(p, r), anchor: 'end', residue: k, role: 'term' });
    else {
      atoms.push({ x: xn, y: 0, label: 'N', residue: k, role: 'backbone' });
      if (!r.def.ringToN) {
        bonds.push({ x1: xn, y1: 0, x2: xn, y2: -0.72, order: 1, residue: k, role: 'h' });
        atoms.push({ x: xn, y: -1, label: r.nMethyl ? 'CH₃' : 'H', residue: k, role: 'h' });
      }
    }
    // Cα
    atoms.push({ x: xa, y: 0, label: 'C', residue: k, role: 'backbone' });
    if (r.def.alphaMethyl) { /* Aib: drawn by side fragment (up + down methyls) */ }
    else { bonds.push({ x1: xa, y1: 0, x2: xa, y2: -0.72, order: 1, residue: k, role: 'h' }); atoms.push({ x: xa, y: -1, label: 'H', residue: k, role: 'h' }); }
    placeSide(r, k, mode, [xa, 0], up, right, atoms, bonds, [xn, 0]);
    // C(=O) — the C-terminal carbonyl is written as one "COOH" label
    if (k === n - 1) atoms.push({ x: xc - 0.18, y: 0, label: cTermLabel(p), anchor: 'start', residue: k, role: 'term' });
    else {
      atoms.push({ x: xc, y: 0, label: 'C', residue: k, role: 'backbone' });
      bonds.push({ x1: xc, y1: 0, x2: xc, y2: 0.75, order: 2, residue: k, role: 'o', offset: 0 });
      atoms.push({ x: xc, y: 1, label: 'O', residue: k, role: 'o' });
    }
    // backbone bonds
    bonds.push({ x1: xn, y1: 0, x2: xa, y2: 0, order: 1, residue: k, role: 'backbone' });
    bonds.push({ x1: xa, y1: 0, x2: xc, y2: 0, order: 1, residue: k, role: 'backbone' });
    if (k < n - 1) bonds.push({ x1: xc, y1: 0, x2: xs[k + 1][0], y2: 0, order: 1, residue: k, role: 'backbone' });
    spans.push({ residue: k, x0: xn - 0.45, x1: xc + 0.45, cx: xa, cy: 0 });
  }
  for (let k = 0; k < n - 1; k++) {
    const [, xa, xc] = xs[k], xn2 = xs[k + 1][0], xa2 = xs[k + 1][1];
    const mk = (bond: number, family: SMarker['family'], mx: number): SMarker => ({ bond, family, x: mx, y: 0, nx: 0, ny: 1, tx: 1, ty: 0, nIndex: k + 1, cIndex: n - k - 1 });
    markers.push(mk(bondIndex.aX(k), 'ax', (xa + xc) / 2), mk(bondIndex.bY(k), 'by', (xc + xn2) / 2), mk(bondIndex.cZ(k), 'cz', (xn2 + xa2) / 2));
  }
  const ys = [...atoms.map((a) => a.y), ...bonds.flatMap((b) => [b.y1, b.y2])];
  const top = Math.max(1.7, ...ys) + (mode === 'condensed' ? 0.55 : 0.35);
  return {
    atoms, bonds, markers, spans, cyclic: false, mode,
    rows: mode === 'condensed' ? { top, bottom: -1.75, bottom2: -1.75 } : { top, bottom: -1.75, bottom2: -2.55 },
    bounds: { minX: Math.min(-1.6, ...atoms.map((a) => a.x - (a.anchor === 'end' ? textW(a.label) : 0))) - 0.4, maxX: Math.max(...atoms.map((a) => a.x + (a.anchor === 'start' ? textW(a.label) : 0.3))) + 0.6, minY: (mode === 'condensed' ? -1.75 : -2.55) - 0.75, maxY: (mode === 'condensed' ? top + 0.75 : top + 0.3) },
  };
}

function layoutCyclic(p: Peptide, mode: StructureMode): StructureScene {
  const n = p.residues.length;
  const atoms: SAtom[] = [], bonds: SBond[] = [], markers: SMarker[] = [], spans: SResidueSpan[] = [];
  // Arc lengths: within a residue 1, amide bond 1 + extra room for wide side chains (measured along the ring).
  const ext = p.residues.map((r) => sideExtent(r, mode));
  // Cα(k) → Cα(k+1) is 3 bond-arcs plus the extra gap; side chains fan outward, so this is conservative.
  const raw = p.residues.map((_, k) => Math.max(0, ext[k][1] - ext[(k + 1) % n][0] + 0.35 - 3));
  // Spread half of the extra room around the whole ring so one bulky residue doesn't create a single long bond.
  const spread = raw.reduce((a, b) => a + b, 0) / (2 * n);
  const gaps = raw.map((g) => g * 0.5 + spread);
  const seg: number[] = [];
  for (let k = 0; k < n; k++) seg.push(1, 1, 1 + gaps[k]);
  let total = seg.reduce((s, v) => s + v, 0);
  // Side chains grow outward, so arc length at the backbone undercounts their room; enforce a minimum radius.
  let R = total / (2 * Math.PI);
  const minR = Math.max(2.2, n * 0.62);
  if (R < minR) { const scale = (2 * Math.PI * minR) / total; for (let i = 0; i < seg.length; i++) seg[i] *= scale; total = 2 * Math.PI * minR; R = minR; }
  // Angles: start at the top, go clockwise.
  const angle: number[] = [];
  let acc = 0;
  for (let i = 0; i < 3 * n; i++) { angle.push(Math.PI / 2 - (acc / total) * 2 * Math.PI); acc += seg[i]; }
  const P = (i: number, rad = R): [number, number] => [rad * Math.cos(angle[i % (3 * n)]), rad * Math.sin(angle[i % (3 * n)])];
  const normal = (i: number): [number, number] => [Math.cos(angle[i]), Math.sin(angle[i])];
  const tangent = (i: number): [number, number] => [Math.sin(angle[i]), -Math.cos(angle[i])]; // clockwise
  for (let k = 0; k < n; k++) {
    const r = p.residues[k];
    const iN = 3 * k, iA = 3 * k + 1, iC = 3 * k + 2;
    const pN = P(iN), pA = P(iA), pC = P(iC), pNext = P((iC + 1) % (3 * n));
    atoms.push({ x: pN[0], y: pN[1], label: 'N', residue: k, role: 'backbone' });
    if (!r.def.ringToN) {
      const [hx, hy] = P(iN, R - 0.95); const [bx, by] = P(iN, R - 0.7);
      bonds.push({ x1: pN[0], y1: pN[1], x2: bx, y2: by, order: 1, residue: k, role: 'h' });
      atoms.push({ x: hx, y: hy, label: r.nMethyl ? 'CH₃' : 'H', residue: k, role: 'h', small: r.nMethyl });
    }
    atoms.push({ x: pA[0], y: pA[1], label: 'C', residue: k, role: 'backbone' });
    placeSide(r, k, mode, pA, normal(iA), tangent(iA), atoms, bonds, pN);
    atoms.push({ x: pC[0], y: pC[1], label: 'C', residue: k, role: 'backbone' });
    const [ox, oy] = P(iC, R - 1), [obx, oby] = P(iC, R - 0.75);
    bonds.push({ x1: pC[0], y1: pC[1], x2: obx, y2: oby, order: 2, residue: k, role: 'o', offset: 0 });
    atoms.push({ x: ox, y: oy, label: 'O', residue: k, role: 'o' });
    bonds.push({ x1: pN[0], y1: pN[1], x2: pA[0], y2: pA[1], order: 1, residue: k, role: 'backbone' });
    bonds.push({ x1: pA[0], y1: pA[1], x2: pC[0], y2: pC[1], order: 1, residue: k, role: 'backbone' });
    bonds.push({ x1: pC[0], y1: pC[1], x2: pNext[0], y2: pNext[1], order: 1, residue: k, role: 'backbone' });
    spans.push({ residue: k, x0: 0, x1: 0, cx: pA[0], cy: pA[1], angle0: (angle[iN] + (iN === 0 ? angle[3 * n - 1] - 2 * Math.PI : angle[iN - 1])) / 2, angle1: (angle[iC] + (iC + 1 < 3 * n ? angle[iC + 1] : angle[0] - 2 * Math.PI)) / 2 });
    // markers on the three bonds that leave this residue's Cα/C toward the next residue
    const mid = (a: [number, number], b: [number, number]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as [number, number];
    const mkr = (bond: number, family: SMarker['family'], a: [number, number], b: [number, number]): SMarker => {
      const [mx, my] = mid(a, b); const len = Math.hypot(mx, my) || 1;
      const t: [number, number] = [b[0] - a[0], b[1] - a[1]]; const tl = Math.hypot(t[0], t[1]) || 1;
      return { bond, family, x: mx, y: my, nx: mx / len, ny: my / len, tx: t[0] / tl, ty: t[1] / tl, nIndex: k + 1, cIndex: n - k - 1 };
    };
    const pN2 = P((iC + 1) % (3 * n)), pA2 = P((iC + 2) % (3 * n));
    markers.push(mkr(bondIndex.aX(k), 'ax', pA, pC), mkr(bondIndex.bY(k), 'by', pC, pN2), mkr(bondIndex.cZ(k) % (3 * n), 'cz', pN2, pA2));
  }
  const all = [...atoms.map((a) => [a.x, a.y]), ...bonds.flatMap((b) => [[b.x1, b.y1], [b.x2, b.y2]])];
  const pad = 0.9;
  return {
    atoms, bonds, markers, spans, cyclic: true, mode, ring: { cx: 0, cy: 0, r: R },
    rows: { top: 0, bottom: 0, bottom2: 0 },
    bounds: { minX: Math.min(...all.map((q) => q[0])) - pad, maxX: Math.max(...all.map((q) => q[0])) + pad, minY: Math.min(...all.map((q) => q[1])) - pad, maxY: Math.max(...all.map((q) => q[1])) + pad },
  };
}
