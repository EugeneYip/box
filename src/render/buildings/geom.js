import * as THREE from 'three';
import { mulberry32 } from '../../core/Random.js';

// Procedural low-poly geometry builder used for every building archetype.
// Emits a non-indexed, flat-shaded BufferGeometry with attributes:
//   position, normal, color (linear RGB, painterly per-face jitter and baked
//   contact occlusion near the ground), aTint (0..1 kingdom-colour mask) and
//   aGlow (0..1 night window glow mask).
// Convex primitives orient their triangles outward automatically, so winding
// mistakes are impossible.

const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _ctr = new THREE.Vector3();

export function lin(hex) {
  _c.setHex(hex);
  return [_c.r, _c.g, _c.b];
}

export function mix(h1, h2, t) {
  const a = new THREE.Color(h1),
    b = new THREE.Color(h2);
  return a.lerp(b, t).getHex();
}

export function shade(hex, k) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return c.getHex();
}

export class GeoBuilder {
  constructor(seed = 1, opts = {}) {
    this.P = [];
    this.N = [];
    this.C = [];
    this.T = [];
    this.G = [];
    this.R = [];
    this.span = null; // {kind, y0, y1} while emitting a roof surface
    this.roofKind = opts.roofKind || (() => 0);
    this.m = new THREE.Matrix4();
    this.stack = [];
    this.rand = mulberry32(seed * 9973 + 17);
    this.jitter = opts.jitter ?? 0.08;
    this.ao = opts.ao ?? true;
    this.maxY = 0;
    this.anchors = { banners: [], chimneys: [], blades: [], boats: [], lamps: [], fires: [], hearths: [] };
  }

  // ---------------------------------------------------------------- transform
  push() {
    this.stack.push(this.m.clone());
    return this;
  }
  pop() {
    this.m.copy(this.stack.pop());
    return this;
  }
  translate(x, y, z) {
    this.m.multiply(new THREE.Matrix4().makeTranslation(x, y, z));
    return this;
  }
  rotateY(a) {
    this.m.multiply(new THREE.Matrix4().makeRotationY(a));
    return this;
  }
  rotateX(a) {
    this.m.multiply(new THREE.Matrix4().makeRotationX(a));
    return this;
  }
  rotateZ(a) {
    this.m.multiply(new THREE.Matrix4().makeRotationZ(a));
    return this;
  }
  scale(x, y, z) {
    this.m.multiply(new THREE.Matrix4().makeScale(x, y, z));
    return this;
  }
  // Transform a local point to builder space (used for anchors).
  point(x, y, z) {
    _v.set(x, y, z).applyMatrix4(this.m);
    return [_v.x, _v.y, _v.z];
  }
  anchor(kind, x, y, z, extra = {}) {
    const p = this.point(x, y, z);
    this.anchors[kind].push({ x: p[0], y: p[1], z: p[2], ...extra });
  }

