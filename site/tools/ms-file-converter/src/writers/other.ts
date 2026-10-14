// Writers for the other open formats: mzXML 3.2 (indexed, with <sha1>), MGF (msconvert-style TITLE templates),
// MS1/MS2 text, and a long-format peak CSV.
import type { SpectrumSource, SpectrumRecord } from '../model';
import { ByteBuilder, base64Bytes, xmlEsc, fmt, ticOf, basePeak, zlibMany, type OutputFormat, type WriteContext } from './util';

const actName = (s: SpectrumRecord) => {
  const a = s.precursors[0]?.activation ?? [];
  const has = (acc: string) => a.some((c) => c.accession === acc);
  if (has('MS:1000598') && (has('MS:1002678') || has('MS:1000422'))) return 'ETHCD';
  if (has('MS:1002631')) return 'ETHCD';
  if (has('MS:1000598')) return 'ETD';
  if (has('MS:1000250')) return 'ECD';
  if (has('MS:1000422')) return 'HCD';
  if (has('MS:1000262')) return 'IRMPD';
  if (has('MS:1003246')) return 'UVPD';
  if (has('MS:1000133') || has('MS:1002472')) return 'CID';
  return '';
};
const scanNo = (s: SpectrumRecord) => s.scan ?? Number(/scan=(\d+)/.exec(s.nativeId)?.[1] ?? s.index + 1);

