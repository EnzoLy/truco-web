'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/engine.js');

const c = (num, suit) => ({ num, suit });

// Deterministic state builder: skips the shuffle and sets exact hands.
function rig(hands, { mano = 0, scores = [0, 0] } = {}) {
  let { state } = T.dealHand(T.newGame(() => 0.9));
  state = JSON.parse(JSON.stringify(state));
  state.mano = mano;
  state.scores = scores;
  state.hands = JSON.parse(JSON.stringify(hands));
  state.dealt = JSON.parse(JSON.stringify(hands));
  state.cur = { leader: mano, cards: [null, null] };
  state.playTurn = state.turn = mano;
  return state;
}
const run = (s, p, a) => T.step(s, p, a);

test('rankOf ordena las cartas del truco', () => {
  assert.ok(T.rankOf(c(1, 'espada')) > T.rankOf(c(1, 'basto')));
  assert.ok(T.rankOf(c(1, 'basto')) > T.rankOf(c(7, 'espada')));
  assert.ok(T.rankOf(c(7, 'espada')) > T.rankOf(c(7, 'oro')));
  assert.ok(T.rankOf(c(7, 'oro')) > T.rankOf(c(3, 'copa')));
  assert.equal(T.rankOf(c(3, 'copa')), T.rankOf(c(3, 'oro')));
  assert.ok(T.rankOf(c(2, 'copa')) > T.rankOf(c(1, 'oro')));
  assert.equal(T.rankOf(c(1, 'oro')), T.rankOf(c(1, 'copa')));
  assert.ok(T.rankOf(c(12, 'oro')) > T.rankOf(c(7, 'copa')));
  assert.equal(T.rankOf(c(7, 'copa')), T.rankOf(c(7, 'basto')));
  assert.ok(T.rankOf(c(4, 'oro')) < T.rankOf(c(5, 'oro')));
});

test('el mazo tiene 40 cartas sin 8 ni 9', () => {
  const deck = T.makeDeck();
  assert.equal(deck.length, 40);
  assert.ok(deck.every((x) => x.num !== 8 && x.num !== 9));
});

test('envidoPoints: dos del mismo palo suman 20 + ambas', () => {
  assert.equal(T.envidoPoints([c(7, 'oro'), c(6, 'oro'), c(1, 'copa')]), 33);
  assert.equal(T.envidoPoints([c(12, 'oro'), c(11, 'oro'), c(1, 'copa')]), 20);
  assert.equal(T.envidoPoints([c(7, 'oro'), c(5, 'copa'), c(4, 'basto')]), 7);
  assert.equal(T.envidoPoints([c(12, 'oro'), c(11, 'copa'), c(10, 'basto')]), 0);
  assert.equal(T.envidoPoints([c(7, 'oro'), c(6, 'oro'), c(5, 'oro')]), 33);
});

test('handWinner: parda en la primera la define la segunda', () => {
  assert.equal(T.handWinner([-1, 1], 0), 1);
  assert.equal(T.handWinner([-1, 0], 1), 0);
});
test('handWinner: gana la primera y empata la segunda', () => {
  assert.equal(T.handWinner([0, -1], 1), 0);
});
test('handWinner: 1-1 se define en la tercera', () => {
  assert.equal(T.handWinner([0, 1], 0), null);
  assert.equal(T.handWinner([0, 1, 1], 0), 1);
  assert.equal(T.handWinner([0, 1, -1], 1), 0);
});
test('handWinner: tres pardas gana la mano', () => {
  assert.equal(T.handWinner([-1, -1], 0), null);
  assert.equal(T.handWinner([-1, -1, -1], 1), 1);
});
test('handWinner: dos bazas seguidas ganan', () => {
  assert.equal(T.handWinner([1, 1], 0), 1);
});

