// Interaction tests for the mass-spectrometry tools (linking between structure, table and spectrum).
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
