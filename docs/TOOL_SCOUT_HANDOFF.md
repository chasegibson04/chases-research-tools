# Tool-scout handoff: finding tool ideas in other projects

**What this file is for:** paste it into a Claude session on any computer, then say something like *"scan all these projects for useful tool ideas for this one."* That Claude scans the projects, lists the candidates, and, for the ones the owner picks, writes a build package. The owner carries that package back to the Claude that maintains the site, which builds the tool.

This file is self-contained: the scanning Claude doesn't need access to the website's repository.

---

## 1. The website

**Chase's Research Tools**: https://chases-research-tools.chase-gibson04.workers.dev (source: github.com/chasegibson04/chases-research-tools).

A free, public collection of small scientific web tools, built by Chase Gibson. Chase is a Pharmaceutical Sciences PhD student at UW–Madison, with a BME degree from Michigan, working in mass spectrometry, metabolomics, peptides, computational chemistry and medical devices.

**Goals, in priority order:**
1. Tools that work correctly and are tested.
2. Tools that are fast and easy to find through search.
3. Nothing ever computed on a server.
4. A design that doesn't look machine-generated.

Each tool also works as a portfolio piece and a citable research output: every tool has a citation block, version and changelog.

### Hard constraints, which decide what counts as a tool
- **Everything runs in the visitor's browser.** The site is static files only. Uploaded files are read locally and never sent anywhere, and there are no accounts, databases or APIs that process user data.
- **Supported runtimes:**
  - TypeScript/JavaScript (preferred, smallest and fastest);
  - Python through Pyodide (numpy, scipy, pandas, scikit-learn, RDKit, …; the first run downloads 10–30 MB);
  - R through webR;
  - C/C++ through Emscripten, and Rust through wasm-pack (WebAssembly).
- **Limits:**
  - a run is capped at 1 hour, and inputs at about 2 GB (most tools are far smaller);
  - memory is whatever a browser tab has, about 1–2 GB comfortably;
  - single-threaded by default.
- **Self-contained.** Each tool lives in its own folder. Shared code may only come from the site's shared libraries (mass-spec chemistry, peptide/fragment engine, mzML readers, spectrum plotting).
- **Every tool ships with:**
  - help text on every input;
  - at least one example with known correct ("golden") output;
  - unit tests and a README (Overview, How to use, Method, Limitations, References);
  - a citation file.
- **Not suitable as interactive tools:**
  - anything needing a GPU, a licensed binary, vendor-only Windows DLLs, a live database or web API, or huge reference databases (multi-GB);
  - anything that has to run for hours.
  - Such projects can still be listed as a **showcase** page: a description, screenshots and a download link, with no in-browser compute.

### Existing tools (don't propose duplicates; extensions are welcome)
| Tool | What it does |
|---|---|
| Peptide Mass Calculator | Monoisotopic/average mass, m/z by charge, isotope envelope |
| Peptide Fragment Ion Predictor | Linear and cyclic peptides; a/b/c/x/y/z, ETD types, losses, scrambling; structure diagram linked to the spectrum and table |
| mzML Spectrum Viewer & MS/MS Annotator | Opens mzML/mzXML/MGF in the browser; scan averaging, annotation, XIC, mirror comparison, recalibration |
| MS File Converter | In-browser msconvert: reads Thermo .raw, Bruker .d, Agilent .d, MOBILion; writes mzML/mzXML/MGF/MS1/MS2/CSV, with filters |

Being considered (not built): a de novo residue-ladder finder for peptide MS/MS.

### Categories (a new tool must fit one; new ones can be added)
| Category | Subcategories |
|---|---|
| mass-spectrometry | peptidomics, proteomics, metabolomics, lipidomics, instrumentation |
| chemistry | solutions, formula-tools, chromatography |
| biology | sequence-analysis, molecular-biology, cell-culture |
| statistics | hypothesis-testing, curve-fitting, data-utilities |
| visualization | plot-builders, color-and-style |
| software | desktop-apps, packages, pipelines (showcase projects) |

---

## 2. What makes a good tool candidate

**Look for** code or documents where someone repeatedly turns an input into an answer:
- **Calculators and converters:** concentrations and dilutions, buffer recipes, masses, isotopes, unit conversions, gradient tables, column volumes, LC flow and back-pressure, CCS, resolution.
- **Small analyses:** curve fitting (standard curves, IC50/EC50, kinetics), normalisation, PCA/PLS-DA on a pasted table, volcano plots, peak picking, deconvolution, isotope pattern matching, chromatogram integration.
- **Format and data utilities:** file converters, parsers, cleaners and mergers for instrument exports (CSV/TSV/XML/vendor text), feature-table tidying, sample-sheet and plate-map builders.
- **Sequence and structure utilities:** digestion, modifications, primer/oligo maths, codon tables, SMILES/formula handling (RDKit through Pyodide).
- **Plot builders** that turn a pasted table into a publication-ready figure (SVG/PNG export).
- **Teaching or explainer widgets:** an interactive model of a concept (a fragmentation pathway, a pharmacokinetic compartment model, an instrument principle).
- **Already solved somewhere, but painful:** scripts that people copy between projects, notebooks with a "change these parameters" cell, Excel workbooks with formulas, MATLAB/R/Python functions with a clear input → output.

