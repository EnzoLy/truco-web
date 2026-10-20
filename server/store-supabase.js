'use strict';
/* Almacen de salas en Supabase (PostgREST), sin dependencias. Solo corre en el servidor con la clave
 * secreta: la tabla tiene RLS activado y ninguna politica, asi que el navegador no puede tocarla.
 * Tabla y migracion: supabase/migrations/001_rooms.sql. Contrato: ver rooms.js. */

const TABLE = 'rooms';
const UNIQUE_VIOLATION = 409;

/** Las variables de entorno suelen llegar con espacios, saltos de linea o comillas pegadas. */
const cleanEnv = (value) => String(value ?? '').trim().replace(/^["']+|["']+$/g, '').trim();

function createSupabaseStore({ url: rawUrl, key: rawKey, fetchImpl = fetch, table = TABLE }) {
  const url = cleanEnv(rawUrl);
  const key = cleanEnv(rawKey);
  if (!url || !key) throw new Error('Faltan SUPABASE_URL y SUPABASE_SECRET_KEY');
  if (key.startsWith('sb_publishable_')) throw new Error('SUPABASE_SECRET_KEY tiene la clave publishable; hace falta la secret (sb_secret_...)');
  const base = `${url.replace(/\/+$/, '')}/rest/v1/${table}`;
  // Las claves nuevas (sb_secret_...) van solo en apikey; las JWT viejas tambien como Bearer.
  const auth = key.includes('.') ? { Authorization: `Bearer ${key}` } : {};
  const headers = (extra = {}) => ({ apikey: key, 'Content-Type': 'application/json', ...auth, ...extra });
  const q = encodeURIComponent;
  const iso = (ms) => new Date(ms).toISOString();

  async function request(path, { method = 'GET', body, prefer, range } = {}) {
    const extra = {};
    if (prefer) extra.Prefer = prefer;
    if (range) extra.Range = range;
    const res = await fetchImpl(`${base}${path}`, { method, headers: headers(extra), body: body === undefined ? undefined : JSON.stringify(body) });
    return res;
  }

  async function fail(res, what) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase ${what} falló (${res.status}): ${detail.slice(0, 200)}`);
  }

  return {
    async get(code) {
      const res = await request(`?code=eq.${q(code)}&select=data,version`);
      if (!res.ok) await fail(res, 'get');
      const [row] = await res.json();
      return row ? { room: row.data, version: row.version } : null;
    },

    async create(room) {
      const res = await request('', { method: 'POST', prefer: 'return=minimal', body: { code: room.code, version: 1, data: room, updated_at: iso(room.touchedAt) } });
      if (res.status === UNIQUE_VIOLATION) return false;
      if (!res.ok) await fail(res, 'create');
      return true;
    },

    async save(room, version) {
      const res = await request(`?code=eq.${q(room.code)}&version=eq.${version}&select=version`, {
        method: 'PATCH',
        prefer: 'return=representation',
        body: { version: version + 1, data: room, updated_at: iso(room.touchedAt) },
      });
      if (!res.ok) await fail(res, 'save');
      const rows = await res.json();
      return rows.length > 0;
    },

    async count() {
      const res = await request('?select=code', { prefer: 'count=exact', range: '0-0' });
      if (!res.ok) await fail(res, 'count');
      const total = (res.headers.get('content-range') || '').split('/')[1];
      return Number(total) || 0;
    },

    async sweep(cutoffMs) {
      const res = await request(`?updated_at=lt.${q(iso(cutoffMs))}`, { method: 'DELETE', prefer: 'return=minimal' });
      if (!res.ok) await fail(res, 'sweep');
    },
  };
}

module.exports = { createSupabaseStore };
