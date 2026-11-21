import { shade, mix } from './geom.js';
import { bands, mullions, flatRoof, tree, door, sign, chimneyStack, vault } from './modernModels.js';

// The common buildings of the Industrial to Future eras (4-7), so that a
// whole realm reads as its era at mid zoom, not only its capital:
//   Industrial (4) brick terraces with white trim, slate roofs and smoking
//                  chimney stacks; brick workshop-factories with saw-tooth roofs
//   Modern (5)     concrete and render, flat roofs, ribbon windows
//   Atomic (6)     glass and steel: curtain fronts between steel frames
//   Future (7)     white walls and green terraces, planted roofs, solar panels
// Each culture keeps its own colours (eraPalette K) and a roof of its own in
// the Industrial era. Heritage buildings never come here: they keep the
// look of the era they were built in (BuildingRenderer lookEra).
// K is the era palette (archetypes eraPalette), P the modern palette
// (modernModels modernPalette: concrete, steel, glass, brick, accent).

const LEAF = 0x4f8a44;
const GREEN = 0x5f9a5a;

// a planted edge along the front and back of a floor (Future terraces)
export function planters(g, cx, y, cz, w, d) {
  for (const s of [1, -1]) g.box(cx, y, cz + s * (d / 2 + 0.05), w, 0.09, 0.1, LEAF, { jit: 0.2 });
  g.box(cx + w / 2 + 0.05, y, cz, 0.1, 0.09, d, LEAF, { jit: 0.2 });
}
function sash(g, K, x, y, z, s, trim) {
  // a tall sash window with a white lintel and sill, on the face at z (side s)
  g.box(x, y, z + s * 0.012, 0.15, 0.22, 0.02, K.glass, { glow: 1 });
  g.box(x, y + 0.22, z + s * 0.022, 0.2, 0.035, 0.03, trim, { noTop: true });
  g.box(x, y - 0.025, z + s * 0.022, 0.18, 0.025, 0.035, trim, { noTop: true });
}
function stack(g, x, y0, z, h, brick, pot, rate) {
  // a square brick stack with clay pots and smoke
  g.box(x, y0, z, 0.16, h, 0.2, brick);
  g.box(x, y0 + h, z, 0.19, 0.04, 0.23, shade(brick, 0.75));
  for (const dz of [-0.05, 0.05]) g.cyl(x, y0 + h + 0.04, z + dz, 0.028, 0.08, 6, pot, {});
  if (rate > 0) g.anchor('chimneys', x, y0 + h + 0.14, z, { rate });
}

