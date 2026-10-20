'use strict';
/* API HTTP de las salas: JSON para las acciones y GET /state para el estado (los clientes lo consultan
 * cada ~1 s). Sin dependencias; sirve igual en `node serve.js` y en una funcion de Vercel. */
const { RoomError } = require('./rooms.js');

const MAX_BODY_BYTES = 4096;
const RATE_WINDOW_MS = 10_000;
const RATE_LIMIT = 80;
const MAX_TRACKED_IPS = 1000;
const CODE_RE = /^[A-Za-z0-9]{3,8}$/;

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const ok = (res, data) => send(res, 200, { ok: true, data });
const fail = (res, status, error) => send(res, status, { ok: false, error });

/** Vercel ya leyó el cuerpo y lo deja en req.body; en Node puro hay que leer el stream. */
function parsedBody(req) {
  const raw = req.body;
  if (raw === undefined) return undefined;
  if (Buffer.isBuffer(raw) || typeof raw === 'string') {
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new RoomError(413, 'Pedido demasiado grande');
    return raw.length ? raw.toString() : '';
  }
  return raw;
}

function readJson(req) {
  const preread = parsedBody(req);
  if (preread !== undefined) {
    let body = preread;
    try {
      if (typeof body === 'string') body = body ? JSON.parse(body) : {};
    } catch (err) {
      return Promise.reject(new RoomError(400, 'JSON inválido'));
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return Promise.reject(new RoomError(400, 'JSON inválido'));
    return Promise.resolve(body);
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new RoomError(413, 'Pedido demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('forma');
        resolve(body);
      } catch (err) {
        reject(new RoomError(400, 'JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

/** Rechaza pedidos de otro origen: solo la propia pagina puede operar salas. */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch (err) {
    return false;
  }
}

function createApi(manager, { now = Date.now } = {}) {
  const hits = new Map();

  function limited(req) {
    // Detras de Vercel la IP real viene en x-forwarded-for; fuera de ahi ese header lo puede falsear cualquiera.
    const forwarded = process.env.VERCEL ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
    const ip = forwarded || req.socket.remoteAddress || 'x';
    const t = now();
    if (hits.size > MAX_TRACKED_IPS) for (const [key, e] of hits) if (t - e.start > RATE_WINDOW_MS) hits.delete(key);
    const entry = hits.get(ip);
    if (!entry || t - entry.start > RATE_WINDOW_MS) {
      hits.set(ip, { start: t, count: 1 });
      return false;
    }
    entry.count += 1;
    return entry.count > RATE_LIMIT;
  }

  /** Devuelve true si atendio la ruta. */
  async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/')) return false;
    try {
      const parts = url.pathname.split('/').filter(Boolean); // api, rooms, [code], [verb]
      if (parts[1] !== 'rooms' || parts.length > 4) return fail(res, 404, 'Ruta inexistente'), true;
      const code = parts[2];
      const verb = parts[3];
      if (code && !CODE_RE.test(code)) return fail(res, 404, 'No existe esa sala'), true;

      if (req.method === 'GET') {
        if (code && !verb) return ok(res, await manager.info(code)), true;
        if (code && verb === 'state') {
          const token = url.searchParams.get('token') || '';
          return ok(res, await manager.snapshot(code, token, Number(url.searchParams.get('since')) || 0)), true;
        }
        if (code && verb === 'watch') return ok(res, await manager.watch(code, Number(url.searchParams.get('since')) || 0)), true;
        return fail(res, 404, 'Ruta inexistente'), true;
      }
      if (req.method !== 'POST') return fail(res, 405, 'Método no permitido'), true;
      if (!sameOrigin(req)) return fail(res, 403, 'Origen no permitido'), true;
      if (limited(req)) return fail(res, 429, 'Demasiados pedidos'), true;

      const body = await readJson(req);
      if (!code) return ok(res, await manager.create({ mode: body.mode, name: body.name })), true;
      switch (verb) {
        case 'join': return ok(res, await manager.join(code, body.name)), true;
        case 'config': await manager.configure(code, body.token, { mode: body.mode }); return ok(res, {}), true;
        case 'sit': await manager.sit(code, body.token, body.seat); return ok(res, {}), true;
        case 'seat': await manager.setSeat(code, body.token, body.seat, body.kind); return ok(res, {}), true;
        case 'start': return ok(res, await manager.start(code, body.token)), true;
        case 'rematch': await manager.rematch(code, body.token); return ok(res, {}), true;
        case 'act': await manager.act(code, body.token, body.action); return ok(res, {}), true;
        case 'sign': await manager.sign(code, body.token, body.sign); return ok(res, {}), true;
        default: return fail(res, 404, 'Ruta inexistente'), true;
      }
    } catch (err) {
      if (err instanceof RoomError) return fail(res, err.status, err.message), true;
      console.error('Error en la API de salas:', err);
      return fail(res, 500, 'Error interno'), true;
    }
  }

  return { handle };
}

module.exports = { createApi };
