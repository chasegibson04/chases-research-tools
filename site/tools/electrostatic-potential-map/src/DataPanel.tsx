import { Panel } from '@/components/tool/Panel';
import { downloadCSV, downloadJSON, downloadText } from '@/lib/export';
import { ANGSTROM_PER_BOHR } from './chem';
import type { Output } from './compute';
import { toCube, toXYZ } from './exporters';
import { orbitalLabel } from './labels';
import type { EspUnit } from './units';

const f6 = (x: number) => x.toFixed(6); // ASCII minus: the end-to-end test parses these numbers

export default function DataPanel({ result, orbitals, units }: { result: Output; orbitals: Map<number, Float32Array>; units: EspUnit }) {
  void units;
  const st = result.structure!, qm = result.qm!, ch = result.charges!, mo = result.moments!, w = result.wave!;
  const base = st.formula.replace(/[^A-Za-z0-9]/g, '');
  const cubeHeader = `${st.smiles ?? st.formula} ${qm.method}`;
  const cube = (name: string, grid: { origin: [number, number, number]; h: number; n: [number, number, number] }, data: Float32Array, quantity: string) =>
    downloadText(`${base}-${name}.cube`, toCube({ ...grid, data }, st.z, w.bohr, st.charge, cubeHeader, quantity), 'text/plain');
  const atomsRows = st.z.map((_, i) => ({ index: i + 1, element: st.symbols[i], x_A: +st.xyz[i * 3].toFixed(5), y_A: +st.xyz[i * 3 + 1].toFixed(5), z_A: +st.xyz[i * 3 + 2].toFixed(5), mulliken: +ch.mulliken[i].toFixed(5), lowdin: +ch.lowdin[i].toFixed(5) }));
  const q = mo.quadrupoleBuckingham;
  const moRows: number[] = [];
  for (let i = Math.max(0, w.nocc - 5); i <= Math.min(w.nbf - 1, w.nocc + 3); i++) moRows.push(i);
  return (
    <Panel title="Energies, charges and properties" id="esp-data" meta={<span>{qm.method} · {qm.iterations} SCF iterations</span>}>
      <div class="esp-body">
        <div class="esp-stats" style="padding:0">
          <div><span class="k">Formula</span><span class="v">{st.formula}</span></div>
          <div><span class="k">Electrons / basis functions</span><span class="v">{qm.nelec} / {qm.nbf}</span></div>
          <div><span class="k">Total energy (Eh)</span><span class="v" data-output="energy2">{qm.energy.toFixed(6)}</span></div>
          <div><span class="k">HOMO–LUMO gap</span><span class="v">{qm.gapEv == null ? 'n/a' : `${qm.gapEv.toFixed(2)} eV`}</span></div>
          <div><span class="k">Dipole moment</span><span class="v" data-output="dipole">{mo.dipoleNorm.toFixed(3)}</span> <span class="k">D</span></div>
          <div><span class="k">Quadrupole Θ<sub>zz</sub>, out of the molecular plane</span><span class="v" data-output="qzz">{q[2][2].toFixed(3)}</span> <span class="k">B (Debye·Å)</span></div>
        </div>
        <details class="small"><summary class="muted">Traceless quadrupole tensor (Buckingham, B), origin at the centre of nuclear charge</summary>
          <table class="esp-table" style="max-width:24rem"><tbody>{['x', 'y', 'z'].map((a, i) => <tr><th>{a}</th>{[0, 1, 2].map((j) => <td class="num">{q[i][j].toFixed(3)}</td>)}</tr>)}</tbody></table>
          <p class="faint" style="margin:.4rem 0 0">Benzene: experiment Θ<sub>zz</sub> ≈ −8.7 B; hexafluorobenzene ≈ +9.5 B. The sign flip is the signature of the cation–π effect.</p>
        </details>
        <div class="results-table"><table class="esp-table">
          <thead><tr><th class="num">#</th><th>El.</th><th class="num">x (Å)</th><th class="num">y (Å)</th><th class="num">z (Å)</th><th class="num">Mulliken q</th><th class="num">Löwdin q</th></tr></thead>
          <tbody>{atomsRows.map((r) => <tr><td class="num">{r.index}</td><td>{r.element}</td><td class="num">{r.x_A.toFixed(3)}</td><td class="num">{r.y_A.toFixed(3)}</td><td class="num">{r.z_A.toFixed(3)}</td><td class="num">{r.mulliken.toFixed(3)}</td><td class="num">{r.lowdin.toFixed(3)}</td></tr>)}</tbody>
        </table></div>
        <details class="small"><summary class="muted">Frontier orbital energies</summary>
          <table class="esp-table" style="max-width:20rem"><thead><tr><th>Orbital</th><th class="num">Energy (Eh)</th><th class="num">(eV)</th></tr></thead>
            <tbody>{moRows.map((i) => <tr><td>{orbitalLabel(i, w.nocc)}</td><td class="num">{qm.eps[i].toFixed(5)}</td><td class="num">{(qm.eps[i] * 27.211386).toFixed(3)}</td></tr>)}</tbody></table>
        </details>
        {st.notes.length > 0 && <ul class="esp-notes">{st.notes.map((n) => <li>{n}</li>)}</ul>}
        <p class="small muted" style="margin:0">Timing: geometry {(qm.timings.geometry / 1000).toFixed(1)} s · integrals {(qm.timings.integrals / 1000).toFixed(1)} s · SCF {(qm.timings.scf / 1000).toFixed(1)} s · grids {(qm.timings.grids / 1000).toFixed(1)} s. Method: restricted closed-shell Hartree–Fock, point-charge nuclei, no solvent. Results are qualitative to semi-quantitative; state the level of theory in any figure caption.</p>
        <div class="ts-bar" role="group" aria-label="Download data">
          <span class="small muted">Download:</span>
          <button type="button" class="btn-sm" onClick={() => downloadText(`${base}.xyz`, toXYZ(st.z, st.xyz, `${st.smiles ?? st.formula} ${qm.method} standard orientation (Angstrom)`))}>XYZ</button>
          {st.molfile2d && <button type="button" class="btn-sm" onClick={() => downloadText(`${base}.mol`, st.molfile2d!)}>MOL (2D)</button>}
          <button type="button" class="btn-sm" onClick={() => downloadCSV(`${base}-atoms.csv`, atomsRows)}>Atoms CSV</button>
          <button type="button" class="btn-sm" onClick={() => downloadJSON(`${base}-results.json`, { formula: st.formula, smiles: st.smiles, charge: st.charge, method: qm.method, energyHartree: qm.energy, nuclearRepulsion: qm.eNuc, homoHartree: qm.homo, lumoHartree: qm.lumo, gapEV: qm.gapEv, dipoleDebye: mo.dipoleDebye, quadrupoleBuckingham: q, atoms: atomsRows, orbitalEnergiesHartree: Array.from(qm.eps), rings: result.rings })}>Results JSON</button>
          <button type="button" class="btn-sm" onClick={() => cube('density', result.density!, result.density!.data, 'electron density (e/bohr^3)')} title="Gaussian cube, bohr: opens in VMD, PyMOL, ChimeraX, Avogadro">Density cube</button>
          <button type="button" class="btn-sm" onClick={() => cube('esp', result.esp!, result.esp!.data, 'electrostatic potential (hartree/e); far-field points written as 0')}>ESP cube</button>
          {result.orbitalGrids?.map((g) => <button type="button" class="btn-sm" onClick={() => cube(g.label.replace('−', '-'), result.density!, g.data, `orbital ${g.label} amplitude`)}>{g.label} cube</button>)}
          {[...orbitals.keys()].filter((k) => !result.orbitalGrids?.some((g) => g.index === k)).map((k) => <button type="button" class="btn-sm" onClick={() => cube(orbitalLabel(k, w.nocc).replace('−', '-'), result.density!, orbitals.get(k)!, `orbital ${orbitalLabel(k, w.nocc)} amplitude`)}>{orbitalLabel(k, w.nocc)} cube</button>)}
        </div>
      </div>
    </Panel>
  );
}
void ANGSTROM_PER_BOHR;
void f6;
