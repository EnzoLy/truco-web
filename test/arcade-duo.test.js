'use strict';
// Arcade dúo: vos + compañero bot contra dos rivales con personalidades distintas.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/engine.js');
globalThis.Truco = T;
const A = require('../js/arcade.js');
const Room = require('../js/room-engine.js');
const RoomBot = require('../js/room-bot.js');

const seeded = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const duo = (extra = {}) => ({ ...A.newRun(seeded(1), { mode: 'duo' }), ...extra });

test('una run de dúo trae dos rivales distintos y ningún rival solo', () => {
  for (let seed = 1; seed < 40; seed++) {
    const run = A.newRun(seeded(seed), { mode: 'duo' });
    assert.equal(run.mode, 'duo');
    assert.equal(run.rival, undefined);
    assert.equal(run.rivals.length, 2);
    assert.notEqual(run.rivals[0].id, run.rivals[1].id);
  }
});

test('la run solo no cambia: sin mode ni rivals', () => {
  const run = A.newRun(seeded(1));
  assert.equal(run.mode, undefined);
  assert.equal(run.rivals, undefined);
  assert.ok(run.rival);
});

test('el jefe del dúo es un Tahúr con un Coleccionista', () => {
  const rivals = A.rivalsFor(A.BOSS_EVERY, seeded(3));
  assert.deepEqual(rivals.map((r) => r.id).sort(), ['cargado', 'tramposo']);
  assert.ok(rivals.every((r) => r.boss));
});

test('los rivales del dúo usan traits del bot de salas', () => {
  const keys = new Set(Object.keys(RoomBot.DEFAULT_TRAITS));
  for (let seed = 1; seed < 30; seed++) {
    for (const r of A.rivalsFor(1 + (seed % 7), seeded(seed))) {
      for (const k of Object.keys(r.traits)) assert.ok(keys.has(k), `${r.id}: ${k}`);
    }
  }
});

test('mods del dúo por asiento: vos 0, rivales 1 y 3, compañero 2 sin nada', () => {
  const run = duo({ amulets: ['cantor', 'espejito'], upgrades: { '4copa': { rank: 8 } } });
  run.rivals = [
    { ...run.rivals[0], amulets: ['pico-de-oro'], cheat: false },
    { ...run.rivals[1], amulets: [], cheat: true },
  ];
  const mods = A.matchOptions(run).mods;
  assert.equal(mods.length, 4);
  assert.equal(mods[0].envidoBonus, 1);
  assert.equal(mods[0].peek, 'one');
  assert.deepEqual(mods[0].upgrades['4copa'], { rank: 8 });
  assert.equal(mods[1].trucoBonus, 1);
  assert.deepEqual(mods[2], {});
  assert.equal(mods[3].peek, 'all');
});

test('monedas por mano y envido que gana tu equipo; Propina solo si ganaste una baza', () => {
  const run = duo({ amulets: ['propina'] });
  const mine = A.onEvents(run, [{ type: 'hand-end', winner: 0, trickSeats: [0, 2] }], seeded(1));
  assert.equal(mine.run.coins - run.coins, 2);
  const partners = A.onEvents(run, [{ type: 'hand-end', winner: 0, trickSeats: [2, 2] }], seeded(1));
  assert.equal(partners.run.coins - run.coins, 1, 'la base sí, la Propina no');
  const theirs = A.onEvents(run, [{ type: 'hand-end', winner: 1, trickSeats: [1, 3] }], seeded(1));
  assert.equal(theirs.run.coins, run.coins);
});

test('Cuentero suma solo si el envido se ganó con tus puntos', () => {
  const run = duo({ amulets: ['cuentero'] });
  const mine = A.onEvents(run, [{ type: 'envido-result', winner: 0, ownerSeat: 0 }], seeded(1));
  assert.equal(mine.run.coins - run.coins, 3);
  const partner = A.onEvents(run, [{ type: 'envido-result', winner: 0, ownerSeat: 2 }], seeded(1));
  assert.equal(partner.run.coins - run.coins, 1);
});

test('la flor tuya da monedas de envido', () => {
  const run = duo({ amulets: ['flor'] });
  const r = A.onEvents(run, [{ type: 'flor-result', winner: 0, callers: [0] }], seeded(1));
  assert.equal(r.run.coins - run.coins, 1);
});

test('ganar la partida con tu compañero lleva a la tienda; perder termina la run', () => {
  const run = duo({ round: 2 });
  const won = A.onEvents(run, [{ type: 'game-end', winners: [0, 2] }], seeded(1)).run;
  assert.equal(won.phase, 'shop');
  assert.equal(won.wins, 1);
  const left = A.leaveShop(won, seeded(2));
  assert.equal(left.rivals.length, 2);
  assert.equal(left.round, 3);
  const lost = A.onEvents(run, [{ type: 'game-end', winners: [1, 3] }], seeded(1)).run;
  assert.equal(lost.phase, 'over');
});

test('una partida de dúo con amuletos se juega entera con el motor de salas', () => {
  const rng = seeded(8);
  const run = duo({ amulets: ['flor', 'pico-de-oro', 'bola-de-cristal'] });
  let s = Room.newGame('dupla', rng, A.matchOptions(run));
  s = Room.dealHand(s, rng).state;
  let current = run;
  for (let i = 0; i < 4000 && s.phase !== 'game-over'; i++) {
    if (s.phase === 'hand-over') { s = Room.dealHand(s, rng).state; continue; }
    const seat = [0, 1, 2, 3].find((p) => Room.legalActions(s, p).length);
    const traits = seat === 1 || seat === 3 ? current.rivals[(seat - 1) / 2].traits : {};
    const r = Room.step(s, seat, RoomBot.decide(Room.viewFor(s, seat, { team: true }), rng, traits), rng);
    s = r.state;
    current = A.onEvents(current, r.events, rng).run;
  }
  assert.equal(s.phase, 'game-over');
  assert.ok(['shop', 'over'].includes(current.phase));
});
