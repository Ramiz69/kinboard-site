#!/usr/bin/env node
// Local preview of public/ that behaves like Cloudflare static assets where it matters for testing:
// it applies the rules in public/_headers (so the CSP is enforced in the browser), serves
// /name and /name/ from name/index.html, and answers unknown paths with 404.html.
//
//   node tools/serve.mjs [port]      (default 8787, bound to 127.0.0.1)

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = parseInt(process.argv[2] || '8787', 10);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.xml': 'application/xml', '.txt': 'text/plain', '.mp4': 'video/mp4', '.webm': 'video/webm', '.json': 'application/json' };

// _headers: a path pattern line, then indented "Name: value" lines. `*` matches anything.
const rules = [];
for (const line of readFileSync(join(DIST, '_headers'), 'utf8').split('\n')) {
  if (!line.trim() || line.trim().startsWith('#')) continue;
  if (!/^\s/.test(line)) rules.push({ re: new RegExp('^' + line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'), headers: [] });
  else { const i = line.indexOf(':'); rules.at(-1).headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]); }
}

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(DIST, path));
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!path.endsWith('/')) { res.writeHead(308, { Location: path + '/' }).end(); return; }
    file = join(file, 'index.html');
  }
  let status = 200;
  if (!existsSync(file)) { file = join(DIST, '404.html'); status = 404; }
  for (const r of rules) if (r.re.test(path)) for (const [k, v] of r.headers) res.setHeader(k, v);
  res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
  res.writeHead(status).end(readFileSync(file));
}).listen(PORT, '127.0.0.1', () => console.log(`public/ on http://localhost:${PORT}/ (headers from _headers applied)`));
