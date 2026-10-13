# scripts/

Node-only (`.mjs`), cross-platform, zero shell dependencies. Run from the repo root via the root `package.json` scripts.

| Script | Command | Purpose |
|---|---|---|
| validate-tools.mjs | `npm run validate` | JSON Schema + structural checks for every `site/tools/<id>/`; runs before every build |
| check-changelog.mjs | `npm run check:changelog` | Fails if CHANGELOG.agent.log lost content or has malformed entries (CI) |
| log.mjs | `npm run log -- "<scope>" "<msg>"` | Appends a timestamped changelog entry (`AGENT_NAME` env var labels the agent) |
| new-tool.mjs | `npm run new-tool -- <slug> "<Name>"` | Copies `site/tools/_template` → `site/tools/<slug>` with placeholders filled |
| serve-dist.mjs | `node scripts/serve-dist.mjs [port]` | Minimal static server for `site/dist` (Playwright webServer; local smoke tests) |
| make-images.mjs | `npm run images` | Renders `site/public/og-default.png` (1200×630) and a placeholder headshot with Playwright's Chromium |
