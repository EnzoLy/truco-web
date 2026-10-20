'use strict';
/* Guardado de runs del modo arcade, con identidad anonima por dispositivo: el servidor da un id y un
 * token secreto; solo guarda el hash del token. La partida se juega en el navegador (el cliente manda),
 * asi que aca solo se valida que la run tenga forma sana: sirve para retomarla, no para un ranking.
 *
 * Contrato del store (todo async):
 *   get(id) -> { tokenHash, run, best, runsPlayed, version } | null
 *   create({ id, tokenHash }) -> false si el id existe
 *   save(id, version, { run, best, runsPlayed }) -> false si cambio en el medio
 *   sweep({ emptyBefore, idleBefore }) -> borra jugadores abandonados */
const crypto = require('node:crypto');
const A = require('../js/arcade.js');
const { DEFAULT_TRAITS } = require('../js/bot.js');
const { DEFAULT_TRAITS: ROOM_TRAITS } = require('../js/room-bot.js');

const TOKEN_BYTES = 24;
const DAY_MS = 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 60 * 60 * 1000;
const EMPTY_PLAYER_MS = DAY_MS; // pidio identidad pero nunca guardo nada
const IDLE_PLAYER_MS = 180 * DAY_MS;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const CARD_RE = /^(1|2|3|4|5|6|7|10|11|12)(espada|basto|oro|copa)$/;
const MAX_ROUND = 100_000;
const MAX_COINS = 1_000_000;
const MAX_PRICE = 1000;
const MAX_RANK = 15;
const MAX_ENVIDO_CARD = 7;
const MAX_TEXT = 200;
const MAX_SHOP_ITEMS = 12;
const MAX_RIVAL_AMULETS = 12;
const MAX_SAMPLES = 1000;
const MAX_SCORE = 200;
const MAX_RUN_BYTES = 12_288;
const MAX_VERSION = 2 ** 31 - 2; // la columna es integer y se guarda version + 1
const PHASES = new Set(['match', 'shop', 'over']);
const MATCH_PHASES = new Set(['idle', 'play', 'respond-truco', 'respond-envido', 'respond-flor', 'hand-over', 'game-over']);
const RUN_KEYS = new Set(['v', 'mode', 'phase', 'round', 'wins', 'coins', 'amulets', 'upgrades', 'rival', 'rivals', 'shop', 'match', 'best']);
const SOLO_SEATS = 2;
const DUO_SEATS = 4; // el dúo juega con el motor de salas: un puntaje por asiento
const DUO_RIVALS = 2;
const RIVAL_KEYS = new Set(['id', 'name', 'desc', 'boss', 'cheat', 'traits', 'amulets', 'samples']);
const AMULET_ITEM_KEYS = new Set(['type', 'id', 'price', 'sold']);
const UPGRADE_ITEM_KEYS = new Set(['type', 'key', 'field', 'value', 'price', 'name', 'desc', 'sold']);
const UPGRADE_FIELDS = { rank: MAX_RANK, envido: MAX_ENVIDO_CARD };
const AMULET_IDS = new Set(A.AMULET_IDS);
const PERSONALITY_IDS = new Set(A.PERSONALITY_IDS);
const TRAIT_KEYS = new Set(Object.keys(DEFAULT_TRAITS));
const ROOM_TRAIT_KEYS = new Set(Object.keys(ROOM_TRAITS));

class ArcadeHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- validacion ----------

const invalid = (what) => { throw new ArcadeHttpError(400, `Run inválida: ${what}`); };
const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isInt = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
const isNum = (x, lo, hi) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
const isText = (x) => typeof x === 'string' && x.length <= MAX_TEXT;

function onlyKeys(obj, allowed, what) {
  for (const k of Object.keys(obj)) if (!allowed.has(k)) invalid(`${what}.${k}`);
}

function checkAmulets(list, max, what) {
  if (!Array.isArray(list) || list.length > max) invalid(what);
  if (new Set(list).size !== list.length) invalid(`${what} repetidos`);
  for (const id of list) if (!AMULET_IDS.has(id)) invalid(what);
}

function checkUpgrades(upgrades) {
  if (!isObject(upgrades)) invalid('upgrades');
  for (const [key, up] of Object.entries(upgrades)) {
    if (!CARD_RE.test(key) || !isObject(up)) invalid('upgrades');
    for (const [field, value] of Object.entries(up)) {
      if (!Object.hasOwn(UPGRADE_FIELDS, field) || !isNum(value, 0, UPGRADE_FIELDS[field])) invalid('upgrades');
    }
  }
}

function checkRival(rival, traitKeys = TRAIT_KEYS) {
  if (!isObject(rival)) invalid('rival');
  onlyKeys(rival, RIVAL_KEYS, 'rival');
  if (!PERSONALITY_IDS.has(rival.id)) invalid('rival.id');
  if (!isText(rival.name) || !isText(rival.desc)) invalid('rival.name');
  if (typeof rival.boss !== 'boolean' || typeof rival.cheat !== 'boolean') invalid('rival.boss');
  if (!isInt(rival.samples, 1, MAX_SAMPLES)) invalid('rival.samples');
  checkAmulets(rival.amulets, MAX_RIVAL_AMULETS, 'rival.amulets');
  if (!isObject(rival.traits)) invalid('rival.traits');
  for (const [k, v] of Object.entries(rival.traits)) if (!traitKeys.has(k) || !isNum(v, -10, 10)) invalid('rival.traits');
}

