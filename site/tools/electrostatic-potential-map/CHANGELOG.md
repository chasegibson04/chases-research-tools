# Changelog — Electrostatic Potential Map Generator

## 0.2.0 — 2026-11-02
- New colour maps: a slide-style red–orange–yellow–green–blue–violet rainbow and ColorBrewer Spectral.
- Custom gradient editor: 2 to 8 evenly spaced colours, add/remove/flip, or start from any existing map. Used by the colour bar, the 3D surface and the 2D slice.
- One-click looks (lecture slide, journal, colour-blind safe, spectral, greyscale) that set colour map, range, background and surface together.

## 0.1.0 — 2026-11-02
- Initial release (beta). In-browser restricted Hartree–Fock (s and p shells; STO-3G, 3-21G, 6-31G; H to Ca) validated against PySCF.
- SMILES, drawn (OpenChemLib editor), XYZ and MOL input; MMFF94s geometry refinement.
- 3D ESP-on-density, orbital-lobe and plain-density surfaces with colour maps, ranges, units, atom styles, labels, cut-away, backgrounds, PNG export at print resolution, PLY/OBJ meshes.
- 2D slice figure (SVG/PNG), ring probe profiles, Mulliken/Löwdin charges, dipole and quadrupole, Gaussian cube export.
