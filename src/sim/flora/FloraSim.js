import { FLORA, TILE, SEA_LEVEL, FLORA_INFO } from '../../world/constants.js';
import { mulberry32 } from '../../core/Random.js';
import {
  SPECIES,
  TREE_CAP,
  BARREN,
  isTreeId,
  isMineral,
  isLiving,
  densityGroup,
  suitAt,
  pickTree,
  pickUndergrowth,
  naturalBiome,
  climateFactor,
  flowerDrift,
} from './species.js';

// Flora simulation (Nature).
//
// A budgeted sweep visits every tile once per SWEEP seconds (a slice of the
// map per tick), so the cost is flat no matter how much vegetation exists.
// Per visit, with dt = time since that tile was last visited:
//   * growth: plants mature at a species rate scaled by soil fertility; wheat
//     on farmland grows through sprout -> green -> ripening -> ripe stages
//   * stress: plants on hostile ground (palms in snow, oaks in desert, reeds
//     away from water...) dry out (rendered as browning foliage) and die:
//     trees become dead trees, small plants vanish
//   * life cycle: old plants eventually die; dead trees fall to stumps,
//     stumps rot away (sometimes resprouting), flowers bloom and fade
//   * spread: mature plants seed suitable empty neighbours, limited by local
//     density caps per biome so forests thicken but never take over the map
//   * healing: burnt ASH recovers to its natural biome after a while and is
//     then recolonised by grass, flowers and eventually forest
// Growth-only changes are written straight to world.floraGrowth (the
// renderer eases them); kind changes go through world.setFlora. A coarse
// 'world:flora' dirty mark is raised when a plant crosses a growth stage.
const SWEEP = 4; // seconds per full sweep of a 256x256 map
// Larger maps keep the same tiles-per-tick budget (same ms per tick) and
// simply sweep more slowly; rates are per game second so behaviour matches.
const TICK_BUDGET_MS = 0.8; // never spend more than this per simulation tick
// biome chain for climate shifts (-1 = end of chain)
const COLDER = new Int8Array(16).fill(-1);
const WARMER = new Int8Array(16).fill(-1);
COLDER[TILE.TUNDRA] = TILE.SNOW;
COLDER[TILE.GRASS] = TILE.TUNDRA;
COLDER[TILE.FOREST] = TILE.TUNDRA;
COLDER[TILE.SWAMP] = TILE.TUNDRA;
COLDER[TILE.SAVANNA] = TILE.GRASS;
COLDER[TILE.DESERT] = TILE.SAVANNA;
COLDER[TILE.JUNGLE] = TILE.FOREST;
COLDER[TILE.ROCK] = TILE.SNOW;
WARMER[TILE.SNOW] = TILE.TUNDRA;
WARMER[TILE.TUNDRA] = TILE.GRASS;
WARMER[TILE.GRASS] = TILE.SAVANNA;
WARMER[TILE.SAVANNA] = TILE.DESERT;
const SHIFTABLE = new Uint8Array(16);
for (const t of [TILE.GRASS, TILE.FOREST, TILE.SAVANNA, TILE.DESERT, TILE.TUNDRA, TILE.SNOW, TILE.JUNGLE, TILE.SWAMP]) SHIFTABLE[t] = 1;
// surfaces that are not a biome of their own: they heal back to the native one
const TRANSIENT = new Uint8Array(16);
for (const t of [TILE.ASH, TILE.LAVA, TILE.FARMLAND, TILE.ROAD, TILE.SOIL]) TRANSIENT[t] = 1;
// chance per sweep visit that cleared land of a biome is reseeded by a tree
const REFOREST = new Float32Array(16);
REFOREST[TILE.FOREST] = 0.02;
REFOREST[TILE.JUNGLE] = 0.02;
REFOREST[TILE.SWAMP] = 0.01;
REFOREST[TILE.TUNDRA] = 0.006;
REFOREST[TILE.GRASS] = 0.0015;
REFOREST[TILE.SOIL] = 0.002;
REFOREST[TILE.SAVANNA] = 0.002;
REFOREST[TILE.SNOW] = 0.002;

