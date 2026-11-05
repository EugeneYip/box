// Worldseed audio — the mix graph, buildable on any BaseAudioContext so the
// live game and the offline measurement renders share exactly one signal path.
//
//   sfx ─┐                (each bus: dry in → level → sum, send in → sendLevel → reverb)
//   amb ─┼─→ sum → HP 22 Hz → glue compressor → limiter → safety soft-clip → volume → out
//   mus ─┘        ↑
//        reverb ──┘  (one procedural convolution hall shared by every bus)
import { gain, filt, reverbIR, softClipCurve } from './dsp.js';

export const BUS_NAMES = ['sfx', 'ambience', 'music'];

// Fixed internal trims (the user-facing bus volumes multiply these).
export const BUS_TRIM = { sfx: 1.0, ambience: 0.9, music: 0.8 };
const SEND_TRIM = { sfx: 1.0, ambience: 0.8, music: 1.0 };
// Chromium's convolver normalisation leaves the hall ~11 dB under the dry path
// for a unity send; this return brings a unity send to roughly dry level.
const REVERB_RETURN = 1.4;

export function buildMixer(c, { volume = 1, buses = {}, reverb = true } = {}) {
  const m = { c, buses: {} };
  m.out = gain(c, volume);
  m.out.connect(c.destination);

  m.clip = c.createWaveShaper();
  // safety clipper: transparent to -1.7 dBFS, output never above -1.0 dBFS
  m.clip.curve = softClipCurve(0.82, 0.891);
  m.clip.connect(m.out);

  // brick-ish limiter (WebAudio's compressor has a ~6 ms look-ahead)
  m.limiter = c.createDynamicsCompressor();
  m.limiter.threshold.value = -4.5;
  m.limiter.knee.value = 0;
  m.limiter.ratio.value = 20;
  m.limiter.attack.value = 0.001;
  m.limiter.release.value = 0.12;
  m.limiter.connect(m.clip);

  // gentle glue: only engages when many things pile up
  m.comp = c.createDynamicsCompressor();
  m.comp.threshold.value = -14;
  m.comp.knee.value = 12;
  m.comp.ratio.value = 2.2;
  m.comp.attack.value = 0.012;
  m.comp.release.value = 0.3;
  // the compressor adds automatic make-up gain; trim it back so a lone sound
  // passes at roughly unity
  m.trim = gain(c, 0.62);
  m.comp.connect(m.trim).connect(m.limiter);

  m.hp = filt(c, 'highpass', 22, 0.6);
  m.hp.connect(m.comp);
  m.sum = gain(c, 1);
  m.sum.connect(m.hp);

  m.reverb = c.createConvolver();
  m.reverb.buffer = reverbIR(c.sampleRate);
  m.reverbReturn = gain(c, reverb ? REVERB_RETURN : 0);
  // keep the wash out of the lows so it never muddies the mix
  m.reverbHP = filt(c, 'highpass', 180, 0.6);
  m.reverb.connect(m.reverbHP).connect(m.reverbReturn).connect(m.sum);

  for (const name of BUS_NAMES) {
    const b = {
      in: gain(c, 1),
      send: gain(c, 1),
      level: gain(c, BUS_TRIM[name] * (buses[name] ?? 1)),
      sendLevel: gain(c, SEND_TRIM[name] * BUS_TRIM[name] * (buses[name] ?? 1)),
      duck: gain(c, 1),
      duckSend: gain(c, 1),
    };
    b.in.connect(b.duck).connect(b.level).connect(m.sum);
    b.send.connect(b.duckSend).connect(b.sendLevel).connect(m.reverb);
    m.buses[name] = b;
  }
  return m;
}

// Smoothly set a bus's user volume (0..1) without zipper noise.
export function setBusLevel(m, name, v, tc = 0.08) {
  const b = m.buses[name];
  if (!b) return;
  const t = m.c.currentTime;
  b.level.gain.setTargetAtTime(BUS_TRIM[name] * v, t, tc);
  b.sendLevel.gain.setTargetAtTime(SEND_TRIM[name] * BUS_TRIM[name] * v, t, tc);
}

// Temporarily duck a bus (e.g. music under an explosion).
export function duckBus(m, name, depth, hold = 0.6, release = 1.4) {
  const b = m.buses[name];
  if (!b) return;
  const t = m.c.currentTime;
  for (const g of [b.duck.gain, b.duckSend.gain]) {
    g.cancelScheduledValues(t);
    g.setTargetAtTime(depth, t, 0.04);
    g.setTargetAtTime(1, t + hold, release / 3);
  }
}