test('envidoStakes: aceptado suma, rechazado resta el ultimo, minimo 1', () => {
  assert.deepEqual(T.envidoStakes(['envido'], [0, 0]), { accepted: 2, rejected: 1 });
  assert.deepEqual(T.envidoStakes(['envido', 'envido'], [0, 0]), { accepted: 4, rejected: 2 });
  assert.deepEqual(T.envidoStakes(['envido', 'real'], [0, 0]), { accepted: 5, rejected: 2 });
  assert.deepEqual(T.envidoStakes(['real'], [0, 0]), { accepted: 3, rejected: 1 });
  assert.deepEqual(T.envidoStakes(['envido', 'real', 'falta'], [10, 4]), { accepted: 20, rejected: 5 });
  assert.deepEqual(T.envidoStakes(['falta'], [12, 20]), { accepted: 10, rejected: 1 });
});

test('envidoRaiseOptions respeta la cadena', () => {
  assert.deepEqual(T.envidoRaiseOptions(['envido']), ['envido', 'real', 'falta']);
  assert.deepEqual(T.envidoRaiseOptions(['envido', 'envido']), ['real', 'falta']);
  assert.deepEqual(T.envidoRaiseOptions(['real']), ['falta']);
  assert.deepEqual(T.envidoRaiseOptions(['falta']), []);
});

test('tras aceptar el truco, el turno vuelve a quien debia jugar', () => {
  let s = rig([[c(1, 'espada'), c(2, 'oro'), c(4, 'copa')], [c(5, 'oro'), c(6, 'copa'), c(4, 'basto')]]);
  s = run(s, 0, { type: 'truco' }).state;
  assert.equal(s.phase, 'respond-truco');
  assert.equal(s.turn, 1);
  s = run(s, 1, { type: 'accept' }).state;
  assert.equal(s.phase, 'play');
  assert.equal(s.turn, 0);
  assert.equal(s.trucoLevel, 1);
  assert.equal(s.trucoRight, 1);
});

test('solo quien acepto puede subir el truco', () => {
  let s = rig([[c(1, 'espada'), c(2, 'oro'), c(4, 'copa')], [c(5, 'oro'), c(6, 'copa'), c(4, 'basto')]]);
  s = run(s, 0, { type: 'truco' }).state;
  s = run(s, 1, { type: 'accept' }).state;
  assert.ok(!T.legalActions(s, 0).some((a) => a.type === 'truco'));
  s = run(s, 0, { type: 'play', index: 0 }).state;
  assert.ok(T.legalActions(s, 1).some((a) => a.type === 'truco'));
});

test('no quiero al truco da 1 punto; al retruco da 2; al vale cuatro da 3', () => {
  let s = rig([[c(1, 'espada'), c(2, 'oro'), c(4, 'copa')], [c(5, 'oro'), c(6, 'copa'), c(4, 'basto')]]);
  let r = run(s, 0, { type: 'truco' });
  r = run(r.state, 1, { type: 'reject' });
  assert.equal(r.state.scores[0], 1);
  assert.equal(r.state.phase, 'hand-over');

  s = run(run(s, 0, { type: 'truco' }).state, 1, { type: 'truco' }).state; // retruco
  assert.equal(s.pending.level, 2);
  assert.equal(s.trucoLevel, 1);
  r = run(s, 0, { type: 'reject' });
  assert.equal(r.state.scores[1], 2);
});

test('envido primero: al resolverse vuelve el mismo truco al mismo que responde', () => {
  let s = rig([[c(7, 'oro'), c(6, 'oro'), c(1, 'copa')], [c(5, 'oro'), c(6, 'copa'), c(4, 'basto')]]);
  s = run(s, 0, { type: 'truco' }).state;
  s = run(s, 1, { type: 'envido', what: 'envido' }).state;
  assert.equal(s.phase, 'respond-envido');
  assert.equal(s.turn, 0);
  s = run(s, 0, { type: 'accept' }).state;
  assert.equal(s.scores[0], 2);
  assert.equal(s.phase, 'respond-truco');
  assert.equal(s.turn, 1);
  assert.equal(s.pending.kind, 'truco');
  assert.equal(s.pending.by, 0);
});

