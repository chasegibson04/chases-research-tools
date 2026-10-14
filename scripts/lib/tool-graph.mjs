// Import graph of a tool folder: which shared site files (site/src/**) and npm packages it depends on, and
// which imports break the self-containment rule (AGENTS.md rule 4, ARCHITECTURE.md "unit of distribution").
// Used by validate-tools.mjs (enforcement) and export-tool.mjs (standalone download of one tool).
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';

/** Shared code a tool may import. Everything else under site/src is site chrome and off limits. */
export const ALLOWED_SHARED = [/^lib\/ms\//, /^lib\/runtime\//, /^lib\/types(\.ts)?$/, /^lib\/export(\.ts)?$/, /^components\/tool\//, /^components\/ms\//, /^styles\//];

const EXT = ['', '.ts', '.tsx', '.js', '.mjs', '.json', '/index.ts', '/index.tsx', '/index.js'];
const SPEC = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*(?:\/\*[^*]*\*\/\s*)?['"]([^'"]+)['"]\s*\)|new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url|import\.meta\.glob\(\s*['"]([^'"]+)['"]|@import\s+['"]([^'"]+)['"]/g;

function resolveFile(base) {
  const clean = base.replace(/\?.*$/, '');
  for (const e of EXT) { const p = clean + e; if (existsSync(p) && statSync(p).isFile()) return p; }
  return null;
}

/**
 * Walk every source file of tools/<id> (src, tests, scripts) and the shared files they reach.
 * Returns posix paths relative to site/.
 */
export function toolGraph(site, id, extraRoots = []) {
  const toolDir = join(site, 'tools', id);
  const files = new Set(), shared = new Set(), packages = new Set(), violations = [];
  const queue = [];
  const walkDir = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) { if (!['node_modules', 'target', 'vendor'].includes(e.name)) walkDir(p); } else if (/\.(ts|tsx|js|mjs|css)$/.test(e.name)) queue.push(p); } };
  walkDir(toolDir);
  for (const r of extraRoots) { queue.push(join(site, r)); shared.add(r); }
  const rel = (p) => relative(site, p).split(sep).join('/');
  while (queue.length) {
    const f = queue.pop();
    if (files.has(f)) continue;
    files.add(f);
    const inTool = f.startsWith(toolDir + sep);
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(SPEC)) {
      let spec = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5];
      if (m[3] && !/^[./@]/.test(spec)) spec = `./${spec}`; // new URL('x.wasm', import.meta.url) is file-relative
      if (!spec || spec.startsWith('node:') || /^(https?:|data:)/.test(spec)) continue;
      if (m[4]) continue; // import.meta.glob patterns are resolved by Vite (only used by the shared host)
      let target = null;
      if (spec.startsWith('@/')) target = resolveFile(join(site, 'src', spec.slice(2)));
      else if (spec.startsWith('.')) target = resolveFile(resolve(dirname(f), spec)) ?? (existsSync(resolve(dirname(f), spec.replace(/\?.*$/, ''))) ? resolve(dirname(f), spec.replace(/\?.*$/, '')) : null);
      else { packages.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]); continue; }
      if (!target) { if (!/\.(wasm|css)(\?|$)/.test(spec)) violations.push(`${rel(f)}: cannot resolve "${spec}"`); continue; }
      const t = rel(target);
      if (t.startsWith(`tools/${id}/`)) { if (!/\.(wasm|json)$/.test(t)) queue.push(target); continue; }
      if (t.startsWith('tools/')) { violations.push(`${rel(f)} imports another tool's file "${t}" (move shared code to site/src/lib)`); continue; }
      if (!t.startsWith('src/')) { violations.push(`${rel(f)} imports "${t}" outside the tool folder and site/src`); continue; }
      const s = t.slice(4);
      if (inTool && !ALLOWED_SHARED.some((r) => r.test(s))) violations.push(`${rel(f)} imports site code "src/${s}" that tools may not depend on (allowed: lib/ms, lib/runtime, lib/types, lib/export, components/tool, components/ms)`);
      shared.add(t);
      if (/\.(ts|tsx|js|mjs|css)$/.test(t)) queue.push(target);
    }
  }
  return { files: [...files].map(rel), shared: [...shared].sort(), packages: [...packages].sort(), violations };
}
