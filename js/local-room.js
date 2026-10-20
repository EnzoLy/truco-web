/* Sala local: corre room-engine y room-bot en el navegador, sin servidor (arcade dúo).
 * Copia el ritmo de server/rooms.js (demora de los bots, pausa entre manos) y arma snapshots con la misma
 * forma que snapshotOf, así la mesa de las salas (sala-table.js) los dibuja igual.
 *
 * createLocalRoom({ mode, seats: [{ name, kind: 'human'|'bot', traits }], mods, rng, initialState,
 *                   setTimer, clearTimer, onChange({ snapshot, events, state }), Room, Bot })
 *   -> { start(), act(action), snapshot(), getState(), stop() }
 * El humano es siempre el asiento 0. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./room-engine.js'), require('./room-bot.js'));
  else root.TrucoLocalRoom = factory(root.TrucoRoom, root.TrucoRoomBot);
})(typeof self !== 'undefined' ? self : this, function (DefaultRoom, DefaultBot) {
  'use strict';

  const HUMAN = 0;
  const HAND_PAUSE_MS = 3500;
  const BOT_DELAY_MIN_MS = 700;
  const BOT_DELAY_SPREAD_MS = 700;
  const BOT_DELAY_MAX_MS = BOT_DELAY_MIN_MS + BOT_DELAY_SPREAD_MS;
  const EVENT_BUFFER = 200;
  const DONE_PHASES = new Set(['hand-over', 'game-over', 'idle']);

  function createLocalRoom(opts) {
    const Room = opts.Room || DefaultRoom;
    const Bot = opts.Bot || DefaultBot;
    const rng = opts.rng || Math.random;
    const setTimer = opts.setTimer || ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = opts.clearTimer || ((id) => clearTimeout(id));
    const seats = opts.seats;
    const onChange = opts.onChange || (() => {});

    let state = opts.initialState ? structuredClone(opts.initialState) : Room.newGame(opts.mode, rng, opts.mods ? { mods: opts.mods } : {});
    let seq = 0;
    let events = [];
    let timer = null;
    let stopped = false;

    const status = () => (state.phase === 'game-over' ? 'ended' : 'playing');

    function snapshot() {
      return {
        code: 'LOCAL',
        mode: state.mode,
        n: state.n,
        status: status(),
        host: HUMAN,
        seat: HUMAN,
        seats: seats.map((s, seat) => ({ seat, kind: s.kind, name: s.name, connected: true, team: state.teams ? state.teams[seat] : null })),
        view: state.hands ? Room.viewFor(state, HUMAN) : null,
        seq,
        events: [...events],
        signs: [],
        signOptions: [],
      };
    }

    function record(fresh) {
      const stamped = fresh.map((ev) => ({ seq: ++seq, ...ev }));
      events = [...events, ...stamped].slice(-EVENT_BUFFER);
      return stamped;
    }

    function schedule(ms, fn) {
      clearTimer(timer);
      timer = setTimer(() => {
        timer = null;
        if (!stopped) fn();
      }, ms);
    }

    function notify(fresh) {
      onChange({ snapshot: snapshot(), events: fresh, state: structuredClone(state) });
    }

    function deal() {
      const r = Room.dealHand(state, rng);
      state = r.state;
      const fresh = record(r.events);
      next();
      notify(fresh);
    }

    function apply(seat, action) {
      const r = Room.step(state, seat, action, rng);
      state = r.state;
      const fresh = record(r.events);
      next();
      notify(fresh);
    }

    /** Lo que sigue: repartir otra mano, que juegue un bot, o esperar al humano. */
    function next() {
      clearTimer(timer);
      timer = null;
      if (state.phase === 'game-over') return;
      if (state.phase === 'hand-over') { schedule(HAND_PAUSE_MS, deal); return; }
      if (DONE_PHASES.has(state.phase)) return;
      const actors = seats.map((_, seat) => seat).filter((seat) => Room.legalActions(state, seat).length > 0);
      if (!actors.length || actors.some((seat) => seats[seat].kind === 'human')) return;
      schedule(BOT_DELAY_MIN_MS + rng() * BOT_DELAY_SPREAD_MS, () => botMove(actors[0]));
    }

    function botMove(seat) {
      const view = Room.viewFor(state, seat, { team: true });
      apply(seat, Bot.decide(view, rng, seats[seat].traits || {}));
    }

    return {
      /** Arranca: reparte la primera mano, o sigue una partida guardada desde donde quedó. */
      start() {
        stopped = false;
        if (!state.hands) { deal(); return; }
        next();
        notify([]);
      },
      /** Jugada del humano. Tira error si no es legal (y no cambia nada). */
      act(action) {
        apply(HUMAN, action);
      },
      snapshot,
      getState: () => structuredClone(state),
      stop() {
        stopped = true;
        clearTimer(timer);
        timer = null;
      },
    };
  }

  return { createLocalRoom, HAND_PAUSE_MS, BOT_DELAY_MAX_MS };
});
