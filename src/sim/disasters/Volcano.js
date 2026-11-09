import * as THREE from 'three';
import { TILE, FLORA, FLORA_INFO, SEA_LEVEL, MAX_HEIGHT } from '../../world/constants.js';
import { hash2 } from '../../core/Random.js';
import { hurt, play, rand, smooth, honourSurvivors, yearLabel } from './util.js';
import { PF, DF, RAMP, TRAIL, sparks, glowFlash, smokePuff, dustPuff } from '../../render/fx/Effects.js';

// Volcano: the ground heaves up into a ridged cone with a crater, then it
// erupts: a lava fountain, glowing lava bombs that arc out and splash, a
// towering ash plume that drifts downwind with volcanic lightning, and
// TILE.LAVA pouring from the crater that the lava simulation carries downhill
// (cooling to rock, steaming into the sea, igniting forests).

export class Volcano {
  constructor(ds, x, z, radius = 9) {
    this.ds = ds;
    this.game = ds.game;
    const w = this.game.world;
    this.x = Math.floor(x) + 0.5;
    this.z = Math.floor(z) + 0.5;
    this.R = radius;
    this.t = 0;
    this.phase = 0; // 0 rise, 1 erupt, 2 wane
    this.riseT = 1.8;
    this.eruptT = 24;
    this.waneT = 9;
    this.seed = (Math.random() * 1e4) | 0;
    // capture the original ground and plan the cone
    this.tiles = [];
    let base = Infinity,
      top = -Infinity;
    w.forEachInRadius(this.x, this.z, radius, (tx, ty, d, i) => {
      base = Math.min(base, Math.max(w.height[i], SEA_LEVEL));
      top = Math.max(top, w.height[i]);
    });
    this.base = base;
    this.peak = Math.min(MAX_HEIGHT - 1, Math.max(top + 4, base + 9 + radius * 1.05));
    this.crater = 0.17;
    // 2-3 flank gullies the lava rivers will run down
    const ng = Math.random() < 0.5 ? 2 : 3;
    const a0 = Math.random() * Math.PI * 2;
    this.gullies = [];
    for (let k = 0; k < ng; k++) this.gullies.push(a0 + (k / ng) * Math.PI * 2 + rand(-0.35, 0.35));
    const angDist = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    w.forEachInRadius(this.x, this.z, radius, (tx, ty, d, i) => {
      const ang = Math.atan2(ty + 0.5 - this.z, tx + 0.5 - this.x);
      const gully = Math.sin(ang * 7 + hash2(tx, ty, this.seed) * 0.8) * 0.5 + (hash2(tx, ty, this.seed + 1) - 0.5) * 0.5;
      let c;
      if (d < this.crater) c = Math.pow(1 - this.crater, 1.3) - 0.12 * (1 - (d / this.crater) ** 2);
      else c = Math.pow(1 - d, 1.3);
      let target = base + (this.peak - base) * c + gully * d * (1 - d) * 1.6;
      // carve the lava gullies: a channel ~2 tiles wide down the flank
      if (d > this.crater * 0.8) {
        let best = Infinity;
        for (const ga of this.gullies) best = Math.min(best, angDist(ang, ga) * d * radius);
        if (best < 1.6) target -= (1 - best / 1.6) * 1.1 * (1 - d * 0.6);
      }
      // blend smoothly into the surrounding land
      target = Math.max(target, w.height[i]);
      this.tiles.push({ tx, ty, i, d, h0: w.height[i], h1: target });
    });
    this.cx = Math.floor(this.x);
    this.cz = Math.floor(this.z);
    this._acc = { bomb: 0, plume: 0, fount: 0, rise: 0, ash: 0, bolt: 0.45 };
    this._lastP = 0;
    this._lc = new THREE.Color(1, 0.42, 0.12);
    play(this.game, 'quake', { x, z }, 1, 0.7);
  }

