import { shade } from './geom.js';

// Models for the buildings of the modern and future eras (docs/MODERN-ERAS.md):
// original low-poly designs drawn at their design size (one tile = one unit,
// a person 0.6 tall; BUILDING.scale brings them to the world in each
// instance matrix). Footprints follow the catalog's design size dw x dh,
// centred on the origin, ground at y = 0, the door (or the water, for a port)
// toward +Z. The Buildings renderer keys on the catalog `kind`; a modern kind
// without a model here draws `modernFallback`, a neutral block of its era.
//
// Glow codes (vertex aGlow, read by material.js):
//   0..1 windows (warm, or electric in a powered town) · 2 blinking red beacon
//   3 screens (blue-white) · 4 steady cyan glow · 5 lamp head (night only)

const BEACON = 2,
  SCREEN = 3,
  CYAN = 4,
  LAMP = 5;

const MC = {
  concrete: 0xb8b3aa,
  concrete2: 0x8e8a84,
  steel: 0x6e757c,
  steel2: 0x4f555b,
  dark: 0x34373c,
  white: 0xeceae4,
  tarmac: 0x45474b,
  grass: 0x6f8f4a,
  stripe: 0xeeece4,
  yellow: 0xe0b83a,
  water: 0x3f6f8a,
  red: 0xc0392b,
  orange: 0xd9642a,
  green: 0x5f9a5a,
  leaf: 0x4f8a44,
  slate: 0x484d55,
  coal: 0x2a2826,
  lamp: 0xfff0c8,
};

// a culture keeps a colour of its own even in steel and glass
const STYLE = {
  vale: { accent: 0xb0563c, brick: 0x9a4a36, brick2: 0x7a3828, trim: 0xe6dcc6 },
  dune: { accent: 0x2f9e98, brick: 0xc49262, brick2: 0xa47446, trim: 0xf2e8d2 },
  frost: { accent: 0x3d6b8a, brick: 0x7c3c2e, brick2: 0x5c2c22, trim: 0xdedad2 },
  mire: { accent: 0xc8802e, brick: 0xa05a3a, brick2: 0x80442a, trim: 0xe8dcb8 },
};

export function modernPalette(style, era) {
  const s = STYLE[style] || STYLE.vale;
  const e = Math.max(4, era | 0);
  return {
    ...MC,
    ...s,
    era: e,
    wall: e >= 7 ? 0xeef0ea : e >= 6 ? 0xd9dde1 : 0xc2bdb2,
    wall2: e >= 7 ? 0xdde8de : e >= 6 ? 0xb9c1c9 : 0xa29d94,
    glass: e >= 7 ? 0x86ccd8 : e >= 6 ? 0x6a9cc6 : 0x5d7c96,
    roof: e >= 7 ? 0x5f9a5a : 0x5c6066,
    frame: e >= 7 ? 0xf4f6f2 : e >= 6 ? 0x8a949c : 0x5a5e64,
  };
}

// ---------------------------------------------------------------- helpers
// glass bands, one per floor, round a block (glow: window code)
export function bands(g, P, cx, y0, cz, w, d, floors, fh, o = {}) {
  const k = o.k ?? 0.5;
  for (let i = 0; i < floors; i++) g.box(cx, y0 + i * fh + fh * (1 - k) * 0.55, cz, w + 0.02, fh * k, d + 0.02, o.col ?? P.glass, { glow: o.glow ?? 0.6, noTop: true });
}
// vertical mullions on the four faces of a block
export function mullions(g, cx, y0, cz, w, d, h, step, col, t = 0.025) {
  const nx = Math.max(1, Math.round(w / step)),
    nz = Math.max(1, Math.round(d / step));
  for (let i = 1; i < nx; i++) {
    const x = cx - w / 2 + (w * i) / nx;
    g.box(x, y0, cz + d / 2 + 0.012, t, h, 0.02, col, { noTop: true });
    g.box(x, y0, cz - d / 2 - 0.012, t, h, 0.02, col, { noTop: true });
  }
  for (let i = 1; i < nz; i++) {
    const z = cz - d / 2 + (d * i) / nz;
    g.box(cx + w / 2 + 0.012, y0, z, 0.02, h, t, col, { noTop: true });
    g.box(cx - w / 2 - 0.012, y0, z, 0.02, h, t, col, { noTop: true });
  }
}
// a flat roof: a slab with a low parapet
export function flatRoof(g, cx, y, cz, w, d, col, top, ph = 0.06) {
  g.box(cx, y, cz, w + 0.04, 0.04, d + 0.04, col, { top });
  const t = 0.04;
  g.box(cx, y + 0.04, cz + d / 2 - t / 2 + 0.02, w + 0.04, ph, t, col);
  g.box(cx, y + 0.04, cz - d / 2 + t / 2 - 0.02, w + 0.04, ph, t, col);
  g.box(cx + w / 2 - t / 2 + 0.02, y + 0.04, cz, t, ph, d - 0.04, col);
  g.box(cx - w / 2 + t / 2 - 0.02, y + 0.04, cz, t, ph, d - 0.04, col);
}
// a tapering lattice tower of four legs with zig-zag bracing
export function lattice(g, x, z, h, base, top, col, panels = 5, th = 0.024) {
  const L = (k) => base + (top - base) * k;
  for (const [sx, sz] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ])
    g.beam(x + sx * base, 0, z + sz * base, x + sx * top, h, z + sz * top, th * 1.3, col);
  for (let k = 0; k < panels; k++) {
    const y0 = (h * k) / panels,
      y1 = (h * (k + 1)) / panels;
    const s0 = L(k / panels),
      s1 = L((k + 1) / panels);
    const f = k % 2 ? 1 : -1;
    // one diagonal per face, alternating, and a ring at the top of the panel
    g.beam(x - s0, y0, z + s0, x + s1, y1, z + s1 * f, th * 0.7, col, { noTop: true });
    g.beam(x + s0, y0, z - s0, x - s1, y1, z - s1 * f, th * 0.7, col, { noTop: true });
    g.beam(x + s0, y0, z + s0 * f, x + s1, y1, z - s1 * f, th * 0.7, col, { noTop: true });
    g.beam(x - s0, y0, z - s0 * f, x - s1, y1, z + s1 * f, th * 0.7, col, { noTop: true });
    g.box(x, y1 - th * 0.5, z + s1, s1 * 2, th, th, col, { noTop: true });
    g.box(x, y1 - th * 0.5, z - s1, s1 * 2, th, th, col, { noTop: true });
    g.box(x + s1, y1 - th * 0.5, z, th, th, s1 * 2, col, { noTop: true });
    g.box(x - s1, y1 - th * 0.5, z, th, th, s1 * 2, col, { noTop: true });
  }
}
export function chimneyStack(g, P, x, z, y0, h, r, col, o = {}) {
  g.cyl(x, y0, z, r, h, 10, col, { r2: r * 0.78, cap: false });
  g.cyl(x, y0 + h * 0.86, z, r * 0.86, 0.05, 10, shade(col, 0.7), {});
  g.cyl(x, y0 + h - 0.06, z, r * 0.84, 0.07, 10, P.dark, {});
  if (o.bands) for (const t of [0.35, 0.62]) g.cyl(x, y0 + h * t, z, r * (1 - t * 0.22) + 0.006, 0.05, 10, o.bands, { cap: false });
  g.anchor('chimneys', x, y0 + h + 0.08, z, { rate: o.rate ?? 1.8, steam: !!o.steam });
}
function torus(g, cx, cy, cz, R, r, nu, nv, col, o = {}) {
  const P = (a, b) => [cx + Math.cos(a) * (R + r * Math.cos(b)), cy + r * Math.sin(b), cz + Math.sin(a) * (R + r * Math.cos(b))];
  for (let i = 0; i < nu; i++) {
    const a0 = (i / nu) * Math.PI * 2,
      a1 = ((i + 1) / nu) * Math.PI * 2,
      am = (a0 + a1) / 2;
    const ctr = [cx + Math.cos(am) * R, cy, cz + Math.sin(am) * R];
    for (let j = 0; j < nv; j++) {
      const b0 = (j / nv) * Math.PI * 2,
        b1 = ((j + 1) / nv) * Math.PI * 2;
      g.quad(P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1), col, o.tint || 0, o.glow || 0, ctr, 0.01);
    }
  }
}
// hyperbolic cooling tower with a dark throat and a steam anchor
function coolingTower(g, P, x, z, r0, rw, h, col) {
  const tw = 0.74;
  const a = tw / Math.sqrt((r0 / rw) ** 2 - 1);
  const R = (t) => rw * Math.sqrt(1 + ((t - tw) / a) ** 2);
  const n = 7;
  // the open ring of legs at the base
  g.cyl(x, 0, z, r0 + 0.01, 0.08, 18, shade(col, 0.55), { cap: false });
  let py = 0.08,
    pr = R(0.08 / h);
  for (let k = 1; k <= n; k++) {
    const t = k / n,
      y = h * t,
      r = R(t);
    g.cyl(x, py, z, pr, y - py, 18, k % 2 ? col : shade(col, 0.96), { r2: r, cap: false });
    py = y;
    pr = r;
  }
  g.cyl(x, h - 0.02, z, pr + 0.015, 0.05, 18, shade(col, 0.85), { cap: false });
  g.cyl(x, h - 0.3, z, pr * 0.95, 0.01, 18, 0x262626, {});
  g.anchor('chimneys', x, h + 0.05, z, { rate: 2.6, steam: true });
}
// a half cylinder lying along X (hangars, vaults): radius r, length L
export function vault(g, cx, y0, cz, L, r, col, o = {}) {
  g.push();
  g.translate(cx - L / 2, y0, cz);
  g.rotateZ(-Math.PI / 2);
  // cyl along local +Y = world +X; keep the upper half
  const seg = o.seg ?? 10;
  for (let i = 0; i < seg; i++) {
    const a = Math.PI * (i / seg),
      b = Math.PI * ((i + 1) / seg);
    const p = (t, y) => [-Math.sin(t) * r * (o.sy ?? 1), y, Math.cos(t) * r];
    g.quad(p(a, 0), p(b, 0), p(b, L), p(a, L), i % 2 ? col : shade(col, 0.94), o.tint || 0, 0, [0, L / 2, 0], 0.01);
  }
  // end walls
  if (o.ends !== false)
    for (const [y, c] of [
      [0, o.endA ?? shade(col, 0.82)],
      [L, o.endB ?? shade(col, 0.82)],
    ])
      for (let i = 0; i < seg; i++) {
        const a = Math.PI * (i / seg),
          b = Math.PI * ((i + 1) / seg);
        g.tri([0, y, 0], [-Math.sin(a) * r * (o.sy ?? 1), y, Math.cos(a) * r], [-Math.sin(b) * r * (o.sy ?? 1), y, Math.cos(b) * r], c, 0, 0, [0, L / 2, 0]);
      }
  g.pop();
}
export function tree(g, x, z, y0 = 0, s = 1) {
  g.box(x, y0, z, 0.04 * s, 0.16 * s, 0.04 * s, 0x6a4a2e, { noTop: true });
  g.bead(x, y0 + 0.1 * s, z, 0.13 * s, 0x4f8a44);
}
export function door(g, P, x, z, w, h, col, o = {}) {
  g.box(x, 0, z, w + 0.05, h + 0.04, 0.03, P.frame ?? P.trim ?? 0x5a5e64);
  g.box(x, 0, z + 0.012, w, h, 0.03, col, { tint: o.tint ?? 0 });
  if (o.canopy) g.box(x, h + 0.06, z + 0.1, w + 0.2, 0.03, 0.22, o.canopy);
  if (o.lamp !== false) {
    g.box(x + w / 2 + 0.08, h * 0.8, z + 0.03, 0.04, 0.06, 0.04, MC.lamp, { glow: 1 });
    g.anchor('lamps', x, 0, z + 0.4, { r: 1 });
  }
}
// a sign band in the realm's colour
export function sign(g, x, y, z, w, h = 0.07) {
  g.box(x, y, z, w, h, 0.03, 0xd8d0c0, { tint: 0.9 });
}
function insulator(g, x, y, z) {
  g.cyl(x, y - 0.14, z, 0.022, 0.14, 5, 0x9aa6b0, {});
}

