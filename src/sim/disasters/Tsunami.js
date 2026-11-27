import { FLORA, FLORA_INFO, SEA_LEVEL } from '../../world/constants.js';
import { hurt, play, rand } from './util.js';
import { PF, RAMP, TRAIL } from '../../render/fx/Effects.js';
import { WaveMesh } from '../../render/fx/WaveMesh.js';
import { BUILDING_TYPES } from '../civ/catalog.js';

// Great wave: a long breaking crest rolls in from open water, steepening as
// it reaches the shallows, then surges inland, stripping vegetation,
// battering units and buildings, soaking the ground and putting out fires,
// until its energy is spent against rising ground. Each column of the crest
// carries its own energy, so the wave wraps around headlands and islands.
// Low ground lets it run on: it reaches a few tiles further inland over flat
// shore, and a town on low ground takes the brunt (damage scales with its
// share of lowland). A town guarded by levees breaks the wave at its edge.

const N = 44;
const LEVEE_CROWN = 1.0; // wave crest (world units) a levee holds back in full
const TARGET_E = 0.45; // least strength the wave keeps until it reaches the middle of an unguarded town it was sent at
// One wave takes at most about two in five of a town's people (KEEP_PEOPLE
// stay: they cling to roofs and high ground) and about three fifths of its
// building health (KEEP_BUILDINGS of it stands). Round 34: an unguarded low
// town lost 66% of its people and 96% of its building health.
const KEEP_PEOPLE = 0.6;
const KEEP_BUILDINGS = 0.45;

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
    // the town the wave was sent at: without levees it takes at least a
    // strong wave whatever the approach (round 21: an unguarded town lost 3%
    // or 75% by the lie of the ground the wave crossed to reach it)
    try {
      const tv = this.game.civ?.villageAt?.(x, z, 16);
      if (tv && tv.alive !== false && Math.hypot(tv.cx - x, tv.cz - z) <= (tv.radius || 6) + 2) this.tgt = tv;
    } catch (err) {
      this.tgt = null;
    }
    this.mesh = new WaveMesh(this.game.fx, N);
    this._sound = 0;
    this._low = new Map();
    this._pop0 = new Map(); // town id -> its people when the wave first struck (_spare)
    this._hp0 = new Map(); // town id -> its building health when the wave first struck (_standing)
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
          // (flat low shore drains the wave slowly: it carries 2-4 tiles further inland)
          c.e -= vt * (0.17 + Math.max(0, gh) * 0.24 + w.slopeAt(Math.floor(x), Math.floor(z)) * 0.12);
          if (this.tgt && c.e < TARGET_E && this._toTarget(c, x, z)) c.e = TARGET_E;
          if (!c.land) {
            c.land = true;
            fx.emit('splash', { x, y: SEA_LEVEL, z }, { scale: 1.6 + c.e * 1.5, dir: { x: hx, y: 0.5, z: hz } });
          }
          c.hit -= vt;
          if (c.hit <= 0) {
            c.hit = 0.25;
            const lev = this._flood(x, z, c.e);
            // levees break the wave at the town's edge (less of one that
            // overtops them)
            if (lev > 0) c.e *= 1 - 0.55 * lev * (1 - this._over(c.e));
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

  // Is this column bound for the unguarded town the wave was sent at? (its
  // lane takes in the town, and it has not reached the town's middle; past
  // it the wave drains as usual: held up through the whole town at 0.6 it
  // razed 67-100% of an unguarded town)
  _toTarget(c, x, z) {
    const v = this.tgt;
    if (!v.alive || (v.guard?.flood || 0) > 0) return false;
    const r = (v.radius || 6) + 1;
    const tl = (v.cx - this.ox) * -this.hz + (v.cz - this.oz) * this.hx;
    if (Math.abs(c.l - tl) > r) return false;
    return (v.cx - x) * this.hx + (v.cz - z) * this.hz > 0;
  }

  // The town at (x, z), its share of low ground (cached) and its levees.
  _town(x, z) {
    const civ = this.game.civ;
    let v = null;
    try {
      v = civ?.villageAt?.(x, z, 16) || null;
    } catch (err) {
      v = null;
    }
    if (!v || Math.hypot(v.cx - x, v.cz - z) > (v.radius || 6) + 2) return null;
    let low = this._low.get(v.id);
    if (low == null) {
      const w = this.game.world;
      let n = 0,
        lo = 0;
      w.forEachInRadius(v.cx, v.cz, Math.max(5, v.radius || 6), (tx, ty, d, i) => {
        if (w.height[i] < SEA_LEVEL) return;
        n++;
        if (w.height[i] < SEA_LEVEL + 1.2) lo++;
      });
      low = n ? lo / n : 0;
      this._low.set(v.id, low);
    }
    return { v, low, levee: v.guard?.flood || 0 };
  }

  // How far a wave of strength e overtops a town's levees (0..0.5): its
  // crest (A0 x e, 1.7 for a full Great Wave) against the levee's crown at
  // LEVEE_CROWN. A full wave reaching a levee town pours up to a third of
  // its low-ground harm over the wall (less behind a stronger levee: see
  // _flood); a spent or glancing one none.
  _over(e) {
    return Math.max(0, Math.min(0.5, (this.A0 * e - LEVEE_CROWN) / 2));
  }

  _flood(x, z, e) {
    const g = this.game;
    const w = g.world;
    const fx = g.fx;
    const town = this._town(x, z);
    // an unguarded town on low ground takes the full force (up to about four
    // times the open shore's harm to its buildings); levees keep their guard
    // against all but a high wave, which partly overtops them (see _over)
    const low = town ? (town.levee > 0 ? town.low * this._over(e) * (1 - 0.6 * town.levee) : town.low) : 0;
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
    // one wave takes at most about two in five of a town's people: the
    // rest cling to roofs and high ground (round 22: a town of 41 kept 1;
    // round 31: an unguarded low town lost 62% of its people and 92% of its
    // buildings, while a drought barely touched a town). Each person's own
    // town is checked (round 34: its people in the fields and on the shore
    // beyond the town's edge were struck past the cap, 66% in all), and its
    // buildings stop taking harm at KEEP_BUILDINGS of their health
    const r = 1.6 + low * 0.6;
    this._hurtPeople(x, z, r, 15 * e * (1 + low * 1.2));
    // (round 37: each blow is cut to what the town has left above that
    // floor, _keepScale; the blows of one tick's columns, each let through
    // whole while the town still stood above it, took 56-58%)
    const near = town?.v || this._nearTown(x, z);
    const bd = 30 * e * (1 + low * 1.8);
    const s = near ? this._keepScale(near, x, z, r, bd) : 1;
    if (s > 0) hurt(g, x, z, r, 0, bd * s, 'tsunami');
    return town ? town.levee : 0;
  }

  // (round 37) The share of a blow of `amt` within r of (x, z) that town v's
  // buildings may still take without falling below KEEP_BUILDINGS of the
  // health they had when first struck (1: all of it; 0: none). It reckons the
  // blow as Civ damageArea deals it, each building's loss no more than its
  // health.
  _keepScale(v, x, z, r, amt) {
    if (!this._standing(v)) return 0;
    const civ = this.game.civ;
    let hp = 0;
    for (const b of v.buildings || []) if (b.alive) hp += b.hp || 0;
    const left = hp - this._hp0.get(v.id) * KEEP_BUILDINGS;
    if (!(left > 0)) return 0;
    let loss = 0;
    for (const b of v.buildings || []) {
      if (!b.alive) continue;
      const nx = Math.max(b.tx, Math.min(b.tx + b.w, x)),
        nz = Math.max(b.ty, Math.min(b.ty + b.h, z));
      const d = Math.hypot(nx - x, nz - z);
      if (d > r) continue;
      const k = 1 - (d / Math.max(r, 0.001)) * 0.6;
      const g = civ?._bGuard ? civ._bGuard(b, 'tsunami') : 1;
      loss += Math.min(b.hp || 0, amt * k * (BUILDING_TYPES[b.type]?.wall ? 0.5 : 1) * g);
    }
    return loss > left ? left / loss : 1;
  }

  // People within r of (x, z) take the wave's harm, except those of a town
  // that has already lost its share (KEEP_PEOPLE); a protected town's people
  // take shelter (Civ shelterAt).
  _hurtPeople(x, z, r, dmg) {
    const g = this.game;
    const U = g.units;
    if (!U?.query || !(dmg > 0)) return;
    try {
      dmg *= g.civ?.shelterAt?.(x, z, 'tsunami') ?? 1;
    } catch (err) {
      console.error('[disasters] civ.shelterAt', err);
    }
    if (!(dmg > 0)) return;
    for (const u of U.query(x, z, r + 0.5)) {
      if (!u.alive) continue;
      const dx = u.x - x,
        dz = u.z - z;
      const dd = Math.hypot(dx, dz);
      if (dd > r + (u.def?.radius || 0)) continue;
      if (u.village >= 0 && !this._spare(u.village)) continue;
      const l = dd || 1;
      U.damage(u, dmg * (1 - Math.min(1, dd / r) * 0.7), null, { cause: 'tsunami', knock: Math.min(1.5, dmg * 0.02), dirX: dx / l, dirZ: dz / l });
    }
  }

  // May the wave still take people of this town? (more than KEEP_PEOPLE of
  // those it had when first struck are left)
  _spare(vid) {
    const v = this.game.civ?.villages?.[vid];
    if (!v || v.alive === false || !v.members) return true;
    const n = v.members.size;
    let p0 = this._pop0.get(vid);
    if (p0 == null) this._pop0.set(vid, (p0 = n));
    return n > Math.ceil(p0 * KEEP_PEOPLE);
  }

  // Does this town still have more than KEEP_BUILDINGS of the building
  // health it had when first struck?
  _standing(v) {
    let hp = 0;
    for (const b of v.buildings || []) if (b.alive) hp += b.hp || 0;
    let h0 = this._hp0.get(v.id);
    if (h0 == null) this._hp0.set(v.id, (h0 = hp));
    return hp > h0 * KEEP_BUILDINGS;
  }

  // The town whose buildings may stand within reach of (x, z), if any.
  _nearTown(x, z) {
    let v = null;
    try {
      v = this.game.civ?.villageAt?.(x, z, 16) || null;
    } catch (err) {
      v = null;
    }
    return v && Math.hypot(v.cx - x, v.cz - z) <= (v.radius || 6) + 4.5 ? v : null;
  }

  dispose() {
    this.mesh.dispose();
  }
}
