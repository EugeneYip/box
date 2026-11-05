import * as THREE from 'three';
import { FLORA } from '../../world/constants.js';
import { MeshBuilder, MAT, C, mix3, mul3, clamp01, smooth, blobGeo, tubeGeo, bezier, M, V } from './MeshBuilder.js';

// Hand-tuned procedural models for every FLORA id. Each species has 3-4
// variants; trees also get a cheaper LOD1 with the same silhouette that is used
// for distant chunks. Units: one tile = 1 world unit, Y up, origin at the base.

const TAU = Math.PI * 2;
const _d = new THREE.Vector3();
const hashV = (p) => {
  const s = Math.sin(p.x * 127.1 + p.y * 311.7 + p.z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

// ---------------------------------------------------------------------------
// Shared painters

// Canopy shading baked into vertex colours: darker inside and underneath,
// sun-kissed on top, with per-facet painterly jitter.
function foliageColor(p, n, fc, pal, yMin, yMax, cc, o) {
  const h = clamp01((p.y - yMin) / (yMax - yMin + 1e-6));
  _d.subVectors(p, cc);
  const dl = _d.length() || 1;
  const expo = (n.x * _d.x + n.y * _d.y * 0.6 + n.z * _d.z) / dl;
  let c = mix3(pal.dark, pal.mid, smooth(0.0, 0.6, h));
  c = mix3(c, pal.light, smooth(0.35, 1.0, h) * clamp01(0.3 + 0.7 * n.y));
  const ao = (o.aoMin ?? 0.5) + (1 - (o.aoMin ?? 0.5)) * clamp01(expo * 0.8 + 0.4);
  const under = n.y < 0 ? 1 + n.y * 0.28 : 1;
  const j = 0.9 + 0.2 * hashV(fc);
  c = mul3(c, ao * under * j);
  if (pal.hi) c = mix3(c, pal.hi, clamp01((n.y - 0.5) * 2) * smooth(0.5, 1, h) * 0.55);
  return c;
}

// blobs: [{p, r, d, sq, lump, fb}]
function foliage(b, blobs, pal, o = {}) {
  let yMin = Infinity,
    yMax = -Infinity,
    wsum = 0;
  const cc = V();
  for (const bl of blobs) {
    const sq = bl.sq ?? 1;
    yMin = Math.min(yMin, bl.p.y - bl.r * sq);
    yMax = Math.max(yMax, bl.p.y + bl.r * sq);
    cc.addScaledVector(bl.p, bl.r * bl.r);
    wsum += bl.r * bl.r;
  }
  cc.multiplyScalar(1 / wsum);
  if (o.center) cc.copy(o.center);
  for (const bl of blobs) {
    const geo = blobGeo(b, bl.r, bl.d ?? 1, { lump: bl.lump ?? o.lump ?? 0.2, squash: bl.sq ?? 1, freq: o.freq ?? 1.6, flatBottom: bl.fb ?? 0 });
    b.add(geo, {
      matrix: M(bl.p.x, bl.p.y, bl.p.z, 0, b.r(0, TAU), 0),
      normals: 'blend',
      blend: o.smooth ?? 0.6,
      center: bl.p,
      leaf: o.leaf ?? 1,
      flutter: o.flutter ?? 1,
      mat: o.mat ?? MAT.LEAF,
      pivot: o.pivot || bl.p,
      color: (p, n, fc) => foliageColor(p, n, fc, bl.pal || pal, yMin, yMax, cc, o),
    });
    geo.dispose();
  }
  return { yMin, yMax, cc };
}

function barkColor(pal, yTop, o = {}) {
  return (p, n, fc) => {
    const t = clamp01(p.y / yTop);
    let c = mix3(pal.base, pal.top, t);
    const ground = 0.62 + 0.38 * smooth(0, 0.3, p.y);
    const j = 0.88 + 0.24 * hashV(fc);
    const side = 0.85 + 0.15 * clamp01(n.y * 0.5 + 0.5);
    c = mul3(c, ground * j * side);
    if (o.moss && n.y > -0.2) c = mix3(c, o.moss, clamp01(0.6 - p.y * 1.5) * 0.6 * clamp01(hashV(fc) * 1.4));
    return c;
  };
}

// Tapered bent limb from a to b.
function limb(b, a, z, r0, r1, sides, pal, yTop, o = {}) {
  const bendAmt = o.bend ?? 0.12;
  const mid = a.clone().lerp(z, 0.5).add(V(b.r(-bendAmt, bendAmt), bendAmt * 0.6, b.r(-bendAmt, bendAmt)));
  const path = bezier(a, mid, z, o.segs ?? 3);
  const radii = path.map((_, i) => r0 + (r1 - r0) * (i / (path.length - 1)));
  b.add(tubeGeo(path, radii, sides, { capTop: true }), {
    normals: 'geoblend',
    blend: 0.75,
    color: barkColor(pal, yTop, o),
    mat: MAT.WOOD,
    flutter: o.flutter ?? 0,
  });
  return path;
}

// Main trunk along a gently curved path, with an optional root flare.
function trunk(b, pts, radii, sides, pal, o = {}) {
  const yTop = o.yTop ?? pts[pts.length - 1].y;
  const flare = o.flare
    ? (i, s, a) => (i === 0 ? 1 + o.flare * (0.6 + 0.4 * Math.pow(Math.abs(Math.cos(a * (o.roots ?? 2))), 3)) : 1)
    : o.flareFn || null;
  b.add(tubeGeo(pts, radii, sides, { capTop: o.capTop ?? true, flare }), {
    normals: 'geoblend',
    blend: o.blend ?? 0.7,
    color: o.color || barkColor(pal, yTop, o),
    mat: MAT.WOOD,
    faceColor: !!o.faceColor,
  });
}

// ---------------------------------------------------------------------------
// Palettes (sRGB hex -> linear)
const P = {
  oakBark: { base: C(0x4a3424), top: C(0x7a5a3c) },
  oak: [
    { dark: C(0x214d1f), mid: C(0x3f8a2f), light: C(0x86c043), hi: C(0xc4df6a) },
    { dark: C(0x1f4a24), mid: C(0x3a8236), light: C(0x7ab845), hi: C(0xb8d865) },
    { dark: C(0x26511c), mid: C(0x4b922c), light: C(0x98c843), hi: C(0xd2e070) },
    { dark: C(0x22461f), mid: C(0x3e7d30), light: C(0x7fb34a), hi: C(0xb0d070) },
  ],
  birchBark: { base: C(0xcfc8bb), top: C(0xf2efe6) },
  birch: { dark: C(0x3f6f22), mid: C(0x78ae38), light: C(0xb4d655), hi: C(0xe6ef8a) },
  birchGold: { dark: C(0x7a5a16), mid: C(0xcc9a24), light: C(0xf0c84a), hi: C(0xfff0a0) },
  pineBark: { base: C(0x4a2e1e), top: C(0x6e4630) },
  pine: { dark: C(0x163d2c), mid: C(0x2a6a45), light: C(0x4f9658), hi: C(0x86b86a) },
  pineB: { dark: C(0x173a33), mid: C(0x285f4c), light: C(0x478a63), hi: C(0x7aac78) },
  snow: { dark: C(0xbccbe0), mid: C(0xe4ecf6), light: C(0xfbfdff), hi: C(0xffffff) },
  palmBark: { base: C(0x7a5a36), top: C(0xa8885a) },
  palm: { dark: C(0x2a6a22), mid: C(0x4e9a2e), light: C(0x92c848), hi: C(0xcfe27a) },
  jungleBark: { base: C(0x4e3a28), top: C(0x77604a) },
  jungle: [
    { dark: C(0x0f4a26), mid: C(0x1f7f38), light: C(0x4fb048), hi: C(0x9ad460) },
    { dark: C(0x12462c), mid: C(0x23783f), light: C(0x56a84e), hi: C(0x9ccc62) },
  ],
  vine: { base: C(0x1f4f22), top: C(0x3f7a2e) },
  acaciaBark: { base: C(0x4a3c30), top: C(0x6e5a48) },
  acacia: { dark: C(0x3f5a22), mid: C(0x6f8c32), light: C(0xa4b84c), hi: C(0xd4d47a) },
  willowBark: { base: C(0x3c3428), top: C(0x5c5040) },
  willow: { dark: C(0x324d24), mid: C(0x5f7f38), light: C(0x94ae52), hi: C(0xc2cf7a) },
  deadBark: { base: C(0x3e352e), top: C(0x857869) },
  bush: [
    { dark: C(0x1d4a1f), mid: C(0x3a822f), light: C(0x7ab543), hi: C(0xb4d466) },
    { dark: C(0x1a4024), mid: C(0x2f6e34), light: C(0x5f9e48), hi: C(0x9ac468) },
    { dark: C(0x2a5a1c), mid: C(0x55962c), light: C(0x9ccc46), hi: C(0xd6e676) },
    { dark: C(0x22501e), mid: C(0x438a30), light: C(0x86ba4c), hi: C(0xc0d870) },
  ],
  berryLeaf: { dark: C(0x173e1e), mid: C(0x2c6a2e), light: C(0x5e9a44), hi: C(0x92bc62) },
  cactus: { dark: C(0x2a5a36), mid: C(0x45844a), light: C(0x78b060), hi: C(0xa8cc7a) },
  reeds: { base: C(0x3f6a2c), top: C(0xb4b860) },
  rock: { base: C(0x6a6660), top: C(0xa8a39a) },
  rockWarm: { base: C(0x7a6450), top: C(0xc0a888) },
  rockDark: { base: C(0x45484c), top: C(0x7a7c80) },
  moss: C(0x4f7a2a),
  mossLight: C(0x7aa040),
  lichen: C(0xc8b860),
  woodTop: C(0xc9a473),
  woodRing: C(0x8f6a44),
};

// ---------------------------------------------------------------------------
// TREES

function buildOak(b, v, lod) {
  const d = lod ? 0 : 1;
  const pal = P.oak[v];
  const lean = [V(0.04, 0, 0.02), V(-0.06, 0, 0.05), V(0.02, 0, -0.03), V(0.16, 0, 0.08)][v];
  const th = [0.95, 0.85, 1.15, 0.95][v];
  const sides = lod ? 5 : 7;
  const tTop = V(lean.x, th, lean.z);
  const pts = lod ? [V(0, 0, 0), tTop] : bezier(V(0, 0, 0), V(lean.x * 0.2, th * 0.5, lean.z * 0.2), tTop, 3);
  trunk(b, pts, pts.map((_, i) => 0.105 - (0.045 * i) / (pts.length - 1)), sides, P.oakBark, { flare: lod ? 0 : 0.5, roots: 2, yTop: 2 });
  let blobs;
  if (v === 0) {
    blobs = [
      { p: V(0, 1.55, 0), r: 0.54 },
      { p: V(0.36, 1.3, 0.1), r: 0.38 },
      { p: V(-0.22, 1.28, 0.3), r: 0.37 },
      { p: V(-0.18, 1.32, -0.32), r: 0.36 },
      { p: V(0.06, 1.94, -0.04), r: 0.33 },
    ];
  } else if (v === 1) {
    blobs = [
      { p: V(0, 1.42, 0), r: 0.46, sq: 0.85 },
      { p: V(0.5, 1.2, 0.08), r: 0.36, sq: 0.85 },
      { p: V(-0.44, 1.22, 0.22), r: 0.36, sq: 0.85 },
      { p: V(0.05, 1.18, -0.5), r: 0.34, sq: 0.85 },
      { p: V(0.12, 1.72, 0.05), r: 0.32 },
    ];
  } else if (v === 2) {
    blobs = [
      { p: V(0.0, 1.32, 0.0), r: 0.46 },
      { p: V(0.12, 1.75, 0.08), r: 0.44 },
      { p: V(-0.06, 2.15, -0.02), r: 0.34 },
      { p: V(-0.3, 1.5, -0.12), r: 0.3 },
      { p: V(0.3, 1.38, -0.2), r: 0.28 },
    ];
  } else {
    blobs = [
      { p: V(0.32, 1.55, 0.12), r: 0.5 },
      { p: V(-0.2, 1.42, -0.12), r: 0.4 },
      { p: V(0.62, 1.32, 0.3), r: 0.32 },
      { p: V(0.3, 1.95, 0.0), r: 0.32 },
      { p: V(-0.05, 1.2, 0.38), r: 0.28 },
    ];
  }
  if (lod) blobs = blobs.slice(0, 3).map((bl, i) => ({ ...bl, r: bl.r * (i === 0 ? 1.18 : 1.1) }));
  // branches into the main blobs
  if (!lod) {
    const n = v === 1 ? 4 : 3;
    for (let k = 1; k <= n && k < blobs.length; k++) {
      const bl = blobs[k];
      const from = tTop.clone().lerp(V(0, th * 0.75, 0), 0.4);
      const to = V(bl.p.x * 0.75, bl.p.y - bl.r * 0.35, bl.p.z * 0.75);
      limb(b, from, to, 0.05, 0.022, 5, P.oakBark, 2);
    }
    if (v === 3) limb(b, V(0.02, 0.8, 0), V(-0.42, 1.25, 0.1), 0.04, 0.012, 4, P.oakBark, 2, { bend: 0.06 });
  }
  foliage(b, blobs.map((bl) => ({ ...bl, d })), pal, { lump: 0.22 });
  return { bendScale: 1, height: 2.2 };
}

// Tiered pine cone layer: concave underside, jagged drooping rim.
function pineTier(b, y0, h, r, segs, pal, rot, o = {}) {
  const apex = V(0, y0 + h, 0);
  const mid = [],
    rim = [],
    inner = [];
  for (let s = 0; s < segs; s++) {
    const a = rot + (s / segs) * TAU;
    const jag = s % 2 === 0 ? 1.0 : 0.8;
    const rr = r * jag * (0.94 + 0.12 * b.rng());
    rim.push(V(Math.cos(a) * rr, y0 - (s % 2 === 0 ? 0.07 : 0.0) * r * 2 - b.r(0, 0.03), Math.sin(a) * rr));
    const am = a + (0.5 / segs) * TAU * 0;
    mid.push(V(Math.cos(am) * r * 0.62, y0 + h * 0.36, Math.sin(am) * r * 0.62));
    inner.push(V(Math.cos(a) * r * 0.3, y0 + h * 0.12, Math.sin(a) * r * 0.3));
  }
  const yMin = y0 - r * 0.2,
    yMax = y0 + h;
  const col = (p, n, fc) => {
    const t = clamp01((p.y - yMin) / (yMax - yMin));
    const radial = clamp01(Math.hypot(p.x, p.z) / r);
    let c = mix3(pal.dark, pal.mid, smooth(0, 0.5, t * 0.5 + radial * 0.6));
    c = mix3(c, pal.light, clamp01(radial * 1.1 - 0.35) * clamp01(n.y + 0.4));
    if (pal.hi) c = mix3(c, pal.hi, clamp01(n.y - 0.55) * radial * 0.6);
    const under = n.y < 0 ? 0.55 : 1;
    return mul3(c, under * (0.9 + 0.2 * hashV(fc)) * (o.shade ?? 1));
  };
  const piv = V(0, y0 + h * 0.3, 0);
  const add = (a, c2, d2, cl = col) => b.tri(a, c2, d2, [cl(a, _nUp, a), cl(c2, _nUp, a), cl(d2, _nUp, a)], { leaf: 1, flutter: 0.35, mat: MAT.LEAF, pivot: piv, single: true });
  // We compute per-vertex colours from a provisional normal; fix normals after.
  const start = b.count;
  for (let s = 0; s < segs; s++) {
    const s2 = (s + 1) % segs;
    // upper surface: apex -> mid -> rim
    add(apex, mid[s2], mid[s]);
    add(mid[s], mid[s2], rim[s2]);
    add(mid[s], rim[s2], rim[s]);
    // underside: rim -> inner (concave)
    add(rim[s], rim[s2], inner[s2]);
    add(rim[s], inner[s2], inner[s]);
  }
  // recolour with the real face normals and soften them toward the cone axis
  recolorRange(b, start, col, V(0, y0 + h * 0.2, 0), 0.35);
}
const _nUp = V(0, 1, 0);

// Recompute colours of builder verts [start, end) from their stored normals,
// optionally blending normals toward radial from `center`.
function recolorRange(b, start, col, center, blend = 0) {
  const p = V(),
    n = V(),
    fc = V(),
    rn = V();
  for (let k = start; k < b.count; k += 3) {
    fc.set(0, 0, 0);
    for (let j = 0; j < 3; j++) fc.x += b.pos[(k + j) * 3] / 3, fc.y += b.pos[(k + j) * 3 + 1] / 3, fc.z += b.pos[(k + j) * 3 + 2] / 3;
    for (let j = 0; j < 3; j++) {
      const q = (k + j) * 3;
      p.set(b.pos[q], b.pos[q + 1], b.pos[q + 2]);
      n.set(b.nrm[q], b.nrm[q + 1], b.nrm[q + 2]);
      if (blend > 0 && center) {
        rn.subVectors(p, center).normalize();
        if (n.dot(rn) < 0) rn.negate();
        n.lerp(rn, blend).normalize();
        b.nrm[q] = n.x;
        b.nrm[q + 1] = n.y;
        b.nrm[q + 2] = n.z;
      }
      const c = col(p, n, fc);
      b.col[q] = c[0];
      b.col[q + 1] = c[1];
      b.col[q + 2] = c[2];
    }
  }
}

function buildPine(b, v, lod, snowy = false) {
  const cfg = [
    { tiers: 5, R: 0.6, H: 2.7, base: 0.42 },
    { tiers: 6, R: 0.46, H: 3.05, base: 0.45 },
    { tiers: 4, R: 0.74, H: 2.35, base: 0.36 },
    { tiers: 4, R: 0.5, H: 2.2, base: 0.55 },
  ][v];
  const segs = lod ? 6 : v === 1 ? 8 : 9;
  const tiers = lod ? Math.max(2, cfg.tiers - 2) : cfg.tiers;
  const pal = v % 2 ? P.pineB : P.pine;
  trunk(b, [V(0, 0, 0), V(0, cfg.H * 0.55, 0)], [0.085, 0.05], lod ? 5 : 6, P.pineBark, { flare: lod ? 0 : 0.35, roots: 2, yTop: cfg.H });
  const span = cfg.H - cfg.base;
  for (let t = 0; t < tiers; t++) {
    const f = t / tiers;
    const y0 = cfg.base + span * Math.pow(f, 0.92) * 0.82;
    const r = cfg.R * (1 - f * 0.78) * (v === 3 && t % 2 ? 0.82 : 1);
    const h = Math.max(r * 1.35, (span / tiers) * 1.7);
    const rot = b.r(0, TAU);
    pineTier(b, y0, t === tiers - 1 ? h * 1.25 : h, r, segs, pal, rot, { shade: 0.86 + 0.14 * f });
    if (snowy) snowCap(b, y0, t === tiers - 1 ? h * 1.25 : h, r, segs, rot, lod);
  }
  return { bendScale: 0.8, height: cfg.H };
}

// Snow resting on the upper part of a pine tier with a dripping edge.
function snowCap(b, y0, h, r, segs, rot, lod) {
  const apex = V(0, y0 + h + 0.025, 0);
  const ring = [],
    drip = [];
  for (let s = 0; s < segs; s++) {
    const a = rot + (s / segs) * TAU;
    const rr = r * (s % 2 === 0 ? 0.9 : 0.72);
    const y = y0 + h * 0.36 - (s % 2 === 0 ? 0.05 : 0) + 0.035;
    ring.push(V(Math.cos(a) * r * 0.6, y0 + h * 0.4 + 0.03, Math.sin(a) * r * 0.6));
    drip.push(V(Math.cos(a) * rr, y - r * 0.12, Math.sin(a) * rr));
  }
  const pal = P.snow;
  const col = (p, n) => {
    let c = mix3(pal.dark, pal.light, clamp01(n.y * 0.9 + 0.1));
    return mul3(c, 0.96 + 0.06 * hashV(p));
  };
  const piv = V(0, y0 + h * 0.5, 0);
  const start = b.count;
  for (let s = 0; s < segs; s++) {
    const s2 = (s + 1) % segs;
    b.tri(apex, ring[s2], ring[s], [1, 1, 1], { leaf: 1, flutter: 0.3, mat: MAT.SNOW, pivot: piv, single: true });
    b.tri(ring[s], ring[s2], drip[s2], [1, 1, 1], { leaf: 1, flutter: 0.3, mat: MAT.SNOW, pivot: piv, single: true });
    b.tri(ring[s], drip[s2], drip[s], [1, 1, 1], { leaf: 1, flutter: 0.3, mat: MAT.SNOW, pivot: piv, single: true });
  }
  recolorRange(b, start, col, V(0, y0, 0), 0.45);
  if (false) {
    // a few lumps of snow on the tier
    for (let k = 0; k < 2; k++) {
      const a = rot + b.r(0, TAU);
      const rr = r * b.r(0.45, 0.7);
      const g = blobGeo(b, r * 0.16, 0, { lump: 0.25, squash: 0.55 });
      b.add(g, { matrix: M(Math.cos(a) * rr, y0 + h * (0.42 - rr / r * 0.3) + 0.04, Math.sin(a) * rr), normals: 'blend', blend: 0.6, color: col, mat: MAT.SNOW, leaf: 1, flutter: 0.3, pivot: piv });
    }
  }
}

function buildBirch(b, v, lod) {
  const H = [1.55, 1.75, 1.4, 1.6][v];
  const lean = [V(0.05, 0, 0.0), V(-0.04, 0, 0.06), V(0.08, 0, -0.06), V(-0.02, 0, -0.04)][v];
  const segs = lod ? 2 : 7;
  const pts = bezier(V(0, 0, 0), V(-lean.x * 0.6, H * 0.5, -lean.z * 0.6), V(lean.x, H, lean.z), segs);
  // bark: white with dark horizontal marks (per facet)
  const bark = (p, n, fc) => {
    const ring = Math.floor(fc.y * 11);
    const ang = Math.floor((Math.atan2(fc.z - lean.z * fc.y / H, fc.x - lean.x * fc.y / H) + Math.PI) / TAU * 6);
    const h1 = hashV(V(ring, ang, v));
    const dark = h1 < 0.24 || (fc.y < 0.12 && h1 < 0.6);
    let c = dark ? C(0x2e2a26) : mix3(P.birchBark.base, P.birchBark.top, clamp01(fc.y / H + 0.3));
    if (!dark && h1 > 0.85) c = mix3(c, C(0xb8a890), 0.5);
    const ground = 0.7 + 0.3 * smooth(0, 0.25, p.y);
    return mul3(c, ground * (0.9 + 0.12 * clamp01(n.y * 0.5 + 0.5)));
  };
  trunk(b, pts, pts.map((_, i) => 0.065 - (0.032 * i) / (pts.length - 1)), lod ? 5 : 6, null, { color: bark, faceColor: true, yTop: H });
  const pal = v === 3 ? P.birchGold : P.birch;
  const top = pts[pts.length - 1];
  let blobs = [
    { p: V(top.x, H + 0.05, top.z), r: 0.34 },
    { p: V(top.x + 0.2, H - 0.22, top.z + 0.08), r: 0.29 },
    { p: V(top.x - 0.17, H - 0.3, top.z - 0.12), r: 0.28 },
    { p: V(top.x + 0.02, H + 0.38, top.z - 0.03), r: 0.24 },
  ];
  if (v === 1) blobs.push({ p: V(top.x - 0.06, H - 0.55, top.z + 0.16), r: 0.22 });
  if (v === 2) blobs = blobs.slice(0, 4).map((bl) => ({ ...bl, r: bl.r * 1.12, p: bl.p.clone().multiply(V(1.15, 1, 1.15)) }));
  if (lod) blobs = [{ p: V(top.x, H - 0.05, top.z), r: 0.4, sq: 1.25 }, { p: V(top.x, H + 0.32, top.z), r: 0.26 }];
  if (!lod) {
    for (let k = 1; k < 4; k++) {
      const bl = blobs[k];
      const from = pts[Math.min(pts.length - 1, Math.floor(pts.length * 0.7))];
      limb(b, from, V(bl.p.x * 0.8, bl.p.y - 0.1, bl.p.z * 0.8), 0.022, 0.01, 4, { base: C(0xd8d2c4), top: C(0xe8e4da) }, H);
    }
  }
  foliage(b, blobs.map((bl) => ({ ...bl, d: lod ? 0 : 1, lump: 0.26 })), pal, { lump: 0.26, freq: 2.0 });
  return { bendScale: 1.25, height: H + 0.4 };
}

function buildPalm(b, v, lod) {
  const H = [2.4, 2.75, 2.1, 2.55][v];
  const leanX = [0.55, 0.35, 0.7, -0.4][v];
  const leanZ = [0.1, -0.25, 0.2, 0.3][v];
  const segs = lod ? 5 : 11;
  const pts = bezier(V(0, 0, 0), V(leanX * 0.05, H * 0.55, leanZ * 0.05), V(leanX, H, leanZ), segs);
  const radii = pts.map((_, i) => {
    const t = i / segs;
    const ring = lod ? 1 : i % 2 === 0 ? 1.12 : 0.94;
    return (0.1 - 0.035 * t) * ring;
  });
  const bark = (p, n, fc) => {
    const t = clamp01(p.y / H);
    const ring = Math.floor((fc.y / H) * segs * 1.0 + 0.5) % 2;
    let c = mix3(P.palmBark.base, P.palmBark.top, t);
    if (!lod && ring) c = mul3(c, 0.78);
    return mul3(c, (0.7 + 0.3 * smooth(0, 0.3, p.y)) * (0.9 + 0.15 * hashV(fc)));
  };
  trunk(b, pts, radii, lod ? 5 : 7, null, { color: bark, faceColor: true, flare: lod ? 0 : 0.35, roots: 3, yTop: H });
  const top = pts[segs].clone();
  const tdir = top.clone().sub(pts[segs - 1]).normalize();
  // crown knob
  const knob = blobGeo(b, 0.12, 0, { lump: 0.2 });
  b.add(knob, { matrix: M(top.x, top.y + 0.02, top.z), normals: 'blend', blend: 0.6, color: mix3(P.palm.dark, P.palmBark.base, 0.5), mat: MAT.LEAF, leaf: 1, flutter: 0.2 });
  // coconuts
  if (!lod) {
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU + v;
      const g = blobGeo(b, 0.065, 0, { lump: 0.1 });
      b.add(g, { matrix: M(top.x + Math.cos(a) * 0.09, top.y - 0.08, top.z + Math.sin(a) * 0.09), normals: 'blend', blend: 0.8, color: C(0x4a3018), mat: MAT.GLOSS, leaf: 1, flutter: 0.1 });
    }
  }
  const fronds = lod ? 6 : [8, 7, 9, 8][v];
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * TAU + b.r(-0.2, 0.2) + v;
    const len = b.r(0.95, 1.2) * (f % 2 ? 0.92 : 1);
    const up = f % 3 === 0 ? 0.42 : 0.22;
    frond(b, top, a, len, up, lod, tdir);
  }
  return { bendScale: 1.1, height: H + 0.3 };
}

