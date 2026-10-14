// Interaction tests: linking between structure, ladder table and spectrum.
import { test, expect } from '@playwright/test';

test.describe('peptide-fragment-ion-predictor interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tools/peptide-fragment-ion-predictor/');
    await page.locator('#example-select').selectOption({ label: 'Angiotensin II, HCD 2+ (linear)' });
    await page.locator('[data-action="run"]').click();
    await expect(page.locator('.ts-status[data-state="done"]')).toBeVisible({ timeout: 20_000 });
  });

  test('hovering a ladder-table cell shows the ion, its pair, and highlights the structure marker', async ({ page }) => {
    await page.locator('[data-output="b2"]').first().hover();
    const info = page.locator('.ms-info');
    await expect(info).toContainText('b₂');
    await expect(info).toContainText('pair:');
    await expect(info).toContainText('y₆');
    // b2 cleaves the amide after residue 2 → bond index 3*1+2 = 5, N-terminal side
    await expect.poll(() => page.locator('.pep-panel > style').evaluate((e) => e.textContent ?? '')).toContain('[data-bond="5"][data-side="n"]');
  });

  test('hovering a structure marker selects the matching ion', async ({ page }) => {
    await page.locator('.pep-wrap .mk[data-bond="5"][data-side="c"]').dispatchEvent('mouseover');
    await expect(page.locator('.ms-info')).toContainText('y₆');
  });

  test('a pasted peak list is matched and summarised', async ({ page }) => {
    await page.locator('#in-observed').fill('166.0864 100\n263.1392 60\n272.1355 40\n513.2800 30\n784.4099 25\n999.9 5');
    await page.locator('[data-action="run"]').click();
    await expect(page.locator('.ms-summary')).toContainText('Intensity', { timeout: 20_000 });
    await expect(page.locator('.spec').first()).toContainText('Observed (top) vs representative (bottom)');
  });

  test('switching to condensed mode keeps the markers', async ({ page }) => {
    await page.getByRole('button', { name: 'Condensed' }).click();
    await expect(page.locator('.pep-wrap[data-mode="condensed"] .mk').first()).toBeAttached();
  });
});
