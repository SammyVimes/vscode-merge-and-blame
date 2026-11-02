import * as vscode from 'vscode';
import { NativeBlame } from './nativeBlame';
import { open } from 'node:fs/promises';

// Compatibility for tabs persisted by versions 0.2.0/0.2.1. New blame actions
// never open this editor; it only hands existing dirty documents back to VS Code.
export const blameViewType = 'threeWayMerger.blame';
export class LegacyBlameProvider implements vscode.CustomTextEditorProvider {
  constructor(private blame: NativeBlame) {}
  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    let switching = false;
    const restore = async (): Promise<void> => {
      if (!panel.active || switching) return;
      switching = true;
      await vscode.commands.executeCommand('reopenActiveEditorWith', 'default');
      await this.blame.show(document.uri);
    };
    const schedule = (): void => { setTimeout(() => { void restore().catch(error => { switching = false; void vscode.window.showErrorMessage(String(error)); }); }, 0); };
    const changed = panel.onDidChangeViewState(schedule);
    panel.onDidDispose(() => changed.dispose());
    panel.webview.html = '<!doctype html><html><body>Restoring the native editor…</body></html>';
    // Opening a text editor while this provider is still resolving can wait on
    // this very promise. Yield first so the old custom editor finishes opening.
    schedule();
  }
}

/** Seed the write encoding before VS Code restores a custom-editor text backup.
 * Text backups are always UTF-8; custom inputs do not serialize their encoding.
 * Loading the text document first supplies the missing BOM preference without
 * saving, replacing, or otherwise changing its unsaved contents.
 */
export async function prepareLegacyBlameDocuments(): Promise<void> {
  const uris = new Map<string, vscode.Uri>();
  for (const group of vscode.window.tabGroups.all) for (const tab of group.tabs) {
    if (tab.input instanceof vscode.TabInputCustom && tab.input.viewType === blameViewType && tab.input.uri.scheme === 'file') uris.set(tab.input.uri.toString(), tab.input.uri);
  }
  for (const uri of uris.values()) {
    let bom = false;
    try {
      const file = await open(uri.fsPath, 'r');
      try { const bytes = Buffer.alloc(3); const result = await file.read(bytes, 0, 3, 0); bom = result.bytesRead === 3 && bytes.equals(Buffer.from([0xef, 0xbb, 0xbf])); }
      finally { await file.close(); }
    } catch { /* An orphaned buffer can still be restored from its backup. */ }
    if (!bom) continue;
    try { await vscode.workspace.openTextDocument(uri, { encoding: 'utf8bom' }); }
    catch {
      // A concurrent restore can already have opened the correctly encoded
      // dirty buffer. VS Code rejects encoding requests for dirty documents.
      if (vscode.workspace.textDocuments.some(document => document.uri.toString() === uri.toString() && document.encoding === 'utf8bom')) continue;
      void vscode.window.showWarningMessage(`The restored file ${uri.fsPath} already has a different encoding. Choose Save with Encoding → UTF-8 with BOM before saving it.`);
    }
  }
}
