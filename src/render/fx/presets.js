import * as THREE from 'three';
import { PF, DF, RAMP } from './FxTextures.js';
import { TRAIL } from './Debris.js';

// Effect type presets. Each preset receives (fx, pos, opts) where pos has a
// resolved y, and opts = {scale, count, color, dir, ...}. All randomness is
// visual only (Math.random) so it never perturbs the seeded simulation.

const R = Math.random;
const rr = (a, b) => a + (b - a) * R();
const TAU = Math.PI * 2;
const tmpC = new THREE.Color();
const lin = (hex) => tmpC.setHex(hex);

function tint(P, hex, a = 1) {
  if (hex == null) return P;
  const c = lin(hex);
  P.r = c.r;
  P.g = c.g;
  P.b = c.b;
  P.a = a;
  return P;
}

// ---- building blocks --------------------------------------------------------
export function flame(fx, x, y, z, size, o = {}) {
  const P = fx.P.reset();
  P.x = x + rr(-0.08, 0.08) * size;
  P.y = y;
  P.z = z + rr(-0.08, 0.08) * size;
  P.vx = rr(-0.2, 0.2);
  P.vy = rr(0.6, 1.2) * Math.sqrt(size);
  P.vz = rr(-0.2, 0.2);
  P.tx = fx.wind.x * 1.1;
  P.ty = rr(1.4, 2.2) * Math.sqrt(size);
  P.tz = fx.wind.z * 1.1;
  P.drag = 2.2;
  P.life = (o.life ?? rr(0.45, 0.8)) * (0.8 + 0.2 * size);
  P.s0 = size * rr(0.75, 1.05);
  P.s1 = size * rr(0.25, 0.5);
  P.aspect = o.aspect ?? rr(1.5, 2.1);
  P.mode = 2;
  P.stretch = 0.35; // wind lean
  P.frame = PF.FLAME0;
  P.frames = 4;
  P.ramp = o.ramp ?? RAMP.FIRE;
  P.heat = 0.42;
  P.bright = o.bright ?? 1.6;
  P.add = 1;
  P.soft = 0.12;
  if (o.color != null) tint(P, o.color);
  fx.pGlow();
}

export function smokePuff(fx, x, y, z, o = {}) {
  const P = fx.P.reset();
  const s = o.size ?? 1;
  P.x = x + rr(-0.2, 0.2) * s;
  P.y = y;
  P.z = z + rr(-0.2, 0.2) * s;
  const rise = o.rise ?? 1.1;
  P.vx = rr(-0.3, 0.3) * s + (o.vx || 0);
  P.vy = rise * rr(1.0, 1.6) + (o.vy || 0);
  P.vz = rr(-0.3, 0.3) * s + (o.vz || 0);
  const drift = o.drift ?? 2.2;
  P.tx = fx.wind.x * drift;
  P.ty = rise * rr(0.45, 0.8);
  P.tz = fx.wind.z * drift;
  P.drag = o.drag ?? 0.55;
  P.life = o.life ?? rr(3.2, 5.5);
  P.s0 = s * rr(0.5, 0.8);
  P.s1 = s * rr(0.8, 1.15) * (o.grow ?? 2.4);
  P.rot = R() * TAU;
  P.spin = rr(-0.25, 0.25);
  P.frame = PF.SMOKE0 + ((R() * 4) | 0);
  P.ramp = o.ramp ?? RAMP.SMOKE_DARK;
  P.lit = o.lit ?? 1;
  P.glow = o.glow ?? 0;
  P.soft = 0.45;
  P.delay = o.delay || 0;
  if (o.color != null) tint(P, o.color, o.alpha ?? 1);
  else if (o.alpha != null) P.a = o.alpha;
  fx.pSmoke();
}

export function ember(fx, x, y, z, o = {}) {
  if (!fx.tinyOK) return; // sub-pixel at far zoom
  const P = fx.P.reset();
  P.x = x + rr(-0.3, 0.3);
  P.y = y;
  P.z = z + rr(-0.3, 0.3);
  const sp = o.speed ?? 1;
  P.vx = rr(-1, 1) * sp;
  P.vy = rr(1.2, 3.2) * sp;
  P.vz = rr(-1, 1) * sp;
  P.tx = fx.wind.x * 2.6 + rr(-0.6, 0.6);
  P.ty = rr(0.6, 1.6);
  P.tz = fx.wind.z * 2.6 + rr(-0.6, 0.6);
  P.drag = 0.9;
  P.life = o.life ?? rr(1.2, 2.8);
  const s = (o.size ?? 1) * rr(0.06, 0.12);
  P.s0 = s;
  P.s1 = s * 0.5;
  P.mode = 1;
  P.aspect = 1;
  P.stretch = 0.08;
  P.frame = PF.SPARK;
  P.ramp = RAMP.EMBER;
  P.bright = 3.5;
  P.add = 1;
  P.soft = 0;
  fx.pGlow();
}

