import { build } from 'esbuild';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
const require = createRequire(import.meta.url);
const production = !process.argv.includes('--development');
const outputOptions = { minify: production, sourcemap: !production };
// Monaco vendors a copy of DOMPurify. Use the patched, locked dependency when
// bundling rather than shipping that older vendored implementation.
const sanitizer = { name: 'patched-sanitizer', setup(build) {
  build.onResolve({ filter: /dompurify\/dompurify\.js$/ }, () => ({ path: require.resolve('dompurify') }));
} };
await mkdir('dist', { recursive: true });
// The ordinary-file blame webview was replaced by native editor decorations.
await Promise.all(['blame.js', 'blame.js.map', 'blame.css', 'blame.css.map', ...(production ? ['extension.cjs.map', 'webview.js.map', 'webview.css.map', 'commit.js.map', 'commit.css.map', 'editor.worker.js.map'] : [])].map(file => rm(`dist/${file}`, { force: true })));
await Promise.all([
  build({ ...outputOptions, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'] }),
  ...['webview', 'commit'].map(entry => build({ ...outputOptions, entryPoints: [entry === 'webview' ? 'src/webview/index.ts' : `src/webview/${entry}.ts`], outfile: `dist/${entry}.js`, bundle: true, platform: 'browser', format: 'iife', target: 'es2022', loader: { '.ttf': 'file', '.woff2': 'file' }, assetNames: 'assets/[name]-[hash]', plugins: [sanitizer], banner: entry === 'webview' ? { js: 'globalThis.__mergeOpening?.marks.push({ label: "Bundle execution started", ms: performance.now() });' } : undefined })),
  build({ ...outputOptions, entryPoints: ['monaco-editor/editor/editor.worker.js'], outfile: 'dist/editor.worker.js', bundle: true, platform: 'browser', format: 'iife', target: 'es2022' }),
]);
// The webview resource bridge serves files without HTTP content encoding.
// Ship gzip bytes explicitly and inflate them locally in the small HTML loader.
await writeFile('dist/webview.js.gz', gzipSync(await readFile('dist/webview.js'), { level: 9 }));
const notices = await Promise.all(['monaco-editor/LICENSE', 'diff/LICENSE', 'dompurify/LICENSE', 'marked/LICENSE.md'].map(async name => `${name}\n${await readFile(`node_modules/${name}`, 'utf8')}`));
await writeFile('THIRD_PARTY_NOTICES.txt', notices.join('\n\n') + '\n\nJetBrains Mono\n' + await readFile('assets/JetBrainsMono-OFL.txt', 'utf8'));
console.log('Built extension, merge editor, and local editor worker.');
