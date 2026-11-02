import * as vscode from 'vscode';
import * as path from 'node:path';
import { blameText, workingHistoryTarget, type BlameData, type BlameLine, type HistoryTarget } from './history';
import { annotationText } from './blamePresentation';
import { CommitInspector } from './commitInspector';

const openCommand = 'threeWayMerger.openBlameCommit';
interface State {
  document: vscode.TextDocument;
  generation: number;
  version: number;
  timer?: ReturnType<typeof setTimeout>;
  data?: BlameData;
  target?: HistoryTarget;
  error?: string;
  newest?: string;
  decorations?: vscode.DecorationOptions[][];
}
interface GitRepository { rootUri: vscode.Uri; state: { onDidChange: vscode.Event<void> } }
interface GitApi { repositories: GitRepository[]; onDidOpenRepository: vscode.Event<GitRepository>; onDidCloseRepository: vscode.Event<GitRepository> }

/** Native decorations never replace the editor or participate in document edits. */
export class NativeBlame implements vscode.Disposable {
  private states = new Map<string, State>();
  private subscriptions: vscode.Disposable[] = [];
  private repositories = new Map<GitRepository, vscode.Disposable>();
  private decorations: vscode.TextEditorDecorationType[] = [];
  private rendered = new WeakMap<vscode.TextEditor, vscode.DecorationOptions[][]>();
  private closed = false;
  constructor(private inspector: CommitInspector) {
    const dark = ['#2b3c38', '#303e53', '#433f2c', '#493638', '#3e354c', '#303238'];
    const light = ['#e3efe8', '#e4ecf7', '#f2eedc', '#f4e5e5', '#ede5f4', '#eeeeee'];
    for (const bold of [false, true]) for (let i = 0; i < dark.length; i++) {
      this.decorations.push(vscode.window.createTextEditorDecorationType({
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        before: { width: '28ch', margin: '0 1ch 0 0', fontWeight: bold ? 'bold' : 'normal', fontStyle: 'normal' },
        dark: { before: { backgroundColor: dark[i], color: i === 5 ? '#9399a3' : '#c2cad5' } },
        light: { before: { backgroundColor: light[i], color: i === 5 ? '#777777' : '#42474e' } },
      }));
    }
    this.subscriptions.push(
      vscode.commands.registerCommand('threeWayMerger.showBlame', (resource?: unknown) => this.show(resource)),
      vscode.commands.registerCommand('threeWayMerger.hideBlame', (resource?: unknown) => this.hide(resource)),
      vscode.commands.registerCommand(openCommand, (resource?: unknown, version?: number, line?: number, commit?: string, file?: string, originalLine?: number) => this.openCommit(resource, version, line, commit, file, originalLine)),
      vscode.workspace.onDidChangeTextDocument(event => { const state = this.states.get(event.document.uri.toString()); if (state) this.schedule(state); }),
      vscode.workspace.onDidCloseTextDocument(document => this.hide(document.uri)),
      vscode.window.onDidChangeVisibleTextEditors(editors => { for (const editor of editors) this.render(editor); }),
      vscode.window.onDidChangeActiveTextEditor(editor => { this.context(); const state = editor && this.states.get(editor.document.uri.toString()); if (state) this.schedule(state); }),
    );
    void this.observeGit();
  }
  private uri(resource?: unknown): vscode.Uri | undefined {
    if (resource instanceof vscode.Uri) return resource;
    if (typeof resource === 'string') return vscode.Uri.parse(resource);
    const value = resource as { uri?: vscode.Uri; resourceUri?: vscode.Uri } | undefined;
    return value?.uri ?? value?.resourceUri ?? vscode.window.activeTextEditor?.document.uri;
  }
  async show(resource?: unknown): Promise<void> {
    try {
      const uri = this.uri(resource);
      if (!uri || uri.scheme !== 'file') throw new Error('Open a file in a Git working tree to show its blame.');
      // A gutter action already has its target editor. Never reopen/swap it.
      const editor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === uri.toString());
      if (!editor) throw new Error('Show Git Blame from the open file’s line-number gutter.');
      let state = this.states.get(uri.toString());
      if (!state) {
        state = { document: editor.document, generation: 0, version: editor.document.version };
        this.states.set(uri.toString(), state);
      }
      this.context();
      this.renderDocument(state.document);
      clearTimeout(state.timer);
      await this.reload(state);
    } catch (error) { void vscode.window.showErrorMessage(String(error)); }
  }
  hide(resource?: unknown): void {
    const uri = this.uri(resource); if (!uri) return;
    const state = this.states.get(uri.toString());
    if (!state) return;
    clearTimeout(state.timer); state.generation++;
    this.states.delete(uri.toString());
    for (const editor of vscode.window.visibleTextEditors) if (editor.document.uri.toString() === uri.toString()) this.clear(editor);
    this.context();
  }
  private context(): void {
    const uri = vscode.window.activeTextEditor?.document.uri.toString();
    void vscode.commands.executeCommand('setContext', 'threeWayMerger.nativeBlameVisible', Boolean(uri && this.states.has(uri)));
  }
  private schedule(state: State): void {
    clearTimeout(state.timer); state.generation++;
    if (state.error) state.decorations = undefined;
    state.error = undefined;
    // Focus and Git events can refresh unchanged text. Keep its annotation
    // column in place while loading; edits must clear the now-stale mapping.
    if (state.document.version !== state.version) { state.data = undefined; state.decorations = undefined; }
    this.renderDocument(state.document);
    state.timer = setTimeout(() => { void this.reload(state); }, 180);
  }
  private async reload(state: State): Promise<void> {
    const generation = ++state.generation;
    const version = state.document.version;
    const text = state.document.getText();
    const current = (): boolean => !this.closed && this.states.get(state.document.uri.toString()) === state && generation === state.generation && version === state.document.version;
    try {
      if (text.length > 24 * 1024 * 1024) throw new Error('This file is too large to annotate.');
      const target = await workingHistoryTarget(state.document.uri.fsPath);
      const data = await blameText(target, text);
      if (!current()) return;
      state.data = data; state.target = target; state.version = version; state.error = undefined; state.decorations = undefined;
      state.newest = data.lines.filter(line => !line.uncommitted).reduce((date, line) => line.authoredAt > date ? line.authoredAt : date, '');
      this.renderDocument(state.document);
    } catch (error) {
      if (!current()) return;
      state.data = undefined; state.error = error instanceof Error ? error.message : String(error); state.decorations = undefined;
      this.renderDocument(state.document);
    }
  }
  private clear(editor: vscode.TextEditor): void {
    if (!this.rendered.has(editor)) return;
    for (const type of this.decorations) editor.setDecorations(type, []);
    this.rendered.delete(editor);
  }
  private renderDocument(document: vscode.TextDocument): void {
    for (const editor of vscode.window.visibleTextEditors) if (editor.document === document) this.render(editor);
  }
  private render(editor: vscode.TextEditor): void {
    const state = this.states.get(editor.document.uri.toString());
    if (!state) { this.clear(editor); return; }
    const groups = state.decorations ??= this.buildDecorations(state);
    if (this.rendered.get(editor) === groups) return;
    groups.forEach((values, index) => editor.setDecorations(this.decorations[index], values));
    this.rendered.set(editor, groups);
  }
  private buildDecorations(state: State): vscode.DecorationOptions[][] {
    const groups = this.decorations.map(() => [] as vscode.DecorationOptions[]);
    const document = state.document;
    // Reserve the same column while edited lines are being reattributed. This
    // never changes document text, and no code shifts left during a refresh.
    if (document.version !== state.version || !state.data) {
      for (let index = 0; index < document.lineCount; index++) {
        const native = document.lineAt(index);
        groups[5].push({ range: native.text.length ? native.range : native.rangeIncludingLineBreak,
          renderOptions: { before: { contentText: index ? ' ' : state.error ? 'Git blame unavailable' : 'Loading Git blame…' } },
          hoverMessage: state.error ? new vscode.MarkdownString().appendText(state.error) : undefined });
      }
      return groups;
    }
    // Install annotations for the complete buffer once. Monaco virtualizes the
    // DOM itself; scrolling must never wait for another extension-host message,
    // especially over SSH. Reuse these options until the blame data changes.
    for (const line of state.data.lines) {
      if (line.line < 1 || line.line > document.lineCount) continue;
      const native = document.lineAt(line.line - 1);
      const color = line.uncommitted ? 5 : parseInt(line.commit.slice(0, 8), 16) % 5;
      const bold = !line.uncommitted && Boolean(state.newest) && line.authoredAt === state.newest;
      groups[color + (bold ? 6 : 0)].push({
        range: native.text.length ? native.range : native.rangeIncludingLineBreak,
        renderOptions: { before: { contentText: annotationText(line) } },
        hoverMessage: this.hover(state, line),
      });
    }
    // Git has no blame record for the empty editor line after a final newline.
    for (let index = state.data.lines.length; index < document.lineCount; index++) {
      groups[5].push({ range: document.lineAt(index).range, renderOptions: { before: { contentText: ' ' } } });
    }
    return groups;
  }
  private hover(state: State, line: BlameLine): vscode.MarkdownString {
    const text = new vscode.MarkdownString();
    if (line.uncommitted) return text.appendText('Not committed yet — no commit to open.');
    text.appendText(`${line.author} <${line.email}>\n${line.authoredAt}\n${line.commit}\n${line.summary}\n${line.path}:${line.originalLine}`);
    const args = encodeURIComponent(JSON.stringify([state.document.uri.toString(), state.version, line.line, line.commit, line.path, line.originalLine]));
    text.appendMarkdown(`\n\n[Open commit](command:${openCommand}?${args})`);
    text.isTrusted = { enabledCommands: [openCommand] };
    return text;
  }
  private async openCommit(resource?: unknown, version?: number, requestedLine?: number, commit?: string, file?: string, originalLine?: number): Promise<void> {
    try {
      const uri = this.uri(resource);
      const state = uri && this.states.get(uri.toString());
      if (!state?.data || !state.target || state.version !== state.document.version || version !== undefined && version !== state.version) {
        throw new Error('The annotations changed. Wait for Git blame to refresh and open the commit again.');
      }
      const context = resource as { lineNumber?: number } | undefined;
      const number = requestedLine ?? context?.lineNumber ?? (vscode.window.activeTextEditor?.selection.active.line ?? 0) + 1;
      const line = state.data.lines.find(line => line.line === number);
      // A hover can remain open during an identical Git refresh. Validate its
      // actual attribution instead of invalidating it for every request ID.
      if (commit !== undefined && (!line || line.commit !== commit || line.path !== file || line.originalLine !== originalLine)) {
        throw new Error('The annotations changed. Open the refreshed annotation to inspect its commit.');
      }
      if (!line || line.uncommitted) { void vscode.window.showInformationMessage('This line has not been committed yet.'); return; }
      await this.inspector.show(state.target.root, line.commit, line.path, line.originalLine);
    } catch (error) { void vscode.window.showErrorMessage(String(error)); }
  }
  private async observeGit(): Promise<void> {
    // Optional read-only Git API subscription also covers commits/checkouts that
    // do not change the displayed text. No Git extension is required for blame.
    try {
      const extension = vscode.extensions.getExtension<{ getAPI(version: number): GitApi }>('vscode.git');
      if (!extension) return;
      const api = (extension.isActive ? extension.exports : await extension.activate()).getAPI(1);
      if (this.closed) return;
      const watch = (repository: GitRepository): void => {
        if (this.repositories.has(repository)) return;
        this.repositories.set(repository, repository.state.onDidChange(() => {
          for (const state of this.states.values()) {
            const relative = path.relative(repository.rootUri.fsPath, state.document.uri.fsPath);
            if (relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) this.schedule(state);
          }
        }));
      };
      api.repositories.forEach(watch);
      this.subscriptions.push(api.onDidOpenRepository(watch), api.onDidCloseRepository(repository => { this.repositories.get(repository)?.dispose(); this.repositories.delete(repository); }));
    } catch { /* Native document/focus events still refresh without Git's API. */ }
  }
  dispose(): void {
    this.closed = true;
    for (const state of this.states.values()) clearTimeout(state.timer);
    this.states.clear();
    for (const disposable of [...this.subscriptions, ...this.decorations, ...this.repositories.values()]) disposable.dispose();
    this.repositories.clear();
    void vscode.commands.executeCommand('setContext', 'threeWayMerger.nativeBlameVisible', false);
  }
}
