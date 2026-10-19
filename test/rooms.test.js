'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createRoomManager, RoomError, HAND_PAUSE_MS, BOT_DELAY_MIN_MS, BOT_DELAY_SPREAD_MS, PRESENCE_MS } = require('../server/rooms.js');
const { createApi } = require('../server/api.js');

const seeded = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

/** Reloj manual: los bots y la pausa entre manos avanzan cuando el reloj pasa y alguien consulta. */
function manualManager() {
  let clock = 1000;
  const manager = createRoomManager({ rng: seeded(11), now: () => clock });
  return { manager, advance: (ms) => { clock += ms; } };
}

const BOT_TICK_MS = BOT_DELAY_MIN_MS + BOT_DELAY_SPREAD_MS;

const throwsStatus = (promise, status) => assert.rejects(promise, (err) => err instanceof RoomError && err.status === status, `esperaba ${status}`);

test('crear sala deja al anfitrion en el asiento 0 con un link por codigo', async () => {
  const { manager } = manualManager();
  const room = await manager.create({ mode: 'dupla', name: '  Ana <b> ' });
  assert.match(room.code, /^[A-HJ-NP-Z2-9]{5}$/);
  const info = await manager.info(room.code);
  assert.equal(info.mode, 'dupla');
  assert.equal(info.status, 'lobby');
  assert.equal(info.seats.length, 4);
  assert.equal(info.seats[0].name, 'Ana b');
  assert.equal(info.seats[1].kind, 'empty');
  assert.equal(JSON.stringify(info).includes(room.token), false);
});

test('se puede entrar con el codigo hasta llenar la sala', async () => {
  const { manager } = manualManager();
  const { code } = await manager.create({ mode: 'duel', name: 'A' });
  const b = await manager.join(code.toLowerCase(), 'B');
  assert.equal(b.seat, 1);
  await throwsStatus(manager.join(code, 'C'), 409);
  await throwsStatus(manager.join('ZZZZZ', 'C'), 404);
});

test('rechaza modos invalidos y tokens ajenos', async () => {
  const { manager } = manualManager();
  await throwsStatus(manager.create({ mode: 'solo' }), 400);
  const room = await manager.create({ mode: 'duel', name: 'A' });
  const guest = await manager.join(room.code, 'B');
  await throwsStatus(manager.start(room.code, 'no-es-un-token'), 403);
  await throwsStatus(manager.start(room.code, guest.token), 403);
  await throwsStatus(manager.configure(room.code, guest.token, { mode: 'trio' }), 403);
});

test('el anfitrion cambia el modo y los jugadores conservan su lugar', async () => {
  const { manager } = manualManager();
  const room = await manager.create({ mode: 'duel', name: 'A' });
  const guest = await manager.join(room.code, 'B');
  await manager.configure(room.code, room.token, { mode: 'dupla' });
  assert.equal((await manager.info(room.code)).seats.length, 4);
  assert.equal((await manager.snapshot(room.code, guest.token)).seat, 1);
  await manager.join(room.code, 'C');
  await manager.join(room.code, 'D');
  await throwsStatus(manager.configure(room.code, room.token, { mode: 'duel' }), 409);
});

test('cada uno puede elegir su equipo sentandose en un lugar libre', async () => {
  const { manager } = manualManager();
  const room = await manager.create({ mode: 'dupla', name: 'A' });
  const guest = await manager.join(room.code, 'B');
  await manager.sit(room.code, guest.token, 2);
  assert.equal((await manager.snapshot(room.code, guest.token)).seat, 2);
  await throwsStatus(manager.sit(room.code, guest.token, 0), 409);
  await throwsStatus(manager.sit(room.code, guest.token, 9), 400);
});

test('al empezar, los lugares vacios los ocupan bots', async () => {
  const { manager } = manualManager();
  const room = await manager.create({ mode: 'dupla', name: 'A' });
  const snap = await manager.start(room.code, room.token);
  assert.equal(snap.status, 'playing');
  assert.deepEqual(snap.seats.map((s) => s.kind), ['human', 'bot', 'bot', 'bot']);
  assert.equal(snap.view.hand.length, 3);
});

test('cada jugador recibe solo sus cartas', async () => {
  const { manager } = manualManager();
  const a = await manager.create({ mode: 'duel', name: 'A' });
  const b = await manager.join(a.code, 'B');
  await manager.start(a.code, a.token);
  const sa = await manager.snapshot(a.code, a.token);
  const sb = await manager.snapshot(a.code, b.token);
  assert.equal(sa.view.me, 0);
  assert.equal(sb.view.me, 1);
  const theirs = JSON.stringify(sb.view.hand);
  assert.notEqual(JSON.stringify(sa.view.hand), theirs);
  for (const c of sb.view.hand) assert.equal(JSON.stringify(sa).includes(JSON.stringify(c)) && !sa.view.hand.some((m) => m.num === c.num && m.suit === c.suit), false);
});

