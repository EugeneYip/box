import * as THREE from 'three';
import { TILE, FLORA, FLORA_INFO, SEA_LEVEL } from '../../world/constants.js';
import { hurt, play, rand } from './util.js';
import { PF, DF, RAMP, TRAIL } from '../../render/fx/Effects.js';
import { TornadoFunnel } from '../../render/fx/TornadoFunnel.js';

// Tornado: a swirling funnel that touches down, wanders with the wind,
// uproots trees (flinging logs and leaves), scours a track into the ground,
// damages units and buildings, becomes a waterspout over the sea, and
// finally ropes out and lifts away.

const CORE = 2.4; // damage radius (tiles)

export class Tornado {
  constructor(ds, x, z, opts = {}) {
    this.ds = ds;
    this.game = ds.game;
    this.x = x;
    this.z = z;
    this.t = 0;
    this.life = opts.life ?? 17;
    const w = this.game.env.wind || { x: 1, z: 0 };
    const a = Math.atan2(w.z || 0, w.x || 1) + rand(-0.9, 0.9);
    this.heading = a;
    this.speed = 2.1;
    this.seed = Math.random() * 100;
    this.funnel = new TornadoFunnel(this.game.fx);
    this.strength = 0;
    this._dust = 0;
    this._scar = 0;
    this._uproot = 0;
    this._lastScar = { x, z };
    this._tint = new THREE.Color();
    this._water = 0;
    play(this.game, 'thunder', { x, z }, 0.5, 0.7);
  }

