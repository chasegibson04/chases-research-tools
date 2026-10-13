# Architecture Decision Records

Append new ADRs at the bottom. Never delete; supersede.

## ADR-001 · Static Astro site with Preact islands (2026-10-13)
**Context.** Need a very fast, SEO-first site where only tool panels are interactive.
**Decision.** Astro 7, `output: 'static'`, Preact for islands, plain CSS tokens.
**Alternatives.** Next.js (heavier, SSR not needed), SvelteKit (good, but React-style code is what LLM importers write most reliably), Hugo/Eleventy (no first-class islands), plain HTML (no content modelling).
**Consequences.** Tool UIs must be Preact components; everything else is HTML.

## ADR-002 · Cloudflare Workers static assets, Git-connected (2026-10-13)
**Context.** Free hosting, auto-deploy on push to `main`, custom headers, global CDN.
**Decision.** Deploy `site/dist` as Workers static assets via `wrangler.jsonc` at repo root; connect the GitHub repo through Workers Builds.
**Alternatives.** Cloudflare Pages (maintenance mode per Cloudflare's own guidance), GitHub Pages (no custom headers, no `_headers`, weaker caching control), Netlify/Vercel (fine, but bandwidth caps on free tiers), AWS S3+CloudFront (costs money, more setup).
**Consequences.** Preview deployments per PR are available via Workers Builds; `_headers`/`_redirects` supported in the assets dir.

## ADR-003 · All compute client-side, inside a Web Worker (2026-10-13)
**Decision.** No server compute, ever, by default. Each run spawns a fresh module worker that imports the tool's `compute.ts`; timeout, cancel, progress are standard. Python via Pyodide, R via webR, native via WASM, all inside the worker.
**Consequences.** Large runtimes (10–40 MB) download on first use; mitigated by CDN caching and `preflight()` warnings. Multithreading requires cross-origin isolation, which conflicts with ad scripts; default single-threaded (see RUNTIMES.md for opt-in).

## ADR-004 · Single public repo, no private mirror (2026-10-13)
**Decision.** One public repository is the deploy source. Secrets never exist in the repo. Rejected the "private main + public mirror" idea: doubles maintenance, risks divergence, and there is nothing to hide.

## ADR-005 · Manifest-driven tools validated by JSON Schema (2026-10-13)
**Decision.** `site/tools/tool.schema.json` (draft 2020-12) is the contract; `scripts/validate-tools.mjs` gates every build. The Astro zod schema is permissive on purpose. Fields are deliberately many; `null`/empty are allowed where not applicable.

## ADR-006 · Plotly.js basic bundle, lazy-loaded (2026-10-13)
**Decision.** Default figure library is Plotly (basic dist) through `FigurePanel`, loaded on first draw. Tools needing other chart types may import the full Plotly or another library inside their own chunk, documented in the manifest `runtime.bundleSizeKB`.
**Alternatives.** ECharts (comparable), Observable Plot/D3 (great SVG, more code per tool), uPlot (fast but minimal), Vega-Lite (declarative but large).

## ADR-007 · Append-only agent changelog enforced by CI (2026-10-13)
**Decision.** `CHANGELOG.agent.log` with strict line format; `check-changelog.mjs` verifies prior content is a byte-prefix of the new file.

## ADR-008 · Monetization as swappable components, AdSense + Ko-fi default (2026-10-13)
**Decision.** `AdSlot.astro` and `DonateButton.astro` read `src/config/monetization.ts`. Providers: AdSense or EthicalAds for ads; Ko-fi or GitHub Sponsors for donations. No auto-ads. Fixed-height slots. Google's certified CMP for consent.