test('solo juega quien tiene el turno y las jugadas invalidas se rechazan', async () => {
  const { manager } = manualManager();
  const a = await manager.create({ mode: 'duel', name: 'A' });
  const b = await manager.join(a.code, 'B');
  await manager.start(a.code, a.token);
  const turn = (await manager.snapshot(a.code, a.token)).view.turn;
  const [mine, other] = turn === 0 ? [a, b] : [b, a];
  await throwsStatus(manager.act(a.code, other.token, { type: 'play', index: 0 }), 409);
  await throwsStatus(manager.act(a.code, mine.token, { type: 'play', index: 'x' }), 400);
  await throwsStatus(manager.act(a.code, mine.token, { type: 'hack' }), 400);
  await throwsStatus(manager.act(a.code, mine.token, { type: 'envido', what: 'mega' }), 400);
  await manager.act(a.code, mine.token, { type: 'play', index: 0 });
  assert.equal((await manager.snapshot(a.code, a.token)).view.turn, 1 - turn);
});

test('los eventos llegan con numero de secuencia y solo los nuevos', async () => {
  const { manager } = manualManager();
  const a = await manager.create({ mode: 'duel', name: 'A' });
  const b = await manager.join(a.code, 'B');
  await manager.start(a.code, a.token);
  const before = await manager.snapshot(a.code, a.token);
  const turn = before.view.turn;
  await manager.act(a.code, (turn === 0 ? a : b).token, { type: 'play', index: 0 });
  const after = await manager.snapshot(a.code, a.token, before.seq);
  const play = after.events.find((e) => e.type === 'play');
  assert.ok(play && play.seq > before.seq);
  assert.ok(after.events.every((e) => e.seq > before.seq));
});

test('la presencia depende de cuando consulto cada jugador por ultima vez', async () => {
  const { manager, advance } = manualManager();
  const a = await manager.create({ mode: 'duel', name: 'A' });
  const b = await manager.join(a.code, 'B');
  assert.equal((await manager.snapshot(a.code, a.token)).seats[0].connected, true);
  advance(PRESENCE_MS + 1000);
  const seen = await manager.snapshot(a.code, b.token);
  assert.equal(seen.seats[1].connected, true);
  assert.equal(seen.seats[0].connected, false);
});

test('la sala con bots juega sola hasta terminar y reparte entre manos', async () => {
  const { manager, advance } = manualManager();
  const a = await manager.create({ mode: 'dupla', name: 'A' });
  await manager.start(a.code, a.token);
  let guard = 0;
  let snap = await manager.snapshot(a.code, a.token);
  while (snap.status !== 'ended') {
    assert.ok(++guard < 20000, 'la partida no termina');
    if (snap.view.legal.length) {
      await manager.act(a.code, a.token, snap.view.legal.find((x) => x.type === 'play' || x.type === 'accept') || snap.view.legal[0]);
    } else {
      advance(HAND_PAUSE_MS + BOT_TICK_MS);
    }
    snap = await manager.snapshot(a.code, a.token);
  }
  assert.ok(snap.view.winners.length >= 1);
  assert.ok(Math.max(...snap.view.scores) >= 30);
});

test('la pausa entre manos reparte sola', async () => {
  const { manager, advance } = manualManager();
  const a = await manager.create({ mode: 'duel', name: 'A' });
  const b = await manager.join(a.code, 'B');
  await manager.start(a.code, a.token);
  const first = (await manager.snapshot(a.code, a.token)).view;
  await manager.act(a.code, (first.turn === 0 ? a : b).token, { type: 'mazo' });
  assert.equal((await manager.snapshot(a.code, a.token)).view.phase, 'hand-over');
  advance(HAND_PAUSE_MS - 100);
  assert.equal((await manager.snapshot(a.code, a.token)).view.phase, 'hand-over', 'todavia no pasó la pausa');
  advance(200);
  const next = (await manager.snapshot(a.code, a.token)).view;
  assert.equal(next.handNo, first.handNo + 1);
  assert.equal(next.phase, 'play');
});

test('el bot espera su turno y no juega antes de tiempo', async () => {
  const { manager, advance } = manualManager();
  const a = await manager.create({ mode: 'duel', name: 'A' });
  await manager.start(a.code, a.token);
  const first = await manager.snapshot(a.code, a.token);
  if (first.view.turn === 1) {
    advance(BOT_DELAY_MIN_MS - 100);
    assert.equal((await manager.snapshot(a.code, a.token)).seq, first.seq, 'el bot todavía piensa');
    advance(BOT_TICK_MS);
    assert.ok((await manager.snapshot(a.code, a.token)).seq > first.seq, 'el bot jugó');
  } else {
    advance(60 * 1000);
    const later = await manager.snapshot(a.code, a.token);
    assert.equal(later.seq, first.seq, 'si decide el humano, el bot no se adelanta');
    assert.equal(later.view.turn, 0);
  }
});

