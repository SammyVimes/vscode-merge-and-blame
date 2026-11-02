import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?sample=quick');
  await expect(page.locator('.monaco-editor')).toHaveCount(3);
  await page.waitForFunction(() => Boolean(window.mergerTest));
});

test('renders local/result/incoming, applying and ignoring a conflict updates the editable result', async ({ page }) => {
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.locator('#complete')).toBeDisabled();
  await page.getByRole('button', { name: 'Apply local change 1', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.mergerTest!.session.result)).toContain('name: "local"');
  await page.getByRole('button', { name: 'Ignore incoming change 1', exact: true }).click();
  await expect(page.locator('#selected-label')).toContainText('Resolved');
  const inlineReset = page.getByRole('button', { name: 'Revert resolution of change 1 from local side', exact: true });
  await expect(inlineReset).toBeVisible();
  await inlineReset.click();
  await expect.poll(() => page.evaluate(() => window.mergerTest!.session.result)).toContain('name: "old"');
  await expect(page.getByRole('button', { name: 'Apply local change 1', exact: true })).toBeVisible();
});

test('bulk and wand are separate undoable actions and leave an ambiguous conflict untouched', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.locator('#apply-all').click();
  let text = await page.evaluate(() => window.mergerTest!.session.result);
  expect(text).toContain('enabled = true'); expect(text).toContain('name: "old"'); expect(text).toContain('render(oldName, oldColor)');
  await page.locator('#magic').click();
  text = await page.evaluate(() => window.mergerTest!.session.result);
  expect(text).toContain('render(newName, newColor)'); expect(text).toContain('name: "old"');
  await page.locator('#undo').click();
  expect(await page.evaluate(() => window.mergerTest!.session.result)).toContain('render(oldName, oldColor)');
  await page.locator('#redo').click();
  expect(await page.evaluate(() => window.mergerTest!.session.result)).toContain('render(newName, newColor)');
  expect(errors).toEqual([]);
});

test('Ctrl/Cmd-click on the second arrow preserves and appends to the first accepted side', async ({ page }) => {
  await page.getByRole('button', { name: 'Apply local change 1', exact: true }).click();
  const partial = await page.evaluate(() => window.mergerTest!.session.result);
  await page.getByRole('button', { name: 'Apply incoming change 1', exact: true }).click({ modifiers: ['ControlOrMeta'] });
  const resolved = await page.evaluate(() => ({ text: window.mergerTest!.session.result, state: window.mergerTest!.session.hunks[0].resolved }));
  expect(resolved.text).toContain('name: "local"');
  expect(resolved.text).toContain('name: "incoming"');
  expect(resolved.state).toEqual({ left: true, right: true });
  await page.locator('#undo').click();
  expect(await page.evaluate(() => window.mergerTest!.session.result)).toBe(partial);
});

test('typing in the middle is preserved by bulk apply and keyboard undo restores text', async ({ page }) => {
  await page.evaluate(() => {
    const editor = window.mergerTest!.editors[1];
    editor.setPosition({ lineNumber: 9, column: 1 }); editor.focus();
  });
  await page.keyboard.insertText('// manual ');
  await expect.poll(() => page.evaluate(() => window.mergerTest!.session.result)).toContain('// manual export');
  await page.locator('#apply-all').click();
  expect(await page.evaluate(() => window.mergerTest!.session.result)).toContain('// manual export const enabled = false;');
  await page.locator('#undo').click();
  expect(await page.evaluate(() => window.mergerTest!.session.result)).toContain('// manual export');
  await page.locator('#undo').click();
  expect(await page.evaluate(() => window.mergerTest!.session.result)).not.toContain('// manual export');
});

test('navigation, connector shapes, and read-only inputs remain usable at a smaller width', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 650 });
  await expect(page.locator('#left-gutter svg path').first()).toBeVisible();
  await page.locator('#next').click(); await expect(page.locator('#selected-label')).toContainText('Change 2');
  await page.evaluate(() => { window.mergerTest!.editors[0].focus(); });
  const before = await page.evaluate(() => window.mergerTest!.editors[0].getValue());
  await page.keyboard.type('cannot edit');
  expect(await page.evaluate(() => window.mergerTest!.editors[0].getValue())).toBe(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1000);
});

test('scroll synchronization follows changed line positions and can be disabled', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 360 });
  await page.evaluate(() => window.mergerTest!.send({ type: 'edit', edits: [{ offset: 0, length: 0, text: '// extra\n// context\n' }] }));
  await page.evaluate(() => window.mergerTest!.editors[0].setScrollTop(70));
  await expect.poll(() => page.evaluate(() => window.mergerTest!.editors[1].getScrollTop())).toBeGreaterThan(70);
  const positions = await page.evaluate(() => window.mergerTest!.editors.map(editor => editor.getScrollTop()));
  expect(Math.abs(positions[0] - positions[2])).toBeLessThan(2);
  await page.locator('#sync').click();
  await page.evaluate(() => window.mergerTest!.editors[0].setScrollTop(0));
  expect(await page.evaluate(() => window.mergerTest!.editors[1].getScrollTop())).toBe(positions[1]);
});

