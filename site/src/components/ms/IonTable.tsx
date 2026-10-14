import { useMemo, useState } from 'preact/hooks';
import type { Ion, IonType } from '@/lib/ms/fragments';
import type { Match } from '@/lib/ms/match';
import type { Peptide } from '@/lib/ms/sequence';
import { ionColor, type MsPalette } from './palette';

interface Props {
  peptide: Peptide;
  ions: Ion[];
  matches?: Map<string, Match>;
  /** Relative intensity scale for observed peaks (max intensity). */
  maxIntensity?: number;
  highlight?: Set<string>;
  onHover?: (ionIds: string[] | null) => void;
  onSelect?: (ion: Ion) => void;
  palette: MsPalette;
  /** Manually rejected ion ids (annotation tool). */
  rejected?: Set<string>;
}

const N_COLS: IonType[] = ['a', 'b', 'c', 'c-1'];
const C_COLS: IonType[] = ['x', 'y', 'z', 'z•', 'z+2'];
const typeLabel = (t: IonType) => (t === 'c-1' ? 'c−1' : t);

/** Fragment table: classic cleavage matrix for linear peptides, sortable list for everything. */
export function IonTable({ peptide, ions, matches, maxIntensity = 1, highlight, onHover, onSelect, palette, rejected }: Props) {
  const linear = !peptide.cyclic;
  const [view, setView] = useState<'matrix' | 'list'>(linear ? 'matrix' : 'list');
  const [matchedOnly, setMatchedOnly] = useState(false);
  const [sort, setSort] = useState<{ key: 'mz' | 'ppm' | 'int' | 'label'; dir: 1 | -1 }>({ key: 'mz', dir: 1 });
  const [limit, setLimit] = useState(400);
  const [q, setQ] = useState('');
  const isMatched = (id: string) => !!matches?.get(id) && !rejected?.has(id);

  const matrix = useMemo(() => {
    if (!linear) return null;
    const n = peptide.residues.length;
    const present = new Set(ions.filter((i) => !i.loss && i.carrier === 'H').map((i) => `${i.type}|${i.charge}`));
    const charges = [...new Set(ions.map((i) => i.charge))].sort();
    const nCols = N_COLS.flatMap((t) => charges.filter((z) => present.has(`${t}|${z}`)).map((z) => ({ t, z })));
    const cCols = C_COLS.flatMap((t) => charges.filter((z) => present.has(`${t}|${z}`)).map((z) => ({ t, z })));
    const by = new Map(ions.filter((i) => !i.loss && i.carrier === 'H').map((i) => [`${i.type}|${i.charge}|${i.size}|${i.start === 0 ? 'n' : 'c'}`, i]));
    const rows = peptide.residues.map((r, k) => ({ k, res: r.token + r.mods.map((m) => `[${m.label}]`).join(''), nI: k + 1, cI: n - k }));
    return { nCols, cCols, by, rows, n };
  }, [peptide, ions, linear]);

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let rows = ions.filter((i) => (!matchedOnly || isMatched(i.id)) && (!ql || i.label.toLowerCase().includes(ql) || i.seq.toLowerCase().includes(ql) || i.mz.toFixed(4).includes(ql)));
    const key = (i: Ion) => sort.key === 'mz' ? i.mz : sort.key === 'label' ? i.label : sort.key === 'ppm' ? Math.abs(matches?.get(i.id)?.errorPpm ?? 1e9) : -(matches?.get(i.id)?.intensity ?? -1);
    rows = [...rows].sort((a, b) => { const ka = key(a), kb = key(b); return (ka < kb ? -1 : ka > kb ? 1 : 0) * sort.dir; });
    return rows;
  }, [ions, matches, matchedOnly, sort, q, rejected]);

  const cell = (ion: Ion | undefined) => {
    if (!ion) return <td class="ion-cell empty">–</td>;
    const m = matches?.get(ion.id);
    const ok = isMatched(ion.id);
    const col = ionColor(palette, ion.type);
    const hl = highlight?.has(ion.id);
    return (
      <td class={`ion-cell${ok ? ' matched' : ''}${hl ? ' hl' : ''}`} data-output={ion.charge === 1 ? `${ion.type}${ion.size}` : undefined} style={ok ? { background: `color-mix(in srgb, ${col} 18%, transparent)`, color: 'var(--fg)' } : undefined}
        title={m ? `${ion.label}  theo ${ion.mz.toFixed(4)}  obs ${m.obs.toFixed(4)}  (${m.errorPpm.toFixed(1)} ppm)` : `${ion.label}  ${ion.formula}`}
        onMouseEnter={() => onHover?.([ion.id])} onMouseLeave={() => onHover?.(null)} onClick={() => onSelect?.(ion)}>
        {ion.mz.toFixed(4)}
      </td>
    );
  };
  const th = (label: string, k: typeof sort.key) => <th onClick={() => setSort({ key: k, dir: sort.key === k ? (-sort.dir as 1 | -1) : 1 })} class="sortable" aria-sort={sort.key === k ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>{label}</th>;

  return (
    <div class="ion-table">
      <div class="ts-bar">
        {linear && (
          <div class="seg" role="group" aria-label="Table view">
            <button type="button" class="btn-sm" aria-pressed={view === 'matrix'} onClick={() => setView('matrix')}>Ladder table</button>
            <button type="button" class="btn-sm" aria-pressed={view === 'list'} onClick={() => setView('list')}>All ions</button>
          </div>
        )}
        {view === 'list' && <>
          <input class="input-sm" placeholder="Filter: b5, PRG, 523.7" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Filter ions" />
          {matches && <label class="small"><input type="checkbox" checked={matchedOnly} onChange={(e) => setMatchedOnly((e.target as HTMLInputElement).checked)} style={{ width: 'auto' }} /> matched only</label>}
          <span class="small muted">{list.length} ions</span>
        </>}
      </div>
      {view === 'matrix' && matrix ? (
        <div class="results-table">
          <table class="ion-matrix">
            <thead><tr>
              <th>#</th>
              {matrix.nCols.map((c) => <th style={{ color: ionColor(palette, c.t) }}>{typeLabel(c.t)}{c.z > 1 ? `${c.z}+` : ''}</th>)}
              <th>Seq</th>
              {matrix.cCols.map((c) => <th style={{ color: ionColor(palette, c.t) }}>{typeLabel(c.t)}{c.z > 1 ? `${c.z}+` : ''}</th>)}
              <th>#</th>
            </tr></thead>
            <tbody>
              {matrix.rows.map((r) => (
                <tr>
                  <td class="muted">{r.nI}</td>
                  {matrix.nCols.map((c) => r.k < matrix.n - 1 ? cell(matrix.by.get(`${c.t}|${c.z}|${r.nI}|n`)) : <td class="ion-cell empty" />)}
                  <td class="seq-cell"><strong>{r.res}</strong></td>
                  {matrix.cCols.map((c) => r.k > 0 ? cell(matrix.by.get(`${c.t}|${c.z}|${r.cI}|c`)) : <td class="ion-cell empty" />)}
                  <td class="muted">{r.cI}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div class="results-table">
          <table class="ion-list">
            <thead><tr>{th('Ion', 'label')}<th>Sequence</th><th>z</th>{th('m/z', 'mz')}{matches && <th>Observed</th>}{matches && th('ppm', 'ppm')}{matches && th('Int. %', 'int')}<th>Formula</th></tr></thead>
            <tbody>
              {list.slice(0, limit).map((ion) => {
                const m = matches?.get(ion.id); const ok = isMatched(ion.id);
                return (
                  <tr class={`${ok ? 'matched' : ''}${highlight?.has(ion.id) ? ' hl' : ''}`} onMouseEnter={() => onHover?.([ion.id])} onMouseLeave={() => onHover?.(null)} onClick={() => onSelect?.(ion)}>
                    <td style={{ color: ionColor(palette, ion.type), fontWeight: 600 }}>{ion.label}</td>
                    <td class="mono small">{ion.seq}{ion.origins && ion.origins.length > 1 ? <span class="muted"> ×{ion.origins.length}</span> : null}</td>
                    <td>{ion.charge}</td>
                    <td class="mono">{ion.mz.toFixed(4)}</td>
                    {matches && <td class="mono">{m ? m.obs.toFixed(4) : ''}</td>}
                    {matches && <td class="mono">{m ? m.errorPpm.toFixed(1) : ''}</td>}
                    {matches && <td class="mono">{m ? ((m.intensity / maxIntensity) * 100).toFixed(1) : ''}</td>}
                    <td class="mono small muted">{ion.formula}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {list.length > limit && <button type="button" class="btn-sm" style={{ margin: 'var(--space-2)' }} onClick={() => setLimit(limit + 1000)}>Show {Math.min(1000, list.length - limit)} more</button>}
        </div>
      )}
    </div>
  );
}
