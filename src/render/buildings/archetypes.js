import { GeoBuilder, shade, mix } from './geom.js';

// Procedural architecture for every building type x culture style x level.
// Local space: footprint centred on the origin, ground (levelled) at y = 0,
// the door faces +Z. One tile = one world unit; villagers are ~0.6 tall.
//
// Styles
//   vale  — whitewashed timber frames, golden thatch, terracotta tile
//   dune  — sandstone and mudbrick, flat parapet roofs, domes, wind-catchers
//   frost — fieldstone, dark timber, steep slate and turf, snow on the ridges
//   mire  — houses on stilts, woven reed walls, saddle-shaped palm thatch

export const PAL = {
  vale: {
    wall: 0xf0e6cf,
    wall2: 0xe4d4b2,
    timber: 0x5c3c25,
    timber2: 0x7a5534,
    stone: 0xa39b8d,
    stone2: 0x847c70,
    thatch: 0xd4a85a,
    thatch2: 0xb38842,
    tile: 0xb0563c,
    roofTint: 0.13,
    thatchTint: 0.06,
    door: 0x6e4526,
    glass: 0x2a3442,
    trim: 0x4e3320,
    flower: 0xe0607a,
    plank: 0xa87c50,
    metal: 0x5d6168,
    cloth: 0xf2ead8,
  },
  dune: {
    wall: 0xe8c690,
    wall2: 0xf3e2c0,
    timber: 0x7d5634,
    timber2: 0x95683e,
    stone: 0xd4ae79,
    stone2: 0xbf9662,
    thatch: 0xe0c48a,
    thatch2: 0xc9a56a,
    tile: 0xf2ead6,
    roofTint: 0.18,
    thatchTint: 0.06,
    door: 0x5d3a22,
    glass: 0x2b2a30,
    trim: 0x8a6440,
    flower: 0x3aa69c,
    plank: 0xa98055,
    metal: 0x8a7a5a,
    cloth: 0xf5ecd6,
    accent: 0x2f9e98,
  },
  frost: {
    wall: 0x6e4a30,
    wall2: 0x84603f,
    timber: 0x43291a,
    timber2: 0x5e3e27,
    stone: 0x9a958c,
    stone2: 0x7a756c,
    thatch: 0x6f8040,
    thatch2: 0x5a6a34,
    tile: 0x4b5562,
    roofTint: 0.1,
    thatchTint: 0.04,
    door: 0x3e2b1e,
    glass: 0x27313b,
    trim: 0xc09a45,
    flower: 0xb84a3a,
    plank: 0x7d6046,
    metal: 0x5c6066,
    cloth: 0xe8e2d4,
    snow: 0xf4f7fb,
  },
  mire: {
    wall: 0xcaa86c,
    wall2: 0xb8955a,
    timber: 0x6e4e30,
    timber2: 0x86603a,
    stone: 0x8f8c79,
    stone2: 0x737061,
    thatch: 0xbfa05a,
    thatch2: 0x8f7a3c,
    tile: 0xa88f52,
    roofTint: 0.06,
    thatchTint: 0.05,
    door: 0x4b3420,
    glass: 0x2b2a22,
    trim: 0x5a3e26,
    flower: 0xe08a3a,
    plank: 0x9c7448,
    metal: 0x5d5a50,
    cloth: 0xece0c4,
  },
};

// Roof surface kinds, picked by material colour, drive the roof shader detail.
const ROOF_KIND = new Map([
  [PAL.vale.thatch, 1],
  [PAL.vale.thatch2, 1],
  [PAL.vale.tile, 2],
  [PAL.dune.thatch, 1],
  [PAL.frost.tile, 3],
  [PAL.frost.thatch, 4],
  [PAL.mire.thatch, 1],
  [PAL.mire.thatch2, 1],
  [PAL.mire.tile, 1],
]);
export function roofKind(col) {
  return ROOF_KIND.get(col) || 0;
}

// ---------------------------------------------------------------- helpers
// Place something on a wall face. face: 'F' (+Z) | 'B' (-Z) | 'R' (+X) | 'L' (-X)
function face(cx, cz, w, d, f, u) {
  switch (f) {
    case 'F':
      return { x: cx + u * w, z: cz + d / 2, ry: 0, nx: 0, nz: 1 };
    case 'B':
      return { x: cx - u * w, z: cz - d / 2, ry: Math.PI, nx: 0, nz: -1 };
    case 'R':
      return { x: cx + w / 2, z: cz - u * d, ry: Math.PI / 2, nx: 1, nz: 0 };
    default:
      return { x: cx - w / 2, z: cz + u * d, ry: -Math.PI / 2, nx: -1, nz: 0 };
  }
}

function windowOn(g, K, cx, cz, w, d, f, u, y, o = {}) {
  const p = face(cx, cz, w, d, f, u);
  const ww = o.w ?? 0.15,
    wh = o.h ?? 0.17;
  const out = 0.012;
  // frame & sill
  g.box(p.x + p.nx * 0.008, y - 0.015, p.z + p.nz * 0.008, ww + 0.05, wh + 0.04, 0.025, o.frame ?? K.trim, { ry: p.ry });
  g.box(p.x + p.nx * 0.03, y - 0.04, p.z + p.nz * 0.03, ww + 0.08, 0.03, 0.07, o.sill ?? K.stone, { ry: p.ry });
  g.box(p.x + p.nx * out, y, p.z + p.nz * out, ww, wh, 0.03, K.glass, { ry: p.ry, glow: 1 });
  if (o.cross !== false) {
    g.box(p.x + p.nx * (out + 0.016), y, p.z + p.nz * (out + 0.016), 0.018, wh, 0.01, o.frame ?? K.trim, { ry: p.ry });
    g.box(p.x + p.nx * (out + 0.016), y + wh / 2 - 0.009, p.z + p.nz * (out + 0.016), ww, 0.018, 0.01, o.frame ?? K.trim, { ry: p.ry });
  }
  if (o.shutters) {
    const sx = Math.cos(p.ry),
      sz = -Math.sin(p.ry);
    for (const s of [-1, 1]) {
      const off = (ww / 2 + 0.045) * s;
      g.box(p.x + sx * off + p.nx * 0.02, y - 0.005, p.z + sz * off + p.nz * 0.02, 0.07, wh + 0.02, 0.02, o.shutterCol ?? K.door, { ry: p.ry, tint: o.shutterTint ?? 0.85 });
    }
  }
  if (o.flowers) {
    g.box(p.x + p.nx * 0.06, y - 0.075, p.z + p.nz * 0.06, ww + 0.04, 0.05, 0.06, K.timber2, { ry: p.ry });
    g.box(p.x + p.nx * 0.06, y - 0.03, p.z + p.nz * 0.06, ww, 0.04, 0.045, K.flower, { ry: p.ry, jit: 0.2 });
  }
}

function doorOn(g, K, cx, cz, w, d, f, u, y, o = {}) {
  const p = face(cx, cz, w, d, f, u);
  const dw = o.w ?? 0.22,
    dh = o.h ?? 0.4;
  g.box(p.x + p.nx * 0.008, y, p.z + p.nz * 0.008, dw + 0.06, dh + 0.04, 0.03, o.frame ?? K.trim, { ry: p.ry });
  g.box(p.x + p.nx * 0.02, y, p.z + p.nz * 0.02, dw, dh, 0.03, o.col ?? K.door, { ry: p.ry, tint: o.tint ?? 0 });
  if (o.arch) g.cyl(p.x + p.nx * 0.02, y + dh - 0.001, p.z + p.nz * 0.02, dw / 2, 0.001, 6, o.col ?? K.door, {});
  // a warm lamp glow by the door at night
  if (o.lamp !== false) {
    const sx = Math.cos(p.ry),
      sz = -Math.sin(p.ry);
    const lx = p.x + sx * (dw / 2 + 0.09) + p.nx * 0.05,
      lz = p.z + sz * (dw / 2 + 0.09) + p.nz * 0.05;
    g.box(lx, y + dh * 0.82, lz, 0.05, 0.07, 0.05, 0xffd48a, { glow: 1 });
    g.anchor('lamps', p.x + p.nx * 0.4, 0, p.z + p.nz * 0.4, { r: o.lampR ?? 1.0 });
  }
  // step
  if (o.step !== false) g.box(p.x + p.nx * 0.08, y - 0.06, p.z + p.nz * 0.08, dw + 0.12, 0.07, 0.14, K.stone, { ry: p.ry });
}

// Timber framing over a plastered box.
function timberFrame(g, K, cx, y0, cz, w, d, h, o = {}) {
  const t = o.t ?? 0.045;
  const c = o.col ?? K.timber;
  const out = 0.012;
  // corner posts
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) g.box(cx + sx * (w / 2 - t / 2 + out), y0, cz + sz * (d / 2 - t / 2 + out), t, h, t, c);
  // top & base & mid beams on each face
  const levels = o.mid === false ? [0, h - t] : [0, h * 0.5 - t / 2, h - t];
  for (const yy of levels) {
    g.box(cx, y0 + yy, cz + d / 2 + out, w + out * 2, t, 0.03, c);
    g.box(cx, y0 + yy, cz - d / 2 - out, w + out * 2, t, 0.03, c);
    g.box(cx + w / 2 + out, y0 + yy, cz, 0.03, t, d + out * 2, c);
    g.box(cx - w / 2 - out, y0 + yy, cz, 0.03, t, d + out * 2, c);
  }
  // studs
  const n = o.studs ?? Math.max(1, Math.round(w / 0.38));
  for (let i = 1; i < n; i++) {
    const x = cx - w / 2 + (w * i) / n;
    g.box(x, y0, cz + d / 2 + out, t * 0.8, h, 0.03, c);
    g.box(x, y0, cz - d / 2 - out, t * 0.8, h, 0.03, c);
  }
  // braces on the gable ends
  if (o.braces !== false) {
    for (const s of [-1, 1]) {
      const x = cx + s * (w / 2 + out + 0.005);
      g.beam(x, y0 + 0.04, cz - d / 2 + 0.06, x, y0 + h * 0.5, cz - d * 0.1, t * 0.7, c);
      g.beam(x, y0 + 0.04, cz + d / 2 - 0.06, x, y0 + h * 0.5, cz + d * 0.1, t * 0.7, c);
    }
  }
}

function chimney(g, K, x, y0, z, h, o = {}) {
  const s = o.s ?? 0.15;
  g.box(x, y0, z, s, h, s, o.col ?? K.stone);
  g.box(x, y0 + h, z, s + 0.04, 0.04, s + 0.04, o.cap ?? shade(o.col ?? K.stone, 0.75));
  g.box(x, y0 + h + 0.04, z, s * 0.55, 0.02, s * 0.55, 0x1a1512);
  g.anchor('chimneys', x, y0 + h + 0.08, z, { rate: o.rate ?? 1 });
}

function bannerPole(g, K, x, y0, z, h, o = {}) {
  g.box(x, y0, z, 0.035, h, 0.035, o.col ?? K.timber);
  g.bead(x, y0 + h, z, 0.03, o.finial ?? K.trim);
  g.anchor('banners', x + 0.02, y0 + h - 0.02, z, { s: o.s ?? 1 });
}

function barrel(g, K, x, y0, z, r = 0.07) {
  g.cyl(x, y0, z, r * 0.88, r * 0.35, 7, K.timber2, { r2: r });
  g.cyl(x, y0 + r * 0.35, z, r, r * 0.6, 7, K.timber2, {});
  g.cyl(x, y0 + r * 0.95, z, r, r * 0.35, 7, K.timber2, { r2: r * 0.88 });
  g.cyl(x, y0 + r * 0.6, z, r * 1.03, 0.02, 7, K.metal, {});
}

function crate(g, K, x, y0, z, s = 0.13, ry = 0) {
  g.box(x, y0, z, s, s, s, K.plank, { ry });
  g.box(x, y0 + s * 0.45, z, s + 0.01, 0.02, s + 0.01, K.timber, { ry });
}

function logs(g, K, x, y0, z, n = 3, len = 0.4) {
  let k = 0;
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < n - row; i++) {
      const xx = x + (i - (n - row - 1) / 2) * 0.085;
      g.push();
      g.translate(xx, y0 + 0.04 + row * 0.07, z);
      g.rotateX(Math.PI / 2);
      g.cyl(0, -len / 2, 0, 0.04, len, 6, k++ % 2 ? K.timber2 : shade(K.timber2, 1.1), { capCol: 0xc9a06a });
      g.pop();
    }
}

function sacks(g, K, x, y0, z) {
  g.bead(x, y0, z, 0.06, 0xd8c79a);
  g.bead(x + 0.1, y0, z + 0.02, 0.055, 0xcbb98a);
  g.bead(x + 0.05, y0 + 0.08, z - 0.01, 0.05, 0xd8c79a);
}

function parapet(g, K, cx, y0, cz, w, d, h = 0.08, t = 0.06, col = K.wall2) {
  g.box(cx, y0, cz + d / 2 - t / 2, w, h, t, col);
  g.box(cx, y0, cz - d / 2 + t / 2, w, h, t, col);
  g.box(cx + w / 2 - t / 2, y0, cz, t, h, d - t * 2, col);
  g.box(cx - w / 2 + t / 2, y0, cz, t, h, d - t * 2, col);
}

function crenels(g, K, cx, y0, cz, w, d, col, step = 0.2, s = 0.09) {
  const nx = Math.max(2, Math.round(w / step)),
    nz = Math.max(2, Math.round(d / step));
  for (let i = 0; i <= nx; i += 2) {
    const x = cx - w / 2 + (w * i) / nx;
    g.box(x, y0, cz + d / 2 - s / 2, s, s, s, col);
    g.box(x, y0, cz - d / 2 + s / 2, s, s, s, col);
  }
  for (let i = 2; i < nz; i += 2) {
    const z = cz - d / 2 + (d * i) / nz;
    g.box(cx + w / 2 - s / 2, y0, z, s, s, s, col);
    g.box(cx - w / 2 + s / 2, y0, z, s, s, s, col);
  }
}

function vigas(g, K, cx, y, cz, w, d, f, n) {
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n - 0.5;
    const p = face(cx, cz, w, d, f, u * 0.9);
    g.box(p.x + p.nx * 0.05, y, p.z + p.nz * 0.05, 0.04, 0.04, 0.1, K.timber, { ry: p.ry });
  }
}

function snowCap(g, K, cx, y0, cz, w, d, h, o = {}) {
  // a white mantle on the upper part of a gable roof
  const k = o.k ?? 0.42;
  g.gable(cx, y0 + h * (1 - k) + 0.02, cz, w, d * k, h * k, K.snow, { over: (o.over ?? 0.14) * 0.9, th: 0.03, rows: 1, ridge: false, axis: o.axis, gable: null });
}

function stilts(g, K, cx, cz, w, d, top, n = 2) {
  for (let i = 0; i <= n; i++)
    for (const sz of [-1, 1]) {
      const x = cx - w / 2 + 0.06 + ((w - 0.12) * i) / n;
      g.box(x, -0.7, cz + sz * (d / 2 - 0.06), 0.07, top + 0.7, 0.07, K.timber);
    }
  // cross bracing
  g.beam(cx - w / 2 + 0.06, 0.05, cz + d / 2 - 0.06, cx + w / 2 - 0.06, top - 0.08, cz + d / 2 - 0.06, 0.03, K.timber2);
  g.beam(cx - w / 2 + 0.06, top - 0.08, cz - d / 2 + 0.06, cx + w / 2 - 0.06, 0.05, cz - d / 2 + 0.06, 0.03, K.timber2);
}

