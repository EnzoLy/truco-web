'use strict';
/* Salas de truco: lobby, asientos, partida y bots. Sin red ni reloj propio: api.js lo expone por HTTP.
 * El servidor es la autoridad: cada jugador solo recibe la vista de su asiento.
 *
 * Las salas viven en un store (memoria o Supabase), no en el proceso: puede haber una instancia distinta
 * en cada pedido. Los pasos con espera (jugada de un bot, pausa entre manos) quedan guardados en
 * `room.due`; cada pedido avanza los vencidos antes de atender, y el polling de los clientes hace de reloj.
 *
 * Contrato del store (todo async):
 *   get(code) -> { room, version } | null    create(room) -> false si el codigo existe
 *   save(room, version) -> false si cambio en el medio    count()    sweep(cutoffMs)
 *
 * Salas del arcade (dúo con un amigo): `room.arcade = { run, ready }` guarda la run compartida (js/arcade.js).
 * Lugares fijos: 0 quien crea, 2 el amigo (o un bot), 1 y 3 los rivales de la ronda. Entre partidas la sala pasa
 * por la tienda (status 'shop') y la ronda siguiente empieza cuando los dos dieron "Listo". Nadie pierde por
 * abandono: si uno se va, su turno espera. */
const crypto = require('node:crypto');
const Room = require('../js/room-engine.js');
const Bot = require('../js/room-bot.js');
const A = require('../js/arcade.js');
const { createMemoryStore } = require('./store-memory.js');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;
const CODE_ATTEMPTS = 20;
const MAX_ROOMS = 200;
const MAX_NAME = 14;
const EVENT_BUFFER = 200;
const SIGN_BUFFER = 20;
const SIGN_COOLDOWN_MS = 1000;
const HAND_PAUSE_MS = 3500;
const BOT_DELAY_MIN_MS = 700;
const BOT_DELAY_SPREAD_MS = 700;
const ROOM_IDLE_MS = 2 * 60 * 60 * 1000;
const PRESENCE_MS = 8000; // visto hace menos que esto = conectado
const PRESENCE_TOUCH_MS = 3000; // cada cuanto un poll refresca su "visto"
const ABANDON_MS = 5 * 60 * 1000; // un humano sin consultar el estado por tanto tiempo abandona la partida
const MAX_ADVANCE_STEPS = 30; // pasos automaticos por pedido
const STALE_DUE_MS = 30_000; // un paso vencido hace mas que esto se reprograma a "ahora"
const MAX_SAVE_ATTEMPTS = 4;
const ENVIDO_WHATS = new Set(['envido', 'real', 'falta']);
const FLOR_WHATS = new Set(['flor', 'contraflor', 'resto']);
const ACTION_TYPES = new Set(['play', 'discard', 'truco', 'envido', 'accept', 'reject', 'mazo', 'ask-flor', 'flor']);
const ARCADE = 'arcade';
const ARCADE_HOST = 0;
const ARCADE_PARTNER = A.PARTNER;
const ARCADE_RIVALS = [1, 3];
const SHOP_OPS = new Set(['buy', 'sell', 'reroll', 'ready']);

/** Señas fijas entre companeros: nadie escribe texto libre. */
const SIGNS = {
  'uno-espada': 'Tengo el 1 de espadas',
  'uno-basto': 'Tengo el 1 de bastos',
  'siete-espada': 'Tengo el 7 de espadas',
  'siete-oro': 'Tengo el 7 de oros',
  tres: 'Tengo un 3',
  'envido-alto': 'Tengo buen envido',
  'envido-bajo': 'Envido bajo',
  nada: 'No tengo nada',
  truco: 'Cantá truco',
  quiero: 'Quiero',
  'no-quiero': 'No quieras',
  mazo: 'Andá al mazo',
};