// ---------------------------------------------------------------- models
const BUILD = {
  factory(g, P) {
    const e = P.era;
    const wallC = e >= 6 ? P.wall2 : P.brick;
    const x0 = -1.4,
      x1 = 0.72,
      z0 = -0.88,
      z1 = 0.46,
      h = 0.72;
    const cx = (x0 + x1) / 2,
      cz = (z0 + z1) / 2,
      w = x1 - x0,
      d = z1 - z0;
    g.box(cx, -0.06, cz, w + 0.06, 0.08, d + 0.06, P.concrete2);
    g.box(cx, 0, cz, w, h, d, wallC);
    // tall windows between pilasters along the front and back
    for (let i = 0; i < 6; i++) {
      const x = x0 + 0.18 + i * ((w - 0.36) / 5);
      for (const s of [1, -1]) {
        g.box(x, 0.12, cz + s * (d / 2 + 0.012), 0.16, 0.42, 0.02, P.glass, { glow: 1 });
        g.box(x, 0.33, cz + s * (d / 2 + 0.022), 0.16, 0.02, 0.012, P.frame);
      }
      if (i < 5) g.box(x + (w - 0.36) / 10, 0, cz + d / 2 + 0.01, 0.06, h, 0.04, e >= 6 ? P.steel : P.brick2);
    }
    g.box(cx, h - 0.06, cz, w + 0.04, 0.06, d + 0.04, e >= 6 ? P.steel : P.brick2);
    // the saw-tooth roof: glazed north lights facing +Z
    const teeth = 4,
      tz = d / teeth,
      th = 0.3;
    for (let i = 0; i < teeth; i++) {
      const za = z0 + i * tz,
        zb = za + tz;
      g.slab(x0 - 0.03, x1 + 0.03, za, h, zb, h + th, 0.035, e >= 7 ? P.green : P.slate, { rows: 2, roofKind: e >= 7 ? 4 : 3 });
      g.quad([x0, h, zb], [x1, h, zb], [x1, h + th, zb], [x0, h + th, zb], P.glass, 0, 1, [cx, h, zb - 0.1]);
      for (let k = 1; k < 8; k++) g.box(x0 + (w * k) / 8, h, zb + 0.01, 0.02, th, 0.02, P.frame, { noTop: true });
      for (const x of [x0, x1]) g.tri([x, h, za], [x, h, zb], [x, h + th, zb], wallC, 0, 0, [cx, h, (za + zb) / 2]);
    }
    // the chimneys
    const cc = e >= 6 ? P.concrete : P.brick2;
    chimneyStack(g, P, -1.05, -0.66, 0, 2.3, 0.14, cc, { rate: 2.2, bands: e >= 6 ? P.red : P.dark });
    chimneyStack(g, P, -0.5, -0.66, 0, 1.95, 0.12, cc, { rate: 1.8, bands: e >= 6 ? P.red : P.dark });
    // the office block with its door to the street
    const ox = 1.1,
      oz = 0.12,
      ow = 0.62,
      od = 1.0,
      oh = 0.9;
    g.box(ox, 0, oz, ow, oh, od, e >= 6 ? P.wall : P.brick);
    bands(g, P, ox, 0.12, oz, ow, od, 2, 0.4, { k: 0.45 });
    flatRoof(g, ox, oh, oz, ow, od, P.concrete2, P.slate);
    door(g, P, ox, oz + od / 2, 0.2, 0.32, P.accent, { canopy: P.accent });
    sign(g, ox, oh - 0.12, oz + od / 2 + 0.03, 0.5);
    // the yard: a gate, crates and a water tank on legs
    g.box(-0.4, 0, 0.72, 1.8, 0.02, 0.5, P.concrete2);
    for (let i = 0; i < 3; i++) g.box(-1.1 + i * 0.22, 0.02, 0.75, 0.18, 0.16, 0.2, i % 2 ? 0x8a6a44 : 0x7a5a3a);
    g.box(-0.45, 0.02, 0.8, 0.5, 0.2, 0.26, P.accent, { tint: 0.3 });
    for (const [sx, sz] of [
      [-0.1, -0.1],
      [0.1, -0.1],
      [-0.1, 0.1],
      [0.1, 0.1],
    ])
      g.box(0.25 + sx, h, -0.3 + sz, 0.03, 0.35, 0.03, P.steel);
    g.cyl(0.25, h + 0.35, -0.3, 0.16, 0.22, 10, P.steel2, {});
    g.anchor('lamps', 0, 0, 0.9, { r: 1 });
  },

  rowhouse(g, P) {
    const n = 4,
      uw = 0.68,
      d = 0.62,
      h = 0.95,
      bz = -0.12;
    const W = n * uw;
    const tones = [P.brick, shade(P.brick, 0.9), shade(P.brick, 1.06), shade(P.brick, 0.95)];
    g.box(0, -0.06, bz, W + 0.06, 0.1, d + 0.06, P.concrete2);
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + uw * (i + 0.5);
      g.box(x, 0.04, bz, uw - 0.005, h - 0.04, d, tones[i]);
      // door with fanlight and step, a bay window, two upper windows
      const fz = bz + d / 2;
      const dx = x + (i % 2 ? 0.2 : -0.2);
      g.box(dx, 0.04, fz + 0.012, 0.15, 0.32, 0.025, i % 2 ? P.accent : shade(P.accent, 0.6), { tint: 0.4 });
      g.box(dx, 0.37, fz + 0.012, 0.15, 0.05, 0.02, P.glass, { glow: 1 });
      g.box(dx, -0.02, fz + 0.07, 0.22, 0.06, 0.12, P.concrete);
      const bx = x - (i % 2 ? 0.1 : -0.1);
      g.box(bx, 0.04, fz + 0.06, 0.3, 0.38, 0.12, P.trim);
      g.box(bx, 0.12, fz + 0.06, 0.32, 0.22, 0.125, P.glass, { glow: 1, noTop: true });
      g.box(bx, 0.42, fz + 0.06, 0.34, 0.03, 0.14, P.slate);
      for (const u of [-0.15, 0.15]) {
        g.box(x + u, 0.58, fz + 0.012, 0.13, 0.22, 0.02, P.glass, { glow: 1 });
        g.box(x + u, 0.56, fz + 0.03, 0.17, 0.025, 0.04, P.trim);
      }
      g.box(x, 0.58, bz - d / 2 - 0.012, 0.16, 0.2, 0.02, P.glass, { glow: 1 });
      // the front railing
      g.box(x + (i % 2 ? -0.12 : 0.12), 0.0, fz + 0.25, 0.36, 0.14, 0.02, P.dark, { noTop: true });
    }
    g.gable(0, h, bz, W, d, 0.34, P.slate, { over: 0.07, th: 0.05, gable: P.brick, rows: 4 });
    for (let i = 0; i <= n; i++) {
      const x = -W / 2 + uw * i;
      const ins = i === 0 ? 0.08 : i === n ? -0.08 : 0;
      g.box(x + ins, h + 0.1, bz, 0.12, 0.38, 0.16, P.brick2);
      g.box(x + ins, h + 0.48, bz, 0.15, 0.03, 0.19, P.dark);
      for (const s of [-0.035, 0.035]) g.cyl(x + ins + s, h + 0.51, bz, 0.018, 0.06, 5, 0xb06a4a, {});
      if (i % 2 === 0) g.anchor('chimneys', x + ins, h + 0.6, bz, { rate: 0.45 });
    }
  },

  waterworks(g, P) {
    // the water tower
    const tx = -0.45,
      tz = -0.42,
      top = 1.55;
    for (const [sx, sz] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ])
      g.beam(tx + sx * 0.3, 0, tz + sz * 0.3, tx + sx * 0.2, top, tz + sz * 0.2, 0.05, P.steel);
    for (const y of [0.55, 1.05]) {
      const s = 0.3 - (0.1 * y) / top;
      g.box(tx, y, tz, s * 2, 0.03, 0.03, P.steel2, { noTop: true });
      g.box(tx, y, tz, 0.03, 0.03, s * 2, P.steel2, { noTop: true });
    }
    g.beam(tx - 0.3, 0.05, tz + 0.3, tx + 0.25, 1.0, tz + 0.25, 0.02, P.steel2);
    g.cyl(tx, top - 0.06, tz, 0.26, 0.08, 14, P.steel2, {});
    g.cyl(tx, top, tz, 0.42, 0.5, 16, P.era >= 6 ? P.white : 0x7d8f9a, { stripes: P.era >= 6 ? 0xe2e0d8 : 0x748690 });
    g.cone(tx, top + 0.5, tz, 0.44, 0.22, 16, P.slate, {});
    g.box(tx, top + 0.12, tz + 0.42, 0.3, 0.12, 0.02, 0xd8d0c0, { tint: 0.9 });
    // the pump house
    const px = 0.42,
      pz = 0.32,
      pw = 0.95,
      pd = 0.78,
      ph = 0.62;
    g.box(px, -0.05, pz, pw + 0.06, 0.08, pd + 0.06, P.concrete2);
    g.box(px, 0, pz, pw, ph, pd, P.era >= 6 ? P.wall : P.brick);
    for (const u of [-0.3, 0, 0.3]) {
      g.box(px + u, 0.14, pz + pd / 2 + 0.01, 0.14, 0.34, 0.02, P.glass, { glow: 1 });
      g.cyl(px + u, 0.48, pz + pd / 2 + 0.01, 0.07, 0.02, 8, P.glass, { glow: 1 });
    }
    g.hip(px, ph, pz, pw, pd, 0.32, P.slate, { over: 0.07, rows: 3 });
    g.box(px + 0.3, ph + 0.1, pz - 0.15, 0.1, 0.42, 0.1, P.brick2);
    g.anchor('chimneys', px + 0.3, ph + 0.58, pz - 0.15, { rate: 0.6 });
    door(g, P, px - 0.3, pz + pd / 2, 0.16, 0.3, P.accent, {});
    // the settling basin and its pipe
    g.cyl(0.5, 0, -0.55, 0.4, 0.14, 16, P.concrete, { cap: false });
    g.cyl(0.5, 0.11, -0.55, 0.36, 0.01, 16, P.water, {});
    g.beam(tx + 0.2, 0.1, tz, 0.12, 0.1, -0.5, 0.06, P.steel);
    g.beam(0.5, 0.1, -0.2, px, 0.1, pz - 0.2, 0.06, P.steel);
  },

  powerstation(g, P) {
    const e = P.era;
    const wallC = e >= 6 ? P.wall2 : P.brick;
    // the turbine hall
    const hx = -0.25,
      hz = -0.12,
      hw = 2.3,
      hd = 1.2,
      hh = 1.05;
    g.box(hx, -0.06, hz, hw + 0.06, 0.08, hd + 0.06, P.concrete2);
    g.box(hx, 0, hz, hw, hh, hd, wallC);
    for (let i = 0; i < 7; i++) {
      const x = hx - hw / 2 + 0.2 + i * ((hw - 0.4) / 6);
      g.box(x, 0.16, hz + hd / 2 + 0.012, 0.15, 0.68, 0.02, P.glass, { glow: 1 });
      g.box(x, 0.48, hz + hd / 2 + 0.022, 0.15, 0.02, 0.012, P.frame);
      g.box(x + (hw - 0.4) / 12, 0, hz + hd / 2 + 0.01, 0.07, hh, 0.04, e >= 6 ? P.steel : P.brick2);
    }
    g.box(hx, hh - 0.08, hz, hw + 0.04, 0.08, hd + 0.04, e >= 6 ? P.steel : P.brick2);
    g.gable(hx, hh, hz, hw, hd, 0.26, e >= 7 ? P.green : P.slate, { over: 0.05, th: 0.05, gable: wallC, rows: 3 });
    // a clerestory along the ridge
    g.box(hx, hh + 0.18, hz, hw * 0.8, 0.14, 0.22, P.glass, { glow: 1, top: P.slate });
    sign(g, hx, hh - 0.2, hz + hd / 2 + 0.03, 0.8, 0.09);
    door(g, P, hx + 0.9, hz + hd / 2, 0.24, 0.36, P.steel2, { lamp: true });
    // three tall chimneys behind
    for (const x of [-0.95, -0.25, 0.45]) chimneyStack(g, P, x, -0.8, hh * 0.6, 1.95, 0.12, e >= 6 ? P.concrete : 0xd8cfbc, { rate: 1.7 });
    g.box(-0.25, 0, -0.8, 1.7, hh * 0.6, 0.26, wallC);
    // the transformer yard
    g.box(1.25, 0, 0.0, 0.42, 0.02, 1.4, 0x7a7a72);
    for (let i = 0; i < 3; i++) {
      const z = -0.5 + i * 0.42;
      g.box(1.25, 0.02, z, 0.2, 0.2, 0.16, P.steel2);
      for (const s of [-0.06, 0.06]) g.cyl(1.25 + s, 0.22, z, 0.02, 0.16, 5, 0xb8a888, {});
    }
    g.box(1.12, 0, 0.0, 0.03, 0.6, 0.03, P.steel);
    g.box(1.38, 0, 0.0, 0.03, 0.6, 0.03, P.steel);
    g.box(1.25, 0.58, 0.0, 0.3, 0.03, 0.03, P.steel);
    // coal
    g.cone(-1.25, 0, 0.62, 0.22, 0.2, 7, P.coal, {});
    g.cone(-0.95, 0, 0.66, 0.16, 0.14, 7, P.coal, {});
  },

  pylon(g, P) {
    pylonModel(g, P.era >= 6 ? 0x8a929a : P.steel);
  },

  radiomast(g, P) {
    const h = 4.0;
    for (let k = 0; k < 6; k++) {
      const y0 = (h * k) / 6;
      g.push();
      g.translate(0, y0, 0);
      lattice(g, 0, 0, h / 6, 0.12 - k * 0.01, 0.11 - k * 0.01, k % 2 ? P.white : P.red, 2, 0.018);
      g.pop();
    }
    g.cyl(0, h, 0, 0.02, 0.45, 5, P.steel, {});
    g.box(0, h + 0.45, 0, 0.07, 0.07, 0.07, P.red, { glow: BEACON });
    g.box(0, h * 0.55, 0.1, 0.06, 0.06, 0.06, P.red, { glow: BEACON });
    // guy wires
    for (const a of [0.4, 2.5, 4.6]) g.beam(0, h * 0.7, 0, Math.cos(a) * 0.46, 0.0, Math.sin(a) * 0.46, 0.008, 0x9aa0a6);
    // a dish and the equipment hut
    g.push();
    g.translate(0.0, h * 0.42, 0.13);
    g.rotateX(Math.PI / 2.4);
    g.cyl(0, 0, 0, 0.13, 0.03, 10, P.white, { r2: 0.05 });
    g.pop();
    g.box(0.28, 0, 0.3, 0.32, 0.26, 0.28, P.concrete);
    g.box(0.28, 0.26, 0.3, 0.36, 0.03, 0.32, P.slate);
    g.box(0.28, 0.06, 0.445, 0.1, 0.16, 0.02, P.accent);
  },

  apartment(g, P, lv) {
    const e = P.era;
    const floors = lv >= 2 ? 7 : 4,
      fh = 0.38;
    const w = 1.6,
      d = 1.25,
      bz = -0.12;
    const h = floors * fh;
    const wallC = e >= 7 ? P.white : e >= 6 ? 0xe2e0d8 : 0xc9c2b4;
    g.box(0, -0.06, bz, w + 0.08, 0.1, d + 0.08, P.concrete2);
    g.box(0, 0, bz, w, h, d, wallC);
    bands(g, P, 0, 0.05, bz, w, d, floors, fh, { k: e >= 6 ? 0.62 : 0.45 });
    mullions(g, 0, 0.0, bz, w, d, h, 0.27, e >= 6 ? P.frame : shade(wallC, 0.82));
    // balconies on the front, the realm's colour on alternate rails
    for (let f = 1; f < floors; f++)
      for (const u of [-0.5, 0, 0.5]) {
        const x = u * w * 0.8,
          y = f * fh;
        g.box(x, y, bz + d / 2 + 0.1, 0.36, 0.035, 0.2, P.concrete);
        g.box(x, y + 0.035, bz + d / 2 + 0.195, 0.36, 0.11, 0.015, e >= 7 ? P.leaf : e >= 6 ? P.glass : P.accent, { tint: e >= 6 ? 0 : 0.25 });
        if (e >= 7 && (f + u * 2) % 2 === 0) g.bead(x + 0.1, y + 0.04, bz + d / 2 + 0.1, 0.06, P.leaf);
      }
    // the entrance with a canopy
    door(g, P, 0, bz + d / 2, 0.28, 0.3, P.glass, { canopy: P.accent, lamp: true });
    // the roof: lift and stair housing, water tank or garden
    flatRoof(g, 0, h, bz, w, d, P.concrete2, e >= 7 ? P.green : P.slate);
    g.box(-0.4, h + 0.04, bz - 0.15, 0.4, 0.28, 0.32, wallC);
    if (e >= 7) for (const [x, z] of [[0.3, bz + 0.2], [0.55, bz - 0.3], [0.1, bz - 0.35]]) tree(g, x, z, h + 0.04, 1.1);
    else if (e >= 6) for (let i = 0; i < 4; i++) g.box(0.25 + (i % 2) * 0.25, h + 0.05, bz - 0.25 + (i >> 1) * 0.3, 0.2, 0.06, 0.24, 0x2a3a5a, { top: 0x3a5a8a });
    else g.cyl(0.35, h + 0.04, bz - 0.2, 0.16, 0.24, 10, P.steel2, {});
    sign(g, 0, h - 0.1, bz + d / 2 + 0.02, 0.6);
  },

  campus(g, P) {
    const e = P.era;
    // the lawn and its paths
    g.box(0, -0.03, 0.0, 2.9, 0.05, 1.9, P.grass);
    g.box(0.2, 0.02, 0.62, 0.22, 0.01, 0.7, 0xc8c0b0);
    // the main block: screens behind the glass
    const ax = -0.62,
      az = -0.38,
      aw = 1.55,
      ad = 0.9,
      ah = 1.05;
    g.box(ax, 0, az, aw, ah, ad, P.white);
    bands(g, P, ax, 0.04, az, aw, ad, 3, ah / 3, { k: 0.6, glow: SCREEN });
    mullions(g, ax, 0, az, aw, ad, ah, 0.2, P.frame, 0.02);
    flatRoof(g, ax, ah, az, aw, ad, P.concrete2, e >= 7 ? P.green : P.slate);
    door(g, P, ax + 0.3, az + ad / 2, 0.3, 0.3, P.glass, { canopy: P.accent });
    sign(g, ax - 0.3, ah - 0.12, az + ad / 2 + 0.02, 0.6);
    // a satellite dish on the roof
    g.push();
    g.translate(ax - 0.45, ah + 0.18, az - 0.1);
    g.rotateX(-0.7);
    g.cyl(0, 0, 0, 0.2, 0.05, 12, P.white, { r2: 0.06 });
    g.pop();
    g.box(ax - 0.45, ah, az - 0.1, 0.05, 0.18, 0.05, P.steel);
    // the lab wing and its dome
    const bx = 0.82,
      bz = -0.1,
      bw = 1.05,
      bd = 1.3,
      bh = 0.62;
    g.box(bx, 0, bz, bw, bh, bd, P.white);
    bands(g, P, bx, 0.06, bz, bw, bd, 2, bh / 2, { k: 0.55, glow: SCREEN });
    flatRoof(g, bx, bh, bz, bw, bd, P.concrete2, P.slate);
    g.cyl(bx, bh + 0.04, bz - 0.1, 0.36, 0.12, 14, P.white, {});
    g.dome(bx, bh + 0.16, bz - 0.1, 0.36, 14, 4, e >= 6 ? 0xf2f2ee : P.white, { ribs: true });
    g.box(bx, bh + 0.16, bz + 0.17, 0.08, 0.3, 0.03, P.dark);
    // a glass bridge between them
    g.box(0.15, 0.4, -0.32, 0.36, 0.22, 0.26, P.glass, { glow: SCREEN, top: P.white });
    // trees on the lawn
    for (const [x, z] of [
      [-1.25, 0.5],
      [-0.85, 0.7],
      [0.75, 0.75],
      [1.2, 0.65],
    ])
      tree(g, x, z, 0, 1.3);
  },

  // four seeded towers (BuildingRenderer: the building's own variant) so a
  // downtown is a skyline, not a row of copies: 0 the stepped tower with a
  // mast, 1 a slender tower with a pointed crown, 2 a broad slab with a
  // rooftop deck, 3 a round tower with a ringed crown
  skyscraper(g, P, level = 1, variant = 0) {
    const e = P.era;
    const v = variant % 4;
    const glassC = e >= 7 ? [0x7cc4d4, 0x8ad0c8, 0x9ccad8, 0x74b8cc][v] : e >= 6 ? [0x5f8fb8, 0x4f7c9e, 0x6e9cb4, 0x58849a][v] : [0x6a8aa4, 0x7a8c98, 0x6a7e8e, 0x7894a8][v];
    const frameC = e >= 7 ? 0xf2f4f0 : e >= 6 ? [0x9aa4ac, 0x6e767e, 0xb8bec4, 0x8a9096][v] : [0xb4ab98, 0x9a8e7a, 0xc4bcaa, 0xa49a88][v];
    const shaft = (s, sd, y0, h) => {
      g.box(0, y0, 0, s, h, sd, glassC, { glow: 1, top: frameC });
      mullions(g, 0, y0, 0, s, sd, h, v === 2 ? 0.22 : 0.16, frameC, 0.03);
      const fl = Math.round(h / 0.34);
      for (let i = 1; i < fl; i++) g.box(0, y0 + (h * i) / fl, 0, s + 0.035, 0.03, sd + 0.035, frameC, { noTop: true });
      g.box(0, y0 + h, 0, s + 0.06, 0.06, sd + 0.06, frameC);
      if (e >= 7) {
        g.box(0, y0 + h + 0.06, 0, s - 0.02, 0.04, sd - 0.02, P.green);
        for (const [sx, sz] of [
          [1, 1],
          [-1, -1],
          [1, -1],
          [-1, 1],
        ])
          g.bead((sx * s) / 2.6, y0 + h + 0.06, (sz * sd) / 2.6, 0.09, P.leaf);
      }
    };
    // the podium and lobby
    const pw = v === 2 ? 1.8 : v === 1 ? 1.4 : 1.65,
      pd = v === 2 ? 1.5 : v === 1 ? 1.4 : 1.65;
    g.box(0, -0.06, 0, pw + 0.1, 0.1, pd + 0.1, P.concrete2);
    g.box(0, 0, 0, pw, 0.45, pd, frameC);
    g.box(0, 0.06, 0, pw + 0.02, 0.3, pd + 0.02, glassC, { glow: 1, noTop: true });
    flatRoof(g, 0, 0.45, 0, pw, pd, frameC, e >= 7 ? P.green : P.slate, 0.05);
    door(g, P, 0, pd / 2 + 0.015, 0.36, 0.26, glassC, { canopy: P.accent });
    let top;
    if (v === 1) {
      // slender: one tall shaft and a four-sided pointed crown
      shaft(0.95, 0.95, 0.49, 4.9);
      top = 5.45;
      g.cone(0, top, 0, 0.62, 1.1, 4, e >= 7 ? 0xf2f4f0 : frameC, { rot: Math.PI / 4 });
      g.cyl(0, top + 1.0, 0, 0.02, 0.6, 5, P.steel, {});
      g.box(0, top + 1.6, 0, 0.05, 0.05, 0.05, P.red, { glow: BEACON });
      if (e >= 7) g.box(0, top + 0.02, 0, 0.9, 0.04, 0.9, 0x7fe8f0, { glow: CYAN, noTop: true });
    } else if (v === 2) {
      // broad slab: wide and lower, a rooftop deck with plant rooms
      shaft(1.55, 1.05, 0.49, 3.1);
      top = 3.65;
      g.box(-0.35, top, 0, 0.6, 0.3, 0.6, P.concrete2);
      g.box(0.4, top, 0, 0.5, 0.04, 0.5, P.dark);
      g.box(0.4, top + 0.04, 0, 0.36, 0.005, 0.04, P.yellow);
      g.box(0.4, top + 0.04, 0, 0.04, 0.005, 0.36, P.yellow);
      g.box(-0.35, top + 0.3, 0, 0.05, 0.05, 0.05, P.red, { glow: BEACON });
      sign(g, 0, 2.9, 0.54, 0.7, 0.1);
      if (e >= 7) for (const x of [-0.6, 0.6]) g.bead(x, top, 0.35, 0.12, P.leaf);
      return;
    } else if (v === 3) {
      // round: a glass drum between white ribs and a ringed crown
      const r = 0.62,
        h = 4.2;
      g.cyl(0, 0.49, 0, r, h, 16, glassC, { glow: 1, capCol: frameC });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.box(Math.cos(a) * (r + 0.01), 0.49, Math.sin(a) * (r + 0.01), 0.05, h, 0.05, frameC, { ry: -a });
      }
      for (let k = 1; k < 12; k++) g.cyl(0, 0.49 + (h * k) / 12, 0, r + 0.015, 0.025, 16, frameC, { cap: false });
      top = 0.49 + h;
      g.cyl(0, top, 0, r * 0.75, 0.35, 16, frameC, { r2: r * 0.55 });
      g.cyl(0, top + 0.35, 0, r * 0.62, 0.05, 16, e >= 7 ? 0x7fe8f0 : P.accent, { glow: e >= 7 ? CYAN : 0, cap: false });
      g.cyl(0, top + 0.4, 0, 0.025, 0.7, 5, P.steel, {});
      g.box(0, top + 1.1, 0, 0.05, 0.05, 0.05, P.red, { glow: BEACON });
      if (e >= 7) g.bead(0, top + 0.35, 0, 0.2, P.leaf);
      return;
    } else {
      // stepped: the shaft, a setback, the crown and a mast
      for (const [sz, y0, h] of [
        [1.25, 0.49, 3.2],
        [0.95, 3.69, 1.25],
        [0.66, 4.94, 0.5],
      ])
        shaft(sz, sz, y0, h);
      for (const [sx, sz] of [
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ])
        g.box(sx * 0.6, 0.49, sz * 0.6, 0.08, 3.2, 0.08, frameC);
      g.box(0, 5.44, 0, 0.36, 0.18, 0.36, P.steel);
      g.cyl(0, 5.62, 0, 0.025, 0.9, 5, P.steel, {});
      g.box(0, 6.5, 0, 0.06, 0.06, 0.06, P.red, { glow: BEACON });
      if (e >= 7) g.box(0, 5.43, 0, 0.68, 0.04, 0.68, 0x7fe8f0, { glow: CYAN, noTop: true });
      top = 5.44;
    }
    sign(g, 0, 3.4, v === 1 ? 0.485 : 0.635, 0.5, 0.1);
  },

  nuclear(g, P) {
    coolingTower(g, P, -0.72, -0.62, 0.66, 0.44, 2.3, 0xc9c6bf);
    coolingTower(g, P, 0.74, -0.7, 0.6, 0.4, 2.1, 0xc3c0b8);
    // containment dome
    g.cyl(-0.6, 0, 0.78, 0.44, 0.55, 16, P.white, { cap: false });
    g.dome(-0.6, 0.55, 0.78, 0.44, 16, 5, P.white, {});
    g.cyl(-0.6, 0.3, 0.78, 0.45, 0.04, 16, P.accent, { cap: false });
    // turbine hall and switchyard
    g.box(0.55, 0, 0.78, 1.0, 0.55, 0.62, P.concrete);
    g.box(0.55, 0.12, 0.78, 1.02, 0.12, 0.64, P.glass, { glow: 1, noTop: true });
    g.box(0.55, 0.55, 0.78, 1.04, 0.04, 0.66, P.slate);
    g.box(0.05, 0, 0.78, 0.3, 0.3, 0.3, P.concrete2);
    door(g, P, 0.3, 1.09, 0.18, 0.28, P.steel2, {});
    sign(g, 0.75, 0.42, 1.1, 0.4);
    g.beam(0.05, 0.25, 0.65, 0.6, 0.15, -0.2, 0.05, P.steel);
    g.box(-1.3, 0, 1.3, 0.2, 0.02, 0.2, P.concrete2);
  },

  fusion(g, P) {
    const cz = -0.2;
    // the ring: a glowing torus on white piers
    g.box(0, -0.04, cz, 2.5, 0.06, 2.3, P.concrete);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.box(Math.cos(a) * 0.9, 0, cz + Math.sin(a) * 0.9, 0.14, 0.42, 0.14, P.white, { ry: -a });
    }
    torus(g, 0, 0.55, cz, 0.9, 0.15, 24, 6, 0xbff4ff, { glow: CYAN });
    torus(g, 0, 0.55, cz, 0.9, 0.165, 12, 4, P.white, {});
    // the reactor hall at its heart
    g.cyl(0, 0, cz, 0.42, 0.85, 16, P.white, { cap: false });
    g.cyl(0, 0.5, cz, 0.43, 0.06, 16, 0x7fe8f0, { glow: CYAN, cap: false });
    g.dome(0, 0.85, cz, 0.42, 16, 4, P.glass, {});
    // the control building in front and radiators to the sides
    g.box(0, 0, 1.15, 1.6, 0.42, 0.55, P.white);
    g.box(0, 0.12, 1.15, 1.62, 0.16, 0.57, P.glass, { glow: 1, noTop: true });
    flatRoof(g, 0, 0.42, 1.15, 1.6, 0.55, P.wall2, P.green);
    door(g, P, 0, 1.43, 0.3, 0.26, P.glass, { canopy: P.accent });
    for (const s of [-1, 1]) for (let i = 0; i < 5; i++) g.box(s * 1.32, 0, -1.0 + i * 0.22, 0.24, 0.5, 0.04, 0xd8dee2);
  },

  arcology(g, P) {
    // the tallest landmark of a Future realm: about 2.5-3x a skyscraper to the
    // top of its spire, stepping in from a wide green base to a white needle
    const tiers = [
      [3.7, 1.1],
      [3.05, 1.5],
      [2.45, 2.0],
      [1.85, 2.6],
      [1.3, 3.2],
      [0.8, 3.6],
    ];
    let y = 0;
    g.box(0, -0.05, 0, 3.85, 0.07, 3.85, P.concrete);
    for (let t = 0; t < tiers.length; t++) {
      const [s, h] = tiers[t];
      const round = t >= 4;
      if (round) {
        g.cyl(0, y, 0, s / 2, h, 14, P.white, { capCol: P.green });
        const nb = Math.max(2, Math.round(h / 0.4));
        for (let i = 0; i < nb; i++) g.cyl(0, y + (h * (i + 0.3)) / nb, 0, s / 2 + 0.01, (h / nb) * 0.55, 14, P.glass, { glow: 1, cap: false });
      } else {
        g.box(0, y, 0, s, h, s, P.white, { top: P.green });
        bands(g, P, 0, y + 0.02, 0, s, s, Math.max(1, Math.round(h / 0.36)), h / Math.max(1, Math.round(h / 0.36)), { k: 0.5 });
        mullions(g, 0, y, 0, s, s, h, 0.3, 0xf2f4f0, 0.03);
        // hanging green on the walls
        for (const sgn of [1, -1]) {
          g.box(0, y + h - 0.12, (sgn * s) / 2 + 0.02, s * 0.9, 0.12, 0.03, P.leaf);
          g.box((sgn * s) / 2 + 0.02, y + h - 0.12, 0, 0.03, 0.12, s * 0.9, P.leaf);
        }
      }
      // a band of clean cyan light at each terrace: the arcology reads at night
      if (t >= 1) g.box(0, y - 0.02, 0, s + 0.03, 0.04, s + 0.03, 0x7fe8f0, { glow: CYAN, noTop: true });
      // trees on the terrace this tier leaves free
      const ns = tiers[t + 1]?.[0];
      if (ns != null) {
        const r = (s + ns) / 4;
        const n = Math.max(4, Math.round(r * 3.2));
        for (let i = 0; i < n; i++) {
          const a = ((i + 0.5) / n) * Math.PI * 2;
          const k = Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
          tree(g, (Math.cos(a) * r) / (round ? 1 : k), (Math.sin(a) * r) / (round ? 1 : k), y + h, 1.2 + (i % 3) * 0.15);
        }
      }
      y += h;
    }
    // the crown: a glowing ring and a tall spire
    g.cyl(0, y, 0, 0.32, 0.08, 12, 0x7fe8f0, { glow: CYAN });
    g.cone(0, y + 0.08, 0, 0.3, 0.6, 10, P.white, {});
    g.cyl(0, y + 0.6, 0, 0.06, 2.6, 6, P.white, { r2: 0.015 });
    g.box(0, y + 3.2, 0, 0.08, 0.08, 0.08, P.red, { glow: BEACON });
    // entrances at the foot
    for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      g.push();
      g.rotateY(ry);
      g.box(0, 0, 1.86, 0.7, 0.36, 0.06, P.glass, { glow: 1 });
      g.box(0, 0.36, 1.92, 0.9, 0.04, 0.2, P.accent);
      g.anchor('lamps', 0, 0, 2.1, { r: 1.2 });
      g.pop();
    }
    sign(g, 0, 0.55, 1.865, 0.9, 0.1);
  },

  station(g, P) {
    const e = P.era;
    // the platform and its canopy along the back
    g.box(0, 0, -0.32, 2.9, 0.1, 0.32, P.concrete);
    g.box(0, 0.1, -0.47, 2.9, 0.012, 0.03, P.yellow);
    for (let i = 0; i < 6; i++) g.box(-1.25 + i * 0.5, 0.1, -0.32, 0.04, 0.48, 0.04, e >= 6 ? P.white : P.dark);
    g.slab(-1.45, 1.45, -0.52, 0.56, -0.18, 0.62, 0.03, e >= 6 ? P.white : P.steel, { rows: 2 });
    g.box(0.9, 0.1, -0.32, 0.36, 0.14, 0.08, P.accent, { tint: 0.4 });
    if (e >= 6) {
      // a glass hall under a white vault
      g.box(-0.2, 0, 0.12, 1.9, 0.5, 0.5, P.glass, { glow: 1, top: P.white });
      mullions(g, -0.2, 0, 0.12, 1.9, 0.5, 0.5, 0.2, P.white, 0.02);
      vault(g, -0.2, 0.5, 0.12, 2.0, 0.28, P.white, { sy: 0.8 });
      g.box(1.15, 0, 0.12, 0.5, 0.42, 0.5, P.white);
      g.box(1.15, 0.42, 0.12, 0.52, 0.03, 0.52, P.slate);
      door(g, P, -0.2, 0.37, 0.4, 0.34, P.glass, { canopy: P.accent });
      sign(g, -0.2, 0.86, 0.42, 0.7);
    } else {
      // a brick station house with a clock tower
      g.box(-0.2, 0, 0.1, 1.8, 0.62, 0.52, P.brick);
      for (let i = 0; i < 6; i++) {
        const x = -0.95 + i * 0.3;
        g.box(x, 0.14, 0.37, 0.13, 0.3, 0.02, P.glass, { glow: 1 });
        g.cyl(x, 0.44, 0.37, 0.065, 0.02, 8, P.glass, { glow: 1 });
      }
      g.hip(-0.2, 0.62, 0.1, 1.8, 0.52, 0.28, P.slate, { over: 0.06, rows: 3 });
      door(g, P, -0.05, 0.36, 0.22, 0.36, P.accent, { canopy: P.dark });
      g.box(1.15, 0, 0.12, 0.38, 1.25, 0.38, P.brick2);
      g.box(1.15, 0.95, 0.12, 0.42, 0.04, 0.42, P.trim);
      for (const [x, z, ry] of [
        [1.15, 0.315, 0],
        [1.345, 0.12, Math.PI / 2],
      ])
        g.box(x, 1.02, z, 0.2, 0.2, 0.02, 0xf4f0e0, { glow: 0.6, ry });
      g.hip(1.15, 1.25, 0.12, 0.38, 0.38, 0.32, P.slate, { over: 0.04, rows: 2 });
      sign(g, -0.2, 0.52, 0.37, 0.6);
    }
  },

  airfield(g, P) {
    g.box(0, -0.03, 0, 3.9, 0.05, 1.9, P.grass);
    // the strip
    g.box(0.15, 0.0, 0.42, 3.6, 0.03, 0.5, P.tarmac);
    for (let i = 0; i < 9; i++) g.box(-1.45 + i * 0.4, 0.031, 0.42, 0.18, 0.004, 0.03, P.stripe);
    for (const x of [-1.55, 1.85]) for (let k = 0; k < 4; k++) g.box(x, 0.031, 0.27 + k * 0.1, 0.12, 0.004, 0.05, P.stripe);
    // the hangar: a curved roof, doors toward the strip
    g.push();
    g.translate(-1.25, 0, -0.45);
    g.rotateY(Math.PI / 2);
    vault(g, 0, 0, 0, 0.85, 0.42, P.era >= 6 ? 0xb8bec4 : 0x8a9096, { endA: P.steel2, endB: 0x9a9a92 });
    g.pop();
    g.box(-1.25, 0, -0.02, 0.6, 0.34, 0.02, P.steel2);
    sign(g, -1.25, 0.38, 0.0, 0.3, 0.06);
    // the watch hut, a fuel tank and the windsock
    g.box(0.25, 0, -0.55, 0.42, 0.32, 0.36, P.white);
    g.box(0.25, 0.32, -0.55, 0.3, 0.16, 0.26, P.glass, { glow: 1, top: P.slate });
    g.box(0.25, 0.48, -0.55, 0.36, 0.03, 0.32, P.slate);
    door(g, P, 0.25, -0.37, 0.12, 0.24, P.accent, {});
    g.push();
    g.translate(0.95, 0.12, -0.6);
    g.rotateZ(Math.PI / 2);
    g.cyl(0, -0.25, 0, 0.11, 0.5, 10, P.white, {});
    g.pop();
    g.box(0.8, 0, -0.6, 0.04, 0.12, 0.2, P.steel);
    g.box(1.1, 0, -0.6, 0.04, 0.12, 0.2, P.steel);
    g.box(1.6, 0, -0.62, 0.025, 0.85, 0.025, P.white);
    g.push();
    g.translate(1.6, 0.8, -0.62);
    g.rotateZ(-Math.PI / 2 + 0.25);
    g.cyl(0, 0, 0, 0.055, 0.32, 8, P.orange, { r2: 0.03, stripes: P.white, cap: false });
    g.pop();
    g.box(1.6, 0.85, -0.62, 0.04, 0.04, 0.04, P.red, { glow: BEACON });
  },

  airport(g, P) {
    // the runway with its markings
    g.box(0, -0.03, 0, 4.9, 0.05, 2.9, 0x7f966a);
    g.box(0, 0, -0.85, 4.8, 0.03, 0.62, P.tarmac);
    for (let i = 0; i < 11; i++) g.box(-1.9 + i * 0.38, 0.031, -0.85, 0.2, 0.004, 0.025, P.stripe);
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 6; k++) g.box(sx * 2.25, 0.031, -1.08 + k * 0.092, 0.2, 0.004, 0.05, P.stripe);
      for (const dz of [-0.14, 0.14]) g.box(sx * 1.75, 0.031, -0.85 + dz, 0.26, 0.004, 0.06, P.stripe);
      for (let k = 0; k < 7; k++) {
        g.box(sx * (0.35 + k * 0.32), 0.03, -1.17, 0.03, 0.025, 0.03, P.lamp, { glow: LAMP });
        g.box(sx * (0.35 + k * 0.32), 0.03, -0.53, 0.03, 0.025, 0.03, P.lamp, { glow: LAMP });
      }
    }
    // taxiway and apron
    g.box(0, 0, -0.3, 4.2, 0.025, 0.2, 0x55575c);
    g.box(0, 0.026, -0.3, 4.2, 0.003, 0.015, P.yellow);
    g.box(-0.5, 0, 0.25, 2.8, 0.025, 0.7, 0x8c8c88);
    for (let i = 0; i < 3; i++) g.box(-1.4 + i * 0.8, 0.026, 0.25, 0.015, 0.003, 0.6, P.yellow);
    // the terminal: glass under a curved roof, with jet bridges
    const tz = 0.95;
    g.box(-0.5, 0, tz, 2.8, 0.42, 0.62, P.glass, { glow: 1, top: P.white });
    mullions(g, -0.5, 0, tz, 2.8, 0.62, 0.42, 0.2, P.white, 0.025);
    vault(g, -0.5, 0.42, tz, 3.0, 0.36, P.white, { sy: 0.5 });
    for (let i = 0; i < 3; i++) {
      const x = -1.4 + i * 0.8;
      g.box(x, 0.18, tz - 0.48, 0.1, 0.12, 0.36, P.white);
      g.box(x, 0, tz - 0.62, 0.05, 0.18, 0.05, P.steel);
    }
    door(g, P, -0.5, tz + 0.31, 0.5, 0.3, P.glass, { canopy: P.accent });
    sign(g, -0.5, 0.48, tz + 0.33, 1.0, 0.09);
    // the control tower
    const cx = 1.75,
      cz = 0.85;
    g.box(cx, 0, cz, 0.55, 0.32, 0.45, P.white);
    g.cyl(cx, 0.3, cz, 0.12, 1.55, 10, P.white, { r2: 0.09 });
    g.cyl(cx, 1.85, cz, 0.15, 0.08, 8, P.steel2, { r2: 0.24 });
    g.cyl(cx, 1.93, cz, 0.24, 0.2, 8, P.glass, { glow: 1, r2: 0.27 });
    g.cyl(cx, 2.13, cz, 0.29, 0.05, 8, P.dark, {});
    g.cyl(cx, 2.18, cz, 0.015, 0.3, 4, P.steel, {});
    g.box(cx, 2.48, cz, 0.05, 0.05, 0.05, P.red, { glow: BEACON });
  },

  containerport(g, P) {
    // the quay: water lies beyond +Z
    g.box(0, -0.4, 0, 2.95, 0.52, 1.95, P.concrete);
    g.box(0, 0.1, 0.93, 2.95, 0.03, 0.06, P.yellow);
    for (let i = 0; i < 6; i++) g.cyl(-1.25 + i * 0.5, 0.12, 0.88, 0.03, 0.05, 6, P.dark, {});
    g.box(0, 0.12, -0.05, 2.9, 0.01, 0.05, 0x9a8a5a);
    // stacked containers on the landward side
    const cols = [0xc0392b, 0x2e6fa8, 0xd68910, 0x1e8449, 0x8a3c7d, 0x7a8a96, 0xb85a2a, 0x2a8a8a];
    let k = 0;
    for (let row = 0; row < 3; row++)
      for (let i = 0; i < 7; i++) {
        const hgt = 1 + ((i * 7 + row * 3) % 3);
        for (let j = 0; j < hgt; j++) {
          const c = cols[(i * 5 + row * 3 + j * 7 + k++) % cols.length];
          g.box(-1.2 + i * 0.38, 0.12 + j * 0.15, -0.82 + row * 0.24, 0.34, 0.145, 0.2, c, { top: shade(c, 1.1) });
        }
      }
    // two gantry cranes, their booms out over the water
    for (const x of [-0.7, 0.75]) {
      const col = x < 0 ? P.red : P.accent;
      for (const sx of [-0.28, 0.28]) {
        for (const z of [-0.05, 0.62]) g.box(x + sx, 0.12, z, 0.06, 1.35, 0.06, col);
        g.box(x + sx, 0.42, 0.28, 0.05, 0.05, 0.72, col);
        g.box(x + sx, 0.12, 0.28, 0.08, 0.06, 0.8, P.dark);
        g.beam(x + sx, 1.47, -0.45, x + sx, 1.47, 1.75, 0.06, col);
        g.beam(x + sx, 2.0, 0.3, x + sx, 1.5, 1.7, 0.02, P.steel);
        g.beam(x + sx, 2.0, 0.3, x + sx, 1.5, -0.4, 0.02, P.steel);
        g.beam(x + sx, 1.47, 0.62, x + sx, 2.02, 0.3, 0.04, col);
        g.beam(x + sx, 1.47, -0.05, x + sx, 2.02, 0.3, 0.04, col);
      }
      for (const z of [-0.45, 0.3, 1.0, 1.7]) g.box(x, 1.44, z, 0.56, 0.04, 0.04, col, { noTop: true });
      g.box(x, 1.5, -0.3, 0.42, 0.22, 0.26, P.white);
      g.box(x, 1.25, 1.1, 0.22, 0.16, 0.2, P.white);
      g.box(x, 1.27, 1.21, 0.18, 0.08, 0.01, P.glass, { glow: 1 });
      g.box(x, 0.85, 1.1, 0.012, 0.4, 0.012, P.dark);
      const c2 = cols[(x > 0 ? 2 : 5) % cols.length];
      g.box(x, 0.7, 1.1, 0.34, 0.14, 0.2, c2);
      g.box(x, 2.03, 0.3, 0.05, 0.05, 0.05, P.red, { glow: BEACON });
    }
    g.anchor('lamps', 0, 0, 0.5, { r: 1.2 });
  },

  launchpad(g, P) {
    g.box(0, -0.05, 0, 2.9, 0.12, 2.9, P.concrete);
    // the launch mount over its flame trench
    g.box(0.15, 0.07, 0, 0.9, 0.36, 0.9, P.concrete2);
    g.box(0.15, 0.43, 0, 0.5, 0.03, 0.5, P.dark);
    g.box(0.15, 0.07, -0.95, 0.42, 0.006, 1.0, 0x1c1c1c);
    for (const s of [-1, 1]) g.box(0.15 + s * 0.23, 0.07, -0.95, 0.04, 0.12, 1.0, 0x5a5a56);
    g.slab(-0.06, 0.36, -0.45, 0.09, -0.15, 0.35, 0.04, 0x55534e, { rows: 1 });
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ])
      g.box(0.15 + sx * 0.18, 0.46, sz * 0.18, 0.06, 0.12, 0.06, P.steel2);
    // the service tower with its swing arms
    g.push();
    g.translate(-0.7, 0.07, 0);
    lattice(g, 0, 0, 3.0, 0.2, 0.17, P.orange, 8, 0.03);
    g.pop();
    for (const y of [1.2, 1.9, 2.6]) {
      g.box(-0.32, y, 0, 0.62, 0.05, 0.08, P.steel);
      g.box(-0.02, y - 0.04, 0, 0.06, 0.12, 0.14, P.white);
    }
    g.box(-0.7, 3.07, 0, 0.5, 0.06, 0.5, P.orange);
    g.cyl(-0.7, 3.13, 0, 0.02, 0.6, 4, P.steel, {});
    g.box(-0.7, 3.73, 0, 0.05, 0.05, 0.05, P.red, { glow: BEACON });
    // lightning masts, a water tower and fuel spheres
    for (const [x, z] of [
      [1.2, 1.2],
      [-1.2, -1.2],
    ]) {
      g.cyl(x, 0.07, z, 0.035, 2.4, 6, P.white, { r2: 0.015 });
      g.box(x, 2.47, z, 0.05, 0.05, 0.05, P.red, { glow: BEACON });
    }
    for (const [x, z] of [
      [1.0, -1.0],
      [-1.0, 1.0],
    ]) {
      for (const [sx, sz] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ])
        g.box(x + sx * 0.12, 0.07, z + sz * 0.12, 0.03, 0.4, 0.03, P.steel);
      g.bead(x, 0.32, z, 0.22, P.white);
    }
    g.box(1.15, 0.07, 0.35, 0.36, 0.22, 0.5, P.white);
    g.box(1.15, 0.29, 0.35, 0.38, 0.03, 0.52, P.slate);
    sign(g, 1.15, 0.12, 0.61, 0.3);
  },

  spaceport(g, P) {
    g.box(0, -0.05, 0, 3.9, 0.1, 3.9, P.concrete);
    // two landing pads, ringed with lights
    for (const x of [-0.95, 0.95]) {
      const z = -0.85;
      g.cyl(x, 0.05, z, 0.78, 0.04, 20, 0x5c5e62, {});
      g.cyl(x, 0.09, z, 0.7, 0.005, 20, P.stripe, {});
      g.cyl(x, 0.095, z, 0.62, 0.005, 20, 0x5c5e62, {});
      g.box(x, 0.1, z, 0.5, 0.004, 0.08, P.stripe);
      g.box(x, 0.1, z, 0.08, 0.004, 0.5, P.stripe);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        g.box(x + Math.cos(a) * 0.74, 0.09, z + Math.sin(a) * 0.74, 0.04, 0.025, 0.04, 0x9ff0ff, { glow: CYAN });
      }
    }
    // the hangar and terminal under a long white vault
    vault(g, -0.3, 0.05, 1.0, 2.4, 0.62, P.white, { sy: 0.75, endB: P.glass });
    g.box(-0.3, 0.05, 1.62, 1.8, 0.3, 0.02, P.glass, { glow: 1 });
    g.box(-0.3, 0.05, 0.38, 1.2, 0.36, 0.02, P.steel2);
    sign(g, -0.3, 0.5, 1.64, 1.0, 0.1);
    door(g, P, 0.4, 1.63, 0.3, 0.26, P.glass, { canopy: P.accent, lamp: true });
    // the control tower with its dome
    g.cyl(1.4, 0.05, 1.2, 0.18, 1.4, 10, P.white, { r2: 0.12 });
    g.cyl(1.4, 1.45, 1.2, 0.3, 0.2, 12, P.glass, { glow: 1 });
    g.dome(1.4, 1.65, 1.2, 0.3, 12, 3, P.white, {});
    g.cyl(1.4, 1.95, 1.2, 0.015, 0.35, 4, P.steel, {});
    g.box(1.4, 2.3, 1.2, 0.05, 0.05, 0.05, P.red, { glow: BEACON });
    // fuel tanks lying on cradles
    for (const z of [0.3, 0.65]) {
      g.push();
      g.translate(1.05, 0.25, z);
      g.rotateZ(Math.PI / 2);
      g.cyl(0, -0.4, 0, 0.14, 0.8, 10, P.white, {});
      g.pop();
      for (const x of [0.75, 1.35]) g.box(x, 0.05, z, 0.05, 0.12, 0.22, P.steel2);
    }
    g.box(-1.55, 0.05, -0.1, 0.5, 0.02, 0.5, P.yellow);
    g.anchor('lamps', 0, 0, 1.9, { r: 1.3 });
  },
};

