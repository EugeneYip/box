import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { mulberry32 } from '../../core/Random.js';

// Procedural geometry toolkit for the vegetation models.
//
// Every model is a non-indexed triangle soup with these attributes:
//   position, normal, color (linear RGB)
//   aInfo  vec4  x: bend weight (0 at the ground .. 1 at the crown)
//                y: flutter weight (leaf / frond jitter)
//                z: foliage mask (dries / blooms / shrinks for saplings)
//                w: material class (MAT.*), drives roughness and tints
//   aPivot vec3  point a foliage cluster shrinks toward while it is young
export const MAT = { WOOD: 0, LEAF: 1, ROCK: 2, SNOW: 3, GLOSS: 4, PETAL: 5, WHEAT: 6, CACTUS: 7, GRASS: 8 };

const _c = new THREE.Color();
// sRGB hex -> linear [r,g,b]
export function C(hex) {
  _c.setHex(hex);
  return [_c.r, _c.g, _c.b];
}
export const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _fc = new THREE.Vector3();
const _fn = new THREE.Vector3();
const _m3 = new THREE.Matrix3();

export class MeshBuilder {
  constructor(seed = 1) {
    this.rng = mulberry32(seed * 9301 + 49297);
    this.noise = createNoise3D(mulberry32(seed * 7 + 3));
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.info = [];
    this.piv = [];
    this.bendSet = []; // per-vertex explicit bend (NaN = auto from height)
  }
  r(a = 0, b = 1) {
    return a + (b - a) * this.rng();
  }
  get count() {
    return this.pos.length / 3;
  }

  // Append a geometry (indexed or not) as flat triangles.
  //   matrix     Matrix4 placing the part
  //   displace   (v: Vector3) => void, local-space displacement before matrix
  //   normals    'flat' | 'geo' | 'radial' | 'blend' | 'up' | (p, out) => out
  //   center     Vector3 for 'radial'/'blend' (model space, after matrix)
  //   blend      0..1 flat->radial for 'blend'
  //   color      [r,g,b] | (p, n, fc, fn) => [r,g,b]  (model space)
  //   faceColor  evaluate colour once per face (crisp facets)
  //   leaf, flutter, mat, bend (number|undefined)
  //   pivot      Vector3 | 'center' (bounding centre of this part)
  add(geo, o = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const P = g.attributes.position;
    const N = g.attributes.normal;
    const n = P.count;
    const pts = new Array(n);
    const gn = new Array(n);
    if (o.matrix) _m3.getNormalMatrix(o.matrix);
    for (let k = 0; k < n; k++) {
      const v = new THREE.Vector3(P.getX(k), P.getY(k), P.getZ(k));
      if (o.displace) o.displace(v);
      if (o.matrix) v.applyMatrix4(o.matrix);
      pts[k] = v;
      if (N) {
        const nn = new THREE.Vector3(N.getX(k), N.getY(k), N.getZ(k));
        if (o.matrix) nn.applyMatrix3(_m3).normalize();
        gn[k] = nn;
      }
    }
    let pivot = o.pivot;
    if (pivot === 'center' || (o.leaf && !pivot)) {
      const bb = new THREE.Box3().setFromPoints(pts);
      pivot = bb.getCenter(new THREE.Vector3());
    }
    if (!pivot) pivot = new THREE.Vector3(0, 0, 0);
    const center = o.center || pivot;
    const mode = o.normals || 'flat';
    const blend = o.blend ?? 0.5;
    const leaf = o.leaf ?? 0;
    const flutter = o.flutter ?? leaf;
    const mat = o.mat ?? MAT.WOOD;
    const bend = o.bend ?? NaN;
    for (let k = 0; k < n; k += 3) {
      const a = pts[k],
        b = pts[k + 1],
        c = pts[k + 2];
      _a.subVectors(b, a);
      _b.subVectors(c, a);
      _fn.crossVectors(_a, _b);
      const area = _fn.length();
      if (area < 1e-9) continue; // drop degenerate triangles
      _fn.multiplyScalar(1 / area);
      _fc.copy(a).add(b).add(c).multiplyScalar(1 / 3);
      let fcol = null;
      if (o.faceColor && typeof o.color === 'function') fcol = o.color(_fc, _fn, _fc, _fn);
      for (let j = 0; j < 3; j++) {
        const p = pts[k + j];
        // normal
        if (mode === 'flat') _n.copy(_fn);
        else if (mode === 'geo' && gn[k + j]) _n.copy(gn[k + j]);
        else if (mode === 'geoblend' && gn[k + j]) _n.copy(gn[k + j]).lerp(_fn, 1 - blend).normalize();
        else if (mode === 'up') _n.set(0, 1, 0);
        else if (mode === 'radial') _n.subVectors(p, center).normalize();
        else if (mode === 'blend') _n.subVectors(p, center).normalize().lerp(_fn, 1 - blend).normalize();
        else if (typeof mode === 'function') mode(p, _n, _fn);
        else _n.copy(_fn);
        if (o.twoSidedUp && _n.y < 0) _n.negate();
        const col = fcol || (typeof o.color === 'function' ? o.color(p, _n, _fc, _fn) : o.color || [1, 1, 1]);
        this.pos.push(p.x, p.y, p.z);
        this.nrm.push(_n.x, _n.y, _n.z);
        this.col.push(col[0], col[1], col[2]);
        this.info.push(0, flutter, leaf, mat);
        this.piv.push(pivot.x, pivot.y, pivot.z);
        this.bendSet.push(bend);
      }
    }
    if (g !== geo) g.dispose();
    return this;
  }