class RoomError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function cleanName(raw, fallback) {
  const name = String(raw ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return name || fallback;
}

function sameToken(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function validAction(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return false;
  if (!ACTION_TYPES.has(action.type)) return false;
  if ((action.type === 'play' || action.type === 'discard') && !Number.isInteger(action.index)) return false;
  if (action.type === 'envido' && !ENVIDO_WHATS.has(action.what)) return false;
  if (action.type === 'flor' && !FLOR_WHATS.has(action.what)) return false;
  return true;
}

const newToken = () => crypto.randomBytes(16).toString('hex');
const emptySeat = () => ({ kind: 'empty', name: '', token: null, lastSeen: 0 });
const humanSeat = (name, t) => ({ kind: 'human', name, token: newToken(), lastSeen: t });
const botSeat = (seat) => ({ kind: 'bot', name: `Bot ${seat + 1}`, token: null, lastSeen: 0 });
const rivalSeat = (rival) => ({ kind: 'bot', name: rival.name, token: null, lastSeen: 0, traits: { ...rival.traits } });

function newCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return code;
}

/** Quienes ganan por abandono, o null si no corresponde. Pierde el equipo de quien se fue (en dupla la pareja,
 * si no cada asiento solo); gana el que menos ausentes tiene. No hay abandono si empatan (se fueron todos por
 * igual) ni si el unico que quedaria ganando son bots: nadie a quien dar la victoria. */
function abandonment(room, t) {
  if (room.arcade || room.status !== 'playing' || !room.state) return null;
  const gone = room.seats.map((s, seat) => (s.kind === 'human' && t - s.lastSeen > ABANDON_MS ? seat : -1)).filter((seat) => seat >= 0);
  if (!gone.length) return null;
  const groups = room.mode === 'dupla' ? [[0, 2], [1, 3]] : room.seats.map((_, seat) => [seat]);
  const missing = groups.map((g) => g.filter((seat) => gone.includes(seat)).length);
  const fewest = Math.min(...missing);
  const standing = groups.filter((_, i) => missing[i] === fewest);
  if (standing.length === groups.length) return null;
  const winners = standing.flat();
  const online = winners.filter((seat) => room.seats[seat].kind === 'human' && !gone.includes(seat));
  return online.length ? { winners, gone, host: online[0] } : null;
}

function seatOf(room, token) {
  const seat = room.seats.findIndex((s) => s.kind === 'human' && sameToken(s.token, token));
  if (seat < 0) throw new RoomError(403, 'No sos parte de esta sala');
  return seat;
}

function requireHost(room, token) {
  if (seatOf(room, token) !== room.host) throw new RoomError(403, 'Solo quien creó la sala puede hacer esto');
}

/** En el trio el mano juega solo: no tiene a quien señar. */
function hasPartner(room, seat) {
  const teams = room.state && room.state.teams;
  return Boolean(teams) && teams.filter((t) => t === teams[seat]).length > 1;
}

const isConnected = (s, t) => s.kind === 'bot' || t - s.lastSeen < PRESENCE_MS;

const publicSeats = (room, t) => room.seats.map((s, seat) => ({
  seat, kind: s.kind, name: s.name, connected: isConnected(s, t),
  team: room.state && room.state.teams ? room.state.teams[seat] : null,
}));

function snapshotOf(room, seat, since, t) {
  const team = room.state && room.state.teams ? room.state.teams[seat] : null;
  const partner = hasPartner(room, seat);
  return {
    code: room.code,
    mode: room.mode,
    n: room.n,
    status: room.status,
    host: room.host,
    seat,
    seats: publicSeats(room, t),
    view: room.state && room.state.hands ? Room.viewFor(room.state, seat) : null,
    seq: room.seq,
    events: room.events.filter((e) => e.seq > since),
    signs: !partner ? [] : room.signs.filter((x) => x.team === team && x.handNo === (room.state && room.state.handNo)),
    signOptions: !partner || room.status !== 'playing' ? [] : Object.entries(SIGNS).map(([id, text]) => ({ id, text })),
    ...(room.arcade ? { arcade: { run: room.arcade.run, ready: { ...room.arcade.ready } } } : {}),
  };
}

/** Vista de quien mira: la mesa desde el asiento 0, sin ninguna carta privada ni señas. */
function watchSnapshotOf(room, since, t) {
  const snap = snapshotOf(room, 0, since, t);
  const view = snap.view && { ...snap.view, spectator: true, hand: [], myEnvido: null, myFlor: null, legal: [], partners: [] };
  return { ...snap, spectator: true, view, signs: [], signOptions: [] };
}

function createRoomManager({ store = createMemoryStore(), rng = Math.random, now = Date.now } = {}) {
  // ---------- persistencia ----------

  async function load(code) {
    const rec = await store.get(String(code).toUpperCase());
    if (!rec) throw new RoomError(404, 'No existe esa sala');
    return rec;
  }

  /** Lee, avanza lo vencido, aplica `fn` y guarda; si otro pedido guardo antes, repite sobre lo nuevo.
   * Con `always: false` solo guarda si algo cambio (`ctx.dirty`). */
  async function mutate(code, fn, { always = true } = {}) {
    for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt++) {
      const { room, version } = await load(code);
      const t = now();
      const ctx = { dirty: advance(room, t) };
      const result = fn(room, t, ctx);
      if (!always && !ctx.dirty) return result;
      room.touchedAt = t;
      if (await store.save(room, version)) return result;
    }
    throw new RoomError(503, 'La sala está muy ocupada, probá de nuevo');
  }

