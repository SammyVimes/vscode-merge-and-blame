// Copyright 2000-2026 JetBrains s.r.o. and contributors.
// Licensed under Apache-2.0. See LICENSE and NOTICE.
// Port of ByLineRt's default-policy alignment, SmartLineChangeCorrector,
// LineChunkOptimizer and ExpandChangeBuilder at the pinned IntelliJ revision.
import { appendMatch, invertRanges, sequenceMatches, type SequenceRange } from './sequenceDiff';

const key = (line: string): string => line.replace(/[ \t\n]/g, '');
const threshold = 3; // DiffConfig.UNIMPORTANT_LINE_CHAR_COUNT

function trim(a: readonly string[], b: readonly string[], range: SequenceRange): SequenceRange {
  let { start1, start2, end1, end2 } = range;
  while (start1 < end1 && start2 < end2 && a[start1] === b[start2]) { start1++; start2++; }
  while (start1 < end1 && start2 < end2 && a[end1 - 1] === b[end2 - 1]) { end1--; end2--; }
  return { start1, start2, end1, end2 };
}

function smartMatches(a: string[], b: string[], deadline: number): SequenceRange[] {
  const indexes1: number[] = []; const indexes2: number[] = [];
  a.forEach((line, i) => { if (line.length > threshold) indexes1.push(i); });
  b.forEach((line, i) => { if (line.length > threshold) indexes2.push(i); });
  const anchors = sequenceMatches(indexes1.map(i => a[i]), indexes2.map(i => b[i]), deadline);
  const result: SequenceRange[] = [];
  let last1 = 0; let last2 = 0;
  const gap = (end1: number, end2: number): void => {
    const range = trim(a, b, { start1: last1, end1, start2: last2, end2 });
    appendMatch(result, last1, last2, range.start1 - last1);
    const inner = sequenceMatches(a.slice(range.start1, range.end1), b.slice(range.start2, range.end2), deadline);
    for (const match of inner) appendMatch(result, range.start1 + match.start1, range.start2 + match.start2, match.end1 - match.start1);
    appendMatch(result, range.end1, range.end2, end1 - range.end1);
  };
  for (const anchor of anchors) for (let i = 0; i < anchor.end1 - anchor.start1; i++) {
    const start1 = indexes1[anchor.start1 + i]; const start2 = indexes2[anchor.start2 + i];
    gap(start1, start2); appendMatch(result, start1, start2, 1);
    last1 = start1 + 1; last2 = start2 + 1;
  }
  gap(a.length, b.length);
  return result;
}

function optimize(a: string[], b: string[], input: SequenceRange[]): SequenceRange[] {
  const result: SequenceRange[] = [];
  const sizes1 = a.map(line => key(line).length); const sizes2 = b.map(line => key(line).length);
  for (const range of input) {
    result.push({ ...range });
    while (result.length >= 2) {
      const previous = result[result.length - 2]; const next = result[result.length - 1];
      if (previous.end1 !== next.start1 && previous.end2 !== next.start2) break;
      const count1 = previous.end1 - previous.start1; const count2 = next.end1 - next.start1;
      let forward = 0; let backward = 0;
      while (forward < count2 && a[previous.end1 + forward] === b[previous.end2 + forward]) forward++;
      while (backward < count1 && a[next.start1 - backward - 1] === b[next.start2 - backward - 1]) backward++;
      if (!forward && !backward) break;
      if (forward === count2) {
        result.splice(-2, 2, { ...previous, end1: previous.end1 + count2, end2: previous.end2 + count2 }); continue;
      }
      if (backward === count1) {
        result.splice(-2, 2, { ...next, start1: next.start1 - count1, start2: next.start2 - count1 }); continue;
      }
      const touchLeft = previous.end1 === next.start1;
      const touchSizes = touchLeft ? sizes1 : sizes2;
      const otherSizes = touchLeft ? sizes2 : sizes1;
      const touchStart = touchLeft ? next.start1 : next.start2;
      const changeStart = touchLeft ? previous.end2 : previous.end1;
      const changeEnd = touchLeft ? next.start2 : next.start1;
      const find = (sizes: number[], at: number, count: number, direction: number, limit: number): number => {
        for (let i = 0; i < count; i++) if (sizes[at + direction * i] <= limit) return i;
        return -1;
      };
      let shift = 0;
      search: for (const limit of [0, threshold]) for (const unchanged of [true, false]) {
        const sizes = unchanged ? touchSizes : otherSizes;
        const left = find(sizes, unchanged ? touchStart : changeStart, forward + 1, 1, limit);
        const right = find(sizes, (unchanged ? touchStart : changeEnd) - 1, backward + 1, -1, limit);
        if (left === -1 && right === -1) continue;
        shift = left === 0 || right === 0 ? 0 : left !== -1 ? left : -right;
        break search;
      }
      if (shift) {
        previous.end1 += shift; previous.end2 += shift;
        next.start1 += shift; next.start2 += shift;
      }
      break;
    }
  }
  return result;
}

