'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const T = require('../js/engine.js');
globalThis.Truco = T;
const A = require('../js/arcade.js');
const { createArcadeManager, validateRun, ArcadeHttpError } = require('../server/arcade.js');
const { createArcadeMemoryStore } = require('../server/arcade-store-memory.js');
const { createRoomManager } = require('../server/rooms.js');
const { createApi } = require('../server/api.js');

function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const freshRun = () => A.newRun(seeded(1));
const midMatch = () => {
  const run = freshRun();
  const state = T.dealHand(T.newGame(seeded(2), A.matchOptions(run)), seeded(3)).state;
  return A.withMatch(run, state);
};
const inShop = () => A.onEvents({ ...freshRun(), amulets: ['cantor'], upgrades: { '4copa': { rank: 13 } } }, [{ type: 'game-end', winner: 0 }], seeded(4)).run;

// ---------- validacion ----------

test('validateRun acepta runs reales en cada fase', () => {
  for (const run of [freshRun(), midMatch(), inShop(), { ...freshRun(), phase: 'over' }]) {
    assert.doesNotThrow(() => validateRun(JSON.parse(JSON.stringify(run))));
  }
});

test('validateRun rechaza runs con datos inventados', () => {
  const bad = [
    null, [], 'x',
    { ...freshRun(), v: 99 },
    { ...freshRun(), phase: 'trampa' },
    { ...freshRun(), coins: -1 },
    { ...freshRun(), coins: 1.5 },
    { ...freshRun(), round: 0 },
    { ...freshRun(), amulets: ['no-existe'] },
    { ...freshRun(), amulets: ['cantor', 'cantor'] },
    { ...freshRun(), amulets: ['cantor', 'propina', 'cuentero', 'alcancia', 'oido-fino', 'espejito'] },
    { ...freshRun(), upgrades: { '9oro': { rank: 3 } } },
    { ...freshRun(), upgrades: { '4copa': { rank: 99 } } },
    { ...freshRun(), upgrades: { '4copa': { magia: 1 } } },
    { ...freshRun(), rival: { ...freshRun().rival, id: 'hacker' } },
    { ...freshRun(), rival: { ...freshRun().rival, traits: { bluffTruco: 'mucho' } } },
    { ...freshRun(), shop: { items: [{ type: 'amulet', id: 'nada', price: 1 }], rerolls: 0 } },
    { ...freshRun(), extra: true },
  ];
  for (const run of bad) assert.throws(() => validateRun(run), ArcadeHttpError, JSON.stringify(run)?.slice(0, 80));
});

// ---------- manager ----------

test('crear jugador devuelve id y token; el token no se guarda en claro', async () => {
  const store = createArcadeMemoryStore();
  const arcade = createArcadeManager({ store });
  const { id, token } = await arcade.createPlayer();
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.ok(token.length >= 32);
  const row = await store.get(id);
  assert.notEqual(row.tokenHash, token);
  assert.equal(JSON.stringify(row).includes(token), false);
});

test('guardar y cargar la run', async () => {
  const arcade = createArcadeManager({ store: createArcadeMemoryStore() });
  const { id, token } = await arcade.createPlayer();
  const empty = await arcade.load(id, token);
  assert.equal(empty.run, null);
  assert.equal(empty.best, 0);
  const saved = await arcade.save(id, token, midMatch(), empty.version);
  const loaded = await arcade.load(id, token);
  assert.equal(loaded.version, saved.version);
  assert.deepEqual(loaded.run, JSON.parse(JSON.stringify(midMatch())));
});

test('token ajeno o id inexistente: 403/404', async () => {
  const arcade = createArcadeManager({ store: createArcadeMemoryStore() });
  const { id } = await arcade.createPlayer();
  await assert.rejects(arcade.load(id, 'x'.repeat(32)), (e) => e.status === 403);
  await assert.rejects(arcade.load('00000000-0000-4000-8000-000000000000', 'x'.repeat(32)), (e) => e.status === 404);
  await assert.rejects(arcade.load('no-uuid', 'x'), (e) => e.status === 400);
});

test('guardar con una version vieja da conflicto', async () => {
  const arcade = createArcadeManager({ store: createArcadeMemoryStore() });
  const { id, token } = await arcade.createPlayer();
  const { version } = await arcade.load(id, token);
  await arcade.save(id, token, freshRun(), version);
  await assert.rejects(arcade.save(id, token, freshRun(), version), (e) => e.status === 409);
});

