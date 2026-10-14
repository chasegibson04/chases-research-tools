// mzML 1.1 writer (indexed by default, with the SHA-1 <fileChecksum> msconvert writes). The spectrum list is
// written to a body buffer first so its count is exact even after filters drop spectra; offsets in the index are
// shifted by the header length when the file is assembled. mzML inputs keep their original XML ("pass-through").
import type { SpectrumSource, SpectrumRecord, ChromatogramRecord, CvParam, BinaryArray, RunMetadata } from '../model';
import { CV } from '../model';
import { ByteBuilder, base64Bytes, encodeArray, encodeArrays, xmlEsc, fmt, ticOf, basePeak, type ArrayEncoding, type EncodedArray, type OutputFormat, type WriteContext, type Numpress } from './util';

export interface MzmlOptions {
  indexed: boolean;
  mzBits: 32 | 64; intensityBits: 32 | 64; otherBits: 32 | 64;
  zlib: boolean;
  mzNumpress: 'none' | 'linear'; intensityNumpress: 'none' | 'pic' | 'slof';
  /** Keep mzML inputs' original spectrum XML where the record is unchanged. */
  passthrough: boolean;
  /** Write a TIC chromatogram when the source has none. */
  makeTic: boolean;
}
export const MZML_DEFAULTS: MzmlOptions = { indexed: true, mzBits: 64, intensityBits: 32, otherBits: 32, zlib: true, mzNumpress: 'none', intensityNumpress: 'none', passthrough: true, makeTic: true };

const cv = (acc: string, name: string, value?: string | number, unit?: [string, string]) =>
  `<cvParam cvRef="${acc.split(':')[0]}" accession="${acc}" name="${xmlEsc(name)}"${value != null ? ` value="${xmlEsc(typeof value === 'number' ? fmt(value) : value)}"` : ' value=""'}${unit ? ` unitCvRef="${unit[0].split(':')[0]}" unitAccession="${unit[0]}" unitName="${unit[1]}"` : ''}/>`;
const cvp = (p: CvParam) => cv(p.accession, p.name, p.value, p.unitAccession ? [p.unitAccession, p.unitName ?? ''] : undefined);
const up = (name: string, value?: string) => `<userParam name="${xmlEsc(name)}"${value != null ? ` value="${xmlEsc(value)}"` : ''}/>`;
const MZ: [string, string] = ['MS:1000040', 'm/z'];
const MIN: [string, string] = ['UO:0000031', 'minute'];
const MS_: [string, string] = ['UO:0000028', 'millisecond'];
const EV: [string, string] = ['UO:0000266', 'electronvolt'];
const COUNTS: [string, string] = ['MS:1000131', 'number of detector counts'];

function arrayXml(enc: EncodedArray, typeCv: string, b: ByteBuilder) {
  const b64 = base64Bytes(enc.bytes);
  b.push(`<binaryDataArray encodedLength="${b64.length}">${enc.cvs.map(([a, n]) => cv(a, n)).join('')}${typeCv}<binary>`);
  b.push(b64);
  b.push('</binary></binaryDataArray>');
}

type ArrayRec = { mz?: Float64Array; intensity: Float64Array; time?: Float64Array; arrays?: BinaryArray[] };
/** The arrays of a spectrum or chromatogram with their encodings and type cvParam, in write order. */
function arrayJobs(rec: ArrayRec, o: MzmlOptions): Array<{ values: Float64Array; e: ArrayEncoding; typeCv: string }> {
  const np = (x: Numpress, bits: 32 | 64): ArrayEncoding => ({ bits, zlib: o.zlib, numpress: x });
  const jobs = [
    rec.time
      ? { values: rec.time, e: np(o.mzNumpress === 'linear' ? 'linear' : 'none', 64), typeCv: cv('MS:1000595', 'time array', undefined, MIN) }
      : { values: rec.mz!, e: np(o.mzNumpress, o.mzBits), typeCv: cv('MS:1000514', 'm/z array', undefined, MZ) },
    { values: rec.intensity, e: np(o.intensityNumpress, o.intensityBits), typeCv: cv('MS:1000515', 'intensity array', undefined, COUNTS) },
  ];
  for (const a of rec.arrays ?? []) {
    const named = a.cv.accession === 'MS:1000786' ? cv('MS:1000786', 'non-standard data array', a.name, a.unit ? [a.unit.accession, a.unit.name] : undefined) : cvp(a.cv);
    jobs.push({ values: a.values, e: np('none', o.otherBits), typeCv: named });
  }
  return jobs;
}

