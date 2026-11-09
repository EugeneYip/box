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
  if (pal.hi) c = mix3(c, pal.hi, clamp01((n.y - 0.5) * 2) * smooth(0.55, 1, h) * 0.4);
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
    { dark: C(0x1c461c), mid: C(0x377f2c), light: C(0x6aa83a), hi: C(0xa2c858) },
    { dark: C(0x1a4322), mid: C(0x327832), light: C(0x62a240), hi: C(0x98c45c) },
    { dark: C(0x214a1a), mid: C(0x42862a), light: C(0x7cb43c), hi: C(0xb4d062) },
    { dark: C(0x1d401d), mid: C(0x36722d), light: C(0x689e42), hi: C(0x9cc062) },
  ],
  birchBark: { base: C(0xcfc8bb), top: C(0xf2efe6) },
  birch: { dark: C(0x3a6820), mid: C(0x6aa034), light: C(0x9cc84c), hi: C(0xcce070) },
  birchGold: { dark: C(0x7a5a16), mid: C(0xcc9a24), light: C(0xf0c84a), hi: C(0xfff0a0) },
  pineBark: { base: C(0x4a2e1e), top: C(0x6e4630) },
  pine: { dark: C(0x163d2c), mid: C(0x2a6a45), light: C(0x4f9658), hi: C(0x86b86a) },
  pineB: { dark: C(0x173a33), mid: C(0x285f4c), light: C(0x478a63), hi: C(0x7aac78) },
  snow: { dark: C(0xbccbe0), mid: C(0xe4ecf6), light: C(0xfbfdff), hi: C(0xffffff) },
  palmBark: { base: C(0x7a5a36), top: C(0xa8885a) },
  palm: { dark: C(0x1d561c), mid: C(0x3a8228), light: C(0x68a838), hi: C(0x9cc450) },
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
  cactus: { dark: C(0x31663a), mid: C(0x4f9450), light: C(0x86bd66), hi: C(0xb4d888) },
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
  const d = lod ? 'd' : 1;
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
  foliage(b, blobs.map((bl) => ({ ...bl, d })), pal, { lump: 0.22, mat: MAT.DLEAF });
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
  if (o.lod) {
    const innerC = V(0, y0 + h * 0.12, 0);
    for (let s = 0; s < segs; s++) {
      const s2 = (s + 1) % segs;
      add(apex, rim[s2], rim[s]);
      add(rim[s], rim[s2], innerC);
    }
    recolorRange(b, start, col, V(0, y0 + h * 0.2, 0), 0.35);
    return;
  }
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

// Apply a matrix (about `pivot`) to builder verts from `start` on.
function transformRange(b, start, m, pivot) {
  const p = V(),
    n = V(),
    nm = new THREE.Matrix3().getNormalMatrix(m);
  for (let k = start; k < b.count; k++) {
    const q = k * 3;
    p.set(b.pos[q] - pivot.x, b.pos[q + 1] - pivot.y, b.pos[q + 2] - pivot.z).applyMatrix4(m).add(pivot);
    b.pos[q] = p.x;
    b.pos[q + 1] = p.y;
    b.pos[q + 2] = p.z;
    n.set(b.nrm[q], b.nrm[q + 1], b.nrm[q + 2]).applyMatrix3(nm).normalize();
    b.nrm[q] = n.x;
    b.nrm[q + 1] = n.y;
    b.nrm[q + 2] = n.z;
    p.set(b.piv[q] - pivot.x, b.piv[q + 1] - pivot.y, b.piv[q + 2] - pivot.z).applyMatrix4(m).add(pivot);
    b.piv[q] = p.x;
    b.piv[q + 1] = p.y;
    b.piv[q + 2] = p.z;
  }
}

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
  const base = [
    { tiers: 5, R: 0.6, H: 2.7, base: 0.42 },
    { tiers: 6, R: 0.46, H: 3.05, base: 0.45 },
    { tiers: 4, R: 0.74, H: 2.35, base: 0.36 },
    { tiers: 4, R: 0.5, H: 2.2, base: 0.55 },
  ][v];
  // snow-laden spruce: narrower and taller than lowland pines
  const cfg = snowy ? { ...base, R: base.R * 0.84, H: base.H * 1.12 } : base;
  const segs = lod ? 5 : v === 1 ? 8 : 9;
  const tiers = lod ? Math.min(3, Math.max(2, cfg.tiers - 2)) : cfg.tiers;
  const pal = v % 2 ? P.pineB : P.pine;
  trunk(b, [V(0, 0, 0), V(0, cfg.H * 0.55, 0)], [0.085, 0.05], lod ? 5 : 6, P.pineBark, { flare: lod ? 0 : 0.35, roots: 2, yTop: cfg.H });
  const span = cfg.H - cfg.base;
  for (let t = 0; t < tiers; t++) {
    const f = t / tiers;
    const y0 = cfg.base + span * Math.pow(f, 0.92) * 0.82;
    const r = cfg.R * (1 - f * 0.78) * (v === 3 && t % 2 ? 0.82 : 1);
    const h = Math.max(r * 1.35, (span / tiers) * 1.7);
    const rot = b.r(0, TAU);
    const tierStart = b.count;
    // close up, tiers are fans of drooping branches; the leader and LOD1 stay conical
    if (!lod && t < tiers - 1) pineBranches(b, y0, h, r, v === 1 ? 7 : 8, pal, rot, { shade: 0.86 + 0.14 * f });
    else pineTier(b, y0, t === tiers - 1 ? h * 1.25 : h, r, segs, pal, rot, { shade: 0.86 + 0.14 * f, lod });
    if (snowy) snowCap(b, y0, t === tiers - 1 ? h * 1.25 : h, r, segs, rot, lod);
    if (!lod && t < tiers - 1) {
      // irregular silhouette: tiers lean and drift off the axis a little
      const off = r * 0.12;
      const m = M(b.r(-off, off), 0, b.r(-off, off), b.r(-0.12, 0.12), 0, b.r(-0.12, 0.12));
      transformRange(b, tierStart, m, V(0, y0, 0));
    }
  }
  return { bendScale: 0.8, height: cfg.H };
}

