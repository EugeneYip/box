import { TILE, FLORA, FLORA_INFO, SEA_LEVEL, MIN_HEIGHT } from '../../world/constants.js';
import { hurt, play, rand, smooth } from './util.js';
import { hash2 } from '../../core/Random.js';
import { DF, RAMP, TRAIL, dustPuff } from '../../render/fx/Effects.js';

// Earthquake: rolling tremor with camera shake. Fault lines rupture outward
// from the epicentre at a few tiles per second: the ground splits (crack
// decals), one side of the fault drops into a scarp, rubble dust and rocks
// burst out, trees topple, steep slopes slide and units / buildings take
// damage. Heights along the faults jitter slightly while the ground shakes.

const PROPAGATION = 16; // tiles per second

export class Earthquake {
  constructor(ds, x, z, radius = 14) {
    this.ds = ds;
    this.game = ds.game;
    this.x = x;
    this.z = z;
    this.r = radius;
    this.t = 0;
    this.duration = 9 + radius * 0.1;
    this.seed = (Math.random() * 1e4) | 0;
    this.faults = [];
    const nf = radius >= 12 ? 2 : 1;
    const baseAng = Math.random() * Math.PI;
    for (let f = 0; f < nf; f++) {
      const ang = baseAng + f * (Math.PI / 2 + rand(-0.5, 0.5));
      const thr = rand(0.3, 0.7) * (radius / 14) ** 0.5;
      const segs = [];
      for (const dir of [1, -1]) {
        let px = x,
          pz = z,
          a = ang + (dir < 0 ? Math.PI : 0),
          d = 0;
        const len = radius * rand(0.75, 1.0) * (f ? 0.7 : 1);
        while (d < len) {
          const step = 1.6;
          a += rand(-0.35, 0.35);
          const nx = px + Math.cos(a) * step,
            nz = pz + Math.sin(a) * step;
          d += step;
          segs.push({ x0: px, z0: pz, x1: nx, z1: nz, t: d / PROPAGATION, done: false, w: 1 - d / len });
          px = nx;
          pz = nz;
        }
      }
      segs.sort((a, b) => a.t - b.t);
      this.faults.push({ segs, throw: thr });
    }
    this._jit = 0;
    this._acc = 0;
    play(this.game, 'quake', { x, z }, 1);
    this.game.notify?.('The earth shakes!', 'disaster', { x, z });
  }

  envelope() {
    const t = this.t,
      D = this.duration;
    return Math.min(1, t / 0.5) * (t > D - 2.2 ? Math.max(0, (D - t) / 2.2) : 1) * (0.75 + 0.25 * Math.sin(t * 7.3) * Math.sin(t * 3.1));
  }

