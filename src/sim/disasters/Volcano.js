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
    this.riseT = 3.2;
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
    this.peak = Math.min(MAX_HEIGHT - 1, Math.max(top + 2.5, base + 6 + radius * 0.75));
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
    this._acc = { bomb: 0, plume: 0, fount: 0, rise: 0, ash: 0, bolt: 2 };
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
        this.ds.lava.pour(gx, gz, rate * vt * 0.55, 1);
      }
    }
    // fountain
    this._acc.fount += vt * 20 * k * fx.budget;
    while (this._acc.fount >= 1) {
      this._acc.fount -= 1;
      sparks(fx, x + rand(-0.5, 0.5), top, z + rand(-0.5, 0.5), 1, { speed: rand(6, 11), up: true, ramp: RAMP.LAVA, gravity: 15, size: 2.2, life: 1.6, bright: 1.9, stretch: 0.05 });
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
    // ash plume: a narrow charcoal column that shoots up fast and only
    // spreads / drifts once it is high above the cone, so the crater, cone
    // and lava rivers stay readable underneath
    this._acc.plume += vt * (erupting ? 6 : 2.5) * Math.max(k, erupting ? 1 : 0.15) * fx.budget;
    while (this._acc.plume >= 1) {
      this._acc.plume -= 1;
      const up = rand(9.5, 12.5) * (erupting ? 1 : 0.6);
      smokePuff(fx, x + rand(-0.35, 0.35), top + rand(1.5, 3), z + rand(-0.35, 0.35), {
        size: rand(1.0, 1.5) * (erupting ? 1 : 0.8),
        grow: 2.5,
        ramp: RAMP.SMOKE_BLACK,
        glow: 0.6,
        rise: up,
        drift: 0.9,
        drag: 0.11,
        life: rand(7, 9),
      });
    }
    // ash fall downwind
    this._acc.ash += vt * 6 * k;
    while (this._acc.ash >= 1) {
      this._acc.ash -= 1;
      fx.emit('ash', { x: x + fx.wind.x * 5, y: top, z: z + fx.wind.z * 5 }, { count: 2, scale: 2 });
    }
    // volcanic lightning in the plume
    this._acc.bolt -= vt;
    if (erupting && this._acc.bolt <= 0) {
      this._acc.bolt = rand(1.2, 3.2);
      const h0 = top + rand(8, 14);
      const ox = x + fx.wind.x * rand(2, 5),
        oz = z + fx.wind.z * rand(2, 5);
      fx.beams.bolt(ox + rand(-3, 3), h0 + rand(2, 5), oz + rand(-3, 3), ox + rand(-4, 4), h0 - rand(3, 6), oz + rand(-4, 4), { width: 0.18, life: 0.35, color: 0xc0d4ff, branches: 2, detail: 5, intensity: 1.8 });
      fx.addLight({ x: ox, y: h0, z: oz }, 0xb0c8ff, 3, 0.25);
      if (Math.random() < 0.5) play(g, 'thunder', { x, z }, 0.4, 1.2);
    }
    // glow + rumble
    const fl = 0.85 + 0.15 * Math.sin(this.t * 17) * Math.sin(this.t * 5.3);
    fx.lights.request('volcano' + x, x, top + 2.5, z, this._lc, (2.5 + 5 * k) * fl, 44, 0.8);
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
    play(g, 'explosion', { x, z }, 1, 0.6);
  }
}
