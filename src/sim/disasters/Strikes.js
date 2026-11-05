import * as THREE from 'three';
import { SEA_LEVEL } from '../../world/constants.js';
import { hurt, play, rand } from './util.js';
import { DF, RAMP, PF, glowFlash, sparks, dustPuff } from '../../render/fx/Effects.js';

// Lightning strike: the bolt itself is drawn by the atmosphere module when
// it provides strike(); otherwise we draw our own branching bolt and flash.
// Either way we add the ground consequences: a white-hot impact, electric
// sparks, a scorch mark, ignition of whatever can burn, and damage.
export function lightningStrike(ds, x, z, opts = {}) {
  const g = ds.game;
  const fx = g.fx;
  const w = g.world;
  const y = w.surfaceAt(x, z);
  let drawn = false;
  try {
    if (typeof g.atmosphere?.strike === 'function') {
      g.atmosphere.strike(x, z);
      drawn = true;
    }
  } catch (err) {
    console.error('[lightning] atmosphere.strike', err);
  }
  if (!drawn) {
    const top = y + 55 + Math.random() * 20;
    fx.beams.bolt(x + rand(-8, 8), top, z + rand(-8, 8), x, y, z, { width: 0.34, life: 0.5, color: 0xc8dcff, branches: 5 });
    fx.screenFlash(0xd8e4ff, 0.5);
    ds.flashSky(1);
  }
  glowFlash(fx, x, y + 0.5, z, 6, { life: 0.3, bright: 5, color: 0xe0ecff });
  glowFlash(fx, x, y + 0.3, z, 2.2, { life: 0.9, bright: 3, ramp: RAMP.ELECTRIC });
  sparks(fx, x, y + 0.2, z, fx.k(22), { speed: 7, ramp: RAMP.ELECTRIC, bright: 4.5, up: true, size: 1.2 });
  fx.addLight({ x, y: y + 4, z }, 0xb8d0ff, 6, 0.45);
  fx.shake(x, z, 0.35);
  play(g, 'thunder', { x, z }, 1);
  if (y <= SEA_LEVEL + 0.01 && w.heightAt(x, z) < SEA_LEVEL) {
    fx.emit('splash', { x, y: SEA_LEVEL, z }, { scale: 1.2 });
    fx.emit('steam', { x, y: SEA_LEVEL, z }, { scale: 1 });
    fx.decal({ frame: DF.RIPPLE, x, z, size: 1.5, grow: 4, life: 1.6, additive: true, surface: 1, color: 0xd0e4ff, intensity: 1, fadeIn: 0.01, fadeOut: 0.2, grain: 0 });
    hurt(g, x, z, 2.5, 40, 0, 'lightning');
    return;
  }
  fx.decal({ frame: DF.SCORCH1, x, z, size: 2.6, life: 70, color: 0x120e0c, alpha: 0.9, fadeIn: 0.001, fadeOut: 0.8 });
  fx.decal({ frame: DF.CRACK1, x, z, size: 3.2, life: 4, additive: true, color: 0x9cc4ff, intensity: 1.6, fadeIn: 0.005, fadeOut: 0.2, grain: 0.2 });
  fx.decal({ frame: DF.GLOW, x, z, size: 2.2, life: 2.5, additive: true, color: 0xffa060, intensity: 1.3, cool: 1, fadeIn: 0.01, fadeOut: 0.3 });
  for (let k = 0; k < 4; k++) dustPuff(fx, x, y, z, 0.5, { out: rand(1, 2.5), life: rand(1, 2) });
  const tx = Math.floor(x),
    ty = Math.floor(z);
  ds.ignite(tx, ty, 1);
  for (let k = 0; k < 3; k++) if (Math.random() < 0.55) ds.ignite(tx + Math.round(rand(-1, 1)), ty + Math.round(rand(-1, 1)), 0.8);
  hurt(g, x, z, 1.8, 70, 45, 'lightning');
}