function ladder(g, K, x, z, top, dir = 1) {
  const len = top + 0.05;
  for (const s of [-0.07, 0.07]) g.beam(x + s, 0, z + 0.32 * dir, x + s, top, z + 0.04 * dir, 0.03, K.timber2);
  for (let i = 1; i < 5; i++) {
    const t = i / 5;
    g.box(x, top * t - 0.01, z + (0.32 - 0.28 * t) * dir, 0.15, 0.02, 0.025, K.timber2);
  }
  void len;
}

function railing(g, K, cx, y0, cz, w, d, sides = 'FLR', h = 0.16) {
  const c = K.timber2;
  if (sides.includes('F')) g.box(cx, y0 + h, cz + d / 2, w, 0.025, 0.025, c);
  if (sides.includes('B')) g.box(cx, y0 + h, cz - d / 2, w, 0.025, 0.025, c);
  if (sides.includes('L')) g.box(cx - w / 2, y0 + h, cz, 0.025, 0.025, d, c);
  if (sides.includes('R')) g.box(cx + w / 2, y0 + h, cz, 0.025, 0.025, d, c);
  const posts = (x0, z0, x1, z1, n) => {
    for (let i = 0; i <= n; i++) g.box(x0 + ((x1 - x0) * i) / n, y0, z0 + ((z1 - z0) * i) / n, 0.03, h, 0.03, c);
  };
  if (sides.includes('F')) posts(cx - w / 2, cz + d / 2, cx + w / 2, cz + d / 2, Math.round(w / 0.25));
  if (sides.includes('B')) posts(cx - w / 2, cz - d / 2, cx + w / 2, cz - d / 2, Math.round(w / 0.25));
  if (sides.includes('L')) posts(cx - w / 2, cz - d / 2, cx - w / 2, cz + d / 2, Math.round(d / 0.25));
  if (sides.includes('R')) posts(cx + w / 2, cz - d / 2, cx + w / 2, cz + d / 2, Math.round(d / 0.25));
}

// Saddle roof (Tikari): a gable whose ridge sweeps up into horns at both ends.
function saddleRoof(g, K, cx, y0, cz, w, d, h, o = {}) {
  g.gable(cx, y0, cz, w, d, h, o.col ?? K.thatch, { over: o.over ?? 0.2, th: 0.09, tint: o.tint ?? K.thatchTint, gable: o.gable ?? K.wall2, rows: 4, ridgeCol: K.thatch2 });
  const ex = w / 2 + (o.over ?? 0.2) + 0.02;
  for (const s of [-1, 1]) {
    g.beam(cx + s * (ex - 0.18), y0 + h + 0.03, cz, cx + s * (ex + 0.12), y0 + h + 0.32, cz, 0.06, K.timber, { tint: 0.5, thY: 0.05 });
    g.bead(cx + s * (ex + 0.13), y0 + h + 0.3, cz, 0.035, K.trim, { tint: 1 });
  }
}

function footing(g, K, w, d, h = 0.1) {
  g.box(0, -0.06, 0, w, h + 0.06, d, K.stone2);
}

// ---------------------------------------------------------------- houses
function valeHouse(g, K, lv) {
  if (lv === 1) {
    const w = 1.05,
      d = 0.86,
      h = 0.55,
      bz = -0.2;
    g.box(0, -0.06, bz, w + 0.08, 0.14, d + 0.08, K.stone);
    g.box(0, 0.08, bz, w, h - 0.08, d, K.wall);
    timberFrame(g, K, 0, 0.08, bz, w, d, h - 0.08, { mid: false, studs: 2, braces: false });
    g.gable(0, h, bz, w, d, 0.62, K.thatch, { over: 0.15, th: 0.1, tint: K.thatchTint, gable: K.wall2, rows: 4, ridgeCol: K.thatch2 });
    doorOn(g, K, 0, bz, w, d, 'F', 0.18, 0.08, { w: 0.2, h: 0.36 });
    windowOn(g, K, 0, bz, w, d, 'F', -0.22, 0.28, { shutters: true });
    windowOn(g, K, 0, bz, w, d, 'L', 0, 0.28, { shutters: true });
    windowOn(g, K, 0, bz, w, d, 'R', 0.1, 0.28, {});
    chimney(g, K, -w * 0.32, h + 0.05, bz - 0.05, 0.62);
    logs(g, K, 0.68, 0, -0.55, 3, 0.36);
    // vegetable patch
    g.box(-0.55, -0.02, 0.62, 0.6, 0.06, 0.32, 0x6e5034);
    for (let i = 0; i < 4; i++) g.bead(-0.78 + i * 0.15, 0.03, 0.62, 0.045, 0x5f9a3a);
    return { base: { x: 0, z: bz, w: w + 0.08, d: d + 0.08 } };
  }
  if (lv === 2) {
    const w = 1.45,
      d = 1.0,
      h = 0.78,
      bz = -0.12;
    g.box(0, -0.06, bz, w + 0.08, 0.16, d + 0.08, K.stone);
    g.box(0, 0.1, bz, w, h - 0.1, d, K.wall);
    timberFrame(g, K, 0, 0.1, bz, w, d, h - 0.1, { studs: 4 });
    g.gable(0, h, bz, w, d, 0.72, K.tile, { over: 0.14, th: 0.07, tint: K.roofTint, gable: K.wall2, rows: 5 });
    timberFrame(g, K, 0, h, bz, w, d, 0.001, { mid: false, studs: 1, braces: false });
    doorOn(g, K, 0, bz, w, d, 'F', 0, 0.1, { w: 0.22, h: 0.4 });
    for (const u of [-0.3, 0.3]) windowOn(g, K, 0, bz, w, d, 'F', u, 0.38, { shutters: true, flowers: true });
    for (const u of [-0.25, 0.25]) windowOn(g, K, 0, bz, w, d, 'B', u, 0.38, {});
    windowOn(g, K, 0, bz, w, d, 'L', 0, 0.38, { shutters: true });
    windowOn(g, K, 0, bz, w, d, 'R', 0, 0.38, { shutters: true });
    // gable window
    windowOn(g, K, 0, bz, w, d, 'L', 0, h + 0.18, { w: 0.1, h: 0.12, cross: false });
    chimney(g, K, -w * 0.3, h + 0.15, bz - 0.12, 0.78, { col: 0x9b5a45 });
    // lean-to shed
    g.box(w / 2 + 0.2, 0, bz + 0.05, 0.36, 0.4, 0.62, K.wall2);
    g.push();
    g.translate(w / 2 + 0.2, 0, bz + 0.05);
    g.rotateY(Math.PI / 2);
    g.slab(-0.36, 0.36, -0.25, 0.38, 0.22, 0.5, 0.04, K.timber2, { rows: 2 });
    g.pop();
    barrel(g, K, -0.82, 0, 0.62);
    return { base: { x: 0.05, z: bz, w: w + 0.5, d: d + 0.08 } };
  }
  // manor
  const w = 1.6,
    d = 1.2,
    h1 = 0.6,
    h2 = 0.56,
    bz = -0.15;
  g.box(0, -0.06, bz, w + 0.06, h1 + 0.06, d + 0.06, K.stone);
  for (let i = 0; i < 5; i++) g.box(-w / 2 + 0.2 + i * 0.3, 0.1 + (i % 2) * 0.22, bz + d / 2 + 0.03, 0.14, 0.07, 0.01, K.stone2);
  const uw = w + 0.1,
    ud = d + 0.1;
  g.box(0, h1, bz, uw, h2, ud, K.wall);
  g.box(0, h1 - 0.03, bz, uw + 0.02, 0.05, ud + 0.02, K.timber);
  timberFrame(g, K, 0, h1, bz, uw, ud, h2, { studs: 5, mid: false });
  g.gable(0, h1 + h2, bz, uw, ud, 0.82, K.tile, { over: 0.13, th: 0.07, tint: K.roofTint, gable: K.wall2, rows: 5 });
  // cross gable over the entrance
  g.box(0, h1, bz + ud / 2 - 0.15, 0.62, h2 + 0.08, 0.5, K.wall);
  timberFrame(g, K, 0, h1, bz + ud / 2 - 0.15, 0.62, 0.5, h2 + 0.08, { studs: 2, mid: false, braces: false });
  g.gable(0, h1 + h2 + 0.08, bz + ud / 2 - 0.15, 0.62, 0.5, 0.5, K.tile, { axis: 'z', over: 0.1, th: 0.06, tint: K.roofTint, gable: K.wall2, rows: 3 });
  doorOn(g, K, 0, bz, w, d, 'F', 0, 0.0, { w: 0.24, h: 0.44 });
  for (const u of [-0.32, 0.32]) windowOn(g, K, 0, bz, w, d, 'F', u, 0.26, { shutters: true, flowers: true });
  windowOn(g, K, 0, bz + ud / 2 - 0.15, 0.62, 0.5, 'F', 0, h1 + 0.2, {});
  for (const u of [-0.38, 0.38]) windowOn(g, K, 0, bz, uw, ud, 'F', u, h1 + 0.2, { shutters: true });
  for (const u of [-0.3, 0, 0.3]) windowOn(g, K, 0, bz, uw, ud, 'B', u, h1 + 0.2, {});
  for (const f of ['L', 'R']) {
    windowOn(g, K, 0, bz, w, d, f, 0, 0.26, {});
    windowOn(g, K, 0, bz, uw, ud, f, 0, h1 + 0.2, { shutters: true });
  }
  chimney(g, K, -w * 0.36, h1 + h2 + 0.2, bz - 0.15, 0.82, { col: 0x9b5a45 });
  chimney(g, K, w * 0.36, h1 + h2 + 0.2, bz - 0.15, 0.82, { col: 0x9b5a45, rate: 0.5 });
  barrel(g, K, 0.75, 0, 0.7);
  crate(g, K, -0.78, 0, 0.72);
  return { base: { x: 0, z: bz, w: w + 0.08, d: d + 0.08 } };
}

function duneHouse(g, K, lv) {
  if (lv === 1) {
    const w = 1.0,
      d = 0.9,
      h = 0.64,
      bz = -0.18;
    g.box(0, -0.06, bz, w, h + 0.06, d, K.wall, { top: shade(K.wall, 0.92) });
    parapet(g, K, 0, h, bz, w, d, 0.08, 0.06, K.wall2);
    vigas(g, K, 0, h - 0.08, bz, w, d, 'F', 4);
    vigas(g, K, 0, h - 0.08, bz, w, d, 'L', 3);
    doorOn(g, K, 0, bz, w, d, 'F', -0.15, 0.0, { w: 0.2, h: 0.36, arch: true });
    windowOn(g, K, 0, bz, w, d, 'F', 0.25, 0.36, { w: 0.12, h: 0.14, frame: K.accent, sill: K.wall2, cross: false });
    windowOn(g, K, 0, bz, w, d, 'R', 0, 0.38, { w: 0.1, h: 0.14, frame: K.trim, sill: K.wall2, cross: false });
    // awning on poles
    g.box(-0.36, 0, 0.42, 0.03, 0.5, 0.03, K.timber);
    g.box(0.06, 0, 0.42, 0.03, 0.5, 0.03, K.timber);
    g.slab(-0.42, 0.12, 0.46, 0.5, bz + d / 2, 0.58, 0.02, K.cloth, { tint: 0.85, rows: 2 });
    g.cyl(0.38, 0, 0.5, 0.07, 0.15, 7, 0xb5643a, { r2: 0.05 });
    g.cyl(0.5, 0, 0.4, 0.06, 0.12, 7, 0xa65a34, { r2: 0.04 });
    // roof clutter: water jar & mat
    g.box(0.15, h, bz - 0.1, 0.35, 0.02, 0.3, 0xb89a6a);
    g.cyl(-0.25, h, bz - 0.15, 0.06, 0.12, 7, 0xb5643a, { r2: 0.04 });
    return { base: { x: 0, z: bz, w, d } };
  }
  if (lv === 2) {
    const w = 1.42,
      d = 1.1,
      h = 0.62,
      bz = -0.1;
    g.box(0, -0.06, bz, w, h + 0.06, d, K.wall, { top: shade(K.wall, 0.92) });
    parapet(g, K, 0, h, bz, w, d, 0.08, 0.06, K.wall2);
    const ux = -0.25,
      uz = bz - 0.15,
      uw = 0.8,
      ud = 0.7,
      uh = 0.48;
    g.box(ux, h, uz, uw, uh, ud, K.wall2, { top: shade(K.wall2, 0.92) });
    parapet(g, K, ux, h + uh, uz, uw, ud, 0.07, 0.05, K.wall);
    g.cyl(ux, h + uh, uz, 0.26, 0.08, 10, K.wall, {});
    g.dome(ux, h + uh + 0.08, uz, 0.26, 10, 4, K.tile, { tint: K.roofTint, sy: 1.15, ribs: true });
    g.bead(ux, h + uh + 0.08 + 0.29, uz, 0.03, K.trim, { tint: 0.6 });
    vigas(g, K, 0, h - 0.08, bz, w, d, 'F', 5);
    doorOn(g, K, 0, bz, w, d, 'F', 0.12, 0.0, { w: 0.22, h: 0.4, arch: true });
    for (const u of [-0.3]) windowOn(g, K, 0, bz, w, d, 'F', u, 0.34, { w: 0.12, h: 0.15, frame: K.accent, sill: K.wall2, cross: false });
    windowOn(g, K, ux, uz, uw, ud, 'F', 0, h + 0.2, { w: 0.12, h: 0.15, frame: K.accent, sill: K.wall2, cross: false });
    windowOn(g, K, 0, bz, w, d, 'L', 0.2, 0.34, { w: 0.1, h: 0.14, frame: K.trim, sill: K.wall2, cross: false });
    windowOn(g, K, 0, bz, w, d, 'R', 0, 0.34, { w: 0.1, h: 0.14, frame: K.trim, sill: K.wall2, cross: false });
    // roof terrace canopy
    for (const [x, z] of [
      [0.3, bz + 0.05],
      [0.62, bz + 0.05],
      [0.3, bz + 0.45],
      [0.62, bz + 0.45],
    ])
      g.box(x, h, z, 0.03, 0.34, 0.03, K.timber);
    g.box(0.46, h + 0.34, bz + 0.25, 0.4, 0.02, 0.46, K.cloth, { tint: 0.9 });
    g.cyl(-0.62, 0, 0.62, 0.07, 0.16, 7, 0xb5643a, { r2: 0.05 });
    g.cyl(-0.5, 0, 0.7, 0.06, 0.12, 7, 0xa65a34, { r2: 0.04 });
    return { base: { x: 0, z: bz, w, d } };
  }
  // courtyard villa with wind-catcher
  const bz = -0.55;
  g.box(0, -0.06, bz, 1.7, 0.82, 0.62, K.wall, { top: shade(K.wall, 0.92) });
  parapet(g, K, 0, 0.76, bz, 1.7, 0.62, 0.08, 0.06, K.wall2);
  for (const s of [-1, 1]) {
    g.box(s * 0.6, -0.06, 0.2, 0.5, 0.66, 0.9, K.wall2, { top: shade(K.wall2, 0.92) });
    parapet(g, K, s * 0.6, 0.6, 0.2, 0.5, 0.9, 0.07, 0.05, K.wall);
    windowOn(g, K, s * 0.6, 0.2, 0.5, 0.9, s > 0 ? 'R' : 'L', 0, 0.32, { w: 0.1, h: 0.15, frame: K.accent, sill: K.wall2, cross: false });
    windowOn(g, K, s * 0.6, 0.2, 0.5, 0.9, 'F', 0, 0.32, { w: 0.1, h: 0.15, frame: K.accent, sill: K.wall2, cross: false });
  }
  // front garden wall with gate
  g.box(0, -0.04, 0.78, 0.7, 0.32, 0.08, K.wall2);
  g.box(0, 0.28, 0.78, 0.74, 0.05, 0.1, K.wall);
  doorOn(g, K, 0, 0.78, 0.7, 0.08, 'F', 0, -0.02, { w: 0.24, h: 0.26, arch: true, step: false });
  // courtyard pool
  g.box(0, -0.03, 0.15, 0.5, 0.06, 0.4, K.stone);
  g.box(0, 0.0, 0.15, 0.42, 0.04, 0.32, 0x3aa0a8, { jit: 0.02 });
  // great dome on a drum
  g.cyl(-0.2, 0.76, bz, 0.34, 0.14, 12, K.wall2, {});
  g.dome(-0.2, 0.9, bz, 0.34, 12, 5, K.tile, { tint: K.roofTint, sy: 1.15, ribs: true });
  g.bead(-0.2, 0.9 + 0.4, bz, 0.035, K.trim, { tint: 0.6 });
  // wind-catcher tower
  g.box(0.6, 0.76, bz - 0.05, 0.3, 0.85, 0.3, K.wall2);
  for (const f of ['F', 'B', 'L', 'R']) {
    const p = face(0.6, bz - 0.05, 0.3, 0.3, f, 0);
    g.box(p.x + p.nx * 0.01, 1.32, p.z + p.nz * 0.01, 0.16, 0.2, 0.02, 0x2a2420, { ry: p.ry });
  }
  parapet(g, K, 0.6, 1.61, bz - 0.05, 0.3, 0.3, 0.06, 0.05, K.wall);
  doorOn(g, K, 0, bz, 1.7, 0.62, 'F', 0.0, 0.0, { w: 0.22, h: 0.4, arch: true, lamp: false });
  windowOn(g, K, 0, bz, 1.7, 0.62, 'F', -0.3, 0.42, { w: 0.12, h: 0.16, frame: K.accent, sill: K.wall2, cross: false });
  windowOn(g, K, 0, bz, 1.7, 0.62, 'F', 0.3, 0.42, { w: 0.12, h: 0.16, frame: K.accent, sill: K.wall2, cross: false });
  return { base: { x: 0, z: 0, w: 1.75, d: 1.8 } };
}