  update(vt, dt) {
    if (vt <= 0) return true;
    const g = this.game;
    const fx = g.fx;
    const w = g.world;
    this.t += vt;
    const env = this.envelope();
    // sustain a heavy rolling shake (CameraRig decays at ~2.2/s) plus jolts
    fx.shake(this.x, this.z, env * dt * 2.2 * (1.4 + this.r * 0.04) + (Math.random() < vt * 1.6 ? 0.7 * env : 0));
    // ---- rupture propagation ----
    for (const f of this.faults) {
      for (const s of f.segs) {
        if (s.done || s.t > this.t) continue;
        s.done = true;
        this._rupture(s, f.throw);
      }
    }
    // ---- ambient shaking dust and slides ----
    this._acc += vt * env * (6 + this.r * 0.6) * fx.budget;
    while (this._acc >= 1) {
      this._acc -= 1;
      const a = Math.random() * Math.PI * 2,
        rr = Math.sqrt(Math.random()) * this.r;
      const px = this.x + Math.cos(a) * rr,
        pz = this.z + Math.sin(a) * rr;
      const [tx, ty] = w.tileOf(px, pz);
      if (!w.isLand(tx, ty)) continue;
      const gy = w.heightAt(px, pz);
      dustPuff(fx, px, gy, pz, rand(0.6, 1.2), { out: rand(0.3, 1.2), life: rand(1.5, 2.6), up: 0.6 });
      const sl = w.slopeAt(tx, ty);
      if (sl > 1.2 && Math.random() < 0.5) {
        // landslide: rocks tumble down the slope
        const n = w.normalAt(px, pz);
        for (let k = 0; k < 2; k++)
          fx.debris.spawn({ x: px, y: gy + 0.4, z: pz, vx: n.x * 4 + rand(-1, 1), vy: rand(1, 3), vz: n.z * 4 + rand(-1, 1), size: rand(0.2, 0.45), color: w.type[w.idx(tx, ty)] === TILE.SNOW ? 0xd8dde4 : 0x7a7068, trail: TRAIL.DUST, life: rand(6, 10) });
      }
      // trees topple
      const i = w.idx(tx, ty);
      const fl = w.flora[i];
      if (fl && FLORA_INFO[fl].isTree && Math.random() < 0.18) this._topple(tx, ty, fl);
    }
    // ---- slight height jitter along the faults while shaking ----
    this._jit -= vt;
    if (this._jit <= 0 && env > 0.3) {
      this._jit = 0.3;
      for (const f of this.faults)
        for (const s of f.segs) {
          if (!s.done || Math.random() > 0.35) continue;
          const tx = Math.floor((s.x0 + s.x1) / 2 + rand(-1.5, 1.5)),
            ty = Math.floor((s.z0 + s.z1) / 2 + rand(-1.5, 1.5));
          if (!w.inBounds(tx, ty) || w.isWater(tx, ty)) continue;
          w.setHeight(tx, ty, w.getHeight(tx, ty) + rand(-0.06, 0.06));
        }
    }
    // ---- damage ----
    hurt(g, this.x, this.z, this.r, 2.2 * vt * env, 16 * vt * env, 'earthquake');
    return this.t < this.duration;
  }

  _topple(tx, ty, fl) {
    const g = this.game;
    const w = g.world;
    const x = tx + 0.5,
      z = ty + 0.5;
    const y = w.heightAt(x, z);
    w.setFlora(tx, ty, Math.random() < 0.5 ? FLORA.STUMP : FLORA.NONE);
    const a = Math.random() * Math.PI * 2;
    g.fx.debris.spawn({ x, y: y + 0.6, z, vx: Math.cos(a) * 1.5, vy: 1.5, vz: Math.sin(a) * 1.5, size: rand(0.6, 0.9), color: 0x6a4a30, wood: true, spin: 2.5, life: rand(5, 8) });
    g.fx.emit('leaves', { x, y, z }, { count: 6, color: fl === FLORA.PINE || fl === FLORA.SNOW_PINE ? 0x2f6b3a : 0x4f9a3a });
  }

