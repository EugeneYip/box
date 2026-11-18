import * as THREE from 'three';
import { SEA_LEVEL } from '../../world/constants.js';
import { BUILDING, VEHICLE } from '../../core/scale.js';
import { GeoBuilder } from './geom.js';
import { pylonModel, PYLON_ARMS } from './modernModels.js';

// The modern infrastructure (docs/MODERN-ERAS.md), drawn from civ data:
//   railLines()  rails on sleepers and ballast following the terrain, steel
//                bridges with piers over rivers and the sea, maglev lines on a
//                white guideway raised on pillars, a platform and buffer stop
//                where each line ends in a town
//   highways()   a wide asphalt road with lane markings beside the line
//   powerLines() lattice pylons with sagging wires
// One merged mesh for everything solid, one set of lines for the wires, and
// at far zoom one set of thin lines instead of both. Rebuilt only when
// civ.infraVersion changes (or the terrain is reshaped). On a world whose
// edges join, no segment is drawn across the seam.

const BS = BUILDING.scale;
const VS = VEHICLE.land;
const GAUGE = 0.3 * VS; // rail to rail
const STEP = 0.3; // resampling along a line (world units)
const SIDE = 0.45; // rails run this far to one side of the road
const HSIDE = -0.42; // the highway on the other side
const MAG_Y = 0.85;
const FAR = 150; // beyond this camera distance: thin lines only
const WIRE_D = 115; // wires drawn up to here

const COL = {
  ballast: 0x6e665c,
  ballast2: 0x5a544c,
  sleeper: 0x4a3a2c,
  rail: 0x8c9096,
  deck: 0x5a5e64,
  girder: 0x7a3a2c,
  pier: 0x9a948a,
  guide: 0xe8ecee,
  guide2: 0xb4bcc2,
  glow: 0x9ff0ff,
  asphalt: 0x3e4044,
  mark: 0xe8e6dc,
  edge: 0xd8b840,
  platform: 0xb4aea4,
  buffer: 0xb83a2a,
  pylon: 0x7a8288,
};

// A lean emitter: flat-shaded quads with colour and a glow mask.
class Emit {
  constructor() {
    this.P = [];
    this.N = [];
    this.C = [];
    this.G = [];
    this._c = new THREE.Color();
  }
  quad(a, b, c, d, hex, glow = 0) {
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2];
    const vx = d[0] - a[0],
      vy = d[1] - a[1],
      vz = d[2] - a[2];
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    if (ny < -0.2) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    this._c.setHex(hex);
    const { r, g, b: bb } = this._c;
    for (const p of [a, b, c, a, c, d]) {
      this.P.push(p[0], p[1], p[2]);
      this.N.push(nx, ny, nz);
      this.C.push(r, g, bb);
      this.G.push(glow);
    }
  }
  // a box between two ground points (a beam of width w, height h, top at y)
  bar(ax, az, bx, bz, ya, yb, w, h, hex, glow = 0, sides = true) {
    const dx = bx - ax,
      dz = bz - az;
    const L = Math.hypot(dx, dz) || 1;
    const sx = (-dz / L) * (w / 2),
      sz = (dx / L) * (w / 2);
    const a1 = [ax + sx, ya, az + sz],
      a2 = [ax - sx, ya, az - sz],
      b1 = [bx + sx, yb, bz + sz],
      b2 = [bx - sx, yb, bz - sz];
    this.quad(a1, b1, b2, a2, hex, glow);
    if (sides && h > 0) {
      this.quad([a1[0], ya - h, a1[2]], [b1[0], yb - h, b1[2]], b1, a1, hex);
      this.quad([a2[0], ya - h, a2[2]], [b2[0], yb - h, b2[2]], b2, a2, hex);
    }
  }
  // a vertical post (square) from y0 to y1
  post(x, z, y0, y1, w, hex) {
    const h = w / 2;
    const c = [
      [x - h, z - h],
      [x + h, z - h],
      [x + h, z + h],
      [x - h, z + h],
    ];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = c[i],
        [bx, bz] = c[(i + 1) % 4];
      this.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], hex);
    }
    this.quad([x - h, y1, z - h], [x + h, y1, z - h], [x + h, y1, z + h], [x - h, y1, z + h], hex);
  }
  // append a baked geometry under a matrix
  geo(g, m) {
    const p = g.attributes.position.array,
      n = g.attributes.normal.array,
      c = g.attributes.color.array;
    const v = new THREE.Vector3(),
      nn = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = 0; i < p.length; i += 3) {
      v.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(m);
      nn.set(n[i], n[i + 1], n[i + 2]).applyMatrix3(nm).normalize();
      this.P.push(v.x, v.y, v.z);
      this.N.push(nn.x, nn.y, nn.z);
      this.C.push(c[i], c[i + 1], c[i + 2]);
      this.G.push(0);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.G, 1));
    g.computeBoundingSphere();
    return g;
  }
}

