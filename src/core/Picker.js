import * as THREE from 'three';
import { SEA_LEVEL } from '../world/constants.js';

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
    this.ray.setFromCamera(this.ndc, this.game.cameraRig.camera);
    return this.intersect(this.ray.ray, includeWater);
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
