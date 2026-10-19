'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/engine.js');
globalThis.Truco = T;
const { Bot, blankModel } = require('../js/bot.js');

const HUMAN = 0;
const BOT = 1;
const c = (num, suit) => ({ num, suit });

function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

const makeBot = (seed = 1, storage = memoryStorage()) => new Bot({ storage, rng: seeded(seed), samples: 60 });

/** Estado donde el bot es mano y puede cantar truco; el envido ya se jugo. */
function botToActState(botHand, humanHand = [c(5, 'oro'), c(6, 'copa'), c(4, 'basto')]) {
  let { state } = T.dealHand(T.newGame(() => 0.9));
  state = JSON.parse(JSON.stringify(state));
  state.mano = BOT;
  state.hands = [JSON.parse(JSON.stringify(humanHand)), JSON.parse(JSON.stringify(botHand))];
  state.dealt = JSON.parse(JSON.stringify(state.hands));
  state.cur = { leader: BOT, cards: [null, null] };
  state.playTurn = state.turn = BOT;
  state.envido = { done: true, stack: [], result: null };
  return state;
}

const trucoCallRate = (bot, view, trials) => {
  let calls = 0;
  for (let i = 0; i < trials; i++) if (bot.decide(view).type === 'truco') calls++;
  return calls / trials;
};

const feedTrucoResponses = (bot, response, n) => {
  for (let i = 0; i < n; i++) {
    bot.observe({ type: 'truco-response', by: HUMAN, caller: BOT, level: 1, response });
  }
};

test('el bot siempre devuelve una accion legal en cada fase', () => {
  const rng = seeded(7);
  const bot = makeBot(3);
  for (let g = 0; g < 25; g++) {
    let { state } = T.dealHand(T.newGame(rng), rng);
    let guard = 0;
    while (state.phase !== 'game-over') {
      assert.ok(++guard < 3000, 'la partida no termina');
      if (state.phase === 'hand-over') { state = T.dealHand(state, rng).state; continue; }
      const p = state.turn;
      let action;
      if (p === BOT) {
        action = bot.decide(T.viewFor(state, BOT));
      } else {
        const legal = T.legalActions(state, HUMAN);
        const plays = legal.filter((a) => a.type === 'play');
        action = plays.length && rng() < 0.75 ? plays[Math.floor(rng() * plays.length)] : legal[Math.floor(rng() * legal.length)];
      }
      const r = T.step(state, p, action);
      r.events.forEach((e) => bot.observe(e));
      state = r.state;
    }
  }
  assert.ok(bot.model.games >= 25);
  assert.ok(bot.model.hands > 25);
});

test('el bot le gana a un jugador aleatorio la mayoria de las partidas', () => {
  const rng = seeded(99);
  const bot = makeBot(5);
  let botWins = 0;
  const games = 40;
  for (let g = 0; g < games; g++) {
    let { state } = T.dealHand(T.newGame(rng), rng);
    while (state.phase !== 'game-over') {
      if (state.phase === 'hand-over') { state = T.dealHand(state, rng).state; continue; }
      const p = state.turn;
      let action;
      if (p === BOT) action = bot.decide(T.viewFor(state, BOT));
      else {
        const legal = T.legalActions(state, HUMAN);
        const plays = legal.filter((a) => a.type === 'play');
        action = plays.length && rng() < 0.75 ? plays[Math.floor(rng() * plays.length)] : legal[Math.floor(rng() * legal.length)];
      }
      const r = T.step(state, p, action);
      r.events.forEach((e) => bot.observe(e));
      state = r.state;
    }
    if (state.winner === BOT) botWins++;
  }
  assert.ok(botWins / games > 0.65, `el bot solo gano ${botWins}/${games}`);
});

test('aprende que te bajas del truco y empieza a tirar mas faroles', () => {
  const state = botToActState([c(11, 'espada'), c(10, 'copa'), c(5, 'oro')]);
  const view = T.viewFor(state, BOT);
  const fresh = trucoCallRate(makeBot(11), view, 500);
  const folder = makeBot(11);
  feedTrucoResponses(folder, 'reject', 20);
  const folderRate = trucoCallRate(folder, view, 500);
  assert.ok(folderRate > fresh + 0.05, `fresh=${fresh} folder=${folderRate}`);
});

test('aprende que nunca te bajas y deja de farolear', () => {
  const state = botToActState([c(11, 'espada'), c(10, 'copa'), c(5, 'oro')]);
  const view = T.viewFor(state, BOT);
  const fresh = trucoCallRate(makeBot(21), view, 500);
  const caller = makeBot(21);
  feedTrucoResponses(caller, 'accept', 20);
  const callerRate = trucoCallRate(caller, view, 500);
  assert.ok(callerRate < fresh, `fresh=${fresh} caller=${callerRate}`);
  assert.ok(callerRate < 0.01);
});

test('contra quien se baja mucho, canta truco con menos mano', () => {
  const state = botToActState([c(3, 'oro'), c(7, 'copa'), c(4, 'oro')]);
  const view = T.viewFor(state, BOT);
  const fresh = trucoCallRate(makeBot(31), view, 400);
  const folder = makeBot(31);
  feedTrucoResponses(folder, 'reject', 25);
  assert.ok(trucoCallRate(folder, view, 400) >= fresh);
});

