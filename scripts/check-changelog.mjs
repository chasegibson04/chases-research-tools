#!/usr/bin/env node
// Enforces that CHANGELOG.agent.log is append-only and well-formed.
// Compares against BASE_REF (default: origin/main, falling back to HEAD) using git. Cross-platform.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const FILE = 'CHANGELOG.agent.log';
const ENTRY = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})? [A-Za-z0-9+\-:]+\] \[[^\]]+\] \[[^\]]+\] .+/;
const current = readFileSync(FILE, 'utf8');

let base = '';
const ref = process.env.BASE_REF && !/^0+$/.test(process.env.BASE_REF) ? process.env.BASE_REF : 'origin/main';
for (const r of [ref, 'HEAD']) {
  try { base = execSync(`git show ${r}:${FILE}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); break; } catch { /* try next */ }
}
if (base && !current.startsWith(base)) {
  console.error(`ERROR: ${FILE} is append-only. Existing content was modified or removed. Restore the old content and append your entry at the end.`);
  process.exit(1);
}
const added = current.slice(base.length).split(/\r?\n/).filter((l) => l.trim());
const bad = added.filter((l) => !l.startsWith('    ') && !ENTRY.test(l));
if (bad.length) {
  console.error('ERROR: malformed changelog lines (expected "[YYYY-MM-DD HH:MM TZ] [agent] [scope] message", continuation lines indented 4 spaces):');
  for (const b of bad) console.error('  ' + b);
  process.exit(1);
}
console.log(`OK: ${FILE} append-only, ${added.length} new line(s).`);
