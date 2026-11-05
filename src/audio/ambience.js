// Worldseed audio — adaptive ambience.
//
// Four times a second the world is sampled around the camera target (radius
// follows the zoom) to measure water, coastline, forest, meadow, altitude, fire
// and settlement density. Those drive continuous beds (surf, wind, rain, fire,
// crickets, village murmur) through slow setTargetAtTime crossfades, and the
// spawn rates of short events (birdsong, gulls, owls, frogs, chickens,
// hammering) which are synthesised live at positions taken from the samples,
// so birds sing from where the trees are and surf comes from the shore side.
import { TILE, FLORA_INFO, SEA_LEVEL, MAX_HEIGHT } from '../world/constants.js';
import { rng, rr, pick, clamp, lerp, smoothstep, env, gain, filt, panNode, link, noise, osc, loopSrc, noiseBuffer, crackleBuffer, makeBuffer, cached, loopify, peakOf, scaleArr, TAU } from './dsp.js';

// ---- generated loops -------------------------------------------------------------

function cricketBuffer(sr, seconds = 9) {
  return cached(`crickets:${sr}:${seconds}`, () => {
    const len = Math.floor(sr * seconds);
    const fade = Math.floor(sr * 0.4);
    const L = new Float32Array(len + fade);
    const R = new Float32Array(len + fade);
    const r = rng(6061);
    const total = (len + fade) / sr;
    const add = (f, at, plen, amp, pan) => {
      const s0 = Math.floor(at * sr);
      const n = Math.floor(plen * sr);
      const gl = Math.cos(((pan + 1) * Math.PI) / 4) * amp;
      const gr = Math.sin(((pan + 1) * Math.PI) / 4) * amp;
      for (let k = 0; k < n && s0 + k < L.length; k++) {
        const e = Math.sin((Math.PI * k) / n);
        const v = Math.sin((TAU * f * k) / sr) * e * e;
        L[s0 + k] += v * gl;
        R[s0 + k] += v * gr;
      }
    };
    // a few close crickets and a faint chorus behind them
    for (let k = 0; k < 14; k++) {
      const close = k < 5;
      const f = rr(r, 3900, 5400);
      const pulseRate = rr(r, 26, 42);
      const pulses = 2 + Math.floor(r() * 3);
      const period = rr(r, 0.42, 0.95);
      const amp = close ? rr(r, 0.45, 1) : rr(r, 0.08, 0.22);
      const pan = rr(r, -0.85, 0.85);
      let t = r() * period;
      // some crickets pause now and then
      while (t < total) {
        if (r() < 0.08) t += rr(r, 0.8, 2.5);
        for (let p = 0; p < pulses; p++) add(f * rr(r, 0.997, 1.003), t + p / pulseRate, 0.55 / pulseRate, amp * rr(r, 0.8, 1), pan);
        t += period * rr(r, 0.95, 1.05);
      }
    }
    const pk = Math.max(peakOf(L), peakOf(R)) || 1;
    scaleArr(L, 0.8 / pk);
    scaleArr(R, 0.8 / pk);
    const buf = makeBuffer(2, len, sr);
    buf.copyToChannel(loopify(L, len, fade), 0);
    buf.copyToChannel(loopify(R, len, fade), 1);
    return buf;
  });
}

function dropsBuffer(sr, seconds = 7) {
  return cached(`drops:${sr}:${seconds}`, () => {
    const len = Math.floor(sr * seconds);
    const fade = Math.floor(sr * 0.3);
    const ch = [new Float32Array(len + fade), new Float32Array(len + fade)];
    const r = rng(777);
    const total = len + fade;
    let t = 0;
    while (t < total) {
      t += Math.floor((-Math.log(1 - r() * 0.999) * sr) / 140) + 1;
      const a = Math.pow(r(), 2.2);
      const f = rr(r, 1600, 6500);
      const d = rr(r, 0.0015, 0.006) * sr;
      const pan = r();
      const big = r() < 0.06;
      const n = Math.min(total - t, Math.floor(d * 7));
      for (let k = 0; k < n; k++) {
        let v = Math.sin((TAU * f * k) / sr) * Math.exp(-k / d) * a;
        if (big) v += Math.sin((TAU * f * 0.18 * (1 + k / n) * k) / sr) * Math.exp(-k / (d * 2.5)) * a * 0.8;
        ch[0][t + k] += v * (1 - pan);
        ch[1][t + k] += v * pan;
      }
    }
    const pk = Math.max(peakOf(ch[0]), peakOf(ch[1])) || 1;
    const buf = makeBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) buf.copyToChannel(loopify(scaleArr(ch[c], 0.8 / pk), len, fade), c);
    return buf;
  });
}