  // Raw triangle with explicit data (used by the custom strip builders).
  tri(p0, p1, p2, col, o = {}) {
    _a.subVectors(p1, p0);
    _b.subVectors(p2, p0);
    _fn.crossVectors(_a, _b);
    const len = _fn.length();
    if (len < 1e-10) return;
    _fn.multiplyScalar(1 / len);
    const rawDown = _fn.y < 0;
    if (o.up && rawDown) _fn.negate();
    const pv = o.pivot || p0;
    const cols = Array.isArray(col[0]) ? col : [col, col, col];
    const ns = o.normals;
    const fn = _fn.clone();
    const emit = (pts, order, flip) => {
      for (const j of order) {
        const p = pts[j];
        const nn = ns ? ns[j] : fn;
        const s = flip ? -1 : 1;
        this.pos.push(p.x, p.y, p.z);
        this.nrm.push(nn.x * s, nn.y * s, nn.z * s);
        this.col.push(cols[j][0], cols[j][1], cols[j][2]);
        this.info.push(0, o.flutter ?? o.leaf ?? 0, o.leaf ?? 0, o.mat ?? MAT.LEAF);
        this.piv.push(pv.x, pv.y, pv.z);
        this.bendSet.push(o.bend ?? NaN);
      }
    };
    const pts = [p0, p1, p2];
    // single-sided upward sheets must wind counter-clockwise seen from above
    if (o.single && o.up && rawDown) {
      emit(pts, [0, 2, 1], false);
      return;
    }
    emit(pts, [0, 1, 2], false);
    // Thin surfaces (leaves, petals, fronds) are emitted with both windings so
    // the material can cull back faces of the closed canopies.
    if (!o.single) emit(pts, [0, 2, 1], !o.up);
  }

  // Finalise. bendScale scales the auto bend (height-based); height is the
  // reference height for the bend curve (defaults to the model's max Y).
  build({ bendScale = 1, height = null, bendPow = 1.7 } = {}) {
    let maxY = 0;
    for (let k = 1; k < this.pos.length; k += 3) maxY = Math.max(maxY, this.pos[k]);
    const H = height || maxY || 1;
    const nV = this.count;
    for (let k = 0; k < nV; k++) {
      const y = this.pos[k * 3 + 1];
      const explicit = this.bendSet[k];
      const b = Number.isNaN(explicit) ? Math.pow(clamp01(y / H), bendPow) * bendScale : explicit;
      this.info[k * 4] = b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.info, 4));
    geo.setAttribute('aPivot', new THREE.Float32BufferAttribute(this.piv, 3));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    geo.userData.height = maxY;
    return geo;
  }
}

// ---------------------------------------------------------------------------
// Primitive generators (return THREE.BufferGeometry in local space).

