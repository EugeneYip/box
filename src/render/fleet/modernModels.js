import { VB, figure, wheel, addBuilders } from './models.js';
import { shade } from '../buildings/geom.js';

// Original low-poly models of the modern and future vehicles (docs/MODERN-ERAS.md,
// docs/TECH-BREADTH.md): steel ships from steamers to carriers and the
// advanced boats, trains, road traffic, guns and armour, and the civic
// vehicles. Built like the old kinds (models.js): faces +X, waterline or
// ground at y = 0, design size (the kinds' `scale` brings them to the world),
// vertex colours, aTint realm colour, aGlow lamps:
//   glow 1 warm windows at night, 2 navigation lights (lit at night, the
//   beacon blinks), 3 an emergency light bar (flashes on a call), 4 flame.
// aAnim kinds beyond models.js: 11 turret (yaws about yzw by the aim),
// 12 propeller (spins about X at yzw), 13 rotor (spins about Y at yzw),
// 15 rocket plume (scales with thrust from yzw).
// Every builder takes `lo`: the distant model, the hull and its blocks only.
// Returns {geo, flags, smoke: [{x, y, z}], length}.

const STEEL = 0x707780;
const STEEL2 = 0x5d636b;
const DARK = 0x2a2e33;
const BLACK = 0x1f2125;
const RED = 0x8a2e24;
const WHITE = 0xe8e8e2;
const CREAM = 0xd8cdb0;
const DECKG = 0x77746a;
const WOODDECK = 0xa88a5e;
const WIN = 0x34404c;
const GLASS = 0x2c4050;
const NAVR = 0xff3020;
const NAVG = 0x30ff60;
const NAVW = 0xfff4d8;
const BOX = [0xb83b2c, 0x2f7fb8, 0xd08a1c, 0x2a8a4c, 0x7c4396, 0xc9ccce, 0x8a3a26, 0x3a5a8a];

// ---------------------------------------------------------------- parts
// A steel hull: a full midship body, a raked stem and a transom stern, a
// realm-coloured band under the deck edge, black boot-topping and red below.
function steelHull(g, o) {
  const { L, W, H, D } = o;
  const N = o.n ?? 10;
  const st = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = -L / 2 + t * L;
    const fs = o.fullS ?? 0.22,
      fb = o.fullB ?? 0.62;
    let wf = t < fs ? (o.transom ?? 0.82) + (1 - (o.transom ?? 0.82)) * Math.sin((t / fs) * Math.PI * 0.5) : t <= fb ? 1 : Math.pow(Math.max(0, 1 - (t - fb) / (1 - fb)), o.bowPow ?? 1.6);
    if (i === N) wf = 0;
    const gy = H + (o.sheer ?? 0.04) * Math.pow(Math.max(0, t - 0.6) / 0.4, 2) + (o.bowRise ?? 0) * Math.pow(Math.max(0, t - 0.75) / 0.25, 2);
    const kx = x - Math.pow(t, 6) * (o.rake ?? L * 0.06) + Math.pow(1 - t, 8) * L * 0.02;
    st.push({ x, hw: (W / 2) * wf, gy, kx, ky: -D * (0.6 + 0.4 * Math.sin(Math.min(1, t * 1.2) * Math.PI * 0.5)) });
  }
  const col = o.col ?? DARK,
    low = o.low ?? RED,
    deck = o.deck ?? DECKG;
  const band = o.band ?? 0.05;
  for (let i = 0; i < N; i++) {
    const a = st[i],
      b = st[i + 1];
    const ctr = [(a.x + b.x) / 2, 0, 0];
    for (const s of [-1, 1]) {
      const P = (p, y, k = 1) => [p.x + (p.kx - p.x) * Math.max(0, -y / D) * 0.9, y, s * p.hw * k];
      if (o.band !== 0) g.quad(P(a, a.gy), P(b, b.gy), P(b, b.gy - band), P(a, a.gy - band), 0xffffff, 1, 0, ctr);
      g.quad(P(a, a.gy - band), P(b, b.gy - band), P(b, 0.03), P(a, 0.03), col, 0, 0, ctr);
      g.quad(P(a, 0.03), P(b, 0.03), P(b, -0.03, 0.98), P(a, -0.03, 0.98), BLACK, 0, 0, ctr);
      g.quad(P(a, -0.03, 0.98), P(b, -0.03, 0.98), [b.kx, b.ky, 0], [a.kx, a.ky, 0], low, 0, 0, ctr);
    }
    g.quad([a.x, a.gy, -a.hw], [b.x, b.gy, -b.hw], [b.x, b.gy, b.hw], [a.x, a.gy, a.hw], i % 2 ? deck : shade(deck, 0.95), 0, 0, [(a.x + b.x) / 2, -5, 0]);
  }
  // transom
  const s0 = st[0];
  g.quad([s0.x, s0.gy, -s0.hw], [s0.x, s0.gy, s0.hw], [s0.kx, 0, s0.hw * 0.95], [s0.kx, 0, -s0.hw * 0.95], col, 0, 0, [s0.x + 1, 0, 0]);
  g.quad([s0.kx, 0, -s0.hw * 0.95], [s0.kx, 0, s0.hw * 0.95], [s0.kx, s0.ky, 0], [s0.kx, s0.ky, 0.001], low, 0, 0, [s0.x + 1, 0, 0]);
  return st;
}
function hwAt(st, x) {
  for (let i = 0; i < st.length - 1; i++) if (x >= st[i].x && x <= st[i + 1].x) {
    const t = (x - st[i].x) / (st[i + 1].x - st[i].x || 1);
    return { hw: st[i].hw + (st[i + 1].hw - st[i].hw) * t, gy: st[i].gy + (st[i + 1].gy - st[i].gy) * t };
  }
  return st[x < st[0].x ? 0 : st.length - 1];
}
// A deckhouse with a strip of windows down each side (lit at night).
function house(g, x, y, lx, h, wz, col, o = {}) {
  g.box(x, y, 0, lx, h, wz, col, { top: o.top ?? shade(col, 0.9) });
  if (o.win !== false) {
    const wy = y + h * 0.45,
      wh = Math.min(0.06, h * 0.35);
    for (const s of [-1, 1]) g.box(x, wy, s * (wz / 2 + 0.004), lx * 0.86, wh, 0.01, WIN, { glow: o.glow ?? 1 });
    if (o.front !== false) g.box(x + lx / 2 + 0.004, wy, 0, 0.01, wh, wz * 0.8, GLASS, { glow: (o.glow ?? 1) * 0.6 });
  }
}
function funnel(g, x, y, r, h, o = {}) {
  g.cyl(x, y, 0, r, h, 8, o.col ?? 0x2a2a2a, { r2: r * 0.92 });
  g.cyl(x, y + h * 0.55, 0, r * 1.02, h * 0.22, 8, 0xffffff, { tint: 1, cap: false });
  g.cyl(x, y + h - 0.02, 0, r * 0.93, 0.04, 8, BLACK);
  return { x, y: y + h + 0.02, z: 0 };
}
function navLights(g, x, y, hw, top = null) {
  g.box(x, y, -hw - 0.012, 0.03, 0.03, 0.02, NAVR, { glow: 2 });
  g.box(x, y, hw + 0.012, 0.03, 0.03, 0.02, NAVG, { glow: 2 });
  if (top) g.box(top[0], top[1], 0, 0.035, 0.035, 0.035, NAVW, { glow: 2 });
}
function radarMast(g, x, y, h) {
  g.cyl(x, y, 0, 0.022, h, 5, STEEL2);
  g.beam(x, y + h * 0.75, -0.14, x, y + h * 0.75, 0.14, 0.02, STEEL2);
  g.box(x, y + h * 0.85, 0, 0.04, 0.03, 0.2, WHITE);
  return [x, y + h + 0.02];
}
// A gun turret that trains on the enemy (anim 11, pivot at its centre).
function turret(g, x, y, r, dir = 1, guns = 2, len = 0.42) {
  g.setAnim(11, x, y, 0);
  g.cyl(x, y, 0, r, 0.06, 8, STEEL2);
  g.box(x - dir * r * 0.15, y + 0.04, 0, r * 1.7, 0.12, r * 1.5, STEEL, { top: shade(STEEL, 1.1) });
  for (let i = 0; i < guns; i++) {
    const z = guns === 1 ? 0 : (i - (guns - 1) / 2) * r * 0.55;
    g.beam(x + dir * r * 0.6, y + 0.11, z, x + dir * (r * 0.6 + len), y + 0.13, z, 0.035, DARK);
  }
  g.setAnim(0);
}
function containers(g, x0, x1, y, hw, tiers, seed, lo) {
  const bl = 0.3,
    n = Math.max(1, Math.floor((x1 - x0) / (bl + 0.02)));
  const across = Math.max(1, Math.floor((hw * 2) / 0.17));
  if (lo) {
    for (let i = 0; i < n; i += 2) g.box(x0 + (i + 1) * (bl + 0.02), y, 0, (bl + 0.02) * 2 - 0.02, 0.13 * tiers, hw * 2, BOX[(i + seed) % BOX.length]);
    return;
  }
  for (let i = 0; i < n; i++)
    for (let j = 0; j < across; j++)
      for (let k = 0; k < tiers; k++) {
        const c = (i * 7 + j * 3 + k * 5 + seed) % 11;
        const tint = c === 10 ? 1 : 0;
        g.box(x0 + (i + 0.5) * (bl + 0.02), y + k * 0.13, -hw + (j + 0.5) * ((hw * 2) / across), bl, 0.125, (hw * 2) / across - 0.012, tint ? 0xffffff : BOX[c % BOX.length], { tint, noTop: k < tiers - 1 });
      }
}
const done = (g, length, flags = [], smoke = []) => ({ geo: g.build(), flags, smoke, length });

