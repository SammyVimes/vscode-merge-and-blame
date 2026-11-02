import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoSamples } from '../src/webview/demoSamples';
import { MergeSession } from '../src/core/merge';

const load = (id: string): MergeSession => new MergeSession(demoSamples.find(sample => sample.id === id)!.input);

test('default preview contains a substantial file and the promised kinds of changes', () => {
  assert.equal(demoSamples[0].id, 'overview');
  const s = load('overview');
  assert.ok(s.result.split('\n').length >= 150);
  assert.equal(s.hunks.length, 17);
  assert.ok(s.hunks.some(h => h.baseLines.start === h.baseLines.end && h.leftChanged && !h.rightChanged));
  assert.ok(s.hunks.some(h => h.baseLines.start === h.baseLines.end && h.rightChanged && !h.leftChanged));
  assert.ok(s.hunks.some(h => !h.conflict && h.leftChanged && h.leftLines.start === h.leftLines.end));
  assert.ok(s.hunks.some(h => !h.conflict && h.rightChanged && h.rightLines.start === h.rightLines.end));
  assert.ok(s.hunks.some(h => !h.conflict && h.leftChanged && h.rightChanged));
  assert.ok(s.conflicts.some(h => h.simple !== null));
  assert.ok(s.conflicts.some(h => h.simple === null));
  assert.ok(s.conflicts.some(h => h.leftLines.end - h.leftLines.start !== h.rightLines.end - h.rightLines.start));
});

test('insertion sample has pure additions on each side and a conflicting simultaneous insertion', () => {
  const s = load('insertions');
  assert.equal(s.hunks.filter(h => h.baseLines.start === h.baseLines.end).length, 4);
  assert.ok(s.hunks.some(h => h.baseText === '  result.tags = ["core"];' && h.leftText === '  result.tags = ["core", "local"];' && !h.conflict));
  assert.equal(s.conflicts.length, 1);
  s.perform({ type: 'bulk' });
  assert.match(s.result, /result\.traceId = request\.id;/);
  assert.match(s.result, /result\.audit = createAuditEntry\(context\);/);
  assert.match(s.result, /metrics\.increment\("requests\.received"\);/);
  assert.ok(s.result.includes('result.tags = ["core", "local"];'));
  assert.doesNotMatch(s.result, /validateLocalRequest\(request\);|validateIncomingRequest\(request\);/);
  assert.equal(s.remaining.length, 1);
});

test('deletion sample removes complete blocks from either side without introducing a conflict', () => {
  const s = load('deletions');
  assert.equal(s.conflicts.length, 0); assert.equal(s.hunks.length, 3);
  assert.match(s.result, /result\.legacy = true;/);
  s.perform({ type: 'bulk' });
  assert.doesNotMatch(s.result, /result\.legacy = true;|dumpRequest\(request\);|applyWorkaround\(result\);/);
  assert.equal(s.remaining.length, 0);
  s.undo(); assert.equal(s.result, s.input.base);
});

test('boundary sample inserts at the start and appends to a file without a final newline', () => {
  const s = load('boundaries');
  assert.ok(!s.input.base.endsWith('\n'));
  s.perform({ type: 'bulk' });
  assert.ok(s.result.startsWith('// Local adds the first line.\n'));
  assert.ok(s.result.endsWith('export const version = 2;\n'));
  assert.equal(s.remaining.length, 0);
});