// Feathery drooping palm frond with V fold and serrated leaflets.
function frond(b, base, ang, len, up, lod, tdir) {
  const dir = V(Math.cos(ang), 0, Math.sin(ang));
  const p0 = base.clone().add(V(0, 0.04, 0));
  const p1 = base.clone().addScaledVector(dir, len * 0.5).add(V(0, up + 0.12, 0));
  const p2 = base.clone().addScaledVector(dir, len).add(V(0, -len * 0.55 + up * 0.3, 0));
  const n = lod ? 4 : 9;
  const spine = bezier(p0, p1, p2, n);
  const side = V(-dir.z, 0, dir.x);
  const pal = P.palm;
  for (let i = 0; i < n; i++) {
    const t0 = i / n,
      t1 = (i + 1) / n;
    const w = (t) => 0.2 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.75) + 0.01;
    const serr = lod ? 1 : i % 2 ? 0.55 : 1.05;
    const s0 = spine[i],
      s1 = spine[i + 1];
    const w0 = w(t0) * (lod ? 1 : i % 2 ? 1.05 : 0.55),
      w1 = w(t1) * serr;
    const fold = 0.38;
    const l0 = s0.clone().addScaledVector(side, w0).add(V(0, w0 * fold, 0)).addScaledVector(dir, -0.02);
    const l1 = s1.clone().addScaledVector(side, w1).add(V(0, w1 * fold, 0)).addScaledVector(dir, -0.06 * w1);
    const r0 = s0.clone().addScaledVector(side, -w0).add(V(0, w0 * fold, 0)).addScaledVector(dir, -0.02);
    const r1 = s1.clone().addScaledVector(side, -w1).add(V(0, w1 * fold, 0)).addScaledVector(dir, -0.06 * w1);
    const cA = mix3(pal.dark, pal.mid, smooth(0, 0.5, t0));
    const cB = mix3(pal.mid, pal.light, smooth(0.2, 1, t1));
    const cEdge = mix3(pal.light, pal.hi, t1 * 0.6);
    const o = { leaf: 1, flutter: 0.6 + t0 * 0.9, mat: MAT.LEAF, pivot: p0, up: true, bend: NaN };
    b.tri(s0, l1, l0, [cA, cEdge, cB], o);
    b.tri(s0, s1, l1, [cA, cB, cEdge], o);
    b.tri(s0, r0, r1, [cA, cB, cEdge], o);
    b.tri(s0, r1, s1, [cA, cEdge, cB], o);
  }
}

