// Opt-in: compare our reading of vendor files with msconvert output of the same runs (never committed data).
// PAIRS_LIST=<text file, one "vendorPath<TAB>referenceMzML" per line>. Prints one summary line per pair.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { detectFormat } from '../src/readers';
import type { SpectrumRecord } from '../src/model';

const pairs = process.env.PAIRS_LIST && fs.existsSync(process.env.PAIRS_LIST)
  ? fs.readFileSync(process.env.PAIRS_LIST, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t') as [string, string]) : [];
const ctx = { progress: () => {}, log: () => {}, signal: new AbortController().signal };
async function read(p: string) {
  const b = { name: path.basename(p), files: [{ path: path.basename(p), file: await (fs as any).openAsBlob(p) }] };
  const det = await detectFormat(b);
  const src = await det.format!.open(b, ctx);
  const out: SpectrumRecord[] = [];
  for await (const s of src.spectra()) out.push({ ...s, mz: s.mz.length ? s.mz : s.mz, intensity: s.intensity });
  return out;
}
const act = (s: SpectrumRecord) => s.precursors[0]?.activation.map((a) => a.accession).sort().join('+') ?? '';
const nz = (x: Float64Array) => x.reduce((c, v) => c + (v > 0 ? 1 : 0), 0);

describe.runIf(pairs.length > 0)('vendor vs msconvert', () => {
  it.each(pairs)('%s', async (vendor, ref) => {
    const [a, r] = await Promise.all([read(vendor), read(ref)]);
    const byScan = new Map(r.map((s) => [s.scan, s]));
    const issues: Record<string, number> = {};
    const bump = (k: string) => { issues[k] = (issues[k] ?? 0) + 1; };
    let maxRt = 0, maxPre = 0, compared = 0;
    for (const s of a) {
      const q = byScan.get(s.scan);
      if (!q) { bump('missing in ref'); continue; }
      compared++;
      if (s.msLevel !== q.msLevel) bump('msLevel');
      if (s.rtSeconds != null && q.rtSeconds != null) maxRt = Math.max(maxRt, Math.abs(s.rtSeconds - q.rtSeconds));
      if (s.precursors[0] && q.precursors[0]) {
        maxPre = Math.max(maxPre, Math.abs(s.precursors[0].mz - q.precursors[0].mz));
        if ((s.precursors[0].charge ?? 0) !== (q.precursors[0].charge ?? 0)) bump('charge');
        if (act(s) !== act(q)) bump(`activation ${act(s)} vs ${act(q)}`);
        // ETD has no collision energy; some converters write the reaction time there (we keep it as a userParam)
        const electron = s.precursors[0].activation.some((c) => /^MS:10005(98|250)|^MS:1003247/.test(c.accession));
        if (!electron && Math.abs((s.precursors[0].collisionEnergy ?? 0) - (q.precursors[0].collisionEnergy ?? 0)) > 0.01) bump('collision energy');
      } else if (!!s.precursors[0] !== !!q.precursors[0]) bump('precursor presence');
      if (s.centroided !== q.centroided) bump('centroid flag');
      if (Math.abs(nz(s.intensity) - nz(q.intensity)) > Math.max(2, nz(q.intensity) * 0.01)) bump('peak count');
      if (q.filter && (s.filter ?? '') !== q.filter) { bump('filter string'); if (!issues.example) (issues as any).example = `${s.filter} ≠ ${q.filter}`; }
    }
    const line = `PAIR ${path.basename(vendor)} | ours ${a.length} ref ${r.length} | compared ${compared} | maxΔRT ${maxRt.toExponential(1)} s | maxΔprec ${maxPre.toExponential(1)} | ${JSON.stringify(issues)}`;
    console.log(line);
    expect(a.length).toBe(r.length);
  }, 600_000);
});