// A conifer tier as a whorl of drooping branches: each branch arches out of
// the trunk, sags toward a sunlit tip and carries a raised midrib, leaving
// gaps between branches so the silhouette is layered and ragged.
function pineBranches(b, y0, h, r, n, pal, rot, o = {}) {
  const shade = o.shade ?? 1;
  const piv = V(0, y0 + h * 0.3, 0);
  for (let k = 0; k < n; k++) {
    const a = rot + (k / n) * TAU + b.r(-0.18, 0.18);
    const d = V(Math.cos(a), 0, Math.sin(a));
    const s = V(-d.z, 0, d.x);
    const len = r * b.r(0.88, 1.12);
    const base = V(0, y0 + h * 0.5, 0);
    const mid = d.clone().multiplyScalar(len * 0.52).add(V(0, y0 + h * 0.22, 0));
    const tip = d.clone().multiplyScalar(len).add(V(0, y0 - len * b.r(0.12, 0.24), 0));
    const w = len * b.r(0.3, 0.38);
    const L = mid.clone().addScaledVector(s, w),
      R = mid.clone().addScaledVector(s, -w);
    const C = mid.clone().add(V(0, len * 0.09, 0));
    const cB = mul3(pal.dark, 0.8 * shade),
      cM = mul3(mix3(pal.dark, pal.mid, 0.6), shade),
      cE = mul3(pal.mid, shade),
      cT = mul3(mix3(pal.light, pal.hi || pal.light, 0.3), shade * (0.95 + 0.1 * b.rng()));
    const opt = { leaf: 1, flutter: 0.45, mat: MAT.LEAF, pivot: piv };
    b.tri(base, R, C, [cB, cE, cM], opt);
    b.tri(base, C, L, [cB, cM, cE], opt);
    b.tri(C, R, tip, [cM, cE, cT], opt);
    b.tri(L, C, tip, [cE, cM, cT], opt);
  }
}

// Snow lying in irregular clumps on a pine tier: a handful of flattened,
// lumpy drifts tilted to the cone, sized and spaced at random so the tree
// reads as snow-laden rather than striped. The top tier gets a cap.
function snowCap(b, y0, h, r, segs, rot, lod) {
  const pal = P.snow;
  const col = (p, n) => mul3(mix3(pal.dark, pal.light, clamp01(n.y * 0.85 + 0.2)), 0.95 + 0.08 * hashV(p));
  const piv = V(0, y0 + h * 0.5, 0);
  const slope = Math.atan2(h, r);
  const clumps = lod ? 1 : 4 + Math.floor(b.rng() * 3);
  for (let k = 0; k < clumps; k++) {
    const a = rot + (k / clumps) * TAU + b.r(-0.5, 0.5);
    const rho = r * b.r(0.25, 0.75);
    const ySurf = y0 + h * (1 - rho / r) * 0.92 + 0.03;
    const size = r * b.r(0.3, 0.46) * (1 - rho / r * 0.3);
    const g = blobGeo(b, size, 0, { lump: 0.35, squash: 0.45, freq: 2.4 });
    // tilt the drift so it lies along the cone surface
    const tilt = new THREE.Matrix4().makeRotationZ(-slope * 0.75);
    const place = new THREE.Matrix4().makeTranslation(Math.cos(a) * rho, ySurf, Math.sin(a) * rho);
    const mat4 = place.multiply(new THREE.Matrix4().makeRotationY(-a)).multiply(tilt).multiply(new THREE.Matrix4().makeScale(1, 1, b.r(0.8, 1.35)));
    b.add(g, { matrix: mat4, normals: 'blend', blend: 0.55, color: col, mat: MAT.SNOW, leaf: 1, flutter: 0.25, pivot: piv });
  }
  if (y0 + h > 0) {
    const cap = blobGeo(b, r * 0.42, 0, { lump: 0.3, squash: 0.6, freq: 2.0 });
    b.add(cap, { matrix: M(0, y0 + h * 0.86, 0, 0, b.r(0, TAU), 0), normals: 'blend', blend: 0.6, color: col, mat: MAT.SNOW, leaf: 1, flutter: 0.25, pivot: piv });
  }
}

function buildBirch(b, v, lod) {
  if (v === 2) return buildBirchClump(b, lod);
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
  foliage(b, blobs.map((bl) => ({ ...bl, d: lod ? 'd' : 1, lump: 0.26 })), pal, { lump: 0.26, freq: 2.0, mat: MAT.DLEAF });
  return { bendScale: 1.25, height: H + 0.4 };
}

// A clump of three slender birches leaning out from one root, each with a
// small airy crown: the classic birch grove silhouette.
function buildBirchClump(b, lod) {
  const stems = [
    [V(0.22, 0, 0.06), 1.75],
    [V(-0.16, 0, 0.18), 1.45],
    [V(-0.02, 0, -0.24), 1.6],
  ];
  const pal = P.birch;
  const blobs = [];
  for (const [dir, H] of stems) {
    const top = V(dir.x * 0.75, H, dir.z * 0.75);
    const pts = bezier(V(dir.x * 0.08, 0, dir.z * 0.08), V(dir.x * 0.3, H * 0.5, dir.z * 0.3), top, lod ? 2 : 6);
    const bark = (p, n, fc) => {
      const h1 = hashV(V(Math.floor(fc.y * 11), Math.floor(fc.x * 40 + fc.z * 40), 7));
      const dark = h1 < 0.24 || (fc.y < 0.1 && h1 < 0.6);
      const c = dark ? C(0x2e2a26) : mix3(P.birchBark.base, P.birchBark.top, clamp01(fc.y / H + 0.3));
      return mul3(c, (0.7 + 0.3 * smooth(0, 0.25, p.y)) * (0.9 + 0.12 * clamp01(n.y * 0.5 + 0.5)));
    };
    trunk(b, pts, pts.map((_, i) => 0.05 - (0.026 * i) / (pts.length - 1)), lod ? 4 : 5, null, { color: bark, faceColor: true, yTop: H });
    blobs.push({ p: V(top.x, H + (lod ? -0.06 : 0.04), top.z), r: lod ? 0.33 : 0.27, sq: lod ? 1.3 : 1 });
    if (!lod) blobs.push({ p: V(top.x * 1.15, H - 0.24, top.z * 1.15), r: 0.22 });
    if (!lod) blobs.push({ p: V(top.x * 0.9, H + 0.3, top.z * 0.9), r: 0.18 });
  }
  foliage(b, blobs.map((bl) => ({ ...bl, d: lod ? 'd' : 1, lump: 0.28 })), pal, { lump: 0.28, freq: 2.0, mat: MAT.DLEAF });
  return { bendScale: 1.25, height: 2.1 };
}

