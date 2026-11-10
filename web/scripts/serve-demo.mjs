#!/usr/bin/env node
// Serves the built static demo (web/dist) the way GitHub Pages serves a project site: under
// /evalbench/, with 404.html (and a 404 status) for any path that is not a file. Used to look at
// the demo locally and by the smoke test.
//
//   npm run build:demo && npm run serve:demo        then open http://127.0.0.1:4173/evalbench/

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const base = `${(process.env.BASE_PATH || '/evalbench').replace(/\/+$/, '')}/`;
const port = Number(process.env.PORT || 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

if (!existsSync(join(root, 'index.html'))) {
  console.error('serve-demo: web/dist is empty. Run `npm run build:demo` first.');
  process.exit(1);
}

function send(res, status, file) {
  res.writeHead(status, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  createReadStream(file).pipe(res);
}

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (path === base.slice(0, -1)) {
    res.writeHead(301, { Location: base });
    return res.end();
  }
  if (path.startsWith(base)) {
    let file = join(root, normalize(path.slice(base.length)));
    if (file.startsWith(root) && existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (file.startsWith(root) && existsSync(file) && statSync(file).isFile()) return send(res, 200, file);
    return send(res, 404, join(root, '404.html'));
  }
  // Outside the project site there is nothing of ours: a plain 404, as on the real host.
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}).listen(port, '127.0.0.1', () => console.log(`Evalbench demo at http://127.0.0.1:${port}${base}`));
