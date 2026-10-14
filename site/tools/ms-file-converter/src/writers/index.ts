// Output-format registry: open formats first (writable), then vendor formats, listed so users can see why
// they are greyed out. No vendor publishes a writer for its format and none has an open specification complete
// enough to produce files the vendor software (or MS-DIAL / MZmine via vendor libraries) would trust.
import type { OutputFormat } from './util';
import { mzmlOutput } from './mzml';
import { otherOutputs } from './other';

const vendor = (id: string, label: string, ext: string, reason: string): OutputFormat => ({ id, label, ext, writable: false, reason });

export const OUTPUT_FORMATS: OutputFormat[] = [
  mzmlOutput,
  ...otherOutputs,
  vendor('Thermo RAW', 'Thermo .raw', '.raw', 'Thermo RAW is read-only outside Thermo software: the format is closed and checksummed, and no writer (official or open) exists.'),
  vendor('Bruker TDF', 'Bruker timsTOF .d (TDF)', '.d', 'TDF stores calibration and acquisition settings that only an instrument can produce; Bruker software rejects synthetic files. Readable here, not writable.'),
  vendor('Agilent MassHunter', 'Agilent MassHunter .d', '.d', 'MassHunter .d folders contain instrument-generated binaries and method files; there is no writer outside Agilent acquisition software.'),
  vendor('Sciex WIFF', 'Sciex .wiff / .wiff2', '.wiff', 'WIFF/WIFF2 are proprietary (WIFF2 is encrypted); no writer exists.'),
  vendor('Waters RAW', 'Waters .raw', '.raw', 'Waters MassLynx data is closed; only the Windows MassLynx SDK can read it and nothing can write it.'),
  vendor('Shimadzu', 'Shimadzu .lcd / .qgd', '.lcd', 'Shimadzu LabSolutions files are closed; no writer exists.'),
  vendor('Mobilion MBI', 'Mobilion .mbi', '.mbi', 'MBI is an HDF5 layout written by Mobilion acquisition software; its full schema is not public.'),
];

export const outputById = (id: string) => OUTPUT_FORMATS.find((f) => f.id === id);