// Divine smite: a rune circle blooms and a column of golden light slams
// down, annihilating anything inside.
export class Smite {
  constructor(ds, x, z, opts = {}) {
    this.ds = ds;
    this.game = ds.game;
    this.x = x;
    this.z = z;
    this.r = opts.radius ?? 2.2;
    this.t = 0;
    this.phase = 0;
    const fx = this.game.fx;
    fx.decal({ frame: DF.RUNE, x, z, size: this.r * 2.6, grow: 1.25, life: 2.6, additive: true, surface: 2, color: 0xffd27a, intensity: 1.8, fadeIn: 0.18, fadeOut: 0.55, grain: 0, spin: 0.9 });
    play(this.game, 'magic', { x, z }, 1, 0.8);
  }
  update(vt) {
    if (vt <= 0) return true;
    const g = this.game;
    const fx = g.fx;
    const { x, z } = this;
    const y = g.world.surfaceAt(x, z);
    this.t += vt;
    if (this.phase === 0) {
      // charge: motes spiral inward and upward, light builds
      const k = this.t / 0.75;
      const P = fx.P;
      for (let i = 0; i < fx.k(3); i++) {
        P.reset();
        P.mode = 4;
        P.x = x;
        P.y = y + 0.1;
        P.z = z;
        P.vx = this.r * rand(1, 1.6);
        P.vy = Math.random() * 6.28;
        P.vz = rand(0.5, 2.5);
        P.tx = -this.r * 1.6;
        P.ty = 3.5;
        P.life = rand(0.5, 0.8);
        P.s0 = rand(0.18, 0.3);
        P.s1 = 0.05;
        P.frame = PF.GLINT;
        P.spin = rand(-3, 3);
        P.ramp = RAMP.GOLD;
        P.bright = 3.5;
        P.add = 1;
        P.soft = 0;
        fx.pGlow();
      }
      fx.lights.request('smite' + x, x, y + 3, z, this._c || (this._c = new THREE.Color(1, 0.82, 0.45)), 1 + k * 4, 18);
      if (this.t >= 0.75) {
        this.phase = 1;
        this.strike();
      }
      return true;
    }
    // afterglow
    if (this.t < 1.6) {
      const k = 1 - (this.t - 0.75) / 0.85;
      fx.lights.request('smite' + x, x, y + 3, z, this._c, 6 * k * k, 22);
      if (Math.random() < 0.6) fx.emit('sparkle', { x, y, z }, { scale: 1.6, count: 2, color: 0xfff0c0 });
      return true;
    }
    return false;
  }
  strike() {
    const g = this.game;
    const fx = g.fx;
    const { x, z, r } = this;
    const y = g.world.surfaceAt(x, z);
    const gold = new THREE.Color(0xffd27a).convertSRGBToLinear();
    const white = new THREE.Color(1, 0.97, 0.9);
    const top = y + 70;
    fx.beams.segment(x, top, z, x, y, z, { color: gold, width: r * 1.6, life: 0.9, intensity: 1.6, flicker: 0.15, taper: 1.15 });
    fx.beams.segment(x, top, z, x, y, z, { color: white, width: r * 0.55, life: 0.7, intensity: 3, flicker: 0.1, taper: 1.3 });
    fx.beams.segment(x, top, z, x, y, z, { color: gold, width: r * 4.5, life: 1.0, intensity: 0.35, flicker: 0.05, taper: 1.4 });
    fx.screenFlash(0xffe6b0, 0.7);
    fx.addLight({ x, y: y + 4, z }, 0xffe0a0, 9, 0.9);
    fx.shake(x, z, 0.9);
    fx.shockwave(x, z, r * 4, { color: 0xffe2a0, life: 0.7, intensity: 2.2 });
    glowFlash(fx, x, y + 0.6, z, r * 5, { life: 0.4, bright: 5, color: 0xfff2d0 });
    glowFlash(fx, x, y + 0.4, z, r * 2.6, { life: 1.4, bright: 2.5, ramp: RAMP.GOLD });
    sparks(fx, x, y + 0.2, z, fx.k(40), { speed: 9, ramp: RAMP.GOLD, bright: 4, up: true, size: 1.4 });
    fx.emit('sparkle', { x, y, z }, { scale: 2.4, count: 24, color: 0xfff0c0 });
    fx.decal({ frame: DF.BLAST, x, z, size: r * 3.2, life: 80, color: 0x1a140e, alpha: 0.85, fadeIn: 0.001, fadeOut: 0.8 });
    fx.decal({ frame: DF.RUNE, x, z, size: r * 2.6, life: 6, additive: true, color: 0xffc860, intensity: 2.2, cool: 0.6, fadeIn: 0.005, fadeOut: 0.3, grain: 0 });
    fx.decal({ frame: DF.GLOW, x, z, size: r * 3, life: 4, additive: true, color: 0xffd080, intensity: 1.5, cool: 0.8, fadeIn: 0.005, fadeOut: 0.2 });
    for (let k = 0; k < 10; k++) dustPuff(fx, x, y, z, 0.8, { out: rand(3, 6), life: rand(1.2, 2.2), drag: 2.4 });
    play(g, 'thunder', { x, z }, 1, 1.3);
    hurt(g, x, z, r, 999, 220, 'smite');
    hurt(g, x, z, r * 2, 25, 40, 'smite');
    g.world.forEachInRadius(x, z, r * 0.8, (tx, ty) => Math.random() < 0.5 && this.ds.ignite(tx, ty, 0.7));
  }
}
