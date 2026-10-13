// Main-thread side: spawns tool.worker.ts, enforces timeout, relays progress, supports cancel.
import type { RunHandle, ToolManifest } from '../types';

export interface RunOptions { timeoutMs?: number; onProgress?: (fraction: number, message?: string) => void; onLog?: (m: string) => void }

export function runInWorker<I, O>(manifest: ToolManifest, input: I, opts: RunOptions = {}): RunHandle<O> {
  const worker = new Worker(new URL('./tool.worker.ts', import.meta.url), { type: 'module' });
  const timeoutMs = opts.timeoutMs ?? manifest.compute.maxRuntimeSeconds * 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  const finish = () => { settled = true; clearTimeout(timer); worker.terminate(); };

  const promise = new Promise<O>((resolve, reject) => {
    worker.onmessage = (ev: MessageEvent) => {
      const m = ev.data;
      if (m.type === 'progress') opts.onProgress?.(m.fraction, m.message);
      else if (m.type === 'log') opts.onLog?.(m.message);
      else if (m.type === 'done') { finish(); resolve(m.result as O); }
      else if (m.type === 'error') { finish(); reject(new Error(m.message)); }
    };
    worker.onerror = (e) => { finish(); reject(new Error(e.message || 'Worker crashed')); };
    timer = setTimeout(() => {
      if (settled) return;
      finish();
      reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)} s. Try a smaller input or raise the limit in the tool manifest.`));
    }, timeoutMs);
    worker.postMessage({ type: 'run', slug: manifest.id, input });
  });

  return {
    promise,
    cancel: () => { if (!settled) { worker.postMessage({ type: 'cancel' }); finish(); } },
  };
}