function buildPalm(b, v, lod) {
  const H = [2.4, 2.75, 2.1, 2.55][v];
  const leanX = [0.55, 0.35, 0.7, -0.4][v];
  const leanZ = [0.1, -0.25, 0.2, 0.3][v];
  const segs = lod ? 3 : 9;
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
  trunk(b, pts, radii, lod ? 4 : 6, null, { color: bark, faceColor: true, flare: lod ? 0 : 0.35, roots: 3, yTop: H, capTop: !lod });
  const top = pts[segs].clone();
  const tdir = top.clone().sub(pts[segs - 1]).normalize();
  // crown knob
  const knob = lod ? new THREE.OctahedronGeometry(0.12, 0) : blobGeo(b, 0.12, 0, { lump: 0.2 });
  b.add(knob, { matrix: M(top.x, top.y + 0.02, top.z), normals: 'blend', blend: 0.6, color: mix3(P.palm.dark, P.palmBark.base, 0.5), mat: MAT.LEAF, leaf: 1, flutter: 0.2 });
  // coconuts
  if (!lod) {
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU + v;
      const g = new THREE.OctahedronGeometry(0.068, 0);
      b.add(g, { matrix: M(top.x + Math.cos(a) * 0.09, top.y - 0.08, top.z + Math.sin(a) * 0.09), normals: 'blend', blend: 0.8, color: C(0x4a3018), mat: MAT.GLOSS, leaf: 1, flutter: 0.1 });
    }
  }
  const fronds = lod ? 5 : [8, 7, 8, 8][v];
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * TAU + b.r(-0.2, 0.2) + v;
    const len = b.r(1.05, 1.3) * (f % 2 ? 0.9 : 1);
    const up = f % 3 === 0 ? 0.42 : 0.22;
    if (lod) frondLite(b, top, a, len, up);
    else frond(b, top, a, len, up, lod, tdir);
  }
  return { bendScale: 1.1, height: H + 0.3 };
}

// Distant palm frond: one drooping leaf strip.
function frondLite(b, base, ang, len, up) {
  const dir = V(Math.cos(ang), 0, Math.sin(ang));
  const side = V(-dir.z, 0, dir.x);
  const p0 = base.clone().add(V(0, 0.04, 0));
  const p1 = base.clone().addScaledVector(dir, len * 0.5).add(V(0, up + 0.14, 0));
  const p2 = base.clone().addScaledVector(dir, len * 0.95).add(V(0, -len * 0.62 + up * 0.3, 0));
  const sp = bezier(p0, p1, p2, 3);
  const pal = P.palm;
  const o = { leaf: 1, mat: MAT.LEAF, pivot: p0, up: true, bend: NaN, flutter: 1.2 };
  for (let i = 0; i < 3; i++) {
    const w0 = 0.26 * Math.sin(Math.PI * Math.min(1, (i / 3) * 1.05 + 0.08)),
      w1 = 0.26 * Math.sin(Math.PI * Math.min(0.97, ((i + 1) / 3) * 1.05));
    const l0 = sp[i].clone().addScaledVector(side, w0),
      r0 = sp[i].clone().addScaledVector(side, -w0);
    const l1 = sp[i + 1].clone().addScaledVector(side, w1),
      r1 = sp[i + 1].clone().addScaledVector(side, -w1);
    const c0 = mix3(pal.dark, pal.mid, i / 3),
      c1 = mix3(pal.mid, pal.light, (i + 1) / 3);
    b.tri(l0, r0, r1, [c0, c0, c1], o);
    b.tri(l0, r1, l1, [c0, c1, c1], o);
  }
}

// Feathery drooping palm frond: a thin rachis with separate leaflets that
// sweep forward and droop, leaving small gaps so the frond reads as a comb.
function frond(b, base, ang, len, up, lod, tdir) {
  const dir = V(Math.cos(ang), 0, Math.sin(ang));
  const p0 = base.clone().add(V(0, 0.04, 0));
  const p1 = base.clone().addScaledVector(dir, len * 0.5).add(V(0, up + 0.14, 0));
  const p2 = base.clone().addScaledVector(dir, len * 0.95).add(V(0, -len * 0.62 + up * 0.3, 0));
  const n = lod ? 4 : 7;
  const spine = bezier(p0, p1, p2, n);
  const side = V(-dir.z, 0, dir.x);
  const pal = P.palm;
  const o = { leaf: 1, mat: MAT.LEAF, pivot: p0, up: true, bend: NaN };
  // rachis
  for (let i = 0; i < n; i++) {
    const w = 0.016 * (1 - i / n) + 0.004;
    const a0 = spine[i].clone().addScaledVector(side, -w),
      a1 = spine[i].clone().addScaledVector(side, w);
    const b0 = spine[i + 1].clone().addScaledVector(side, -w * 0.8),
      b1 = spine[i + 1].clone().addScaledVector(side, w * 0.8);
    const c0 = mix3(pal.dark, P.palmBark.top, 0.25);
    b.tri(a0, a1, b1, c0, { ...o, flutter: 0.4 + i * 0.1 });
    b.tri(a0, b1, b0, c0, { ...o, flutter: 0.4 + i * 0.1 });
  }
  // leaflets
  const per = lod ? 1 : 2;
  for (let i = 0; i < n; i++) {
    for (let q = 0; q < per; q++) {
      const t = (i + q / per + 0.25) / n;
      if (t > 0.97) continue;
      const k = Math.floor(t * n),
        f = t * n - k;
      const sp = spine[k].clone().lerp(spine[Math.min(n, k + 1)], f);
      const spn = spine[Math.min(n, k + 1)];
      const fwd = spn.clone().sub(spine[k]).normalize();
      const L = (0.3 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.04)), 0.6) + 0.04) * (lod ? 1.2 : 1);
      const wB = (lod ? 0.09 : 0.05) * (1 - t * 0.5);
      const cB = mix3(pal.dark, pal.mid, smooth(0, 0.6, t));
      const cT = mix3(pal.mid, pal.light, 0.4 + t * 0.6);
      const cH = mix3(pal.light, pal.hi, t * 0.5);
      for (const sgn of [-1, 1]) {
        const tip = sp.clone().addScaledVector(side, sgn * L).addScaledVector(fwd, L * 0.55).add(V(0, -L * (0.25 + t * 0.6), 0));
        const mid = sp.clone().addScaledVector(side, sgn * L * 0.5).addScaledVector(fwd, L * 0.3 + wB * 0.5).add(V(0, L * 0.06 - L * t * 0.25, 0));
        const b0 = sp.clone(),
          b1 = sp.clone().addScaledVector(fwd, wB);
        b.tri(b0, sgn > 0 ? tip : b1, sgn > 0 ? b1 : tip, [cB, cH, cT], { ...o, flutter: 1.0 + t * 1.3 });
      }
    }
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
  const rad = [0.66, 0.58, 0.74, 0.64][v];
  for (let L = 0; L < layers; L++) {
    const y = H * 0.82 + 0.18 + L * 0.32;
    const n = L === layers - 1 ? (layers === 3 ? 1 : 2) : 4;
    const rr = rad * (L === layers - 1 ? 0.3 : 1);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + L * 0.7 + v;
      blobs.push({ p: V(top.x + Math.cos(a) * rr, y + b.r(-0.05, 0.05), top.z + Math.sin(a) * rr), r: (L === layers - 1 ? 0.5 : 0.52) * b.r(0.92, 1.1), sq: 0.8 });
    }
  }
  blobs.push({ p: V(top.x + b.r(-0.08, 0.08), H * 0.82 + 0.36 + (layers - 1) * 0.3, top.z + b.r(-0.08, 0.08)), r: 0.6, sq: 0.82 });
  if (lod) blobs = [{ p: V(top.x, H * 0.82 + 0.25, top.z), r: rad + 0.4, sq: 0.5 }, { p: V(top.x, H * 0.82 + 0.6, top.z), r: 0.45, sq: 0.6 }];
  // limbs to the outer blobs
  if (!lod) {
    for (let k = 0; k < Math.min(5, blobs.length); k += 1) {
      const bl = blobs[k];
      if (bl.p.y > H) continue;
      limb(b, top.clone().add(V(0, -0.25, 0)), V(bl.p.x * 0.85 + top.x * 0.15, bl.p.y - 0.1, bl.p.z * 0.85 + top.z * 0.15), 0.05, 0.02, 4, P.jungleBark, H);
    }
  }
  const res = foliage(b, blobs.map((bl) => ({ ...bl, d: lod ? 'd' : 1 })), pal, { lump: 0.24, freq: 1.5 });
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
  foliage(b, blobs.map((bl) => ({ ...bl, d: lod ? 'd' : 1 })), pal, { lump: 0.18, freq: 2.2, aoMin: 0.45 });
  return { bendScale: 0.7, height: 1.8 };
}

