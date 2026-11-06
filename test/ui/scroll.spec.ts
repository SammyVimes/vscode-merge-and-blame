import { test, expect, type Page } from '@playwright/test';
import { MergeSession } from '../../src/core/merge';

const rows = Array.from({ length: 5500 }, (_, i) => `const row${i} = render("base", "base"); // context ${i}`);
const input = {
  name: 'large.ts', base: rows.join('\n'),
  left: rows.map((row, i) => i % 20 === 5 ? row.replace('"base"', '"local"') : row).join('\n'),
  right: rows.map((row, i) => i % 20 === 5 ? row.replace('"base", "base"', '"base", "incoming"') : row).join('\n'),
  leftLabel: 'Local', rightLabel: 'Incoming',
};

async function loadLargeMerge(page: Page): Promise<void> {
  await page.goto('/?sample=quick');
  await page.waitForFunction(() => Boolean(window.mergerTest));
  await page.evaluate(({ input, snapshot }) => {
    const merger = window.mergerTest!;
    Object.assign(merger.session.input, input);
    merger.session.restore(snapshot);
    merger.send({ type: 'edit', edits: [{ offset: 0, length: 0, text: '// manual prefix\n' }] });
  }, { input, snapshot: new MergeSession(input).snapshot() });
  await expect(page.locator('#status')).toContainText('275 unresolved');
}

test('scrolling a 5500-line merge does not split or join whole buffers', async ({ page }) => {
  await loadLargeMerge(page);
  const counts = await page.evaluate(async () => {
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await frame(); await frame();
    const split = Object.getOwnPropertyDescriptor(String.prototype, 'split')!;
    const join = Object.getOwnPropertyDescriptor(Array.prototype, 'join')!;
    let splits = 0, joins = 0;
    Object.defineProperty(String.prototype, 'split', { ...split, value: function (this: string, ...args: unknown[]) {
      if (this.length > 200000 && args[0] === '\n') splits++;
      return Reflect.apply(split.value, this, args);
    } });
    Object.defineProperty(Array.prototype, 'join', { ...join, value: function (this: unknown[], ...args: unknown[]) {
      if (this.length >= 5500 && args[0] === '\n') joins++;
      return Reflect.apply(join.value, this, args);
    } });
    try {
      for (let i = 1; i <= 8; i++) {
        window.mergerTest!.editors[0].setScrollTop(i * 6000);
        await frame(); await frame();
      }
    } finally {
      Object.defineProperty(String.prototype, 'split', split);
      Object.defineProperty(Array.prototype, 'join', join);
    }
    return { splits, joins };
  });
  expect(counts).toEqual({ splits: 0, joins: 0 });
  expect(await page.locator('.change-controls').count()).toBeGreaterThan(0);
  expect(await page.locator('.change-controls').count()).toBeLessThan(20);
});

test('large merge scroll mappings refresh after edits, apply and undo', async ({ page }) => {
  await loadLargeMerge(page);
  const change = await page.evaluate(() => {
    const merger = window.mergerTest!;
    const hunk = merger.session.hunks.find(h => h.leftLines.start >= 4000)!;
    merger.editors[0].setScrollTop((hunk.leftLines.start - 3) * 21 + 10);
    return hunk.id;
  });
  const offset = () => page.evaluate(() => window.mergerTest!.editors[1].getScrollTop() - window.mergerTest!.editors[0].getScrollTop());
  await expect.poll(offset).toBe(21);
  await page.getByRole('button', { name: `Apply local change ${change + 1}`, exact: true }).click();
  expect(await page.evaluate(id => window.mergerTest!.session.hunks[id].resolved.left, change)).toBe(true);
  await page.locator('#undo').click();
  expect(await page.evaluate(id => window.mergerTest!.session.hunks[id].resolved.left, change)).toBe(false);
  await page.evaluate(() => {
    const merger = window.mergerTest!;
    merger.send({ type: 'edit', edits: [{ offset: 0, length: 0, text: '// more manual lines\n'.repeat(40) }] });
  });
  // A wheel event arrives after the edit's queued model reconciliation.
  await page.evaluate(() => {
    const merger = window.mergerTest!;
    merger.editors[0].setScrollTop(merger.editors[0].getScrollTop() + 21);
  });
  await expect.poll(offset).toBe(41 * 21);
  await page.locator('#undo').click();
  await page.evaluate(() => {
    const editor = window.mergerTest!.editors[0];
    editor.setScrollTop(editor.getScrollTop() + 21);
  });
  await expect.poll(offset).toBe(21);
  await page.setViewportSize({ width: 1000, height: 600 });
  const vertical = await page.evaluate(() => window.mergerTest!.editors.map(editor => editor.getScrollTop()));
  await page.evaluate(() => window.mergerTest!.editors[0].setScrollLeft(20));
  expect(await page.evaluate(() => window.mergerTest!.editors[0].getScrollLeft())).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.mergerTest!.editors.map(editor => editor.getScrollTop()))).toEqual(vertical);
});
