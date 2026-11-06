// Worldseed audio — a small, context-agnostic synthesis toolkit.
//
// Every node helper takes the target BaseAudioContext, so one recipe can render
// live (AudioContext) or offline (OfflineAudioContext, used for baking and for
// the debug/measurement hooks). Generated AudioBuffers are cached per sample
// rate; AudioBuffers are not tied to a context, so live and offline renders
// share them.

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (g) => 20 * Math.log10(Math.max(1e-9, g));
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ---- deterministic randomness ------------------------------------------------
export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rr = (r, a, b) => a + (b - a) * r();
export const pick = (r, arr) => arr[Math.min(arr.length - 1, Math.floor(r() * arr.length))];
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---- buffers -----------------------------------------------------------------
const bufCache = new Map();
export function cached(key, make) {
  let b = bufCache.get(key);
  if (!b) {
    b = make();
    bufCache.set(key, b);
  }
  return b;
}

export function makeBuffer(channels, length, sampleRate, ctx = null) {
  length = Math.max(1, length | 0);
  try {
    return new AudioBuffer({ length, numberOfChannels: channels, sampleRate });
  } catch {
    return ctx.createBuffer(channels, length, sampleRate);
  }
}

// Equal-power crossfade of the tail [len, len+fade) into the head so the
// first `len` samples loop seamlessly. Suited to noise-like material.
export function loopify(raw, len, fade, out = new Float32Array(len)) {
  for (let i = 0; i < len; i++) out[i] = raw[i];
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    out[i] = raw[i] * Math.sin(k * Math.PI * 0.5) + raw[len + i] * Math.cos(k * Math.PI * 0.5);
  }
  return out;
}

export function rmsOf(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, a.length));
}
export function peakOf(a) {
  let p = 0;
  for (let i = 0; i < a.length; i++) {
    const v = Math.abs(a[i]);
    if (v > p) p = v;
  }
  return p;
}
export function scaleArr(a, k) {
  for (let i = 0; i < a.length; i++) a[i] *= k;
  return a;
}

function fillNoise(a, kind, r) {
  if (kind === 'pink') {
    // Paul Kellet's refined pink filter
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < a.length; i++) {
      const w = r() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      a[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    }
  } else if (kind === 'brown') {
    let last = 0;
    for (let i = 0; i < a.length; i++) {
      last = (last + 0.02 * (r() * 2 - 1)) / 1.02;
      a[i] = last;
    }
    // remove residual DC with a gentle one-pole high-pass
    let lp = 0;
    for (let i = 0; i < a.length; i++) {
      lp += 0.0004 * (a[i] - lp);
      a[i] -= lp;
    }
  } else {
    for (let i = 0; i < a.length; i++) a[i] = r() * 2 - 1;
  }
}

// Seamlessly looping noise, normalised to RMS 0.25 so kinds are comparable.
export function noiseBuffer(sr, kind = 'white', ch = 1, seconds = 6) {
  return cached(`noise:${kind}:${ch}:${sr}:${seconds}`, () => {
    const len = Math.floor(sr * seconds);
    const fade = Math.floor(sr * 0.3);
    const buf = makeBuffer(ch, len, sr);
    for (let c = 0; c < ch; c++) {
      const r = rng(9173 + c * 7919 + hashStr(kind));
      const raw = new Float32Array(len + fade);
      fillNoise(raw, kind, r);
      scaleArr(raw, 0.25 / (rmsOf(raw) || 1));
      buf.copyToChannel(loopify(raw, len, fade), c);
    }
    return buf;
  });
}

