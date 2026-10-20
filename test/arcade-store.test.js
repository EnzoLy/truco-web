'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createArcadeMemoryStore } = require('../server/arcade-store-memory.js');
const { createArcadeSupabaseStore } = require('../server/arcade-store-supabase.js');

const ID = '11111111-2222-4333-8444-555555555555';
const HASH = 'a'.repeat(64);

/** PostgREST de mentira para la tabla arcade_players (clave: id). */
function fakePostgrest() {
  const rows = new Map();
  const calls = [];
  const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status });
  const matches = (row, params) => [...params].every(([k, v]) => {
    if (k === 'select') return true;
    if (v === 'is.null') return row[k] === null;
    if (v.startsWith('lt.')) return row[k] < v.slice(3);
    return String(row[k]) === v.replace(/^eq\./, '');
  });
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push({ url: u, init });
    const body = init.body ? JSON.parse(init.body) : null;
    if (init.method === 'POST') {
      if (rows.has(body.id)) return json(409, { code: '23505' });
      rows.set(body.id, body);
      return json(201);
    }
    const found = [...rows.values()].filter((r) => matches(r, u.searchParams));
    if (init.method === 'DELETE') {
      for (const r of found) rows.delete(r.id);
      return json(204);
    }
    if (init.method === 'PATCH') {
      for (const r of found) rows.set(r.id, { ...r, ...body });
      return json(200, found.map(() => ({ version: body.version })));
    }
    return json(200, found);
  };
  return { fetchImpl, calls };
}

const stores = {
  memoria: (now = () => 0) => createArcadeMemoryStore({ now }),
  supabase: (now = () => 0) => createArcadeSupabaseStore({ url: 'https://x.supabase.co', key: 'sb_secret_abc', fetchImpl: fakePostgrest().fetchImpl, now }),
};

for (const [name, make] of Object.entries(stores)) {
  test(`arcade ${name}: crea, lee y rechaza un id repetido`, async () => {
    const store = make();
    assert.equal(await store.get(ID), null);
    assert.equal(await store.create({ id: ID, tokenHash: HASH }), true);
    assert.equal(await store.create({ id: ID, tokenHash: HASH }), false);
    assert.deepEqual(await store.get(ID), { tokenHash: HASH, run: null, best: 0, runsPlayed: 0, version: 1 });
  });

  test(`arcade ${name}: guardar exige la version leida`, async () => {
    const store = make();
    await store.create({ id: ID, tokenHash: HASH });
    const run = { round: 2 };
    assert.equal(await store.save(ID, 1, { run, best: 1, runsPlayed: 0 }), true);
    assert.equal(await store.save(ID, 1, { run, best: 1, runsPlayed: 0 }), false, 'version vieja');
    const row = await store.get(ID);
    assert.equal(row.version, 2);
    assert.deepEqual(row.run, run);
    assert.equal(row.best, 1);
  });
}

for (const [name, make] of Object.entries(stores)) {
  test(`arcade ${name}: limpia jugadores sin run y los inactivos`, async () => {
    let t = 1000;
    const store = make(() => t);
    const other = '22222222-2222-4333-8444-555555555555';
    const third = '33333333-2222-4333-8444-555555555555';
    await store.create({ id: ID, tokenHash: HASH }); // queda sin run
    await store.create({ id: other, tokenHash: HASH });
    await store.save(other, 1, { run: { round: 1 }, best: 0, runsPlayed: 0 });
    t = 5000;
    await store.create({ id: third, tokenHash: HASH }); // reciente, sin run
    await store.sweep({ emptyBefore: 3000, idleBefore: 0 });
    assert.equal(await store.get(ID), null);
    assert.ok(await store.get(other), 'tiene run: se queda');
    assert.ok(await store.get(third), 'recien creado: se queda');
    await store.sweep({ emptyBefore: 0, idleBefore: 3000 });
    assert.equal(await store.get(other), null);
    assert.ok(await store.get(third));
  });
}

test('arcade supabase: usa la tabla arcade_players con la clave secreta', async () => {
  const fake = fakePostgrest();
  const store = createArcadeSupabaseStore({ url: 'https://x.supabase.co/', key: 'sb_secret_abc', fetchImpl: fake.fetchImpl });
  await store.get(ID);
  const { url, init } = fake.calls[0];
  assert.equal(url.origin + url.pathname, 'https://x.supabase.co/rest/v1/arcade_players');
  assert.equal(url.searchParams.get('id'), `eq.${ID}`);
  assert.equal(init.headers.apikey, 'sb_secret_abc');
});

test('arcade supabase: falla claro si la base responde mal', async () => {
  const store = createArcadeSupabaseStore({ url: 'https://x.supabase.co', key: 'k', fetchImpl: async () => new Response('boom', { status: 500 }) });
  await assert.rejects(store.get(ID), /Supabase get arcade falló \(500\)/);
});
