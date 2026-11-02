import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MergeSession, isResolved } from '../src/core/merge';
import { resolveSimple } from '../src/core/resolve';

const session = (base: string, left: string, right: string): MergeSession => new MergeSession({ base, left, right, name: 'file.ts', leftLabel: 'Local', rightLabel: 'Incoming' });

test('starts from base; accepting both sides follows application order and undo restores resolution state', () => {
  const s = session('base', 'local', 'incoming');
  assert.equal(s.result, 'base'); assert.equal(s.conflicts.length, 1);
  s.perform({ type: 'apply', id: 0, side: 'right' });
  assert.equal(s.result, 'incoming'); assert.deepEqual(s.hunks[0].resolved, { left: false, right: true });
  s.perform({ type: 'apply', id: 0, side: 'left' });
  assert.equal(s.result, 'incoming\nlocal'); assert.equal(s.remaining.length, 0);
  s.undo(); assert.equal(s.result, 'incoming'); assert.equal(s.remaining.length, 1);
  s.redo(); assert.equal(s.result, 'incoming\nlocal'); assert.equal(s.remaining.length, 0);
});

test('ignore is per-side in conflicts; applying a side after ignoring the other resolves it', () => {
  const s = session('base\n', 'left\n', 'right\n');
  s.perform({ type: 'ignore', id: 0, side: 'left' });
  assert.equal(s.result, 'base\n'); assert.deepEqual(s.hunks[0].resolved, { left: true, right: false });
  s.perform({ type: 'apply', id: 0, side: 'right' });
  assert.equal(s.result, 'right\n'); assert.equal(s.remaining.length, 0);
  s.perform({ type: 'reset', id: 0 });
  assert.equal(s.result, 'base\n'); assert.deepEqual(s.hunks[0].resolved, { left: false, right: false });
});

test('Ctrl/Cmd-applying a second side appends after the first side, as in MergeConflictModel.replaceChange', () => {
  for (const first of ['left', 'right'] as const) {
    const second = first === 'left' ? 'right' : 'left';
    const s = session('base\nanchor\n', 'local\nanchor\n', 'incoming\nanchor\n');
    s.perform({ type: 'apply', id: 0, side: first });
    const partial = s.snapshot();
    s.perform({ type: 'apply', id: 0, side: second, resolve: true });
    assert.equal(s.result, `${first === 'left' ? 'local\nincoming' : 'incoming\nlocal'}\nanchor\n`);
    assert.deepEqual(s.hunks[0].resolved, { left: true, right: true });
    s.undo(); assert.deepEqual(s.snapshot(), partial);
    s.redo(); assert.equal(s.remaining.length, 0);
  }
});

test('bulk applies both sides in a mixed file, leaving real conflicts for explicit resolution', () => {
  const s = session('a\nkeep\nb\nkeep2\nc\n', 'A\nkeep\nleft\nkeep2\nc\n', 'a\nkeep\nright\nkeep2\nC\n');
  assert.equal(s.hunks.length, 3);
  s.perform({ type: 'bulk' });
  assert.equal(s.result, 'A\nkeep\nb\nkeep2\nC\n');
  assert.equal(s.remaining.length, 1); assert.equal(s.conflicts.length, 1);
  s.undo(); assert.equal(s.result, s.input.base); assert.equal(s.remaining.length, 3);
  s.redo(); assert.equal(s.result, 'A\nkeep\nb\nkeep2\nC\n');
});

test('bulk and magic preserve manual edits and previously ignored changes', () => {
  const s = session('a\nkeep\nb\nkeep2\nf(old, red)\n', 'A\nkeep\nB\nkeep2\nf(new, red)\n', 'a\nkeep\nb\nkeep2\nf(old, blue)\n');
  s.perform({ type: 'edit', edits: [{ offset: 0, length: 1, text: 'manual' }] });
  s.perform({ type: 'ignore', id: 1, side: 'left' });
  const last = s.hunks[2];
  s.perform({ type: 'edit', edits: [{ offset: last.result.start, length: 1, text: 'g' }] });
  const before = s.result;
  assert.equal(s.perform({ type: 'bulk' }), false);
  assert.equal(s.perform({ type: 'magic' }), false);
  assert.equal(s.result, before);
});

