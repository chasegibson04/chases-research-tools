import type { ToolInputSpec } from '@/lib/types';
import { HelpTip } from './HelpTip';

interface Props { spec: ToolInputSpec; value: any; onChange: (v: any) => void; error?: string }

/** Renders one manifest input with label, unit, help tooltip, and validation message. */
export function ParamField({ spec, value, onChange, error }: Props) {
  const id = `in-${spec.name}`;
  const common = { id, name: spec.name, 'aria-describedby': error ? `${id}-err` : undefined, 'aria-invalid': !!error } as const;
  let control;
  switch (spec.type) {
    case 'textarea':
      control = <textarea {...common} rows={4} value={value ?? ''} placeholder={spec.placeholder} onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)} />; break;
    case 'number': case 'integer': case 'range':
      control = <input {...common} type={spec.type === 'range' ? 'range' : 'number'} value={value ?? ''} min={spec.min} max={spec.max} step={spec.step ?? (spec.type === 'integer' ? 1 : 'any')} onInput={(e) => { const v = (e.target as HTMLInputElement).value; onChange(v === '' ? null : Number(v)); }} />; break;
    case 'boolean':
      control = <input {...common} type="checkbox" checked={!!value} style={{ width: 'auto' }} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />; break;
    case 'select':
      control = <select {...common} value={value ?? ''} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>{spec.options?.map((o) => <option value={o.value}>{o.label}</option>)}</select>; break;
    case 'multiselect':
      control = <select {...common} multiple value={value ?? []} onChange={(e) => onChange(Array.from((e.target as HTMLSelectElement).selectedOptions).map((o) => o.value))}>{spec.options?.map((o) => <option value={o.value}>{o.label}</option>)}</select>; break;
    case 'file':
      control = <input {...common} type="file" accept={spec.accept} onChange={(e) => onChange((e.target as HTMLInputElement).files?.[0] ?? null)} />; break;
    case 'color':
      control = <input {...common} type="color" value={value ?? '#000000'} onInput={(e) => onChange((e.target as HTMLInputElement).value)} />; break;
    default:
      control = <input {...common} type="text" value={value ?? ''} placeholder={spec.placeholder} onInput={(e) => onChange((e.target as HTMLInputElement).value)} />;
  }
  return (
    <div class="field" data-input={spec.name}>
      <label for={id}>
        {spec.label}{spec.required && <span aria-hidden="true" style={{ color: 'var(--err)' }}>*</span>}
        {spec.unit && <span class="unit">({spec.unit})</span>}
        <HelpTip text={spec.help} label={spec.label} />
      </label>
      {control}
      {spec.type === 'range' && <span class="hint">{String(value)}{spec.unit ? ` ${spec.unit}` : ''}</span>}
      {error && <span class="hint" id={`${id}-err`} style={{ color: 'var(--err)' }}>{error}</span>}
    </div>
  );
}
