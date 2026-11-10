import { FLORA, FLORA_INFO, TILE, TILE_INFO, SEA_LEVEL, SHALLOW_DEPTH } from '../../world/constants.js';
import { findPath } from './pathfinding.js';
import { SPECIES, registerSpecies } from './species.js';
import { BRAINS, BRAIN_TICKS } from './brains.js';
import { makeName, makeMonsterName } from './names.js';
import { VillageHerds } from './herds.js';
import { installDepth } from './depth.js';
import { installEditing } from './edit.js';
import { installRoles, ROLE_NAMES } from './roles.js';

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
//   ROLES (roles.js, docs/TECH-UNLOCKS.md): roleOf(u) -> 'healer'|'messenger'|'cavalry'|null,
//        isRiding(u), setRole(u, role), healStats {cured, plague, sick, wounds},
//        rideStats {trips, foreign}; Civ picks roles with u.job 'healer' / 'messenger'
//        (or u.data.role) and u.data.mounted (cavalry = mounted soldier).
//   TRANSPORTS: board(u, vessel|id), disembark(u, x, z), aboard(vesselId) -> unit[];
//        listens to 'fleet:lost' (those aboard drown or swim ashore) and 'fleet:arrived'.
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
// unit.data.damage (attack damage override), unit.data.aboard (vessel id: not drawn,
// not thinking, out of queries), unit.data.mounted (rides a horse; renderer reads u._riding).
// Events emitted (additive): 'unit:hurt' {unit, amount, source},
// 'unit:attack' {unit, target, damage}, 'unit:birth' {unit, parent}.
export { SPECIES, registerSpecies };