function frostHouse(g, K, lv) {
  if (lv === 1) {
    const w = 1.12,
      d = 0.86,
      h = 0.42,
      bz = -0.18;
    g.box(0, -0.06, bz, w, h + 0.06, d, K.stone, { jit: 0.14 });
    for (let i = 0; i < 6; i++) g.box(-w / 2 + 0.12 + i * 0.18, 0.05 + (i % 3) * 0.1, bz + d / 2 + 0.005, 0.12, 0.07, 0.012, i % 2 ? K.stone2 : shade(K.stone, 1.08));
    g.gable(0, h, bz, w, d, 0.74, K.thatch, { over: 0.16, th: 0.11, tint: K.thatchTint, gable: K.timber2, rows: 3, ridgeCol: K.thatch2 });
    snowCap(g, K, 0, h, bz, w, d, 0.74, { k: 0.45, over: 0.16 });
    doorOn(g, K, 0, bz, w, d, 'F', 0.15, 0.0, { w: 0.2, h: 0.34 });
    windowOn(g, K, 0, bz, w, d, 'F', -0.25, 0.22, { w: 0.12, h: 0.12, shutters: true, shutterTint: 0.7 });
    windowOn(g, K, 0, bz, w, d, 'L', 0, 0.22, { w: 0.12, h: 0.12 });
    g.anchor('chimneys', 0.0, h + 0.78, bz, { rate: 0.8 });
    logs(g, K, 0.7, 0, -0.5, 3, 0.36);
    return { base: { x: 0, z: bz, w, d } };
  }
  if (lv === 2) {
    const w = 1.32,
      d = 0.96,
      h = 0.66,
      bz = -0.12;
    g.box(0, -0.06, bz, w + 0.06, 0.24, d + 0.06, K.stone, { jit: 0.12 });
    g.box(0, 0.18, bz, w, h - 0.18, d, K.wall);
    for (let i = 0; i < 9; i++) g.box(-w / 2 + 0.07 + i * ((w - 0.14) / 8), 0.18, bz + d / 2 + 0.008, 0.018, h - 0.18, 0.012, K.timber);
    for (let i = 0; i < 6; i++) g.box(-w / 2 - 0.008, 0.18, bz - d / 2 + 0.08 + i * ((d - 0.16) / 5), 0.012, h - 0.18, 0.018, K.timber);
    g.gable(0, h, bz, w, d, 0.95, K.tile, { over: 0.15, th: 0.07, tint: K.roofTint, gable: K.wall2, rows: 5 });
    snowCap(g, K, 0, h, bz, w, d, 0.95, { k: 0.38, over: 0.15 });
    // crossed gable boards
    for (const s of [-1, 1]) {
      const x = s * (w / 2 + 0.16);
      g.beam(x, h + 0.82, bz - 0.12, x, h + 1.12, bz + 0.12, 0.04, K.timber, { tint: 0.4 });
      g.beam(x, h + 0.82, bz + 0.12, x, h + 1.12, bz - 0.12, 0.04, K.timber, { tint: 0.4 });
    }
    doorOn(g, K, 0, bz, w, d, 'F', 0, 0.12, { w: 0.22, h: 0.4 });
    for (const u of [-0.3, 0.3]) windowOn(g, K, 0, bz, w, d, 'F', u, 0.4, { w: 0.13, h: 0.14, shutters: true, shutterTint: 0.75 });
    windowOn(g, K, 0, bz, w, d, 'R', 0, 0.4, { w: 0.13, h: 0.14 });
    windowOn(g, K, 0, bz, w, d, 'B', 0, 0.4, { w: 0.13, h: 0.14 });
    chimney(g, K, w * 0.28, h + 0.4, bz - 0.1, 0.72);
    logs(g, K, -0.78, 0, 0.55, 3, 0.34);
    return { base: { x: 0, z: bz, w: w + 0.06, d: d + 0.06 } };
  }
  const w = 1.72,
    d = 1.08,
    h1 = 0.4,
    h2 = 0.44,
    bz = -0.12;
  g.box(0, -0.06, bz, w, h1 + 0.06, d, K.stone, { jit: 0.12 });
  g.box(0, h1, bz, w, h2, d, K.wall);
  for (let i = 0; i < 12; i++) g.box(-w / 2 + 0.07 + i * ((w - 0.14) / 11), h1, bz + d / 2 + 0.008, 0.018, h2, 0.012, K.timber);
  g.box(0, h1 - 0.03, bz, w + 0.03, 0.05, d + 0.03, K.timber);
  g.gable(0, h1 + h2, bz, w, d, 1.05, K.tile, { over: 0.16, th: 0.08, tint: K.roofTint, gable: K.wall2, rows: 6 });
  snowCap(g, K, 0, h1 + h2, bz, w, d, 1.05, { k: 0.36, over: 0.16 });
  // dormer
  g.box(0.35, h1 + h2 - 0.05, bz + d / 2 - 0.1, 0.34, 0.32, 0.3, K.wall);
  g.gable(0.35, h1 + h2 + 0.27, bz + d / 2 - 0.1, 0.34, 0.3, 0.28, K.tile, { axis: 'z', over: 0.06, th: 0.05, tint: K.roofTint, gable: K.wall2, rows: 2 });
  windowOn(g, K, 0.35, bz + d / 2 - 0.1, 0.34, 0.3, 'F', 0, h1 + h2 + 0.06, { w: 0.12, h: 0.13 });
  for (const s of [-1, 1]) {
    const x = s * (w / 2 + 0.17);
    g.beam(x, h1 + h2 + 0.92, bz - 0.13, x, h1 + h2 + 1.24, bz + 0.13, 0.045, K.timber, { tint: 0.4 });
    g.beam(x, h1 + h2 + 0.92, bz + 0.13, x, h1 + h2 + 1.24, bz - 0.13, 0.045, K.timber, { tint: 0.4 });
  }
  // porch
  g.box(-0.4, 0, bz + d / 2 + 0.22, 0.04, 0.5, 0.04, K.timber);
  g.box(0.0, 0, bz + d / 2 + 0.22, 0.04, 0.5, 0.04, K.timber);
  g.slab(-0.5, 0.1, bz + d / 2 + 0.3, 0.5, bz + d / 2, 0.62, 0.04, K.tile, { tint: K.roofTint, rows: 2 });
  doorOn(g, K, 0, bz, w, d, 'F', -0.12, 0.0, { w: 0.24, h: 0.4 });
  for (const u of [0.15, 0.38]) windowOn(g, K, 0, bz, w, d, 'F', u, h1 + 0.18, { w: 0.13, h: 0.14, shutters: true, shutterTint: 0.75 });
  windowOn(g, K, 0, bz, w, d, 'F', -0.38, h1 + 0.18, { w: 0.13, h: 0.14, shutters: true, shutterTint: 0.75 });
  for (const u of [-0.3, 0, 0.3]) windowOn(g, K, 0, bz, w, d, 'B', u, h1 + 0.18, { w: 0.13, h: 0.14 });
  chimney(g, K, -w * 0.3, h1 + h2 + 0.45, bz - 0.12, 0.8);
  chimney(g, K, w * 0.3, h1 + h2 + 0.45, bz - 0.12, 0.8, { rate: 0.5 });
  return { base: { x: 0, z: bz, w, d } };
}

function mireHouse(g, K, lv) {
  if (lv === 1) {
    const top = 0.46,
      bz = -0.12;
    stilts(g, K, 0, bz, 1.12, 1.12, top, 2);
    g.box(0, top - 0.06, bz, 1.2, 0.07, 1.2, K.plank);
    g.cyl(0, top, bz, 0.42, 0.44, 9, K.wall, { cap: false });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      g.box(Math.cos(a) * 0.43, top, bz + Math.sin(a) * 0.43, 0.035, 0.44, 0.035, K.timber2);
    }
    g.cone(0, top + 0.4, bz, 0.66, 0.78, 9, K.thatch, { tint: K.thatchTint, stripes: K.thatch2 });
    g.cone(0, top + 1.1, bz, 0.08, 0.2, 6, K.trim, { tint: 0.8 });
    g.box(0, top, bz + 0.42, 0.2, 0.32, 0.04, K.door);
    g.box(0.24, top + 0.36, bz + 0.37, 0.05, 0.06, 0.05, 0xffd48a, { glow: 1 });
    for (const a of [Math.PI * 0.22, -Math.PI * 0.3, Math.PI * 0.75]) {
      const wx = Math.sin(a) * 0.425,
        wz = bz + Math.cos(a) * 0.425;
      g.box(wx, top + 0.18, wz, 0.13, 0.12, 0.03, K.glass, { ry: a, glow: 1 });
      g.box(wx, top + 0.165, wz, 0.17, 0.02, 0.05, K.timber2, { ry: a });
    }
    g.anchor('lamps', 0, 0, 0.75, { r: 1 });
    railing(g, K, 0, top, bz, 1.2, 1.2, 'LR', 0.14);
    ladder(g, K, 0, bz + 0.6, top, 1);
    g.anchor('chimneys', 0, top + 1.2, bz, { rate: 0.6 });
    g.cyl(0.6, 0, 0.7, 0.07, 0.16, 7, 0x9a5a34, { r2: 0.05 });
    return { base: null, stilts: true };
  }
  if (lv === 2) {
    const top = 0.52,
      bz = -0.1;
    stilts(g, K, 0, bz, 1.5, 1.35, top, 3);
    g.box(0, top - 0.06, bz, 1.6, 0.07, 1.45, K.plank);
    const w = 1.12,
      d = 0.82;
    g.box(0, top, bz - 0.12, w, 0.48, d, K.wall);
    for (let i = 0; i < 7; i++) g.box(-w / 2 + 0.05 + i * ((w - 0.1) / 6), top, bz - 0.12 + d / 2 + 0.01, 0.03, 0.48, 0.02, K.timber2);
    saddleRoof(g, K, 0, top + 0.48, bz - 0.12, w, d, 0.6, { over: 0.22 });
    g.box(0, top, bz - 0.12 + d / 2 + 0.01, 0.2, 0.34, 0.03, K.door);
    g.box(0.18, top + 0.36, bz - 0.12 + d / 2 + 0.04, 0.05, 0.06, 0.05, 0xffd48a, { glow: 1 });
    windowOn(g, K, 0, bz - 0.12, w, d, 'F', -0.32, top + 0.25, { w: 0.12, h: 0.12, frame: K.timber, sill: K.timber2, cross: false });
    windowOn(g, K, 0, bz - 0.12, w, d, 'R', 0, top + 0.25, { w: 0.12, h: 0.12, frame: K.timber, sill: K.timber2, cross: false });
    railing(g, K, 0, top, bz, 1.6, 1.45, 'FLR', 0.15);
    ladder(g, K, 0.55, bz + 0.72, top, 1);
    g.anchor('lamps', 0, 0, 0.8, { r: 1 });
    g.anchor('chimneys', -0.3, top + 1.1, bz - 0.12, { rate: 0.6 });
    // hanging cloth
    g.box(-0.45, top + 0.12, bz - 0.12 + d / 2 + 0.02, 0.16, 0.3, 0.01, K.cloth, { tint: 1 });
    return { base: null, stilts: true };
  }
  const top = 0.56,
    bz = -0.08;
  stilts(g, K, 0, bz, 1.78, 1.6, top, 4);
  g.box(0, top - 0.06, bz, 1.86, 0.07, 1.7, K.plank);
  const w = 1.46,
    d = 0.96;
  g.box(0, top, bz - 0.2, w, 0.54, d, K.wall);
  for (let i = 0; i < 9; i++) g.box(-w / 2 + 0.05 + i * ((w - 0.1) / 8), top, bz - 0.2 + d / 2 + 0.01, 0.03, 0.54, 0.02, K.timber2);
  saddleRoof(g, K, 0, top + 0.54, bz - 0.2, w, d, 0.72, { over: 0.26 });
  // carved posts & veranda roof
  for (const x of [-0.7, -0.25, 0.25, 0.7]) g.box(x, top, bz + 0.68, 0.05, 0.5, 0.05, K.timber, { tint: 0.3 });
  g.slab(-0.82, 0.82, bz + 0.78, top + 0.5, bz + 0.2, top + 0.62, 0.05, K.thatch, { tint: K.thatchTint, rows: 2 });
  g.box(0, top, bz - 0.2 + d / 2 + 0.01, 0.24, 0.38, 0.03, K.door);
  for (const u of [-0.32, 0.32]) windowOn(g, K, 0, bz - 0.2, w, d, 'F', u, top + 0.28, { w: 0.12, h: 0.12, frame: K.timber, sill: K.timber2, cross: false });
  g.box(0.2, top + 0.38, bz - 0.2 + d / 2 + 0.04, 0.05, 0.06, 0.05, 0xffd48a, { glow: 1 });
  railing(g, K, 0, top, bz, 1.86, 1.7, 'FLR', 0.15);
  ladder(g, K, -0.5, bz + 0.85, top, 1);
  g.anchor('lamps', 0, 0, 0.9, { r: 1.2 });
  g.anchor('chimneys', 0.4, top + 1.3, bz - 0.2, { rate: 0.6 });
  bannerPole(g, K, 0.86, top, bz + 0.78, 0.9, { s: 0.8 });
  return { base: null, stilts: true };
}

