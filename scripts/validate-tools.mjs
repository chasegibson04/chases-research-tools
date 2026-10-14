#!/usr/bin/env node
// Validates every site/tools/<id>/ folder against tool.schema.json plus structural rules. Cross-platform (Node only).
// Exit code 1 on any error. Run: npm run validate   (also runs before every build)
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { toolGraph } from './lib/tool-graph.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'site');
const require = createRequire(join(site, 'package.json'));
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const schema = JSON.parse(readFileSync(join(site, 'tools', 'tool.schema.json'), 'utf8'));
const categories = JSON.parse(readFileSync(join(site, 'src', 'data', 'categories.json'), 'utf8')).categories;
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

const toolsDir = join(site, 'tools');
const ids = readdirSync(toolsDir).filter((d) => !d.startsWith('_') && statSync(join(toolsDir, d)).isDirectory());
const errors = [];
const warn = [];
const REQUIRED_README_SECTIONS = ['## Overview', '## How to use', '## Method', '## Limitations', '## References'];

for (const id of ids) {
  const dir = join(toolsDir, id);
  const e = (m) => errors.push(`[${id}] ${m}`);
  const manifestPath = join(dir, 'tool.json');
  if (!existsSync(manifestPath)) { e('missing tool.json'); continue; }
  let m;
  try { m = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch (err) { e(`tool.json is not valid JSON: ${err.message}`); continue; }
  if (!validate(m)) for (const er of validate.errors) e(`schema: ${er.instancePath || '/'} ${er.message}`);
  if (m.id !== id) e(`id "${m.id}" must equal folder name "${id}"`);
  const cat = categories.find((c) => c.id === m.category);
  if (!cat) e(`unknown category "${m.category}" (add it to site/src/data/categories.json)`);
  else for (const s of m.subcategories ?? []) if (!cat.subcategories.some((x) => x.id === s)) e(`subcategory "${s}" not in category "${m.category}"`);
  for (const r of m.related ?? []) if (!ids.includes(r)) e(`related tool "${r}" does not exist`);
  for (const f of ['README.md', 'CITATION.cff', 'CHANGELOG.md']) if (!existsSync(join(dir, f))) e(`missing ${f}`);
  if (existsSync(join(dir, 'README.md'))) {
    const readme = readFileSync(join(dir, 'README.md'), 'utf8');
    for (const s of REQUIRED_README_SECTIONS) if (!readme.includes(s)) e(`README.md missing section "${s}"`);
  }
  for (const ex of m.examples ?? []) {
    const p = join(dir, 'examples', ex.file);
    if (!existsSync(p)) { e(`example file missing: examples/${ex.file}`); continue; }
    try { const j = JSON.parse(readFileSync(p, 'utf8')); if (!j.input) e(`examples/${ex.file} has no "input"`); if (!j.expected) warn.push(`[${id}] examples/${ex.file} has no "expected" golden values`); if (j.label !== ex.label) e(`examples/${ex.file} label must match manifest label`); } catch (err) { e(`examples/${ex.file} invalid JSON`); }
  }
  if (m.kind === 'interactive') {
    for (const f of ['src/index.tsx', 'src/compute.ts']) if (!existsSync(join(dir, f))) e(`missing ${f}`);
    const tests = existsSync(join(dir, 'tests')) ? readdirSync(join(dir, 'tests')).filter((f) => f.endsWith('.test.ts')) : [];
    if (!tests.length) e('no unit tests in tests/*.test.ts');
    for (const i of m.inputs ?? []) if (i.help && i.help.length < 15) e(`input "${i.name}" help text too short`);
  } else if (m.kind === 'showcase') {
    for (const f of m.showcase?.figures ?? []) if (!existsSync(join(site, 'public', 'tools', id, f.src))) e(`showcase figure missing: site/public/tools/${id}/${f.src}`);
  }
  // Self-containment (AGENTS.md rule 4): a tool imports only its own folder, the shared tool/MS libraries and npm packages.
  if (m.kind === 'interactive') for (const v of toolGraph(site, id).violations) e(`imports: ${v}`);
  if (m.status === 'stable' && !(m.seo?.faq?.length)) warn.push(`[${id}] stable tool has no seo.faq entries`);
  if (/CHANGEME/.test(readFileSync(manifestPath, 'utf8'))) warn.push(`[${id}] tool.json still contains CHANGEME placeholders`);
}

// Site-level consistency
const siteTs = readFileSync(join(site, 'src', 'config', 'site.ts'), 'utf8');
const meta = JSON.parse(readFileSync(join(site, 'src', 'config', 'site.meta.json'), 'utf8'));
if (!siteTs.includes("from './site.meta.json'")) warn.push('site.ts should read url from site.meta.json');
const robots = readFileSync(join(site, 'public', 'robots.txt'), 'utf8');
if (!robots.includes(meta.url)) warn.push(`robots.txt sitemap URL does not match site.meta.json url (${meta.url})`);

for (const w of warn) console.warn('WARN ' + w);
if (errors.length) { for (const er of errors) console.error('ERROR ' + er); console.error(`\n${errors.length} error(s) in ${ids.length} tool(s).`); process.exit(1); }
console.log(`OK: ${ids.length} tool(s) valid${warn.length ? `, ${warn.length} warning(s)` : ''}.`);