  _rupture(s, thr) {
    const g = this.game;
    const fx = g.fx;
    const w = g.world;
    const dx = s.x1 - s.x0,
      dz = s.z1 - s.z0;
    const L = Math.hypot(dx, dz) || 1;
    const nx = -dz / L,
      nz = dx / L;
    const mx = (s.x0 + s.x1) / 2,
      mz = (s.z0 + s.z1) / 2;
    const [mtx, mty] = w.tileOf(mx, mz);
    const onLand = w.isLand(mtx, mty);
    const k = 0.5 + 0.5 * s.w;
    if (onLand) {
      // black chasm cracks with a dark bruise of disturbed soil
      fx.decal({ frame: DF.CRACKLINE, x: mx, z: mz, size: L * 2.6, rot: Math.atan2(dz, dx), life: 160, color: 0x040302, alpha: 1, fadeIn: 0.0005, fadeOut: 0.88, grain: 0.2 });
      fx.decal({ frame: DF.SOFTDARK, x: mx, z: mz, size: L * 2.2, life: 120, color: 0x1e1610, alpha: 0.55, fadeIn: 0.001, fadeOut: 0.85, grain: 0.7 });
      if (Math.random() < 0.5) fx.decal({ frame: DF.CRACK1, x: mx + nx * rand(-1.5, 1.5), z: mz + nz * rand(-1.5, 1.5), size: rand(2.4, 4) * k, life: 140, color: 0x060403, alpha: 0.95, fadeIn: 0.001, fadeOut: 0.88 });
      // thick dust walls erupting along both lips of the rupture
      for (let j = 0; j < fx.k(7); j++) {
        const f = Math.random();
        const sd = Math.random() < 0.5 ? 1 : -1;
        const px = s.x0 + dx * f + nx * sd * 1.2,
          pz = s.z0 + dz * f + nz * sd * 1.2;
        dustPuff(fx, px, w.heightAt(px, pz), pz, rand(1.4, 2.4) * k, { out: rand(0.4, 1.2), up: 2.6, life: rand(3, 5), drag: 1.2, ang: Math.atan2(nz * sd, nx * sd), ramp: RAMP.DUST_THICK });
      }
      if (Math.random() < 0.9) {
        const f = Math.random();
        const px = s.x0 + dx * f,
          pz = s.z0 + dz * f;
        for (let j = 0; j < 2; j++)
          fx.debris.spawn({ x: px, y: w.heightAt(px, pz) + 0.2, z: pz, vx: nx * rand(-2, 2), vy: rand(2.5, 5), vz: nz * rand(-2, 2), size: rand(0.15, 0.35), color: 0x6e6258, life: rand(6, 10) });
      }
    }
    // Chasm: the rupture splits open 1.5-2.5 units deep with jagged raised
    // lips; the ground on one side drops as an offset block (a scarp).
    // Each tile's total change is tracked so overlapping segments never
    // carve the same tile twice.
    const carved = (this._carved ||= new Map());
    w.forEachInRadius(mx, mz, 4.6, (tx, ty, dn, i) => {
      const px = tx + 0.5 - mx,
        pz = ty + 0.5 - mz;
      const along = (px * dx + pz * dz) / L;
      if (Math.abs(along) > L * 0.75) return;
      const prev = carved.get(i);
      const h0 = prev ? prev.h0 : w.height[i];
      if (h0 < SEA_LEVEL - 0.3) return;
      const side = px * nx + pz * nz;
      const ad = Math.abs(side);
      const jag = hash2(tx, ty, this.seed);
      let want = 0; // desired total change from the original height
      if (side > 0.7 && side < 4.2) want -= thr * k * 1.5 * (1 - smooth((side - 2.8) / 1.4));
      if (ad < 1.0) {
        const depth = (1.5 + 1.0 * jag) * k * (1 - (ad / 1.0) ** 2);
        want -= depth;
      } else if (ad < 1.8) want += (0.15 + 0.4 * jag) * k * (1 - (ad - 1.0) / 0.8);
      const cur = prev ? prev.want : 0;
      const next = Math.abs(want) > Math.abs(cur) ? want : cur;
      if (next === cur) return;
      const floor = h0 >= SEA_LEVEL ? SEA_LEVEL + 0.08 : MIN_HEIGHT;
      w.height[i] = Math.max(floor, Math.max(MIN_HEIGHT, h0 + next));
      carved.set(i, { h0, want: next });
      w.markDirty('height', tx, ty);
      if (ad < 1.0) {
        if (w.type[i] !== TILE.ROCK) {
          w.type[i] = TILE.ROCK;
          w.markDirty('type', tx, ty);
        }
        const fl = w.flora[i];
        if (fl && FLORA_INFO[fl].isTree) this._topple(tx, ty, fl);
        else if (fl && fl !== FLORA.BOULDER) w.setFlora(tx, ty, FLORA.NONE);
      } else if (ad < 1.8 && !w.flora[i] && jag > 0.82) w.setFlora(tx, ty, FLORA.ROCK_SMALL, 1);
    });
    hurt(g, mx, mz, 2, 18 * k, 45 * k, 'earthquake');
  }
}
