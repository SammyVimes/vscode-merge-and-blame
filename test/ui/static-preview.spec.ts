import { test, expect } from '@playwright/test';
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';

test('standalone demo loads assets, workers, merge controls and blame below a project path', async ({ page }) => {
  const prefix = '/vscode-merge-and-blame/';
  const root = path.resolve('site');
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url!, 'http://localhost').pathname;
      if (!pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
      const filename = path.resolve(root, decodeURIComponent(pathname.slice(prefix.length)) || 'index.html');
      if (!filename.startsWith(root + path.sep)) { response.writeHead(404).end(); return; }
      const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
      response.setHeader('Content-Type', mime[path.extname(filename)] ?? 'application/octet-stream');
      response.end(await readFile(filename));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  try {
    await page.goto(`http://127.0.0.1:${port}${prefix}?sample=quick`);
    await expect(page).toHaveTitle(/Merge & Blame/);
    await expect(page.getByRole('combobox', { name: 'Preview sample' })).toHaveValue('quick');
    await page.getByRole('button', { name: 'Apply local change 1', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.mergerTest!.session.result)).toContain('name: "local"');
    await page.locator('#left-editor .margin-view-overlays .line-numbers').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Show Git Blame', exact: true }).click();
    await page.locator('#left-editor .blame-row').first().click();
    await expect(page.locator('.commit-diff .line-insert, .commit-diff .char-insert').first()).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