function buildWillow(b, v, lod) {
  const pal = P.willow;
  const th = [1.05, 0.95, 1.15][v];
  const lean = [V(0.08, 0, 0.04), V(-0.14, 0, 0.02), V(0.1, 0, -0.14)][v];
  const pts = bezier(V(0, 0, 0), V(-lean.x * 0.9, th * 0.45, lean.z * 0.3), V(lean.x, th, lean.z), lod ? 1 : 3);
  trunk(b, pts, pts.map((_, i) => 0.15 - (0.07 * i) / (pts.length - 1)), lod ? 5 : 7, P.willowBark, { flare: lod ? 0 : 0.7, roots: 3, yTop: 1.8, moss: P.moss });
  const top = pts[pts.length - 1];
  const R = [0.8, 0.7, 0.86][v];
  let blobs = [{ p: V(top.x, th + 0.5, top.z), r: 0.52, sq: 0.68 }];
  const ns = lod ? 0 : 4;
  for (let k = 0; k < ns; k++) {
    const a = (k / ns) * TAU + v * 0.7;
    blobs.push({ p: V(top.x + Math.cos(a) * R * 0.55, th + 0.34 + b.r(-0.04, 0.04), top.z + Math.sin(a) * R * 0.55), r: 0.38, sq: 0.62 });
  }
  if (lod) blobs = [{ p: V(top.x, th + 0.42, top.z), r: R + 0.05, sq: 0.55 }];
  if (!lod) for (let k = 1; k < blobs.length; k++) limb(b, top, V(blobs[k].p.x * 0.9 + top.x * 0.1, blobs[k].p.y - 0.1, blobs[k].p.z * 0.9 + top.z * 0.1), 0.055, 0.025, 4, P.willowBark, 1.8);
  if (!lod) {
    // gnarled prop roots arching out of the trunk into the mud
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + v * 0.9 + b.r(-0.3, 0.3);
      const d = V(Math.cos(a), 0, Math.sin(a));
      const from = V(pts[1].x * 0.5, th * b.r(0.25, 0.4), pts[1].z * 0.5);
      const to = V(d.x * b.r(0.36, 0.5), -0.04, d.z * b.r(0.36, 0.5));
      const mid = from.clone().lerp(to, 0.5).add(V(d.x * 0.1, 0.12, d.z * 0.1));
      const path = bezier(from, mid, to, 3);
      b.add(tubeGeo(path, path.map((_, i) => 0.045 - i * 0.008), 4, { capTop: false }), { normals: 'geoblend', blend: 0.7, color: barkColor(P.willowBark, 1.8, { moss: P.moss }), mat: MAT.WOOD });
    }
  }
  foliage(b, blobs.map((bl) => ({ ...bl, d: lod ? 'd' : 1 })), pal, { lump: 0.18, aoMin: 0.55, mat: MAT.DLEAF });
  // weeping curtain: an outer ring reaching almost to the ground, an inner ring
  const rings = lod ? [[7, 0.9, 0.8]] : [[[22, 18, 24][v], 0.95, 0.94], [8, 0.6, 0.72]];
  const cShade = mix3(pal.dark, pal.mid, 0.35),
    cMid = pal.mid,
    cTip = mix3(pal.light, pal.hi, 0.45);
  for (const [n, rad, len] of rings) {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + b.r(-0.12, 0.12);
      const out = V(Math.cos(a), 0, Math.sin(a));
      const rr = R * rad * b.r(0.9, 1.08);
      const s = V(top.x + out.x * rr * 0.62, th + 0.68 + b.r(-0.05, 0.05), top.z + out.z * rr * 0.62);
      const L = (th + 0.55) * len * b.r(0.88, 1.1);
      const m = s.clone().addScaledVector(out, rr * 0.5).add(V(0, 0.02, 0));
      const e = s.clone().addScaledVector(out, rr * 0.46 + b.r(0.02, 0.1)).add(V(0, -L, 0));
      const segs = lod ? 1 : 3;
      const path = bezier(s, m, e, segs);
      const tan = V(-out.z, 0, out.x);
      const nOut = out.clone().multiplyScalar(0.75).add(V(0, 0.65, 0)).normalize();
      for (let i = 0; i < segs; i++) {
        const t0 = i / segs,
          t1 = (i + 1) / segs;
        const wv = (t, j) => (0.075 * (1 - t * 0.75) + 0.01) * (lod ? 1.2 : j % 2 ? 0.75 : 1.15);
        const w0 = wv(t0, i),
          w1 = wv(t1, i + 1);
        const a0 = path[i].clone().addScaledVector(tan, -w0),
          b0 = path[i].clone().addScaledVector(tan, w0);
        const a1 = path[i + 1].clone().addScaledVector(tan, -w1),
          b1 = path[i + 1].clone().addScaledVector(tan, w1);
        const c0 = t0 < 0.25 ? mix3(cMid, cTip, 0.3) : mix3(cMid, cShade, (t0 - 0.25) / 0.75 * 0.6),
          c1 = t1 < 0.25 ? mix3(cMid, cTip, 0.3) : mix3(cMid, cShade, (t1 - 0.25) / 0.75 * 0.6);
        const o = { leaf: 1, flutter: 0.9 + t0 * 1.4, mat: MAT.DLEAF, pivot: s, bend: NaN, normals: [nOut, nOut, nOut], up: true };
        b.tri(a0, b0, b1, [c0, c0, c1], o);
        b.tri(a0, b1, a1, [c0, c1, c1], o);
      }
    }
  }
  return { bendScale: 0.9, height: 2.0 };
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
  for (let k = 0; k < cfg.length; k += 2) blobs.push({ p: cfg[k], r: cfg[k + 1], sq: 0.86, d: lod ? 'd' : 1, fb: 0.3 });
  if (lod) blobs = blobs.slice(0, 2);
  foliage(b, blobs, pal, { lump: 0.24, freq: 2.2, aoMin: 0.45, flutter: 0.6, mat: MAT.DLEAF });
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
  ].map((bl) => ({ ...bl, d: lod ? 'd' : 1 }));
  foliage(b, lod ? blobs.slice(0, 2) : blobs, P.berryLeaf, { lump: 0.25, freq: 2.4, aoMin: 0.45, flutter: 0.5, mat: MAT.DLEAF });
  blossoms(b, blobs, berry, lod ? 3 : 14, lod ? 0.06 : 0.04, MAT.GLOSS);
  return { bendScale: 0.3, height: 0.6 };
}