function checkShopItem(item) {
  if (!isObject(item) || !isInt(item.price, 0, MAX_PRICE)) invalid('shop.item');
  if (item.sold !== undefined && typeof item.sold !== 'boolean') invalid('shop.item');
  if (item.type === 'amulet') {
    onlyKeys(item, AMULET_ITEM_KEYS, 'shop.item');
    if (!AMULET_IDS.has(item.id)) invalid('shop.item');
  } else if (item.type === 'upgrade') {
    onlyKeys(item, UPGRADE_ITEM_KEYS, 'shop.item');
    if (!CARD_RE.test(item.key) || !Object.hasOwn(UPGRADE_FIELDS, item.field)) invalid('shop.item');
    if (!isNum(item.value, 0, UPGRADE_FIELDS[item.field]) || !isText(item.name) || !isText(item.desc)) invalid('shop.item');
  } else {
    invalid('shop.item');
  }
}

function checkShop(shop) {
  if (shop === null) return;
  if (!isObject(shop) || !Array.isArray(shop.items) || shop.items.length > MAX_SHOP_ITEMS) invalid('shop');
  if (!isInt(shop.rerolls, 0, MAX_ROUND)) invalid('shop.rerolls');
  shop.items.forEach(checkShopItem);
}

/** La partida en curso la arma el motor; aca solo se mira que tenga forma de partida. */
function checkMatch(match, seats) {
  if (match === null) return;
  if (!isObject(match) || !MATCH_PHASES.has(match.phase)) invalid('match');
  if (!Array.isArray(match.scores) || match.scores.length !== seats || !match.scores.every((s) => isInt(s, 0, MAX_SCORE))) invalid('match.scores');
}

/** Solo: un rival (bot 1v1). Dúo: dos rivales (bot de salas) y la partida de 4 asientos. */
function checkOpponents(run) {
  if (run.mode === undefined) {
    if (run.rivals !== undefined) invalid('rivals');
    checkRival(run.rival);
    checkMatch(run.match, SOLO_SEATS);
    return;
  }
  if (run.mode !== A.DUO) invalid('mode');
  if (run.rival !== undefined) invalid('rival');
  if (!Array.isArray(run.rivals) || run.rivals.length !== DUO_RIVALS) invalid('rivals');
  run.rivals.forEach((r) => checkRival(r, ROOM_TRAIT_KEYS));
  checkMatch(run.match, DUO_SEATS);
}

function validateRun(run) {
  if (!isObject(run)) invalid('forma');
  // Vercel puede entregar el cuerpo ya parseado: el limite de bytes del pedido no alcanza.
  if (Buffer.byteLength(JSON.stringify(run)) > MAX_RUN_BYTES) throw new ArcadeHttpError(413, 'La run es demasiado grande');
  onlyKeys(run, RUN_KEYS, 'run');
  if (run.v !== A.RUN_VERSION) invalid('versión');
  if (!PHASES.has(run.phase)) invalid('phase');
  if (!isInt(run.round, 1, MAX_ROUND) || !isInt(run.wins, 0, run.round)) invalid('round');
  if (!isInt(run.coins, 0, MAX_COINS) || !isInt(run.best, 0, MAX_ROUND)) invalid('coins');
  checkAmulets(run.amulets, A.MAX_AMULETS, 'amulets');
  checkUpgrades(run.upgrades);
  checkOpponents(run);
  checkShop(run.shop);
  return run;
}

// ---------- manager ----------

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function sameHash(a, b) {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function createArcadeManager({ store, randomUUID = crypto.randomUUID, randomBytes = crypto.randomBytes, now = Date.now }) {
  if (!store) throw new Error('El arcade necesita un store');
  let lastSweep = -Infinity;

  /** Cada tanto, al crear un jugador, limpia los abandonados. Un error aca no frena el alta. */
  async function maybeSweep() {
    const t = now();
    if (t - lastSweep < SWEEP_EVERY_MS) return;
    lastSweep = t;
    try {
      await store.sweep({ emptyBefore: t - EMPTY_PLAYER_MS, idleBefore: t - IDLE_PLAYER_MS });
    } catch (err) {
      console.error('No se pudo limpiar jugadores del arcade:', err);
    }
  }

  async function authorized(id, token) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) throw new ArcadeHttpError(400, 'Jugador inválido');
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw new ArcadeHttpError(403, 'Token inválido');
    const row = await store.get(id);
    if (!row) throw new ArcadeHttpError(404, 'No existe ese jugador');
    if (!sameHash(row.tokenHash, hashToken(token))) throw new ArcadeHttpError(403, 'Token inválido');
    return row;
  }

  return {
    async createPlayer() {
      await maybeSweep();
      const id = randomUUID();
      const token = randomBytes(TOKEN_BYTES).toString('base64url');
      if (!(await store.create({ id, tokenHash: hashToken(token) }))) throw new ArcadeHttpError(503, 'Probá de nuevo');
      return { id, token };
    },

    async load(id, token) {
      const row = await authorized(id, token);
      return { run: row.run, best: row.best, runsPlayed: row.runsPlayed, version: row.version };
    },

    /** Guarda la run si nadie la cambio desde `version`. Terminar una run suma al contador. */
    async save(id, token, run, version) {
      const row = await authorized(id, token);
      validateRun(run);
      if (!isInt(version, 1, MAX_VERSION)) throw new ArcadeHttpError(400, 'Falta la versión');
      const finished = run.phase === 'over' && (!row.run || row.run.phase !== 'over');
      const best = Math.max(row.best, run.best, run.wins);
      const runsPlayed = row.runsPlayed + (finished ? 1 : 0);
      if (!(await store.save(id, version, { run, best, runsPlayed }))) {
        throw new ArcadeHttpError(409, 'La run cambió en otra pestaña');
      }
      return { version: version + 1, best };
    },
  };
}

module.exports = { createArcadeManager, validateRun, ArcadeHttpError, hashToken };
