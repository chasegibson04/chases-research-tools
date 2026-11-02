import { useMemo, useRef, useState } from 'preact/hooks';
import { Panel } from '@/components/tool/Panel';
import type { ToolProps } from '@/lib/types';
import type { Input, Output, SliceSpec } from './compute';
import { COLORMAPS, colorAt, type ColormapName } from './surface/colormap';
import { buildSliceSvg, sliceLayout } from './slice';
import { UNIT_FACTOR, UNIT_LABEL, niceNumber, niceRange, type EspUnit } from './units';
import { Field, NumberBox, downloadURL } from './ui';
import { orbitalLabel } from './labels';

type Plane = 'xy' | 'xz' | 'yz';
type Prop = 'esp' | 'density' | 'homo' | 'lumo';
const AXES: Record<Plane, { u: [number, number, number]; v: [number, number, number]; n: [number, number, number]; uL: string; vL: string; nL: string }> = {
  xy: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1], uL: 'x (Å)', vL: 'y (Å)', nL: 'z' },
  xz: { u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0], uL: 'x (Å)', vL: 'z (Å)', nL: 'y' },
  yz: { u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0], uL: 'y (Å)', vL: 'z (Å)', nL: 'x' },
};
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

interface Computed { out: NonNullable<Output['slice']>; plane: Plane; prop: Prop; offset: number }

