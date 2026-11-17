// PLACEHOLDER models for the buildings of the modern and future eras
// (docs/MODERN-ERAS.md): plain, recognisable shapes of the right footprint
// so nothing the simulation builds is invisible. The Buildings renderer
// keys on the building's `kind` (catalog.js); a later pass replaces each of
// these with a proper model. Local units are tiles; the door faces +Z.

const C = {
  brick: 0x9a4a36,
  brick2: 0x7e3a2a,
  concrete: 0xb4b0a8,
  concrete2: 0x8e8a84,
  steel: 0x70767c,
  dark: 0x3a3d42,
  glass: 0x5f86a8,
  white: 0xe8e6e0,
  green: 0x5f9a5a,
  tarmac: 0x4a4c50,
  stripe: 0xe4e2da,
  water: 0x3f6f8a,
  red: 0xc0392b,
  glow: 0x9fe8ff,
};

function chimneyStack(g, x, z, h, r = 0.13) {
  g.cyl(x, 0, z, r, h, 8, C.brick2, { r2: r * 0.8 });
  g.cyl(x, h, z, r * 0.9, 0.06, 8, C.dark, {});
  g.anchor('chimneys', x, h + 0.08, z, { rate: 1.6 });
}
function windowBand(g, cx, cz, w, d, y, h = 0.1) {
  // a lit band of windows around a block (glows at night)
  g.box(cx, y, cz, w + 0.02, h, d + 0.02, C.glass, { glow: 0.7, noTop: true });
}
function tower(g, cx, cz, w, d, h, wall, bands = 4) {
  g.box(cx, 0, cz, w, h, d, wall);
  for (let i = 0; i < bands; i++) windowBand(g, cx, cz, w, d, ((i + 0.6) * h) / (bands + 0.6), Math.min(0.12, (h / bands) * 0.4));
}
function lattice(g, x, z, h, base, col) {
  // a tapering lattice tower of four legs
  for (const [sx, sz] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ])
    g.beam(x + sx * base, 0, z + sz * base, x + sx * 0.03, h, z + sz * 0.03, 0.025, col);
  for (let k = 1; k < 4; k++) {
    const y = (h * k) / 4,
      s = base * (1 - k / 4) + 0.03;
    g.box(x, y, z, s * 2, 0.02, s * 2, col, { noTop: false });
  }
}

