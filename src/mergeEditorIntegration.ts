import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import { loadMerge, type GitMerge } from './git';
import { OpeningTimings, type OpeningTrace } from './openingTimings';

// VS Code does not expose a custom merge-editor provider. Its Git extension
// opens the built-in editor through this workbench command. Command registrations
// are stacked: disposing ours restores the original workbench handler.
const command = '_open.mergeEditor';
const setting = 'threeWayMerger.useAsDefaultMergeEditor';

export class MergeEditorIntegration implements vscode.Disposable {
  private registration?: vscode.Disposable;
  private readonly configuration: vscode.Disposable;
  private disposed = false;
  private passingThrough = 0;

  constructor(private readonly timings: OpeningTimings, private readonly openEditor: (uri: vscode.Uri, trace: OpeningTrace, prepared: GitMerge) => Promise<void>) {
    this.configuration = vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(setting)) this.update();
    });
    this.update();
  }

  private update(): void {
    const enabled = !this.disposed && vscode.workspace.getConfiguration().get(setting, true);
    if (!enabled) { this.registration?.dispose(); this.registration = undefined; }
    if (enabled && !this.registration && !this.passingThrough) {
      try {
        this.registration = vscode.commands.registerCommand(command, (...args: unknown[]) => this.open(args));
      } catch (error) {
        // Another extension may already have registered this command in our
        // extension host. Keep explicit opening and native Git commands usable.
        console.warn('Merge & Blame could not register the default merge editor:', error);
      }
    }
  }

  private async open(args: unknown[]): Promise<unknown> {
    const output = gitConflictOutput(args[0]);
    if (output && vscode.workspace.getConfiguration().get(setting, true)) {
      const trace = this.timings.begin(output, 'Native Git merge command handoff');
      try {
        // Our custom document reads the index and disk. Never replace unsaved
        // text in a native editor or attempt a binary/non-Git/custom-input merge.
        if (await trace.measure('Check unsaved text before preflight', () => hasDirtyText(output))) { trace.finish('Stopped: unsaved edits'); notifyDirty(); return; }
        const prepared = await trace.measure('Preflight: load Git inputs', () => loadMerge(output.fsPath, trace.scope('Preflight')));
        // Recheck after asynchronous Git reads in case the user typed meanwhile.
        if (await trace.measure('Check unsaved text after preflight', () => hasDirtyText(output))) { trace.finish('Stopped: unsaved edits'); notifyDirty(); return; }
        await this.openEditor(output, trace, prepared);
        return;
      } catch (error) {
        trace.finish('Falling back to the built-in merge editor');
        console.warn('Merge & Blame is leaving this merge to VS Code:', error);
      }
    }
    // Forward every argument unchanged. Leave the original handler registered
    // until it completes; registering ours sooner could redirect its own call.
    this.passingThrough++;
    this.registration?.dispose(); this.registration = undefined;
    try { return await vscode.commands.executeCommand(command, ...args); }
    finally { this.passingThrough--; this.update(); }
  }

  dispose(): void {
    this.disposed = true;
    this.configuration.dispose();
    this.update();
  }
}

function notifyDirty(): void {
  void vscode.window.showWarningMessage('Save your edits to this file before opening Merge & Blame.');
}

async function hasDirtyText(output: vscode.Uri): Promise<boolean> {
  const dirty = vscode.workspace.textDocuments.filter(document => document.isDirty && document.uri.scheme === 'file');
  if (dirty.some(document => document.uri.toString() === output.toString())) return true;
  if (!dirty.length) return false;
  const target = await fs.realpath(output.fsPath).catch(() => output.fsPath);
  for (const document of dirty) {
    const actual = await fs.realpath(document.uri.fsPath).catch(() => document.uri.fsPath);
    if (actual === target) return true;
  }
  return false;
}

function uri(value: unknown): vscode.Uri | undefined {
  if (value instanceof vscode.Uri) return value;
  if (typeof value === 'string') { try { return vscode.Uri.parse(value, true); } catch { /* invalid URI */ } }
  return undefined;
}

function gitConflictOutput(value: unknown): vscode.Uri | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as { base?: unknown; output?: unknown; input1?: unknown; input2?: unknown };
  const base = uri(input.base), output = uri(input.output);
  if (!base || base.scheme !== 'git' || !output || output.scheme !== 'file') return undefined;
  try {
    const params = JSON.parse(base.query) as { path?: string; ref?: string };
    if (params.ref !== ':1' || params.path !== output.fsPath) return undefined;
  } catch { return undefined; }
  for (const side of [input.input1, input.input2]) {
    const resource = uri(side) ?? (side && typeof side === 'object' ? uri((side as { uri?: unknown }).uri) : undefined);
    if (!resource || resource.scheme !== 'git') return undefined;
  }
  return output;
}
