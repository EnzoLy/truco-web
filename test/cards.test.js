'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Cards = require('../js/cards.js');
const T = require('../js/engine.js');

test('las 40 cartas generan un SVG bien formado en todos los marcos y estilos, sin NaN', () => {
  for (const skin of Cards.SKIN_NAMES) {
    for (const art of Cards.ART_NAMES) {
      for (const card of T.makeDeck()) {
        assert.deepEqual(Cards.validateSvg(Cards.faceSvg(card, skin, art)), [], `${card.num} de ${card.suit} (${skin}/${art})`);
      }
    }
  }
});

test('el dorso es un SVG bien formado', () => {
  assert.deepEqual(Cards.validateSvg(Cards.backSvg()), []);
});

test('validateSvg detecta etiquetas sin cerrar y valores NaN', () => {
  assert.ok(Cards.validateSvg('<svg><g></svg>').length > 0);
  assert.ok(Cards.validateSvg('<svg><path d="M NaN"/></svg>').length > 0);
});

test('hay una disposicion de palos para cada carta numerica de 2 a 7', () => {
  for (let n = 2; n <= 7; n++) assert.equal(Cards.PIP_LAYOUTS[n].at.length, n, `carta ${n}`);
});

test('los palos de cada disposicion caben dentro del filete de la carta', () => {
  for (const { size, at } of Object.values(Cards.PIP_LAYOUTS)) {
    for (const [x, y] of at) {
      assert.ok(x - size / 2 >= 30 && x + size / 2 <= Cards.W - 30, `x=${x}`);
      assert.ok(y - size / 2 >= 20 && y + size / 2 <= Cards.H - 20, `y=${y}`);
    }
  }
});

test('cada palo tiene colores definidos y las figuras usan los del palo', () => {
  for (const suit of ['oro', 'copa', 'espada', 'basto']) {
    assert.ok(Cards.SUITS[suit].c && Cards.SUITS[suit].d && Cards.SUITS[suit].frame);
    const rey = Cards.faceSvg({ num: 12, suit });
    assert.ok(rey.includes(Cards.SUITS[suit].c), `rey de ${suit}`);
  }
});

test('las cartas distintas generan dibujos distintos', () => {
  const seen = new Set(T.makeDeck().map((c) => Cards.faceSvg(c)));
  assert.equal(seen.size, 40);
});