/** Write the binaryDataArrayList; `pre` holds the arrays already encoded (in arrayJobs order) when batching. */
function arraysXml(rec: ArrayRec, o: MzmlOptions, b: ByteBuilder, pre?: EncodedArray[]) {
  const jobs = arrayJobs(rec, o);
  b.push(`<binaryDataArrayList count="${jobs.length}">`);
  jobs.forEach((j, k) => arrayXml(pre?.[k] ?? encodeArray(j.values, j.e), j.typeCv, b));
  b.push('</binaryDataArrayList>');
}
function spectrumXml(s: SpectrumRecord, idx: number, o: MzmlOptions, passthrough: boolean, b: ByteBuilder, pre?: EncodedArray[]) {
  const n = s.mz.length;
  if (passthrough && s.sourceXml) {
    const head = s.sourceXml.replace(/^<spectrum\b[^>]*>/, (t) => t.replace(/\bindex="\d+"/, `index="${idx}"`).replace(/\bdefaultArrayLength="\d+"/, `defaultArrayLength="${n}"`));
    b.push(head.trimEnd());
    arraysXml(s, o, b, pre);
    b.push('</spectrum>\n');
    return;
  }
  const [bpm, bpi] = s.basePeakMz != null ? [s.basePeakMz, s.basePeakIntensity ?? 0] : basePeak(s);
  const x: string[] = [`<spectrum index="${idx}" id="${xmlEsc(s.nativeId)}" defaultArrayLength="${n}">`];
  x.push(s.msLevel > 1 ? cv('MS:1000580', 'MSn spectrum') : cv('MS:1000579', 'MS1 spectrum'));
  x.push(cv('MS:1000511', 'ms level', s.msLevel));
  x.push(s.centroided ? cv('MS:1000127', 'centroid spectrum') : cv('MS:1000128', 'profile spectrum'));
  if (s.polarity) x.push(s.polarity === '+' ? cv('MS:1000130', 'positive scan') : cv('MS:1000129', 'negative scan'));
  if (n || s.basePeakMz != null) { x.push(cv('MS:1000504', 'base peak m/z', bpm, MZ)); x.push(cv('MS:1000505', 'base peak intensity', bpi, COUNTS)); }
  x.push(cv('MS:1000285', 'total ion current', s.tic ?? ticOf(s)));
  const lo = s.lowMz ?? (n ? s.mz[0] : undefined), hi = s.highMz ?? (n ? s.mz[n - 1] : undefined);
  if (lo != null) x.push(cv('MS:1000528', 'lowest observed m/z', lo, MZ));
  if (hi != null) x.push(cv('MS:1000527', 'highest observed m/z', hi, MZ));
  for (const c of s.cvParams ?? []) if (!/^MS:10005(79|80|11)$|^MS:10001(27|28|29|30)$|^MS:10005(04|05|28|27)$|^MS:1000285$/.test(c.accession)) x.push(cvp(c));
  for (const u of s.userParams ?? []) x.push(up(u.name, u.value));
  x.push('<scanList count="1">', cv('MS:1000795', 'no combination'), '<scan>');
  if (s.rtSeconds != null) x.push(cv('MS:1000016', 'scan start time', s.rtSeconds / 60, MIN));
  if (s.filter) x.push(cv('MS:1000512', 'filter string', s.filter));
  if (s.injectionTimeMs != null) x.push(cv('MS:1000927', 'ion injection time', s.injectionTimeMs, MS_));
  if (s.faimsCv != null) x.push(cv('MS:1001581', 'FAIMS compensation voltage', s.faimsCv, ['UO:0000218', 'volt']));
  if (s.ionMobility) x.push(cv(s.ionMobility.cv.accession, s.ionMobility.cv.name, s.ionMobility.value, s.ionMobility.unit ? [s.ionMobility.unit.accession, s.ionMobility.unit.name] : s.ionMobility.cv.unitAccession ? [s.ionMobility.cv.unitAccession, s.ionMobility.cv.unitName ?? ''] : undefined));
  if (s.scanWindow) x.push('<scanWindowList count="1"><scanWindow>', cv('MS:1000501', 'scan window lower limit', s.scanWindow[0], MZ), cv('MS:1000500', 'scan window upper limit', s.scanWindow[1], MZ), '</scanWindow></scanWindowList>');
  x.push('</scan></scanList>');
  if (s.precursors.length) {
    x.push(`<precursorList count="${s.precursors.length}">`);
    for (const p of s.precursors) {
      x.push(p.spectrumRef ? `<precursor spectrumRef="${xmlEsc(p.spectrumRef)}">` : '<precursor>');
      if (p.isolationTarget != null || p.isolationLower != null) {
        x.push('<isolationWindow>', cv('MS:1000827', 'isolation window target m/z', p.isolationTarget ?? p.mz, MZ));
        if (p.isolationLower != null) x.push(cv('MS:1000828', 'isolation window lower offset', p.isolationLower, MZ));
        if (p.isolationUpper != null) x.push(cv('MS:1000829', 'isolation window upper offset', p.isolationUpper, MZ));
        x.push('</isolationWindow>');
      }
      x.push('<selectedIonList count="1"><selectedIon>', cv('MS:1000744', 'selected ion m/z', p.mz, MZ));
      if (p.charge) x.push(cv('MS:1000041', 'charge state', p.charge));
      if (p.intensity != null) x.push(cv('MS:1000042', 'peak intensity', p.intensity, COUNTS));
      x.push('</selectedIon></selectedIonList><activation>');
      for (const a of p.activation) x.push(cvp(a));
      if (p.collisionEnergy != null) x.push(cv('MS:1000045', 'collision energy', p.collisionEnergy, EV));
      if (!p.activation.length && p.collisionEnergy == null) x.push(cv('MS:1000044', 'dissociation method'));
      x.push('</activation></precursor>');
    }
    x.push('</precursorList>');
  }
  b.push(x.join(''));
  arraysXml(s, o, b, pre);
  b.push('</spectrum>\n');
}