  update(vt, dt) {
    const g = this.game;
    const fx = g.fx;
    const w = g.world;
    if (vt > 0) {
      this.t += vt;
      // strength envelope: touch down, rage, rope out
      const t = this.t,
        L = this.life;
      this.strength = Math.min(1, t / 2.2) * (t > L - 3.5 ? Math.max(0, (L - t) / 3.5) : 1);
      // wander: smooth heading noise + gentle steering back into the map
      this.heading += (Math.sin(t * 0.7 + this.seed) * 0.6 + Math.sin(t * 1.9 + this.seed * 2) * 0.35) * vt;
      const m = 10;
      const tx = this.x < m ? 1 : this.x > w.w - m ? -1 : 0;
      const tz = this.z < m ? 1 : this.z > w.h - m ? -1 : 0;
      if (tx || tz) {
        const want = Math.atan2(tz, tx);
        let d = want - this.heading;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        this.heading += d * Math.min(1, vt * 1.5);
      }
      const sp = this.speed * (0.7 + 0.3 * Math.sin(t * 0.9 + this.seed));
      this.x = THREE.MathUtils.clamp(this.x + Math.cos(this.heading) * sp * vt, 2, w.w - 2);
      this.z = THREE.MathUtils.clamp(this.z + Math.sin(this.heading) * sp * vt, 2, w.h - 2);
    }
    const S = this.strength;
    const ground = w.heightAt(this.x, this.z);
    const water = ground < SEA_LEVEL;
    this._water += ((water ? 1 : 0) - this._water) * Math.min(1, dt * 2);
    const y = Math.max(ground, SEA_LEVEL);
    // funnel visuals (lifts off the ground while roping out)
    const lift = this.t > this.life - 3.5 ? (this.t - (this.life - 3.5)) * 1.8 : 0;
    const bend = 4.4 + Math.sin(this.t * 0.5 + this.seed) * 1.5;
    this._tint.setRGB(1 - this._water * 0.15, 1 - this._water * 0.05, 1 + this._water * 0.25);
    this.funnel.set(this.x, y - 0.2 + lift, this.z, {
      height: 19 - lift * 0.4, // tall and thin: reads as a funnel at a 50-60 degree pitch
      width: 0.55 + 0.45 * S,
      bendX: -Math.cos(this.heading) * bend,
      bendZ: -Math.sin(this.heading) * bend,
      alpha: Math.min(1, S * 1.3),
      seed: this.seed,
      tint: this._tint,
    });
    if (vt <= 0) return true;
    // ---- particles: base skirt, debris spiral, top cloud ----
    const k = fx.budget * S;
    // physical debris chunks whirled around the funnel and flung out
    this._chunks = (this._chunks || 0) + vt * 7 * S;
    while (this._chunks >= 1) {
      this._chunks -= 1;
      const a = Math.random() * Math.PI * 2;
      const rr = rand(1.0, 2.2);
      const tang = a + Math.PI / 2;
      const sp = rand(8, 12);
      fx.debris.spawn({
        x: this.x + Math.cos(a) * rr,
        y: y + rand(1, 9),
        z: this.z + Math.sin(a) * rr,
        vx: Math.cos(tang) * sp - Math.cos(a) * 2 + Math.cos(this.heading) * this.speed,
        vy: rand(3, 7),
        vz: Math.sin(tang) * sp - Math.sin(a) * 2 + Math.sin(this.heading) * this.speed,
        size: rand(0.2, 0.45),
        color: water ? 0x7a8a90 : Math.random() < 0.5 ? 0x5a4a38 : 0x6a6058,
        wood: !water && Math.random() < 0.4,
        spin: 10,
        trail: 0,
        life: rand(4, 7),
      });
    }
    this._dust += dt * 70 * k;
    while (this._dust >= 1) {
      this._dust -= 1;
      const P = fx.P.reset();
      P.mode = 4;
      P.x = this.x;
      P.y = y + 0.05;
      P.z = this.z;
      P.vx = rand(0.6, 1.3); // radius: a tight debris ring at the ground
      P.vy = Math.random() * 6.28;
      P.vz = rand(0.15, 0.8); // rise (kept low so the stem stays visible)
      P.tx = rand(0.6, 1.2); // radius grows
      P.ty = rand(3.5, 5.5); // angular speed
      P.tz = Math.cos(this.heading) * this.speed * 0.6;
      P.tw = Math.sin(this.heading) * this.speed * 0.6;
      P.life = rand(1.0, 1.8);
      P.s0 = rand(0.7, 1.1);
      P.s1 = rand(1.4, 2.1);
      P.rot = Math.random() * 6.28;
      P.spin = rand(-1, 1);
      P.frame = PF.SMOKE0 + ((Math.random() * 4) | 0);
      const overSea = this._water > 0.6; // spray only when truly over water
      P.ramp = overSea ? RAMP.SPLASH : RAMP.DUST_THICK;
      if (!overSea) {
        // darker, earthier skirt churned up at the base
        P.r = 0.5; // dark earthy debris dust
        P.g = 0.42;
        P.b = 0.3;
        P.a = 0.85;
      }
      P.lit = 1;
      P.soft = 0.5;
      fx.pSmoke();
      if (Math.random() < 0.8) {
        // debris spiralling up the funnel
        const Q = fx.P.reset();
        Q.mode = 4;
        Q.x = this.x;
        Q.y = y + rand(0, 1);
        Q.z = this.z;
        Q.vx = rand(0.4, 0.9);
        Q.vy = Math.random() * 6.28;
        Q.vz = rand(3, 7);
        Q.tx = rand(0.15, 0.35);
        Q.ty = rand(5, 8);
        Q.tz = Math.cos(this.heading) * this.speed;
        Q.tw = Math.sin(this.heading) * this.speed;
        Q.life = rand(1.2, 2.4);
        const sz = rand(0.12, 0.32);
        Q.s0 = sz;
        Q.s1 = sz;
        Q.rot = Math.random() * 6.28;
        Q.spin = rand(-8, 8);
        Q.frame = Math.random() < 0.6 ? PF.CHUNK : PF.LEAF;
        Q.ramp = RAMP.SOLID;
        Q.lit = 1;
        Q.soft = 0;
        const c = Q.frame === PF.LEAF ? [0.12, 0.25, 0.06] : water ? [0.7, 0.85, 0.95] : [0.18, 0.14, 0.1];
        Q.r = c[0];
        Q.g = c[1];
        Q.b = c[2];
        fx.pSmoke();
      }
      if (Math.random() < 0.3) {
        // dark rotating cloud at the top
        const C = fx.P.reset();
        C.mode = 4;
        C.x = this.x - Math.cos(this.heading) * bend;
        C.y = y + 18 + rand(-0.6, 1) - lift * 0.4;
        C.z = this.z - Math.sin(this.heading) * bend;
        C.vx = rand(1, 2.6);
        C.vy = Math.random() * 6.28;
        C.vz = rand(-0.2, 0.3);
        C.tx = rand(0.4, 1.2);
        C.ty = rand(0.5, 1.0);
        C.tz = 0;
        C.tw = 0;
        C.life = rand(3, 5);
        C.s0 = rand(1.6, 2.2);
        C.s1 = rand(2.4, 3.2);
        C.rot = Math.random() * 6.28;
        C.spin = 0.3;
        C.frame = PF.SMOKE0 + ((Math.random() * 4) | 0);
        C.ramp = Math.random() < 0.5 ? RAMP.SMOKE_LIGHT : RAMP.SMOKE_DARK;
        C.lit = 1;
        C.soft = 0;
        C.a = 0.75;
        fx.pSmoke();
      }
    }
    // ---- consequences ----
    if (S > 0.25) {
      // uproot trees, flatten crops, scour the ground
      this._uproot += vt * 9 * S;
      while (this._uproot >= 1) {
        this._uproot -= 1;
        const a = Math.random() * Math.PI * 2,
          r = Math.sqrt(Math.random()) * CORE;
        const px = this.x + Math.cos(a) * r,
          pz = this.z + Math.sin(a) * r;
        const [tx, ty] = w.tileOf(px, pz);
        if (!w.isLand(tx, ty)) continue;
        const i = w.idx(tx, ty);
        const fl = w.flora[i];
        if (!fl) continue;
        const info = FLORA_INFO[fl];
        if (fl === FLORA.BOULDER || fl === FLORA.ROCK_SMALL) continue;
        w.setFlora(tx, ty, FLORA.NONE);
        const gy = w.heightAt(px, pz);
        // flung tangentially and upward
        const tang = Math.atan2(pz - this.z, px - this.x) + Math.PI / 2;
        if (info.isTree) {
          for (let j = 0; j < 2; j++)
            fx.debris.spawn({
              x: px,
              y: gy + 0.8,
              z: pz,
              vx: Math.cos(tang) * rand(5, 9) + Math.cos(this.heading) * 2,
              vy: rand(8, 13),
              vz: Math.sin(tang) * rand(5, 9) + Math.sin(this.heading) * 2,
              size: rand(0.5, 0.85),
              color: 0x6a4a30,
              wood: true,
              spin: 9,
              trail: TRAIL.LEAF,
              life: rand(6, 9),
            });
        }
        fx.emit('leaves', { x: px, y: gy, z: pz }, { count: info.isTree ? 8 : 3, dir: { x: Math.cos(tang), y: 1, z: Math.sin(tang) }, color: fl === FLORA.PINE || fl === FLORA.SNOW_PINE ? 0x2f6b3a : fl === FLORA.WHEAT ? 0xd8b850 : 0x4f9a3a });
      }
      this._scar += vt;
      const dx = this.x - this._lastScar.x,
        dz = this.z - this._lastScar.z;
      const dist = Math.hypot(dx, dz);
      if (!water && dist > 1.4) {
        fx.decal({ frame: DF.SCAR, x: (this.x + this._lastScar.x) / 2, z: (this.z + this._lastScar.z) / 2, size: 5.2 * S + 1.5, rot: Math.atan2(dz, dx) + Math.PI / 2, life: 120, color: 0x3a2c20, alpha: 0.7 * S, fadeIn: 0.002, fadeOut: 0.75, grain: 0.7 });
        this._lastScar = { x: this.x, z: this.z };
        const [tx, ty] = w.tileOf(this.x, this.z);
        const t = w.type[w.idx(tx, ty)];
        if ((t === TILE.GRASS || t === TILE.SAVANNA || t === TILE.FARMLAND) && Math.random() < 0.45 * S) w.setType(tx, ty, TILE.SOIL);
      } else if (water) this._lastScar = { x: this.x, z: this.z };
      hurt(g, this.x, this.z, CORE * 1.2, 20 * vt * S, 45 * vt * S, 'tornado');
    }
    // rumble shake when near
    fx.shake(this.x, this.z, 0.6 * dt * S);
    return this.t < this.life;
  }

  dispose() {
    this.funnel.dispose();
  }
}
