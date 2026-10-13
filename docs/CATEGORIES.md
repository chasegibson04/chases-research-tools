# Categories

Source of truth: `site/src/data/categories.json`. Every tool declares exactly one `category` and one or more `subcategories` belonging to it. IDs are URL slugs (`/categories/<category>/<subcategory>/`) and must never change once published.

## Current registry

- **mass-spectrometry** — peptidomics, proteomics, metabolomics, lipidomics, instrumentation
- **chemistry** — solutions, formula-tools, chromatography
- **biology** — sequence-analysis, molecular-biology, cell-culture
- **statistics** — hypothesis-testing, curve-fitting, data-utilities
- **visualization** — plot-builders, color-and-style
- **software** — desktop-apps, packages, pipelines (used by showcase projects)

## Rules

1. Prefer an existing subcategory. Add one only if ≥2 tools would plausibly use it.
2. Adding: edit `categories.json` (id kebab-case, name, one-sentence description), add it to the list above, log it in the changelog. The directory, footer, sitemap, and category pages update automatically.
3. Renaming display `name`/`description` is fine; renaming an `id` is a breaking URL change and requires a redirect entry in `site/public/_redirects` (create the file if absent; format `/old/path/ /new/path/ 301`).
4. A tool can belong to multiple subcategories but only one category. If it truly straddles two categories, choose the one its primary users would browse, and add the other's subcategory names as `tags` so related-tool scoring still links them.
5. Example mapping: cyclic-peptide fragmentation predictor → `mass-spectrometry` / `["peptidomics"]`; a buffer calculator → `chemistry` / `["solutions"]`; a volcano-plot builder → `visualization` / `["plot-builders"]` with tags `proteomics, statistics`.