const FLOWER_PALETTES = [
  { petals: [0xff8fb4, 0xffffff, 0xffb8d4, 0xff6f9c], heart: 0xffd84a },
  { petals: [0xffd23a, 0xffa22a, 0xfff07a, 0xff8a1a], heart: 0x6a3a14 },
  { petals: [0x8a6aff, 0x5a86ff, 0xb89cff, 0xd8c8ff], heart: 0xfff0a0 },
  { petals: [0xff3b30, 0xff6a2a, 0xffffff, 0xff2a50], heart: 0x2a1a12 },
];
// Wildflower cluster, ~70 triangles: a few leaves, two-sided stems and
// single-sided upward petal fans whose centre vertex carries the heart colour.
function buildFlowers(b, v, lod) {
  const pal = FLOWER_PALETTES[v];
  const n = [9, 8, 10, 7][v];
  const stemC = C(0x3f8a2a),
    stemB = C(0x2a5a1e);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + b.r(0, 0.6);
    const r0 = b.r(0.02, 0.14);
    const base = V(Math.cos(a) * r0, 0, Math.sin(a) * r0);
    const dir = V(Math.cos(a + 0.4), 0, Math.sin(a + 0.4));
    const tip = base.clone().addScaledVector(dir, b.r(0.13, 0.19)).add(V(0, b.r(0.07, 0.12), 0));
    const side = V(-dir.z, 0, dir.x).multiplyScalar(0.045);
    b.tri(base.clone().sub(side), tip, base.clone().add(side), [stemB, C(0x6fae3c), stemB], { leaf: 1, flutter: 0.7, mat: MAT.LEAF, pivot: V(0, 0, 0), up: true });
  }
  const heart = C(pal.heart);
  for (let k = 0; k < n; k++) {
    const a = b.r(0, TAU);
    const rr = Math.sqrt(b.rng()) * 0.34;
    const base = V(Math.cos(a) * rr, 0, Math.sin(a) * rr);
    const h = b.r(0.15, 0.33);
    const head = base.clone().add(V(b.r(-0.04, 0.04), h, b.r(-0.04, 0.04)));
    const sd = V(0.01, 0, 0.01);
    b.tri(base.clone().sub(sd), head, base.clone().add(sd), [stemB, stemC, stemB], { leaf: 1, flutter: 0.8, mat: MAT.LEAF, pivot: base });
    const pc = C(pal.petals[k % pal.petals.length]);
    const np = v === 3 ? 4 : 5;
    const pr = b.r(0.075, 0.11) * (v === 3 ? 1.12 : 1);
    const tilt = V(b.r(-0.3, 0.3), 1, b.r(-0.3, 0.3)).normalize();
    const t1 = V(1, 0, 0).cross(tilt).normalize();
    const t2 = tilt.clone().cross(t1).normalize();
    const rot = b.r(0, TAU);
    const half = (Math.PI / np) * 0.82;
    const centre = head.clone().addScaledVector(tilt, 0.008);
    const outer = mix3(pc, [1, 1, 1], 0.1);
    for (let q = 0; q < np; q++) {
      const a0 = rot + (q / np) * TAU;
      const dl = t1.clone().multiplyScalar(Math.cos(a0 - half)).addScaledVector(t2, Math.sin(a0 - half));
      const dr = t1.clone().multiplyScalar(Math.cos(a0 + half)).addScaledVector(t2, Math.sin(a0 + half));
      const l = head.clone().addScaledVector(dl, pr).addScaledVector(tilt, pr * 0.22);
      const r = head.clone().addScaledVector(dr, pr).addScaledVector(tilt, pr * 0.22);
      b.tri(centre, r, l, [heart, outer, pc], { leaf: 1, flutter: 1.0, mat: MAT.PETAL, pivot: head, up: true, single: true, normals: [tilt, tilt, tilt] });
    }
  }
  return { bendScale: 1.0, height: 0.32 };
}