test('magic resolves independent edits within the same line and skips ambiguous replacements', () => {
  const s = session('render(oldName, oldColor);\nkeep\nx = 1;\n', 'render(newName, oldColor);\nkeep\nx = 2;\n', 'render(oldName, newColor);\nkeep\nx = 3;\n');
  assert.equal(s.conflicts.length, 2);
  s.perform({ type: 'magic' });
  assert.equal(s.result, 'render(newName, newColor);\nkeep\nx = 1;\n');
  assert.equal(s.conflicts.length, 1);
  s.undo(); assert.equal(s.conflicts.length, 2); assert.equal(s.result, s.input.base);
});

test('per-conflict magic resolves only the selected conflict and can be undone independently', () => {
  const s = session('f(old, red)\nanchor\ng(old, red)\nend\nx=1\n', 'f(new, red)\nanchor\ng(new, red)\nend\nx=2\n', 'f(old, blue)\nanchor\ng(old, blue)\nend\nx=3\n');
  assert.equal(s.conflicts.length, 3);
  s.perform({ type: 'magic', id: 0 });
  assert.equal(s.result, 'f(new, blue)\nanchor\ng(old, red)\nend\nx=1\n');
  assert.equal(s.conflicts.length, 2);
  s.undo(); assert.equal(s.result, s.input.base); assert.equal(s.conflicts.length, 3);
  s.redo(); assert.equal(s.conflicts.length, 2);
  s.perform({ type: 'magic' });
  assert.equal(s.result, 'f(new, blue)\nanchor\ng(new, blue)\nend\nx=1\n');
  assert.equal(s.conflicts.length, 1);
});

test('whole-file wand includes non-conflicting changes, matching IntelliJ applyResolvableConflictedChanges', () => {
  const s = session('a\nanchor\nf(old, red)\n', 'A\nanchor\nf(new, red)\n', 'a\nanchor\nf(old, blue)\n');
  s.perform({ type: 'magic' });
  assert.equal(s.result, 'A\nanchor\nf(new, blue)\n');
  assert.equal(s.remaining.length, 0);
  s.undo(); assert.equal(s.result, s.input.base); assert.equal(s.remaining.length, 2);
});

test('wand applies resolved text with IntelliJ LineTokenizer trailing-empty-line semantics', () => {
  const s = session('f(old, red)', 'f(new, red)\n', 'f(old, blue)\n');
  assert.equal(s.hunks[0].simple, 'f(new, blue)\n');
  s.perform({ type: 'magic' });
  assert.equal(s.result, 'f(new, blue)');
  assert.equal(s.remaining.length, 0);
  s.undo(); assert.equal(s.result, 'f(old, red)');
});

test('insertion/deletion and EOF changes preserve source offsets as earlier changes shift the result', () => {
  const s = session('a\nb\nc\nd', 'prefix\na\nc\nd', 'a\nb\nc\nD\n');
  s.perform({ type: 'bulk' });
  assert.equal(s.result, 'prefix\na\nc\nD\n');
  assert.equal(s.remaining.length, 0);
  for (const h of s.hunks) {
    assert.equal(s.input.left.split('\n').slice(h.leftLines.start, h.leftLines.end).join('\n'), h.leftText);
    assert.equal(s.input.right.split('\n').slice(h.rightLines.start, h.rightLines.end).join('\n'), h.rightText);
    assert.ok(h.result.start >= 0 && h.result.end <= s.result.length);
  }
});

test('side-specific bulk only handles eligible changes on that side', () => {
  const s = session('a\nkeep\nb\n', 'A\nkeep\nb\n', 'a\nkeep\nB\n');
  s.perform({ type: 'bulk', side: 'right' });
  assert.equal(s.result, 'a\nkeep\nB\n'); assert.equal(s.remaining.length, 1);
  s.perform({ type: 'bulk', side: 'left' });
  assert.equal(s.result, 'A\nkeep\nB\n'); assert.equal(s.remaining.length, 0);
});

