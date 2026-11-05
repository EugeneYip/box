// Worldseed audio — one-shot sound effect recipes.
//
// Each definition is baked into a few variants (different random seeds) by
// rendering its recipe into an OfflineAudioContext; the variants are then
// peak-normalised and played from a voice pool with pitch / gain jitter.
//
// Recipe signature: fn(c, out, t, r, v)
//   c   BaseAudioContext (offline while baking)
//   out destination node
//   t   start time in c
//   r   seeded random () => [0,1)
//   v   variant index (0..variants-1)
//
// Definition fields:
//   dur       seconds rendered per variant (tail included)
//   sr        optional bake sample rate (lower for band-limited rumbles)
//   variants  number of baked variants
//   stereo    bake in stereo (wide sounds) instead of mono
//   peak      dBFS the variant is normalised to before the mix
//   pri       voice priority (higher steals lower)
//   gap       minimum seconds between two starts of this sound
//   max       maximum simultaneous instances of this sound
//   pj        playback-rate jitter (± fraction)
//   vj        volume jitter (± dB)
//   wet       reverb send
//   range     how far it carries (multiplies the audible radius)
//   zoom      0..1, how much a far zoom attenuates it (local detail = 1)
//   ui        non-positional interface sound
import { rr, pick, env, gain, filt, panNode, link, noise, osc, tone, burst, shaper, loopSrc, crackleBuffer, mtof } from './dsp.js';

const PENTA = [0, 2, 4, 7, 9];

// Thin helper: a noise source through a filter chain into a gain whose
// envelope is given as env() points.
function nz(c, out, t, dur, kind, filters, pts, { ch = 1, r, rate = 1, pan = null } = {}) {
  let n = noise(c, kind, t, dur, { ch, r, rate });
  for (const f of filters) n = link(n, f);
  const g = gain(c, 0);
  env(g.gain, t, pts);
  n.connect(g);
  if (pan != null) link(g, panNode(c, pan), out);
  else g.connect(out);
  return g;
}

// Wood / metal modal strike: a set of decaying partials at ratios of f.
function modal(c, out, t, f, ratios, amps, taus, amp = 1, o = {}) {
  for (let i = 0; i < ratios.length; i++) tone(c, out, t, f * ratios[i], amp * amps[i], taus[i], o);
}

