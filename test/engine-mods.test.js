'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/engine.js');

const c = (num, suit) => ({ num, suit });
const clone = (o) => JSON.parse(JSON.stringify(o));

/** Estado con manos exactas y mods. Las mejoras se aplican como lo haria dealHand. */
function rig(hands, { mano = 0, scores = [0, 0], mods = null } = {}) {
  let { state } = T.dealHand(T.newGame(() => 0.9, { mods }));
  state = clone(state);
  state.mano = mano;
  state.scores = scores;
  state.hands = T.applyUpgrades(clone(hands), mods);
  state.dealt = clone(state.hands);
  state.cur = { leader: mano, cards: [null, null] };
  state.playTurn = state.turn = mano;
  return state;
}

function playOut(state, moves) {
  let s = state;
  const events = [];
  for (const [p, a] of moves) {
    const r = T.step(s, p, a);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

const weak = [c(4, 'oro'), c(5, 'copa'), c(6, 'basto')];
const strong = [c(1, 'espada'), c(1, 'basto'), c(7, 'espada')];

test('sin mods el estado no trae mods y el motor juega igual', () => {
  const g = T.newGame(() => 0.1);
  assert.equal(g.mods, null);
  const { state } = T.dealHand(g, () => 0.3);
  assert.ok(state.hands[0].every((card) => card.up === undefined));
});

test('newGame guarda los mods por jugador', () => {
  const mods = [{ trucoBonus: 1 }, {}];
  const g = T.newGame(() => 0.1, { mods });
  assert.deepEqual(g.mods, mods);
});

test('trucoBonus suma puntos al ganar una mano con truco querido', () => {
  const s = rig([strong, weak], { mods: [{ trucoBonus: 2 }, {}] });
  const { state, events } = playOut(s, [
    [0, { type: 'truco' }], [1, { type: 'accept' }],
    [0, { type: 'play', index: 0 }], [1, { type: 'play', index: 0 }],
    [0, { type: 'play', index: 0 }], [1, { type: 'play', index: 0 }],
  ]);
  const end = events.find((e) => e.type === 'hand-end');
  assert.equal(end.points, 4);
  assert.equal(end.bonus, 2);
  assert.equal(state.scores[0], 4);
});

test('trucoBonus no suma en una mano sin truco', () => {
  const s = rig([strong, weak], { mods: [{ trucoBonus: 2 }, {}] });
  const { state } = playOut(s, [
    [0, { type: 'play', index: 0 }], [1, { type: 'play', index: 0 }],
    [0, { type: 'play', index: 0 }], [1, { type: 'play', index: 0 }],
  ]);
  assert.equal(state.scores[0], 1);
});

test('trucoBonus suma cuando el rival no quiere el truco', () => {
  const s = rig([strong, weak], { mods: [{ trucoBonus: 1 }, {}] });
  const { state } = playOut(s, [[0, { type: 'truco' }], [1, { type: 'reject' }]]);
  assert.equal(state.scores[0], 2);
});

test('el bonus de un jugador no ayuda al otro', () => {
  const s = rig([weak, strong], { mods: [{ trucoBonus: 3 }, {}] });
  const { state } = playOut(s, [
    [0, { type: 'truco' }], [1, { type: 'accept' }],
    [0, { type: 'play', index: 0 }], [1, { type: 'play', index: 0 }],
    [1, { type: 'play', index: 0 }], [0, { type: 'play', index: 0 }],
  ]);
  assert.equal(state.scores[1], 2);
  assert.equal(state.scores[0], 0);
});

test('envidoBonus suma al ganar el envido, querido o no', () => {
  const hands = [[c(7, 'oro'), c(6, 'oro'), c(4, 'copa')], [c(4, 'basto'), c(5, 'espada'), c(12, 'copa')]];
  const mods = [{ envidoBonus: 1 }, {}];
  const accepted = playOut(rig(hands, { mods }), [[0, { type: 'envido', what: 'envido' }], [1, { type: 'accept' }]]);
  const result = accepted.events.find((e) => e.type === 'envido-result');
  assert.equal(result.awarded, 3);
  assert.equal(result.bonus, 1);
  assert.equal(accepted.state.scores[0], 3);

  const rejected = playOut(rig(hands, { mods }), [[0, { type: 'envido', what: 'envido' }], [1, { type: 'reject' }]]);
  assert.equal(rejected.state.scores[0], 2);
});

test('envidoCountBonus cambia quien gana el envido', () => {
  const hands = [[c(5, 'oro'), c(4, 'oro'), c(12, 'copa')], [c(6, 'basto'), c(4, 'basto'), c(12, 'oro')]];
  const plain = playOut(rig(hands, { mano: 0 }), [[0, { type: 'envido', what: 'envido' }], [1, { type: 'accept' }]]);
  assert.equal(plain.events.find((e) => e.type === 'envido-result').winner, 1);

  const mods = [{ envidoCountBonus: 2 }, {}];
  const boosted = playOut(rig(hands, { mano: 0, mods }), [[0, { type: 'envido', what: 'envido' }], [1, { type: 'accept' }]]);
  const result = boosted.events.find((e) => e.type === 'envido-result');
  assert.equal(result.winner, 0);
  assert.deepEqual(result.points, [31, 30]);
});

test('viewFor muestra el envido con el bonus propio', () => {
  const hands = [[c(5, 'oro'), c(4, 'oro'), c(12, 'copa')], weak];
  const view = T.viewFor(rig(hands, { mods: [{ envidoCountBonus: 3 }, {}] }), 0);
  assert.equal(view.myEnvido, 32);
});

test('una carta mejorada gana la baza solo en manos de su duenio', () => {
  const mods = [{ upgrades: { '4copa': { rank: 15 } } }, {}];
  const mine = rig([[c(4, 'copa'), c(5, 'oro'), c(6, 'oro')], strong], { mods });
  const r1 = T.step(T.step(mine, 0, { type: 'play', index: 0 }).state, 1, { type: 'play', index: 0 });
  assert.equal(r1.events.find((e) => e.type === 'trick').winner, 0);

  // El bot tiene el 4 de copa: la mejora del humano no lo ayuda.
  const theirs = rig([strong, [c(4, 'copa'), c(5, 'oro'), c(6, 'oro')]], { mods });
  assert.equal(theirs.hands[1][0].up, undefined);
  const r2 = T.step(T.step(theirs, 0, { type: 'play', index: 0 }).state, 1, { type: 'play', index: 0 });
  assert.equal(r2.events.find((e) => e.type === 'trick').winner, 0);
});

test('rankOf y envidoPoints respetan la mejora de la carta', () => {
  const up = { num: 4, suit: 'copa', up: { rank: 12, envido: 7 } };
  assert.equal(T.rankOf(up), 12);
  assert.equal(T.envidoPoints([up, c(6, 'copa'), c(1, 'oro')]), 33);
});

test('dealHand aplica las mejoras del duenio al repartir', () => {
  const mods = [{ upgrades: Object.fromEntries(T.makeDeck().map((k) => [`${k.num}${k.suit}`, { rank: 15 }])) }, {}];
  const { state } = T.dealHand(T.newGame(() => 0.2, { mods }), () => 0.4);
  assert.ok(state.hands[0].every((card) => card.up && card.up.rank === 15));
  assert.ok(state.hands[1].every((card) => card.up === undefined));
});

test('peek all muestra la mano del rival en viewFor', () => {
  const s = rig([weak, strong], { mods: [{}, { peek: 'all' }] });
  assert.deepEqual(T.viewFor(s, 1).oppHand, weak);
  assert.equal(T.viewFor(s, 0).oppHand, undefined);
});

test('peek one muestra una sola carta del rival', () => {
  const s = rig([weak, strong], { mods: [{ peek: 'one' }, {}] });
  const view = T.viewFor(s, 0);
  assert.equal(view.oppHand, undefined);
  assert.deepEqual(view.oppPeek, strong[0]);
});

test('envidoHint avisa si el rival tiene mas de 27', () => {
  const high = [c(7, 'oro'), c(6, 'oro'), c(4, 'copa')];
  assert.equal(T.viewFor(rig([weak, high], { mods: [{ envidoHint: true }, {}] }), 0).oppEnvidoHigh, true);
  assert.equal(T.viewFor(rig([high, weak], { mods: [{ envidoHint: true }, {}] }), 0).oppEnvidoHigh, false);
  assert.equal(T.viewFor(rig([weak, high]), 0).oppEnvidoHigh, undefined);
});

test('peekEvery muestra la mano del rival solo en una de cada N manos, y el espejito sigue en las demás', () => {
  const s = rig([weak, strong], { mods: [{ peekEvery: 3, peek: 'one' }, {}] });
  s.handNo = 3;
  assert.deepEqual(T.viewFor(s, 0).oppHand, strong);
  s.handNo = 4;
  const v = T.viewFor(s, 0);
  assert.equal(v.oppHand, undefined);
  assert.deepEqual(v.oppPeek, strong[0]);
  const plain = rig([weak, strong], { mods: [{ peekEvery: 3 }, {}] });
  plain.handNo = 2;
  assert.equal(T.viewFor(plain, 0).oppHand, undefined);
  assert.equal(T.viewFor(plain, 0).oppPeek, undefined);
});
