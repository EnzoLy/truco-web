'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Room = require('../js/room-engine.js');
const Bot = require('../js/room-bot.js');

const card = (suit, num) => ({ suit, num });
const FLOR_HIGH = [card('oro', 7), card('oro', 6), card('oro', 5)]; // 20 + 7 + 6 + 5 = 38
const FLOR_LOW = [card('copa', 1), card('copa', 2), card('copa', 3)]; // 26
const PLAIN = [card('espada', 4), card('basto', 5), card('copa', 6)];

/** Mano nueva en la que el mazo ya dijo que se juega con flor y las manos se eligen a mano. */
function setup(mode, hands, { enabled = true, mano = 0 } = {}) {
  const base = Room.dealHand({ ...Room.newGame(mode, () => 0), mano }, () => 0).state;
  const s = structuredClone(base);
  s.flor = { asked: true, enabled, roll: enabled ? 2 : 1, by: 0 };
  s.hands = hands.map((h) => structuredClone(h));
  s.dealt = structuredClone(s.hands);
  return s;
}
const types = (s, seat) => Room.legalActions(s, seat).map((a) => `${a.type}${a.what ? ':' + a.what : ''}`);

test('consultar al mazo: numero par activa la flor, impar la desactiva, y solo una vez por partida', () => {
  const impar = Room.step(setupFresh(), 0, { type: 'ask-flor' }, () => 0.5); // 1 + 50 = 51 impar
  assert.equal(impar.state.flor.enabled, false);
  assert.equal(impar.events[0].type, 'flor-ask');
  const par = Room.step(setupFresh(), 0, { type: 'ask-flor' }, () => 0.49); // 1 + 49 = 50 par
  assert.equal(par.state.flor.enabled, true);
  assert.equal(par.state.flor.roll, 50);
  assert.ok(!types(par.state, 0).includes('ask-flor'), 'no se puede volver a preguntar');
});

function setupFresh() {
  return Room.dealHand({ ...Room.newGame('duel', () => 0), mano: 0 }, () => 0).state;
}

test('la consulta solo esta disponible al empezar la mano', () => {
  const s = setupFresh();
  assert.ok(types(s, 0).includes('ask-flor'));
  assert.ok(!types(s, 1).includes('ask-flor'), 'solo en tu turno');
  const first = Room.step(s, 0, { type: 'play', index: 0 }).state;
  assert.ok(types(first, 1).includes('ask-flor'), 'el rival todavia no tiro su carta');
  const second = Room.step(first, 1, { type: 'play', index: 0 }).state;
  assert.ok(!types(second, 0).includes('ask-flor'), 'ya se cerro la primera baza');
});

test('sin flor activada no se puede cantar flor', () => {
  const s = setup('duel', [FLOR_HIGH, PLAIN], { enabled: false });
  assert.ok(!types(s, 0).includes('flor:flor'));
});

test('flor sin oposicion: 3 puntos y anula el envido', () => {
  const s = setup('duel', [FLOR_HIGH, PLAIN]);
  assert.ok(types(s, 0).includes('flor:flor'));
  assert.ok(!types(s, 0).some((t) => t.startsWith('envido')), 'quien tiene flor no canta envido');
  const { state, events } = Room.step(s, 0, { type: 'flor', what: 'flor' });
  assert.deepEqual(state.scores, [3, 0]);
  assert.equal(state.phase, 'play');
  assert.equal(state.envido.done, true);
  assert.ok(events.some((e) => e.type === 'flor-result' && e.uncontested));
  assert.ok(!types(state, 0).includes('flor:flor'), 'una flor por mano');
});

test('con flor me achico: el que canto se lleva 3', () => {
  const s = setup('duel', [FLOR_HIGH, FLOR_LOW]);
  const called = Room.step(s, 0, { type: 'flor', what: 'flor' }).state;
  assert.equal(called.phase, 'respond-flor');
  assert.deepEqual(types(called, 1).sort(), ['accept', 'flor:contraflor', 'flor:resto', 'reject']);
  const { state } = Room.step(called, 1, { type: 'reject' });
  assert.deepEqual(state.scores, [3, 0]);
  assert.equal(state.phase, 'play');
});

test('con flor quiero: gana la flor mas alta y se lleva 6', () => {
  const s = setup('duel', [FLOR_LOW, FLOR_HIGH]);
  const called = Room.step(s, 0, { type: 'flor', what: 'flor' }).state;
  const { state, events } = Room.step(called, 1, { type: 'accept' });
  assert.deepEqual(state.scores, [0, 6]);
  const result = events.find((e) => e.type === 'flor-result');
  assert.deepEqual(result.points, [26, 38]);
});

test('empate de flor lo gana el mano', () => {
  const s = setup('duel', [FLOR_HIGH, FLOR_HIGH.map((c) => ({ ...c, suit: 'espada' }))], { mano: 1 });
  s.turn = s.playTurn = 1; s.cur.leader = 1;
  const called = Room.step(s, 1, { type: 'flor', what: 'flor' }).state;
  const { state } = Room.step(called, 0, { type: 'accept' });
  assert.deepEqual(state.scores, [0, 6]);
});

