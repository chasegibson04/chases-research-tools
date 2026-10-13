# Roadmap and launch checklist

## Now (scaffold complete, 2026-10-13)
- [x] Repo structure, docs, agent rules, append-only changelog with CI enforcement
- [x] Astro 7 + Preact site, three theme candidates, tool page/directory/category/CV/legal pages
- [x] Tool manifest schema + validator + template + `new-tool` scaffolder
- [x] Reference tool (peptide-mass-calculator) with worker compute, figure, exports, tests
- [x] Generic e2e protocol, GitHub Actions CI
- [x] Monetization components (AdSense/EthicalAds/Ko-fi/GitHub Sponsors) config-gated

## Next session (owner + Opus)
- [ ] Move repo out of Box; push to GitHub; connect Cloudflare Workers Builds (DEPLOYMENT.md)
- [ ] Pick a theme at `/design/themes/`; set `SITE.theme`; self-host fonts
- [ ] Fill `site.ts` (GitHub user, email alias, ORCID), replace every `CHANGEME`
- [ ] Provide CV .docx + headshot → CV_PAGE_GUIDE.md
- [ ] Import the first real tool (cyclic peptide fragmentation predictor) via TOOL_IMPORT_GUIDE.md
- [ ] Create `og-default.png` (1200×630)

## Soon
- [ ] Lighthouse CI + axe in GitHub Actions with budgets (TESTING_PROTOCOL layer 7)
- [ ] Light/dark toggle honoring `prefers-color-scheme`
- [ ] Build-time OG image per tool (satori or resvg)
- [ ] `FigurePanel` extras: log axes, palette picker, marker/line options, axis ranges
- [ ] `inputsPosition: top/right` layouts
- [ ] Screen Wake Lock for `longRunning` tools; persist last inputs in `localStorage` when `privacy.storesLocal`
- [ ] Client-side search on the directory page (Pagefind or a tiny JSON index)
- [ ] Contact form via a tiny Worker + Turnstile + Cloudflare Email Service (only server code allowed: it handles no scientific data)
- [ ] Deploy-from-Actions so Cloudflare waits for CI

## Later
- [ ] Zenodo DOI per stable tool; "Cite" count display
- [ ] Multi-language runtime caching strategy (service worker precache for Pyodide/webR after first use)
- [ ] Optional opt-in cross-origin-isolated pages for multithreaded WASM tools
- [ ] Tool usage analytics (cookie-free, aggregate: which tools get run)
- [ ] Contributor guide for external tool PRs; tool "request" issue template
