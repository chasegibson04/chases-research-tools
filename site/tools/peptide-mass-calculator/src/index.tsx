import { useMemo, useState } from 'preact/hooks';
import type { ToolProps } from '@/lib/types';
import { ToolShell, type RunState } from '@/components/tool/ToolShell';
import { ExportMenu } from '@/components/tool/ExportMenu';
import { FigurePanel } from '@/components/tool/FigurePanel';
import type { Input, Output } from './compute';

const fmt = (x: number, d = 4) => x.toFixed(d);

export default function PeptideMassTool({ manifest, examples, run }: ToolProps<Input, Output>) {
  const defaults = Object.fromEntries(manifest.inputs.map((i) => [i.name, i.default])) as Partial<Input>;
  const [values, setValues] = useState<Partial<Input>>(defaults);
  const [state, setState] = useState<RunState>('idle');
  const [msg, setMsg] = useState<string>();
  const [progress, setProgress] = useState(0);
  const [out, setOut] = useState<Output>();
  const [handle, setHandle] = useState<ReturnType<typeof run>>();

  const onRun = () => {
    setState('running'); setMsg(undefined); setProgress(0);
    const t0 = performance.now();
    const h = run(values as Input, (f, m) => { setProgress(f); setMsg(m); });
    setHandle(h);
    h.promise.then((o) => { setOut(o); setState('done'); setMsg(`${Math.round(performance.now() - t0)} ms`); }).catch((e) => { setState('error'); setMsg(e.message); });
  };

  const traces = useMemo(() => out ? [{ type: 'bar', x: out.isotopes.map((p) => p.mz), y: out.isotopes.map((p) => p.relIntensity * 100), width: 0.25, name: 'Theoretical', hovertemplate: 'm/z %{x:.4f}<br>%{y:.1f}%<extra></extra>' }] : [], [out]);

  return (
    <ToolShell manifest={manifest} examples={examples} values={values} state={state} message={msg} progress={progress}
      onChange={(k, v) => setValues({ ...values, [k]: v })} onLoadExample={(ex) => setValues(ex.input)} onRun={onRun} onCancel={() => { handle?.cancel(); setState('idle'); }}>
      {out && (<>
        <dl class="kv">
          <dt>Sequence</dt><dd data-output="sequence">{out.cleanSequence} ({out.length} aa)</dd>
          <dt>Formula</dt><dd data-output="formula">{out.formula}</dd>
          <dt>Monoisotopic [M]</dt><dd data-output="mono">{fmt(out.mono)} Da</dd>
          <dt>Average [M]</dt><dd data-output="average">{fmt(out.average)} Da</dd>
        </dl>
        <div class="results-table"><table><thead><tr><th>z</th><th>[M+zH]z+ m/z</th></tr></thead><tbody>{out.mz.map((r) => <tr><td>{r.z}+</td><td data-output={`mz${r.z}`}>{fmt(r.mz)}</td></tr>)}</tbody></table></div>
        <ExportMenu filename={`${manifest.id}-${out.cleanSequence}`} rows={out.mz} json={out} formats={['csv', 'json']} />
        <FigurePanel traces={traces} filename={`${out.cleanSequence}-isotopes`} style={{ title: `Isotope envelope of ${out.cleanSequence} (1+)`, xTitle: 'm/z', yTitle: 'Relative intensity (%)', showLegend: false }} />
      </>)}
    </ToolShell>
  );
}
