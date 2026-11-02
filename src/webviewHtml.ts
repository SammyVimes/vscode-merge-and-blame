import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

export function webviewHtml(extensionUri: vscode.Uri, webview: vscode.Webview, entry: string): string {
  const asset = (name: string): string => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', name)).toString();
  const nonce = randomBytes(18).toString('base64');
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; worker-src blob:; connect-src ${webview.cspSource};"><link rel="stylesheet" href="${asset(`${entry}.css`)}"></head><body><div id="app" data-worker="${asset('editor.worker.js')}"></div><script nonce="${nonce}" src="${asset(`${entry}.js`)}"></script></body></html>`;
}
