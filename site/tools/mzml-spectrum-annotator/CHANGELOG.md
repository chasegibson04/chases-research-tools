# Changelog — mzML Spectrum Viewer & MS/MS Annotator

## 0.3.0 — 2026-10-19
- Choose either an example or your own file (My file / Example switch) instead of both at once.
- Run (and Cancel) sit at the top of the inputs column, next to a Hide button that collapses the column.
- Ion types: Auto (follows the fragmentation method read from the scan, shown in words) or Choose your own chips.
- New "Sequence" figure next to the structure: residue letters with b/a/c flags below and y/x/z flags above each observed cleavage (linear), or per-bond flags plus ring-fragment bars for the ion under the pointer (cyclic). It follows the show/hide chips, can show all theoretical cleavages dimmed, and exports as SVG/PNG. The structure figure also follows the chips now.
- Sequence input accepts dash-separated names and PDB-style short names (Maa-W2-Vn-Sar-O2a-P-Ac5-Vu-Mad-Mle-I, 7W2, 02A, MLE...), with arrows (→), commas, spaces and position subscripts as separators, and cyclo[...] wrappers.
- New LUNA18 (paluratide) synthetic demo (HCD, [M+2H]2+ 719.4021).
- Help tooltips no longer get clipped by the inputs column.

## 0.2.0 — 2026-10-14
- Reads mzXML and gzipped files (.mzML.gz, .mgf.gz), ion-mobility arrays (1/K0, drift time) with an optional mobility window, and groups scans by FAIMS compensation voltage.
- Deisotoping (on by default): fragment assignments must agree with the charge their ¹³C envelope shows.
- Chance-match estimate from decoy-shifted ion lists, shown next to the match count.
- Optional b-ion scrambling and residue-specific side-chain losses, from the shared fragment engine.
- Extracted-ion chromatograms over the scan strip; pin a spectrum as a reference for a mirror comparison with cosine similarity.
- Plot layer toggles (series, losses, isotopes, unassigned, labels); peak table can follow the plot zoom; "Set as reference peak" adds a neutral-mass difference column with the residue that explains each gap.
- Click an ion or cleavage to isolate and zoom the spectrum; structure panel always shown; collapsible scan list and Reset.
- Fix: files whose spectrum index attributes are not 0..n−1 (e.g. OpenMS FAIMS test data) crashed on load; scan groups now use positions.
- The default group prefers groups that contain peaks, so files with empty MS2 spectra open on their MS1 data.
- Very sparse "profile" spectra keep their points when centroiding finds no interior maxima.
- Reads zstd, byte-shuffled zstd and dictionary-encoded zstd arrays (MS:1003780/1003781/1003782).
- Help text points to the new MS File Converter for vendor files.

## 0.1.0 — 2026-10-14
- First release: streaming mzML/MGF reader (plain and indexed mzML, zlib, MS-Numpress, 32/64-bit), filter-string activation parsing, precursor groups, scan strip, scan averaging with ppm clustering and minimum-presence filter, profile centroiding, charge inference from precursor isotopes.
- Annotation of linear and cyclic peptides with the shared fragment engine; manual assign/unassign/custom labels; Δm lookup; mass-error plot with recalibration; structure linking; CSV/TSV/MGF/JSON session export.
