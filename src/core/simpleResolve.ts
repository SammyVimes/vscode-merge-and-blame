// Copyright 2000-2026 JetBrains s.r.o. and contributors.
// Licensed under Apache-2.0. See LICENSE and NOTICE.
// Adapted from ComparisonMergeUtil.FairMergeBuilder and
// MergeResolveUtil.SimpleHelper, the default text-resolver entry point.
import { wordMatches, isDiffSpace, withoutDiffSpace } from './wordAlignment';

type MergeRange = [number, number, number, number, number, number];
function ranges(base: string, left: string, right: string, deadline: number): MergeRange[] {
  const a = wordMatches(base, left, deadline); const b = wordMatches(base, right, deadline);
  const result: MergeRange[] = [];
  let i = 0; let j = 0; let lastBase = 0; let lastLeft = 0; let lastRight = 0;
  const change = (endBase: number, endLeft: number, endRight: number): void => {
    if (lastBase !== endBase || lastLeft !== endLeft || lastRight !== endRight) result.push([lastBase, endBase, lastLeft, endLeft, lastRight, endRight]);
  };
  while (i < a.length && j < b.length) {
    const x = a[i]; const y = b[j];
    if (x.end1 <= y.start1) { i++; continue; }
    if (y.end1 <= x.start1) { j++; continue; }
    const start = Math.max(x.start1, y.start1); const end = Math.min(x.end1, y.end1);
    const l = x.start2 + start - x.start1; const r = y.start2 + start - y.start1;
    change(start, l, r);
    lastBase = end; lastLeft = l + end - start; lastRight = r + end - start;
    if (x.end1 <= y.end1) i++; else j++;
  }
  change(base.length, left.length, right.length);
  return result;
}

function resolve(left: string, base: string, right: string, ignore: boolean, raw: MergeRange[]): string | null {
  const texts = [base, left, right];
  const corrected: MergeRange[] = [];
  const equal = (a: string, b: string): boolean => ignore ? withoutDiffSpace(a) === withoutDiffSpace(b) : a === b;
  for (const range of raw) {
    const current = [...range] as MergeRange;
    const trimCommon = (end: boolean): void => {
      while (current[0] < current[1] && current[2] < current[3] && current[4] < current[5]) {
        const a = base[end ? current[1] - 1 : current[0]];
        if (!isDiffSpace(a) || a !== left[end ? current[3] - 1 : current[2]] || a !== right[end ? current[5] - 1 : current[4]]) break;
        for (const offset of [0, 2, 4]) if (end) current[offset + 1]--; else current[offset]++;
      }
    };
    // Default correction is suffix first. Ignore-whitespace expands prefix first.
    trimCommon(!ignore); trimCommon(ignore);
    if (ignore) for (let side = 0; side < 3; side++) {
      const index = side * 2;
      while (current[index] < current[index + 1] && isDiffSpace(texts[side][current[index]])) current[index]++;
      while (current[index] < current[index + 1] && isDiffSpace(texts[side][current[index + 1] - 1])) current[index + 1]--;
    }
    if (current[0] === current[1] && current[2] === current[3] && current[4] === current[5]) continue;
    if (ignore && equal(base.slice(current[0], current[1]), left.slice(current[2], current[3])) && equal(base.slice(current[0], current[1]), right.slice(current[4], current[5]))) continue;
    corrected.push(current);
  }
  let output = ''; let lastBase = 0; let lastLeft = 0; let lastRight = 0;
  const appendBase = (endBase: number, endLeft: number, endRight: number): void => {
    const original = base.slice(lastBase, endBase); const a = left.slice(lastLeft, endLeft); const b = right.slice(lastRight, endRight);
    output += a !== original ? a : b !== original ? b : original;
  };
  for (const [startBase, endBase, startLeft, endLeft, startRight, endRight] of corrected) {
    appendBase(startBase, startLeft, startRight);
    const original = base.slice(startBase, endBase); const a = left.slice(startLeft, endLeft); const b = right.slice(startRight, endRight);
    if (equal(a, b) || equal(original, b)) output += a;
    else if (equal(original, a)) output += b;
    else return null;
    lastBase = endBase; lastLeft = endLeft; lastRight = endRight;
  }
  appendBase(base.length, left.length, right.length);
  return output;
}

export function resolveTextConflict(left: string, base: string, right: string): string | null {
  try {
    const changes = ranges(base, left, right, Date.now() + 1000);
    return resolve(left, base, right, false, changes) ?? resolve(left, base, right, true, changes);
  } catch { return null; }
}
