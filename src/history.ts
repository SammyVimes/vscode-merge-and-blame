import { git, rootFor, type GitMerge } from './git';
import { normalize } from './core/diff';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

export interface BlameLine {
  commit: string;
  author: string;
  email: string;
  authoredAt: string;
  summary: string;
  originalLine: number;
  line: number;
  path: string;
  uncommitted: boolean;
}
export interface BlameData { lines: BlameLine[]; revision: string; path: string }
export interface HistoryTarget { root: string; path: string; revision: string }
export interface CommitFile { path: string; oldPath?: string; status: string }
export interface CommitDetails {
  hash: string; parents: string[]; author: string; email: string; authoredAt: string;
  subject: string; message: string; files: CommitFile[];
}
export interface CommitFileDiff { file: CommitFile; before: string; after: string; binary: boolean }

const fullHash = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
export const isCommitHash = (value: string): boolean => fullHash.test(value) && !/^0+$/.test(value);
const decode = (value: Buffer): string => new TextDecoder('utf-8', { fatal: true }).decode(value);

/** Decode Git's C-quoted filenames, including octal UTF-8 bytes. */
export function decodeGitPath(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) return value;
  const body = value.slice(1, -1);
  const parts: Buffer[] = [];
  const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', a: '\x07', '\\': '\\', '"': '"' };
  for (let i = 0; i < body.length;) {
    if (body[i] !== '\\') {
      const point = String.fromCodePoint(body.codePointAt(i)!); parts.push(Buffer.from(point)); i += point.length;
    } else {
      const octal = /^[0-7]{1,3}/.exec(body.slice(i + 1));
      if (octal) { parts.push(Buffer.from([parseInt(octal[0], 8)])); i += octal[0].length + 1; }
      else { parts.push(Buffer.from(escapes[body[i + 1]] ?? body[i + 1] ?? '\\')); i += 2; }
    }
  }
  return Buffer.concat(parts).toString('utf8');
}

export function parseBlamePorcelain(output: string): BlameLine[] {
  const result: BlameLine[] = [];
  const commits = new Map<string, Record<string, string>>();
  let current: { hash: string; original: number; line: number; metadata: Record<string, string> } | undefined;
  for (const line of output.split('\n')) {
    const header = /^([0-9a-f]{40}(?:[0-9a-f]{24})?) (\d+) (\d+)(?: \d+)?$/.exec(line);
    if (header) {
      const hash = header[1];
      current = { hash, original: Number(header[2]), line: Number(header[3]), metadata: { ...commits.get(hash) } };
    } else if (current && line.startsWith('\t')) {
      const info = current.metadata;
      const uncommitted = /^0+$/.test(current.hash);
      const timestamp = Number(info['author-time']);
      result.push({
        commit: current.hash, author: uncommitted ? 'Not committed yet' : info.author ?? 'Unknown author',
        email: (info['author-mail'] ?? '').replace(/^<|>$/g, ''),
        authoredAt: Number.isFinite(timestamp) ? new Date(timestamp * 1000).toISOString() : '',
        summary: uncommitted ? 'Uncommitted changes' : info.summary ?? '',
        originalLine: current.original, line: current.line, path: decodeGitPath(info.filename ?? ''), uncommitted,
      });
      commits.set(current.hash, info); current = undefined;
    } else if (current) {
      const separator = line.indexOf(' ');
      if (separator > 0) current.metadata[line.slice(0, separator)] = line.slice(separator + 1);
    }
  }
  return result;
}

