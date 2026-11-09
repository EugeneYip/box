import { TILE, TILE_INFO, FLORA, FLORA_INFO, SEA_LEVEL, DIRS8 } from '../../world/constants.js';
import { law, fireFactor, regionName, yearLabel } from './util.js';

// Wildfire simulation on world.fire (0 = not burning, (0..1] intensity).
//
// Each burning tile has fuel (ground cover + vegetation). Intensity climbs
// toward a peak set by the fuel type, then dies back as fuel runs out.
// Spread to the 8 neighbours is driven by neighbour flammability (flora
// dominates the tile's own), wind alignment (strong downwind bias), slope
// (fire runs uphill), wetness and weather. Burning trees with strong wind
// can throw embers several tiles downwind (spotting).
// Consequences: trees -> DEAD_TREE (charred) -> STUMP or NONE; other plants
// are consumed; flammable ground becomes TILE.ASH; buildings in the flames
// are damaged through game.civ.damageArea. Units standing in fire are
// damaged by the core unit sim.
// Cost is bounded: at most BUDGET burning tiles are processed per tick
// (round-robin, with the time step scaled so the fire behaves the same).

const BUDGET = 2600;
const ASH_THRESHOLD = 0.35; // ground flammability that leaves ash behind

export class FireSim {
  constructor(game) {
    this.game = game;
    const n = game.world.size;
    this.n = n;
    this.fuel = new Float32Array(n);
    this.fuel0 = new Float32Array(n);
    this.inList = new Uint8Array(n);
    this.list = new Int32Array(n);
    this.count = 0;
    this.cursor = 0;
    this.smolder = new Float32Array(n);
    this.inSm = new Uint8Array(n);
    this.smList = new Int32Array(n);
    this.smCount = 0;
    this.bTimer = new Float32Array(n); // building damage cadence
    this.version = 0;
    this._dirty = null;
    this._external = null;
    this.rng = game.rng.fork('fire');
    game.events.on('world:fire', (r) => {
      if (this._selfFlush) return;
      this._external = this._external ? union(this._external, r) : { ...r };
    });
  }

  reset() {
    this.fuel.fill(0);
    this.fuel0.fill(0);
    this.inList.fill(0);
    this.count = 0;
    this.smolder.fill(0);
    this.inSm.fill(0);
    this.smCount = 0;
    this.bTimer.fill(0);
    this._external = null;
    this._scan = null;
    this._burned?.clear();
    this.version++;
  }

  // Flammability of a tile right now (0..1).
  flammability(i) {
    const w = this.game.world;
    if (w.height[i] < SEA_LEVEL) return 0;
    const t = w.type[i];
    if (t === TILE.LAVA || t === TILE.ASH) return w.flora[i] && FLORA_INFO[w.flora[i]].flammable ? FLORA_INFO[w.flora[i]].flammable * 0.8 : 0;
    const tf = TILE_INFO[t]?.flammable ?? 0;
    const f = w.flora[i];
    const ff = f ? FLORA_INFO[f]?.flammable ?? 0 : 0;
    let v = Math.max(tf * 0.75, ff * (0.55 + 0.45 * (w.floraGrowth[i] || 0)));
    if (w.building[i] >= 0) v = Math.max(v, 0.65);
    return v;
  }

  fuelFor(i) {
    const w = this.game.world;
    const t = w.type[i];
    const tf = TILE_INFO[t]?.flammable ?? 0;
    let fuel = tf * 0.55;
    const f = w.flora[i];
    if (f) {
      const info = FLORA_INFO[f];
      const gr = w.floraGrowth[i] || 0.5;
      if (info.isTree) fuel += (f === FLORA.DEAD_TREE ? 0.9 : 1.6 + info.wood * 0.22) * (0.4 + 0.6 * gr);
      else fuel += info.flammable * 0.45;
    }
    if (w.building[i] >= 0) fuel += 1.2;
    return fuel;
  }

