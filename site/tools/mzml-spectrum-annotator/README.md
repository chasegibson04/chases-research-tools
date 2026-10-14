## Overview

Opens **mzML, mzXML and MGF files (plain or gzipped) directly in your browser** (the file is read in slices on your own computer and never uploaded), groups the scans by precursor and activation, **averages scans** (for example all 1000 MS2 scans of a direct-infusion run), and lets you **annotate the MS/MS spectrum by hand** against a linear or head-to-tail cyclic peptide. Click a peak to see and change its assignment, shift-click a second peak to **measure the gap** and get residue, dipeptide and neutral-loss suggestions, and watch the cleavage sites light up on the peptide's structure. Built for manual annotation of synthetic and natural cyclic peptides from Orbitrap data.

## How to use

1. Convert vendor files to mzML first: in the browser with the [MS File Converter](/tools/ms-file-converter/) (Thermo .raw, Bruker/Agilent .d, MOBILion .mbi), or with `msconvert run.raw --mzML --zlib` or `ThermoRawFileParser -i run.raw -f 2`. Profile and centroid data both work.
2. Choose the mzML, mzXML or MGF file (`.gz` is decompressed in the browser). Optionally enter the peptide sequence (same notation as the fragment predictor: `cyclo(V(Orn)LfPV(Orn)LfP)`, `[MeL]`, `(Orn)`, lowercase = D-residue, `M[Oxidation]`).
3. Press **Run**. The tool indexes the file, picks the precursor group with the most MS2 scans, averages it and annotates it. The summary shows the charge used: by default the charge inferred from the precursor's isotope spacing in the MS2 scans (Thermo converters often write a wrong charge; the file's value is shown when it differs).
4. Choose other scans: the buttons average a whole precursor group (FAIMS runs are split by compensation voltage); in the scan strip click one scan or drag across a range to average it. Type one or more m/z values and press **Show XIC** to overlay extracted-ion chromatograms on the strip. For ion-mobility data, set *Ion-mobility window* (e.g. `0.85-1.05` 1/K0) to keep only those points before averaging.
   - **Pin as reference** keeps the current spectrum and mirrors it below the next one you open, with their cosine similarity.
