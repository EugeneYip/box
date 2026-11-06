import * as THREE from 'three';
import { SEA_LEVEL, TILE, FLORA_INFO } from '../../world/constants.js';
import { poseFlyer, poseFish } from './poses.js';

// Purely visual wildlife (not simulation units): boids flocks of gulls over
// coasts and songbirds over forests, and fish schools in coastal shallows.
// Public: game.unitRenderer.ambient.addFlock(type, x, z), addSchool(x, z), scare(x, z, r)
const TAU = Math.PI * 2;

const SONG_COLORS = [
  [0x8a5a3a, 0xe8603a, 0x6a4a34], // robin
  [0x3a6ac8, 0xf0e8d8, 0x2a4a90], // bluebird
  [0xe8c23a, 0xf4e070, 0x5a4a20], // finch
  [0x6a6a5a, 0xd8d0b8, 0x4a4a40], // sparrow
  [0xc83a3a, 0xd85a4a, 0x7a2a2a], // cardinal
];
const GULL_COLORS = [
  [0xb8c0c8, 0x2a2a2e],
  [0xa8b0b8, 0x343438],
  [0xd0d4d8, 0x5a5a60],
];
const FISH_COOL = [
  [0x4a6a7a, 0xdfe8ec, 0x6a8a9a],
  [0x5a6a4a, 0xe8e4cc, 0x7a7a5a],
  [0x3a5a8a, 0xe0e8f0, 0x5a7aa0],
];
const FISH_WARM = [
  [0xf08a2a, 0xfff0d8, 0xf8c060],
  [0x2a8ad8, 0xf0f4ff, 0xf8d040],
  [0xe8d040, 0xfffbe0, 0xf09030],
  [0xd84a6a, 0xfbe8ea, 0xf0a0b0],
];

function hex(h) {
  const c = new THREE.Color(h).convertSRGBToLinear();
  return [c.r, c.g, c.b];
}

export class AmbientFauna {
  constructor(game, renderer) {
    this.game = game;
    this.r = renderer;
    this.flocks = [];
    this.schools = [];
    this.inited = false;
    this._P = new Float32Array(16);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this.rng = Math.random;
    game.events.on('world:regenerated', () => this.reset());
    game.events.on('power:apply', (p) => {
      if (p && p.x != null && p.power && p.power.category !== 'life') this.scare(p.x, p.z, 10 + (p.radius || 0));
    });
  }
  reset() {
    this.flocks.length = 0;
    this.schools.length = 0;
    this.inited = false;
  }

  _init() {
    this.inited = true;
    const w = this.game.world;
    const scale = (w.w * w.h) / 65536;
    const coast = [],
      forest = [],
      shallows = [];
    for (let k = 0; k < 6000; k++) {
      const tx = Math.floor(Math.random() * w.w),
        ty = Math.floor(Math.random() * w.h);
      const i = w.idx(tx, ty);
      const h = w.height[i];
      if (h >= SEA_LEVEL && w.isCoastal(tx, ty)) coast.push([tx + 0.5, ty + 0.5]);
      if (h >= SEA_LEVEL && (w.type[i] === TILE.FOREST || w.type[i] === TILE.JUNGLE || FLORA_INFO[w.flora[i]].isTree)) forest.push([tx + 0.5, ty + 0.5]);
      if (h < SEA_LEVEL - 0.35 && h > SEA_LEVEL - 2.4 && this._nearLand(tx, ty, 4)) shallows.push([tx + 0.5, ty + 0.5]);
    }
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    for (let i = 0; i < Math.round(5 * scale) && coast.length; i++) this.addFlock('gull', ...pick(coast));
    for (let i = 0; i < Math.round(7 * scale) && forest.length; i++) this.addFlock('song', ...pick(forest));
    for (let i = 0; i < Math.round(14 * scale) && shallows.length; i++) this.addSchool(...pick(shallows));
  }
  _nearLand(tx, ty, r) {
    const w = this.game.world;
    for (let k = 0; k < 10; k++) {
      const x = tx + Math.round((Math.random() * 2 - 1) * r),
        y = ty + Math.round((Math.random() * 2 - 1) * r);
      if (w.inBounds(x, y) && !w.isWater(x, y)) return true;
    }
    return false;
  }

