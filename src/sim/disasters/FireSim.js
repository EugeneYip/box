import { TILE, TILE_INFO, FLORA, FLORA_INFO, SEA_LEVEL, DIRS8 } from '../../world/constants.js';
import { law, fireFactor, regionName, yearLabel, withAge, wildfireDamp, simWeather, HOT_FIRE, FIRE_WILD, FIRE_SKY, FIRE_SPARK } from './util.js';

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
// Lineage: every burning tile remembers what started its fire (cause, see
// FIRE_WILD / FIRE_SKY in util.js) and passes it on as the fire spreads.
// Fires the player set behave the same in every age; unattended ones
// (dry lightning, burning buildings, monsters) only run wild in a fire age
// and stay small, contained burns in ordinary times. Fires started by
// lightning obey the calamityLightning law even once they have spread into
// buildings: a building set alight by one throws no new fires while the law
// is off.

const BUDGET = 2600;
// natExp: natural ignition falls off as factor^natExp below the Embers
// factor; skyOff: spread of lightning fires still burning while the
// calamityLightning law is off; spark: most a fire from sparks (burning
// buildings, monsters) may spread in any age (below an ordinary age's
// wildfire: a few tiles around the burning houses);
// wild: override of wildfireDamp (tooling)
const TUNE = { natExp: 3.4, skyOff: 0.2, spark: 0.25, wild: null };
const ASH_THRESHOLD = 0.35; // ground flammability that leaves ash behind
const SCARRED = 8; // scar bit: a fire has burnt this tile

