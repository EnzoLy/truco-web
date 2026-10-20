'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Room = require('../js/room-engine.js');
const Bot = require('../js/room-bot.js');

const seeded = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const card = (num, suit) => ({ num, suit });

function started(mode, rng = seeded(7)) {
  return Room.dealHand(Room.newGame(mode, rng), rng).state;
}

/** Fija las manos y el orden de juego para escenarios exactos. */
function setup(mode, hands, mano = 0) {
  const s = structuredClone(started(mode));
  s.hands = structuredClone(hands);
  s.dealt = structuredClone(hands);
  s.mano = mano;
  s.teams = Room.teamsFor(mode, mano);
  s.turn = mano;
  s.playTurn = mano;
  s.phase = 'play';
  s.cur = { leader: mano, cards: Array(s.n).fill(null) };
  return s;
}

test('reparte 3 cartas por asiento en duelo y dupla, sin repetir', () => {
  for (const [mode, n] of [['duel', 2], ['dupla', 4]]) {
    const s = started(mode);
    assert.equal(s.hands.length, n);
    assert.ok(s.hands.every((h) => h.length === 3), mode);
    assert.equal(s.phase, 'play');
    const all = s.hands.flat().map((c) => `${c.num}${c.suit}`);
    assert.equal(new Set(all).size, all.length);
  }
});

test('trio: el mano recibe 4 cartas y debe descartar antes de jugar', () => {
  const s = started('trio');
  assert.equal(s.phase, 'discard');
  assert.equal(s.hands[s.mano].length, 4);
  s.hands.forEach((h, seat) => { if (seat !== s.mano) assert.equal(h.length, 3); });
  assert.deepEqual(Room.legalActions(s, (s.mano + 1) % 3), []);
  assert.equal(Room.legalActions(s, s.mano).length, 4);
  const kept = s.hands[s.mano].filter((_, i) => i !== 2);
  const { state, events } = Room.step(s, s.mano, { type: 'discard', index: 2 });
  assert.deepEqual(state.hands[s.mano], kept);
  assert.equal(state.phase, 'play');
  assert.equal(state.turn, s.mano);
  assert.deepEqual(events, [{ type: 'discard', player: s.mano }]);
});

test('trio: el mano es un equipo y los otros dos el otro', () => {
  const s = started('trio');
  assert.equal(s.teams[s.mano], 0);
  s.teams.forEach((t, seat) => { if (seat !== s.mano) assert.equal(t, 1); });
});

test('trio: el descarte no se filtra a los demas y no cuenta para el envido', () => {
  const s = started('trio');
  const dropped = s.hands[s.mano][0];
  const { state } = Room.step(s, s.mano, { type: 'discard', index: 0 });
  const other = (s.mano + 1) % 3;
  const view = Room.viewFor(state, other);
  assert.equal(JSON.stringify(view).includes(JSON.stringify(dropped)), false);
  assert.equal(Room.viewFor(s, s.mano).myEnvido, null);
});

test('la mano rota entre asientos', () => {
  const rng = seeded(3);
  let s = Room.dealHand(Room.newGame('dupla', rng), rng).state;
  const first = s.mano;
  s = Room.dealHand(s, rng).state;
  assert.equal(s.mano, (first + 1) % 4);
});

test('dupla: el orden de juego da la vuelta por los 4 asientos', () => {
  let s = setup('dupla', [[card(4, 'oro')], [card(5, 'oro')], [card(6, 'oro')], [card(7, 'copa')]]);
  for (const seat of [0, 1, 2]) {
    assert.equal(s.turn, seat);
    s = Room.step(s, seat, { type: 'play', index: 0 }).state;
  }
  assert.equal(s.turn, 3);
});

test('dupla: gana la baza el equipo de la carta mas alta', () => {
  let s = setup('dupla', [
    [card(4, 'oro'), card(4, 'copa'), card(4, 'basto')], [card(3, 'oro'), card(5, 'copa'), card(5, 'basto')],
    [card(12, 'oro'), card(6, 'copa'), card(6, 'basto')], [card(2, 'oro'), card(7, 'copa'), card(7, 'basto')],
  ]);
  let events;
  for (const seat of [0, 1, 2, 3]) ({ state: s, events } = Room.step(s, seat, { type: 'play', index: 0 }));
  const trick = events.find((e) => e.type === 'trick');
  assert.equal(trick.winner, 1);
  assert.equal(trick.winnerSeat, 1);
  assert.equal(s.turn, 1);
});