test('identical changes are non-conflicting; ignoring keeps base', () => {
  const s = session('base', 'same', 'same');
  assert.equal(s.conflicts.length, 0);
  s.perform({ type: 'ignore', id: 0, side: 'left' }); assert.equal(s.result, 'base'); assert.ok(isResolved(s.hunks[0]));
  s.perform({ type: 'reset', id: 0 }); s.perform({ type: 'bulk' }); assert.equal(s.result, 'same');
});

test('empty base, conflicting insertions, and delete/modify conflicts', () => {
  const s = session('', 'one\n', 'two\n');
  assert.equal(s.conflicts.length, 1); assert.equal(s.hunks[0].simple, null);
  s.perform({ type: 'apply', id: 0, side: 'left' }); s.perform({ type: 'ignore', id: 0, side: 'right' });
  assert.equal(s.result, 'one\n'); assert.equal(s.remaining.length, 0);
  const d = session('line\n', '', 'modified\n');
  d.perform({ type: 'apply', id: 0, side: 'left' });
  assert.equal(d.result, ''); assert.equal(d.remaining.length, 1);
  d.perform({ type: 'ignore', id: 0, side: 'right' }); assert.equal(d.remaining.length, 0);
});

test('CRLF inputs are normalized for Monaco without losing newline at EOF', () => {
  const s = session('a\r\nb\r\n', 'A\r\nb\r\n', 'a\r\nb\r\n');
  s.perform({ type: 'bulk' }); assert.equal(s.result, 'A\nb\n');
});

test('word resolution is symmetric and refuses distinct insertions at the same position', () => {
  for (const [base, left, right, expected] of [
    ['version: 1.0.0', 'version: 2.0.0', 'version: 1.0.4', 'version: 2.0.4'],
    ['x x x', 'x Y x', 'x Z x', null],
    ['x x', 'x Y x', 'x Z x', null],
    ['x', 'x Y', 'Z x', 'Z x Y'],
  ] as const) {
    assert.equal(resolveSimple(left, base, right), expected);
    assert.equal(resolveSimple(right, base, left), expected);
  }
});

test('manual edits can be marked resolved, reverted, and fully undone', () => {
  const s = session('old\n', 'left\n', 'right\n');
  s.perform({ type: 'edit', edits: [{ offset: 0, length: 3, text: 'combined' }] });
  s.perform({ type: 'resolve', id: 0 }); assert.equal(s.remaining.length, 0);
  s.perform({ type: 'reset', id: 0 }); assert.equal(s.result, 'old\n'); assert.equal(s.remaining.length, 1);
  s.undo(); assert.equal(s.result, 'combined\n'); assert.equal(s.remaining.length, 0);
  s.undo(); assert.equal(s.remaining.length, 1);
  s.undo(); assert.equal(s.result, 'old\n'); assert.equal(s.hunks[0].manual, false);
});

test('joining a context line to a changed line protects the whole manual result from bulk apply', () => {
  const s = session('context\nold\n', 'context\nnew\n', 'context\nold\n');
  s.perform({ type: 'edit', edits: [{ offset: 7, length: 1, text: '' }] });
  assert.equal(s.result, 'contextold\n');
  assert.equal(s.perform({ type: 'bulk' }), false);
  assert.equal(s.result, 'contextold\n');
});

test('invalid multi-edit commands are rejected before changing the document', () => {
  const s = session('a\n', 'A\n', 'a\n');
  const before = s.snapshot();
  assert.throws(() => s.perform({ type: 'edit', edits: [{ offset: 0, length: 1, text: 'valid' }, { offset: 100, length: 1, text: 'invalid' }] }));
  assert.deepEqual(s.snapshot(), before);
});

test('modify/delete file conflicts cannot be resolved by either automatic action', () => {
  for (const side of ['left', 'right'] as const) {
    const input = { base: 'A\nB\nC', left: 'A\nB\nC', right: 'A\nB\nC', name: 'file', leftLabel: 'Local', rightLabel: 'Incoming', [side === 'left' ? 'leftDeleted' : 'rightDeleted']: true, [side]: '' };
    const s = new MergeSession(input);
    assert.equal(s.perform({ type: 'bulk' }), false);
    assert.equal(s.perform({ type: 'magic' }), false);
    assert.equal(s.result, input.base); assert.equal(s.remaining.length, 1);
  }
});