export default function SlicePanel({ result, run, units, colormap }: { result: Output; run: ToolProps<Input, Output>['run']; units: EspUnit; colormap: ColormapName }) {
  const [plane, setPlane] = useState<Plane>('xy');
  const [offset, setOffset] = useState(1.7);
  const [prop, setProp] = useState<Prop>('esp');
  const [res, setRes] = useState(140);
  const [pad, setPad] = useState(3.5);
  const [cmap, setCmap] = useState<ColormapName>(colormap);
  const [rangeMode, setRangeMode] = useState<'auto' | 'manual'>('auto');
  const [lo, setLo] = useState(-30);
  const [hi, setHi] = useState(30);
  const [contours, setContours] = useState(true);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string>();
  const [computed, setComputed] = useState<Computed | null>(null);
  const [hover, setHover] = useState<string>('');
  const box = useRef<HTMLDivElement>(null);
  const handle = useRef<ReturnType<ToolProps<Input, Output>['run']>>();
  const st = result.structure!;
  const nocc = result.wave!.nocc;

  const compute = async () => {
    setBusy(true); setError(undefined); setProgress(0);
    const ax = AXES[plane];
    const us: number[] = [], vs: number[] = [];
    for (let i = 0; i < st.z.length; i++) { const p = [st.xyz[i * 3], st.xyz[i * 3 + 1], st.xyz[i * 3 + 2]]; us.push(dot(p, ax.u)); vs.push(dot(p, ax.v)); }
    const uMin = Math.min(...us) - pad, uMax = Math.max(...us) + pad, vMin = Math.min(...vs) - pad, vMax = Math.max(...vs) + pad;
    const nu = res, nv = Math.max(24, Math.min(400, Math.round((res * (vMax - vMin)) / (uMax - uMin))));
    const spec: SliceSpec = { origin: [ax.n[0] * offset, ax.n[1] * offset, ax.n[2] * offset], u: ax.u, v: ax.v, uMin, uMax, vMin, vMax, nu, nv };
    const property = prop === 'homo' ? nocc - 1 : prop === 'lumo' ? nocc : prop;
    const h = run({ op: 'slice', source: 'smiles', structure: '', basis: result.wave!.basis, wave: result.wave, property, slice: spec } as Input, (f) => setProgress(f));
    handle.current = h;
    try {
      const o = await h.promise;
      setComputed({ out: o.slice!, plane, prop, offset });
      if (prop === 'density') setCmap('viridis'); else if (!COLORMAPS[cmap].diverging) setCmap(colormap);
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  };

  const scale = computed?.prop === 'esp' ? UNIT_FACTOR[units] : 1;
  const unitLabel = computed?.prop === 'esp' ? UNIT_LABEL[units] : computed?.prop === 'density' ? 'e/bohr³' : '(e/bohr³)½';
  const propLabel = computed?.prop === 'esp' ? 'Electrostatic potential' : computed?.prop === 'density' ? 'Electron density' : computed?.prop === 'homo' ? 'HOMO amplitude' : 'LUMO amplitude';

  const view = useMemo(() => {
    if (!computed) return null;
    const { out } = computed;
    const data = Float32Array.from(out.data, (v) => v * scale);
    const finite = Float32Array.from(data.filter((v) => Number.isFinite(v))).sort();
    const q = (x: number) => finite[Math.min(finite.length - 1, Math.floor(x * (finite.length - 1)))] ?? 0;
    let a: number, b: number;
    if (rangeMode === 'manual') { a = lo; b = hi; }
    else if (computed.prop === 'density') { a = 0; b = niceRange(q(0.97)); }
    else { const r = niceRange(Math.max(Math.abs(q(0.02)), Math.abs(q(0.98)))); a = -r; b = r; }
    const step = niceRange((b - a) / (computed.prop === 'density' ? 7 : 12));
    const ax = AXES[computed.plane];
    const atoms = st.z.map((z, i) => { const p = [st.xyz[i * 3], st.xyz[i * 3 + 1], st.xyz[i * 3 + 2]]; return { u: dot(p, ax.u), v: dot(p, ax.v), d: dot(p, ax.n) - computed.offset, z, label: st.symbols[i] }; });
    // heatmap raster
    const cv = document.createElement('canvas');
    cv.width = out.nu; cv.height = out.nv;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(out.nu, out.nv);
    for (let j = 0; j < out.nv; j++) for (let i = 0; i < out.nu; i++) {
      const v = data[j * out.nu + i];
      const [r, g, bl] = colorAt(cmap, (v - a) / (b - a), false);
      const o = ((out.nv - 1 - j) * out.nu + i) * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = bl; img.data[o + 3] = Number.isFinite(v) ? 255 : 0;
    }
    ctx.putImageData(img, 0, 0);
    const svg = buildSliceSvg({ imageHref: cv.toDataURL('image/png'), nu: out.nu, nv: out.nv, data, uMin: out.spec.uMin, uMax: out.spec.uMax, vMin: out.spec.vMin, vMax: out.spec.vMax, uLabel: ax.uL, vLabel: ax.vL, lo: a, hi: b, colormap: cmap, reverse: false, unitLabel, propertyLabel: propLabel, contourStep: contours ? step : 0, atoms, title: title || `${propLabel}, plane ${ax.nL} = ${computed.offset} Å · ${result.qm!.method}` });
    return { svg, data, lo: a, hi: b };
  }, [computed, cmap, rangeMode, lo, hi, contours, title, units]);

  const onMove = (e: MouseEvent) => {
    if (!computed || !view || !box.current) return;
    const svgEl = box.current.querySelector('svg');
    if (!svgEl) return;
    const r = svgEl.getBoundingClientRect();
    const L = sliceLayout(true);
    const x = ((e.clientX - r.left) / r.width) * L.W, y = ((e.clientY - r.top) / r.height) * L.H;
    // titles are always on, so mt = 44
    const fu = (x - L.ml) / L.pw, fv = 1 - (y - L.mt) / L.ph;
    if (fu < 0 || fu > 1 || fv < 0 || fv > 1) { setHover(''); return; }
    const { out } = computed;
    const i = Math.round(fu * (out.nu - 1)), j = Math.round(fv * (out.nv - 1));
    const u = out.spec.uMin + fu * (out.spec.uMax - out.spec.uMin), v = out.spec.vMin + fv * (out.spec.vMax - out.spec.vMin);
    setHover(`${AXES[computed.plane].uL.replace(' (Å)', '')} = ${u.toFixed(2)} Å, ${AXES[computed.plane].vL.replace(' (Å)', '')} = ${v.toFixed(2)} Å: ${niceNumber(view.data[j * out.nu + i])} ${unitLabel}`);
  };

  const saveSVG = () => view && downloadURL(`${st.formula.replace(/[^A-Za-z0-9]/g, '')}-${computed!.prop}-slice.svg`, new Blob([view.svg], { type: 'image/svg+xml' }));
  const savePNG = async () => {
    if (!view) return;
    const url = URL.createObjectURL(new Blob([view.svg], { type: 'image/svg+xml' }));
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('render failed')); img.src = url; });
    const k = 3, cv = document.createElement('canvas');
    cv.width = 760 * k; cv.height = 640 * k;
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    URL.revokeObjectURL(url);
    cv.toBlob((b) => b && downloadURL(`${st.formula.replace(/[^A-Za-z0-9]/g, '')}-${computed!.prop}-slice.png`, b), 'image/png');
  };

  return (
    <Panel title="2D slice" id="esp-slice" defaultOpen={false} meta={computed ? <span>{propLabel} · {AXES[computed.plane].nL} = {computed.offset} Å</span> : <span>potential, density or orbital on a plane</span>}>
      <div class="esp-slice-wrap esp-slice">
        <div class="esp-slice-ctl">
          <Field label="Plane" help="Cut through the molecule on the xy plane (the molecular plane for flat molecules), or through the side (xz, yz). The molecule is oriented so a flat ring lies in xy.">
            <select value={plane} onChange={(e) => setPlane((e.target as HTMLSelectElement).value as Plane)}><option value="xy">xy (face-on)</option><option value="xz">xz (side)</option><option value="yz">yz (end)</option></select>
          </Field>
          <Field label="Offset" unit="Å" help="Distance of the plane from the molecule centre along its normal. 0 cuts through the nuclei; about 1.7 Å above a ring is roughly where a cation sits in a cation–π complex; 3.4 Å is a stacking distance.">
            <NumberBox value={offset} onChange={setOffset} min={-10} max={10} step={0.1} />
          </Field>
          <Field label="Quantity" help="Electrostatic potential, electron density, or the amplitude of the HOMO or LUMO on the plane.">
            <select value={prop} onChange={(e) => setProp((e.target as HTMLSelectElement).value as Prop)}><option value="esp">Electrostatic potential</option><option value="density">Electron density</option><option value="homo">{orbitalLabel(nocc - 1, nocc)} amplitude</option><option value="lumo" disabled={nocc >= result.wave!.nbf}>{orbitalLabel(nocc, nocc)} amplitude</option></select>
          </Field>
          <Field label="Resolution" unit="px" help="Points along the long side of the plane. Higher is smoother and slower (the potential costs about a second per thousand points on small molecules)."><select value={res} onChange={(e) => setRes(Number((e.target as HTMLSelectElement).value))}><option value={80}>80</option><option value={140}>140</option><option value={220}>220</option><option value={320}>320</option></select></Field>
          <Field label="Margin" unit="Å" help="Empty space around the outermost atoms."><NumberBox value={pad} onChange={setPad} min={1} max={8} step={0.5} /></Field>
          <div class="field"><button type="button" class="btn-primary" onClick={compute} disabled={busy} data-action="compute-slice">{busy ? `Computing ${Math.round(progress * 100)}%` : computed ? 'Recompute plane' : 'Compute plane'}</button></div>
        </div>
        {error && <p class="esp-warn" role="alert">{error}</p>}
        {computed && view && (<>
          <div class="esp-slice-ctl">
            <Field label="Colour map" help="Colour map for the plane. Diverging maps centre white on zero."><select value={cmap} onChange={(e) => setCmap((e.target as HTMLSelectElement).value as ColormapName)}>{(Object.keys(COLORMAPS) as ColormapName[]).map((k) => <option value={k}>{COLORMAPS[k].label}</option>)}</select></Field>
            <Field label="Range" help="Automatic uses a robust symmetric (or zero-based for density) range. Manual lets you fix the limits, for example to match another panel."><select value={rangeMode} onChange={(e) => setRangeMode((e.target as HTMLSelectElement).value as 'auto' | 'manual')}><option value="auto">Automatic</option><option value="manual">Manual</option></select></Field>
            {rangeMode === 'manual' && <><Field label="Min" unit={unitLabel} help="Low end of the scale."><NumberBox value={lo} onChange={setLo} /></Field><Field label="Max" unit={unitLabel} help="High end of the scale."><NumberBox value={hi} onChange={setHi} /></Field></>}
            <label class="small" style="display:flex;gap:.4rem;align-items:center;margin-bottom:.4rem"><input type="checkbox" style="width:auto" checked={contours} onChange={(e) => setContours((e.target as HTMLInputElement).checked)} /> Contour lines</label>
            <Field label="Title" help="Replaces the automatic title."><input type="text" value={title} placeholder="automatic" onInput={(e) => setTitle((e.target as HTMLInputElement).value)} /></Field>
          </div>
          <div ref={box} onMouseMove={onMove as any} onMouseLeave={() => setHover('')} dangerouslySetInnerHTML={{ __html: view.svg }} data-testid="slice-svg" />
          <div class="ts-bar"><span class="small muted" aria-live="polite" style="min-height:1.3em">{hover || 'Hover the map to read values. Solid atom discs lie within 0.6 Å of the plane; dashed circles are above or below it.'}</span><span class="spacer" style="flex:1" /><button type="button" class="btn-sm" onClick={saveSVG}>Save SVG</button><button type="button" class="btn-sm" onClick={savePNG}>Save PNG</button></div>
        </>)}
      </div>
    </Panel>
  );
}
