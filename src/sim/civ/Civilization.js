import { TILE, TILE_INFO, FLORA, FLORA_INFO, SEA_LEVEL } from '../../world/constants.js';
import { CULTURES, personName, placeName, baseCulture } from './cultures.js';
import { BUILDING_TYPES, buildingLabel, costOf, canAfford, pay } from './catalog.js';
import { USE, YEAR, ADULT_AGE, ROT, ROT_DIR, SPIRAL, spiralCount, clamp } from './util.js';
import { planner } from './planner.js';
import { brain } from './brain.js';
import { politics, relKey } from './politics.js';
import { editing } from './editing.js';
import { unlocks } from './unlocks.js';
import { tech, ERAS, TECHS, techById } from './tech.js';
import { culture, TRAIT_INFO } from './culture.js';

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

// Growth budget: the world stays lively but bounded (performance target is
// about 1,000 units and 300-400 buildings on a 256 map).
// Budgets scale with map area (a = w*h / 256^2): a Huge 512 map tops out near
// 900 people and 900 buildings.
const VILLAGE_MAX_POP = 64; // legacy reference size (a town)
const TIER_POP = [40, 70, 115]; // village, town, city
// What each finished monument gives its realm (techMod / techAdd keys).
const MONUMENT_FX = {
  vale: { mods: { 'loyalty+': 6, build: 1.15 }, text: 'its provinces hold fast to the crown' },
  dune: { mods: { gold: 1.5, 'loyalty+': 2 }, text: 'caravans come from every road' },
  frost: { mods: { research: 1.35 }, text: 'scholars gather to read its runes' },
  mire: { mods: { harvest: 1.15, birth: 1.15 }, text: 'the fields and the families flourish' },
  colossus: { mods: { 'loyalty+': 3, research: 1.1, march: 1.05 }, text: 'the people stand taller beneath it' },
};

// Each realm raises its own design (see archetypes wonder/statue variants).
const MONUMENT_TITLES = {
  wonder: {
    vale: ['Great Spire', 'Sky Cathedral', 'Bell Minster'],
    dune: ['Sun Pillar', 'Obelisk Court', 'Orb of Dawn'],
    frost: ['Rune Tower', 'Storm Hall', 'Four-Spired Hold'],
    mire: ['Sky Totem', 'Thunder Pole', 'Sun-Bird Mast'],
  },
};
function monumentTitle(type, style, variant) {
  return MONUMENT_TITLES[type]?.[style]?.[variant % 3] || null;
}

