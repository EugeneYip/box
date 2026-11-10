import * as THREE from 'three';
import { GeoBuilder, shade } from '../buildings/geom.js';

// Procedural low-poly models for every vehicle of the Fleets module, built
// with the buildings' GeoBuilder (flat facets, vertex colours, aTint realm
// colour mask, aGlow night lamps) plus an aAnim attribute driving the vertex
// animation in materials.js:
//   aAnim.x = kind + 16 * (variant + 1)   (variant 0 = every variant)
//   kinds: 0 static, 1 square sail (y=u, z=v, w=furl y), 10 fore-and-aft sail,
//          2 oar (yzw pivot), 3 wheel (yzw axle), 4 pennant (y=u), 5 catapult
//          arm (yzw pivot), 6 ram log, 7/8 legs in opposite phase (yzw hip)
// Every model faces +X, the waterline (or the ground) at y = 0.
// Returns {geo, flags: [{x, y, z, s}], length}.

const WOOD = 0x7a5232;
const WOOD2 = 0x9a6a3e;
const WOOD3 = 0x5a3a22;
const DECK = 0xb08a5a;
const SAIL = 0xf1e6cc;
const ROPE = 0x4a3a28;
const IRON = 0x5d6168;
const BRONZE = 0xb0803a;
const HULL_LOW = 0x6a3a2a;
const SKIN = [0xe8b896, 0xc8926a, 0x9a6a48, 0xf0c8a8];
const SHIRT = [0x8a5a3a, 0x5a6a8a, 0x8a3a3a, 0x6a7a4a, 0xc8b890, 0x4a4a5a];

class VB extends GeoBuilder {
  constructor(seed) {
    super(seed, { ao: false, jitter: 0.045 });
    this.A = [];
    this.cur = [0, 0, 0, 0];
    this.animFn = null;
  }
  setAnim(k = 0, a = 0, b = 0, c = 0, variant = -1) {
    this.cur = [k + (variant >= 0 ? 16 * (variant + 1) : 0), a, b, c];
    this.animFn = null;
    return this;
  }
  tri(...args) {
    const n0 = this.P.length;
    super.tri(...args);
    for (let i = n0; i < this.P.length; i += 3) {
      if (this.animFn) this.A.push(...this.animFn(this.P[i], this.P[i + 1], this.P[i + 2]));
      else this.A.push(this.cur[0], this.cur[1], this.cur[2], this.cur[3]);
    }
  }
  build() {
    const g = super.build();
    g.setAttribute('aAnim', new THREE.Float32BufferAttribute(this.A, 4));
    return g;
  }
}

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- hull
// Lofted hull: stations from stern (t=0) to bow (t=1); a tinted wale stripe
// under the rail, dark planking below the waterline, a deck and an inner
// bulwark so the hull reads from above.
function hull(g, o) {
  const { L, W, H, D } = o;
  const N = o.stations || 10;
  const st = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = -L / 2 + t * L;
    let wf;
    const mid = o.mid ?? 0.58;
    if (t < mid) wf = 1 - Math.pow((mid - t) / mid, 2) * (1 - (o.transom ?? 0.5));
    else wf = Math.sqrt(Math.max(0, 1 - Math.pow((t - mid) / (1 - mid), o.bowPow ?? 2)));
    if (i === N) wf = 0;
    const hw = (W / 2) * wf;
    const gy = H + (o.sheer ?? 0.06) * Math.pow(2 * t - 1, 2) + (o.bow ?? 0) * smooth(0.72, 1, t) + (o.stern ?? 0) * smooth(0.28, 0, t);
    const ky = -D * (0.3 + 0.7 * Math.sqrt(Math.max(0, 1 - Math.pow(2 * t - 1, 6))));
    st.push({ x, hw, gy, ky });
  }
  const col = o.col ?? WOOD;
  const low = o.low ?? HULL_LOW;
  const wale = o.wale ?? 0.07;
  const waleTint = o.waleTint ?? 1;
  const waleCol = o.waleCol ?? 0x9a3a2a;
  const deckY = (s) => s.gy - (o.deckDrop ?? 0.06);
  for (let i = 0; i < N; i++) {
    const a = st[i],
      b = st[i + 1];
    const cx = (a.x + b.x) / 2;
    for (const s of [-1, 1]) {
      const ctr = [cx, 0, 0];
      const G = (p) => [p.x, p.gy, s * p.hw];
      const S = (p) => [p.x, p.gy - wale, s * p.hw * 0.995];
      const B = (p) => [p.x, p.ky * 0.42, s * p.hw * 0.9];
      const K = (p) => [p.x, p.ky, 0];
      g.quad(G(a), G(b), S(b), S(a), waleCol, waleTint, 0, ctr);
      g.quad(S(a), S(b), B(b), B(a), col, 0, 0, ctr);
      g.quad(B(a), B(b), K(b), K(a), low, 0, 0, ctr);
      // rail cap and inner bulwark
      const I = (p) => [p.x, p.gy, s * p.hw * 0.88];
      const Id = (p) => [p.x, deckY(p), s * p.hw * 0.88];
      g.quad(G(a), G(b), I(b), I(a), shade(col, 1.15), 0, 0, [cx, -5, 0]);
      g.quad(I(a), I(b), Id(b), Id(a), shade(col, 0.82), 0, 0, [cx, (a.gy + deckY(a)) / 2, s * (a.hw + 3)]);
    }
    // deck
    g.quad([a.x, deckY(a), -a.hw * 0.88], [b.x, deckY(b), -b.hw * 0.88], [b.x, deckY(b), b.hw * 0.88], [a.x, deckY(a), a.hw * 0.88], i % 2 ? o.deck ?? DECK : shade(o.deck ?? DECK, 0.94), 0, 0, [cx, -5, 0]);
  }
  // transom
  const s0 = st[0];
  const ring = [
    [s0.x, s0.gy, -s0.hw],
    [s0.x, s0.gy - wale, -s0.hw],
    [s0.x, s0.ky * 0.42, -s0.hw * 0.9],
    [s0.x, s0.ky, 0],
    [s0.x, s0.ky * 0.42, s0.hw * 0.9],
    [s0.x, s0.gy - wale, s0.hw],
    [s0.x, s0.gy, s0.hw],
  ];
  const c0 = [s0.x, (s0.gy + s0.ky) / 2, 0];
  for (let i = 0; i < ring.length - 1; i++) g.tri(c0, ring[i], ring[i + 1], shade(col, 0.9), 0, 0, [s0.x + 1, c0[1], 0]);
  g.tri(c0, ring[ring.length - 1], ring[0], shade(col, 0.9), 0, 0, [s0.x + 1, c0[1], 0]);
  return st;
}

