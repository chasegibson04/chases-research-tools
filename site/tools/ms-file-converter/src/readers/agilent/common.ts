// Shared pieces of the Agilent readers: AcqData file lookup, run metadata, mass calibration lookup.
import type { InputBundle, RunMetadata, CvParam } from '../../model';
import { parseDefaultMassCal, calFromRow, type MassCal, type DefaultCals } from './calibration';

type F = { path: string; file: Blob };
export interface AcqFiles { [key: string]: F | undefined }

/** Locate AcqData files case-insensitively (MassHunter writes both MSScan.bin and msscan.bin). */
export function acqFiles(input: InputBundle): AcqFiles {
  const out: AcqFiles = {};
  for (const f of input.files) {
    const p = f.path.replace(/\\/g, '/').toLowerCase();
    const m = /(?:^|\/)acqdata\/([^/]+)$/.exec(p);
    if (m) out[m[1]] = f;
  }
  return out;
}

export const MS = (accession: string, name: string): CvParam => ({ accession, name });
export const AGILENT_NATIVE_ID = MS('MS:1001508', 'Agilent MassHunter nativeID format');
export const AGILENT_FORMAT = MS('MS:1001509', 'Agilent MassHunter format');

const xmlTag = (xml: string | undefined, tag: string) => (xml ? new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`).exec(xml)?.[1] : undefined);

export async function readMeta(files: AcqFiles, name: string): Promise<RunMetadata> {
  const contents = files['contents.xml'] ? await files['contents.xml'].file.text() : undefined;
  const devices = files['devices.xml'] ? await files['devices.xml'].file.text() : undefined;
  const sample = files['sample_info.xml'] ? await files['sample_info.xml'].file.text() : undefined;
  const ms = devices ? [...devices.matchAll(/<Device\b[^>]*>([\s\S]*?)<\/Device>/g)].map((m) => m[1]).find((d) => /TOF|Quad|QQQ|MS|IMS/i.test(xmlTag(d, 'Name') ?? '')) : undefined;
  const acquired = xmlTag(contents, 'AcquiredTime');
  const sampleName = sample ? /<Name>\s*Sample Name\s*<\/Name>\s*<DisplayName>[^<]*<\/DisplayName>\s*<Value>([^<]*)<\/Value>/.exec(sample)?.[1] : undefined;
  const extra: Record<string, string> = {};
  const inst = xmlTag(contents, 'InstrumentName');
  if (inst) extra['Agilent instrument name'] = inst;
  if (ms) for (const k of ['Name', 'ModelNumber', 'SerialNumber', 'Type', 'StoredDataType']) { const v = xmlTag(ms, k); if (v) extra[`Agilent device ${k}`] = v; }
  const model = xmlTag(ms, 'ModelNumber');
  return {
    sourceFormat: 'Agilent MassHunter .d',
    sourceFiles: [{ id: 'MSScan.bin', name: 'MSScan.bin', location: name, nativeIdFormat: AGILENT_NATIVE_ID, fileFormat: AGILENT_FORMAT }],
    instrument: { model: MS('MS:1000490', 'Agilent instrument model'), name: [xmlTag(ms, 'Name'), model].filter(Boolean).join(' ') || undefined, serial: xmlTag(ms, 'SerialNumber') },
    software: [{ id: 'MassHunter', name: 'Agilent MassHunter', version: xmlTag(contents, 'Version') ?? '' }],
    startTimeStamp: acquired ? (/[Z+-]\d*:?\d*$/.test(acquired.slice(10)) ? acquired : acquired + 'Z') : undefined,
    sampleName: sampleName || undefined,
    extra,
  };
}

export interface Calibrator { forScan(calId: number | undefined, massCalOffset: number | undefined, index: number): MassCal | null }

export async function loadCalibration(files: AcqFiles): Promise<Calibrator> {
  const defs: DefaultCals = files['defaultmasscal.xml'] ? parseDefaultMassCal(await files['defaultmasscal.xml'].file.text()) : { byId: new Map(), flags: new Map() };
  const mc = files['msmasscal.bin'] ? new DataView(await files['msmasscal.bin'].file.arrayBuffer()) : null;
  const first = defs.byId.values().next().value ?? null;
  return {
    forScan(calId, massCalOffset, index) {
      const flags = defs.flags.get(calId ?? 1) ?? defs.flags.values().next().value ?? 0;
      if (mc) {
        const row = calFromRow(mc, massCalOffset != null && massCalOffset > 0 ? massCalOffset : 0x48 + 84 * index, flags);
        if (row) return row;
      }
      return defs.byId.get(calId ?? 1) ?? first;
    },
  };
}
