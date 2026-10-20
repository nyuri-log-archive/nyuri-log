// GitHub Pages のサブパス公開（/nyuri-log/）を再現する簡易静的サーバー
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain',
};

export function startServer(rootRef, port = 4789, prefix = '/nyuri-log/') {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith(prefix)) {
      res.writeHead(404).end('not found');
      return;
    }
    let rel = decodeURIComponent(url.pathname.slice(prefix.length));
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    rel = normalize(rel).replace(/^(\.\.[/\\])+/, '');
    const file = join(rootRef.dir, rel);
    try {
      const s = await stat(file);
      if (!s.isFile()) throw new Error('nf');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
