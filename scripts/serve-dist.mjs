#!/usr/bin/env node
// Minimal static server for site/dist used by Playwright and local checks. Zero dependencies, cross-platform.
// Usage: node scripts/serve-dist.mjs [port]   (mirrors Cloudflare's auto-trailing-slash + 404 page behaviour)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'site', 'dist');
const port = Number(process.argv[2] || 4321);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
async function resolve(pathname) {
  const p = decodeURIComponent(pathname.split('?')[0]);
  const candidates = p.endsWith('/') ? [join(root, p, 'index.html')] : [join(root, p), join(root, p, 'index.html')];
  for (const c of candidates) { try { if ((await stat(c)).isFile()) return c; } catch {} }
  return null;
}
createServer(async (req, res) => {
  const file = await resolve(req.url ?? '/');
  if (!file) { const nf = join(root, '404.html'); try { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(await readFile(nf)); } catch { res.writeHead(404); res.end('Not found'); } return; }
  res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
  res.end(await readFile(file));
}).listen(port, () => console.log(`serving site/dist at http://localhost:${port}`));
