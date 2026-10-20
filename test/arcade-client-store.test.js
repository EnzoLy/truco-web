'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const T = require('../js/engine.js');
globalThis.Truco = T;
const A = require('../js/arcade.js');
const { createRunStore, RUN_KEY, ID_KEY } = require('../js/arcade-store.js');
const { createArcadeManager } = require('../server/arcade.js');
const { createArcadeMemoryStore } = require('../server/arcade-store-memory.js');
const { createRoomManager } = require('../server/rooms.js');
const { createApi } = require('../server/api.js');

function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    data,
  };
}

const quiet = { warn() {} };

async function withServer(fn) {
  const api = createApi(createRoomManager({ rng: seeded(5) }), { arcade: createArcadeManager({ store: createArcadeMemoryStore() }) });
  const server = http.createServer(async (req, res) => {
    if (await api.handle(req, res, new URL(req.url, 'http://x'))) return;
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const fetchImpl = (path, init) => fetch(base + path, init);
  try {
    await fn(fetchImpl);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

const makeStore = (storage, fetchImpl) => createRunStore({ storage, fetchImpl, runVersion: A.RUN_VERSION, setTimer: () => 0, clearTimer: () => {}, log: quiet });

test('sin servidor la run queda en el navegador', async () => {
  const storage = memoryStorage();
  const store = makeStore(storage, null);
  assert.equal(await store.load(), null);
  const run = A.newRun(seeded(1));
  store.save(run);
  await store.flush();
  assert.deepEqual(await makeStore(storage, null).load(), run);
});

test('si se borra la run local pero queda la identidad, vuelve desde el servidor', async () => {
  await withServer(async (fetchImpl) => {
    const storage = memoryStorage();
    const store = makeStore(storage, fetchImpl);
    assert.equal(await store.load(), null);
    const run = { ...A.newRun(seeded(1)), coins: 42 };
    store.save(run);
    await store.flush();
    assert.ok(storage.data.has(ID_KEY));

    storage.removeItem(RUN_KEY);
    const back = await makeStore(storage, fetchImpl).load();
    assert.equal(back.coins, 42);
  });
});

test('solo y dúo guardan cada uno su run, con identidades distintas, y el servidor acepta las dos', async () => {
  await withServer(async (fetchImpl) => {
    const storage = memoryStorage();
    const make = (slot) => createRunStore({ storage, fetchImpl, runVersion: A.RUN_VERSION, slot, setTimer: () => 0, clearTimer: () => {}, log: quiet });
    const solo = make('solo');
    const duo = make('duo');
    await solo.load();
    await duo.load();
    solo.save({ ...A.newRun(seeded(1)), coins: 7 });
    duo.save({ ...A.newRun(seeded(2), { mode: 'duo' }), coins: 9 });
    await solo.flush();
    await duo.flush();
    const { SLOTS } = require('../js/arcade-store.js');
    assert.notEqual(storage.getItem(SLOTS.solo.id), storage.getItem(SLOTS.duo.id));
    // Sin copias locales, cada una vuelve desde el servidor por su lado.
    storage.removeItem(SLOTS.solo.run);
    storage.removeItem(SLOTS.duo.run);
    assert.equal((await make('solo').load()).coins, 7);
    const back = await make('duo').load();
    assert.equal(back.coins, 9);
    assert.equal(back.mode, 'duo');
  });
});

test('dos pestañas: gana la ultima en guardar', async () => {
  await withServer(async (fetchImpl) => {
    const storage = memoryStorage();
    const first = makeStore(storage, fetchImpl);
    await first.load();
    first.save({ ...A.newRun(seeded(1)), coins: 1 });
    await first.flush();
    const second = makeStore(storage, fetchImpl);
    await second.load();
    second.save({ ...A.newRun(seeded(1)), coins: 2 });
    await second.flush();
    first.save({ ...A.newRun(seeded(1)), coins: 3 }); // version vieja: reintenta
    await first.flush();
    storage.removeItem(RUN_KEY);
    assert.equal((await makeStore(storage, fetchImpl).load()).coins, 3);
  });
});

test('una identidad que el servidor no conoce se descarta', async () => {
  await withServer(async (fetchImpl) => {
    const storage = memoryStorage();
    storage.setItem(ID_KEY, JSON.stringify({ id: '11111111-2222-4333-8444-555555555555', token: 'x'.repeat(32) }));
    const store = makeStore(storage, fetchImpl);
    store.save(A.newRun(seeded(1)));
    await store.flush();
    store.save({ ...A.newRun(seeded(1)), coins: 9 });
    await store.flush();
    storage.removeItem(RUN_KEY);
    assert.equal((await makeStore(storage, fetchImpl).load()).coins, 9);
  });
});
