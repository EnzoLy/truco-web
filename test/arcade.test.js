'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/engine.js');
globalThis.Truco = T;
const A = require('../js/arcade.js');

function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const shopRun = (overrides = {}) => {
  const run = A.newRun(seeded(1));
  return A.rollShop({ ...run, phase: 'shop', ...overrides }, seeded(2));
};

test('una run nueva arranca en la ronda 1 con monedas y sin amuletos', () => {
  const run = A.newRun(seeded(1));
  assert.equal(run.phase, 'match');
  assert.equal(run.round, 1);
  assert.equal(run.coins, 4);
  assert.deepEqual(run.amulets, []);
  assert.ok(A.PERSONALITY_IDS.includes(run.rival.id));
});

test('rivalFor es determinista con la misma semilla', () => {
  for (let round = 1; round <= 12; round++) {
    assert.deepEqual(A.rivalFor(round, seeded(round)), A.rivalFor(round, seeded(round)));
  }
});

test('cada 4 rondas toca un jefe tramposo o cargado', () => {
  for (let seed = 1; seed < 30; seed++) {
    const rival = A.rivalFor(4, seeded(seed));
    assert.ok(rival.boss);
    assert.ok(['tramposo', 'cargado'].includes(rival.id));
    if (rival.id === 'cargado') assert.ok(rival.amulets.length >= 3);
    if (rival.id === 'tramposo') assert.equal(rival.cheat, true);
  }
  assert.equal(A.rivalFor(3, seeded(1)).boss, false);
});

test('los rivales se ponen mas fuertes con las rondas', () => {
  assert.ok(A.rivalFor(10, seeded(1)).samples > A.rivalFor(1, seeded(1)).samples);
});

test('ganar manos y envidos da monedas', () => {
  const run = A.newRun(seeded(1));
  const { run: next, gains } = A.onEvents(run, [
    { type: 'hand-end', winner: 0 },
    { type: 'hand-end', winner: 1 },
    { type: 'envido-result', winner: 0 },
  ], seeded(3));
  assert.equal(next.coins, run.coins + 2);
  assert.deepEqual(gains.map((g) => g.reason), ['mano', 'envido']);
  assert.equal(run.coins, 4, 'no muta la run original');
});

test('los amuletos de economia suman monedas extra', () => {
  const run = { ...A.newRun(seeded(1)), amulets: ['propina', 'cuentero'] };
  const { run: next } = A.onEvents(run, [{ type: 'hand-end', winner: 0 }, { type: 'envido-result', winner: 0 }], seeded(3));
  assert.equal(next.coins, run.coins + 2 + 3);
});

test('ganar la partida paga premio e interes y abre la tienda', () => {
  const run = { ...A.newRun(seeded(1)), coins: 12 };
  const { run: next, gains } = A.onEvents(run, [{ type: 'game-end', winner: 0 }], seeded(3));
  assert.equal(next.phase, 'shop');
  assert.equal(next.wins, 1);
  assert.equal(next.best, 1);
  assert.equal(next.match, null);
  assert.equal(next.coins, 12 + A.winReward(1) + 2);
  assert.deepEqual(gains.map((g) => g.reason), ['victoria', 'interés']);
  assert.ok(next.shop.items.length >= 3);
});

test('las mejoras de cartas duran una sola partida: al ganarla se borran', () => {
  const run = { ...A.newRun(seeded(1)), upgrades: { '4copa': { rank: 10 } } };
  const { run: next } = A.onEvents(run, [{ type: 'game-end', winner: 0 }], seeded(3));
  assert.deepEqual(next.upgrades, {});
  assert.deepEqual(run.upgrades, { '4copa': { rank: 10 } }, 'no muta la run original');
});

test('el amuleto de flor habilita la flor en el motor y cantarla da monedas', () => {
  const run = { ...A.newRun(seeded(1)), amulets: ['flor'] };
  assert.equal(A.modsFor(run)[0].flor, true);
  assert.equal(A.modsFor(A.newRun(seeded(1)))[0].flor, undefined);
  const { run: next, gains } = A.onEvents(run, [{ type: 'flor', by: 0, awarded: 3 }, { type: 'flor', by: 1, awarded: 3 }], seeded(3));
  assert.equal(next.coins, run.coins + 1);
  assert.deepEqual(gains.map((g) => g.reason), ['flor']);
});

test('los rivales nunca traen el amuleto de flor', () => {
  for (let seed = 1; seed < 60; seed++) assert.ok(!A.rivalFor(8, seeded(seed)).amulets.includes('flor'));
});

test('el interes tiene tope y la alcancia lo sube', () => {
  const rich = { ...A.newRun(seeded(1)), coins: 80 };
  assert.equal(A.interestOf(rich), 5);
  assert.equal(A.interestOf({ ...rich, amulets: ['alcancia'] }), 10);
});