  addFlock(type, x, z) {
    const n = type === 'gull' ? 3 + Math.floor(Math.random() * 4) : 6 + Math.floor(Math.random() * 7);
    const pal = type === 'gull' ? GULL_COLORS : SONG_COLORS;
    const flock = { type, x, z, vx: 0, vz: 0, tx: x, tz: z, birds: [], mode: 'fly', modeT: 8 + Math.random() * 10, scared: 0 };
    const col = pal[Math.floor(Math.random() * pal.length)];
    for (let i = 0; i < n; i++) {
      const c = type === 'song' && Math.random() < 0.35 ? pal[Math.floor(Math.random() * pal.length)] : col;
      flock.birds.push({
        x: x + (Math.random() - 0.5) * 3,
        y: this._ground(x, z) + 4 + Math.random() * 2,
        z: z + (Math.random() - 0.5) * 3,
        vx: (Math.random() - 0.5) * 2,
        vy: 0,
        vz: (Math.random() - 0.5) * 2,
        phase: Math.random() * TAU,
        seed: Math.random(),
        flapT: Math.random() * 3,
        flap: 1,
        alt: type === 'gull' ? 4.5 + Math.random() * 3.5 : 2.4 + Math.random() * 1.8,
        landed: false,
        peck: false,
        heading: 0,
        bank: 0,
        ap: { a: hex(c[0]), b: hex(c[1]), c: hex(c[2] ?? c[1]), sec: 0, var: [0, 0, 0, Math.random()] },
      });
    }
    this._newTarget(flock);
    this.flocks.push(flock);
    return flock;
  }

  addSchool(x, z, n = null) {
    const w = this.game.world;
    const [tx, ty] = w.tileOf(x, z);
    const warm = w.temperature[w.idx(tx, ty)] > 0.6;
    const pal = warm ? FISH_WARM : FISH_COOL;
    const c = pal[Math.floor(Math.random() * pal.length)];
    const school = { x, z, tx: x, tz: z, fish: [], t: 0, jumpT: 4 + Math.random() * 10 };
    const count = n ?? 7 + Math.floor(Math.random() * 8);
    const size = 0.8 + Math.random() * 0.5;
    for (let i = 0; i < count; i++) {
      school.fish.push({
        x: x + (Math.random() - 0.5) * 2,
        z: z + (Math.random() - 0.5) * 2,
        y: SEA_LEVEL - 0.3 - Math.random() * 0.25,
        vx: Math.random() - 0.5,
        vz: Math.random() - 0.5,
        phase: Math.random() * TAU,
        speed: 0,
        size: size * (0.85 + Math.random() * 0.3),
        jump: -1,
        heading: 0,
        ap: { a: hex(c[0]), b: hex(c[1]), c: hex(c[2]), sec: 0, var: [0, 0, 0, Math.random()] },
      });
    }
    this._fishTarget(school);
    this.schools.push(school);
    return school;
  }

  scare(x, z, r = 10) {
    for (const f of this.flocks) {
      if ((f.x - x) ** 2 + (f.z - z) ** 2 > r * r) continue;
      f.scared = 4;
      f.mode = 'fly';
      const a = Math.atan2(f.x - x, f.z - z);
      f.tx = Math.min(this.game.world.w - 4, Math.max(4, f.x + Math.sin(a) * 30));
      f.tz = Math.min(this.game.world.h - 4, Math.max(4, f.z + Math.cos(a) * 30));
      for (const b of f.birds) {
        b.landed = false;
        b.vy += 2.5;
        b.flap = 1;
      }
    }
  }

  _ground(x, z) {
    return Math.max(SEA_LEVEL, this.game.world.heightAt(x, z));
  }
  _newTarget(f) {
    const w = this.game.world;
    for (let t = 0; t < 20; t++) {
      const a = Math.random() * TAU,
        r = 8 + Math.random() * 22;
      const x = f.x + Math.sin(a) * r,
        z = f.z + Math.cos(a) * r;
      const [tx, ty] = w.tileOf(x, z);
      if (!w.inBounds(tx, ty) || x < 4 || z < 4 || x > w.w - 4 || z > w.h - 4) continue;
      const i = w.idx(tx, ty);
      if (f.type === 'gull' ? w.height[i] < 1.5 && (w.isCoastal(tx, ty) || (w.isWater(tx, ty) && this._nearLand(tx, ty, 6))) : w.height[i] >= SEA_LEVEL && w.height[i] < 9) {
        f.tx = x;
        f.tz = z;
        return;
      }
    }
    f.tx = f.x + (Math.random() - 0.5) * 10;
    f.tz = f.z + (Math.random() - 0.5) * 10;
  }
  _fishTarget(s) {
    const w = this.game.world;
    for (let t = 0; t < 20; t++) {
      const x = s.x + (Math.random() - 0.5) * 16,
        z = s.z + (Math.random() - 0.5) * 16;
      const [tx, ty] = w.tileOf(x, z);
      if (!w.inBounds(tx, ty)) continue;
      const h = w.height[w.idx(tx, ty)];
      if (h < SEA_LEVEL - 0.4 && h > SEA_LEVEL - 2.6) {
        s.tx = x;
        s.tz = z;
        return;
      }
    }
  }

