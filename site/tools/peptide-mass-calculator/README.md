## Overview

Computes the elemental composition, monoisotopic mass, average mass, and charge-state m/z values of a peptide from its one-letter sequence, plus a theoretical isotope envelope. It is the reference implementation that every other tool on this site is modelled on.

## How to use

1. Paste a sequence in one-letter code (e.g. `DRVYIHPF`). Whitespace and numbers are ignored.
2. Choose the maximum charge state to tabulate.
3. Tick **Carbamidomethyl cysteine** if your sample was alkylated with iodoacetamide; tick **Cyclic** for head-to-tail cyclic peptides.
4. Press **Run**. Export the m/z table as CSV or the isotope figure as PNG/SVG.

## Method

Residue monoisotopic masses and formulas follow IUPAC 2013 atomic masses (12C = 12.000000, 1H = 1.0078250319, 14N = 14.0030740052, 16O = 15.9949146221, 32S = 31.97207069). The neutral peptide mass is the sum of residue masses plus one water (18.0105647 Da), minus one water for cyclic peptides. m/z for charge z is (M + z·1.00727646688)/z.

The isotope envelope is computed by convolving the isotope distributions of every atom (C, H, N, O, S natural abundances) and binning by nominal mass offset, so peak positions are approximate (M + k·1.00335) while relative intensities are exact under the binning assumption.

## Limitations

- Only the 20 standard residues and the two listed modifications are supported.
- Isotope peak positions use a nominal 1.00335 Da spacing; fine structure (e.g. 13C vs 2H splitting) is not modelled.
- Sequences longer than ~5,000 residues are rejected to keep the convolution fast.

## References

1. Meija, J. et al. (2016). Atomic weights of the elements 2013. *Pure Appl. Chem.* 88, 265–291.
2. Rockwood, A. L. & Van Orden, S. L. (1996). Ultrahigh-speed calculation of isotope distributions. *Anal. Chem.* 68, 2027–2030.