test('un empate de la carta mas alta entre companeros no es parda', () => {
  let s = setup('dupla', [[card(3, 'oro')], [card(4, 'oro')], [card(3, 'copa')], [card(5, 'oro')]]);
  let events;
  for (const seat of [0, 1, 2, 3]) ({ state: s, events } = Room.step(s, seat, { type: 'play', index: 0 }));
  const trick = events.find((e) => e.type === 'trick');
  assert.equal(trick.winner, 0);
  assert.equal(trick.winnerSeat, 0);
});

test('un empate entre equipos rivales es parda y abre el mano', () => {
  let s = setup('duel', [[card(3, 'oro'), card(4, 'oro')], [card(3, 'copa'), card(5, 'oro')]], 1);
  s = Room.step(s, 1, { type: 'play', index: 0 }).state;
  const { state, events } = Room.step(s, 0, { type: 'play', index: 0 });
  assert.equal(events.find((e) => e.type === 'trick').winner, -1);
  assert.equal(state.turn, 1);
});

test('dupla: el truco lo responde cualquiera de los dos rivales y los puntos van a los dos companeros', () => {
  const s = started('dupla');
  const caller = s.turn;
  const { state } = Room.step(s, caller, { type: 'truco' });
  const responders = state.pending.responders;
  assert.equal(responders.length, 2);
  assert.ok(responders.every((r) => s.teams[r] !== s.teams[caller]));
  for (const seat of [0, 1, 2, 3]) {
    assert.equal(Room.legalActions(state, seat).length > 0, responders.includes(seat), `asiento ${seat}`);
  }
  const rejected = Room.step(state, responders[1], { type: 'reject' }).state;
  const partner = (caller + 2) % 4;
  assert.equal(rejected.scores[caller], 1);
  assert.equal(rejected.scores[partner], 1);
  assert.equal(rejected.phase, 'hand-over');
});

test('quien acepta el truco da el derecho de subir a su equipo', () => {
  const s = started('dupla');
  const caller = s.turn;
  let { state } = Room.step(s, caller, { type: 'truco' });
  const responder = state.pending.responders[0];
  state = Room.step(state, responder, { type: 'accept' }).state;
  assert.equal(state.trucoLevel, 1);
  assert.equal(state.trucoRight, s.teams[responder]);
  assert.equal(Room.canCallTruco(state, caller), false);
});

test('envido en dupla: gana el equipo con el mejor puntaje de sus miembros', () => {
  let s = setup('dupla', [
    [card(1, 'oro'), card(2, 'copa'), card(3, 'basto')], // asiento 0: 3 (equipo A)
    [card(7, 'oro'), card(6, 'oro'), card(4, 'copa')], // asiento 1: 33 (equipo B)
    [card(5, 'espada'), card(6, 'espada'), card(1, 'copa')], // asiento 2: 31 (equipo A)
    [card(4, 'oro'), card(5, 'copa'), card(1, 'basto')], // asiento 3: 5 (equipo B)
  ]);
  s = Room.step(s, 0, { type: 'envido', what: 'envido' }).state;
  const { state, events } = Room.step(s, 1, { type: 'accept' });
  const result = events.find((e) => e.type === 'envido-result');
  assert.deepEqual(result.teamPoints, [31, 33]);
  assert.equal(result.winner, 1);
  assert.equal(state.scores[1], 2);
  assert.equal(state.scores[3], 2);
  assert.equal(state.scores[0], 0);
  assert.equal(state.phase, 'play');
});

test('envido empatado lo gana el equipo del mano', () => {
  let s = setup('duel', [[card(7, 'oro'), card(6, 'oro'), card(4, 'copa')], [card(7, 'copa'), card(6, 'copa'), card(4, 'oro')]], 1);
  s = Room.step(s, 1, { type: 'envido', what: 'envido' }).state;
  const { events } = Room.step(s, 0, { type: 'accept' });
  assert.equal(events.find((e) => e.type === 'envido-result').winner, 1);
});

