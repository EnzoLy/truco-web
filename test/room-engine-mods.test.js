'use strict';
// Amuletos del arcade (dúo) en el motor de salas: cada asiento tiene sus mods y el bonus es solo de quien ganó el punto.
const test = require('node:test');
const assert = require('node:assert/strict');
const Room = require('../js/room-engine.js');
const Truco = require('../js/engine.js');

const seeded = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const card = (num, suit) => ({ num, suit });
const NONE = {};

/** Partida 2v2 (vos 0, rival 1, compañero 2, rival 3) con mods y manos fijas; el mano es el asiento 0. */
function setup(mods, hands) {
  const rng = seeded(3);
  const s = structuredClone(Room.dealHand(Room.newGame('dupla', rng, { mods }), rng).state);
  s.hands = structuredClone(hands);
  s.dealt = structuredClone(hands);
  s.mano = 0;
  s.teams = Room.teamsFor('dupla', 0);
  s.turn = 0;
  s.playTurn = 0;
  s.phase = 'play';
  s.cur = { leader: 0, cards: [null, null, null, null] };
  return s;
}

const HANDS = [
  [card(7, 'oro'), card(6, 'oro'), card(4, 'basto')], // 33 de envido
  [card(4, 'copa'), card(5, 'espada'), card(6, 'basto')],
  [card(1, 'copa'), card(2, 'oro'), card(3, 'basto')],
  [card(4, 'oro'), card(5, 'copa'), card(12, 'espada')],
];

