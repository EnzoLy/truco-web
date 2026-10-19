'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Room = require('../js/room-engine.js');
const T = require('../js/sala-text.js');

const seats = (names) => names.map((name, seat) => ({ seat, kind: 'human', name }));
const card = (num, suit) => ({ num, suit });

function viewOf(mode, me, tweak = {}) {
  const rng = () => 0.25;
  const state = Room.dealHand(Room.newGame(mode, rng), rng).state;
  return { ...Room.viewFor(state, me), ...tweak };
}

test('los cantos suenan como en la mesa', () => {
  assert.equal(T.eventText({ type: 'truco-call', level: 1, raise: false }), '¡Truco!');
  assert.equal(T.eventText({ type: 'truco-call', level: 3, raise: true }), '¡Quiero retruco y subo a vale cuatro!');
  assert.equal(T.eventText({ type: 'envido-call', what: 'falta' }), '¡Falta envido!');
  assert.equal(T.eventText({ type: 'envido-response', response: 'accept' }), '¡Quiero!');
  assert.equal(T.eventText({ type: 'truco-response', response: 'raise' }), null);
  assert.equal(T.eventText({ type: 'play' }), null);
});

test('quien habla es el que canta o responde', () => {
  assert.equal(T.speakerOf({ by: 2 }), 2);
  assert.equal(T.speakerOf({ player: 0 }), 0);
  assert.equal(T.shoutKind({ type: 'truco-call' }), 'shout-truco');
  assert.equal(T.shoutKind({ type: 'play' }), '');
});

test('el marcador del duelo muestra vos y el rival', () => {
  const view = { me: 1, n: 2, mode: 'duel', scores: [4, 9] };
  assert.deepEqual(T.scoreRows(view, seats(['Ana', 'Beto'])).map((r) => [r.label, r.score, r.tone]), [['Vos', 9, 'me'], ['Ana', 4, 'rival']]);
});

test('el marcador de dupla junta a los companeros', () => {
  const view = { me: 1, n: 4, mode: 'dupla', scores: [3, 5, 3, 5] };
  const rows = T.scoreRows(view, seats(['A', 'B', 'C', 'D']));
  assert.deepEqual(rows.map((r) => [r.label, r.score]), [['Nosotros', 5], ['Ellos', 3]]);
  assert.deepEqual(rows[0].seats, [1, 3]);
  assert.deepEqual(rows[1].seats, [2, 0]);
});

test('el marcador de 3 jugadores es individual', () => {
  const view = { me: 0, n: 3, mode: 'trio', scores: [10, 7, 2] };
  assert.deepEqual(T.scoreRows(view, seats(['A', 'B', 'C'])).map((r) => [r.label, r.score]), [['Vos', 10], ['B', 7], ['C', 2]]);
});

test('el estado dice de quien es el turno', () => {
  const names = seats(['Ana', 'Beto', 'Cami', 'Dani']);
  const mine = viewOf('dupla', 0, { phase: 'play', turn: 0 });
  assert.match(T.statusText(mine, names, null), /Te toca/);
  assert.match(T.statusText(mine, names, card(7, 'oro')), /7 de oro/);
  assert.equal(T.statusText({ ...mine, turn: 2 }, names, null), 'Juega Cami.');
});

test('el estado explica el descarte del modo 3 jugadores', () => {
  const names = seats(['Ana', 'Beto', 'Cami']);
  const view = viewOf('trio', 0, { phase: 'discard', mano: 0 });
  assert.match(T.statusText(view, names, null), /descartar/);
  assert.equal(T.statusText({ ...view, me: 1 }, names, null), 'Ana está eligiendo qué carta descartar.');
});

test('el estado de un canto distingue a quien responde', () => {
  const names = seats(['Ana', 'Beto', 'Cami', 'Dani']);
  const pending = { kind: 'truco', by: 0, level: 2, responders: [1, 3] };
  const base = viewOf('dupla', 1, { phase: 'respond-truco', pending });
  assert.equal(T.statusText(base, names, null), 'Ana cantó Retruco. ¿Qué respondés?');
  assert.equal(T.statusText({ ...base, me: 2 }, names, null), 'Ana cantó Retruco. Responde Beto y Dani.');
  const envido = { kind: 'envido', by: 1, stack: ['envido', 'real'], callers: [1], responders: [0, 2] };
  assert.equal(T.statusText({ ...base, me: 1, phase: 'respond-envido', pending: envido }, names, null), 'Cantaste Envido, Real envido. Responde Ana y Cami.');
});

test('al terminar la mano dice quien gano segun el modo', () => {
  const names = seats(['Ana', 'Beto', 'Cami']);
  const trio = viewOf('trio', 0, { phase: 'hand-over', mano: 0, handResult: { winner: 1, points: 2 } });
  assert.equal(T.statusText(trio, names, null), 'Ganó Beto y Cami la mano: +2');
  assert.equal(T.statusText({ ...trio, handResult: { winner: 0, points: 3 } }, names, null), 'Ganaste la mano: +3');
  const dupla = viewOf('dupla', 0, { phase: 'hand-over', handResult: { winner: 0, points: 1 } });
  assert.equal(T.statusText(dupla, seats(['A', 'B', 'C', 'D']), null), 'Ganamos la mano: +1');
});

test('el final nombra a los ganadores', () => {
  const names = seats(['Ana', 'Beto', 'Cami', 'Dani']);
  const view = viewOf('dupla', 0, { winners: [2, 0] });
  assert.deepEqual(T.endText(view, names), { title: '¡Ganaste la partida!', text: 'Ganó Cami y Vos.' });
  assert.equal(T.endText({ ...view, me: 1, winners: [2, 0] }, names).title, 'Perdiste la partida');
});

test('el historial usa los nombres de la sala', () => {
  const names = seats(['Ana', 'Beto']);
  assert.equal(T.logText({ type: 'play', player: 1, card: card(3, 'basto') }, names, 0), 'Beto juega 3 de basto');
  assert.equal(T.logText({ type: 'trick', trickIndex: 0, winner: 0, winnerSeat: 0 }, names, 0), 'Baza 1: gana Vos');
  assert.equal(T.logText({ type: 'trick', trickIndex: 1, winner: -1, winnerSeat: null }, names, 0), 'Baza 2: parda');
  assert.equal(T.logText({ type: 'envido-call', by: 1, what: 'real' }, names, 0), 'Beto: ¡Real envido!');
});

test('textos de flor: cantos, respuestas y resultados', () => {
  const seats = [{ name: 'Ana' }, { name: 'Beto' }];
  assert.equal(T.eventText({ type: 'flor-call', what: 'resto', by: 0 }), '¡Contraflor al resto!');
  assert.equal(T.eventText({ type: 'flor-response', response: 'reject', by: 1 }), 'Con flor me achico');
  assert.match(T.logText({ type: 'flor-ask', by: 0, roll: 44, enabled: true }, seats, 0), /salió 44, se juega con flor/);
  assert.equal(T.logText({ type: 'flor-result', uncontested: true, awarded: 3 }, seats, 0), 'Flor: +3');
  assert.match(T.logText({ type: 'flor-result', accepted: true, awarded: 6, points: [38, 26] }, seats, 0), /Vos 38, Beto 26\. \+6/);
});