// ---- mzXML ---------------------------------------------------------------------------------------------
export interface MzxmlOptions { bits: 32 | 64; zlib: boolean; indexed: boolean }
export async function writeMzxml(src: SpectrumSource, opts: Partial<MzxmlOptions>, ctx: WriteContext) {
  const o: MzxmlOptions = { bits: 32, zlib: true, indexed: true, ...opts };
  const body = new ByteBuilder();
  const offsets: Array<[number, number]> = [];
  let n = 0, t0 = Infinity, t1 = -Infinity;
  const seen = new Set<number>();
  // network (big-endian) interleaved m/z-intensity pairs
  const pack = (s: SpectrumRecord) => {
    const k = s.mz.length, w = o.bits / 8, raw = new Uint8Array(2 * k * w), dv = new DataView(raw.buffer);
    for (let i = 0; i < k; i++) {
      if (w === 8) { dv.setFloat64(16 * i, s.mz[i], false); dv.setFloat64(16 * i + 8, s.intensity[i], false); }
      else { dv.setFloat32(8 * i, s.mz[i], false); dv.setFloat32(8 * i + 4, s.intensity[i], false); }
    }
    return raw;
  };
  // spectra are written in batches so their peak blocks can be compressed concurrently
  let batch: SpectrumRecord[] = [];
  const flush = async () => {
    const raws = batch.map(pack);
    const packed = o.zlib ? await zlibMany(raws) : raws;
    batch.forEach((s, bi) => writeScan(s, packed[bi]));
    batch = [];
    ctx.progress(src.count ? Math.min(0.97, n / src.count) : 0.5, `Wrote ${n} scans`);
  };
  const writeScan = (s: SpectrumRecord, bytes: Uint8Array) => {
    let num = scanNo(s); while (seen.has(num)) num++; seen.add(num);
    const k = s.mz.length;
    const [bpm, bpi] = s.basePeakMz != null ? [s.basePeakMz, s.basePeakIntensity ?? 0] : basePeak(s);
    if (s.rtSeconds != null) { t0 = Math.min(t0, s.rtSeconds); t1 = Math.max(t1, s.rtSeconds); }
    offsets.push([num, body.length]);
    const p = s.precursors[0];
    body.push(`<scan num="${num}" scanType="${s.msLevel > 1 ? 'MSn' : 'Full'}" centroided="${s.centroided ? 1 : 0}" msLevel="${s.msLevel}" peaksCount="${k}"${s.polarity ? ` polarity="${s.polarity}"` : ''}${s.rtSeconds != null ? ` retentionTime="PT${fmt(s.rtSeconds)}S"` : ''}`
      + `${k ? ` lowMz="${fmt(s.lowMz ?? s.mz[0])}" highMz="${fmt(s.highMz ?? s.mz[k - 1])}"` : ''} basePeakMz="${fmt(bpm)}" basePeakIntensity="${fmt(bpi)}" totIonCurrent="${fmt(s.tic ?? ticOf(s))}"`
      + `${s.filter ? ` filterLine="${xmlEsc(s.filter)}"` : ''}${p?.collisionEnergy != null ? ` collisionEnergy="${fmt(p.collisionEnergy)}"` : ''}${s.faimsCv != null ? ` compensationVoltage="${fmt(s.faimsCv)}"` : ''} msInstrumentID="1">\n`);
    if (p && s.msLevel > 1) {
      const ref = p.spectrumRef ? /scan=(\d+)/.exec(p.spectrumRef)?.[1] : undefined;
      const width = p.isolationLower != null && p.isolationUpper != null ? p.isolationLower + p.isolationUpper : undefined;
      body.push(`<precursorMz${ref ? ` precursorScanNum="${ref}"` : ''} precursorIntensity="${fmt(p.intensity ?? 0)}"${p.charge ? ` precursorCharge="${p.charge}"` : ''}${actName(s) ? ` activationMethod="${actName(s)}"` : ''}${width ? ` windowWideness="${fmt(width)}"` : ''}>${fmt(p.mz)}</precursorMz>\n`);
    }
    body.push(`<peaks compressionType="${o.zlib ? 'zlib' : 'none'}" compressedLen="${o.zlib ? bytes.length : 0}" precision="${o.bits}" byteOrder="network" contentType="m/z-int">`);
    body.push(base64Bytes(bytes));
    body.push('</peaks>\n</scan>\n');
    n++;
  };
  for await (const s of src.spectra()) {
    if (ctx.signal.aborted) throw new Error('Cancelled.');
    batch.push(s);
    if (batch.length >= 32) await flush();
  }
  if (batch.length) await flush();
  const m = src.meta;
  const out = new ByteBuilder(o.indexed);
  out.push('<?xml version="1.0" encoding="ISO-8859-1"?>\n<mzXML xmlns="http://sashimi.sourceforge.net/schema_revision/mzXML_3.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://sashimi.sourceforge.net/schema_revision/mzXML_3.2 http://sashimi.sourceforge.net/schema_revision/mzXML_3.2/mzXML_idx_3.2.xsd">\n');
  out.push(`<msRun scanCount="${n}"${Number.isFinite(t0) ? ` startTime="PT${fmt(t0)}S" endTime="PT${fmt(t1)}S"` : ''}>\n`);
  for (const f of m.sourceFiles) out.push(`<parentFile fileName="${xmlEsc(f.name)}" fileType="RAWData" fileSha1="${f.sha1 ?? '0000000000000000000000000000000000000000'}"/>\n`);
  const sw = m.software[0];
  out.push(`<msInstrument msInstrumentID="1"><msManufacturer category="msManufacturer" value="${xmlEsc(m.instrument?.model?.name ?? 'unknown')}"/><msModel category="msModel" value="${xmlEsc(m.instrument?.name ?? m.instrument?.model?.name ?? 'unknown')}"/>`
    + `${sw ? `<software type="acquisition" name="${xmlEsc(sw.name)}" version="${xmlEsc(sw.version || 'unknown')}"/>` : ''}</msInstrument>\n`);
  out.push(`<dataProcessing><software type="conversion" name="Chase's Research Tools MS File Converter" version="${ctx.version}"/>${ctx.processing.map((p) => `<processingOperation name="${xmlEsc(p.cv?.[1] ?? p.user ?? '')}"/>`).join('')}</dataProcessing>\n`);
  const base = out.length;
  await out.pushBlob(body.blob());
  out.push('</msRun>\n');
  if (o.indexed) {
    const idx = out.length;
    out.push(`<index name="scan">\n${offsets.map(([k, off]) => `<offset id="${k}">${base + off}</offset>\n`).join('')}</index>\n<indexOffset>${idx}</indexOffset>\n<sha1>`);
    out.push(`${out.hash!.hex()}</sha1>\n`);
  }
  out.push('</mzXML>\n');
  return [{ name: `${ctx.baseName}.mzXML`, blob: out.blob('application/xml'), mime: 'application/xml' }];
}