// ---------------------------------------------------------------- sea, Industrial
function steamer(lo) {
  const g = new VB(201);
  const st = steelHull(g, { L: 3.0, W: 0.66, H: 0.32, D: 0.24, col: BLACK, deck: WOODDECK, bowRise: 0.05, rake: 0.12 });
  house(g, 0.05, st[5].gy, 0.9, 0.2, 0.42, CREAM, { top: WOODDECK });
  house(g, 0.2, st[5].gy + 0.2, 0.32, 0.14, 0.34, WHITE);
  const sm = funnel(g, -0.15, st[5].gy + 0.2, 0.09, 0.62, { col: 0x3a2a22 });
  if (!lo) {
    for (const x of [0.95, -1.0]) {
      g.cyl(x, st[3].gy, 0, 0.025, 1.0, 5, 0x5a3a22);
      g.beam(x, st[3].gy + 0.78, -0.24, x, st[3].gy + 0.78, 0.24, 0.025, 0x5a3a22);
    }
    g.beam(0.95, st[3].gy + 1.0, 0, 1.45, st[9].gy, 0, 0.012, 0x3a3028);
    g.beam(-1.0, st[3].gy + 1.0, 0, -1.48, st[0].gy, 0, 0.012, 0x3a3028);
    for (const s of [-1, 1]) g.cyl(-0.55, st[2].gy, s * 0.2, 0.05, 0.08, 6, WHITE); // lifeboats
    figure(g, 0.25, st[5].gy + 0.34, 0.08, 3, 1.2);
    navLights(g, 0.3, st[5].gy + 0.3, 0.18, [0.95, st[3].gy + 1.04]);
  }
  return done(g, 3.0, [{ x: -1.0, y: st[3].gy + 1.05, z: 0, s: 1.1 }], [sm]);
}
function ironclad(lo) {
  const g = new VB(203);
  const st = steelHull(g, { L: 3.0, W: 0.7, H: 0.16, D: 0.26, col: 0x2e3034, deck: 0x55524a, band: 0.03, rake: -0.18, transom: 0.7 });
  // the armoured casemate with its gun ports
  g.box(-0.05, st[5].gy, 0, 1.2, 0.26, 0.56, 0x3a3c40, { top: 0x4a4a44 });
  if (!lo) for (const s of [-1, 1]) for (let i = 0; i < 4; i++) g.box(-0.5 + i * 0.3, st[5].gy + 0.1, s * 0.285, 0.07, 0.06, 0.02, BLACK);
  turret(g, 0.95, st[7].gy, 0.17, 1, 1, 0.36);
  const sm = funnel(g, -0.1, st[5].gy + 0.26, 0.1, 0.5, { col: 0x2a2a2a });
  if (!lo) {
    g.cyl(0.35, st[5].gy + 0.26, 0, 0.02, 0.7, 5, 0x3a3028);
    navLights(g, 0.5, st[5].gy + 0.32, 0.2, [0.35, st[5].gy + 0.98]);
  }
  return done(g, 3.0, [{ x: -1.3, y: st[1].gy + 0.45, z: 0, s: 1.1 }], [sm]);
}
// ---------------------------------------------------------------- sea, Modern
function freighter(lo) {
  const g = new VB(205);
  const st = steelHull(g, { L: 3.4, W: 0.7, H: 0.34, D: 0.26, col: 0x6a2a24, deck: 0x6e6a5e, bowRise: 0.06 });
  // bridge aft, holds and derricks forward
  house(g, -1.1, st[2].gy, 0.55, 0.36, 0.56, WHITE);
  house(g, -1.05, st[2].gy + 0.36, 0.36, 0.14, 0.62, WHITE);
  const sm = funnel(g, -1.35, st[2].gy + 0.3, 0.09, 0.42, { col: 0x2b2b2b });
  for (const x of [-0.35, 0.3, 0.95]) g.box(x, st[5].gy, 0, 0.44, 0.06, 0.4, 0x4a5058);
  if (!lo) {
    for (const x of [-0.02, 0.62]) {
      g.cyl(x, st[5].gy, 0, 0.03, 0.75, 5, 0xc8a040);
      g.beam(x, st[5].gy + 0.1, 0, x + 0.3, st[5].gy + 0.6, 0, 0.02, 0xc8a040);
      g.beam(x, st[5].gy + 0.1, 0, x - 0.3, st[5].gy + 0.6, 0, 0.02, 0xc8a040);
    }
    for (const x of [-0.35, 0.95]) g.box(x, st[5].gy + 0.06, 0, 0.3, 0.1, 0.3, BOX[(x * 10) & 7]);
    navLights(g, -0.88, st[2].gy + 0.42, 0.31, radarMast(g, -1.0, st[2].gy + 0.5, 0.35));
  }
  return done(g, 3.4, [{ x: -1.65, y: st[0].gy + 0.4, z: 0, s: 1 }], [sm]);
}
function battleship(lo) {
  const g = new VB(207);
  const st = steelHull(g, { L: 4.4, W: 0.82, H: 0.26, D: 0.3, col: STEEL, low: 0x6a2c26, deck: 0x8a826e, band: 0.03, bowRise: 0.08, rake: 0.2, n: 12 });
  // superstructure: a stepped tower, two funnels, a tripod mast
  g.box(0.1, st[6].gy, 0, 1.3, 0.22, 0.52, STEEL, { top: shade(STEEL, 1.08) });
  house(g, 0.45, st[6].gy + 0.22, 0.45, 0.26, 0.4, STEEL, { glow: 0.5 });
  house(g, 0.5, st[6].gy + 0.48, 0.3, 0.16, 0.3, STEEL2, { glow: 0.5 });
  const s1 = funnel(g, -0.05, st[6].gy + 0.22, 0.1, 0.42, { col: STEEL2 });
  const s2 = funnel(g, -0.35, st[6].gy + 0.22, 0.1, 0.36, { col: STEEL2 });
  turret(g, 1.15, hwAt(st, 1.15).gy, 0.2, 1, 3);
  turret(g, 0.8, hwAt(st, 0.8).gy + 0.12, 0.2, 1, 3);
  if (!lo) g.cyl(0.8, hwAt(st, 0.8).gy, 0, 0.16, 0.12, 8, STEEL2);
  turret(g, -1.2, hwAt(st, -1.2).gy, 0.2, -1, 3);
  if (!lo) {
    for (const s of [-1, 1]) for (const x of [-0.4, 0.05, 0.5]) turret(g, x, st[6].gy, 0.07, 1, 1, 0.18 + 0 * s);
    const mx = 0.4,
      my = st[6].gy + 0.64;
    for (const [dx, dz] of [[0.12, 0], [-0.08, 0.1], [-0.08, -0.1]]) g.beam(mx + dx, st[6].gy + 0.22, dz, mx, my + 0.4, 0, 0.02, STEEL2);
    g.box(mx, my + 0.4, 0, 0.14, 0.08, 0.14, STEEL2);
    navLights(g, 0.65, st[6].gy + 0.3, 0.21, [mx, my + 0.52]);
  }
  return done(g, 4.4, [{ x: -2.05, y: st[0].gy + 0.3, z: 0, s: 1.2 }], [s1, s2]);
}
function patrol(lo) {
  const g = new VB(209);
  const st = steelHull(g, { L: 2.8, W: 0.5, H: 0.24, D: 0.2, col: 0x7c848c, low: 0x6a2c26, deck: 0x8a8678, band: 0.03, bowRise: 0.07, rake: 0.16, fullB: 0.5 });
  turret(g, 0.75, hwAt(st, 0.75).gy, 0.11, 1, 1, 0.3);
  house(g, 0.25, st[5].gy, 0.5, 0.24, 0.36, 0x7c848c, { glow: 0.6 });
  house(g, 0.32, st[5].gy + 0.24, 0.26, 0.12, 0.3, 0x6a7078, { glow: 0.6 });
  const sm = funnel(g, -0.2, st[5].gy, 0.07, 0.32, { col: 0x5a6068 });
  turret(g, -0.95, hwAt(st, -0.95).gy, 0.1, -1, 1, 0.26);
  if (!lo) {
    g.box(-0.55, st[3].gy, 0, 0.3, 0.1, 0.22, 0x5a6068); // depth charge racks and torpedo tubes
    for (const s of [-1, 1]) g.beam(-0.5, st[3].gy + 0.12, s * 0.08, -0.2, st[3].gy + 0.12, s * 0.12, 0.04, DARK);
    navLights(g, 0.42, st[5].gy + 0.3, 0.16, radarMast(g, 0.15, st[5].gy + 0.36, 0.42));
  }
  return done(g, 2.8, [{ x: -1.35, y: st[0].gy + 0.32, z: 0, s: 1 }], [sm]);
}
function icebreaker(lo) {
  const g = new VB(211);
  const st = steelHull(g, { L: 2.8, W: 0.74, H: 0.34, D: 0.28, col: 0xb02a22, low: 0x4a1a16, deck: 0x6e6a5e, bowRise: 0.08, rake: 0.42, bowPow: 1.2, fullB: 0.55, transom: 0.9 });
  house(g, 0.15, st[5].gy, 1.0, 0.3, 0.6, WHITE);
  house(g, 0.3, st[5].gy + 0.3, 0.55, 0.22, 0.52, WHITE);
  house(g, 0.4, st[5].gy + 0.52, 0.3, 0.14, 0.6, WHITE);
  const sm = funnel(g, -0.3, st[5].gy + 0.3, 0.1, 0.36, { col: 0xd8d4c8 });
  if (!lo) {
    g.box(-1.1, st[1].gy, 0, 0.4, 0.04, 0.6, 0xd8c040); // helipad
    g.cyl(-0.75, st[2].gy, 0.2, 0.03, 0.5, 5, 0xc8a040); // crane
    g.beam(-0.75, st[2].gy + 0.45, 0.2, -0.45, st[2].gy + 0.55, 0.25, 0.025, 0xc8a040);
    navLights(g, 0.55, st[5].gy + 0.6, 0.3, radarMast(g, 0.3, st[5].gy + 0.66, 0.35));
  }
  return done(g, 2.8, [{ x: -1.3, y: st[0].gy + 0.35, z: 0, s: 1 }], [sm]);
}
// ---------------------------------------------------------------- sea, Atomic
function container(lo) {
  const g = new VB(213);
  const st = steelHull(g, { L: 4.6, W: 0.88, H: 0.36, D: 0.3, col: 0x2c4a6a, deck: 0x6a6a62, bowRise: 0.06, rake: 0.22, n: 12, fullB: 0.7 });
  house(g, -1.75, st[1].gy, 0.4, 0.62, 0.7, WHITE);
  house(g, -1.72, st[1].gy + 0.62, 0.34, 0.12, 0.86, WHITE, { win: true });
  const sm = funnel(g, -2.0, st[1].gy + 0.4, 0.08, 0.36, { col: 0xe8e8e2 });
  containers(g, -1.45, 1.75, st[6].gy, 0.38, lo ? 3 : 3, 3, lo);
  if (!lo) navLights(g, -1.58, st[1].gy + 0.66, 0.36, radarMast(g, -1.75, st[1].gy + 0.74, 0.3));
  return done(g, 4.6, [{ x: -2.25, y: st[0].gy + 0.35, z: 0, s: 1.1 }], [sm]);
}
function tanker(lo) {
  const g = new VB(215);
  const st = steelHull(g, { L: 4.4, W: 0.88, H: 0.3, D: 0.32, col: 0x2a3a2e, deck: 0x7a2c24, bowRise: 0.05, rake: 0.2, n: 12, fullB: 0.72 });
  house(g, -1.7, st[1].gy, 0.5, 0.54, 0.72, WHITE);
  house(g, -1.66, st[1].gy + 0.54, 0.36, 0.12, 0.84, WHITE);
  const sm = funnel(g, -1.98, st[1].gy + 0.36, 0.09, 0.36, { col: 0x2a2a2a });
  if (!lo) {
    // the pipe run and manifolds down the deck, a catwalk, hatch domes
    g.box(0.1, st[6].gy, 0, 3.2, 0.05, 0.06, 0xb8b0a0);
    for (let i = 0; i < 6; i++) g.cyl(-1.1 + i * 0.5, st[6].gy, 0.22, 0.07, 0.05, 6, 0x9a3a2a);
    g.box(0.1, st[6].gy + 0.12, -0.12, 3.2, 0.02, 0.08, 0x8a8a84);
    for (const x of [-0.4, 0.6]) {
      g.cyl(x, st[6].gy, -0.25, 0.025, 0.4, 5, 0xd8c040);
      g.beam(x, st[6].gy + 0.38, -0.25, x + 0.3, st[6].gy + 0.3, 0, 0.02, 0xd8c040);
    }
    navLights(g, -1.48, st[1].gy + 0.6, 0.36, radarMast(g, -1.7, st[1].gy + 0.66, 0.3));
  }
  return done(g, 4.4, [{ x: -2.15, y: st[0].gy + 0.32, z: 0, s: 1.1 }], [sm]);
}
function liner(lo) {
  const g = new VB(217);
  const st = steelHull(g, { L: 4.2, W: 0.8, H: 0.4, D: 0.28, col: WHITE, low: 0x2a3a5a, deck: 0x9aa8b0, band: 0.06, bowRise: 0.06, rake: 0.24, n: 12, fullB: 0.6 });
  // decks of cabins stepping up, windows the length of each (lit at night)
  const y0 = st[6].gy;
  house(g, -0.1, y0, 3.0, 0.16, 0.74, WHITE, { front: false });
  house(g, -0.15, y0 + 0.16, 2.6, 0.16, 0.7, WHITE, { front: false });
  house(g, -0.2, y0 + 0.32, 2.1, 0.16, 0.64, WHITE);
  house(g, 0.1, y0 + 0.48, 0.9, 0.14, 0.56, WHITE);
  if (!lo) {
    // balconies glow along the hull, a pool and deck chairs aft, lifeboats
    for (const s of [-1, 1]) g.box(-0.1, st[6].gy - 0.14, s * (0.405), 3.0, 0.05, 0.01, WIN, { glow: 1 });
    g.box(-1.2, y0 + 0.48, 0, 0.4, 0.02, 0.3, 0x3ab0d0);
    for (const s of [-1, 1]) for (let i = 0; i < 5; i++) g.box(-0.9 + i * 0.4, y0 + 0.3, s * 0.37, 0.16, 0.05, 0.04, 0xe8a020);
    navLights(g, 0.5, y0 + 0.56, 0.29, radarMast(g, 0.3, y0 + 0.62, 0.3));
  }
  const s1 = funnel(g, -0.5, y0 + 0.48, 0.12, 0.34, { col: WHITE });
  return done(g, 4.2, [{ x: -2.05, y: st[0].gy + 0.3, z: 0, s: 1.1 }], [s1]);
}
function submarine(lo) {
  const g = new VB(219);
  // a long dark body that rides awash, the sail amidships, a tinted band on it
  g.push();
  g.rotateZ(-Math.PI / 2);
  g.cyl(0, -1.3, 0, 0.17, 2.4, 10, 0x2c3034, { r2: 0.17, cap: false });
  g.cone(0, 1.1, 0, 0.17, 0.5, 10, 0x2c3034);
  g.pop();
  g.push();
  g.rotateZ(Math.PI / 2);
  g.cone(0, 1.3, 0, 0.17, 0.35, 10, 0x2c3034);
  g.pop();
  g.box(0.25, 0.05, 0, 0.5, 0.36, 0.13, 0x33383d, { top: 0x2a2e33 });
  g.box(0.25, 0.3, 0, 0.5, 0.05, 0.135, 0xffffff, { tint: 1 });
  if (!lo) {
    for (const s of [-1, 1]) g.box(0.3, 0.28, s * 0.13, 0.14, 0.02, 0.14, 0x2c3034); // sail planes
    g.box(-1.45, -0.05, 0, 0.14, 0.26, 0.02, 0x2c3034);
    g.box(-1.45, 0.0, 0, 0.14, 0.02, 0.36, 0x2c3034);
    g.cyl(0.32, 0.41, 0, 0.012, 0.18, 4, 0x55595e);
    g.box(0.45, 0.43, 0, 0.02, 0.02, 0.02, NAVW, { glow: 2 });
  }
  return done(g, 2.6, [{ x: 0.1, y: 0.52, z: 0, s: 0.8 }]);
}
function hovercraft(lo) {
  const g = new VB(221);
  // the black skirt, a deck cabin and two great fans in ducts aft
  g.box(0, 0, 0, 1.5, 0.14, 0.78, 0x23252a);
  g.box(0.05, 0.14, 0, 1.36, 0.06, 0.7, 0xffffff, { tint: 1 });
  house(g, 0.18, 0.2, 0.8, 0.22, 0.5, WHITE);
  g.box(0.2, 0.42, 0, 0.7, 0.04, 0.46, 0xd8d8d0);
  for (const s of [-1, 1]) {
    g.push();
    g.translate(-0.5, 0.42, s * 0.2);
    g.rotateZ(Math.PI / 2);
    g.cyl(0, -0.06, 0, 0.17, 0.12, 10, 0x3a3e44, { cap: false });
    g.pop();
    if (!lo) {
      g.setAnim(12, -0.5, 0.42, s * 0.2);
      g.beam(-0.5, 0.26, s * 0.2, -0.5, 0.58, s * 0.2, 0.03, 0x1a1a1a);
      g.beam(-0.5, 0.42, s * 0.2 - 0.15, -0.5, 0.42, s * 0.2 + 0.15, 0.03, 0x1a1a1a);
      g.setAnim(0);
    }
  }
  if (!lo) {
    g.box(-0.72, 0.3, 0, 0.04, 0.28, 0.02, 0xffffff, { tint: 1 }); // rudders
    navLights(g, 0.55, 0.36, 0.26);
  }
  return done(g, 1.5);
}
function hydrofoil(lo) {
  const g = new VB(223);
  const st = steelHull(g, { L: 2.0, W: 0.46, H: 0.2, D: 0.12, col: WHITE, low: 0x2a4a6a, band: 0.04, bowRise: 0.05, rake: 0.14, fullB: 0.45 });
  house(g, 0.0, st[5].gy, 1.1, 0.2, 0.38, WHITE, { glow: 1 });
  g.box(0.0, st[5].gy + 0.2, 0, 1.0, 0.03, 0.34, 0xd0d4d8);
  // the foils the hull rises onto at speed
  if (!lo) for (const x of [0.6, -0.6]) {
    for (const s of [-1, 1]) g.beam(x, -0.02, s * 0.18, x, -0.24, s * 0.26, 0.03, STEEL2);
    g.box(x, -0.25, 0, 0.12, 0.02, 0.6, STEEL2);
  }
  if (!lo) navLights(g, 0.4, st[5].gy + 0.1, 0.2);
  return done(g, 2.0, [{ x: -0.85, y: st[0].gy + 0.3, z: 0, s: 0.8 }]);
}
function research(lo) {
  const g = new VB(225);
  const st = steelHull(g, { L: 2.6, W: 0.6, H: 0.3, D: 0.22, col: WHITE, low: 0xc0502a, deck: 0x7a7a72, band: 0.05, bowRise: 0.06, rake: 0.14 });
  house(g, 0.35, st[5].gy, 0.8, 0.26, 0.48, WHITE);
  house(g, 0.45, st[5].gy + 0.26, 0.45, 0.16, 0.42, WHITE);
  const sm = funnel(g, 0.0, st[5].gy + 0.26, 0.06, 0.24, { col: 0xd86a2a });
  if (!lo) {
    // the A-frame over the stern, a winch, a radar dome on the mast
    for (const s of [-1, 1]) g.beam(-1.15, st[0].gy, s * 0.24, -1.3, st[0].gy + 0.55, s * 0.1, 0.035, 0xd86a2a);
    g.beam(-1.3, st[0].gy + 0.55, -0.12, -1.3, st[0].gy + 0.55, 0.12, 0.035, 0xd86a2a);
    g.cyl(-0.75, st[2].gy, 0, 0.07, 0.12, 8, 0x8a8a84);
    const [mx, my] = radarMast(g, 0.5, st[5].gy + 0.42, 0.3);
    g.dome(mx, my, 0, 0.08, 8, 3, WHITE);
    navLights(g, 0.65, st[5].gy + 0.32, 0.22, [mx, my + 0.1]);
  }
  return done(g, 2.6, [{ x: -1.25, y: st[0].gy + 0.4, z: 0, s: 0.9 }], [sm]);
}
function carrier(lo) {
  const g = new VB(227);
  const st = steelHull(g, { L: 4.6, W: 0.8, H: 0.36, D: 0.3, col: STEEL, low: 0x6a2c26, deck: 0x55585a, band: 0.03, bowRise: 0.05, rake: 0.2, n: 12, fullB: 0.7 });
  // the flight deck overhangs the hull, an angled strip, the island to starboard
  const dy = st[6].gy + 0.06;
  g.box(-0.05, dy - 0.06, -0.08, 4.5, 0.08, 1.1, 0x4a4d50, { top: 0x45484a });
  if (!lo) {
    g.box(-0.05, dy + 0.021, -0.08, 4.2, 0.004, 0.025, 0xe8e8e2);
    g.box(-0.4, dy + 0.021, -0.2, 2.6, 0.004, 0.02, 0xd8c040, { ry: 0.14 });
    for (let i = 0; i < 6; i++) g.box(1.4 - i * 0.55, dy + 0.021, 0.3, 0.2, 0.004, 0.03, 0xe8e8e2);
    for (let i = 0; i < 10; i++) g.box(-2.1 + i * 0.45, dy - 0.005, 0.47, 0.02, 0.02, 0.02, i % 2 ? NAVW : 0x30ff60, { glow: 2 }); // deck-edge lights
    // jets parked aft
    for (let i = 0; i < 3; i++) {
      const x = -1.6 + i * 0.32,
        z = -0.42;
      g.box(x, dy + 0.02, z, 0.22, 0.04, 0.05, 0x7a8088);
      g.box(x - 0.02, dy + 0.03, z, 0.08, 0.01, 0.22, 0x7a8088);
    }
  }
  house(g, 0.4, dy + 0.02, 0.6, 0.34, 0.2, STEEL, { win: true, glow: 0.6 });
  house(g, 0.45, dy + 0.36, 0.38, 0.14, 0.18, STEEL2, { glow: 0.6 });
  g.box(0.4, dy + 0.02, 0.38, 0.6, 0.02, 0.01, 0x000000);
  const sm = funnel(g, 0.25, dy + 0.36, 0.06, 0.16, { col: STEEL2 });
  if (!lo) navLights(g, 0.6, dy + 0.42, 0.1, radarMast(g, 0.5, dy + 0.5, 0.36));
  return done(g, 4.6, [{ x: 0.5, y: dy + 0.9, z: 0, s: 1.1 }], [sm]);
}
// ---------------------------------------------------------------- sea, Future
function trimaran(lo) {
  const g = new VB(229);
  // a slender main hull and two floats under a deck of solar panels
  const st = steelHull(g, { L: 2.8, W: 0.36, H: 0.22, D: 0.18, col: 0xeef0ee, low: 0x2a5a6a, band: 0.04, rake: 0.1, bowPow: 1.3, fullB: 0.45 });
  for (const s of [-1, 1]) {
    g.push();
    g.translate(-0.1, 0, s * 0.5);
    steelHull(g, { L: 2.0, W: 0.14, H: 0.18, D: 0.08, col: 0xeef0ee, low: 0x2a5a6a, band: 0, n: 6, rake: 0.08 });
    g.pop();
  }
  g.box(-0.1, 0.24, 0, 1.8, 0.03, 1.1, 0x1e2c48, { top: 0x2a4070, side: 0xd8d8d8 });
  if (!lo) {
    for (let i = 0; i < 6; i++) g.box(-0.95 + i * 0.34, 0.271, 0, 0.012, 0.004, 1.04, 0x8a9ab0);
    for (const s of [-1, 1]) g.box(-0.1, 0.271, s * 0.28, 1.76, 0.004, 0.01, 0x8a9ab0);
  }
  house(g, 0.75, 0.27, 0.4, 0.16, 0.3, 0xeef0ee, { glow: 1 });
  if (!lo) {
    g.box(0.1, 0.27, 0, 0.04, 0.04, 0.6, 0x30e0c0, { glow: 2 });
    navLights(g, 0.9, 0.33, 0.16);
  }
  void st;
  return done(g, 2.8, [{ x: -1.0, y: 0.6, z: 0, s: 0.8 }]);
}
function autocargo(lo) {
  const g = new VB(231);
  const st = steelHull(g, { L: 4.2, W: 0.8, H: 0.34, D: 0.28, col: 0xdfe4e8, low: 0x2a3a4a, deck: 0x6a6e72, band: 0.05, bowRise: 0.1, rake: 0.5, bowPow: 1.1, n: 12, fullB: 0.62 });
  // no bridge and no crew: a sensor mast, a glowing strip, the cargo
  containers(g, -1.7, 1.2, st[6].gy, 0.34, 2, 5, lo);
  g.box(-1.9, st[1].gy, 0, 0.2, 0.2, 0.5, 0xdfe4e8);
  if (!lo) {
    for (const s of [-1, 1]) g.box(0, st[6].gy - 0.04, s * 0.405, 3.6, 0.025, 0.01, 0x40e8d0, { glow: 2 });
    g.cyl(-1.9, st[1].gy + 0.2, 0, 0.02, 0.4, 5, 0xc0c4c8);
    g.dome(-1.9, st[1].gy + 0.6, 0, 0.06, 8, 3, WHITE);
    navLights(g, 1.5, st[9].gy + 0.05, 0.25, [-1.9, st[1].gy + 0.7]);
  }
  return done(g, 4.2, []);
}

