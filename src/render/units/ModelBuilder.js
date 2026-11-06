import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Procedural low-poly model builder. Parts are primitives placed in model
// space (Y up, facing +Z, feet at y = 0) and tagged with a bone, a material
// and an optional variant slot/option. build() merges them into one
// non-indexed geometry with an aRig attribute for RigMaterial.
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export class ModelBuilder {
  constructor(model) {
    this.model = model;
    this.parts = [];
    this.boneIdx = {};
    model.bones.forEach((b, i) => (this.boneIdx[b.name] = i));
    this.matIdx = {};
    model.materialTable = [];
    for (const [name, m] of Object.entries(model.materials)) {
      this.matIdx[name] = model.materialTable.length;
      model.materialTable.push(m);
    }
    this.slotIdx = {};
    (model.slots || []).forEach((s, i) => (this.slotIdx[s] = i));
    this.ctx = { bone: model.bones[0].name, mat: Object.keys(model.materials)[0], slot: null, opt: 0, flat: false };
  }

  // Set defaults for subsequent parts.
  with(ctx, fn) {
    const prev = { ...this.ctx };
    Object.assign(this.ctx, ctx);
    fn();
    this.ctx = prev;
    return this;
  }

  // Add a geometry. o: {pos, rot:[x,y,z] radians, scl, bone, mat, slot, opt, flat, quat}
  add(geo, o = {}) {
    const c = { ...this.ctx, ...o };
    if (c.minor && P.D < 0.75) {
      geo.dispose();
      return this;
    }
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal || c.flat) {
      g.deleteAttribute('normal');
      g.computeVertexNormals();
    }
    _p.set(...(c.pos || [0, 0, 0]));
    if (c.quat) _q.copy(c.quat);
    else _q.setFromEuler(_e.set(...(c.rot || [0, 0, 0]), c.order || 'XYZ'));
    const sc = c.scl ?? 1;
    if (typeof sc === 'number') _s.set(sc, sc, sc);
    else _s.set(...sc);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    if (c.flat) {
      g.deleteAttribute('normal');
      g.computeVertexNormals();
    }
    const n = g.attributes.position.count;
    const rig = new Float32Array(n * 4);
    const bone = this.boneIdx[c.bone];
    const mat = this.matIdx[c.mat];
    if (bone == null) throw new Error(`model ${this.model.id}: unknown bone ${c.bone}`);
    if (mat == null) throw new Error(`model ${this.model.id}: unknown material ${c.mat}`);
    const slot = c.slot == null ? -1 : this.slotIdx[c.slot];
    if (slot == null) throw new Error(`model ${this.model.id}: unknown slot ${c.slot}`);
    for (let i = 0; i < n; i++) {
      rig[i * 4] = bone;
      rig[i * 4 + 1] = mat;
      rig[i * 4 + 2] = slot;
      rig[i * 4 + 3] = c.opt || 0;
    }
    g.setAttribute('aRig', new THREE.BufferAttribute(rig, 4));
    this.parts.push(g);
    return this;
  }

  build() {
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    // weld shared vertices so the (expensive) rig vertex shader runs once per vertex
    const g = mergeVertices(merged, 1e-5);
    merged.dispose();
    g.computeBoundingSphere();
    return g;
  }
}

// ---- primitive helpers ---------------------------------------------------
const S = (n, min = 3) => Math.max(min, Math.round(n * P.D));
export const P = {
  D: 1, // detail factor: 1 = full, ~0.5 = low-detail LOD build
  sphere: (r = 1, ws = 10, hs = 8) => new THREE.SphereGeometry(r, S(ws, 5), S(hs, 3)),
  dome: (r = 1, ws = 12, hs = 6, frac = 0.5) => new THREE.SphereGeometry(r, S(ws, 5), S(hs, 2), 0, Math.PI * 2, 0, Math.PI * frac),
  capsule: (r, len, cap = 3, rad = 8) => new THREE.CapsuleGeometry(r, len, S(cap, 1), S(rad, 4)),
  cyl: (rTop, rBot, h, seg = 8, hs = 1, open = false) => new THREE.CylinderGeometry(rTop, rBot, h, S(seg, 4), hs, open),
  box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
  cone: (r, h, seg = 8) => new THREE.ConeGeometry(r, h, S(seg, 3)),
  ico: (r, detail = 0) => new THREE.IcosahedronGeometry(r, P.D < 0.75 ? 0 : detail),
  dodeca: (r, detail = 0) => new THREE.DodecahedronGeometry(r, detail),
  octa: (r) => new THREE.OctahedronGeometry(r, 0),
  torus: (R, r, rs = 6, ts = 14, arc = Math.PI * 2) => new THREE.TorusGeometry(R, r, S(rs, 3), S(ts, 5), arc),
  // Lathe from [[radius, y], ...] bottom to top.
  lathe: (pts, seg = 12) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y)), S(seg, 5)),
  // Tube through points [[x,y,z], ...] with radius (number or fn(t)).
  tube: (pts, r = 0.01, seg0 = 12, rs0 = 6) => {
    const seg = S(seg0, 3),
      rs = S(rs0, 4);
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    if (typeof r === 'number') return new THREE.TubeGeometry(curve, seg, r, rs, false);
    // tapered tube
    const g = new THREE.TubeGeometry(curve, seg, 1, rs, false);
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i <= seg; i++) {
      const c = curve.getPointAt(i / seg);
      const rad = r(i / seg);
      for (let j = 0; j <= rs; j++) {
        const k = i * (rs + 1) + j;
        v.fromBufferAttribute(pos, k).sub(c).multiplyScalar(rad).add(c);
        pos.setXYZ(k, v.x, v.y, v.z);
      }
    }
    g.computeVertexNormals();
    return g;
  },
  // Flat shape (array of [x,y]) extruded to a thin slab; lies in XY, thickness along Z.
  slab: (pts, depth = 0.01, bevel = 0) => {
    const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 6 });
    g.translate(0, 0, -depth / 2);
    return g;
  },
  // Smooth shape outline (Catmull-Rom through points) extruded thin.
  leaf: (pts, depth = 0.01, div = 24) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(x, y, 0)), true);
    const outline = curve.getPoints(S(div, 8)).map((p) => new THREE.Vector2(p.x, p.y));
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(outline), { depth, bevelEnabled: false });
    g.translate(0, 0, -depth / 2);
    return g;
  },
};

// Orientation helper: quaternion rotating +Y onto direction d.
export function alongY(d) {
  const v = new THREE.Vector3(...d).normalize();
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
}
// Cylinder/capsule between two points.
export function limb(a, b, r0, r1 = r0, seg = 8, capsule = false) {
  const A = new THREE.Vector3(...a),
    B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = capsule ? new THREE.CapsuleGeometry(r0, Math.max(0.001, len), 3, seg) : new THREE.CylinderGeometry(r1, r0, len, seg);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  const mid = A.clone().add(B).multiplyScalar(0.5);
  return { geo: g, o: { pos: [mid.x, mid.y, mid.z], quat: q } };
}