export class FloraSim {
  constructor(game) {
    this.game = game;
    const n = game.world.size;
    this.stress = new Float32Array(n); // 0 healthy .. 1 dead (read by the renderer)
    this.age = new Float32Array(n); // seconds since the plant matured / tile burnt
    this.boost = new Float32Array(n); // growth multiplier bonus from the bloom power (decays)
    // game time of each tile's last visit: dt is exact even when the per-tick
    // time budget truncates a sweep (coarse 8x/16x steps on a busy CPU)
    this.lastVisit = new Float32Array(n);
    this._gameT = 0;
    this.budgetMs = TICK_BUDGET_MS;
    this.captureNative();
    // biome edits by anyone else (painting, terrain, civ) become the new native
    // biome, except transient surfaces (fire, lava, farming) which heal back
    game.events?.on?.('world:type', (r) => this.adoptTypes(r));
    this.rng = mulberry32((game.params?.seed ?? 1) * 31 + 7);
    this._cursor = 0;
    this._acc = 0;
    this.counts = { trees: 0, plants: 0 };
    this._countAcc = { trees: 0, plants: 0 };
    this.settle();
    this.recount();
  }

  // One-off ecological tidy of a freshly generated world: trees outside their
  // climate become a species that belongs there, and wildflowers gather into
  // drifts instead of an even sprinkle.
  settle() {
    const world = this.game.world;
    const W = world.w;
    for (let i = 0; i < world.size; i++) {
      const f = world.flora[i];
      const tx = i % W,
        ty = (i / W) | 0;
      if (isTreeId(f) && (climateFactor(f, world.temperature[i]) < 0.5 || (f === FLORA.PALM && suitAt(world, f, tx, ty, i) <= 0))) {
        const alt = pickTree(world.type[i], world.temperature[i], this.hash(i * 3 + 1));
        const ok = alt && climateFactor(alt, world.temperature[i]) >= 0.5 && suitAt(world, alt, tx, ty, i) >= 0.3;
        world.flora[i] = ok ? alt : FLORA.NONE;
        if (!ok) world.floraGrowth[i] = 0;
      } else if (f === FLORA.FLOWERS) {
        const d = flowerDrift(tx, ty);
        if (d < 0.5 || world.slopeAt(tx, ty) > 1.15) {
          world.flora[i] = this.hash(i) < 0.25 && d > 0.3 ? FLORA.BUSH : FLORA.NONE;
          if (!world.flora[i]) world.floraGrowth[i] = 0;
        }
      } else if (!f && world.type[i] === TILE.ROCK && world.height[i] >= SEA_LEVEL + 0.3 && world.building[i] < 0 && world.slopeAt(tx, ty) < 1.1) {
        // flat bare rock: scattered scree and the odd boulder
        const r = this.hash(i * 11 + 5);
        if (r < 0.06) world.flora[i] = FLORA.BOULDER;
        else if (r < 0.3) world.flora[i] = FLORA.ROCK_SMALL;
        if (world.flora[i]) world.floraGrowth[i] = 1;
      } else if (!f && world.type[i] === TILE.GRASS && world.height[i] >= SEA_LEVEL && world.building[i] < 0) {
        const d = flowerDrift(tx, ty);
        if (d > 0.72 && this.hash(i * 7 + 3) < (d - 0.72) * 1.1 && world.slopeAt(tx, ty) < 0.9) {
          world.flora[i] = FLORA.FLOWERS;
          world.floraGrowth[i] = 0.7 + this.hash(i * 5) * 0.3;
        }
      }
    }
    world.markDirty('flora', 0, 0, world.w - 1, world.h - 1);
  }

  recount() {
    const world = this.game.world;
    const c = { trees: 0, plants: 0 };
    for (let i = 0; i < world.size; i++) {
      const f = world.flora[i];
      if (isTreeId(f)) c.trees++;
      else if (isLiving(f)) c.plants++;
    }
    this.counts = c;
  }

