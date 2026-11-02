// Copyright 2000-2026 JetBrains s.r.o. and contributors.
// Licensed under Apache-2.0. See LICENSE and NOTICE.
// State transitions adapted from IntelliJ's MergeConflictModel: base-seeded
// output, per-side resolution, append-on-second-apply, and guarded bulk actions.
import { edits, groupEdits, normalize } from './diff';
import { charRange, lineEdits, mapLineOffset } from './lineDiff';
import { resolveSimple } from './resolve';

export type Side = 'left' | 'right';
export interface Range { start: number; end: number }
export interface Hunk {
  id: number;
  base: Range; left: Range; right: Range; result: Range;
  baseLines: Range; leftLines: Range; rightLines: Range; resultLines: Range;
  baseText: string; leftText: string; rightText: string;
  leftChanged: boolean; rightChanged: boolean; conflict: boolean;
  resolved: Record<Side, boolean>;
  applied: Side[];
  manual: boolean;
  simple: string | null;
}
export interface MergeInput {
  base: string; left: string; right: string;
  name: string; leftLabel: string; rightLabel: string;
  language?: string;
  leftDeleted?: boolean; rightDeleted?: boolean;
}
const snapshotVersion = 1;
export interface Snapshot { version?: number; result: string; rows: string[]; hunks: Hunk[]; deletion: boolean }
export type Command =
  | { type: 'apply' | 'ignore'; id: number; side: Side; resolve?: boolean }
  | { type: 'reset' | 'resolve'; id: number }
  | { type: 'bulk'; side?: Side }
  | { type: 'magic'; id?: number }
  | { type: 'accept'; side: Side }
  | { type: 'edit'; edits: { offset: number; length: number; text: string }[] };

export const isResolved = (hunk: Hunk): boolean => hunk.resolved.left && hunk.resolved.right;
const clone = <T>(value: T): T => structuredClone(value);
const same = (a: string[], b: string[]): boolean => a.length === b.length && a.every((row, i) => row === b[i]);

export class MergeSession {
  readonly input: MergeInput;
  hunks: Hunk[];
  deletion = false;
  private rows: string[];
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  get result(): string { return this.rows.join('\n'); }

  constructor(input: MergeInput, snapshot?: Snapshot) {
    this.input = { ...input, base: normalize(input.base), left: normalize(input.left), right: normalize(input.right) };
    const base = this.input.base.split('\n');
    const left = this.input.left.split('\n');
    const right = this.input.right.split('\n');
    this.rows = [...base];
    const a = lineEdits(base, left);
    const b = lineEdits(base, right);
    this.hunks = groupEdits(a, b, true).map((group, id): Hunk => {
      const baseLines = { start: group.start, end: group.end };
      const leftStart = mapLineOffset(group.start, a);
      const rightStart = mapLineOffset(group.start, b);
      const leftCount = group.end - group.start + group.left.reduce((sum, edit) => sum + edit.sideEnd - edit.sideStart - edit.end + edit.start, 0);
      const rightCount = group.end - group.start + group.right.reduce((sum, edit) => sum + edit.sideEnd - edit.sideStart - edit.end + edit.start, 0);
      const leftLines = { start: leftStart, end: leftStart + leftCount };
      const rightLines = { start: rightStart, end: rightStart + rightCount };
      const baseRows = base.slice(group.start, group.end);
      const leftRows = left.slice(leftLines.start, leftLines.end);
      const rightRows = right.slice(rightLines.start, rightLines.end);
      const baseText = baseRows.join('\n');
      const leftText = leftRows.join('\n');
      const rightText = rightRows.join('\n');
      const leftChanged = !same(baseRows, leftRows);
      const rightChanged = !same(baseRows, rightRows);
      const conflict = leftChanged && rightChanged && !same(leftRows, rightRows);
      return {
        id, baseLines, leftLines, rightLines, resultLines: { ...baseLines },
        base: charRange(base, baseLines), left: charRange(left, leftLines), right: charRange(right, rightLines), result: charRange(base, baseLines),
        baseText, leftText, rightText, conflict, leftChanged, rightChanged,
        resolved: { left: false, right: false }, applied: [], manual: false,
        simple: conflict ? resolveSimple(leftText, baseText, rightText) : null,
      };
    });
    if (snapshot) this.restore(snapshot);
  }

