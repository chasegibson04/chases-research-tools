// Generic e2e protocol run against EVERY tool (docs/TESTING_PROTOCOL.md). Add tool-specific specs in tools/<id>/tests/e2e.spec.ts.
import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const toolsDir = join(process.cwd(), 'tools');
const tools = readdirSync(toolsDir).filter((d) => !d.startsWith('_') && existsSync(join(toolsDir, d, 'tool.json')))
  .map((d) => JSON.parse(readFileSync(join(toolsDir, d, 'tool.json'), 'utf8')));

for (const tool of tools) {
  test.describe(`tool: ${tool.id}`, () => {
    test('page loads with no console errors, title, citation and help tooltips', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(`/tools/${tool.id}/`);
      await expect(page.locator('h1')).toContainText(tool.name);
      await expect(page.locator('#cite')).toBeVisible();
      await expect(page.locator('script[type="application/ld+json"]').first()).toHaveCount(1);
      if (tool.kind === 'interactive') {
        await expect(page.locator('.ts')).toBeVisible({ timeout: 20_000 });
        for (const input of tool.inputs.filter((i: any) => !i.advanced)) {
          await expect(page.locator(`[data-input="${input.name}"] .help`)).toHaveCount(1);
        }
      }
      expect(errors, errors.join('\n')).toEqual([]);
    });

    if (tool.kind === 'interactive') {
      for (const ex of tool.examples) {
        test(`example "${ex.label}" runs within budget`, async ({ page }) => {
          await page.goto(`/tools/${tool.id}/`);
          await page.locator('#example-select').selectOption({ label: ex.label });
          const t0 = Date.now();
          await page.locator('[data-action="run"]').click();
          await expect(page.locator('.ts-status[data-state="done"]')).toBeVisible({ timeout: (ex.expectedRuntimeSeconds ?? 10) * 1000 * 3 + 15_000 });
          expect(Date.now() - t0).toBeLessThan(((ex.expectedRuntimeSeconds ?? 10) * 3 + 15) * 1000);
          const exJson = JSON.parse(readFileSync(join(toolsDir, tool.id, 'examples', ex.file), 'utf8'));
          for (const [k, v] of Object.entries(exJson.expected ?? {})) {
            const el = page.locator(`[data-output="${k}"]`);
            if (await el.count()) {
              const text = (await el.first().textContent()) ?? '';
              if (typeof v === 'number') expect(Math.abs(parseFloat(text.replace(/[^0-9.\-]/g, '')) - v)).toBeLessThan(0.001 * Math.max(1, Math.abs(v)) + 0.0005);
              else expect(text).toContain(String(v));
            }
          }
        });
      }
    }
  });
}
