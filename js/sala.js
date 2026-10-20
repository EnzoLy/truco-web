/* Interfaz de las salas: lobby y mesa. Solo dibuja lo que manda el servidor (snapshot) y envia acciones. */
(function () {
  'use strict';

  const T = window.SalaText;
  const BUBBLE_MS = 2200;
  const NOTICE_MS = 5000;
  const POLL_MS = 1000;
  const LOG_LIMIT = 80;
  const COPIED_MS = 1800;
  const KNOCK_MS = 150;
  const DEAL_STEP_S = 0.12;
  const SCORE_FX_MS = 1100;
  const TARGET = window.Truco.TARGET;
  const NAME_KEY = 'truco-nombre';
  const sessionKey = (code) => `truco-sala-${code}`;
  const UNLOCK_EVENTS = ['pointerup', 'keydown', 'click'];

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch (err) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (err) { /* sin almacenamiento */ } },
    remove(key) { try { localStorage.removeItem(key); } catch (err) { /* sin almacenamiento */ } },
  };

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
  });

  // ---------- red ----------

  async function call(path, body) {
    let res;
    try {
      res = await fetch(`/api/rooms${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    } catch (err) {
      throw new Error('No hay conexión con el servidor');
    }
    const json = await res.json().catch(() => null);
    if (!json || !json.ok) throw new Error((json && json.error) || 'Algo salió mal');
    kick();
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

  // ---------- estado del cliente ----------

  let session = null; // { code, token }
  let snap = null;
  let pollTimer = null;
  let pollRun = 0;
  let watchCode = null; // sala que se mira sin sentarse
  let lastSig = ''; // ultimo estado dibujado: si la consulta trae lo mismo, no se redibuja
  let actionsKey = ''; // botones de accion dibujados: un menu abierto no se cierra mientras no cambien
  let lastSeq = 0;
  let firstSnapshot = true;
  let selected = null;
  let shownHandNo = -1;
  let wasMyTurn = false;
  let busy = false;
  const seenPlays = new Set();
  const seenSigns = new Set();
  const shownScores = new Map();
  const logLines = [];
  const bubbleTimers = new Map();
  const rivalNodes = new Map();
  let rivalKey = '';

  const name = () => store.get(NAME_KEY) || '';
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

  function notice(text) {
    const feed = $('sign-feed');
    const item = el('p', 'notice', text);
    feed.append(item);
    setTimeout(() => item.remove(), NOTICE_MS);
  }

  // ---------- conexion ----------

  // Sin conexion persistente: se consulta el estado cada POLL_MS, y eso tambien hace avanzar a los bots.
  function connect() {
    lastSig = '';
    firstSnapshot = true;
    lastSeq = 0;
    kick();
  }

  /** Consulta ya (tras una jugada propia) y reinicia el ciclo; descarta la respuesta de la consulta anterior. */
  function kick() {
    pollRun += 1;
    clearTimeout(pollTimer);
    if (session || watchCode) poll(pollRun);
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
    pollRun += 1;
    clearTimeout(pollTimer);
    document.querySelector('.sala').classList.remove('spectating');
    $('spectate-banner').hidden = true;
  }

  async function poll(run) {
    const code = session ? session.code : watchCode;
    const base = `/api/rooms/${encodeURIComponent(code)}`;
    const url = session ? `${base}/state?token=${encodeURIComponent(session.token)}&since=${lastSeq}` : `${base}/watch?since=${lastSeq}`;
    let denied = false;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (run !== pollRun) return;
      if (json && json.ok && !session && json.data.status === 'lobby') {
        // La revancha volvio al lobby: ya se puede entrar a jugar.
        stopWatching();
        openJoin(code);
        return;
      }
      if (json && json.ok) await onSnapshot(json.data);
      else if (res.status === 403 || res.status === 404) denied = true;
    } catch (err) {
      if (run !== pollRun) return; // sin red: se reintenta en el proximo ciclo
    }
    if (run !== pollRun) return;
    if (denied) {
      pollRun += 1;
      if (session) {
        store.remove(sessionKey(code));
        session = null;
        openJoin(code, 'Ya no sos parte de esta sala o la sala se cerró.');
      } else {
        stopWatching();
        openJoin(code, 'Esa sala ya no existe.');
      }
      return;
    }
    pollTimer = setTimeout(() => poll(run), POLL_MS);
  }

  async function onSnapshot(s) {
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
    const fresh = s.events.filter((ev) => ev.seq > lastSeq);
    lastSeq = Math.max(lastSeq, s.seq);
    ingest(fresh, !firstSnapshot);
    firstSnapshot = false;
    renderTable();
  }

  function resetMatch() {
    seenPlays.clear();
    shownScores.clear();
    logLines.length = 0;
    selected = null;
    shownHandNo = -1;
    rivalKey = '';
    lastSig = '';
    actionsKey = '';
    firstSnapshot = true;
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
      const room = await info(code);
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
    store.set(NAME_KEY, player);
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
    store.set(NAME_KEY, player);
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
    store.set(sessionKey(code), token);
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

  async function onCopy() {
    const url = inviteLink(snap.code);
    const button = $('copy-link');
    try {
      if (navigator.share) await navigator.share({ title: 'Truco', text: 'Entrá a mi mesa de truco', url });
      else await navigator.clipboard.writeText(url);
      const before = button.textContent;
      button.textContent = '¡Listo!';
      setTimeout(() => { button.textContent = before; }, COPIED_MS);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      window.prompt('Copiá este link:', url);
    }
  }

  // ---------- cartas ----------

  const cardName = (c) => `${c.num} de ${c.suit}`;

  function cardImage(src, alt) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = alt;
    img.draggable = false;
    return img;
  }

  function cardFace(card, asButton) {
    const node = el(asButton ? 'button' : 'div', 'card');
    if (asButton) node.type = 'button';
    node.title = cardName(card);
    node.setAttribute('aria-label', cardName(card));
    node.append(cardImage(window.CardArt.url(card), cardName(card)));
    return node;
  }

  function cardBack() {
    const n = el('div', 'card');
    n.setAttribute('aria-hidden', 'true');
    n.append(cardImage(window.CardArt.backUrl(), ''));
    return n;
  }

  // ---------- mesa ----------

  // Quien mira ve la mesa desde el asiento 0 pero no es nadie: ningun asiento es "Vos".
  const viewer = () => (snap.spectator ? -1 : snap.view.me);
  const seatName = (seat) => T.nameOf(snap.seats, seat, viewer());
  const initial = (seat) => (seat === viewer() ? 'V' : (seatName(seat)[0] || '?').toUpperCase());
  const toneOf = (seat) => (snap.view.teams[seat] === snap.view.teams[snap.view.me] ? 'ally' : 'foe');
  const roleOf = (seat) => (snap.spectator ? (toneOf(seat) === 'ally' ? 'me' : 'foe') : seat === snap.view.me ? 'me' : toneOf(seat));

  // Cuadritos de cinco palitos: 6 por jugador, 3 malas a la izquierda y 3 buenas a la derecha.
  const STICKS = [[3, 3, 27, 3], [27, 3, 27, 27], [27, 27, 3, 27], [3, 27, 3, 3], [3, 27, 27, 3]];
  const SQUARE = 30;
  const SQUARE_GAP = 8;
  const HALF_GAP = 14;
  const SQUARES_PER_HALF = 3;

  function tallySvg(score, previous, label) {
    const width = 2 * SQUARE + HALF_GAP;
    const height = SQUARES_PER_HALF * SQUARE + (SQUARES_PER_HALF - 1) * SQUARE_GAP;
    let sticks = '';
    for (let g = 0; g < SQUARES_PER_HALF * 2; g++) {
      const x = Math.floor(g / SQUARES_PER_HALF) * (SQUARE + HALF_GAP);
      const y = (g % SQUARES_PER_HALF) * (SQUARE + SQUARE_GAP);
      STICKS.forEach(([x1, y1, x2, y2], k) => {
        const n = g * STICKS.length + k;
        const on = n < score;
        const fresh = on && n >= previous;
        sticks += `<line class="stick${on ? ' on' : ''}${fresh ? ' fresh' : ''}" x1="${x + x1}" y1="${y + y1}" x2="${x + x2}" y2="${y + y2}"/>`;
      });
    }
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}: ${score} de ${TARGET} puntos">${sticks}</svg>`;
  }

  /** Planilla de puntos: una columna por jugador (o equipo) con su nombre arriba y los palitos debajo. */
  function renderBoard(view) {
    const rows = T.scoreRows(view, snap.seats);
    const board = $('board');
    board.style.setProperty('--cols', String(rows.length));
    board.replaceChildren(...rows.map((r) => {
      const score = Math.min(r.score, TARGET);
      const previous = shownScores.get(r.label) || 0;
      const col = el('div', `plan-col ${r.tone === 'rival' ? 'foe' : 'me'}`);
      const head = el('div', 'col-head');
      head.append(el('span', 'score-name', r.label), el('span', 'score-num', String(r.score)));
      const tally = el('div', 'tally');
      tally.innerHTML = tallySvg(score, previous, r.label);
      col.append(head, tally);
      const gained = score - previous;
      if (gained > 0 && shownScores.has(r.label)) celebrate(col, gained);
      shownScores.set(r.label, score);
      return col;
    }));
  }

  function celebrate(row, gained) {
    row.classList.add('scored');
    const pop = el('span', 'score-pop', `+${gained}`);
    pop.setAttribute('aria-hidden', 'true');
    row.append(pop);
    setTimeout(() => { pop.remove(); row.classList.remove('scored'); }, SCORE_FX_MS);
    for (let i = 0; i < Math.min(gained, 5); i++) Sound.play('point', { delay: 0.1 + i * 0.14 });
  }

  function ensureRivals(view) {
    const key = `${view.me}-${view.n}-${snap.code}`;
    if (key === rivalKey) return;
    rivalKey = key;
    rivalNodes.clear();
    const nodes = [];
    for (let k = 1; k < view.n; k++) {
      const seat = (view.me + k) % view.n;
      const box = el('div', 'rival');
      const head = el('div', 'rival-head');
      const hand = el('div', 'rival-hand');
      const bubble = el('div', 'bubble');
      bubble.setAttribute('role', 'status');
      const side = el('div', 'rival-side');
      box.append(bubble, head, hand, side);
      rivalNodes.set(seat, { box, head, hand, bubble, side, count: -1 });
      nodes.push(box);
    }
    $('rivals').className = `rivals n${view.n - 1}`;
    $('rivals').replaceChildren(...nodes);
  }

  function renderRivals(view, fresh) {
    ensureRivals(view);
    const canKick = !snap.spectator && snap.host === snap.seat && snap.status === 'playing';
    rivalNodes.forEach((node, seat) => {
      const info = snap.seats[seat];
      const awaiting = view.pending ? view.pending.responders.includes(seat) : view.turn === seat;
      node.box.classList.toggle('turn', awaiting && view.phase !== 'hand-over');
      node.box.classList.toggle('ally', !snap.spectator && toneOf(seat) === 'ally');
      node.box.classList.toggle('off', info.kind === 'human' && !info.connected);
      const head = [el('span', 'rival-name', info.name)];
      if (view.mano === seat) head.push(el('span', 'chip', 'Mano'));
      if (!snap.spectator && toneOf(seat) === 'ally') head.push(el('span', 'tag', 'Compañero'));
      node.head.replaceChildren(...head);
      const count = view.handCounts[seat];
      if (node.count !== count || fresh) {
        node.hand.replaceChildren(...Array.from({ length: count }, (_, i) => {
          const back = cardBack();
          back.style.setProperty('--i', String(i + 3));
          if (fresh) back.classList.add('deal');
          return back;
        }));
        node.count = count;
      }
      const side = [];
      if (info.kind === 'human' && !info.connected) {
        side.push(el('span', 'hint', 'Sin conexión'));
        if (canKick) {
          const kick = el('button', 'btn mini', 'Pasar a bot');
          kick.type = 'button';
          kick.addEventListener('click', () => lobbyAction('/seat', { seat, kind: 'bot' }));
          side.push(kick);
        }
      }
      node.side.replaceChildren(...side);
    });
  }

  // Ver en grande una carta jugada: hover con mouse, o tocarla (queda hasta tocar de nuevo).
  const PEEK_WIDTH = 176;
  const PEEK_GAP = 10;
  const PEEK_MARGIN = 8;
  let peekPinned = false;
  let peekNode = null;

  function showPeek(anchor, card, caption) {
    if (!peekNode) {
      peekNode = el('div', 'peek');
      peekNode.setAttribute('role', 'status');
      document.body.append(peekNode);
    }
    const img = cardImage(window.CardArt.url(card), cardName(card));
    peekNode.replaceChildren(img, el('strong', '', cardName(card)), el('span', '', caption));
    peekNode.style.width = `${PEEK_WIDTH}px`;
    peekNode.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const height = peekNode.getBoundingClientRect().height || PEEK_WIDTH * 1.9;
    const left = Math.min(Math.max(rect.left + rect.width / 2 - PEEK_WIDTH / 2, PEEK_MARGIN), innerWidth - PEEK_WIDTH - PEEK_MARGIN);
    const above = rect.top - height - PEEK_GAP;
    peekNode.style.left = `${left}px`;
    peekNode.style.top = `${above >= PEEK_MARGIN ? above : Math.min(rect.bottom + PEEK_GAP, innerHeight - height - PEEK_MARGIN)}px`;
  }

  function hidePeek() {
    peekPinned = false;
    if (peekNode) peekNode.hidden = true;
  }

  document.addEventListener('click', hidePeek);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hidePeek(); });

  /** Quien va ganando la baza en juego: la carta mas alta de las ya tiradas (null si empatan equipos rivales). */
  function currentLeader(view) {
    const trick = view.results.length;
    const played = view.cur.cards.map((card, seat) => (card ? { seat, rank: window.Truco.rankOf(card) } : null)).filter(Boolean);
    if (!played.length) return null;
    const top = Math.max(...played.map((p) => p.rank));
    const tops = played.filter((p) => p.rank === top);
    const teams = new Set(tops.map((p) => view.teams[p.seat]));
    if (teams.size > 1) return { trick, seat: null };
    const order = Array.from({ length: view.n }, (_, k) => (view.cur.leader + k) % view.n);
    return { trick, seat: order.find((seat) => tops.some((p) => p.seat === seat)) };
  }

  function leadText(leading, view) {
    if (leading.seat === null) return 'Empatan';
    return !view.spectator && leading.seat === view.me ? 'Vas ganando' : `Va ganando ${seatName(leading.seat)}`;
  }

  function renderTricks(view) {
    const wrap = $('tricks');
    wrap.className = `tricks n${view.n}`;
    const order = Array.from({ length: view.n }, (_, k) => (view.me + 1 + k) % view.n);
    const myTeam = view.teams[view.me];
    const hasAlly = view.teams.filter((t) => t === myTeam).length > 1;
    const dot = (cls, text) => { const item = el('span', '', text); const i = el('i'); i.style.background = `var(--role-${cls})`; item.prepend(i); return item; };
    const legend = view.spectator
      ? [...new Set(view.teams)].map((team) => dot(team === myTeam ? 'me' : 'foe', T.teamName(view, snap.seats, team)))
      : [dot('me', 'Vos'), ...(hasAlly ? [dot('ally', 'Compañero')] : []), dot('foe', view.n === 2 ? 'Rival' : 'Rivales')];
    $('baza-legend').replaceChildren(...legend, ...(view.flor.asked ? [el('span', `flor-chip${view.flor.enabled ? ' on' : ''}`, view.flor.enabled ? 'Con flor' : 'Sin flor')] : []));
    const leading = view.phase === 'hand-over' || view.phase === 'game-over' ? null : currentLeader(view);
    wrap.replaceChildren(...[0, 1, 2].map((i) => {
      const winner = view.results[i];
      const box = el('div', `baza${winner === undefined ? '' : winner === -1 ? ' parda' : winner === myTeam ? ' won-me' : ' won-foe'}`);
      const stack = el('div', 'stack');
      order.forEach((seat) => {
        const card = view.played[seat][i];
        if (!card) return;
        const face = cardFace(card, true);
        face.classList.add('peekable');
        face.classList.add(`role-${roleOf(seat)}`);
        const isLeading = leading && leading.trick === i && leading.seat === seat;
        if (isLeading) { face.classList.add('leading'); face.dataset.lead = 'Gana'; }
        const who = el('span', `who ${roleOf(seat)}`, initial(seat));
        who.setAttribute('aria-hidden', 'true');
        face.append(who);
        const caption = `${seatName(seat)} · Baza ${i + 1}`;
        face.title = `${caption}: ${cardName(card)}`;
        face.setAttribute('aria-label', `${caption}: ${cardName(card)}`);
        face.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && !peekPinned) showPeek(face, card, caption); });
        face.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !peekPinned) hidePeek(); });
        face.addEventListener('click', (e) => { e.stopPropagation(); peekPinned = true; showPeek(face, card, caption); });
        const key = `${view.handNo}-${seat}-${i}`;
        if (!seenPlays.has(key)) {
          seenPlays.add(key);
          face.classList.add('drop');
          face.style.setProperty('--fy', `${seat === view.me ? 110 : -110}px`);
          face.style.setProperty('--fx', `${Math.round((Math.random() - 0.5) * 70)}px`);
          face.style.setProperty('--fr', `${Math.round((Math.random() - 0.5) * 36)}deg`);
        }
        stack.append(face);
      });
      const live = leading && leading.trick === i;
      if (live) box.classList.add('live');
      const result = live ? leadText(leading, view) : winner === undefined ? '' : winner === -1 ? 'Parda' : `Gana ${T.teamName(view, snap.seats, winner)}`;
      box.append(stack, el('span', 'trick-label', `Baza ${i + 1}`));
      if (result) {
        const note = el('strong', 'trick-result', result);
        if (live && leading.seat !== null) note.classList.add(`lead-${roleOf(leading.seat)}`);
        box.append(note);
      }
      return box;
    }));
  }

  /** Quien mira ve el dorso de las cartas del asiento 0: nunca las caras. */
  function renderSpectatorHand(view, fresh) {
    $('you-head').firstChild.textContent = `${seatName(view.me)} `;
    $('you-hand').replaceChildren(...Array.from({ length: view.handCounts[view.me] }, (_, i) => {
      const back = cardBack();
      back.style.setProperty('--i', String(i));
      if (fresh) back.classList.add('deal');
      return back;
    }));
    $('you-hand').classList.remove('four');
    $('envido-hint').textContent = '';
    $('you-mano').hidden = view.mano !== view.me;
  }

  function renderHand(view, fresh) {
    if (view.spectator) { renderSpectatorHand(view, fresh); return; }
    $('you-head').firstChild.textContent = 'Vos ';
    const canPlay = view.legal.some((a) => a.type === 'play');
    const canDiscard = view.legal.some((a) => a.type === 'discard');
    const mine = $('you-hand');
    const live = canPlay || canDiscard;
    if (!live) selected = null;
    mine.replaceChildren(...view.hand.map((card, index) => {
      const n = cardFace(card, true);
      n.disabled = !live;
      if (live && selected === index) n.classList.add('selected');
      n.style.setProperty('--i', String(index));
      if (fresh) n.classList.add('deal');
      n.addEventListener('click', (e) => {
        e.stopPropagation();
        onHandCard(index, canDiscard ? 'discard' : 'play');
      });
      return n;
    }));
    mine.classList.toggle('four', view.hand.length > 3);
    $('envido-hint').textContent = view.myFlor !== null && view.hand.length ? `¡Tenés flor! ${view.myFlor} puntos`
      : view.myEnvido !== null && view.hand.length ? `Tenés ${view.myEnvido} de envido` : '';
    $('you-mano').hidden = view.mano !== view.me;
  }

  function onHandCard(index, type) {
    if (busy) return;
    if (selected === index) {
      selected = null;
      return send({ type, index });
    }
    selected = index;
    Sound.play('select');
    renderTable();
  }

  async function send(action) {
    if (busy) return;
    busy = true;
    try {
      await call(`/${session.code}/act`, { token: session.token, action });
    } catch (err) {
      notice(err.message);
    } finally {
      busy = false;
    }
  }

  // ---------- acciones ----------

  const ENVIDO_MENU_TITLE = { 'respond-truco': 'Envido primero', 'respond-envido': 'Subir' };
  const ENVIDO_MENU_HINT = { envido: 'Dos puntos', real: 'Tres puntos', falta: 'Lo que falta para ganar' };

  function button(label, cls, onClick) {
    const b = el('button', `btn ${cls || ''}`.trim(), label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function closeMenus(except) {
    document.querySelectorAll('.menu-wrap.open').forEach((w) => {
      if (w === except) return;
      w.classList.remove('open');
      w.querySelector('.btn').setAttribute('aria-expanded', 'false');
    });
  }

  /** Menu que se abre hacia arriba: envidos o señas. */
  function menuButton(title, cls, items) {
    const wrap = el('div', 'menu-wrap');
    const trigger = button(title, `${cls} menu-trigger`, () => {});
    trigger.append(el('span', 'caret'));
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    const menu = el('div', 'menu');
    menu.setAttribute('role', 'menu');
    items.forEach((item, i) => {
      const node = el('button', 'menu-item');
      node.type = 'button';
      node.setAttribute('role', 'menuitem');
      node.style.setProperty('--k', String(items.length - 1 - i));
      node.append(el('span', 'menu-name', item.name));
      if (item.hint) node.append(el('span', 'menu-hint', item.hint));
      node.addEventListener('click', () => { closeMenus(); item.run(); });
      menu.append(node);
    });
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !wrap.classList.contains('open');
      closeMenus(open ? wrap : null);
      wrap.classList.toggle('open', open);
      trigger.setAttribute('aria-expanded', String(open));
      if (!open) return;
      menu.style.setProperty('--shift', '0px');
      const box = menu.getBoundingClientRect();
      const margin = 10;
      const shift = box.left < margin ? margin - box.left : box.right > innerWidth - margin ? innerWidth - margin - box.right : 0;
      menu.style.setProperty('--shift', `${shift}px`);
    });
    wrap.append(trigger, menu);
    return wrap;
  }

  async function sendSign(id) {
    try {
      await call(`/${session.code}/sign`, { token: session.token, sign: id });
    } catch (err) {
      notice(err.message);
    }
  }

  function renderActions(view) {
    const key = JSON.stringify([view.legal, view.phase, view.trucoLevel, view.pending && view.pending.level, snap.status, snap.signOptions.length]);
    if (key === actionsKey) return;
    actionsKey = key;
    const box = $('actions');
    box.replaceChildren();
    const nodes = [];
    const legal = view.legal;
    const ofType = (t) => legal.filter((a) => a.type === t);
    if (view.phase === 'respond-truco' || view.phase === 'respond-envido' || view.phase === 'respond-flor') {
      if (ofType('accept').length) {
        const isFlor = view.phase === 'respond-flor';
        nodes.push(button(isFlor ? 'Con flor quiero' : 'Quiero', 'primary', () => send({ type: 'accept' })));
        nodes.push(button(isFlor ? 'Me achico' : 'No quiero', 'danger', () => send({ type: 'reject' })));
      }
    }
    ofType('flor').forEach((a) => {
      const label = view.phase === 'respond-flor' ? T.FLOR_NAMES[a.what] : '¡Flor!';
      nodes.push(button(label, 'hot', () => send({ type: 'flor', what: a.what })));
    });
    if (ofType('truco').length) {
      const level = view.phase === 'respond-truco' ? view.pending.level + 1 : view.trucoLevel + 1;
      const label = view.phase === 'respond-truco' ? `Quiero ${T.TRUCO_NAMES[level].toLowerCase()}` : T.TRUCO_NAMES[level];
      nodes.push(button(label, 'hot', () => send({ type: 'truco' })));
    }
    const envidos = ofType('envido');
    if (envidos.length === 1) {
      const nameOfEnvido = T.ENVIDO_NAMES[envidos[0].what];
      nodes.push(button(view.phase === 'respond-envido' ? `Subo: ${nameOfEnvido.toLowerCase()}` : nameOfEnvido, 'cool', () => send({ type: 'envido', what: envidos[0].what })));
    } else if (envidos.length > 1) {
      nodes.push(menuButton(ENVIDO_MENU_TITLE[view.phase] || 'Envido', 'cool', envidos.map((a) => ({
        name: view.phase === 'respond-envido' && a.what === 'envido' ? 'Envido otra vez' : T.ENVIDO_NAMES[a.what],
        hint: ENVIDO_MENU_HINT[a.what],
        run: () => send({ type: 'envido', what: a.what }),
      }))));
    }
    if (ofType('ask-flor').length) nodes.push(button('¿Con flor?', 'cool', () => send({ type: 'ask-flor' })));
    if (ofType('mazo').length) nodes.push(button('Mazo', 'ghost', () => send({ type: 'mazo' })));
    if (snap.status === 'playing' && snap.signOptions.length && view.phase !== 'hand-over') {
      nodes.push(menuButton('Señas', 'ghost signs-btn', snap.signOptions.map((o) => ({ name: o.text, run: () => sendSign(o.id) }))));
    }
    nodes.forEach((n, i) => n.style.setProperty('--i', String(i)));
    box.append(...nodes);
  }

  function renderSigns() {
    const feed = $('sign-feed');
    snap.signs.forEach((s) => {
      if (seenSigns.has(s.id)) return;
      seenSigns.add(s.id);
      if (s.seat === snap.seat) return;
      const item = el('p', 'notice sign', `${snap.seats[s.seat].name}: ${s.text}`);
      feed.append(item);
      Sound.play('select');
      setTimeout(() => item.remove(), NOTICE_MS);
    });
  }

  // ---------- eventos ----------

  function say(seat, text, kind = '') {
    const view = snap.view;
    const b = seat === view.me ? $('you-bubble') : rivalNodes.get(seat) && rivalNodes.get(seat).bubble;
    if (!b) return;
    b.textContent = text;
    b.classList.remove('show', 'shout-truco', 'shout-envido');
    void b.offsetWidth;
    if (kind) b.classList.add(kind);
    b.classList.add('show');
    clearTimeout(bubbleTimers.get(seat));
    bubbleTimers.set(seat, setTimeout(() => b.classList.remove('show'), BUBBLE_MS));
  }

  function knockTable(level) {
    const table = document.querySelector('.table');
    const knocks = Math.min(Math.max(level, 1), 3);
    table.style.setProperty('--n', String(knocks));
    table.classList.remove('knock');
    void table.offsetWidth;
    table.classList.add('knock');
    setTimeout(() => table.classList.remove('knock'), KNOCK_MS * knocks + 50);
  }

  const SHOUT_KINDS = { 'truco-call': 'truco', 'envido-call': 'envido', 'flor-call': 'flor', mazo: 'noquiero' };
  const SPARK_COLORS = ['#e6b83c', '#f7f1e3', '#c8261f'];
  const SHOUT_MS = 1600;
  const DUST_COUNT = 8;
  const SPARK_MS = 1000;
  let shoutTimer = null;

  const ROLL_TICKS = 14;
  const ROLL_STEP_MS = 60;
  const ROLL_HOLD_MS = 3400;
  let rollTimer = null;

  /** El mazo tira un numero: los digitos giran y se frenan en el resultado. */
  function rollShout(ev) {
    const box = $('shout');
    box.className = 'shout flor lvl1 long';
    const who = T.nameOf(snap.seats, ev.by, viewer());
    const text = $('shout-text');
    const render = (label) => text.replaceChildren(el('span', 'shout-who', `${who} le pregunta al mazo`), document.createTextNode(label));
    render('?');
    void box.offsetWidth;
    box.classList.add('go');
    let ticks = 0;
    clearInterval(rollTimer);
    rollTimer = setInterval(() => {
      ticks += 1;
      if (ticks < ROLL_TICKS) { render(String(1 + Math.floor(Math.random() * 100))); return; }
      clearInterval(rollTimer);
      box.classList.toggle('flor', ev.enabled);
      box.classList.toggle('noquiero', !ev.enabled);
      render(ev.enabled ? `${ev.roll}: ¡con flor!` : `${ev.roll}: sin flor`);
      Sound.play(ev.enabled ? 'quiero' : 'noquiero');
    }, ROLL_STEP_MS);
    clearTimeout(shoutTimer);
    shoutTimer = setTimeout(() => box.classList.remove('go'), ROLL_HOLD_MS);
  }

  function shout(ev, text, speaker) {
    if (ev.type === 'flor-ask') { rollShout(ev); return; }
    let kind = SHOUT_KINDS[ev.type];
    if (!kind && (ev.type === 'truco-response' || ev.type === 'envido-response' || ev.type === 'flor-response')) {
      kind = ev.response === 'accept' ? 'quiero' : ev.response === 'reject' ? 'noquiero' : 'truco';
    }
    if (!kind || !text) return;
    const box = $('shout');
    const level = ev.type === 'truco-call' ? Math.min(Math.max(ev.level, 1), 3) : 1;
    box.className = `shout ${kind} lvl${level}`;
    const who = speaker !== undefined ? T.nameOf(snap.seats, speaker, viewer()) : '';
    $('shout-text').replaceChildren(...(who ? [el('span', 'shout-who', who)] : []), document.createTextNode(text));
    void box.offsetWidth;
    box.classList.add('go');
    clearTimeout(shoutTimer);
    shoutTimer = setTimeout(() => box.classList.remove('go'), SHOUT_MS);
  }

  function sparks(win) {
    const area = document.querySelector('.sala .center');
    if (!area) return;
    const rect = area.getBoundingClientRect();
    const count = win ? 26 : 10;
    for (let i = 0; i < count; i++) {
      const s = el('i', 'spark');
      const angle = Math.random() * Math.PI * 2;
      const dist = 60 + Math.random() * 140;
      s.style.left = `${rect.left + rect.width / 2}px`;
      s.style.top = `${rect.top + rect.height / 2}px`;
      s.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      s.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
      s.style.setProperty('--r', `${Math.round(Math.random() * 540)}deg`);
      s.style.setProperty('--c', win ? SPARK_COLORS[i % 3] : '#c8261f');
      document.body.append(s);
      setTimeout(() => s.remove(), SPARK_MS);
    }
  }

  function seedDust() {
    const dust = $('dust');
    if (!dust || dust.children.length) return;
    for (let i = 0; i < DUST_COUNT; i++) {
      const m = el('i');
      m.style.setProperty('--x', `${Math.round(Math.random() * 100)}%`);
      m.style.setProperty('--s', `${2 + Math.round(Math.random() * 3)}px`);
      m.style.setProperty('--d', `${7 + Math.random() * 7}s`);
      m.style.setProperty('--w', `${-Math.random() * 12}s`);
      m.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 80)}px`);
      dust.append(m);
    }
  }

  const HANDEND_MS = 2800;
  const COUNT_STEP_MS = 140;
  const COIN_COUNT = 28;
  let handEndTimer = null;
  let countTimer = null;

  const HAND_REASONS = {
    tricks: 'Ganó las bazas',
    'truco-reject': 'No quisieron el truco',
    mazo: 'Se fue al mazo',
  };

  function handEnd(ev) {
    const view = snap.view;
    const spectating = Boolean(view.spectator);
    const won = spectating || ev.winner === view.teams[view.me];
    const box = $('handend');
    box.className = `handend ${won ? 'win' : 'loss'}`;
    const group = view.mode === 'dupla';
    $('handend-title').textContent = spectating ? `Gana ${T.teamName(view, snap.seats, ev.winner)}` : won ? (group ? '¡Mano nuestra!' : '¡Mano tuya!') : (group ? 'Mano de ellos' : 'Mano del rival');
    $('handend-why').textContent = HAND_REASONS[ev.reason] || '';
    const points = $('handend-points');
    clearInterval(countTimer);
    let shown = 0;
    points.textContent = '+0';
    countTimer = setInterval(() => {
      shown += 1;
      points.textContent = `+${shown}`;
      if (shown >= ev.points) clearInterval(countTimer);
    }, COUNT_STEP_MS);
    box.querySelectorAll('.coin').forEach((c) => c.remove());
    if (won && !spectating) {
      for (let i = 0; i < COIN_COUNT; i++) {
        const c = el('i', 'coin');
        c.style.setProperty('--x', `${Math.round(Math.random() * 100)}vw`);
        c.style.setProperty('--w', `${Math.round(Math.random() * 600)}ms`);
        c.style.setProperty('--d', `${1400 + Math.round(Math.random() * 900)}ms`);
        c.style.setProperty('--r', `${Math.round(360 + Math.random() * 540)}deg`);
        box.append(c);
      }
    }
    void box.offsetWidth;
    box.classList.add('go');
    clearTimeout(handEndTimer);
    handEndTimer = setTimeout(() => box.classList.remove('go'), HANDEND_MS);
  }

  function react(ev, live) {
    const view = snap.view;
    const mine = view.teams ? view.teams[view.me] : null;
    switch (ev.type) {
      case 'play': Sound.play('play'); break;
      case 'truco-call': Sound.play('knock', { level: ev.level }); knockTable(ev.level); break;
      case 'envido-call':
      case 'flor-call': Sound.play('envido'); break;
      case 'truco-response':
      case 'envido-response':
      case 'flor-response':
        if (ev.response === 'accept') Sound.play('quiero');
        else if (ev.response === 'reject') Sound.play('noquiero');
        break;
      case 'mazo': Sound.play('mazo'); break;
      case 'hand-end': handEnd(ev); break;
      case 'trick':
        if (ev.winner !== -1 && !view.spectator) {
          Sound.play(ev.winner === mine ? 'trickWin' : 'trickLoss', { delay: 0.25 });
          sparks(ev.winner === mine);
        }
        break;
      default:
    }
    return live;
  }

  function ingest(events, live) {
    events.forEach((ev) => {
      const line = T.logText(ev, snap.seats, viewer());
      if (line) {
        logLines.unshift(line);
        if (logLines.length > LOG_LIMIT) logLines.pop();
      }
      if (!live) return;
      react(ev, live);
      const text = T.eventText(ev);
      const speaker = T.speakerOf(ev);
      shout(ev, text, speaker);
      if (text && speaker !== undefined && ev.type !== 'play') say(speaker, text, T.shoutKind(ev));
      if (ev.type === 'flor-result' && ev.accepted) {
        ev.points.forEach((p, seat) => { if (p !== null) say(seat, `Flor ${p}`); });
      }
      if (ev.type === 'envido-result' && ev.accepted) {
        ev.points.forEach((p, seat) => { if (snap.view.teams[seat] !== undefined) say(seat, `Tengo ${p}`); });
      }
    });
    $('log').replaceChildren(...logLines.map((l) => el('li', '', l)));
  }

  // ---------- render principal ----------

  function renderTable() {
    const view = snap.view;
    if (!view) return;
    const fresh = view.handNo !== shownHandNo;
    shownHandNo = view.handNo;
    if (fresh) {
      selected = null;
      const cards = view.handCounts.reduce((t, n) => t + n, 0);
      for (let i = 0; i < cards; i++) Sound.play('deal', { delay: i * DEAL_STEP_S });
    }
    seedDust();
    renderBoard(view);
    renderRivals(view, fresh);
    renderTricks(view);
    renderHand(view, fresh);
    renderActions(view);
    renderSigns();

    const myTurn = view.legal.length > 0 && view.phase !== 'hand-over';
    const seatTurn = view.spectator
      ? (view.pending ? view.pending.responders.includes(view.me) : view.turn === view.me) && view.phase !== 'hand-over'
      : myTurn;
    $('seat-you').classList.toggle('turn', seatTurn);
    if (myTurn && !wasMyTurn) Sound.play('turn');
    wasMyTurn = myTurn;

    const card = selected !== null ? view.hand[selected] : null;
    $('status').replaceChildren(el('span', '', T.statusText(view, snap.seats, card)));

    const ended = snap.status === 'ended';
    $('end').hidden = !ended;
    if (ended) {
      const end = T.endText(view, snap.seats);
      $('end-title').textContent = end.title;
      $('end-text').textContent = end.text;
      const host = !view.spectator && snap.host === snap.seat;
      $('again').hidden = !host;
      $('end-wait').hidden = host;
    }
  }

  /** Un click (o tecla) en cualquier lado salta el canto o el cierre de mano que esté en pantalla. */
  function skipFx() {
    const shoutBox = $('shout');
    const handBox = $('handend');
    if (!shoutBox.classList.contains('go') && !handBox.classList.contains('go')) return;
    clearTimeout(shoutTimer);
    clearInterval(rollTimer);
    clearTimeout(handEndTimer);
    clearInterval(countTimer);
    shoutBox.classList.remove('go');
    handBox.classList.remove('go');
    handBox.querySelectorAll('.coin').forEach((c) => c.remove());
    document.querySelectorAll('.spark').forEach((s) => s.remove());
  }
  // En captura y sin frenar el evento: el mismo click sigue a lo que haya debajo (por ejemplo, "Quiero").
  document.addEventListener('pointerdown', skipFx, true);
  document.addEventListener('keydown', skipFx, true);

  // ---------- inicio ----------

  function unlockAudio() {
    Sound.unlock();
    UNLOCK_EVENTS.forEach((type) => document.removeEventListener(type, unlockAudio));
  }
  UNLOCK_EVENTS.forEach((type) => document.addEventListener(type, unlockAudio));
  document.addEventListener('click', () => closeMenus());

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
    const token = store.get(sessionKey(code));
    if (token) {
      session = { code, token };
      show('lobby');
      connect();
    } else {
      openJoin(code);
    }
  }
})();
