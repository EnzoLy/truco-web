/* Motor de reglas del Truco argentino (1 contra 1, sin flor).
 * Funciones puras: step() devuelve un estado nuevo y la lista de eventos. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Truco = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUITS = ['espada', 'basto', 'oro', 'copa'];
  const NUMBERS = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];
  const TARGET = 30;
  const MAX_TRUCO_LEVEL = 3;
  const TRUCO_VALUES = [1, 2, 3, 4];
  const ENVIDO_VALUES = { envido: 2, real: 3 };
  const ENVIDO_OPENERS = ['envido', 'real', 'falta'];
  const HAND_SIZE = 3;

  const clone = (o) => structuredClone(o);

  function makeDeck() {
    const deck = [];
    for (const suit of SUITS) for (const num of NUMBERS) deck.push({ num, suit });
    return deck;
  }

  function shuffle(deck, rng) {
    const a = deck.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Jerarquia del truco: mayor numero gana la baza. */
  function rankOf({ num, suit }) {
    if (num === 1 && suit === 'espada') return 14;
    if (num === 1 && suit === 'basto') return 13;
    if (num === 7 && suit === 'espada') return 12;
    if (num === 7 && suit === 'oro') return 11;
    if (num === 3) return 10;
    if (num === 2) return 9;
    if (num === 1) return 8;
    if (num === 12) return 7;
    if (num === 11) return 6;
    if (num === 10) return 5;
    if (num === 7) return 4;
    if (num === 6) return 3;
    if (num === 5) return 2;
    return 1;
  }

  const envidoValue = (card) => (card.num >= 10 ? 0 : card.num);

  function envidoPoints(cards) {
    let best = 0;
    for (const suit of SUITS) {
      const values = cards.filter((c) => c.suit === suit).map(envidoValue).sort((a, b) => b - a);
      if (values.length >= 2) best = Math.max(best, 20 + values[0] + values[1]);
    }
    if (best === 0 && cards.length) best = Math.max(...cards.map(envidoValue));
    return best;
  }

  /** results: ganador de cada baza (0, 1 o -1 si hubo parda). null si la mano sigue. */
  function handWinner(results, mano) {
    const [a, b, c] = results;
    if (results.length < 2) return null;
    if (results.length === 2) {
      if (a !== -1 && (b === a || b === -1)) return a;
      if (a === -1 && b !== -1) return b;
      return null;
    }
    if (c !== -1) return c;
    if (a !== -1) return a;
    if (b !== -1) return b;
    return mano;
  }

  const valueOfTruco = (level) => TRUCO_VALUES[level];

  function envidoRaiseOptions(stack) {
    const last = stack[stack.length - 1];
    if (last === 'falta') return [];
    if (last === 'real') return ['falta'];
    const envidos = stack.filter((x) => x === 'envido').length;
    return envidos < 2 ? ['envido', 'real', 'falta'] : ['real', 'falta'];
  }

  function envidoStakes(stack, scores) {
    const sum = (list) => list.reduce((t, w) => t + (ENVIDO_VALUES[w] || 0), 0);
    const accepted = stack.includes('falta') ? Math.max(1, TARGET - Math.max(...scores)) : sum(stack);
    const rejected = sum(stack.slice(0, -1)) || 1;
    return { accepted, rejected };
  }

  function newGame(rng = Math.random) {
    return {
      scores: [0, 0],
      mano: rng() < 0.5 ? 0 : 1,
      handNo: 0,
      phase: 'idle',
      winner: null,
    };
  }

  function dealHand(prev, rng = Math.random) {
    const s = clone(prev);
    const deck = shuffle(makeDeck(), rng);
    if (s.handNo > 0) s.mano = 1 - s.mano;
    s.handNo += 1;
    s.hands = [deck.slice(0, HAND_SIZE), deck.slice(HAND_SIZE, HAND_SIZE * 2)];
    s.dealt = clone(s.hands);
    s.played = [[], []];
    s.results = [];
    s.cur = { leader: s.mano, cards: [null, null] };
    s.playTurn = s.mano;
    s.turn = s.mano;
    s.phase = 'play';
    s.trucoLevel = 0;
    s.trucoRight = null;
    s.lastTrucoCaller = null;
    s.pending = null;
    s.suspended = null;
    s.envido = { done: false, stack: [], result: null };
    s.handResult = null;
    return { state: s, events: [{ type: 'deal', mano: s.mano, handNo: s.handNo }] };
  }

  function canCallTruco(s, p) {
    return (
      s.phase === 'play' && s.turn === p && !s.pending &&
      (s.trucoLevel === 0 || (s.trucoRight === p && s.trucoLevel < MAX_TRUCO_LEVEL))
    );
  }

  function canCallEnvido(s, p) {
    return (
      s.phase === 'play' && s.turn === p && s.results.length === 0 &&
      !s.envido.done && s.trucoLevel === 0 && s.cur.cards[p] === null
    );
  }

  function legalActions(s, p) {
    if (s.turn !== p) return [];
    const out = [];
    if (s.phase === 'play') {
      s.hands[p].forEach((_, index) => out.push({ type: 'play', index }));
      if (canCallTruco(s, p)) out.push({ type: 'truco' });
      if (canCallEnvido(s, p)) ENVIDO_OPENERS.forEach((what) => out.push({ type: 'envido', what }));
      out.push({ type: 'mazo' });
    } else if (s.phase === 'respond-truco') {
      out.push({ type: 'accept' }, { type: 'reject' });
      if (s.pending.level < MAX_TRUCO_LEVEL) out.push({ type: 'truco' });
      if (s.results.length === 0 && !s.envido.done && s.trucoLevel === 0) {
        ENVIDO_OPENERS.forEach((what) => out.push({ type: 'envido', what }));
      }
    } else if (s.phase === 'respond-envido') {
      out.push({ type: 'accept' }, { type: 'reject' });
      envidoRaiseOptions(s.pending.stack).forEach((what) => out.push({ type: 'envido', what }));
    }
    return out;
  }

  const sameAction = (a, b) => a.type === b.type && a.index === b.index && a.what === b.what;
  const isLegal = (s, p, action) => legalActions(s, p).some((a) => sameAction(a, action));

  function endHand(s, ev, winner, points, reason, extra = {}) {
    s.scores[winner] += points;
    s.pending = null;
    s.suspended = null;
    const result = {
      winner, points, reason, trucoLevel: s.trucoLevel, lastTrucoCaller: s.lastTrucoCaller, ...extra,
    };
    s.handResult = result;
    ev.push({ type: 'hand-end', ...result, scores: [...s.scores] });
    finishIfWon(s, ev, winner);
  }

  function finishIfWon(s, ev, who) {
    if (s.scores[who] >= TARGET) {
      s.phase = 'game-over';
      s.winner = who;
      ev.push({ type: 'game-end', winner: who });
      return true;
    }
    if (s.phase !== 'game-over') s.phase = s.phase === 'hand-over' ? 'hand-over' : s.phase;
    return false;
  }

  function resumeAfterEnvido(s) {
    if (s.suspended) {
      s.pending = s.suspended;
      s.suspended = null;
      s.phase = 'respond-truco';
      s.turn = 1 - s.pending.by;
    } else {
      s.pending = null;
      s.phase = 'play';
      s.turn = s.playTurn;
    }
  }

  function playCard(s, ev, player, index) {
    const [card] = s.hands[player].splice(index, 1);
    const trickIndex = s.results.length;
    const isLead = s.cur.cards[1 - player] === null;
    s.cur.cards[player] = card;
    s.played[player].push(card);
    ev.push({ type: 'play', player, card, trickIndex, isLead });
    if (isLead) {
      s.playTurn = s.turn = 1 - player;
      return;
    }
    const [r0, r1] = s.cur.cards.map(rankOf);
    const winner = r0 === r1 ? -1 : r0 > r1 ? 0 : 1;
    s.results.push(winner);
    ev.push({ type: 'trick', trickIndex, winner, cards: [...s.cur.cards] });
    const hw = handWinner(s.results, s.mano);
    if (hw !== null) {
      endHand(s, ev, hw, valueOfTruco(s.trucoLevel), 'tricks');
      if (s.phase !== 'game-over') s.phase = 'hand-over';
      return;
    }
    const leader = winner === -1 ? s.mano : winner;
    s.cur = { leader, cards: [null, null] };
    s.playTurn = s.turn = leader;
  }

  function callTruco(s, ev, player) {
    if (s.phase === 'play') {
      s.pending = { kind: 'truco', by: player, level: s.trucoLevel + 1 };
      ev.push({ type: 'truco-call', by: player, level: s.pending.level, raise: false });
    } else {
      const old = s.pending;
      ev.push({ type: 'truco-response', by: player, caller: old.by, level: old.level, response: 'raise' });
      s.trucoLevel = old.level;
      s.lastTrucoCaller = old.by;
      s.pending = { kind: 'truco', by: player, level: old.level + 1 };
      ev.push({ type: 'truco-call', by: player, level: s.pending.level, raise: true });
    }
    s.phase = 'respond-truco';
    s.turn = 1 - player;
  }

  function callEnvido(s, ev, player, what) {
    if (s.phase === 'respond-envido') {
      const p = s.pending;
      ev.push({ type: 'envido-response', by: player, caller: p.by, response: 'raise' });
      p.stack.push(what);
      p.callers.push(player);
      p.by = player;
    } else {
      if (s.phase === 'respond-truco') {
        s.suspended = s.pending;
        ev.push({ type: 'envido-first', by: player });
      }
      s.pending = { kind: 'envido', by: player, stack: [what], callers: [player] };
      s.phase = 'respond-envido';
    }
    ev.push({ type: 'envido-call', by: player, what, stack: [...s.pending.stack] });
    s.turn = 1 - player;
  }

  function answerEnvido(s, ev, player, accepted) {
    const { stack, callers, by: caller } = s.pending;
    const stakes = envidoStakes(stack, s.scores);
    ev.push({ type: 'envido-response', by: player, caller, response: accepted ? 'accept' : 'reject' });
    let result;
    if (accepted) {
      const points = [envidoPoints(s.dealt[0]), envidoPoints(s.dealt[1])];
      const winner = points[0] > points[1] ? 0 : points[1] > points[0] ? 1 : s.mano;
      result = { accepted: true, winner, awarded: stakes.accepted, points, stack: [...stack], callers: [...callers] };
    } else {
      result = { accepted: false, winner: caller, awarded: stakes.rejected, points: null, stack: [...stack], callers: [...callers] };
    }
    s.scores[result.winner] += result.awarded;
    s.envido = { done: true, stack: [...stack], result };
    ev.push({ type: 'envido-result', ...result, scores: [...s.scores] });
    if (finishIfWon(s, ev, result.winner)) {
      s.pending = null;
      s.suspended = null;
      return;
    }
    resumeAfterEnvido(s);
  }

  function answerTruco(s, ev, player, accepted) {
    const p = s.pending;
    ev.push({ type: 'truco-response', by: player, caller: p.by, level: p.level, response: accepted ? 'accept' : 'reject' });
    if (accepted) {
      s.trucoLevel = p.level;
      s.trucoRight = player;
      s.lastTrucoCaller = p.by;
      s.pending = null;
      s.phase = 'play';
      s.turn = s.playTurn;
      return;
    }
    endHand(s, ev, p.by, valueOfTruco(p.level - 1), 'truco-reject', { rejectedBy: player });
    if (s.phase !== 'game-over') s.phase = 'hand-over';
  }

  /** Aplica una accion. Devuelve { state, events } o lanza si es ilegal. */
  function step(prev, player, action) {
    if (!isLegal(prev, player, action)) {
      throw new Error(`Accion ilegal: ${JSON.stringify(action)} de ${player} en fase ${prev.phase}`);
    }
    const s = clone(prev);
    const ev = [];
    switch (action.type) {
      case 'play': playCard(s, ev, player, action.index); break;
      case 'truco': callTruco(s, ev, player); break;
      case 'envido': callEnvido(s, ev, player, action.what); break;
      case 'accept':
      case 'reject': {
        const accepted = action.type === 'accept';
        if (s.phase === 'respond-truco') answerTruco(s, ev, player, accepted);
        else answerEnvido(s, ev, player, accepted);
        break;
      }
      case 'mazo':
        ev.push({ type: 'mazo', player });
        endHand(s, ev, 1 - player, valueOfTruco(s.trucoLevel), 'mazo', { quitter: player });
        if (s.phase !== 'game-over') s.phase = 'hand-over';
        break;
      default:
        throw new Error(`Tipo de accion desconocido: ${action.type}`);
    }
    return { state: s, events: ev };
  }

  /** Vista que recibe un jugador: solo lo que puede saber. */
  function viewFor(s, p) {
    const opp = 1 - p;
    const result = s.envido.result;
    return {
      me: p,
      opp,
      phase: s.phase,
      turn: s.turn,
      playTurn: s.playTurn,
      scores: [...s.scores],
      mano: s.mano,
      handNo: s.handNo,
      hand: clone(s.hands[p]),
      dealt: clone(s.dealt[p]),
      myPlayed: clone(s.played[p]),
      oppPlayed: clone(s.played[opp]),
      cur: clone(s.cur),
      results: [...s.results],
      trickIndex: s.results.length,
      trucoLevel: s.trucoLevel,
      trucoRight: s.trucoRight,
      pending: s.pending ? clone(s.pending) : null,
      envido: { done: s.envido.done, stack: [...s.envido.stack] },
      myEnvido: envidoPoints(s.dealt[p]),
      oppEnvido: result && result.accepted ? result.points[opp] : null,
      legal: legalActions(s, p),
    };
  }

  return {
    SUITS, NUMBERS, TARGET, MAX_TRUCO_LEVEL,
    makeDeck, shuffle, rankOf, envidoPoints, handWinner, valueOfTruco,
    envidoRaiseOptions, envidoStakes,
    newGame, dealHand, step, legalActions, viewFor, canCallTruco, canCallEnvido,
  };
});