**Strong signals:**
- a function with clear inputs, outputs and units;
- hard-coded constants with references (masses, coefficients, standards);
- a README or SOP describing a manual calculation;
- worked examples with known answers (perfect golden values);
- the same calculation done in several places.

**Weak or no-go signals:**
- a pipeline that only makes sense with one lab's private data layout;
- heavy dependencies with no browser equivalent;
- results that need a large database or a trained model of hundreds of MB;
- code under a licence that forbids redistribution;
- anything whose main value is the data, not the method.

**Score each candidate (1–5)** on:
- **Usefulness:** how many researchers outside the original lab would use it.
- **Fit:** whether it can run in a browser within the limits above.
- **Effort:** how much porting it needs.
- **Uniqueness:** whether a good free web version already exists. Search the web if you can.
- **Showcase-worthiness:** whether it demonstrates the owner's skills.

---

## 3. How to scan

1. **Inventory each project:** languages, entry points, READMEs, notebooks, spreadsheets, SOP or protocol documents, and the sample data that comes with it.
2. **Find candidate functions or workflows** (see section 2), and read them well enough to state their inputs, outputs, method and dependencies.
3. **List candidates in one table:** name · source project and path · one-line purpose · runtime it would need · the five scores · interactive or showcase.
4. **Stop and let the owner choose.** Don't write build packages until the owner picks candidates.
5. **For each chosen candidate, write a build package** (section 4).

### Privacy rules (important: the website and its repository are public)
- **Never copy unpublished data into a build package:** sample results, spectra, sequences of unpublished compounds or peptides, patient or animal data, collaborator data, internal file names, or lab notebook contents.
- **Describe methods; don't paste data.** Golden examples must use public or synthetic inputs, for example a public peptide (angiotensin II, gramicidin S), a public compound, or a made-up but realistic table.
- **No secrets:** no API keys, tokens, passwords, personal contact details or paths that reveal private folder layouts.
- **Licensing:** note each source file's licence. Code from other people's repositories needs a compatible licence (MIT/BSD/Apache are fine; GPL means the tool's licence must change, so flag it). The owner's own code is fine.

---

## 4. Build package (one per chosen candidate)

Make one folder per tool, `tool-brief-<short-name>/`, containing `BRIEF.md` (the template below) plus the files it lists. Keep it small, a few MB at most.

```markdown
# Tool brief: <Tool name>

## One-line pitch
<What it does, for whom, in ≤ 140 characters.>

## Why it belongs on the site
<Who uses it, how often, what they use now and why that's worse. Scores: usefulness _/5, fit _/5, effort _/5, uniqueness _/5, showcase _/5.>

## Category
<category / subcategory from the table, or a proposed new one>

## Source
- Project: <name>, path(s): <relative paths>
- Language / runtime needed: <TS | Python (Pyodide) | R (webR) | C++/Rust (WASM)>
- Licence of the source code: <…> (owner's own / third-party: link)
- Key dependencies and their browser equivalents: <…>

## Inputs (each becomes a form field with help text)
| Name | Type (number/text/select/file/table) | Units | Default | Valid range | Help text (what it is, typical value, what happens if wrong) |
|---|---|---|---|---|---|

## Outputs
<Numbers, tables (columns + units), figures (axes), downloadable files (format).>

## Method
<The algorithm in plain steps, with equations and constants (with references). Note edge cases and assumptions.>

## Golden examples (public or synthetic inputs only)
1. Input: <…> → expected output: <exact values, with tolerance>; source of truth: <paper/table/other software>
2. …

## Validation idea
<How to prove it's right: compare against a published table, another program's output, a hand calculation.>

## Limitations
<Known limits, accuracy caveats, input-size bounds.>

## References
<Papers, docs, software to cite.>

## Files included
- `src/<…>`: the core function(s), trimmed to what the tool needs
- `examples/<…>`: public or synthetic example inputs
- `screenshots/<…>`: optional, for showcase candidates
```

**Rules for the included files:**
- Include the core source (the function that does the work, with its helpers), not whole repositories.
- Remove private paths, credentials and data.
- Include example inputs only if they are public or synthetic.
- For showcase candidates, include 2–4 screenshots, install steps, and the release or download link.

---

## 5. Handing back

The owner gives the `tool-brief-*` folders to the website's Claude with a request like *"build this tool from the brief"*. That Claude:
- reads the brief and imports the method into the site's tool structure;
- writes the tests from the golden examples;
- validates it and ships it.

The better the brief's inputs, method and golden examples, the faster and more faithful the build.