// Distant village chatter: formant-filtered voices babbling in syllables,
// rendered once off the main thread.
const murmurJobs = new Map();
function murmurBuffer(sr) {
  const key = `murmur:${sr}`;
  const job = murmurJobs.get(key);
  if (job) return job.buf;
  const j = { buf: null };
  murmurJobs.set(key, j);
  try {
    const seconds = 11,
      fade = 0.6;
    const oc = new OfflineAudioContext(2, Math.ceil((seconds + fade) * sr), sr);
    const r = rng(4242);
    const master = gain(oc, 1);
    link(master, filt(oc, 'highpass', 150, 0.6), filt(oc, 'lowpass', 2100, 0.6), oc.destination);
    const VOW = [[730, 1090], [530, 1840], [270, 2290], [570, 840], [300, 870], [660, 1720], [490, 1350]];
    for (let k = 0; k < 9; k++) {
      const f0 = rr(r, 95, 235);
      const o = oc.createOscillator();
      o.type = 'sawtooth';
      const f1 = filt(oc, 'bandpass', 700, 6);
      const f2 = filt(oc, 'bandpass', 1500, 9);
      const e = gain(oc, 0);
      o.connect(f1);
      o.connect(f2);
      link(f1, gain(oc, 1), e);
      link(f2, gain(oc, 0.45), e);
      link(e, panNode(oc, rr(r, -0.8, 0.8)), master);
      const amp = rr(r, 0.35, 1) * 0.5;
      o.frequency.setValueAtTime(f0, 0);
      let t = rr(r, 0, 1.5);
      while (t < seconds + fade) {
        const syl = 2 + Math.floor(r() * 7);
        const decl = rr(r, 0.05, 0.15);
        for (let s = 0; s < syl; s++) {
          const d = rr(r, 0.1, 0.24);
          const v = pick(r, VOW);
          o.frequency.setTargetAtTime(f0 * (1 + rr(r, -0.08, 0.1) - (decl * s) / syl), t, 0.03);
          f1.frequency.setTargetAtTime(v[0] * rr(r, 0.9, 1.1), t, 0.025);
          f2.frequency.setTargetAtTime(v[1] * rr(r, 0.9, 1.1), t, 0.025);
          const a = amp * rr(r, 0.5, 1);
          e.gain.setTargetAtTime(a, t, 0.02);
          e.gain.setTargetAtTime(a * 0.15, t + d * 0.65, 0.03);
          t += d;
        }
        e.gain.setTargetAtTime(0, t, 0.05);
        t += rr(r, 0.4, 2.4);
      }
      o.start(0);
      o.stop(seconds + fade);
    }
    link(noise(oc, 'pink', 0, seconds + fade, { ch: 2, r }), filt(oc, 'bandpass', 600, 0.6), gain(oc, 0.1), master);
    oc.startRendering().then((rb) => {
      const len = Math.floor(seconds * sr);
      const fd = Math.floor(fade * sr);
      const buf = makeBuffer(2, len, sr);
      let pk = 0;
      for (let c = 0; c < 2; c++) pk = Math.max(pk, peakOf(rb.getChannelData(c)));
      for (let c = 0; c < 2; c++) buf.copyToChannel(loopify(scaleArr(rb.getChannelData(c).slice(), 0.8 / (pk || 1)), len, fd), c);
      j.buf = buf;
    }, () => {});
  } catch {
    /* no offline rendering: no murmur */
  }
  return null;
}

// ---- event recipes (live, tiny graphs) -----------------------------------------
// fn(c, out, t, r) -> duration in seconds

function voice(c, out, t, type = 'sine') {
  const o = c.createOscillator();
  o.type = type;
  const g = gain(c, 0);
  o.connect(g).connect(out);
  o.start(t);
  return { o, g };
}

