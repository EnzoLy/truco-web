'use strict';
/* Almacen de salas en memoria, para tests y para correr en local. Guarda JSON, igual que la base real,
 * así lo que no sobrevive a un viaje por JSON falla también acá. Contrato: ver rooms.js. */

function createMemoryStore() {
  const rows = new Map(); // code -> { json, version, touchedAt }

  return {
    async get(code) {
      const row = rows.get(code);
      return row ? { room: JSON.parse(row.json), version: row.version } : null;
    },

    /** false si el codigo ya existe. */
    async create(room) {
      if (rows.has(room.code)) return false;
      rows.set(room.code, { json: JSON.stringify(room), version: 1, touchedAt: room.touchedAt });
      return true;
    },

    /** Guarda solo si nadie la cambio desde `version`; false si hubo un cambio en el medio. */
    async save(room, version) {
      const row = rows.get(room.code);
      if (!row || row.version !== version) return false;
      rows.set(room.code, { json: JSON.stringify(room), version: version + 1, touchedAt: room.touchedAt });
      return true;
    },

    async count() {
      return rows.size;
    },

    /** Borra las salas sin actividad desde `cutoffMs`. */
    async sweep(cutoffMs) {
      for (const [code, row] of rows) if (row.touchedAt < cutoffMs) rows.delete(code);
    },
  };
}

module.exports = { createMemoryStore };
