'use strict';
// Servidor local, sin dependencias: node serve.js [puerto] [host]
// Las salas van en memoria; con SUPABASE_URL y SUPABASE_SECRET_KEY (ver .env.example) usan Supabase,
// igual que en Vercel: node --env-file=.env serve.js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createRoomManager } = require('./server/rooms.js');
const { createApi } = require('./server/api.js');
const { createSupabaseStore } = require('./server/store-supabase.js');

const ROOT = __dirname;
const PORT = Number(process.argv[2]) || 3000;
const HOST = process.argv[3] || '0.0.0.0';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};
const PUBLIC = new Set(['index.html', 'cartas.html', 'sala.html', 'js', 'css']);
const PAGES = new Set(['cartas', 'sala']);

const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
const store = SUPABASE_URL && SUPABASE_SECRET_KEY ? createSupabaseStore({ url: SUPABASE_URL, key: SUPABASE_SECRET_KEY }) : undefined;
const api = createApi(createRoomManager({ store }));

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (await api.handle(req, res, url)) return;
    let rel;
    try {
      rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    } catch (err) {
      res.writeHead(400).end('Pedido inválido');
      return;
    }
    if (rel.endsWith('.html')) {
      res.writeHead(301, { Location: '/' + (rel === 'index.html' ? '' : rel.slice(0, -5)) + url.search }).end();
      return;
    }
    if (PAGES.has(rel)) rel += '.html';
    const file = path.normalize(path.join(ROOT, rel));
    const top = path.relative(ROOT, file).split(path.sep)[0];
    if (!file.startsWith(ROOT + path.sep) || !PUBLIC.has(top)) {
      res.writeHead(404).end('No encontrado');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end('No encontrado');
        return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  })
  .listen(PORT, HOST, () => console.log(`Truco en http://${HOST}:${PORT}`));
