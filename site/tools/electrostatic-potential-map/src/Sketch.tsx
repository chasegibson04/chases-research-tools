import { useEffect, useRef, useState } from 'preact/hooks';
import { loadOCL } from './geometry';

/** Draw-a-structure dialog around OpenChemLib's canvas editor (BSD-3). Returns SMILES and a MOL block. */
export function SketchDialog({ initial, onUse, onClose }: { initial: { source: string; text: string }; onUse: (r: { smiles: string; molfile: string }) => void; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<any>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const OCL = await loadOCL();
        if (dead || !host.current) return;
        const ed = new OCL.CanvasEditor(host.current);
        editor.current = ed;
        try {
          if (initial.source === 'smiles' && initial.text.trim()) ed.setMolecule(OCL.Molecule.fromSmiles(initial.text.trim().split(/\s+/)[0]));
          else if (initial.source === 'molfile' && initial.text.trim()) ed.setMolecule(OCL.Molecule.fromMolfile(initial.text));
        } catch { /* start from an empty canvas */ }
        setLoading(false);
      } catch (e: any) { setError(e?.message ?? 'Could not load the drawing editor.'); setLoading(false); }
    })();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => { dead = true; document.removeEventListener('keydown', key); try { editor.current?.destroy(); } catch { /* already gone */ } };
  }, []);

  const use = () => {
    try {
      const mol = editor.current?.getMolecule();
      if (!mol || mol.getAllAtoms() === 0) { setError('Draw a molecule first.'); return; }
      const smiles = mol.toSmiles();
      if (!smiles) { setError('Could not turn the drawing into SMILES.'); return; }
      onUse({ smiles, molfile: mol.toMolfile() });
    } catch (e: any) { setError(e?.message ?? 'Could not read the drawing.'); }
  };

  return (
    <div class="esp-modal" role="dialog" aria-modal="true" aria-label="Draw a structure" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div>
        <header>
          <h3>Draw a structure</h3>
          <span class="small muted">Click a tool, then the canvas. Add hydrogens only where you need them explicit; the rest are implied.</span>
        </header>
        <div class="esp-editor" ref={host} data-testid="sketch-host">{loading && <p class="small muted" style="padding:1rem">Loading the editor…</p>}</div>
        <footer>
          {error && <span class="esp-warn" role="alert" style="margin-right:auto">{error}</span>}
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" class="btn-primary" onClick={use} data-action="use-drawing">Use this structure</button>
        </footer>
      </div>
    </div>
  );
}

/** Small 2D depiction of the current SMILES or MOL text (async; returns null if it cannot be drawn). */
export async function structureSvg(source: string, text: string): Promise<string | null> {
  if (!text.trim() || source === 'xyz') return null;
  try {
    const OCL = await loadOCL();
    const mol = source === 'molfile' ? OCL.Molecule.fromMolfile(text) : OCL.Molecule.fromSmiles(text.trim().split(/\s+/)[0]);
    mol.inventCoordinates?.();
    return mol.toSVG(260, 170);
  } catch { return null; }
}
