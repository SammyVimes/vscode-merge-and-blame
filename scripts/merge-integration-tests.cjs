const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

exports.run = async function () {
  const file = name => vscode.Uri.file(path.join(process.env.MERGER_INTEGRATION_REPO, name));
  const conflict = file('merge.txt');
  const config = vscode.workspace.getConfiguration('threeWayMerger');
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (fn, label) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { if (await fn()) return; await pause(25); }
    throw new Error(`Timed out: ${label}`);
  };
  const tabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs);
  const ours = () => tabs().some(tab => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'threeWayMerger.editor');
  const native = async () => {
    await until(() => tabs().length > 0 && !ours() && vscode.window.visibleTextEditors.length > 0, 'native merge tab and text editors');
  };
  const close = async () => {
    // Revert clean-test output rather than answering a save dialog.
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  };
  try {
    await vscode.extensions.getExtension('SemyonDanilov.merge-and-blame').activate();
    const git = (await vscode.extensions.getExtension('vscode.git').activate()).getAPI(1);
    await until(() => git.repositories.length > 0, 'Git repository');
    await vscode.window.showTextDocument(file('normal.txt'));
    assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab.input instanceof vscode.TabInputText, 'ordinary files use the text editor');
    await close();

    // A four-file merge belongs to the caller, even if Git happens to be merging.
    await vscode.commands.executeCommand('_open.mergeEditor', { base: file('base.txt'), input1: file('left.txt'), input2: file('right.txt'), output: file('result.txt') });
    await native(); await close();

    await vscode.commands.executeCommand('git.openMergeEditor', conflict);
    await until(ours, 'Git redirect following native fallback');
    await until(async () => (await vscode.commands.executeCommand('_threeWayMerger.getOpeningTimings')).includes('First merge frame (two animation frames)'), 'browser timing report');
    const timings = await vscode.commands.executeCommand('_threeWayMerger.getOpeningTimings');
    assert.match(timings, /Preflight: load Git inputs/);
    assert.match(timings, /Document: load Git inputs/);
    assert.match(timings, /HTML bootstrap/);
    assert.match(timings, /Bundle execution started/);
    assert.match(timings, /webview.js:/);
    assert.match(timings, /different clock/);
    await fs.writeFile(process.env.MERGER_INTEGRATION_REPORT + '.timings.txt', timings);
    await vscode.commands.executeCommand('git.openMergeEditor', conflict);
    await until(async () => (await vscode.commands.executeCommand('_threeWayMerger.getOpeningTimings')).includes('Existing view frame'), 'existing-view timing report');
    await close();

    const document = await vscode.workspace.openTextDocument(conflict);
    await vscode.window.showTextDocument(document);
    const edit = new vscode.WorkspaceEdit(); edit.insert(conflict, new vscode.Position(0, 0), 'unsaved work\n');
    await vscode.workspace.applyEdit(edit);
    await vscode.commands.executeCommand('git.openMergeEditor', conflict);
    assert.ok(!ours(), 'dirty files stay in their text editor');
    assert.ok(document.isDirty && document.getText().startsWith('unsaved work\n'), 'unsaved text is preserved');
    await close();

    await config.update('useAsDefaultMergeEditor', false, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('git.openMergeEditor', conflict);
    await native(); await close();
    await config.update('useAsDefaultMergeEditor', true, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('git.openMergeEditor', conflict);
    await until(ours, 'redirect re-enabled without reload');
    await until(async () => (await vscode.commands.executeCommand('_threeWayMerger.getOpeningTimings')).match(/First merge frame \(two animation frames\)/g)?.length >= 2, 'second opening timing report');
    await close();
    await fs.writeFile(process.env.MERGER_INTEGRATION_REPORT, JSON.stringify({ passed: true }));
  } catch (error) {
    await fs.writeFile(process.env.MERGER_INTEGRATION_REPORT, JSON.stringify({ passed: false, error: String(error), stack: error.stack }));
    throw error;
  }
};
