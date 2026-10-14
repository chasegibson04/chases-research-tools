// OPTIONAL tool-specific e2e. The generic protocol in site/tests/e2e/tools.spec.ts already covers load, help tooltips,
// every example, and golden outputs. Add flows here that the generic test cannot know about (uploads, toggles, exports).
// Playwright runs tools/<slug>/tests/*.spec.ts automatically (site/playwright.config.ts), so these tests travel with
// the tool, including in `npm run export-tool`.
import { test, expect } from '@playwright/test';

test.skip('__SLUG__: figure PNG export triggers a download', async ({ page }) => {
  await page.goto('/tools/__SLUG__/');
  await page.locator('#example-select').selectOption({ index: 1 });
  await page.locator('[data-action="run"]').click();
  await expect(page.locator('.ts-status[data-state="done"]')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PNG' }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
});
