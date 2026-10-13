import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@tools': fileURLToPath(new URL('./tools', import.meta.url)),
    },
  },
  test: {
    include: ['tools/**/tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['**/e2e/**', '**/*.spec.ts'],
    environment: 'node',
  },
});
