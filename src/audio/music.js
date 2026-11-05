// Worldseed audio — gentle generative music.
//
// A small composer writes one bar at a time, a second or so ahead of the
// audio clock. A piece is a slow modal chord progression (two bars per chord)
// carried by a soft pad, harp arpeggios (Karplus–Strong plucks computed in JS)
// and, sometimes, a breathy flute phrase; night pieces are slower, darker and
// add distant bells. Between pieces there is silence. 'war' and 'disaster'
// notifications raise a tension level that switches to a low, restrained
// phrygian mood with a drone, a damped low ostinato and soft frame drums; as
// tension decays the music finds its way back to calm.
import { rng, rr, pick, clamp, mtof, env, gain, filt, panNode, link, osc, noise, makeBuffer, cached } from './dsp.js';

const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};
// pentatonic subsets (scale-degree indices) used for melodies
const PENTA_DEG = {
  ionian: [0, 1, 2, 4, 5],
  lydian: [0, 1, 2, 4, 5],
  mixolydian: [0, 1, 2, 4, 5],
  dorian: [0, 2, 3, 4, 6],
  aeolian: [0, 2, 3, 4, 6],
  phrygian: [0, 1, 3, 4, 5],
};

const MOODS = {
  day: {
    modes: ['ionian', 'lydian', 'mixolydian', 'ionian'],
    roots: [60, 62, 65, 67],
    beat: [0.8, 0.92],
    progs: [[0, 3, 0, 4], [0, 5, 3, 4], [3, 4, 2, 5], [0, 2, 3, 3], [5, 3, 0, 4], [0, 4, 5, 3]],
    lydianProgs: [[0, 1, 0, 1], [0, 1, 4, 0], [0, 1, 5, 4]],
    harp: [55, 86],
    pad: 48,
    padCut: 1250,
    padLvl: 1,
    flute: 0.65,
    fluteReg: [74, 90],
    bells: 0.12,
    drums: 0,
    density: 1,
    rest: [14, 26],
  },
  night: {
    modes: ['aeolian', 'dorian', 'aeolian'],
    roots: [57, 59, 62, 64],
    beat: [1.0, 1.15],
    progs: [[0, 5, 2, 6], [0, 3, 0, 6], [0, 6, 5, 4], [0, 2, 5, 3], [0, 5, 3, 4]],
    harp: [50, 81],
    pad: 45,
    padCut: 760,
    padLvl: 0.9,
    flute: 0.4,
    fluteReg: [69, 85],
    bells: 0.5,
    drums: 0,
    density: 0.62,
    rest: [18, 32],
  },
  tense: {
    modes: ['phrygian', 'aeolian'],
    roots: [50, 52, 53],
    beat: [0.66, 0.74],
    progs: [[0, 1, 0, 6], [0, 5, 1, 0], [0, 3, 1, 0], [0, 6, 5, 1]],
    harp: [43, 72],
    pad: 38,
    padCut: 520,
    padLvl: 0.85,
    flute: 0.2,
    fluteReg: [62, 77],
    bells: 0,
    drums: 1,
    density: 0.8,
    rest: [3, 6],
  },
};

// ---- instruments ---------------------------------------------------------------

