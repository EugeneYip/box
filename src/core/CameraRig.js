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
// cut range: full at CUT_NEAR, gone by CUT_FAR
const CUT_NEAR = 10,
  CUT_FAR = 14;

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
    if (instant) {
      Object.assign(this.cur, this.goal);
      this._groundY = null; // no easing from the old spot's ground
      this._lift = null; // nor from its line-of-sight pitch
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

    // the closer follow zoom ends when the unit is let go: back out to minDist
    if (this.goal.dist < this.minDist && !this.closeOK()) this.goal.dist = this.minDist;

    const wrapW = geoWrapOn(this.game.world) ? this.game.world.w : 0;
    if (this.follow && this.follow.alive !== false) {
      this.goal.x = this.follow.x;
      this.goal.z = this.follow.z;
      // (a ship followed across the Round world's seam: the camera goes round with her)
      if (wrapW && Math.abs(this.goal.x - this.cur.x) > wrapW / 2) this.cur.x += this.goal.x > this.cur.x ? wrapW : -wrapW;
    }

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

  // The extra pitch (radians) that lets the eye see the target over the
  // terrain between them: the line of sight is sampled at a dozen points and
  // the pitch raised in steps until every sample clears the ground (round 25:
  // on high ground the closest zoom sat inside the hillside).
  _clearLift(pitch, c, ty) {
    const W = this.game.world;
    const s = Math.sin(c.yaw),
      co = Math.cos(c.yaw);
    const maxP = THREE.MathUtils.degToRad(80);
    for (let p = pitch; p < maxP; p += 0.035) {
      const horiz = Math.cos(p) * c.dist,
        up = Math.sin(p) * c.dist;
      let clear = true;
      for (let i = 1; i <= 12 && clear; i++) {
        const t = i / 12;
        const x = c.x + s * horiz * t,
          z = c.z + co * horiz * t;
        if (x < 0 || z < 0 || x > W.w - 1 || z > W.h - 1) continue;
        // (a margin that grows from nothing at the target toward the eye, so
        // flat ground never lifts the view: grass and low walls)
        if (Math.max(0, W.heightAt(x, z)) + (0.3 + 0.05 * c.dist) * t > ty + up * t) clear = false;
      }
      if (clear) return p - pitch;
    }
    return maxP - pitch;
  }
  // The extra pitch (radians, at least `lift`) at which terrain near the eye
  // covers no more than about 30% of the lower part of the frame. Rays through
  // a 5 x 3 grid of points in the lower 60% of the picture are marched toward
  // the plane at the target's height; a ray that meets the ground before 70%
  // of its way there is covered by a foreground slope.
  _coverLift(pitch, lift, c, ty) {
    const W = this.game.world;
    const cam = this.camera;
    const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const asp = cam.aspect || 1;
    const s = Math.sin(c.yaw),
      co = Math.cos(c.yaw);
    const maxP = THREE.MathUtils.degToRad(78);
    const wMax = W.w - 1,
      hMax = W.h - 1;
    const covered = (p) => {
      const horiz = Math.cos(p) * c.dist;
      const ex = c.x + s * horiz,
        ey = ty + Math.sin(p) * c.dist,
        ez = c.z + co * horiz;
      // camera basis: forward toward the target, right, up
      const fx = -s * Math.cos(p),
        fy = -Math.sin(p),
        fz = -co * Math.cos(p);
      const rx = co,
        rz = -s;
      const ux = -s * Math.sin(p),
        uy = Math.cos(p),
        uz = -co * Math.sin(p);
      let n = 0,
        hit = 0;
      for (let j = 0; j < 3; j++) {
        const b = -0.15 - j * 0.3; // lower frame, NDC
        for (let i = 0; i < 5; i++) {
          const a = -0.8 + i * 0.4;
          const dx = fx + rx * a * tanH * asp + ux * b * tanH,
            dy = fy + uy * b * tanH,
            dz = fz + rz * a * tanH * asp + uz * b * tanH;
          if (dy > -0.02) continue;
          const L = (ey - ty) / -dy; // along the ray to the target's plane
          n++;
          for (let k = 1; k <= 8; k++) {
            const t = (k / 8) * 0.7;
            const x = ex + dx * L * t,
              z = ez + dz * L * t;
            if (x < 0 || z < 0 || x > wMax || z > hMax) continue;
            if (Math.max(0, W.heightAt(x, z)) + 0.05 > ey + dy * L * t) {
              hit++;
              break;
            }
          }
        }
      }
      return n ? hit / n : 0;
    };
    let p = pitch + lift;
    for (let i = 0; i < 12 && p < maxP; i++, p += 0.04) if (covered(p) <= 0.3) break;
    return Math.max(lift, Math.min(maxP, p) - pitch);
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
    // close in, raise the pitch until the line of sight clears the terrain
    // (rises quickly, settles back slowly)
    if (c.dist < 30) {
      let need = this._clearLift(pitch, c, this.target.y);
      // (round 31) up close, a slope beside the sight line could still fill
      // half the frame (a blurred hillside over the right half at 5 tiles):
      // pitch up further while terrain covers more than about 30% of the
      // lower frame
      if (c.dist < 16) need = this._coverLift(pitch, need, c, this.target.y);
      if (this._lift == null) this._lift = need;
      else this._lift += (need - this._lift) * (1 - Math.exp(-dt * (need > this._lift ? 20 : 2.5)));
      pitch = Math.min(THREE.MathUtils.degToRad(80), pitch + this._lift);
    } else this._lift = 0;
    const horiz = Math.cos(pitch) * c.dist;
    const cam = this.camera;
    cam.position.set(
      c.x + Math.sin(c.yaw) * horiz,
      this.target.y + Math.sin(pitch) * c.dist,
      c.z + Math.cos(c.yaw) * horiz,
    );
    // close to the ground on a slope, keep the camera above the hillside
    // behind it
    if (c.dist < 30) {
      const W = this.game.world;
      const hx = Math.min(W.w - 1, Math.max(0, cam.position.x)),
        hz = Math.min(W.h - 1, Math.max(0, cam.position.z));
      const floor = Math.max(0, W.heightAt(hx, hz)) + 0.8;
      if (cam.position.y < floor) cam.position.y = floor;
    }
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
      for (const [x1, y1, z1] of ends) {
        const L = Math.hypot(x1 - E.x, y1 - E.y, z1 - E.z);
        const n = Math.min(160, Math.ceil(L / 0.2));
        // (stops short of the end, so what stands right at the target is kept)
        for (let i = 1; i < n - 1; i++) {
          const t = i / n;
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
      const m = 0.35; // eaves and porches reach a little past the plot
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
    const h = t === 'skyscraper' || t === 'arcology' ? 14 : def.monument ? 9 : def.modern ? 7 : 3.4;
    return h * BUILDING.scale * (b.constructing ? Math.max(0.3, b.progress || 0) : 1);
  }
  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fitLimit();
  }
}