/** Maximize exact pairs without reducing the whitespace-insensitive alignment. */
function exactMatches(a: string[], b: string[], keys1: string[], keys2: string[], input: SequenceRange[]): SequenceRange[] {
  const changes: SequenceRange[] = [];
  let index1 = 0; let index2 = 0; let last1 = 0; let last2 = 0;
  let sample: string | undefined;
  const mark = (start1: number, start2: number, end1 = start1 + 1, end2 = start2 + 1): void => {
    const change = trim(a, b, { start1: index1, end1: start1, start2: index2, end2: start2 });
    if (change.start1 !== change.end1 || change.start2 !== change.end2) changes.push(change);
    index1 = end1; index2 = end2;
  };
  const flush = (end1: number, end2: number): void => {
    if (sample === undefined) return;
    const group1: number[] = []; const group2: number[] = [];
    for (let i = Math.max(last1, index1); i < end1; i++) if (keys1[i] === sample) { group1.push(i); last1 = i + 1; }
    for (let i = Math.max(last2, index2); i < end2; i++) if (keys2[i] === sample) { group2.push(i); last2 = i + 1; }
    const swap = group1.length > group2.length;
    const small = swap ? group2 : group1; const large = swap ? group1 : group2;
    const smallLines = swap ? b : a; const largeLines = swap ? a : b;
    let best = small.map((_, i) => i);
    if (small.length !== large.length && large.length <= 10) {
      const combination: number[] = []; let bestWeight = 0;
      const search = (start: number): void => {
        if (combination.length === small.length) {
          const weight = small.reduce((sum, value, i) => sum + Number(smallLines[value] === largeLines[large[combination[i]]]), 0);
          if (weight > bestWeight) { bestWeight = weight; best = [...combination]; }
          return;
        }
        for (let i = start; i <= large.length - (small.length - combination.length); i++) { combination.push(i); search(i + 1); combination.pop(); }
      };
      search(0);
    }
    for (let i = 0; i < small.length; i++) {
      const x = swap ? large[best[i]] : small[i]; const y = swap ? small[i] : large[best[i]];
      if (a[x] === b[y]) mark(x, y);
    }
    sample = undefined;
  };
  for (const range of input) for (let i = 0; i < range.end1 - range.start1; i++) {
    const x = range.start1 + i; const y = range.start2 + i;
    if (sample !== keys1[x]) {
      flush(x, y);
      if (a[x] === b[y]) mark(x, y);
      else sample = keys1[x];
    }
  }
  flush(a.length, b.length);
  if (index1 !== a.length || index2 !== b.length) {
    const tail = trim(a, b, { start1: index1, start2: index2, end1: a.length, end2: b.length });
    if (tail.start1 !== tail.end1 || tail.start2 !== tail.end2) changes.push(tail);
  }
  return invertRanges(changes, a.length, b.length);
}

export function alignLines(a: string[], b: string[], deadline = Date.now() + 1500): SequenceRange[] {
  const keys1 = a.map(key); const keys2 = b.map(key);
  const smart = smartMatches(keys1, keys2, deadline);
  return exactMatches(a, b, keys1, keys2, optimize(a, b, smart));
}
