# AGENTS.md — rules for every agent working in this repository

This file is read by Claude Code, Codex, Cursor, and humans. `CLAUDE.md` simply points here. These rules are not optional.

## 0. Identity and intent

- Project: **Chase's Research Tools** — a static site (Astro, Cloudflare Workers static assets) hosting browser-only scientific tools. Owner: Chase Gibson.
- Primary goals, in order: (1) tools work correctly and are tested, (2) tool pages are fast and discoverable by search engines and AI assistants, (3) nothing computes on the server, (4) the design never looks machine-generated.
- Docs index: `docs/README.md`. Read the doc for your task before touching code.

## 1. The changelog is mandatory and append-only

- File: `CHANGELOG.agent.log` at the repo root.
- **Before** starting work, read the last ~30 lines to see the format and recent context.
- **As you work** (not only at the end), append entries. Minimum: one at start ("starting: …"), one per meaningful milestone, one at finish ("done: … / not done: …").
- Append with the helper so timestamps are correct: `npm run log -- "<scope>" "<message>"` (set `AGENT_NAME` env var to your model name, e.g. `claude-opus-5-5`, or pass it inline on Windows PowerShell: `$env:AGENT_NAME="claude-opus-5-5"; npm run log -- "tools/x" "…"`). If the helper cannot run, append by hand in the exact format shown in the file.
- **Never** edit, reorder, or delete existing lines. CI (`scripts/check-changelog.mjs`) fails the build if any prior content changes.
- Format: `[YYYY-MM-DD HH:MM UTC±hh:mm] [agent] [scope] message`. Continuation lines are indented four spaces. Scope examples: `site`, `docs`, `tools/<slug>`, `cv`, `deploy`, `monetization`.

## 2. Non-negotiable technical rules

1. **All compute is client-side.** No Worker scripts, Functions, or APIs that process user data. The only server is a static file host. (`docs/ARCHITECTURE.md`, `docs/RUNTIMES.md`)
2. **Every tool conforms to the manifest schema** (`site/tools/tool.schema.json`). `npm run validate` must pass. No ad-hoc tool pages.
3. **Every input has `help` text** (rendered as the (?) tooltip). Every tool has ≥1 example with golden `expected` values, unit tests, and passes the generic e2e protocol. (`docs/TESTING_PROTOCOL.md`)
4. **Compute runs in the Web Worker** via `src/compute.ts`; UI in `src/index.tsx` uses the shared components in `site/src/components/tool/`. Do not fork or copy shared components into a tool folder; improve the shared one instead.
5. **Respect limits**: set honest `compute.maxRuntimeSeconds / maxMemoryMB / maxInputSizeMB` in the manifest. Long tasks must report progress via `ctx.progress`.
6. **Categories**: a tool must use an existing `category` and ≥1 `subcategories` from `site/src/data/categories.json`. Adding a category is allowed; document it in `docs/CATEGORIES.md`.
7. **Never commit secrets.** There are none needed for the site. Ad client IDs are public. `.env*` is git-ignored.
8. **Cross-platform**: scripts are Node (`.mjs`), no bash-only steps, no symlinks, LF line endings (`.gitattributes`). The repo lives on Windows and macOS.
9. **Design**: follow `docs/DESIGN_SYSTEM.md`. No new colors outside tokens, no emoji in UI chrome, no gradient text, no "✨ AI-powered" copy. Tool page must show the whole tool above the fold at 1366×768 unless `layout.aspect` says otherwise.
10. **CV page** (`site/src/pages/cv.astro`, `site/src/data/cv.json`, `site/src/styles/cv.css`) is isolated. Do not touch it during tool work; follow `docs/CV_PAGE_GUIDE.md` when asked to update it.
11. **Ads** never render inside `.tool-frame`, never on the CV/contact/privacy/terms pages, and never shift layout (fixed-height slots). (`docs/MONETIZATION.md`)
12. **Citations**: every tool has `CITATION.cff` and a manifest `citation` block; the page renders the citation box automatically. Bump `version` and `maintenance.updated` on any behavioral change, and add a line to the tool's `CHANGELOG.md`.

## 3. Standard workflow for an import ("import X from /path")

Follow `docs/TOOL_IMPORT_GUIDE.md` exactly. Summary: read source → log start → `npm run new-tool -- <slug> "<Name>"` → port compute into `src/compute.ts` (JS/TS preferred; Python→Pyodide, R→webR, C++/Rust→WASM per `docs/RUNTIMES.md`) → build UI with shared components → write README sections, examples with golden values, unit tests → `npm run validate && npm run test && npm run check && npm run build && npm --prefix site run test:e2e` → log → commit on a branch → push → open PR (or push to `main` if the owner said "push when ready"). Deployment is automatic from `main`.

## 4. Git conventions

- Branch per tool: `tool/<slug>`; docs: `docs/<topic>`; site changes: `site/<topic>`.
- Conventional commit messages: `feat(tools): add peptide-mass-calculator`, `fix(site): …`, `docs: …`, `chore: …`.
- Pushing to `main` deploys to production. Only do that when the owner explicitly asked ("push when ready") and the full test protocol passed.
- Commit messages end with the attribution line the harness gives you, if any.

## 5. What to do when unsure

Prefer the existing pattern in `site/tools/peptide-mass-calculator/`. If a decision is architectural (new runtime, new dependency over 50 KB gzipped, schema change), record it in `docs/DECISIONS.md` as a new ADR and mention it in the changelog. Ask the owner only for things that cannot be derived from the docs (e.g., category choice for an ambiguous tool, whether to publish as `beta` vs `stable`).
