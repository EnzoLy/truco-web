/* Botones de acción de la mesa (Quiero, No quiero, Truco, Envido, Mazo...), comunes a la mesa 1v1 (ui.js) y a la
 * de las salas (sala-table.js). Cada acción tiene su color, su icono y una línea chica con lo que pasa si la tocás
 * ("Le das 1 punto"), para no confundirlas. Además:
 * - arm(box): los botones recién aparecidos no responden por un instante, así un toque que iba para otro botón
 *   (justo cuando el rival canta) no cae en "No quiero".
 * - El mazo pide un segundo toque para confirmar.
 * TrucoActionButtons.decorate(button, { icon, sub }) · arm(box) · confirmFirst(button, run) · subs */
(function (root) {
  'use strict';

  const ARM_MS = 450;
  const CONFIRM_MS = 2500;

  const ICONS = {
    accept: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.2 16.6L4.6 12l-1.8 1.8 6.4 6.4L21.2 8.2l-1.8-1.8z"/></svg>',
    reject: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.4 4.2L12 10.6 5.6 4.2 4.2 5.6l6.4 6.4-6.4 6.4 1.4 1.4 6.4-6.4 6.4 6.4 1.4-1.4-6.4-6.4 6.4-6.4z"/></svg>',
    truco: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 3H21v6.5L10 20.5l-2-2L19 7.5V5h-2.5L5.5 16l-2-2zM4 17.5l2.5 2.5L4 22.5 1.5 20z"/></svg>',
    envido: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5l2.6 7.9 7.9 2.6-7.9 2.6L12 22.5l-2.6-7.9L1.5 12l7.9-2.6z"/></svg>',
    flor: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2a4 4 0 0 1 3.2 6.4A4 4 0 1 1 18 15a4 4 0 1 1-6 3.2A4 4 0 1 1 6 15a4 4 0 1 1 2.8-6.6A4 4 0 0 1 12 2z" opacity=".55"/></svg>',
    mazo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm1 3v10h8V6z"/><path d="M3 7v12a2 2 0 0 0 2 2h10v-2H5V7z" opacity=".6"/></svg>',
    ask: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 16h-2v-2h2zm2.1-7.7l-.9.9c-.8.8-1.2 1.4-1.2 2.8h-2v-.5c0-1.1.4-2.1 1.2-2.8l1.2-1.3a2 2 0 1 0-3.4-1.4H8a4 4 0 1 1 7.1 2.3z"/></svg>',
    signs: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4c-4.4 0-8 3.1-8 7 0 2 1 3.9 2.6 5.1L6 20l4-2.2c.6.1 1.3.2 2 .2 4.4 0 8-3.1 8-7s-3.6-7-8-7z"/></svg>',
  };

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  /** Le pone icono y línea chica a un botón ya armado (conserva su texto como etiqueta principal). */
  function decorate(button, { icon, sub } = {}) {
    const label = button.textContent;
    const text = el('span', 'act-text');
    text.append(el('span', 'act-label', label));
    if (sub) text.append(el('span', 'act-sub', sub));
    button.replaceChildren(...(icon && ICONS[icon] ? [Object.assign(el('span', 'act-icon'), { innerHTML: ICONS[icon] })] : []), text);
    button.classList.add('act');
    if (sub) button.setAttribute('aria-label', `${label}. ${sub}`);
    return button;
  }

  /** Los botones nuevos de la botonera esperan un instante antes de aceptar toques. */
  function arm(box) {
    box.classList.add('arming');
    clearTimeout(box.armTimer);
    box.armTimer = setTimeout(() => box.classList.remove('arming'), ARM_MS);
  }

  /** Acciones que no tienen vuelta (irse al mazo): el primer toque pregunta, el segundo confirma. */
  function confirmFirst(button, run, question = '¿Seguro? Tocá otra vez') {
    let armedUntil = 0;
    const sub = button.querySelector('.act-sub');
    const original = sub ? sub.textContent : '';
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      if (Date.now() < armedUntil) { run(); return; }
      armedUntil = Date.now() + CONFIRM_MS;
      button.classList.add('confirming');
      if (sub) sub.textContent = question;
      setTimeout(() => {
        button.classList.remove('confirming');
        if (sub) sub.textContent = original;
      }, CONFIRM_MS);
    });
    return button;
  }

  const plural = (n) => `${n} ${n === 1 ? 'punto' : 'puntos'}`;

  /** Líneas chicas según lo que se está respondiendo. T = window.Truco (valueOfTruco, envidoStakes). */
  const subs = {
    trucoAccept: (T, level) => `Se juega por ${plural(T.valueOfTruco(level))}`,
    trucoReject: (T, level) => `Le das ${plural(T.valueOfTruco(level - 1))}`,
    trucoCall: (T, level) => `La mano vale ${plural(T.valueOfTruco(level))}`,
    envidoAccept: (T, stack, scores) => {
      const { accepted } = T.envidoStakes(stack, scores);
      return stack.includes('falta') ? `Se juega la falta (${accepted})` : `Se juegan ${plural(accepted)}`;
    },
    envidoReject: (T, stack, scores) => `Le das ${plural(T.envidoStakes(stack, scores).rejected)}`,
  };

  root.TrucoActionButtons = { ICONS, decorate, arm, confirmFirst, subs };
})(typeof self !== 'undefined' ? self : this);
