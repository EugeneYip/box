import { FLORA, FLORA_INFO, TILE, TILE_INFO, SEA_LEVEL, SHALLOW_DEPTH } from '../../world/constants.js';
import { findPath } from './pathfinding.js';
import { SPECIES, registerSpecies } from './species.js';
import { BRAINS, BRAIN_TICKS } from './brains.js';
import { makeName, makeMonsterName } from './names.js';

// Core creature simulation (owned by the Life module; the Civilization module
// programs humanoid behaviour through registerBrain / unit.job).
//
// PUBLIC CONTRACT
//   game.units.list                      live units (array, do not mutate)
//   game.units.byId                      Map id -> unit
//   game.units.spawn(speciesId, x, z, opts?) -> unit
//        opts: {kingdom, village, age, sex, name, data, herd, pack, home:{x,z}, color, scale}
//   game.units.kill(unit, cause, killer?)
//   game.units.damage(unit, amount, source?, opts?)   opts: {cause, knock, dirX, dirZ}
//   game.units.damageArea(x, z, radius, amount, cause)  (falloff with distance)
//   game.units.heal(unit, amount)
//   game.units.query(x, z, r, filter?) -> unit[]
//   game.units.nearest(x, z, r, filter?) -> unit|null
//   game.units.forEachNear(x, z, r, fn(unit, distSq))  allocation-free query
//   game.units.moveTo(unit, x, z) -> bool   (A* path; may wade through shallows)
//   game.units.stop(unit), wander(unit, radius), flee(unit, fromX, fromZ, dist?)
//   game.units.registerBrain(speciesId, fn(unit, dt, game))  overrides AI
//   game.units.count(speciesId?) -> number,  census() -> {speciesId: n}
//   game.units.engage(attacker, target, opts?) -> bool   COMBAT (Civilization uses it;
//        false when refused: invalid/dead/self target or attacker with no attack damage)
//        Approaches the target (pathing, flanking), attacks on cooldown with
//        damage, knockback, fx 'hit'/'blood' and audio 'hit', until one dies,
//        the target escapes, or disengage() is called. opts: {hunt, maxTime}
//   game.units.disengage(unit)
//   game.units.isHostile(a, b) -> bool   (uses a.data.hostile(b) when set by Civilization)
//   game.units.shoot(attacker, target, opts?)  arrow projectile (units with data.ranged)
//   game.units.setMad(unit, seconds), bless(unit, seconds)
//   SPECIES / registerSpecies(def)
//
// Unit fields read by renderers: x, y, z, heading, species, def, age, scale,
// state ('idle'|'walk'|'run'|'attack'|'eat'|'work'|'sleep'|'swim'|'fly'|'flee'|'hunt'|'dead'),
// anim (seconds, animation clock), kingdom, carry, job, hp, maxHp, alive,
// moving (bool), color (optional tint), data (free-form per-module data).
// Added by Life: px/pz/py/ph (previous tick pose, for interpolation), speedNow,
// swimming, wading, sleeping, lastAttack (time of last swing), lastHurt, mad,
// blessed (game time until), emote {kind, until}, activity ('talk'|'fish'|...),
// hunger (0 fed .. 1 starving), energy (0 exhausted .. 1 rested), pregnant.
// Hooks honoured: unit.data.hostile(other) -> bool (enemies), unit.data.hidden or
// unit.data.inside === true (not rendered, e.g. inside a house), unit.data.ranged (shoots arrows),
// unit.data.autoAggro (engage hostiles in sight; default for job 'soldier'),
// unit.data.damage (attack damage override).
// Events emitted (additive): 'unit:hurt' {unit, amount, source},
// 'unit:attack' {unit, target, damage}, 'unit:birth' {unit, parent}.
export { SPECIES, registerSpecies };

const YEAR = 30; // == YEAR_SECONDS (src/core/Game.js); duplicated to avoid an import cycle
const CELL = 4;
const THINK_INTERVAL = 0.6;
const PATH_BUDGET = 40;

const KIND_ORDER = { humanoid: 0, animal: 1, monster: 2 };