  update(dt, ctx) {
    if (!this.inited) this._init();
    const g = this.game;
    const sdt = Math.min(0.1, dt * (g.paused ? 0 : Math.min(4, g.speed)));
    const now = ctx.now;
    const day = g.env?.daylight ?? 1;
    for (const f of this.flocks) this._flock(f, sdt, now, day, ctx);
    for (const s of this.schools) this._school(s, sdt, now, ctx);
  }

  _flock(f, dt, now, day, ctx) {
    const w = this.game.world;
    const gull = f.type === 'gull';
    const model = this.r.model(gull ? 'gull' : 'songbird');
    // flock leader point
    const dx = f.tx - f.x,
      dz = f.tz - f.z;
    const d = Math.hypot(dx, dz);
    const sp = (gull ? 2.0 : 2.8) * (f.scared > 0 ? 2 : 1);
    f.scared = Math.max(0, f.scared - dt);
    if (d < 2) this._newTarget(f);
    else {
      f.vx += ((dx / d) * sp - f.vx) * Math.min(1, dt * 0.8);
      f.vz += ((dz / d) * sp - f.vz) * Math.min(1, dt * 0.8);
    }
    // songbirds land in meadows by day and roost at night
    f.modeT -= dt;
    if (!gull) {
      if (day < 0.15 && f.mode === 'fly') {
        f.mode = 'land';
        f.modeT = 30;
      } else if (f.modeT <= 0) {
        f.mode = f.mode === 'fly' && day > 0.2 ? 'land' : 'fly';
        f.modeT = f.mode === 'land' ? 6 + Math.random() * 8 : 12 + Math.random() * 16;
        if (f.mode === 'fly') this._newTarget(f);
      }
      if (f.mode === 'land' && day < 0.15) f.modeT = Math.max(f.modeT, 5);
    }
    const landing = f.mode === 'land' && f.scared <= 0;
    if (!landing) {
      f.x += f.vx * dt;
      f.z += f.vz * dt;
    }
    const birds = f.birds;
    let cx = 0,
      cz = 0,
      avx = 0,
      avz = 0;
    for (const b of birds) {
      cx += b.x;
      cz += b.z;
      avx += b.vx;
      avz += b.vz;
    }
    cx /= birds.length;
    cz /= birds.length;
    avx /= birds.length;
    avz /= birds.length;
    const P = this._P;
    for (let i = 0; i < birds.length; i++) {
      const b = birds[i];
      const ground = this._ground(b.x, b.z);
      if (landing) {
        // glide down and hop about
        if (!b.landed) {
          const ty = ground + 0.02;
          b.vx += (f.x + Math.sin(i * 2.4) * 1.2 - b.x) * dt * 1.5 - b.vx * dt * 1.5;
          b.vz += (f.z + Math.cos(i * 2.4) * 1.2 - b.z) * dt * 1.5 - b.vz * dt * 1.5;
          b.vy += (ty - b.y) * dt * 3 - b.vy * dt * 2;
          if (b.y - ground < 0.08 && w.height[w.idx(...w.tileOf(b.x, b.z))] >= SEA_LEVEL) {
            b.landed = true;
            b.vx = b.vy = b.vz = 0;
          }
        } else {
          b.y = ground + 0.02;
          b.hopT = (b.hopT ?? Math.random() * 2) - dt;
          if (b.hopT <= 0) {
            b.hopT = 0.6 + Math.random() * 1.8;
            b.peck = Math.random() < 0.5;
            const a = Math.random() * TAU;
            b.hopX = Math.sin(a) * 0.15;
            b.hopZ = Math.cos(a) * 0.15;
            b.hopAt = now;
            b.heading = a;
          }
          const ht = now - (b.hopAt ?? -9);
          if (ht < 0.25) {
            b.x += (b.hopX * dt) / 0.25;
            b.z += (b.hopZ * dt) / 0.25;
            b.y = ground + 0.02 + Math.sin((ht / 0.25) * Math.PI) * 0.05;
          }
        }
      } else {
        b.landed = false;
        // boids: cohesion, alignment, separation, seek the leader point
        let sx = 0,
          sz = 0,
          sy = 0;
        for (let j = 0; j < birds.length; j++) {
          if (j === i) continue;
          const o = birds[j];
          const ex = b.x - o.x,
            ey = b.y - o.y,
            ez = b.z - o.z;
          const dd = ex * ex + ey * ey + ez * ez;
          const minD = gull ? 0.9 : 0.4;
          if (dd < minD * minD && dd > 1e-5) {
            const k = (minD - Math.sqrt(dd)) / minD;
            sx += ex * k * 6;
            sy += ey * k * 6;
            sz += ez * k * 6;
          }
        }
        const lx = f.x + Math.sin(now * 0.5 + i) * (gull ? 2.2 : 1.0),
          lz = f.z + Math.cos(now * 0.43 + i * 1.7) * (gull ? 2.2 : 1.0);
        const ax = (cx - b.x) * 0.4 + (avx - b.vx) * 0.6 + sx + (lx - b.x) * 0.9;
        const az = (cz - b.z) * 0.4 + (avz - b.vz) * 0.6 + sz + (lz - b.z) * 0.9;
        const ty = Math.max(ground + b.alt, (gull ? SEA_LEVEL : ground) + b.alt);
        b.vx += ax * dt;
        b.vz += az * dt;
        b.vy += ((ty - b.y) * 1.2 - b.vy * 0.8 + sy) * dt;
        const spd = Math.hypot(b.vx, b.vz);
        const maxS = sp * 1.5,
          minS = gull ? 1.2 : 1.6;
        if (spd > maxS) {
          b.vx *= maxS / spd;
          b.vz *= maxS / spd;
        } else if (spd < minS && spd > 1e-4) {
          b.vx *= minS / spd;
          b.vz *= minS / spd;
        }
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.z += b.vz * dt;
        if (b.y < ground + 0.3) b.y = ground + 0.3;
        const h = Math.atan2(b.vx, b.vz);
        let dh = h - b.heading;
        while (dh > Math.PI) dh -= TAU;
        while (dh < -Math.PI) dh += TAU;
        b.heading += dh * Math.min(1, dt * 6);
        b.bank += (-dh * 2.5 - b.bank) * Math.min(1, dt * 4);
        // flapping rhythm: gulls glide a lot, songbirds bound (flap bursts)
        b.flapT -= dt;
        if (b.flapT <= 0) {
          b.flap = b.flap > 0.5 ? 0 : 1;
          b.flapT = gull ? (b.flap ? 0.8 + Math.random() * 1.2 : 1.5 + Math.random() * 3) : b.flap ? 0.35 + Math.random() * 0.3 : 0.15 + Math.random() * 0.2;
          if (b.vy > 0.4 || f.scared > 0) b.flap = 1;
        }
        b.phase += dt * (gull ? 9 : 26) * (b.flap > 0.5 ? 1 : 0);
      }
      // render
      if (!ctx.visible(b.x, b.y, b.z, 0.5)) continue;
      const px = ctx.pixelsPerUnit(b.x, b.y, b.z);
      if (px * (gull ? 0.5 : 0.22) < 1.2) continue;
      poseFlyer(b, P, now, b.flap, Math.max(-1, Math.min(1, b.vy * 0.4)));
      const bm = this.r.pick(model, px * (gull ? 0.5 : 0.22) * 3);
      this._e.set(b.landed ? 0 : -b.vy * 0.15, b.heading, b.landed ? 0 : Math.max(-0.7, Math.min(0.7, b.bank)), 'YXZ');
      this._q.setFromEuler(this._e);
      const s = b.landed && day < 0.15 ? 0.0001 : Math.max(1, 1 + ((this.r.boost || 1) - 1) * 0.6);
      this._m.compose(this._p.set(b.x, b.y + (b.landed ? 0.035 * (gull ? 1.3 : 0.55) : 0), b.z), this._q, this._s.set(s, s, s));
      bm.write(this._m, P, b.ap, 0, 1, 0);
    }
  }

