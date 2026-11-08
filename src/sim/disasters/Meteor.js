import * as THREE from 'three';
import { SEA_LEVEL, FLORA } from '../../world/constants.js';
import { carveCrater, hurt, play, rand } from './util.js';
import { PF, DF, RAMP, TRAIL, glowFlash, sparks, smokePuff, dustPuff } from '../../render/fx/Effects.js';
import { heatMaterial } from '../../render/fx/Debris.js';

// A meteor streaks in at a shallow angle trailing fire and smoke, then hits:
// white flash, fireball, expanding shock dome + ground ring + dust wall,
// glowing ejecta that arc and bounce, a crater carved into world.height with
// a raised rim and a molten floor that cools, fires around the rim, damage
// and camera shake. Water impacts throw up a towering splash and steam.

let sharedGeo = null;
let sharedMat = null;
function meteorMesh() {
  if (!sharedGeo) {
    sharedGeo = new THREE.IcosahedronGeometry(1, 1);
    const p = sharedGeo.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const s = 0.8 + 0.35 * Math.abs(Math.sin(p.getX(i) * 5.1 + p.getY(i) * 3.3 + p.getZ(i) * 4.7));
      p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s);
    }
    sharedGeo.computeVertexNormals();
    // textured hot rock: per-vertex heat drives glowing veins over a dark,
    // faceted crust (shared heat shader with the debris)
    const heat = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) heat[i] = 0.36 + 0.26 * Math.abs(Math.sin(p.getX(i) * 7.3 + p.getZ(i) * 4.1 - p.getY(i) * 5.7));
    sharedGeo.setAttribute('aHeat', new THREE.BufferAttribute(heat, 1));
    sharedMat = heatMaterial(0x3a302a, 0.85);
  }
  const m = new THREE.Mesh(sharedGeo, sharedMat);
  m.castShadow = true;
  return m;
}