  // Start (or feed) a fire. Returns true if the tile is now burning.
  ignite(tx, ty, intensity = 1, opts = {}) {
    const w = this.game.world;
    if (!w.inBounds(tx, ty)) return false;
    const i = w.idx(tx, ty);
    if (w.height[i] < SEA_LEVEL) return false;
    if (w.type[i] === TILE.LAVA && !opts.force) return false;
    const fl = this.flammability(i);
    if (this.inList[i]) {
      w.fire[i] = Math.min(1, Math.max(w.fire[i], intensity * 0.8));
      if (opts.fuelBoost) this.fuel[i] += opts.fuelBoost;
      return true;
    }
    let fuel = this.fuelFor(i) + (opts.fuelBoost || 0);
    if (fuel < 0.08) {
      // nothing to burn: a brief flash fire for feedback only
      if (!opts.flash) return false;
      fuel = 0.12;
    }
    this.fuel[i] = fuel;
    this.fuel0[i] = fuel;
    w.fire[i] = Math.max(0.15, Math.min(1, intensity * (0.4 + 0.6 * Math.max(fl, 0.3))));
    this._add(i);
    this._mark(i);
    return true;
  }

  extinguish(tx, ty) {
    const w = this.game.world;
    if (!w.inBounds(tx, ty)) return;
    const i = w.idx(tx, ty);
    if (!this.inList[i]) return;
    this.fuel[i] = 0;
    w.fire[i] = 0;
    this._mark(i);
  }

  _add(i) {
    if (this.inList[i]) return;
    this.inList[i] = 1;
    this.list[this.count++] = i;
  }
  _addSm(i, v) {
    this.smolder[i] = Math.max(this.smolder[i], v);
    if (this.inSm[i]) return;
    this.inSm[i] = 1;
    this.smList[this.smCount++] = i;
  }
  _mark(i) {
    const w = this.game.world.w;
    const x = i % w,
      y = (i / w) | 0;
    const d = this._dirty;
    if (!d) this._dirty = { x0: x, y0: y, x1: x, y1: y };
    else {
      if (x < d.x0) d.x0 = x;
      if (x > d.x1) d.x1 = x;
      if (y < d.y0) d.y0 = y;
      if (y > d.y1) d.y1 = y;
    }
  }

