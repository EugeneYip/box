import * as THREE from 'three';
import { TILE, TILE_INFO, FLORA, SEA_LEVEL } from '../../world/constants.js';
import { hash2, mulberry32 } from '../../core/Random.js';
import { flowerDrift } from '../../sim/flora/species.js';
import { MeshBuilder, MAT, C, blobGeo, M } from './MeshBuilder.js';
import { InstanceBatcher } from './InstanceBatcher.js';

// Ground cover: instanced grass tufts, ferns, broad-leaf jungle plants,
// meadow flowers and pebbles. Built per chunk only near the camera, faded out
// with distance in the vertex shader (no popping), tinted from the terrain
// biome palette with soft bilinear blending across tile borders, and swayed
// by the same wind as the trees. Grass normals point up so it is lit like the
// ground it grows from. Ground cover never casts shadows but receives them.
const CHUNK = 32;
const MAX_DIST = 80; // camera distance beyond which ground cover is off
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Indexed builder for thin blades (5 verts / 3 tris per blade).
class BladeBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.info = [];
    this.piv = [];
    this.idx = [];
  }
  v(p, col, bend, flutter, mat = MAT.GRASS, leaf = 1, nrm = null) {
    this.pos.push(p.x, p.y, p.z);
    if (nrm) this.nrm.push(nrm.x, nrm.y, nrm.z);
    else this.nrm.push(0, 1, 0);
    this.col.push(col[0], col[1], col[2]);
    this.info.push(bend, flutter, leaf, mat);
    this.piv.push(0, 0, 0);
    return this.pos.length / 3 - 1;
  }
  t(a, b, c) {
    this.idx.push(a, b, c);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.info, 4));
    g.setAttribute('aPivot', new THREE.Float32BufferAttribute(this.piv, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// A curved tapering blade from base along direction `ang`.
function blade(bb, r, base, ang, h, w, curve, cBase, cMid, cTip) {
  const d = V(Math.cos(ang), 0, Math.sin(ang));
  const s = V(-d.z, 0, d.x);
  const mid = base.clone().addScaledVector(d, curve * 0.35 * h).add(V(0, h * 0.55, 0));
  const tip = base.clone().addScaledVector(d, curve * h).add(V(0, h * (1 - curve * 0.25), 0));
  const b0 = bb.v(base.clone().addScaledVector(s, -w), cBase, 0, 0);
  const b1 = bb.v(base.clone().addScaledVector(s, w), cBase, 0, 0);
  const m0 = bb.v(mid.clone().addScaledVector(s, -w * 0.62), cMid, 0.35, 0.4);
  const m1 = bb.v(mid.clone().addScaledVector(s, w * 0.62), cMid, 0.35, 0.4);
  const t = bb.v(tip, cTip, 1, 1);
  bb.t(b0, b1, m1);
  bb.t(b0, m1, m0);
  bb.t(m0, m1, t);
}

// Colour gradients are multiplied by the per-instance biome tint.
const G_BASE = [0.74, 0.76, 0.7];
const G_MID = [0.96, 0.98, 0.9];
const G_TIP = [1.16, 1.18, 1.0];

function grassTuft(seed, { blades = 7, hMin = 0.12, hMax = 0.26, spread = 0.09, width = 0.022, curve = 0.35 } = {}) {
  const r = mulberry32(seed);
  const bb = new BladeBuilder();
  for (let k = 0; k < blades; k++) {
    const a = (k / blades) * TAU + r() * 0.8;
    const rr = r() * spread;
    const base = V(Math.cos(a) * rr, -0.02, Math.sin(a) * rr);
    const h = hMin + (hMax - hMin) * r();
    const tipWarm = 0.9 + r() * 0.2;
    blade(bb, r, base, a + (r() - 0.5) * 0.9, h, width * (0.8 + r() * 0.4), curve * (0.6 + r() * 0.8), G_BASE, G_MID, [G_TIP[0] * tipWarm, G_TIP[1], G_TIP[2] * (2 - tipWarm)]);
  }
  return bb.build();
}

function meadowTuft(seed) {
  const r = mulberry32(seed);
  const bb = new BladeBuilder();
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + r();
    const rr = r() * 0.08;
    blade(bb, r, V(Math.cos(a) * rr, -0.02, Math.sin(a) * rr), a, 0.12 + r() * 0.12, 0.02, 0.4, G_BASE, G_MID, G_TIP);
  }
  const palettes = [[0xffffff, 0xfff4b0], [0xffe04a, 0xffb020], [0xff9ac8, 0xffd0e4], [0xb898ff, 0x8a70ff]];
  for (let k = 0; k < 3; k++) {
    const pal = palettes[Math.floor(r() * palettes.length)];
    const a = r() * TAU,
      rr = 0.04 + r() * 0.07;
    const hgt = 0.14 + r() * 0.1;
    const c = V(Math.cos(a) * rr, hgt, Math.sin(a) * rr);
    // stem
    const s0 = bb.v(V(c.x * 0.6 - 0.006, -0.02, c.z * 0.6), G_BASE, 0, 0);
    const s1 = bb.v(V(c.x * 0.6 + 0.006, -0.02, c.z * 0.6), G_BASE, 0, 0);
    const s2 = bb.v(c, G_MID, 1, 1);
    bb.t(s0, s1, s2);
    // 4 petals as a little star
    const pc = C(pal[0]),
      hc = C(pal[1]);
    const ctr = bb.v(c.clone().add(V(0, 0.006, 0)), hc, 1, 1, MAT.PETAL, 1);
    const pr = 0.03 + r() * 0.012;
    const ids = [];
    for (let q = 0; q < 8; q++) {
      const aa = (q / 8) * TAU;
      const rad = q % 2 === 0 ? pr : pr * 0.4;
      ids.push(bb.v(c.clone().add(V(Math.cos(aa) * rad, 0, Math.sin(aa) * rad)), pc, 1, 1, MAT.PETAL, 1));
    }
    for (let q = 0; q < 8; q++) bb.t(ctr, ids[(q + 1) % 8], ids[q]);
  }
  return bb.build();
}

function fernTuft(seed) {
  const r = mulberry32(seed);
  const bb = new BladeBuilder();
  const fronds = 6 + Math.floor(r() * 3);
  for (let k = 0; k < fronds; k++) {
    const a = (k / fronds) * TAU + r() * 0.5;
    const d = V(Math.cos(a), 0, Math.sin(a));
    const s = V(-d.z, 0, d.x);
    const L = 0.17 + r() * 0.09;
    const rise = 0.07 + r() * 0.05;
    const segs = 5;
    let prevL = null,
      prevR = null,
      prevC = bb.v(V(0, -0.01, 0), G_BASE, 0, 0);
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      const c = d.clone().multiplyScalar(L * t).add(V(0, Math.sin(t * Math.PI * 0.9) * rise + 0.01 - t * t * 0.03, 0));
      const w = 0.045 * Math.sin(Math.PI * Math.min(1, t * 1.05)) * (i % 2 ? 1 : 0.62) + 0.004;
      const col = [0.55 + 0.4 * t, 0.6 + 0.4 * t, 0.5 + 0.3 * t];
      const ci = bb.v(c, col, t, t);
      const li = bb.v(c.clone().addScaledVector(s, w).add(V(0, 0.01, 0)).addScaledVector(d, -0.02), col, t, t);
      const ri = bb.v(c.clone().addScaledVector(s, -w).add(V(0, 0.01, 0)).addScaledVector(d, -0.02), col, t, t);
      bb.t(prevC, li, ci);
      bb.t(prevC, ci, ri);
      if (prevL != null) {
        bb.t(prevC, prevL, li);
        bb.t(prevC, ri, prevR);
      }
      prevL = li;
      prevR = ri;
      prevC = ci;
    }
  }
  return bb.build();
}