test('perder termina la run y guarda el record', () => {
  const run = { ...A.newRun(seeded(1)), wins: 6, best: 4 };
  const { run: next } = A.onEvents(run, [{ type: 'game-end', winner: 1 }], seeded(3));
  assert.equal(next.phase, 'over');
  assert.equal(next.best, 6);
});

test('comprar un amuleto descuenta monedas y lo marca vendido', () => {
  const run = shopRun({ coins: 50 });
  const i = run.shop.items.findIndex((it) => it.type === 'amulet');
  const item = run.shop.items[i];
  const next = A.buy(run, i);
  assert.equal(next.coins, 50 - item.price);
  assert.deepEqual(next.amulets, [item.id]);
  assert.equal(next.shop.items[i].sold, true);
  assert.throws(() => A.buy(next, i), /ya no está/);
});

test('no se puede comprar sin monedas', () => {
  const run = shopRun({ coins: 0 });
  assert.throws(() => A.buy(run, 0), A.ArcadeError);
  assert.match(A.cantBuy(run, 0), /monedas/);
});

test('no se pueden tener mas de 5 amuletos', () => {
  const run = shopRun({ coins: 99, amulets: ['cantor', 'propina', 'cuentero', 'alcancia', 'oido-fino'] });
  const i = run.shop.items.findIndex((it) => it.type === 'amulet');
  assert.match(A.cantBuy(run, i), /5 amuletos/);
});

test('la tienda no ofrece amuletos que ya tenés', () => {
  const owned = A.AMULET_IDS.slice(0, 8);
  const run = shopRun({ amulets: owned });
  for (const it of run.shop.items) if (it.type === 'amulet') assert.ok(!owned.includes(it.id));
});

test('comprar una mejora la guarda en la carta', () => {
  const run = shopRun({ coins: 50 });
  const i = run.shop.items.findIndex((it) => it.type === 'upgrade');
  const item = run.shop.items[i];
  const next = A.buy(run, i);
  assert.equal(next.upgrades[item.key][item.field], item.value);
  assert.deepEqual(next.amulets, []);
});

test('la tienda no repite la misma carta en dos mejoras', () => {
  for (let seed = 1; seed < 40; seed++) {
    const run = A.rollShop({ ...A.newRun(seeded(seed)), phase: 'shop' }, () => 0.42);
    const keys = run.shop.items.filter((it) => it.type === 'upgrade').map((it) => it.key);
    assert.equal(new Set(keys).size, keys.length);
  }
});

test('las mejoras ofrecidas siempre mejoran algo, contando los amuletos de cartas', () => {
  for (let seed = 1; seed < 60; seed++) {
    const run = A.rollShop({ ...A.newRun(seeded(seed)), phase: 'shop', amulets: ['sietes-bravos', 'ancho-falso', 'figuras'] }, seeded(seed + 100));
    const [before] = A.modsFor(run);
    for (const it of run.shop.items.filter((x) => x.type === 'upgrade')) {
      const current = (before.upgrades[it.key] || {})[it.field];
      if (current !== undefined) assert.ok(it.value > current, `${it.key} ${it.field}: ${it.value} <= ${current}`);
    }
  }
});

test('los rivales solo llevan amuletos de puntaje o cartas', () => {
  for (let seed = 1; seed < 40; seed++) {
    for (const id of A.rivalFor(8, seeded(seed)).amulets) assert.ok(['puntaje', 'cartas'].includes(A.AMULETS[id].kind), id);
  }
});

test('vender devuelve la mitad del precio', () => {
  const run = shopRun({ coins: 0, amulets: ['pico-de-oro'] });
  const next = A.sell(run, 'pico-de-oro');
  assert.equal(next.coins, Math.floor(A.AMULETS['pico-de-oro'].price / 2));
  assert.deepEqual(next.amulets, []);
  assert.throws(() => A.sell(next, 'pico-de-oro'), /No tenés/);
});

test('el reroll cuesta cada vez mas', () => {
  const run = shopRun({ coins: 20 });
  assert.equal(A.rerollCost(run), 3);
  const once = A.reroll(run, seeded(5));
  assert.equal(once.coins, 17);
  assert.equal(A.rerollCost(once), 4);
  const twice = A.reroll(once, seeded(6));
  assert.equal(twice.coins, 13);
});

test('salir de la tienda arma la ronda siguiente', () => {
  const run = shopRun({ round: 3 });
  const next = A.leaveShop(run, seeded(9));
  assert.equal(next.phase, 'match');
  assert.equal(next.round, 4);
  assert.equal(next.shop, null);
  assert.ok(next.rival.boss);
});

