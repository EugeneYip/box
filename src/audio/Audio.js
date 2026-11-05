// Worldseed audio — procedural WebAudio sound design (no audio files).
//
// PUBLIC CONTRACT (other modules call these; keep signatures stable):
//   game.audio.play(name, opts?)  one-shot sound. opts: { pos:{x,z}, volume=1, pitch=1 }
//     names: 'ui-click' 'ui-hover' 'ui-open' 'raise' 'lower' 'paint' 'plant'
//            'splash' 'explosion' 'thunder' 'fire-start' 'meteor' 'quake'
//            'build' 'chop' 'mine' 'hit' 'death' 'birth' 'spawn' 'magic'
//            'war-horn' 'bell' 'coin' 'growl' 'bleat' 'error'
//     Unknown names are ignored. Returns true when the sound was started.
//   game.audio.setMuted(bool), game.audio.setVolume(0..1)
// Never throws. Before the first user gesture (pointerdown / keydown / touch)
// there is no AudioContext and play() calls are dropped; the context is
// created and unlocked by that gesture. ?audio=0 disables audio entirely.
//
// Additive helpers (optional, for a settings panel):
//   game.audio.muted, game.audio.volume            current state (read-only use)
//   game.audio.toggleMuted()
//   game.audio.setBusVolume('sfx'|'ambience'|'music', 0..1), getBusVolume(name)
//   game.audio.unlocked                            true once sound can play
// Debug / measurement:
//   await game.audio.debugRender(name, seconds?, opts?)  renders offline through
//     the real mix chain. name: an SFX name, 'amb:<surf|wind|rain|fire|crickets|
//     murmur|birds|owl|gull|...>' or 'music:<day|night|tense>'. Resolves to
//     { sampleRate, channels:[Float32Array,…], metrics:{peakDb, rmsDb, …} }.
//   game.audio.debugStats()   voices, drops, bank, ambience and music state.
//
// Files: dsp.js (synthesis toolkit), sfx.js (SFX recipes, baked offline into
// variants), mixer.js (buses, reverb, compressor, limiter), ambience.js
// (scene-adaptive beds and events), music.js (generative composer),
// analysis.js (measurement, debug only).
import { SFX } from './sfx.js';
import { buildMixer, setBusLevel, duckBus, BUS_NAMES } from './mixer.js';
import { Ambience } from './ambience.js';
import { Music } from './music.js';
import { rng, hashStr, clamp, lerp, smoothstep, dbToGain, makeBuffer, gain, filt, panNode, link } from './dsp.js';

const PREF_KEY = 'worldseed.audio.v1';
const MAX_VOICES = 32;
const GESTURES = ['pointerdown', 'pointerup', 'keydown', 'touchend', 'mousedown'];
// bake order: what the player hears first comes first
const BAKE_FIRST = ['ui-click', 'ui-hover', 'ui-open', 'error', 'paint', 'raise', 'lower', 'plant', 'splash', 'spawn'];

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    return raw ? JSON.parse(raw) || {} : {};
  } catch {
    return {};
  }
}

