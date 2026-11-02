import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'three-way-blame-test-'));
await fs.mkdir('.reference', { recursive: true });
const repo = path.join(temp, 'repository');
await fs.mkdir(repo);
const run = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
run('init', '-b', 'main'); run('config', 'user.name', 'Merger Test'); run('config', 'user.email', 'test@example.invalid'); run('config', 'commit.gpgsign', 'false');
const historical = 'original name.ts';
const blameFile = path.join(repo, 'history.ts');
const tailLines = 2000;
const initialHistory = '\uFEFFconst first = 1;\r\nconst second = 2;\r\nconst third = 3;\r\n\r\n' + Array.from({ length: tailLines }, (_, i) => `const tail${i} = ${i};\r\n`).join('');
await fs.writeFile(path.join(repo, historical), initialHistory);
await fs.writeFile(path.join(repo, 'README.md'), 'First version\n');
run('add', '.'); run('commit', '-m', 'Create history fixture', '--author=Alice <alice@example.invalid>');
const historyText = initialHistory.replace('second = 2', 'second = 20');
await fs.writeFile(path.join(repo, historical), historyText);
await fs.writeFile(path.join(repo, 'README.md'), 'Second version\n');
run('commit', '-am', 'Change two files', '--author=Bob <bob@example.invalid>');
const blamedCommit = run('rev-parse', 'HEAD').trim();
run('mv', historical, 'history.ts'); run('commit', '-m', 'Rename history file');
const server = net.createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const executable = process.env.VSCODE_EXECUTABLE || '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
const legacy = process.env.MERGER_TEST_LEGACY === '1';
const fallbackCommit = process.env.MERGER_TEST_FALLBACK_COMMIT === '1';
const cli = process.env.VSCODE_CLI || (process.platform === 'darwin' ? path.join(path.dirname(executable), '../Resources/app/bin/code') : 'code');
const install = (vsix) => execFileSync(cli, ['--user-data-dir', path.join(temp, 'profile'), '--extensions-dir', path.join(temp, 'extensions'), '--install-extension', vsix, '--force'], { encoding: 'utf8', timeout: 60000 });
await fs.mkdir(path.join(temp, 'profile', 'User'), { recursive: true });
await fs.writeFile(path.join(temp, 'profile', 'User', 'settings.json'), JSON.stringify({ 'telemetry.telemetryLevel': 'off', 'window.menuStyle': 'custom', 'window.dialogStyle': 'custom', 'update.mode': 'none', 'workbench.startupEditor': 'none', 'workbench.secondarySideBar.defaultVisibility': 'hidden' }));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
if (legacy) install(path.resolve(process.env.MERGER_TEST_LEGACY_VSIX || 'three-way-merger-0.2.1.vsix'));
const child = spawn(executable, [repo, ...(legacy ? [] : [`--extensionDevelopmentPath=${process.cwd()}`]), ...(fallbackCommit ? ['--disable-extension=vscode.git'] : []), '--user-data-dir', path.join(temp, 'profile'), '--extensions-dir', path.join(temp, 'extensions'), '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', `--remote-debugging-port=${port}`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
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
  await page.getByText('history.ts', { exact: true }).first().dblclick();
  await page.locator('.editor-instance .monaco-editor .view-line').filter({ hasText: 'const third' }).first().click();
  await page.keyboard.press('Home'); await page.keyboard.insertText('// preexisting ');
  const historyBuffer = historyText.replace('const third', '// preexisting const third');
  // Custom host menus make the native gutter entry testable through CDP.
  await page.locator('.editor-instance .monaco-editor .line-numbers').filter({ hasText: /^2$/ }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Show Git Blame/ }).click();
  // Monaco's host menu may focus the action on the first synthetic click.
  if (await page.getByRole('menuitem', { name: /Show Git Blame/ }).isVisible()) await page.keyboard.press('Enter');
  if (legacy) {
    await until(async () => { for (const frame of page.frames()) if (await frame.locator('#file-editor').count()) return true; }, 'old annotation renderer');
    const manifest = JSON.parse(await fs.readFile('package.json', 'utf8'));
    install(path.resolve(`${manifest.name}-${manifest.version}.vsix`));
    if (`${manifest.publisher}.${manifest.name}` !== 'vscode-diff.three-way-merger') {
      execFileSync(cli, ['--user-data-dir', path.join(temp, 'profile'), '--extensions-dir', path.join(temp, 'extensions'), '--uninstall-extension', 'vscode-diff.three-way-merger', '--force'], { encoding: 'utf8', timeout: 60000 });
    }
    await page.getByRole('button', { name: 'Open Quick Access', exact: true }).click();
    const input = page.locator('.quick-input-widget input');
    await input.fill('>Developer: Reload Window');
    await page.locator('.quick-input-widget .monaco-list-row').filter({ hasText: 'Developer: Reload Window' }).first().waitFor({ state: 'visible' });
    await input.press('Enter');
    await until(async () => {
      try {
        for (const frame of page.frames()) if (await frame.locator('#file-editor').count()) return false;
        return await page.locator('.editor-instance .monaco-editor .view-line').filter({ hasText: 'const second' }).isVisible();
      } catch { return false; }
    }, 'upgrade restores native editor');
    assert.equal(await page.getByText(/The restored file .* already has a different encoding/).count(), 0, 'successful encoding restoration must not warn');
  }
  const native = page.locator('.editor-instance .monaco-editor').first();
  // Monaco reuses view-line DOM nodes without keeping DOM order after edits.
  // Match the code row to its actual line-number geometry.
  const renderedLine = async (line) => native.evaluate((editor, number) => {
    const gutter = [...editor.querySelectorAll('.line-numbers')].find(node => Number(node.textContent) === number);
    if (!gutter) return { text: '', annotation: '' };
    const top = gutter.getBoundingClientRect().top;
    const element = [...editor.querySelectorAll('.view-line')].find(node => Math.abs(node.getBoundingClientRect().top - top) < 1);
    if (!element) return { text: '', annotation: '' };
    return { text: element.textContent.replace(/\u00a0/g, ' '), annotation: [...element.querySelectorAll('span')].map(span => getComputedStyle(span, '::before').content).filter(value => value !== 'none' && value !== 'normal').join(' ') };
  }, line);
  const annotation = async (line) => (await renderedLine(line)).annotation;
  const firstRenderedLine = async () => native.locator('.line-numbers').evaluateAll(nodes => Math.min(...nodes.map(node => Number(node.textContent)).filter(Number.isFinite)));
  const center = async (locator) => {
    const box = await until(() => locator.boundingBox(), 'native code geometry');
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const secondSymbol = native.locator('.view-lines .view-line').getByText('second', { exact: true });
  await until(async () => (await annotation(2)).includes('Bob'), 'actual Git author in native decoration');
  assert.ok((await annotation(4)).includes('Alice'), 'empty code lines receive aligned annotations');
  assert.equal(await page.locator('.tabs-container .tab').count(), 1, 'blame must reuse the existing file tab');
  assert.ok((await page.locator('.tabs-container .tab').innerText()).includes('history.ts'), 'tab keeps filename');
  assert.ok((await native.innerText()).replace(/\u00a0/g, ' ').includes('// preexisting const third'), 'showing blame preserves unsaved edits');
  assert.equal(await fs.readFile(blameFile, 'utf8'), historyText, 'showing blame must not write the file');
  for (const candidate of page.frames()) assert.equal(await candidate.locator('#file-editor').count(), 0, 'ordinary blame must not use a replacement editor');
  // Simulate extension-host latency while jumping well outside the initial
  // viewport. New lines must already have annotations, before any host reply.
  const stopped = [];
  if (process.platform === 'darwin') {
    const processes = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n').map(row => /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(row)).filter(Boolean).map(match => ({ pid: Number(match[1]), parent: Number(match[2]), command: match[3] }));
    const children = new Set([child.pid]);
    for (let size = 0; size !== children.size;) { size = children.size; for (const entry of processes) if (children.has(entry.parent)) children.add(entry.pid); }
    const hosts = processes.filter(entry => children.has(entry.pid) && entry.command.includes('/Code Helper (Plugin).app/'));
    assert.ok(hosts.length, 'isolated test extension host identified');
    for (const host of hosts) { process.kill(host.pid, 'SIGSTOP'); stopped.push(host.pid); }
  }
  try {
    await native.locator('.line-numbers').first().click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
    await until(async () => await firstRenderedLine() > tailLines - 60, 'native editor jumps to end without extension-host work');
    assert.ok((await annotation(tailLines + 4)).includes('Alice'), 'distant annotations are installed before scrolling');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
    await until(async () => await firstRenderedLine() === 1, 'native editor returns to top');
    assert.ok((await annotation(2)).includes('Bob'), 'original annotations remain installed too');
  } finally { for (const pid of stopped) process.kill(pid, 'SIGCONT'); }
  // Native decoration hovers are attached to the blamed code line.
  // Locator click/hover's scrollIntoView can scroll Monaco's DOM independently
  // of its own viewport state. Use real pointer coordinates on visible code.
  const symbol = await center(secondSymbol);
  await page.mouse.click(symbol.x, symbol.y);
  await page.mouse.move(1200, 500);
  await page.mouse.move(symbol.x, symbol.y);
  const commitLink = page.getByRole('link', { name: 'Open commit', exact: true });
  await commitLink.waitFor({ state: 'visible' });
  await page.locator('.monaco-hover:visible').filter({ hasText: 'const second' }).first().waitFor({ state: 'visible' });
  const authorPosition = await native.evaluate(editor => {
    const span = [...editor.querySelectorAll('.view-line span')].find(node => getComputedStyle(node, '::before').content.includes('Bob'));
    const box = span.getBoundingClientRect(); return { x: box.left + 35, y: box.top + box.height / 2 };
  });
  await page.mouse.move(1200, 500);
  await page.mouse.move(authorPosition.x, authorPosition.y);
  await commitLink.waitFor({ state: 'visible' });
  await commitLink.click();
  if (fallbackCommit) {
    const commitFrame = await until(async () => {
      for (const candidate of page.frames()) if (await candidate.locator('.commit-view').count()) return candidate;
    }, 'commit inspector');
    await until(async () => await commitFrame.locator('.commit-view').getAttribute('data-selected-path') === historical, 'historical filename selected');
    assert.equal(await commitFrame.locator('.commit-view').getAttribute('data-commit'), blamedCommit);
    assert.ok((await commitFrame.locator('.commit-subject').innerText()).includes('Change two files'));
    assert.equal(await commitFrame.locator('.commit-file').count(), 2);
    assert.ok((await commitFrame.locator('.commit-file[aria-current="true"]').innerText()).includes(historical));
    await commitFrame.locator('.commit-diff .char-delete, .commit-diff .line-delete').first().waitFor({ state: 'visible' });
    await commitFrame.locator('.commit-diff .char-insert, .commit-diff .line-insert').first().waitFor({ state: 'visible' });
    assert.ok((await commitFrame.locator('.commit-diff').innerText()).replace(/\u00a0/g, ' ').includes('const second = 2;'), 'fallback shows removed content');
    assert.equal(await commitFrame.locator('.commit-diff .scrollbar.vertical:visible').count(), 1, 'one vertical diff scrollbar');
    await page.screenshot({ path: '.reference/commit-fallback-host.png' });
    await commitFrame.getByRole('button', { name: 'Close commit' }).click();
  } else {
    const commit = page.locator('.multiDiffEditor');
    await commit.waitFor({ state: 'visible' });
    await until(async () => (await commit.innerText()).includes(historical), 'native commit reveals historical filename');
    await until(async () => (await commit.innerText()).replace(/\u00a0/g, ' ').includes('const second = 2;'), 'native diff shows parent content');
    await until(async () => (await commit.locator('.multiDiffEntry.active').innerText()).includes(historical), 'blamed file receives native focus');
    assert.ok((await commit.innerText()).replace(/\u00a0/g, ' ').includes('const second = 20;'), 'native diff shows committed content');
    assert.ok((await page.locator('.tabs-container .tab.active').innerText()).includes('Change two files'), 'native commit title');
    for (const candidate of page.frames()) assert.equal(await candidate.locator('.commit-view').count(), 0, 'built-in Git uses VS Code commit view');
    await page.screenshot({ path: '.reference/commit-host.png' });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+w' : 'Control+w');
  }
  const editableSymbol = await center(secondSymbol);
  await page.mouse.click(editableSymbol.x, editableSymbol.y);
  await page.keyboard.press('Home'); await page.keyboard.insertText('// unsaved ');
  await until(async () => (await annotation(2)).includes('Not committed'), 'unsaved lines reannotated');
  assert.equal(await fs.readFile(blameFile, 'utf8'), historyText, 'annotation updates must not save edits');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
  await until(async () => (await fs.readFile(blameFile, 'utf8')) === historyBuffer.replace('const second', '// unsaved const second'), 'native file save including BOM/CRLF');
  // Preserve VS Code's own undo grouping. Its native EditContext may split a
  // synthetic text insertion into several word/space undo units.
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await pause(40);
    const line = (await renderedLine(2)).text;
    if (line.trim() === 'const second = 20;') break;
  }
  await until(async () => (await annotation(2)).includes('Bob'), 'native document undo updates blame');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
  await until(async () => (await fs.readFile(blameFile, 'utf8')) === historyBuffer, 'saving native undo');
  // A commit changes history without changing the open document's text.
  if (!fallbackCommit) {
    run('add', '.'); run('commit', '-m', 'Commit preexisting edit', '--author=Carol <carol@example.invalid>');
    await until(async () => (await annotation(3)).includes('Carol'), 'commit refresh without a text edit');
  }
  await page.screenshot({ path: '.reference/blame-host.png' });
  await native.hover({ position: { x: 650, y: 300 } });
  await page.keyboard.press('PageDown');
  await page.keyboard.press('PageDown');
  await until(async () => { const first = await firstRenderedLine(); const last = await native.locator('.line-numbers').evaluateAll(nodes => Math.max(...nodes.map(node => Number(node.textContent)).filter(Number.isFinite))); return first > 30 && (await annotation(last)).includes('Alice'); }, 'native scroll refreshes annotations');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  await until(async () => await firstRenderedLine() === 1 && (await annotation(2)).includes('Bob'), 'return to original lines');
  await native.locator('.line-numbers').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Hide Git Blame/ }).click();
  if (await page.getByRole('menuitem', { name: /Hide Git Blame/ }).isVisible()) await page.keyboard.press('Enter');
  await until(async () => !(await annotation(2)).includes('Bob'), 'hiding native decorations');
  assert.equal(await page.locator('.tabs-container .tab').count(), 1, 'hiding blame must reuse the same tab too');
  assert.equal(errors.filter(e => /worker|Content Security Policy|importScripts/i.test(e)).length, 0, errors.join('\n'));
  console.log(`VS Code Git blame (upgrade=${legacy}, fallbackCommit=${fallbackCommit}): native editor retained, annotations survive scrolling with a paused extension host, gutter show/hide, author hover link, commit diff, renamed file selection, unsaved edits, undo, and BOM/CRLF save passed.`);
} catch (error) {
  for (const page of browser?.contexts().flatMap(context => context.pages()) ?? []) {
    await page.screenshot({ path: '.reference/blame-failed.png' }).catch(() => undefined);
    await fs.writeFile('.reference/blame-failed.html', await page.content()).catch(() => undefined);
  }
  await fs.writeFile('.reference/blame-test.log', output);
  console.error(`Test workspace: ${repo}`);
  throw error;
} finally {
  await browser?.close(); child.kill('SIGKILL');
  await fs.writeFile('.reference/blame-test.log', output);
}
