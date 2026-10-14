import { useMemo, useRef, useState } from 'preact/hooks';
import type { ToolProps } from '@/lib/types';
import { Panel } from '@/components/tool/Panel';
import { ToolShell, type RunState } from '@/components/tool/ToolShell';
import { HelpTip } from '@/components/tool/HelpTip';
import { downloadJSON } from '@/lib/export';
import type { Input, Output, OutputFileInfo } from './compute';
import type { InputBundle } from './model';
import { OUTPUT_FORMATS } from './writers';
import { FILTER_HELP, parseFilters } from './filters';
import { INPUT_SUMMARY } from './readers';
import '@/components/ms/ms.css';
import './converter.css';

const CUSTOM = new Set(['files', 'outputFormat']);
type ItemState = 'queued' | 'running' | 'done' | 'error' | 'cancelled';
interface Item { id: number; bundle: InputBundle; state: ItemState; progress: number; message?: string; out?: Output; error?: string; ms?: number }

const VENDOR_DIR = /\.(d|raw)$/i;
const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`);
const bundleSize = (b: InputBundle) => b.files.reduce((s, f) => s + f.file.size, 0);

/** Group picked/dropped files (with relative paths) into inputs: vendor folders (.d, Waters .raw) become one input each. */
export function groupInputs(files: Array<{ path: string; file: File }>): InputBundle[] {
  const out: InputBundle[] = [];
  const dirs = new Map<string, InputBundle>();
  const loose: Array<{ path: string; file: File }> = [];
  for (const f of files) {
    const parts = f.path.split('/');
    const k = parts.findIndex((p, i) => i < parts.length - 1 && VENDOR_DIR.test(p));
    if (k >= 0) {
      const root = parts.slice(0, k + 1).join('/');
      if (!dirs.has(root)) { const b = { name: parts[k], files: [] as InputBundle['files'] }; dirs.set(root, b); out.push(b); }
      dirs.get(root)!.files.push({ path: parts.slice(k).join('/'), file: f.file });
    } else loose.push(f);
  }
  // imzML + ibd pairs travel together
  const ibd = new Map(loose.filter((f) => /\.ibd$/i.test(f.path)).map((f) => [f.path.replace(/\.ibd$/i, '').toLowerCase(), f]));
  for (const f of loose) {
    if (/\.ibd$/i.test(f.path)) continue;
    const name = f.path.split('/').pop()!;
    const pair = /\.imzML$/i.test(f.path) ? ibd.get(f.path.replace(/\.imzML$/i, '').toLowerCase()) : undefined;
    out.push({ name, files: pair ? [{ path: name, file: f.file }, { path: pair.path.split('/').pop()!, file: pair.file }] : [{ path: name, file: f.file }] });
  }
  return out;
}

async function entriesToFiles(items: DataTransferItemList): Promise<Array<{ path: string; file: File }>> {
  const out: Array<{ path: string; file: File }> = [];
  const walk = async (e: any, prefix: string): Promise<void> => {
    if (e.isFile) { out.push({ path: prefix + e.name, file: await new Promise<File>((res, rej) => e.file(res, rej)) }); return; }
    const reader = e.createReader();
    for (;;) {
      const batch: any[] = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const c of batch) await walk(c, `${prefix}${e.name}/`);
    }
  };
  const roots = Array.from(items).map((i) => (i as any).webkitGetAsEntry?.()).filter(Boolean);
  for (const r of roots) await walk(r, '');
  return out;
}

export default function Converter({ manifest, examples, run }: ToolProps<Input, Output>) {
  const defaults = Object.fromEntries(manifest.inputs.map((i) => [i.name, i.default])) as Partial<Input> & Record<string, any>;
  const [values, setValues] = useState<Record<string, any>>(defaults);
  const [items, setItems] = useState<Item[]>([]);
  const [state, setState] = useState<RunState>('idle');
  const [msg, setMsg] = useState<string>();
  const [progress, setProgress] = useState(0);
  const [outDir, setOutDir] = useState<any>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const handle = useRef<ReturnType<typeof run>>();
  const stopRef = useRef(false);
  const nextId = useRef(1);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const canPickDir = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  const shellManifest = useMemo(() => ({ ...manifest, inputs: manifest.inputs.filter((i) => !CUSTOM.has(i.name)) }), [manifest]);
  const fmt = OUTPUT_FORMATS.find((f) => f.id === values.outputFormat) ?? OUTPUT_FORMATS[0];
  let filterError: string | undefined;
  try { parseFilters(String(values.filterText ?? '')); } catch (e: any) { filterError = e.message; }

  const add = (bundles: InputBundle[]) => setItems((xs) => [...xs, ...bundles.map((b) => ({ id: nextId.current++, bundle: b, state: 'queued' as const, progress: 0 }))]);
  const onPick = (list: FileList | null, folder: boolean) => {
    if (!list?.length) return;
    add(groupInputs(Array.from(list, (f) => ({ path: folder ? (f as any).webkitRelativePath || f.name : f.name, file: f }))));
  };
  const onDrop = async (e: DragEvent) => {
    e.preventDefault(); setDrag(false);
    if (!e.dataTransfer) return;
    const files = e.dataTransfer.items?.length ? await entriesToFiles(e.dataTransfer.items) : Array.from(e.dataTransfer.files, (f) => ({ path: f.name, file: f }));
    add(groupInputs(files));
  };
  const chooseDir = async () => {
    try { setOutDir(await (window as any).showDirectoryPicker({ mode: 'readwrite', id: 'ms-file-converter-out' })); } catch { /* user cancelled */ }
  };

  const inputFor = (b: InputBundle | null): Input => ({
    op: 'convert', bundle: b, url: b ? undefined : values.url, fileName: b ? undefined : values.fileName,
    outputFormat: values.outputFormat, mzBits: Number(values.mzBits) as 32 | 64, intensityBits: Number(values.intensityBits) as 32 | 64, zlib: !!values.zlib,
    mzNumpress: values.mzNumpress, intensityNumpress: values.intensityNumpress, indexed: !!values.indexed, passthrough: !!values.passthrough,
    titleTemplate: values.titleTemplate, includeMs1: !!values.includeMs1, gzip: !!values.gzip, overwrite: !!values.overwrite, combineIonMobility: !!values.combineIonMobility,
    filters: parseFilters(String(values.filterText ?? '')), outDir,
  });

  const runOne = (input: Input, onProgress: (f: number, m?: string) => void) => new Promise<{ out: Output; ms: number }>((resolve, reject) => {
    const t0 = performance.now();
    const h = run(input, onProgress);
    handle.current = h;
    h.promise.then((out) => resolve({ out, ms: performance.now() - t0 }), reject);
  });

  const deliver = (files: OutputFileInfo[]) => {
    for (const f of files) {
      if (!f.blob) continue;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(f.blob); a.download = f.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    }
  };

  const onRun = async () => {
    if (filterError) { setState('error'); setMsg(filterError); return; }
    stopRef.current = false;
    setState('running'); setProgress(0); setLog([]);
    // Example runs (no queued files) convert the example's demo URL.
    const queue = items.filter((i) => i.state !== 'done');
    if (!queue.length && !values.url) { setState('error'); setMsg('Add a file or folder first (or load an example).'); return; }
    if (!queue.length) {
      const id = nextId.current++;
      const item: Item = { id, bundle: { name: String(values.url).split('/').pop()!, files: [] }, state: 'running', progress: 0 };
      setItems((xs) => [...xs, item]); setSelected(id);
      try {
        const { out, ms } = await runOne(inputFor(null), (f, m) => { setProgress(f); setMsg(m); setItems((xs) => xs.map((x) => (x.id === id ? { ...x, progress: f, message: m } : x))); });
        setItems((xs) => xs.map((x) => (x.id === id ? { ...x, state: 'done', progress: 1, out, ms } : x)));
        setLog(out.log); deliver(out.files);
        setState('done'); setMsg(`${out.spectraCount} spectra → ${out.files.map((f) => f.name).join(', ')} · ${(ms / 1000).toFixed(1)} s`);
      } catch (e: any) { setItems((xs) => xs.map((x) => (x.id === id ? { ...x, state: 'error', error: e.message } : x))); setState('error'); setMsg(e.message); }
      return;
    }
    let ok = 0, failed = 0;
    for (const [k, it] of queue.entries()) {
      if (stopRef.current) break;
      if (bundleSize(it.bundle) > manifest.compute.maxInputSizeMB * 1024 * 1024) {
        failed++; setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, state: 'error', error: `Larger than the ${manifest.compute.maxInputSizeMB} MB limit.` } : x))); continue;
      }
      setSelected(it.id);
      setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, state: 'running', progress: 0, error: undefined } : x)));
      try {
        const { out, ms } = await runOne(inputFor(it.bundle), (f, m) => {
          setProgress((k + f) / queue.length); setMsg(`${it.bundle.name}: ${m ?? ''}`);
          setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, progress: f, message: m } : x)));
        });
        ok++;
        setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, state: 'done', progress: 1, out, ms } : x)));
        setLog((l) => [...l, ...out.log]);
        deliver(out.files);
      } catch (e: any) {
        if (stopRef.current) { setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, state: 'cancelled' } : x))); break; }
        failed++;
        setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, state: 'error', error: e.message } : x)));
        setLog((l) => [...l, `${it.bundle.name}: ${e.message}`]);
      }
    }
    setState(failed && !ok ? 'error' : 'done');
    setMsg(stopRef.current ? 'Cancelled' : `${ok} converted${failed ? `, ${failed} failed` : ''}${outDir ? ` · saved to ${outDir.name}` : ' · downloaded'}`);
  };
  const onCancel = () => { stopRef.current = true; handle.current?.cancel(); setState('idle'); setMsg('Cancelled'); };

  const shown = items.find((i) => i.id === selected) ?? [...items].reverse().find((i) => i.out);
  const last = shown?.out;
  const stat = (dt: string, dd: any, key?: string, title?: string) => <dl class="ms-stat"><dt>{dt}</dt><dd data-output={key} title={title}>{dd}</dd></dl>;
  const header = last ? (
    <div class="ms-summary">
      {stat('Input', shown?.bundle.name, undefined, shown?.bundle.name)}
      {stat('Format', last.sourceFormat, 'sourceFormat')}
      {stat('Spectra', last.spectraCount, 'spectraCount')}
      {stat('Levels', Object.entries(last.msLevels).map(([l, n]) => `MS${l} ${n}`).join(' · ') || '—')}
      {last.rtRange && stat('RT', `${(last.rtRange[0] / 60).toFixed(2)}–${(last.rtRange[1] / 60).toFixed(2)} min`)}
      {last.instrument && stat('Instrument', last.instrument)}
      {stat('Output', last.files.map((f) => f.name).join(', '), 'outputFile')}
    </div>
  ) : undefined;

  const leadInputs = (
    <>
      <div class="field" data-input="files">
        <label>Input files or vendor folders <HelpTip text={manifest.inputs.find((i) => i.name === 'files')!.help} label="Inputs" /></label>
        <div class={`conv-drop${drag ? ' is-drag' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
          <span class="small muted">Drop files or folders here</span>
          <div class="conv-row">
            <button type="button" onClick={() => fileRef.current?.click()}>Add files…</button>
            <button type="button" onClick={() => dirRef.current?.click()} title="Bruker or Agilent .d folders, or a folder of files">Add folder…</button>
          </div>
          <input ref={fileRef} type="file" multiple hidden data-testid="conv-files" onChange={(e) => { onPick((e.target as HTMLInputElement).files, false); (e.target as HTMLInputElement).value = ''; }} />
          <input ref={dirRef} type="file" hidden data-testid="conv-folder" {...({ webkitdirectory: true, directory: true } as any)} onChange={(e) => { onPick((e.target as HTMLInputElement).files, true); (e.target as HTMLInputElement).value = ''; }} />
        </div>
        {items.length > 0 && <span class="hint">{items.length} input{items.length > 1 ? 's' : ''} · {mb(items.reduce((s, i) => s + bundleSize(i.bundle), 0))} <button type="button" class="linklike small" onClick={() => setItems([])} disabled={state === 'running'}>clear</button></span>}
      </div>
      <div class="field" data-input="outputFormat">
        <label for="in-outputFormat">Output format <HelpTip text={manifest.inputs.find((i) => i.name === 'outputFormat')!.help} label="Output format" /></label>
        <select id="in-outputFormat" value={values.outputFormat} onChange={(e) => setValues({ ...values, outputFormat: (e.target as HTMLSelectElement).value })}>
          <optgroup label="Open formats">{OUTPUT_FORMATS.filter((f) => f.writable).map((f) => <option value={f.id}>{f.label}</option>)}</optgroup>
          <optgroup label="Vendor formats (read-only, cannot be written)">{OUTPUT_FORMATS.filter((f) => !f.writable).map((f) => <option value={f.id} disabled title={f.reason}>{f.label}</option>)}</optgroup>
        </select>
        <details class="small"><summary class="faint">Why can't vendor formats be written?</summary><ul class="conv-reasons">{OUTPUT_FORMATS.filter((f) => !f.writable).map((f) => <li><b>{f.label}</b>: {f.reason}</li>)}</ul></details>
      </div>
      <div class="field" data-input="outDir">
        <label>Save to <HelpTip text="Pick a folder and every output is written straight into it (Chrome, Edge, Opera). Other browsers download each file to your Downloads folder instead." label="Save to" /></label>
        <div class="conv-row">
          {canPickDir ? <button type="button" onClick={chooseDir}>{outDir ? 'Change folder…' : 'Choose folder…'}</button> : <span class="small faint">This browser saves to Downloads.</span>}
          <span class="small" data-output="outputLocation">{outDir ? outDir.name : 'Downloads'}</span>
          {outDir && <button type="button" class="linklike small" onClick={() => setOutDir(null)}>use Downloads</button>}
        </div>
      </div>
    </>
  );
  const extraInputs = <>
      <div class="field">
        <label for="conv-addfilter">Add filter <HelpTip text="Appends an msconvert-style filter line to the Filters box below, which you can then edit. Filters run top to bottom." label="Add filter" /></label>
        <select id="conv-addfilter" value="" onChange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) setValues({ ...values, filterText: `${String(values.filterText ?? '').trim()}${values.filterText ? '\n' : ''}${v}` }); (e.target as HTMLSelectElement).value = ''; }}>
          <option value="">choose…</option>
          {FILTER_HELP.map((h) => <option value={h.example}>{h.example.split(' ')[0]} — {h.text}</option>)}
        </select>
        {filterError && <span class="hint" style={{ color: 'var(--err)' }}>{filterError}</span>}
      </div>
  </>;

  return (
    <ToolShell manifest={shellManifest} examples={examples} values={values as any} state={state} message={msg} progress={progress} header={header} leadInputs={leadInputs} extraInputs={extraInputs}
      onChange={(k, v) => setValues({ ...values, [k]: v })} onLoadExample={(ex) => { setValues({ ...defaults, ...ex.input }); setItems([]); }} onRun={onRun} onCancel={onCancel}>
      <div class="conv">
        {fmt && !fmt.writable && <p class="small" style={{ color: 'var(--warn)' }}>{fmt.reason}</p>}
        {!items.length && (
          <div class="conv-empty small muted">
            <p>Add files or vendor folders on the left, pick an output format, and press Run. Inputs convert one after another; each gets its own progress bar.</p>
            {INPUT_SUMMARY.map((g) => <p><b>{g.group}:</b> {g.items.join(', ')}</p>)}
          </div>
        )}
        {items.length > 0 && (
          <Panel id="converter:queue" title="Queue" meta={`${items.length} input${items.length > 1 ? 's' : ''}`}>
          <div class="results-table conv-tablewrap" style={{ border: 0, borderRadius: 0 }}>
            <table class="conv-queue" data-output="queue">
              <thead><tr><th>Input</th><th>Size</th><th>Format</th><th>Progress</th><th>Spectra</th><th>Output</th><th>Saved to</th><th></th></tr></thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} class={it.id === shown?.id ? 'is-sel' : ''} onClick={() => setSelected(it.id)} data-state={it.state}>
                    <td title={it.bundle.files.map((f) => f.path).join('\n')}>{it.bundle.name}{it.bundle.files.length > 1 && <span class="faint"> ({it.bundle.files.length} files)</span>}</td>
                    <td>{it.bundle.files.length ? mb(bundleSize(it.bundle)) : '—'}</td>
                    <td>{it.out?.sourceFormat ?? (it.error ? '—' : '')}</td>
                    <td class="conv-prog">
                      {it.state === 'running' ? <><div class="ts-progress"><div style={{ width: `${Math.round(it.progress * 100)}%` }} /></div><span class="small faint">{it.message}</span></>
                        : it.state === 'error' ? <span class="small" style={{ color: 'var(--err)' }} title={it.error}>{it.error}</span>
                        : <span class="small faint">{it.state === 'done' ? `done · ${((it.ms ?? 0) / 1000).toFixed(1)} s` : it.state}</span>}
                    </td>
                    <td>{it.out?.spectraCount ?? ''}</td>
                    <td>{it.out?.files.map((f) => <div>{f.name} <span class="faint">{mb(f.size)}</span></div>)}</td>
                    <td>{it.out?.files.map((f) => <div>{f.savedTo ?? 'Downloads'}</div>)}</td>
                    <td>{it.state !== 'running' && <button type="button" class="linklike small" aria-label={`Remove ${it.bundle.name}`} onClick={(e) => { e.stopPropagation(); setItems((xs) => xs.filter((x) => x.id !== it.id)); }}>remove</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </Panel>
        )}
        {last && (
          <Panel id="converter:preview" title={`Preview: ${shown?.bundle.name ?? ''}`} meta={`first ${last.preview.length} spectra written`}>
            <div class="conv-row" style={{ padding: 'var(--space-2) var(--space-3)' }}>
              <button type="button" class="linklike small" onClick={() => downloadJSON(`${shown?.bundle.name}-summary.json`, { ...last, files: last.files.map(({ blob: _b, ...f }) => f) })}>summary JSON</button>
            </div>
            <div class="results-table conv-tall">
              <table class="conv-queue" data-output="preview">
                <thead><tr><th>#</th><th>native ID</th><th>MS</th><th>RT (min)</th><th>precursor m/z</th><th>z</th><th>peaks</th><th>mode</th></tr></thead>
                <tbody>{last.preview.map((p) => <tr><td>{p.index}</td><td class="mono">{p.id}</td><td>{p.msLevel}</td><td>{p.rt != null ? (p.rt / 60).toFixed(3) : ''}</td><td>{p.precursorMz != null ? p.precursorMz.toFixed(4) : ''}</td><td>{p.charge ?? ''}</td><td>{p.peaks}</td><td>{p.centroided ? 'centroid' : 'profile'}</td></tr>)}</tbody>
              </table>
            </div>
          </Panel>
        )}
        {log.length > 0 && <details class="conv-log" open={state === 'error'}><summary class="small">Log ({log.length})</summary><pre class="small" data-output="log">{log.join('\n')}</pre></details>}
      </div>
    </ToolShell>
  );
}
