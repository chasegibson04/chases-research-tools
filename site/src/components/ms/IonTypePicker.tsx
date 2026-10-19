import type { IonType } from '@/lib/ms/fragments';
import { HelpTip } from '@/components/tool/HelpTip';

const LINEAR: Array<[IonType, string, string]> = [
  ['a', 'a', 'b − CO'], ['b', 'b', 'acylium / oxazolone'], ['c', 'c', 'b + NH₃ (ETD)'], ['c-1', 'c−1', 'c − H (c•)'],
  ['x', 'x', 'y + CO − 2H'], ['y', 'y', 'C-terminal + H₂O'], ['z', 'z', 'y − NH₃'], ['z•', 'z•', 'y − NH₂ (z+1, ETD)'], ['z+2', 'z+2', 'z• + H (z′)'], ['w', 'w', 'z• − Cβ substituent (Leu/Ile/Val, ETD/EThcD)'],
];
const CYCLIC: Array<[IonType, string, string]> = [
  ['b', 'b', 'contiguous arc + H⁺'], ['a', 'a', 'b − CO'], ['b+H2O', 'b+H₂O', 'ring opened by hydrolysis'],
  ['cz•', 'cz•', 'two N–Cα cuts (+H, ETD)'], ['cz+1', 'cz+1', 'cz• + H'], ['c', 'c', 'amide + N–Cα cut (+NH₃)'], ['c-1', 'c−1', 'c − H'], ['z•', 'z•', 'N–Cα + amide cut (−NH+H)'], ['z+1', 'z+1', 'z• + H'],
];

interface Props { cyclic: boolean; value: IonType[]; preset: IonType[]; onChange: (v: IonType[]) => void; help: string; /** Text naming what the automatic choice follows, e.g. "HCD, read from the scan". */ detected?: string }

/** Chip toggles for fragment series. An empty value means "follow the activation preset". */
export function IonTypePicker({ cyclic, value, preset, onChange, help, detected }: Props) {
  const opts = cyclic ? CYCLIC : LINEAR;
  const active = new Set(value.length ? value : preset);
  const usingPreset = !value.length;
  const toggle = (t: IonType) => {
    const next = new Set(active);
    if (next.has(t)) next.delete(t); else next.add(t);
    onChange(next.size ? opts.map((o) => o[0]).filter((x) => next.has(x)) : []);
  };
  return (
    <div class="field" data-input="ionTypes">
      <label>Ion types <HelpTip text={help} label="Ion types" /></label>
      <div class="seg" role="group" aria-label="Ion type selection">
        <button type="button" class="btn-sm" data-ions="auto" aria-pressed={usingPreset} onClick={() => onChange([])} title="Pick the ion series that suit the fragmentation method">Auto</button>
        <button type="button" class="btn-sm" data-ions="custom" aria-pressed={!usingPreset} onClick={() => onChange(opts.map((o) => o[0]).filter((x) => active.has(x)))} title="Choose the ion series yourself">Choose</button>
      </div>
      {usingPreset && detected && <span class="hint">Auto: {detected}. Click a chip to choose your own.</span>}
      <div class="chips" role="group" aria-label="Ion types">
        {opts.map(([t, label, title]) => (
          <button type="button" class={`chip ion-${t.replace(/[^a-z]/g, '')}`} aria-pressed={active.has(t)} title={title} onClick={() => toggle(t)}>{label}</button>
        ))}
      </div>
    </div>
  );
}