const YEAR = 30; // == YEAR_SECONDS (src/core/Game.js); duplicated to avoid an import cycle
const CELL = 4;
const THINK_INTERVAL = 0.6;
const PATH_BUDGET = 40; // near units; distant ones share PATH_BUDGET_FAR
const PATH_BUDGET_FAR = 8;
const FCELL = 8;
const FORAGE_REGROW = 0.008; // fraction of a cell's capacity regrown per second
const FORAGE_COST = 7; // forage per unit of hunger per unit of body mass
// minimum viable populations: below these, migrants wander in from the map edge
const MVP = { wolf: 6, fox: 5, bear: 3, sheep: 10, cow: 8 };
// AI level of detail: creatures far from the camera (or off-screen) think less
// often and steer more cheaply; the brain always receives the real elapsed time.
const FAR_THINK = { humanoid: 1.7, animal: 2.3, monster: 1.4 };
const SFX_GAP = { hit: 0.07, death: 0.18, birth: 0.6, growl: 0.5, bleat: 1.4 };
const THINK_BUDGET_MS = 5; // per rendered frame (high game speeds defer the rest)
const DCELL = 16; // danger grid cell (tiles): where predators, monsters or fights are
const OVERVIEW_DIST = 110; // camera farther than this: every creature takes the cheap path
const FAUNA_TOTAL = 1000; // humans + animals target on a 256 x 256 map

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
    this._rescueAt = new Map();
    this._forage = null;
    this._sfxAt = {};
    this._pathBudgetFar = 0;
    this._focus = { x: 0, z: 0, r2: 1e9 };
    this.herds = new VillageHerds(this);
    this._installFleetHooks();
    this._lastFrame = -1;
    this._frameThinkMs = 0;
    this._ticksThisFrame = 0;
    this._initGrid();
  }

  // Coarse per-tick grid of cells holding anything that could threaten a
  // creature (carnivores, monsters, humans, mad or fighting units). Lets calm
  // grazers skip threat scans entirely.
  _buildDanger() {
    const w = this.game.world;
    const dw = Math.ceil(w.w / DCELL),
      dh = Math.ceil(w.h / DCELL);
    if (!this._danger || this._danger.length !== dw * dh) {
      this._danger = new Uint8Array(dw * dh);
      this._dw = dw;
      this._dh = dh;
    } else this._danger.fill(0);
    const now = this.game.time.total;
    const D = this._danger;
    for (const u of this.list) {
      if (!u.alive) continue;
      const def = u.def;
      if (def.diet === 'herbivore' && !u.combat && !(u.mad > now) && def.kind === 'animal') continue;
      const cx = Math.min(dw - 1, Math.max(0, Math.floor(u.x / DCELL))),
        cz = Math.min(dh - 1, Math.max(0, Math.floor(u.z / DCELL)));
      D[cz * dw + cx] = 1;
    }
  }
  dangerNear(x, z, r) {
    const D = this._danger;
    if (!D) return true;
    const dw = this._dw;
    const x0 = Math.max(0, Math.floor((x - r) / DCELL)),
      x1 = Math.min(dw - 1, Math.floor((x + r) / DCELL));
    const z0 = Math.max(0, Math.floor((z - r) / DCELL)),
      z1 = Math.min(this._dh - 1, Math.floor((z + r) / DCELL));
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) if (D[cz * dw + cx]) return true;
    return false;
  }

  // Wild animals allowed besides humans and village herds (soft global cap).
  faunaBudget() {
    const humans = this._counts.get('human') || 0;
    return Math.max(Math.round(220 * this.popScale), Math.round(FAUNA_TOTAL * this.popScale) - humans - this.herds.totalTended);
  }

  // Positional, throttled, guarded sound effect (only near the camera).
  sfx(name, x, z, opts = {}) {
    const g = this.game;
    if (!g.audio?.play) return;
    const f = this._focus;
    if ((x - f.x) ** 2 + (z - f.z) ** 2 > f.r2) return;
    const t = performance.now() / 1000;
    if (t - (this._sfxAt[name] ?? -9) < (SFX_GAP[name] ?? 0.1)) return;
    this._sfxAt[name] = t;
    try {
      g.audio.play(name, { pos: { x, z }, ...opts });
    } catch (err) {
      /* audio is optional */
    }
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
    this._rescueAt.clear();
    this._forage = null;
    this.herds?.reset();
    this._firstRole = null;
    this._landings = null;
    this.healStats = { cured: 0, plague: 0, sick: 0, wounds: 0 };
    this.rideStats = { trips: 0, foreign: 0 };
    this._initGrid();
  }

  // ---- grazing forage: the soft carrying capacity of the land -----------------
  // The map is split into 8x8-tile cells. Each holds forage proportional to its
  // fertile, open land; grazing eats it and it regrows slowly. Hungry herds move
  // to fresher pasture; overgrazed cells starve and stop breeding.
  _initForage() {
    const w = this.game.world;
    const fw = Math.ceil(w.w / FCELL),
      fh = Math.ceil(w.h / FCELL);
    const first = !this._forage || this._forage.length !== fw * fh;
    if (first) {
      this._fw = fw;
      this._fh = fh;
      this._forage = new Float32Array(fw * fh);
      this._forageCap = new Float32Array(fw * fh);
    }
    const cap = this._forageCap;
    cap.fill(0);
    for (let ty = 0; ty < w.h; ty++)
      for (let tx = 0; tx < w.w; tx++) {
        const i = ty * w.w + tx;
        if (w.height[i] < SEA_LEVEL || w.building[i] >= 0) continue;
        const t = w.type[i];
        if (t === TILE.FARMLAND || t === TILE.ROAD) continue;
        const f = TILE_INFO[t].fertile;
        if (f < 0.25) continue;
        cap[Math.floor(ty / FCELL) * fw + Math.floor(tx / FCELL)] += f;
      }
    for (let c = 0; c < cap.length; c++) if (first || this._forage[c] > cap[c]) this._forage[c] = cap[c];
  }
  _fcell(x, z) {
    const cx = Math.max(0, Math.min(this._fw - 1, Math.floor(x / FCELL)));
    const cz = Math.max(0, Math.min(this._fh - 1, Math.floor(z / FCELL)));
    return cz * this._fw + cx;
  }
  // Fraction (0..1) of forage left around a point.
  forageAt(x, z) {
    if (!this._forage) this._initForage();
    const c = this._fcell(x, z);
    const cap = this._forageCap[c];
    return cap > 0.5 ? this._forage[c] / cap : 0;
  }
  // Centre of the best nearby pasture cell (within r cells), or null.
  bestPasture(u, r = 2) {
    if (!this._forage) this._initForage();
    const cx = Math.floor(u.x / FCELL),
      cz = Math.floor(u.z / FCELL);
    let best = null,
      bs = -1;
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx,
          z = cz + dz;
        if (x < 0 || z < 0 || x >= this._fw || z >= this._fh) continue;
        const c = z * this._fw + x;
        const cap = this._forageCap[c];
        if (cap < 8) continue;
        const sc = this._forage[c] - Math.hypot(dx, dz) * 2.5 + Math.random() * 3;
        if (sc > bs) {
          bs = sc;
          best = { x: (x + 0.5) * FCELL, z: (z + 0.5) * FCELL, c };
        }
      }
    return best;
  }
  _forageTick(dt) {
    if (!this._forage) this._initForage();
    const f = this._forage,
      cap = this._forageCap;
    const k = FORAGE_REGROW * dt * (this.game.age?.mods?.fertility ?? 1);
    for (let c = 0; c < f.length; c++) {
      const cp = cap[c];
      if (f[c] < cp) f[c] = Math.min(cp, f[c] + cp * k + 0.02 * dt);
    }
  }
  // Graze: convert forage into reduced hunger. Returns hunger gained back.
  _graze(u, dt) {
    if (u.data.tended != null) return Math.min(dt * 0.09, u.hunger);
    if (!this._forage) this._initForage();
    const c = this._fcell(u.x, u.z);
    const want = Math.min(dt * 0.09, u.hunger);
    if (want <= 1e-5) return 0;
    const cost = want * Math.pow(u.def.mass, 0.7) * FORAGE_COST;
    const take = Math.min(this._forage[c], cost);
    this._forage[c] -= take;
    // bare pasture still yields a little (roots, weeds): overgrazing mostly halts breeding
    return Math.max(0.3, take / cost) * want;
  }

  registerBrain(speciesId, fn) {
    this.brains.set(speciesId, fn);
  }

  get areaScale() {
    const w = this.game.world;
    return (w.w * w.h) / (256 * 256);
  }
  // Population scale: grows with map area but sub-linearly, so a Huge (512)
  // map holds ~1.6x the creatures of a Medium (256) one, not 4x.
  get popScale() {
    return Math.pow(this.areaScale, 0.34);
  }
  capacity(speciesId) {
    const def = SPECIES[speciesId];
    return def ? Math.max(4, Math.round(def.maxPopulation * this.popScale)) : 0;
  }
  // World Laws (game.laws), read at the point of use; missing laws default to on.
  law(key) {
    const L = this.game.laws;
    return !L || L[key] !== false;
  }

  // ---- initial fauna -------------------------------------------------------
  seedInitial() {
    const g = this.game;
    const w = g.world;
    const rng = g.rng.fork('fauna');
    const scale = Math.pow(this.areaScale, 0.6);
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
    this._depthSpawn(u, opts);
    this.list.push(u);
    this.byId.set(u.id, u);
    this._counts.set(speciesId, (this._counts.get(speciesId) || 0) + 1);
    this._gridAdd(u);
    g.events.emit('unit:spawn', { unit: u });
    return u;
  }

  kill(u, cause = 'unknown', killer = null) {
    if (!u || !u.alive) return;
    if (u.flags?.immortal && cause !== 'divine' && cause !== 'removed') {
      u.hp = Math.max(1, u.hp);
      return;
    }
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
    this._depthDeath(u, cause, killer);
    if (cause !== 'slaughter') this.sfx('death', u.x, u.z, { volume: u.def.kind === 'humanoid' ? 0.75 : 0.55, pitch: 1 / Math.sqrt(Math.max(0.4, u.def.mass)) });
    g.events.emit('unit:death', { unit: u, cause, killer });
  }

  damage(u, amount, source = null, opts = {}) {
    if (!u || !u.alive || !(amount > 0)) return;
    const g = this.game;
    const now = g.time.total;
    if (u.blessed > now) amount *= 0.6;
    if (u.traits && u.traits.length) {
      if (source && u.traits.includes('lucky') && g.rng.chance(0.2)) {
        g.fx.emit?.('dust', { x: u.x, y: u.y + 0.1, z: u.z }, { scale: 0.35 });
        if (u.def.kind === 'humanoid' && !u._luckLogged && g.rng.chance(0.2)) {
          u._luckLogged = true;
          this.log(u, 'Escaped a deadly blow by sheer luck');
        }
        return;
      }
      if (opts.cause === 'fire' && u.traits.includes('fireheart')) amount *= 0.3;
    }
    const arm = u.equipment?.armor;
    if (arm && source) amount *= 1 - arm.power / (arm.power + 20);
    u.hp -= amount;
    if (u.flags?.immortal && u.hp < 1) u.hp = 1;
    u.lastHurt = now;
    if (source && source.alive) u.data.attacker = source.id;
    if (opts.knock) {
      const k = opts.knock / Math.max(0.3, u.def.mass);
      u.kbx += (opts.dirX || 0) * k * 4;
      u.kbz += (opts.dirZ || 0) * k * 4;
    }
    g.events.emit('unit:hurt', { unit: u, amount, source });
    if (u.hp <= 0) {
      if (source) source.kills = (source.kills || 0) + 1;
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
    const b = w.building[i];
    if (b >= 0 && b !== u._allowB && b !== u._curB) return false;
    return TILE_INFO[w.type[i]].walkable && !FLORA_INFO[w.flora[i]].blocksMovement;
  }
  _pathable(u, tx, ty) {
    const w = this.game.world;
    if (!w.inBounds(tx, ty)) return false;
    const i = w.idx(tx, ty);
    const h = w.height[i];
    if (u.def.habitat === 'water') return h < SEA_LEVEL - 0.3;
    if (h < SEA_LEVEL) return u.def.canSwim && h > SEA_LEVEL - SHALLOW_DEPTH * 0.85;
    const b = w.building[i];
    if (b >= 0 && b !== u._allowB) return false;
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
    u._allowB = w.building[w.idx(gx, gy)];
    if (u.def.habitat === 'air' || Math.abs(sx - gx) + Math.abs(sy - gy) <= 2) {
      u.path = null;
      return true;
    }
    if ((u._far ? this._pathBudgetFar : this._pathBudget) <= 0) {
      u.path = null; // straight line until a path can be computed (next tick)
      u._wantPath = true;
      return true;
    }
    return this._computePath(u);
  }
  _computePath(u) {
    const w = this.game.world;
    if (u._far) this._pathBudgetFar--;
    else this._pathBudget--;
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
    // idle fast path: nothing to push, no destination
    if (u.kbx === 0 && u.kbz === 0 && u.sepx === 0 && u.sepz === 0 && !u.target && !u.path) {
      if (u.spd !== 0) u.spd = u.spd > 0.001 ? u.spd * Math.exp(-dt * 10) : 0;
      u.moving = false;
      return;
    }
    const W = w.w,
      Hh = w.h;
    // knockback impulse (decays quickly)
    if (u.kbx !== 0 || u.kbz !== 0) {
      const nx = u.x + u.kbx * dt,
        nz = u.z + u.kbz * dt;
      const tx = nx < 0 ? 0 : nx >= W ? W - 1 : nx | 0,
        ty = nz < 0 ? 0 : nz >= Hh ? Hh - 1 : nz | 0;
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
      const tx = nx < 0 ? 0 : nx >= W ? W - 1 : nx | 0,
        ty = nz < 0 ? 0 : nz >= Hh ? Hh - 1 : nz | 0;
      if (this.canStand(u, tx, ty)) {
        u.x = nx;
        u.z = nz;
      }
    }
    if (!u.target && !u.path) {
      u.spd *= Math.exp(-dt * 10);
      u.moving = false;
      return;
    }
    if (def.habitat === 'land') {
      u._curB = w.building[Math.floor(u.z) * W + Math.floor(u.x)] ?? -1;
      let gi = -1;
      if (u.path && u.path.length) gi = u.path[u.path.length - 1];
      else if (u.target) gi = Math.floor(u.target.z) * W + Math.floor(u.target.x);
      u._allowB = gi >= 0 ? w.building[gi] : -1;
    }
    if (u._wantPath && u.target && (u._far ? this._pathBudgetFar : this._pathBudget) > 0) this._computePath(u);
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
    if (u.energy < 0.25 && !this.brains.has(u.species)) sp *= 0.75;
    if (u.blessed > now) sp *= 1.15;
    if (u.mad > now) sp *= 1.1;
    if (u.data.speedMul) sp *= u.data.speedMul;
    if (u._riding) sp *= u._rideMul || 1.6;
    if (u._pounce) sp *= 1.4;
    if (u._mSpd) sp *= u._mSpd;
    if (def.habitat === 'land') {
      if (u.swimming) sp *= def.swimMul;
      else if (u.wading) sp *= 0.75;
      else if (!u._far) {
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
    const clx = (v) => (v < 0 ? 0 : v >= W ? W - 1 : v | 0),
      clz = (v) => (v < 0 ? 0 : v >= Hh ? Hh - 1 : v | 0);
    if (!this.canStand(u, clx(nx), clz(nz))) {
      // slide along the obstacle
      if (this.canStand(u, clx(nx), clz(u.z))) nz = u.z;
      else if (this.canStand(u, clx(u.x), clz(nz))) nx = u.x;
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

  // Personal space (staggered: each unit every 4th tick). Herd-mates keep a
  // loose spacing, different species keep clearly apart, and units are pushed
  // out of buildings they are not entering.
  _separate(u) {
    const r = u.def.radius;
    let sx = 0,
      sz = 0;
    const x = u.x,
      z = u.z;
    const animal = u.def.kind === 'animal';
    const R = (r + 0.3) * 2.6 + 0.2;
    const x0 = Math.max(0, Math.floor((x - R) / CELL)),
      x1 = Math.min(this._gw - 1, Math.floor((x + R) / CELL));
    const z0 = Math.max(0, Math.floor((z - R) / CELL)),
      z1 = Math.min(this._gh - 1, Math.floor((z + R) / CELL));
    let n = 0;
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        const cell = this._cells[cz * this._gw + cx];
        for (let i = 0; i < cell.length && n < 10; i++) {
          const o = cell[i];
          if (o === u || !o.alive) continue;
          if ((o.def.habitat === 'air') !== (u.def.habitat === 'air')) continue;
          const dx = x - o.x,
            dz = z - o.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > R * R) continue;
          let f;
          if (o.species === u.species) f = animal ? (o.herd === u.herd ? 1.65 : 2.1) : u.moving || u.target ? 1.15 : 1.9;
          else f = animal && o.def.kind === 'animal' ? 2.6 : 1.5;
          const minD = (r + o.def.radius) * f + (f > 2 ? 0.15 : 0);
          if (d2 >= minD * minD) continue;
          const d = Math.sqrt(d2) || 0.001;
          const push = (minD - d) / minD;
          const mw = o.def.mass / (o.def.mass + u.def.mass);
          sx += (d2 > 1e-6 ? dx / d : Math.cos(u.id)) * push * mw;
          sz += (d2 > 1e-6 ? dz / d : Math.sin(u.id)) * push * mw;
          n++;
        }
      }
    // building repulsion (except the building being entered)
    if (u.def.habitat === 'land') {
      const w = this.game.world;
      const tx = Math.floor(x),
        tz = Math.floor(z);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const bx = tx + dx,
            by = tz + dy;
          if (bx < 0 || by < 0 || bx >= w.w || by >= w.h) continue;
          const b = w.building[by * w.w + bx];
          if (b < 0 || b === u._allowB) continue;
          const qx = Math.max(bx, Math.min(bx + 1, x)),
            qz = Math.max(by, Math.min(by + 1, z));
          let ex = x - qx,
            ez = z - qz;
          let d = Math.hypot(ex, ez);
          const pad = r + 0.12;
          if (d >= pad) continue;
          if (d < 1e-4) {
            ex = x - (bx + 0.5);
            ez = z - (by + 0.5);
            d = Math.hypot(ex, ez) || 1;
            sx += (ex / d) * 2.5;
            sz += (ez / d) * 2.5;
          } else {
            sx += (ex / d) * ((pad - d) / pad) * 2;
            sz += (ez / d) * ((pad - d) / pad) * 2;
          }
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
    const range = def.sight * def.fleeRange * rangeMul * (u._mSight || 1);
    if (!this.dangerNear(u.x, u.z, range)) return null;
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
    if (a.flags?.pacifist) return false;
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
    // aggressive creatures press their attacks longer
    if (a._mAggr && a._mAggr !== 1) a.combat.maxTime *= Math.min(1.8, Math.max(0.6, a._mAggr));
    if (a.def.kind === 'humanoid' && t.def.kind === 'humanoid' && a.kingdom >= 0 && t.kingdom >= 0 && a.kingdom !== t.kingdom) {
      if (!a._wars) a._wars = new Set();
      if (!a._wars.has(t.kingdom)) {
        a._wars.add(t.kingdom);
        this.log(a, `Fought against ${this.game.civ?.kingdomName?.(t.kingdom) || 'a rival kingdom'}`);
      }
    }
    this.game.events.emit('unit:engage', { unit: a, target: t });
    return true;
  }
  disengage(u) {
    if (!u.combat) return;
    if (u.alive && u.combat.struck) {
      this.addXP(u, u.combat.hunt ? 2 : 3);
      if (!u.combat.hunt && u.def.kind === 'humanoid') {
        u._battles = (u._battles || 0) + 1;
        if (u._battles >= 25 && (u.kills || 0) >= 8) this.tryHero(u, `Hailed as a hero after ${u._battles} battles`);
      }
    }
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
    d *= u._mDmg || 1;
    const wpn = u.equipment?.weapon;
    if (wpn) d *= 1 + wpn.power * 0.06;
    if (def.kind === 'monster' || (def.kind === 'animal' && def.diet !== 'herbivore')) {
      const f = this.game.laws?.beastsFerocity;
      if (typeof f === 'number') d *= f;
    }
    return d;
  }

  _combatTick(u, dt, now) {
    const c = u.combat;
    const t = this.byId.get(c.target);
    if (!t || !t.alive || now - c.since > c.maxTime || (c.hunt && u.def.kind === 'animal' && !this.law('lifePredators'))) {
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
    u.attackCd = u.def.attackCooldown * rng.float(0.85, 1.15) * (u.mad > now ? 0.8 : 1) / Math.min(1.4, Math.max(0.8, u._mAggr || 1));
    u.lastAttack = now;
    if (u.combat) u.combat.struck = true;
    // the swing lands a moment after it starts (renderer shows the wind-up)
    const dmg = this.attackDamage(u) * rng.float(0.8, 1.2) * (u._riding ? this._rideStrikeMul(u, t, now) : 1);
    const l = d || 1;
    const dirX = (t.x - u.x) / l,
      dirZ = (t.z - u.z) / l;
    const hitY = t.y + t.def.height * 0.55 * t.def.size;
    const miss = rng.chance(0.08);
    if (!miss) {
      this.damage(t, dmg, u, { knock: u.def.knockback * (u._charged === now ? 2.4 : 1), dirX, dirZ });
      g.fx.emit?.('hit', { x: t.x - dirX * t.def.radius, y: hitY, z: t.z - dirZ * t.def.radius }, { scale: 0.5 + u.def.mass * 0.08, dir: { x: dirX, y: 0.3, z: dirZ } });
      if (t.def.blood) g.fx.emit?.('blood', { x: t.x, y: hitY, z: t.z }, { scale: 0.5 + Math.min(1, dmg / 20), dir: { x: dirX, y: 0.5, z: dirZ } });
      this.sfx('hit', t.x, t.z, { volume: 0.55, pitch: rng.float(0.85, 1.15) / Math.sqrt(Math.max(0.5, u.def.mass)) });
      if (u.def.kind === 'animal' && u.def.diet !== 'herbivore') this.sfx('growl', u.x, u.z, { volume: 0.45, pitch: rng.float(0.9, 1.15) / Math.sqrt(u.def.mass) });
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
      u._blessHp = (u._blessHp || 1) * 1.2;
      u.blessCount++;
      this._refreshMods(u);
      this.addXP(u, 15);
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
    if (u.flags?.pacifist) {
      this.flee(u, src.x, src.z, 6);
      return;
    }
    const canFight = this.attackDamage(u) > 0;
    let outmatched = def.flees && !(u.mad > now) && (src.def.mass > def.mass * 0.6 || !canFight);
    const aggr = u._mAggr || 1;
    if (canFight && ((u._mFear || 1) > 1.4 || aggr < 0.7) && u.hp < u.maxHp * 0.7) outmatched = true;
    else if (canFight && ((u._mFear || 1) < 0.6 || aggr > 1.3)) outmatched = false;
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
      if (!m.data.tended && this.count(m.species) >= this.capacity(m.species) * 1.6) break;
      const baby = this.spawn(m.species, m.x + g.rng.float(-0.3, 0.3), m.z + g.rng.float(-0.3, 0.3), {
        parents: [m, m._mate && m._mate.alive ? m._mate : null].filter(Boolean),
        age: 0,
        herd: m.herd,
        pack: m.pack,
        home: m.home,
        kingdom: m.kingdom,
        village: m.village,
      });
      if (baby) {
        if (m.data.tended != null) baby.data.tended = m.data.tended;
        baby.heading = m.heading + g.rng.float(-1, 1);
        g.events.emit('unit:birth', { unit: baby, parent: m });
      }
    }
    this.emote(m, 'heart', 2.5);
    g.fx.emit?.('heal', { x: m.x, y: m.y + def.height, z: m.z }, { scale: 0.5 });
    this.sfx('birth', m.x, m.z, { volume: 0.35 });
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
    let p;
    if (u.data.tended != null) {
      // village herds breed up to their target, fed by the villagers
      if (!this.herds.canBreed(u)) return false;
      p = def.fertility;
      const mate = this.nearest(u.x, u.z, 6, (o) => o.species === u.species && o.sex === 'm' && o.age >= def.maturity && !o.sleeping);
      if (!mate || !g.rng.chance(p)) return false;
      u.pregnant = def.gestation;
      this.emote(u, 'heart', 2);
      return true;
    }
    if (!this.law('lifeWildlife')) return false;
    // animals breed mainly in spring; the world age speeds or slows births
    const season = g.time.season;
    const sf = season == null ? 1 : [1.9, 0.9, 0.45, 0.15][Math.floor(season) % 4];
    if (!g.rng.chance(Math.min(1, sf * (u._mFert || 1) * (g.age?.mods?.birth ?? 1) * 0.8))) return false;
    const hardK = this.capacity(u.species) * 1.6;
    if (n >= hardK) return false;
    const humans = this._counts.get('human') || 0;
    if (this.list.length - humans - this.herds.totalTended >= this.faunaBudget()) return false;
    let K = hardK;
    if (def.diet === 'carnivore' || def.brain === 'bear') {
      // predators: limited by the prey they can find
      let prey = 0;
      for (const q of def.prey) prey += this.count(q) * (SPECIES[q]?.mass ?? 1);
      K = Math.max(MVP[u.species] || 2, Math.floor(prey / (def.predRatio || 9)));
      if (u.hunger > 0.45 || n >= K) return false;
      p = def.fertility * (1 - n / K) * (n < (MVP[u.species] || 0) * 2 ? 1.8 : 1);
    } else {
      // grazers: limited by local pasture and crowding (soft carrying capacity)
      let fr = this.forageAt(u.x, u.z);
      if (def.livestock) {
        const w2 = g.world;
        const ti = Math.floor(u.z) * w2.w + Math.floor(u.x);
        if (w2.owner[ti] >= 0) fr = Math.max(fr, 0.85); // tended and fed by villagers
      }
      let crowd = 0;
      this.forEachNear(u.x, u.z, 5, (o) => {
        if (o.species === u.species) crowd++;
      });
      if (fr < 0.35 || crowd > (def.crowd || 12)) return false;
      p = def.fertility * Math.min(1, (fr - 0.35) / 0.4);
    }
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
    u._mate = mate;
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
    if (def.kind === 'animal' && !this.law('lifePredators')) return null;
    const r = (range ?? def.sight) * (u._mSight || 1);
    let best = null,
      bs = Infinity;
    this.forEachNear(u.x, u.z, r, (o, d2) => {
      if (!def.prey.includes(o.species) || o === u) return;
      if (o.species === 'human' && !this.law('beastsHuntPeople')) return;
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
    // an Enraged status (from any source) works like madness
    if (u.statuses && u.statuses.has('enraged') && !(u.mad > now)) {
      const left = u.statuses.get('enraged');
      u.mad = now + (left === Infinity ? 10 : left);
    }
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
    const tx = Math.min(w.w - 1, Math.max(0, u.x | 0)),
      ty = Math.min(w.h - 1, Math.max(0, u.z | 0));
    if (u.def.habitat === 'land' && w.fire[ty * w.w + tx] > 0.05) {
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
    const aggr = u._mAggr || 1;
    if (!u.combat && u.data.hostile && (u.data.autoAggro ?? (u.job === 'soldier' || aggr >= 1.4))) {
      const range = u.def.sight * (u._mSight || 1) * (u.job === 'soldier' ? Math.min(1.5, Math.max(0.7, aggr)) : 0.4);
      const foe = u._riding && u.job === 'soldier' ? this._cavalryFoe(u, range) : this.nearest(u.x, u.z, range, (o) => o !== u && this.isHostile(u, o));
      if (foe) {
        this.engage(u, foe);
        return;
      }
    }
    const brain = this.brains.get(u.species);
    const elapsed = Math.min(3, Math.max(0.05, now - (u._lastThink ?? now - THINK_INTERVAL)));
    u._lastThink = now;
    // tech roles (healers, messengers, riders) act before the registered brain
    if (u.species === 'human' && this._roleThink(u, now)) return;
    // a patient keeps still while a healer comes to them
    if (u._nurseWait > now && !u.combat && u.state !== 'flee') {
      u.target = null;
      u.path = null;
      if (u.state !== 'sleep') u.state = 'idle';
      return;
    }
    if (brain) {
      try {
        brain(u, elapsed, g);
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
    this._pathBudgetFar = PATH_BUDGET_FAR;
    if ((g.frame | 0) !== this._lastFrame) {
      this._lastFrame = g.frame | 0;
      this._frameThinkMs = 0;
      this._ticksThisFrame = 0;
    }
    // fast-forward runs many ticks per frame: no budget there (correctness first)
    const budgetOn = ++this._ticksThisFrame <= 64;
    if (this._tickN % 75 === 0) this.herds.tick(now);
    if (this._tickN % 150 === 7) this._rolesTick();
    this._ridePaths = 0;
    this._landingsTick();
    this._buildDanger();
    const overview = (g.cameraRig?.cur?.dist ?? 0) > OVERVIEW_DIST;
    const cam = g.cameraRig?.cur;
    const focus = this._focus;
    if (cam) {
      focus.x = cam.x;
      focus.z = cam.z;
      const r = Math.max(36, cam.dist * 1.15);
      focus.r2 = r * r;
    }
    const yearDt = dt / YEAR;
    const list = this.list;
    const lifeLaw = typeof g.laws?.lifeLifespan === 'number' ? g.laws.lifeLifespan : 1;
    const tickN = this._tickN;
    for (let k = 0; k < list.length; k++) {
      const u = list[k];
      if (!u.alive) continue;
      const def = u.def;
      u.px = u.x;
      u.pz = u.z;
      u.py = u.y;
      u.ph = u.heading;
      if (!u.flags?.frozenAge) u.age += yearDt;
      u.attackCd -= dt;
      u.stateTime += dt;
      // aboard a vessel: carried along, out of the world until it lands
      if (u.data.aboard != null) {
        this._aboardTick(u, now);
        continue;
      }
      // ---- needs
      const active = u.state === 'run' || u.state === 'flee' || u.state === 'hunt' || u.state === 'attack';
      const lean = MVP[u.species] && (this._counts.get(u.species) || 0) < MVP[u.species] * 2 ? 0.6 : 1;
      if (this.law('lifeHunger')) u.hunger = Math.min(1, u.hunger + dt * def.hungerRate * lean * (u.sleeping ? 0.5 : active ? 1.6 : 1));
      else if (u.hunger > 0) u.hunger = Math.max(0, u.hunger - dt * 0.02);
      if (u.sleeping || u.state === 'sleep' || u.data.inside) u.energy = Math.min(1, u.energy + dt * 0.0075);
      else if (u._ext) {
        // brain-driven villagers: tire while busy, recover when idle and at night
        const night = (g.env?.daylight ?? 1) < 0.2;
        const rest = !u.moving && u.state !== 'work' && !u.combat;
        u.energy = Math.min(1, Math.max(0, u.energy + dt * (rest || night ? 0.006 : -def.energyRate * (active ? 1.2 : 0.35))));
      } else u.energy = Math.max(0, u.energy - dt * def.energyRate * (active ? 2.5 : 1) * (u.swimming ? 4 : 1));
      if (u.pregnant > 0) {
        u.pregnant -= yearDt;
        if (u.pregnant <= 0) this._giveBirth(u);
      }
      if (u.hunger >= 1 && def.starves) {
        u.hp -= dt * def.hp * 0.025;
        if (u.hp <= 0) {
          this.kill(u, 'starvation');
          if (!u.alive) continue;
        }
      }
      if (u.age > u.lifespan * lifeLaw && this.law('lifeAging') && !u.flags?.immortal) {
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
        if (!u._carcass && def.kind === 'animal' && def.diet !== 'carnivore' && u.activity !== 'fish') gain = this._graze(u, dt);
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
      const fdx = u.x - focus.x,
        fdz = u.z - focus.z;
      u._far = (overview || fdx * fdx + fdz * fdz > focus.r2) && !u.combat;
      u.thinkT -= dt;
      if (u.thinkT <= 0) {
        if (budgetOn && this._frameThinkMs > THINK_BUDGET_MS && !u.combat) {
          u.thinkT = 0.05 + g.rng.next() * 0.15; // over budget: think a little later
        } else {
          let mul = u._far ? FAR_THINK[def.kind] || 2 : 1;
          // calm grazers with no danger about re-decide less often
          if (def.kind === 'animal' && def.diet === 'herbivore' && !u.combat && u.hunger < 0.4 && !u.alarm && u.fleeUntil < now && !this.dangerNear(u.x, u.z, def.sight)) mul *= 1.6;
          u.thinkT = THINK_INTERVAL * (0.8 + g.rng.next() * 0.4) * mul;
          u._ext = this.brains.has(u.species);
          const t0 = budgetOn ? performance.now() : 0;
          this._think(u, now);
          if (budgetOn) this._frameThinkMs += performance.now() - t0;
          if (!u.alive) continue;
        }
      }
      const bt = BRAIN_TICKS[def.brain];
      if (bt) bt(u, dt, this, g, now);
      if ((tickN + u.id) % 15 === 0) {
        this._depthStatusTick(u, dt * 15, now);
        if (!u.alive) continue;
      }
      const sepEvery = (u._far ? 8 : 4) * (u.moving || u.target ? 1 : 2);
      if ((tickN + u.id) % sepEvery === 0) this._separate(u);
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
    if (tickN % 15 === 0) this._forageTick(dt * 15);
    if (tickN % 900 === 1) this._initForage();
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
    this._wanderingMonsters();
    if (!this.migration || !this.law('lifeWildlife')) return;
    for (const def of Object.values(SPECIES)) {
      if (!def.seed) continue;
      const n = this.count(def.id);
      const mvp = MVP[def.id] || 5;
      if (n >= mvp) continue;
      // rare migrants arrive from the map edge (spawnRate law scales how often)
      const rate = typeof this.game.laws?.spawnRate === 'number' ? Math.max(0.1, this.game.laws.spawnRate) : 1;
      if (now - (this._rescueAt.get(def.id) ?? -1e9) < (n === 0 ? 30 : 75) / rate) continue;
      const spot = this._edgeSpot(def);
      if (!spot) continue;
      const grp = this.spawnGroup(def.id, spot.x, spot.z, this.game.rng, def.pack ? 3 : def.solitary ? 2 : null);
      if (grp.length) {
        this._rescueAt.set(def.id, now);
        if (grp.length >= 2 && !grp.some((g) => g.sex === 'm')) grp[1].sex = 'm';
        if (!grp.some((g) => g.sex === 'f')) grp[0].sex = 'f';
      }
    }
  }
  // Wandering monsters (beastsMonsters law, World Age 'monsters' modifier).
  _wanderingMonsters() {
    const g = this.game;
    const ageM = g.age?.mods?.monsters ?? 1;
    // the law covers ordinary ages; a monstrous age (Twilight) always brings them
    if (!this.law('beastsMonsters') && ageM <= 1.001) return;
    const spawnRate = typeof g.laws?.spawnRate === 'number' ? Math.max(0.1, g.laws.spawnRate) : 1;
    let monsters = 0;
    for (const sp of ['golem', 'serpent', 'skywyrm']) monsters += this.count(sp);
    // ordinary ages (law on): a rare wanderer; a monstrous age: about (mod - 1)
    // monsters per game minute across a medium map (this check runs every 15 s)
    const perMin = ageM > 1.001 ? (ageM - 1) * this.popScale : 0.18 * ageM;
    const cap = Math.round((ageM > 1.001 ? 4 + 2 * (ageM - 1) : 3) * this.popScale);
    if (monsters >= cap || !g.rng.chance(Math.min(0.9, (perMin / 4) * spawnRate))) return;
    const w = g.world;
    const roll = g.rng.next();
    const species = roll < 0.5 ? 'golem' : roll < 0.8 ? 'serpent' : 'skywyrm';
    const villages = (g.civ?.villages || []).filter((v) => v.alive);
    for (let t = 0; t < 300; t++) {
      const tx = g.rng.int(4, w.w - 5),
        ty = g.rng.int(4, w.h - 5);
      const i = w.idx(tx, ty);
      // deep wilds first; on a crowded map, anywhere a little way from towns
      const strict = t < 150;
      if (strict && w.owner[i] >= 0 && species !== 'serpent') continue;
      if (species === 'serpent' ? w.height[i] > -1.2 : !w.isWalkable(tx, ty) || w.building[i] >= 0) continue;
      const minD = strict ? 26 : 12;
      if (villages.some((v) => (v.cx - tx) ** 2 + (v.cz - ty) ** 2 < minD * minD)) continue;
      const u = this.spawn(species, tx + 0.5, ty + 0.5, { age: 1, alt: species === 'skywyrm' ? 8 : undefined });
      if (u) g.notify?.(`${u.name} has emerged from the wilds.`, 'disaster', { x: u.x, z: u.z });
      return;
    }
  }

  _edgeSpot(def) {
    const w = this.game.world;
    const rng = this.game.rng;
    const tiles = def.seed?.tiles;
    for (let t = 0; t < 200; t++) {
      const side = rng.int(0, 3);
      const d = rng.int(3, 22);
      const tx = side === 0 ? d : side === 1 ? w.w - 1 - d : rng.int(3, w.w - 4);
      const ty = side === 2 ? d : side === 3 ? w.h - 1 - d : rng.int(3, w.h - 4);
      if (!w.isWalkable(tx, ty) || w.owner[w.idx(tx, ty)] >= 0) continue;
      if (tiles && t < 150 && !tiles.includes(w.type[w.idx(tx, ty)])) continue;
      return { x: tx + 0.5, z: ty + 0.5 };
    }
    // no usable map edge (islands): any wild spot in suitable habitat away from towns
    for (let t = 0; t < 600; t++) {
      const tx = rng.int(2, w.w - 3),
        ty = rng.int(2, w.h - 3);
      const i = w.idx(tx, ty);
      if (!w.isWalkable(tx, ty) || w.owner[i] >= 0 || w.building[i] >= 0) continue;
      if (tiles && t < 450 && !tiles.includes(w.type[i])) continue;
      return { x: tx + 0.5, z: ty + 0.5 };
    }
    return null;
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
    if (u.data.aboard != null) return 'At sea';
    if (u.state === 'flee') return 'Fleeing';
    if (u.swimming) return 'Swimming';
    if (u.state === 'eat') return u.def.diet === 'herbivore' ? 'Grazing' : 'Feeding';
    if (u.state === 'work') {
      const a = u.data.workAnim;
      return a === 'chop' ? 'Chopping wood' : a === 'dig' ? 'Mining' : a === 'hammer' ? 'Building' : a === 'harvest' ? 'Harvesting' : a === 'fish' ? 'Fishing' : a === 'heal' ? 'Tending the sick' : 'Working';
    }
    if (u.data.ride && (u.data.ride.phase === 'out' || u.data.ride.phase === 'back') && u.moving) {
      const v = this.game.civ?.villages?.[u.data.ride.phase === 'out' ? u.data.ride.to : u.village];
      return v ? `Riding to ${v.name}` : 'Riding';
    }
    if (u.data.heal?.pid && u.moving) return 'Hurrying to the sick';
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
      ['Health', Math.min(Math.ceil(u.hp), Math.ceil(u.maxHp)) + ' / ' + Math.ceil(u.maxHp)],
      ['Mood', this.moodLabel(u)],
      ['Doing', this.activityLabel(u)],
    ];
    if (def.starves || def.kind === 'humanoid') stats.push(['Hunger', `${hungerL} (${pct(1 - u.hunger)})`]);
    stats.push(['Energy', `${energyL} (${pct(u.energy)})`]);
    if (def.kind === 'humanoid') {
      if (u.job) stats.push(['Job', u.job.charAt(0).toUpperCase() + u.job.slice(1)]);
      const role = this.roleOf(u);
      if (role && (role !== u.job || u._cured)) stats.push(['Role', ROLE_NAMES[role] + (u._cured ? ` (${u._cured} healed)` : u._trips ? ` (${u._trips} rides)` : '')]);
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
    if (u.traits && u.traits.length) stats.push(['Traits', u.traits.map((id) => this.TRAITS.find((t) => t.id === id)?.name || id).join(', ')]);
    const kname = u.kingdom >= 0 ? g.civ?.kingdomName?.(u.kingdom) || 'Kingdom ' + u.kingdom : null;
    return {
      priority: 10,
      kind: 'unit',
      unit: u,
      title: (u.name || def.name) + (this.levelTitle(u) ? ' ' + this.levelTitle(u) : ''),
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

installDepth(Units);
installEditing(Units);
installRoles(Units);

export { FLORA, FLORA_INFO };
