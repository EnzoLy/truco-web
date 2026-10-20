/* Bot para llenar asientos de las salas. Decide con la vista de su asiento (viewFor de room-engine).
 * Cuando el servidor se lo permite (view.partners), ve las cartas de sus companeros y juega como equipo:
 * acepta o canta truco y envido segun lo que tiene todo el equipo, y deja ganar al companero.
 *
 * Personalidad (arcade dúo): decide(view, rng, traits) con ajustes sobre DEFAULT_TRAITS (todos chicos, de -10 a 10).
 * Tramposo: si la vista trae view.oppHands (las manos rivales), juega sabiendo qué tienen. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.TrucoRoomBot = factory(root.Truco);
})(typeof self !== 'undefined' ? self : this, function (Truco) {
  'use strict';

  const { rankOf, envidoPoints, makeDeck, shuffle, withUpgrades } = Truco;
  const TOP_CARDS = 3; // en una mano se juegan, como mucho, 3 cartas por equipo
  const ENVIDO_CALL = 27;
  const ENVIDO_ACCEPT = 24;
  const ENVIDO_REAL = 30;
  const TRUCO_CALL_POWER = 4;
  const TRUCO_RAISE_POWER = 6.5;
  const ACCEPT_POWER = [0, 2.5, 3.5, 4.5]; // segun el nivel que cantan: truco, retruco, vale cuatro
  const POOLED_EXTRA = 0.8; // con las cartas de un companero a la vista el equipo siempre junta mas: se exige un poco mas
  const AVERAGE_RIVAL_POWER = 4.1; // poder promedio de las mejores 3 cartas entre 6 al azar (para el tramposo)
  /** Ajustes de personalidad. trucoShift/envidoShift suben (o bajan) lo que pide para cantar y aceptar. */
  const DEFAULT_TRAITS = Object.freeze({
    trucoShift: 0,
    envidoShift: 0,
    callChance: 0.55,
    raiseChance: 0.5,
    bluffCall: 0.06,
    acceptBluff: 0.3,
    envidoCallChance: 0.7,
    envidoBluff: 0.08,
  });
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

  const topPower = (cards) => cards.map(cardPower).sort((a, b) => b - a).slice(0, TOP_CARDS).reduce((t, v) => t + v, 0);
  const rivalHands = (view) => (view.oppHands || []).map((o) => o.hand);

  // ---------- mejoras de los rivales (view.rivalUpgrades: [{ seat, upgrades }]) ----------
  const keyOf = (c) => `${c.num}${c.suit}`;
  const DECK = makeDeck();
  const DECK_BY_KEY = new Map(DECK.map((c) => [keyOf(c), c]));
  const LIFT_SAMPLES = 120;

  const knownKeys = (view) => new Set([...view.hand, ...partnerHands(view).flat(), ...(view.played || []).flat()].map(keyOf));

  /** Sorteo propio y repetible para medir: no gasta el rng de las decisiones. */
  function seededRng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Poder de más que les dan a los rivales sus cartas mejoradas (Ancho falso, Sietes bravos, Filo), en promedio:
   *  cada carta mejorada que no se vio cuenta según la chance de que la tenga un rival. */
  function rivalPowerLift(view) {
    const rivals = view.rivalUpgrades || [];
    if (!rivals.length) return 0;
    const known = knownKeys(view);
    const unseen = Math.max(1, DECK.length - known.size);
    let lift = 0;
    for (const { seat, upgrades } of rivals) {
      const left = (view.handCounts || [])[seat] || 0;
      for (const [key, up] of Object.entries(upgrades)) {
        const base = DECK_BY_KEY.get(key);
        if (!base || typeof up.rank !== 'number' || known.has(key)) continue;
        lift += (left / unseen) * (cardPower({ ...base, up }) - cardPower(base));
      }
    }
    return lift;
  }

  /** Envido de más que tiene en promedio el mejor rival por sus mejoras (Figuras con onda, Brillo). */
  function rivalEnvidoLift(view) {
    const rivals = (view.rivalUpgrades || []).filter((r) => Object.values(r.upgrades).some((u) => typeof u.envido === 'number'));
    if (!rivals.length) return 0;
    const known = knownKeys(view);
    const pool = DECK.filter((c) => !known.has(keyOf(c)));
    const rng = seededRng((view.handNo || 0) * 31 + view.me);
    const plain = (cards) => cards.map(({ up, ...card }) => card);
    return Math.max(...rivals.map(({ seat, upgrades }) => {
      const shown = (view.played || [])[seat] || [];
      const cards = withUpgrades(pool, upgrades);
      let total = 0;
      for (let i = 0; i < LIFT_SAMPLES; i++) {
        const pick = [...shown, ...shuffle(cards, rng).slice(0, TOP_CARDS - shown.length)];
        total += envidoPoints(pick) - envidoPoints(plain(pick));
      }
      return total / LIFT_SAMPLES;
    }));
  }

  /** Poder del equipo: las mejores cartas que le quedan entre todos los companeros.
   * El tramposo lo mide contra lo que tienen de verdad los rivales en vez de contra un rival promedio.
   * Si los rivales tienen cartas mejoradas, se descuenta lo que eso les suma. */
  function teamPower(view) {
    const own = topPower([...view.hand, ...partnerHands(view).flat()]);
    if (!view.oppHands) return own - rivalPowerLift(view);
    return own - topPower(rivalHands(view).flat()) + AVERAGE_RIVAL_POWER;
  }

  /** Mejor envido que puede mostrar el equipo (el propio y el de los companeros). */
  function teamEnvido(view) {
    const own = view.myEnvido ?? 0;
    const partners = (view.partners || []).map((p) => envidoPoints(p.dealt));
    return Math.max(own, ...partners);
  }

  /** El tramposo sabe si gana el envido: si gana lo canta fuerte, si pierde lo trata como si no tuviera nada. */
  function envidoEdge(view) {
    const ours = teamEnvido(view);
    const full = rivalHands(view).filter((h) => h.length === TOP_CARDS);
    if (!full.length) return ours - rivalEnvidoLift(view);
    const theirs = Math.max(...full.map(envidoPoints));
    return ours >= theirs ? Math.max(ours, ENVIDO_REAL) : 0;
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

  function respondTruco(view, rng, t) {
    if (has(view, 'flor', 'flor') && rng() < FLOR_OVERRIDE) return { type: 'flor', what: 'flor' };
    const power = teamPower(view);
    const level = view.pending.level;
    if (power >= TRUCO_RAISE_POWER + t.trucoShift && level < 3 && has(view, 'truco') && rng() < t.raiseChance) return { type: 'truco' };
    const needed = ACCEPT_POWER[level] + t.trucoShift + ((view.partners || []).length ? POOLED_EXTRA : 0);
    if (power >= needed || rng() < t.acceptBluff) return { type: 'accept' };
    return { type: 'reject' };
  }

  function respondEnvido(view, rng, t) {
    if (has(view, 'flor', 'flor') && rng() < FLOR_OVERRIDE) return { type: 'flor', what: 'flor' };
    const points = envidoEdge(view);
    if (points >= ENVIDO_REAL + t.envidoShift && has(view, 'envido', 'real') && rng() < 0.5) return { type: 'envido', what: 'real' };
    if (points >= ENVIDO_ACCEPT + t.envidoShift || rng() < t.envidoBluff) return { type: 'accept' };
    return { type: 'reject' };
  }

  function play(view, rng, t) {
    if (has(view, 'flor', 'flor')) return { type: 'flor', what: 'flor' };
    if (has(view, 'ask-flor') && rng() < ASK_FLOR_CHANCE) return { type: 'ask-flor' };
    const points = envidoEdge(view);
    if (has(view, 'envido', 'envido') && points >= ENVIDO_CALL + t.envidoShift && rng() < t.envidoCallChance) {
      return { type: 'envido', what: points >= ENVIDO_REAL + t.envidoShift && rng() < 0.4 ? 'real' : 'envido' };
    }
    const strong = teamPower(view) >= TRUCO_CALL_POWER + t.trucoShift;
    if (has(view, 'truco') && ((strong && rng() < t.callChance) || rng() < t.bluffCall)) return { type: 'truco' };
    return choosePlay(view);
  }

  /** Devuelve una accion legal para view.me. rng permite pruebas deterministas; traits ajusta la personalidad. */
  function decide(view, rng = Math.random, traits = {}) {
    const t = { ...DEFAULT_TRAITS, ...traits };
    let action;
    if (view.phase === 'discard') action = chooseDiscard(view);
    else if (view.phase === 'play') action = play(view, rng, t);
    else if (view.phase === 'respond-truco') action = respondTruco(view, rng, t);
    else if (view.phase === 'respond-envido') action = respondEnvido(view, rng, t);
    else if (view.phase === 'respond-flor') action = respondFlor(view, rng);
    const legal = action && view.legal.some((a) => a.type === action.type && a.index === action.index && a.what === action.what);
    return legal ? action : view.legal[0];
  }

  return { DEFAULT_TRAITS, decide, teamPower, teamEnvido };
});
