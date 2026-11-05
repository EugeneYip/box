import { FLORA, FLORA_INFO, TILE, SEA_LEVEL } from '../../world/constants.js';
import { findPath } from './pathfinding.js';

// Core creature simulation (owned by the Life module; the Civilization module
// programs humanoid behaviour through registerBrain / unit.job).
//
// PUBLIC CONTRACT
//   game.units.list                      live units (array, do not mutate)
//   game.units.byId                      Map id -> unit
//   game.units.spawn(speciesId, x, z, opts?) -> unit   opts: {kingdom, village, age, sex, name, data}
//   game.units.kill(unit, cause)
//   game.units.damage(unit, amount, source?)
//   game.units.damageArea(x, z, radius, amount, cause)  (falloff with distance)
//   game.units.query(x, z, r, filter?) -> unit[]
//   game.units.nearest(x, z, r, filter?) -> unit|null
//   game.units.moveTo(unit, x, z) -> bool   (A* path on walkable tiles)
//   game.units.registerBrain(speciesId, fn(unit, dt, game))  overrides AI
//   game.units.count(speciesId?) -> number
//   SPECIES / registerSpecies(def)
//
// Unit fields read by renderers: x, y, z, heading, species, def, age, scale,
// state ('idle'|'walk'|'run'|'attack'|'eat'|'work'|'sleep'|'swim'|'fly'|'dead'),
// anim (seconds, animation clock), kingdom, carry, job, hp, maxHp, alive,
// moving (bool), color (optional tint), data (free-form per-module data).
export const SPECIES = {};
export function registerSpecies(def) {
  SPECIES[def.id] = {
    name: def.id,
    kind: 'animal', // 'humanoid' | 'animal' | 'monster' | 'fish' | 'bird'
    habitat: 'land', // 'land' | 'water' | 'air'
    diet: 'herbivore', // 'herbivore' | 'carnivore' | 'omnivore'
    speed: 1.2, // tiles / game second
    hp: 20,
    damage: 2,
    attackRange: 0.8,
    attackCooldown: 1.2,
    lifespan: 20, // years
    maturity: 2, // years
    size: 1, // render scale multiplier
    breedChance: 0.02, // per think when fed & adult
    maxPopulation: 300,
    sight: 8,
    aggressive: false,
    prey: [],
    ...def,
  };
  return SPECIES[def.id];
}

registerSpecies({ id: 'human', name: 'Human', kind: 'humanoid', diet: 'omnivore', speed: 1.3, hp: 40, damage: 4, lifespan: 70, maturity: 16, breedChance: 0, maxPopulation: 3000, sight: 10 });
registerSpecies({ id: 'sheep', name: 'Sheep', diet: 'herbivore', speed: 0.9, hp: 18, damage: 0, lifespan: 12, maturity: 1.5, size: 1, breedChance: 0.035, maxPopulation: 220, sight: 6 });
registerSpecies({ id: 'wolf', name: 'Wolf', diet: 'carnivore', speed: 1.9, hp: 30, damage: 6, lifespan: 14, maturity: 2, size: 1, breedChance: 0.02, maxPopulation: 70, sight: 12, aggressive: true, prey: ['sheep', 'deer', 'chicken', 'rabbit'] });

const CELL = 8;
const THINK_INTERVAL = 0.6;

