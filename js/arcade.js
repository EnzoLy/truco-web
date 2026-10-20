/* Modo arcade: una run infinita contra bots con personalidad, monedas, tienda y amuletos.
 * Funciones puras: cada una devuelve una run nueva y no toca la que recibe. Nada de DOM aca. */
(function (root, factory) {
  const engine = root.Truco || (typeof require === 'function' ? require('./engine.js') : null);
  const api = factory(engine);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TrucoArcade = api;
})(typeof self !== 'undefined' ? self : this, function (T) {
  'use strict';

  const RUN_VERSION = 1;
  const HUMAN = 0;
  const RIVAL = 1;
  const START_COINS = 4;
  const WIN_REWARD = 4;
  const HAND_COIN = 1;
  const ENVIDO_COIN = 1;
  const INTEREST_STEP = 5; // 1 moneda de interes cada 5 ahorradas
  const INTEREST_CAP = 5;
  const MAX_AMULETS = 5;
  const SHOP_AMULETS = 3;
  const SHOP_UPGRADES = 2;
  const REROLL_BASE = 2;
  const BOSS_EVERY = 4;
  const UPGRADE_PRICE = 3;
  const FILO_STEP = 3;
  const MAX_UPGRADED_RANK = 13.5; // entre el ancho de basto y el de espada
  const BRILLO_ENVIDO = 7;
  const BASE_SAMPLES = 60;
  const SAMPLES_PER_ROUND = 15;
  const MAX_SAMPLES = 200;

  class ArcadeError extends Error {}

  const clone = (o) => structuredClone(o);
  const pick = (list, rng) => list[Math.floor(rng() * list.length)];

  // ---------- catalogo ----------

  const SUIT_NAMES = { espada: 'espada', basto: 'basto', oro: 'oro', copa: 'copa' };
  const cardName = (card) => `${card.num} de ${SUIT_NAMES[card.suit]}`;
  const parseKey = (key) => {
    const m = /^(\d+)(espada|basto|oro|copa)$/.exec(key);
    return m ? { num: Number(m[1]), suit: m[2] } : null;
  };

  const figures = () => Object.fromEntries(
    T.makeDeck().filter((c) => c.num >= 10).map((c) => [T.cardKey(c), { envido: 3 }]),
  );

  /** kind: puntaje | economia | cartas | info. mods van al motor; econ lo usa la economia de la run. */
  const AMULETS = {
    'pico-de-oro': { name: 'Pico de oro', desc: '+1 punto cada vez que ganás una mano con truco.', price: 6, kind: 'puntaje', mods: { trucoBonus: 1 } },
    cantor: { name: 'Cantor', desc: '+1 punto cada vez que ganás un envido.', price: 5, kind: 'puntaje', mods: { envidoBonus: 1 } },
    garganta: { name: 'Garganta de lata', desc: 'Sumás +2 al contar tu envido.', price: 6, kind: 'puntaje', mods: { envidoCountBonus: 2 } },
    flor: { name: 'Flor', desc: 'Podés cantar flor (tres cartas del mismo palo): 3 puntos y se anula el envido. Sin este amuleto no hay flor.', price: 5, kind: 'puntaje', mods: { flor: true } },
    alcancia: { name: 'Alcancía', desc: 'El interés puede llegar hasta 10 monedas.', price: 4, kind: 'economia', econ: { interestCap: 5 } },
    propina: { name: 'Propina', desc: '+1 moneda por cada mano que ganás.', price: 5, kind: 'economia', econ: { handCoin: 1 } },
    cuentero: { name: 'Cuentero', desc: '+2 monedas por cada envido que ganás.', price: 4, kind: 'economia', econ: { envidoCoin: 2 } },
    'sietes-bravos': { name: 'Sietes bravos', desc: 'El 7 de copa y el 7 de basto matan como un 3.', price: 6, kind: 'cartas', mods: { upgrades: { '7copa': { rank: 10 }, '7basto': { rank: 10 } } } },
    'ancho-falso': { name: 'Ancho falso', desc: 'El 1 de oro y el 1 de copa valen como el ancho de basto.', price: 8, kind: 'cartas', mods: { upgrades: { '1oro': { rank: 13 }, '1copa': { rank: 13 } } } },
    figuras: { name: 'Figuras con onda', desc: 'El 10, el 11 y el 12 valen 3 para el envido.', price: 6, kind: 'cartas', mods: { upgrades: figures() } },
    espejito: { name: 'Espejito', desc: 'Ves la primera carta que recibió el rival.', price: 5, kind: 'info', mods: { peek: 'one' } },
    'oido-fino': { name: 'Oído fino', desc: 'Sabés si el rival tiene más de 27 de envido.', price: 3, kind: 'info', mods: { envidoHint: true } },
    'bola-de-cristal': { name: 'Bola de cristal', desc: 'Ves toda la mano del rival.', price: 14, kind: 'info', mods: { peek: 'all' } },
  };
  const AMULET_IDS = Object.keys(AMULETS);
  // Los rivales solo llevan amuletos de puntaje y cartas: la economia no les sirve y el bot no lee pistas.
  // La flor es solo tuya: el bot no la sabe cantar.
  const RIVAL_AMULETS = AMULET_IDS.filter((id) => id !== 'flor' && ['puntaje', 'cartas'].includes(AMULETS[id].kind));

  const PERSONALITIES = {
    equilibrado: { name: 'El Profe', desc: 'Juega derecho, sin sorpresas.', traits: {} },
    mentiroso: {
      name: 'El Chamuyero', desc: 'Miente seguido: canta con cualquier cosa.',
      traits: { bluffTruco: 3, bluffTrucoBase: 0.2, bluffEnvido: 2, bluffEnvidoBase: 0.15 },
    },
    conservador: {
      name: 'Doña Prudencia', desc: 'Juega seguro: solo canta con buena mano.',
      traits: { trucoThreshold: 0.74, bluffTruco: 0.2, bluffEnvido: 0.2, acceptShift: 0.2, envidoAcceptShift: 2 },
    },
    cargado: { name: 'El Coleccionista', desc: 'Llega a la mesa con amuletos propios.', traits: {}, amulets: true },
    tramposo: { name: 'El Tahúr', desc: 'Hace trampa: ve tus cartas.', traits: {}, cheat: true, boss: true },
  };
  const PERSONALITY_IDS = Object.keys(PERSONALITIES);
  const COMMON_RIVALS = ['equilibrado', 'mentiroso', 'conservador'];

  // ---------- rivales ----------

  const isBossRound = (round) => round % BOSS_EVERY === 0;

  function rivalAmulets(count, rng) {
    const pool = RIVAL_AMULETS.slice();
    const out = [];
    while (out.length < count && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    return out;
  }

  /** Rival de la ronda: los jefes (cada 4) hacen trampa o vienen cargados. */
  function rivalFor(round, rng) {
    const boss = isBossRound(round);
    let id;
    if (boss) id = rng() < 0.5 ? 'tramposo' : 'cargado';
    else if (round >= 2 && rng() < 0.25) id = 'cargado';
    else id = pick(COMMON_RIVALS, rng);
    const p = PERSONALITIES[id];
    const extra = Math.floor(round / BOSS_EVERY);
    const amuletCount = p.amulets ? (boss ? 2 : 1) + extra : 0;
    return {
      id,
      name: p.name,
      desc: p.desc,
      boss,
      cheat: Boolean(p.cheat),
      traits: { ...p.traits },
      amulets: rivalAmulets(amuletCount, rng),
      samples: Math.min(BASE_SAMPLES + SAMPLES_PER_ROUND * round, MAX_SAMPLES),
    };
  }

  // ---------- mods y economia ----------

  const PEEK_ORDER = [undefined, 'one', 'all'];

  function mergeUpgrades(a = {}, b = {}) {
    const out = clone(a);
    for (const [key, up] of Object.entries(b)) {
      const cur = out[key] || {};
      const next = { ...cur };
      for (const [field, value] of Object.entries(up)) next[field] = Math.max(cur[field] ?? -Infinity, value);
      out[key] = next;
    }
    return out;
  }

  /** Junta varios mods: numeros se suman, peek se queda con el mas fuerte, mejoras con el maximo. */
  function combineMods(list) {
    const out = {};
    for (const m of list) {
      if (!m) continue;
      for (const [field, value] of Object.entries(m)) {
        if (field === 'upgrades') out.upgrades = mergeUpgrades(out.upgrades, value);
        else if (field === 'peek') out.peek = PEEK_ORDER.indexOf(value) > PEEK_ORDER.indexOf(out.peek) ? value : out.peek;
        else if (typeof value === 'number') out[field] = (out[field] || 0) + value;
        else if (value === true) out[field] = true;
      }
    }
    return out;
  }

  const amuletMods = (ids) => ids.map((id) => AMULETS[id] && AMULETS[id].mods);

  /** Mods del motor para la partida actual: [vos, rival]. */
  function modsFor(run) {
    const mine = combineMods([...amuletMods(run.amulets), { upgrades: run.upgrades }]);
    const theirs = combineMods([...amuletMods(run.rival.amulets), run.rival.cheat ? { peek: 'all' } : null]);
    return [mine, theirs];
  }

  function econOf(run) {
    const base = { handCoin: HAND_COIN, envidoCoin: ENVIDO_COIN, interestCap: INTEREST_CAP };
    for (const id of run.amulets) {
      const econ = AMULETS[id] && AMULETS[id].econ;
      if (econ) for (const [k, v] of Object.entries(econ)) base[k] += v;
    }
    return base;
  }

  const interestOf = (run) => Math.min(Math.floor(run.coins / INTEREST_STEP), econOf(run).interestCap);
  const winReward = (round) => WIN_REWARD + Math.floor(round / 2);

  // ---------- run ----------

  function newRun(rng, { best = 0 } = {}) {
    return {
      v: RUN_VERSION,
      phase: 'match', // match | shop | over
      round: 1,
      wins: 0,
      coins: START_COINS,
      amulets: [],
      upgrades: {},
      rival: rivalFor(1, rng),
      shop: null,
      match: null,
      best,
    };
  }

  /** Opciones para Truco.newGame de la partida actual. */
  const matchOptions = (run) => ({ mods: modsFor(run) });

  function withMatch(run, match) {
    return { ...run, match: clone(match) };
  }

  /** Aplica los eventos del motor a la run: monedas, fin de partida. Devuelve { run, gains }. */
  function onEvents(prev, events, rng) {
    let run = clone(prev);
    const gains = [];
    const econ = econOf(run);
    const gain = (amount, reason) => {
      if (amount <= 0) return;
      run.coins += amount;
      gains.push({ amount, reason });
    };
    for (const ev of events) {
      if (ev.type === 'hand-end' && ev.winner === HUMAN) gain(econ.handCoin, 'mano');
      else if (ev.type === 'envido-result' && ev.winner === HUMAN) gain(econ.envidoCoin, 'envido');
      else if (ev.type === 'flor' && ev.by === HUMAN) gain(econ.envidoCoin, 'flor');
      else if (ev.type === 'game-end') run = finishMatch(run, ev.winner === HUMAN, gain, rng);
    }
    return { run, gains };
  }

  function finishMatch(run, won, gain, rng) {
    if (!won) {
      return { ...run, phase: 'over', match: null, best: Math.max(run.best, run.wins) };
    }
    const interest = interestOf(run);
    gain(winReward(run.round), 'victoria');
    gain(interest, 'interés');
    // Las mejoras de cartas valen para una sola partida: se gastan al terminarla.
    const next = { ...run, wins: run.wins + 1, phase: 'shop', match: null, upgrades: {} };
    next.best = Math.max(next.best, next.wins);
    return rollShop(next, rng, 0);
  }

  // ---------- tienda ----------

  function upgradeOffer(run, rng, taken) {
    const deck = T.makeDeck().filter((c) => !taken.has(T.cardKey(c)));
    // Lo que ya vale la carta, contando mejoras compradas y amuletos de cartas.
    const owned = combineMods([...amuletMods(run.amulets), { upgrades: run.upgrades }]).upgrades || {};
    for (let tries = 0; tries < 20; tries++) {
      const card = pick(deck, rng);
      const key = T.cardKey(card);
      const current = { ...card, up: owned[key] };
      const rank = T.rankOf(current);
      const envido = T.envidoPoints([current]);
      if (rng() < 0.5 && rank < MAX_UPGRADED_RANK) {
        const value = Math.min(rank + FILO_STEP, MAX_UPGRADED_RANK);
        return { type: 'upgrade', key, field: 'rank', value, price: UPGRADE_PRICE, name: `Filo: ${cardName(card)}`, desc: `El ${cardName(card)} mata más fuerte en el truco. Solo la próxima partida.` };
      }
      if (envido < BRILLO_ENVIDO) {
        return { type: 'upgrade', key, field: 'envido', value: BRILLO_ENVIDO, price: UPGRADE_PRICE, name: `Brillo: ${cardName(card)}`, desc: `El ${cardName(card)} vale 7 para el envido. Solo la próxima partida.` };
      }
    }
    return null;
  }

  function rollShop(run, rng, rerolls = 0) {
    const owned = new Set(run.amulets);
    const pool = AMULET_IDS.filter((id) => !owned.has(id));
    const items = [];
    while (items.length < SHOP_AMULETS && pool.length) {
      const id = pool.splice(Math.floor(rng() * pool.length), 1)[0];
      items.push({ type: 'amulet', id, price: AMULETS[id].price });
    }
    const taken = new Set();
    for (let i = 0; i < SHOP_UPGRADES; i++) {
      const offer = upgradeOffer(run, rng, taken);
      if (!offer) continue;
      taken.add(offer.key);
      items.push(offer);
    }
    return { ...run, shop: { items, rerolls } };
  }

  const rerollCost = (run) => REROLL_BASE + (run.shop ? run.shop.rerolls : 0);

  function requireShop(run) {
    if (run.phase !== 'shop' || !run.shop) throw new ArcadeError('La tienda está cerrada');
  }

  /** Por que no se puede comprar el item (o null si se puede). */
  function cantBuy(run, index) {
    if (run.phase !== 'shop' || !run.shop) return 'La tienda está cerrada';
    const item = run.shop.items[index];
    if (!item || item.sold) return 'Ese artículo ya no está';
    if (run.coins < item.price) return 'No te alcanzan las monedas';
    if (item.type === 'amulet' && run.amulets.length >= MAX_AMULETS) return `Ya tenés ${MAX_AMULETS} amuletos: vendé uno`;
    return null;
  }

  function buy(run, index) {
    const reason = cantBuy(run, index);
    if (reason) throw new ArcadeError(reason);
    const item = run.shop.items[index];
    const items = run.shop.items.map((it, i) => (i === index ? { ...it, sold: true } : it));
    const next = { ...run, coins: run.coins - item.price, shop: { ...run.shop, items } };
    if (item.type === 'amulet') next.amulets = [...run.amulets, item.id];
    else next.upgrades = mergeUpgrades(run.upgrades, { [item.key]: { [item.field]: item.value } });
    return next;
  }

  const sellPrice = (id) => Math.max(1, Math.floor(AMULETS[id].price / 2));

  function sell(run, id) {
    requireShop(run);
    const i = run.amulets.indexOf(id);
    if (i < 0) throw new ArcadeError('No tenés ese amuleto');
    return { ...run, coins: run.coins + sellPrice(id), amulets: run.amulets.filter((_, k) => k !== i) };
  }

  function reroll(run, rng) {
    requireShop(run);
    const cost = rerollCost(run);
    if (run.coins < cost) throw new ArcadeError('No te alcanzan las monedas');
    return rollShop({ ...run, coins: run.coins - cost }, rng, run.shop.rerolls + 1);
  }

  /** Sale de la tienda y arma la ronda siguiente. */
  function leaveShop(run, rng) {
    requireShop(run);
    const round = run.round + 1;
    return { ...run, phase: 'match', round, rival: rivalFor(round, rng), shop: null, match: null };
  }

  return {
    RUN_VERSION, MAX_AMULETS, BOSS_EVERY, AMULETS, AMULET_IDS, PERSONALITIES, PERSONALITY_IDS,
    ArcadeError, cardName, parseKey, isBossRound, rivalFor, combineMods, modsFor, econOf, interestOf, winReward,
    newRun, matchOptions, withMatch, onEvents, rollShop, rerollCost, cantBuy, buy, sell, sellPrice, reroll, leaveShop,
  };
});
