'use strict';
// Salas del arcade: dúo con un amigo invitado por link, run compartida en el servidor.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createRoomManager, RoomError, HAND_PAUSE_MS, BOT_DELAY_MIN_MS, BOT_DELAY_SPREAD_MS } = require('../server/rooms.js');
const { createMemoryStore } = require('../server/store-memory.js');
const { createApi } = require('../server/api.js');

const seeded = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const BOT_TICK_MS = BOT_DELAY_MIN_MS + BOT_DELAY_SPREAD_MS;
const throwsStatus = (promise, status) => assert.rejects(promise, (err) => err instanceof RoomError && err.status === status, `esperaba ${status}`);

function setup(seed = 11) {
  let clock = 1000;
  const store = createMemoryStore();
  const manager = createRoomManager({ store, rng: seeded(seed), now: () => clock });
  /** Cambia la sala guardada a mano (para llegar rápido a un final de partida). */
  const rig = async (code, fn) => {
    const { room, version } = await store.get(code);
    fn(room);
    assert.ok(await store.save(room, version));
  };
  return { manager, rig, advance: (ms) => { clock += ms; } };
}

async function openRoom(m, { friend = true } = {}) {
  const host = await m.manager.create({ mode: 'arcade', name: 'Ana' });
  const guest = friend ? await m.manager.join(host.code, 'Beto') : null;
  return { host, guest, code: host.code };
}

/** Pone a un equipo a un punto de ganar. */
const nearEnd = (winnerSeat) => (room) => {
  const s = room.state;
  s.scores = s.scores.map((_, seat) => (s.teams[seat] === s.teams[winnerSeat] ? 29 : 0));
};

/** Juegan los humanos (lo primero legal) y el reloj avanza hasta que la sala sale de 'playing'. */
async function playOut(m, code, players) {
  for (let guard = 0; guard < 5000; guard++) {
    let acted = false;
    for (const p of players) {
      const snap = await m.manager.snapshot(code, p.token);
      if (snap.status !== 'playing') return snap;
      if (snap.view.legal.length) {
        const legal = snap.view.legal;
        await m.manager.act(code, p.token, legal.find((x) => x.type === 'play' || x.type === 'accept') || legal[0]);
        acted = true;
      }
    }
    if (!acted) m.advance(HAND_PAUSE_MS + BOT_TICK_MS);
  }
  throw new Error('la partida no termina');
}

test('crear sala de arcade: lugar 0 para quien crea, el amigo entra al 2', async () => {
  const m = setup();
  const { host, guest, code } = await openRoom(m);
  assert.equal(guest.seat, 2);
  const info = await m.manager.info(code);
  assert.equal(info.kind, 'arcade');
  assert.equal(info.mode, 'dupla');
  await throwsStatus(m.manager.join(code, 'Caro'), 409);
  const snap = await m.manager.snapshot(code, host.token);
  assert.equal(snap.arcade.run, null);
});

test('al empezar arma la run compartida y pone a los rivales con su personalidad', async () => {
  const m = setup();
  const { host, guest, code } = await openRoom(m);
  await throwsStatus(m.manager.start(code, guest.token), 403);
  const snap = await m.manager.start(code, host.token);
  const { run } = snap.arcade;
  assert.equal(snap.status, 'playing');
  assert.equal(run.mode, 'duo');
  assert.equal(run.partner.name, 'Beto');
  assert.deepEqual([snap.seats[1].name, snap.seats[3].name], run.rivals.map((r) => r.name));
  assert.equal(snap.seats[2].kind, 'human');
  assert.equal(snap.view.hand.length, 3);
});

test('sin amigo, el anfitrión pone un bot de compañero', async () => {
  const m = setup();
  const { host, code } = await openRoom(m, { friend: false });
  await m.manager.setSeat(code, host.token, 2, 'bot');
  await throwsStatus(m.manager.setSeat(code, host.token, 1, 'bot'), 409);
  const snap = await m.manager.start(code, host.token);
  assert.equal(snap.seats[2].kind, 'bot');
  assert.equal(snap.arcade.run.partner, undefined, 'con un bot desde el principio no hay bolsillo del compañero');
});

test('en el lobby, el anfitrión saca a un amigo que se fue para invitar a otro', async () => {
  const m = setup();
  const { host, code } = await openRoom(m);
  await m.manager.setSeat(code, host.token, 2, 'empty');
  const again = await m.manager.join(code, 'Caro');
  assert.equal(again.seat, 2);
});

test('los lugares y el modo del dúo no se cambian', async () => {
  const m = setup();
  const { host, guest, code } = await openRoom(m);
  await throwsStatus(m.manager.configure(code, host.token, { mode: 'duel' }), 409);
  await throwsStatus(m.manager.sit(code, guest.token, 1), 409);
});

test('ganar la partida abre la tienda para los dos con la bolsa común', async () => {
  const m = setup();
  const { host, guest, code } = await openRoom(m);
  await m.manager.start(code, host.token);
  await m.rig(code, nearEnd(0));
  const snap = await playOut(m, code, [host, guest]);
  assert.equal(snap.status, 'shop');
  assert.equal(snap.arcade.run.phase, 'shop');
  assert.equal(snap.arcade.run.wins, 1);
  const guestSnap = await m.manager.snapshot(code, guest.token, 0);
  assert.equal(guestSnap.arcade.run.coins, snap.arcade.run.coins);
  assert.ok(guestSnap.events.some((e) => e.type === 'arcade-gain' && e.reason === 'victoria'));
});