// Sparse crackle: heavy-tailed impulses with short noisy/resonant decays.
// Used for fire, debris, gravel and sizzle textures.
// `shape` is the amplitude exponent: higher = mostly faint ticks, rare pops.
export function crackleBuffer(sr, { seconds = 5, rate = 40, seed = 3, ch = 1, dec = [0.25, 2.2], pops = 0.3, cluster = 0.25, shape = 2.4 } = {}) {
  return cached(`crackle:${sr}:${seconds}:${rate}:${seed}:${ch}:${dec}:${pops}:${cluster}:${shape}`, () => {
    const len = Math.floor(sr * seconds);
    const fade = Math.floor(sr * 0.2);
    const buf = makeBuffer(ch, len, sr);
    for (let c = 0; c < ch; c++) {
      const r = rng(seed * 131 + c * 977);
      const raw = new Float32Array(len + fade);
      let t = 0;
      while (t < raw.length) {
        const burst = r() < cluster;
        t += Math.floor((-Math.log(1 - r() * 0.999) * sr) / rate) * (burst ? 0.12 : 1) + 1;
        const amp = Math.pow(r(), shape) * (r() < 0.5 ? -1 : 1);
        const d = (rr(r, dec[0], dec[1]) * sr) / 1000;
        const n = Math.min(raw.length - t, Math.floor(d * 7));
        const isPop = r() < pops;
        const f = rr(r, 900, 3400);
        let lp = 0;
        const a = rr(r, 0.25, 0.9);
        for (let k = 0; k < n; k++) {
          const e = Math.exp(-k / d);
          lp += a * (r() * 2 - 1 - lp);
          let v = lp * e;
          if (isPop) v += 0.7 * Math.sin((TAU * f * k) / sr) * Math.exp(-k / (d * 1.6));
          raw[t + k] += amp * v;
        }
      }
      scaleArr(raw, 0.9 / (peakOf(raw) || 1));
      buf.copyToChannel(loopify(raw, len, fade), c);
    }
    return buf;
  });
}

// ---- RBJ biquad for JS-side generation ----------------------------------------
export class Biquad {
  constructor(type, f, q, sr, gainDb = 0) {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.set(type, f, q, sr, gainDb);
  }
  set(type, f, q, sr, gainDb = 0) {
    const w0 = (TAU * Math.min(f, sr * 0.49)) / sr;
    const cs = Math.cos(w0),
      sn = Math.sin(w0);
    const alpha = sn / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lowpass') {
      b0 = (1 - cs) / 2;
      b1 = 1 - cs;
      b2 = (1 - cs) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cs;
      a2 = 1 - alpha;
    } else if (type === 'highpass') {
      b0 = (1 + cs) / 2;
      b1 = -(1 + cs);
      b2 = (1 + cs) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cs;
      a2 = 1 - alpha;
    } else if (type === 'peaking') {
      const A = Math.pow(10, gainDb / 40);
      b0 = 1 + alpha * A;
      b1 = -2 * cs;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cs;
      a2 = 1 - alpha / A;
    } else {
      // bandpass, 0 dB peak gain
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cs;
      a2 = 1 - alpha;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

// ---- procedural reverb impulse --------------------------------------------------
// Stereo, decorrelated exponential tail that darkens as it decays, with a short
// pre-delay and a handful of early reflections. Convolver normalisation is left
// on, so only the shape matters here.
export function reverbIR(sr, { seconds = 3.6, rt60 = 3.0, predelay = 0.022, seed = 11 } = {}) {
  return cached(`ir:${sr}:${seconds}:${rt60}:${predelay}:${seed}`, () => {
    const len = Math.floor(sr * seconds);
    const buf = makeBuffer(2, len, sr);
    const pre = Math.floor(predelay * sr);
    for (let ch = 0; ch < 2; ch++) {
      const r = rng(seed * 7 + ch * 1013);
      const d = new Float32Array(len);
      let lp = 0;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / sr;
        const e = Math.exp((-6.9078 * t) / rt60);
        const a = 0.08 + 0.9 * Math.exp(-t / (rt60 * 0.22));
        lp += a * (r() * 2 - 1 - lp);
        // keep energy envelope independent of the darkening filter
        const comp = 1 / Math.sqrt(a / (2 - a));
        const fadeIn = Math.min(1, (i - pre) / (sr * 0.012));
        d[i] = lp * comp * e * fadeIn;
      }
      // early reflections (different per side for width)
      for (let k = 0; k < 9; k++) {
        const at = pre + Math.floor(rr(r, 0.004, 0.075) * sr);
        const g = rr(r, 0.4, 1.1) * (r() < 0.5 ? -1 : 1) * (1 - k / 12);
        for (let j = 0; j < 24 && at + j < len; j++) d[at + j] += g * Math.exp(-j / 5) * (1 - j / 24);
      }
      const fo = Math.floor(sr * 0.08);
      for (let i = 0; i < fo; i++) d[len - 1 - i] *= i / fo;
      buf.copyToChannel(d, ch);
    }
    return buf;
  });
}

// Transparent below `knee`, smoothly saturating to `ceil` above it. Inputs
// beyond ±1 clamp to the curve ends, so the output can never exceed `ceil`.
export function softClipCurve(knee = 0.9, ceil = 0.985, n = 8193) {
  return cached(`softclip:${knee}:${ceil}:${n}`, () => {
    const c = new Float32Array(n);
    const span = ceil - knee;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      const ax = Math.abs(x);
      const y = ax <= knee ? ax : knee + span * Math.tanh((ax - knee) / span);
      c[i] = Math.sign(x) * y;
    }
    return c;
  });
}

