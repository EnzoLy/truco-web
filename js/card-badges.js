/* Iconos de mejora dentro de una carta del arcade (espada = truco, chispa = envido), con tooltip:
 * hover con mouse, o tocar el icono en el celular (queda hasta tocar otra cosa). Tocar el icono no
 * selecciona ni tira la carta. Lo usan la mesa 1v1 (ui.js) y la de 4 (sala-table.js).
 * También arma la vista en grande de una carta jugada, con sus mejoras escritas.
 * TrucoCardBadges.decorate(node, card, name) · peekable(node, { card, name, caption }) · dropStaleTip() */
(function () {
  'use strict';

  const TIP_GAP = 8;
  const TIP_MARGIN = 8;
  const PEEK_WIDTH = 176;
  const PEEK_GAP = 10;
  const PEEK_MARGIN = 8;
  const ICONS = {
    rank: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 3H21v6.5L10 20.5l-2-2L19 7.5V5h-2.5L5.5 16l-2-2zM4 17.5l2.5 2.5L4 22.5 1.5 20z"/></svg>',
    envido: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5l2.6 7.9 7.9 2.6-7.9 2.6L12 22.5l-2.6-7.9L1.5 12l7.9-2.6z"/></svg>',
  };

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const rankPhrase = (rank) => (window.TrucoArcade && window.TrucoArcade.rankText ? window.TrucoArcade.rankText(rank) : 'mata más fuerte');

  function notesOf(up) {
    if (!up) return [];
    const notes = [];
    if (typeof up.rank === 'number') notes.push({ kind: 'rank', text: `Mejora de truco: ${rankPhrase(up.rank)}` });
    if (typeof up.envido === 'number') notes.push({ kind: 'envido', text: `Mejora de envido: vale ${up.envido}` });
    return notes;
  }

  let tipNode = null;
  let tipAnchor = null;

  function showTip(anchor, text) {
    if (!tipNode) {
      tipNode = el('div', 'up-tip');
      tipNode.setAttribute('role', 'tooltip');
      document.body.append(tipNode);
    }
    tipNode.textContent = text;
    tipNode.hidden = false;
    tipAnchor = anchor;
    const rect = anchor.getBoundingClientRect();
    const box = tipNode.getBoundingClientRect();
    const left = Math.min(Math.max(rect.left + rect.width / 2 - box.width / 2, TIP_MARGIN), innerWidth - box.width - TIP_MARGIN);
    const above = rect.top - box.height - TIP_GAP;
    tipNode.style.left = `${left}px`;
    tipNode.style.top = `${above >= TIP_MARGIN ? above : rect.bottom + TIP_GAP}px`;
  }

  function hideTip() {
    tipAnchor = null;
    if (tipNode) tipNode.hidden = true;
  }
  document.addEventListener('click', hideTip);
  document.addEventListener('scroll', hideTip, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); });

  function tooltip(node, text) {
    node.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') showTip(node, text); });
    node.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideTip(); });
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (tipAnchor === node) hideTip();
      else showTip(node, text);
    });
  }

  /** Marca la carta como mejorada y le pone un icono por mejora. Sin mejoras no toca nada. */
  function decorate(node, card, name) {
    const notes = notesOf(card.up);
    if (!notes.length) return node;
    node.classList.add('upgraded');
    node.removeAttribute('title'); // el detalle lo da el tooltip de cada icono
    node.setAttribute('aria-label', `${name}. ${notes.map((n) => n.text).join('. ')}`);
    const box = el('span', 'up-badges');
    notes.forEach((n) => {
      const badge = el('span', `up-badge up-${n.kind}`);
      badge.innerHTML = ICONS[n.kind];
      tooltip(badge, n.text);
      box.append(badge);
    });
    node.append(box);
    return node;
  }

  // ---------- carta jugada en grande: hover con mouse, o tocarla (queda hasta tocar otra cosa) ----------
  // La carta que se mira lleva la clase "peeking": la mesa apaga las demás (ver vida.css).

  let peekNode = null;
  let peekAnchor = null;
  let peekPinned = false;

  function peekNotes(card) {
    const notes = notesOf(card.up);
    if (!notes.length) return [];
    const list = el('ul', 'peek-ups');
    notes.forEach((n) => {
      const item = el('li', `up-${n.kind}`);
      const icon = el('span', `up-badge up-${n.kind}`);
      icon.innerHTML = ICONS[n.kind];
      item.append(icon, el('span', '', n.text));
      list.append(item);
    });
    return [list];
  }

  function placePeek(anchor) {
    const rect = anchor.getBoundingClientRect();
    const height = peekNode.getBoundingClientRect().height || PEEK_WIDTH * 1.9;
    const left = Math.min(Math.max(rect.left + rect.width / 2 - PEEK_WIDTH / 2, PEEK_MARGIN), innerWidth - PEEK_WIDTH - PEEK_MARGIN);
    const above = rect.top - height - PEEK_GAP;
    peekNode.style.left = `${left}px`;
    peekNode.style.top = `${above >= PEEK_MARGIN ? above : Math.min(rect.bottom + PEEK_GAP, innerHeight - height - PEEK_MARGIN)}px`;
  }

  function showPeek(anchor, { card, name, caption }) {
    if (!peekNode) {
      peekNode = el('div', 'peek');
      peekNode.setAttribute('role', 'status');
      document.body.append(peekNode);
    }
    const img = el('img');
    img.src = window.CardArt.url(card);
    img.alt = name;
    peekNode.replaceChildren(img, el('strong', '', name), el('span', '', caption), ...peekNotes(card));
    peekNode.style.width = `${PEEK_WIDTH}px`;
    peekNode.hidden = false;
    if (peekAnchor && peekAnchor !== anchor) peekAnchor.classList.remove('peeking');
    peekAnchor = anchor;
    anchor.classList.add('peeking');
    placePeek(anchor);
  }

  function hidePeek() {
    peekPinned = false;
    if (peekAnchor) peekAnchor.classList.remove('peeking');
    peekAnchor = null;
    if (peekNode) peekNode.hidden = true;
  }
  document.addEventListener('click', hidePeek);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hidePeek(); });

  /** Hace que una carta de la mesa se pueda ver en grande. Tocar la misma carta otra vez la cierra. */
  function peekable(node, info) {
    node.classList.add('peekable');
    node.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && !peekPinned) showPeek(node, info); });
    node.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !peekPinned) hidePeek(); });
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      if (peekPinned && peekAnchor === node) { hidePeek(); return; }
      showPeek(node, info);
      peekPinned = true;
    });
  }

  /** Si la carta del icono o de la vista grande se redibujó (jugada de otro, cambio de turno), no queda flotando. */
  function dropStaleTip() {
    if (tipAnchor && !tipAnchor.isConnected) hideTip();
    if (peekAnchor && !peekAnchor.isConnected) hidePeek();
  }

  window.TrucoCardBadges = { decorate, peekable, dropStaleTip };
})();