export class Meteor {
  constructor(ds, x, z, opts = {}) {
    this.ds = ds;
    this.game = ds.game;
    const g = this.game;
    this.size = opts.size ?? 4; // crater radius in tiles
    this.x = x;
    this.z = z;
    this.ty = g.world.surfaceAt(x, z);
    this.end = new THREE.Vector3(x, this.ty, z);
    this.start = opts.azimuth != null ? null : this._viewStart();
    if (!this.start) {
      const az = opts.azimuth ?? Math.random() * Math.PI * 2;
      const elev = THREE.MathUtils.degToRad(opts.elevation ?? rand(45, 58));
      this.dir = new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev));
      this.start = this.end.clone().addScaledVector(this.dir, 60 + this.size * 6);
    } else this.dir = this.start.clone().sub(this.end).normalize();
    this.T = opts.flight ?? 1.5 + this.size * 0.04;
    this.t = -(opts.delay || 0);
    this.mesh = meteorMesh();
    this.radius = 0.6 + this.size * 0.18;
    this.mesh.scale.setScalar(this.radius);
    this.mesh.visible = false;
    g.scene.add(this.mesh);
    this.prev = this.start.clone();
    this.pos = this.start.clone();
    this._played = false;
  }

  // Pick a start point so the streak crosses most of the frame: roughly
  // perpendicular to the view direction, 45-60 degrees above the horizon,
  // with the start projected inside the screen near an upper corner.
  _viewStart() {
    const cam = this.game.cameraRig?.camera;
    const rig = this.game.cameraRig;
    if (!cam || !rig) return null;
    cam.updateMatrixWorld();
    const yaw = rig.cur.yaw;
    const fwd = new THREE.Vector2(-Math.sin(yaw), -Math.cos(yaw)); // horizontal view dir
    const right = new THREE.Vector2(Math.cos(yaw), -Math.sin(yaw));
    const d = rig.cur.dist;
    const side = Math.random() < 0.5 ? 1 : -1;
    const v = new THREE.Vector3();
    let best = null,
      bestLen = 0;
    for (const e of [45, 50, 55, 60]) {
      const te = Math.tan(THREE.MathUtils.degToRad(e));
      for (let xs = 0.25; xs <= 1.2; xs += 0.05)
        for (const fs of [0, -0.1, -0.2, -0.3]) {
          const X = xs * d,
            F = fs * d;
          const hd = Math.hypot(X, F);
          // keep the approach within ~35 degrees of perpendicular to the view
          if (Math.abs(F) / hd > 0.57) continue;
          const sx = this.x + right.x * X * side + fwd.x * F;
          const sz = this.z + right.y * X * side + fwd.y * F;
          const sy = this.ty + hd * te;
          v.set(sx, sy, sz).project(cam);
          if (Math.abs(v.x) > 0.92 || v.y > 0.9 || v.y < -0.9 || v.z > 1) continue;
          const len = Math.hypot(v.x, v.y);
          if (len > bestLen) {
            bestLen = len;
            best = new THREE.Vector3(sx, sy, sz);
          }
        }
    }
    return best;
  }

  update(vt) {
    const g = this.game;
    const fx = g.fx;
    if (vt <= 0) return true;
    this.t += vt;
    if (this.t < 0) return true;
    if (!this._played) {
      this._played = true;
      play(g, 'meteor', { x: this.x, z: this.z }, 0.9);
    }
    const u = Math.min(1, this.t / this.T);
    // slight acceleration toward the ground
    const e = u * (0.75 + 0.25 * u);
    this.prev.copy(this.pos);
    this.pos.lerpVectors(this.start, this.end, e);
    this.mesh.visible = true;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.x += vt * 5;
    this.mesh.rotation.y += vt * 3.3;
    // ---- trail: emit along the segment travelled this frame ----
    const seg = this.pos.distanceTo(this.prev);
    const r = this.radius;
    const n = Math.min(24, Math.ceil(seg / (0.35 + r * 0.25)));
    const dx = -this.dir.x,
      dy = -this.dir.y,
      dz = -this.dir.z;
    for (let k = 0; k < n; k++) {
      const f = k / n;
      const px = this.prev.x + (this.pos.x - this.prev.x) * f;
      const py = this.prev.y + (this.pos.y - this.prev.y) * f;
      const pz = this.prev.z + (this.pos.z - this.prev.z) * f;
      // fire sheath
      const P = fx.P.reset();
      P.x = px + rand(-0.15, 0.15) * r;
      P.y = py + rand(-0.15, 0.15) * r;
      P.z = pz + rand(-0.15, 0.15) * r;
      P.vx = dx * 2 + rand(-0.6, 0.6);
      P.vy = dy * 2 + rand(-0.6, 0.6);
      P.vz = dz * 2 + rand(-0.6, 0.6);
      P.drag = 3;
      P.life = rand(0.25, 0.5);
      P.s0 = r * rand(1.6, 2.4);
      P.s1 = r * rand(0.6, 1.0);
      P.rot = Math.random() * 6.28;
      P.spin = rand(-2, 2);
      P.frame = PF.SMOKE0 + ((Math.random() * 4) | 0);
      P.ramp = RAMP.EXPLOSION;
      P.heat = 0.25;
      P.bright = 1.15;
      P.add = 1;
      P.soft = 0;
      fx.pGlow();
      // long dark smoke trail that lingers across the sky
      if (Math.random() < 0.8)
        smokePuff(fx, px, py, pz, { size: 0.7 + r * 0.9, ramp: RAMP.SMOKE_BLACK, glow: 1.2, rise: 0.25, drift: 1.0, life: rand(4.5, 7), vx: dx * 0.6, vy: dy * 0.2, vz: dz * 0.6 });
    }
    // hot rock core inside a velocity-stretched plasma sheath
    const vel = seg / Math.max(vt, 1e-3);
    for (let k = 0; k < 2; k++) {
      const P = fx.P.reset();
      P.x = this.pos.x;
      P.y = this.pos.y;
      P.z = this.pos.z;
      P.vx = dx * vel * 0.35; // along the travel direction: sheath trails behind
      P.vy = dy * vel * 0.35;
      P.vz = dz * vel * 0.35;
      P.tx = P.vx;
      P.ty = P.vy;
      P.tz = P.vz;
      P.drag = 0.02;
      P.life = 0.1;
      P.s0 = r * (k ? 0.4 : 0.85);
      P.a = k ? 1 : 0.6;
      P.s1 = P.s0 * 0.9;
      P.mode = 1;
      P.aspect = 1;
      P.stretch = k ? 0.12 : 0.4;
      P.frame = k ? PF.SPARK : PF.GLOW;
      P.ramp = k ? RAMP.FLASH : RAMP.FIRE;
      P.bright = k ? 0.75 : 0.7;
      P.add = 1;
      P.soft = 0;
      fx.pGlow();
    }
    if (Math.random() < 0.6) sparks(fx, this.pos.x, this.pos.y, this.pos.z, 2, { speed: 4, dir: { x: dx * 0.6, y: dy * 0.6, z: dz * 0.6 }, gravity: 6, size: 1.4 });
    fx.lights.request('meteor' + this.x, this.pos.x, this.pos.y, this.pos.z, this._col || (this._col = new THREE.Color(1, 0.55, 0.22)), 3 + this.size * 0.4, 30);
    if (u >= 1) {
      this.impact();
      return false;
    }
    return true;
  }

  impact() {
    const g = this.game;
    const fx = g.fx;
    const w = g.world;
    const { x, z, size } = this;
    g.scene.remove(this.mesh);
    const ground = w.heightAt(x, z);
    const water = ground < SEA_LEVEL - 0.2;
    const y = Math.max(ground, SEA_LEVEL);
    const s = size / 4; // effect scale
    fx.screenFlash(water ? 0xe0f0ff : 0xffd8a0, 0.45 + s * 0.2);
    fx.addLight({ x, y: y + 3, z }, 0xff9a50, 6 + s * 4, 1.6);
    fx.hitStop(0.08);
    fx.shake(x, z, 1.9 + s * 0.4);
    fx.shockwave(x, z, size * 3.2, { life: 0.8, color: water ? 0xd8f0ff : 0xffe0b0 });
    fx.shell(x, y, z, size * 1.7, { life: 0.32, color: 0xfff0d8, intensity: 1.1, power: 4, squash: 0.6 });
    play(g, 'explosion', { x, z }, 1, 0.8);
    if (water) {
      for (let k = 0; k < 4; k++) fx.emit('splash', { x: x + rand(-1, 1) * s, y: SEA_LEVEL, z: z + rand(-1, 1) * s }, { scale: 2.2 * s + 1 });
      // towering column
      for (let k = 0; k < fx.k(26 * s + 10); k++) {
        const P = fx.P.reset();
        P.x = x + rand(-0.6, 0.6) * s;
        P.y = SEA_LEVEL + 0.2;
        P.z = z + rand(-0.6, 0.6) * s;
        P.vx = rand(-1.5, 1.5) * s;
        P.vy = rand(7, 14) * Math.sqrt(s);
        P.vz = rand(-1.5, 1.5) * s;
        P.drag = 0.6;
        P.ty = -18;
        P.life = rand(1.2, 2.2);
        P.s0 = 0.8 * s + 0.4;
        P.s1 = 2.4 * s + 0.8;
        P.rot = Math.random() * 6.28;
        P.frame = PF.SMOKE0 + ((Math.random() * 4) | 0);
        P.ramp = RAMP.SPLASH;
        P.lit = 0.6;
        P.bright = 1.2;
        P.soft = 0.2;
        fx.pSmoke();
      }
      fx.emit('steam', { x, y: SEA_LEVEL + 0.5, z }, { scale: 2 * s + 1, count: 10, duration: 2.5, rate: 6 });
      for (let k = 0; k < 3; k++)
        fx.decal({ frame: DF.RIPPLE, x, z, size: size * 1.2, grow: 5 + k * 2, life: 3 + k, additive: true, surface: 1, color: 0xd8f4ff, intensity: 0.7, delay: k * 0.35, fadeIn: 0.02, fadeOut: 0.3, grain: 0 });
      carveCrater(g, x, z, size * 0.9, size * 0.5, { rim: size * 0.12 });
      hurt(g, x, z, size * 1.8, 80, 80, 'meteor');
      return;
    }
    // ---- land impact ----
    fx.emit('explosion', { x, y, z }, { scale: 0.8 + s * 1.1 });
    const R = size;
    carveCrater(g, x, z, R, R * 0.55, { ignite: 0.65, rim: R * 0.22 });
    // lighter soot so the carved bowl keeps its shading, plus an ejecta blanket
    fx.decal({ frame: DF.CRATER, x, z, size: R * 2.7, life: 160, color: 0x4a3a2e, alpha: 0.6, fadeIn: 0.0005, fadeOut: 0.85, grain: 0.7, lift: 0.15 });
    fx.decal({ frame: DF.SCORCH0, x, z, size: R * 4.2, life: 120, color: 0x3a2e24, alpha: 0.42, fadeIn: 0.0005, fadeOut: 0.8, grain: 0.8 });
    fx.decal({ frame: DF.BLAST, x, z, size: R * 5.8, life: 140, color: 0x5e4c3a, alpha: 0.38, fadeIn: 0.001, fadeOut: 0.85, grain: 0.9 });
    w.forEachInRadius(x, z, R * 2, (tx, ty, dn, i) => {
      const d = (dn * R * 2) / R;
      if (d > 1.05 && d < 1.9 && w.height[i] >= SEA_LEVEL && !w.flora[i] && w.building[i] < 0 && Math.random() < 0.22) w.setFlora(tx, ty, Math.random() < 0.15 ? FLORA.BOULDER : FLORA.ROCK_SMALL, 1);
    });
    // HDR molten floor + glowing cracks that cool over ~30 s
    fx.decal({ frame: DF.CRATER, x, z, size: R * 2.4, life: 34, additive: true, color: 0xff5a14, intensity: 4.6, cool: 1.05, fadeIn: 0.002, fadeOut: 0.55, grain: 0.6, lift: 0.3 });
    fx.decal({ frame: DF.CRACK0, x, z, size: R * 3.2, life: 30, additive: true, color: 0xff4a10, intensity: 3.2, cool: 1.1, fadeIn: 0.003, fadeOut: 0.5, grain: 0.3, lift: 0.3 });
    this.ds.add(new CraterAftermath(this.ds, x, z, R));
    // glowing ejecta that arc and bounce
    const nd = Math.round(18 + size * 5);
    for (let k = 0; k < nd; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = rand(4, 10) * Math.sqrt(s);
      const hot = Math.random() < 0.55;
      fx.debris.spawn({
        x: x + Math.cos(a) * R * 0.3,
        y: y + 0.5,
        z: z + Math.sin(a) * R * 0.3,
        vx: Math.cos(a) * v,
        vy: rand(6, 14) * Math.sqrt(s),
        vz: Math.sin(a) * v,
        size: rand(0.18, 0.5) * (0.7 + s * 0.4),
        color: hot ? 0x3a302a : 0x6a5e54,
        heat: hot ? rand(0.6, 1) : 0,
        cool: 0.12,
        trail: hot ? TRAIL.FIRE : TRAIL.DUST,
        life: rand(10, 18),
        onLand: hot
          ? (lx, ly, lz, heat) => {
              if (heat > 0.4 && Math.random() < 0.5) g.disasters?.ignite(Math.floor(lx), Math.floor(lz), 0.8);
            }
          : null,
      });
    }
    // dust skirt
    for (let k = 0; k < fx.k(18 + size * 3); k++) {
      const a = Math.random() * Math.PI * 2;
      const rr = R * rand(0.8, 1.6);
      const px = x + Math.cos(a) * rr,
        pz = z + Math.sin(a) * rr;
      dustPuff(fx, px, w.surfaceAt(px, pz), pz, 1 + s * 0.8, { ang: a, out: rand(1, 3), life: rand(3, 6), delay: rand(0, 0.4) });
    }
    hurt(g, x, z, R * 1.9, 140, 260, 'meteor');
  }

  dispose() {
    this.game.scene.remove(this.mesh);
  }
}