// The pylon of the power lines (the town pylon and the pylons along each
// line share it, so the wires meet the arms). Arm tips in design units.
export const PYLON_ARMS = [
  [0.5, 2.12],
  [-0.5, 2.12],
  [0.4, 1.72],
  [-0.4, 1.72],
];
export function pylonModel(g, col) {
  lattice(g, 0, 0, 2.55, 0.26, 0.05, col, 6, 0.022);
  g.cone(0, 2.55, 0, 0.07, 0.18, 4, col, {});
  for (const [y, half] of [
    [2.26, 0.52],
    [1.86, 0.42],
  ]) {
    g.beam(-half, y, 0, half, y, 0, 0.035, col);
    g.beam(-half, y, 0, 0, y + 0.18, 0, 0.018, col);
    g.beam(half, y, 0, 0, y + 0.18, 0, 0.018, col);
    for (const s of [-1, 1]) insulator(g, s * (half - 0.02), y, 0);
  }
}

export const MODERN_MODELS = Object.keys(BUILD);

// A neutral block for any modern kind without a model (other modules add
// kinds): the right footprint and era, flat roof, window bands, a door.
export function modernFallback(g, P, def, level = 1) {
  const dw = def?.dw ?? def?.w ?? 2,
    dh = def?.dh ?? def?.h ?? 2;
  const w = Math.max(0.6, dw * 0.82),
    d = Math.max(0.6, dh * 0.78),
    bz = -dh * 0.04;
  const floors = Math.max(1, Math.min(5, Math.round(Math.min(dw, dh) * 0.9) + (level - 1) + (def?.housing ? 1 : 0)));
  const fh = 0.38;
  const h = floors * fh;
  const wallC = P.era >= 6 ? P.wall : P.era >= 5 ? 0xc6c0b4 : P.brick;
  g.box(0, -0.06, bz, w + 0.06, 0.1, d + 0.06, P.concrete2);
  g.box(0, 0, bz, w, h, d, wallC);
  bands(g, P, 0, 0.04, bz, w, d, floors, fh, { k: P.era >= 6 ? 0.6 : 0.45 });
  mullions(g, 0, 0, bz, w, d, h, 0.3, P.era >= 6 ? P.frame : shade(wallC, 0.8));
  flatRoof(g, 0, h, bz, w, d, P.concrete2, P.era >= 7 ? P.green : P.slate);
  g.box(-w * 0.2, h + 0.04, bz - d * 0.15, Math.min(0.4, w * 0.3), 0.18, Math.min(0.3, d * 0.3), P.steel);
  door(g, P, 0, bz + d / 2, Math.min(0.3, w * 0.3), 0.3, P.accent, { canopy: P.accent });
  sign(g, 0, Math.min(h - 0.08, 0.5), bz + d / 2 + 0.02, Math.min(0.8, w * 0.6));
}

// Build a modern model into `g`; false when the kind has none.
export function modernModel(g, kind, style, level = 1, era = 5, variant = 0) {
  const fn = BUILD[kind];
  if (!fn) return false;
  fn(g, modernPalette(style, era), level, variant);
  return true;
}