function stationAt(st, x) {
  for (let i = 0; i < st.length - 1; i++) {
    if (x >= st[i].x && x <= st[i + 1].x) {
      const t = (x - st[i].x) / (st[i + 1].x - st[i].x || 1);
      return { hw: st[i].hw + (st[i + 1].hw - st[i].hw) * t, gy: st[i].gy + (st[i + 1].gy - st[i].gy) * t };
    }
  }
  return st[x < st[0].x ? 0 : st.length - 1];
}

// ---------------------------------------------------------------- rigging
function mast(g, x, y0, h, r = 0.035) {
  g.setAnim(0);
  g.cyl(x, y0, 0, r, h, 6, WOOD3, { r2: r * 0.7 });
}
function yard(g, x, y, half, r = 0.022) {
  g.beam(x, y, -half, x, y, half, r * 2, WOOD3);
}
function line(g, a, b, th = 0.011) {
  g.beam(a[0], a[1], a[2], b[0], b[1], b[2], th, ROPE);
}

// Square sail hung from a yard at (x, yTop), half-width hw, depth h.
// stripes: number of vertical cloths; tinted cloths alternate (or a cross).
function squareSail(g, x, yTop, hw, h, o = {}) {
  const nu = o.cols ?? 6,
    nv = 4;
  const yBot = yTop - h;
  const pattern = o.pattern ?? 'stripes';
  const cell = (i, j) => {
    if (pattern === 'stripes') return i % 2 === 1 ? 1 : 0;
    if (pattern === 'cross') return i === Math.floor(nu / 2) || i === Math.floor(nu / 2) - 1 || j === 1 ? 1 : 0;
    if (pattern === 'band') return j === nv - 1 ? 1 : 0;
    return 0;
  };
  g.animFn = (px, py, pz) => [1, (pz + hw) / (2 * hw), (yTop - py) / h, yTop];
  const taper = o.taper ?? 0.06;
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const u0 = i / nu,
        u1 = (i + 1) / nu,
        v0 = j / nv,
        v1 = (j + 1) / nv;
      const zA = (u, v) => -hw + u * 2 * hw * (1 - taper * v) + hw * taper * v;
      const P = (u, v) => [x, yTop - v * h, zA(u, v)];
      const t = cell(i, j);
      const c = t ? SAIL : shade(SAIL, 0.97 + ((i + j) % 2) * 0.03);
      for (const side of [1, -1]) g.quad(P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1), c, t * (o.tint ?? 1), 0, [x - side, yTop - h / 2, 0], 0.01);
    }
  g.setAnim(0);
  void yBot;
}

// Triangular fore-and-aft (lateen) sail in the XY plane under a slanted yard.
function lateenSail(g, x0, y0, x1, y1, xFoot, yFoot, o = {}) {
  // corners: yard start (x0,y0) low fore, yard end (x1,y1) high aft, foot (xFoot,yFoot)
  const nu = 4,
    nv = 3;
  const yardY = (x) => y0 + ((x - x0) / (x1 - x0 || 1)) * (y1 - y0);
  const minX = Math.min(x0, x1, xFoot),
    maxX = Math.max(x0, x1, xFoot);
  const maxY = Math.max(y0, y1),
    minY = yFoot;
  g.animFn = (px, py) => [10, (px - minX) / (maxX - minX || 1), (maxY - py) / (maxY - minY || 1), yardY(px)];
  // barycentric grid over the triangle A (x0,y0) B (x1,y1) C (foot)
  const A = [x0, y0],
    B = [x1, y1],
    C = [xFoot, yFoot];
  const pt = (i, j) => {
    // i along AB, j toward C
    const a = 1 - i / nu - j / nu,
      b = i / nu,
      c = j / nu;
    return [A[0] * a + B[0] * b + C[0] * c, A[1] * a + B[1] * b + C[1] * c, 0];
  };
  for (let j = 0; j < nu; j++)
    for (let i = 0; i < nu - j; i++) {
      const p00 = pt(i, j),
        p10 = pt(i + 1, j),
        p01 = pt(i, j + 1);
      const t = o.tintRow != null && j === o.tintRow ? 1 : 0;
      const c = t ? SAIL : shade(SAIL, 0.96 + ((i + j) % 2) * 0.04);
      for (const s of [1, -1]) g.tri(p00, p10, p01, c, t, 0, [p00[0], p00[1], -s]);
      if (i < nu - j - 1) {
        const p11 = pt(i + 1, j + 1);
        for (const s of [1, -1]) g.tri(p10, p11, p01, c, t, 0, [p10[0], p10[1], -s]);
      }
    }
  void nv;
  g.setAnim(0);
  g.beam(x0, y0, 0, x1, y1, 0, 0.03, WOOD3);
}

