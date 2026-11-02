import { cloneElement, toChildArray, type ComponentChildren, type VNode } from 'preact';
import { useMemo } from 'preact/hooks';
import { HelpTip } from '@/components/tool/HelpTip';

let fieldCounter = 0;
const CONTROL_TAGS = new Set(['input', 'select', 'textarea']);

/** Label + (?) tooltip + control, the same pattern every parameter on the site uses. The label is tied to the first control inside. */
export function Field({ label, help, children, unit, row }: { label: string; help: string; children: ComponentChildren; unit?: string; row?: boolean }) {
  const id = useMemo(() => `esp-f${++fieldCounter}`, []);
  let tagged = false;
  const kids = toChildArray(children).map((k) => {
    if (!tagged && typeof k === 'object' && k && 'type' in k && (CONTROL_TAGS.has(k.type as string) || k.type === NumberBox)) {
      tagged = true;
      return cloneElement(k as VNode<any>, { id });
    }
    return k;
  });
  return (
    <div class={`field esp-field${row ? ' row' : ''}`}>
      <label for={id}>{label}{unit && <span class="unit">({unit})</span>}<HelpTip text={help} label={label} /></label>
      {kids}
    </div>
  );
}

export function Group({ title, children, open = true, id }: { title: string; children: ComponentChildren; open?: boolean; id: string }) {
  return (
    <details class="esp-group" open={open} data-group={id}>
      <summary>{title}</summary>
      <div class="esp-group-body">{children}</div>
    </details>
  );
}

export function Seg<T extends string>({ options, value, onChange, label }: { options: Array<[T, string]>; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div class="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => <button type="button" class="btn-sm" aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>)}
    </div>
  );
}

export function NumberBox({ value, onChange, min, max, step, disabled, id }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number | 'any'; disabled?: boolean; id?: string }) {
  return <input id={id} type="number" value={Number.isFinite(value) ? value : ''} min={min} max={max} step={step ?? 'any'} disabled={disabled} onInput={(e) => { const v = Number((e.target as HTMLInputElement).value); if (Number.isFinite(v)) onChange(v); }} />;
}

export const downloadURL = (name: string, blob: Blob) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
};
