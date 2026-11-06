import * as THREE from 'three';

// A fixed pool of point lights (always present so the scene's light count,
// and therefore every material's shader program, never changes). Each frame
// the most important light sources (transient flashes plus persistent
// requests from fires, lava and volcanoes) are assigned to the pool, ranked
// by brightness and proximity to the camera focus. Assignment is sticky so a
// light keeps its source between frames and does not pop.

const MAX = 6;
const UNIT = 5; // candela per contract intensity unit (decay 1.6)

export class LightPool {
  constructor(fx) {
    this.fx = fx;
    this.lights = [];
    this.keys = new Array(MAX).fill(null);
    for (let i = 0; i < MAX; i++) {
      const l = new THREE.PointLight(0xffa040, 0, 20, 1.6);
      l.castShadow = false;
      l.position.set(0, -1000, 0);
      fx.game.scene.add(l);
      this.lights.push(l);
    }
    this.transients = [];
    this.requests = [];
    this._nextKey = 1;
  }

  // One-shot light that fades out (quadratic) over `duration` seconds.
  transient(pos, color, intensity = 1, duration = 0.5, range = null) {
    const c = new THREE.Color(color);
    this.transients.push({
      key: 't' + this._nextKey++,
      x: pos.x,
      y: pos.y ?? this.fx.game.world.surfaceAt(pos.x, pos.z) + 1.5,
      z: pos.z,
      color: c,
      intensity,
      range: range ?? 14 * Math.sqrt(Math.max(0.2, intensity)),
      age: 0,
      duration: Math.max(0.05, duration),
    });
    if (this.transients.length > 32) this.transients.shift();
  }

  // Persistent source for this frame only (call every frame while active).
  request(key, x, y, z, color, intensity, range) {
    this.requests.push({ key, x, y, z, color, intensity, range });
  }

  clear() {
    this.transients.length = 0;
    this.requests.length = 0;
  }

  update(dt) {
    const rig = this.fx.game.cameraRig;
    const cx = rig.cur.x,
      cz = rig.cur.z,
      span = Math.max(30, rig.cur.dist * 1.1);
    const cands = this.requests;
    for (let i = this.transients.length - 1; i >= 0; i--) {
      const t = this.transients[i];
      t.age += dt;
      const f = 1 - t.age / t.duration;
      if (f <= 0) {
        this.transients.splice(i, 1);
        continue;
      }
      cands.push({ key: t.key, x: t.x, y: t.y, z: t.z, color: t.color, intensity: t.intensity * f * f, range: t.range, transient: true });
    }
    for (const c of cands) {
      const d = Math.hypot(c.x - cx, c.z - cz);
      c.score = (c.intensity * (c.transient ? 3 : 1)) / (1 + (d / span) * (d / span) * 4);
      if (d > span * 2.2) c.score *= 0.05;
    }
    cands.sort((a, b) => b.score - a.score);
    const chosen = cands.slice(0, MAX);
    const free = [];
    const byKey = new Map(chosen.map((c) => [c.key, c]));
    // keep sticky assignments
    for (let i = 0; i < MAX; i++) {
      const c = this.keys[i] && byKey.get(this.keys[i]);
      if (c) {
        this._apply(i, c);
        byKey.delete(c.key);
      } else free.push(i);
    }
    for (const c of byKey.values()) {
      const i = free.shift();
      if (i === undefined) break;
      this.keys[i] = c.key;
      this._apply(i, c);
    }
    const U = this.fx.uniforms;
    for (const i of free) {
      this.keys[i] = null;
      this.lights[i].intensity = 0;
      U.uPLC.value[i].set(0, 0, 0);
    }
    this.requests = [];
  }

  _apply(i, c) {
    const l = this.lights[i];
    l.position.set(c.x, c.y, c.z);
    l.color.copy(c.color);
    l.intensity = c.intensity * UNIT;
    l.distance = c.range;
    // mirror into the particle shader so smoke / dust are lit too
    const U = this.fx.uniforms;
    U.uPL.value[i].set(c.x, c.y, c.z, c.range);
    U.uPLC.value[i].set(c.color.r, c.color.g, c.color.b).multiplyScalar(c.intensity * 0.45);
  }
}
