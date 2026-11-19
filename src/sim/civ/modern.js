import { TILE, SEA_LEVEL, FLORA } from '../../world/constants.js';
import { BUILDING_TYPES } from './catalog.js';
import { USE, YEAR, clamp } from './util.js';
import { civPath } from './pathing.js';
import { TECHS } from './tech.js';
import { BREADTH_FIRST } from './breadth.js';
import { BUILDING } from '../../core/scale.js';

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
//                        pts [x, z, x, z, ...] (the route through the realm's
//                        network, on the centre of the drawn track), highway, built}]
//   railSegs() -> the drawn network (one entry per stretch of track, see below;
//                 xing [[x, z, angle, angle2]]: where a rail crosses another)
//   railMask  Uint8Array per tile: 1 under a rail track, 2 under a guideway
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
  suit: 'clads its soldiers in armored suits',
  bastion: 'raises star-shaped bastions on its walls',
  satellite: 'puts its first satellite into orbit',
  orbitalStation: 'builds an orbital station in the sky',
  starship: 'launches a colony starship to the stars',
  airtrade: 'flies its first cargo between towns',
  sortie: 'sends aircraft against its enemies',
  ...BREADTH_FIRST,
};

const MODERN_TECHS = TECHS.filter((t) => t.era >= 4).map((t) => t.id);
const REACH = { musket: 2.6, rifle: 3.4, fatigues: 3.8, suit: 4.4 };

// ------------------------------------------------------------ rail geometry
// per kind: minimum curve radius, how straight the country run is kept
// (tolerance in tiles), and the lead a branch runs along its trunk or out of
// a platform before it curves away
const NET = {
  rail: { R: 2.6, eps: 0.7, lead: 1.6 },
  maglev: { R: 5, eps: 1.3, lead: 2.6 },
};
const SPACING = 0.4;
// the station model's track: along the back of its platform (design units)
const ST_Z = -0.66,
  ST_HALF = 1.35;
// a flyover lifts one guideway this far (design units) over another
const MAG_LIFT = 0.6;
// the highway's centre, right of the track (tiles)
export const HW_OFF = 1.15;

function revPts(p) {
  const out = new Array(p.length);
  for (let i = 0; i < p.length; i += 2) {
    out[p.length - 2 - i] = p[i];
    out[p.length - 1 - i] = p[i + 1];
  }
  return out;
}
function tanAt(P, i) {
  const n = P.length / 2;
  const a = Math.max(0, i - 1),
    b = Math.min(n - 1, i + 1);
  const dx = P[b * 2] - P[a * 2],
    dz = P[b * 2 + 1] - P[a * 2 + 1];
  const L = Math.hypot(dx, dz) || 1;
  return [dx / L, dz / L];
}
// the highway's centre beside point i of a track
export function hwPoint(P, i) {
  const [tx, tz] = tanAt(P, i);
  return [P[i * 2] + tz * HW_OFF, P[i * 2 + 1] - tx * HW_OFF];
}
function segHit(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax),
    d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax),
    d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx),
    d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