test('en la tienda cada uno compra para sí y la ronda sigue cuando los dos dan Listo', async () => {
  const m = setup();
  const { host, guest, code } = await openRoom(m);
  await m.manager.start(code, host.token);
  await m.rig(code, (room) => { room.arcade.run.coins = 100; nearEnd(0)(room); });
  await playOut(m, code, [host, guest]);
  let { run } = (await m.manager.snapshot(code, host.token)).arcade;
  const amulets = run.shop.items.map((it, i) => ({ ...it, i })).filter((it) => it.type === 'amulet');

  await m.manager.shop(code, host.token, { op: 'buy', index: amulets[0].i });
  await m.manager.shop(code, guest.token, { op: 'buy', index: amulets[1].i });
  await throwsStatus(m.manager.shop(code, guest.token, { op: 'buy', index: amulets[0].i }), 409);
  run = (await m.manager.snapshot(code, host.token)).arcade.run;
  assert.deepEqual(run.amulets, [amulets[0].id]);
  assert.deepEqual(run.partner.amulets, [amulets[1].id]);

  await m.manager.shop(code, host.token, { op: 'ready' });
  let snap = await m.manager.snapshot(code, host.token);
  assert.equal(snap.status, 'shop', 'falta que el amigo dé Listo');
  assert.equal(snap.arcade.ready[0], true);
  await m.manager.shop(code, guest.token, { op: 'ready' });
  snap = await m.manager.snapshot(code, host.token);
  assert.equal(snap.status, 'playing');
  assert.equal(snap.arcade.run.round, 2);
  assert.equal(snap.view.mods ? true : false, true, 'el anfitrión juega con su amuleto');
  const guestView = (await m.manager.snapshot(code, guest.token)).view;
  assert.ok(guestView.mods, 'el amigo juega con el suyo');
});

test('la tienda valida la operación y quién la pide', async () => {
  const m = setup();
  const { host, code } = await openRoom(m);
  await m.manager.start(code, host.token);
  await throwsStatus(m.manager.shop(code, host.token, { op: 'robar' }), 400);
  await throwsStatus(m.manager.shop(code, host.token, { op: 'buy', index: 'x' }), 400);
  await throwsStatus(m.manager.shop(code, host.token, { op: 'sell', id: '__proto__' }), 400);
  await throwsStatus(m.manager.shop(code, 'token-ajeno', { op: 'ready' }), 403);
  await throwsStatus(m.manager.shop(code, host.token, { op: 'ready' }), 409);
  const plain = await m.manager.create({ mode: 'duel', name: 'X' });
  await throwsStatus(m.manager.shop(plain.code, plain.token, { op: 'ready' }), 409);
});

test('perder termina la run para los dos', async () => {
  const m = setup();
  const { host, guest, code } = await openRoom(m);
  await m.manager.start(code, host.token);
  await m.rig(code, nearEnd(1));
  const snap = await playOut(m, code, [host, guest]);
  assert.equal(snap.status, 'ended');
  assert.equal(snap.arcade.run.phase, 'over');
});

test('si el amigo se va, nadie pierde por abandono: la partida espera', async () => {
  const m = setup();
  const { host, code } = await openRoom(m);
  await m.manager.start(code, host.token);
  for (let i = 0; i < 12; i++) {
    m.advance(60 * 1000);
    await m.manager.snapshot(code, host.token);
  }
  assert.equal((await m.manager.snapshot(code, host.token)).status, 'playing');
});

test('el anfitrión pasa el lugar del amigo a un bot y, en la tienda, cuenta como listo', async () => {
  const m = setup();
  const { host, guest, code } = await openRoom(m);
  await m.manager.start(code, host.token);
  await m.rig(code, nearEnd(0));
  await playOut(m, code, [host, guest]);
  await m.manager.shop(code, host.token, { op: 'ready' });
  await m.manager.setSeat(code, host.token, 2, 'bot');
  const snap = await m.manager.snapshot(code, host.token);
  assert.equal(snap.seats[2].kind, 'bot');
  assert.equal(snap.status, 'playing');
  assert.equal(snap.arcade.run.partner.name, 'Compañero bot');
  await throwsStatus(m.manager.snapshot(code, guest.token), 403);
});

test('API HTTP: crear sala de arcade y usar la tienda', async () => {
  const manager = createRoomManager({ rng: seeded(5) });
  const api = createApi(manager);
  const server = http.createServer(async (req, res) => {
    if (await api.handle(req, res, new URL(req.url, 'http://x'))) return;
    res.writeHead(404).end();
  });
  const base = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.status);
  try {
    const created = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'arcade', name: 'Ana' }) }).then((r) => r.json());
    const { code, token } = created.data;
    assert.equal(await post(`${base}/api/rooms/${code}/start`, { token }), 200);
    assert.equal(await post(`${base}/api/rooms/${code}/shop`, { token, op: 'ready' }), 409);
    assert.equal(await post(`${base}/api/rooms/${code}/shop`, { token: 'x', op: 'ready' }), 403);
    assert.equal(await post(`${base}/api/rooms/${code}/shop`, { token, op: 'nada' }), 400);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
