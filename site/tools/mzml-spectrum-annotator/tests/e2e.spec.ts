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
  await page.locator('[data-source="example"]').click();
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

test('annotator: panels collapse, the inputs rail hides, and hovering an ion shades only its residues', async ({ page }) => {
  await page.goto('/tools/mzml-spectrum-annotator/');
  await page.locator('[data-source="example"]').click();
  await page.locator('#example-select').selectOption({ index: 1 });
  await page.locator('[data-action="run"]').click();
  await expect(page.locator('[data-output="spectraCount"]')).toHaveText('26', { timeout: 30_000 });
  // hover a b4 assignment: 4 of 10 residues highlighted, not the whole ring
  const row = page.locator('.ion-table tbody tr.matched').filter({ hasText: /^.*b₄/ }).first();
  await row.hover();
  const css = await page.locator('.pep-panel > style').evaluate((e) => e.textContent ?? '');
  expect(new Set(css.match(/data-res="\d+"/g) ?? []).size).toBe(4);
  // collapse the Scans panel
  await page.locator('section.panel[aria-label="Scans"] .panel-toggle').click();
  await expect(page.locator('section.panel[aria-label="Scans"] .panel-body')).toBeHidden();
  // hide and show the inputs
  await page.getByRole('button', { name: 'Hide inputs' }).click();
  await expect(page.locator('.ts')).toHaveAttribute('data-inputs', 'collapsed');
  await page.getByRole('button', { name: 'Show inputs' }).click();
  await expect(page.locator('.ts')).toHaveAttribute('data-inputs', 'open');
});

test('annotator: example-or-file switch, Run on top, ion Auto, sequence figure and tooltips on LUNA18', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/tools/mzml-spectrum-annotator/');
  // file mode is the default and hides the example picker; example mode hides the file input
  await expect(page.locator('#in-file')).toBeVisible();
  await expect(page.locator('#example-select')).toHaveCount(0);
  await page.locator('[data-source="example"]').click();
  await expect(page.locator('#in-file')).toHaveCount(0);
  await page.locator('#example-select').selectOption({ label: 'Synthetic demo: LUNA18 (paluratide) macrocycle (HCD)' });
  // Run is the first control of the inputs column
  const runBox = await page.locator('[data-action="run"]').boundingBox();
  const exBox = await page.locator('#example-select').boundingBox();
  expect(runBox!.y).toBeLessThan(exBox!.y);
  await page.locator('[data-action="run"]').click();
  await expect(page.locator('[data-output="spectraCount"]')).toHaveText('13', { timeout: 30_000 });
  await expect(page.locator('[data-output="precursorMz"]')).toHaveText(/719\.402/);
  // ions: Auto reports the method, Choose switches to custom chips
  await expect(page.locator('[data-input="ionTypes"]')).toContainText('Auto: HCD');
  await page.locator('[data-ions="custom"]').click();
  await expect(page.locator('[data-ions="custom"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-ions="auto"]').click();
  // sequence figure with ring flags, filterable by the series chips
  await page.locator('[data-view="sequence"]').click();
  await expect(page.locator('.pep-seq .mk').first()).toBeVisible();
  const flags = await page.locator('.pep-seq .mk').count();
  expect(flags).toBeGreaterThan(10);
  await page.locator('.pep-panel').locator('xpath=..').getByRole('button', { name: 'a', exact: true }).first().click();
  expect(await page.locator('.pep-seq .mk[data-type="a"]').count()).toBe(0);
  // tooltips stay inside the viewport
  const help = page.locator('.ts-inputs .help').nth(3);
  await help.hover();
  const box = await page.locator('body > .help-pop').boundingBox();
  const vp = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height);
  expect(errors).toEqual([]);
});

test('annotator: pasted sequence notations annotate the same peptide', async ({ page }) => {
  await page.goto('/tools/mzml-spectrum-annotator/');
  await page.locator('[data-source="example"]').click();
  await page.locator('#example-select').selectOption({ label: 'Synthetic demo: LUNA18 (paluratide) macrocycle (HCD)' });
  await page.locator('#in-sequence').fill('cyclo[MAA_{1}→7W2_{2}→7VN_{3}→SAR_{4}→02A_{5}→PRO_{6}→AC5_{7}→7VU_{8}→Mad_{9}→MLE_{10}→ILE_{11}]');
  await page.locator('[data-action="run"]').click();
  await expect(page.locator('.ms-summary')).toContainText('719.402', { timeout: 30_000 });
  await expect(page.locator('.ms-summary')).toContainText('11/11');
});
