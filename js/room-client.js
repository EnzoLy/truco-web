/* Red de las salas, común a sala.js y al dúo del arcade con un amigo: pedidos a la API, el token de cada sala
 * guardado en el navegador, el ciclo de consultas del estado y el botón de compartir el link.
 *
 * TrucoRoomClient.call(path, body) · info(code) · session.get/set/remove(code) · share(url, button, text)
 * TrucoRoomClient.createPoller({ urlFor, onData, onDenied }) -> { kick(), stop() } */
(function () {
  'use strict';

  const POLL_MS = 1000;
  const NAME_KEY = 'truco-nombre';
  const COPIED_MS = 1800;
  const sessionKey = (code) => `truco-sala-${code}`;

  const store = {
    get(key) { try { return localStorage.getItem(key); } catch (err) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (err) { /* sin almacenamiento */ } },
    remove(key) { try { localStorage.removeItem(key); } catch (err) { /* sin almacenamiento */ } },
  };

  /** POST a /api/rooms{path}; devuelve data o tira un Error con el mensaje del servidor. */
  async function call(path, body) {
    let res;
    try {
      res = await fetch(`/api/rooms${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    } catch (err) {
      throw new Error('No hay conexión con el servidor');
    }
    const json = await res.json().catch(() => null);
    if (!json || !json.ok) throw new Error((json && json.error) || 'Algo salió mal');
    return json.data;
  }

  async function info(code) {
    let res;
    try {
      res = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
    } catch (err) {
      throw new Error('No hay conexión con el servidor');
    }
    const json = await res.json().catch(() => null);
    if (!json || !json.ok) throw new Error((json && json.error) || 'No existe esa sala');
    return json.data;
  }

  const session = {
    get: (code) => store.get(sessionKey(code)),
    set: (code, token) => store.set(sessionKey(code), token),
    remove: (code) => store.remove(sessionKey(code)),
  };

  /** Sin conexión persistente: se consulta cada POLL_MS (eso también hace avanzar a los bots).
   *  urlFor() da la URL a consultar (o null para no consultar). onData(data) recibe cada respuesta buena;
   *  con 403/404 se corta y llama a onDenied(). kick() consulta ya y descarta la consulta anterior. */
  function createPoller({ urlFor, onData, onDenied }) {
    let timer = null;
    let run = 0;

    async function tick(current) {
      const url = urlFor();
      if (!url) return;
      let denied = false;
      let json = null;
      try {
        const res = await fetch(url, { cache: 'no-store' });
        json = await res.json().catch(() => null);
        if (!(json && json.ok)) denied = res.status === 403 || res.status === 404;
      } catch (err) {
        // sin red: se reintenta en el próximo ciclo
      }
      if (current !== run) return;
      if (json && json.ok) {
        try {
          await onData(json.data);
        } catch (err) {
          console.error('No se pudo dibujar el estado de la sala:', err);
        }
      }
      if (current !== run) return;
      if (denied) {
        run += 1;
        onDenied();
        return;
      }
      timer = setTimeout(() => tick(current), POLL_MS);
    }

    return {
      kick() {
        run += 1;
        clearTimeout(timer);
        tick(run);
      },
      stop() {
        run += 1;
        clearTimeout(timer);
      },
    };
  }

  /** Comparte el link (o lo copia) y muestra "¡Listo!" un momento en el botón. */
  async function share(url, button, text) {
    try {
      if (navigator.share) await navigator.share({ title: 'Truco', text, url });
      else await navigator.clipboard.writeText(url);
      const before = button.textContent;
      button.textContent = '¡Listo!';
      setTimeout(() => { button.textContent = before; }, COPIED_MS);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      window.prompt('Copiá este link:', url);
    }
  }

  /** Nombre que el jugador usó la última vez (salas y dúo). */
  const playerName = {
    get: () => store.get(NAME_KEY) || '',
    set: (name) => store.set(NAME_KEY, name),
  };

  window.TrucoRoomClient = { call, info, session, store, playerName, createPoller, share };
})();
