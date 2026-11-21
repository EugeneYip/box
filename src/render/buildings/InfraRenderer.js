import * as THREE from 'three';
import { SEA_LEVEL } from '../../world/constants.js';
import { BUILDING, VEHICLE } from '../../core/scale.js';
import { hwPoint } from '../../sim/civ/modern.js';
import { GeoBuilder } from './geom.js';
import { pylonModel, PYLON_ARMS } from './modernModels.js';

// The modern infrastructure (docs/MODERN-ERAS.md), drawn from civ data:
//   railSegs()   each stretch of a realm's network once: steel rails on
//                sleepers and grey ballast following the terrain, steel
//                bridges with piers over rivers and the sea, maglev lines on a
//                white guideway raised on pillars (a flyover where two
//                cross), a switch where a branch leaves its trunk, a buffer
//                stop where a line ends at a station's platform
//                highways: an asphalt road with gravel shoulders a tile to
//                the right of the track, where the sim laid its road
//   powerLines() lattice pylons with sagging wires
// One merged mesh for everything solid, one set of lines for the wires, and
// at far zoom one set of thin lines instead of both. Rebuilt only when
// civ.infraVersion changes (or the terrain is reshaped). On a world whose
// edges join, no segment is drawn across the seam.

const BS = BUILDING.scale;
// the track itself (gauge, rails, sleepers, the ballast's width, the buffer
// stop) is sized to the trains that run on it, which take VEHICLE.land
// (round 24: half the round-14 size, so the gauge narrowed with them)
const TS = VEHICLE.land;
// sizes at the design scale (one tile = one unit, a person 0.6 tall), times BS or TS
const GAUGE = 0.26 * TS; // rail to rail
const RAIL_W = 0.045 * TS,
  RAIL_H = 0.034 * TS;
const SLEEPER_L = 0.24 * TS, // half length
  SLEEPER_W = 0.07 * TS,
  SLEEPER_H = 0.025 * TS;
const BAL_T = 0.27 * TS, // ballast bed: half width at the top, at the toe, height
  BAL_B = 0.4 * TS,
  BAL_H = 0.07 * BS;
const DECK_W = 0.5 * BS,
  GIRDER_H = 0.22 * BS,
  PIER_W = 0.22 * BS;
const MAG_Y = 0.95 * BS; // the guideway's deck above the ground
const GUIDE_W = 0.36 * TS, // (the maglev's beam, as wide as its trains)
  GUIDE_H = 0.15 * BS,
  PILLAR_W = 0.15 * BS,
  PILLAR_GAP = 2.2; // tiles between pillars
const HW_W = 0.62; // the highway's carriageway (a road, sized by the tiles)
const FAR = 150; // beyond this camera distance: thin lines only
const WIRE_D = 75; // wires drawn up to here (past it: pylons only, no dark scratches)
const VIADUCT = 0.12; // a rail bed this far over the ground rides on a bridge, below it on an embankment
const PIER_GAP = 1.6; // tiles between a bridge's piers

const COL = {
  ballast: 0x6c6a66,
  ballast2: 0x585550,
  sleeper: 0x3a2b21,
  rail: 0xe4e8ee,
  deck: 0x5a5e64,
  girder: 0x7a3a2c,
  pier: 0x9a948a,
  viaduct: 0xb0aca4,
  viaduct2: 0x948f86,
  guide: 0xd6dade,
  guide2: 0xaab2b8,
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
      // (round 22: the white guideways glowed bright at night: the guide
      // strip now only a faint line, and the pale concrete dims after dark)
      .replace('#include <color_fragment>', '#include <color_fragment>\n{ float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)); diffuseColor.rgb *= 1.0 - uNight * 0.45 * smoothstep(0.25, 0.7, lum); }')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow * vec3(0.4, 0.95, 1.0) * (0.05 + uNight * 0.14);');
  };
  m.customProgramCacheKey = () => 'wsInfra';
  return m;
}

function tanAt(P, i) {
  const n = P.length / 2;
  const a = Math.max(0, i - 1),
    b = Math.min(n - 1, i + 1);
  const dx = P[b * 2] - P[a * 2],
    dz = P[b * 2 + 1] - P[a * 2 + 1];
  const L = Math.hypot(dx, dz) || 1;
  return [dx / L, dz / L];
}

export class InfraRenderer {
  constructor(game, uniforms = null) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'civ-infrastructure';
    game.scene.add(this.group);
    this.mat = infraMaterial(uniforms);
    this.wireMat = new THREE.LineBasicMaterial({ color: 0x4a4e54, transparent: true, opacity: 0.55 });
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

