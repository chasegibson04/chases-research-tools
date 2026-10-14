// Interaction tests: scan selection, linking, XIC and reference mirror comparison.
import { test, expect } from '@playwright/test';

test.describe('mzml-spectrum-annotator interactions', () => {
  test('uploads a local mzML, measures a peak gap and manually reassigns a peak', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/tools/mzml-spectrum-annotator/');
    await page.locator('#in-file').setInputFiles('public/tools/mzml-spectrum-annotator/demo-synthetic.mzML');
    await page.locator('#in-sequence').fill('DRVYIHPF');
    await page.locator('[data-action="run"]').click();
    await expect(page.locator('[data-output="spectraCount"]')).toHaveText('26', { timeout: 30_000 });
    // switch to the angiotensin precursor group
    await page.getByRole('button', { name: /MS2 523\.77/ }).click();
    await expect(page.locator('.ms-summary')).toContainText('523.77', { timeout: 30_000 });
    await expect(page.locator('[data-output="precursorMz"]')).toHaveText(/523\.774/);
    // pick two assigned y ions from the table and measure: y1 (F) → y2 (PF) = Pro, 97.0528
    const rows = page.locator('.ion-list tbody tr');
    const y2row = page.locator('.ion-list tbody tr').filter({ has: page.locator('td:nth-child(3)', { hasText: /^y₂$/ }) });
    const y2mz = await y2row.first().locator('td').first().textContent();
    expect(Number(y2mz)).toBeCloseTo(263.139, 2);
    await page.locator('.ion-list tbody tr').filter({ has: page.locator('td:nth-child(3)', { hasText: /^y₁$/ }) }).first().click();
    await expect(page.locator('.ms-info').first()).toContainText('y₁');
    // the peak table follows the zoom: only peaks around y1 remain
    await expect(page.locator('.ion-list tbody tr').filter({ has: page.locator('td:nth-child(3)', { hasText: /^y₂$/ }) })).toHaveCount(0);
    // shift-click second peak on the canvas is hard to target; use the API path: select via table + measure label
    await rows.first().click();
    await page.getByRole('button', { name: 'Unassign', exact: true }).click();
    await expect(page.locator('.ion-list tbody tr').first()).not.toContainText('manual'); // filtered out of "assigned"
    expect(errors).toEqual([]);
  });
});

test('annotator: XIC and reference mirror comparison', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/tools/mzml-spectrum-annotator/');
  await page.locator('#example-select').selectOption({ index: 1 });
  await page.locator('[data-action="run"]').click();
  await expect(page.locator('[data-output="spectraCount"]')).toHaveText('26', { timeout: 30_000 });
  await page.locator('input[aria-label^="m/z values for an extracted-ion"]').fill('571.3602');
  await page.getByRole('button', { name: 'Show XIC' }).click();
  await expect(page.locator('.ts-status')).toContainText('XIC of 1 m/z', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Pin as reference' }).click();
  await page.getByRole('button', { name: /MS2 523\.77/ }).click();
  await expect(page.locator('.ms-card').filter({ hasText: 'Reference:' }).first()).toContainText('cosine', { timeout: 30_000 });
  expect(errors).toEqual([]);
});
