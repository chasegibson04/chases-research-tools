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
`name`, `role`, `location`, `summary`, `headshot`, `links[{label, href}]`, `sections[]` where each section is `{ id, title, type, items[] }` and `type` is:
- `timeline` → items `{ title, org?, location?, dates?, current?, tags?[], bullets?[] }` (education, positions, presentations, projects, awards). Items with `bullets` render as a `<details>` dropdown (the bullets are the expanded detail); items without bullets render as a plain row. `tags` (2–5 short labels taken from the item's own text) show on the collapsed row; `current: true` adds the accent dot and a "Now" label.
- `publications` → items `{ authors, title, venue, year, doi }`
- `list` → items `{ title, bullets[] }`, rendered as skill chips grouped by `title`. At build time each chip is matched (whole-word, case-insensitive) against every timeline entry; chips with matches become buttons that highlight and open those entries, and the rest render as plain dashed chips.
Add a new section type only by extending `cv.astro`'s rendering switch and documenting it here.

## Interactivity (implemented; progressive enhancement, no framework)
Dropdown per entry (native `<details>`), Expand all / Collapse all, sticky section nav, skill-chip highlighting (Esc clears), Print / PDF via `window.print()` with every entry expanded for print. Without JS everything still reads and opens.

## Privacy
The public page intentionally omits the phone number and personal email from the owner's .docx. Add an email link only once the owner picks a public alias.

## Ideas (not yet built)
Filter publications by year/type, expandable abstracts once publications exist, Google Scholar link once a profile exists.