function pennant(g, x, y, len = 0.28, w = 0.06) {
  // small streamer at a masthead, tinted, waving
  g.animFn = (px) => [4, Math.max(0, Math.min(1, (px - x) / len)), 0, 0];
  for (const s of [1, -1]) g.tri([x, y, 0], [x, y - w, 0], [x + len, y - w * 0.5, 0], 0xffffff, 1, 0, [x, y, -s]);
  g.setAnim(0);
}

// A small crew figure (half the scale of a villager: the ships are dioramas)
function figure(g, x, y, z, seed, s = 1) {
  const sk = SKIN[seed % SKIN.length],
    sh = SHIRT[(seed * 7) % SHIRT.length];
  g.box(x, y, z, 0.07 * s, 0.1 * s, 0.09 * s, 0x4a3a2a);
  g.box(x, y + 0.1 * s, z, 0.09 * s, 0.13 * s, 0.12 * s, sh);
  g.bead(x, y + 0.22 * s, z, 0.045 * s, sk);
}

function oars(g, st, xs, side, len, y, amp = 1) {
  for (const x of xs) {
    const s = stationAt(st, x);
    const pz = side * s.hw;
    const py = s.gy - 0.02;
    g.setAnim(2, x, py, pz);
    // shaft out and down to the water, blade at the end
    const ex = x - 0.05,
      ez = pz + side * len,
      ey = y;
    g.beam(x, py, pz, ex, ey, ez, 0.022, WOOD2);
    g.beam(ex + 0.0, ey + 0.02, ez - side * 0.04, ex, ey - 0.02, ez + side * 0.1, 0.06, WOOD2, { thY: 0.012 });
  }
  g.setAnim(0);
  void amp;
}

function shields(g, st, x0, x1, n, side) {
  for (let i = 0; i < n; i++) {
    const x = x0 + ((x1 - x0) * (i + 0.5)) / n;
    const s = stationAt(st, x);
    g.push();
    g.translate(x, s.gy - 0.05, side * (s.hw + 0.012));
    g.rotateX(Math.PI / 2);
    g.cyl(0, -0.012, 0, 0.065, 0.024, 8, i % 2 ? 0xe8dcc0 : 0xffffff, { tint: i % 2 ? 0 : 1 });
    g.bead(0, 0.012, 0, 0.016, BRONZE);
    g.pop();
  }
}

function castle(g, x, y, len, hw, h, col = WOOD) {
  g.box(x, y, 0, len, h, hw * 2, col, { top: DECK });
  // crenellated rail
  const n = Math.max(3, Math.round(len / 0.12));
  for (let i = 0; i < n; i++)
    for (const s of [-1, 1]) g.box(x - len / 2 + (len * (i + 0.5)) / n, y + h, s * (hw - 0.02), (len / n) * 0.55, 0.06, 0.04, i % 2 ? shade(col, 1.1) : 0xffffff, { tint: i % 2 ? 0 : 0.8 });
  for (let i = 0; i < Math.max(2, Math.round((hw * 2) / 0.12)); i++) {
    const m = Math.max(2, Math.round((hw * 2) / 0.12));
    for (const e of [-1, 1]) g.box(x + e * (len / 2 - 0.02), y + h, -hw + (hw * 2 * (i + 0.5)) / m, 0.04, 0.06, ((hw * 2) / m) * 0.55, shade(col, 1.1));
  }
}

function lantern(g, x, y, z) {
  g.box(x, y, z, 0.05, 0.12, 0.05, IRON);
  g.box(x, y + 0.02, z, 0.06, 0.07, 0.06, 0xffc070, { glow: 1 });
}

function crates(g, x, z, n, seed) {
  for (let i = 0; i < n; i++) {
    const ox = x + ((i % 2) - 0.5) * 0.14,
      oz = z + (Math.floor(i / 2) - 0.5) * 0.14;
    if ((seed + i) % 3 === 0) g.cyl(ox, 0, oz, 0.05, 0.11, 6, 0x8a5a32);
    else g.box(ox, 0, oz, 0.11, 0.1, 0.11, 0xa8804e);
  }
}