// Karplus–Strong plucked string with a fractional-delay allpass for exact
// tuning, a softened noise excitation and a pluck-position comb for a hollow,
// harp-like tone. Low strings ring longer.
function harpSample(sr, midi) {
  return cached(`harp:${sr}:${midi}`, () => {
    const f = mtof(midi);
    const t60 = clamp(6.2 - (midi - 45) * 0.09, 1.3, 6.2);
    const dur = Math.min(5, t60 * 0.8 + 0.3);
    const len = Math.floor(dur * sr);
    const out = new Float32Array(len);
    const P = sr / f;
    const N = Math.max(2, Math.floor(P - 0.5));
    const frac = P - 0.5 - N;
    const C = (1 - frac) / (1 + frac);
    const rho = Math.pow(10, -3 / (t60 * f));
    const r = rng(1000 + midi * 17);
    const ex = new Float32Array(N);
    let lp = 0;
    const bright = clamp(0.6 - (midi - 60) * 0.006, 0.3, 0.75);
    for (let i = 0; i < N; i++) {
      lp += bright * (r() * 2 - 1 - lp);
      ex[i] = lp;
    }
    const pos = Math.max(1, Math.round(N * 0.14));
    const d = new Float32Array(N);
    let mean = 0;
    for (let i = 0; i < N; i++) {
      d[i] = ex[i] - (i >= pos ? ex[i - pos] * 0.85 : 0);
      mean += d[i];
    }
    mean /= N;
    for (let i = 0; i < N; i++) d[i] -= mean;
    let idx = 0,
      prev = 0,
      apx = 0,
      apy = 0;
    for (let n = 0; n < len; n++) {
      const cur = d[idx];
      out[n] = cur;
      const avg = 0.5 * (cur + prev);
      prev = cur;
      const ap = C * avg + apx - C * apy;
      apx = avg;
      apy = ap;
      d[idx] = ap * rho;
      if (++idx >= N) idx = 0;
    }
    // gentle one-pole low-pass: rounder, less "guitar"
    const k = clamp(0.35 + (midi - 50) * 0.012, 0.35, 0.85);
    let y = 0;
    for (let n = 0; n < len; n++) {
      y += k * (out[n] - y);
      out[n] = y;
    }
    const a = Math.floor(sr * 0.0025);
    for (let i = 0; i < a; i++) out[i] *= i / a;
    const fo = Math.floor(sr * 0.3);
    for (let i = 0; i < fo; i++) out[len - 1 - i] *= i / fo;
    let pk = 0;
    for (let n = 0; n < len; n++) pk = Math.max(pk, Math.abs(out[n]));
    const s = 0.6 / (pk || 1);
    for (let n = 0; n < len; n++) out[n] *= s;
    const buf = makeBuffer(1, len, sr);
    buf.copyToChannel(out, 0);
    return buf;
  });
}

function makeOut(c, bus) {
  const dry = gain(c, 1),
    wet = gain(c, 1);
  // keep the top end soft so long sessions never tire the ear
  link(dry, filt(c, 'highshelf', 4200, 0.7, -5), bus.in);
  wet.connect(bus.send);
  const mk = (send) => {
    const g = gain(c, 1);
    g.connect(dry);
    g.connect(gain(c, send)).connect(wet);
    return g;
  };
  return { dry, wet, harp: mk(0.5), pad: mk(0.8), lead: mk(0.6), bell: mk(0.95), perc: mk(0.25) };
}

// ---- composer --------------------------------------------------------------------

class Composer {
  constructor(r, moodFn) {
    this.r = r;
    this.moodFn = moodFn;
    this.piece = null;
    this.cursor = 0;
    this.restEnd = 0;
    this.live = []; // {src, t0} for cancelling not-yet-started notes
    this.sustains = []; // {g, end} pads / drones to fade on interrupt
    this.keys = {};
    this.pieces = 0;
  }

  reg(src, t0) {
    this.live.push({ src, t0 });
    return src;
  }

  note(P, deg, octave = 0) {
    const m = MODES[P.mode];
    const o = Math.floor(deg / 7);
    const i = ((deg % 7) + 7) % 7;
    return P.root + m[i] + 12 * (o + octave);
  }

  compose(t) {
    const r = this.r;
    const mood = this.moodFn();
    const M = MOODS[mood];
    const mode = pick(r, M.modes);
    const progs = mode === 'lydian' && M.lydianProgs ? M.lydianProgs : M.progs;
    const prog = pick(r, progs);
    const reps = mood === 'tense' ? 2 : r() < 0.55 ? 2 : 1;
    const chords = [];
    for (let k = 0; k < reps; k++) chords.push(...prog);
    if (reps === 2 && mood === 'day' && r() < 0.4) chords[chords.length - 2] = pick(r, [3, 5]);
    if (mood !== 'tense' && chords[chords.length - 1] !== 0 && r() < 0.6) chords.push(0);
    if (this.keys[mood] == null || r() < 0.3) this.keys[mood] = pick(r, M.roots);
    const beat = rr(r, M.beat[0], M.beat[1]);
    const P = { mood, M, mode, root: this.keys[mood], beat, bar: beat * 4, chords, barIdx: 0, nBars: chords.length * 2, t0: t, ending: false };
    if (chords.length >= 4 && r() < M.flute) {
      P.fluteAt = 1 + Math.floor(r() * Math.max(1, chords.length - 3));
      P.fluteLen = Math.min(2, chords.length - P.fluteAt - 1) || 1;
    }
    this.pieces++;
    return P;
  }

