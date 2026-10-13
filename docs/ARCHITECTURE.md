# Architecture

## One-paragraph summary

A **static site** built with **Astro 7** and deployed to **Cloudflare Workers (static assets)** from the `main` branch via Cloudflare's Git integration. Pages ship zero JavaScript except on tool pages, where a single **Preact island** (`ToolHost`) lazy-loads that tool's UI chunk and runs its compute in a **Web Worker**. Tools written in Python or R execute in the same worker via **Pyodide** and **webR** (WebAssembly builds, downloaded from a CDN and cached by the browser). Nothing computes on the server; the server only serves files. Content (tool manifests, READMEs, categories) is read at build time through Astro content collections, so adding a tool folder is all it takes to get a page, directory entry, related-tool links, citation box, sitemap entry, `llms.txt` line, and structured data.

## Request flow

1. Visitor hits `/tools/<slug>/` → Cloudflare edge serves prebuilt HTML (cache hit, ~10–30 ms TTFB globally).
2. HTML contains the full page (title, docs, citation, JSON-LD) so search engines and AI crawlers see everything without JS.
3. Browser loads the tiny Preact runtime + `ToolHost` + the tool's own chunk (code-split per tool by Vite).
4. On **Run**, `ToolHost` spawns `tool.worker.ts`, which dynamically imports `tools/<slug>/src/compute.ts` and executes it with a timeout, progress channel, and cancel.
5. Results render through shared components; figures lazy-load Plotly only when first drawn; exports are generated client-side as Blobs.

## Why these choices (short form; ADRs in DECISIONS.md)

| Need | Choice | Why |
|---|---|---|
| "Rust-level fast" site | Astro 7 static output | Pure HTML/CSS by default; islands only where interactivity exists. Consistently top Lighthouse scores. |
| Interactive tool UIs | Preact | React API (LLMs write it reliably) at ~4 KB. Signals optional. |
| Hosting | Cloudflare Workers static assets | Free, unlimited static bandwidth, global edge, Git-connected builds, `_headers` support, same account as domain/DNS. Pages is in maintenance mode. |
| Python | Pyodide | Mature, numpy/scipy/pandas available as wheels, runs in a worker. |
| R | webR | Posit-maintained, CRAN-like package repo built for WASM. |
| C/C++/Rust | Emscripten / wasm-pack | Standard toolchains; artifacts committed to the tool folder. |
| Plots | Plotly.js (basic bundle, lazy) | Zoom/pan/hover out of the box, PNG+SVG export, broad chart coverage. Loaded only on demand. |
| Content modelling | Astro content collections over `tools/*/tool.json` + JSON Schema | Strict, machine-checkable manifests; the site "just accepts" conforming tools. |
| Styling | Plain CSS with design tokens | Smallest possible CSS, no framework look, theme switch is one attribute. |
| Tests | Vitest (unit, golden examples) + Playwright (generic e2e per tool) | Protocol runs automatically against every tool from its manifest. |

## Directory contract

- `site/tools/<slug>/` is the unit of distribution. It must be self-contained (its `src/compute.ts` imports only from its own folder or `@/lib/runtime/*`), so users can download just that folder.
- `site/src/` is the site framework. Tools consume it; they never modify it (open a PR against the shared component instead).
- `docs/` is the knowledge base. `CHANGELOG.agent.log` is the work log.

## Performance budget (enforced by review; Lighthouse CI planned)

- Non-tool page: ≤ 30 KB JS total (ideally 0), LCP < 1.0 s on fast 3G emulation.
- Tool page before Run: ≤ 60 KB JS gzipped (Preact + host + tool UI). Plotly (~350 KB gzipped) and language runtimes load only on first Run/first draw.
- No layout shift from ads (fixed-height slots) or from tool mount (frame has min-height).

## Security model

- No user data leaves the device. No cookies set by us. Ads/CMP are the only third parties and are config-gated.
- Headers in `site/public/_headers`. COOP/COEP are off by default so ad scripts work; multithreaded WASM is therefore off by default (see RUNTIMES.md for the opt-in path).
- Dependencies: pinned via `package-lock.json`; runtime CDNs (Pyodide, webR) pinned to exact versions in `site/src/lib/runtime/*.ts`.

## Public vs private

Single public repository. Nothing in it is secret: AdSense client IDs are public by nature; Cloudflare credentials live in the Cloudflare dashboard/CI secrets, never in the repo. A private "mirror" branch was considered and rejected (ADR-004) as unnecessary complexity.
