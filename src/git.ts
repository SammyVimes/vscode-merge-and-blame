import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { MergeInput } from './core/merge';
import type { OperationTimer } from './openingTimings';

const exec = promisify(execFile);
export async function git(root: string, args: string[], input?: string | Buffer): Promise<Buffer> {
  const pending = exec('git', ['-c', 'core.quotepath=false', ...args], { cwd: root, encoding: 'buffer', maxBuffer: 24 * 1024 * 1024, timeout: 15000 });
  pending.child.stdin?.on('error', () => undefined); // Git's exit status carries early stdin failures.
  pending.child.stdin?.end(input);
  const { stdout } = await pending;
  return stdout;
}
export const hash = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
export async function diskHash(file: string): Promise<string> {
  try { return hash(await fs.readFile(file)); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'; throw e; }
}
export interface GitMerge {
  input: MergeInput;
  root: string; relative: string; fingerprint: string; diskHash: string;
  eol: '\n' | '\r\n'; mode: number; bom: boolean;
}
export async function rootFor(file: string): Promise<string> {
  let dir = path.dirname(file);
  while (true) {
    try { await fs.access(dir); break; }
    catch { const parent = path.dirname(dir); if (parent === dir) throw new Error('Cannot find the file directory.'); dir = parent; }
  }
  return (await git(dir, ['rev-parse', '--show-toplevel'])).toString().trimEnd();
}
export async function unmerged(root: string, relative?: string): Promise<string> {
  return (await git(root, ['ls-files', '--unmerged', '--stage', '-z', ...(relative ? ['--', relative] : [])])).toString();
}
export async function conflictFiles(root: string): Promise<string[]> {
  const files = new Set<string>();
  for (const entry of (await unmerged(root)).split('\0')) {
    if (entry) files.add(entry.slice(entry.indexOf('\t') + 1));
  }
  return [...files].map(name => path.join(root, name));
}
const text = (bytes: Buffer): string => {
  if (bytes.includes(0)) throw new Error('Binary files cannot be opened in the text merger.');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('The merger currently supports UTF-8 text files.'); }
};
async function exists(file: string): Promise<boolean> { try { await fs.access(file); return true; } catch { return false; } }

export async function loadMerge(file: string, timing?: OperationTimer): Promise<GitMerge> {
  const measure: OperationTimer['measure'] = timing ? timing.measure.bind(timing) : (_label, operation) => operation();
  const root = await measure('Git root', () => rootFor(file));
  // macOS commonly aliases /var to /private/var. Git reports a physical root;
  // canonicalize the existing parent without following a file-level symlink.
  let parent = path.dirname(file);
  let suffix = path.basename(file);
  while (true) {
    try { parent = await fs.realpath(parent); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      suffix = path.join(path.basename(parent), suffix); parent = path.dirname(parent);
    }
  }
  const relative = path.relative(root, path.join(parent, suffix)).split(path.sep).join('/');
  if (relative.startsWith('../')) throw new Error('File is outside the Git working tree.');
  const index = await measure('Git index stages', () => unmerged(root, relative));
  const stages = new Map<number, { oid: string; mode: string }>();
  for (const entry of index.split('\0').filter(Boolean)) {
    const match = /^(\d+) ([0-9a-f]+) ([123])\t/.exec(entry);
    if (!match) throw new Error('Invalid Git index entry.');
    if (!['100644', '100755'].includes(match[1])) throw new Error('Symlink and submodule conflicts require a different merge tool.');
    stages.set(Number(match[3]), { oid: match[2], mode: match[1] });
  }
  if (!stages.size) throw new Error('This file has no unresolved Git conflict. Use “Resolve Git Conflicts” to select a conflicted file.');
  const read = async (stage: number): Promise<string> => {
    const entry = stages.get(stage);
    return entry ? measure(`Git blob stage ${stage}`, async () => text(await git(root, ['cat-file', 'blob', entry.oid]))) : '';
  };
  const [base, left, right] = await Promise.all([read(1), read(2), read(3)]);
  const gitPath = async (name: string): Promise<string> => measure(`Git operation path ${name}`, async () => (await git(root, ['rev-parse', '--git-path', name])).toString().trimEnd());
  const rebase = await exists(path.resolve(root, await gitPath('rebase-merge'))) || await exists(path.resolve(root, await gitPath('rebase-apply')));
  const cherry = await exists(path.resolve(root, await gitPath('CHERRY_PICK_HEAD')));
  let branch = 'HEAD';
  try { branch = await measure('Git branch label', async () => (await git(root, ['symbolic-ref', '--short', 'HEAD'])).toString().trim()); } catch { /* detached HEAD during rebase */ }
  const leftLabel = rebase ? 'Current · rebased-onto version (ours)' : `Local · ${branch} (ours)`;
  const rightLabel = rebase ? 'Incoming · commit being replayed (theirs)' : cherry ? 'Incoming · cherry-picked commit (theirs)' : 'Incoming · merging version (theirs)';
  let disk = '';
  let mode = [...stages.values()].some(s => s.mode === '100755') ? 0o755 : 0o644;
  let bom = false;
  try {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) throw new Error('Cannot merge through a symbolic link.');
    const bytes = await measure('Read working file', () => fs.readFile(file));
    disk = text(bytes); mode = stat.mode & 0o777;
    bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  return {
    input: { base, left, right, name: path.basename(file), leftLabel, rightLabel, leftDeleted: !stages.has(2), rightDeleted: !stages.has(3) },
    root, relative, fingerprint: hash(index), diskHash: await measure('Hash working file', () => diskHash(file)),
    eol: /\r\n/.test(disk || left || right || base) ? '\r\n' : '\n',
    mode, bom,
  };
}

