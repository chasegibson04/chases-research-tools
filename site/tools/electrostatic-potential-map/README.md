## Overview

This tool turns a molecule into the figure shown in cation–π lectures: an **electrostatic potential (ESP) map painted on the electron-density surface**. Paste a SMILES string, draw the structure, or supply an XYZ or MOL file, and a closed-shell Hartree–Fock calculation runs in your browser. You then rotate the surface, change the colour scale, atom style, background and view, add a 2D slice or a ring probe, and export a PNG, a coloured mesh, or Gaussian cube files. Nothing is uploaded; the geometry, the quantum calculation and the figure are all produced by code running in your tab.

The classic example is benzene against hexafluorobenzene. Benzene's π cloud makes the ring face **negative** (red) and the hydrogens at the edge positive (blue), so it binds cations. Six fluorines pull that density outward and the picture reverses: the face turns **positive** and the edge negative. Load both examples and compare the Θ<sub>zz</sub> quadrupole in the results table (about −8.7 B for benzene and +9.5 B for hexafluorobenzene in experiment).

## How to use

1. **Give a structure.** Paste a SMILES string (`c1ccccc1` is benzene), or press **Draw a structure…** and sketch it, or choose *XYZ coordinates* / *MOL text* / open a file. Charged species work if the electron count is even: write the charge in the SMILES (`C[NH3+]`, `CC(=O)[O-]`) or set *Total charge* for XYZ input.
2. **Pick a basis set.** 6-31G (default) reproduces benzene's quadrupole moment and takes a few seconds. STO-3G is fastest but crude; 3-21G is a good quick choice. Elements H to Ca are supported, up to about 120 basis functions.
3. **Press Run.** The status bar shows the stages: 3D structure, integrals, SCF, density and potential grids.
4. **Shape the figure** with the controls beside the 3D view. Drag to rotate, click the view and use the wheel (or pinch) to zoom, shift-drag to pan, double-click to reset. Choose *Colour by*: electrostatic potential, a molecular orbital (HOMO, LUMO or any nearby orbital), or the bare density surface.
5. **Export.** *Save PNG* writes the figure at the physical width and resolution you set (the colour bar, title and labels are drawn into the image). *PLY/OBJ mesh* gives the coloured surface for PyMOL, ChimeraX, Blender or MeshLab. The data panel offers XYZ, MOL, CSV, JSON and Gaussian cube files (density, potential, orbitals).
6. **Optional panels.** *2D slice* draws the potential, density or an orbital on a plane (for example 1.7 Å above a ring) with contours, as vector SVG. *Ring probe* plots the potential along the axis through each aromatic ring.

### Reading the colours

By default **red is negative** potential (electron-rich: a cation would be attracted) and **blue is positive** (electron-poor). White is zero with the diverging maps. The colour bar always states the range and unit. Use *Fix this range* to lock the limits and apply the same range to every figure in a series so molecules can be compared by eye.

## Figures for publication

Good ESP figures state four things, and the *Copy caption* button writes them for you: the **level of theory and geometry** (for example RHF/6-31G on an MMFF94s geometry), the **isodensity value** (0.002 e/bohr³ is the common choice; Bader proposed 0.001), the **colour scale with units** (kcal/mol, kJ/mol or a.u.), and **what the colours mean**. Practical advice:

- Use one fixed, symmetric range for all molecules in a figure panel; a range chosen per molecule hides real differences.
- Prefer the red–white–blue map or, for colour-blind readers, the orange–white–purple or brown–white–teal maps. The rainbow map matches older papers but is harder to read quantitatively.
- Use a white (or transparent) background and orthographic projection for journals; choose *Face-on* and *Edge-on* views as in the lecture slides. Export at 600 dpi for line-art-like figures.
- A single-column journal figure is about 3.3 in wide, a double-column figure about 7 in. Set the width in inches and the dpi; the pixel size is shown.
- For a vector figure use the **2D slice** (SVG): a plane 1.5 to 2 Å above a ring is where a bound cation sits. The 3D surface is a raster image by nature; use the PLY mesh if a collaborator needs to re-render it.
- Report values rather than only colours: the table gives V<sub>s,min</sub> and V<sub>s,max</sub> on the surface, the Θ<sub>zz</sub> quadrupole, and the ring-probe potentials at fixed heights.
- *Copy settings* stores every figure option as text so a figure can be reproduced exactly later.

