/* Sonidos sintetizados con Web Audio: sin archivos de audio ni dependencias.
   El contexto se crea recien con el primer gesto del usuario (politica de autoplay). */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'truco-sonido';
  const MASTER_GAIN = 0.55;
  const NOISE_SECONDS = 1;
  const SILENCE = 0.0001;

  // Notas en Hz.
  const NOTE = { g4: 392, c5: 523.25, e5: 659.25, g5: 783.99, c6: 1046.5, eb4: 311.13, f4: 349.23, c4: 261.63 };

  function createSound({ AudioContextCtor, storage }) {
    let ctx = null;
    let master = null;
    let noise = null;
    let muted = readMuted();
    let unlocked = false;

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
        master.connect(ctx.destination);
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

    /** Golpe de nudillo sobre la mesa de madera. */
    const knock = (at) => {
      tone(at, { freq: 190, to: 80, dur: 0.11, gain: 0.7 });
      hiss(at, { filter: 'lowpass', freq: 700, dur: 0.05, gain: 0.3 });
    };

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
      // Truco: un golpe en la mesa por cada nivel (truco, retruco, vale cuatro).
      knock: (at, { level = 1 } = {}) => {
        for (let i = 0; i < Math.min(Math.max(level, 1), 3); i++) knock(at + i * 0.15);
      },
      envido: (at) => [880, 1318.5, 1760].forEach((freq, i) => tone(at, { freq, dur: 0.7 - i * 0.12, gain: 0.17 })),
      quiero: (at) => arpeggio(at, [NOTE.c5, NOTE.g5], { step: 0.1, dur: 0.18, gain: 0.16 }),
      noquiero: (at) => arpeggio(at, [NOTE.g4, NOTE.c4], { step: 0.12, dur: 0.22, gain: 0.15 }),
      mazo: (at) => hiss(at, { freq: 2200, to: 450, q: 0.9, dur: 0.28, gain: 0.22 }),
      trickWin: (at) => arpeggio(at, [NOTE.c5, NOTE.e5, NOTE.g5], { step: 0.07, dur: 0.16, gain: 0.15 }),
      trickLoss: (at) => tone(at, { freq: 300, to: 190, type: 'triangle', dur: 0.2, gain: 0.12 }),
      // Un fosforo que se raspa y prende.
      point: (at) => {
        hiss(at, { freq: 1500, to: 4200, q: 1.2, dur: 0.14, gain: 0.16 });
        hiss(at + 0.12, { filter: 'highpass', freq: 5000, dur: 0.03, gain: 0.1 });
      },
      turn: (at) => tone(at, { freq: 660, type: 'sine', dur: 0.12, gain: 0.07 }),
      win: (at) => {
        arpeggio(at, [NOTE.c5, NOTE.e5, NOTE.g5, NOTE.c6], { step: 0.11, dur: 0.3, gain: 0.17 });
        tone(at + 0.44, { freq: NOTE.c6 * 2, dur: 0.9, gain: 0.08 });
      },
      lose: (at) => arpeggio(at, [NOTE.g4, NOTE.f4, NOTE.eb4, NOTE.c4], { step: 0.2, type: 'sawtooth', dur: 0.35, gain: 0.07 }),
    };

    return {
      names: Object.keys(SOUNDS),
      /** `delay` en segundos para sincronizar con una animacion. */
      play(name, opts = {}) {
        const sound = SOUNDS[name];
        if (!unlocked || muted || !sound || !ensure()) return;
        sound(ctx.currentTime + (opts.delay || 0), opts);
      },
      /** Llamar desde un gesto del usuario. Antes de eso no suena nada, y lo programado antes se descarta. */
      unlock() {
        unlocked = true;
        ensure();
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