test('envido no se puede cantar tras el truco aceptado ni en la segunda baza', () => {
  let s = rig([[c(7, 'oro'), c(6, 'oro'), c(1, 'copa')], [c(5, 'oro'), c(6, 'copa'), c(4, 'basto')]]);
  assert.ok(T.legalActions(s, 0).some((a) => a.type === 'envido'));
  s = run(run(s, 0, { type: 'truco' }).state, 1, { type: 'accept' }).state;
  assert.ok(!T.legalActions(s, 0).some((a) => a.type === 'envido'));

  let t = rig([[c(7, 'oro'), c(6, 'oro'), c(1, 'copa')], [c(5, 'oro'), c(6, 'copa'), c(4, 'basto')]]);
  t = run(t, 0, { type: 'play', index: 0 }).state;
  t = run(t, 1, { type: 'play', index: 0 }).state;
  assert.ok(!T.legalActions(t, 0).some((a) => a.type === 'envido'));
});

test('envido primero solo responde al primer truco, no a un retruco', () => {
  let s = rig([[c(7, 'oro'), c(6, 'oro'), c(1, 'copa')], [c(5, 'oro'), c(6, 'copa'), c(4, 'basto')]]);
  s = run(s, 0, { type: 'truco' }).state;
  assert.ok(T.legalActions(s, 1).some((a) => a.type === 'envido'));
  s = run(s, 1, { type: 'accept' }).state;
  s = run(s, 0, { type: 'play', index: 0 }).state;
  s = run(s, 1, { type: 'truco' }).state; // retruco del que tiene el derecho, en la primera baza
  assert.equal(s.phase, 'respond-truco');
  assert.ok(!T.legalActions(s, 0).some((a) => a.type === 'envido'));
  // subir directo en la cadena tampoco habilita envido
  const raised = run(s, 0, { type: 'truco' }).state;
  assert.ok(!T.legalActions(raised, 1).some((a) => a.type === 'envido'));
});

test('envido rechazado da puntos al que canto y vuelve a jugar', () => {
  let s = rig([[c(7, 'oro'), c(6, 'oro'), c(1, 'copa')], [c(5, 'oro'), c(6, 'copa'), c(4, 'basto')]]);
  s = run(s, 0, { type: 'envido', what: 'envido' }).state;
  s = run(s, 1, { type: 'reject' }).state;
  assert.equal(s.scores[0], 1);
  assert.equal(s.phase, 'play');
  assert.equal(s.turn, 0);
  assert.ok(s.envido.done);
});

test('el mano gana el empate de envido', () => {
  let s = rig([[c(7, 'oro'), c(1, 'copa'), c(2, 'basto')], [c(7, 'copa'), c(1, 'oro'), c(2, 'espada')]], { mano: 1 });
  s = run(s, 1, { type: 'envido', what: 'envido' }).state;
  s = run(s, 0, { type: 'accept' }).state;
  assert.equal(s.scores[1], 2);
  assert.equal(s.scores[0], 0);
});

test('envido que llega a 30 termina la partida en el momento', () => {
  let s = rig([[c(7, 'oro'), c(6, 'oro'), c(1, 'copa')], [c(5, 'oro'), c(6, 'copa'), c(4, 'basto')]], { scores: [28, 0] });
  s = run(s, 0, { type: 'envido', what: 'envido' }).state;
  const r = run(s, 1, { type: 'accept' });
  assert.equal(r.state.phase, 'game-over');
  assert.equal(r.state.winner, 0);
  assert.ok(r.events.some((e) => e.type === 'game-end'));
});

test('falta envido aceptada vale lo que le falta al que va ganando', () => {
  let s = rig([[c(7, 'oro'), c(6, 'oro'), c(1, 'copa')], [c(5, 'oro'), c(6, 'copa'), c(4, 'basto')]], { scores: [10, 20] });
  s = run(s, 0, { type: 'envido', what: 'falta' }).state;
  const r = run(s, 1, { type: 'accept' });
  assert.equal(r.state.scores[0], 20);
});

test('jugar tres bazas: gana la mano quien gana dos', () => {
  let s = rig([[c(1, 'espada'), c(1, 'basto'), c(4, 'copa')], [c(5, 'oro'), c(6, 'copa'), c(4, 'basto')]]);
  s = run(s, 0, { type: 'play', index: 0 }).state;
  s = run(s, 1, { type: 'play', index: 0 }).state;
  assert.equal(s.turn, 0);
  s = run(s, 0, { type: 'play', index: 0 }).state;
  const r = run(s, 1, { type: 'play', index: 0 });
  assert.equal(r.state.phase, 'hand-over');
  assert.equal(r.state.scores[0], 1);
  assert.ok(r.events.some((e) => e.type === 'hand-end' && e.reason === 'tricks'));
});

