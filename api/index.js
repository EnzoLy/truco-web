'use strict';
// Funcion de Vercel: atiende todo /api/* (ver rewrites en vercel.json) con las salas guardadas en Supabase.
const { createRoomManager } = require('../server/rooms.js');
const { createApi } = require('../server/api.js');
const { createSupabaseStore } = require('../server/store-supabase.js');
const { createArcadeManager } = require('../server/arcade.js');
const { createArcadeSupabaseStore } = require('../server/arcade-store-supabase.js');

let api;

function getApi() {
  if (!api) {
    const supabase = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
    const arcade = createArcadeManager({ store: createArcadeSupabaseStore(supabase) });
    api = createApi(createRoomManager({ store: createSupabaseStore(supabase) }), { arcade });
  }
  return api;
}

function fail(res, status, error) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ ok: false, error }));
}

module.exports = async (req, res) => {
  try {
    if (await getApi().handle(req, res, new URL(req.url, 'http://x'))) return;
    fail(res, 404, 'Ruta inexistente');
  } catch (err) {
    console.error('Error en la función de salas:', err);
    fail(res, 500, 'Error interno');
  }
};
