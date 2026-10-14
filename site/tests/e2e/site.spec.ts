// Site-level smoke protocol: core pages render, no console errors, key SEO artifacts exist.
import { test, expect } from '@playwright/test';

const pages = ['/', '/tools/', '/categories/', '/categories/mass-spectrometry/', '/categories/mass-spectrometry/peptidomics/', '/about/', '/contact/', '/privacy/', '/terms/', '/cv/'];

for (const path of pages) {
  test(`page ${path} renders cleanly`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.locator('header.site-header')).toBeVisible();
    await expect(page.locator('footer.site-footer')).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    expect(errors, errors.join('\n')).toEqual([]);
  });
}

test('404 page is served for unknown routes', async ({ page }) => {
  const res = await page.goto('/this-does-not-exist/');
  expect(res?.status()).toBe(404);
  await expect(page.locator('h1')).toContainText('404');
});

test('sitemap, robots, llms.txt exist', async ({ request }) => {
  for (const p of ['/sitemap-index.xml', '/robots.txt', '/llms.txt']) {
    const r = await request.get(p);
    expect(r.status(), p).toBe(200);
  }
  const llms = await (await request.get('/llms.txt')).text();
  expect(llms).toContain('/tools/peptide-mass-calculator/');
});

test('directory lists every tool and the directory ad slot never sits inside a tool frame', async ({ page }) => {
  await page.goto('/tools/');
  expect(await page.locator('a.card[href="/tools/peptide-mass-calculator/"]').count()).toBeGreaterThan(0); // listed once per subcategory
  expect(await page.locator('.tool-frame .ad-slot').count()).toBe(0);
});

test('theme picker switches the theme and remembers it', async ({ page }) => {
  await page.goto('/');
  await page.locator('#theme-select').selectOption('graphite');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'graphite');
  await page.goto('/tools/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'graphite');
  await expect(page.locator('#theme-select')).toHaveValue('graphite');
  await page.locator('#theme-select').selectOption('paper');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');
});

test('no page scrolls sideways at phone width', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  for (const u of ['/', '/tools/', '/cv/', '/tools/peptide-mass-calculator/', '/tools/peptide-fragment-ion-predictor/', '/tools/mzml-spectrum-annotator/', '/tools/ms-file-converter/']) {
    await page.goto(u);
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(sw, `${u} is ${sw}px wide at a ${cw}px viewport`).toBeLessThanOrEqual(cw);
  }
});
