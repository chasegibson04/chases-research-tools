import { useMemo, useRef, useState, useEffect } from 'preact/hooks';
import type { Peptide } from '@/lib/ms/sequence';
import { layoutStructure, type StructureMode } from '@/lib/ms/structure';
import { structureToSvg } from '@/lib/ms/structureSvg';
import { screenPalette, printPalette } from './palette';
import { downloadSvg, downloadPng } from './exportImage';

export interface MarkerHit { bond: number; side: 'n' | 'c'; type: string; size: number; label: boolean }

export interface StructureHighlight {
  /** Marker halves to emphasise: bond index + side ('n' = a/b/c, 'c' = x/y/z). */
  marks: Array<{ bond: number; side: 'n' | 'c' }>;
  /** Residue indices to shade (fragment coverage). */
  residues: number[];
}

interface Props {
  peptide: Peptide;
  families: { n: Array<'a' | 'b' | 'c'>; c: Array<'x' | 'y' | 'z'> };
  observed?: { n: Set<number>; c: Set<number> };
  observedOnly?: boolean;
  highlight?: StructureHighlight;
  onHover?: (m: MarkerHit | null) => void;
  /** label = the user clicked the ion label (e.g. "b₃") rather than the cleavage line. */
  onClick?: (m: MarkerHit) => void;
  filename?: string;
  defaultMode?: StructureMode;
  /** Maximum rendered height of a cyclic structure in "fit" mode. */
  maxRingPx?: number;
}

/** Interactive peptide structure with a/b/c and x/y/z cleavage markers (linear) or ring cleavage ticks (cyclic). */
export function PeptideStructure({ peptide, families, observed, observedOnly, highlight, onHover, onClick, filename = 'peptide-structure', defaultMode = 'full', maxRingPx = 400 }: Props) {
  const [mode, setMode] = useState<StructureMode>(defaultMode);
  const [zoom, setZoom] = useState<'fit' | number>('fit');
  const [themeTick, setThemeTick] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const scene = useMemo(() => layoutStructure(peptide, mode), [peptide, mode]);
  // Re-read colours if the theme attribute changes (theme preview page, dark mode later).
  useEffect(() => {
    const mo = new MutationObserver(() => setThemeTick((t) => t + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  const svg = useMemo(() => structureToSvg(scene, { palette: screenPalette(), families, observed, observedOnly }), [scene, families, observed, observedOnly, themeTick]);

  const css = useMemo(() => {
    if (!highlight) return '';
    const rules: string[] = [];
    for (const m of highlight.marks) rules.push(`.pep-wrap [data-bond="${m.bond}"][data-side="${m.side}"]{opacity:1!important}.pep-wrap [data-bond="${m.bond}"][data-side="${m.side}"] .ln{stroke-width:3.2px;stroke-dasharray:none}`);
    for (const r of highlight.residues) rules.push(`.pep-wrap [data-res="${r}"]{opacity:1}`);
    return rules.join('');
  }, [highlight]);

  const target = (e: Event): MarkerHit | null => {
    const t = e.target as Element;
    const el = t.closest?.('.mk') as SVGGElement | null;
    return el ? { bond: Number(el.dataset.bond), side: el.dataset.side as 'n' | 'c', type: el.dataset.type ?? '', size: Number(el.dataset.size ?? 0), label: !!t.closest?.('text[data-label]') } : null;
  };
  const exportSvg = (title?: string) => structureToSvg(scene, { palette: printPalette(screenPalette()), families, observed, observedOnly, title });

  const w = scene.bounds.maxX - scene.bounds.minX;
  // Rings are drawn at a capped height so the panel stays compact; linear peptides keep the full width.
  const h = scene.bounds.maxY - scene.bounds.minY;
  const ringFit = peptide.cyclic ? Math.min(1.6, (maxRingPx / (h * 38))) : 1.6;
  const style = zoom === 'fit' ? { width: '100%', maxWidth: `${Math.round(w * 38 * ringFit)}px`, height: 'auto' } : { width: `${Math.round(w * 38 * zoom)}px`, height: 'auto' };

  return (
    <div class="pep-panel">
      <div class="fig-bar">
        <strong>{peptide.cyclic ? 'Cyclic structure' : 'Structure'}</strong>
        <span class="small muted">{peptide.text}</span>
        <span class="spacer" />
        <div class="seg" role="group" aria-label="Side-chain drawing">
          <button type="button" class="btn-sm" aria-pressed={mode === 'full'} onClick={() => setMode('full')}>Full structure</button>
          <button type="button" class="btn-sm" aria-pressed={mode === 'condensed'} onClick={() => setMode('condensed')}>Condensed</button>
        </div>
        <button type="button" class="btn-sm" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.4, (z === 'fit' ? (box.current ? box.current.clientWidth / (w * 38) : 1) : z) / 1.25))}>−</button>
        <button type="button" class="btn-sm" onClick={() => setZoom('fit')} aria-pressed={zoom === 'fit'}>Fit</button>
        <button type="button" class="btn-sm" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, (z === 'fit' ? (box.current ? box.current.clientWidth / (w * 38) : 1) : z) * 1.25))}>+</button>
        <button type="button" class="btn-sm" onClick={() => downloadSvg(`${filename}.svg`, exportSvg(peptide.text))}>SVG</button>
        <button type="button" class="btn-sm" onClick={() => downloadPng(`${filename}.png`, exportSvg(peptide.text), 3)}>PNG</button>
      </div>
      <style>{css}</style>
      <div ref={box} class="pep-wrap" data-mode={mode}
        onMouseOver={(e) => onHover?.(target(e))} onMouseLeave={() => onHover?.(null)}
        onClick={(e) => { const t = target(e); if (t) onClick?.(t); }}>
        <div class="pep-svg" style={style} dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    </div>
  );
}
