/* Sonidos de la mesa con Web Audio.
   Con fetchImpl + baseUrl usa samples reales (cartas de "Casino Audio" y monedas de "RPG Audio", de Kenney, CC0,
   ver sounds/LICENSE-kenney.txt); mientras cargan, o si fallan, suena la version sintetizada.
   El contexto se crea recien con el primer gesto del usuario (politica de autoplay). */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'truco-sonido';
  const MASTER_GAIN = 0.55;
  const NOISE_SECONDS = 1;
  const SILENCE = 0.0001;
  // Cada toque sale con el tono y el volumen apenas distintos, para que no suene a ametralladora.
  const RATE_JITTER = 0.05;
  const GAIN_JITTER = 0.1;
  // Corta los agudos ásperos de todo lo que suena.
  const SOFT_LOWPASS_HZ = 6000;

  // Notas en Hz.
  const NOTE = { c5: 523.25, e5: 659.25, g5: 783.99 };

  /** Samples por sonido: se elige una variante al azar para que no suene repetido. */
  const SAMPLES = {
    select: { files: ['select'], gain: 0.35 },
    deal: { files: ['deal-1', 'deal-2', 'deal-3', 'deal-4'], gain: 0.9 },
    play: { files: ['play-1', 'play-2', 'play-4'], gain: 1.2 },
    quiero: { files: ['quiero'], gain: 0.8 },
    mazo: { files: ['mazo'], gain: 1 },
    trickWin: { files: ['trick-win-1', 'trick-win-2'], gain: 1 },
    turn: { files: ['turn'], gain: 0.25 },
  };

  function createSound({ AudioContextCtor, storage, fetchImpl, baseUrl }) {
    let ctx = null;
    let master = null;
    let noise = null;
    let muted = readMuted();
    let unlocked = false;
    const buffers = new Map(); // archivo -> AudioBuffer ya decodificado
    let loading = false;

    /** Baja y decodifica todos los samples una sola vez. Los que fallan quedan con el sintetizado. */
    function loadSamples() {
      if (loading || !fetchImpl || !baseUrl || !ctx || !ctx.decodeAudioData) return;
      loading = true;
      const files = [...new Set(Object.values(SAMPLES).flatMap((s) => s.files))];
      files.forEach((file) => {
        const url = `${baseUrl}/${file}.mp3`;
        Promise.resolve()
          .then(() => fetchImpl(url))
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.arrayBuffer();
          })
          .then((data) => ctx.decodeAudioData(data))
          .then((buffer) => buffers.set(file, buffer))
          .catch((err) => console.warn(`Sonido ${url} no cargó, uso el sintetizado`, err));
      });
    }

    const spread = (amount) => 1 + (Math.random() * 2 - 1) * amount;

    function playSample(at, buffer, gain) {
      const src = ctx.createBufferSource();
      const amp = ctx.createGain();
      src.buffer = buffer;
      if (src.playbackRate) src.playbackRate.value = spread(RATE_JITTER);
      amp.gain.value = gain * spread(GAIN_JITTER);
      src.connect(amp).connect(master);
      src.start(at);
    }

    /** true si lo pudo tocar con samples. */
    function trySample(name, at) {
      const def = SAMPLES[name];
      const ready = def ? def.files.filter((f) => buffers.has(f)) : [];
      if (!ready.length) return false;
      playSample(at, buffers.get(ready[Math.floor(Math.random() * ready.length)]), def.gain);
      return true;
    }

    function readMuted() {
      try { return storage && storage.getItem(STORAGE_KEY) === 'off'; } catch (err) { return false; }
    }

    function ensure() {
      if (!AudioContextCtor) return false;
      if (!ctx) {
        try {
          ctx = new AudioContextCtor();
        } catch (err) {
          ctx = null;
          return false;
        }
        master = ctx.createGain();
        master.gain.value = MASTER_GAIN;
        const soft = ctx.createBiquadFilter();
        soft.type = 'lowpass';
        soft.frequency.value = SOFT_LOWPASS_HZ;
        master.connect(soft).connect(ctx.destination);
        noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      return true;
    }

    /** Envolvente: ataque corto y caida exponencial hasta el silencio. */
    function envelope(gainNode, at, dur, peak, attack = 0.005) {
      gainNode.gain.setValueAtTime(SILENCE, at);
      gainNode.gain.exponentialRampToValueAtTime(Math.max(peak, SILENCE), at + attack);
      gainNode.gain.exponentialRampToValueAtTime(SILENCE, at + dur);
    }

    function tone(at, { freq, to, type = 'sine', dur, gain }) {
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, at);
      if (to) osc.frequency.exponentialRampToValueAtTime(to, at + dur);
      envelope(amp, at, dur, gain);
      osc.connect(amp).connect(master);
      osc.start(at);
      osc.stop(at + dur + 0.02);
    }

    function hiss(at, { filter = 'bandpass', freq, to, q = 1, dur, gain }) {
      const src = ctx.createBufferSource();
      const biquad = ctx.createBiquadFilter();
      const amp = ctx.createGain();
      src.buffer = noise;
      biquad.type = filter;
      biquad.Q.value = q;
      biquad.frequency.setValueAtTime(freq, at);
      if (to) biquad.frequency.exponentialRampToValueAtTime(to, at + dur);
      envelope(amp, at, dur, gain, 0.003);
      src.connect(biquad).connect(amp).connect(master);
      src.start(at);
      src.stop(at + dur + 0.02);
    }

    const arpeggio = (at, notes, { step, type = 'triangle', dur, gain }) =>
      notes.forEach((freq, i) => tone(at + i * step, { freq, type, dur, gain }));

    const SOUNDS = {
      select: (at) => {
        tone(at, { freq: 900, to: 650, type: 'triangle', dur: 0.05, gain: 0.12 });
        hiss(at, { filter: 'highpass', freq: 4000, dur: 0.02, gain: 0.08 });
      },
      deal: (at) => hiss(at, { freq: 3200, to: 1400, q: 0.8, dur: 0.09, gain: 0.2 }),
      // La carta cae sobre el pano: golpe grave y un soplido de tela.
      play: (at) => {
        tone(at, { freq: 150, to: 55, dur: 0.14, gain: 0.55 });
        hiss(at, { filter: 'lowpass', freq: 900, dur: 0.07, gain: 0.28 });
      },
      quiero: (at) => arpeggio(at, [NOTE.c5, NOTE.g5], { step: 0.1, dur: 0.18, gain: 0.16 }),
      mazo: (at) => hiss(at, { freq: 2200, to: 450, q: 0.9, dur: 0.28, gain: 0.22 }),
      trickWin: (at) => arpeggio(at, [NOTE.c5, NOTE.e5, NOTE.g5], { step: 0.07, dur: 0.16, gain: 0.15 }),
      turn: (at) => tone(at, { freq: 660, type: 'sine', dur: 0.12, gain: 0.07 }),
    };

    return {
      names: Object.keys(SOUNDS),
      /** `delay` en segundos para sincronizar con una animacion. */
      play(name, opts = {}) {
        const sound = SOUNDS[name];
        if (!unlocked || muted || !sound || !ensure()) return;
        const at = ctx.currentTime + (opts.delay || 0);
        if (!trySample(name, at)) sound(at);
      },
      /** Llamar desde un gesto del usuario. Antes de eso no suena nada, y lo programado antes se descarta. */
      unlock() {
        unlocked = true;
        if (ensure()) loadSamples();
      },
      isMuted: () => muted,
      setMuted(value) {
        muted = Boolean(value);
        try { if (storage) storage.setItem(STORAGE_KEY, muted ? 'off' : 'on'); } catch (err) { /* sin almacenamiento: queda solo en memoria */ }
        return muted;
      },
    };
  }

  const api = { createSound };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrucoSoundFactory = api;
})(typeof window !== 'undefined' ? window : globalThis);