// ---------------------------------------------------------------- vessels
function fishing() {
  const g = new VB(11);
  const st = hull(g, { L: 1.0, W: 0.36, H: 0.12, D: 0.07, sheer: 0.04, bow: 0.04, stern: 0.02, transom: 0.35, wale: 0.025, waleTint: 1, col: WOOD2, deck: 0x8a6a46, deckDrop: 0.05 });
  // thwarts, nets, basket
  g.box(0.05, 0.05, 0, 0.06, 0.03, 0.3, WOOD);
  g.box(-0.22, 0.05, 0, 0.06, 0.03, 0.26, WOOD);
  g.box(-0.32, 0.06, 0.02, 0.18, 0.05, 0.14, 0x9a8a62);
  g.cyl(0.22, 0.06, 0.06, 0.05, 0.06, 6, 0xb89a62);
  figure(g, -0.12, 0.06, -0.04, 1, 1.2);
  figure(g, 0.3, 0.06, 0.02, 2, 1.2);
  // mast with a small brown lugsail
  mast(g, 0.12, 0.06, 0.62, 0.02);
  yard(g, 0.12, 0.62, 0.17, 0.014);
  squareSail(g, 0.13, 0.6, 0.16, 0.36, { cols: 3, pattern: 'band', taper: 0.15 });
  pennant(g, 0.12, 0.69, 0.16, 0.035);
  oars(g, st, [-0.12], 1, 0.24, -0.01);
  oars(g, st, [-0.12], -1, 0.24, -0.01);
  return { geo: g.build(), flags: [], length: 1 };
}

function cog() {
  const g = new VB(23);
  const st = hull(g, { L: 2.2, W: 0.78, H: 0.36, D: 0.22, sheer: 0.08, bow: 0.1, stern: 0.12, transom: 0.7, mid: 0.52, bowPow: 1.6, col: WOOD, wale: 0.06 });
  castle(g, -0.78, st[1].gy - 0.06, 0.52, 0.34, 0.2);
  castle(g, 0.78, stationAt(st, 0.78).gy - 0.06, 0.4, 0.26, 0.17);
  crates(g, -0.25, 0.1, 4, 1);
  g.box(0.3, 0.28, 0, 0.3, 0.06, 0.4, 0x8a6a46);
  mast(g, 0.05, 0.3, 1.9, 0.04);
  g.cyl(0.05, 1.82, 0, 0.09, 0.1, 8, WOOD2, { r2: 0.11 }); // crow's nest
  yard(g, 0.05, 1.72, 0.62);
  squareSail(g, 0.08, 1.7, 0.6, 1.08, { cols: 6, pattern: 'stripes' });
  line(g, [0.05, 2.15, 0], [1.1, 0.48, 0]);
  line(g, [0.05, 2.15, 0], [-1.05, 0.58, 0]);
  for (const s of [-1, 1]) {
    line(g, [0.05, 1.9, 0], [-0.2, 0.36, s * 0.37]);
    line(g, [0.05, 1.9, 0], [0.25, 0.36, s * 0.37]);
  }
  figure(g, -0.85, st[1].gy + 0.14, 0, 3, 1.3);
  figure(g, 0.35, 0.32, 0.12, 4, 1.3);
  figure(g, 0.75, stationAt(st, 0.75).gy + 0.11, 0.05, 5, 1.3);
  lantern(g, -1.08, st[0].gy + 0.12, 0);
  return { geo: g.build(), flags: [{ x: 0.05, y: 2.22, z: 0, s: 1.4 }], length: 2.2 };
}

function transport() {
  const g = new VB(37);
  const st = hull(g, { L: 2.4, W: 0.9, H: 0.32, D: 0.22, sheer: 0.07, bow: 0.08, stern: 0.08, transom: 0.65, mid: 0.5, col: WOOD2, wale: 0.06 });
  // a canopy aft in the realm's colours, settlers and their bundles on deck
  const ay = st[1].gy - 0.05;
  for (const x of [-0.98, -0.6]) for (const s of [-1, 1]) g.box(x, ay, s * 0.32, 0.04, 0.3, 0.04, WOOD3);
  g.gable(-0.79, ay + 0.3, 0, 0.46, 0.7, 0.16, 0xffffff, { tint: 1, over: 0.04, ridge: false, rows: 2 });
  for (let i = 0; i < 7; i++) figure(g, -0.35 + (i % 4) * 0.2, 0.28, ((i >> 2) ? 0.16 : -0.14) + ((i * 37) % 7) * 0.008, i + 2, 1.25);
  crates(g, 0.65, 0, 3, 2);
  g.box(-0.1, 0.27, 0.26, 0.16, 0.07, 0.12, 0xb89a62);
  g.box(0.25, 0.27, -0.27, 0.14, 0.06, 0.12, 0x9a7a52);
  mast(g, 0.15, 0.27, 1.75, 0.04);
  yard(g, 0.15, 1.6, 0.66);
  squareSail(g, 0.18, 1.58, 0.64, 1.0, { cols: 5, pattern: 'band' });
  line(g, [0.15, 2.0, 0], [1.2, 0.42, 0]);
  line(g, [0.15, 2.0, 0], [-1.15, 0.45, 0]);
  for (const s of [-1, 1]) line(g, [0.15, 1.75, 0], [0.0, 0.32, s * 0.43]);
  lantern(g, -1.18, st[0].gy + 0.12, 0);
  return { geo: g.build(), flags: [{ x: 0.15, y: 2.06, z: 0, s: 1.4 }], length: 2.4 };
}

