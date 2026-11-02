import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { completeMerge, conflictFiles, git, loadMerge, saveResult, unmerged } from '../src/git';
import { MergeSession } from '../src/core/merge';

async function repository(): Promise<{ root: string; file: string; clean: () => Promise<void> }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'three-way-git-test-'));
  const file = path.join(root, 'file with spaces.ts');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'merge-test@example.invalid']);
  await git(root, ['config', 'user.name', 'Merge Test']);
  await git(root, ['config', 'commit.gpgsign', 'false']);
  await git(root, ['config', 'core.autocrlf', 'false']);
  await fs.writeFile(file, 'one\nanchor\ntwo\nanchor2\nthree\n');
  await git(root, ['add', '.']); await git(root, ['commit', '-m', 'base']);
  await git(root, ['switch', '-c', 'incoming']);
  await fs.writeFile(file, 'one\nanchor\nTHEIRS\nanchor2\nTHREE\n');
  await git(root, ['commit', '-am', 'incoming']);
  await git(root, ['switch', 'main']);
  await fs.writeFile(file, 'ONE\nanchor\nOURS\nanchor2\nthree\n');
  await git(root, ['commit', '-am', 'local']);
  return { root, file, clean: () => fs.rm(root, { recursive: true, force: true }) };
}

test('loads full Git stages; saves without staging; completes only the chosen file', async t => {
  const repo = await repository(); t.after(repo.clean);
  await assert.rejects(git(repo.root, ['merge', 'incoming']));
  const meta = await loadMerge(repo.file);
  assert.equal(meta.input.base, 'one\nanchor\ntwo\nanchor2\nthree\n');
  assert.match(meta.input.left, /OURS/); assert.match(meta.input.right, /THEIRS/);
  assert.match(meta.input.leftLabel, /main/);
  assert.deepEqual(await conflictFiles(repo.root), [repo.file]);
  const s = new MergeSession(meta.input);
  s.perform({ type: 'bulk' });
  assert.equal(s.result, 'ONE\nanchor\ntwo\nanchor2\nTHREE\n');
  await saveResult(repo.file, meta, s.result);
  assert.ok((await unmerged(repo.root)).length);
  const conflict = s.conflicts[0];
  s.perform({ type: 'apply', id: conflict.id, side: 'left' });
  s.perform({ type: 'ignore', id: conflict.id, side: 'right' });
  await completeMerge(repo.file, meta, s.result, false);
  assert.equal(await fs.readFile(repo.file, 'utf8'), 'ONE\nanchor\nOURS\nanchor2\nTHREE\n');
  assert.equal(await unmerged(repo.root), '');
  assert.equal((await git(repo.root, ['show', ':file with spaces.ts'])).toString(), s.result);
});

test('refuses to overwrite external file edits and changed index stages', async t => {
  const repo = await repository(); t.after(repo.clean);
  await assert.rejects(git(repo.root, ['merge', 'incoming']));
  const meta = await loadMerge(repo.file);
  await fs.writeFile(repo.file, 'external change');
  await assert.rejects(saveResult(repo.file, meta, 'replacement'), /changed outside/);
  assert.equal(await fs.readFile(repo.file, 'utf8'), 'external change');
  await git(repo.root, ['add', '--', path.basename(repo.file)]);
  await assert.rejects(saveResult(repo.file, meta, 'replacement'), /Git conflict changed/);
});

test('labels rebase stage 2 as rebased-onto and stage 3 as replayed commit', async t => {
  const repo = await repository(); t.after(repo.clean);
  await git(repo.root, ['switch', 'incoming']);
  await assert.rejects(git(repo.root, ['-c', 'core.editor=true', 'rebase', 'main']));
  const meta = await loadMerge(repo.file);
  assert.match(meta.input.leftLabel, /rebased-onto/);
  assert.match(meta.input.rightLabel, /replayed/);
  assert.match(meta.input.left, /OURS/); assert.match(meta.input.right, /THEIRS/);
});

test('accepting deleted version removes and stages the file', async t => {
  const repo = await repository(); t.after(repo.clean);
  await git(repo.root, ['rm', '--', path.basename(repo.file)]); await git(repo.root, ['commit', '-m', 'delete']);
  await assert.rejects(git(repo.root, ['merge', 'incoming']));
  const meta = await loadMerge(repo.file);
  assert.equal(meta.input.leftDeleted, true);
  const s = new MergeSession(meta.input);
  s.perform({ type: 'accept', side: 'left' });
  assert.equal(s.deletion, true); assert.equal(s.remaining.length, 0);
  await completeMerge(repo.file, meta, s.result, s.deletion);
  await assert.rejects(fs.access(repo.file));
  assert.equal(await unmerged(repo.root), '');
  assert.equal((await git(repo.root, ['ls-files', '--', path.basename(repo.file)])).toString(), '');
});

test('saving preserves CRLF, UTF-8 BOM, and existing file permissions', async t => {
  const repo = await repository(); t.after(repo.clean);
  await assert.rejects(git(repo.root, ['merge', 'incoming']));
  const disk = await fs.readFile(repo.file, 'utf8');
  await fs.writeFile(repo.file, '\uFEFF' + disk.replace(/\n/g, '\r\n'));
  await fs.chmod(repo.file, 0o600);
  const meta = await loadMerge(repo.file);
  assert.equal(meta.bom, true); assert.equal(meta.eol, '\r\n');
  await saveResult(repo.file, meta, 'merged\ntext\n');
  assert.equal(await fs.readFile(repo.file, 'utf8'), '\uFEFFmerged\r\ntext\r\n');
  assert.equal((await fs.stat(repo.file)).mode & 0o777, 0o600);
});
