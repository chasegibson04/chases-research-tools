# CV page guide

The CV lives at `/cv/` and is deliberately isolated from the tool system:
- Content: `site/src/data/cv.json`
- Page: `site/src/pages/cv.astro`
- Styles: `site/src/styles/cv.css` (own tokens under `.cv`, print stylesheet included)
- Headshot: `site/public/cv/headshot.jpg` (square, ≥ 600 px; served at 140 px; keep ≤ 150 KB)
No ads render on this page. It uses the site header/footer so navigation stays consistent.

## Updating from a .docx
When the owner provides a CV document:
1. Extract text (`pandoc cv.docx -t markdown` or the docx skill). Do not paste it verbatim; map it into the JSON sections below.
2. Keep the owner's wording for titles and bullets; fix only obvious typos; never invent items.
3. Dates as "2023 – present" (en dash). Publications: authors string, title, venue, year, DOI.
4. Replace the headshot if a new one is provided (crop square, export JPEG q80).
5. Build, open `/cv/`, check at desktop and mobile widths and in print preview (Ctrl/Cmd+P → the print CSS hides chrome).
6. Log the update in `CHANGELOG.agent.log` with scope `cv`. Do not touch anything outside the four files above.

## Data model (`cv.json`)
`name`, `role`, `summary`, `headshot`, `links[{label, href}]`, `sections[]` where each section is `{ id, title, type, items[] }` and `type` is:
- `timeline` → items `{ title, org, dates, bullets[] }` (education, positions, awards)
- `publications` → items `{ authors, title, venue, year, doi }`
- `list` → items `{ title, bullets[] }` (skills, teaching, service)
Add a new section type only by extending `cv.astro`'s rendering switch and documenting it here.

## Interactive ideas (planned, keep optional and light)
Filter publications by year/type, expandable abstracts, an "export as PDF" that is just `window.print()` (already present), a small timeline visual. Nothing that needs a framework; progressively enhanced only.
