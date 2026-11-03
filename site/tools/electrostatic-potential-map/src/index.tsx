import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ToolProps } from '@/lib/types';
import { ToolShell, type RunState } from '@/components/tool/ToolShell';
import { ParamField } from '@/components/tool/ParamField';
import { Panel } from '@/components/tool/Panel';
import '@/components/ms/ms.css';
import './esp.css';
import type { Input, Output } from './compute';
import { DEFAULT_FIGURE, loadFigureSettings, type FigureSettings } from './surface/figure';
import DataPanel from './DataPanel';
import RingPanel from './RingPanel';
import SlicePanel from './SlicePanel';
import { SketchDialog, structureSvg } from './Sketch';
import { HelpTip } from '@/components/tool/HelpTip';

const QUALITY: Record<string, { grid: number; esp: number }> = { draft: { grid: 0.45, esp: 0.7 }, standard: { grid: 0.3, esp: 0.4 }, fine: { grid: 0.22, esp: 0.32 }, publication: { grid: 0.16, esp: 0.28 } };
const OWN = new Set(['source', 'structure', 'structureFile', 'charge']);

type SurfaceModule = typeof import('./SurfacePanel');

function sniff(text: string, name: string): 'xyz' | 'molfile' | 'smiles' {
  const n = name.toLowerCase();
  if (/\.xyz$/.test(n)) return 'xyz';
  if (/\.(mol|sdf|sd)$/.test(n) || /V[23]000|M {2}END/.test(text)) return 'molfile';
  const first = text.trim().split(/\r?\n/)[0] ?? '';
  if (/^\d+$/.test(first.trim())) return 'xyz';
  return text.trim().split(/\r?\n/).length <= 2 && !/\s\S+\s\S+\s\S+/.test(text.trim()) ? 'smiles' : 'xyz';
}