5. Annotate:
   - **Hover** a peak to see its ion and its complementary partner on the structure.
   - **Click** a peak to open the assignment panel: every theoretical ion within 3× the tolerance, with ppm error. *Assign* one, *Unassign* the automatic match, or type a custom label.
   - **Shift-click** a second peak to measure Δm/z; the panel lists residues (including N-methyl and modified residues and your sequence's own non-standard residues), dipeptides and common losses at charge 1 to z.
   - **Set as reference peak** (after clicking a peak) adds a column with every peak's neutral-mass difference to it and the residue that explains the gap.
   - The chips above the spectrum show or hide each ion series, losses, ¹³C isotopes, unassigned peaks and labels. Click an ion or cleavage to isolate and zoom to it; the peak table follows the zoom (*in view only*).
   - If the mass-error plot shows an offset, press **Recalibrate** (subtracts the median error of the 30 strongest backbone assignments), then consider a tighter tolerance.
6. Export the peak table (CSV/TSV), the averaged spectrum (MGF via TXT), the annotated spectrum and structure (SVG/PNG), or a **session** (JSON) that restores your settings and manual assignments. Manual assignments are also remembered in this browser per file, scan selection and sequence.

## Method

**Reading files.** One streaming pass over the bytes finds every `<spectrum>` element (or MGF `BEGIN IONS` block) and records its byte range; only the metadata before the binary arrays is parsed. This works for plain mzML (as written by ThermoRawFileParser), indexed mzML and mzXML (nested MS2 scans become their own entries); the embedded index is not trusted because edited files often have stale offsets. Gzipped files are decompressed in memory first, since gzip has no random access. Binary arrays are decoded on demand: base64 → zlib (fflate) or zstd, plain or byte-shuffled (fzstd) → MS-Numpress linear/pic/slof (implemented from the published algorithm) → 32/64-bit little-endian values (big-endian for mzXML). Ion-mobility arrays (1/K0 or drift time) are read alongside m/z and intensity, and the FAIMS compensation voltage is kept per scan. Activation and collision energy come from the Thermo filter string when present (`@hcd30.00`, `@etd50.00@hcd30.00` = EThcD, `@modeC` = IR laser), because converters mislabel IR, EThcD and ETciD in the cvParams. When a writer omits the precursor element, the precursor m/z is taken from the filter string.

**Averaging.** Profile scans are first centroided (local maxima with a log-parabola apex fit). Peaks from all selected scans are pooled, sorted, and merged greedily while within the averaging tolerance of the cluster's running intensity-weighted mean m/z. Each merged peak gets the weighted m/z and the mean intensity (scans without the peak count as zero, so the scale matches a single scan). Peaks present in fewer than the minimum fraction of scans (default 30 %) are dropped. This mirrors the owner's `cycfrag` averaging.

**XIC and reference comparison.** An extracted-ion chromatogram sums the intensity within ±tolerance (ppm) of each target m/z in every scan of the strip. The reference comparison reports the cosine similarity of the two spectra on square-root intensities, pairing peaks within the tolerance.

**Charge inference.** In the averaged MS2 spectrum, the tool looks for the residual precursor and its ¹³C isotope peaks at +1.00336/z within 10 ppm and takes the highest consistent z.

**Annotation.** Theoretical ions come from the same engine as the Peptide Fragment Ion Predictor (linear a/b/c/x/y/z with variants; cyclic b/a arcs, optional b+H2O, and ETD-type arcs; residue-gated and combined losses; immonium and precursor ions). Optional b-ion scrambling (bₖˢ, macrocyclic b ions re-opened at another amide bond) and residue-specific side-chain losses use the same engine. Deisotoping (on by default) finds ¹³C envelopes (spacing 1.00336/z) and accepts a fragment assignment only at the charge its envelope shows. Each ion takes the most intense peak within tolerance; isotope peaks of annotated ions are labelled ¹³C. The chance-match estimate repeats the matching with every theoretical ion shifted by ±7.7, ±11.3 and ±17.1 Da/z (offsets with no common chemistry) and averages the matched-peak counts. Coverage counts backbone bonds supported by at least one assigned backbone ion. Δm candidates: every residue in the table (isobaric residues grouped), N-methyl variants, common modified residues, all standard dipeptides and common neutral losses, compared with √2 × the per-peak tolerance.

## Limitations

- imzML and vendor formats are not read; convert vendor files with the [MS File Converter](/tools/ms-file-converter/). Plain and byte-shuffled zstd arrays are read; dictionary-encoded zstd (MS:1003782) is rejected with a message.
- Gzipped files are decompressed into memory, so a very large `.gz` needs as much free memory as the uncompressed file.
- Very large files (several GB) index fine but averaging is capped at 5000 scans per selection; the schema limit shown is 2048 MB.
- Deisotoping only checks charge consistency; there is no charge deconvolution to singly charged masses, and a fragment without a visible envelope is matched at any charge.
- Averaging does not split two different ions that fall within one tolerance window.
- Matching at 10 ppm with many ion types, double losses and scrambling can produce chance matches for dense spectra; compare the match count with the chance estimate, tighten the tolerance after recalibration and review assignments.

## References

1. Martens L et al. mzML—a community standard for mass spectrometry data. *Mol Cell Proteomics* 10, R110.000133 (2011).
2. Teleman J, Dowsey AW, Gonzalez-Galarza FF, et al. Numerical compression schemes for proteomics mass spectrometry data. *Mol Cell Proteomics* 13, 1537–1542 (2014).
3. Hulstaert N et al. ThermoRawFileParser: modular, scalable, and cross-platform RAW file conversion. *J Proteome Res* 19, 537–542 (2020).
4. Chambers MC et al. A cross-platform toolkit for mass spectrometry and proteomics. *Nat Biotechnol* 30, 918–920 (2012).
5. Ngoka LCM, Gross ML. A nomenclature system for labeling cyclic peptide fragments. *J Am Soc Mass Spectrom* 10, 360–363 (1999).
6. Harrison AG, Young AB, Bleiholder C, Suhai S, Paizs B. Scrambling of sequence information in collision-induced dissociation of peptides. *J Am Chem Soc* 128, 10364–10365 (2006).
7. Brademan DR et al. Interactive Peptide Spectral Annotator: a versatile web-based tool for proteomic applications. *Mol Cell Proteomics* 18, S193–S201 (2019).
