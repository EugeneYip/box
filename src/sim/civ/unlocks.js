import { TILE, SEA_LEVEL } from '../../world/constants.js';
import { BUILDING_TYPES } from './catalog.js';
import { USE, YEAR, ADULT_AGE, SPIRAL, spiralCount } from './util.js';

// Tangible technology (docs/TECH-UNLOCKS.md, the parts marked Civ): the
// buildings each technology adds, surveyed roads and stone bridges, healers,
// cavalry and messengers, watchtowers that shoot, the chronicle of each
// realm's first use of an unlock, and the decisions that use the Fleets
// module (harbours, trade, colonies and landings). Every Fleets call is
// optional (game.fleet?.) so the simulation runs without it.

// "The Kingdom of X ..." — the first time a realm uses an unlock
const FIRST = {
  barn: 'raises its first farmstead barn',
  kiln: 'fires its first kiln',
  docks: 'builds its first fishing jetty',
  harbour: 'opens its first harbour',
  waterwheel: 'turns its first water wheel by the fields',
  stables: 'opens its first stables',
  bloomery: 'lights its first bloomery',
  healer: "opens its first healer's house",
  shipyard: 'lays a keel in its first shipyard',
  foundry: 'pours steel in its first foundry',
  forum: 'gathers its citizens in its first forum',
  markethall: 'opens its first market hall',
  watermill: 'turns its first watermill',
  windmill: 'raises its first windmill',
  bridge: 'spans a river with its first stone bridge',
  library: 'opens its first library',
  observatory: 'raises its first observatory',
  aqueduct: 'builds its first aqueduct',
  walls: 'raises its first town walls',
  workshop: 'lights its first forge',
  road: "lays its first surveyed road between its villages",
  square: 'paves its first village square',
  cavalry: 'musters its first cavalry',
  messenger: 'sends out its first mounted messenger',
  healers: 'sends its first healer among the sick',
  archers: "sees its watchtowers' archers drive off raiders",
  trade: 'completes its first sea trade',
  colony: 'founds its first colony across the sea',
  landing: 'lands an army from the sea',
  crane: 'raises its first building crane',
};