// ---------------------------------------------------------------- land
// Wheels of the road vehicles: dark tyres turning on their axles (anim 3).
function tyres(g, xs, y, hw, r = 0.07) {
  for (const x of xs) for (const s of [-1, 1]) {
    g.setAnim(3, x, r, s * hw);
    g.push();
    g.translate(x, r, s * hw);
    g.rotateX(Math.PI / 2);
    g.cyl(0, -0.025, 0, r, 0.05, 8, 0x1c1c1e);
    g.pop();
  }
  g.setAnim(0);
  void y;
}
function lights(g, x, y, hw) {
  for (const s of [-1, 1]) {
    g.box(x, y, s * hw * 0.7, 0.012, 0.025, 0.04, 0xfff0c8, { glow: 1 });
  }
}
// Train: variant 0 the engine, 1 a coach, 2 a goods wagon, 3 the diesel engine
// of the Atomic era (one shows per instance; a train is several instances).
function train(lo) {
  const g = new VB(241);
  const rail = (v) => g.setAnim(0, 0, 0, 0, v);
  // 0: steam engine
  rail(0);
  g.box(0, 0.08, 0, 0.9, 0.06, 0.26, 0x2a2a2a);
  g.push();
  g.translate(0.08, 0.26, 0);
  g.rotateZ(-Math.PI / 2);
  g.cyl(0, -0.3, 0, 0.11, 0.62, 8, 0x1e2a22);
  g.pop();
  g.box(0.08, 0.26 - 0.11, 0, 0.6, 0.02, 0.25, 0xffffff, { tint: 1 });
  g.cyl(0.32, 0.34, 0, 0.04, 0.16, 6, 0x1a1a1a, { r2: 0.05 });
  g.box(-0.3, 0.12, 0, 0.3, 0.3, 0.28, 0x1e2a22, { top: 0x2a2a2a });
  g.box(-0.3, 0.3, 0, 0.32, 0.03, 0.3, 0x2a2a2a);
  g.box(-0.3, 0.25, 0, 0.2, 0.06, 0.29, WIN, { glow: 1 });
  g.box(0.47, 0.16, 0, 0.02, 0.04, 0.05, 0xfff0c8, { glow: 1 });
  if (!lo) for (const x of [-0.25, 0.05, 0.3]) for (const s of [-1, 1]) wheelR(g, x, 0.08, s * 0.14, 0, 0.08);
  // 1: coach
  rail(1);
  g.box(0, 0.1, 0, 0.9, 0.28, 0.27, 0x6a2a22, { top: 0x3a3a3a });
  g.box(0, 0.24, 0, 0.84, 0.06, 0.275, WIN, { glow: 1 });
  g.box(0, 0.12, 0, 0.88, 0.025, 0.275, 0xffffff, { tint: 1 });
  if (!lo) for (const x of [-0.3, 0.3]) for (const s of [-1, 1]) wheelR(g, x, 0.07, s * 0.14, 1, 0.065);
  // 2: goods wagon
  rail(2);
  g.box(0, 0.1, 0, 0.9, 0.24, 0.27, 0x7a5a3a, { top: 0x6a6a64 });
  g.box(0, 0.12, 0, 0.88, 0.025, 0.275, 0xffffff, { tint: 1 });
  if (!lo) for (const x of [-0.3, 0.3]) for (const s of [-1, 1]) wheelR(g, x, 0.07, s * 0.14, 2, 0.065);
  // 3: diesel engine
  rail(3);
  g.box(0, 0.1, 0, 0.9, 0.26, 0.27, 0xffffff, { tint: 1 });
  g.box(0.35, 0.22, 0, 0.18, 0.1, 0.275, GLASS, { glow: 0.6 });
  g.box(0, 0.36, 0, 0.6, 0.03, 0.2, 0x3a3a3a);
  g.box(0.46, 0.15, 0, 0.02, 0.04, 0.1, 0xfff0c8, { glow: 1 });
  if (!lo) for (const x of [-0.3, 0.3]) for (const s of [-1, 1]) wheelR(g, x, 0.07, s * 0.14, 3, 0.065);
  g.setAnim(0);
  return done(g, 0.95, [], [{ x: 0.32, y: 0.52, z: 0 }]);
}
function wheelR(g, x, r, z, variant, rr) {
  g.setAnim(3, x, rr, z, variant);
  g.push();
  g.translate(x, rr, z);
  g.rotateX(Math.PI / 2);
  g.cyl(0, -0.02, 0, rr, 0.04, 8, 0x2a2a2a);
  g.pop();
  g.setAnim(0, 0, 0, 0, variant);
  void r;
}
// Maglev: variant 0 the nose car, 1 a middle car; it floats over its guideway.
function maglev(lo) {
  const g = new VB(243);
  for (const v of [0, 1]) {
    g.setAnim(0, 0, 0, 0, v);
    g.box(0, 0.06, 0, v ? 1.1 : 0.8, 0.22, 0.28, 0xeef0f2, { top: 0xd8dce0 });
    g.box(0, 0.08, 0, v ? 1.08 : 0.78, 0.03, 0.285, 0xffffff, { tint: 1 });
    g.box(0, 0.18, 0, v ? 1.0 : 0.7, 0.06, 0.285, WIN, { glow: 1 });
    if (!v) {
      // the long tapering nose
      g.push();
      g.translate(0.4, 0.17, 0);
      g.rotateZ(-Math.PI / 2);
      g.cone(0, 0, 0, 0.14, 0.55, 8, 0xeef0f2);
      g.pop();
      g.box(0.55, 0.2, 0, 0.2, 0.05, 0.2, GLASS, { glow: 0.6 });
      lights(g, 0.85, 0.12, 0.1);
    }
    if (!lo) g.box(0, 0.02, 0, v ? 1.0 : 0.8, 0.04, 0.18, 0x40c0ff, { glow: 2 });
  }
  g.setAnim(0);
  return done(g, 1.25);
}
function truck(lo) {
  const g = new VB(245);
  g.box(0.32, 0.08, 0, 0.3, 0.26, 0.3, 0xffffff, { tint: 1, top: 0xd8d8d8 });
  g.box(0.42, 0.2, 0, 0.12, 0.1, 0.305, GLASS, { glow: 0.5 });
  g.box(-0.15, 0.1, 0, 0.62, 0.32, 0.32, 0xd8d4c8, { top: 0xc8c4b8 });
  g.box(-0.15, 0.06, 0, 0.9, 0.04, 0.28, 0x2a2a2a);
  lights(g, 0.475, 0.12, 0.14);
  if (!lo) tyres(g, [0.3, -0.25, -0.38], 0.07, 0.15);
  return done(g, 1.0);
}
// Car: four body colours (variant 0..3), headlights, tail lights.
function car(lo) {
  const g = new VB(247);
  const cols = [0xb03028, 0x2a5aa0, 0xe0e0dc, 0xd8b030];
  for (let v = 0; v < 4; v++) {
    g.setAnim(0, 0, 0, 0, v);
    g.box(0, 0.05, 0, 0.56, 0.1, 0.26, cols[v], { top: shade(cols[v], 1.05) });
    g.box(-0.03, 0.15, 0, 0.3, 0.09, 0.24, GLASS, { top: cols[v], glow: 0.3 });
    lights(g, 0.285, 0.1, 0.12);
    for (const s of [-1, 1]) g.box(-0.285, 0.1, s * 0.09, 0.012, 0.025, 0.04, 0xff3020, { glow: 2 });
    if (!lo) for (const x of [0.17, -0.17]) for (const s of [-1, 1]) wheelR(g, x, 0.05, s * 0.13, v, 0.05);
  }
  g.setAnim(0);
  return done(g, 0.6);
}
function cannon(lo) {
  const g = new VB(249);
  // a wheeled carriage, the barrel recoiling on firing (anim 6), the crew
  for (const s of [-1, 1]) g.box(-0.05, 0.12, s * 0.12, 0.7, 0.12, 0.05, 0x6a4a2a);
  g.beam(-0.4, 0.14, 0, -0.85, 0.02, 0, 0.08, 0x6a4a2a);
  g.setAnim(6);
  g.push();
  g.translate(0.05, 0.32, 0);
  g.rotateZ(-Math.PI / 2 + 0.08);
  g.cyl(0, -0.4, 0, 0.07, 0.95, 8, 0x3a3a3a, { r2: 0.05 });
  g.pop();
  g.setAnim(0);
  for (const s of [-1, 1]) wheel(g, 0.0, 0.22, s * 0.2, 0.22, 0.05);
  if (!lo) {
    for (let i = 0; i < 3; i++) g.bead(-0.55 + i * 0.09, 0.0, 0.25, 0.04, 0x2a2a2a);
    figure(g, -0.45, 0, -0.25, 3, 1.3);
    figure(g, -0.6, 0, 0.18, 6, 1.3);
  }
  return done(g, 1.4);
}
function artillery(lo) {
  const g = new VB(251);
  // a split trail, a gun shield, a long barrel on rubber wheels
  for (const s of [-1, 1]) g.beam(-0.1, 0.12, s * 0.06, -0.9, 0.02, s * 0.25, 0.06, 0x4a5a3a);
  g.box(0.08, 0.12, 0, 0.3, 0.32, 0.5, 0x4a5a3a, { top: 0x55663f });
  g.setAnim(6);
  g.push();
  g.translate(0.1, 0.3, 0);
  g.rotateZ(-Math.PI / 2 + 0.22);
  g.cyl(0, -0.2, 0, 0.05, 1.2, 8, 0x3a4430, { r2: 0.04 });
  g.pop();
  g.setAnim(0);
  for (const s of [-1, 1]) wheelR(g, 0.0, 0.15, s * 0.28, -1, 0.15);
  g.setAnim(0);
  if (!lo) {
    figure(g, -0.4, 0, -0.35, 4, 1.3);
    figure(g, -0.55, 0, 0.32, 7, 1.3);
  }
  return done(g, 1.5);
}
function tank(lo) {
  const g = new VB(253);
  // tracks, a sloped hull, a turret whose gun trains on its target (anim 11)
  for (const s of [-1, 1]) {
    g.box(0, 0.02, s * 0.28, 1.15, 0.2, 0.16, 0x2a2c26, { top: 0x3a3c34 });
    if (!lo) for (let i = 0; i < 5; i++) wheelR(g, -0.42 + i * 0.21, 0.09, s * 0.365, -1, 0.08);
  }
  g.setAnim(0);
  g.box(0, 0.14, 0, 1.0, 0.18, 0.46, 0x5a6a44, { top: 0x667650 });
  g.box(0.5, 0.14, 0, 0.12, 0.12, 0.42, 0x55663f);
  g.setAnim(11, -0.05, 0.32, 0);
  g.box(-0.05, 0.32, 0, 0.5, 0.16, 0.38, 0x5a6a44, { top: 0x667650 });
  g.beam(0.2, 0.41, 0, 0.85, 0.42, 0, 0.05, 0x3a4430);
  g.box(-0.15, 0.48, 0.1, 0.12, 0.05, 0.12, 0x4a5a3a);
  g.box(-0.05, 0.36, 0, 0.42, 0.03, 0.385, 0xffffff, { tint: 1 });
  g.setAnim(0);
  return done(g, 1.4);
}
function fireengine(lo) {
  const g = new VB(255);
  g.box(0.36, 0.08, 0, 0.28, 0.26, 0.32, 0xc0201a, { top: 0xb01c18 });
  g.box(0.45, 0.2, 0, 0.1, 0.1, 0.325, GLASS, { glow: 0.5 });
  g.box(-0.15, 0.08, 0, 0.74, 0.24, 0.32, 0xc0201a, { top: 0xa81a16 });
  g.box(-0.15, 0.14, 0, 0.72, 0.03, 0.325, 0xe8e8e0);
  if (!lo) {
    g.beam(-0.45, 0.36, 0, 0.45, 0.42, 0, 0.06, 0xd8d8d0); // the ladder
    for (let i = 0; i < 6; i++) g.box(-0.38 + i * 0.15, 0.4, 0, 0.02, 0.02, 0.07, 0xd8d8d0);
    g.cyl(-0.32, 0.32, 0, 0.05, 0.06, 6, 0xd8d8d0);
    tyres(g, [0.34, -0.2, -0.36], 0.07, 0.16);
  }
  for (const s of [-1, 1]) g.box(0.36, 0.345, s * 0.07, 0.06, 0.03, 0.08, s > 0 ? 0xff2a20 : 0x3060ff, { glow: 3 });
  lights(g, 0.505, 0.12, 0.14);
  return done(g, 1.05);
}
function ambulance(lo) {
  const g = new VB(257);
  g.box(0.28, 0.07, 0, 0.24, 0.2, 0.28, 0xf2f2ee, { top: 0xe8e8e4 });
  g.box(0.36, 0.17, 0, 0.08, 0.08, 0.285, GLASS, { glow: 0.5 });
  g.box(-0.1, 0.07, 0, 0.56, 0.3, 0.3, 0xf2f2ee, { top: 0xe8e8e4 });
  g.box(-0.1, 0.16, 0, 0.56, 0.04, 0.305, 0xd0281e);
  if (!lo) {
    for (const s of [-1, 1]) {
      g.box(-0.1, 0.25, s * 0.153, 0.12, 0.035, 0.005, 0xd0281e);
      g.box(-0.1, 0.25, s * 0.153, 0.035, 0.12, 0.006, 0xd0281e);
    }
    tyres(g, [0.26, -0.24], 0.07, 0.14);
  }
  for (const s of [-1, 1]) g.box(0.05, 0.37, s * 0.07, 0.06, 0.03, 0.08, s > 0 ? 0xff2a20 : 0x3060ff, { glow: 3 });
  lights(g, 0.405, 0.12, 0.13);
  return done(g, 0.85);
}
function tractor(lo) {
  const g = new VB(259);
  g.box(0.12, 0.12, 0, 0.36, 0.14, 0.18, 0x3a8a3a, { top: 0x45983f });
  g.box(-0.12, 0.12, 0, 0.22, 0.32, 0.26, 0x3a8a3a, { top: 0x2a2a2a });
  g.box(-0.12, 0.24, 0, 0.2, 0.14, 0.265, GLASS, { glow: 0.4 });
  g.cyl(0.2, 0.26, 0, 0.02, 0.14, 5, 0x2a2a2a);
  if (!lo) {
    for (const s of [-1, 1]) wheelR(g, -0.12, 0.15, s * 0.17, -1, 0.15);
    for (const s of [-1, 1]) wheelR(g, 0.22, 0.08, s * 0.12, -1, 0.08);
    g.setAnim(0);
    g.box(-0.45, 0.04, 0, 0.18, 0.06, 0.42, 0x6a6a64); // the harrow behind
    figure(g, -0.12, 0.16, 0, 5, 1.1);
  }
  return done(g, 0.7, [], [{ x: 0.2, y: 0.42, z: 0 }]);
}
function tram(lo) {
  const g = new VB(261);
  g.box(0, 0.04, 0, 1.3, 0.3, 0.3, 0xe8d8a0, { top: 0xd8d8d0 });
  g.box(0, 0.06, 0, 1.28, 0.06, 0.305, 0xffffff, { tint: 1 });
  g.box(0, 0.2, 0, 1.2, 0.1, 0.305, WIN, { glow: 1 });
  for (const s of [-1, 1]) g.box(s * 0.64, 0.18, 0, 0.03, 0.12, 0.24, GLASS, { glow: 0.6 });
  if (!lo) {
    g.beam(0, 0.34, 0, 0.18, 0.6, 0, 0.015, 0x2a2a2a); // the pantograph
    g.beam(0.08, 0.6, -0.1, 0.08, 0.6, 0.1, 0.015, 0x2a2a2a);
  }
  lights(g, 0.655, 0.12, 0.12);
  return done(g, 1.3);
}
function bus(lo) {
  const g = new VB(263);
  g.box(0, 0.06, 0, 1.15, 0.3, 0.3, 0xe8b020, { top: 0xd8d8d0 });
  g.box(0, 0.08, 0, 1.13, 0.05, 0.305, 0xffffff, { tint: 1 });
  g.box(-0.02, 0.2, 0, 1.0, 0.1, 0.305, WIN, { glow: 1 });
  g.box(0.575, 0.18, 0, 0.01, 0.14, 0.26, GLASS, { glow: 0.6 });
  if (!lo) tyres(g, [0.38, -0.38], 0.07, 0.15);
  lights(g, 0.58, 0.12, 0.13);
  return done(g, 1.15);
}

addBuilders({ steamer, ironclad, freighter, battleship, patrol, icebreaker, container, tanker, liner, submarine, hovercraft, hydrofoil, research, carrier, trimaran, autocargo, train, maglev, truck, car, cannon, artillery, tank, fireengine, ambulance, tractor, tram, bus });
