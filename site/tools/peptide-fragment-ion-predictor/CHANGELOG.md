# Changelog — Peptide Fragment Ion Predictor

## 0.2.1 — 2026-10-19
- Sequence input accepts dash-separated names and PDB-style short names (Maa-W2-Vn-Sar-O2a-P-Ac5-Vu-Mad-Mle-I), with arrows, commas or spaces as separators.
- Ion types: Auto (follows the fragmentation method) or Choose your own chips.
- Run and Cancel moved to the top of the inputs column, with a Hide button; help tooltips are no longer clipped.

## 0.2.0 — 2026-10-14
- b-ion sequence scrambling (optional): macrocyclic b ions that re-close and re-open elsewhere, flagged bₖˢ (type b-scr).
- Residue-specific side-chain losses (optional): Thr −C₂H₄O, Ser −CH₂O, Asp/Glu −CO₂, Arg −CH₅N₃/−CH₂N₂, Met −CH₄S, dimethylamide −C₂H₇N.
- w satellite ions for Leu, Ile (wa/wb) and Val.
- Plot layer toggles: show or hide each ion series, losses, ¹³C isotopes, unassigned peaks and labels; the table follows the toggles.
- Click a cleavage or an ion label to isolate and zoom the spectrum to it; the list table can follow the plot zoom ("in view only").
- Observed-spectrum file upload accepts mzML (averaged over its largest MS2 group), mzXML and gzipped files instead of failing.
- Uploaded spectrum files use the shared reader fixes (scan grouping by position, sparse-profile fallback, zstd arrays).

## 0.1.0 — 2026-10-14
- First release: linear and head-to-tail cyclic peptides; a/b/c/c−1/x/y/z/z•/z+2 ions, cyclic b/a/b+H2O and cycfrag-compatible ETD arcs (cz•, cz+1, c, c−1, z•, z+1); residue-gated and modification losses; immonium, internal and precursor ions; Na⁺/K⁺/NH₄⁺/Li⁺ adducts.
- Full-structure and condensed diagrams with interactive cleavage markers; representative spectrum (rule-based) with isotope envelopes; ladder and list tables; peak-list matching with mirror plot.
