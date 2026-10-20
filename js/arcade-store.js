/* Guardado de la run del arcade. El navegador guarda al instante (localStorage) y el servidor
 * (Supabase) lleva una copia: si se borra el almacenamiento pero queda la identidad, la run vuelve.
 * Identidad anonima: { id, token } que da el servidor la primera vez. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TrucoArcadeStore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RUN_KEY = 'truco.arcade.run.v1';
  const ID_KEY = 'truco.arcade.id';
  const SAVE_DEBOUNCE_MS = 400;
  const CONFLICT = 409;

  function safeGet(storage, key) {
    try {
      const raw = storage && storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function safeSet(storage, key, value) {
    try {
      if (storage) storage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * deps: storage (localStorage), fetchImpl, runVersion, setTimer/clearTimer (para tests), log.
   * load() -> run | null (primero la copia local, si no la del servidor). save(run) guarda ya en local y
   * en el servidor despues de un instante, de a un pedido por vez. flush() manda lo pendiente.
   */
  function createRunStore({
    storage, fetchImpl, runVersion, setTimer = setTimeout, clearTimer = clearTimeout, log = console,
  }) {
    let identity = safeGet(storage, ID_KEY);
    let version = null;
    let pending = null;
    let timer = null;
    let chain = Promise.resolve();
    let online = Boolean(fetchImpl);

    async function call(method, path, body) {
      const res = await fetchImpl(`/api/arcade/${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        keepalive: method === 'POST',
      });
      const json = await res.json().catch(() => ({ ok: false, error: 'Respuesta inválida' }));
      if (!res.ok || !json.ok) {
        const err = new Error(json.error || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return json.data;
    }

    let creating = null; // un solo pedido de identidad aunque lo pidan dos a la vez

    async function ensureIdentity() {
      if (identity && identity.id && identity.token) return identity;
      if (!creating) {
        creating = call('POST', 'player', {}).then((made) => {
          identity = made;
          safeSet(storage, ID_KEY, identity);
          return identity;
        }).finally(() => { creating = null; });
      }
      return creating;
    }

    async function fetchRemote() {
      const { id, token } = await ensureIdentity();
      const data = await call('POST', 'run', { id, token });
      version = data.version;
      return data;
    }

    async function pushRemote(run) {
      if (version === null || !identity) await fetchRemote();
      const { id, token } = identity;
      try {
        ({ version } = await call('POST', 'save', { id, token, run, version }));
      } catch (err) {
        if (err.status !== CONFLICT) throw err;
        // Otra pestaña guardo en el medio: esta es la que se esta jugando, gana la ultima.
        await fetchRemote();
        ({ version } = await call('POST', 'save', { id, token, run, version }));
      }
    }

    function flush() {
      clearTimer(timer);
      timer = null;
      if (!pending || !online) return chain;
      const run = pending;
      pending = null;
      chain = chain.then(() => pushRemote(run)).catch((err) => {
        log.warn('No se pudo guardar la run en el servidor; queda en este navegador', err);
        // Una identidad que el servidor no reconoce (base nueva) se descarta para pedir otra.
        if (err.status === 403 || err.status === 404) {
          identity = null;
          version = null;
        }
      });
      return chain;
    }

    return {
      async load() {
        const local = safeGet(storage, RUN_KEY);
        if (local && local.v === runVersion) {
          // En la misma cola que los guardados, asi su version nunca pisa una mas nueva.
          if (online) chain = chain.then(fetchRemote).catch((err) => log.warn('Sin conexión con el servidor del arcade', err));
          return local;
        }
        if (!online) return null;
        try {
          const { run } = await fetchRemote();
          if (run && run.v === runVersion) {
            safeSet(storage, RUN_KEY, run);
            return run;
          }
        } catch (err) {
          log.warn('No se pudo traer la run del servidor', err);
        }
        return null;
      },

      save(run) {
        safeSet(storage, RUN_KEY, run);
        pending = run;
        clearTimer(timer);
        timer = setTimer(flush, SAVE_DEBOUNCE_MS);
      },

      flush,
    };
  }

  return { createRunStore, RUN_KEY, ID_KEY };
});
