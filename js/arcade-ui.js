/* Pantalla del modo arcade: HUD, amuletos, tienda y fin de run. La mesa la dibuja ui.js
 * (TrucoTable.mount) y las reglas de la run viven en arcade.js. */
(function () {
  'use strict';

  const A = window.TrucoArcade;
  const T = window.Truco;
  const BOT_KEY = 'truco.arcade.bot';
  const END_DELAY_MS = 1400;
  const COIN_POP_MS = 1200;
  const KIND_NAMES = { puntaje: 'Puntaje', economia: 'Economía', cartas: 'Cartas', info: 'Información', mejora: 'Mejora' };
  const rng = Math.random;

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  // ---------- guardado: navegador al instante, servidor en segundo plano ----------

  const store = window.TrucoArcadeStore.createRunStore({
    storage: (() => { try { return window.localStorage; } catch (err) { return null; } })(),
    fetchImpl: window.fetch ? window.fetch.bind(window) : null,
    runVersion: A.RUN_VERSION,
  });
  const flushSoon = () => { store.flush(); };
  window.addEventListener('pagehide', flushSoon);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSoon(); });

  // ---------- estado ----------

  let run = null;
  let table = null;

  const refOf = (name) => name.replace(/^El /, 'el ');
  const makeBot = (rival) => new window.TrucoBot.Bot({ storage: null, key: BOT_KEY, samples: rival.samples, traits: rival.traits });
  const matchConfig = () => ({
    bot: makeBot(run.rival),
    newGame: () => T.newGame(rng, A.matchOptions(run)),
    botName: run.rival.name,
    botRef: refOf(run.rival.name),
  });

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

  function amuletItem(id) {
    const a = A.AMULETS[id];
    const li = el('li', `kind-${a.kind}`);
    li.append(el('b', '', a.name), el('span', '', ` — ${a.desc}`));
    return li;
  }

  function upgradeText(key, up) {
    const card = A.parseKey(key);
    const parts = [];
    if (typeof up.rank === 'number') parts.push('más fuerte en el truco');
    if (typeof up.envido === 'number') parts.push(`vale ${up.envido} de envido`);
    return `${A.cardName(card)}: ${parts.join(' y ')}`;
  }

  function renderRun() {
    $('hud-round').textContent = String(run.round);
    $('hud-coins').textContent = String(run.coins);
    $('hud-best').textContent = String(run.best);
    $('amulet-bar').replaceChildren(...run.amulets.map((id) => amuletChip(id)));
    $('amulet-bar').hidden = run.amulets.length === 0;
    if (!run.amulets.length) $('amulet-desc').textContent = '';

    const r = run.rival;
    $('rival-seat').textContent = r.name;
    $('rival-name').textContent = r.boss ? `${r.name} · Jefe` : r.name;
    $('rival-desc').textContent = r.desc;
    $('rival-amulets').replaceChildren(...r.amulets.map(amuletItem));

    const mine = run.amulets.map(amuletItem);
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
    ['intro', 'shop', 'over'].forEach((o) => { $(o).hidden = o !== id; });
  }

  function showIntro() {
    const r = run.rival;
    $('intro-round').textContent = r.boss ? `Ronda ${run.round} · Jefe` : `Ronda ${run.round}`;
    $('intro-title').textContent = r.name;
    $('intro-desc').textContent = r.desc;
    $('intro-amulets').replaceChildren(...r.amulets.map(amuletItem));
    $('intro').classList.toggle('boss', r.boss);
    openOverlay('intro');
    $('intro-go').focus();
  }

  function startRound() {
    openOverlay(null);
    table.newMatch(matchConfig());
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

  // ---------- eventos de la mesa ----------

  function onEvents(events, state) {
    const result = A.onEvents(run, events, rng);
    const next = result.run.phase === 'match' ? A.withMatch(result.run, state) : result.run;
    commit(next);
    showGains(result.gains);
  }

  function onGameEnd() {
    setTimeout(() => (run.phase === 'shop' ? showShop() : showOver()), END_DELAY_MS);
    return true;
  }

  $('intro-go').addEventListener('click', startRound);
  $('shop-reroll').addEventListener('click', () => shopAction(() => A.reroll(run, rng), 'Ofertas nuevas.'));
  $('shop-next').addEventListener('click', () => {
    commit(A.leaveShop(run, rng));
    showIntro();
  });
  $('over-again').addEventListener('click', () => {
    commit(A.newRun(rng, { best: run.best }));
    showIntro();
  });

  async function start() {
    const saved = await store.load();
    // Una run terminada se muestra (fin de run) hasta que toques "Nueva run".
    run = saved || A.newRun(rng);
    const resuming = run.phase === 'match' && run.match;
    table = window.TrucoTable.mount({
      ...matchConfig(),
      onEvents,
      onGameEnd,
      initialState: resuming ? run.match : undefined,
      idle: !resuming,
    });
    if (run !== saved) store.save(run);
    renderRun();
    if (run.phase === 'shop') showShop();
    else if (run.phase === 'over') showOver();
    else if (!resuming) showIntro();
  }

  start();
})();