function galley() {
  const g = new VB(41);
  const st = hull(g, { L: 3.2, W: 0.62, H: 0.2, D: 0.14, sheer: 0.05, bow: 0.06, stern: 0.3, transom: 0.25, mid: 0.5, bowPow: 1.4, col: 0x6a4228, wale: 0.05, stations: 12 });
  // bronze ram at the waterline, painted eyes, curling stern post
  g.push();
  g.translate(1.62, 0.0, 0);
  g.rotateZ(-Math.PI / 2);
  g.cone(0, 0, 0, 0.06, 0.26, 6, BRONZE);
  g.pop();
  for (const s of [-1, 1]) {
    g.box(1.32, 0.17, s * 0.075, 0.07, 0.05, 0.012, 0xf4f0e0);
    g.box(1.33, 0.18, s * 0.08, 0.03, 0.025, 0.012, 0x1a1a1a);
  }
  const sx = -1.6;
  g.beam(sx + 0.05, st[0].gy - 0.02, 0, sx - 0.1, st[0].gy + 0.35, 0, 0.05, 0x6a4228);
  g.beam(sx - 0.1, st[0].gy + 0.35, 0, sx + 0.05, st[0].gy + 0.52, 0, 0.04, 0x6a4228);
  // the rowers' benches under a walkway, the helmsman aft
  g.box(0, 0.16, 0, 2.3, 0.04, 0.12, DECK);
  for (let i = 0; i < 8; i++) for (const s of [-1, 1]) figure(g, -0.95 + i * 0.27, 0.11, s * 0.18, i * 2 + (s > 0 ? 1 : 0), 1.05);
  figure(g, -1.35, stationAt(st, -1.35).gy - 0.04, 0, 9, 1.25);
  shields(g, st, -1.1, 1.0, 9, 1);
  shields(g, st, -1.1, 1.0, 9, -1);
  const xs = [];
  for (let i = 0; i < 8; i++) xs.push(-0.95 + i * 0.27);
  oars(g, st, xs, 1, 0.52, -0.02);
  oars(g, st, xs, -1, 0.52, -0.02);
  mast(g, 0.15, 0.17, 1.55, 0.035);
  yard(g, 0.15, 1.5, 0.62);
  squareSail(g, 0.18, 1.48, 0.6, 0.85, { cols: 6, pattern: 'stripes' });
  line(g, [0.15, 1.72, 0], [1.4, 0.3, 0]);
  line(g, [0.15, 1.72, 0], [-1.5, 0.45, 0]);
  lantern(g, -1.58, st[0].gy + 0.1, 0);
  return { geo: g.build(), flags: [{ x: -1.68, y: st[0].gy + 0.62, z: 0, s: 1.3 }, { x: 0.15, y: 1.78, z: 0, s: 1.1 }], length: 3.2 };
}

function explorer() {
  const g = new VB(53);
  const st = hull(g, { L: 2.5, W: 0.68, H: 0.3, D: 0.2, sheer: 0.07, bow: 0.12, stern: 0.14, transom: 0.55, mid: 0.48, bowPow: 1.5, col: 0x8a5a34, wale: 0.05 });
  castle(g, -0.9, st[1].gy - 0.05, 0.56, 0.28, 0.18, 0x8a5a34);
  // two lateen-rigged masts (a caravel), sails with a realm-coloured band
  mast(g, 0.45, 0.25, 1.55, 0.035);
  mast(g, -0.3, 0.25, 1.3, 0.032);
  lateenSail(g, 0.95, 0.75, -0.05, 1.95, 0.38, 0.38, { tintRow: 1 });
  lateenSail(g, 0.1, 0.65, -0.75, 1.6, -0.36, 0.36, { tintRow: 1 });
  line(g, [0.45, 1.8, 0], [1.25, 0.42, 0]);
  for (const s of [-1, 1]) line(g, [0.45, 1.6, 0], [0.4, 0.3, s * 0.33]);
  g.beam(1.2, 0.36, 0, 1.6, 0.55, 0, 0.03, WOOD3); // bowsprit
  figure(g, -0.95, st[1].gy + 0.13, 0.05, 6, 1.3);
  figure(g, 0.2, 0.27, -0.1, 7, 1.3);
  figure(g, 0.8, 0.29, 0.08, 8, 1.3);
  lantern(g, -1.22, st[0].gy + 0.14, 0);
  return { geo: g.build(), flags: [{ x: 0.45, y: 1.86, z: 0, s: 1.3 }, { x: -1.15, y: st[0].gy + 0.55, z: 0, s: 1.0 }], length: 2.5 };
}