const EVENTS = {
  // robin-like phrase of gliding whistles
  whistler(c, out, t, r) {
    const { o, g } = voice(c, out, t);
    const fm = osc(c, 'sine', rr(r, 70, 140), t, 3);
    link(fm, gain(c, rr(r, 20, 70)), o.frequency);
    const base = rr(r, 2200, 3600);
    let at = t;
    const n = 3 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const len = rr(r, 0.06, 0.17);
      const f1 = base * rr(r, 0.8, 1.35);
      const a = rr(r, 0.5, 1);
      o.frequency.setValueAtTime(f1, at);
      o.frequency.exponentialRampToValueAtTime(f1 * rr(r, 0.75, 1.3), at + len);
      env(g.gain, at, [[0, 0], [Math.min(0.015, len * 0.3), a], [len * 0.7, a * 0.7], [len, 0]]);
      at += len + rr(r, 0.03, 0.09);
    }
    o.stop(at + 0.05);
    return at - t;
  },
  // rapid trill of down-chirps
  trill(c, out, t, r) {
    const { o, g } = voice(c, out, t);
    const rate = rr(r, 12, 22);
    const n = 6 + Math.floor(r() * 12);
    const f = rr(r, 3400, 5400);
    for (let i = 0; i < n; i++) {
      const at = t + i / rate;
      const len = 0.55 / rate;
      const a = Math.sin(((i + 0.5) / n) * Math.PI) * 0.6 + 0.4;
      o.frequency.setValueAtTime(f * 1.25, at);
      o.frequency.exponentialRampToValueAtTime(f * 0.82, at + len);
      env(g.gain, at, [[0, 0], [0.004, a], [len, 0]]);
    }
    const end = t + n / rate + 0.05;
    o.stop(end);
    return end - t;
  },
  // two or three clear whistles, the next a step lower ("fee-bee")
  twotone(c, out, t, r) {
    const { o, g } = voice(c, out, t);
    const vib = osc(c, 'sine', rr(r, 5, 8), t, 2);
    const f = rr(r, 3000, 3900);
    link(vib, gain(c, f * 0.004), o.frequency);
    const n = 2 + (r() < 0.35 ? 1 : 0);
    let at = t;
    for (let i = 0; i < n; i++) {
      const len = rr(r, 0.24, 0.38);
      const fi = f * Math.pow(0.89, i);
      o.frequency.setValueAtTime(fi * 1.02, at);
      o.frequency.exponentialRampToValueAtTime(fi, at + len);
      env(g.gain, at, [[0, 0], [0.04, 0.8], [len - 0.06, 0.65], [len, 0]]);
      at += len + rr(r, 0.06, 0.14);
    }
    o.stop(at + 0.05);
    return at - t;
  },
  // quick, warbling run of notes
  warble(c, out, t, r) {
    const { o, g } = voice(c, out, t);
    const fm = osc(c, 'sine', rr(r, 30, 60), t, 3);
    link(fm, gain(c, rr(r, 150, 400)), o.frequency);
    const n = 8 + Math.floor(r() * 7);
    let at = t;
    const base = rr(r, 2600, 4200);
    for (let i = 0; i < n; i++) {
      const len = rr(r, 0.03, 0.065);
      const f1 = base * rr(r, 0.7, 1.5);
      o.frequency.setValueAtTime(f1, at);
      o.frequency.exponentialRampToValueAtTime(f1 * rr(r, 0.8, 1.25), at + len);
      env(g.gain, at, [[0, 0], [0.006, rr(r, 0.5, 1)], [len, 0]]);
      at += len + rr(r, 0.008, 0.03);
    }
    o.stop(at + 0.05);
    return at - t;
  },
  // sparrow-like "chip chip"
  chips(c, out, t, r) {
    const { o, g } = voice(c, out, t);
    const n = 2 + Math.floor(r() * 3);
    const f = rr(r, 4000, 6000);
    let at = t;
    for (let i = 0; i < n; i++) {
      const len = rr(r, 0.018, 0.03);
      o.frequency.setValueAtTime(f * 1.15, at);
      o.frequency.exponentialRampToValueAtTime(f * 0.75, at + len);
      env(g.gain, at, [[0, 0], [0.003, rr(r, 0.6, 1)], [len, 0]]);
      at += rr(r, 0.11, 0.26);
    }
    o.stop(at + 0.05);
    return at - t;
  },
  // dove: soft low "hoo-HOO-hoo-hoo"
  dove(c, out, t, r) {
    const { o, g } = voice(c, out, t);
    const f = rr(r, 440, 560);
    const pat = [[0.25, 0.7, 1.0], [0.42, 1, 1.06], [0.3, 0.8, 1.0], [0.3, 0.7, 0.97]];
    let at = t;
    for (const [len, a, k] of pat) {
      o.frequency.setValueAtTime(f * k * 0.96, at);
      o.frequency.exponentialRampToValueAtTime(f * k, at + 0.06);
      o.frequency.exponentialRampToValueAtTime(f * k * 0.94, at + len);
      env(g.gain, at, [[0, 0], [0.06, a * 0.8], [len - 0.08, a * 0.6], [len, 0]]);
      at += len + rr(r, 0.12, 0.2);
    }
    o.stop(at + 0.05);
    return at - t;
  },
  // seagull: "kyow, kyow"
  gull(c, out, t, r) {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    const bp = filt(c, 'bandpass', 1700, 1.4);
    const lp = filt(c, 'lowpass', 3800, 0.7);
    const g = gain(c, 0);
    link(o, bp, lp, g, out);
    o.start(t);
    const f = rr(r, 700, 900);
    const n = 2 + Math.floor(r() * 3);
    let at = t;
    for (let i = 0; i < n; i++) {
      const len = rr(r, 0.26, 0.36);
      o.frequency.setValueAtTime(f, at);
      o.frequency.exponentialRampToValueAtTime(f * 1.45, at + 0.07);
      o.frequency.exponentialRampToValueAtTime(f * 0.88, at + len);
      env(g.gain, at, [[0, 0], [0.03, 0.8], [len * 0.6, 0.55], [len, 0]]);
      at += len + rr(r, 0.1, 0.25);
    }
    o.stop(at + 0.05);
    return at - t;
  },
  // tawny-owl-like call: "hooo … hu-hoooooo"
  owl(c, out, t, r) {
    const { o, g } = voice(c, out, t);
    const f = rr(r, 340, 410);
    const trem = osc(c, 'sine', 9, t, 4);
    const tg = gain(c, 0);
    link(trem, tg, g.gain);
    const notes = [[0, 0.45, 1], [1.3, 0.13, 1.05], [1.55, 0.75, 1.02]];
    for (const [st, len, k] of notes) {
      const at = t + st;
      o.frequency.setValueAtTime(f * k, at);
      o.frequency.exponentialRampToValueAtTime(f * k * 0.92, at + len);
      env(g.gain, at, [[0, 0], [0.05, 0.85], [len - 0.1, 0.7], [len, 0]]);
    }
    env(tg.gain, t, [[0, 0], [1.7, 0], [2.0, 0.25], [2.3, 0]]);
    const end = t + 2.4;
    o.stop(end);
    return 2.4;
  },
  // frog: buzzy double croak
  frog(c, out, t, r) {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    const f = rr(r, 170, 260);
    o.frequency.value = f;
    const am = gain(c, 0.5); // 0.5 ± 0.5: pulses between silence and full
    const pulse = osc(c, 'square', rr(r, 22, 32), t, 1.2);
    link(pulse, gain(c, 0.5), am.gain);
    const bp = filt(c, 'bandpass', rr(r, 700, 1000), 2.5);
    const g = gain(c, 0);
    link(o, am, bp, g, out);
    o.start(t);
    let at = t;
    const n = 1 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const len = rr(r, 0.12, 0.2);
      env(g.gain, at, [[0, 0], [0.015, 0.9], [len - 0.02, 0.7], [len, 0]]);
      at += len + rr(r, 0.08, 0.16);
    }
    o.stop(at + 0.05);
    return at - t;
  },
  // hen: "bok bok bok … b'gawk"
  chicken(c, out, t, r) {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    const b1 = filt(c, 'bandpass', 1000, 2);
    const b2 = filt(c, 'bandpass', 2300, 3);
    const g = gain(c, 0);
    o.connect(b1);
    o.connect(b2);
    link(b1, gain(c, 1), g);
    link(b2, gain(c, 0.5), g);
    g.connect(out);
    o.start(t);
    const f = rr(r, 290, 380);
    let at = t;
    const n = 2 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const len = rr(r, 0.05, 0.08);
      o.frequency.setValueAtTime(f * 1.3, at);
      o.frequency.exponentialRampToValueAtTime(f, at + len);
      env(g.gain, at, [[0, 0], [0.006, rr(r, 0.6, 0.9)], [len, 0]]);
      at += len + rr(r, 0.09, 0.2);
    }
    if (r() < 0.6) {
      const len = rr(r, 0.25, 0.34);
      o.frequency.setValueAtTime(f * 1.1, at);
      o.frequency.exponentialRampToValueAtTime(f * 1.7, at + len * 0.4);
      o.frequency.exponentialRampToValueAtTime(f * 1.2, at + len);
      env(g.gain, at, [[0, 0], [0.02, 1], [len * 0.7, 0.8], [len, 0]]);
      at += len;
    }
    o.stop(at + 0.05);
    return at - t;
  },
  // distant hammering on timber
  hammer(c, out, t, r) {
    const n = 2 + Math.floor(r() * 4);
    const f = rr(r, 340, 440);
    const gap = rr(r, 0.42, 0.62);
    let at = t;
    for (let i = 0; i < n; i++) {
      const a = rr(r, 0.7, 1);
      for (const [k, amp, tau] of [[1, 1, 0.04], [2.42, 0.45, 0.02], [4.1, 0.2, 0.01]]) {
        const o = osc(c, 'sine', f * k, at, tau * 8 + 0.02);
        const g = gain(c, 0);
        env(g.gain, at, [[0, 0], [0.0015, amp * a], [0.0015, 0, tau]]);
        link(o, g, out);
      }
      const s = noise(c, 'white', at, 0.03, { r });
      const g = gain(c, 0);
      env(g.gain, at, [[0, 0], [0.001, 0.4 * a], [0.001, 0, 0.004]]);
      link(s, filt(c, 'bandpass', 2200, 1), g, out);
      at += gap * rr(r, 0.95, 1.05);
    }
    return at - t;
  },
};
const SONGBIRDS = ['whistler', 'whistler', 'trill', 'twotone', 'warble', 'chips', 'chips'];
// level and reverb send per event kind
const EVENT_MIX = {
  whistler: [0.16, 0.3], trill: [0.11, 0.3], twotone: [0.13, 0.3], warble: [0.12, 0.3], chips: [0.12, 0.25],
  dove: [0.14, 0.3], gull: [0.11, 0.35], owl: [0.2, 0.45], frog: [0.12, 0.25], chicken: [0.12, 0.2], hammer: [0.16, 0.25],
};