function buildCactus(b, v, lod) {
  if (v === 1) return buildPricklyPear(b, lod);
  if (v === 3) return buildAgave(b, lod);
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
    b.add(tubeGeo(path, radii, ribs, { capTop: true, flare: ribFn }), { normals: 'geoblend', blend: 0.3, color: col(H), mat: MAT.CACTUS });
    const arms = v === 0 ? [[0.5, 0, 0.3], [0.68, Math.PI * 0.95, 0.38]] : [[0.62, 0.8, 0.42]];
    for (const [hy, ang, up] of arms) {
      const d = V(Math.cos(ang), 0, Math.sin(ang));
      const s = V(0, hy * H, 0).addScaledVector(d, R * 0.6);
      const m = s.clone().addScaledVector(d, 0.26);
      const e = m.clone().add(V(0, up, 0)).addScaledVector(d, 0.03);
      const ap = bezier(s, m.clone().add(V(0, 0.02, 0)), e, lod ? 2 : 5);
      b.add(tubeGeo(ap, ap.map((_, i) => R * 0.62 * (i === ap.length - 1 ? 0.8 : 1)), lod ? 5 : 10, { capTop: true, flare: lod ? null : (i, s2) => (s2 % 2 === 0 ? 1.1 : 0.9) }), { normals: 'geoblend', blend: 0.3, color: col(H), mat: MAT.CACTUS });
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
    b.add(tubeGeo(path, radii, lod ? 6 : 12, { capTop: true, flare: lod ? null : (i, s) => (s % 2 === 0 ? 1.1 : 0.88) }), { normals: 'geoblend', blend: 0.3, color: col(h * 1.6), mat: MAT.CACTUS });
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

// Prickly pear: flat oval pads sprouting from pads, with a few fruits.
function buildPricklyPear(b, lod) {
  const pal = { dark: C(0x3f7a4a), mid: C(0x5e9a5a), light: C(0x8cbf72) };
  const col = (p, n, fc) => mul3(mix3(pal.dark, pal.light, clamp01(0.35 + n.y * 0.35 + p.y * 0.6)), 0.9 + 0.15 * hashV(fc));
  const pads = [[0, 0.16, 0, 0, 0.18], [0.1, 0.36, 0.03, 0.5, 0.15], [-0.11, 0.34, -0.02, -0.55, 0.14], [0.02, 0.52, 0.06, 0.15, 0.12], [0.2, 0.5, 0.0, 0.9, 0.11]];
  const n = lod ? 3 : pads.length;
  for (let k = 0; k < n; k++) {
    const [x, y, z, tilt, r] = pads[k];
    const g = blobGeo(b, 1, lod ? 0 : 'd', { lump: 0.08 });
    b.add(g, { matrix: M(x, y, z, 0, k * 0.9, tilt, r * 0.8, r, r * 0.22), normals: 'blend', blend: 0.6, center: V(x, y, z), color: col, mat: MAT.CACTUS });
    if (!lod && k > 0) {
      const f = new THREE.OctahedronGeometry(0.03, 0);
      b.add(f, { matrix: M(x + Math.sin(tilt) * r * 0.9, y + Math.cos(tilt) * r * 0.95, z), normals: 'blend', blend: 0.7, color: k % 2 ? C(0xd8406a) : C(0xf0b040), mat: MAT.PETAL, leaf: 1, flutter: 0.1 });
    }
  }
  return { bendScale: 0.04, height: 0.6 };
}

// Agave: a rosette of thick pointed blue-green leaves.
function buildAgave(b, lod) {
  const base = C(0x5f8a7c),
    tip = C(0x9cc0a8),
    edge = C(0x3e5e52);
  const n = lod ? 7 : 13;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + (k % 2) * 0.24;
    const d = V(Math.cos(a), 0, Math.sin(a));
    const s = V(-d.z, 0, d.x);
    const inner = k % 2 === 0;
    const L = inner ? 0.3 : 0.4;
    const lift = inner ? 0.36 : 0.2;
    const root = d.clone().multiplyScalar(0.03);
    const tipP = d.clone().multiplyScalar(L).add(V(0, lift, 0));
    const w = 0.07;
    const midL = d.clone().multiplyScalar(L * 0.35).addScaledVector(s, w).add(V(0, lift * 0.4, 0));
    const midR = d.clone().multiplyScalar(L * 0.35).addScaledVector(s, -w).add(V(0, lift * 0.4, 0));
    const ridge = d.clone().multiplyScalar(L * 0.35).add(V(0, lift * 0.4 + 0.035, 0));
    const o = { mat: MAT.CACTUS, flutter: 0, leaf: 0 };
    b.tri(root, midR, ridge, [edge, base, base], o);
    b.tri(root, ridge, midL, [edge, base, base], o);
    b.tri(midR, tipP, ridge, [base, tip, base], o);
    b.tri(ridge, tipP, midL, [base, tip, base], o);
  }
  return { bendScale: 0.03, height: 0.4 };
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
  const cap = new THREE.SphereGeometry(r, 8, 3, 0, TAU, 0, Math.PI * 0.55);
  const top = stem[1];
  b.add(cap, {
    matrix: M(top.x, top.y - r * 0.18, top.z, 0, b.r(0, TAU), 0, 1, o.sq ?? 0.62, 1),
    normals: 'geoblend',
    blend: 0.65,
    color: (p, n) => mul3(capC, 0.65 + 0.35 * clamp01(n.y) * (0.92 + 0.1 * hashV(p))),
    mat: MAT.SHROOM,
    leaf: 1,
    flutter: 0.05,
    pivot: V(x, 0, z),
  });
  // gills / underside
  const under = new THREE.CircleGeometry(r * 0.98, 8);
  b.add(under, { matrix: M(top.x, top.y - r * 0.18 - r * 0.15 * (o.sq ?? 0.62), top.z, Math.PI / 2, 0, 0), normals: 'flat', color: mul3(stemC, 0.7), mat: MAT.WOOD, leaf: 1, flutter: 0.05, pivot: V(x, 0, z) });
  if (spots) {
    for (let k = 0; k < spots; k++) {
      const a = b.r(0, TAU),
        el = b.r(0.25, 1.2);
      const dir = V(Math.cos(a) * Math.sin(el), Math.cos(el), Math.sin(a) * Math.sin(el));
      const p = V(top.x + dir.x * r * 0.98, top.y - r * 0.18 + dir.y * r * (o.sq ?? 0.62) * 0.98 + 0.004, top.z + dir.z * r * 0.98);
      const g = new THREE.OctahedronGeometry(r * b.r(0.12, 0.18), 0);
      b.add(g, { matrix: M(p.x, p.y, p.z, 0, 0, 0, 1, 0.45, 1), normals: 'up', color: C(0xfff6e8), mat: MAT.SHROOM, leaf: 1, flutter: 0.05, pivot: V(x, 0, z) });
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
  } else if (v === 3) {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU + 0.3;
      const rr = k ? 0.12 : 0;
      mushroom(b, Math.cos(a) * rr, Math.sin(a) * rr, b.r(0.05, 0.1), b.r(0.04, 0.06), mix3(tan, C(0xf4e6c8), b.rng()), C(0xf4ecdc), 0, { sq: 0.55 });
    }
  } else {
    // glowcap grove: slender stems under luminous bell caps (built ~2x so it
    // still reads after the species' small scale); they glow at night
    const n = lod ? 4 : 8;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + b.r(0, 0.7);
      const rr = k ? b.r(0.14, 0.42) : 0;
      glowcap(b, Math.cos(a) * rr, Math.sin(a) * rr, b.r(0.26, 0.58) * (k ? 1 : 1.2), b.r(0.09, 0.15) * (k ? 1 : 1.25));
    }
  }
  return { bendScale: 0.1, height: 0.3 };
}