function carrack() {
  const g = new VB(67);
  const st = hull(g, { L: 3.5, W: 1.08, H: 0.5, D: 0.32, sheer: 0.12, bow: 0.18, stern: 0.22, transom: 0.75, mid: 0.5, bowPow: 1.5, col: 0x6a4228, wale: 0.08, stations: 12 });
  // towering castles fore and aft with lit stern windows
  castle(g, -1.2, st[1].gy - 0.08, 0.9, 0.48, 0.36, 0x6a4228);
  castle(g, -1.25, st[1].gy + 0.3, 0.55, 0.4, 0.2, 0x6a4228);
  castle(g, 1.2, stationAt(st, 1.2).gy - 0.08, 0.62, 0.36, 0.3, 0x6a4228);
  for (let i = 0; i < 3; i++) g.box(-1.66, st[0].gy + 0.05, -0.2 + i * 0.2, 0.02, 0.1, 0.08, 0xffc070, { glow: 1 });
  crates(g, -0.2, 0.2, 4, 3);
  crates(g, 0.4, -0.2, 2, 4);
  // fore (square), main (square + topsail), mizzen (lateen)
  mast(g, 0.95, 0.45, 2.1, 0.04);
  mast(g, 0.05, 0.45, 2.9, 0.055);
  mast(g, -0.9, 0.7, 1.9, 0.035);
  yard(g, 0.95, 2.0, 0.6);
  squareSail(g, 0.98, 1.98, 0.58, 0.95, { cols: 6, pattern: 'cross' });
  yard(g, 0.05, 2.25, 0.84);
  squareSail(g, 0.09, 2.23, 0.82, 1.3, { cols: 6, pattern: 'cross' });
  yard(g, 0.05, 3.05, 0.55);
  squareSail(g, 0.07, 3.03, 0.52, 0.65, { cols: 4, pattern: 'plain' });
  lateenSail(g, -0.55, 1.35, -1.45, 2.55, -1.0, 1.05, { tintRow: 1 });
  g.beam(1.6, 0.62, 0, 2.25, 1.0, 0, 0.04, WOOD3); // bowsprit
  line(g, [0.05, 3.3, 0], [0.95, 2.5, 0]);
  line(g, [0.95, 2.5, 0], [2.2, 0.98, 0]);
  line(g, [0.05, 3.3, 0], [-0.9, 2.55, 0]);
  for (const s of [-1, 1]) {
    line(g, [0.05, 2.9, 0], [-0.25, 0.5, s * 0.52]);
    line(g, [0.05, 2.9, 0], [0.3, 0.5, s * 0.52]);
    line(g, [0.95, 2.4, 0], [0.85, 0.55, s * 0.45]);
  }
  g.cyl(0.05, 2.75, 0, 0.12, 0.12, 8, WOOD2, { r2: 0.14 });
  for (let i = 0; i < 4; i++) figure(g, -0.5 + i * 0.35, 0.44, (i % 2 ? 0.2 : -0.18), 10 + i, 1.4);
  figure(g, -1.3, st[1].gy + 0.52, 0, 14, 1.4);
  lantern(g, -1.72, st[0].gy + 0.5, 0);
  return { geo: g.build(), flags: [{ x: 0.05, y: 3.38, z: 0, s: 1.7 }, { x: 0.95, y: 2.62, z: 0, s: 1.2 }, { x: -1.45, y: st[0].gy + 0.95, z: 0, s: 1.2 }], length: 3.5 };
}

// ---------------------------------------------------------------- land
function wheel(g, x, y, z, r, th = 0.05) {
  g.setAnim(3, x, y, z);
  g.push();
  g.translate(x, y, z);
  g.rotateX(Math.PI / 2);
  g.cyl(0, -th / 2, 0, r, th, 10, WOOD3);
  g.cyl(0, -th / 2 - 0.01, 0, r * 0.25, th + 0.02, 6, IRON);
  g.pop();
  // spokes (seen from the side)
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI;
    g.beam(x - Math.cos(a) * r * 0.9, y - Math.sin(a) * r * 0.9, z + Math.sign(z) * (th / 2 + 0.004), x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9, z + Math.sign(z) * (th / 2 + 0.004), 0.018, WOOD2);
  }
  g.setAnim(0);
}