  // Stop everything that has not started yet and fade what is sounding.
  interrupt(now, fade = 1.2) {
    for (const e of this.live) {
      if (e.t0 > now + 0.02) {
        try {
          e.src.stop(now);
        } catch {
          /* already stopped */
        }
      }
    }
    for (const s of this.sustains) {
      if (s.end <= now) continue;
      const p = s.g.gain;
      const v = p.value;
      p.cancelScheduledValues(now);
      p.setValueAtTime(v, now);
      p.setTargetAtTime(0, now, fade / 3);
    }
    this.live = [];
    this.sustains = [];
    this.piece = null;
    this.cursor = now + 0.05;
    this.restEnd = now + fade + 0.4;
  }

  prune(now) {
    if (this.live.length > 64) this.live = this.live.filter((e) => e.t0 > now - 0.05);
    if (this.sustains.length > 8) this.sustains = this.sustains.filter((s) => s.end > now);
  }

  schedule(c, out, until) {
    let guard = 0;
    while (this.cursor < until && guard++ < 8) {
      if (!this.piece) {
        if (this.restEnd > this.cursor) {
          if (this.restEnd > until) return;
          this.cursor = this.restEnd;
        }
        this.piece = this.compose(this.cursor);
        continue;
      }
      const P = this.piece;
      this.bar(c, out, P, this.cursor);
      this.cursor += P.bar;
      P.barIdx++;
      if (P.barIdx >= P.nBars || (P.ending && P.barIdx % 2 === 0)) {
        this.piece = null;
        this.restEnd = this.cursor + P.bar * 0.75 + rr(this.r, P.M.rest[0], P.M.rest[1]);
      }
    }
  }

  // ---- one bar -------------------------------------------------------------------
  bar(c, out, P, t) {
    const r = this.r;
    const M = P.M;
    const ci = Math.floor(P.barIdx / 2);
    const half = P.barIdx % 2;
    const lastChord = ci === P.chords.length - 1;
    if (half === 0) {
      const deg = P.chords[ci];
      const seventh = P.mood !== 'tense' && r() < 0.45;
      const add9 = !seventh && r() < 0.3;
      const degs = [deg, deg + 2, deg + 4];
      if (seventh) degs.push(deg + 6);
      if (add9) degs.push(deg + 8);
      P.cur = { deg, degs };
      const padDur = P.bar * 2 + (lastChord ? P.bar * 1.2 : 0.6);
      this.pad(c, out, t, padDur, this.voicing(P, degs), P);
      if (P.mood === 'tense' && ci === 0) this.drone(c, out, t, P.nBars * P.bar + 1, P);
    }
    // harp
    const tones = this.harpTones(P, P.cur.degs.slice(0, 3).concat(P.cur.degs.length > 3 && r() < 0.5 ? [P.cur.degs[3]] : []));
    let kind;
    if (P.mood === 'tense') kind = 'ostinato';
    else if (lastChord && half === 1) kind = 'final';
    else if (P.barIdx === 0) kind = pick(r, ['roll', 'sparse']);
    else if (r() < 0.12 && P.barIdx > 2) kind = 'rest';
    else kind = pick(r, P.mood === 'night' ? ['sparse', 'sparse', 'arp', 'roll', 'broken'] : ['arp', 'arp', 'wave', 'broken', 'sparse', 'roll']);
    this.harpBar(c, out, t, P, tones, kind);
    if (P.mood === 'tense' && r() < 0.35) this.harpBar(c, out, t, P, this.harpTones(P, P.cur.degs.slice(0, 3), 12), 'sparse');
    // lead
    if (P.fluteAt === ci && half === 0) this.flute(c, out, t + P.beat * pick(r, [0, 0.5, 1]), P, P.fluteLen * 2);
    // bells
    if (M.bells && r() < M.bells * 0.5) this.bell(c, out, t + P.beat * Math.floor(r() * 8) * 0.5, P);
    // drums
    if (M.drums) this.drums(c, out, t, P);
  }