  update(vt, dt) {
    if (vt <= 0) return true;
    const g = this.game;
    const fx = g.fx;
    const w = g.world;
    this.t += vt;
    const { x, z } = this;
    if (this.phase === 0) {
      const p = smooth(Math.min(1, this.t / this.riseT));
      if (p - this._lastP > 0.03 || p >= 1) {
        this._lastP = p;
        for (const T of this.tiles) {
          w.height[T.i] = T.h0 + (T.h1 - T.h0) * p;
          if (p > 0.3) {
            const fl = w.flora[T.i];
            if (fl && T.d < 0.85) {
              if (FLORA_INFO[fl].isTree && T.d > 0.55) this.ds.ignite(T.tx, T.ty, 0.8);
              else w.flora[T.i] = FLORA.NONE;
            }
            const hh = hash2(T.tx, T.ty, this.seed + 5);
            if (T.d < 0.55) w.type[T.i] = hh < 0.8 ? TILE.ROCK : TILE.ASH;
            else if (T.d < 0.85) w.type[T.i] = hh < 0.55 ? TILE.ASH : TILE.ROCK;
            else if (hh < 0.35 && w.type[T.i] !== TILE.SAND) w.type[T.i] = TILE.ASH;
          }
        }
        const r = Math.ceil(this.R) + 1;
        w.markDirty('height', this.cx - r, this.cz - r, this.cx + r, this.cz + r);
        w.markDirty('type', this.cx - r, this.cz - r, this.cx + r, this.cz + r);
        w.markDirty('flora', this.cx - r, this.cz - r, this.cx + r, this.cz + r);
      }
      fx.shake(x, z, dt * 2.2 * 0.6 + 0.02);
      // the summit already vents dark ash while it rises
      this._acc.vent = (this._acc.vent || 0) + vt * 14 * p * Math.max(fx.budget, 0.65);
      while (this._acc.vent >= 1) {
        this._acc.vent -= 1;
        const sy = w.heightAt(x, z) + 0.6;
        smokePuff(fx, x + rand(-0.6, 0.6), sy + rand(0.3, 1.5), z + rand(-0.6, 0.6), { size: rand(1.8, 2.6), grow: 2.6, ramp: RAMP.SMOKE_BLACK, glow: 0.3, rise: rand(3.5, 5), drift: 1.6, drag: 0.45, life: rand(4.5, 6) });
      }
      this._acc.rise += vt * 26 * fx.budget;
      while (this._acc.rise >= 1) {
        this._acc.rise -= 1;
        const a = Math.random() * Math.PI * 2,
          rr = this.R * rand(0.3, 1.1);
        const px = x + Math.cos(a) * rr,
          pz = z + Math.sin(a) * rr;
        dustPuff(fx, px, w.surfaceAt(px, pz), pz, rand(0.9, 1.6), { ang: a, out: rand(1, 3), life: rand(2, 3.5) });
        if (Math.random() < 0.25)
          fx.debris.spawn({ x: px, y: w.heightAt(px, pz) + 0.5, z: pz, vx: Math.cos(a) * rand(2, 4), vy: rand(1, 4), vz: Math.sin(a) * rand(2, 4), size: rand(0.25, 0.5), color: 0x6a6058, trail: TRAIL.DUST, life: rand(6, 9) });
      }
      if (this.t >= this.riseT) {
        this.phase = 1;
        this.t = 0;
        this._erupt();
      }
      return true;
    }
    const erupting = this.phase === 1;
    const k = erupting ? Math.min(1, this.t / 1.5) : Math.max(0, 1 - this.t / this.waneT);
    const top = w.heightAt(x, z) + 0.4;
    // lava from the vent (visual clock => same volume at any game speed)
    if (erupting) {
      const rate = 1.5 * k;
      this.ds.lava.pour(this.cx, this.cz, rate * vt * 0.3, 1);
      // overflow down each flank gully: glowing rivers running into the land
      const rr = (this.crater + 0.07) * this.R;
      for (const ga of this.gullies) {
        const gx = Math.floor(x + Math.cos(ga) * rr),
          gz = Math.floor(z + Math.sin(ga) * rr);
        this.ds.lava.pour(gx, gz, rate * vt * 1.0, 1);
      }
    }
    // fountain
    this._acc.fount += vt * 20 * k * fx.budget;
    while (this._acc.fount >= 1) {
      this._acc.fount -= 1;
      sparks(fx, x + rand(-0.5, 0.5), top, z + rand(-0.5, 0.5), 1, { speed: rand(6, 11), up: true, ramp: RAMP.LAVA, gravity: 15, size: 1.8, life: 1.6, bright: 1.35, stretch: 0.05 });
      if (Math.random() < 0.06) fx.emit('fireball', { x, y: top + 0.5, z }, { scale: 1.1, count: 1 });
    }
    // lava bombs
    this._acc.bomb += vt * (erupting ? 3.2 : 0.8) * k;
    while (this._acc.bomb >= 1) {
      this._acc.bomb -= 1;
      const a = Math.random() * Math.PI * 2;
      const out = rand(2, 7);
      fx.debris.spawn({
        x: x + rand(-0.4, 0.4),
        y: top + 0.4,
        z: z + rand(-0.4, 0.4),
        vx: Math.cos(a) * out,
        vy: rand(11, 19),
        vz: Math.sin(a) * out,
        size: rand(0.3, 0.7),
        color: 0x2e2622,
        heat: 1,
        cool: 0.05,
        trail: TRAIL.LAVA,
        life: rand(12, 20),
        onLand: (lx, ly, lz, heat, sz) => {
          if (heat < 0.3) return;
          const tx = Math.floor(lx),
            ty = Math.floor(lz);
          if (!w.inBounds(tx, ty)) return;
          if (w.isWater(tx, ty)) return;
          fx.emit('lavaPop', { x: lx, y: ly, z: lz }, { scale: 1.2 + sz });
          fx.decal({ frame: DF.LAVASPLAT, x: lx, z: lz, size: 1.2 + sz * 2, life: 20, additive: true, color: 0xff8a30, intensity: 1.6, cool: 1.2, fadeIn: 0.005, fadeOut: 0.5 });
          fx.decal({ frame: DF.SCORCH1, x: lx, z: lz, size: 1.6 + sz * 2, life: 80, color: 0x14100d, alpha: 0.75, fadeIn: 0.002, fadeOut: 0.8 });
          if (sz > 0.5) this.ds.lava.pour(tx, ty, 0.08, 0.9);
          if (Math.random() < 0.35) this.ds.ignite(tx, ty, 1);
          hurt(g, lx, lz, 1.2, 40, 30, 'volcano');
        },
      });
    }
    // ash column: a dense charcoal tower several cone-heights tall that
    // shoots up within ~1.5 s of the blast (so even a quick look catches
    // it), swells with height and leans downwind. Puffs are seeded along
    // the whole column and only drift slowly, so its shape stays put. It is
    // a hero effect: it keeps most of its rate when a big fire elsewhere
    // squeezes the particle budget.
    const pb = Math.max(fx.budget, 0.65);
    const colH = erupting ? Math.min(30, 14 + this.t * 12) : 30;
    const wx = fx.wind.x,
      wz = fx.wind.z;
    const lean = (h) => Math.pow(h, 1.6) * 0.06;
    this._acc.plume += vt * (erupting ? 50 : 12) * Math.max(k, erupting ? 0.6 : 0.15) * pb;
    while (this._acc.plume >= 1) {
      this._acc.plume -= 1;
      const u = Math.pow(Math.random(), 0.8);
      const h = 1 + u * colH;
      const L = lean(h);
      const s = (3.2 + h * 0.14) * rand(0.85, 1.15) * (erupting ? 1 : 0.85);
      smokePuff(fx, x + wx * L + rand(-0.6, 0.6) * (1 + u), top + h, z + wz * L + rand(-0.6, 0.6) * (1 + u), {
        size: s,
        grow: 1.7,
        ramp: RAMP.SMOKE_BLACK,
        glow: u < 0.12 ? 0.4 : 0,
        rise: rand(0.8, 1.6),
        drift: 2.0,
        drag: 0.5,
        life: rand(7, 10),
      });
    }
    // the jet roaring out of the vent at the column's foot
    this._acc.jet = (this._acc.jet || 0) + vt * (erupting ? 7 : 2) * k * pb;
    while (this._acc.jet >= 1) {
      this._acc.jet -= 1;
      smokePuff(fx, x + rand(-0.5, 0.5), top + rand(0.5, 1.5), z + rand(-0.5, 0.5), { size: rand(1.8, 2.5), grow: 2.4, ramp: RAMP.SMOKE_BLACK, glow: 0.6, rise: rand(6, 8), drift: 1.2, drag: 0.7, life: rand(3.5, 4.5) });
    }
    // ash fall downwind
    this._acc.ash += vt * 6 * k;
    while (this._acc.ash >= 1) {
      this._acc.ash -= 1;
      fx.emit('ash', { x: x + fx.wind.x * 5, y: top, z: z + fx.wind.z * 5 }, { count: 2, scale: 2 });
    }
    // volcanic lightning inside the column: frequent, long-lived enough to be
    // caught in any glance, placed along the wind-bent column (where the ash
    // is) and lighting the smoke around it
    this._acc.bolt -= vt;
    if (erupting && this._acc.bolt <= 0) {
      this._acc.bolt = rand(0.35, 0.9);
      const hb = rand(0.25, 0.65) * colH;
      const h0 = top + hb;
      const ox = x + wx * lean(hb),
        oz = z + wz * lean(hb);
      const a = Math.random() * Math.PI * 2,
        len = rand(4, 8);
      fx.beams.bolt(ox + Math.cos(a) * len * 0.5, h0 + rand(1, 4), oz + Math.sin(a) * len * 0.5, ox - Math.cos(a) * len * 0.5, h0 - rand(2, 5), oz - Math.sin(a) * len * 0.5, { width: 0.26, life: 0.55, color: 0xc8d8ff, branches: 3, detail: 6, intensity: 2.2 });
      glowFlash(fx, ox, h0, oz, 7, { life: 0.4, bright: 1.1, color: 0x9fb4ff, from: 0.7, soft: 0 });
      fx.addLight({ x: ox, y: h0, z: oz }, 0xb0c8ff, 4, 0.35);
      if (Math.random() < 0.4) play(g, 'thunder', { x, z }, 0.4, 1.2);
    }
    // glow + rumble
    const fl = 0.85 + 0.15 * Math.sin(this.t * 17) * Math.sin(this.t * 5.3);
    fx.lights.request('volcano' + x, x, top + 2.5, z, this._lc, (2.5 + 5 * k) * fl, 44, 0.35);
    if (Math.random() < vt * 4 * k) glowFlash(fx, x, top + 0.5, z, 3, { life: 0.5, bright: 1.2, ramp: RAMP.LAVA, from: 0.6 });
    fx.shake(x, z, dt * 2.2 * 0.25 * k + (Math.random() < vt * 1.2 * k ? 0.35 : 0));
    hurt(g, x, z, 2.2, 30 * vt * k, 20 * vt * k, 'volcano');
    if (erupting && this.t >= this.eruptT) {
      this.phase = 2;
      this.t = 0;
    }
    if (this.phase === 2 && this.t >= this.waneT) {
      honourSurvivors(g, x, z, this.R * 2.5, `Lived through the eruption of a volcano, ${yearLabel(g)}`, 14);
      return false;
    }
    return true;
  }