test('modsFor junta amuletos, mejoras y trampas del rival', () => {
  const run = {
    ...A.newRun(seeded(1)),
    amulets: ['pico-de-oro', 'espejito', 'bola-de-cristal', 'sietes-bravos'],
    upgrades: { '7copa': { envido: 7 }, '4oro': { rank: 9 } },
    rival: { ...A.rivalFor(1, seeded(1)), amulets: ['cantor'], cheat: true },
  };
  const [mine, theirs] = A.modsFor(run);
  assert.equal(mine.trucoBonus, 1);
  // espejito (una carta siempre) + bola de cristal (toda la mano cada 3 manos)
  assert.equal(mine.peek, 'one');
  assert.equal(mine.peekEvery, 3);
  assert.deepEqual(mine.upgrades['7copa'], { rank: 10, envido: 7 });
  assert.deepEqual(mine.upgrades['4oro'], { rank: 9 });
  assert.equal(theirs.envidoBonus, 1);
  assert.equal(theirs.peek, 'all');
});

test('los mods de la run llegan al motor', () => {
  const run = { ...A.newRun(seeded(1)), amulets: ['cantor'] };
  const game = T.newGame(seeded(2), A.matchOptions(run));
  assert.equal(game.mods[0].envidoBonus, 1);
});

test('todos los amuletos tienen nombre, precio y tipo validos', () => {
  for (const id of A.AMULET_IDS) {
    const a = A.AMULETS[id];
    assert.ok(a.name && a.desc, id);
    assert.ok(a.price > 0, id);
    assert.ok(['puntaje', 'economia', 'cartas', 'info'].includes(a.kind), id);
  }
});

test('una run completa contra bots termina sin errores', () => {
  const { Bot } = require('../js/bot.js');
  const rng = seeded(42);
  let run = A.newRun(rng);
  for (let guard = 0; guard < 40 && run.phase !== 'over'; guard++) {
    if (run.phase === 'shop') {
      const i = run.shop.items.findIndex((_, k) => !A.cantBuy(run, k));
      if (i >= 0) run = A.buy(run, i);
      run = A.leaveShop(run, rng);
      continue;
    }
    const players = [new Bot({ storage: null, rng, samples: 20 }), new Bot({ storage: null, rng, samples: 20, traits: run.rival.traits })];
    let state = T.dealHand(T.newGame(rng, A.matchOptions(run)), rng).state;
    while (run.phase === 'match') {
      if (state.phase === 'hand-over') { state = T.dealHand(state, rng).state; continue; }
      const r = T.step(state, state.turn, players[state.turn].decide(T.viewFor(state, state.turn)));
      state = r.state;
      run = A.onEvents(run, r.events, rng).run;
    }
  }
  assert.ok(run.round >= 1);
});

test('las mejoras de truco dicen claro a qué carta equivalen', () => {
  assert.equal(A.rankText(10), 'mata como un 3');
  assert.equal(A.rankText(6), 'mata como un 11');
  assert.equal(A.rankText(13), 'mata como el ancho de basto');
  assert.equal(A.rankText(13.5), 'le gana a todo menos al ancho de espada');
  for (let r = 1; r <= 14; r++) assert.match(A.rankText(r), /^mata como /);
});

test('la oferta de filo explica la nueva fuerza de la carta', () => {
  for (let seed = 1; seed < 40; seed++) {
    const run = A.rollShop({ ...A.newRun(seeded(seed)), phase: 'shop' }, seeded(seed + 100));
    run.shop.items.filter((it) => it.field === 'rank').forEach((it) => {
      assert.ok(it.desc.includes(A.rankText(it.value)), it.desc);
      assert.ok(!it.desc.includes('más fuerte'), it.desc);
    });
  }
});

test('ningún amuleto deja ver la mano del rival en todas las manos', () => {
  for (const id of A.AMULET_IDS) {
    const mods = A.AMULETS[id].mods || {};
    assert.notEqual(mods.peek, 'all', id);
  }
  assert.equal(A.AMULETS['bola-de-cristal'].mods.peekEvery, 3);
});

test('cada personalidad común tiene traits propios para el 1v1 y para el dúo', () => {
  const ids = ['agresivo', 'timido', 'envidoso', 'loco'];
  for (const id of ids) {
    assert.ok(A.PERSONALITY_IDS.includes(id), id);
    const p = A.PERSONALITIES[id];
    assert.ok(Object.keys(p.traits).length > 0, `${id} 1v1`);
    assert.ok(Object.keys(p.duoTraits).length > 0, `${id} dúo`);
    assert.ok(!p.cheat && !p.boss, id);
  }
});

test('cada amuleto tiene su icono SVG propio', () => {
  const icons = require('../js/amulet-icons.js');
  const ids = Object.keys(global.TrucoAmuletIcons || icons);
  for (const id of A.AMULET_IDS) assert.ok((global.TrucoAmuletIcons || icons)[id], `falta el icono de ${id}`);
  assert.equal(new Set(ids.map((id) => (global.TrucoAmuletIcons || icons)[id])).size, ids.length, 'iconos repetidos');
});