// ---------------------------------------------------------------- halls
function hall(g, K, style, lv) {
  if (style === 'vale') {
    if (lv === 1) {
      const w = 2.5,
        d = 1.5,
        h = 0.9,
        bz = -0.25;
      g.box(0, -0.06, bz, w + 0.1, 0.2, d + 0.1, K.stone);
      g.box(0, 0.14, bz, w, h - 0.14, d, K.timber2);
      for (let i = 0; i < 14; i++) g.box(-w / 2 + 0.08 + i * ((w - 0.16) / 13), 0.14, bz + d / 2 + 0.01, 0.03, h - 0.14, 0.012, K.timber);
      g.gable(0, h, bz, w, d, 1.05, K.tile, { over: 0.18, th: 0.1, tint: K.roofTint, gable: K.timber2, rows: 6 });
      for (const s of [-1, 1]) {
        const x = s * (w / 2 + 0.2);
        g.beam(x, h + 0.9, bz - 0.15, x, h + 1.3, bz + 0.15, 0.05, K.timber, { tint: 0.5 });
        g.beam(x, h + 0.9, bz + 0.15, x, h + 1.3, bz - 0.15, 0.05, K.timber, { tint: 0.5 });
      }
      doorOn(g, K, 0, bz, w, d, 'F', 0, 0.14, { w: 0.38, h: 0.52, tint: 0.3, lampR: 1.6 });
      for (const u of [-0.32, -0.18, 0.18, 0.32]) windowOn(g, K, 0, bz, w, d, 'F', u, 0.52, { w: 0.13, h: 0.16, shutters: true });
      for (const u of [-0.3, -0.1, 0.1, 0.3]) windowOn(g, K, 0, bz, w, d, 'B', u, 0.52, { w: 0.13, h: 0.16 });
      chimney(g, K, 0.55, h + 0.5, bz - 0.25, 0.9);
      bannerPole(g, K, -0.6, 0, 0.75, 1.8, { s: 1.4 });
      bannerPole(g, K, 0.6, 0, 0.75, 1.8, { s: 1.4 });
      barrel(g, K, 1.15, 0, 0.75);
      barrel(g, K, 1.0, 0, 0.88);
      crate(g, K, -1.15, 0, 0.8);
      return { base: { x: 0, z: bz, w: w + 0.1, d: d + 0.1 } };
    }
    if (lv === 2) {
      const w = 2.3,
        d = 1.55,
        h1 = 0.72,
        h2 = 0.6,
        bz = -0.2;
      g.box(0, -0.06, bz, w, h1 + 0.06, d, K.stone);
      g.box(0, h1, bz, w + 0.08, h2, d + 0.08, K.wall);
      timberFrame(g, K, 0, h1, bz, w + 0.08, d + 0.08, h2, { studs: 7, mid: false });
      g.gable(0, h1 + h2, bz, w + 0.08, d + 0.08, 0.95, K.tile, { over: 0.14, th: 0.08, tint: K.roofTint, gable: K.wall2, rows: 6 });
      // bell tower at the left end
      const tx = -0.95,
        tz = bz + 0.25;
      g.box(tx, 0, tz, 0.62, 2.3, 0.62, K.stone);
      g.box(tx, 1.95, tz, 0.66, 0.06, 0.66, K.stone2);
      for (const f of ['F', 'B', 'L', 'R']) {
        const p = face(tx, tz, 0.62, 0.62, f, 0);
        g.box(p.x + p.nx * 0.01, 2.0, p.z + p.nz * 0.01, 0.22, 0.26, 0.02, 0x2a2420, { ry: p.ry });
      }
      g.hip(tx, 2.3, tz, 0.62, 0.62, 0.85, K.tile, { over: 0.08, tint: K.roofTint, rows: 4 });
      bannerPole(g, K, tx, 3.12, tz, 0.55, { s: 1.2 });
      // clock face
      g.cyl(tx, 1.55, tz + 0.315, 0.14, 0.02, 12, 0xf4ecd8, {});
      g.push();
      g.translate(tx, 1.62, tz + 0.33);
      g.rotateX(Math.PI / 2);
      g.cyl(0, -0.01, 0, 0.14, 0.02, 12, 0xf4ecd8, {});
      g.pop();
      doorOn(g, K, 0.2, bz, w, d, 'F', 0, 0.0, { w: 0.36, h: 0.5, tint: 0.3, lampR: 1.6 });
      for (const u of [-0.12, 0.38]) windowOn(g, K, 0, bz, w, d, 'F', u, 0.32, { w: 0.14, h: 0.18 });
      for (const u of [-0.1, 0.12, 0.34]) windowOn(g, K, 0, bz, w + 0.08, d + 0.08, 'F', u, h1 + 0.2, { w: 0.14, h: 0.17, shutters: true, flowers: true });
      for (const u of [-0.3, 0, 0.3]) windowOn(g, K, 0, bz, w + 0.08, d + 0.08, 'B', u, h1 + 0.2, { w: 0.14, h: 0.17 });
      chimney(g, K, 0.75, h1 + h2 + 0.3, bz - 0.25, 0.9, { col: 0x9b5a45 });
      bannerPole(g, K, 1.15, 0, 0.85, 1.6, { s: 1.2 });
      return { base: { x: 0, z: bz, w: w + 0.1, d: d + 0.1 } };
    }
    // castle keep
    const kw = 1.5;
    g.box(0, -0.06, 0, 2.8, 0.5, 2.8, K.stone2);
    crenels(g, K, 0, 0.44, 0, 2.8, 2.8, K.stone2, 0.22, 0.1);
    g.box(0, 0.44, 0, 2.6, 0.02, 2.6, 0x7a6c58);
    g.box(0, 0, 0, kw, 2.05, kw, K.stone);
    for (let i = 0; i < 4; i++) g.box(0, 0.45 + i * 0.4, 0, kw + 0.02, 0.05, kw + 0.02, K.stone2);
    crenels(g, K, 0, 2.05, 0, kw, kw, K.stone, 0.2, 0.11);
    g.hip(0, 2.1, 0, kw * 0.7, kw * 0.7, 0.7, K.tile, { over: 0.02, tint: K.roofTint, rows: 3 });
    bannerPole(g, K, 0, 2.78, 0, 0.6, { s: 1.4 });
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = sx * 1.2,
          z = sz * 1.2;
        g.cyl(x, -0.06, z, 0.26, 1.2, 10, K.stone, {});
        g.cyl(x, 1.14, z, 0.3, 0.08, 10, K.stone2, {});
        g.cone(x, 1.22, z, 0.32, 0.6, 10, K.tile, { tint: K.roofTint });
        bannerPole(g, K, x, 1.8, z, 0.3, { s: 0.8 });
        windowOn(g, K, x, z, 0.52, 0.52, sz > 0 ? 'F' : 'B', 0, 0.7, { w: 0.07, h: 0.13, cross: false });
      }
    // gatehouse
    g.box(0, 0, 1.32, 0.7, 0.75, 0.3, K.stone);
    crenels(g, K, 0, 0.75, 1.32, 0.7, 0.3, K.stone, 0.18, 0.08);
    doorOn(g, K, 0, 1.32, 0.7, 0.3, 'F', 0, 0.0, { w: 0.34, h: 0.46, arch: true, col: 0x3a2a1c, lampR: 1.8 });
    doorOn(g, K, 0, 0, kw, kw, 'F', 0, 0.0, { w: 0.28, h: 0.42, arch: true, lamp: false });
    for (const f of ['F', 'B', 'L', 'R'])
      for (const u of [-0.25, 0.25]) windowOn(g, K, 0, 0, kw, kw, f, u, 1.4, { w: 0.09, h: 0.16, cross: false });
    for (const u of [-0.25, 0.25]) windowOn(g, K, 0, 0, kw, kw, 'F', u, 0.9, { w: 0.09, h: 0.16, cross: false });
    chimney(g, K, 0.45, 2.1, -0.45, 0.4);
    return { base: { x: 0, z: 0, w: 2.8, d: 2.8 } };
  }
  if (style === 'dune') {
    if (lv === 1) {
      const w = 2.3,
        d = 1.6,
        h = 0.86,
        bz = -0.25;
      g.box(0, -0.06, bz, w, h + 0.06, d, K.wall, { top: shade(K.wall, 0.92) });
      parapet(g, K, 0, h, bz, w, d, 0.1, 0.07, K.wall2);
      crenels(g, K, 0, h + 0.1, bz, w, d, K.wall2, 0.24, 0.07);
      vigas(g, K, 0, h - 0.1, bz, w, d, 'F', 8);
      g.cyl(0.3, h, bz - 0.1, 0.42, 0.14, 12, K.wall2, {});
      g.dome(0.3, h + 0.14, bz - 0.1, 0.42, 12, 5, K.tile, { tint: K.roofTint, sy: 1.1, ribs: true });
      g.bead(0.3, h + 0.14 + 0.47, bz - 0.1, 0.04, K.trim, { tint: 0.6 });
      doorOn(g, K, 0, bz, w, d, 'F', -0.05, 0.0, { w: 0.36, h: 0.52, arch: true, tint: 0.3, lampR: 1.6 });
      for (const u of [-0.32, 0.2, 0.36]) windowOn(g, K, 0, bz, w, d, 'F', u, 0.46, { w: 0.13, h: 0.18, frame: K.accent, sill: K.wall2, cross: false });
      g.box(-0.85, 0, 0.62, 0.03, 0.55, 0.03, K.timber);
      g.box(-0.35, 0, 0.62, 0.03, 0.55, 0.03, K.timber);
      g.slab(-0.92, -0.28, 0.66, 0.55, bz + d / 2, 0.66, 0.02, K.cloth, { tint: 0.9, rows: 2 });
      bannerPole(g, K, 0.9, h + 0.1, bz + 0.6, 0.9, { s: 1.3 });
      sacks(g, K, 0.75, 0, 0.75);
      g.cyl(1.0, 0, 0.7, 0.08, 0.18, 7, 0xb5643a, { r2: 0.05 });
      return { base: { x: 0, z: bz, w, d } };
    }
    if (lv === 2) {
      const w = 2.4,
        d = 1.9,
        h = 0.9,
        bz = -0.1;
      g.box(0, -0.06, bz, w, h + 0.06, d, K.wall, { top: shade(K.wall, 0.92) });
      parapet(g, K, 0, h, bz, w, d, 0.1, 0.07, K.wall2);
      crenels(g, K, 0, h + 0.1, bz, w, d, K.wall2, 0.24, 0.07);
      // octagonal drum and great dome
      g.cyl(0, h, bz - 0.1, 0.62, 0.32, 8, K.wall2, {});
      for (let i = 0; i < 8; i++) {
        const a = ((i + 0.5) / 8) * Math.PI * 2;
        g.box(Math.cos(a) * 0.6, h + 0.1, bz - 0.1 + Math.sin(a) * 0.6, 0.09, 0.14, 0.09, 0x2a2420, { ry: -a + Math.PI / 2 });
      }
      g.dome(0, h + 0.32, bz - 0.1, 0.6, 14, 6, K.tile, { tint: K.roofTint, sy: 1.2, ribs: true });
      g.cyl(0, h + 0.32 + 0.7, bz - 0.1, 0.03, 0.18, 6, K.trim, {});
      g.bead(0, h + 0.32 + 0.86, bz - 0.1, 0.05, K.trim, { tint: 0.6 });
      for (const s of [-1, 1]) {
        const x = s * 1.0,
          z = bz + 0.8;
        g.cyl(x, -0.06, z, 0.16, 1.7, 8, K.wall2, {});
        g.cyl(x, 1.45, z, 0.2, 0.06, 8, K.wall, {});
        g.dome(x, 1.64, z, 0.16, 8, 3, K.tile, { tint: K.roofTint, sy: 1.3 });
        g.box(x, 1.5, z + 0.15, 0.06, 0.1, 0.02, 0x2a2420);
        bannerPole(g, K, x, 1.84, z, 0.4, { s: 1 });
      }
      doorOn(g, K, 0, bz, w, d, 'F', 0, 0.0, { w: 0.4, h: 0.58, arch: true, tint: 0.3, lampR: 1.8 });
      for (const u of [-0.28, -0.15, 0.15, 0.28]) windowOn(g, K, 0, bz, w, d, 'F', u, 0.5, { w: 0.12, h: 0.2, frame: K.accent, sill: K.wall2, cross: false });
      for (const f of ['L', 'R']) for (const u of [-0.25, 0.25]) windowOn(g, K, 0, bz, w, d, f, u, 0.5, { w: 0.12, h: 0.2, frame: K.accent, sill: K.wall2, cross: false });
      return { base: { x: 0, z: bz, w, d } };
    }
    // sun citadel
    g.box(0, -0.06, 0, 2.8, 0.66, 2.8, K.stone);
    crenels(g, K, 0, 0.6, 0, 2.8, 2.8, K.stone, 0.25, 0.08);
    g.box(0, 0.6, 0, 1.9, 0.7, 1.9, K.wall);
    parapet(g, K, 0, 1.3, 0, 1.9, 1.9, 0.1, 0.07, K.wall2);
    g.cyl(0, 1.3, 0, 0.66, 0.3, 10, K.wall2, {});
    g.dome(0, 1.6, 0, 0.64, 14, 6, K.tile, { tint: K.roofTint, sy: 1.25, ribs: true });
    g.bead(0, 1.6 + 0.84, 0, 0.06, K.trim, { tint: 0.6 });
    bannerPole(g, K, 0, 2.48, 0, 0.5, { s: 1.4 });
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = sx * 1.22,
          z = sz * 1.22;
        g.cyl(x, -0.06, z, 0.2, 1.4, 8, K.wall2, {});
        g.cyl(x, 1.3, z, 0.25, 0.06, 8, K.wall, {});
        g.dome(x, 1.36, z, 0.2, 8, 3, K.tile, { tint: K.roofTint, sy: 1.3 });
      }
    doorOn(g, K, 0, 0, 2.8, 2.8, 'F', 0, 0.0, { w: 0.42, h: 0.5, arch: true, tint: 0.3, lampR: 1.8 });
    doorOn(g, K, 0, 0, 1.9, 1.9, 'F', 0, 0.6, { w: 0.3, h: 0.44, arch: true, lamp: false, step: false });
    for (const f of ['F', 'B', 'L', 'R']) for (const u of [-0.3, 0.3]) windowOn(g, K, 0, 0, 1.9, 1.9, f, u, 0.95, { w: 0.12, h: 0.2, frame: K.accent, sill: K.wall2, cross: false });
    return { base: { x: 0, z: 0, w: 2.8, d: 2.8 } };
  }
  if (style === 'frost') {
    if (lv <= 2) {
      const w = 2.6,
        d = 1.4,
        h = 0.72,
        bz = -0.25;
      g.box(0, -0.06, bz, w + 0.06, 0.28, d + 0.06, K.stone, { jit: 0.12 });
      g.box(0, 0.22, bz, w, h - 0.22, d, K.wall);
      for (let i = 0; i < 16; i++) g.box(-w / 2 + 0.07 + i * ((w - 0.14) / 15), 0.22, bz + d / 2 + 0.008, 0.02, h - 0.22, 0.012, K.timber);
      g.gable(0, h, bz, w, d, 1.25, K.tile, { over: 0.2, th: 0.09, tint: K.roofTint, gable: K.wall2, rows: 7 });
      snowCap(g, K, 0, h, bz, w, d, 1.25, { k: 0.34, over: 0.2 });
      for (const s of [-1, 1]) {
        const x = s * (w / 2 + 0.22);
        g.beam(x, h + 1.05, bz - 0.15, x, h + 1.5, bz + 0.18, 0.055, K.timber, { tint: 0.5 });
        g.beam(x, h + 1.05, bz + 0.15, x, h + 1.5, bz - 0.18, 0.055, K.timber, { tint: 0.5 });
        g.bead(x, h + 1.5, bz + 0.18, 0.04, K.trim, { tint: 0.8 });
      }
      doorOn(g, K, 0, bz, w, d, 'F', 0, 0.2, { w: 0.36, h: 0.46, tint: 0.35, lampR: 1.6 });
      for (const u of [-0.32, -0.16, 0.16, 0.32]) windowOn(g, K, 0, bz, w, d, 'F', u, 0.44, { w: 0.12, h: 0.13, shutters: true, shutterTint: 0.75 });
      // shields along the wall
      for (const u of [-0.42, 0.42]) {
        const p = face(0, bz, w, d, 'F', u);
        g.push();
        g.translate(p.x, 0.48, p.z + 0.03);
        g.rotateX(Math.PI / 2);
        g.cyl(0, 0, 0, 0.1, 0.02, 10, K.cloth, { tint: 1 });
        g.pop();
      }
      chimney(g, K, -0.5, h + 0.7, bz - 0.2, 0.75);
      chimney(g, K, 0.6, h + 0.7, bz - 0.2, 0.75, { rate: 0.6 });
      bannerPole(g, K, -0.75, 0, 0.75, 1.8, { s: 1.3 });
      if (lv === 2) {
        const tx = 1.05,
          tz = 0.55;
        g.box(tx, -0.06, tz, 0.55, 1.9, 0.55, K.stone, { jit: 0.12 });
        g.box(tx, 1.84, tz, 0.6, 0.35, 0.6, K.wall);
        for (const f of ['F', 'B', 'L', 'R']) {
          const p = face(tx, tz, 0.6, 0.6, f, 0);
          g.box(p.x + p.nx * 0.01, 1.92, p.z + p.nz * 0.01, 0.18, 0.18, 0.02, K.glass, { ry: p.ry, glow: 1 });
        }
        g.hip(tx, 2.19, tz, 0.6, 0.6, 1.1, K.tile, { over: 0.1, tint: K.roofTint, rows: 4 });
        g.hip(tx, 2.19 + 0.55, tz, 0.3, 0.3, 0.55, K.snow, { over: 0.0, rows: 1 });
        bannerPole(g, K, tx, 3.25, tz, 0.4, { s: 1 });
      } else {
        barrel(g, K, 1.1, 0, 0.75);
        logs(g, K, 0.9, 0, 0.95, 3, 0.36);
      }
      return { base: { x: 0, z: bz, w: w + 0.06, d: d + 0.06 } };
    }
    // stone hold
    const kw = 1.6;
    g.box(0, -0.06, 0, 2.8, 0.45, 2.8, K.stone2, { jit: 0.12 });
    crenels(g, K, 0, 0.39, 0, 2.8, 2.8, K.stone2, 0.22, 0.1);
    g.box(0, 0.39, 0, 2.6, 0.02, 2.6, K.snow);
    g.box(0, 0, -0.1, kw, 1.45, kw * 0.85, K.stone, { jit: 0.12 });
    g.gable(0, 1.45, -0.1, kw, kw * 0.85, 1.2, K.tile, { over: 0.12, th: 0.08, tint: K.roofTint, gable: K.stone2, rows: 6 });
    snowCap(g, K, 0, 1.45, -0.1, kw, kw * 0.85, 1.2, { k: 0.35, over: 0.12 });
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = sx * 1.18,
          z = sz * 1.18;
        g.box(x, -0.06, z, 0.5, 1.5, 0.5, K.stone, { jit: 0.12 });
        g.hip(x, 1.44, z, 0.5, 0.5, 0.95, K.tile, { over: 0.08, tint: K.roofTint, rows: 3 });
        g.hip(x, 1.44 + 0.5, z, 0.22, 0.22, 0.45, K.snow, { over: 0.0, rows: 1 });
        bannerPole(g, K, x, 2.38, z, 0.35, { s: 0.9 });
        windowOn(g, K, x, z, 0.5, 0.5, sz > 0 ? 'F' : 'B', 0, 0.9, { w: 0.08, h: 0.14, cross: false });
      }
    doorOn(g, K, 0, -0.1, kw, kw * 0.85, 'F', 0, 0, { w: 0.34, h: 0.46, tint: 0.35, lampR: 1.8 });
    for (const u of [-0.3, 0.3]) windowOn(g, K, 0, -0.1, kw, kw * 0.85, 'F', u, 0.8, { w: 0.12, h: 0.16, shutters: true, shutterTint: 0.75 });
    chimney(g, K, 0.45, 2.0, -0.5, 0.6);
    return { base: { x: 0, z: 0, w: 2.8, d: 2.8 } };
  }
  // mire
  if (lv <= 2) {
    const top = 0.6;
    stilts(g, K, 0, -0.05, 2.6, 2.1, top, 5);
    g.box(0, top - 0.07, -0.05, 2.7, 0.08, 2.2, K.plank);
    const w = 2.0,
      d = 1.2,
      bz = -0.35;
    g.box(0, top, bz, w, 0.62, d, K.wall);
    for (let i = 0; i < 12; i++) g.box(-w / 2 + 0.05 + i * ((w - 0.1) / 11), top, bz + d / 2 + 0.01, 0.03, 0.62, 0.02, K.timber2);
    saddleRoof(g, K, 0, top + 0.62, bz, w, d, 0.95, { over: 0.3 });
    g.box(0, top, bz + d / 2 + 0.01, 0.34, 0.46, 0.03, K.door, { tint: 0.3 });
    g.box(0.26, top + 0.46, bz + d / 2 + 0.04, 0.06, 0.07, 0.06, 0xffd48a, { glow: 1 });
    for (const u of [-0.32, 0.32]) windowOn(g, K, 0, bz, w, d, 'F', u, top + 0.32, { w: 0.14, h: 0.14, frame: K.timber, sill: K.timber2, cross: false });
    railing(g, K, 0, top, -0.05, 2.7, 2.2, 'LR', 0.16);
    ladder(g, K, -0.6, 1.05, top, 1);
    ladder(g, K, 0.6, 1.05, top, 1);
    g.anchor('lamps', 0, 0, 1.2, { r: 1.6 });
    // totems
    for (const s of [-1, 1]) {
      const x = s * 1.15,
        z = 1.25;
      g.cyl(x, -0.05, z, 0.08, 1.1, 7, K.timber, {});
      for (let k = 0; k < 3; k++) g.cyl(x, 0.2 + k * 0.3, z, 0.1, 0.12, 7, k % 2 ? K.trim : K.cloth, { tint: k === 1 ? 1 : 0.2 });
      g.cone(x, 1.05, z, 0.12, 0.18, 7, K.trim, { tint: 0.6 });
    }
    bannerPole(g, K, 1.25, top, -0.9, 1.3, { s: 1.3 });
    if (lv === 2) {
      // side lodges linked by the deck
      for (const s of [-1, 1]) {
        g.cyl(s * 1.0, top, 0.55, 0.3, 0.42, 8, K.wall2, { cap: false });
        g.cone(s * 1.0, top + 0.38, 0.55, 0.48, 0.62, 8, K.thatch, { tint: K.thatchTint, stripes: K.thatch2 });
      }
    } else {
      g.anchor('chimneys', -0.6, top + 1.6, bz, { rate: 0.8 });
    }
    return { base: null, stilts: true };
  }
  // canopy palace on a stepped stone platform
  g.box(0, -0.06, 0, 2.8, 0.36, 2.8, K.stone, { jit: 0.1 });
  g.box(0, 0.3, -0.1, 2.2, 0.34, 2.1, K.stone2, { jit: 0.1 });
  for (let i = 0; i < 4; i++) g.box(0, 0.3 - 0.08 * (i + 1) + 0.04, 1.0 + i * 0.1, 0.6, 0.08, 0.1, K.stone);
  const w = 1.9,
    d = 1.3,
    y0 = 0.64,
    bz = -0.3;
  g.box(0, y0, bz, w, 0.66, d, K.wall);
  for (let i = 0; i < 12; i++) g.box(-w / 2 + 0.05 + i * ((w - 0.1) / 11), y0, bz + d / 2 + 0.01, 0.03, 0.66, 0.02, K.timber2);
  saddleRoof(g, K, 0, y0 + 0.66, bz, w, d, 1.05, { over: 0.32 });
  g.box(0, y0, bz + d / 2 + 0.01, 0.36, 0.48, 0.03, K.door, { tint: 0.3 });
  for (const u of [-0.32, 0.32]) windowOn(g, K, 0, bz, w, d, 'F', u, y0 + 0.34, { w: 0.14, h: 0.14, frame: K.timber, sill: K.timber2, cross: false });
  g.anchor('lamps', 0, 0, 1.4, { r: 1.8 });
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * 1.25,
        z = sz * 1.25;
      g.cyl(x, 0.3, z, 0.08, 1.2, 7, K.timber, {});
      for (let k = 0; k < 3; k++) g.cyl(x, 0.5 + k * 0.3, z, 0.1, 0.12, 7, k % 2 ? K.trim : K.cloth, { tint: k === 1 ? 1 : 0.2 });
      bannerPole(g, K, x, 1.5, z, 0.4, { s: 1 });
    }
  return { base: { x: 0, z: 0, w: 2.8, d: 2.8 } };
}