test('un poll tardio reproduce las jugadas de los bots en orden', async () => {
  const { manager, advance } = manualManager();
  const a = await manager.create({ mode: 'dupla', name: 'A' });
  const start = await manager.start(a.code, a.token);
  // Aunque el humano no consulte por un rato, los bots avanzan hasta que le toca decidir.
  advance(10 * 1000);
  const late = await manager.snapshot(a.code, a.token, start.seq);
  const seqs = late.events.map((e) => e.seq);
  assert.deepEqual(seqs, [...seqs].sort((x, y) => x - y));
  assert.equal(new Set(seqs).size, seqs.length);
});

test('el anfitrion puede reemplazar por un bot a quien se fue', async () => {
  const { manager, advance } = manualManager();
  const a = await manager.create({ mode: 'duel', name: 'A' });
  const b = await manager.join(a.code, 'B');
  await manager.start(a.code, a.token);
  await manager.setSeat(a.code, a.token, 1, 'bot');
  await throwsStatus(manager.snapshot(a.code, b.token), 403);
  assert.equal((await manager.snapshot(a.code, a.token)).seats[1].kind, 'bot');
  await throwsStatus(manager.setSeat(a.code, a.token, 0, 'bot'), 409);
  advance(BOT_TICK_MS * 3);
  assert.equal((await manager.snapshot(a.code, a.token)).view.turn, 0);
});

test('revancha vuelve al lobby solo cuando la partida termino', async () => {
  const { manager } = manualManager();
  const a = await manager.create({ mode: 'duel', name: 'A' });
  await manager.start(a.code, a.token);
  await throwsStatus(manager.rematch(a.code, a.token), 409);
});

test('senas: solo las ven los companeros y tienen enfriamiento', async () => {
  const { manager, advance } = manualManager();
  const a = await manager.create({ mode: 'dupla', name: 'A' });
  const b = await manager.join(a.code, 'B');
  const c = await manager.join(a.code, 'C');
  const d = await manager.join(a.code, 'D');
  await manager.start(a.code, a.token);
  await manager.sign(a.code, a.token, 'uno-espada');
  const forPartner = (await manager.snapshot(a.code, c.token)).signs; // asiento 2: companero del 0
  const forRival = (await manager.snapshot(a.code, b.token)).signs;
  assert.equal(forPartner.length, 1);
  assert.equal(forPartner[0].text, 'Tengo el 1 de espadas');
  assert.equal(forRival.length, 0);
  assert.equal((await manager.snapshot(a.code, d.token)).signs.length, 0);
  await throwsStatus(manager.sign(a.code, a.token, 'tres'), 429);
  advance(1500);
  await throwsStatus(manager.sign(a.code, a.token, 'inventada'), 400);
  await manager.sign(a.code, a.token, 'tres');
});

test('no hay senas en duelo', async () => {
  const { manager } = manualManager();
  const a = await manager.create({ mode: 'duel', name: 'A' });
  await manager.join(a.code, 'B');
  await manager.start(a.code, a.token);
  await throwsStatus(manager.sign(a.code, a.token, 'tres'), 409);
});

test('modo 3 jugadores: el mano descarta antes de jugar y los rivales ven a su companero', async () => {
  const { manager } = manualManager();
  const a = await manager.create({ mode: 'trio', name: 'A' });
  const b = await manager.join(a.code, 'B');
  const c = await manager.join(a.code, 'C');
  await manager.start(a.code, a.token);
  const tokens = [a.token, b.token, c.token];
  const view = (await manager.snapshot(a.code, a.token)).view;
  assert.equal(view.phase, 'discard');
  const mano = view.mano;
  const manoSnap = await manager.snapshot(a.code, tokens[mano]);
  assert.equal(manoSnap.view.hand.length, 4);
  await manager.act(a.code, tokens[mano], { type: 'discard', index: 0 });
  assert.equal((await manager.snapshot(a.code, tokens[mano])).view.hand.length, 3);
  assert.equal((await manager.snapshot(a.code, tokens[mano])).view.phase, 'play');
});

test('trio: el mano juega solo y no puede señar; los otros dos si', async () => {
  const { manager, advance } = manualManager();
  const a = await manager.create({ mode: 'trio', name: 'A' });
  const b = await manager.join(a.code, 'B');
  const c = await manager.join(a.code, 'C');
  await manager.start(a.code, a.token);
  const tokens = [a.token, b.token, c.token];
  const mano = (await manager.snapshot(a.code, a.token)).view.mano;
  const pair = [0, 1, 2].filter((seat) => seat !== mano);
  assert.deepEqual((await manager.snapshot(a.code, tokens[mano])).signOptions, []);
  await throwsStatus(manager.sign(a.code, tokens[mano], 'tres'), 409);
  await manager.sign(a.code, tokens[pair[0]], 'tres');
  assert.equal((await manager.snapshot(a.code, tokens[pair[1]])).signs.length, 1);
  assert.equal((await manager.snapshot(a.code, tokens[mano])).signs.length, 0);
  advance(1500);
});

