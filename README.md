# Chase's Research Tools

Free, open-source scientific tools that run entirely in the browser, published at a single static site. Every tool is importable from this repository, citable, and computed on the user's machine (never on a server).

**Live site:** https://chases-research-tools.chase-gibson04.workers.dev
**License:** MIT · **Author:** Chase Gibson (University of Wisconsin–Madison)

## For AI agents and contributors: start here

1. Read **[AGENTS.md](AGENTS.md)** (rules that apply to every session, including the mandatory changelog).
2. Importing a tool? Follow **[docs/TOOL_IMPORT_GUIDE.md](docs/TOOL_IMPORT_GUIDE.md)** end to end, then **[docs/TESTING_PROTOCOL.md](docs/TESTING_PROTOCOL.md)**.
3. Updating the CV page? **[docs/CV_PAGE_GUIDE.md](docs/CV_PAGE_GUIDE.md)**.
4. Everything else is indexed in **[docs/README.md](docs/README.md)**.

The canonical prompt that triggers an import is simply:

> "Hi! I have a module named roughly X at this directory: /path/to/project. Please follow the README and AGENTS instructions to import this to the site, test, and push when ready."

## Repository layout

```
.
├── AGENTS.md                 # Rules for every agent/session (read first)
├── CHANGELOG.agent.log       # Append-only, timestamped work log (mandatory)
├── README.md                 # This file
├── CITATION.cff              # How to cite the site as a whole
├── LICENSE                   # MIT
├── wrangler.jsonc            # Cloudflare Workers static-assets deploy config
├── package.json              # Root wrapper scripts (build/validate/log/new-tool/export-tool)
├── .github/workflows/ci.yml  # Validate → typecheck → unit → build → e2e
├── docs/                     # All project documentation (see docs/README.md; PROMPTS.md = copy-paste prompts)
├── scripts/                  # Node-only maintenance scripts (Windows + macOS; see scripts/README.md):
│                             #   validate-tools, new-tool, export-tool, log, check-changelog, make-images,
│                             #   serve-dist; lib/tool-graph.mjs (tool import-rule checker)
├── .github/                  # CI, optional deploy workflow, issue/PR templates, dependabot
├── SECURITY.md · CODE_OF_CONDUCT.md · CONTRIBUTING.md · .env.example
└── site/                     # The entire website (Astro)
    ├── astro.config.mjs
    ├── src/
    │   ├── config/           # site.ts (identity/nav/theme), monetization.ts (ads/donate)
    │   ├── data/             # categories.json (registry), cv.json
    │   ├── layouts/          # Base.astro
    │   ├── components/       # Header, Footer, AdSlot, CitationBox, RelatedTools, …
    │   │   ├── tool/         # Preact runtime UI: ToolHost, ToolShell, ParamField, FigurePanel, …
    │   │   ├── ms/           # Shared mass-spec UI: SpectrumCanvas, IonTable, PeptideStructure, … (ADR-009)
    │   │   └── preview/      # Internal sketches of candidate tools (e.g. LadderPreview)
    │   ├── lib/              # types, citation formatter, export helpers, figure wrapper
    │   │   ├── ms/           # Shared mass-spec library: residues, fragments, matching, mzML reader, … (ADR-009)
    │   │   └── runtime/      # Web Worker host, Pyodide/webR/WASM loaders, device limits
    │   ├── pages/            # Routes (tools/[slug], categories, cv, about, contact, design/themes, …)
    │   └── styles/           # tokens.css, themes/{graphite,paper,spectra,michigan,wisconsin}.css, global.css, cv.css
    ├── tools/                # ONE FOLDER PER TOOL (the public, downloadable modules)
    │   ├── tool.schema.json  # Manifest schema every tool must satisfy
    │   ├── _template/        # Copied by `npm run new-tool`
    │   ├── peptide-mass-calculator/          # Reference implementation
    │   ├── peptide-fragment-ion-predictor/
    │   ├── mzml-spectrum-annotator/
    │   └── ms-file-converter/                # In-browser msconvert (vendor formats → mzML/MGF/…)
    ├── tests/e2e/            # Site-wide generic Playwright protocol (tool-specific specs live in tools/<slug>/tests/)
    └── public/               # Static files: _headers, _redirects, ads.txt, robots.txt, og-default.png,
                              #   cv/headshot.jpg, tools/<id>/ (showcase figures), runtimes/, fonts/
```

## Quick start (local)

```bash
npm --prefix site install
```

```bash
npm run dev
```

Then open http://localhost:4321. Theme mockups: http://localhost:4321/design/themes/.

Other root commands: `npm run verify` (validate → unit → types → build → e2e), `npm run validate` (manifests + tool import rules), `npm run test`, `npm run check`, `npm run build`, `npm run test:e2e`, `npm run images` (OG image + placeholder headshot), `npm run new-tool -- <slug> "<Name>"`, `npm run export-tool -- <slug> [outDir]` (standalone runnable copy of one tool, default `exports/<slug>/`), `npm run log -- "<scope>" "<message>"`.

## How a tool works (30-second version)

Each tool is a folder `site/tools/<slug>/` containing a `tool.json` manifest (category, inputs with help text, compute limits, layout, citation, SEO…), a `README.md` rendered on the page, a pure `src/compute.ts` that runs inside a Web Worker, a `src/index.tsx` Preact UI built from shared components, `examples/*.json` with golden expected values, and `tests/`. The site reads the manifest and does the rest: routing, directory listing, related tools, citation box, structured data, ad placement, and the generic end-to-end test. Python and R tools run via Pyodide and webR (WebAssembly) inside the same worker.

## Status

Launched 2026-10-13 on Cloudflare Workers (workers.dev URL); default theme paper (`site/src/config/site.ts`); visitors can switch to Dark, Michigan or Wisconsin from the header. Tools: peptide mass calculator, peptide fragment ion predictor, mzML spectrum annotator, MS file converter. No custom domain yet; monetization IDs unset. See [docs/ROADMAP.md](docs/ROADMAP.md) for the launch checklist.
