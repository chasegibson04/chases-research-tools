# Admin: accounts, services, and where things live

| Thing | Where | Notes |
|---|---|---|
| Source of truth | GitHub repo `chases-research-tools` (public) | Deploys from `main` |
| Hosting | Cloudflare account → Workers & Pages → `chases-research-tools` | Free plan suffices |
| Domain/DNS | Cloudflare Registrar (when bought) | Update `site.meta.json`, `robots.txt`, `CITATION.cff` |
| Analytics | Cloudflare Web Analytics (cookie-free) | Optional: Plausible/Umami later |
| Search | Google Search Console, Bing Webmaster | Submit `sitemap-index.xml` |
| Ads | AdSense (publisher id in `monetization.ts`), EthicalAds alt | CMP via AdSense Privacy & messaging |
| Donations | Ko-fi, GitHub Sponsors | usernames in `monetization.ts` |
| DOIs | Zenodo ↔ GitHub releases | CITATIONS.md |
| CI | GitHub Actions (`.github/workflows/ci.yml`) | No secrets needed yet |
| Work log | `CHANGELOG.agent.log` | Append-only, CI-enforced |
| Decisions | `docs/DECISIONS.md` | ADRs |

## Routine maintenance
- Monthly: `npm --prefix site outdated`; bump Astro/Preact/Plotly minor versions; run the full test protocol.
- Quarterly: bump `PYODIDE_VERSION`/`WEBR_VERSION` deliberately; re-run e2e for Python/R tools.
- When a browser deprecates something (e.g., SharedArrayBuffer rules), check RUNTIMES.md assumptions.
- Keep `docs/` accurate: a doc that lies is worse than none.

## Owner-only actions (never automated)
Buying domains, creating accounts, applying for AdSense, accepting terms, publishing releases that mint DOIs, pushing to `main` unless explicitly requested.