export function sparks(fx, x, y, z, n, o = {}) {
  if (!fx.tinyOK && (o.size ?? 1) < 1.5) n = Math.ceil(n * 0.25);
  const sp = o.speed ?? 6;
  for (let i = 0; i < n; i++) {
    const P = fx.P.reset();
    P.x = x;
    P.y = y;
    P.z = z;
    const a = R() * TAU;
    const el = o.up ? rr(0.35, 1.3) : rr(-0.2, 1.3);
    const v = sp * rr(0.4, 1.1);
    P.vx = Math.cos(a) * Math.cos(el) * v + (o.dir ? o.dir.x * sp : 0);
    P.vy = Math.sin(el) * v + (o.dir ? o.dir.y * sp : 0);
    P.vz = Math.sin(a) * Math.cos(el) * v + (o.dir ? o.dir.z * sp : 0);
    P.drag = o.drag ?? 0.7;
    P.ty = -(o.gravity ?? 14) / P.drag;
    P.tx = fx.wind.x;
    P.tz = fx.wind.z;
    P.life = rr(0.4, 1.0) * (o.life ?? 1);
    const s = (o.size ?? 1) * rr(0.05, 0.1);
    P.s0 = s;
    P.s1 = s * 0.6;
    P.mode = 1;
    P.aspect = 1;
    P.stretch = o.stretch ?? 0.06;
    P.frame = PF.SPARK;
    P.ramp = o.ramp ?? RAMP.EMBER;
    P.bright = o.bright ?? 4;
    P.add = 1;
    P.soft = 0.05;
    if (o.color != null) tint(P, o.color);
    fx.pGlow();
  }
}

export function glowFlash(fx, x, y, z, size, o = {}) {
  const P = fx.P.reset();
  P.x = x;
  P.y = y;
  P.z = z;
  P.life = o.life ?? 0.3;
  P.s0 = size * (o.from ?? 0.6);
  P.s1 = size;
  P.frame = PF.GLOW;
  P.ramp = o.ramp ?? RAMP.FLASH;
  P.bright = o.bright ?? 3;
  P.add = 1;
  P.soft = o.soft ?? 0.2;
  P.delay = o.delay || 0;
  if (o.color != null) tint(P, o.color);
  fx.pGlow();
}

function dustPuff(fx, x, y, z, s, o = {}) {
  const P = fx.P.reset();
  P.x = x + rr(-0.3, 0.3) * s;
  P.y = y + 0.1;
  P.z = z + rr(-0.3, 0.3) * s;
  const a = o.ang ?? R() * TAU;
  const out = o.out ?? rr(0.6, 2.0) * s;
  P.vx = Math.cos(a) * out;
  P.vy = rr(0.3, 1.0) * (o.up ?? 1);
  P.vz = Math.sin(a) * out;
  P.tx = fx.wind.x * 1.4;
  P.ty = rr(0.15, 0.45);
  P.tz = fx.wind.z * 1.4;
  P.drag = o.drag ?? 1.4;
  P.life = o.life ?? rr(1.6, 3.2);
  P.s0 = s * rr(0.45, 0.75);
  P.s1 = s * rr(1.6, 2.6);
  P.rot = R() * TAU;
  P.spin = rr(-0.4, 0.4);
  P.frame = PF.SMOKE0 + ((R() * 4) | 0);
  P.ramp = o.ramp ?? RAMP.DUST;
  P.lit = 1;
  P.soft = 0.5;
  P.delay = o.delay || 0;
  if (o.color != null) tint(P, o.color, o.alpha ?? 1);
  fx.pSmoke();
}

