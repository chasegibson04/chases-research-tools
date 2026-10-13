# Testing protocol

A tool is publishable only when every layer below is green. CI runs all of them on every push and PR.

## Layer 1 — Static validation (`npm run validate`)
JSON Schema conformance; folder/id match; category/subcategory exist; related ids exist; README has the five sections; CITATION.cff and CHANGELOG.md exist; examples exist with `input` (+ warning if no `expected`); every interactive tool has `src/index.tsx`, `src/compute.ts`, and ≥1 `tests/*.test.ts`; every `help` ≥ 15 chars; showcase figures exist; site config consistency.

## Layer 2 — Types (`npm run check`)
`astro check` (TypeScript strict). Tool code must typecheck; `any` is allowed only at JSON boundaries.

## Layer 3 — Unit tests (`npm run test`, Vitest)
Per tool, in `tests/*.test.ts`:
1. **Golden examples**: run `compute` on each `examples/*.json` input and assert `expected` values (numeric tolerance appropriate to the science; state it).
2. **Validation**: empty, malformed, out-of-range inputs throw readable errors.
3. **Invariants**: at least one property (e.g., normalisation, monotonicity, symmetry, conservation).
4. **Cancel**: for long-running tools, assert that an aborted signal stops the loop promptly.

## Layer 4 — Build (`npm run build`)
Astro build must succeed; validator runs first. Check the build output for the tool chunk size; if a tool adds > 300 KB gzipped (excluding language runtimes), note it in `runtime.bundleSizeKB` and justify in the changelog.

## Layer 5 — End-to-end (`npm --prefix site run test:e2e`, Playwright)
`site/tests/e2e/tools.spec.ts` runs automatically for **every** tool:
- page loads, H1 contains name, citation box visible, JSON-LD present, **zero console errors or page errors**;
- a `(?)` help element exists for every non-advanced input;
- each example loads via the dropdown, Run completes with `data-state="done"` within 3× `expectedRuntimeSeconds` + 15 s;
- every `expected` key with a matching `[data-output]` element matches (0.1 % + 0.0005 tolerance for numbers).
Add `tools/<slug>/tests/e2e.spec.ts` for tool-specific flows (uploads, toggles, figure export click produces a download).

## Layer 6 — Manual pass (required before `stable`)
At 1366×768 and 390×844: whole tool visible without page scroll (or intended `aspect`), tooltips readable, figure zoom/pan/hover work, PNG and SVG export open correctly in an image viewer and Illustrator/Inkscape, CSV opens in Excel with correct columns, keyboard-only operation possible, no text overflow, both light and dark themes look right (`/design/themes/`).

## Layer 7 — Performance & accessibility (planned automation; manual until then)
Lighthouse on the tool page: Performance ≥ 90, Accessibility ≥ 95, SEO = 100, Best Practices ≥ 95. Axe: no serious/critical issues. Planned: Lighthouse CI + axe in GitHub Actions (ROADMAP).

## Python / R / WASM specifics
Unit tests cannot execute Pyodide/webR in Node; cover numerical correctness with e2e golden examples (the runtime downloads in Chromium during the test; allow `expectedRuntimeSeconds` ≥ 30 for the first example). Keep a tiny JS fallback or input validation unit-tested.

## Regression rule
Changing any result changes `expected` values: that is a `major` version bump, a `CHANGELOG.md` line explaining why, and a changelog entry. Never silently edit golden values to make tests pass.
