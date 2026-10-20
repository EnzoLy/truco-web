'use strict';
// Run del dúo con un amigo: bolsa común, cada uno compra lo suyo.
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../js/arcade.js');

const seeded = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

function shopRun(extra = {}) {
  const run = { ...A.newRun(seeded(3), { mode: 'duo', coop: true, partnerName: 'Beto' }), phase: 'shop', coins: 100, ...extra };
  return A.rollShop(run, seeded(4), 0);
}

const amuletIndex = (run, n = 0) => run.shop.items.map((it, i) => (it.type === 'amulet' ? i : -1)).filter((i) => i >= 0)[n];

test('la run con amigo tiene el bolsillo del compañero; la del bot no', () => {
  assert.deepEqual(shopRun().partner, { name: 'Beto', amulets: [], upgrades: {} });
  assert.equal(A.newRun(seeded(3), { mode: 'duo' }).partner, undefined);
  assert.equal(A.isCoop(shopRun()), true);
});

test('cada uno compra para sí con la bolsa común', () => {
  let run = shopRun();
  const a = amuletIndex(run, 0);
  const b = amuletIndex(run, 1);
  run = A.buy(run, a, 'me');
  run = A.buy(run, b, 'partner');
  assert.deepEqual(run.amulets, [run.shop.items[a].id]);
  assert.deepEqual(run.partner.amulets, [run.shop.items[b].id]);
  assert.equal(run.coins, 100 - run.shop.items[a].price - run.shop.items[b].price);
});

test('el límite de amuletos es por persona', () => {
  const five = A.AMULET_IDS.slice(0, A.MAX_AMULETS);
  const run = shopRun({ amulets: five });
  const i = amuletIndex(run);
  assert.throws(() => A.buy(run, i, 'me'), /amuletos/);
  assert.doesNotThrow(() => A.buy(run, i, 'partner'));
});

test('la tienda no ofrece amuletos que ya tenga alguno de los dos', () => {
  const owned = A.AMULET_IDS.slice(0, 5);
  const theirs = A.AMULET_IDS.slice(5, 10);
  const base = { ...shopRun(), amulets: owned };
  base.partner = { ...base.partner, amulets: theirs };
  const run = A.rollShop(base, seeded(9), 0);
  const offered = run.shop.items.filter((it) => it.type === 'amulet').map((it) => it.id);
  assert.ok(offered.every((id) => !owned.includes(id) && !theirs.includes(id)));
});

test('vender devuelve monedas a la bolsa y saca el amuleto de quien vende', () => {
  let run = shopRun();
  run = A.buy(run, amuletIndex(run), 'partner');
  const id = run.partner.amulets[0];
  const coins = run.coins;
  run = A.sell(run, id, 'partner');
  assert.deepEqual(run.partner.amulets, []);
  assert.equal(run.coins, coins + A.sellPrice(id));
  assert.throws(() => A.sell(run, id, 'me'), /No tenés/);
});

test('el compañero juega con sus amuletos y sus mejoras', () => {
  const run = { ...shopRun(), partner: { name: 'Beto', amulets: ['pico-de-oro'], upgrades: { '4copa': { rank: 10 } } } };
  const mods = A.modsFor(run);
  assert.equal(mods[2].trucoBonus, 1);
  assert.deepEqual(mods[2].upgrades, { '4copa': { rank: 10 } });
  assert.equal(mods[0].trucoBonus, undefined);
});

test('la base la cobra el equipo una vez; lo extra, el dueño del amuleto si el punto fue suyo', () => {
  const run = { ...shopRun(), phase: 'match', coins: 0, partner: { name: 'Beto', amulets: ['propina'], upgrades: {} } };
  const mine = A.onEvents(run, [{ type: 'hand-end', winner: 0, trickSeats: [0] }], seeded(1));
  assert.equal(mine.run.coins, 1, 'la baza fue mía: la propina del amigo no cuenta');
  const theirs = A.onEvents(run, [{ type: 'hand-end', winner: 0, trickSeats: [2] }], seeded(1));
  assert.equal(theirs.run.coins, 2);
  assert.deepEqual(theirs.gains.map((g) => [g.reason, g.seat]), [['mano', 0], ['propina', 2]]);
});

test('el interés usa la alcancía de cualquiera de los dos', () => {
  const run = { ...shopRun(), coins: 60, partner: { name: 'Beto', amulets: ['alcancia'], upgrades: {} } };
  assert.equal(A.interestOf(run), 10);
});

test('ganar limpia las mejoras de los dos', () => {
  const run = { ...shopRun(), phase: 'match', upgrades: { '4copa': { rank: 10 } }, partner: { name: 'Beto', amulets: [], upgrades: { '5oro': { envido: 7 } } } };
  const { run: next } = A.onEvents(run, [{ type: 'game-end', winners: [0, 2] }], seeded(1));
  assert.deepEqual(next.upgrades, {});
  assert.deepEqual(next.partner.upgrades, {});
  assert.equal(next.phase, 'shop');
});