  reset() {
    this._cursor = 0;
    this.stress.fill(0);
    this.age.fill(0);
    this.boost.fill(0);
    this.lastVisit.fill(0);
    this._gameT = 0;
    this.captureNative();
    this.rng = mulberry32((this.game.params?.seed ?? 1) * 31 + 7);
    this._countAcc = { trees: 0, plants: 0 };
    this.settle();
    this.recount();
  }

  tick(step) {
    const world = this.game.world;
    const n = world.size;
    const sweep = SWEEP * Math.max(1, n / 65536);
    this._acc += (n * step) / sweep;
    let count = Math.floor(this._acc);
    this._acc -= count;
    this._gameT += step;
    const dt = sweep; // nominal; visits use their exact elapsed time
    // World Laws, read each tick so a toggle applies on the next one
    const laws = this.game.laws || {};
    const mods = this.game.age?.mods || {};
    this._grow = laws.natureGrowth !== false;
    this._regrow = laws.natureRegrowth !== false;
    this._treesSpread = laws.treesSpread !== false;
    this._plantsSpread = laws.plantsSpread !== false;
    this._fungiSpread = laws.fungiSpread !== false;
    this._treeSpeed = laws.treesGrowSpeed ?? 1;
    this._density = laws.treesDensity ?? 1;
    this._crops = laws.plantsCrops ?? 1;
    this._fert = mods.fertility ?? 1;
    this._fungi = mods.fungi ?? 1;
    this._tOff = mods.temperature ?? 0;
    // seasons: 0 spring .. 3 winter (fraction = progress)
    const season = this.game.time?.season ?? 1.5;
    this._season = Math.floor(season) % 4;
    if (laws.biomeShift !== false) this.shiftBiomes(dt, step);
    // hard time budget per tick: leftover visits carry over (bounded)
    const t0 = performance.now();
    let k = 0;
    while (count-- > 0) {
      if ((++k & 255) === 0 && performance.now() - t0 > this.budgetMs) {
        this._acc = Math.min(this._acc + count + 1, (n * step * 4) / sweep);
        break;
      }
      const i = this._cursor;
      if (++this._cursor >= n) {
        this._cursor = 0;
        this.counts = this._countAcc;
        this._countAcc = { trees: 0, plants: 0 };
      }
      const last = this.lastVisit[i];
      this.lastVisit[i] = this._gameT;
      const dti = last > 0 ? Math.min(240, Math.max(0, this._gameT - last)) : dt;
      this.visit(i, dti);
    }
  }