// ---- baked SFX variants ---------------------------------------------------------
class Bank {
  constructor() {
    this.sets = new Map(); // `${sr}:${name}` -> AudioBuffer[]
    this.jobs = new Map(); // same key -> Promise
    this.queue = null;
    this.busy = false;
    this.bytes = 0;
  }
  get(name, sr) {
    return this.sets.get(`${sr}:${name}`) || null;
  }
  ensure(name, sr) {
    const key = `${sr}:${name}`;
    if (this.sets.has(key)) return Promise.resolve(this.sets.get(key));
    let job = this.jobs.get(key);
    if (!job) {
      job = this.bake(name, sr).then(
        (bufs) => {
          this.sets.set(key, bufs);
          this.jobs.delete(key);
          return bufs;
        },
        (err) => {
          this.jobs.delete(key);
          throw err;
        },
      );
      this.jobs.set(key, job);
    }
    return job;
  }
  // Bake everything, one sound at a time, without blocking the frame loop.
  pump(sr) {
    if (this.busy) return;
    if (!this.queue) this.queue = [...new Set([...BAKE_FIRST, ...Object.keys(SFX)])];
    const next = this.queue.find((n) => !this.sets.has(`${sr}:${n}`));
    if (!next) return;
    this.busy = true;
    this.ensure(next, sr)
      .catch(() => this.queue.splice(this.queue.indexOf(next), 1))
      .finally(() => (this.busy = false));
  }
  async bake(name, sr) {
    const def = SFX[name];
    const n = def.variants || 3;
    const ch = def.stereo ? 2 : 1;
    // rumble-heavy sounds carry nothing near Nyquist: bake them at a lower
    // rate (half the memory); the buffer source resamples on playback
    const bsr = def.sr ? Math.min(sr, def.sr) : sr;
    const jobs = [];
    for (let v = 0; v < n; v++) {
      const oc = new OfflineAudioContext(ch, Math.ceil((def.dur + 0.01) * bsr), bsr);
      // remove any DC / infrasonic offset the recipe might produce
      const hp = filt(oc, 'highpass', 20, 0.6);
      hp.connect(oc.destination);
      def.fn(oc, hp, 0.002, rng(hashStr(name) + v * 7919), v);
      jobs.push(oc.startRendering());
    }
    const rendered = await Promise.all(jobs);
    return rendered.map((rb) => this.finish(rb, def));
  }
  // Trim the silent tail, fade the last milliseconds, normalise the peak.
  finish(rb, def) {
    const sr = rb.sampleRate;
    const chs = [];
    for (let c = 0; c < rb.numberOfChannels; c++) chs.push(rb.getChannelData(c));
    let peak = 0;
    for (const d of chs) for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    if (!(peak > 0)) peak = 1;
    const thr = peak * 2.5e-4; // -72 dB re peak
    let end = chs[0].length;
    outer: while (end > 1) {
      for (const d of chs) if (Math.abs(d[end - 1]) > thr) break outer;
      end--;
    }
    end = Math.min(chs[0].length, end + Math.floor(sr * 0.01));
    const k = dbToGain(def.peak) / peak;
    const buf = makeBuffer(chs.length, end, sr);
    const fade = Math.min(Math.floor(end / 4), Math.floor(sr * 0.012));
    chs.forEach((d, c) => {
      const out = new Float32Array(end);
      for (let i = 0; i < end; i++) out[i] = d[i] * k;
      for (let i = 0; i < fade; i++) out[end - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fade);
      buf.copyToChannel(out, c);
    });
    this.bytes += end * chs.length * 4;
    return buf;
  }
}

// ---- pooled voice chain (lowpass → pan → dry/wet) -------------------------------
class Voice {
  constructor(c, bus) {
    this.c = c;
    this.filter = filt(c, 'lowpass', 20000, 0.5);
    this.pan = panNode(c, 0);
    this.dry = gain(c, 1);
    this.wet = gain(c, 0);
    link(this.filter, this.pan, this.dry, bus.in);
    this.pan.connect(this.wet).connect(bus.send);
    this.src = null;
    this.env = null;
    this.name = '';
    this.pri = 0;
    this.t0 = 0;
    this.t1 = 0;
  }
  busy(now) {
    return !!this.src && now < this.t1;
  }
  start(buf, rate, vol, pan, cut, wet, now, name, pri) {
    let t = now + 0.004;
    if (this.src && now < this.t1) {
      // stealing: fade the old sound, then switch the chain over
      this.stop(now, 0.012);
      t = now + 0.016;
    }
    for (const [p, v] of [[this.filter.frequency, cut], [this.pan.pan, pan], [this.wet.gain, wet]]) {
      p.cancelScheduledValues(now);
      p.setValueAtTime(v, t - 0.002);
    }
    const s = this.c.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate;
    // equal-power panning drops a centred mono source by 3 dB; compensate so
    // mono and stereo variants share one level scale
    const e = gain(this.c, buf.numberOfChannels === 1 ? vol * Math.SQRT2 : vol);
    link(s, e, this.filter);
    s.onended = () => {
      try {
        s.disconnect();
        e.disconnect();
      } catch {
        /* already gone */
      }
      if (this.src === s) this.src = this.env = null;
    };
    s.start(t);
    this.src = s;
    this.env = e;
    this.name = name;
    this.pri = pri;
    this.t0 = now;
    this.t1 = t + buf.duration / rate;
  }
  stop(now, fade = 0.012) {
    const s = this.src,
      e = this.env;
    if (!s) return;
    e.gain.cancelScheduledValues(now);
    e.gain.setValueAtTime(e.gain.value, now);
    e.gain.linearRampToValueAtTime(0, now + fade);
    try {
      s.stop(now + fade + 0.004);
    } catch {
      /* not started */
    }
    this.src = this.env = null;
  }
}

