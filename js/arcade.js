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
  // Dúo: vos 0, rival A 1, compañero 2, rival B 3. Tu equipo es el 0.
  const DUO = 'duo';
  const MY_TEAM = 0;
  // Dúo con un amigo (coop): la run tiene run.partner y el compañero (asiento 2) compra sus propios amuletos.
  const PARTNER = 2;
  const SEAT_OF = { me: HUMAN, partner: PARTNER };
  const START_COINS = 4;
  const WIN_REWARD = 4;
  const HAND_COIN = 1;
  const ENVIDO_COIN = 1;
  const INTEREST_STEP = 5; // 1 moneda de interes cada 5 ahorradas
  const INTEREST_CAP = 5;
  const MAX_AMULETS = 5;
  const SHOP_AMULETS = 3;
  const SHOP_UPGRADES = 2;
  const REROLL_BASE = 3;
  const BOSS_EVERY = 4;
  const UPGRADE_PRICE = 4;
  const FILO_STEP = 3;
  const MAX_UPGRADED_RANK = 13.5; // entre el ancho de basto y el de espada
  const BRILLO_ENVIDO = 7;
  const BOLA_EVERY = 3; // la bola de cristal muestra la mano del rival en una de cada 3 manos
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

  /** kind: puntaje | economia | cartas | info. mods van al motor; econ lo usa la economia de la run.
   *  Precios según cuánto suben la chance de ganar (simulación bot contra bot, base 52%): una partida ganada
   *  paga ~27 monedas, así que cada tienda obliga a elegir. */
  const AMULETS = {
    'pico-de-oro': { name: 'Pico de oro', desc: '+1 punto cada vez que ganás una mano con truco.', price: 12, kind: 'puntaje', mods: { trucoBonus: 1 } },
    cantor: { name: 'Cantor', desc: '+1 punto cada vez que ganás un envido.', price: 11, kind: 'puntaje', mods: { envidoBonus: 1 } },
    garganta: { name: 'Garganta de lata', desc: 'Sumás +1 al contar tu envido.', price: 8, kind: 'puntaje', mods: { envidoCountBonus: 1 } },
    flor: { name: 'Flor', desc: 'Podés cantar flor (tres cartas del mismo palo): 3 puntos y se anula el envido. Sin este amuleto no hay flor.', price: 10, kind: 'puntaje', mods: { flor: true } },
    alcancia: { name: 'Alcancía', desc: 'El interés puede llegar hasta 10 monedas.', price: 8, kind: 'economia', econ: { interestCap: 5 } },
    propina: { name: 'Propina', desc: '+1 moneda por cada mano que ganás.', price: 15, kind: 'economia', econ: { handCoin: 1 } },
    cuentero: { name: 'Cuentero', desc: '+2 monedas por cada envido que ganás.', price: 9, kind: 'economia', econ: { envidoCoin: 2 } },
    'sietes-bravos': { name: 'Sietes bravos', desc: 'El 7 de copa y el 7 de basto matan como un 3.', price: 10, kind: 'cartas', mods: { upgrades: { '7copa': { rank: 10 }, '7basto': { rank: 10 } } } },
    'ancho-falso': { name: 'Ancho falso', desc: 'El 1 de oro y el 1 de copa valen como el ancho de basto.', price: 8, kind: 'cartas', mods: { upgrades: { '1oro': { rank: 13 }, '1copa': { rank: 13 } } } },
    figuras: { name: 'Figuras con onda', desc: 'El 10, el 11 y el 12 valen 3 para el envido.', price: 9, kind: 'cartas', mods: { upgrades: figures() } },
    espejito: { name: 'Espejito', desc: 'Ves la primera carta que recibió el rival.', price: 7, kind: 'info', mods: { peek: 'one' } },
    'oido-fino': { name: 'Oído fino', desc: 'Sabés si el rival tiene más de 27 de envido.', price: 5, kind: 'info', mods: { envidoHint: true } },
    'bola-de-cristal': { name: 'Bola de cristal', desc: 'Cada 3 manos ves la mano completa del rival.', price: 16, kind: 'info', mods: { peekEvery: BOLA_EVERY } },
  };
  const AMULET_IDS = Object.keys(AMULETS);
  // Los rivales solo llevan amuletos de puntaje y cartas: la economia no les sirve y el bot no lee pistas.
  // La flor es solo tuya: el bot no la sabe cantar.
  const RIVAL_AMULETS = AMULET_IDS.filter((id) => id !== 'flor' && ['puntaje', 'cartas'].includes(AMULETS[id].kind));

  // traits: bot 1v1 (bot.js). duoTraits: bot de salas (room-bot.js), para el dúo.
  const PERSONALITIES = {
    equilibrado: { name: 'El Profe', desc: 'Juega derecho, sin sorpresas.', traits: {}, duoTraits: {} },
    mentiroso: {
      name: 'El Chamuyero', desc: 'Miente seguido: canta con cualquier cosa.',
      traits: { bluffTruco: 3, bluffTrucoBase: 0.2, bluffEnvido: 2, bluffEnvidoBase: 0.15 },
      duoTraits: { bluffCall: 0.3, acceptBluff: 0.5, envidoBluff: 0.25, envidoShift: -3 },
    },
    conservador: {
      name: 'Doña Prudencia', desc: 'Juega seguro: solo canta con buena mano.',
      traits: { trucoThreshold: 0.74, bluffTruco: 0.2, bluffEnvido: 0.2, acceptShift: 0.2, envidoAcceptShift: 2 },
      duoTraits: { trucoShift: 1, envidoShift: 2, callChance: 0.4, bluffCall: 0.01, acceptBluff: 0.1, envidoBluff: 0.02 },
    },
    cargado: { name: 'El Coleccionista', desc: 'Llega a la mesa con amuletos propios.', traits: {}, duoTraits: {}, amulets: true },
    tramposo: {
      name: 'El Tahúr', desc: 'Hace trampa: ve tus cartas.', duoDesc: 'Hace trampa: ve tus cartas y las de tu compañero.',
      traits: {}, duoTraits: {}, cheat: true, boss: true,
    },
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

  function buildRival(id, round, rng, boss, duo = false) {
    const p = PERSONALITIES[id];
    const extra = Math.floor(round / BOSS_EVERY);
    const amuletCount = p.amulets ? (boss ? 2 : 1) + extra : 0;
    return {
      id,
      name: p.name,
      desc: duo && p.duoDesc ? p.duoDesc : p.desc,
      boss,
      cheat: Boolean(p.cheat),
      traits: { ...(duo ? p.duoTraits : p.traits) },
      amulets: rivalAmulets(amuletCount, rng),
      samples: Math.min(BASE_SAMPLES + SAMPLES_PER_ROUND * round, MAX_SAMPLES),
    };
  }

  /** Rival de la ronda: los jefes (cada 4) hacen trampa o vienen cargados. */
  function rivalFor(round, rng) {
    const boss = isBossRound(round);
    let id;
    if (boss) id = rng() < 0.5 ? 'tramposo' : 'cargado';
    else if (round >= 2 && rng() < 0.25) id = 'cargado';
    else id = pick(COMMON_RIVALS, rng);
    return buildRival(id, round, rng, boss);
  }

  /** Los dos rivales del dúo, siempre con personalidades distintas. El jefe es un Tahúr con un Coleccionista. */
  function rivalsFor(round, rng) {
    const boss = isBossRound(round);
    let ids;
    if (boss) {
      ids = rng() < 0.5 ? ['tramposo', 'cargado'] : ['cargado', 'tramposo'];
    } else {
      const first = round >= 2 && rng() < 0.25 ? 'cargado' : pick(COMMON_RIVALS, rng);
      ids = [first, pick(COMMON_RIVALS.filter((id) => id !== first), rng)];
    }
    return ids.map((id) => buildRival(id, round, rng, boss, true));
  }

  const isDuo = (run) => run.mode === DUO;
  const isCoop = (run) => isDuo(run) && Boolean(run.partner);

  /** Amuletos y mejoras de cada uno: 'me' (asiento 0) o 'partner' (el amigo del dúo, asiento 2). */
  function kitOf(run, who = 'me') {
    if (who === 'partner') {
      if (!isCoop(run)) throw new ArcadeError('No hay compañero en esta run');
      return { amulets: run.partner.amulets, upgrades: run.partner.upgrades };
    }
    return { amulets: run.amulets, upgrades: run.upgrades };
  }

  const withKit = (run, who, kit) => (who === 'partner' ? { ...run, partner: { ...run.partner, ...kit } } : { ...run, ...kit });

  /** Quienes compran en esta run: solo vos, o vos y tu amigo. */
  const buyersOf = (run) => (isCoop(run) ? ['me', 'partner'] : ['me']);

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

  const rivalMods = (rival) => combineMods([...amuletMods(rival.amulets), rival.cheat ? { peek: 'all' } : null]);

  const kitMods = (kit) => combineMods([...amuletMods(kit.amulets), { upgrades: kit.upgrades }]);

  /** Mods del motor para la partida actual: [vos, rival], o en el dúo [vos, rival A, compañero, rival B].
   *  El compañero bot no lleva nada; el amigo del dúo lleva lo suyo. */
  function modsFor(run) {
    const mine = kitMods(kitOf(run));
    if (isDuo(run)) return [mine, rivalMods(run.rivals[0]), isCoop(run) ? kitMods(kitOf(run, 'partner')) : {}, rivalMods(run.rivals[1])];
    return [mine, rivalMods(run.rival)];
  }

  function econOf(run, who = 'me') {
    const base = { handCoin: HAND_COIN, envidoCoin: ENVIDO_COIN, interestCap: INTEREST_CAP };
    for (const id of kitOf(run, who).amulets) {
      const econ = AMULETS[id] && AMULETS[id].econ;
      if (econ) for (const [k, v] of Object.entries(econ)) base[k] += v;
    }
    return base;
  }

  // La bolsa es una sola: el tope de interés es el más alto de los dos (la alcancía de cualquiera sirve).
  const interestCapOf = (run) => Math.max(...buyersOf(run).map((who) => econOf(run, who).interestCap));
  const interestOf = (run) => Math.min(Math.floor(run.coins / INTEREST_STEP), interestCapOf(run));
  const winReward = (round) => WIN_REWARD + Math.floor(round / 2);

  // ---------- run ----------

  /** mode: 'solo' (contra un bot, motor 1v1) o 'duo' (con compañero, motor de salas en 'dupla'). */
  function newRun(rng, { best = 0, mode = 'solo', coop = false, partnerName = 'Compañero' } = {}) {
    const run = {
      v: RUN_VERSION,
      phase: 'match', // match | shop | over
      round: 1,
      wins: 0,
      coins: START_COINS,
      amulets: [],
      upgrades: {},
      shop: null,
      match: null,
      best,
    };
    if (mode === DUO && coop) return { ...run, mode: DUO, rivals: rivalsFor(1, rng), partner: { name: partnerName, amulets: [], upgrades: {} } };
    if (mode === DUO) return { ...run, mode: DUO, rivals: rivalsFor(1, rng) };
    return { ...run, rival: rivalFor(1, rng) };
  }

  /** Opciones para Truco.newGame (solo) o TrucoRoom.newGame('dupla', ...) (dúo) de la partida actual. */
  const matchOptions = (run) => ({ mods: modsFor(run) });

  function withMatch(run, match) {
    return { ...run, match: clone(match) };
  }

  /** Aplica los eventos del motor a la run: monedas, fin de partida. Devuelve { run, gains }. */
  function onEvents(prev, events, rng) {
    let run = clone(prev);
    const gains = [];
    const econ = econOf(run);
    const gain = (amount, reason, seat = HUMAN) => {
      if (amount <= 0) return;
      run.coins += amount;
      gains.push({ amount, reason, seat });
    };
    if (isDuo(run)) {
      const owners = buyersOf(run).map((who) => ({ seat: SEAT_OF[who], econ: econOf(run, who) }));
      for (const ev of events) {
        if (ev.type === 'game-end') run = finishMatch(run, ev.winners.includes(HUMAN), gain, rng);
        else duoGains(ev, owners, gain);
      }
      return { run, gains };
    }
    for (const ev of events) {
      if (ev.type === 'hand-end' && ev.winner === HUMAN) gain(econ.handCoin, 'mano');
      else if (ev.type === 'envido-result' && ev.winner === HUMAN) gain(econ.envidoCoin, 'envido');
      else if (ev.type === 'flor' && ev.by === HUMAN) gain(econ.envidoCoin, 'flor');
      else if (ev.type === 'game-end') run = finishMatch(run, ev.winner === HUMAN, gain, rng);
    }
    return { run, gains };
  }

  /** Dúo: la base la cobra el equipo una vez; lo extra de los amuletos de cada uno, solo si el punto fue suyo.
   *  owners: [{ seat, econ }] de quienes tienen amuletos (vos, y tu amigo en el coop). */
  function duoGains(ev, owners, gain) {
    if (ev.winner !== MY_TEAM) return;
    if (ev.type === 'hand-end') {
      gain(HAND_COIN, 'mano');
      for (const o of owners) if ((ev.trickSeats || []).includes(o.seat)) gain(o.econ.handCoin - HAND_COIN, 'propina', o.seat);
    } else if (ev.type === 'envido-result') {
      gain(ENVIDO_COIN, 'envido');
      for (const o of owners) if (ev.ownerSeat === o.seat) gain(o.econ.envidoCoin - ENVIDO_COIN, 'cuentero', o.seat);
    } else if (ev.type === 'flor-result') {
      for (const o of owners) if ((ev.callers || []).includes(o.seat)) gain(o.econ.envidoCoin, 'flor', o.seat);
    }
  }

  function finishMatch(run, won, gain, rng) {
    if (!won) {
      return { ...run, phase: 'over', match: null, best: Math.max(run.best, run.wins) };
    }
    const interest = interestOf(run);
    gain(winReward(run.round), 'victoria');
    gain(interest, 'interés');
    // Las mejoras de cartas valen para una sola partida: se gastan al terminarla.
    let next = { ...run, wins: run.wins + 1, phase: 'shop', match: null, upgrades: {} };
    if (isCoop(run)) next = withKit(next, 'partner', { upgrades: {} });
    next.best = Math.max(next.best, next.wins);
    return rollShop(next, rng, 0);
  }

  // ---------- tienda ----------

  // A qué carta equivale cada valor de jerarquía del truco (14 = ancho de espada ... 1 = un 4).
  const RANK_TEXT = {
    14: 'el ancho de espada', 13: 'el ancho de basto', 12: 'el 7 de espada', 11: 'el 7 de oro',
    10: 'un 3', 9: 'un 2', 8: 'un 1 de oro o copa', 7: 'un 12', 6: 'un 11', 5: 'un 10',
    4: 'un 7 de copa o basto', 3: 'un 6', 2: 'un 5', 1: 'un 4',
  };

  /** Texto de una mejora de truco: "mata como un 3". El tope (13.5) queda entre los dos anchos. */
  function rankText(rank) {
    if (RANK_TEXT[rank]) return `mata como ${RANK_TEXT[rank]}`;
    return 'le gana a todo menos al ancho de espada';
  }

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
        return { type: 'upgrade', key, field: 'rank', value, price: UPGRADE_PRICE, name: `Filo: ${cardName(card)}`, desc: `En el truco, el ${cardName(card)} ${rankText(value)}. Solo la próxima partida.` };
      }
      if (envido < BRILLO_ENVIDO) {
        return { type: 'upgrade', key, field: 'envido', value: BRILLO_ENVIDO, price: UPGRADE_PRICE, name: `Brillo: ${cardName(card)}`, desc: `El ${cardName(card)} vale 7 para el envido. Solo la próxima partida.` };
      }
    }
    return null;
  }

  function rollShop(run, rng, rerolls = 0) {
    const owned = new Set(buyersOf(run).flatMap((who) => kitOf(run, who).amulets));
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
  function cantBuy(run, index, who = 'me') {
    if (run.phase !== 'shop' || !run.shop) return 'La tienda está cerrada';
    const item = run.shop.items[index];
    if (!item || item.sold) return 'Ese artículo ya no está';
    if (run.coins < item.price) return 'No te alcanzan las monedas';
    if (item.type === 'amulet' && kitOf(run, who).amulets.length >= MAX_AMULETS) return `Ya tenés ${MAX_AMULETS} amuletos: vendé uno`;
    return null;
  }

  /** who: quién compra ('me' o, en el dúo con amigo, 'partner'). Las monedas salen de la bolsa común. */
  function buy(run, index, who = 'me') {
    const reason = cantBuy(run, index, who);
    if (reason) throw new ArcadeError(reason);
    const item = run.shop.items[index];
    const kit = kitOf(run, who);
    const items = run.shop.items.map((it, i) => (i === index ? { ...it, sold: true } : it));
    const paid = { ...run, coins: run.coins - item.price, shop: { ...run.shop, items } };
    if (item.type === 'amulet') return withKit(paid, who, { amulets: [...kit.amulets, item.id] });
    return withKit(paid, who, { upgrades: mergeUpgrades(kit.upgrades, { [item.key]: { [item.field]: item.value } }) });
  }

  const sellPrice = (id) => Math.max(1, Math.floor(AMULETS[id].price / 2));

  function sell(run, id, who = 'me') {
    requireShop(run);
    const { amulets } = kitOf(run, who);
    const i = amulets.indexOf(id);
    if (i < 0) throw new ArcadeError('No tenés ese amuleto');
    return withKit({ ...run, coins: run.coins + sellPrice(id) }, who, { amulets: amulets.filter((_, k) => k !== i) });
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
    const rivals = isDuo(run) ? { rivals: rivalsFor(round, rng) } : { rival: rivalFor(round, rng) };
    return { ...run, phase: 'match', round, ...rivals, shop: null, match: null };
  }

  return {
    RUN_VERSION, MAX_AMULETS, BOSS_EVERY, AMULETS, AMULET_IDS, PERSONALITIES, PERSONALITY_IDS,
    DUO, PARTNER, ArcadeError, isCoop, kitOf, cardName, parseKey, rankText, isBossRound, isDuo, rivalFor, rivalsFor, combineMods, modsFor, econOf, interestOf, winReward,
    newRun, matchOptions, withMatch, onEvents, rollShop, rerollCost, cantBuy, buy, sell, sellPrice, reroll, leaveShop,
  };
});
