// RunMetadata for Bruker timsTOF folders, mirroring what ProteoWizard's Reader_Bruker writes (checked against the
// pwiz reference mzML files in the test corpus).
import type { CvParam, InputBundle, RunMetadata, SourceFileInfo } from '../../model';

export const TDF_NATIVE_ID: CvParam = { accession: 'MS:1002818', name: 'Bruker TDF nativeID format' };
export const TDF_FORMAT: CvParam = { accession: 'MS:1002817', name: 'Bruker TDF format' };
export const TSF_NATIVE_ID: CvParam = { accession: 'MS:1003283', name: 'Bruker TSF nativeID format' };
export const TSF_FORMAT: CvParam = { accession: 'MS:1003282', name: 'Bruker TSF format' };

const SERIES: CvParam = { accession: 'MS:1003123', name: 'Bruker Daltonics timsTOF series' };
/** Only models whose PSI-MS accession is certain; everything else is reported as the series term (as pwiz does). */
const MODELS: Record<string, CvParam> = { 'timsTOF Pro': { accession: 'MS:1003005', name: 'timsTOF Pro' } };

/** GlobalMetadata InstrumentSourceType → source cvParams (values seen in pwiz references: 1 ESI, 11 CaptiveSpray, 18 MALDI). */
const SOURCES: Record<string, CvParam[]> = {
  '1': [{ accession: 'MS:1000073', name: 'electrospray ionization' }, { accession: 'MS:1000057', name: 'electrospray inlet' }],
  '11': [{ accession: 'MS:1000398', name: 'nanoelectrospray' }, { accession: 'MS:1000485', name: 'nanospray inlet' }],
  '18': [{ accession: 'MS:1000075', name: 'matrix-assisted laser desorption ionization' }],
};
const ANALYZERS_DETECTORS: CvParam[] = [
  { accession: 'MS:1000081', name: 'quadrupole' }, { accession: 'MS:1000084', name: 'time-of-flight' },
  { accession: 'MS:1000114', name: 'microchannel plate detector' }, { accession: 'MS:1000116', name: 'photomultiplier' },
];

/** Keys copied into RunMetadata.extra (free-form userParams). */
const EXTRA_KEYS = ['InstrumentName', 'InstrumentFamily', 'InstrumentRevision', 'InstrumentSourceType', 'OperatorName', 'MethodName', 'Description',
  'AcquisitionFirmwareVersion', 'SchemaType', 'SchemaVersionMajor', 'SchemaVersionMinor', 'TimsCompressionType', 'MaldiApplicationType', 'Geometry'];

export function buildMetadata(kind: 'TDF' | 'TSF', input: InputBundle, sqlitePath: string, binPath: string, g: Record<string, string>): RunMetadata {
  const nativeIdFormat = kind === 'TDF' ? TDF_NATIVE_ID : TSF_NATIVE_ID;
  const fileFormat = kind === 'TDF' ? TDF_FORMAT : TSF_FORMAT;
  const base = (p: string) => p.split(/[\\/]/).pop() ?? p;
  const sourceFiles: SourceFileInfo[] = [
    { id: `SF_${kind.toLowerCase()}`, name: base(sqlitePath), location: input.name, nativeIdFormat, fileFormat },
    { id: `SF_${kind.toLowerCase()}_bin`, name: base(binPath), location: input.name, nativeIdFormat, fileFormat },
  ];
  const acqSw = g.AcquisitionSoftware ?? '';
  const swVersion = g.AcquisitionSoftwareVersion ?? '';
  // pwiz labels otofControl as micrOTOFcontrol (MS:1000726) and newer timsTOF control software as Compass (MS:1000712).
  const sw = /otofcontrol/i.test(acqSw)
    ? { id: 'micrOTOFcontrol', name: 'micrOTOFcontrol', version: swVersion, cv: { accession: 'MS:1000726', name: 'micrOTOFcontrol' } }
    : { id: 'Compass', name: acqSw && acqSw !== 'timsTOF' ? acqSw : 'Compass', version: swVersion, cv: { accession: 'MS:1000712', name: 'Compass' } };
  const instName = g.InstrumentName && g.InstrumentName !== '<unknown>' ? g.InstrumentName : undefined;
  const extra: Record<string, string> = {};
  for (const k of EXTRA_KEYS) if (g[k] != null && g[k] !== '') extra[`Bruker ${k}`] = g[k];
  return {
    sourceFormat: kind === 'TDF' ? 'Bruker TDF' : 'Bruker TSF',
    sourceFiles,
    instrument: {
      model: (instName && MODELS[instName]) || SERIES,
      name: instName,
      serial: g.InstrumentSerialNumber || undefined,
      components: [...(SOURCES[g.InstrumentSourceType ?? ''] ?? []), ...ANALYZERS_DETECTORS],
      software: { name: sw.name, version: sw.version },
    },
    software: [sw],
    startTimeStamp: g.AcquisitionDateTime || undefined,
    sampleName: g.SampleName || undefined,
    extra,
  };
}