function chromatogramXml(c: ChromatogramRecord, idx: number, o: MzmlOptions, passthrough: boolean, b: ByteBuilder) {
  const n = c.time.length;
  if (passthrough && c.sourceXml) {
    b.push(c.sourceXml.replace(/^<chromatogram\b[^>]*>/, (t) => t.replace(/\bindex="\d+"/, `index="${idx}"`).replace(/\bdefaultArrayLength="\d+"/, `defaultArrayLength="${n}"`)).trimEnd());
  } else {
    b.push(`<chromatogram index="${idx}" id="${xmlEsc(c.id)}" defaultArrayLength="${n}">${cvp(c.type)}`);
    if (c.precursorMz != null) b.push(`<precursor><isolationWindow>${cv('MS:1000827', 'isolation window target m/z', c.precursorMz, MZ)}</isolationWindow><activation>${cv('MS:1000133', 'collision-induced dissociation')}</activation></precursor>`);
    if (c.productMz != null) b.push(`<product><isolationWindow>${cv('MS:1000827', 'isolation window target m/z', c.productMz, MZ)}</isolationWindow></product>`);
  }
  // Pass-through chromatograms declared their time unit; the model is minutes, so write minutes explicitly.
  arraysXml({ time: c.time, intensity: c.intensity }, o, b);
  b.push('</chromatogram>\n');
}

