import * as THREE from 'three';
import { SEA_LEVEL } from '../../world/constants.js';
import { carveCrater, hurt, play, rand } from './util.js';
import { PF, DF, RAMP, TRAIL, glowFlash, sparks, smokePuff, dustPuff } from '../../render/fx/Effects.js';

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
    sharedMat = new THREE.MeshStandardMaterial({ color: 0x2a221e, emissive: 0xff6a1a, emissiveIntensity: 2.2, roughness: 0.8, flatShading: true });
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
    // approach from a random azimuth, biased to cross the view diagonally
    const yaw = g.cameraRig?.cur?.yaw ?? 0;
    const az = opts.azimuth ?? yaw + Math.PI * (0.55 + Math.random() * 0.9) * (Math.random() < 0.5 ? 1 : -1);
    const elev = THREE.MathUtils.degToRad(opts.elevation ?? rand(32, 48));
    const D = 70 + this.size * 7;
    this.dir = new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev));
    this.start = new THREE.Vector3(x, this.ty, z).addScaledVector(this.dir, D);
    this.end = new THREE.Vector3(x, this.ty, z);
    this.T = opts.flight ?? 1.25 + this.size * 0.04;
    this.t = -(opts.delay || 0);
    this.mesh = meteorMesh();
    this.radius = 0.45 + this.size * 0.16;
    this.mesh.scale.setScalar(this.radius);
    this.mesh.visible = false;
    g.scene.add(this.mesh);
    this.prev = this.start.clone();
    this.pos = this.start.clone();
    this._played = false;
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
      P.bright = 3.4;
      P.add = 1;
      P.soft = 0;
      fx.pGlow();
      // long smoke trail
      if (Math.random() < 0.7)
        smokePuff(fx, px, py, pz, { size: 0.5 + r * 0.8, ramp: RAMP.HOT_SMOKE, glow: 1.4, rise: 0.25, drift: 1.2, life: rand(3.5, 6), vx: dx * 0.6, vy: dy * 0.2, vz: dz * 0.6 });
    }
    // bright head + sparks shed sideways
    glowFlash(fx, this.pos.x, this.pos.y, this.pos.z, r * 6, { life: 0.09, bright: 4.5, ramp: RAMP.FLASH, color: 0xffd8a0, from: 0.9, soft: 0 });
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
    fx.screenFlash(water ? 0xe0f0ff : 0xfff0d0, 0.55 + s * 0.25);
    fx.addLight({ x, y: y + 3, z }, 0xffc080, 6 + s * 4, 1.4);
    fx.shake(x, z, 1.1 + s * 0.6);
    fx.shockwave(x, z, size * 3.2, { life: 0.8, color: water ? 0xd8f0ff : 0xffe0b0 });
    fx.shell(x, y, z, size * 2.6, { life: 0.45, color: 0xfff0d8, intensity: 3, squash: 0.65 });
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
    fx.decal({ frame: DF.CRATER, x, z, size: R * 2.7, life: 160, color: 0x15100d, alpha: 0.92, fadeIn: 0.0005, fadeOut: 0.85, grain: 0.7 });
    fx.decal({ frame: DF.SCORCH0, x, z, size: R * 4.4, life: 120, color: 0x1e1712, alpha: 0.6, fadeIn: 0.0005, fadeOut: 0.8, grain: 0.8 });
    // molten floor that cools from yellow to dull red over ~30 s
    fx.decal({ frame: DF.CRATER, x, z, size: R * 2.5, life: 32, additive: true, color: 0xffb050, intensity: 2.2, cool: 1.15, fadeIn: 0.002, fadeOut: 0.55, grain: 0.5 });
    fx.decal({ frame: DF.CRACK0, x, z, size: R * 3.4, life: 18, additive: true, color: 0xff7a20, intensity: 1.6, cool: 1.2, fadeIn: 0.003, fadeOut: 0.4, grain: 0.3 });
    // rising mushroom of smoke from the crater
    fx.emit('smoke', { x, y: y + 0.5, z }, { scale: 1.4 + s, count: 1, duration: 3.5, rate: 7 });
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
