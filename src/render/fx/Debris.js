import * as THREE from 'three';
import { SEA_LEVEL } from '../../world/constants.js';

// Physical debris: real faceted 3D chunks (rocks, splinters) simulated on the
// CPU with gravity, drag, tumbling, bounce and friction against the terrain
// (world.heightAt / normalAt), splashes and sinking in water. Hot chunks
// (meteor fragments, lava bombs) glow through an injected emissive term and
// cool over time; they can leave smoke / fire trails and report landings.

const G = 19; // gravity (world units / s^2), tuned for the diorama scale

function rockGeometry() {
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  const pos = g.getAttribute('position');
  // jitter shared vertices consistently so the chunk stays closed
  const seen = new Map();
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let s = seen.get(k);
    if (!s) {
      const h = Math.sin(i * 12.9898 + seen.size * 78.233) * 43758.5453;
      s = 0.72 + (h - Math.floor(h)) * 0.5;
      seen.set(k, s);
    }
    pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s * 0.8, pos.getZ(i) * s);
  }
  g.computeVertexNormals();
  return g;
}

function woodGeometry() {
  const g = new THREE.BoxGeometry(0.22, 0.22, 1.0, 1, 1, 2);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (Math.abs(z) < 0.1) {
      pos.setX(i, pos.getX(i) * 1.15);
      pos.setY(i, pos.getY(i) * 1.1);
    }
  }
  g.computeVertexNormals();
  return g;
}