test('envido primero cuando cantan truco y luego se retoma el truco', () => {
  const s = started('duel');
  const a = s.turn;
  let { state } = Room.step(s, a, { type: 'truco' });
  const b = state.pending.responders[0];
  state = Room.step(state, b, { type: 'envido', what: 'envido' }).state;
  assert.equal(state.phase, 'respond-envido');
  state = Room.step(state, a, { type: 'reject' }).state;
  assert.equal(state.phase, 'respond-truco');
  assert.equal(state.pending.kind, 'truco');
  assert.equal(state.turn, b);
});

test('trio: los dos rivales del mano suman los puntos cuando ganan', () => {
  let s = started('trio');
  s = Room.step(s, s.mano, { type: 'discard', index: 0 }).state;
  const mano = s.mano;
  const { state } = Room.step(s, mano, { type: 'mazo' });
  const others = [0, 1, 2].filter((x) => x !== mano);
  assert.equal(state.scores[mano], 0);
  assert.deepEqual(others.map((x) => state.scores[x]), [1, 1]);
});

test('trio: la falta envido usa el mayor puntaje de la mesa', () => {
  let s = started('trio');
  s = Room.step(s, s.mano, { type: 'discard', index: 0 }).state;
  s.scores = [10, 4, 7];
  s = Room.step(s, s.mano, { type: 'envido', what: 'falta' }).state;
  const { events } = Room.step(s, s.pending.responders[0], { type: 'accept' });
  assert.equal(events.find((e) => e.type === 'envido-result').awarded, 20);
});

test('se gana al llegar a 30 y la partida termina', () => {
  let s = started('dupla');
  const caller = s.turn;
  s.scores = s.teams.map((t) => (t === s.teams[caller] ? 29 : 0));
  s = Room.step(s, caller, { type: 'truco' }).state;
  const { state, events } = Room.step(s, s.pending.responders[0], { type: 'reject' });
  assert.equal(state.phase, 'game-over');
  assert.deepEqual([...state.winners].sort(), [caller, (caller + 2) % 4].sort());
  assert.ok(events.some((e) => e.type === 'game-end'));
});

test('rechaza acciones ilegales', () => {
  const s = started('dupla');
  const other = (s.turn + 1) % 4;
  assert.throws(() => Room.step(s, other, { type: 'play', index: 0 }), /ilegal/);
  assert.throws(() => Room.step(s, s.turn, { type: 'play', index: 9 }), /ilegal/);
  assert.throws(() => Room.step(s, s.turn, { type: 'accept' }), /ilegal/);
  assert.throws(() => Room.step(s, s.turn, { type: 'discard', index: 0 }), /ilegal/);
});

test('la vista oculta las cartas de los demas', () => {
  const s = started('dupla');
  const view = Room.viewFor(s, 1);
  assert.deepEqual(view.hand, s.hands[1]);
  assert.deepEqual(view.handCounts, [3, 3, 3, 3]);
  const json = JSON.stringify(view);
  for (const seat of [0, 2, 3]) {
    for (const c of s.hands[seat]) {
      const clash = s.hands[1].some((m) => m.num === c.num && m.suit === c.suit);
      if (!clash) assert.equal(json.includes(JSON.stringify(c)), false, `asiento ${seat}`);
    }
  }
});

for (const mode of ['duel', 'trio', 'dupla']) {
  test(`partidas completas con bots en ${mode}: siempre terminan con acciones legales`, () => {
    for (let game = 0; game < 25; game++) {
      const rng = seeded(100 + game);
      let s = Room.newGame(mode, rng);
      let guard = 0;
      while (s.phase !== 'game-over') {
        if (++guard > 5000) assert.fail('la partida no termina');
        if (s.phase === 'idle' || s.phase === 'hand-over') { s = Room.dealHand(s, rng).state; continue; }
        const seats = Array.from({ length: s.n }, (_, i) => i).filter((i) => Room.legalActions(s, i).length);
        assert.ok(seats.length > 0, `nadie puede actuar en ${s.phase}`);
        const seat = seats[0];
        s = Room.step(s, seat, Bot.decide(Room.viewFor(s, seat), rng)).state;
      }
      assert.ok(s.winners.length >= 1);
      assert.ok(Math.max(...s.scores) >= 30);
    }
  });
}