// The smouldering crater after a land impact: the molten floor lights its
// surroundings (fading over ~30 s), a dense dark smoke column pours out and
// drifts downwind, and embers keep rising.
class CraterAftermath {
  constructor(ds, x, z, R) {
    this.ds = ds;
    this.game = ds.game;
    this.x = x;
    this.z = z;
    this.R = R;
    this.t = 0;
    this.life = 32;
    this.isAftermath = true; // not a set piece (calamity scheduler may proceed)
    this._acc = 0;
    this._e = 0;
    this._c = new THREE.Color(1, 0.36, 0.08);
  }
  update(vt) {
    if (vt <= 0) return true;
    const g = this.game;
    const fx = g.fx;
    this.t += vt;
    const k = Math.max(0, 1 - this.t / this.life);
    const y = g.world.heightAt(this.x, this.z);
    fx.lights.request('crater' + this.x, this.x, y + 1.6, this.z, this._c, (1 + 3.2 * k * k) * (0.9 + 0.1 * Math.sin(this.t * 9)), 10 + this.R * 2.2);
    // smoke rises from the downwind rim and streams away, keeping the
    // molten crater floor visible from above
    this._acc += vt * (1.5 + 8 * k * k) * fx.budget;
    const wa = Math.atan2(fx.wind.z, fx.wind.x || 1e-3);
    while (this._acc >= 1) {
      this._acc -= 1;
      const a = wa + rand(-1.1, 1.1),
        rr = this.R * rand(0.9, 1.25);
      const px = this.x + Math.cos(a) * rr,
        pz = this.z + Math.sin(a) * rr;
      smokePuff(fx, px, g.world.heightAt(px, pz) + 1.2, pz, {
        size: rand(1.3, 2.1) * (0.7 + this.R * 0.08),
        grow: 3,
        ramp: RAMP.PLUME,
        glow: 1.1 * k,
        rise: rand(4, 5.5),
        drift: 3.4,
        drag: 0.22,
        life: rand(8, 12),
      });
    }
    this._e += vt * 7 * k;
    while (this._e >= 1) {
      this._e -= 1;
      fx.emit('embers', { x: this.x + rand(-1, 1) * this.R * 0.4, y: y + 0.2, z: this.z + rand(-1, 1) * this.R * 0.4 }, { count: 1 });
    }
    return this.t < this.life;
  }
}
