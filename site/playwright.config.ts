import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: 0,
  use: { baseURL: 'http://localhost:4321', trace: 'retain-on-failure' },
  webServer: { command: 'node ../scripts/serve-dist.mjs 4321', port: 4321, reuseExistingServer: true, timeout: 120_000 },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