test('la vista normal no trae cartas de companeros; la de bots si', () => {
  const s = started('dupla');
  assert.deepEqual(Room.viewFor(s, 0).partners, []);
  const view = Room.viewFor(s, 0, { team: true });
  assert.equal(view.partners.length, 1);
  assert.equal(view.partners[0].seat, 2);
  assert.deepEqual(view.partners[0].hand, s.hands[2]);
  const duel = Room.viewFor(started('duel'), 0, { team: true });
  assert.deepEqual(duel.partners, []);
});

test('un bot con cartas flojas acepta el truco si su companero tiene buenas', () => {
  const weak = [card(4, 'oro'), card(5, 'copa'), card(6, 'basto')];
  const strong = [card(1, 'espada'), card(1, 'basto'), card(7, 'espada')];
  const make = (partnerHand) => {
    let s = setup('dupla', [weak, [card(4, 'copa'), card(5, 'oro'), card(6, 'copa')], partnerHand, [card(4, 'basto'), card(5, 'basto'), card(6, 'oro')]], 1);
    s = Room.step(s, 1, { type: 'truco' }).state;
    return Room.viewFor(s, 0, { team: true });
  };
  const never = () => 0.99; // sin faroles ni subas al azar
  assert.equal(Bot.decide(make(weak), never).type, 'reject');
  assert.notEqual(Bot.decide(make(strong), never).type, 'reject');
});

test('el bot acepta el envido si el que tiene buen envido es su companero', () => {
  const none = [card(1, 'oro'), card(4, 'copa'), card(6, 'basto')];
  const good = [card(7, 'oro'), card(6, 'oro'), card(4, 'espada')];
  let s = setup('dupla', [none, [card(4, 'oro'), card(5, 'copa'), card(1, 'basto')], good, [card(5, 'basto'), card(6, 'espada'), card(4, 'basto')]], 1);
  s = Room.step(s, 1, { type: 'envido', what: 'envido' }).state;
  const view = Room.viewFor(s, 0, { team: true });
  assert.equal(Bot.teamEnvido(view), 33);
  assert.equal(Bot.decide(view, () => 0.99).type, 'accept');
  assert.equal(Bot.decide({ ...view, partners: [] }, () => 0.99).type, 'reject');
});

test('los bots ya no rechazan casi todos los trucos', () => {
  let accepted = 0;
  let total = 0;
  for (let game = 0; game < 300; game++) {
    const rng = seeded(500 + game);
    let s = Room.dealHand(Room.newGame('dupla', rng), rng).state;
    const caller = s.turn;
    s = Room.step(s, caller, { type: 'truco' }).state;
    const responder = s.pending.responders[0];
    const action = Bot.decide(Room.viewFor(s, responder, { team: true }), rng);
    total += 1;
    if (action.type !== 'reject') accepted += 1;
  }
  assert.ok(accepted / total > 0.45, `solo aceptan ${(100 * accepted) / total}%`);
  assert.ok(accepted / total < 0.9, 'tampoco aceptan siempre');
});

test('el que ya tiro su carta no puede contestar el truco con envido primero', () => {
  const hands = [
    [card(7, 'oro'), card(6, 'oro'), card(1, 'copa')],
    [card(5, 'oro'), card(6, 'copa'), card(4, 'basto')],
    [card(3, 'espada'), card(2, 'basto'), card(12, 'copa')],
    [card(11, 'oro'), card(10, 'basto'), card(4, 'copa')],
  ];
  let s = setup('dupla', hands, 0);
  s = Room.step(s, 0, { type: 'play', index: 0 }).state;
  s = Room.step(s, 1, { type: 'truco' }).state;
  assert.equal(s.phase, 'respond-truco');
  assert.ok(s.pending.responders.includes(0));
  const seat0 = { ...s, turn: 0 };
  assert.ok(!Room.legalActions(seat0, 0).some((a) => a.type === 'envido'));
  // el compañero que todavía no tiró sí puede
  const seat2 = { ...s, turn: 2 };
  assert.ok(Room.legalActions(seat2, 2).some((a) => a.type === 'envido'));
});
