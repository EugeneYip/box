import * as THREE from 'three';

// Smooth god-view camera: orbits a ground target. Zooming out tilts the view
// toward top-down; zooming in lowers it for a diorama perspective.
//   target (x,z) on the ground, distance, yaw (radians), pitch (radians).
export class CameraRig {
  constructor(game) {
    this.game = game;
    const world = game.world;
    this.camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.5, 2000);
    this.minDist = 7;
    this.maxDist = Math.max(world.w, world.h) * 1.15;
    this.target = new THREE.Vector3(world.w / 2, 0, world.h / 2);
    this.goal = { x: world.w / 2, z: world.h / 2, dist: this.maxDist * 0.55, yaw: 0, pitchBias: 0 };
    this.cur = { ...this.goal };
    this.autoPitch = true;
    this.manualPitch = null; // radians when not auto
    this.shake = 0;
    this._shakeT = 0;
    this.keys = new Set();
    this.follow = null; // optional object with .x/.z to follow (e.g. a unit)
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
    this.goal.dist = THREE.MathUtils.clamp(dist, this.minDist, this.maxDist);
    this.goal.yaw = THREE.MathUtils.degToRad(yawDeg);
    this.manualPitch = pitchDeg == null || isNaN(pitchDeg) ? null : THREE.MathUtils.degToRad(pitchDeg);
    if (instant) Object.assign(this.cur, this.goal);
    this.apply();
  }

  // Pan by screen-space delta in pixels.
  panPixels(dx, dy) {
    const k = (this.cur.dist * 1.2) / innerHeight;
    const s = Math.sin(this.goal.yaw),
      c = Math.cos(this.goal.yaw);
    this.goal.x -= (dx * c + dy * s) * k;
    this.goal.z -= (-dx * s + dy * c) * k;
    this.follow = null;
    this.clampGoal();
  }
  // Pan by world-space delta (used when dragging the ground precisely).
  panWorld(dx, dz) {
    this.goal.x += dx;
    this.goal.z += dz;
    this.follow = null;
    this.clampGoal();
  }
  rotate(dyaw) {
    this.goal.yaw += dyaw;
  }
  // Zoom with wheel, keeping the point under the cursor fixed when given.
  zoom(factor, anchor = null) {
    const before = this.goal.dist;
    this.goal.dist = THREE.MathUtils.clamp(this.goal.dist * factor, this.minDist, this.maxDist);
    if (anchor) {
      const k = 1 - this.goal.dist / before;
      this.goal.x += (anchor.x - this.goal.x) * k;
      this.goal.z += (anchor.z - this.goal.z) * k;
      this.clampGoal();
    }
  }
  clampGoal() {
    const w = this.game.world;
    this.goal.x = THREE.MathUtils.clamp(this.goal.x, 0, w.w);
    this.goal.z = THREE.MathUtils.clamp(this.goal.z, 0, w.h);
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
      this.goal.x += (px * c + pz * s) * speed;
      this.goal.z += (-px * s + pz * c) * speed;
      this.follow = null;
      this.clampGoal();
    }
    if (this.keys.has('KeyQ')) this.goal.yaw -= dt * 1.4;
    if (this.keys.has('KeyE')) this.goal.yaw += dt * 1.4;
    if (this.keys.has('Equal') || this.keys.has('NumpadAdd')) this.zoom(Math.pow(0.35, dt));
    if (this.keys.has('Minus') || this.keys.has('NumpadSubtract')) this.zoom(Math.pow(1 / 0.35, dt));

    if (this.follow && this.follow.alive !== false) {
      this.goal.x = this.follow.x;
      this.goal.z = this.follow.z;
    }

    const k = 1 - Math.exp(-dt * 9);
    const kz = 1 - Math.exp(-dt * 7);
    this.cur.x += (this.goal.x - this.cur.x) * k;
    this.cur.z += (this.goal.z - this.cur.z) * k;
    this.cur.dist += (this.goal.dist - this.cur.dist) * kz;
    this.cur.yaw += (this.goal.yaw - this.cur.yaw) * k;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this._shakeT += dt;
    this.apply();
  }

  apply() {
    const c = this.cur;
    const ground = Math.max(0, this.game.world.heightAt(c.x, c.z));
    // ease ground height so the camera doesn't jitter over terrain
    this._groundY = this._groundY == null ? ground : this._groundY + (ground - this._groundY) * 0.08;
    this.target.set(c.x, this._groundY * 0.6, c.z);
    const pitch = this.pitchFor(c.dist);
    const horiz = Math.cos(pitch) * c.dist;
    const cam = this.camera;
    cam.position.set(
      c.x + Math.sin(c.yaw) * horiz,
      this.target.y + Math.sin(pitch) * c.dist,
      c.z + Math.cos(c.yaw) * horiz,
    );
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
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
