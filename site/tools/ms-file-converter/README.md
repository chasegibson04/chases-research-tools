## Overview

An in-browser counterpart to ProteoWizard **msconvert**. Drop in Thermo `.raw` files, Bruker timsTOF `.d` folders, Agilent and Mobilion data, or any open format. Apply msconvert-style filters, then write indexed mzML, mzXML, MGF, MS1/MS2 or a peak CSV. Everything runs in a Web Worker in your browser tab: files are read from disk in byte ranges and never uploaded. Output goes straight into a folder you choose, or to your downloads.

It is meant for people without a Windows machine or msconvert install, for quick format changes (mzML → MGF for a search engine or GNPS, mzXML for older tools), and for preparing data for MZmine, MS-DIAL, OpenMS and Skyline.

## How to use

1. **Add inputs.** Drop files or folders on the drop zone, or use **Add files…** and **Add folder…**. A Bruker or Agilent `.d` folder counts as one input; pick the `.d` itself or a folder that contains several. An `.imzML` file is paired with its `.ibd` automatically.
2. **Pick the output format.**
   - Open formats come first and can be written.
   - Vendor formats are listed below them, greyed out. **Why can't vendor formats be written?** gives the reason for each.
3. **Pick where to save.** In Chrome, Edge and Opera, **Choose folder…** writes every output straight into that folder; tick *Overwrite existing files* to replace files with the same name. Other browsers download each file.
4. **Set encoding and filters (optional).**
   - Precision and zlib work like msconvert's `--64`/`--32` and `--zlib`; numpress is under *Advanced options*.
   - Filters use msconvert's syntax, one per line, applied top to bottom. **Add filter** inserts a template line for each supported filter.
5. Press **Run**.
   - Inputs convert one after another, each with its own progress bar.
   - The queue shows the detected format, spectrum count, output file, size and location for each input.
   - Click a row to see its first 200 spectra and the log.

Examples:

| msconvert | here |
|---|---|
| `msconvert x.raw --mzML --zlib` | output mzML, zlib on (the defaults) |
| `msconvert x.raw --mgf --filter "peakPicking true 1-" --filter "msLevel 2-"` | output MGF; filters `peakPicking true 1-` and `msLevel 2-` |
| `msconvert x.d --combineIonMobilitySpectra` | tick *timsTOF: combine ion mobility* |
| `--filter "titleMaker <RunId>.<ScanNumber>"` | *MGF TITLE template* |

## Supported formats

| Format | Read | Write | Notes |
|---|---|---|---|
| mzML (plain, indexed, `.gz`; zlib, zstd incl. byte-shuffled and dictionary-encoded, MS-Numpress, 32/64-bit) | yes | yes | mzML → mzML keeps every original cvParam/userParam and header block ("Keep original mzML metadata") |
| mzXML 2.x/3.x | yes | yes (3.2, indexed, SHA-1) | |
| MGF | yes | yes | msconvert titleMaker fields |
| MS1 / MS2 | yes | yes | |
| mzData 1.05 | yes | – | legacy PSI format |
| imzML + .ibd | yes | – | pixel coordinates kept as userParams |
| netCDF ANDI-MS (`.cdf`) | yes | – | classic CDF-1/2 (GC-MS exports); netCDF-4/HDF5 is not |
| Thermo `.raw` | yes | – | OpenTFRaw 3.0.0 compiled to WebAssembly |
| Bruker timsTOF `.d` (TDF: PASEF, diaPASEF, prm-PASEF; TSF incl. MALDI) | yes | – | per-scan (msconvert default) or combined ion mobility |
| Agilent MassHunter `.d` (Q-TOF, TOF, quadrupole, QQQ MRM/SIM, 6560 ion mobility) | yes | – | MRM/SIM become chromatograms, as in msconvert |
| MOBILion `.mbi` (HDF5) | yes | – | h5wasm, loaded only for .mbi |
| Waters `.raw`, Sciex `.wiff`/`.wiff2`, Shimadzu `.lcd`/`.qgd`, Bruker BAF/YEP, Reifycs ABF | recognised, refused with the reason | – | readable only through Windows vendor SDKs |

Writing vendor formats is not possible. No vendor publishes a writer, and the formats are closed. Every reader of them (msconvert, MS-DIAL, MZmine) depends on the vendor's own libraries, which would reject a synthetic file. To move data between vendor ecosystems, convert to mzML: MS-DIAL, MZmine, Skyline, OpenMS and the major search engines all import it.