export class FireSim {
  constructor(game) {
    this.game = game;
    this.tune = TUNE;
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
    this.cause = new Uint8Array(n); // lineage of each burning tile
    this.bCause = new Map(); // building id -> {c, t}: what set it alight
    this.scar = new Uint8Array(n); // lineage of the last fire on a tile, | SCARRED
    this._spreadOpts = { cause: 0, spread: true };
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
    this.cause.fill(0);
    this.scar.fill(0);
    this.bCause.clear();
    this._external = null;
    this._scan = null;
    this._burned?.clear();
    this.natural = 0;
    this._natNote = null;
    this._natP = 0;
    this._natNext = null;
    this._recent = 0;
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
    // dryness of the age (cached per tick): a hot fire age cures the grass
    // and scrub so open country carries fire too, not only woods (forests
    // are sparse on many maps); a cold age damps everything
    return Math.min(1, v * (this._dry || 1));
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
  // opts.cause: lineage (0 = set by the player; FIRE_WILD / FIRE_SKY bits),
  // opts.spread: the flames of a fire already burning reaching this tile.
  ignite(tx, ty, intensity = 1, opts = {}) {
    const w = this.game.world;
    if (!w.inBounds(tx, ty)) return false;
    const i = w.idx(tx, ty);
    if (w.height[i] < SEA_LEVEL) return false;
    if (w.type[i] === TILE.LAVA && !opts.force) return false;
    const cause = opts.cause | 0;
    // World Law calamityLightning: no lightning fire may start while it is
    // off, whatever path the spark took
    if (cause & FIRE_SKY && !opts.spread && !law(this.game, 'calamityLightning', true)) return false;
    const fl = this.flammability(i);
    if (this.inList[i]) {
      w.fire[i] = Math.min(1, Math.max(w.fire[i], intensity * 0.8));
      if (opts.fuelBoost) this.fuel[i] += opts.fuelBoost;
      // a fire the player feeds becomes theirs
      if (!opts.spread && !cause) this.cause[i] = 0;
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
    this.cause[i] = cause;
    this.scar[i] = cause | SCARRED;
    w.fire[i] = Math.max(0.15, Math.min(1, intensity * (0.4 + 0.6 * Math.max(fl, 0.3))));
    this._add(i);
    this._mark(i);
    return true;
  }

  // An ignition from outside the disasters module (a burning building
  // throwing sparks, a monster's breath): an unattended fire. Next to a
  // building, it carries on the lineage of the fire that set the building
  // alight (so a house lit by lightning cannot rekindle the land while the
  // calamityLightning law is off, and one lit by the player stays theirs).
  // A building that caught fire some other way (sparks from a neighbour,
  // a strike beside it) is judged by the ground around it: if a lightning
  // fire has passed within two tiles, its sparks count as lightning's.
  // Otherwise (a hall burning under siege, a monster's breath) it is a spark
  // fire: a local burn in every age, even the Age of Embers, whose wildfires
  // are lightning's.
  igniteExternal(tx, ty, intensity = 1) {
    const w = this.game.world;
    if (!w.inBounds(tx, ty)) return false;
    let cause = FIRE_WILD | FIRE_SPARK;
    let best = null;
    if (this.bCause.size)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = tx + dx,
            y = ty + dy;
          if (!w.inBounds(x, y)) continue;
          const b = w.building[y * w.w + x];
          const rec = b >= 0 ? this.bCause.get(b) : null;
          if (rec && (!best || rec.t > best.t)) best = rec;
        }
    if (best) cause = best.c;
    else
      for (let dy = -2; dy <= 2 && !(cause & FIRE_SKY); dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const x = tx + dx,
            y = ty + dy;
          if (w.inBounds(x, y) && this.scar[y * w.w + x] & FIRE_SKY) {
            cause = FIRE_WILD | FIRE_SKY;
            break;
          }
        }
    return this.ignite(tx, ty, intensity, { cause });
  }

  // Record that a fire of this lineage reached the buildings within r of
  // (x, z) (world units), so their sparks carry it on.
  markBuildings(x, z, r, cause) {
    const w = this.game.world;
    const now = this.game.time.total;
    const x0 = Math.max(0, Math.floor(x - r)),
      x1 = Math.min(w.w - 1, Math.floor(x + r)),
      y0 = Math.max(0, Math.floor(z - r)),
      y1 = Math.min(w.h - 1, Math.floor(z + r));
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        const b = w.building[ty * w.w + tx];
        if (b >= 0) this._markBuilding(b, cause, now);
      }
  }
  _markBuilding(bid, cause, now) {
    // the player's fire wins, otherwise the latest lineage
    const rec = this.bCause.get(bid);
    if (!rec) this.bCause.set(bid, { c: cause, t: now });
    else {
      if (rec.c !== 0) rec.c = cause;
      rec.t = now;
    }
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

  // Natural wildfires: dry lightning and heat start fires by themselves,
  // far more often in a hot, fire-prone age (Embers: one every half minute or
  // so on a medium map) than in a temperate one (one in about twenty-five
  // minutes, and it stays a small burn: see wildfireDamp), and almost never
  // in a cold one. Runs on game time (works when fast-forwarding), gated by
  // the calamityLightning law, and held back while a large fire is already
  // burning, so it never runs away across the map.
  _natural(step) {
    const g = this.game;
    const w = g.world;
    if (g.time.total < 20 || !law(g, 'calamityLightning', true)) return;
    const wt = simWeather(g).type;
    if (wt === 'rain' || wt === 'storm' || wt === 'snow') return;
    const area = (w.w * w.h) / 65536;
    const cap = 600 * area;
    if (this.count >= cap || (this._recent || 0) > 2800 * area) return;
    const season = g.time.seasonName;
    const sf = season === 'Summer' ? 1.3 : season === 'Winter' ? 0.6 : 1;
    // the Embers rate as before (1/600 x factor^2.6), falling off steeply
    // below it: ordinary ages see an occasional fire, not a steady drizzle
    const ff = fireFactor(g);
    const ageRate = Math.pow(HOT_FIRE, 2.6) * Math.pow(ff / HOT_FIRE, ff < HOT_FIRE ? TUNE.natExp : 2.6);
    const rate = (1 / 600) * area * ageRate * sf * (1 - this.count / cap);
    // a jittered renewal process instead of a coin flip per tick: the
    // hazard is integrated (so a change of age applies at once) and the next
    // fire comes after 0.6-1.4 mean intervals, so a fire age sets the land
    // alight every few dozen seconds, every window, without long droughts
    this._natP = (this._natP || 0) + rate * step;
    if (this._natNext == null) this._natNext = 0.3 + this.rng.next() * 0.7;
    if (this._natP < this._natNext) return;
    // pick the most combustible of many sampled spots (woods and dry scrub
    // first), so sparse forests still catch
    let best = -1,
      bestS = 0.3;
    for (let k = 0; k < 120; k++) {
      const tx = 2 + Math.floor(this.rng.next() * (w.w - 4)),
        ty = 2 + Math.floor(this.rng.next() * (w.h - 4));
      const i = ty * w.w + tx;
      if (w.height[i] < SEA_LEVEL || this.inList[i] || w.building[i] >= 0) continue;
      if (w.wetness && w.wetness[i] > 0.25) continue;
      const fl = w.flora[i];
      const sc = this.flammability(i) + (fl && FLORA_INFO[fl].isTree ? 0.35 : 0);
      if (sc > bestS) {
        bestS = sc;
        best = i;
      }
    }
    if (best >= 0) {
      const tx = best % w.w,
        ty = (best / w.w) | 0;
      this._natP = 0;
      this._natNext = 0.6 + this.rng.next() * 0.8;
      this.natural = (this.natural || 0) + 1;
      try {
        // a dry-lightning strike (bolt, scorch) that sets the spot alight
        if (g.disasters?.lightning) g.disasters.lightning(tx + 0.5, ty + 0.5, { natural: true, ignite: true, cause: FIRE_WILD | FIRE_SKY });
        else this.ignite(tx, ty, 1, { cause: FIRE_WILD | FIRE_SKY });
        if (g.time.total - (this._natNote ?? -1e9) > 45) {
          this._natNote = g.time.total;
          g.notify?.(withAge(g, 'wildfire', `Dry lightning sparks a wildfire in ${regionName(g, tx + 0.5, ty + 0.5)}.`), 'disaster', { x: tx + 0.5, z: ty + 0.5 });
        }
      } catch (err) {
        this.ignite(tx, ty, 1, { cause: FIRE_WILD | FIRE_SKY });
      }
    }
  }

  tick(step) {
    const g = this.game;
    const w = g.world;
    this._dry = Math.max(0.6, Math.min(1.4, Math.pow(fireFactor(g), 0.25)));
    this._natural(step);
    // forget buildings whose fire is long out (a burning building can
    // smoulder for minutes after the flames around it have passed)
    if (this.bCause.size && (this._bcT = (this._bcT || 0) - step) <= 0) {
      this._bcT = 30;
      const now = g.time.total;
      for (const [b, rec] of this.bCause) if (now - rec.t > 900) this.bCause.delete(b);
    }
    this._recent = (this._recent || 0) * Math.exp(-step / 60);
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
    const sw = simWeather(g);
    const wt = sw.type;
    const wi = sw.intensity ?? 0;
    const rain = wt === 'rain' || wt === 'storm' ? Math.max(0.35, wi) * (wt === 'storm' ? 1.25 : 1) : wt === 'snow' ? 0.5 * Math.max(0.3, wi) : 0;
    const wind = env.wind || { x: 0, z: 0, strength: 0 };
    const wl = Math.hypot(wind.x || 0, wind.z || 0) || 1;
    const wdx = (wind.x || 0) / wl,
      wdz = (wind.z || 0) / wl;
    const ws = wind.strength ?? 0.3;
    const rng = this.rng;
    const W = w.w;

    const spreadOn = law(g, "natureFireSpread", true);
    // unattended fires spread as the age allows; lightning fires already
    // burning when the calamityLightning law is switched off die down
    const wildF = TUNE.wild != null ? TUNE.wild : wildfireDamp(g);
    const sparkF = Math.min(wildF, TUNE.spark);
    const skyOk = law(g, 'calamityLightning', true);
    // World Age: fireRisk scales spread; a cold age slows fire, a hot one quickens it
    const n = this.count;
    // a very large fire spreads more slowly (it has burnt its easy fuel and
    // made its own weather), so even a fire age never burns the whole map
    // (the age's fire factor acts on spread more gently than on ignition:
    // a fire age means many more fires that run faster, not one inferno)
    // and once a great deal of land has burnt in the last minute or so the
    // country left is patchy and fire breaks hold: spread slows further
    const area = (w.w * w.h) / 65536;
    const capS = 450 * area;
    const capB = 1000 * area;
    const ageF = Math.pow(fireFactor(g), 0.25) * (n > capS ? Math.max(0.3, capS / n) : 1) * (this._recent > capB ? Math.max(0.12, Math.pow(capB / this._recent, 1.5)) : 1);
    const todo = Math.min(n, BUDGET);
    const dtEff = step * (n / Math.max(1, todo));
    // fire brigades and fire engines guard the towns (Civ breadth.js: a coarse grid)
    const FG = g.civ?.fireGuard;
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
      const guard = FG ? FG.data[((y / FG.cell) | 0) * FG.cw + ((x / FG.cell) | 0)] / 255 : 0;
      if (guard > 0) f -= dtEff * 0.9 * guard;
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
      const cause = this.cause[i];
      const lineF = (cause & FIRE_WILD ? (cause & FIRE_SPARK ? sparkF : wildF) : 1) * (cause & FIRE_SKY && !skyOk ? TUNE.skyOff : 1);
      const sp = f * dtEff * 0.45 * (1 - Math.min(0.92, rain * 0.85)) * (1 - Math.min(0.9, wet)) * lineF * (1 - 0.7 * guard);
      const spreadOpts = this._spreadOpts;
      spreadOpts.cause = cause;
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
          if (this.ignite(nx, ny, f * 0.7, spreadOpts)) changed = true;
        }
      }
      // spotting: burning trees throw embers downwind in strong wind
      // (a lightning fire dying down under the law throws none: a spot fire
      // far from the flames would read as a new fire)
      if (spreadOn && fl && FLORA_INFO[fl].isTree && ws > 0.3 && f > 0.6 && rain < 0.2 && !(cause & FIRE_SKY && !skyOk) && rng.next() < dtEff * 0.04 * ws * ageF * lineF) {
        const dist = 2 + rng.next() * 4 * ws * 2;
        const sx = Math.round(x + wdx * dist + (rng.next() - 0.5) * 2),
          sy = Math.round(y + wdz * dist + (rng.next() - 0.5) * 2);
        if (w.inBounds(sx, sy) && this.flammability(sy * W + sx) > 0.45) this.ignite(sx, sy, 0.5, spreadOpts);
      }
      // ---- buildings in the flames ----
      if (w.building[i] >= 0) {
        // remember what set the building alight (its sparks carry it on)
        this._markBuilding(w.building[i], cause, g.time.total);
        this.bTimer[i] -= dtEff;
        if (this.bTimer[i] <= 0) {
          this.bTimer[i] = 0.5;
          // the heat reaches the buildings next door too
          this.markBuildings(x + 0.5, y + 0.5, 1.4, cause);
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
    this._recent = (this._recent || 0) + 1;
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
