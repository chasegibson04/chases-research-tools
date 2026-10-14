#!/usr/bin/env node
// Export one tool as a standalone, runnable project: the tool folder, exactly the shared files its import graph
// reaches (site/src/lib/ms, components/tool, …), its public assets, and a minimal Vite + Preact host page.
// Usage: npm run export-tool -- <tool-id> [outDir]      (default outDir: ./exports/<tool-id>)
// Then: cd <outDir> && npm install && npm run dev
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolGraph } from './lib/tool-graph.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'site');
const [id, outArg] = process.argv.slice(2).filter((a) => a !== '--');
if (!id || !existsSync(join(site, 'tools', id, 'tool.json'))) { console.error('usage: export-tool <tool-id> [outDir]'); process.exit(2); }
const out = outArg ?? join(root, 'exports', id);
const manifest = JSON.parse(readFileSync(join(site, 'tools', id, 'tool.json'), 'utf8'));

// The host page needs ToolHost (which pulls in the worker host) and the design tokens.
const HOST_ROOTS = ['src/components/tool/ToolHost.tsx', 'src/styles/global.css'];
const g = toolGraph(site, id, HOST_ROOTS);
if (g.violations.length) { console.error(`Cannot export ${id}; it breaks the import rules:\n  ${g.violations.join('\n  ')}`); process.exit(1); }

if (existsSync(out)) rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(site, 'tools', id), join(out, 'tools', id), { recursive: true, filter: (p) => !/[\\/](node_modules|target)([\\/]|$)/.test(p) });
for (const f of g.shared) { mkdirSync(dirname(join(out, f)), { recursive: true }); cpSync(join(site, f), join(out, f)); }
cpSync(join(site, 'tools', 'tool.schema.json'), join(out, 'tools', 'tool.schema.json'));
const pub = join(site, 'public', 'tools', id);
if (existsSync(pub)) cpSync(pub, join(out, 'public', 'tools', id), { recursive: true });

const sitePkg = JSON.parse(readFileSync(join(site, 'package.json'), 'utf8'));
const ver = (p) => sitePkg.dependencies?.[p] ?? sitePkg.devDependencies?.[p] ?? 'latest';
const runtimeDeps = g.packages.filter((p) => !['vitest', 'preact'].includes(p));
const pkg = {
  name: id, private: true, type: 'module',
  description: `${manifest.name} — standalone copy of ${manifest.id} from Chase's Research Tools (${manifest.license}).`,
  scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview', test: 'vitest run' },
  dependencies: Object.fromEntries(['preact', ...runtimeDeps].map((p) => [p, ver(p)])),
  devDependencies: { vite: '^8.3.4', '@preact/preset-vite': '^2.10.6', vitest: ver('vitest'), typescript: ver('typescript'),
    ...(sitePkg.devDependencies?.['@types/sql.js'] && runtimeDeps.includes('sql.js') ? { '@types/sql.js': sitePkg.devDependencies['@types/sql.js'] } : {}) },
};
writeFileSync(join(out, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
writeFileSync(join(out, 'vite.config.ts'), `import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  plugins: [preact()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)), '@tools': fileURLToPath(new URL('./tools', import.meta.url)) } },
  worker: { format: 'es' },
});
`);
writeFileSync(join(out, 'vitest.config.ts'), `import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)), '@tools': fileURLToPath(new URL('./tools', import.meta.url)) } },
  test: { include: ['tools/**/tests/**/*.test.ts'], environment: 'node' },
});
`);
writeFileSync(join(out, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', jsxImportSource: 'preact', strict: true, skipLibCheck: true, resolveJsonModule: true, baseUrl: '.', paths: { '@/*': ['src/*'], '@tools/*': ['tools/*'] }, types: ['vite/client'] }, include: ['src', 'tools', 'main.tsx'] }, null, 2) + '\n');
writeFileSync(join(out, 'index.html'), `<!doctype html>
<html lang="en" data-theme="michigan">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${manifest.name}</title></head>
<body><main class="container-wide" style="padding:1rem 0"><h1 style="margin:0 0 .25rem">${manifest.name}</h1><p class="muted" style="margin:0 0 1rem">${manifest.tagline}</p><div id="app"></div></main>
<script type="module" src="/main.tsx"></script></body></html>
`);
writeFileSync(join(out, 'main.tsx'), `import { render } from 'preact';
import ToolHost from './src/components/tool/ToolHost';
import manifest from './tools/${id}/tool.json';
import './src/styles/global.css';

render(<ToolHost manifest={manifest as any} />, document.getElementById('app')!);
`);
writeFileSync(join(out, 'README.md'), `# ${manifest.name} (standalone)

${manifest.description}

Exported from [Chase's Research Tools](https://chases-research-tools.chase-gibson04.workers.dev/tools/${id}/) — ${manifest.license} licence; please cite it (\`tools/${id}/CITATION.cff\`).

\`\`\`
npm install
npm run dev      # http://localhost:5173
npm test         # the tool's unit tests
npm run build    # static files in dist/
\`\`\`

Layout: \`tools/${id}/\` is the tool (compute in \`src/compute.ts\`, UI in \`src/index.tsx\`, docs in \`README.md\`);
\`src/\` holds only the shared code it imports (${g.shared.length} files). Everything runs in the browser.
`);
console.log(`Exported ${id} → ${out}\n  ${g.shared.length} shared files, packages: ${['preact', ...runtimeDeps].join(', ')}`);