## Method

**Geometry.** SMILES and drawn structures are embedded in 3D with OpenChemLib's conformer generator and refined with the MMFF94s force field (Halgren, 1996). Flexible molecules show one conformer; change the seed to see another. XYZ geometries are used exactly as given and, by default, rotated to their principal axes so a planar molecule lies in the xy plane.

**Electronic structure.** Restricted closed-shell Hartree–Fock with point nuclei in a Gaussian basis of s and p shells (Cartesian p functions): STO-3G (Hehre, Stewart and Pople, 1969), 3-21G (Binkley, Pople and Hehre, 1980) or 6-31G (Hehre, Ditchfield and Pople, 1972). The basis data are generated from PySCF's bundled basis files. One- and two-electron integrals use the McMurchie–Davidson scheme with a tabulated Boys function and Schwarz screening. The self-consistent field uses a generalized Wolfsberg–Helmholz guess and Pulay DIIS and is converged to |ΔE| < 1e-10 Eh with a commutator error below 3e-9.

**Density and potential.** The density is ρ(**r**) = 2 Σ<sub>i</sub> |ψ<sub>i</sub>(**r**)|² over the occupied orbitals on a regular grid (0.30 bohr at *Standard* quality). The potential is the exact quantum-mechanical expression

V(**r**) = Σ<sub>A</sub> Z<sub>A</sub> / |**R**<sub>A</sub> − **r**| − Σ<sub>μν</sub> P<sub>μν</sub> ∫ φ<sub>μ</sub>(**r**′) φ<sub>ν</sub>(**r**′) / |**r**′ − **r**| d**r**′,

evaluated through the Hermite expansion of every primitive pair. It is computed on a coarser grid (0.40 bohr) around the molecule and interpolated to the surface with tricubic (Catmull–Rom) splines; on the benzene surface the interpolation error is below 0.3 kcal/mol against direct evaluation (median 0.03). V is in atomic units (hartree per electron); multiplying by 627.51 gives kcal/mol, the energy of a +1 point charge at that position.

**Surface.** The isosurface of ρ is extracted by marching tetrahedra, giving a closed mesh with outward-facing triangles; normals come from the density gradient. Area and enclosed volume are computed from the mesh. V<sub>s,min</sub> and V<sub>s,max</sub> are the extreme vertex values, and the mean is area-weighted.

**Other quantities.** Mulliken and Löwdin charges; the dipole moment about the centre of nuclear charge; the traceless quadrupole Θ<sub>αβ</sub> = ½ ∫ρ(3 r<sub>α</sub> r<sub>β</sub> − r² δ<sub>αβ</sub>) (nuclear and electronic parts, in Buckingham units B = D·Å). Aromatic rings are found from the bond graph (planar 5 to 7 membered rings of sp²-like atoms); the ring probe evaluates V at 0.5 to 6 Å above and below the ring centroid along the ring normal.

### Validation

The calculation is checked against **PySCF 2.14** (an independent, widely used program) in the unit tests, on 15 molecules in all three basis sets (45 calculations) including hexafluorobenzene, ions, and molecules with Cl and S:

| Quantity | Agreement with PySCF |
|---|---|
| Total energy | better than 1e-9 hartree |
| Mulliken and Löwdin charges, dipole, second moments | 1e-6 or better |
| Electron density and ESP at 14 points per calculation | 1e-6 or better |