// ---- beds --------------------------------------------------------------------
// build(c, out, t, r) -> {tick(t, aux), stop(t)}

const BEDS = {
  surf: {
    send: 0.12,
    build(c, out, t, r) {
      const sr = c.sampleRate;
      const dir = panNode(c, 0);
      dir.connect(out);
      const srcs = [];
      const base = 0.12;
      const lanes = [-0.6, 0.6].map((p, i) => {
        const s = loopSrc(c, noiseBuffer(sr, 'pink', 1), t, 0, r);
        const lp = filt(c, 'lowpass', 380, 0.6);
        const g = gain(c, base);
        const pn = panNode(c, p);
        link(s, lp, g, pn, dir);
        const fs = loopSrc(c, noiseBuffer(sr, 'white', 1), t, 0, r);
        const fg = gain(c, 0);
        link(fs, filt(c, 'highpass', 2400, 0.6), filt(c, 'lowpass', 9000, 0.5), fg, pn);
        srcs.push(s, fs);
        return { lp, g, fg, next: t + 0.05 + i * rr(r, 2.5, 4) };
      });
      const wash = loopSrc(c, noiseBuffer(sr, 'brown', 2), t, 0, r);
      const wg = gain(c, 0.5);
      link(wash, filt(c, 'lowpass', 380, 0.6), wg, out);
      srcs.push(wash);
      const wave = (lane, at) => {
        const rise = rr(r, 1.5, 2.6),
          fall = rr(r, 2.4, 4.0),
          A = rr(r, 0.55, 1.0);
        env(lane.g.gain, at, [[0, base], [rise * 0.6, A * 0.7], [rise, A], [rise + 0.3, A * 0.8], [rise + fall, base]]);
        env(lane.lp.frequency, at, [[0, 380], [rise, rr(r, 1300, 2100), 'e'], [rise + fall, 380, 'e']]);
        env(lane.fg.gain, at, [[0, 0], [rise * 0.85, 0], [rise + 0.15, A * 0.5], [rise + fall * 0.85, 0]]);
        return rise + fall + rr(r, 0.4, 2.5);
      };
      return {
        tick(now, aux) {
          for (const lane of lanes) {
            if (lane.next < now) lane.next = now + 0.02;
            while (lane.next < now + 1.0) lane.next += wave(lane, lane.next);
          }
          dir.pan.setTargetAtTime(aux.surfPan || 0, now, 1.2);
          wg.gain.setTargetAtTime(0.3 + 0.5 * (aux.openWater || 0), now, 1.5);
        },
        stop(at) {
          for (const s of srcs) s.stop(at);
        },
      };
    },
  },
  wind: {
    send: 0.1,
    build(c, out, t, r) {
      const sr = c.sampleRate;
      const s1 = loopSrc(c, noiseBuffer(sr, 'pink', 2), t, 0, r);
      const bp = filt(c, 'bandpass', 500, 0.8);
      const g = gain(c, 0.6);
      link(s1, bp, g, out);
      const s2 = loopSrc(c, noiseBuffer(sr, 'white', 2), t, 0, r);
      const bp2 = filt(c, 'bandpass', 900, 9);
      const wg = gain(c, 0);
      link(s2, bp2, wg, out);
      const s3 = loopSrc(c, noiseBuffer(sr, 'brown', 2), t, 0, r);
      const rg = gain(c, 0.2);
      link(s3, filt(c, 'lowpass', 160, 0.7), rg, out);
      let next = t;
      return {
        tick(now, aux) {
          const s = aux.wind || 0.3;
          if (next < now) next = now;
          while (next < now + 0.8) {
            const d = rr(r, 1.0, 3.2);
            const a = rr(r, 0.35, 1);
            g.gain.setTargetAtTime(0.35 + 0.65 * a, next, d * 0.35);
            bp.frequency.setTargetAtTime(rr(r, 260, 620) * (1 + s * 0.5), next, d * 0.4);
            bp2.frequency.setTargetAtTime(rr(r, 600, 1400) * (1 + s * 0.3), next, d * 0.5);
            wg.gain.setTargetAtTime(a * a * clamp((s - 0.3) * 1.1, 0, 0.7), next, d * 0.4);
            rg.gain.setTargetAtTime((0.15 + 0.5 * a) * clamp(s, 0, 1), next, d * 0.3);
            next += d;
          }
        },
        stop(at) {
          s1.stop(at);
          s2.stop(at);
          s3.stop(at);
        },
      };
    },
  },
  rain: {
    send: 0.1,
    build(c, out, t, r) {
      const sr = c.sampleRate;
      const s1 = loopSrc(c, noiseBuffer(sr, 'white', 2), t, 0, r);
      const hg = gain(c, 0.5);
      link(s1, filt(c, 'highpass', 1000, 0.6), filt(c, 'lowpass', 7500, 0.6), hg, out);
      const s2 = loopSrc(c, noiseBuffer(sr, 'pink', 2), t, 0, r);
      const pg = gain(c, 0.45);
      link(s2, filt(c, 'bandpass', 1500, 0.5), pg, out);
      const s3 = loopSrc(c, dropsBuffer(sr), t, 0, r);
      const dg = gain(c, 0.5);
      link(s3, dg, out);
      return {
        tick(now, aux) {
          const near = aux.near ?? 0.5;
          hg.gain.setTargetAtTime(0.35 + 0.35 * (1 - near), now, 1);
          dg.gain.setTargetAtTime(0.25 + 0.85 * near, now, 1);
          pg.gain.setTargetAtTime(0.3 + 0.3 * (aux.leafy || 0), now, 1);
        },
        stop(at) {
          s1.stop(at);
          s2.stop(at);
          s3.stop(at);
        },
      };
    },
  },
  fire: {
    send: 0.12,
    build(c, out, t, r) {
      const sr = c.sampleRate;
      const pn = panNode(c, 0);
      pn.connect(out);
      const s1 = loopSrc(c, crackleBuffer(sr, { seconds: 7, seed: 101, rate: 45, ch: 2, dec: [0.15, 1.8], pops: 0.35, cluster: 0.3 }), t, 0, r);
      link(s1, filt(c, 'bandpass', 2400, 0.45), gain(c, 0.85), pn);
      const s2 = loopSrc(c, noiseBuffer(sr, 'brown', 2), t, 0, r);
      const rg = gain(c, 0.5);
      link(s2, filt(c, 'lowpass', 420, 0.7), rg, pn);
      const s3 = loopSrc(c, noiseBuffer(sr, 'pink', 2), t, 0, r);
      link(s3, filt(c, 'bandpass', 4500, 0.8), gain(c, 0.06), pn);
      let next = t;
      return {
        tick(now, aux) {
          if (next < now) next = now;
          while (next < now + 0.6) {
            rg.gain.setTargetAtTime(rr(r, 0.3, 0.75), next, 0.07);
            next += rr(r, 0.1, 0.3);
          }
          pn.pan.setTargetAtTime(aux.firePan || 0, now, 0.8);
        },
        stop(at) {
          s1.stop(at);
          s2.stop(at);
          s3.stop(at);
        },
      };
    },
  },
  crickets: {
    send: 0.2,
    build(c, out, t, r) {
      const s = loopSrc(c, cricketBuffer(c.sampleRate), t, 0, r);
      link(s, filt(c, 'highpass', 2500, 0.6), out);
      return { tick() {}, stop: (at) => s.stop(at) };
    },
  },
  murmur: {
    send: 0.18,
    build(c, out, t, r) {
      const buf = murmurBuffer(c.sampleRate);
      if (!buf) return null; // still rendering; retried next analysis
      const pn = panNode(c, 0);
      const s = loopSrc(c, buf, t, 0, r);
      link(s, filt(c, 'lowpass', 1800, 0.6), pn, out);
      return {
        tick(now, aux) {
          pn.pan.setTargetAtTime(aux.villagePan || 0, now, 1.2);
        },
        stop: (at) => s.stop(at),
      };
    },
  },
};
// base output gain per bed (level 1)
const BED_GAIN = { surf: 0.5, wind: 0.32, rain: 0.42, fire: 0.6, crickets: 0.12, murmur: 0.42 };