export class Units {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.byId = new Map();
    this.brains = new Map();
    this._nextId = 1;
    this._pathBudget = 0;
    this._dead = [];
    this._counts = new Map();
    this.packs = new Map();
    this.carcasses = [];
    this.projectiles = [];
    this.migration = true;
    this._extinct = new Map();
    this._nextGroup = 1;
    this.tickDt = 1 / 15;
    this.lastTick = 0;
    this._tickN = 0;
    this._migrateT = 0;
    this._initGrid();
  }

  _initGrid() {
    const w = this.game.world;
    this._gw = Math.ceil(w.w / CELL) + 1;
    this._gh = Math.ceil(w.h / CELL) + 1;
    this._cells = new Array(this._gw * this._gh);
    for (let i = 0; i < this._cells.length; i++) this._cells[i] = [];
  }

  reset() {
    for (const u of this.list) u.alive = false;
    this.list.length = 0;
    this.byId.clear();
    this._counts.clear();
    this.packs.clear();
    this.carcasses.length = 0;
    this.projectiles.length = 0;
    this._extinct.clear();
    this._dead.length = 0;
    this._initGrid();
  }

  registerBrain(speciesId, fn) {
    this.brains.set(speciesId, fn);
  }

  get areaScale() {
    const w = this.game.world;
    return (w.w * w.h) / (256 * 256);
  }
  capacity(speciesId) {
    const def = SPECIES[speciesId];
    return def ? Math.max(4, Math.round(def.maxPopulation * this.areaScale)) : 0;
  }

  // ---- initial fauna -------------------------------------------------------
  seedInitial() {
    const g = this.game;
    const w = g.world;
    const rng = g.rng.fork('fauna');
    const scale = this.areaScale;
    for (const def of Object.values(SPECIES)) {
      if (!def.seed) continue;
      const groups = Math.max(1, Math.round(def.seed.groups * scale));
      for (let k = 0; k < groups; k++) this.spawnGroup(def.id, null, null, rng);
    }
  }

  // Spawn a herd / pack / single creature in suitable habitat. With x/z null a
  // random suitable spot is chosen. Returns the spawned units.
  spawnGroup(speciesId, x = null, z = null, rng = this.game.rng, size = null) {
    const def = SPECIES[speciesId];
    const w = this.game.world;
    if (!def) return [];
    const tiles = def.seed?.tiles;
    let cx = x,
      cz = z;
    if (cx == null) {
      let ok = false;
      for (let t = 0; t < 300 && !ok; t++) {
        const tx = rng.int(2, w.w - 3),
          ty = rng.int(2, w.h - 3);
        if (!w.isWalkable(tx, ty)) continue;
        if (tiles && !tiles.includes(w.type[w.idx(tx, ty)])) continue;
        if (w.building[w.idx(tx, ty)] >= 0) continue;
        cx = tx + 0.5;
        cz = ty + 0.5;
        ok = true;
      }
      if (!ok) return [];
    }
    const n = size ?? (def.seed ? rng.int(def.seed.size[0], def.seed.size[1]) : 1);
    const group = this._nextGroup++;
    const out = [];
    for (let j = 0; j < n; j++) {
      let px = cx,
        pz = cz;
      for (let t = 0; t < 8; t++) {
        px = cx + rng.float(-1.6, 1.6);
        pz = cz + rng.float(-1.6, 1.6);
        const [hx, hy] = w.tileOf(px, pz);
        if (w.isWalkable(hx, hy)) break;
        px = cx;
        pz = cz;
      }
      const adult = j < 2 || rng.chance(0.7);
      const age = adult ? rng.float(def.maturity * 1.1, Math.max(def.maturity * 1.2, def.lifespan * 0.6)) : rng.float(0.1, def.maturity * 0.8);
      const u = this.spawn(speciesId, px, pz, {
        age,
        sex: n === 1 ? (rng.chance(0.5) ? 'f' : 'm') : j === 0 ? 'f' : j === 1 ? 'm' : undefined,
        herd: def.herd ? group : 0,
        pack: def.pack ? group : 0,
        home: { x: cx, z: cz },
      });
      if (u) out.push(u);
    }
    return out;
  }

  // ---- lifecycle -------------------------------------------------------------
  spawn(speciesId, x, z, opts = {}) {
    const def = SPECIES[speciesId];
    if (!def) {
      console.warn('unknown species', speciesId);
      return null;
    }
    const g = this.game;
    const w = g.world;
    const rng = g.rng;
    x = Math.min(w.w - 0.01, Math.max(0.01, x));
    z = Math.min(w.h - 0.01, Math.max(0.01, z));
    const sex = opts.sex || (rng.chance(0.5) ? 'm' : 'f');
    const data = opts.data || {};
    let name = opts.name || null;
    if (!name && def.kind === 'humanoid') name = makeName(rng, data.culture, sex);
    if (!name && def.kind === 'monster') name = makeMonsterName(rng, speciesId);
    const u = {
      id: this._nextId++,
      species: speciesId,
      def,
      x,
      z,
      y: 0,
      px: x,
      pz: z,
      py: 0,
      heading: opts.heading ?? rng.float(0, Math.PI * 2),
      ph: 0,
      vx: 0,
      vz: 0,
      spd: 0,
      speedNow: 0,
      hp: def.hp,
      maxHp: def.hp,
      age: opts.age ?? 0,
      lifespan: def.lifespan * rng.float(0.85, 1.15),
      hunger: rng.float(0, 0.3),
      energy: rng.float(0.65, 1),
      sex,
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
      name,
      level: 1,
      xp: 0,
      kills: 0,
      attackCd: 0,
      thinkT: rng.float(0, THINK_INTERVAL),
      scale: opts.scale ?? 1,
      color: opts.color ?? null,
      lastHurt: -99,
      lastAttack: -99,
      bornAt: g.time.total,
      data,
      // Life additions
      herd: opts.herd || 0,
      pack: opts.pack || 0,
      home: opts.home ? { x: opts.home.x, z: opts.home.z } : { x, z },
      sleeping: false,
      swimming: false,
      wading: false,
      pregnant: 0,
      lastBirth: -99,
      combat: null,
      mad: 0,
      blessed: 0,
      emote: null,
      activity: null,
      busyUntil: 0,
      fleeUntil: 0,
      kbx: 0,
      kbz: 0,
      sepx: 0,
      sepz: 0,
      alt: 0,
      altGoal: 0,
      blockedT: 0,
      _wantPath: false,
      _cell: -1,
    };
    if (def.habitat === 'air') {
      u.alt = opts.alt ?? 6;
      u.altGoal = u.alt;
      u.state = 'fly';
    }
    u.y = this._groundY(u);
    u.py = u.y;
    u.ph = u.heading;
    if (def.pack && u.pack) this._packJoin(u);
    this.list.push(u);
    this.byId.set(u.id, u);
    this._counts.set(speciesId, (this._counts.get(speciesId) || 0) + 1);
    this._gridAdd(u);
    g.events.emit('unit:spawn', { unit: u });
    return u;
  }

  kill(u, cause = 'unknown', killer = null) {
    if (!u || !u.alive) return;
    const g = this.game;
    u.alive = false;
    u.hp = 0;
    u.state = 'dead';
    u.deathTime = g.time.total;
    u.deathCause = cause;
    u.combat = null;
    this._dead.push(u);
    this._counts.set(u.species, Math.max(0, (this._counts.get(u.species) || 1) - 1));
    if (killer && killer.alive && killer.def.diet !== 'herbivore' && u.def.food > 0 && killer.def.kind !== 'monster') {
      const adultK = u.age < u.def.maturity ? 0.45 : 1;
      this.carcasses.push({ x: u.x, z: u.z, food: u.def.food * adultK, until: g.time.total + 30, species: u.species, id: u.id });
      u.data.carcass = true;
    }
    if (cause === 'old age' || cause === 'starvation') g.fx.emit?.('death', { x: u.x, y: u.y + 0.2, z: u.z }, { scale: u.def.size * 0.6 });
    g.events.emit('unit:death', { unit: u, cause, killer });
  }

  damage(u, amount, source = null, opts = {}) {
    if (!u || !u.alive || !(amount > 0)) return;
    const g = this.game;
    const now = g.time.total;
    if (u.blessed > now) amount *= 0.6;
    u.hp -= amount;
    u.lastHurt = now;
    if (source && source.alive) u.data.attacker = source.id;
    if (opts.knock) {
      const k = opts.knock / Math.max(0.3, u.def.mass);
      u.kbx += (opts.dirX || 0) * k * 4;
      u.kbz += (opts.dirZ || 0) * k * 4;
    }
    g.events.emit('unit:hurt', { unit: u, amount, source });
    if (u.hp <= 0) {
      if (source) {
        source.kills = (source.kills || 0) + 1;
        this._gainXp(source, u.maxHp * 0.25);
      }
      this.kill(u, source ? 'killed' : opts.cause || 'damage', source);
      return;
    }
    if (u.sleeping) this._wake(u);
    if (source && source.alive && source !== u) this._react(u, source);
  }

  heal(u, amount) {
    if (!u || !u.alive) return;
    u.hp = Math.min(u.maxHp, u.hp + amount);
  }

  damageArea(x, z, radius, amount, cause = 'disaster') {
    const hits = this.query(x, z, radius + 0.5);
    for (const u of hits) {
      const dx = u.x - x,
        dz = u.z - z;
      const dd = Math.hypot(dx, dz);
      if (dd > radius + u.def.radius) continue;
      const d = Math.min(1, dd / Math.max(radius, 0.001));
      const dmg = amount * (1 - d * 0.7);
      const l = dd || 1;
      this.damage(u, dmg, null, { cause, knock: Math.min(1.5, amount * 0.02), dirX: dx / l, dirZ: dz / l });
    }
  }

  _gainXp(u, xp) {
    u.xp = (u.xp || 0) + xp;
    const lvl = 1 + Math.floor(Math.sqrt(u.xp / 12));
    if (lvl > u.level) {
      const k = 1 + 0.08 * (lvl - u.level);
      u.maxHp *= k;
      u.hp = Math.min(u.maxHp, u.hp * k + u.maxHp * 0.1);
      u.level = lvl;
    }
  }

  count(speciesId = null) {
    if (!speciesId) return this.list.length;
    return this._counts.get(speciesId) || 0;
  }
  census() {
    const out = {};
    for (const [k, v] of this._counts) if (v) out[k] = v;
    return out;
  }

  // ---- spatial hash ------------------------------------------------------
  _cellOf(x, z) {
    const cx = Math.max(0, Math.min(this._gw - 1, Math.floor(x / CELL)));
    const cz = Math.max(0, Math.min(this._gh - 1, Math.floor(z / CELL)));
    return cz * this._gw + cx;
  }
  _gridAdd(u) {
    u._cell = this._cellOf(u.x, u.z);
    this._cells[u._cell].push(u);
  }
  _gridRemove(u) {
    const cell = this._cells[u._cell];
    if (!cell) return;
    const i = cell.indexOf(u);
    if (i >= 0) {
      cell[i] = cell[cell.length - 1];
      cell.pop();
    }
  }
  _gridUpdate(u) {
    const c = this._cellOf(u.x, u.z);
    if (c !== u._cell) {
      this._gridRemove(u);
      u._cell = c;
      this._cells[c].push(u);
    }
  }
  forEachNear(x, z, r, fn) {
    const x0 = Math.max(0, Math.floor((x - r) / CELL)),
      x1 = Math.min(this._gw - 1, Math.floor((x + r) / CELL));
    const z0 = Math.max(0, Math.floor((z - r) / CELL)),
      z1 = Math.min(this._gh - 1, Math.floor((z + r) / CELL));
    const r2 = r * r;
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        const cell = this._cells[cz * this._gw + cx];
        for (let i = 0; i < cell.length; i++) {
          const u = cell[i];
          if (!u.alive) continue;
          const dx = u.x - x,
            dz = u.z - z;
          const d2 = dx * dx + dz * dz;
          if (d2 <= r2) fn(u, d2);
        }
      }
  }
  query(x, z, r, filter = null) {
    const out = [];
    this.forEachNear(x, z, r, (u) => {
      if (!filter || filter(u)) out.push(u);
    });
    return out;
  }
  nearest(x, z, r, filter = null) {
    let best = null,
      bd = Infinity;
    this.forEachNear(x, z, r, (u, d2) => {
      if (d2 < bd && (!filter || filter(u))) {
        bd = d2;
        best = u;
      }
    });
    return best;
  }

  // ---- terrain helpers -------------------------------------------------------
  canStand(u, tx, ty) {
    const w = this.game.world;
    if (!w.inBounds(tx, ty)) return false;
    const hab = u.def.habitat;
    if (hab === 'air') return true;
    const i = w.idx(tx, ty);
    const h = w.height[i];
    if (hab === 'water') return h < SEA_LEVEL - 0.3;
    if (h < SEA_LEVEL) {
      if (!u.def.canSwim) return false;
      return u.swimming || h > SEA_LEVEL - SHALLOW_DEPTH;
    }
    return TILE_INFO[w.type[i]].walkable && !FLORA_INFO[w.flora[i]].blocksMovement;
  }
  _pathable(u, tx, ty) {
    const w = this.game.world;
    if (!w.inBounds(tx, ty)) return false;
    const i = w.idx(tx, ty);
    const h = w.height[i];
    if (u.def.habitat === 'water') return h < SEA_LEVEL - 0.3;
    if (h < SEA_LEVEL) return u.def.canSwim && h > SEA_LEVEL - SHALLOW_DEPTH * 0.85;
    return TILE_INFO[w.type[i]].walkable && !FLORA_INFO[w.flora[i]].blocksMovement;
  }
  _pathCost(tx, ty) {
    const w = this.game.world;
    const i = ty * w.w + tx;
    let c = 0;
    if (w.height[i] < SEA_LEVEL) c += 3;
    if (w.fire[i] > 0) c += 6;
    if (w.type[i] === TILE.ROAD) c -= 0.25;
    return c;
  }
  _groundY(u) {
    const w = this.game.world;
    const h = w.heightAt(u.x, u.z);
    const hab = u.def.habitat;
    if (hab === 'water') return SEA_LEVEL;
    if (hab === 'air') return Math.max(h, SEA_LEVEL) + u.alt;
    return u.swimming ? SEA_LEVEL : h;
  }
  isLandAt(x, z) {
    const w = this.game.world;
    const [tx, ty] = w.tileOf(x, z);
    return w.isWalkable(tx, ty);
  }
  // Nearest tile (ring search) satisfying pred(tx, ty, index). Returns {x, z, tx, ty, i} or null.
  findNearestTile(x, z, maxR, pred) {
    const w = this.game.world;
    const cx = Math.floor(x),
      cz = Math.floor(z);
    for (let r = 0; r <= maxR; r++) {
      let best = null,
        bd = Infinity;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = cx + dx,
            ty = cz + dy;
          if (!w.inBounds(tx, ty)) continue;
          const i = ty * w.w + tx;
          if (!pred(tx, ty, i)) continue;
          const d = (tx + 0.5 - x) ** 2 + (ty + 0.5 - z) ** 2;
          if (d < bd) {
            bd = d;
            best = { x: tx + 0.5, z: ty + 0.5, tx, ty, i };
          }
        }
      if (best) return best;
    }
    return null;
  }

  // ---- movement ----------------------------------------------------------
  // Path to world position. Returns false if unreachable.
  moveTo(u, x, z) {
    const w = this.game.world;
    x = Math.min(w.w - 0.05, Math.max(0.05, x));
    z = Math.min(w.h - 0.05, Math.max(0.05, z));
    const [sx, sy] = w.tileOf(u.x, u.z);
    const [gx, gy] = w.tileOf(x, z);
    u.target = { x, z };
    u.blockedT = 0;
    u._wantPath = false;
    if (u.def.habitat === 'air' || Math.abs(sx - gx) + Math.abs(sy - gy) <= 2) {
      u.path = null;
      return true;
    }
    if (this._pathBudget <= 0) {
      u.path = null; // straight line until a path can be computed (next tick)
      u._wantPath = true;
      return true;
    }
    return this._computePath(u);
  }
  _computePath(u) {
    const w = this.game.world;
    this._pathBudget--;
    u._wantPath = false;
    const [sx, sy] = w.tileOf(u.x, u.z);
    const [gx, gy] = w.tileOf(u.target.x, u.target.z);
    const path = findPath(
      w,
      sx,
      sy,
      gx,
      gy,
      (tx, ty) => (tx === sx && ty === sy) || this._pathable(u, tx, ty),
      2500,
      u.def.habitat === 'land' ? (tx, ty) => this._pathCost(tx, ty) : null,
    );
    if (!path) {
      u.target = null;
      u.path = null;
      return false;
    }
    u.path = path;
    u.pathIdx = 0;
    // retarget to the reachable end if the goal itself was not reachable
    const last = path[path.length - 1];
    const lx = (last % w.w) + 0.5,
      lz = Math.floor(last / w.w) + 0.5;
    if (Math.abs(lx - u.target.x) > 1.5 || Math.abs(lz - u.target.z) > 1.5) u.target = { x: lx, z: lz };
    return true;
  }

  stop(u) {
    u.target = null;
    u.path = null;
    u._wantPath = false;
  }

  _locomote(u, dt, now) {
    const w = this.game.world;
    const def = u.def;
    // knockback impulse (decays quickly)
    if (u.kbx !== 0 || u.kbz !== 0) {
      const nx = u.x + u.kbx * dt,
        nz = u.z + u.kbz * dt;
      const [tx, ty] = w.tileOf(nx, nz);
      if (this.canStand(u, tx, ty) || def.habitat === 'air') {
        u.x = nx;
        u.z = nz;
      }
      const f = Math.exp(-dt * 9);
      u.kbx *= f;
      u.kbz *= f;
      if (Math.abs(u.kbx) + Math.abs(u.kbz) < 0.02) u.kbx = u.kbz = 0;
    }
    // separation (computed in a staggered pass)
    if (u.sepx !== 0 || u.sepz !== 0) {
      const nx = u.x + u.sepx * dt,
        nz = u.z + u.sepz * dt;
      const [tx, ty] = w.tileOf(nx, nz);
      if (this.canStand(u, tx, ty)) {
        u.x = nx;
        u.z = nz;
      }
    }
    if (u._wantPath && u.target && this._pathBudget > 0) this._computePath(u);
    let tx, tz;
    let final = true;
    if (u.path && u.pathIdx < u.path.length) {
      const i = u.path[u.pathIdx];
      tx = (i % w.w) + 0.5;
      tz = Math.floor(i / w.w) + 0.5;
      final = u.pathIdx === u.path.length - 1;
      if (final && u.target) {
        tx = u.target.x;
        tz = u.target.z;
      }
    } else if (u.target) {
      tx = u.target.x;
      tz = u.target.z;
    } else {
      u.spd *= Math.exp(-dt * 10);
      u.moving = false;
      return;
    }
    const dx = tx - u.x,
      dz = tz - u.z;
    const d = Math.hypot(dx, dz);
    if (d < (final ? 0.08 : 0.4)) {
      if (u.path && u.pathIdx < u.path.length - 1) u.pathIdx++;
      else {
        u.path = null;
        u.target = null;
        u.moving = false;
      }
      return;
    }
    const st = u.state;
    const running = st === 'run' || st === 'flee' || st === 'hunt' || (u.combat && st !== 'attack');
    let sp = def.speed * (running ? def.runMul : 1);
    if (u.age < def.maturity) sp *= 0.75 + 0.25 * Math.min(1, u.age / Math.max(0.01, def.maturity));
    if (u.energy < 0.25) sp *= 0.75;
    if (u.blessed > now) sp *= 1.15;
    if (u.mad > now) sp *= 1.1;
    if (u.data.speedMul) sp *= u.data.speedMul;
    if (u._pounce) sp *= 1.4;
    if (def.habitat === 'land') {
      if (u.swimming) sp *= def.swimMul;
      else if (u.wading) sp *= 0.75;
      else {
        // slope-aware: slower uphill, slightly faster downhill
        const h0 = w.heightAt(u.x, u.z);
        const h1 = w.heightAt(u.x + (dx / d) * 0.35, u.z + (dz / d) * 0.35);
        const grade = (h1 - h0) / 0.35;
        sp *= grade > 0 ? 1 / (1 + grade * 1.1) : Math.min(1.15, 1 - grade * 0.12);
      }
    }
    u.spd += (sp - u.spd) * Math.min(1, dt * def.accel);
    // smooth turning; slow down while facing away from the goal
    const want = Math.atan2(dx, dz);
    let da = want - u.heading;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    u.heading += da * Math.min(1, dt * def.turnRate);
    const facing = Math.max(0.15, 0.35 + 0.65 * Math.cos(da));
    const stepLen = Math.min(d, u.spd * facing * dt);
    let nx = u.x + (dx / d) * stepLen,
      nz = u.z + (dz / d) * stepLen;
    let [ntx, nty] = w.tileOf(nx, nz);
    if (!this.canStand(u, ntx, nty)) {
      // slide along the obstacle
      const [ax, ay] = w.tileOf(nx, u.z);
      const [bx, by] = w.tileOf(u.x, nz);
      if (this.canStand(u, ax, ay)) nz = u.z;
      else if (this.canStand(u, bx, by)) nx = u.x;
      else {
        u.blockedT += dt;
        u.moving = false;
        if (u.blockedT > 0.6) {
          u.path = null;
          u.target = null;
          u.blockedT = 0;
        }
        return;
      }
    }
    u.blockedT = 0;
    u.x = nx;
    u.z = nz;
    u.moving = true;
  }

  // Push overlapping units apart (staggered: each unit every 4th tick).
  _separate(u) {
    const r = u.def.radius;
    let sx = 0,
      sz = 0;
    const x = u.x,
      z = u.z;
    const R = r + 0.35;
    const x0 = Math.max(0, Math.floor((x - R) / CELL)),
      x1 = Math.min(this._gw - 1, Math.floor((x + R) / CELL));
    const z0 = Math.max(0, Math.floor((z - R) / CELL)),
      z1 = Math.min(this._gh - 1, Math.floor((z + R) / CELL));
    let n = 0;
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        const cell = this._cells[cz * this._gw + cx];
        for (let i = 0; i < cell.length && n < 8; i++) {
          const o = cell[i];
          if (o === u || !o.alive) continue;
          if ((o.def.habitat === 'air') !== (u.def.habitat === 'air')) continue;
          const dx = x - o.x,
            dz = z - o.z;
          const minD = (r + o.def.radius) * 0.95;
          const d2 = dx * dx + dz * dz;
          if (d2 >= minD * minD) continue;
          const d = Math.sqrt(d2) || 0.001;
          const push = (minD - d) / minD;
          const mw = o.def.mass / (o.def.mass + u.def.mass);
          sx += (d2 > 1e-6 ? dx / d : Math.cos(u.id)) * push * mw;
          sz += (d2 > 1e-6 ? dz / d : Math.sin(u.id)) * push * mw;
          n++;
        }
      }
    u.sepx = sx * 1.6;
    u.sepz = sz * 1.6;
  }

  // ---- behaviour helpers (used by brains, public for Civilization) -----------
  wander(u, radius = 6, anchor = null) {
    const rng = this.game.rng;
    const ax = anchor ? anchor.x : u.x,
      az = anchor ? anchor.z : u.z;
    for (let t = 0; t < 6; t++) {
      const x = ax + rng.float(-radius, radius),
        z = az + rng.float(-radius, radius);
      const [tx, ty] = this.game.world.tileOf(x, z);
      if (this._pathable(u, tx, ty) && (u.def.habitat !== 'land' || this.game.world.height[this.game.world.idx(tx, ty)] >= SEA_LEVEL)) {
        this.moveTo(u, x, z);
        if (u.def.habitat !== 'air') u.state = 'walk';
        return true;
      }
    }
    return false;
  }

  flee(u, fromX, fromZ, dist = 6) {
    const rng = this.game.rng;
    let ax = u.x - fromX,
      az = u.z - fromZ;
    const l = Math.hypot(ax, az) || 1;
    ax /= l;
    az /= l;
    const base = Math.atan2(ax, az);
    const tries = [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.2, -2.2];
    const w = this.game.world;
    const land = u.def.habitat === 'land';
    for (let pass = land ? 0 : 1; pass < 2; pass++)
    for (const off of tries) {
      const a = base + off + rng.float(-0.2, 0.2);
      const x = u.x + Math.sin(a) * dist,
        z = u.z + Math.cos(a) * dist;
      const [tx, ty] = w.tileOf(x, z);
      // first pass: dry land only (a midway sample too), second pass: anything passable
      if (pass === 0) {
        const [mx, my] = w.tileOf((x + u.x) / 2, (z + u.z) / 2);
        if (!w.isWalkable(tx, ty) || !w.isWalkable(mx, my)) continue;
      }
      if (this._pathable(u, tx, ty)) {
        u.path = null;
        u.target = { x, z };
        u._wantPath = Math.abs(off) > 0.6;
        u.state = 'flee';
        u.fleeUntil = this.game.time.total + 2.5 + rng.float(0, 1.5);
        u.sleeping = false;
        u.busyUntil = 0;
        u.activity = null;
        return true;
      }
    }
    return false;
  }

  emote(u, kind, dur = 2) {
    u.emote = { kind, until: this.game.time.total + dur, start: this.game.time.total };
  }

  isHostile(a, b) {
    if (!a || !b || a === b || !b.alive || !a.alive) return false;
    const now = this.game.time.total;
    if (a.mad > now) return true;
    if (a.data.hostile) {
      try {
        if (a.data.hostile(b)) return true;
      } catch (err) {
        /* ignore faulty hostility callbacks */
      }
    }
    if (a.def.prey.includes(b.species)) return true;
    if (b.combat && b.combat.target === a.id) return true;
    return false;
  }

  // Threat that a unit should run from (predators, monsters, mad units, hostile soldiers).
  findThreat(u, rangeMul = 1) {
    const def = u.def;
    const range = def.sight * def.fleeRange * rangeMul;
    const now = this.game.time.total;
    const me = u.species;
    const myMass = def.mass;
    return this.nearest(u.x, u.z, range, (o) => {
      if (o === u || o.sleeping) return false;
      if (o.mad > now) return true;
      if (o.combat && o.combat.target === u.id) return true;
      if (o.def.prey.includes(me) && (o.def.kind === 'monster' || o.def.mass >= myMass * 0.5)) return true;
      if (me !== 'human' && o.species === 'human' && def.diet === 'herbivore' && (me === 'deer' || me === 'rabbit')) return (o.x - u.x) ** 2 + (o.z - u.z) ** 2 < 6;
      if (o.data.hostile && o.job === 'soldier' && u.data.hostile && u.data.hostile(o)) return true;
      return false;
    });
  }

  // ---- combat ---------------------------------------------------------------
  engage(a, t, opts = {}) {
    if (!a || !t || !a.alive || !t.alive || a === t) return false;
    const now = this.game.time.total;
    if (this.attackDamage(a) <= 0) return false;
    if (a.combat && a.combat.target === t.id) return true;
    a.combat = {
      target: t.id,
      since: now,
      repath: -9,
      hunt: !!opts.hunt,
      maxTime: opts.maxTime ?? (opts.hunt ? 16 : 45),
      flank: ((a.id % 5) - 2) * 0.6,
    };
    if (a.sleeping) this._wake(a);
    a.busyUntil = 0;
    a.activity = null;
    a.state = opts.hunt ? 'hunt' : 'run';
    this.game.events.emit('unit:engage', { unit: a, target: t });
    return true;
  }
  disengage(u) {
    if (!u.combat) return;
    u.combat = null;
    u._pounce = false;
    u.target = null;
    u.path = null;
    if (u.state === 'attack' || u.state === 'hunt' || u.state === 'run') u.state = 'idle';
  }

  attackDamage(u) {
    const def = u.def;
    const now = this.game.time.total;
    let d = u.data.damage ?? def.damage;
    if (u.mad > now) d = Math.max(d, 1.5 + def.mass * 1.5);
    if (d <= 0) return 0;
    d *= 1 + (u.level - 1) * 0.12;
    if (u.job === 'soldier') d *= 1.8;
    else if (u.job === 'king') d *= 1.4;
    if (u.age < def.maturity) d *= 0.4;
    if (u.blessed > now) d *= 1.5;
    if (u.mad > now) d *= 1.25;
    return d;
  }

  _combatTick(u, dt, now) {
    const c = u.combat;
    const t = this.byId.get(c.target);
    if (!t || !t.alive || now - c.since > c.maxTime) {
      if (c.hunt && u.pack) {
        const p = this.packs.get(u.pack);
        if (p && p.target === c.target) p.target = 0;
      }
      this.disengage(u);
      return;
    }
    const dx = t.x - u.x,
      dz = t.z - u.z;
    const d = Math.hypot(dx, dz);
    if (d > u.def.sight * 2.4) {
      this.disengage(u);
      return;
    }
    // air targets can only be reached while they fly low (or by air units / archers)
    const ranged = !!u.data.ranged;
    const tAir = t.def.habitat === 'air' && t.alt > 2.6;
    const reach = u.def.attackRange + t.def.radius * 0.8 + u.def.radius * 0.5;
    if (ranged && d > reach && d < 7 && !tAir) {
      this._face(u, dx, dz, dt);
      u.target = null;
      u.path = null;
      u.state = 'attack';
      if (u.attackCd <= 0) {
        this.shoot(u, t);
        u.attackCd = u.def.attackCooldown * 1.6;
      }
      return;
    }
    if (d <= reach && !(tAir && u.def.habitat !== 'air')) {
      this._face(u, dx, dz, dt);
      u.target = null;
      u.path = null;
      u.state = 'attack';
      if (u.attackCd <= 0) this._strike(u, t, d);
      return;
    }
    if (tAir && u.def.habitat !== 'air' && !ranged) {
      // wait underneath, looking up
      u.state = 'idle';
      if (d > 2) u.target = { x: t.x, z: t.z };
      return;
    }
    u.state = c.hunt ? 'hunt' : 'run';
    u._pounce = c.hunt && d < 1.8;
    // flanking approach for pack members, direct when close
    let gx = t.x,
      gz = t.z;
    if (d > 2 && c.flank) {
      const px = -dz / d,
        pz = dx / d;
      gx += px * c.flank * Math.min(1, (d - 2) / 3);
      gz += pz * c.flank * Math.min(1, (d - 2) / 3);
    }
    if (d > 4 && now - c.repath > 1.5 && u.def.habitat !== 'air') {
      c.repath = now;
      this.moveTo(u, gx, gz);
    } else if (!u.path || d <= 4) {
      u.path = null;
      u.target = { x: gx, z: gz };
    }
  }

  _face(u, dx, dz, dt) {
    const want = Math.atan2(dx, dz);
    let da = want - u.heading;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    u.heading += da * Math.min(1, dt * 12);
  }

  _strike(u, t, d) {
    const g = this.game;
    const rng = g.rng;
    const now = g.time.total;
    u.attackCd = u.def.attackCooldown * rng.float(0.85, 1.15) * (u.mad > now ? 0.8 : 1);
    u.lastAttack = now;
    // the swing lands a moment after it starts (renderer shows the wind-up)
    const dmg = this.attackDamage(u) * rng.float(0.8, 1.2);
    const l = d || 1;
    const dirX = (t.x - u.x) / l,
      dirZ = (t.z - u.z) / l;
    const hitY = t.y + t.def.height * 0.55 * t.def.size;
    const miss = rng.chance(0.08);
    if (!miss) {
      this.damage(t, dmg, u, { knock: u.def.knockback, dirX, dirZ });
      g.fx.emit?.('hit', { x: t.x - dirX * t.def.radius, y: hitY, z: t.z - dirZ * t.def.radius }, { scale: 0.5 + u.def.mass * 0.08, dir: { x: dirX, y: 0.3, z: dirZ } });
      if (t.def.blood) g.fx.emit?.('blood', { x: t.x, y: hitY, z: t.z }, { scale: 0.5 + Math.min(1, dmg / 20), dir: { x: dirX, y: 0.5, z: dirZ } });
      g.audio.play?.('hit', { pos: { x: t.x, z: t.z }, volume: 0.55, pitch: rng.float(0.85, 1.15) / Math.sqrt(Math.max(0.5, u.def.mass)) });
    } else {
      g.fx.emit?.('dust', { x: t.x, y: t.y + 0.05, z: t.z }, { scale: 0.4 });
    }
    if (u.def.brain === 'golem') {
      // ground-shaking slam: splash damage and buildings
      this.forEachNear(t.x, t.z, 1.4, (o) => {
        if (o !== u && o !== t && o.def.kind !== 'monster') this.damage(o, dmg * 0.35, u, { knock: 1.2, dirX: o.x - u.x, dirZ: o.z - u.z });
      });
      g.civ?.damageArea?.(t.x, t.z, 1.4, dmg * 0.6, 'golem');
      g.fx.emit?.('dust', { x: t.x, y: t.y, z: t.z }, { scale: 1.6 });
      g.fx.emit?.('debris', { x: t.x, y: t.y + 0.1, z: t.z }, { scale: 1.0 });
      const cam = g.cameraRig;
      if (cam && Math.hypot(cam.cur.x - t.x, cam.cur.z - t.z) < 40) cam.addShake?.(0.35);
      g.audio.play?.('quake', { pos: { x: t.x, z: t.z }, volume: 0.4, pitch: 1.4 });
    }
    g.events.emit('unit:attack', { unit: u, target: t, damage: miss ? 0 : dmg });
  }

  // Arrow (or other) projectile. opts: {damage, speed, kind}
  shoot(a, t, opts = {}) {
    if (!a?.alive || !t?.alive) return null;
    const g = this.game;
    const dx = t.x - a.x,
      dz = t.z - a.z;
    const d = Math.hypot(dx, dz);
    const speed = opts.speed ?? 9;
    const dur = Math.max(0.25, d / speed);
    // lead the target a little
    const lx = t.x + (t.x - t.px) * (dur / this.tickDt) * 0.5,
      lz = t.z + (t.z - t.pz) * (dur / this.tickDt) * 0.5;
    const p = {
      kind: opts.kind || 'arrow',
      x0: a.x,
      y0: a.y + a.def.height * 0.75,
      z0: a.z,
      x1: lx,
      y1: t.y + t.def.height * 0.5,
      z1: lz,
      t: 0,
      dur,
      arc: Math.min(2.2, d * 0.18),
      from: a.id,
      target: t.id,
      dmg: opts.damage ?? this.attackDamage(a) * 0.8,
    };
    this.projectiles.push(p);
    a.lastAttack = g.time.total;
    g.audio.play?.('ui-click', { pos: { x: a.x, z: a.z }, volume: 0.25, pitch: 1.8 });
    return p;
  }

  _projectilesTick(dt) {
    const ps = this.projectiles;
    if (!ps.length) return;
    let j = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.t += dt;
      if (p.t >= p.dur) {
        const t = this.byId.get(p.target);
        const src = this.byId.get(p.from) || null;
        if (t && t.alive && Math.hypot(t.x - p.x1, t.z - p.z1) < 0.6 + t.def.radius) {
          const l = Math.hypot(p.x1 - p.x0, p.z1 - p.z0) || 1;
          this.damage(t, p.dmg, src, { knock: 0.3, dirX: (p.x1 - p.x0) / l, dirZ: (p.z1 - p.z0) / l });
          this.game.fx.emit?.('hit', { x: t.x, y: t.y + t.def.height * 0.5, z: t.z }, { scale: 0.4 });
          if (t.def.blood) this.game.fx.emit?.('blood', { x: t.x, y: t.y + t.def.height * 0.5, z: t.z }, { scale: 0.4 });
        } else this.game.fx.emit?.('dust', { x: p.x1, z: p.z1 }, { scale: 0.3 });
        continue;
      }
      ps[j++] = p;
    }
    ps.length = j;
  }

  // ---- god-power helpers ----------------------------------------------------
  setMad(u, seconds = 25) {
    if (!u?.alive) return;
    u.mad = this.game.time.total + seconds;
    u.sleeping = false;
    u.busyUntil = 0;
    this.emote(u, 'anger', 2.5);
  }
  bless(u, seconds = 40) {
    if (!u?.alive) return;
    const now = this.game.time.total;
    u.blessCount = u.blessCount || 0;
    if (u.blessCount < 3) {
      u.maxHp *= 1.2;
      u.blessCount++;
      u.level += 1;
    }
    u.hp = u.maxHp;
    u.hunger = 0;
    u.energy = 1;
    u.blessed = now + seconds;
    u.mad = 0;
    this.emote(u, 'sparkle', 2.5);
  }

  // ---- internal reactions --------------------------------------------------------
  _wake(u) {
    u.sleeping = false;
    if (u.state === 'sleep') u.state = 'idle';
    u.busyUntil = 0;
  }

  _react(u, src) {
    const now = this.game.time.total;
    if (u.combat && u.combat.target === src.id) return;
    const def = u.def;
    const canFight = this.attackDamage(u) > 0;
    const outmatched = def.flees && !(u.mad > now) && (src.def.mass > def.mass * 0.6 || !canFight);
    if (outmatched || !canFight) {
      this.flee(u, src.x, src.z, 6);
      this.emote(u, 'alert', 1.2);
      this._alertGroup(u, src);
      return;
    }
    if (def.retaliate !== false && (!u.combat || !this.byId.get(u.combat.target)?.alive || Math.random() < 0.3)) {
      this.engage(u, src);
    }
    // pack mates join the fight
    if (u.pack) {
      this.forEachNear(u.x, u.z, 8, (o) => {
        if (o !== u && o.pack === u.pack && !o.combat) this.engage(o, src);
      });
    }
  }

  _alertGroup(u, threat) {
    if (!u.herd) return;
    this.forEachNear(u.x, u.z, 6, (o) => {
      if (o !== u && o.herd === u.herd && o.fleeUntil < this.game.time.total) {
        o.thinkT = Math.min(o.thinkT, 0.05 + Math.random() * 0.25);
        o.alarm = threat.id;
      }
    });
  }

  _packJoin(u) {
    let p = this.packs.get(u.pack);
    if (!p) this.packs.set(u.pack, (p = { id: u.pack, leader: u.id, target: 0, home: { ...u.home }, size: 0 }));
  }
  packLeader(u) {
    const p = this.packs.get(u.pack);
    if (!p) return null;
    let l = this.byId.get(p.leader);
    if (!l || !l.alive) {
      l = this.nearest(u.x, u.z, 30, (o) => o.pack === u.pack && o.age >= o.def.maturity) || u;
      p.leader = l.id;
    }
    return l;
  }

  _giveBirth(m) {
    const g = this.game;
    const def = m.def;
    const n = g.rng.int(def.litter[0], def.litter[1]);
    m.pregnant = 0;
    m.lastBirth = g.time.total;
    for (let i = 0; i < n; i++) {
      if (this.count(m.species) >= this.capacity(m.species) * 1.05) break;
      const baby = this.spawn(m.species, m.x + g.rng.float(-0.3, 0.3), m.z + g.rng.float(-0.3, 0.3), {
        age: 0,
        herd: m.herd,
        pack: m.pack,
        home: m.home,
        kingdom: m.kingdom,
        village: m.village,
      });
      if (baby) {
        baby.heading = m.heading + g.rng.float(-1, 1);
        g.events.emit('unit:birth', { unit: baby, parent: m });
      }
    }
    this.emote(m, 'heart', 2.5);
    g.fx.emit?.('heal', { x: m.x, y: m.y + def.height, z: m.z }, { scale: 0.5 });
    g.audio.play?.('birth', { pos: { x: m.x, z: m.z }, volume: 0.35 });
  }

  // Logistic breeding: chance falls as the population nears carrying capacity;
  // predators also need enough prey around.
  tryBreed(u) {
    const def = u.def;
    const g = this.game;
    const now = g.time.total;
    if (def.fertility <= 0 || u.sex !== 'f' || u.pregnant > 0 || u.age < def.maturity || u.age > u.lifespan * 0.85) return false;
    if (u.hunger > 0.4 || u.energy < 0.3 || u.sleeping) return false;
    if ((now - u.lastBirth) / YEAR < def.birthInterval) return false;
    const n = this.count(u.species);
    let K = this.capacity(u.species);
    if (def.diet === 'carnivore' || def.brain === 'bear') {
      let prey = 0;
      for (const p of def.prey) prey += this.count(p);
      K = Math.min(K, Math.floor(prey / (def.pack ? 7 : 9)));
      if (u.hunger > 0.45) return false;
    }
    if (n >= K) return false;
    const p = def.fertility * (1 - n / K) * (n < K * 0.25 ? 1.6 : 1);
    if (!g.rng.chance(p)) return false;
    const isMate = (o) => o.species === u.species && o.sex === 'm' && o.age >= def.maturity && !o.sleeping;
    const mate = this.nearest(u.x, u.z, 6, isMate);
    if (!mate) {
      // solitary creatures roam to find a partner
      if ((def.solitary || n < K * 0.3) && now > (u._mateSeekT || 0)) {
        u._mateSeekT = now + 8;
        const far = this.nearest(u.x, u.z, 64, isMate);
        if (far) {
          this.moveTo(u, far.x, far.z);
          u.state = 'walk';
          this.moveTo(far, u.x, u.z);
          far.state = 'walk';
          return true;
        }
      }
      return false;
    }
    u.pregnant = def.gestation;
    this.emote(u, 'heart', 2);
    this.emote(mate, 'heart', 2);
    return true;
  }

  startActivity(u, state, dur, activity = null) {
    const now = this.game.time.total;
    this.stop(u);
    u.state = state;
    u.stateTime = 0;
    u.busyUntil = now + dur;
    u.activity = activity;
  }

  nearestCarcass(u, r) {
    let best = null,
      bd = r * r;
    for (const c of this.carcasses) {
      if (c.food <= 0) continue;
      const d = (c.x - u.x) ** 2 + (c.z - u.z) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  findPrey(u, range = null) {
    const def = u.def;
    const r = range ?? def.sight;
    let best = null,
      bs = Infinity;
    this.forEachNear(u.x, u.z, r, (o, d2) => {
      if (!def.prey.includes(o.species) || o === u) return;
      // refuge: rare species are hard to find (keeps the ecosystem from collapsing)
      if (this.count(o.species) < 6 && def.kind !== 'monster') return;
      // adult cows and bears are too big for a lone hunter
      if (o.def.mass > def.mass * (u.pack ? 3 : 1.2) && o.age >= o.def.maturity) return;
      const weak = (o.hp / o.maxHp) * (o.age < o.def.maturity ? 0.6 : 1) * (o.sleeping ? 0.7 : 1);
      const s = d2 * (0.5 + weak);
      if (s < bs) {
        bs = s;
        best = o;
      }
    });
    return best;
  }

  // Sleep / wake logic shared by brains. Returns true while asleep.
  sleepLogic(u) {
    const g = this.game;
    const day = g.env?.daylight ?? 1;
    const noct = u.def.nocturnal;
    if (u.sleeping) {
      const wake = noct ? day < 0.35 && u.energy > 0.5 : day > 0.3 && u.energy > 0.55;
      if (wake || u.energy >= 1 || (u.hunger > 0.85 && u.energy > 0.3)) {
        this._wake(u);
        return false;
      }
      u.state = 'sleep';
      return true;
    }
    const sleepy = (noct ? day > 0.75 && u.energy < 0.7 : day < 0.12 && u.energy < 0.92) && u.hunger < 0.7;
    if (sleepy || u.energy < 0.1) {
      if (u.swimming || u.combat) return false;
      this.stop(u);
      u.sleeping = true;
      u.state = 'sleep';
      u.stateTime = 0;
      u.activity = null;
      return true;
    }
    return false;
  }

  _swimToShore(u) {
    const w = this.game.world;
    const t = this.findNearestTile(u.x, u.z, 14, (tx, ty, i) => w.height[i] >= SEA_LEVEL && TILE_INFO[w.type[i]].walkable && !FLORA_INFO[w.flora[i]].blocksMovement);
    if (t) {
      u.path = null;
      u.target = { x: t.x, z: t.z };
      if (u.state !== 'flee') u.state = 'walk';
    }
  }

  // ---- default AI ----------------------------------------------------------
  _defaultBrain(u, dt) {
    const fn = BRAINS[u.def.brain] || BRAINS.herbivore;
    fn(u, this, this.game, this.game.time.total);
  }

  _think(u, now) {
    const g = this.game;
    // madness overrides everything (including registered brains)
    if (u.mad > now) {
      if (!u.combat) {
        const victim = this.nearest(u.x, u.z, 7, (o) => o !== u && o.def.habitat === u.def.habitat && !(o.def.kind === 'monster' && u.def.kind !== 'monster'));
        if (victim) this.engage(u, victim, { maxTime: 12 });
        else if (!u.target) this.wander(u, 5);
      }
      if (Math.random() < 0.15) this.emote(u, 'anger', 1.5);
      return;
    }
    if (u.mad && u.mad <= now) {
      u.mad = 0;
      this.disengage(u);
    }
    // escape water
    if (u.swimming && u.def.habitat === 'land' && !u.combat) {
      const tgtLand = u.target && this.isLandAt(u.target.x, u.target.z);
      if (!tgtLand) this._swimToShore(u);
    }
    // escape fire
    const w = g.world;
    const [tx, ty] = w.tileOf(u.x, u.z);
    if (u.def.habitat === 'land' && w.fire[w.idx(tx, ty)] > 0.05) {
      const f = this.findNearestTile(u.x, u.z, 5, (x, y, i) => w.fire[i] <= 0 && this._pathable(u, x, y));
      if (f) {
        u.path = null;
        u.target = { x: f.x, z: f.z };
        u.state = 'flee';
        u.fleeUntil = now + 1.5;
        u.sleeping = false;
        this.emote(u, 'alert', 1);
      }
      return;
    }
    // auto-aggro towards hostiles (soldiers, or opted-in units)
    if (!u.combat && u.data.hostile && (u.data.autoAggro ?? u.job === 'soldier')) {
      const foe = this.nearest(u.x, u.z, u.def.sight, (o) => o !== u && this.isHostile(u, o));
      if (foe) {
        this.engage(u, foe);
        return;
      }
    }
    const brain = this.brains.get(u.species);
    if (brain) {
      try {
        brain(u, THINK_INTERVAL, g);
      } catch (err) {
        console.error('[brain]', u.species, err);
        this.brains.delete(u.species);
      }
    } else {
      try {
        this._defaultBrain(u, THINK_INTERVAL);
      } catch (err) {
        console.error('[default brain]', u.species, err);
      }
    }
  }

  // ---- tick ----------------------------------------------------------------
  tick(dt) {
    const g = this.game;
    const w = g.world;
    const now = g.time.total;
    this.tickDt = dt;
    this.lastTick = now;
    this._tickN++;
    this._pathBudget = PATH_BUDGET;
    const yearDt = dt / YEAR;
    const list = this.list;
    const tickN = this._tickN;
    for (let k = 0; k < list.length; k++) {
      const u = list[k];
      if (!u.alive) continue;
      const def = u.def;
      u.px = u.x;
      u.pz = u.z;
      u.py = u.y;
      u.ph = u.heading;
      u.age += yearDt;
      u.attackCd -= dt;
      u.stateTime += dt;
      // ---- needs
      const active = u.state === 'run' || u.state === 'flee' || u.state === 'hunt' || u.state === 'attack';
      u.hunger = Math.min(1, u.hunger + dt * def.hungerRate * (u.sleeping ? 0.5 : active ? 1.6 : 1));
      if (u.sleeping) u.energy = Math.min(1, u.energy + dt * 0.0075);
      else u.energy = Math.max(0, u.energy - dt * def.energyRate * (active ? 2.5 : 1) * (u.swimming ? 4 : 1));
      if (u.pregnant > 0) {
        u.pregnant -= yearDt;
        if (u.pregnant <= 0) this._giveBirth(u);
      }
      if (u.hunger >= 1 && def.starves) {
        u.hp -= dt * def.hp * 0.025;
        if (u.hp <= 0) {
          this.kill(u, 'starvation');
          continue;
        }
      }
      if (u.age > u.lifespan) {
        this.kill(u, 'old age');
        continue;
      }
      // ---- environment
      const tx = Math.min(w.w - 1, Math.max(0, Math.floor(u.x))),
        ty = Math.min(w.h - 1, Math.max(0, Math.floor(u.z)));
      const ti = ty * w.w + tx;
      if (def.habitat === 'land') {
        const h = w.heightAt(u.x, u.z);
        const deep = h < SEA_LEVEL - Math.max(0.12, def.height * 0.55 * def.size);
        u.swimming = deep;
        u.wading = !deep && h < SEA_LEVEL - 0.02;
        if (deep) {
          if (!def.canSwim || u.energy <= 0.01) this.damage(u, dt * (def.canSwim ? 2 : 12), null, { cause: 'drowned' });
        }
        const fire = w.fire[ti];
        if (fire > 0.2) {
          this.damage(u, dt * 8 * fire, null, { cause: 'fire' });
          if ((tickN + u.id) % 5 === 0) g.fx.emit?.('fire', { x: u.x, y: u.y + def.height * 0.5, z: u.z }, { scale: 0.35 });
        }
        if (w.type[ti] === TILE.LAVA) this.damage(u, dt * 60, null, { cause: 'lava' });
        if (!u.alive) continue;
      } else if (def.habitat === 'water') {
        if (w.height[ti] >= SEA_LEVEL) this.damage(u, dt * 10, null, { cause: 'stranded' });
        if (!u.alive) continue;
      }
      // natural regeneration
      if (u.hp < u.maxHp && u.hunger < 0.7 && now - u.lastHurt > 5) u.hp = Math.min(u.maxHp, u.hp + dt * u.maxHp * (u.blessed > now ? 0.05 : 0.006));
      // activities (eating at a carcass or grazing)
      if (u.busyUntil > 0 && now >= u.busyUntil) {
        u.busyUntil = 0;
        u.activity = null;
        if (u.state === 'eat' || u.state === 'work' || (u.state === 'idle' && u.activity)) u.state = 'idle';
      }
      if (u.state === 'eat') {
        let gain = dt * 0.09;
        if (u._carcass) {
          const c = u._carcass;
          gain = Math.min(c.food, dt * 0.12);
          c.food -= gain;
          if (c.food <= 0) {
            u._carcass = null;
            u.busyUntil = now;
          }
        }
        u.hunger = Math.max(0, u.hunger - gain);
      }
      // ---- combat & thinking
      if (u.combat) this._combatTick(u, dt, now);
      u.thinkT -= dt;
      if (u.thinkT <= 0) {
        u.thinkT = THINK_INTERVAL * (0.8 + g.rng.next() * 0.4);
        this._think(u, now);
        if (!u.alive) continue;
      }
      const bt = BRAIN_TICKS[def.brain];
      if (bt) bt(u, dt, this, g, now);
      if ((tickN + u.id) % 4 === 0) this._separate(u);
      // ---- locomotion
      if (def.habitat === 'air') {
        this._flyTick(u, dt);
        this._flyLocomote(u, dt, now);
      } else this._locomote(u, dt, now);
      if (u.x < 0.01) u.x = 0.01;
      else if (u.x > w.w - 0.01) u.x = w.w - 0.01;
      if (u.z < 0.01) u.z = 0.01;
      else if (u.z > w.h - 0.01) u.z = w.h - 0.01;
      u.y = this._groundY(u);
      const moved = Math.hypot(u.x - u.px, u.z - u.pz) / dt;
      u.speedNow += (moved - u.speedNow) * Math.min(1, dt * 8);
      u.anim += dt * (u.moving ? 1 : 0.35);
      if (u.state === 'walk' && !u.moving && !u.target) u.state = 'idle';
      if (u.swimming && u.state !== 'attack' && u.state !== 'flee') u.state = 'swim';
      else if (u.state === 'swim' && !u.swimming) u.state = u.moving ? 'walk' : 'idle';
      if (u.state === 'flee' && now > u.fleeUntil && !u.target) u.state = 'idle';
      this._gridUpdate(u);
    }
    this._projectilesTick(dt);
    // carcasses rot away
    if (this.carcasses.length && tickN % 15 === 0) this.carcasses = this.carcasses.filter((c) => c.food > 0.01 && c.until > now);
    if (this._dead.length) {
      for (const u of this._dead) {
        this._gridRemove(u);
        this.byId.delete(u.id);
      }
      this.list = this.list.filter((u) => u.alive);
      this._dead.length = 0;
    }
    this._migrateT -= dt;
    if (this._migrateT <= 0) {
      this._migrateT = 15;
      this._migrationCheck(now);
    }
  }

  // Flyers bank through wide turns and keep gliding forward.
  _flyLocomote(u, dt, now) {
    const def = u.def;
    if (u.kbx !== 0 || u.kbz !== 0) {
      u.x += u.kbx * dt;
      u.z += u.kbz * dt;
      const f = Math.exp(-dt * 6);
      u.kbx *= f;
      u.kbz *= f;
    }
    const landed = u.sleeping || (u.alt < 0.35 && u.altGoal < 0.35);
    let sp = landed ? 0 : def.speed * (u.combat || u.data.fireTarget ? def.runMul : 1);
    if (u.blessed > now) sp *= 1.15;
    u.spd += (sp - u.spd) * Math.min(1, dt * def.accel);
    if (u.target) {
      const dx = u.target.x - u.x,
        dz = u.target.z - u.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.2) u.target = null;
      else {
        let da = Math.atan2(dx, dz) - u.heading;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        const maxTurn = def.turnRate * dt * (d < 4 ? 1.8 : 1);
        u.heading += Math.max(-maxTurn, Math.min(maxTurn, da));
        if (landed && d > 1.2) u.altGoal = Math.max(u.altGoal, 3);
      }
    }
    u.x += Math.sin(u.heading) * u.spd * dt;
    u.z += Math.cos(u.heading) * u.spd * dt;
    u.moving = u.spd > 0.05;
  }

  // Air units: smooth altitude changes toward altGoal.
  _flyTick(u, dt) {
    u.alt += (u.altGoal - u.alt) * Math.min(1, dt * 0.8);
    if (u.state !== 'sleep' && u.state !== 'attack') u.state = u.alt < 0.4 ? 'idle' : 'fly';
  }

  // Oversized packs and herds split: a founding party leaves for new territory.
  _disperseGroups() {
    const groups = new Map();
    for (const u of this.list) {
      const key = u.pack ? 'p' + u.pack : u.herd && u.def.herd ? 'h' + u.herd : null;
      if (!key) continue;
      let a = groups.get(key);
      if (!a) groups.set(key, (a = []));
      a.push(u);
    }
    const rng = this.game.rng;
    const w = this.game.world;
    for (const [key, members] of groups) {
      const isPack = key[0] === 'p';
      const limit = isPack ? 7 : 12;
      if (members.length <= limit) continue;
      const adults = members.filter((m) => m.age >= m.def.maturity && !m.combat);
      if (adults.length < 4) continue;
      // founders: a young adult and its nearest group-mates
      adults.sort((a, b) => a.age - b.age);
      const f0 = adults[0];
      const party = members
        .filter((m) => m !== f0)
        .sort((a, b) => (a.x - f0.x) ** 2 + (a.z - f0.z) ** 2 - ((b.x - f0.x) ** 2 + (b.z - f0.z) ** 2))
        .slice(0, Math.floor(members.length / 2) - 1);
      party.unshift(f0);
      if (!party.some((m) => m.sex !== f0.sex)) continue;
      let dest = null;
      for (let t = 0; t < 30 && !dest; t++) {
        const a = rng.float(0, Math.PI * 2),
          r = rng.float(14, 30);
        const x = f0.x + Math.sin(a) * r,
          z = f0.z + Math.cos(a) * r;
        const [tx, ty] = w.tileOf(x, z);
        if (w.inBounds(tx, ty) && w.isWalkable(tx, ty) && (!f0.def.seed || f0.def.seed.tiles.includes(w.type[w.idx(tx, ty)]))) dest = { x, z };
      }
      if (!dest) continue;
      const id = this._nextGroup++;
      for (const m of party) {
        if (isPack) m.pack = id;
        else m.herd = id;
        m.home = { x: dest.x, z: dest.z };
        this.moveTo(m, dest.x + rng.float(-1.5, 1.5), dest.z + rng.float(-1.5, 1.5));
        m.state = 'walk';
      }
      if (isPack) this.packs.set(id, { id, leader: f0.id, target: 0, home: { ...dest }, size: party.length });
    }
    // forget packs that no longer exist
    for (const id of this.packs.keys()) if (!groups.has('p' + id)) this.packs.delete(id);
  }

  // Wild species that died out wander back in from the map edge after a while.
  _migrationCheck(now) {
    this._disperseGroups();
    if (!this.migration) return;
    for (const def of Object.values(SPECIES)) {
      if (!def.seed) continue;
      const n = this.count(def.id);
      if (n > 1) {
        this._extinct.delete(def.id);
        continue;
      }
      const since = this._extinct.get(def.id);
      if (since == null) this._extinct.set(def.id, now);
      else if (now - since > 150) {
        this._extinct.delete(def.id);
        const grp = this.spawnGroup(def.id, null, null, this.game.rng);
        if (grp.length) this._extinct.set(def.id, now + 300);
      }
    }
  }

  // ---- inspector ------------------------------------------------------------
  activityLabel(u) {
    const now = this.game.time.total;
    if (!u.alive) return 'Dead';
    if (u.mad > now) return u.combat ? 'Rampaging' : 'Raging';
    if (u.sleeping) return 'Sleeping';
    if (u.combat) {
      const t = this.byId.get(u.combat.target);
      const who = t ? (t.name || t.def.name) : 'foe';
      return (u.combat.hunt ? 'Hunting ' : 'Fighting ') + who;
    }
    if (u.state === 'flee') return 'Fleeing';
    if (u.swimming) return 'Swimming';
    if (u.state === 'eat') return u.def.diet === 'herbivore' ? 'Grazing' : 'Feeding';
    if (u.state === 'work') {
      const a = u.data.workAnim;
      return a === 'chop' ? 'Chopping wood' : a === 'dig' ? 'Mining' : a === 'hammer' ? 'Building' : a === 'harvest' ? 'Harvesting' : a === 'fish' ? 'Fishing' : 'Working';
    }
    if (u.activity === 'talk') return 'Chatting';
    if (u.activity === 'fish') return 'Fishing';
    if (u.def.habitat === 'air') return u.data.breath > now ? 'Breathing fire' : 'Soaring';
    if (u.moving) return u.state === 'run' ? 'Running' : 'Wandering';
    return 'Resting';
  }
  moodLabel(u) {
    const now = this.game.time.total;
    if (u.mad > now) return 'Furious';
    if (u.state === 'flee') return 'Terrified';
    if (u.blessed > now) return 'Blessed';
    const s = 1 - u.hunger * 0.55 - (1 - u.energy) * 0.3 - (1 - u.hp / u.maxHp) * 0.5;
    if (u.hunger > 0.85) return 'Starving';
    if (u.energy < 0.15) return 'Exhausted';
    return s > 0.8 ? 'Joyful' : s > 0.6 ? 'Content' : s > 0.4 ? 'Uneasy' : 'Miserable';
  }

  inspect(hit) {
    // prefer the unit closest to the picked point, weighting big creatures
    let u = null,
      bd = Infinity;
    this.forEachNear(hit.x, hit.z, 2.5, (o, d2) => {
      const r = 0.6 + o.def.radius * 1.5;
      if (d2 > r * r) return;
      const s = d2 / (r * r) - (KIND_ORDER[o.def.kind] === 2 ? 0.2 : 0);
      if (s < bd) {
        bd = s;
        u = o;
      }
    });
    if (!u) return null;
    const def = u.def;
    const g = this.game;
    const pct = (v) => Math.round(v * 100) + '%';
    const hungerL = u.hunger < 0.3 ? 'Well fed' : u.hunger < 0.6 ? 'Peckish' : u.hunger < 0.85 ? 'Hungry' : 'Starving';
    const energyL = u.energy > 0.7 ? 'Rested' : u.energy > 0.35 ? 'Tired' : 'Exhausted';
    const ageY = u.age < 1 ? Math.max(1, Math.round(u.age * 12)) + ' months' : Math.floor(u.age) + ' yrs';
    const stage = u.age < def.maturity ? (def.kind === 'humanoid' ? 'Child' : 'Young') : u.age > u.lifespan * 0.8 ? 'Elder' : 'Adult';
    const stats = [
      ['Age', `${ageY} (${stage})`],
      ['Health', Math.ceil(u.hp) + ' / ' + Math.round(u.maxHp)],
      ['Mood', this.moodLabel(u)],
      ['Doing', this.activityLabel(u)],
    ];
    if (def.starves || def.kind === 'humanoid') stats.push(['Hunger', `${hungerL} (${pct(1 - u.hunger)})`]);
    stats.push(['Energy', `${energyL} (${pct(u.energy)})`]);
    if (def.kind === 'humanoid') {
      if (u.job) stats.push(['Job', u.job.charAt(0).toUpperCase() + u.job.slice(1)]);
      if (u.carry) stats.push(['Carrying', `${u.carry.amount ?? 1} ${u.carry.type}`]);
    }
    if (def.kind !== 'humanoid') stats.push(['Sex', u.sex === 'f' ? 'Female' : 'Male']);
    if (u.pregnant > 0) stats.push(['Expecting', Math.max(1, Math.round(u.pregnant * 12)) + ' months']);
    if (u.pack) {
      let n = 0;
      for (const o of this.list) if (o.pack === u.pack) n++;
      stats.push(['Pack', n + ' wolves']);
    } else if (u.herd && def.herd) {
      let n = 0;
      this.forEachNear(u.x, u.z, 12, (o) => {
        if (o.herd === u.herd) n++;
      });
      stats.push(['Herd', n + ' nearby']);
    }
    stats.push(['Kills', u.kills]);
    if (u.level > 1) stats.push(['Level', u.level]);
    const kname = u.kingdom >= 0 ? g.civ?.kingdomName?.(u.kingdom) || 'Kingdom ' + u.kingdom : null;
    return {
      priority: 10,
      kind: 'unit',
      unit: u,
      title: u.name || def.name,
      subtitle: (u.name ? def.name : stage + ' ' + (u.sex === 'f' ? 'female' : 'male')) + (kname ? ' · ' + kname : ''),
      stats,
    };
  }

  stats() {
    const out = { population: 0, animals: 0, monsters: 0 };
    for (const u of this.list) {
      if (u.def.kind === 'humanoid') out.population++;
      else {
        out.animals++;
        if (u.def.kind === 'monster') out.monsters++;
      }
    }
    return out;
  }
}

export { FLORA, FLORA_INFO };
