/* Mesa de las salas (2, 3 o 4 asientos): planilla, rivales, bazas, mano, acciones, señas, carteles y telón.
 * No sabe de red: dibuja snapshots con la forma que arma server/rooms.js (snapshotOf) y manda las jugadas por opts.send.
 * La usan sala.js (contra el servidor) y el arcade dúo (con una sala local en el navegador).
 *
 * TrucoSalaTable.create({ Sound, send, sendSign, onKick, showEnd, decorateCard })
 *   -> { show(snapshot), reset(), notice(text) } */
(function () {
  'use strict';

  const T = window.SalaText;
  const BUBBLE_MS = 2200;
  const NOTICE_MS = 5000;
  const LOG_LIMIT = 80;
  const KNOCK_MS = 150;
  const DEAL_STEP_S = 0.12;
  const SCORE_FX_MS = 1100;
  const TARGET = window.Truco.TARGET;

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  function create(opts) {
    const Sound = opts.Sound;
    const showEndScreen = opts.showEnd !== false;
    let snap = null;
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

    function notice(text) {
      const feed = $('sign-feed');
      const item = el('p', 'notice', text);
      feed.append(item);
      setTimeout(() => item.remove(), NOTICE_MS);
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
      if (card.up && window.TrucoCardBadges) window.TrucoCardBadges.decorate(node, card, cardName(card));
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
      const canKick = Boolean(opts.onKick) && !snap.spectator && snap.host === snap.seat && snap.status === 'playing';
      rivalNodes.forEach((node, seat) => {
        const info = snap.seats[seat];
        const awaiting = view.pending ? view.pending.responders.includes(seat) : view.turn === seat;
        node.box.classList.toggle('turn', awaiting && view.phase !== 'hand-over');
        node.box.classList.toggle('ally', !snap.spectator && toneOf(seat) === 'ally');
        node.box.classList.toggle('off', info.kind === 'human' && !info.connected);
        const head = [el('span', 'rival-name', info.name)];
        if (view.mano === seat) head.push(el('span', 'chip', 'Mano'));
        if (!snap.spectator && toneOf(seat) === 'ally') head.push(el('span', 'tag', 'Compañero'));
        const hint = (view.oppEnvidoHigh || []).find((o) => o.seat === seat);
        if (hint && view.envido && !view.envido.done) head.push(el('span', 'tag hint-tag', hint.high ? 'Envido +27' : 'Envido 27 o menos'));
        node.head.replaceChildren(...head);
        const count = view.handCounts[seat];
        const seen = peekedCards(view, seat);
        const peekKey = JSON.stringify(seen);
        if (node.count !== count || node.peekKey !== peekKey || fresh) {
          node.hand.replaceChildren(...Array.from({ length: count }, (_, i) => {
            const n = seen[i] ? cardFace(seen[i], false) : cardBack();
            if (seen[i]) n.classList.add('peeked');
            n.style.setProperty('--i', String(i + 3));
            if (fresh) n.classList.add('deal');
            return n;
          }));
          node.count = count;
          node.peekKey = peekKey;
        }
        const side = [];
        if (info.kind === 'human' && !info.connected) {
          side.push(el('span', 'hint', 'Sin conexión'));
          if (canKick) {
            const kick = el('button', 'btn mini', 'Pasar a bot');
            kick.type = 'button';
            kick.addEventListener('click', () => opts.onKick(seat));
            side.push(kick);
          }
        }
        node.side.replaceChildren(...side);
      });
    }

    /** Cartas de un rival que se ven por amuletos del arcade (Espejito, Bola de cristal), en el orden de su mano.
     * Las que no se ven quedan como null (dorso). */
    function peekedCards(view, seat) {
      const all = (view.oppHands || []).find((o) => o.seat === seat);
      if (all) return all.hand;
      const one = (view.oppPeeks || []).find((o) => o.seat === seat);
      if (!one) return [];
      const key = (c) => `${c.num}${c.suit}`;
      const stillHeld = !view.played[seat].some((c) => key(c) === key(one.card));
      return stillHeld ? [one.card] : [];
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
        await opts.send(action);
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
        await opts.sendSign(id);
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
    let queuedHandEnd = null; // fin de mano que espera a que termine el canto en pantalla

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
      shoutTimer = setTimeout(endShout, ROLL_HOLD_MS);
    }

    /** Se va el canto; si un fin de mano lo estaba esperando, recién ahora sube el telón. */
    function endShout() {
      clearTimeout(shoutTimer);
      clearInterval(rollTimer);
      $('shout').classList.remove('go');
      if (!queuedHandEnd) return;
      const ev = queuedHandEnd;
      queuedHandEnd = null;
      showHandEnd(ev);
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
      shoutTimer = setTimeout(endShout, SHOUT_MS);
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

    /** Si hay un canto en pantalla (por ejemplo "No quiero" al truco), el telón espera a que termine. */
    function handEnd(ev) {
      if ($('shout').classList.contains('go')) queuedHandEnd = ev;
      else showHandEnd(ev);
    }

    function showHandEnd(ev) {
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
        case 'truco-call': knockTable(ev.level); break;
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
            if (ev.winner === mine) Sound.play('trickWin', { delay: 0.25 });
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
      if ($('log')) $('log').replaceChildren(...logLines.map((l) => el('li', '', l)));
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
      if (window.TrucoCardBadges) window.TrucoCardBadges.dropStaleTip();

      const myTurn = view.legal.length > 0 && view.phase !== 'hand-over';
      const seatTurn = view.spectator
        ? (view.pending ? view.pending.responders.includes(view.me) : view.turn === view.me) && view.phase !== 'hand-over'
        : myTurn;
      $('seat-you').classList.toggle('turn', seatTurn);
      if (myTurn && !wasMyTurn) Sound.play('turn');
      wasMyTurn = myTurn;

      const card = selected !== null ? view.hand[selected] : null;
      $('status').replaceChildren(el('span', '', T.statusText(view, snap.seats, card)));

      if (!showEndScreen) return; // el arcade muestra su propio cierre (tienda o fin de run)
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
      document.querySelectorAll('.spark').forEach((s) => s.remove());
      // Saltar el canto adelanta el telón que lo esperaba; otro toque salta el telón.
      if (shoutBox.classList.contains('go')) { endShout(); return; }
      clearTimeout(handEndTimer);
      clearInterval(countTimer);
      handBox.classList.remove('go');
      handBox.querySelectorAll('.coin').forEach((c) => c.remove());
    }
    // En captura y sin frenar el evento: el mismo click sigue a lo que haya debajo (por ejemplo, "Quiero").
    document.addEventListener('pointerdown', skipFx, true);
    document.addEventListener('keydown', skipFx, true);
    document.addEventListener('click', () => closeMenus());

    /** Dibuja un snapshot nuevo: cuenta los eventos que no se vieron y redibuja. */
    function show(s) {
      snap = s;
      const fresh = s.events.filter((ev) => ev.seq > lastSeq);
      lastSeq = Math.max(lastSeq, s.seq);
      ingest(fresh, !firstSnapshot);
      firstSnapshot = false;
      renderTable();
    }

    function reset() {
      seenPlays.clear();
      shownScores.clear();
      logLines.length = 0;
      selected = null;
      shownHandNo = -1;
      rivalKey = '';
      actionsKey = '';
      firstSnapshot = true;
      lastSeq = 0;
    }

    return { show, reset, notice };
  }

  window.TrucoSalaTable = { create };
})();