export async function verifyIndex(meta: GitMerge): Promise<void> {
  if (hash(await unmerged(meta.root, meta.relative)) !== meta.fingerprint) {
    throw new Error('The Git conflict changed outside this editor. Reopen the file before saving or completing the merge.');
  }
}

/** Reuse a single opening's inputs while checking for edits during the UI handoff. */
export async function reuseMerge(file: string, prepared: GitMerge, timing?: OperationTimer): Promise<GitMerge> {
  const measure: OperationTimer['measure'] = timing ? timing.measure.bind(timing) : (_label, operation) => operation();
  const [index, disk, stat] = await Promise.all([
    measure('Verify prepared Git index', () => unmerged(prepared.root, prepared.relative)),
    measure('Verify prepared working file', () => diskHash(file)),
    fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; }),
  ]);
  if (hash(index) === prepared.fingerprint && disk === prepared.diskHash
    && (!stat || stat.isFile() && (stat.mode & 0o777) === prepared.mode)) return prepared;
  return loadMerge(file, timing);
}

export async function saveResult(file: string, meta: GitMerge, result: string, deletion = false): Promise<void> {
  await verifyIndex(meta);
  if (await diskHash(file) !== meta.diskHash) throw new Error('The file changed outside this editor. Reopen it to review those changes before saving.');
  if (deletion) await fs.rm(file, { force: true });
  else {
    await fs.mkdir(path.dirname(file), { recursive: true });
    // Rename a sibling temporary file so a failed write cannot truncate the result.
    const temp = `${file}.three-way-${process.pid}-${Date.now()}`;
    try {
      await fs.writeFile(temp, (meta.bom ? '\uFEFF' : '') + result.replace(/\n/g, meta.eol), { mode: meta.mode, flag: 'wx' });
      await fs.chmod(temp, meta.mode);
      await fs.rename(temp, file);
    } finally { await fs.rm(temp, { force: true }); }
  }
  meta.diskHash = await diskHash(file);
}

export async function completeMerge(file: string, meta: GitMerge, result: string, deletion: boolean): Promise<void> {
  await saveResult(file, meta, result, deletion);
  await verifyIndex(meta);
  await git(meta.root, ['add', '-A', '--', meta.relative]);
}
