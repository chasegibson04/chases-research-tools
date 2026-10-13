# Tool import guide (for agents)

You were asked something like: *"I have a module named roughly X at /path/to/project. Follow the README and AGENTS instructions to import this to the site, test, and push when ready."* This document is the complete procedure. Do not skip steps. Log progress in `CHANGELOG.agent.log` as you go (`npm run log -- "tools/<slug>" "…"`).

## Phase 0 — Orient (5 min)
1. Read `AGENTS.md`, the last 30 lines of `CHANGELOG.agent.log`, and `site/tools/peptide-mass-calculator/` (the reference tool). Log "starting: import <X> from <path>".
2. Read the source project thoroughly: entry points, inputs, outputs, parameters, dependencies, any plots, any test data, README, licence of third-party code.
3. Decide the **slug** (kebab-case, keyword-rich, stable forever, e.g. `cyclic-peptide-fragmentation`) and **name** (Title Case, ≤ 60 chars, what a user would search for).
4. Decide **category/subcategories** from `docs/CATEGORIES.md`. If ambiguous, pick the most likely and note it in the changelog; the owner can move it.
5. Decide the **runtime** path from `docs/RUNTIMES.md`:
   - Pure math / string / array logic → **port to TypeScript** (fastest for users, smallest download). Default choice; most R/Python scientific scripts under ~500 lines port cleanly.
   - Heavy numpy/scipy/pandas, or faithful reproduction matters → **Pyodide**.
   - Depends on specific CRAN packages / statistical routines → **webR**.
   - Existing C/C++/Rust → **WASM** (Emscripten / wasm-pack).
   - Cannot run in a browser (GUI app, GPU, huge data, needs a server) → **showcase** (`docs/SHOWCASE_PROJECTS.md`).

## Phase 1 — Scaffold
```bash
npm run new-tool -- <slug> "<Display Name>"
```
This copies `site/tools/_template/` → `site/tools/<slug>/` and fills `__SLUG__`, `__NAME__`, `__DATE__`.

## Phase 2 — Manifest (`tool.json`)
Fill every field per `docs/TOOL_MANIFEST_SPEC.md`. Points agents commonly get wrong:
- `inputs[].help` is mandatory, ≥ 15 chars, and must say: what it is, units, typical value, what happens if wrong.
- `keywords` = phrases a human types into Google (5–10). `tags` = lowercase topical slugs for related-tool scoring.
- `seo.title` ≤ 65 chars with the main keyword; `seo.metaDescription` 70–160 chars; add 2–5 `seo.faq` entries (real questions, factual answers).
- `compute.*` limits must be honest; test the largest reasonable input to set `maxRuntimeSeconds` and `maxInputSizeMB`.
- `layout.aspect`: `fill` (default) means the tool fits the viewport below the header; use `tall` only for tools with long result lists.
- `maintenance.sourceOrigin`: the original path/repo and commit, for provenance.
- `status`: `beta` for a first import; `stable` after the owner has used it; `draft` is hidden from listings and `noindex`.
- Run `npm run validate` until it prints OK.

## Phase 3 — Compute (`src/compute.ts`)
- Export `default` async function `(input, ctx) => output`. Pure: no DOM, no `window`, no globals. Deterministic (seed any randomness from an input).
- Validate inputs at the top and throw `Error` with user-readable messages.
- Call `ctx.progress(fraction, message)` at least every ~0.5 s of work; check `ctx.signal.aborted` inside long loops and throw if set.
- Return plain JSON-serializable data (numbers, strings, arrays, objects). Typed arrays are fine (structured clone).
- Python: `import { runPython } from '@/lib/runtime/pyodide'` and keep the Python source in `src/runtime/main.py` imported as a string (`?raw`). R: `runR` from `@/lib/runtime/webr`. WASM: artifacts in `src/runtime/` (see RUNTIMES.md).
- Keep constants (masses, tables) in a separate `src/constants.ts` with a source comment for each table.

## Phase 4 — UI (`src/index.tsx`)
- Use `ToolShell` for layout, `ParamField` (via the shell) for manifest inputs, `FigurePanel` for plots, `ExportMenu` for CSV/TSV/JSON/TXT. Tool-specific widgets go in `extraInputs` or the results area.
- Every displayed result value that a golden example checks must carry `data-output="<key>"` (the generic e2e test reads these).
- Show elapsed time in the status message on completion. Keep the whole tool visible without scrolling at 1366×768 for typical outputs; put long tables in `.results-table` (scrolls internally).
- Follow `docs/DESIGN_SYSTEM.md`: no custom colors, no inline emoji, no "AI" wording.

## Phase 5 — Examples, docs, tests
- `examples/*.json`: ≥ 1, ideally 2–3 (typical, edge case, larger). Each has `label` (must match manifest), `input`, `expected` golden values computed independently (hand calculation, literature value, or the original program's output; state the source in `description`).
- `README.md`: the five required sections (Overview, How to use, Method, Limitations, References). Write it for a scientist who found the page via Google. Include equations and constants. Mention where the original implementation came from.
- `CITATION.cff`, `CHANGELOG.md`: fill in; add `alsoCite` for underlying methods.
- `tests/compute.test.ts`: golden example(s), input validation, at least one property/invariant test. For Python/R tools, unit-test the TypeScript wrapper's input validation, and cover the numerical path in e2e (the runtime only exists in a browser).
- Optional `tests/e2e.spec.ts` for tool-specific interactions (file upload, multi-step flows).

## Phase 6 — Verify (all must pass; see TESTING_PROTOCOL.md)
```bash
npm run validate
```
```bash
npm run test
```
```bash
npm run check
```
```bash
npm run build
```
```bash
npm --prefix site run test:e2e
```
Then open `npm run dev` → `/tools/<slug>/` and manually confirm: loads instantly, each example runs, tooltips show, exports download, figure zooms and exports PNG/SVG, no console errors, looks right at 1366×768 and on a 390 px wide viewport.

## Phase 7 — Ship
1. Bump nothing else; set `maintenance.updated` to today. Log "done: imported <slug>; tests green; notes: …".
2. `git checkout -b tool/<slug>` → commit (`feat(tools): add <slug>`) → push.
3. If the owner said "push when ready": merge/push to `main` (auto-deploys). Otherwise open a PR and report the preview URL.
4. In the final message to the owner: the URL path, what was ported vs. simplified, limits chosen, anything left as TODO, and suggested `related` links.

## Checklist (copy into your changelog "done" entry)
`[ ] manifest valid  [ ] help on every input  [ ] ≥1 golden example  [ ] unit tests  [ ] e2e green  [ ] README 5 sections  [ ] CITATION.cff  [ ] limits set honestly  [ ] worker+progress+cancel  [ ] exports work  [ ] figure export PNG/SVG  [ ] no console errors  [ ] fits viewport  [ ] changelog entries  [ ] pushed`
