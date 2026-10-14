## Overview

Predicts every theoretical fragment ion of a **linear or head-to-tail cyclic peptide** and shows them three linked ways: on the **full chemical structure** (classic a/b/c and x/y/z cleavage brackets, or cleavage ticks around the ring for cyclic peptides), in a **representative MS/MS spectrum**, and in a **fragment table**. Hovering any marker, peak or table cell highlights the same ion and its complementary partner everywhere. Paste a peak list to annotate a real spectrum against the prediction as a mirror plot. Built for planning experiments (which ions to expect, which bonds you can cover with HCD vs ETD) and for checking manual annotations.

## How to use

1. Type the sequence. One-letter codes; **lowercase = D-residue** (`RGDfV`). Modifications go in brackets after the residue: `M[Oxidation]`, `S[Phospho]`, `K[+42.0106]`, `C[Formula:C2H3NO]`; termini as `[Acetyl]-PEPTIDE-[Amidated]`. Non-standard residues go in parentheses or brackets: `(Orn)`, `[MeL]`, `(D-Phe)`, `[Aib]`, `[Ac5c]`. `cyclo(...)` or *Topology → Head-to-tail cyclic* makes it a ring; `cyclo(-Arg-Gly-Asp-D-Phe-Val-)` three-letter notation also works.
2. Set the precursor charge and the fragmentation method. The ion-type chips follow the method's preset; click chips to customise.
3. Press **Run**. After the first run the results update as you edit.
4. Hover a dotted marker on the structure to see which ions that cleavage produces; click it to pin. Hover peaks or table cells for the same linking. **Full structure / Condensed** switches between drawn side chains and condensed R-group formulas (the classic textbook figure).
5. To compare with data, paste "m/z intensity" lines or an MGF spectrum into *Observed peaks* (or choose a file; it is read locally and never uploaded). Matched peaks are coloured by ion type, isotope peaks are recognised, and the summary reports peaks and intensity explained and backbone bonds covered.
6. Export the ion table (CSV/TSV/JSON), the representative spectrum as MGF (TXT button), and the structure and spectrum as SVG or PNG.

## Method

**Masses.** Monoisotopic element masses from AME2020; proton 1.007276466579 u (CODATA 2022). Residue masses are amino acid − H2O. Linear neutral mass M = Σ residues + H2O + terminal modifications; head-to-tail cyclic M = Σ residues.

**Linear ions** (neutral prefix P = Σ residues 1..i + N-terminal mods, suffix S = Σ residues i+1..n + C-terminal mods; add z protons and divide by z):

| Ion | Neutral composition | Relation |
|---|---|---|
| a | P − CO | b − 27.9949 |
| b | P | acylium/oxazolone |
| c | P + NH3 | b + 17.0265 |
| c−1 (c•) | P + NH2 | c − H |
| x | S + CO2 | y + 25.9793 |
| y | S + H2O | |
| z | S + H2O − NH3 | y − 17.0265 |
| z• (z+1) | S + H2O − NH2 | y − 16.0187 (main ETD ion) |
| z+2 (z′) | z• + H | |

c and z ions are not generated N-terminal to proline (the ring keeps the fragment attached). Neutral losses are residue-gated: −H2O only for fragments containing S, T, E or D; −NH3 only for R, K, Q or N; modification-specific losses (−H3PO4, −CH4SO, −SO3) only when the modified residue is in the fragment. Immonium ions are residue − CO + H⁺. Internal fragments (optional) are b-type (Σ + H⁺) and a-type (− CO) ions from two amide cleavages.

**Cyclic ions.** A head-to-tail ring first opens at one amide bond (the linear ion has the precursor's mass), then a second cleavage releases a contiguous arc of k residues (1 ≤ k ≤ n−1, every start position): b-type = Σ arc + H⁺, a = b − CO, optional b + H2O, and the losses above (two water/ammonia losses can combine, e.g. b−2H2O, b−H2O−NH3). For ETD the arc types and offsets follow the owner's `cycfrag` model: cz• (+H), cz+1 (+2H), c (+NH3), c−1, z• (−NH+H), z+1 (−NH+2H). Identical fragments from different ring openings (e.g. in symmetric rings such as gramicidin S) are merged and every origin is listed. There are no y ions: anything that looks like one is a b ion from another ring opening.

**Representative spectrum.** A transparent rule set, not a trained model: ion-type weights per activation (HCD: y > b > a; ETD: z• ≈ c; EThcD: all four), enhanced cleavage N-terminal to Pro and C-terminal to Asp/Glu, suppressed cleavage C-terminal to Pro, weak b1, a2 boost, fragment charges limited by the number of basic sites, and favoured ring opening N-terminal to Pro/N-methyl residues for cyclic peptides. Each ion is drawn with its isotope envelope from its elemental formula. Use it to see which ions to expect, not to predict exact intensities.

**Matching.** Each theoretical ion is assigned the most intense observed peak within the tolerance (ppm or Da); peaks with several candidates list them all, smallest error first. M+1/M+2 peaks at the ion's charge are labelled as isotopes. Coverage counts backbone bonds supported by at least one ion.

**Structure diagram.** The backbone is laid out deterministically (straight chain for linear peptides, a ring for cyclic ones); side-chain 2D coordinates were generated once with RDKit in a fixed backbone context and are drawn as plain SVG (no chemistry library runs in your browser).

## Limitations

- Intensities are illustrative. For linear tryptic peptides, deep-learning predictors (Prosit, MS²PIP) are far more accurate; nothing comparable exists for cyclic peptides.
- Cyclic peptides: only head-to-tail rings. Side-chain-to-tail lariats, disulfide or thioether bridges, and stapled peptides are not modelled as rings yet (enter stapled peptides as linear with the staple residues, e.g. `[S5]`, and a mass delta). b-ion sequence scrambling (macrocyclic b-ion re-opening) is not generated.
- Satellite ions (d, v, w) and glycan oxonium ions are not generated.
- Isotope peaks use nominal ¹³C spacing (fine structure is not resolved).
- Hydroxy-acid residues of depsipeptides (Hiv, Lac, β-hydroxy fatty acids) get correct masses, but the drawing shows them with an amide nitrogen.
- Sequences up to 300 residues; very long peptides with many charges and losses can produce > 100,000 ions.

## References

1. Roepstorff P, Fohlman J. Proposal for a common nomenclature for sequence ions in mass spectra of peptides. *Biomed Mass Spectrom* 11, 601 (1984).
2. Biemann K. Appendix 5. Nomenclature for peptide fragment ions. *Methods Enzymol* 193, 886–887 (1990).
3. Ngoka LCM, Gross ML. A nomenclature system for labeling cyclic peptide fragments. *J Am Soc Mass Spectrom* 10, 360–363 (1999).
4. Niedermeyer THJ, Strohalm M. mMass as a software tool for the annotation of cyclic peptide tandem mass spectra. *PLoS ONE* 7, e44913 (2012).
5. Paizs B, Suhai S. Fragmentation pathways of protonated peptides. *Mass Spectrom Rev* 24, 508–548 (2005).
6. Syka JEP et al. Peptide and protein sequence analysis by electron transfer dissociation mass spectrometry. *PNAS* 101, 9528–9533 (2004).
7. LeDuc RD et al. ProForma: a standard proteoform notation. *J Proteome Res* 17, 1321–1325 (2018).
8. Brademan DR, Riley NM, Kwiecien NW, Coon JJ. Interactive Peptide Spectral Annotator: a versatile web-based tool for proteomic applications. *Mol Cell Proteomics* 18, S193–S201 (2019).