function buildJungle(b, v, lod) {
  const H = [2.3, 2.6, 2.15, 2.45][v];
  const pal = P.jungle[v % 2];
  const lean = V(b.r(-0.1, 0.1), 0, b.r(-0.1, 0.1));
  const segs = lod ? 2 : 4;
  const pts = bezier(V(0, 0, 0), V(-lean.x, H * 0.45, -lean.z), V(lean.x, H * 0.82, lean.z), segs);
  const fins = (i, s, a) => {
    if (lod) return i === 0 ? 1.35 : 1;
    const t = i / segs;
    const fin = Math.pow(Math.abs(Math.cos(a * 2 + v)), 6);
    return 1 + (i === 0 ? 1.5 : i === 1 ? 0.35 : 0) * fin + (i === 0 ? 0.3 : 0) - t * 0;
  };
  trunk(b, pts, pts.map((_, i) => 0.12 - (0.06 * i) / segs), lod ? 6 : 8, P.jungleBark, { flareFn: fins, yTop: H, moss: P.moss });
  const top = pts[segs];
  // canopy: broad, layered, flattened
  let blobs = [];
  const layers = v === 1 ? 3 : 2;
  const rad = [0.62, 0.55, 0.7, 0.6][v];
  for (let L = 0; L < layers; L++) {
    const y = H * 0.82 + 0.18 + L * 0.32;
    const n = L === layers - 1 ? (layers === 3 ? 1 : 2) : 4;
    const rr = rad * (L === layers - 1 ? 0.3 : 1);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + L * 0.7 + v;
      blobs.push({ p: V(top.x + Math.cos(a) * rr, y + b.r(-0.05, 0.05), top.z + Math.sin(a) * rr), r: L === layers - 1 ? 0.44 : 0.46, sq: 0.62 });
    }
  }
  if (lod) blobs = [{ p: V(top.x, H * 0.82 + 0.25, top.z), r: rad + 0.4, sq: 0.5 }, { p: V(top.x, H * 0.82 + 0.6, top.z), r: 0.45, sq: 0.6 }];
  // limbs to the outer blobs
  if (!lod) {
    for (let k = 0; k < Math.min(5, blobs.length); k += 1) {
      const bl = blobs[k];
      if (bl.p.y > H) continue;
      limb(b, top.clone().add(V(0, -0.25, 0)), V(bl.p.x * 0.85 + top.x * 0.15, bl.p.y - 0.1, bl.p.z * 0.85 + top.z * 0.15), 0.05, 0.02, 4, P.jungleBark, H);
    }
  }
  const res = foliage(b, blobs.map((bl) => ({ ...bl, d: lod ? 0 : 1 })), pal, { lump: 0.24, freq: 1.5 });
  if (!lod) {
    // hanging vines
    const nv = [6, 5, 8, 6][v];
    for (let k = 0; k < nv; k++) {
      const a = (k / nv) * TAU + b.r(0, 0.6);
      const rr = rad * b.r(0.75, 1.15);
      const s = V(top.x + Math.cos(a) * rr, res.yMin + 0.12, top.z + Math.sin(a) * rr);
      const L = b.r(0.45, 0.95);
      vine(b, s, L);
    }
    // jungle blossoms
    if (v === 2 || v === 3) {
      const col = v === 2 ? C(0xff4f7f) : C(0xffa62a);
      for (let k = 0; k < 7; k++) {
        const bl = blobs[Math.floor(b.r(0, blobs.length))];
        const dir = V(b.r(-1, 1), b.r(0.2, 1), b.r(-1, 1)).normalize();
        const p = bl.p.clone().add(V(dir.x * bl.r * 0.95, dir.y * bl.r * (bl.sq ?? 1) * 0.95, dir.z * bl.r * 0.95));
        const g = blobGeo(b, 0.05, 0, { lump: 0.15 });
        b.add(g, { matrix: M(p.x, p.y, p.z), normals: 'blend', blend: 0.5, color: mul3(col, b.r(0.85, 1.05)), mat: MAT.PETAL, leaf: 1, flutter: 1, pivot: bl.p });
      }
    }
  }
  return { bendScale: 0.8, height: H + 0.6 };
}