function broadleafTuft(seed) {
  const r = mulberry32(seed);
  const bb = new BladeBuilder();
  const leaves = 4 + Math.floor(r() * 2);
  for (let k = 0; k < leaves; k++) {
    const a = (k / leaves) * TAU + r() * 0.6;
    const d = V(Math.cos(a), 0, Math.sin(a));
    const s = V(-d.z, 0, d.x);
    const L = 0.2 + r() * 0.12;
    const lift = 0.1 + r() * 0.1;
    const base = bb.v(V(0, -0.01, 0), G_BASE, 0, 0);
    const p1 = d.clone().multiplyScalar(L * 0.35).add(V(0, lift, 0));
    const p2 = d.clone().multiplyScalar(L * 0.75).add(V(0, lift * 1.05, 0));
    const tip = d.clone().multiplyScalar(L).add(V(0, lift * 0.7, 0));
    const w = 0.07 + r() * 0.03;
    const i1 = bb.v(p1, G_MID, 0.4, 0.4);
    const l2 = bb.v(p2.clone().addScaledVector(s, w), G_TIP, 0.8, 0.8);
    const r2 = bb.v(p2.clone().addScaledVector(s, -w), G_TIP, 0.8, 0.8);
    const l1 = bb.v(p1.clone().addScaledVector(s, w * 0.7), G_MID, 0.4, 0.5);
    const r1 = bb.v(p1.clone().addScaledVector(s, -w * 0.7), G_MID, 0.4, 0.5);
    const ti = bb.v(tip, G_TIP, 1, 1);
    bb.t(base, l1, i1);
    bb.t(base, i1, r1);
    bb.t(i1, l1, l2);
    bb.t(i1, r2, r1);
    bb.t(i1, l2, ti);
    bb.t(i1, ti, r2);
  }
  return bb.build();
}

