# Design system

Goal: a sleek, fast, scientific instrument feel that reads as hand-built. Everything below is implemented in `site/src/styles/`.

## Tokens (`tokens.css`)
Type scale, spacing, radii, shadows, motion, max widths, viz palette. Themes override colour tokens only.

## Themes (`themes/*.css`) — preview at `/design/themes/`
**Active theme: michigan** (owner's choice 2026-10-14; paper was used 2026-10-13). All five themes ship in `global.css` and can be previewed at `/design/themes/`.
- **graphite**: dark instrument panel, teal accent, warm grey text. Best for long analysis sessions; dark figures on screen export to white.
- **paper**: warm off-white journal page, ink text, oxblood accent. Prints beautifully; reads "academic".
- **spectra**: cool light slate with indigo accent and a faint spectral line under the header. Reads "clean lab".
Two school themes: **michigan** (Blue #00274C + Maize #FFCB05, dark; overrides the ion and viz colours for contrast on navy) and **wisconsin** (Badger Red #C5050C on white).
Set `theme` in `src/config/site.ts`. A user-facing light/dark toggle is a planned addition (respect `prefers-color-scheme`; persist in `localStorage`).

## Rules that keep it from looking generated
1. No gradient text, no glassmorphism, no glowing borders, no giant rounded hero cards, no emoji in UI chrome, no "✨", no "AI-powered".
2. One accent colour per theme, used sparingly (primary button, active nav, focus ring, timeline dots).
3. Headlines are short, factual, sentence case. Copy is written like a methods section, not a landing page ("Monoisotopic mass, m/z for any charge state", not "Unlock insights").
4. Density: tools are instruments. Compact spacing in the tool frame, generous spacing in prose.
5. Texture is limited to the subtle dot grid (`.bg-grid`) and hairline borders.
6. Fonts: **Source Sans 3** (text) + **JetBrains Mono** (numbers/code), self-hosted via `@fontsource-variable/*` packages imported in `src/layouts/Base.astro`. Vite bundles the woff2 files into `/_astro/` (hashed, cached for a year); `unicode-range` means visitors only download the latin subsets (~ 70 KB total: 29 KB Source Sans 3 + 40 KB JetBrains Mono). System fonts are the fallback in `--font-sans` / `--font-mono`. Never load fonts from Google's CDN at runtime.
7. Motion: 140 ms ease on hover/focus only. No scroll animations, no parallax.
8. Icons: inline SVG, 1.5 px stroke, only where they carry meaning (help, export, external link).

## Layout contract for tool pages
Header 52 px → breadcrumb + H1 + tagline (≤ 90 px) → `.tool-frame` sized to `calc(100vh - header - 120px)` so the entire tool is visible on arrival → ad slot (fixed height) → two columns: documentation (left) and citation/metadata (right) → related tools → footer with donate button. On mobile the input column stacks above results.

## Accessibility
Focus rings on everything, `aria-live` results region, help tooltips focusable, contrast ≥ 4.5:1 for text in all five themes (graphite, paper, spectra, michigan, wisconsin) (checked by eye now; axe automation planned), reduced-motion safe.

## Adding a component
Put it in `src/components/` (Astro, static) or `src/components/tool/` (Preact, interactive). Use tokens only. Document it in this file if tools are expected to use it.
