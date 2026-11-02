import { useState } from 'preact/hooks';
import { Panel } from '@/components/tool/Panel';
import { FigurePanel } from '@/components/tool/FigurePanel';
import type { Output } from './compute';
import { UNIT_FACTOR, UNIT_LABEL, type EspUnit } from './units';

/** Potential above and below each aromatic ring: the quantity behind cation-pi binding trends. */
export default function RingPanel({ result, units }: { result: Output; units: EspUnit }) {
  const rings = result.rings ?? [];
  const [ri, setRi] = useState(0);
  if (!rings.length) return null;
  const r = rings[Math.min(ri, rings.length - 1)];
  const f = UNIT_FACTOR[units];
  const names = r.atoms.map((i) => `${result.structure!.symbols[i]}${i + 1}`).join('–');
  const traces = [
    { type: 'scatter', mode: 'lines+markers', x: r.profile.distance, y: r.profile.above.map((v) => v * f), name: 'Above the ring (+normal)', line: { width: 2.5 }, marker: { size: 5 } },
    { type: 'scatter', mode: 'lines+markers', x: r.profile.distance, y: r.profile.below.map((v) => v * f), name: 'Below the ring (−normal)', line: { width: 2.5, dash: 'dot' }, marker: { size: 5 } },
    { type: 'scatter', mode: 'lines', x: [r.profile.distance[0], r.profile.distance[r.profile.distance.length - 1]], y: [0, 0], showlegend: false, line: { color: '#888', width: 1, dash: 'dash' }, hoverinfo: 'skip' },
  ];
  const best = r.probes.find((p) => p.distance === 3.0)!;
  return (
    <Panel title="Ring probe (cation–π)" id="esp-ring" defaultOpen={false} meta={<span>{rings.length} π ring{rings.length > 1 ? 's' : ''}</span>}>
      <div class="esp-body">
        {rings.length > 1 && (
          <div class="field" style="max-width:18rem"><label for="ring-select">Ring</label>
            <select id="ring-select" value={ri} onChange={(e) => setRi(Number((e.target as HTMLSelectElement).value))}>{rings.map((g, k) => <option value={k}>{`Ring ${k + 1}: ${g.atoms.map((i) => result.structure!.symbols[i]).join('')}`}</option>)}</select></div>
        )}
        <p class="small muted" style="margin:0">Electrostatic potential on the axis through the centre of ring <span class="mono">{names}</span> ({r.size}-membered, planarity rms {r.rms.toFixed(3)} Å). A negative value means a cation is attracted at that height. This is the electrostatic part only: polarization and dispersion also contribute to real cation–π binding.</p>
        <p class="small" style="margin:0">At 3.0 Å: above <strong data-output="esp3">{(best.above * f).toFixed(2)}</strong> {UNIT_LABEL[units]}, below <strong>{(best.below * f).toFixed(2)}</strong> {UNIT_LABEL[units]}.</p>
        <FigurePanel traces={traces} filename={`${result.structure!.formula.replace(/[^A-Za-z0-9]/g, '')}-ring-profile`} style={{ title: 'Potential along the ring normal', xTitle: 'Distance from ring centre (Å)', yTitle: `Electrostatic potential (${UNIT_LABEL[units]})`, showLegend: true }} />
        <div class="results-table"><table class="esp-table"><thead><tr><th class="num">Distance (Å)</th><th class="num">Above ({UNIT_LABEL[units]})</th><th class="num">Below ({UNIT_LABEL[units]})</th></tr></thead>
          <tbody>{r.probes.map((p) => <tr><td class="num">{p.distance.toFixed(1)}</td><td class="num">{(p.above * f).toFixed(2)}</td><td class="num">{(p.below * f).toFixed(2)}</td></tr>)}</tbody></table></div>
      </div>
    </Panel>
  );
}
