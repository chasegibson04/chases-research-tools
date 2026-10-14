// Parse pasted or uploaded peak lists: "m/z intensity" lines (space, tab, comma or semicolon separated),
// CSV with a header, or MGF (BEGIN IONS … END IONS; the first or a chosen spectrum).
import type { Peak } from './match';

export interface ParsedPeakList { peaks: Peak[]; title?: string; precursorMz?: number; charge?: number; spectra?: number }

export function parsePeakList(text: string, which = 0): ParsedPeakList {
  const t = text.replace(/\r/g, '');
  if (/BEGIN IONS/i.test(t)) {
    const blocks = t.split(/BEGIN IONS/i).slice(1).map((b) => b.split(/END IONS/i)[0]);
    const block = blocks[Math.min(which, blocks.length - 1)] ?? '';
    const out: ParsedPeakList = { peaks: [], spectra: blocks.length };
    for (const line of block.split('\n')) {
      const kv = /^([A-Z_]+)=(.*)$/i.exec(line.trim());
      if (kv) {
        const k = kv[1].toUpperCase();
        if (k === 'TITLE') out.title = kv[2];
        if (k === 'PEPMASS') out.precursorMz = Number(kv[2].split(/\s+/)[0]);
        if (k === 'CHARGE') out.charge = Number(kv[2].replace(/[^0-9]/g, '')) || undefined;
        continue;
      }
      const p = numPair(line);
      if (p) out.peaks.push(p);
    }
    return { ...out, peaks: clean(out.peaks) };
  }
  const peaks: Peak[] = [];
  for (const line of t.split('\n')) { const p = numPair(line); if (p) peaks.push(p); }
  if (!peaks.length) throw new Error('No peaks found. Paste two columns: m/z and intensity (one peak per line), or an MGF spectrum.');
  return { peaks: clean(peaks) };
}

function numPair(line: string): Peak | null {
  const parts = line.trim().split(/[\s,;]+/).filter(Boolean);
  if (parts.length < 2) return null;
  const mz = Number(parts[0]), intensity = Number(parts[1]);
  if (!Number.isFinite(mz) || !Number.isFinite(intensity) || mz <= 0) return null;
  return { mz, intensity: Math.max(0, intensity) };
}
const clean = (p: Peak[]) => p.filter((x) => x.intensity > 0).sort((a, b) => a.mz - b.mz);
