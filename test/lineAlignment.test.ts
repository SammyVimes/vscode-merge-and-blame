import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MergeSession } from '../src/core/merge';
import { lineEdits } from '../src/core/lineDiff';
import { alignLines } from '../src/core/lineAlignment';
import { sequenceMatches } from '../src/core/sequenceDiff';

interface Fixture { base: string; left: string; right: string; expected: number[][] }
const fixtures = JSON.parse(readFileSync('test/fixtures/line-ranges.json', 'utf8')) as { cases: Fixture[] };

test('line ranges match 1,000 CLion oracle cases, including repeated lines, whitespace, Unicode, and larger files', () => {
  assert.equal(fixtures.cases.length, 1000);
  for (const [index, fixture] of fixtures.cases.entries()) {
    const session = new MergeSession({ ...fixture, name: 'fixture.txt', leftLabel: 'Local', rightLabel: 'Incoming' });
    assert.deepEqual(session.hunks.map(h => [h.baseLines.start, h.baseLines.end, h.leftLines.start, h.leftLines.end, h.rightLines.start, h.rightLines.end]), fixture.expected, `CLion line-range fixture ${index + 1}`);
  }
});

test('bulk application reproduces a one-sided revision even with repeated lines and indentation changes', () => {
  for (const [index, fixture] of fixtures.cases.entries()) for (const side of ['left', 'right'] as const) {
    const session = new MergeSession({ ...fixture, [side === 'left' ? 'right' : 'left']: fixture.base, name: 'file.txt', leftLabel: 'Local', rightLabel: 'Incoming' });
    session.perform({ type: 'bulk' });
    assert.equal(session.result, fixture[side], `fixture ${index + 1}, ${side}`);
    assert.equal(session.remaining.length, 0);
  }
});

test('exact indentation wins inside repeated whitespace-equivalent brace lines', () => {
  assert.deepEqual(lineEdits(['{', ' {', '  {'], [' {', '  {']).map(edit => [edit.start, edit.end, edit.sideStart, edit.sideEnd]), [[0, 1, 0, 0]]);
  assert.deepEqual(lineEdits(['A', '', '}', '', 'B'], ['A', '}', '', 'B']).map(edit => [edit.start, edit.end, edit.sideStart, edit.sideEnd]), [[1, 2, 1, 1]]);
});

test('matching stays bounded and handles large files without a recursive call stack', () => {
  const a = Array.from({ length: 20000 }, (_, i) => `const value${i} = ${i};`);
  const b = [...a]; b.splice(10000, 0, '// inserted line');
  assert.deepEqual(lineEdits(a, b).map(edit => [edit.start, edit.end, edit.sideStart, edit.sideEnd]), [[10000, 10000, 10000, 10001]]);
  assert.throws(() => sequenceMatches(['a'], ['a'], 0), /time limit/);
  assert.throws(() => alignLines(['anchor', 'old'], ['anchor', 'new'], 0), /time limit/);
});