// ---------------------------------------------------------------- civic buildings
function roofFor(g, K, style, cx, y0, cz, w, d, h, o = {}) {
  if (style === 'dune') {
    parapet(g, K, cx, y0, cz, w, d, 0.08, 0.06, K.wall2);
    return;
  }
  if (style === 'mire') return saddleRoof(g, K, cx, y0, cz, w, d, h, { over: 0.18 });
  const col = o.thatch ? K.thatch : K.tile;
  const tint = o.thatch ? K.thatchTint : K.roofTint;
  g.gable(cx, y0, cz, w, d, h * (style === 'frost' ? 1.25 : 1), col, { over: 0.13, th: 0.07, tint, gable: o.gable ?? K.wall2, rows: 4, axis: o.axis });
  if (style === 'frost') snowCap(g, K, cx, y0, cz, w, d, h * 1.25, { k: 0.4, axis: o.axis });
}

function wallsFor(g, K, style, cx, y0, cz, w, d, h) {
  if (style === 'vale') {
    g.box(cx, y0, cz, w, h, d, K.wall);
    timberFrame(g, K, cx, y0, cz, w, d, h, { studs: Math.round(w / 0.4), braces: false });
  } else if (style === 'frost') {
    g.box(cx, y0, cz, w, h, d, K.wall);
    for (let i = 0; i < Math.round(w / 0.12); i++) g.box(cx - w / 2 + 0.06 + i * 0.12, y0, cz + d / 2 + 0.008, 0.02, h, 0.012, K.timber);
  } else if (style === 'mire') {
    g.box(cx, y0, cz, w, h, d, K.wall);
    for (let i = 0; i < Math.round(w / 0.16); i++) g.box(cx - w / 2 + 0.05 + i * 0.16, y0, cz + d / 2 + 0.01, 0.03, h, 0.02, K.timber2);
  } else {
    g.box(cx, y0, cz, w, h, d, K.wall, { top: shade(K.wall, 0.92) });
  }
}

function granary(g, K, style) {
  if (style === 'dune') {
    for (const [x, z, r] of [
      [-0.45, -0.3, 0.38],
      [0.4, -0.35, 0.34],
      [0.0, 0.35, 0.32],
    ]) {
      g.cyl(x, -0.06, z, r, 0.35, 10, K.wall, {});
      g.dome(x, 0.29, z, r, 10, 4, K.wall2, { sy: 1.5 });
      g.box(x, 0.12, z + r - 0.02, 0.12, 0.16, 0.04, K.door);
      g.bead(x, 0.29 + r * 1.5 - 0.02, z, 0.04, K.trim, { tint: 0.7 });
    }
    sacks(g, K, 0.55, 0, 0.5);
    return { base: null };
  }
  const stiltH = style === 'mire' ? 0.6 : 0.24;
  const w = 1.3,
    d = 1.0,
    h = 0.62,
    bz = -0.1;
  // staddle stones / stilts
  for (const sx of [-1, 0, 1])
    for (const sz of [-1, 1]) {
      const x = sx * (w / 2 - 0.08),
        z = bz + sz * (d / 2 - 0.08);
      if (style === 'mire') g.box(x, -0.6, z, 0.07, stiltH + 0.6, 0.07, K.timber);
      else {
        g.cyl(x, -0.06, z, 0.05, stiltH + 0.02, 6, K.stone, {});
        g.cyl(x, stiltH - 0.04, z, 0.11, 0.05, 7, K.stone2, { r2: 0.06 });
      }
    }
  g.box(0, stiltH, bz, w + 0.04, 0.05, d + 0.04, K.timber);
  if (style === 'frost') g.box(0, stiltH + 0.05, bz, w, h, d, K.wall);
  else g.box(0, stiltH + 0.05, bz, w, h, d, style === 'mire' ? K.wall : K.timber2);
  for (let i = 0; i < 7; i++) g.box(-w / 2 + 0.06 + i * ((w - 0.12) / 6), stiltH + 0.05, bz + d / 2 + 0.01, 0.025, h, 0.012, K.timber);
  if (style === 'mire') saddleRoof(g, K, 0, stiltH + 0.05 + h, bz, w, d, 0.75, { over: 0.2 });
  else roofFor(g, K, style, 0, stiltH + 0.05 + h, bz, w, d, 0.7, { thatch: true });
  g.box(0, stiltH + 0.05, bz + d / 2 + 0.01, 0.26, 0.38, 0.03, K.door);
  if (style === 'mire') ladder(g, K, 0.3, bz + d / 2 + 0.05, stiltH, 1);
  else for (let i = 0; i < 2; i++) g.box(0, 0.0 + i * 0.1, bz + d / 2 + 0.13 - i * 0.06, 0.3, 0.1, 0.1, K.stone);
  sacks(g, K, -0.6, 0, 0.62);
  barrel(g, K, 0.62, 0, 0.62);
  return { base: null, stilts: style === 'mire' };
}