// ---------------------------------------------------------------- Industrial homes
// A two-storey brick terrace (three at the top level): sash windows under
// white lintels, a string course, two chimney stacks; the roof is the
// culture's own: a slate gable (vale), a parapet flat roof and iron balcony
// (dune), a steep slate roof with dormers (frost), a red tin hip roof over an
// iron veranda on a raised plinth (mire).
export function industrialHouse(g, K, style, lv) {
  // a brick a shade brighter than the old timber, so the terraces read at mid zoom
  const brick = shade(K.wall, 1.12),
    trim = K.trim ?? 0xe8e0cc,
    slate = K.tile;
  const floors = lv >= 3 ? 3 : 2;
  const fh = 0.36;
  const w = 1.42 + lv * 0.06,
    d = 0.9,
    bz = -0.12;
  const lift = style === 'mire' ? 0.16 : 0.04;
  const h = floors * fh;
  g.box(0, -0.1, bz, w + 0.1, lift + 0.12, d + 0.1, K.stone2);
  g.box(0, lift, bz, w, h, d, brick);
  // a darker brick base course and a white string course at each floor
  g.box(0, lift, bz, w + 0.02, 0.08, d + 0.02, shade(brick, 0.78), { noTop: true });
  for (let f = 1; f < floors; f++) g.box(0, lift + f * fh - 0.025, bz, w + 0.03, 0.05, d + 0.03, trim, { noTop: true });
  // a white eaves cornice and corner quoins
  g.box(0, lift + floors * fh - 0.06, bz, w + 0.05, 0.06, d + 0.05, trim, { noTop: true });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.box(sx * (w / 2 - 0.02), lift, bz + sz * (d / 2 - 0.02), 0.07, floors * fh, 0.07, trim, { noTop: true });
  // the terrace party walls: shallow pilasters splitting it in two homes
  for (const x of [-w / 2 + 0.02, 0, w / 2 - 0.02]) g.box(x, lift, bz + d / 2 + 0.01, 0.06, h, 0.03, shade(brick, 0.86), { noTop: true });
  const nWin = 4;
  for (let f = 0; f < floors; f++)
    for (let i = 0; i < nWin; i++) {
      const x = -w / 2 + (w * (i + 0.5)) / nWin;
      if (f === 0 && (i === 0 || i === 2)) continue; // the two front doors
      sash(g, K, x, lift + f * fh + 0.08, bz + d / 2, 1, trim);
      sash(g, K, x, lift + f * fh + 0.08, bz - d / 2, -1, trim);
    }
  for (const i of [0, 2]) {
    const x = -w / 2 + (w * (i + 0.5)) / nWin;
    door(g, K, x, bz + d / 2, 0.16, 0.28, K.door ?? K.accent ?? 0x2f4a3a, { tint: 0.4 });
    g.box(x, lift + 0.3, bz + d / 2 + 0.03, 0.2, 0.04, 0.05, trim, { noTop: true });
    g.box(x, -0.04, bz + d / 2 + 0.08, 0.22, lift + 0.02, 0.1, K.stone);
  }
  const top = lift + h;
  let rh = 0.42;
  if (style === 'dune') {
    // a flat roof behind a parapet with a cornice; an iron balcony in front
    rh = 0.1;
    g.box(0, top, bz, w + 0.08, 0.05, d + 0.08, trim, { top: shade(K.wall2 ?? brick, 0.8) });
    for (const s of [1, -1]) g.box(0, top + 0.05, bz + s * (d / 2 + 0.02), w + 0.08, 0.1, 0.04, brick);
    for (const s of [1, -1]) g.box(s * (w / 2 + 0.02), top + 0.05, bz, 0.04, 0.1, d, brick);
    g.box(0, lift + fh - 0.02, bz + d / 2 + 0.1, w * 0.7, 0.03, 0.2, 0x34373c);
    g.box(0, lift + fh + 0.01, bz + d / 2 + 0.2, w * 0.7, 0.12, 0.012, 0x34373c, { noTop: true });
    g.box(w * 0.25, top + 0.05, bz - 0.15, 0.3, 0.16, 0.22, K.wall2 ?? brick);
  } else if (style === 'frost') {
    rh = 0.66;
    g.gable(0, top, bz, w, d, rh, slate, { over: 0.1, th: 0.05, gable: brick, rows: 6 });
    // dormers on the front slope
    for (const x of [-w * 0.25, w * 0.25]) {
      g.box(x, top + 0.04, bz + d * 0.22, 0.22, 0.22, 0.2, brick);
      g.box(x, top + 0.1, bz + d * 0.22 + 0.105, 0.12, 0.12, 0.02, K.glass, { glow: 1 });
      g.gable(x, top + 0.26, bz + d * 0.22, 0.26, 0.24, 0.12, slate, { axis: 'z', over: 0.03, th: 0.03, gable: trim, rows: 2 });
    }
  } else if (style === 'mire') {
    // galvanized corrugated iron, not the old red tile, so it reads as the
    // new era at mid zoom (the red stays on the veranda roof)
    rh = 0.3;
    g.hip(0, top, bz, w + 0.12, d + 0.12, rh, 0x8e979e, { over: 0.08, rows: 6 });
    // an iron veranda along the front
    for (let i = 0; i < 5; i++) g.box(-w / 2 + (w * i) / 4, 0, bz + d / 2 + 0.26, 0.03, lift + fh, 0.03, 0x34373c);
    g.box(0, lift + fh, bz + d / 2 + 0.15, w + 0.06, 0.03, 0.3, shade(slate, 0.85), { top: slate });
    g.box(0, lift + 0.02, bz + d / 2 + 0.26, w, 0.1, 0.012, 0x34373c, { noTop: true });
  } else {
    g.gable(0, top, bz, w, d, rh, slate, { over: 0.08, th: 0.05, gable: brick, rows: 5 });
    // a bay window on the ground floor
    if (lv >= 2) {
      g.box(w * 0.38, lift, bz + d / 2 + 0.08, 0.3, fh * 0.9, 0.16, brick);
      g.box(w * 0.38, lift + 0.08, bz + d / 2 + 0.165, 0.24, 0.2, 0.02, K.glass, { glow: 1 });
      g.box(w * 0.38, lift + fh * 0.9, bz + d / 2 + 0.08, 0.34, 0.04, 0.2, slate);
    }
  }
  // two chimney stacks on the party walls, one smoking
  const sy = style === 'dune' ? top : top + rh * 0.35;
  stack(g, -w / 2 + 0.14, sy, bz, rh * 0.65 + 0.32, shade(brick, 0.9), 0xb06a48, 0.8);
  stack(g, w / 2 - 0.14, sy, bz, rh * 0.65 + 0.32, shade(brick, 0.9), 0xb06a48, 0);
  // a yard wall behind
  g.box(0, 0, bz - d / 2 - 0.22, w, 0.16, 0.04, shade(brick, 0.85));
  return { base: { x: 0, z: bz, w: w + 0.1, d: d + 0.1 } };
}

