/* Interfaz: solo dibuja el estado y llama a Truco.step / bot.decide, nada de reglas aca. */
(function () {
  'use strict';

  const { newGame, dealHand, step, viewFor, legalActions, rankOf, envidoPoints, TARGET } = window.Truco;
  const HUMAN = 0;
  const BOT = 1;
  const BOT_DELAY_MIN_MS = 700;
  const BOT_DELAY_SPREAD_MS = 600;
  const BUBBLE_MS = 2200;
  const LOG_LIMIT = 60;
  const RESET_CONFIRM_MS = 3000;
  const MIN_INSIGHT_SAMPLES = 3;
  const FLY_MS = 560;
  const IMPACT_AT = 0.82; // fraccion del vuelo en que la carta toca el paño
  const IMPACT_MS = 520;
  const KNOCK_MS = 150;
  const DEAL_STEP_S = 0.12;
  const POINT_STEP_S = 0.14;
  const MAX_POINT_TICKS = 5;
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
  const Sound = window.TrucoSoundFactory.createSound({
    AudioContextCtor: window.AudioContext || window.webkitAudioContext,
    storage: (() => { try { return window.localStorage; } catch (err) { return null; } })(),
  });

  const bot = new window.TrucoBot.Bot();
  let state = newGame();
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
  const who = (p) => (p === HUMAN ? 'Vos' : 'Bot');

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
      default: return null;
    }
  }

  function logText(ev) {
    switch (ev.type) {
      case 'deal': return `— Mano ${ev.handNo}: reparte ${who(1 - ev.mano)}, es mano ${ev.mano === HUMAN ? 'vos' : 'el bot'} —`;
      case 'play': return `${who(ev.player)} juega ${cardName(ev.card)}`;
      case 'trick': {
        const res = ev.winner === -1 ? 'parda' : `gana ${ev.winner === HUMAN ? 'vos' : 'el bot'}`;
        return `Baza ${ev.trickIndex + 1}: ${res}`;
      }
      case 'envido-result':
        return ev.accepted
          ? `Envido: vos ${ev.points[HUMAN]}, bot ${ev.points[BOT]}. +${ev.awarded} para ${ev.winner === HUMAN ? 'vos' : 'el bot'}`
          : `Envido no querido: +${ev.awarded} para ${ev.winner === HUMAN ? 'vos' : 'el bot'}`;
      case 'hand-end': return `Mano terminada: +${ev.points} para ${ev.winner === HUMAN ? 'vos' : 'el bot'}`;
      case 'envido-first': return `${who(ev.by)}: envido primero`;
      default: {
        const t = eventText(ev);
        return t && ev.by !== undefined ? `${who(ev.by)}: ${t}` : t && ev.player !== undefined ? `${who(ev.player)}: ${t}` : null;
      }
    }
  }

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

  // Cada cuadrito: arriba, derecha, abajo, izquierda y la diagonal que lo cierra.
  const STICKS = [[3, 3, 27, 3], [27, 3, 27, 27], [27, 27, 3, 27], [3, 27, 3, 3], [3, 27, 27, 3]];
  const GROUP_SIZE = 5;
  const GROUP_W = 30;
  const GROUP_GAP = 8;
  const HALF_GAP = 22;

  function tallySvg(score, previous) {
    const groups = TARGET / GROUP_SIZE;
    const half = groups / 2;
    const width = groups * GROUP_W + (groups - 1) * GROUP_GAP + (HALF_GAP - GROUP_GAP);
    let sticks = '';
    for (let g = 0; g < groups; g++) {
      const x = g * (GROUP_W + GROUP_GAP) + (g >= half ? HALF_GAP - GROUP_GAP : 0);
      STICKS.forEach(([x1, y1, x2, y2], k) => {
        const n = g * GROUP_SIZE + k;
        const on = n < score;
        const fresh = on && n >= previous;
        sticks += `<line class="stick${on ? ' on' : ''}${fresh ? ' fresh' : ''}" x1="${x + x1}" y1="${y1}" x2="${x + x2}" y2="${y2}"/>`;
      });
    }
    return `<svg viewBox="0 0 ${width} 30" role="img" aria-label="${score} de ${TARGET} puntos">${sticks}</svg>`;
  }

  const shownScores = [0, 0];

  function renderScores() {
    [[HUMAN, 'you'], [BOT, 'bot']].forEach(([p, id]) => {
      const score = Math.min(state.scores[p], TARGET);
      const num = $(`num-${id}`);
      const gained = score - shownScores[p];
      if (gained > 0) celebrateScore(id, gained);
      if (num.textContent !== String(state.scores[p])) {
        num.classList.remove('bump');
        void num.offsetWidth;
        num.classList.add('bump');
      }
      num.textContent = String(state.scores[p]);
      $(`tally-${id}`).innerHTML = tallySvg(score, shownScores[p]);
      shownScores[p] = score;
    });
    const live = state.phase !== 'idle';
    $('bot-mano').hidden = !live || state.mano !== BOT;
    $('you-mano').hidden = !live || state.mano !== HUMAN;
  }

  /** Los puntos nuevos salen flotando del marcador y suenan como fósforos que se prenden. */
  function celebrateScore(id, gained) {
    const row = $(`num-${id}`).closest('.score-row');
    row.classList.remove('scored');
    void row.offsetWidth;
    row.classList.add('scored');
    const pop = el('span', 'score-pop', `+${gained}`);
    pop.setAttribute('aria-hidden', 'true');
    row.append(pop);
    setTimeout(() => { pop.remove(); row.classList.remove('scored'); }, SCORE_FX_MS);
    for (let i = 0; i < Math.min(gained, MAX_POINT_TICKS); i++) Sound.play('point', { delay: 0.1 + i * POINT_STEP_S });
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
    botHand.replaceChildren(...(state.hands ? state.hands[BOT].map((c, i) => {
      const n = cardBack();
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
    $('envido-hint').textContent = state.dealt ? `Tenés ${envidoPoints(state.dealt[HUMAN])} de envido` : '';
  }

  const seenPlays = new Set();

  function renderTricks() {
    const wrap = $('tricks');
    const cols = [0, 1, 2].map((i) => {
      const col = el('div', 'trick');
      const winner = state.results ? state.results[i] : undefined;
      [BOT, HUMAN].forEach((p) => {
        const slot = el('div', 'slot');
        const card = state.played ? state.played[p][i] : null;
        if (card) {
          const face = cardFace(card, false);
          const key = `${state.handNo}-${p}-${i}`;
          face.style.setProperty('--tilt', `${((i * 7 + p * 5) % 7) - 3}deg`);
          if (!seenPlays.has(key)) { seenPlays.add(key); face.classList.add('drop'); }
          slot.append(face);
          if (winner === p) {
            slot.classList.add('won');
            if (!seenPlays.has(`${key}-win`)) { seenPlays.add(`${key}-win`); face.classList.add('celebrate'); }
          }
          else if (winner !== undefined && winner !== -1) slot.classList.add('lost');
        }
        col.append(slot);
      });
      col.append(el('span', 'trick-label', winner === -1 ? 'Parda' : `Baza ${i + 1}`));
      return col;
    });
    wrap.replaceChildren(...cols);
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
    if (hasType('mazo').length) nodes.push(button('Mazo', 'ghost', () => humanAct({ type: 'mazo' })));
    nodes.forEach((n, i) => n.style.setProperty('--i', String(i)));
    box.append(...nodes);
  }

  function humanPrompt() {
    switch (state.phase) {
      case 'respond-truco':
        return `El bot cantó ${TRUCO_NAMES[state.pending.level]}. ¿Qué respondés?`;
      case 'respond-envido':
        return `El bot cantó ${state.pending.stack.map((w) => ENVIDO_NAMES[w]).join(', ')}. ¿Qué respondés?`;
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
      s.append(el('span', '', `${r.winner === HUMAN ? 'Ganaste' : 'Ganó el bot'} la mano: +${r.points}`));
      const next = button('Repartir', 'primary', dealNext);
      s.append(next);
      next.focus();
      return;
    }
    if (state.phase === 'game-over') return;
    if (state.turn === BOT) {
      s.append(el('span', 'hint thinking', 'El bot está pensando'));
      return;
    }
    s.append(el('span', '', humanPrompt()));
  }

  function renderInsights() {
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
    const myTurn = state.turn === HUMAN && ['play', 'respond-truco', 'respond-envido'].includes(state.phase);
    $('seat-you').classList.toggle('turn', myTurn);
    if (myTurn && !wasMyTurn) Sound.play('turn', { delay: 0.35 });
    wasMyTurn = myTurn;
    document.querySelector('.seat-bot').classList.toggle('thinking', state.turn === BOT && !['hand-over', 'game-over', 'idle'].includes(state.phase));
  }

  // ---------- flujo ----------

  const TRICK_SOUND_DELAY_S = (FLY_MS * IMPACT_AT + 120) / 1000;

  const shoutKind = (ev) => (ev.type === 'truco-call' ? 'shout-truco' : ev.type === 'envido-call' ? 'shout-envido' : '');

  /** Cada hecho del juego tiene su sonido; el golpe de carta lo pone flyToTable al aterrizar. */
  function reactToEvent(ev) {
    switch (ev.type) {
      case 'truco-call':
        Sound.play('knock', { level: ev.level });
        knockTable(ev.level);
        break;
      case 'envido-call':
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
        if (ev.winner !== -1) Sound.play(ev.winner === HUMAN ? 'trickWin' : 'trickLoss', { delay: TRICK_SOUND_DELAY_S });
        break;
      default:
    }
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

  function ingest(events) {
    events.forEach((ev) => {
      bot.observe(ev);
      const line = logText(ev);
      if (line) pushLog(line);
      const speak = eventText(ev);
      const speaker = ev.by !== undefined ? ev.by : ev.player;
      reactToEvent(ev);
      if (speak && speaker !== undefined && ev.type !== 'play') say(speaker, speak, shoutKind(ev));
      if (ev.type === 'envido-result' && ev.accepted) {
        say(HUMAN, `Tengo ${ev.points[HUMAN]}`);
        say(BOT, `Tengo ${ev.points[BOT]}`);
      }
    });
  }

  /** Dónde estaba la carta que se va a jugar, para que la animación salga de ahí. */
  function handCardRect(player, action) {
    if (action.type !== 'play') return null;
    const hand = $(player === HUMAN ? 'you-hand' : 'bot-hand');
    const node = hand.children[action.index] || hand;
    return node.getBoundingClientRect();
  }

  /** Una onda se abre desde la casilla justo cuando la carta toca el paño. */
  function landingImpact(slot) {
    setTimeout(() => {
      if (!slot.isConnected) return;
      const ring = el('span', 'impact');
      slot.append(ring);
      setTimeout(() => ring.remove(), IMPACT_MS);
    }, FLY_MS * IMPACT_AT);
  }

  function flyToTable(player, from) {
    const card = document.querySelector('.slot .card.drop');
    if (!from || !card) return;
    Sound.play('play', { delay: (FLY_MS * IMPACT_AT) / 1000 });
    landingImpact(card.parentElement);
    if (!card.animate || REDUCED_MOTION.matches) return;
    const to = card.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const scale = from.width / to.width;
    const tilt = parseFloat(card.style.getPropertyValue('--tilt')) || 0;
    const flip = player === BOT ? 'perspective(700px) rotateY(90deg) ' : '';
    const lift = 'drop-shadow(0 18px 14px rgba(0, 0, 0, 0.5))';
    card.style.zIndex = '20';
    const flight = card.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(${scale}) ${flip}rotate(${player === HUMAN ? -6 : 8}deg)`, filter: lift, offset: 0 },
      { transform: `translate(${dx * 0.3}px, ${dy * 0.3 - 28}px) scale(${(scale + 1) / 2 + 0.12}) ${flip ? 'perspective(700px) rotateY(35deg) ' : ''}rotate(${tilt * 2}deg)`, filter: lift, offset: 0.55, easing: 'cubic-bezier(0.5, 0, 0.9, 0.6)' },
      { transform: `translate(0, 0) scale(0.95) rotate(${tilt}deg)`, filter: 'drop-shadow(0 1px 1px rgba(0, 0, 0, 0.6))', offset: 0.82 },
      { transform: `translate(0, 0) scale(1) rotate(${tilt}deg)`, filter: 'drop-shadow(0 3px 5px rgba(0, 0, 0, 0.55))', offset: 1 },
    ], { duration: FLY_MS, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
    flight.onfinish = () => { card.style.zIndex = ''; };
  }

  function apply(player, action) {
    const from = handCardRect(player, action);
    selected = null;
    const result = step(state, player, action);
    state = result.state;
    ingest(result.events);
    afterChange();
    flyToTable(player, from);
  }

  function afterChange() {
    render();
    if (state.phase === 'game-over') return showEnd();
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

  function dealNext() {
    const r = dealHand(state);
    state = r.state;
    ingest(r.events);
    afterChange();
  }

  function showEnd() {
    const won = state.winner === HUMAN;
    $('end-title').textContent = won ? '¡Ganaste la partida!' : 'Ganó el bot';
    $('end-text').textContent = `${state.scores[HUMAN]} a ${state.scores[BOT]}. ${
      won ? 'El bot toma nota de cómo le ganaste.' : 'El bot ya sabe un poco más de cómo jugás.'}`;
    $('end').hidden = false;
    $('again').focus();
    Sound.play(won ? 'win' : 'lose');
    if (won) confetti();
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

  function newMatch() {
    clearTimeout(botTimer);
    botTimer = null;
    $('end').hidden = true;
    logLines.length = 0;
    state = newGame();
    dealNext();
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
  $('brain').open = wideScreen.matches;
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
  $('again').addEventListener('click', newMatch);
  $('reset-brain').addEventListener('click', onResetBrain);
  newMatch();
})();
