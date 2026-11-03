import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { MergeSession, type Command, type Snapshot } from './core/merge';
import { edits, normalize } from './core/diff';
import { completeMerge, conflictFiles, hash, loadMerge, reuseMerge, rootFor, saveResult, type GitMerge } from './git';
import type { EditorState, ToHost, ToView } from './protocol';
import { BlameBridge } from './blameBridge';
import { mergeHistoryTarget } from './history';
import { CommitInspector } from './commitInspector';
import { LegacyBlameProvider, blameViewType, prepareLegacyBlameDocuments } from './fileBlameEditor';
import { NativeBlame } from './nativeBlame';
import { webviewHtml } from './webviewHtml';
import { MergeEditorIntegration } from './mergeEditorIntegration';
import { OpeningTimings, type OpeningTrace } from './openingTimings';
import { packInitialState } from './initialState';

const viewType = 'threeWayMerger.editor';
interface Stored { meta: GitMerge; snapshot: Snapshot }
class MergeDocument implements vscode.CustomDocument {
  readonly session: MergeSession;
  readonly disposeEmitter = new vscode.EventEmitter<void>();
  readonly onDidDispose = this.disposeEmitter.event;
  revision = 0;
  initializedBySetting = false;
  opening?: OpeningTrace;
  constructor(readonly uri: vscode.Uri, readonly meta: GitMerge, snapshot?: Snapshot) {
    this.session = new MergeSession(meta.input, snapshot);
  }
  dispose(): void { this.disposeEmitter.fire(); this.disposeEmitter.dispose(); }
}

