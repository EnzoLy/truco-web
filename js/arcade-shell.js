/* Lo común a las pantallas del arcade (solo, dúo con bot y dúo con un amigo): HUD, amuletos, intro, tienda,
 * fin de run y selector de modo. La mesa la pone cada página con mountTable; las reglas de la run viven en
 * arcade.js.
 *
 * TrucoArcadeShell.start({ mode: 'solo' | 'duo', mountTable })      run local, guardada en el navegador
 *   mountTable({ run, onEvents(events, state), onGameEnd(), resumeState }) -> { newMatch(run) }
 * TrucoArcadeShell.ui                                                dibujo sin estado, para el dúo con amigo:
 *   renderRun(run, who) · renderShop(run, opts) · showGains(gains) · openOverlay(id) · showIntro(run) · showOver(run) */
(function () {
  'use strict';

  const A = window.TrucoArcade;
  const END_DELAY_MS = 1400;
  const COIN_POP_MS = 1200;
  const KIND_NAMES = { puntaje: 'Puntaje', economia: 'Economía', cartas: 'Cartas', info: 'Información', mejora: 'Mejora' };
  // Un icono por tipo de amuleto para la tienda: estrella (puntos), monedas, naipes, ojo.
  const KIND_ICONS = {
    puntaje: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 16.9 5.9 20.4l1.5-6.8L2.2 9l6.9-.7z"/></svg>',
    economia: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 9.5c0 1.7 3.6 3 8 3s8-1.3 8-3V12c0 1.7-3.6 3-8 3s-8-1.3-8-3zm0 5c0 1.7 3.6 3 8 3s8-1.3 8-3V17c0 1.7-3.6 3-8 3s-8-1.3-8-3z"/></svg>',
    cartas: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.6 6.3l6-1.6 3.6 13.5-6 1.6z"/><path d="M11 3h7a1.5 1.5 0 0 1 1.5 1.5v14A1.5 1.5 0 0 1 18 20h-3.3L11 6.2z" opacity=".7"/></svg>',
    info: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5C6.5 5 2.6 9.4 1.5 12c1.1 2.6 5 7 10.5 7s9.4-4.4 10.5-7C21.4 9.4 17.5 5 12 5zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/><circle cx="12" cy="12" r="2"/></svg>',
  };
  const UPGRADE_NAMES = { rank: 'Filo', envido: 'Brillo' };
  const PAGES = { solo: '/arcade', duo: '/arcade-duo' };
  const OVERLAYS = ['modes', 'partner-pick', 'coop-join', 'coop-lobby', 'intro', 'shop', 'over'];
  const rng = Math.random;

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const storage = (() => { try { return window.localStorage; } catch (err) { return null; } })();

  /** Run guardada en este navegador para un modo (para el selector), o null. */
  function localRun(mode) {
    try {
      const raw = storage && storage.getItem(window.TrucoArcadeStore.SLOTS[mode].run);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function runStatus(run) {
    if (!run) return 'Run nueva';
    const record = `Récord ${run.best}`;
    if (run.phase === 'over') return `Run terminada · ${record}`;
    return `Ronda ${run.round} en curso · ${record}`;
  }

  /** Nombres de los rivales de la ronda: "El Profe" o "El Profe y Doña Prudencia". */
  const rivalsOf = (run) => (A.isDuo(run) ? run.rivals : [run.rival]);
  const rivalTitle = (run) => rivalsOf(run).map((r) => r.name).join(' y ');
  const other = (who) => (who === 'me' ? 'partner' : 'me');

  // ---------- HUD y paneles ----------

  function amuletChip(id) {
    const a = A.AMULETS[id];
    const chip = el('button', `amulet kind-${a.kind}`, a.name);
    chip.type = 'button';
    chip.title = a.desc;
    chip.addEventListener('click', () => { $('amulet-desc').textContent = `${a.name}: ${a.desc}`; });
    return chip;
  }

  function amuletItem(id, owner) {
    const a = A.AMULETS[id];
    const li = el('li', `kind-${a.kind}`);
    li.append(el('b', '', a.name), el('span', '', ` — ${a.desc}${owner ? ` (${owner})` : ''}`));
    return li;
  }

  function upgradeText(key, up) {
    const card = A.parseKey(key);
    const parts = [];
    if (typeof up.rank === 'number') parts.push(`en el truco ${A.rankText(up.rank)}`);
    if (typeof up.envido === 'number') parts.push(`vale ${up.envido} de envido`);
    return `${A.cardName(card)}: ${parts.join(' y ')}`;
  }

  /** Amuletos de los rivales; en el dúo, cada uno dice de quién es. */
  const rivalAmuletItems = (run) => rivalsOf(run).flatMap((rival) => rival.amulets.map((id) => amuletItem(id, A.isDuo(run) ? rival.name : '')));

  /** Descripción de los rivales: una línea por rival. */
  function rivalDescNodes(run) {
    if (!A.isDuo(run)) return [document.createTextNode(run.rival.desc)];
    return run.rivals.flatMap((r, i) => [...(i ? [el('br')] : []), el('b', '', `${r.name}: `), document.createTextNode(r.desc)]);
  }

  /** Nombre de quien no sos vos en el dúo con amigo (para "Bolsillo de Beto"). */
  function buddyName(run, who, names) {
    if (names && names[other(who)]) return names[other(who)];
    return who === 'me' ? run.partner.name : 'tu compañero';
  }

  /** HUD, panel de rivales y tus amuletos. who: 'me' o, si sos el amigo invitado, 'partner'. */
  function renderRun(run, who = 'me', names = null) {
    const kit = A.kitOf(run, who);
    $('hud-round').textContent = String(run.round);
    $('hud-coins').textContent = String(run.coins);
    $('hud-best').textContent = String(run.best);
    $('amulet-bar').replaceChildren(...kit.amulets.map((id) => amuletChip(id)));
    $('amulet-bar').hidden = kit.amulets.length === 0;
    if (!kit.amulets.length) $('amulet-desc').textContent = '';

    const boss = rivalsOf(run).some((r) => r.boss);
    $('rival-name').textContent = boss ? `${rivalTitle(run)} · Jefe` : rivalTitle(run);
    $('rival-desc').replaceChildren(...rivalDescNodes(run));
    $('rival-amulets').replaceChildren(...rivalAmuletItems(run));

    const mine = kit.amulets.map((id) => amuletItem(id));
    $('my-amulets').replaceChildren(...(mine.length ? mine : [el('li', 'empty', 'Todavía no tenés amuletos.')]));
    $('my-upgrades').replaceChildren(...Object.entries(kit.upgrades).map(([k, up]) => el('li', 'kind-mejora', upgradeText(k, up))));

    const panel = $('partner-panel');
    if (!panel) return;
    panel.hidden = !A.isCoop(run);
    if (!A.isCoop(run)) return;
    const theirs = A.kitOf(run, other(who));
    $('partner-panel-title').textContent = `Amuletos de ${buddyName(run, who, names)}`;
    const items = theirs.amulets.map((id) => amuletItem(id));
    $('partner-amulets').replaceChildren(...(items.length ? items : [el('li', 'empty', 'Todavía no tiene amuletos.')]));
  }

  function showGains(gains) {
    const box = $('hud-coins-box');
    gains.forEach((g, i) => {
      const pop = el('span', 'coin-pop', `+${g.amount}`);
      pop.setAttribute('aria-hidden', 'true');
      pop.style.setProperty('--i', String(i));
      box.append(pop);
      setTimeout(() => pop.remove(), COIN_POP_MS + i * 150);
    });
    if (gains.length) {
      box.classList.remove('gain');
      void box.offsetWidth;
      box.classList.add('gain');
    }
  }

  // ---------- pantallas ----------

  function openOverlay(id) {
    OVERLAYS.forEach((o) => { if ($(o)) $(o).hidden = o !== id; });
  }

  function showIntro(run) {
    const boss = rivalsOf(run).some((r) => r.boss);
    $('intro-round').textContent = boss ? `Ronda ${run.round} · Jefe` : `Ronda ${run.round}`;
    $('intro-title').textContent = rivalTitle(run);
    $('intro-desc').replaceChildren(...rivalDescNodes(run));
    $('intro-amulets').replaceChildren(...rivalAmuletItems(run));
    $('intro').classList.toggle('boss', boss);
    openOverlay('intro');
    $('intro-go').focus();
  }

  function showOver(run, best = run.best) {
    const won = run.wins;
    $('over-text').textContent = `Ganaste ${won} ${won === 1 ? 'ronda' : 'rondas'}. Tu récord es ${best}.`;
    openOverlay('over');
    $('over-again').focus();
  }

  // ---------- tienda ----------

  const iconNode = (cls, svg) => {
    const n = el('span', cls);
    n.innerHTML = svg;
    n.setAttribute('aria-hidden', 'true');
    return n;
  };

  /** Dibuja la tienda de la run. opts:
   *  who: quién mira ('me' | 'partner') · buy(index, okMessage) · sell(id, message) · reroll() · next()
   *  nextLabel / nextDisabled: el botón de seguir ("Ronda 5" o, con amigo, "Listo" / "Esperando a Beto…")
   *  names: { me, partner } para nombrar al otro en el dúo con amigo. */
  function renderShop(run, opts) {
    const who = opts.who || 'me';
    const kit = A.kitOf(run, who);

    function buyButton(item, index, okMessage) {
      const reason = A.cantBuy(run, index, who);
      const short = run.coins < item.price ? `Te faltan ${item.price - run.coins}` : 'Bolsillo lleno';
      const label = item.sold ? 'Comprado' : reason ? short : 'Comprar';
      const btn = el('button', 'shop-buy');
      btn.type = 'button';
      btn.disabled = Boolean(reason);
      btn.append(el('span', 'shop-buy-label', label));
      if (!item.sold) {
        const price = el('span', 'price');
        price.append(el('span', 'coin-ico'), el('b', '', String(item.price)));
        btn.append(price);
      }
      btn.setAttribute('aria-label', item.sold ? 'Comprado' : `${label}: ${item.price} monedas`);
      btn.addEventListener('click', () => opts.buy(index, okMessage));
      return btn;
    }

    function amuletOffer(item, index) {
      const a = A.AMULETS[item.id];
      const node = el('article', `offer kind-${a.kind}${item.sold ? ' sold' : ''}`);
      node.style.setProperty('--i', String(index));
      const top = el('div', 'offer-top');
      top.append(iconNode('offer-icon', KIND_ICONS[a.kind]), el('span', 'offer-kind', KIND_NAMES[a.kind]));
      node.append(top, el('h4', 'offer-name', a.name), el('p', 'offer-desc', a.desc), buyButton(item, index, `¡${a.name} es tuyo!`));
      if (item.sold) node.append(el('span', 'stamp', 'Comprado'));
      return node;
    }

    function upgradeOffer(item, index) {
      const card = A.parseKey(item.key);
      const node = el('article', `up-offer up-${item.field}${item.sold ? ' sold' : ''}`);
      node.style.setProperty('--i', String(index));
      const art = el('div', 'up-art');
      const img = el('img');
      img.src = window.CardArt.url(card);
      img.alt = A.cardName(card);
      art.append(img, iconNode(`up-badge up-${item.field}`, window.TrucoCardBadges.ICONS[item.field]));
      const effect = item.field === 'rank' ? `En el truco ${A.rankText(item.value)}.` : `Vale ${item.value} para el envido.`;
      const text = el('div', 'up-text');
      text.append(el('h4', 'offer-name', `${UPGRADE_NAMES[item.field]} · ${A.cardName(card)}`), el('p', 'offer-desc', effect));
      node.append(art, text, buyButton(item, index, '¡Carta mejorada!'));
      return node;
    }

    function ownedSlot(id, canSell) {
      if (!id) return el('div', 'slot-free', 'Lugar libre');
      const a = A.AMULETS[id];
      const node = el('div', `owned kind-${a.kind}`);
      const info = el('button', 'owned-info');
      info.type = 'button';
      info.title = a.desc;
      info.append(iconNode('offer-icon', KIND_ICONS[a.kind]), el('span', 'owned-name', a.name));
      info.addEventListener('click', () => { $('shop-msg').textContent = `${a.name}: ${a.desc}`; });
      node.append(info);
      if (canSell) {
        const sell = el('button', 'owned-sell', `Vender +${A.sellPrice(id)}`);
        sell.type = 'button';
        sell.addEventListener('click', () => opts.sell(id, `Vendiste ${a.name}.`));
        node.append(sell);
      }
      return node;
    }

    const slotsOf = (amulets) => Array.from({ length: A.MAX_AMULETS }, (_, i) => amulets[i] || null);
    const next = run.round + 1;
    const interest = A.interestOf(run);
    $('shop-eyebrow').textContent = `Antes de la ronda ${next}${A.isBossRound(next) ? ' · Jefe' : ''}`;
    $('shop-coins').textContent = String(run.coins);
    $('shop-coins').parentElement.dataset.interest = interest ? `+${interest} de interés si ganás` : 'Ahorrá 5 y cobrás interés';
    const items = run.shop.items.map((item, index) => ({ item, index }));
    $('shop-items').replaceChildren(...items.filter((x) => x.item.type === 'amulet').map((x) => amuletOffer(x.item, x.index)));
    const ups = items.filter((x) => x.item.type === 'upgrade');
    $('shop-ups').replaceChildren(...(ups.length ? ups.map((x) => upgradeOffer(x.item, x.index)) : [el('p', 'shop-empty', 'Hoy no hay mejoras.')]));
    $('shop-owned-title').replaceChildren(document.createTextNode('Tu bolsillo '), el('span', '', `${kit.amulets.length} de ${A.MAX_AMULETS} lugares`));
    $('shop-owned').replaceChildren(...slotsOf(kit.amulets).map((id) => ownedSlot(id, true)));

    const partnerSec = $('shop-partner-sec');
    if (partnerSec) {
      partnerSec.hidden = !A.isCoop(run);
      if (A.isCoop(run)) {
        const theirs = A.kitOf(run, other(who)).amulets;
        $('shop-partner-title').replaceChildren(document.createTextNode(`Bolsillo de ${buddyName(run, who, opts.names)} `), el('span', '', `${theirs.length} de ${A.MAX_AMULETS} lugares`));
        $('shop-partner').replaceChildren(...slotsOf(theirs).map((id) => ownedSlot(id, false)));
      }
    }

    const cost = A.rerollCost(run);
    $('shop-reroll').textContent = `Otras ofertas · ${cost}`;
    $('shop-reroll').disabled = run.coins < cost;
    $('shop-reroll').onclick = () => opts.reroll();
    $('shop-next').textContent = opts.nextLabel || (A.isBossRound(next) ? `Ronda ${next}: jefe` : `Ronda ${next}`);
    $('shop-next').disabled = Boolean(opts.nextDisabled);
    $('shop-next').onclick = () => opts.next();
  }

  // ---------- run local (solo y dúo con bot) ----------

  function start({ mode, mountTable }) {
    const store = window.TrucoArcadeStore.createRunStore({
      storage,
      fetchImpl: window.fetch ? window.fetch.bind(window) : null,
      runVersion: A.RUN_VERSION,
      slot: mode,
    });
    const flushSoon = () => { store.flush(); };
    window.addEventListener('pagehide', flushSoon);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSoon(); });

    let run = null;
    let table = null;

    function commit(next) {
      run = next;
      store.save(run);
      renderRun(run);
    }

    function startRound() {
      openOverlay(null);
      table.newMatch(run);
    }

    function shopAction(fn, message) {
      try {
        commit(fn());
        $('shop-msg').textContent = message || '';
        drawShop();
      } catch (err) {
        if (!(err instanceof A.ArcadeError)) throw err;
        $('shop-msg').textContent = err.message;
      }
    }

    function drawShop() {
      renderShop(run, {
        buy: (index, message) => shopAction(() => A.buy(run, index), message),
        sell: (id, message) => shopAction(() => A.sell(run, id), message),
        reroll: () => shopAction(() => A.reroll(run, rng), 'Ofertas nuevas.'),
        next: () => {
          commit(A.leaveShop(run, rng));
          showIntro(run);
        },
      });
    }

    function showShop() {
      $('shop-msg').textContent = '';
      drawShop();
      openOverlay('shop');
      $('shop-next').focus();
    }

    /** Selector de modo: cada uno con su run y su récord. Elegir el otro modo cambia de página. */
    function showModes() {
      ['solo', 'duo'].forEach((m) => {
        const saved = m === mode ? run : localRun(m);
        $(`mode-${m}-status`).textContent = runStatus(saved);
      });
      openOverlay('modes');
      $(`mode-${mode}`).focus();
    }

    /** Sigue la run del modo de esta página desde donde quedó. */
    function resume() {
      if (run.phase === 'shop') showShop();
      else if (run.phase === 'over') showOver(run);
      else if (!(run.phase === 'match' && run.match)) showIntro(run);
      else openOverlay(null);
    }

    // ---------- eventos de la mesa ----------

    function onEvents(events, state) {
      const result = A.onEvents(run, events, rng);
      const next = result.run.phase === 'match' ? A.withMatch(result.run, state) : result.run;
      commit(next);
      showGains(result.gains);
    }

    function onGameEnd() {
      setTimeout(() => (run.phase === 'shop' ? showShop() : showOver(run)), END_DELAY_MS);
    }

    $('intro-go').addEventListener('click', startRound);
    $('over-again').addEventListener('click', () => {
      commit(A.newRun(rng, { best: run.best, mode }));
      showIntro(run);
    });
    if ($('over-modes')) $('over-modes').addEventListener('click', showModes);
    ['solo', 'duo'].forEach((m) => {
      const pick = $(`mode-${m}`);
      if (!pick) return;
      pick.addEventListener('click', () => {
        if (m === mode) resume();
        else location.href = PAGES[m];
      });
    });

    async function boot() {
      const saved = await store.load();
      // Una run terminada se muestra (fin de run) hasta que toques "Nueva run".
      run = saved || A.newRun(rng, { mode });
      const resuming = run.phase === 'match' && run.match;
      table = mountTable({ run, onEvents, onGameEnd, resumeState: resuming ? run.match : undefined });
      if (run !== saved) store.save(run);
      renderRun(run);
      // La página del modo solo es la entrada del arcade: primero se elige el modo.
      if ($('modes') && !new URLSearchParams(location.search).has('seguir')) showModes();
      else resume();
    }

    boot();
  }

  window.TrucoArcadeShell = {
    start,
    localRun,
    runStatus,
    ui: { renderRun, renderShop, showGains, openOverlay, showIntro, showOver },
  };
})();