test('el record sube y terminar una run cuenta las partidas', async () => {
  const arcade = createArcadeManager({ store: createArcadeMemoryStore() });
  const { id, token } = await arcade.createPlayer();
  let { version } = await arcade.load(id, token);
  ({ version } = await arcade.save(id, token, { ...freshRun(), round: 4, wins: 3, best: 3, phase: 'over' }, version));
  ({ version } = await arcade.save(id, token, { ...freshRun(), round: 4, wins: 3, best: 3, phase: 'over' }, version));
  ({ version } = await arcade.save(id, token, { ...freshRun(), best: 1 }, version));
  const loaded = await arcade.load(id, token);
  assert.equal(loaded.best, 3);
  assert.equal(loaded.runsPlayed, 1);
});

// ---------- HTTP ----------

function listen() {
  const api = createApi(createRoomManager({ rng: seeded(5) }), { arcade: createArcadeManager({ store: createArcadeMemoryStore() }) });
  const server = http.createServer(async (req, res) => {
    if (await api.handle(req, res, new URL(req.url, 'http://x'))) return;
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const loadRun = (base, id, token) => post(`${base}/api/arcade/run`, { id, token });

test('API HTTP del arcade: jugador, guardar, cargar', async () => {
  const { server, base } = await listen();
  try {
    const created = await post(`${base}/api/arcade/player`, {});
    assert.equal(created.status, 200);
    const { id, token } = created.body.data;
    const first = await loadRun(base, id, token);
    assert.equal(first.body.data.run, null);
    const run = midMatch();
    const saved = await post(`${base}/api/arcade/save`, { id, token, run, version: first.body.data.version });
    assert.equal(saved.status, 200);
    const again = await loadRun(base, id, token);
    assert.equal(again.body.data.run.round, 1);
    assert.equal((await loadRun(base, id, "mal")).status, 403);
    const stale = await post(`${base}/api/arcade/save`, { id, token, run, version: first.body.data.version });
    assert.equal(stale.status, 409);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('API HTTP del arcade: valida cuerpo, tamaño, origen y ruta', async () => {
  const { server, base } = await listen();
  try {
    const { id, token } = (await post(`${base}/api/arcade/player`, {})).body.data;
    const junk = await post(`${base}/api/arcade/save`, { id, token, run: { v: 1 }, version: 1 });
    assert.equal(junk.status, 400);
    const big = await post(`${base}/api/arcade/save`, { id, token, run: { pad: 'x'.repeat(20000) }, version: 1 }).catch(() => ({ status: 413 }));
    assert.equal(big.status, 413);
    // Una run real con partida en curso entra holgada (mas que el limite de las salas).
    const ok = await post(`${base}/api/arcade/save`, { id, token, run: inShop(), version: 1 });
    assert.equal(ok.status, 200);
    const foreign = await post(`${base}/api/arcade/player`, {}, { Origin: 'http://malo.example' });
    assert.equal(foreign.status, 403);
    assert.equal((await post(`${base}/api/arcade/otra`, {})).status, 404);
    // El token nunca viaja en la URL: leer la run tambien es POST.
    assert.equal((await fetch(`${base}/api/arcade/run?id=${id}&token=${token}`)).status, 405);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('API: una run gigante se rechaza aunque Vercel ya haya leido el cuerpo', async () => {
  const arcade = createArcadeManager({ store: createArcadeMemoryStore() });
  const api = createApi(createRoomManager({ rng: seeded(3) }), { arcade });
  const { id, token } = await arcade.createPlayer();
  const run = midMatch();
  const huge = { ...run, match: { ...run.match, junk: 'x'.repeat(100_000) } };
  const out = {};
  const res = { writeHead(status) { out.status = status; }, end() {} };
  const body = { id, token, run: JSON.parse(JSON.stringify(huge)), version: 1 };
  await api.handle({ method: 'POST', url: '/api/arcade/save', headers: { host: 'x' }, socket: {}, body }, res, new URL('http://x/api/arcade/save'));
  assert.equal(out.status, 413);
});

test('API: crear identidades tiene un limite estricto por IP', async () => {
  const { server, base } = await listen();
  try {
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await post(`${base}/api/arcade/player`, {})).status);
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(200));
    assert.equal(statuses[10], 429);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('guardar con una version absurda es un 400, no un 500', async () => {
  const arcade = createArcadeManager({ store: createArcadeMemoryStore() });
  const { id, token } = await arcade.createPlayer();
  await assert.rejects(arcade.save(id, token, freshRun(), 1e21), (e) => e.status === 400);
});

test('sin arcade configurado, sus rutas responden 404', async () => {
  const api = createApi(createRoomManager({ rng: seeded(3) }));
  const out = {};
  const res = { writeHead(status) { out.status = status; }, end() {} };
  await api.handle({ method: 'POST', url: '/api/arcade/player', headers: { host: 'x' }, socket: {}, body: {} }, res, new URL('http://x/api/arcade/player'));
  assert.equal(out.status, 404);
});