export default function EspTool({ manifest, examples, run }: ToolProps<Input & Record<string, any>, Output>) {
  const defaults = Object.fromEntries(manifest.inputs.map((i) => [i.name, i.default])) as Record<string, any>;
  const [values, setValues] = useState<Record<string, any>>(defaults);
  const [state, setState] = useState<RunState>('idle');
  const [msg, setMsg] = useState<string>();
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Output | null>(null);
  const [orbitals, setOrbitals] = useState<Map<number, Float32Array>>(new Map());
  const [orbBusy, setOrbBusy] = useState(false);
  const [fig, setFig] = useState<FigureSettings>(() => loadFigureSettings());
  const [sketch, setSketch] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  /** The 2D preview needs the structure library (0.8 MB); load it only after the visitor interacts, never on page load. */
  const [touched, setTouched] = useState(false);
  const [Surface, setSurface] = useState<SurfaceModule | null>(null);
  const handle = useRef<ReturnType<typeof run>>();

  const shellManifest = useMemo(() => ({ ...manifest, inputs: manifest.inputs.filter((i) => !OWN.has(i.name)) }), [manifest]);
  const spec = (name: string) => manifest.inputs.find((i) => i.name === name)!;
  const set = (name: string, v: any) => { setTouched(true); setValues((cur) => ({ ...cur, [name]: v })); };

  // 2D depiction of the current structure (SMILES / MOL only)
  useEffect(() => {
    if (!touched) return;
    let dead = false;
    const t = setTimeout(async () => { const svg = await structureSvg(String(values.source), String(values.structure ?? '')); if (!dead) setPreview(svg); }, 350);
    return () => { dead = true; clearTimeout(t); };
  }, [values.source, values.structure, touched]);

  // load the 3D view code (three.js) only once there is something to show
  useEffect(() => { if (result && !Surface) import('./SurfacePanel').then((m) => setSurface(() => m)); }, [result]);

  const onFile = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    const kind = sniff(text, file.name);
    setValues((cur) => ({ ...cur, structure: text.replace(/\r\n/g, '\n').trimEnd(), source: kind, structureFile: null }));
  };

  const onRun = () => {
    const structure = String(values.structure ?? '').trim();
    if (!structure) { setState('error'); setMsg('Enter a SMILES string, XYZ coordinates or a MOL block, or draw a structure, then press Run.'); return; }
    handle.current?.cancel();
    setTouched(true);
    setState('running'); setProgress(0); setMsg(undefined);
    const q = QUALITY[String(values.quality ?? 'standard')] ?? QUALITY.standard;
    const t0 = performance.now();
    const h = run({ op: 'full', source: values.source, structure, basis: values.basis, charge: Number(values.charge ?? 0), optimize: values.optimize !== false, seed: Number(values.seed ?? 42), reorient: values.reorient !== false, gridSpacing: q.grid, espSpacing: q.esp, maxBasis: Number(values.maxBasis ?? 120) } as Input, (f, m) => { setProgress(f); setMsg(m); });
    handle.current = h;
    h.promise.then((o) => {
      setResult(o);
      setOrbitals(new Map((o.orbitalGrids ?? []).map((g) => [g.index, g.data])));
      setFig((cur) => ({ ...cur, orbitalIndex: -1, property: cur.property === 'esp' && !o.esp ? 'plain' : cur.property }));
      setState('done'); setMsg(`${((performance.now() - t0) / 1000).toFixed(1)} s`);
    }).catch((e) => { setState('error'); setMsg(e.message); });
  };

  const requestOrbital = (index: number) => {
    if (!result || orbBusy) return;
    setOrbBusy(true);
    const h = run({ op: 'orbital', source: 'smiles', structure: '', basis: result.wave!.basis, wave: result.wave, grid: result.density, orbitals: [index] } as Input);
    h.promise.then((o) => { setOrbitals((cur) => { const m = new Map(cur); for (const g of o.orbitals ?? []) m.set(g.index, g.data); return m; }); setOrbBusy(false); }).catch(() => setOrbBusy(false));
  };

  const header = result ? (
    <div class="esp-stats" style="padding:0;flex:1 1 auto;grid-template-columns:repeat(auto-fit,minmax(8.5rem,1fr));gap:.1rem 1rem">
      <div><span class="k">Molecule</span><span class="v" data-output="formula">{result.structure!.formula}</span></div>
      <div><span class="k">{result.qm!.method} energy (Eh)</span><span class="v" data-output="energy">{result.qm!.energy.toFixed(6)}</span></div>
      <div><span class="k">Dipole (D)</span><span class="v">{result.moments!.dipoleNorm.toFixed(2)}</span></div>
      <div><span class="k">HOMO–LUMO (eV)</span><span class="v">{result.qm!.gapEv == null ? 'n/a' : result.qm!.gapEv.toFixed(2)}</span></div>
    </div>
  ) : undefined;

  const structureBlock = (
    <div class="esp-structure">
      <ParamField spec={spec('source')} value={values.source} onChange={(v) => set('source', v)} />
      <ParamField spec={spec('structure')} value={values.structure} onChange={(v) => set('structure', v)} />
      <div class="ts-bar" style="gap:.4rem">
        <button type="button" onClick={() => setSketch(true)} data-action="open-sketch">Draw a structure…</button>
        <span class="small faint">edit with the molecule editor</span>
      </div>
      <ParamField spec={spec('structureFile')} value={values.structureFile} onChange={(f) => { set('structureFile', f); onFile(f); }} />
      {(values.source === 'xyz' || values.source === 'molfile') && <ParamField spec={spec('charge')} value={values.charge} onChange={(v) => set('charge', v)} />}
      {preview && <div class="esp-preview" data-testid="structure-preview"><img alt="2D structure preview" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview)}`} /></div>}
    </div>
  );

  return (
    <>
      <ToolShell manifest={shellManifest} examples={examples} values={values} state={state} message={msg} progress={progress} leadInputs={structureBlock} header={header}
        onChange={(k, v) => set(k, v)}
        onLoadExample={(ex) => { setTouched(true); setValues({ ...defaults, ...(ex.input as Record<string, any>), structureFile: null }); }}
        onRun={onRun} onCancel={() => { handle.current?.cancel(); setState('idle'); setMsg(undefined); }}>
        {result && (
          <div class="esp-stack">
            {Surface ? <Surface.default result={result} settings={fig} onChange={(p) => setFig((cur) => ({ ...cur, ...p }))} orbitals={orbitals} requestOrbital={requestOrbital} orbitalBusy={orbBusy} />
              : <Panel title="Surface figure" id="esp-surface"><p class="small muted" style="padding:1rem">Loading the 3D viewer…</p></Panel>}
            <DataPanel result={result} orbitals={orbitals} units={fig.units} />
            <RingPanel result={result} units={fig.units} />
            <SlicePanel result={result} run={run} units={fig.units} colormap={fig.colormap} customStops={fig.customStops} />
          </div>
        )}
        {!result && state !== 'running' && (
          <div class="esp-body small muted" style="max-width:46rem">
            <p style="margin:0">Pick an example, paste a SMILES string such as <code>c1ccccc1</code>, or draw a molecule, then press <strong>Run</strong>. The first run downloads the structure library (about 0.8 MB, cached afterwards); the calculation itself takes a few seconds for molecules up to about 20 heavy atoms.</p>
            <p style="margin:0">Everything happens in this tab: the geometry, the Hartree–Fock calculation and the figure. <HelpTip text="The calculation runs in a Web Worker in your browser. There is no server and no upload, so your structure never leaves your computer." label="Privacy" /></p>
          </div>
        )}
      </ToolShell>
      {sketch && <SketchDialog initial={{ source: String(values.source), text: String(values.structure ?? '') }} onClose={() => setSketch(false)}
        onUse={({ smiles }) => { setValues((cur) => ({ ...cur, source: 'smiles', structure: smiles })); setSketch(false); }} />}
    </>
  );
}
void DEFAULT_FIGURE;
