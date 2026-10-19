/* Bot para llenar asientos de las salas. Decide con la vista de su asiento (viewFor de room-engine).
 * Cuando el servidor se lo permite (view.partners), ve las cartas de sus companeros y juega como equipo:
 * acepta o canta truco y envido segun lo que tiene todo el equipo, y deja ganar al companero. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.TrucoRoomBot = factory(root.Truco);
})(typeof self !== 'undefined' ? self : this, function (Truco) {
  'use strict';

  const { rankOf, envidoPoints } = Truco;
  const TOP_CARDS = 3; // en una mano se juegan, como mucho, 3 cartas por equipo
  const ENVIDO_CALL = 27;
  const ENVIDO_ACCEPT = 24;
  const ENVIDO_REAL = 30;
  const TRUCO_CALL_POWER = 4;
  const TRUCO_RAISE_POWER = 6.5;
  const ACCEPT_POWER = [0, 2.5, 3.5, 4.5]; // segun el nivel que cantan: truco, retruco, vale cuatro
  const ACCEPT_BLUFF = 0.3;
  const POOLED_EXTRA = 0.8; // con las cartas de un companero a la vista el equipo siempre junta mas: se exige un poco mas
  const CALL_CHANCE = 0.55;
  const RAISE_CHANCE = 0.5;
  const BLUFF_CALL = 0.06;
  const ASK_FLOR_CHANCE = 0.12;
  const FLOR_ACCEPT = { flor: 28, contraflor: 32, resto: 35 }; // puntos de flor que pide segun lo que le cantan
  const FLOR_CONTRA = 35;
  const FLOR_RESTO = 37;
  const FLOR_BLUFF = 0.1;
  const FLOR_OVERRIDE = 0.9;

  const has = (view, type, what) => view.legal.some((a) => a.type === type && (what === undefined || a.what === what));

  /** Valor de una carta para ganar bazas: las cuatro mejores valen mucho, el resto casi nada. */
  function cardPower(card) {
    const rank = rankOf(card);
    if (rank >= 13) return 3;
    if (rank >= 11) return 2.5;
    if (rank === 10) return 2;
    if (rank === 9) return 1.5;
    if (rank === 8) return 1;
    return rank >= 6 ? 0.3 : 0;
  }

  const partnerHands = (view) => (view.partners || []).map((p) => p.hand);

  /** Poder del equipo: las mejores cartas que le quedan entre todos los companeros. */
  function teamPower(view) {
    const cards = [...view.hand, ...partnerHands(view).flat()];
    return cards.map(cardPower).sort((a, b) => b - a).slice(0, TOP_CARDS).reduce((t, v) => t + v, 0);
  }

  /** Mejor envido que puede mostrar el equipo (el propio y el de los companeros). */
  function teamEnvido(view) {
    const own = view.myEnvido ?? 0;
    const partners = (view.partners || []).map((p) => envidoPoints(p.dealt));
    return Math.max(own, ...partners);
  }

  const florCards = (cards) => cards.length === 3 && cards.every((c) => c.suit === cards[0].suit);
  const florOf = (cards) => (florCards(cards) ? 20 + cards.reduce((t, c) => t + (c.num >= 10 ? 0 : c.num), 0) : 0);

  /** Mejor flor del equipo (la propia y la de los companeros que el bot puede ver). */
  function teamFlor(view) {
    return Math.max(view.myFlor ?? 0, ...(view.partners || []).map((p) => florOf(p.dealt)));
  }

  function respondFlor(view, rng) {
    const points = teamFlor(view);
    const top = view.pending.stack[view.pending.stack.length - 1];
    if (points >= FLOR_RESTO && has(view, 'flor', 'resto') && rng() < 0.25) return { type: 'flor', what: 'resto' };
    if (points >= FLOR_CONTRA && has(view, 'flor', 'contraflor') && rng() < 0.4) return { type: 'flor', what: 'contraflor' };
    if (points >= FLOR_ACCEPT[top] || rng() < FLOR_BLUFF) return { type: 'accept' };
    return { type: 'reject' };
  }

  function chooseDiscard(view) {
    let best = 0;
    let bestScore = -Infinity;
    view.hand.forEach((_, drop) => {
      const rest = view.hand.filter((__, i) => i !== drop);
      const power = rest.map(cardPower).reduce((t, v) => t + v, 0);
      const suits = new Set(rest.map((c) => c.suit));
      const pairBonus = suits.size < rest.length ? 1 : 0;
      const score = power + pairBonus;
      if (score > bestScore) { bestScore = score; best = drop; }
    });
    return { type: 'discard', index: best };
  }

  /** Mejor carta segun la baza en juego; si el companero va ganando, tira la mas baja. */
  function choosePlay(view) {
    const order = view.hand.map((card, index) => ({ index, rank: rankOf(card) })).sort((a, b) => a.rank - b.rank);
    const played = view.cur.cards.map((c, seat) => (c ? { seat, rank: rankOf(c) } : null)).filter(Boolean);
    const lowest = order[0];
    const highest = order[order.length - 1];
    if (!played.length) {
      const first = view.results.length === 0;
      const pick = first && order.length > 1 ? order[order.length - 2] : highest;
      return { type: 'play', index: pick.index };
    }
    const best = played.reduce((a, b) => (b.rank > a.rank ? b : a));
    if (view.teams[best.seat] === view.teams[view.me]) return { type: 'play', index: lowest.index };
    const beater = order.find((c) => c.rank > best.rank);
    return { type: 'play', index: (beater || lowest).index };
  }

  function respondTruco(view, rng) {
    if (has(view, 'flor', 'flor') && rng() < FLOR_OVERRIDE) return { type: 'flor', what: 'flor' };
    const power = teamPower(view);
    const level = view.pending.level;
    if (power >= TRUCO_RAISE_POWER && level < 3 && has(view, 'truco') && rng() < RAISE_CHANCE) return { type: 'truco' };
    const needed = ACCEPT_POWER[level] + ((view.partners || []).length ? POOLED_EXTRA : 0);
    if (power >= needed || rng() < ACCEPT_BLUFF) return { type: 'accept' };
    return { type: 'reject' };
  }

  function respondEnvido(view, rng) {
    if (has(view, 'flor', 'flor') && rng() < FLOR_OVERRIDE) return { type: 'flor', what: 'flor' };
    const points = teamEnvido(view);
    if (points >= ENVIDO_REAL && has(view, 'envido', 'real') && rng() < 0.5) return { type: 'envido', what: 'real' };
    if (points >= ENVIDO_ACCEPT || rng() < 0.08) return { type: 'accept' };
    return { type: 'reject' };
  }

  function play(view, rng) {
    if (has(view, 'flor', 'flor')) return { type: 'flor', what: 'flor' };
    if (has(view, 'ask-flor') && rng() < ASK_FLOR_CHANCE) return { type: 'ask-flor' };
    const points = teamEnvido(view);
    if (has(view, 'envido', 'envido') && points >= ENVIDO_CALL && rng() < 0.7) {
      return { type: 'envido', what: points >= ENVIDO_REAL && rng() < 0.4 ? 'real' : 'envido' };
    }
    if (has(view, 'truco') && ((teamPower(view) >= TRUCO_CALL_POWER && rng() < CALL_CHANCE) || rng() < BLUFF_CALL)) return { type: 'truco' };
    return choosePlay(view);
  }

  /** Devuelve una accion legal para view.me. rng permite pruebas deterministas. */
  function decide(view, rng = Math.random) {
    let action;
    if (view.phase === 'discard') action = chooseDiscard(view);
    else if (view.phase === 'play') action = play(view, rng);
    else if (view.phase === 'respond-truco') action = respondTruco(view, rng);
    else if (view.phase === 'respond-envido') action = respondEnvido(view, rng);
    else if (view.phase === 'respond-flor') action = respondFlor(view, rng);
    const legal = action && view.legal.some((a) => a.type === action.type && a.index === action.index && a.what === action.what);
    return legal ? action : view.legal[0];
  }

  return { decide, teamPower, teamEnvido };
});