function droplets(fx, x, y, z, n, o = {}) {
  for (let i = 0; i < n; i++) {
    const P = fx.P.reset();
    P.x = x + rr(-0.15, 0.15);
    P.y = y;
    P.z = z + rr(-0.15, 0.15);
    const a = R() * TAU;
    const out = (o.out ?? 1.6) * rr(0.2, 1);
    P.vx = Math.cos(a) * out + (o.dir ? o.dir.x * 2 : 0);
    P.vy = (o.up ?? 4.5) * rr(0.5, 1.15);
    P.vz = Math.sin(a) * out + (o.dir ? o.dir.z * 2 : 0);
    P.drag = 0.4;
    P.ty = -(o.gravity ?? 16) / P.drag;
    P.life = rr(0.5, 0.95) * (o.life ?? 1);
    const s = (o.size ?? 1) * rr(0.08, 0.16);
    P.s0 = s;
    P.s1 = s * 0.8;
    P.mode = 1;
    P.aspect = 1.1;
    P.stretch = 0.07;
    P.frame = PF.DROP;
    P.ramp = o.ramp ?? RAMP.WATER;
    P.lit = o.lit ?? 0.55;
    P.bright = 1.2;
    P.soft = 0.25;
    if (o.color != null) tint(P, o.color);
    fx.pSmoke();
  }
}

function glints(fx, x, y, z, n, o = {}) {
  if (!fx.tinyOK) n = Math.ceil(n * 0.25);
  for (let i = 0; i < n; i++) {
    const P = fx.P.reset();
    const r = (o.radius ?? 0.8) * Math.sqrt(R());
    const a = R() * TAU;
    P.x = x + Math.cos(a) * r;
    P.y = y + rr(0, o.height ?? 1);
    P.z = z + Math.sin(a) * r;
    P.vx = rr(-0.2, 0.2);
    P.vy = rr(0.3, 1.0) * (o.rise ?? 1);
    P.vz = rr(-0.2, 0.2);
    P.ty = (o.rise ?? 1) * 0.4;
    P.drag = 1.5;
    P.life = rr(0.6, 1.3) * (o.life ?? 1);
    const s = (o.size ?? 1) * rr(0.18, 0.36);
    P.s0 = s;
    P.s1 = s * 0.2;
    P.rot = R() * TAU;
    P.spin = rr(-3, 3);
    P.frame = PF.GLINT;
    P.ramp = o.ramp ?? RAMP.GOLD;
    P.bright = o.bright ?? 3;
    P.add = 1;
    P.soft = 0;
    P.delay = o.delay ? R() * o.delay : 0;
    if (o.color != null) tint(P, o.color);
    fx.pGlow();
  }
}

function flatRing(fx, x, y, z, size, o = {}) {
  const P = fx.P.reset();
  P.x = x;
  P.y = y + (o.lift ?? 0.06);
  P.z = z;
  P.life = o.life ?? 0.7;
  P.s0 = size * (o.from ?? 0.2);
  P.s1 = size;
  P.mode = 3;
  P.rot = R() * TAU;
  P.frame = o.frame ?? PF.RING;
  P.ramp = o.ramp ?? RAMP.SHOCK;
  P.bright = o.bright ?? 2;
  P.add = o.add ?? 1;
  P.lit = o.lit ?? 0;
  P.soft = 0;
  P.delay = o.delay || 0;
  if (o.color != null) tint(P, o.color, o.alpha ?? 1);
  (P.add > 0.5 ? fx.pGlow : fx.pSmoke).call(fx);
}

// Rising swirl of particles (magic, spawn, tornado-style).
function swirl(fx, x, y, z, n, o = {}) {
  for (let i = 0; i < n; i++) {
    const P = fx.P.reset();
    P.mode = 4;
    P.x = x;
    P.y = y + rr(0, o.y0 ?? 0.2);
    P.z = z;
    P.vx = (o.r0 ?? 0.6) * rr(0.6, 1.1); // radius
    P.vy = R() * TAU; // angle
    P.vz = (o.rise ?? 1.2) * rr(0.6, 1.3); // vertical speed
    P.tx = o.rRate ?? -0.15; // radius rate
    P.ty = (o.spin ?? 3) * (R() < 0.15 ? -1 : 1) * rr(0.7, 1.2);
    P.tz = 0;
    P.tw = 0;
    P.life = rr(0.8, 1.5) * (o.life ?? 1);
    const s = (o.size ?? 1) * rr(0.15, 0.3);
    P.s0 = s;
    P.s1 = s * 0.3;
    P.frame = o.frame ?? PF.GLINT;
    P.spin = rr(-3, 3);
    P.ramp = o.ramp ?? RAMP.MAGIC;
    P.bright = o.bright ?? 3;
    P.add = 1;
    P.soft = 0;
    if (o.color != null) tint(P, o.color);
    fx.pGlow();
  }
}

