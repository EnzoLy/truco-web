/* Arcade dúo: la run de arcade-shell.js sobre la mesa de 4 de las salas (sala-table.js), con una sala local
 * (local-room.js) donde juegan tu compañero y los dos rivales. */
(function () {
  'use strict';

  const A = window.TrucoArcade;
  const UNLOCK_EVENTS = ['pointerup', 'keydown', 'click'];
  // El último telón de mano (2,8 s) y algún canto tienen que terminar antes de que aparezca la tienda.
  const GAME_END_DELAY_MS = 3200;
  const $ = (id) => document.getElementById(id);
  const storage = (() => { try { return window.localStorage; } catch (err) { return null; } })();

  const Sound = window.TrucoSoundFactory.createSound({
    AudioContextCtor: window.AudioContext || window.webkitAudioContext,
    storage,
    fetchImpl: window.fetch && window.fetch.bind(window),
    baseUrl: '/sounds',
  });

  /** Asientos de la mesa: vos 0, rival A 1, compañero 2, rival B 3. */
  const seatsFor = (run) => [
    { name: 'Vos', kind: 'human' },
    { name: run.rivals[0].name, kind: 'bot', traits: run.rivals[0].traits },
    { name: 'Tu compañero', kind: 'bot' },
    { name: run.rivals[1].name, kind: 'bot', traits: run.rivals[1].traits },
  ];

  function mountTable({ run, onEvents, onGameEnd, resumeState }) {
    let room = null;
    const table = window.TrucoSalaTable.create({
      Sound,
      showEnd: false,
      send: async (action) => room.act(action),
      sendSign: async () => {},
    });

    function begin(current, initialState) {
      if (room) room.stop();
      table.reset();
      room = window.TrucoLocalRoom.createLocalRoom({
        mode: 'dupla',
        seats: seatsFor(current),
        mods: A.matchOptions(current).mods,
        initialState,
        onChange: ({ snapshot, events, state }) => {
          table.show(snapshot);
          onEvents(events, state);
          if (events.some((ev) => ev.type === 'game-end')) setTimeout(onGameEnd, GAME_END_DELAY_MS);
        },
      });
      room.start();
    }

    if (resumeState) begin(run, resumeState);
    return { newMatch: (next) => begin(next, null) };
  }

  // ---------- sonido y planilla, como en las salas ----------

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

  // Escritorio: la planilla va arriba de la columna derecha. Celular: arriba de la mesa.
  const wide = window.matchMedia('(min-width: 960px)');
  function placeBoard() {
    if (wide.matches) document.querySelector('.side').prepend($('board'));
    else $('screen-table').prepend($('board'));
  }
  placeBoard();
  wide.addEventListener('change', placeBoard);

  window.TrucoArcadeShell.start({ mode: 'duo', mountTable });
})();