test('si tus trucos son faroles (pierdes casi siempre), el bot acepta mas', () => {
  const makeResponseView = () => {
    let s = botToActState([c(12, 'oro'), c(7, 'copa'), c(5, 'oro')]);
    s.mano = HUMAN;
    s.cur = { leader: HUMAN, cards: [null, null] };
    s.playTurn = HUMAN;
    s.turn = HUMAN;
    s = T.step(s, HUMAN, { type: 'truco' }).state;
    return T.viewFor(s, BOT);
  };
  const view = makeResponseView();
  assert.equal(view.phase, 'respond-truco');
  const acceptRate = (bot) => {
    let a = 0;
    for (let i = 0; i < 300; i++) if (bot.decide(view).type === 'accept') a++;
    return a / 300;
  };
  const honest = makeBot(41);
  const bluffer = makeBot(41);
  for (let i = 0; i < 12; i++) {
    honest.observe({ type: 'hand-end', winner: HUMAN, points: 2, reason: 'tricks', trucoLevel: 1, lastTrucoCaller: HUMAN });
    bluffer.observe({ type: 'hand-end', winner: BOT, points: 2, reason: 'tricks', trucoLevel: 1, lastTrucoCaller: HUMAN });
  }
  assert.ok(bluffer.rates().callHonesty < honest.rates().callHonesty);
  assert.ok(acceptRate(bluffer) >= acceptRate(honest));
});

test('registra el promedio de puntos con los que cantas envido', () => {
  const bot = makeBot();
  const before = bot.rates().envidoCallMean;
  for (let i = 0; i < 10; i++) {
    bot.observe({ type: 'envido-result', accepted: true, winner: HUMAN, awarded: 2, points: [33, 20], stack: ['envido'], callers: [HUMAN] });
  }
  assert.ok(bot.rates().envidoCallMean > before + 3);
  assert.equal(bot.model.envido.humanCallsShown, 10);
});

test('contra quien canta envido con mucho, el bot exige mas para aceptar', () => {
  const midHand = [c(5, 'oro'), c(12, 'oro'), c(4, 'basto')]; // 25 de envido
  let s = botToActState(midHand);
  s.envido = { done: false, stack: [], result: null };
  s.mano = HUMAN;
  s.playTurn = s.turn = HUMAN;
  s.cur = { leader: HUMAN, cards: [null, null] };
  s = T.step(s, HUMAN, { type: 'envido', what: 'envido' }).state;
  const view = T.viewFor(s, BOT);
  assert.equal(view.phase, 'respond-envido');
  assert.equal(view.myEnvido, 25);

  const fresh = makeBot(51);
  assert.equal(fresh.decide(view).type, 'accept');

  const trained = makeBot(51);
  for (let i = 0; i < 10; i++) {
    trained.observe({ type: 'envido-result', accepted: true, winner: HUMAN, awarded: 2, points: [33, 20], stack: ['envido'], callers: [HUMAN] });
  }
  assert.equal(trained.decide(view).type, 'reject');
});

test('persiste el modelo y lo recupera', () => {
  const storage = memoryStorage();
  const a = new Bot({ storage, rng: seeded(1), samples: 20 });
  feedTrucoResponses(a, 'reject', 5);
  a.save();
  const b = new Bot({ storage, rng: seeded(1), samples: 20 });
  assert.equal(b.model.truco.botCalls, 5);
  assert.equal(b.model.truco.fold, 5);
});

test('reset borra lo aprendido', () => {
  const bot = makeBot();
  feedTrucoResponses(bot, 'reject', 5);
  bot.reset();
  assert.equal(bot.model.truco.botCalls, 0);
  assert.deepEqual(bot.model, { ...blankModel(), createdAt: bot.model.createdAt });
});

test('funciona aunque el almacenamiento falle o tenga basura', () => {
  const broken = {
    getItem() { throw new Error('bloqueado'); },
    setItem() { throw new Error('bloqueado'); },
    removeItem() { throw new Error('bloqueado'); },
  };
  const bot = new Bot({ storage: broken, rng: seeded(1), samples: 20 });
  assert.doesNotThrow(() => { feedTrucoResponses(bot, 'accept', 3); bot.save(); bot.reset(); });
  const junk = memoryStorage();
  junk.setItem('truco.bot.model.v1', '{no es json');
  assert.equal(new Bot({ storage: junk, rng: seeded(1), samples: 20 }).model.games, 0);
  const noStorage = new Bot({ storage: null, rng: seeded(1), samples: 20 });
  assert.equal(noStorage.model.games, 0);
});

test('insights describe lo aprendido con tamaños de muestra', () => {
  const bot = makeBot();
  feedTrucoResponses(bot, 'reject', 4);
  const list = bot.insights();
  assert.ok(list.length >= 4);
  const fold = list.find((i) => i.key === 'trucoFold');
  assert.equal(fold.n, 4);
  assert.ok(fold.value > 0.5);
  assert.ok(typeof fold.note === 'string' && fold.note.length > 0);
});

test('registra tu primera carta como mano en tres categorias', () => {
  const bot = makeBot();
  bot.observe({ type: 'play', player: HUMAN, card: c(1, 'espada'), trickIndex: 0, isLead: true });
  bot.observe({ type: 'play', player: HUMAN, card: c(2, 'oro'), trickIndex: 0, isLead: true });
  bot.observe({ type: 'play', player: HUMAN, card: c(4, 'oro'), trickIndex: 0, isLead: true });
  assert.deepEqual(bot.model.lead, { strong: 1, mid: 1, weak: 1 });
});
