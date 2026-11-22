import * as THREE from 'three';
import { PROP, UNIT } from '../../core/scale.js';

// Square props (Life module, round 19): benches and a food stall about each
// town's main square, and the paved parade square before a barracks where the
// soldiers drill in ranks. Positions come from the sim (v._props from
// units/daily.js _dlProps, v._parade from _parade); everything is boxes in ONE
// instanced mesh (one draw call in all, no shadow pass), rebuilt a few times a
// second for the towns near the camera only.
const S = PROP.scale;
// benches and the stall are furniture for the people: they take the people's
// scale (round 24: half the round-14 size), the paved parade square the land's
const SU = UNIT.scale;
const MAX = 4800;
const NEAR = 95; // tiles from the camera target
const FAR_CAM = 140; // camera distance beyond which nothing is drawn

const C = {
  pave: new THREE.Color(0xb7b0a2),
  paveEdge: new THREE.Color(0x8f887b),
  wood: new THREE.Color(0x8a5a32),
  darkwood: new THREE.Color(0x5e3c22),
  iron: new THREE.Color(0x3a3a3e),
  awningA: new THREE.Color(0xc8402e),
  awningB: new THREE.Color(0xf0e4c8),
  goods: new THREE.Color(0xe0a040),
  greens: new THREE.Color(0x6aae46),
  metal: new THREE.Color(0xa8b0b8),
  paint: new THREE.Color(0xeeeae0),
  stone: new THREE.Color(0xa49c8c),
  concrete: new THREE.Color(0x9a9a96),
  water: new THREE.Color(0x4f86a8),
  paveDark: new THREE.Color(0x8c8273),
  paveLight: new THREE.Color(0xd2c9b6),
  lamp: new THREE.Color(0xf2e0a2),
  soil: new THREE.Color(0x4a3628),
  trunk: new THREE.Color(0x5a3e28),
  crown: new THREE.Color(0x3d7434),
  crown2: new THREE.Color(0x4f8a3c),
};

// the parade pad's ground by era (round 29): a, b the two tones of its
// checker, its kerb and its painted lines
const PAD = {
  gravel: { a: new THREE.Color(0x7a6e5b), b: new THREE.Color(0x6f6451), kerb: new THREE.Color(0x544b40), line: new THREE.Color(0xc9c0aa) },
  setts: { a: new THREE.Color(0x6b665f), b: new THREE.Color(0x5f5a54), kerb: new THREE.Color(0x4a4641), line: new THREE.Color(0xd2ccbe) },
  concrete: { a: new THREE.Color(0x777875), b: new THREE.Color(0x6c6d6a), kerb: new THREE.Color(0x525457), line: new THREE.Color(0xd4d2c8) },
};

// The parade pad's flagpole spot (round 31): its corner on the barracks side,
// on the pad's surface (the highest ground under it). The pole and the
// realm's flag with its emblem are drawn with the realm standards
// (buildings/BuildingRenderer), about 0.6 the size of the old flag.
export function padFlagSpot(pd, w) {
  const r = Math.atan2(pd.ax, pd.az);
  const W = pd.W + 0.2,
    D = pd.D + 0.2;
  const c = Math.cos(r),
    sn = Math.sin(r);
  let y = pd.y ?? w.heightAt(pd.x, pd.z);
  for (const [lx, lz] of [
    [0, 0],
    [W / 2, D / 2],
    [-W / 2, D / 2],
    [W / 2, -D / 2],
    [-W / 2, -D / 2],
  ])
    y = Math.max(y, w.heightAt(pd.x + lx * c + lz * sn, pd.z - lx * sn + lz * c));
  const fx = -W / 2 + 0.2,
    fz = -D / 2 + 0.2;
  return { x: pd.x + fx * c + fz * sn, y: y + 0.13, z: pd.z - fx * sn + fz * c, r };
}