function vine(b, s, L) {
  const n = 4;
  const e = s.clone().add(V(b.r(-0.08, 0.08), -L, b.r(-0.08, 0.08)));
  const m = s.clone().lerp(e, 0.5).add(V(b.r(-0.06, 0.06), 0, b.r(-0.06, 0.06)));
  const path = bezier(s, m, e, n);
  const ca = C(0x1d4a20),
    cb = C(0x3e7a2c);
  for (let i = 0; i < n; i++) {
    const a = path[i],
      c = path[i + 1];
    const w = 0.026 * (1 - (i / n) * 0.6);
    const sd = V(w, 0, w * 0.4);
    const o = { leaf: 0.6, flutter: 1.5 + i * 0.3, mat: MAT.LEAF, pivot: s, bend: NaN };
    b.tri(a.clone().sub(sd), c.clone().add(sd), a.clone().add(sd), [ca, cb, ca], o);
    b.tri(a.clone().sub(sd), c.clone().sub(sd), c.clone().add(sd), [ca, cb, cb], o);
    // a little leaf
    if (i % 2 === 1) {
      const lp = c.clone();
      const ld = V(b.r(-1, 1), 0, b.r(-1, 1)).normalize().multiplyScalar(0.07);
      b.tri(lp, lp.clone().add(ld).add(V(0, 0.03, 0)), lp.clone().add(ld.clone().multiplyScalar(0.5)).add(V(0, -0.03, 0)), [cb, mix3(cb, C(0x7ab040), 0.5), cb], { ...o, up: true });
    }
  }
}

function buildAcacia(b, v, lod) {
  const pal = P.acacia;
  const th = [0.55, 0.65, 0.5][v];
  const lean = [V(0.05, 0, 0), V(-0.08, 0, 0.05), V(0.22, 0, 0.1)][v];
  const sides = lod ? 5 : 6;
  const tTop = V(lean.x, th, lean.z);
  trunk(b, bezier(V(0, 0, 0), V(0, th * 0.5, 0), tTop, lod ? 1 : 2), [0.085, 0.075, 0.06].slice(0, lod ? 2 : 3), sides, P.acaciaBark, { yTop: 1.6, flare: lod ? 0 : 0.3 });
  const limbs = v === 1 ? 3 : 3;
  const crowns = [];
  for (let k = 0; k < limbs; k++) {
    const a = (k / limbs) * TAU + v * 1.3 + b.r(-0.3, 0.3);
    const rr = [0.48, 0.42, 0.55][v] * b.r(0.8, 1.1);
    const y = [1.38, 1.3, 1.32][v] + b.r(-0.06, 0.06);
    const end = V(lean.x + Math.cos(a) * rr, y, lean.z + Math.sin(a) * rr);
    if (!lod) limb(b, tTop, end, 0.05, 0.025, 4, P.acaciaBark, 1.6, { bend: 0.05 });
    crowns.push(end);
  }
  let blobs = [];
  for (const c of crowns) blobs.push({ p: V(c.x, c.y + 0.1, c.z), r: 0.5, sq: 0.3, fb: 0.6 });
  blobs.push({ p: V(lean.x, crowns[0].y + 0.16, lean.z), r: 0.56, sq: 0.3, fb: 0.6 });
  if (v === 1) blobs.push({ p: V(crowns[1].x * 0.6, crowns[1].y + 0.42, crowns[1].z * 0.6), r: 0.38, sq: 0.32, fb: 0.6 });
  if (lod) blobs = [{ p: V(lean.x, crowns[0].y + 0.12, lean.z), r: 0.95, sq: 0.22, fb: 0.6 }];
  if (lod) trunk(b, [tTop, V(lean.x, crowns[0].y, lean.z)], [0.06, 0.04], 4, P.acaciaBark, { yTop: 1.6 });
  foliage(b, blobs.map((bl) => ({ ...bl, d: lod ? 1 : 1 })), pal, { lump: 0.18, freq: 2.2, aoMin: 0.45 });
  return { bendScale: 0.7, height: 1.8 };
}

