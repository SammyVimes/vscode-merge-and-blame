// Copyright 2000-2026 JetBrains s.r.o. and contributors.
// Apache-2.0. Fixtures adapted from IntelliJ's pinned MergeTest.kt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MergeSession, type Command, type MergeInput } from '../src/core/merge';
import { resolveSimple } from '../src/core/resolve';

interface Step { type: string; id: number; expected: string; start: number | null; end: number | null }
const fixtures = JSON.parse(readFileSync('test/fixtures/merge-actions.json', 'utf8')) as (MergeInput & { count: number; steps: Step[] })[];
for (const [index, fixture] of fixtures.entries()) test(`IntelliJ merge actions #${index + 1}`, () => {
  const s = new MergeSession({ ...fixture, name: 'fixture.txt', leftLabel: 'Local', rightLabel: 'Incoming' });
  assert.equal(s.hunks.length, fixture.count, 'change count');
  for (const step of fixture.steps) {
    if (step.type === 'state') assert.deepEqual(s.hunks[step.id].resolved, { left: ['LEFT', 'BOTH'].includes(step.expected), right: ['RIGHT', 'BOTH'].includes(step.expected) });
    else if (step.type === 'content') {
      const range = s.hunks[step.id].resultLines;
      assert.equal(s.snapshot().rows.slice(range.start, range.end).join('\n'), step.expected, 'change content');
      if (step.start !== null) assert.deepEqual(range, { start: step.start, end: step.end }, 'result line range');
    } else if (step.type === 'result') assert.equal(s.result, step.expected, 'file result');
    else s.perform(step as unknown as Command);
  }
});

const words = JSON.parse(readFileSync('test/fixtures/word-resolution.json', 'utf8')) as { base: string; left: string; right: string; expected: string | null }[];
for (const [index, fixture] of words.entries()) test(`IntelliJ default text resolution #${index + 1}`, () => {
  assert.equal(resolveSimple(fixture.left, fixture.base, fixture.right), fixture.expected);
});

const textOracle = JSON.parse(readFileSync('test/fixtures/text-resolution.json', 'utf8')) as { cases: { base: string; left: string; right: string; expected: string | null }[] };
test('default text resolver matches 1,626 CLion oracle cases including punctuation, whitespace and Unicode', () => {
  assert.equal(textOracle.cases.length, 1626);
  for (const [index, fixture] of textOracle.cases.entries()) assert.equal(resolveSimple(fixture.left, fixture.base, fixture.right), fixture.expected, `CLion text-resolution fixture ${index + 1}`);
});
