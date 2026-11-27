import * as THREE from 'three';
import { SEA_LEVEL } from '../../world/constants.js';
import { BUILDING, VEHICLE } from '../../core/scale.js';
import { hwPoint, EMB_MAX, TUN_COVER, HW_COVER } from '../../sim/civ/modern.js';
import { GeoBuilder } from './geom.js';
import { pylonModel, PYLON_ARMS, substationModel, SUB_ARM_Y } from './modernModels.js';

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
// at far zoom one set of thin lines instead of both. Rebuilt when
// civ.infraVersion changes, each stretch and power line from its own kept
// part unless it changed; a ground edit re-levels and redraws only the
// stretches it touches. On a world whose edges join, no segment is drawn
// across the seam.

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
// a rail bed up to this far over the ground rides on an embankment, higher
// on a bridge on slim piers (round 33: about one and a half storeys; it was
// 0.12, so the line rode red girders over every dip)
const VIADUCT = EMB_MAX;
const PIER_GAP = 1.6; // tiles between a bridge's piers
// (round 35) ground edits are applied to the tracks they touch at most this
// often (ms)
const EDIT_GAP = 2500;
// (round 37) the solid geometry is drawn in square chunks this many tiles
// across (a change re-uploads its own chunk only), and at most this long
// (ms) is spent a drawn frame emitting the parts that changed
const CHUNK = 64;
const EMIT_MS = 10;

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
  shoulder: 0x6c6a66,
  mark: 0xe8e6dc,
  edge: 0xd8b840,
  platform: 0xb4aea4,
  buffer: 0xb83a2a,
  portal: 0x8c867c, // (round 35: a weathered stone, not round 33's cream)
  coping: 0x6c675f,
  ring: 0xa8a296,
  mouth: 0x121110,
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
  // (round 35) the emitted arrays, kept per stretch of track so a rebuild
  // re-emits only what changed
  pack() {
    return { P: Float32Array.from(this.P), N: Float32Array.from(this.N), C: Float32Array.from(this.C), G: Float32Array.from(this.G) };
  }
}

// (round 37) A stretch's content key: its kind, points, levels, tunnels,
// highway, flyover lifts, core runs, crossings and ends, so the same stretch
// laid again by a network rebuild (a new object each time) finds the part
// emitted for it. Two 32-bit FNV-1a style hashes over the values in
// millimetres.
function hashInto(H, a, q) {
  let h1 = H[0],
    h2 = H[1];
  const n = a ? a.length : -1;
  h1 = Math.imul(h1 ^ n, 16777619);
  h2 = Math.imul(h2 ^ n, 0x85ebca6b);
  for (let i = 0; i < n; i++) {
    const v = a[i];
    const k = v === v ? Math.round(v * q) | 0 : -7777777; // (NaN off a highway's runs)
    h1 = Math.imul(h1 ^ (k & 0xffff), 16777619);
    h1 = Math.imul(h1 ^ (k >>> 16), 16777619);
    h2 = Math.imul(h2 ^ k, 0x85ebca6b);
    h2 ^= h2 >>> 13;
  }
  H[0] = h1;
  H[1] = h2;
}
const _H = [0, 0];
function segKey(s) {
  _H[0] = 0x811c9dc5 | 0;
  _H[1] = 374761393;
  hashInto(_H, s.pts, 1000);
  hashInto(_H, s.ys, 1000);
  hashInto(_H, s.tun, 1);
  hashInto(_H, s.lift, 1000);
  hashInto(_H, s.hw, 1);
  hashInto(_H, s.hy, 1000);
  hashInto(_H, s.htun, 1);
  hashInto(_H, s.core, 1);
  hashInto(_H, s.xing ? s.xing.flat() : null, 1000);
  const f = (s.kind === 'maglev' ? 1 : 0) | (s.junction ? 2 : 0) | (s.start ? 4 : 0) | (s.start?.station ? 8 : 0) | (s.start?.through ? 16 : 0) | (s.end ? 32 : 0) | (s.end?.station ? 64 : 0) | (s.end?.through ? 128 : 0);
  return f + ':' + (_H[0] >>> 0).toString(36) + ':' + (_H[1] >>> 0).toString(36);
}
// a power line's: its ends, pylons and substation
function powKey(l) {
  _H[0] = 0x811c9dc5 | 0;
  _H[1] = 374761393;
  hashInto(_H, l.pts, 1000);
  hashInto(_H, l.pylons, 1000);
  return l.id + ':' + (l.sub ? 1 : 0) + ':' + (_H[0] >>> 0).toString(36) + ':' + (_H[1] >>> 0).toString(36);
}

