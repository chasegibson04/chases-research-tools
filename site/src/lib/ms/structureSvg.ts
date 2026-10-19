// Render a StructureScene to a standalone SVG string (screen and export share this code).
// Interactive hooks: every marker half has data-bond / data-side ("n" = a/b/c side, "c" = x/y/z side),
// every residue band has data-res. Highlighting is done by the caller with CSS rules on these attributes.
import type { StructureScene, SMarker } from './structure';

export interface SvgPalette {
  fg: string; muted: string; faint: string; bg: string; band: string; font: string;
  ion: Record<'a' | 'b' | 'c' | 'x' | 'y' | 'z', string>;
}
export interface SvgOptions {
  palette: SvgPalette;
  unit?: number; // px per bond length
  /** Which marker families to draw on each side, e.g. { n: ['a','b','c'], c: ['x','y','z'] } */
  families: { n: Array<'a' | 'b' | 'c'>; c: Array<'x' | 'y' | 'z'> };
  /** Bond indices with an observed (matched) ion, per side. */
  observed?: { n: Set<number>; c: Set<number> };
  /** Show markers only where observed (annotation mode) instead of every theoretical cleavage. */
  observedOnly?: boolean;
  title?: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FAM_N = { ax: 'a', by: 'b', cz: 'c' } as const;
const FAM_C = { ax: 'x', by: 'y', cz: 'z' } as const;
const SUBD = '₀₁₂₃₄₅₆₇₈₉';
const subNum = (k: number) => String(k).replace(/\d/g, (d) => SUBD[Number(d)]);

export function structureToSvg(scene: StructureScene, o: SvgOptions): string {
  const u = o.unit ?? 38;
  const { minX, maxX, minY, maxY } = scene.bounds;
  const W = (maxX - minX) * u, H = (maxY - minY) * u + (o.title ? 28 : 0);
  const top = o.title ? 28 : 0;
  const X = (x: number) => +((x - minX) * u).toFixed(2);
  const Y = (y: number) => +((maxY - y) * u + top).toFixed(2);
  const P = o.palette;
  const out: string[] = [];
  const fs = Math.round(u * 0.42);
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" width="${W.toFixed(0)}" height="${H.toFixed(0)}" font-family="${esc(P.font)}" font-size="${fs}" class="pep-structure">`);
  out.push(`<style>.pep-structure text{paint-order:stroke;stroke:${P.bg};stroke-width:${(fs * 0.32).toFixed(1)}px;stroke-linejoin:round}.mk{cursor:pointer}.mk .hit{stroke:transparent;stroke-width:${(u * 0.42).toFixed(0)}px;fill:none}.mk text{font-weight:600;cursor:pointer}.mk text:hover{text-decoration:underline}</style>`);
  if (o.title) out.push(`<text x="${(W / 2).toFixed(1)}" y="19" text-anchor="middle" font-size="${fs + 2}" font-weight="600" fill="${P.fg}">${esc(o.title)}</text>`);

  // residue bands (hidden until highlighted)
  out.push('<g class="bands">');
  for (const s of scene.spans) {
    if (scene.cyclic && scene.ring && s.angle0 != null && s.angle1 != null) {
      const r0 = scene.ring.r - 0.45, r1 = scene.ring.r + 0.45;
      const a0 = s.angle0, a1 = s.angle1;
      const pt = (r: number, a: number) => `${X(r * Math.cos(a))},${Y(r * Math.sin(a))}`;
      out.push(`<path data-res="${s.residue}" d="M${pt(r0, a0)} L${pt(r1, a0)} A${(r1 * u).toFixed(1)},${(r1 * u).toFixed(1)} 0 0 1 ${pt(r1, a1)} L${pt(r0, a1)} A${(r0 * u).toFixed(1)},${(r0 * u).toFixed(1)} 0 0 0 ${pt(r0, a0)} Z" fill="${P.band}" opacity="0"/>`);
    } else {
      out.push(`<rect data-res="${s.residue}" x="${X(s.x0)}" y="${Y(0.62)}" width="${((s.x1 - s.x0) * u).toFixed(1)}" height="${(1.24 * u).toFixed(1)}" rx="6" fill="${P.band}" opacity="0"/>`);
    }
  }
  out.push('</g>');

  // markers (drawn under atoms so labels with halos sit on top)
  out.push('<g class="markers">');
  for (const m of scene.markers) out.push(scene.cyclic ? cyclicMarker(m, scene, o, X, Y, u) : linearMarker(m, scene, o, X, Y, u));
  out.push('</g>');

  // bonds
  const labelled = scene.atoms.filter((a) => a.label);
  const near = (x: number, y: number) => labelled.find((a) => Math.abs(a.x - x) < 0.05 && Math.abs(a.y - y) < 0.05);
  out.push(`<g class="bonds" stroke="${P.fg}" stroke-width="${(u * 0.045).toFixed(2)}" stroke-linecap="round">`);
  for (const b of scene.bonds) {
    let { x1, y1, x2, y2 } = b;
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const dx = (x2 - x1) / len, dy = (y2 - y1) / len;
    const a1 = near(x1, y1), a2 = near(x2, y2);
    const trim = (lbl: string) => (lbl.length > 2 ? 0.34 : 0.27);
    if (a1) { x1 += dx * trim(a1.label); y1 += dy * trim(a1.label); }
    if (a2) { x2 -= dx * trim(a2.label); y2 -= dy * trim(a2.label); }
    const line = (ox: number, oy: number, shorten = 0) => `<line x1="${X(x1 + ox + dx * shorten)}" y1="${Y(y1 + oy + dy * shorten)}" x2="${X(x2 + ox - dx * shorten)}" y2="${Y(y2 + oy - dy * shorten)}"/>`;
    const nx = -dy, ny = dx;
    if (b.order === 2 && b.inner) {
      const [cx, cy] = b.inner;
      const side = (cx - (x1 + x2) / 2) * nx + (cy - (y1 + y2) / 2) * ny > 0 ? 1 : -1;
      out.push(line(0, 0), line(nx * 0.16 * side, ny * 0.16 * side, 0.14));
    } else if (b.order === 2) {
      out.push(line(nx * 0.07, ny * 0.07), line(-nx * 0.07, -ny * 0.07));
    } else if (b.order === 3) {
      out.push(line(0, 0), line(nx * 0.12, ny * 0.12), line(-nx * 0.12, -ny * 0.12));
    } else out.push(line(0, 0));
  }
  out.push('</g>');

  // atoms
  out.push(`<g class="atoms" fill="${P.fg}" dominant-baseline="central">`);
  for (const a of scene.atoms) {
    if (!a.label) continue;
    const anchor = a.anchor ?? 'middle';
    const colour = a.role === 'side' && a.small ? P.muted : P.fg;
    const size = a.small ? ` font-size="${Math.round(fs * 0.78)}"` : '';
    out.push(`<text x="${X(a.x)}" y="${Y(a.y)}" text-anchor="${anchor}" data-res-atom="${a.residue}" fill="${colour}"${size}>${esc(a.label)}</text>`);
  }
  out.push('</g>');
  out.push('</svg>');
  return out.join('');
}

function linearMarker(m: SMarker, scene: StructureScene, o: SvgOptions, X: (x: number) => number, Y: (y: number) => number, u: number) {
  const nT = FAM_N[m.family], cT = FAM_C[m.family];
  const showN = o.families.n.includes(nT) && (!o.observedOnly || o.observed?.n.has(m.bond));
  const showC = o.families.c.includes(cT) && (!o.observedOnly || o.observed?.c.has(m.bond));
  if (!showN && !showC) return '';
  const P = o.palette;
  const sw = (u * 0.04).toFixed(2), dash = `${(u * 0.07).toFixed(1)} ${(u * 0.07).toFixed(1)}`;
  const hook = 0.55;
  const parts: string[] = [];
  const seg = (side: 'n' | 'c', type: string, yA: number, yB: number, hookDir: 1 | -1, label: string) => {
    const obs = side === 'n' ? o.observed?.n.has(m.bond) : o.observed?.c.has(m.bond);
    const col = P.ion[type as keyof SvgPalette['ion']];
    const op = o.observed && !obs ? 0.38 : 1;
    const hx = m.x + hookDir * hook;
    const ly = yB + (yB > 0 ? 0.32 : -0.34);
    const lx = m.x + hookDir * (hook + 0.08);
    const d = `M${X(m.x)},${Y(yA)} L${X(m.x)},${Y(yB)} L${X(hx)},${Y(yB)}`;
    parts.push(`<g class="mk" data-bond="${m.bond}" data-side="${side}" data-type="${type}" data-size="${side === 'n' ? m.nIndex : m.cIndex}" opacity="${op}">`
      + `<path class="hit" d="${d}"/>`
      + `<path class="ln" d="${d}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-dasharray="${obs ? 'none' : dash}"/>`
      + `<text data-label="1" x="${X(lx)}" y="${Y(ly)}" text-anchor="${hookDir > 0 ? 'start' : 'end'}" fill="${col}" font-size="${Math.round(u * 0.36)}" dominant-baseline="central">${type}${subNum(side === 'n' ? m.nIndex : m.cIndex)}</text></g>`);
  };
  if (scene.mode === 'condensed') {
    if (showC) seg('c', cT, 0.3, scene.rows.top, 1, '');
    if (showN) seg('n', nT, -0.3, scene.rows.bottom, -1, '');
  } else {
    if (showN) seg('n', nT, -0.3, scene.rows.bottom, -1, '');
    if (showC) seg('c', cT, showN ? scene.rows.bottom : -0.3, scene.rows.bottom2, 1, '');
  }
  return parts.join('');
}

function cyclicMarker(m: SMarker, scene: StructureScene, o: SvgOptions, X: (x: number) => number, Y: (y: number) => number, u: number) {
  // Cyclic fragments are b/a-type (amide / Cα–C cuts) and, for ETD-type arcs, c-type (N–Cα) cuts. Each cut is drawn as a
  // line through the ring that continues to a label inside the ring: dashed = no assigned ion, solid = observed.
  const type = m.family === 'by' ? 'b' : m.family === 'ax' ? 'a' : 'c';
  if (!o.families.n.includes(type)) return '';
  const obs = o.observed?.n.has(m.bond);
  if (o.observedOnly && !obs) return '';
  const col = o.palette.ion[type];
  const n = scene.spans.length || 1;
  const site = type === 'c' ? (m.bond / 3 === 0 ? n : m.bond / 3) : Math.floor(m.bond / 3) + 1; // cleavage after residue `site` (1-based)
  const R = scene.ring?.r ?? 4;
  const lab = Math.max(0.9, Math.min({ b: 2.0, a: 2.9, c: 3.8 }[type], R - 1.1)); // staggered so neighbouring cuts do not collide
  const r0 = -(lab - 0.4), r1 = 0.5;
  const d = `M${X(m.x + m.nx * r0)},${Y(m.y + m.ny * r0)} L${X(m.x + m.nx * r1)},${Y(m.y + m.ny * r1)}`;
  const dash = `${(u * 0.07).toFixed(1)} ${(u * 0.06).toFixed(1)}`;
  const lx = X(m.x - m.nx * lab), ly = Y(m.y - m.ny * lab);
  const sw = (u * (obs ? 0.055 : 0.04)).toFixed(2);
  return `<g class="mk" data-bond="${m.bond}" data-side="n" data-type="${type}" data-size="${site}" opacity="${o.observed && !obs ? 0.55 : 1}"><path class="hit" d="${d}"/><path class="ln" d="${d}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-dasharray="${obs ? 'none' : dash}"/>`
    + `<text data-label="1" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="central" fill="${col}" font-size="${Math.round(u * 0.6)}" font-weight="600">${type}${subNum(site)}</text></g>`;
}
