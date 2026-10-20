'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSound } = require('../js/sound.js');

function fakeAudio() {
  const log = { contexts: 0, oscillators: 0, sources: 0, resumed: 0 };
  const param = () => ({
    value: 0,
    setValueAtTime() {},
    exponentialRampToValueAtTime() {},
  });
  const node = (extra = {}) => ({ connect: (next) => next || node(), ...extra });
  class FakeContext {
    constructor() {
      log.contexts++;
      this.currentTime = 1;
      this.sampleRate = 100;
      this.state = 'suspended';
      this.destination = node();
    }
    resume() { log.resumed++; }
    createGain() { return node({ gain: param() }); }
    createOscillator() { log.oscillators++; return node({ frequency: param(), start() {}, stop() {} }); }
    createBufferSource() { log.sources++; return node({ start() {}, stop() {} }); }
    createBiquadFilter() { return node({ frequency: param(), Q: { value: 0 } }); }
    createBuffer(_ch, length) { return { getChannelData: () => new Float32Array(length) }; }
  }
  return { FakeContext, log };
}

const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; }, data };
};

test('plays every named sound without throwing', () => {
  const { FakeContext } = fakeAudio();
  const sound = createSound({ AudioContextCtor: FakeContext, storage: memoryStorage() });
  sound.unlock();
  assert.ok(sound.names.length > 0);
  for (const name of sound.names) assert.doesNotThrow(() => sound.play(name, { level: 3, delay: 0.2 }), name);
});

test('does not create an audio context until a sound is requested', () => {
  const { FakeContext, log } = fakeAudio();
  createSound({ AudioContextCtor: FakeContext, storage: memoryStorage() });
  assert.equal(log.contexts, 0);
});

test('stays silent and never touches audio while muted', () => {
  const { FakeContext, log } = fakeAudio();
  const sound = createSound({ AudioContextCtor: FakeContext, storage: memoryStorage() });
  sound.unlock();
  sound.setMuted(true);
  const before = log.oscillators;
  sound.play('play');
  assert.equal(log.oscillators, before);
  assert.equal(sound.isMuted(), true);
});

test('remembers the mute choice in storage', () => {
  const storage = memoryStorage();
  createSound({ AudioContextCtor: fakeAudio().FakeContext, storage }).setMuted(true);
  const reloaded = createSound({ AudioContextCtor: fakeAudio().FakeContext, storage });
  assert.equal(reloaded.isMuted(), true);
  reloaded.setMuted(false);
  assert.equal(createSound({ AudioContextCtor: fakeAudio().FakeContext, storage }).isMuted(), false);
});

test('ignores unknown sound names', () => {
  const { FakeContext, log } = fakeAudio();
  const sound = createSound({ AudioContextCtor: FakeContext, storage: memoryStorage() });
  sound.unlock();
  const before = log.oscillators + log.sources;
  sound.play('no-existe');
  assert.equal(log.oscillators + log.sources, before);
});

test('drops sounds requested before the first user gesture', () => {
  const { FakeContext, log } = fakeAudio();
  const sound = createSound({ AudioContextCtor: FakeContext, storage: memoryStorage() });
  sound.play('deal');
  assert.equal(log.contexts, 0);
  sound.unlock();
  sound.play('deal');
  assert.ok(log.sources > 0);
});

test('works without Web Audio support or storage', () => {
  const sound = createSound({ AudioContextCtor: undefined, storage: undefined });
  assert.doesNotThrow(() => sound.unlock());
  assert.doesNotThrow(() => sound.play('play'));
  assert.doesNotThrow(() => sound.setMuted(true));
});

test('resumes a suspended context on unlock', () => {
  const { FakeContext, log } = fakeAudio();
  const sound = createSound({ AudioContextCtor: FakeContext, storage: memoryStorage() });
  sound.unlock();
  assert.equal(log.contexts, 1);
  assert.equal(log.resumed, 1);
});

test('knock plays one hit per truco level, capped at three', () => {
  const { FakeContext, log } = fakeAudio();
  const sound = createSound({ AudioContextCtor: FakeContext, storage: memoryStorage() });
  sound.unlock();
  const base = log.oscillators;
  sound.play('knock', { level: 1 });
  const one = log.oscillators - base;
  sound.play('knock', { level: 3 });
  assert.equal(log.oscillators - one, one * 3);
  const before = log.oscillators;
  sound.play('knock', { level: 9 });
  assert.equal(log.oscillators - before, one * 3);
});

// ---------- samples (pack de Kenney, CC0) ----------

function sampleAudio() {
  const { FakeContext, log } = fakeAudio();
  log.buffers = [];
  class SampleContext extends FakeContext {
    createBufferSource() {
      const src = super.createBufferSource();
      src.start = () => { if (src.buffer && src.buffer.sample) log.buffers.push(src.buffer.sample); };
      return src;
    }
    decodeAudioData(data) { return Promise.resolve({ sample: data.name, duration: 0.3 }); }
  }
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(url);
    return { ok: true, arrayBuffer: async () => ({ name: url }) };
  };
  return { SampleContext, log, fetched, fetchImpl };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

test('carga los samples recien al desbloquear y los usa en vez de sintetizar', async () => {
  const { SampleContext, log, fetched, fetchImpl } = sampleAudio();
  const sound = createSound({ AudioContextCtor: SampleContext, storage: memoryStorage(), fetchImpl, baseUrl: 'sounds' });
  assert.equal(fetched.length, 0);
  sound.unlock();
  await flush();
  assert.ok(fetched.length > 0);
  assert.ok(fetched.every((u) => /^sounds\/[a-z0-9-]+\.mp3$/.test(u)));
  const osc = log.oscillators;
  sound.play('play');
  assert.equal(log.oscillators, osc, 'no sintetiza si hay sample');
  assert.match(log.buffers.at(-1), /^sounds\/play-\d\.mp3$/);
});

test('cada sonido del juego tiene su sample', async () => {
  const { SampleContext, log, fetchImpl } = sampleAudio();
  const sound = createSound({ AudioContextCtor: SampleContext, storage: memoryStorage(), fetchImpl, baseUrl: 'sounds' });
  sound.unlock();
  await flush();
  for (const name of sound.names) {
    const before = log.buffers.length;
    sound.play(name);
    assert.ok(log.buffers.length > before, name);
  }
});

test('el truco con samples suena una ficha por nivel, hasta tres', async () => {
  const { SampleContext, log, fetchImpl } = sampleAudio();
  const sound = createSound({ AudioContextCtor: SampleContext, storage: memoryStorage(), fetchImpl, baseUrl: 'sounds' });
  sound.unlock();
  await flush();
  const before = log.buffers.length;
  sound.play('knock', { level: 9 });
  assert.equal(log.buffers.length - before, 3);
});

test('si un sample no carga, ese sonido vuelve al sintetizado', async () => {
  const { SampleContext, log } = sampleAudio();
  const fetchImpl = async () => ({ ok: false, status: 404 });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const sound = createSound({ AudioContextCtor: SampleContext, storage: memoryStorage(), fetchImpl, baseUrl: 'sounds' });
    sound.unlock();
    await flush();
    await flush();
    const osc = log.oscillators;
    sound.play('play');
    assert.ok(log.oscillators > osc);
  } finally {
    console.warn = warn;
  }
});
