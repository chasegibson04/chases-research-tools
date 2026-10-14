import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { ToolManifest, ToolInputSpec, Example } from '@/lib/types';
import { ParamField } from './ParamField';
import { ExampleLoader } from './ExampleLoader';
import { preflight } from '@/lib/runtime/limits';

export type RunState = 'idle' | 'running' | 'done' | 'error';

interface Props<I> {
  manifest: ToolManifest;
  examples: Example<I>[];
  values: Partial<I>;
  onChange: (name: keyof I & string, v: any) => void;
  onLoadExample: (ex: Example<I>) => void;
  onRun: () => void;
  onCancel: () => void;
  state: RunState;
  progress?: number;
  message?: string;
  errors?: Partial<Record<keyof I & string, string>>;
  children?: ComponentChildren; // results area
  extraInputs?: ComponentChildren; // tool-specific custom inputs
  /** Compact summary shown in the sticky result header next to the status (key numbers of the current result). */
  header?: ComponentChildren;
}

/** Standard two-panel tool layout: inputs (left) and results (right), with run/cancel/status. */
export function ToolShell<I extends Record<string, any>>(p: Props<I>) {
  const [showAdv, setShowAdv] = useState(false);
  const inputs = p.manifest.inputs as ToolInputSpec[];
  const basic = inputs.filter((i) => !i.advanced);
  const adv = inputs.filter((i) => i.advanced);
  const warnings = preflight(p.manifest);
  const blocked = warnings.some((w) => w.level === 'block');
  return (
    <div class="ts" data-tool={p.manifest.id}>
      <aside class="ts-inputs" aria-label="Inputs">
        <ExampleLoader examples={p.examples} onLoad={p.onLoadExample} />
        {basic.map((spec) => <ParamField spec={spec} value={p.values[spec.name]} error={p.errors?.[spec.name]} onChange={(v) => p.onChange(spec.name, v)} />)}
        {p.extraInputs}
        {adv.length > 0 && (
          <details open={showAdv} onToggle={(e) => setShowAdv((e.target as HTMLDetailsElement).open)}>
            <summary class="small muted">Advanced options</summary>
            <div style={{ display: 'grid', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
              {adv.map((spec) => <ParamField spec={spec} value={p.values[spec.name]} error={p.errors?.[spec.name]} onChange={(v) => p.onChange(spec.name, v)} />)}
            </div>
          </details>
        )}
        <div class="ts-bar ts-run">
          <button class="btn-primary" type="button" onClick={p.onRun} disabled={p.state === 'running' || blocked} data-action="run">Run</button>
          {p.state === 'running' && <button type="button" onClick={p.onCancel} data-action="cancel">Cancel</button>}
        </div>
        {warnings.map((w) => <p class="small" style={{ color: w.level === 'block' ? 'var(--err)' : w.level === 'warn' ? 'var(--warn)' : 'var(--fg-faint)', margin: 0 }}>{w.message}</p>)}
      </aside>
      <section class="ts-main" aria-label="Results" aria-live="polite">
        <div class="ts-sticky">
        <div class="ts-status" data-state={p.state}>
          {p.state === 'idle' && <span>Set parameters or load an example, then press Run.</span>}
          {p.state === 'running' && <span>Running… {p.message ?? ''}</span>}
          {p.state === 'done' && <span>Done{p.message ? ` · ${p.message}` : ''}</span>}
          {p.state === 'error' && <span role="alert">Error: {p.message}</span>}
        </div>
        {p.header}
        {p.state === 'running' && <div class="ts-progress" aria-hidden="true"><div style={{ width: `${Math.round((p.progress ?? 0) * 100)}%` }} /></div>}
        </div>
        {p.children}
      </section>
    </div>
  );
}
