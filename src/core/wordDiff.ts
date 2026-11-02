// Copyright 2000-2026 JetBrains s.r.o. and contributors.
// Licensed under Apache-2.0. See LICENSE and NOTICE.
// ByWordRt's two-way whitespace correction, shared by visual word highlighting.
import type { Edit } from './diff';
import { invertRanges } from './sequenceDiff';
import { wordMatches, isDiffSpace, withoutDiffSpace } from './wordAlignment';

export function wordEdits(base: string, side: string, ignoreWhitespace = false): Edit[] {
  const changes = invertRanges(wordMatches(base, side, Date.now() + 1000), base.length, side.length);
  const result: Edit[] = [];
  for (const range of changes) {
    let { start1, end1, start2, end2 } = range;
    const common = (end: boolean): void => {
      while (start1 < end1 && start2 < end2) {
        const char = base[end ? end1 - 1 : start1];
        if (!isDiffSpace(char) || char !== side[end ? end2 - 1 : start2]) break;
        if (end) { end1--; end2--; } else { start1++; start2++; }
      }
    };
    common(!ignoreWhitespace); common(ignoreWhitespace);
    if (ignoreWhitespace) {
      while (start1 < end1 && isDiffSpace(base[start1])) start1++;
      while (start1 < end1 && isDiffSpace(base[end1 - 1])) end1--;
      while (start2 < end2 && isDiffSpace(side[start2])) start2++;
      while (start2 < end2 && isDiffSpace(side[end2 - 1])) end2--;
      if (withoutDiffSpace(base.slice(start1, end1)) === withoutDiffSpace(side.slice(start2, end2))) continue;
    }
    if (start1 === end1 && start2 === end2) continue;
    result.push({ start: start1, end: end1, sideStart: start2, sideEnd: end2, text: side.slice(start2, end2) });
  }
  return result;
}