export const unlocks = {
  _firstUse(k, key, pos = null) {
    if (!k || !k.alive) return false;
    const f = k.firsts || (k.firsts = new Set());
    if (f.has(key)) return false;
    f.add(key);
    const what = FIRST[key];
    if (what) this._note(`✨ ${/^the /i.test(k.name) ? k.name : 'The ' + k.name} ${what}`, 'good', pos || this._kingdomPos?.(k), 'first' + k.id + key, 1);
    return true;
  },

  // a finished building may be a realm's first of its kind
  _firstBuild(b) {
    const k = this.kingdoms[b.kingdom];
    if (!k) return;
    let key = b.type;
    if (b.type === 'market' && b.level >= 2) key = 'markethall';
    else if (b.type === 'docks' && b.level >= 2) key = 'harbour';
    else if (BUILDING_TYPES[b.type]?.wall) key = 'walls';
    if (b.type === 'workshop' && b.level < 2) return;
    if (FIRST[key]) this._firstUse(k, key, { x: b.x, z: b.z });
  },

  // ------------------------------------------------------------ building plan
  // Called from _plan with its helpers; each unlock is built once its tech is
  // known, within the building budget (one per town, the rarer ones once per
  // realm), so the world shows what a people has learned.
  _planUnlocks(v, K, room, build, upgrade, count, crowded) {
    if (!K) return;
    const kid = K.id;
    const has = (t) => this.hasTech(kid, t);
    const pop = v.pop;
    const town = v.tier >= 1;
    const isCap = K.capital === v.id;
    const realmHas = (type) => this.buildings.some((b) => b.alive && b.kingdom === kid && b.type === type);
    const tight = crowded > 0.97 && !town;
    if (tight) return;
    if (room() && has('agriculture') && v.fieldCount >= 14 && count('barn') === 0 && v.wood > 24) build('barn', () => this.placeAlongRoad(v, 'barn', this._bias(v, 'granary')));
    if (room() && has('pottery') && pop >= 12 && count('kiln') === 0 && v.wood > 10) build('kiln');
    if (room() && has('irrigation') && v.fieldCount >= 18 && count('waterwheel') === 0) build('waterwheel', () => this._placeByWater(v, 'waterwheel'));
    if (room() && has('horsemanship') && town && count('stables') === 0 && v.wood > 26) build('stables', () => this._placeOutskirts(v, 'stables', 3, v.buildRadius, null, null));
    if (room() && has('ironworking') && (isCap || town) && count('bloomery') === 0 && !realmHas('bloomery')) build('bloomery');
    if (room() && has('medicine') && (town || pop >= 24) && count('healer') === 0) build('healer');
    if (room() && has('shipbuilding') && v.coastal && count('docks') > 0 && !realmHas('shipyard')) build('shipyard', () => this._placeDocks(v, 'shipyard'));
    if (room() && has('steelworking') && (isCap || v.tier >= 2) && !realmHas('foundry')) build('foundry');
    if (room() && has('philosophy') && isCap && count('forum') === 0 && v.stone > 60) build('forum', () => this._placeOutskirts(v, 'forum', 3, v.buildRadius, null, null));
    if (room() && has('engineering') && town && count('watermill') === 0) build('watermill', () => this._placeByWater(v, 'watermill'));
    if (room() && has('banking')) {
      const m = v.buildings.find((b) => b.alive && b.type === 'market' && !b.constructing && !b.upgrading && b.level < 2);
      if (m) upgrade(m);
    }
    // masonry: a paved square before the hall
    if (has('masonry') && pop >= 14 && !v.squarePaved && v.hall && !v.hall.constructing) this._paveSquare(v, K);
  },

  // A small building on the bank of a river or lake near the fields.
  _placeByWater(v, type) {
    const w = this.world;
    const W = w.w;
    const def = BUILDING_TYPES[type];
    const n = spiralCount(Math.min(SPIRAL[SPIRAL.length - 1][2], v.buildRadius + 8));
    const cx = Math.floor(v.cx),
      cy = Math.floor(v.cz);
    for (let k = 0; k < n; k++) {
      const [dx, dy, d] = SPIRAL[k];
      if (d < 3) continue;
      const x = cx + dx,
        y = cy + dy;
      if (!this._footprintOK(x, y, def.w, def.h, 1.3)) continue;
      let water = 0;
      for (let yy = y - 1; yy <= y + def.h; yy++)
        for (let xx = x - 1; xx <= x + def.w; xx++) {
          if (!w.inBounds(xx, yy)) continue;
          const h = w.height[yy * W + xx];
          if (h < SEA_LEVEL && h > SEA_LEVEL - 2.5) water++;
        }
      if (water < 2) continue;
      const b = this.addBuilding(v, type, x, y, this.rng.int(0, 3));
      this._connectToRoads?.(v, Math.floor(b.doorX), Math.floor(b.doorZ));
      return b;
    }
    return null;
  },

  // Masonry: the ground before the hall is paved as a square.
  _paveSquare(v, K) {
    v.squarePaved = true;
    if (!this.law('civRoads')) return;
    const h = v.hall;
    const cx = Math.floor(h.doorX),
      cz = Math.floor(h.doorZ);
    let n = 0;
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx,
          z = cz + dz;
        if (!this.world.inBounds(x, z)) continue;
        const i = z * this.world.w + x;
        const u = this.use[i];
        if (u !== USE.FREE && u !== USE.ROAD) continue;
        if (this.layRoad(v, i)) n++;
      }
    if (n >= 8) this._firstUse(K, 'square', { x: h.doorX, z: h.doorZ });
  },

  // ------------------------------------------------------------ the realm at large
  // Every 2 s: roads, roles, healers' reach, fleets; towers shoot every second.
  _unlockTick(dt) {
    const now = this.game.time.total;
    for (const k of this.kingdoms) {
      if (!k.alive || !k.villages.length) continue;
      if (this.hasTech(k.id, 'mathematics') && now - (k.roadT || 0) > 25) {
        k.roadT = now;
        this._surveyRoad(k);
      }
      if (this.hasTech(k.id, 'horsemanship')) this._riders(k);
      if (this.hasTech(k.id, 'sailing') && now - (k.fleetT || 0) > 12) {
        k.fleetT = now;
        this._fleetDecisions(k);
      }
    }
  },

  // Mathematics: a straight surveyed road from the capital to a village of the
  // realm (Architecture lets it cross rivers on stone bridges).
  _surveyRoad(k) {
    const cap = this.villages[k.capital];
    if (!cap?.alive || !this.law('civRoads')) return;
    const linked = k.roadLinks || (k.roadLinks = new Set());
    let best = null,
      bd = Infinity;
    for (const vid of k.villages) {
      const v = this.villages[vid];
      if (!v?.alive || v === cap || linked.has(vid) || v.landId !== cap.landId) continue;
      const d = Math.hypot(v.cx - cap.cx, v.cz - cap.cz);
      if (d < bd && d < 80) (bd = d), (best = v);
    }
    if (!best) return;
    linked.add(best.id);
    const w = this.world;
    const W = w.w;
    const bridges = this.hasTech(k.id, 'architecture');
    // walk the straight line, from the edge of one town to the edge of the other
    const x0 = Math.floor(cap.cx),
      y0 = Math.floor(cap.cz),
      x1 = Math.floor(best.cx),
      y1 = Math.floor(best.cz);
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    const line = [];
    let water = [];
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(x0 + ((x1 - x0) * s) / steps),
        y = Math.round(y0 + ((y1 - y0) * s) / steps);
      if (!w.inBounds(x, y)) return;
      const i = y * W + x;
      if (line.length && line[line.length - 1].i === i) continue;
      const wet = w.height[i] < SEA_LEVEL;
      if (wet) {
        water.push(i);
        if (water.length > 5 || !bridges || w.height[i] < SEA_LEVEL - 2.6) return; // no fords or bridges here
        line.push({ i, x, y, wet: true });
        continue;
      }
      water = [];
      // steep slopes defeat the surveyors
      const t = w.type[i];
      if (t === TILE.ROCK || t === TILE.SNOW || t === TILE.LAVA) return;
      line.push({ i, x, y, wet: false });
    }
    let roads = 0,
      spans = 0;
    for (const p of line) {
      const nearCap = Math.hypot(p.x - cap.cx, p.y - cap.cz) < cap.radius * 0.7;
      const nearV = Math.hypot(p.x - best.cx, p.y - best.cz) < best.radius * 0.7;
      if (nearCap || nearV) continue; // inside the towns the streets already run
      if (p.wet) {
        if (this.use[p.i] === USE.BUILDING) continue;
        const v = Math.hypot(p.x - cap.cx, p.y - cap.cz) < Math.hypot(p.x - best.cx, p.y - best.cz) ? cap : best;
        const b = this.addBuilding(v, 'bridge', p.x, p.y, Math.abs(x1 - x0) > Math.abs(y1 - y0) ? 1 : 0, { noFlatten: true });
        b.y = SEA_LEVEL + 0.12;
        b.groundMin = Math.min(w.height[p.i], SEA_LEVEL - 0.5);
        if (w.building[p.i] === b.id) w.building[p.i] = -1; // the deck is walkable
        this.use[p.i] = USE.ROAD;
        this._completeInstantly?.(b);
        spans++;
        continue;
      }
      const u = this.use[p.i];
      if (u === USE.BUILDING || u === USE.RUIN || u === USE.PLOT) continue;
      const v = Math.hypot(p.x - cap.cx, p.y - cap.cz) < Math.hypot(p.x - best.cx, p.y - best.cz) ? cap : best;
      if (this.layRoad(v, p.i)) roads++;
    }
    if (roads > 6) this._firstUse(k, 'road', { x: (cap.cx + best.cx) / 2, z: (cap.cz + best.cz) / 2 });
    if (spans) {
      this._firstUse(k, 'bridge', { x: (cap.cx + best.cx) / 2, z: (cap.cz + best.cz) / 2 });
      this.version++;
    }
    this.fieldVersion++;
  },

  // Horsemanship: a third of a stabled town's soldiers ride; one messenger per realm.
  _riders(k) {
    let cav = 0;
    for (const vid of k.villages) {
      const v = this.villages[vid];
      if (!v?.alive || !v.buildings.some((b) => b.alive && b.type === 'stables' && !b.constructing)) continue;
      let i = 0;
      for (const u of v.members) {
        if (!u.alive || u.job !== 'soldier') continue;
        const ride = i++ % 3 === 0;
        if (ride && u.data.role !== 'cavalry') {
          u.data.role = 'cavalry';
          u.data.mounted = true;
          u.data.speedMul = Math.max(u.data.speedMul || 1, 1.45);
        }
        if (u.data.role === 'cavalry') cav++;
      }
    }
    if (cav) this._firstUse(k, 'cavalry');
    // a mounted messenger rides between the capital and the realm's towns
    const cap = this.villages[k.capital];
    if (!cap?.alive || k.villages.length < 2) return;
    const m = this.game.units.byId.get(k.messenger);
    if (m && m.alive && m.kingdom === k.id && m.job === 'messenger') return;
    for (const u of cap.members) {
      if (!u.alive || u.age < ADULT_AGE + 2 || u.age > 45 || u.job === 'king' || u.job === 'soldier' || u.data?.civ?.army) continue;
      this._setJob(u, 'messenger');
      u.data.role = 'messenger';
      u.data.mounted = true;
      u.data.speedMul = 1.6;
      k.messenger = u.id;
      this._firstUse(k, 'messenger', { x: u.x, z: u.z });
      break;
    }
  },

  // Fortification: towers and gatehouses with archers shoot at raiders: the
  // soldiers of realms at war, monsters and beasts that come too close.
  _towerTick() {
    const U = this.game.units;
    if (!U?.nearest || !U.damage) return;
    const now = this.game.time.total;
    let shots = 0;
    for (const b of this.buildings) {
      if (shots > 24) break;
      if (!b.alive || b.constructing || (b.type !== 'watchtower' && b.type !== 'gate')) continue;
      if (now - (b.shotT || 0) < 2.2) continue;
      const k = this.kingdoms[b.kingdom];
      if (!k?.alive || !(this.hasTech(k.id, 'fortification') || b.type === 'watchtower')) continue;
      const foe = U.nearest(b.x, b.z, 7, (o) => o.alive && (o.def?.kind === 'monster' || (o.def?.kind === 'animal' && o.def?.diet === 'carnivore' && o.def?.mass >= 1) || (o.species === 'human' && o.kingdom >= 0 && o.kingdom !== b.kingdom && this.atWar(o.kingdom, b.kingdom))));
      if (!foe) continue;
      b.shotT = now;
      shots++;
      U.damage(foe, (foe.species === 'human' ? 2.5 : 6) + this.rng.next() * 3, null, { cause: 'arrow' });
      this._fx('sparks', foe.x, foe.z, 0.45, true);
      this._sfx?.('chop', b.x, b.z, 4);
      if (foe.species !== 'human' || !foe.alive) this._firstUse(k, 'archers', { x: b.x, z: b.z });
    }
  },

  // ------------------------------------------------------------ Fleets
  // Harbour sites of a realm, for the Fleets module: the water point before
  // each finished jetty or harbour.
  harbours(kingdomId) {
    const out = [];
    for (const b of this.buildings) {
      if (!b.alive || b.constructing || b.type !== 'docks' || b.kingdom !== kingdomId) continue;
      const v = this.villages[b.village];
      const dx = b.doorX - b.x,
        dz = b.doorZ - b.z;
      const L = Math.hypot(dx, dz) || 1;
      // the jetty's door faces the land; the water lies behind it
      out.push({ id: b.id, building: b.id, village: b.village, kingdom: kingdomId, level: b.level, harbour: b.level >= 2, x: b.x - (dx / L) * 2.2, z: b.z - (dz / L) * 2.2, landId: v?.landId ?? -1 });
    }
    return out;
  },

  // A transport has landed settlers: found a village of the realm there.
  foundColony(kingdomId, x, z, settlers = 8) {
    const K = this.kingdoms[kingdomId];
    if (!K || !K.alive || !this._kLaw?.(kingdomId, 'civExpansion')) return null;
    if (this.villages.filter((v) => v.alive).length >= this.budget.villages + 2) return null;
    const n = Array.isArray(settlers) ? settlers.length : Math.max(4, Math.min(16, settlers | 0 || 8));
    const opts = { kingdom: kingdomId, culture: K.culture, settlers: n, units: Array.isArray(settlers) ? settlers : undefined, starter: true, houses: 2, silent: true, searchR: 9 };
    // the settlers come ashore: the village stands on dry land near the landing
    let v = this.foundVillage(Math.floor(x), Math.floor(z), opts);
    if (!v) v = this.foundVillage(Math.floor(x), Math.floor(z), { ...opts, searchR: 16 });
    if (!v) return null;
    v.colony = true;
    this._firstUse(K, 'colony', { x: v.cx, z: v.cz });
    this._note(`⛵ Settlers of ${this._kn(K)} found ${v.name} across the sea`, 'good', { x: v.cx, z: v.cz }, 'colony' + v.id, 1);
    return v.id;
  },

  // A transport has landed an army: it marches on the nearest enemy town there.
  landArmy(kingdomId, x, z, soldiers = 10) {
    const K = this.kingdoms[kingdomId];
    if (!K?.alive) return null;
    const enemies = this.enemiesOf(kingdomId);
    if (!enemies.length) return null;
    const w = this.world;
    const tx = Math.floor(x),
      tz = Math.floor(z);
    if (!w.inBounds(tx, tz)) return null;
    const land = this.landId?.[tz * w.w + tx];
    let target = null,
      td = Infinity;
    for (const e of enemies)
      for (const vid of this.kingdoms[e].villages) {
        const ev = this.villages[vid];
        if (!ev?.alive || (land != null && ev.landId !== land)) continue;
        const d = Math.hypot(ev.cx - x, ev.cz - z);
        if (d < td) (td = d), (target = ev);
      }
    if (!target) return null;
    const home = this.villages[K.capital];
    if (!home?.alive) return null;
    const units = [];
    if (Array.isArray(soldiers)) {
      for (const u of soldiers) if (u?.alive) units.push(u);
    } else {
      for (let i = 0; i < Math.min(18, soldiers | 0); i++) {
        const u = this.spawnHuman(home, x + this.rng.float(-1.5, 1.5), z + this.rng.float(-1.5, 1.5), { age: this.rng.float(18, 32), sex: 'm' });
        if (!u) continue;
        this._setJob(u, 'soldier');
        units.push(u);
      }
    }
    if (!units.length) return null;
    const army = { id: this._nextArmy++, kingdom: kingdomId, enemy: target.kingdom, target: target.id, home: home.id, landId: target.landId, state: 'march', units: new Set(), rally: { x, z }, t: this.game.time.total, announced: true, size0: units.length };
    for (const u of units) {
      army.units.add(u);
      u.data.civ.army = army.id;
      u.data.civ.task = null;
    }
    army.bearer = units[0].id;
    this.armies.push(army);
    this._firstUse(K, 'landing', { x, z });
    this._note(`⚓ ${this._kn(K)} lands an army (${units.length}) near ${target.name}`, 'war', { x, z }, 'landing' + army.id, 1);
    return army.id;
  },

  // Fleets reports a voyage's end: apply the cargo.
  _onFleetArrived(e) {
    if (!e) return;
    const c = e.cargo || {};
    const kid = e.kingdom ?? e.vessel?.kingdom;
    const K = this.kingdoms[kid];
    if (!K) return;
    const x = e.x ?? e.to?.x ?? e.vessel?.x,
      z = e.z ?? e.to?.z ?? e.vessel?.z;
    if (c.settlers) return this.foundColony(kid, x, z, c.settlers);
    if (c.army) return this.landArmy(kid, x, z, c.army);
    // trade: the goods are sold at the far harbour; both towns prosper
    const toB = this._bById?.get(typeof e.to === 'object' ? e.to?.id : e.to);
    const fromB = this._bById?.get(typeof e.from === 'object' ? e.from?.id : e.from);
    const tv = toB ? this.villages[toB.village] : null;
    const fv = fromB ? this.villages[fromB.village] : this.villages[K.capital];
    const gold = c.gold ?? 6;
    if (tv) {
      tv.food += c.food || 0;
      tv.wood += c.wood || 0;
      tv.stone += c.stone || 0;
      tv.gold += gold * 0.5;
      tv.tradeLinks = Math.min(6, (tv.tradeLinks || 0) + 0.5);
    }
    if (fv) {
      fv.gold += gold;
      fv.tradeLinks = Math.min(6, (fv.tradeLinks || 0) + 0.5);
    }
    if (tv && fv && tv.kingdom !== fv.kingdom) {
      const r = this.rel(tv.kingdom, fv.kingdom);
      r.opinion = Math.min(100, r.opinion + 3); // trade partners grow close
    }
    this._firstUse(K, 'trade', { x, z });
  },

  // The realm's captains: trade with friends, colonise empty shores, invade
  // enemies across the water. Fleets runs the ships; Civ decides the voyages
  // (Fleets leaves its own trade and colony AI off while this exists).
  _fleetDecisions(k) {
    const F = this.game.fleet;
    if (!F?.requestVoyage) return;
    const mine = (F.harbours ? F.harbours(k.id) : this.harbours(k.id)).filter((h) => !F.blockaded?.(h));
    if (!mine.length) return;
    const now = this.game.time.total;
    const from = mine[(this.rng.next() * mine.length) | 0];
    const fv = this.villages[from.village];
    if (!fv?.alive) return;
    const sameSea = (h) => from.water == null || h.water == null || h.water === from.water;
    // trade with a friendly realm's harbour on the same waters
    if (now - (k.tradeT || 0) > YEAR * 1.2 && fv.food > 30) {
      k.tradeT = now - YEAR * 0.8; // a refused voyage is tried again soon
      let best = null,
        bs = -Infinity;
      for (const o of this.kingdoms) {
        if (!o.alive || o === k || this.atWar(o.id, k.id)) continue;
        const r = this.relations.get(this._relKeyOf(o.id, k.id));
        const op = r?.opinion ?? 0;
        if (op < -10 && !r?.ally) continue;
        for (const h of F.harbours ? F.harbours(o.id) : this.harbours(o.id)) {
          if (!sameSea(h)) continue;
          const d = Math.hypot(h.x - from.x, h.z - from.z);
          const sc = op + (r?.ally ? 30 : 0) - d * 0.08 + this.rng.next() * 10;
          if (sc > bs) (bs = sc), (best = h);
        }
      }
      // with no foreign partner, ships still carry goods between the realm's own ports
      if (!best && mine.length > 1) best = mine.find((h) => h !== from && sameSea(h) && h.village !== from.village) || null;
      if (best) {
        const kind = this.hasTech(k.id, 'navigation') ? 'carrack' : 'cog';
        const ok = F.requestVoyage({ kind, kingdom: k.id, from: from.id, to: best.id, cargo: { gold: 8 + (this.hasTech(k.id, 'banking') ? 6 : 0), food: 12, wood: 6, trade: true } });
        if (ok) {
          k.tradeT = now;
          fv.food -= 10;
        }
      }
    }
    // colonise an empty shore across the water
    if (this.law('fleetColonize') !== false && this._kLaw(k.id, 'civExpansion') && now - (k.colonyT || 0) > YEAR * 12 && fv.pop >= 16 && fv.food > 50) {
      const alive = this.villages.filter((v) => v.alive).length;
      if (alive < this.budget.villages) {
        k.colonyT = now - YEAR * 8; // try again in a few years if nothing comes of it
        const range = F.range ? Math.max(F.range(k.id, 'transport'), this.hasTech(k.id, 'astronomy') ? F.range(k.id, 'explorer') : 0) : Infinity;
        const site = F.overseasSite ? F.overseasSite(from, range) : this._overseasSite(from);
        if (site) {
          const kind = this.hasTech(k.id, 'navigation') ? 'carrack' : 'transport';
          const ok = F.requestVoyage({ kind, kingdom: k.id, from: from.id, to: { x: site.x, z: site.z }, cargo: { settlers: 8, colony: true } });
          if (ok) {
            k.colonyT = now;
            fv.food -= 30;
            fv.wood = Math.max(0, fv.wood - 20);
          }
        }
      }
    }
    // carry an army across the water to an enemy out of reach by land
    if (now - (k.invadeT || 0) > YEAR * 5) {
      for (const e of this.enemiesOf(k.id)) {
        const E = this.kingdoms[e];
        if (!E?.alive || this._reachable(k, E)) continue;
        let tgt = null;
        for (const h of F.harbours ? F.harbours(e) : this.harbours(e)) if (!tgt && sameSea(h)) tgt = h;
        if (!tgt) {
          const ev = this.villages[E.capital];
          if (ev?.alive) tgt = this._coastNear(ev);
        }
        if (!tgt) continue;
        k.invadeT = now - YEAR * 3;
        const ok = F.requestVoyage({ kind: 'transport', kingdom: k.id, from: from.id, to: { x: tgt.x, z: tgt.z }, cargo: { army: 10, target: e } });
        if (ok) {
          k.invadeT = now;
          break;
        }
      }
    }
  },

  _relKeyOf(a, b) {
    return a < b ? a * 4096 + b : b * 4096 + a;
  },

  // An unowned, fertile coastal spot on a different landmass.
  _overseasSite(from) {
    const w = this.world;
    for (let t = 0; t < 120; t++) {
      const x = 3 + Math.floor(this.rng.next() * (w.w - 6)),
        z = 3 + Math.floor(this.rng.next() * (w.h - 6));
      const i = z * w.w + x;
      if (w.height[i] < SEA_LEVEL + 0.2 || w.owner[i] >= 0) continue;
      if (this.landId?.[i] === from.landId) continue;
      const ty = w.type[i];
      if (ty === TILE.SNOW || ty === TILE.ROCK || ty === TILE.LAVA || ty === TILE.ICE) continue;
      // near the shore, and far from other towns
      let shore = false;
      for (let k = 0; k < 12 && !shore; k++) {
        const a = (k / 12) * Math.PI * 2;
        const xx = Math.floor(x + Math.cos(a) * 5),
          zz = Math.floor(z + Math.sin(a) * 5);
        if (w.inBounds(xx, zz) && w.height[zz * w.w + xx] < SEA_LEVEL - 0.6) shore = true;
      }
      if (!shore) continue;
      if (this.villages.some((v) => v.alive && Math.hypot(v.cx - x, v.cz - z) < 24)) continue;
      return { x: x + 0.5, z: z + 0.5 };
    }
    return null;
  },

  _coastNear(v) {
    const w = this.world;
    for (let r = v.radius; r < v.radius + 14; r += 2)
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const x = Math.floor(v.cx + Math.cos(a) * r),
          z = Math.floor(v.cz + Math.sin(a) * r);
        if (w.inBounds(x, z) && w.height[z * w.w + x] < SEA_LEVEL - 0.6) return { x: x + 0.5, z: z + 0.5 };
      }
    return null;
  },
};