## Method

- **Pipeline.** Every reader turns its input into one format-neutral stream of spectra: native ID, scan number, MS level, retention time, polarity, centroid/profile flag, filter string, TIC, base peak, scan window, injection time, FAIMS CV and ion mobility, precursors (selected ion, charge, isolation window, activation and collision energy, precursor scan reference), binary arrays, and leftover cvParams and userParams. Run-level metadata is kept too: source file and native ID format, instrument, software, start time, sample, and vendor extras such as the Thermo instrument method. Filters transform the stream, and writers consume it.
- **mzML writer.**
  - The spectrum list is written into a buffer first, so the `count` is exact after filters.
  - The header is generated afterwards, and our software and processing steps are appended to the original lists.
  - Index offsets are shifted by the header length.
  - The `<fileChecksum>` is a streaming SHA-1 of every byte up to and including `<fileChecksum>`, as in ProteoWizard.
  - CV terms follow psi-ms.obo.
  - MS-Numpress encoders follow Teleman et al. (2014).
- **Thermo .raw.** A small Rust wrapper (`src/runtime/rust`) exposes OpenTFRaw's per-scan metadata and peaks to JavaScript. The WebAssembly side asks for byte ranges, and the worker answers synchronously with `FileReaderSync`, so a multi-GB file is never loaded into memory. Two rules follow ProteoWizard:
  - The isolation target is the scan event's reaction m/z.
  - A trailer "Monoisotopic M/Z" lying more than half the isolation width plus 3/z away from it is not trusted; it is kept as a userParam.
  - **Activation** is decoded from the scan event's reaction records: Thermo's activation type per reaction, supplemental steps (EThcD, ETciD, IR-ETD) and their energies. OpenTFRaw 3.0.0 does not decode these, so the crate is vendored with a two-line patch (`src/runtime/rust/vendor/opentfraw/PATCH.md`), and the filter string is rebuilt to match (`@etd50.00@hcd30.00`, `sa`, `@modeC` for the IR laser). ETD reaction time is a userParam, not a collision energy.
  - Profile m/z uses each scan's calibration coefficients; a second patch fixes where OpenTFRaw looks for them in two-reaction (EThcD/ETciD/IR-ETD) events on tribrids.
  - Validated on 156 internal Thermo runs (Orbitrap tribrid; CID, HCD, ETD, EThcD, ETciD, IR-ETD, IRMPD, MS3) against ThermoRawFileParser output. Spectrum counts, retention times and precursor m/z are identical, and every data point matches (70 million profile points; centroided references match the vendor centroids from `peakPicking true`); activation matches except for IRMPD, which ThermoRawFileParser labels only as a generic "dissociation method".
- **Bruker TDF/TSF.**
  - The reader is ported from timsrust (MIT). The SQLite metadata is read with sql.js; frames are read one at a time and decompressed with zstd or LZF.
  - m/z and 1/K0 use the instrument's calibration tables. The formulas, including temperature drift, were fitted against ProteoWizard output; see `src/readers/bruker/calibration.ts`.
  - On the ProteoWizard test data, peak counts and intensities match exactly, and m/z is within 0.07 ppm.
- **Filters.** These implement msconvert's semantics where the two overlap:
  - msLevel, scanNumber, index, scanTime, polarity, activation, analyzer, stripIT;
  - peakPicking: like msconvert, `peakPicking true` (or `vendor`) uses the instrument's own centroids when the file stores them (Thermo .raw centroid streams; Bruker TSF line spectra); elsewhere, or with `peakPicking cwt`, a local-maximum centroider with Gaussian apex refinement;
  - zeroSamples, mzWindow, threshold (count / absolute / bpi-relative / tic-cutoff), mzShift, metadataFixer;
  - chargeStatePredictor: precursor isotope spacing in the preceding MS1, then msconvert's rule that ≥ 90% of fragment intensity below the precursor means 1+;
  - MS2Deisotope, scanSumming, sortByScanTime, limit.

## Testing

`tests/convert.test.ts`:
- Round-trips the synthetic demo through every writer and re-reads it.
- Checks SHA-1 vectors, base64 and index offsets.
- With the public test corpus present (set `MS_CORPUS` to its folder; these tests skip otherwise), it also:
  - converts every corpus mzML/mzXML/MGF/mzData/MS2/imzML file to mzML and back, with identical spectrum and peak counts;
  - compares each Thermo test `.raw` with ProteoWizard's reference mzML: MS level, retention time, precursor, charge and non-zero peak count.