// ---------------------------------------------------------------- civic buildings
// The era look for the common working buildings (workshop, granary, market
// and the rest) in eras 4-7. Footprint from the catalog design size.
export const ERA_CIVIC = new Set(['granary', 'workshop', 'market', 'barn', 'kiln', 'stables', 'bloomery', 'healer', 'library', 'barracks', 'foundry', 'smokehouse', 'lazaretto', 'firestation', 'academy']);

// the era's wall, tinted a third of the way to the culture's own colour
function walls(K, P, era) {
  if (era < 5) return K.wall;
  // (Modern: a light render with a trace of the culture's own wall colour;
  // dark timber cultures turned it a dull brown-grey)
  return mix(era >= 7 ? 0xf0f2ec : era >= 6 ? 0xd4d9de : 0xe2dccf, K.wall, era === 5 ? 0.2 : 0.32);
}
// The roof of a culture in eras 5-7, so a street of civic blocks is told
// apart by culture at mid zoom: vale a flat roof with a plant room; frost a
// low metal gable; dune a thick white parapet round a small dome; mire a
// thin slab with deep eaves on slim posts. Future roofs are planted.
function cultureRoof(g, K, P, era, style, cx, h, cz, w, d, wc) {
  const green = era >= 7;
  if (style === 'frost') {
    const rh = Math.min(0.3, d * 0.28);
    g.gable(cx, h, cz, w, d, rh, green ? GREEN : shade(K.tile, 1.05), { over: 0.07, th: 0.04, gable: wc, rows: 3 });
    if (green) {
      g.push();
      g.translate(cx, h + rh * 0.55, cz - d * 0.22);
      g.rotateX(-Math.atan2(rh, d / 2));
      g.box(0, 0, 0, w * 0.7, 0.02, d * 0.3, 0x23324a, { top: 0x2f4a78 });
      g.pop();
    }
    return rh;
  }
  if (style === 'dune') {
    flatRoof(g, cx, h, cz, w, d, K.trim ?? 0xf0e8d8, green ? GREEN : shade(wc, 0.85), 0.12);
    g.dome(cx + w * 0.22, h + 0.06, cz, Math.min(0.2, w * 0.16), 10, 3, K.accent ?? P.accent, {});
    return 0.14;
  }
  if (style === 'mire') {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.box(cx + sx * (w / 2 + 0.1), 0, cz + sz * (d / 2 + 0.1), 0.035, h + 0.02, 0.035, shade(wc, 0.7));
    g.box(cx, h + 0.02, cz, w + 0.36, 0.06, d + 0.36, shade(K.wall2 ?? wc, 0.72), { top: green ? GREEN : K.tile });
    return 0.08;
  }
  return 0;
}
// a plain block of the era: brick under a slate gable with arched windows
// (4), concrete with ribbon windows under a flat roof (5), glass and steel
// (6), white with a planted roof and solar panels (7)
function eraBlock(g, K, P, era, cx, cz, w, d, floors, o = {}) {
  const fh = 0.38;
  const h = floors * fh;
  const wc = o.wall ?? walls(K, P, era);
  g.box(cx, 0, cz, w, h, d, wc);
  if (era === 4) {
    const n = Math.max(2, Math.round(w / 0.3));
    for (let f = 0; f < floors; f++)
      for (let i = 0; i < n; i++) {
        const x = cx - w / 2 + (w * (i + 0.5)) / n;
        for (const s of [1, -1]) {
          g.box(x, f * fh + 0.08, cz + s * (d / 2 + 0.012), 0.14, 0.2, 0.02, K.glass, { glow: 1 });
          g.cyl(x, f * fh + 0.28, cz + s * (d / 2 + 0.012), 0.07, 0.02, 6, K.trim ?? 0xe8e0cc, { cap: false });
        }
      }
    for (let f = 1; f < floors; f++) g.box(cx, f * fh - 0.02, cz, w + 0.03, 0.03, d + 0.03, K.trim ?? 0xe8e0cc, { noTop: true });
    if (!o.noRoof) g.gable(cx, h, cz, w, d, Math.min(0.5, d * 0.4), K.tile, { over: 0.08, th: 0.05, gable: wc, rows: 4 });
    return h + (o.noRoof ? 0 : Math.min(0.5, d * 0.4));
  }
  if (era === 5) {
    bands(g, P, cx, 0.02, cz, w, d, floors, fh, { k: 0.42 });
    mullions(g, cx, 0, cz, w, d, h, 0.42, shade(wc, 0.75), 0.03);
  } else if (era === 6) {
    g.box(cx, 0.03, cz + d / 2 + 0.012, w - 0.06, h - 0.06, 0.02, P.glass, { glow: 1 });
    bands(g, P, cx, 0.02, cz, w, d, floors, fh, { k: 0.6 });
    mullions(g, cx, 0, cz, w, d, h, 0.22, P.frame, 0.025);
  } else {
    bands(g, P, cx, 0.02, cz, w, d, floors, fh, { k: 0.5 });
    for (let f = 1; f <= floors; f++) planters(g, cx, f * fh - 0.04, cz, w - 0.04, d);
  }
  if (!o.noRoof && o.style && o.style !== 'vale') return h + cultureRoof(g, K, P, era, o.style, cx, h, cz, w, d, wc);
  if (!o.noRoof) {
    flatRoof(g, cx, h, cz, w, d, shade(wc, 0.8), era >= 7 ? GREEN : era >= 6 ? 0x60707e : 0x5c6066, 0.06);
    if (era >= 7) {
      g.push();
      g.translate(cx - w * 0.2, h + 0.1, cz - d * 0.1);
      g.rotateX(-0.4);
      g.box(0, 0, 0, Math.min(0.5, w * 0.35), 0.02, Math.min(0.4, d * 0.4), 0x23324a, { top: 0x2f4a78 });
      g.pop();
    } else g.box(cx + w * 0.25, h + 0.04, cz - d * 0.15, Math.min(0.3, w * 0.25), 0.14, Math.min(0.24, d * 0.25), P.steel);
  }
  return h + 0.06;
}