function headerXml(meta: RunMetadata, specCount: number, chromCount: number, levels: Set<number>, centroid: Set<boolean>, o: MzmlOptions, ctx: WriteContext, passthrough: boolean): string {
  const swId = 'rtools_ms_file_converter';
  const ourSw = `<software id="${swId}" version="${ctx.version}">${up("Chase's Research Tools MS File Converter")}</software>`;
  const procs = [cv('MS:1000544', 'Conversion to mzML'), ...ctx.processing.map((p) => (p.cv ? cv(p.cv[0], p.cv[1]) : up(p.user!)))].join('');
  const ourDp = `<dataProcessing id="rtools_conversion"><processingMethod order="0" softwareRef="${swId}">${procs}</processingMethod></dataProcessing>`;
  const x: string[] = ['<?xml version="1.0" encoding="utf-8"?>\n'];
  if (o.indexed) x.push('<indexedmzML xmlns="http://psi.hupo.org/ms/mzml" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://psi.hupo.org/ms/mzml http://psidev.info/files/ms/mzML/xsd/mzML1.1.2_idx.xsd">\n');
  x.push(`<mzML xmlns="http://psi.hupo.org/ms/mzml" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://psi.hupo.org/ms/mzml http://psidev.info/files/ms/mzML/xsd/mzML1.1.0.xsd" id="${xmlEsc(ctx.baseName)}" version="1.1.0">\n`);
  const m = passthrough ? meta.mzml : undefined;
  if (m?.cvList) x.push(m.cvList, '\n');
  else x.push('<cvList count="2"><cv id="MS" fullName="Proteomics Standards Initiative Mass Spectrometry Ontology" version="4.1.200" URI="https://raw.githubusercontent.com/HUPO-PSI/psi-ms-CV/master/psi-ms.obo"/><cv id="UO" fullName="Unit Ontology" version="09:04:2014" URI="https://raw.githubusercontent.com/bio-ontology-research-group/unit-ontology/master/unit.obo"/></cvList>\n');
  if (m?.fileDescription) x.push(m.fileDescription, '\n');
  else {
    x.push('<fileDescription><fileContent>');
    if (levels.has(1)) x.push(cv('MS:1000579', 'MS1 spectrum'));
    if ([...levels].some((l) => l > 1)) x.push(cv('MS:1000580', 'MSn spectrum'));
    if (centroid.has(true)) x.push(cv('MS:1000127', 'centroid spectrum'));
    if (centroid.has(false)) x.push(cv('MS:1000128', 'profile spectrum'));
    x.push(`</fileContent><sourceFileList count="${meta.sourceFiles.length}">`);
    for (const f of meta.sourceFiles) {
      x.push(`<sourceFile id="${xmlEsc(f.id)}" name="${xmlEsc(f.name)}" location="${xmlEsc(f.location ?? 'file:///')}">`);
      if (f.nativeIdFormat) x.push(cvp(f.nativeIdFormat)); else x.push(cv('MS:1000777', 'spectrum identifier nativeID format'));
      if (f.fileFormat) x.push(cvp(f.fileFormat));
      if (f.sha1) x.push(cv('MS:1000569', 'SHA-1', f.sha1));
      x.push('</sourceFile>');
    }
    x.push('</sourceFileList></fileDescription>\n');
  }
  if (m?.referenceableParamGroupList) x.push(m.referenceableParamGroupList, '\n');
  if (m?.sampleList) x.push(m.sampleList, '\n');
  else if (meta.sampleName) x.push(`<sampleList count="1"><sample id="sample1" name="${xmlEsc(meta.sampleName)}"/></sampleList>\n`);
  if (m?.softwareList) x.push(m.softwareList.replace(/<softwareList\s+count="(\d+)"/, (_, c) => `<softwareList count="${Number(c) + 1}"`).replace('</softwareList>', `${ourSw}</softwareList>`), '\n');
  else {
    const sws = meta.software.map((s) => `<software id="${xmlEsc(s.id)}" version="${xmlEsc(s.version || 'unknown')}">${s.cv ? cvp(s.cv) : up(s.name)}</software>`);
    x.push(`<softwareList count="${sws.length + 1}">${sws.join('')}${ourSw}</softwareList>\n`);
  }
  if (m?.instrumentConfigurationList) x.push(m.instrumentConfigurationList, '\n');
  else {
    const i = meta.instrument;
    x.push('<instrumentConfigurationList count="1"><instrumentConfiguration id="IC1">');
    x.push(i?.model ? cvp(i.model) : cv('MS:1000031', 'instrument model'));
    if (i?.name) x.push(up('instrument name', i.name));
    if (i?.serial) x.push(cv('MS:1000529', 'instrument serial number', i.serial));
    if (i?.components?.length) x.push(`<componentList count="${i.components.length}">${i.components.map((c, k) => `<${k === 0 ? 'source' : k === i.components!.length - 1 ? 'detector' : 'analyzer'} order="${k + 1}">${cvp(c)}</${k === 0 ? 'source' : k === i.components!.length - 1 ? 'detector' : 'analyzer'}>`).join('')}</componentList>`);
    x.push('</instrumentConfiguration></instrumentConfigurationList>\n');
  }
  if (m?.dataProcessingList) x.push(m.dataProcessingList.replace(/<dataProcessingList\s+count="(\d+)"/, (_, c) => `<dataProcessingList count="${Number(c) + 1}"`).replace('</dataProcessingList>', `${ourDp}</dataProcessingList>`), '\n');
  else x.push(`<dataProcessingList count="1">${ourDp}</dataProcessingList>\n`);
  if (m?.runAttributes != null) x.push(`<run${m.runAttributes.startsWith(' ') ? '' : ' '}${m.runAttributes}>\n`);
  else {
    x.push(`<run id="${xmlEsc(ctx.baseName)}" defaultInstrumentConfigurationRef="IC1"${meta.startTimeStamp ? ` startTimeStamp="${xmlEsc(meta.startTimeStamp)}"` : ''} defaultSourceFileRef="${xmlEsc(meta.sourceFiles[0]?.id ?? 'SF1')}"${meta.sampleName ? ' sampleRef="sample1"' : ''}>\n`);
    for (const [k, v] of Object.entries(meta.extra ?? {})) x.push(up(k, v), '\n');
  }
  x.push(`<spectrumList count="${specCount}" defaultDataProcessingRef="${m?.dataProcessingList ? (/<dataProcessing\s+id="([^"]+)"/.exec(m.dataProcessingList)?.[1] ?? 'rtools_conversion') : 'rtools_conversion'}">\n`);
  void chromCount;
  return x.join('');
}