function infraMaterial(uniforms) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.05, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = uniforms?.uNight || { value: 0 };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow * vec3(0.4, 0.95, 1.0) * (0.35 + uNight * 2.2);');
  };
  m.customProgramCacheKey = () => 'wsInfra';
  return m;
}

// Chaikin corner cutting: the grid path becomes a gentle curve
function smooth(P, it = 2) {
  let A = P;
  for (let k = 0; k < it; k++) {
    if (A.length < 6) return A;
    const B = [A[0], A[1]];
    for (let i = 0; i + 3 < A.length; i += 2) {
      const ax = A[i],
        az = A[i + 1],
        bx = A[i + 2],
        bz = A[i + 3];
      B.push(ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25, ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75);
    }
    B.push(A[A.length - 2], A[A.length - 1]);
    A = B;
  }
  return A;
}

export class InfraRenderer {
  constructor(game, uniforms = null) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'civ-infrastructure';
    game.scene.add(this.group);
    this.mat = infraMaterial(uniforms);
    this.wireMat = new THREE.LineBasicMaterial({ color: 0x24262a, transparent: true, opacity: 0.8 });
    this.farMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 });
    this.mesh = null;
    this.wires = null;
    this.far = null;
    this._ver = -1;
    this._hver = 0;
    this._pylon = null;
    game.events.on('world:height', () => this._hver++);
  }

  reset() {
    this._ver = -1;
  }

  _h(x, z) {
    return this.game.world.heightAt(x, z);
  }
  _wet(x, z) {
    return this._h(x, z) < SEA_LEVEL;
  }

  // Split a polyline where it crosses the seam of a round world (or jumps).
  _runs(pts) {
    const W = this.game.world.w;
    const out = [];
    let cur = [pts[0], pts[1]];
    for (let i = 2; i + 1 < pts.length; i += 2) {
      if (Math.abs(pts[i] - pts[i - 2]) > W / 2 || Math.abs(pts[i + 1] - pts[i - 1]) > 40) {
        if (cur.length >= 4) out.push(cur);
        cur = [];
      }
      cur.push(pts[i], pts[i + 1]);
    }
    if (cur.length >= 4) out.push(cur);
    return out;
  }
  // resample a polyline every STEP, offset sideways by `off`
  _samples(P, off) {
    const S = [];
    let carry = 0;
    for (let i = 0; i + 3 < P.length; i += 2) {
      const ax = P[i],
        az = P[i + 1],
        bx = P[i + 2],
        bz = P[i + 3];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 1e-4) continue;
      const tx = (bx - ax) / L,
        tz = (bz - az) / L;
      for (let d = carry; d < L; d += STEP) S.push([ax + tx * d - tz * off, az + tz * d + tx * off, tx, tz]);
      carry = STEP - ((L - carry) % STEP);
      if (carry >= STEP) carry = 0;
    }
    const n = P.length;
    const tx = P[n - 2] - P[n - 4],
      tz = P[n - 1] - P[n - 3];
    const L = Math.hypot(tx, tz) || 1;
    S.push([P[n - 2] - (tz / L) * off, P[n - 1] + (tx / L) * off, tx / L, tz / L]);
    return S;
  }

  _track(E, S, far, elevated) {
    // deck heights: ground, or a bridge over water
    const Y = S.map(([x, z]) => {
      const h = this._h(x, z);
      return { g: h, wet: h < SEA_LEVEL, y: h < SEA_LEVEL ? SEA_LEVEL + 0.32 : h + 0.035 };
    });
    // a bridge's approaches ramp down to the banks
    for (let i = 0; i < Y.length; i++)
      if (!Y[i].wet)
        for (let k = 1; k <= 3; k++) {
          const j = Y[i - k]?.wet ? i - k : Y[i + k]?.wet ? i + k : -1;
          if (j >= 0) Y[i].y = Math.max(Y[i].y, Y[i].g + 0.035 + (SEA_LEVEL + 0.32 - Y[i].g - 0.035) * (1 - k / 4));
        }
    let lastPier = -9,
      lastPillar = -9;
    for (let i = 0; i + 1 < S.length; i++) {
      const [ax, az] = S[i],
        [bx, bz] = S[i + 1];
      const ya = Y[i].y,
        yb = Y[i + 1].y;
      far.push(ax, ya + 0.02, az, bx, yb + 0.02, bz);
      if (elevated) {
        // maglev: a white guideway on pillars with a glowing strip
        const ga = Math.max(ya, Y[i].g + MAG_Y),
          gb = Math.max(yb, Y[i + 1].g + MAG_Y);
        E.bar(ax, az, bx, bz, ga, gb, 0.2, 0.09, COL.guide);
        E.bar(ax, az, bx, bz, ga + 0.004, gb + 0.004, 0.04, 0, COL.glow, 1, false);
        if (i - lastPillar >= 5) {
          lastPillar = i;
          const bed = Math.min(Y[i].g, SEA_LEVEL - 0.3);
          E.post(ax, az, bed, ga - 0.09, 0.1, COL.guide2);
          const [, , tx, tz] = S[i];
          E.bar(ax + tz * 0.14, az - tx * 0.14, ax - tz * 0.14, az + tx * 0.14, ga - 0.09, ga - 0.09, 0.07, 0.05, COL.guide2);
        }
        continue;
      }
      const bridge = Y[i].wet || Y[i + 1].wet || ya > Y[i].g + 0.1;
      if (bridge) {
        // steel deck with red girders and stone piers
        E.bar(ax, az, bx, bz, ya, yb, 0.36, 0.14, COL.girder);
        E.bar(ax, az, bx, bz, ya + 0.002, yb + 0.002, 0.3, 0, COL.deck, 0, false);
        if (Y[i].wet && i - lastPier >= 4) {
          lastPier = i;
          E.post(ax, az, Y[i].g - 0.2, ya - 0.14, 0.14, COL.pier);
        }
      } else {
        // ballast: a low trapezoid bed
        const dx = bx - ax,
          dz = bz - az;
        const L = Math.hypot(dx, dz) || 1;
        const px = -dz / L,
          pz = dx / L;
        const wt = 0.17,
          wb = 0.24;
        const T1a = [ax + px * wt, ya, az + pz * wt],
          T2a = [ax - px * wt, ya, az - pz * wt],
          T1b = [bx + px * wt, yb, bz + pz * wt],
          T2b = [bx - px * wt, yb, bz - pz * wt];
        E.quad(T1a, T1b, T2b, T2a, COL.ballast);
        E.quad([ax + px * wb, ya - 0.05, az + pz * wb], [bx + px * wb, yb - 0.05, bz + pz * wb], T1b, T1a, COL.ballast2);
        E.quad([ax - px * wb, ya - 0.05, az - pz * wb], [bx - px * wb, yb - 0.05, bz - pz * wb], T2b, T2a, COL.ballast2);
      }
      // sleepers, three per step
      const dx = bx - ax,
        dz = bz - az;
      for (let k = 0; k < 3; k++) {
        const t = (k + 0.5) / 3;
        const x = ax + dx * t,
          z = az + dz * t,
          y = ya + (yb - ya) * t;
        const L = Math.hypot(dx, dz) || 1;
        const px = -dz / L,
          pz = dx / L;
        E.bar(x - px * 0.15, z - pz * 0.15, x + px * 0.15, z + pz * 0.15, y + 0.018, y + 0.018, 0.045, 0.018, COL.sleeper);
      }
      // the two rails
      const L = Math.hypot(dx, dz) || 1;
      const px = (-dz / L) * (GAUGE / 2),
        pz = (dx / L) * (GAUGE / 2);
      for (const s of [1, -1]) E.bar(ax + px * s, az + pz * s, bx + px * s, bz + pz * s, ya + 0.04, yb + 0.04, 0.018, 0.022, COL.rail);
    }
  }

  _platform(E, x, z, tx, tz, off) {
    // a short platform beside the end of the line, and a buffer stop
    const px = -tz,
      pz = tx;
    const y = Math.max(this._h(x, z), SEA_LEVEL + 0.1);
    const po = off + Math.sign(off) * 0.28;
    const cx = x - tx * 0.5 + px * po,
      cz = z - tz * 0.5 + pz * po;
    E.bar(cx - tx * 0.55, cz - tz * 0.55, cx + tx * 0.55, cz + tz * 0.55, y + 0.1, y + 0.1, 0.26, 0.14, COL.platform);
    E.bar(cx - tx * 0.55 - px * 0.11, cz - tz * 0.55 - pz * 0.11, cx + tx * 0.55 - px * 0.11, cz + tz * 0.55 - pz * 0.11, y + 0.102, y + 0.102, 0.02, 0, COL.edge, 0, false);
    const bx = x + px * off,
      bz = z + pz * off;
    E.bar(bx - px * 0.12, bz - pz * 0.12, bx + px * 0.12, bz + pz * 0.12, y + 0.12, y + 0.12, 0.06, 0.1, COL.buffer);
  }

  _highway(E, S, far, a, b) {
    const inTown = (x, z) => (a && Math.hypot(x - a.cx, z - a.cz) < a.radius * 0.8) || (b && Math.hypot(x - b.cx, z - b.cz) < b.radius * 0.8);
    for (let i = 0; i + 1 < S.length; i++) {
      const [ax, az] = S[i],
        [bx, bz] = S[i + 1];
      if (inTown(ax, az) || inTown(bx, bz)) continue;
      const ga = this._h(ax, az),
        gb = this._h(bx, bz);
      const wet = ga < SEA_LEVEL || gb < SEA_LEVEL;
      const ya = wet ? SEA_LEVEL + 0.28 : ga + 0.04,
        yb = wet ? SEA_LEVEL + 0.28 : gb + 0.04;
      far.push(ax, ya + 0.02, az, bx, yb + 0.02, bz);
      E.bar(ax, az, bx, bz, ya, yb, 0.62, wet ? 0.12 : 0.05, wet ? COL.deck : COL.asphalt);
      const dx = bx - ax,
        dz = bz - az;
      const L = Math.hypot(dx, dz) || 1;
      const px = -dz / L,
        pz = dx / L;
      for (const s of [1, -1]) E.bar(ax + px * 0.27 * s, az + pz * 0.27 * s, bx + px * 0.27 * s, bz + pz * 0.27 * s, ya + 0.003, yb + 0.003, 0.018, 0, COL.edge, 0, false);
      if (i % 2 === 0) E.bar(ax, az, ax + dx * 0.55, az + dz * 0.55, ya + 0.003, ya + (yb - ya) * 0.55 + 0.003, 0.018, 0, COL.mark, 0, false);
      if (wet && i % 5 === 0) E.post(ax, az, ga - 0.2, ya - 0.12, 0.14, COL.pier);
    }
  }

  _pylonGeo() {
    if (this._pylon) return this._pylon;
    const g = new GeoBuilder(91, { jitter: 0.04 });
    pylonModel(g, COL.pylon);
    this._pylon = g.build();
    return this._pylon;
  }

  _rebuild() {
    const civ = this.game.civ;
    const W = this.game.world.w;
    const E = new Emit();
    const far = [],
      farC = [],
      wire = [];
    const farCol = (from, hex) => {
      const c = new THREE.Color(hex);
      for (let i = from; i < far.length / 3; i++) farC.push(c.r, c.g, c.b);
    };
    for (const l of civ.railLines?.() || []) {
      if (!l.pts || l.pts.length < 4) continue;
      const elevated = l.kind === 'maglev';
      const runs = this._runs(l.pts);
      for (const run of runs) {
        const P = smooth(run);
        const n0 = far.length / 3;
        this._track(E, this._samples(P, SIDE), far, elevated);
        farCol(n0, elevated ? 0xe8f4f8 : 0x4a3a30);
        if (l.highway) {
          const n1 = far.length / 3;
          this._highway(E, this._samples(P, HSIDE), far, civ.villages[l.a], civ.villages[l.b]);
          farCol(n1, 0x70747a);
        }
      }
      // platforms where the line ends in its towns
      if (!elevated && runs.length) {
        const P = l.pts,
          n = P.length;
        for (const [x, z, x2, z2] of [
          [P[0], P[1], P[2], P[3]],
          [P[n - 2], P[n - 1], P[n - 4], P[n - 3]],
        ]) {
          if (Math.abs(x2 - x) > W / 2) continue;
          const L = Math.hypot(x - x2, z - z2) || 1;
          // the start is walked backwards, so its side flips
          this._platform(E, x, z, (x - x2) / L, (z - z2) / L, x === P[0] && z === P[1] ? -SIDE : SIDE);
        }
      }
    }
    // power lines: pylons and sagging wires
    const pg = this._pylonGeo();
    const m = new THREE.Matrix4(),
      sm = new THREE.Matrix4().makeScale(BS, BS, BS);
    const arm = new THREE.Vector3();
    for (const l of civ.powerLines?.() || []) {
      const P = [l.pts[0], l.pts[1], ...(l.pylons || []), l.pts[2], l.pts[3]];
      const tips = [];
      for (let i = 0; i + 1 < P.length; i += 2) {
        const x = P[i],
          z = P[i + 1];
        const j = Math.min(P.length - 2, i + 2),
          k = Math.max(0, i - 2);
        let dx = P[j] - P[k],
          dz = P[j + 1] - P[k + 1];
        if (Math.abs(dx) > W / 2) dx = 0;
        const yaw = Math.atan2(-dz, dx) + Math.PI / 2;
        const y = Math.max(this._h(x, z), SEA_LEVEL);
        m.makeRotationY(yaw).setPosition(x, y, z).multiply(sm);
        // the plant end hangs its wires on the plant; every other point gets a pylon
        if (i > 0) E.geo(pg, m);
        tips.push(PYLON_ARMS.map(([ax, ay]) => arm.set(ax, i > 0 ? ay : 1.4, 0).applyMatrix4(m).toArray()));
      }
      for (let i = 0; i + 1 < tips.length; i++) {
        const A = tips[i],
          B = tips[i + 1];
        if (Math.abs(A[0][0] - B[0][0]) > W / 2) continue;
        const n0 = far.length / 3;
        far.push(A[0][0], A[0][1], A[0][2], B[0][0], B[0][1], B[0][2]);
        farCol(n0, 0x2a2c30);
        for (let w = 0; w < A.length; w++) {
          const a = A[w],
            b = B[w];
          const span = Math.hypot(b[0] - a[0], b[2] - a[2]);
          const sag = Math.min(0.5, span * 0.05);
          let px = a[0],
            py = a[1],
            pz = a[2];
          for (let s = 1; s <= 6; s++) {
            const t = s / 6;
            const x = a[0] + (b[0] - a[0]) * t,
              z = a[2] + (b[2] - a[2]) * t,
              y = a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t);
            wire.push(px, py, pz, x, y, z);
            px = x;
            py = y;
            pz = z;
          }
        }
      }
    }
    // swap in the new geometry
    const set = (key, geo, make) => {
      let o = this[key];
      if (!geo) {
        if (o) o.visible = false;
        return;
      }
      if (!o) {
        o = this[key] = make(geo);
        this.group.add(o);
      } else {
        o.geometry.dispose();
        o.geometry = geo;
      }
      o.userData.has = true;
    };
    for (const k of ['mesh', 'wires', 'far']) if (this[k]) this[k].userData.has = false;
    set('mesh', E.P.length ? E.build() : null, (g) => {
      const o = new THREE.Mesh(g, this.mat);
      o.receiveShadow = true;
      o.castShadow = false;
      return o;
    });
    const lines = (pts, cols) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      if (cols) g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      g.computeBoundingSphere();
      return g;
    };
    set('wires', wire.length ? lines(wire) : null, (g) => new THREE.LineSegments(g, this.wireMat));
    set('far', far.length ? lines(far, farC) : null, (g) => new THREE.LineSegments(g, this.farMat));
    this._lod(true);
  }

  _lod(force = false) {
    const D = this.game.cameraRig?.cur?.dist ?? 60;
    const isFar = D > FAR || !!this.game.view?.far;
    const wires = D < WIRE_D;
    if (!force && isFar === this._isFar && wires === this._wiresOn) return;
    this._isFar = isFar;
    this._wiresOn = wires;
    if (this.mesh) this.mesh.visible = !isFar && this.mesh.userData.has;
    if (this.wires) this.wires.visible = !isFar && wires && this.wires.userData.has;
    if (this.far) this.far.visible = isFar && this.far.userData.has;
  }

  update() {
    const civ = this.game.civ;
    if (!civ) return;
    const v = (civ.infraVersion || 0) * 1000 + this._hver;
    if (v !== this._ver) {
      this._ver = v;
      this._rebuild();
    }
    this._lod();
  }
}