  snapshot(): Snapshot { return clone({ version: snapshotVersion, result: this.result, rows: this.rows, hunks: this.hunks, deletion: this.deletion }); }
  restore(snapshot: Snapshot): void {
    if (snapshot.version !== snapshotVersion) { this.migrate(snapshot); return; }
    this.rows = [...snapshot.rows]; this.hunks = clone(snapshot.hunks); this.deletion = snapshot.deletion;
  }
  private migrate(snapshot: Snapshot): void {
    // Older sessions stored ranges from jsdiff and greedy-wand results. Preserve
    // their actual text, but rebuild source boundaries and wand eligibility.
    const fresh = new MergeSession(this.input);
    for (const edit of edits(fresh.result, normalize(snapshot.result)).reverse()) fresh.edit(edit.start, edit.end, edit.text);
    const identity = (h: Hunk): string => JSON.stringify([h.baseLines, h.leftLines, h.rightLines, h.baseText, h.leftText, h.rightText]);
    const old = new Map(snapshot.hunks.map(h => [identity(h), h]));
    for (const h of fresh.hunks) {
      const previous = old.get(identity(h));
      if (!previous || previous.resultLines.start < 0 || previous.resultLines.start > previous.resultLines.end || previous.resultLines.end > fresh.rows.length) continue;
      h.resultLines = { ...previous.resultLines };
      h.resolved = { ...previous.resolved }; h.applied = [...previous.applied]; h.manual = previous.manual;
    }
    fresh.refresh();
    this.rows = fresh.rows; this.hunks = fresh.hunks; this.deletion = snapshot.deletion;
  }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  get remaining(): Hunk[] { return this.hunks.filter(h => !isResolved(h)); }
  get conflicts(): Hunk[] { return this.remaining.filter(h => h.conflict); }
  eligible(h: Hunk): boolean {
    // Modify/delete file conflicts require an explicit choice of file identity.
    return !this.input.leftDeleted && !this.input.rightDeleted && !isResolved(h) && !h.manual && !h.resolved.left && !h.resolved.right;
  }