// ---- MGF ---------------------------------------------------------------------------------------------
export const DEFAULT_TITLE = '<RunId>.<ScanNumber>.<ScanNumber>.<ChargeState> File:"<SourcePath>", NativeID:"<Id>"';
export function makeTitle(tpl: string, s: SpectrumRecord, run: string, source: string) {
  const p = s.precursors[0];
  const v: Record<string, string> = {
    RunId: run, Index: String(s.index), Id: s.nativeId, SourcePath: source, ScanNumber: String(scanNo(s)), ActivationType: actName(s),
    IsolationMz: p ? fmt(p.isolationTarget ?? p.mz) : '', SelectedIonMz: p ? fmt(p.mz) : '', ChargeState: p?.charge ? String(p.charge) : '0',
    SpectrumType: s.msLevel > 1 ? 'MSn spectrum' : 'MS1 spectrum', ScanStartTimeInSeconds: s.rtSeconds != null ? fmt(s.rtSeconds) : '',
    ScanStartTimeInMinutes: s.rtSeconds != null ? fmt(s.rtSeconds / 60) : '', BasePeakMz: fmt(basePeak(s)[0]), BasePeakIntensity: fmt(basePeak(s)[1]),
    TotalIonCurrent: fmt(s.tic ?? ticOf(s)), MsLevel: String(s.msLevel),
  };
  return tpl.replace(/<(\w+)>/g, (m, k) => v[k] ?? m);
}
export interface MgfOptions { titleTemplate: string; includeMs1: boolean }
export async function writeMgf(src: SpectrumSource, opts: Partial<MgfOptions>, ctx: WriteContext) {
  const o: MgfOptions = { titleTemplate: DEFAULT_TITLE, includeMs1: false, ...opts };
  const b = new ByteBuilder(); let n = 0, k = 0;
  const source = src.meta.sourceFiles[0]?.name ?? ctx.baseName;
  for await (const s of src.spectra()) {
    k++;
    if (s.msLevel < 2 && !o.includeMs1) continue;
    const p = s.precursors[0];
    const lines = ['BEGIN IONS', `TITLE=${makeTitle(o.titleTemplate, s, ctx.baseName, source)}`];
    if (s.rtSeconds != null) lines.push(`RTINSECONDS=${fmt(s.rtSeconds)}`);
    if (p) lines.push(`PEPMASS=${fmt(p.mz)}${p.intensity ? ` ${fmt(p.intensity)}` : ''}`);
    if (p?.charge) lines.push(`CHARGE=${Math.abs(p.charge)}${p.charge < 0 || s.polarity === '-' ? '-' : '+'}`);
    lines.push(`SCANS=${scanNo(s)}`);
    for (let i = 0; i < s.mz.length; i++) lines.push(`${fmt(s.mz[i])} ${fmt(s.intensity[i])}`);
    lines.push('END IONS', '');
    b.push(lines.join('\n') + '\n'); n++;
    if (k % 200 === 0) ctx.progress(src.count ? Math.min(0.97, k / src.count) : 0.5, `Wrote ${n} spectra`);
  }
  ctx.log(`MGF: ${n} spectra written${o.includeMs1 ? '' : ' (MS2+ only)'}.`);
  return [{ name: `${ctx.baseName}.mgf`, blob: b.blob('text/plain'), mime: 'text/plain' }];
}