  _school(s, dt, now, ctx) {
    const w = this.game.world;
    const model = this.r.model('fish');
    const P = this._P;
    s.t -= dt;
    const ddx = s.tx - s.x,
      ddz = s.tz - s.z;
    const dd = Math.hypot(ddx, ddz);
    if (dd < 1 || s.t <= 0) {
      this._fishTarget(s);
      s.t = 6 + Math.random() * 8;
    } else {
      s.x += (ddx / dd) * 0.7 * dt;
      s.z += (ddz / dd) * 0.7 * dt;
    }
    s.jumpT -= dt;
    let jumper = -1;
    if (s.jumpT <= 0) {
      s.jumpT = 5 + Math.random() * 14;
      jumper = Math.floor(Math.random() * s.fish.length);
    }
    const fish = s.fish;
    for (let i = 0; i < fish.length; i++) {
      const f = fish[i];
      let sx = 0,
        sz = 0;
      for (let j = 0; j < fish.length; j++) {
        if (j === i) continue;
        const ex = f.x - fish[j].x,
          ez = f.z - fish[j].z;
        const d2 = ex * ex + ez * ez;
        if (d2 < 0.09 && d2 > 1e-6) {
          sx += ex * 5;
          sz += ez * 5;
        }
      }
      const ax = (s.x + Math.sin(now * 0.7 + i * 1.3) * 0.6 - f.x) * 1.2 + sx;
      const az = (s.z + Math.cos(now * 0.6 + i * 2.1) * 0.6 - f.z) * 1.2 + sz;
      f.vx += ax * dt;
      f.vz += az * dt;
      let spd = Math.hypot(f.vx, f.vz);
      if (spd > 1.4) {
        f.vx *= 1.4 / spd;
        f.vz *= 1.4 / spd;
        spd = 1.4;
      }
      let nx = f.x + f.vx * dt,
        nz = f.z + f.vz * dt;
      const [tx, ty] = w.tileOf(nx, nz);
      if (!w.inBounds(tx, ty) || w.height[w.idx(tx, ty)] > SEA_LEVEL - 0.3) {
        f.vx = -f.vx;
        f.vz = -f.vz;
        nx = f.x;
        nz = f.z;
      }
      f.x = nx;
      f.z = nz;
      f.speed = spd;
      f.phase += dt * (6 + spd * 10);
      const h = Math.atan2(f.vx, f.vz);
      let dh = h - f.heading;
      while (dh > Math.PI) dh -= TAU;
      while (dh < -Math.PI) dh += TAU;
      f.heading += dh * Math.min(1, dt * 5);
      // the occasional leap out of the water
      if (i === jumper && f.jump < 0) {
        f.jump = 0;
        if (ctx.near(f.x, f.z, 45)) this.game.fx.emit?.('splash', { x: f.x, y: SEA_LEVEL, z: f.z }, { scale: 0.35 });
        this.r.ripple(f.x, f.z, 0.5);
      }
      let y = f.y,
        pitch = 0;
      if (f.jump >= 0) {
        f.jump += dt / 0.7;
        const t = f.jump;
        y = f.y + Math.sin(t * Math.PI) * 0.75;
        pitch = -Math.cos(t * Math.PI) * 1.1;
        if (t >= 1) {
          f.jump = -1;
          if (ctx.near(f.x, f.z, 45)) this.game.fx.emit?.('splash', { x: f.x, y: SEA_LEVEL, z: f.z }, { scale: 0.4 });
          this.r.ripple(f.x, f.z, 0.6);
        }
      }
      if (!ctx.visible(f.x, y, f.z, 0.3)) continue;
      if (ctx.pixelsPerUnit(f.x, y, f.z) * 0.25 * f.size < 1.5) continue;
      poseFish(f, P);
      const fm = this.r.pick(model, ctx.pixelsPerUnit(f.x, y, f.z) * 0.25 * f.size * 2);
      this._e.set(pitch, f.heading, 0, 'YXZ');
      this._q.setFromEuler(this._e);
      const sc = f.size * 1.25 * Math.max(1, 1 + ((this.r.boost || 1) - 1) * 0.5);
      this._m.compose(this._p.set(f.x, y, f.z), this._q, this._s.set(sc, sc, sc));
      fm.write(this._m, P, f.ap, 0, 1, 0);
    }
  }

  stats() {
    let birds = 0,
      fish = 0;
    for (const f of this.flocks) birds += f.birds.length;
    for (const s of this.schools) fish += s.fish.length;
    return { birds, fish };
  }
}
