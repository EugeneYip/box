import * as THREE from 'three';
import { geoWrapOn } from '../world/geo.js';
import { SEA_LEVEL } from '../world/constants.js';
import { BUILDING_TYPES } from '../sim/civ/catalog.js';
import { BUILDING } from './scale.js';

// The close-zoom cutaway (round 25, reworked round 27): at distance 10 or
// closer (fading out by 14) a building whose box stands on the line from the
// eye to the target fades, whole, to a sparse screen-door ghost, so a roof
// never hides the followed person and no floating slab is left. The camera
// works out on the CPU which buildings cross that line (never the one that
// holds the target) and hands their footprints to the building material
// (src/render/buildings/material.js), which reads these uniforms:
//   uCut     overall strength 0..1 (1 under distance 10, none past 14)
//   uCutBox  up to CUT_N footprints (minX, minZ, maxX, maxZ) in world units
//   uCutA    each footprint's own strength 0..1 (eased, so it fades in and out)
//   uCutY    each footprint's cut height in world units (round 29): the
//            building is drawn up to just under the lowest sight line through
//            it, with a dark rim along the cut, and nothing above (the old
//            screen-door ghost turned to a muddy see-through block under the
//            depth of field); the cut slides down from the roof as it fades in
//   uCamW    the camera's world matrix (view space -> world space)
export const CUT_N = 6;
export const CAM_CUT = {
  uCut: { value: 0 },
  uCutD: { value: 10 },
  uCutTan: { value: 0.34 },
  uCutBox: { value: Array.from({ length: CUT_N }, () => new THREE.Vector4(0, 0, -1, -1)) },
  uCutA: { value: new Array(CUT_N).fill(0) },
  uCutY: { value: new Array(CUT_N).fill(1e4) },
  uCamW: { value: new THREE.Matrix4() },
  // (round 31) the point the camera looks at, in world units: trees between
  // the eye and it fade out (src/render/nature/floraMaterial.js), as
  // buildings are cut
  uCutT: { value: new THREE.Vector3() },
};
// cut range: full at CUT_NEAR, gone by CUT_FAR (round 35: from 10 and 14; a
// big building on the sight line at 12 tiles was only half cut)
const CUT_NEAR = 12,
  CUT_FAR = 17;
// (round 35) the tall modern buildings, for the cut's height estimate
const TALL = new Set(['skyscraper', 'arcology', 'vertfarm', 'climatetower', 'controlspire', 'radiomast', 'skyshield']);

// (round 35) The close camera's lift over rough ground keeps a slanting
// view: it adds at most LIFT_MAX to the zoom's own pitch and never takes the
// pitch past PITCH_MAX (round 33's lifts ran to 78-80 deg, near straight
// down, on any rugged ground). Where that is not enough the view turns away
// from the high side (CameraRig._swing) rather than looking down.
const DEG = Math.PI / 180;
const LIFT_MAX = 20 * DEG,
  PITCH_MAX = 62 * DEG;
// Ground beyond the target counts as a wall only where it stands WALL_RISE
// above the target and rises at least WALL_SLOPE per unit there (round 33
// counted anything 0.2 above, so a gentle rise behind a town was a cliff).
const WALL_RISE = 1.2,
  WALL_SLOPE = 0.35;
// yaw turns tried past the cap, nearest first
const SWING = [35, -35, 70, -70, 105, -105, 140, -140, 180].map((d) => d * DEG);

