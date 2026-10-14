// Input-format registry. Readers are tried in order; the first whose detect() accepts the input opens it.
// Formats that can be recognised but not read (closed vendor formats with no open reader) are reported with the
// reason, so a user sees "Waters .raw: not supported because…" rather than a generic error.
import type { InputBundle, InputFormat } from '../model';
import { readHead, asciiOf, findFile } from '../model';
import { mzmlFormat } from './mzml';
import { mzxmlFormat, mgfFormat, msTextFormat, mzdataFormat, imzmlFormat, andiFormat } from './open';
import { createThermo } from './thermo';
import { createBrukerTdf, createBrukerTsf, brukerTsf } from './bruker';
import { agilentD } from './agilent';
import { mobilionMbi } from './mobilion';

export interface ReaderOptions {
  /** timsTOF: one spectrum per frame / PASEF window instead of per mobility scan (msconvert --combineIonMobilitySpectra). */
  combineIonMobility?: boolean;
  /** MS levels (range spec) for which a reader should return the vendor's own centroids instead of profile data. */
  vendorCentroidLevels?: string;
}
export const inputFormats = (o: ReaderOptions = {}): InputFormat[] => [
  mzmlFormat, mzxmlFormat, mgfFormat, mzdataFormat, imzmlFormat, msTextFormat, andiFormat,
  createThermo({ vendorCentroidLevels: o.vendorCentroidLevels }), createBrukerTdf({ combineIonMobility: !!o.combineIonMobility }),
  o.vendorCentroidLevels != null ? createBrukerTsf({ spectra: 'centroid' }) : brukerTsf, agilentD, mobilionMbi,
];
export const INPUT_FORMATS = inputFormats();

/** Recognisable but unreadable inputs, with why. Checked after every reader declined. */
const UNSUPPORTED: Array<{ label: string; test: (i: InputBundle) => Promise<boolean> | boolean; reason: string }> = [
  { label: 'Waters .raw folder', test: (i) => i.files.some((f) => /_FUNC\d+\.DAT$/i.test(f.path)) || !!findFile(i, '_HEADER.TXT'),
    reason: 'Waters MassLynx data can only be decoded with the Windows-only MassLynx SDK; no open reader exists. Convert with msconvert on Windows, then load the mzML here.' },
  { label: 'Sciex .wiff / .wiff2', test: (i) => i.files.some((f) => /\.wiff2?(\.scan)?$/i.test(f.path)),
    reason: 'Sciex WIFF spectra live in a proprietary .wiff.scan container (WIFF2 is encrypted) readable only with the Sciex SDK. Convert with msconvert or the Sciex MS Data Converter first.' },
  { label: 'Shimadzu .lcd / .qgd', test: (i) => i.files.some((f) => /\.(lcd|qgd)$/i.test(f.path)),
    reason: 'Shimadzu LabSolutions/GCMSsolution files need the Shimadzu IO library (Windows only). Export to mzML or netCDF (ANDI) from LabSolutions, or use msconvert.' },
  { label: 'Reifycs ABF', test: (i) => i.files.some((f) => /\.abf$/i.test(f.path)),
    reason: 'Analysis Base File is a closed format written by the Reifycs converter; MS-DIAL also reads mzML, which this tool can write.' },
  { label: 'Bruker BAF / YEP / FID', test: (i) => i.files.some((f) => /analysis\.(baf|yep)$|\/fid$/i.test(f.path)),
    reason: 'Bruker BAF (Impact/maXis/solariX) and YEP files need the Bruker CompassXtract library; only timsTOF TDF/TSF data can be read in the browser.' },
  { label: 'Thermo .raw (unreadable)', test: async (i) => i.files.length === 1 && /\.raw$/i.test(i.files[0].path) && asciiOf(await readHead(i.files[0].file, 64)).includes('F i n n i g a n'),
    reason: 'This Thermo file could not be parsed (very old or unusual layout).' },
];

export async function detectFormat(input: InputBundle, o: ReaderOptions = {}): Promise<{ format: InputFormat | null; unsupported?: { label: string; reason: string } }> {
  for (const f of inputFormats(o)) {
    try { if (await f.detect(input)) return { format: f }; } catch { /* a reader that cannot even sniff the input declines */ }
  }
  for (const u of UNSUPPORTED) if (await u.test(input)) return { format: null, unsupported: { label: u.label, reason: u.reason } };
  return { format: null };
}

/** Accepted single-file extensions and folder types, for the UI's help text. */
export const INPUT_SUMMARY = [
  { group: 'Open formats', items: ['mzML (.mzML, .mzML.gz; zlib, MS-Numpress)', 'mzXML', 'MGF', 'mzData', 'MS1 / MS2', 'imzML + .ibd', 'netCDF ANDI-MS (.cdf, GC-MS)'] },
  { group: 'Vendor formats', items: ['Thermo .raw', 'Bruker timsTOF .d (TDF: PASEF, diaPASEF, prm-PASEF; TSF incl. MALDI)', 'Agilent MassHunter .d (Q-TOF, QQQ MRM/SIM, 6560 ion mobility)', 'MOBILion .mbi'] },
];
