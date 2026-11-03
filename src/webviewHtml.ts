import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

export function webviewHtml(extensionUri: vscode.Uri, webview: vscode.Webview, entry: string, openingId?: string): string {
  const asset = (name: string): string => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', name)).toString();
  const nonce = randomBytes(18).toString('base64');
  // This tiny bootstrap runs before CSS and the large application bundle. Its
  // first message distinguishes HTML delivery from script loading/execution.
  const bootstrap = openingId ? `<script nonce="${nonce}">
    (() => {
      const api = acquireVsCodeApi();
      const timing = window.__mergeOpening = { id: ${JSON.stringify(openingId)}, api, marks: [{ label: 'HTML bootstrap', ms: performance.now() }] };
      api.postMessage({ type: 'openingTiming', report: { id: timing.id, phase: 'bootstrap', marks: timing.marks, visibility: document.visibilityState } });
      window.addEventListener('error', event => {
        const asset = event.target && event.target.src;
        api.postMessage({ type: 'openingTiming', report: { id: timing.id, phase: 'error', marks: timing.marks, visibility: document.visibilityState, note: asset ? 'Asset failed: ' + new URL(asset).pathname.split('/').pop() : 'JavaScript execution error' } });
      }, true);
    })();
  </script>` : '';
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; worker-src blob:; connect-src ${webview.cspSource};">${bootstrap}<link rel="stylesheet" href="${asset(`${entry}.css`)}"></head><body><div id="app" data-worker="${asset('editor.worker.js')}"></div><script nonce="${nonce}" src="${asset(`${entry}.js`)}"></script></body></html>`;
}
