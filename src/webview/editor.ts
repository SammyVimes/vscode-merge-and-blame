import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/languages/definitions/typescript/register.js';
import 'monaco-editor/languages/definitions/javascript/register.js';
import 'monaco-editor/languages/definitions/python/register.js';
import 'monaco-editor/languages/definitions/cpp/register.js';
import 'monaco-editor/languages/definitions/rust/register.js';
import 'monaco-editor/languages/definitions/go/register.js';
import 'monaco-editor/languages/definitions/java/register.js';
import 'monaco-editor/languages/definitions/kotlin/register.js';
import 'monaco-editor/languages/definitions/markdown/register.js';
import 'monaco-editor/languages/definitions/yaml/register.js';
import 'monaco-editor/languages/definitions/html/register.js';
import 'monaco-editor/languages/definitions/css/register.js';
import 'monaco-editor/languages/definitions/shell/register.js';
import 'monaco-editor/languages/definitions/xml/register.js';
import 'monaco-editor/languages/definitions/ini/register.js';
import 'monaco-editor/languages/definitions/sql/register.js';
import './style.css';

export { monaco };
declare global { interface Window { MonacoEnvironment: { getWorker: () => Promise<Worker> } } }
export function installEditorEnvironment(container: HTMLElement): void {
  const workerUrl = new URL(container.dataset.worker!, document.baseURI).href;
  let source: Promise<string> | undefined;
  window.MonacoEnvironment = { getWorker: async () => {
    // Webview workers cannot importScripts from extension-resource URLs. Load
    // the already bundled worker through the webview, then execute its blob.
    source ??= fetch(workerUrl).then(response => {
      if (!response.ok) throw new Error(`Cannot load editor worker: ${response.status}`);
      return response.text();
    });
    const blob = new Blob([await source], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return worker;
  } };
}

export function language(name: string): string {
  const ext = name.split('.').pop()!;
  return ({ ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', json: 'json', py: 'python', rs: 'rust', go: 'go', cpp: 'cpp', cc: 'cpp', c: 'c', h: 'cpp', java: 'java', kt: 'kotlin', md: 'markdown', yaml: 'yaml', yml: 'yaml', html: 'html', css: 'css', sh: 'shell', xml: 'xml', toml: 'ini', sql: 'sql' } as Record<string, string>)[ext] ?? 'plaintext';
}
export function theme(): void {
  monaco.editor.defineTheme('merger', {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: '', foreground: 'BCBEC4' }, { token: 'comment', foreground: '7A7E85' },
      { token: 'keyword', foreground: 'CF8E6D' }, { token: 'number', foreground: '2AACB8' },
      { token: 'string', foreground: '6AAB73' }, { token: 'delimiter', foreground: 'BCBEC4' },
    ], colors: {
      'editor.background': '#191A1C', 'editor.foreground': '#BCBEC4',
      'editorGutter.background': '#191A1C', 'editorLineNumber.foreground': '#4B5059',
      'editorLineNumber.activeForeground': '#868A91', 'editor.selectionBackground': '#214283',
      'editor.lineHighlightBackground': '#00000000',
      'scrollbarSlider.background': '#3B3C3ECC', 'scrollbarSlider.hoverBackground': '#55575A',
      'scrollbarSlider.activeBackground': '#64676B', 'editorCursor.foreground': '#CED0D6',
      'diffEditor.insertedLineBackground': '#29443688', 'diffEditor.removedLineBackground': '#58373788',
      'diffEditor.insertedTextBackground': '#3b7051aa', 'diffEditor.removedTextBackground': '#8a4545aa',
    },
  });
  monaco.editor.setTheme('merger');
}