export function heatMaterial(color, roughness) {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, flatShading: true });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aHeat;\nvarying float vHeat;\nvarying vec3 vLocalPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeat = aHeat;\nvLocalPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vHeat;\nvarying vec3 vLocalPos;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float h = clamp(vHeat, 0.0, 1.0);
          float veins = 0.55 + 0.45 * sin(vLocalPos.x * 23.0 + vLocalPos.y * 17.0) * sin(vLocalPos.z * 19.0 - vLocalPos.y * 11.0);
          vec3 hot = mix(vec3(0.9, 0.12, 0.01), vec3(1.0, 0.55, 0.12), h) * (h * h) * (3.0 + 4.0 * veins);
          vec3 e = hot + vec3(1.0, 0.85, 0.5) * pow(h, 5.0) * 4.0;
          // soft-clamp the peak: a white-hot speck far above the bloom
          // threshold rings with a halo in the bloom chain
          e /= 1.0 + max(e.r, max(e.g, e.b)) * 0.35;
          totalEmissiveRadiance += e;
          diffuseColor.rgb *= 1.0 - 0.7 * h;
        }`,
      );
  };
  return m;
}

class Pool {
  constructor(scene, geo, mat, capacity, shadows) {
    this.capacity = capacity;
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.heatAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.heatAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aHeat', this.heatAttr);
    this.mesh.count = 0;
    this.mesh.castShadow = shadows;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    const n = capacity;
    this.alive = new Uint8Array(n);
    this.p = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3);
    this.axis = new Float32Array(n * 3);
    this.ang = new Float32Array(n);
    this.angV = new Float32Array(n);
    this.scale = new Float32Array(n);
    this.heat = new Float32Array(n);
    this.cool = new Float32Array(n);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.rest = new Float32Array(n);
    this.trail = new Uint8Array(n);
    this.trailAcc = new Float32Array(n);
    this.flags = new Uint8Array(n); // 1 = landed once, 2 = in water
    this.col = new Float32Array(n * 3);
    this.onLand = new Array(n).fill(null);
    this.cursor = 0;
    this.live = 0;
  }
  alloc() {
    for (let k = 0; k < this.capacity; k++) {
      const i = (this.cursor + k) % this.capacity;
      if (!this.alive[i]) {
        this.cursor = (i + 1) % this.capacity;
        return i;
      }
    }
    // steal the oldest-looking slot
    const i = this.cursor;
    this.cursor = (i + 1) % this.capacity;
    return i;
  }
  clear() {
    this.alive.fill(0);
    this.onLand.fill(null);
    this.mesh.count = 0;
    this.live = 0;
  }
}

export const TRAIL = Object.freeze({ NONE: 0, DUST: 1, FIRE: 2, LAVA: 3, LEAF: 4 });

export class Debris {
  constructor(fx) {
    this.fx = fx;
    this.game = fx.game;
    const scene = fx.game.scene;
    this.rocks = new Pool(scene, rockGeometry(), heatMaterial(0xffffff, 0.92), 640, true);
    this.wood = new Pool(scene, woodGeometry(), heatMaterial(0xffffff, 0.85), 220, true);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._a = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._pp = new THREE.Vector3();
    this._c = new THREE.Color();
    this._n = { x: 0, y: 1, z: 0 };
  }

  // o: {x,y,z, vx,vy,vz, size, color(hex), heat, cool, life, trail, wood, onLand, spin}
  spawn(o) {
    const pool = o.wood ? this.wood : this.rocks;
    const i = pool.alloc();
    pool.alive[i] = 1;
    const i3 = i * 3;
    pool.p[i3] = o.x;
    pool.p[i3 + 1] = o.y;
    pool.p[i3 + 2] = o.z;
    pool.v[i3] = o.vx || 0;
    pool.v[i3 + 1] = o.vy || 0;
    pool.v[i3 + 2] = o.vz || 0;
    let ax = Math.random() - 0.5,
      ay = Math.random() - 0.5,
      az = Math.random() - 0.5;
    const l = Math.hypot(ax, ay, az) || 1;
    pool.axis[i3] = ax / l;
    pool.axis[i3 + 1] = ay / l;
    pool.axis[i3 + 2] = az / l;
    pool.ang[i] = Math.random() * 6.28;
    pool.angV[i] = (o.spin ?? 6) * (0.4 + Math.random());
    pool.scale[i] = o.size ?? 0.4;
    pool.heat[i] = o.heat ?? 0;
    pool.cool[i] = o.cool ?? 0.12;
    pool.age[i] = 0;
    pool.life[i] = o.life ?? 6 + Math.random() * 4;
    pool.rest[i] = 0;
    pool.trail[i] = o.trail ?? TRAIL.NONE;
    pool.trailAcc[i] = Math.random();
    pool.flags[i] = 0;
    pool.onLand[i] = o.onLand || null;
    this._c.setHex(o.color ?? 0x7a7068);
    const v = 0.85 + Math.random() * 0.3;
    pool.col[i3] = this._c.r * v;
    pool.col[i3 + 1] = this._c.g * v;
    pool.col[i3 + 2] = this._c.b * v;
    return i;
  }

  clear() {
    this.rocks.clear();
    this.wood.clear();
  }

  update(dt) {
    if (dt <= 0) return;
    const steps = dt > 1 / 40 ? 2 : 1;
    const h = dt / steps;
    for (const pool of [this.rocks, this.wood]) this._updatePool(pool, dt, h, steps);
  }

  _updatePool(pool, dt, h, steps) {
    const world = this.game.world;
    const fx = this.fx;
    const n = pool.capacity;
    let count = 0;
    const mesh = pool.mesh;
    const m = this._m,
      q = this._q,
      a = this._a,
      s = this._s,
      pp = this._pp;
    const heatArr = pool.heatAttr.array;
    const colArr = mesh.instanceColor.array;
    for (let i = 0; i < n; i++) {
      if (!pool.alive[i]) continue;
      const i3 = i * 3;
      pool.age[i] += dt;
      const sc0 = pool.scale[i];
      let x = pool.p[i3],
        y = pool.p[i3 + 1],
        z = pool.p[i3 + 2];
      let vx = pool.v[i3],
        vy = pool.v[i3 + 1],
        vz = pool.v[i3 + 2];
      const resting = pool.rest[i] > 0;
      if (!resting) {
        for (let k = 0; k < steps; k++) {
          const inWater = pool.flags[i] & 2;
          const drag = inWater ? 3.5 : 0.08;
          vx -= vx * drag * h;
          vz -= vz * drag * h;
          vy -= (inWater ? G * 0.08 : G) * h + vy * drag * h;
          x += vx * h;
          y += vy * h;
          z += vz * h;
          const gh = world.heightAt(x, z);
          const r = sc0 * 0.4;
          if (gh < SEA_LEVEL && y < SEA_LEVEL && !(pool.flags[i] & 2)) {
            pool.flags[i] |= 2;
            fx.emit('splash', { x, y: SEA_LEVEL, z }, { scale: Math.min(2.2, 0.5 + sc0 * 1.4) });
            if (pool.heat[i] > 0.25) fx.emit('steam', { x, y: SEA_LEVEL + 0.2, z }, { scale: 0.6 + sc0 });
            vx *= 0.3;
            vz *= 0.3;
            vy = Math.max(vy * 0.2, -1.2);
            pool.heat[i] *= 0.3;
          }
          if (y - r < gh) {
            y = gh + r;
            const nn = world.normalAt(x, z, this._n);
            const vn = vx * nn.x + vy * nn.y + vz * nn.z;
            if (vn < 0) {
              const rest = 0.32,
                fr = 0.68;
              // split into normal and tangential parts
              const tx = vx - vn * nn.x,
                ty = vy - vn * nn.y,
                tz = vz - vn * nn.z;
              vx = tx * fr - vn * rest * nn.x;
              vy = ty * fr - vn * rest * nn.y;
              vz = tz * fr - vn * rest * nn.z;
              pool.angV[i] *= 0.7;
              if (!(pool.flags[i] & 1)) {
                pool.flags[i] |= 1;
                const cb = pool.onLand[i];
                if (cb) {
                  try {
                    cb(x, y, z, pool.heat[i], sc0);
                  } catch (e) {
                    console.error('[debris]', e);
                  }
                }
                if (-vn > 3 && sc0 > 0.25 && gh >= SEA_LEVEL) fx.emit('dust', { x, y: gh, z }, { scale: 0.35 + sc0 * 0.6, count: 2 });
              }
            }
            const sp = Math.hypot(vx, vy, vz);
            if (sp < 0.7 && (pool.flags[i] & 1)) {
              pool.rest[i] = 0.001;
              vx = vy = vz = 0;
              break;
            }
          }
          if (inWater && y < gh + r + 0.02) {
            pool.rest[i] = 0.001;
            break;
          }
        }
        pool.ang[i] += pool.angV[i] * dt;
      } else {
        pool.rest[i] += dt;
        // settle into the ground if the ground moved (crater carve, quake)
        const gh = world.heightAt(x, z);
        if (Math.abs(y - (gh + sc0 * 0.35)) > 0.3) {
          pool.rest[i] = 0;
          pool.flags[i] |= 1;
        }
      }
      // cooling
      if (pool.heat[i] > 0) pool.heat[i] = Math.max(0, pool.heat[i] - pool.cool[i] * dt);
      // trails
      const tr = pool.trail[i];
      if (tr && !resting) {
        const sp = Math.hypot(vx, vy, vz);
        pool.trailAcc[i] += dt * (tr === TRAIL.DUST ? 14 : 24) * Math.min(1, sp / 6);
        while (pool.trailAcc[i] > 1) {
          pool.trailAcc[i] -= 1;
          fx._trail(tr, x, y, z, vx, vy, vz, sc0, pool.heat[i]);
        }
      } else if (tr === TRAIL.LAVA && pool.heat[i] > 0.3) {
        pool.trailAcc[i] += dt * 3 * pool.heat[i];
        while (pool.trailAcc[i] > 1) {
          pool.trailAcc[i] -= 1;
          fx._trail(TRAIL.FIRE, x, y + 0.1, z, 0, 0.5, 0, sc0 * 0.6, pool.heat[i] * 0.6);
        }
      }
      pool.p[i3] = x;
      pool.p[i3 + 1] = y;
      pool.p[i3 + 2] = z;
      pool.v[i3] = vx;
      pool.v[i3 + 1] = vy;
      pool.v[i3 + 2] = vz;
      // fade by shrinking at end of life, sink if underwater
      const life = pool.life[i],
        age = pool.age[i];
      let sc = sc0;
      const tail = life - age;
      if (tail < 1.2) sc *= Math.max(0, tail / 1.2);
      if (pool.flags[i] & 2) sc *= Math.max(0, 1 - pool.rest[i] * 0.8);
      if (age >= life || sc <= 0.001 || y < -12) {
        pool.alive[i] = 0;
        pool.onLand[i] = null;
        continue;
      }
      a.set(pool.axis[i3], pool.axis[i3 + 1], pool.axis[i3 + 2]);
      q.setFromAxisAngle(a, pool.ang[i]);
      s.set(sc, sc, sc);
      pp.set(x, y, z);
      m.compose(pp, q, s);
      m.toArray(mesh.instanceMatrix.array, count * 16);
      heatArr[count] = pool.heat[i];
      colArr[count * 3] = pool.col[i3];
      colArr[count * 3 + 1] = pool.col[i3 + 1];
      colArr[count * 3 + 2] = pool.col[i3 + 2];
      count++;
    }
    mesh.count = count;
    mesh.visible = count > 0;
    pool.live = count;
    if (count) {
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, count * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.clearUpdateRanges();
      mesh.instanceColor.addUpdateRange(0, count * 3);
      mesh.instanceColor.needsUpdate = true;
      pool.heatAttr.clearUpdateRanges();
      pool.heatAttr.addUpdateRange(0, count);
      pool.heatAttr.needsUpdate = true;
    }
  }
}