Computed Θ<sub>zz</sub> at RHF/6-31G: benzene −8.7 B and hexafluorobenzene +14.9 B (STO-3G: −3.9 and +7.9; 3-21G: −9.8 and +12.0). The sign reversal is robust; the magnitude for hexafluorobenzene overshoots experiment at this level because Hartree–Fock without polarization functions or electron correlation overestimates the effect.

## Limitations

- **Level of theory.** Hartree–Fock with small basis sets. Signs and patterns are reliable for small organic molecules; magnitudes are semi-quantitative. For quantitative claims use a larger basis (with polarization functions) and a correlated or DFT method in a dedicated program such as PySCF, Psi4 or ORCA, and say so in the caption.
- **Elements and size.** Hydrogen to calcium, closed-shell species only (no radicals or odd-electron ions), at most about 120 basis functions: roughly 20 heavy atoms in 6-31G, more in STO-3G. Larger jobs are refused with a message instead of freezing the browser.
- **No polarization or solvent.** The map shows the isolated molecule in the gas phase, with no solvent or counter-ion. The ring-probe values are the electrostatic part of a cation–π interaction only; real binding energies also include polarization, dispersion and charge transfer.
- **Flexible molecules.** One conformer is shown. Fused or non-planar π systems are handled, but the ring probe is only reported for rings that are close to planar.
- **Geometry.** MMFF94s geometries are good for organic molecules but are not quantum-chemical optimizations. Supply an XYZ geometry from a higher-level calculation when this matters.
- **Browser.** The 3D view needs WebGL. Phones may run out of memory on large jobs. Exported PNG size is limited by the graphics card (about 8000 pixels on a side).

## References

1. Murray, J. S.; Politzer, P. The electrostatic potential: an overview. *WIREs Comput. Mol. Sci.* 1, 153–163 (2011).
2. Ma, J. C.; Dougherty, D. A. The cation–π interaction. *Chem. Rev.* 97, 1303–1324 (1997).
3. Bader, R. F. W.; Carroll, M. T.; Cheeseman, J. R.; Chang, C. Properties of atoms in molecules: atomic volumes. *J. Am. Chem. Soc.* 109, 7968–7979 (1987).
4. McMurchie, L. E.; Davidson, E. R. One- and two-electron integrals over Cartesian Gaussian functions. *J. Comput. Phys.* 26, 218–231 (1978).
5. Boys, S. F. Electronic wave functions I. *Proc. R. Soc. Lond. A* 200, 542–554 (1950).
6. Pulay, P. Convergence acceleration of iterative sequences: the case of SCF iteration. *Chem. Phys. Lett.* 73, 393–398 (1980).
7. Hehre, W. J.; Stewart, R. F.; Pople, J. A. Self-consistent molecular-orbital methods. I. Use of Gaussian expansions of Slater-type atomic orbitals. *J. Chem. Phys.* 51, 2657–2664 (1969).
8. Binkley, J. S.; Pople, J. A.; Hehre, W. J. Self-consistent molecular orbital methods. 21. Small split-valence basis sets for first-row elements. *J. Am. Chem. Soc.* 102, 939–947 (1980).
9. Hehre, W. J.; Ditchfield, R.; Pople, J. A. Self-consistent molecular orbital methods. XII. Further extensions of Gaussian-type basis sets for use in molecular orbital studies of organic molecules. *J. Chem. Phys.* 56, 2257–2261 (1972).
10. Halgren, T. A. Merck molecular force field. I. Basis, form, scope, parameterization, and performance of MMFF94. *J. Comput. Chem.* 17, 490–519 (1996).
11. Sun, Q. et al. Recent developments in the PySCF program package. *J. Chem. Phys.* 153, 024109 (2020). Used for validation.
12. OpenChemLib (BSD-3-Clause), the open-source chemistry library behind DataWarrior: github.com/cheminfo/openchemlib-js. three.js (MIT) renders the 3D view.