function glowcap(b, x, z, h, r) {
  const lean = V(b.r(-0.05, 0.05), 0, b.r(-0.05, 0.05));
  const top = V(x + lean.x, h, z + lean.z);
  b.add(tubeGeo([V(x, 0, z), V(x + lean.x * 0.5, h * 0.55, z + lean.z * 0.5), top], [r * 0.24, r * 0.2, r * 0.17], 5, { capTop: false }), { normals: 'geo', color: (p) => mul3(C(0xe8f0ea), 0.7 + 0.3 * smooth(0, h, p.y)), mat: MAT.WOOD, leaf: 1, flutter: 0.05, pivot: V(x, 0, z) });
  const cap = new THREE.SphereGeometry(r, 8, 3, 0, TAU, 0, Math.PI * 0.5);
  b.add(cap, { matrix: M(top.x, top.y - r * 0.15, top.z, 0, b.r(0, TAU), 0, 1, 0.95, 1), normals: 'geoblend', blend: 0.7, color: (p, n) => mul3(C(0xf2f8f4), 0.75 + 0.25 * clamp01(n.y)), mat: MAT.GLOW, leaf: 1, flutter: 0.05, pivot: V(x, 0, z) });
  const under = new THREE.CircleGeometry(r * 0.98, 8);
  b.add(under, { matrix: M(top.x, top.y - r * 0.15, top.z, Math.PI / 2, 0, 0), normals: 'flat', color: C(0xcfe0d6), mat: MAT.GLOW, leaf: 1, flutter: 0.05, pivot: V(x, 0, z) });
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
  const ripe = C(0xeab43e),
    ripeD = C(0xb07c24),
    head = C(0xf8d86a);
  // a softly domed, mottled sheet of ears at canopy height makes the field read
  // as a dense crop from above; brighter heads poke through it
  const G = lod ? 2 : 4;
  const E = 0.47;
  const hgt = [],
    shade = [];
  for (let j = 0; j <= G; j++)
    for (let i = 0; i <= G; i++) {
      const edge = i === 0 || j === 0 || i === G || j === G;
      const corner = (i === 0 || i === G) && (j === 0 || j === G);
      hgt.push(corner ? 0.1 : edge ? 0.19 + b.r(0, 0.04) : 0.28 + b.r(-0.03, 0.04));
      shade.push(b.r(0.72, 1.0));
    }
  const P0 = (i, j) => {
    const corner = (i === 0 || i === G) && (j === 0 || j === G);
    const k = corner ? 0.82 : 1;
    return V((-E + (2 * E * i) / G) * k, hgt[j * (G + 1) + i], (-E + (2 * E * j) / G) * k);
  };
  const cs = (i, j) => mul3(mix3(ripeD, ripe, 0.4 + (hgt[j * (G + 1) + i] - 0.17) * 2.4), shade[j * (G + 1) + i]);
  const so = { leaf: 0.2, flutter: 0.3, mat: MAT.WHEAT, pivot: V(0, 0, 0), up: true, single: true, bend: 0.55 };
  for (let j = 0; j < G; j++)
    for (let i = 0; i < G; i++) {
      b.tri(P0(i, j), P0(i, j + 1), P0(i + 1, j + 1), [cs(i, j), cs(i, j + 1), cs(i + 1, j + 1)], so);
      b.tri(P0(i, j), P0(i + 1, j + 1), P0(i + 1, j), [cs(i, j), cs(i + 1, j + 1), cs(i + 1, j)], so);
    }
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
kind(FLORA.OAK, 4, buildOak, { scale: [0.9, 1.15], far2: true });
kind(FLORA.PINE, 4, (b, v, l) => buildPine(b, v, l, false), { far2: 'cone' });
kind(FLORA.SNOW_PINE, 4, (b, v, l) => buildPine(b, v, l, true), { far2: 'cone' });
kind(FLORA.BIRCH, 4, buildBirch, { far2: true });
kind(FLORA.PALM, 4, buildPalm, { jitter: 0.25, far2: true });
kind(FLORA.JUNGLE_TREE, 4, buildJungle, { scale: [0.92, 1.18], far2: true });
kind(FLORA.ACACIA, 3, buildAcacia, { scale: [0.9, 1.15], far2: true });
kind(FLORA.SWAMP_TREE, 3, buildWillow, { far2: true });
kind(FLORA.DEAD_TREE, 4, buildDead);
kind(FLORA.BUSH, 4, buildBush, { jitter: 0.28, castShadow: false, far2: true, farEarly: true, smallLod: true, scale: [0.68, 0.9] });
kind(FLORA.BERRY_BUSH, 3, buildBerry, { jitter: 0.26, castShadow: false, far2: true, farEarly: true, smallLod: true, scale: [0.7, 0.88] });
kind(FLORA.FLOWERS, 4, buildFlowers, { far: 'skip', castShadow: false, jitter: 0.25, scale: [0.7, 0.9] });
kind(FLORA.CACTUS, 4, buildCactus, { jitter: 0.24, scale: [1.05, 1.4] });
kind(FLORA.REEDS, 3, buildReeds, { far: 'skip', castShadow: false, jitter: 0.25, scale: [0.7, 0.85] });
kind(FLORA.MUSHROOM, 5, buildMushroom, { far: 'skip', castShadow: false, jitter: 0.3, scale: [0.46, 0.62] });
kind(FLORA.ROCK_SMALL, 4, buildStones, { far: 'skip', castShadow: false, jitter: 0.28, tilt: 0.6, scale: [0.9, 1.3], sink: 0.02 });
kind(FLORA.BOULDER, 4, buildBoulder, { jitter: 0.12, tilt: 0.5, scale: [0.9, 1.15], sink: 0.08 });
kind(FLORA.STUMP, 3, buildStump, { far: 'skip', castShadow: false, jitter: 0.2, scale: [0.8, 0.95] });
kind(FLORA.WHEAT, 3, buildWheat, { castShadow: false, jitter: 0, scale: [1, 1], snapYaw: true, sink: 0.0 });

// LOD2: an ultra-cheap stand-in (~10-30 triangles) derived from a species'
// LOD1 bounds and colours, shared by all its variants, for far zoom.
function buildFar(src, cfg, seed) {
  const P2 = src.attributes.position,
    I2 = src.attributes.aInfo,
    C2 = src.attributes.color;
  const lo = V(Infinity, Infinity, Infinity),
    hi = V(-Infinity, -Infinity, -Infinity);
  const leafC = [0, 0, 0],
    woodC = [0, 0, 0];
  let nl = 0,
    nw = 0,
    ns = 0,
    nd = 0;
  for (let k = 0; k < P2.count; k++) {
    const mat = I2.getW(k),
      leaf = I2.getZ(k) > 0.5;
    if (leaf) {
      lo.min(V(P2.getX(k), P2.getY(k), P2.getZ(k)));
      hi.max(V(P2.getX(k), P2.getY(k), P2.getZ(k)));
      if (Math.abs(mat - MAT.SNOW) < 0.5) ns++;
      else if (Math.abs(mat - MAT.LEAF) < 0.5 || Math.abs(mat - MAT.DLEAF) < 0.5) {
        if (Math.abs(mat - MAT.DLEAF) < 0.5) nd++;
        leafC[0] += C2.getX(k), leafC[1] += C2.getY(k), leafC[2] += C2.getZ(k);
        nl++;
      }
    } else if (Math.abs(mat - MAT.WOOD) < 0.5) {
      woodC[0] += C2.getX(k), woodC[1] += C2.getY(k), woodC[2] += C2.getZ(k);
      nw++;
    }
  }
  if (!nl) return null;
  const lc = mul3(leafC, 1 / nl),
    wc = nw ? mul3(woodC, 1 / nw) : lc;
  const fmat = nd > nl * 0.5 ? MAT.DLEAF : MAT.LEAF;
  const b = new MeshBuilder(seed);
  const ctr = lo.clone().add(hi).multiplyScalar(0.5);
  const ext = hi.clone().sub(lo).multiplyScalar(0.5 * 0.92);
  const snowy = ns > 0;
  const shade = (p, n) => {
    const t = clamp01((p.y - lo.y) / (hi.y - lo.y + 1e-6));
    let c = mul3(lc, 0.7 + 0.55 * t * clamp01(0.5 + n.y * 0.5) + 0.1);
    if (snowy && t > 0.35) c = mix3(c, P.snow.light, 0.55);
    return c;
  };
  if (cfg.far2 === 'cone') {
    const apex = V(ctr.x, hi.y, ctr.z);
    const ring = [];
    const rr = Math.max(ext.x, ext.z);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      ring.push(V(ctr.x + Math.cos(a) * rr, lo.y + 0.05, ctr.z + Math.sin(a) * rr));
    }
    const start = b.count;
    for (let k = 0; k < 6; k++) b.tri(apex, ring[(k + 1) % 6], ring[k], [1, 1, 1], { leaf: 1, flutter: 0.3, mat: fmat, pivot: ctr, single: true });
    recolorRange(b, start, shade, V(ctr.x, lo.y, ctr.z), 0.4);
  } else {
    const g = new THREE.IcosahedronGeometry(1, 0);
    b.add(g, { matrix: M(ctr.x, ctr.y, ctr.z, 0, 0.4, 0, ext.x, ext.y, ext.z), normals: 'blend', blend: 0.55, center: ctr, color: shade, leaf: 1, mat: fmat, pivot: ctr });
  }
  if (nw && lo.y > 0.2) {
    b.add(tubeGeo([V(0, 0, 0), V(ctr.x * 0.6, lo.y + ext.y * 0.4, ctr.z * 0.6)], [0.075, 0.05], 3, { capTop: false }), { normals: 'geo', color: (p) => mul3(wc, 0.7 + 0.3 * clamp01(p.y)), mat: MAT.WOOD });
  }
  return b.build({ bendScale: 0.8, height: hi.y });
}