function buildWillow(b, v, lod) {
  const pal = P.willow;
  const th = [0.85, 0.75, 0.95][v];
  const lean = [V(0.06, 0, 0.04), V(-0.12, 0, 0.0), V(0.1, 0, -0.12)][v];
  const pts = bezier(V(0, 0, 0), V(-lean.x * 0.8, th * 0.5, lean.z * 0.3), V(lean.x, th, lean.z), lod ? 1 : 3);
  trunk(b, pts, pts.map((_, i) => 0.14 - (0.06 * i) / (pts.length - 1)), lod ? 5 : 7, P.willowBark, { flare: lod ? 0 : 0.6, roots: 3, yTop: 1.6, moss: P.moss });
  const top = pts[pts.length - 1];
  let blobs = [
    { p: V(top.x, th + 0.42, top.z), r: 0.5, sq: 0.72 },
    { p: V(top.x + 0.34, th + 0.28, top.z + 0.1), r: 0.38, sq: 0.7 },
    { p: V(top.x - 0.3, th + 0.3, top.z + 0.16), r: 0.36, sq: 0.7 },
    { p: V(top.x - 0.04, th + 0.26, top.z - 0.34), r: 0.36, sq: 0.7 },
  ];
  if (lod) blobs = [{ p: V(top.x, th + 0.36, top.z), r: 0.66, sq: 0.62 }];
  if (!lod) for (let k = 1; k < 4; k++) limb(b, top, V(blobs[k].p.x, blobs[k].p.y - 0.12, blobs[k].p.z), 0.05, 0.025, 4, P.willowBark, 1.6);
  const res = foliage(b, blobs.map((bl) => ({ ...bl, d: lod ? 0 : 1 })), pal, { lump: 0.2 });
  // drooping curtain of strands
  const n = lod ? 9 : [18, 14, 20][v];
  const ca = mix3(pal.mid, pal.dark, 0.3),
    cb = pal.light,
    ct = mix3(pal.light, pal.hi, 0.5);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + b.r(-0.15, 0.15);
    const rr = b.r(0.52, 0.7);
    const s = V(top.x + Math.cos(a) * rr, res.yMin + 0.32 + b.r(-0.05, 0.1), top.z + Math.sin(a) * rr);
    const out = V(Math.cos(a), 0, Math.sin(a));
    const L = b.r(0.55, 0.85) * (v === 1 ? 0.85 : 1);
    const m = s.clone().addScaledVector(out, 0.12).add(V(0, -L * 0.35, 0));
    const e = s.clone().addScaledVector(out, 0.1).add(V(0, -L, 0));
    const segs = lod ? 2 : 4;
    const path = bezier(s, m, e, segs);
    const tan = V(-out.z, 0, out.x);
    for (let i = 0; i < segs; i++) {
      const w0 = 0.07 * (1 - i / segs) + 0.015,
        w1 = 0.07 * (1 - (i + 1) / segs) + 0.015;
      const a0 = path[i].clone().addScaledVector(tan, -w0),
        b0 = path[i].clone().addScaledVector(tan, w0);
      const a1 = path[i + 1].clone().addScaledVector(tan, -w1),
        b1 = path[i + 1].clone().addScaledVector(tan, w1);
      const c0 = mix3(ca, cb, i / segs),
        c1 = mix3(ca, cb, (i + 1) / segs);
      const o = { leaf: 1, flutter: 1.2 + i * 0.4, mat: MAT.LEAF, pivot: s, bend: NaN };
      const nrm = [out, out, out];
      b.tri(a0, b0, b1, [c0, c0, i === segs - 1 ? ct : c1], { ...o, normals: nrm });
      b.tri(a0, b1, a1, [c0, i === segs - 1 ? ct : c1, c1], { ...o, normals: nrm });
    }
  }
  return { bendScale: 0.9, height: 1.7 };
}

function buildDead(b, v, lod) {
  const pal = P.deadBark;
  const H = [1.35, 1.6, 1.2, 0.75][v];
  const lean = V(b.r(-0.12, 0.12), 0, b.r(-0.12, 0.12));
  const pts = bezier(V(0, 0, 0), V(lean.x * -0.6, H * 0.5, lean.z * -0.6), V(lean.x, H, lean.z), lod ? 2 : 4);
  trunk(b, pts, pts.map((_, i) => 0.11 - (0.065 * i) / (pts.length - 1)), lod ? 4 : 6, pal, { flare: lod ? 0 : 0.6, roots: 3, yTop: H + 0.5, capTop: v !== 3 });
  const nb = v === 3 ? 2 : lod ? 3 : 4;
  for (let k = 0; k < nb; k++) {
    const i = Math.min(pts.length - 1, Math.floor(pts.length * b.r(0.45, 0.95)));
    const from = pts[i];
    const a = (k / nb) * TAU + b.r(-0.4, 0.4);
    const len = b.r(0.35, 0.6) * (v === 3 ? 0.6 : 1);
    const to = from.clone().add(V(Math.cos(a) * len, b.r(0.2, 0.45), Math.sin(a) * len));
    const path = limb(b, from, to, 0.045, 0.015, lod ? 3 : 4, pal, H + 0.5, { bend: 0.1 });
    if (!lod) {
      // twigs
      for (let t = 0; t < 2; t++) {
        const f2 = path[Math.min(path.length - 1, 2 + t)];
        const a2 = a + b.r(-1.2, 1.2);
        const l2 = b.r(0.12, 0.25);
        limb(b, f2, f2.clone().add(V(Math.cos(a2) * l2, b.r(0.08, 0.2), Math.sin(a2) * l2)), 0.014, 0.006, 3, pal, H + 0.5, { bend: 0.03, segs: 1 });
      }
    }
  }
  if (v === 3 && !lod) {
    // jagged broken top
    const t = pts[pts.length - 1];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU;
      const p0 = t.clone().add(V(Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05));
      const p1 = t.clone().add(V(Math.cos(a + 0.6) * 0.05, 0, Math.sin(a + 0.6) * 0.05));
      const tip = t.clone().add(V(Math.cos(a + 0.3) * 0.03, b.r(0.05, 0.16), Math.sin(a + 0.3) * 0.03));
      b.tri(p0, tip, p1, [pal.top, C(0xb0a08a), pal.top], { mat: MAT.WOOD });
    }
  }
  return { bendScale: 0.35, height: H + 0.4 };
}

// ---------------------------------------------------------------------------
// SHRUBS & PLANTS

function buildBush(b, v, lod) {
  const pal = P.bush[v];
  const cfg = [
    [V(0, 0.26, 0), 0.28, V(0.21, 0.18, 0.08), 0.21, V(-0.17, 0.17, 0.13), 0.2, V(0.02, 0.18, -0.21), 0.2],
    [V(0, 0.2, 0), 0.27, V(0.3, 0.15, 0.05), 0.21, V(-0.28, 0.15, 0.06), 0.21, V(0.0, 0.15, -0.25), 0.19],
    [V(0, 0.17, 0), 0.2, V(0.15, 0.13, 0.1), 0.15, V(-0.12, 0.13, -0.08), 0.15],
    [V(0, 0.24, 0), 0.26, V(0.2, 0.17, 0.12), 0.2, V(-0.2, 0.18, 0.05), 0.2, V(0.0, 0.16, -0.2), 0.19],
  ][v];
  let blobs = [];
  for (let k = 0; k < cfg.length; k += 2) blobs.push({ p: cfg[k], r: cfg[k + 1], sq: 0.86, d: lod ? 0 : 1, fb: 0.3 });
  if (lod) blobs = blobs.slice(0, 2);
  foliage(b, blobs, pal, { lump: 0.24, freq: 2.2, aoMin: 0.45, flutter: 0.6 });
  // flowering shrub: tiny blossoms
  if (v === 3 && !lod) blossoms(b, blobs, [C(0xfff4f0), C(0xffd0e0)], 14);
  // a few stems peeking out at the base
  if (!lod) for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + v;
    limb(b, V(0, 0, 0), V(Math.cos(a) * 0.12, 0.14, Math.sin(a) * 0.12), 0.022, 0.012, 3, P.oakBark, 0.5, { segs: 1, bend: 0.02 });
  }
  return { bendScale: 0.35, height: 0.6 };
}

function blossoms(b, blobs, cols, n, size = 0.032, mat = MAT.PETAL) {
  for (let k = 0; k < n; k++) {
    const bl = blobs[k % blobs.length];
    const dir = V(b.r(-1, 1), b.r(0.05, 1), b.r(-1, 1)).normalize();
    const sq = bl.sq ?? 1;
    const p = V(bl.p.x + dir.x * bl.r * 0.98, bl.p.y + dir.y * bl.r * sq * 0.98, bl.p.z + dir.z * bl.r * 0.98);
    const g = new THREE.OctahedronGeometry(size * b.r(0.8, 1.2), 0);
    const col = cols[k % cols.length];
    b.add(g, { matrix: M(p.x, p.y, p.z, b.r(0, 3), b.r(0, 3), 0), normals: 'blend', blend: 0.7, center: p, color: mul3(col, b.r(0.88, 1.05)), mat, leaf: 1, flutter: 0.6, pivot: bl.p });
  }
}

function buildBerry(b, v, lod) {
  const berry = [[C(0xd8233a), C(0xb0102a)], [C(0x3a3aa8), C(0x24206e)], [C(0xe8406a), C(0xc02050)]][v];
  const blobs = [
    { p: V(0, 0.25, 0), r: 0.29, sq: 0.88, fb: 0.3 },
    { p: V(0.22, 0.18, 0.06), r: 0.2, sq: 0.88, fb: 0.3 },
    { p: V(-0.18, 0.18, 0.12), r: 0.2, sq: 0.88, fb: 0.3 },
  ].map((bl) => ({ ...bl, d: lod ? 0 : 1 }));
  foliage(b, lod ? blobs.slice(0, 2) : blobs, P.berryLeaf, { lump: 0.25, freq: 2.4, aoMin: 0.45, flutter: 0.5 });
  blossoms(b, blobs, berry, lod ? 6 : 16, lod ? 0.05 : 0.04, MAT.GLOSS);
  return { bendScale: 0.3, height: 0.6 };
}

