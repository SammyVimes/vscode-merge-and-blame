import { monaco, language } from './editor';
import type { CommitState } from '../historyProtocol';

export class CommitView implements monaco.IDisposable {
  private diff: monaco.editor.IStandaloneDiffEditor;
  constructor(private root: HTMLElement, private select: (index: number) => void, close: () => void) {
    root.classList.add('commit-view');
    root.innerHTML = '<header class="commit-heading"><div><strong class="commit-subject"></strong><div class="commit-metadata"></div></div><button class="close-commit" aria-label="Close commit">Close</button></header><pre class="commit-message"></pre><div class="commit-content"><nav class="commit-files" aria-label="Files in commit"></nav><section class="commit-file-view"><div class="commit-file-title"></div><div class="commit-error" role="alert" hidden></div><div class="commit-diff"></div></section></div>';
    root.querySelector('.close-commit')!.addEventListener('click', close);
    this.diff = monaco.editor.createDiffEditor(root.querySelector<HTMLElement>('.commit-diff')!, {
      automaticLayout: true, readOnly: true, originalEditable: false, renderSideBySide: false,
      renderOverviewRuler: false, renderMarginRevertIcon: false, ignoreTrimWhitespace: false,
      fontFamily: "'JetBrains Mono', Menlo, Consolas, monospace", fontSize: 13, lineHeight: 21,
      minimap: { enabled: false }, scrollBeyondLastLine: false, padding: { top: 10, bottom: 10 },
    });
    // The inline diff needs one vertical scrollbar, on the modified editor.
    this.diff.getOriginalEditor().updateOptions({ scrollbar: { vertical: 'hidden' } });
  }
  update(state: CommitState): void {
    const { details, diff, selected, line } = state;
    this.root.dataset.commit = details.hash; this.root.dataset.selectedPath = diff.file.path;
    this.root.querySelector('.commit-subject')!.textContent = details.subject;
    this.root.querySelector('.commit-metadata')!.textContent = `${details.hash} · ${details.author} <${details.email}> · ${details.authoredAt}`;
    this.root.querySelector('.commit-message')!.textContent = details.message;
    const files = this.root.querySelector('.commit-files')!; files.replaceChildren();
    details.files.forEach((file, index) => {
      const item = document.createElement('button'); item.className = 'commit-file';
      item.textContent = `${file.status}  ${file.oldPath ? `${file.oldPath} → ` : ''}${file.path}`;
      item.title = item.textContent; item.dataset.path = file.path;
      item.setAttribute('aria-current', String(index === selected));
      item.addEventListener('click', () => this.select(index)); files.append(item);
    });
    this.root.querySelector('.commit-file-title')!.textContent = `${diff.file.path} · ${details.parents[0] ? 'First parent' : 'Empty file'} ↔ ${details.hash.slice(0, 8)}`;
    const error = this.root.querySelector<HTMLElement>('.commit-error')!;
    error.hidden = !diff.binary; error.textContent = diff.binary ? 'Binary file — no textual diff is available.' : '';
    const old = this.diff.getModel();
    const model = { original: monaco.editor.createModel(diff.before, language(diff.file.path)), modified: monaco.editor.createModel(diff.after, language(diff.file.path)) };
    this.diff.setModel(model); old?.original.dispose(); old?.modified.dispose();
    const focus = Math.max(1, Math.min(line, model.modified.getLineCount()));
    const editor = this.diff.getModifiedEditor();
    editor.setPosition({ lineNumber: focus, column: 1 }); editor.revealLineInCenter(focus);
    void document.fonts.ready.then(() => monaco.editor.remeasureFonts());
  }
  error(message: string): void {
    const element = this.root.querySelector<HTMLElement>('.commit-error')!;
    element.hidden = false; element.textContent = message;
  }
  dispose(): void {
    const model = this.diff.getModel(); this.diff.dispose(); model?.original.dispose(); model?.modified.dispose();
    this.root.replaceChildren();
  }
}