  // One stretch of the network (civ.railSegs()): rails on sleepers and grey
  // ballast following the terrain (a steel bridge over water), or a maglev
  // guideway on pillars. A branch's first metre lies over its trunk: that
  // is the switch, drawn as rails only, with a lever box beside it.
  _track(E, seg, far) {
    const P = seg.pts;
    const n = P.length / 2;
    const elevated = seg.kind === 'maglev';
    const S = [];
    for (let i = 0; i < n; i++) {
      const [tx, tz] = tanAt(P, i);
      S.push([P[i * 2], P[i * 2 + 1], tx, tz]);
    }
    // levels from the sim (seg.ys: a gentle grade over dips, on piers where
    // the track leaves the ground); the ground is read here for the piers
    const ys = seg.ys && seg.ys.length === n ? seg.ys : null;
    const Y = S.map(([x, z], i) => {
      const h = this._h(x, z);
      const y = ys ? ys[i] : h < SEA_LEVEL ? SEA_LEVEL + 0.3 * BS : h + 0.02;
      return { g: h, wet: h < SEA_LEVEL, y, deck: ys ? ys[i] : Math.max(h, SEA_LEVEL) + MAG_Y };
    });
    if (elevated) seg._deck = [Y[0].deck, Y[Y.length - 1].deck];
    let arc = 0,
      lastPier = -1e9,
      lastPillar = -1e9;
    const swLen = seg.junction ? 1.1 : 0;
    for (let i = 0; i + 1 < S.length; i++) {
      const [ax, az, tx, tz] = S[i],
        [bx, bz] = S[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      const a0 = arc;
      arc += L;
      if (Math.abs(bx - ax) > 40 || L < 1e-4) continue; // the seam of a round world
      const ya = Y[i].y,
        yb = Y[i + 1].y;
      const px = -(bz - az) / L,
        pz = (bx - ax) / L;
      if (elevated) {
        // maglev: a white guideway on pillars with a glowing strip
        const la = seg.lift ? seg.lift[i] : 0,
          lb = seg.lift ? seg.lift[i + 1] : 0;
        const ga = Y[i].deck + la,
          gb = Y[i + 1].deck + lb;
        far.push(ax, ga, az, bx, gb, bz);
        E.bar(ax, az, bx, bz, ga, gb, GUIDE_W, GUIDE_H, COL.guide);
        E.bar(ax, az, bx, bz, ga + 0.003, gb + 0.003, GUIDE_W * 0.22, 0, COL.glow, 1, false);
        for (const s of [1, -1]) E.bar(ax + px * GUIDE_W * 0.42 * s, az + pz * GUIDE_W * 0.42 * s, bx + px * GUIDE_W * 0.42 * s, bz + pz * GUIDE_W * 0.42 * s, ga + 0.012, gb + 0.012, GUIDE_W * 0.12, 0.012, COL.guide2);
        if (a0 - lastPillar >= PILLAR_GAP && a0 > 0.3 && arc < seg.len - 0.3) {
          lastPillar = a0;
          const bed = Math.min(Y[i].g, SEA_LEVEL - 0.3);
          // a tall pier over a valley is a thicker one
          E.post(ax, az, bed, ga - GUIDE_H, PILLAR_W * (ga - Y[i].g > 1.4 ? 1.7 : 1), COL.guide2);
          E.bar(ax + tz * GUIDE_W * 0.6, az - tx * GUIDE_W * 0.6, ax - tz * GUIDE_W * 0.6, az + tx * GUIDE_W * 0.6, ga - GUIDE_H, ga - GUIDE_H, PILLAR_W * 0.8, PILLAR_W * 0.5, COL.guide2);
        }
        continue;
      }
      far.push(ax, ya + 0.02, az, bx, yb + 0.02, bz);
      const ha = ya - Y[i].g,
        hb = yb - Y[i + 1].g;
      const bridge = Y[i].wet || Y[i + 1].wet || Math.max(ha, hb) > VIADUCT;
      const sw = a0 < swLen;
      // (across a town's core: a concrete viaduct over the streets, its
      // piers on T-heads, parapets either side)
      const town = seg.core && (seg.core[i] || seg.core[i + 1]);
      if (bridge && town) {
        E.bar(ax, az, bx, bz, ya, yb, DECK_W * 1.3, GIRDER_H * 0.8, COL.viaduct);
        E.bar(ax, az, bx, bz, ya + 0.002, yb + 0.002, DECK_W * 1.1, 0, COL.ballast, 0, false);
        for (const sd of [1, -1]) E.bar(ax + px * DECK_W * 0.62 * sd, az + pz * DECK_W * 0.62 * sd, bx + px * DECK_W * 0.62 * sd, bz + pz * DECK_W * 0.62 * sd, ya + 0.05, yb + 0.05, 0.03, 0.05, COL.viaduct2);
        if (a0 - lastPier >= PIER_GAP * 1.25 && ha > GIRDER_H + 0.04) {
          lastPier = a0;
          E.post(ax, az, Y[i].g - 0.2, ya - GIRDER_H * 0.8, PIER_W * 1.1, COL.viaduct2);
          E.bar(ax + px * DECK_W * 0.6, az + pz * DECK_W * 0.6, ax - px * DECK_W * 0.6, az - pz * DECK_W * 0.6, ya - GIRDER_H * 0.8, ya - GIRDER_H * 0.8, PIER_W * 1.1, PIER_W * 0.5, COL.viaduct2);
        }
      } else if (bridge) {
        // a steel deck on red girders, on stone piers down to the ground or
        // the river bed
        E.bar(ax, az, bx, bz, ya, yb, DECK_W * 1.2, GIRDER_H, COL.girder);
        E.bar(ax, az, bx, bz, ya + 0.002, yb + 0.002, DECK_W, 0, COL.deck, 0, false);
        if (a0 - lastPier >= (Y[i].wet ? 2 : PIER_GAP) && (Y[i].wet || ha > GIRDER_H + 0.04)) {
          lastPier = a0;
          const tall = ya - Y[i].g > 1.2;
          E.post(ax, az, Y[i].g - 0.2, ya - GIRDER_H, PIER_W * (tall ? 1.5 : 1), COL.pier);
          if (tall) E.bar(ax + px * DECK_W * 0.75, az + pz * DECK_W * 0.75, ax - px * DECK_W * 0.75, az - pz * DECK_W * 0.75, ya - GIRDER_H, ya - GIRDER_H, PIER_W * 1.2, PIER_W * 0.6, COL.pier);
        }
      } else if (!sw) {
        // ballast: a low trapezoid bed, its sides running down to the ground
        // where it rides on an embankment
        const T1a = [ax + px * BAL_T, ya, az + pz * BAL_T],
          T2a = [ax - px * BAL_T, ya, az - pz * BAL_T],
          T1b = [bx + px * BAL_T, yb, bz + pz * BAL_T],
          T2b = [bx - px * BAL_T, yb, bz - pz * BAL_T];
        E.quad(T1a, T1b, T2b, T2a, COL.ballast);
        const da = Math.max(BAL_H, ha + 0.03),
          db = Math.max(BAL_H, hb + 0.03);
        const wa = BAL_B + (da - BAL_H) * 1.2,
          wb = BAL_B + (db - BAL_H) * 1.2;
        E.quad([ax + px * wa, ya - da, az + pz * wa], [bx + px * wb, yb - db, bz + pz * wb], T1b, T1a, COL.ballast2);
        E.quad([ax - px * wa, ya - da, az - pz * wa], [bx - px * wb, yb - db, bz - pz * wb], T2b, T2a, COL.ballast2);
      }
      // sleepers, three per step (none over the switch: the trunk's serve)
      if (!sw)
        for (let k = 0; k < 3; k++) {
          const t = (k + 0.5) / 3;
          const x = ax + (bx - ax) * t,
            z = az + (bz - az) * t,
            y = ya + (yb - ya) * t;
          E.bar(x - px * SLEEPER_L, z - pz * SLEEPER_L, x + px * SLEEPER_L, z + pz * SLEEPER_L, y + SLEEPER_H, y + SLEEPER_H, SLEEPER_W, SLEEPER_H, COL.sleeper);
        }
      // the two rails
      const rx = px * (GAUGE / 2),
        rz = pz * (GAUGE / 2);
      for (const s of [1, -1]) E.bar(ax + rx * s, az + rz * s, bx + rx * s, bz + rz * s, ya + SLEEPER_H + RAIL_H, yb + SLEEPER_H + RAIL_H, RAIL_W, RAIL_H, COL.rail);
    }
    // a diamond where two tracks cross: a steel crossing plate
    for (const [x, z, a1, a2] of seg.xing || []) {
      const y = Math.max(this._h(x, z), SEA_LEVEL) + 0.02 + SLEEPER_H + 0.002;
      for (const a of [a1, a2]) {
        const cx = Math.cos(a) * BAL_T * 2,
          cz = Math.sin(a) * BAL_T * 2;
        E.bar(x - cx, z - cz, x + cx, z + cz, y, y, BAL_T * 2.2, SLEEPER_H, COL.deck);
      }
    }
    if (seg.junction && !elevated && n > 2) {
      // the switch lever box beside the points
      const [x, z, tx, tz] = S[0];
      const side = this._turnSide(P);
      const bx = x + tz * side * 0.32,
        bz = z - tx * side * 0.32;
      const y = Math.max(this._h(bx, bz), SEA_LEVEL);
      E.post(bx, bz, y, y + 0.05 * BS * 2, 0.07 * BS * 2, COL.buffer);
    }
  }
  // which side a branch turns to (+1 right, -1 left of its first direction)
  _turnSide(P) {
    const n = P.length / 2;
    const [tx, tz] = tanAt(P, 0);
    const j = Math.min(n - 1, 8);
    const dx = P[j * 2] - P[0],
      dz = P[j * 2 + 1] - P[1];
    return dx * tz - dz * tx >= 0 ? 1 : -1;
  }

  // the end of a line: a buffer stop, and a short platform where the town
  // has no station yet (the station's own platform serves otherwise); a
  // guideway ends on a raised platform
  _terminus(E, seg, atStart) {
    const P = seg.pts;
    const n = P.length / 2;
    const i = atStart ? 0 : n - 1;
    let [tx, tz] = tanAt(P, i);
    if (atStart) (tx = -tx), (tz = -tz); // pointing out of the line's end
    const x = P[i * 2],
      z = P[i * 2 + 1];
    const px = -tz,
      pz = tx;
    const g = Math.max(this._h(x, z), SEA_LEVEL);
    const info = atStart ? seg.start : seg.end;
    if (info?.through) return; // (the line runs on through the platform)
    if (seg.kind === 'maglev') {
      const y = (seg._deck ? seg._deck[atStart ? 0 : 1] : g + MAG_Y) + (seg.lift ? seg.lift[i] : 0);
      const cx = x - tx * 0.8,
        cz = z - tz * 0.8;
      for (const s of [1, -1]) {
        const ox = px * s * (GUIDE_W * 0.5 + 0.16),
          oz = pz * s * (GUIDE_W * 0.5 + 0.16);
        E.bar(cx - tx * 0.8 + ox, cz - tz * 0.8 + oz, cx + tx * 0.8 + ox, cz + tz * 0.8 + oz, y + 0.02, y + 0.02, 0.26, 0.05, COL.guide);
        E.bar(cx - tx * 0.8 + ox * 1.5, cz - tz * 0.8 + oz * 1.5, cx + tx * 0.8 + ox * 1.5, cz + tz * 0.8 + oz * 1.5, y + 0.3, y + 0.3, 0.2, 0.02, COL.guide2);
        for (const e of [-0.7, 0.7]) E.post(cx + tx * e + ox * 1.6, cz + tz * e + oz * 1.6, y + 0.02, y + 0.3, 0.025, COL.guide2);
      }
      for (const e of [-0.6, 0.6]) E.post(cx + tx * e, cz + tz * e, Math.min(g, SEA_LEVEL - 0.3), y - GUIDE_H, PILLAR_W * 1.3, COL.guide2);
      return;
    }
    const y = seg.ys ? seg.ys[i] : g + 0.02;
    if (!info?.station) {
      const po = BAL_T + 0.1; // (beside the ballast)
      const cx = x - tx * 0.6 + px * po,
        cz = z - tz * 0.6 + pz * po;
      E.bar(cx - tx * 0.5, cz - tz * 0.5, cx + tx * 0.5, cz + tz * 0.5, y + 0.07, y + 0.07, 0.2, 0.09, COL.platform);
      E.bar(cx - tx * 0.5 - px * 0.09, cz - tz * 0.5 - pz * 0.09, cx + tx * 0.5 - px * 0.09, cz + tz * 0.5 - pz * 0.09, y + 0.072, y + 0.072, 0.015, 0, COL.edge, 0, false);
    }
    // the buffer stop: a red beam on two posts across the end of the rails
    E.bar(x - px * GAUGE * 0.75, z - pz * GAUGE * 0.75, x + px * GAUGE * 0.75, z + pz * GAUGE * 0.75, y + 0.1 * TS, y + 0.1 * TS, 0.05 * TS, 0.07 * TS, COL.buffer);
    for (const s of [1, -1]) E.post(x + px * GAUGE * 0.5 * s + tx * 0.04 * VEHICLE.rel, z + pz * GAUGE * 0.5 * s + tz * 0.04 * VEHICLE.rel, y, y + 0.06 * TS, 0.05 * TS, COL.sleeper);
  }

  // a highway beside a track, a tile off its bed (where the sim laid its
  // road: hw marks the points, hwPoint the centre), with a gravel shoulder
  _highway(E, seg, far) {
    const P = seg.pts,
      hw = seg.hw;
    const n = P.length / 2;
    const C = [];
    for (let i = 0; i < n; i++) C.push(hwPoint(P, i));
    // its level: on the ground, on a bridge over water (hw 2) with ramps
    // at a gentle grade either side
    const G = C.map(([x, z]) => this._h(x, z));
    const Yh = G.map((g, i) => (hw[i] === 2 || g < SEA_LEVEL ? SEA_LEVEL + 0.3 * BS : g + 0.03));
    for (let i = 1; i < n; i++) Yh[i] = Math.max(Yh[i], Yh[i - 1] - 0.08);
    for (let i = n - 2; i >= 0; i--) Yh[i] = Math.max(Yh[i], Yh[i + 1] - 0.08);
    let lastPier = -9;
    for (let i = 0; i + 1 < n; i++) {
      if (!hw[i] || !hw[i + 1]) continue;
      const [ax, az] = C[i],
        [bx, bz] = C[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 1e-4 || L > 3) continue;
      const ya = Yh[i],
        yb = Yh[i + 1];
      far.push(ax, ya + 0.02, az, bx, yb + 0.02, bz);
      const px = -(bz - az) / L,
        pz = (bx - ax) / L;
      const raised = ya - G[i] > 0.1 || yb - G[i + 1] > 0.1;
      if (raised) {
        // a bridge: a concrete deck with parapets, on piers
        E.bar(ax, az, bx, bz, ya - 0.004, yb - 0.004, HW_W + 0.14, 0.1, COL.pier);
        for (const s of [1, -1]) E.bar(ax + px * (HW_W / 2 + 0.05) * s, az + pz * (HW_W / 2 + 0.05) * s, bx + px * (HW_W / 2 + 0.05) * s, bz + pz * (HW_W / 2 + 0.05) * s, ya + 0.05, yb + 0.05, 0.04, 0.05, COL.pier);
        if (i - lastPier >= 5) {
          lastPier = i;
          E.post(ax, az, G[i] - 0.2, ya - 0.1, PIER_W, COL.pier);
        }
      } else
        // gravel shoulders, then the carriageway
        for (const s of [1, -1]) {
          const o = (HW_W / 2 + 0.07) * s;
          E.bar(ax + px * o, az + pz * o, bx + px * o, bz + pz * o, ya - 0.006, yb - 0.006, 0.14, 0.03, COL.ballast);
        }
      E.bar(ax, az, bx, bz, ya, yb, HW_W, 0.04, COL.asphalt);
      for (const s of [1, -1]) E.bar(ax + px * HW_W * 0.44 * s, az + pz * HW_W * 0.44 * s, bx + px * HW_W * 0.44 * s, bz + pz * HW_W * 0.44 * s, ya + 0.003, yb + 0.003, 0.016, 0, COL.edge, 0, false);
      if (i % 2 === 0) E.bar(ax, az, ax + (bx - ax) * 0.55, az + (bz - az) * 0.55, ya + 0.003, ya + (yb - ya) * 0.55 + 0.003, 0.016, 0, COL.mark, 0, false);
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
    for (const seg of civ.railSegs?.() || []) {
      if (!seg.pts || seg.pts.length < 4) continue;
      let len = 0;
      for (let i = 2; i < seg.pts.length; i += 2) len += Math.min(3, Math.hypot(seg.pts[i] - seg.pts[i - 2], seg.pts[i + 1] - seg.pts[i - 1]));
      seg.len = len;
      const n0 = far.length / 3;
      this._track(E, seg, far);
      farCol(n0, seg.kind === 'maglev' ? 0xe8f4f8 : 0x5a5650);
      if (seg.start) this._terminus(E, seg, true);
      if (seg.end) this._terminus(E, seg, false);
      if (seg.hw) {
        const n1 = far.length / 3;
        this._highway(E, seg, far);
        farCol(n1, 0x70747a);
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
        farCol(n0, 0xa8a69e);
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
      // the ground moved: the sim works out the tracks' levels again
      if (this._hver !== this._hSeen) {
        this._hSeen = this._hver;
        civ.railRelevel?.();
      }
      this._rebuild();
    }
    this._lod();
  }
}
