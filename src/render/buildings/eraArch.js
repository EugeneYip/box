import { shade } from './geom.js';
import { bands, mullions, flatRoof, tree, door, sign } from './modernModels.js';

// Homes and halls of the Modern, Atomic and Future eras (5-7). The Industrial
// era (4) keeps the older forms in brick, iron and slate (archetypes.js
// ERA_DRESS); from the Modern era on, a culture builds anew:
//   vale  — flat-roofed blocks with a cantilevered upper floor and timber cladding
//   dune  — stacked white cubes, roof terraces under pergolas, a small dome
//   frost — steep roofs kept for the snow, dark metal and boarded walls
//   mire  — raised on pilotis with a veranda under a wide low roof
// Era sets the materials: Modern concrete and ribbon windows, Atomic glass
// and steel, Future white walls, planted roofs and solar panels.
// K is the era palette (eraPalette): wall, wall2, tile (roof), glass, trim, accent.

const FH = 0.4;

function solar(g, x, y, z, w, d, n = 2) {
  for (let i = 0; i < n; i++) {
    const zz = z - d / 2 + (d * (i + 0.5)) / n;
    g.push();
    g.translate(x, y + 0.06, zz);
    g.rotateX(-0.45);
    g.box(0, 0, 0, w, 0.02, (d / n) * 0.8, 0x23324a, { top: 0x2f4a78 });
    g.pop();
    g.box(x, y, zz + 0.04, 0.03, 0.08, 0.03, 0x8a9096);
  }
}
function plinth(g, K, cx, cz, w, d) {
  g.box(cx, -0.08, cz, w + 0.08, 0.12, d + 0.08, K.stone2);
}
function glassFront(g, K, cx, y0, cz, w, d, h, frame) {
  // full-height glazing on the front face, framed in steel
  g.box(cx, y0 + 0.03, cz + d / 2 + 0.012, w - 0.08, h - 0.06, 0.02, K.glass, { glow: 1 });
  const n = Math.max(2, Math.round(w / 0.22));
  for (let i = 1; i < n; i++) g.box(cx - w / 2 + (w * i) / n, y0, cz + d / 2 + 0.024, 0.022, h, 0.015, frame, { noTop: true });
  g.box(cx, y0 + h - 0.03, cz + d / 2 + 0.024, w, 0.03, 0.015, frame, { noTop: true });
}
function hedge(g, x, z, w, d) {
  g.box(x, 0, z, w, 0.12, d, 0x4a7a3c, { jit: 0.15 });
}

