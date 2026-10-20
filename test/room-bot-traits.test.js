'use strict';
// Personalidades y trampa del bot de salas (rivales del arcade dúo).
const test = require('node:test');
const assert = require('node:assert/strict');
const Room = require('../js/room-engine.js');
const Bot = require('../js/room-bot.js');

const seeded = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const card = (num, suit) => ({ num, suit });
const NONE = {};

function setup(hands, mods = [NONE, NONE, NONE, NONE], mano = 0) {
  const rng = seeded(4);
  const s = structuredClone(Room.dealHand(Room.newGame('dupla', rng, { mods }), rng).state);
  s.hands = structuredClone(hands);
  s.dealt = structuredClone(hands);
  s.mano = mano;
  s.teams = Room.teamsFor('dupla', mano);
  s.turn = mano;
  s.playTurn = mano;
  s.phase = 'play';
  s.cur = { leader: mano, cards: [null, null, null, null] };
  return s;
}

const WEAK = [card(4, 'copa'), card(5, 'espada'), card(6, 'basto')];
const WEAK2 = [card(4, 'oro'), card(5, 'copa'), card(6, 'espada')];
const STRONG = [card(1, 'espada'), card(1, 'basto'), card(7, 'espada')];
const MID = [card(3, 'oro'), card(2, 'copa'), card(12, 'basto')];

const countTruco = (view, traits) => {
  let calls = 0;
  for (let i = 0; i < 300; i++) if (Bot.decide(view, seeded(i + 1), traits).type === 'truco') calls++;
  return calls;
};

test('sin traits decide igual que con los traits por defecto', () => {
  const s = setup([MID, WEAK, WEAK2, STRONG]);
  const view = Room.viewFor(s, 0, { team: true });
  for (let i = 0; i < 50; i++) {
    assert.deepEqual(Bot.decide(view, seeded(i)), Bot.decide(view, seeded(i), { ...Bot.DEFAULT_TRAITS }));
  }
});

test('el mentiroso canta truco con mano mala mucho más seguido que el prudente', () => {
  const s = setup([WEAK, MID, WEAK2, MID]);
  const view = Room.viewFor(s, 0, { team: true });
  const liar = countTruco(view, { bluffCall: 0.4 });
  const careful = countTruco(view, { bluffCall: 0.01, trucoShift: 1 });
  assert.ok(liar > careful * 3, `mentiroso ${liar} vs prudente ${careful}`);
});

test('el tramposo acepta el truco con mano floja si ve que los rivales tienen menos', () => {
  // Turno del asiento 0, que canta truco; responde el asiento 1 (tramposo), que ve las manos de 0 y 2.
  const hands = [WEAK, [card(12, 'copa'), card(11, 'oro'), card(6, 'copa')], WEAK2, [card(2, 'espada'), card(12, 'oro'), card(5, 'basto')]];
  const honest = Room.step(setup(hands), 0, { type: 'truco' }).state;
  const cheat = Room.step(setup(hands, [NONE, { peek: 'all' }, NONE, NONE]), 0, { type: 'truco' }).state;
  const honestView = Room.viewFor(honest, 1, { team: true });
  const cheatView = Room.viewFor(cheat, 1, { team: true });
  assert.ok(cheatView.oppHands, 'el tramposo ve las manos rivales');
  assert.ok(Bot.teamPower(cheatView) > Bot.teamPower(honestView));
  const accepts = (view) => Array.from({ length: 100 }, (_, i) => Bot.decide(view, seeded(i + 7), { acceptBluff: 0 })).filter((a) => a.type === 'accept').length;
  assert.equal(accepts(honestView), 0, 'sin trampa, con esa mano no quiere');
  assert.equal(accepts(cheatView), 100);
});

test('el tramposo no quiere el envido si ve que lo pierde, aunque tenga muchos puntos', () => {
  const mine = [card(7, 'oro'), card(5, 'oro'), card(4, 'basto')]; // 32
  const rival = [card(7, 'copa'), card(6, 'copa'), card(4, 'espada')]; // 33
  const hands = [rival, mine, WEAK2, WEAK];
  const call = (mods) => Room.step(setup(hands, mods), 0, { type: 'envido', what: 'envido' }).state;
  const honest = Room.viewFor(call([NONE, NONE, NONE, NONE]), 1, { team: true });
  const cheat = Room.viewFor(call([NONE, { peek: 'all' }, NONE, NONE]), 1, { team: true });
  const rejects = (view) => Array.from({ length: 50 }, (_, i) => Bot.decide(view, seeded(i + 3), { envidoBluff: 0 })).filter((a) => a.type === 'reject').length;
  assert.equal(rejects(honest), 0);
  assert.equal(rejects(cheat), 50);
});
