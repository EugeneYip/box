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
const MAX = 2400;
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
};

export class SquareProps {
  constructor(game, parent) {
    this.game = game;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0); // boxes stand on their base
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
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
    this._box(p.x, y, p.z, r, 0, 0.11, 0, 0.62, 0.035, 0.17, C.wood);
    this._box(p.x, y, p.z, r, 0, 0.15, -0.085, 0.62, 0.12, 0.03, C.wood);
    for (const sx of [-0.27, 0.27]) this._box(p.x, y, p.z, r, sx, 0, -0.01, 0.035, 0.12, 0.17, C.iron);
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

  _pad(pd, w, flagCol) {
    // the parade square (round 25): flush with the levelled ground (the site
    // is levelled when it is laid out, planner._keepClear), a thin wash of
    // setts with white painted lines (a border and the two rank lines the
    // soldiers stand on) and a flagpole at the corner before the ranks.
    // Sizes in world units (scale 1): it is part of the ground, not a model.
    const r = Math.atan2(pd.ax, pd.az);
    const W = pd.W + 0.2,
      D = pd.D + 0.2;
    const y = pd.y ?? w.heightAt(pd.x, pd.z);
    this._box(pd.x, y - 0.03, pd.z, r, 0, 0, 0, W, 0.036, D, C.pave, 1);
    const lw = 0.035,
      ly = y + 0.006,
      th = 0.003,
      e = 0.08;
    // the border
    this._box(pd.x, ly, pd.z, r, 0, 0, D / 2 - e, W - 2 * e, th, lw, C.paint, 1);
    this._box(pd.x, ly, pd.z, r, 0, 0, -D / 2 + e, W - 2 * e, th, lw, C.paint, 1);
    this._box(pd.x, ly, pd.z, r, W / 2 - e, 0, 0, lw, th, D - 2 * e, C.paint, 1);
    this._box(pd.x, ly, pd.z, r, -W / 2 + e, 0, 0, lw, th, D - 2 * e, C.paint, 1);
    // the two rank lines (units/daily.js _paradeSlot: ranks half a rank
    // gap either side of the centre) and the centre mark
    const f = 0.5 * Math.min(pd.D / 2.9, 1.5 * SU);
    for (const s of [-1, 1]) this._box(pd.x, ly, pd.z, r, 0, 0, s * f, Math.min(W - 0.5, 6 * 0.75 * SU + 0.2), th, lw * 0.7, C.paint, 1);
    // the flagpole at the corner on the barracks side, its flag in the realm's colour
    const fx = -W / 2 + 0.16,
      fz = -D / 2 + 0.16;
    this._box(pd.x, y, pd.z, r, fx, 0, fz, 0.1, 0.05, 0.1, C.paveEdge, 1);
    this._box(pd.x, y, pd.z, r, fx, 0, fz, 0.022, 0.95, 0.022, C.metal, 1);
    this._box(pd.x, y, pd.z, r, fx + 0.13, 0.78, fz, 0.24, 0.15, 0.01, flagCol || C.awningA, 1);
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
    const cx = h.doorX + dx * 1.6,
      cz = h.doorZ + dz * 1.6;
    if (!paved(cx, cz)) return;
    const y = w.heightAt(cx, cz);
    const rot = Math.atan2(dx, dz);
    // the fountain: a stone basin, its water, a column and a bowl (about
    // four people across, the column twice a person's height)
    const B = 0.62;
    this._box(cx, y, cz, rot, 0, 0, 0, B, 0.1, B, C.stone, 1);
    this._box(cx, y, cz, rot, 0, 0.1, 0, B - 0.08, 0.004, B - 0.08, C.water, 1);
    this._box(cx, y, cz, rot, 0, 0, 0, 0.08, 0.34, 0.08, C.stone, 1);
    this._box(cx, y, cz, rot, 0, 0.3, 0, 0.24, 0.04, 0.24, C.stone, 1);
    this._box(cx, y, cz, rot, 0, 0.34, 0, 0.18, 0.003, 0.18, C.water, 1);
    // benches round it, facing in
    const c = Math.cos(rot),
      s = Math.sin(rot);
    const at = (lx, lz) => [cx + lx * c + lz * s, cz - lx * s + lz * c];
    for (const [lx, lz, a] of [
      [0, 0.62, Math.PI],
      [0, -0.62, 0],
      [0.62, 0, -Math.PI / 2],
      [-0.62, 0, Math.PI / 2],
    ]) {
      const [x, z] = at(lx, lz);
      if (paved(x, z)) this._bench({ x, z, rot: rot + a }, w.heightAt(x, z));
    }
    // planters with a shrub at the square's four corners
    for (const [lx, lz] of [
      [1.25, 1.1],
      [-1.25, 1.1],
      [1.25, -0.9],
      [-1.25, -0.9],
    ]) {
      const [x, z] = at(lx, lz);
      if (!paved(x, z)) continue;
      const yy = w.heightAt(x, z);
      this._box(x, yy, z, rot, 0, 0, 0, 0.26, 0.09, 0.26, modern ? C.concrete : C.stone, 1);
      this._box(x, yy, z, rot, 0, 0.09, 0, 0.22, 0.08, 0.22, C.greens, 1);
    }
    // and by day two stalls along the side away from the hall
    if (day)
      for (const lx of [-0.75, 0.75]) {
        const [x, z] = at(lx, 1.6);
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
            this._pad(pd, w, kc != null ? this._flag.set(kc) : null);
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
