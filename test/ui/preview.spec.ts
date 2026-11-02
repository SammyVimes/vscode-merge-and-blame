import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.mergerTest));
});

test('defaults to a larger example and shows pure insertions from both sides', async ({ page }) => {
  await expect(page.getByRole('combobox', { name: 'Preview sample' })).toHaveValue('overview');
  const original = await page.evaluate(() => ({ lines: window.mergerTest!.editors[1].getModel()!.getLineCount(), changes: window.mergerTest!.session.hunks.length, result: window.mergerTest!.session.result }));
  expect(original.lines).toBeGreaterThanOrEqual(150); expect(original.changes).toBe(17);
  expect(original.result).not.toContain('result.traceId = request.id;');
  expect(original.result).not.toContain('result.audit = createAuditEntry(context);');
  await page.getByRole('button', { name: 'Apply local change 1', exact: true }).click();
  await page.getByRole('button', { name: 'Apply incoming change 2', exact: true }).click();
  const result = await page.evaluate(() => window.mergerTest!.session.result);
  expect(result).toContain('result.traceId = request.id;');
  expect(result).toContain('result.audit = createAuditEntry(context);');
  await page.getByRole('button', { name: 'Reset sample', exact: true }).click();
  expect(await page.evaluate(() => window.mergerTest!.session.result)).toBe(original.result);
  await expect(page.locator('#undo')).toBeDisabled();
});

test('sample selector updates all panes and supports insertion and deletion workflows', async ({ page }) => {
  const select = page.getByRole('combobox', { name: 'Preview sample' });
  await select.selectOption('insertions');
  await expect(page.locator('#file-name')).toHaveText('insertions.ts');
  expect(await page.evaluate(() => window.mergerTest!.editors[0].getValue())).toContain('validateLocalRequest(request);');
  expect(await page.evaluate(() => window.mergerTest!.editors[2].getValue())).toContain('validateIncomingRequest(request);');
  await page.locator('#apply-all').click();
  const inserted = await page.evaluate(() => window.mergerTest!.session.result);
  expect(inserted).toContain('result.traceId = request.id;');
  expect(inserted).not.toContain('validateLocalRequest(request);');
  await select.selectOption('deletions');
  await expect(page.locator('#file-name')).toHaveText('deletions.ts');
  expect(await page.evaluate(() => window.mergerTest!.session.result)).toContain('result.legacy = true;');
  await page.locator('#apply-all').click();
  expect(await page.evaluate(() => window.mergerTest!.session.result)).not.toContain('result.legacy = true;');
  await expect(page.locator('#complete')).toBeEnabled();
  await expect(page.locator('#save')).toBeDisabled();
});

test('focused samples are directly linkable and reload to their original state', async ({ page }) => {
  await page.getByRole('combobox', { name: 'Preview sample' }).selectOption('boundaries');
  await expect(page).toHaveURL(/sample=boundaries/);
  await page.locator('#apply-all').click();
  expect(await page.evaluate(() => window.mergerTest!.session.result)).toContain('export const version = 2;');
  await page.reload(); await page.waitForFunction(() => Boolean(window.mergerTest));
  await expect(page.locator('#sample-select')).toHaveValue('boundaries');
  expect(await page.evaluate(() => window.mergerTest!.session.result)).not.toContain('export const version = 2;');
});

test('insertion sample also demonstrates inserting text within an existing line', async ({ page }) => {
  await page.getByRole('combobox', { name: 'Preview sample' }).selectOption('insertions');
  await page.locator('#next').click(); await page.locator('#next').click(); await page.locator('#next').click();
  await page.getByRole('button', { name: 'Apply local change 4', exact: true }).click();
  const result = await page.evaluate(() => window.mergerTest!.session.result);
  expect(result).toContain('result.tags = ["core", "local"];');
  expect(result).not.toContain('result.traceId = request.id;');
  await page.locator('#undo').click();
  expect(await page.evaluate(() => window.mergerTest!.session.result)).toContain('result.tags = ["core"];');
});