  visit(i, dt) {
    const world = this.game.world;
    const f = world.flora[i];
    const t = world.type[i];
    const W = world.w;
    const tx = i % W,
      ty = (i / W) | 0;

    // ---- burnt land heals ------------------------------------------------
    if (t === TILE.ASH && this._regrow !== false) {
      if (world.fire[i] > 0) {
        this.age[i] = 0;
      } else {
        this.age[i] += dt * (1 + this.boost[i] * 6);
        const need = 55 + this.hash(i) * 70;
        if (this.age[i] > need && world.height[i] >= SEA_LEVEL) {
          const nat = this.native[i];
          const nb = TRANSIENT[nat] ? naturalBiome(world, i, this._tOff) : nat;
          this.setTypeSelf(tx, ty, nb === TILE.SAND && world.height[i] > SEA_LEVEL + 0.7 ? TILE.GRASS : nb);
          this.age[i] = 0;
        }
      }
    }
    if (this.boost[i] > 0) this.boost[i] = Math.max(0, this.boost[i] - dt / 40);

    if (!f) {
      this.stress[i] = 0;
      // spontaneous undergrowth on fertile empty ground (rare)
      if (world.height[i] >= SEA_LEVEL && !BARREN[t] && world.building[i] < 0 && world.fire[i] <= 0) {
        const p = t === TILE.FOREST ? 0.0016 : t === TILE.JUNGLE ? 0.002 : t === TILE.GRASS ? 0.0009 : t === TILE.SWAMP ? 0.0012 : 0;
        const spring = this._season === 0 ? 2.5 : this._season === 3 ? 0.2 : 1;
        if (p && this._grow !== false && this.rng() < p * spring * this._fert * (1 + this.boost[i] * 10)) {
          const u = pickUndergrowth(t, this.rng());
          if (u && this.lawAllows(u) && this.canSeed(u, tx, ty)) world.setFlora(tx, ty, u, 0.04);
        }
        // natural reforestation: cleared, unowned land is reseeded from afar
        // in proportion to how far below its natural tree cover it has fallen
        if (this._treesSpread && this._grow !== false && t !== TILE.FARMLAND) {
          const base = REFOREST[t] || 0;
          if (base && world.owner[i] < 0 && this.rng() < base * this._fert * this._treeSpeed * (dt / SWEEP)) {
            const cap = Math.max(1, Math.round((TREE_CAP[t] || 1) * (this._density ?? 1)));
            const local = this.localCount(tx, ty, 1);
            if (local < cap * 0.5 && !this.nearBuilding(tx, ty)) {
              const tree = pickTree(t, world.temperature[i] + this._tOff, this.rng());
              if (tree && this.canSeed(tree, tx, ty)) world.setFlora(tx, ty, tree, 0.03);
            }
          }
        }
        // bare unowned soil greens over again
        if (t === TILE.SOIL && this._regrow !== false && world.owner[i] < 0 && this.rng() < 0.02 * (dt / SWEEP) && !this.nearBuilding(tx, ty)) {
          this.setTypeSelf(tx, ty, TRANSIENT[this.native[i]] || this.native[i] === TILE.SOIL ? TILE.GRASS : this.native[i]);
        }
        // fungi creep through damp woodland and swamp (more in autumn and fungal ages)
        if (this._fungiSpread && this._grow !== false && (t === TILE.FOREST || t === TILE.SWAMP || t === TILE.JUNGLE) && world.moisture[i] > 0.5) {
          const pf = 0.0012 * this._fungi * (this._season === 2 ? 2.2 : this._season === 3 ? 0.3 : 1);
          if (this.rng() < pf && this.canSeed(FLORA.MUSHROOM, tx, ty)) world.setFlora(tx, ty, FLORA.MUSHROOM, 0.05);
        }
      }
      return;
    }
    if (isMineral(f)) return;
    const sp = SPECIES[f];
    if (!sp) return;
    if (isTreeId(f)) this._countAcc.trees++;
    else if (isLiving(f)) this._countAcc.plants++;

    // ---- drowned / burning -------------------------------------------------
    const h = world.height[i];
    if (h < SEA_LEVEL && !(f === FLORA.REEDS && h > SEA_LEVEL - 0.7)) {
      world.setFlora(tx, ty, FLORA.NONE);
      this.stress[i] = 0;
      return;
    }
    if (t === TILE.LAVA) {
      world.setFlora(tx, ty, FLORA.NONE);
      this.stress[i] = 0;
      return;
    }
    if (world.fire[i] > 0) return; // Effects decides what burns into what

    // ---- remains decay -----------------------------------------------------
    if (f === FLORA.DEAD_TREE || f === FLORA.STUMP) {
      this.age[i] += dt;
      if (this.age[i] > sp.life * (0.6 + this.hash(i) * 0.8)) {
        this.age[i] = 0;
        if (f === FLORA.DEAD_TREE) world.setFlora(tx, ty, FLORA.STUMP, 1);
        else {
          // stumps rot away; sometimes a sapling takes their place
          const tree = pickTree(t, world.temperature[i] + this._tOff, this.rng());
          if (tree && this._grow !== false && this._treesSpread && this.rng() < 0.35 && suitAt(world, tree, tx, ty, i, this._tOff) >= 0.5) world.setFlora(tx, ty, tree, 0.03);
          else world.setFlora(tx, ty, FLORA.NONE);
        }
      }
      return;
    }

    // ---- stress from hostile ground ------------------------------------------
    const suit = suitAt(world, f, tx, ty, i, this._tOff);
    if (this.stress[i] >= 0.999) {
      this.die(i, tx, ty, f, sp);
      return;
    }
    if (suit < 0.15) {
      // a hostile age (palms in Rime, pines in Embers) wears plants down slowly
      const climateOnly = suitAt(world, f, tx, ty, i, 0) >= 0.15;
      this.stress[i] = Math.min(1, this.stress[i] + dt / (sp.stressTime * (1 + suit * 4) * (climateOnly ? 5 : 1)));
    } else if (this.stress[i] > 0) {
      const heal = suit >= 0.5 ? dt / 25 : dt / 60;
      this.stress[i] = Math.max(0, this.stress[i] - heal * (1 + this.boost[i] * 4));
    }
    if (this.stress[i] > 0.5) return; // struggling plants neither grow nor spread

    // ---- growth -------------------------------------------------------------
    if (this._grow === false) return; // law: plants neither grow nor spread
    let g = world.floraGrowth[i];
    if (g < 1) {
      const fert = 0.35 + 0.65 * Math.max(suit, f === FLORA.WHEAT ? 0 : 0.3);
      let mul = this._fert;
      if (isTreeId(f)) mul *= this._treeSpeed;
      if (f === FLORA.WHEAT) mul *= this._crops * [1, 1.7, 0.6, 0][this._season]; // sown spring, ripe summer, fallow winter
      const rate = (dt / sp.growTime) * fert * (0.85 + this.hash(i) * 0.3) * (1 + this.boost[i] * 5) * mul;
      const before = g;
      g = Math.min(1, g + rate);
      world.floraGrowth[i] = g;
      if (Math.floor(before * 4) !== Math.floor(g * 4)) world.markDirty('flora', tx, ty);
      return;
    }

    // ---- mature life ------------------------------------------------------------
    if (f === FLORA.WHEAT && this._season === 3 && this.rng() < 0.3) {
      world.floraGrowth[i] = 0.12;
      world.markDirty('flora', tx, ty);
      return;
    }
    this.age[i] += dt;
    if (sp.life > 0) {
      const lifespan = sp.life * (0.7 + this.hash(i) * 0.6);
      if (this.age[i] > lifespan && this.rng() < dt / 120) {
        this.die(i, tx, ty, f, sp);
        return;
      }
    }
    if (f === FLORA.FLOWERS && this.age[i] > 40 && this.rng() < 0.04) {
      // fade and re-bud: a gentle bloom cycle
      world.floraGrowth[i] = 0.25;
      this.age[i] = 0;
      world.markDirty('flora', tx, ty);
    }
    if (sp.spread > 0 && suit >= 0.35 && this.lawAllows(f)) {
      const m = (f === FLORA.MUSHROOM ? this._fungi : 1) * this._fert * (this._season === 3 ? 0.25 : 1);
      if (this.rng() < sp.spread * (dt / SWEEP) * m * (1 + this.boost[i] * 3)) this.spread(i, tx, ty, f, sp);
    }
  }

