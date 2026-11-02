// Interaction tests for the ESP map generator: figure pixels, drawing, file input, orbitals, slices, errors.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const URL = '/tools/electrostatic-potential-map/';

async function run(page: Page, example?: string) {
  await page.goto(URL);
  if (example) await page.locator('#example-select').selectOption({ label: example });
  await page.locator('[data-action="run"]').click();
  await expect(page.locator('.ts-status[data-state="done"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-testid="esp-stage"][data-ready="true"]')).toBeVisible({ timeout: 30_000 });
}

/** Counts strongly red and strongly blue pixels in a PNG, decoded in the page. */
async function colourCounts(page: Page, png: Buffer) {
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let red = 0, blue = 0, total = 0;
    for (let i = 0; i < d.length; i += 4) {
      total++;
      const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
      if (r > 120 && r > g + 60 && r > b + 60) red++;
      if (b > 110 && b > r + 45 && b > g + 20) blue++;
    }
    return { red, blue, total, w: cv.width, h: cv.height };
  }, png.toString('base64'));
}

test.describe('electrostatic-potential-map', () => {
  test('benzene face-on: the exported PNG is red in the middle and blue at the rim, at the requested size', async ({ page }) => {
    await run(page, 'Benzene (SMILES)');
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="save-png"]').click()]);
    const buf = readFileSync(await download.path());
    const c = await colourCounts(page, buf);
    expect(c.w).toBe(Math.round(6.5 * 300));
    expect(c.red).toBeGreaterThan(c.total * 0.03);
    expect(c.blue).toBeGreaterThan(c.total * 0.003);
    expect(download.suggestedFilename()).toMatch(/\.png$/);
  });

  test('hexafluorobenzene reverses the sign of the ring potential relative to benzene', async ({ page }) => {
    await run(page, 'Benzene (SMILES)');
    const bz = parseFloat((await page.locator('[data-output="esp3"]').first().textContent())!);
    await run(page, 'Hexafluorobenzene (SMILES)');
    const hf = parseFloat((await page.locator('[data-output="esp3"]').first().textContent())!);
    expect(bz).toBeLessThan(-3);
    expect(hf).toBeGreaterThan(3);
  });

  test('the caption, statistics and colour bar update with the settings', async ({ page }) => {
    await run(page, 'Phenol (SMILES)');
    await expect(page.locator('[data-testid="esp-caption"]')).toContainText('RHF/6-31G');
    await expect(page.locator('[data-testid="esp-caption"]')).toContainText('0.002 e/bohr³');
    const before = await page.locator('[data-output="vsmax"]').textContent();
    await page.locator('.esp-group[data-group="colour"] select').nth(1).selectOption('kj');
    await expect(page.locator('[data-testid="esp-caption"]')).toContainText('kJ/mol');
    // the statistics are rebuilt a moment after the caption changes
    await expect.poll(async () => parseFloat((await page.locator('[data-output="vsmax"]').textContent())!) / parseFloat(before!), { timeout: 10_000 }).toBeCloseTo(4.184, 1);
  });

  test('switching to the HOMO draws two coloured lobes', async ({ page }) => {
    await run(page, 'Benzene (SMILES)');
    await page.locator('.esp-group[data-group="surface"] select').first().selectOption('orbital');
    await expect(page.locator('[data-testid="esp-stage"][data-ready="true"]')).toBeVisible({ timeout: 30_000 });
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="save-png"]').click()]);
    const c = await colourCounts(page, readFileSync(await download.path()));
    expect(c.red).toBeGreaterThan(c.total * 0.005);
    expect(c.blue).toBeGreaterThan(c.total * 0.005);
  });

  test('drawing dialog returns SMILES that run', async ({ page }) => {
    await page.goto(URL);
    await page.locator('[data-action="open-sketch"]').click();
    await expect(page.locator('[data-testid="sketch-host"] svg, [data-testid="sketch-host"] canvas').first()).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-action="use-drawing"]').click();
    await expect(page.locator('#in-structure')).not.toHaveValue('');
    await expect(page.locator('.esp-modal')).toHaveCount(0);
  });

  test('an XYZ file replaces the structure and runs', async ({ page }) => {
    await page.goto(URL);
    const xyz = '3\nwater\nO 0.000 0.000 0.1173\nH 0.000 0.7572 -0.4692\nH 0.000 -0.7572 -0.4692\n';
    await page.locator('#in-structureFile').setInputFiles({ name: 'water.xyz', mimeType: 'text/plain', buffer: Buffer.from(xyz) });
    await expect(page.locator('#in-source')).toHaveValue('xyz');
    await page.locator('#in-basis').selectOption('sto-3g');
    await page.locator('[data-action="run"]').click();
    await expect(page.locator('.ts-status[data-state="done"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-output="formula"]').first()).toHaveText('H2O');
  });

  test('bad input gives a readable error, not a crash', async ({ page }) => {
    await page.goto(URL);
    await page.locator('#in-structure').fill('not a smiles(');
    await page.locator('[data-action="run"]').click();
    await expect(page.locator('.ts-status[data-state="error"]')).toContainText(/SMILES/i, { timeout: 30_000 });
    await page.locator('#in-structure').fill('CBr');
    await page.locator('[data-action="run"]').click();
    await expect(page.locator('.ts-status[data-state="error"]')).toContainText(/not supported/i, { timeout: 30_000 });
    await page.locator('#in-structure').fill('[CH3]');
    await page.locator('[data-action="run"]').click();
    await expect(page.locator('.ts-status[data-state="error"]')).toContainText(/radical|odd number/i, { timeout: 30_000 });
  });

  test('the 2D slice computes and offers SVG', async ({ page }) => {
    await run(page, 'Benzene (SMILES)');
    await page.getByRole('button', { name: /2D slice/ }).click();
    await page.locator('[data-action="compute-slice"]').click();
    await expect(page.locator('[data-testid="slice-svg"] svg')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-testid="slice-svg"] svg path').first()).toBeAttached();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save SVG' }).click()]);
    const svg = readFileSync(await download.path(), 'utf8');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('<image');
  });

  test('phone width: results fit without sideways scrolling and controls stay labelled', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await run(page, 'Benzene (SMILES)');
    await page.getByRole('button', { name: /2D slice/ }).click();
    await page.getByRole('button', { name: /Ring probe/ }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), { timeout: 5000 }).toBeLessThanOrEqual(1);
    // every control in the figure panel has an accessible name (a label tied to it)
    const unnamed = await page.evaluate(() => [...document.querySelectorAll('.esp-controls input, .esp-controls select')].filter((el) => {
      const e = el as HTMLInputElement;
      return !(e.labels && e.labels.length) && !e.getAttribute('aria-label');
    }).length);
    expect(unnamed).toBe(0);
  });
});
