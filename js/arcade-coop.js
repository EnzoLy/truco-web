/* Entrada del arcade dúo: "¿Con quién jugás?".
 * - Con un bot: la run local de siempre (arcade-duo-ui.js).
 * - Con un amigo: una sala del servidor (server/rooms.js, room.arcade) con la run compartida. Se invita con el
 *   link /arcade-duo?sala=CODIGO; el amigo se sienta en el lugar del compañero. La mesa la dibuja sala-table.js
 *   con los snapshots del servidor y la tienda la dibuja arcade-shell.js, mandando cada compra al servidor. */
(function () {
  'use strict';

  const A = window.TrucoArcade;
  const RC = window.TrucoRoomClient;
  const Shell = window.TrucoArcadeShell;
  const UI = Shell.ui;
  const Duo = window.TrucoArcadeDuo;
  const BEST_KEY = 'truco.arcade.coop.best';
  const PARTNER_SEAT = A.PARTNER;
  // Antes de la tienda o del fin de run: el telón de la última mano y el cartel tienen que terminar.
  const GAME_END_DELAY_MS = 4600;

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const params = new URLSearchParams(location.search);
  const inviteLink = (code) => `${location.origin}/arcade-duo?sala=${code}`;
  const savedName = () => RC.playerName.get();

  function showError(id, message) {
    const box = $(id);
    box.textContent = message || '';
    box.hidden = !message;
  }

  // ---------- ¿con quién jugás? ----------

  function showPartnerPick() {
    $('pick-bot-status').textContent = Shell.runStatus(Shell.localRun('duo'));
    $('pick-name').value = savedName();
    showError('pick-error', '');
    UI.openOverlay('partner-pick');
    $('with-friend').focus();
  }

  function startWithBot() {
    UI.openOverlay(null);
    history.replaceState(null, '', `${location.pathname}?seguir`);
    Duo.startWithBot();
  }

  async function createRoom() {
    const name = $('pick-name').value.trim();
    RC.playerName.set(name);
    showError('pick-error', '');
    try {
      enter(await RC.call('', { mode: 'arcade', name }));
    } catch (err) {
      showError('pick-error', err.message);
    }
  }

  // ---------- unirse por link ----------

  let joinCode = '';

  async function openJoin(code, message) {
    joinCode = code;
    try {
      const room = await RC.info(code);
      if (room.kind !== 'arcade') {
        location.replace(`/sala?sala=${room.code}`);
        return;
      }
      const host = room.seats[0].name;
      const started = room.status !== 'lobby';
      $('join-sub').textContent = started
        ? `La run de ${host} ya empezó: no se puede entrar a la mitad.`
        : `${host} te invita a jugar el arcade en dúo, contra dos rivales bot.`;
      $('join-go').disabled = started;
      $('join-name').value = savedName();
      showError('join-error', message || '');
      UI.openOverlay('coop-join');
      $('join-name').focus();
    } catch (err) {
      history.replaceState(null, '', location.pathname);
      showPartnerPick();
      showError('pick-error', err.message);
    }
  }

  async function joinRoom() {
    const name = $('join-name').value.trim();
    RC.playerName.set(name);
    showError('join-error', '');
    try {
      enter(await RC.call(`/${encodeURIComponent(joinCode)}/join`, { name }));
    } catch (err) {
      showError('join-error', err.message);
    }
  }

  // ---------- sala con amigo ----------

  let session = null; // { code, token }
  let snap = null;
  let lastSig = '';
  let lastSeq = 0;
  let shownStatus = null; // la pantalla que se está mostrando: lobby | playing | shop | ended
  let introRound = 0;
  let endTimer = null;
  let table = null;

  async function post(path, body = {}) {
    const data = await RC.call(`/${session.code}${path}`, { token: session.token, ...body });
    poller.kick();
    return data;
  }

  const poller = RC.createPoller({
    urlFor: () => (session ? `/api/rooms/${encodeURIComponent(session.code)}/state?token=${encodeURIComponent(session.token)}&since=${lastSeq}` : null),
    onData: (data) => onSnapshot(data),
    onDenied() {
      const { code } = session;
      RC.session.remove(code);
      session = null;
      openJoin(code, 'Ya no sos parte de esta sala o la sala se cerró.');
    },
  });

  function mountTable() {
    if (table) return;
    table = window.TrucoSalaTable.create({
      Sound: Duo.Sound,
      showEnd: false,
      send: (action) => post('/act', { action }),
      sendSign: (sign) => post('/sign', { sign }),
      onKick: (seat) => post('/seat', { seat, kind: 'bot' }).catch((err) => table.notice(err.message)),
    });
  }

  function enter({ code, token }) {
    session = { code, token };
    RC.session.set(code, token);
    history.replaceState(null, '', `${location.pathname}?sala=${code}`);
    mountTable();
    snap = null;
    lastSig = '';
    lastSeq = 0;
    poller.kick();
  }

  const mySeat = () => snap.seat;
  const whoAmI = () => (mySeat() === PARTNER_SEAT ? 'partner' : 'me');
  const isHost = () => snap.host === snap.seat;
  const names = () => ({ me: snap.seats[0].name, partner: snap.seats[PARTNER_SEAT].name });
  const buddy = () => snap.seats[mySeat() === PARTNER_SEAT ? 0 : PARTNER_SEAT];

  function onSnapshot(s) {
    const sig = JSON.stringify(s);
    if (sig === lastSig) return;
    lastSig = sig;
    // En la primera consulta llegan eventos viejos: no se festejan monedas que ya estaban.
    const fresh = snap ? s.events.filter((ev) => ev.seq > lastSeq) : [];
    snap = s;
    lastSeq = Math.max(lastSeq, s.seq);
    if (s.status === 'lobby') {
      clearTimeout(endTimer);
      table.reset();
      shownStatus = 'lobby';
      renderLobby();
      UI.openOverlay('coop-lobby');
      return;
    }
    const { run } = s.arcade;
    UI.renderRun(run, whoAmI(), names());
    $('hud-best').textContent = String(bestOf(run.wins));
    table.show(s);
    const gains = fresh.filter((ev) => ev.type === 'arcade-gain');
    if (gains.length) UI.showGains(gains);
    route(s, run);
  }

  /** Qué pantalla va según el estado de la sala. Al terminar una partida se espera al telón antes de cambiar. */
  function route(s, run) {
    if (s.status === 'playing') {
      clearTimeout(endTimer);
      endTimer = null;
      if (shownStatus !== 'playing' || introRound !== run.round) {
        shownStatus = 'playing';
        introRound = run.round;
        UI.showIntro(run);
      }
      return;
    }
    if (endTimer) return; // ya se está esperando el telón
    if (shownStatus === 'playing') {
      endTimer = setTimeout(() => {
        endTimer = null;
        shownStatus = snap.status;
        drawEnd();
      }, GAME_END_DELAY_MS);
      return;
    }
    shownStatus = s.status;
    drawEnd();
  }

  function drawEnd() {
    if (!snap || snap.status === 'lobby' || snap.status === 'playing') return;
    if (snap.status === 'shop') drawShop(true);
    else drawOver();
  }

  // ---------- tienda compartida ----------

  async function shopOp(body, message) {
    try {
      await post('/shop', body);
      $('shop-msg').textContent = message || '';
    } catch (err) {
      $('shop-msg').textContent = err.message;
    }
  }

  function drawShop(opening) {
    const { run, ready } = snap.arcade;
    const waiting = Boolean(ready[mySeat()]);
    const other = buddy();
    UI.renderShop(run, {
      who: whoAmI(),
      names: names(),
      buy: (index, message) => shopOp({ op: 'buy', index }, message),
      sell: (id, message) => shopOp({ op: 'sell', id }, message),
      reroll: () => shopOp({ op: 'reroll' }, 'Ofertas nuevas.'),
      next: () => shopOp({ op: 'ready' }, `Esperando a ${other.name}…`),
      nextLabel: waiting ? 'Esperando…' : 'Listo',
      nextDisabled: waiting,
    });
    if (!waiting && ready[other.seat] && other.kind === 'human') $('shop-msg').textContent = `${other.name} ya está listo: falta que des Listo.`;
    if (opening && $('shop').hidden) {
      $('shop-msg').textContent = other.kind === 'human' ? `La bolsa es de los dos: cada uno compra para sí. Cuando estén listos, sigue la ronda ${run.round + 1}.` : '';
      $('shop').classList.remove('settled');
      UI.openOverlay('shop');
    } else {
      // Al redibujar por una compra del otro no se repite la entrada de las cartas.
      $('shop').classList.add('settled');
    }
    const gone = isHost() && other.kind === 'human' && !other.connected;
    $('shop-kick').hidden = !gone;
    if (gone) $('shop-msg').textContent = `${other.name} se desconectó. Podés esperarlo o seguir con un bot.`;
  }

  async function shopOpSeat() {
    try {
      await post('/seat', { seat: PARTNER_SEAT, kind: 'bot' });
    } catch (err) {
      $('shop-msg').textContent = err.message;
    }
  }

  // ---------- fin de run ----------

  /** Récord del dúo con amigo, guardado en este navegador (cada uno tiene el suyo). */
  function bestOf(wins) {
    return Math.max(Number(RC.store.get(BEST_KEY)) || 0, wins);
  }

  function saveBest(wins) {
    const best = bestOf(wins);
    RC.store.set(BEST_KEY, String(best));
    return best;
  }

  function drawOver() {
    const { run } = snap.arcade;
    UI.showOver(run, saveBest(run.wins));
    $('over-again').hidden = !isHost();
    $('over-wait').hidden = isHost();
    $('over-wait').textContent = `Esperando que ${snap.seats[snap.host].name} arme otra run.`;
  }

  // ---------- lobby ----------

  function seatRow(seat, label) {
    const s = snap.seats[seat];
    const li = el('li', `seat-item ${s.kind}`);
    const who = el('span', 'seat-who');
    const name = s.kind === 'empty' ? 'Esperando a tu compañero…' : s.name;
    const tags = [seat === snap.seat ? 'Vos' : label, s.kind === 'bot' ? 'Bot' : null, s.kind === 'human' && !s.connected ? 'Sin conexión' : null].filter(Boolean);
    who.append(el('strong', '', name), el('small', '', tags.join(' · ')));
    li.append(who);
    return li;
  }

  function renderLobby() {
    const partner = snap.seats[PARTNER_SEAT];
    const host = isHost();
    $('coop-code').textContent = snap.code;
    $('coop-seats').replaceChildren(seatRow(0, 'Anfitrión'), seatRow(PARTNER_SEAT, 'Compañero'));
    $('coop-copy').hidden = !host || partner.kind !== 'empty';
    $('coop-copy').textContent = navigator.share ? 'Compartir link' : 'Copiar link';
    // Un amigo que se fue (por ejemplo después de una run) se puede sacar para invitar a otro o poner un bot.
    const ghost = partner.kind === 'human' && !partner.connected;
    $('coop-bot').hidden = !host || (partner.kind === 'human' && !ghost);
    $('coop-bot').textContent = partner.kind === 'bot' ? 'Mejor invito a alguien' : ghost ? `Sacar a ${partner.name}` : 'Poner un bot';
    $('coop-start').hidden = !host;
    $('coop-start').disabled = partner.kind === 'empty';
    $('coop-hint').textContent = host
      ? (partner.kind === 'empty' ? 'Mandale el link a quien quieras: entra directo a tu lugar de compañero. O jugá con un bot.' : '¡Listos! Empezá cuando quieras.')
      : `Esperando que ${snap.seats[snap.host].name} empiece la run.`;
  }

  async function lobbyAction(path, body) {
    showError('coop-error', '');
    try {
      await post(path, body);
    } catch (err) {
      showError('coop-error', err.message);
    }
  }

  // ---------- inicio ----------

  $('with-bot').addEventListener('click', startWithBot);
  $('with-friend').addEventListener('click', createRoom);
  $('join-go').addEventListener('click', joinRoom);
  $('coop-copy').addEventListener('click', () => RC.share(inviteLink(snap.code), $('coop-copy'), 'Jugá el arcade de truco conmigo'));
  $('coop-bot').addEventListener('click', () => lobbyAction('/seat', { seat: PARTNER_SEAT, kind: snap.seats[PARTNER_SEAT].kind === 'empty' ? 'bot' : 'empty' }));
  $('shop-kick').addEventListener('click', () => shopOpSeat());
  $('coop-start').addEventListener('click', () => lobbyAction('/start'));

  // Estos botones los comparten las dos formas de jugar: solo responden a la run con amigo cuando hay sala.
  $('intro-go').addEventListener('click', () => { if (session) UI.openOverlay(null); });
  $('over-again').addEventListener('click', () => { if (session) post('/rematch').catch((err) => { $('over-text').textContent = err.message; }); });

  const code = (params.get('sala') || '').toUpperCase();
  if (code) {
    const token = RC.session.get(code);
    if (token) enter({ code, token });
    else openJoin(code);
  } else if (params.has('seguir')) {
    Duo.startWithBot();
  } else {
    showPartnerPick();
  }
})();
