import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'merge-integration-test-'));
const repo = path.join(temp, 'repository');
await fs.mkdir(repo);
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
git('init', '-b', 'main'); git('config', 'user.name', 'Merger Test'); git('config', 'user.email', 'test@example.invalid'); git('config', 'commit.gpgsign', 'false');
await fs.writeFile(path.join(repo, 'merge.txt'), 'before\nbase\nafter\n');
git('add', '.'); git('commit', '-m', 'base'); git('switch', '-c', 'incoming');
await fs.writeFile(path.join(repo, 'merge.txt'), 'before\nincoming\nafter\n');
git('commit', '-am', 'incoming'); git('switch', 'main');
await fs.writeFile(path.join(repo, 'merge.txt'), 'before\nlocal\nafter\n');
git('commit', '-am', 'local');
try { git('merge', 'incoming'); } catch { /* expected */ }
for (const [name, text] of Object.entries({ 'normal.txt': 'ordinary text\n', 'base.txt': 'base\n', 'left.txt': 'left\n', 'right.txt': 'right\n', 'result.txt': 'base\n' })) await fs.writeFile(path.join(repo, name), text);
await fs.mkdir(path.join(temp, 'profile', 'User'), { recursive: true });
await fs.writeFile(path.join(temp, 'profile', 'User', 'settings.json'), JSON.stringify({ 'telemetry.telemetryLevel': 'off', 'workbench.startupEditor': 'none', 'mergeEditor.showDeletionMarkers': false }));
const report = path.join(temp, 'result.json');
const env = { ...process.env, MERGER_INTEGRATION_REPO: repo, MERGER_INTEGRATION_REPORT: report }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(process.env.VSCODE_EXECUTABLE || '/Applications/Visual Studio Code.app/Contents/MacOS/Code', [repo,
  `--extensionDevelopmentPath=${process.cwd()}`, `--extensionTestsPath=${path.resolve('scripts/merge-integration-tests.cjs')}`,
  '--user-data-dir', path.join(temp, 'profile'), '--extensions-dir', path.join(temp, 'extensions'),
  '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : [])], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
const timeout = setTimeout(() => child.kill('SIGKILL'), 90000);
try {
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  await fs.mkdir('.reference', { recursive: true });
  await fs.writeFile('.reference/merge-integration-test.log', output);
  const result = JSON.parse(await fs.readFile(report, 'utf8'));
  assert.equal(result.passed, true, JSON.stringify(result));
  assert.equal(code, 0, output.split('\n').slice(-25).join('\n'));
  console.log('VS Code merge integration: normal files, non-Git fallback, redirect after fallback, dirty text, opt-out, and re-enable passed.');
} finally { clearTimeout(timeout); child.kill('SIGKILL'); }