function workshop(g, K, style, lv) {
  if (lv === 1) {
    const w = 1.5,
      d = 1.1,
      bz = -0.15,
      h = 0.62;
    g.box(0, -0.06, bz, w + 0.06, 0.1, d + 0.06, K.stone);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.box(sx * (w / 2 - 0.04), 0.04, bz + sz * (d / 2 - 0.04), 0.07, h - 0.04, 0.07, K.timber);
    wallsFor(g, K, style, 0, 0.04, bz - d / 2 + 0.12, w, 0.22, h - 0.04);
    if (style === 'dune') {
      g.box(0, h, bz, w + 0.1, 0.05, d + 0.1, K.timber2);
      g.box(0, h + 0.05, bz, w + 0.1, 0.02, d + 0.1, K.cloth, { tint: 0.7 });
    } else roofFor(g, K, style, 0, h, bz, w, d, 0.48, { thatch: style !== 'frost' });
    // workbench, sawhorse, logs, barrels
    g.box(0.1, 0.04, bz + 0.05, 0.6, 0.28, 0.26, K.plank);
    g.box(0.1, 0.32, bz + 0.05, 0.64, 0.04, 0.3, K.timber2);
    g.box(-0.1, 0.36, bz + 0.05, 0.18, 0.04, 0.06, K.metal);
    logs(g, K, -0.55, 0, 0.62, 3, 0.4);
    barrel(g, K, 0.62, 0, 0.62);
    crate(g, K, 0.42, 0, 0.7);
    return { base: { x: 0, z: bz, w: w + 0.06, d: d + 0.06 } };
  }
  // forge
  const w = 1.45,
    d = 1.1,
    bz = -0.18,
    h = 0.68;
  g.box(0, -0.06, bz, w, h + 0.06, d, style === 'dune' ? K.wall : K.stone, { jit: 0.12 });
  if (style === 'dune') parapet(g, K, 0, h, bz, w, d, 0.08, 0.06, K.wall2);
  else roofFor(g, K, style, 0, h, bz, w, d, 0.55, { gable: K.stone });
  // big chimney and glowing hearth
  g.box(-0.45, 0, bz - 0.25, 0.34, h + 0.95, 0.34, K.stone2);
  g.box(-0.45, h + 0.95, bz - 0.25, 0.4, 0.06, 0.4, K.stone);
  g.anchor('chimneys', -0.45, h + 1.05, bz - 0.25, { rate: 2.5, forge: true });
  g.box(0.1, 0.05, bz + d / 2 + 0.005, 0.42, 0.34, 0.03, 0xff7a2a, { glow: 1 });
  g.box(0.1, 0.39, bz + d / 2 + 0.01, 0.5, 0.05, 0.04, K.stone2);
  g.anchor('hearths', 0.1, 0.2, bz + d / 2 + 0.1, {});
  // anvil & quench barrel
  g.box(0.25, 0, 0.62, 0.12, 0.12, 0.1, K.stone2);
  g.box(0.25, 0.12, 0.62, 0.2, 0.06, 0.09, K.metal);
  barrel(g, K, -0.3, 0, 0.66);
  g.box(-0.62, 0, 0.6, 0.3, 0.16, 0.2, K.metal);
  windowOn(g, K, 0, bz, w, d, 'R', 0, 0.36, { w: 0.14, h: 0.15 });
  return { base: { x: 0, z: bz, w, d } };
}

function well(g, K, style) {
  const stone = style === 'dune' ? K.wall : K.stone;
  g.cyl(0, -0.06, 0, 0.27, 0.3, 10, stone, { capCol: 0x2a3a48, jit: 0.1 });
  g.cyl(0, 0.24, 0, 0.29, 0.04, 10, K.stone2, { capCol: 0x24323e });
  g.box(0, 0.2, 0, 0.36, 0.01, 0.36, 0x27455a, { glow: 0.0 });
  if (style === 'dune') {
    g.box(-0.24, 0.24, 0, 0.07, 0.5, 0.07, K.wall2);
    g.box(0.24, 0.24, 0, 0.07, 0.5, 0.07, K.wall2);
    g.box(0, 0.7, 0, 0.56, 0.07, 0.08, K.wall2);
    g.dome(0, 0.77, 0, 0.12, 8, 2, K.tile, { tint: K.roofTint });
  } else {
    g.box(-0.24, 0.24, 0, 0.05, 0.56, 0.05, K.timber);
    g.box(0.24, 0.24, 0, 0.05, 0.56, 0.05, K.timber);
    g.box(0, 0.66, 0, 0.56, 0.04, 0.04, K.timber);
    if (style === 'mire') g.cone(0, 0.78, 0, 0.42, 0.34, 8, K.thatch, { tint: K.thatchTint });
    else g.gable(0, 0.76, 0, 0.54, 0.42, 0.24, style === 'frost' ? K.tile : K.thatch, { over: 0.06, th: 0.04, tint: style === 'frost' ? K.roofTint : K.thatchTint, rows: 2, gable: null });
  }
  g.cyl(0.05, 0.4, 0, 0.05, 0.08, 7, K.timber2, {});
  g.box(0.05, 0.48, 0, 0.005, 0.18, 0.005, 0x3a3028);
  g.anchor('lamps', 0, 0, 0, { r: 0.8 });
  return { base: null };
}

function windmill(g, K, style) {
  const tz = -0.1;
  if (style === 'dune') {
    g.cyl(0, -0.06, tz, 0.55, 1.6, 10, K.wall, { r2: 0.42 });
    g.cyl(0, 1.54, tz, 0.47, 0.06, 10, K.wall2, {});
    g.dome(0, 1.6, tz, 0.42, 10, 3, K.tile, { tint: K.roofTint, sy: 0.6 });
  } else if (style === 'mire') {
    for (const [x, z] of [
      [-0.4, -0.45],
      [0.4, -0.45],
      [-0.4, 0.25],
      [0.4, 0.25],
    ])
      g.beam(x, -0.3, z, x * 0.45, 1.6, tz + (z - tz) * 0.45, 0.07, K.timber);
    g.box(0, 0.6, tz, 0.7, 0.04, 0.7, K.plank);
    g.box(0, 1.1, tz, 0.52, 0.04, 0.52, K.plank);
    g.box(0, 1.35, tz, 0.48, 0.42, 0.48, K.wall);
    g.cone(0, 1.75, tz, 0.48, 0.55, 8, K.thatch, { tint: K.thatchTint, stripes: K.thatch2 });
  } else {
    const body = style === 'frost' ? K.stone : K.wall;
    g.cyl(0, -0.06, tz, 0.6, 1.62, 8, body, { r2: 0.42, rot: Math.PI / 8 });
    g.cyl(0, 0.42, tz, 0.55, 0.05, 8, K.timber, { r2: 0.54, rot: Math.PI / 8 });
    g.box(0, 0.42, tz + 0.5, 0.5, 0.04, 0.3, K.plank);
    g.cyl(0, 1.56, tz, 0.47, 0.06, 8, K.timber, { rot: Math.PI / 8 });
    g.cone(0, 1.62, tz, 0.5, 0.7, 8, style === 'frost' ? K.tile : K.thatch, { tint: style === 'frost' ? K.roofTint : K.thatchTint, rot: Math.PI / 8 });
    windowOn(g, K, 0, tz, 0.95, 0.95, 'L', 0, 1.0, { w: 0.1, h: 0.12 });
  }
  g.box(0, 0, tz + 0.5, 0.2, 0.32, 0.04, K.door);
  g.box(0, 1.3, tz + 0.42, 0.12, 0.12, 0.25, K.timber);
  g.anchor('blades', 0, 1.36, tz + 0.58, {});
  sacks(g, K, 0.55, 0, 0.6);
  return { base: null };
}

function docks(g, K, style) {
  // land shed + pier out over the water (+Z)
  const sw = 1.2,
    sd = 0.8,
    sz = -0.45;
  g.box(0, -0.06, sz, sw + 0.06, 0.1, sd + 0.06, K.stone);
  if (style === 'mire') {
    stilts(g, K, 0, sz, sw, sd, 0.3, 2);
    g.box(0, 0.3, sz, sw, 0.4, sd, K.wall);
    saddleRoof(g, K, 0, 0.7, sz, sw, sd, 0.5, { over: 0.15 });
  } else {
    wallsFor(g, K, style, 0, 0.04, sz, sw, sd, 0.5);
    roofFor(g, K, style, 0, 0.54, sz, sw, sd, 0.45, { thatch: style !== 'frost' });
  }
  g.box(0, 0.04, sz + sd / 2 + 0.01, 0.3, 0.34, 0.03, K.door);
  // pier
  const px = 0.25,
    pz0 = 0.1,
    pz1 = 3.3;
  g.box(px, 0.08, (pz0 + pz1) / 2, 0.5, 0.06, pz1 - pz0, K.plank);
  for (let i = 0; i < 12; i++) g.box(px, 0.135, pz0 + 0.12 + i * 0.27, 0.52, 0.01, 0.05, K.timber2);
  for (let z = pz0 + 0.4; z <= pz1; z += 0.7)
    for (const s of [-1, 1]) {
      g.box(px + s * 0.24, -1.4, z, 0.06, 1.62, 0.06, K.timber);
    }
  g.box(px + 0.22, 0.14, pz1 - 0.15, 0.06, 0.14, 0.06, K.timber);
  // nets, crates
  g.box(-0.45, 0, 0.35, 0.35, 0.03, 0.4, 0x8a7a5a);
  crate(g, K, -0.5, 0, 0.0);
  barrel(g, K, -0.25, 0, 0.1);
  g.anchor('boats', px + 0.62, 0, pz1 - 0.6, { ry: 0.05 });
  g.anchor('boats', px - 0.62, 0, pz1 - 1.5, { ry: -0.1 });
  g.anchor('lamps', px, 0, pz1 - 0.1, { r: 0.9, water: true });
  g.box(px - 0.22, 0.14, pz1 - 0.1, 0.04, 0.42, 0.04, K.timber);
  g.box(px - 0.22, 0.5, pz1 - 0.1, 0.07, 0.08, 0.07, 0xffd48a, { glow: 1 });
  return { base: { x: 0, z: sz, w: sw + 0.06, d: sd + 0.06 }, pier: true };
}

function market(g, K, style) {
  const stalls = [
    [-0.85, -0.7, 0],
    [0.8, -0.75, 0],
    [-0.85, 0.6, Math.PI],
    [0.85, 0.65, Math.PI],
  ];
  const goods = [0xd84a3a, 0xe8b830, 0x7ab040, 0xe07a2a, 0x9a4ab0, 0xf0e0c0];
  let gi = 0;
  for (const [x, z, ry] of stalls) {
    g.push();
    g.translate(x, 0, z);
    g.rotateY(ry);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.box(sx * 0.32, 0, sz * 0.25, 0.04, sz > 0 ? 0.56 : 0.7, 0.04, K.timber);
    g.box(0, 0, 0.12, 0.62, 0.26, 0.24, K.plank);
    for (let i = 0; i < 4; i++) g.box(-0.22 + i * 0.15, 0.26, 0.12, 0.11, 0.06, 0.16, goods[gi++ % goods.length], { jit: 0.15 });
    // striped awning
    for (let i = 0; i < 5; i++) {
      const x0 = -0.38 + i * 0.152;
      g.slab(x0, x0 + 0.152, 0.34, 0.54, -0.28, 0.72, 0.02, i % 2 ? K.cloth : K.flower, { tint: i % 2 ? 0 : 1, rows: 1 });
    }
    g.pop();
  }
  // central well/fountain and crates
  g.cyl(0, -0.06, 0, 0.32, 0.22, 10, K.stone, { capCol: 0x3a8aa0 });
  g.cyl(0, 0.16, 0, 0.08, 0.32, 7, K.stone2, {});
  g.bead(0, 0.46, 0, 0.06, K.stone);
  crate(g, K, 0.3, 0, 1.15);
  barrel(g, K, -0.3, 0, 1.15);
  sacks(g, K, 1.15, 0, 0.0);
  g.anchor('lamps', 0, 0, 0, { r: 1.6 });
  bannerPole(g, K, 0.0, 0.0, -1.2, 1.5, { s: 1.1 });
  return { base: null };
}