test('local editor worker starts without runtime errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.reload(); await page.waitForFunction(() => Boolean(window.mergerTest));
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test('inline magic wand resolves one conflict and returns after undo', async ({ page }) => {
  const wand = page.getByRole('button', { name: 'Resolve simple conflict 2', exact: true });
  await expect(wand).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resolve simple conflict 1', exact: true })).toHaveCount(0);
  await wand.click();
  const result = await page.evaluate(() => window.mergerTest!.session.result);
  expect(result).toContain('render(newName, newColor)');
  expect(result).toContain('name: "old"'); expect(result).toContain('enabled = false');
  await expect(wand).toHaveCount(0);
  await page.locator('#undo').click();
  await expect(wand).toBeVisible();
  expect(await page.evaluate(() => window.mergerTest!.session.result)).toContain('render(oldName, oldColor)');
});

test('uses the supplied IDEA dark reference palette, font, and gutter-control order', async ({ page }) => {
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(25, 26, 28)');
  await expect(page.locator('#result-editor .change.conflict').first()).toHaveCSS('background-color', 'rgb(69, 48, 43)');
  await expect(page.locator('#left-editor .change.modified').first()).toHaveCSS('background-color', 'rgb(37, 50, 62)');
  await expect(page.locator('#left-editor .change.added').first()).toHaveCSS('background-color', 'rgb(41, 68, 54)');
  await expect(page.locator('#result-editor .change.deleted').first()).toHaveCSS('background-color', 'rgb(72, 74, 74)');
  expect(await page.evaluate(() => document.fonts.check('13px "JetBrains Mono"'))).toBe(true);
  await expect(page.locator('#left-gutter .change-controls').first().locator('button').nth(0).locator('svg')).toHaveAttribute('data-icon', 'ignore');
  await expect(page.locator('#left-gutter .change-controls').first().locator('button').nth(1).locator('svg')).toHaveAttribute('data-icon', 'applyRight');
  await expect(page.locator('#right-gutter .change-controls').first().locator('button').nth(0).locator('svg')).toHaveAttribute('data-icon', 'applyLeft');
});

test('diff bubbles fully wrap both action buttons, including insertion and deletion ends', async ({ page }) => {
  const samples = await page.evaluate(() => {
    const result: { control: string; inside: boolean }[] = [];
    for (const id of ['left-gutter', 'right-gutter']) {
      for (const button of document.querySelectorAll<HTMLButtonElement>(`#${id} .change-controls button`)) {
        const shape = document.querySelector<SVGGeometryElement>(`#${id} svg path[data-hunk="${button.dataset.hunk}"]`)!;
        const box = button.getBoundingClientRect();
        const transform = shape.getScreenCTM()!.inverse();
        // Test the whole click target rather than only the glyph's center.
        const points = [[box.left + 2, box.top + 2], [box.right - 2, box.top + 2], [box.left + 2, box.bottom - 2], [box.right - 2, box.bottom - 2]];
        result.push({ control: button.getAttribute('aria-label')!, inside: points.every(([x, y]) => shape.isPointInFill(new DOMPoint(x, y).matrixTransform(transform))) });
      }
    }
    return result;
  });
  expect(samples.length).toBeGreaterThanOrEqual(10);
  expect(samples.filter(sample => !sample.inside)).toEqual([]);
});

test('ignore and double-chevron icons share the same size and vertical center', async ({ page }) => {
  const geometry = await page.evaluate(() => {
    return ['left-gutter', 'right-gutter'].map(id => {
      const icons = [...document.querySelectorAll<SVGSVGElement>(`#${id} .change-controls:first-child button svg`)];
      return icons.map(icon => {
        const rect = icon.getBoundingClientRect();
        const glyph = icon.querySelector<SVGGraphicsElement>('path')!.getBBox();
        const stroke = getComputedStyle(icon.querySelector('path')!).stroke;
        return { width: rect.width, height: rect.height, center: rect.y + rect.height / 2, glyphHeight: glyph.height, glyphCenter: glyph.y + glyph.height / 2, stroke };
      });
    });
  });
  for (const pair of geometry) {
    expect(pair).toHaveLength(2);
    expect(pair[0]).toEqual(pair[1]);
    expect(pair[0].height).toBe(18);
    expect(pair[0].stroke).toBe('rgb(188, 190, 196)');
  }
});
