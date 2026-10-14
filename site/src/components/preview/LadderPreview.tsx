// Design preview of a possible next tool: a de novo residue-ladder finder for (cyclic) peptides.
// Peaks whose spacing equals a residue mass (standard + the non-standard residues of the shared table, plus
// N-methylated residues) are linked; the longest well-supported chains become sequence tags. For a cyclic
// peptide the residues must sum to the neutral precursor mass, so the unexplained remainder is reported with
// composition suggestions. Not a tool yet (no manifest); lives under /design/ and is noindex.
import { useMemo, useState } from 'preact/hooks';
import { RESIDUES } from '@/lib/ms/residues';
import { monoMass, PROTON } from '@/lib/ms/elements';
import { parseSequence } from '@/lib/ms/sequence';
import { generateFragments, peptideMass } from '@/lib/ms/fragments';
import { deltaLookup } from '@/lib/ms/match';

interface Peak { mz: number; i: number }
interface Step { from: number; to: number; label: string; err: number }

/** Unique residue masses, isobaric residues merged (I/L…), plus N-methyl variants of the standard residues. */
function residueMasses() {
  const map = new Map<string, { label: string; mass: number }>();
  for (const r of Object.values(RESIDUES)) {
    const m = monoMass(r.formula); const k = m.toFixed(4);
    const prev = map.get(k);
    map.set(k, prev ? { label: `${prev.label}/${r.code}`, mass: m } : { label: r.code, mass: m });
  }
  for (const c of 'AVLFYSTGDEKRQNMHW') { const m = monoMass(RESIDUES[c].formula) + 14.01565; const k = m.toFixed(4); if (!map.has(k)) map.set(k, { label: `Me${c}`, mass: m }); }
  return [...map.values()].sort((a, b) => a.mass - b.mass);
}

function demoPeaks(): { text: string; precursor: string } {
  // Gramicidin S, cyclo(VOLfP)2: cyclic b ions (one ring opening each) plus deterministic noise peaks.
  const pep = parseSequence('cyclo(V(Orn)LfPV(Orn)LfP)', { cyclic: true });
  const ions = generateFragments(pep, { ionTypes: ['b'], maxCharge: 1, precursorCharge: 2, losses: { h2o: false, nh3: false, mod: false, maxLosses: 0 } });
  const seen = new Set<string>(); const rows: string[] = [];
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const ion of ions) { const k = ion.mz.toFixed(3); if (seen.has(k) || ion.size < 2) continue; seen.add(k); rows.push(`${(ion.mz + (rnd() - 0.5) * 0.002).toFixed(4)} ${Math.round(20 + 80 * rnd() * (ion.size < 6 ? 1 : 0.5))}`); }
  for (let n = 0; n < 25; n++) rows.push(`${(150 + rnd() * 1000).toFixed(4)} ${Math.round(2 + rnd() * 15)}`);
  rows.sort((a, b) => parseFloat(a) - parseFloat(b));
  return { text: rows.join('\n'), precursor: ((peptideMass(pep).mono + 2 * PROTON) / 2).toFixed(4) };
}

function ladders(peaks: Peak[], tolDa: number) {
  const res = residueMasses();
  const n = peaks.length;
  const edges: Step[][] = Array.from({ length: n }, () => []);
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    const d = peaks[b].mz - peaks[a].mz;
    if (d > 260) break;
    for (const r of res) if (Math.abs(d - r.mass) <= tolDa) edges[b].push({ from: a, to: b, label: r.label, err: d - r.mass });
  }
  // longest chain ending at each peak, ties broken by summed log-intensity
  const len = new Array(n).fill(0), score = peaks.map((p) => Math.log1p(p.i)), prev: Array<Step | null> = new Array(n).fill(null);
  for (let b = 0; b < n; b++) for (const e of edges[b]) {
    const L = len[e.from] + 1, S = score[e.from] + Math.log1p(peaks[b].i);
    if (L > len[b] || (L === len[b] && S > score[b])) { len[b] = L; score[b] = S; prev[b] = e; }
  }
  const order = [...peaks.keys()].filter((k) => len[k] >= 2).sort((x, y) => len[y] - len[x] || score[y] - score[x]);
  const used = new Set<number>(); const tags: Step[][] = [];
  for (const end of order) {
    if (used.has(end)) continue;
    const path: Step[] = []; let k: number | null = end;
    while (k != null && prev[k]) { path.unshift(prev[k]!); k = prev[k]!.from; }
    if (path.some((s) => used.has(s.to))) continue;
    path.forEach((s) => { used.add(s.to); used.add(s.from); });
    tags.push(path);
    if (tags.length >= 4) break;
  }
  return { tags, edgeCount: edges.reduce((s, e) => s + e.length, 0) };
}

