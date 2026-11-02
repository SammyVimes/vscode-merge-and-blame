import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { previewHtml } from './preview-html.mjs';
const port = Number(process.env.MERGER_PORT || 4173);
http.createServer(async (req, res) => {
  try {
    if (new URL(req.url, 'http://localhost').pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(previewHtml); return; }
    const file = path.resolve(`.${decodeURIComponent(req.url.split('?')[0])}`);
    if (!file.startsWith(path.resolve('dist') + path.sep) && file !== path.resolve('assets/icon.png')) { res.writeHead(404).end(); return; }
    const mime = { '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.map': 'application/json', '.png': 'image/png' }[path.extname(file)];
    res.setHeader('Content-Type', mime || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
}).listen(port, '127.0.0.1', () => console.log(`Merge editor preview: http://127.0.0.1:${port}`));
