'use strict';
// Los bots tienen en cuenta las cartas mejoradas del rival (amuletos de cartas y mejoras de la tienda).
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/engine.js');
const { Bot } = require('../js/bot.js');
const Room = require('../js/room-engine.js');
const RoomBot = require('../js/room-bot.js');

const seeded = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const card = (num, suit) => ({ num, suit });
const HUMAN = 0;
const BOT = 1;

// Todas las cartas bajas del rival matan como el ancho de basto, y las figuras valen 7 para el envido.
const BIG_UPGRADES = Object.fromEntries(
  T.makeDeck()
    .filter((c) => [4, 5, 6, 10, 11, 12].includes(c.num))
    .map((c) => [T.cardKey(c), c.num >= 10 ? { envido: 7 } : { rank: 13 }]),
);

function botView(humanMods) {
  const rng = seeded(9);
  const s = structuredClone(T.dealHand(T.newGame(rng, { mods: [humanMods, null] }), rng).state);
  s.hands[BOT] = [card(3, 'oro'), card(2, 'copa'), card(7, 'oro')];
  s.dealt[BOT] = structuredClone(s.hands[BOT]);
  return T.viewFor(s, BOT);
}

test('la vista del bot trae las mejoras del rival', () => {
  const view = botView({ upgrades: { '1oro': { rank: 13 } } });
  assert.deepEqual(view.oppUpgrades, { '1oro': { rank: 13 } });
  assert.equal(botView(null).oppUpgrades, undefined);
});

test('el bot 1v1 se ve más flojo si tus cartas están mejoradas', () => {
  const plain = new Bot({ storage: null, rng: seeded(3), samples: 300 }).estimate(botView(null)).best;
  const upgraded = new Bot({ storage: null, rng: seeded(3), samples: 300 }).estimate(botView({ upgrades: BIG_UPGRADES })).best;
  assert.ok(upgraded < plain - 0.15, `sin mejoras ${plain}, con mejoras ${upgraded}`);
});

test('el bot 1v1 supone más envido si tus figuras valen puntos', () => {
  const bot = new Bot({ storage: null, rng: seeded(5) });
  assert.equal(bot.oppEnvidoLift(botView(null)), 0);
  assert.ok(bot.oppEnvidoLift(botView({ upgrades: BIG_UPGRADES })) > 2);
});

function roomView(seat, rivalMods) {
  const rng = seeded(4);
  const mods = [rivalMods, null, null, null];
  const s = structuredClone(Room.dealHand(Room.newGame('dupla', rng, { mods }), rng).state);
  s.hands[seat] = [card(3, 'oro'), card(2, 'copa'), card(12, 'basto')];
  s.dealt[seat] = structuredClone(s.hands[seat]);
  return Room.viewFor(s, seat, { team: true });
}

test('el bot de salas ve las mejoras de los rivales, no las de su equipo', () => {
  const upgrades = { '1oro': { rank: 13 } };
  assert.deepEqual(roomView(1, { upgrades }).rivalUpgrades, [{ seat: 0, upgrades }]);
  assert.equal(roomView(2, { upgrades }).rivalUpgrades, undefined);
});

test('el bot de salas exige más para el truco si los rivales tienen cartas mejoradas', () => {
  const plain = RoomBot.teamPower(roomView(1, null));
  const upgraded = RoomBot.teamPower(roomView(1, { upgrades: BIG_UPGRADES }));
  assert.ok(upgraded < plain - 0.5, `sin mejoras ${plain}, con mejoras ${upgraded}`);
});
