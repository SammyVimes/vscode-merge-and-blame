import { diffArrays } from 'diff';

export interface Edit {
  start: number;
  end: number;
  text: string;
  sideStart: number;
  sideEnd: number;
}

export const normalize = (text: string): string => text.replace(/\r\n/g, '\n');
export const lines = (text: string): string[] => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
// Keep identifiers whole; punctuation and whitespace have their own boundaries.
export const words = (text: string): string[] => text.match(/[\p{L}\p{N}_$]+|\s+|[^\p{L}\p{N}_$\s]/gu) ?? [];

export function edits(base: string, side: string, tokenize = lines): Edit[] {
  const parts = diffArrays(tokenize(base), tokenize(side), { timeout: 1500 });
  if (!parts) throw new Error('This file is too complex to compare within the time limit.');
  let a = 0;
  let b = 0;
  let pending: Edit | undefined;
  const result: Edit[] = [];
  for (const part of parts) {
    const text = part.value.join('');
    if (!part.added && !part.removed) {
      if (pending) result.push(pending);
      pending = undefined;
      a += text.length;
      b += text.length;
    } else {
      pending ??= { start: a, end: a, text: '', sideStart: b, sideEnd: b };
      if (part.removed) { a += text.length; pending.end = a; }
      if (part.added) { b += text.length; pending.text += text; pending.sideEnd = b; }
    }
  }
  if (pending) result.push(pending);
  return result;
}

export interface EditGroup { start: number; end: number; left: Edit[]; right: Edit[] }

export function groupEdits(left: Edit[], right: Edit[], touching = false): EditGroup[] {
  const all = [...left.map(edit => ({ edit, side: 'left' as const })), ...right.map(edit => ({ edit, side: 'right' as const }))]
    .sort((a, b) => a.edit.start - b.edit.start || a.edit.end - b.edit.end);
  const groups: EditGroup[] = [];
  for (const { edit, side } of all) {
    const last = groups.at(-1);
    const intersects = last && (edit.start < last.end || edit.start === last.start ||
      (edit.start === last.end && (touching || edit.start === edit.end)));
    if (intersects) { last.end = Math.max(last.end, edit.end); last[side].push(edit); }
    else groups.push({ start: edit.start, end: edit.end, left: side === 'left' ? [edit] : [], right: side === 'right' ? [edit] : [] });
  }
  return groups;
}

export function replaceInRange(base: string, start: number, end: number, changes: Edit[]): string {
  let result = '';
  let pos = start;
  for (const edit of changes) {
    result += base.slice(pos, edit.start) + edit.text;
    pos = edit.end;
  }
  return result + base.slice(pos, end);
}

export function sideOffset(pos: number, changes: Edit[], end = false): number {
  let delta = 0;
  for (const edit of changes) {
    if (edit.end < pos || (edit.end === pos && (edit.start !== edit.end || end))) {
      delta += edit.text.length - (edit.end - edit.start);
    } else break;
  }
  return pos + delta;
}

export const lineAt = (text: string, offset: number): number => text.slice(0, offset).split('\n').length;