function sawtooth(g, K, P, era, x0, x1, z0, z1, y, teeth, th, wallC) {
  const tz = (z1 - z0) / teeth;
  const cx = (x0 + x1) / 2;
  const roofC = era >= 7 ? 0x23324a : era >= 6 ? 0x8a949c : era >= 5 ? 0x6a6e74 : K.tile;
  for (let i = 0; i < teeth; i++) {
    const za = z0 + i * tz,
      zb = za + tz;
    g.slab(x0 - 0.03, x1 + 0.03, za, y, zb, y + th, 0.035, roofC, { rows: 2, roofKind: era >= 7 ? 0 : 3 });
    g.quad([x0, y, zb], [x1, y, zb], [x1, y + th, zb], [x0, y + th, zb], P.glass, 0, 1, [cx, y, zb - 0.1]);
    for (const x of [x0, x1]) g.tri([x, y, za], [x, y, zb], [x, y + th, zb], wallC, 0, 0, [cx, y, (za + zb) / 2]);
  }
}

export function eraCivic(g, K, P, type, style, lv, era, def) {
  const dw = def?.dw ?? def?.w ?? 2,
    dh = def?.dh ?? def?.h ?? 2;
  const wc = walls(K, P, era);
  const acc = P.accent;
  if (type === 'workshop' || type === 'foundry' || type === 'bloomery' || type === 'kiln') {
    // the workshop-factory: a saw-tooth shed and a chimney
    const big = dw >= 2;
    const w = dw * 0.82,
      d = dh * 0.7,
      bz = -dh * 0.06;
    const h = big ? 0.5 + (lv - 1) * 0.12 : 0.42;
    g.box(0, -0.06, bz, w + 0.08, 0.1, d + 0.08, P.concrete2);
    eraBlock(g, K, P, era, 0, bz, w, d, 1, { noRoof: true, wall: era === 4 ? K.wall : wc });
    g.box(0, h - 0.38, bz, w, 0.38 + (h - 0.38), d, era === 4 ? K.wall : wc, { noTop: true });
    sawtooth(g, K, P, era, -w / 2, w / 2, bz - d / 2, bz + d / 2, h, big ? 3 : 2, 0.24, era === 4 ? K.wall : wc);
    // big doors to the yard
    g.box(-w * 0.18, 0, bz + d / 2 + 0.012, 0.36, 0.34, 0.02, era >= 6 ? P.steel2 : 0x5a4a3a);
    if (era <= 5) chimneyStack(g, P, w / 2 - 0.2, bz - d / 2 + 0.18, 0, big ? 1.55 : 1.15, big ? 0.11 : 0.08, era === 4 ? P.brick2 : P.concrete, { rate: era === 4 ? 1.4 : 0.9, bands: era === 4 ? P.dark : P.red });
    else if (era === 6) for (const x of [-w * 0.2, w * 0.2]) g.cyl(x, h + 0.24, bz, 0.07, 0.16, 8, P.steel, {});
    sign(g, w * 0.2, h - 0.12, bz + d / 2 + 0.02, Math.min(0.6, w * 0.4));
    if (era >= 7) tree(g, w / 2 + 0.1, bz + d / 2 + 0.2, 0, 1.0);
    return { base: { x: 0, z: bz, w: w + 0.08, d: d + 0.08 } };
  }
  if (type === 'granary' || type === 'barn') {
    // a store block with silos and an elevator tower (or a brick warehouse
    // with a hoist and iron bins in the Industrial era)
    const w = dw * 0.5,
      d = dh * 0.7,
      bx = -dw * 0.18;
    g.box(0, -0.06, 0, dw * 0.9, 0.1, dh * 0.78, P.concrete2);
    const bh = eraBlock(g, K, P, era, bx, 0, w, d, era === 4 ? 2 : 1, { style });
    const siloC = era >= 7 ? 0xeef0ea : era >= 6 ? 0xc8ced4 : era >= 5 ? 0xbab4a8 : 0x8a9096;
    const sh = era === 4 ? 0.9 : 1.35 + (era - 5) * 0.15;
    const r = era === 4 ? 0.2 : 0.24;
    const n = era === 4 ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const z = -d / 2 + r + (i * (d - 2 * r)) / Math.max(1, n - 1);
      const x = bx + w / 2 + r + 0.06;
      g.cyl(x, 0, z, r, sh, 12, siloC, { cap: false });
      if (era === 4) g.cone(x, sh, z, r + 0.02, 0.18, 10, 0x6a6e74, {});
      else g.dome(x, sh, z, r, 10, 3, era >= 7 ? GREEN : shade(siloC, 0.85), {});
      for (const t of [0.3, 0.65]) g.cyl(x, sh * t, z, r + 0.008, 0.03, 12, shade(siloC, 0.8), { cap: false });
    }
    if (era >= 5) {
      // the elevator tower and its chute
      const tx = bx + w / 2 + 0.08;
      g.box(tx, 0, -d / 2 - 0.08, 0.2, sh + 0.35, 0.2, era >= 7 ? 0xf2f4f0 : wc);
      g.box(tx, sh + 0.1, -d / 2 - 0.08, 0.22, 0.12, 0.22, P.glass, { glow: 1, noTop: true });
      g.beam(tx, sh + 0.2, -d / 2, tx + 0.3, sh, 0.0, 0.03, P.steel);
    } else {
      g.box(bx, bh - 0.1, d / 2 + 0.05, 0.16, 0.06, 0.3, 0x34373c);
      g.box(bx, bh - 0.55, d / 2 + 0.012, 0.22, 0.3, 0.02, 0x5a4a3a);
    }
    door(g, K, bx, d / 2, 0.3, 0.32, era >= 6 ? P.steel2 : acc, { canopy: era >= 5 ? acc : null });
    return { base: { x: 0, z: 0, w: dw * 0.9, d: dh * 0.78 } };
  }
  if (type === 'market') {
    const w = dw * 0.78,
      d = dh * 0.66,
      bz = -dh * 0.06;
    g.box(0, -0.06, bz + 0.1, dw * 0.9, 0.08, dh * 0.86, P.concrete2);
    if (era === 4) {
      // an iron-and-glass arcade: a glass barrel vault on iron columns
      g.box(0, 0, bz, w, 0.62, d * 0.8, K.wall);
      for (let i = 0; i < 6; i++) {
        const x = -w / 2 + (w * (i + 0.5)) / 6;
        g.box(x, 0.06, bz + d * 0.4 + 0.012, 0.22, 0.38, 0.02, K.glass, { glow: 1 });
        g.cyl(x, 0.44, bz + d * 0.4 + 0.012, 0.11, 0.02, 8, K.glass, { glow: 1, cap: false });
      }
      vault(g, 0, 0.62, bz, w + 0.1, d * 0.42, K.glass, { glow: 1 });
      for (let i = 0; i <= 6; i++) g.box(-w / 2 + (w * i) / 6, 0.62, bz, 0.03, 0.4, d * 0.86, 0x34373c, { noTop: true });
      g.box(0, 0, bz + d * 0.4 + 0.2, w, 0.03, 0.04, 0x34373c);
      g.gable(0, 0.62, bz + d * 0.4 - 0.05, 0.7, 0.2, 0.32, K.tile, { axis: 'z', over: 0.02, th: 0.04, gable: K.trim ?? 0xe8e0cc, rows: 2 });
      g.box(0, 0.8, bz + d * 0.4 + 0.06, 0.18, 0.18, 0.02, 0xf4f0e0, { glow: 0.6 });
      door(g, K, 0, bz + d * 0.4, 0.34, 0.4, K.door ?? acc, {});
    } else {
      const floors = era >= 6 ? 2 : 1 + (lv >= 2 ? 1 : 0);
      const h = eraBlock(g, K, P, era, 0, bz, w, d, floors, { style });
      // shop fronts with awnings in a row, a big sign over the door
      const n = 4;
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + (w * (i + 0.5)) / n;
        g.box(x, 0.04, bz + d / 2 + 0.014, w / n - 0.06, 0.26, 0.02, P.glass, { glow: 1 });
        g.slab(x - w / n / 2 + 0.03, x + w / n / 2 - 0.03, bz + d / 2, 0.36, bz + d / 2 + 0.2, 0.3, 0.02, i % 2 ? acc : 0xf2efe6, { tint: i % 2 ? 0.3 : 0 });
      }
      sign(g, 0, Math.min(h - 0.12, 0.62), bz + d / 2 + 0.03, w * 0.6, 0.12);
      if (era >= 6) g.box(0, h, bz + d / 2 - 0.2, w * 0.5, 0.14, 0.04, acc, { tint: 0.3 });
      if (era >= 7) for (const x of [-w / 2 - 0.15, w / 2 + 0.15]) tree(g, x, bz + d / 2 + 0.3, 0, 1.2);
    }
    return { base: { x: 0, z: bz, w: w + 0.1, d: d + 0.1 } };
  }
  // the rest (stables, healer, library, barracks): a block of the era with a
  // door and a sign; tall chimneys only in the Industrial era
  const w = Math.max(0.7, dw * 0.8),
    d = Math.max(0.6, dh * 0.72),
    bz = -dh * 0.04;
  const floors = Math.max(1, Math.min(3, Math.round(Math.min(dw, dh) * 0.8) + (lv - 1)));
  g.box(0, -0.06, bz, w + 0.06, 0.1, d + 0.06, P.concrete2);
  const h = eraBlock(g, K, P, era, 0, bz, w, d, floors, { style });
  if (era === 4) stack(g, w / 2 - 0.15, h - 0.35, bz - 0.05, 0.6, shade(K.wall, 0.9), 0xb06a48, 0.6);
  door(g, K, 0, bz + d / 2, Math.min(0.3, w * 0.3), 0.3, era >= 6 ? P.glass : acc, { canopy: era >= 5 ? acc : null });
  sign(g, 0, Math.min(floors * 0.38 - 0.08, 0.5), bz + d / 2 + 0.02, Math.min(0.8, w * 0.6));
  if (type === 'firestation') {
    // red engine doors and a hose-drying tower
    for (const x of [-w * 0.22, w * 0.22]) g.box(x, 0, bz + d / 2 + 0.014, Math.min(0.32, w * 0.3), 0.3, 0.02, 0xb8322a);
    g.box(-w / 2 + 0.12, 0, bz - d / 2 + 0.12, 0.2, h + 0.5, 0.2, era === 4 ? K.wall : wc);
    g.box(-w / 2 + 0.12, h + 0.36, bz - d / 2 + 0.12, 0.22, 0.1, 0.22, 0xb8322a);
  }
  if (type === 'healer') g.box(w * 0.3, Math.min(floors * 0.38 - 0.2, 0.5), bz + d / 2 + 0.03, 0.14, 0.14, 0.02, 0xd8382c, { glow: 0.5 });
  return { base: { x: 0, z: bz, w: w + 0.06, d: d + 0.06 } };
}