const FLOWER_PALETTES = [
  { petals: [0xff8fb4, 0xffffff, 0xffb8d4, 0xff6f9c], heart: 0xffd84a },
  { petals: [0xffd23a, 0xffa22a, 0xfff07a, 0xff8a1a], heart: 0x6a3a14 },
  { petals: [0x8a6aff, 0x5a86ff, 0xb89cff, 0xd8c8ff], heart: 0xfff0a0 },
  { petals: [0xff3b30, 0xff6a2a, 0xffffff, 0xff2a50], heart: 0x2a1a12 },
];
function buildFlowers(b, v, lod) {
  const pal = FLOWER_PALETTES[v];
  const n = [10, 9, 11, 8][v];
  const stemC = C(0x3f8a2a),
    stemB = C(0x2a5a1e);
  // leafy base tuft
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * TAU + b.r(0, 0.5);
    const r0 = b.r(0.0, 0.18);
    const base = V(Math.cos(a) * r0, 0, Math.sin(a) * r0);
    const dir = V(Math.cos(a + 0.4), 0, Math.sin(a + 0.4));
    const tip = base.clone().addScaledVector(dir, b.r(0.1, 0.16)).add(V(0, b.r(0.07, 0.12), 0));
    const side = V(-dir.z, 0, dir.x).multiplyScalar(0.035);
    b.tri(base.clone().sub(side), tip, base.clone().add(side), [stemB, C(0x6fae3c), stemB], { leaf: 1, flutter: 0.7, mat: MAT.LEAF, pivot: V(0, 0, 0), up: true });
  }
  for (let k = 0; k < n; k++) {
    const a = b.r(0, TAU);
    const rr = Math.sqrt(b.rng()) * 0.32;
    const base = V(Math.cos(a) * rr, 0, Math.sin(a) * rr);
    const h = b.r(0.14, 0.3);
    const head = base.clone().add(V(b.r(-0.04, 0.04), h, b.r(-0.04, 0.04)));
    // stem as a thin bent ribbon
    const sd = V(0.008, 0, 0.008);
    b.tri(base.clone().sub(sd), head, base.clone().add(sd), [stemB, stemC, stemB], { leaf: 1, flutter: 0.8, mat: MAT.LEAF, pivot: base });
    // petals
    const pc = C(pal.petals[k % pal.petals.length]);
    const np = v === 3 ? 4 : 5;
    const pr = b.r(0.045, 0.07) * (v === 3 ? 1.2 : 1);
    const tilt = V(b.r(-0.35, 0.35), 1, b.r(-0.35, 0.35)).normalize();
    const t1 = V(1, 0, 0).cross(tilt).normalize();
    const t2 = tilt.clone().cross(t1).normalize();
    const rot = b.r(0, TAU);
    const cup = v === 3 ? 0.35 : 0.15;
    const heartC = C(pal.heart);
    const centre = head.clone().addScaledVector(tilt, 0.006);
    for (let q = 0; q < np; q++) {
      const a0 = rot + (q / np) * TAU;
      const dirA = t1.clone().multiplyScalar(Math.cos(a0)).addScaledVector(t2, Math.sin(a0));
      const dirL = t1.clone().multiplyScalar(Math.cos(a0 - 0.5)).addScaledVector(t2, Math.sin(a0 - 0.5));
      const dirR = t1.clone().multiplyScalar(Math.cos(a0 + 0.5)).addScaledVector(t2, Math.sin(a0 + 0.5));
      const tip = head.clone().addScaledVector(dirA, pr).addScaledVector(tilt, pr * cup);
      const l = head.clone().addScaledVector(dirL, pr * 0.62).addScaledVector(tilt, pr * cup * 0.5);
      const r = head.clone().addScaledVector(dirR, pr * 0.62).addScaledVector(tilt, pr * cup * 0.5);
      const inner = mul3(pc, 0.78),
        outer = mix3(pc, [1, 1, 1], 0.12);
      const o = { leaf: 1, flutter: 1.0, mat: MAT.PETAL, pivot: head, up: true, normals: [tilt, tilt, tilt] };
      b.tri(head, r, tip, [inner, outer, outer], o);
      b.tri(head, tip, l, [inner, outer, outer], o);
    }
    // heart
    for (let q = 0; q < 5; q++) {
      const a0 = (q / 5) * TAU,
        a1 = ((q + 1) / 5) * TAU;
      const p0 = centre.clone().addScaledVector(t1, Math.cos(a0) * pr * 0.28).addScaledVector(t2, Math.sin(a0) * pr * 0.28);
      const p1 = centre.clone().addScaledVector(t1, Math.cos(a1) * pr * 0.28).addScaledVector(t2, Math.sin(a1) * pr * 0.28);
      b.tri(centre.clone().addScaledVector(tilt, pr * 0.12), p0, p1, heartC, { leaf: 1, flutter: 1.0, mat: MAT.PETAL, pivot: head, up: true, normals: [tilt, tilt, tilt] });
    }
  }
  return { bendScale: 1.0, height: 0.32 };
}

function buildCactus(b, v, lod) {
  const pal = P.cactus;
  const ribs = lod ? 6 : 12;
  const ribFn = (i, s, a) => (lod ? 1 : s % 2 === 0 ? 1.1 : 0.9);
  const col = (yTop) => (p, n, fc) => {
    const t = clamp01(p.y / yTop);
    let c = mix3(pal.dark, pal.mid, smooth(0, 0.6, t + 0.2));
    c = mix3(c, pal.light, clamp01(n.y * 0.6 + 0.2) * 0.6);
    return mul3(c, (0.66 + 0.34 * smooth(0, 0.2, p.y)) * (0.92 + 0.14 * hashV(fc)));
  };
  if (v < 2) {
    const H = v === 0 ? 1.35 : 1.6;
    const R = v === 0 ? 0.13 : 0.12;
    const n = lod ? 3 : 7;
    const path = [],
      radii = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      path.push(V(0, t * H, 0));
      radii.push(R * (i === 0 ? 1.05 : 1) * (t > 0.86 ? Math.sqrt(Math.max(0.05, (1 - t) / 0.14)) * 0.85 + 0.15 : 1));
    }
    b.add(tubeGeo(path, radii, ribs, { capTop: true, flare: ribFn }), { normals: 'geoblend', blend: 0.6, color: col(H), mat: MAT.CACTUS });
    const arms = v === 0 ? [[0.5, 0, 0.3], [0.68, Math.PI * 0.95, 0.38]] : [[0.62, 0.8, 0.42]];
    for (const [hy, ang, up] of arms) {
      const d = V(Math.cos(ang), 0, Math.sin(ang));
      const s = V(0, hy * H, 0).addScaledVector(d, R * 0.6);
      const m = s.clone().addScaledVector(d, 0.26);
      const e = m.clone().add(V(0, up, 0)).addScaledVector(d, 0.03);
      const ap = bezier(s, m.clone().add(V(0, 0.02, 0)), e, lod ? 2 : 5);
      b.add(tubeGeo(ap, ap.map((_, i) => R * 0.62 * (i === ap.length - 1 ? 0.8 : 1)), lod ? 5 : 10, { capTop: true, flare: lod ? null : (i, s2) => (s2 % 2 === 0 ? 1.1 : 0.9) }), { normals: 'geoblend', blend: 0.6, color: col(H), mat: MAT.CACTUS });
    }
    if (v === 1 && !lod) {
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * TAU;
        const p = V(Math.cos(a) * 0.05, H + 0.01, Math.sin(a) * 0.05);
        flowerHead(b, p, 0.05, C(0xff6a9a), C(0xffe070));
      }
    }
    return { bendScale: 0.08, height: H };
  }
  // barrel cactus clusters
  const barrels = v === 2 ? [[0, 0, 0.24, 0.3]] : [[0.05, 0.02, 0.2, 0.26], [-0.2, 0.12, 0.14, 0.18], [0.12, -0.22, 0.12, 0.15]];
  for (const [x, z, r, h] of barrels) {
    const n = lod ? 3 : 6;
    const path = [],
      radii = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      path.push(V(x, t * h, z));
      radii.push(r * (0.75 + 0.35 * Math.sin(Math.PI * (0.25 + t * 0.6))) * (t === 1 ? 0.45 : 1));
    }
    b.add(tubeGeo(path, radii, lod ? 6 : 12, { capTop: true, flare: lod ? null : (i, s) => (s % 2 === 0 ? 1.1 : 0.88) }), { normals: 'geoblend', blend: 0.55, color: col(h * 1.6), mat: MAT.CACTUS });
    if (!lod) {
      const fc = v === 2 ? C(0xffd23a) : C(0xff4a6a);
      for (let k = 0; k < (v === 2 ? 5 : 2); k++) {
        const a = (k / 5) * TAU;
        flowerHead(b, V(x + Math.cos(a) * r * 0.25, h + 0.02, z + Math.sin(a) * r * 0.25), 0.04, fc, C(0xfff2b0));
      }
    }
  }
  return { bendScale: 0.05, height: 0.4 };
}

function flowerHead(b, c, pr, pc, heart) {
  const np = 6;
  for (let q = 0; q < np; q++) {
    const a0 = (q / np) * TAU;
    const tip = c.clone().add(V(Math.cos(a0) * pr, pr * 0.4, Math.sin(a0) * pr));
    const l = c.clone().add(V(Math.cos(a0 - 0.45) * pr * 0.55, pr * 0.2, Math.sin(a0 - 0.45) * pr * 0.55));
    const r = c.clone().add(V(Math.cos(a0 + 0.45) * pr * 0.55, pr * 0.2, Math.sin(a0 + 0.45) * pr * 0.55));
    b.tri(c, r, tip, [mul3(pc, 0.8), pc, pc], { leaf: 1, flutter: 0.3, mat: MAT.PETAL, pivot: c, up: true });
    b.tri(c, tip, l, [mul3(pc, 0.8), pc, pc], { leaf: 1, flutter: 0.3, mat: MAT.PETAL, pivot: c, up: true });
  }
  const g = new THREE.IcosahedronGeometry(pr * 0.3, 0);
  b.add(g, { matrix: M(c.x, c.y + pr * 0.2, c.z), normals: 'blend', blend: 0.6, center: c, color: heart, mat: MAT.PETAL, leaf: 1, flutter: 0.3, pivot: c });
}

