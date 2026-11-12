import { SEA_LEVEL, TILE } from '../../world/constants.js';
import { KINDS } from './kinds.js';
import { pathLength } from './nav.js';
import { regionName } from '../disasters/util.js';

const YEAR = 30;

// Voyages, the self-driven scheduler and sea missions (mixed into Fleet).
export const missions = {
  // ------------------------------------------------------------------ API
  requestVoyage(o = {}) {
    const refuse = (why) => {
      this.lastRefusal = why;
      return null;
    };
    const civ = this.game.civ;
    const kid = o.kingdom;
    const K = this.kingdom(kid);
    if (!K || K.alive === false) return refuse('no such realm');
    if (!this.law('fleetSailing')) return refuse('sailing is forbidden by the laws of the world');
    const cargo = o.cargo ? { ...o.cargo } : {};
    if (cargo.settlers && !this.law('fleetColonize')) return refuse('overseas settlement is forbidden');
    let kind = KINDS[o.kind]?.cls === 'sea' ? o.kind : cargo.settlers || cargo.army ? 'transport' : 'cog';
    if (kind === 'galley' && !this.law('fleetNaval')) return refuse('naval war is forbidden');
    const h = this.resolveHarbour(o.from, kid);
    if (!h) return refuse('no harbour');
    if (this.blockaded(h)) return refuse('the harbour is blockaded');
    // settlers and armies always find a ship; trade leaves room for them
    if (this.seaCount() >= this.budget.sea * (cargo.settlers || cargo.army ? 1.1 : 0.85)) return refuse('the seas are crowded');
    const nav = this.nav;
    // where to sail, and where the cargo is delivered
    let toH = null,
      dest = null,
      deliver = null,
      toName = null;
    const to = o.to;
    if (typeof to === 'number' || (to && typeof to === 'object' && to.x == null)) {
      toH = this.resolveHarbour(to);
      if (!toH) return refuse('no such harbour');
      dest = this._mooringSpot(toH, null, kind) || this._anchorage(toH, KINDS[kind] || KINDS.cog) || toH.berth;
      deliver = { x: toH.x, z: toH.z };
      toName = toH.name;
    } else if (to && to.x != null) {
      const water = nav.isWater(to.x, to.z);
      if (water && !cargo.settlers && !cargo.army) {
        dest = nav.waterNear(to.x, to.z, 3, 0.5) || { x: to.x, z: to.z };
        deliver = { x: to.x, z: to.z };
      } else {
        const L = nav.landingNear(to.x, to.z, 14, h.water);
        if (!L) return refuse('no landing there');
        dest = { x: L.x, z: L.z };
        deliver = water ? { x: L.landX, z: L.landZ } : { x: to.x, z: to.z };
      }
      toName = this._placeName(deliver.x, deliver.z);
    } else return refuse('no destination');
    if (nav.comp(dest.x, dest.z) !== h.water) return refuse('no water route');
    const straight = Math.hypot(dest.x - h.berth.x, dest.z - h.berth.z);
    // the right ship for the route: short hauls go in cogs and transports (even
    // for a realm with carracks), long ones in ocean-going ships; great ships
    // never sail up narrow rivers
    let options;
    if (kind === 'transport' || cargo.settlers || cargo.army) options = cargo.army ? ['transport', 'carrack'] : straight < 120 ? ['transport', 'carrack', 'explorer'] : ['carrack', 'explorer', 'transport'];
    else if (kind === 'cog' || kind === 'carrack') options = straight < 70 || kind === 'cog' ? ['cog', 'carrack'] : ['carrack', 'cog'];
    else options = [kind];
    let pick = null,
      path = null;
    const byClear = new Map();
    let reason = 'no water route';
    for (const k of options) {
      if (k !== kind && !this.hasTech(kid, KINDS[k].tech)) continue;
      const c = KINDS[k].clear || 0;
      let p = byClear.get(c);
      if (p === undefined) {
        // routes between the same two places are remembered a while (a failed
        // search over a whole ocean is the costliest thing a fleet does)
        const rc = this._routes || (this._routes = new Map());
        const key = h.id + '>' + Math.round(dest.x) + ',' + Math.round(dest.z) + ':' + c;
        const hit = rc.get(key);
        if (hit && this.game.time.total - hit.t < 90 && hit.v === nav.version) p = hit.p;
        else {
          p = nav.findPath(h.berth.x, h.berth.z, dest.x, dest.z, { big: c >= 2, minClear: c });
          rc.set(key, { p, t: this.game.time.total, v: nav.version });
          if (rc.size > 400) rc.delete(rc.keys().next().value);
        }
        byClear.set(c, p);
      }
      if (!p) continue;
      if (pathLength(p) > this.range(kid, k)) {
        reason = 'beyond the reach of its ships';
        continue;
      }
      pick = k;
      path = p;
      break;
    }
    if (!pick) return refuse(reason);
    if (pick === 'explorer' && cargo.settlers) cargo.settlers = Array.isArray(cargo.settlers) ? cargo.settlers.slice(0, 6) : Math.min(6, cargo.settlers);
    let v = this.list.find((s) => s.alive && s.kind === pick && s.harbour === h.id && s.state === 'moored' && !s.mission && !s.layup);
    if (!v) v = this.spawn(pick, kid, h.berth.x, h.berth.z, { home: h.village, harbour: h.id, heading: Math.atan2(h.dirZ, h.dirX) });
    if (!v) return refuse('no ship');
    const type = cargo.settlers ? 'colony' : cargo.army ? 'army' : toH ? 'trade' : 'voyage';
    // when each realm last traded, and when anyone last sailed to settle
    const lv = this._lastVoy || (this._lastVoy = { trade: new Map(), colony: -1e9 });
    if (type === 'trade') lv.trade.set(kid, this.game.time.total);
    if (type === 'colony') lv.colony = this.game.time.total;
    v.mission = { type, phase: 'out', requested: !o._self, toH: toH?.id ?? null, from: h.id, t0: this.game.time.total };
    v.cargo = cargo;
    v.deliver = deliver;
    // voyage.from / .to are villages (or a point) for the inspector; the harbour ids ride along
    v.voyage = { from: h.village, to: toH ? toH.village : o.to, fromHarbour: h.id, toHarbour: toH?.id ?? null, fromName: h.name, toName, requested: !o._self, t0: this.game.time.total };
    v.idleT = 0;
    this._sail(v, dest, Math.hypot(v.x - h.berth.x, v.z - h.berth.z) < 0.6 ? path : null);
    if (!v.path) {
      this.remove(v);
      return refuse('no water route');
    }
    this._embark(v, h);
    return v;
  },

  // ------------------------------------------------------------------ helpers
  _placeName(x, z) {
    const civ = this.game.civ;
    let best = null,
      bd = 30;
    for (const v of civ?.villages || []) {
      if (!v.alive) continue;
      const d = Math.hypot(v.cx - x, v.cz - z);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    if (best) return best.name;
    try {
      return regionName(this.game, x, z);
    } catch {
      return 'distant shores';
    }
  },

  _sail(v, dest, path = null) {
    v.dest = { x: dest.x, z: dest.z, berth: !!dest.berth };
    const p = path || this.seaPath(v, dest.x, dest.z);
    this.setPath(v, p);
    if (p) {
      v.state = 'sail';
      v.stateT = 0;
    }
    return !!p;
  },

  // How many ships a jetty can berth (a harbour more), and how many it has.
  harbourCap(h) {
    const seafaring = this.game.civ?.hasCultureTrait?.(this.kingdom(h.kingdom)?.culture, 'Seafaring');
    return (h.level >= 2 ? 5 : 3) + (seafaring ? 1 : 0);
  },
  berthed(h, self = null) {
    let n = 0;
    for (const o of this.list) {
      if (!o.alive || o === self || o.cls !== 'sea' || o.state === 'sinking' || o.kind === 'fishing') continue;
      if (o.state === 'moored' && o.harbour === h.id) n++;
      else if (o.state === 'sail' && o.mission?.phase === 'home' && o.harbour === h.id && o.dest?.berth) n++;
    }
    return n;
  },
  // Water deep and wide enough for a hull at (x, z) lying along (dx, dz).
  _hullFits(x, z, dx, dz, def) {
    const w = this.world;
    const L = def.length,
      B = (def.beam || 0.5) * 0.5 + 0.12,
      D = Math.max(0.1, def.draft || 0.2);
    const px = -dz,
      pz = dx;
    for (const f of [-0.5, 0, 0.5])
      for (const sd of [-1, 0, 1]) {
        const qx = x + dx * L * f + px * B * sd,
          qz = z + dz * L * f + pz * B * sd;
        const tx = Math.floor(qx),
          tz = Math.floor(qz);
        if (!w.inBounds(tx, tz)) return false;
        const h = w.height[tz * w.w + tx];
        if (h >= 0 || -h < (sd === 0 ? D : D * 0.6)) return false;
      }
    return true;
  },
  // A free berth for one more ship: off the end of the jetty, alongside it,
  // then further out, each spaced by the ships' lengths and in water deep
  // enough for the keel. null when the harbour is full.
  _mooringSpot(h, self, kind = null) {
    const nav = this.nav;
    const def = self?.def || KINDS[kind] || KINDS.cog;
    const L = def.length;
    if (def === KINDS.fishing) return this._boatSlot(h, self);
    if (this.berthed(h, self) >= this.harbourCap(h)) return null;
    const px = -h.dirZ,
      pz = h.dirX;
    const ex = h.x + h.dirX * 3.4,
      ez = h.z + h.dirZ * 3.4; // the end of the pier
    const taken = (x, z) => {
      for (const o of this.list) {
        if (!o.alive || o === self || o.cls !== 'sea' || o.state === 'sinking') continue;
        let ox, oz;
        if (o.state === 'moored') (ox = o.x), (oz = o.z);
        else if (o.state === 'sail' && o.mission?.phase === 'home' && o.dest) (ox = o.dest.x), (oz = o.dest.z);
        else continue;
        // hulls lie parallel to the pier: compare along and across it
        const ddx = ox - x,
          ddz = oz - z;
        const along = Math.abs(ddx * h.dirX + ddz * h.dirZ),
          across = Math.abs(ddx * px + ddz * pz);
        if (along < (L + o.def.length) * 0.5 + 0.25 && across < ((def.beam || 0.5) + (o.def.beam || 0.5)) * 0.5 + 0.35) return true;
      }
      return false;
    };
    const B = (def.beam || 0.5) + 0.45;
    const slots = [
      [L / 2 + 0.45, 0],
      [L * 0.25, B + 0.1],
      [L * 0.25, -B - 0.1],
      [L * 1.5 + 0.9, 0],
      [L * 0.35 + 0.4, B * 2 + 0.2],
      [L * 0.35 + 0.4, -B * 2 - 0.2],
      [L * 1.25 + 0.7, B + 0.1],
      [L * 1.25 + 0.7, -B - 0.1],
    ];
    for (const [f, sd] of slots) {
      const x = ex + h.dirX * f + px * sd,
        z = ez + h.dirZ * f + pz * sd;
      if (!this._hullFits(x, z, h.dirX, h.dirZ, def)) continue;
      if (taken(x, z)) continue;
      if (!nav.los(h.berth.x, h.berth.z, x, z, 0)) continue;
      return { x, z, berth: true };
    }
    return null;
  },
  // Fishing boats tie up beside the pier itself, out of the ships' way.
  _boatSlot(h, self) {
    const px = -h.dirZ,
      pz = h.dirX;
    const def = KINDS.fishing;
    for (const f of [1.3, 2.3, 3.2, 4.0, 1.0, 2.8])
      for (const sd of [0.62, -0.62, 1.25, -1.25]) {
        const x = h.x + h.dirX * f + px * sd,
          z = h.z + h.dirZ * f + pz * sd;
        if (!this._hullFits(x, z, h.dirX, h.dirZ, def)) continue;
        let taken = false;
        for (const o of this.list) {
          if (!o.alive || o === self || o.kind !== 'fishing') continue;
          const ox = o.state === 'moored' ? o.x : o.dest?.x,
            oz = o.state === 'moored' ? o.z : o.dest?.z;
          if (ox != null && Math.hypot(ox - x, oz - z) < 0.72) {
            taken = true;
            break;
          }
        }
        if (!taken) return { x, z, berth: true };
      }
    return null;
  },

  // Roads off a full harbour: open water a little way out, deep enough.
  _anchorage(h, def) {
    const nav = this.nav;
    for (let r = 4; r <= 14; r += 2) {
      for (let k = 0; k < 7; k++) {
        const a = Math.atan2(h.dirZ, h.dirX) + (k - 3) * 0.35;
        const x = h.berth.x + Math.cos(a) * r,
          z = h.berth.z + Math.sin(a) * r;
        if (nav.clearAt(x, z) < Math.max(1.5, def.clear || 0)) continue;
        if (!this._hullFits(x, z, Math.cos(a), Math.sin(a), def)) continue;
        if (nav.comp(x, z) !== h.water) continue;
        let busy = false;
        for (const o of this.list) if (o.alive && o.cls === 'sea' && Math.hypot(o.x - x, o.z - z) < (o.def.length + def.length) * 0.6) busy = true;
        if (!busy) return { x, z };
      }
    }
    return null;
  },

  _goHome(v) {
    let h = v.harbour != null ? this.harbourInfo(v.harbour) : null;
    const comp = this.nav.comp(v.x, v.z);
    if (!h || h.kingdom !== v.kingdom || h.water !== comp) {
      h = null;
      let bd = Infinity;
      for (const o of this.harbours(v.kingdom)) {
        if (o.water !== comp) continue;
        const d = Math.hypot(o.berth.x - v.x, o.berth.z - v.z);
        if (d < bd) {
          bd = d;
          h = o;
        }
      }
    }
    if (!h) {
      // no port of its own on these waters: it is laid up far from home
      this.remove(v);
      return false;
    }
    v.harbour = h.id;
    v.home = h.village;
    v.village = h.village;
    if (!v.mission) v.mission = { type: 'home', phase: 'home' };
    v.mission.phase = 'home';
    let spot = this._mooringSpot(h, v);
    if (!spot) {
      // the harbour is full: fishing boats wait in the roads, others are laid up there
      spot = this._anchorage(h, v.def) || h.berth;
      if (v.kind !== 'fishing') v.layup = true;
    }
    if (!this._sail(v, spot)) {
      this.remove(v);
      return false;
    }
    return true;
  },

  _failMission(v) {
    if (v.mission?.phase === 'home' || v.mission?.type === 'home') {
      this.remove(v);
      return;
    }
    this._goHome(v);
  },

  _lawCheck(v) {
    if (!v.alive || v.state === 'sinking') return;
    const lay = !this.law('fleetSailing') || (v.kind === 'galley' && !this.law('fleetNaval'));
    if (lay) {
      v.layup = true;
      if (v.state !== 'moored' && v.mission?.phase !== 'home') this._goHome(v);
      return;
    }
    v.layup = false;
    if (v.mission?.type === 'colony' && v.mission.phase === 'out' && !this.law('fleetColonize')) {
      this.game.events.emit('fleet:aborted', { vessel: v, kind: v.kind, kingdom: v.kingdom, cargo: v.cargo, why: 'fleetColonize' });
      this._goHome(v);
    }
  },

  // ------------------------------------------------------------------ per tick
  _missionTick(v, step, night) {
    const m = v.mission;
    if (v.state === 'moored') {
      v.idleT += step;
      v.speed *= Math.exp(-step * 2);
      // lie alongside the jetty
      const h = v.harbour != null ? this._berths.get(v.harbour) : null;
      if (h) {
        const want = Math.atan2(h.dirZ, h.dirX); // bow to the sea, alongside the jetty
        let d = want - v.heading;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        v.heading += d * Math.min(1, step * 0.35);
      }
      // the rest once a second is plenty for a ship at rest
      if ((v._mt = (v._mt || 0) + step) < 1) return;
      v._mt = 0;
      // shipwrights patch her up in port
      if (v.hp < v.maxHp) v.hp = Math.min(v.maxHp, v.hp + v.maxHp * 0.025);
      v.burning = 0;
      if (v.layup && v.idleT > 4) this.remove(v);
      else if (v.kind !== 'fishing' && (v.idleT > 420 || (v.idleT > 120 && this.count(v.kingdom, v.kind) > 1))) this.remove(v); // idle ships are laid up
      else if (v.harbour != null && !this.harbourInfo(v.harbour)) this.remove(v);
      return;
    }
    if (v.state === 'fish') {
      m.t -= step;
      if (m.t <= 0 || this.storm() > 0.4 || (night && !this.hasTech(v.kingdom, 'astronomy'))) {
        v.cargo = { fish: Math.round((5 + this.rng() * 4) * (this.game.civ?.techMod?.(v.kingdom, 'fish') ?? 1)) };
        this._goHome(v);
      }
      return;
    }
    if (v.state === 'anchored') {
      if (!night) {
        v.state = v.path ? 'sail' : 'moored';
        if (v.state === 'moored') this._goHome(v);
      }
      return;
    }
    if (v.state === 'patrol') return; // war.js drives patrols
    if (v.state === 'sail') {
      // dusk or a storm: small boats run for home
      if (v.kind === 'fishing' && m?.phase === 'out' && (this.storm() > 0.4 || night)) {
        v.cargo = { fish: Math.round(2 + this.rng() * 2) };
        this._goHome(v);
        return;
      }
      // without star charts, ships at sea ride at anchor through the night
      if (night && v.kind !== 'fishing' && this.nav.clearAt(v.x, v.z) >= 2.5 && !v.target) {
        v.state = 'anchored';
        return;
      }
      if (m && m.type === 'patrol') return;
      if (v.stateT > 900) this._failMission(v); // lost its way
    }
  },

  // A vessel reached the end of its route.
  _arrive(v) {
    const m = v.mission;
    if (!m || m.phase === 'home' || m.type === 'home') return this._moor(v);
    if (m.type === 'fish') {
      v.state = 'fish';
      m.t = 8 + this.rng() * 7;
      v.stateT = 0;
      return;
    }
    if (m.type === 'chart') return this._charted(v);
    if (m.type === 'patrol') {
      v.state = 'patrol';
      return;
    }
    // a voyage: deliver the cargo (and put the passengers ashore first)
    const land = v.deliver && this.world.isWalkable(Math.floor(v.deliver.x), Math.floor(v.deliver.z)) ? v.deliver : this._landPoint(v.deliver?.x ?? v.x, v.deliver?.z ?? v.z, v);
    const people = this.aboard(v);
    const cargo = v.cargo ? { ...v.cargo } : {};
    if (people.length) {
      this.disembarkAll(v, land.x, land.z);
      if (cargo.settlers) cargo.settlers = people;
      else if (cargo.army) cargo.army = people;
    }
    const e = { vessel: v, id: v.id, kind: v.kind, kingdom: v.kingdom, from: v.voyage?.fromHarbour ?? v.voyage?.from, to: v.voyage?.toHarbour ?? v.voyage?.to, cargo, x: land.x, z: land.z, landing: { x: v.x, z: v.z }, requested: !!m.requested, passengers: people.length };
    const civ = this.game.civ;
    const civApplies = typeof civ?._onFleetArrived === 'function';
    e.applied = civApplies;
    if (!civApplies) this._applyCargo(e);
    this.game.events.emit('fleet:arrived', e);
    // nobody took them in (no room for a village, no enemy to fight): back aboard, home again
    const home = this.game.civ?.villages?.[v.home];
    const stranded = people.filter((u) => u.alive && u.data?.aboard == null && (cargo.settlers ? u.village === v.home : !u.data?.civ?.army));
    if (stranded.length && home?.alive && this.game.units?.board) for (const u of stranded) this.game.units.board(u, v);
    if (m.type === 'trade') {
      this.totals.trades++;
      // the return cargo: silver for home
      v.cargo = { gold: Math.round(4 + (this.hasTech(v.kingdom, 'banking') ? 4 : 0) + (v.kind === 'carrack' ? 6 : 0)) };
      v.tradeHome = true;
    } else {
      if (m.type === 'colony') this.totals.colonies++;
      v.cargo = null;
    }
    m.phase = 'home';
    this._goHome(v);
  },

  _moor(v) {
    if (this.aboard(v).length) {
      const h = v.harbour != null ? this._berths.get(v.harbour) : null;
      const p = this._landPoint(h ? h.x : v.x, h ? h.z : v.z, v);
      const n = this.disembarkAll(v, p.x, p.z);
      this.game.events.emit('fleet:returned', { vessel: v, id: v.id, kind: v.kind, kingdom: v.kingdom, cargo: v.cargo, x: p.x, z: p.z, aborted: false, passengers: n });
    }
    v.state = 'moored';
    v.stateT = 0;
    v.idleT = 0;
    v.path = null;
    const m = v.mission;
    const civ = this.game.civ;
    const home = civ?.villages?.[v.home];
    if (v.cargo && home?.alive) {
      if (v.cargo.fish) {
        const add = Math.min(v.cargo.fish, Math.max(0, (home.foodCap || 200) * 1.1 - home.food));
        home.food += add;
        this.totals.catches++;
        this.game.events.emit('fleet:delivered', { vehicle: v, kind: v.kind, kingdom: v.kingdom, from: null, to: home.id, cargo: v.cargo });
      } else if (v.tradeHome && v.cargo.gold && !(typeof civ?._onFleetArrived === 'function')) home.gold = (home.gold || 0) + v.cargo.gold;
    }
    v.cargo = null;
    v.tradeHome = false;
    v.mission = null;
    v.voyage = null;
    void m;
  },

  // Cargo delivered, when Civ does not apply it itself.
  _applyCargo(e) {
    const civ = this.game.civ;
    if (!civ) return;
    const c = e.cargo || {};
    if (c.settlers) {
      const id = civ.foundColony ? civ.foundColony(e.kingdom, e.x, e.z, c.settlers) : this._foundColony(e);
      e.colony = id;
      return;
    }
    if (c.army) {
      if (civ.landArmy) civ.landArmy(e.kingdom, e.x, e.z, c.army);
      return;
    }
    const toH = e.to != null && typeof e.to !== 'object' ? this.harbourInfo(e.to) : null;
    const fromH = e.from != null ? this.harbourInfo(e.from) : null;
    const tv = toH ? civ.villages[toH.village] : null;
    const fv = fromH ? civ.villages[fromH.village] : null;
    if (tv?.alive) {
      tv.food += c.food || 0;
      tv.wood += c.wood || 0;
      tv.stone += c.stone || 0;
      tv.gold = (tv.gold || 0) + (c.gold || 0) * 0.5;
    }
    if (tv && fv && tv.kingdom !== fv.kingdom && civ.rel) {
      const r = civ.rel(tv.kingdom, fv.kingdom);
      r.opinion = Math.min(100, (r.opinion || 0) + 2);
    }
  },

  // Settlers come ashore and found a village of their realm (fallback when
  // Civ has no foundColony of its own). Takes the settlers from the home town.
  _foundColony(e) {
    const civ = this.game.civ;
    const K = civ.kingdoms[e.kingdom];
    if (!K?.alive || !civ.foundVillage) return null;
    if (civ._kLaw && !civ._kLaw(K.id, 'civExpansion')) return null;
    const v = e.vessel;
    const from = civ.villages[v?.home];
    const n = Array.isArray(e.cargo.settlers) ? e.cargo.settlers.length : Math.max(4, Math.min(16, e.cargo.settlers | 0));
    // the settlers who boarded leave their old town now
    const units = Array.isArray(e.cargo.settlers) ? e.cargo.settlers.filter((u) => u.alive) : [];
    if (!units.length && from?.alive && from.members) {
      for (const u of from.members) {
        if (units.length >= n) break;
        if (!u.alive || u.job === 'king' || u.job === 'soldier' || u.data?.civ?.army || u.age < 8) continue;
        units.push(u);
      }
    }
    for (const u of units) {
      if (u.data?.aboard != null) this.game.units?.disembark?.(u, e.x, e.z);
      from?.members?.delete(u);
      u.x = u.px = e.x + (this.rng() - 0.5) * 2;
      u.z = u.pz = e.z + (this.rng() - 0.5) * 2;
      this.game.units?.stop?.(u);
      if (u.data?.civ) u.data.civ.task = null;
    }
    const nv = civ.foundVillage(Math.floor(e.x), Math.floor(e.z), { kingdom: K.id, culture: from?.culture || K.culture, units: units.length >= 4 ? units : undefined, settlers: units.length >= 4 ? undefined : n, hallProgress: 0.15, searchR: 10, silent: true });
    if (!nv) {
      // no room ashore: they sail home again
      if (from?.alive) for (const u of units) civ._moveMember?.(u, from);
      return null;
    }
    for (const u of nv.members) if (u.age >= 16 && u.job !== 'king') u.job = 'builder';
    nv.colony = true;
    nv.food += 30;
    nv.wood += 20;
    this.note(`⛵ Settlers of ${this.kname(K.id)} cross the sea and found ${nv.name}`, 'good', { x: nv.cx, z: nv.cz }, 'colony' + nv.id, 1);
    return nv.id;
  },

  // ------------------------------------------------------------------ scheduler
  _kt(kid) {
    this._ktm = this._ktm || new Map();
    let t = this._ktm.get(kid);
    if (!t) this._ktm.set(kid, (t = { trade: -999, colony: this.game.time.total + YEAR * (2 + this.rng() * 4), explore: -999, cart: -999, caravan: -999, galley: -999 }));
    return t;
  },

  _schedule() {
    const g = this.game;
    const civ = g.civ;
    if (!civ?.kingdoms) return;
    // forget berths of buildings that changed
    if ((this._berthSweep = (this._berthSweep || 0) + 1) % 15 === 0) this._berths.clear();
    const sailing = this.law('fleetSailing');
    const civDecides = typeof civ._fleetDecisions === 'function';
    for (const k of civ.kingdoms) {
      if (!k.alive || !k.villages?.length) continue;
      const kid = k.id;
      if (sailing && this.hasTech(kid, 'fishing') && this.auto.fishing) this._scheduleFishing(k);
      if (sailing && this.hasTech(kid, 'sailing')) {
        // Civ decides trade and colonies; when its captains have been idle for
        // years, the fleets keep the sea lanes and the settling going
        const lv = this._lastVoy || (this._lastVoy = { trade: new Map(), colony: -1e9 });
        const now = this.game.time.total;
        const quietTrade = now - (lv.trade.get(kid) ?? -1e9) > 30 * 12 && now > 30 * 15;
        const quietSea = now - lv.colony > 30 * 15 && now > 30 * 20;
        if ((!civDecides || quietTrade) && this.auto.trade) this._scheduleTrade(k);
        if ((!civDecides || quietSea) && this.auto.colonize && this.law('fleetColonize')) this._scheduleColony(k);
        if (this.auto.explore && this.hasTech(kid, 'astronomy')) this._scheduleExplore(k);
        if (this.auto.naval && this.law('fleetNaval') && this.hasTech(kid, 'shipbuilding')) this._scheduleNavy(k);
      }
      this._scheduleLand(k);
    }
  },

  // Each jetty keeps its fishing boats busy by day.
  _scheduleFishing(k) {
    const kid = k.id;
    const civ = this.game.civ;
    const seafaring = civ.hasCultureTrait?.(k.culture, 'Seafaring');
    for (const h of this.harbours(kid)) {
      const want = 2 + (h.level >= 2 ? 1 : 0) + (seafaring ? 1 : 0);
      let have = 0;
      for (const v of this.list) if (v.alive && v.kind === 'fishing' && v.harbour === h.id) have++;
      const now = this.game.time.total;
      if (have < want && !this.blockaded(h) && now - (this._boatT?.get(h.id) ?? -999) > 20 && this.fishCount() < this.budget.fishing && this.count(kid, 'fishing') < this.cap(kid, 'fishing')) {
        (this._boatT || (this._boatT = new Map())).set(h.id, now);
        const spot = this._mooringSpot(h, null, 'fishing');
        if (spot) this.spawn('fishing', kid, spot.x, spot.z, { home: h.village, harbour: h.id, heading: Math.atan2(h.dirZ, h.dirX) });
      }
      if (this.blockaded(h) || this.storm() > 0.4) continue;
      if (this.isNight() && !this.hasTech(kid, 'astronomy') && this.game.settings?.dayNight !== false) continue;
      for (const v of this.list) {
        if (!v.alive || v.kind !== 'fishing' || v.harbour !== h.id || v.state !== 'moored' || v.layup) continue;
        if (v.idleT < 4 + v.seed * 6) continue;
        const spot = this._fishingSpot(h);
        if (!spot) continue;
        v.mission = { type: 'fish', phase: 'out' };
        v.voyage = null;
        if (!this._sail(v, spot)) v.mission = null;
        else break; // one boat out per jetty per beat
      }
    }
  },

  _fishingSpot(h) {
    const nav = this.nav;
    // shoals of fish (the visual schools) draw the boats
    const schools = this.game.unitRenderer?.ambient?.schools;
    if (schools?.length && this.rng() < 0.5) {
      for (const s of schools) {
        if (Math.hypot(s.x - h.berth.x, s.z - h.berth.z) > 16) continue;
        if (nav.clearAt(s.x, s.z) >= 1.2 && nav.comp(s.x, s.z) === h.water) return { x: s.x, z: s.z };
      }
    }
    const base = Math.atan2(h.dirZ, h.dirX);
    for (let t = 0; t < 14; t++) {
      const a = base + (this.rng() - 0.5) * 3.2;
      const r = 4 + this.rng() * 11;
      const x = h.berth.x + Math.cos(a) * r,
        z = h.berth.z + Math.sin(a) * r;
      const c = nav.clearAt(x, z);
      if (c < 1.0 || c > 9) continue;
      if (nav.comp(x, z) !== h.water) continue;
      return { x, z };
    }
    return null;
  },

  // Trading cogs between friendly harbours (when Civ does not decide trade).
  _scheduleTrade(k) {
    const kid = k.id;
    const t = this._kt(kid);
    const now = this.game.time.total;
    if (now - t.trade < 22) return;
    t.trade = now;
    const civ = this.game.civ;
    let busy = 0;
    for (const v of this.list) if (v.alive && v.kingdom === kid && (v.kind === 'cog' || v.kind === 'carrack') && v.mission) busy++;
    if (busy >= this.cap(kid, 'cog')) return;
    const mine = this.harbours(kid).filter((h) => !this.blockaded(h));
    if (!mine.length) return;
    const from = mine[Math.floor(this.rng() * mine.length)];
    let best = null,
      bs = -Infinity;
    for (const o of civ.kingdoms) {
      if (!o.alive || this.atWar(o.id, kid)) continue;
      let op = 40;
      if (o.id !== kid) {
        const r = civ.relations?.get?.(kid < o.id ? kid * 4096 + o.id : o.id * 4096 + kid);
        op = (r?.opinion ?? 0) + (r?.ally ? 30 : 0);
        if (op < -5) continue;
      }
      for (const h of this.harbours(o.id)) {
        if (h.id === from.id || h.water !== from.water) continue;
        const d = Math.hypot(h.berth.x - from.berth.x, h.berth.z - from.berth.z);
        if (d < 22) continue;
        const sc = op + (h.landId !== from.landId ? 25 : 0) + (o.id !== kid ? 10 : 0) - d * 0.15 + this.rng() * 15;
        if (sc > bs) {
          bs = sc;
          best = h;
        }
      }
    }
    if (!best) return;
    const fv = civ.villages[from.village];
    if (!fv?.alive) return;
    const cargo = { gold: 6 + (this.hasTech(kid, 'banking') ? 6 : 0), trade: true };
    for (const r of ['food', 'wood', 'stone']) {
      const amt = Math.floor(Math.min(14, Math.max(0, (fv[r] || 0) - (r === 'food' ? fv.pop * 3 + 30 : 30)) * 0.25));
      if (amt > 0) {
        cargo[r] = amt;
        fv[r] -= amt;
      }
    }
    const kind = this.hasTech(kid, 'navigation') && Math.hypot(best.x - from.x, best.z - from.z) > 90 ? 'carrack' : 'cog';
    this.requestVoyage({ kind, kingdom: kid, from: from.id, to: best.id, cargo, _self: true });
  },

  // Settlers across the water (when Civ does not decide colonies).
  _scheduleColony(k) {
    const kid = k.id;
    const civ = this.game.civ;
    const t = this._kt(kid);
    const now = this.game.time.total;
    if (now - t.colony < YEAR * 14) return;
    t.colony = now - YEAR * 10; // try again in a few years if nothing comes of it
    if (civ._kLaw && !civ._kLaw(kid, 'civExpansion')) return;
    const alive = civ.villages.filter((v) => v.alive).length;
    if (civ.budget && alive >= civ.budget.villages) return;
    if (this.list.some((v) => v.alive && v.kingdom === kid && v.mission?.type === 'colony')) return;
    const mine = this.harbours(kid).filter((h) => {
      const v = civ.villages[h.village];
      return v?.alive && v.pop >= 16 && v.food > 40 && !this.blockaded(h);
    });
    if (!mine.length) return;
    const from = mine[Math.floor(this.rng() * mine.length)];
    const range = Math.max(this.range(kid, 'transport'), this.hasTech(kid, 'astronomy') ? this.range(kid, 'explorer') : 0);
    const site = this.overseasSite(from, range);
    if (!site) return;
    const fv = civ.villages[from.village];
    fv.food -= 20;
    const ok = this.requestVoyage({ kind: 'transport', kingdom: kid, from: from.id, to: site, cargo: { settlers: 8, colony: true }, _self: true });
    if (ok) t.colony = now;
  },

  // An empty, fertile shore on another landmass, reachable over this water.
  overseasSite(h, range = Infinity) {
    const civ = this.game.civ;
    const nav = this.nav;
    const w = this.world;
    const W = w.w;
    const n = nav.cw * nav.ch;
    let best = null,
      bs = -Infinity,
      scored = 0;
    // land without a single village is the prize (the empty continents)
    const settled = new Set();
    for (const v of civ.villages) if (v.alive && v.landId != null) settled.add(v.landId);
    for (let t = 0; t < 900 && scored < 60; t++) {
      const c = Math.floor(this.rng() * n);
      if (nav.compOf[c] !== h.water || nav.nd[c] > 3) continue;
      const cx = nav.nx[c],
        cz = nav.nz[c];
      const dd = Math.hypot(cx - h.berth.x, cz - h.berth.z);
      if (dd < 25 || dd > range * 0.85) continue;
      // a land tile a few steps inland
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + this.rng();
        const tx = Math.floor(cx + Math.cos(a) * (4 + this.rng() * 4)),
          tz = Math.floor(cz + Math.sin(a) * (4 + this.rng() * 4));
        if (!w.inBounds(tx, tz)) continue;
        const i = tz * W + tx;
        if (w.height[i] < SEA_LEVEL + 0.2 || w.owner[i] >= 0) continue;
        if (civ.landId && civ.landId[i] === h.landId) continue;
        const ty = w.type[i];
        if (ty === TILE.SNOW || ty === TILE.ROCK || ty === TILE.LAVA || ty === TILE.ICE || ty === TILE.DESERT) continue;
        if (civ.villages.some((v) => v.alive && Math.hypot(v.cx - tx, v.cz - tz) < 24)) continue;
        scored++;
        const s = civ._scoreSite ? civ._scoreSite(tx, tz, { minSpace: 85 }) : 100;
        if (s < 0) continue;
        const land = civ.landId ? civ.landId[i] : -1;
        const empty = land >= 0 && !settled.has(land);
        const sc = s - dd * 0.15 + this.rng() * 20 + (empty ? 80 + Math.min(80, (civ._landSizes?.get?.(land) || 0) / 400) : 0);
        if (sc > bs) {
          bs = sc;
          best = { x: tx + 0.5, z: tz + 0.5 };
        }
        break;
      }
    }
    return best;
  },

  // Exploration ships chart far waters (Astronomy).
  _scheduleExplore(k) {
    const kid = k.id;
    const t = this._kt(kid);
    const now = this.game.time.total;
    if (now - t.explore < 40) return;
    if (this.list.some((v) => v.alive && v.kingdom === kid && v.mission?.type === 'chart')) return;
    t.explore = now;
    const mine = this.harbours(kid).filter((h) => !this.blockaded(h));
    if (!mine.length || this.seaCount() >= this.budget.sea) return;
    const from = mine[Math.floor(this.rng() * mine.length)];
    const nav = this.nav;
    const charts = this.charts.get(kid) || new Set();
    const n = nav.cw * nav.ch;
    const far = Math.max(this.world.w, this.world.h) * 0.25;
    let best = null,
      bs = -Infinity;
    for (let i = 0; i < 300; i++) {
      const c = Math.floor(this.rng() * n);
      if (nav.compOf[c] !== from.water) continue;
      const d = Math.hypot(nav.nx[c] - from.berth.x, nav.nz[c] - from.berth.z);
      if (d < far * 0.6) continue;
      const sc = Math.min(d, far * 2) + (charts.has(c) ? -200 : 0) + (nav.nd[c] < 4 ? 40 : 0) + this.rng() * 40;
      if (sc > bs) {
        bs = sc;
        best = c;
      }
    }
    if (best == null) return;
    let v = this.list.find((s) => s.alive && s.kind === 'explorer' && s.kingdom === kid && s.state === 'moored' && !s.mission);
    if (!v) {
      if (this.count(kid, 'explorer') >= this.cap(kid, 'explorer')) return;
      v = this.spawn('explorer', kid, from.berth.x, from.berth.z, { home: from.village, harbour: from.id, heading: Math.atan2(from.dirZ, from.dirX) });
    }
    v.mission = { type: 'chart', phase: 'out', cell: best };
    v.voyage = { from: from.village, fromHarbour: from.id, to: { x: nav.nx[best], z: nav.nz[best] }, fromName: from.name, toName: 'uncharted waters', t0: now };
    const p = nav.findPath(v.x, v.z, nav.nx[best], nav.nz[best], { big: true, maxLen: this.range(kid, 'explorer'), minClear: KINDS.explorer.clear });
    if (!p) {
      v.mission = null;
      v.voyage = null;
      return;
    }
    v.dest = { x: nav.nx[best], z: nav.nz[best] };
    this.setPath(v, p);
    v.state = 'sail';
  },

  _charted(v) {
    const kid = v.kingdom;
    const nav = this.nav;
    let set = this.charts.get(kid);
    if (!set) this.charts.set(kid, (set = new Set()));
    const before = set.size;
    const R = 6;
    const c0 = nav.cellAt(v.x, v.z);
    const cx = c0 % nav.cw,
      cy = (c0 / nav.cw) | 0;
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const x = cx + dx,
          y = cy + dy;
        if (x < 0 || y < 0 || x >= nav.cw || y >= nav.ch) continue;
        set.add(y * nav.cw + x);
      }
    if (set.size > before + 20) {
      const first = before === 0;
      const where = this._placeName(v.x, v.z);
      const n = this.kname(kid);
      this.note(`🧭 Explorers of ${n} chart ${first ? 'the far coasts of ' : ''}${where}`, 'good', { x: v.x, z: v.z }, 'chart' + kid, first ? 1 : 240);
    }
    v.mission.phase = 'home';
    v.voyage && (v.voyage.toName = 'home');
    this._goHome(v);
  },

  // War galleys: launched while the realm is at war (war.js runs the patrols).
  _scheduleNavy(k) {
    const kid = k.id;
    const civ = this.game.civ;
    const enemies = civ.enemiesOf?.(kid) || [];
    const t = this._kt(kid);
    const now = this.game.time.total;
    if (!enemies.length) return;
    if (now - t.galley < 45) return;
    t.galley = now;
    // a war worth a fleet: it has lasted a year or more
    const rel = (e) => civ.relations?.get?.(kid < e ? kid * 4096 + e : e * 4096 + kid);
    if (!enemies.some((e) => now - (rel(e)?.warSince ?? now) > 30)) return;
    if (this.count(kid, 'galley') >= this.cap(kid, 'galley') || this.seaCount() >= this.budget.sea) return;
    // the harbour nearest an enemy port on the same water
    let best = null,
      bd = Infinity;
    const theirs = [];
    for (const e of enemies) for (const h of this.harbours(e)) theirs.push(h);
    for (const h of this.harbours(kid)) {
      if (this.blockaded(h)) continue;
      for (const o of theirs) {
        if (o.water !== h.water) continue;
        const d = Math.hypot(o.berth.x - h.berth.x, o.berth.z - h.berth.z);
        if (d < bd) {
          bd = d;
          best = h;
        }
      }
    }
    // no enemy port on our waters: no fleet (their ships passing by are not a war at sea)
    if (!best) return;
    const v = this.spawn('galley', kid, best.berth.x, best.berth.z, { home: best.village, harbour: best.id, heading: Math.atan2(best.dirZ, best.dirX) });
    v.mission = { type: 'patrol', phase: 'out', t: 0 };
    v.state = 'patrol';
  },
};
