// Tool UI. Receives manifest, examples, and a `run` function (executes compute.ts in a worker).
import { useState } from 'preact/hooks';
import type { ToolProps } from '@/lib/types';
import { ToolShell, type RunState } from '@/components/tool/ToolShell';
import { ExportMenu } from '@/components/tool/ExportMenu';
import type { Input, Output } from './compute';

export default function Tool({ manifest, examples, run }: ToolProps<Input, Output>) {
  const defaults = Object.fromEntries(manifest.inputs.map((i) => [i.name, i.default])) as Partial<Input>;
  const [values, setValues] = useState<Partial<Input>>(defaults);
  const [state, setState] = useState<RunState>('idle');
  const [msg, setMsg] = useState<string>();
  const [progress, setProgress] = useState(0);
  const [out, setOut] = useState<Output>();
  const [handle, setHandle] = useState<ReturnType<typeof run>>();

  const onRun = () => {
    setState('running'); setMsg(undefined); setProgress(0);
    const h = run(values as Input, (f, m) => { setProgress(f); setMsg(m); });
    setHandle(h);
    h.promise.then((o) => { setOut(o); setState('done'); setMsg(undefined); }).catch((e) => { setState('error'); setMsg(e.message); });
  };

  return (
    <ToolShell manifest={manifest} examples={examples} values={values} state={state} message={msg} progress={progress}
      onChange={(k, v) => setValues({ ...values, [k]: v })} onLoadExample={(ex) => setValues(ex.input)} onRun={onRun} onCancel={() => { handle?.cancel(); setState('idle'); }}>
      {out && (<>
        <dl class="kv"><dt>Value</dt><dd data-output="value">{out.value}</dd></dl>
        <ExportMenu filename={manifest.id} json={out} formats={['json']} />
      </>)}
    </ToolShell>
  );
}