  nearBuilding(tx, ty) {
    const world = this.game.world;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = tx + dx,
          y = ty + dy;
        if (x >= 0 && y >= 0 && x < world.w && y < world.h && world.building[y * world.w + x] >= 0) return true;
      }
    return false;
  }

  // Which spreading laws allow a species to appear by itself.
  lawAllows(f) {
    if (isTreeId(f)) return this._treesSpread !== false;
    if (f === FLORA.MUSHROOM) return this._fungiSpread !== false;
    if (f === FLORA.FLOWERS || f === FLORA.BUSH || f === FLORA.BERRY_BUSH) return this._plantsSpread !== false;
    return true;
  }

  // ---- living biomes -------------------------------------------------------
  // Snapshot of the world's own biome map; climate shifts are measured from it.
  captureNative() {
    const world = this.game.world;
    this.native = world.type.slice();
    this.expect = world.type.slice();
    // mean temperature of each native biome -> boundaries between neighbours
    const sum = new Float64Array(16),
      cnt = new Float64Array(16);
    for (let i = 0; i < world.size; i++) {
      if (world.height[i] < SEA_LEVEL) continue;
      sum[world.type[i]] += world.temperature[i];
      cnt[world.type[i]]++;
    }
    this.meanT = new Float32Array(16);
    for (let t = 0; t < 16; t++) this.meanT[t] = cnt[t] ? sum[t] / cnt[t] : NaN;
    const fill = (t, v) => Number.isNaN(this.meanT[t]) && (this.meanT[t] = v);
    fill(TILE.SNOW, 0.1), fill(TILE.TUNDRA, 0.25), fill(TILE.GRASS, 0.5), fill(TILE.FOREST, 0.5);
    fill(TILE.SAVANNA, 0.7), fill(TILE.DESERT, 0.85), fill(TILE.JUNGLE, 0.82), fill(TILE.SWAMP, 0.55);
  }
  adoptTypes(r) {
    const world = this.game.world;
    if (!this.native) return;
    for (let ty = r.y0; ty <= r.y1; ty++)
      for (let tx = r.x0; tx <= r.x1; tx++) {
        const i = ty * world.w + tx;
        const t = world.type[i];
        if (t === this.expect[i]) continue;
        this.expect[i] = t;
        if (!TRANSIENT[t]) this.native[i] = t;
      }
  }
  setTypeSelf(tx, ty, t) {
    const world = this.game.world;
    world.setType(tx, ty, t);
    this.expect[ty * world.w + tx] = t;
  }
  boundary(a, b) {
    return (this.meanT[a] + this.meanT[b]) * 0.5;
  }

  // A budgeted handful of tiles per tick: in a cold or hot age, biomes step
  // one link along the climate chain (snow - tundra - meadow/forest -
  // savanna - desert) where the age's temperature crosses the boundary
  // learned from the native map, only along an existing front. Otherwise land
  // drifts back to its native biome, and in fertile ages woodland creeps into
  // moist meadow. Slow by design: fronts move a tile every few minutes.
  shiftBiomes(dt, step) {
    const world = this.game.world;
    const W = world.w,
      H = world.h;
    const tries = Math.max(1, Math.round(600 * step));
    const tOff = this._tOff || 0;
    for (let k = 0; k < tries; k++) {
      const tx = 1 + Math.floor(this.rng() * (W - 2)),
        ty = 1 + Math.floor(this.rng() * (H - 2));
      const i = ty * W + tx;
      const t = world.type[i];
      if (world.height[i] < SEA_LEVEL + 0.2 || world.building[i] >= 0 || world.fire[i] > 0) continue;
      if (!SHIFTABLE[t] && t !== TILE.ROCK) continue;
      const nat = this.native[i];
      const effT = world.temperature[i] + tOff;
      let target = t;
      if (tOff < -0.05) {
        const c = COLDER[t];
        if (c >= 0 && effT < this.boundary(c, t) - 0.02) target = c;
      } else if (tOff > 0.05) {
        const wm = t === TILE.GRASS || t === TILE.SAVANNA ? (world.moisture[i] < 0.4 ? WARMER[t] : -1) : WARMER[t];
        if (wm >= 0 && effT > this.boundary(t, wm) + 0.02) target = wm;
      }
      if (target === t && t !== nat && SHIFTABLE[nat]) {
        // the age has passed (or the land was cleared): drift back to native
        const c = COLDER[nat],
          wm = WARMER[nat];
        const tooCold = c >= 0 && effT < this.boundary(c, nat) - 0.02;
        const tooHot = wm >= 0 && effT > this.boundary(nat, wm) + 0.02 && tOff > 0.05;
        if (!(tOff < -0.05 && tooCold) && !tooHot) target = nat;
      }
      if (target === t && t === TILE.GRASS && (this._fert ?? 1) > 1.2 && world.moisture[i] > 0.55 && this.countAround(tx, ty, TILE.FOREST) >= 4 && this.treesAround(tx, ty) >= 3) target = TILE.FOREST;
      if (target === t) continue;
      if (t === TILE.ROCK && target !== TILE.SNOW) continue;
      if (target !== nat && this.countAround(tx, ty, target) < 1) continue;
      if (this.rng() > 0.35) continue;
      this.setTypeSelf(tx, ty, target);
    }
  }
  countAround(tx, ty, type) {
    const world = this.game.world;
    let c = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && world.type[(ty + dy) * world.w + tx + dx] === type) c++;
    return c;
  }
  treesAround(tx, ty) {
    const world = this.game.world;
    let c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isTreeId(world.flora[(ty + dy) * world.w + tx + dx])) c++;
    return c;
  }

  die(i, tx, ty, f, sp) {
    const world = this.game.world;
    this.stress[i] = 0;
    this.age[i] = 0;
    world.setFlora(tx, ty, sp.deadAs, 1);
  }

  hash(i) {
    let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // Count plants of a density group in the 5x5 around (tx,ty).
  localCount(tx, ty, group) {
    const world = this.game.world;
    let c = 0;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const x = tx + dx,
          y = ty + dy;
        if (!world.inBounds(x, y)) continue;
        if (densityGroup(world.flora[world.idx(x, y)]) === group) c++;
      }
    return c;
  }

  canSeed(f, tx, ty) {
    const world = this.game.world;
    if (!world.inBounds(tx, ty)) return false;
    const i = world.idx(tx, ty);
    if (world.flora[i] || world.building[i] >= 0 || world.fire[i] > 0) return false;
    const t = world.type[i];
    if (BARREN[t]) return false;
    if (t === TILE.FARMLAND && f !== FLORA.WHEAT) return false;
    if (world.height[i] < SEA_LEVEL && !(f === FLORA.REEDS && world.height[i] > SEA_LEVEL - 0.5)) return false;
    if (world.slopeAt(tx, ty) > 2.6 && !isTreeId(f)) return false;
    if (suitAt(world, f, tx, ty, i, this._tOff || 0) < 0.5) return false;
    if (f === FLORA.FLOWERS && flowerDrift(tx, ty) < 0.45) return false;
    const group = densityGroup(f);
    if (group === 1) {
      const cap = Math.max(1, Math.round((TREE_CAP[t] || 1) * (this._density ?? 1)));
      if (this.localCount(tx, ty, 1) >= cap) return false;
    } else if (group) {
      const cap = SPECIES[f].cap * (f === FLORA.MUSHROOM ? Math.min(2.5, this._fungi ?? 1) : 1);
      if (this.localCount(tx, ty, group) >= cap) return false;
    }
    return true;
  }

  spread(i, tx, ty, f, sp) {
    const world = this.game.world;
    const r = sp.spreadRadius;
    const dx = Math.round((this.rng() * 2 - 1) * r),
      dy = Math.round((this.rng() * 2 - 1) * r);
    if (!dx && !dy) return;
    const x = tx + dx,
      y = ty + dy;
    if (!world.inBounds(x, y)) return;
    const j = world.idx(x, y);
    let child = f;
    // trees seed the species that suits the landing spot (natural succession)
    if (isTreeId(f) && suitAt(world, f, x, y, j, this._tOff || 0) < 0.5) child = pickTree(world.type[j], world.temperature[j] + (this._tOff || 0), this.rng());
    // forests also scatter undergrowth beneath themselves
    if (isTreeId(f) && this.rng() < 0.3) child = pickUndergrowth(world.type[j], this.rng()) || child;
    if (child && this.lawAllows(child) && this.canSeed(child, x, y)) {
      world.setFlora(x, y, child, 0.03);
      this.stress[j] = 0;
      this.age[j] = 0;
    }
  }

  // ---- helpers for powers ----------------------------------------------------
  // Fertility: speeds growth and heals stress in a radius.
  bless(i, amount = 1) {
    this.boost[i] = Math.min(1, this.boost[i] + amount);
    this.stress[i] = Math.max(0, this.stress[i] - amount);
  }
  // Drought: adds stress (plants brown and may die).
  wither(i, amount) {
    this.stress[i] = Math.min(1, this.stress[i] + amount);
    this.boost[i] = 0;
  }

  stats() {
    return { trees: this.counts.trees, plants: this.counts.plants };
  }

  inspect() {
    return null;
  }
}

export { TILE, FLORA_INFO };