  // ---------- pasos automaticos ----------

  /** Aplica los pasos vencidos en orden; cada uno programa el siguiente desde su propia hora. */
  function advance(room, t) {
    const abandoned = abandonment(room, t);
    if (abandoned) {
      const { state, events } = Room.forfeit(room.state, abandoned.winners, abandoned.gone);
      room.state = state;
      record(room, events);
      room.status = 'ended';
      room.due = null;
      if (abandoned.gone.includes(room.host)) room.host = abandoned.host;
      return true;
    }
    if (room.due && t - room.due.at > STALE_DUE_MS) room.due.at = t;
    let steps = 0;
    while (room.due && room.due.at <= t && steps < MAX_ADVANCE_STEPS) {
      const { at, kind, seat } = room.due;
      room.due = null;
      steps += 1;
      try {
        if (kind === 'deal') deal(room, at);
        else botMove(room, seat, at);
      } catch (err) {
        console.error(`Paso automático fallido en la sala ${room.code}:`, err);
        driveBots(room, at);
      }
    }
    return steps > 0;
  }

  function record(room, events) {
    for (const ev of events) {
      room.seq += 1;
      room.events.push({ seq: room.seq, ...ev });
    }
    if (room.events.length > EVENT_BUFFER) room.events.splice(0, room.events.length - EVENT_BUFFER);
  }

  function deal(room, base) {
    const { state, events } = Room.dealHand(room.state, rng);
    room.state = state;
    record(room, events);
    driveBots(room, base);
  }

  function afterAction(room, events, base) {
    record(room, events);
    if (room.arcade) arcadeEvents(room, events);
    const { phase } = room.state;
    if (phase === 'game-over') {
      room.due = null;
      room.status = room.arcade && room.arcade.run.phase === 'shop' ? 'shop' : 'ended';
    } else if (phase === 'hand-over') {
      room.due = { at: base + HAND_PAUSE_MS, kind: 'deal', seat: null };
    } else {
      driveBots(room, base);
    }
  }

  function actingSeats(room) {
    const s = room.state;
    return Array.from({ length: s.n }, (_, i) => i).filter((i) => Room.legalActions(s, i).length > 0);
  }

  /** Un bot actua solo si ningun humano tiene que decidir ahora. */
  function driveBots(room, base) {
    room.due = null;
    if (room.status !== 'playing' || !room.state) return;
    const s = room.state;
    if (s.phase === 'hand-over' || s.phase === 'game-over' || s.phase === 'idle') return;
    const actors = actingSeats(room);
    if (!actors.length || actors.some((seat) => room.seats[seat].kind === 'human')) return;
    const delay = BOT_DELAY_MIN_MS + rng() * BOT_DELAY_SPREAD_MS;
    room.due = { at: base + delay, kind: 'bot', seat: actors[0] };
  }

  function botMove(room, seat, base) {
    if (room.status !== 'playing' || room.seats[seat].kind !== 'bot') return;
    const view = Room.viewFor(room.state, seat, { team: true });
    if (!view.legal.length) return;
    applyAction(room, seat, Bot.decide(view, rng, room.seats[seat].traits || {}), base);
  }

  function applyAction(room, seat, action, base) {
    let result;
    try {
      result = Room.step(room.state, seat, action, rng);
    } catch (err) {
      throw new RoomError(409, 'Esa jugada no es válida ahora');
    }
    room.state = result.state;
    afterAction(room, result.events, base);
  }