  voicing(P, degs) {
    const M = P.M;
    const pcRoot = (P.root + MODES[P.mode][((degs[0] % 7) + 7) % 7]) % 12;
    const bass = M.pad + (((pcRoot - M.pad) % 12) + 12) % 12;
    const center = M.pad + 19;
    const notes = [bass];
    for (const d of degs.slice(1)) {
      let m = this.note(P, d);
      while (m < center - 6) m += 12;
      while (m > center + 6) m -= 12;
      if (!notes.includes(m)) notes.push(m);
    }
    return notes;
  }

  harpTones(P, degs, shift = 0) {
    const [lo, hi] = P.M.harp;
    const out = [];
    for (let o = -3; o <= 3; o++) {
      for (const d of degs) {
        const m = this.note(P, d, o) + shift;
        if (m >= lo + shift && m <= hi + shift && !out.includes(m)) out.push(m);
      }
    }
    return out.sort((a, b) => a - b);
  }

  // ---- harp ------------------------------------------------------------------------
  pluck(c, out, t, midi, vel, pan = 0, damp = 0) {
    const buf = harpSample(c.sampleRate, Math.round(midi));
    const s = c.createBufferSource();
    s.buffer = buf;
    const g = gain(c, vel * 0.32);
    if (damp) env(g.gain, t, [[0, vel * 0.32], [damp, vel * 0.32], [damp + 0.12, 0]]);
    link(s, g, panNode(c, pan), out.harp);
    s.start(t);
    this.reg(s, t);
  }

  harpBar(c, out, t, P, tones, kind) {
    const r = this.r;
    const e = P.beat / 2;
    const n = tones.length;
    if (!n) return;
    const hum = () => rr(r, -0.012, 0.012);
    const vel = (i) => (i === 0 ? 0.95 : i % 4 === 0 ? 0.75 : rr(r, 0.45, 0.65));
    const panOf = (m) => clamp((m - 66) / 26, -0.6, 0.6);
    const dens = P.M.density;
    const lowIdx = Math.max(0, Math.floor(n * 0.15));
    if (kind === 'rest') return;
    if (kind === 'roll' || kind === 'final') {
      const start = lowIdx;
      const cnt = Math.min(n - start, kind === 'final' ? 6 : 4 + Math.floor(r() * 2));
      const strum = rr(r, 0.04, 0.07);
      for (let i = 0; i < cnt; i++) {
        const m = tones[start + i];
        this.pluck(c, out, t + i * strum + hum(), m, (0.85 - i * 0.06) * (kind === 'final' ? 0.9 : 1), panOf(m));
      }
      if (kind === 'roll' && r() < 0.7) {
        const m = tones[Math.min(n - 1, start + cnt + Math.floor(r() * 2))];
        this.pluck(c, out, t + e * 4 + hum(), m, 0.55, panOf(m));
      }
      return;
    }
    if (kind === 'sparse') {
      const k = 2 + Math.floor(r() * 3);
      const used = new Set();
      for (let i = 0; i < k; i++) {
        let slot = i === 0 ? 0 : Math.floor(r() * 8);
        if (used.has(slot)) continue;
        used.add(slot);
        const m = tones[Math.min(n - 1, lowIdx + Math.floor(r() * (n - lowIdx)))];
        this.pluck(c, out, t + slot * e + hum(), m, slot === 0 ? 0.8 : rr(r, 0.45, 0.65), panOf(m));
      }
      return;
    }
    if (kind === 'ostinato') {
      // damped low pulse: root, root, fifth … with a darker passing tone
      const root = tones[0];
      const fifth = tones.find((m) => m - root === 7) ?? tones[Math.min(n - 1, 2)];
      const pat = pick(r, [[0, 0, 1, 0, 0, 1, 0, 2], [0, -1, 0, 1, 0, -1, 0, 1], [0, 0, 1, 0, 2, 0, 1, 0]]);
      for (let i = 0; i < 8; i++) {
        if (pat[i] < 0) continue;
        const m = pat[i] === 0 ? root : pat[i] === 1 ? fifth : root + 12;
        this.pluck(c, out, t + i * e + hum(), m, i === 0 ? 0.85 : i === 4 ? 0.65 : 0.45, -0.15, e * 0.8);
      }
      return;
    }
    // arp / wave / broken
    let idx = lowIdx + Math.floor(r() * Math.min(3, n - lowIdx));
    const seq = [];
    if (kind === 'broken') {
      for (const s of [0, 2, 4, 5, 3, 4, 6, 5]) seq.push(Math.min(n - 1, lowIdx + s));
    } else {
      let dir = 1;
      for (let i = 0; i < 8; i++) {
        seq.push(Math.max(0, Math.min(n - 1, idx)));
        if (kind === 'wave' && i === 3) dir = -1;
        idx += dir * (r() < 0.2 ? 2 : 1);
        if (idx >= n) {
          idx = n - 2;
          dir = -1;
        }
      }
    }
    for (let i = 0; i < 8; i++) {
      if (i > 0 && i % 2 === 1 && r() > dens) continue;
      if (i > 0 && r() < 0.06) continue;
      const m = tones[seq[i]];
      this.pluck(c, out, t + i * e + hum(), m, vel(i), panOf(m));
    }
  }

