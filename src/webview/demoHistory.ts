import type { BlameData } from '../history';
import type { BlamePane, CommitState, HistoryRequest, HistoryResponse } from '../historyProtocol';
import { lineEdits } from '../core/lineDiff';
import { CommitView } from './commitView';

/** Standalone preview data only. The extension always asks the real Git repo. */
export class DemoHistory {
  private shown = new Map<BlamePane, { id: number; data: BlameData; text: string }>();
  constructor(private input: () => { name: string; base: string }) {}
  handle(message: HistoryRequest, receive: (response: HistoryResponse) => void): void {
    if (message.type === 'blame') {
      const { name, base } = this.input();
      const rows = message.text.split('\n'); if (rows.at(-1) === '') rows.pop();
      const changes = message.pane === 'result' ? lineEdits(base.split('\n'), message.text.split('\n')) : [];
      const data: BlameData = { path: name, revision: '1'.repeat(40), lines: rows.map((_, index) => {
        const uncommitted = changes.some(edit => index >= edit.sideStart && index < edit.sideEnd);
        const group = Math.floor(index / 5) % 3;
        return { commit: String(uncommitted ? 0 : group + 1).repeat(40), author: uncommitted ? 'Not committed yet' : ['Alex Smith', 'Jane Doe', 'Sam Lee'][group],
          email: 'preview@example.invalid', authoredAt: ['2025-10-20T12:00:00Z', '2026-03-08T09:30:00Z', '2026-06-14T14:00:00Z'][group],
          summary: 'Example commit — browser preview', originalLine: index + 1, line: index + 1, path: name, uncommitted };
      }) };
      this.shown.set(message.pane, { id: message.requestId, data, text: message.text });
      receive({ type: 'blame', pane: message.pane, requestId: message.requestId, data });
    } else {
      const shown = this.shown.get(message.pane);
      const line = shown?.data.lines.find(line => line.line === message.line);
      if (!shown || shown.id !== message.requestId || !line || line.uncommitted) return;
      const dialog = document.createElement('dialog'); dialog.className = 'demo-commit-dialog';
      const container = document.createElement('div'); container.style.height = '100%'; dialog.append(container); document.body.append(dialog);
      const files = [{ status: 'M', path: 'README.md' }, { status: 'M', path: line.path }];
      const state: CommitState = { details: { hash: line.commit, parents: ['a'.repeat(40)], author: line.author, email: line.email,
        authoredAt: line.authoredAt, subject: line.summary, message: 'Illustrative sample history. In VS Code this view shows the actual Git commit and its changed files.', files },
        diff: { file: files[1], before: this.input().base, after: shown.text, binary: false }, selected: 1, line: line.originalLine };
      const view = new CommitView(container, index => {
        state.selected = index; state.line = 1;
        state.diff = { file: files[index], before: index ? this.input().base : '# Preview\n', after: index ? shown.text : '# Preview\nExample commit history.\n', binary: false };
        view.update(state);
      }, () => dialog.close());
      dialog.addEventListener('close', () => { view.dispose(); dialog.remove(); }, { once: true });
      dialog.showModal(); view.update(state);
    }
  }
}