export default function LadderPreview() {
  const demo = useMemo(demoPeaks, []);
  const [text, setText] = useState(demo.text);
  const [prec, setPrec] = useState(demo.precursor);
  const [z, setZ] = useState(2);
  const [tol, setTol] = useState(0.01);
  const peaks = useMemo(() => text.split(/\r?\n/).map((l) => l.trim().split(/[\s,;]+/).map(Number)).filter((p) => p.length >= 2 && p[0] > 0).map(([mz, i]) => ({ mz, i })).sort((a, b) => a.mz - b.mz), [text]);
  const { tags, edgeCount } = useMemo(() => ladders(peaks, tol), [peaks, tol]);
  const neutral = Number(prec) * z - z * PROTON;
  const maxI = Math.max(1, ...peaks.map((p) => p.i));
  const lo = Math.min(...peaks.map((p) => p.mz), 100) - 20, hi = Math.max(...peaks.map((p) => p.mz), 200) + 20;
  const W = 900, H = 260, x = (mz: number) => 40 + ((mz - lo) / (hi - lo)) * (W - 60), y = (i: number) => H - 30 - (i / maxI) * (H - 90);
  const colors = ['var(--ion-b)', 'var(--ion-y)', 'var(--ion-c)', 'var(--ion-a)'];
  return (
    <div class="ladder-preview">
      <div class="ts">
        <aside class="ts-inputs" aria-label="Inputs">
          <div class="field"><label for="lp-peaks">MS/MS peak list (m/z intensity)</label><textarea id="lp-peaks" rows={12} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} /></div>
          <div class="field"><label for="lp-prec">Precursor m/z</label><input id="lp-prec" value={prec} onInput={(e) => setPrec((e.target as HTMLInputElement).value)} /></div>
          <div class="field"><label for="lp-z">Precursor charge</label><input id="lp-z" type="number" min={1} max={6} value={z} onInput={(e) => setZ(Number((e.target as HTMLInputElement).value) || 1)} /></div>
          <div class="field"><label for="lp-tol">Tolerance (Da)</label><input id="lp-tol" type="number" step={0.001} value={tol} onInput={(e) => setTol(Number((e.target as HTMLInputElement).value) || 0.01)} /></div>
          <p class="small faint">Preloaded: gramicidin S b-ion ladder (synthetic, with noise peaks). Paste your own peaks to try it.</p>
        </aside>
        <section class="ts-main" aria-label="Results">
          <div class="ts-status" data-state="done">{peaks.length} peaks · {edgeCount} residue-mass links · {tags.length} tag{tags.length === 1 ? '' : 's'} · neutral precursor {neutral.toFixed(4)} Da</div>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Spectrum with residue ladders" style={{ width: '100%', height: 'auto', background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)' }}>
            <line x1={40} x2={W - 20} y1={H - 30} y2={H - 30} stroke="var(--line-strong)" />
            {peaks.map((p) => <line x1={x(p.mz)} x2={x(p.mz)} y1={H - 30} y2={y(p.i)} stroke="var(--fg-faint)" />)}
            {tags.map((t, ti) => t.map((s) => {
              const a = peaks[s.from], b = peaks[s.to], top = Math.min(y(a.i), y(b.i)) - 14 - ti * 10;
              return <g><path d={`M${x(a.mz)},${y(a.i)} L${x(a.mz)},${top} L${x(b.mz)},${top} L${x(b.mz)},${y(b.i)}`} fill="none" stroke={colors[ti % 4]} stroke-width={1.5} />
                <text x={(x(a.mz) + x(b.mz)) / 2} y={top - 3} text-anchor="middle" font-size="11" fill={colors[ti % 4]}>{s.label}</text></g>;
            }))}
            {[0, 0.25, 0.5, 0.75, 1].map((f) => { const m = lo + f * (hi - lo); return <text x={x(m)} y={H - 12} text-anchor="middle" font-size="10" fill="var(--fg-muted)">{m.toFixed(0)}</text>; })}
          </svg>
          <table class="ion-list" style={{ width: '100%', marginTop: 'var(--space-3)' }}>
            <thead><tr><th>Tag</th><th>Residues</th><th>m/z span</th><th>Σ residues (Da)</th><th>Left to explain (cyclic)</th><th>Could be</th></tr></thead>
            <tbody>{tags.map((t, ti) => {
              const sum = t.reduce((s, x) => s + (peaks[x.to].mz - peaks[x.from].mz), 0);
              const rest = neutral - sum;
              const sugg = rest > 50 && rest < 400 ? deltaLookup(rest, 1000, { value: tol, unit: 'Da' }, 1).slice(0, 3).map((c) => c.label).join(', ') : rest >= 400 ? 'several residues' : '';
              return <tr><td style={{ color: colors[ti % 4] }}>{ti + 1}</td><td class="mono">{t.map((s) => s.label).join('–')}</td><td class="mono">{peaks[t[0].from].mz.toFixed(3)}–{peaks[t[t.length - 1].to].mz.toFixed(3)}</td><td class="mono">{sum.toFixed(4)}</td><td class="mono">{rest.toFixed(4)}</td><td>{sugg}</td></tr>;
            })}</tbody>
          </table>
          <p class="small muted" style={{ marginTop: 'var(--space-3)' }}>Ideas for the full tool: ion-type aware ladders (b/y/c/z, cyclic ring-openings), charge-state deconvolution, scoring against random-spacing decoys, linking straight into the annotator, and a residue alphabet you can extend with your own building blocks.</p>
        </section>
      </div>
    </div>
  );
}