  // ---- pad / drone -----------------------------------------------------------------
  pad(c, out, t, dur, notes, P) {
    const r = this.r;
    const M = P.M;
    const atk = Math.min(2.2, dur * 0.3);
    const rel = 2.4;
    const lvl = (0.06 * M.padLvl) / Math.sqrt(notes.length);
    const g = gain(c, 0);
    env(g.gain, t, [[0, 0], [atk, lvl], [dur - 0.2, lvl * 0.8], [dur + rel, 0]]);
    const lp = filt(c, 'lowpass', M.padCut, 0.6);
    env(lp.frequency, t, [[0, M.padCut * 0.6], [dur * 0.5, M.padCut], [dur + rel, M.padCut * 0.5]]);
    link(lp, g, out.pad);
    const L = panNode(c, -0.55),
      R = panNode(c, 0.55);
    L.connect(lp);
    R.connect(lp);
    for (const m of notes) {
      const f = mtof(m);
      for (const [type, det, dest, a] of [['sawtooth', -7, L, 0.5], ['sawtooth', 7, R, 0.5], ['triangle', 0, lp, 0.9]]) {
        const o = osc(c, type, f, t, dur + rel + 0.05);
        o.detune.value = det + rr(r, -2, 2);
        link(o, gain(c, a), dest);
        this.reg(o, t);
      }
    }
    this.sustains.push({ g, end: t + dur + rel });
  }

  drone(c, out, t, dur, P) {
    const root = P.M.pad + ((((P.root - P.M.pad) % 12) + 12) % 12) - 12;
    const g = gain(c, 0);
    env(g.gain, t, [[0, 0], [4, 0.05], [dur, 0.05], [dur + 4, 0]]);
    const lp = filt(c, 'lowpass', 240, 0.8);
    link(lp, g, out.pad);
    for (const [m, det] of [[root, -5], [root, 5], [root + 7, 0]]) {
      const o = osc(c, 'sawtooth', mtof(m), t, dur + 4.1);
      o.detune.value = det;
      link(o, gain(c, m === root ? 0.5 : 0.3), lp);
      this.reg(o, t);
    }
    this.sustains.push({ g, end: t + dur + 4 });
  }

