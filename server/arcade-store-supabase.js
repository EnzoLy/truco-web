'use strict';
/* Runs del arcade en Supabase (PostgREST), sin dependencias. Solo corre en el servidor con la clave
 * secreta: la tabla tiene RLS activado y ninguna politica. Migracion: supabase/migrations/002_arcade.sql.
 * Contrato: ver arcade.js. */
const { createRestTable, UNIQUE_VIOLATION } = require('./store-supabase.js');

const TABLE = 'arcade_players';

function createArcadeSupabaseStore({ url, key, fetchImpl = fetch, table = TABLE, now = Date.now }) {
  const { request, fail, q, iso } = createRestTable({ url, key, fetchImpl, table });

  return {
    async get(id) {
      const res = await request(`?id=eq.${q(id)}&select=token_hash,run,best_round,runs_played,version`);
      if (!res.ok) await fail(res, 'get arcade');
      const [row] = await res.json();
      if (!row) return null;
      return { tokenHash: row.token_hash, run: row.run, best: row.best_round, runsPlayed: row.runs_played, version: row.version };
    },

    async create({ id, tokenHash }) {
      const res = await request('', {
        method: 'POST',
        prefer: 'return=minimal',
        body: { id, token_hash: tokenHash, version: 1, run: null, best_round: 0, runs_played: 0, updated_at: iso(now()) },
      });
      if (res.status === UNIQUE_VIOLATION) return false;
      if (!res.ok) await fail(res, 'create arcade');
      return true;
    },

    async save(id, version, { run, best, runsPlayed }) {
      const res = await request(`?id=eq.${q(id)}&version=eq.${version}&select=version`, {
        method: 'PATCH',
        prefer: 'return=representation',
        body: { version: version + 1, run, best_round: best, runs_played: runsPlayed, updated_at: iso(now()) },
      });
      if (!res.ok) await fail(res, 'save arcade');
      const rows = await res.json();
      return rows.length > 0;
    },

    /** Borra jugadores sin run desde emptyBefore y cualquiera sin actividad desde idleBefore. */
    async sweep({ emptyBefore, idleBefore }) {
      const empty = await request(`?run=is.null&updated_at=lt.${q(iso(emptyBefore))}`, { method: 'DELETE', prefer: 'return=minimal' });
      if (!empty.ok) await fail(empty, 'sweep arcade');
      const idle = await request(`?updated_at=lt.${q(iso(idleBefore))}`, { method: 'DELETE', prefer: 'return=minimal' });
      if (!idle.ok) await fail(idle, 'sweep arcade');
    },
  };
}

module.exports = { createArcadeSupabaseStore };
