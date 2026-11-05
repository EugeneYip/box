import { TILE, TILE_INFO, FLORA, FLORA_INFO, SEA_LEVEL } from '../../world/constants.js';
import { CULTURES, personName, placeName } from './cultures.js';
import { BUILDING_TYPES, buildingLabel, costOf, canAfford, pay } from './catalog.js';
import { USE, YEAR, ADULT_AGE, ROT, ROT_DIR, SPIRAL, spiralCount, clamp } from './util.js';
import { planner } from './planner.js';
import { brain } from './brain.js';
import { politics, relKey } from './politics.js';

// Civilization simulation: villages that grow from hamlets into walled
// cities, kingdoms with rulers, borders, diplomacy and war.
//
// PUBLIC CONTRACT (keep stable, others call these):
//   game.civ.kingdoms                    array of kingdom objects {id, name, color (hex), capital, alive, ...}
//   game.civ.villages                    array of village objects {id, name, kingdom, x, z, population, ...}
//   game.civ.buildings                   array of building objects (see BuildingRenderer)
//   game.civ.kingdomName(id) -> string
//   game.civ.kingdomColor(id) -> hex number
//   game.civ.foundVillage(tx, ty, opts?) -> village|null   (spawns settlers)
//       opts: {culture, kingdom, settlers, starter, silent}
//   game.civ.damageArea(x, z, radius, amount, cause)       (buildings take damage / burn)
//   game.civ.seedInitial(n)              create n starting settlements
// Building object fields read by BuildingRenderer:
//   {id, type, tx, ty, w, h (footprint tiles), x, z, rotation, kingdom, village,
//    level, progress (0..1 construction), hp, maxHp, burning (0..1), alive, style}
//   plus: y (levelled ground height), groundMin, upgrading, upgradeProgress, ruin, seed, rot (0..3)
// Extra helpers (additive): declareWar(a,b,reason), makePeace(a,b), rebel(village),
//   goldenAge(kingdomId), villageAt(x,z), kingdomAt(tx,ty), atWar(a,b), allied(a,b),
//   grantPlenty(village), version / stateVersion / fieldVersion / colorVersion counters.