function budgets(w, h, area = w * h) {
  const a = area / (256 * 256);
  return {
    area: a,
    humans: Math.round(Math.min(900, 850 * Math.pow(a, 0.04))),
    buildings: Math.round(Math.min(920, 300 * Math.pow(a, 0.8))),
    villages: Math.round(30 * Math.pow(a, 0.55)),
    startVillages: Math.max(1, Math.round(3 * Math.pow(a, 0.7))),
  };
}

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
    // Fleets (optional module) reports voyages; Civ applies the cargo
    game.events.on('fleet:arrived', (e) => this._onFleetArrived?.(e));
    game.events.on('fleet:lost', (e) => {
      const k = this.kingdoms[e?.kingdom ?? e?.vessel?.kingdom];
      if (k && (e?.cargo?.settlers || e?.cargo?.army)) this._history(`A ship of ${this._kn(k)} is lost at sea with all aboard`, 'bad', null);
    });
    game.events.on('laws', ({ key, value }) => {
      if ((key === 'civWars' || key == null) && !this.law('civWars')) this._endAllWars();
      if ((key === 'civDiplomacy' || key == null) && !this.law('civDiplomacy')) for (const r of this.relations.values()) r.ally = false;
      // settlers on the road turn back home
      if ((key === 'civExpansion' || key == null) && !this.law('civExpansion')) for (const e of [...this.expeditions]) this._abortExpedition(e);
    });
  }

  _init() {
    const w = this.world;
    this.rng = this.game.rng.fork('civ');
    this.budget = budgets(w.w, w.h, w.meta?.budgetArea); // World Map: scaled by habitable land
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
    this._noteT = new Map();
    this.history = []; // full civ chronicle: {t, text, kind, x, z}
    this._techFirst = new Set();
    this._initCultures();
    this.battles = [];
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
      if (k.alive && k.ruler === u.id) {
        this._lastRulerId = u.id;
        // keep a short record of how reigns end (inspect / tuning)
        const rs = this.reignEnds || (this.reignEnds = []);
        rs.push({ cause, age: Math.floor(u.age), reign: Math.round((this.game.time.total - (u.data.civ?.crownedAt ?? this.game.time.total)) / YEAR) });
        if (rs.length > 40) rs.shift();
        this._succession(k, u.name || 'The ruler');
        this._lastRulerId = null;
      }
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
      cultureMix: { [culture]: 1 },
      ore: 0,
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
    if (newKingdom) k = this.createKingdom(culture, { baseName: vname, x: hx + 1.5, z: hy + 1.5 });
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
      if (!opts.silent) this._note(`The ${k.name} rises at ${v.name}`, 'good', { x: v.cx, z: v.cz });
      if (!opts.silent) this._sfx('bell', v.cx, v.cz, 0, true);
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
    // the default of three starting villages grows with the map
    const explicit = this.game.params?.raw?.has?.('civs');
    if (!explicit && (n == null || n === 3)) n = this.budget.startVillages;
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
    if (!this._kLaw(v.kingdom, 'civExpansion')) return false;
    if (v.pop < (this._crowd() < 0.3 ? 18 : 24) || v.food < 50 || v.starving) return false;
    const crowd = this._crowd();
    if (now - v.lastExpand < YEAR * (5 + crowd * 10)) return false;
    const k = this.kingdoms[v.kingdom];
    if (!k || now - (k.lastExpand || -999) < YEAR * (2.5 + crowd * 6)) return false;
    const aliveVillages = this.villages.filter((o) => o.alive).length;
    if (aliveVillages >= this.budget.villages || k.villages.length >= 14) return false;
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
    // first choice: resettle an abandoned village nearby (its fields and roads remain)
    for (const o of this.villages) {
      if (o.alive || o.resettled) continue;
      const d = Math.hypot(o.cx - v.cx, o.cz - v.cz);
      if (d < 14 || d > 60 || o.landId !== v.landId) continue;
      const i = Math.floor(o.cz) * w.w + Math.floor(o.cx);
      if (w.owner[i] >= 0 && w.owner[i] !== v.kingdom) continue;
      if (this.villages.some((x) => x.alive && Math.hypot(x.cx - o.cx, x.cz - o.cz) < 14)) continue;
      const sc = 400 - d;
      if (sc > bs) {
        bs = sc;
        best = { tx: Math.floor(o.cx), ty: Math.floor(o.cz), resettle: o.id };
      }
    }
    if (best) return best;
    const reach = this._crowd() > 0.6 ? 70 : 44; // a full realm looks further afield
    for (let k = 0; k < 90; k++) {
      const a = rng.float(0, Math.PI * 2),
        r = rng.float(20, reach);
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
      // unclaimed land is the prize
      const sc = s - Math.abs(r - 27) * 1.2 + (w.owner[i] < 0 ? 40 : 0) + rng.next() * 10;
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
    const independent = !k || !k.alive || (this.law('civNewKingdoms') && ((far > 55 && this.rng.chance(0.45)) || this.rng.chance(0.12)));
    if (exp.site.resettle != null) {
      const old = this.villages[exp.site.resettle];
      if (old) {
        old.resettled = true;
        this._clearRuins(old.cx, old.cz, 9);
      }
    }
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
    this._sfx('bell', nv.cx, nv.cz, 2);
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
      this._note(`Settlers from ${from?.name || 'afar'} found the ${kk.name}`, 'good', { x: nv.cx, z: nv.cz });
      this._noteT.set('settle' + exp.kingdom, this.game.time.total);
    } else this._note(`Settlers found ${nv.name}`, 'good', { x: nv.cx, z: nv.cz }, 'settle' + nv.kingdom, 150);
  }

  _clearRuins(x, z, r) {
    const w = this.world;
    for (const b of this.buildings) {
      if (b.alive || b.gone || Math.hypot(b.x - x, b.z - z) > r) continue;
      b.gone = true;
      for (let y = b.ty; y < b.ty + b.h; y++)
        for (let xx = b.tx; xx < b.tx + b.w; xx++) {
          const i = y * w.w + xx;
          if (this.use[i] === USE.RUIN) this.use[i] = USE.FREE;
        }
      this._bById.delete(b.id);
    }
    this.buildings = this.buildings.filter((b) => !b.gone);
    this.version++;
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
    this._fxBudget = Math.min(6, this._fxBudget + step * (g.settings?.powerSaver ? 12 : 25));
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
    // (bigger maps refresh territory less often: the fill grows with the map)
    if ((T.terr += step) >= 2 * Math.max(1, Math.sqrt(this.world.size / 65536))) {
      T.terr = 0;
      // the full flood fill is costly on big maps: only when the realms changed
      this._territoryIfChanged();
    }
    if ((T.dip += step) >= 4) {
      T.dip = 0;
      this._diplomacy();
    }
    if ((T.war += step) >= 1) {
      T.war = 0;
      this._wars();
    }
    if ((T.cart = (T.cart || 0) + step) >= 8) {
      T.cart = 0;
      this._cartFood();
    }
    if ((T.regrow += step) >= 5) {
      T.regrow = 0;
      this._regrowTick();
    }
    if ((T.tower = (T.tower || 0) + step) >= 1) {
      T.tower = 0;
      this._towerTick();
    }
    if ((T.tech = (T.tech || 0) + step) >= 2) {
      this._researchTick(T.tech);
      this._inventoryTick(T.tech);
      this._wonderFx();
      this._unlockTick(T.tech);
      this._worksTick();
      T.tech = 0;
    }
    if ((T.cult = (T.cult || 0) + step) >= 5) {
      T.cult = 0;
      this._cultureTick();
    }
    if ((T.wander = (T.wander || 0) + step) >= 20) {
      T.wander = 0;
      this._wanderers();
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
    v.foodCap = Math.round(foodCap * this.techMod(v.kingdom, 'foodCap'));
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
    const season = g.time.season ?? 1.5;
    const winter = season >= 3;
    const mods = g.age?.mods || {};
    // winter: hearths burn and nothing grows, the granaries carry the village
    const eat = ((adults * 2 + kids * 1.3) / YEAR) * dt * (winter ? 1.2 : 1);
    v.food -= eat;
    // upkeep: firewood for every hearth and timber to keep roofs mended
    const nb = v.buildings.length;
    v.wood = Math.max(0, v.wood - ((pop * 0.2 + nb * 0.06) / YEAR) * dt);
    // storage: what does not fit in the stores rots or is carted off
    v.woodCap = 90 + (v.hasWorkshop ? 90 : 0) + (v.hall ? v.hall.level * 40 : 0) + v.tier * 40;
    v.stoneCap = 70 + (v.hasWorkshop ? 80 : 0) + (v.hall ? v.hall.level * 35 : 0) + v.tier * 40;
    // food spoils: a little always, a lot when the granaries are full to bursting
    v.food -= v.food * ((0.03 + (v.food > v.foodCap * 0.8 ? 0.12 : 0)) / YEAR) * dt;
    if (v.wood > v.woodCap) v.wood = v.woodCap;
    if (v.stone > v.stoneCap) v.stone = v.stoneCap;
    // gold: markets trade, road links carry merchants, soldiers draw pay
    const markets = v.buildings.reduce((n, b) => n + (b.alive && b.type === 'market' && !b.constructing ? 1 : 0), 0);
    v.gold += ((markets * (0.8 + pop * 0.02) * this.techMod(v.kingdom, 'gold') * (this.hasCultureTrait(v.culture, 'Mercantile') ? 1.4 : 1) + (v.tradeLinks || 0) * 0.35) / YEAR) * dt;
    if (markets && this.rng.chance(0.06 * dt)) {
      const m = v.buildings.find((b) => b.alive && b.type === 'market' && !b.constructing);
      if (m) this._sfx('coin', m.x, m.z, 3);
    }
    v.gold = Math.max(0, v.gold - (((v.jobCount.soldier || 0) * 0.04) / YEAR) * dt);
    v.gold = Math.min(v.gold, 30 + v.tier * 30);
    v.foodCap = Math.max(v.foodCap, 60);
    if (v.food > v.foodCap) v.food = v.foodCap;
    if (v.food <= 0) {
      v.food = 0;
      v.emptyT = (v.emptyT || 0) + dt;
      // only a true famine: stores empty for a while and no kin can send grain
      if (!v.starving && v.emptyT > 12) {
        v.starving = true;
        v.famineT = now;
        this._note(`Famine in ${v.name}`, 'bad', { x: v.cx, z: v.cz }, 'famine' + v.id, 400);
      }
    } else {
      v.emptyT = 0;
      if (v.food > pop * 0.6 + 3) v.starving = false;
    }
    // famine strikes hard but never wipes out a settlement: relief caravans and
    // foraging keep the last families alive
    if (v.starving && pop <= 8) v.food += (pop * 2.2 / YEAR) * dt;

    // crops ripen (farmers plant and harvest; growth is helped along here)
    const rain = g.env.weather?.type === 'rain' || g.env.weather?.type === 'storm';
    // the fields follow the year: green in spring, golden by autumn, reaped
    // and fallow under the winter snow (the granaries and root cellars feed
    // the village while the farmers thresh and mend)
    const seasonGrow = winter ? 0 : season < 1 ? 1.15 : season >= 2 ? 1.3 : 1;
    const fert = 1 + (this._easedMods().fertility - 1) * 0.5;
    const growRate = (dt / 42) * (golden ? 1.3 : 1) * (rain ? 1.25 : 1) * seasonGrow * fert * this.techMod(v.kingdom, 'harvest');
    if (winter) v.food += (v.jobCount.farmer || 0) * 0.6 * dt * fert;
    for (const p of v.plots) {
      let dirty = false;
      for (const i of p.tiles) {
        if (w.flora[i] !== FLORA.WHEAT) continue;
        if (winter && w.floraGrowth[i] < 0.98) {
          // unripe stalks wither: the field lies bare
          if (this.rng.chance(0.06 * dt)) {
            w.flora[i] = FLORA.NONE;
            w.floraGrowth[i] = 0;
            dirty = true;
          }
          continue;
        }
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
    const crowd = this._crowd();
    const popCrowd = this._popCrowd || 0;
    const fullWorld = humans > this._humanCap() * 0.85;
    if (pop < v.housing && pop < this._popCap(v) && !(fullWorld && pop > 45) && v.food > pop * 1.2 + 8 && !v.starving && humans < this._humanCap() && this.rng.chance(Math.min(1, (1 - popCrowd * 0.85) * this._kLaw(v.kingdom, 'civGrowth', 1) * (v.policy?.growth ?? 1)))) {
      let father = false;
      for (const u of v.members) if (u.sex === 'm' && u.age >= 18 && u.age < 60) father = true;
      if (father) {
        for (const u of v.members) {
          if (u.sex !== 'f' || u.age < 18 || u.age > 45) continue;
          const d = u.data.civ;
          if (now - (d.lastBirth ?? -999) < YEAR * 2.5) continue;
          if (!this.rng.chance(0.022 * dt * (golden ? 1.8 : 1) * this._kLaw(v.kingdom, 'civGrowth', 1) * (v.policy?.growth ?? 1) * (mods.birth ?? 1) * this.techMod(v.kingdom, 'birth'))) continue;
          d.lastBirth = now;
          if (!d.spouse) {
            let mate = null;
            for (const m of v.members) if (m.sex === 'm' && m.age >= 18 && !m.data.civ?.spouse && (!mate || Math.abs(m.age - u.age) < Math.abs(mate.age - u.age))) mate = m;
            if (mate) {
              d.spouse = mate.id;
              mate.data.civ.spouse = u.id;
              this._bio(u, `Married ${mate.name} in ${v.name}`);
              this._bio(mate, `Married ${u.name} in ${v.name}`);
            }
          }
          const home = this._homeFor(v, u);
          const child = this.spawnHuman(v, u.x + this.rng.float(-0.3, 0.3), u.z + this.rng.float(-0.3, 0.3), { age: 0, home: home ? home.id : -1, culture: u.data.culture });
          if (child) {
            child.job = 'child';
            // remember the family, so grief stays within it
            if (child.data.civ) {
              child.data.civ.mother = u.id;
              if (d.spouse != null) child.data.civ.father = d.spouse;
            }
            this._fx('heal', child.x, child.z, 0.6);
          }
          break;
        }
      }
    }

    // in a full world, young families leave the crowded cities of the realm
    // for its hamlets (people move; the total stays within the budget)
    if (pop < 18 && v.housing - pop >= 2 && v.food > pop + 10 && fullWorld && now - (v.lastSettlers || 0) > YEAR * 4 && this.rng.chance(0.05 * dt)) {
      v.lastSettlers = now;
      let src = null;
      for (const vid of this.kingdoms[v.kingdom]?.villages || []) {
        const o = this.villages[vid];
        if (o?.alive && o !== v && o.pop > 40 && o.landId === v.landId && (!src || o.pop > src.pop)) src = o;
      }
      if (src) {
        let moved = 0;
        for (const u of [...src.members]) {
          if (moved >= 3) break;
          if (!u.alive || u.age < ADULT_AGE || u.age > 40 || u.job === 'king' || u.job === 'soldier' || u.data?.civ?.army) continue;
          this._moveMember(u, v);
          moved++;
        }
        if (moved) this._history(`Families from ${src.name} settle in ${v.name}`, 'info', { x: v.cx, z: v.cz });
      }
    }
    // newcomers drawn to prosperous settlements
    // (a camp short of hands or of a partner calls kin in sooner)
    const small = pop < 10;
    if ((v.housing - pop >= 3 || (small && v.housing - pop >= 1)) && v.food > pop * 2 + (small ? 6 : 20) && pop < 40 && now - v.lastImmigrant > (small ? 7 : 18) && humans < this._humanCap() * (small ? 0.95 : 0.8) && this.rng.chance((small ? 0.08 : 0.035) * dt * (1 - popCrowd * (small ? 0.5 : 1)) * this._kLaw(v.kingdom, 'civGrowth', 1) * (v.policy?.growth ?? 1))) {
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

    // a kingdom's new era spreads through its towns building by building
    const K0 = this.kingdoms[v.kingdom];
    // a realm of masters gilds its capital and cities (render era 4)
    let era = Math.min(4, (K0?.era ?? 0) + ((K0?.mastery || 0) >= 4 && (K0.capital === v.id || v.tier >= 1) ? 1 : 0));
    if (era < 1 && K0 && this.hasTech(K0.id, 'masonry')) era = 1; // masons build in stone from the start
    if (this.rng.chance(0.06 * dt)) {
      const old = v.buildings.find((b) => b.alive && !b.constructing && (b.era ?? 0) < era);
      if (old) {
        old.era = Math.min(era, (old.era ?? 0) + 1);
        this.version++;
        this._fx('sparkle', old.x, old.z, 0.8);
      }
    }
    // hungry or unhappy villagers leave in search of better lands
    if (this.law('harmonyMigration') && (v.starving || v.loyalty < 30) && pop > 6 && this.rng.chance(0.02 * dt)) {
      let best = null,
        bd = Infinity;
      for (const o of this.villages) {
        if (!o.alive || o === v || o.starving || o.landId !== v.landId || o.pop >= o.housing) continue;
        if (this.atWar(o.kingdom, v.kingdom)) continue;
        const dd = Math.hypot(o.cx - v.cx, o.cz - v.cz);
        if (dd < bd && dd < 80) {
          bd = dd;
          best = o;
        }
      }
      const mover = best && [...v.members].find((u) => u.alive && u.age >= ADULT_AGE && u.job !== 'king' && u.job !== 'soldier');
      if (mover) {
        this._moveMember(mover, best);
        mover.data.civ.task = { kind: 'arrive' };
        this._mixAdd(best, mover.data.culture || v.culture, 0.04);
        this._bio(mover, `Left ${v.name} for ${best.name}`);
      }
    }
    // forestry: when the woods around a settlement thin out, groves are replanted
    if (now - (v.groveCheck || 0) > 12) {
      v.groveCheck = now;
      let mature = 0,
        young = 0;
      w.forEachInRadius(v.cx, v.cz, Math.min(28, v.buildRadius + 14), (x, y, d, i) => {
        const f = w.flora[i];
        if (f && FLORA_INFO[f].isTree) {
          if (w.floraGrowth[i] >= 0.6) mature++;
          else young++;
        }
      });
      v.trees = mature;
      const want = 75 + v.tier * 20;
      if (mature + young < want) {
        const species = { vale: [FLORA.OAK, FLORA.BIRCH], dune: [FLORA.PALM, FLORA.ACACIA], frost: [FLORA.PINE, FLORA.PINE], mire: [FLORA.JUNGLE_TREE, FLORA.SWAMP_TREE] }[baseCulture(v.culture)] || [FLORA.OAK];
        if (v.groveAngle == null) v.groveAngle = this.rng.float(0, Math.PI * 2);
        let planted = 0;
        for (let k = 0; k < 60 && planted < 10; k++) {
          const a = v.groveAngle + this.rng.float(-1.3, 1.3);
          const r = v.buildRadius + 2 + this.rng.next() * 9;
          const x = Math.floor(v.cx + Math.cos(a) * r),
            y = Math.floor(v.cz + Math.sin(a) * r);
          if (!w.inBounds(x, y)) continue;
          const i = y * w.w + x;
          if (w.flora[i] || this.use[i] !== USE.FREE || w.height[i] < SEA_LEVEL + 0.1) continue;
          const t = w.type[i];
          if (t === TILE.ROAD || t === TILE.FARMLAND || t === TILE.ROCK || t === TILE.SAND || t === TILE.DESERT) continue;
          w.setFlora(x, y, species[(this.rng.next() * species.length) | 0], 0.2);
          planted++;
        }
      }
    }
    // shrinking towns let empty houses crumble rather than stand as ghost towns
    if (v.housing > pop * 1.6 + 8 && now - (v.lastDecay || 0) > 12) {
      v.lastDecay = now;
      let far = null,
        fd = -1;
      for (const b of v.buildings) {
        if (!b.alive || b.type !== 'house' || b.constructing || b.abandoned) continue;
        const d = Math.hypot(b.x - v.cx, b.z - v.cz);
        if (d > fd) {
          fd = d;
          far = b;
        }
      }
      if (far) far.abandoned = true;
    }
    // tiers
    const houses = v.houses || 0;
    const prevTier = v.tier;
    // (a town is measured by its homes: a few fine houses count as many cottages)
    if (v.tier === 0 && pop >= 22 && (houses >= 5 || v.housing >= 24)) v.tier = 1;
    else if (v.tier === 1 && pop >= 50 && (houses >= 9 || v.housing >= 54) && v.hall?.level >= 2) v.tier = 2;
    else if (v.tier > 0 && pop < 8 + v.tier * 8) v.tier--;
    if (v.tier > prevTier) {
      const k = this.kingdoms[v.kingdom];
      this._note(`${v.name} grows into a ${v.tier === 1 ? 'town' : 'city'}`, 'good', { x: v.cx, z: v.cz }, 'tier' + v.id + v.tier, 600);
    }
  }

  // 0 = empty world .. 1 = at the performance budget (units and buildings)
  _crowd() {
    const t = this.game.time.total;
    if (this._crowdT === t) return this._crowdV;
    const humans = this.game.units.count?.('human') ?? 0;
    let blds = 0;
    for (const b of this.buildings) if (b.alive && !BUILDING_TYPES[b.type].wall) blds++; // walls are capped separately
    this._crowdT = t;
    const hc = this._humanCap();
    this._popCrowd = clamp((humans - hc * 0.55) / (hc * 0.45), 0, 1);
    this._crowdV = clamp(Math.max(this._popCrowd, (blds - this.budget.buildings * 0.5) / (this.budget.buildings * 0.5)), 0, 1);
    return this._crowdV;
  }

  // Kingdom inventory: stockpiles summed from the villages, plus the armoury
  // of real items. Smiths at forges turn ore (or stone, early on) and wood into
  // weapons, armour, tools and trinkets of the best material the kingdom
  // knows; soldiers are armed and armoured first, workers get tools, and gear
  // recovered from the fallen is reissued (legendary pieces keep their story).
  _inventoryTick(dt) {
    const g = this.game;
    const U = g.units;
    const real = typeof U.makeItem === 'function' && typeof U.equip === 'function';
    const gearOK = g.laws?.lifeEquipment !== false;
    for (const k of this.kingdoms) {
      if (!k.alive) continue;
      const inv = k.inventory || (k.inventory = { food: 0, wood: 0, stone: 0, ore: 0, gold: 0, tools: 0, weapons: 0, armor: 0, trinkets: 0 });
      const armory = k.armory || (k.armory = []);
      let food = 0,
        wood = 0,
        stone = 0,
        ore = 0,
        gold = 0,
        forges = 0;
      const vs = [];
      for (const vid of k.villages) {
        const v = this.villages[vid];
        if (!v?.alive) continue;
        vs.push(v);
        food += v.food;
        wood += v.wood;
        stone += v.stone;
        ore += v.ore || 0;
        gold += v.gold;
        if (v.hasForge) forges += 1;
        else if (v.hasWorkshop) forges += 0.5;
      }
      // what the realm's people still lack
      let needW = 0,
        needA = 0,
        needT = 0,
        needTr = 0,
        upW = 0,
        upA = 0,
        soldiers = 0;
      const topMat = this.bestMaterial(k.id);
      const MP = { wood: 0.6, stone: 0.8, bronze: 1, iron: 1.3, steel: 1.6, starsteel: 2.4 };
      const topP = MP[topMat] || 1;
      const old = (it) => it && !it.legendary && (MP[it.material] || 1) < topP - 0.2;
      for (const v of vs)
        for (const u of v.members) {
          if (!u.alive || u.age < ADULT_AGE) continue;
          const e = this._gearOf(u);
          if (u.job === 'soldier') {
            soldiers++;
            if (!e.weapon) needW++;
            else if (old(e.weapon)) upW++;
            if (!e.armor) needA++;
            else if (old(e.armor)) upA++;
          } else if (u.job && u.job !== 'king' && u.job !== 'child' && !e.tool) needT++;
          if (!e.trinket && this._trinketWorthy(u)) needTr++;
        }
      const stockOf = (slot) => armory.reduce((n, it) => n + (it.slot === slot ? 1 : 0), 0);
      const freshOf = (slot) => armory.reduce((n, it) => n + (it.slot === slot && it.material === topMat ? 1 : 0), 0);
      // the smiths at work
      k.forgeT = (k.forgeT || 0) + dt * forges;
      while (gearOK && k.forgeT >= 7) {
        k.forgeT -= 7;
        // the best-stocked smithy takes the order, so no one town is stripped bare
        let smithy = null,
          ss = -1;
        for (const o of vs) {
          if (!(o.hasForge || o.hasWorkshop) || o.wood < 2) continue;
          const sc = (o.ore || 0) * 3 + o.stone + (o.hasForge ? 10 : 0);
          if (sc > ss) (ss = sc), (smithy = o);
        }
        if (!smithy) break;
        if (armory.length >= 90) {
          // melt down the poorest common piece to make room
          let wi = -1,
            wp = Infinity;
          for (let i = 0; i < armory.length; i++) if (!armory[i].legendary && (armory[i].power || 0) < wp) (wp = armory[i].power || 0), (wi = i);
          if (wi < 0) break;
          armory.splice(wi, 1);
        }
        let slot;
        const w = needW - stockOf('weapon'),
          a = needA - stockOf('armor'),
          t = Math.min(needT, 12) - stockOf('tool');
        const metalOK = (smithy.ore || 0) >= 2 && topMat !== 'wood' && topMat !== 'stone';
        if (w > 0 && w >= a) slot = 'weapon';
        else if (a > 0) slot = 'armor';
        else if (t > 0) slot = 'tool';
        else if (metalOK && Math.min(upW, 10) - freshOf('weapon') > 0) slot = 'weapon';
        else if (metalOK && Math.min(upA, 10) - freshOf('armor') > 0) slot = 'armor';
        else if (smithy.gold >= 10 && smithy.buildings.some((b) => b.alive && b.type === 'market') && (k.era || 0) >= 1 && Math.min(needTr, 3 + vs.length) - stockOf('trinket') > 0) slot = 'trinket';
        else if (stockOf('weapon') < 3) slot = 'weapon';
        else if (stockOf('armor') < 3) slot = 'armor';
        else break;
        // ore for metal, stone for the humble early kit
        let mat = slot === 'trinket' ? (k.era >= 3 ? 'steel' : 'bronze') : this.bestMaterial(k.id);
        const metal = mat === 'bronze' || mat === 'iron' || mat === 'steel';
        // stone for kit only from a town with stone to spare (more so while the
        // realm saves for a wonder); otherwise humble wooden gear
        const reserve = (k.era || 0) >= 3 && !k.wonder ? 70 : 30;
        if (metal && slot !== 'trinket') {
          if ((smithy.ore || 0) >= 2) smithy.ore -= 2;
          else if (smithy.stone >= reserve + 3) {
            smithy.stone -= 3;
            mat = 'stone';
          } else if (slot === 'tool' || needW + needA > 0) mat = 'wood';
          else break;
        } else if (slot === 'trinket') smithy.gold -= 10;
        else if (smithy.stone >= reserve + 3) smithy.stone -= 3;
        else mat = 'wood';
        smithy.wood -= 2;
        const quality = this.rng.chance(0.06 + (k.era || 0) * 0.04) ? 'fine' : this.rng.chance(0.02 * (k.era || 0)) ? 'masterwork' : 'common';
        const kindOf = { weapon: k.culture === 'frost' ? 'axe' : k.culture === 'mire' ? 'spear' : 'sword', armor: (k.era || 0) >= 2 ? 'plate' : 'mail', tool: 'hammer', trinket: this.rng.chance(0.5) ? 'amulet' : 'ring' };
        const item = real ? U.makeItem({ slot, kind: kindOf[slot], material: mat, quality, origin: smithy.name }) : { id: 'ci' + this._nextBid++, slot, kind: kindOf[slot], material: mat, quality, power: { weapon: 6, armor: 5, tool: 4, trinket: 2 }[slot] * ({ wood: 0.6, stone: 0.8, bronze: 1, iron: 1.3, steel: 1.6 }[mat] || 1), name: `${mat} ${kindOf[slot]}` };
        armory.push(item);
        // the smith learns the craft
        const smith = [...smithy.members].find((u) => u.alive && (u.job === 'builder' || u.job === 'miner') && u.age >= ADULT_AGE);
        if (smith) U.addXP?.(smith, 1.5);
      }
      // issue gear: soldiers first (weapon, armour), then workers' tools, the ruler a trinket
      if (armory.length && gearOK) {
        const bestPow = { weapon: 0, armor: 0, tool: 0, trinket: 0 };
        for (const it of armory) if ((it.power || 0) > (bestPow[it.slot] ?? 0)) bestPow[it.slot] = it.power || 0;
        for (const v of vs) {
          for (const u of v.members) {
            if (!u.alive || u.age < ADULT_AGE || !armory.length) continue;
            const e = this._gearOf(u);
            const wants = u.job === 'soldier' ? ['weapon', 'armor'] : u.job === 'king' ? ['trinket', 'weapon'] : u.job && u.job !== 'child' ? ['tool'] : [];
            if (u.job !== 'king' && this._trinketWorthy(u)) wants.push('trinket');
            for (const slot of wants) {
              const cur = e[slot];
              if (cur && (cur.legendary || bestPow[slot] <= (cur.power || 0) * 1.2)) continue;
              let bi = -1,
                bp = cur ? (cur.power || 0) * 1.2 : -1;
              for (let i = 0; i < armory.length; i++) if (armory[i].slot === slot && (armory[i].power || 0) > bp) (bp = armory[i].power || 0), (bi = i);
              if (bi < 0) continue;
              const it = armory.splice(bi, 1)[0];
              if (slot === 'tool') it.kind = { farmer: 'sickle', woodcutter: 'axe', miner: 'pick', builder: 'hammer', fisher: 'hammer' }[u.job] || it.kind;
              this._giveItem(u, it);
              bestPow[slot] = 0;
              for (const o of armory) if (o.slot === slot && (o.power || 0) > bestPow[slot]) bestPow[slot] = o.power || 0;
            }
          }
        }
      }
      Object.assign(inv, {
        food: Math.floor(food),
        wood: Math.floor(wood),
        stone: Math.floor(stone),
        ore: Math.floor(ore),
        gold: Math.floor(gold),
        weapons: stockOf('weapon'),
        armor: stockOf('armor'),
        tools: stockOf('tool'),
        trinkets: stockOf('trinket'),
        armedSoldiers: soldiers - needW,
        soldiers,
      });
    }
  }

  // Rings and amulets are for the court: the ruler, the heir, the great
  // veterans and the heroes of the songs.
  _trinketWorthy(u) {
    if (u.job === 'king' || u.data?.civ?.royal) return true;
    const k = this.kingdoms[u.kingdom];
    if (k && k.heir === u.id) return true;
    if ((u.level || 1) >= 8) return true;
    return !!this.game.units.hasTrait?.(u, 'hero');
  }

  _gearOf(u) {
    if (u.equipment) return u.equipment;
    return u.data.civ?.gear || (u.data.civ.gear = {});
  }

  // Put an item on a unit. With Life's item system the item itself carries the
  // power (combat reads equipment); otherwise apply our own simple bonus.
  _giveItem(u, it) {
    const U = this.game.units;
    if (typeof U.equip === 'function') {
      const old = U.equip(u, it);
      if (old) this.depositItem(u.village, old, u);
      // clear any fallback bonus so gear is never counted twice
      if (u.data.civ?.power) u.data.civ.power = null;
      if (u.legendary || it.legendary) this._bio(u, `Was given ${it.name}`);
      return;
    }
    const gear = u.data.civ.gear || (u.data.civ.gear = {});
    gear[it.slot] = it;
    const tier = { wood: 0, stone: 0.1, bronze: 0.25, iron: 0.5, steel: 0.8 }[it.material] || 0;
    if (it.slot === 'weapon') u.data.civ.power = 6.5 * (1 + tier);
    else if (it.slot === 'armor') {
      u.maxHp = Math.round(64 * (1 + tier * 0.6));
      u.hp = Math.min(u.maxHp, u.hp + 10);
    }
  }

  // Life calls this when a unit dies with gear: it goes to the village's
  // kingdom armoury as a real item and is issued again later.
  depositItem(villageId, item, unit = null) {
    if (!item) return false;
    const v = this.villages[villageId];
    const k = v && v.alive ? this.kingdoms[v.kingdom] : unit ? this.kingdoms[unit.kingdom] : null;
    if (!k || !k.alive) return false;
    const armory = k.armory || (k.armory = []);
    if (item.legendary && !item.history) item.history = `recovered at ${v ? v.name : 'the field'}`;
    if (item.legendary) {
      // a realm keeps a few legends in its armoury; the rest are enshrined as
      // relics and leave circulation (named once in the chronicle, never again)
      let legends = 0;
      for (const it of armory) if (it.legendary) legends++;
      if (legends >= 3) {
        const relics = k.relics || (k.relics = []);
        if (!relics.includes(item.name)) relics.push(item.name);
        if (relics.length > 12) relics.shift();
        if (!item.chronicled) {
          item.chronicled = true;
          this._history(`${item.name} is enshrined as a relic of ${this._kn(k)}`, 'info', v ? { x: v.cx, z: v.cz } : null);
        }
        return true;
      }
    }
    armory.push(item);
    if (armory.length > 90) {
      // the realm keeps its best and its legends
      armory.sort((a, b) => (b.legendary ? 99 : b.power || 0) - (a.legendary ? 99 : a.power || 0));
      armory.length = 90;
    }
    if (item.legendary && !item.chronicled) {
      item.chronicled = true;
      this._history(`${item.name} is laid in the armoury of ${this._kn(k)}`, 'info', v ? { x: v.cx, z: v.cz } : null);
    }
    return true;
  }

  // Biography lines without repeats: an identical recent line gains a count.
  _bio(u, text) {
    if (!u || !text) return;
    const bio = u.bio;
    if (bio && bio.length) {
      for (let i = bio.length - 1; i >= Math.max(0, bio.length - 8); i--) {
        const m = bio[i].text.match(/^(.*?)(?: \(×(\d+)\))?$/);
        if (m && m[1] === text) {
          bio[i].text = `${text} (×${(+m[2] || 1) + 1})`;
          bio[i].t = this.game.time.total;
          return;
        }
      }
    }
    this.game.units.log?.(u, text);
  }

  // Wanderers: small bands arrive on empty fertile land and found a village.
  _wanderers() {
    if (!this.law('spawnWanderers', false)) return;
    if (this._crowd() > 0.8 || !this.rng.chance(0.25)) return;
    const w = this.world;
    for (let k = 0; k < 40; k++) {
      const tx = this.rng.int(16, w.w - 17),
        ty = this.rng.int(16, w.h - 17);
      if (w.owner[ty * w.w + tx] >= 0) continue;
      if (this.villages.some((v) => v.alive && Math.hypot(v.cx - tx, v.cz - ty) < 30)) continue;
      if (this._scoreSite(tx, ty, { minSpace: 110 }) < 0) continue;
      const cultureId = this._cultureAt(tx, ty);
      const v = this.foundVillage(tx, ty, { culture: cultureId, settlers: this.rng.int(6, 9), silent: true, kingdom: null, wanderers: true });
      if (v) this._note(`🧭 Wanderers settle the empty land at ${v.name}`, 'good', { x: v.cx, z: v.cz });
      return;
    }
  }

  // Grain carts: surplus villages feed hungry kin of the same kingdom.
  _cartFood() {
    for (const k of this.kingdoms) {
      if (!k.alive || k.villages.length < 2) continue;
      const vs = k.villages.map((id) => this.villages[id]).filter((v) => v && v.alive);
      const needy = vs.filter((v) => v.food < v.pop * 2.5 + 6).sort((a, b) => a.food - b.food);
      if (!needy.length) continue;
      const rich = vs.filter((v) => v.food > v.pop * 5 + 30).sort((a, b) => b.food - a.food);
      for (const to of needy) {
        const from = rich.find((r) => r.landId === to.landId && Math.hypot(r.cx - to.cx, r.cz - to.cz) < 90);
        if (!from) continue;
        const amt = Math.min(from.food - (from.pop * 5 + 20), to.pop * 4 + 20);
        if (amt <= 4) continue;
        from.food -= amt;
        to.food += amt * 0.9; // a tenth is eaten on the road
        to.emptyT = 0;
      }
    }
  }

  // Population ceiling of a settlement: its tier, lifted by a fertile age.
  // Age modifiers as felt by the peoples: they drift toward the age's values
  // over several years, so a new age never snaps the caps shut overnight.
  _easedMods() {
    const m = this.game.age?.mods || {};
    const t = this.game.time.total;
    const e = this._ease || (this._ease = { birth: m.birth ?? 1, fertility: m.fertility ?? 1, t });
    const dt = Math.max(0, t - e.t);
    e.t = t;
    const k = Math.min(1, dt / (YEAR * 6));
    e.birth += ((m.birth ?? 1) - e.birth) * k;
    e.fertility += ((m.fertility ?? 1) - e.fertility) * k;
    return e;
  }
  _popCap(v) {
    const m = this._easedMods();
    return Math.round(TIER_POP[v.tier || 0] * Math.max(1, Math.min(1.35, m.birth * 0.6 + m.fertility * 0.4)));
  }
  _humanCap() {
    const b = this._easedMods().birth;
    return Math.round(this.budget.humans * Math.max(0.9, Math.min(1.25, b)));
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
        if (!k.villages.length) this._killKingdom(k, why === 'razed' ? 'razed' : 'abandoned');
        else if (k.capital === v.id) this._chooseCapital(k);
      }
    }
    if (why !== 'silent' && v.pop0 !== 0) this._note(`${v.name} has been ${why === 'razed' ? 'razed and abandoned' : 'abandoned'}.`, why === 'razed' ? 'war' : 'bad', { x: v.cx, z: v.cz });
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
    const want = { farmer: 0, builder: 0, woodcutter: 0, fisher: 0, soldier: 0, miner: 0, healer: 0, messenger: 0 };
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
    const ctr = (t) => this.hasCultureTrait(v.culture, t);
    // the realm's messenger keeps riding; a healer's house keeps its healer
    give('messenger', members.filter((u) => u.job === 'messenger').length);
    if (n >= 8 && v.buildings.some((b) => b.alive && b.type === 'healer' && !b.constructing)) give('healer', 1);
    give('farmer', v.fieldCount ? Math.max(1, Math.min(Math.ceil(v.fieldCount / (foodFull ? 14 : ctr('Pastoral') ? 7 : 9)), n * 0.5)) : 0);
    give('fisher', v.docks ? Math.min(v.docks * (ctr('Seafaring') ? 3 : 2), 1 + n * (ctr('Seafaring') ? 0.25 : 0.15)) : foodLow && n >= 5 && v.coastal ? 1 : 0);
    const drafting = this.game.time.total - (v.draft ?? -99) < 45;
    // a people's ways show in its trades: martial folk keep many under arms
    const lean = ctr('Martial') ? 2.1 : ctr('Pastoral') || ctr('Scholarly') ? 0.6 : 1;
    if (atWar) give('soldier', Math.max(3, n * Math.min(0.55, (drafting ? 0.32 : 0.2) * lean)) + (v.hasBarracks ? 3 : 0));
    give('builder', sites ? Math.min(Math.max(1, Math.ceil(sites * 1.1)), 1 + Math.floor(n / 6)) : repairs ? 1 : 0);
    // an empty woodshed stops all building: send more hands to the woods
    const woodsCap = (v.trees ?? 99) < 15 ? 1 : (v.trees ?? 99) < 35 ? 2 : (v.trees ?? 99) < 60 ? 3 : 9;
    give('woodcutter', Math.min(woodsCap, woodFull ? (n >= 6 ? 1 : 0) : v.wood < 15 ? 1 + Math.floor(n / 7) : v.wood < 40 + v.tier * 30 ? 1 + Math.floor(n / 9) : n >= 4 ? 1 + Math.floor(n / 16) : 0));
    if (!atWar && n >= 5) give('soldier', Math.max(1, n * 0.11 * lean) + (v.hasBarracks ? 2 : 0) + (ctr('Martial') && v.tier >= 1 ? 2 : 0));
    if (v.hasRock !== false || v.quarry >= 0) give('miner', stoneFull ? 0 : v.stone < 12 ? 2 + Math.floor(n / 7) : v.stone < 30 + v.tier * 50 ? 1 + Math.floor(n / (ctr('Masons') ? 6 : 9)) : ctr('Masons') ? 2 : 1);
    // the rest go where they are most useful; anyone left over keeps the town lively
    let guard = 0;
    while (left > 0 && guard++ < 200) {
      if (v.fieldCount > want.farmer * 7 && !foodFull) give('farmer', 1);
      else if (sites > want.builder * 1.5) give('builder', 1);
      else if (!stoneFull && (v.hasRock !== false || v.quarry >= 0) && want.miner < 2 + n / 8) give('miner', 1);
      else if (!woodFull && want.woodcutter < 2 + n / 6) give('woodcutter', 1);
      else if (v.docks && want.fisher < v.docks * 3 && !foodFull) give('fisher', 1);
      else if (v.fieldCount > want.farmer * 4) give('farmer', 1);
      else if (want.builder < 2 + n / 10) give('builder', 1);
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
    const frozen = v.policy?.buildings === false; // the gods forbid new building here
    if (frozen && v.frozenHousing == null) v.frozenHousing = v.housing;
    if (!frozen) v.frozenHousing = null;
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
      if (frozen && !(type === 'house' && v.housing < (v.frozenHousing ?? 0)) && !(type === 'granary' && count('granary') === 0)) return false;
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
      if (!b || b.upgrading || b.constructing || frozen) return false;
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
    const crowded = this._crowd();
    // 1 housing (bounded: big towns upgrade instead of sprawling)
    if (room() && v.housing - pop < 2 + v.tier && v.housing < this._popCap(v) + 6) {
      // a crowded world builds up, not out: cottages become timber houses
      const full = crowded >= 0.6;
      const cand = v.tier >= 1 || full ? v.buildings.find((b) => b.alive && b.type === 'house' && !b.constructing && !b.upgrading && b.level < Math.min(3, v.tier + 2)) : null;
      if (!(cand && (full || this.rng.chance(0.5)) && upgrade(cand)) && (crowded < 0.97 || v.tier >= 1 || v.housing < 16)) build('house');
    }
    // 2 fields (no cost)
    const targetFields = 8 + pop * 1.1;
    if (v.fieldCount < targetFields && v.plots.filter((p) => p.tiles.some((i) => this.world.type[i] !== TILE.FARMLAND)).length < 2) this._planPlot(v);
    // 3 civic buildings by size
    if (room() && pop >= 10 && count('granary') === 0) build('granary');
    if (room() && pop >= 12 && count('well') < 1 + Math.floor(pop / 35)) build('well', () => this.placeAlongRoad(v, 'well', this._bias(v, 'well')));
    if (room() && pop >= (this.hasCultureTrait(v.culture, 'Seafaring') ? 6 : 8) && v.coastal && count('docks') < (pop >= 30 ? 2 : 1)) build('docks', () => this._placeDocks(v));
    if (room() && pop >= 14 && count('workshop') === 0) build('workshop');
    if (room() && pop >= 14 && v.fieldCount >= 20 && count('windmill') === 0) build('windmill');
    if (room() && v.hall.level < v.tier + 1) upgrade(v.hall);
    if (room() && v.tier >= 1 && count('market') === 0) build('market');
    const kid = v.kingdom;
    const ct = (t) => this.hasCultureTrait(v.culture, t);
    if (room() && pop >= (ct('Mystic') ? 14 : 26) && count('temple') === 0) build('temple');
    if (room() && pop >= (ct('Scholarly') ? 12 : 20) && this.hasTech(kid, 'writing') && count('library') === 0) build('library');
    if (room() && pop >= 30 && this.hasTech(kid, 'astronomy') && count('observatory') === 0) build('observatory', () => this._placeOutskirts(v, 'observatory', 4, v.buildRadius, null, null));
    if (room() && pop >= 34 && this.hasTech(kid, 'architecture') && count('aqueduct') === 0) build('aqueduct', () => this._placeOutskirts(v, 'aqueduct', 5, v.buildRadius + 3, null, null));
    const K = this.kingdoms[kid];
    this._planUnlocks(v, K, room, build, upgrade, count, crowded);
    // monuments: the realm's great works rise stage by stage; masters raise more
    if (K && sites <= maxSites) {
      const mine = v.buildings.find((b) => b.alive && BUILDING_TYPES[b.type].monument);
      if (mine) {
        // stalled works: after a dozen idle years the realm sends masons and
        // stone (a work well begun), or gives the footings up
        const prog = mine.constructing ? mine.progress : mine.upgrading ? mine.upgradeProgress || 0 : -1;
        if (prog >= 0) {
          if (mine.lastProg == null || prog > mine.lastProg + 0.004) {
            mine.lastProg = prog;
            mine.progT = now;
          } else if (now - (mine.progT ?? now) > YEAR * 12) {
            mine.progT = now;
            if (mine.constructing && mine.progress < 0.3) {
              this._note(`🏚 The works on the ${buildingLabel({ ...mine, level: 3 })} at ${v.name} are given up`, 'info', { x: mine.x, z: mine.z }, 'monquit' + mine.id, 1);
              v.stone += 40;
              v.wood += 20;
              this.destroyBuilding(mine, 'cancelled');
            } else {
              if (mine.constructing) mine.progress = Math.min(0.99, mine.progress + 0.2);
              else mine.upgradeProgress = Math.min(0.99, (mine.upgradeProgress || 0) + 0.25);
              mine.lastProg = null;
              this._note(`🏗 Masons from across ${this._kn(K)} take up the stalled works at ${v.name}`, 'info', { x: mine.x, z: mine.z }, 'monfund' + mine.id, 30);
            }
          }
        }
        if (mine.alive && !mine.constructing && !mine.upgrading && mine.level < 3 && this._poolForWonder(K, v, costOf(mine.type, mine.level + 1, v.culture))) upgrade(mine);
      } else if ((K.era || 0) >= 3 && (this.hasTech(kid, 'engineering') || (K.mastery || 0) >= 2) && (K.capital === v.id || v.tier >= 1)) {
        let have = 0,
          world = 0,
          capHas = false;
        for (const b of this.buildings)
          if (b.alive && BUILDING_TYPES[b.type].monument) {
            world++;
            if (b.kingdom === kid) {
              have++;
              if (b.village === K.capital) capHas = true;
            }
          }
        const slots = Math.min(3, 1 + Math.floor((K.mastery || 0) / 3));
        const type = have % 2 === 0 ? 'wonder' : 'colossus';
        // great works stand apart: none within a long walk of another
        let crowdedWorks = false;
        for (const b of this.buildings) if (b.alive && BUILDING_TYPES[b.type].monument && Math.hypot(b.x - v.cx, b.z - v.cz) < 30) crowdedWorks = true;
        if (!crowdedWorks && have < slots && world < 14 && (K.capital === v.id || capHas) && this._poolForWonder(K, v, costOf(type, 1, v.culture))) {
          const def = BUILDING_TYPES[type];
          const place = () => this._placeOutskirts(v, type, 4, v.buildRadius, null, null) || this._placeOutskirts(v, type, v.buildRadius, v.buildRadius + 10, null, null);
          if (build(type, place)) {
            K.wonder = true;
            const b = v.buildings[v.buildings.length - 1];
            if (b && b.type === type) {
              // a realm's own design: variant and name drawn from its line
              b.variant = (K.id * 5 + have * 3 + this.rng.int(0, 2)) % 3;
              b.title = monumentTitle(type, b.style, b.variant);
            }
            this._note(`🏛 ${v.name} lays the footings of a great work: the ${buildingLabel({ type, style: b?.style || v.culture, level: 3 })} of ${this._kn(K)}`, 'good', { x: v.cx, z: v.cz }, 'wonder' + kid + '-' + have, 1);
            void def;
          }
        }
      }
    }
    // mastery tiers each bring something to see: statues (2), gilded halls (4),
    // academies (6), busy harbours (8), lamp-lit grand roads (10)
    if (room() && K && (K.mastery || 0) >= 6 && (K.capital === v.id || v.tier >= 2) && count('academy') === 0 && v.stone > 70) build('academy', () => this._placeOutskirts(v, 'academy', 3, v.buildRadius, null, null));
    // mastery shows in the streets: statues in the capital and the great cities
    if (room() && K && (K.mastery || 0) >= 2 && (K.capital === v.id || v.tier >= 2)) {
      const want = K.capital === v.id ? Math.min(4, Math.floor(K.mastery / 2)) : Math.min(2, Math.floor(K.mastery / 4));
      if (count('statue') < want && v.stone > 40 && build('statue', () => this.placeAlongRoad(v, 'statue', this._bias(v, 'well')))) {
        const s = v.buildings[v.buildings.length - 1];
        if (s?.type === 'statue') s.variant = this.rng.int(0, 2);
      }
    }
    if (room() && this.hasTech(kid, 'sailing')) {
      const dk = v.buildings.find((b) => b.alive && b.type === 'docks' && b.level < 2 && !b.constructing);
      if (dk) upgrade(dk);
    }
    const atWar = this.warCount(v.kingdom) > 0;
    if (room() && count('barracks') === 0 && (v.tier >= 1 || (atWar && pop >= 16))) build('barracks');
    if (room() && this.law('civWalls') && v.tier >= 1 && count('watchtower') < v.tier + (atWar ? 1 : 0)) {
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
    // only royal capitals raise curtain walls (each section is a building)
    const wallPol = v.policy?.walls;
    const canWall = wallPol === false ? false : wallPol === true ? true : this.law('civWalls') && (this.hasTech(v.kingdom, 'fortification') || (this.kingdoms[v.kingdom]?.era ?? 0) >= 2 || this.law('civTechnology') === false);
    const isCap = this.kingdoms[v.kingdom]?.capital === v.id;
    if (canWall && !v.wallsPlanned && v.stone >= 50 && (wallPol === true || (isCap && v.tier >= 1) || (v.tier >= 2 && (this.hasCultureTrait(v.culture, 'Masons') || crowded < 0.7)))) {
      // walls draw on a world budget: a ring per city, never a maze of them
      let walls = 0;
      for (const b of this.buildings) if (b.alive && BUILDING_TYPES[b.type].wall) walls++;
      const room = Math.round(this.budget.buildings * 0.8) - walls;
      const cap = Math.min(room, isCap ? 110 : 80);
      if (cap >= 28) this._planWalls(v, cap);
      else v.wallsPlanned = true; // no room: the town relies on its towers
    }
    if (v.wallsPlanned && v.wallPlan?.length && !frozen && wallPol !== false && (wallPol ?? this.law('civWalls'))) this._advanceWalls(v, 3);
    if (room() && v.tier >= 1) {
      const cand = v.buildings.find((b) => b.alive && b.type === 'house' && !b.constructing && !b.upgrading && b.level < Math.min(3, v.tier + 1));
      if (cand && v.wood > 40) upgrade(cand);
    }
    if (room() && v.wood > (pop < 12 ? 14 : 45) && v.housing < pop + 6 && v.housing < this._popCap(v) && (crowded < 0.6 || v.housing < 16)) build('house');
    // keep a few streets in hand for growth
    if (actions === 0 && this.rng.chance(0.25)) this._extendRoads(v);
    this._tryExpand(v);
  }

  // A wonder is the whole realm's work: its provinces send stone, timber and
  // coin to the capital until the first course can be laid.
  _poolForWonder(K, v, cost = costOf('wonder', 1, v.culture)) {
    let ok = true;
    for (const r in cost) {
      let have = 0;
      for (const vid of K.villages) have += this.villages[vid]?.alive ? this.villages[vid][r] || 0 : 0;
      if (have < cost[r] * 1.15) ok = false;
    }
    if (!ok) return false;
    for (const r in cost) {
      let need = cost[r] - (v[r] || 0);
      for (const vid of K.villages) {
        if (need <= 0) break;
        const o = this.villages[vid];
        if (!o?.alive || o === v) continue;
        const take = Math.min(need, (o[r] || 0) * 0.6);
        o[r] -= take;
        v[r] = (v[r] || 0) + take;
        need -= take;
      }
      if (need > 0) return false;
    }
    return true;
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

  // Great works never stall for ever: every 2 s the realm checks its building
  // sites; one idle for ten years is finished by masons sent from across the
  // realm (the stage completes), or, if barely begun, given up and refunded.
  _worksTick() {
    const now = this.game.time.total;
    for (const b of this.buildings) {
      if (!b.alive || !BUILDING_TYPES[b.type]?.monument) continue;
      const prog = b.constructing ? b.progress : b.upgrading ? b.upgradeProgress || 0 : -1;
      if (prog < 0) {
        b.lastProg = null;
        continue;
      }
      if (b.lastProg == null || prog > b.lastProg + 0.004) {
        b.lastProg = prog;
        b.progT = now;
        continue;
      }
      if (now - (b.progT ?? now) < YEAR * 10) continue;
      const v = this.villages[b.village];
      const K = this.kingdoms[b.kingdom];
      b.lastProg = null;
      b.progT = now;
      if (b.constructing && b.progress < 0.2) {
        if (v) {
          this._note(`🏚 The works on the ${buildingLabel({ ...b, level: 3 })} at ${v.name} are given up`, 'info', { x: b.x, z: b.z }, 'monquit' + b.id, 1);
          v.stone += 40;
          v.wood += 20;
        }
        this.destroyBuilding(b, 'cancelled');
        continue;
      }
      if (v && K) this._note(`🏗 Masons from across ${this._kn(K)} finish the stalled works at ${v.name}`, 'info', { x: b.x, z: b.z }, 'monfund' + b.id, 30);
      if (b.constructing) this._finishBuilding(b);
      else this._finishUpgrade(b);
    }
  }

  _finishBuilding(b) {
    b.era = Math.max(b.era ?? 0, this.kingdoms[b.kingdom]?.era ?? 0);
    b.builtEra = this.kingdoms[b.kingdom]?.era ?? 0;
    b.constructing = false;
    b.progress = 1;
    b.hp = b.maxHp;
    this.version++;
    const v = this.villages[b.village];
    if (v) this._updateVillageDerived(v);
    if (BUILDING_TYPES[b.type].monument && v) this._monumentStage(b, v);
    this._firstBuild?.(b);
    if (b.type === 'temple' && v) this._note(`${v.name} completes its ${buildingLabel(b).toLowerCase()}.`, 'info', { x: b.x, z: b.z }, 'temple' + v.id, 600);
    this._fx('sparkle', b.x, b.z, 0.8);
  }

  _finishUpgrade(b) {
    const def = BUILDING_TYPES[b.type];
    b.upgrading = false;
    b.upgradeProgress = 0;
    b.level = Math.min(def.levels, b.level + 1);
    b.era = Math.max(b.era ?? 0, this.kingdoms[b.kingdom]?.era ?? 0);
    b.maxHp = def.hp[b.level - 1] ?? b.maxHp;
    b.hp = b.maxHp;
    this.version++;
    const v = this.villages[b.village];
    if (v) this._updateVillageDerived(v);
    this._sfx('bell', b.x, b.z, 1.5);
    if (b.type === 'hall' && v) this._note(`${v.name} raises a ${buildingLabel(b).toLowerCase()}.`, 'good', { x: b.x, z: b.z });
    if (def.monument && v) this._monumentStage(b, v);
    this._firstBuild?.(b);
    this._fx('sparkle', b.x, b.z, 1);
  }

  // A stage of a monument is finished: the chronicle marks it, and the last
  // stage brings the realm its gift.
  _monumentStage(b, v) {
    const K = this.kingdoms[b.kingdom];
    const name = buildingLabel({ ...b, level: 3 });
    if (b.level >= 3) {
      const fx = MONUMENT_FX[b.type === 'colossus' ? 'colossus' : b.style] || MONUMENT_FX.vale;
      this._note(`🏛 The ${name} of ${v.name} stands complete, glory of the ${K?.name || 'realm'}: ${fx.text}`, 'good', { x: b.x, z: b.z }, 'wonderdone' + b.id, 1);
      this._fx('magic', b.x, b.z, 2);
      this._sfx('bell', b.x, b.z, 0, true);
    } else this._note(`🏗 The ${name} of ${v.name} rises: stage ${b.level} of 3 stands`, 'info', { x: b.x, z: b.z }, 'monlvl' + b.id + b.level, 1);
    this._wonderFx();
  }

  // Each realm's gifts from its finished monuments (partial stages give part).
  _wonderFx() {
    for (const k of this.kingdoms) if (k.wonderFx) k.wonderFx = null;
    for (const b of this.buildings) {
      if (!b.alive || !(BUILDING_TYPES[b.type]?.monument || (b.type === 'academy' && !b.constructing))) continue;
      const k = this.kingdoms[b.kingdom];
      if (!k?.alive) continue;
      const done = (b.constructing ? 0 : b.upgrading ? b.level - 1 : b.level) / 3;
      if (done <= 0) continue;
      const fx = MONUMENT_FX[b.type === 'colossus' ? 'colossus' : b.style] || MONUMENT_FX.vale;
      const out = k.wonderFx || (k.wonderFx = {});
      if (b.type === 'academy') {
        out.research = (out.research || 1) * 1.08;
        continue;
      }
      for (const [key, val] of Object.entries(fx.mods)) {
        if (key.endsWith('+')) out[key] = (out[key] || 0) + val * done;
        else out[key] = (out[key] || 1) * (1 + (val - 1) * done);
      }
    }
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
    if ((cause === 'siege' || cause === 'killed') && b.hp < b.maxHp * 0.45 && !BUILDING_TYPES[b.type].wall) b.burning = Math.max(b.burning, 0.35 + (1 - b.hp / b.maxHp) * 0.5);
    if (b.hp <= 0) this.destroyBuilding(b, cause);
  }

  destroyBuilding(b, cause = 'destroyed') {
    if (!b.alive) return;
    const w = this.world;
    b.alive = false;
    b.ruin = true;
    b.ruinT = this.game.time.total;
    if (!this.law('miscRuins')) b.ruinT -= YEAR * 10; // no lasting ruins: cleared on the next sweep
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
    if (BUILDING_TYPES[b.type]?.monument && cause === 'cancelled') {
      b.ruinT -= YEAR * 10; // only footings: cleared on the next sweep
      this._wonderFx();
    } else if (BUILDING_TYPES[b.type]?.monument) {
      // a fallen monument may be raised again
      if (v) this._note(`🏚 The ${buildingLabel({ ...b, level: 3 })} of ${v.name} has fallen`, 'bad', { x: b.x, z: b.z }, 'wonderfell' + b.id, 1);
      this._wonderFx();
    }
    if (v) {
      v.buildings = v.buildings.filter((o) => o !== b);
      if (v.hall === b) v.hall = null;
      this._updateVillageDerived(v);
    }
    this._fx('debris', b.x, b.z, 1.2, true);
    this._fx('dust', b.x, b.z, 1.6, true);
    this._fx('smoke', b.x, b.z, 1.2, true);
    if (b.type === 'hall' && v && v.alive && !b.abandoned) this._note(`The ${buildingLabel(b).toLowerCase()} of ${v.name} has been destroyed!`, b.besieged && this.game.time.total - b.besieged < 30 ? 'war' : 'bad', { x: b.x, z: b.z });
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
        if (now - b.ruinT > YEAR * 2) {
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
    this._terrDirty = true;
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

  // Territory spreads from every village across the land by travel cost:
  // slopes, ridges, forest and especially water are expensive, so rivers and
  // mountain chains become natural borders. Multi-source Dijkstra; each tile
  // goes to the source that reaches it cheapest relative to its strength.
  // Territory changes only when settlements grow, shrink, change hands or the
  // land itself is reshaped; otherwise skip the map-wide flood fill (a refresh
  // still runs every 30 s for the slow incumbency drift).
  _territoryIfChanged() {
    let sig = this.villages.length * 7919;
    for (const v of this.villages) if (v.alive) sig = (Math.imul(sig, 31) + v.id * 131 + v.kingdom * 977 + Math.round(v.radius) * 17 + v.tier * 5) | 0;
    for (const b of this.buildings) if (b.alive && !b.constructing && (b.type === 'watchtower' || b.type === 'tower')) sig = (Math.imul(sig, 31) + b.id) | 0;
    const now = this.game.time.total;
    if (sig === this._terrSig && !this._terrDirty && now - (this._terrT ?? -1e9) < 30) return;
    this._terrSig = sig;
    this._terrDirty = false;
    this._terrT = now;
    this._territory();
  }

  _territory() {
    const w = this.world;
    const W = w.w;
    const best = this._terrBest; // normalised cost (cost / strength)
    const own = this._terrOwner;
    best.fill(1e9);
    own.fill(-1);
    if (!this._tq || this._tq.length < w.size * 2) {
      this._tq = new Int32Array(w.size * 2);
      this._tqf = new Float32Array(w.size * 2);
      this._tlim = new Float32Array(w.size);
    }
    const qi = this._tq,
      qf = this._tqf,
      lim = this._tlim;
    let n = 0;
    const push = (i, f) => {
      if (n >= qi.length) return;
      let c = n++;
      while (c > 0) {
        const pp = (c - 1) >> 1;
        if (qf[pp] <= f) break;
        qi[c] = qi[pp];
        qf[c] = qf[pp];
        c = pp;
      }
      qi[c] = i;
      qf[c] = f;
    };
    const pop = () => {
      const top = qi[0];
      const li = qi[--n],
        lf = qf[n];
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        if (l >= n) break;
        let m = l;
        if (l + 1 < n && qf[l + 1] < qf[l]) m = l + 1;
        if (qf[m] >= lf) break;
        qi[c] = qi[m];
        qf[c] = qf[m];
        c = m;
      }
      qi[c] = li;
      qf[c] = lf;
      return top;
    };
    const kOf = new Int16Array(0);
    void kOf;
    // per-source strength lives in a parallel array keyed by queue entry via `str`
    const str = this._tstr || (this._tstr = new Float32Array(w.size));
    const seed = (cx, cz, R, kid, strength) => {
      const tx = Math.floor(cx),
        ty = Math.floor(cz);
      if (!w.inBounds(tx, ty)) return;
      const i = ty * W + tx;
      if (best[i] <= 0) return;
      best[i] = 0;
      own[i] = kid;
      str[i] = strength;
      lim[i] = R;
      push(i, 0);
    };
    for (const v of this.villages) {
      if (!v.alive) continue;
      const k = this.kingdoms[v.kingdom];
      if (!k || !k.alive) continue;
      const strength = 1 + v.tier * 0.25 + (k.capital === v.id ? 0.15 : 0);
      seed(v.cx, v.cz, v.radius * 1.05 + v.tier * 4, v.kingdom, strength); // towns and cities hold the countryside around them
      for (const b of v.buildings) if (b.alive && !b.constructing && (b.type === 'watchtower' || b.type === 'tower')) seed(b.x, b.z, b.type === 'watchtower' ? 7 : 4, v.kingdom, 0.9);
    }
    const H = w.height;
    while (n) {
      const i = pop();
      const ci = best[i];
      const kid = own[i];
      const sr = str[i],
        R = lim[i];
      const x = i % W,
        y = (i / W) | 0;
      const h0 = H[i];
      for (let d = 0; d < 8; d++) {
        const dx = d === 0 ? 1 : d === 1 ? -1 : d === 2 ? 0 : d === 3 ? 0 : d === 4 ? 1 : d === 5 ? 1 : d === 6 ? -1 : -1;
        const dy = d === 0 ? 0 : d === 1 ? 0 : d === 2 ? 1 : d === 3 ? -1 : d === 4 ? 1 : d === 5 ? -1 : d === 6 ? 1 : -1;
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= w.h) continue;
        const j = ny * W + nx;
        const hj = H[j];
        let c = dx && dy ? 1.414 : 1;
        if (hj < SEA_LEVEL) c += 7; // water: rivers and straits are borders
        else {
          const climb = hj - h0;
          c += Math.abs(climb) * 1.1 + Math.max(0, climb) * 0.8;
          const t = w.type[j];
          if (t === TILE.ROCK || t === TILE.SNOW) c += 1.2;
          else if (t === TILE.FOREST || t === TILE.JUNGLE || t === TILE.SWAMP) c += 0.25;
        }
        if (w.owner[j] === kid) c *= 0.9; // incumbency
        const nc = ci + c / sr;
        if (nc > R || nc >= best[j]) continue;
        best[j] = nc;
        own[j] = kid;
        str[j] = sr;
        lim[j] = R;
        push(j, nc);
      }
    }
    // land only
    for (let i = 0; i < w.size; i++) if (own[i] >= 0 && H[i] < SEA_LEVEL) own[i] = -1;
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
    // label anchors: the realm's own land nearest the centre of its territory
    {
      const sx = new Float64Array(this.kingdoms.length),
        sz = new Float64Array(this.kingdoms.length),
        cnt = new Float64Array(this.kingdoms.length);
      // only the land the capital stands on counts (colonies across the sea
      // would pull the centre out into the ocean)
      const capLand = this.kingdoms.map((k) => (k.alive && this.villages[k.capital] ? this.villages[k.capital].landId : -2));
      for (let i = 0; i < w.size; i++) {
        const o = own[i];
        if (o < 0 || (capLand[o] >= 0 && this.landId?.[i] !== capLand[o])) continue;
        sx[o] += i % W;
        sz[o] += (i / W) | 0;
        cnt[o]++;
      }
      const best = new Float64Array(this.kingdoms.length).fill(Infinity);
      const at = new Int32Array(this.kingdoms.length).fill(-1);
      for (let i = 0; i < w.size; i++) {
        const o = own[i];
        if (o < 0 || !cnt[o] || H[i] < SEA_LEVEL + 0.1 || (capLand[o] >= 0 && this.landId?.[i] !== capLand[o])) continue;
        const d = (i % W - sx[o] / cnt[o]) ** 2 + (((i / W) | 0) - sz[o] / cnt[o]) ** 2;
        if (d < best[o]) (best[o] = d), (at[o] = i);
      }
      for (const k of this.kingdoms) {
        if (at[k.id] >= 0) {
          k.labelX = (at[k.id] % W) + 0.5;
          k.labelZ = ((at[k.id] / W) | 0) + 0.5;
        } else k.labelX = k.labelZ = null;
      }
    }
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
  // Notifications, de-duplicated: the same key (or text) within `cooldown`
  // seconds is dropped, and the feed is limited to meaningful events.
  law(key, def = true) {
    const v = this.game.laws?.[key];
    return v == null ? def : v;
  }

  _noteCollapse(cause) {
    this.collapses = this.collapses || {};
    this.collapses[cause] = (this.collapses[cause] || 0) + 1;
  }

  // Everything notable goes to the civ chronicle; _note also posts to the feed.
  _history(text, kind = 'info', pos = null) {
    const e = { t: this.game.time.total, year: Math.floor(this.game.time.total / YEAR), text, kind, x: pos?.x, z: pos?.z };
    this.history.push(e);
    if (this.history.length > 800) this.history.splice(0, this.history.length - 800);
    this.game.events.emit('civ:history', e);
  }

  _note(text, kind = 'info', pos = null, key = null, cooldown = 45) {
    const now = this.game.time.total;
    const k = key || text;
    const last = this._noteT.get(k);
    if (last != null && now - last < cooldown) return false;
    this._noteT.set(k, now);
    if (this._noteT.size > 400) for (const [kk, t] of this._noteT) if (now - t > 600) this._noteT.delete(kk);
    this.noteCount = (this.noteCount || 0) + 1;
    this._history(text, kind, pos);
    this.game.notify(text, kind, pos);
    return true;
  }

  // Positional sound, throttled per sound name and skipped off-screen or
  // while fast-forwarding.
  _sfx(name, x, z, minGap = 0.4, force = false) {
    const g = this.game;
    if (!g.audio?.play || this._ticksSinceFrame > 45) return;
    const now = g.time.realTime ?? 0;
    const last = this._sfxT?.get(name) ?? -99;
    if (now - last < minGap) return;
    if (!force) {
      const rig = g.cameraRig;
      if (rig && Math.hypot(rig.cur.x - x, rig.cur.z - z) > rig.cur.dist * 0.9 + 10) return;
    }
    (this._sfxT || (this._sfxT = new Map())).set(name, now);
    try {
      g.audio.play(name, { pos: { x, z } });
    } catch {
      /* audio is optional */
    }
  }

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
    this._note(`A season of plenty blesses ${v.name}: granaries overflow and the fields stand ripe.`, 'good', { x: v.cx, z: v.cz });
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
        ['Style', this.cultureName(b.culture) || b.style],
      ];
      if (def.housing && b.alive) stats.push(['Houses', `${def.housing[b.level - 1]} people`]);
      if (def.levels > 1) stats.push(['Level', `${b.level} / ${def.levels}`]);
      // the building's own era (the realm's era is shown by the UI separately)
      const be = Math.min(b.builtEra ?? b.era ?? 0, k?.era ?? 3);
      stats.push(['Built in', `${ERAS[be]?.name || 'Hearth'} era${(b.era ?? 0) >= 4 ? ', since gilded' : ''}`]);
      if (b.type === 'hall' && v) {
        // wood / stone / gold / ore appear in the UI's "Village stores" section
        stats.push(['Population', v.pop], ['Food', `${Math.floor(v.food)} / ${v.foodCap}`]);
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
      subtitle: `${tier} of the ${k ? k.name : 'unclaimed lands'} · ${this.cultureName(v.culture)}`,
      stats: [
        ['Population', `${v.pop} (${v.children} children)`],
        ['Housing', v.housing],
        ['Food', `${Math.floor(v.food)} / ${v.foodCap}${v.starving ? ' (famine)' : ''}`],
        ['Buildings', v.buildings.filter((b) => b.alive).length],
        ['Fields', `${v.fieldCount} plots`],
        ['Loyalty', `${Math.round(v.loyalty)}%`],
        ['Culture', Object.entries(v.cultureMix || { [v.culture]: 1 }).sort((a, b) => b[1] - a[1]).map(([id, f]) => `${this.cultureName(id)} ${Math.round(f * 100)}%`).join(', ')],
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
      subtitle: `${this.cultureName(k.culture)} realm · banner of ${k.colorName}`,
      color: k.color,
      banner: k.banner ? { ...k.banner } : null,
      motto: k.motto || '',
      stats: [
        ...(k.motto ? [['Motto', `“${k.motto}”`]] : []),
        ['Ruler', this.rulerLabel(k)],
        ['Capital', cap ? cap.name : '—'],
        ['Villages', k.villages.length],
        ['Population', k.population],
        ['Soldiers', k.soldiers],
        ['At war with', wars.length ? wars.join(', ') : 'nobody'],
        ['Allies', allies.length ? allies.join(', ') : 'none'],
        ['Founded', `year ${Math.floor(k.founded / YEAR)}`],
        // era, research, culture, arms (treasury) and ruler traits are shown by
        // the UI in dedicated sections; mastery only once it has been earned
        ...((k.mastery || 0) > 0 ? [['Mastery', k.mastery]] : []),
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
    let walls = 0;
    for (const b of this.buildings)
      if (b.alive) {
        buildings++;
        if (BUILDING_TYPES[b.type].wall) walls++;
      }
    for (const r of this.relations.values()) {
      if (r.war) wars++;
      if (r.ally) alliances++;
    }
    let topEra = 0;
    for (const k of this.kingdoms) if (k.alive) topEra = Math.max(topEra, k.era || 0);
    return { kingdoms, villages, towns, cities, buildings, wallSections: walls, wars, alliances, armies: this.armies.length, era: ERAS[topEra].name, cultures: this.livingCultures().length };
  }
}

Object.assign(Civilization.prototype, planner, brain, politics, tech, culture, editing, unlocks);
export { ERAS, TECHS, techById, TRAIT_INFO };
