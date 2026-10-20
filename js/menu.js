/* Menú de inicio: elegir modo de juego y ajustes. Todo se guarda en este navegador (localStorage). */
(function () {
  'use strict';

  const NAME_KEY = 'truco-nombre';
  const BOT_KEY = window.TrucoBot.STORAGE_KEY;
  const SETTINGS_HASH = '#ajustes';
  const RESET_CONFIRM_MS = 3000;

  const $ = (id) => document.getElementById(id);
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch (err) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (err) { /* sin almacenamiento */ } },
    remove(key) { try { localStorage.removeItem(key); } catch (err) { /* sin almacenamiento */ } },
  };

  const Sound = window.TrucoSoundFactory.createSound({
    AudioContextCtor: window.AudioContext || window.webkitAudioContext,
    storage: (() => { try { return window.localStorage; } catch (err) { return null; } })(),
  });

  // ---------- pantallas ----------

  function route() {
    const settings = location.hash === SETTINGS_HASH;
    $('screen-menu').hidden = settings;
    $('screen-settings').hidden = !settings;
    document.title = settings ? 'Truco · Ajustes' : 'Truco';
    if (settings) syncSettings();
  }

  const openSettings = () => { location.hash = SETTINGS_HASH; };
  const closeSettings = () => { history.pushState(null, '', location.pathname + location.search); route(); };

  // ---------- sonido ----------

  function syncSound() {
    const on = !Sound.isMuted();
    $('sound-toggle').setAttribute('aria-pressed', String(on));
    $('sound-toggle').setAttribute('aria-label', on ? 'Sonido activado' : 'Sonido silenciado');
    $('sound-switch').checked = on;
  }

  function setSound(on) {
    Sound.setMuted(!on);
    syncSound();
    Sound.play('select');
  }

  // ---------- memoria del bot ----------

  let resetArmed = null;

  /** Lo que el bot guardó de este jugador, o null si todavía no jugaron. */
  function readBrain() {
    try {
      const model = JSON.parse(store.get(BOT_KEY) || 'null');
      return model && model.hands > 0 ? model : null;
    } catch (err) {
      return null;
    }
  }

  function renderBrain() {
    const model = readBrain();
    $('brain-sub').textContent = model
      ? `Vio ${model.hands} ${model.hands === 1 ? 'mano' : 'manos'} tuyas.`
      : 'Todavía no te conoce. Cuanto más juegues, mejor te lee.';
    $('reset-brain').disabled = !model;
  }

  function disarmReset() {
    clearTimeout(resetArmed);
    resetArmed = null;
    $('reset-brain').textContent = 'Borrar';
  }

  function onResetBrain() {
    const btn = $('reset-brain');
    if (!resetArmed) {
      btn.textContent = '¿Seguro?';
      resetArmed = setTimeout(disarmReset, RESET_CONFIRM_MS);
      return;
    }
    disarmReset();
    store.remove(BOT_KEY);
    renderBrain();
  }

  // ---------- ajustes ----------

  function syncSettings() {
    $('name').value = store.get(NAME_KEY) || '';
    syncSound();
    renderBrain();
  }

  $('name').addEventListener('input', () => store.set(NAME_KEY, $('name').value.trim()));
  $('sound-switch').addEventListener('change', () => setSound($('sound-switch').checked));
  $('sound-toggle').addEventListener('click', () => setSound(Sound.isMuted()));
  $('reset-brain').addEventListener('click', onResetBrain);
  $('open-settings').addEventListener('click', openSettings);
  $('back').addEventListener('click', closeSettings);
  window.addEventListener('hashchange', route);

  const UNLOCK_EVENTS = ['pointerup', 'keydown', 'click'];
  function unlockAudio() {
    Sound.unlock();
    UNLOCK_EVENTS.forEach((type) => document.removeEventListener(type, unlockAudio));
  }
  UNLOCK_EVENTS.forEach((type) => document.addEventListener(type, unlockAudio));

  syncSound();
  route();
})();
