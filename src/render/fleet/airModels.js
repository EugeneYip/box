import { VB, addBuilders } from './models.js';
import { shade } from '../buildings/geom.js';

// Original low-poly aircraft and rockets (docs/MODERN-ERAS.md), built like
// the other vehicle models (models.js, modernModels.js): faces +X (a rocket
// stands up along +Y, its base at y = 0), design size, vertex colours, aTint
// realm colour, aGlow lamps (1 windows, 2 navigation lights: red to port,
// green to starboard, a white beacon; 4 flame). Propellers spin about X
// (anim 12), rotors about Y (anim 13); a rocket's plume grows with its
// thrust (anim 15). Variants (rockets): 0 the full stack, 1 the upper stage
// flying on alone, 2 the booster coming back to land.

const WHITE = 0xeceeee;
const GREY = 0x9aa0a6;
const DARK = 0x2a2e33;
const GLASS = 0x2c4050;
const WIN = 0x34404c;
const NAVR = 0xff3020;
const NAVG = 0x30ff60;
const NAVW = 0xfff4d8;
const FLAME = 0xffb050;

const done = (g, length) => ({ geo: g.build(), flags: [], smoke: [], length });
function tube(g, x0, x1, r, col, o = {}) {
  g.push();
  g.translate(x0, 0, 0);
  g.rotateZ(-Math.PI / 2);
  g.cyl(0, 0, 0, r, x1 - x0, o.seg ?? 8, col, { r2: o.r2 ?? r, cap: o.cap ?? true });
  g.pop();
}
function nose(g, x, r, len, col, seg = 8) {
  g.push();
  g.translate(x, 0, 0);
  g.rotateZ(-Math.PI / 2);
  g.cone(0, 0, 0, r, len, seg, col);
  g.pop();
}
// a flat wing panel: root chord at x0..x1 on the centreline, tip swept back
function wing(g, y, x0, x1, span, sweep, tipChord, col, o = {}) {
  for (const s of [-1, 1]) {
    const tz = s * span;
    const tx1 = x1 - sweep,
      tx0 = tx1 - tipChord;
    g.quad([x0, y, 0], [x1, y, 0], [tx1, y, tz], [tx0, y, tz], col, o.tint ?? 0, 0, [(x0 + x1) / 2, y - 1, s * span * 0.3]);
    g.quad([x0, y, 0], [x1, y, 0], [tx1, y, tz], [tx0, y, tz], shade(col, 0.8), 0, 0, [(x0 + x1) / 2, y + 1, s * span * 0.3]);
    if (o.lights !== false) g.box(tx1 - tipChord * 0.4, y, tz + s * 0.01, 0.03, 0.025, 0.025, s < 0 ? NAVR : NAVG, { glow: 2 });
  }
}
function fin(g, x0, x1, y, h, sweep, col, tint = 1) {
  for (const s of [-1, 1]) g.quad([x0, y, 0], [x1, y, 0], [x1 - sweep * 0.3, y + h, 0], [x0 - sweep, y + h, 0], col, tint, 0, [(x0 + x1) / 2, y + h / 2, -s]);
}
function prop(g, x, y, z, r) {
  g.setAnim(12, x, y, z);
  g.beam(x, y - r, z, x, y + r, z, 0.02, DARK, { thY: r * 2 });
  g.beam(x, y, z - r, x, y, z + r, 0.02, DARK);
  g.setAnim(0);
  g.bead(x - 0.01, y - 0.025, z, 0.03, GREY);
}
function rotor(g, x, y, z, r, blades = 2) {
  g.setAnim(13, x, y, z);
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI;
    g.beam(x - Math.cos(a) * r, y, z - Math.sin(a) * r, x + Math.cos(a) * r, y, z + Math.sin(a) * r, 0.035, DARK, { thY: 0.008 });
  }
  g.setAnim(0);
}

