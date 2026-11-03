import type { Command, MergeInput, Snapshot } from './core/merge';
import type { HistoryRequest, HistoryResponse } from './historyProtocol';
import type { OpeningBrowserReport } from './openingTimingProtocol';

export interface EditorState {
  input: MergeInput;
  snapshot: Snapshot;
  canUndo: boolean;
  canRedo: boolean;
  fontSize: number;
  revision: number;
}
export type ToHost =
  | HistoryRequest
  | { type: 'openingTiming'; report: OpeningBrowserReport }
  | { type: 'ready' }
  | { type: 'command'; command: Command; revision: number }
  | { type: 'undo' | 'redo' | 'save' | 'complete' }
  | { type: 'compare'; a: 'base' | 'left' | 'right' | 'result'; b: 'base' | 'left' | 'right' | 'result' };
export type ToView = { type: 'state'; state: EditorState } | { type: 'error'; message: string }
  | { type: 'openingTimingRequest'; id: string } | HistoryResponse;