export function driveCurve(drive = 2, n = 2049) {
  return cached(`drive:${drive}:${n}`, () => {
    const c = new Float32Array(n);
    const k = Math.tanh(drive);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(x * drive) / k;
    }
    return c;
  });
}

// ---- node helpers ---------------------------------------------------------------
export function gain(c, v = 0) {
  const g = c.createGain();
  g.gain.value = v;
  return g;
}
export function filt(c, type, f, q = 0.707, g = 0) {
  const b = c.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  if (g) b.gain.value = g;
  return b;
}
export function panNode(c, p = 0) {
  const n = c.createStereoPanner();
  n.pan.value = clamp(p, -1, 1);
  return n;
}
export function shaper(c, drive = 2) {
  const w = c.createWaveShaper();
  w.curve = driveCurve(drive);
  return w;
}
export function link(...nodes) {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}
export function noise(c, kind, t, dur, { ch = 1, rate = 1, r = Math.random } = {}) {
  const s = c.createBufferSource();
  s.buffer = noiseBuffer(c.sampleRate, kind, ch);
  s.loop = true;
  s.playbackRate.value = rate;
  s.start(t, r() * (s.buffer.duration - 0.01));
  s.stop(t + dur);
  return s;
}
export function osc(c, type, f, t, dur) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  o.start(t);
  o.stop(t + dur);
  return o;
}

// Automation from a compact point list. Times are relative to t.
//   [dt, v]          linear ramp (first point: set)
//   [dt, v, 'e']     exponential ramp (v floored at 1e-4)
//   [dt, v, 's']     step
//   [dt, v, tau]     setTargetAtTime starting at dt with time constant tau
// A ramp must never follow a setTarget point (WebAudio would restart the ramp
// from the setTarget's start time); use a step or another setTarget instead.
export function env(param, t, pts) {
  let first = true;
  for (const p of pts) {
    const at = t + p[0];
    const v = p[1];
    const c = p[2];
    if (first) {
      param.setValueAtTime(v, at);
      first = false;
    } else if (c === undefined || c === 'l') param.linearRampToValueAtTime(v, at);
    else if (c === 'e') param.exponentialRampToValueAtTime(Math.max(1e-4, v), at);
    else if (c === 's') param.setValueAtTime(v, at);
    else param.setTargetAtTime(v, at, c);
  }
  return param;
}

// An exponentially decaying partial — the atom of knocks, bells and plings.
export function tone(c, out, t, f, amp, tau, o = {}) {
  const { type = 'sine', attack = 0.0015, f1 = 0, glide = 0.05, detune = 0, pan = null, len = 0 } = o;
  const dur = len || attack + tau * 7.5 + 0.02;
  const os = osc(c, type, f, t, dur);
  if (f1) os.frequency.exponentialRampToValueAtTime(f1, t + glide);
  if (detune) os.detune.value = detune;
  const g = gain(c, 0);
  env(g.gain, t, [[0, 0], [attack, amp], [attack, 0, tau]]);
  os.connect(g);
  if (pan != null) link(g, panNode(c, pan), out);
  else g.connect(out);
  return g;
}

// A filtered noise burst with a linear attack and exponential decay.
export function burst(c, out, t, o = {}) {
  const { kind = 'white', amp = 1, attack = 0.001, tau = 0.02, len = 0, hp = 0, lp = 0, bp = 0, q = 1, ch = 1, r = Math.random, pan = null, rate = 1 } = o;
  const dur = len || attack + tau * 7.5 + 0.02;
  let node = noise(c, kind, t, dur, { ch, r, rate });
  if (hp) node = link(node, filt(c, 'highpass', hp, 0.707));
  if (lp) node = link(node, filt(c, 'lowpass', lp, 0.707));
  if (bp) node = link(node, filt(c, 'bandpass', bp, q));
  const g = gain(c, 0);
  env(g.gain, t, [[0, 0], [attack, amp], [attack, 0, tau]]);
  node.connect(g);
  if (pan != null) link(g, panNode(c, pan), out);
  else g.connect(out);
  return g;
}

// Looping buffer source started at a random offset.
export function loopSrc(c, buffer, t, dur, r = Math.random, rate = 1) {
  const s = c.createBufferSource();
  s.buffer = buffer;
  s.loop = true;
  s.playbackRate.value = rate;
  s.start(t, r() * (buffer.duration - 0.01));
  if (dur) s.stop(t + dur);
  return s;
}