test('las salas inactivas se limpian', async () => {
  const { manager, advance } = manualManager();
  await manager.create({ mode: 'duel', name: 'A' });
  assert.equal(await manager.size(), 1);
  advance(3 * 60 * 60 * 1000);
  await manager.sweep();
  assert.equal(await manager.size(), 0);
});

test('dos pedidos a la vez no se pisan: el que pierde reintenta sobre lo nuevo', async () => {
  const { manager } = manualManager();
  const room = await manager.create({ mode: 'dupla', name: 'A' });
  const joined = await Promise.all([manager.join(room.code, 'B'), manager.join(room.code, 'C'), manager.join(room.code, 'D')]);
  assert.deepEqual(joined.map((j) => j.seat).sort(), [1, 2, 3]);
  const info = await manager.info(room.code);
  assert.deepEqual(info.seats.map((s) => s.name).sort(), ['A', 'B', 'C', 'D']);
});

// ---------- HTTP real ----------

function listen() {
  const manager = createRoomManager({ rng: seeded(5) });
  const api = createApi(manager);
  const server = http.createServer(async (req, res) => {
    if (await api.handle(req, res, new URL(req.url, 'http://x'))) return;
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const getJson = (url) => fetch(url).then(async (r) => ({ status: r.status, body: await r.json() }));

test('API HTTP: crear, entrar, empezar y consultar el estado', async () => {
  const { server, base } = await listen();
  try {
    const created = await post(`${base}/api/rooms`, { mode: 'duel', name: 'Ana' });
    assert.equal(created.status, 200);
    const { code, token } = created.body.data;
    const joined = await post(`${base}/api/rooms/${code}/join`, { name: 'Beto' });
    assert.equal(joined.body.data.seat, 1);

    const lobby = await getJson(`${base}/api/rooms/${code}/state?token=${token}`);
    assert.equal(lobby.body.data.status, 'lobby');
    assert.equal(lobby.body.data.seats.length, 2);

    const started = await post(`${base}/api/rooms/${code}/start`, { token });
    assert.equal(started.status, 200);
    assert.equal(started.body.data.view.hand.length, 3);
    const playing = await getJson(`${base}/api/rooms/${code}/state?token=${token}&since=0`);
    assert.equal(playing.body.data.status, 'playing');

    const forged = await post(`${base}/api/rooms/${code}/act`, { token: 'x', action: { type: 'mazo' } });
    assert.equal(forged.status, 403);
    assert.equal((await getJson(`${base}/api/rooms/${code}/state?token=x`)).status, 403);
    const info = await getJson(`${base}/api/rooms/${code}`);
    assert.equal(info.body.data.seats.length, 2);
    assert.equal(JSON.stringify(info.body).includes(token), false);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('API HTTP: valida cuerpo, origen y ruta', async () => {
  const { server, base } = await listen();
  try {
    const bad = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{no json' });
    assert.equal(bad.status, 400);
    const big = await post(`${base}/api/rooms`, { name: 'x'.repeat(10000) }).catch(() => ({ status: 413 }));
    assert.equal(big.status, 413);
    const foreign = await post(`${base}/api/rooms`, { mode: 'duel' }, { Origin: 'http://malo.example' });
    assert.equal(foreign.status, 403);
    assert.equal((await fetch(`${base}/api/otra-cosa`)).status, 404);
    assert.equal((await fetch(`${base}/api/rooms/ZZZZZ`)).status, 404);
    assert.equal((await fetch(`${base}/api/rooms/../etc`)).status, 404);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('API: acepta el cuerpo que Vercel ya leyo en req.body', async () => {
  const api = createApi(createRoomManager({ rng: seeded(3) }));
  const run = async (body) => {
    const out = {};
    const res = { writeHead(status) { out.status = status; }, end(text) { out.json = JSON.parse(text); } };
    await api.handle({ method: 'POST', url: '/api/rooms', headers: { host: 'x' }, socket: {}, body }, res, new URL('http://x/api/rooms'));
    return out;
  };
  assert.equal((await run({ mode: 'duel', name: 'Ana' })).json.ok, true);
  assert.equal((await run('{"mode":"duel"}')).json.ok, true);
  assert.equal((await run(Buffer.from('{"mode":"trio"}'))).json.data.seat, 0);
  assert.equal((await run('{no json')).status, 400);
  assert.equal((await run('x'.repeat(5000))).status, 413);
});
