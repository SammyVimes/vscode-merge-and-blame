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
const child = spawn(executable, [repo, `--extensionDevelopmentPath=${process.cwd()}`, '--user-data-dir', path.join(temp, 'profile'), '--extensions-dir', path.join(temp, 'extensions'), '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', `--remote-debugging-port=${port}`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
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
try {
  await until(async () => { try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { return false; } }, 'VS Code debugger');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
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
  await openMerge();
  const getFrame = async () => await until(async () => {
    for (const f of page.frames()) if (await f.locator('#apply-all').count()) return f;
    return undefined;
  }, 'merge webview');
  let frame = await getFrame();
  assert.equal(await frame.locator('.preview-bar').count(), 0, 'sample controls belong only to the standalone browser preview');
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
  await frame.locator('#save').click();
  const expected = `HEADING\n${auto ? '' : '// manual '}unchanged\ncolor(blue, new);\nseparator\nambiguous = local;\nseparator2\nflag=true;\n`;
  await until(async () => (await fs.readFile(file, 'utf8')) === expected, 'saving result');
  assert.ok(run('ls-files', '--unmerged').length, 'save must not stage unresolved Git index');
  await frame.locator('#compare').selectOption('left,base');
  await page.waitForSelector('.monaco-diff-editor', { timeout: 10000 });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+w' : 'Control+w');
  // Close the saved merge, then reopen it from Git's still-unmerged index.
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+w' : 'Control+w');
  await openMerge(); frame = await getFrame();
  await until(async () => (await frame.locator('#status').innerText()).includes('0 unresolved'), 'persisted result and resolution state');
  await page.screenshot({ path: '.reference/extension-host.png' });
  await frame.locator('#complete').click();
  await until(async () => !run('ls-files', '--unmerged').length, 'stage merge result');
  assert.equal(run('show', ':merge.ts'), expected);
  assert.equal(await fs.readFile(file, 'utf8'), expected);
  assert.equal(errors.filter(e => /worker|Content Security Policy|importScripts/i.test(e)).length, 0, errors.join('\n'));
  console.log(`VS Code extension host (auto-apply=${auto}): Git conflict, bulk, wand, arrows, ignore, native undo/redo, save, comparisons, reopen, and staging passed.`);
} catch (error) {
  for (const page of browser?.contexts().flatMap(context => context.pages()) ?? []) {
    await page.screenshot({ path: '.reference/extension-failed.png' }).catch(() => undefined);
  }
  await fs.writeFile('.reference/extension-test.log', output);
  console.error(`Test workspace: ${repo}`);
  throw error;
} finally {
  await browser?.close(); child.kill('SIGKILL');
  await fs.writeFile('.reference/extension-test.log', output);
}
