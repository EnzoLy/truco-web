'use strict';
/* Runs del arcade en memoria, para tests y para correr en local. Pasa por JSON igual que la base real.
 * Contrato: ver arcade.js. */

function createArcadeMemoryStore({ now = Date.now } = {}) {
  const rows = new Map(); // id -> { json, touchedAt }
  const read = (id) => (rows.has(id) ? JSON.parse(rows.get(id).json) : null);
  const write = (id, row) => rows.set(id, { json: JSON.stringify(row), touchedAt: now() });

  return {
    async get(id) {
      return read(id);
    },

    async create({ id, tokenHash }) {
      if (rows.has(id)) return false;
      write(id, { tokenHash, run: null, best: 0, runsPlayed: 0, version: 1 });
      return true;
    },

    async save(id, version, { run, best, runsPlayed }) {
      const row = read(id);
      if (!row || row.version !== version) return false;
      write(id, { ...row, run, best, runsPlayed, version: version + 1 });
      return true;
    },

    /** Borra jugadores sin run desde emptyBefore y cualquiera sin actividad desde idleBefore. */
    async sweep({ emptyBefore, idleBefore }) {
      for (const [id, { touchedAt }] of rows) {
        if (touchedAt < idleBefore || (touchedAt < emptyBefore && read(id).run === null)) rows.delete(id);
      }
    },
  };
}

module.exports = { createArcadeMemoryStore };