// ---------------------------------------------------------------- houses
export function eraHouse(g, K, style, lv, era) {
  const acc = K.accent ?? K.trim;
  const frame = era >= 7 ? 0xf2f4f0 : era >= 6 ? 0x6e767e : shade(K.wall, 0.78);
  const roofTop = era >= 7 ? 0x5f9a5a : K.tile;
  const floors = Math.max(1, Math.min(3, lv));
  if (style === 'dune') {
    // stacked cubes, each floor smaller, with a terrace and a dome on top
    const w = 1.3 + lv * 0.06,
      d = 1.05,
      bz = -0.1;
    plinth(g, K, 0, bz, w, d);
    let y = 0,
      cw = w,
      cd = d,
      cx = 0;
    for (let f = 0; f < floors; f++) {
      g.box(cx, y, bz, cw, FH, cd, f % 2 ? K.wall2 : K.wall);
      if (era >= 6) glassFront(g, K, cx, y, bz, cw * 0.7, cd, FH * 0.85, frame);
      else for (const u of [-0.3, 0, 0.3]) g.box(cx + u * cw, y + 0.13, bz + cd / 2 + 0.012, 0.12, 0.2, 0.02, K.glass, { glow: 1 });
      bands(g, K, cx, y, bz, cw, cd, 1, FH, { k: 0.3 });
      // the parapet round the roof of this floor
      flatRoof(g, cx, y + FH, bz, cw, cd, K.wall2, roofTop, 0.08);
      y += FH + 0.04;
      cx += f % 2 ? 0.12 : -0.12;
      cw *= 0.72;
      cd *= 0.8;
    }
    // a pergola on the top terrace and a small dome
    const tx = 0.4 * w * (floors % 2 ? 1 : -1) * 0.5;
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ])
      g.box(tx + sx * 0.16, y - 0.04, bz + sz * 0.16, 0.025, 0.26, 0.025, frame);
    for (let i = 0; i < 4; i++) g.box(tx, y + 0.2, bz - 0.15 + i * 0.1, 0.36, 0.02, 0.025, era >= 7 ? 0x5f9a5a : K.timber);
    g.dome(cx * 0.6, y - 0.02, bz - 0.15, 0.15 + lv * 0.02, 10, 3, K.tile, { tint: 0.2 });
    if (era >= 7) {
      g.box(cx * 0.6, y - 0.02, bz - 0.15, 0.36, 0.015, 0.36, 0x7fe8f0, { glow: 4 });
      for (const x of [-0.5, 0.55]) g.bead(x, 0.0, bz + d / 2 + 0.25, 0.1, 0x4f8a44);
    }
    door(g, K, -0.2, bz + d / 2, 0.2, 0.32, acc, { canopy: acc, tint: 0.4 });
    g.box(0.45, 0, bz + d / 2 + 0.25, 0.5, 0.1, 0.04, K.wall2);
    return { base: { x: 0, z: bz, w: w + 0.08, d: d + 0.08 } };
  }
  if (style === 'frost') {
    // a steep roof for the snow over boarded walls; big gable glazing later
    const w = 1.15 + lv * 0.1,
      d = 0.95,
      bz = -0.12;
    const h = FH * floors;
    plinth(g, K, 0, bz, w, d);
    g.box(0, 0, bz, w, h, d, K.wall);
    // vertical boards
    const nb = Math.round(w / 0.12);
    for (let i = 1; i < nb; i++) g.box(-w / 2 + (w * i) / nb, 0, bz + d / 2 + 0.008, 0.012, h, 0.012, shade(K.wall, 0.85), { noTop: true });
    if (era >= 6) glassFront(g, K, 0.18, 0, bz, w * 0.55, d, h, frame);
    else for (let f = 0; f < floors; f++) for (const u of [-0.3, 0.25]) g.box(u * w, f * FH + 0.12, bz + d / 2 + 0.014, 0.18, 0.2, 0.02, K.glass, { glow: 1 });
    bands(g, K, 0, 0, bz, w, d, floors, FH, { k: 0.3 });
    g.gable(0, h, bz, w, d, 0.62 + lv * 0.06, era >= 7 ? 0x6f8a4a : K.tile, { axis: 'z', over: 0.12, th: 0.05, gable: era >= 6 ? K.glass : K.wall2, rows: 5 });
    if (era >= 6) {
      // the gable end glazed to the ridge
      const gh = 0.62 + lv * 0.06;
      g.tri([-w / 2 + 0.06, h + 0.02, bz + d / 2 + 0.016], [w / 2 - 0.06, h + 0.02, bz + d / 2 + 0.016], [0, h + gh - 0.08, bz + d / 2 + 0.016], K.glass, 0, 1, [0, h, bz]);
    }
    if (era >= 7) solar(g, w * 0.22, h + 0.22, bz - 0.15, 0.28, 0.4, 1);
    g.box(-w * 0.3, h + 0.1, bz - 0.2, 0.1, 0.5, 0.1, 0x3a3d42);
    g.anchor('chimneys', -w * 0.3, h + 0.64, bz - 0.2, { rate: era >= 6 ? 0.3 : 0.6 });
    door(g, K, -0.25, bz + d / 2, 0.2, 0.34, acc, { canopy: K.tile, tint: 0.3 });
    // a woodshed and a sauna-stove flue
    g.box(w / 2 + 0.18, 0, bz + 0.1, 0.28, 0.32, 0.5, shade(K.wall, 0.8));
    g.box(w / 2 + 0.18, 0.32, bz + 0.1, 0.34, 0.03, 0.56, K.tile);
    return { base: { x: 0.08, z: bz, w: w + 0.4, d: d + 0.08 } };
  }
  if (style === 'mire') {
    // pilotis, a veranda and a wide low roof
    const w = 1.3 + lv * 0.08,
      d = 1.0,
      bz = -0.12,
      lift = 0.3;
    const h = FH * floors;
    for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) g.box((sx * (w - 0.1)) / 2, -0.5, bz + (sz * (d - 0.1)) / 2, 0.08, lift + 0.5, 0.08, K.stone);
    g.box(0, lift - 0.05, bz + 0.12, w + 0.2, 0.06, d + 0.4, K.timber2);
    g.box(0, lift, bz, w, h, d, K.wall);
    if (era >= 6) glassFront(g, K, 0, lift, bz, w * 0.8, d, h, frame);
    bands(g, K, 0, lift, bz, w, d, floors, FH, { k: 0.35 });
    // veranda railing and steps
    g.box(0, lift + 0.01, bz + d / 2 + 0.31, w + 0.2, 0.14, 0.02, K.timber, { noTop: true });
    for (let i = 0; i < 3; i++) g.box(w / 2 - 0.15, i * 0.1 - 0.04, bz + d / 2 + 0.38 + i * 0.07, 0.24, 0.05, 0.08, K.timber2);
    g.hip(0, lift + h, bz + 0.1, w + 0.3, d + 0.5, 0.32, era >= 7 ? 0x5f9a5a : K.tile, { over: 0.2, rows: 3, tint: era >= 7 ? 0 : 0.15 });
    if (era >= 7) solar(g, 0, lift + h + 0.18, bz - 0.1, 0.4, 0.3, 1);
    door(g, K, -0.25, bz + d / 2, 0.2, 0.32, acc, { lamp: true, tint: 0.3 });
    g.push();
    g.translate(0, lift, 0);
    g.pop();
    tree(g, -w / 2 - 0.2, bz + d / 2 + 0.3, 0, 1.2);
    return { stilts: true, base: null };
  }
  // vale: flat-roofed block, a cantilevered upper floor, timber cladding
  const w = 1.25 + lv * 0.1,
    d = 0.98,
    bz = -0.12;
  plinth(g, K, 0, bz, w, d);
  g.box(0, 0, bz, w, FH, d, K.wall);
  if (era >= 6) glassFront(g, K, -0.1, 0, bz, w * 0.6, d, FH, frame);
  else g.box(-0.1, 0.13, bz + d / 2 + 0.012, w * 0.55, 0.16, 0.02, K.glass, { glow: 1 });
  bands(g, K, 0, 0, bz, w, d, 1, FH, { k: 0.32 });
  let y = FH;
  for (let f = 1; f < floors; f++) {
    const ox = f % 2 ? 0.14 : 0;
    const uw = w * 0.9,
      ud = d + 0.08;
    g.box(ox, y, bz - 0.02, uw, FH, ud, era >= 7 ? K.wall : K.wall2);
    if (era < 7) {
      const nb = Math.round(uw / 0.1);
      for (let i = 1; i < nb; i++) g.box(ox - uw / 2 + (uw * i) / nb, y, bz - 0.02 + ud / 2 + 0.008, 0.01, FH, 0.012, shade(K.wall2, 0.82), { noTop: true });
    }
    if (era >= 6) glassFront(g, K, ox + 0.1, y, bz - 0.02, uw * 0.5, ud, FH, frame);
    else g.box(ox, y + 0.13, bz - 0.02 + ud / 2 + 0.014, uw * 0.7, 0.16, 0.02, K.glass, { glow: 1 });
    bands(g, K, ox, y, bz - 0.02, uw, ud, 1, FH, { k: 0.3 });
    y += FH;
  }
  // a thin roof slab with a deep overhang
  g.box(floors > 1 ? 0.07 : 0, y, bz, w + 0.22, 0.05, d + 0.22, shade(K.wall2, 0.75), { top: roofTop });
  if (era >= 7) {
    solar(g, -w * 0.2, y + 0.05, bz - 0.05, 0.36, 0.5, 2);
    tree(g, w * 0.28, bz + 0.1, y + 0.05, 0.9);
  } else g.box(w * 0.3, y + 0.05, bz - 0.2, 0.08, 0.22, 0.08, 0x5a5e64);
  door(g, K, w * 0.32, bz + d / 2, 0.2, 0.32, acc, { canopy: shade(K.wall2, 0.75), tint: 0.35 });
  hedge(g, -0.2, bz + d / 2 + 0.36, w * 0.6, 0.1);
  if (lv >= 2) tree(g, -w / 2 - 0.1, 0.72, 0, 1.1);
  return { base: { x: 0, z: bz, w: w + 0.08, d: d + 0.08 } };
}

