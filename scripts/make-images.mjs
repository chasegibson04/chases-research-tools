#!/usr/bin/env node
// Renders site/public/og-default.png (1200x630) and, if missing, a placeholder site/public/cv/headshot.jpg (600x600)
// using Playwright's bundled Chromium (already a devDependency; run `npx playwright install chromium` in site/ first).
// Usage: npm run images   |  node scripts/make-images.mjs --force   (re-render headshot placeholder too)
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'site');
const require = createRequire(join(site, 'package.json'));
const { chromium } = require('@playwright/test');
const force = process.argv.includes('--force');

const siteTs = readFileSync(join(site, 'src/config/site.ts'), 'utf8');
const name = /name:\s*"([^"]+)"/.exec(siteTs)?.[1] ?? "Chase's Research Tools";
const tagline = /tagline:\s*'([^']+)'/.exec(siteTs)?.[1] ?? '';
const theme = /theme:\s*'(\w+)'/.exec(siteTs)?.[1] ?? 'graphite';
const css = ['tokens.css', `themes/${theme}.css`].map((f) => readFileSync(join(site, 'src/styles', f), 'utf8')).join('\n');

const og = `<!doctype html><html data-theme="${theme}"><head><style>${css}
html,body{margin:0}body{width:1200px;height:630px;background:var(--bg);color:var(--fg);font-family:var(--font-sans);display:flex;flex-direction:column;justify-content:space-between;padding:72px;box-sizing:border-box;background-image:radial-gradient(var(--grid-dot) 1.5px,transparent 1.5px);background-size:28px 28px}
.brand{display:flex;align-items:center;gap:18px;font-size:34px;font-weight:700}.brand svg{width:56px;height:56px}
h1{font-size:64px;line-height:1.1;margin:0;max-width:18ch;letter-spacing:-.02em}p{font-size:28px;color:var(--fg-muted);margin:18px 0 0;max-width:40ch}
.bar{height:6px;width:180px;background:var(--accent);border-radius:3px}</style></head><body>
<div class="brand"><svg viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="var(--accent)" opacity=".15"/><path d="M18 44 L30 20 L38 36 L46 28" fill="none" stroke="var(--accent)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>${name}</div>
<div><h1>Research tools that run in your browser.</h1><p>${tagline}</p></div><div class="bar"></div></body></html>`;

const initials = name.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).slice(0, 2).join('') || 'CG';
const headshot = `<!doctype html><html data-theme="${theme}"><head><style>${css}
html,body{margin:0}body{width:600px;height:600px;display:grid;place-items:center;background:var(--bg-elev);font-family:var(--font-sans)}
.c{width:600px;height:600px;border-radius:0;background:linear-gradient(160deg,var(--bg-panel),var(--bg-sunken));display:grid;place-items:center;color:var(--accent);font-size:220px;font-weight:700;letter-spacing:-.04em}</style></head><body><div class="c">${initials}</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(og);
await page.screenshot({ path: join(site, 'public/og-default.png'), type: 'png' });
console.log('wrote site/public/og-default.png');
const hs = join(site, 'public/cv/headshot.jpg');
if (force || !existsSync(hs)) {
  await page.setViewportSize({ width: 600, height: 600 });
  await page.setContent(headshot);
  await page.screenshot({ path: hs, type: 'jpeg', quality: 82 });
  console.log('wrote placeholder site/public/cv/headshot.jpg (replace with the real photo)');
}
await browser.close();