  // ---------- arcade ----------

  /** Monedas de la run por lo que pasó en la mesa; quedan como eventos para que los dos las vean. */
  function arcadeEvents(room, events) {
    if (room.arcade.run.phase !== 'match') return;
    const { run, gains } = A.onEvents(room.arcade.run, events, rng);
    room.arcade.run = run;
    record(room, gains.map((g) => ({ type: 'arcade-gain', ...g })));
  }

  /** Arma la partida de la ronda: rivales en sus lugares y los amuletos de cada uno en el motor. */
  function beginMatch(room, t) {
    const { run } = room.arcade;
    run.rivals.forEach((rival, i) => { room.seats[ARCADE_RIVALS[i]] = rivalSeat(rival); });
    room.arcade.ready = {};
    room.state = Room.newGame('dupla', rng, A.matchOptions(run));
    room.status = 'playing';
    room.signs = [];
    deal(room, t);
  }

  /** Cuando todos los humanos dieron "Listo" (un bot de compañero siempre lo está), arranca la ronda siguiente. */
  function maybeLeaveShop(room, t) {
    const humans = [ARCADE_HOST, ARCADE_PARTNER].filter((seat) => room.seats[seat].kind === 'human');
    if (!humans.every((seat) => room.arcade.ready[seat])) return;
    room.arcade.run = A.leaveShop(room.arcade.run, rng);
    beginMatch(room, t);
  }

  function requireArcade(room) {
    if (!room.arcade) throw new RoomError(409, 'Esta sala no es del arcade');
  }

  async function shop(code, token, { op, index, id } = {}) {
    if (!SHOP_OPS.has(op)) throw new RoomError(400, 'Operación inválida');
    if (op === 'buy' && !Number.isInteger(index)) throw new RoomError(400, 'Artículo inválido');
    if (op === 'sell' && !Object.hasOwn(A.AMULETS, id)) throw new RoomError(400, 'Amuleto inválido');
    return mutate(code, (room, t) => {
      const seat = seatOf(room, token);
      requireArcade(room);
      if (room.status !== 'shop') throw new RoomError(409, 'La tienda está cerrada');
      const who = seat === ARCADE_PARTNER ? 'partner' : 'me';
      try {
        if (op === 'buy') room.arcade.run = A.buy(room.arcade.run, index, who);
        else if (op === 'sell') room.arcade.run = A.sell(room.arcade.run, id, who);
        else if (op === 'reroll') room.arcade.run = A.reroll(room.arcade.run, rng);
        else {
          room.arcade.ready[seat] = true;
          maybeLeaveShop(room, t);
        }
      } catch (err) {
        if (err instanceof A.ArcadeError) throw new RoomError(409, err.message);
        throw err;
      }
    });
  }

  // ---------- lobby ----------

