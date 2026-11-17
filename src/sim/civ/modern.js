import { TILE, SEA_LEVEL } from '../../world/constants.js';
import { BUILDING_TYPES } from './catalog.js';
import { USE, YEAR, clamp } from './util.js';
import { civPath } from './pathing.js';
import { TECHS } from './tech.js';

// Modern and future eras (docs/MODERN-ERAS.md, the parts owned by Civ):
// the buildings of eras 4-7 and where the planner puts them, taller towns,
// sanitation against plague, factory haze, rail and maglev lines, highways
// and power lines (as data for the renderers), soldiers' gear by era, and
// the decisions that ask Fleets for steamers, trains, trucks, cars, aircraft,
// rockets and starships. Every Fleets call is optional (game.fleet?.): the
// simulation runs without it.
//
// PUBLIC CONTRACT (additions to game.civ)
//   railLines(kid?) -> [{id, kind 'rail'|'maglev', kingdom, a, b (village ids),
//                        pts [x, z, x, z, ...] (tile centres along the roads),
//                        highway (bool: the road beside it widened), built}]
//   railLine(id), railBetween(villageA, villageB) -> bool
//   powerLines(kid?) -> [{id, kingdom, from (power building id), to (village id),
//                         pts [x0, z0, x1, z1], pylons [x, z, ...]}]
//   highways(kid?) -> rail lines whose roads were widened (era 6+)
//   haze() -> [{x, z, r, s (0..1), kingdom}]  smoke over factories and power stations
//   plagueResist(unit) -> 0..1  how hard plague bites (sanitation, waterworks)
//   infraVersion  bumps whenever rails, highways or power lines change
// Village fields: tallMul (growth cap multiplier), powered, powerFrom.
// Kingdom fields: satellites, orbitalStation, starships, knowRate.
// Unit fields (soldiers): data.gear 'musket'|'rifle'|'fatigues'|'suit',
//   data.reach (tiles: ranged soldiers shoot from there). Wall towers of a
//   gunpowder realm: building.bastion = true (star-shaped bastions).

// "The Kingdom of X ..." — the first time a realm uses a modern unlock
export const MODERN_FIRST = {
  factory: 'opens its first factory',
  rowhouse: 'houses its workers in its first row houses',
  waterworks: 'opens its first waterworks and sewers',
  powerstation: 'switches on its first power station',
  pylon: 'carries power to a town on its first pylons',
  radiomast: 'raises its first radio mast',
  apartment: 'builds its first apartment block',
  campus: 'opens its first research campus',
  skyscraper: 'raises its first skyscraper',
  nuclear: 'opens its first nuclear power plant',
  fusion: 'lights its first fusion plant: the factory haze begins to clear',
  arcology: 'completes its first arcology',
  station: 'opens its first railway station',
  airfield: 'opens its first airfield',
  airport: 'opens its first airport',
  containerport: 'opens its first container port',
  launchpad: 'builds its first launch pad',
  spaceport: 'opens its first spaceport',
  rail: 'lays its first railway between its towns',
  maglev: 'opens its first maglev line',
  highway: 'widens its roads into highways',
  musket: 'arms its first musketeers',
  rifle: 'arms its soldiers with rifles and helmets',
  fatigues: 'dresses its soldiers in modern fatigues',
  suit: 'clads its soldiers in armoured suits',
  bastion: 'raises star-shaped bastions on its walls',
  satellite: 'puts its first satellite into orbit',
  orbitalStation: 'builds an orbital station in the sky',
  starship: 'launches a colony starship to the stars',
  airtrade: 'flies its first cargo between towns',
  sortie: 'sends aircraft against its enemies',
};

const MODERN_TECHS = TECHS.filter((t) => t.era >= 4).map((t) => t.id);
const REACH = { musket: 2.6, rifle: 3.4, fatigues: 3.8, suit: 4.4 };

