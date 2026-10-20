/* Iconos de mejora dentro de una carta del arcade (espada = truco, chispa = envido), con tooltip:
 * hover con mouse, o tocar el icono en el celular (queda hasta tocar otra cosa). Tocar el icono no
 * selecciona ni tira la carta. Lo usan la mesa 1v1 (ui.js) y la de 4 (sala-table.js).
 * TrucoCardBadges.decorate(node, card, name) · TrucoCardBadges.dropStaleTip() */
(function () {
  'use strict';

  const TIP_GAP = 8;
  const TIP_MARGIN = 8;
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

  /** Si la carta del icono se redibujó (jugada de otro, cambio de turno), el tooltip no queda flotando. */
  function dropStaleTip() {
    if (tipAnchor && !tipAnchor.isConnected) hideTip();
  }

  window.TrucoCardBadges = { decorate, dropStaleTip };
})();