  async function create({ mode = 'duel', name } = {}) {
    const arcade = mode === ARCADE;
    if (!arcade && !(mode in Room.MODES)) throw new RoomError(400, 'Modo inválido');
    await store.sweep(now() - ROOM_IDLE_MS);
    if ((await store.count()) >= MAX_ROOMS) throw new RoomError(503, 'Hay demasiadas salas abiertas, probá más tarde');
    const t = now();
    const n = Room.seatCount(arcade ? 'dupla' : mode);
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const room = {
        code: newCode(), mode: arcade ? 'dupla' : mode, n, status: 'lobby', host: 0,
        seats: Array.from({ length: n }, emptySeat),
        state: null, events: [], seq: 0, signs: [], signSeq: 0, lastSign: {}, due: null, touchedAt: t,
      };
      room.seats[0] = humanSeat(cleanName(name, 'Jugador 1'), t);
      if (arcade) room.arcade = { run: null, ready: {} };
      if (await store.create(room)) return { code: room.code, token: room.seats[0].token, seat: 0 };
    }
    throw new RoomError(503, 'No se pudo crear la sala, probá de nuevo');
  }

  function join(code, name) {
    return mutate(code, (room, t) => {
      if (room.status !== 'lobby') throw new RoomError(409, 'La partida ya empezó');
      const seat = room.arcade
        ? (room.seats[ARCADE_PARTNER].kind === 'empty' ? ARCADE_PARTNER : -1)
        : room.seats.findIndex((s) => s.kind === 'empty');
      if (seat < 0) throw new RoomError(409, 'La sala está llena');
      room.seats[seat] = humanSeat(cleanName(name, `Jugador ${seat + 1}`), t);
      return { code: room.code, token: room.seats[seat].token, seat };
    });
  }

  async function info(code) {
    const { room } = await load(code);
    const out = { code: room.code, mode: room.mode, status: room.status, seats: publicSeats(room, now()) };
    return room.arcade ? { ...out, kind: ARCADE } : out;
  }

  function configure(code, token, { mode }) {
    return mutate(code, (room) => {
      requireHost(room, token);
      if (room.arcade) throw new RoomError(409, 'El dúo del arcade siempre es 2 contra 2');
      if (room.status !== 'lobby') throw new RoomError(409, 'Solo se puede cambiar el modo en el lobby');
      if (!(mode in Room.MODES)) throw new RoomError(400, 'Modo inválido');
      const n = Room.seatCount(mode);
      const people = room.seats.filter((s) => s.kind === 'human');
      if (people.length > n) throw new RoomError(409, 'Hay más jugadores que lugares en ese modo');
      const keep = room.seats.filter((s) => s.kind !== 'empty');
      const hostToken = room.seats[room.host].token;
      room.mode = mode;
      room.n = n;
      room.seats = Array.from({ length: n }, (_, i) => keep[i] || emptySeat());
      room.host = room.seats.findIndex((s) => s.token === hostToken);
    });
  }

  function sit(code, token, seat) {
    return mutate(code, (room) => {
      const from = seatOf(room, token);
      if (room.arcade) throw new RoomError(409, 'En el dúo del arcade los lugares son fijos');
      if (room.status !== 'lobby') throw new RoomError(409, 'La partida ya empezó');
      if (!Number.isInteger(seat) || seat < 0 || seat >= room.n) throw new RoomError(400, 'Asiento inválido');
      if (room.seats[seat].kind !== 'empty' && seat !== from) throw new RoomError(409, 'Ese lugar está ocupado');
      if (seat === from) return;
      room.seats[seat] = room.seats[from];
      room.seats[from] = emptySeat();
      if (room.host === from) room.host = seat;
    });
  }

  /** El anfitrion llena o vacia lugares con bots; durante la partida cambia a un humano por un bot. */
  function setSeat(code, token, seat, kind) {
    return mutate(code, (room, t) => {
      requireHost(room, token);
      if (!Number.isInteger(seat) || seat < 0 || seat >= room.n) throw new RoomError(400, 'Asiento inválido');
      if (!['bot', 'empty'].includes(kind)) throw new RoomError(400, 'Tipo de asiento inválido');
      if (seat === room.host) throw new RoomError(409, 'No podés cambiar tu propio lugar');
      if (room.arcade) return setArcadeSeat(room, seat, kind, t);
      if (room.status === 'playing') {
        if (kind !== 'bot') throw new RoomError(409, 'En partida solo se puede reemplazar por un bot');
      } else if (room.status !== 'lobby') {
        throw new RoomError(409, 'La partida terminó');
      }
      room.seats[seat] = kind === 'bot' ? botSeat(seat) : emptySeat();
      if (room.status === 'playing') driveBots(room, t);
    });
  }

  /** Dúo del arcade: solo se cambia el lugar del compañero. En el lobby se puede vaciar; después, solo pasar a bot. */
  function setArcadeSeat(room, seat, kind, t) {
    if (seat !== ARCADE_PARTNER) throw new RoomError(409, 'Los rivales los pone el arcade');
    if (room.status === 'ended') throw new RoomError(409, 'La run terminó');
    if (room.status !== 'lobby' && kind !== 'bot') throw new RoomError(409, 'Durante la run solo se puede reemplazar por un bot');
    room.seats[seat] = kind === 'bot' ? { ...botSeat(seat), name: 'Compañero bot' } : emptySeat();
    // El bot que entra juega con lo que había comprado el amigo.
    if (room.arcade.run && A.isCoop(room.arcade.run)) room.arcade.run = { ...room.arcade.run, partner: { ...room.arcade.run.partner, name: room.seats[seat].name || 'Compañero' } };
    if (room.status === 'playing') driveBots(room, t);
    if (room.status === 'shop') maybeLeaveShop(room, t);
  }

  function start(code, token) {
    return mutate(code, (room, t) => {
      requireHost(room, token);
      if (room.status !== 'lobby') throw new RoomError(409, 'La partida ya empezó');
      if (room.arcade) {
        if (room.seats[ARCADE_PARTNER].kind === 'empty') room.seats[ARCADE_PARTNER] = { ...botSeat(ARCADE_PARTNER), name: 'Compañero bot' };
        room.events = [];
        // Con un bot desde el principio es la run de dúo de siempre (el bot no compra); con un amigo, compartida.
        const friend = room.seats[ARCADE_PARTNER].kind === 'human';
        room.arcade.run = A.newRun(rng, { mode: A.DUO, coop: friend, partnerName: room.seats[ARCADE_PARTNER].name });
        beginMatch(room, t);
        return snapshotOf(room, seatOf(room, token), 0, t);
      }
      room.seats = room.seats.map((s, seat) => (s.kind === 'empty' ? botSeat(seat) : s));
      room.state = Room.newGame(room.mode, rng);
      room.status = 'playing';
      room.events = [];
      deal(room, t);
      return snapshotOf(room, seatOf(room, token), 0, t);
    });
  }

  function rematch(code, token) {
    return mutate(code, (room) => {
      requireHost(room, token);
      if (room.status !== 'ended') throw new RoomError(409, 'La partida no terminó');
      room.due = null;
      room.status = 'lobby';
      room.state = null;
      room.events = [];
      room.signs = [];
      if (room.arcade) room.arcade = { run: null, ready: {} };
    });
  }

  // ---------- partida ----------

  function act(code, token, action) {
    return mutate(code, (room, t) => {
      const seat = seatOf(room, token);
      if (room.status !== 'playing') throw new RoomError(409, 'La partida no está en juego');
      if (!validAction(action)) throw new RoomError(400, 'Jugada inválida');
      applyAction(room, seat, action, t);
    });
  }

  function sign(code, token, id) {
    return mutate(code, (room, t) => {
      const seat = seatOf(room, token);
      if (room.status !== 'playing' || !hasPartner(room, seat)) throw new RoomError(409, 'No hay compañero para señar');
      if (!Object.hasOwn(SIGNS, id)) throw new RoomError(400, 'Seña inválida');
      if (t - (room.lastSign[seat] || 0) < SIGN_COOLDOWN_MS) throw new RoomError(429, 'Esperá un momento antes de señar de nuevo');
      room.lastSign[seat] = t;
      room.signSeq += 1;
      room.signs.push({ id: room.signSeq, seat, team: room.state.teams[seat], text: SIGNS[id], handNo: room.state.handNo });
      if (room.signs.length > SIGN_BUFFER) room.signs.shift();
    });
  }

  // ---------- vistas ----------

  /** Lo que pide cada cliente cada ~1 s: avanza los bots, marca presencia y devuelve su vista. */
  function snapshot(code, token, since = 0) {
    return mutate(code, (room, t, ctx) => {
      const seat = seatOf(room, token);
      const me = room.seats[seat];
      if (t - me.lastSeen > PRESENCE_TOUCH_MS) {
        me.lastSeen = t;
        ctx.dirty = true;
      }
      return snapshotOf(room, seat, Math.max(0, Number(since) || 0), t);
    }, { always: false });
  }

  /** Quien mira no tiene asiento ni token: ve la partida en vivo con el codigo de la sala. */
  function watch(code, since = 0) {
    return mutate(code, (room, t) => watchSnapshotOf(room, Math.max(0, Number(since) || 0), t), { always: false });
  }

  const sweep = () => store.sweep(now() - ROOM_IDLE_MS);

  return { create, join, info, configure, sit, setSeat, start, rematch, act, sign, shop, snapshot, watch, sweep, size: () => store.count() };
}

module.exports = { createRoomManager, RoomError, SIGNS, HAND_PAUSE_MS, ABANDON_MS, BOT_DELAY_MIN_MS, BOT_DELAY_SPREAD_MS, PRESENCE_MS };