test('irse al mazo regala el valor del truco vigente', () => {
  let s = rig([[c(1, 'espada'), c(1, 'basto'), c(4, 'copa')], [c(5, 'oro'), c(6, 'copa'), c(4, 'basto')]]);
  s = run(run(s, 0, { type: 'truco' }).state, 1, { type: 'accept' }).state;
  const r = run(s, 0, { type: 'play', index: 2 });
  const m = run(r.state, 1, { type: 'mazo' });
  assert.equal(m.state.scores[0], 2);
});

test('las acciones ilegales lanzan error', () => {
  const s = rig([[c(1, 'espada'), c(1, 'basto'), c(4, 'copa')], [c(5, 'oro'), c(6, 'copa'), c(4, 'basto')]]);
  assert.throws(() => run(s, 1, { type: 'play', index: 0 }));
  assert.throws(() => run(s, 0, { type: 'accept' }));
  assert.throws(() => run(s, 0, { type: 'play', index: 5 }));
});

test('el mano alterna entre manos', () => {
  const g = T.newGame(() => 0.1);
  const a = T.dealHand(g).state;
  let b = JSON.parse(JSON.stringify(a));
  b.phase = 'hand-over';
  const n = T.dealHand(b).state;
  assert.notEqual(n.mano, a.mano);
});

test('viewFor no filtra la mano del rival y expone solo lo publico', () => {
  const s = rig([[c(1, 'espada'), c(1, 'basto'), c(4, 'copa')], [c(5, 'oro'), c(6, 'copa'), c(4, 'basto')]]);
  const v = T.viewFor(s, 0);
  assert.equal(v.hand.length, 3);
  assert.equal(v.myEnvido, T.envidoPoints(s.dealt[0]));
  assert.equal(v.oppEnvido, null);
  assert.ok(!('hands' in v));
  assert.deepEqual(v.dealt, s.dealt[0]);
  const oppCards = s.dealt[1].map((x) => `${x.num}${x.suit}`);
  const seen = JSON.stringify(v);
  assert.ok(oppCards.every((k) => !seen.includes(`"num":${parseInt(k, 10)},"suit":"${k.replace(/\d+/, '')}"`)));
  assert.deepEqual(v.oppPlayed, []);
});

test('simulacion: miles de partidas con jugadores aleatorios terminan sin errores', () => {
  let seed = 12345;
  const rng = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  for (let g = 0; g < 300; g++) {
    let { state } = T.dealHand(T.newGame(rng), rng);
    let guard = 0;
    while (state.phase !== 'game-over') {
      if (++guard > 5000) throw new Error('la partida no termina');
      if (state.phase === 'hand-over') { state = T.dealHand(state, rng).state; continue; }
      const p = state.turn;
      const legal = T.legalActions(state, p);
      assert.ok(legal.length > 0, 'sin acciones legales');
      const plays = legal.filter((a) => a.type === 'play');
      // sesgo a jugar cartas para que las partidas avancen
      const pick = plays.length && rng() < 0.7 ? plays[Math.floor(rng() * plays.length)] : legal[Math.floor(rng() * legal.length)];
      state = T.step(state, p, pick).state;
    }
    assert.ok(state.scores[state.winner] >= 30);
  }
});

test('el que ya tiro su carta no puede contestar el truco con envido primero', () => {
  let s = rig([[c(7, 'oro'), c(6, 'oro'), c(1, 'copa')], [c(5, 'oro'), c(6, 'copa'), c(4, 'basto')]]);
  s = run(s, 0, { type: 'play', index: 0 }).state;
  s = run(s, 1, { type: 'truco' }).state;
  assert.equal(s.phase, 'respond-truco');
  assert.equal(s.turn, 0);
  assert.ok(!T.legalActions(s, 0).some((a) => a.type === 'envido'));
  assert.throws(() => run(s, 0, { type: 'envido', what: 'envido' }), /ilegal/);
});