  _erupt() {
    const g = this.game;
    const fx = g.fx;
    const { x, z } = this;
    const top = g.world.heightAt(x, z) + 0.4;
    fx.emit('explosion', { x, y: top, z }, { scale: 1.2 });
    fx.shell(x, top, z, 8, { life: 0.45, color: 0xffc890, intensity: 1.1, power: 4, squash: 0.8 });
    fx.screenFlash(0xffd0a0, 0.45);
    fx.addLight({ x, y: top + 3, z }, 0xff9050, 9, 1.2);
    fx.shake(x, z, 1.4);
    fx.decal({ frame: DF.GLOW, x, z, size: 5, life: this.eruptT + this.waneT, additive: true, color: 0xff7a24, intensity: 1.3, fadeIn: 0.03, fadeOut: 0.7 });
    for (let k = 0; k < 10; k++) smokePuff(fx, x + rand(-0.5, 0.5), top + rand(1, 3), z + rand(-0.5, 0.5), { size: rand(1.2, 1.8), grow: 3.2, ramp: RAMP.SMOKE_BLACK, glow: 0.8, rise: rand(8, 11), drift: 1.4, drag: 0.16, life: rand(7, 9) });
    // the blast throws up a ready-made ash column (the steady column then
    // keeps it fed), so the tower stands from the very first moment
    for (let k = 0; k < fx.k(40); k++) {
      const h = 1 + Math.random() * 16;
      const L = Math.pow(h, 1.6) * 0.06;
      smokePuff(fx, x + fx.wind.x * L + rand(-0.8, 0.8), top + h, z + fx.wind.z * L + rand(-0.8, 0.8), { size: (3.2 + h * 0.14) * rand(0.85, 1.15), grow: 1.8, ramp: RAMP.SMOKE_BLACK, glow: 0, rise: rand(1.5, 3), drift: 2, drag: 0.5, life: rand(6, 9), delay: Math.random() * 0.4 });
    }
    play(g, 'explosion', { x, z }, 1, 0.6);
  }
}