export class AudioSystem {
  constructor(game) {
    this.game = game;
    const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
    this.supported = !!AC && typeof OfflineAudioContext !== 'undefined';
    this.enabled = game.params?.audio !== false && this.supported;
    const p = this.enabled ? loadPrefs() : {};
    this.volume = clamp(Number.isFinite(p.volume) ? p.volume : 0.8, 0, 1);
    this.muted = game.params?.audio === false ? true : !!p.muted;
    this.busVolumes = { sfx: 1, ambience: 1, music: 1 };
    for (const b of BUS_NAMES) if (Number.isFinite(p.buses?.[b])) this.busVolumes[b] = clamp(p.buses[b], 0, 1);
    this.ctx = null;
    this.mix = null;
    this.voices = [];
    this.bank = new Bank();
    this.ambience = new Ambience(this);
    this.music = new Music(this);
    this.hidden = typeof document !== 'undefined' && document.hidden;
    this.lastError = null;
    this._count = { played: 0, dropped: 0, stolen: 0, culled: 0, throttled: 0, early: 0, pending: 0 };
    this._last = new Map();
    this._lastVar = new Map();
    this._autoThunder = null;
    this._prevLight = 0;
    this._listening = false;
    this._gesture = () => this.unlock();
    if (this.enabled) {
      for (const ev of GESTURES) addEventListener(ev, this._gesture, { capture: true, passive: true });
      this._listening = true;
      document.addEventListener('visibilitychange', () => this._onVisibility());
    }
    game.events?.on?.('notify', (n) => this.music.onNotify(n));
  }

  get unlocked() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  // ---- lifecycle -----------------------------------------------------------------
  unlock() {
    if (!this.enabled) return;
    try {
      if (!this.ctx) this._init();
      if (this.ctx && this.ctx.state !== 'running' && !this.hidden) this.ctx.resume().catch(() => {});
    } catch (err) {
      this.lastError = err;
      this.enabled = false;
    }
  }

