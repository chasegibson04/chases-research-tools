// OPTIONAL tool-specific e2e. The generic protocol in site/tests/e2e/tools.spec.ts already covers load, help tooltips,
// every example, and golden outputs. Add flows here that the generic test cannot know about (uploads, toggles, exports).
// Playwright only discovers files under site/tests/e2e by default; to enable this file, add its path to
// playwright.config.ts `testDir`/`testMatch` or move it to site/tests/e2e/<slug>.spec.ts.
import { test, expect } from '@playwright/test';

test.skip('__SLUG__: figure PNG export triggers a download', async ({ page }) => {
  await page.goto('/tools/__SLUG__/');
  await page.locator('#example-select').selectOption({ index: 1 });
  await page.locator('[data-action="run"]').click();
  await expect(page.locator('.ts-status[data-state="done"]')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PNG' }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
});