// A four-legged beast: ox, mule or camel. Legs swing in opposite pairs.
function beast(g, x, z, type, variant = -1) {
  const B = {
    ox: { L: 0.46, W: 0.2, H: 0.2, leg: 0.17, col: 0x7a5a3a, head: 0x6a4a2a },
    mule: { L: 0.38, W: 0.14, H: 0.16, leg: 0.19, col: 0x8a7a6a, head: 0x7a6a5a },
    camel: { L: 0.46, W: 0.16, H: 0.18, leg: 0.3, col: 0xc8a06a, head: 0xb8905a },
  }[type];
  const y0 = B.leg;
  g.setAnim(0, 0, 0, 0, variant);
  g.box(x, y0, z, B.L, B.H, B.W, B.col);
  if (type === 'camel') g.cone(x - 0.02, y0 + B.H, z, 0.1, 0.12, 6, B.col);
  // neck and head
  const hx = x + B.L / 2;
  if (type === 'camel') {
    g.beam(hx - 0.03, y0 + B.H * 0.6, z, hx + 0.12, y0 + B.H + 0.14, z, 0.06, B.col);
    g.box(hx + 0.15, y0 + B.H + 0.1, z, 0.12, 0.06, 0.06, B.head);
  } else {
    g.box(hx + 0.06, y0 + B.H * 0.45, z, 0.14, 0.11, B.W * 0.6, B.head);
    if (type === 'ox') for (const s of [-1, 1]) g.beam(hx + 0.08, y0 + B.H * 0.55 + 0.06, z + s * 0.04, hx + 0.1, y0 + B.H * 0.55 + 0.12, z + s * 0.12, 0.02, 0xe8dcc0);
    else for (const s of [-1, 1]) g.box(hx + 0.02, y0 + B.H * 0.55 + 0.06, z + s * 0.03, 0.025, 0.08, 0.02, B.head);
  }
  g.box(x - B.L / 2 - 0.02, y0 + B.H * 0.5, z, 0.03, 0.1, 0.02, shade(B.col, 0.6));
  for (const fx of [-1, 1])
    for (const fz of [-1, 1]) {
      const lx = x + fx * (B.L / 2 - 0.05),
        lz = z + fz * (B.W / 2 - 0.03);
      const k = fx * fz > 0 ? 7 : 8;
      g.setAnim(k, lx, y0, lz, variant);
      g.box(lx, 0, lz, 0.05, y0 + 0.02, 0.05, shade(B.col, 0.85));
    }
  g.setAnim(0, 0, 0, 0, variant);
}

function oxcart() {
  const g = new VB(71);
  // the team
  beast(g, 0.45, -0.13, 'ox');
  beast(g, 0.45, 0.13, 'ox');
  g.beam(0.62, 0.36, -0.2, 0.62, 0.36, 0.2, 0.04, WOOD3); // yoke
  g.beam(-0.1, 0.24, 0, 0.62, 0.34, 0, 0.04, WOOD3); // pole
  // the cart
  const cy = 0.22;
  g.box(-0.38, cy, 0, 0.62, 0.05, 0.44, WOOD2);
  for (const s of [-1, 1]) g.box(-0.38, cy + 0.05, s * 0.21, 0.62, 0.09, 0.03, WOOD);
  g.box(-0.68, cy + 0.05, 0, 0.03, 0.09, 0.44, WOOD);
  g.box(-0.08, cy + 0.05, 0, 0.03, 0.12, 0.44, WOOD);
  wheel(g, -0.38, 0.18, 0.26, 0.18);
  wheel(g, -0.38, 0.18, -0.26, 0.18);
  figure(g, -0.08, cy + 0.06, 0.08, 3, 1.3);
  // cargo: 0 logs, 1 stone, 2 sacks, 3 ore (one shows per cart)
  const ly = cy + 0.05;
  g.setAnim(0, 0, 0, 0, 0);
  for (let i = 0; i < 5; i++) {
    g.push();
    g.translate(-0.38, ly + 0.05 + (i > 2 ? 0.08 : 0), -0.12 + (i % 3) * 0.12 + (i > 2 ? 0.06 : 0));
    g.rotateZ(Math.PI / 2);
    g.cyl(0, -0.27, 0, 0.045, 0.54, 6, i % 2 ? 0x8a6040 : 0x7a5232, { capCol: 0xd8b880 });
    g.pop();
  }
  g.setAnim(0, 0, 0, 0, 1);
  for (let i = 0; i < 4; i++) g.box(-0.5 + (i % 2) * 0.22, ly, -0.08 + Math.floor(i / 2) * 0.16, 0.18, 0.12, 0.13, i % 2 ? 0xa39b8d : 0x8c857a);
  g.box(-0.4, ly + 0.12, 0, 0.18, 0.1, 0.14, 0xb0a898);
  g.setAnim(0, 0, 0, 0, 2);
  for (let i = 0; i < 4; i++) g.box(-0.52 + (i % 2) * 0.24, ly, -0.08 + Math.floor(i / 2) * 0.16, 0.2, 0.12, 0.14, 0xd8c08a);
  g.box(-0.4, ly + 0.11, 0, 0.42, 0.06, 0.38, 0xffffff, { tint: 1 }); // cover in the realm's colours
  g.setAnim(0, 0, 0, 0, 3);
  for (let i = 0; i < 6; i++) g.bead(-0.55 + (i % 3) * 0.16, ly, -0.08 + Math.floor(i / 3) * 0.15, 0.07, i % 2 ? 0x5a4a4a : 0x7a5a48);
  g.setAnim(0);
  return { geo: g.build(), flags: [], length: 1.5 };
}

function packAnimal() {
  const g = new VB(83);
  // variants: 0 mule, 1 mule led by a handler, 2 camel, 3 camel with handler
  for (const [variant, type] of [
    [0, 'mule'],
    [1, 'mule'],
    [2, 'camel'],
    [3, 'camel'],
  ]) {
    beast(g, 0, 0, type, variant);
    const B = type === 'camel' ? { y: 0.48, L: 0.46, W: 0.16 } : { y: 0.35, L: 0.38, W: 0.14 };
    g.setAnim(0, 0, 0, 0, variant);
    g.box(0, B.y, 0, B.L * 0.55, 0.03, B.W + 0.06, 0xffffff, { tint: 1 }); // saddle cloth
    for (const s of [-1, 1]) g.box(0, B.y - 0.12, s * (B.W / 2 + 0.06), B.L * 0.45, 0.14, 0.08, s > 0 ? 0xb89a62 : 0x9a7a52);
    g.box(0, B.y + 0.03, 0, B.L * 0.4, 0.08, B.W * 0.7, 0xc8b080);
    if (variant === 1 || variant === 3) {
      figure(g, B.L / 2 + 0.2, 0, 0.16, variant + 5, 1.6);
      g.beam(B.L / 2 + 0.12, type === 'camel' ? 0.5 : 0.3, 0, B.L / 2 + 0.2, 0.2, 0.15, 0.012, ROPE);
    }
  }
  g.setAnim(0);
  return { geo: g.build(), flags: [], length: 0.6 };
}

