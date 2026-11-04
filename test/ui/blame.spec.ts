import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?sample=quick');
  await page.waitForFunction(() => Boolean(window.mergerTest));
});

test('line-number menu toggles annotations and clicking blame focuses the file in its commit', async ({ page }) => {
  const numbers = page.locator('#left-editor .margin-view-overlays .line-numbers').first();
  await numbers.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Show Git Blame', exact: true }).click();
  const column = page.locator('#left-editor .blame-column');
  await expect(column).toBeVisible();
  await expect(column.locator('.blame-row').first()).toContainText('20.10.25Alex Smith');
  const positions = await page.evaluate(() => {
    const editor = window.mergerTest!.editors[0];
    const info = editor.getLayoutInfo();
    const row = document.querySelector('#left-editor .blame-row')!.getBoundingClientRect();
    const root = document.querySelector('#left-editor')!.getBoundingClientRect();
    return { numbersEnd: info.lineNumbersLeft + info.lineNumbersWidth, rowStart: row.left - root.left, rowEnd: row.right - root.left, code: info.contentLeft };
  });
  expect(positions.rowStart).toBeGreaterThanOrEqual(positions.numbersEnd);
  expect(positions.rowEnd).toBeLessThanOrEqual(positions.code);
  const hash = await column.locator('.blame-row').first().getAttribute('data-commit');
  await column.locator('.blame-row').first().click();
  const commit = page.locator('.demo-commit-dialog .commit-view');
  await expect(commit).toHaveAttribute('data-commit', hash!);
  await expect(commit).toHaveAttribute('data-selected-path', 'settings.ts');
  await expect(commit.locator('.commit-file[aria-current="true"]')).toContainText('settings.ts');
  await expect(commit.locator('.commit-diff .line-delete, .commit-diff .char-delete').first()).toBeVisible();
  await expect(commit.locator('.commit-diff .line-insert, .commit-diff .char-insert').first()).toBeVisible();
  const highlights = await commit.locator('.commit-diff .line-delete, .commit-diff .line-insert').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
  expect(highlights.length).toBeGreaterThan(0);
  expect(highlights.every(color => color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent')).toBe(true);
  await commit.locator('.commit-file').first().click();
  await expect(commit).toHaveAttribute('data-selected-path', 'README.md');
  await commit.getByRole('button', { name: 'Close commit' }).click();
  await numbers.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Hide Git Blame', exact: true }).click();
  await expect(column).toBeHidden();
});

test('result edits refresh annotations and uncommitted rows cannot open a commit', async ({ page }) => {
  await page.locator('#result-editor .margin-view-overlays .line-numbers').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Show Git Blame', exact: true }).click();
  const column = page.locator('#result-editor .blame-column');
  await expect(column.locator('.blame-row').first()).toBeVisible();
  await page.evaluate(() => {
    const model = window.mergerTest!.editors[1].getModel()!;
    model.applyEdits([{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: '// unsaved\n' }]);
  });
  await expect(column.locator('.blame-row').first()).toContainText('Not committed yet');
  await expect(column.locator('.blame-row').first()).toBeDisabled();
  await page.getByRole('combobox', { name: 'Preview sample' }).selectOption('insertions');
  await expect(column).toBeHidden();
  await expect(page.locator('.demo-commit-dialog')).toHaveCount(0);
});
