# Deployment (Cloudflare Workers static assets)

## One-time setup
1. **GitHub**: create the public repo `chases-research-tools` under the owner's account; push `main`.
   ```bash
   gh repo create chases-research-tools --public --source=. --remote=origin --push
   ```
2. **Cloudflare**: dashboard → Workers & Pages → Create → **Import a repository** → pick the repo.
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   - Root directory: `/` (wrangler.jsonc is at the repo root and points at `site/dist`)
   - Production branch: `main`. Non-production branches get preview URLs: the **Previews** tab uses build command `npm run build` and preview command `npx wrangler preview` (beta), which requires the `"previews": {}` block in `wrangler.jsonc` (present).
   - Node version: the build image reads `.nvmrc` at the repo root (24), so no `NODE_VERSION` build variable is set or needed. With no root lockfile Cloudflare installs root deps (wrangler) with bun; that is harmless.
3. First deploy gives `https://chases-research-tools.<account>.workers.dev` (live: https://chases-research-tools.chase-gibson04.workers.dev, since 2026-10-13). Update `site/src/config/site.meta.json → url` and `site/public/robots.txt`, redeploy.
4. **Domain** (optional but recommended for AdSense and citations): buy on Cloudflare Registrar (~$10/yr, at-cost), then Worker → Settings → Domains & Routes → add custom domain. Update `site.meta.json`, `robots.txt`, `CITATION.cff`, all `CHANGEME` URLs. Name ideas: `chasesresearchtools.com`, `crt.science`, `gibson.tools`.
5. Enable **Web Analytics** (Cloudflare, cookie-free) on the domain for privacy-friendly pageview counts.

## Every push to `main`
CI (GitHub Actions) validates and tests; Cloudflare Workers Builds builds and deploys independently. If CI fails after a deploy, fix forward quickly or `git revert`. (Planned: make Cloudflare wait on CI via a deploy-from-Actions workflow using `cloudflare/wrangler-action` with an API token secret.)

## Local
```bash
npm run build
```
```bash
npx wrangler dev
```
(serves `site/dist` with the Workers runtime locally).

## Headers, redirects, caching
`site/public/_headers` and (if created) `site/public/_redirects` are honoured by Workers static assets. Hashed assets under `/_astro/` are immutable for a year; HTML is revalidated. Purge isn't needed.

## Secrets
None required. If a Worker script is ever added (contact form), store tokens as Worker secrets (`wrangler secret put`), never in the repo.

## Moving the repo between machines
Done 2026-10-13: the repo moved from Box to `D:\ResearchShare\RToolsSite` on Windows. Box Drive had skipped dotfiles and git objects, which had to be restored, so future moves go through GitHub (`git clone`), never a synced folder. On a new machine: `git clone`, Node 24+ (`.nvmrc`), `npm --prefix site install`, `npm run dev`; do not copy `node_modules` or `.astro/`; set `git config core.autocrlf false` on Windows (`.gitattributes` forces LF).
