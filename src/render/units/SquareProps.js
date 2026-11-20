import * as THREE from 'three';
import { PROP } from '../../core/scale.js';

// Square props (Life module, round 19): benches and a food stall about each
// town's main square, and the paved parade square before a barracks where the
// soldiers drill in ranks. Positions come from the sim (v._props from
// units/daily.js _dlProps, v._parade from _parade); everything is boxes in ONE
// instanced mesh (one draw call in all, no shadow pass), rebuilt a few times a
// second for the towns near the camera only.
const S = PROP.scale;
const MAX = 1200;
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
  }

  // One box: centre-bottom at local (lx, ly, lz) of a frame at (x, y, z)
  // turned by rot about Y, size (sx, sy, sz) in design units.
  _box(x, y, z, rot, lx, ly, lz, sx, sy, sz, col) {
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

  _pad(pd, w) {
    // the paved parade square: a slab of setts with a darker kerb, laid level
    // (from the lowest ground under it to just above the highest: the site is
    // chosen nearly level, so the drilling ranks stand on it)
    const r = Math.atan2(pd.ax, pd.az);
    const W = (pd.W + 0.3) / S,
      D = (pd.D + 0.3) / S;
    // laid flush: a thin slab just proud of the highest ground under it (it
    // stood on a plinth down to the lowest ground, a raised platform)
    const lo = Math.max((pd.lo ?? pd.y) - 0.04, pd.y - 0.05);
    const h = (pd.y + 0.012 - lo) / S;
    this._box(pd.x, lo, pd.z, r, 0, 0, 0, W + 0.14, h - 0.012 / S, D + 0.14, C.paveEdge);
    this._box(pd.x, lo, pd.z, r, 0, 0, 0, W, h, D, C.pave);
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
      for (const v of civ.villages || []) {
        if (!v || !v.alive) continue;
        if (Math.abs(v.cx - tx) > NEAR || Math.abs(v.cz - tz) > NEAR) continue;
        const pd = v._parade;
        if (pd && pd.ok) {
          const b = bById?.get(pd.b);
          if (!b || b.alive === false) v._parade = null;
          else this._pad(pd, w);
        }
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
