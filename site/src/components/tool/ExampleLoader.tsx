import type { Example } from '@/lib/types';
export function ExampleLoader<I>({ examples, onLoad }: { examples: Example<I>[]; onLoad: (ex: Example<I>) => void }) {
  if (!examples.length) return null;
  return (
    <div class="field">
      <label for="example-select">Load an example</label>
      <select id="example-select" onChange={(e) => { const i = Number((e.target as HTMLSelectElement).value); if (i >= 0) onLoad(examples[i]); }}>
        <option value="-1">Choose…</option>
        {examples.map((ex, i) => <option value={i}>{ex.label}</option>)}
      </select>
    </div>
  );
}