// Lumpy foliage blob: icosphere displaced by 3D noise.
export function blobGeo(b, radius, detail, { lump = 0.22, freq = 1.6, squash = 1, seed = 0, flatBottom = 0 } = {}) {
  // detail 'd': a 36-triangle dodecahedron, rounder than a bare icosahedron
  const geo = detail === 'd' ? new THREE.DodecahedronGeometry(1, 0) : new THREE.IcosahedronGeometry(1, detail);
  const P = geo.attributes.position;
  const ox = b.r(-50, 50),
    oy = b.r(-50, 50),
    oz = b.r(-50, 50);
  for (let k = 0; k < P.count; k++) {
    _v.set(P.getX(k), P.getY(k), P.getZ(k)).normalize();
    const nz = b.noise(_v.x * freq + ox + seed, _v.y * freq + oy, _v.z * freq + oz);
    const nz2 = b.noise(_v.x * freq * 2.3 + oy, _v.y * freq * 2.3 + oz, _v.z * freq * 2.3 + ox) * 0.4;
    let r = radius * (1 + lump * (nz + nz2));
    _v.multiplyScalar(r);
    _v.y *= squash;
    if (flatBottom > 0 && _v.y < -radius * squash * (1 - flatBottom)) _v.y = -radius * squash * (1 - flatBottom) + (_v.y + radius * squash * (1 - flatBottom)) * 0.25;
    P.setXYZ(k, _v.x, _v.y, _v.z);
  }
  return geo;
}

// Tube along a polyline. radii per point. Returns non-indexed geometry with
// smooth radial normals. capTop closes the end with a cone point.
export function tubeGeo(path, radii, sides = 6, { capTop = true, capBottom = false, twist = 0, flare = null } = {}) {
  const n = path.length;
  const rings = [];
  const tangents = [];
  for (let i = 0; i < n; i++) {
    const t = new THREE.Vector3();
    if (i === 0) t.subVectors(path[1], path[0]);
    else if (i === n - 1) t.subVectors(path[n - 1], path[n - 2]);
    else t.subVectors(path[i + 1], path[i - 1]);
    tangents.push(t.normalize());
  }
  // parallel-transport frame
  let normal = new THREE.Vector3(1, 0, 0);
  if (Math.abs(tangents[0].x) > 0.9) normal.set(0, 0, 1);
  normal.sub(_v.copy(tangents[0]).multiplyScalar(normal.dot(tangents[0]))).normalize();
  const frames = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const axis = new THREE.Vector3().crossVectors(tangents[i - 1], tangents[i]);
      const s = axis.length();
      if (s > 1e-6) {
        axis.normalize();
        const ang = Math.acos(THREE.MathUtils.clamp(tangents[i - 1].dot(tangents[i]), -1, 1));
        normal.applyAxisAngle(axis, ang);
      }
    }
    const bin = new THREE.Vector3().crossVectors(tangents[i], normal).normalize();
    frames.push([normal.clone(), bin]);
  }
  for (let i = 0; i < n; i++) {
    const ring = [];
    const [N, B] = frames[i];
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2 + twist * i;
      let rr = radii[i];
      if (flare) rr *= flare(i, s, a);
      const dir = new THREE.Vector3().addScaledVector(N, Math.cos(a)).addScaledVector(B, Math.sin(a));
      ring.push({ p: path[i].clone().addScaledVector(dir, rr), n: dir });
    }
    rings.push(ring);
  }
  const pos = [],
    nor = [];
  const push = (v) => {
    pos.push(v.p.x, v.p.y, v.p.z);
    nor.push(v.n.x, v.n.y, v.n.z);
  };
  for (let i = 0; i < n - 1; i++) {
    for (let s = 0; s < sides; s++) {
      const a = rings[i][s],
        b = rings[i][(s + 1) % sides],
        c = rings[i + 1][s],
        d = rings[i + 1][(s + 1) % sides];
      push(a), push(b), push(d);
      push(a), push(d), push(c);
    }
  }
  if (capTop) {
    const tip = { p: path[n - 1].clone().addScaledVector(tangents[n - 1], radii[n - 1] * 0.9), n: tangents[n - 1].clone() };
    for (let s = 0; s < sides; s++) {
      push(rings[n - 1][s]), push(rings[n - 1][(s + 1) % sides]), push(tip);
    }
  }
  if (capBottom) {
    const tip = { p: path[0].clone(), n: tangents[0].clone().negate() };
    for (let s = 0; s < sides; s++) {
      push(rings[0][(s + 1) % sides]), push(rings[0][s]), push(tip);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return geo;
}

// Quadratic bezier sampled into n+1 points.
export function bezier(p0, p1, p2, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n,
      u = 1 - t;
    out.push(new THREE.Vector3(
      u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
      u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z,
    ));
  }
  return out;
}

// Build a matrix from position, euler (x,y,z radians) and scale (number|vec3).
export function M(px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
  return m;
}
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