function pebbles(seed, n, rMin, rMax) {
  const b = new MeshBuilder(seed);
  for (let k = 0; k < n; k++) {
    const a = b.r(0, TAU),
      rr = b.r(0, 0.28);
    const r = b.r(rMin, rMax);
    const sq = b.r(0.45, 0.7);
    const g = blobGeo(b, r, 0, { lump: 0.3, squash: sq, flatBottom: 0.3 });
    const shade = b.r(0.8, 1.1);
    b.add(g, {
      matrix: M(Math.cos(a) * rr, r * sq * 0.25, Math.sin(a) * rr, 0, b.r(0, TAU), 0),
      normals: 'flat',
      color: (p, nn) => {
        const k2 = (0.75 + 0.35 * Math.max(0, nn.y)) * shade;
        return [k2, k2, k2];
      },
      mat: MAT.ROCK,
    });
  }
  return b.build({ bendScale: 0 });
}

// ---------------------------------------------------------------------------
export class GroundCover {
  constructor(veg) {
    this.veg = veg;
    this.game = veg.game;
    this.world = veg.world;
    const world = this.world;
    this.group = new THREE.Group();
    this.group.name = 'ground-cover';
    this.group.matrixAutoUpdate = false;
    this.game.scene.add(this.group);
    this.mat = veg.groundMat;
    // geometry kinds
    this.kinds = [
      { id: 'grass', geos: [0, 1, 2].map((s) => grassTuft(101 + s)) },
      { id: 'grassTall', geos: [0, 1].map((s) => grassTuft(201 + s, { blades: 8, hMin: 0.22, hMax: 0.42, spread: 0.1, width: 0.02, curve: 0.45 })) },
      { id: 'grassShort', geos: [0, 1].map((s) => grassTuft(301 + s, { blades: 6, hMin: 0.07, hMax: 0.15, spread: 0.08, width: 0.024, curve: 0.3 })) },
      { id: 'meadow', geos: [0, 1].map((s) => meadowTuft(401 + s)) },
      { id: 'fern', geos: [0, 1].map((s) => fernTuft(501 + s)) },
      { id: 'broad', geos: [0, 1].map((s) => broadleafTuft(601 + s)) },
      { id: 'sedge', geos: [grassTuft(701, { blades: 9, hMin: 0.18, hMax: 0.34, spread: 0.07, width: 0.016, curve: 0.2 })] },
      { id: 'pebble', geos: [pebbles(801, 4, 0.025, 0.06), pebbles(802, 3, 0.035, 0.075), pebbles(803, 6, 0.02, 0.045)], rock: true },
    ];
    this.kindIndex = {};
    this.kinds.forEach((k, i) => (this.kindIndex[k.id] = i));
    this.cw = Math.ceil(world.w / CHUNK);
    this.ch = Math.ceil(world.h / CHUNK);
    this.chunks = [];
    for (let cy = 0; cy < this.ch; cy++)
      for (let cx = 0; cx < this.cw; cx++)
        this.chunks.push({
          cx,
          cy,
          x0: cx * CHUNK,
          y0: cy * CHUNK,
          x1: Math.min(world.w, (cx + 1) * CHUNK) - 1,
          y1: Math.min(world.h, (cy + 1) * CHUNK) - 1,
          built: false,
          dirty: true,
          lists: new Map(),
          state: 0,
          sphere: new THREE.Sphere(),
          awayT: 0,
          sig: 0,
          count: 0,
        });
    this._scratch = new Map();
    this._nrm = { x: 0, y: 1, z: 0 };
    this._sigCursor = 0;
    this.batcher = new InstanceBatcher(this.group, 'ground');
    this._needCompact = true;
    this._frustum = new THREE.Frustum();
    this._ps = new THREE.Matrix4();
    this.tileColors = this.computeTileColors();
    const ev = this.game.events;
    const mark = (r) => this.markRect(r);
    ev.on('world:type', mark);
    ev.on('world:height', mark);
    ev.on('world:flora', (r) => this.markRect(r, true));
  }

