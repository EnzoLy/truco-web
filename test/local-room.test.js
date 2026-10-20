'use strict';
// Sala local (arcade dúo): room-engine + room-bot corriendo en el navegador, con un reloj falso.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalRoom, HAND_PAUSE_MS, BOT_DELAY_MAX_MS } = require('../js/local-room.js');

const seeded = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

/** Reloj falso: los timers solo corren cuando el test lo pide. */
function fakeClock() {
  let now = 0;
  let timers = [];
  let nextId = 1;
  return {
    setTimer(fn, ms) { const id = nextId++; timers.push({ id, at: now + ms, fn }); return id; },
    clearTimer(id) { timers = timers.filter((t) => t.id !== id); },
    /** Corre todo lo que vence en los próximos ms. */
    advance(ms) {
      const until = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const t = timers[0];
        if (!t || t.at > until) break;
        timers.shift();
        now = t.at;
        t.fn();
      }
      now = until;
    },
    pending: () => timers.length,
  };
}

const SEATS = [
  { name: 'Vos', kind: 'human' },
  { name: 'Rival A', kind: 'bot' },
  { name: 'Compañero', kind: 'bot' },
  { name: 'Rival B', kind: 'bot' },
];

function makeRoom(extra = {}) {
  const clock = fakeClock();
  const changes = [];
  const room = createLocalRoom({
    mode: 'dupla', seats: SEATS, rng: seeded(11),
    setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    onChange: (c) => changes.push(c),
    ...extra,
  });
  return { room, clock, changes };
}

/** Juega por el humano: siempre la primera carta, o quiere lo que le canten. */
function humanMove(room) {
  const view = room.snapshot().view;
  if (!view || !view.legal.length) return false;
  const action = view.legal.find((a) => a.type === 'accept') || view.legal.find((a) => a.type === 'play') || view.legal[0];
  room.act(action);
  return true;
}

test('al empezar reparte y arma un snapshot con la forma de las salas', () => {
  const { room, changes } = makeRoom();
  room.start();
  const s = room.snapshot();
  assert.equal(s.status, 'playing');
  assert.equal(s.seat, 0);
  assert.equal(s.n, 4);
  assert.deepEqual(s.seats.map((x) => x.name), SEATS.map((x) => x.name));
  assert.equal(s.view.hand.length, 3);
  assert.ok(s.events.some((e) => e.type === 'deal' && e.seq > 0));
  assert.deepEqual(s.signOptions, []);
  assert.ok(changes.length >= 1);
});

test('los bots juegan solos y esperan al humano cuando le toca', () => {
  const { room, clock } = makeRoom();
  room.start();
  for (let i = 0; i < 20; i++) {
    const view = room.snapshot().view;
    if (view.legal.length) break;
    clock.advance(BOT_DELAY_MAX_MS);
  }
  const view = room.snapshot().view;
  assert.ok(view.legal.length > 0, 'le llega el turno al humano');
  const before = room.snapshot().seq;
  clock.advance(BOT_DELAY_MAX_MS * 5);
  assert.equal(room.snapshot().seq, before, 'nadie juega por el humano');
});

test('una jugada ilegal tira error y no cambia nada', () => {
  const { room } = makeRoom();
  room.start();
  const before = JSON.stringify(room.getState());
  assert.throws(() => room.act({ type: 'play', index: 9 }));
  assert.equal(JSON.stringify(room.getState()), before);
});

test('una partida entera termina con game-end y status ended; las manos se reparten solas', () => {
  const { room, clock, changes } = makeRoom();
  room.start();
  let hands = 1;
  for (let i = 0; i < 5000 && room.snapshot().status !== 'ended'; i++) {
    if (!humanMove(room)) clock.advance(BOT_DELAY_MAX_MS);
    if (room.getState().phase === 'hand-over') {
      clock.advance(HAND_PAUSE_MS);
      hands += 1;
    }
  }
  assert.equal(room.snapshot().status, 'ended');
  assert.ok(hands > 2, `se jugaron ${hands} manos`);
  const events = changes.flatMap((c) => c.events);
  assert.ok(events.some((e) => e.type === 'game-end'));
  assert.equal(clock.pending(), 0, 'no queda nada programado');
});

test('con mods y traits por asiento: los rivales con trampa ven las manos', () => {
  const NONE = {};
  let seenView = null;
  const bot = { decide: (view, rng, traits) => { if (view.me === 1) seenView = { view, traits }; return view.legal[0]; } };
  const { room, clock } = makeRoom({
    mods: [NONE, { peek: 'all' }, NONE, NONE],
    seats: SEATS.map((s, i) => (i === 1 ? { ...s, traits: { bluffCall: 0.4 } } : s)),
    Bot: bot,
  });
  room.start();
  for (let i = 0; i < 30 && !seenView; i++) {
    if (!humanMove(room)) clock.advance(BOT_DELAY_MAX_MS);
  }
  assert.ok(seenView, 'el rival A jugó');
  assert.deepEqual(seenView.traits, { bluffCall: 0.4 });
  assert.deepEqual(seenView.view.oppHands.map((o) => o.seat), [0, 2]);
});

test('retoma una partida guardada: sigue en el mismo punto sin repartir de nuevo', () => {
  const { room, clock } = makeRoom();
  room.start();
  clock.advance(BOT_DELAY_MAX_MS * 3);
  const saved = room.getState();
  room.stop();
  const again = makeRoom({ initialState: saved });
  again.room.start();
  assert.deepEqual(again.room.getState().hands, saved.hands);
  assert.equal(again.room.snapshot().view.handNo, saved.handNo);
});