// Ramer-Douglas-Peucker: the grid path's stair steps become straight runs
function rdp(P, eps) {
  if (P.length < 3) return P.slice();
  const keep = new Uint8Array(P.length);
  keep[0] = keep[P.length - 1] = 1;
  const stack = [[0, P.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, az] = P[a],
      [bx, bz] = P[b];
    const dx = bx - ax,
      dz = bz - az,
      L = Math.hypot(dx, dz) || 1;
    let md = 0,
      mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((P[i][0] - ax) * dz - (P[i][1] - az) * dx) / L;
      if (d > md) (md = d), (mi = i);
    }
    if (md > eps) {
      keep[mi] = 1;
      stack.push([a, mi], [mi, b]);
    }
  }
  return P.filter((_, i) => keep[i]);
}
// corners rounded with a radius up to R, sampled every SPACING
function fillet(P0, R) {
  const Q = [P0[0]];
  for (let i = 1; i < P0.length; i++) {
    const l = Q[Q.length - 1];
    if (Math.hypot(P0[i][0] - l[0], P0[i][1] - l[1]) > 0.08) Q.push(P0[i]);
  }
  const n = Q.length;
  if (n < 2) return null;
  // the tangent length each corner wants, then shared out where two corners
  // compete for one straight run
  const T = new Float64Array(n);
  const len = [];
  for (let i = 0; i + 1 < n; i++) len.push(Math.hypot(Q[i + 1][0] - Q[i][0], Q[i + 1][1] - Q[i][1]));
  for (let i = 1; i < n - 1; i++) {
    const ux = (Q[i][0] - Q[i - 1][0]) / len[i - 1],
      uz = (Q[i][1] - Q[i - 1][1]) / len[i - 1],
      vx = (Q[i + 1][0] - Q[i][0]) / len[i],
      vz = (Q[i + 1][1] - Q[i][1]) / len[i];
    const th = Math.acos(Math.max(-1, Math.min(1, ux * vx + uz * vz)));
    T[i] = R * Math.tan(Math.min(th, 2.6) / 2);
  }
  for (let pass = 0; pass < 3; pass++)
    for (let i = 0; i + 1 < n; i++) {
      const sum = T[i] + T[i + 1];
      if (sum > len[i] * 0.98) {
        const f = (len[i] * 0.98) / sum;
        T[i] *= f;
        T[i + 1] *= f;
      }
    }
  const out = [Q[0][0], Q[0][1]];
  const line = (ax, az, bx, bz) => {
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-3) return;
    const k = Math.max(1, Math.ceil(L / SPACING));
    for (let s = 1; s <= k; s++) out.push(ax + ((bx - ax) * s) / k, az + ((bz - az) * s) / k);
  };
  let cx = Q[0][0],
    cz = Q[0][1];
  for (let i = 1; i < n - 1; i++) {
    const [qx, qz] = Q[i];
    const ux = (qx - Q[i - 1][0]) / len[i - 1],
      uz = (qz - Q[i - 1][1]) / len[i - 1],
      vx = (Q[i + 1][0] - qx) / len[i],
      vz = (Q[i + 1][1] - qz) / len[i];
    const t = T[i];
    if (t < 0.02) {
      line(cx, cz, qx, qz);
      cx = qx;
      cz = qz;
      continue;
    }
    const ax = qx - ux * t,
      az = qz - uz * t,
      bx = qx + vx * t,
      bz = qz + vz * t;
    line(cx, cz, ax, az);
    const k = Math.max(2, Math.ceil((2 * t) / SPACING));
    for (let s = 1; s <= k; s++) {
      const u = s / k,
        a = (1 - u) * (1 - u),
        b = 2 * u * (1 - u),
        c = u * u;
      out.push(a * ax + b * qx + c * bx, a * az + b * qz + c * bz);
    }
    cx = bx;
    cz = bz;
  }
  line(cx, cz, Q[n - 1][0], Q[n - 1][1]);
  return out;
}

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
  // (plagueResist: physicians, sewers and clean water, hospitals: breadth.js)
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
    // an Industrial town shows its industry first (a 35-building Industrial
    // town had no factory and no station: the newer branches took every
    // builder): the factory with its stack, workers' rows, the station
    // (a village saving up for its factory or station spends on nothing newer)
    if (this._anyModern(K) && this._planIndustry(v, K, room, build, count)) return;
    // the food, medicine, land, city and planning branches (breadth.js)
    this._planBreadth(v, K, room, build, upgrade, count);
    if (!this._anyModern(K)) return;
    const kid = K.id;
    const has = (t) => K.techs.has(t);
    const pop = v.pop;
    const town = v.tier >= 1;
    const city = v.tier >= 2;
    // a busy village (about 20 people) builds the common works of its era
    // too: a workshop-factory, a block of flats, its powered street, so a
    // whole realm reads as its era, not only its capital and cities
    const busy = town || pop >= 20;
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
    // (Zoning: the factories stand well away from the homes, in their own district)
    const zoned = has('zoning');
    if (room() && has('industry') && busy && count('factory') < (city ? 2 : 1)) tryBuild('factory', out('factory', zoned ? 7 : 4, zoned ? 9 : 5));
    if (room() && has('industry') && busy && count('factory') > 0 && count('rowhouse') < 1 + v.tier && (v.housing - pop < 4 || count('rowhouse') === 0)) tryBuild('rowhouse');
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
    if (room() && has('concrete') && busy && (v.housing - pop < 6 + v.tier * 2 || count('apartment') === 0) && count('apartment') < 1 + v.tier * 2) tryBuild('apartment');
    else if (room() && has('concrete') && city) {
      const a = v.buildings.find((b) => b.alive && b.type === 'apartment' && !b.constructing && !b.upgrading && b.level < 2);
      if (a && v.housing - pop < 6) upgrade(a);
    }
    // A modern city's core is for towers, not wheat: one field plot inside
    // the core is given up at a time (new plots go beyond it: _placePlot)
    if (city && (K.era || 0) >= 5 && v.plots?.length && this.rng.chance(0.5)) {
      const core = v.radius * 0.7;
      const p = v.plots.find((q) => Math.hypot((q.x0 + q.x1 + 1) / 2 - v.cx, (q.y0 + q.y1 + 1) / 2 - v.cz) < core);
      if (p) {
        const w = this.world;
        for (const i of [...p.tiles]) {
          this._removePlotTile(i);
          if (w.flora[i] === FLORA.WHEAT) w.setFlora(i % w.w, (i / w.w) | 0, FLORA.NONE);
        }
      }
    }
    // ...and its pens: a pasture inside the core is given up (its herd went
    // grazing among the towers); a new one goes out beyond the core
    if (city && (K.era || 0) >= 5 && this.rng.chance(0.3)) {
      const core = v.radius * 0.8;
      const p = v.buildings.find((b) => b.alive && b.type === 'pasture' && !b.constructing && Math.hypot(b.x - v.cx, b.z - v.cz) < core);
      if (p) {
        this.destroyBuilding(p, 'cancelled');
        p.ruinT -= YEAR * 10; // pens leave no ruin: cleared on the next sweep
      }
    }
    // Railways: a station in each town a line reaches
    if (room() && has('railways') && v.railEnds > 0 && count('station') === 0) tryBuild('station');
    // Computing: a research campus in the capital and the cities
    if (room() && has('computing') && (city || isCap) && count('campus') === 0) tryBuild('campus', out('campus', 3, 4));
    // Skyscrapers rise at city centres (one office tower in a big town)
    if (room() && has('skyscrapers') && (city || (town && pop >= 40)) && count('skyscraper') < (isCap ? 3 : city ? 2 : 1) && v.housing - pop < 10) tryBuild('skyscraper', () => this.placeAlongRoad(v, 'skyscraper', this._bias(v, 'market')));
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
  // The Industrial core of a busy village (about 20 people) of an era-4+
  // realm: a brick factory on the edge of town, a terrace of row houses for
  // its workers, and a station where a rail line ends in town. These come
  // before the newer branches (they used to be starved by them), and a
  // footprint that will not fit is tried again by the wider search.
  _planIndustry(v, K, room, build, count) {
    if ((K.era || 0) < 4) return false;
    const has = (t) => K.techs.has(t);
    const town = v.tier >= 1;
    const city = v.tier >= 2;
    if (!(town || v.pop >= 18)) return false;
    const now = this.game.time.total;
    const fail = v.modernFail || (v.modernFail = {});
    const ok = (type) => !(now - (fail[type] ?? -1e9) < 25);
    const tryBuild = (type, placer) => {
      if (!ok(type)) return false;
      const before = v.buildings.length;
      const r = build(type, placer);
      if (!r && v.need !== type && v.buildings.length === before) fail[type] = now;
      return r;
    };
    const zoned = has('zoning');
    const industry = has('industry') || (K.era || 0) >= 5;
    if (room() && industry && count('factory') < (city ? 2 : 1)) {
      const minR = Math.max(zoned ? 7 : 3, v.radius * 0.5),
        maxR = v.buildRadius + (zoned ? 9 : 5);
      tryBuild('factory', () => this._placeOutskirts(v, 'factory', minR, maxR, null, null) || this.placeAlongRoad(v, 'factory', this._bias(v, 'workshop')) || this._placeWide(v, 'factory', v.buildRadius * 0.6, v.buildRadius + 10));
    }
    if (room() && industry && count('factory') > 0 && count('rowhouse') < 1 + v.tier && (v.housing - v.pop < 6 || count('rowhouse') === 0)) tryBuild('rowhouse');
    if (room() && has('railways') && v.railEnds > 0 && count('station') === 0) {
      // beside the street where the line comes in (the hall door end)
      tryBuild('station', () => this.placeAlongRoad(v, 'station', this._bias(v, 'market')) || this._placeOutskirts(v, 'station', 1, v.buildRadius + 2, null, null));
    }
    // short of the gold or stone for them: save up (true skips the newer works)
    return v.need === 'factory' || v.need === 'station';
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
      if (fac && !(v.blackoutUntil > now)) v.gold += fac * 0.05 * dt * this.techMod(v.kingdom, 'gold'); // (idle in a blackout)
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
    this._breadthTick(dt);
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
  // Each realm's lines form one network per kind (rail on the ground, maglev
  // on a raised guideway): a tree grown from the station of the town most
  // lines start from. A town is joined to the nearest point of its realm's
  // network by a branch that leaves the trunk at a switch and runs on gentle
  // curves (a minimum radius) to the platform of its station, so lines that
  // share a corridor share one track and end at a buffer stop by a platform.
  // Maglev: lines between cities move onto a guideway of their own (straight
  // country, wide curves, a flyover where two guideways cross). Atomic era:
  // a highway beside the lines, a tile off the rail bed.
  _surveyRail(k) {
    const cap = this.villages[k.capital];
    if (!cap?.alive) return;
    this._railNetCheck(k);
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
        const l = { id: this._nextLine++, kind: 'rail', kingdom: k.id, a: cap.id, b: best.id, pts: null, highway: false, built: this.game.time.total };
        this.rails.push(l);
        this._railNetBuild(k);
        if (l.pts) {
          this._railEnds();
          this.infraVersion++;
          this._firstUse(k, 'rail', { x: (cap.cx + best.cx) / 2, z: (cap.cz + best.cz) / 2 });
          return;
        }
        this.rails.pop();
        this._railNetBuild(k);
        fails[best.id] = this.game.time.total;
      }
    }
    // 2. Maglev: a line between cities moves onto a guideway
    if (k.techs.has('maglev')) {
      const l = this.rails.find((x) => x.kingdom === k.id && x.kind === 'rail' && this.villages[x.a]?.tier >= 1 && this.villages[x.b]?.tier >= 1);
      if (l) {
        l.kind = 'maglev';
        l.maglevAt = this.game.time.total;
        this._railNetBuild(k);
        this.infraVersion++;
        this._firstUse(k, 'maglev', { x: l.pts?.[0] ?? cap.cx, z: l.pts?.[1] ?? cap.cz });
        return;
      }
    }
    // 3. Atomic era: highways beside the lines
    if ((k.era || 0) >= 6 && this.law('civRoads')) {
      const l = this.rails.find((x) => x.kingdom === k.id && !x.highway && x.kind === 'rail');
      if (l) {
        l.highway = true;
        this._railNetBuild(k);
        const n = this._widenAlong(k);
        this.infraVersion++;
        if (n > 6) this._firstUse(k, 'highway', { x: l.pts?.[0] ?? cap.cx, z: l.pts?.[1] ?? cap.cz });
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
    this._netDirty = true;
  },
  // The drawn network: [{kind, kingdom, pts [x, z, ...] (track centre, a
  // point every 0.4 tiles), junction (leaves its parent at a switch),
  // start / end {x, z, station} (a terminus: buffer stop, and a platform
  // unless the town's station has one), lift [..] (maglev: height added at
  // each point for a flyover) or null, hw (0/1 per point: a highway beside
  // it, HW_OFF to the right) or null}]
  railSegs() {
    if (this._netDirty) {
      this._netDirty = false;
      const ks = new Set(this.rails.map((l) => l.kingdom));
      this.railNet = (this.railNet || []).filter((s) => ks.has(s.kingdom));
      for (const kid of ks) if (this.kingdoms[kid]) this._railNetBuild(this.kingdoms[kid]);
    }
    return this.railNet || [];
  },
  // rebuild a realm's network when its lines or their stations change
  _railNetCheck(k) {
    if ((this._netSig || {})[k.id] !== this._railSig(k)) {
      this._railNetBuild(k);
      this.infraVersion++;
    }
  },
  _railSig(k) {
    let s = '';
    for (const l of this.rails) {
      if (l.kingdom !== k.id) continue;
      s += l.id + l.kind[0] + (l.highway ? 'h' : '');
      for (const vid of [l.a, l.b]) s += ':' + (this._stationOf(this.villages[vid])?.id ?? '-');
      s += ',';
    }
    return s;
  },
  _stationOf(v) {
    if (!v?.buildings) return null;
    for (const b of v.buildings) if (b.alive && b.type === 'station') return b;
    return null;
  },
  // where a line ends in a town: along the back of its station's platform,
  // or (no station yet) at the hall door
  _railTerm(kind, v) {
    const s = this._stationOf(v);
    if (s) {
      const r = s.rotation || 0,
        S = BUILDING.scale;
      return { x: s.x + Math.sin(r) * ST_Z * S, z: s.z + Math.cos(r) * ST_Z * S, dx: Math.cos(r), dz: -Math.sin(r), half: ST_HALF * S, station: true };
    }
    const x = v.hall?.alive ? v.hall.doorX : v.cx,
      z = v.hall?.alive ? v.hall.doorZ : v.cz;
    return { x, z, dx: 0, dz: 0, half: 0, station: false };
  },
  // a terminus turned toward (qx, qz): [buffer, platform entry], the unit
  // vector out of it and the lead point the line curves in from
  _railOrient(T, qx, qz, lead) {
    if (T.station) {
      const sg = (qx - T.x) * T.dx + (qz - T.z) * T.dz >= 0 ? 1 : -1;
      const ex = T.dx * sg,
        ez = T.dz * sg;
      const E = [T.x + ex * T.half, T.z + ez * T.half];
      return { pts: [[T.x - ex * T.half, T.z - ez * T.half], E], lead: [E[0] + ex * lead, E[1] + ez * lead] };
    }
    const L = Math.hypot(qx - T.x, qz - T.z) || 1;
    const ex = (qx - T.x) / L,
      ez = (qz - T.z) / L;
    return { pts: [[T.x, T.z]], lead: [T.x + ex * lead * 0.6, T.z + ez * lead * 0.6] };
  },
  _railNetBuild(k) {
    const w = this.world;
    const N = w.w * w.h;
    if (!this._railTmp || this._railTmp.length !== N) this._railTmp = new Uint8Array(N);
    const mask = this._railTmp;
    mask.fill(0);
    (this._netSig || (this._netSig = {}))[k.id] = this._railSig(k);
    const out = (this.railNet || []).filter((s) => s.kingdom !== k.id);
    for (const kind of ['rail', 'maglev']) {
      const lines = this.rails.filter((l) => l.kingdom === k.id && l.kind === kind);
      if (!lines.length) continue;
      const cnt = new Map();
      for (const l of lines) cnt.set(l.a, (cnt.get(l.a) || 0) + 1);
      let root = lines[0].a;
      for (const [vid, c] of cnt) if (c > cnt.get(root)) root = vid;
      const R = this.villages[root];
      if (!R) continue;
      const towns = [];
      for (const l of lines) for (const t of [l.a, l.b]) if (t !== root && !towns.includes(t) && this.villages[t]) towns.push(t);
      const d2 = (t) => Math.hypot(this.villages[t].cx - R.cx, this.villages[t].cz - R.cz);
      towns.sort((a, b) => d2(a) - d2(b));
      const tree = [];
      const at = new Map();
      for (const t of towns) {
        const seg = this._railBranch(kind, k, R, this.villages[t], tree, mask);
        if (!seg) continue;
        at.set(t, tree.length);
        tree.push(seg);
      }
      // the route from the root to the end of each segment
      const pre = (si) => {
        const s = tree[si];
        if (s.parent < 0) return [];
        return pre(s.parent).concat(tree[s.parent].pts.slice(0, s.at * 2));
      };
      const route = (t) => (at.has(t) ? pre(at.get(t)).concat(tree[at.get(t)].pts) : null);
      for (const l of lines) {
        let P = null;
        if (l.a === root) P = route(l.b);
        else if (l.b === root) P = route(l.a) && revPts(route(l.a));
        else if (route(l.a) && route(l.b)) P = revPts(route(l.a)).concat(route(l.b));
        l.pts = P && P.length >= 4 ? P : null; // (trains run on these points: the track's centre)
        // a highway along the whole way to the line's town
        const far = l.b === root ? l.a : l.b;
        if (l.highway && at.has(far)) for (let si = at.get(far); si >= 0; si = tree[si].parent) tree[si].hwOn = true;
      }
      for (const s of tree) {
        if (s.hwOn) s.hw = this._hwMask(s.pts);
        out.push(s);
      }
    }
    this.railNet = out;
    // the tiles under the tracks (trams and buses keep to other streets)
    if (!this.railMask || this.railMask.length !== N) this.railMask = new Uint8Array(N);
    this.railMask.fill(0);
    for (const s of out)
      for (let i = 0; i + 1 < s.pts.length; i += 2) {
        const tx = Math.floor(s.pts[i]),
          tz = Math.floor(s.pts[i + 1]);
        if (w.inBounds(tx, tz)) this.railMask[tz * w.w + tx] |= s.kind === 'rail' ? 1 : 2;
      }
    // and the highway's whole width beside them (4): no building stands on
    // its strip (planner._tileFree reads the mask)
    for (const s of out) {
      if (!s.hw) continue;
      for (let i = 0; i < s.hw.length; i++) {
        if (!s.hw[i]) continue;
        const [hx, hz] = hwPoint(s.pts, i);
        const [ux, uz] = tanAt(s.pts, i);
        for (const o of [-0.45, 0, 0.45]) {
          const tx = Math.floor(hx + uz * o),
            tz = Math.floor(hz - ux * o);
          if (w.inBounds(tx, tz)) this.railMask[tz * w.w + tx] |= 4;
        }
      }
    }
  },
  // one branch of a network: from the nearest point of the tree (or the
  // root's station) to the town's station
  _railBranch(kind, k, root, v, tree, mask) {
    const w = this.world;
    const W = w.w;
    const C = NET[kind];
    const T = this._railTerm(kind, v);
    let head,
      parent = -1,
      at = 0,
      lead;
    if (!tree.length) {
      const o = this._railOrient(this._railTerm(kind, root), T.x, T.z, C.lead);
      head = o.pts;
      lead = o.lead;
    } else {
      // the nearest point of the network
      let bs = -1,
        bj = 0,
        bd = Infinity;
      for (let si = 0; si < tree.length; si++) {
        const p = tree[si].pts;
        for (let j = tree[si].lock0; j <= tree[si].lock1; j++) {
          const d = (p[j * 2] - T.x) ** 2 + (p[j * 2 + 1] - T.z) ** 2;
          if (d < bd) (bd = d), (bs = si), (bj = j);
        }
      }
      if (bs < 0) return null;
      const s = tree[bs],
        p = s.pts;
      const n = p.length / 2;
      const tan = (j) => {
        const a = Math.max(0, j - 1),
          b = Math.min(n - 1, j + 1);
        const dx = p[b * 2] - p[a * 2],
          dz = p[b * 2 + 1] - p[a * 2 + 1];
        const L = Math.hypot(dx, dz) || 1;
        return [dx / L, dz / L];
      };
      const [tx0, tz0] = tan(bj);
      const sg = (T.x - p[bj * 2]) * tx0 + (T.z - p[bj * 2 + 1]) * tz0 >= 0 ? 1 : -1;
      // the switch a little before the foot, the branch leaving along the trunk
      const jj = clamp(bj - sg * Math.round(C.lead / SPACING), s.lock0, s.lock1);
      const [tx, tz] = tan(jj);
      const J = [p[jj * 2], p[jj * 2 + 1]];
      parent = bs;
      at = jj;
      head = [J];
      lead = [J[0] + tx * sg * C.lead, J[1] + tz * sg * C.lead];
    }
    const o2 = this._railOrient(T, lead[0], lead[1], C.lead);
    const tail = [o2.lead, ...o2.pts.slice().reverse()];
    // the way between the two lead points
    const sx = Math.floor(lead[0]),
      sy = Math.floor(lead[1]),
      gx = Math.floor(o2.lead[0]),
      gy = Math.floor(o2.lead[1]);
    let mid = [];
    if (!w.inBounds(sx, sy) || !w.inBounds(gx, gy)) return null;
    if (sx !== gx || sy !== gy) {
      const near = (q) => q?.length && Math.hypot((q[q.length - 1] % W) - gx, ((q[q.length - 1] / W) | 0) - gy) <= 2;
      const mc = kind === 'rail' ? 0.75 : 1;
      let q = civPath(w, sx, sy, gx, gy, this._railCost(kind, mask, false), 14000, mc);
      if (!near(q)) q = civPath(w, sx, sy, gx, gy, this._railCost(kind, mask, true), 16000, mc);
      if (!near(q)) return null;
      mid = q.slice(0, -1).map((i) => [(i % W) + 0.5, ((i / W) | 0) + 0.5]);
    }
    const way = rdp([lead, ...mid, o2.lead], C.eps);
    const pts = fillet([...head, ...way.slice(0, -1), ...tail], C.R);
    if (!pts || pts.length < 4) return null;
    const n = pts.length / 2;
    // no switch on a platform or right at a station's throat
    const arc = [0];
    for (let i = 1; i < n; i++) arc.push(arc[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]));
    const keepS = parent < 0 ? (head.length > 1 ? Math.hypot(head[0][0] - head[1][0], head[0][1] - head[1][1]) : 0) + C.lead : C.lead * 1.5;
    const keepE = (T.station ? T.half * 2 : 0) + C.lead;
    let lock0 = 0,
      lock1 = n - 1;
    while (lock0 < n - 1 && arc[lock0] < keepS) lock0++;
    while (lock1 > lock0 && arc[n - 1] - arc[lock1] < keepE) lock1--;
    const seg = {
      kind,
      kingdom: k.id,
      town: v.id,
      pts,
      parent,
      at,
      lock0,
      lock1,
      junction: parent >= 0,
      start: parent < 0 ? { x: pts[0], z: pts[1], station: !!this._railTerm(kind, root).station } : null,
      end: { x: pts[n * 2 - 2], z: pts[n * 2 - 1], station: T.station },
      lift: null,
      hw: null,
    };
    // a guideway crossing another rises over it; rails cross on a diamond
    {
      const lift = new Float32Array(n);
      let any = false;
      for (const o of tree) {
        const q = o.pts;
        for (let i = 0; i + 1 < n; i++) {
          if (arc[i] < C.lead * 2) continue;
          const ax = pts[i * 2],
            az = pts[i * 2 + 1],
            bx = pts[i * 2 + 2],
            bz = pts[i * 2 + 3];
          for (let j = 0; j + 3 < q.length; j += 2) {
            if (Math.abs(q[j] - ax) > 1 || Math.abs(q[j + 1] - az) > 1) continue;
            if (!segHit(ax, az, bx, bz, q[j], q[j + 1], q[j + 2], q[j + 3])) continue;
            any = true;
            if (kind === 'rail') {
              (seg.xing || (seg.xing = [])).push([ax, az, Math.atan2(bz - az, bx - ax), Math.atan2(q[j + 3] - q[j + 1], q[j + 2] - q[j])]);
              continue;
            }
            for (let m = 0; m < n; m++) {
              const d = Math.abs(arc[m] - arc[i]);
              if (d < 4) lift[m] = Math.max(lift[m], MAG_LIFT * BUILDING.scale * (d < 1.2 ? 1 : 0.5 + 0.5 * Math.cos(((d - 1.2) / 2.8) * Math.PI)));
            }
          }
        }
      }
      if (any && kind === 'maglev') seg.lift = lift;
    }
    for (let i = 0; i < n; i++) {
      const tx = Math.floor(pts[i * 2]),
        tz = Math.floor(pts[i * 2 + 1]);
      if (w.inBounds(tx, tz)) mask[tz * W + tx] |= kind === 'rail' ? 1 : 2;
    }
    return seg;
  },
  _railCost(kind, mask, relaxed) {
    const w = this.world;
    const use = this.use;
    if (kind === 'rail') {
      const base = this._roadCost();
      return (i) => {
        if (mask[i] & 1) return 2.4; // beside its own track: join it at a switch instead
        if (use[i] === USE.ROAD) return 0.75;
        const c = base(i);
        if (c === Infinity) return relaxed && use[i] === USE.BUILDING && w.height[i] >= SEA_LEVEL + 0.03 ? 14 : c;
        return c;
      };
    }
    return (i) => {
      if (mask[i] & 2) return 3;
      if (w.height[i] < SEA_LEVEL) return 1.5;
      if (use[i] === USE.BUILDING) return relaxed ? 2 : 5;
      return 1 + w.slopeAt(i % w.w, (i / w.w) | 0) * 0.6;
    };
  },
  // a highway beside a track wherever it runs outside the towns and on land
  _hwMask(P) {
    const w = this.world;
    const n = P.length / 2;
    const hw = new Uint8Array(n);
    const towns = this.villages.filter((v) => v?.alive);
    for (let i = 0; i < n; i++) {
      const [x, z] = hwPoint(P, i);
      let ok = w.heightAt(x, z) >= SEA_LEVEL + 0.05;
      // never across a building that stands there already
      if (ok && w.inBounds(Math.floor(x), Math.floor(z)) && this.use[Math.floor(z) * w.w + Math.floor(x)] === USE.BUILDING) ok = false;
      for (const v of towns) if (ok && Math.abs(v.cx - x) < v.radius && Math.hypot(v.cx - x, v.cz - z) < v.radius * 0.85) ok = false;
      hw[i] = ok ? 1 : 0;
    }
    // no stubs: short runs are dropped
    for (let i = 0; i < n; ) {
      if (!hw[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < n && hw[j]) j++;
      if (j - i < 8) for (let m = i; m < j; m++) hw[m] = 0;
      i = j;
    }
    return hw;
  },
  // Highways: road tiles laid under the highway beside each track.
  _widenAlong(k) {
    const w = this.world;
    const W = w.w;
    let n = 0;
    for (const s of this.railNet || []) {
      if (s.kingdom !== k.id || !s.hw) continue;
      for (let i = 0; i < s.hw.length; i++) {
        if (!s.hw[i]) continue;
        const [x, z] = hwPoint(s.pts, i);
        const tx = Math.floor(x),
          tz = Math.floor(z);
        if (!w.inBounds(tx, tz)) continue;
        const t = tz * W + tx;
        if (this.use[t] !== USE.FREE || this.railMask?.[t] || w.height[t] < SEA_LEVEL + 0.05 || w.type[t] === TILE.ROCK || w.type[t] === TILE.SNOW) continue;
        let v = null,
          bd = Infinity;
        for (const vid of k.villages) {
          const u = this.villages[vid];
          const d = u?.alive ? Math.hypot(u.cx - x, u.cz - z) : Infinity;
          if (d < bd) (bd = d), (v = u);
        }
        if (v && this.layRoad(v, t)) n++;
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