  // ---------------------------------------------------------------- raw
  // Triangle in local coordinates. `center` (local) orients it outward.
  tri(a, b, c, col, tint = 0, glow = 0, center = null, jit = null, jval = null) {
    const P = this.P;
    _a.set(a[0], a[1], a[2]).applyMatrix4(this.m);
    _b.set(b[0], b[1], b[2]).applyMatrix4(this.m);
    _v.set(c[0], c[1], c[2]).applyMatrix4(this.m);
    let A = _a.clone(),
      B = _b.clone(),
      Cc = _v.clone();
    _n.subVectors(B, A).cross(_v.subVectors(Cc, A));
    if (_n.lengthSq() < 1e-14) return;
    _n.normalize();
    if (center) {
      _ctr.set(center[0], center[1], center[2]).applyMatrix4(this.m);
      const fx = (A.x + B.x + Cc.x) / 3 - _ctr.x,
        fy = (A.y + B.y + Cc.y) / 3 - _ctr.y,
        fz = (A.z + B.z + Cc.z) / 3 - _ctr.z;
      if (_n.x * fx + _n.y * fy + _n.z * fz < 0) {
        const t = B;
        B = Cc;
        Cc = t;
        _n.negate();
      }
    }
    const rgb = typeof col === 'number' ? lin(col) : col;
    const j = jval ?? 1 + (this.rand() - 0.5) * 2 * (jit ?? this.jitter);
    for (const p of [A, B, Cc]) {
      P.push(p.x, p.y, p.z);
      this.N.push(_n.x, _n.y, _n.z);
      let k = j;
      if (this.ao && p.y < 0.5) k *= 0.7 + 0.3 * smooth(-0.05, 0.5, p.y);
      this.C.push(rgb[0] * k, rgb[1] * k, rgb[2] * k);
      this.T.push(tint);
      this.G.push(glow);
      if (this.span) this.R.push(this.span.kind, Math.max(0, Math.min(1, (p.y - this.span.y0) / (this.span.y1 - this.span.y0 || 1))));
      else this.R.push(0, 0);
      if (p.y > this.maxY) this.maxY = p.y;
    }
  }
  quad(a, b, c, d, col, tint = 0, glow = 0, center = null, jit = null) {
    // one jitter value for both halves so quads read as single facets
    const jv = 1 + (this.rand() - 0.5) * 2 * (jit ?? this.jitter);
    this.tri(a, b, c, col, tint, glow, center, jit, jv);
    this.tri(a, c, d, col, tint, glow, center, jit, jv);
  }