  // ---- lead ------------------------------------------------------------------------
  flute(c, out, t, P, bars) {
    const r = this.r;
    const [lo, hi] = P.M.fluteReg;
    const pool = [];
    for (let o = -2; o <= 3; o++) for (const d of PENTA_DEG[P.mode]) {
      const m = this.note(P, d, o);
      if (m >= lo && m <= hi && !pool.includes(m)) pool.push(m);
    }
    pool.sort((a, b) => a - b);
    if (pool.length < 3) return;
    const b = P.beat;
    const total = bars * 4 - 1.5;
    let pos = 0;
    let idx = Math.floor(pool.length * rr(r, 0.35, 0.6));
    const notes = [];
    while (pos < total - 1) {
      const d = pick(r, [1, 1, 1.5, 2, 2, 3]);
      if (pos + d > total) break;
      notes.push({ m: pool[idx], at: pos * b, len: d * b });
      pos += d;
      if (r() < 0.15) pos += 0.5;
      idx = clamp(idx + pick(r, [-2, -1, -1, 0, 1, 1, 2]), 0, pool.length - 1);
    }
    if (notes.length < 2) return;
    // land on a chord tone, held
    const chordPcs = P.cur.degs.map((d) => ((this.note(P, d) % 12) + 12) % 12);
    const last = notes[notes.length - 1];
    let best = last.m,
      bd = 99;
    for (const m of pool) if (chordPcs.includes(m % 12) && Math.abs(m - last.m) < bd) (bd = Math.abs(m - last.m)), (best = m);
    last.m = best;
    last.len = Math.max(last.len, 2 * b);
    const end = last.at + last.len;
    const f0 = mtof(notes[0].m);
    const o1 = osc(c, 'sine', f0, t, end + 0.6);
    const o2 = osc(c, 'triangle', f0, t, end + 0.6);
    const o3 = osc(c, 'sine', f0 * 2, t, end + 0.6);
    for (const o of [o1, o2, o3]) this.reg(o, t);
    const vib = osc(c, 'sine', rr(r, 4.6, 5.4), t, end + 0.6);
    const vg = gain(c, 0);
    link(vib, vg);
    vg.connect(o1.frequency);
    vg.connect(o2.frequency);
    link(vg, gain(c, 2), o3.frequency);
    const g = gain(c, 0);
    const lvl = 0.085;
    link(o1, g);
    link(o2, gain(c, 0.22), g);
    link(o3, gain(c, 0.06), g);
    const breath = gain(c, 0);
    link(noise(c, 'pink', t, end + 0.6, { r }), filt(c, 'bandpass', 2000, 0.9), breath);
    const gp = [[0, 0]];
    const bp = [[0, 0]];
    const vp = [[0, 0]];
    notes.forEach((nt, i) => {
      const f = mtof(nt.m);
      const at = nt.at;
      // legato glide into each note (setTarget only: never a ramp after a target)
      for (const o of [o1, o2]) (i === 0 ? o.frequency.setValueAtTime(f, t) : o.frequency.setTargetAtTime(f, t + at, 0.03));
      i === 0 ? o3.frequency.setValueAtTime(f * 2, t) : o3.frequency.setTargetAtTime(f * 2, t + at, 0.03);
      gp.push([at, lvl * (i === 0 ? 0 : 0.6), i === 0 ? 0.01 : 0.012], [at + 0.03, lvl, i === 0 ? 0.08 : 0.05]);
      bp.push([at, 0.05, 0.03], [at + 0.12, 0.012, 0.15]);
      vp.push([at, 0, 0.05], [at + Math.min(0.45, nt.len * 0.5), f * 0.0055, 0.25]);
    });
    gp.push([end - 0.15, 0, 0.12]);
    bp.push([end - 0.15, 0, 0.1]);
    env(g.gain, t, gp);
    env(breath.gain, t, bp);
    env(vg.gain, t, vp);
    link(g, filt(c, 'lowpass', 3600, 0.6), out.lead);
    breath.connect(out.lead);
  }

  bell(c, out, t, P) {
    const r = this.r;
    const pool = PENTA_DEG[P.mode].map((d) => this.note(P, d, 2)).filter((m) => m <= 98);
    const m = pick(r, pool);
    const f = mtof(m);
    const car = osc(c, 'sine', f, t, 3.2);
    const mod = osc(c, 'sine', f * 3.5, t, 3.2);
    const mg = gain(c, 0);
    env(mg.gain, t, [[0, 0], [0.004, f * 1.6], [0.004, 0, 0.35]]);
    link(mod, mg, car.frequency);
    const g = gain(c, 0);
    env(g.gain, t, [[0, 0], [0.004, 0.045], [0.004, 0, 0.7]]);
    link(car, g, panNode(c, rr(r, -0.6, 0.6)), out.bell);
    this.reg(car, t);
    this.reg(mod, t);
  }

