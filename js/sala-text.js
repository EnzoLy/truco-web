/* Textos y marcadores de la sala: funciones puras sobre la vista de room-engine y la lista de asientos.
 * No tocan el DOM, para poder probarlas en node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SalaText = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TRUCO_NAMES = ['', 'Truco', 'Retruco', 'Vale cuatro'];
  const ENVIDO_NAMES = { envido: 'Envido', real: 'Real envido', falta: 'Falta envido' };
  const FLOR_NAMES = { flor: 'Flor', contraflor: 'Contraflor', resto: 'Contraflor al resto' };
  const MODE_LABELS = { duel: '1 vs 1', trio: '3 jugadores', dupla: '2 vs 2' };

  const nameOf = (seats, seat, me) => (seat === me ? 'Vos' : (seats[seat] && seats[seat].name) || `Asiento ${seat + 1}`);
  const list = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}` : names[0] || '');

  function eventText(ev) {
    switch (ev.type) {
      case 'truco-call':
        return ev.raise ? `¡Quiero ${TRUCO_NAMES[ev.level - 1].toLowerCase()} y subo a ${TRUCO_NAMES[ev.level].toLowerCase()}!` : `¡${TRUCO_NAMES[ev.level]}!`;
      case 'envido-call': return `¡${ENVIDO_NAMES[ev.what]}!`;
      case 'truco-response':
      case 'envido-response':
        if (ev.response === 'accept') return '¡Quiero!';
        if (ev.response === 'reject') return 'No quiero';
        return null;
      case 'flor-call': return `¡${FLOR_NAMES[ev.what]}!`;
      case 'flor-response':
        if (ev.response === 'accept') return '¡Con flor quiero!';
        if (ev.response === 'reject') return 'Con flor me achico';
        return null;
      case 'mazo': return 'Me voy al mazo';
      default: return null;
    }
  }

  function shoutKind(ev) {
    if (ev.type === 'truco-call') return 'shout-truco';
    if (ev.type === 'envido-call' || ev.type === 'flor-call') return 'shout-envido';
    return '';
  }

  /** Quien habla en un evento publico. */
  const speakerOf = (ev) => (ev.by !== undefined ? ev.by : ev.player);

  function logText(ev, seats, me) {
    const who = (seat) => nameOf(seats, seat, me);
    switch (ev.type) {
      case 'deal': return `— Mano ${ev.handNo}: es mano ${who(ev.mano)} —`;
      case 'discard': return `${who(ev.player)} descartó una carta`;
      case 'play': return `${who(ev.player)} juega ${ev.card.num} de ${ev.card.suit}`;
      case 'trick': {
        const res = ev.winner === -1 ? 'parda' : ev.winnerSeat !== null ? `gana ${who(ev.winnerSeat)}` : 'gana un equipo';
        return `Baza ${ev.trickIndex + 1}: ${res}`;
      }
      case 'envido-result': return ev.accepted
        ? `Envido: ${ev.points.map((p, seat) => `${who(seat)} ${p}`).join(', ')}. +${ev.awarded}`
        : `Envido no querido: +${ev.awarded}`;
      case 'flor-ask': return `${who(ev.by)} le preguntó al mazo: salió ${ev.roll}, ${ev.enabled ? 'se juega con flor' : 'no se juega con flor'}`;
      case 'flor-result':
        if (ev.uncontested) return `Flor: +${ev.awarded}`;
        return ev.accepted
          ? `Flor: ${ev.points.map((p, seat) => (p === null ? null : `${who(seat)} ${p}`)).filter(Boolean).join(', ')}. +${ev.awarded}`
          : `Flor no querida: +${ev.awarded}`;
      case 'hand-end': return `Mano terminada: +${ev.points}`;
      case 'envido-first': return `${who(ev.by)}: envido primero`;
      default: {
        const text = eventText(ev);
        const speaker = speakerOf(ev);
        return text && speaker !== undefined ? `${who(speaker)}: ${text}` : null;
      }
    }
  }

  /** Quien mira no es nadie de la mesa: ningun asiento es "Vos" ni "Nosotros". */
  const viewerOf = (view) => (view.spectator ? -1 : view.me);

  /** Filas del marcador de quien mira: un equipo (o jugador) por columna, con los nombres de sus integrantes. */
  function spectatorRows(view, seats) {
    const teams = [...new Set(view.teams)];
    return teams.map((team, i) => {
      const members = view.teams.map((t, seat) => (t === team ? seat : null)).filter((seat) => seat !== null);
      return { label: list(members.map((seat) => nameOf(seats, seat, -1))), score: view.scores[members[0]], tone: i === 0 ? 'me' : 'rival', seats: members };
    });
  }

  /** Filas del marcador segun el modo: yo, mi equipo y los rivales. */
  function scoreRows(view, seats) {
    if (view.spectator) return spectatorRows(view, seats);
    const me = view.me;
    const others = view.scores.map((_, seat) => seat).filter((seat) => seat !== me);
    if (view.mode === 'duel') {
      return [
        { label: 'Vos', score: view.scores[me], tone: 'me', seats: [me] },
        { label: nameOf(seats, others[0], me), score: view.scores[others[0]], tone: 'rival', seats: [others[0]] },
      ];
    }
    if (view.mode === 'dupla') {
      const partner = (me + 2) % view.n;
      const rival = (me + 1) % view.n;
      return [
        { label: 'Nosotros', score: view.scores[me], tone: 'me', seats: [me, partner] },
        { label: 'Ellos', score: view.scores[rival], tone: 'rival', seats: [rival, (rival + 2) % view.n] },
      ];
    }
    return [
      { label: 'Vos', score: view.scores[me], tone: 'me', seats: [me] },
      ...others.map((seat) => ({ label: nameOf(seats, seat, me), score: view.scores[seat], tone: 'rival', seats: [seat] })),
    ];
  }

  const teamOf = (view, seat) => (view.teams ? view.teams[seat] : null);

  function teamName(view, seats, team) {
    const me = viewerOf(view);
    const mine = teamOf(view, me);
    if (view.mode === 'dupla' && !view.spectator) return team === mine ? 'Nosotros' : 'Ellos';
    const members = view.teams.map((t, seat) => (t === team ? nameOf(seats, seat, me) : null)).filter(Boolean);
    return list(members);
  }

  function handOverText(view, seats) {
    const r = view.handResult;
    if (!r) return '';
    const mine = teamOf(view, viewerOf(view));
    if (view.spectator) return `Ganó ${teamName(view, seats, r.winner)} la mano: +${r.points}`;
    if (view.mode === 'dupla') return `${r.winner === mine ? 'Ganamos' : 'Ganaron ellos'} la mano: +${r.points}`;
    if (r.winner === mine) return `Ganaste la mano: +${r.points}`;
    return `Ganó ${teamName(view, seats, r.winner)} la mano: +${r.points}`;
  }

  function pendingText(view, seats) {
    const p = view.pending;
    const me = viewerOf(view);
    const caller = nameOf(seats, p.by, me);
    const what = p.kind === 'truco' ? TRUCO_NAMES[p.level] : p.stack.map((w) => (p.kind === 'flor' ? FLOR_NAMES : ENVIDO_NAMES)[w]).join(', ');
    const verb = p.by === me ? 'Cantaste' : `${caller} cantó`;
    if (p.responders.includes(me)) return `${verb} ${what}. ¿Qué respondés?`;
    const who = list(p.responders.map((seat) => nameOf(seats, seat, me)));
    return `${verb} ${what}. Responde ${who}.`;
  }

  /** Linea de estado de la mesa. selectedCard: carta ya tocada una vez, o null. */
  function statusText(view, seats, selectedCard) {
    const me = viewerOf(view);
    switch (view.phase) {
      case 'hand-over': return handOverText(view, seats);
      case 'game-over': return 'Terminó la partida';
      case 'discard':
        if (me === view.mano) return selectedCard ? `Tocá otra vez el ${selectedCard.num} de ${selectedCard.suit} para descartarlo.` : 'Sos mano: tocá la carta que querés descartar.';
        return `${nameOf(seats, view.mano, me)} está eligiendo qué carta descartar.`;
      case 'respond-truco':
      case 'respond-envido':
      case 'respond-flor':
        return pendingText(view, seats);
      case 'play':
        if (view.turn === me) return selectedCard ? `Tocá otra vez el ${selectedCard.num} de ${selectedCard.suit} para tirarlo.` : 'Te toca: tocá una carta para elegirla o cantá.';
        return `Juega ${nameOf(seats, view.turn, me)}.`;
      default: return '';
    }
  }

  function endText(view, seats) {
    const winners = view.winners || [];
    if (view.spectator) return { title: 'Terminó la partida', text: `Ganó ${list(winners.map((seat) => nameOf(seats, seat, -1)))}.` };
    const names = list(winners.map((seat) => nameOf(seats, seat, view.me)));
    const iWon = winners.includes(view.me) || (view.mode === 'dupla' && winners.includes((view.me + 2) % view.n));
    return { title: iWon ? '¡Ganaste la partida!' : 'Perdiste la partida', text: `Ganó ${names}.` };
  }

  return { TRUCO_NAMES, ENVIDO_NAMES, FLOR_NAMES, MODE_LABELS, nameOf, list, eventText, shoutKind, speakerOf, logText, viewerOf, scoreRows, teamName, statusText, endText };
});
