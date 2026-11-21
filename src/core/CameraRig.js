import * as THREE from 'three';
import { geoWrapOn } from '../world/geo.js';
import { SEA_LEVEL } from '../world/constants.js';

// The close-zoom cutaway (round 25): buildings between the eye and the target
// open up in a dithered screen-door near the middle of the frame, so a roof
// never fills the view at the closest zoom. The building material reads these
// uniforms (src/render/buildings/material.js); apply() writes them.
//   uCut     strength 0..1 (1 under distance 14, none past 24)
//   uCutD    the eye's distance to the target (world units)
//   uCutTan  tan(fov / 2), so the radius scales with depth like the frame
export const CAM_CUT = { uCut: { value: 0 }, uCutD: { value: 10 }, uCutTan: { value: 0.34 } };

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
    this.goal.dist = THREE.MathUtils.clamp(dist, this.minDist, this.zoomMax());
    this.goal.yaw = THREE.MathUtils.degToRad(yawDeg);
    this.manualPitch = pitchDeg == null || isNaN(pitchDeg) ? null : THREE.MathUtils.degToRad(pitchDeg);
    if (instant) {
      Object.assign(this.cur, this.goal);
      this._groundY = null; // no easing from the old spot's ground
      this._lift = null; // nor from its line-of-sight pitch
    }
    this.apply();
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
    this.goal.dist = THREE.MathUtils.clamp(this.goal.dist * factor, this.minDist, this.zoomMax());
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
  apply() {
    const c = this.cur;
    const ground = Math.max(0, this.game.world.heightAt(c.x, c.z));
    // ease ground height so the camera doesn't jitter over terrain
    this._groundY = this._groundY == null ? ground : this._groundY + (ground - this._groundY) * 0.08;
    // close in, the target sits on the ground itself (round 25: at 60% of the
    // ground height the closest zoom looked at a point inside a hill); farther
    // out it eases back to 60%, which keeps the far views steady
    const kG = c.dist <= 20 ? 1 : c.dist >= 40 ? 0.6 : 1 - (0.4 * (c.dist - 20)) / 20;
    this.target.set(c.x, this._groundY * kG, c.z);
    let pitch = this.pitchFor(c.dist);
    // close in, raise the pitch until the line of sight clears the terrain
    // (rises quickly, settles back slowly)
    if (c.dist < 30) {
      const need = this._clearLift(pitch, c, this.target.y);
      if (this._lift == null) this._lift = need;
      else this._lift += (need - this._lift) * (need > this._lift ? 0.3 : 0.04);
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
    cam.near = Math.max(0.3, c.dist * 0.02);
    cam.far = c.dist * 6 + 600;
    cam.updateProjectionMatrix();
    // the close-zoom cutaway through buildings (see CAM_CUT)
    CAM_CUT.uCut.value = 1 - THREE.MathUtils.smoothstep(c.dist, 14, 24);
    CAM_CUT.uCutD.value = cam.position.distanceTo(this.target);
    CAM_CUT.uCutTan.value = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
  }
  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fitLimit();
  }
}