export class SquareProps {
  constructor(game, parent) {
    this.game = game;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0); // boxes stand on their base
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.94, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.name = 'units:props';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, C.pave);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    parent.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._t = -9;
    this.n = 0;
    this._flag = new THREE.Color();
  }

  // One box: centre-bottom at local (lx, ly, lz) of a frame at (x, y, z)
  // turned by rot about Y, size (sx, sy, sz) in design units.
  _box(x, y, z, rot, lx, ly, lz, sx, sy, sz, col, S = SU) {
    if (this.n >= MAX) return;
    const c = Math.cos(rot),
      s = Math.sin(rot);
    this._p.set(x + (lx * c + lz * s) * S, y + ly * S, z + (-lx * s + lz * c) * S);
    this._q.setFromEuler(this._e.set(0, rot, 0));
    this._s.set(sx * S, sy * S, sz * S);
    this._m.compose(this._p, this._q, this._s);
    this.mesh.setMatrixAt(this.n, this._m);
    this.mesh.setColorAt(this.n, col);
    this.n++;
  }

  _bench(p, y) {
    // a slatted seat on two iron ends, with a back rest; it faces the square
    const r = p.rot;
    // (round 31: two thirds of a person long, a seat at the knee; it had been
    // as long as a person is tall)
    this._box(p.x, y, p.z, r, 0, 0.09, 0, 0.44, 0.03, 0.14, C.wood);
    this._box(p.x, y, p.z, r, 0, 0.12, -0.07, 0.44, 0.1, 0.025, C.wood);
    for (const sx of [-0.19, 0.19]) this._box(p.x, y, p.z, r, sx, 0, -0.01, 0.03, 0.1, 0.14, C.iron);
  }

  _stall(p, y, modern) {
    // a counter with goods, four posts and a striped awning
    const r = p.rot;
    this._box(p.x, y, p.z, r, 0, 0, 0, 0.78, 0.28, 0.34, modern ? C.metal : C.darkwood);
    this._box(p.x, y, p.z, r, -0.2, 0.28, 0.02, 0.2, 0.05, 0.18, C.goods);
    this._box(p.x, y, p.z, r, 0.12, 0.28, 0.02, 0.2, 0.06, 0.16, C.greens);
    for (const sx of [-0.37, 0.37]) for (const sz of [-0.15, 0.2]) this._box(p.x, y, p.z, r, sx, 0, sz, 0.035, 0.62, 0.035, C.wood);
    for (let i = 0; i < 4; i++) this._box(p.x, y, p.z, r, -0.33 + i * 0.22, 0.62, 0.04, 0.22, 0.04, 0.56, i % 2 ? C.awningB : C.awningA);
  }

  _pad(pd, w, flagCol, era = 0) {
    // the parade square (round 25): flush with the levelled ground (the site
    // is levelled when it is laid out, planner._keepClear), with painted
    // lines (a border and the two rank lines the soldiers stand on) and a
    // flagpole at the corner before the ranks. Sizes in world units (scale
    // 1): it is part of the ground, not a model.
    // Round 29: the pad was a plain light slab, the brightest thing in a
    // town, read as a parking lot (and glowed blue-white under a storm):
    // now a darker ground of the era (packed earth and gravel before the
    // Industrial era, dark setts, then grey concrete flags) in a checker of
    // two tones under a dark kerb, faint lines, and a tall flagpole whose
    // flag shows from 30 tiles.
    const r = Math.atan2(pd.ax, pd.az);
    const W = pd.W + 0.2,
      D = pd.D + 0.2;
    // (on the highest ground under it: grass covered half of a pad whose
    // site had been raised since it was levelled; a deep kerb skirts it)
    let y = pd.y ?? w.heightAt(pd.x, pd.z);
    {
      const c = Math.cos(r),
        sn = Math.sin(r);
      for (const [lx, lz] of [
        [0, 0],
        [W / 2, D / 2],
        [-W / 2, D / 2],
        [W / 2, -D / 2],
        [-W / 2, -D / 2],
      ])
        y = Math.max(y, w.heightAt(pd.x + lx * c + lz * sn, pd.z - lx * sn + lz * c));
    }
    const P = era >= 5 ? PAD.concrete : era >= 3 ? PAD.setts : PAD.gravel;
    this._box(pd.x, y - 0.14, pd.z, r, 0, 0, 0, W + 0.1, 0.144, D + 0.1, P.kerb, 1);
    this._box(pd.x, y - 0.03, pd.z, r, 0, 0, 0, W - 0.04, 0.036, D - 0.04, P.a, 1);
    // the checker of setts or flags (the darker squares only, flush)
    const nx = Math.max(2, Math.round(W / 0.55)),
      nz = Math.max(2, Math.round(D / 0.55));
    const cw = (W - 0.04) / nx,
      cd = (D - 0.04) / nz;
    for (let i = 0; i < nx; i++)
      for (let k = 0; k < nz; k++) {
        if ((i + k) & 1) continue;
        this._box(pd.x, y + 0.006, pd.z, r, -W / 2 + 0.02 + (i + 0.5) * cw, 0, -D / 2 + 0.02 + (k + 0.5) * cd, cw - 0.03, 0.002, cd - 0.03, P.b, 1);
      }
    const lw = 0.03,
      ly = y + 0.008,
      th = 0.003,
      e = 0.1;
    // the border
    this._box(pd.x, ly, pd.z, r, 0, 0, D / 2 - e, W - 2 * e, th, lw, P.line, 1);
    this._box(pd.x, ly, pd.z, r, 0, 0, -D / 2 + e, W - 2 * e, th, lw, P.line, 1);
    this._box(pd.x, ly, pd.z, r, W / 2 - e, 0, 0, lw, th, D - 2 * e, P.line, 1);
    this._box(pd.x, ly, pd.z, r, -W / 2 + e, 0, 0, lw, th, D - 2 * e, P.line, 1);
    // the two rank lines (units/daily.js _paradeSlot: ranks half a rank
    // gap either side of the centre)
    const f = 0.5 * Math.min(pd.D / 2.9, 1.5 * SU);
    for (const s of [-1, 1]) this._box(pd.x, ly, pd.z, r, 0, 0, s * f, Math.min(W - 0.5, 6 * 0.75 * SU + 0.2), th, lw * 0.7, P.line, 1);
    // the flagpole at the corner on the barracks side on a stone base, its
    // flag in the realm's colour flying out over the pad
    const fx = -W / 2 + 0.2,
      fz = -D / 2 + 0.2;
    this._box(pd.x, y, pd.z, r, fx, 0, fz, 0.2, 0.08, 0.2, P.kerb, 1);
    this._box(pd.x, y, pd.z, r, fx, 0.08, fz, 0.13, 0.05, 0.13, C.stone, 1);
    // (round 31: the pole and a smaller flag with the realm's emblem now fly
    // with the realm standards, padFlagSpot; the flag had been a blank
    // billboard)
  }

  // The main square by day (round 25: the squares and plazas read vast and
  // empty): a fountain in the open middle of the square before the hall,
  // planters at its corners, benches about the fountain and a pair of
  // stalls along one side, all at the people's scale. Placed on the paved
  // square only (keepClear bit 1, or a street tile), never on the parade
  // square or a building.
  _square(v, civ, w, pd, modern, day) {
    const h = v.hall;
    if (!h || h.alive === false || h.doorX == null) return;
    const kc = civ.keepClear,
      use = civ.use;
    const paved = (x, z) => {
      const tx = Math.floor(x),
        tz = Math.floor(z);
      if (!w.inBounds(tx, tz)) return false;
      const i = tz * w.w + tx;
      if (w.building[i] >= 0 || w.height[i] < 0) return false;
      if (!((kc && kc[i] & 1) || (use && use[i] === 2))) return false;
      if (pd && pd.ok && Math.abs((x - pd.x) * pd.ax + (z - pd.z) * pd.az) < pd.D / 2 + 0.3 && Math.abs(-(x - pd.x) * pd.az + (z - pd.z) * pd.ax) < pd.W / 2 + 0.3) return false;
      return true;
    };
    let dx = h.doorX - (h.x ?? h.doorX),
      dz = h.doorZ - (h.z ?? h.doorZ);
    const L = Math.hypot(dx, dz) || 1;
    dx /= L;
    dz /= L;
    // Round 27: the square's furniture is sized to the square. One boxy
    // fountain and four tiny benches stood lost on a plaza about 12 by 10
    // tiles, and at 30 tiles the green planters read as parked green cars.
    // The fountain stands in the middle of the paving before the hall and
    // grows with the open ground round it; a ring of lamps, a pattern of
    // darker setts, trees in round stone planters at the corners, and
    // benches round the basin.
    // (the square's own paving, not the streets off it)
    const sq = (x, z) => {
      if (!paved(x, z)) return false;
      const i = Math.floor(z) * w.w + Math.floor(x);
      return !!(kc && kc[i] & 1);
    };
    const run = (ox, oz, ux, uz, max) => {
      let t = 0;
      while (t < max && sq(ox + ux * (t + 0.5), oz + uz * (t + 0.5))) t += 0.5;
      return t;
    };
    const depth = run(h.doorX + dx * 0.6, h.doorZ + dz * 0.6, dx, dz, 12);
    let off = Math.max(1.6, Math.min(6, depth / 2 + 0.6));
    if (!sq(h.doorX + dx * off, h.doorZ + dz * off)) off = 1.6;
    const cx = h.doorX + dx * off,
      cz = h.doorZ + dz * off;
    if (!paved(cx, cz)) return;
    const y = w.heightAt(cx, cz);
    const rot = Math.atan2(dx, dz);
    const Q = Math.PI / 4;
    // the open ground round the centre
    let rO = 6;
    for (let a = 0; a < 8; a++) rO = Math.min(rO, run(cx, cz, Math.cos(a * Q), Math.sin(a * Q), 6));
    const big = rO >= 2.5;
    // basin side (world units): about four people across on a small square,
    // up to two tiles on a big plaza
    const B = Math.max(0.62, Math.min(2.2, rO * 0.42));
    const c = Math.cos(rot),
      s = Math.sin(rot);
    const at = (lx, lz) => [cx + lx * c + lz * s, cz - lx * s + lz * c];
    // the setts: a darker ring round the basin and, on a big plaza, an
    // outer ring with bands out to it on the diagonals (flush with the paving)
    const ring = (r, wdt, col) => {
      for (const [lx, lz, sx, sz] of [
        [0, r, 2 * r + wdt, wdt],
        [0, -r, 2 * r + wdt, wdt],
        [r, 0, wdt, 2 * r - wdt],
        [-r, 0, wdt, 2 * r - wdt],
      ])
        this._box(cx, y + 0.002, cz, rot, lx, 0, lz, sx, 0.006, sz, col, 1);
    };
    this._box(cx, y + 0.001, cz, rot, 0, 0, 0, B + 0.7, 0.006, B + 0.7, C.paveDark, 1);
    this._box(cx, y + 0.001, cz, rot + Q, 0, 0, 0, B + 0.7, 0.006, B + 0.7, C.paveDark, 1);
    if (big) {
      const r2 = Math.min(rO - 0.4, B * 0.5 + 2.2);
      ring(r2, 0.14, C.paveDark);
      ring(r2 - 0.32, 0.07, C.paveLight);
      for (let k = 0; k < 4; k++) {
        const a = rot + Q + k * 2 * Q;
        const r1 = (B + 0.7) * 0.5;
        const len = r2 * Math.SQRT2 - r1;
        const mx = cx + Math.sin(a) * (r1 + len / 2),
          mz = cz + Math.cos(a) * (r1 + len / 2);
        if (paved(mx, mz)) this._box(mx, y + 0.002, mz, a, 0, 0, 0, 0.12, 0.006, len, C.paveDark, 1);
      }
    }
    // the fountain: an eight-sided stone basin with a rim, its water, a
    // pedestal, a column with a wide bowl and a small top bowl
    const rimH = 0.1 + B * 0.04;
    for (const r0 of [rot, rot + Q]) {
      this._box(cx, y, cz, r0, 0, 0, 0, B, rimH, B, C.stone, 1);
      this._box(cx, y, cz, r0, 0, rimH, 0, B - 0.1, 0.004, B - 0.1, C.water, 1);
    }
    const colH = 0.3 + B * 0.25;
    this._box(cx, y, cz, rot + Q, 0, 0, 0, B * 0.22, rimH + 0.06, B * 0.22, C.stone, 1);
    this._box(cx, y, cz, rot, 0, 0, 0, 0.06 + B * 0.05, colH, 0.06 + B * 0.05, C.stone, 1);
    const bw = 0.2 + B * 0.22;
    for (const r0 of [rot, rot + Q]) {
      this._box(cx, y, cz, r0, 0, colH * 0.72, 0, bw, 0.05, bw, C.stone, 1);
      this._box(cx, y, cz, r0, 0, colH * 0.72 + 0.05, 0, bw - 0.05, 0.003, bw - 0.05, C.water, 1);
    }
    this._box(cx, y, cz, rot + Q, 0, colH, 0, bw * 0.45, 0.04, bw * 0.45, C.stone, 1);
    this._box(cx, y, cz, rot, 0, colH + 0.04, 0, bw * 0.12, 0.08, bw * 0.12, C.stone, 1);
    // benches round it, facing in (8 on a big plaza, 4 on a small square)
    const rB = B * 0.5 + (big ? 0.55 : 0.32);
    const nB = big ? 8 : 4;
    for (let k = 0; k < nB; k++) {
      const a = (k / nB) * Math.PI * 2;
      const [x, z] = at(Math.sin(a) * rB, Math.cos(a) * rB);
      if (paved(x, z)) this._bench({ x, z, rot: rot + a + Math.PI }, w.heightAt(x, z));
    }
    // lamp posts in a ring between the benches and the outer setts
    const rL = B * 0.5 + (big ? 1.25 : 0.75);
    const nL = big ? 8 : 4;
    for (let k = 0; k < nL; k++) {
      const a = ((k + 0.5) / nL) * Math.PI * 2;
      const [x, z] = at(Math.sin(a) * rL, Math.cos(a) * rL);
      if (!paved(x, z)) continue;
      const yy = w.heightAt(x, z);
      // (round 31) about two people tall (it had stood three and a half)
      this._box(x, yy, z, rot, 0, 0, 0, 0.05, 0.03, 0.05, C.iron, 1);
      this._box(x, yy, z, rot, 0, 0, 0, 0.02, 0.31, 0.02, C.iron, 1);
      this._box(x, yy, z, rot + a, 0, 0.31, 0, 0.055, 0.04, 0.055, C.lamp, 1);
      this._box(x, yy, z, rot + a, 0, 0.35, 0, 0.07, 0.012, 0.07, C.iron, 1);
    }
    // trees in round stone planters at the square's four corners (a grey
    // stone ring, dark soil, a trunk and a two-tier crown: no green slab)
    const rT = big ? Math.min(rO - 0.5, B * 0.5 + 2.0) : 1.2;
    for (const [sx, sz] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      const [x, z] = at(sx * rT * 0.92, sz * rT * 0.85);
      if (!paved(x, z)) continue;
      const yy = w.heightAt(x, z);
      const P = big ? 0.46 : 0.32;
      for (const r0 of [rot, rot + Q]) this._box(x, yy, z, r0, 0, 0, 0, P, 0.12, P, modern ? C.concrete : C.stone, 1);
      this._box(x, yy, z, rot + Q / 2, 0, 0.12, 0, P - 0.08, 0.005, P - 0.08, C.soil, 1);
      const T = big ? 1 : 0.75;
      this._box(x, yy, z, rot, 0, 0.12, 0, 0.05 * T, 0.32 * T, 0.05 * T, C.trunk, 1);
      this._box(x, yy, z, rot + 0.3, 0, 0.12 + 0.26 * T, 0, 0.4 * T, 0.2 * T, 0.4 * T, C.crown, 1);
      this._box(x, yy, z, rot + 0.3 + Q, 0, 0.12 + 0.3 * T, 0, 0.34 * T, 0.2 * T, 0.34 * T, C.crown2, 1);
      this._box(x, yy, z, rot + 0.3 + Q / 2, 0, 0.12 + 0.48 * T, 0, 0.22 * T, 0.14 * T, 0.22 * T, C.crown, 1);
    }
    // and by day two stalls along the side away from the hall
    if (day)
      for (const lx of [-0.75, 0.75]) {
        const [x, z] = at(lx, rB + 1.0);
        if (paved(x, z)) this._stall({ x, z, rot: rot + Math.PI }, w.heightAt(x, z), modern);
      }
  }

  update() {
    const g = this.game;
    const now = g.time.realTime;
    if (now - this._t < 0.4) return;
    this._t = now;
    this.n = 0;
    const cam = g.cameraRig?.cur;
    const civ = g.civ;
    const w = g.world;
    if (cam && civ && w && (cam.dist ?? 40) < FAR_CAM) {
      const tx = cam.x ?? cam.tx ?? 0,
        tz = cam.z ?? cam.tz ?? 0;
      const bById = civ._bById;
      const hr = g.time?.hour ?? 12;
      const day = hr >= 7 && hr < 19.5;
      for (const v of civ.villages || []) {
        if (!v || !v.alive) continue;
        if (Math.abs(v.cx - tx) > NEAR || Math.abs(v.cz - tz) > NEAR) continue;
        const pd = v._parade;
        const era = civ.kingdoms?.[v.kingdom]?.era || 0;
        if (pd && pd.ok) {
          const b = bById?.get(pd.b);
          if (!b || b.alive === false) v._parade = null;
          else {
            const kc = civ.kingdoms?.[v.kingdom]?.color;
            this._pad(pd, w, kc != null ? this._flag.set(kc) : null, era);
          }
        }
        if (era >= 2 && (v.pop || 0) >= 10) this._square(v, civ, w, pd && pd.ok ? pd : null, era >= 5, day);
        const pr = v._props;
        if (pr) {
          const modern = (pr.era || 0) >= 5;
          // stalls and benches stand on paved street or square tiles only
          // (never in a field), and never on the parade square
          const use = civ.use;
          const ok = (p) => {
            const tx = Math.floor(p.x),
              tz = Math.floor(p.z);
            if (!w.inBounds(tx, tz) || (use && use[tz * w.w + tx] !== 2)) return false;
            if (pd && pd.ok && Math.hypot(p.x - pd.x, p.z - pd.z) < Math.max(pd.W, pd.D) * 0.5 + 0.4) return false;
            return true;
          };
          if (pr.stall && ok(pr.stall)) this._stall(pr.stall, w.heightAt(pr.stall.x, pr.stall.z), modern);
          for (const b of pr.benches) if (ok(b)) this._bench(b, w.heightAt(b.x, b.z));
        }
      }
    }
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
