import type { BlameData, CommitDetails, CommitFileDiff } from './history';

export type BlamePane = 'left' | 'result' | 'right' | 'file';
export type HistoryRequest =
  | { type: 'blame'; pane: BlamePane; requestId: number; text: string }
  | { type: 'openCommit'; pane: BlamePane; requestId: number; line: number };
export type HistoryResponse =
  | { type: 'blame'; pane: BlamePane; requestId: number; data: BlameData }
  | { type: 'blameError'; pane: BlamePane; requestId: number; message: string };
export interface CommitState { details: CommitDetails; diff: CommitFileDiff; selected: number; line: number }
export type CommitRequest = { type: 'ready' | 'close' } | { type: 'selectFile'; index: number };
export type CommitResponse = { type: 'commit'; state: CommitState } | { type: 'error'; message: string };