class MergeProvider implements vscode.CustomEditorProvider<MergeDocument> {
  private changes = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<MergeDocument>>();
  readonly onDidChangeCustomDocument = this.changes.event;
  private panels = new Map<MergeDocument, vscode.WebviewPanel>();
  private prepared = new Map<string, { trace: OpeningTrace; meta: GitMerge }>();
  private comparisons = new Map<string, string>();
  private compareChanged = new vscode.EventEmitter<vscode.Uri>();
  constructor(private context: vscode.ExtensionContext, private inspector: CommitInspector, private timings: OpeningTimings) {
    context.subscriptions.push(this.changes, this.compareChanged, vscode.workspace.registerTextDocumentContentProvider('three-way-compare', {
      onDidChange: this.compareChanged.event,
      provideTextDocumentContent: uri => this.comparisons.get(uri.toString()) ?? '',
    }));
  }
  private cacheUri(meta: GitMerge): vscode.Uri | undefined {
    // Git gives us a physical root. Keep one saved session when native Git and
    // our conflict picker use different aliases such as /var and /private/var.
    const uri = vscode.Uri.file(path.join(meta.root, meta.relative));
    return this.context.storageUri && vscode.Uri.joinPath(this.context.storageUri, `${hash(uri.toString())}.json`);
  }
  async openCustomDocument(uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext): Promise<MergeDocument> {
    const trace = this.timings.take(uri);
    const prepared = this.prepared.get(uri.toString());
    if (prepared?.trace === trace) this.prepared.delete(uri.toString());
    trace.mark('Custom document opening started');
    try { return await trace.measure('Open custom document', () => this.loadDocument(uri, openContext.backupId, true, trace, prepared?.trace === trace ? prepared.meta : undefined)); }
    catch (error) { trace.finish('Custom document opening failed'); throw error; }
  }
  async open(uri: vscode.Uri, suppliedTrace?: OpeningTrace, prepared?: GitMerge): Promise<void> {
    const trace = suppliedTrace ?? this.timings.begin(uri, 'Merge & Blame command');
    this.timings.prepare(uri, trace);
    if (prepared) this.prepared.set(uri.toString(), { trace, meta: prepared });
    try {
      await trace.measure('vscode.openWith returned', () => Promise.resolve(vscode.commands.executeCommand('vscode.openWith', uri, viewType)));
      const entry = [...this.panels].find(([document]) => document.uri.toString() === uri.toString());
      if (entry && entry[0].opening !== trace) {
        trace.mark('Existing custom editor revealed');
        void entry[1].webview.postMessage({ type: 'openingTimingRequest', id: trace.id } satisfies ToView);
      }
    } catch (error) { trace.finish('Open With failed'); throw error; }
    finally {
      if (this.prepared.get(uri.toString())?.trace === trace) this.prepared.delete(uri.toString());
      this.timings.release(uri, trace);
    }
  }
  private async loadDocument(uri: vscode.Uri, backupId?: string, initialize = true, trace?: OpeningTrace, prepared?: GitMerge): Promise<MergeDocument> {
    if (uri.scheme !== 'file') throw new Error('Open a file in a local or remote Git working tree.');
    const meta = prepared
      ? await (trace ? trace.measure('Document: verify preflight inputs', () => reuseMerge(uri.fsPath, prepared, trace.scope('Document'))) : reuseMerge(uri.fsPath, prepared))
      : trace
      ? await trace.measure('Document: load Git inputs', () => loadMerge(uri.fsPath, trace.scope('Document')))
      : await loadMerge(uri.fsPath);
    if (prepared) trace?.mark(meta === prepared ? 'Document: reused preflight inputs' : 'Document: preflight changed; inputs reloaded');
    trace?.mark(`Inputs: base ${meta.input.base.length}, local ${meta.input.left.length}, incoming ${meta.input.right.length} UTF-16 characters`);
    const storage = this.context.storageUri;
    const keys = [...new Set([vscode.Uri.file(path.join(meta.root, meta.relative)), uri].map(value => `${hash(value.toString())}.json`))];
    const caches = backupId ? [vscode.Uri.parse(backupId)] : [
      ...(storage ? keys.map(key => vscode.Uri.joinPath(storage, key)) : []),
      // The Marketplace rename changed the extension's storage directory.
      ...(storage ? keys.map(key => vscode.Uri.joinPath(storage, '..', 'vscode-diff.three-way-merger', key)) : []),
    ];
    const readSaved = async (): Promise<Stored | undefined> => {
      for (const cache of caches) {
        try {
          // In a workspace extension, file: storage is on this host. Using the
          // VS Code filesystem API here sends each miss through the UI bridge.
          const bytes = cache.scheme === 'file' ? await fs.readFile(cache.fsPath) : await vscode.workspace.fs.readFile(cache);
          const candidate: Stored = JSON.parse(Buffer.from(bytes).toString());
          if (candidate.meta.fingerprint === meta.fingerprint && candidate.meta.diskHash === meta.diskHash) return candidate;
        } catch { /* first session or expired backup */ }
      }
      return undefined;
    };
    const cacheLabel = `Saved-session reads (${caches.length} unique paths; ${caches.every(cache => cache.scheme === 'file') ? 'direct host filesystem' : 'VS Code filesystem fallback'})`;
    const saved = trace ? await trace.measure(cacheLabel, readSaved) : await readSaved();
    trace?.mark(`Saved-session lookup finished (${saved ? 'matched' : 'no match'})`);
    let snapshot = saved?.meta.fingerprint === meta.fingerprint && saved.meta.diskHash === meta.diskHash ? saved.snapshot : undefined;
    // A conflict can already contain manual work from another editor. Import a
    // marker-free result as the baseline rather than replacing it with the base.
    if (!snapshot && meta.diskHash !== 'missing' && !meta.input.leftDeleted && !meta.input.rightDeleted) {
      const existing = normalize(await fs.readFile(uri.fsPath, 'utf8')).replace(/^\uFEFF/, '');
      if (!/^<{7,} |^={7,}$|^>{7,} /m.test(existing) && existing !== normalize(meta.input.base)) {
        const imported = new MergeSession(meta.input);
        const changes = edits(imported.result, existing).map(edit => ({ offset: edit.start, length: edit.end - edit.start, text: edit.text }));
        imported.perform({ type: 'edit', edits: changes });
        snapshot = imported.snapshot();
      }
    }
    trace?.mark('Existing working-result import finished');
    const document = trace ? trace.sync('Compute host merge model', () => new MergeDocument(uri, meta, snapshot)) : new MergeDocument(uri, meta, snapshot);
    document.opening = trace;
    if (initialize && !snapshot && vscode.workspace.getConfiguration('threeWayMerger').get('autoApplyNonConflicting', false)) {
      document.initializedBySetting = document.session.perform({ type: 'bulk' });
    }
    return document;
  }
  async resolveCustomEditor(document: MergeDocument, panel: vscode.WebviewPanel): Promise<void> {
    document.opening?.mark('Webview resolution started');
    this.panels.set(document, panel);
    panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')] };
    const blame = new BlameBridge(['left', 'result', 'right'], pane => mergeHistoryTarget(document.meta, pane as 'left' | 'result' | 'right'), this.inspector, message => this.post(document, message));
    let disposed = false;
    let queue = Promise.resolve();
    const receive = panel.webview.onDidReceiveMessage((message: ToHost) => {
      if (message?.type === 'openingTiming') { this.timings.receive(message.report); return; }
      if (blame.handle(message)) return;
      queue = queue.then(() => this.message(document, message)).catch(error => {
        this.post(document, { type: 'error', message: error instanceof Error ? error.message : String(error) });
        this.send(document);
      });
    });
    panel.onDidDispose(() => { disposed = true; blame.dispose(); receive.dispose(); this.panels.delete(document); });
    const pack = () => packInitialState(this.state(document));
    const initial = document.opening ? await document.opening.measure('Pack initial state for HTML', pack) : await pack();
    if (disposed) { document.opening?.finish('Editor closed before initialization'); return; }
    document.opening?.mark(`Initial state in HTML: ${initial.bytes} gzip bytes (${initial.expandedBytes} JSON bytes)`);
    panel.webview.html = webviewHtml(this.context.extensionUri, panel.webview, 'webview', document.opening?.id, initial);
    document.opening?.mark('Webview HTML assigned');
  }
  private post(document: MergeDocument, message: ToView): void { void this.panels.get(document)?.webview.postMessage(message); }
  private state(document: MergeDocument): EditorState {
    return {
      input: document.session.input, snapshot: document.session.snapshot(),
      canUndo: document.session.canUndo, canRedo: document.session.canRedo,
      revision: document.revision,
      fontSize: vscode.workspace.getConfiguration('threeWayMerger').get('fontSize', 13),
    };
  }
  private send(document: MergeDocument): void {
    this.post(document, { type: 'state', state: this.state(document) });
  }
  private async message(document: MergeDocument, message: ToHost): Promise<void> {
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'ready') {
      document.opening?.mark('Webview ready message received');
      if (document.initializedBySetting) {
        document.initializedBySetting = false;
        this.record(document, 'Apply non-conflicting changes');
      }
      if (message.initialRevision === document.revision) {
        document.opening?.mark('Initial HTML state acknowledged; ready round trip skipped');
        return;
      }
      document.opening?.mark('Initial state sending started');
      this.send(document);
      document.opening?.mark('Initial state posted');
      return;
    }
    if (message.type === 'command') {
      if (message.revision !== document.revision) throw new Error('The editor was updated elsewhere. Your view has been refreshed; retry the change.');
      const changed = document.session.perform(message.command);
      document.revision++;
      if (changed) {
        this.record(document, label(message.command));
      }
      this.send(document);
    }
    if (message.type === 'undo' || message.type === 'redo') await vscode.commands.executeCommand(message.type);
    if (message.type === 'save') await vscode.commands.executeCommand('workbench.action.files.save');
    if (message.type === 'complete') {
      if (document.session.remaining.length) throw new Error('Resolve or explicitly mark all remaining changes before completing this file.');
      await completeMerge(document.uri.fsPath, document.meta, document.session.result, document.session.deletion);
      const cache = this.cacheUri(document.meta);
      if (cache) await vscode.workspace.fs.delete(cache).then(undefined, () => undefined);
      // The resulting file has been written and staged. Revert the editor's dirty
      // flag through its save lifecycle before closing, without writing it again.
      this.completed.add(document);
      await vscode.commands.executeCommand('workbench.action.files.save');
      this.panels.get(document)?.dispose();
      void vscode.window.showInformationMessage(`Resolved and staged ${document.meta.relative}.`);
    }
    if (message.type === 'compare') {
      const value = (side: typeof message.a): string => side === 'result' ? document.session.result : document.session.input[side];
      const uri = (side: typeof message.a): vscode.Uri => {
        const u = vscode.Uri.from({ scheme: 'three-way-compare', path: `/${hash(document.uri.toString()).slice(0, 12)}/${side}/${document.session.input.name}`, query: String(document.revision) });
        this.comparisons.set(u.toString(), value(side)); return u;
      };
      await vscode.commands.executeCommand('vscode.diff', uri(message.a), uri(message.b), `${message.a} ↔ ${message.b} · ${document.session.input.name}`);
    }
  }
  private record(document: MergeDocument, label: string): void {
    this.changes.fire({ document, label, undo: async () => {
      document.session.undo(); document.revision++; this.send(document);
    }, redo: async () => {
      document.session.redo(); document.revision++; this.send(document);
    } });
  }
  private completed = new WeakSet<MergeDocument>();
  async saveCustomDocument(document: MergeDocument): Promise<void> {
    if (this.completed.has(document)) return;
    await saveResult(document.uri.fsPath, document.meta, document.session.result, document.session.deletion);
    const cache = this.cacheUri(document.meta);
    if (cache) {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(cache, '..'));
      await vscode.workspace.fs.writeFile(cache, Buffer.from(JSON.stringify({ meta: document.meta, snapshot: document.session.snapshot() } satisfies Stored)));
    }
  }
  async saveCustomDocumentAs(document: MergeDocument, destination: vscode.Uri): Promise<void> {
    await vscode.workspace.fs.writeFile(destination, Buffer.from((document.meta.bom ? '\uFEFF' : '') + document.session.result.replace(/\n/g, document.meta.eol)));
  }
  async revertCustomDocument(document: MergeDocument): Promise<void> {
    const fresh = await this.loadDocument(document.uri, undefined, false);
    Object.assign(document.meta, fresh.meta);
    // Restore the saved baseline, including resolution state, with fresh history.
    Object.assign(document.session, fresh.session);
    fresh.dispose();
    document.initializedBySetting = false;
    document.revision++;
    this.send(document);
  }
  async backupCustomDocument(document: MergeDocument, context: vscode.CustomDocumentBackupContext): Promise<vscode.CustomDocumentBackup> {
    await vscode.workspace.fs.writeFile(context.destination, Buffer.from(JSON.stringify({ meta: document.meta, snapshot: document.session.snapshot() } satisfies Stored)));
    return { id: context.destination.toString(), delete: async () => { await vscode.workspace.fs.delete(context.destination).then(undefined, () => undefined); } };
  }
}
function label(command: Command): string {
  return ({ apply: 'Apply change', ignore: 'Ignore change', reset: 'Revert resolution', resolve: 'Mark change resolved', bulk: 'Apply non-conflicting changes', magic: 'Resolve simple conflicts', edit: 'Edit merge result', accept: 'Accept version' })[command.type];
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await prepareLegacyBlameDocuments();
  const inspector = new CommitInspector(context.extensionUri);
  const blame = new NativeBlame(inspector);
  const timings = new OpeningTimings(context.extension.packageJSON.version);
  context.subscriptions.push(timings);
  const provider = new MergeProvider(context, inspector, timings);
  context.subscriptions.push(inspector, blame,
    vscode.window.registerCustomEditorProvider(blameViewType, new LegacyBlameProvider(blame), { supportsMultipleEditorsPerDocument: false }));
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(viewType, provider, { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }));
  context.subscriptions.push(new MergeEditorIntegration(timings, (uri, trace, prepared) => provider.open(uri, trace, prepared)));
  const open = async (resource?: vscode.Uri | { resourceUri: vscode.Uri }): Promise<void> => {
    try {
      const uri = resource instanceof vscode.Uri ? resource : resource?.resourceUri ?? vscode.window.activeTextEditor?.document.uri;
      if (!uri) { await chooseConflict(); return; }
      await provider.open(uri);
    } catch (error) { void vscode.window.showErrorMessage(String(error)); }
  };
  const chooseConflict = async (): Promise<void> => {
    try {
      const roots = new Set<string>();
      for (const folder of vscode.workspace.workspaceFolders ?? []) {
        try { roots.add(await rootFor(path.join(folder.uri.fsPath, '.merge-root'))); } catch { /* not a Git root */ }
      }
      const files = (await Promise.all([...roots].map(conflictFiles))).flat();
      if (!files.length) { void vscode.window.showInformationMessage('No unresolved Git conflicts in this workspace.'); return; }
      const pick = await vscode.window.showQuickPick(files.map(file => ({ label: path.basename(file), description: vscode.workspace.asRelativePath(file), file })), { placeHolder: 'Select a file to merge' });
      if (pick) await open(vscode.Uri.file(pick.file));
    } catch (error) { void vscode.window.showErrorMessage(String(error)); }
  };
  context.subscriptions.push(vscode.commands.registerCommand('threeWayMerger.open', open), vscode.commands.registerCommand('threeWayMerger.openConflicts', chooseConflict));
}