// ---------------------------------------------------------------- halls
// The civic centre of a modern town: flags in front, a clock tower (vale),
// a dome (dune), a steep roof and spire (frost) or a great canopy (mire);
// a tower behind it at the third level.
export function eraHall(g, K, style, lv, era) {
  const acc = K.accent ?? K.trim;
  const frame = era >= 7 ? 0xf2f4f0 : era >= 6 ? 0x6e767e : shade(K.wall, 0.78);
  const roofTop = era >= 7 ? 0x5f9a5a : K.tile;
  const w = 2.3,
    d = 1.5,
    bz = 0.05;
  const h = 0.75 + lv * 0.18;
  // podium and steps
  g.box(0, -0.08, bz, w + 0.4, 0.16, d + 0.5, K.stone2);
  for (let i = 0; i < 3; i++) g.box(0, -0.06 + i * 0.04, bz + d / 2 + 0.28 - i * 0.06, 1.1, 0.04, 0.12, K.stone);
  g.box(0, 0.08, bz, w, h, d, K.wall);
  if (era >= 6) {
    glassFront(g, K, 0, 0.08, bz, w * 0.86, d, h - 0.12, frame);
    mullions(g, 0, 0.08, bz, w, d, h, 0.3, frame, 0.03);
  } else {
    // a colonnade of square piers before a recessed glass wall
    g.box(0, 0.12, bz + d / 2 + 0.005, w * 0.84, h - 0.2, 0.02, K.glass, { glow: 1 });
    for (let i = 0; i < 7; i++) g.box(-w * 0.42 + (i * w * 0.84) / 6, 0.08, bz + d / 2 + 0.08, 0.08, h - 0.04, 0.08, K.wall2);
    g.box(0, h + 0.04, bz + d / 2 + 0.06, w * 0.9, 0.05, 0.18, K.wall2);
  }
  bands(g, K, 0, 0.08, bz, w, d, Math.max(1, Math.round(h / FH)), h / Math.max(1, Math.round(h / FH)), { k: 0.4 });
  flatRoof(g, 0, h + 0.08, bz, w, d, K.wall2, roofTop, 0.08);
  sign(g, 0, h - 0.06, bz + d / 2 + 0.12, 0.9, 0.09);
  door(g, K, 0, bz + d / 2 + 0.01, 0.4, 0.36, K.glass, { canopy: acc });
  const top = h + 0.16;
  if (style === 'dune') {
    g.cyl(0, top, bz - 0.1, 0.48, 0.18, 16, K.wall2, {});
    g.dome(0, top + 0.18, bz - 0.1, 0.48, 16, 5, K.tile, { tint: 0.2, ribs: true });
    g.bead(0, top + 0.66, bz - 0.1, 0.05, K.trim);
    for (const sx of [-1, 1]) {
      g.box(sx * 1.0, top - 0.08, bz - 0.55, 0.22, 0.75, 0.22, K.wall);
      g.box(sx * 1.0, top + 0.5, bz - 0.55, 0.26, 0.06, 0.26, K.wall2);
    }
  } else if (style === 'frost') {
    g.gable(0, top - 0.08, bz - 0.1, w * 0.7, d * 0.7, 0.7, era >= 7 ? 0x6f8a4a : K.tile, { axis: 'z', over: 0.08, th: 0.05, gable: era >= 6 ? K.glass : K.wall2, rows: 5 });
    g.box(0.85, top - 0.08, bz - 0.5, 0.26, 0.9, 0.26, K.wall);
    g.cone(0.85, top + 0.82, bz - 0.5, 0.2, 0.75, 4, K.tile, { rot: Math.PI / 4 });
  } else if (style === 'mire') {
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ])
      g.box(sx * 1.05, top - 0.08, bz + sz * 0.6, 0.07, 0.35, 0.07, K.timber);
    g.hip(0, top + 0.27, bz, w + 0.3, d + 0.4, 0.4, era >= 7 ? 0x5f9a5a : K.tile, { over: 0.15, rows: 3, tint: 0.15 });
  } else {
    // a clock tower at one corner
    g.box(-0.95, 0.08, bz - 0.5, 0.34, h + 1.0, 0.34, K.wall2);
    for (const [x, z, ry] of [
      [-0.95, bz - 0.33 + 0.003, 0],
      [-0.78 + 0.003, bz - 0.5, Math.PI / 2],
    ])
      g.box(x, h + 0.75, z, 0.2, 0.2, 0.02, 0xf4f0e0, { glow: 0.6, ry });
    g.box(-0.95, h + 1.08, bz - 0.5, 0.4, 0.05, 0.4, frame);
    g.cyl(-0.95, h + 1.13, bz - 0.5, 0.02, 0.3, 4, frame, {});
  }
  // the third level: an office tower behind
  if (lv >= 3) {
    const tw = 1.0,
      td = 0.7,
      th = era >= 6 ? 2.0 : 1.5;
    g.box(0.35, top - 0.08, bz - 0.4, tw, th, td, era >= 6 ? K.glass : K.wall, { glow: era >= 6 ? 1 : 0, top: frame });
    if (era >= 6) mullions(g, 0.35, top - 0.08, bz - 0.4, tw, td, th, 0.16, frame, 0.025);
    else bands(g, K, 0.35, top - 0.08, bz - 0.4, tw, td, Math.round(th / FH), FH, { k: 0.45 });
    if (era >= 7) g.box(0.35, top - 0.08 + th, bz - 0.4, tw - 0.04, 0.04, td - 0.04, 0x5f9a5a);
  }
  if (era >= 7) {
    for (const x of [-1.25, 1.25]) tree(g, x, bz + d / 2 + 0.3, 0, 1.3);
    g.box(0, h + 0.06, bz + d / 2 + 0.005, w * 0.9, 0.025, 0.02, 0x7fe8f0, { glow: 4 });
  }
  return { base: { x: 0, z: bz, w: w + 0.4, d: d + 0.5 } };
}
