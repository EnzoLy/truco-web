'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryStore } = require('../server/store-memory.js');
const { createSupabaseStore } = require('../server/store-supabase.js');

const room = (code, touchedAt = 1000) => ({ code, touchedAt, status: 'lobby', seats: [{ kind: 'human', name: 'A' }] });

/** Cada store pasa el mismo contrato; el de Supabase contra un PostgREST de mentira. */
function fakePostgrest() {
  const rows = new Map();
  const calls = [];
  const json = (status, body, headers = {}) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
  const match = (row, params) => [...params].every(([k, v]) => {
    if (k === 'select') return true;
    const [op, ...rest] = v.split('.');
    const val = rest.join('.');
    if (op === 'eq') return String(row[k]) === val;
    if (op === 'lt') return row[k] < val;
    return false;
  });
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push({ url: u, init });
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    if (method === 'POST') {
      if (rows.has(body.code)) return json(409, { code: '23505' });
      rows.set(body.code, body);
      return json(201);
    }
    const found = [...rows.values()].filter((r) => match(r, u.searchParams));
    if (method === 'GET') {
      if (init.headers.Prefer === 'count=exact') return json(206, [], { 'content-range': `0-0/${rows.size}` });
      return json(200, found);
    }
    if (method === 'PATCH') {
      for (const r of found) rows.set(r.code, { ...r, ...body });
      return json(200, found.map((r) => ({ version: body.version })));
    }
    if (method === 'DELETE') {
      for (const r of found) rows.delete(r.code);
      return json(204);
    }
    return json(400);
  };
  return { fetchImpl, calls };
}

const stores = {
  memoria: () => createMemoryStore(),
  supabase: () => createSupabaseStore({ url: 'https://x.supabase.co', key: 'sb_secret_abc', fetchImpl: fakePostgrest().fetchImpl }),
};

for (const [name, make] of Object.entries(stores)) {
  test(`${name}: crea, lee y rechaza un codigo repetido`, async () => {
    const store = make();
    assert.equal(await store.get('ABCDE'), null);
    assert.equal(await store.create(room('ABCDE')), true);
    assert.equal(await store.create(room('ABCDE')), false);
    const rec = await store.get('ABCDE');
    assert.equal(rec.version, 1);
    assert.equal(rec.room.seats[0].name, 'A');
    assert.equal(await store.count(), 1);
  });

  test(`${name}: guardar exige la version leida`, async () => {
    const store = make();
    await store.create(room('ABCDE'));
    const first = await store.get('ABCDE');
    first.room.status = 'playing';
    assert.equal(await store.save(first.room, first.version), true);
    assert.equal(await store.save(first.room, first.version), false, 'version vieja');
    const again = await store.get('ABCDE');
    assert.equal(again.version, 2);
    assert.equal(again.room.status, 'playing');
  });

  test(`${name}: limpia las salas sin actividad`, async () => {
    const store = make();
    await store.create(room('VIEJA', 1000));
    await store.create(room('NUEVA', 9_000_000_000_000));
    await store.sweep(5_000_000_000_000);
    assert.equal(await store.get('VIEJA'), null);
    assert.ok(await store.get('NUEVA'));
  });
}

test('supabase: manda la clave secreta solo en apikey y escapa el codigo', async () => {
  const fake = fakePostgrest();
  const store = createSupabaseStore({ url: 'https://x.supabase.co/', key: 'sb_secret_abc', fetchImpl: fake.fetchImpl });
  await store.get('AB CD');
  const { url, init } = fake.calls[0];
  assert.equal(url.origin + url.pathname, 'https://x.supabase.co/rest/v1/rooms');
  assert.equal(url.searchParams.get('code'), 'eq.AB CD');
  assert.equal(init.headers.apikey, 'sb_secret_abc');
  assert.equal(init.headers.Authorization, undefined);
});

test('supabase: una clave JWT vieja tambien va como Bearer', async () => {
  const fake = fakePostgrest();
  const store = createSupabaseStore({ url: 'https://x.supabase.co', key: 'aaa.bbb.ccc', fetchImpl: fake.fetchImpl });
  await store.count();
  assert.equal(fake.calls[0].init.headers.Authorization, 'Bearer aaa.bbb.ccc');
});

test('supabase: falla claro si faltan las variables o la base responde mal', async () => {
  assert.throws(() => createSupabaseStore({ url: '', key: '' }), /SUPABASE_URL/);
  const store = createSupabaseStore({ url: 'https://x.supabase.co', key: 'k', fetchImpl: async () => new Response('boom', { status: 500 }) });
  await assert.rejects(store.get('ABCDE'), /Supabase get falló \(500\)/);
});

test('supabase: limpia espacios y comillas de las variables y rechaza la clave publishable', async () => {
  const fake = fakePostgrest();
  const store = createSupabaseStore({ url: ' "https://x.supabase.co"
', key: '"sb_secret_abc"
', fetchImpl: fake.fetchImpl });
  await store.count();
  assert.equal(fake.calls[0].init.headers.apikey, 'sb_secret_abc');
  assert.equal(fake.calls[0].url.origin, 'https://x.supabase.co');
  assert.throws(() => createSupabaseStore({ url: 'https://x.supabase.co', key: 'sb_publishable_abc' }), /publishable/);
});