export async function writeMzml(src: SpectrumSource, opts: Partial<MzmlOptions>, ctx: WriteContext) {
  const o = { ...MZML_DEFAULTS, ...opts };
  const passthrough = o.passthrough && !!src.meta.mzml;
  const body = new ByteBuilder();
  const specOffsets: Array<[string, number]> = [];
  const levels = new Set<number>(), centroid = new Set<boolean>();
  const ticT: number[] = [], ticI: number[] = [];
  let i = 0;
  // Spectra are written in batches so their arrays can be compressed concurrently (encodeArrays).
  let batch: SpectrumRecord[] = [];
  const flush = async () => {
    const jobs = batch.map((s) => arrayJobs(s, o));
    const enc = await encodeArrays(jobs.flat());
    let k = 0;
    for (const [n, s] of batch.entries()) {
      specOffsets.push([s.nativeId, body.length]);
      spectrumXml(s, i++, o, passthrough && !!s.sourceXml, body, enc.slice(k, k + jobs[n].length));
      k += jobs[n].length;
    }
    batch = [];
    ctx.progress(src.count ? Math.min(0.97, i / src.count) : 0.5, `Wrote ${i} spectra`);
  };
  for await (const s of src.spectra()) {
    if (ctx.signal.aborted) throw new Error('Cancelled.');
    levels.add(s.msLevel); centroid.add(s.centroided);
    if (s.msLevel === 1 && s.rtSeconds != null) { ticT.push(s.rtSeconds / 60); ticI.push(s.tic ?? ticOf(s)); }
    batch.push(s);
    if (batch.length >= 32) await flush();
  }
  if (batch.length) await flush();
  const chrom = new ByteBuilder();
  const chromOffsets: Array<[string, number]> = [];
  let ci = 0;
  if (src.chromatograms) for await (const c of src.chromatograms()) { chromOffsets.push([c.id, chrom.length]); chromatogramXml(c, ci++, o, passthrough, chrom); }
  else if (o.makeTic && ticT.length) {
    chromOffsets.push(['TIC', chrom.length]);
    chromatogramXml({ index: 0, id: 'TIC', time: Float64Array.from(ticT), intensity: Float64Array.from(ticI), type: CV.ticChrom }, ci++, o, false, chrom);
  }
  const head = headerXml(src.meta, i, ci, levels, centroid, o, ctx, passthrough);
  const out = new ByteBuilder(o.indexed);
  out.push(head);
  const specBase = out.length;
  await out.pushBlob(body.blob());
  out.push('</spectrumList>\n');
  let chromBase = 0;
  if (ci) { out.push(`<chromatogramList count="${ci}" defaultDataProcessingRef="rtools_conversion">\n`); chromBase = out.length; await out.pushBlob(chrom.blob()); out.push('</chromatogramList>\n'); }
  out.push('</run>\n</mzML>\n');
  if (o.indexed) {
    const idxOff = out.length;
    const lines = [`<indexList count="${ci ? 2 : 1}">\n<index name="spectrum">\n`, ...specOffsets.map(([id, off]) => `<offset idRef="${xmlEsc(id)}">${specBase + off}</offset>\n`), '</index>\n'];
    if (ci) lines.push('<index name="chromatogram">\n', ...chromOffsets.map(([id, off]) => `<offset idRef="${xmlEsc(id)}">${chromBase + off}</offset>\n`), '</index>\n');
    lines.push('</indexList>\n', `<indexListOffset>${idxOff}</indexListOffset>\n`, '<fileChecksum>');
    out.push(lines.join(''));
    out.push(`${out.hash!.hex()}</fileChecksum>\n</indexedmzML>\n`);
  }
  ctx.progress(1, `Wrote ${i} spectra, ${ci} chromatograms`);
  return [{ name: `${ctx.baseName}.mzML`, blob: out.blob('application/xml'), mime: 'application/xml' }];
}

export const mzmlOutput: OutputFormat = { id: 'mzML', label: 'mzML (indexed, PSI standard)', ext: '.mzML', writable: true, write: (s, o, c) => writeMzml(s, o as Partial<MzmlOptions>, c) };
