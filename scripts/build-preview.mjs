import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { previewHtml } from './preview-html.mjs';

await rm('site', { recursive: true, force: true });
await mkdir('site/dist', { recursive: true });
await mkdir('site/assets', { recursive: true });
for (const name of ['webview.js', 'webview.css', 'editor.worker.js']) await cp(`dist/${name}`, `site/dist/${name}`);
await cp('dist/assets', 'site/dist/assets', { recursive: true });
await cp('assets/icon.png', 'site/assets/icon.png');
for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.txt']) await cp(name, `site/${name}`);
await writeFile('site/index.html', previewHtml);
await writeFile('site/.nojekyll', '');
// A project Pages URL has a path prefix. All runtime URLs must stay relative.
if (/\b(?:src|href|data-worker)=["']\//.test(await readFile('site/index.html', 'utf8'))) throw new Error('Preview contains an absolute asset path.');
console.log('Built standalone preview in site/ for GitHub Pages.');
