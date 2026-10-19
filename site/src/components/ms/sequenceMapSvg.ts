// Sequence map: the peptide as a row of residue letters with fragment-ion flags, in the style of the usual
// "assign a peptide to the spectrum" figure. Linear peptides get b/a/c flags below and y/x/z flags above the
// cleavage sites; cyclic peptides get coverage bars (one per observed ring fragment) because a ring needs two cuts.
// Pure: returns an SVG string. Interactive hooks mirror structureSvg.ts: data-bond/data-side on cleavage flags,
// data-res on residue bands, data-ids (space separated ion ids) on every flag or bar.
import type { Peptide } from '@/lib/ms/sequence';
import type { Ion } from '@/lib/ms/fragments';
import { bondIndex, sub } from '@/lib/ms/fragments';
import type { MsPalette } from './palette';
import { ionColor } from './palette';
import { seriesOf, type SeriesKey } from './SeriesToggles';

export interface SeqMapOptions {
  palette: MsPalette;
  /** Ions to flag (already filtered by the visibility toggles). */
  ions: Ion[];
  /** Series (a/b/c/x/y/z) to show as faint theoretical cleavages when observedOnly is false (linear only). */
  theoretical?: Set<SeriesKey>;
  observedOnly: boolean;
  title?: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const N_SERIES: SeriesKey[] = ['b', 'a', 'c'];
const C_SERIES: SeriesKey[] = ['y', 'x', 'z'];
const ROW = 24;

/** Residue label and the width its cell needs. */
const cell = (token: string) => ({ text: token, w: Math.max(56, token.length * 10 + 26) });

export function sequenceMapSvg(p: Peptide, o: SeqMapOptions): string {
  return ladder(p, o);
}

function frame(W: number, H: number, P: MsPalette, body: string, title?: string) {
  const fs = 15;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${esc(P.font)}" font-size="${fs}" class="pep-structure seq-map" style="width:100%;max-width:${Math.round(W * 1.45)}px;height:auto">`
    + `<style>.seq-map text{paint-order:stroke;stroke:${P.bg};stroke-width:3px;stroke-linejoin:round}.seq-map .mk{cursor:pointer}.seq-map .mk .hit{stroke:transparent;stroke-width:12px;fill:none}.seq-map .mk text{font-weight:600}.seq-map .mk:hover .ln{stroke-width:3px}.seq-map .mk:hover text{text-decoration:underline}</style>`
    + (title ? `<text x="${W / 2}" y="18" text-anchor="middle" font-size="${fs + 1}" font-weight="600" fill="${P.fg}">${esc(title)}</text>` : '')
    + body + '</svg>';
}

function ladder(p: Peptide, o: SeqMapOptions): string {
  const P = o.palette, n = p.residues.length;
  const cells = p.residues.map((r) => cell(r.token));
  const x0 = 30;
  const edge: number[] = []; // x of each residue's left edge, plus the right end
  let x = x0;
  for (const c of cells) { edge.push(x); x += c.w; }
  edge.push(x);
  const W = Math.ceil(x + x0);

  // group observed ions: series + bond k (cleavage after residue k-1)
  const groups = new Map<string, { series: SeriesKey; k: number; ions: Ion[] }>();
  for (const ion of o.ions) {
    const s = seriesOf(ion);
    if (![...N_SERIES, ...C_SERIES].includes(s) || ion.loss && false) continue;
    const k = N_SERIES.includes(s) ? ion.size : n - ion.size;
    if (k < 1 || k > n - 1) continue;
    const key = `${s}|${k}`;
    (groups.get(key) ?? groups.set(key, { series: s, k, ions: [] }).get(key)!).ions.push(ion);
  }
  const present = (list: SeriesKey[]) => list.filter((s) => [...groups.values()].some((g) => g.series === s) || (!o.observedOnly && o.theoretical?.has(s)));
  const topS = p.cyclic ? [] : present(C_SERIES), botS = present(N_SERIES);
  const bandTop = 28 + topS.length * ROW + (o.title ? 22 : 0) + 14, bandH = 34;
  const bandBot = bandTop + bandH;
  const H = Math.ceil(bandBot + botS.length * ROW + 30);
  const out: string[] = [];

  out.push('<g class="bands">');
  cells.forEach((_, i) => out.push(`<rect data-res="${i}" x="${edge[i] + 1}" y="${bandTop - 2}" width="${cells[i].w - 2}" height="${bandH + 4}" rx="5" fill="${P.band}" opacity="0"/>`));
  out.push('</g>');

  out.push(`<g class="letters" fill="${P.fg}" text-anchor="middle" dominant-baseline="central" font-size="${cells.some((c) => c.text.length > 1) ? 16 : 22}" font-weight="600">`);
  cells.forEach((c, i) => out.push(`<text x="${edge[i] + c.w / 2}" y="${bandTop + bandH / 2}" style="stroke:none">${esc(c.text)}</text>`));
  out.push('</g>');
  out.push(`<g class="termini" fill="${P.faint}" font-size="11" dominant-baseline="central"><text x="${edge[0] - 6}" y="${bandTop + bandH / 2}" text-anchor="end" stroke="none">N</text><text x="${edge[n] + 6}" y="${bandTop + bandH / 2}" text-anchor="start" stroke="none">C</text></g>`);

  const flag = (g: { series: SeriesKey; k: number; ions: Ion[] } | null, series: SeriesKey, k: number, side: 'n' | 'c', obs: boolean) => {
    const bx = edge[k];
    const j = (side === 'c' ? topS : botS).indexOf(series);
    if (j < 0) return '';
    const col = P.ion[series as 'a'];
    const size = side === 'n' ? k : n - k;
    const bond = p.cyclic ? (series === 'a' ? bondIndex.aX(k - 1) : series === 'c' ? bondIndex.cZ(k - 1) : bondIndex.bY(k - 1)) % (3 * n) : series === 'a' || series === 'x' ? bondIndex.aX(k - 1) : series === 'c' || series === 'z' ? bondIndex.cZ(k - 1) : bondIndex.bY(k - 1);
    const label = p.cyclic ? `${series}×${g?.ions.length ?? 0}` : `${series}${sub(String(size))}`;
    const ids = (g?.ions ?? []).map((i) => i.id).join(' ');
    const dx = side === 'c' ? 8 : -8;
    const yBand = side === 'c' ? bandTop - 2 : bandBot + 2;
    const yFlag = side === 'c' ? bandTop - 10 - j * ROW : bandBot + 10 + j * ROW;
    const d = `M${bx + dx},${yBand} L${bx + dx},${yFlag} L${bx + dx * 1.9},${yFlag}`;
    const ly = side === 'c' ? yFlag - 9 : yFlag + 10;
    const op = obs ? 1 : 0.35;
    return `<g class="mk" data-bond="${bond}" data-side="${side}" data-type="${series}" data-size="${size}" data-ids="${esc(ids)}" opacity="${op}"><path class="hit" d="${d}"/><path class="ln" d="${d}" fill="none" stroke="${col}" stroke-width="${obs ? 2.2 : 1.4}" stroke-dasharray="${obs ? 'none' : '3 3'}"/>`
      + `<text data-label="1" x="${bx + dx}" y="${ly}" text-anchor="middle" fill="${col}" font-size="14" dominant-baseline="central">${label}</text></g>`;
  };

  out.push('<g class="markers">');
  for (let k = 1; k <= (p.cyclic ? n : n - 1); k++) {
    const any = [...topS, ...botS].some((s) => groups.has(`${s}|${k}`) || (!o.observedOnly && o.theoretical?.has(s)));
    if (!any) continue;
    out.push(`<line x1="${edge[k] + 7}" y1="${bandTop - 2}" x2="${edge[k] - 7}" y2="${bandBot + 2}" stroke="${P.muted}" stroke-width="1.4"/>`);
  }
  // outer rows first so the inner series colour wins where flags overlap
  for (const [list, side] of [[[...topS].reverse(), 'c'], [[...botS].reverse(), 'n']] as const) {
    for (const s of list) for (let k = 1; k <= (p.cyclic ? n : n - 1); k++) {
      const g = groups.get(`${s}|${k}`) ?? null;
      if (g) out.push(flag(g, s, k, side, true));
      else if (!o.observedOnly && o.theoretical?.has(s)) out.push(flag(null, s, k, side, false));
    }
  }
  out.push('</g>');
  return frame(W, H, P, out.join(''), o.title);
}

/**
 * Ring fragments as horizontal bars over the opened-up sequence (one bar per distinct fragment, charge states merged).
 * Arcs that run past the last residue continue at the left. Used for the ions under the pointer.
 */
export function ringBarsSvg(p: Peptide, ions: Ion[], P: MsPalette, maxRows = 6): string {
  const n = p.residues.length;
  const cells = p.residues.map((r) => cell(r.token));
  const edge: number[] = [];
  let x = 30;
  for (const c of cells) { edge.push(x); x += c.w; }
  edge.push(x);
  const W = Math.ceil(x + 30), RH = 17, H = maxRows * RH + 22;
  const bars = new Map<string, { start: number; size: number; ion: Ion }>();
  for (const ion of ions) {
    if (!['a', 'b', 'c'].includes(seriesOf(ion)) || ion.size >= n) continue;
    const start = ((ion.origins?.[0]?.[0] ?? ion.start) % n + n) % n;
    bars.set(`${ion.type}|${start}|${ion.size}|${ion.loss ?? ''}`, { start, size: ion.size, ion });
  }
  const list = [...bars.values()].sort((a, b) => b.size - a.size || a.start - b.start);
  const out: string[] = [];
  list.slice(0, maxRows).forEach((b, r) => {
    const col = ionColor(P, b.ion.type), y = 4 + r * RH;
    const segs: Array<[number, number]> = b.start + b.size <= n ? [[b.start, b.start + b.size]] : [[b.start, n], [0, b.start + b.size - n]];
    segs.forEach(([s, e], si) => {
      const xa = edge[s] + 3, xb = edge[e] - 3;
      out.push(`<rect x="${xa}" y="${y + 2}" width="${xb - xa}" height="${RH - 6}" rx="3" fill="${col}" fill-opacity="0.85"/>`);
      if (si === 0) out.push(`<text x="${xa + 5}" y="${y + RH / 2 - 1}" font-size="11" fill="#fff" style="stroke:none" dominant-baseline="central">${esc(b.ion.label)}</text>`);
    });
  });
  const more = list.length - maxRows;
  const note = !list.length ? 'Hover a flag or an assigned peak to see its ring fragments here.' : more > 0 ? `+${more} more fragments (hover a single peak to see one)` : 'Ring opened at residue 1; bars that run off the right end continue at the left.';
  out.push(`<text x="${W / 2}" y="${H - 8}" text-anchor="middle" font-size="11" fill="${P.faint}" stroke="none">${note}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${esc(P.font)}" class="ring-bars" pointer-events="none" style="width:100%;max-width:${Math.round(W * 1.45)}px;height:auto">${out.join('')}</svg>`;
}