export const modern = {
  _initModern() {
    this.rails = [];
    this.power = [];
    this.infraVersion = 0;
    this._nextLine = 1;
    this._hazeC = null;
  },

  // ------------------------------------------------------------ queries
  railLines(kid = null) {
    return kid == null ? this.rails : this.rails.filter((l) => l.kingdom === kid);
  },
  railLine(id) {
    return this.rails.find((l) => l.id === id) || null;
  },
  railBetween(a, b) {
    for (const l of this.rails) if ((l.a === a && l.b === b) || (l.a === b && l.b === a)) return true;
    return false;
  },
  powerLines(kid = null) {
    return kid == null ? this.power : this.power.filter((l) => l.kingdom === kid);
  },
  highways(kid = null) {
    return this.rails.filter((l) => l.highway && (kid == null || l.kingdom === kid));
  },
  haze() {
    const now = this.game.time.total;
    if (this._hazeC && now - this._hazeC.t < 2) return this._hazeC.list;
    const list = [];
    for (const b of this.buildings) {
      if (!b.alive || b.constructing) continue;
      const def = BUILDING_TYPES[b.type];
      if (!def.smoke) continue;
      const k = this.kingdoms[b.kingdom];
      // Fusion: the realm's haze fades over fifteen years
      let s = def.smoke;
      if (k?.fusionAt != null) s *= Math.max(0, 1 - (now - k.fusionAt) / (YEAR * 15));
      if (s > 0.02) list.push({ x: b.x, z: b.z, r: 3 + def.smoke * 4, s, kingdom: b.kingdom });
    }
    this._hazeC = { t: now, list };
    return list;
  },
  // Plague bites less in a realm of physicians, far less with sewers and clean water.
  plagueResist(u) {
    const v = this.villages[u?.village];
    if (!v?.alive) return 1;
    const kid = v.kingdom;
    let f = 1;
    if (this.hasTech(kid, 'medicine')) f = 0.85;
    if (this.hasTech(kid, 'sanitation')) f = 0.45;
    if (v.hasWaterworks) f = 0.3;
    return f;
  },
  // A modern world holds a few more people (its towns grow taller): up to
  // 12% over the people budget once a realm reaches the Future.
  _modernPeople() {
    const t = this.game.time.total;
    if (this._mpT === t) return this._mpV;
    let top = 0;
    for (const k of this.kingdoms) if (k.alive && (k.era || 0) > top) top = k.era;
    this._mpT = t;
    this._mpV = 0.03 * clamp(top - 3, 0, 4);
    return this._mpV;
  },
  _anyModern(k) {
    if (!k?.techs || (k.era || 0) < 3) return false;
    for (const t of MODERN_TECHS) if (k.techs.has(t)) return true;
    return false;
  },

  // ------------------------------------------------------------ building plan
  // Called from _planUnlocks with the planner's helpers. The rarer works go
  // to the capital and the cities, once per realm; the common ones to towns.
  _planModern(v, K, room, build, upgrade, count) {
    if (!this._anyModern(K)) return;
    const kid = K.id;
    const has = (t) => K.techs.has(t);
    const pop = v.pop;
    const town = v.tier >= 1;
    const city = v.tier >= 2;
    const isCap = K.capital === v.id;
    const now = this.game.time.total;
    const realm = this._realmTypeCount(kid);
    const rc = (t) => realm.get(t) || 0;
    let towns = 0;
    for (const vid of K.villages) if (this.villages[vid]?.tier >= 1) towns++;
    // a footprint that found no room waits a while before the next search
    const fail = v.modernFail || (v.modernFail = {});
    const ok = (type) => !(now - (fail[type] ?? -1e9) < 40);
    const tryBuild = (type, placer) => {
      if (!ok(type)) return false;
      const before = v.buildings.length;
      const r = build(type, placer);
      if (!r && v.need !== type && v.buildings.length === before) fail[type] = now;
      if (r) realm.set(type, rc(type) + 1);
      return r;
    };
    const out = (type, minR, extra) => () => this._placeOutskirts(v, type, Math.max(minR, v.radius * 0.6), v.buildRadius + extra, null, null) || this._placeWide(v, type, v.buildRadius * 0.7, v.buildRadius + extra + 10);
    // Sanitation: waterworks and sewers
    if (room() && has('sanitation') && (town || pop >= 30) && count('waterworks') === 0) tryBuild('waterworks', () => this._placeByWater(v, 'waterworks') || this.placeAlongRoad(v, 'waterworks'));
    // Industry: factories on the edge of town, row houses for their workers
    if (room() && has('industry') && town && count('factory') < (city ? 2 : 1)) tryBuild('factory', out('factory', 4, 5));
    if (room() && has('industry') && town && count('factory') > 0 && count('rowhouse') < 1 + v.tier && v.housing - pop < 4) tryBuild('rowhouse');
    // Electricity: a power station for every few towns; later the atom and fusion
    const plants = rc('powerstation') + rc('nuclear') + rc('fusion');
    if (room() && has('electricity') && town && count('powerstation') === 0 && plants < Math.max(1, Math.ceil(towns / 3)) && !has('nuclear')) tryBuild('powerstation', out('powerstation', 4, 6));
    if (room() && has('nuclear') && (city || isCap) && rc('nuclear') === 0 && !has('fusion')) tryBuild('nuclear', out('nuclear', 5, 8));
    if (room() && has('fusion') && (city || isCap) && rc('fusion') === 0) tryBuild('fusion', out('fusion', 5, 8));
    // a town fed by a power line raises a pylon where the line comes in
    if (room() && has('electricity') && v.powerFrom != null && count('pylon') === 0) {
      const src = this._bById.get(v.powerFrom);
      if (src && src.village !== v.id) tryBuild('pylon', () => this._placeOutskirts(v, 'pylon', v.radius * 0.6, v.radius + 1, src.x, src.z));
    }
    // Radio
    if (room() && has('radio') && town && count('radiomast') === 0) tryBuild('radiomast', out('radiomast', 3, 2));
    // Reinforced Concrete: apartment blocks (and taller ones in the cities)
    if (room() && has('concrete') && town && (v.housing - pop < 6 + v.tier * 2 || count('apartment') === 0) && count('apartment') < 1 + v.tier * 2) tryBuild('apartment');
    else if (room() && has('concrete') && city) {
      const a = v.buildings.find((b) => b.alive && b.type === 'apartment' && !b.constructing && !b.upgrading && b.level < 2);
      if (a && v.housing - pop < 6) upgrade(a);
    }
    // Railways: a station in each town a line reaches
    if (room() && has('railways') && v.railEnds > 0 && count('station') === 0) tryBuild('station');
    // Computing: a research campus in the capital and the cities
    if (room() && has('computing') && (city || isCap) && count('campus') === 0) tryBuild('campus', out('campus', 3, 4));
    // Skyscrapers rise at city centres
    if (room() && has('skyscrapers') && city && count('skyscraper') < (isCap ? 3 : 2) && v.housing - pop < 10) tryBuild('skyscraper', () => this.placeAlongRoad(v, 'skyscraper', this._bias(v, 'market')));
    // Arcology: a whole city in one green tower
    if (room() && has('arcology') && (isCap || city) && count('arcology') === 0 && rc('arcology') < 2) tryBuild('arcology', out('arcology', 4, 7));
    // Flight: airfields; Jets: airports
    if (room() && has('flight') && (isCap || city) && count('airfield') + count('airport') === 0 && rc('airfield') + rc('airport') < Math.max(1, Math.ceil(towns / 3))) tryBuild('airfield', out('airfield', 5, 8));
    if (room() && has('jets') && (isCap || city) && count('airport') === 0 && rc('airport') < (towns >= 6 ? 2 : 1)) tryBuild('airport', out('airport', 5, 10));
    // Container Shipping: a port with cranes in a harbour town
    if (room() && has('containers') && v.coastal && town && count('docks') > 0 && count('containerport') === 0) tryBuild('containerport', () => this._placeDocks(v, 'containerport'));
    // Rocketry: a launch pad; Orbital Industry: a spaceport (far out of town)
    if (room() && has('rocketry') && (isCap || city) && rc('launchpad') === 0) tryBuild('launchpad', out('launchpad', 6, 12));
    if (room() && has('orbital') && (isCap || city) && rc('spaceport') === 0) tryBuild('spaceport', out('spaceport', 6, 12));
  },
  // A big footprint (airport, arcology, spaceport) beyond the fields: more
  // tries than _placeOutskirts, on ground that may be levelled more.
  _placeWide(v, type, minR, maxR) {
    const def = BUILDING_TYPES[type];
    const rng = this.rng;
    let best = null,
      bs = Infinity;
    for (let k = 0; k < 140; k++) {
      const a = rng.float(0, Math.PI * 2);
      const r = rng.float(minR, maxR);
      const x = Math.floor(v.cx + Math.cos(a) * r),
        y = Math.floor(v.cz + Math.sin(a) * r);
      const rot = rng.int(0, 3);
      const fw = rot & 1 ? def.h : def.w,
        fh = rot & 1 ? def.w : def.h;
      if (!this.world.inBounds(x, y) || this.landId[y * this.world.w + x] !== v.landId) continue;
      if (!this._footprintOK(x, y, fw, fh, 0.6 + 0.3 * Math.max(fw, fh))) continue;
      const st = this._footprintStats(x, y, fw, fh);
      const s = st.slope * 2 + st.trees * 0.5 + r * 0.15 + rng.next() * 2;
      if (s < bs) (bs = s), (best = { x, y, rot });
    }
    if (!best) return null;
    const b = this.addBuilding(v, type, best.x, best.y, best.rot);
    const dx = Math.floor(b.doorX),
      dz = Math.floor(b.doorZ);
    if (this.world.inBounds(dx, dz)) this._connectToRoads(v, dx, dz);
    return b;
  },
  // buildings of each modern type a realm has (cached for a moment)
  _realmTypeCount(kid) {
    const t = this.game.time.total;
    const C = this._rtc || (this._rtc = { t: -1, v: -1, by: new Map() });
    if (C.t !== t || C.v !== this.version) {
      C.t = t;
      C.v = this.version;
      C.by.clear();
      for (const b of this.buildings) {
        if (!b.alive || !BUILDING_TYPES[b.type].modern) continue;
        let m = C.by.get(b.kingdom);
        if (!m) C.by.set(b.kingdom, (m = new Map()));
        m.set(b.type, (m.get(b.type) || 0) + 1);
      }
    }
    let m = C.by.get(kid);
    if (!m) C.by.set(kid, (m = new Map()));
    return m;
  },

  // ------------------------------------------------------------ the realm at large
  // Every 2 s (from _unlockTick).
  _modernTick(dt) {
    const now = this.game.time.total;
    // taller towns, clean water, factories at work
    for (const v of this.villages) {
      if (!v.alive) continue;
      let ww = false,
        apt = 0,
        sky = 0,
        arc = 0,
        fac = 0;
      for (const b of v.buildings) {
        if (!b.alive || b.constructing) continue;
        switch (b.type) {
          case 'waterworks':
            ww = true;
            break;
          case 'apartment':
            apt += b.level;
            break;
          case 'skyscraper':
            sky++;
            break;
          case 'arcology':
            arc++;
            break;
          case 'factory':
            fac++;
            break;
        }
      }
      v.hasWaterworks = ww;
      v.tallMul = Math.min(2, 1 + (ww ? 0.1 : 0) + Math.min(4, apt) * 0.08 + Math.min(3, sky) * 0.12 + Math.min(1, arc) * 0.45);
      // a factory's wares sell in the realm's markets
      if (fac) v.gold += fac * 0.05 * dt * this.techMod(v.kingdom, 'gold');
    }
    const F = this.game.fleet;
    for (const k of this.kingdoms) {
      if (!k.alive || !k.villages.length || !this._anyModern(k)) continue;
      const has = (t) => k.techs.has(t);
      const T = k.modT || (k.modT = { rail: now - 10, power: 0, train: 0, car: 0, air: 0, space: 0 });
      this._gearUp(k);
      if (has('fusion') && k.fusionAt == null) k.fusionAt = now;
      if (has('railways') && now - T.rail > 20) {
        T.rail = now;
        this._surveyRail(k);
      }
      if (has('electricity') && now - T.power > 15) {
        T.power = now;
        this._powerGrid(k);
      }
      if (F?.requestTrain && now - T.train > 8) {
        T.train = now;
        for (const l of this.rails) if (l.kingdom === k.id && this.rng.chance(0.5)) F.requestTrain({ kingdom: k.id, line: l.id, reverse: this.rng.chance(0.5) });
      }
      if (has('combustion') && F?.requestCar && now - T.car > 12) {
        T.car = now;
        let cars = 0;
        for (const x of F.list) if (x.alive && x.kingdom === k.id && x.model === 'car') cars++;
        for (const vid of k.villages) {
          const v = this.villages[vid];
          if (!v?.alive || v.tier < 1 || cars >= 1 + k.villages.length / 3) continue;
          if (this.rng.chance(0.5) && F.requestCar({ kingdom: k.id, village: vid })) cars++;
        }
      }
      if (has('flight') && now - T.air > 15) {
        T.air = now;
        this._airDecisions(k);
      }
      if (has('rocketry') && now - T.space > 10) {
        T.space = now;
        this._spaceDecisions(k);
      }
    }
    // lines whose towns are gone are taken up
    let gone = false;
    for (const l of this.rails) {
      const a = this.villages[l.a],
        b = this.villages[l.b];
      if (!a?.alive || !b?.alive) {
        l.dead = true;
        gone = true;
      } else if (a.kingdom === b.kingdom && a.kingdom !== l.kingdom) l.kingdom = a.kingdom; // conquered with its towns
    }
    if (gone) {
      this.rails = this.rails.filter((l) => !l.dead);
      this._railEnds();
      this.infraVersion++;
    }
  },

  // ------------------------------------------------------------ soldiers
  // Gear follows the era: muskets, then rifles and helmets, fatigues, and
  // armoured suits. Musketeers and their heirs shoot from a few paces off.
  _gearUp(k) {
    const era = k.era || 0;
    const gear = era >= 7 ? 'suit' : era >= 6 ? 'fatigues' : era >= 5 ? 'rifle' : k.techs.has('gunpowder') ? 'musket' : null;
    if (!gear) return;
    let n = 0;
    for (const vid of k.villages) {
      const v = this.villages[vid];
      if (!v?.alive) continue;
      for (const u of v.members) {
        if (!u.alive || !u.data) continue;
        if (u.job === 'soldier') {
          if (u.data.gear !== gear) {
            u.data.gear = gear;
            u.data.reach = REACH[gear];
          }
          n++;
        } else if (u.data.gear) {
          delete u.data.gear;
          delete u.data.reach;
        }
      }
      // Gunpowder: the wall towers become star-shaped bastions
      if (v.wallsPlanned)
        for (const b of v.buildings)
          if (b.alive && b.type === 'tower' && !b.bastion) {
            b.bastion = true;
            this.version++;
            this._firstUse(k, 'bastion', { x: b.x, z: b.z });
          }
    }
    if (n) this._firstUse(k, gear);
  },

  // ------------------------------------------------------------ railways
  // Railways: a line along the roads from the capital to each town it is
  // linked with (surveyed roads first, then any town of the realm within
  // reach), one line per survey. Maglev: lines between towns become
  // elevated maglev lines. Atomic era: the roads beside them are widened.
  _surveyRail(k) {
    const cap = this.villages[k.capital];
    if (!cap?.alive) return;
    const reach = 90 * Math.sqrt(Math.max(1, this.budget.area));
    // 1. a new line
    let best = null,
      bd = Infinity;
    for (const vid of k.villages) {
      const v = this.villages[vid];
      if (!v?.alive || v === cap || v.landId !== cap.landId || this.railBetween(cap.id, v.id)) continue;
      if (v.pop < 14 && !k.roadLinks?.has(vid)) continue;
      const d = Math.hypot(v.cx - cap.cx, v.cz - cap.cz) - (k.roadLinks?.has(vid) ? 20 : 0);
      if (d < bd && d < reach) (bd = d), (best = v);
    }
    if (best) {
      const fails = k.railFail || (k.railFail = {});
      if (!(this.game.time.total - (fails[best.id] ?? -1e9) < YEAR * 8)) {
        const pts = this._railPath(cap, best);
        if (pts) {
          this.rails.push({ id: this._nextLine++, kind: 'rail', kingdom: k.id, a: cap.id, b: best.id, pts, highway: false, built: this.game.time.total });
          this._railEnds();
          this.infraVersion++;
          this._firstUse(k, 'rail', { x: (cap.cx + best.cx) / 2, z: (cap.cz + best.cz) / 2 });
          return;
        }
        fails[best.id] = this.game.time.total;
      }
    }
    // 2. Maglev: a line between towns rises onto its pylons
    if (k.techs.has('maglev')) {
      const l = this.rails.find((x) => x.kingdom === k.id && x.kind === 'rail' && this.villages[x.a]?.tier >= 1 && this.villages[x.b]?.tier >= 1);
      if (l) {
        l.kind = 'maglev';
        l.maglevAt = this.game.time.total;
        this.infraVersion++;
        this._firstUse(k, 'maglev', { x: l.pts[0], z: l.pts[1] });
        return;
      }
    }
    // 3. Atomic era: highways beside the lines
    if ((k.era || 0) >= 6 && this.law('civRoads')) {
      const l = this.rails.find((x) => x.kingdom === k.id && !x.highway);
      if (l) {
        l.highway = true;
        const n = this._widenAlong(l);
        this.infraVersion++;
        if (n > 6) this._firstUse(k, 'highway', { x: l.pts[0], z: l.pts[1] });
      }
    }
  },
  // the number of lines ending in each town (a station rises where one does)
  _railEnds() {
    for (const v of this.villages) v.railEnds = 0;
    for (const l of this.rails) {
      const a = this.villages[l.a],
        b = this.villages[l.b];
      if (a) a.railEnds++;
      if (b) b.railEnds++;
    }
  },
  // Tile centres from hall to hall along the laid roads where there are
  // any, across easy country where there are none; every second point kept.
  _railPath(a, b) {
    const w = this.world;
    const W = w.w;
    const door = (v) => (v.hall?.alive ? [Math.floor(v.hall.doorX), Math.floor(v.hall.doorZ)] : [Math.floor(v.cx), Math.floor(v.cz)]);
    const [sx, sy] = door(a),
      [gx, gy] = door(b);
    if (!w.inBounds(sx, sy) || !w.inBounds(gx, gy)) return null;
    const base = this._roadCost();
    const use = this.use;
    const roads = (i) => {
      if (use[i] === USE.ROAD) return 0.4;
      const x = i % W,
        y = (i / W) | 0;
      return Math.abs(x - sx) + Math.abs(y - sy) <= 3 || Math.abs(x - gx) + Math.abs(y - gy) <= 3 ? base(i) : Infinity;
    };
    const near = (p) => {
      if (!p?.length) return false;
      const last = p[p.length - 1];
      return Math.hypot((last % W) - gx, ((last / W) | 0) - gy) <= 3;
    };
    let p = civPath(w, sx, sy, gx, gy, roads, 9000, 0.4);
    if (!near(p)) p = civPath(w, sx, sy, gx, gy, (i) => (use[i] === USE.ROAD ? 0.4 : base(i) * 1.3), 12000, 0.4);
    if (!near(p) || p.length < 4) return null;
    const pts = [sx + 0.5, sy + 0.5];
    for (let k = 1; k < p.length - 1; k += 2) pts.push((p[k] % W) + 0.5, ((p[k] / W) | 0) + 0.5);
    const last = p[p.length - 1];
    pts.push((last % W) + 0.5, ((last / W) | 0) + 0.5);
    return pts;
  },
  // Highways: a second lane of road laid beside a line's road outside the towns.
  _widenAlong(l) {
    const w = this.world;
    const W = w.w;
    const a = this.villages[l.a],
      b = this.villages[l.b];
    if (!a || !b) return 0;
    let n = 0;
    const P = l.pts;
    for (let k = 2; k < P.length - 2; k += 2) {
      const x = P[k],
        z = P[k + 1];
      if (Math.hypot(x - a.cx, z - a.cz) < a.radius * 0.8 || Math.hypot(x - b.cx, z - b.cz) < b.radius * 0.8) continue;
      // the side of the way: perpendicular to its direction here
      const dx = P[k + 2] - P[k - 2],
        dz = P[k + 3] - P[k - 1];
      const L = Math.hypot(dx, dz) || 1;
      for (const s of [1, -1]) {
        const tx = Math.floor(x + (-dz / L) * s),
          tz = Math.floor(z + (dx / L) * s);
        if (!w.inBounds(tx, tz)) continue;
        const i = tz * W + tx;
        if (this.use[i] !== USE.FREE || w.height[i] < SEA_LEVEL + 0.05 || w.type[i] === TILE.ROCK || w.type[i] === TILE.SNOW) continue;
        const v = Math.hypot(x - a.cx, z - a.cz) < Math.hypot(x - b.cx, z - b.cz) ? a : b;
        if (this.layRoad(v, i)) n++;
        break;
      }
    }
    if (n) this.fieldVersion++;
    return n;
  },

  // ------------------------------------------------------------ power lines
  // Each town of the realm draws power from its nearest plant on the same
  // land: a straight line of pylons every five tiles.
  _powerGrid(k) {
    const src = [];
    for (const b of this.buildings) if (b.alive && !b.constructing && b.kingdom === k.id && BUILDING_TYPES[b.type].power) src.push(b);
    const lines = [];
    const reach = 70 * this._villageSpread();
    for (const vid of k.villages) {
      const v = this.villages[vid];
      if (!v?.alive) continue;
      v.powered = false;
      v.powerFrom = null;
      if (!src.length || v.pop < 12) continue;
      let best = null,
        bd = Infinity;
      for (const b of src) {
        const bv = this.villages[b.village];
        if (bv && bv.landId !== v.landId) continue;
        const d = Math.hypot(b.x - v.cx, b.z - v.cz);
        if (d < bd) (bd = d), (best = b);
      }
      if (!best || bd > reach) continue;
      v.powered = true;
      v.powerFrom = best.id;
      if (best.village === v.id) continue;
      // from the plant to the edge of the town
      const dx = v.cx - best.x,
        dz = v.cz - best.z;
      const L = Math.hypot(dx, dz) || 1;
      const ex = v.cx - (dx / L) * v.radius * 0.7,
        ez = v.cz - (dz / L) * v.radius * 0.7;
      const len = Math.hypot(ex - best.x, ez - best.z);
      const pylons = [];
      const n = Math.max(1, Math.round(len / 5));
      for (let i = 1; i < n; i++) pylons.push(best.x + ((ex - best.x) * i) / n, best.z + ((ez - best.z) * i) / n);
      lines.push({ id: best.id * 4096 + v.id, kingdom: k.id, from: best.id, to: v.id, pts: [best.x, best.z, ex, ez], pylons });
    }
    const old = this.power.filter((l) => l.kingdom === k.id);
    const sig = (L) => L.map((l) => l.id).join(',');
    if (sig(old) === sig(lines)) return;
    this.power = this.power.filter((l) => l.kingdom !== k.id).concat(lines);
    this.infraVersion++;
  },

  // ------------------------------------------------------------ aircraft
  _airDecisions(k) {
    const F = this.game.fleet;
    if (!F?.requestFlight) return;
    const has = (t) => k.techs.has(t);
    const fields = [];
    const halls = [];
    for (const vid of k.villages) {
      const v = this.villages[vid];
      if (!v?.alive) continue;
      if (v.hall?.alive && !v.hall.constructing) halls.push(v.hall);
      for (const b of v.buildings) if (b.alive && !b.constructing && BUILDING_TYPES[b.type].air) fields.push(b);
    }
    const busy = F.airCount?.(k.id) ?? 0;
    if (busy >= 3 + k.villages.length) return;
    const pick = (L) => L[(this.rng.next() * L.length) | 0];
    // war: biplanes, then jets, strafe the enemy's armies and towns
    const enemies = this.enemiesOf(k.id);
    if (fields.length && enemies.length && this.rng.chance(0.6)) {
      const from = pick(fields);
      let tgt = null,
        td = Infinity;
      for (const a of this.armies) {
        if (!enemies.includes(a.kingdom) || !a.units?.size) continue;
        const u = this.game.units.byId.get(a.bearer) || a.units.values().next().value;
        if (!u) continue;
        const d = Math.hypot(u.x - from.x, u.z - from.z);
        if (d < td) (td = d), (tgt = { x: u.x, z: u.z });
      }
      if (!tgt)
        for (const e of enemies)
          for (const vid of this.kingdoms[e]?.villages || []) {
            const ev = this.villages[vid];
            if (!ev?.alive) continue;
            const d = Math.hypot(ev.cx - from.x, ev.cz - from.z);
            if (d < td) (td = d), (tgt = { x: ev.cx, z: ev.cz });
          }
      if (tgt && td < 160 * this._villageSpread()) {
        const f = F.requestFlight({ kind: has('jets') ? 'jet' : 'biplane', kingdom: k.id, from: from.id, to: tgt, cargo: { strike: true } });
        if (f) this._firstUse(k, 'sortie', tgt);
      }
    }
    // peace: airliners to the airports of friendly realms, planes between the realm's towns
    if (fields.length && this.rng.chance(0.7)) {
      const from = pick(fields);
      let to = null;
      if (has('jets') && BUILDING_TYPES[from.type].air >= 2) {
        let bs = -Infinity;
        for (const b of this.buildings) {
          if (!b.alive || b.constructing || b.type !== 'airport' || b.kingdom === k.id || this.atWar(b.kingdom, k.id)) continue;
          const r = this.relations.get(this._relKeyOf(b.kingdom, k.id));
          const sc = (r?.opinion ?? 0) + (r?.ally ? 30 : 0) + this.rng.next() * 20;
          if ((r?.opinion ?? 0) > -10 && sc > bs) (bs = sc), (to = b);
        }
      }
      if (!to) {
        const others = fields.filter((b) => b !== from && Math.hypot(b.x - from.x, b.z - from.z) > 20);
        const far = halls.filter((h) => h.village !== from.village && Math.hypot(h.x - from.x, h.z - from.z) > 25);
        to = others.length ? pick(others) : far.length ? pick(far) : null;
      }
      if (to) {
        const f = F.requestFlight({ kind: to.type === 'airport' && to.kingdom !== k.id ? 'airliner' : has('jets') && this.rng.chance(0.5) ? 'airliner' : 'plane', kingdom: k.id, from: from.id, to: to.id, cargo: { gold: 6, trade: true } });
        if (f) this._firstUse(k, 'airtrade', { x: from.x, z: from.z });
      }
    }
    // Robotics: delivery drones hop over the cities; VTOL: sky taxis between towns
    if (has('robotics'))
      for (const h of halls) {
        const v = this.villages[h.village];
        if (!v || v.tier < 1 || !this.rng.chance(0.5)) continue;
        const homes = v.buildings.filter((b) => b.alive && !b.constructing && (b.type === 'house' || b.type === 'apartment' || b.type === 'rowhouse') && Math.hypot(b.x - h.x, b.z - h.z) > 4);
        if (homes.length) F.requestFlight({ kind: 'drone', kingdom: k.id, from: h.id, to: pick(homes).id, cargo: { parcel: 1 } });
      }
    if (has('vtol') && halls.length >= 2 && this.rng.chance(0.6)) {
      const a = pick(halls);
      const b = pick(halls.filter((h) => h !== a));
      if (b) F.requestFlight({ kind: 'skytaxi', kingdom: k.id, from: a.id, to: b.id, cargo: { passengers: 4 } });
    }
  },
  // An aircraft has landed (Fleets 'fleet:landed').
  _onAirLanded(e) {
    if (!e) return;
    const K = this.kingdoms[e.kingdom];
    if (!K?.alive) return;
    const c = e.cargo || {};
    if (c.strike) {
      // a strafing run: a few of the enemy's soldiers near the target are hit
      const U = this.game.units;
      const foes = U?.query?.(e.x, e.z, 4, (o) => o.alive && o.species === 'human' && o.job === 'soldier' && o.kingdom >= 0 && this.atWar(o.kingdom, K.id)) || [];
      for (let i = 0; i < Math.min(3, foes.length); i++) U.damage?.(foes[i], 6 + this.rng.next() * 6, null, { cause: 'battle' });
      if (foes.length) this._fx('sparks', e.x, e.z, 0.8);
      return;
    }
    if (!c.trade || e.early) return;
    const toB = this._bById.get(e.to),
      fromB = this._bById.get(e.from);
    const tv = toB ? this.villages[toB.village] : null,
      fv = fromB ? this.villages[fromB.village] : null;
    const gold = (c.gold || 6) * (e.kind === 'airliner' ? 1.5 : 1);
    if (tv?.alive) tv.gold += gold * 0.5;
    if (fv?.alive) fv.gold += gold * 0.5;
    if (tv && fv && tv.kingdom !== fv.kingdom) {
      const r = this.rel(tv.kingdom, fv.kingdom);
      r.opinion = Math.min(100, r.opinion + 2); // travel brings realms closer
    }
  },

  // ------------------------------------------------------------ rockets and starships
  _spaceDecisions(k) {
    const now = this.game.time.total;
    const has = (t) => k.techs.has(t);
    let pad = null,
      port = null;
    for (const vid of k.villages) {
      const v = this.villages[vid];
      if (!v?.alive) continue;
      for (const b of v.buildings) {
        if (!b.alive || b.constructing) continue;
        if (b.type === 'launchpad' && !pad) pad = b;
        if (b.type === 'spaceport' && !port) port = b;
      }
    }
    const site = port || pad;
    if (!site) return;
    let payload = null;
    if (has('starships') && port && now - (k.starshipT ?? -1e9) > YEAR * 25) payload = 'starship';
    else if (has('orbital') && port && !k.orbitalStation && now - (k.launchT ?? -1e9) > YEAR * 2) payload = 'station';
    else if ((k.satellites || 0) < 6 && now - (k.launchT ?? -1e9) > YEAR * 6) payload = 'satellite';
    if (!payload) return;
    const F = this.game.fleet;
    k.launchT = now;
    if (payload === 'starship') k.starshipT = now;
    if (F?.requestLaunch) {
      if (!F.requestLaunch({ kingdom: k.id, from: (payload === 'satellite' ? pad || port : port).id, payload })) {
        k.launchT = now - YEAR * 5; // the weather: try again soon
        if (payload === 'starship') k.starshipT = now - YEAR * 24;
      }
    } else this._onOrbit({ kingdom: k.id, payload, x: site.x, z: site.z });
  },
  // A payload has reached orbit (Fleets 'fleet:orbit').
  _onOrbit(e) {
    const K = this.kingdoms[e?.kingdom];
    if (!K?.alive) return;
    const pos = { x: e.x, z: e.z };
    if (e.payload === 'satellite') {
      K.satellites = (K.satellites || 0) + 1;
      if (!this._techFirst.has('orbit')) {
        this._techFirst.add('orbit');
        this._note(`🚀 ${this._kn(K)} puts the world's first satellite into orbit`, 'good', pos, 'firstorbit', 1);
        this._history(`🚀 The first satellite crosses the night sky, launched by ${this._kn(K)}`, 'good', pos);
      }
      this._firstUse(K, 'satellite', pos);
    } else if (e.payload === 'station') {
      K.orbitalStation = true;
      this._firstUse(K, 'orbitalStation', pos);
    } else if (e.payload === 'starship') {
      K.starships = (K.starships || 0) + 1;
      // the late-game milestone: feed and chronicle, every launch
      const first = !this._techFirst.has('starship');
      this._techFirst.add('starship');
      this._note(`🌌 ${this._kn(K)} launches ${K.starships === 1 ? 'its first' : 'another'} colony starship to the stars${first ? ', the first in the world' : ''}`, 'good', pos, 'starship' + K.id + '-' + K.starships, 1);
      this._history(`🌌 A colony starship of ${this._kn(K)} leaves for the stars${first ? ': the age of the stars begins' : ''}`, 'good', pos);
      if (K.firsts) K.firsts.add('starship');
    }
  },
};