test('contraflor: aceptada vale 8, rechazada deja 6 al que la canto', () => {
  const s = setup('duel', [FLOR_LOW, FLOR_HIGH]);
  const called = Room.step(s, 0, { type: 'flor', what: 'flor' }).state;
  const raised = Room.step(called, 1, { type: 'flor', what: 'contraflor' }).state;
  assert.equal(raised.phase, 'respond-flor');
  assert.deepEqual(types(raised, 0).sort(), ['accept', 'flor:resto', 'reject']);
  assert.deepEqual(Room.step(raised, 0, { type: 'accept' }).state.scores, [0, 8]);
  assert.deepEqual(Room.step(raised, 0, { type: 'reject' }).state.scores, [0, 6]);
});

test('contraflor al resto: aceptada da lo que falta para ganar', () => {
  const s = setup('duel', [FLOR_LOW, FLOR_HIGH]);
  s.scores = [10, 15];
  const called = Room.step(s, 0, { type: 'flor', what: 'flor' }).state;
  const resto = Room.step(called, 1, { type: 'flor', what: 'resto' }).state;
  assert.deepEqual(types(resto, 0).sort(), ['accept', 'reject']);
  const { state } = Room.step(resto, 0, { type: 'accept' });
  assert.equal(state.phase, 'game-over');
  assert.deepEqual(state.winners, [1]);
  assert.equal(state.scores[1], 15 + (30 - 15));
});

test('el rival con flor puede cantarla en vez de responder un envido', () => {
  const s = setup('duel', [PLAIN, FLOR_HIGH]);
  const asked = Room.step(s, 0, { type: 'envido', what: 'envido' }).state;
  assert.ok(types(asked, 1).includes('flor:flor'));
  const { state, events } = Room.step(asked, 1, { type: 'flor', what: 'flor' });
  assert.deepEqual(state.scores, [0, 3]);
  assert.equal(state.envido.done, true);
  assert.ok(events.some((e) => e.type === 'envido-response' && e.response === 'flor'));
  assert.equal(state.phase, 'play');
  assert.equal(state.turn, 0);
});

test('la flor interrumpe un truco sin perderlo', () => {
  const s = setup('duel', [PLAIN, FLOR_HIGH]);
  const truco = Room.step(s, 0, { type: 'truco' }).state;
  assert.ok(types(truco, 1).includes('flor:flor'));
  const afterFlor = Room.step(truco, 1, { type: 'flor', what: 'flor' }).state;
  assert.equal(afterFlor.phase, 'respond-truco');
  assert.equal(afterFlor.pending.kind, 'truco');
  assert.deepEqual(afterFlor.scores, [0, 3]);
});

test('en dupla la flor del companero cuenta como flor del equipo', () => {
  const s = setup('dupla', [PLAIN, PLAIN, PLAIN, FLOR_HIGH]);
  const called = Room.step(s, 0, { type: 'truco' }).state;
  assert.ok(types(called, 3).includes('flor:flor'));
  assert.ok(!types(called, 1).includes('flor:flor'));
});

test('despues de la primera carta ya no se puede cantar flor', () => {
  const s = setup('duel', [PLAIN, FLOR_HIGH]);
  const played = Room.step(s, 0, { type: 'play', index: 0 }).state;
  assert.ok(types(played, 1).includes('flor:flor'), 'todavia no tiro la suya');
  const second = Room.step(played, 1, { type: 'play', index: 0 }).state;
  assert.ok(!types(second, 0).includes('flor:flor'));
});

test('la vista muestra la flor propia y nunca la ajena', () => {
  const s = setup('duel', [FLOR_HIGH, FLOR_LOW]);
  assert.equal(Room.viewFor(s, 0).myFlor, 38);
  assert.equal(Room.viewFor(s, 1).myFlor, 26);
  assert.equal(Room.viewFor(setup('duel', [FLOR_HIGH, FLOR_LOW], { enabled: false }), 0).myFlor, null);
  assert.ok(!JSON.stringify(Room.viewFor(s, 0)).includes('"dealt"'));
});

test('los bots resuelven la flor y terminan partidas completas', () => {
  for (const mode of ['duel', 'trio', 'dupla']) {
    for (let g = 0; g < 25; g++) {
      let s = Room.newGame(mode);
      s.flor = { asked: true, enabled: true, roll: 2, by: 0 };
      s = Room.dealHand(s).state;
      let steps = 0;
      while (s.phase !== 'game-over' && steps++ < 4000) {
        if (s.phase === 'hand-over') { s = Room.dealHand(s).state; continue; }
        const seat = Array.from({ length: s.n }, (_, i) => i).find((i) => Room.legalActions(s, i).length);
        s = Room.step(s, seat, Bot.decide(Room.viewFor(s, seat, { team: true }))).state;
      }
      assert.equal(s.phase, 'game-over', `${mode} termina`);
    }
  }
});