export const SFX = {
  // ------------------------------------------------------------------ UI
  'ui-hover': {
    dur: 0.12, variants: 4, peak: -5.8, pri: 1, gap: 0.045, max: 2, pj: 0.025, vj: 1.5, wet: 0.04, ui: true,
    fn(c, out, t, r) {
      const f = rr(r, 1750, 1950);
      const lp = filt(c, 'lowpass', 5200, 0.6);
      lp.connect(out);
      tone(c, lp, t, f, 0.6, 0.011, { attack: 0.0025, f1: f * 1.05, glide: 0.02 });
      tone(c, lp, t, f * 2.01, 0.12, 0.006, { attack: 0.002 });
      tone(c, lp, t, f * 0.5, 0.25, 0.014, { attack: 0.003 });
    },
  },
  'ui-click': {
    dur: 0.18, variants: 4, peak: -4.5, pri: 2, gap: 0.03, max: 3, pj: 0.03, vj: 1, wet: 0.05, ui: true,
    fn(c, out, t, r) {
      const f = rr(r, 1080, 1180);
      const lp = filt(c, 'lowpass', 7000, 0.5);
      lp.connect(out);
      // a little wooden "tock": pitch-dropping fundamental + bar-like overtone
      tone(c, lp, t, f * 1.18, 0.9, 0.022, { attack: 0.0008, f1: f, glide: 0.018 });
      tone(c, lp, t, f * 2.76, 0.22, 0.008, { attack: 0.0006 });
      tone(c, lp, t, f * 0.42, 0.42, 0.03, { attack: 0.002 });
      burst(c, lp, t, { amp: 0.18, tau: 0.0015, bp: 4200, q: 0.8, r });
    },
  },
  'ui-open': {
    dur: 0.9, variants: 3, peak: -5.0, pri: 2, gap: 0.08, max: 2, pj: 0.02, vj: 1, wet: 0.25, ui: true,
    fn(c, out, t, r) {
      // airy upward swish
      const bp = filt(c, 'bandpass', 700, 1.3);
      env(bp.frequency, t, [[0, 650], [0.2, 3400, 'e'], [0.45, 2600]]);
      nz(c, out, t, 0.5, 'pink', [bp], [[0, 0], [0.09, 0.14], [0.12, 0.14], [0.12, 0, 0.05]], { r });
      // two-note glassy chime, a fifth apart: short and light
      const base = mtof(pick(r, [88, 86, 84]));
      const lp = filt(c, 'lowpass', 9000, 0.5);
      lp.connect(out);
      for (const [dt, ratio, a] of [[0.035, 1, 0.42], [0.1, 1.5, 0.34]]) {
        tone(c, lp, t + dt, base * ratio, a, 0.055, { attack: 0.002 });
        tone(c, lp, t + dt, base * ratio * 2.0, a * 0.2, 0.025, { attack: 0.0015 });
        tone(c, lp, t + dt, base * ratio * 0.5, a * 0.1, 0.05, { attack: 0.004 });
      }
    },
  },
  error: {
    dur: 0.55, variants: 2, peak: -5.0, pri: 2, gap: 0.15, max: 1, pj: 0.01, vj: 0.5, wet: 0.1, ui: true,
    fn(c, out, t, r) {
      // soft two-step descending "bwom-bom": gentle, never a buzzer
      const lp = filt(c, 'lowpass', 1800, 0.6);
      lp.connect(out);
      const f = rr(r, 370, 385);
      for (const [dt, ratio, a] of [[0, 1, 0.8], [0.12, 0.84, 0.75]]) {
        const o1 = osc(c, 'triangle', f * ratio * 1.02, t + dt, 0.4);
        o1.frequency.exponentialRampToValueAtTime(f * ratio, t + dt + 0.03);
        const o2 = osc(c, 'sine', f * ratio * 0.5, t + dt, 0.4);
        const g = gain(c, 0);
        env(g.gain, t + dt, [[0, 0], [0.005, a], [0.005, 0, 0.045]]);
        o1.connect(g);
        const g2 = gain(c, 0.5);
        o2.connect(g2).connect(g);
        g.connect(lp);
      }
    },
  },

  // ------------------------------------------------------------- terrain
  raise: {
    dur: 1.6, sr: 22050, variants: 3, stereo: true, peak: -2.0, pri: 3, gap: 0.1, max: 2, pj: 0.05, vj: 1, wet: 0.12, zoom: 0.7,
    fn(c, out, t, r) {
      // a punchy earthen crunch up front, then a quieter rising rumble, so it
      // reads as weighty without dominating the mix while sculpting
      tone(c, out, t, 150, 0.8, 0.05, { attack: 0.003, f1: 70, glide: 0.07 });
      nz(c, out, t, 0.6, 'pink', [filt(c, 'bandpass', 700, 0.6)], [[0, 0], [0.003, 0.9], [0.003, 0, 0.04]], { ch: 2, r });
      // sub swell rising in pitch: the land pushing upward (felt on good speakers)
      const sub = osc(c, 'sine', 40, t, 1.6);
      env(sub.frequency, t, [[0, rr(r, 38, 44)], [1.1, rr(r, 60, 68), 'e']]);
      const sg = gain(c, 0);
      env(sg.gain, t, [[0, 0], [0.14, 0.26], [0.5, 0.2], [0.55, 0, 0.2]]);
      link(sub, shaper(c, 2.2), sg, out);
      // grinding earth in the mids, rising: this is what carries on small speakers
      const bp = filt(c, 'bandpass', 260, 1.1);
      env(bp.frequency, t, [[0, 220], [1.0, rr(r, 520, 640), 'e']]);
      const grind = gain(c, 0.55);
      const am = osc(c, 'sine', rr(r, 11, 16), t, 1.6);
      link(am, gain(c, 0.35), grind.gain);
      nz(c, grind, t, 1.6, 'pink', [bp, shaper(c, 2)], [[0, 0], [0.12, 1.1], [0.5, 0.85], [0.55, 0, 0.22]], { ch: 2, r });
      grind.connect(out);
      // gravel and stones tumbling off the rising ground
      const cb = loopSrc(c, crackleBuffer(c.sampleRate, { seed: 21, rate: 70, ch: 2, dec: [0.3, 1.4] }), t, 1.6, r);
      const cbp = filt(c, 'bandpass', 1500, 0.6);
      const cg = gain(c, 0);
      env(cg.gain, t, [[0, 0], [0.1, 0.5], [0.7, 0.32], [0.75, 0, 0.18]]);
      link(cb, cbp, cg, out);
    },
  },
  lower: {
    dur: 1.5, sr: 22050, variants: 3, stereo: true, peak: -2.0, pri: 3, gap: 0.1, max: 2, pj: 0.05, vj: 1, wet: 0.12, zoom: 0.7,
    fn(c, out, t, r) {
      // sinking: a hollow drop up front, then the sub falls, the filter closes
      // and sand trickles in
      tone(c, out, t, 170, 0.75, 0.06, { attack: 0.003, f1: 75, glide: 0.09 });
      nz(c, out, t, 0.6, 'pink', [filt(c, 'bandpass', 500, 0.6)], [[0, 0], [0.004, 0.8], [0.004, 0, 0.05]], { ch: 2, r });
      const sub = osc(c, 'sine', 60, t, 1.5);
      env(sub.frequency, t, [[0, rr(r, 62, 70)], [1.0, rr(r, 34, 38), 'e']]);
      const sg = gain(c, 0);
      env(sg.gain, t, [[0, 0], [0.1, 0.26], [0.42, 0.18], [0.47, 0, 0.2]]);
      link(sub, shaper(c, 2.2), sg, out);
      // the ground subsiding: a mid grind sinking in pitch
      const bp = filt(c, 'bandpass', 560, 1.1);
      env(bp.frequency, t, [[0, rr(r, 560, 660)], [1.0, 190, 'e']]);
      const grind = gain(c, 0.55);
      const am = osc(c, 'sine', rr(r, 9, 13), t, 1.5);
      link(am, gain(c, 0.3), grind.gain);
      nz(c, grind, t, 1.5, 'pink', [bp, shaper(c, 2)], [[0, 0], [0.08, 1.05], [0.42, 0.7], [0.47, 0, 0.22]], { ch: 2, r });
      grind.connect(out);
      // trickling sand / settling grains
      const cb = loopSrc(c, crackleBuffer(c.sampleRate, { seed: 33, rate: 140, ch: 2, dec: [0.08, 0.5], pops: 0 }), t, 1.5, r);
      const hp = filt(c, 'bandpass', 3200, 0.6);
      const cg = gain(c, 0);
      env(cg.gain, t, [[0, 0], [0.2, 0.34], [0.8, 0.2], [0.9, 0, 0.15]]);
      link(cb, hp, cg, out);
    },
  },
  paint: {
    dur: 0.6, variants: 4, stereo: true, peak: -5.8, pri: 2, gap: 0.08, max: 2, pj: 0.06, vj: 1, wet: 0.08, zoom: 0.5,
    fn(c, out, t, r) {
      // a soft brush stroke: band-passed noise sweeping, bristle flutter, slight L→R motion
      const len = rr(r, 0.34, 0.42);
      const bp = filt(c, 'bandpass', 1400, 1.1);
      env(bp.frequency, t, [[0, rr(r, 900, 1200)], [len * 0.45, rr(r, 2600, 3300), 'e'], [len, rr(r, 1500, 1900), 'e']]);
      const lp = filt(c, 'lowpass', 6500, 0.5);
      const flutter = gain(c, 0.75);
      const lfo = osc(c, 'sine', rr(r, 38, 62), t, 0.6);
      const lg = gain(c, 0.25);
      link(lfo, lg, flutter.gain);
      const p = panNode(c, 0);
      const dir = r() < 0.5 ? -1 : 1;
      env(p.pan, t, [[0, -0.35 * dir], [len, 0.35 * dir]]);
      const g = nz(c, flutter, t, 0.6, 'pink', [bp, lp], [[0, 0], [len * 0.3, 0.9], [len * 0.65, 0.7], [len, 0]], { r });
      link(flutter, p, out);
      // a whisper of body under the stroke
      const body = filt(c, 'lowpass', 600, 0.7);
      nz(c, p, t, 0.6, 'pink', [body], [[0, 0], [len * 0.35, 0.35], [len, 0]], { r });
      void g;
    },
  },
  plant: {
    dur: 0.5, variants: 4, peak: -4.3, pri: 2, gap: 0.05, max: 3, pj: 0.06, vj: 1, wet: 0.1, zoom: 0.5,
    fn(c, out, t, r) {
      // bright organic pop: a rising "bloop", a sparkle and a leafy rustle
      const f = rr(r, 380, 460);
      tone(c, out, t, f, 0.85, 0.045, { attack: 0.003, f1: f * rr(r, 2.3, 2.7), glide: 0.045 });
      tone(c, out, t, f * 0.5, 0.3, 0.03, { attack: 0.002 });
      const sp = mtof(pick(r, [91, 93, 96]));
      tone(c, out, t + 0.03, sp, 0.18, 0.08, { attack: 0.002 });
      tone(c, out, t + 0.03, sp * 1.5, 0.1, 0.06, { attack: 0.002 });
      burst(c, out, t + 0.005, { amp: 0.22, tau: 0.045, bp: 4800, q: 1.2, r });
      burst(c, out, t, { amp: 0.25, tau: 0.012, lp: 900, kind: 'pink', r });
    },
  },
  splash: {
    dur: 1.5, variants: 3, stereo: true, peak: -3.8, pri: 3, gap: 0.08, max: 3, pj: 0.06, vj: 1, wet: 0.15, zoom: 0.6,
    fn(c, out, t, r) {
      // impact
      nz(c, out, t, 0.6, 'white', [filt(c, 'highpass', 350), filt(c, 'lowpass', 4200)], [[0, 0], [0.004, 0.85], [0.004, 0, 0.07]], { ch: 2, r });
      // watery body whoosh
      const bp = filt(c, 'bandpass', 900, 0.6);
      env(bp.frequency, t, [[0, 1400], [0.6, 500, 'e']]);
      nz(c, out, t, 1.4, 'pink', [bp], [[0, 0], [0.02, 0.7], [0.03, 0, 0.22]], { ch: 2, r });
      // bubbles and droplets: resonant rising "plinks"
      const n = 11 + Math.floor(r() * 6);
      for (let i = 0; i < n; i++) {
        const dt = 0.03 + Math.pow(r(), 1.7) * 0.95;
        const f0 = rr(r, 600, 2000);
        const a = (0.35 + r() * 0.35) * (1 - dt * 0.6);
        tone(c, out, t + dt, f0, a, rr(r, 0.012, 0.03), { attack: 0.001, f1: f0 * rr(r, 1.4, 2.0), glide: rr(r, 0.02, 0.05), pan: rr(r, -0.7, 0.7) });
      }
      // fine spray settling back
      nz(c, out, t, 1.5, 'white', [filt(c, 'highpass', 3000), filt(c, 'lowpass', 9000)], [[0, 0], [0.06, 0.18], [0.1, 0, 0.3]], { ch: 2, r });
    },
  },

  // ----------------------------------------------------------- disasters
  explosion: {
    dur: 3.6, sr: 22050, variants: 3, stereo: true, peak: 2.6, pri: 6, gap: 0.06, max: 4, pj: 0.06, vj: 0.8, wet: 0.22, range: 2.2, zoom: 0.25,
    fn(c, out, t, r) {
      // 1. thump — pitch-dropping sine, saturated for punch
      const th = osc(c, 'sine', 110, t, 1.2);
      env(th.frequency, t, [[0, rr(r, 100, 125)], [0.38, rr(r, 34, 40), 'e']]);
      const tg = gain(c, 0);
      env(tg.gain, t, [[0, 0], [0.004, 1], [0.05, 0.9], [0.06, 0, 0.17]]);
      link(th, shaper(c, 2.6), filt(c, 'lowpass', 900, 0.7), tg, out);
      // 2. blast crack — bright noise with a closing filter
      const lp = filt(c, 'lowpass', 7000, 0.7);
      env(lp.frequency, t, [[0, 8000], [0.25, 1100, 'e']]);
      nz(c, out, t, 1.4, 'white', [lp], [[0, 0], [0.002, 1], [0.002, 0.45, 0.04], [0.06, 0, 0.18]], { ch: 2, r });
      // 3. body rumble
      const rl = filt(c, 'lowpass', 400, 0.8);
      env(rl.frequency, t, [[0, 520], [2.8, 85, 'e']]);
      nz(c, out, t, 3.6, 'brown', [rl, shaper(c, 1.5)], [[0, 0], [0.03, 0.95], [0.12, 0, 0.75]], { ch: 2, r });
      // 4. debris crackle and falling stones
      const cb = loopSrc(c, crackleBuffer(c.sampleRate, { seed: 7, rate: 70, ch: 2, dec: [0.25, 2.5], pops: 0.25 }), t, 3.6, r);
      const cbp = filt(c, 'bandpass', 1800, 0.55);
      const cg = gain(c, 0);
      env(cg.gain, t, [[0, 0], [0.12, 0.5], [0.3, 0.42], [0.4, 0, 0.7]]);
      link(cb, cbp, cg, out);
      for (let i = 0; i < 7; i++) {
        const dt = 0.35 + Math.pow(r(), 1.4) * 1.9;
        tone(c, out, t + dt, rr(r, 260, 700), rr(r, 0.06, 0.16) * (1.4 - dt * 0.4), rr(r, 0.012, 0.03), { attack: 0.001, pan: rr(r, -0.8, 0.8) });
      }
    },
  },
  thunder: {
    dur: 7.5, sr: 22050, variants: 3, stereo: true, peak: 2.4, pri: 6, gap: 0.3, max: 3, pj: 0.08, vj: 1.5, wet: 0.3, range: 6, zoom: 0.1,
    fn(c, out, t, r, v) {
      const near = v !== 2; // variant 2 is a distant roll
      const d0 = near ? 0 : rr(r, 0.2, 0.4);
      // the crack: a quick tearing cluster of bright bursts
      if (near) {
        const n = 5 + Math.floor(r() * 5);
        for (let i = 0; i < n; i++) {
          const dt = Math.pow(r(), 1.6) * 0.17;
          burst(c, out, t + dt, { amp: rr(r, 0.4, 1) * (1 - dt * 2), tau: rr(r, 0.006, 0.02), hp: 1200, lp: 9500, ch: 2, r, pan: rr(r, -0.5, 0.5) });
        }
        const bp = filt(c, 'bandpass', 2200, 0.7);
        env(bp.frequency, t, [[0, 2600], [0.5, 700, 'e']]);
        nz(c, out, t, 1.5, 'white', [bp], [[0, 0], [0.004, 0.75], [0.03, 0, 0.22]], { ch: 2, r });
      }
      // the long rolling rumble: a series of swells, decreasing
      const lp = filt(c, 'lowpass', 200, 0.7);
      env(lp.frequency, t, [[0, near ? 420 : 260], [6.5, 90, 'e']]);
      const roll = gain(c, 0);
      const pts = [[0, 0]];
      let at = d0 + (near ? 0.05 : 0.1);
      pts.push([at + 0.12, near ? 0.9 : 0.55]);
      const rolls = 4 + Math.floor(r() * 3);
      let level = near ? 0.85 : 0.6;
      for (let i = 0; i < rolls; i++) {
        at += rr(r, 0.45, 1.2);
        pts.push([at, level * rr(r, 0.35, 0.55), rr(r, 0.12, 0.3)]);
        at += rr(r, 0.25, 0.5);
        level *= rr(r, 0.72, 0.9);
        pts.push([at, level, rr(r, 0.08, 0.22)]);
      }
      pts.push([at + 0.3, 0, rr(r, 0.7, 1.1)]);
      env(roll.gain, t, pts);
      const src = noise(c, 'brown', t, 7.5, { ch: 2, r });
      link(src, lp, shaper(c, 1.4), roll, out);
      // mid growl riding on the same swells
      const mid = noise(c, 'pink', t, 7.5, { ch: 2, r });
      const mlp = filt(c, 'lowpass', 700, 0.6);
      env(mlp.frequency, t, [[0, 900], [5, 300, 'e']]);
      const mg = gain(c, near ? 0.28 : 0.16);
      link(mid, mlp, mg, roll);
    },
  },
  'fire-start': {
    dur: 1.6, sr: 22050, variants: 3, stereo: true, peak: -0.6, pri: 4, gap: 0.12, max: 3, pj: 0.06, vj: 1, wet: 0.12, zoom: 0.6,
    fn(c, out, t, r) {
      // "fwoomph": accelerating whoosh with an opening filter
      const lp = filt(c, 'lowpass', 300, 1.1);
      env(lp.frequency, t, [[0, 220], [0.28, rr(r, 2600, 3200), 'e'], [1.2, 900, 'e']]);
      nz(c, out, t, 1.6, 'pink', [lp], [[0, 0], [0.12, 0.25], [0.26, 0.95], [0.3, 0, 0.32]], { ch: 2, r });
      tone(c, out, t + 0.16, 75, 0.55, 0.09, { attack: 0.03, f1: 44, glide: 0.18 });
      // crackles catching
      const cb = loopSrc(c, crackleBuffer(c.sampleRate, { seed: 51, rate: 60, ch: 2, dec: [0.2, 1.6], pops: 0.4 }), t, 1.6, r);
      const cbp = filt(c, 'bandpass', 2400, 0.6);
      const cg = gain(c, 0);
      env(cg.gain, t, [[0, 0], [0.18, 0], [0.4, 0.45], [0.9, 0.3], [1.0, 0, 0.18]]);
      link(cb, cbp, cg, out);
    },
  },
  meteor: {
    dur: 2.6, sr: 22050, variants: 3, stereo: true, peak: 0.4, pri: 5, gap: 0.15, max: 3, pj: 0.05, vj: 1, wet: 0.2, range: 3, zoom: 0.25,
    fn(c, out, t, r) {
      const T = rr(r, 1.9, 2.2);
      // descending roar: bandpass sweeping down while it grows
      const bp = filt(c, 'bandpass', 3000, 1.4);
      env(bp.frequency, t, [[0, rr(r, 3800, 4600)], [T, rr(r, 240, 300), 'e']]);
      const p = panNode(c, 0);
      const dir = r() < 0.5 ? -1 : 1;
      env(p.pan, t, [[0, 0.55 * dir], [T, -0.1 * dir]]);
      nz(c, p, t, 2.6, 'pink', [bp], [[0, 0], [T * 0.55, 0.35], [T * 0.95, 1], [T + 0.22, 0]], { ch: 2, r });
      // faint descending whine
      const w = osc(c, 'triangle', 1500, t, 2.6);
      env(w.frequency, t, [[0, rr(r, 1300, 1600)], [T, rr(r, 140, 170), 'e']]);
      const wg = gain(c, 0);
      env(wg.gain, t, [[0, 0], [T * 0.6, 0.05], [T * 0.95, 0.12], [T + 0.18, 0]]);
      link(w, filt(c, 'lowpass', 2400, 0.6), wg, p);
      // low roar building to the end
      nz(c, p, t, 2.6, 'brown', [filt(c, 'lowpass', 220, 0.8)], [[0, 0], [T * 0.7, 0.3], [T, 0.9], [T + 0.25, 0]], { ch: 2, r });
      // burning sizzle
      const cb = loopSrc(c, crackleBuffer(c.sampleRate, { seed: 9, rate: 90, ch: 2, dec: [0.1, 0.8], pops: 0.1 }), t, 2.6, r);
      const cg = gain(c, 0);
      env(cg.gain, t, [[0, 0], [T * 0.8, 0.22], [T + 0.2, 0]]);
      link(cb, filt(c, 'highpass', 2500), cg, p);
      p.connect(out);
    },
  },
  quake: {
    dur: 4.2, sr: 22050, variants: 2, stereo: true, peak: 1.2, pri: 5, gap: 0.5, max: 2, pj: 0.04, vj: 0.8, wet: 0.12, range: 4, zoom: 0.2,
    fn(c, out, t, r) {
      const L = rr(r, 3.0, 3.4);
      // irregular tremor amplitude
      const trem = gain(c, 0);
      const pts = [[0, 0]];
      for (let x = 0.03; x < L; x += rr(r, 0.04, 0.1)) pts.push([x, rr(r, 0.45, 1), 0.025]);
      pts.push([L, 0, 0.12]);
      env(trem.gain, t, pts);
      const shape = gain(c, 0);
      env(shape.gain, t, [[0, 0], [0.4, 1], [L - 0.9, 0.85], [L + 0.6, 0]]);
      link(trem, shape, out);
      nz(c, trem, t, 4.2, 'brown', [filt(c, 'lowpass', 120, 1), shaper(c, 2)], [[0, 1]], { ch: 2, r });
      const sub = osc(c, 'sine', 34, t, 4.2);
      const sj = [[0, 34]];
      for (let x = 0.1; x < L; x += 0.15) sj.push([x, rr(r, 28, 40), 0.06]);
      env(sub.frequency, t, sj);
      link(sub, shaper(c, 2.2), gain(c, 0.45), trem);
      // rock grinding against rock: mid-band body that survives small speakers
      nz(c, trem, t, 4.2, 'pink', [filt(c, 'bandpass', 380, 1.0), shaper(c, 2.4)], [[0, 0.8]], { ch: 2, r });
      nz(c, trem, t, 4.2, 'pink', [filt(c, 'bandpass', 900, 1.4)], [[0, 0.25]], { ch: 2, r });
      // rattles and stone cracks
      const cb = loopSrc(c, crackleBuffer(c.sampleRate, { seed: 77, rate: 45, ch: 2, dec: [0.3, 2.0], pops: 0.2 }), t, 4.2, r);
      const cg = gain(c, 0.45);
      link(cb, filt(c, 'bandpass', 2400, 0.6), cg, shape);
      for (let i = 0; i < 4; i++) {
        burst(c, out, t + rr(r, 0.3, L - 0.5), { amp: rr(r, 0.25, 0.45), tau: rr(r, 0.015, 0.04), bp: rr(r, 900, 1800), q: 1.2, ch: 2, r, pan: rr(r, -0.7, 0.7) });
      }
    },
  },

  // ------------------------------------------------------------- civ work
  build: {
    dur: 0.85, variants: 4, peak: -4.6, pri: 2, gap: 0.09, max: 3, pj: 0.05, vj: 1.5, wet: 0.1, zoom: 0.9,
    fn(c, out, t, r, v) {
      // two or three hammer blows on timber, the odd one ringing a nail
      const n = 2 + (v % 2);
      let at = 0;
      const f = rr(r, 330, 420);
      for (let i = 0; i < n; i++) {
        const a = i === n - 1 ? 1 : rr(r, 0.65, 0.85);
        burst(c, out, t + at, { amp: 0.5 * a, tau: 0.004, bp: 2400, q: 0.9, r });
        modal(c, out, t + at, f * rr(r, 0.97, 1.03), [1, 2.42, 4.1], [1, 0.45, 0.2], [0.045, 0.022, 0.011], a * 0.75);
        tone(c, out, t + at, 140, 0.4 * a, 0.03, { attack: 0.001 });
        if (i % 2 === 1) tone(c, out, t + at, rr(r, 2900, 3300), 0.08 * a, 0.05);
        at += rr(r, 0.17, 0.24);
      }
    },
  },
  chop: {
    dur: 0.45, variants: 4, peak: -4.1, pri: 2, gap: 0.07, max: 3, pj: 0.06, vj: 1.5, wet: 0.08, zoom: 0.9,
    fn(c, out, t, r) {
      // the axe bites: sharp transient, wooden "thock" body, low thunk
      burst(c, out, t, { amp: 0.7, tau: 0.005, hp: 1600, r });
      burst(c, out, t, { amp: 0.6, tau: 0.022, bp: rr(r, 950, 1250), q: 2, r });
      const f = rr(r, 185, 235);
      modal(c, out, t, f, [1, 2.31, 3.93], [1, 0.5, 0.25], [0.07, 0.04, 0.018], 0.8, { f1: 0, attack: 0.001 });
      tone(c, out, t, 95, 0.55, 0.045, { attack: 0.001, f1: 70, glide: 0.04 });
    },
  },
  mine: {
    dur: 0.6, variants: 4, peak: -4.6, pri: 2, gap: 0.07, max: 3, pj: 0.05, vj: 1.5, wet: 0.1, zoom: 0.9,
    fn(c, out, t, r) {
      // pick on stone: inharmonic metallic tink, gritty crunch, pebbles
      const f = rr(r, 2100, 2700);
      modal(c, out, t, f, [1, 1.47, 2.09, 2.81], [0.5, 0.35, 0.25, 0.14], [0.12, 0.08, 0.06, 0.04], 0.8);
      burst(c, out, t, { amp: 0.8, tau: 0.03, bp: 1700, q: 0.8, r });
      tone(c, out, t, 165, 0.45, 0.03, { attack: 0.001 });
      const n = 2 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) burst(c, out, t + rr(r, 0.05, 0.25), { amp: rr(r, 0.12, 0.3), tau: 0.004, bp: rr(r, 2800, 5200), q: 2, r });
    },
  },
  hit: {
    dur: 0.35, variants: 4, peak: -4.6, pri: 3, gap: 0.05, max: 4, pj: 0.07, vj: 1.5, wet: 0.06, zoom: 0.9,
    fn(c, out, t, r, v) {
      tone(c, out, t, rr(r, 160, 190), 0.9, 0.04, { attack: 0.001, f1: 68, glide: 0.05 });
      burst(c, out, t, { amp: 0.7, tau: 0.02, bp: rr(r, 1000, 1400), q: 1, r });
      burst(c, out, t, { amp: 0.3, tau: 0.004, hp: 3000, r });
      if (v >= 2) modal(c, out, t + 0.002, rr(r, 1800, 2100), [1, 1.43, 2.24], [0.4, 0.3, 0.2], [0.06, 0.045, 0.03], 0.55);
    },
  },

  // ----------------------------------------------------------------- life
  death: {
    dur: 0.9, variants: 3, peak: -5.5, pri: 2, gap: 0.08, max: 3, pj: 0.05, vj: 1.5, wet: 0.15, zoom: 0.9,
    fn(c, out, t, r) {
      // gentle: a soft puff, a falling sigh, the body settling
      nz(c, out, t, 0.6, 'pink', [filt(c, 'bandpass', 700, 0.8)], [[0, 0], [0.006, 0.6], [0.006, 0, 0.05]], { r });
      const f = rr(r, 480, 560);
      const o = osc(c, 'triangle', f, t, 0.9);
      env(o.frequency, t, [[0, f], [0.5, f * 0.55, 'e']]);
      const g = gain(c, 0);
      env(g.gain, t, [[0, 0], [0.04, 0.2], [0.2, 0.13], [0.55, 0]]);
      link(o, filt(c, 'lowpass', 1400, 0.6), g, out);
      tone(c, out, t + 0.09, 120, 0.55, 0.05, { attack: 0.002, f1: 60, glide: 0.05 });
    },
  },
  birth: {
    dur: 1.1, variants: 3, peak: -4.4, pri: 2, gap: 0.12, max: 2, pj: 0.02, vj: 1, wet: 0.3, zoom: 0.9,
    fn(c, out, t, r) {
      // three soft rising pentatonic notes with a breath of air
      const root = 79 + pick(r, [0, 2, 5]);
      const seq = [0, 2, 4].map((i) => root + PENTA[i]);
      seq.forEach((m, i) => {
        const at = t + i * 0.075;
        // a bright pling on the strike, a softer ring behind it
        tone(c, out, at, mtof(m), 0.26, 0.07, { attack: 0.003 });
        tone(c, out, at, mtof(m) * 3, 0.16, 0.018, { attack: 0.001 });
        tone(c, out, at, mtof(m) * 2, 0.06, 0.06, { attack: 0.002 });
      });
      nz(c, out, t, 0.9, 'white', [filt(c, 'highpass', 5000), filt(c, 'lowpass', 11000)], [[0, 0], [0.15, 0.05], [0.5, 0]], { r });
    },
  },
  spawn: {
    dur: 1.6, variants: 3, stereo: true, peak: -3.8, pri: 3, gap: 0.08, max: 3, pj: 0.03, vj: 1, wet: 0.35, zoom: 0.7,
    fn(c, out, t, r) {
      // magical shimmer: rising airy sweep + a cascade of twinkling partials
      const bp = filt(c, 'bandpass', 1500, 3);
      env(bp.frequency, t, [[0, 1400], [0.45, 7000, 'e']]);
      nz(c, out, t, 1.2, 'white', [bp], [[0, 0], [0.25, 0.16], [0.3, 0, 0.14]], { ch: 2, r });
      // two octaves of pentatonic twinkles (kept below ~4 kHz: sparkly, not piercing)
      const root = 79 + pick(r, [0, 2, 5, 7]);
      const n = 10;
      for (let i = 0; i < n; i++) {
        const m = root + PENTA[i % 5] + 12 * Math.floor(i / 5);
        const at = t + 0.02 + i * rr(r, 0.026, 0.036);
        tone(c, out, at, mtof(m), 0.3 * (1 - i / (n + 4)), 0.1, { attack: 0.003, pan: rr(r, -0.8, 0.8) });
      }
      // a warm low glow underneath
      tone(c, out, t, mtof(root - 24), 0.08, 0.26, { attack: 0.08 });
    },
  },
  magic: {
    dur: 1.7, variants: 3, stereo: true, peak: -2.6, pri: 3, gap: 0.08, max: 3, pj: 0.03, vj: 1, wet: 0.35, zoom: 0.6,
    fn(c, out, t, r) {
      // swirling resonant whoosh
      const bp = filt(c, 'bandpass', 1800, 4);
      env(bp.frequency, t, [[0, 900], [0.35, 2600, 'e'], [1.2, 1600, 'e']]);
      const lfo = osc(c, 'sine', rr(r, 4.5, 6.5), t, 1.7);
      const lg = gain(c, 500);
      link(lfo, lg, bp.frequency);
      nz(c, out, t, 1.7, 'pink', [bp], [[0, 0], [0.22, 0.5], [0.3, 0, 0.3]], { ch: 2, r });
      // an open, bright chord bloom (root, fifth, ninth)
      const root = 72 + pick(r, [0, 2, 5]);
      [0, 7, 14, 19].forEach((iv, i) => {
        const f = mtof(root + iv);
        tone(c, out, t + 0.04 + i * 0.03, f, 0.13, 0.24, { attack: 0.03, pan: (i - 1.5) * 0.4 });
        tone(c, out, t + 0.04 + i * 0.03, f * 1.004, 0.08, 0.24, { attack: 0.03, pan: -(i - 1.5) * 0.4 });
      });
      tone(c, out, t, 150, 0.4, 0.18, { attack: 0.015, f1: 105, glide: 0.3 });
      for (let i = 0; i < 6; i++) tone(c, out, t + rr(r, 0.1, 0.7), rr(r, 3500, 6500), 0.06, 0.03, { pan: rr(r, -0.9, 0.9) });
    },
  },

  // ------------------------------------------------------------ civ events
  'war-horn': {
    dur: 3.4, sr: 22050, variants: 2, stereo: true, peak: -0.6, pri: 5, gap: 1.0, max: 1, pj: 0.02, vj: 0.5, wet: 0.45, range: 4, zoom: 0.2,
    fn(c, out, t, r) {
      const f0 = rr(r, 98, 108);
      const sum = gain(c, 1);
      const notes = [[0, 1.45, 1], [1.5, 1.4, 1.5]];
      for (const [d] of [[-7], [7], [0]]) {
        const o = osc(c, 'sawtooth', f0, t, 3.4);
        o.detune.value = d;
        // each note scoops up into pitch and sags a touch as the breath ends
        const fp = [];
        for (const [st, len, ratio] of notes) {
          fp.push([st, f0 * ratio * 0.93, 's'], [st + 0.001, f0 * ratio, 0.06], [st + len - 0.15, f0 * ratio * 0.985, 0.2]);
        }
        env(o.frequency, t, fp);
        // slow vibrato
        const v = osc(c, 'sine', 4.6, t, 3.4);
        const vg = gain(c, 0);
        env(vg.gain, t, [[0, 0], [0.5, 0], [1.2, f0 * 0.006], [1.5, 0], [2.1, f0 * 0.009]]);
        link(v, vg, o.frequency);
        const p = panNode(c, d / 14);
        link(o, gain(c, 0.33), p, sum);
      }
      const lp = filt(c, 'lowpass', 300, 1.6);
      const fpts = [[0, 200]];
      for (const [st, len] of notes) fpts.push([st, 260, 's'], [st + 0.01, 1500, 0.14], [st + len - 0.3, 850, 0.3]);
      env(lp.frequency, t, fpts);
      const g = gain(c, 0);
      const gp = [[0, 0]];
      for (const [st, len] of notes) gp.push([st + 0.01, 0.02], [st + 0.28, 0.9], [st + len - 0.25, 0.75], [st + len, 0.02]);
      gp.push([3.3, 0]);
      env(g.gain, t, gp);
      link(sum, shaper(c, 1.4), lp, filt(c, 'peaking', 520, 1.2, 5), g, out);
      // breath through the horn
      const breath = filt(c, 'bandpass', 900, 1.2);
      link(noise(c, 'pink', t, 3.4, { ch: 2, r }), breath, gain(c, 0.12), g);
    },
  },
  bell: {
    dur: 5.0, sr: 22050, variants: 2, peak: -2.5, pri: 4, gap: 0.6, max: 2, pj: 0.015, vj: 0.5, wet: 0.4, range: 3, zoom: 0.4,
    fn(c, out, t, r) {
      // bronze bell: hum, prime, minor-third tierce, quint, nominal and upper partials
      const hum = rr(r, 150, 172);
      const parts = [
        [1, 0.45, 1.9],
        [2, 0.65, 1.3],
        [2.4, 0.5, 1.05],
        [3, 0.22, 0.75],
        [4, 0.85, 0.85],
        [5.04, 0.26, 0.5],
        [5.34, 0.2, 0.42],
        [6.02, 0.16, 0.34],
        [8.1, 0.08, 0.22],
      ];
      for (const [ratio, a, tau] of parts) {
        tone(c, out, t, hum * ratio, a * 0.42, tau, { attack: 0.0015 });
        // a slightly detuned twin gives the slow warble of a real bell
        tone(c, out, t, hum * ratio * 1.0025, a * 0.18, tau, { attack: 0.0015 });
      }
      burst(c, out, t, { amp: 0.25, tau: 0.006, bp: 2600, q: 1, r });
    },
  },
  coin: {
    dur: 0.65, variants: 4, peak: -3.4, pri: 3, gap: 0.05, max: 3, pj: 0.03, vj: 1, wet: 0.15, zoom: 0.8,
    fn(c, out, t, r) {
      // a metallic clink, a smaller settling clink, and a soft rising chime
      const f = rr(r, 3200, 3650);
      const R = [1, 1.38, 1.77, 2.41];
      modal(c, out, t, f, R, [0.5, 0.32, 0.22, 0.12], [0.08, 0.05, 0.04, 0.025], 0.7);
      const d = rr(r, 0.065, 0.09);
      modal(c, out, t + d, f * 1.07, R, [0.5, 0.32, 0.22, 0.12], [0.055, 0.035, 0.028, 0.018], 0.42);
      const m = 88 + pick(r, [0, 2]);
      tone(c, out, t + 0.01, mtof(m), 0.12, 0.08, { attack: 0.002 });
      tone(c, out, t + 0.07, mtof(m + 7), 0.1, 0.1, { attack: 0.002 });
    },
  },
  growl: {
    dur: 1.2, variants: 3, peak: -3.8, pri: 3, gap: 0.3, max: 2, pj: 0.06, vj: 1, wet: 0.12, zoom: 0.9,
    fn(c, out, t, r) {
      const L = rr(r, 0.75, 0.95);
      const f0 = rr(r, 72, 92);
      const o = osc(c, 'sawtooth', f0, t, 1.2);
      const fp = [[0, f0 * 0.9]];
      for (let x = 0.03; x < L; x += 0.035) fp.push([x, f0 * rr(r, 0.9, 1.12), 0.012]);
      env(o.frequency, t, fp);
      // roughness: fast irregular amplitude modulation
      const rough = gain(c, 0.55);
      const am = osc(c, 'sine', rr(r, 24, 32), t, 1.2);
      link(am, gain(c, 0.45), rough.gain);
      const g = gain(c, 0);
      env(g.gain, t, [[0, 0], [0.12, 0.8], [L * 0.6, 1], [L, 0]]);
      o.connect(rough);
      const sat = shaper(c, 2.2);
      rough.connect(sat);
      for (const [f, q, a] of [[480, 3, 1], [1050, 4, 0.55], [2400, 5, 0.22]]) link(sat, filt(c, 'bandpass', f * rr(r, 0.92, 1.08), q), gain(c, a), g);
      nz(c, g, t, 1.2, 'pink', [filt(c, 'bandpass', 950, 1)], [[0, 0.25]], { r });
      g.connect(out);
    },
  },
  bleat: {
    dur: 1.0, variants: 4, peak: -4.6, pri: 3, gap: 0.25, max: 2, pj: 0.08, vj: 1, wet: 0.12, zoom: 0.9,
    fn(c, out, t, r) {
      // "meh-eh-eh": a nasal voiced tone with the bleating tremolo
      const L = rr(r, 0.34, 0.48);
      const f0 = rr(r, 330, 420);
      const o = osc(c, 'sawtooth', f0, t, 1.0);
      env(o.frequency, t, [[0, f0 * 0.94], [0.08, f0 * 1.03], [L * 0.7, f0], [L, f0 * 0.86]]);
      const rate = rr(r, 6.5, 8.5);
      const vib = osc(c, 'sine', rate, t, 1.0);
      link(vib, gain(c, f0 * 0.035), o.frequency);
      const trem = gain(c, 0.6);
      link(vib, gain(c, 0.4), trem.gain);
      const g = gain(c, 0);
      // accented onset, then the bleat tails away
      env(g.gain, t, [[0, 0], [0.025, 1], [0.08, 0.45], [L - 0.1, 0.3], [L, 0]]);
      o.connect(trem);
      for (const [f, q, a] of [[rr(r, 650, 760), 5, 1], [rr(r, 1650, 1900), 7, 0.5], [2650, 8, 0.2]]) link(trem, filt(c, 'bandpass', f, q), gain(c, a), g);
      link(trem, filt(c, 'lowpass', 500, 0.7), gain(c, 0.15), g);
      g.connect(out);
    },
  },
};

export const SFX_NAMES = Object.keys(SFX);
