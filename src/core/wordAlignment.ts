// Copyright 2000-2026 JetBrains s.r.o. and contributors.
// Licensed under Apache-2.0. See LICENSE and NOTICE.
// Adapted from ByWordRt, ByCharRt.comparePunctuation and WordChunkOptimizer.
import { appendMatch, sequenceMatches, type SequenceRange } from './sequenceDiff';

interface Token { value: string; start: number; end: number }
export const isDiffSpace = (value: string): boolean => value === ' ' || value === '\t' || value === '\n';
export const withoutDiffSpace = (value: string): string => value.replace(/[ \t\n]/g, '');
const punctuation = (point: number): boolean => point !== 95 && (point >= 33 && point <= 47 || point >= 58 && point <= 64 || point >= 91 && point <= 96 || point >= 123 && point <= 126);

function tokens(text: string): Token[] {
  const result: Token[] = [];
  let start = -1;
  const finish = (end: number): void => { if (start !== -1) result.push({ value: text.slice(start, end), start, end }); start = -1; };
  for (let offset = 0; offset < text.length;) {
    const point = text.codePointAt(offset)!; const char = String.fromCodePoint(point);
    const alpha = !isDiffSpace(char) && !punctuation(point);
    const continuous = point >= 128 && !/\p{Decimal_Number}/u.test(char) && (point > 0xffff || /\p{Ideographic}/u.test(char) || !/\p{Alphabetic}/u.test(char) || /\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Thai}|\p{Script=Javanese}/u.test(char));
    if (alpha && !continuous) { if (start === -1) start = offset; }
    else {
      finish(offset);
      if (alpha || char === '\n') result.push({ value: char, start: offset, end: offset + char.length });
    }
    offset += char.length;
  }
  finish(text.length);
  return result;
}

function optimize(a: Token[], b: Token[], text1: string, text2: string, input: SequenceRange[]): SequenceRange[] {
  const ranges: SequenceRange[] = [];
  const separated = (words: Token[], text: string, i: number): boolean => {
    return words[i - 1].value === '\n' || words[i].value === '\n' || /[ \t\n]/.test(text.slice(words[i - 1].end, words[i].start));
  };
  for (const range of input) {
    ranges.push({ ...range });
    while (ranges.length >= 2) {
      const previous = ranges[ranges.length - 2]; const next = ranges[ranges.length - 1];
      if (previous.end1 !== next.start1 && previous.end2 !== next.start2) break;
      const count1 = previous.end1 - previous.start1; const count2 = next.end1 - next.start1;
      let forward = 0; let backward = 0;
      while (forward < count2 && a[previous.end1 + forward]?.value === b[previous.end2 + forward]?.value) forward++;
      while (backward < count1 && a[next.start1 - backward - 1]?.value === b[next.start2 - backward - 1]?.value) backward++;
      if (!forward && !backward) break;
      if (forward === count2) { ranges.splice(-2, 2, { ...previous, end1: previous.end1 + count2, end2: previous.end2 + count2 }); continue; }
      if (backward === count1) { ranges.splice(-2, 2, { ...next, start1: next.start1 - count1, start2: next.start2 - count1 }); continue; }
      const touchLeft = previous.end1 === next.start1;
      const words = touchLeft ? a : b; const text = touchLeft ? text1 : text2;
      const at = touchLeft ? next.start1 : next.start2;
      if (separated(words, text, at)) break;
      let shift = 0;
      for (let i = 0; i < forward; i++) if (separated(words, text, at + i + 1)) { shift = i + 1; break; }
      if (!shift) for (let i = 0; i < backward; i++) if (separated(words, text, at - i - 1)) { shift = -i - 1; break; }
      previous.end1 += shift; previous.end2 += shift; next.start1 += shift; next.start2 += shift;
      break;
    }
  }
  return ranges;
}

function punctuationMatches(a: string, b: string, deadline: number): SequenceRange[] {
  const offsets1: number[] = []; const offsets2: number[] = [];
  for (let i = 0; i < a.length; i++) if (punctuation(a.charCodeAt(i))) offsets1.push(i);
  for (let i = 0; i < b.length; i++) if (punctuation(b.charCodeAt(i))) offsets2.push(i);
  const result: SequenceRange[] = [];
  const ranges = sequenceMatches(offsets1.map(i => a[i]), offsets2.map(i => b[i]), deadline);
  for (const range of ranges) for (let i = 0; i < range.end1 - range.start1; i++) appendMatch(result, offsets1[range.start1 + i], offsets2[range.start2 + i], 1);
  return result;
}

/** Character matches before whitespace correction. Whitespace remains in gaps. */
export function wordMatches(text1: string, text2: string, deadline: number): SequenceRange[] {
  const a = tokens(text1); const b = tokens(text2);
  const matches = optimize(a, b, text1, text2, sequenceMatches(a.map(word => word.value), b.map(word => word.value), deadline));
  const result: SequenceRange[] = [];
  const match = (start1: number, end1: number, start2: number, end2: number): void => {
    const ranges = punctuationMatches(text1.slice(start1, end1), text2.slice(start2, end2), deadline);
    for (const range of ranges) appendMatch(result, start1 + range.start1, start2 + range.start2, range.end1 - range.start1);
  };
  let forward = { start1: 0, end1: a[0]?.start ?? text1.length, start2: 0, end2: b[0]?.start ?? text2.length };
  const backward = (index1: number, index2: number): void => {
    const range = { start1: index1 ? a[index1 - 1].end : 0, end1: a[index1]?.start ?? text1.length,
      start2: index2 ? b[index2 - 1].end : 0, end2: b[index2]?.start ?? text2.length };
    if (forward.start1 === range.start1 && forward.start2 === range.start2) {
      match(range.start1, range.end1, range.start2, range.end2);
    } else if (forward.start1 < range.start1 && forward.start2 < range.start2) {
      match(forward.start1, forward.end1, forward.start2, forward.end2);
      match(range.start1, range.end1, range.start2, range.end2);
    } else {
      const leftSame = forward.start1 === range.start1 && forward.end1 === range.end1;
      const common = leftSame ? text1.slice(range.start1, range.end1) : text2.slice(range.start2, range.end2);
      const first = leftSame ? text2.slice(forward.start2, forward.end2) : text1.slice(forward.start1, forward.end1);
      const second = leftSame ? text2.slice(range.start2, range.end2) : text1.slice(range.start1, range.end1);
      const split = first.length;
      const punct = punctuationMatches(common, first + second, deadline);
      for (const part of [0, 1]) for (const p of punct) {
        const start = part ? Math.max(p.start2, split) : p.start2;
        const end = part ? p.end2 : Math.min(p.end2, split);
        if (start >= end) continue;
        const commonOffset = p.start1 + start - p.start2;
        const otherOffset = start - (part ? split : 0);
        if (leftSame) appendMatch(result, range.start1 + commonOffset, (part ? range.start2 : forward.start2) + otherOffset, end - start);
        else appendMatch(result, (part ? range.start1 : forward.start1) + otherOffset, range.start2 + commonOffset, end - start);
      }
    }
  };
  for (const range of matches) for (let i = 0; i < range.end1 - range.start1; i++) {
    const index1 = range.start1 + i; const index2 = range.start2 + i;
    backward(index1, index2);
    appendMatch(result, a[index1].start, b[index2].start, a[index1].end - a[index1].start);
    forward = { start1: a[index1].end, end1: a[index1 + 1]?.start ?? text1.length, start2: b[index2].end, end2: b[index2 + 1]?.start ?? text2.length };
  }
  backward(a.length, b.length);
  return result;
}