  _init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    try {
      this.ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      this.ctx = new AC();
    }
    const c = this.ctx;
    this.mix = buildMixer(c, { volume: 0, buses: this.busVolumes });
    for (let i = 0; i < MAX_VOICES; i++) this.voices.push(new Voice(c, this.mix.buses.sfx));
    this.ambience.start(c, this.mix);
    this.music.start(c, this.mix);
    this._applyMaster(0.6); // gentle fade-in on first unlock
    this.bank.pump(c.sampleRate);
  }

  _removeListeners() {
    for (const ev of GESTURES) removeEventListener(ev, this._gesture, { capture: true });
    this._listening = false;
  }

  _onVisibility() {
    this.hidden = document.hidden;
    if (!this.ctx) return;
    try {
      this._applyMaster(0.08);
      if (this.hidden) {
        setTimeout(() => {
          if (this.hidden && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
        }, 450);
      } else if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    } catch (err) {
      this.lastError = err;
    }
  }

  _applyMaster(tc = 0.05) {
    if (!this.mix) return;
    const target = this.muted || this.hidden ? 0 : this.volume * this.volume;
    this.mix.out.gain.setTargetAtTime(target, this.ctx.currentTime, tc);
  }

  _save() {
    if (!this.enabled) return;
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ muted: this.muted, volume: this.volume, buses: this.busVolumes }));
    } catch {
      /* storage blocked */
    }
  }

  // ---- public controls -------------------------------------------------------------
  setMuted(m) {
    this.muted = !!m;
    this._save();
    try {
      this._applyMaster(0.05);
    } catch (err) {
      this.lastError = err;
    }
  }
  toggleMuted() {
    this.setMuted(!this.muted);
    return this.muted;
  }
  setVolume(v) {
    v = Number(v);
    if (!Number.isFinite(v)) return;
    this.volume = clamp(v, 0, 1);
    this._save();
    try {
      this._applyMaster(0.05);
    } catch (err) {
      this.lastError = err;
    }
  }
  setBusVolume(name, v) {
    v = Number(v);
    if (!BUS_NAMES.includes(name) || !Number.isFinite(v)) return;
    this.busVolumes[name] = clamp(v, 0, 1);
    this._save();
    try {
      if (this.mix) setBusLevel(this.mix, name, this.busVolumes[name]);
    } catch (err) {
      this.lastError = err;
    }
  }
  getBusVolume(name) {
    return this.busVolumes[name] ?? 1;
  }

  // ---- one-shots -------------------------------------------------------------------
  play(name, opts) {
    if (!this.enabled || !this.ctx) {
      this._count.early++;
      return false;
    }
    try {
      return this._play(name, opts || {});
    } catch (err) {
      this.lastError = err;
      return false;
    }
  }

  _play(name, opts, retry = false) {
    const def = SFX[name];
    if (!def) return false;
    const c = this.ctx;
    if (c.state !== 'running') return false;
    if (name === 'thunder' && !opts._auto) this._autoThunder = null;
    const now = c.currentTime;
    if (now - (this._last.get(name) ?? -9) < def.gap) {
      this._count.throttled++;
      return false;
    }
    const sp = this._spatial(opts.pos, def);
    const v0 = Number(opts.volume ?? 1);
    let vol = (Number.isFinite(v0) ? clamp(v0, 0, 2) : 1) * sp.g;
    if (!(vol > 0.004)) {
      this._count.culled++;
      return false;
    }
    const bufs = this.bank.get(name, c.sampleRate);
    if (!bufs) {
      // first use before it is baked: bake it now and play it if still timely
      this._count.pending++;
      if (!retry) {
        const req = now;
        this.bank.ensure(name, c.sampleRate).then(() => {
          if (this.ctx.currentTime - req < 0.35) this._play(name, opts, true);
        }, () => {});
      }
      return false;
    }
    let vi = Math.floor(Math.random() * bufs.length);
    if (bufs.length > 1 && vi === this._lastVar.get(name)) vi = (vi + 1 + Math.floor(Math.random() * (bufs.length - 1))) % bufs.length;
    const p0 = Number(opts.pitch ?? 1);
    const rate = clamp(Number.isFinite(p0) ? p0 : 1, 0.25, 4) * (1 + (Math.random() * 2 - 1) * (def.pj ?? 0.04));
    vol *= dbToGain((Math.random() * 2 - 1) * (def.vj ?? 1));
    // many voices at once: each a little quieter so storms stay clean
    let active = 0;
    for (const v of this.voices) if (v.busy(now)) active++;
    vol /= Math.sqrt(1 + active * 0.05);
    const voice = this._alloc(def, name, now);
    if (!voice) {
      this._count.dropped++;
      return false;
    }
    voice.start(bufs[vi], rate, vol, sp.pan, sp.cut, def.wet ?? 0.1, now, name, def.pri ?? 1);
    this._last.set(name, now);
    this._lastVar.set(name, vi);
    this._count.played++;
    if ((def.pri ?? 0) >= 5 && vol > 0.25) {
      // let big moments breathe: dip the music and ambience briefly
      const d = clamp(vol, 0, 1);
      duckBus(this.mix, 'music', lerp(1, 0.45, d), Math.min(2, def.dur * 0.35), 2.5);
      duckBus(this.mix, 'ambience', lerp(1, 0.7, d), Math.min(1.5, def.dur * 0.3), 2);
    }
    return true;
  }

  _alloc(def, name, now) {
    let same = 0,
      oldestSame = null,
      free = null,
      victim = null;
    for (const v of this.voices) {
      if (!v.busy(now)) {
        if (!free) free = v;
        continue;
      }
      if (v.name === name) {
        same++;
        if (!oldestSame || v.t0 < oldestSame.t0) oldestSame = v;
      }
      if (!victim || v.pri < victim.pri || (v.pri === victim.pri && v.t0 < victim.t0)) victim = v;
    }
    if (same >= (def.max ?? 3)) {
      this._count.stolen++;
      return oldestSame;
    }
    if (free) return free;
    if (victim && victim.pri <= (def.pri ?? 1)) {
      this._count.stolen++;
      return victim;
    }
    return null;
  }

  // Gain, pan and muffling of a world position relative to the camera target.
  _spatial(pos, def) {
    const rig = this.game.cameraRig;
    if (!pos || def.ui || !rig) return { g: 1, pan: 0, cut: 20000 };
    const px = Number(pos.x),
      pz = Number(pos.z ?? pos.y);
    if (!Number.isFinite(px) || !Number.isFinite(pz)) return { g: 1, pan: 0, cut: 20000 };
    const dist = rig.cur.dist;
    const zt = clamp((dist - rig.minDist) / (rig.maxDist - rig.minDist), 0, 1);
    const dx = px - rig.target.x,
      dz = pz - rig.target.z;
    const yaw = rig.cur.yaw;
    const cy = Math.cos(yaw),
      sy = Math.sin(yaw);
    const right = dx * cy - dz * sy;
    const away = -(dx * sy + dz * cy); // + = up the screen, further from the lens
    const viewR = Math.max(10, dist * 0.62);
    const nd = Math.hypot(dx, dz) / (viewR * (def.range || 1));
    let g = 1 / (1 + 0.9 * nd * nd);
    if (nd > 1.4) g *= clamp(1 - (nd - 1.4) / 2.2, 0, 1);
    g *= 1 - 0.12 * clamp(away / viewR, -1, 1);
    // zoomed far out, local detail recedes
    g *= lerp(1, 0.25, Math.pow(zt, 0.8) * (def.zoom ?? 1));
    const pan = clamp(right / viewR, -1, 1) * 0.75;
    const muffle = smoothstep(0.8, 3, nd) * 0.85 + zt * 0.25 * (def.zoom ?? 1);
    const cut = 20000 * Math.pow(1500 / 20000, clamp(muffle, 0, 1));
    return { g, pan, cut };
  }

  // ---- per frame -------------------------------------------------------------------
  update(dt) {
    const c = this.ctx;
    if (!c) return;
    try {
      if (c.state !== 'running') return;
      if (this._listening) this._removeListeners();
      this._thunderWatch();
      this.ambience.update(dt);
      this.music.update(dt);
      this.bank.pump(c.sampleRate);
    } catch (err) {
      this.lastError = err;
    }
  }

  reset() {
    try {
      this.ambience.reset();
    } catch (err) {
      this.lastError = err;
    }
  }

  // Lightning flashes without a thunder call get a delayed, distant roll.
  _thunderWatch() {
    const env = this.game.env;
    const l = env?.lightning || 0;
    const now = this.ctx.currentTime;
    if (l > 0.45 && this._prevLight <= 0.45 && !this._autoThunder && now - (this._last.get('thunder') ?? -9) > 1.5) {
      this._autoThunder = { at: now + 0.6 + Math.random() * 1.8, vol: 0.45 + Math.random() * 0.45 };
    }
    this._prevLight = l;
    const a = this._autoThunder;
    if (a && now >= a.at) {
      this._autoThunder = null;
      const rig = this.game.cameraRig;
      const ang = Math.random() * Math.PI * 2;
      const d = Math.max(10, rig.cur.dist * 0.62) * (0.8 + Math.random());
      this._play('thunder', { volume: a.vol, pos: { x: rig.target.x + Math.cos(ang) * d, z: rig.target.z + Math.sin(ang) * d }, _auto: true });
    }
  }

  // ---- debug / measurement ---------------------------------------------------------
  async debugRender(name, seconds = null, opts = {}) {
    const sr = opts.sampleRate || this.ctx?.sampleRate || 48000;
    const def = SFX[name];
    const dur = seconds ?? (def ? def.dur + 0.5 : 12);
    // A fresh compressor/limiter starts in a gain-reduced state; give the
    // chain a silent lead-in so measurements match a long-running mix.
    const lead = 1.0;
    const oc = new OfflineAudioContext(2, Math.ceil((dur + lead) * sr), sr);
    const mix = buildMixer(oc, { volume: opts.volume ?? 1, buses: opts.buses || {}, reverb: opts.reverb !== false });
    const t0 = lead + 0.05;
    if (def) {
      if (opts.raw) {
        def.fn(oc, oc.destination, t0, rng(hashStr(name) + (opts.variant || 0) * 7919), opts.variant || 0);
      } else {
        const bufs = await this.bank.ensure(name, sr);
        const sp = opts.pos ? this._spatial(opts.pos, def) : { g: 1, pan: 0, cut: 20000 };
        const count = opts.count || 1;
        for (let i = 0; i < count; i++) {
          new Voice(oc, mix.buses.sfx).start(bufs[(opts.variant ?? i) % bufs.length], opts.pitch || 1, (opts.volume ?? 1) * sp.g, sp.pan, sp.cut, def.wet ?? 0.1, t0 + i * (opts.spacing ?? 0), name, def.pri);
        }
      }
    } else if (name.startsWith('amb:')) {
      await this.ambience.renderDebug(oc, mix, name.slice(4), dur, { ...opts, offset: lead });
    } else if (name.startsWith('music:')) {
      this.music.renderDebug(oc, mix, name.slice(6), dur, { ...opts, offset: lead });
    } else return null;
    const full = await oc.startRendering();
    const s0 = Math.floor(lead * sr);
    const out = makeBuffer(2, full.length - s0, sr);
    const channels = [];
    for (let i = 0; i < 2; i++) {
      const d = full.getChannelData(i).slice(s0);
      out.copyToChannel(d, i);
      channels.push(d);
    }
    const { analyze } = await import('./analysis.js');
    return { name, sampleRate: sr, channels, metrics: analyze(out) };
  }

  debugStats() {
    const now = this.ctx?.currentTime ?? 0;
    return {
      enabled: this.enabled,
      state: this.ctx?.state || 'none',
      sampleRate: this.ctx?.sampleRate || 0,
      muted: this.muted,
      volume: this.volume,
      buses: { ...this.busVolumes },
      voices: { active: this.voices.filter((v) => v.busy(now)).length, max: MAX_VOICES },
      counts: { ...this._count },
      bank: { baked: [...this.bank.sets.keys()].length, total: Object.keys(SFX).length, mb: Math.round((this.bank.bytes / 1048576) * 10) / 10 },
      ambience: this.ambience.debugInfo(),
      music: this.music.debugInfo(),
      lastError: this.lastError ? String(this.lastError.stack || this.lastError) : null,
    };
  }
}