class Bed {
  constructor(amb, name) {
    const c = amb.c;
    this.c = c;
    this.amb = amb;
    this.name = name;
    this.def = BEDS[name];
    this.out = gain(c, 0);
    this.out.connect(amb.bus.in);
    this.send = gain(c, this.def.send);
    this.out.connect(this.send).connect(amb.bus.send);
    this.inst = null;
    this.level = 0;
    this.quietSince = 0;
  }
  set(level, now, tc = 1.2) {
    level = clamp(level || 0, 0, 1.6);
    if (level > 0.003 && !this.inst) this.inst = this.def.build(this.c, this.out, now + 0.02, this.amb.r);
    if (!this.inst && level > 0.003) return; // not ready yet
    this.out.gain.setTargetAtTime(level * BED_GAIN[this.name], now, tc);
    this.level = level;
    if (level > 0.003) this.quietSince = now;
    else if (this.inst && now - this.quietSince > 10) {
      // long silent: stop the sources to save CPU
      this.inst.stop(now + 0.05);
      this.inst = null;
    }
  }
  tick(now, aux) {
    this.inst?.tick(now, aux);
  }
  kill() {
    try {
      this.inst?.stop(this.c.currentTime + 0.02);
    } catch {
      /* already stopped */
    }
    this.inst = null;
  }
}

