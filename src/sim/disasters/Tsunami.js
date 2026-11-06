import { FLORA, FLORA_INFO, SEA_LEVEL } from '../../world/constants.js';
import { hurt, play, rand } from './util.js';
import { PF, RAMP, TRAIL } from '../../render/fx/Effects.js';
import { WaveMesh } from '../../render/fx/WaveMesh.js';

// Great wave: a long breaking crest rolls in from open water, steepening as
// it reaches the shallows, then surges inland, stripping vegetation,
// battering units and buildings, soaking the ground and putting out fires,
// until its energy is spent against rising ground. Each column of the crest
// carries its own energy, so the wave wraps around headlands and islands.

const N = 44;

function findDeep(w, x, z, dx, dz, max) {
  for (let d = 2; d < max; d += 1) {
    const px = x + dx * d,
      pz = z + dz * d;
    if (px < 1 || pz < 1 || px > w.w - 1 || pz > w.h - 1) return d;
    if (w.heightAt(px, pz) < SEA_LEVEL - 1.8) return d;
  }
  return Infinity;
}

export class Tsunami {
  constructor(ds, x, z, opts = {}) {
    this.ds = ds;
    this.game = ds.game;
    const w = this.game.world;
    // choose the open-sea direction closest to the target
    let best = Infinity,
      bdx = 1,
      bdz = 0;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const dx = Math.cos(a),
        dz = Math.sin(a);
      const d = findDeep(w, x, z, dx, dz, 90);
      if (d < best) {
        best = d;
        bdx = dx;
        bdz = dz;
      }
    }
    if (!isFinite(best)) best = 20;
    this.hx = -bdx;
    this.hz = -bdz;
    const start = Math.min(best + 14, 70);
    this.ox = x + bdx * start;
    this.oz = z + bdz * start;
    this.L = opts.width ?? 40;
    this.A0 = opts.height ?? 1.7;
    this.t = 0;
    this.cols = [];
    for (let i = 0; i < N; i++) {
      const l = (i / (N - 1) - 0.5) * this.L;
      const edge = 1 - Math.pow(Math.abs(i / (N - 1) - 0.5) * 2, 3);
      this.cols.push({ l, s: 0, e: edge, e0: edge, x: 0, z: 0, y: 0, amp: 0, alpha: 0, land: false, hit: 0, spray: Math.random() });
    }
    this.mesh = new WaveMesh(this.game.fx, N);
    this._sound = 0;
    play(this.game, 'splash', { x, z }, 1, 0.5);
  }

  update(vt, dt) {
    const g = this.game;
    const fx = g.fx;
    const w = g.world;
    const { hx, hz } = this;
    const px = -hz,
      pz = hx;
    if (vt > 0) this.t += vt;
    const rise = Math.min(1, this.t / 1.5);
    let alive = 0;
    for (const c of this.cols) {
      const x = this.ox + px * c.l + hx * c.s;
      const z = this.oz + pz * c.l + hz * c.s;
      const gh = w.heightAt(x, z);
      const depth = SEA_LEVEL - gh;
      const onLand = gh >= SEA_LEVEL - 0.05;
      if (vt > 0 && c.e > 0.02) {
        const v = onLand ? 2.6 + 2.4 * c.e : 4.2 + 2.6 * Math.min(1, depth / 4);
        c.s += v * vt;
        if (onLand) {
          c.e -= vt * (0.28 + Math.max(0, gh) * 0.22 + w.slopeAt(Math.floor(x), Math.floor(z)) * 0.12);
          if (!c.land) {
            c.land = true;
            fx.emit('splash', { x, y: SEA_LEVEL, z }, { scale: 1.6 + c.e * 1.5, dir: { x: hx, y: 0.5, z: hz } });
          }
          c.hit -= vt;
          if (c.hit <= 0) {
            c.hit = 0.25;
            this._flood(x, z, c.e);
          }
        }
      }
      const shoal = onLand ? 1.15 : 1 + 1.3 * (1 - Math.min(1, depth / 5));
      const ampT = Math.max(0, c.e) * this.A0 * shoal * rise;
      c.amp += (ampT - c.amp) * Math.min(1, dt * 4);
      c.x = x;
      c.z = z;
      c.y = onLand ? gh - 0.08 : SEA_LEVEL - 0.05;
      c.alpha = Math.min(1, Math.max(0, c.e) * 4) * Math.min(1, this.t * 2);
      if (c.e > 0.02) alive++;
      // crest spray
      if (vt > 0 && c.amp > 0.25) {
        c.spray += vt * (3 + c.amp * 4) * fx.budget;
        while (c.spray >= 1) {
          c.spray -= 1;
          const P = fx.P.reset();
          P.x = x + hx * c.amp * 0.4 + px * rand(-0.5, 0.5);
          P.y = c.y + c.amp * rand(0.7, 1.0);
          P.z = z + hz * c.amp * 0.4 + pz * rand(-0.5, 0.5);
          P.vx = hx * rand(3, 6);
          P.vy = rand(1, 3);
          P.vz = hz * rand(3, 6);
          P.tx = fx.wind.x;
          P.ty = -3;
          P.tz = fx.wind.z;
          P.drag = 1.2;
          P.life = rand(0.8, 1.5);
          P.s0 = 0.4 + c.amp * 0.3;
          P.s1 = 1 + c.amp * 0.7;
          P.rot = Math.random() * 6.28;
          P.frame = PF.SMOKE0 + ((Math.random() * 4) | 0);
          P.ramp = RAMP.SPLASH;
          P.lit = 0.6;
          P.bright = 1.2;
          P.soft = 0.25;
          fx.pSmoke();
        }
      }
    }
    // smooth neighbouring columns so the crest stays continuous
    for (let i = 1; i < N - 1; i++) {
      const a = this.cols[i - 1],
        b = this.cols[i],
        c = this.cols[i + 1];
      b.s += ((a.s + c.s) * 0.5 - b.s) * 0.08;
    }
    this.mesh.build(this.cols, hx, hz);
    if (vt > 0) {
      this._sound -= vt;
      if (this._sound <= 0 && alive) {
        this._sound = 1.2;
        const mid = this.cols[N >> 1];
        play(g, 'splash', { x: mid.x, z: mid.z }, 0.7, 0.6);
      }
      fx.shake(this.cols[N >> 1].x, this.cols[N >> 1].z, 0.25 * dt * Math.min(1, alive / 10));
    }
    return alive > 0 && this.t < 22;
  }

  _flood(x, z, e) {
    const g = this.game;
    const w = g.world;
    const fx = g.fx;
    w.forEachInRadius(x, z, 1.3, (tx, ty, d, i) => {
      if (w.height[i] < SEA_LEVEL) return;
      if (w.wetness) w.wetness[i] = 1;
      if (w.fire[i] > 0) g.disasters?.extinguish(tx, ty);
      const fl = w.flora[i];
      if (!fl || fl === FLORA.BOULDER || fl === FLORA.ROCK_SMALL) return;
      const info = FLORA_INFO[fl];
      if (Math.random() < (info.isTree ? 0.45 * e : 0.8)) {
        w.setFlora(tx, ty, info.isTree && Math.random() < 0.4 ? FLORA.STUMP : FLORA.NONE);
        if (info.isTree)
          fx.debris.spawn({ x: tx + 0.5, y: w.heightAt(tx + 0.5, ty + 0.5) + 0.5, z: ty + 0.5, vx: this.hx * rand(3, 5), vy: rand(1, 3), vz: this.hz * rand(3, 5), size: rand(0.5, 0.8), color: 0x6a4a30, wood: true, trail: TRAIL.NONE, life: rand(6, 9) });
      }
    });
    fx.emit('splash', { x, y: w.heightAt(x, z), z }, { scale: 0.7 + e, dir: { x: this.hx, y: 0.3, z: this.hz } });
    hurt(g, x, z, 1.6, 18 * e, 30 * e, 'tsunami');
  }

  dispose() {
    this.mesh.dispose();
  }
}
