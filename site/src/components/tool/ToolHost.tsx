import { useEffect, useState } from 'preact/hooks';
import type { ToolManifest, Example, ToolProps } from '@/lib/types';
import { runInWorker } from '@/lib/runtime/workerHost';

// Vite resolves these globs at build time; each tool becomes its own lazy chunk.
const uiLoaders = import.meta.glob('../../../tools/*/src/index.tsx') as Record<string, () => Promise<{ default: (p: ToolProps<any, any>) => any }>>;
const exampleLoaders = import.meta.glob('../../../tools/*/examples/*.json', { import: 'default' }) as Record<string, () => Promise<Example>>;

/** Island mounted on every interactive tool page. Loads the tool's UI + examples and wires compute. */
export default function ToolHost({ manifest }: { manifest: ToolManifest }) {
  const [Tool, setTool] = useState<null | ((p: ToolProps<any, any>) => any)>(null);
  const [examples, setExamples] = useState<Example[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const key = `../../../tools/${manifest.id}/src/index.tsx`;
    const load = uiLoaders[key];
    if (!load) { setErr(`Tool UI not found for "${manifest.id}"`); return; }
    Promise.all([
      load(),
      Promise.all(manifest.examples.map((e) => exampleLoaders[`../../../tools/${manifest.id}/examples/${e.file}`]?.())),
    ]).then(([mod, exs]) => {
      setExamples(exs.filter(Boolean) as Example[]);
      setTool(() => mod.default);
    }).catch((e) => setErr(e.message));
  }, [manifest.id]);

  if (err) return <p class="ts-status" data-state="error" style={{ padding: '1rem' }}>{err}</p>;
  if (!Tool) return <p class="ts-status" style={{ padding: '1rem' }}>Loading tool…</p>;
  const run: ToolProps['run'] = (input, onProgress) => runInWorker(manifest, input, { onProgress });
  return <Tool manifest={manifest} examples={examples} run={run} />;
}
