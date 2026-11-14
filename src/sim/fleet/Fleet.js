import { SEA_LEVEL, TILE } from '../../world/constants.js';
import { mulberry32 } from '../../core/Random.js';
import { WaterNav, pathLength } from './nav.js';
import { KINDS, SEA_KINDS, shipName, craftName, cargoText } from './kinds.js';
import { missions } from './missions.js';
import { land } from './land.js';
import { war } from './war.js';

const YEAR = 30; // == YEAR_SECONDS
const ROT_DIR = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

// Fleets: every vehicle in the world, on water and on land (docs/TECH-UNLOCKS.md).
// Simulation only (no three.js): src/render/fleet/FleetRenderer.js draws it.
//
// PUBLIC CONTRACT (game.fleet)
//   requestVoyage({kind, kingdom, from, to, cargo}) -> vessel | null
//       kind: 'fishing'|'cog'|'transport'|'galley'|'explorer'|'carrack'
//       from: harbour id (a docks building id; a village id also works)
//       to:   harbour id | {x, z} (a land site for settlers or armies, or a
//             point at sea). cargo: {gold, food, wood, stone, ore, settlers, army, ...}
//       A transport sent beyond its range sails as an exploration ship
//       (Astronomy) or a carrack (Navigation); refused otherwise
//       (fleet.lastRefusal says why).
//   events 'fleet:launched' {vessel, kind, kingdom}
//          'fleet:arrived'  {vessel, id, kind, kingdom, from, to, cargo, x, z, landing}
//              x, z: where the cargo is delivered (a land point for settlers
//              and armies, else the harbour). Civ applies the cargo when it
//              listens (civ._onFleetArrived); otherwise Fleets applies a
//              default (goods to the harbour town, settlers found a village).
//          'fleet:lost'     {vessel, id, kind, kingdom, cargo, cause, x, z}
//          'fleet:delivered' {vehicle, kind, kingdom, from, to, cargo}  (carts, caravans, fish)
//   vehicles() -> live vehicles (vessels and land vehicles), count(kingdom?, kind?)
//   harbours(kingdomId) -> [{id, building, village, kingdom, level, harbour, x, z, berth, water}]
//   requestCart({kingdom, from: villageId, to: villageId, cargo}) -> cart | null
//   requestCaravan({kingdom, from: villageId, to: villageId}) -> caravan | null
//   nav (WaterNav), lanes() (trade routes for the renderer), debris, stones
//   inspect(hit), stats(), tick(step), reset()
//   auto = {fishing, trade, colonize, naval, explore, carts, caravans, siege}:
//       the self-driven scheduler for each family (Civ may switch any off when
//       it takes the decision). Sea trade and colonies step aside on their own
//       when Civ makes those decisions (civ._fleetDecisions).
// Vehicle fields read by the renderer: id, kind, cls, kingdom, x, z, px, pz,
//   heading, ph, speed, state, hp, maxHp, sink (0..1), burning (0..1), anim
//   {row, wheel, arm, fill, furl, oar, walk, cargoType}, alive.
// World Laws honoured: fleetSailing, fleetNaval, fleetColonize.
export class Fleet {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.list = [];
    this.byId = new Map();
    this.debris = [];
    this.stones = [];
    this.shots = [];
    this.auto = { fishing: true, trade: true, colonize: true, naval: true, explore: true, carts: true, caravans: true, siege: true };
    this.version = 0;
    this._init();
    game.events.on('world:height', (r) => {
      this.nav?.markDirty(r);
      this._heightDirty = true;
    });
    // ice painted on the water (or thawed off it) closes or opens it to ships
    game.events.on('world:type', (r) => {
      const R = this._typeRect;
      if (!R) this._typeRect = { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 };
      else {
        R.x0 = Math.min(R.x0, r.x0);
        R.y0 = Math.min(R.y0, r.y0);
        R.x1 = Math.max(R.x1, r.x1);
        R.y1 = Math.max(R.y1, r.y1);
      }
    });
    game.events.on('laws', ({ key }) => this._onLaw(key));
    this._wrapDamage();
  }

  _init() {
    const w = this.world;
    this.nav = new WaterNav(w, 4);
    this.rng = mulberry32(((this.game.params?.seed ?? 1) * 7919 + 101) >>> 0);
    this._nextId = 1;
    this._timers = { sched: 0.5, war: 0, hazard: 0, land: 1, siege: 0.3, debris: 0, ice: 0 };
    // which water tiles are frozen over (ice sheets the ships keep out of)
    this._ice = new Uint8Array(w.w * w.h);
    for (let i = 0; i < this._ice.length; i++) this._ice[i] = w.height[i] < SEA_LEVEL && w.type[i] === TILE.ICE ? 1 : 0;
    this._typeRect = null;
    this.firsts = new Set();
    this.charts = new Map(); // kingdom -> Set of charted cells
    this._berths = new Map();
    this.blockades = new Map(); // harbour building id -> until
    this._navWait = 0;
    this.lastRefusal = '';
    this.totals = { launched: 0, sunk: 0, colonies: 0, trades: 0, catches: 0, hauls: 0, caravans: 0, stones: 0 };
    this._hash = new Map();
    const area = (w.w * w.h) / (256 * 256);
    // budgets: vessels and land vehicles in the whole world (scaled with the map)
    this.budget = {
      sea: Math.round(Math.min(220, 70 * Math.pow(area, 0.6))), // ships (fishing boats apart)
      fishing: Math.round(Math.min(200, 60 * Math.pow(area, 0.6))),
      land: Math.round(Math.min(120, 36 * Math.pow(area, 0.55))),
      debris: 240,
    };
  }

  reset() {
    // nobody is left aboard a ship that no longer exists
    for (const v of this.list) if (v.alive && v.cls === 'sea') this.disembarkAll(v);
    this.list.length = 0;
    this.byId.clear();
    this.debris.length = 0;
    this.stones.length = 0;
    this.shots.length = 0;
    this._init();
    this.version++;
  }

  // ------------------------------------------------------------------ helpers
  law(key, def = true) {
    const v = this.game.laws?.[key];
    return v == null ? def : v;
  }
  hasTech(kid, id) {
    return !!this.game.civ?.hasTech?.(kid, id);
  }
  kingdom(kid) {
    return this.game.civ?.kingdoms?.[kid] || null;
  }
  kname(kid) {
    const k = this.kingdom(kid);
    if (!k) return 'a lost realm';
    const n = k.name || 'Kingdom';
    return /^the /i.test(n) ? n : 'the ' + n;
  }
  atWar(a, b) {
    return a !== b && a >= 0 && b >= 0 && !!this.game.civ?.atWar?.(a, b);
  }
  // Chronicle: through the civ chronicle when present (de-duplicated by key).
  note(text, kind = 'info', pos = null, key = null, cooldown = 45) {
    const civ = this.game.civ;
    if (civ?._note) return civ._note(text, kind, pos, key, cooldown);
    this.game.notify?.(text, kind, pos);
    return true;
  }
  history(text, kind = 'info', pos = null) {
    const civ = this.game.civ;
    if (civ?._history) civ._history(text, kind, pos);
  }
  // A realm's first use of a vehicle kind is announced once.
  first(kid, kind, pos) {
    const key = kid + '|' + kind;
    if (this.firsts.has(key)) return;
    this.firsts.add(key);
    const k = this.kingdom(kid);
    if (!k) return;
    const what = {
      fishing: 'launches its first fishing boats',
      cog: 'launches its first trading cog',
      transport: 'launches its first transport ship',
      galley: 'launches its first war galleys',
      explorer: 'sends out its first exploration ship',
      carrack: 'launches its first great carrack',
      oxcart: 'sends its first ox carts along the roads',
      caravan: 'sends its first trade caravan abroad',
      ram: 'brings a battering ram to war',
      catapult: 'brings catapults to war',
    }[kind];
    if (!what) return;
    const n = this.kname(kid);
    this.note(`✨ ${n[0].toUpperCase() + n.slice(1)} ${what}`, 'good', pos, 'fleetfirst' + key, 1);
  }
  isNight() {
    const g = this.game;
    return (g.env?.daylight ?? 1) < 0.16;
  }
  storm() {
    const wt = this.game.env?.weather;
    return wt && wt.type === 'storm' ? wt.intensity ?? 1 : 0;
  }
  // Sea range of a realm's ship (path length in tiles).
  range(kid, kind) {
    if (kind === 'fishing') return 26;
    if (kind === 'carrack' || this.hasTech(kid, 'navigation')) return Infinity;
    const base = 150 * Math.sqrt(Math.max(1, this.game.view?.worldScale ?? this.world.w / 256));
    if (kind === 'explorer') return base * 4;
    if (kind === 'galley') return base * (this.hasTech(kid, 'astronomy') ? 1.6 : 1);
    return base * (this.hasTech(kid, 'astronomy') ? 2.5 : 1);
  }

  // ------------------------------------------------------------------ harbours
  // Harbour sites of a realm: every finished jetty (docks), with the berth
  // where ships moor (the water at the end of its pier).
  harbours(kid) {
    const now = this.game.time.total;
    const civ = this.game.civ;
    let C = this._hc;
    if (!C || now - C.t > 1 || C.n !== (civ?.buildings?.length ?? 0) || C.v !== civ?.version || C.nav !== this.nav.version) {
      C = this._hc = { t: now, n: civ?.buildings?.length ?? 0, v: civ?.version, nav: this.nav.version, all: [], by: new Map() };
      for (const b of civ?.buildings || []) {
        if (!b.alive || b.constructing || b.type !== 'docks') continue;
        const h = this.harbourInfo(b.id);
        if (!h) continue;
        C.all.push(h);
        let L = C.by.get(h.kingdom);
        if (!L) C.by.set(h.kingdom, (L = []));
        L.push(h);
      }
    }
    return kid == null ? C.all.slice() : (C.by.get(kid) || []).slice();
  }
  // Can a ship sail between two harbours (or a harbour and a point)?
  canReach(from, to) {
    const a = this.resolveHarbour(from);
    if (!a) return false;
    if (to && typeof to === 'object' && to.x != null) {
      const L = this.nav.isWater(to.x, to.z) ? { x: to.x, z: to.z } : this.nav.landingNear(to.x, to.z, 14, a.water);
      return !!L && this.nav.comp(L.x, L.z) === a.water;
    }
    const b = this.resolveHarbour(to);
    return !!b && b.water === a.water;
  }
  harbourInfo(bid) {
    const civ = this.game.civ;
    const b = civ?.buildingById?.(bid) || civ?._bById?.get(bid);
    if (!b || !b.alive || b.type !== 'docks') return null;
    let h = this._berths.get(bid);
    if (h && h.navV === this.nav.version && h.level === b.level) {
      h.kingdom = b.kingdom;
      return h.berth ? h : null;
    }
    const nav = this.nav;
    const dir = ROT_DIR[b.rot ?? 0] || [0, 1];
    let berth = null;
    for (const d of [3.9, 3.2, 4.6, 2.6]) {
      const px = b.x + dir[0] * d + dir[1] * 0.85,
        pz = b.z + dir[1] * d + dir[0] * 0.85;
      berth = nav.waterNear(px, pz, 3, 1);
      if (berth) break;
    }
    if (!berth) berth = nav.waterNear(b.x, b.z, 6, 1);
    const water = berth ? nav.comp(berth.x, berth.z) : -1;
    const v = civ.villages?.[b.village];
    h = {
      id: b.id,
      building: b.id,
      village: b.village,
      kingdom: b.kingdom,
      level: b.level,
      harbour: b.level >= 2,
      x: b.x,
      z: b.z,
      dirX: dir[0],
      dirZ: dir[1],
      berth: berth && water >= 0 ? berth : null,
      water,
      name: v?.name || 'the harbour',
      landId: v?.landId ?? -1,
      navV: nav.version,
    };
    this._berths.set(bid, h);
    return h.berth ? h : null;
  }
  // A harbour from an id, a building, a village id or a harbour object.
  resolveHarbour(ref, kid = null) {
    const civ = this.game.civ;
    if (ref == null) return null;
    if (typeof ref === 'object') {
      if (ref.berth) return ref;
      if (ref.building != null) return this.harbourInfo(ref.building);
      if (ref.id != null && ref.type === 'docks') return this.harbourInfo(ref.id);
      if (ref.village != null) ref = { villageId: ref.village };
      else return null;
    }
    if (typeof ref === 'number') {
      const b = civ?.buildingById?.(ref) || civ?._bById?.get(ref);
      if (b && b.type === 'docks') return this.harbourInfo(ref);
      ref = { villageId: ref };
    }
    const v = civ?.villages?.[ref.villageId];
    if (!v) return null;
    let best = null;
    for (const b of v.buildings || []) {
      if (!b.alive || b.constructing || b.type !== 'docks') continue;
      const h = this.harbourInfo(b.id);
      if (h && (!best || h.level > best.level)) best = h;
    }
    if (best && kid != null && best.kingdom !== kid) return best;
    return best;
  }
  blockaded(h) {
    const until = this.blockades.get(h.id);
    return until != null && until > this.game.time.total;
  }

  // ------------------------------------------------------------------ vehicles
  vehicles() {
    return this.list.filter((v) => v.alive);
  }
  count(kid = null, kind = null) {
    let n = 0;
    for (const v of this.list) if (v.alive && (kid == null || v.kingdom === kid) && (kind == null || v.kind === kind)) n++;
    return n;
  }
  get(id) {
    return this.byId.get(id) || null;
  }
  // ships against the sea budget (fishing boats have a budget of their own)
  seaCount() {
    let n = 0;
    for (const v of this.list) if (v.alive && v.cls === 'sea' && v.kind !== 'fishing') n++;
    return n;
  }
  fishCount() {
    let n = 0;
    for (const v of this.list) if (v.alive && v.kind === 'fishing') n++;
    return n;
  }
  landCount() {
    let n = 0;
    for (const v of this.list) if (v.alive && v.cls === 'land') n++;
    return n;
  }
  // per-realm caps (a realm with many harbours keeps more ships)
  cap(kid, kind) {
    const civ = this.game.civ;
    const k = this.kingdom(kid);
    const villages = k?.villages?.length || 1;
    switch (kind) {
      case 'fishing':
        return Math.min(18, 3 + villages * 2);
      case 'cog':
        return 2 + (this.hasTech(kid, 'banking') ? 1 : 0) + Math.min(2, villages >> 2);
      case 'transport':
        return 2;
      case 'galley':
        return Math.min(3, 1 + (villages >> 3) + (this.hasTech(kid, 'navigation') ? 1 : 0));
      case 'explorer':
        return 1;
      case 'carrack':
        return 3;
      case 'oxcart':
        return Math.min(8, villages + 1);
      case 'caravan':
        return 2;
      default:
        void civ;
        return 4;
    }
  }

  spawn(kind, kid, x, z, opts = {}) {
    const def = KINDS[kind];
    if (!def) return null;
    const v = {
      id: this._nextId++,
      kind,
      def,
      cls: def.cls,
      kingdom: kid,
      name: def.cls === 'sea' ? shipName(this.rng, kind) : craftName(this.rng, kind, this.game.civ?.villages?.[opts.home]?.name),
      home: opts.home ?? -1,
      harbour: opts.harbour ?? null,
      village: opts.home ?? -1,
      x,
      z,
      px: x,
      pz: z,
      y: 0,
      heading: opts.heading ?? this.rng() * Math.PI * 2,
      ph: 0,
      speed: 0,
      hp: def.hp,
      maxHp: def.hp,
      crew: def.crew,
      cargo: opts.cargo || null,
      state: opts.state || 'moored',
      mission: null,
      path: null,
      pi: 0,
      born: this.game.time.total,
      stateT: 0,
      idleT: 0,
      alive: true,
      sink: 0,
      burning: 0,
      stuck: 0,
      w: def.size * 1.6,
      h: def.size * 1.6,
      seed: this.rng(),
      anim: { row: this.rng() * 6, wheel: 0, arm: 0, fill: 0, furl: 1, oar: 0, walk: this.rng() * 6, cargoType: 0, ram: 0 },
      voyage: null,
    };
    v.ph = v.heading;
    this.list.push(v);
    this.byId.set(v.id, v);
    this.totals.launched++;
    this.version++;
    this.first(kid, kind, { x, z });
    this.game.events.emit('fleet:launched', { vessel: v, kind, kingdom: kid });
    return v;
  }

  // Take a vessel out of the world (laid up, culled, lost its way). Anyone
  // still aboard steps ashore first, and the voyage's end is reported.
  remove(v, why = 'laid up') {
    if (!v.alive) return;
    if (v.cls === 'sea' && v.state !== 'sinking') {
      const n = this.disembarkAll(v);
      if (n || (v.mission && v.mission.phase === 'out' && (v.cargo?.settlers || v.cargo?.army))) {
        const p = this._landPoint(v.x, v.z, v);
        this.game.events.emit('fleet:returned', { vessel: v, id: v.id, kind: v.kind, kingdom: v.kingdom, cargo: v.cargo, x: p.x, z: p.z, aborted: true, why, passengers: n });
      }
    }
    v.alive = false;
    this.byId.delete(v.id);
    this.version++;
  }

  // ------------------------------------------------------------------ passengers
  // Real people ride the transports (Life's units.board / disembark).
  aboard(v) {
    const U = this.game.units;
    return U?.aboard ? U.aboard(v.id) : [];
  }
  // A land point near (x, z) to put people ashore: the nearest dry tile, else
  // the vessel's home town.
  _landPoint(x, z, v = null) {
    const w = this.world;
    const cx = Math.floor(x),
      cz = Math.floor(z);
    let best = null,
      bd = Infinity;
    for (let r = 0; r <= 14 && !best; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const tx = cx + dx,
            tz = cz + dz;
          if (!w.inBounds(tx, tz) || !w.isWalkable(tx, tz)) continue;
          const d = dx * dx + dz * dz;
          if (d < bd) {
            bd = d;
            best = { x: tx + 0.5, z: tz + 0.5 };
          }
        }
    if (best) return best;
    const home = this.game.civ?.villages?.[v?.home];
    if (home?.alive) return { x: home.hall?.doorX ?? home.cx, z: home.hall?.doorZ ?? home.cz };
    return { x, z };
  }
  disembarkAll(v, x = null, z = null) {
    const U = this.game.units;
    const list = this.aboard(v);
    if (!list.length || !U?.disembark) return 0;
    const p = x != null ? { x, z } : this._landPoint(v.x, v.z, v);
    for (const u of list) U.disembark(u, p.x + (this.rng() - 0.5) * 1.2, p.z + (this.rng() - 0.5) * 1.2);
    return list.length;
  }
  // Settlers or soldiers of the home town go aboard at departure.
  _embark(v, h) {
    const U = this.game.units;
    const civ = this.game.civ;
    const c = v.cargo;
    if (!U?.board || !c || (!c.settlers && !c.army)) return 0;
    const home = civ?.villages?.[h.village];
    if (!home?.alive) return 0;
    const want = Math.min(Array.isArray(c.settlers) ? c.settlers.length : c.settlers || 0, v.def.capacity || 10) || Math.min(Array.isArray(c.army) ? c.army.length : c.army || 0, 14);
    const army = !c.settlers;
    const picked = [];
    if (Array.isArray(c.settlers) || Array.isArray(c.army)) {
      for (const u of c.settlers || c.army) if (u?.alive && u.data?.aboard == null) picked.push(u);
    } else {
      let kids = 0;
      for (const u of home.members) {
        if (picked.length >= want) break;
        if (!u.alive || u.data?.aboard != null || u.job === 'king' || u.data?.civ?.army || u.data?.civ?.task?.kind === 'migrate') continue;
        if (army ? u.job !== 'soldier' : u.job === 'soldier') continue;
        if (u.age < 16) {
          if (army || kids >= 2 || u.age < 6) continue;
          kids++;
        }
        picked.push(u);
      }
      // a town of peasants still sends its settlers; an army needs soldiers
      if (picked.length < (army ? 4 : 3)) return 0;
    }
    for (const u of picked) U.board(u, v);
    v.passengers = picked.length;
    return picked.length;
  }

  // ------------------------------------------------------------------ paths
  setPath(v, path) {
    v.path = path;
    v.pi = path ? Math.min(2, path.length - 2) : 0;
    v.stuck = 0;
    v.navV = this.nav.version;
  }
  // Water route for a vessel from where it is to (gx, gz).
  seaPath(v, gx, gz, maxLen = Infinity) {
    const big = !!(v.def.big || v.kind === 'galley' || v.kind === 'carrack');
    const minClear = v.def.clear || 0;
    let p = this.nav.findPath(v.x, v.z, gx, gz, { big, maxLen, minClear });
    // cogs and transports may thread a channel to get home; great ships may not
    if (!p && minClear > 0 && minClear < 2.5) p = this.nav.findPath(v.x, v.z, gx, gz, { big: false, maxLen, minClear: 1 });
    return p;
  }

  // ------------------------------------------------------------------ tick
  tick(step) {
    const g = this.game;
    if (!g.civ) return;
    // terrain edits: patch the water graph (debounced)
    if (this.nav.dirty) {
      this._navWait += step;
      if (this._navWait > 0.3) {
        this._navWait = 0;
        const r = this.nav.update();
        if (r) this._afterTerrain(r);
      }
    }
    const T = this._timers;
    if ((T.ice += step) >= 1) {
      T.ice = 0;
      this._iceCheck();
    }
    this._roadBudget = 1;
    // per-tick shared state (night, storm, who sails by the stars)
    this._nightNow = this.isNight() && g.settings?.dayNight !== false;
    this._stormNow = this.storm();
    const ks = g.civ.kingdoms;
    const A = this._astro || (this._astro = []);
    A.length = ks.length;
    for (let i = 0; i < ks.length; i++) A[i] = !!ks[i]?.techs?.has?.('astronomy');
    this._buildHash();
    // movement and per-vehicle logic
    for (let i = 0; i < this.list.length; i++) {
      const v = this.list[i];
      if (!v.alive) continue;
      v.px = v.x;
      v.pz = v.z;
      v.ph = v.heading;
      v.stateT += step;
      if (v.cls === 'sea') this._seaTick(v, step);
      else {
        this._landTick(v, step);
        v.y = this.world.heightAt(v.x, v.z);
      }
    }
    this._separate(step);
    if ((T.war += step) >= 0.5) {
      this._warTick(T.war);
      T.war = 0;
    }
    if ((T.hazard += step) >= 1) {
      this._hazardTick(T.hazard);
      T.hazard = 0;
    }
    if ((T.sched += step) >= 2) {
      this._schedule(T.sched);
      T.sched = 0;
    }
    if ((T.siege += step) >= 1) {
      this._siegeTick(T.siege);
      T.siege = 0;
    }
    this._stonesTick(step);
    this._shotsTick(step);
    this._debrisTick(step);
    // drop the dead
    if (this.list.some((v) => !v.alive)) this.list = this.list.filter((v) => v.alive);
  }

  // Tiles whose surface changed since the last look: where water froze over
  // or thawed, the water graph is patched (land edits are ignored).
  _iceCheck() {
    const r = this._typeRect;
    if (!r) return;
    this._typeRect = null;
    const w = this.world,
      M = this._ice;
    if (!M || M.length !== w.w * w.h) return;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -1,
      y1 = -1;
    for (let y = Math.max(0, r.y0); y <= Math.min(w.h - 1, r.y1); y++)
      for (let x = Math.max(0, r.x0); x <= Math.min(w.w - 1, r.x1); x++) {
        const i = y * w.w + x;
        const ice = w.height[i] < SEA_LEVEL && w.type[i] === TILE.ICE ? 1 : 0;
        if (ice === M[i]) continue;
        M[i] = ice;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    if (x1 >= 0) this.nav.markDirty({ x0, y0, x1, y1 });
  }

  _buildHash() {
    const gw = (this._gw = Math.ceil(this.world.w / 8) + 1),
      gh = (this._gh = Math.ceil(this.world.h / 8) + 1);
    if (!this._hHead || this._hHead.length !== gw * gh) this._hHead = new Int32Array(gw * gh);
    this._hHead.fill(-1);
    const L = this.list;
    if (!this._hNext || this._hNext.length < L.length) this._hNext = new Int32Array(Math.max(64, L.length * 2));
    this._hList = L;
    for (let i = 0; i < L.length; i++) {
      const v = L[i];
      this._hNext[i] = -1;
      if (!v.alive || v.state === 'sinking') continue;
      const c = Math.min(gh - 1, Math.max(0, v.z >> 3)) * gw + Math.min(gw - 1, Math.max(0, v.x >> 3));
      this._hNext[i] = this._hHead[c];
      this._hHead[c] = i;
    }
  }
  // Hulls never sit inside one another: neighbours drift apart (on water only).
  _separate(step) {
    const nav = this.nav;
    const w = this.world;
    for (const a of this.list) {
      if (!a.alive || a.state === 'sinking') continue;
      if (a.cls === 'land') {
        // siege engines and carts do not stack up either
        if (!a.def.siege && a.speed > 0.2) continue;
        this.near(a.x, a.z, 1.6, (b, d) => {
          if (b === a || b.cls !== 'land' || b.id < a.id) return;
          const min = (a.def.length + b.def.length) * 0.45;
          if (d >= min || d < 1e-3) return;
          const push = Math.min(0.3, (min - d) * 0.5) * Math.min(1, step * 3);
          const ux = ((b.x - a.x) / d) * push,
            uz = ((b.z - a.z) / d) * push;
          if (w.isWalkable(Math.floor(a.x - ux), Math.floor(a.z - uz))) {
            a.x -= ux;
            a.z -= uz;
          }
          if (w.isWalkable(Math.floor(b.x + ux), Math.floor(b.z + uz))) {
            b.x += ux;
            b.z += uz;
          }
        });
        continue;
      }
      const ra = a.def.length * 0.32 + 0.25;
      this.near(a.x, a.z, ra + 1.4, (b, d) => {
        if (b === a || b.cls !== 'sea' || b.id < a.id || b.state === 'sinking') return;
        const min = ra + b.def.length * 0.32 + 0.25;
        if (d >= min) return;
        let dx = b.x - a.x,
          dz = b.z - a.z;
        if (d < 1e-3) {
          dx = Math.cos(a.seed * 6.3);
          dz = Math.sin(a.seed * 6.3);
          d = 1;
        }
        const push = Math.min(0.5, (min - d) * 0.5) * Math.min(1, step * 3);
        const ux = (dx / d) * push,
          uz = (dz / d) * push;
        // a moored ship holds its berth; the newcomer gives way
        const both = a.state === 'moored' && b.state === 'moored';
        const wa = both ? 0.5 : a.state === 'moored' ? 0 : b.state === 'moored' ? 2 : 1,
          wb = both ? 0.5 : b.state === 'moored' ? 0 : a.state === 'moored' ? 2 : 1;
        if (wa && nav.isWater(a.x - ux * wa, a.z - uz * wa)) {
          a.x -= ux * wa;
          a.z -= uz * wa;
        }
        if (wb && nav.isWater(b.x + ux * wb, b.z + uz * wb)) {
          b.x += ux * wb;
          b.z += uz * wb;
        }
      });
    }
  }

  // vehicles within r of a point (from the per-tick hash)
  near(x, z, r, fn) {
    const head = this._hHead,
      next = this._hNext,
      L = this._hList;
    if (!head) return;
    const gw = this._gw,
      gh = this._gh;
    const x0 = Math.max(0, Math.floor((x - r) / 8)),
      x1 = Math.min(gw - 1, Math.floor((x + r) / 8)),
      z0 = Math.max(0, Math.floor((z - r) / 8)),
      z1 = Math.min(gh - 1, Math.floor((z + r) / 8));
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        for (let i = head[cz * gw + cx]; i >= 0; i = next[i]) {
          const v = L[i];
          if (!v || !v.alive) continue;
          const d = Math.hypot(v.x - x, v.z - z);
          if (d <= r + v.def.size) fn(v, d);
        }
      }
  }

  // Vessel motion: follow the path, steer with a turning limit, ride the
  // wind, never leave the water.
  _seaTick(v, step) {
    const def = v.def;
    const a = v.anim;
    const night = this._nightNow && !this._astro?.[v.kingdom];
    if (v.state === 'sinking') {
      v.sink = Math.min(1, v.sink + step / 6);
      v.speed *= Math.exp(-step * 1.5);
      v.x += Math.cos(v.heading) * v.speed * step;
      v.z += Math.sin(v.heading) * v.speed * step;
      if (v.sink >= 1) this.remove(v);
      return;
    }
    if (v.burning > 0) {
      v.burning = Math.max(0, v.burning - step * 0.05);
      this.hurt(v, step * 3 * v.burning, 'fire');
      if (!v.alive || v.state === 'sinking') return;
    }
    // the ground rose beneath the keel
    if (!this.nav.isWater(v.x, v.z)) {
      const wpt = this.nav.waterNear(v.x, v.z, 2, 0.5);
      if (wpt) {
        v.x = wpt.x;
        v.z = wpt.z;
      } else return this.lose(v, 'aground');
    }
    this._missionTick(v, step, night);
    if (!v.alive) return;
    if (v.state === 'moored') {
      // at rest: sails furled, oars shipped, nothing to steer, no wake
      v.track = null;
      a.furl += (1 - a.furl) * Math.min(1, step * 1.2);
      a.oar *= Math.exp(-step * 2);
      a.fill = 0;
      return;
    }
    if (!v.alive) return;
    let target = 0;
    if (v.state === 'sail' && v.path) {
      // next waypoint
      const P = v.path;
      let tx = P[v.pi],
        tz = P[v.pi + 1];
      let dd = Math.hypot(tx - v.x, tz - v.z);
      while (dd < (v.pi >= P.length - 2 ? 0.45 : 1.1) && v.pi < P.length - 2) {
        v.pi += 2;
        tx = P[v.pi];
        tz = P[v.pi + 1];
        dd = Math.hypot(tx - v.x, tz - v.z);
      }
      if (v.pi >= P.length - 2 && dd < 0.6) {
        v.path = null;
        this._arrive(v);
        if (!v.alive) return;
      } else {
        const want = Math.atan2(tz - v.z, tx - v.x);
        let diff = angDiff(want, v.heading);
        const turn = def.turn * (v.speed < 0.5 ? 1.6 : 1) * step;
        v.heading += Math.max(-turn, Math.min(turn, diff));
        diff = angDiff(want, v.heading);
        target = def.speed * this._windFactor(v) * (1 - Math.min(0.75, Math.abs(diff) / Math.PI) * 0.9);
        if (dd < 2.5 && v.pi >= v.path.length - 2) target *= 0.35 + dd * 0.26;
        if (v.chase) target *= 1.12;
        if (v.grappled > this.game.time.total) target *= 0.25;
        if (night) target = 0;
        const st = this._stormNow;
        if (st > 0.4) target *= 1 - st * 0.25;
      }
    } else if (v.state === 'fish') {
      // drift and turn slowly over the shoal while the nets are out
      v.heading += step * 0.18;
      target = 0.12;
    } else if (v.state === 'patrol') {
      v.heading += step * 0.35;
      target = def.speed * (v.grappled > this.game.time.total ? 0.08 : 0.3);
    }
    // accelerate / brake
    const acc = target > v.speed ? 0.7 : 1.4;
    v.speed += Math.max(-acc * step, Math.min(acc * step, target - v.speed));
    if (v.speed > 0.01) {
      const nx = v.x + Math.cos(v.heading) * v.speed * step,
        nz = v.z + Math.sin(v.heading) * v.speed * step;
      const bow = Math.min(1, def.length * 0.4);
      const deepOK = def.clear < 2 || this.world.heightAt(nx + Math.cos(v.heading) * bow, nz + Math.sin(v.heading) * bow) < -(def.draft || 0.3) * 0.5;
      if (deepOK && this.nav.isWater(nx, nz) && this.nav.isWater(nx + Math.cos(v.heading) * bow, nz + Math.sin(v.heading) * bow)) {
        v.x = nx;
        v.z = nz;
        v.stuck = Math.max(0, v.stuck - step);
      } else {
        v.speed *= 0.3;
        v.stuck += step;
        if (v.stuck > 3 && v.state === 'sail' && v.dest) {
          // re-plan around the obstacle
          v.stuck = 0;
          const p = this.seaPath(v, v.dest.x, v.dest.z);
          if (p) this.setPath(v, p);
          else if (v.state !== 'moored') this._failMission(v);
        }
      }
    }
    // the recent track, for the wake that follows the course
    const T = v.track || (v.track = []);
    const tl = T.length;
    const td = tl ? Math.hypot(v.x - T[tl - 2], v.z - T[tl - 1]) : 0;
    if (!tl || td > Math.max(0.15, def.length * 0.12)) {
      if (td > 3) T.length = 0; // a jump (snapped off a shoal): start afresh
      T.push(v.x, v.z);
      if (T.length > 48) T.splice(0, 2);
    }
    // animation state
    const sailing = v.state === 'sail' || v.state === 'patrol';
    a.furl += ((sailing && !night ? 0 : 1) - a.furl) * Math.min(1, step * 1.2);
    a.fill = this._sailFill(v);
    const rowing = def.oars && (v.state === 'sail' || v.state === 'patrol') && (v.kind === 'galley' || v.speed > 0.1);
    a.oar += ((rowing ? 1 : 0) - a.oar) * Math.min(1, step * 2);
    a.row += step * (v.kind === 'galley' ? 3.2 : 2.4) * (0.4 + Math.min(1, v.speed / def.speed));
  }

  _windFactor(v) {
    const def = v.def;
    const wind = this.game.env?.wind || { x: 1, z: 0, strength: 0.3 };
    const along = Math.cos(v.heading) * (wind.x || 0) + Math.sin(v.heading) * (wind.z || 0);
    const s = wind.strength ?? 0.3;
    let f = 0.8 + (along * 0.5 + 0.5) * 0.35 * (0.6 + s);
    if (def.oars) f = Math.max(f, v.kind === 'galley' ? 1 : 0.95);
    return Math.max(0.6, Math.min(1.3, f));
  }
  _sailFill(v) {
    const wind = this.game.env?.wind || { x: 1, z: 0, strength: 0.3 };
    const along = Math.cos(v.heading) * (wind.x || 0) + Math.sin(v.heading) * (wind.z || 0);
    return Math.max(0.4, Math.min(1, (0.55 + along * 0.35) * (0.6 + (wind.strength ?? 0.3))));
  }

  // ------------------------------------------------------------------ damage
  hurt(v, amount, cause = 'damage', by = null) {
    if (!v.alive || v.state === 'sinking' || !(amount > 0)) return;
    v.hp -= amount;
    v.lastHit = this.game.time.total;
    v.lastCause = cause;
    if (by) v.lastBy = by;
    if (v.hp <= 0) {
      v.hp = 0;
      this.lose(v, cause, by);
    }
  }

  // A vessel sinks (or a land vehicle is wrecked): debris, the event, the chronicle.
  lose(v, cause = 'lost', by = null) {
    if (!v.alive || v.state === 'sinking') return;
    const g = this.game;
    const info = { vessel: v, vehicle: v, id: v.id, kind: v.kind, kingdom: v.kingdom, cargo: v.cargo, cause, x: v.x, z: v.z, by: by ? { id: by.id, kind: by.kind, kingdom: by.kingdom } : null, voyage: v.voyage };
    if (v.cls === 'sea') {
      v.state = 'sinking';
      v.sink = 0.01;
      v.path = null;
      this.totals.sunk++;
      const n = Math.round(4 + v.def.length * 3);
      for (let i = 0; i < n; i++) this._addDebris(v.x + (this.rng() - 0.5) * v.def.length, v.z + (this.rng() - 0.5) * v.def.length * 0.6, i);
      this._fx('splash', v.x, v.z, 0.8 + v.def.length * 0.4);
      // a grey-white pall over the water (the dark land smoke reads as brown there)
      if (cause === 'fire' || cause === 'battle' || cause === 'meteor' || cause === 'lightning') this._fx('smoke', v.x, v.z, 1.1, { dark: false, count: 2, y: 0.5 });
      this._sfx('splash', v.x, v.z);
    } else {
      v.state = 'wrecked';
      this._fx('debris', v.x, v.z, 0.9);
      this._fx('dust', v.x, v.z, 0.8);
      this.remove(v);
    }
    g.events.emit('fleet:lost', info);
    this._chronicleLoss(v, cause, by);
  }

  _chronicleLoss(v, cause, by) {
    const pos = { x: v.x, z: v.z };
    const who = this.kname(v.kingdom);
    const nm = v.name ? `the ${v.def.name.toLowerCase()} ${v.name}` : `a ${v.def.name.toLowerCase()}`;
    const Who = who[0].toUpperCase() + who.slice(1);
    if (v.cls === 'land') {
      if (cause === 'raided') this.note(`⚔ Raiders of ${by ? this.kname(by.kingdom) : 'the enemy'} seize ${nm} of ${who}`, 'war', pos, 'raid' + v.kingdom, 60);
      else if (v.def.siege) this.history(`${Who} loses ${nm} before the walls`, 'war', pos);
      return;
    }
    if (cause === 'battle' && by && v.kind === 'fishing') {
      this.history(`${Who}'s fishing boat is sunk by galleys of ${this.kname(by.kingdom)}`, 'war', pos);
    } else if (cause === 'battle' && by && (v.kind === 'galley' || v.kind === 'cog')) {
      const key = 'sunkh' + v.kingdom + '-' + by.kingdom;
      const now = this.game.time.total;
      this._histT = this._histT || new Map();
      if (now - (this._histT.get(key) ?? -1e9) > 300) {
        this._histT.set(key, now);
        this.history(`${nm[0].toUpperCase() + nm.slice(1)} of ${who} is sunk by galleys of ${this.kname(by.kingdom)}`, 'war', pos);
      }
    } else if (cause === 'battle' && by) {
      this.note(`⚓ ${nm[0].toUpperCase() + nm.slice(1)} of ${who} is sunk by galleys of ${this.kname(by.kingdom)}`, 'war', pos, 'sunk' + v.kingdom + '-' + by.kingdom, 400);
    } else if (cause === 'storm' || cause === 'lightning') {
      this.note(`🌊 ${nm[0].toUpperCase() + nm.slice(1)} of ${who} founders in the storm`, 'disaster', pos, 'stormsink' + v.kingdom, 60);
    } else if (cause === 'serpent' || cause === 'monster') {
      this.note(`🌊 A sea monster drags ${nm} of ${who} beneath the waves`, 'disaster', pos, 'serpent' + v.kingdom, 60);
    } else if (v.kind !== 'fishing' || cause === 'meteor' || cause === 'smite' || cause === 'tornado') {
      const why = { meteor: 'struck by a falling star', smite: 'smitten by the heavens', tornado: 'torn apart by a waterspout', tsunami: 'swamped by a great wave', aground: 'runs aground and breaks up', fire: 'burns to the waterline' }[cause] || 'is lost at sea';
      this.note(`🌊 ${nm[0].toUpperCase() + nm.slice(1)} of ${who} ${why.startsWith('runs') || why.startsWith('burns') || why.startsWith('is') ? why : 'is ' + why}`, 'disaster', pos, 'lost' + v.kingdom + cause, 60);
    }
  }

  // Disasters damage units in an area; ships and carts there take it too.
  damageArea(x, z, r, amount, cause = 'disaster') {
    if (!this.list.length || !(amount > 0)) return;
    const mul = { meteor: 1.4, smite: 3, tornado: 2.4, lightning: 1.2, tsunami: 2, volcano: 1, earthquake: 0.6, golem: 0.8, fire: 0.6 }[cause] ?? 1;
    for (const v of this.list) {
      if (!v.alive || v.state === 'sinking') continue;
      const d = Math.hypot(v.x - x, v.z - z);
      const R = r + v.def.size;
      if (d > R) continue;
      if (v.cls === 'sea' && (cause === 'earthquake' || cause === 'fire' || cause === 'lava')) continue;
      const f = Math.max(0.25, 1 - d / Math.max(0.5, R));
      this.hurt(v, amount * mul * f, cause);
      if ((cause === 'meteor' || cause === 'lightning' || cause === 'smite') && v.alive && v.state !== 'sinking') v.burning = Math.min(1, v.burning + 0.5);
    }
  }
  _wrapDamage() {
    const U = this.game.units;
    if (!U || typeof U.damageArea !== 'function' || U.__fleetWrapped) return;
    const orig = U.damageArea.bind(U);
    U.damageArea = (x, z, r, amount, cause, ...rest) => {
      try {
        this.game.fleet?.damageArea?.(x, z, r, amount, cause);
      } catch (err) {
        console.error('[fleet] damageArea', err);
      }
      return orig(x, z, r, amount, cause, ...rest);
    };
    U.__fleetWrapped = true;
  }

  // ------------------------------------------------------------------ terrain
  _afterTerrain(r) {
    this._berths.clear();
    for (const v of this.list) {
      if (!v.alive || v.cls !== 'sea' || !v.path) continue;
      // re-check the remaining route where the land changed
      const P = v.path;
      let hit = false;
      for (let i = Math.max(0, v.pi - 2); i < P.length - 2 && !hit; i += 2) {
        const minx = Math.min(P[i], P[i + 2]),
          maxx = Math.max(P[i], P[i + 2]),
          minz = Math.min(P[i + 1], P[i + 3]),
          maxz = Math.max(P[i + 1], P[i + 3]);
        if (maxx < r.x0 - 1 || minx > r.x1 + 1 || maxz < r.y0 - 1 || minz > r.y1 + 1) continue;
        if (!this.nav.los(P[i], P[i + 1], P[i + 2], P[i + 3], 0)) hit = true;
      }
      if (hit && v.dest) {
        const p = this.seaPath(v, v.dest.x, v.dest.z);
        if (p) this.setPath(v, p);
        else this._failMission(v);
      }
    }
  }

  // ------------------------------------------------------------------ effects
  _fx(type, x, z, scale = 1, opts = {}) {
    const g = this.game;
    if (!g.fx?.emit) return;
    const rig = g.cameraRig;
    if (rig && Math.hypot(rig.cur.x - x, rig.cur.z - z) > rig.cur.dist * 1.2 + 15) return;
    try {
      g.fx.emit(type, { x, y: opts.y, z }, { scale, ...opts });
    } catch {
      /* effects are optional */
    }
  }
  _sfx(name, x, z, vol = 0.6) {
    const g = this.game;
    const rig = g.cameraRig;
    if (!g.audio?.play || !rig || Math.hypot(rig.cur.x - x, rig.cur.z - z) > rig.cur.dist * 0.9 + 10) return;
    const now = g.time.realTime ?? 0;
    this._sfxT = this._sfxT || new Map();
    if (now - (this._sfxT.get(name) ?? -9) < 0.5) return;
    this._sfxT.set(name, now);
    try {
      g.audio.play(name, { pos: { x, z }, volume: vol });
    } catch {
      /* audio is optional */
    }
  }

  // Arrows and fire pots between ships: a splash when they miss, sparks or
  // flames where they strike.
  _shotsTick(step) {
    if (!this.shots.length) return;
    const keep = [];
    for (const s of this.shots) {
      s.t += step;
      if (s.t < s.dur) {
        keep.push(s);
        continue;
      }
      if (s.hit) {
        const v = this.byId.get(s.target);
        if (s.pot && v && v.alive && v.state !== 'sinking') v.burning = Math.min(1, v.burning + 0.45);
        if (s.pot) this._fx('fireball', s.x1, s.z1, 0.5, { y: 0.5 });
        else this._fx('sparks', s.x1, s.z1, 0.5, { y: 0.5 });
      } else if (this.nav.isWater(s.x1, s.z1)) this._fx('splash', s.x1, s.z1, s.pot ? 0.65 : 0.42);
    }
    this.shots = keep;
  }

  _addDebris(x, z, i) {
    if (this.debris.length >= this.budget.debris) this.debris.shift();
    if (!this.nav.isWater(x, z)) return;
    this.debris.push({ x, z, rot: this.rng() * 6.3, spin: (this.rng() - 0.5) * 0.4, vx: (this.rng() - 0.5) * 0.6, vz: (this.rng() - 0.5) * 0.6, age: 0, life: 70 + this.rng() * 60, size: 0.6 + this.rng() * 0.7, type: i % 4, seed: this.rng() });
  }
  _debrisTick(step) {
    if (!this.debris.length) return;
    const wind = this.game.env?.wind || { x: 1, z: 0, strength: 0.3 };
    const keep = [];
    for (const d of this.debris) {
      d.age += step;
      if (d.age > d.life) continue;
      d.vx = d.vx * Math.exp(-step * 0.6) + wind.x * 0.04 * step;
      d.vz = d.vz * Math.exp(-step * 0.6) + wind.z * 0.04 * step;
      const nx = d.x + d.vx * step,
        nz = d.z + d.vz * step;
      if (this.nav.isWater(nx, nz)) {
        d.x = nx;
        d.z = nz;
      } else {
        d.vx = -d.vx * 0.3;
        d.vz = -d.vz * 0.3;
      }
      d.rot += d.spin * step;
      keep.push(d);
    }
    this.debris = keep;
  }

  _onLaw(key) {
    if (key == null || key === 'fleetSailing' || key === 'fleetNaval' || key === 'fleetColonize') {
      for (const v of this.list) if (v.alive && v.cls === 'sea' && v.state !== 'sinking') this._lawCheck(v);
    }
  }

  // ------------------------------------------------------------------ inspect & stats
  inspect(hit) {
    if (!hit || !this.list.length) return null;
    let best = null,
      bd = Infinity;
    for (const v of this.list) {
      if (!v.alive || v.state === 'sinking') continue;
      const d = Math.hypot(v.x - hit.x, v.z - hit.z);
      const r = Math.max(0.9, v.def.size * (v.cls === 'sea' ? 1.1 : 0.9));
      if (d < r && d < bd) {
        bd = d;
        best = v;
      }
    }
    if (!best) return null;
    return this.describe(best);
  }

  describe(v) {
    const civ = this.game.civ;
    const k = this.kingdom(v.kingdom);
    const def = v.def;
    const home = civ?.villages?.[v.home];
    const stats = [['Health', `${Math.max(0, Math.ceil(v.hp))} / ${v.maxHp}`], ['Doing', this.doingText(v)], ['Crew', v.kind === 'galley' ? `${v.crew} oarsmen and marines` : v.crew]];
    if (def.capacity || v.cargo) stats.push(['Cargo', cargoText(v.cargo)]);
    const aboard = v.cls === 'sea' ? this.aboard(v).length : 0;
    if (aboard) stats.push(['Aboard', `${aboard} ${v.cargo?.army ? 'soldiers' : 'passengers'}`]);
    const homeward = v.mission?.phase === 'home' || v.mission?.type === 'home';
    const homeName = home?.name || v.voyage?.fromName || 'home';
    if (v.voyage && v.state !== 'moored') stats.push(['Voyage', homeward ? `${v.voyage.toName || 'abroad'} → ${homeName}` : `${v.voyage.fromName || '—'} → ${v.voyage.toName || 'open sea'}`]);
    if (home) stats.push([v.cls === 'sea' ? 'Home port' : 'Home', home.name]);
    // speed only when it is really moving (a ship turning or waiting at anchor shows none)
    if (v.speed > 0.05) stats.push(['Speed', `${Math.max(1, Math.round(v.speed * 10))} ${v.cls === 'sea' ? 'knots' : 'paces'}`]);
    stats.push(['Built', `year ${Math.floor(v.born / YEAR) + 1}`]);
    if (v.cls === 'sea' && this.hasTech(v.kingdom, 'astronomy')) stats.push(['Charts', 'sails by the stars, day and night']);
    return {
      // a craft outranks people merely standing beside it (units are 25)
      priority: v.cls === 'sea' ? 26 : 27,
      kind: v.cls === 'sea' ? 'vessel' : 'vehicle',
      building: v, // tracked by the inspector (it follows ref.x / ref.z)
      vessel: v,
      title: v.cls === 'sea' ? `${def.name} ${v.name}` : `${v.name} (${def.name.toLowerCase()})`,
      subtitle: `${k ? k.name : 'No realm'}${v.state === 'moored' ? ' · in port at ' + homeName : homeward ? ' · returning to ' + homeName : v.voyage?.toName ? ' · bound for ' + v.voyage.toName : ''}`,
      stats,
      x: v.x,
      z: v.z,
    };
  }

  doingText(v) {
    const m = v.mission;
    if (v.state === 'sinking') return 'Sinking!';
    if (v.state === 'moored') return v.cls === 'sea' ? 'Moored at the jetty' : 'Resting';
    if (v.state === 'anchored') return this.isNight() ? 'At anchor for the night' : 'At anchor';
    if (v.state === 'fish') return 'Hauling nets over the shoal';
    if (!m) return 'Under way';
    if (v.state === 'sail' && v.speed < 0.05) return this.isNight() && !this.hasTech(v.kingdom, 'astronomy') ? 'Waiting for daylight' : v.grappled > this.game.time.total ? 'Locked in a fight' : 'Coming about';
    switch (m.type) {
      case 'fish':
        return m.phase === 'home' ? 'Bringing the catch home' : 'Sailing out to the fishing grounds';
      case 'trade':
        return m.phase === 'home' ? 'Sailing home with silver' : 'Carrying goods to a friendly port';
      case 'colony':
        return m.phase === 'home' ? 'Returning home' : 'Carrying settlers to a new land';
      case 'army':
        return m.phase === 'home' ? 'Returning home' : 'Carrying an army across the water';
      case 'chart':
        return m.phase === 'home' ? 'Returning with new charts' : 'Charting distant coasts';
      case 'patrol':
        return v.target ? 'Engaging the enemy' : m.blockade != null ? 'Blockading an enemy harbour' : 'Patrolling the sea lanes';
      case 'voyage':
        return m.phase === 'home' ? 'Returning home' : 'On a voyage';
      case 'home':
        return 'Returning to port';
      case 'haul':
        return m.phase === 'home' ? 'Returning empty' : `Hauling ${cargoText(v.cargo)}`;
      case 'caravan':
        return m.phase === 'home' ? 'Returning with coin' : 'Bringing goods to a neighbour';
      case 'siege':
        return v.siegeTarget ? (v.kind === 'catapult' ? 'Hurling stones at the walls' : 'Battering the gates') : 'Rolling with the army';
      default:
        return 'Under way';
    }
  }

  stats() {
    let vessels = 0,
      vehicles = 0;
    for (const v of this.list) {
      if (!v.alive) continue;
      if (v.cls === 'sea') vessels++;
      else vehicles++;
    }
    return { vessels, vehicles };
  }

  // Trade lanes (for the renderer): routes of trading ships under way.
  lanes() {
    const out = [];
    for (const v of this.list) {
      if (!v.alive || !v.path || v.state !== 'sail') continue;
      if (v.kind !== 'cog' && v.kind !== 'carrack') continue;
      out.push({ id: v.id, kingdom: v.kingdom, path: v.path });
    }
    return out;
  }
}

export function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

Object.assign(Fleet.prototype, missions, land, war);
export { KINDS, SEA_KINDS, pathLength, SEA_LEVEL };