function buildReeds(b, v, lod) {
  const n = [16, 12, 20][v];
  const pal = P.reeds;
  for (let k = 0; k < n; k++) {
    const a = b.r(0, TAU);
    const rr = Math.sqrt(b.rng()) * 0.26;
    const base = V(Math.cos(a) * rr, -0.02, Math.sin(a) * rr);
    const h = b.r(0.42, 0.85) * (v === 1 ? 0.8 : 1);
    const lean = V(Math.cos(a) * b.r(0.04, 0.16), 0, Math.sin(a) * b.r(0.04, 0.16));
    const mid = base.clone().add(V(lean.x * 0.3, h * 0.55, lean.z * 0.3));
    const tip = base.clone().add(V(lean.x, h, lean.z));
    const side = V(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(0.022);
    const c0 = mul3(pal.base, 0.75),
      c1 = mix3(pal.base, pal.top, 0.5),
      c2 = pal.top;
    const o = { leaf: 1, flutter: 0.8, mat: MAT.LEAF, pivot: base };
    b.tri(base.clone().sub(side), mid.clone().add(side.clone().multiplyScalar(0.7)), base.clone().add(side), [c0, c1, c0], o);
    b.tri(base.clone().sub(side), mid.clone().sub(side.clone().multiplyScalar(0.7)), mid.clone().add(side.clone().multiplyScalar(0.7)), [c0, c1, c1], o);
    b.tri(mid.clone().sub(side.clone().multiplyScalar(0.7)), tip, mid.clone().add(side.clone().multiplyScalar(0.7)), [c1, c2, c1], o);
  }
  // cattails
  const nc = [4, 3, 6][v];
  for (let k = 0; k < nc; k++) {
    const a = b.r(0, TAU);
    const rr = b.r(0, 0.18);
    const base = V(Math.cos(a) * rr, 0, Math.sin(a) * rr);
    const h = b.r(0.6, 0.9);
    const top = base.clone().add(V(Math.cos(a) * 0.05, h, Math.sin(a) * 0.05));
    const sd = V(0.008, 0, 0.008);
    b.tri(base.clone().sub(sd), top.clone().add(V(0, 0.08, 0)), base.clone().add(sd), [mul3(pal.base, 0.8), pal.base, mul3(pal.base, 0.8)], { leaf: 1, flutter: 0.6, mat: MAT.LEAF, pivot: base });
    if (!lod) {
      const hp = [top.clone().add(V(0, -0.12, 0)), top.clone()];
      b.add(tubeGeo(hp, [0.026, 0.024], 5, { capTop: true, capBottom: true }), { normals: 'geoblend', blend: 0.7, color: (p, n2) => mul3(C(0x5a3820), 0.8 + 0.3 * clamp01(n2.y * 0.5 + 0.5)), mat: MAT.WOOD, leaf: 1, flutter: 0.6, pivot: base });
    }
  }
  return { bendScale: 1.2, height: 0.85 };
}

function mushroom(b, x, z, h, r, capC, stemC, spots, o = {}) {
  const stem = [V(x, 0, z), V(x + (o.lean ?? 0), h, z)];
  b.add(tubeGeo(stem, [r * 0.34, r * 0.28], 6, { capTop: false }), { normals: 'geo', color: (p, n) => mul3(stemC, 0.75 + 0.25 * smooth(0, h, p.y)), mat: MAT.WOOD, leaf: 1, flutter: 0.05, pivot: V(x, 0, z) });
  const cap = new THREE.SphereGeometry(r, 9, 4, 0, TAU, 0, Math.PI * 0.55);
  const top = stem[1];
  b.add(cap, {
    matrix: M(top.x, top.y - r * 0.18, top.z, 0, b.r(0, TAU), 0, 1, o.sq ?? 0.62, 1),
    normals: 'geoblend',
    blend: 0.65,
    color: (p, n) => mul3(capC, 0.65 + 0.35 * clamp01(n.y) * (0.92 + 0.1 * hashV(p))),
    mat: MAT.GLOSS,
    leaf: 1,
    flutter: 0.05,
    pivot: V(x, 0, z),
  });
  // gills / underside
  const under = new THREE.CircleGeometry(r * 0.98, 9);
  b.add(under, { matrix: M(top.x, top.y - r * 0.18 - r * 0.15 * (o.sq ?? 0.62), top.z, Math.PI / 2, 0, 0), normals: 'flat', color: mul3(stemC, 0.7), mat: MAT.WOOD, leaf: 1, flutter: 0.05, pivot: V(x, 0, z) });
  if (spots) {
    for (let k = 0; k < spots; k++) {
      const a = b.r(0, TAU),
        el = b.r(0.25, 1.2);
      const dir = V(Math.cos(a) * Math.sin(el), Math.cos(el), Math.sin(a) * Math.sin(el));
      const p = V(top.x + dir.x * r * 0.98, top.y - r * 0.18 + dir.y * r * (o.sq ?? 0.62) * 0.98 + 0.004, top.z + dir.z * r * 0.98);
      const g = new THREE.OctahedronGeometry(r * b.r(0.12, 0.18), 0);
      b.add(g, { matrix: M(p.x, p.y, p.z, 0, 0, 0, 1, 0.45, 1), normals: 'up', color: C(0xfff6e8), mat: MAT.GLOSS, leaf: 1, flutter: 0.05, pivot: V(x, 0, z) });
    }
  }
}

function buildMushroom(b, v, lod) {
  const red = C(0xd42c22),
    redL = C(0xf0442a),
    brown = C(0x8a5530),
    tan = C(0xc8a070),
    stem = C(0xf0e8d8);
  if (v === 0) mushroom(b, 0, 0, 0.2, 0.15, red, stem, lod ? 0 : 8);
  else if (v === 1) {
    mushroom(b, 0.05, 0.02, 0.15, 0.1, redL, stem, lod ? 0 : 6, { lean: 0.02 });
    mushroom(b, -0.13, 0.08, 0.1, 0.07, red, stem, lod ? 0 : 4, { lean: -0.015 });
    mushroom(b, 0.02, -0.14, 0.07, 0.055, red, stem, lod ? 0 : 3);
  } else if (v === 2) {
    mushroom(b, 0, 0, 0.13, 0.12, brown, C(0xe8dcc4), 0, { sq: 0.72 });
    mushroom(b, 0.14, 0.06, 0.09, 0.08, mix3(brown, tan, 0.3), C(0xe8dcc4), 0, { sq: 0.72 });
    mushroom(b, -0.08, 0.14, 0.06, 0.06, brown, C(0xe8dcc4), 0, { sq: 0.72 });
  } else {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU + 0.3;
      const rr = k ? 0.12 : 0;
      mushroom(b, Math.cos(a) * rr, Math.sin(a) * rr, b.r(0.05, 0.1), b.r(0.04, 0.06), mix3(tan, C(0xf4e6c8), b.rng()), C(0xf4ecdc), 0, { sq: 0.55 });
    }
  }
  return { bendScale: 0.1, height: 0.3 };
}

// ---------------------------------------------------------------------------
// MINERALS & REMAINS

function stoneColor(pal, o = {}) {
  return (p, n, fc) => {
    const j = hashV(fc);
    let c = mix3(pal.base, pal.top, clamp01(0.25 + n.y * 0.5 + (j - 0.5) * 0.5));
    if (o.moss) c = mix3(c, j > 0.5 ? P.mossLight : P.moss, smooth(0.45, 0.85, n.y) * o.moss);
    if (o.lichen && j > 0.82 && n.y > 0) c = mix3(c, P.lichen, 0.55);
    const ground = 0.7 + 0.3 * smooth(0, 0.12, p.y);
    return mul3(c, ground);
  };
}

function rockGeo(b, r, detail, sq, lump = 0.28) {
  return blobGeo(b, r, detail, { lump, freq: 1.3, squash: sq, flatBottom: 0.4 });
}

function buildStones(b, v, lod) {
  const pal = [P.rock, P.rock, P.rockWarm, P.rockDark][v];
  const set = [
    [[0, 0, 0.13], [0.16, 0.1, 0.08], [-0.12, 0.14, 0.07]],
    [[0.02, 0.03, 0.15], [-0.17, -0.06, 0.09], [0.14, -0.16, 0.06], [0.1, 0.18, 0.05]],
    [[0, 0, 0.16], [0.2, -0.08, 0.07]],
    [[-0.05, 0.02, 0.11], [0.12, 0.1, 0.1], [0.06, -0.15, 0.08]],
  ][v];
  for (const [x, z, r] of set) {
    const sq = b.r(0.5, 0.7);
    b.add(rockGeo(b, r, r > 0.12 && !lod ? 1 : 0, sq, 0.3), {
      matrix: M(x, r * sq * 0.35, z, b.r(-0.2, 0.2), b.r(0, TAU), b.r(-0.2, 0.2)),
      normals: 'flat',
      color: stoneColor(pal, { moss: v === 1 ? 0.9 : 0.25, lichen: v === 0 }),
      mat: MAT.ROCK,
    });
  }
  return { bendScale: 0, height: 0.2 };
}

function buildBoulder(b, v, lod) {
  const d = lod ? 0 : 1;
  if (v === 3) {
    // split boulder: two halves with a gap
    for (const s of [-1, 1]) {
      const g = rockGeo(b, 0.36, d, 0.85, 0.22);
      const P2 = g.attributes.position;
      for (let k = 0; k < P2.count; k++) if (P2.getX(k) * s < 0.02) P2.setX(k, 0.02 * s + P2.getX(k) * 0.12);
      b.add(g, { matrix: M(s * 0.06, 0.2, 0, 0, 0.3, s * 0.08), normals: 'flat', color: stoneColor(P.rock, { moss: 0.6 }), mat: MAT.ROCK });
    }
    return { bendScale: 0, height: 0.6 };
  }
  const r = [0.46, 0.42, 0.5][v];
  const sq = [0.78, 0.7, 0.62][v];
  b.add(rockGeo(b, r, d, sq, 0.24), {
    matrix: M(0, r * sq * 0.42, 0, b.r(-0.15, 0.15), b.r(0, TAU), b.r(-0.15, 0.15)),
    normals: 'flat',
    color: stoneColor(v === 2 ? P.rockWarm : P.rock, { moss: v === 1 ? 1 : 0.3, lichen: v !== 1 }),
    mat: MAT.ROCK,
  });
  if (!lod) {
    const s = rockGeo(b, r * 0.32, 0, 0.6, 0.3);
    b.add(s, { matrix: M(r * 0.85, r * 0.08, r * 0.35, 0, b.r(0, TAU), 0), normals: 'flat', color: stoneColor(P.rock, { moss: 0.4 }), mat: MAT.ROCK });
  }
  return { bendScale: 0, height: 0.7 };
}