function temple(g, K, style, lv) {
  if (style === 'vale') {
    const w = 1.1,
      d = 1.9,
      h = 0.9,
      bz = -0.2;
    g.box(0, -0.06, bz, w, h + 0.06, d, K.stone, { jit: 0.08 });
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) g.box(s * (w / 2 + 0.05), 0, bz - d / 2 + 0.25 + i * 0.47, 0.1, h * 0.75, 0.12, K.stone2);
    g.gable(0, h, bz, w, d, 0.85, K.tile, { axis: 'z', over: 0.1, th: 0.07, tint: K.roofTint * 0.7, gable: K.stone, rows: 6 });
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) windowOn(g, K, 0, bz, w, d, s > 0 ? 'R' : 'L', -0.3 + i * 0.3, 0.42, { w: 0.1, h: 0.28, frame: K.stone2, sill: K.stone2, cross: false });
    // rose window
    g.push();
    g.translate(0, h + 0.3, bz + d / 2 + 0.01);
    g.rotateX(Math.PI / 2);
    g.cyl(0, -0.01, 0, 0.14, 0.03, 10, 0x6a4a8a, { glow: 1 });
    g.pop();
    doorOn(g, K, 0, bz, w, d, 'F', 0, 0, { w: 0.28, h: 0.46, arch: true, tint: 0.2, lampR: 1.4 });
    if (lv >= 2) {
      const tz = bz + d / 2 - 0.25;
      g.box(0, h + 0.2, tz, 0.5, 1.25, 0.5, K.stone);
      for (const f of ['F', 'B', 'L', 'R']) {
        const p = face(0, tz, 0.5, 0.5, f, 0);
        g.box(p.x + p.nx * 0.01, h + 1.05, p.z + p.nz * 0.01, 0.14, 0.24, 0.02, 0x2a2420, { ry: p.ry });
      }
      g.hip(0, h + 1.45, tz, 0.5, 0.5, 1.2, K.tile, { over: 0.06, tint: K.roofTint, rows: 4 });
      g.bead(0, h + 2.65, tz, 0.04, K.trim, { tint: 0.5 });
    } else {
      g.box(0, h + 0.62, bz + d / 2 - 0.12, 0.26, 0.4, 0.2, K.stone);
      g.gable(0, h + 1.02, bz + d / 2 - 0.12, 0.26, 0.2, 0.18, K.tile, { axis: 'z', over: 0.03, th: 0.03, tint: K.roofTint, gable: K.stone, rows: 1 });
    }
    // graveyard stones
    for (let i = 0; i < 4; i++) g.box(-0.95 + (i % 2) * 0.22, 0, 0.6 + Math.floor(i / 2) * 0.3, 0.12, 0.18, 0.04, K.stone2);
    return { base: { x: 0, z: bz, w, d } };
  }
  if (style === 'dune') {
    const w = 1.8,
      bz = -0.15;
    g.box(0, -0.06, bz, w, 0.86, w, K.wall);
    parapet(g, K, 0, 0.8, bz, w, w, 0.08, 0.06, K.wall2);
    g.cyl(0, 0.8, bz, 0.62, 0.22, 12, K.wall2, {});
    g.dome(0, 1.02, bz, 0.62, 14, 6, K.tile, { tint: K.roofTint, sy: lv >= 2 ? 1.35 : 1.1, ribs: true });
    g.bead(0, 1.02 + 0.62 * (lv >= 2 ? 1.35 : 1.1), bz, 0.05, K.trim, { tint: 0.6 });
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = sx * 0.76,
          z = bz + sz * 0.76;
        if (lv >= 2) {
          g.cyl(x, 0.8, z, 0.16, 0.12, 8, K.wall2, {});
          g.dome(x, 0.92, z, 0.16, 8, 3, K.tile, { tint: K.roofTint, sy: 1.2 });
        } else g.cone(x, 0.86, z, 0.08, 0.26, 6, K.wall2, {});
      }
    doorOn(g, K, 0, bz, w, w, 'F', 0, 0, { w: 0.32, h: 0.52, arch: true, tint: 0.3, lampR: 1.4 });
    for (const f of ['L', 'R', 'B']) windowOn(g, K, 0, bz, w, w, f, 0, 0.42, { w: 0.14, h: 0.24, frame: K.accent, sill: K.wall2, cross: false });
    return { base: { x: 0, z: bz, w, d: w } };
  }
  if (style === 'frost') {
    if (lv < 2) {
      // ring of standing stones around a small shrine
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        g.box(Math.cos(a) * 1.15, -0.06, Math.sin(a) * 1.15, 0.16, 0.5 + (i % 3) * 0.12, 0.12, K.stone, { ry: -a, jit: 0.12 });
      }
      g.box(0, -0.06, -0.1, 0.7, 0.46, 0.6, K.wall);
      g.gable(0, 0.4, -0.1, 0.7, 0.6, 0.6, K.tile, { over: 0.1, th: 0.05, tint: K.roofTint, gable: K.wall2, rows: 3 });
      snowCap(g, K, 0, 0.4, -0.1, 0.7, 0.6, 0.6, { k: 0.4 });
      doorOn(g, K, 0, -0.1, 0.7, 0.6, 'F', 0, 0, { w: 0.2, h: 0.32, lampR: 1.2 });
      g.cyl(0, -0.06, 0.6, 0.18, 0.16, 8, K.stone2, { capCol: 0x5a3a20 });
      g.anchor('chimneys', 0, 0.12, 0.6, { rate: 0.4 });
      return { base: null };
    }
    // stave temple: stacked roofs
    const bz = -0.05;
    g.box(0, -0.06, bz, 1.5, 0.2, 1.5, K.stone);
    g.box(0, 0.14, bz, 1.3, 0.5, 1.3, K.wall);
    g.hip(0, 0.64, bz, 1.4, 1.4, 0.4, K.tile, { over: 0.12, tint: K.roofTint, rows: 2 });
    g.box(0, 0.9, bz, 0.95, 0.4, 0.95, K.wall);
    g.hip(0, 1.3, bz, 1.0, 1.0, 0.36, K.tile, { over: 0.12, tint: K.roofTint, rows: 2 });
    g.box(0, 1.55, bz, 0.55, 0.36, 0.55, K.wall);
    g.hip(0, 1.91, bz, 0.6, 0.6, 0.9, K.tile, { over: 0.1, tint: K.roofTint, rows: 3 });
    g.hip(0, 1.91 + 0.45, bz, 0.28, 0.28, 0.45, K.snow, { over: 0, rows: 1 });
    for (const [x, z] of [
      [0.75, bz],
      [-0.75, bz],
      [0, bz + 0.75],
      [0, bz - 0.75],
    ])
      g.beam(x * 0.92, 0.6, z, x * 1.08, 0.95, z + (z - bz) * 0.08, 0.04, K.timber, { tint: 0.5 });
    doorOn(g, K, 0, bz, 1.3, 1.3, 'F', 0, 0.14, { w: 0.26, h: 0.42, tint: 0.3, lampR: 1.4 });
    return { base: { x: 0, z: bz, w: 1.5, d: 1.5 } };
  }
  // mire
  if (lv < 2) {
    const top = 0.7;
    stilts(g, K, 0, -0.1, 1.2, 1.2, top, 2);
    g.box(0, top - 0.06, -0.1, 1.3, 0.07, 1.3, K.plank);
    g.box(0, top, -0.15, 0.7, 0.5, 0.6, K.wall);
    saddleRoof(g, K, 0, top + 0.5, -0.15, 0.7, 0.6, 0.85, { over: 0.2 });
    ladder(g, K, 0, 0.55, top, 1);
    for (const s of [-1, 1]) {
      g.cyl(s * 0.85, -0.05, 0.75, 0.07, 1.0, 7, K.timber, {});
      g.cone(s * 0.85, 0.95, 0.75, 0.1, 0.16, 7, K.trim, { tint: 0.7 });
    }
    g.anchor('lamps', 0, 0, 0.9, { r: 1 });
    return { base: null, stilts: true };
  }
  // step temple
  g.box(0, -0.06, 0, 2.5, 0.42, 2.5, K.stone, { jit: 0.1 });
  g.box(0, 0.36, 0, 1.9, 0.4, 1.9, K.stone2, { jit: 0.1 });
  g.box(0, 0.76, 0, 1.3, 0.4, 1.3, K.stone, { jit: 0.1 });
  for (let i = 0; i < 6; i++) g.box(0, -0.06 + i * 0.2, 1.25 - i * 0.1, 0.5, 0.2, 0.2, K.stone2);
  g.box(0, 1.16, -0.05, 0.7, 0.5, 0.6, K.wall);
  saddleRoof(g, K, 0, 1.66, -0.05, 0.7, 0.6, 0.7, { over: 0.18 });
  doorOn(g, K, 0, -0.05, 0.7, 0.6, 'F', 0, 1.16, { w: 0.22, h: 0.34, step: false, lampR: 1.4 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.cone(sx * 1.1, 0.36, sz * 1.1, 0.1, 0.4, 6, K.stone2, {});
  g.anchor('chimneys', 0.0, 1.2, 0.5, { rate: 0.35 });
  return { base: { x: 0, z: 0, w: 2.5, d: 2.5 } };
}

function barracks(g, K, style) {
  const w = 2.6,
    d = 1.0,
    bz = -0.45,
    h = style === 'dune' ? 0.75 : 0.66;
  g.box(0, -0.06, bz, w + 0.06, 0.18, d + 0.06, K.stone);
  wallsFor(g, K, style, 0, 0.12, bz, w, d, h - 0.12);
  if (style === 'dune') {
    parapet(g, K, 0, h, bz, w, d, 0.1, 0.06, K.wall2);
    crenels(g, K, 0, h + 0.1, bz, w, d, K.wall2, 0.22, 0.07);
  } else roofFor(g, K, style, 0, h, bz, w, d, 0.62, {});
  doorOn(g, K, 0, bz, w, d, 'F', 0, 0.1, { w: 0.3, h: 0.42, tint: 0.3 });
  for (const u of [-0.35, -0.2, 0.2, 0.35]) windowOn(g, K, 0, bz, w, d, 'F', u, 0.4, { w: 0.12, h: 0.13 });
  // training yard: dummies & weapon rack
  for (const x of [-0.9, -0.4]) {
    g.box(x, 0, 0.55, 0.05, 0.5, 0.05, K.timber);
    g.box(x, 0.32, 0.55, 0.3, 0.04, 0.04, K.timber);
    g.bead(x, 0.5, 0.55, 0.07, 0xd8c79a);
    g.box(x, 0.16, 0.55, 0.12, 0.2, 0.1, 0xb8a070);
  }
  g.box(0.75, 0, 0.5, 0.6, 0.04, 0.12, K.timber);
  g.box(0.75, 0.4, 0.5, 0.6, 0.04, 0.12, K.timber);
  for (let i = 0; i < 5; i++) g.beam(0.5 + i * 0.12, 0.02, 0.5, 0.52 + i * 0.12, 0.62, 0.48, 0.02, K.metal);
  g.box(0, -0.02, 0.5, 2.4, 0.03, 0.9, 0xa08a66);
  bannerPole(g, K, 1.15, 0, 0.75, 1.5, { s: 1.2 });
  bannerPole(g, K, -1.2, 0, 0.75, 1.5, { s: 1.2 });
  return { base: { x: 0, z: bz, w: w + 0.06, d: d + 0.06 } };
}

function watchtower(g, K, style) {
  const top = 1.45;
  if (style === 'dune' || style === 'frost') {
    const col = style === 'dune' ? K.wall : K.stone;
    g.box(0, -0.06, 0, 0.62, top + 0.06, 0.62, col, { jit: 0.1 });
    g.box(0, top, 0, 0.72, 0.05, 0.72, K.timber);
    if (style === 'dune') {
      parapet(g, K, 0, top + 0.05, 0, 0.72, 0.72, 0.14, 0.06, K.wall2);
      crenels(g, K, 0, top + 0.19, 0, 0.72, 0.72, K.wall2, 0.18, 0.07);
    } else {
      for (const [x, z] of [
        [-0.32, -0.32],
        [0.32, -0.32],
        [-0.32, 0.32],
        [0.32, 0.32],
      ])
        g.box(x, top + 0.05, z, 0.05, 0.4, 0.05, K.timber);
      g.hip(0, top + 0.45, 0, 0.7, 0.7, 0.62, K.tile, { over: 0.08, tint: K.roofTint, rows: 3 });
      g.hip(0, top + 0.45 + 0.32, 0, 0.32, 0.32, 0.3, K.snow, { over: 0, rows: 1 });
    }
    g.box(0, 0, 0.315, 0.18, 0.32, 0.02, K.door);
    windowOn(g, K, 0, 0, 0.62, 0.62, 'F', 0, 0.85, { w: 0.07, h: 0.13, cross: false });
    bannerPole(g, K, 0.3, top + 0.05, 0.3, style === 'frost' ? 1.0 : 0.6, { s: 1 });
    return { base: { x: 0, z: 0, w: 0.62, d: 0.62 } };
  }
  // timber tower on legs (vale, mire)
  for (const [x, z] of [
    [-0.32, -0.32],
    [0.32, -0.32],
    [-0.32, 0.32],
    [0.32, 0.32],
  ])
    g.beam(x, -0.3, z, x * 0.75, top, z * 0.75, 0.07, K.timber);
  g.beam(-0.3, 0.3, 0.3, 0.3, 0.9, 0.3, 0.035, K.timber2);
  g.beam(0.3, 0.3, -0.3, -0.3, 0.9, -0.3, 0.035, K.timber2);
  g.beam(0.3, 0.3, 0.3, 0.3, 0.9, -0.3, 0.035, K.timber2);
  g.beam(-0.3, 0.9, 0.3, -0.3, 0.3, -0.3, 0.035, K.timber2);
  g.box(0, top, 0, 0.66, 0.05, 0.66, K.plank);
  railing(g, K, 0, top + 0.05, 0, 0.62, 0.62, 'FBLR', 0.2);
  for (const [x, z] of [
    [-0.29, -0.29],
    [0.29, -0.29],
    [-0.29, 0.29],
    [0.29, 0.29],
  ])
    g.box(x, top + 0.05, z, 0.04, 0.42, 0.04, K.timber);
  if (style === 'mire') g.cone(0, top + 0.45, 0, 0.5, 0.55, 8, K.thatch, { tint: K.thatchTint, stripes: K.thatch2 });
  else g.hip(0, top + 0.47, 0, 0.62, 0.62, 0.5, K.thatch, { over: 0.08, tint: K.thatchTint, rows: 3 });
  ladder(g, K, 0, 0.1, top, 1);
  g.box(0.2, top + 0.3, 0.2, 0.06, 0.07, 0.06, 0xffd48a, { glow: 1 });
  bannerPole(g, K, -0.25, top + 0.05, -0.25, 1.05, { s: 1 });
  return { base: null };
}

// City wall pieces ----------------------------------------------------------
export const WALL_H = 0.9;
export function wallPost(style) {
  const K = PAL[style];
  const g = new GeoBuilder(3);
  const c = style === 'dune' ? K.wall : K.stone;
  g.box(0, -0.5, 0, 0.44, WALL_H + 0.5, 0.44, c, { jit: 0.1 });
  g.box(0, WALL_H, 0, 0.13, 0.11, 0.13, c);
  return g.build();
}
// Half-segment from the post centre toward +X (length 0.5 or 0.707 for diagonals).
export function wallArm(style, len) {
  const K = PAL[style];
  const g = new GeoBuilder(len > 0.6 ? 5 : 4);
  const c = style === 'dune' ? K.wall : K.stone;
  g.box(len / 2, -0.5, 0, len, WALL_H + 0.5, 0.36, c, { jit: 0.1 });
  g.box(len / 2, WALL_H - 0.02, 0, len, 0.03, 0.4, shade(c, 0.85));
  const n = Math.max(1, Math.round(len / 0.24));
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) * len) / n;
    g.box(x, WALL_H, 0.14, 0.1, 0.11, 0.08, c);
    g.box(x, WALL_H, -0.14, 0.1, 0.11, 0.08, c);
  }
  if (style === 'frost') g.box(len / 2, WALL_H - 0.01, 0, len, 0.02, 0.2, K.snow);
  return g.build();
}

function wallTower(g, K, style) {
  const c = style === 'dune' ? K.wall : K.stone;
  if (style === 'vale' || style === 'mire') {
    g.cyl(0, -0.5, 0, 0.42, 1.9, 10, c, { jit: 0.1 });
    g.cyl(0, 1.38, 0, 0.46, 0.06, 10, K.stone2, {});
    g.cone(0, 1.44, 0, 0.5, 0.75, 10, K.tile, { tint: K.roofTint });
    bannerPole(g, K, 0, 2.15, 0, 0.35, { s: 0.9 });
    windowOn(g, K, 0, 0, 0.8, 0.8, 'F', 0, 1.0, { w: 0.07, h: 0.14, cross: false });
    windowOn(g, K, 0, 0, 0.8, 0.8, 'B', 0, 1.0, { w: 0.07, h: 0.14, cross: false });
  } else if (style === 'frost') {
    g.box(0, -0.5, 0, 0.8, 1.9, 0.8, c, { jit: 0.12 });
    g.hip(0, 1.4, 0, 0.8, 0.8, 0.9, K.tile, { over: 0.06, tint: K.roofTint, rows: 3 });
    g.hip(0, 1.85, 0, 0.36, 0.36, 0.45, K.snow, { over: 0, rows: 1 });
    bannerPole(g, K, 0, 2.28, 0, 0.3, { s: 0.9 });
    windowOn(g, K, 0, 0, 0.8, 0.8, 'F', 0, 1.0, { w: 0.07, h: 0.14, cross: false });
  } else {
    g.box(0, -0.5, 0, 0.82, 1.85, 0.82, c);
    parapet(g, K, 0, 1.35, 0, 0.86, 0.86, 0.1, 0.07, K.wall2);
    crenels(g, K, 0, 1.45, 0, 0.86, 0.86, K.wall2, 0.2, 0.08);
    bannerPole(g, K, 0.3, 1.35, 0.3, 0.6, { s: 0.9 });
    windowOn(g, K, 0, 0, 0.82, 0.82, 'F', 0, 1.0, { w: 0.08, h: 0.14, frame: K.accent, sill: K.wall2, cross: false });
  }
  return { base: null };
}

