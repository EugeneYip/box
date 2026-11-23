import * as THREE from 'three';
import { SEA_LEVEL } from '../world/constants.js';
import { UNIT, VEHICLE, PICK_PX } from './scale.js';
import { KINDS } from '../sim/fleet/kinds.js';

// (round 25) Inside a building's footprint a creature or vehicle takes the
// click only when its body is within this many CSS pixels of the cursor.
export const MOVER_PX = 7;
const _v = new THREE.Vector3();

// Ray / heightfield intersection against the CPU world data.
export class Picker {
  constructor(game) {
    this.game = game;
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
  }
  // clientX/clientY in CSS pixels. Returns {x, y, z, tx, ty, water} or null.
  // includeWater: if true, the water surface stops the ray.
  pick(clientX, clientY, includeWater = true) {
    const el = this.game.pipeline.renderer.domElement;
    const rect = el.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const cam = this.game.cameraRig.camera;
    this.ray.setFromCamera(this.ndc, cam);
    const hit = this.intersect(this.ray.ray, includeWater);
    // world units per CSS pixel at the hit (pickers keep a minimum radius in
    // pixels, so half-size people and cars stay easy to click at any zoom)
    if (hit) {
      const o = this.ray.ray.origin;
      const d = Math.hypot(hit.x - o.x, hit.y - o.y, hit.z - o.z);
      hit.px = (2 * d * Math.tan(((cam.fov || 38) * Math.PI) / 360)) / Math.max(1, rect.height);
      // the cursor itself, for screen-space tie-breaks (a person beside a building)
      hit.sx = clientX;
      hit.sy = clientY;
    }
    return hit;
  }
  // Screen point (CSS px) of a world position, or null when behind the camera.
  project(x, y, z) {
    const cam = this.game.cameraRig.camera;
    const rect = this.game.pipeline.renderer.domElement.getBoundingClientRect();
    _v.set(x, y, z).project(cam);
    if (_v.z > 1 || _v.z < -1) return null;
    return [rect.left + (_v.x * 0.5 + 0.5) * rect.width, rect.top + (-_v.y * 0.5 + 0.5) * rect.height];
  }
  // Height of a creature or craft's body in world units.
  bodyHeight(o) {
    if (o.def?.cls || o.cls) return 0.5 * VEHICLE.rel * Math.max(0.6, o.def?.size || 1);
    return (o.def?.height ?? 0.6) * UNIT.scale * (o.scale || 1) * (o.def?.size || 1);
  }
  // Distance in CSS px from the cursor (sx, sy) to a creature's or craft's
  // upright body (the segment from its feet to its head on screen).
  moverPx(o, sx, sy) {
    if (o?.x == null || sx == null) return Infinity;
    const W = this.game.world;
    const y0 = o.y ?? W.surfaceAt(o.x, o.z);
    const a = this.project(o.x, y0, o.z);
    const b = this.project(o.x, y0 + this.bodyHeight(o), o.z);
    if (!a || !b) return Infinity;
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 > 1e-6 ? Math.max(0, Math.min(1, ((sx - a[0]) * dx + (sy - a[1]) * dy) / l2)) : 0;
    return Math.hypot(sx - (a[0] + dx * t), sy - (a[1] + dy * t));
  }
  // The building whose footprint holds (x, z), or null.
  buildingAt(x, z) {
    const g = this.game;
    const W = g.world;
    const tx = Math.floor(x),
      ty = Math.floor(z);
    if (!g.civ?._bById || !W.inBounds?.(tx, ty)) return null;
    const b = g.civ._bById.get(W.building[W.idx(tx, ty)]);
    return b && b.alive !== false ? b : null;
  }
  // (round 25) What a click at this pick selects, cheaply enough for every
  // frame (the hover ring and the pointer cursor): {kind, ref} or null. Uses
  // the same radii as Units.inspect / Fleet.inspect, and the same rule as the
  // inspector: inside a building's footprint a creature or craft wins only
  // within MOVER_PX of the cursor.
  target(hit) {
    if (!hit) return null;
    const g = this.game;
    const pxR = Math.min(2.5, (hit.px || 0) * PICK_PX);
    let mover = null,
      kind = null;
    // vehicles first (they outrank people standing beside them)
    let bd = Infinity;
    for (const v of g.fleet?.list || []) {
      if (!v.alive || v.state === 'sinking' || v.cls === 'air' || v.cls === 'space') continue;
      const dx = v.x - hit.x,
        dz = v.z - hit.z;
      if (Math.abs(dx) > 2.6 || Math.abs(dz) > 2.6) continue;
      const d = Math.hypot(dx, dz);
      const r = Math.max(0.9 * VEHICLE.rel, (v.def?.size || 1) * (v.cls === 'sea' ? 1.1 : 0.9), pxR);
      if (d < r && d < bd) {
        bd = d;
        mover = v;
        kind = 'vessel';
      }
    }
    // (round 33) a street car (fleet.traffic, where it is drawn in its lane)
    // by the same rule as the other half-size craft: the nearer one wins
    const car = g.fleet?.carAt?.(hit.x, hit.z, Math.min(bd, Math.max(0.9 * VEHICLE.rel, KINDS.car.size * 0.9, pxR)));
    if (car) {
      mover = g.fleet.carHandle(car.c);
      kind = 'vessel';
    }
    if (!mover && g.units?.forEachNear) {
      let bs = Infinity;
      g.units.forEachNear(hit.x, hit.z, 2.5, (o, d2) => {
        if (o._hid || (o.data && (o.data.inside || o.data.aboard != null))) return;
        const r = Math.max(0.6 * UNIT.rel + o.def.radius * 1.5, pxR);
        if (d2 > r * r) return;
        const s = d2 / (r * r) - (o.def.kind === 'monster' ? 0.2 : 0);
        if (s < bs) {
          bs = s;
          mover = o;
          kind = 'unit';
        }
      });
    }
    const b = this.buildingAt(hit.x, hit.z);
    if (mover && b && this.moverPx(mover, hit.sx, hit.sy) > MOVER_PX) mover = null;
    if (mover) return { kind, ref: mover };
    if (b) return { kind: 'building', ref: b };
    return null;
  }
  intersect(ray, includeWater = true) {
    const world = this.game.world;
    const o = ray.origin,
      d = ray.direction;
    const surf = (x, z) => (includeWater ? Math.max(world.heightAt(x, z), SEA_LEVEL) : world.heightAt(x, z));
    // start where the ray enters the world's vertical slab
    let t = 0;
    const topY = 30;
    if (o.y > topY && d.y < 0) t = (o.y - topY) / -d.y;
    const maxT = t + 3000;
    let step = 0.4;
    let prevT = t;
    let prevAbove = true;
    for (; t < maxT; t += step) {
      const x = o.x + d.x * t,
        y = o.y + d.y * t,
        z = o.z + d.z * t;
      if (y < -20) break;
      const inside = x >= 0 && z >= 0 && x <= world.w && z <= world.h;
      const above = !inside || y > surf(x, z);
      if (!above && prevAbove) {
        // bisection refine
        let a = prevT,
          b = t;
        for (let k = 0; k < 18; k++) {
          const m = (a + b) / 2;
          const mx = o.x + d.x * m,
            my = o.y + d.y * m,
            mz = o.z + d.z * m;
          if (my > surf(mx, mz)) a = m;
          else b = m;
        }
        const x2 = o.x + d.x * b,
          z2 = o.z + d.z * b;
        const tx = Math.floor(x2),
          ty = Math.floor(z2);
        return {
          x: x2,
          y: surf(x2, z2),
          z: z2,
          tx: world.clampTx(tx),
          ty: world.clampTy(ty),
          water: world.heightAt(x2, z2) < SEA_LEVEL,
        };
      }
      prevAbove = above;
      prevT = t;
      step = Math.min(2.0, 0.25 + t * 0.004);
    }
    // fall back to the sea plane
    if (d.y < 0) {
      const tt = (o.y - SEA_LEVEL) / -d.y;
      const x = o.x + d.x * tt,
        z = o.z + d.z * tt;
      if (x >= 0 && z >= 0 && x < world.w && z < world.h)
        return { x, y: SEA_LEVEL, z, tx: Math.floor(x), ty: Math.floor(z), water: true };
    }
    return null;
  }
}
