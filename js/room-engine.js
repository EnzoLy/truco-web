/* Motor de reglas del Truco para salas: 2 jugadores (duelo), 3 (el mano solo contra los otros dos)
 * y 4 (2 contra 2). Funciones puras sobre asientos 0..n-1, igual que engine.js pero con equipos.
 *
 * Modos:
 *  - duel:  asientos 0 y 1, cada uno su equipo.
 *  - trio:  el mano recibe 4 cartas, descarta 1 y juega solo contra los otros dos (que son equipo).
 *           El rol de solitario rota con el mano. Cada asiento lleva su propio puntaje.
 *  - dupla: asientos 0,2 contra 1,3.
 *
 * Amuletos (arcade dúo): newGame(mode, rng, { mods }) con un mods por asiento, mismo formato que engine.js.
 * El bonus de un amuleto cuenta solo si el punto lo ganó su dueño (cantó el truco o tuvo el mejor envido),
 * y la flor se canta solo con el amuleto (no hay consulta al mazo). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.TrucoRoom = factory(root.Truco);
})(typeof self !== 'undefined' ? self : this, function (Truco) {
  'use strict';

  const { rankOf, envidoPoints, handWinner, valueOfTruco, envidoRaiseOptions, envidoStakes, makeDeck, shuffle, applyUpgrades, TARGET, MAX_TRUCO_LEVEL } = Truco;

  const MODES = { duel: 2, trio: 3, dupla: 4 };
  const HAND_SIZE = 3;
  const SOLO_HAND_SIZE = 4;
  const ENVIDO_OPENERS = ['envido', 'real', 'falta'];
  const ENVIDO_HINT = 27; // "Oído fino": avisa si un rival tiene más que esto
  const clone = (o) => structuredClone(o);

  const modOf = (s, seat) => (s.mods && s.mods[seat]) || null;
  const modNumber = (s, seat, field) => {
    const m = modOf(s, seat);
    return m && typeof m[field] === 'number' ? m[field] : 0;
  };
  /** Envido de un asiento, con el bonus de sus amuletos. */
  const seatEnvido = (s, seat) => envidoPoints(s.dealt[seat]) + modNumber(s, seat, 'envidoCountBonus');

  function seatCount(mode) {
    const n = MODES[mode];
    if (!n) throw new Error(`Modo desconocido: ${mode}`);
    return n;
  }

  /** Equipo de cada asiento en la mano actual. En trio el mano es el equipo 0. */
  function teamsFor(mode, mano) {
    const n = seatCount(mode);
    if (mode === 'duel') return [0, 1];
    if (mode === 'dupla') return [0, 1, 0, 1];
    return Array.from({ length: n }, (_, seat) => (seat === mano ? 0 : 1));
  }

  function newGame(mode, rng = Math.random, opts = {}) {
    const n = seatCount(mode);
    const s = {
      mode, n,
      scores: Array(n).fill(0),
      mano: Math.floor(rng() * n),
      handNo: 0,
      phase: 'idle',
      winners: null,
      flor: { asked: false, enabled: false, roll: null, by: null },
    };
    if (opts.mods) {
      s.mods = clone(opts.mods);
      s.florRule = 'mods';
    }
    return s;
  }

  function dealHand(prev, rng = Math.random) {
    const s = clone(prev);
    const deck = shuffle(makeDeck(), rng);
    if (s.handNo > 0) s.mano = (s.mano + 1) % s.n;
    s.handNo += 1;
    s.teams = teamsFor(s.mode, s.mano);
    let offset = 0;
    s.hands = Array.from({ length: s.n }, (_, seat) => {
      const size = s.mode === 'trio' && seat === s.mano ? SOLO_HAND_SIZE : HAND_SIZE;
      const hand = deck.slice(offset, offset + size);
      offset += size;
      return hand;
    });
    if (s.mods) s.hands = applyUpgrades(s.hands, s.mods);
    s.dealt = clone(s.hands);
    s.discarded = null;
    s.played = Array.from({ length: s.n }, () => []);
    s.results = [];
    if (s.mods) s.trickSeats = []; // quién ganó cada baza (para los amuletos "solo tuyos")
    s.cur = { leader: s.mano, cards: Array(s.n).fill(null) };
    s.playTurn = s.mano;
    s.turn = s.mano;
    s.phase = s.mode === 'trio' ? 'discard' : 'play';
    s.trucoLevel = 0;
    s.trucoRight = null;
    s.lastTrucoCaller = null;
    s.pending = null;
    s.suspended = null;
    s.envido = { done: false, stack: [], result: null };
    s.florHand = { done: false, result: null };
    s.handResult = null;
    return { state: s, events: [{ type: 'deal', mano: s.mano, handNo: s.handNo, teams: [...s.teams] }] };
  }

  const opposingSeats = (s, seat) => s.teams.map((t, i) => i).filter((i) => s.teams[i] !== s.teams[seat]);
  const otherTeam = (team) => 1 - team;

  function canCallTruco(s, p) {
    return (
      s.phase === 'play' && s.turn === p && !s.pending &&
      (s.trucoLevel === 0 || (s.trucoRight === s.teams[p] && s.trucoLevel < MAX_TRUCO_LEVEL))
    );
  }

  function canCallEnvido(s, p) {
    return (
      s.phase === 'play' && s.turn === p && s.results.length === 0 &&
      !s.envido.done && s.trucoLevel === 0 && s.cur.cards[p] === null && !hasFlor(s, p)
    );
  }

  // ---------- flor: solo se juega si el mazo lo dice (una consulta por partida) ----------

  const FLOR_RAISES = { flor: ['contraflor', 'resto'], contraflor: ['resto'], resto: [] };
  const FLOR_STAKES = { flor: { accepted: 6, rejected: 3 }, contraflor: { accepted: 8, rejected: 6 }, resto: { accepted: null, rejected: 8 } };
  const ENVIDO_VALUE_CAP = 10;
  const florValue = (card) => (card.num >= ENVIDO_VALUE_CAP ? 0 : card.num);

  const isFlorHand = (cards) => Boolean(cards) && cards.length === HAND_SIZE && cards.every((c) => c.suit === cards[0].suit);
  /** Puntos de una flor: 20 mas el valor de las tres cartas. */
  const florPoints = (cards) => 20 + cards.reduce((t, c) => t + florValue(c), 0);
  const florAllowed = (s, seat) => (s.florRule === 'mods' ? Boolean(modOf(s, seat) && modOf(s, seat).flor) : s.flor.enabled);
  const hasFlor = (s, seat) => florAllowed(s, seat) && isFlorHand(s.dealt[seat]);

  /** Consultar al mazo: solo al empezar la mano, antes de jugar o cantar nada, y una sola vez por partida. */
  function canAskFlor(s, p) {
    return (
      s.florRule !== 'mods' && s.phase === 'play' && s.turn === p && !s.pending && !s.flor.asked &&
      s.results.length === 0 && s.cur.cards[p] === null && s.trucoLevel === 0 && !s.envido.done
    );
  }

  /** Cantar flor: antes de la primera carta, de truco aceptado y de que se resuelva el envido. */
  function canCallFlor(s, p) {
    if (!hasFlor(s, p) || s.florHand.done || s.envido.done || s.trucoLevel !== 0) return false;
    if (s.results.length !== 0 || s.cur.cards[p] !== null) return false;
    if (s.phase === 'play') return s.turn === p && !s.pending;
    return (s.phase === 'respond-envido' || s.phase === 'respond-truco') && s.pending.responders.includes(p);
  }

  function legalActions(s, p) {
    const out = [];
    if (s.phase === 'discard') {
      if (p === s.mano) s.hands[p].forEach((_, index) => out.push({ type: 'discard', index }));
    } else if (s.phase === 'play') {
      if (s.turn !== p) return [];
      s.hands[p].forEach((_, index) => out.push({ type: 'play', index }));
      if (canCallTruco(s, p)) out.push({ type: 'truco' });
      if (canCallEnvido(s, p)) ENVIDO_OPENERS.forEach((what) => out.push({ type: 'envido', what }));
      if (canCallFlor(s, p)) out.push({ type: 'flor', what: 'flor' });
      if (canAskFlor(s, p)) out.push({ type: 'ask-flor' });
      out.push({ type: 'mazo' });
    } else if (s.phase === 'respond-truco') {
      if (!s.pending.responders.includes(p)) return [];
      out.push({ type: 'accept' }, { type: 'reject' });
      if (s.pending.level < MAX_TRUCO_LEVEL) out.push({ type: 'truco' });
      if (s.results.length === 0 && !s.envido.done && s.trucoLevel === 0 && !hasFlor(s, p)) {
        ENVIDO_OPENERS.forEach((what) => out.push({ type: 'envido', what }));
      }
      if (canCallFlor(s, p)) out.push({ type: 'flor', what: 'flor' });
    } else if (s.phase === 'respond-envido') {
      if (!s.pending.responders.includes(p)) return [];
      out.push({ type: 'accept' }, { type: 'reject' });
      envidoRaiseOptions(s.pending.stack).forEach((what) => out.push({ type: 'envido', what }));
      if (canCallFlor(s, p)) out.push({ type: 'flor', what: 'flor' });
    } else if (s.phase === 'respond-flor') {
      if (!s.pending.responders.includes(p)) return [];
      out.push({ type: 'accept' }, { type: 'reject' });
      FLOR_RAISES[s.pending.stack[s.pending.stack.length - 1]].forEach((what) => out.push({ type: 'flor', what }));
    }
    return out;
  }

  const sameAction = (a, b) => a.type === b.type && a.index === b.index && a.what === b.what;
  const isLegal = (s, p, action) => legalActions(s, p).some((a) => sameAction(a, action));

  /** Los puntos van a cada asiento del equipo: en dupla los dos compañeros, en trio los dos rivales del mano.
   * Con amuletos, `owner` (el asiento que ganó el punto) suma su bonus `field` si es del equipo ganador.
   * Devuelve el bonus sumado. */
  function award(s, team, points, owner = null, field = null) {
    const bonus = owner !== null && field && s.teams[owner] === team ? modNumber(s, owner, field) : 0;
    s.teams.forEach((t, seat) => { if (t === team) s.scores[seat] += points + bonus; });
    return bonus;
  }

  /** Quién cantó el truco que decide la mano (null si no hubo truco). */
  function trucoOwner(s, reason) {
    if (reason === 'truco-reject') return s.pending.by;
    return s.trucoLevel > 0 ? s.lastTrucoCaller : null;
  }

  function finishIfWon(s, ev) {
    const winners = s.scores.map((score, seat) => ({ score, seat })).filter((x) => x.score >= TARGET)
      .sort((a, b) => b.score - a.score).map((x) => x.seat);
    if (!winners.length) return false;
    s.phase = 'game-over';
    s.winners = winners;
    ev.push({ type: 'game-end', winners, teams: [...s.teams] });
    return true;
  }

  function endHand(s, ev, team, points, reason, extra = {}) {
    const bonus = award(s, team, points, trucoOwner(s, reason), 'trucoBonus');
    s.pending = null;
    s.suspended = null;
    const result = { winner: team, points, reason, trucoLevel: s.trucoLevel, lastTrucoCaller: s.lastTrucoCaller, ...extra };
    if (s.mods) Object.assign(result, { bonus, trickSeats: [...s.trickSeats] });
    s.handResult = result;
    ev.push({ type: 'hand-end', ...result, scores: [...s.scores] });
    if (!finishIfWon(s, ev)) s.phase = 'hand-over';
  }

  function resumeAfterEnvido(s) {
    if (s.suspended) {
      s.pending = s.suspended;
      s.suspended = null;
      s.phase = 'respond-truco';
      s.turn = s.pending.responders[0];
    } else {
      s.pending = null;
      s.phase = 'play';
      s.turn = s.playTurn;
    }
  }

  function discardCard(s, ev, player, index) {
    const [card] = s.hands[player].splice(index, 1);
    s.discarded = card;
    s.dealt[player] = clone(s.hands[player]);
    s.phase = 'play';
    ev.push({ type: 'discard', player });
  }

  function resolveTrick(s, ev) {
    const ranks = s.cur.cards.map(rankOf);
    const top = Math.max(...ranks);
    const topSeats = ranks.map((r, seat) => (r === top ? seat : -1)).filter((seat) => seat >= 0);
    const teams = new Set(topSeats.map((seat) => s.teams[seat]));
    const winner = teams.size > 1 ? -1 : [...teams][0];
    let winnerSeat = null;
    if (winner !== -1) {
      for (let k = 0; k < s.n && winnerSeat === null; k++) {
        const seat = (s.cur.leader + k) % s.n;
        if (topSeats.includes(seat)) winnerSeat = seat;
      }
    }
    const trickIndex = s.results.length;
    s.results.push(winner);
    if (s.mods) s.trickSeats.push(winnerSeat);
    ev.push({ type: 'trick', trickIndex, winner, winnerSeat, cards: [...s.cur.cards] });
    const hw = handWinner(s.results, s.teams[s.mano]);
    if (hw !== null) {
      endHand(s, ev, hw, valueOfTruco(s.trucoLevel), 'tricks');
      return;
    }
    const leader = winnerSeat === null ? s.mano : winnerSeat;
    s.cur = { leader, cards: Array(s.n).fill(null) };
    s.playTurn = s.turn = leader;
  }

  function playCard(s, ev, player, index) {
    const [card] = s.hands[player].splice(index, 1);
    const isLead = s.cur.cards.every((c) => c === null);
    s.cur.cards[player] = card;
    s.played[player].push(card);
    ev.push({ type: 'play', player, card, trickIndex: s.results.length, isLead });
    if (s.cur.cards.some((c) => c === null)) {
      s.playTurn = s.turn = (player + 1) % s.n;
      return;
    }
    resolveTrick(s, ev);
  }

  function callTruco(s, ev, player) {
    const responders = opposingSeats(s, player);
    if (s.phase === 'play') {
      s.pending = { kind: 'truco', by: player, level: s.trucoLevel + 1, responders };
      ev.push({ type: 'truco-call', by: player, level: s.pending.level, raise: false });
    } else {
      const old = s.pending;
      ev.push({ type: 'truco-response', by: player, caller: old.by, level: old.level, response: 'raise' });
      s.trucoLevel = old.level;
      s.lastTrucoCaller = old.by;
      s.pending = { kind: 'truco', by: player, level: old.level + 1, responders };
      ev.push({ type: 'truco-call', by: player, level: s.pending.level, raise: true });
    }
    s.phase = 'respond-truco';
    s.turn = responders[0];
  }

  function callEnvido(s, ev, player, what) {
    const responders = opposingSeats(s, player);
    if (s.phase === 'respond-envido') {
      const p = s.pending;
      ev.push({ type: 'envido-response', by: player, caller: p.by, response: 'raise' });
      p.stack.push(what);
      p.callers.push(player);
      p.by = player;
      p.responders = responders;
    } else {
      if (s.phase === 'respond-truco') {
        s.suspended = s.pending;
        ev.push({ type: 'envido-first', by: player });
      }
      s.pending = { kind: 'envido', by: player, stack: [what], callers: [player], responders };
      s.phase = 'respond-envido';
    }
    ev.push({ type: 'envido-call', by: player, what, stack: [...s.pending.stack] });
    s.turn = responders[0];
  }

  function answerEnvido(s, ev, player, accepted) {
    const { stack, callers, by: caller } = s.pending;
    const stakes = envidoStakes(stack, s.scores);
    ev.push({ type: 'envido-response', by: player, caller, response: accepted ? 'accept' : 'reject' });
    let result;
    if (accepted) {
      const points = s.dealt.map((_, seat) => seatEnvido(s, seat));
      const teamPoints = [0, 1].map((t) => Math.max(...points.filter((_, seat) => s.teams[seat] === t)));
      const manoTeam = s.teams[s.mano];
      const winner = teamPoints[0] === teamPoints[1] ? manoTeam : teamPoints[0] > teamPoints[1] ? 0 : 1;
      result = { accepted: true, winner, awarded: stakes.accepted, points, teamPoints, stack: [...stack], callers: [...callers] };
    } else {
      result = { accepted: false, winner: s.teams[caller], awarded: stakes.rejected, points: null, teamPoints: null, stack: [...stack], callers: [...callers] };
    }
    // El dueño del envido: el mejor envido del equipo ganador, o quien cantó si no lo quisieron.
    const owner = accepted
      ? result.points.reduce((best, v, seat) => (s.teams[seat] === result.winner && (best === null || v > result.points[best]) ? seat : best), null)
      : caller;
    const bonus = award(s, result.winner, result.awarded, owner, 'envidoBonus');
    if (s.mods) Object.assign(result, { ownerSeat: owner, bonus });
    s.envido = { done: true, stack: [...stack], result };
    ev.push({ type: 'envido-result', ...result, scores: [...s.scores] });
    if (finishIfWon(s, ev)) {
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
      s.trucoRight = s.teams[player];
      s.lastTrucoCaller = p.by;
      s.pending = null;
      s.phase = 'play';
      s.turn = s.playTurn;
      return;
    }
    endHand(s, ev, s.teams[p.by], valueOfTruco(p.level - 1), 'truco-reject', { rejectedBy: player });
  }

  function askFlor(s, ev, player, rng) {
    const roll = 1 + Math.floor(rng() * 100);
    const enabled = roll % 2 === 0;
    s.flor = { asked: true, enabled, roll, by: player };
    ev.push({ type: 'flor-ask', by: player, roll, enabled });
  }

  function florStakes(stack, scores) {
    const top = FLOR_STAKES[stack[stack.length - 1]];
    const accepted = top.accepted === null ? Math.max(1, TARGET - Math.max(...scores)) : top.accepted;
    return { accepted, rejected: top.rejected };
  }

  function finishFlor(s, ev, result) {
    award(s, result.winner, result.awarded);
    s.florHand = { done: true, result };
    s.envido = { done: true, stack: [], result: null }; // la flor anula el envido de la mano
    ev.push({ type: 'flor-result', ...result, scores: [...s.scores] });
    if (finishIfWon(s, ev)) {
      s.pending = null;
      s.suspended = null;
      return;
    }
    resumeAfterEnvido(s);
  }

  function callFlor(s, ev, player, what) {
    if (s.phase === 'respond-flor') {
      const p = s.pending;
      ev.push({ type: 'flor-response', by: player, caller: p.by, response: 'raise' });
      p.stack.push(what);
      p.callers.push(player);
      p.by = player;
      p.responders = opposingSeats(s, player).filter((seat) => hasFlor(s, seat));
      ev.push({ type: 'flor-call', by: player, what, stack: [...p.stack] });
      s.turn = p.responders[0];
      return;
    }
    if (s.phase === 'respond-envido') {
      ev.push({ type: 'envido-response', by: player, caller: s.pending.by, response: 'flor' });
    } else if (s.phase === 'respond-truco') {
      s.suspended = s.pending;
    }
    ev.push({ type: 'flor-call', by: player, what: 'flor', stack: ['flor'] });
    const responders = opposingSeats(s, player).filter((seat) => hasFlor(s, seat));
    if (!responders.length) {
      finishFlor(s, ev, { accepted: false, uncontested: true, winner: s.teams[player], awarded: FLOR_STAKES.flor.rejected, points: null, stack: ['flor'], callers: [player] });
      return;
    }
    s.pending = { kind: 'flor', by: player, stack: ['flor'], callers: [player], responders };
    s.phase = 'respond-flor';
    s.turn = responders[0];
  }

  function answerFlor(s, ev, player, accepted) {
    const { stack, callers, by: caller } = s.pending;
    const stakes = florStakes(stack, s.scores);
    ev.push({ type: 'flor-response', by: player, caller, response: accepted ? 'accept' : 'reject' });
    if (!accepted) {
      finishFlor(s, ev, { accepted: false, uncontested: false, winner: s.teams[caller], awarded: stakes.rejected, points: null, stack: [...stack], callers: [...callers] });
      return;
    }
    const points = s.dealt.map((cards, seat) => (hasFlor(s, seat) ? florPoints(cards) : null));
    const teamPoints = [0, 1].map((t) => Math.max(-1, ...points.map((v, seat) => (s.teams[seat] === t && v !== null ? v : -1))));
    const manoTeam = s.teams[s.mano];
    const winner = teamPoints[0] === teamPoints[1] ? manoTeam : teamPoints[0] > teamPoints[1] ? 0 : 1;
    finishFlor(s, ev, { accepted: true, uncontested: false, winner, awarded: stakes.accepted, points, teamPoints, stack: [...stack], callers: [...callers] });
  }

  /** Aplica una accion de un asiento. Devuelve { state, events } o lanza si es ilegal. rng solo lo usa la consulta al mazo. */
  function step(prev, player, action, rng = Math.random) {
    if (!isLegal(prev, player, action)) {
      throw new Error(`Accion ilegal: ${JSON.stringify(action)} del asiento ${player} en fase ${prev.phase}`);
    }
    const s = clone(prev);
    const ev = [];
    switch (action.type) {
      case 'discard': discardCard(s, ev, player, action.index); break;
      case 'play': playCard(s, ev, player, action.index); break;
      case 'truco': callTruco(s, ev, player); break;
      case 'envido': callEnvido(s, ev, player, action.what); break;
      case 'ask-flor': askFlor(s, ev, player, rng); break;
      case 'flor': callFlor(s, ev, player, action.what); break;
      case 'accept':
      case 'reject': {
        const accepted = action.type === 'accept';
        if (s.phase === 'respond-truco') answerTruco(s, ev, player, accepted);
        else if (s.phase === 'respond-flor') answerFlor(s, ev, player, accepted);
        else answerEnvido(s, ev, player, accepted);
        break;
      }
      case 'mazo':
        ev.push({ type: 'mazo', player });
        endHand(s, ev, otherTeam(s.teams[player]), valueOfTruco(s.trucoLevel), 'mazo', { quitter: player });
        break;
      default:
        throw new Error(`Tipo de accion desconocido: ${action.type}`);
    }
    return { state: s, events: ev };
  }

  /** Abandono: la partida termina donde esté y ganan los asientos `winners`; `leavers` son quienes se fueron. */
  function forfeit(prev, winners, leavers) {
    const s = clone(prev);
    s.phase = 'game-over';
    s.pending = null;
    s.suspended = null;
    s.winners = [...winners];
    s.forfeit = [...leavers];
    return { state: s, events: [{ type: 'game-end', winners: [...winners], teams: s.teams ? [...s.teams] : null, forfeit: [...leavers] }] };
  }

  /** Vista de un asiento: solo lo que puede saber. Las cartas ajenas se reducen a su cantidad.
   * Con { team: true } (solo bots) incluye las cartas de los companeros. */
  function viewFor(s, p, { team = false } = {}) {
    const result = s.envido.result;
    const hasHand = Boolean(s.hands);
    const choosing = s.phase === 'discard' && p === s.mano;
    const view = {
      me: p,
      n: s.n,
      mode: s.mode,
      phase: s.phase,
      turn: s.turn,
      playTurn: s.playTurn,
      scores: [...s.scores],
      mano: s.mano,
      handNo: s.handNo,
      teams: hasHand ? [...s.teams] : null,
      hand: hasHand ? clone(s.hands[p]) : [],
      handCounts: hasHand ? s.hands.map((h) => h.length) : [],
      myPlayed: hasHand ? clone(s.played[p]) : [],
      played: hasHand ? clone(s.played) : [],
      cur: hasHand ? clone(s.cur) : null,
      results: hasHand ? [...s.results] : [],
      trucoLevel: s.trucoLevel,
      trucoRight: s.trucoRight,
      pending: s.pending ? clone(s.pending) : null,
      envido: hasHand ? { done: s.envido.done, stack: [...s.envido.stack] } : { done: false, stack: [] },
      myEnvido: hasHand && !choosing ? seatEnvido(s, p) : null,
      envidoReveal: result && result.accepted ? { points: [...result.points], teamPoints: [...result.teamPoints] } : null,
      flor: { asked: s.flor.asked, enabled: s.flor.enabled, roll: s.flor.roll, by: s.flor.by },
      florDone: Boolean(s.florHand && s.florHand.done),
      myFlor: hasHand && !choosing && hasFlor(s, p) ? florPoints(s.dealt[p]) : null,
      florReveal: s.florHand && s.florHand.result && s.florHand.result.accepted ? { points: [...s.florHand.result.points], teamPoints: [...s.florHand.result.teamPoints] } : null,
      handResult: s.handResult ? clone(s.handResult) : null,
      legal: hasHand ? legalActions(s, p) : [],
      winners: s.winners ? [...s.winners] : null,
      forfeit: s.forfeit ? [...s.forfeit] : null,
      // Solo para los bots: los companeros de equipo se ven las cartas entre si. Nunca se envia a los humanos.
      partners: team && hasHand
        ? s.teams.map((t, seat) => (t === s.teams[p] && seat !== p ? { seat, hand: clone(s.hands[seat]), dealt: clone(s.dealt[seat]) } : null)).filter(Boolean)
        : [],
    };
    return hasHand && modOf(s, p) ? { ...view, ...amuletView(s, p) } : view;
  }

  /** Lo que los amuletos de información dejan ver de los rivales. El tramposo es un rival con peek 'all'. */
  function amuletView(s, p) {
    const m = modOf(s, p);
    const rivals = opposingSeats(s, p);
    const out = { mods: clone(m) };
    if (m.peek === 'all') out.oppHands = rivals.map((seat) => ({ seat, hand: clone(s.hands[seat]) }));
    else if (m.peek === 'one') out.oppPeeks = rivals.map((seat) => ({ seat, card: clone(s.dealt[seat][0]) }));
    if (m.envidoHint) out.oppEnvidoHigh = rivals.map((seat) => ({ seat, high: seatEnvido(s, seat) > ENVIDO_HINT }));
    return out;
  }

  return { MODES, seatCount, teamsFor, newGame, dealHand, step, forfeit, legalActions, viewFor, canCallTruco, canCallEnvido, canCallFlor, canAskFlor, hasFlor, florPoints, opposingSeats };
});
