/* Efectos de la mesa del modo bot y del arcade, los mismos que en las salas:
 * cartel de canto, chispas al ganar una baza, polvo sobre el paño, telón de fin de mano y golpe en la mesa.
 * Solo animan transform y opacity (ver vida.css), para no trabar celulares.
 * TrucoTableFx.create() -> { shout, sparks, seedDust, handEnd, knock, afterCurtain, skip, peekable } */
(function () {
  'use strict';

  const SHOUT_MS = 1600;
  const DUST_COUNT = 8;
  const SPARK_MS = 1000;
  const SPARKS_WIN = 26;
  const SPARKS_LOSS = 10;
  const SPARK_COLORS = ['#e6b83c', '#f7f1e3', '#c8261f'];
  const HANDEND_MS = 2800;
  const COUNT_STEP_MS = 140;
  const COIN_COUNT = 28;
  const KNOCK_MS = 150;
  const PEEK_WIDTH = 176;
  const PEEK_GAP = 10;
  const PEEK_MARGIN = 8;

  function create() {
    const $ = (id) => document.getElementById(id);
    const el = (tag, cls, text) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined) n.textContent = text;
      return n;
    };

    let shoutTimer = null;
    let handEndTimer = null;
    let countTimer = null;
    let waiting = []; // lo que espera a que se vaya el telón (el cartel de fin de partida)

    /** Cartel gigante: kind = truco | envido | quiero | noquiero; level agranda el truco. */
    function shout({ kind, text, who = '', level = 1 }) {
      const box = $('shout');
      if (!box || !kind || !text) return;
      box.className = `shout ${kind} lvl${Math.min(Math.max(level, 1), 3)}`;
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
      const count = win ? SPARKS_WIN : SPARKS_LOSS;
      for (let i = 0; i < count; i++) {
        const s = el('i', 'spark');
        const angle = Math.random() * Math.PI * 2;
        const dist = 60 + Math.random() * 140;
        s.style.left = `${rect.left + rect.width / 2}px`;
        s.style.top = `${rect.top + rect.height / 2}px`;
        s.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
        s.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
        s.style.setProperty('--r', `${Math.round(Math.random() * 540)}deg`);
        s.style.setProperty('--c', win ? SPARK_COLORS[i % SPARK_COLORS.length] : '#c8261f');
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

    /** Telón de fin de mano: título, puntos contando y lluvia de monedas si ganaste. */
    function handEnd({ won, title, why = '', points }) {
      const box = $('handend');
      if (!box) return;
      box.className = `handend ${won ? 'win' : 'loss'}`;
      $('handend-title').textContent = title;
      $('handend-why').textContent = why;
      const shown = $('handend-points');
      clearInterval(countTimer);
      let n = 0;
      shown.textContent = '+0';
      countTimer = setInterval(() => {
        n += 1;
        shown.textContent = `+${n}`;
        if (n >= points) clearInterval(countTimer);
      }, COUNT_STEP_MS);
      box.querySelectorAll('.coin').forEach((c) => c.remove());
      if (won) {
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
      handEndTimer = setTimeout(closeCurtain, HANDEND_MS);
    }

    function closeCurtain() {
      clearTimeout(handEndTimer);
      clearInterval(countTimer);
      const box = $('handend');
      if (box) {
        box.classList.remove('go');
        box.querySelectorAll('.coin').forEach((c) => c.remove());
      }
      const run = waiting;
      waiting = [];
      run.forEach((fn) => fn());
    }

    /** Corre fn cuando no hay telón en pantalla (enseguida si no hay). */
    function afterCurtain(fn) {
      const box = $('handend');
      if (box && box.classList.contains('go')) waiting.push(fn);
      else fn();
    }

    function knock(level) {
      const table = document.querySelector('.table');
      if (!table) return;
      const knocks = Math.min(Math.max(level, 1), 3);
      table.style.setProperty('--n', String(knocks));
      table.classList.remove('knock');
      void table.offsetWidth;
      table.classList.add('knock');
      setTimeout(() => table.classList.remove('knock'), KNOCK_MS * knocks + 50);
    }

    /** Un toque en cualquier lado salta el canto o el telón que esté en pantalla. */
    function skip() {
      const shoutBox = $('shout');
      const handBox = $('handend');
      const shouting = shoutBox && shoutBox.classList.contains('go');
      const curtain = handBox && handBox.classList.contains('go');
      if (!shouting && !curtain) return;
      clearTimeout(shoutTimer);
      if (shoutBox) shoutBox.classList.remove('go');
      document.querySelectorAll('.spark').forEach((s) => s.remove());
      if (curtain) closeCurtain();
    }
    // En captura y sin frenar el evento: el mismo toque sigue a lo que haya debajo (por ejemplo, "Quiero").
    document.addEventListener('pointerdown', skip, true);
    document.addEventListener('keydown', skip, true);

    // Ver en grande una carta jugada: hover con mouse, o tocarla (queda hasta tocar de nuevo).
    let peekNode = null;
    let peekPinned = false;

    function showPeek(anchor, { src, name, caption }) {
      if (!peekNode) {
        peekNode = el('div', 'peek');
        peekNode.setAttribute('role', 'status');
        document.body.append(peekNode);
      }
      const img = document.createElement('img');
      img.src = src;
      img.alt = name;
      peekNode.replaceChildren(img, el('strong', '', name), el('span', '', caption));
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

    /** Hace que una carta de la mesa se pueda ver en grande. */
    function peekable(node, info) {
      node.classList.add('peekable');
      node.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && !peekPinned) showPeek(node, info); });
      node.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !peekPinned) hidePeek(); });
      node.addEventListener('click', (e) => { e.stopPropagation(); peekPinned = true; showPeek(node, info); });
    }

    return { shout, sparks, seedDust, handEnd, knock, afterCurtain, skip, peekable };
  }

  window.TrucoTableFx = { create };
})();