`tests/bruker.test.ts`, `tests/agilent.test.ts` and `tests/mobilion.test.ts` compare against ProteoWizard's reference mzML. Peak counts and intensities match exactly; m/z is within 0.07 ppm, the float32 precision of the references. `tests/vendor-convert.test.ts` runs every vendor test folder through the full convert path. `tests/e2e.spec.ts` converts a Thermo `.raw` and a timsTOF `.d` through the page in Chromium, and checks saving into a chosen folder.

Opt-in checks on your own data (never committed): `BACKTEST_LIST` (+ `BACKTEST_OUT`) runs every listed file through mzML and MGF (`tests/backtest.test.ts`); `PAIRS_LIST` compares vendor files with reference mzML of the same runs (`tests/pairs.test.ts`).

Command line: the same conversion code runs outside the browser with `npx vite-node --config vitest.config.ts tools/ms-file-converter/scripts/convert-cli.ts -- <input> <outDir> [format] ["filter;filter"]` (from `site/`).

Licensing: the tool is MIT; the Thermo reader bundles OpenTFRaw (Apache-2.0, `src/runtime/rust/vendor/opentfraw/LICENSE`).

## Limitations

- **Size and speed.**
  - Inputs are limited to 2 GB each, and a run to one hour per input.
  - Conversion is single-threaded and slower than native msconvert. Measured on a desktop: a 23 MB Thermo .raw converts to mzML in about 8 s and a 27 MB mzML in about 11 s, so plan for roughly 5–8 minutes per GB.
  - Extra downloads load only when needed: the Thermo reader is ~310 KB of WebAssembly, the Bruker reader adds sql.js (~650 KB), and MOBILion files add h5wasm (~1 MB gzipped).
  - Output is assembled as a Blob before saving. Chromium spills large Blobs to disk; other browsers may hold them in memory.
- **Thermo (OpenTFRaw 3.0.0).**
  - Multiplexed (MSX) scans and the SPS ions of SPS-MS3 scans are not listed as extra precursors (msconvert lists them). Ordinary MS3 chains are.
  - Scan events with in-source CID (`sid=`) in some files are misread.
  - Profile scans are written without the zero-intensity flank points ProteoWizard adds; the signal is the same.
  - Chromatograms are not read from .raw, so a TIC is computed from the MS1 scans.
- **Bruker.**
  - The `analysis.tdf` database is read into memory; frames are not.
  - Per-scan mode on a full run gives millions of spectra, as msconvert does.
  - No CCS values, and no chromatograms.
- **Agilent.**
  - DAD/UV spectra are skipped.
  - No combined-ion-mobility mode.
  - SRM traces are grouped by Q1, collision energy and transition. msconvert sometimes splits near-identical Q3 values into extra traces.
  - The LZF profile decoder has only synthetic tests.
- **MOBILion.** Per-spectrum TIC is computed from the spectrum, while pwiz repeats the frame TIC. No collision-energy ramps.
- **Not supported.**
  - Waters, Sciex, Shimadzu, Bruker BAF and Reifycs ABF (see above).
  - Writing vendor formats.
  - mzMLb, imzML and netCDF output.
  - netCDF-4 input.
  - The msconvert filters demultiplex, lockmassRefiner, mzRefiner (it needs identifications), and the vendor-specific centroiding and charge algorithms.
- The folder picker needs the File System Access API (Chromium browsers); elsewhere, outputs download.

## References

1. Chambers MC, et al. A cross-platform toolkit for mass spectrometry and proteomics. *Nat Biotechnol* 30, 918–920 (2012). msconvert: https://proteowizard.sourceforge.io/
2. Martens L, et al. mzML — a community standard for mass spectrometry data. *Mol Cell Proteomics* 10, R110.000133 (2011).
3. Teleman J, et al. Numerical compression schemes for proteomics mass spectrometry data. *Mol Cell Proteomics* 13, 1537–1542 (2014).
4. OpenTFRaw (Apache-2.0): https://github.com/Sigilweaver/OpenTFRaw
5. timsrust (MIT, MannLabs): https://github.com/MannLabs/timsrust
6. Pedrioli PGA, et al. A common open representation of mass spectrometry data and its application to proteomics research (mzXML). *Nat Biotechnol* 22, 1459–1466 (2004).
