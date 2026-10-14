# Changelog — MS File Converter

## 0.2.0 — 2026-10-14
- Fix: Thermo profile m/z of two-reaction events (EThcD, ETciD, IR-ETD on Orbitrap tribrids) used the wrong calibration coefficients; the scan window and calibration are now located from the event's reaction count. All 156 internal Thermo runs now match ThermoRawFileParser point for point.
- `peakPicking true` / `vendor` uses the centroids stored in Thermo .raw files and Bruker TSF line spectra (msconvert's vendor peak picking); `peakPicking cwt` forces the built-in centroider. Ion-trap profile scans, which store no centroids, fall back to the built-in centroider.
- Thermo activation: supplemental activation per MSn stage, one supplemental-energy term per stage, filter strings with `sa` and per-stage supplemental steps.
- Reads dictionary-encoded zstd arrays (MS:1003782); faster mzXML/MGF reading (block reads) and cvParam parsing.

## 0.1.0 — 2026-10-14
- First release: in-browser msconvert counterpart.
- Readers: mzML (pass-through of original metadata), mzXML, MGF, mzData, MS1/MS2, imzML + .ibd, netCDF ANDI-MS, Thermo .raw (OpenTFRaw 3.0.0 → WebAssembly, patched to decode activation per reaction), Bruker timsTOF TDF/TSF (port of timsrust with fitted calibration), Agilent MassHunter .d (incl. MRM/SIM and 6560 IMS), MOBILion .mbi.
- Writers: indexed mzML with SHA-1 (zlib, 32/64-bit, MS-Numpress), indexed mzXML 3.2, MGF with titleMaker templates, MS1/MS2, CSV.
- msconvert-style filters, written in msconvert syntax; multi-input queue with per-file progress; output to a chosen folder (File System Access API) or downloads; vendor output formats listed with the reason they cannot be written; closed formats (Waters, Sciex, Shimadzu, BAF, ABF) recognised with an explanation.
- Validated against ProteoWizard reference mzML (Thermo, Bruker, Agilent, Mobilion test data), 156 Thermo runs against ThermoRawFileParser output, and MZmine feature detection (identical features for regenerated mzML and GC-MS netCDF).