function ram() {
  const g = new VB(91);
  const L = 1.3,
    W = 0.66;
  g.box(0, 0.2, 0, L, 0.06, W, WOOD);
  for (const x of [-0.45, 0.45]) for (const s of [-1, 1]) wheel(g, x, 0.17, s * (W / 2 + 0.03), 0.16);
  // A-frame posts and a hide-covered roof in the realm's colours
  for (const x of [-0.5, 0, 0.5])
    for (const s of [-1, 1]) g.beam(x, 0.25, s * (W / 2 - 0.04), x, 0.85, 0, 0.05, WOOD3);
  g.gable(0, 0.62, 0, L * 0.95, W * 0.9, 0.25, 0xffffff, { tint: 1, over: 0.05, rows: 3 });
  // the hanging log with its iron head (swings)
  g.setAnim(6);
  g.push();
  g.translate(0.05, 0.42, 0);
  g.rotateZ(Math.PI / 2);
  g.cyl(0, -0.75, 0, 0.07, 1.4, 8, 0x6a4a2a);
  g.pop();
  g.push();
  g.translate(0.82, 0.42, 0);
  g.rotateZ(-Math.PI / 2);
  g.cone(0, 0, 0, 0.1, 0.16, 6, IRON);
  g.pop();
  g.setAnim(0);
  for (const x of [-0.4, 0.4]) line(g, [x, 0.84, 0], [x, 0.45, 0], 0.015);
  figure(g, -0.5, 0.25, 0.12, 1, 1.3);
  figure(g, -0.2, 0.25, -0.12, 2, 1.3);
  return { geo: g.build(), flags: [], length: 1.4 };
}

function catapult() {
  const g = new VB(97);
  const L = 1.15,
    W = 0.7;
  for (const s of [-1, 1]) g.box(0, 0.2, s * (W / 2 - 0.05), L, 0.08, 0.08, WOOD);
  for (const x of [-0.45, 0.1, 0.45]) g.box(x, 0.2, 0, 0.08, 0.06, W, WOOD);
  for (const x of [-0.4, 0.4]) for (const s of [-1, 1]) wheel(g, x, 0.17, s * (W / 2 + 0.03), 0.16);
  // uprights and cross-bar the arm strikes
  for (const s of [-1, 1]) g.beam(0.25, 0.26, s * 0.25, 0.32, 0.8, s * 0.25, 0.06, WOOD3);
  g.beam(0.32, 0.8, -0.27, 0.32, 0.8, 0.27, 0.07, WOOD2);
  // torsion skein at the axle
  g.push();
  g.translate(-0.1, 0.3, 0);
  g.rotateX(Math.PI / 2);
  g.cyl(0, -0.25, 0, 0.07, 0.5, 8, 0x8a7a5a);
  g.pop();
  // the arm and its bucket with a stone; rest pose lies back toward -X
  g.setAnim(5, -0.1, 0.3, 0);
  g.beam(-0.1, 0.3, 0, -0.85, 0.42, 0, 0.06, WOOD2);
  g.cyl(-0.88, 0.4, 0, 0.09, 0.07, 8, WOOD3);
  g.bead(-0.88, 0.44, 0, 0.065, 0x9a948a);
  g.setAnim(0);
  // a pile of stones and the crew
  for (let i = 0; i < 3; i++) g.bead(0.45 + (i % 2) * 0.1, 0.26, -0.18 + i * 0.1, 0.05, 0x8c857a);
  figure(g, -0.3, 0.26, 0.25, 4, 1.3);
  figure(g, 0.4, 0.26, 0.1, 5, 1.3);
  return { geo: g.build(), flags: [], length: 1.3 };
}

const BUILDERS = { fishing, cog, transport, galley, explorer, carrack, oxcart, caravan: packAnimal, ram, catapult };
const cache = new Map();
export function vehicleModel(kind) {
  let m = cache.get(kind);
  if (!m) {
    m = BUILDERS[kind]();
    cache.set(kind, m);
  }
  return m;
}

// ---------------------------------------------------------------- props
export function debrisGeometry() {
  const g = new VB(5);
  g.box(0, -0.02, 0, 0.5, 0.05, 0.12, WOOD2);
  g.box(0.1, -0.02, 0.18, 0.36, 0.05, 0.1, WOOD);
  g.cyl(-0.18, -0.06, -0.16, 0.07, 0.14, 6, 0x8a5a32);
  return g.build();
}

export function stoneGeometry() {
  return new THREE.IcosahedronGeometry(0.2, 0);
}
