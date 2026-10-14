// mzML reader for the converter: streams spectra AND chromatograms, decodes every binary array, and keeps the
// original XML (header blocks + each <spectrum> without its arrays) so that mzML → mzML is loss-free.
import { parseSpectrumHeader, decodeArray, openSource } from '@/lib/ms/mzml';
import { CV, type InputFormat, type InputBundle, type SpectrumSource, type SpectrumRecord, type ChromatogramRecord, type RunMetadata, type ReaderContext, type CvParam, type Precursor, type BinaryArray, readHead, asciiOf } from '../model';

const dec = new TextDecoder('latin1');
const u8dec = new TextDecoder('utf-8');
/** The file is decoded as latin1 (so char offsets = byte offsets); re-decode as UTF-8 only when non-ASCII bytes occur. */
const utf8 = (latin1: string) => {
  if (!/[-ÿ]/.test(latin1)) return latin1;
  const b = new Uint8Array(latin1.length);
  for (let i = 0; i < latin1.length; i++) b[i] = latin1.charCodeAt(i);
  return u8dec.decode(b);
};

/** All cvParams directly inside an XML fragment. */
export function cvParams(xml: string): CvParam[] {
  const out: CvParam[] = [];
  for (const m of xml.matchAll(/<cvParam\b([^>]*?)\/?>/g)) {
    const a: Record<string, string> = {};
    for (const x of m[1].matchAll(/(\w+)="([^"]*)"/g)) a[x[1]] = x[2];
    out.push({ accession: a.accession ?? '', name: a.name ?? '', value: a.value || undefined, unitAccession: a.unitAccession, unitName: a.unitName });
  }
  return out;
}
const block = (head: string, tag: string) => new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`).exec(head)?.[0];

interface Entry { kind: 'spectrum' | 'chromatogram'; start: number; end: number; header: string }

/** One streaming pass recording byte ranges of every <spectrum> and <chromatogram>. */
async function indexElements(file: Blob, ctx: ReaderContext): Promise<{ head: string; entries: Entry[] }> {
  const reader = (file.stream() as ReadableStream<Uint8Array>).getReader();
  let buf = '', base = 0, read = 0, head = '';
  const entries: Entry[] = [];
  let cur: Entry | null = null, inHeader = false;
  for (;;) {
    if (ctx.signal.aborted) throw new Error('Cancelled.');
    const { value, done } = await reader.read();
    if (value) { buf += dec.decode(value, { stream: true }); read += value.length; ctx.progress(0.3 * (read / file.size), `Indexing ${Math.round((100 * read) / file.size)}%`); }
    if (!head) { const r = buf.indexOf('<run'); if (r >= 0) head = buf.slice(0, buf.indexOf('>', r) + 1); else if (buf.length > 64e6) head = buf.slice(0, 1e6); }
    for (;;) {
      if (!cur) {
        const s = buf.indexOf('<spectrum '), c = buf.indexOf('<chromatogram ');
        const i = s < 0 ? c : c < 0 ? s : Math.min(s, c);
        if (i < 0) { const keep = 16; base += Math.max(0, buf.length - keep); buf = buf.slice(-keep); break; }
        cur = { kind: i === s ? 'spectrum' : 'chromatogram', start: base + i, end: 0, header: '' };
        inHeader = true; base += i; buf = buf.slice(i);
      }
      if (inHeader) {
        const j = buf.indexOf('<binaryDataArrayList');
        const close = buf.indexOf(cur.kind === 'spectrum' ? '</spectrum>' : '</chromatogram>');
        const k = j < 0 ? close : close < 0 ? j : Math.min(j, close);
        if (k < 0) break;
        cur.header = buf.slice(0, k); inHeader = false;
      }
      const endTag = cur.kind === 'spectrum' ? '</spectrum>' : '</chromatogram>';
      const e = buf.indexOf(endTag);
      if (e < 0) { const keep = endTag.length; base += buf.length - keep; buf = buf.slice(-keep); break; }
      cur.end = base + e + endTag.length;
      entries.push(cur);
      base += e + endTag.length; buf = buf.slice(e + endTag.length); cur = null;
    }
    if (done) break;
  }
  return { head, entries };
}

function decodeArrays(text: string, groups: Record<string, string>): BinaryArray[] {
  const out: BinaryArray[] = [];
  for (const m of text.matchAll(/<binaryDataArray\b[\s\S]*?<\/binaryDataArray>/g)) {
    const blk = m[0].replace(/<referenceableParamGroupRef\s+ref="([^"]+)"\s*\/>/g, (_, id) => groups[id] ?? '');
    const bin = /<binary>([\s\S]*?)<\/binary>/.exec(blk)?.[1] ?? '';
    const cvs = blk.slice(0, blk.indexOf('<binary>'));
    const arr = decodeArray(cvs, bin);
    const params = cvParams(cvs);
    const typeCv = params.find((p) => /^MS:(1000514|1000515|1000595|1000516|1000517|1000617|1000786|100(2|3)\d{3})$/.test(p.accession) && !/^MS:100(0521|0523|0519|0522|0574|0576|23\d\d|2746|2747|2748|3088|3089|3090)$/.test(p.accession)) ?? params[0];
    const named = /name="([^"]*)"/.exec(/<cvParam[^>]*accession="MS:1000786"[^>]*>/.exec(cvs)?.[0] ?? '')?.[1];
    out.push({ name: arr.kind === 'mz' ? 'm/z' : arr.kind === 'intensity' ? 'intensity' : named || typeCv?.name || 'array', cv: typeCv ?? CV.mzArray, values: arr.values });
  }
  return out;
}

function toRecord(entry: Entry, text: string, groups: Record<string, string>, index: number): SpectrumRecord {
  const meta = parseSpectrumHeader(entry.header, groups, 0, 0, index);
  const arrays = decodeArrays(text, groups);
  const mz = arrays.find((a) => a.cv.accession === 'MS:1000514')?.values ?? new Float64Array(0);
  const intensity = arrays.find((a) => a.cv.accession === 'MS:1000515')?.values ?? new Float64Array(0);
  const precursors: Precursor[] = [...entry.header.matchAll(/<precursor\b[\s\S]*?<\/precursor>/g)].map((m) => {
    const p = m[0];
    const params = cvParams(p);
    const v = (acc: string) => { const c = params.find((x) => x.accession === acc); return c?.value != null ? Number(c.value) : undefined; };
    const act = /<activation>([\s\S]*?)<\/activation>/.exec(p)?.[1] ?? '';
    return {
      mz: v('MS:1000744') ?? v('MS:1000827') ?? 0, charge: v('MS:1000041'), intensity: v('MS:1000042'),
      isolationTarget: v('MS:1000827'), isolationLower: v('MS:1000828'), isolationUpper: v('MS:1000829'),
      activation: cvParams(act).filter((c) => c.accession !== 'MS:1000045'), collisionEnergy: v('MS:1000045'),
      spectrumRef: /spectrumRef="([^"]*)"/.exec(p)?.[1],
    };
  });
  return {
    index, nativeId: meta.id, scan: meta.scan ?? undefined, msLevel: meta.msLevel, rtSeconds: meta.rt != null ? meta.rt * 60 : undefined,
    polarity: meta.polarity ?? undefined, centroided: meta.centroided ?? true, filter: meta.filter || undefined, tic: meta.tic ?? undefined,
    basePeakMz: meta.basePeakMz ?? undefined, basePeakIntensity: meta.basePeakIntensity ?? undefined, faimsCv: meta.faimsCv ?? undefined,
    precursors, mz, intensity, arrays: arrays.filter((a) => a.cv.accession !== 'MS:1000514' && a.cv.accession !== 'MS:1000515'),
    cvParams: cvParams(entry.header.slice(0, entry.header.search(/<(scanList|precursorList|productList)\b/) > 0 ? entry.header.search(/<(scanList|precursorList|productList)\b/) : entry.header.length)),
    sourceXml: utf8(entry.header),
  };
}

function toChrom(entry: Entry, text: string, groups: Record<string, string>, index: number): ChromatogramRecord {
  const arrays = decodeArrays(text, groups);
  const time = arrays.find((a) => a.cv.accession === 'MS:1000595')?.values ?? new Float64Array(0);
  const intensity = arrays.find((a) => a.cv.accession === 'MS:1000515')?.values ?? new Float64Array(0);
  const params = cvParams(entry.header.split(/<(precursor|product)\b/)[0]);
  const type = params.find((p) => /chromatogram/.test(p.name)) ?? CV.ticChrom;
  const prec = /<precursor\b[\s\S]*?<\/precursor>/.exec(entry.header)?.[0];
  const prod = /<product\b[\s\S]*?<\/product>/.exec(entry.header)?.[0];
  const tgt = (x?: string) => (x ? Number(cvParams(x).find((c) => c.accession === 'MS:1000827')?.value) || undefined : undefined);
  // time arrays in seconds are converted to minutes for the model
  const unitSec = /<cvParam[^>]*accession="MS:1000595"[^>]*unitAccession="UO:0000010"/.test(text);
  return { index, id: /\bid="([^"]*)"/.exec(entry.header)?.[1] ?? `chrom${index}`, time: unitSec ? time.map((t) => t / 60) : time, intensity, type, precursorMz: tgt(prec), productMz: tgt(prod), sourceXml: utf8(entry.header) };
}

export const mzmlFormat: InputFormat = {
  id: 'mzML',
  label: 'mzML',
  async detect(input: InputBundle) {
    if (input.files.length !== 1) return false;
    const f = await openSource(input.files[0].file);
    return /<mzML|<indexedmzML/.test(asciiOf(await readHead(f, 8192)));
  },
  async open(input: InputBundle, ctx: ReaderContext): Promise<SpectrumSource> {
    const file = await openSource(input.files[0].file);
    const { head, entries } = await indexElements(file, ctx);
    const groups: Record<string, string> = {};
    for (const m of head.matchAll(/<referenceableParamGroup\s+id="([^"]+)"\s*>([\s\S]*?)<\/referenceableParamGroup>/g)) groups[m[1]] = m[2];
    const h = utf8(head);
    const runAttrs = /<run\b([^>]*)>/.exec(h)?.[1] ?? '';
    const meta: RunMetadata = {
      sourceFormat: 'mzML',
      sourceFiles: [{ id: 'SF1', name: input.name }],
      software: [...h.matchAll(/<software\b[^>]*id="([^"]*)"[^>]*version="([^"]*)"[^>]*>([\s\S]*?)<\/software>/g)].map((m) => ({ id: m[1], name: cvParams(m[3])[0]?.name ?? m[1], version: m[2] })),
      startTimeStamp: /startTimeStamp="([^"]*)"/.exec(runAttrs)?.[1],
      mzml: {
        cvList: block(h, 'cvList'), fileDescription: block(h, 'fileDescription'), referenceableParamGroupList: block(h, 'referenceableParamGroupList'),
        sampleList: block(h, 'sampleList'), softwareList: block(h, 'softwareList'), instrumentConfigurationList: block(h, 'instrumentConfigurationList'),
        dataProcessingList: block(h, 'dataProcessingList'), runAttributes: runAttrs,
      },
    };
    const model = cvParams(block(h, 'instrumentConfigurationList') ?? '').find((c) => /^MS:1000(4[4-9]\d|5\d\d|6\d\d|8\d\d|9\d\d)$|^MS:100(1|2|3)\d{3}$/.test(c.accession) && /instrument|Orbitrap|Q Exactive|LTQ|timsTOF|TOF|Exploris|Astral|Eclipse|Fusion|Lumos/i.test(c.name));
    if (model) meta.instrument = { model };
    const specs = entries.filter((e) => e.kind === 'spectrum');
    const chroms = entries.filter((e) => e.kind === 'chromatogram');
    async function* iterate<T>(list: Entry[], make: (e: Entry, t: string, i: number) => T, p0: number, p1: number): AsyncIterable<T> {
      let k = 0;
      while (k < list.length) {
        let j = k; const bs = list[k].start; let be = list[k].end;
        while (j + 1 < list.length && list[j + 1].start - be < 65536 && list[j + 1].end - bs < 32e6) { j++; be = list[j].end; }
        const text = dec.decode(await file.slice(bs, be).arrayBuffer());
        for (let q = k; q <= j; q++) {
          if (ctx.signal.aborted) throw new Error('Cancelled.');
          yield make(list[q], text.slice(list[q].start - bs, list[q].end - bs), q);
        }
        ctx.progress(p0 + (p1 - p0) * ((j + 1) / list.length));
        k = j + 1;
      }
    }
    return {
      meta, count: specs.length,
      spectra: () => iterate(specs, (e, t, i) => toRecord(e, t, groups, i), 0.3, 0.95),
      chromatograms: chroms.length ? () => iterate(chroms, (e, t, i) => toChrom(e, t, groups, i), 0.95, 1) : undefined,
    };
  },
};