test('manual ranges match IntelliJ for damaged top, bottom, and fully replaced boundaries', () => {
  for (const [base, left, find, replacement, content, range] of [
    ['X\na\nb\nc\nY', 'X\nx\ny\nz\nY', '\nb\n', 'D', 'aDc', [1, 2]],
    ['X\na\nb\nc\nY', 'X\nx\ny\nz\nY', 'c', 'u\nx', 'a\nb\nu\nx', [1, 5]],
    ['X\na\nb\nc\nY', 'X\nx\ny\nz\nY', 'c\n', '', 'a\nb', [1, 3]],
    ['A\nX\na\nb\nc\nY', 'A\nX\nx\ny\nz\nY', 'X\na\nb', 'q\nw\ne', 'c', [4, 5]],
    ['X\na\nb\nc\nY\nA', 'X\nx\ny\nz\nY\nA', 'c\nY', 'q', 'a\nb', [1, 3]],
    ['A\nX\nb\nY\nA', 'A\nX\nx\nY\nA', 'X\nb\nY', 'q', '', [2, 2]],
  ] as const) {
    const s = session(base, left, left);
    s.perform({ type: 'edit', edits: [{ offset: base.indexOf(find), length: find.length, text: replacement }] });
    const h = s.hunks[0];
    assert.deepEqual(h.resultLines, { start: range[0], end: range[1] });
    assert.equal(s.snapshot().rows.slice(h.resultLines.start, h.resultLines.end).join('\n'), content);
    const edited = s.result; s.undo(); assert.equal(s.result, base); s.redo(); assert.equal(s.result, edited);
  }
});

test('manually deleting a deletion hunk resolves it, and undo restores its pending state', () => {
  const s = session('X\n1\nIns\n2\nY', 'X\n1\n2\nY', 'X\n1\n2\nY');
  s.perform({ type: 'edit', edits: [{ offset: s.result.indexOf('1\n'), length: '1\nIns\n2\n'.length, text: '' }] });
  assert.equal(s.remaining.length, 0); assert.deepEqual(s.hunks[0].resultLines, { start: 2, end: 2 });
  s.undo(); assert.equal(s.remaining.length, 1);
});

test('legacy saved sessions keep text and matching resolutions while recomputing wand results', () => {
  const s = session('old\nanchor\nf(old, red)\n', 'left\nanchor\nf(new, red)\n', 'right\nanchor\nf(old, blue)\n');
  s.perform({ type: 'apply', id: 0, side: 'left' });
  const saved = s.snapshot(); delete saved.version;
  saved.hunks[1].simple = 'obsolete cached resolution';
  const restored = new MergeSession(s.input, saved);
  assert.equal(restored.result, s.result);
  assert.deepEqual(restored.hunks[0].resolved, { left: true, right: false });
  assert.deepEqual(restored.hunks[0].applied, ['left']);
  assert.equal(restored.hunks[1].simple, 'f(new, blue)');
  assert.equal(restored.canUndo, false, 'migration is an initial state, not an undoable user action');
  restored.perform({ type: 'apply', id: 0, side: 'right' });
  assert.equal(restored.result, 'left\nright\nanchor\nf(old, red)\n');
});

test('legacy sessions with different boundaries preserve manual output and leave new ranges for review', () => {
  const s = session('old\nanchor\nend\n', 'left\nanchor\nend\n', 'right\nanchor\nend\n');
  const saved = s.snapshot(); delete saved.version; saved.hunks = [];
  saved.result = 'manually combined\nanchor\nend\n'; saved.rows = saved.result.split('\n');
  const restored = new MergeSession(s.input, saved);
  assert.equal(restored.result, saved.result);
  assert.equal(restored.remaining.length, 1);
  assert.equal(restored.perform({ type: 'magic' }), false);
  assert.equal(restored.perform({ type: 'bulk' }), false);
  assert.equal(restored.result, saved.result);
});
