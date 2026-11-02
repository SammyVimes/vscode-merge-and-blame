import * as vscode from 'vscode';
import * as path from 'node:path';
import { realpath } from 'node:fs/promises';
import { commitDetails, commitFileDiff, isCommitHash, type CommitDetails } from './history';
import type { CommitRequest, CommitResponse } from './historyProtocol';
import { webviewHtml } from './webviewHtml';

interface GitApi {
  repositories: { rootUri: vscode.Uri }[];
  getRepository(uri: vscode.Uri): { rootUri: vscode.Uri } | null;
  openRepository(uri: vscode.Uri): Promise<{ rootUri: vscode.Uri } | null>;
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}

export class CommitInspector implements vscode.Disposable {
  private open = new Map<string, { panel: vscode.WebviewPanel; select: (filename: string, line: number) => Promise<void> }>();
  private reveals = new Set<vscode.Disposable>();
  constructor(private extensionUri: vscode.Uri) {}
  async show(root: string, hash: string, filename: string, line = 1): Promise<void> {
    if (!isCommitHash(hash)) throw new Error('Invalid commit identifier.');
    if (await this.showNative(root, hash, filename, line)) return;
    await this.showFallback(root, hash, filename, line);
  }
  private async showNative(root: string, hash: string, filename: string, line: number): Promise<boolean> {
    const extension = vscode.extensions.getExtension<{ getAPI(version: number): GitApi }>('vscode.git');
    if (!extension) return false;
    let api: GitApi;
    try { api = (extension.isActive ? extension.exports : await extension.activate()).getAPI(1); }
    catch { return false; }
    let repository = api.getRepository(vscode.Uri.file(root));
    // Git resolves symlinks in --show-toplevel; VS Code can register the same
    // repository under the workspace's spelling (e.g. /var vs /private/var).
    if (!repository) for (const candidate of api.repositories) {
      try { if (await realpath(candidate.rootUri.fsPath) === await realpath(root)) { repository = candidate; break; } }
      catch { /* A closed/deleted repository may still be in Git's API list. */ }
    }
    repository ??= await api.openRepository(vscode.Uri.file(root));
    if (!repository) return false;
    const rootUri = repository.rootUri;
    const details = await commitDetails(root, hash);
    if (!details.files.some(file => file.path === filename || file.oldPath === filename)) details.files.push({ path: filename, status: '=' });
    const selected = this.fileIndex(details, filename);
    // The public changes command uses VS Code's native multi-file diff. Put
    // the blamed file first so it receives focus on all supported VS Code
    // versions, including ones whose Git viewCommit command ignores revealUri.
    const files = [details.files[selected], ...details.files.filter((_, index) => index !== selected)];
    const resources = files.map(file => [
      vscode.Uri.joinPath(rootUri, file.path),
      details.parents[0] && !file.status.startsWith('A') ? api.toGitUri(vscode.Uri.joinPath(rootUri, file.oldPath ?? file.path), details.parents[0]) : undefined,
      !file.status.startsWith('D') ? api.toGitUri(vscode.Uri.joinPath(rootUri, file.path), hash) : undefined,
    ]);
    const historical = vscode.Uri.joinPath(rootUri, details.files[selected].path);
    const cancel = this.revealLine(historical, hash, line);
    try { await vscode.commands.executeCommand('vscode.changes', `${hash.slice(0, 8)} - ${details.subject}`, resources); }
    catch (error) { cancel.dispose(); throw error; }
    return true;
  }
  private revealLine(file: vscode.Uri, hash: string, line: number): vscode.Disposable {
    const focus = (): boolean => {
      for (const editor of vscode.window.visibleTextEditors) {
        const uri = editor.document.uri;
        if (uri.scheme !== 'git') continue;
        try {
          const query = JSON.parse(uri.query) as { path?: string; ref?: string };
          if (query.ref !== hash || query.path !== file.fsPath) continue;
          const position = new vscode.Position(Math.max(0, Math.min(line - 1, editor.document.lineCount - 1)), 0);
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
          return true;
        } catch { /* Other extensions can also provide git: documents. */ }
      }
      return false;
    };
    const subscription = vscode.window.onDidChangeVisibleTextEditors(() => { if (focus()) cancel.dispose(); });
    const timer = setTimeout(() => cancel.dispose(), 5000);
    const cancel = new vscode.Disposable(() => { subscription.dispose(); clearTimeout(timer); this.reveals.delete(cancel); });
    this.reveals.add(cancel);
    return cancel;
  }
  private async showFallback(root: string, hash: string, filename: string, line: number): Promise<void> {
    const key = `${root}\0${hash}`;
    const existing = this.open.get(key);
    if (existing) { existing.panel.reveal(); await existing.select(filename, line); return; }
    const details = await commitDetails(root, hash);
    // A merge/boundary commit can attribute a line in a file whose first-parent
    // diff is empty. Still focus its real snapshot, clearly labeled unchanged.
    if (!details.files.some(file => file.path === filename || file.oldPath === filename)) details.files.push({ path: filename, status: '=' });
    const panel = vscode.window.createWebviewPanel('threeWayMerger.commit', `Commit ${hash.slice(0, 8)}`, vscode.ViewColumn.Active, {
      enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
    });
    let selected = this.fileIndex(details, filename);
    let focusLine = line;
    let generation = 0;
    let disposed = false;
    const post = (message: CommitResponse): void => { if (!disposed) void panel.webview.postMessage(message); };
    const send = async (): Promise<void> => {
      const token = ++generation;
      const index = selected;
      const diff = await commitFileDiff(root, details, details.files[index]);
      if (token !== generation || disposed) return;
      panel.title = `${hash.slice(0, 8)} · ${path.basename(diff.file.path)}`;
      post({ type: 'commit', state: { details, diff, selected: index, line: focusLine } });
    };
    const receive = panel.webview.onDidReceiveMessage((message: CommitRequest) => {
      if (message?.type === 'close') { panel.dispose(); return; }
      if (message?.type === 'selectFile') {
        if (!Number.isInteger(message.index) || message.index < 0 || message.index >= details.files.length) return;
        selected = message.index; focusLine = 1;
      } else if (message?.type !== 'ready') return;
      void send().catch(error => post({ type: 'error', message: String(error) }));
    });
    this.open.set(key, { panel, select: async (name, line) => {
      if (!details.files.some(file => file.path === name || file.oldPath === name)) details.files.push({ path: name, status: '=' });
      selected = this.fileIndex(details, name); focusLine = line; await send();
    } });
    panel.onDidDispose(() => { disposed = true; receive.dispose(); this.open.delete(key); });
    panel.webview.html = webviewHtml(this.extensionUri, panel.webview, 'commit');
  }
  private fileIndex(commit: CommitDetails, filename: string): number {
    return Math.max(0, commit.files.findIndex(file => file.path === filename || file.oldPath === filename));
  }
  dispose(): void {
    for (const reveal of this.reveals) reveal.dispose();
    for (const value of this.open.values()) value.panel.dispose();
    this.open.clear();
  }
}