const BUILD = {
  factory(g) {
    g.box(0, 0, -0.1, 2.6, 0.85, 1.5, C.brick);
    for (let i = 0; i < 4; i++) g.gable(-0.98 + i * 0.65, 0.85, -0.1, 0.62, 1.5, 0.28, C.steel, {});
    windowBand(g, 0, -0.1, 2.6, 1.5, 0.45, 0.14);
    chimneyStack(g, 0.95, -0.55, 2.1);
    chimneyStack(g, 0.55, -0.6, 1.7, 0.11);
    g.box(-0.9, 0, 0.75, 0.5, 0.35, 0.3, C.concrete2);
    g.anchor('lamps', 0, 0, 0.8, { r: 1 });
  },
  rowhouse(g) {
    g.box(0, 0, 0, 2.7, 0.75, 0.75, C.brick);
    g.gable(0, 0.75, 0, 2.75, 0.8, 0.3, C.dark, {});
    for (let i = 0; i < 3; i++) {
      g.box(-0.9 + i * 0.9, 0.18, 0.38, 0.22, 0.32, 0.02, C.glass, { glow: 0.8 });
      g.box(-0.9 + i * 0.9 + 0.3, 0.9, -0.1, 0.1, 0.32, 0.1, C.brick2);
      g.anchor('chimneys', -0.9 + i * 0.9 + 0.3, 1.24, -0.1, { rate: 0.5 });
    }
  },
  waterworks(g) {
    g.cyl(-0.35, 0, -0.3, 0.55, 0.55, 14, C.concrete, {});
    g.cyl(-0.35, 0.55, -0.3, 0.5, 0.02, 14, C.water, {});
    g.box(0.45, 0, 0.3, 0.7, 0.6, 0.7, C.brick);
    g.gable(0.45, 0.6, 0.3, 0.75, 0.75, 0.25, C.dark, {});
    g.cyl(0.6, 0, -0.5, 0.06, 1.3, 6, C.steel, {});
    g.cyl(0.6, 1.3, -0.5, 0.28, 0.35, 10, C.concrete2, {});
  },
  powerstation(g) {
    g.box(-0.3, 0, -0.1, 1.9, 1.05, 1.3, C.brick);
    g.gable(-0.3, 1.05, -0.1, 1.95, 1.3, 0.3, C.steel, {});
    windowBand(g, -0.3, -0.1, 1.9, 1.3, 0.55, 0.16);
    chimneyStack(g, 0.95, -0.4, 2.5, 0.16);
    chimneyStack(g, 0.95, 0.3, 2.5, 0.16);
    for (let i = 0; i < 3; i++) g.box(-0.9 + i * 0.5, 0, 0.75, 0.22, 0.3, 0.22, C.steel);
  },
  pylon(g) {
    lattice(g, 0, 0, 2.3, 0.28, C.steel);
    g.box(0, 2.0, 0, 0.9, 0.04, 0.05, C.steel);
    g.box(0, 1.6, 0, 0.7, 0.04, 0.05, C.steel);
  },
  radiomast(g) {
    lattice(g, 0, 0, 3.2, 0.22, C.red);
    g.cyl(0, 3.2, 0, 0.03, 0.4, 5, C.steel, {});
    g.box(0, 3.55, 0, 0.08, 0.08, 0.08, C.red, { glow: 1 });
    g.box(0.25, 0, 0.3, 0.35, 0.3, 0.3, C.concrete);
  },
  apartment(g, lv) {
    tower(g, 0, 0, 1.7, 1.6, lv >= 2 ? 2.6 : 1.7, C.concrete, lv >= 2 ? 6 : 4);
    g.box(0, lv >= 2 ? 2.6 : 1.7, 0, 1.75, 0.06, 1.65, C.concrete2);
  },
  campus(g) {
    tower(g, -0.6, -0.1, 1.3, 1.2, 0.9, C.white, 2);
    tower(g, 0.75, 0.0, 1.0, 1.0, 0.6, C.white, 1);
    g.dome(0.75, 0.6, 0.0, 0.4, 10, 4, C.glass, {});
    g.cyl(-0.6, 0.9, -0.1, 0.03, 0.8, 5, C.steel, {});
  },
  skyscraper(g) {
    tower(g, 0, 0, 1.5, 1.5, 3.6, C.glass, 9);
    tower(g, 0, 0, 1.1, 1.1, 4.6, C.glass, 0);
    g.box(0, 4.6, 0, 0.6, 0.3, 0.6, C.steel);
    g.cyl(0, 4.9, 0, 0.03, 0.6, 5, C.steel, {});
    g.box(0, 5.5, 0, 0.06, 0.06, 0.06, C.red, { glow: 1 });
  },
  nuclear(g) {
    for (const x of [-0.75, 0.75]) {
      g.cyl(x, 0, -0.55, 0.75, 1.1, 16, C.concrete, { r2: 0.52 });
      g.cyl(x, 1.1, -0.55, 0.52, 0.9, 16, C.concrete, { r2: 0.62 });
      g.anchor('chimneys', x, 2.05, -0.55, { rate: 2.2, steam: true });
    }
    g.cyl(0, 0, 0.8, 0.5, 0.6, 14, C.white, {});
    g.dome(0, 0.6, 0.8, 0.5, 12, 5, C.white, {});
    g.box(-0.9, 0, 0.9, 0.7, 0.5, 0.6, C.concrete2);
  },
  fusion(g) {
    g.box(0, 0, 0.6, 2.4, 0.5, 1.0, C.white);
    // the ring: a glowing torus of segments around the reactor
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      g.box(Math.cos(a) * 0.9, 0.55, -0.45 + Math.sin(a) * 0.9, 0.28, 0.22, 0.28, C.glow, { glow: 1, ry: -a });
    }
    g.cyl(0, 0, -0.45, 0.45, 1.0, 14, C.white, {});
    g.dome(0, 1.0, -0.45, 0.45, 12, 5, C.glass, {});
  },
  arcology(g) {
    const tiers = [
      [3.7, 0.9],
      [3.0, 1.0],
      [2.3, 1.1],
      [1.6, 1.3],
      [0.9, 1.6],
    ];
    let y = 0;
    for (const [s, h] of tiers) {
      g.box(0, y, 0, s, h, s, C.white, { top: C.green });
      windowBand(g, 0, 0, s, s, y + h * 0.5, 0.18);
      y += h;
    }
    g.cyl(0, y, 0, 0.04, 1.0, 5, C.steel, {});
    g.box(0, y + 1.0, 0, 0.1, 0.1, 0.1, C.glow, { glow: 1 });
  },
  station(g) {
    g.box(-0.6, 0, -0.05, 1.4, 0.75, 0.7, C.brick);
    g.gable(-0.6, 0.75, -0.05, 1.45, 0.75, 0.3, C.dark, {});
    g.box(0.75, 0.55, -0.05, 1.2, 0.05, 0.8, C.steel);
    for (const x of [0.25, 1.25]) g.cyl(x, 0, -0.05, 0.03, 0.55, 5, C.steel, {});
    g.box(-0.6, 0.85, 0.36, 0.25, 0.25, 0.04, C.white, { glow: 0.6 }); // the clock
    g.anchor('lamps', 0.6, 0, 0.4, { r: 1 });
  },
  airfield(g) {
    g.box(0.3, 0, 0, 3.3, 0.03, 0.55, C.tarmac, { top: 0x6b6f63 });
    for (let i = 0; i < 6; i++) g.box(-1.0 + i * 0.5, 0.031, 0, 0.22, 0.005, 0.05, C.stripe);
    g.box(-1.55, 0, -0.55, 0.8, 0.5, 0.75, C.steel);
    g.gable(-1.55, 0.5, -0.55, 0.85, 0.8, 0.25, C.steel, {});
    g.cyl(-1.75, 0, 0.7, 0.03, 0.9, 5, C.white, {});
    g.cone(-1.75, 0.9, 0.7, 0.07, 0.2, 6, C.red, {});
  },
  airport(g) {
    g.box(0.4, 0, -0.6, 4.4, 0.03, 0.7, C.tarmac);
    for (let i = 0; i < 8; i++) g.box(-1.4 + i * 0.5, 0.031, -0.6, 0.25, 0.005, 0.05, C.stripe);
    tower(g, -0.6, 0.85, 2.2, 0.8, 0.55, C.white, 1);
    g.box(-0.6, 0.55, 0.85, 2.3, 0.05, 0.9, C.glass);
    g.cyl(1.35, 0, 0.8, 0.12, 1.4, 8, C.white, {});
    g.cyl(1.35, 1.4, 0.8, 0.24, 0.28, 10, C.glass, { glow: 0.8 });
  },
  containerport(g) {
    g.box(0, 0, 0, 2.8, 0.18, 1.8, C.concrete);
    const cols = [0xc0392b, 0x2e86c1, 0xd68910, 0x1e8449, 0x7d3c98];
    for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) g.box(-1.0 + i * 0.36, 0.18 + j * 0.16, 0.45, 0.32, 0.15, 0.6, cols[(i + j * 2) % cols.length]);
    for (const x of [-0.7, 0.7]) {
      g.beam(x - 0.35, 0.18, -0.7, x - 0.35, 1.5, -0.7, 0.05, C.red);
      g.beam(x + 0.35, 0.18, -0.7, x + 0.35, 1.5, -0.7, 0.05, C.red);
      g.beam(x, 1.5, -0.2, x, 1.5, -1.4, 0.06, C.red);
    }
  },
  launchpad(g) {
    g.box(0, 0, 0, 2.8, 0.12, 2.8, C.concrete);
    g.box(0, 0.12, 0, 1.0, 0.02, 1.0, C.dark);
    lattice(g, -0.8, -0.2, 3.0, 0.2, C.red);
    g.cyl(0.05, 0.14, 0, 0.16, 2.3, 10, C.white, {});
    g.cone(0.05, 2.44, 0, 0.16, 0.45, 10, C.white, {});
    for (const a of [0, 2.1, 4.2]) g.box(0.05 + Math.cos(a) * 0.18, 0.14, Math.sin(a) * 0.18, 0.06, 0.4, 0.2, C.dark, { ry: a });
  },
  spaceport(g) {
    g.box(0, 0, 0, 3.8, 0.1, 3.8, C.concrete);
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      g.box(0.6 + Math.cos(a) * 0.8, 0.1, -0.6 + Math.sin(a) * 0.8, 0.22, 0.01, 0.08, C.stripe, { ry: -a, glow: 0.5 });
    }
    tower(g, -1.2, 1.2, 1.2, 1.0, 0.9, C.white, 2);
    g.dome(-1.2, 0.9, 1.2, 0.5, 10, 4, C.glass, {});
    g.cyl(0.6, 0.1, -0.6, 0.18, 2.0, 10, C.white, {});
    g.cone(0.6, 2.1, -0.6, 0.18, 0.4, 10, C.dark, {});
    lattice(g, 1.4, 1.2, 2.4, 0.18, C.steel);
  },
};

// Build a modern placeholder into `g`; returns archetype info like the others.
export function modernPlaceholder(g, type, level = 1) {
  const fn = BUILD[type];
  if (!fn) return null;
  fn(g, level);
  return {};
}
export const MODERN_PLACEHOLDERS = Object.keys(BUILD);
