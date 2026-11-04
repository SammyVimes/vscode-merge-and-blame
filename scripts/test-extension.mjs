import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'three-way-host-test-'));
await fs.mkdir('.reference', { recursive: true });
const repo = path.join(temp, 'repository');
await fs.mkdir(repo);
const file = path.join(repo, 'merge.ts');
const run = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
run('init', '-b', 'main'); run('config', 'user.name', 'Merger Test'); run('config', 'user.email', 'test@example.invalid'); run('config', 'commit.gpgsign', 'false');
const base = 'heading\nunchanged\ncolor(red, old);\nseparator\nambiguous = old;\nseparator2\nflag=false;\n';
await fs.writeFile(file, base); run('add', '.'); run('commit', '-m', 'base'); run('switch', '-c', 'incoming');
await fs.writeFile(file, base.replace('red, old', 'red, new').replace('= old;', '= incoming;').replace('flag=false', 'flag=true'));
run('commit', '-am', 'incoming'); run('switch', 'main');
await fs.writeFile(file, base.replace('heading', 'HEADING').replace('red, old', 'blue, old').replace('= old;', '= local;'));
run('commit', '-am', 'local');
try { run('merge', 'incoming'); } catch { /* expected */ }
const server = net.createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const executable = process.env.VSCODE_EXECUTABLE || '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
const auto = process.env.MERGER_TEST_AUTO === '1';
await fs.mkdir(path.join(temp, 'profile', 'User'), { recursive: true });
await fs.writeFile(path.join(temp, 'profile', 'User', 'settings.json'), JSON.stringify({ 'telemetry.telemetryLevel': 'off', 'workbench.startupEditor': 'none', 'workbench.secondarySideBar.defaultVisibility': 'hidden', 'threeWayMerger.autoApplyNonConflicting': auto }));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, [repo, `--extensionDevelopmentPath=${process.cwd()}`, '--user-data-dir', path.join(temp, 'profile'), '--extensions-dir', path.join(temp, 'extensions'), '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', `--remote-debugging-port=${port}`, ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : [])], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d);
child.on('error', error => { output += error.message; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, description) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const result = await fn(); if (result) return result;
    if (child.exitCode !== null) throw new Error(`VS Code exited: ${output}`);
    await pause(200);
  }
  throw new Error(`Timed out: ${description}`);
}
let browser;
let originalClipboard;
try {
  await until(async () => { try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { return false; } }, 'VS Code debugger');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  // Used by the test driver to inspect the system clipboard. Shortcuts still
  // travel through VS Code's webview command forwarding, as in normal use.
  await browser.contexts()[0].grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await until(async () => browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('workbench')), 'workbench page');
  page.setDefaultTimeout(20000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.waitForSelector('.monaco-workbench', { timeout: 45000 });
  await pause(1500);
  const openMerge = async () => {
    // After closing a webview, focus the workbench before sending a shortcut;
    // CDP can otherwise keep its keyboard target on the detached iframe.
    const quickAccess = page.getByRole('button', { name: 'Open Quick Access', exact: true });
    if (await quickAccess.isVisible()) await quickAccess.click();
    else {
      await page.locator('.monaco-workbench').click({ position: { x: 600, y: 300 } });
      await page.keyboard.press('F1');
    }
    const input = page.locator('.quick-input-widget input');
    await input.waitFor({ state: 'visible' });
    await input.fill('>Merge & Blame: Resolve Git Conflicts');
    const command = page.locator('.quick-input-widget .monaco-list-row').filter({ hasText: 'Merge & Blame: Resolve Git Conflicts' });
    await command.first().waitFor({ state: 'visible' });
    await input.press('Enter');
    const fileOption = page.locator('.quick-input-widget .monaco-list-row').filter({ hasText: 'merge.ts' });
    await fileOption.first().waitFor({ state: 'visible' });
    await fileOption.first().click();
  };
  // Start in the ordinary text editor and use Git's actual built-in button.
  // The extension must activate on startup, without opening one of our commands.
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+p' : 'Control+p');
  const fileInput = page.locator('.quick-input-widget input');
  await fileInput.waitFor({ state: 'visible' });
  await fileInput.fill(file);
  await page.locator('.quick-input-widget .monaco-list-row').filter({ hasText: 'merge.ts' }).first().waitFor({ state: 'visible' });
  await fileInput.press('Enter');
  const nativeMergeButton = page.getByRole('button', { name: 'Resolve in Merge Editor', exact: true });
  await nativeMergeButton.waitFor({ state: 'visible' });
  await nativeMergeButton.click();
  const getFrame = async () => await until(async () => {
    for (const f of page.frames()) if (await f.locator('#apply-all').isVisible().catch(() => false)) return f;
    return undefined;
  }, 'merge webview');
  let frame = await getFrame();
  assert.equal(await frame.locator('.preview-bar').count(), 0, 'sample controls belong only to the standalone browser preview');
  originalClipboard = await page.evaluate(() => navigator.clipboard.readText());
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  const selectLine = async (pane, text) => {
    await frame.locator(`#${pane}-editor .view-line`).filter({ hasText: text }).first().click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
  };
  // Monaco recycles absolutely positioned line nodes, so DOM order can differ
  // from the displayed order after inserting multiple lines.
  const resultText = () => frame.locator('#result-editor .view-line').evaluateAll(lines => lines
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
    .map(line => line.textContent.replace(/\u00a0/g, ' ')).join('\n'));
  const beforeClipboard = await resultText();
  for (const [pane, text] of [['left', 'HEADING'], ['result', auto ? 'HEADING' : 'heading'], ['right', 'heading']]) {
    await page.evaluate(() => navigator.clipboard.writeText('clipboard sentinel'));
    await selectLine(pane, text);
    await page.keyboard.press(`${modifier}+c`);
    await until(async () => await page.evaluate(() => navigator.clipboard.readText()) === text, `copy from ${pane} pane`);
  }
  const pasted = '// clipboard 🐙\n// second line';
  await page.evaluate(text => navigator.clipboard.writeText(text), pasted);
  await selectLine('result', auto ? 'HEADING' : 'heading');
  await page.keyboard.press(`${modifier}+v`);
  await until(async () => (await resultText()).includes(pasted), 'paste Unicode and multiple lines into result pane');
  await frame.locator('#undo').click();
  await until(async () => await resultText() === beforeClipboard, 'undo paste through custom document history');
  await frame.locator('#redo').click();
  await until(async () => (await resultText()).includes(pasted), 'redo paste through custom document history');
  await frame.locator('#undo').click();
  await until(async () => await resultText() === beforeClipboard, 'restore result after paste test');
  await selectLine('result', auto ? 'HEADING' : 'heading');
  await page.keyboard.press(`${modifier}+x`);
  await until(async () => await page.evaluate(() => navigator.clipboard.readText()) === (auto ? 'HEADING' : 'heading')
    && await resultText() !== beforeClipboard, 'cut result selection');
  await frame.locator('#undo').click();
  await until(async () => await resultText() === beforeClipboard, 'undo cut through custom document history');
  if (auto) {
    await until(async () => (await frame.locator('#status').innerText()).includes('2 unresolved'), 'automatic initial merge');
    await frame.locator('#undo').click();
    await until(async () => (await frame.locator('#status').innerText()).includes('4 unresolved'), 'undo automatic initial merge');
    await frame.locator('#redo').click();
  } else {
    await until(async () => (await frame.locator('#status').innerText()).includes('4 unresolved'), 'initial merge state');
    // Exercise real webview typing and asynchronous host acknowledgements.
    await frame.locator('#result-editor .view-line').filter({ hasText: 'unchanged' }).first().click();
    await page.keyboard.press('Home');
    await page.keyboard.insertText('// manual ');
    await until(async () => (await frame.locator('#result-editor').innerText()).replace(/\u00a0/g, ' ').includes('// manual unchanged'), 'manual result edit');
    await frame.locator('#apply-all').click();
  }
  await until(async () => (await frame.locator('#status').innerText()).includes('2 unresolved'), 'bulk resolution');
  if (auto) await frame.locator('#magic').click();
  else await frame.getByRole('button', { name: 'Resolve simple conflict 2', exact: true }).click();
  await until(async () => (await frame.locator('#status').innerText()).includes('1 unresolved'), 'magic resolution');
  await frame.getByRole('button', { name: 'Apply local change 3', exact: true }).click();
  await frame.getByRole('button', { name: 'Ignore incoming change 3', exact: true }).click();
  await until(async () => (await frame.locator('#status').innerText()).includes('0 unresolved'), 'all resolved');
  await frame.locator('#undo').click();
  await until(async () => (await frame.locator('#status').innerText()).includes('1 unresolved'), 'VS Code custom document undo');
  await frame.locator('#redo').click();
  await until(async () => (await frame.locator('#status').innerText()).includes('0 unresolved'), 'VS Code custom document redo');
  const expected = `HEADING\n${auto ? '' : '// manual '}unchanged\ncolor(blue, new);\nseparator\nambiguous = local;\nseparator2\nflag=true;\n`;
  // Reloading the webview reuses its HTML, whose embedded initial state is now
  // stale. It must request the current unsaved text AND resolution state.
  await frame.evaluate(() => { window.__reloadSentinel = true; });
  const quickAccess = page.getByRole('button', { name: 'Open Quick Access', exact: true });
  await quickAccess.click();
  const reloadInput = page.locator('.quick-input-widget input');
  await reloadInput.fill('>Developer: Reload Webviews');
  await page.locator('.quick-input-widget .monaco-list-row').filter({ hasText: 'Reload Webviews' }).first().waitFor({ state: 'visible' });
  await reloadInput.press('Enter');
  frame = await until(async () => {
    for (const candidate of page.frames()) if (await candidate.locator('#apply-all').isVisible().catch(() => false)
      && await candidate.evaluate(() => !window.__reloadSentinel).catch(() => false)) return candidate;
  }, 'reloaded merge webview');
  await until(async () => (await frame.locator('#status').innerText()).includes('0 unresolved'), 'unsaved resolutions after webview reload');
  assert.ok((await frame.locator('#result-editor').innerText()).replace(/\u00a0/g, ' ').includes(auto ? 'unchanged' : '// manual unchanged'), 'unsaved text survives stale HTML reload');
  assert.ok(await frame.evaluate(() => window.__mergeOpening.marks.some(mark => mark.label === 'Webview reload: requesting current host state')), 'stale embedded state is skipped on reload');
  await frame.locator('#save').click();
  await until(async () => (await fs.readFile(file, 'utf8')) === expected, 'saving result');
  assert.ok(run('ls-files', '--unmerged').length, 'save must not stage unresolved Git index');
  await frame.locator('#compare').selectOption('left,base');
  await page.waitForSelector('.monaco-diff-editor', { timeout: 10000 });
  const closeActiveTab = async () => {
    const tab = page.locator('.tabs-container .tab.active');
    await tab.hover();
    await tab.locator('.tab-actions .action-label').first().click();
  };
  await closeActiveTab();
  await page.locator('.monaco-diff-editor').waitFor({ state: 'hidden' });
  // Close the saved merge, then reopen it from Git's still-unmerged index.
  await closeActiveTab();
  await until(() => frame.isDetached(), 'saved merge webview closed');
  // A pre-Marketplace installation stores this session under the old extension
  // ID. Reopening through our picker also switches /var to /private/var on macOS.
  const workspaceStorage = path.join(temp, 'profile', 'User', 'workspaceStorage');
  let migratedCache = false;
  for (const entry of await fs.readdir(workspaceStorage, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const storage = path.join(workspaceStorage, entry.name);
    const current = path.join(storage, 'SemyonDanilov.merge-and-blame');
    if (await fs.stat(current).then(() => true, () => false)) {
      await fs.rename(current, path.join(storage, 'vscode-diff.three-way-merger'));
      migratedCache = true;
    }
  }
  assert.ok(migratedCache, 'saved session should exist before testing legacy storage migration');
  await openMerge(); frame = await getFrame();
  await until(async () => (await frame.locator('#status').innerText()).includes('0 unresolved'), 'persisted result and resolution state');
  await page.screenshot({ path: '.reference/extension-host.png' });
  await frame.locator('#complete').click();
  await until(async () => !run('ls-files', '--unmerged').length, 'stage merge result');
  assert.equal(run('show', ':merge.ts'), expected);
  assert.equal(await fs.readFile(file, 'utf8'), expected);
  assert.equal(errors.filter(e => /worker|Content Security Policy|importScripts/i.test(e)).length, 0, errors.join('\n'));
  console.log(`VS Code extension host (auto-apply=${auto}): native Resolve in Merge Editor button, clipboard shortcuts in all panes, cut/paste undo/redo, Git conflict, bulk, wand, arrows, ignore, native undo/redo, save, comparisons, reopen, and staging passed.`);
} catch (error) {
  for (const page of browser?.contexts().flatMap(context => context.pages()) ?? []) {
    await page.screenshot({ path: '.reference/extension-failed.png' }).catch(() => undefined);
    await fs.writeFile('.reference/extension-failed.html', await page.content()).catch(() => undefined);
  }
  await fs.writeFile('.reference/extension-test.log', output);
  console.error(`Test workspace: ${repo}`);
  throw error;
} finally {
  if (originalClipboard !== undefined) {
    const page = browser?.contexts().flatMap(context => context.pages()).find(page => page.url().includes('workbench'));
    await page?.evaluate(text => navigator.clipboard.writeText(text), originalClipboard).catch(() => undefined);
  }
  await browser?.close(); child.kill('SIGKILL');
  await fs.writeFile('.reference/extension-test.log', output);
}
