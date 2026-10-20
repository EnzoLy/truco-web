/* Arcade solo: la run de arcade-shell.js sobre la mesa 1v1 del modo bot (ui.js, TrucoTable.mount). */
(function () {
  'use strict';

  const A = window.TrucoArcade;
  const T = window.Truco;
  const BOT_KEY = 'truco.arcade.bot';
  const rng = Math.random;

  const refOf = (name) => name.replace(/^El /, 'el ');
  const makeBot = (rival) => new window.TrucoBot.Bot({ storage: null, key: BOT_KEY, samples: rival.samples, traits: rival.traits });
  const matchConfig = (run) => ({
    bot: makeBot(run.rival),
    newGame: () => T.newGame(rng, A.matchOptions(run)),
    botName: run.rival.name,
    botRef: refOf(run.rival.name),
  });

  function mountTable({ run, onEvents, onGameEnd, resumeState }) {
    const table = window.TrucoTable.mount({
      ...matchConfig(run),
      onEvents,
      onGameEnd: () => { onGameEnd(); return true; },
      initialState: resumeState,
      idle: !resumeState,
    });
    return { newMatch: (next) => table.newMatch(matchConfig(next)) };
  }

  window.TrucoArcadeShell.start({ mode: 'solo', mountTable });
})();
