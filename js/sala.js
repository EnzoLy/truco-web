/* Interfaz de las salas: entrada, lobby y conexion con el servidor. La mesa la dibuja sala-table.js con
 * los snapshots que manda el servidor; aca solo se consultan y se mandan las jugadas. */
(function () {
  'use strict';

  const T = window.SalaText;
  const RC = window.TrucoRoomClient;
  const UNLOCK_EVENTS = ['pointerup', 'keydown', 'click'];

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const { store } = RC;

  // Estilo de naipe elegido en cartas.html.
  (function pickDeckSkin() {
    const params = new URLSearchParams(location.search);
    const skin = params.get('cartas') || store.get('truco-cartas');
    if (skin) window.CardArt.setSkin(skin);
    const art = params.get('dibujo') || store.get('truco-dibujo');
    if (art) window.CardArt.setArt(art);
  })();

  const Sound = window.TrucoSoundFactory.createSound({
    AudioContextCtor: window.AudioContext || window.webkitAudioContext,
    storage: (() => { try { return window.localStorage; } catch (err) { return null; } })(),
    fetchImpl: window.fetch && window.fetch.bind(window),
    baseUrl: '/sounds',
  });

  // ---------- red ----------

  /** Tras una jugada propia se consulta enseguida para ver el resultado. */
  async function call(path, body) {
    const data = await RC.call(path, body);
    kick();
    return data;
  }

  // ---------- estado del cliente ----------

  let session = null; // { code, token }
  let snap = null;
  let watchCode = null; // sala que se mira sin sentarse
  let lastSig = ''; // ultimo estado dibujado: si la consulta trae lo mismo, no se redibuja
  let lastSeq = 0; // ultimo evento recibido: la consulta pide solo los nuevos

  const table = window.TrucoSalaTable.create({
    Sound,
    send: (action) => call(`/${session.code}/act`, { token: session.token, action }),
    sendSign: (sign) => call(`/${session.code}/sign`, { token: session.token, sign }),
    onKick: (seat) => lobbyAction('/seat', { seat, kind: 'bot' }),
  });

  const name = () => RC.playerName.get();
  const inviteLink = (code) => `${location.origin}${location.pathname}?sala=${code}`;

  function show(screen) {
    ['home', 'join', 'lobby', 'table'].forEach((id) => { $(`screen-${id}`).hidden = id !== screen; });
    $('side').hidden = screen !== 'table';
    // En la mesa el encabezado sobra: el sonido pasa junto a los botones y el resto va al panel de abajo.
    const inGame = screen === 'table';
    document.querySelector('.plate').classList.toggle('in-game', inGame);
    (inGame ? document.querySelector('.dock') : document.querySelector('.plate-head .tools')).prepend($('sound-toggle'));
    if (screen !== 'table') $('end').hidden = true;
  }

  function showError(id, message) {
    const box = $(`error-${id}`);
    box.textContent = message || '';
    box.hidden = !message;
  }

  // ---------- conexion ----------

  const poller = RC.createPoller({
    urlFor() {
      const code = session ? session.code : watchCode;
      if (!code) return null;
      const base = `/api/rooms/${encodeURIComponent(code)}`;
      return session ? `${base}/state?token=${encodeURIComponent(session.token)}&since=${lastSeq}` : `${base}/watch?since=${lastSeq}`;
    },
    async onData(data) {
      if (!session && data.status === 'lobby') {
        // La revancha volvio al lobby: ya se puede entrar a jugar.
        const code = watchCode;
        stopWatching();
        openJoin(code);
        return;
      }
      await onSnapshot(data);
    },
    onDenied() {
      const code = session ? session.code : watchCode;
      if (session) {
        RC.session.remove(code);
        session = null;
        openJoin(code, 'Ya no sos parte de esta sala o la sala se cerró.');
      } else {
        stopWatching();
        openJoin(code, 'Esa sala ya no existe.');
      }
    },
  });

  // Sin conexion persistente: se consulta el estado cada segundo, y eso tambien hace avanzar a los bots.
  function connect() {
    resetMatch();
    kick();
  }

  /** Consulta ya (tras una jugada propia) y reinicia el ciclo; descarta la respuesta de la consulta anterior. */
  function kick() {
    if (session || watchCode) poller.kick();
  }

  /** Mirar una partida en curso sin sentarse: mismo ciclo de consultas, pero a /watch y sin token. */
  function watchGame(code) {
    session = null;
    watchCode = code;
    resetMatch();
    document.querySelector('.sala').classList.add('spectating');
    $('spectate-banner').hidden = false;
    kick();
  }

  function stopWatching() {
    watchCode = null;
    poller.stop();
    document.querySelector('.sala').classList.remove('spectating');
    $('spectate-banner').hidden = true;
  }

  async function onSnapshot(s) {
    if (s.arcade) {
      location.replace(`/arcade-duo?sala=${s.code}`);
      return;
    }
    // Se consulta cada segundo: si no cambió nada, redibujar solo cierra menús y se come los toques.
    const sig = JSON.stringify(s);
    if (sig === lastSig) return;
    lastSig = sig;
    const wasLobby = snap && snap.status === 'lobby';
    snap = s;
    if (s.status === 'lobby') {
      resetMatch();
      renderLobby();
      show('lobby');
      return;
    }
    if (wasLobby) resetMatch();
    show('table');
    lastSeq = Math.max(lastSeq, s.seq);
    table.show(s);
  }

  function resetMatch() {
    table.reset();
    lastSig = '';
    lastSeq = 0;
  }

  // ---------- pantallas de entrada ----------

  /** El menú de inicio manda ?modo=duel|trio|dupla: llega con ese modo ya elegido. */
  function openHome() {
    show('home');
    $('name-home').value = name();
    const wanted = new URLSearchParams(location.search).get('modo');
    document.querySelectorAll('input[name="mode"]').forEach((radio) => { if (radio.value === wanted) radio.checked = true; });
  }

  async function openJoin(code, message) {
    try {
      const room = await RC.info(code);
      if (room.kind === 'arcade') {
        // Es un dúo del arcade: tiene su propia pantalla (tienda, run compartida).
        location.replace(`/arcade-duo?sala=${room.code}`);
        return;
      }
      $('join-sub').textContent = `Sala ${room.code} · ${T.MODE_LABELS[room.mode]} · ${room.seats.filter((s) => s.kind === 'human').length} jugador(es) adentro.`;
      const started = room.status !== 'lobby';
      showError('join', message || '');
      $('join').disabled = started;
      $('watch').hidden = !started;
      if (started) $('join-sub').textContent += ' La partida ya empezó: podés mirarla en vivo.';
      $('name-join').value = name();
      show('join');
      history.replaceState(null, '', `?sala=${room.code}`);
    } catch (err) {
      openHome();
      showError('home', err.message);
      history.replaceState(null, '', location.pathname);
    }
  }

  async function onCreate() {
    const chosen = document.querySelector('input[name="mode"]:checked');
    const player = $('name-home').value.trim();
    RC.playerName.set(player);
    showError('home', '');
    try {
      const room = await call('', { mode: chosen ? chosen.value : 'duel', name: player });
      enterRoom(room);
    } catch (err) {
      showError('home', err.message);
    }
  }

  async function onJoin() {
    const code = new URLSearchParams(location.search).get('sala');
    const player = $('name-join').value.trim();
    RC.playerName.set(player);
    showError('join', '');
    try {
      const room = await call(`/${encodeURIComponent(code)}/join`, { name: player });
      enterRoom(room);
    } catch (err) {
      showError('join', err.message);
    }
  }

  function enterRoom({ code, token }) {
    session = { code, token };
    RC.session.set(code, token);
    history.replaceState(null, '', `?sala=${code}`);
    connect();
  }

  // ---------- lobby ----------

  const SEAT_KIND = { human: 'Jugador', bot: 'Bot', empty: 'Libre' };

  function seatItem(s, host) {
    const li = el('li', `seat-item ${s.kind}`);
    const mine = s.seat === snap.seat;
    const label = el('span', 'seat-who');
    label.append(el('strong', '', s.kind === 'empty' ? 'Lugar libre' : s.name));
    const tags = [mine ? 'Vos' : SEAT_KIND[s.kind], s.seat === snap.host ? 'Anfitrión' : null].filter(Boolean);
    label.append(el('small', '', tags.join(' · ')));
    li.append(label);
    const actions = el('span', 'seat-actions');
    const act = (text, fn) => {
      const b = el('button', 'btn mini', text);
      b.type = 'button';
      b.addEventListener('click', fn);
      actions.append(b);
    };
    if (s.kind === 'empty') {
      act('Sentarme', () => lobbyAction('/sit', { seat: s.seat }));
      if (host) act('Bot', () => lobbyAction('/seat', { seat: s.seat, kind: 'bot' }));
    } else if (s.kind === 'bot' && host) {
      act('Quitar', () => lobbyAction('/seat', { seat: s.seat, kind: 'empty' }));
    }
    li.append(actions);
    return li;
  }

  async function lobbyAction(path, body) {
    showError('lobby', '');
    try {
      await call(`/${session.code}${path}`, { token: session.token, ...body });
    } catch (err) {
      showError('lobby', err.message);
    }
  }

  function renderLobby() {
    const host = snap.host === snap.seat;
    $('lobby-code').textContent = snap.code;
    $('copy-link').textContent = navigator.share ? 'Compartir link' : 'Copiar link';
    const list = $('seat-list');
    list.className = `seat-list ${snap.mode}`;
    const groups = snap.mode === 'dupla' ? [['Equipo 1', [0, 2]], ['Equipo 2', [1, 3]]] : [[null, snap.seats.map((s) => s.seat)]];
    list.replaceChildren(...groups.flatMap(([title, seats]) => [
      ...(title ? [el('li', 'seat-group', title)] : []),
      ...seats.map((n) => seatItem(snap.seats[n], host)),
    ]));

    const picker = $('mode-pick');
    picker.hidden = !host;
    picker.replaceChildren(...Object.keys(T.MODE_LABELS).map((mode) => {
      const b = el('button', `btn mini${mode === snap.mode ? ' on' : ''}`, T.MODE_LABELS[mode]);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(mode === snap.mode));
      b.addEventListener('click', () => mode !== snap.mode && lobbyAction('/config', { mode }));
      return b;
    }));

    const empty = snap.seats.filter((s) => s.kind === 'empty').length;
    $('start').hidden = !host;
    $('lobby-hint').textContent = host
      ? (empty ? `Todavía hay ${empty} lugar(es) libre(s): al empezar los ocupan bots. Pasá el link para que entren amigos.` : 'La mesa está completa.')
      : `Esperando que ${snap.seats[snap.host].name} empiece la partida.`;
  }

  const onCopy = () => RC.share(inviteLink(snap.code), $('copy-link'), 'Entrá a mi mesa de truco');

  // ---------- inicio ----------

  function unlockAudio() {
    Sound.unlock();
    UNLOCK_EVENTS.forEach((type) => document.removeEventListener(type, unlockAudio));
  }
  UNLOCK_EVENTS.forEach((type) => document.addEventListener(type, unlockAudio));

  const soundButton = $('sound-toggle');
  function syncSoundButton() {
    const on = !Sound.isMuted();
    soundButton.setAttribute('aria-pressed', String(on));
    soundButton.setAttribute('aria-label', on ? 'Sonido activado' : 'Sonido silenciado');
  }
  soundButton.addEventListener('click', (e) => {
    e.stopPropagation();
    Sound.setMuted(!Sound.isMuted());
    syncSoundButton();
    Sound.play('select');
  });
  syncSoundButton();

  $('create').addEventListener('click', onCreate);
  $('join').addEventListener('click', onJoin);
  $('watch').addEventListener('click', () => watchGame((new URLSearchParams(location.search).get('sala') || '').toUpperCase()));
  $('copy-link').addEventListener('click', onCopy);
  $('start').addEventListener('click', () => lobbyAction('/start'));
  $('again').addEventListener('click', () => lobbyAction('/rematch'));

  // Escritorio: la planilla de puntos va fuera del tablero, arriba de la columna derecha. Celular: arriba de la mesa.
  const wide = window.matchMedia('(min-width: 960px)');
  function placeBoard() {
    if (wide.matches) $('side').prepend($('board'));
    else $('screen-table').prepend($('board'));
  }
  placeBoard();
  wide.addEventListener('change', placeBoard);

  const code = (new URLSearchParams(location.search).get('sala') || '').toUpperCase();
  if (!code) {
    openHome();
  } else {
    const token = RC.session.get(code);
    if (token) {
      session = { code, token };
      show('lobby');
      connect();
    } else {
      openJoin(code);
    }
  }
})();
