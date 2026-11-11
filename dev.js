// Lokaler Entwicklungsserver: `npm run dev` – ohne Vercel und ohne Neon.
// Daten liegen in ./.localdb, Passwörter lokal: Team «gruen», Admin «admin».
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import handler from './api/data.js';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const PORT = process.env.PORT || 3000;

http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/api/data') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    req.body = raw;
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (data) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
    return handler(req, res);
  }
  try {
    const file = join('public', normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, ''));
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('Nicht gefunden');
  }
}).listen(PORT, () => console.log(`Flyer-Tool läuft auf http://localhost:${PORT}`));