// ---- MS1 / MS2 -----------------------------------------------------------------------------------------
export async function writeMsText(level: 1 | 2, src: SpectrumSource, ctx: WriteContext) {
  const b = new ByteBuilder();
  b.push(`H\tCreationDate\t${new Date().toISOString()}\nH\tExtractor\tChase's Research Tools MS File Converter\nH\tExtractorVersion\t${ctx.version}\nH\tComments\tConverted from ${src.meta.sourceFormat}\nH\tExtractorOptions\tMS${level}\n`);
  let n = 0;
  for await (const s of src.spectra()) {
    if ((level === 1) !== (s.msLevel === 1)) continue;
    const p = s.precursors[0];
    const sc = scanNo(s);
    const lines = [level === 2 && p ? `S\t${sc}\t${sc}\t${fmt(p.mz)}` : `S\t${sc}\t${sc}`];
    if (s.rtSeconds != null) lines.push(`I\tRTime\t${fmt(s.rtSeconds / 60)}`);
    const [bm, bi] = basePeak(s);
    lines.push(`I\tBPI\t${fmt(bi)}`, `I\tBPM\t${fmt(bm)}`, `I\tTIC\t${fmt(s.tic ?? ticOf(s))}`);
    if (level === 2 && actName(s)) lines.push(`I\tActivationType\t${actName(s)}`);
    if (level === 2 && p?.charge) lines.push(`Z\t${p.charge}\t${fmt(p.mz * p.charge - (p.charge - 1) * 1.007276466621)}`);
    for (let i = 0; i < s.mz.length; i++) lines.push(`${fmt(s.mz[i])} ${fmt(s.intensity[i])}`);
    b.push(lines.join('\n') + '\n'); n++;
  }
  ctx.log(`MS${level}: ${n} spectra written.`);
  return [{ name: `${ctx.baseName}.ms${level}`, blob: b.blob('text/plain'), mime: 'text/plain' }];
}

// ---- CSV ----------------------------------------------------------------------------------------------
export async function writeCsv(src: SpectrumSource, ctx: WriteContext) {
  const b = new ByteBuilder();
  b.push('index,native_id,scan,ms_level,rt_seconds,precursor_mz,charge,mz,intensity\n');
  for await (const s of src.spectra()) {
    const p = s.precursors[0];
    const pre = `${s.index},"${s.nativeId.replace(/"/g, '""')}",${scanNo(s)},${s.msLevel},${s.rtSeconds != null ? fmt(s.rtSeconds) : ''},${p ? fmt(p.mz) : ''},${p?.charge ?? ''}`;
    const rows: string[] = [];
    for (let i = 0; i < s.mz.length; i++) rows.push(`${pre},${fmt(s.mz[i])},${fmt(s.intensity[i])}`);
    if (rows.length) b.push(rows.join('\n') + '\n');
  }
  return [{ name: `${ctx.baseName}.csv`, blob: b.blob('text/csv'), mime: 'text/csv' }];
}

export const otherOutputs: OutputFormat[] = [
  { id: 'mzXML', label: 'mzXML 3.2 (indexed)', ext: '.mzXML', writable: true, write: (s, o, c) => writeMzxml(s, o as Partial<MzxmlOptions>, c) },
  { id: 'MGF', label: 'MGF (Mascot Generic Format)', ext: '.mgf', writable: true, write: (s, o, c) => writeMgf(s, o as Partial<MgfOptions>, c) },
  { id: 'MS2', label: 'MS2 text', ext: '.ms2', writable: true, write: (s, _o, c) => writeMsText(2, s, c) },
  { id: 'MS1', label: 'MS1 text', ext: '.ms1', writable: true, write: (s, _o, c) => writeMsText(1, s, c) },
  { id: 'CSV', label: 'Peak table (CSV)', ext: '.csv', writable: true, write: (s, _o, c) => writeCsv(s, c) },
];
