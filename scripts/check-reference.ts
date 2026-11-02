import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { resolveSimple } from '../src/core/resolve';
import { MergeSession } from '../src/core/merge';

const home = process.env.JETBRAINS_HOME || '/Applications/CLion.app/Contents';
const textCases = JSON.parse(readFileSync('test/fixtures/text-resolution.json', 'utf8')) as { cases: { base: string; left: string; right: string; expected: string | null }[] };
const fixtures = textCases.cases;
const run = spawnSync('java', ['--class-path', path.join(home, 'lib', '*'), 'scripts/ReferenceMerge.java', 'default'], { input: JSON.stringify(fixtures), encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
if (run.status !== 0) throw new Error(run.stderr || run.error?.message || 'Reference process failed. Set JETBRAINS_HOME to an installed JetBrains IDE Contents directory.');
const reference = JSON.parse(run.stdout.trim()) as (string | null)[];
let failures = 0;
for (const [index, fixture] of fixtures.entries()) {
  const actual = resolveSimple(fixture.left, fixture.base, fixture.right);
  assert.equal(reference[index], fixture.expected, `stored text oracle differs from the installed IDE on case ${index + 1}`);
  if (actual !== reference[index]) {
    console.error({ ...fixture, actual, reference: reference[index] }); failures++;
  }
}
assert.equal(failures, 0, `${failures} default text-resolver differences from the installed JetBrains IDE`);
console.log(`Matched JetBrains default text resolver on ${fixtures.length} fixtures.`);

const lines = JSON.parse(readFileSync('test/fixtures/line-ranges.json', 'utf8')) as { cases: { base: string; left: string; right: string; expected: number[][] }[] };
const lineRun = spawnSync('java', ['--class-path', path.join(home, 'lib', '*'), 'scripts/ReferenceMerge.java', 'lines'], {
  input: JSON.stringify(lines.cases), encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024,
});
if (lineRun.status !== 0) throw new Error(lineRun.stderr || lineRun.error?.message || 'Reference line comparison failed.');
const lineReference = JSON.parse(lineRun.stdout.trim()) as number[][][];
assert.equal(lineReference.length, lines.cases.length, 'reference line case count');
for (const [index, fixture] of lines.cases.entries()) {
  assert.deepEqual(lineReference[index], fixture.expected, `stored line oracle differs from the installed IDE on case ${index + 1}`);
  const session = new MergeSession({ ...fixture, name: 'fixture.txt', leftLabel: 'Local', rightLabel: 'Incoming' });
  assert.deepEqual(session.hunks.map(h => [h.baseLines.start, h.baseLines.end, h.leftLines.start, h.leftLines.end, h.rightLines.start, h.rightLines.end]), lineReference[index], `line-range mismatch on case ${index + 1}`);
}
console.log(`Matched JetBrains line-range engine on ${lines.cases.length} fixtures.`);
