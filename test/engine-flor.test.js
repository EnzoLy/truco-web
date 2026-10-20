'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/engine.js');

const c = (num, suit) => ({ num, suit });
const clone = (o) => JSON.parse(JSON.stringify(o));

function rig(hands, { mano = 0, mods = null } = {}) {
  let { state } = T.dealHand(T.newGame(() => 0.9, { mods }));
  state = clone(state);
  state.mano = mano;
  state.scores = [0, 0];
  state.hands = clone(hands);
  state.dealt = clone(hands);
  state.cur = { leader: mano, cards: [null, null] };
  state.playTurn = state.turn = mano;
  return state;
}

const flor = [c(4, 'oro'), c(5, 'oro'), c(7, 'oro')];
const plain = [c(1, 'espada'), c(2, 'copa'), c(3, 'basto')];
const hasFlorAction = (s, p) => T.legalActions(s, p).some((a) => a.type === 'flor');

test('sin el amuleto de flor no se puede cantar flor aunque tengas tres del mismo palo', () => {
  const s = rig([flor, plain]);
  assert.equal(hasFlorAction(s, 0), false);
});

test('con el amuleto y flor en la mano se puede cantar flor', () => {
  const s = rig([flor, plain], { mods: [{ flor: true }, {}] });
  assert.equal(hasFlorAction(s, 0), true);
  assert.equal(T.viewFor(s, 0).myFlor, true);
});

test('con el amuleto pero sin flor en la mano no aparece la flor', () => {
  const s = rig([plain, flor], { mods: [{ flor: true }, {}] });
  assert.equal(hasFlorAction(s, 0), false);
  assert.equal(T.viewFor(s, 0).myFlor, false);
});

test('cantar flor suma 3 puntos, anula el envido y sigue tu turno', () => {
  const s = rig([flor, plain], { mods: [{ flor: true }, {}] });
  const { state, events } = T.step(s, 0, { type: 'flor' });
  assert.deepEqual(state.scores, [3, 0]);
  assert.equal(state.envido.done, true);
  assert.equal(state.turn, 0);
  assert.equal(state.phase, 'play');
  assert.ok(events.some((e) => e.type === 'flor' && e.by === 0 && e.awarded === 3));
  assert.equal(hasFlorAction(state, 0), false);
  assert.equal(T.legalActions(state, 0).some((a) => a.type === 'envido'), false);
});

test('la flor responde a un envido: el envido se anula sin puntos para quien lo cantó', () => {
  const s = rig([plain, flor], { mods: [{}, { flor: true }] });
  const called = T.step(s, 0, { type: 'envido', what: 'envido' }).state;
  assert.equal(hasFlorAction(called, 1), true);
  const { state } = T.step(called, 1, { type: 'flor' });
  assert.deepEqual(state.scores, [0, 3]);
  assert.equal(state.phase, 'play');
  assert.equal(state.turn, 0);
  assert.equal(state.pending, null);
});

test('la flor ante un truco deja pendiente la respuesta al truco', () => {
  const s = rig([plain, flor], { mods: [{}, { flor: true }] });
  const called = T.step(s, 0, { type: 'truco' }).state;
  const { state } = T.step(called, 1, { type: 'flor' });
  assert.equal(state.phase, 'respond-truco');
  assert.equal(state.turn, 1);
  assert.deepEqual(state.scores, [0, 3]);
});

test('después de tirar tu primera carta ya no hay flor', () => {
  const s = rig([flor, plain], { mods: [{ flor: true }, {}] });
  const played = T.step(s, 0, { type: 'play', index: 0 }).state;
  const back = T.step(played, 1, { type: 'play', index: 2 }).state;
  assert.equal(hasFlorAction(back, 0), false);
});