function gatehouse(g, K, style) {
  // road runs along local Z through the arch; towers flank on +-X
  const c = style === 'dune' ? K.wall : K.stone;
  for (const s of [-1, 1]) {
    g.box(s * 0.38, -0.5, 0, 0.3, 1.75, 0.62, c, { jit: 0.1 });
    if (style === 'dune') crenels(g, K, s * 0.38, 1.25, 0, 0.3, 0.62, K.wall2, 0.18, 0.07);
    else {
      g.hip(s * 0.38, 1.25, 0, 0.3, 0.62, 0.45, K.tile, { over: 0.05, tint: K.roofTint, rows: 2 });
      if (style === 'frost') g.hip(s * 0.38, 1.47, 0, 0.12, 0.3, 0.22, K.snow, { over: 0, rows: 1 });
    }
  }
  g.box(0, 0.72, 0, 0.5, 0.36, 0.6, c);
  crenels(g, K, 0, 1.08, 0, 0.5, 0.6, c, 0.16, 0.08);
  g.box(0, 0.6, 0.31, 0.46, 0.12, 0.02, K.timber);
  g.box(0, 0.65, 0.33, 0.12, 0.09, 0.02, K.cloth, { tint: 1 });
  bannerPole(g, K, -0.38, 1.6, 0.25, 0.4, { s: 0.9 });
  g.anchor('lamps', 0, 0, 0.6, { r: 1.2 });
  g.box(0.25, 0.48, 0.33, 0.05, 0.07, 0.05, 0xffd48a, { glow: 1 });
  return { base: null };
}

// ---------------------------------------------------------------- generic stages
export function foundation(w, h) {
  const g = new GeoBuilder(w * 7 + h);
  const K = PAL.vale;
  const W = w * 0.86,
    D = h * 0.86;
  const t = 0.12;
  g.box(0, -0.06, -D / 2 + t / 2, W, 0.16, t, K.stone, { jit: 0.15 });
  g.box(0, -0.06, D / 2 - t / 2, W, 0.16, t, K.stone, { jit: 0.15 });
  g.box(-W / 2 + t / 2, -0.06, 0, t, 0.16, D - t * 2, K.stone, { jit: 0.15 });
  g.box(W / 2 - t / 2, -0.06, 0, t, 0.16, D - t * 2, K.stone, { jit: 0.15 });
  g.box(0, -0.04, 0, W - t * 2, 0.06, D - t * 2, 0x8a6a48);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.box(sx * (W / 2 + 0.05), 0, sz * (D / 2 + 0.05), 0.04, 0.3, 0.04, 0xc8a070);
  g.beam(-W / 2 - 0.05, 0.26, D / 2 + 0.05, W / 2 + 0.05, 0.26, D / 2 + 0.05, 0.008, 0xf0e8d0);
  logs(g, K, W / 2 - 0.25, 0.02, -D / 2 + 0.35, 3, Math.min(0.6, W * 0.4));
  g.box(-W / 2 + 0.25, 0.0, -D / 2 + 0.3, 0.16, 0.12, 0.14, K.stone);
  g.box(-W / 2 + 0.4, 0.0, -D / 2 + 0.25, 0.14, 0.12, 0.12, K.stone2);
  g.box(-W / 2 + 0.32, 0.12, -D / 2 + 0.28, 0.14, 0.11, 0.12, K.stone);
  return g.build();
}

// Timber frame of a building under construction, sized from its finished bounds.
export function frameFor(arch) {
  const bb = arch.geo.boundingBox;
  const g = new GeoBuilder(97);
  const c = 0x9a7046,
    c2 = 0x7d5836;
  const base = arch.base;
  const x0 = base ? base.x - base.w / 2 + 0.06 : bb.min.x + 0.2,
    x1 = base ? base.x + base.w / 2 - 0.06 : bb.max.x - 0.2,
    z0 = base ? base.z - base.d / 2 + 0.06 : bb.min.z + 0.2,
    z1 = base ? base.z + base.d / 2 - 0.06 : bb.max.z - 0.2;
  const top = Math.min(1.1, Math.max(0.45, arch.maxY * 0.42));
  const ridge = Math.min(2.6, Math.max(top + 0.3, arch.maxY * 0.85));
  const t = 0.05;
  const along = x1 - x0 >= z1 - z0;
  // sill beams & floor joists
  g.box((x0 + x1) / 2, 0.0, z0, x1 - x0, 0.06, 0.07, c2);
  g.box((x0 + x1) / 2, 0.0, z1, x1 - x0, 0.06, 0.07, c2);
  g.box(x0, 0.0, (z0 + z1) / 2, 0.07, 0.06, z1 - z0, c2);
  g.box(x1, 0.0, (z0 + z1) / 2, 0.07, 0.06, z1 - z0, c2);
  const nx = Math.max(1, Math.round((x1 - x0) / 0.42)),
    nz = Math.max(1, Math.round((z1 - z0) / 0.42));
  for (let i = 0; i <= nx; i++) {
    const x = x0 + ((x1 - x0) * i) / nx;
    g.box(x, 0.0, z0, t, top, t, c);
    g.box(x, 0.0, z1, t, top, t, c);
  }
  for (let i = 1; i < nz; i++) {
    const z = z0 + ((z1 - z0) * i) / nz;
    g.box(x0, 0.0, z, t, top, t, c);
    g.box(x1, 0.0, z, t, top, t, c);
  }
  // wall plates
  g.box((x0 + x1) / 2, top, z0, x1 - x0 + 0.06, 0.05, 0.07, c2);
  g.box((x0 + x1) / 2, top, z1, x1 - x0 + 0.06, 0.05, 0.07, c2);
  g.box(x0, top, (z0 + z1) / 2, 0.07, 0.05, z1 - z0, c2);
  g.box(x1, top, (z0 + z1) / 2, 0.07, 0.05, z1 - z0, c2);
  // braces
  g.beam(x0, 0.04, z1 + 0.01, x0 + 0.3, top, z1 + 0.01, 0.03, c2);
  g.beam(x1, 0.04, z0 - 0.01, x1 - 0.3, top, z0 - 0.01, 0.03, c2);
  // rafters toward the ridge
  const n = along ? nx : nz;
  for (let i = 0; i <= n; i++) {
    if (along) {
      const x = x0 + ((x1 - x0) * i) / n;
      g.beam(x, top, z0, x, ridge, (z0 + z1) / 2, 0.035, c);
      g.beam(x, top, z1, x, ridge, (z0 + z1) / 2, 0.035, c);
    } else {
      const z = z0 + ((z1 - z0) * i) / n;
      g.beam(x0, top, z, (x0 + x1) / 2, ridge, z, 0.035, c);
      g.beam(x1, top, z, (x0 + x1) / 2, ridge, z, 0.035, c);
    }
  }
  if (along) g.box((x0 + x1) / 2, ridge - 0.03, (z0 + z1) / 2, x1 - x0 + 0.04, 0.05, 0.05, c2);
  else g.box((x0 + x1) / 2, ridge - 0.03, (z0 + z1) / 2, 0.05, 0.05, z1 - z0 + 0.04, c2);
  // a ladder against the frame
  for (const s of [-0.07, 0.07]) g.beam(x0 + 0.35 + s, 0, z1 + 0.25, x0 + 0.35 + s, top + 0.1, z1 + 0.03, 0.025, c);
  return g.build();
}

// Building materials stacked beside a construction site.
export function materialPile(style) {
  const K = PAL[style] || PAL.vale;
  const g = new GeoBuilder(13);
  logs(g, K, 0, 0, 0, 3, 0.42);
  g.box(0.3, -0.02, 0.05, 0.14, 0.12, 0.14, K.stone, { jit: 0.15 });
  g.box(0.42, -0.02, -0.05, 0.13, 0.11, 0.12, K.stone2, { jit: 0.15 });
  g.box(0.36, 0.1, 0.0, 0.13, 0.1, 0.12, K.stone, { jit: 0.15 });
  g.box(-0.05, 0.16, 0.0, 0.5, 0.025, 0.12, K.plank);
  g.box(-0.05, 0.19, 0.02, 0.48, 0.025, 0.12, shade(K.plank, 1.08));
  return g.build();
}

export function scaffold(w, h, height) {
  const g = new GeoBuilder(w * 5 + h * 3 + Math.round(height * 10));
  const c = 0x8e6a44,
    c2 = 0x735535;
  const W = w * 0.92,
    D = h * 0.92;
  const top = Math.max(0.7, height);
  const xs = [-W / 2, 0, W / 2],
    zs = [-D / 2, 0, D / 2];
  for (const x of xs)
    for (const z of zs) {
      if (x === 0 && z === 0) continue;
      if (x !== 0 && z !== 0 && false) continue;
      g.box(x, -0.2, z, 0.035, top + 0.2, 0.035, c);
    }
  for (let y = 0.35; y < top; y += 0.4) {
    g.box(0, y, D / 2, W + 0.05, 0.03, 0.12, c2);
    g.box(0, y, -D / 2, W + 0.05, 0.03, 0.12, c2);
    g.box(W / 2, y, 0, 0.12, 0.03, D + 0.05, c2);
    g.box(-W / 2, y, 0, 0.12, 0.03, D + 0.05, c2);
  }
  g.beam(-W / 2, 0.05, D / 2 + 0.02, 0, Math.min(top, 0.75), D / 2 + 0.02, 0.025, c);
  g.beam(W / 2, 0.05, -D / 2 - 0.02, 0, Math.min(top, 0.75), -D / 2 - 0.02, 0.025, c);
  g.beam(W / 2 + 0.02, 0.05, D / 2, W / 2 + 0.02, Math.min(top, 0.75), 0, 0.025, c);
  // ladder
  for (const s of [-0.07, 0.07]) g.box(-W / 2 + 0.3 + s, 0, D / 2 + 0.12, 0.025, Math.min(top, 1.2), 0.025, c);
  return g.build();
}

export function ruin(style, w, h, seed = 1) {
  const K = PAL[style] || PAL.vale;
  const g = new GeoBuilder(seed * 31 + w * 7 + h);
  const rand = g.rand;
  const W = w * 0.8,
    D = h * 0.8;
  const wallC = style === 'dune' ? K.wall : style === 'mire' ? K.timber2 : K.stone;
  const segs = [
    [-W / 2, -D / 2, W / 2, -D / 2],
    [W / 2, -D / 2, W / 2, D / 2],
    [W / 2, D / 2, -W / 2, D / 2],
    [-W / 2, D / 2, -W / 2, -D / 2],
  ];
  for (const [x0, z0, x1, z1] of segs) {
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, z1 - z0) / 0.22));
    for (let i = 0; i < n; i++) {
      if (rand() < 0.22) continue;
      const t = (i + 0.5) / n;
      const hh = 0.08 + rand() * (rand() < 0.3 ? 0.55 : 0.22);
      const x = x0 + (x1 - x0) * t,
        z = z0 + (z1 - z0) * t;
      g.box(x, -0.06, z, Math.abs(x1 - x0) > 0.01 ? 0.24 : 0.12, hh + 0.06, Math.abs(z1 - z0) > 0.01 ? 0.24 : 0.12, wallC, { jit: 0.18 });
    }
  }
  for (let i = 0; i < 9; i++) g.box((rand() - 0.5) * W * 0.8, -0.04, (rand() - 0.5) * D * 0.8, 0.08 + rand() * 0.14, 0.05 + rand() * 0.08, 0.08 + rand() * 0.14, rand() < 0.5 ? wallC : K.stone2, { ry: rand() * 3, jit: 0.2 });
  for (let i = 0; i < 3; i++) {
    const x = (rand() - 0.5) * W * 0.6,
      z = (rand() - 0.5) * D * 0.6;
    g.beam(x, 0.02, z, x + (rand() - 0.5) * 0.7, 0.12 + rand() * 0.3, z + (rand() - 0.5) * 0.7, 0.05, 0x2a1d14);
  }
  g.box(0, -0.05, 0, W * 0.9, 0.04, D * 0.9, 0x4a4038, { jit: 0.1 });
  return g.build();
}

// Lantern post for town streets.
export function lampPost() {
  const g = new GeoBuilder(77);
  const K = PAL.vale;
  g.box(0, -0.1, 0, 0.05, 0.85, 0.05, K.timber);
  g.box(0.08, 0.68, 0, 0.18, 0.03, 0.03, K.timber);
  g.box(0.15, 0.56, 0, 0.07, 0.1, 0.07, 0xffd48a, { glow: 1 });
  g.box(0.15, 0.66, 0, 0.09, 0.02, 0.09, K.metal);
  g.anchor('lamps', 0.15, 0, 0, { r: 0.9 });
  return { geo: g.build(), anchors: g.anchors };
}

// Far-zoom proxy: a unit-sized house block in the style's materials, scaled per
// instance to each building's footprint and height.
export function proxyGeometry(style) {
  const K = PAL[style] || PAL.vale;
  const g = new GeoBuilder(5, { roofKind });
  if (style === 'dune') {
    g.box(0, -0.4, 0, 1, 1.25, 1, K.wall, { top: shade(K.wall, 0.92) });
    parapet(g, K, 0, 0.85, 0, 1, 1, 0.08, 0.06, K.wall2);
    g.dome(0.15, 0.85, -0.1, 0.24, 8, 2, K.tile, { tint: 0.25 });
  } else {
    const wall = style === 'frost' ? K.wall : style === 'mire' ? K.wall : K.wall;
    g.box(0, -0.4, 0, 1, 0.95, 1, wall);
    const roof = style === 'vale' ? K.tile : style === 'frost' ? K.tile : K.thatch;
    g.gable(0, 0.55, 0, 1, 1, 0.45, roof, { over: 0.06, th: 0.05, tint: K.roofTint, gable: K.wall2, rows: 2 });
  }
  return g.build();
}

// ---------------------------------------------------------------- entry point
const BUILDERS = {
  house: (g, K, s, lv) => (s === 'vale' ? valeHouse : s === 'dune' ? duneHouse : s === 'frost' ? frostHouse : mireHouse)(g, K, lv),
  hall: (g, K, s, lv) => hall(g, K, s, lv),
  granary: (g, K, s) => granary(g, K, s),
  workshop: (g, K, s, lv) => workshop(g, K, s, lv),
  well: (g, K, s) => well(g, K, s),
  windmill: (g, K, s) => windmill(g, K, s),
  docks: (g, K, s) => docks(g, K, s),
  market: (g, K, s) => market(g, K, s),
  temple: (g, K, s, lv) => temple(g, K, s, lv),
  barracks: (g, K, s) => barracks(g, K, s),
  watchtower: (g, K, s) => watchtower(g, K, s),
  tower: (g, K, s) => wallTower(g, K, s),
  gate: (g, K, s) => gatehouse(g, K, s),
};

export function buildArchetype(type, style, level) {
  const K = PAL[style] || PAL.vale;
  const g = new GeoBuilder(type.length * 131 + level * 17 + style.length * 7, { roofKind });
  const fn = BUILDERS[type];
  let info = {};
  if (fn) info = fn(g, K, style, level) || {};
  else g.box(0, 0, 0, 0.8, 0.8, 0.8, K.wall);
  // every home flies a small pennant in its kingdom's colours
  if (type === 'house' && !(style === 'mire' && level >= 3)) bannerPole(g, K, 0.88, 0, 0.88, style === 'mire' ? 1.35 : 1.0, { s: 0.55 });
  return { geo: g.build(), anchors: g.anchors, maxY: g.maxY, base: info.base ?? null, stilts: !!info.stilts, pier: !!info.pier };
}

export { mix };
