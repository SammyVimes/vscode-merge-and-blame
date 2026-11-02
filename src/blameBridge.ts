import { blameText, type BlameData, type HistoryTarget } from './history';
import { CommitInspector } from './commitInspector';
import type { BlamePane, HistoryRequest, HistoryResponse } from './historyProtocol';

/** Read-only history requests are independent from the merge/edit command queue. */
export class BlameBridge {
  private pending = new Map<BlamePane, number>();
  private displayed = new Map<BlamePane, { id: number; data: BlameData; target: HistoryTarget }>();
  private closed = false;
  constructor(
    private panes: BlamePane[], private target: (pane: BlamePane) => Promise<HistoryTarget>,
    private inspector: CommitInspector, private post: (message: HistoryResponse) => void,
  ) {}
  handle(value: unknown): boolean {
    const message = value as HistoryRequest;
    if (!message || !['blame', 'openCommit'].includes(message.type)) return false;
    if (!this.panes.includes(message.pane) || !Number.isInteger(message.requestId)) return true;
    void this.run(message).catch(error => {
      if (!this.closed) this.post({ type: 'blameError', pane: message.pane, requestId: message.requestId, message: error instanceof Error ? error.message : String(error) });
    });
    return true;
  }
  private async run(message: HistoryRequest): Promise<void> {
    if (message.type === 'blame') {
      if (typeof message.text !== 'string' || message.text.length > 24 * 1024 * 1024) throw new Error('This file is too large to annotate.');
      this.pending.set(message.pane, message.requestId);
      const target = await this.target(message.pane);
      const data = await blameText(target, message.text);
      if (this.closed || this.pending.get(message.pane) !== message.requestId) return;
      this.displayed.set(message.pane, { id: message.requestId, data, target });
      this.post({ type: 'blame', pane: message.pane, requestId: message.requestId, data });
    } else {
      const shown = this.displayed.get(message.pane);
      if (!shown || shown.id !== message.requestId) throw new Error('Blame changed. Refresh the annotations before opening this commit.');
      const line = shown.data.lines.find(line => line.line === message.line);
      if (!line || line.uncommitted) return;
      await this.inspector.show(shown.target.root, line.commit, line.path, line.originalLine);
    }
  }
  dispose(): void { this.closed = true; this.pending.clear(); this.displayed.clear(); }
}