// ---- the ambience system ---------------------------------------------------------

export class Ambience {
  constructor(audio) {
    this.audio = audio;
    this.game = audio.game;
    this.c = null;
    this.r = rng(1337);
    this.scene = null;
    this.levels = {};
    this.aux = {};
    this.events = [];
    this._acc = 1;
    this._warm = [];
  }

  start(c, mix) {
    this.c = c;
    this.bus = mix.buses.ambience;
    this.beds = {};
    for (const n of Object.keys(BEDS)) this.beds[n] = new Bed(this, n);
    const sr = c.sampleRate;
    // pre-generate loop material over the next frames, not all at once
    this._warm = [
      () => noiseBuffer(sr, 'pink', 1),
      () => noiseBuffer(sr, 'white', 1),
      () => noiseBuffer(sr, 'brown', 2),
      () => noiseBuffer(sr, 'pink', 2),
      () => noiseBuffer(sr, 'white', 2),
      () => cricketBuffer(sr),
      () => dropsBuffer(sr),
      () => crackleBuffer(sr, { seconds: 7, seed: 101, rate: 45, ch: 2, dec: [0.15, 1.8], pops: 0.35, cluster: 0.3 }),
      () => murmurBuffer(sr),
    ];
  }

  reset() {
    this._acc = 1; // re-analyse right away
  }

  update(dt) {
    if (!this.c) return;
    if (this._warm.length) this._warm.shift()();
    const now = this.c.currentTime;
    this._acc += dt;
    if (this._acc >= 0.25) {
      this._acc = 0;
      this.scene = this.analyze();
      this.applyLevels(now);
    }
    if (!this.scene) return;
    for (const n in this.beds) this.beds[n].tick(now, this.aux);
    this.spawnEvents(dt, now);
    // release finished event graphs
    if (this.events.length) {
      this.events = this.events.filter((e) => {
        if (now < e.end) return true;
        for (const n of e.nodes) n.disconnect();
        return false;
      });
    }
  }

