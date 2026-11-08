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

export class FloraSim {
  constructor(game) {
    this.game = game;
    const n = game.world.size;
    this.stress = new Float32Array(n); // 0 healthy .. 1 dead (read by the renderer)
    this.age = new Float32Array(n); // seconds since the plant matured / tile burnt
    this.boost = new Float32Array(n); // growth multiplier bonus from the bloom power (decays)
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
    const dt = sweep;
    // World Laws, read each tick so a toggle applies on the next one
    const laws = this.game.laws || {};
    this._grow = laws.natureGrowth !== false;
    this._regrow = laws.natureRegrowth !== false;
    // hard time budget per tick: leftover visits carry over (bounded)
    const t0 = performance.now();
    let k = 0;
    while (count-- > 0) {
      if ((++k & 255) === 0 && performance.now() - t0 > TICK_BUDGET_MS) {
        this._acc = Math.min(this._acc + count + 1, (n * step * 4) / sweep);
        break;
      }
      const i = this._cursor;
      if (++this._cursor >= n) {
        this._cursor = 0;
        this.counts = this._countAcc;
        this._countAcc = { trees: 0, plants: 0 };
      }
      this.visit(i, dt);
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
          const nb = naturalBiome(world, i);
          world.setType(tx, ty, nb === TILE.SAND && world.height[i] > SEA_LEVEL + 0.7 ? TILE.GRASS : nb);
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
        if (p && this._grow !== false && this.rng() < p * (1 + this.boost[i] * 10)) {
          const u = pickUndergrowth(t, this.rng());
          if (u && this.canSeed(u, tx, ty)) world.setFlora(tx, ty, u, 0.04);
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
          const tree = pickTree(t, world.temperature[i], this.rng());
          if (tree && this._grow !== false && this.rng() < 0.35 && suitAt(world, tree, tx, ty, i) >= 0.5) world.setFlora(tx, ty, tree, 0.03);
          else world.setFlora(tx, ty, FLORA.NONE);
        }
      }
      return;
    }

    // ---- stress from hostile ground ------------------------------------------
    const suit = suitAt(world, f, tx, ty, i);
    if (this.stress[i] >= 0.999) {
      this.die(i, tx, ty, f, sp);
      return;
    }
    if (suit < 0.15) {
      this.stress[i] = Math.min(1, this.stress[i] + dt / (sp.stressTime * (1 + suit * 4)));
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
      const rate = (dt / sp.growTime) * fert * (0.85 + this.hash(i) * 0.3) * (1 + this.boost[i] * 5);
      const before = g;
      g = Math.min(1, g + rate);
      world.floraGrowth[i] = g;
      if (Math.floor(before * 4) !== Math.floor(g * 4)) world.markDirty('flora', tx, ty);
      return;
    }

    // ---- mature life ------------------------------------------------------------
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
    if (sp.spread > 0 && suit >= 0.35 && this.rng() < sp.spread * (dt / SWEEP) * (1 + this.boost[i] * 3)) this.spread(i, tx, ty, f, sp);
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
    if (suitAt(world, f, tx, ty, i) < 0.5) return false;
    if (f === FLORA.FLOWERS && flowerDrift(tx, ty) < 0.45) return false;
    const group = densityGroup(f);
    if (group === 1) {
      const cap = TREE_CAP[t] || 1;
      if (this.localCount(tx, ty, 1) >= cap) return false;
    } else if (group) {
      if (this.localCount(tx, ty, group) >= SPECIES[f].cap) return false;
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
    if (isTreeId(f) && suitAt(world, f, x, y, j) < 0.5) child = pickTree(world.type[j], world.temperature[j], this.rng());
    // forests also scatter undergrowth beneath themselves
    if (isTreeId(f) && this.rng() < 0.3) child = pickUndergrowth(world.type[j], this.rng()) || child;
    if (child && this.canSeed(child, x, y)) {
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