  computeTileColors() {
    const out = [];
    const c = new THREE.Color();
    for (let t = 0; t < TILE_INFO.length; t++) {
      if (!TILE_INFO[t]) continue;
      c.setHex(TILE_INFO[t].color);
      out[t] = [c.r, c.g, c.b];
    }
    // Hand-tuned grass tints per biome (linear), richer than the flat albedo.
    const tint = (t, hex) => {
      c.setHex(hex);
      out[t] = [c.r, c.g, c.b];
    };
    tint(TILE.GRASS, 0x5fae3e);
    tint(TILE.FOREST, 0x3c8a35);
    tint(TILE.JUNGLE, 0x2e9a44);
    tint(TILE.SAVANNA, 0xc2b052);
    tint(TILE.SWAMP, 0x5a7a40);
    tint(TILE.TUNDRA, 0x8aa47e);
    tint(TILE.SOIL, 0x7a8a46);
    tint(TILE.DESERT, 0xc8a860);
    tint(TILE.SAND, 0xb8b070);
    return out;
  }

  markRect(r, floraOnly = false) {
    const cx0 = Math.max(0, Math.floor((r.x0 - 1) / CHUNK)),
      cx1 = Math.min(this.cw - 1, Math.floor((r.x1 + 1) / CHUNK));
    const cy0 = Math.max(0, Math.floor((r.y0 - 1) / CHUNK)),
      cy1 = Math.min(this.ch - 1, Math.floor((r.y1 + 1) / CHUNK));
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = this.chunks[cy * this.cw + cx];
        // flora changes only matter for boulders / wheat (grass is skipped there)
        if (floraOnly && !c.built) continue;
        c.dirty = true;
      }
  }

  reset() {
    for (const c of this.chunks) c.dirty = true;
  }

  // Building occupancy signature so new houses clear the grass beneath them.
  signature(c) {
    const world = this.world;
    let s = 0;
    for (let ty = c.y0; ty <= c.y1; ty++)
      for (let tx = c.x0; tx <= c.x1; tx++) {
        const i = ty * world.w + tx;
        if (world.building[i] >= 0) s = (s * 31 + i) | 0;
      }
    return s;
  }

  blendTint(x, z) {
    // bilinear blend of neighbouring tile tints at a world position
    const world = this.world;
    const fx = x - 0.5,
      fz = z - 0.5;
    const x0 = Math.floor(fx),
      z0 = Math.floor(fz);
    const tx = fx - x0,
      tz = fz - z0;
    const tc = this.tileColors;
    const get = (ix, iz) => tc[world.type[world.idx(world.clampTx(ix), world.clampTy(iz))]] || tc[TILE.GRASS];
    const a = get(x0, z0),
      b = get(x0 + 1, z0),
      c = get(x0, z0 + 1),
      d = get(x0 + 1, z0 + 1);
    const out = [0, 0, 0];
    for (let k = 0; k < 3; k++) out[k] = (a[k] * (1 - tx) + b[k] * tx) * (1 - tz) + (c[k] * (1 - tx) + d[k] * tx) * tz;
    return out;
  }

  buildChunk(c) {
    c.dirty = false;
    c.built = true;
    c.sig = this.signature(c);
    const world = this.world;
    const scratch = this._scratch;
    for (const s of scratch.values()) s.n = 0;
    const m = new THREE.Matrix4(),
      q = new THREE.Quaternion(),
      q2 = new THREE.Quaternion(),
      p = new THREE.Vector3(),
      sc = new THREE.Vector3(),
      up = new THREE.Vector3(0, 1, 0),
      nrm = { x: 0, y: 1, z: 0 },
      nv = new THREE.Vector3();
    let minY = Infinity,
      maxY = -Infinity,
      total = 0;
    const push = (kindIdx, v, x, z, scale, tint, tiltK, yOff = 0) => {
      const key = kindIdx * 8 + v;
      let s = scratch.get(key);
      if (!s) scratch.set(key, (s = { k: kindIdx, v, n: 0, mats: new Float32Array(256 * 16), cols: new Float32Array(256 * 3) }));
      if ((s.n + 1) * 16 > s.mats.length) {
        const a = new Float32Array(s.mats.length * 2);
        a.set(s.mats);
        s.mats = a;
        const b = new Float32Array(s.cols.length * 2);
        b.set(s.cols);
        s.cols = b;
      }
      const y = world.heightAt(x, z) + yOff;
      world.normalAt(x, z, nrm);
      q.setFromAxisAngle(up, hash2(Math.floor(x * 7), Math.floor(z * 7), 5) * TAU);
      q2.setFromUnitVectors(up, nv.set(nrm.x * tiltK, 1, nrm.z * tiltK).normalize());
      q.premultiply(q2);
      p.set(x, y, z);
      sc.set(scale, scale, scale);
      m.compose(p, q, sc);
      m.toArray(s.mats, s.n * 16);
      s.cols[s.n * 3] = tint[0];
      s.cols[s.n * 3 + 1] = tint[1];
      s.cols[s.n * 3 + 2] = tint[2];
      s.n++;
      total++;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    };
    const K = this.kindIndex;
    for (let ty = c.y0; ty <= c.y1; ty++) {
      for (let tx = c.x0; tx <= c.x1; tx++) {
        const i = ty * world.w + tx;
        const h = world.height[i];
        if (h < SEA_LEVEL + 0.04) continue;
        if (world.building[i] >= 0) continue;
        const f = world.flora[i];
        if (f === FLORA.BOULDER || f === FLORA.WHEAT) continue;
        const t = world.type[i];
        const slope = world.slopeAt(tx, ty);
        const ny = world.normalAt(tx + 0.5, ty + 0.5, this._nrm).y;
        // the terrain shader turns slopes below ~0.76 into cliff rock
        if (ny < 0.78 && t !== TILE.ROCK) continue;
        const drift = flowerDrift(tx, ty);
        let n = 0,
          plan = null;
        switch (t) {
          case TILE.GRASS:
            n = 5;
            plan = 'grass';
            break;
          case TILE.FOREST:
            n = 4;
            plan = 'forest';
            break;
          case TILE.JUNGLE:
            n = 3;
            plan = 'jungle';
            break;
          case TILE.SAVANNA:
            n = 3;
            plan = 'savanna';
            break;
          case TILE.TUNDRA:
            n = 2;
            plan = 'tundra';
            break;
          case TILE.SWAMP:
            n = 2;
            plan = 'swamp';
            break;
          case TILE.SOIL:
            n = 1;
            plan = 'soil';
            break;
          case TILE.ROCK:
            n = 1;
            plan = 'rock';
            break;
          case TILE.SAND:
          case TILE.DESERT:
            n = 1;
            plan = 'sand';
            break;
          default:
            continue;
        }
        if ((slope > 1.6 || ny < 0.88) && plan !== 'rock') n = Math.max(1, n - 2);
        for (let k = 0; k < n; k++) {
          const r1 = hash2(tx * 4 + k, ty, 1301),
            r2 = hash2(tx, ty * 4 + k, 1303),
            r3 = hash2(tx + k * 17, ty + k * 31, 1307),
            r4 = hash2(tx * 3 + k, ty * 5 + k, 1311);
          // stratified jitter within the tile
          const sx = k < 4 ? (k % 2) * 0.5 + r1 * 0.5 : r1,
            sz = k < 4 ? (Math.floor(k / 2) % 2) * 0.5 + r2 * 0.5 : r2;
          const x = tx + sx,
            z = ty + sz;
          const tint = this.blendTint(x, z);
          // low-frequency patchiness: lusher clumps and sparser, paler swathes
          const patch = 0.5 + 0.5 * Math.sin(x * 0.19 + Math.sin(z * 0.13) * 2.1) * Math.cos(z * 0.16 - Math.sin(x * 0.11) * 1.8);
          if (plan !== 'rock' && plan !== 'sand' && k >= 2 && r1 > 0.35 + patch * 0.75) continue;
          const br = (0.84 + r3 * 0.24) * (0.9 + patch * 0.16);
          const warm = (r4 - 0.5) * 0.12;
          const tt = [tint[0] * br * (1 + warm), tint[1] * br, tint[2] * br * (1 - warm)];
          let kind = null,
            scale = (0.78 + r4 * 0.34) * (0.82 + patch * 0.36),
            tilt = 0.5;
          switch (plan) {
            case 'grass':
              // flowers gather in drifts on gentle ground only
              kind = drift > 0.62 && ny > 0.9 && r3 < (drift - 0.62) * 0.9 ? 'meadow' : r3 < 0.12 + patch * 0.22 ? 'grassTall' : r3 > 0.82 ? 'grassShort' : 'grass';
              break;
            case 'forest':
              kind = r3 < 0.14 ? 'fern' : r3 < 0.5 ? 'grassShort' : 'grass';
              break;
            case 'jungle':
              kind = r3 < 0.42 ? 'broad' : r3 < 0.66 ? 'fern' : 'grassTall';
              if (kind === 'broad') scale *= 1.3;
              break;
            case 'savanna':
              kind = r3 < 0.7 ? 'grassTall' : 'grass';
              break;
            case 'tundra':
              kind = r3 < 0.25 ? 'pebble' : 'grassShort';
              if (kind === 'pebble') tt[0] = tt[1] = tt[2] = 0.32 * br;
              break;
            case 'swamp':
              kind = r3 < 0.55 ? 'sedge' : 'grass';
              break;
            case 'soil':
              if (r3 > 0.5) continue;
              kind = r3 < 0.25 ? 'grassShort' : 'pebble';
              if (kind === 'pebble') {
                const g = 0.3 * br;
                tt[0] = g * 1.1;
                tt[1] = g;
                tt[2] = g * 0.85;
              }
              break;
            case 'rock':
              if (r3 > 0.55) continue;
              kind = 'pebble';
              tilt = 0.9;
              {
                const g = 0.27 * br;
                tt[0] = g * 1.02;
                tt[1] = g;
                tt[2] = g * 0.96;
              }
              break;
            case 'sand':
              if (t === TILE.DESERT ? r3 > 0.22 : r3 > 0.16) continue;
              if (t === TILE.SAND && world.isCoastal(tx, ty) && r4 < 0.5) continue;
              kind = t === TILE.DESERT && r4 < 0.35 ? 'grassShort' : 'pebble';
              if (kind === 'pebble') {
                const g = (t === TILE.DESERT ? 0.42 : 0.55) * br;
                tt[0] = g * 1.12;
                tt[1] = g;
                tt[2] = g * 0.82;
              } else {
                tt[0] *= 1.05;
                tt[2] *= 0.8;
              }
              break;
          }
          const ki = K[kind];
          const v = Math.floor(r2 * this.kinds[ki].geos.length * 0.999);
          push(ki, v, x, z, scale, tt, tilt, kind === 'pebble' ? -0.01 : -0.005);
        }
      }
    }
    c.lists.clear();
    for (const [key, sc] of scratch) {
      if (!sc.n) continue;
      c.lists.set(key, { k: sc.k, v: sc.v, n: sc.n, mats: sc.mats.slice(0, sc.n * 16), cols: sc.cols.slice(0, sc.n * 3) });
    }
    this._needCompact = true;
    c.count = total;
    if (total) {
      const half = (c.x1 - c.x0 + 1) / 2 + 0.6;
      c.sphere.center.set((c.x0 + c.x1 + 1) / 2, (minY + maxY) / 2 + 0.2, (c.y0 + c.y1 + 1) / 2);
      c.sphere.radius = Math.sqrt(half * half * 2 + Math.pow((maxY - minY) / 2 + 0.6, 2));
    }
  }

  freeChunk(c) {
    c.lists.clear();
    this._needCompact = true;
    c.built = false;
    c.dirty = true;
    c.count = 0;
  }

  update(dt) {
    const g = this.game;
    const rig = g.cameraRig;
    const D = rig.cur.dist;
    const camObj = rig.camera;
    const cam = camObj.position;
    // dense near the camera, gone by mid-zoom distances (the terrain shader
    // carries the grass texture further out)
    const far = Math.min(58, 12 + D * 0.85);
    const near = far * 0.62;
    this.veg.uniforms.uFade.value.set(near, far);
    const enabled = D < MAX_DIST * 0.95;
    this.group.visible = enabled;
    // building signature poll (one chunk per frame)
    const sc = this.chunks[this._sigCursor];
    this._sigCursor = (this._sigCursor + 1) % this.chunks.length;
    if (sc.built && !sc.dirty && this.signature(sc) !== sc.sig) sc.dirty = true;
    if (!enabled) return;
    camObj.updateMatrixWorld();
    this._ps.multiplyMatrices(camObj.projectionMatrix, camObj.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._ps);
    const want = [];
    let changed = false;
    for (const c of this.chunks) {
      // distance from the camera to the chunk's footprint
      const dx = Math.max(c.x0 - cam.x, 0, cam.x - (c.x1 + 1));
      const dz = Math.max(c.y0 - cam.z, 0, cam.z - (c.y1 + 1));
      const dy = Math.max(0, cam.y - (c.built && c.count ? c.sphere.center.y + 2 : 6));
      const d = Math.sqrt(dx * dx + dz * dz + dy * dy);
      const inRange = d < far + 2;
      let state = 0;
      if (inRange) {
        c.awayT = 0;
        if (!c.built || c.dirty) want.push([d, c]);
        else if (c.count && this._frustum.intersectsSphere(c.sphere)) state = 1;
      } else if (c.built) {
        c.awayT += dt;
        if (c.awayT > 8) this.freeChunk(c);
      }
      if (state !== c.state) {
        c.state = state;
        changed = true;
      }
    }
    if (want.length) {
      want.sort((a, b) => a[0] - b[0]);
      const t0 = performance.now();
      const firstFill = !this._filled;
      for (const [, c] of want) {
        this.buildChunk(c);
        c.state = c.count && this._frustum.intersectsSphere(c.sphere) ? 1 : 0;
        changed = true;
        if (!firstFill && performance.now() - t0 > 3) break;
      }
      this._filled = true;
    }
    if (!changed && !this._needCompact) return;
    this._needCompact = false;
    const B = this.batcher;
    B.begin();
    for (const c of this.chunks) {
      if (!c.state) continue;
      for (const [key, list] of c.lists) {
        const kind = this.kinds[list.k];
        B.add(key, list, { geo: kind.geos[list.v], material: this.mat.material, depth: null, castShadow: false, label: kind.id + '-' + list.v });
      }
    }
    B.end();
  }

  stats() {
    let n = 0;
    for (const c of this.chunks) n += c.count;
    return { built: n, drawn: this.batcher.drawn };
  }
}
