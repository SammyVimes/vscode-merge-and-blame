// Copyright 2000-2026 JetBrains s.r.o. and contributors.
// Licensed under Apache-2.0. See LICENSE and NOTICE.
// Adapted from Diff, MyersLCS and Reindexer at the pinned IntelliJ revision.

export interface SequenceRange { start1: number; end1: number; start2: number; end2: number }

export function appendMatch(ranges: SequenceRange[], start1: number, start2: number, count: number): void {
  if (!count) return;
  const last = ranges.at(-1);
  if (last && last.end1 === start1 && last.end2 === start2) { last.end1 += count; last.end2 += count; }
  else ranges.push({ start1, end1: start1 + count, start2, end2: start2 + count });
}

/** Complement of ordered ranges; both changed and unchanged ranges use this. */
export function invertRanges(ranges: SequenceRange[], length1: number, length2: number): SequenceRange[] {
  const result: SequenceRange[] = [];
  let start1 = 0; let start2 = 0;
  for (const range of ranges) {
    if (start1 !== range.start1 || start2 !== range.start2) result.push({ start1, end1: range.start1, start2, end2: range.start2 });
    start1 = range.end1; start2 = range.end2;
  }
  if (start1 !== length1 || start2 !== length2) result.push({ start1, end1: length1, start2, end2: length2 });
  return result;
}

/** Same bidirectional Myers tie-breaking as IntelliJ, using linear memory. */
export function sequenceMatches(first: readonly string[], second: readonly string[], deadline: number): SequenceRange[] {
  if (Date.now() > deadline) throw new Error('This file is too complex to compare within the time limit.');
  const result: SequenceRange[] = [];
  let prefix = 0;
  while (prefix < first.length && prefix < second.length && first[prefix] === second[prefix]) prefix++;
  let suffix = 0;
  while (suffix < Math.min(first.length, second.length) - prefix && first[first.length - suffix - 1] === second[second.length - suffix - 1]) suffix++;
  appendMatch(result, 0, 0, prefix);
  const a = first.slice(prefix, first.length - suffix);
  const b = second.slice(prefix, second.length - suffix);
  // Values absent from the other sequence cannot participate in the LCS.
  const values1 = new Set(a); const values2 = new Set(b);
  const indexes1: number[] = []; const indexes2: number[] = [];
  const x: string[] = []; const y: string[] = [];
  a.forEach((value, index) => { if (values2.has(value)) { x.push(value); indexes1.push(index); } });
  b.forEach((value, index) => { if (values1.has(value)) { y.push(value); indexes2.push(index); } });
  if (x.length && y.length) {
    const changed1 = new Uint8Array(x.length).fill(1);
    const changed2 = new Uint8Array(y.length).fill(1);
    const forward = new Int32Array(x.length + y.length + 2);
    const backward = new Int32Array(forward.length);
    // The source recurses left before right. An explicit stack avoids call-stack
    // overflow on large files while retaining that traversal and tie-breaking.
    const jobs = [[0, x.length, 0, y.length, x.length + y.length]];
    while (jobs.length) {
      if (Date.now() > deadline) throw new Error('This file is too complex to compare within the time limit.');
      const [oldStart, oldEnd, newStart, newEnd, estimate] = jobs.pop()!;
      if (oldStart === oldEnd || newStart === newEnd) continue;
      const n = oldEnd - oldStart; const m = newEnd - newStart;
      forward[m + 1] = backward[m + 1] = 0;
      let xx = -1; let kk = -1; let distance = -1;
      search: for (let d = 0; d <= Math.floor((estimate + 1) / 2); d++) {
        if ((d & 31) === 0 && Date.now() > deadline) throw new Error('This file is too complex to compare within the time limit.');
        const left = m + Math.max(-d, -m + ((d ^ m) & 1));
        const right = m + Math.min(d, n - ((d ^ n) & 1));
        for (let k = left; k <= right; k += 2) {
          let i = k === left || k !== right && forward[k - 1] < forward[k + 1] ? forward[k + 1] : forward[k - 1] + 1;
          let j = i - k + m;
          while (i < n && j < m && x[oldStart + i] === y[newStart + j]) { i++; j++; }
          forward[k] = i;
        }
        if ((n - m) % 2 !== 0) for (let k = left; k <= right; k += 2) {
          if (n - d + 1 <= k && k <= n + d - 1 && forward[k] + backward[m + n - k] >= n) {
            xx = forward[k]; kk = k; distance = 2 * d - 1; break search;
          }
        }
        for (let k = left; k <= right; k += 2) {
          let i = k === left || k !== right && backward[k - 1] < backward[k + 1] ? backward[k + 1] : backward[k - 1] + 1;
          let j = i - k + m;
          while (i < n && j < m && x[oldEnd - 1 - i] === y[newEnd - 1 - j]) { i++; j++; }
          backward[k] = i;
        }
        if ((n - m) % 2 === 0) for (let k = left; k <= right; k += 2) {
          if (n - d <= k && k <= n + d && forward[n + m - k] + backward[k] >= n) {
            xx = n - backward[k]; kk = n + m - k; distance = 2 * d; break search;
          }
        }
      }
      if (distance > 1) {
        const yy = xx - kk + m;
        const half = Math.floor((distance + 1) / 2);
        if (oldStart + xx < oldEnd && newStart + yy < newEnd) jobs.push([oldStart + xx, oldEnd, newStart + yy, newEnd, distance - half]);
        if (xx > 0 && yy > 0) jobs.push([oldStart, oldStart + xx, newStart, newStart + yy, half]);
      } else if (distance >= 0) {
        let i = oldStart; let j = newStart;
        while (i < oldEnd && j < newEnd) {
          if (x[i] === y[j]) { changed1[i++] = 0; changed2[j++] = 0; }
          else if (n > m) i++;
          else j++;
        }
      } else throw new Error('Could not align these file contents.');
    }
    let i = 0; let j = 0;
    while (i < x.length && j < y.length) {
      if (changed1[i]) { i++; continue; }
      if (changed2[j]) { j++; continue; }
      appendMatch(result, prefix + indexes1[i++], prefix + indexes2[j++], 1);
    }
  }
  appendMatch(result, first.length - suffix, second.length - suffix, suffix);
  return result;
}
