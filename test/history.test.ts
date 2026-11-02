import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { git, loadMerge } from '../src/git';
import { blameText, commitDetails, commitFileDiff, decodeGitPath, mergeHistoryTarget, workingHistoryTarget } from '../src/history';

async function repo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'merger-history-test-'));
  await git(root, ['init', '-b', 'main']);
  for (const [key, value] of [['user.name', 'Alice'], ['user.email', 'alice@example.invalid'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) await git(root, ['config', key, value]);
  const filename = 'old name.ts';
  await fs.writeFile(path.join(root, filename), 'alpha\nbeta\ngamma\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'Initial file', '--date=2021-10-20T12:00:00Z']);
  return { root, filename, file: path.join(root, filename), cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

test('blame attributes committed lines to their actual authors, and unsaved changes to no commit', async t => {
  const r = await repo(); t.after(r.cleanup);
  await fs.writeFile(r.file, 'alpha\nchanged beta\ngamma\n');
  await git(r.root, ['commit', '-am', 'Change second line', '--author=Bob <bob@example.invalid>', '--date=2022-03-08T09:30:00Z']);
  const target = await workingHistoryTarget(r.file);
  const blamed = await blameText(target, 'alpha\nchanged beta\nunsaved gamma\n');
  assert.deepEqual(blamed.lines.map(line => line.author), ['Alice', 'Bob', 'Not committed yet']);
  assert.equal(blamed.lines[1].originalLine, 2);
  assert.match(blamed.lines[1].authoredAt, /^2022-03-08/);
  assert.equal(blamed.lines[2].uncommitted, true);
  assert.equal(await fs.readFile(r.file, 'utf8'), 'alpha\nchanged beta\ngamma\n');
});

test('blame follows a rename and opens the original commit with its historical filename', async t => {
  const r = await repo(); t.after(r.cleanup);
  await fs.writeFile(r.file, 'alpha\nchanged beta\ngamma\n');
  await git(r.root, ['commit', '-am', 'Change before rename', '--author=Bob <bob@example.invalid>']);
  const expected = (await git(r.root, ['rev-parse', 'HEAD'])).toString().trim();
  await fs.mkdir(path.join(r.root, 'folder'));
  const renamed = 'folder/renamed\t文件.ts';
  await git(r.root, ['mv', '--', r.filename, renamed]);
  await git(r.root, ['commit', '-m', 'Rename file']);
  const target = await workingHistoryTarget(path.join(r.root, renamed));
  const data = await blameText(target, 'alpha\nchanged beta\ngamma\n');
  assert.equal(data.lines[1].commit, expected);
  assert.equal(data.lines[1].path, r.filename);
  const details = await commitDetails(r.root, data.lines[1].commit);
  const file = details.files.find(file => file.path === data.lines[1].path)!;
  assert.ok(file); assert.equal(details.subject, 'Change before rename');
  const diff = await commitFileDiff(r.root, details, file);
  assert.equal(diff.before, 'alpha\nbeta\ngamma\n');
  assert.equal(diff.after, 'alpha\nchanged beta\ngamma\n');
});

for (const operation of ['merge', 'rebase'] as const) test(`merge-pane blame uses the incoming commit during ${operation}`, async t => {
  const r = await repo(); t.after(r.cleanup);
  await git(r.root, ['switch', '-c', 'incoming']);
  await fs.writeFile(r.file, 'alpha\nincoming beta\ngamma\n');
  await git(r.root, ['commit', '-am', 'Incoming edit', '--author=Incoming Author <incoming@example.invalid>']);
  const incoming = (await git(r.root, ['rev-parse', 'HEAD'])).toString().trim();
  await git(r.root, ['switch', 'main']);
  await fs.writeFile(r.file, 'alpha\nlocal beta\ngamma\n');
  await git(r.root, ['commit', '-am', 'Local edit', '--author=Local Author <local@example.invalid>']);
  if (operation === 'rebase') await git(r.root, ['switch', 'incoming']);
  await assert.rejects(git(r.root, operation === 'merge' ? ['merge', 'incoming'] : ['-c', 'core.editor=true', 'rebase', 'main']));
  const meta = await loadMerge(r.file);
  const target = await mergeHistoryTarget(meta, 'right');
  assert.equal(target.revision, incoming);
  const blame = await blameText(target, meta.input.right);
  assert.equal(blame.lines[1].author, 'Incoming Author');
  assert.equal(blame.lines[1].uncommitted, false);
  const local = await blameText(await mergeHistoryTarget(meta, 'left'), meta.input.left);
  assert.equal(local.lines[1].author, 'Local Author');
});

test('root commits, renamed commit files, binary files, and untracked buffers are supported', async t => {
  const r = await repo(); t.after(r.cleanup);
  const rootHash = (await git(r.root, ['rev-parse', 'HEAD'])).toString().trim();
  const rootCommit = await commitDetails(r.root, rootHash);
  assert.equal(rootCommit.parents.length, 0);
  assert.equal((await commitFileDiff(r.root, rootCommit, rootCommit.files[0])).before, '');
  await git(r.root, ['mv', '--', r.filename, 'renamed.ts']);
  await fs.writeFile(path.join(r.root, 'image.bin'), Buffer.from([0, 1, 2]));
  await git(r.root, ['add', '.']); await git(r.root, ['commit', '-m', 'Rename and binary']);
  const details = await commitDetails(r.root, (await git(r.root, ['rev-parse', 'HEAD'])).toString().trim());
  const renamed = details.files.find(file => file.path === 'renamed.ts')!;
  assert.equal(renamed.oldPath, r.filename);
  const binary = await commitFileDiff(r.root, details, details.files.find(file => file.path === 'image.bin')!);
  assert.equal(binary.binary, true);
  const untracked = await blameText({ root: r.root, path: 'new.ts', revision: details.hash }, 'new content\n');
  assert.equal(untracked.lines.length, 1); assert.equal(untracked.lines[0].uncommitted, true);
});

test('Git C-quoted filenames decode without losing octal UTF-8 or whitespace', () => {
  assert.equal(decodeGitPath('"folder/a\\t\\346\\227\\245\\nfile.ts"'), 'folder/a\t日\nfile.ts');
  assert.equal(decodeGitPath('a file.ts'), 'a file.ts');
});