function run(s, moves) {
  let state = s;
  const events = [];
  for (const [seat, action] of moves) {
    const r = Room.step(state, seat, action);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

test('sin mods el motor de salas sigue igual: hay consulta de flor y la vista no trae datos de amuletos', () => {
  const rng = seeded(5);
  const s = Room.dealHand(Room.newGame('dupla', rng), rng).state;
  assert.equal(s.mods, undefined);
  const view = Room.viewFor(s, s.turn);
  assert.ok(view.legal.some((a) => a.type === 'ask-flor'));
  assert.equal(view.mods, undefined);
  assert.equal(view.oppHands, undefined);
});

test('las mejoras de cartas se aplican solo a las cartas de su dueño al repartir', () => {
  const everyCard = Object.fromEntries(Truco.makeDeck().map((c) => [Truco.cardKey(c), { rank: 14 }]));
  const rng = seeded(9);
  const s = Room.dealHand(Room.newGame('dupla', rng, { mods: [{ upgrades: everyCard }, NONE, NONE, NONE] }), rng).state;
  assert.ok(s.hands[0].every((c) => c.up && c.up.rank === 14));
  assert.ok(s.dealt[0].every((c) => c.up));
  [1, 2, 3].forEach((seat) => assert.ok(s.hands[seat].every((c) => !c.up), `asiento ${seat}`));
});

test('con mods no hay consulta de flor: solo canta flor quien tiene el amuleto', () => {
  const flor = [card(1, 'oro'), card(5, 'oro'), card(7, 'oro')];
  const hands = [flor, HANDS[1], HANDS[2], HANDS[3]];
  const without = setup([NONE, NONE, NONE, NONE], hands);
  assert.ok(!Room.legalActions(without, 0).some((a) => a.type === 'ask-flor' || a.type === 'flor'));
  assert.ok(Room.legalActions(without, 0).some((a) => a.type === 'envido'), 'sin amuleto la mano de flor canta envido');
  const withAmulet = setup([{ flor: true }, NONE, NONE, NONE], hands);
  assert.ok(Room.legalActions(withAmulet, 0).some((a) => a.type === 'flor'));
  const { state, events } = run(withAmulet, [[0, { type: 'flor', what: 'flor' }]]);
  const result = events.find((e) => e.type === 'flor-result');
  assert.equal(result.winner, 0);
  assert.equal(result.awarded, 3);
  assert.deepEqual(state.scores, [3, 0, 3, 0]);
});

test('el bonus de truco cuenta solo si el truco lo cantó el dueño del amuleto', () => {
  const mods = [{ trucoBonus: 1 }, NONE, NONE, NONE];
  const mine = run(setup(mods, HANDS), [[0, { type: 'truco' }], [1, { type: 'reject' }]]);
  const end = mine.events.find((e) => e.type === 'hand-end');
  assert.equal(end.bonus, 1);
  assert.deepEqual(mine.state.scores, [2, 0, 2, 0]);

  // Ahora canta el compañero (asiento 2): el amuleto del asiento 0 no suma.
  const partner = run(setup(mods, HANDS), [
    [0, { type: 'play', index: 0 }], [1, { type: 'play', index: 0 }],
    [2, { type: 'truco' }], [1, { type: 'reject' }],
  ]);
  assert.equal(partner.events.find((e) => e.type === 'hand-end').bonus, 0);
  assert.deepEqual(partner.state.scores, [1, 0, 1, 0]);
});

test('el fin de mano dice qué asiento ganó cada baza', () => {
  const hands = structuredClone(HANDS);
  hands[0] = [card(1, 'espada'), card(1, 'basto'), card(7, 'espada')];
  const plays = [0, 1, 2, 3, 0, 1, 2, 3].map((seat) => [seat, { type: 'play', index: 0 }]);
  const { events } = run(setup([NONE, NONE, NONE, NONE], hands), plays);
  const end = events.find((e) => e.type === 'hand-end');
  assert.equal(end.winner, 0);
  assert.deepEqual(end.trickSeats, [0, 0]);
});

test('el bonus de envido cuenta solo si el envido se ganó con los puntos del dueño', () => {
  const mods = [{ envidoBonus: 1 }, NONE, NONE, NONE];
  const mine = run(setup(mods, HANDS), [[0, { type: 'envido', what: 'envido' }], [1, { type: 'accept' }]]);
  const result = mine.events.find((e) => e.type === 'envido-result');
  assert.equal(result.winner, 0);
  assert.equal(result.ownerSeat, 0);
  assert.equal(result.bonus, 1);
  assert.deepEqual(mine.state.scores, [3, 0, 3, 0]);

  // El compañero tiene más envido: gana el equipo, pero con puntos del asiento 2.
  const better = structuredClone(HANDS);
  better[0] = [card(4, 'oro'), card(5, 'copa'), card(6, 'basto')];
  better[3] = [card(7, 'basto'), card(2, 'oro'), card(3, 'copa')];
  better[2] = [card(7, 'copa'), card(6, 'copa'), card(1, 'basto')];
  const partner = run(setup(mods, better), [[0, { type: 'envido', what: 'envido' }], [1, { type: 'accept' }]]);
  const r2 = partner.events.find((e) => e.type === 'envido-result');
  assert.equal(r2.ownerSeat, 2);
  assert.equal(r2.bonus, 0);
  assert.deepEqual(partner.state.scores, [2, 0, 2, 0]);
});

test('el bonus al contar envido es solo del asiento que lo tiene y puede dar vuelta el resultado', () => {
  const hands = structuredClone(HANDS);
  hands[0] = [card(5, 'oro'), card(3, 'oro'), card(4, 'basto')]; // 28
  hands[1] = [card(7, 'copa'), card(2, 'copa'), card(4, 'espada')]; // 29
  const plain = run(setup([NONE, NONE, NONE, NONE], hands), [[0, { type: 'envido', what: 'envido' }], [1, { type: 'accept' }]]);
  assert.equal(plain.events.find((e) => e.type === 'envido-result').winner, 1);
  const boosted = setup([{ envidoCountBonus: 2 }, NONE, NONE, NONE], hands);
  assert.equal(Room.viewFor(boosted, 0).myEnvido, 30);
  const r = run(boosted, [[0, { type: 'envido', what: 'envido' }], [1, { type: 'accept' }]]);
  const result = r.events.find((e) => e.type === 'envido-result');
  assert.equal(result.winner, 0);
  assert.equal(result.points[0], 30);
});

test('espiar: una carta de cada rival, toda la mano, o saber si tienen más de 27', () => {
  const one = setup([{ peek: 'one' }, NONE, NONE, NONE], HANDS);
  const v1 = Room.viewFor(one, 0);
  assert.deepEqual(v1.oppPeeks, [{ seat: 1, card: HANDS[1][0] }, { seat: 3, card: HANDS[3][0] }]);
  assert.equal(v1.oppHands, undefined);

  const all = setup([{ peek: 'all' }, NONE, NONE, NONE], HANDS);
  assert.deepEqual(Room.viewFor(all, 0).oppHands, [{ seat: 1, hand: HANDS[1] }, { seat: 3, hand: HANDS[3] }]);

  const hands = structuredClone(HANDS);
  hands[3] = [card(7, 'espada'), card(6, 'espada'), card(1, 'oro')]; // 33
  const hint = setup([{ envidoHint: true }, NONE, NONE, NONE], hands);
  assert.deepEqual(Room.viewFor(hint, 0).oppEnvidoHigh, [{ seat: 1, high: false }, { seat: 3, high: true }]);

  // Un asiento sin amuletos de información no ve nada de eso.
  const partnerView = Room.viewFor(all, 2);
  assert.equal(partnerView.oppHands, undefined);
  assert.equal(partnerView.oppPeeks, undefined);
});

test('el rival tramposo (peek all) ve las manos de los dos rivales en su vista de bot', () => {
  const s = setup([NONE, { peek: 'all' }, NONE, NONE], HANDS);
  const view = Room.viewFor(s, 1, { team: true });
  assert.deepEqual(view.oppHands.map((o) => o.seat), [0, 2]);
});
