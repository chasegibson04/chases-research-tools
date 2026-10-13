#!/usr/bin/env node
// Scaffolds site/tools/<slug>/ from site/tools/_template. Usage: npm run new-tool -- <slug> "<Display Name>"
import { cpSync, readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
const [slug, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(' ');
if (!slug || !name || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) { console.error('Usage: npm run new-tool -- <kebab-slug> "<Display Name>"'); process.exit(1); }
const src = join('site', 'tools', '_template'), dst = join('site', 'tools', slug);
if (existsSync(dst)) { console.error(`${dst} already exists`); process.exit(1); }
cpSync(src, dst, { recursive: true });
const date = new Date().toISOString().slice(0, 10);
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
for (const f of walk(dst)) writeFileSync(f, readFileSync(f, 'utf8').replaceAll('__SLUG__', slug).replaceAll('__NAME__', name).replaceAll('__DATE__', date));
console.log(`Created ${dst}. Next: edit tool.json, README.md, src/compute.ts, src/index.tsx, examples/, tests/. See docs/TOOL_IMPORT_GUIDE.md`);
