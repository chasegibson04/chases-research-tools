// End-to-end tests of the converter page: vendor files through the real worker, and output into a chosen folder.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

// Converter with real vendor data in a real browser worker (FileReaderSync path for Thermo, sql.js WASM for
// Bruker). Runs only when MS_CORPUS points at the public test corpus.
const CORPUS = process.env.MS_CORPUS ?? '';
const THERMO = `${CORPUS}/vendor_raw/thermo_mzdata_small/small.RAW`;
const BRUKER = `${CORPUS}/vendor_raw/pwiz/Bruker/Reader_Bruker_Test.data/Hela_QC_PASEF_Slot1-first-6-frames.d`;
test.describe('ms-file-converter with vendor files', () => {
  test.skip(!CORPUS || !fs.existsSync(THERMO) || !fs.existsSync(BRUKER), 'test corpus not present');
  test('Thermo .raw and a timsTOF .d folder convert to mzML in the queue', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/tools/ms-file-converter/');
    await page.locator('[data-testid="conv-files"]').setInputFiles(THERMO);
    await page.locator('[data-testid="conv-folder"]').setInputFiles(BRUKER);
    await expect(page.locator('.conv-queue[data-output="queue"] tbody tr')).toHaveCount(2);
    await page.locator('#in-combineIonMobility').check();
    const downloads: string[] = [];
    page.on('download', (d) => downloads.push(d.suggestedFilename()));
    await page.locator('[data-action="run"]').click();
    await expect(page.locator('.ts-status[data-state="done"]')).toBeVisible({ timeout: 120_000 });
    const rows = page.locator('.conv-queue[data-output="queue"] tbody tr');
    await expect(rows.nth(0)).toContainText('Thermo .raw');
    await expect(rows.nth(0)).toContainText('48');
    await expect(rows.nth(0)).toContainText('small.mzML');
    await expect(rows.nth(1)).toContainText('Bruker timsTOF .d (TDF)');
    await expect(rows.nth(1)).toContainText('Hela_QC_PASEF_Slot1-first-6-frames.mzML');
    await expect.poll(() => downloads.length).toBe(2);
    expect(errors).toEqual([]);
  });
});

test('ms-file-converter writes into a chosen folder (File System Access handle passed to the worker)', async ({ page }) => {
  // The real picker needs a user gesture; the origin-private file system returns the same FileSystemDirectoryHandle type.
  await page.addInitScript(() => { (window as any).showDirectoryPicker = async () => { const root = await navigator.storage.getDirectory(); return root.getDirectoryHandle('picked-output', { create: true }); }; });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.goto('/tools/ms-file-converter/');
  await page.locator('#example-select').selectOption({ label: 'Synthetic mzML → MGF' });
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.locator('[data-output="outputLocation"]')).toHaveText('picked-output');
  await page.locator('[data-action="run"]').click();
  await expect(page.locator('.ts-status[data-state="done"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.conv-queue[data-output="queue"] tbody tr').first()).toContainText('picked-output');
  const saved = await page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('picked-output');
    const f = await (await dir.getFileHandle('demo-synthetic.mgf')).getFile();
    const t = await f.text();
    return { size: f.size, entries: (t.match(/BEGIN IONS/g) ?? []).length };
  });
  expect(saved.entries).toBe(24);
  expect(downloads).toBe(0);
  expect(errors).toEqual([]);
});
