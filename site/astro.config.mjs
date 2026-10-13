// @ts-check
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import { fileURLToPath } from 'node:url';

// Site URL is read from src/config/site.ts at build time via a tiny JSON mirror
// to avoid importing TS here. Keep the two in sync (validated by scripts/validate-tools.mjs).
import siteMeta from './src/config/site.meta.json' with { type: 'json' };

export default defineConfig({
  site: siteMeta.url,
  output: 'static',
  trailingSlash: 'always',
  integrations: [preact(), sitemap({ filter: (p) => !p.includes('/design/') })],
  build: { inlineStylesheets: 'auto' },
  vite: {
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@tools': fileURLToPath(new URL('./tools', import.meta.url)),
      },
    },
    worker: { format: 'es' },
  },
});
