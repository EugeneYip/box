import * as THREE from 'three';
import { SEA_LEVEL, FLORA, FLORA_INFO } from '../../world/constants.js';
import { hurt, play, rand, law, ageMod, fireFactor } from './util.js';
import { DF, RAMP, PF, TRAIL, glowFlash, sparks, dustPuff } from '../../render/fx/Effects.js';

// Lightning strike (god power): our own branching bolt entering from the top
// of the frame, a sky flash, and the ground consequences: a white-hot
// impact, a thin additive blue-white ring, electric sparks, a scorch mark,
// ignition of whatever can burn, and damage. (Storm bolts remain the
// atmosphere module's.)
export function lightningStrike(ds, x, z, opts = {}) {
  const g = ds.game;
  const fx = g.fx;
  const w = g.world;
  const y = w.surfaceAt(x, z);
  const camY = g.cameraRig?.camera?.position?.y ?? y + 60;
  const top = y + Math.min(55, Math.max(14, camY * 0.72 - y));
  fx.beams.bolt(x + rand(-5, 5), top, z + rand(-5, 5), x, y, z, { width: 0.3, life: 0.5, color: 0xc8dcff, branches: 5, intensity: 1.8 });
  fx.screenFlash(0xd8e4ff, 0.5);
  ds.flashSky(1);
  // thin additive blue-white ring: expands and fades in under ~0.3 s
  const P = fx.P.reset();
  P.x = x;
  P.y = y + 0.08;
  P.z = z;
  P.life = 0.32;
  P.s0 = 0.8;
  P.s1 = 5.5;
  P.mode = 3;
  P.rot = Math.random() * 6.28;
  P.frame = PF.RING;
  P.ramp = RAMP.ELECTRIC;
  P.bright = 1.4;
  P.add = 1;
  P.soft = 0;
  fx.pGlow();
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
  // natural (storm) strikes only ignite when the calamityLightning law allows
  // (the chance of a lightning fire follows the age: lightning x fireRisk)
  const canIgnite = !opts.natural || opts.ignite || (law(g, "calamityLightning", true) && Math.random() < Math.min(1, 0.7 * ageMod(g, "lightning", 1) * fireFactor(g)));
  if (canIgnite) ds.ignite(tx, ty, 1);
  if (canIgnite) for (let k = 0; k < 3; k++) if (Math.random() < 0.55) ds.ignite(tx + Math.round(rand(-1, 1)), ty + Math.round(rand(-1, 1)), 0.8);
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
      // a brief charge (0.15 s): motes spiral in and the light builds, but
      // the strike itself must land almost at once
      const k = this.t / 0.06;
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
      if (this.t >= 0.06) {
        this.phase = 1;
        this.strike();
      }
      return true;
    }
    // afterglow
    if (this.t < 3.4) {
      const k = Math.max(0, 1 - (this.t - 0.06) / 3.2);
      fx.lights.request('smite' + x, x, y + 3, z, this._c, 6 * k * k, 22);
      if (Math.random() < 0.6) fx.emit('sparkle', { x, y, z }, { scale: 0.9, count: 2, color: 0xfff0c0 });
      return true;
    }
    return false;
  }
  strike() {
    const g = this.game;
    const fx = g.fx;
    const { x, z, r } = this;
    const y = g.world.surfaceAt(x, z);
    const gold = new THREE.Color(0xffd27a);
    const white = new THREE.Color(1, 0.97, 0.9);
    const top = y + 70;
    // narrower, flickering core inside a restrained glow so the impact
    // beside the beam stays readable (the pillar still reads from far zoom)
    // beams hold full strength for the first 55% of their life, so the
    // pillar stays unmissable for about 1.5 s
    fx.beams.segment(x, top, z, x, y, z, { color: gold, width: r * 0.95, life: 3.0, intensity: 0.8, flicker: 0.35, taper: 1.1 });
    fx.beams.segment(x, top, z, x, y, z, { color: white, width: r * 0.32, life: 2.7, intensity: 1.4, flicker: 0.6, taper: 1.2 });
    fx.beams.segment(x, top, z, x, y, z, { color: gold, width: r * 2.4, life: 3.2, intensity: 0.14, flicker: 0.1, taper: 1.3 });
    fx.screenFlash(0xffe6b0, 0.45);
    fx.addLight({ x, y: y + 4, z }, 0xffd890, 8, 1.1);
    fx.hitStop(0.06);
    fx.shake(x, z, 1.3);
    fx.shockwave(x, z, r * 5, { color: 0xffd890, life: 0.8, intensity: 1.6 });
    // volumetric impact flash (no flat star decals): a white-hot core and a
    // wide soft golden sphere of light, flares climbing the beam, sparks
    // sprayed low and thrown up, and one brief shock ring
    glowFlash(fx, x, y + 0.8, z, r * 3.4, { life: 0.7, bright: 2.2, color: 0xfff6e0, from: 0.5, soft: 0 });
    glowFlash(fx, x, y + 2.2, z, r * 6.2, { life: 1.2, bright: 0.9, color: 0xffd890, from: 0.4, soft: 0 });
    // a lingering hot glow at the foot of the beam
    glowFlash(fx, x, y + 1.2, z, r * 4.2, { life: 2.2, bright: 0.7, color: 0xffc870, from: 0.9, soft: 0 });
    for (let k = 1; k <= 3; k++) glowFlash(fx, x, y + 2 + k * 2.6, z, r * (2.6 - k * 0.45), { life: 0.55 + k * 0.1, bright: 1.3, color: 0xfff0c8, from: 0.6, soft: 0, delay: k * 0.03 });
    sparks(fx, x, y + 0.3, z, fx.k(46), { speed: 12, ramp: RAMP.GOLD, bright: 2.2, size: 1.4, gravity: 10, stretch: 0.08 });
    sparks(fx, x, y + 0.6, z, fx.k(26), { speed: 9, up: true, ramp: RAMP.GOLD, bright: 2.0, size: 1.2, gravity: 12, stretch: 0.07 });
    // outward debris
    for (let k = 0; k < 26; k++) {
      const a = (k / 26) * Math.PI * 2 + rand(-0.15, 0.15),
        v = rand(6, 11);
      fx.debris.spawn({ x: x + Math.cos(a) * r * 0.4, y: y + 0.4, z: z + Math.sin(a) * r * 0.4, vx: Math.cos(a) * v, vy: rand(4, 9), vz: Math.sin(a) * v, size: rand(0.2, 0.42), color: 0x5a5048, heat: rand(0.4, 0.9), cool: 0.3, trail: TRAIL.DUST, life: rand(6, 10) });
    }
    // ground ring that stays visible beside the beam, bigger scorch
    fx.decal({ frame: DF.BLAST, x, z, size: r * 5.2, life: 150, color: 0x120c08, alpha: 0.95, lift: 0.12, fadeIn: 0.001, fadeOut: 0.85 });
    // the scorched ground itself (charred tiles that Nature slowly regrows)
    // and nothing grows inside the beam: trees and plants are burnt away so
    // the scorch is not hidden under a canopy
    g.world.forEachInRadius(x, z, r * 1.3, (tx, ty, d, i) => {
      if (g.world.height[i] < SEA_LEVEL) return;
      if (d < 0.9 + Math.random() * 0.2) g.world.setType(tx, ty, 10);
      const fl = g.world.flora[i];
      if (fl && d < 0.85 && fl !== FLORA.BOULDER) g.world.setFlora(tx, ty, FLORA_INFO[fl]?.isTree && Math.random() < 0.4 ? FLORA.DEAD_TREE : FLORA.NONE);
    });
    fx.decal({ frame: DF.SCORCH1, x, z, size: r * 6.5, life: 70, color: 0x3a2c20, alpha: 0.45, fadeIn: 0.001, fadeOut: 0.8 });
    fx.decal({ frame: DF.RING, x, z, size: r * 1.2, grow: 3.4, life: 2.2, additive: true, surface: 2, color: 0xffc860, intensity: 2.4, fadeIn: 0.01, fadeOut: 0.35, grain: 0 });
    fx.decal({ frame: DF.RUNE, x, z, size: r * 3.2, life: 6, additive: true, color: 0xffb040, intensity: 2.4, cool: 0.6, fadeIn: 0.005, fadeOut: 0.3, grain: 0, spin: 0.6 });
    fx.decal({ frame: DF.GLOW, x, z, size: r * 3, life: 4, additive: true, color: 0xff9a30, intensity: 1.5, cool: 0.8, fadeIn: 0.005, fadeOut: 0.2 });
    for (let k = 0; k < 16; k++) dustPuff(fx, x, y, z, 1.1, { out: rand(4, 8), life: rand(1.6, 2.8), drag: 2.2, ramp: RAMP.DUST_THICK, up: 0.4 });
    play(g, 'thunder', { x, z }, 1, 1.3);
    hurt(g, x, z, r, 999, 220, 'smite');
    hurt(g, x, z, r * 2, 25, 40, 'smite');
    g.world.forEachInRadius(x, z, r * 0.8, (tx, ty) => Math.random() < 0.5 && this.ds.ignite(tx, ty, 0.7));
  }
}
