import { alignLines } from './lineAlignment';
import { invertRanges } from './sequenceDiff';
import type { Edit } from './diff';
import type { Range } from './merge';

export function lineEdits(base: string[], side: string[]): Edit[] {
  return invertRanges(alignLines(base, side), base.length, side.length).map(range => ({
    start: range.start1, end: range.end1, sideStart: range.start2, sideEnd: range.end2, text: '',
  }));
}
export function mapLineOffset(line: number, changes: Edit[]): number {
  let delta = 0;
  for (const edit of changes) {
    if (edit.end < line || (edit.end === line && edit.start !== edit.end)) delta += (edit.sideEnd - edit.sideStart) - (edit.end - edit.start);
    else break;
  }
  return line + delta;
}
export function charRange(rows: string[], range: Range): Range {
  const offset = (line: number): number => Math.min(rows.join('\n').length, rows.slice(0, line).reduce((n, row) => n + row.length + 1, 0));
  return { start: offset(range.start), end: offset(range.end) };
}
