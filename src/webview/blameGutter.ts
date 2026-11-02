import { monaco } from './editor';
import type { BlameLine } from '../history';
import type { BlamePane, HistoryRequest, HistoryResponse } from '../historyProtocol';
import { shortDate } from '../blamePresentation';

let activeMenu: (() => void) | undefined;

/** An actual clickable annotation column, between Monaco's numbers and code. */
export class BlameGutter implements monaco.IDisposable {
  private column = document.createElement('div');
  private enabled = false;
  private requestId = 0;
  private expectedVersion = 0;
  private rows = new Map<number, BlameLine>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private frame = 0;
  private disposables: monaco.IDisposable[] = [];
  private baseWidth: number;
  private newest = '';
  private loading = false;
  private error = '';
  constructor(
    private editor: monaco.editor.IStandaloneCodeEditor, private pane: BlamePane,
    private post: (message: HistoryRequest) => void, private onHide?: () => void,
  ) {
    const width = editor.getRawOptions().lineDecorationsWidth;
    this.baseWidth = typeof width === 'number' ? width : 10;
    this.column.className = 'blame-column'; this.column.hidden = true;
    this.column.setAttribute('aria-label', 'Git blame annotations');
    editor.getContainerDomNode().classList.add('blame-host');
    editor.getContainerDomNode().append(this.column);
    const root = editor.getDomNode()!;
    const contextMenu = (event: MouseEvent): void => {
      const target = editor.getTargetAtClientPoint(event.clientX, event.clientY);
      if (target && [monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS, monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN, monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS].includes(target.type)) {
        event.preventDefault(); event.stopImmediatePropagation(); this.menu(event.clientX, event.clientY);
      }
    };
    root.addEventListener('contextmenu', contextMenu, true);
    this.column.addEventListener('contextmenu', event => { event.preventDefault(); this.menu(event.clientX, event.clientY); });
    this.disposables.push({ dispose: () => root.removeEventListener('contextmenu', contextMenu, true) });
    this.disposables.push(editor.onDidScrollChange(() => this.schedule()), editor.onDidLayoutChange(() => this.schedule()), editor.onDidChangeModelContent(() => this.refresh()));
    this.disposables.push(editor.onDidFocusEditorText(() => { if (!this.loading) this.refresh(); }));
    this.disposables.push(editor.addAction({ id: `merger.blame.${pane}`, label: 'Show / Hide Git Blame', contextMenuGroupId: 'gitBlame', run: () => this.toggle() }));
  }
  show(): void {
    if (this.enabled) { this.refresh(true); return; }
    this.enabled = true; this.column.hidden = false;
    this.editor.updateOptions({ lineDecorationsWidth: this.baseWidth + 200 });
    this.refresh(true);
  }
  hide(): void {
    const wasEnabled = this.enabled;
    this.enabled = false; this.requestId++; clearTimeout(this.timer);
    this.column.hidden = true; this.rows.clear(); this.column.replaceChildren();
    this.editor.updateOptions({ lineDecorationsWidth: this.baseWidth });
    if (wasEnabled) this.onHide?.();
  }
  toggle(): void { if (this.enabled) this.hide(); else this.show(); }
  refresh(immediate = false): void {
    if (!this.enabled) return;
    clearTimeout(this.timer); this.rows.clear(); this.loading = true; this.error = '';
    const id = ++this.requestId;
    const model = this.editor.getModel();
    if (!model) return;
    this.expectedVersion = model.getVersionId();
    this.schedule();
    this.timer = setTimeout(() => {
      if (this.enabled && id === this.requestId) this.post({ type: 'blame', pane: this.pane, requestId: id, text: model.getValue() });
    }, immediate ? 0 : 160);
  }
  receive(message: HistoryResponse): void {
    if (!this.enabled || message.pane !== this.pane || message.requestId !== this.requestId) return;
    if (this.editor.getModel()?.getVersionId() !== this.expectedVersion) { this.refresh(); return; }
    this.loading = false;
    if (message.type === 'blameError') this.error = message.message;
    else {
      this.rows = new Map(message.data.lines.map(line => [line.line, line]));
      this.newest = message.data.lines.filter(line => !line.uncommitted).reduce((latest, line) => line.authoredAt > latest ? line.authoredAt : latest, '');
    }
    this.schedule();
  }
  private schedule(): void { cancelAnimationFrame(this.frame); this.frame = requestAnimationFrame(() => this.render()); }
  private render(): void {
    if (!this.enabled) return;
    const layout = this.editor.getLayoutInfo();
    this.column.style.left = `${layout.decorationsLeft + this.baseWidth}px`;
    this.column.style.width = '200px';
    this.column.style.fontSize = `${this.editor.getOption(monaco.editor.EditorOption.fontSize)}px`;
    this.column.replaceChildren();
    if (this.loading || this.error) {
      const notice = document.createElement('div'); notice.className = 'blame-notice';
      notice.textContent = this.loading ? 'Loading Git blame…' : this.error;
      notice.title = notice.textContent; notice.setAttribute('role', this.error ? 'alert' : 'status');
      this.column.append(notice); return;
    }
    const ranges = this.editor.getVisibleRanges();
    if (!ranges.length) return;
    const start = Math.max(1, ranges[0].startLineNumber - 1);
    const end = ranges.at(-1)!.endLineNumber + 1;
    const height = this.editor.getOption(monaco.editor.EditorOption.lineHeight);
    for (let lineNumber = start; lineNumber <= end; lineNumber++) {
      const line = this.rows.get(lineNumber);
      if (!line) continue;
      const row = document.createElement('button'); row.className = 'blame-row';
      row.style.top = `${this.editor.getTopForLineNumber(lineNumber) - this.editor.getScrollTop()}px`;
      row.style.height = `${height}px`;
      const palette = line.uncommitted ? -1 : parseInt(line.commit.slice(0, 8), 16) % 5;
      row.dataset.color = String(palette); row.dataset.line = String(lineNumber); row.dataset.commit = line.commit;
      row.classList.toggle('latest', Boolean(this.newest) && line.authoredAt === this.newest && !line.uncommitted);
      const date = document.createElement('span'); date.className = 'blame-date'; date.textContent = line.uncommitted ? '*' : shortDate(line.authoredAt);
      const author = document.createElement('span'); author.className = 'blame-author'; author.textContent = line.author;
      row.append(date, author);
      row.disabled = line.uncommitted;
      row.title = line.uncommitted ? 'Not committed yet — no commit to open' : `${line.author} <${line.email}>\n${line.authoredAt}\n${line.commit}\n${line.summary}\n${line.path}:${line.originalLine}\nClick to open this commit and file`;
      row.setAttribute('aria-label', line.uncommitted ? `Line ${lineNumber}: not committed yet` : `Line ${lineNumber}: ${line.author}, ${shortDate(line.authoredAt)} — ${line.summary}`);
      row.addEventListener('click', () => this.post({ type: 'openCommit', pane: this.pane, requestId: this.requestId, line: lineNumber }));
      this.column.append(row);
    }
  }
  private menu(x: number, y: number): void {
    activeMenu?.();
    const menu = document.createElement('div'); menu.className = 'gutter-context-menu'; menu.setAttribute('role', 'menu');
    const item = document.createElement('button'); item.setAttribute('role', 'menuitem');
    item.textContent = this.enabled ? 'Hide Git Blame' : 'Show Git Blame';
    menu.append(item); document.body.append(menu);
    menu.style.left = `${Math.min(x, window.innerWidth - menu.offsetWidth - 8)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - menu.offsetHeight - 8)}px`;
    const outside = (event: MouseEvent): void => { if (!menu.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.preventDefault(); close(); this.editor.focus(); } };
    const close = (): void => {
      menu.remove(); document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', escape, true);
      if (activeMenu === close) activeMenu = undefined;
    };
    activeMenu = close;
    item.addEventListener('click', () => { close(); this.toggle(); this.editor.focus(); });
    document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', escape, true);
    item.focus();
  }
  dispose(): void {
    this.enabled = false; clearTimeout(this.timer); cancelAnimationFrame(this.frame);
    for (const disposable of this.disposables) disposable.dispose(); this.column.remove();
  }
}
