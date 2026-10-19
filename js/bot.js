/* Bot de Truco que aprende de tu estilo.
 * - Juega con Monte Carlo: reparte al azar las cartas que no vio y simula la mano.
 * - Mantiene un modelo de vos (tasas de "no quiero", honestidad al cantar, envidos, primera carta)
 *   que guarda en el navegador y que mueve sus umbrales y su frecuencia de faroles. */
(function (root, factory) {
  const engine = root.Truco || (typeof require === 'function' ? require('./engine.js') : null);
  const api = factory(engine);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TrucoBot = api;
})(typeof self !== 'undefined' ? self : this, function (T) {
  'use strict';

  const HUMAN = 0;
  const BOT = 1;
  const STORAGE_KEY = 'truco.bot.model.v1';
  const MODEL_VERSION = 1;
  const DEFAULT_SAMPLES = 140;
  const MAX_ENVIDO_RESAMPLES = 40;

  // Priors: cuantos datos "imaginarios" tiene el bot antes de conocerte.
  const PRIOR = {
    trucoFold: { value: 0.35, weight: 2 },
    envidoFold: { value: 0.3, weight: 2 },
    callHonesty: { value: 0.6, weight: 3 },
    envidoMean: { value: 26, weight: 3 },
    leadStrong: { value: 0.4, weight: 3 },
  };

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const smooth = (count, n, prior) => (count + prior.value * prior.weight) / (n + prior.weight);

  const blankModel = () => ({
    v: MODEL_VERSION,
    createdAt: 0,
    games: 0,
    humanWins: 0,
    hands: 0,
    humanHandWins: 0,
    truco: { botCalls: 0, fold: 0, accept: 0, raise: 0, humanCalls: 0, humanCallsPlayed: 0, humanCallWins: 0 },
    envido: { botCalls: 0, fold: 0, accept: 0, raise: 0, humanCalls: 0, humanCallsShown: 0, ptsSum: 0 },
    lead: { strong: 0, mid: 0, weak: 0 },
    mazo: 0,
  });

  function safeStorage() {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch (_) {
      return null;
    }
  }

  /** Politica rapida para los rollouts (no es el bot real, solo el modelo de "gente jugando"). */
  function policyIndex(hand, onTable, results, me, rng, profile) {
    const ranks = hand.map(T.rankOf);
    const order = ranks.map((_, i) => i).sort((a, b) => ranks[a] - ranks[b]);
    if (onTable) {
      const target = T.rankOf(onTable);
      const winners = order.filter((i) => ranks[i] > target);
      if (winners.length && rng() < 0.92) return winners[0];
      const ties = order.filter((i) => ranks[i] === target);
      if (ties.length && rng() < 0.6) return ties[0];
      return order[0];
    }
    if (results.length === 0) {
      const u = rng();
      if (u < profile.best) return order[order.length - 1];
      if (u < profile.best + profile.worst) return order[0];
      return order[Math.floor((order.length - 1) / 2)];
    }
    return order[order.length - 1];
  }

  function rollout(st, rng, profiles) {
    const hands = [st.hands[0].slice(), st.hands[1].slice()];
    const results = st.results.slice();
    const cur = st.cur.slice();
    let leader = st.leader;
    for (;;) {
      if (cur[0] && cur[1]) {
        const a = T.rankOf(cur[0]);
        const b = T.rankOf(cur[1]);
        const w = a === b ? -1 : a > b ? 0 : 1;
        results.push(w);
        const hw = T.handWinner(results, st.mano);
        if (hw !== null) return hw;
        leader = w === -1 ? st.mano : w;
        cur[0] = null;
        cur[1] = null;
        continue;
      }
      const p = cur[leader] === null ? leader : 1 - leader;
      const idx = policyIndex(hands[p], cur[1 - p], results, p, rng, profiles[p]);
      cur[p] = hands[p].splice(idx, 1)[0];
    }
  }

  class Bot {
    constructor({ storage, rng = Math.random, key = STORAGE_KEY, samples = DEFAULT_SAMPLES } = {}) {
      this.storage = storage === undefined ? safeStorage() : storage;
      this.rng = rng;
      this.key = key;
      this.samples = samples;
      this.model = this.load();
    }

    load() {
      const fresh = { ...blankModel(), createdAt: Date.now() };
      try {
        const raw = this.storage && this.storage.getItem(this.key);
        if (!raw) return fresh;
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.v !== MODEL_VERSION) return fresh;
        const base = blankModel();
        return {
          ...base, ...parsed,
          truco: { ...base.truco, ...parsed.truco },
          envido: { ...base.envido, ...parsed.envido },
          lead: { ...base.lead, ...parsed.lead },
        };
      } catch (_) {
        return fresh;
      }
    }

    save() {
      try {
        if (this.storage) this.storage.setItem(this.key, JSON.stringify(this.model));
      } catch (_) {
        // sin almacenamiento el bot sigue jugando, solo que no recuerda entre visitas
      }
    }

    reset() {
      this.model = { ...blankModel(), createdAt: Date.now() };
      try {
        if (this.storage) this.storage.removeItem(this.key);
      } catch (_) {
        // idem
      }
    }

    // ---------- aprendizaje ----------

    observe(ev) {
      const m = this.model;
      switch (ev.type) {
        case 'truco-call':
          if (ev.by === HUMAN) m.truco.humanCalls++;
          break;
        case 'truco-response':
          if (ev.by === HUMAN && ev.caller === BOT) {
            m.truco.botCalls++;
            m.truco[ev.response === 'reject' ? 'fold' : ev.response === 'raise' ? 'raise' : 'accept']++;
          }
          break;
        case 'envido-call':
          if (ev.by === HUMAN) m.envido.humanCalls++;
          break;
        case 'envido-response':
          if (ev.by === HUMAN && ev.caller === BOT) {
            m.envido.botCalls++;
            m.envido[ev.response === 'reject' ? 'fold' : ev.response === 'raise' ? 'raise' : 'accept']++;
          }
          break;
        case 'envido-result':
          if (ev.accepted && ev.callers.includes(HUMAN)) {
            m.envido.humanCallsShown++;
            m.envido.ptsSum += ev.points[HUMAN];
          }
          break;
        case 'play':
          if (ev.player === HUMAN && ev.trickIndex === 0 && ev.isLead) {
            const r = T.rankOf(ev.card);
            m.lead[r >= 10 ? 'strong' : r >= 7 ? 'mid' : 'weak']++;
          }
          break;
        case 'mazo':
          if (ev.player === HUMAN) m.mazo++;
          break;
        case 'hand-end':
          m.hands++;
          if (ev.winner === HUMAN) m.humanHandWins++;
          if (ev.reason === 'tricks' && ev.trucoLevel >= 1 && ev.lastTrucoCaller === HUMAN) {
            m.truco.humanCallsPlayed++;
            if (ev.winner === HUMAN) m.truco.humanCallWins++;
          }
          break;
        case 'game-end':
          m.games++;
          if (ev.winner === HUMAN) m.humanWins++;
          break;
        default:
          return;
      }
      this.save();
    }

    rates() {
      const { truco, envido, lead } = this.model;
      const leadTotal = lead.strong + lead.mid + lead.weak;
      return {
        trucoFold: smooth(truco.fold, truco.botCalls, PRIOR.trucoFold),
        envidoFold: smooth(envido.fold, envido.botCalls, PRIOR.envidoFold),
        callHonesty: smooth(truco.humanCallWins, truco.humanCallsPlayed, PRIOR.callHonesty),
        envidoCallMean: smooth(envido.ptsSum, envido.humanCallsShown, PRIOR.envidoMean),
        leadStrong: smooth(lead.strong, leadTotal, PRIOR.leadStrong),
      };
    }

    insights() {
      const m = this.model;
      const r = this.rates();
      const leadTotal = m.lead.strong + m.lead.mid + m.lead.weak;
      const pct = (x) => `${Math.round(x * 100)}%`;
      const trucoFoldNote = m.truco.botCalls < 3
        ? 'Todavía te está conociendo. Va a cantar truco en serio y con algún farol.'
        : r.trucoFold > 0.5
          ? 'Te bajás seguido: va a faroliar más trucos y a cantar con menos mano.'
          : r.trucoFold < 0.25
            ? 'Casi nunca te bajás: solo va a cantar truco con mano fuerte.'
            : 'Le aceptás trucos a veces: canta con mano buena y farolea poco.';
      const honestyNote = m.truco.humanCallsPlayed < 3
        ? 'Necesita ver algunos trucos tuyos jugados hasta el final.'
        : r.callHonesty < 0.45
          ? 'Tus trucos suelen perderse: ahora te los acepta con más facilidad.'
          : r.callHonesty > 0.7
            ? 'Cuando cantás, ganás: te acepta con más cuidado.'
            : 'Tus trucos son parejos: no cambia su criterio.';
      const envidoNote = m.envido.humanCallsShown < 3
        ? 'Todavía no vio puntos tuyos de un envido cantado.'
        : `Cuando cantás envido, tenés ${r.envidoCallMean.toFixed(0)} en promedio. Acepta si tiene cerca de eso o más.`;
      const envidoFoldNote = m.envido.botCalls < 3
        ? 'Todavía sin datos de cómo respondés al envido.'
        : r.envidoFold > 0.5
          ? 'Rechazás casi todo envido: va a cantarlo hasta con puntos bajos.'
          : 'Aceptás bastante: canta envido solo con buenos puntos.';
      const leadNote = leadTotal < 4
        ? 'Todavía no sabe con qué carta arrancás.'
        : r.leadStrong > 0.55
          ? 'Arrancás con carta fuerte: lo tiene en cuenta en sus simulaciones.'
          : r.leadStrong < 0.3
            ? 'Arrancás con carta chica: lo tiene en cuenta cuando juega.'
            : 'Tu primera carta es variada.';
      return [
        { key: 'trucoFold', title: 'Te bajás del truco', value: r.trucoFold, display: pct(r.trucoFold), n: m.truco.botCalls, note: trucoFoldNote },
        { key: 'callHonesty', title: 'Ganás cuando cantás truco', value: r.callHonesty, display: pct(r.callHonesty), n: m.truco.humanCallsPlayed, note: honestyNote },
        { key: 'envidoCallMean', title: 'Puntos de tus envidos cantados', value: clamp((r.envidoCallMean - 20) / 13, 0, 1), display: r.envidoCallMean.toFixed(1), n: m.envido.humanCallsShown, note: envidoNote },
        { key: 'envidoFold', title: 'Te bajás del envido', value: r.envidoFold, display: pct(r.envidoFold), n: m.envido.botCalls, note: envidoFoldNote },
        { key: 'leadStrong', title: 'Arrancás con carta fuerte', value: r.leadStrong, display: pct(r.leadStrong), n: leadTotal, note: leadNote },
      ];
    }

    // ---------- simulacion ----------

    opponentProfile() {
      const strong = this.rates().leadStrong;
      return { best: clamp(0.15 + 0.7 * strong, 0.15, 0.8), worst: 0.2 };
    }

    /** Probabilidad de ganar la mano, por carta jugable (si me toca) o global. */
    estimate(view, samples = this.samples) {
      const me = view.me;
      const opp = view.opp;
      const known = new Set([...view.dealt, ...view.oppPlayed].map((c) => `${c.num}${c.suit}`));
      const unseen = T.makeDeck().filter((c) => !known.has(`${c.num}${c.suit}`));
      const unknownCount = 3 - view.oppPlayed.length;
      const profiles = [null, null];
      profiles[me] = { best: 0.45, worst: 0.2 };
      profiles[opp] = this.opponentProfile();

      const myTurnToPlay = view.playTurn === me && view.cur.cards[me] === null;
      const options = myTurnToPlay ? view.hand.map((_, index) => ({ index, wins: 0 })) : [{ index: -1, wins: 0 }];

      for (let s = 0; s < samples; s++) {
        const oppRest = this.sampleOpponent(unseen, unknownCount, view);
        for (const opt of options) {
          const hands = [null, null];
          hands[me] = view.hand.slice();
          hands[opp] = oppRest.slice();
          const cur = view.cur.cards.slice();
          if (opt.index >= 0) cur[me] = hands[me].splice(opt.index, 1)[0];
          const winner = rollout(
            { hands, results: view.results, leader: view.cur.leader, cur, mano: view.mano },
            this.rng, profiles,
          );
          if (winner === me) opt.wins++;
        }
      }
      const perCard = options.map((o) => ({ index: o.index, p: o.wins / samples }));
      return { perCard, best: Math.max(...perCard.map((o) => o.p)) };
    }

    sampleOpponent(unseen, count, view) {
      const draw = () => T.shuffle(unseen, this.rng).slice(0, count);
      if (view.oppEnvido === null) return draw();
      let pick = draw();
      for (let tries = 0; tries < MAX_ENVIDO_RESAMPLES; tries++) {
        if (T.envidoPoints([...view.oppPlayed, ...pick]) === view.oppEnvido) return pick;
        pick = draw();
      }
      return pick;
    }

    // ---------- decisiones ----------

    decide(view) {
      const est = this.estimate(view);
      if (view.phase === 'respond-envido') return this.answerEnvido(view);
      if (view.phase === 'respond-truco') return this.answerTruco(view, est);
      return this.act(view, est);
    }

    has(view, type, what) {
      return view.legal.some((a) => a.type === type && (what === undefined || a.what === what));
    }

    act(view, est) {
      if (view.trickIndex === 0 && this.has(view, 'envido')) {
        const what = this.pickEnvidoCall(view);
        if (what) return { type: 'envido', what };
      }
      if (this.has(view, 'truco') && this.shouldCallTruco(view, est, view.trucoLevel + 1)) {
        return { type: 'truco' };
      }
      return { type: 'play', index: this.pickCard(est) };
    }

    pickCard(est) {
      const ranked = est.perCard.slice().sort((a, b) => b.p - a.p);
      if (ranked.length > 1 && ranked[0].p - ranked[1].p < 0.06 && this.rng() < 0.35) return ranked[1].index;
      return ranked[0].index;
    }

    pickEnvidoCall(view) {
      const e = view.myEnvido;
      const foldRate = this.rates().envidoFold;
      const isMano = view.mano === view.me;
      const roll = this.rng();
      if (e >= 33) return roll < 0.35 ? 'falta' : 'real';
      if (e >= 31) return roll < 0.6 ? 'real' : 'envido';
      if (e >= 27) return roll < 0.85 ? 'envido' : null;
      if (e >= 24) {
        const chance = (isMano ? 0.3 : 0.15) + (foldRate > 0.5 ? 0.2 : 0);
        return roll < chance ? 'envido' : null;
      }
      const bluff = clamp((foldRate - 0.35) * 0.8, 0, 0.3);
      return roll < bluff ? 'envido' : null;
    }

    shouldCallTruco(view, est, nextLevel) {
      const p = est.best;
      const foldRate = this.rates().trucoFold;
      const threshold = clamp(0.66 + 0.06 * (nextLevel - 1) - (foldRate - 0.35) * 0.3, 0.5, 0.9);
      if (p >= threshold) return this.rng() < 0.7;
      const bluffRate = nextLevel === 1
        ? clamp((foldRate - 0.3) * 0.8, 0, 0.3)
        : clamp((foldRate - 0.45) * 0.5, 0, 0.15);
      return p > 0.12 && p < 0.5 && this.rng() < bluffRate * 0.5;
    }

    answerTruco(view, est) {
      const level = view.pending.level;
      const rates = this.rates();
      const value = T.valueOfTruco(level);
      const fallback = T.valueOfTruco(level - 1);
      const signal = 0.04 * level + (rates.callHonesty - 0.5) * 0.25;
      const p = est.best - signal;

      if (this.has(view, 'envido') && view.myEnvido >= 28 && this.rng() < 0.6) {
        return { type: 'envido', what: view.myEnvido >= 31 ? 'real' : 'envido' };
      }
      if (this.has(view, 'truco')) {
        if (p >= 0.74 + 0.04 * level) return { type: 'truco' };
        if (p > 0.35 && p < 0.5 && rates.trucoFold > 0.5 && this.rng() < 0.08) return { type: 'truco' };
      }
      const acceptThreshold = 0.5 - fallback / (2 * value) + 0.14;
      return { type: p >= acceptThreshold ? 'accept' : 'reject' };
    }

    answerEnvido(view) {
      const stack = view.pending.stack;
      const mean = this.rates().envidoCallMean;
      const effective = view.myEnvido + (view.mano === view.me ? 0.5 : 0);
      const acceptThreshold = clamp(
        mean - 2.5 + 1.5 * (stack.length - 1) + (stack.includes('falta') ? 3 : 0), 21, 31,
      );
      const options = view.legal.filter((a) => a.type === 'envido').map((a) => a.what);
      if (options.length && effective >= acceptThreshold + 4) {
        if (options.includes('falta') && effective >= 33 && this.rng() < 0.4) return { type: 'envido', what: 'falta' };
        if (options.includes('real')) return { type: 'envido', what: 'real' };
        return { type: 'envido', what: options[0] };
      }
      return { type: effective >= acceptThreshold ? 'accept' : 'reject' };
    }
  }

  return { Bot, blankModel, STORAGE_KEY };
});
