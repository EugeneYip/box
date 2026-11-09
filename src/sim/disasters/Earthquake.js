import { TILE, FLORA, FLORA_INFO, SEA_LEVEL, MIN_HEIGHT } from '../../world/constants.js';
import { hurt, play, rand, smooth, honourSurvivors, yearLabel } from './util.js';
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
        // a zigzag rift: each leg kinks left/right of the fault's heading,
        // and the rift is widest near the epicentre, tapering to hairline tips
        let px = x,
          pz = z,
          d = 0,
          zig = Math.random() < 0.5 ? 1 : -1;
        const head = ang + (dir < 0 ? Math.PI : 0);
        const len = radius * rand(0.75, 1.0) * (f ? 0.7 : 1);
        let hw0 = rand(1.6, 2.1) * (f ? 0.8 : 1);
        while (d < len) {
          const step = rand(1.3, 2.3);
          zig = Math.random() < 0.8 ? -zig : zig;
          const a = head + zig * rand(0.35, 0.8) + rand(-0.1, 0.1);
          const nx = px + Math.cos(a) * step,
            nz = pz + Math.sin(a) * step;
          d += step;
          const taper = Math.pow(Math.max(0, 1 - d / len), 0.6);
          const hw1 = Math.max(0.45, (0.5 + 1.6 * taper) * rand(0.7, 1.15) * (f ? 0.8 : 1));
          segs.push({ x0: px, z0: pz, x1: nx, z1: nz, t: d / PROPAGATION, done: false, w: 1 - d / len, hw0, hw1 });
          hw0 = hw1;
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
    fx.shake(this.x, this.z, env * dt * 2.2 * (1.4 + this.r * 0.04) + (Math.random() < vt * 1.8 ? 0.9 * env : 0));
    // ---- rupture propagation ----
    for (const f of this.faults) {
      for (const s of f.segs) {
        if (s.done || s.t > this.t) continue;
        s.done = true;
        this._rupture(s, f.throw);
        s.openedAt = this.t;
        (this._open ||= []).push(s);
      }
    }
    // ---- dust curtains boiling out of the open chasm for the whole event ----
    // (only over freshly opened cracks: the dust clears within ~1 s so the
    // fissures read crisply afterwards)
    if (this._open) this._open = this._open.filter((s) => this.t - s.openedAt < 1.1);
    if (this._open && this._open.length) {
      this._curtain = (this._curtain || 0) + vt * (8 + this._open.length * 1.2) * Math.max(0.35, env) * fx.budget;
      while (this._curtain >= 1) {
        this._curtain -= 1;
        const s = this._open[(Math.random() * this._open.length) | 0];
        const f = Math.random();
        const dx = s.x1 - s.x0,
          dz = s.z1 - s.z0;
        const L = Math.hypot(dx, dz) || 1;
        const sd = Math.random() < 0.5 ? 1 : -1;
        const px = s.x0 + dx * f + (-dz / L) * sd * rand(0.6, 1.4),
          pz = s.z0 + dz * f + (dx / L) * sd * rand(0.6, 1.4);
        const [ctx, cty] = w.tileOf(px, pz);
        if (!w.isLand(ctx, cty)) continue;
        dustPuff(fx, px, w.heightAt(px, pz), pz, rand(1.1, 1.8), { out: rand(0.2, 0.8), up: 3, life: rand(1.2, 1.9), drag: 1.0, ang: Math.atan2(dx / L * sd, -dz / L * sd), ramp: RAMP.DUST_THICK });
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
    if (this.t >= this.duration) {
      honourSurvivors(g, this.x, this.z, this.r, `Survived the great earthquake, ${yearLabel(g)}`, 12);
      return false;
    }
    return true;
  }

  _topple(tx, ty, fl) {
    const g = this.game;
    const w = g.world;
    const x = tx + 0.5,
      z = ty + 0.5;
    const y = w.heightAt(x, z);
    w.setFlora(tx, ty, Math.random() < 0.5 ? FLORA.STUMP : FLORA.NONE);
    const a = Math.random() * Math.PI * 2;
    g.fx.debris.spawn({ x, y: y + 0.6, z, vx: Math.cos(a) * 1.5, vy: 1.5, vz: Math.sin(a) * 1.5, size: rand(0.6, 0.9), color: 0x6a4a30, wood: true, spin: 2.5, life: rand(26, 36) }); // the fallen trunk stays a while
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
    const hwm = (s.hw0 + s.hw1) / 2;
    if (onLand) {
      // a thin near-black core along the deepest part of this leg (kept to
      // the leg's own length so zigzags never overshoot onto the grass)
      const rot = Math.atan2(dz, dx);
      fx.decal({ frame: DF.CRACKLINE, x: mx, z: mz, size: L * 1.25 + hwm * 0.6, rot, life: 170, color: 0x000000, alpha: 0.9, overlay: true, lift: 0.1, fadeIn: 0.0005, fadeOut: 0.9, grain: 0 });
      // sunlit lips: a faint warm highlight just outside both edges
      for (const sd of [1, -1])
        fx.decal({ frame: DF.CRACKLINE, x: mx + nx * sd * (hwm + 0.45), z: mz + nz * sd * (hwm + 0.45), size: L * 1.2, rot, life: 150, additive: true, color: 0xe8d6b0, intensity: 0.28, lift: 0.25, fadeIn: 0.002, fadeOut: 0.85, grain: 0.3 });
      fx.decal({ frame: DF.SOFTDARK, x: mx, z: mz, size: L * 1.2 + hwm * 1.6, life: 120, color: 0x1e1610, alpha: 0.5, fadeIn: 0.001, fadeOut: 0.85, grain: 0.7 });
      // soil spilled along both lips
      for (const sd of [1, -1])
        if (Math.random() < 0.7) fx.decal({ frame: DF.STAIN, x: mx + nx * sd * (hwm + 1.1), z: mz + nz * sd * (hwm + 1.1), size: rand(2.0, 3.0), life: 150, color: 0x4e3620, alpha: 0.65, fadeIn: 0.001, fadeOut: 0.88, grain: 0.8 });
      if (Math.random() < 0.5) fx.decal({ frame: DF.CRACK1, x: mx + nx * rand(-1.5, 1.5) * (hwm + 1), z: mz + nz * rand(-1.5, 1.5) * (hwm + 1), size: rand(2.0, 3.4) * k, life: 140, color: 0x060403, alpha: 0.9, fadeIn: 0.001, fadeOut: 0.88 });
      // thick dust walls erupting along both lips of the rupture
      for (let j = 0; j < fx.k(8); j++) {
        const f = Math.random();
        const sd = Math.random() < 0.5 ? 1 : -1;
        const px = s.x0 + dx * f + nx * sd * hwm * 0.8,
          pz = s.z0 + dz * f + nz * sd * hwm * 0.8;
        dustPuff(fx, px, w.heightAt(px, pz), pz, rand(1.4, 2.4) * k, { out: rand(0.3, 1.0), up: 3.2, life: rand(1.5, 2.4), drag: 1.2, ang: Math.atan2(nz * sd, nx * sd), ramp: RAMP.DUST_THICK });
      }
      if (Math.random() < 0.9) {
        const f = Math.random();
        const px = s.x0 + dx * f,
          pz = s.z0 + dz * f;
        for (let j = 0; j < 2; j++)
          fx.debris.spawn({ x: px, y: w.heightAt(px, pz) + 0.2, z: pz, vx: nx * rand(-2, 2), vy: rand(2.5, 5), vz: nz * rand(-2, 2), size: rand(0.15, 0.35), color: 0x6e6258, life: rand(6, 10) });
      }
    }
    // Chasm: each leg of the zigzag rift is carved as a capsule (rounded at
    // its joints, so legs meet without square corners) whose half-width
    // runs from hw0 to hw1 (wide near the epicentre, hairline at the tips).
    // Edges are broken by per-tile noise; inside, a dark floor between steep
    // lit rock walls; outside, jagged raised lips; one side drops as an
    // offset block (a scarp), fading out toward the tips.
    // Each tile's total change is tracked so overlapping legs never carve
    // the same tile twice.
    const carved = (this._carved ||= new Map());
    const ux = dx / L,
      uz = dz / L;
    const taperK = Math.max(0.35, s.w);
    w.forEachInRadius(mx, mz, L / 2 + Math.max(s.hw0, s.hw1) + 3.6, (tx, ty, dn, i) => {
      const px = tx + 0.5 - s.x0,
        pz = ty + 0.5 - s.z0;
      const along = px * ux + pz * uz;
      const tt = Math.max(0, Math.min(1, along / L));
      const cxp = px - ux * tt * L,
        czp = pz - uz * tt * L;
      const ad = Math.hypot(cxp, czp);
      const side = px * nx + pz * nz;
      const prev = carved.get(i);
      const h0 = prev ? prev.h0 : w.height[i];
      if (h0 < SEA_LEVEL - 0.3) return;
      const jag = hash2(tx, ty, this.seed);
      const jag2 = hash2(tx * 3 + 1, ty * 3 + 7, this.seed + 11);
      // broken edges: the rim wanders by up to about half a tile
      const hw = (s.hw0 + (s.hw1 - s.hw0) * tt) * (0.8 + 0.4 * jag2) + (jag - 0.5) * 0.5;
      let want = 0; // desired total change from the original height
      const inSpan = along > -0.5 && along < L + 0.5;
      if (inSpan && side > hw && side < hw + 3.6) want -= thr * k * 2.2 * taperK * (1 - smooth((side - hw - 2.2) / 1.4));
      if (ad < hw) {
        const depth = (1.9 + 0.9 * jag) * Math.max(0.8, k) * (0.5 + 0.5 * taperK) * (ad < hw * 0.65 ? 1 : 1 - (ad - hw * 0.65) / (hw * 0.35 + 0.01));
        want -= depth;
      } else if (ad < hw + 0.9) want += (0.15 + 0.5 * jag) * k * (1 - (ad - hw) / 0.9);
      const cur = prev ? prev.want : 0;
      const next = Math.abs(want) > Math.abs(cur) ? want : cur;
      if (next === cur) return;
      const floor = h0 >= SEA_LEVEL ? SEA_LEVEL + 0.08 : MIN_HEIGHT;
      w.height[i] = Math.max(floor, Math.max(MIN_HEIGHT, h0 + next));
      carved.set(i, { h0, want: next });
      w.markDirty('height', tx, ty);
      if (ad < hw) {
        // dark scorched floor (the shadowed depths) between rock walls
        const ty2 = ad < hw * 0.65 ? TILE.ASH : TILE.ROCK;
        if (w.type[i] !== ty2) {
          w.type[i] = ty2;
          w.markDirty('type', tx, ty);
        }
        const fl = w.flora[i];
        if (fl && FLORA_INFO[fl].isTree) this._topple(tx, ty, fl);
        else if (fl && fl !== FLORA.BOULDER) w.setFlora(tx, ty, FLORA.NONE);
      } else if (ad < hw + 0.9) {
        // churned soil and broken rock spilled over both lips
        const t = w.type[i];
        if (jag2 > 0.25 && (t === TILE.GRASS || t === TILE.FOREST || t === TILE.SAVANNA || t === TILE.JUNGLE || t === TILE.TUNDRA || t === TILE.FARMLAND)) {
          w.type[i] = TILE.SOIL;
          w.markDirty('type', tx, ty);
        }
        if (!w.flora[i] && jag > 0.55) w.setFlora(tx, ty, jag > 0.93 ? FLORA.BOULDER : FLORA.ROCK_SMALL, 1);
      }
    });
    hurt(g, mx, mz, 2, 18 * k, 45 * k, 'earthquake');
  }
}