export class Units {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.byId = new Map();
    this.brains = new Map();
    this._nextId = 1;
    this._grid = new Map();
    this._pathBudget = 0;
    this._dead = [];
  }

  reset() {
    for (const u of this.list) u.alive = false;
    this.list.length = 0;
    this.byId.clear();
    this._grid.clear();
  }

  registerBrain(speciesId, fn) {
    this.brains.set(speciesId, fn);
  }

  seedInitial() {
    const g = this.game;
    const w = g.world;
    const rng = g.rng.fork('fauna');
    const place = (sp, n, pred) => {
      for (let k = 0; k < n; k++) {
        for (let t = 0; t < 200; t++) {
          const tx = rng.int(0, w.w - 1),
            ty = rng.int(0, w.h - 1);
          if (!w.isWalkable(tx, ty) || !pred(w.type[w.idx(tx, ty)])) continue;
          // spawn a small herd around the point
          const herd = sp === 'wolf' ? rng.int(2, 3) : rng.int(3, 6);
          for (let j = 0; j < herd; j++) {
            const x = tx + 0.5 + rng.float(-2, 2),
              z = ty + 0.5 + rng.float(-2, 2);
            const [hx, hy] = w.tileOf(x, z);
            if (w.isWalkable(hx, hy)) this.spawn(sp, x, z, { age: rng.float(1, 6) });
          }
          break;
        }
      }
    };
    const scale = (w.w * w.h) / (256 * 256);
    place('sheep', Math.round(14 * scale), (t) => t === TILE.GRASS || t === TILE.SAVANNA);
    place('wolf', Math.round(5 * scale), (t) => t === TILE.FOREST || t === TILE.TUNDRA || t === TILE.GRASS);
  }

  spawn(speciesId, x, z, opts = {}) {
    const def = SPECIES[speciesId];
    if (!def) {
      console.warn('unknown species', speciesId);
      return null;
    }
    const rng = this.game.rng;
    const u = {
      id: this._nextId++,
      species: speciesId,
      def,
      x,
      z,
      y: this.game.world.surfaceAt(x, z),
      px: x,
      pz: z,
      heading: rng.float(0, Math.PI * 2),
      vx: 0,
      vz: 0,
      hp: def.hp,
      maxHp: def.hp,
      age: opts.age ?? 0,
      hunger: rng.float(0, 0.3),
      sex: opts.sex || (rng.chance(0.5) ? 'm' : 'f'),
      alive: true,
      state: 'idle',
      stateTime: 0,
      anim: rng.float(0, 10),
      moving: false,
      target: null,
      path: null,
      pathIdx: 0,
      kingdom: opts.kingdom ?? -1,
      village: opts.village ?? -1,
      job: null,
      carry: null,
      name: opts.name || null,
      level: 1,
      kills: 0,
      attackCd: 0,
      thinkT: rng.float(0, THINK_INTERVAL),
      scale: 1,
      color: opts.color ?? null,
      lastHurt: -99,
      bornAt: this.game.time.total,
      data: opts.data || {},
    };
    this.list.push(u);
    this.byId.set(u.id, u);
    this._gridAdd(u);
    this.game.events.emit('unit:spawn', { unit: u });
    return u;
  }

  kill(u, cause = 'unknown') {
    if (!u.alive) return;
    u.alive = false;
    u.hp = 0;
    u.state = 'dead';
    this._dead.push(u);
    this.game.events.emit('unit:death', { unit: u, cause });
  }

  damage(u, amount, source = null) {
    if (!u.alive) return;
    u.hp -= amount;
    u.lastHurt = this.game.time.total;
    if (source && source.alive) u.data.attacker = source.id;
    if (u.hp <= 0) {
      if (source) source.kills = (source.kills || 0) + 1;
      this.kill(u, source ? 'killed' : 'damage');
    }
  }

  damageArea(x, z, radius, amount, cause = 'disaster') {
    for (const u of this.query(x, z, radius)) {
      const d = Math.hypot(u.x - x, u.z - z) / Math.max(radius, 0.001);
      const dmg = amount * (1 - d * 0.7);
      u.hp -= dmg;
      u.lastHurt = this.game.time.total;
      if (u.hp <= 0) this.kill(u, cause);
    }
  }

  count(speciesId = null) {
    if (!speciesId) return this.list.length;
    let n = 0;
    for (const u of this.list) if (u.species === speciesId) n++;
    return n;
  }

  // ---- spatial hash ------------------------------------------------------
  _key(cx, cz) {
    return cx * 4096 + cz;
  }
  _gridAdd(u) {
    u._cx = Math.floor(u.x / CELL);
    u._cz = Math.floor(u.z / CELL);
    const k = this._key(u._cx, u._cz);
    let cell = this._grid.get(k);
    if (!cell) this._grid.set(k, (cell = []));
    cell.push(u);
  }
  _gridRemove(u) {
    const cell = this._grid.get(this._key(u._cx, u._cz));
    if (!cell) return;
    const i = cell.indexOf(u);
    if (i >= 0) {
      cell[i] = cell[cell.length - 1];
      cell.pop();
    }
  }
  _gridUpdate(u) {
    const cx = Math.floor(u.x / CELL),
      cz = Math.floor(u.z / CELL);
    if (cx !== u._cx || cz !== u._cz) {
      this._gridRemove(u);
      this._gridAdd(u);
    }
  }
  query(x, z, r, filter = null) {
    const out = [];
    const x0 = Math.floor((x - r) / CELL),
      x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL),
      z1 = Math.floor((z + r) / CELL);
    const r2 = r * r;
    for (let cx = x0; cx <= x1; cx++)
      for (let cz = z0; cz <= z1; cz++) {
        const cell = this._grid.get(this._key(cx, cz));
        if (!cell) continue;
        for (const u of cell) {
          if (!u.alive) continue;
          const dx = u.x - x,
            dz = u.z - z;
          if (dx * dx + dz * dz <= r2 && (!filter || filter(u))) out.push(u);
        }
      }
    return out;
  }
  nearest(x, z, r, filter = null) {
    let best = null,
      bd = Infinity;
    for (const u of this.query(x, z, r, filter)) {
      const d = (u.x - x) ** 2 + (u.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = u;
      }
    }
    return best;
  }

  // ---- movement ----------------------------------------------------------
  canStand(u, tx, ty) {
    const w = this.game.world;
    if (!w.inBounds(tx, ty)) return false;
    if (u.def.habitat === 'water') return w.isWater(tx, ty);
    if (u.def.habitat === 'air') return true;
    return w.isWalkable(tx, ty);
  }

  // Path to world position. Returns false if unreachable / budget exhausted.
  moveTo(u, x, z) {
    const w = this.game.world;
    const [sx, sy] = w.tileOf(u.x, u.z);
    const [gx, gy] = w.tileOf(x, z);
    u.target = { x, z };
    if (u.def.habitat === 'air' || (Math.abs(sx - gx) + Math.abs(sy - gy) <= 2)) {
      u.path = null;
      return true;
    }
    if (this._pathBudget <= 0) {
      u.path = null; // straight-line fallback this tick
      return true;
    }
    this._pathBudget--;
    const path = findPath(w, sx, sy, gx, gy, (tx, ty) => this.canStand(u, tx, ty), 3000);
    if (!path) {
      u.target = null;
      u.path = null;
      return false;
    }
    u.path = path;
    u.pathIdx = 0;
    return true;
  }

  stop(u) {
    u.target = null;
    u.path = null;
  }

  _locomote(u, dt) {
    let tx, tz;
    if (u.path && u.pathIdx < u.path.length) {
      const i = u.path[u.pathIdx];
      const w = this.game.world.w;
      tx = (i % w) + 0.5;
      tz = Math.floor(i / w) + 0.5;
      if (u.pathIdx === u.path.length - 1 && u.target) {
        tx = u.target.x;
        tz = u.target.z;
      }
    } else if (u.target) {
      tx = u.target.x;
      tz = u.target.z;
    } else {
      u.moving = false;
      return;
    }
    const dx = tx - u.x,
      dz = tz - u.z;
    const d = Math.hypot(dx, dz);
    const run = u.state === 'run' || u.state === 'flee' || u.state === 'hunt';
    const sp = u.def.speed * (run ? 1.6 : 1) * (u.age < u.def.maturity ? 0.8 : 1);
    if (d < 0.12) {
      if (u.path && u.pathIdx < u.path.length - 1) u.pathIdx++;
      else {
        u.path = null;
        u.target = null;
        u.moving = false;
      }
      return;
    }
    const stepLen = Math.min(d, sp * dt);
    const nx = u.x + (dx / d) * stepLen,
      nz = u.z + (dz / d) * stepLen;
    const [ntx, nty] = this.game.world.tileOf(nx, nz);
    if (!this.canStand(u, ntx, nty)) {
      // blocked: drop path, try again next think
      u.path = null;
      u.target = null;
      u.moving = false;
      return;
    }
    u.x = nx;
    u.z = nz;
    u.moving = true;
    const want = Math.atan2(dx, dz);
    let da = want - u.heading;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    u.heading += da * Math.min(1, dt * 10);
  }

  // ---- default AI ----------------------------------------------------------
  wander(u, radius = 6) {
    const rng = this.game.rng;
    for (let t = 0; t < 6; t++) {
      const x = u.x + rng.float(-radius, radius),
        z = u.z + rng.float(-radius, radius);
      const [tx, ty] = this.game.world.tileOf(x, z);
      if (this.canStand(u, tx, ty)) {
        this.moveTo(u, x, z);
        u.state = 'walk';
        return true;
      }
    }
    return false;
  }

  _defaultBrain(u, dt) {
    const g = this.game;
    const w = g.world;
    const def = u.def;
    // flee from predators
    if (def.diet === 'herbivore') {
      const threat = this.nearest(u.x, u.z, def.sight * 0.6, (o) => o.def.prey?.includes(u.species));
      if (threat) {
        const ax = u.x - threat.x,
          az = u.z - threat.z;
        const l = Math.hypot(ax, az) || 1;
        u.state = 'flee';
        u.path = null;
        u.target = { x: u.x + (ax / l) * 5, z: u.z + (az / l) * 5 };
        const [tx, ty] = w.tileOf(u.target.x, u.target.z);
        if (!this.canStand(u, tx, ty)) this.wander(u, 4);
        return;
      }
    }
    // hunt
    if (def.diet === 'carnivore' && u.hunger > 0.35) {
      const prey = this.nearest(u.x, u.z, def.sight, (o) => def.prey.includes(o.species));
      if (prey) {
        const d = Math.hypot(prey.x - u.x, prey.z - u.z);
        if (d <= def.attackRange) {
          u.state = 'attack';
          u.target = null;
          u.path = null;
          if (u.attackCd <= 0) {
            this.damage(prey, def.damage, u);
            u.attackCd = def.attackCooldown;
            g.fx.emit('blood', { x: prey.x, z: prey.z });
            if (!prey.alive) u.hunger = Math.max(0, u.hunger - 0.7);
          }
        } else {
          u.state = 'hunt';
          u.path = null;
          u.target = { x: prey.x, z: prey.z };
        }
        return;
      }
    }
    // graze
    if (def.diet !== 'carnivore' && u.hunger > 0.4) {
      const [tx, ty] = w.tileOf(u.x, u.z);
      const i = w.idx(tx, ty);
      const t = w.type[i];
      if (t === TILE.GRASS || t === TILE.SAVANNA || t === TILE.FOREST || t === TILE.JUNGLE || t === TILE.TUNDRA) {
        u.state = 'eat';
        u.stateTime = 0;
        u.hunger = Math.max(0, u.hunger - 0.25);
        this.stop(u);
        return;
      }
    }
    // breed
    if (def.breedChance > 0 && u.age > def.maturity && u.hunger < 0.35 && u.sex === 'f' && this.count(u.species) < def.maxPopulation) {
      if (g.rng.chance(def.breedChance)) {
        const mate = this.nearest(u.x, u.z, 5, (o) => o.species === u.species && o.sex === 'm' && o.age > def.maturity);
        if (mate) {
          const baby = this.spawn(u.species, u.x + g.rng.float(-0.4, 0.4), u.z + g.rng.float(-0.4, 0.4), { age: 0 });
          if (baby) g.fx.emit('heal', { x: baby.x, z: baby.z }, { scale: 0.6 });
        }
      }
    }
    if (!u.target && g.rng.chance(0.45)) this.wander(u, def.diet === 'carnivore' ? 9 : 5);
    else if (!u.target) u.state = 'idle';
  }

  // ---- tick ----------------------------------------------------------------
  tick(dt) {
    const g = this.game;
    this._pathBudget = 24;
    const yearDt = dt / 30;
    for (let k = 0; k < this.list.length; k++) {
      const u = this.list[k];
      if (!u.alive) continue;
      u.px = u.x;
      u.pz = u.z;
      u.age += yearDt;
      u.hunger = Math.min(1, u.hunger + dt * 0.006);
      u.attackCd -= dt;
      u.stateTime += dt;
      if (u.hunger >= 1 && u.def.kind !== 'humanoid') {
        u.hp -= dt * 0.5;
        if (u.hp <= 0) {
          this.kill(u, 'starvation');
          continue;
        }
      }
      if (u.age > u.def.lifespan) {
        this.kill(u, 'old age');
        continue;
      }
      // drowning / burning
      const [tx, ty] = g.world.tileOf(u.x, u.z);
      const ti = g.world.idx(tx, ty);
      if (g.world.fire[ti] > 0.2 && u.def.habitat !== 'water') this.damage(u, dt * 8 * g.world.fire[ti]);
      if (g.world.type[ti] === TILE.LAVA && u.def.habitat === 'land') this.damage(u, dt * 60);
      if (!u.alive) continue;
      if (u.def.habitat === 'land' && g.world.height[ti] < SEA_LEVEL - 0.3) {
        u.state = 'swim';
        // swim toward nearest land
        if (!u.target) this.wander(u, 3);
      }
      u.thinkT -= dt;
      if (u.thinkT <= 0) {
        u.thinkT = THINK_INTERVAL * (0.8 + g.rng.next() * 0.4);
        const brain = this.brains.get(u.species);
        try {
          if (brain) brain(u, THINK_INTERVAL, g);
          else this._defaultBrain(u, THINK_INTERVAL);
        } catch (err) {
          console.error('[brain]', u.species, err);
          this.brains.delete(u.species);
        }
      }
      if (u.alive) {
        this._locomote(u, dt);
        u.y = u.def.habitat === 'land' ? g.world.surfaceAt(u.x, u.z) : u.def.habitat === 'water' ? SEA_LEVEL - 0.2 : g.world.surfaceAt(u.x, u.z) + 6;
        u.anim += dt * (u.moving ? 1 : 0.35);
        this._gridUpdate(u);
      }
    }
    if (this._dead.length) {
      for (const u of this._dead) {
        this._gridRemove(u);
        this.byId.delete(u.id);
      }
      this.list = this.list.filter((u) => u.alive);
      this._dead.length = 0;
    }
  }

  inspect(hit) {
    const u = this.nearest(hit.x, hit.z, 1.5);
    if (!u) return null;
    return {
      priority: 10,
      kind: 'unit',
      unit: u,
      title: u.name || u.def.name,
      subtitle: u.def.name + (u.kingdom >= 0 ? ' · ' + (this.game.civ.kingdomName?.(u.kingdom) || 'Kingdom ' + u.kingdom) : ''),
      stats: [
        ['Age', Math.floor(u.age) + ' yrs'],
        ['Health', Math.ceil(u.hp) + ' / ' + u.maxHp],
        ['Hunger', Math.round(u.hunger * 100) + '%'],
        ['State', u.job || u.state],
        ['Kills', u.kills],
      ],
    };
  }

  stats() {
    const out = { population: 0, animals: 0 };
    for (const u of this.list) {
      if (u.def.kind === 'humanoid') out.population++;
      else out.animals++;
    }
    return out;
  }
}

export { FLORA, FLORA_INFO };
