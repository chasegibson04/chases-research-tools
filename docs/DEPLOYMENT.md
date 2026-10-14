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
   - Node version: set `NODE_VERSION=24` in build variables.
   - Production branch: `main`. Non-production branches get preview URLs: the **Previews** tab uses build command `npm run build` and preview command `npx wrangler preview` (beta), which requires the `"previews": {}` block in `wrangler.jsonc` (present).
   - Node: the build image reads `.nvmrc` (24), so no `NODE_VERSION` variable is needed. With no root lockfile Cloudflare installs root deps (wrangler) with bun; that is harmless.
3. First deploy gives `https://chases-research-tools.<account>.workers.dev`. Update `site/src/config/site.meta.json → url` and `site/public/robots.txt`, redeploy.
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

## Moving the repo between machines (Box → Windows tonight)
1. Commit everything; push to GitHub. 2. On the new machine: `git clone`, `nvm use 24` (or install Node 24+), `npm --prefix site install`, `npm run dev`. 3. Do **not** copy `node_modules` or `.astro/` across machines. 4. Line endings are forced to LF by `.gitattributes`; set `git config core.autocrlf false` on Windows to avoid noise. 5. The Box copy can be deleted once the clone works.
