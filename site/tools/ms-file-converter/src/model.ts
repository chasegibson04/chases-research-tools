// Format-neutral model shared by every reader and writer of the MS File Converter.
// Readers turn an input (one file, or a vendor folder such as a Bruker .d) into a SpectrumSource that streams
// SpectrumRecords in acquisition order; writers consume a SpectrumSource. Metadata that a target format can carry
// is kept field-by-field; mzML inputs additionally keep their original XML so mzML → mzML loses nothing.

export interface CvParam { accession: string; name: string; value?: string; unitAccession?: string; unitName?: string }
export interface UserParam { name: string; value?: string; type?: string }

export interface Precursor {
  /** Selected-ion (usually monoisotopic) m/z. */
  mz: number;
  charge?: number;
  intensity?: number;
  isolationTarget?: number;
  /** Offsets from the target (mzML convention), in m/z. */
  isolationLower?: number;
  isolationUpper?: number;
  /** Activation cvParams, e.g. MS:1000422 beam-type CID; collision energy is separate. */
  activation: CvParam[];
  collisionEnergy?: number;
  /** nativeID of the precursor scan, when known. */
  spectrumRef?: string;
}

export interface BinaryArray { name: string; cv: CvParam; unit?: CvParam; values: Float64Array }

export interface SpectrumRecord {
  /** 0-based position in the output. */
  index: number;
  /** Vendor nativeID, e.g. "controllerType=0 controllerNumber=1 scan=42" or "frame=12 scan=300". */
  nativeId: string;
  scan?: number;
  msLevel: number;
  rtSeconds?: number;
  polarity?: '+' | '-';
  centroided: boolean;
  filter?: string;
  tic?: number;
  basePeakMz?: number;
  basePeakIntensity?: number;
  lowMz?: number;
  highMz?: number;
  scanWindow?: [number, number];
  injectionTimeMs?: number;
  faimsCv?: number;
  /** Ion mobility of the whole spectrum (e.g. a PASEF MS2 window centre), when it has one value. */
  ionMobility?: { value: number; cv: CvParam; unit?: CvParam };
  precursors: Precursor[];
  mz: Float64Array;
  intensity: Float64Array;
  /** Additional arrays (ion mobility per peak, noise, baseline, resolution…). */
  arrays?: BinaryArray[];
  cvParams?: CvParam[];
  userParams?: UserParam[];
  /** mzML inputs only: the original <spectrum> element without its <binaryDataArrayList>, for loss-free rewriting. */
  sourceXml?: string;
}

export interface ChromatogramRecord {
  index: number;
  id: string;
  time: Float64Array; // minutes
  intensity: Float64Array;
  /** e.g. TIC (MS:1000235) or SRM (MS:1001473). */
  type: CvParam;
  precursorMz?: number;
  productMz?: number;
  sourceXml?: string;
}

export interface SourceFileInfo { id: string; name: string; location?: string; nativeIdFormat?: CvParam; fileFormat?: CvParam; sha1?: string }

export interface RunMetadata {
  /** Short label of the input format, e.g. "Thermo RAW", "Bruker TDF", "mzML". */
  sourceFormat: string;
  sourceFiles: SourceFileInfo[];
  instrument?: { model?: CvParam; name?: string; serial?: string; components?: CvParam[]; software?: { name: string; version: string } };
  /** Software that produced the input (kept in softwareList); the converter adds itself on write. */
  software: Array<{ id: string; name: string; version: string; cv?: CvParam }>;
  startTimeStamp?: string;
  sampleName?: string;
  /** Free-form vendor metadata kept as userParams (instrument method summary, tune data keys…). */
  extra?: Record<string, string>;
  /** mzML inputs only: verbatim header blocks for loss-free rewriting. */
  mzml?: {
    cvList?: string; fileDescription?: string; referenceableParamGroupList?: string; sampleList?: string;
    softwareList?: string; instrumentConfigurationList?: string; dataProcessingList?: string; runAttributes?: string;
  };
}

export interface SpectrumSource {
  meta: RunMetadata;
  /** Number of spectra if known up front (for progress), else null. */
  count: number | null;
  spectra(): AsyncIterable<SpectrumRecord>;
  chromatograms?(): AsyncIterable<ChromatogramRecord>;
  /** Release resources (sql.js databases, WASM memory). */
  close?(): void;
}

/** One logical input: a single file, or a vendor folder given as files with relative paths. */
export interface InputBundle {
  /** Display name: file name or folder name (e.g. "sample.d"). */
  name: string;
  files: Array<{ path: string; file: Blob }>;
}

export interface ReaderContext {
  progress: (fraction: number, message?: string) => void;
  signal: AbortSignal;
  log: (msg: string) => void;
}

export interface InputFormat {
  id: string;
  label: string;
  /** True when this reader can open the bundle (checked in order; first match wins). */
  detect(input: InputBundle): Promise<boolean>;
  open(input: InputBundle, ctx: ReaderContext): Promise<SpectrumSource>;
}

/** Find a file in a bundle by (case-insensitive) suffix of its relative path. */
export function findFile(input: InputBundle, suffix: string): { path: string; file: Blob } | undefined {
  const s = suffix.toLowerCase();
  return input.files.find((f) => f.path.toLowerCase().endsWith(s));
}

export async function readHead(file: Blob, n = 4096): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, n).arrayBuffer());
}
export const asciiOf = (b: Uint8Array) => Array.from(b, (c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : ' ')).join('');

// Frequently used cvParams (psi-ms.obo).
export const CV = {
  mzArray: { accession: 'MS:1000514', name: 'm/z array', unitAccession: 'MS:1000040', unitName: 'm/z' },
  intensityArray: { accession: 'MS:1000515', name: 'intensity array', unitAccession: 'MS:1000131', unitName: 'number of detector counts' },
  meanInvMobilityArray: { accession: 'MS:1003006', name: 'mean inverse reduced ion mobility array', unitAccession: 'MS:1002814', unitName: 'volt-second per square centimeter' },
  invMobility: { accession: 'MS:1002815', name: 'inverse reduced ion mobility', unitAccession: 'MS:1002814', unitName: 'volt-second per square centimeter' },
  hcd: { accession: 'MS:1000422', name: 'beam-type collision-induced dissociation' },
  cid: { accession: 'MS:1000133', name: 'collision-induced dissociation' },
  trapCid: { accession: 'MS:1002472', name: 'trap-type collision-induced dissociation' },
  etd: { accession: 'MS:1000598', name: 'electron transfer dissociation' },
  ecd: { accession: 'MS:1000250', name: 'electron capture dissociation' },
  ethcd: { accession: 'MS:1002631', name: 'electron-transfer/higher-energy collision dissociation' },
  irmpd: { accession: 'MS:1000262', name: 'infrared multiphoton dissociation' },
  uvpd: { accession: 'MS:1003246', name: 'ultraviolet photodissociation' },
  ticChrom: { accession: 'MS:1000235', name: 'total ion current chromatogram' },
  srmChrom: { accession: 'MS:1001473', name: 'selected reaction monitoring chromatogram' },
} as const;