function plane(lo) {
  const g = new VB(301);
  tube(g, -0.55, 0.38, 0.075, WHITE);
  nose(g, 0.38, 0.075, 0.14, WHITE);
  tube(g, -0.55, -0.7, 0.075, WHITE, { r2: 0.03 });
  g.box(-0.05, 0.0, 0, 0.8, 0.02, 0.152, 0xffffff, { tint: 1 });
  wing(g, 0.07, 0.02, 0.2, 0.62, 0.02, 0.15, WHITE);
  for (const s of [-1, 1]) {
    tube(g, -0.02, 0.24, 0.035, GREY);
    g.push();
    g.translate(0, 0.04, s * 0.24);
    tube(g, 0.0, 0.24, 0.035, GREY);
    g.pop();
    if (!lo) prop(g, 0.25, 0.04, s * 0.24, 0.1);
  }
  wing(g, 0.02, -0.68, -0.56, 0.22, 0.04, 0.08, WHITE, { lights: false });
  fin(g, -0.72, -0.56, 0.05, 0.2, 0.08, WHITE);
  if (!lo) {
    g.box(-0.1, 0.02, 0, 0.6, 0.025, 0.153, WIN, { glow: 1 });
    g.box(0.37, 0.03, 0, 0.04, 0.03, 0.1, GLASS, { glow: 0.5 });
    g.box(-0.7, 0.26, 0, 0.03, 0.03, 0.03, NAVW, { glow: 2 });
  }
  return done(g, 1.1);
}
function biplane(lo) {
  const g = new VB(303);
  tube(g, -0.38, 0.22, 0.055, 0xffffff, { r2: 0.05 });
  g.push();
  g.translate(-0.38, 0, 0);
  g.rotateZ(Math.PI / 2);
  g.cone(0, 0, 0, 0.05, 0.12, 8, 0xffffff);
  g.pop();
  for (const y of [-0.04, 0.12]) wing(g, y, 0.0, 0.16, 0.42, 0.0, 0.16, 0xe8dcc0, { lights: y > 0 });
  if (!lo) {
    for (const s of [-1, 1]) for (const x of [0.03, 0.13]) g.beam(x, -0.04, s * 0.3, x, 0.12, s * 0.3, 0.012, 0x5a3a22);
    for (const s of [-1, 1]) g.beam(0.12, -0.05, s * 0.06, 0.1, -0.15, s * 0.09, 0.012, DARK);
    for (const s of [-1, 1]) g.cyl(0.1, -0.2, s * 0.09, 0.035, 0.02, 6, DARK);
    prop(g, 0.25, 0, 0, 0.11);
    g.box(-0.05, 0.05, 0, 0.08, 0.02, 0.07, DARK);
  }
  wing(g, 0.0, -0.48, -0.38, 0.14, 0.02, 0.06, 0xe8dcc0, { lights: false });
  fin(g, -0.5, -0.38, 0.02, 0.12, 0.05, 0xffffff);
  // the realm's colours on the fuselage
  g.box(-0.08, -0.055, 0, 0.3, 0.11, 0.112, 0xffffff, { tint: 1 });
  return done(g, 0.8);
}
function airliner(lo) {
  const g = new VB(305);
  tube(g, -0.62, 0.55, 0.085, WHITE, { seg: 10 });
  nose(g, 0.55, 0.085, 0.18, WHITE, 10);
  g.push();
  g.translate(-0.62, 0, 0);
  g.rotateZ(Math.PI / 2);
  g.cone(0, 0, 0, 0.085, 0.22, 10, WHITE);
  g.pop();
  wing(g, -0.03, -0.12, 0.18, 0.8, 0.34, 0.1, 0xd8dcdf);
  for (const s of [-1, 1]) {
    g.push();
    g.translate(0.05, -0.08, s * 0.3);
    tube(g, 0, 0.22, 0.045, GREY);
    g.pop();
    g.cyl(0.27, -0.08 - 0.035, s * 0.3, 0.035, 0.01, 8, DARK);
  }
  wing(g, 0.02, -0.82, -0.66, 0.3, 0.12, 0.08, 0xd8dcdf, { lights: false });
  fin(g, -0.85, -0.6, 0.05, 0.32, 0.16, 0xffffff);
  if (!lo) {
    for (const s of [-1, 1]) g.box(-0.03, 0.025, s * 0.084, 1.0, 0.025, 0.004, WIN, { glow: 1 });
    g.box(0.6, 0.03, 0, 0.06, 0.035, 0.12, GLASS, { glow: 0.5 });
    g.box(-0.05, -0.02, 0, 1.0, 0.02, 0.172, 0xffffff, { tint: 1 });
    g.box(-0.95, 0.38, 0, 0.03, 0.03, 0.03, NAVW, { glow: 2 });
    g.box(-0.1, -0.09, 0, 0.03, 0.02, 0.03, NAVR, { glow: 2 }); // the belly beacon
  }
  return done(g, 1.6);
}
function jet(lo) {
  const g = new VB(307);
  tube(g, -0.42, 0.25, 0.055, 0x7a828a, { seg: 8 });
  nose(g, 0.25, 0.055, 0.22, 0x7a828a);
  // a delta wing in the realm's colours, twin fins, the canopy
  for (const s of [-1, 1]) {
    g.quad([-0.38, 0, 0], [0.12, 0, 0], [-0.36, 0, s * 0.34], [-0.42, 0, s * 0.34], 0x7a828a, 0, 0, [-0.2, -1, s * 0.1]);
    g.quad([-0.38, 0, 0], [0.12, 0, 0], [-0.36, 0, s * 0.34], [-0.42, 0, s * 0.34], 0x5a6068, 0, 0, [-0.2, 1, s * 0.1]);
    g.box(-0.39, 0.0, s * 0.34, 0.03, 0.02, 0.02, s < 0 ? NAVR : NAVG, { glow: 2 });
    g.push();
    g.translate(0, 0, s * 0.06);
    fin(g, -0.42, -0.26, 0.03, 0.16, 0.07, 0x6a7078, 0.6);
    g.pop();
  }
  g.box(-0.1, -0.003, 0, 0.36, 0.004, 0.34, 0xffffff, { tint: 1 });
  g.box(0.08, 0.04, 0, 0.16, 0.035, 0.05, GLASS, { glow: 0.4 });
  if (!lo) g.cyl(-0.43, 0, 0, 0.04, 0.02, 8, FLAME, { glow: 4 });
  return done(g, 0.9);
}
function drone(lo) {
  const g = new VB(309);
  g.box(0, 0, 0, 0.12, 0.05, 0.12, WHITE, { top: 0xffffff });
  g.box(0, -0.06, 0, 0.08, 0.06, 0.08, 0xc89a5a); // the parcel
  for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    g.beam(0, 0.03, 0, dx * 0.12, 0.03, dz * 0.12, 0.018, DARK);
    if (!lo) rotor(g, dx * 0.12, 0.05, dz * 0.12, 0.07);
    g.box(dx * 0.12, 0.035, dz * 0.12 + dz * 0.0, 0.015, 0.015, 0.015, dx > 0 ? (dz > 0 ? NAVG : NAVR) : NAVW, { glow: 2 });
  }
  g.box(0, 0.05, 0, 0.06, 0.01, 0.06, 0xffffff, { tint: 1 });
  return done(g, 0.3);
}
function skytaxi(lo) {
  const g = new VB(311);
  // a teardrop cabin with a glass canopy and four ducted fans
  tube(g, -0.25, 0.15, 0.1, WHITE, { seg: 10 });
  nose(g, 0.15, 0.1, 0.14, WHITE, 10);
  g.box(0.05, 0.03, 0, 0.24, 0.08, 0.17, GLASS, { glow: 0.8 });
  g.box(-0.1, -0.02, 0, 0.3, 0.03, 0.205, 0xffffff, { tint: 1 });
  for (const [dx, dz] of [[0.2, 0.26], [0.2, -0.26], [-0.25, 0.26], [-0.25, -0.26]]) {
    g.beam(dx * 0.6, 0.02, 0, dx, 0.02, dz, 0.03, GREY);
    g.cyl(dx, -0.01, dz, 0.1, 0.05, 10, GREY, { cap: false });
    if (!lo) rotor(g, dx, 0.02, dz, 0.085, 3);
    g.box(dx, 0.045, dz + Math.sign(dz) * 0.1, 0.02, 0.02, 0.02, dz < 0 ? NAVR : NAVG, { glow: 2 });
  }
  return done(g, 0.7);
}
function helicopter(lo) {
  const g = new VB(313);
  // a rescue helicopter: white with a red band and cross, a main rotor and a tail rotor
  g.box(-0.02, -0.06, 0, 0.36, 0.18, 0.18, WHITE, { top: 0xe0e0e0 });
  nose(g, 0.16, 0.09, 0.1, GLASS);
  g.box(0.1, 0.0, 0, 0.12, 0.09, 0.185, GLASS, { glow: 0.6 });
  g.box(-0.02, -0.02, 0, 0.36, 0.04, 0.185, 0xd0281e);
  g.beam(-0.2, 0.02, 0, -0.6, 0.06, 0, 0.05, WHITE);
  fin(g, -0.64, -0.56, 0.04, 0.14, 0.05, 0xffffff);
  g.cyl(-0.02, 0.12, 0, 0.03, 0.06, 6, DARK);
  if (!lo) {
    rotor(g, -0.02, 0.18, 0, 0.42, 3);
    g.setAnim(3, -0.6, 0.12, 0.03);
    g.beam(-0.6, 0.04, 0.03, -0.6, 0.2, 0.03, 0.02, DARK);
    g.setAnim(0);
    for (const s of [-1, 1]) g.beam(0.12, -0.16, s * 0.1, -0.18, -0.16, s * 0.1, 0.015, DARK);
    for (const s of [-1, 1]) {
      g.box(-0.02, 0.05, s * 0.093, 0.08, 0.02, 0.005, 0xd0281e);
      g.box(-0.02, 0.03, s * 0.094, 0.025, 0.06, 0.005, 0xd0281e);
    }
    g.box(-0.6, 0.2, 0, 0.025, 0.025, 0.025, NAVR, { glow: 2 });
  }
  g.box(0.0, -0.065, 0, 0.12, 0.02, 0.185, 0xffffff, { tint: 1 });
  return done(g, 0.8);
}
// One stage of a rocket standing on its base at y0 (along +Y).
function stage(g, y0, r, h, col, o = {}) {
  g.cyl(0, y0, 0, r, h, 10, col);
  if (o.band) g.cyl(0, y0 + h - 0.06, 0, r * 1.01, 0.06, 10, o.band, { cap: false });
  if (o.tint) g.cyl(0, y0 + h * 0.45, 0, r * 1.01, 0.1, 10, 0xffffff, { tint: 1, cap: false });
}
function plume(g, y, r, len) {
  g.setAnim(15, 0, y, 0);
  g.cone(0, y, 0, r, -len, 8, FLAME, { glow: 4 });
  g.push();
  g.translate(0, y, 0);
  g.rotateX(Math.PI);
  g.cone(0, 0, 0, r * 1.3, len, 8, 0xffe8b0, { glow: 4 });
  g.pop();
  g.setAnim(0);
}
function rocket(lo) {
  const g = new VB(321);
  for (const v of [0, 1, 2]) {
    g.setAnim(0, 0, 0, 0, v);
    const up = v === 1 ? -1.0 : 0; // the upper stage alone flies its own base
    if (v !== 1) {
      // the booster: engine bell, fins (landing legs when it comes home)
      stage(g, 0.06, 0.12, 1.0, WHITE, { band: DARK, tint: true });
      g.cone(0, 0.06, 0, 0.09, -0.08, 8, DARK);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        if (v === 2) g.beam(Math.cos(a) * 0.12, 0.25, Math.sin(a) * 0.12, Math.cos(a) * 0.28, -0.02, Math.sin(a) * 0.28, 0.025, DARK);
        else g.box(Math.cos(a) * 0.14, 0.06, Math.sin(a) * 0.14, 0.06, 0.2, 0.02, DARK, { ry: -a });
      }
      g.setAnim(15, 0, -0.02, 0, v);
      g.cone(0, -0.02, 0, 0.1, -0.9, 8, FLAME, { glow: 4 });
      g.setAnim(0, 0, 0, 0, v);
    }
    if (v !== 2) {
      // the upper stage and its fairing
      const y = 1.06 + up;
      stage(g, y, 0.11, 0.42, WHITE, { band: DARK });
      g.cone(0, y + 0.42, 0, 0.11, 0.26, 10, WHITE);
      if (v === 1) {
        g.cone(0, y, 0, 0.07, -0.06, 8, DARK);
        g.setAnim(15, 0, y - 0.06, 0, v);
        g.cone(0, y - 0.06, 0, 0.07, -0.6, 8, FLAME, { glow: 4 });
        g.setAnim(0, 0, 0, 0, v);
      }
    }
  }
  g.setAnim(0);
  void lo;
  return done(g, 1.8);
}
function starship(lo) {
  const g = new VB(323);
  const STAIN = 0xc8ccd0;
  for (const v of [0, 1]) {
    g.setAnim(0, 0, 0, 0, v);
    const y0 = v === 1 ? -1.4 : 0;
    if (v === 0) {
      // the great booster with its grid fins
      stage(g, 0.06, 0.2, 1.4, STAIN, { band: 0x8a9096 });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        g.box(Math.cos(a) * 0.23, 1.32, Math.sin(a) * 0.23, 0.08, 0.06, 0.08, DARK, { ry: -a });
      }
      g.setAnim(15, 0, 0.0, 0, v);
      g.cone(0, 0.0, 0, 0.19, -1.3, 10, FLAME, { glow: 4 });
      g.setAnim(0, 0, 0, 0, v);
    } else {
      g.setAnim(15, 0, 1.46 + y0, 0, v);
      g.cone(0, 1.46 + y0, 0, 0.16, -0.9, 10, FLAME, { glow: 4 });
      g.setAnim(0, 0, 0, 0, v);
    }
    // the ship: a steel cylinder, a rounded nose, flaps fore and aft, windows
    stage(g, 1.46 + y0, 0.2, 0.9, STAIN, { tint: true });
    g.dome(0, 2.36 + y0, 0, 0.2, 10, 4, STAIN, { sy: 1.6 });
    for (const s of [-1, 1]) {
      g.box(0, 1.5 + y0, s * 0.24, 0.08, 0.3, 0.12, 0x4a4e52);
      g.box(0, 2.25 + y0, s * 0.22, 0.06, 0.18, 0.08, 0x4a4e52);
    }
    if (!lo) for (let i = 0; i < 3; i++) g.box(0.2, 2.0 + y0 + i * 0.08, 0, 0.012, 0.03, 0.12, WIN, { glow: 1 });
  }
  g.setAnim(0);
  return done(g, 2.7);
}

addBuilders({ plane, biplane, airliner, jet, drone, skytaxi, helicopter, rocket, starship });