// Smooth god-view camera: orbits a ground target. Zooming out tilts the view
// toward top-down; zooming in lowers it for a diorama perspective.
//   target (x,z) on the ground, distance, yaw (radians), pitch (radians).
export class CameraRig {
  constructor(game) {
    this.game = game;
    const world = game.world;
    this.camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.5, 2000);
    // round 24: people and vehicles are half size, so the camera may come a
    // little closer (a person stays readable at the closest zoom)
    this.minDist = 5;
    // (round 27) following a creature or car, or with one selected, the camera
    // may come closer still, so a half-size person stands about 60 px tall;
    // zooming out or letting go returns to minDist smoothly
    this.closeMin = 2.5;
    // the screen area the HUD leaves visible, in CSS px (the UI keeps it up
    // to date): a followed unit is framed at its middle, not behind the tray
    this.viewRect = null;
    this._vOff = { x: 0, y: 0 };
    this._cutA = new Map(); // building id -> eased cut strength
    this._cutY = new Map(); // building id -> the lowest sight line through it
    this._dt = 1 / 60;
    // a wide (2:1) map is framed by its width on a landscape screen; squares
    // are unchanged (the height wins). This is the reference distance: the
    // pitch tops out here, and the renderers' zoom level reads 1 from here on.
    this.maxDist = Math.max(world.w * 0.8, world.h) * 1.15;
    // the zoom-out limit: never less than maxDist, and far enough that the
    // whole map fits on this screen whatever its aspect (a portrait regional
    // map on a wide screen, a 2:1 map on a phone held upright)
    this.limitDist = this.maxDist;
    this._land = null;
    this._landT = 0;
    game.events?.on?.('world:regenerated', () => (this._land = null));
    this.target = new THREE.Vector3(world.w / 2, 0, world.h / 2);
    this.goal = { x: world.w / 2, z: world.h / 2, dist: this.maxDist * 0.55, yaw: 0, pitchBias: 0 };
    this.cur = { ...this.goal };
    this.autoPitch = true;
    this.manualPitch = null; // radians when not auto
    this.shake = 0;
    this._shakeT = 0;
    this.keys = new Set();
    this.follow = null; // optional object with .x/.z to follow (e.g. a unit)
    this.fitLimit();
  }

  // Is the closer follow zoom allowed now? (a followed or selected creature or car)
  closeOK() {
    const f = this.follow;
    if (f && f.alive !== false && f.x != null) return true;
    const s = this.game.selected;
    return !!(s && (s.kind === 'unit' || s.kind === 'vessel') && s.ref && s.ref.alive !== false);
  }
  // The nearest the camera may come.
  zoomMin() {
    return this.closeOK() ? this.closeMin : this.minDist;
  }
  // The farthest the camera may pull back.
  zoomMax() {
    return Math.max(this.maxDist, this.limitDist);
  }

  // The distance at which the whole map fits on screen at the top pitch, north up,
  // with a small margin.
  fitLimit() {
    const W = this.game.world;
    const cam = new THREE.PerspectiveCamera(this.camera.fov, this.camera.aspect || innerWidth / innerHeight, 1, 1e6);
    const pitch = THREE.MathUtils.degToRad(70);
    const v = new THREE.Vector3();
    const cx = W.w / 2,
      cz = W.h / 2;
    const corners = [
      [0, 0],
      [W.w, 0],
      [0, W.h],
      [W.w, W.h],
    ];
    const fits = (d, yaw) => {
      const horiz = Math.cos(pitch) * d;
      cam.position.set(cx + Math.sin(yaw) * horiz, Math.sin(pitch) * d, cz + Math.cos(yaw) * horiz);
      cam.lookAt(cx, 0, cz);
      cam.updateMatrixWorld();
      for (const [x, z] of corners) {
        v.set(x, 0, z).project(cam);
        if (v.z > 1 || Math.abs(v.x) > 0.97 || Math.abs(v.y) > 0.97) return false;
      }
      return true;
    };
    let lo = this.minDist,
      hi = Math.max(W.w, W.h) * 20;
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2;
      if (fits(m, 0)) hi = m;
      else lo = m;
    }
    const need = Math.max(this.maxDist, hi);
    this.limitDist = need;
    if (this.goal) this.goal.dist = Math.min(this.goal.dist, this.zoomMax());
    return need;
  }

  // The land (above sea level) sampled on a coarse grid, cached; it is measured
  // again after a new world and every few seconds (terraforming moves it).
  landPoints() {
    if (this._land) return this._land;
    const W = this.game.world;
    const nx = 96,
      nz = Math.max(8, Math.round((nx * W.h) / W.w));
    const sx = W.w / nx,
      sz = W.h / nz;
    const pts = [];
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const x = (i + 0.5) * sx,
          z = (j + 0.5) * sz;
        let h = 0;
        try {
          h = W.heightAt(x, z);
        } catch (e) {
          h = 0;
        }
        if (h > SEA_LEVEL + 0.05) pts.push(x, z);
      }
    this._land = Float32Array.from(pts);
    return this._land;
  }

  pitchFor(dist) {
    if (this.manualPitch != null) return this.manualPitch;
    const t = THREE.MathUtils.clamp((dist - this.minDist) / (this.maxDist - this.minDist), 0, 1);
    // 34deg when close, ~70deg when far
    return THREE.MathUtils.degToRad(34 + Math.pow(t, 0.6) * 36) + this.cur.pitchBias;
  }

  set(x, z, dist, yawDeg = 0, pitchDeg = null, instant = true) {
    this.goal.x = x;
    this.goal.z = z;
    this.goal.dist = THREE.MathUtils.clamp(dist, this.zoomMin(), this.zoomMax());
    this.goal.yaw = THREE.MathUtils.degToRad(yawDeg);
    this.manualPitch = pitchDeg == null || isNaN(pitchDeg) ? null : THREE.MathUtils.degToRad(pitchDeg);
    // (a new view: the yaw asked for is not a turn by the player, so the
    // view may still turn off a cliff there)
    this._yawSeen = this.goal.yaw;
    this._yawHold = null;
    this._swingT = 0;
    if (instant) {
      Object.assign(this.cur, this.goal);
      this._groundY = null; // no easing from the old spot's ground
      this._lift = null; // nor from its line-of-sight pitch
      this._dolly = null; // nor from its slide in off a hillside
      this._cutA.clear();
      this._cutY.clear();
      this._dt = 1; // (settle everything eased at once)
    }
    this.apply();
    this._dt = 1 / 60;
  }

  // Pan by screen-space delta in pixels.
  panPixels(dx, dy) {
    const k = (this.cur.dist * 1.2) / innerHeight;
    const s = Math.sin(this.goal.yaw),
      c = Math.cos(this.goal.yaw);
    const px = this.goal.x,
      pz = this.goal.z;
    this.goal.x -= (dx * c + dy * s) * k;
    this.goal.z -= (-dx * s + dy * c) * k;
    this.follow = null;
    this.clampGoal(px, pz);
  }
  // Pan by world-space delta (used when dragging the ground precisely).
  panWorld(dx, dz) {
    const px = this.goal.x,
      pz = this.goal.z;
    this.goal.x += dx;
    this.goal.z += dz;
    this.follow = null;
    this.clampGoal(px, pz);
  }
  rotate(dyaw) {
    this.goal.yaw += dyaw;
  }
  // Zoom with wheel, keeping the point under the cursor fixed when given.
  zoom(factor, anchor = null) {
    const before = this.goal.dist;
    this.goal.dist = THREE.MathUtils.clamp(this.goal.dist * factor, this.zoomMin(), this.zoomMax());
    if (anchor) {
      const px = this.goal.x,
        pz = this.goal.z;
      const k = 1 - this.goal.dist / before;
      this.goal.x += (anchor.x - this.goal.x) * k;
      this.goal.z += (anchor.z - this.goal.z) * k;
      this.clampGoal(px, pz);
    }
  }
  // Keep land in view: a pan or zoom may not carry the view off into empty sea
  // or past the map's corner. "In view" means some land lies within the middle
  // 80% of the screen (measured on the ground at the target, both ways). A move
  // that loses the land slides along the coast on one axis if it can, else it
  // stops; a view that has already lost the land (zoomed in over open sea, a
  // followed ship) may still move, but only back toward land. Without a
  // previous position (a minimap jump) the goal is pulled to the nearest land.
  clampGoal(prevX = null, prevZ = null) {
    const w = this.game.world;
    const g = this.goal;
    // the view's half-size on the ground at the target, along the map's axes
    const fov = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const d = g.dist;
    const hx = d * Math.tan(fov) * (this.camera.aspect || 1);
    const hz = (d * Math.tan(fov)) / Math.max(0.3, Math.sin(this.pitchFor(d)));
    const sy = Math.abs(Math.sin(g.yaw)),
      cy = Math.abs(Math.cos(g.yaw));
    const ex = Math.max(1, cy * hx + sy * hz),
      ez = Math.max(1, sy * hx + cy * hz);
    const A = 0.8;
    // past the map's edge there is only empty sea: at most a tenth of the screen shows
    // beyond it (a view wider than the map stays centred on it)
    const edge = (v, prev, e, size) => {
      const m = Math.min(size / 2, A * e);
      let lo = m,
        hi = size - m;
      if (prev != null && Number.isFinite(prev)) {
        lo = Math.min(lo, prev);
        hi = Math.max(hi, prev);
      }
      return THREE.MathUtils.clamp(v, Math.max(0, lo), Math.min(size, hi));
    };
    // Round world (docs/ROUND-WORLD.md): past a side of the whole-Earth map the
    // camera pans on round to the other side (update() brings it back on)
    const wrap = geoWrapOn(w);
    if (wrap) g.x = THREE.MathUtils.clamp(g.x, -w.w * 0.25, w.w * 1.25);
    else g.x = edge(g.x, prevX, ex, w.w);
    g.z = edge(g.z, prevZ, ez, w.h);
    const pts = this.landPoints();
    if (!pts.length) return;
    // distance to the nearest land in half-screens (<= A: land is in view)
    const far = (x, z) => {
      let best = Infinity,
        bi = -1;
      for (let i = 0; i < pts.length; i += 2) {
        let dx = Math.abs(pts[i] - x);
        if (wrap) dx = Math.min(dx % w.w, w.w - (dx % w.w));
        const q = Math.max(dx / ex, Math.abs(pts[i + 1] - z) / ez);
        if (q < best) {
          best = q;
          bi = i;
        }
      }
      return { q: best, i: bi };
    };
    const now = far(g.x, g.z);
    if (now.q <= A) return;
    if (prevX == null || prevZ == null) {
      const lx = pts[now.i],
        lz = pts[now.i + 1];
      g.x = THREE.MathUtils.clamp(g.x, lx - A * ex, lx + A * ex);
      g.z = THREE.MathUtils.clamp(g.z, lz - A * ez, lz + A * ez);
      return;
    }
    const was = far(prevX, prevZ).q;
    if (now.q <= was) return;
    const ok = (x, z) => {
      const q = far(x, z).q;
      return q <= A || q <= was;
    };
    if (ok(g.x, prevZ)) g.z = prevZ;
    else if (ok(prevX, g.z)) g.x = prevX;
    else {
      g.x = prevX;
      g.z = prevZ;
    }
  }
  addShake(amount) {
    this.shake = Math.min(2.5, this.shake + amount);
  }

  update(dt) {
    // keyboard pan / rotate
    const speed = this.cur.dist * 0.9 * dt;
    let px = 0,
      pz = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) pz -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) pz += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) px -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) px += 1;
    if (px || pz) {
      const s = Math.sin(this.goal.yaw),
        c = Math.cos(this.goal.yaw);
      const ox = this.goal.x,
        oz = this.goal.z;
      this.goal.x += (px * c + pz * s) * speed;
      this.goal.z += (-px * s + pz * c) * speed;
      this.follow = null;
      this.clampGoal(ox, oz);
    }
    // the land outline drifts as the player raises and sinks it
    this._landT -= dt;
    if (this._landT <= 0) {
      this._landT = 8;
      this._land = null;
    }
    if (this.keys.has('KeyQ')) this.goal.yaw -= dt * 1.4;
    if (this.keys.has('KeyE')) this.goal.yaw += dt * 1.4;
    if (this.keys.has('Equal') || this.keys.has('NumpadAdd')) this.zoom(Math.pow(0.35, dt));
    if (this.keys.has('Minus') || this.keys.has('NumpadSubtract')) this.zoom(Math.pow(1 / 0.35, dt));

    // (round 33) a followed creature or craft that has left the world (a
    // vehicle at the end of its trip, a street car gone from the streets, a
    // death) is let go here and now, whether or not its card is open: the
    // view stays where it was last seen and eases back out to minDist, as
    // Escape does (a dead follow target lingered on the rig until the
    // inspector's next refresh, or for good when followed from Favorites)
    if (this.follow && this.follow.alive === false) {
      this.follow = null;
      this._fLast = null;
      if (this.goal.dist < this.minDist) this.goal.dist = this.minDist;
    }
    // the closer follow zoom ends when the unit is let go: back out to minDist
    if (this.goal.dist < this.minDist && !this.closeOK()) this.goal.dist = this.minDist;

    const wrapW = geoWrapOn(this.game.world) ? this.game.world.w : 0;
    if (this.follow && this.follow.alive !== false) {
      // (round 33) aim where the unit is drawn this frame (between its last
      // two ticks, as the renderers place it), and move the view with it by
      // the same step it took since the last frame: the eased chase alone
      // trailed a walking person by 8-19 px at the closest zoom (a constant
      // lag of its pace over the ease rate); the ease now only closes the
      // gap left when the follow starts
      const f = this.follow;
      const p = this._drawnAt(f);
      const L = this._fLast;
      if (L && L.ref === f) {
        let dx = p.x - L.x,
          dz = p.z - L.z;
        if (Math.abs(dx) + Math.abs(dz) < 2) {
          // (round 35) a craft moves the view by no more than it can drive
          // in the frame: a street car squaring up at the curb (or turning
          // into its lane) jumped up to 56 px at the closest zoom; the rest
          // of such a step is eased in below
          if (typeof f.speed === 'number' && (f.cls != null || f.def?.cls != null)) {
            const d = Math.hypot(dx, dz);
            const cap = Math.abs(f.speed) * dt * (this.game.paused ? 0 : this.game.speed || 1) * 1.5 + 0.004;
            if (d > cap) {
              dx *= cap / d;
              dz *= cap / d;
            }
          }
          this.cur.x += dx;
          this.cur.z += dz;
        }
      }
      this._fLast = { ref: f, x: p.x, z: p.z };
      this.goal.x = p.x;
      this.goal.z = p.z;
      // (a ship followed across the Round world's seam: the camera goes round with her)
      if (wrapW && Math.abs(this.goal.x - this.cur.x) > wrapW / 2) this.cur.x += this.goal.x > this.cur.x ? wrapW : -wrapW;
    } else this._fLast = null;

    const k = 1 - Math.exp(-dt * 9);
    const kz = 1 - Math.exp(-dt * 7);
    this.cur.x += (this.goal.x - this.cur.x) * k;
    this.cur.z += (this.goal.z - this.cur.z) * k;
    this.cur.dist += (this.goal.dist - this.cur.dist) * kz;
    this.cur.yaw += (this.goal.yaw - this.cur.yaw) * k;
    if (wrapW && (this.cur.x < 0 || this.cur.x >= wrapW)) {
      const s = this.cur.x < 0 ? wrapW : -wrapW;
      this.cur.x += s;
      this.goal.x += s;
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this._shakeT += dt;
    this._dt = dt;
    this.apply();
  }

  // Does the line of sight from the eye at pitch p clear the terrain between
  // it and the target? It is sampled at a dozen points (round 25: on high
  // ground the closest zoom sat inside the hillside). v: {x, z, yaw, dist}.
  _sightClear(p, v, ty) {
    const W = this.game.world;
    const s = Math.sin(v.yaw),
      co = Math.cos(v.yaw);
    const horiz = Math.cos(p) * v.dist,
      up = Math.sin(p) * v.dist;
    for (let i = 1; i <= 12; i++) {
      const t = i / 12;
      const x = v.x + s * horiz * t,
        z = v.z + co * horiz * t;
      if (x < 0 || z < 0 || x > W.w - 1 || z > W.h - 1) continue;
      // (a margin that grows from nothing at the target toward the eye, so
      // flat ground never lifts the view: grass and low walls)
      if (Math.max(0, W.heightAt(x, z)) + (0.3 + 0.05 * v.dist) * t > ty + up * t) return false;
    }
    return true;
  }
  // The eye at pitch p looking at the target: its position and its forward,
  // right and up axes, for the frame tests below.
  _basis(p, v, ty) {
    const s = Math.sin(v.yaw),
      co = Math.cos(v.yaw);
    const sp = Math.sin(p),
      cp = Math.cos(p);
    const b = this._bas || (this._bas = {});
    b.ex = v.x + s * cp * v.dist;
    b.ey = ty + sp * v.dist;
    b.ez = v.z + co * cp * v.dist;
    b.fx = -s * cp;
    b.fy = -sp;
    b.fz = -co * cp;
    b.rx = co;
    b.rz = -s;
    b.ux = -s * sp;
    b.uy = cp;
    b.uz = -co * sp;
    b.tanH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    b.asp = this.camera.aspect || 1;
    return b;
  }
  // (round 31) The share of the lower frame that terrain near the eye covers
  // at pitch p. Rays through a 5 x 3 grid of points in the lower 60% of the
  // picture are marched toward the plane at the target's height; a ray that
  // meets the ground before 70% of its way there is covered by a foreground
  // slope (a blurred hillside filled the right half of the frame at 5 tiles).
  _coverFrac(p, v, ty) {
    const W = this.game.world;
    const B = this._basis(p, v, ty);
    const wMax = W.w - 1,
      hMax = W.h - 1;
    let n = 0,
      hit = 0;
    for (let j = 0; j < 3; j++) {
      const b = -0.15 - j * 0.3; // lower frame, NDC
      for (let i = 0; i < 5; i++) {
        const a = -0.8 + i * 0.4;
        const dx = B.fx + B.rx * a * B.tanH * B.asp + B.ux * b * B.tanH,
          dy = B.fy + B.uy * b * B.tanH,
          dz = B.fz + B.rz * a * B.tanH * B.asp + B.uz * b * B.tanH;
        if (dy > -0.02) continue;
        const L = (B.ey - ty) / -dy; // along the ray to the target's plane
        n++;
        for (let k = 1; k <= 8; k++) {
          const t = (k / 8) * 0.7;
          const x = B.ex + dx * L * t,
            z = B.ez + dz * L * t;
          if (x < 0 || z < 0 || x > wMax || z > hMax) continue;
          if (Math.max(0, W.heightAt(x, z)) + 0.05 > B.ey + dy * L * t) {
            hit++;
            break;
          }
        }
      }
    }
    return n ? hit / n : 0;
  }
  // (round 33) The share of the upper frame that a wall beyond the target
  // fills at pitch p. Rays through a 5 x 4 grid of points in the upper half
  // are marched out to 1.5 times the eye's distance to the target; a ray is
  // on a wall where it meets ground that stands well above the target and is
  // steep there (round 35: WALL_RISE, WALL_SLOPE; a gentle rise is only
  // landscape beyond the target and never pitched the view up).
  _wallFrac(p, v, ty) {
    const W = this.game.world;
    const B = this._basis(p, v, ty);
    const wMax = W.w - 1,
      hMax = W.h - 1;
    const D = v.dist;
    let n = 0,
      hit = 0;
    for (let j = 0; j < 4; j++) {
      const b = 0.15 + j * 0.25; // upper frame, NDC
      for (let i = 0; i < 5; i++) {
        const a = -0.8 + i * 0.4;
        let dx = B.fx + B.rx * a * B.tanH * B.asp + B.ux * b * B.tanH,
          dy = B.fy + B.uy * b * B.tanH,
          dz = B.fz + B.rz * a * B.tanH * B.asp + B.uz * b * B.tanH;
        const l = Math.hypot(dx, dy, dz);
        dx /= l;
        dy /= l;
        dz /= l;
        n++;
        for (let k = 1; k <= 16; k++) {
          const t = (k / 16) * 1.5 * D;
          const x = B.ex + dx * t,
            z = B.ez + dz * t;
          if (x < 0 || z < 0 || x > wMax || z > hMax) break;
          const g = Math.max(0, W.heightAt(x, z));
          if (g > B.ey + dy * t) {
            // (the ray may meet the foot of the face: its top is read a
            // unit or two on, along the ray)
            const hl = Math.hypot(dx, dz) || 1;
            const top = Math.max(g, W.heightAt(x + dx / hl, z + dz / hl), W.heightAt(x + (2 * dx) / hl, z + (2 * dz) / hl));
            if (top > ty + WALL_RISE) {
              const sx = W.heightAt(x + 0.5, z) - W.heightAt(x - 0.5, z),
                sz = W.heightAt(x, z + 0.5) - W.heightAt(x, z - 0.5);
              if (Math.hypot(sx, sz) > WALL_SLOPE) hit++;
            }
            break;
          }
        }
      }
    }
    return n ? hit / n : 0;
  }
  // The least extra pitch (radians, 0 up to the cap) at which the eye sees
  // the target over the terrain and, close in (`near`), terrain covers no
  // more than about 30% of the lower frame and a wall no more than about 30%
  // of the upper frame. ok is false when even the cap leaves one of these
  // unmet; bad then says by how much (1 for a hidden target, plus the
  // shares over the limits).
  _liftAt(pitch, v, ty, near) {
    const cap = Math.max(0, Math.min(LIFT_MAX, PITCH_MAX - pitch));
    const test = (p, full) => {
      let b = this._sightClear(p, v, ty) ? 0 : 1;
      if (!near || (b && !full)) return b;
      b += Math.max(0, this._coverFrac(p, v, ty) - 0.3);
      if (b && !full) return b;
      return b + Math.max(0, this._wallFrac(p, v, ty) - 0.3);
    };
    const out = this._liftOut || (this._liftOut = {});
    for (let l = 0; l < cap; l += 0.035)
      if (!test(pitch + l, false)) {
        out.lift = l;
        out.ok = true;
        out.bad = 0;
        return out;
      }
    out.bad = test(pitch + cap, true);
    out.lift = cap;
    out.ok = !out.bad;
    return out;
  }
  // (round 35) Past the cap the view turns away from the high side: the yaws
  // round the current one are tried, and the view turns, once, to the nearest
  // that the lift can clear within the cap (failing that, to the one that
  // leaves clearly less terrain in the way). A turn by the player (any change
  // of the goal's yaw from outside) pins the yaw at that spot until the view
  // moves on (4 tiles) or zooms (30%). Returns true when it turned.
  _swing(pitch, c, ty, here, dt) {
    const g = this.goal;
    const h = this._yawHold;
    if (h && (Math.hypot(c.x - h.x, c.z - h.z) > 4 || Math.abs(c.dist / h.dist - 1) > 0.3)) this._yawHold = null;
    this._swingT = (this._swingT || 0) - dt;
    // (only a view clearly spoiled at the cap turns: a hidden target, or
    // terrain over a tenth past the limits)
    if (here.bad <= 0.1 || this._yawHold || (this._swingT > 0 && dt < 1)) return false;
    this._swingT = 0.4;
    const v = this._swV || (this._swV = {});
    v.x = c.x;
    v.z = c.z;
    v.dist = c.dist;
    const hereBad = here.bad;
    let best = null,
      bestCost = Infinity;
    for (const off of SWING) {
      v.yaw = c.yaw + off;
      const r = this._liftAt(pitch, v, ty, true);
      const cost = (r.ok ? r.lift / DEG : 1000 + 100 * r.bad) + 0.12 * (Math.abs(off) / DEG);
      if (cost < bestCost && (r.ok || r.bad < hereBad - 0.15)) {
        bestCost = cost;
        best = off;
      }
    }
    if (best == null) return false;
    g.yaw += best;
    if (dt >= 1) c.yaw = g.yaw;
    this._yawSeen = g.yaw;
    this._swingT = 1.5; // (no second turn straight after)
    return true;
  }
  // Where a creature or craft is drawn this frame: between its last two
  // ticks (px, pz -> x, z) by the share of the next tick already run, as
  // UnitRenderer and FleetRenderer interpolate it.
  _drawnAt(f) {
    const g = this.game;
    const out = this._dAt || (this._dAt = { x: 0, z: 0 });
    out.x = f.x;
    out.z = f.z;
    const px = f.px,
      pz = f.pz;
    // (FleetRenderer draws a paused craft at its tick; UnitRenderer keeps a
    // creature at the share of the tick run when the game paused)
    const craft = f.cls != null || f.def?.cls != null;
    if (px == null || pz == null || (craft && g.paused) || Math.abs(px - f.x) + Math.abs(pz - f.z) > 2) return out;
    const a = Math.min(1, Math.max(0, (g._acc || 0) / ((craft ? g.simStep : g.units?.tickDt) || 1 / 15)));
    out.x = px + (f.x - px) * a;
    out.z = pz + (f.z - pz) * a;
    return out;
  }
  // The followed creature or craft, when there is one to aim at.
  _followed() {
    const f = this.follow;
    return f && f.alive !== false && f.x != null ? f : null;
  }
  apply() {
    const c = this.cur;
    const W = this.game.world;
    const dt = Math.max(0, Math.min(1, this._dt || 0));
    const f = this._followed();
    // the height to aim at: following, the unit's own height (its surface, or
    // its altitude for craft) plus its chest, so it sits at the middle of the
    // view at every zoom; otherwise the ground under the target
    let aim;
    if (f) {
      const y0 = f.y ?? W.surfaceAt(f.x, f.z);
      const bh = this.game.picker?.bodyHeight ? this.game.picker.bodyHeight(f) : 0.18;
      aim = y0 + bh * 0.6;
    } else {
      const ground = Math.max(0, W.heightAt(c.x, c.z));
      // close in, the target sits on the ground itself (round 25: at 60% of the
      // ground height the closest zoom looked at a point inside a hill); farther
      // out it eases back to 60%, which keeps the far views steady
      const kG = c.dist <= 20 ? 1 : c.dist >= 40 ? 0.6 : 1 - (0.4 * (c.dist - 20)) / 20;
      aim = ground * kG;
    }
    // ease the height by elapsed time, not per frame (round 27: at a low frame
    // rate the old 8%-per-frame ease lagged far behind the followed unit, who
    // drifted to the bottom of the screen behind the tray); following eases faster
    const kY = 1 - Math.exp(-dt * (f ? 10 : 5));
    this._groundY = this._groundY == null ? aim : this._groundY + (aim - this._groundY) * kY;
    this.target.set(c.x, this._groundY, c.z);
    let pitch = this.pitchFor(c.dist);
    // (a turn of the view from outside: the player's own, see _swing)
    if (this._yawSeen !== this.goal.yaw) {
      this._yawSeen = this.goal.yaw;
      this._yawHold = { x: c.x, z: c.z, dist: c.dist };
    }
    // close in, raise the pitch until the line of sight clears the terrain
    // (rises quickly, settles back slowly); up close (under 16 tiles) also
    // while a slope near the eye covers the lower frame (round 31) or a wall
    // beyond the target fills the upper frame (round 33). (round 35) The lift
    // stops at LIFT_MAX and PITCH_MAX; past that the view turns (_swing).
    if (c.dist < 30) {
      const near = c.dist < 16;
      const ty = this.target.y;
      let r = this._liftAt(pitch, c, ty, near);
      if (near && this._swing(pitch, c, ty, r, dt)) r = this._liftAt(pitch, c, ty, near);
      const need = r.lift;
      if (this._lift == null) this._lift = need;
      else this._lift += (need - this._lift) * (1 - Math.exp(-dt * (need > this._lift ? 20 : 2.5)));
      pitch = Math.min(Math.max(PITCH_MAX, pitch), pitch + this._lift);
    } else this._lift = 0;
    const horiz = Math.cos(pitch) * c.dist;
    const cam = this.camera;
    cam.position.set(
      c.x + Math.sin(c.yaw) * horiz,
      this.target.y + Math.sin(pitch) * c.dist,
      c.z + Math.cos(c.yaw) * horiz,
    );
    // close to the ground on a slope, keep the camera above the hillside
    // behind it: (round 35) it slides in along the line of sight, keeping its
    // pitch, to the first point clear of the ground (raising it straight up
    // turned the view steeply down); only when no point within about two
    // thirds of the way is clear does it rise
    if (c.dist < 30) {
      const W = this.game.world;
      const T = this.target,
        P = cam.position;
      const room = (k) => {
        const x = T.x + (P.x - T.x) * k,
          z = T.z + (P.z - T.z) * k;
        const hx = Math.min(W.w - 1, Math.max(0, x)),
          hz = Math.min(W.h - 1, Math.max(0, z));
        return T.y + (P.y - T.y) * k - (Math.max(0, W.heightAt(hx, hz)) + 0.8);
      };
      let k = 1;
      if (room(1) < 0) {
        let j = 0.95;
        while (j > 0.4 && room(j) < 0) j -= 0.05;
        if (j > 0.4) k = j;
      }
      // (in at once, back out slowly)
      if (this._dolly == null || k < this._dolly) this._dolly = k;
      else this._dolly += (k - this._dolly) * (1 - Math.exp(-dt * 2.5));
      if (this._dolly < 0.999) P.set(T.x + (P.x - T.x) * this._dolly, T.y + (P.y - T.y) * this._dolly, T.z + (P.z - T.z) * this._dolly);
      const hx = Math.min(W.w - 1, Math.max(0, P.x)),
        hz = Math.min(W.h - 1, Math.max(0, P.z));
      const floor = Math.max(0, W.heightAt(hx, hz)) + 0.8;
      if (P.y < floor) P.y = floor;
    } else this._dolly = null;
    if (this.shake > 0) {
      const s = this.shake * 0.35 * Math.min(1, c.dist / 40);
      const t = this._shakeT * 40;
      cam.position.x += Math.sin(t * 1.3) * s;
      cam.position.y += Math.sin(t * 1.7 + 1) * s * 0.6;
      cam.position.z += Math.sin(t * 1.1 + 2) * s;
    }
    cam.lookAt(this.target);
    cam.near = Math.max(c.dist < 5 ? 0.06 * c.dist : 0.3, c.dist * 0.02);
    cam.far = c.dist * 6 + 600;
    this._frame(cam, dt, f);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    // the close-zoom cutaway through buildings (see CAM_CUT)
    CAM_CUT.uCut.value = 1 - THREE.MathUtils.smoothstep(c.dist, CUT_NEAR, CUT_FAR);
    CAM_CUT.uCutD.value = cam.position.distanceTo(this.target);
    CAM_CUT.uCutTan.value = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    CAM_CUT.uCamW.value.copy(cam.matrixWorld);
    CAM_CUT.uCutT.value.copy(this.target);
    this._cutaway(cam, dt, f);
  }

  // Frame a followed unit at the middle of the screen area the HUD leaves
  // visible (below the top bar, above the tray or the phone's sheet, beside
  // the inspector), by sliding the projection window: the camera still looks
  // straight at the unit, only the picture shifts. Eased; none when not following.
  _frame(cam, dt, f) {
    let tx = 0,
      ty = 0;
    const r = this.viewRect;
    const W = innerWidth,
      H = innerHeight;
    if (f && r && W > 0 && H > 0) {
      // the visible area's middle against the screen's, in px (capped, so a
      // big panel never pushes the view far off)
      tx = THREE.MathUtils.clamp(W / 2 - (r.left + r.right) / 2, -W * 0.25, W * 0.25);
      ty = THREE.MathUtils.clamp(H / 2 - (r.top + r.bottom) / 2, -H * 0.3, H * 0.3);
    }
    const o = this._vOff;
    const k = 1 - Math.exp(-dt * 6);
    o.x += (tx - o.x) * k;
    o.y += (ty - o.y) * k;
    if (Math.abs(o.x) < 0.5 && Math.abs(o.y) < 0.5 && !tx && !ty) {
      o.x = o.y = 0;
      if (cam.view && cam.view.enabled) cam.clearViewOffset();
      return;
    }
    if (W > 0 && H > 0) cam.setViewOffset(W, H, o.x, o.y, W, H);
  }

  // Which buildings stand between the eye and the target (CAM_CUT). A few
  // sight lines (to the target, to points round it a quarter of the
  // half-frame away, and to the followed unit's head and feet) are stepped
  // through the building grid; a building whose box (footprint by an
  // estimated height) holds a step is cut, unless it holds the target itself.
  _cutaway(cam, dt, f) {
    const A = this._cutA;
    const on = CAM_CUT.uCut.value > 0.001;
    // building id -> the lowest point of a sight line inside its box
    const hitNow = new Map();
    const g = this.game;
    const W = g.world;
    const civ = g.civ;
    if (on && civ?._bById && W.building) {
      const T = this.target;
      const E = cam.position;
      const tb = this._bAt(T.x, T.z);
      const rr = 0.25 * CAM_CUT.uCutD.value * CAM_CUT.uCutTan.value;
      const ex = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).multiplyScalar(rr);
      const ey = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).multiplyScalar(rr);
      const ends = [
        [T.x, T.y, T.z],
        [T.x + ex.x, T.y + ex.y, T.z + ex.z],
        [T.x - ex.x, T.y - ex.y, T.z - ex.z],
        [T.x + ey.x, T.y + ey.y, T.z + ey.z],
      ];
      if (f) {
        const fy = f.y ?? W.surfaceAt(f.x, f.z);
        const bh = g.picker?.bodyHeight ? g.picker.bodyHeight(f) : 0.18;
        ends.push([f.x, fy + bh, f.z], [f.x, fy, f.z]);
        // (round 29) the helper line below the target only when the followed
        // unit stands down there on the screen: it cut buildings in the
        // foreground that hid nothing
        const below = ((f.x - T.x) * ey.x + (fy - T.y) * ey.y + (f.z - T.z) * ey.z) / (rr * rr);
        if (below < -0.3) ends.push([T.x - ey.x * 0.6, T.y - ey.y * 0.6, T.z - ey.z * 0.6]);
      }
      // (round 33) and lines to the ground at the bottom of the frame, cutting
      // only what stands in their first half, by the eye: a building close
      // in front of the camera filled the bottom of the frame as a blurred
      // dome (the lines to the target pass over it)
      {
        const tanH = CAM_CUT.uCutTan.value,
          asp = cam.aspect || 1;
        const f = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 2).negate();
        const rx = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0),
          uy = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
        for (const a of [-0.6, 0, 0.6]) {
          const d = f.clone().addScaledVector(rx, a * tanH * asp).addScaledVector(uy, -0.8 * tanH);
          if (d.y > -0.05) continue;
          const t = (E.y - T.y) / -d.y;
          ends.push([E.x + d.x * t, T.y, E.z + d.z * t, 0.5]);
        }
      }
      for (const [x1, y1, z1, tMax = 1] of ends) {
        const L = Math.hypot(x1 - E.x, y1 - E.y, z1 - E.z);
        const n = Math.min(160, Math.ceil(L / 0.2));
        // (stops short of the end, so what stands right at the target is kept)
        for (let i = 1; i < n - 1; i++) {
          const t = i / n;
          if (t > tMax) break;
          const x = E.x + (x1 - E.x) * t,
            y = E.y + (y1 - E.y) * t,
            z = E.z + (z1 - E.z) * t;
          const b = this._bAt(x, z);
          if (!b || b === tb) continue;
          if (y < b.y + this._bHeight(b)) {
            const o = hitNow.get(b.id);
            if (o === undefined || y < o) hitNow.set(b.id, y);
          }
        }
      }
      // (round 35) and, as trees are, any building whose box comes within
      // about two fifths of the target's distance of the eye, anywhere in
      // front of it, is cut down to its footing: a huge tower close beside
      // the camera filled a corner of the frame uncut, and a big building
      // in the foreground filled the frame, blurred
      {
        const nearR = Math.max(1.2, CAM_CUT.uCutD.value * 0.42);
        const fw = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 2).negate();
        const seen = new Set();
        const r = Math.ceil(nearR) + 1;
        const ex = Math.floor(E.x),
          ez = Math.floor(E.z);
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) {
            const b = this._bAt(ex + dx + 0.5, ez + dz + 0.5);
            if (!b || b === tb || seen.has(b.id)) continue;
            seen.add(b.id);
            const y0 = b.y || 0,
              y1 = y0 + this._bHeight(b);
            // the nearest point of its box to the eye
            const px = Math.min(Math.max(E.x, b.tx), b.tx + (b.w || 1)),
              py = Math.min(Math.max(E.y, y0), y1),
              pz = Math.min(Math.max(E.z, b.ty), b.ty + (b.h || 1));
            const qx = px - E.x,
              qy = py - E.y,
              qz = pz - E.z;
            if (Math.hypot(qx, qy, qz) > nearR) continue;
            // (in front of the eye: its box's middle ahead of it)
            const mx = b.tx + (b.w || 1) / 2 - E.x,
              my = (y0 + y1) / 2 - E.y,
              mz = b.ty + (b.h || 1) / 2 - E.z;
            if (mx * fw.x + my * fw.y + mz * fw.z <= 0) continue;
            hitNow.set(b.id, y0);
          }
      }
    }
    const kin = 1 - Math.exp(-dt * 7),
      kout = 1 - Math.exp(-dt * 4);
    const Y = this._cutY;
    for (const [id, y] of hitNow) {
      if (!A.has(id)) A.set(id, 0);
      // (the lowest sight line, eased as the camera moves)
      const o = Y.get(id);
      Y.set(id, o === undefined ? y : o + (y - o) * Math.min(1, kin * 2));
    }
    for (const [id, a] of A) {
      const goal = hitNow.has(id) ? 1 : 0;
      const na = a + (goal - a) * (goal > a ? kin : kout);
      if (na < 0.01 && !goal) {
        A.delete(id);
        Y.delete(id);
      } else A.set(id, na);
    }
    // the strongest CUT_N go to the material
    const list = A.size ? [...A.entries()].sort((p, q) => q[1] - p[1]) : [];
    const boxes = CAM_CUT.uCutBox.value,
      als = CAM_CUT.uCutA.value,
      ys = CAM_CUT.uCutY.value;
    const cut = CAM_CUT.uCut.value;
    for (let i = 0; i < CUT_N; i++) {
      const e = list[i];
      const b = e && civ?._bById?.get(e[0]);
      if (!b || b.alive === false) {
        als[i] = 0;
        ys[i] = 1e4;
        boxes[i].set(0, 0, -1, -1);
        continue;
      }
      // eaves, porches, balconies and the flagpoles and posts before a
      // building reach a little past the plot (round 33: 0.35 left some
      // standing outside the cut)
      const m = 0.45;
      boxes[i].set(b.tx - m, b.ty - m, b.tx + (b.w || 1) + m, b.ty + (b.h || 1) + m);
      als[i] = e[1];
      // the cut: from over the roof down to just under the lowest sight line
      // (a sliver of wall is always left, so the plot still reads)
      const top = (b.y || 0) + this._bHeight(b) * 1.6 + 0.3;
      const low = Math.max((b.y || 0) + 0.05, (Y.get(e[0]) ?? top) - 0.06);
      ys[i] = top - (top - low) * e[1] * cut;
    }
  }
  _bAt(x, z) {
    const W = this.game.world;
    const tx = Math.floor(x),
      tz = Math.floor(z);
    if (tx < 0 || tz < 0 || tx >= W.w || tz >= W.h) return null;
    const id = W.building[tz * W.w + tx];
    if (!id) return null;
    const b = this.game.civ._bById.get(id);
    return b && b.alive !== false && !b.gone ? b : null;
  }
  // A building's height in world units, roughly (generous: a little too tall
  // only cuts a building the sight line passes just over).
  _bHeight(b) {
    const def = BUILDING_TYPES[b.type] || {};
    if (def.wall) return 1.2 * BUILDING.scale;
    const t = b.type;
    // (round 35: the vertical farm, the climate tower and the other spires
    // stand as tall as a skyscraper; a monument was set too low at 9)
    const h = TALL.has(t) ? 14 : def.monument ? 11 : def.modern ? 7 : 3.4;
    // (round 33) a building site's frame and scaffold stand up to three
    // design units however far the walls have risen inside them
    // (BuildingRenderer 'frame'): a site judged by its progress alone was
    // missed by the sight lines and left its frame members and posts
    // standing beside the cut
    if (b.constructing) return Math.max(h * Math.max(0.3, b.progress || 0), Math.min(h, 3)) * BUILDING.scale;
    return h * BUILDING.scale;
  }
  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fitLimit();
  }
}
