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
  /** Custom inputs shown before the manifest inputs (e.g. a file queue that everything else depends on). */
  leadInputs?: ComponentChildren;
  /** Compact summary shown in the sticky result header next to the status (key numbers of the current result). */
  header?: ComponentChildren;
  /**
   * Offer "Example" or "My file" as one either/or choice instead of showing both at once. The manifest's first
   * `file` input is the file side; `onSourceChange` lets the tool clear the other side's values.
   */
  sourceChoice?: { onChange: (mode: 'example' | 'file') => void };
}

/** Standard two-panel tool layout: inputs (left) and results (right), with run/cancel/status. */
export function ToolShell<I extends Record<string, any>>(p: Props<I>) {
  const [showAdv, setShowAdv] = useState(false);
  const railKey = `crt-inputs-collapsed:${p.manifest.id}`;
  const [collapsed, setCollapsedState] = useState(() => { try { return localStorage.getItem(railKey) === '1'; } catch { return false; } });
  const setCollapsed = (c: boolean) => { setCollapsedState(c); try { localStorage.setItem(railKey, c ? '1' : '0'); } catch { /* storage blocked */ } };
  const chevron = (dir: 'l' | 'r') => <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d={dir === 'l' ? 'M8 2 L4 6 L8 10' : 'M4 2 L8 6 L4 10'} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>;
  const inputs = p.manifest.inputs as ToolInputSpec[];
  const basic = inputs.filter((i) => !i.advanced);
  const adv = inputs.filter((i) => i.advanced);
  const [src, setSrcState] = useState<'example' | 'file'>('file');
  const [exampleIdx, setExampleIdx] = useState(-1);
  const fileSpec = p.sourceChoice ? basic.find((i) => i.type === 'file') : undefined;
  const setSrc = (m: 'example' | 'file') => { setSrcState(m); p.sourceChoice?.onChange(m); };
  const warnings = preflight(p.manifest);
  const blocked = warnings.some((w) => w.level === 'block');
  return (
    <div class="ts" data-tool={p.manifest.id} data-inputs={collapsed ? 'collapsed' : 'open'} style={p.manifest.layout.inputsWidthPx ? { '--inputs-w': `${p.manifest.layout.inputsWidthPx}px` } : undefined}>
      <aside class="ts-inputs" aria-label="Inputs">
        <div class="ts-rail">
          <button type="button" class="icon-btn" onClick={() => setCollapsed(false)} aria-label="Show inputs" title="Show inputs">{chevron('r')}</button>
          <span class="rail-label">Inputs</span>
          <button class="btn-primary icon-btn" type="button" onClick={p.onRun} disabled={p.state === 'running' || blocked} aria-label="Run" title="Run">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 2 L10 6 L3 10 Z" fill="currentColor" /></svg>
          </button>
        </div>
        <div class="ts-bar ts-run">
          <button class="btn-primary" type="button" onClick={p.onRun} disabled={p.state === 'running' || blocked} data-action="run">Run</button>
          {p.state === 'running' && <button type="button" onClick={p.onCancel} data-action="cancel">Cancel</button>}
          <span class="spacer" />
          <button type="button" class="btn-sm ts-collapse" onClick={() => setCollapsed(true)} aria-label="Hide inputs" title="Hide inputs to give the results more room">{chevron('l')} Hide</button>
        </div>
        {warnings.map((w) => <p class="small" style={{ color: w.level === 'block' ? 'var(--err)' : w.level === 'warn' ? 'var(--warn)' : 'var(--fg-faint)', margin: 0 }}>{w.message}</p>)}
        {p.sourceChoice && (
          <div class="field" data-input="source">
            <div class="seg" role="group" aria-label="Where the data comes from">
              <button type="button" class="btn-sm" data-source="file" aria-pressed={src === 'file'} onClick={() => setSrc('file')}>My file</button>
              <button type="button" class="btn-sm" data-source="example" aria-pressed={src === 'example'} onClick={() => setSrc('example')}>Example</button>
            </div>
          </div>
        )}
        {(!p.sourceChoice || src === 'example') && <ExampleLoader examples={p.examples} selected={exampleIdx} onLoad={(ex, i) => { setExampleIdx(i); p.onLoadExample(ex); }} />}
        {p.leadInputs}
        {basic.filter((spec) => !p.sourceChoice || spec !== fileSpec || src === 'file').map((spec) => <ParamField spec={spec} value={p.values[spec.name]} error={p.errors?.[spec.name]} onChange={(v) => p.onChange(spec.name, v)} />)}
        {p.extraInputs}
        {adv.length > 0 && (
          <details open={showAdv} onToggle={(e) => setShowAdv((e.target as HTMLDetailsElement).open)}>
            <summary class="small muted">Advanced options</summary>
            <div style={{ display: 'grid', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
              {adv.map((spec) => <ParamField spec={spec} value={p.values[spec.name]} error={p.errors?.[spec.name]} onChange={(v) => p.onChange(spec.name, v)} />)}
            </div>
          </details>
        )}
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
