/* Interfaz: solo dibuja el estado y llama a Truco.step / bot.decide, nada de reglas aca.
 * La mesa se monta con TrucoTable.mount(opts); bot.html la arranca sola (data-autostart).
 * opts (todo opcional, lo usa el modo arcade):
 *   bot, newGame(), initialState, idle (montar sin repartir), botName, botRef ("el bot"),
 *   onEvents(events, state), onGameEnd(state) -> true si se encarga del final. */
(function () {
  'use strict';

  const autostart = document.currentScript && document.currentScript.hasAttribute('data-autostart');

  function mount(opts = {}) {
    const { newGame, dealHand, step, viewFor, legalActions, TARGET, cardKey } = window.Truco;
    const HUMAN = 0;
    const BOT = 1;
    const BOT_DELAY_MIN_MS = 700;
    const BOT_DELAY_SPREAD_MS = 600;
    const BUBBLE_MS = 2200;
    const LOG_LIMIT = 60;
    const RESET_CONFIRM_MS = 3000;
    const MIN_INSIGHT_SAMPLES = 3;
    const THROW_DY = 110; // de donde sale volando la carta: desde abajo (vos) o desde arriba (rival)
    const THROW_DX = 70;
    const THROW_ROT = 36;
    const DEAL_STEP_S = 0.12;
    const SCORE_FX_MS = 1100;
    const CONFETTI_COUNT = 42;
    const CONFETTI_CLEANUP_MS = 4800;
    const CONFETTI_COLORS = ['var(--signal)', 'var(--porcelain)', 'var(--lacre)', 'var(--lacre-deep)', 'var(--signal-deep)'];

    // Estilo de naipe: ?cartas=... o lo elegido en cartas.html.
    (function pickDeckSkin() {
      let name = new URLSearchParams(location.search).get('cartas');
      if (!name) {
        try { name = localStorage.getItem('truco-cartas'); } catch (err) { name = null; }
      }
      if (name) window.CardArt.setSkin(name);
      let art = new URLSearchParams(location.search).get('dibujo');
      if (!art) {
        try { art = localStorage.getItem('truco-dibujo'); } catch (err) { art = null; }
      }
      if (art) window.CardArt.setArt(art);
    })();

    const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fx = window.TrucoTableFx.create();
    const Sound = window.TrucoSoundFactory.createSound({
      AudioContextCtor: window.AudioContext || window.webkitAudioContext,
      storage: (() => { try { return window.localStorage; } catch (err) { return null; } })(),
      fetchImpl: window.fetch && window.fetch.bind(window),
      baseUrl: '/sounds',
    });

    let bot = opts.bot || new window.TrucoBot.Bot();
    let makeGame = opts.newGame || (() => newGame());
    const names = { name: opts.botName || 'Bot', ref: opts.botRef || 'el bot' };
    const capitalize = (t) => t.charAt(0).toUpperCase() + t.slice(1);
    let state = makeGame();
    let botTimer = null;
    let bubbleTimers = { 0: null, 1: null };
    let lastInsightValues = {};
    let resetArmed = null;
    const logLines = [];

    const $ = (id) => document.getElementById(id);
    const el = (tag, cls, text) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined) n.textContent = text;
      return n;
    };

    // ---------- cartas ----------

    const SUIT_NAMES = { oro: 'oro', copa: 'copa', espada: 'espada', basto: 'basto' };
    const cardName = (c) => `${c.num} de ${SUIT_NAMES[c.suit]}`;

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

    const cardBack = () => {
      const n = el('div', 'card');
      n.setAttribute('aria-hidden', 'true');
      n.append(cardImage(window.CardArt.backUrl(), ''));
      return n;
    };

    // ---------- textos ----------

    const TRUCO_NAMES = ['', 'Truco', 'Retruco', 'Vale cuatro'];
    const ENVIDO_NAMES = { envido: 'Envido', real: 'Real envido', falta: 'Falta envido' };
    const who = (p) => (p === HUMAN ? 'Vos' : names.name);

    function eventText(ev) {
      switch (ev.type) {
        case 'truco-call':
          return ev.raise ? `¡Quiero ${TRUCO_NAMES[ev.level].toLowerCase()}!` : `¡${TRUCO_NAMES[ev.level]}!`;
        case 'truco-response':
          if (ev.response === 'accept') return '¡Quiero!';
          if (ev.response === 'reject') return 'No quiero';
          return null;
        case 'envido-call': return `¡${ENVIDO_NAMES[ev.what]}!`;
        case 'envido-response':
          if (ev.response === 'accept') return '¡Quiero!';
          if (ev.response === 'reject') return 'No quiero';
          return null;
        case 'mazo': return 'Me voy al mazo';
        case 'flor': return '¡Flor!';
        default: return null;
      }
    }

    function logText(ev) {
      switch (ev.type) {
        case 'deal': return `— Mano ${ev.handNo}: reparte ${who(1 - ev.mano)}, es mano ${ev.mano === HUMAN ? 'vos' : names.ref} —`;
        case 'play': return `${who(ev.player)} juega ${cardName(ev.card)}`;
        case 'trick': {
          const res = ev.winner === -1 ? 'parda' : `gana ${ev.winner === HUMAN ? 'vos' : names.ref}`;
          return `Baza ${ev.trickIndex + 1}: ${res}`;
        }
        case 'envido-result':
          return ev.accepted
            ? `Envido: vos ${ev.points[HUMAN]}, ${names.ref} ${ev.points[BOT]}. +${ev.awarded} para ${ev.winner === HUMAN ? 'vos' : names.ref}${bonusText(ev)}`
            : `Envido no querido: +${ev.awarded} para ${ev.winner === HUMAN ? 'vos' : names.ref}${bonusText(ev)}`;
        case 'hand-end': return `Mano terminada: +${ev.points} para ${ev.winner === HUMAN ? 'vos' : names.ref}${bonusText(ev)}`;
        case 'envido-first': return `${who(ev.by)}: envido primero`;
        case 'flor': return `${who(ev.by)}: ¡Flor! +${ev.awarded} (se anula el envido)`;
        default: {
          const t = eventText(ev);
          return t && ev.by !== undefined ? `${who(ev.by)}: ${t}` : t && ev.player !== undefined ? `${who(ev.player)}: ${t}` : null;
        }
      }
    }

    const bonusText = (ev) => (ev.bonus ? ` (${ev.bonus} de amuletos)` : '');

    function say(player, text, kind = '') {
      const b = $(player === HUMAN ? 'you-bubble' : 'bot-bubble');
      b.textContent = text;
      b.classList.remove('show', 'shout-truco', 'shout-envido');
      void b.offsetWidth;
      if (kind) b.classList.add(kind);
      b.classList.add('show');
      clearTimeout(bubbleTimers[player]);
      bubbleTimers[player] = setTimeout(() => b.classList.remove('show'), BUBBLE_MS);
    }

    function pushLog(text) {
      logLines.unshift(text);
      if (logLines.length > LOG_LIMIT) logLines.pop();
    }

    // ---------- render ----------

    // Planilla como en las salas: cuadritos de cinco palitos, 3 malas a la izquierda y 3 buenas a la derecha.
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

    const shownScores = [0, 0];

    function renderScores() {
      const board = $('board');
      board.style.setProperty('--cols', '2');
      board.replaceChildren(...[HUMAN, BOT].map((p) => {
        const label = p === HUMAN ? 'Vos' : names.name;
        const score = Math.min(state.scores[p], TARGET);
        const col = el('div', `plan-col ${p === HUMAN ? 'me' : 'foe'}`);
        const head = el('div', 'col-head');
        head.append(el('span', 'score-name', label), el('span', 'score-num', String(state.scores[p])));
        const tally = el('div', 'tally');
        tally.innerHTML = tallySvg(score, shownScores[p], label);
        col.append(head, tally);
        const gained = score - shownScores[p];
        if (gained > 0) celebrateScore(col, gained);
        shownScores[p] = score;
        return col;
      }));
      const live = state.phase !== 'idle';
      $('bot-name').textContent = names.name;
      $('bot-mano').hidden = !live || state.mano !== BOT;
      $('you-mano').hidden = !live || state.mano !== HUMAN;
    }

    /** Los puntos nuevos salen flotando de la planilla y suenan como fósforos que se prenden. */
    function celebrateScore(row, gained) {
      row.classList.add('scored');
      const pop = el('span', 'score-pop', `+${gained}`);
      pop.setAttribute('aria-hidden', 'true');
      row.append(pop);
      setTimeout(() => { pop.remove(); row.classList.remove('scored'); }, SCORE_FX_MS);
    }

    let dealtHandNo = -1;
    let selected = null; // carta tocada una vez: al tocarla de nuevo se tira

    function renderHands() {
      const fresh = state.handNo !== dealtHandNo && state.phase !== 'idle';
      dealtHandNo = state.handNo;
      if (fresh && state.hands) {
        const cards = state.hands[HUMAN].length + state.hands[BOT].length;
        for (let i = 0; i < cards; i++) Sound.play('deal', { delay: i * DEAL_STEP_S });
      }
      const botHand = $('bot-hand');
      const view = state.hands ? viewFor(state, HUMAN) : null;
      const known = view ? peekedBotCards(view) : new Set();
      botHand.replaceChildren(...(state.hands ? state.hands[BOT].map((c, i) => {
        const n = known.has(cardKey(c)) ? cardFace(c, false) : cardBack();
        if (known.has(cardKey(c))) n.classList.add('peeked');
        n.style.setProperty('--i', String(i + 3));
        if (fresh) n.classList.add('deal');
        return n;
      }) : []));
      const mine = $('you-hand');
      const canPlay = state.phase === 'play' && state.turn === HUMAN;
      mine.replaceChildren(...(state.hands ? state.hands[HUMAN].map((card, index) => {
        const n = cardFace(card, true);
        n.disabled = !canPlay;
        if (canPlay && selected === index) n.classList.add('selected');
        n.style.setProperty('--i', String(index));
        if (fresh) n.classList.add('deal');
        n.addEventListener('click', (e) => {
          e.stopPropagation();
          onHandCard(index);
        });
        return n;
      }) : []));
      $('envido-hint').textContent = view ? envidoHintText(view) : '';
    }

    /** Cartas del bot que podés ver por amuletos (espejito, bola de cristal). */
    function peekedBotCards(view) {
      if (view.oppHand) return new Set(view.oppHand.map(cardKey));
      if (view.oppPeek) return new Set([cardKey(view.oppPeek)]);
      return new Set();
    }

    function envidoHintText(view) {
      if (view.myFlor && !state.florDone) return `¡Tenés flor! Cantala antes de tirar`;
      const mine = `Tenés ${view.myEnvido} de envido`;
      if (view.oppEnvidoHigh === undefined) return mine;
      return `${mine} · ${capitalize(names.ref)} tiene ${view.oppEnvidoHigh ? 'más de 27' : '27 o menos'}`;
    }

    const seenPlays = new Set();

    const roleOf = (p) => (p === HUMAN ? 'me' : 'foe');
    const initialOf = (p) => (p === HUMAN ? 'V' : (names.name[0] || 'B').toUpperCase());
    const playKey = (p, i) => `${state.handNo}-${p}-${i}`;

    /** En la baza en juego hay a lo sumo una carta (con dos jugadores, la segunda la cierra): esa va ganando. */
    function leadingPlayer() {
      if (!state.played || !['play', 'respond-truco', 'respond-envido'].includes(state.phase)) return null;
      const trick = state.results.length;
      const played = [HUMAN, BOT].filter((p) => state.played[p][trick]);
      return played.length === 1 ? { trick, player: played[0] } : null;
    }

    function trickResult(winner) {
      if (winner === undefined) return '';
      if (winner === -1) return 'Parda';
      return winner === HUMAN ? 'Ganás vos' : `Gana ${names.name}`;
    }

    /** Bazas como en las salas: las dos cartas encimadas, borde del color de quien la tiró, y quien va ganando. */
    function renderTricks() {
      const wrap = $('tricks');
      wrap.className = 'tricks n2';
      const legendDot = (role, text) => {
        const item = el('span', '', text);
        const dot = el('i');
        dot.style.background = `var(--role-${role})`;
        item.prepend(dot);
        return item;
      };
      $('baza-legend').replaceChildren(legendDot('me', 'Vos'), legendDot('foe', names.name));
      const leading = leadingPlayer();
      wrap.replaceChildren(...[0, 1, 2].map((i) => {
        const winner = state.results ? state.results[i] : undefined;
        const box = el('div', `baza${winner === undefined ? '' : winner === -1 ? ' parda' : winner === HUMAN ? ' won-me' : ' won-foe'}`);
        const stack = el('div', 'stack');
        [BOT, HUMAN].forEach((p) => {
          const card = state.played ? state.played[p][i] : null;
          if (card) stack.append(playedCard(card, p, i, leading));
        });
        const live = leading && leading.trick === i;
        if (live) box.classList.add('live');
        const result = live ? (leading.player === HUMAN ? 'Vas ganando' : `Va ganando ${names.name}`) : trickResult(winner);
        box.append(stack, el('span', 'trick-label', `Baza ${i + 1}`));
        if (result) {
          const note = el('strong', 'trick-result', result);
          if (live) note.classList.add(`lead-${roleOf(leading.player)}`);
          box.append(note);
        }
        return box;
      }));
    }

    function playedCard(card, p, i, leading) {
      const face = cardFace(card, true);
      face.classList.add(`role-${roleOf(p)}`);
      if (leading && leading.trick === i && leading.player === p) { face.classList.add('leading'); face.dataset.lead = 'Gana'; }
      const tag = el('span', `who ${roleOf(p)}`, initialOf(p));
      tag.setAttribute('aria-hidden', 'true');
      face.append(tag);
      const caption = `${who(p)} · Baza ${i + 1}`;
      if (!card.up) face.title = `${caption}: ${cardName(card)}`;
      face.setAttribute('aria-label', `${caption}: ${face.getAttribute('aria-label')}`);
      fx.peekable(face, { src: window.CardArt.url(card), name: cardName(card), caption });
      const key = playKey(p, i);
      if (!seenPlays.has(key)) {
        seenPlays.add(key);
        face.classList.add('drop');
        face.style.setProperty('--fy', `${p === HUMAN ? THROW_DY : -THROW_DY}px`);
        face.style.setProperty('--fx', `${Math.round((Math.random() - 0.5) * THROW_DX)}px`);
        face.style.setProperty('--fr', `${Math.round((Math.random() - 0.5) * THROW_ROT)}deg`);
      }
      return face;
    }

    function button(label, cls, onClick, index = 0) {
      const b = el('button', `btn ${cls || ''}`.trim(), label);
      b.type = 'button';
      b.style.setProperty('--i', String(index));
      b.addEventListener('click', onClick);
      return b;
    }

    function onHandCard(index) {
      if (state.phase !== 'play' || state.turn !== HUMAN || botTimer) return;
      if (selected === index) return humanAct({ type: 'play', index });
      selected = index;
      Sound.play('select');
      renderHands();
      renderStatus();
    }

    function clearSelection() {
      if (selected === null) return;
      selected = null;
      renderHands();
      renderStatus();
    }

    // Envido, real envido y falta envido van juntos en un menú que se abre hacia arriba.
    const ENVIDO_MENU_TITLE = { 'respond-truco': 'Envido primero', 'respond-envido': 'Subir' };
    const ENVIDO_MENU_HINT = { envido: 'Dos puntos', real: 'Tres puntos', falta: 'Lo que falta para ganar' };

    function closeMenus(except) {
      document.querySelectorAll('.menu-wrap.open').forEach((w) => {
        if (w === except) return;
        w.classList.remove('open');
        w.querySelector('.btn').setAttribute('aria-expanded', 'false');
      });
    }

    function envidoMenu(options) {
      const wrap = el('div', 'menu-wrap');
      const trigger = button(ENVIDO_MENU_TITLE[state.phase] || 'Envido', 'cool menu-trigger', () => {});
      trigger.append(el('span', 'caret'));
      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.setAttribute('aria-expanded', 'false');

      const menu = el('div', 'menu');
      menu.setAttribute('role', 'menu');
      options.forEach((a, i) => {
        const item = el('button', 'menu-item');
        item.type = 'button';
        item.setAttribute('role', 'menuitem');
        item.style.setProperty('--k', String(options.length - 1 - i));
        item.append(el('span', 'menu-name', state.phase === 'respond-envido' && a.what === 'envido' ? 'Envido otra vez' : ENVIDO_NAMES[a.what]), el('span', 'menu-hint', ENVIDO_MENU_HINT[a.what]));
        item.addEventListener('click', () => humanAct({ type: 'envido', what: a.what }));
        menu.append(item);
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

    function renderActions() {
      const box = $('actions');
      box.replaceChildren();
      if (state.phase === 'hand-over' || state.phase === 'game-over' || state.phase === 'idle') return;
      if (state.turn !== HUMAN) return;
      const legal = legalActions(state, HUMAN);
      const nodes = [];
      const hasType = (t) => legal.filter((a) => a.type === t);

      if (state.phase === 'respond-truco' || state.phase === 'respond-envido') {
        nodes.push(button('Quiero', 'primary', () => humanAct({ type: 'accept' })));
        nodes.push(button('No quiero', 'danger', () => humanAct({ type: 'reject' })));
      }
      if (hasType('truco').length) {
        const level = state.phase === 'respond-truco' ? state.pending.level + 1 : state.trucoLevel + 1;
        const label = state.phase === 'respond-truco' ? `Quiero ${TRUCO_NAMES[level].toLowerCase()}` : TRUCO_NAMES[level];
        nodes.push(button(label, 'hot', () => humanAct({ type: 'truco' })));
      }
      const envidos = hasType('envido');
      if (envidos.length === 1) {
        const name = ENVIDO_NAMES[envidos[0].what];
        const label = state.phase === 'respond-envido' ? `Subo: ${name.toLowerCase()}` : name;
        nodes.push(button(label, 'cool', () => humanAct({ type: 'envido', what: envidos[0].what })));
      } else if (envidos.length > 1) {
        nodes.push(envidoMenu(envidos));
      }
      if (hasType('flor').length) nodes.push(button('Flor', 'cool', () => humanAct({ type: 'flor' })));
      if (hasType('mazo').length) nodes.push(button('Mazo', 'ghost', () => humanAct({ type: 'mazo' })));
      nodes.forEach((n, i) => n.style.setProperty('--i', String(i)));
      box.append(...nodes);
    }

    function humanPrompt() {
      switch (state.phase) {
        case 'respond-truco':
          return `${capitalize(names.ref)} cantó ${TRUCO_NAMES[state.pending.level]}. ¿Qué respondés?`;
        case 'respond-envido':
          return `${capitalize(names.ref)} cantó ${state.pending.stack.map((w) => ENVIDO_NAMES[w]).join(', ')}. ¿Qué respondés?`;
        default: {
          const card = selected !== null && state.hands ? state.hands[HUMAN][selected] : null;
          return card ? `Tocá otra vez el ${cardName(card)} para tirarlo.` : 'Te toca: tocá una carta para elegirla o cantá.';
        }
      }
    }

    function renderStatus() {
      const s = $('status');
      s.replaceChildren();
      if (state.phase === 'idle') return;
      if (state.phase === 'hand-over') {
        const r = state.handResult;
        s.append(el('span', '', `${r.winner === HUMAN ? 'Ganaste' : `Ganó ${names.ref}`} la mano: +${r.points}`));
        s.append(dealButton());
        scheduleAutoDeal();
        return;
      }
      if (state.phase === 'game-over') return;
      if (state.turn === BOT) {
        s.append(el('span', 'hint thinking', `${capitalize(names.ref)} está pensando`));
        return;
      }
      s.append(el('span', '', humanPrompt()));
    }

    function renderInsights() {
      if (!$('insights')) return;
      const list = bot.insights();
      const nodes = list.map((i) => {
        const row = el('div', 'insight');
        const prev = lastInsightValues[i.key];
        if (prev !== undefined && Math.abs(prev - i.value) > 0.001) row.classList.add('changed');
        const top = el('div', 'insight-top');
        const hasData = i.n >= MIN_INSIGHT_SAMPLES;
        top.append(el('span', 'insight-title', i.title), el('span', 'insight-val', hasData ? i.display : 'sin datos'));
        const meter = el('div', 'meter');
        const bar = el('i');
        bar.style.width = hasData ? `${Math.round(i.value * 100)}%` : '0%';
        if (!hasData) row.classList.add('nodata');
        meter.append(bar);
        row.append(top, meter, el('p', 'insight-note', i.note), el('span', 'insight-n', `${i.n} ${i.n === 1 ? 'dato' : 'datos'}`));
        return row;
      });
      lastInsightValues = Object.fromEntries(list.map((i) => [i.key, i.value]));
      $('insights').replaceChildren(...nodes);
      const m = bot.model;
      $('brain-sub').textContent = m.hands === 0
        ? 'Todavía no jugaron ninguna mano. Cuanto más juegues, mejor te lee.'
        : `Vio ${m.hands} ${m.hands === 1 ? 'mano' : 'manos'} y ${m.games} ${m.games === 1 ? 'partida' : 'partidas'} (ganaste ${m.humanWins}). Se ajusta solo, y lo recuerda en este navegador.`;
    }

    function renderLog() {
      $('log').replaceChildren(...logLines.map((t) => el('li', '', t)));
    }

    let wasMyTurn = false;

    function render() {
      renderScores();
      renderHands();
      renderTricks();
      renderActions();
      renderStatus();
      renderInsights();
      renderLog();
      if (window.TrucoCardBadges) window.TrucoCardBadges.dropStaleTip();
      const myTurn = state.turn === HUMAN && ['play', 'respond-truco', 'respond-envido'].includes(state.phase);
      $('seat-you').classList.toggle('turn', myTurn);
      if (myTurn && !wasMyTurn) Sound.play('turn', { delay: 0.35 });
      wasMyTurn = myTurn;
      $('rival').classList.toggle('turn', state.turn === BOT && !['hand-over', 'game-over', 'idle'].includes(state.phase));
    }

    // ---------- flujo ----------

    // La baza se cierra cuando la segunda carta todavía está en el aire: sonido y chispas al aterrizar.
    const TRICK_FX_MS = 380;
    const HAND_REASONS = { tricks: 'Ganó las bazas', 'truco-reject': 'No quisieron el truco', mazo: 'Se fue al mazo' };
    const SHOUT_KINDS = { 'truco-call': 'truco', 'envido-call': 'envido', mazo: 'noquiero', flor: 'flor' };

    const shoutKind = (ev) => (ev.type === 'truco-call' ? 'shout-truco' : ev.type === 'envido-call' ? 'shout-envido' : '');

    /** Cartel gigante de los cantos, como en las salas. */
    function shoutFor(ev, text, speaker) {
      let kind = SHOUT_KINDS[ev.type];
      if (ev.type === 'truco-response' || ev.type === 'envido-response') kind = ev.response === 'accept' ? 'quiero' : ev.response === 'reject' ? 'noquiero' : 'truco';
      if (!kind || !text) return;
      fx.shout({ kind, text, who: speaker === undefined ? '' : who(speaker), level: ev.type === 'truco-call' ? ev.level : 1 });
    }

    /** Cada hecho del juego tiene su sonido y su efecto. */
    function reactToEvent(ev) {
      switch (ev.type) {
        case 'play':
          Sound.play('play');
          break;
        case 'truco-call':
          fx.knock(ev.level);
          break;
        case 'envido-call':
        case 'flor':
          Sound.play('envido');
          break;
        case 'truco-response':
        case 'envido-response':
          if (ev.response === 'accept') Sound.play('quiero');
          else if (ev.response === 'reject') Sound.play('noquiero');
          break;
        case 'mazo':
          Sound.play('mazo');
          break;
        case 'trick':
          if (ev.winner === -1) break;
          if (ev.winner === HUMAN) Sound.play('trickWin', { delay: TRICK_FX_MS / 1000 });
          setTimeout(() => fx.sparks(ev.winner === HUMAN), TRICK_FX_MS);
          break;
        case 'hand-end':
          fx.handEnd({
            won: ev.winner === HUMAN,
            title: ev.winner === HUMAN ? '¡Mano tuya!' : 'Mano del rival',
            why: HAND_REASONS[ev.reason] || '',
            points: ev.points,
          });
          break;
        default:
      }
    }

    function ingest(events) {
      events.forEach((ev) => {
        bot.observe(ev);
        const line = logText(ev);
        if (line) pushLog(line);
        const speak = eventText(ev);
        const speaker = ev.by !== undefined ? ev.by : ev.player;
        reactToEvent(ev);
        shoutFor(ev, speak, speaker);
        if (speak && speaker !== undefined && ev.type !== 'play') say(speaker, speak, shoutKind(ev));
        if (ev.type === 'envido-result' && ev.accepted) {
          say(HUMAN, `Tengo ${ev.points[HUMAN]}`);
          say(BOT, `Tengo ${ev.points[BOT]}`);
        }
      });
      if (opts.onEvents) opts.onEvents(events, state);
    }

    function apply(player, action) {
      selected = null;
      const result = step(state, player, action);
      state = result.state;
      ingest(result.events);
      afterChange();
    }

    function afterChange() {
      render();
      // El cartel final espera a que se vaya el telón de la última mano.
      if (state.phase === 'game-over') return fx.afterCurtain(showEnd);
      if (state.phase !== 'hand-over' && state.turn === BOT) scheduleBot();
    }

    function humanAct(action) {
      if (state.turn !== HUMAN || botTimer) return;
      try {
        apply(HUMAN, action);
      } catch (err) {
        console.error(err);
      }
    }

    function scheduleBot() {
      clearTimeout(botTimer);
      const delay = BOT_DELAY_MIN_MS + Math.random() * BOT_DELAY_SPREAD_MS;
      botTimer = setTimeout(() => {
        botTimer = null;
        botMove();
      }, delay);
    }

    function botMove() {
      let action;
      try {
        action = bot.decide(viewFor(state, BOT));
      } catch (err) {
        console.error('El bot falló, juega una acción segura', err);
        const legal = legalActions(state, BOT);
        action = legal.find((a) => a.type === 'accept') || legal.find((a) => a.type === 'play') || legal[0];
      }
      apply(BOT, action);
    }

    // Reparto automático: cuando se va el telón de fin de mano, una barra llena el botón y reparte sola.
    // Tocar el botón reparte al instante.
    const AUTO_DEAL_MS = 3000;
    const COUNTDOWN_TICK_MS = 200;
    let autoDeal = null; // { handNo, startedAt, timer, ticker }

    function dealButton() {
      const b = button('', 'primary deal-btn', () => dealNext());
      const fill = el('span', 'deal-fill');
      fill.setAttribute('aria-hidden', 'true');
      b.append(fill, el('span', 'deal-label', 'Repartir'), el('span', 'deal-count'));
      b.style.setProperty('--deal-ms', `${AUTO_DEAL_MS}ms`);
      if (autoDeal && autoDeal.startedAt) markCounting(b);
      setTimeout(() => b.focus(), 0);
      return b;
    }

    /** Pinta la cuenta regresiva en el botón; si se redibuja a mitad, la barra sigue desde donde iba. */
    function markCounting(b) {
      const elapsed = Date.now() - autoDeal.startedAt;
      b.style.setProperty('--elapsed', `${elapsed}ms`);
      b.classList.add('counting');
      b.querySelector('.deal-count').textContent = String(Math.max(1, Math.ceil((AUTO_DEAL_MS - elapsed) / 1000)));
    }

    function scheduleAutoDeal() {
      if (autoDeal && autoDeal.handNo === state.handNo) return;
      cancelAutoDeal();
      const handNo = state.handNo;
      autoDeal = { handNo, startedAt: 0, timer: null, ticker: null };
      fx.afterCurtain(() => {
        if (!autoDeal || autoDeal.handNo !== handNo || state.phase !== 'hand-over') return;
        autoDeal.startedAt = Date.now();
        autoDeal.timer = setTimeout(() => dealNext(), AUTO_DEAL_MS);
        autoDeal.ticker = setInterval(() => {
          const b = document.querySelector('#status .deal-btn');
          if (b) markCounting(b);
        }, COUNTDOWN_TICK_MS);
        const b = document.querySelector('#status .deal-btn');
        if (b) markCounting(b);
      });
    }

    function cancelAutoDeal() {
      if (!autoDeal) return;
      clearTimeout(autoDeal.timer);
      clearInterval(autoDeal.ticker);
      autoDeal = null;
    }

    function dealNext() {
      cancelAutoDeal();
      if (state.phase !== 'hand-over' && state.phase !== 'idle') return;
      const r = dealHand(state);
      state = r.state;
      ingest(r.events);
      afterChange();
    }

    function showEnd() {
      const won = state.winner === HUMAN;
      if (won) confetti();
      if (opts.onGameEnd && opts.onGameEnd(state)) return;
      $('end-title').textContent = won ? '¡Ganaste la partida!' : 'Ganó el bot';
      $('end-text').textContent = `${state.scores[HUMAN]} a ${state.scores[BOT]}. ${
        won ? 'El bot toma nota de cómo le ganaste.' : 'El bot ya sabe un poco más de cómo jugás.'}`;
      $('end').hidden = false;
      $('again').focus();
    }

    function confetti() {
      if (REDUCED_MOTION.matches) return;
      const layer = el('div', 'confetti');
      layer.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < CONFETTI_COUNT; i++) {
        const piece = el('i');
        piece.style.setProperty('--x', String(Math.round(Math.random() * 100)));
        piece.style.setProperty('--dx', String(Math.round(Math.random() * 30 - 15)));
        piece.style.setProperty('--d', (Math.random() * 0.7).toFixed(2));
        piece.style.setProperty('--t', (2.2 + Math.random() * 1.4).toFixed(2));
        piece.style.setProperty('--r', (0.5 + Math.random() * 2).toFixed(2));
        piece.style.setProperty('--c', CONFETTI_COLORS[i % CONFETTI_COLORS.length]);
        layer.append(piece);
      }
      document.body.append(layer);
      setTimeout(() => layer.remove(), CONFETTI_CLEANUP_MS);
    }

    /** Arranca una partida nueva. next permite cambiar de rival: { bot, newGame, botName, botRef }. */
    function newMatch(next = {}) {
      clearTimeout(botTimer);
      botTimer = null;
      if (next.bot) bot = next.bot;
      if (next.newGame) makeGame = next.newGame;
      if (next.botName) names.name = next.botName;
      if (next.botRef) names.ref = next.botRef;
      if ($('end')) $('end').hidden = true;
      logLines.length = 0;
      seenPlays.clear(); // las claves se repiten en cada partida (mano 1, 2...)
      shownScores[HUMAN] = 0;
      shownScores[BOT] = 0;
      state = makeGame();
      dealNext();
    }

    /** Retoma una partida guardada (el modo arcade la guarda en cada jugada). */
    function resume(saved) {
      state = saved;
      if (state.phase === 'idle') return dealNext();
      shownScores[HUMAN] = Math.min(state.scores[HUMAN], TARGET);
      shownScores[BOT] = Math.min(state.scores[BOT], TARGET);
      dealtHandNo = state.handNo; // ya estaban repartidas: sin animacion de reparto
      if (state.played) {
        [HUMAN, BOT].forEach((p) => state.played[p].forEach((card, i) => { if (card) seenPlays.add(playKey(p, i)); }));
      }
      afterChange();
    }

    function onResetBrain() {
      const btn = $('reset-brain');
      if (!resetArmed) {
        btn.textContent = '¿Seguro? Tocá de nuevo para borrar';
        resetArmed = setTimeout(disarmReset, RESET_CONFIRM_MS);
        return;
      }
      disarmReset();
      bot.reset();
      lastInsightValues = {};
      renderInsights();
    }

    function disarmReset() {
      clearTimeout(resetArmed);
      resetArmed = null;
      $('reset-brain').textContent = 'Borrar memoria del bot';
    }

    const wideScreen = window.matchMedia('(min-width: 960px)');
    if ($('brain')) $('brain').open = wideScreen.matches;
    // Como en las salas: en escritorio la planilla va arriba de la columna derecha; en celular, arriba de la mesa.
    function placeBoard() {
      if (wideScreen.matches) document.querySelector('.side').prepend($('board'));
      else $('screen-table').prepend($('board'));
    }
    placeBoard();
    wideScreen.addEventListener('change', placeBoard);
    fx.seedDust();
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.menu-wrap')) closeMenus();
      clearSelection();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });
    const UNLOCK_EVENTS = ['pointerup', 'keydown', 'click'];
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
    if ($('again')) $('again').addEventListener('click', () => newMatch());
    if ($('reset-brain')) $('reset-brain').addEventListener('click', onResetBrain);
    if (opts.initialState) resume(opts.initialState);
    else if (opts.idle) render();
    else newMatch();

    return { newMatch, getState: () => state };
  }

  window.TrucoTable = { mount };
  if (autostart) mount();
})();