  perform(command: Command): boolean {
    const before = this.snapshot();
    if (command.type === 'edit') {
      for (const edit of command.edits) {
        if (!Number.isInteger(edit.offset) || !Number.isInteger(edit.length) || edit.offset < 0 || edit.length < 0 || edit.offset + edit.length > this.result.length) throw new Error('Invalid edit range.');
      }
      this.deletion = false;
      for (const edit of [...command.edits].sort((a, b) => b.offset - a.offset)) {
        if (edit.offset < 0 || edit.length < 0 || edit.offset + edit.length > this.result.length) throw new Error('Invalid edit range.');
        this.edit(edit.offset, edit.offset + edit.length, normalize(edit.text));
      }
    } else if (command.type === 'accept') {
      // Apply from the end to keep the original result line coordinates valid.
      for (const h of [...this.hunks].reverse()) {
        this.replaceRows(h, this.sourceRows(h, command.side));
        h.resolved = { left: true, right: true }; h.applied = [command.side]; h.manual = false;
      }
      // Whole-file acceptance also discards edits outside tracked changes.
      this.rows = this.input[command.side].split('\n');
      for (const h of this.hunks) h.resultLines = { ...h[command.side === 'left' ? 'leftLines' : 'rightLines'] };
      this.refresh();
      this.deletion = Boolean(this.input[command.side === 'left' ? 'leftDeleted' : 'rightDeleted']);
    } else if (command.type === 'bulk' || command.type === 'magic') {
      for (const h of this.hunks) {
        if (!this.eligible(h)) continue;
        if (command.type === 'magic') {
          if (command.id !== undefined && h.id !== command.id) continue;
          if (!h.conflict) { this.apply(h, h.leftChanged ? 'left' : 'right'); continue; }
          if (!h.conflict || h.simple === null || this.input.leftDeleted || this.input.rightDeleted) continue;
          // MergeConflictModel passes the resolver's text through LineTokenizer
          // with skipLastEmptyLine=true before replacing the logical rows.
          const rows = h.simple.split('\n');
          if (rows.at(-1) === '') rows.pop();
          this.replaceRows(h, rows);
          h.resolved = { left: true, right: true };
        } else {
          if (h.conflict) continue;
          const side = command.side ?? (h.leftChanged ? 'left' : 'right');
          if (!h[side === 'left' ? 'leftChanged' : 'rightChanged']) continue;
          this.apply(h, side);
        }
      }
    } else {
      const h = this.hunks.find(h => h.id === command.id);
      if (!h) throw new Error('Unknown change.');
      if (command.type === 'apply') this.apply(h, command.side, command.resolve);
      if (command.type === 'ignore' && !h.resolved[command.side]) {
        if (h.conflict && !command.resolve) h.resolved[command.side] = true;
        else h.resolved = { left: true, right: true };
      }
      if (command.type === 'resolve') h.resolved = { left: true, right: true };
      if (command.type === 'reset') {
        this.replaceRows(h, this.input.base.split('\n').slice(h.baseLines.start, h.baseLines.end));
        h.resolved = { left: false, right: false }; h.applied = []; h.manual = false; this.deletion = false;
      }
    }
    if (JSON.stringify(before) === JSON.stringify(this.snapshot())) return false;
    this.past.push(before); this.future = []; return true;
  }
  undo(): boolean {
    const snapshot = this.past.pop(); if (!snapshot) return false;
    this.future.push(this.snapshot()); this.restore(snapshot); return true;
  }
  redo(): boolean {
    const snapshot = this.future.pop(); if (!snapshot) return false;
    this.past.push(this.snapshot()); this.restore(snapshot); return true;
  }
  private sourceRows(h: Hunk, side: Side): string[] {
    const range = side === 'left' ? h.leftLines : h.rightLines;
    return this.input[side].split('\n').slice(range.start, range.end);
  }
  private apply(h: Hunk, side: Side, resolve = false): void {
    if (h.resolved[side]) return;
    if (!h[side === 'left' ? 'leftChanged' : 'rightChanged']) { h.resolved = { left: true, right: true }; return; }
    const source = this.sourceRows(h, side);
    const current = this.rows.slice(h.resultLines.start, h.resultLines.end);
    // IntelliJ's oneside-applied state controls append independently from the
    // Ctrl/Cmd modifier, which only controls the resolved state afterwards.
    this.replaceRows(h, h.conflict && h.applied.length ? [...current, ...source] : source);
    h.applied.push(side); h.manual = false;
    const other = side === 'left' ? 'right' : 'left';
    h.resolved[side] = true;
    const otherLines = other === 'left' ? h.leftLines : h.rightLines;
    if (!h.conflict || resolve || otherLines.start === otherLines.end) h.resolved[other] = true;
  }
  private refresh(): void { for (const h of this.hunks) h.result = charRange(this.rows, h.resultLines); }
  private replaceRows(target: Hunk, rows: string[]): void {
    const { start, end } = target.resultLines;
    this.rows.splice(start, end - start, ...rows);
    const delta = rows.length - (end - start);
    for (const h of this.hunks) {
      if (h.id === target.id) h.resultLines = { start, end: start + rows.length };
      else if (h.id > target.id) { h.resultLines.start += delta; h.resultLines.end += delta; }
    }
    this.refresh();
  }
  private edit(start: number, end: number, text: string): void {
    if (start === end && !text) return;
    const original = this.result;
    const firstLine = original.slice(0, start).split('\n').length - 1;
    const lastLine = original.slice(0, end).split('\n').length;
    const delta = text.split('\n').length - (lastLine - firstLine);
    const touched: Hunk[] = [];
    for (const h of this.hunks) {
      const range = h.resultLines;
      // IntelliJ DiffUtil.updateRangeOnModification, non-greedy boundaries.
      if (range.end <= firstLine) continue;
      if (range.start >= lastLine) { range.start += delta; range.end += delta; continue; }
      touched.push(h);
      if (range.start <= firstLine && range.end >= lastLine) range.end += delta;
      else if (range.start >= firstLine && range.end <= lastLine) range.start = range.end = lastLine + delta;
      else if (range.start < firstLine) range.end = firstLine;
      else { range.start = lastLine + delta; range.end += delta; }
    }
    this.rows = (original.slice(0, start) + text + original.slice(end)).split('\n');
    const base = this.input.base.split('\n');
    for (const h of touched) {
      h.manual = !same(this.rows.slice(h.resultLines.start, h.resultLines.end), base.slice(h.baseLines.start, h.baseLines.end));
      const deletion = !h.conflict && ((h.leftChanged && h.leftLines.start === h.leftLines.end) || (h.rightChanged && h.rightLines.start === h.rightLines.end));
      if (deletion && h.resultLines.start === h.resultLines.end) h.resolved = { left: true, right: true };
    }
    this.refresh();
  }
}