// ---- contract effect types --------------------------------------------------
export const PRESETS = {
  smoke(fx, p, o) {
    const s = o.scale ?? 1;
    const n = fx.k(o.count ?? 3);
    for (let i = 0; i < n; i++) smokePuff(fx, p.x, p.y + 0.2, p.z, { size: s, ramp: o.dark === false ? RAMP.SMOKE_LIGHT : RAMP.SMOKE_DARK, color: o.color, life: rr(3, 5) * Math.sqrt(s) });
  },

  fire(fx, p, o) {
    const s = o.scale ?? 1;
    const n = fx.k(o.count ?? 4);
    for (let i = 0; i < n; i++) flame(fx, p.x + rr(-0.4, 0.4) * s, p.y + 0.02, p.z + rr(-0.4, 0.4) * s, rr(0.5, 0.95) * s, { color: o.color });
    if (R() < 0.7) ember(fx, p.x, p.y + 0.4 * s, p.z);
    if (R() < 0.5) smokePuff(fx, p.x, p.y + 0.8 * s, p.z, { size: 0.7 * s, ramp: RAMP.FIRE_SMOKE, glow: 0.5 });
  },

  embers(fx, p, o) {
    const n = fx.k(o.count ?? 8);
    for (let i = 0; i < n; i++) ember(fx, p.x, p.y + 0.2, p.z, { size: o.scale ?? 1, speed: o.scale ?? 1 });
  },

  explosion(fx, p, o) {
    const s = o.scale ?? 1;
    const { x, z } = p;
    const y = p.y;
    // brief white-hot core (small, so bloom does not wash the frame out)
    glowFlash(fx, x, y + 0.6 * s, z, 3.2 * s, { life: 0.18, bright: 2.2, ramp: RAMP.FLASH, color: 0xffe8c0 });
    // fireball: ALPHA-blended billows with a hot shell and a sooty core,
    // 2-3x the blast scale, so it occludes the ground and reads as mass
    const nb = fx.k(22 * Math.sqrt(s));
    for (let i = 0; i < nb; i++) {
      const P = fx.P.reset();
      const a = R() * TAU,
        el = rr(0.2, 1.45);
      const v = rr(2.5, 7) * Math.sqrt(s);
      P.x = x + rr(-0.3, 0.3) * s;
      P.y = y + 0.4 * s;
      P.z = z + rr(-0.3, 0.3) * s;
      P.vx = Math.cos(a) * Math.cos(el) * v;
      P.vy = Math.sin(el) * v * 1.2;
      P.vz = Math.sin(a) * Math.cos(el) * v;
      P.tx = fx.wind.x;
      P.ty = 2.2;
      P.tz = fx.wind.z;
      P.drag = 2.2;
      P.life = rr(1.6, 2.6);
      P.s0 = s * rr(1.4, 2.0);
      P.s1 = s * rr(4.2, 6.0);
      P.rot = R() * TAU;
      P.spin = rr(-0.8, 0.8);
      P.frame = PF.SMOKE0 + ((R() * 4) | 0);
      P.ramp = RAMP.FIREBALL;
      P.heat = 0.32;
      P.bright = 2.4;
      P.lit = 0.45;
      P.glow = 1.2;
      P.add = 0;
      P.soft = 0.25;
      fx.pSmoke();
    }
    sparks(fx, x, y + 0.3 * s, z, fx.k(8 * Math.sqrt(s)), { speed: 11 * Math.sqrt(s), up: true, size: 1.6, stretch: 0.09, bright: 2.5 });
    const ns = fx.k(12 * Math.sqrt(s));
    for (let i = 0; i < ns; i++) {
      const a = R() * TAU;
      smokePuff(fx, x + Math.cos(a) * 0.5 * s, y + rr(0.8, 2.4) * s, z + Math.sin(a) * 0.5 * s, {
        size: 1.8 * s,
        grow: 3,
        ramp: RAMP.SMOKE_BLACK,
        glow: 0.6,
        rise: 2.2 * Math.sqrt(s),
        drift: 3.8,
        vx: Math.cos(a) * 1.4 * s,
        vz: Math.sin(a) * 1.4 * s,
        life: rr(6, 9) * Math.sqrt(s),
        delay: rr(0.3, 0.9),
      });
    }
    // opaque ground-hugging dust ring racing outward
    const nr = fx.k(26 * Math.sqrt(s));
    for (let i = 0; i < nr; i++) {
      const a = (i / nr) * TAU + R() * 0.15;
      dustPuff(fx, x + Math.cos(a) * 0.5 * s, y, z + Math.sin(a) * 0.5 * s, 1.1 * s, { ang: a, out: rr(6, 9) * s, drag: 2.0, life: rr(2.2, 3.4), up: 0.35, ramp: RAMP.DUST_THICK });
    }
    fx.shockwave(x, z, 5.5 * s, { life: 0.55 });
    fx.decal({ frame: DF.BLAST, x, z, size: 3.4 * s, life: 50, color: 0x161210, alpha: 0.85, fadeIn: 0.002, fadeOut: 0.8 });
    fx.decal({ frame: DF.GLOW, x, z, size: 2.6 * s, life: 3.5, additive: true, color: 0xff8030, intensity: 1.4, cool: 1, fadeIn: 0.01, fadeOut: 0.3 });
    fx.addLight({ x, y: y + 1.5 * s, z }, 0xff8a40, 3 * s, 0.9);
    fx.shake(x, z, 0.7 * s);
    const nd = Math.round(3 * s);
    for (let i = 0; i < nd; i++) {
      const a = R() * TAU,
        v = rr(3, 7);
      fx.debris.spawn({ x, y: y + 0.3, z, vx: Math.cos(a) * v * 0.6, vy: rr(5, 9), vz: Math.sin(a) * v * 0.6, size: rr(0.15, 0.3) * Math.sqrt(s), color: 0x4a403a, heat: 0.6, cool: 0.4, trail: TRAIL.FIRE, life: rr(4, 7) });
    }
  },

  dust(fx, p, o) {
    const s = o.scale ?? 1;
    const n = fx.k(o.count ?? 5);
    for (let i = 0; i < n; i++) dustPuff(fx, p.x, p.y, p.z, s, { color: o.color });
  },

  splash(fx, p, o) {
    const s = o.scale ?? 1;
    const y = Math.max(p.y, 0);
    droplets(fx, p.x, y + 0.05, p.z, fx.k(14 * s), { up: 4.5 * Math.sqrt(s), out: 1.6 * s, size: Math.sqrt(s), dir: o.dir });
    const nc = fx.k(4 * Math.sqrt(s));
    for (let i = 0; i < nc; i++) {
      const P = fx.P.reset();
      P.x = p.x + rr(-0.2, 0.2) * s;
      P.y = y + 0.1;
      P.z = p.z + rr(-0.2, 0.2) * s;
      P.vx = rr(-0.4, 0.4) * s;
      P.vy = rr(1.8, 3.4) * Math.sqrt(s);
      P.vz = rr(-0.4, 0.4) * s;
      P.ty = -1.5;
      P.drag = 1.6;
      P.life = rr(0.7, 1.2) * Math.sqrt(s);
      P.s0 = 0.35 * s;
      P.s1 = 1.2 * s;
      P.rot = R() * TAU;
      P.frame = PF.SMOKE0 + ((R() * 4) | 0);
      P.ramp = RAMP.SPLASH;
      P.lit = 0.65;
      P.bright = 1.2;
      P.soft = 0.2;
      fx.pSmoke();
    }
    flatRing(fx, p.x, 0, p.z, 2.4 * s, { frame: PF.RING, ramp: RAMP.SPLASH, add: 0, lit: 0.6, life: 1.2, lift: 0.03, alpha: 0.75 });
    fx.decal({ frame: DF.RIPPLE, x: p.x, z: p.z, size: 1.2 * s, grow: 3.2, life: 2.2, additive: true, surface: 1, color: 0xcfefff, intensity: 0.55, fadeIn: 0.01, fadeOut: 0.2, grain: 0 });
  },

  sparkle(fx, p, o) {
    const s = o.scale ?? 1;
    glints(fx, p.x, p.y + 0.3, p.z, fx.k(o.count ?? 8), { radius: 0.7 * s, height: 1.2 * s, size: s, color: o.color, ramp: RAMP.GOLD, delay: 0.3 });
  },

  blood(fx, p, o) {
    const s = o.scale ?? 1;
    droplets(fx, p.x, p.y + 0.45, p.z, fx.k(o.count ?? 7), { up: 2.6, out: 1.4, size: 0.8 * s, ramp: RAMP.BLOOD, lit: 0.8, color: o.color, dir: o.dir, gravity: 14 });
    if (R() < 0.6) fx.decal({ frame: DF.SPLAT, x: p.x + rr(-0.2, 0.2), z: p.z + rr(-0.2, 0.2), size: rr(0.5, 0.8) * s, life: 22, color: o.color ?? 0x5a0606, alpha: 0.8, fadeIn: 0.003, fadeOut: 0.6, grain: 0.3 });
  },

  debris(fx, p, o) {
    const s = o.scale ?? 1;
    const n = Math.max(1, Math.round((o.count ?? 4) * Math.min(1, fx.budget + 0.3)));
    for (let i = 0; i < n; i++) {
      const a = R() * TAU,
        v = rr(1.5, 4) * Math.sqrt(s);
      const d = o.dir || { x: 0, y: 0, z: 0 };
      fx.debris.spawn({ x: p.x, y: p.y + 0.3, z: p.z, vx: Math.cos(a) * v + d.x * 4, vy: rr(3.5, 7) * Math.sqrt(s) + d.y * 4, vz: Math.sin(a) * v + d.z * 4, size: rr(0.12, 0.28) * s, color: o.color ?? 0x7a7068, life: rr(3, 6) });
    }
    dustPuff(fx, p.x, p.y, p.z, 0.6 * s, {});
  },

  heal(fx, p, o) {
    const s = o.scale ?? 1;
    glints(fx, p.x, p.y + 0.1, p.z, fx.k(o.count ?? 7), { radius: 0.45 * s, height: 0.8 * s, size: 0.8 * s, ramp: RAMP.HEAL, color: o.color, rise: 1.3 });
    glowFlash(fx, p.x, p.y + 0.6 * s, p.z, 1.4 * s, { life: 0.6, bright: 1.6, ramp: RAMP.HEAL, from: 0.3 });
    flatRing(fx, p.x, p.y, p.z, 1.6 * s, { ramp: RAMP.HEAL, life: 0.7, bright: 1.5 });
  },

  spawn(fx, p, o) {
    const s = o.scale ?? 1;
    flatRing(fx, p.x, p.y, p.z, 2.0 * s, { ramp: RAMP.MAGIC, life: 0.6, bright: 2.2, color: o.color ?? 0xd8f0ff });
    swirl(fx, p.x, p.y, p.z, fx.k(10 * s), { r0: 0.5 * s, rise: 1.6, spin: 4, size: 0.7 * s, ramp: RAMP.MAGIC, color: o.color ?? 0xe0f4ff, life: 0.8 });
    glowFlash(fx, p.x, p.y + 0.5, p.z, 1.6 * s, { life: 0.4, bright: 2, ramp: RAMP.FLASH, color: o.color ?? 0xd8ecff });
    dustPuff(fx, p.x, p.y, p.z, 0.4 * s, { out: 1.5, life: 1.2 });
  },

  lightning(fx, p, o) {
    const s = o.scale ?? 1;
    const top = p.y + 40 + R() * 20;
    fx.beams.bolt(p.x + rr(-6, 6), top, p.z + rr(-6, 6), p.x, p.y, p.z, { width: 0.32 * s, life: 0.45, color: o.color ?? 0xc8dcff, branches: 4 });
    glowFlash(fx, p.x, p.y + 0.6, p.z, 5 * s, { life: 0.35, bright: 5, color: o.color ?? 0xd0e0ff });
    sparks(fx, p.x, p.y + 0.2, p.z, fx.k(16 * s), { speed: 6, ramp: RAMP.ELECTRIC, bright: 4, up: true });
    fx.addLight({ x: p.x, y: p.y + 4, z: p.z }, o.color ?? 0xb8d0ff, 5 * s, 0.35);
  },

  steam(fx, p, o) {
    const s = o.scale ?? 1;
    const n = fx.k(o.count ?? 4);
    for (let i = 0; i < n; i++)
      smokePuff(fx, p.x + rr(-0.4, 0.4) * s, p.y + 0.1, p.z + rr(-0.4, 0.4) * s, { size: 0.75 * s, ramp: RAMP.STEAM, rise: 1.8, drift: 2.6, life: rr(1.8, 3.2), lit: 0.85, color: o.color });
  },

  // towering billowing steam (lava meeting the sea)
  steamColumn(fx, p, o) {
    const s = o.scale ?? 1;
    for (let i = 0; i < fx.k(o.count ?? 2); i++)
      smokePuff(fx, p.x + rr(-0.6, 0.6) * s, p.y + rr(0, 0.6), p.z + rr(-0.6, 0.6) * s, {
        size: rr(1.6, 2.4) * s,
        grow: 3.4,
        ramp: RAMP.STEAM,
        rise: rr(2.6, 3.6),
        drift: 2.6,
        drag: 0.45,
        life: rr(6, 9),
        lit: 0.9,
        alpha: 1,
      });
  },

  magic(fx, p, o) {
    const s = o.scale ?? 1;
    swirl(fx, p.x, p.y, p.z, fx.k(o.count ?? 12), { r0: 0.7 * s, rise: 1.2, spin: 3.5, size: s, ramp: RAMP.MAGIC, color: o.color });
    glowFlash(fx, p.x, p.y + 0.6 * s, p.z, 1.8 * s, { life: 0.5, bright: 2, ramp: RAMP.MAGIC, color: o.color, from: 0.4 });
  },

  leaves(fx, p, o) {
    const s = o.scale ?? 1;
    const n = fx.k(o.count ?? 6);
    const col = o.color ?? 0x5aa040;
    for (let i = 0; i < n; i++) {
      const P = fx.P.reset();
      P.x = p.x + rr(-0.5, 0.5) * s;
      P.y = p.y + rr(0.6, 1.6) * s;
      P.z = p.z + rr(-0.5, 0.5) * s;
      const d = o.dir || { x: 0, y: 0, z: 0 };
      P.vx = rr(-1.2, 1.2) + d.x * 3;
      P.vy = rr(0.5, 2) + d.y * 3;
      P.vz = rr(-1.2, 1.2) + d.z * 3;
      P.tx = fx.wind.x * 1.8;
      P.ty = -0.9;
      P.tz = fx.wind.z * 1.8;
      P.drag = 1.6;
      P.life = rr(1.8, 3.2);
      const sz = rr(0.14, 0.24) * s;
      P.s0 = sz;
      P.s1 = sz;
      P.rot = R() * TAU;
      P.spin = rr(-5, 5);
      P.frame = PF.LEAF;
      P.ramp = RAMP.SOLID;
      P.lit = 1;
      P.soft = 0.2;
      const c = lin(col);
      const v = rr(0.75, 1.2);
      P.r = c.r * v;
      P.g = c.g * v;
      P.b = c.b * v;
      fx.pSmoke();
    }
  },

  snowpuff(fx, p, o) {
    const s = o.scale ?? 1;
    for (let i = 0; i < fx.k(o.count ?? 4); i++) dustPuff(fx, p.x, p.y, p.z, 0.6 * s, { ramp: RAMP.SNOW, life: rr(1, 2), out: rr(0.5, 1.5) });
    glints(fx, p.x, p.y + 0.2, p.z, fx.k(5), { radius: 0.6 * s, height: 0.6, size: 0.5 * s, ramp: RAMP.SNOW, rise: -0.2, bright: 1.6 });
  },

  build(fx, p, o) {
    const s = o.scale ?? 1;
    for (let i = 0; i < fx.k(o.count ?? 4); i++) dustPuff(fx, p.x, p.y, p.z, 0.55 * s, { ramp: RAMP.BUILD, life: rr(1, 1.8), out: rr(0.8, 1.8) });
    glints(fx, p.x, p.y + 0.4, p.z, fx.k(4), { radius: 0.6 * s, height: 0.8, size: 0.6 * s, ramp: RAMP.GOLD });
    for (let i = 0; i < 2; i++) {
      const a = R() * TAU;
      fx.debris.spawn({ x: p.x, y: p.y + 0.5, z: p.z, vx: Math.cos(a) * 1.5, vy: rr(2.5, 4), vz: Math.sin(a) * 1.5, size: rr(0.08, 0.14) * s, color: 0xa07848, wood: true, life: rr(1.5, 2.5) });
    }
  },

  death(fx, p, o) {
    const s = o.scale ?? 1;
    glowFlash(fx, p.x, p.y + 0.5, p.z, 1.1 * s, { life: 0.5, bright: 1.4, ramp: RAMP.DEATH, from: 0.4 });
    const P = fx.P.reset();
    P.x = p.x;
    P.y = p.y + 0.5;
    P.z = p.z;
    P.vy = 1.4;
    P.ty = 0.9;
    P.tx = fx.wind.x * 0.5;
    P.tz = fx.wind.z * 0.5;
    P.drag = 1;
    P.life = 1.6;
    P.s0 = 0.5 * s;
    P.s1 = 0.15 * s;
    P.frame = PF.GLOW;
    P.ramp = RAMP.DEATH;
    P.bright = 1.8;
    P.add = 1;
    fx.pGlow();
    for (let i = 0; i < fx.k(3); i++) dustPuff(fx, p.x, p.y, p.z, 0.4 * s, { ramp: RAMP.DUST, life: rr(0.8, 1.4), out: rr(0.5, 1.2), color: o.color });
  },

  // ---- extra types (also usable by other modules) --------------------------
  flame(fx, p, o) {
    flame(fx, p.x, p.y, p.z, o.scale ?? 1, { color: o.color });
  },
  sparks(fx, p, o) {
    sparks(fx, p.x, p.y + 0.1, p.z, fx.k(o.count ?? 10), { speed: 5 * (o.scale ?? 1), dir: o.dir, color: o.color, up: true });
  },
  shockwave(fx, p, o) {
    fx.shockwave(p.x, p.z, 4 * (o.scale ?? 1), { color: o.color });
  },
  miasma(fx, p, o) {
    const s = o.scale ?? 1;
    for (let i = 0; i < fx.k(o.count ?? 2); i++) {
      const P = fx.P.reset();
      P.x = p.x + rr(-0.6, 0.6) * s;
      P.y = p.y + rr(0.1, 0.6);
      P.z = p.z + rr(-0.6, 0.6) * s;
      P.vx = rr(-0.3, 0.3);
      P.vy = rr(0.1, 0.4);
      P.vz = rr(-0.3, 0.3);
      P.tx = fx.wind.x * 0.8;
      P.ty = 0.12;
      P.tz = fx.wind.z * 0.8;
      P.drag = 0.8;
      P.life = rr(2.5, 4.5);
      P.s0 = 0.6 * s;
      P.s1 = 1.8 * s;
      P.rot = R() * TAU;
      P.spin = rr(-0.3, 0.3);
      P.frame = PF.SMOKE0 + ((R() * 4) | 0);
      P.ramp = RAMP.MIASMA;
      P.lit = 0.75;
      P.bright = 1.3;
      P.glow = 0.15;
      P.soft = 0.6;
      if (o.color != null) tint(P, o.color);
      fx.pSmoke();
    }
  },
  ash(fx, p, o) {
    if (!fx.tinyOK) return;
    const s = o.scale ?? 1;
    for (let i = 0; i < fx.k(o.count ?? 4); i++) {
      const P = fx.P.reset();
      P.x = p.x + rr(-3, 3) * s;
      P.y = p.y + rr(4, 9) * s;
      P.z = p.z + rr(-3, 3) * s;
      P.tx = fx.wind.x * 2;
      P.ty = -rr(0.6, 1.2);
      P.tz = fx.wind.z * 2;
      P.vx = P.tx;
      P.vy = P.ty;
      P.vz = P.tz;
      P.drag = 1;
      P.life = rr(3, 6);
      const sz = rr(0.05, 0.1);
      P.s0 = sz;
      P.s1 = sz;
      P.rot = R() * TAU;
      P.spin = rr(-4, 4);
      P.frame = PF.CHUNK;
      P.ramp = RAMP.ASH;
      P.lit = 1;
      P.soft = 0.2;
      fx.pSmoke();
    }
  },
  lavaPop(fx, p, o) {
    const s = o.scale ?? 1;
    sparks(fx, p.x, p.y + 0.05, p.z, fx.k(5 * s), { speed: 3.5 * s, ramp: RAMP.LAVA, up: true, gravity: 12, size: 1.6, bright: 3.5 });
    glowFlash(fx, p.x, p.y + 0.2, p.z, 0.9 * s, { life: 0.35, bright: 2.4, ramp: RAMP.LAVA, from: 0.5 });
    if (R() < 0.5) smokePuff(fx, p.x, p.y + 0.3, p.z, { size: 0.5 * s, ramp: RAMP.HOT_SMOKE, glow: 0.6, life: rr(1.5, 2.5), rise: 1.2 });
  },
  fireball(fx, p, o) {
    const s = o.scale ?? 1;
    for (let i = 0; i < fx.k(o.count ?? 6); i++) {
      const P = fx.P.reset();
      P.x = p.x + rr(-0.3, 0.3) * s;
      P.y = p.y + rr(0, 0.4) * s;
      P.z = p.z + rr(-0.3, 0.3) * s;
      const d = o.dir || { x: 0, y: 1, z: 0 };
      P.vx = rr(-1, 1) * s + d.x * 3;
      P.vy = rr(0.5, 2) * s + d.y * 3;
      P.vz = rr(-1, 1) * s + d.z * 3;
      P.tx = fx.wind.x;
      P.ty = 1.5;
      P.tz = fx.wind.z;
      P.drag = 2;
      P.life = rr(0.5, 0.9);
      P.s0 = 0.8 * s;
      P.s1 = 1.8 * s;
      P.rot = R() * TAU;
      P.spin = rr(-1, 1);
      P.frame = PF.SMOKE0 + ((R() * 4) | 0);
      P.ramp = RAMP.EXPLOSION;
      P.heat = 0.3;
      P.bright = 3;
      P.add = 0.9;
      P.soft = 0.3;
      fx.pGlow();
    }
  },
};

export { smokePuff as _smokePuff, dustPuff, droplets, glints, flatRing, swirl };
