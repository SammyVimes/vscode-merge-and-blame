import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { PackedInitialState } from './initialState';

export function webviewHtml(extensionUri: vscode.Uri, webview: vscode.Webview, entry: string, openingId?: string, initial?: PackedInitialState): string {
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
  const payload = initial ? `<script id="merge-initial-state" type="application/octet-stream">${initial.base64}</script>` : '';
  const script = entry === 'webview' ? `<script nonce="${nonce}">
    (() => {
      const mark = label => window.__mergeOpening?.marks.push({ label, ms: performance.now() });
      const inflate = async body => new Response(body.pipeThrough(new DecompressionStream('gzip'))).text();
      const style = document.getElementById('merge-style');
      const styled = style.sheet ? Promise.resolve() : new Promise((resolve, reject) => {
        style.addEventListener('load', resolve, { once: true });
        style.addEventListener('error', reject, { once: true });
      });
      const compressed = typeof DecompressionStream === 'function';
      const bundle = async () => {
        if (!compressed) return undefined;
        mark('Compressed bundle fetch started');
        const response = await fetch(${JSON.stringify(asset('webview.js.gz'))});
        if (!response.ok || !response.body) throw new Error('Bundle fetch failed');
        const source = await inflate(response.body);
        mark('Compressed bundle inflated');
        return source;
      };
      const state = async () => {
        const payload = document.getElementById('merge-initial-state');
        if (!compressed || !payload) return undefined;
        const bytes = Uint8Array.from(atob(payload.textContent), value => value.charCodeAt(0));
        const json = await inflate(new Response(bytes).body);
        mark('Initial HTML state inflated');
        return JSON.parse(json);
      };
      Promise.all([styled, bundle(), state()]).then(([, source, state]) => {
        window.__mergeInitialState = state;
        const script = document.createElement('script');
        script.nonce = ${JSON.stringify(nonce)};
        if (source === undefined) script.src = ${JSON.stringify(asset('webview.js'))};
        else script.textContent = source + '\\n//# sourceURL=MergeAndBlameWebview.js';
        document.body.appendChild(script);
      }).catch(() => {
        const message = 'Cannot load merge editor startup assets. See Merge & Blame: Opening Timings.';
        const error = document.createElement('div'); error.textContent = message; document.body.appendChild(error);
        const timing = window.__mergeOpening;
        timing?.api.postMessage({ type: 'openingTiming', report: { id: timing.id, phase: 'error', marks: timing.marks, visibility: document.visibilityState, note: 'Compressed startup failed' } });
      });
    })();
  </script>` : `<script nonce="${nonce}" src="${asset(`${entry}.js`)}"></script>`;
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; worker-src blob:; connect-src ${webview.cspSource};">${bootstrap}<link id="merge-style" rel="stylesheet" href="${asset(`${entry}.css`)}"></head><body><div id="app" data-worker="${asset('editor.worker.js')}"></div>${payload}${script}</body></html>`;
}