  drums(c, out, t, P) {
    const r = this.r;
    const b = P.beat;
    const hits = [[0, 0.9, 1], [2, 0.6, 1]];
    if (r() < 0.6) hits.push([3.5, 0.3, 0]);
    if (r() < 0.4) hits.push([1.5, 0.28, 0]);
    if (P.barIdx % 4 === 3 && r() < 0.6) hits.push([3, 0.45, 1], [3.75, 0.3, 0]);
    for (const [beat, v, low] of hits) {
      const at = t + beat * b + rr(r, -0.008, 0.008);
      const o = osc(c, 'sine', 90, at, 1.2);
      env(o.frequency, at, [[0, low ? 92 : 150], [0.09, low ? 52 : 96, 'e']]);
      const g = gain(c, 0);
      env(g.gain, at, [[0, 0], [0.004, v * 0.34], [0.004, 0, low ? 0.2 : 0.08]]);
      link(o, g, out.perc);
      const s = noise(c, 'pink', at, 0.25, { r });
      const sg = gain(c, 0);
      env(sg.gain, at, [[0, 0], [0.002, v * 0.08], [0.002, 0, 0.025]]);
      link(s, filt(c, 'lowpass', low ? 700 : 1600, 0.7), sg, out.perc);
      this.reg(o, at);
      this.reg(s, at);
    }
  }
}

// ---- the music system -----------------------------------------------------------

export class Music {
  constructor(audio) {
    this.audio = audio;
    this.game = audio.game;
    this.tension = 0;
    this.c = null;
    this.comp = null;
  }

  start(c, mix) {
    this.c = c;
    this.out = makeOut(c, mix.buses.music);
    this.comp = new Composer(rng((Math.random() * 2 ** 31) | 0), () => this.moodNow());
    this.comp.cursor = c.currentTime + 0.1;
    this.comp.restEnd = c.currentTime + rr(Math.random, 3, 6);
    // warm the harp cache for the common registers in the background
    this._warm = [];
    for (let m = 43; m <= 90; m++) this._warm.push(m);
  }

  onNotify(n) {
    if (!n) return;
    if (n.kind === 'war') this.tension = Math.max(this.tension, 0.85);
    else if (n.kind === 'disaster') this.tension = Math.max(this.tension, 1);
  }

  moodNow() {
    if (this.tension > 0.5) return 'tense';
    const d = this.game.env?.daylight ?? 1;
    return d > 0.4 ? 'day' : 'night';
  }

  update(dt) {
    if (!this.c) return;
    if (this._warm.length) harpSample(this.c.sampleRate, this._warm.shift());
    this.tension = Math.max(0, this.tension - dt / 80);
    const now = this.c.currentTime;
    const comp = this.comp;
    if (comp.piece) {
      if (this.tension > 0.5 && comp.piece.mood !== 'tense') comp.interrupt(now, 1.5);
      else if (this.tension < 0.25 && comp.piece.mood === 'tense') comp.piece.ending = true;
    } else if (this.tension > 0.5 && comp.restEnd > now + 1.5) comp.restEnd = now + 1.0;
    if (comp.cursor < now) comp.cursor = now + 0.05;
    comp.schedule(this.c, this.out, now + 1.0);
    comp.prune(now);
  }

  reset() {
    /* music carries on across world regeneration */
  }

  renderDebug(oc, mix, mood, seconds, opts = {}) {
    const out = makeOut(oc, mix.buses.music);
    const m = MOODS[mood] ? mood : 'day';
    const comp = new Composer(rng(opts.seed ?? 5), () => m);
    comp.cursor = 0.1;
    comp.restEnd = 0.1;
    comp.schedule(oc, out, seconds - 2);
    for (const g of [out.dry.gain, out.wet.gain]) env(g, 0, [[0, 1], [seconds - 1.5, 1], [seconds - 0.05, 0]]);
  }

  debugInfo() {
    const p = this.comp?.piece;
    return { tension: Math.round(this.tension * 100) / 100, mood: p?.mood || 'rest', mode: p?.mode, bar: p ? `${p.barIdx}/${p.nBars}` : null, pieces: this.comp?.pieces || 0 };
  }
}