export class Civilization {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.kingdoms = [];
    this.villages = [];
    this.buildings = [];
    this.armies = [];
    this.expeditions = [];
    this.relations = new Map();
    this.version = 0; // structural changes (buildings added/removed/levelled)
    this.stateVersion = 0; // hp / progress / burning changes
    this.fieldVersion = 0; // plots / roads changed
    this.colorVersion = 0; // kingdom colours / ownership of villages changed
    this._init();
    game.units?.registerBrain?.('human', (u, dt) => this.think(u, dt));
    game.events.on('unit:death', ({ unit, cause }) => this._onDeath(unit, cause));
    game.events.on('world:height', (r) => this._onHeight(r));
  }

  _init() {
    const w = this.world;
    this.rng = this.game.rng.fork('civ');
    this.use = new Uint8Array(w.size);
    this.plotOf = new Int16Array(w.size).fill(-1);
    this.reservedBy = new Int32Array(w.size);
    this.reservedT = new Float32Array(w.size);
    this.landId = new Int32Array(w.size);
    this._landSizes = new Map();
    this._terrBest = new Float32Array(w.size);
    this._terrOwner = new Int16Array(w.size);
    this._borders = new Map();
    this._bById = new Map();
    this.rockHits = new Map();
    this.regrow = [];
    this.usedNames = new Set();
    this._nextBid = 1;
    this._nextPlot = 1;
    this._nextArmy = 1;
    this._nextExp = 1;
    this._timers = { b: 0, terr: 0, dip: 0, war: 0, regrow: 0, land: 0, loyal: 0 };
    this._pathBudget = 16;
    this._longBudget = 2;
    this._fxBudget = 0;
    this._seenFrame = -1;
    this._ticksSinceFrame = 0;
    this._famineNote = new Map();
    this._computeLand();
  }

  reset() {
    this.kingdoms.length = 0;
    this.villages.length = 0;
    this.buildings.length = 0;
    this.armies.length = 0;
    this.expeditions.length = 0;
    this.relations.clear();
    this.__walkCost = null;
    this.__roadCost = null;
    this._init();
    this.version++;
    this.stateVersion++;
    this.fieldVersion++;
    this.colorVersion++;
  }

  // ------------------------------------------------------------------ contract
  kingdomName(id) {
    return this.kingdoms[id]?.name || 'Wanderers';
  }
  kingdomColor(id) {
    return this.kingdoms[id]?.color ?? 0xffffff;
  }
  village(id) {
    return this.villages[id] || null;
  }
  buildingById(id) {
    return this._bById.get(id) || null;
  }
  kingdomAt(tx, ty) {
    const w = this.world;
    if (!w.inBounds(tx, ty)) return null;
    const o = w.owner[w.idx(tx, ty)];
    return o >= 0 ? this.kingdoms[o] || null : null;
  }
  villageAt(x, z, maxD = 30) {
    let best = null,
      bd = maxD;
    for (const v of this.villages) {
      if (!v.alive) continue;
      const d = Math.hypot(v.cx - x, v.cz - z);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ people
  spawnHuman(v, x, z, opts = {}) {
    const g = this.game;
    const rng = this.rng;
    const sex = opts.sex || (rng.chance(0.5) ? 'm' : 'f');
    const culture = opts.culture || v.culture;
    const given = personName(culture, sex, rng);
    const w = this.world;
    // make sure we stand on walkable ground
    let sx = x,
      sz = z;
    if (!w.isWalkable(Math.floor(sx), Math.floor(sz))) {
      const n = spiralCount(4);
      for (let k = 0; k < n; k++) {
        const [dx, dy] = SPIRAL[k];
        if (w.isWalkable(Math.floor(x) + dx, Math.floor(z) + dy)) {
          sx = Math.floor(x) + dx + 0.5;
          sz = Math.floor(z) + dy + 0.5;
          break;
        }
      }
    }
    const u = g.units.spawn('human', sx, sz, {
      kingdom: v.kingdom,
      village: v.id,
      age: opts.age ?? rng.float(18, 34),
      sex,
      name: given,
      data: { culture, civ: { task: null, given, home: opts.home ?? -1, lastBirth: -999 } },
    });
    if (!u) return null;
    u.data.hostile = (o) => this.hostileTo(u, o);
    v.members.add(u);
    return u;
  }

  _moveMember(u, v) {
    const old = this.villages[u.village];
    old?.members.delete(u);
    v.members.add(u);
    u.village = v.id;
    u.kingdom = v.kingdom;
    if (u.data.civ) {
      u.data.civ.task = null;
      u.data.civ.army = null;
    }
    if (u.job === 'king' && this.kingdoms[v.kingdom]?.ruler !== u.id) u.job = null;
  }

  _removeMember(u) {
    const old = this.villages[u.village];
    old?.members.delete(u);
    u.village = -1;
    if (u.job !== 'child') u.job = null;
    if (u.data.civ) u.data.civ.task = null;
  }

  _onDeath(u, cause) {
    if (!u || u.species !== 'human') return;
    const v = this.villages[u.village];
    v?.members.delete(u);
    const t = u.data?.civ?.task;
    if (t && t.i != null) this._release(t.i, u);
    const k = this.kingdoms[u.kingdom];
    if (k) {
      if (cause === 'killed') k.warLosses++;
      if (k.alive && k.ruler === u.id) this._succession(k, u.name || 'The ruler');
    }
  }

  // ------------------------------------------------------------------ founding
  _newVillage(k, culture, hx, hy, name = null) {
    const v = {
      id: this.villages.length,
      name: name || placeName(culture, this.rng, this.usedNames),
      kingdom: k.id,
      culture,
      alive: true,
      tx: hx,
      ty: hy,
      cx: hx + 1.5,
      cz: hy + 1.5,
      x: hx + 1.5,
      z: hy + 1.5,
      hall: null,
      buildings: [],
      members: new Set(),
      pop: 0,
      population: 0,
      adults: 0,
      children: 0,
      housing: 0,
      food: 50,
      wood: 24,
      stone: 10,
      gold: 0,
      foodCap: 160,
      plots: [],
      fieldCount: 0,
      roadTiles: [],
      radius: 9,
      buildRadius: 7,
      tier: 0,
      founded: this.game.time.total,
      lastExpand: this.game.time.total,
      lastImmigrant: this.game.time.total,
      loyalty: 80,
      starving: false,
      jobCount: {},
      produced: {},
      landId: this.landId[hy * this.world.w + hx],
      _acc: this.rng.next(),
      _planAcc: this.rng.next() * 3,
      _jobAcc: this.rng.next() * 2.5,
      _loyAcc: this.rng.next() * 5,
    };
    this.villages.push(v);
    k.villages.push(v.id);
    if (k.capital < 0) k.capital = v.id;
    return v;
  }

  foundVillage(tx, ty, opts = {}) {
    const g = this.game;
    const w = this.world;
    if (!w.inBounds(tx, ty)) return null;
    const spot = this._hallSpotNear(tx, ty, opts.searchR ?? 7);
    if (!spot) {
      if (!opts.silent) g.notify('There is no room to found a village here.', 'bad', { x: tx + 0.5, z: ty + 0.5 });
      return null;
    }
    const [hx, hy] = spot;
    const culture = opts.culture || this._cultureAt(hx + 1, hy + 1);
    let k = opts.kingdom != null ? this.kingdoms[opts.kingdom] : null;
    const newKingdom = !k || !k.alive;
    const vname = placeName(culture, this.rng, this.usedNames);
    if (newKingdom) k = this.createKingdom(culture, { baseName: vname });
    const v = this._newVillage(k, culture, hx, hy, vname);

    // hall faces the most open direction
    let bestRot = 0,
      bestFree = -1;
    for (let r = 0; r < 4; r++) {
      const [dx, dz] = ROT_DIR[r];
      let free = 0;
      for (let s = 2; s <= 7; s++)
        for (let o = -3; o <= 3; o++) {
          const x = hx + 1 + dx * s + dz * o,
            y = hy + 1 + dz * s + dx * o;
          if (w.inBounds(x, y) && this._tileFree(y * w.w + x) && w.slopeAt(x, y) < 0.9) free++;
        }
      if (free > bestFree) {
        bestFree = free;
        bestRot = r;
      }
    }
    const hallDone = opts.hallProgress == null || opts.hallProgress >= 1;
    const hall = this.addBuilding(v, 'hall', hx, hy, bestRot, { complete: hallDone, progress: opts.hallProgress ?? 1 });
    // main street along the hall front, plus a lane leading away
    const [dx, dz] = ROT_DIR[bestRot];
    const fx = hx + 1 + dx * 2,
      fy = hy + 1 + dz * 2;
    const px = dz,
      pz = dx;
    this._street(v, fx, fy, px, pz, 6);
    this._street(v, fx - px, fy - pz, -px, -pz, 5);
    this._street(v, fx + dx, fy + dz, dx, dz, 5);
    if (this.rng.chance(0.6)) {
      // a back lane so the village does not grow on one side only
      const bx = hx + 1 - dx * 2,
        by = hy + 1 - dz * 2;
      this._street(v, bx, by, -dx, -dz, 4);
    }

    if (opts.starter) {
      const nHouses = opts.houses ?? 3;
      for (let i = 0; i < nHouses; i++) {
        const b = this.placeAlongRoad(v, 'house');
        if (b) this._completeInstantly(b);
      }
      const p = this._planPlot(v);
      if (p) this._tillInstantly(v, p, true);
      const p2 = this._planPlot(v);
      if (p2 && opts.houses !== 1) this._tillInstantly(v, p2, this.rng.chance(0.5));
      v.food = 70;
      v.wood = 30;
      v.stone = 14;
    }
    this._updateVillageDerived(v);

    // settlers
    const settlers = opts.units || [];
    if (settlers.length) {
      for (const u of settlers) if (u.alive) this._moveMember(u, v);
    } else {
      const n = opts.settlers ?? 10;
      const houses = v.buildings.filter((b) => b.type === 'house');
      const ages = [this.rng.float(34, 52)];
      for (let i = 1; i < n; i++) ages.push(i < n - 3 ? this.rng.float(17, 34) : i < n - 1 ? this.rng.float(11, 15) : this.rng.float(3, 9));
      for (let i = 0; i < n; i++) {
        const a = this.rng.float(0, Math.PI * 2);
        const r = this.rng.float(0.8, 2.6);
        const home = houses.length ? houses[i % houses.length].id : -1;
        this.spawnHuman(v, hall.doorX + Math.cos(a) * r, hall.doorZ + Math.sin(a) * r, { age: ages[i], sex: i % 2 ? 'f' : 'm', home });
      }
      if (!opts.silent) g.fx?.burst?.('spawn', { x: hall.doorX, z: hall.doorZ }, 6);
    }
    if (newKingdom) {
      let ruler = null;
      for (const u of v.members) if (u.age >= ADULT_AGE + 2 && (!ruler || u.age > ruler.age)) ruler = u;
      if (ruler) this.crown(k, ruler);
      if (!opts.silent) g.notify(`The ${k.name} is founded at ${v.name}.`, 'good', { x: v.cx, z: v.cz });
    }
    this._assignJobs(v);
    this._territory();
    this.colorVersion++;
    return v;
  }

  _completeInstantly(b) {
    b.progress = 1;
    b.constructing = false;
    b.hp = b.maxHp;
    this.version++;
  }

  _tillInstantly(v, plot, plant) {
    const w = this.world;
    for (const i of plot.tiles) {
      const x = i % w.w,
        y = (i / w.w) | 0;
      w.setType(x, y, TILE.FARMLAND);
      if (plant) w.setFlora(x, y, FLORA.WHEAT, 0.25 + this.rng.next() * 0.65);
      else w.setFlora(x, y, FLORA.NONE);
    }
    this.fieldVersion++;
  }

  seedInitial(n = 3) {
    n = n ?? 3;
    if (!(n > 0)) return;
    this._computeLand();
    const sites = this._pickStartSites(n);
    for (const s of sites) {
      this.foundVillage(s.tx, s.ty, { culture: s.culture, starter: true, settlers: 10 + this.rng.int(0, 2), silent: true });
    }
    this._territory();
    this.world.flushDirty?.();
  }

  // ------------------------------------------------------------------ expansion
  _tryExpand(v) {
    const now = this.game.time.total;
    if (v.pop < 24 || v.food < 50 || v.starving) return false;
    if (now - v.lastExpand < YEAR * 5) return false;
    const k = this.kingdoms[v.kingdom];
    if (!k || now - (k.lastExpand || -999) < YEAR * 2.5) return false;
    const aliveVillages = this.villages.filter((o) => o.alive).length;
    if (aliveVillages >= 44 || k.villages.length >= 10) return false;
    if (this.expeditions.some((e) => e.from === v.id)) return false;
    v.lastExpand = now;
    const site = this._findExpansionSite(v);
    if (!site) return false;
    return this._startExpedition(v, site);
  }

  _findExpansionSite(v) {
    const rng = this.rng;
    const w = this.world;
    let best = null,
      bs = -Infinity;
    for (let k = 0; k < 70; k++) {
      const a = rng.float(0, Math.PI * 2),
        r = rng.float(20, 44);
      const tx = Math.floor(v.cx + Math.cos(a) * r),
        ty = Math.floor(v.cz + Math.sin(a) * r);
      if (!w.inBounds(tx, ty)) continue;
      const i = ty * w.w + tx;
      if (this.landId[i] !== v.landId) continue;
      if (w.owner[i] >= 0 && w.owner[i] !== v.kingdom) continue;
      let tooClose = false;
      for (const o of this.villages) if (o.alive && Math.hypot(o.cx - tx, o.cz - ty) < 18) tooClose = true;
      for (const e of this.expeditions) if (Math.hypot(e.site.tx - tx, e.site.ty - ty) < 18) tooClose = true;
      if (tooClose) continue;
      const s = this._scoreSite(tx, ty, { kingdom: v.kingdom, minSpace: 95 });
      if (s < 0) continue;
      const sc = s - Math.abs(r - 27) * 2 + rng.next() * 10;
      if (sc > bs) {
        bs = sc;
        best = { tx, ty };
      }
    }
    return best;
  }

  _startExpedition(v, site) {
    const adults = [...v.members].filter((u) => u.alive && u.age >= ADULT_AGE && u.job !== 'king' && u.job !== 'soldier' && !u.data.civ?.army);
    const kids = [...v.members].filter((u) => u.alive && u.age < ADULT_AGE && u.age > 6);
    const men = adults.filter((u) => u.sex === 'm'),
      women = adults.filter((u) => u.sex === 'f');
    const take = [...men.slice(0, 3), ...women.slice(0, 3), ...kids.slice(0, 1)];
    if (take.length < 5) return false;
    const exp = { id: this._nextExp++, kingdom: v.kingdom, from: v.id, site, members: new Set(take), leader: take[0].id, t: this.game.time.total, village: null };
    for (const u of take) {
      v.members.delete(u);
      u.job = u.age >= ADULT_AGE ? null : 'child';
      u.data.civ.task = { kind: 'migrate', exp: exp.id };
    }
    this.expeditions.push(exp);
    this.kingdoms[v.kingdom].lastExpand = this.game.time.total;
    return true;
  }

  _settleExpedition(exp, u) {
    if (exp.village != null) return;
    const from = this.villages[exp.from];
    const k = this.kingdoms[exp.kingdom];
    const members = [...exp.members].filter((m) => m.alive);
    // far-flung colonies sometimes strike out on their own as a new realm
    const cap = k ? this.villages[k.capital] : null;
    const far = cap ? Math.hypot(cap.cx - u.x, cap.cz - u.z) : 0;
    const independent = !k || !k.alive || (far > 55 && this.rng.chance(0.45)) || this.rng.chance(0.12);
    const nv = this.foundVillage(Math.floor(u.x), Math.floor(u.z), {
      kingdom: independent ? null : k.id,
      culture: from?.culture,
      units: members,
      hallProgress: 0.12,
      searchR: 9,
      silent: true,
    });
    if (!nv) return this._abortExpedition(exp);
    exp.village = nv.id;
    nv.food = 30;
    nv.wood = 26;
    nv.stone = 6;
    if (from && from.alive) {
      const p = Math.min(from.food * 0.2, 30);
      from.food -= p;
      nv.food += p;
    }
    for (const m of members) {
      m.data.civ.task = null;
      if (m.age >= ADULT_AGE) m.job = 'builder';
    }
    this.expeditions = this.expeditions.filter((e) => e !== exp);
    if (from && from.alive) this.connectVillages(from, nv);
    const kk = this.kingdoms[nv.kingdom];
    if (independent && kk) {
      kk.parent = exp.kingdom;
      kk.founded = this.game.time.total - YEAR * 3;
      this.game.notify(`Settlers from ${from?.name || 'afar'} strike out on their own and found the ${kk.name}.`, 'good', { x: nv.cx, z: nv.cz });
    } else this.game.notify(`Settlers from ${from?.name || 'afar'} found the village of ${nv.name}${kk ? ' for the ' + kk.name : ''}.`, 'good', { x: nv.cx, z: nv.cz });
  }

  _abortExpedition(exp) {
    const from = this.villages[exp.from];
    for (const m of exp.members) {
      if (!m.alive) continue;
      if (from && from.alive) {
        from.members.add(m);
        m.village = from.id;
        m.kingdom = from.kingdom;
      } else m.village = -1;
      m.data.civ.task = null;
    }
    this.expeditions = this.expeditions.filter((e) => e !== exp);
  }

  // ------------------------------------------------------------------ tick
  tick(step) {
    const g = this.game;
    this._pathBudget = 16;
    this._longBudget = 2;
    if (g.frame !== this._seenFrame) {
      this._seenFrame = g.frame;
      this._ticksSinceFrame = 0;
    } else this._ticksSinceFrame++;
    this._fxBudget = Math.min(6, this._fxBudget + step * 25);
    for (const v of this.villages) {
      if (!v.alive) continue;
      if ((v._acc += step) >= 1) {
        v._acc -= 1;
        this._villageTick(v, 1);
        if (!v.alive) continue;
      }
      if ((v._jobAcc += step) >= 2.5) {
        v._jobAcc -= 2.5;
        this._assignJobs(v);
      }
      if ((v._planAcc += step) >= 3) {
        v._planAcc -= 3;
        this._plan(v);
      }
      if ((v._loyAcc += step) >= 5) {
        v._loyAcc -= 5;
        this._loyalty(v);
      }
    }
    const T = this._timers;
    if ((T.b += step) >= 0.5) {
      this._buildingsTick(T.b);
      T.b = 0;
    }
    if ((T.terr += step) >= 2) {
      T.terr = 0;
      this._territory();
    }
    if ((T.dip += step) >= 4) {
      T.dip = 0;
      this._diplomacy();
    }
    if ((T.war += step) >= 1) {
      T.war = 0;
      this._wars();
    }
    if ((T.regrow += step) >= 5) {
      T.regrow = 0;
      this._regrowTick();
    }
    if ((T.land += step) >= 30) {
      T.land = 0;
      this._computeLand();
    }
  }

  _updateVillageDerived(v) {
    let housing = 0,
      foodCap = 90,
      houses = 0;
    v.hasWell = v.hasWindmill = v.hasWorkshop = v.hasForge = v.hasBarracks = false;
    v.docks = 0;
    for (const b of v.buildings) {
      if (!b.alive || b.constructing) continue;
      const def = BUILDING_TYPES[b.type];
      if (def.housing) housing += def.housing[b.level - 1] || 0;
      if (b.type === 'house') houses++;
      if (b.type === 'granary') foodCap += def.foodCap;
      if (b.type === 'hall') foodCap += 50 * b.level;
      if (b.type === 'well') v.hasWell = true;
      if (b.type === 'windmill') v.hasWindmill = true;
      if (b.type === 'workshop') {
        v.hasWorkshop = true;
        if (b.level >= 2) v.hasForge = true;
      }
      if (b.type === 'barracks') v.hasBarracks = true;
      if (b.type === 'docks') v.docks++;
    }
    v.housing = housing;
    v.houses = houses;
    v.foodCap = foodCap;
    v.buildRadius = 7 + v.tier * 2.5 + Math.sqrt(v.buildings.length) * 0.9;
    v.radius = clamp(7 + 2.1 * Math.sqrt(v.pop) + v.tier * 2, 8, 24);
    v.population = v.pop;
    v.x = v.cx;
    v.z = v.cz;
  }

  _villageTick(v, dt) {
    const g = this.game;
    const now = g.time.total;
    const w = this.world;
    let pop = 0,
      adults = 0,
      kids = 0;
    const jc = {};
    for (const u of v.members) {
      if (!u.alive) {
        v.members.delete(u);
        continue;
      }
      pop++;
      if (u.age >= ADULT_AGE) adults++;
      else kids++;
      if (u.job) jc[u.job] = (jc[u.job] || 0) + 1;
    }
    v.pop = pop;
    v.adults = adults;
    v.children = kids;
    v.jobCount = jc;
    this._updateVillageDerived(v);

    if (pop === 0 && !this.expeditions.some((e) => e.village === v.id)) {
      if (now - v.founded > 20) this._abandon(v, v.razed ? 'razed' : 'empty');
      return;
    }

    // food
    const golden = now < (this.kingdoms[v.kingdom]?.goldenUntil || 0);
    const eat = ((adults * 2 + kids * 1.3) / YEAR) * dt;
    v.food -= eat;
    v.foodCap = Math.max(v.foodCap, 60);
    if (v.food > v.foodCap) v.food = v.foodCap;
    if (v.food <= 0) {
      v.food = 0;
      if (!v.starving) {
        v.starving = true;
        const last = this._famineNote.get(v.id) || -999;
        if (now - last > 90) {
          this._famineNote.set(v.id, now);
          g.notify(`Famine strikes ${v.name}.`, 'bad', { x: v.cx, z: v.cz });
        }
      }
    } else if (v.food > pop * 0.6 + 3) v.starving = false;

    // crops ripen (farmers plant and harvest; growth is helped along here)
    const rain = g.env.weather?.type === 'rain' || g.env.weather?.type === 'storm';
    const growRate = (dt / 42) * (golden ? 1.3 : 1) * (rain ? 1.25 : 1);
    for (const p of v.plots) {
      let dirty = false;
      for (const i of p.tiles) {
        if (w.flora[i] !== FLORA.WHEAT) continue;
        const gOld = w.floraGrowth[i];
        if (gOld >= 1) continue;
        const gNew = Math.min(1, gOld + growRate * (0.6 + 0.4 * TILE_INFO[w.type[i]].fertile));
        w.floraGrowth[i] = gNew;
        if (Math.floor(gNew * 5) !== Math.floor(gOld * 5)) dirty = true;
      }
      if (dirty) w.markDirty('flora', p.x0, p.y0, p.x1, p.y1);
    }

    // births
    const humans = g.units.count?.('human') ?? 0;
    if (pop < v.housing && v.food > pop * 1.2 + 8 && !v.starving && humans < 1300) {
      let father = false;
      for (const u of v.members) if (u.sex === 'm' && u.age >= 18 && u.age < 60) father = true;
      if (father) {
        for (const u of v.members) {
          if (u.sex !== 'f' || u.age < 18 || u.age > 45) continue;
          const d = u.data.civ;
          if (now - (d.lastBirth ?? -999) < YEAR * 2.5) continue;
          if (!this.rng.chance(0.022 * dt * (golden ? 1.8 : 1))) continue;
          d.lastBirth = now;
          const home = this._homeFor(v, u);
          const child = this.spawnHuman(v, u.x + this.rng.float(-0.3, 0.3), u.z + this.rng.float(-0.3, 0.3), { age: 0, home: home ? home.id : -1, culture: u.data.culture });
          if (child) {
            child.job = 'child';
            this._fx('heal', child.x, child.z, 0.6);
          }
          break;
        }
      }
    }

    // newcomers drawn to prosperous settlements
    if (v.housing - pop >= 3 && v.food > pop * 2 + 20 && pop < 46 && now - v.lastImmigrant > 18 && humans < 1250 && this.rng.chance(0.035 * dt)) {
      v.lastImmigrant = now;
      const a = this.rng.float(0, Math.PI * 2);
      const r = v.radius + 3;
      const x = v.cx + Math.cos(a) * r,
        z = v.cz + Math.sin(a) * r;
      if (w.isWalkable(Math.floor(x), Math.floor(z)) && this.landId[Math.floor(z) * w.w + Math.floor(x)] === v.landId) {
        const u = this.spawnHuman(v, x, z, { age: this.rng.float(17, 30) });
        if (u) u.data.civ.task = { kind: 'arrive' };
      }
    }

    // tiers
    const houses = v.houses || 0;
    const prevTier = v.tier;
    if (v.tier === 0 && pop >= 22 && houses >= 5) v.tier = 1;
    else if (v.tier === 1 && pop >= 42 && houses >= 9 && v.hall?.level >= 2) v.tier = 2;
    else if (v.tier > 0 && pop < 8 + v.tier * 8) v.tier--;
    if (v.tier > prevTier) {
      const k = this.kingdoms[v.kingdom];
      g.notify(`${v.name} has grown into a ${v.tier === 1 ? 'town' : 'city'}${k ? ' of the ' + k.name : ''}.`, 'good', { x: v.cx, z: v.cz });
    }
  }

  _homeFor(v, u) {
    const own = this._bById.get(u.data.civ?.home);
    if (own && own.alive && own.type === 'house') return own;
    const houses = v.buildings.filter((b) => b.alive && b.type === 'house' && !b.constructing);
    if (!houses.length) return v.hall;
    const h = houses[(this.rng.next() * houses.length) | 0];
    if (u.data.civ) u.data.civ.home = h.id;
    return h;
  }

  _abandon(v, why = 'empty') {
    if (!v.alive) return;
    v.alive = false;
    const k = this.kingdoms[v.kingdom];
    for (const u of [...v.members]) this._removeMember(u);
    this._releasePlots(v);
    for (const b of v.buildings) if (b.alive) b.abandoned = true;
    if (k) {
      k.villages = k.villages.filter((id) => id !== v.id);
      if (k.alive) {
        if (!k.villages.length) this._killKingdom(k, 'fallen');
        else if (k.capital === v.id) this._chooseCapital(k);
      }
    }
    if (why !== 'silent') this.game.notify(`${v.name} has been ${why === 'razed' ? 'razed and abandoned' : 'abandoned'}.`, 'bad', { x: v.cx, z: v.cz });
    this.version++;
    this.colorVersion++;
  }

  // ------------------------------------------------------------------ jobs
  _assignJobs(v) {
    if (!v.alive) return;
    const members = [...v.members].filter((u) => u.alive && u.age >= ADULT_AGE && u.job !== 'king' && u.data.civ?.task?.kind !== 'migrate');
    const n = members.length;
    for (const b of v.buildings) b._crew = 0;
    for (const u of members) {
      const t = u.data.civ?.task;
      if (u.job === 'builder' && t && t.kind === 'build') {
        const b = this._bById.get(t.b);
        if (b) b._crew++;
      }
    }
    if (!n) return;
    let sites = 0,
      repairs = 0;
    for (const b of v.buildings) {
      if (!b.alive) continue;
      if (b.constructing || b.upgrading) sites += BUILDING_TYPES[b.type].wall ? 0.25 : 1;
      else if (b.burning > 0.05 || b.hp < b.maxHp * 0.85) repairs++;
    }
    const atWar = this.warCount(v.kingdom) > 0;
    const want = { farmer: 0, builder: 0, woodcutter: 0, fisher: 0, soldier: 0, miner: 0 };
    let left = n;
    const give = (job, k) => {
      k = Math.max(0, Math.min(left, Math.round(k)));
      want[job] += k;
      left -= k;
    };
    const foodLow = v.food < Math.min(v.foodCap * 0.5, v.pop * 2 + 12);
    const foodFull = v.food > v.foodCap * 0.85;
    const woodFull = v.wood > 120 + v.tier * 140;
    const stoneFull = v.stone > 60 + v.tier * 120;
    give('farmer', v.fieldCount ? Math.max(1, Math.min(Math.ceil(v.fieldCount / (foodFull ? 14 : 9)), n * 0.45)) : 0);
    give('fisher', v.docks ? Math.min(v.docks * 2, 1 + n * 0.15) : foodLow && n >= 5 && v.coastal ? 1 : 0);
    if (atWar) give('soldier', Math.max(2, n * 0.28) + (v.hasBarracks ? 3 : 0));
    give('builder', sites ? Math.min(Math.max(1, Math.ceil(sites * 1.1)), 1 + Math.floor(n / 6)) : repairs ? 1 : 0);
    give('woodcutter', woodFull ? (n >= 6 ? 1 : 0) : v.wood < 40 + v.tier * 30 ? 1 + Math.floor(n / 8) : n >= 4 ? 1 + Math.floor(n / 16) : 0);
    if (!atWar && n >= 6) give('soldier', Math.max(1, n * 0.09) + (v.hasBarracks ? 2 : 0));
    if (v.hasRock !== false || v.quarry >= 0) give('miner', stoneFull ? 0 : v.stone < 30 + v.tier * 50 ? 1 + Math.floor(n / 9) : 1);
    // the rest go where they are most useful; anyone left over keeps the town lively
    let guard = 0;
    while (left > 0 && guard++ < 200) {
      if (v.fieldCount > want.farmer * 7 && !foodFull) give('farmer', 1);
      else if (sites > want.builder * 1.5) give('builder', 1);
      else if (!stoneFull && (v.hasRock !== false || v.quarry >= 0) && want.miner < 2 + n / 8) give('miner', 1);
      else if (!woodFull && want.woodcutter < 2 + n / 6) give('woodcutter', 1);
      else if (v.docks && want.fisher < v.docks * 3 && !foodFull) give('fisher', 1);
      else break;
    }
    // current
    const cur = {};
    for (const u of members) if (u.job) cur[u.job] = (cur[u.job] || 0) + 1;
    const free = [];
    const now = this.game.time.total;
    let moves = 0;
    for (const u of members) {
      const j = u.job;
      if (!j || want[j] == null) free.push(u);
    }
    // only move settled workers when there is a real shortage elsewhere
    let shortage = 0;
    for (const job of Object.keys(want)) shortage += Math.max(0, want[job] - (cur[job] || 0));
    shortage -= free.length;
    // demobilise once the war is over
    if (!atWar && (cur.soldier || 0) > want.soldier + 1) {
      for (const u of members) {
        if ((cur.soldier || 0) <= want.soldier) break;
        if (u.job !== 'soldier' || u.data.civ?.army) continue;
        cur.soldier--;
        this._setJob(u, null);
        free.push(u);
      }
    }
    for (const u of members) {
      if (shortage <= 0 || moves >= 2) break;
      const j = u.job;
      if (!j || want[j] == null || u.data.civ?.army) continue;
      if ((cur[j] || 0) <= want[j]) continue;
      if (now - (u.data.civ?.jobSince ?? -99) < 20 && !(j === 'soldier' && want.soldier === 0)) continue;
      cur[j]--;
      free.push(u);
      moves++;
      shortage--;
    }
    for (const job of Object.keys(want)) {
      while ((cur[job] || 0) < want[job] && free.length) {
        // prefer someone empty-handed
        let idx = free.findIndex((u) => !u.carry);
        if (idx < 0) idx = 0;
        const u = free.splice(idx, 1)[0];
        this._setJob(u, job);
        cur[job] = (cur[job] || 0) + 1;
      }
    }
    for (const u of free) if (u.job && u.job !== 'builder') this._setJob(u, null);
  }

  _setJob(u, job) {
    if (u.job === job) return;
    const d = u.data.civ || (u.data.civ = {});
    if (d.task && d.task.i != null) this._release(d.task.i, u);
    d.task = null;
    if (u.job === 'soldier') {
      u.maxHp = u.def.hp;
      u.hp = Math.min(u.hp, u.maxHp);
      d.power = null;
      if (d.army != null) {
        const a = this.armyOf(u);
        a?.units.delete(u);
        d.army = null;
      }
    }
    u.job = job;
    d.jobSince = this.game.time.total;
    if (job === 'soldier') {
      u.maxHp = 64;
      u.hp = Math.max(u.hp, 50);
      d.power = 6.5;
    }
    u.data.workAnim = null;
  }

  // ------------------------------------------------------------------ planning
  _plan(v) {
    if (!v.alive || v.razed) return;
    const g = this.game;
    const now = g.time.total;
    if (v.coastal == null) v.coastal = this._isCoastalVillage(v);
    if (v.hasRock == null) v.hasRock = this._hasRockNear(v);
    // lost the hall? rebuild one
    if (!v.hall || !v.hall.alive) {
      if (v.pop >= 3 && v.wood >= 20) {
        const spot = this._hallSpotNear(Math.floor(v.cx), Math.floor(v.cz), 9);
        if (spot) {
          v.wood -= 20;
          const b = this.addBuilding(v, 'hall', spot[0], spot[1], this.rng.int(0, 3), { progress: 0.05 });
          this._connectToRoads(v, Math.floor(b.doorX), Math.floor(b.doorZ));
        }
      }
      return;
    }
    let sites = 0;
    for (const b of v.buildings) if (b.alive && (b.constructing || b.upgrading) && !BUILDING_TYPES[b.type].wall) sites++;
    const maxSites = 1 + Math.floor(v.adults / 7);
    const count = (type) => {
      let c = 0;
      for (const b of v.buildings) if (b.alive && b.type === type) c++;
      return c;
    };
    let actions = 0;
    const room = () => sites < maxSites && actions < 2;
    const build = (type, placer) => {
      const cost = costOf(type, 1, v.culture);
      if (!canAfford(v, cost)) {
        v.need = type;
        return false;
      }
      const b = placer ? placer() : this.placeAlongRoad(v, type, this._bias(v, type));
      if (!b) {
        this._extendRoads(v);
        return false;
      }
      pay(v, cost);
      sites++;
      actions++;
      return true;
    };
    const upgrade = (b) => {
      if (!b || b.upgrading || b.constructing) return false;
      const def = BUILDING_TYPES[b.type];
      if (b.level >= def.levels) return false;
      const cost = costOf(b.type, b.level + 1, v.culture);
      if (!canAfford(v, cost)) {
        v.need = b.type;
        return false;
      }
      pay(v, cost);
      b.upgrading = true;
      b.upgradeProgress = 0;
      sites++;
      actions++;
      this.version++;
      return true;
    };
    v.need = null;
    const pop = v.pop;
    if (room() && pop >= 8 && count('granary') === 0 && v.food > v.foodCap * 0.7) build('granary');
    // 1 housing
    if (room() && v.housing - pop < 2 + v.tier) {
      const cand = v.tier >= 1 ? v.buildings.find((b) => b.alive && b.type === 'house' && !b.constructing && !b.upgrading && b.level < Math.min(3, v.tier + 1)) : null;
      if (!(cand && this.rng.chance(0.5) && upgrade(cand))) build('house');
    }
    // 2 fields (no cost)
    const targetFields = 8 + pop * 1.1;
    if (v.fieldCount < targetFields && v.plots.filter((p) => p.tiles.some((i) => this.world.type[i] !== TILE.FARMLAND)).length < 2) this._planPlot(v);
    // 3 civic buildings by size
    if (room() && pop >= 10 && count('granary') === 0) build('granary');
    if (room() && pop >= 12 && count('well') < 1 + Math.floor(pop / 35)) build('well', () => this.placeAlongRoad(v, 'well', this._bias(v, 'well')));
    if (room() && pop >= 8 && v.coastal && count('docks') < (pop >= 30 ? 2 : 1)) build('docks', () => this._placeDocks(v));
    if (room() && pop >= 14 && count('workshop') === 0) build('workshop');
    if (room() && pop >= 14 && v.fieldCount >= 20 && count('windmill') === 0) build('windmill');
    if (room() && v.hall.level < v.tier + 1) upgrade(v.hall);
    if (room() && v.tier >= 1 && count('market') === 0) build('market');
    if (room() && pop >= 26 && count('temple') === 0) build('temple');
    const atWar = this.warCount(v.kingdom) > 0;
    if (room() && count('barracks') === 0 && (v.tier >= 1 || (atWar && pop >= 16))) build('barracks');
    if (room() && v.tier >= 1 && count('watchtower') < v.tier + (atWar ? 1 : 0)) {
      const foe = this._nearestForeignVillage(v);
      build('watchtower', () => this._placeOutskirts(v, 'watchtower', v.radius * 0.55, v.radius * 0.85, foe?.cx, foe?.cz));
    }
    if (room() && v.tier >= 1) {
      const ws = v.buildings.find((b) => b.alive && b.type === 'workshop' && b.level < 2 && !b.constructing);
      if (ws) upgrade(ws);
    }
    if (room() && v.tier >= 2) {
      const t = v.buildings.find((b) => b.alive && b.type === 'temple' && b.level < 2 && !b.constructing);
      if (t) upgrade(t);
    }
    if (v.tier >= 2 && !v.wallsPlanned && v.stone >= 60) this._planWalls(v);
    if (v.wallsPlanned && v.wallPlan?.length) this._advanceWalls(v, 3);
    if (room() && v.tier >= 1) {
      const cand = v.buildings.find((b) => b.alive && b.type === 'house' && !b.constructing && !b.upgrading && b.level < Math.min(3, v.tier + 1));
      if (cand && v.wood > 40) upgrade(cand);
    }
    if (room() && v.wood > 45 && v.housing < pop + 6) build('house');
    // keep a few streets in hand for growth
    if (actions === 0 && this.rng.chance(0.25)) this._extendRoads(v);
    this._tryExpand(v);
  }

  _bias(v, type) {
    switch (type) {
      case 'well':
      case 'market':
      case 'temple':
        return (cx, cz) => -0.4 * Math.max(0, 8 - Math.hypot(cx - v.cx, cz - v.cz));
      case 'granary':
      case 'windmill':
        return (cx, cz) => {
          let best = 99;
          for (const p of v.plots) best = Math.min(best, Math.hypot(cx - (p.x0 + p.x1) / 2, cz - (p.y0 + p.y1) / 2));
          return best * 0.8 - Math.hypot(cx - v.cx, cz - v.cz) * (type === 'windmill' ? 0.6 : 0.3);
        };
      case 'barracks':
        return (cx, cz) => -Math.hypot(cx - v.cx, cz - v.cz) * 0.8;
      default:
        return null;
    }
  }

  _nearestForeignVillage(v) {
    let best = null,
      bd = Infinity;
    for (const o of this.villages) {
      if (!o.alive || o.kingdom === v.kingdom) continue;
      const d = Math.hypot(o.cx - v.cx, o.cz - v.cz);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return bd < 90 ? best : null;
  }

  _isCoastalVillage(v) {
    const w = this.world;
    const n = spiralCount(Math.min(30, v.buildRadius + 7));
    let water = 0;
    for (let k = 0; k < n; k++) {
      const [dx, dy] = SPIRAL[k];
      const x = Math.floor(v.cx) + dx,
        y = Math.floor(v.cz) + dy;
      if (w.inBounds(x, y) && w.height[y * w.w + x] < SEA_LEVEL - 0.5) water++;
    }
    return water >= 10;
  }

  _hasRockNear(v) {
    const w = this.world;
    const n = spiralCount(Math.min(30, v.buildRadius + 16));
    for (let k = 0; k < n; k++) {
      const [dx, dy] = SPIRAL[k];
      const x = Math.floor(v.cx) + dx,
        y = Math.floor(v.cz) + dy;
      if (!w.inBounds(x, y)) continue;
      const i = y * w.w + x;
      const f = w.flora[i];
      if (f === FLORA.BOULDER || f === FLORA.ROCK_SMALL || (w.type[i] === TILE.ROCK && w.height[i] >= 0)) return true;
    }
    return false;
  }

  _finishBuilding(b) {
    b.constructing = false;
    b.progress = 1;
    b.hp = b.maxHp;
    this.version++;
    const v = this.villages[b.village];
    if (v) this._updateVillageDerived(v);
    if (['temple', 'market', 'barracks', 'docks', 'windmill'].includes(b.type) && v) {
      this.game.notify(`${v.name} completes its ${buildingLabel(b).toLowerCase()}.`, 'info', { x: b.x, z: b.z });
    }
    this._fx('sparkle', b.x, b.z, 0.8);
  }

  _finishUpgrade(b) {
    const def = BUILDING_TYPES[b.type];
    b.upgrading = false;
    b.upgradeProgress = 0;
    b.level = Math.min(def.levels, b.level + 1);
    b.maxHp = def.hp[b.level - 1] ?? b.maxHp;
    b.hp = b.maxHp;
    this.version++;
    const v = this.villages[b.village];
    if (v) this._updateVillageDerived(v);
    if (b.type === 'hall' && v) this.game.notify(`${v.name} raises a ${buildingLabel(b).toLowerCase()}.`, 'good', { x: b.x, z: b.z });
    this._fx('sparkle', b.x, b.z, 1);
  }

  // ------------------------------------------------------------------ damage
  damageArea(x, z, radius, amount, cause = 'disaster') {
    for (const b of this.buildings) {
      if (!b.alive) continue;
      const nx = clamp(x, b.tx, b.tx + b.w),
        nz = clamp(z, b.ty, b.ty + b.h);
      const d = Math.hypot(nx - x, nz - z);
      if (d > radius) continue;
      const k = 1 - (d / Math.max(radius, 0.001)) * 0.6;
      const mult = BUILDING_TYPES[b.type].wall ? 0.5 : 1;
      if (cause === 'fire' || cause === 'lava' || cause === 'lightning' || cause === 'meteor' || cause === 'explosion') {
        b.burning = Math.max(b.burning, cause === 'lava' ? 1 : cause === 'fire' ? 0.5 : 0.6);
      }
      this.damageBuilding(b, amount * k * mult, cause);
    }
  }

  damageBuilding(b, amount, cause = 'damage') {
    if (!b || !b.alive) return;
    b.hp -= amount;
    this.stateVersion++;
    if (b.hp <= 0) this.destroyBuilding(b, cause);
  }

  destroyBuilding(b, cause = 'destroyed') {
    if (!b.alive) return;
    const w = this.world;
    b.alive = false;
    b.ruin = true;
    b.ruinT = this.game.time.total;
    b.hp = 0;
    b.constructing = false;
    b.upgrading = false;
    b.burning = cause === 'fire' || cause === 'lava' ? 0.5 : b.burning * 0.5;
    for (let y = b.ty; y < b.ty + b.h; y++)
      for (let x = b.tx; x < b.tx + b.w; x++) {
        const i = y * w.w + x;
        if (w.building[i] === b.id) w.building[i] = -1;
        this.use[i] = USE.RUIN;
      }
    const v = this.villages[b.village];
    if (v) {
      v.buildings = v.buildings.filter((o) => o !== b);
      if (v.hall === b) v.hall = null;
      this._updateVillageDerived(v);
    }
    this._fx('debris', b.x, b.z, 1.2, true);
    this._fx('dust', b.x, b.z, 1.6, true);
    this._fx('smoke', b.x, b.z, 1.2, true);
    if (b.type === 'hall' && v && v.alive && !b.abandoned) this.game.notify(`The ${buildingLabel(b).toLowerCase()} of ${v.name} has been destroyed!`, 'bad', { x: b.x, z: b.z });
    this.version++;
    if (v && v.alive && !v.buildings.some((o) => o.alive && !BUILDING_TYPES[o.type].wall) && (v.razed || v.pop < 3)) this._abandon(v, v.razed ? 'razed' : 'empty');
  }

  _buildingsTick(dt) {
    const g = this.game;
    const w = this.world;
    const now = g.time.total;
    const weather = g.env.weather || {};
    const wet = weather.type === 'rain' || weather.type === 'storm' || weather.type === 'snow' ? weather.intensity ?? 1 : 0;
    let removed = false;
    for (const b of this.buildings) {
      if (!b.alive) {
        if (b.burning > 0) b.burning = Math.max(0, b.burning - dt * 0.03);
        if (now - b.ruinT > YEAR * 4) {
          b.gone = true;
          removed = true;
        }
        continue;
      }
      // tile fire
      let f = 0;
      for (let y = b.ty; y < b.ty + b.h; y++)
        for (let x = b.tx; x < b.tx + b.w; x++) {
          const fi = w.fire[y * w.w + x];
          if (fi > f) f = fi;
        }
      if (f > 0.15 && b.burning < f * 0.8) {
        b.burning = f * 0.8;
        this.stateVersion++;
      }
      if (b.abandoned) {
        this.damageBuilding(b, dt * b.maxHp * 0.02, 'decay');
        if (!b.alive) continue;
      }
      if (b.burning > 0) {
        const def = BUILDING_TYPES[b.type];
        this.damageBuilding(b, b.burning * (def.wall ? 1.5 : 4.5) * dt, 'fire');
        if (!b.alive) continue;
        b.burning = clamp(b.burning + (wet ? -0.15 * wet : 0.015) * dt, 0, 1);
        if (b.burning > 0.55 && this.rng.chance(0.04 * dt)) {
          const tx = b.tx + this.rng.int(-1, b.w),
            ty = b.ty + this.rng.int(-1, b.h);
          if (w.inBounds(tx, ty)) g.disasters?.ignite?.(tx, ty, 0.5);
        }
        this.stateVersion++;
      }
      // flooded
      const ci = Math.floor(b.z) * w.w + Math.floor(b.x);
      if (b.type !== 'docks' && w.height[ci] < SEA_LEVEL - 0.15) this.destroyBuilding(b, 'flood');
    }
    if (removed) {
      for (const b of this.buildings) {
        if (!b.gone) continue;
        for (let y = b.ty; y < b.ty + b.h; y++)
          for (let x = b.tx; x < b.tx + b.w; x++) {
            const i = y * w.w + x;
            if (this.use[i] === USE.RUIN) this.use[i] = USE.FREE;
          }
        this._bById.delete(b.id);
      }
      this.buildings = this.buildings.filter((b) => !b.gone);
      this.version++;
    }
  }

  _onHeight(r) {
    if (this._flattening) return;
    const w = this.world;
    for (const b of this.buildings) {
      if (!b.alive) continue;
      if (b.tx + b.w < r.x0 - 1 || b.tx > r.x1 + 1 || b.ty + b.h < r.y0 - 1 || b.ty > r.y1 + 1) continue;
      let sum = 0,
        n = 0,
        hmin = Infinity,
        hmax = -Infinity;
      for (let y = b.ty; y < b.ty + b.h; y++)
        for (let x = b.tx; x < b.tx + b.w; x++) {
          const h = w.height[y * w.w + x];
          sum += h;
          n++;
          hmin = Math.min(hmin, h);
          hmax = Math.max(hmax, h);
        }
      const avg = sum / n;
      if (Math.abs(avg - b.y) > 0.2) {
        if (hmax - hmin > 2.2) this.damageBuilding(b, b.maxHp * 0.6, 'quake');
        if (!b.alive) continue;
        b.y = avg;
      }
      b.groundMin = this._groundMin(b);
    }
    this.version++;
  }

  _regrowTick() {
    const w = this.world;
    const now = this.game.time.total;
    if (!this.regrow.length) return;
    const keep = [];
    for (const r of this.regrow) {
      if (r.at > now) {
        keep.push(r);
        continue;
      }
      if (w.flora[r.i] !== FLORA.STUMP || this.use[r.i] !== USE.FREE) continue;
      const x = r.i % w.w,
        y = (r.i / w.w) | 0;
      if (r.flora) w.setFlora(x, y, r.flora, 0.12);
      else w.setFlora(x, y, FLORA.NONE);
    }
    this.regrow = keep.length > 4000 ? keep.slice(-4000) : keep;
  }

  // ------------------------------------------------------------------ land & territory
  _computeLand() {
    const w = this.world;
    const W = w.w,
      H = w.h;
    const id = this.landId;
    id.fill(-1);
    this._landSizes = new Map();
    const stack = new Int32Array(w.size);
    let next = 0;
    for (let s = 0; s < w.size; s++) {
      if (id[s] !== -1 || w.height[s] < SEA_LEVEL) continue;
      let sp = 0;
      stack[sp++] = s;
      id[s] = next;
      let size = 0;
      while (sp) {
        const i = stack[--sp];
        size++;
        const x = i % W,
          y = (i / W) | 0;
        if (x > 0 && id[i - 1] === -1 && w.height[i - 1] >= SEA_LEVEL) {
          id[i - 1] = next;
          stack[sp++] = i - 1;
        }
        if (x < W - 1 && id[i + 1] === -1 && w.height[i + 1] >= SEA_LEVEL) {
          id[i + 1] = next;
          stack[sp++] = i + 1;
        }
        if (y > 0 && id[i - W] === -1 && w.height[i - W] >= SEA_LEVEL) {
          id[i - W] = next;
          stack[sp++] = i - W;
        }
        if (y < H - 1 && id[i + W] === -1 && w.height[i + W] >= SEA_LEVEL) {
          id[i + W] = next;
          stack[sp++] = i + W;
        }
      }
      this._landSizes.set(next, size);
      next++;
    }
    for (const v of this.villages) if (v.alive) v.landId = id[Math.floor(v.cz) * W + Math.floor(v.cx)];
  }

  _territory() {
    const w = this.world;
    const W = w.w;
    const best = this._terrBest;
    const own = this._terrOwner;
    best.fill(0);
    own.fill(-1);
    const claim = (cx, cz, R, kid, strength) => {
      const x0 = Math.max(0, Math.floor(cx - R)),
        x1 = Math.min(W - 1, Math.floor(cx + R));
      const y0 = Math.max(0, Math.floor(cz - R)),
        y1 = Math.min(w.h - 1, Math.floor(cz + R));
      const R2 = R * R;
      for (let y = y0; y <= y1; y++) {
        const dz = y + 0.5 - cz;
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - cx;
          const d2 = dx * dx + dz * dz;
          if (d2 > R2) continue;
          const i = y * W + x;
          if (w.height[i] < SEA_LEVEL) continue;
          let s = (1 - Math.sqrt(d2) / R) * strength + 0.001;
          if (w.owner[i] === kid) s += 0.1;
          if (s > best[i]) {
            best[i] = s;
            own[i] = kid;
          }
        }
      }
    };
    for (const v of this.villages) {
      if (!v.alive) continue;
      const k = this.kingdoms[v.kingdom];
      if (!k || !k.alive) continue;
      const strength = 1 + v.tier * 0.25 + (k.capital === v.id ? 0.15 : 0);
      claim(v.cx, v.cz, v.radius, v.kingdom, strength);
      for (const b of v.buildings) if (b.alive && !b.constructing && (b.type === 'watchtower' || b.type === 'tower')) claim(b.x, b.z, b.type === 'watchtower' ? 7 : 4, v.kingdom, 0.8);
    }
    let x0 = W,
      y0 = w.h,
      x1 = -1,
      y1 = -1;
    for (let i = 0; i < w.size; i++) {
      if (w.owner[i] !== own[i]) {
        w.owner[i] = own[i];
        const x = i % W,
          y = (i / W) | 0;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 >= 0) w.markDirty('owner', x0, y0, x1, y1);
    // border lengths between kingdoms
    this._borders.clear();
    for (let y = 0; y < w.h - 1; y++)
      for (let x = 0; x < W - 1; x++) {
        const i = y * W + x;
        const a = own[i];
        if (a < 0) continue;
        const r = own[i + 1],
          d = own[i + W];
        if (r >= 0 && r !== a) this._borders.set(relKey(a, r), (this._borders.get(relKey(a, r)) || 0) + 1);
        if (d >= 0 && d !== a) this._borders.set(relKey(a, d), (this._borders.get(relKey(a, d)) || 0) + 1);
      }
  }

  // ------------------------------------------------------------------ helpers
  _fx(type, x, z, scale = 1, force = false) {
    const g = this.game;
    if (!g.fx?.emit) return;
    if (this._ticksSinceFrame > 45) return; // fast-forwarding
    if (!force) {
      if (this._fxBudget < 1) return;
      const rig = g.cameraRig;
      if (rig) {
        const dd = Math.hypot(rig.cur.x - x, rig.cur.z - z);
        if (dd > rig.cur.dist * 1.1 + 15) return;
      }
      this._fxBudget -= 1;
    }
    g.fx.emit(type, { x, z }, { scale });
  }

  grantPlenty(v) {
    if (!v || !v.alive) return false;
    const w = this.world;
    v.food = Math.max(v.food, v.foodCap);
    v.starving = false;
    for (const p of v.plots) {
      for (const i of p.tiles) {
        const x = i % w.w,
          y = (i / w.w) | 0;
        if (w.type[i] !== TILE.FARMLAND) w.setType(x, y, TILE.FARMLAND);
        w.setFlora(x, y, FLORA.WHEAT, 1);
      }
    }
    v.loyaltyBoost = 20;
    this.fieldVersion++;
    this.game.fx?.burst?.('sparkle', { x: v.cx, z: v.cz }, 16, { scale: 2 });
    this.game.fx?.burst?.('heal', { x: v.cx, z: v.cz }, 6, { scale: 1.5 });
    this.game.notify(`A season of plenty blesses ${v.name}: granaries overflow and the fields stand ripe.`, 'good', { x: v.cx, z: v.cz });
    return true;
  }

  // ------------------------------------------------------------------ inspect & stats
  _buildingAtPoint(x, z) {
    const w = this.world;
    const tx = Math.floor(x),
      ty = Math.floor(z);
    if (w.inBounds(tx, ty)) {
      const b = this._bById.get(w.building[w.idx(tx, ty)]);
      if (b) return b;
    }
    for (const b of this.buildings) if (x >= b.tx - 0.2 && x <= b.tx + b.w + 0.2 && z >= b.ty - 0.2 && z <= b.ty + b.h + 0.2) return b;
    return null;
  }

  inspect(hit) {
    if (!hit) return null;
    const b = this._buildingAtPoint(hit.x, hit.z);
    if (b) {
      const v = this.villages[b.village];
      const k = this.kingdoms[b.kingdom];
      const def = BUILDING_TYPES[b.type];
      let status = 'Standing';
      if (!b.alive) status = 'Ruins';
      else if (b.constructing) status = `Under construction (${Math.round(b.progress * 100)}%)`;
      else if (b.upgrading) status = `Being upgraded (${Math.round(b.upgradeProgress * 100)}%)`;
      if (b.alive && b.burning > 0.05) status = 'On fire!';
      const stats = [
        ['Status', status],
        ['Health', `${Math.max(0, Math.ceil(b.hp))} / ${b.maxHp}`],
        ['Style', CULTURES[b.culture]?.name || b.style],
      ];
      if (def.housing && b.alive) stats.push(['Houses', `${def.housing[b.level - 1]} people`]);
      if (def.levels > 1) stats.push(['Level', `${b.level} / ${def.levels}`]);
      if (b.type === 'hall' && v) {
        stats.push(['Population', v.pop], ['Food', `${Math.floor(v.food)} / ${v.foodCap}`], ['Wood · Stone · Gold', `${Math.floor(v.wood)} · ${Math.floor(v.stone)} · ${Math.floor(v.gold)}`]);
      }
      return {
        priority: 20,
        kind: 'building',
        building: b,
        village: v,
        kingdom: k,
        title: buildingLabel(b) + (b.alive ? '' : ' (ruins)'),
        subtitle: `${v ? v.name : 'Abandoned'}${k ? ' · ' + k.name : ''}`,
        stats,
      };
    }
    const v = this.villageAt(hit.x, hit.z, 6);
    if (v) return this._inspectVillage(v, 6);
    const k = this.kingdomAt(hit.tx, hit.ty);
    if (k) return this._inspectKingdom(k, 2);
    return null;
  }

  _inspectVillage(v, priority) {
    const k = this.kingdoms[v.kingdom];
    const tier = ['Village', 'Town', 'City'][v.tier];
    return {
      priority,
      kind: 'village',
      village: v,
      kingdom: k,
      title: v.name,
      subtitle: `${tier} of the ${k ? k.name : 'unclaimed lands'} · ${CULTURES[v.culture]?.name}`,
      stats: [
        ['Population', `${v.pop} (${v.children} children)`],
        ['Housing', v.housing],
        ['Food', `${Math.floor(v.food)} / ${v.foodCap}${v.starving ? ' (famine)' : ''}`],
        ['Wood · Stone · Gold', `${Math.floor(v.wood)} · ${Math.floor(v.stone)} · ${Math.floor(v.gold)}`],
        ['Buildings', v.buildings.filter((b) => b.alive).length],
        ['Fields', `${v.fieldCount} plots`],
        ['Loyalty', `${Math.round(v.loyalty)}%`],
      ],
    };
  }

  _inspectKingdom(k, priority) {
    const cap = this.villages[k.capital];
    const wars = this.enemiesOf(k.id).map((e) => this.kingdoms[e]?.name).filter(Boolean);
    const allies = [];
    for (const r of this.relations.values()) if (r.ally && (r.a === k.id || r.b === k.id)) allies.push(this.kingdoms[r.a === k.id ? r.b : r.a]?.name);
    return {
      priority,
      kind: 'kingdom',
      kingdom: k,
      title: k.name,
      subtitle: `${CULTURES[k.culture]?.name} realm · banner of ${k.colorName}`,
      color: k.color,
      stats: [
        ['Ruler', this.rulerLabel(k)],
        ['Capital', cap ? cap.name : '—'],
        ['Villages', k.villages.length],
        ['Population', k.population],
        ['Soldiers', k.soldiers],
        ['At war with', wars.length ? wars.join(', ') : 'nobody'],
        ['Allies', allies.length ? allies.join(', ') : 'none'],
        ['Founded', `year ${Math.floor(k.founded / YEAR)}`],
      ],
    };
  }

  stats() {
    let kingdoms = 0,
      villages = 0,
      towns = 0,
      cities = 0,
      buildings = 0,
      wars = 0,
      alliances = 0;
    for (const k of this.kingdoms) if (k.alive) kingdoms++;
    for (const v of this.villages) {
      if (!v.alive) continue;
      villages++;
      if (v.tier === 1) towns++;
      if (v.tier === 2) cities++;
    }
    for (const b of this.buildings) if (b.alive) buildings++;
    for (const r of this.relations.values()) {
      if (r.war) wars++;
      if (r.ally) alliances++;
    }
    return { kingdoms, villages, towns, cities, buildings, wars, alliances, armies: this.armies.length };
  }
}

Object.assign(Civilization.prototype, planner, brain, politics);
