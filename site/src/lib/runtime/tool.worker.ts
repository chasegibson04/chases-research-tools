// Generic Web Worker that hosts any tool's compute.ts. One worker per run; terminated on finish/cancel/timeout.
// Message protocol: {type:'run', slug, input} -> {type:'progress'|'log'|'done'|'error'}
import type { ComputeContext, ComputeFn } from '../types';

const loaders = import.meta.glob('../../../tools/*/src/compute.ts') as Record<string, () => Promise<{ default: ComputeFn }>>;

const controller = new AbortController();

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data;
  if (msg?.type === 'cancel') { controller.abort(); return; }
  if (msg?.type !== 'run') return;
  const key = `../../../tools/${msg.slug}/src/compute.ts`;
  const load = loaders[key];
  if (!load) { self.postMessage({ type: 'error', message: `No compute module for tool "${msg.slug}"` }); return; }
  const ctx: ComputeContext = {
    progress: (fraction, message) => self.postMessage({ type: 'progress', fraction, message }),
    log: (message) => self.postMessage({ type: 'log', message }),
    signal: controller.signal,
  };
  try {
    const mod = await load();
    const t0 = performance.now();
    const result = await mod.default(msg.input, ctx);
    self.postMessage({ type: 'done', result, elapsedMs: performance.now() - t0 });
  } catch (err: any) {
    self.postMessage({ type: 'error', message: err?.message ?? String(err), stack: err?.stack });
  }
};