  // ---------------------------------------------------------------- primitives
  // Axis-aligned box: centre (cx, cz), base at y0, size sx, sy, sz.
  box(cx, y0, cz, sx, sy, sz, col, o = {}) {
    const x0 = cx - sx / 2,
      x1 = cx + sx / 2,
      z0 = cz - sz / 2,
      z1 = cz + sz / 2,
      y1 = y0 + sy;
    const t = o.tint || 0,
      g = o.glow || 0;
    const top = o.top ?? col;
    const ctr = [cx, y0 + sy / 2, cz];
    const jit = o.jit;
    if (o.ry) {
      this.push();
      this.translate(cx, 0, cz);
      this.rotateY(o.ry);
      this.translate(-cx, 0, -cz);
    }
    const s = o.side ?? col;
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], s, t, g, ctr, jit);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], s, t, g, ctr, jit);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], o.front ?? col, t, o.frontGlow ?? g, ctr, jit);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], o.back ?? col, t, g, ctr, jit);
    if (o.noTop !== true) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top, o.topTint ?? t, g, ctr, jit);
    if (o.bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col, t, g, ctr, jit);
    if (o.ry) this.pop();
    return this;
  }

  // Box spanning two points in XZ (for beams, rails, braces); y0..y1 may slope.
  beam(ax, ay, az, bx, by, bz, th, col, o = {}) {
    const dx = bx - ax,
      dy = by - ay,
      dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-5) return this;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
    m.compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), q, new THREE.Vector3(1, 1, 1));
    this.push();
    this.m.multiply(m);
    this.box(0, -(o.thY ?? th) / 2, 0, len, o.thY ?? th, th, col, o);
    this.pop();
    return this;
  }

  // Sloped roof slab from an eave line to a ridge line (both parallel to X).
  //   x0..x1 length, eave at (zE, yE), ridge at (zR, yR), thickness th.
  // The top is split into `rows` courses of slightly varying tone.
  slab(x0, x1, zE, yE, zR, yR, th, col, o = {}) {
    const t = o.tint || 0;
    const rows = o.rows || 1;
    const ctr = [(x0 + x1) / 2, (yE + yR) / 2 - th / 2, (zE + zR) / 2];
    // direction from eave to ridge
    const dz = zR - zE,
      dy = yR - yE;
    const L = Math.hypot(dz, dy);
    const nz = -dy / L,
      ny = dz / L; // normal (pointing up/out) in ZY plane, sign fixed below
    const sgn = ny < 0 ? -1 : 1;
    const ox = 0,
      oyy = -ny * sgn * th,
      ozz = -nz * sgn * th; // offset to underside
    const rgb = lin(col);
    const rk = o.roofKind ?? this.roofKind(col);
    if (rk) {
      _ctr.set(0, yE, 0).applyMatrix4(this.m);
      const y0w = _ctr.y;
      _ctr.set(0, yR, 0).applyMatrix4(this.m);
      this.span = { kind: rk, y0: y0w, y1: _ctr.y };
    }
    for (let r = 0; r < rows; r++) {
      const a0 = r / rows,
        a1 = (r + 1) / rows;
      const z0 = zE + dz * a0,
        y0 = yE + dy * a0,
        z1 = zE + dz * a1,
        y1 = yE + dy * a1;
      const tone = 1 + (r % 2 ? -0.05 : 0.04) + (this.rand() - 0.5) * 0.05;
      const c = [rgb[0] * tone, rgb[1] * tone, rgb[2] * tone];
      this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z1], [x0, y1, z1], c, t, 0, ctr, 0.02);
    }
    this.span = null;
    // underside
    const u = shade(col, 0.55);
    this.quad([x0, yE + oyy, zE + ozz], [x1, yE + oyy, zE + ozz], [x1, yR + oyy, zR + ozz], [x0, yR + oyy, zR + ozz], u, t * 0.5, 0, ctr);
    // eave fascia
    const f = o.fascia ?? shade(col, 0.78);
    this.quad([x0, yE, zE], [x1, yE, zE], [x1, yE + oyy, zE + ozz], [x0, yE + oyy, zE + ozz], f, t, 0, ctr);
    // verge ends
    this.quad([x0, yE, zE], [x0, yR, zR], [x0, yR + oyy, zR + ozz], [x0, yE + oyy, zE + ozz], f, t, 0, ctr);
    this.quad([x1, yE, zE], [x1, yR, zR], [x1, yR + oyy, zR + ozz], [x1, yE + oyy, zE + ozz], f, t, 0, ctr);
    void ox;
    return this;
  }

  // Gable roof (ridge along X unless o.axis === 'z'), sitting on y0, covering
  // w x d with overhang. Draws the wall gable infill in o.gable colour.
  gable(cx, y0, cz, w, d, h, col, o = {}) {
    const ov = o.over ?? 0.12;
    const th = o.th ?? 0.07;
    this.push();
    this.translate(cx, 0, cz);
    if (o.axis === 'z') {
      this.rotateY(Math.PI / 2);
      [w, d] = [d, w];
    }
    const x0 = -w / 2 - (o.overX ?? ov),
      x1 = w / 2 + (o.overX ?? ov);
    const hz = d / 2 + ov;
    const slopeY = (h * ov) / (d / 2);
    if (o.gable !== null && o.gable !== undefined) {
      // infill triangles flush with the walls
      const gc = o.gable;
      this.tri([-w / 2, y0, -d / 2], [-w / 2, y0, d / 2], [-w / 2, y0 + h, 0], gc, o.gableTint || 0, 0, [0, y0 + h / 3, 0]);
      this.tri([w / 2, y0, -d / 2], [w / 2, y0, d / 2], [w / 2, y0 + h, 0], gc, o.gableTint || 0, 0, [0, y0 + h / 3, 0]);
    }
    const lift = th * 0.5;
    this.slab(x0, x1, hz, y0 - slopeY + lift, 0, y0 + h + lift, th, col, { tint: o.tint, rows: o.rows ?? 3 });
    this.slab(x0, x1, -hz, y0 - slopeY + lift, 0, y0 + h + lift, th, col, { tint: o.tint, rows: o.rows ?? 3 });
    // ridge cap
    if (o.ridge !== false) this.box(0, y0 + h + lift - 0.02, 0, x1 - x0 + 0.02, 0.06, 0.09, o.ridgeCol ?? shade(col, 0.8), { tint: o.tint });
    this.pop();
    return this;
  }

  // Hip roof (or pyramid when w == d): eaves at y0, apex/ridge at y0+h.
  hip(cx, y0, cz, w, d, h, col, o = {}) {
    const ov = o.over ?? 0.12;
    const x0 = cx - w / 2 - ov,
      x1 = cx + w / 2 + ov,
      z0 = cz - d / 2 - ov,
      z1 = cz + d / 2 + ov;
    const sy = y0 - (h * ov) / (Math.min(w, d) / 2);
    const rl = Math.max(0, (x1 - x0) - (z1 - z0)) / 2;
    const r0 = [cx - rl, y0 + h, cz],
      r1 = [cx + rl, y0 + h, cz];
    const t = o.tint || 0;
    const ctr = [cx, y0, cz];
    const th = o.th ?? 0.06;
    // skirt
    const f = shade(col, 0.75);
    this.quad([x0, sy, z1], [x1, sy, z1], [x1, sy - th, z1], [x0, sy - th, z1], f, t, 0, ctr);
    this.quad([x1, sy, z0], [x0, sy, z0], [x0, sy - th, z0], [x1, sy - th, z0], f, t, 0, ctr);
    this.quad([x1, sy, z1], [x1, sy, z0], [x1, sy - th, z0], [x1, sy - th, z1], f, t, 0, ctr);
    this.quad([x0, sy, z0], [x0, sy, z1], [x0, sy - th, z1], [x0, sy - th, z0], f, t, 0, ctr);
    this.quad([x0, sy - th, z0], [x1, sy - th, z0], [x1, sy - th, z1], [x0, sy - th, z1], shade(col, 0.5), 0, 0, [cx, y0 + 1, cz]);
    // faces, in courses
    const rows = o.rows ?? 3;
    const rk = this.roofKind(col);
    if (rk) this.span = { kind: rk, y0: sy, y1: y0 + h };
    const faces = [
      [[x0, sy, z1], [x1, sy, z1], r1, r0],
      [[x1, sy, z0], [x0, sy, z0], r0, r1],
    ];
    for (const [a, b, c, dd] of faces) {
      for (let r = 0; r < rows; r++) {
        const k0 = r / rows,
          k1 = (r + 1) / rows;
        const L = (p, q, k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k];
        const tone = 1 + (r % 2 ? -0.05 : 0.04);
        this.quad(L(a, dd, k0), L(b, c, k0), L(b, c, k1), L(a, dd, k1), shade(col, tone), t, 0, ctr, 0.02);
      }
    }
    for (let r = 0; r < rows; r++) {
      const k0 = r / rows,
        k1 = (r + 1) / rows;
      const tone = 1 + (r % 2 ? -0.05 : 0.04) - 0.04;
      const L = (p, q, k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k];
      // right end
      this.quad(L([x1, sy, z1], r1, k0), L([x1, sy, z0], r1, k0), L([x1, sy, z0], r1, k1), L([x1, sy, z1], r1, k1), shade(col, tone), t, 0, ctr, 0.02);
      this.quad(L([x0, sy, z0], r0, k0), L([x0, sy, z1], r0, k0), L([x0, sy, z1], r0, k1), L([x0, sy, z0], r0, k1), shade(col, tone), t, 0, ctr, 0.02);
    }
    this.span = null;
    if (rl > 0.01 && o.ridge !== false) this.box(cx, y0 + h - 0.03, cz, rl * 2 + 0.06, 0.06, 0.08, shade(col, 0.8), { tint: t });
    return this;
  }

  // Cylinder / frustum / cone. r2 = top radius (default r). seg sides.
  cyl(cx, y0, cz, r, h, seg, col, o = {}) {
    const r2 = o.r2 ?? r;
    const t = o.tint || 0,
      g = o.glow || 0;
    const ctr = [cx, y0 + h / 2, cz];
    const a0 = o.rot || 0;
    for (let i = 0; i < seg; i++) {
      const a = a0 + (i / seg) * Math.PI * 2,
        b = a0 + ((i + 1) / seg) * Math.PI * 2;
      const ca = Math.cos(a),
        sa = Math.sin(a),
        cb = Math.cos(b),
        sb = Math.sin(b);
      const p0 = [cx + ca * r, y0, cz + sa * r],
        p1 = [cx + cb * r, y0, cz + sb * r];
      const q0 = [cx + ca * r2, y0 + h, cz + sa * r2],
        q1 = [cx + cb * r2, y0 + h, cz + sb * r2];
      const sc = o.stripes && i % 2 ? o.stripes : col;
      if (r2 > 1e-4) this.quad(p0, p1, q1, q0, sc, o.stripes && i % 2 ? o.stripeTint ?? t : t, g, ctr);
      else this.tri(p0, p1, [cx, y0 + h, cz], sc, o.stripes && i % 2 ? o.stripeTint ?? t : t, g, ctr);
      if (o.cap !== false && r2 > 1e-4) this.tri(q0, q1, [cx, y0 + h, cz], o.capCol ?? col, o.capTint ?? t, 0, ctr);
      if (o.bottom) this.tri(p0, p1, [cx, y0, cz], col, t, 0, ctr);
    }
    return this;
  }

  cone(cx, y0, cz, r, h, seg, col, o = {}) {
    const rk = r > 0.2 ? this.roofKind(col) : 0;
    if (rk) this.span = { kind: rk, y0, y1: y0 + h };
    this.cyl(cx, y0, cz, r, h, seg, col, { ...o, r2: 0 });
    this.span = null;
    return this;
  }

  // Hemisphere dome (sy scales the height).
  dome(cx, y0, cz, r, seg, rings, col, o = {}) {
    const sy = o.sy ?? 1;
    const t = o.tint || 0;
    const ctr = [cx, y0 + 0.01, cz];
    for (let j = 0; j < rings; j++) {
      const p0 = (j / rings) * (Math.PI / 2),
        p1 = ((j + 1) / rings) * (Math.PI / 2);
      const r0 = Math.cos(p0) * r,
        r1 = Math.cos(p1) * r;
      const y_0 = y0 + Math.sin(p0) * r * sy,
        y_1 = y0 + Math.sin(p1) * r * sy;
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2,
          b = ((i + 1) / seg) * Math.PI * 2;
        const A = [cx + Math.cos(a) * r0, y_0, cz + Math.sin(a) * r0];
        const B = [cx + Math.cos(b) * r0, y_0, cz + Math.sin(b) * r0];
        const C = [cx + Math.cos(b) * r1, y_1, cz + Math.sin(b) * r1];
        const D = [cx + Math.cos(a) * r1, y_1, cz + Math.sin(a) * r1];
        const c = o.ribs && i % 2 ? shade(col, 0.93) : col;
        if (j === rings - 1) this.tri(A, B, C, c, t, 0, ctr, 0.015);
        else this.quad(A, B, C, D, c, t, 0, ctr, 0.015);
      }
    }
    return this;
  }

  // Sphere-ish low poly blob (icosahedron-like via 2 cones) for heads, pots, finials.
  bead(cx, y0, cz, r, col, o = {}) {
    this.cyl(cx, y0 + r * 0.5, cz, r, r * 0.6, 6, col, { ...o, r2: r, cap: false });
    this.cone(cx, y0 + r * 1.1, cz, r, r * 0.6, 6, col, o);
    this.push();
    this.translate(cx, y0 + r * 0.5, cz);
    this.rotateX(Math.PI);
    this.cone(0, 0, 0, r, r * 0.5, 6, col, o);
    this.pop();
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('aTint', new THREE.Float32BufferAttribute(this.T, 1));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.G, 1));
    g.setAttribute('aRoof', new THREE.Float32BufferAttribute(this.R, 2));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

function smooth(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