async function revision(root: string, ref: string): Promise<string | undefined> {
  try { return (await git(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).toString().trim(); }
  catch { return undefined; }
}
async function blobAt(root: string, rev: string, filename: string): Promise<Buffer | undefined> {
  if (!isCommitHash(rev)) return undefined;
  try { return await git(root, ['show', `${rev}:${filename}`]); } catch { return undefined; }
}
function newLines(text: string, filename: string): BlameLine[] {
  const rows = normalize(text).split('\n');
  if (rows.at(-1) === '') rows.pop();
  return rows.map((_, i) => ({ commit: '0'.repeat(40), author: 'Not committed yet', email: '', authoredAt: '', summary: 'Uncommitted changes', originalLine: i + 1, line: i + 1, path: filename, uncommitted: true }));
}

export async function workingHistoryTarget(filename: string): Promise<HistoryTarget> {
  const root = await rootFor(filename);
  const actualParent = await fs.realpath(path.dirname(filename));
  const relative = path.relative(root, path.join(actualParent, path.basename(filename))).split(path.sep).join('/');
  return { root, path: relative, revision: await revision(root, 'HEAD') ?? '' };
}

/** Attribute precisely the text on screen, without writing it to the worktree. */
export async function blameText(target: HistoryTarget, text: string): Promise<BlameData> {
  const original = await blobAt(target.root, target.revision, target.path);
  if (!original) return { path: target.path, revision: target.revision, lines: newLines(text, target.path) };
  const originalText = decode(original);
  const normalized = normalize(text).replace(/^\uFEFF/, '');
  const options = ['blame', '--line-porcelain', '-M'];
  let contents: string | undefined;
  if (normalize(originalText) !== normalized) {
    const bom = original[0] === 0xef && original[1] === 0xbb && original[2] === 0xbf ? '\uFEFF' : '';
    contents = bom + normalized.replace(/\n/g, /\r\n/.test(originalText) ? '\r\n' : '\n');
    options.push('--contents', '-');
  }
  options.push(target.revision, '--', target.path);
  const lines = parseBlamePorcelain((await git(target.root, options, contents)).toString('utf8'));
  return { path: target.path, revision: target.revision, lines };
}

async function matchingTarget(root: string, rev: string, filename: string, text: string): Promise<HistoryTarget | undefined> {
  const bytes = await blobAt(root, rev, filename);
  if (bytes && normalize(decode(bytes)) === normalize(text)) return { root, path: filename, revision: rev };
  // A merge may refer to a path that was renamed on one of its sides. Prefer an
  // exact blob match, and never guess between multiple identical files.
  const wanted = (await git(root, ['hash-object', '--stdin'], text)).toString().trim();
  const matches = (await git(root, ['ls-tree', '-r', '-z', rev])).toString('utf8').split('\0').filter(entry => entry.split('\t')[0].endsWith(` ${wanted}`));
  if (matches.length === 1) return { root, path: matches[0].slice(matches[0].indexOf('\t') + 1), revision: rev };
  return undefined;
}

export async function mergeHistoryTarget(meta: GitMerge, pane: 'left' | 'result' | 'right'): Promise<HistoryTarget> {
  const head = await revision(meta.root, 'HEAD') ?? '';
  if (pane !== 'right') return { root: meta.root, path: meta.relative, revision: head };
  for (const ref of ['REBASE_HEAD', 'CHERRY_PICK_HEAD', 'MERGE_HEAD', 'REVERT_HEAD^', 'refs/stash']) {
    const sha = await revision(meta.root, ref);
    if (!sha) continue;
    const target = await matchingTarget(meta.root, sha, meta.relative, meta.input.right);
    if (target) return target;
  }
  // If Git supplied a synthesized/uncommitted side, show that honestly as
  // uncommitted relative to HEAD instead of inventing an incoming commit.
  return { root: meta.root, path: meta.relative, revision: head };
}

export function parseChangedFiles(output: Buffer): CommitFile[] {
  const fields = output.toString('utf8').split('\0');
  const files: CommitFile[] = [];
  for (let i = 0; i < fields.length && fields[i];) {
    const status = fields[i++];
    if (/^[RC]/.test(status)) {
      const oldPath = fields[i++]; const filename = fields[i++];
      if (filename) files.push({ status, oldPath, path: filename });
    } else {
      const filename = fields[i++]; if (filename) files.push({ status, path: filename });
    }
  }
  return files;
}

export async function commitDetails(root: string, hash: string): Promise<CommitDetails> {
  if (!isCommitHash(hash)) throw new Error('Invalid commit identifier.');
  const object = (await git(root, ['cat-file', 'commit', hash])).toString('utf8');
  const separator = object.indexOf('\n\n');
  const headers = object.slice(0, separator).split('\n');
  const parents = headers.filter(line => line.startsWith('parent ')).map(line => line.slice(7));
  const author = /^author (.*) <([^>]*)> (\d+) ([+-]\d{4})$/m.exec(object.slice(0, separator));
  const message = object.slice(separator + 2).trimEnd();
  const files = parseChangedFiles(await git(root, ['diff-tree', '--no-commit-id', '--name-status', '-r', '-z', '-M', ...(parents.length ? [parents[0], hash] : ['--root', hash])]));
  return { hash, parents, author: author?.[1] ?? 'Unknown author', email: author?.[2] ?? '', authoredAt: author ? new Date(Number(author[3]) * 1000).toISOString() : '', subject: message.split('\n')[0], message, files };
}

export async function commitFileDiff(root: string, commit: CommitDetails, file: CommitFile): Promise<CommitFileDiff> {
  const beforeBytes = commit.parents[0] ? await blobAt(root, commit.parents[0], file.oldPath ?? file.path) : undefined;
  const afterBytes = await blobAt(root, commit.hash, file.path);
  const bytes = [beforeBytes, afterBytes].filter((value): value is Buffer => Boolean(value));
  try {
    if (bytes.some(value => value.includes(0))) throw new Error('binary');
    return { file, before: beforeBytes ? normalize(decode(beforeBytes)) : '', after: afterBytes ? normalize(decode(afterBytes)) : '', binary: false };
  } catch { return { file, before: '', after: '', binary: true }; }
}