// concatenate the typed arrays of many parts into one
function joinArrays(parts, key) {
  let n = 0;
  for (const p of parts) n += p[key].length;
  const out = new Float32Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p[key], o);
    o += p[key].length;
  }
  return out;
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
    // (round 27: the scene's haze washed these toward its pale colour at the
    // overview, so the rail read as grey-white scribbles; thin dark lines at
    // about 60% instead, unfogged)
    this.farMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, fog: false, depthWrite: false });
    this.wires = null;
    this.far = null;
    this._ver = -1;
    this._pylon = null;
    this.portals = [];
    // (round 35) each stretch's and each power line's geometry, kept until
    // it changes (round 37: by its content, segKey / powKey); the ground
    // edits not yet applied ([x0, z0, x1, z1] tiles)
    this._segGeo = new Map();
    this._powGeo = new Map();
    this._pid = 0;
    this._pend = false;
    // (round 37) the solid geometry in square chunks: key -> {mesh, parts, sig}
    this._chunks = new Map();
    this._edits = [];
    this._editT = -1e9;
    game.events.on('world:height', (r) => this._edit(r));
  }

  reset() {
    this._ver = -1;
    this._segGeo.clear();
    this._powGeo.clear();
    for (const ck of [...this._chunks.keys()]) this._setChunk(ck, null);
    this._swapLines();
    this._pend = false;
    this._edits.length = 0;
  }

  // A building levelled its plot, or the gods reshaped the ground: noted
  // here, applied (to the tracks it touches only) at most every EDIT_GAP
  // (round 34: every such edit anywhere re-levelled and redrew the whole
  // network, about 45 ms a drawn frame at Year 600)
  _edit(r) {
    const E = this._edits;
    E.push([r.x0, r.y0, r.x1, r.y1]);
    if (E.length > 48) {
      // (many small edits: one rectangle round them all)
      const u = [Infinity, Infinity, -Infinity, -Infinity];
      for (const e of E) (u[0] = Math.min(u[0], e[0])), (u[1] = Math.min(u[1], e[1])), (u[2] = Math.max(u[2], e[2])), (u[3] = Math.max(u[3], e[3]));
      E.length = 0;
      E.push(u);
    }
  }
  // the box round a stretch's track and highway, or a power line (tiles)
  _bounds(o, pts, extra, pad) {
    if (o._bb && o._bbN === pts.length) return o._bb;
    let x0 = Infinity,
      z0 = Infinity,
      x1 = -Infinity,
      z1 = -Infinity;
    for (const P of [pts, extra])
      for (let i = 0; P && i + 1 < P.length; i += 2) {
        x0 = Math.min(x0, P[i]);
        x1 = Math.max(x1, P[i]);
        z0 = Math.min(z0, P[i + 1]);
        z1 = Math.max(z1, P[i + 1]);
      }
    o._bbN = pts.length;
    return (o._bb = [x0 - pad, z0 - pad, x1 + pad, z1 + pad]);
  }
  _touched(bb, edits) {
    for (const e of edits) if (e[0] <= bb[2] && e[2] + 1 >= bb[0] && e[1] <= bb[3] && e[3] + 1 >= bb[1]) return true;
    return false;
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
    // (round 33) where the line runs in a tunnel: nothing drawn but its portals
    const tun = seg.tun && seg.tun.length === n ? seg.tun : null;
    const Y = S.map(([x, z], i) => {
      const h = this._h(x, z);
      const y = ys ? ys[i] : h < SEA_LEVEL ? SEA_LEVEL + 0.3 * BS : h + 0.02;
      return { g: h, wet: h < SEA_LEVEL, y, deck: ys ? ys[i] : Math.max(h, SEA_LEVEL) + MAG_Y };
    });
    if (elevated) seg._deck = [Y[0].deck, Y[Y.length - 1].deck];
    // (round 35) the mouths first: they mark the points behind them, whose
    // track is out of sight under the hill and not drawn
    const hide = tun ? new Uint8Array(n) : null;
    if (tun)
      this._portals(
        E,
        S,
        Y.map((o) => (elevated ? o.deck : o.y)),
        Y.map((o) => o.g),
        tun,
        (elevated ? GUIDE_W : BAL_B * 2) * 0.5 + 0.08,
        TUN_COVER,
        hide,
        elevated ? 'maglev' : 'rail',
      );
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
      if (hide && hide[i] && hide[i + 1]) continue;
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
        if (a0 - lastPillar >= PILLAR_GAP && a0 > 0.3 && arc < seg.len - 0.3 && ga - GUIDE_H > Y[i].g + 0.02) {
          lastPillar = a0;
          const bed = Math.min(Y[i].g, SEA_LEVEL - 0.3);
          // (a tall pier over a valley a little stouter, still slim)
          E.post(ax, az, bed, ga - GUIDE_H, PILLAR_W * (ga - Y[i].g > 1.4 ? 1.25 : 1), COL.guide2);
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
          E.post(ax, az, Y[i].g - 0.2, ya - GIRDER_H, PIER_W * (tall ? 1.1 : 0.85), COL.pier);
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
  // (round 35) A tunnel's mouths. The sim keeps a bore's approach short
  // (modern.js PORTAL_LEN): the line runs on the surface up to the foot of
  // a hillside steep enough that the ground stands a storey over it within
  // half a tile, and goes under it there. At each end of a run of points in
  // a tunnel (tun), out along the approach while the line is still below the
  // ground, the mouth stands where it goes under: a headwall facing out,
  // never over the water. The points behind it are marked in hide (their
  // track is not drawn). S: the points [x, z, tx, tz], y: the line's level,
  // g: the ground at each, half: the half width inside, cover: the cover a
  // bore needs, kind: 'rail', 'maglev' or 'hw'. Round 33 drew the approach
  // as a covered way, a concrete box over the line up to 1.2 tiles long,
  // which stood on level fields and out in the water as cream slabs.
  _portals(E, S, y, g, tun, half, cover, hide, kind) {
    const n = S.length;
    for (let i = 0; i < n; ) {
      if (!tun[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < n && tun[j]) j++;
      for (let m = i; m < j; m++) hide[m] = 1;
      for (const [edge, step] of [
        [i, -1],
        [j - 1, 1],
      ]) {
        let m = edge;
        while (m + step >= 0 && m + step < n && !tun[m + step] && g[m + step] - y[m + step] > 0.01 && Math.abs(m + step - edge) < 6) {
          m += step;
          hide[m] = 1;
        }
        // (a bore that runs on to the end of the stretch opens on the next)
        if (m + step < 0 || m + step >= n) continue;
        if (g[m] < SEA_LEVEL + 0.02 || g[m + step] < SEA_LEVEL + 0.02) continue;
        this._mouth(E, S[m], y[m], step, half, cover, kind);
      }
      i = j;
    }
  }
  // A tunnel's mouth at point Sm [x, z, tx, tz], the line's level y there,
  // out: +1 when the open side faces along the line's direction. Round 35:
  // a stone headwall across the line with a coping along its top, a dark
  // arched opening framed by a lighter ring of voussoirs, and two wing walls
  // splayed out from its ends, their tops falling to the ground, holding
  // back the hillside either side of the approach (round 33 drew a cream
  // box with a square dark panel).
  _mouth(E, Sm, y, out, half, cover, kind) {
    const [x, z, tx0, tz0] = Sm;
    const ox = tx0 * out,
      oz = tz0 * out; // out of the bore
    (this._partPortals || []).push({ x, z, y, tx: ox, tz: oz, kind });
    const px = -oz,
      pz = ox; // across the line
    // the opening: straight sides up to the springing, then a half ellipse
    const hw = half * 0.86,
      hs = cover * 0.45,
      ar = Math.min(hw * 0.8, cover * 0.75);
    const top = y + Math.max(hs + ar + 0.1, cover + 0.08);
    const W2 = hw + 0.16; // the headwall's half width
    const TH = 0.08; // its thickness
    const base = y - 0.18; // (its footing, in the ground)
    // the face: on the hillside, a little out from the point
    const fx = x + ox * 0.02,
      fz = z + oz * 0.02;
    E.bar(fx - px * W2, fz - pz * W2, fx + px * W2, fz + pz * W2, top, top, TH, top - base, COL.portal);
    E.bar(fx - px * (W2 + 0.025), fz - pz * (W2 + 0.025), fx + px * (W2 + 0.025), fz + pz * (W2 + 0.025), top + 0.025, top + 0.025, TH + 0.04, 0.03, COL.coping);
    // a point on the face, u across and v up from the line's level, d out
    const F = (u, v, d) => [fx + px * u + ox * (TH / 2 + d), y + v, fz + pz * u + oz * (TH / 2 + d)];
    const K = 8;
    const curve = (r, k) => {
      const t = (Math.PI * k) / K;
      return [(hw + r) * Math.cos(t), hs + (ar + r) * Math.sin(t)];
    };
    // the ring of voussoirs round the arch and down its sides
    const R = 0.055;
    for (let k = 0; k < K; k++) {
      const [u0, v0] = curve(0, k),
        [u1, v1] = curve(0, k + 1),
        [U0, V0] = curve(R, k),
        [U1, V1] = curve(R, k + 1);
      E.quad(F(u0, v0, 0.004), F(U0, V0, 0.004), F(U1, V1, 0.004), F(u1, v1, 0.004), COL.ring);
    }
    for (const sd of [1, -1]) E.quad(F(sd * hw, -0.02, 0.004), F(sd * (hw + R), -0.02, 0.004), F(sd * (hw + R), hs, 0.004), F(sd * hw, hs, 0.004), COL.ring);
    // the dark opening: the sides, then a fan under the arch
    E.quad(F(-hw, -0.03, 0.008), F(hw, -0.03, 0.008), F(hw, hs, 0.008), F(-hw, hs, 0.008), COL.mouth);
    for (let k = 0; k < K; k++) {
      const [u0, v0] = curve(0, k),
        [u1, v1] = curve(0, k + 1);
      E.quad(F(0, hs, 0.008), F(u0, v0, 0.008), F(u1, v1, 0.008), F(u1, v1, 0.008), COL.mouth);
    }
    // the wing walls: splayed out from the headwall's ends, falling to the
    // ground at their far ends (buried below it)
    const WL = kind === 'hw' ? 0.75 : 0.55,
      SP = kind === 'hw' ? 0.38 : 0.28;
    for (const sd of [1, -1]) {
      const ax = fx + px * sd * (W2 - 0.03),
        az = fz + pz * sd * (W2 - 0.03);
      const bx = ax + px * sd * SP + ox * WL,
        bz = az + pz * sd * SP + oz * WL;
      const gb = Math.max(this._h(bx, bz), y);
      const yb = Math.min(top - 0.05, gb + 0.05);
      E.bar(ax, az, bx, bz, top - 0.01, yb, 0.06, top - 0.01 - base, COL.portal);
      E.bar(ax, az, bx, bz, top + 0.01, yb + 0.015, 0.085, 0.025, COL.coping);
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
  // road: hw marks the points, hwPoint the centre). Round 29: one continuous
  // ribbon per run (the decks were separate slabs with steps and seams at
  // every joint, and the ground poked through their edges as olive spikes):
  // each point's cross-section is shared by the two steps either side of it
  // and turned to the bisector of the bend (a mitred joint); the deck lies
  // level across at the highest ground under it, and concrete skirts run
  // from its edges down into the ground (or a fascia over water).
  _highway(E, seg, far) {
    const P = seg.pts,
      hw = seg.hw;
    const n = P.length / 2;
    const C = [];
    for (let i = 0; i < n; i++) C.push(hwPoint(P, i));
    // the cross-section direction at each point: the bisector of the steps
    // either side, and the mitre's stretch so the deck keeps its width
    const Nx = new Float32Array(n),
      Nz = new Float32Array(n),
      Mi = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1),
        b = Math.min(n - 1, i + 1);
      let dx = C[b][0] - C[a][0],
        dz = C[b][1] - C[a][1];
      if (Math.abs(dx) > 6 || Math.abs(dz) > 6) (dx = C[Math.min(n - 1, i + 1)][0] - C[i][0]), (dz = C[Math.min(n - 1, i + 1)][1] - C[i][1]);
      const L = Math.hypot(dx, dz) || 1;
      Nx[i] = -dz / L;
      Nz[i] = dx / L;
      let m = 1;
      if (i > 0 && i < n - 1) {
        const sx = C[i + 1][0] - C[i][0],
          sz = C[i + 1][1] - C[i][1];
        const sL = Math.hypot(sx, sz) || 1;
        m = 1 / Math.max(0.6, (sx * dx + sz * dz) / (sL * L));
      }
      Mi[i] = m;
    }
    const SO = HW_W / 2 + 0.14; // the deck's half width, shoulders and all
    // the highest ground under the deck at each point: its centre, both
    // edges and halfway to the next point either side
    const gAt = (i, o) => this._h(C[i][0] + Nx[i] * o, C[i][1] + Nz[i] * o);
    const G = C.map(([x, z]) => this._h(x, z));
    const GL = new Float32Array(n),
      GR = new Float32Array(n),
      Gmax = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      GL[i] = gAt(i, SO);
      GR[i] = gAt(i, -SO);
      let m = Math.max(G[i], GL[i], GR[i]);
      for (const j of [i - 1, i + 1]) {
        if (j < 0 || j >= n || Math.abs(C[j][0] - C[i][0]) > 3) continue;
        const mx = (C[i][0] + C[j][0]) / 2,
          mz = (C[i][1] + C[j][1]) / 2;
        for (const o of [0, SO, -SO]) m = Math.max(m, this._h(mx + Nx[i] * o, mz + Nz[i] * o));
      }
      Gmax[i] = m;
    }
    // its level: from the sim (round 33: seg.hy, under the road's grade
    // cap, through a tunnel where it meets a ridge); else on the ground, on
    // a bridge over water (hw 2) with ramps at a gentle grade either side
    const HY = seg.hy && seg.hy.length === n ? seg.hy : null;
    const tun = seg.htun && seg.htun.length === n ? seg.htun : null;
    const Yh = G.map((g, i) => (HY && Number.isFinite(HY[i]) ? HY[i] : Math.max(hw[i] === 2 || g < SEA_LEVEL ? SEA_LEVEL + 0.3 * BS : g, Gmax[i] + 0.035)));
    // (round 27) the ramps run only out from a bridge and along the drawn
    // road: a deck carried on at the grade from the top of a slope stood on
    // tall pillars over a canyon edge, and one ended in mid-air at a bank
    const up = (i) => Yh[i] - Gmax[i] > 0.05;
    if (!HY) {
      for (let i = 1; i < n; i++) if (hw[i] && hw[i - 1] && up(i - 1)) Yh[i] = Math.max(Yh[i], Yh[i - 1] - 0.08);
      for (let i = n - 2; i >= 0; i--) if (hw[i] && hw[i + 1] && up(i + 1)) Yh[i] = Math.max(Yh[i], Yh[i + 1] - 0.08);
    }
    // every run starts and ends on the ground: a raised end is cut back to
    // its last point at grade (a run with none is not drawn)
    const draw = new Uint8Array(n);
    for (let i = 0; i < n; ) {
      if (!hw[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < n && hw[j]) j++;
      let a = i,
        b = j - 1;
      while (a <= b && Yh[a] - Gmax[a] > 0.1) a++;
      while (b >= a && Yh[b] - Gmax[b] > 0.1) b--;
      for (let m = a; m <= b; m++) draw[m] = 1;
      i = j;
    }
    // (a branch's first stretch lies over its trunk's road at the junction:
    // a hair higher there, so the two decks never flicker into each other)
    if (seg.junction)
      for (let i = 0; i < Math.min(n, 10); i++) Yh[i] += 0.006 * (1 - i / 10);
    // the tunnels' mouths (marking the points behind them, not drawn)
    const hide = tun ? new Uint8Array(n) : null;
    if (tun) {
      // (the deck's own points, its centre line, for the portals)
      const S = C.map(([x, z], i) => [x, z, Nz[i], -Nx[i]]);
      // (only the drawn runs: a point off them never opens a mouth)
      const t2 = new Uint8Array(n);
      for (let i = 0; i < n; i++) t2[i] = tun[i] && hw[i] ? 1 : 0;
      this._portals(E, S, Array.from(Yh), Array.from(Gmax), t2, SO + 0.04, HW_COVER, hide, 'hw');
    }
    // the cross-section at point i, o across (+ left), at height y
    const X = (i, o, y) => [C[i][0] + Nx[i] * o * Mi[i], y, C[i][1] + Nz[i] * o * Mi[i]];
    const wet = (i) => hw[i] === 2 || G[i] < SEA_LEVEL;
    // where the skirt ends below the deck's edge: in the ground, or a deep
    // fascia over the water
    const foot = (i, side) => {
      const ge = side > 0 ? GL[i] : GR[i];
      if (wet(i) || ge < SEA_LEVEL) return Yh[i] - 0.14;
      return Math.min(ge - 0.08, Yh[i] - 0.06);
    };
    const HA = HW_W / 2; // the carriageway's half width
    const EL = HW_W * 0.44; // the edge lines
    const LW = 0.008;
    let lastPier = -9;
    // (round 33) a side wall stands at most EMB_MAX over the ground (round
    // 32: highways climbed hills on solid walls many storeys tall); higher,
    // the deck is a bridge: a fascia girder under its edge, slim piers
    const FASCIA = 0.12;
    const tall = (i, side) => Yh[i] - (side > 0 ? GL[i] : GR[i]) > EMB_MAX;
    for (let i = 0; i + 1 < n; i++) {
      if (!draw[i] || !draw[i + 1]) continue;
      if (hide && hide[i] && hide[i + 1]) continue;
      const [ax, az] = C[i],
        [bx, bz] = C[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 1e-4 || L > 3) continue;
      const ya = Yh[i],
        yb = Yh[i + 1];
      far.push(ax, ya + 0.02, az, bx, yb + 0.02, bz);
      const j = i + 1;
      const raised = ya - Gmax[i] > 0.12 || yb - Gmax[j] > 0.12;
      const shoulder = raised ? COL.pier : COL.shoulder;
      // the deck: shoulder, carriageway, shoulder (one level surface across)
      E.quad(X(i, SO, ya), X(j, SO, yb), X(j, HA, yb), X(i, HA, ya), shoulder);
      E.quad(X(i, HA, ya), X(j, HA, yb), X(j, -HA, yb), X(i, -HA, ya), COL.asphalt);
      E.quad(X(i, -HA, ya), X(j, -HA, yb), X(j, -SO, yb), X(i, -SO, ya), shoulder);
      // concrete side walls from both edges down into the ground, or a
      // fascia where the deck stands higher than that over the ground
      for (const s of [1, -1]) {
        const bridge = !wet(i) && !wet(j) && (tall(i, s) || tall(j, s));
        const fa = bridge ? ya - FASCIA : foot(i, s),
          fb = bridge ? yb - FASCIA : foot(j, s);
        E.quad(X(i, s * SO, fa), X(j, s * SO, fb), X(j, s * SO, yb), X(i, s * SO, ya), COL.pier);
        // (its underside, so the deck does not read as a paper sheet)
        if (bridge && s > 0) E.quad(X(i, SO, ya - FASCIA), X(j, SO, yb - FASCIA), X(j, -SO, yb - FASCIA), X(i, -SO, ya - FASCIA), COL.viaduct2);
        // a parapet along a bridge or a raised ramp
        if (raised) E.quad(X(i, s * SO, ya), X(j, s * SO, yb), X(j, s * SO, yb + 0.05), X(i, s * SO, ya + 0.05), COL.viaduct);
      }
      // slim piers under a bridge's deck, a crosshead under each
      if (!wet(i) && (tall(i, 1) || tall(i, -1)) && i - lastPier >= 5) {
        lastPier = i;
        E.post(ax, az, Math.min(G[i], GL[i], GR[i]) - 0.2, ya - FASCIA, PIER_W * 0.8, COL.pier);
        const [hx1, , hz1] = X(i, SO * 0.8, 0),
          [hx2, , hz2] = X(i, -SO * 0.8, 0);
        E.bar(hx1, hz1, hx2, hz2, ya - FASCIA, ya - FASCIA, PIER_W * 0.8, 0.06, COL.pier);
      }
      // the yellow edge lines and the dashed centre line
      for (const s of [1, -1]) E.quad(X(i, s * EL + LW, ya + 0.003), X(j, s * EL + LW, yb + 0.003), X(j, s * EL - LW, yb + 0.003), X(i, s * EL - LW, ya + 0.003), COL.edge);
      if (i % 2 === 0) {
        const t = 0.55;
        const cx = ax + (bx - ax) * t,
          cz = az + (bz - az) * t,
          cy = ya + (yb - ya) * t + 0.003;
        const qx = -(bz - az) / L,
          qz = (bx - ax) / L;
        E.quad([ax + Nx[i] * LW, ya + 0.003, az + Nz[i] * LW], [cx + qx * LW, cy, cz + qz * LW], [cx - qx * LW, cy, cz - qz * LW], [ax - Nx[i] * LW, ya + 0.003, az - Nz[i] * LW], COL.mark);
      }
      // piers under a bridge over water
      if (wet(i) && ya - G[i] > 0.3 && i - lastPier >= 5) {
        lastPier = i;
        E.post(ax, az, G[i] - 0.2, ya - 0.14, PIER_W, COL.pier);
      }
    }
  }
  _subGeo() {
    if (this._sub) return this._sub;
    const g = new GeoBuilder(7);
    substationModel(g, COL.pylon);
    this._sub = g.build();
    return this._sub;
  }
  _pylonGeo() {
    if (this._pylon) return this._pylon;
    const g = new GeoBuilder(91, { jitter: 0.04 });
    pylonModel(g, COL.pylon);
    this._pylon = g.build();
    return this._pylon;
  }

  // One stretch of the network: its track, termini and highway, emitted on
  // their own (kept until the stretch changes)
  _segPart(seg) {
    const E = new Emit();
    const portals = (this._partPortals = []);
    const far = [],
      farC = [];
    const farCol = (from, hex) => {
      const c = new THREE.Color(hex);
      for (let i = from; i < far.length / 3; i++) farC.push(c.r, c.g, c.b);
    };
    let len = 0;
    for (let i = 2; i < seg.pts.length; i += 2) len += Math.min(3, Math.hypot(seg.pts[i] - seg.pts[i - 2], seg.pts[i + 1] - seg.pts[i - 1]));
    seg.len = len;
    this._track(E, seg, far);
    farCol(0, seg.kind === 'maglev' ? 0x3a4148 : 0x2e2a26);
    if (seg.start) this._terminus(E, seg, true);
    if (seg.end) this._terminus(E, seg, false);
    if (seg.hw) {
      const n1 = far.length / 3;
      this._highway(E, seg, far);
      farCol(n1, 0x34373c);
    }
    this._partPortals = null;
    return { ...E.pack(), far: Float32Array.from(far), farC: Float32Array.from(farC), wire: new Float32Array(0), portals };
  }

  // Rebuild the drawn geometry. Round 37: each stretch's and power line's
  // part is kept by its content (a key over its points, levels and flags),
  // so a network laid again (every rebuild of a realm's network makes new
  // stretch objects) reuses every stretch that did not change; the parts
  // missing are emitted nearest the camera first, all of those in its view
  // and then at most EMIT_MS more a drawn frame (the rest on the frames
  // after); and the solid geometry is
  // held in square chunks of CHUNK tiles, each joined and uploaded again
  // only when its own parts change (round 36: a change anywhere re-emitted
  // and re-uploaded the whole network, 0.8-1.4 s in the first frame after
  // a jump at Year 800). A chunk still waiting for a part keeps what it
  // drew until the part is ready.
  _rebuild(force = false) {
    const civ = this.game.civ;
    const t0 = performance.now();
    const cam = this.game.cameraRig?.cur;
    const cx = cam?.x ?? 0,
      cz = cam?.z ?? 0;
    const W = this.game.world.w;
    const want = new Map(); // chunk -> [part]
    const wait = new Set(); // chunks with a part not yet emitted
    const missing = [];
    const used = new Set();
    const chunkOf = (x, z) => Math.floor(x / CHUNK) * 4096 + Math.floor(z / CHUNK);
    const add = (ck, p) => {
      let L = want.get(ck);
      if (!L) want.set(ck, (L = []));
      L.push(p);
    };
    // (the camera's own view is drawn at once whatever the budget: within
    // this far of the point it looks at, tiles)
    const near = (cam?.dist ?? 60) * 1.25 + 16;
    const take = (key, map, obj, x, z, make, pts) => {
      if (used.has(key)) return;
      used.add(key);
      const ck = chunkOf(x, z);
      const p = map.get(key);
      if (p && !obj._redraw) return add(ck, p);
      // (the nearest of every eighth point to the camera)
      let d = Infinity;
      for (let i = 0; i + 1 < pts.length; i += 16) {
        let dx = Math.abs(pts[i] - cx);
        if (dx > W / 2) dx = W - dx; // (a round world)
        d = Math.min(d, dx * dx + (pts[i + 1] - cz) ** 2);
      }
      missing.push({ key, map, obj, ck, make, d, now: d < near * near });
    };
    for (const seg of civ.railSegs?.() || []) {
      if (!seg.pts || seg.pts.length < 4) continue;
      const P = seg.pts,
        m = (P.length >> 2) << 1;
      take(seg._gk || (seg._gk = 's' + segKey(seg)), this._segGeo, seg, P[m], P[m + 1], () => this._segPart(seg), P);
    }
    // power lines: pylons and sagging wires
    // (round 29: a pair of wires crossed a town at 55 tiles: a span over a
    // town's built ground runs underground, so no wire is drawn there; the
    // towns are read once per rebuild)
    this._towns = null;
    for (const l of civ.powerLines?.() || []) take(l._gk || (l._gk = 'p' + powKey(l)), this._powGeo, l, l.pts[0], l.pts[1], () => this._powerPart(l), l.pts);
    missing.sort((a, b) => a.d - b.d);
    let emitted = 0;
    this._pend = false;
    for (const m of missing) {
      if (!force && !m.now && emitted > 0 && performance.now() - t0 > EMIT_MS) {
        this._pend = true;
        wait.add(m.ck);
        continue;
      }
      const p = m.make();
      p.id = ++this._pid;
      m.map.set(m.key, p);
      m.obj._redraw = false;
      emitted++;
      add(m.ck, p);
    }
    this._stat = { parts: used.size, emitted, waiting: missing.length - emitted, chunks: 0, ms: 0 };
    // (parts no longer wanted are dropped, unless a waiting chunk still draws them)
    const keep = new Set();
    for (const ck of wait) for (const p of this._chunks.get(ck)?.parts || []) keep.add(p);
    for (const map of [this._segGeo, this._powGeo]) for (const [k, p] of map) if (!used.has(k) && !keep.has(p)) map.delete(k);
    // the chunks whose parts changed are joined again
    let changed = 0;
    for (const [ck, L] of want) {
      if (wait.has(ck)) continue;
      const c = this._chunks.get(ck);
      const sig = L.map((p) => p.id).join(',');
      if (c && c.sig === sig) continue;
      this._setChunk(ck, L, sig);
      changed++;
    }
    for (const ck of [...this._chunks.keys()])
      if (!want.has(ck) && !wait.has(ck)) {
        this._setChunk(ck, null);
        changed++;
      }
    if (changed) this._swapLines();
    this._stat.chunks = changed;
    this._stat.ms = +(performance.now() - t0).toFixed(1);
  }
  // one chunk's solid geometry from its parts (null: the chunk is gone)
  _setChunk(ck, parts, sig = '') {
    let c = this._chunks.get(ck);
    if (!parts) {
      if (c?.mesh) {
        this.group.remove(c.mesh);
        c.mesh.geometry.dispose();
      }
      this._chunks.delete(ck);
      return;
    }
    if (!c) this._chunks.set(ck, (c = { mesh: null, parts: [], sig: '' }));
    c.parts = parts;
    c.sig = sig;
    const P = joinArrays(parts, 'P');
    if (!P.length) {
      if (c.mesh) c.mesh.visible = c.mesh.userData.has = false;
      return;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(joinArrays(parts, 'N'), 3));
    g.setAttribute('color', new THREE.BufferAttribute(joinArrays(parts, 'C'), 3));
    g.setAttribute('aGlow', new THREE.BufferAttribute(joinArrays(parts, 'G'), 1));
    g.computeBoundingSphere();
    if (!c.mesh) {
      c.mesh = new THREE.Mesh(g, this.mat);
      c.mesh.receiveShadow = true;
      c.mesh.castShadow = false;
      c.mesh.name = 'infra-chunk';
      this.group.add(c.mesh);
    } else {
      c.mesh.geometry.dispose();
      c.mesh.geometry = g;
    }
    c.mesh.userData.has = true;
    c.mesh.visible = !this._isFar;
  }

  // One power line: its pylons (the town end on its substation) and wires
  _powerPart(l) {
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
    const pg = this._pylonGeo();
    const m = new THREE.Matrix4(),
      sm = new THREE.Matrix4().makeScale(BS, BS, BS);
    const arm = new THREE.Vector3();
    const towns = (this._towns ||= (civ.villages || []).filter((v) => v?.alive && Number.isFinite(v.cx)).map((v) => [v.cx, v.cz, Math.max(v.radius || 6, (v.buildRadius || 0) + 1)]));
    const overTown = (a, b) => {
      for (const [cx, cz, r] of towns) {
        if (Math.abs(cx - (a[0] + b[0]) / 2) > r + Math.abs(a[0] - b[0]) / 2 + 1 || Math.abs(cz - (a[2] + b[2]) / 2) > r + Math.abs(a[2] - b[2]) / 2 + 1) continue;
        for (const t of [0.2, 0.35, 0.5, 0.65, 0.8]) if (Math.hypot(a[0] + (b[0] - a[0]) * t - cx, a[2] + (b[2] - a[2]) * t - cz) < r * 0.9) return true;
      }
      return false;
    };
    {
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
        // the plant end hangs its wires on the plant; the town end on its
        // substation at the edge of town (the town's own when it has one);
        // every other point gets a pylon
        const last = i + 2 >= P.length;
        if (last) {
          if (!l.sub) E.geo(this._subGeo(), m);
          tips.push(PYLON_ARMS.map(([ax]) => arm.set(Math.sign(ax) * 0.3, SUB_ARM_Y, -0.22).applyMatrix4(m).toArray()));
          continue;
        }
        if (i > 0) E.geo(pg, m);
        tips.push(PYLON_ARMS.map(([ax, ay]) => arm.set(ax, i > 0 ? ay : 1.4, 0).applyMatrix4(m).toArray()));
      }
      for (let i = 0; i + 1 < tips.length; i++) {
        const A = tips[i],
          B = tips[i + 1];
        if (Math.abs(A[0][0] - B[0][0]) > W / 2) continue;
        if (overTown(A[0], B[0])) continue;
        const n0 = far.length / 3;
        far.push(A[0][0], A[0][1], A[0][2], B[0][0], B[0][1], B[0][2]);
        farCol(n0, 0x3c3c3a);
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
    return { ...E.pack(), far: Float32Array.from(far), farC: Float32Array.from(farC), wire: Float32Array.from(wire) };
  }

  // the wires and the far-zoom lines of every part drawn (thin lines, one
  // set each over the whole map), and the list of tunnel mouths drawn
  _swapLines() {
    const parts = [];
    for (const c of this._chunks.values()) for (const p of c.parts) parts.push(p);
    // (every tunnel mouth drawn: the inspector and the probes read these)
    this.portals = [];
    for (const p of parts) if (p.portals) for (const q of p.portals) this.portals.push(q);
    const set = (key, geo, make) => {
      let o = this[key];
      if (!geo) {
        if (o) o.visible = o.userData.has = false;
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
    const lines = (pts, cols) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      if (cols) g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      g.computeBoundingSphere();
      return g;
    };
    const wire = joinArrays(parts, 'wire'),
      far = joinArrays(parts, 'far');
    set('wires', wire.length ? lines(wire) : null, (g) => new THREE.LineSegments(g, this.wireMat));
    set('far', far.length ? lines(far, joinArrays(parts, 'farC')) : null, (g) => new THREE.LineSegments(g, this.farMat));
    this._lod(true);
  }

  _lod(force = false) {
    const D = this.game.cameraRig?.cur?.dist ?? 60;
    const isFar = D > FAR || !!this.game.view?.far;
    const wires = D < WIRE_D;
    if (!force && isFar === this._isFar && wires === this._wiresOn) return;
    this._isFar = isFar;
    this._wiresOn = wires;
    for (const c of this._chunks.values()) if (c.mesh) c.mesh.visible = !isFar && c.mesh.userData.has;
    if (this.wires) this.wires.visible = !isFar && wires && this.wires.userData.has;
    if (this.far) this.far.visible = isFar && this.far.userData.has;
  }

  update() {
    const civ = this.game.civ;
    if (!civ) return;
    const ver = civ.infraVersion || 0;
    const now = performance.now();
    const edits = this._edits;
    // the ground moved under some tracks: their levels are worked out again
    // and they alone are drawn again (batched: at most every EDIT_GAP, or
    // with the next change to the network)
    let dirty = false;
    if (edits.length && (ver !== this._ver || now - this._editT > EDIT_GAP)) {
      this._editT = now;
      const segs = [];
      for (const s of civ.railSegs?.() || []) if (s.pts && s.pts.length >= 4 && this._touched(this._bounds(s, s.pts, null, 2.5), edits)) segs.push(s);
      if (segs.length) {
        const set = civ.railRelevel?.(segs) || segs;
        for (const s of set) (s._redraw = true), (s._gk = null);
        dirty = true;
      }
      for (const l of civ.powerLines?.() || [])
        if (this._touched(this._bounds(l, l.pts, l.pylons, 1.5), edits)) {
          l._redraw = true;
          dirty = true;
        }
      edits.length = 0;
    }
    // (round 37: or parts still waiting to be emitted)
    if (ver !== this._ver || dirty || this._pend) {
      this._ver = ver;
      this._rebuild();
    }
    this._lod();
  }
}
