'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/engine.js');
globalThis.Truco = T;
const { Bot, DEFAULT_TRAITS } = require('../js/bot.js');

const HUMAN = 0;
const BOT = 1;
const c = (num, suit) => ({ num, suit });
const clone = (o) => JSON.parse(JSON.stringify(o));

function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const makeBot = (seed, traits) => new Bot({ storage: null, rng: seeded(seed), samples: 60, traits });

/** Estado listo con manos exactas; el humano es mano. */
function rig(humanHand, botHand, { mano = HUMAN, mods = null, envidoDone = false } = {}) {
  let { state } = T.dealHand(T.newGame(() => 0.9, { mods }));
  state = clone(state);
  state.mano = mano;
  state.hands = T.applyUpgrades([clone(humanHand), clone(botHand)], mods);
  state.dealt = clone(state.hands);
  state.cur = { leader: mano, cards: [null, null] };
  state.playTurn = state.turn = mano;
  if (envidoDone) state.envido = { done: true, stack: [], result: null };
  return state;
}

const rate = (n, fn) => {
  let hits = 0;
  for (let i = 0; i < n; i++) if (fn()) hits++;
  return hits / n;
};

const anchos = [c(1, 'espada'), c(1, 'basto'), c(7, 'espada')];
const junk = [c(4, 'oro'), c(5, 'copa'), c(6, 'basto')];
const middling = [c(3, 'copa'), c(2, 'oro'), c(12, 'basto')];

test('sin traits el bot usa los valores de siempre', () => {
  const rng = seeded(4);
  const plain = makeBot(21);
  const explicit = makeBot(21, { ...DEFAULT_TRAITS });
  let { state } = T.dealHand(T.newGame(rng), rng);
  for (let i = 0; i < 300 && state.phase !== 'game-over'; i++) {
    if (state.phase === 'hand-over') { state = T.dealHand(state, rng).state; continue; }
    const p = state.turn;
    let action;
    if (p === BOT) {
      const view = T.viewFor(state, BOT);
      action = plain.decide(view);
      assert.deepEqual(explicit.decide(view), action);
    } else {
      const legal = T.legalActions(state, HUMAN);
      action = legal[Math.floor(rng() * legal.length)];
    }
    state = T.step(state, p, action).state;
  }
});

test('un bot mentiroso canta truco con mala mano mas que uno conservador', () => {
  const view = T.viewFor(rig(junk, [c(11, 'espada'), c(10, 'copa'), c(5, 'oro')], { mano: BOT, envidoDone: true }), BOT);
  const liar = makeBot(5, { bluffTruco: 3, bluffTrucoBase: 0.25 });
  const safe = makeBot(5, { bluffTruco: 0, bluffTrucoBase: 0 });
  const liarRate = rate(300, () => liar.decide(view).type === 'truco');
  const safeRate = rate(300, () => safe.decide(view).type === 'truco');
  assert.ok(liarRate > safeRate + 0.1, `mentiroso ${liarRate} vs conservador ${safeRate}`);
});

test('un bot conservador acepta menos trucos con mano regular', () => {
  const regular = [c(12, 'oro'), c(11, 'copa'), c(6, 'espada')];
  const state = T.step(rig(junk, regular, { envidoDone: true }), HUMAN, { type: 'truco' }).state;
  const view = T.viewFor(state, BOT);
  const brave = makeBot(9, { acceptShift: 0 });
  const careful = makeBot(9, { acceptShift: 0.35 });
  const braveRate = rate(200, () => brave.decide(view).type !== 'reject');
  const carefulRate = rate(200, () => careful.decide(view).type !== 'reject');
  assert.ok(braveRate > carefulRate, `valiente ${braveRate} vs cuidadoso ${carefulRate}`);
});

test('el tramposo que ve tus cartas no quiere el truco si va a perder', () => {
  const mods = [{}, { peek: 'all' }];
  const state = T.step(rig(anchos, middling, { mods, envidoDone: true }), HUMAN, { type: 'truco' }).state;
  const view = T.viewFor(state, BOT);
  assert.deepEqual(view.oppHand, anchos);
  const cheater = makeBot(3);
  assert.ok(rate(100, () => cheater.decide(view).type === 'reject') > 0.95);
});

test('el tramposo quiere el truco si sabe que gana', () => {
  const mods = [{}, { peek: 'all' }];
  const state = T.step(rig(junk, middling, { mods, envidoDone: true }), HUMAN, { type: 'truco' }).state;
  const cheater = makeBot(3);
  assert.equal(rate(100, () => cheater.decide(T.viewFor(state, BOT)).type === 'reject'), 0);
});

test('el tramposo cuenta tu amuleto de envido', () => {
  const mods = [{ envidoCountBonus: 2 }, { peek: 'all' }];
  const botHand = [c(7, 'copa'), c(2, 'copa'), c(12, 'oro')]; // 29
  const human = [c(5, 'oro'), c(3, 'oro'), c(4, 'basto')]; // 28 + 2 = 30
  const state = T.step(rig(human, botHand, { mods }), HUMAN, { type: 'envido', what: 'envido' }).state;
  assert.equal(makeBot(8).decide(T.viewFor(state, BOT)).type, 'reject');
});

test('el tramposo responde el envido sabiendo tus puntos', () => {
  const mods = [{}, { peek: 'all' }];
  const botHand = [c(6, 'copa'), c(2, 'copa'), c(12, 'oro')]; // 28
  const strongEnvido = [c(7, 'oro'), c(6, 'oro'), c(4, 'basto')]; // 33
  const weakEnvido = [c(12, 'espada'), c(11, 'oro'), c(4, 'basto')]; // 4
  const cheater = makeBot(8);
  const vsStrong = T.step(rig(strongEnvido, botHand, { mods }), HUMAN, { type: 'envido', what: 'envido' }).state;
  assert.equal(cheater.decide(T.viewFor(vsStrong, BOT)).type, 'reject');
  const vsWeak = T.step(rig(weakEnvido, botHand, { mods }), HUMAN, { type: 'envido', what: 'envido' }).state;
  assert.notEqual(cheater.decide(T.viewFor(vsWeak, BOT)).type, 'reject');
});