  // ---- sampling -----------------------------------------------------------------
  analyze() {
    const g = this.game;
    const w = g.world;
    const rig = g.cameraRig;
    const tx = rig.target.x,
      tz = rig.target.z;
    const dist = rig.cur.dist;
    const zt = clamp((dist - rig.minDist) / (rig.maxDist - rig.minDist), 0, 1);
    const yaw = rig.cur.yaw;
    const cy = Math.cos(yaw),
      sy = Math.sin(yaw);
    const viewR = Math.max(10, dist * 0.62);
    const R = clamp(dist * 0.7, 12, 150);
    const N = 15;
    const step = (2 * R) / (N - 1);
    const off = Math.max(2, Math.floor(step * 0.5));
    let wsum = 0,
      water = 0,
      coast = 0,
      trees = 0,
      grass = 0,
      cold = 0,
      swamp = 0,
      hsum = 0,
      landW = 0,
      waterX = 0,
      leafy = 0;
    const treePts = [];
    const coastPts = [];
    const wetPts = [];
    const H = w.height,
      T = w.type,
      F = w.flora;
    const W = w.w,
      Hh = w.h;
    const isW = (x, z) => {
      const ix = Math.floor(x),
        iz = Math.floor(z);
      if (ix < 0 || iz < 0 || ix >= W || iz >= Hh) return true; // the world is ringed by sea
      return H[iz * W + ix] < SEA_LEVEL;
    };
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const dx = -R + i * step,
          dz = -R + j * step;
        const d2 = (dx * dx + dz * dz) / (R * R);
        if (d2 > 1) continue;
        const x = tx + dx,
          z = tz + dz;
        const wt = 1 - 0.65 * d2;
        wsum += wt;
        const right = (dx * cy - dz * sy) / viewR;
        const ix = Math.floor(x),
          iz = Math.floor(z);
        const inside = ix >= 0 && iz >= 0 && ix < W && iz < Hh;
        const wet = isW(x, z);
        const shore = wet !== isW(x + off, z) || wet !== isW(x, z + off) || wet !== isW(x - off, z) || wet !== isW(x, z - off);
        if (shore) {
          coast += wt;
          waterX += right * wt;
          if (coastPts.length < 40) coastPts.push({ x, z });
        }
        if (wet) {
          water += wt;
          if (!shore) waterX += right * wt * 0.25;
          continue;
        }
        if (!inside) continue;
        const k = iz * W + ix;
        landW += wt;
        hsum += Math.max(0, H[k]) * wt;
        const fi = FLORA_INFO[F[k]];
        const ty = T[k];
        let tree = fi && fi.isTree ? 1 : 0;
        if (ty === TILE.FOREST || ty === TILE.JUNGLE) tree = Math.max(tree, 0.6);
        if (tree) {
          trees += tree * wt;
          leafy += wt;
          if (treePts.length < 60) treePts.push({ x, z });
        }
        if (ty === TILE.GRASS || ty === TILE.SAVANNA || ty === TILE.FARMLAND) grass += wt;
        else if (ty === TILE.SNOW || ty === TILE.ROCK || ty === TILE.TUNDRA || ty === TILE.ICE) cold += wt;
        else if (ty === TILE.SWAMP) {
          swamp += wt;
          if (wetPts.length < 30) wetPts.push({ x, z });
        }
      }
    }
    const nw = wsum || 1;
    const s = {
      zt,
      near: 1 - Math.pow(zt, 0.7),
      R,
      viewR,
      water: water / nw,
      coast: coast / nw,
      trees: trees / nw,
      grass: grass / nw,
      cold: cold / nw,
      swamp: swamp / nw,
      leafy: leafy / nw,
      waterPan: clamp(waterX / Math.max(1e-3, coast + water * 0.25), -1, 1),
      alt: landW > 0 ? hsum / landW / MAX_HEIGHT : 0,
      altCenter: clamp(w.heightAt(tx, tz) / MAX_HEIGHT, 0, 1),
      treePts,
      coastPts,
      wetPts,
    };
    if (coastPts.length) for (const p of coastPts) if (wetPts.length < 40) wetPts.push(p);

    // fire near the target (full-resolution scan, coarser when far)
    const fireR = clamp(dist * 0.7, 10, 100);
    const fstep = fireR > 50 ? 2 : 1;
    const x0 = Math.max(0, Math.floor(tx - fireR)),
      x1 = Math.min(W - 1, Math.floor(tx + fireR));
    const z0 = Math.max(0, Math.floor(tz - fireR)),
      z1 = Math.min(Hh - 1, Math.floor(tz + fireR));
    const FI = w.fire;
    let fire = 0,
      fireX = 0;
    const fr2 = fireR * fireR;
    for (let z = z0; z <= z1; z += fstep) {
      for (let x = x0; x <= x1; x += fstep) {
        const v = FI[z * W + x];
        if (!(v > 0)) continue;
        const dx = x + 0.5 - tx,
          dz = z + 0.5 - tz;
        const d2 = dx * dx + dz * dz;
        if (d2 > fr2) continue;
        const wt = (v * fstep * fstep) / (1 + d2 / (fireR * fireR * 0.12));
        fire += wt;
        fireX += ((dx * cy - dz * sy) / viewR) * wt;
      }
    }
    s.fire = 1 - Math.exp(-fire / 6);
    s.firePan = fire > 0 ? clamp(fireX / fire, -1, 1) : 0;

    // settlements
    let bld = 0,
      building = 0,
      vx = 0;
    const vr = clamp(dist * 0.8, 16, 120);
    try {
      const list = g.civ?.buildings;
      if (list && list.length) {
        for (const b of list) {
          if (!b || b.alive === false) continue;
          const dx = b.x - tx,
            dz = b.z - tz;
          const d2 = dx * dx + dz * dz;
          if (d2 > vr * vr) continue;
          const wt = 1 / (1 + d2 / (vr * vr * 0.2));
          bld += wt;
          vx += ((dx * cy - dz * sy) / viewR) * wt;
          if (b.progress != null && b.progress < 1) building += wt;
        }
      }
    } catch {
      /* civ not ready */
    }
    let humans = 0;
    try {
      const q = g.units?.query?.(tx, tz, vr, (u) => u.species === 'human');
      if (q && q.length) {
        humans = q.length;
        if (!bld) for (const u of q) vx += ((u.x - tx) * cy - (u.z - tz) * sy) / viewR;
      }
    } catch {
      /* units not ready */
    }
    s.buildings = bld;
    s.constructing = building;
    s.humans = humans;
    s.village = clamp(humans / 30 + bld / 10, 0, 1);
    s.villagePan = clamp(bld ? vx / bld : humans ? vx / humans : 0, -1, 1);
    return s;
  }

  // ---- mapping scene -> levels ---------------------------------------------------
  applyLevels(now) {
    const s = this.scene;
    const g = this.game;
    const e = g.env || {};
    const day = clamp(e.daylight ?? 1, 0, 1);
    const night = 1 - smoothstep(0.12, 0.55, day);
    const wt = e.weather?.type || 'clear';
    const wi = clamp(e.weather?.intensity ?? 0, 0, 1);
    const rain = wt === 'rain' || wt === 'storm' ? Math.max(0.15, wi) : 0;
    const storm = wt === 'storm' ? Math.max(0.2, wi) : 0;
    const snow = wt === 'snow' ? Math.max(0.2, wi) : 0;
    const windStr = clamp(e.wind?.strength ?? 0.35, 0, 1.5);
    const near = s.near;

    const coastness = clamp(s.coast * 2.6, 0, 1);
    const L = this.levels;
    L.surf = (coastness * 0.75 + s.water * 0.35) * (0.35 + 0.65 * near) + s.water * s.zt * 0.3;
    L.wind = clamp(0.1 + 0.55 * s.zt + 0.5 * Math.max(s.alt, s.altCenter) + 0.25 * s.cold, 0, 1.2) * (0.45 + 0.8 * windStr) + storm * 0.55 + snow * 0.15;
    L.rain = rain * (0.75 + 0.25 * near);
    L.fire = s.fire * (0.45 + 0.55 * near);
    const green = clamp((s.grass + s.trees * 0.8 + s.swamp * 0.6) * 1.6, 0, 1);
    L.crickets = night * green * (1 - rain * 0.85) * (1 - snow) * (0.3 + 0.7 * near);
    L.murmur = s.village * (0.25 + 0.75 * Math.pow(near, 1.2)) * (0.35 + 0.65 * day) * (1 - rain * 0.4);

    const a = this.aux;
    a.near = near;
    a.wind = clamp(windStr + storm * 0.6 + 0.4 * s.alt, 0, 1.6);
    a.surfPan = s.waterPan * 0.7;
    a.openWater = s.water;
    a.firePan = s.firePan * 0.8;
    a.villagePan = s.villagePan * 0.7;
    a.leafy = s.leafy;

    for (const n in this.beds) this.beds[n].set(L[n], now, n === 'fire' ? 0.6 : 1.4);

    // event rates (per second)
    const forest = clamp(s.trees * 2.4 + s.grass * 0.25, 0, 1);
    const dawn = smoothstep(0.15, 0.4, day) * (1 - smoothstep(0.55, 0.8, day)) * 0.6;
    const calm = (1 - rain * 0.92) * (1 - snow * 0.7) * (1 - storm);
    this.rates = {
      bird: (0.5 + dawn) * forest * smoothstep(0.25, 0.6, day) * calm * (0.15 + 0.85 * near),
      dove: 0.03 * clamp(s.grass * 2 + s.trees, 0, 1) * smoothstep(0.4, 0.8, day) * calm * near,
      gull: 0.07 * coastness * smoothstep(0.3, 0.7, day) * calm * (0.2 + 0.8 * near),
      owl: 0.028 * night * clamp(s.trees * 3, 0, 1) * (1 - rain) * (0.3 + 0.7 * near),
      frog: 0.25 * night * clamp(s.swamp * 4 + coastness * 0.5, 0, 1) * (1 - snow) * near,
      chicken: 0.07 * clamp(s.buildings / 4, 0, 1) * smoothstep(0.35, 0.7, day) * (1 - rain * 0.6) * near,
      hammer: (s.constructing > 0 ? 0.2 : 0.04) * clamp(s.village * 1.5, 0, 1) * smoothstep(0.35, 0.7, day) * (1 - rain * 0.5) * near,
    };
  }

  spawnEvents(dt, now) {
    const rates = this.rates;
    if (!rates) return;
    const s = this.scene;
    const r = this.r;
    for (const k in rates) {
      const lam = rates[k];
      if (!(lam > 0) || r() >= 1 - Math.exp(-lam * dt)) continue;
      let kind = k;
      let pts = s.treePts;
      if (k === 'bird') kind = pick(r, SONGBIRDS);
      else if (k === 'gull') pts = s.coastPts;
      else if (k === 'frog') pts = s.wetPts;
      else if (k === 'chicken' || k === 'hammer') pts = null;
      let pos;
      if (pts && pts.length) pos = pick(r, pts);
      else {
        const a = r() * TAU,
          d = Math.sqrt(r()) * s.R * 0.8;
        pos = { x: this.game.cameraRig.target.x + Math.cos(a) * d, z: this.game.cameraRig.target.z + Math.sin(a) * d };
      }
      this.spawn(kind, pos, now);
    }
  }

  spawn(kind, pos, now, out = null, r = this.r) {
    const c = this.c;
    if (this.events.length >= 10 && !out) return;
    const [lvl, wet] = EVENT_MIX[kind];
    const sp = out ? { g: 1, pan: 0, cut: 16000 } : this.audio._spatial(pos, { range: 1.1, zoom: 0.4 });
    const vol = lvl * sp.g * rr(r, 0.55, 1.0);
    if (vol < 0.004) return;
    const g = gain(c, vol);
    const lp = filt(c, 'lowpass', Math.min(sp.cut, 14000), 0.5);
    const pn = panNode(c, sp.pan);
    const bus = out || this.bus;
    link(g, lp, pn, bus.in);
    const sg = gain(c, wet);
    pn.connect(sg).connect(bus.send);
    const dur = EVENTS[kind](c, g, now + 0.03, r);
    this.events.push({ end: now + dur + 1, nodes: [g, lp, pn, sg] });
  }

  // ---- offline rendering for measurement -----------------------------------------
  // layer: a bed name, an event name, 'birds' (a medley) or 'scene'
  async renderDebug(oc, mix, layer, seconds, opts = {}) {
    const r = rng(opts.seed ?? 99);
    const bus = mix.buses.ambience;
    const T = opts.offset || 0;
    if (BEDS[layer]) {
      if (layer === 'murmur') {
        // wait for the async render of the babble loop
        for (let i = 0; i < 200 && !murmurBuffer(oc.sampleRate); i++) await new Promise((res) => setTimeout(res, 20));
      }
      const out = gain(oc, 0);
      out.connect(bus.in);
      out.connect(gain(oc, BEDS[layer].send)).connect(bus.send);
      const lvl = (opts.level ?? 1) * BED_GAIN[layer];
      env(out.gain, T, [[0, 0], [1.0, lvl], [seconds - 1.0, lvl], [seconds - 0.05, 0]]);
      const inst = BEDS[layer].build(oc, out, T, r);
      const aux = { near: 0.6, wind: opts.wind ?? 0.6, surfPan: 0, openWater: 0.5, firePan: 0, villagePan: 0, leafy: 0.5 };
      for (let t = T; t < T + seconds; t += 0.25) inst?.tick(t, aux);
      inst?.stop(T + seconds);
      return;
    }
    const saved = { c: this.c, events: this.events };
    this.c = oc;
    this.events = [];
    try {
      const kinds = EVENTS[layer] ? [layer] : layer === 'birds' ? SONGBIRDS : Object.keys(EVENTS);
      let t = T + 0.2;
      let i = 0;
      while (t < T + seconds - 3) {
        const kind = kinds[i++ % kinds.length];
        this.spawn(kind, null, t, bus, r);
        t += kind === 'owl' ? 3 : rr(r, 1.0, 2.0);
      }
    } finally {
      this.c = saved.c;
      this.events = saved.events;
    }
  }

  debugInfo() {
    const s = this.scene;
    if (!s) return null;
    const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));
    return {
      scene: round({ zt: s.zt, near: s.near, water: s.water, coast: s.coast, trees: s.trees, grass: s.grass, alt: s.alt, fire: s.fire, village: s.village, humans: s.humans, buildings: s.buildings }),
      levels: round(this.levels),
      rates: this.rates ? round(this.rates) : null,
      running: Object.keys(this.beds || {}).filter((n) => this.beds[n].inst),
      events: this.events.length,
    };
  }
}