// LOD3: a 4-triangle coloured canopy "dot" (square pyramid) per species for
// whole-map views of large worlds.
function buildDot(src, cfg, seed) {
  const P2 = src.attributes.position,
    I2 = src.attributes.aInfo,
    C2 = src.attributes.color;
  const lo = V(Infinity, Infinity, Infinity),
    hi = V(-Infinity, -Infinity, -Infinity);
  const acc = [0, 0, 0];
  let n = 0;
  let anyLeaf = false;
  for (let k = 0; k < P2.count; k++) if (I2.getZ(k) > 0.5) anyLeaf = true;
  for (let k = 0; k < P2.count; k++) {
    if (anyLeaf && I2.getZ(k) <= 0.5) continue;
    const p = V(P2.getX(k), P2.getY(k), P2.getZ(k));
    lo.min(p);
    hi.max(p);
    if (Math.abs(I2.getW(k) - MAT.SNOW) > 0.5) {
      acc[0] += C2.getX(k), acc[1] += C2.getY(k), acc[2] += C2.getZ(k);
      n++;
    }
  }
  if (!n) return null;
  const c = mul3(acc, 1 / n);
  const b = new MeshBuilder(seed);
  const ctr = lo.clone().add(hi).multiplyScalar(0.5);
  const rx = (hi.x - lo.x) * 0.5,
    rz = (hi.z - lo.z) * 0.5;
  const apex = V(ctr.x, hi.y, ctr.z);
  const y0 = Math.max(0.02, lo.y + (hi.y - lo.y) * 0.25);
  const ring = [V(ctr.x + rx, y0, ctr.z), V(ctr.x, y0, ctr.z + rz), V(ctr.x - rx, y0, ctr.z), V(ctr.x, y0, ctr.z - rz)];
  const top = mul3(c, 1.18),
    base = mul3(c, 0.72);
  let dec = 0;
  for (let k = 0; k < P2.count; k++) if (Math.abs(I2.getW(k) - MAT.DLEAF) < 0.5) dec++;
  const dmat = !anyLeaf ? MAT.ROCK : dec > P2.count * 0.25 ? MAT.DLEAF : MAT.LEAF;
  for (let k = 0; k < 4; k++) b.tri(apex, ring[(k + 1) % 4], ring[k], [top, base, base], { leaf: anyLeaf ? 1 : 0, flutter: 0, mat: dmat, pivot: ctr, single: true, bend: 0 });
  return b.build({ bendScale: 0 });
}

// Build every model: returns KINDS-indexed { variants: [[lod0, lod1|null, lod2?], ...], cfg }
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
    if (k.far2 && variants[0][1]) {
      const far = buildFar(variants[0][1], k, k.id * 31 + 7);
      if (far) {
        far.userData.kind = k.id;
        verts += far.attributes.position.count;
        for (const lods of variants) lods[2] = far;
      }
    }
    let dot = null;
    if (k.far === 'lod' && !k.smallLod) {
      dot = buildDot(variants[0][1] || variants[0][0], k, k.id * 53 + 11);
      if (dot) dot.userData.kind = k.id;
    }
    out[k.id] = { cfg: k, variants, dot };
  }
  out.totalVerts = verts;
  return out;
}
