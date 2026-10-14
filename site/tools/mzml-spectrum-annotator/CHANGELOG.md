# Changelog — mzML Spectrum Viewer & MS/MS Annotator

## 0.1.1 — 2026-10-14
- Fix: files whose spectrum index attributes are not 0..n−1 (e.g. OpenMS FAIMS test data) crashed on load; scan groups now use positions.
- The default group prefers groups that contain peaks, so files with empty MS2 spectra open on their MS1 data.
- Very sparse "profile" spectra keep their points when centroiding finds no interior maxima.
- Reads zstd and byte-shuffled zstd compressed arrays (MS:1003780/1003781); dictionary-encoded zstd gives a clear message.
- Help text points to the new MS File Converter for vendor files.

## 0.1.0 — 2026-10-14
- First release: streaming mzML/MGF reader (plain and indexed mzML, zlib, MS-Numpress, 32/64-bit), filter-string activation parsing, precursor groups, scan strip, scan averaging with ppm clustering and minimum-presence filter, profile centroiding, charge inference from precursor isotopes.
- Annotation of linear and cyclic peptides with the shared fragment engine; manual assign/unassign/custom labels; Δm lookup; mass-error plot with recalibration; structure linking; CSV/TSV/MGF/JSON session export.