function buildStump(b, v, lod) {
  const r = [0.13, 0.15, 0.12][v];
  const h = [0.18, 0.14, 0.26][v];
  const sides = 8;
  const pts = [V(0, 0, 0), V(0, h * 0.5, 0), V(0, h, 0)];
  b.add(tubeGeo(pts, [r * 1.05, r, r * 0.97], sides, { capTop: false, flare: (i, s, a) => (i === 0 ? 1.25 + 0.5 * Math.pow(Math.abs(Math.cos(a * 2)), 3) : 1) }), {
    normals: 'geoblend',
    blend: 0.7,
    color: barkColor(P.oakBark, 0.6, { moss: v === 1 ? P.moss : null }),
    mat: MAT.WOOD,
  });
  if (v === 2) {
    // jagged broken top
    for (let s = 0; s < sides; s++) {
      const a0 = (s / sides) * TAU,
        a1 = ((s + 1) / sides) * TAU;
      const p0 = V(Math.cos(a0) * r * 0.97, h, Math.sin(a0) * r * 0.97);
      const p1 = V(Math.cos(a1) * r * 0.97, h, Math.sin(a1) * r * 0.97);
      const tip = V(Math.cos(a0 + 0.4) * r * 0.5, h + b.r(0.03, 0.12), Math.sin(a0 + 0.4) * r * 0.5);
      b.tri(p0, tip, p1, [P.oakBark.top, P.woodTop, P.oakBark.top], { mat: MAT.WOOD });
      b.tri(p0, V(0, h + 0.02, 0), tip, [P.oakBark.top, P.woodRing, P.woodTop], { mat: MAT.WOOD, up: true });
    }
  } else {
    // cut face with growth rings
    const rings = [0, 0.33, 0.66, 1.0];
    for (let q = 0; q < 3; q++) {
      const c = q % 2 === 0 ? P.woodTop : P.woodRing;
      const c2 = q === 2 ? mul3(P.woodRing, 0.8) : c;
      for (let s = 0; s < sides; s++) {
        const a0 = (s / sides) * TAU,
          a1 = ((s + 1) / sides) * TAU;
        const ra = rings[q] * r * 0.97,
          rb = rings[q + 1] * r * 0.97;
        const A0 = V(Math.cos(a0) * ra, h, Math.sin(a0) * ra),
          A1 = V(Math.cos(a1) * ra, h, Math.sin(a1) * ra);
        const B0 = V(Math.cos(a0) * rb, h, Math.sin(a0) * rb),
          B1 = V(Math.cos(a1) * rb, h, Math.sin(a1) * rb);
        b.tri(A0, B1, B0, [c, c2, c2], { mat: MAT.WOOD, up: true, single: true });
        if (q > 0) b.tri(A0, A1, B1, [c, c, c2], { mat: MAT.WOOD, up: true, single: true });
      }
    }
    if (v === 1 && !lod) {
      mushroom(b, r * 0.9, 0.05, 0.06, 0.045, C(0xc8a070), C(0xf0e6d0), 0, { sq: 0.5 });
      mushroom(b, r * 0.7, -r * 0.8, 0.045, 0.035, C(0xd8b880), C(0xf0e6d0), 0, { sq: 0.5 });
    }
  }
  return { bendScale: 0, height: 0.3 };
}

function buildWheat(b, v, lod) {
  const grid = lod ? 3 : 5;
  const ripe = C(0xe6bc4c),
    ripeD = C(0xa8822c),
    head = C(0xf2cc5a);
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const x = -0.44 + ((gx + 0.5) / grid) * 0.88 + b.r(-0.06, 0.06) + (gy % 2 ? 0.04 : -0.04);
      const z = -0.44 + ((gy + 0.5) / grid) * 0.88 + b.r(-0.06, 0.06);
      const per = lod ? 1 : 2;
      for (let s = 0; s < per; s++) {
        const bx = x + b.r(-0.05, 0.05),
          bz = z + b.r(-0.05, 0.05);
        const h = b.r(0.36, 0.5);
        const lean = V(b.r(-0.05, 0.05), 0, b.r(-0.05, 0.05));
        const base = V(bx, -0.01, bz);
        const top = V(bx + lean.x, h, bz + lean.z);
        const sd = V(0.011, 0, 0.011).applyAxisAngle(V(0, 1, 0), b.r(0, TAU));
        const o = { leaf: 0.35, flutter: 0.5, mat: MAT.WHEAT, pivot: base };
        b.tri(base.clone().sub(sd), top, base.clone().add(sd), [mul3(ripeD, 0.7), ripe, mul3(ripeD, 0.7)], o);
        // a leaf
        if (!lod && s === 0 && (gx + gy) % 2 === 0) {
          const ld = V(b.r(-1, 1), 0, b.r(-1, 1)).normalize();
          const lb = base.clone().add(V(0, h * 0.3, 0));
          b.tri(lb.clone().sub(sd), lb.clone().addScaledVector(ld, 0.13).add(V(0, 0.09, 0)), lb.clone().add(sd), [ripeD, ripe, ripeD], { ...o, up: true });
        }
        // grain head: two crossed kites
        const hb = top.clone().add(V(-lean.x * 0.2, -0.12, -lean.z * 0.2));
        const ht = top.clone().add(V(lean.x * 0.15, 0.03, lean.z * 0.15));
        const hm = hb.clone().lerp(ht, 0.45);
        const ho = { leaf: 1, flutter: 0.6, mat: MAT.WHEAT, pivot: hb };
        const kites = lod ? 1 : 2;
        for (let q = 0; q < kites; q++) {
          const w = sd.clone().multiplyScalar(2.1).applyAxisAngle(V(0, 1, 0), q * Math.PI * 0.5);
          const l = hm.clone().add(w),
            r = hm.clone().sub(w);
          b.tri(hb, l, ht, [ripeD, head, head], ho);
          b.tri(hb, ht, r, [ripeD, head, head], ho);
        }
      }
    }
  }
  return { bendScale: 1.3, height: 0.55 };
}

// ---------------------------------------------------------------------------
// Registry

// far: 'lod' (use LOD1 geometry when the chunk is distant) | 'same' | 'skip'
export const KINDS = [];
function kind(id, variants, build, o = {}) {
  KINDS[id] = { id, variants, build, far: 'lod', castShadow: true, jitter: 0.22, scale: [0.88, 1.12], tilt: 0, sink: 0.04, ...o };
}
kind(FLORA.OAK, 4, buildOak, { scale: [0.9, 1.15] });
kind(FLORA.PINE, 4, (b, v, l) => buildPine(b, v, l, false));
kind(FLORA.SNOW_PINE, 4, (b, v, l) => buildPine(b, v, l, true));
kind(FLORA.BIRCH, 4, buildBirch);
kind(FLORA.PALM, 4, buildPalm, { jitter: 0.25 });
kind(FLORA.JUNGLE_TREE, 4, buildJungle, { scale: [0.92, 1.18] });
kind(FLORA.ACACIA, 3, buildAcacia, { scale: [0.9, 1.15] });
kind(FLORA.SWAMP_TREE, 3, buildWillow);
kind(FLORA.DEAD_TREE, 4, buildDead);
kind(FLORA.BUSH, 4, buildBush, { jitter: 0.28, castShadow: true, scale: [0.85, 1.2] });
kind(FLORA.BERRY_BUSH, 3, buildBerry, { jitter: 0.26, scale: [0.85, 1.15] });
kind(FLORA.FLOWERS, 4, buildFlowers, { far: 'skip', castShadow: false, jitter: 0.25, scale: [0.85, 1.2] });
kind(FLORA.CACTUS, 4, buildCactus, { jitter: 0.24 });
kind(FLORA.REEDS, 3, buildReeds, { far: 'skip', castShadow: false, jitter: 0.25 });
kind(FLORA.MUSHROOM, 4, buildMushroom, { far: 'skip', castShadow: false, jitter: 0.3, scale: [0.85, 1.25] });
kind(FLORA.ROCK_SMALL, 4, buildStones, { far: 'skip', castShadow: false, jitter: 0.28, tilt: 0.6, scale: [0.9, 1.3], sink: 0.02 });
kind(FLORA.BOULDER, 4, buildBoulder, { jitter: 0.12, tilt: 0.5, scale: [0.9, 1.15], sink: 0.08 });
kind(FLORA.STUMP, 3, buildStump, { far: 'skip', castShadow: false, jitter: 0.2 });
kind(FLORA.WHEAT, 3, buildWheat, { castShadow: false, jitter: 0, scale: [1, 1], snapYaw: true, sink: 0.0 });

// Build every model: returns KINDS-indexed { variants: [[lod0, lod1|null], ...], cfg }
export function buildAllModels() {
  const out = [];
  let verts = 0;
  for (const k of KINDS) {
    if (!k) continue;
    const variants = [];
    for (let v = 0; v < k.variants; v++) {
      const lods = [];
      for (let lod = 0; lod < (k.far === 'lod' ? 2 : 1); lod++) {
        const b = new MeshBuilder(k.id * 97 + v * 13 + 5);
        const opts = k.build(b, v, lod) || {};
        const geo = b.build(opts);
        geo.userData.kind = k.id;
        verts += geo.attributes.position.count;
        lods.push(geo);
      }
      variants.push(lods);
    }
    out[k.id] = { cfg: k, variants };
  }
  out.totalVerts = verts;
  return out;
}
