// Device capability checks and guardrails so client-side compute never hurts the user's machine. (docs/RUNTIMES.md)
import type { ToolManifest } from '../types';

export interface DeviceInfo { cores: number; memoryGB: number | null; mobile: boolean; sharedArrayBuffer: boolean; wasm: boolean }

export function deviceInfo(): DeviceInfo {
  const nav = typeof navigator !== 'undefined' ? navigator : ({} as Navigator);
  return {
    cores: nav.hardwareConcurrency ?? 2,
    memoryGB: (nav as any).deviceMemory ?? null,
    mobile: /Android|iPhone|iPad|Mobile/i.test(nav.userAgent ?? ''),
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined' && (globalThis as any).crossOriginIsolated === true,
    wasm: typeof WebAssembly !== 'undefined',
  };
}

export interface Warning { level: 'info' | 'warn' | 'block'; message: string }

export function preflight(manifest: ToolManifest, inputBytes = 0): Warning[] {
  const d = deviceInfo();
  const w: Warning[] = [];
  const c = manifest.compute;
  if (!d.wasm && manifest.runtime.engine !== 'js') w.push({ level: 'block', message: 'This tool needs WebAssembly, which your browser does not support.' });
  if (inputBytes > c.maxInputSizeMB * 1024 * 1024) w.push({ level: 'block', message: `Input is larger than this tool's limit of ${c.maxInputSizeMB} MB.` });
  if (d.mobile && c.warnOnMobile) w.push({ level: 'warn', message: 'This tool is compute-heavy; it may be slow or run out of memory on a phone.' });
  if (d.memoryGB != null && d.memoryGB * 1024 < c.maxMemoryMB * 2) w.push({ level: 'warn', message: 'Your device reports limited memory; large inputs may fail.' });
  if (manifest.runtime.engine === 'python') w.push({ level: 'info', message: 'First run downloads the Python runtime (~10–30 MB); it is cached afterwards.' });
  if (manifest.runtime.engine === 'r') w.push({ level: 'info', message: 'First run downloads the R runtime (~20–40 MB); it is cached afterwards.' });
  if (c.threads > 1 && !d.sharedArrayBuffer) w.push({ level: 'info', message: 'Multithreading unavailable in this browser; running single-threaded.' });
  return w;
}

/** Clamp requested worker threads to something safe for the device. */
export function safeThreads(requested: number) {
  const d = deviceInfo();
  if (!d.sharedArrayBuffer) return 1;
  return Math.max(1, Math.min(requested, Math.floor(d.cores / 2)));
}
