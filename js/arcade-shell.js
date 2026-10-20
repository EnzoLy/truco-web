/* Lo común a las dos pantallas del arcade (solo y dúo): guardado, HUD, amuletos, intro, tienda,
 * fin de run y selector de modo. La mesa la pone cada página con mountTable; las reglas de la run
 * viven en arcade.js.
 *
 * TrucoArcadeShell.start({ mode: 'solo' | 'duo', mountTable })
 *   mountTable({ run, onEvents(events, state), onGameEnd(), resumeState }) -> { newMatch(run) } */
(function () {
  'use strict';

  const A = window.TrucoArcade;
  const END_DELAY_MS = 1400;
  const COIN_POP_MS = 1200;
  const KIND_NAMES = { puntaje: 'Puntaje', economia: 'Economía', cartas: 'Cartas', info: 'Información', mejora: 'Mejora' };
  const PAGES = { solo: '/arcade', duo: '/arcade-duo' };
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
      renderRun();
    }

    // ---------- HUD y paneles ----------

    function amuletChip(id, onClick) {
      const a = A.AMULETS[id];
      const chip = el('button', `amulet kind-${a.kind}`, a.name);
      chip.type = 'button';
      chip.title = a.desc;
      chip.addEventListener('click', onClick || (() => { $('amulet-desc').textContent = `${a.name}: ${a.desc}`; }));
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
    const rivalAmuletItems = (r) => rivalsOf(r).flatMap((rival) => rival.amulets.map((id) => amuletItem(id, A.isDuo(r) ? rival.name : '')));

    /** Descripción de los rivales: una línea por rival. */
    function rivalDescNodes() {
      if (!A.isDuo(run)) return [document.createTextNode(run.rival.desc)];
      return run.rivals.flatMap((r, i) => [...(i ? [el('br')] : []), el('b', '', `${r.name}: `), document.createTextNode(r.desc)]);
    }

    function renderRun() {
      $('hud-round').textContent = String(run.round);
      $('hud-coins').textContent = String(run.coins);
      $('hud-best').textContent = String(run.best);
      $('amulet-bar').replaceChildren(...run.amulets.map((id) => amuletChip(id)));
      $('amulet-bar').hidden = run.amulets.length === 0;
      if (!run.amulets.length) $('amulet-desc').textContent = '';

      const boss = rivalsOf(run).some((r) => r.boss);
      $('rival-name').textContent = boss ? `${rivalTitle(run)} · Jefe` : rivalTitle(run);
      $('rival-desc').replaceChildren(...rivalDescNodes());
      $('rival-amulets').replaceChildren(...rivalAmuletItems(run));

      const mine = run.amulets.map((id) => amuletItem(id));
      $('my-amulets').replaceChildren(...(mine.length ? mine : [el('li', 'empty', 'Todavía no tenés amuletos.')]));
      $('my-upgrades').replaceChildren(...Object.entries(run.upgrades).map(([k, up]) => el('li', 'kind-mejora', upgradeText(k, up))));
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
      ['modes', 'intro', 'shop', 'over'].forEach((o) => { if ($(o)) $(o).hidden = o !== id; });
    }

    function showIntro() {
      const boss = rivalsOf(run).some((r) => r.boss);
      $('intro-round').textContent = boss ? `Ronda ${run.round} · Jefe` : `Ronda ${run.round}`;
      $('intro-title').textContent = rivalTitle(run);
      $('intro-desc').replaceChildren(...rivalDescNodes());
      $('intro-amulets').replaceChildren(...rivalAmuletItems(run));
      $('intro').classList.toggle('boss', boss);
      openOverlay('intro');
      $('intro-go').focus();
    }

    function startRound() {
      openOverlay(null);
      table.newMatch(run);
    }

    function shopItemNode(item, index) {
      const node = el('div', `shop-item${item.sold ? ' sold' : ''}`);
      if (item.type === 'amulet') {
        const a = A.AMULETS[item.id];
        node.classList.add(`kind-${a.kind}`);
        node.append(el('span', 'shop-kind', KIND_NAMES[a.kind]), el('b', 'shop-name', a.name), el('p', 'shop-desc', a.desc));
      } else {
        node.classList.add('kind-mejora');
        const card = A.parseKey(item.key);
        const art = el('img', 'shop-card');
        art.src = window.CardArt.url(card);
        art.alt = A.cardName(card);
        node.append(el('span', 'shop-kind', KIND_NAMES.mejora), art, el('b', 'shop-name', item.name), el('p', 'shop-desc', item.desc));
      }
      const reason = A.cantBuy(run, index);
      const btn = el('button', 'btn primary shop-buy', item.sold ? 'Comprado' : `Comprar · ${item.price}`);
      btn.type = 'button';
      btn.disabled = Boolean(reason);
      if (reason && !item.sold) btn.title = reason;
      btn.addEventListener('click', () => shopAction(() => A.buy(run, index), item.type === 'amulet' ? `¡${A.AMULETS[item.id].name} es tuyo!` : '¡Carta mejorada!'));
      node.append(btn);
      return node;
    }

    function renderShop() {
      $('shop-coins').textContent = String(run.coins);
      $('shop-items').replaceChildren(...run.shop.items.map(shopItemNode));
      $('shop-owned-title').textContent = `Tus amuletos (${run.amulets.length}/${A.MAX_AMULETS})`;
      $('shop-owned').replaceChildren(...(run.amulets.length
        ? run.amulets.map((id) => {
          const row = el('div', 'owned');
          const sell = el('button', 'btn ghost mini', `Vender · ${A.sellPrice(id)}`);
          sell.type = 'button';
          sell.addEventListener('click', () => shopAction(() => A.sell(run, id), `Vendiste ${A.AMULETS[id].name}.`));
          row.append(amuletChip(id, () => { $('shop-msg').textContent = A.AMULETS[id].desc; }), sell);
          return row;
        })
        : [el('p', 'shop-empty', 'Ninguno todavía.')]));
      const cost = A.rerollCost(run);
      $('shop-reroll').textContent = `Cambiar ofertas · ${cost}`;
      $('shop-reroll').disabled = run.coins < cost;
      const next = run.round + 1;
      $('shop-next').textContent = A.isBossRound(next) ? `Ronda ${next}: jefe` : `Ronda ${next}`;
    }

    function shopAction(fn, message) {
      try {
        commit(fn());
        $('shop-msg').textContent = message || '';
        renderShop();
      } catch (err) {
        if (!(err instanceof A.ArcadeError)) throw err;
        $('shop-msg').textContent = err.message;
      }
    }

    function showShop() {
      $('shop-msg').textContent = '';
      renderShop();
      openOverlay('shop');
      $('shop-next').focus();
    }

    function showOver() {
      const won = run.wins;
      $('over-text').textContent = `Ganaste ${won} ${won === 1 ? 'ronda' : 'rondas'}. Tu récord es ${run.best}.`;
      openOverlay('over');
      $('over-again').focus();
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
      else if (run.phase === 'over') showOver();
      else if (!(run.phase === 'match' && run.match)) showIntro();
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
      setTimeout(() => (run.phase === 'shop' ? showShop() : showOver()), END_DELAY_MS);
    }

    $('intro-go').addEventListener('click', startRound);
    $('shop-reroll').addEventListener('click', () => shopAction(() => A.reroll(run, rng), 'Ofertas nuevas.'));
    $('shop-next').addEventListener('click', () => {
      commit(A.leaveShop(run, rng));
      showIntro();
    });
    $('over-again').addEventListener('click', () => {
      commit(A.newRun(rng, { best: run.best, mode }));
      showIntro();
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
      renderRun();
      // La página del modo solo es la entrada del arcade: primero se elige el modo.
      if ($('modes') && !new URLSearchParams(location.search).has('seguir')) showModes();
      else resume();
    }

    boot();
  }

  window.TrucoArcadeShell = { start };
})();