  tick(step) {
    const g = this.game;
    const w = g.world;
    // adopt fires started by other modules through world.setFire(); the
    // dirty rect (which also covers our own changes) is swept in row slices
    // so a huge fire on a big map stays within the tick budget
    if (this._external && !this._scan) {
      this._scan = { ...this._external, y: this._external.y0 };
      this._external = null;
    }
    if (this._scan) {
      const r = this._scan;
      const rowW = r.x1 - r.x0 + 1;
      const rows = Math.max(1, Math.floor(16384 / rowW));
      const yEnd = Math.min(r.y1, r.y + rows - 1);
      for (let y = r.y; y <= yEnd; y++)
        for (let x = r.x0; x <= r.x1; x++) {
          const i = y * w.w + x;
          if (w.fire[i] > 0 && !this.inList[i]) {
            const f = w.fire[i];
            if (!this.ignite(x, y, f, { flash: true })) w.fire[i] = 0;
          }
        }
      r.y = yEnd + 1;
      if (r.y > r.y1) this._scan = null;
    }
    if (this.count === 0 && this.smCount === 0) {
      this._unitStatuses(step);
      return;
    }
    const env = g.env;
    const wt = env.weather?.type;
    const wi = env.weather?.intensity ?? 0;
    const rain = wt === 'rain' || wt === 'storm' ? Math.max(0.35, wi) * (wt === 'storm' ? 1.25 : 1) : wt === 'snow' ? 0.5 * Math.max(0.3, wi) : 0;
    const wind = env.wind || { x: 0, z: 0, strength: 0 };
    const wl = Math.hypot(wind.x || 0, wind.z || 0) || 1;
    const wdx = (wind.x || 0) / wl,
      wdz = (wind.z || 0) / wl;
    const ws = wind.strength ?? 0.3;
    const rng = this.rng;
    const W = w.w;

    const spreadOn = law(g, "natureFireSpread", true);
    // World Age: fireRisk scales spread; a cold age slows fire, a hot one quickens it
    const ageF = fireFactor(g);
    const n = this.count;
    const todo = Math.min(n, BUDGET);
    const dtEff = step * (n / Math.max(1, todo));
    let changed = false;
    for (let k = 0; k < todo; k++) {
      if (this.count === 0) break;
      if (this.cursor >= this.count) this.cursor = 0;
      const li = this.cursor;
      const i = this.list[li];
      let f = w.fire[i];
      const x = i % W,
        y = (i / W) | 0;
      // ---- burn ----
      const wet = Math.max(w.wetness ? w.wetness[i] : 0, 0);
      const peak = Math.min(1, 0.45 + this.fuel0[i] * 0.3);
      const fuelFrac = this.fuel0[i] > 0 ? this.fuel[i] / this.fuel0[i] : 0;
      if (this.fuel[i] > 0) {
        const target = peak * Math.min(1, fuelFrac * 3.2 + 0.08);
        f += (target - f) * Math.min(1, dtEff * 0.9);
        this.fuel[i] -= dtEff * (0.045 + 0.085 * f);
      } else f -= dtEff * 0.6;
      if (rain > 0) f -= dtEff * 0.32 * rain;
      if (wet > 0.05) f -= dtEff * 0.4 * wet;
      // charring: the ground behind the front turns to ash while the last
      // flames still flicker on it (a dark burnt interior, not an orange
      // carpet), and trees become dead trees halfway through
      if (fuelFrac < 0.62 && w.type[i] !== TILE.ASH) {
        const tf0 = TILE_INFO[w.type[i]]?.flammable ?? 0;
        if (tf0 >= ASH_THRESHOLD || (this.fuel0[i] > 0.6 && tf0 > 0.05)) w.setType(x, y, TILE.ASH);
      }
      const fl = w.flora[i];
      if (fl && FLORA_INFO[fl].isTree && fl !== FLORA.DEAD_TREE && fuelFrac < 0.55) {
        w.setFlora(i % W, y, FLORA.DEAD_TREE, Math.max(0.6, w.floraGrowth[i]));
      }
      if (f <= 0.02 || (this.fuel[i] <= 0 && f < 0.08)) {
        this._burnOut(i, x, y, fuelFrac);
        // remove from list (swap with last)
        this.inList[i] = 0;
        this.count--;
        this.list[li] = this.list[this.count];
        changed = true;
        continue;
      }
      w.fire[i] = f;
      this.cursor++;
      // ---- spread ----
      const hi = w.height[i];
      const sp = f * dtEff * 0.45 * (1 - Math.min(0.92, rain * 0.85)) * (1 - Math.min(0.9, wet));
      // World Law natureFireSpread: when off, fires burn in place only
      for (let d = 0; spreadOn && d < 8; d++) {
        const dx = DIRS8[d][0],
          dy = DIRS8[d][1];
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= w.h) continue;
        const j = ny * W + nx;
        if (this.inList[j]) continue;
        const flam = this.flammability(j);
        if (flam <= 0.02) continue;
        const diag = d >= 4 ? 0.7071 : 1;
        const align = (dx * wdx + dy * wdz) * diag;
        const windF = Math.exp(align * ws * 2.6);
        const slope = Math.max(-1.2, Math.min(1.2, w.height[j] - hi));
        const slopeF = Math.exp(slope * 0.55);
        const p = sp * Math.pow(flam, 1.6) * windF * slopeF * diag * ageF;
        if (rng.next() < p) {
          if (this.ignite(nx, ny, f * 0.7)) changed = true;
        }
      }
      // spotting: burning trees throw embers downwind in strong wind
      if (spreadOn && fl && FLORA_INFO[fl].isTree && ws > 0.3 && f > 0.6 && rain < 0.2 && rng.next() < dtEff * 0.04 * ws * ageF) {
        const dist = 2 + rng.next() * 4 * ws * 2;
        const sx = Math.round(x + wdx * dist + (rng.next() - 0.5) * 2),
          sy = Math.round(y + wdz * dist + (rng.next() - 0.5) * 2);
        if (w.inBounds(sx, sy) && this.flammability(sy * W + sx) > 0.45) this.ignite(sx, sy, 0.5);
      }
      // ---- buildings in the flames ----
      if (w.building[i] >= 0) {
        this.bTimer[i] -= dtEff;
        if (this.bTimer[i] <= 0) {
          this.bTimer[i] = 0.5;
          try {
            g.civ?.damageArea?.(x + 0.5, y + 0.5, 0.9, 7 * f, 'fire');
          } catch (err) {
            console.error('[fire] civ.damageArea', err);
          }
        }
      }
      this._mark(i);
    }
    // smoulder decay
    if (this.smCount) {
      const decay = step * (0.07 + rain * 0.4);
      for (let k = this.smCount - 1; k >= 0; k--) {
        const i = this.smList[k];
        const s = this.smolder[i] - decay;
        if (s <= 0) {
          this.smolder[i] = 0;
          this.inSm[i] = 0;
          this.smCount--;
          this.smList[k] = this.smList[this.smCount];
        } else this.smolder[i] = s;
      }
      changed = true;
    }
    if (changed || this.count) this.version++;
    this._unitStatuses(step);
    if (this._dirty) {
      const d = this._dirty;
      this._dirty = null;
      this._selfFlush = true;
      w.markDirty('fire', d.x0, d.y0, d.x1, d.y1);
      this._selfFlush = false;
    }
  }

  _burnOut(i, x, y, fuelFrac) {
    const g = this.game;
    const w = g.world;
    w.fire[i] = 0;
    this.fuel[i] = 0;
    const burned = this.fuel0[i];
    const fl = w.flora[i];
    if (fl) {
      const info = FLORA_INFO[fl];
      if (info.isTree) w.setFlora(x, y, this.rng.next() < 0.55 ? FLORA.STUMP : FLORA.NONE);
      else if (info.flammable > 0) w.setFlora(x, y, FLORA.NONE);
    }
    const t = w.type[i];
    const tf = TILE_INFO[t]?.flammable ?? 0;
    if (tf >= ASH_THRESHOLD || (burned > 0.6 && tf > 0.05)) w.setType(x, y, TILE.ASH);
    if (burned > 0.25) this._addSm(i, Math.min(1, 0.35 + burned * 0.3));
    this._mark(i);
  }

  // Units standing in flames get the Burning status (Life's API, guarded);
  // those still alive once the fire has passed get a biography line and XP.
  _unitStatuses(step) {
    const g = this.game;
    this._stT = (this._stT || 0) - step;
    if (this._stT > 0) return;
    this._stT = 0.5;
    const w = g.world;
    const now = g.time.total;
    const burned = (this._burned ||= new Map());
    if (this.count && g.units?.list) {
      for (const u of g.units.list) {
        if (!u.alive) continue;
        const [tx, ty] = w.tileOf(u.x, u.z);
        if (w.fire[w.idx(tx, ty)] <= 0.2) continue;
        try {
          g.units.addStatus?.(u, 'burning', 4);
        } catch (e) {
          /* Life API optional */
        }
        if (!burned.has(u) && burned.size < 600) burned.set(u, { t: now, great: this.count >= 40, x: u.x, z: u.z });
        else if (burned.has(u)) burned.get(u).t = now;
      }
    }
    for (const [u, rec] of burned) {
      if (!u.alive) {
        burned.delete(u);
        continue;
      }
      if (now - rec.t < 15) continue;
      burned.delete(u);
      if (u.def?.kind !== 'humanoid') continue;
      const text = rec.great ? `Survived the great fire of ${regionName(g, rec.x, rec.z)}, ${yearLabel(g)}` : `Escaped a fire, ${yearLabel(g)}`;
      try {
        g.units.log?.(u, text);
        g.units.addXP?.(u, rec.great ? 15 : 5);
        if (rec.great && Math.random() < 0.25) g.units.addTrait?.(u, 'survivor');
      } catch (e) {
        /* Life API optional */
      }
    }
  }

  burningCount() {
    return this.count;
  }
}

function union(a, b) {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}
