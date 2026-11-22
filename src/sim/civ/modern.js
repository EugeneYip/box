import { TILE, SEA_LEVEL, FLORA, FLORA_INFO } from '../../world/constants.js';
import { BUILDING_TYPES } from './catalog.js';
import { USE, YEAR, clamp } from './util.js';
import { civPath } from './pathing.js';
import { TECHS } from './tech.js';
import { BREADTH_FIRST } from './breadth.js';
import { BUILDING } from '../../core/scale.js';
import { isTreeId } from '../flora/species.js';

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
const FARM_WORKS = new Set(['pasture', 'silo', 'barn', 'granary']);
const REACH = { musket: 2.6, rifle: 3.4, fatigues: 3.8, suit: 4.4 };

// ------------------------------------------------------------ rail geometry
// per kind: minimum curve radius, how straight the country run is kept
// (tolerance in tiles), and the lead a branch runs along its trunk or out of
// a platform before it curves away
const NET = {
  rail: { R: 3.2, eps: 0.7, lead: 1.6 },
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
// Track levels: the rail bed and the guideway deck keep a gentle grade (rise
// per tile) over dips in the ground and ride on piers where they leave it,
// instead of following the ground down into a valley and up again.
const GRADE = { rail: 0.2, maglev: 0.14 };
export const MAG_CLEAR = 0.95 * BUILDING.scale; // a guideway's deck over the ground
export const RAIL_BRIDGE_Y = SEA_LEVEL + 0.3 * BUILDING.scale; // a rail bridge's deck over water
// a line that must cross a town's core rides over it on a viaduct this high
// (the bed's top over the street: people and cars pass under its girders)
export const CORE_LIFT = 0.9 * BUILDING.scale;
// a pier stands at most about two storeys over the ground or the water
// (round 20: viaducts on piers as tall as the towers marched through an
// Atomic downtown); past that the bed follows the ground down more steeply
export const PIER_MAX = 1.1 * BUILDING.scale;
// (round 29: a guideway capped at that height plunged down a cliff face like
// a roller coaster; it now keeps its grade on a tall viaduct instead, its
// piers up to six storeys over the valley)
const PIER_MAX_MAG = Math.max(MAG_CLEAR, PIER_MAX) + 5 * BUILDING.scale;
// the clear zone round an airport's plot (tiles): no track, guideway or
// highway is routed through it
const AIR_CLEAR = 3;
const yKey = (x, z) => Math.round(x * 50) * 131072 + Math.round(z * 50);
// seg.ys: the level of each point (rail: the top of the bed; maglev: the
// deck), the upper envelope of the ground under a maximum grade, eased by a
// short moving average; a branch leaves its trunk at the trunk's level
function trackLevels(w, seg, up) {
  const P = seg.pts;
  const n = P.length / 2;
  const mag = seg.kind === 'maglev';
  const G = GRADE[seg.kind];
  const y = new Float32Array(n),
    ds = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const h = w.heightAt(P[i * 2], P[i * 2 + 1]);
    y[i] = mag ? (h < SEA_LEVEL ? SEA_LEVEL + MAG_CLEAR * 0.8 : h + MAG_CLEAR) : h < SEA_LEVEL + 0.02 ? RAIL_BRIDGE_Y : h + 0.02;
    // (a rail across a town's core: on a viaduct over its streets)
    if (!mag && seg.core?.[i]) y[i] = Math.max(y[i], Math.max(h, SEA_LEVEL) + CORE_LIFT);
    if (i) {
      const d = Math.hypot(P[i * 2] - P[i * 2 - 2], P[i * 2 + 1] - P[i * 2 - 1]);
      ds[i] = d > 40 ? 1e3 : d; // (the seam of a round world)
    }
  }
  const clear = y.slice();
  // the highest the bed may ride: two storeys of pier over the ground
  const cap = new Float32Array(n);
  for (let i = 0; i < n; i++) cap[i] = Math.max(clear[i], Math.max(w.heightAt(P[i * 2], P[i * 2 + 1]), SEA_LEVEL) + (mag ? PIER_MAX_MAG : PIER_MAX));
  // (a branch starts at its trunk's level and keeps the grade away from it)
  const y0 = up?.ys && seg.at < up.ys.length ? up.ys[seg.at] : null;
  if (y0 != null) y[0] = Math.max(y[0], y0);
  for (let i = 1; i < n; i++) y[i] = Math.min(cap[i], Math.max(y[i], y[i - 1] - G * ds[i]));
  for (let i = n - 2; i >= 0; i--) y[i] = Math.min(cap[i], Math.max(y[i], y[i + 1] - G * ds[i + 1]));
  const r = mag ? 4 : 2;
  const s = y.slice();
  for (let i = 0; i < n; i++) {
    let a = 0,
      c = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) (a += s[j]), c++;
    y[i] = Math.min(cap[i], Math.max(a / c, clear[i]));
  }
  if (y0 != null) {
    let arc = 0;
    for (let i = 0; i < n && arc < 3; i++) {
      if (i) arc += ds[i];
      const t = Math.min(1, arc / 3),
        u = t * t * (3 - 2 * t);
      y[i] = Math.min(cap[i], y0 + (y[i] - y0) * u);
    }
  }
  seg.ys = y;
}

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
  // the level a train runs at on point k of its route P (a line's pts) at
  // (x, z): the rail bed (ground level: trains add their wheels) or the
  // guideway's deck (with a flyover's lift); null off the drawn network
  railDeckAt(kind, P, k, x, z) {
    const M = this._railYMap?.[kind];
    if (!M || !P || P.length < 4) return null;
    const n = P.length / 2;
    const i = Math.max(0, Math.min(n - 2, k >> 1)),
      j = i + 1;
    const ya = M.get(yKey(P[i * 2], P[i * 2 + 1])),
      yb = M.get(yKey(P[j * 2], P[j * 2 + 1]));
    if (ya == null || yb == null) return ya ?? yb ?? null;
    const dx = P[j * 2] - P[i * 2],
      dz = P[j * 2 + 1] - P[i * 2 + 1];
    const L2 = dx * dx + dz * dz;
    const t = L2 > 1e-9 ? clamp(((x - P[i * 2]) * dx + (z - P[i * 2 + 1]) * dz) / L2, 0, 1) : 0;
    return ya + (yb - ya) * t;
  },
  // the ground under the tracks changed (terraforming, a crater): new levels
  railRelevel() {
    for (const s of this.railNet || []) trackLevels(this.world, s, s.up);
    this._railYIndex();
  },
  _railYIndex() {
    const M = (this._railYMap = { rail: new Map(), maglev: new Map() });
    for (const s of this.railNet || []) {
      if (!s.ys) continue;
      const m = M[s.kind];
      for (let i = 0; i < s.ys.length; i++) m.set(yKey(s.pts[i * 2], s.pts[i * 2 + 1]), s.kind === 'rail' ? s.ys[i] - 0.02 : s.ys[i] + (s.lift ? s.lift[i] : 0));
    }
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
      // (round 25: a tighter haze round the works themselves; it drifted
      // out over the town's ordinary blocks as puffs)
      if (s > 0.02) list.push({ x: b.x, z: b.z, r: 1.6 + def.smoke * 2, s, kingdom: b.kingdom });
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
    // a Modern or Future town keeps its paving free of farming before any
    // other plan (it ran after the Industrial core, which returns early
    // while a town saves up for its factory or station: fenced fields and
    // pens stayed among the apartments)
    if ((K.era || 0) >= 5) this._clearTownFarms(v);
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
      if (src && src.village !== v.id) tryBuild('pylon', () => this._placeOutskirts(v, 'pylon', this._townEdge(v) - 1.5, this._townEdge(v) + 2, src.x, src.z));
    }
    // Radio
    if (room() && has('radio') && town && count('radiomast') === 0) tryBuild('radiomast', out('radiomast', 3, 2));
    // Reinforced Concrete: apartment blocks (and taller ones in the cities)
    if (room() && has('concrete') && busy && (v.housing - pop < 6 + v.tier * 2 || count('apartment') === 0) && count('apartment') < 1 + v.tier * 2) tryBuild('apartment');
    else if (room() && has('concrete') && city) {
      const a = v.buildings.find((b) => b.alive && b.type === 'apartment' && !b.constructing && !b.upgrading && b.level < 2);
      if (a && v.housing - pop < 6) upgrade(a);
    }
    // A paved town's streets are for houses, not wheat: from the Industrial
    // era a field plot inside the paving (planner _pavedRadius) is given up
    // at a time and turns to grass (mown lawn from the Modern era, Terrain);
    // new plots go out beyond the paving (_planPlot). Fenced fields stood
    // between the apartments of Modern towns.
    // The handover waits for the new fields (round 22: the inner plots went
    // years before the outer ones were sown, and the Industrial century lost
    // 14-17% of its people for fifty years): the town keeps sowing outer
    // plots for the inner ones it holds (v.innerFields raises its field
    // target, Civilization._planVillage), and an inner plot goes only once
    // the rest would still meet the target with no outer plot still being
    // tilled, or while the granary is near full.
    if ((K.era || 0) >= 4 && v.plots?.length) {
      const core = this._pavedRadius(v);
      const w = this.world;
      let p = null,
        inner = 0,
        sowing = 0;
      for (const q of v.plots) {
        if (Math.hypot((q.x0 + q.x1 + 1) / 2 - v.cx, (q.y0 + q.y1 + 1) / 2 - v.cz) < core) {
          inner += q.tiles.length;
          if (!p) p = q;
        } else if (q.tiles.some((i) => w.type[i] !== TILE.FARMLAND)) sowing++;
      }
      v.innerFields = inner;
      const target = 8 + v.pop * 1.1;
      const rest = p ? v.fieldCount - p.tiles.length : 0;
      const fed = (sowing === 0 && rest >= target) || (v.food >= (v.foodCap || 1e9) * 0.85 && !v.starving && rest >= target * 0.75);
      if (!(p && fed && this.rng.chance((K.era || 0) >= 5 ? 1 : 0.5))) p = null;
      if (p) {
        v.innerFields -= p.tiles.length;
        const w = this.world;
        for (const i of [...p.tiles]) {
          this._removePlotTile(i);
          const x = i % w.w,
            y = (i / w.w) | 0;
          if (w.flora[i] === FLORA.WHEAT) w.setFlora(x, y, FLORA.NONE);
          if (w.type[i] === TILE.FARMLAND) w.setType(x, y, TILE.GRASS);
        }
      }
    }
    // ...and its farm works: a pen, silo, barn or granary inside the paved
    // town is given up (a herd grazed among the towers, silos stood in the
    // capital's square, cows by an Industrial town's square); a new one goes
    // out beyond the paving (planner.js)
    if ((K.era || 0) >= 4 && this.rng.chance(0.3)) {
      const core = this._pavedRadius(v) - 1.5;
      const e5 = (K.era || 0) >= 5;
      const p = v.buildings.find((b) => b.alive && (b.type === 'pasture' || (e5 && (b.type === 'silo' || b.type === 'barn' || b.type === 'granary'))) && !b.constructing && Math.hypot(b.x - v.cx, b.z - v.cz) < core);
      if (p) {
        this.destroyBuilding(p, 'cancelled');
        p.ruinT -= YEAR * 10; // they leave no ruin: cleared on the next sweep
      }
    }
    // Railways: a station in each town a line reaches
    if (room() && has('railways') && v.railEnds > 0 && count('station') === 0) tryBuild('station', () => this._placeStation(v));
    // Computing: a research campus in the capital and the cities
    if (room() && has('computing') && (city || isCap) && count('campus') === 0) tryBuild('campus', out('campus', 3, 4));
    // Skyscrapers rise at city centres (one office tower in a big town)
    if (room() && has('skyscrapers') && (city || (town && pop >= 40)) && count('skyscraper') < (isCap ? 3 : city ? 2 : 1) && v.housing - pop < 10) tryBuild('skyscraper', () => this.placeAlongRoad(v, 'skyscraper', this._bias(v, 'market')));
    // Arcology: a whole city in one green tower
    if (room() && has('arcology') && (isCap || city) && count('arcology') === 0 && rc('arcology') < 2) tryBuild('arcology', out('arcology', 4, 7));
    // Flight: airfields; Jets: airports
    if (room() && has('flight') && (isCap || city) && count('airfield') + count('airport') === 0 && rc('airfield') + rc('airport') < Math.max(1, Math.ceil(towns / 3))) tryBuild('airfield', out('airfield', 5, 8)) && this._airZoneBuild();
    if (room() && has('jets') && (isCap || city) && count('airport') === 0 && rc('airport') < (towns >= 6 ? 2 : 1)) tryBuild('airport', () => this._placeAirport(v));
    // Container Shipping: a port with cranes in a harbour town
    if (room() && has('containers') && v.coastal && town && count('docks') > 0 && count('containerport') === 0) tryBuild('containerport', () => this._placeDocks(v, 'containerport'));
    // Rocketry: a launch pad; Orbital Industry: a spaceport (far out of town)
    if (room() && has('rocketry') && (isCap || city) && rc('launchpad') === 0) tryBuild('launchpad', out('launchpad', 6, 12));
    if (room() && has('orbital') && (isCap || city) && rc('spaceport') === 0) tryBuild('spaceport', out('spaceport', 6, 12));
  },
  // Fields, pens and farm works inside a Modern or Future town's paving
  // (planner _pavedRadius) are given up, a few at a time (its plots and any
  // neighbour's: a hamlet's plots lay inside a grown town), and so are
  // plots round a wonder (fenced fields stood by a Future wonder).
  // A plot is judged by its nearest tile, not its centre (plots straddling
  // the edge kept their inner half). New plots stay out (planner _planPlot).
  _clearTownFarms(v) {
    const w = this.world;
    const core = this._pavedRadius(v);
    const near = (q, x, z, r) => Math.hypot(Math.max(q.x0 - x, 0, x - q.x1 - 1), Math.max(q.y0 - z, 0, z - q.y1 - 1)) < r;
    const mons = [];
    for (const b of v.buildings) if (b.alive && BUILDING_TYPES[b.type]?.monument) mons.push(b);
    let n = 0;
    const nearV = [];
    for (const u of this.villages) if (u?.alive && Math.abs(u.cx - v.cx) < core + 30 && Math.abs(u.cz - v.cz) < core + 30) nearV.push(u);
    for (const u of nearV) {
      if (!u.plots?.length) continue;
      for (const p of [...u.plots]) {
        let drop = near(p, v.cx, v.cz, core);
        for (const m of mons) if (!drop && Math.max(p.x0 - (m.tx + m.w), m.tx - p.x1 - 1, p.y0 - (m.ty + m.h), m.ty - p.y1 - 1) < 3) drop = true;
        if (!drop) continue;
        for (const i of [...p.tiles]) {
          this._removePlotTile(i);
          const x = i % w.w,
            y = (i / w.w) | 0;
          if (w.flora[i] === FLORA.WHEAT) w.setFlora(x, y, FLORA.NONE);
          if (w.type[i] === TILE.FARMLAND) w.setType(x, y, TILE.GRASS);
        }
        if (++n >= 2) return;
      }
    }
    // its pens, silos, barns and granaries inside the paving, out to its
    // edge (they were kept within a tile and a half of it, by the
    // apartments); they are raised again beyond it (planner _placeOutskirts)
    const p = v.buildings.find((b) => b.alive && FARM_WORKS.has(b.type) && !b.constructing && Math.hypot(b.x - v.cx, b.z - v.cz) < core);
    if (p) {
      this.destroyBuilding(p, 'cancelled');
      p.ruinT -= YEAR * 10; // no ruin: cleared on the next sweep
    }
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
    // (a terrace row for each block of the main street: one or two row
    // houses left a 42-building Industrial town reading as a village)
    if (room() && industry && count('factory') > 0 && count('rowhouse') < 2 + 2 * v.tier && (v.housing - v.pop < 6 || count('rowhouse') < 2)) tryBuild('rowhouse');
    if (room() && has('railways') && v.railEnds > 0 && count('station') === 0) {
      // at the edge of town where the line comes in (never in the core)
      tryBuild('station', () => this._placeStation(v));
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
  // A town's railway station: at the edge of town where its line comes in
  // (the line's buffer stop out there, until the station stands), its
  // platform turned along the way the line runs in; never in the core.
  _placeStation(v) {
    const def = BUILDING_TYPES.station;
    const w = this.world;
    // where the line ends in this town now
    let ex = null,
      ez = null,
      bd = Infinity;
    for (const s of this.railNet || []) {
      if (s.kind !== 'rail' || s.kingdom !== v.kingdom) continue;
      const n = s.pts.length / 2;
      const ends = [];
      if (s.town === v.id) ends.push(n - 1);
      if (s.parent < 0) ends.push(0);
      for (const i of ends) {
        const x = s.pts[i * 2],
          z = s.pts[i * 2 + 1];
        const d = Math.hypot(x - v.cx, z - v.cz);
        if (d < bd && d < ((this._conurbs().get(v.id)?.n || 1) > 1 ? 45 : (v.buildRadius || 8) * 1.8 + 6)) (bd = d), (ex = x), (ez = z);
      }
    }
    const R0 = Math.max(4, (v.buildRadius || v.radius || 6) * 0.8);
    const inConurb = (this._conurbs().get(v.id)?.n || 1) > 1;
    if (ex == null) return inConurb ? null : this._placeOutskirts(v, 'station', R0, (v.buildRadius || 6) + 3, null, null);
    // the way out of town at that end (the platform runs along it)
    const ox = ex - v.cx,
      oz = ez - v.cz;
    const oL = Math.hypot(ox, oz) || 1;
    const ux = ox / oL,
      uz = oz / oL;
    const rc = Math.max(3, (v.radius || 6) * 0.55);
    const conurb = (this._conurbs().get(v.id)?.n || 1) > 1;
    if (conurb) this._railBlocks();
    let best = null,
      bs = Infinity;
    for (let dz = -5; dz <= 5; dz++)
      for (let dx = -5; dx <= 5; dx++)
        for (const rot of [0, 1]) {
          const fw = rot & 1 ? def.h : def.w,
            fh = rot & 1 ? def.w : def.h;
          const x = Math.floor(ex + dx - fw / 2 + 0.5),
            y = Math.floor(ez + dz - fh / 2 + 0.5);
          const cx = x + fw / 2,
            cz = y + fh / 2;
          const dc = Math.hypot(cx - v.cx, cz - v.cz);
          // (round 25: at the edge of town, not in among its blocks, so the
          // line never has to wind in through them)
          if (dc < Math.max(rc + 1.5, (v.buildRadius || v.radius || 6) * 0.8)) continue;
          // (round 27: in a conurbation, on its outer edge only)
          if (conurb && this._deepInConurb(cx, cz, 2.5)) continue;
          if (!this._footprintOK(x, y, fw, fh, 0.9)) continue;
          // the long side along the way out (rot 0: along x)
          const ax = rot & 1 ? 0 : 1,
            az = rot & 1 ? 1 : 0;
          const across = Math.abs(ax * uz - az * ux);
          const st = this._footprintStats(x, y, fw, fh);
          const sc = Math.hypot(cx - ex, cz - ez) + across * 2.5 + st.slope * 3 + st.trees * 0.3 + this.rng.next() * 0.5;
          if (sc < bs) (bs = sc), (best = { x, y, rot, ax, az });
        }
    if (!best) return conurb ? null : this._placeOutskirts(v, 'station', R0, (v.buildRadius || 6) + 3, ex, ez);
    // the door (+Z of the model) faces the town; the track runs behind it
    let rot = best.rot;
    const [fx, fz] = rot === 0 ? [0, 1] : [1, 0];
    if (fx * (v.cx - (best.x + 0.5)) + fz * (v.cz - (best.y + 0.5)) < 0) rot += 2;
    const b = this.addBuilding(v, 'station', best.x, best.y, rot);
    const dx = Math.floor(b.doorX),
      dz = Math.floor(b.doorZ);
    if (w.inBounds(dx, dz)) this._connectToRoads(v, dx, dz);
    return b;
  },
  // An airport on flat, open ground beyond the town: its whole plot and a
  // ring round it level, dry and clear of buildings, no track or highway
  // within its clear zone, and no hill rising off either end of the runway
  // (round 18: a short strip squeezed into a canyon floor under cliffs,
  // wrapped by a rail loop).
  _placeAirport(v, type = 'airport') {
    const def = BUILDING_TYPES[type];
    const w = this.world;
    const W = w.w;
    const rng = this.rng;
    const minR = Math.max(6, (v.buildRadius || 8) * 0.8),
      maxR = (v.buildRadius || 8) + 30;
    const M = AIR_CLEAR;
    let best = null,
      bs = Infinity;
    // (flat ground first; a little rougher if a realm has none near)
    for (let k = 0; k < 480 && !(k === 320 && best); k++) {
      const L = k < 320 ? { fp: 0.5, ring: 1.1, rise: 1.4 } : { fp: 0.9, ring: 1.9, rise: 2.4 };
      const a = rng.float(0, Math.PI * 2);
      const r = rng.float(minR, maxR);
      const rot = rng.int(0, 3);
      const fw = rot & 1 ? def.h : def.w,
        fh = rot & 1 ? def.w : def.h;
      const x = Math.floor(v.cx + Math.cos(a) * r - fw / 2),
        y = Math.floor(v.cz + Math.sin(a) * r - fh / 2);
      if (x < M + 2 || y < M + 2 || x + fw + M + 2 > w.w || y + fh + M + 2 > w.h) continue;
      if (this.landId[y * W + x] !== v.landId) continue;
      // (open ground or the town's own fields: an airport may take over
      // field plots, which ringed every town and left no room)
      let fmin = Infinity,
        fmax = -Infinity,
        ok = true;
      for (let yy = y; yy < y + fh && ok; yy++)
        for (let xx = x; xx < x + fw; xx++) {
          const i = yy * W + xx;
          if (!(this._tileFree(i) || (this.use[i] === USE.PLOT && !this.railMask?.[i] && w.height[i] >= SEA_LEVEL + 0.05))) {
            ok = false;
            break;
          }
          fmin = Math.min(fmin, w.height[i]);
          fmax = Math.max(fmax, w.height[i]);
        }
      if (!ok || fmax - fmin > L.fp) continue;
      // the plot and its clear zone: level, open, no line, no building
      let hmin = Infinity,
        hmax = -Infinity,
        trees = 0,
        bad = false;
      for (let yy = y - M; yy < y + fh + M && !bad; yy++)
        for (let xx = x - M; xx < x + fw + M; xx++) {
          const i = yy * W + xx;
          if (this.railMask?.[i]) {
            bad = true;
            break;
          }
          const inner = xx >= x - 1 && xx <= x + fw && yy >= y - 1 && yy <= y + fh;
          if (inner && this.use[i] === USE.BUILDING) {
            bad = true;
            break;
          }
          const h = w.height[i];
          if (h < SEA_LEVEL) continue;
          if (h < hmin) hmin = h;
          if (h > hmax) hmax = h;
          if (FLORA_INFO[w.flora[i]]?.isTree) trees++;
        }
      if (bad || hmax - hmin > L.ring) continue;
      // the runway's approaches: four tiles off each end, no rise over it
      const base = w.height[(y + (fh >> 1)) * W + x + (fw >> 1)];
      const along = fw >= fh;
      let rise = 0;
      for (let e = 1; e <= 5 && !bad; e++)
        for (const sd of [-1, 1]) {
          const px = along ? (sd < 0 ? x - M - e : x + fw + M + e - 1) : x + (fw >> 1),
            py = along ? y + (fh >> 1) : sd < 0 ? y - M - e : y + fh + M + e - 1;
          if (!w.inBounds(px, py)) continue;
          rise = Math.max(rise, w.height[py * W + px] - base);
        }
      if (rise > L.rise) continue;
      // no street or building off either end of the runway, and few beside it
      let roads = 0;
      for (let yy = y - M; yy < y + fh + M && !bad; yy++)
        for (let xx = x - M - 2; xx < x + fw + M + 2; xx++) {
          if (yy < y - M || !w.inBounds(xx, yy)) continue;
          const u = this.use[yy * W + xx];
          if (u !== USE.ROAD && u !== USE.BUILDING) continue;
          const ox = xx < x ? x - xx : xx >= x + fw ? xx - x - fw + 1 : 0,
            oy = yy < y ? y - yy : yy >= y + fh ? yy - y - fh + 1 : 0;
          const end = along ? ox > 0 && oy <= 1 : oy > 0 && ox <= 1;
          if (end) bad = true;
          else if (ox <= M && oy <= M) roads++;
        }
      if (!along)
        for (let yy = y - M - 2; yy < y + fh + M + 2 && !bad; yy++)
          for (let xx = x - 1; xx <= x + fw; xx++) {
            if (!w.inBounds(xx, yy) || (yy >= y && yy < y + fh)) continue;
            const u = this.use[yy * W + xx];
            if (u === USE.ROAD || u === USE.BUILDING) bad = true;
          }
      if (bad) continue;
      const st = this._footprintStats(x, y, fw, fh);
      const sc = st.slope * 4 + (hmax - hmin) * 2 + rise * 1.5 + trees * 0.05 + roads * 0.15 + r * 0.06 + rng.next();
      if (sc < bs) (bs = sc), (best = { x, y, rot });
    }
    if (!best) return null;
    {
      const fw = best.rot & 1 ? def.h : def.w,
        fh = best.rot & 1 ? def.w : def.h;
      for (let yy = best.y; yy < best.y + fh; yy++)
        for (let xx = best.x; xx < best.x + fw; xx++) {
          const i = yy * W + xx;
          if (this.use[i] !== USE.PLOT) continue;
          this._removePlotTile(i);
          if (w.flora[i] === FLORA.WHEAT) w.setFlora(xx, yy, FLORA.NONE);
        }
    }
    const b = this.addBuilding(v, type, best.x, best.y, best.rot);
    this._airZoneBuild();
    const dx = Math.floor(b.doorX),
      dz = Math.floor(b.doorZ);
    if (w.inBounds(dx, dz)) this._connectToRoads(v, dx, dz);
    return b;
  },
  // The clear zone round every airport and airfield (round 20: a street ran
  // right up to the runway's end and a cluster of silos stood beside the
  // apron): airZone[i] 1 beside the plot (no building or plot; a street
  // only at a high price: planner._tileFree, _roadCost), 2 off either end of
  // the runway (no street at all)
  _airZoneBuild() {
    const w = this.world;
    const W = w.w,
      N = W * w.h;
    if (!this.airZone || this.airZone.length !== N) this.airZone = new Uint8Array(N);
    const Z = this.airZone;
    Z.fill(0);
    for (const b of this.buildings) {
      if (!b.alive || (b.type !== 'airport' && b.type !== 'airfield')) continue;
      const M = b.type === 'airport' ? AIR_CLEAR : 2;
      const E = M + (b.type === 'airport' ? 3 : 2); // the approaches off the ends
      const along = b.w >= b.h; // the runway runs along the plot's long side
      for (let y = b.ty - E; y < b.ty + b.h + E; y++)
        for (let x = b.tx - E; x < b.tx + b.w + E; x++) {
          if (!w.inBounds(x, y)) continue;
          if (x >= b.tx && x < b.tx + b.w && y >= b.ty && y < b.ty + b.h) continue;
          const ox = x < b.tx ? b.tx - x : x >= b.tx + b.w ? x - b.tx - b.w + 1 : 0,
            oy = y < b.ty ? b.ty - y : y >= b.ty + b.h ? y - b.ty - b.h + 1 : 0;
          // off an end: beyond the short side, within a tile of the runway's line
          const end = along ? ox > 0 && oy <= 1 : oy > 0 && ox <= 1;
          if (end && (along ? ox : oy) <= E) Z[y * W + x] = 2;
          else if (Math.max(ox, oy) <= M && Z[y * W + x] < 1) Z[y * W + x] = 1;
        }
      // round 25: no tree stands on the plot or within two tiles of it, so
      // the half-size jets on the apron do not park under tree crowns
      for (let y = b.ty - 2; y < b.ty + b.h + 2; y++)
        for (let x = b.tx - 2; x < b.tx + b.w + 2; x++) {
          if (!w.inBounds(x, y)) continue;
          const f = w.flora[y * W + x];
          if (f && (isTreeId(f) || f === FLORA.DEAD_TREE || f === FLORA.STUMP)) w.setFlora(x, y, FLORA.NONE);
        }
    }
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
      if (!v?.alive || v === cap || v.landId !== cap.landId || this.railBetween(cap.id, v.id) || this._sameConurb(cap.id, v.id)) continue;
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
    // (one trunk to the farthest city, then at most one branch: never a web)
    if (k.techs.has('maglev') && this.rails.filter((x) => x.kingdom === k.id && x.kind === 'maglev').length < 2) {
      let l = null,
        ld = 14;
      for (const x of this.rails) {
        if (x.kingdom !== k.id || x.kind !== 'rail') continue;
        const A = this.villages[x.a],
          B = this.villages[x.b];
        if (!(A?.tier >= 1 && B?.tier >= 1)) continue;
        const d = Math.hypot(A.cx - B.cx, A.cz - B.cz);
        if (d > ld) (ld = d), (l = x);
      }
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
    if (this._conurbTidy(k)) this.infraVersion++;
    if ((this._netSig || {})[k.id] !== this._railSig(k)) {
      this._railNetBuild(k);
      this.infraVersion++;
    }
  },
  _railSig(k) {
    // (and the size of the realm's towns: a town that grows out over a
    // line has it re-routed round its new edge)
    let s = '';
    for (const vid of k.villages) {
      const v = this.villages[vid];
      if (v?.alive) s += Math.round(Math.max(v.radius || 6, (v.buildRadius || 0) + 1) / 2) + '.';
    }
    s += '|';
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
    let s = this._stationOf(v);
    if (s && this._deepInConurb(s.x, s.z, 3)) s = null;
    if (s) {
      const r = s.rotation || 0,
        S = BUILDING.scale;
      return { x: s.x + Math.sin(r) * ST_Z * S, z: s.z + Math.cos(r) * ST_Z * S, dx: Math.cos(r), dz: -Math.sin(r), half: ST_HALF * S, station: true };
    }
    const x = v.hall?.alive ? v.hall.doorX : v.cx,
      z = v.hall?.alive ? v.hall.doorZ : v.cz;
    // (no station yet: the line stops at the edge of town, where the
    // station will stand, instead of running in to the square)
    return { x, z, dx: 0, dz: 0, half: 0, station: false, stop: clamp((v.buildRadius || v.radius || 6) * 0.95, 4, 14), conurb: (this._conurbs().get(v.id)?.n || 1) > 1 };
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
    let st = Math.min(T.stop || 0, T.conurb ? L - 2 : L * 0.6);
    // the buffer stop never stands in a street or on a plot: on along the
    // way out to the first open ground
    const w = this.world;
    // (round 27: in a conurbation, on out to its outer edge)
    for (let k = 0; k < 50; k++) {
      const tx = Math.floor(T.x + ex * st),
        tz = Math.floor(T.z + ez * st);
      if (!w.inBounds(tx, tz)) break;
      const u = this.use[tz * w.w + tx];
      const b = this._railBlk?.[tz * w.w + tx];
      if (b === 253 && st < L - 1) {
        st += 0.6;
        continue;
      }
      if (k >= 10 || (u !== USE.ROAD && u !== USE.BUILDING && !(b >= 254))) break;
      st += 0.6;
    }
    const x = T.x + ex * st,
      z = T.z + ez * st;
    return { pts: [[x, z]], lead: [x + ex * lead * 0.6, z + ez * lead * 0.6] };
  },
  _railNetBuild(k) {
    const w = this.world;
    const N = w.w * w.h;
    if (!this._railTmp || this._railTmp.length !== N) this._railTmp = new Uint8Array(N);
    const mask = this._railTmp;
    mask.fill(0);
    // (the tiles one to three off this network's own track: _railCost)
    if (!this._railNear || this._railNear.length !== N) this._railNear = new Uint8Array(N);
    this._railNear.fill(0);
    (this._netSig || (this._netSig = {}))[k.id] = this._railSig(k);
    const out = (this.railNet || []).filter((s) => s.kingdom !== k.id);
    this._railBlocks();
    for (const kind of ['rail', 'maglev']) {
      const lines = this.rails.filter((l) => l.kingdom === k.id && l.kind === kind);
      if (!lines.length) continue;
      this._railCorridor(k, kind, out);
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
      // a second line out of the root's station runs on through its
      // platform past the first line's end: no buffer stop across the rails
      const roots = tree.filter((s) => s.parent < 0 && s.start);
      if (roots.length > 1)
        for (const s of roots)
          for (const o of roots) {
            if (o === s) continue;
            const P = o.pts;
            for (let i = 0; i + 1 < Math.min(P.length, 60); i += 2)
              if (Math.hypot(P[i] - s.start.x, P[i + 1] - s.start.z) < 0.4) {
                s.start.through = true;
                break;
              }
          }
      for (const s of tree) {
        s.up = s.parent >= 0 ? tree[s.parent] : null;
        if (kind === 'rail') s.core = this._railCoreRuns(s);
        trackLevels(w, s, s.up);
        if (s.hwOn) s.hw = this._hwMask(s, out.concat(tree));
        out.push(s);
      }
    }
    this.railNet = out;
    this._railYIndex();
    // the tiles under the tracks (trams and buses keep to other streets)
    if (!this.railMask || this.railMask.length !== N) this.railMask = new Uint8Array(N);
    this.railMask.fill(0);
    // (8: the rail rides over this tile on a bridge or a viaduct: people
    // and cars pass under it)
    for (const s of out)
      for (let i = 0; i + 1 < s.pts.length; i += 2) {
        const tx = Math.floor(s.pts[i]),
          tz = Math.floor(s.pts[i + 1]);
        if (!w.inBounds(tx, tz)) continue;
        const t = tz * w.w + tx;
        if (s.kind !== 'rail') {
          this.railMask[t] |= 2;
          continue;
        }
        const raised = s.ys && s.ys[i >> 1] - Math.max(w.height[t], SEA_LEVEL) > 0.3;
        this.railMask[t] |= raised ? 8 : 1;
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
  // Round 27: towns whose built footprints touch form one conurbation:
  // vid -> {g (the group's first town), n (towns in it)}; cached per tick
  _conurbs() {
    const now = this.game.time.total;
    if (this._conurbM && this._conurbT === now && this._conurbN === this.villages.length) return this._conurbM;
    const V = this.villages.filter((v) => v?.alive && Number.isFinite(v.cx));
    const par = new Map(V.map((v) => [v.id, v.id]));
    const find = (a) => {
      while (par.get(a) !== a) a = par.get(a);
      return a;
    };
    // (the built ground only: blocks and streets that actually meet; the
    // wider town radius chained fifteen towns into one)
    const R = (v) => (v.buildRadius || (v.radius || 6) * 0.7) + 0.5;
    for (let i = 0; i < V.length; i++)
      for (let j = i + 1; j < V.length; j++) {
        const a = V[i],
          b = V[j];
        const lim = R(a) + R(b);
        if (Math.abs(a.cx - b.cx) > lim || Math.abs(a.cz - b.cz) > lim) continue;
        if (Math.hypot(a.cx - b.cx, a.cz - b.cz) < lim) {
          const ra = find(a.id),
            rb = find(b.id);
          if (ra !== rb) par.set(ra, rb);
        }
      }
    const cnt = new Map();
    for (const v of V) {
      const g = find(v.id);
      cnt.set(g, (cnt.get(g) || 0) + 1);
    }
    const M = new Map();
    for (const v of V) {
      const g = find(v.id);
      M.set(v.id, { g, n: cnt.get(g) });
    }
    this._conurbM = M;
    this._conurbT = now;
    this._conurbN = this.villages.length;
    return M;
  },
  _sameConurb(a, b) {
    const M = this._conurbs();
    const A = M.get(a),
      B = M.get(b);
    return !!(A && B && A.n > 1 && A.g === B.g);
  },
  // (x, z) deep inside a conurbation's closed area: no open ground outside
  // it within r tiles (B: _railBlk)
  _deepInConurb(x, z, r = 3) {
    const w = this.world;
    const B = this._railBlk;
    if (!B) return false;
    const at = (px, pz) => {
      const tx = Math.floor(px),
        tz = Math.floor(pz);
      return w.inBounds(tx, tz) ? B[tz * w.w + tx] : 0;
    };
    const b0 = at(x, z);
    if (b0 !== 253 && b0 !== 255) return false;
    for (let a = 0; a < 16; a++) {
      const c = Math.cos((a / 16) * Math.PI * 2),
        s = Math.sin((a / 16) * Math.PI * 2);
      for (let d = 0.5; d <= r; d += 0.5) {
        const b = at(x + c * d, z + s * d);
        if (b !== 253 && b !== 255 && b !== 2 && b !== 1) return false;
      }
    }
    return true;
  },
  // a conurbation's lines between its own towns are dropped (it is one
  // place), and a station left deep inside it by the merger is cleared (the
  // line's new end on the outer edge gets a station of its own)
  _conurbTidy(k) {
    let changed = false;
    const keep = this.rails.filter((l) => !(l.kingdom === k.id && this._sameConurb(l.a, l.b)));
    if (keep.length !== this.rails.length) {
      this.rails = keep;
      this._railEnds();
      changed = true;
    }
    const CB = this._conurbs();
    let blk = false;
    for (const vid of k.villages) {
      const v = this.villages[vid];
      if (!v?.alive || (CB.get(vid)?.n || 1) < 2) continue;
      const st = this._stationOf(v);
      if (!st || st.constructing) continue;
      if (!blk) {
        this._railBlocks();
        blk = true;
      }
      if (!this._deepInConurb(st.x, st.z, 3)) continue;
      this._fx?.('dust', st.x, st.z, 1.2, true);
      this._unbuild(st, USE.FREE);
      changed = true;
    }
    return changed;
  },
  // Where a track may not run, or runs at a price (rebuilt with each
  // network): 255 a town's square (never: a line never crosses the paving
  // before a hall), 254 an airport's clear zone (never; dear when nothing
  // else is found), 2 a town's core (a line keeps round it, or crosses it
  // on a viaduct), 1 the rest of a town (dear: round 20, lines ran
  // diagonally through blocks and lawns and braided through the streets),
  // 3 a ring round the town's edge (cheap: the way round a town)
  _railBlocks() {
    const w = this.world;
    const W = w.w,
      H = w.h,
      N = W * H;
    if (!this._railBlk || this._railBlk.length !== N) this._railBlk = new Uint8Array(N);
    const B = this._railBlk;
    B.fill(0);
    this._airZoneBuild();
    const CB = this._conurbs();
    // the square before the hall and a tile round it
    // (round 29: a rail line crossed an Industrial town's main square past
    // its fountain, which stands up to six tiles out from the door: the
    // whole open plaza before the hall, out past the fountain, is closed,
    // in a conurbation's towns too)
    const markHall = (v) => {
      const h = v.hall;
      if (!h?.alive) return;
      {
        const cx = Math.floor(h.doorX),
          cz = Math.floor(h.doorZ);
        let ux = h.doorX - (h.x ?? h.doorX),
          uz = h.doorZ - (h.z ?? h.doorZ);
        const uL = Math.hypot(ux, uz) || 1;
        ux /= uL;
        uz /= uL;
        const fx = h.doorX + ux * 3.5,
          fz = h.doorZ + uz * 3.5;
        for (let dz = -7; dz <= 7; dz++)
          for (let dx = -7; dx <= 7; dx++) {
            const x = cx + dx,
              y = cz + dz;
            if (!w.inBounds(x, y)) continue;
            const px = x + 0.5,
              pz = y + 0.5;
            if ((Math.abs(dx) <= 3 && Math.abs(dz) <= 3) || Math.hypot(px - h.doorX, pz - h.doorZ) < 4.5 || Math.hypot(px - fx, pz - fz) < 4.5) B[y * W + x] = 255;
          }
      }
    };
    for (const v of this.villages) {
      if (!v?.alive || !Number.isFinite(v.cx)) continue;
      const R = Math.max(v.radius || 6, (v.buildRadius || 0) + 1);
      const rc = Math.max(3, (v.radius || 6) * 0.55);
      // (round 27) a town grown into its neighbours: the merged footprint
      // is one closed area (253): a line keeps round its outside, and its
      // stations stand on its outer edge (one town's edge was the next
      // town's downtown, and trestles braided its main streets)
      if ((CB.get(v.id)?.n || 1) > 1) {
        const x0 = Math.max(0, Math.floor(v.cx - R - 2)),
          x1 = Math.min(W - 1, Math.ceil(v.cx + R + 2)),
          y0 = Math.max(0, Math.floor(v.cz - R - 2)),
          y1 = Math.min(H - 1, Math.ceil(v.cz + R + 2));
        for (let y = y0; y <= y1; y++)
          for (let x = x0; x <= x1; x++) {
            const d = Math.hypot(x + 0.5 - v.cx, y + 0.5 - v.cz);
            const i = y * W + x;
            if (d < R) B[i] = B[i] >= 254 ? B[i] : 253;
            else if (d < R + 2 && B[i] === 0) B[i] = 3;
          }
        // (round 29: its squares are closed outright too)
        markHall(v);
        continue;
      }
      const x0 = Math.max(0, Math.floor(v.cx - R - 2)),
        x1 = Math.min(W - 1, Math.ceil(v.cx + R + 2)),
        y0 = Math.max(0, Math.floor(v.cz - R - 2)),
        y1 = Math.min(H - 1, Math.ceil(v.cz + R + 2));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x + 0.5 - v.cx, y + 0.5 - v.cz);
          const i = y * W + x;
          if (B[i] === 253) continue;
          if (d < rc) B[i] = B[i] === 3 ? 2 : Math.max(B[i], 2);
          else if (d < R) B[i] = B[i] === 3 ? 1 : Math.max(B[i], 1);
          else if (d < R + 2 && B[i] === 0) B[i] = 3;
        }
      markHall(v);
    }
    for (const b of this.buildings) {
      if (!b.alive) continue;
      const air = b.type === 'airport' || b.type === 'airfield';
      if (!air && b.type !== 'plaza' && b.type !== 'park' && b.type !== 'forum') continue;
      // (an airport's zone a tile wider for the track: its highway runs
      // beside it, and keeps the clear zone too)
      const m = b.type === 'airport' ? AIR_CLEAR + 1 : air ? 2 : 1;
      for (let y = b.ty - m; y < b.ty + b.h + m; y++)
        for (let x = b.tx - m; x < b.tx + b.w + m; x++) {
          if (!w.inBounds(x, y)) continue;
          const i = y * W + x;
          const inside = x >= b.tx && x < b.tx + b.w && y >= b.ty && y < b.ty + b.h;
          if (air && !inside) B[i] = Math.max(B[i], 254);
          else B[i] = 255;
        }
    }
  },
  // The other lines near a route (other realms' tracks and this realm's
  // other kind, and the highways beside them): 1 on one, 2 right beside
  // one, 3 two or three tiles off. A new line runs right beside an old one
  // (one corridor) or keeps well away, never a few tiles off it in parallel.
  _railCorridor(k, kind, segs) {
    const w = this.world;
    const W = w.w,
      N = W * w.h;
    if (!this._railCor || this._railCor.length !== N) this._railCor = new Uint8Array(N);
    const C = this._railCor;
    C.fill(0);
    // (only near this realm's towns: a World Map holds many networks)
    let x0 = Infinity,
      x1 = -Infinity,
      z0 = Infinity,
      z1 = -Infinity;
    for (const vid of k.villages) {
      const v = this.villages[vid];
      if (!v?.alive) continue;
      x0 = Math.min(x0, v.cx);
      x1 = Math.max(x1, v.cx);
      z0 = Math.min(z0, v.cz);
      z1 = Math.max(z1, v.cz);
    }
    x0 -= 40;
    x1 += 40;
    z0 -= 40;
    z1 += 40;
    let last = -1;
    const mark = (x, z) => {
      if (x < x0 || x > x1 || z < z0 || z > z1) return;
      const tx = Math.floor(x),
        tz = Math.floor(z);
      const t0 = tz * W + tx;
      if (t0 === last || !w.inBounds(tx, tz)) return;
      last = t0;
      for (let dz = -3; dz <= 3; dz++)
        for (let dx = -3; dx <= 3; dx++) {
          if (!w.inBounds(tx + dx, tz + dz)) continue;
          const d = Math.max(Math.abs(dx), Math.abs(dz));
          const c = d === 0 ? 1 : d === 1 ? 2 : 3;
          const t = (tz + dz) * W + tx + dx;
          if (!C[t] || C[t] > c) C[t] = c;
        }
    };
    for (const s of segs) {
      if (s.kingdom === k.id && s.kind === kind) continue;
      const P = s.pts;
      last = -1;
      for (let i = 0; i + 1 < P.length; i += 2) mark(P[i], P[i + 1]);
      if (s.hw) {
        last = -1;
        for (let i = 0; i < s.hw.length; i++) if (s.hw[i]) mark(...hwPoint(P, i));
      }
    }
  },
  // the stretches of a rail segment across a town's core (its points get
  // lifted onto a viaduct there): runs of three points or more, eased two
  // points either side, never at a station's platform
  _railCoreRuns(s) {
    const w = this.world;
    const B = this._railBlk;
    const P = s.pts;
    const n = P.length / 2;
    if (!B) return null;
    const f = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const tx = Math.floor(P[i * 2]),
        tz = Math.floor(P[i * 2 + 1]);
      if (w.inBounds(tx, tz) && (B[tz * w.w + tx] === 2 || B[tz * w.w + tx] === 255)) f[i] = 1;
    }
    const arc = new Float32Array(n);
    for (let i = 1; i < n; i++) arc[i] = arc[i - 1] + Math.min(3, Math.hypot(P[i * 2] - P[i * 2 - 2], P[i * 2 + 1] - P[i * 2 - 1]));
    // (round 27: the platform, then the ramp at the bed's grade, stays at
    // ground level: a deck met a station's canopy at deck height over
    // tracks at grade)
    const ramp = ST_HALF * 2 * BUILDING.scale + CORE_LIFT / GRADE.rail + 1.2;
    const keepS = s.start?.station ? ramp : s.junction ? 1.5 : 0,
      keepE = s.end?.station ? ramp : 0;
    const out = new Uint8Array(n);
    let any = false;
    for (let i = 0; i < n; ) {
      if (!f[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < n && f[j]) j++;
      if (j - i >= 3)
        for (let m = Math.max(0, i - 2); m < Math.min(n, j + 2); m++)
          if (arc[m] >= keepS && arc[n - 1] - arc[m] >= keepE) {
            out[m] = 1;
            any = true;
          }
      i = j;
    }
    return any ? out : null;
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
    // The nearest point of the network where a branch may leave it: out in
    // the country (never inside a town, where a second track would braid
    // through its blocks) and with the town ahead, so the branch runs on
    // away from the root instead of doubling back in a hairpin beside the
    // trunk (round 22). A town with no such point is reached by a line of
    // its own out of the root's station (the far end of its platform when
    // the town lies the other way: a through station).
    let bs = -1,
      bj = 0,
      bd = Infinity;
    const Bk = this._railBlk;
    for (let si = 0; si < tree.length; si++) {
      const p = tree[si].pts;
      const n = p.length / 2;
      for (let j = tree[si].lock0; j <= tree[si].lock1; j++) {
        const tx = Math.floor(p[j * 2]),
          tz = Math.floor(p[j * 2 + 1]);
        if (Bk && w.inBounds(tx, tz)) {
          const b = Bk[tz * W + tx];
          if (b === 1 || b === 2 || b >= 253) continue;
        }
        const a = Math.max(0, j - 2),
          c = Math.min(n - 1, j + 2);
        const ux = p[c * 2] - p[a * 2],
          uz = p[c * 2 + 1] - p[a * 2 + 1];
        const vx = T.x - p[j * 2],
          vz = T.z - p[j * 2 + 1];
        const L = Math.hypot(vx, vz) || 1;
        if ((ux * vx + uz * vz) / ((Math.hypot(ux, uz) || 1) * L) < 0.15) continue;
        const d = vx * vx + vz * vz;
        if (d < bd) (bd = d), (bs = si), (bj = j);
      }
    }
    // (a line of its own from the root when that is much the shorter way)
    const RT = this._railTerm(kind, root);
    const dRoot = Math.hypot(RT.x - T.x, RT.z - T.z);
    if (bs >= 0 && Math.sqrt(bd) > dRoot * 0.8 + 6) bs = -1;
    if (bs < 0) {
      const o = this._railOrient(RT, T.x, T.z, C.lead);
      head = o.pts;
      lead = o.lead;
    } else {
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
      const mc = kind === 'rail' ? 0.75 : 0.8;
      // (strict first: no track over a town's blocks at all, only along
      // its streets or round its edge; then the old dear-but-open price)
      const ends = [sx, sy, gx, gy];
      let cost = this._railCost(kind, mask, false, ends);
      let q = civPath(w, sx, sy, gx, gy, cost, 14000, mc);
      if (!near(q)) q = civPath(w, sx, sy, gx, gy, (cost = this._railCost(kind, mask, false, null, ends)), 14000, mc);
      if (!near(q)) q = civPath(w, sx, sy, gx, gy, (cost = this._railCost(kind, mask, true, null, ends)), 16000, mc);
      if (!near(q)) return null;
      mid = this._railPull(q, cost)
        .slice(0, -1)
        .map((i) => [(i % W) + 0.5, ((i / W) | 0) + 0.5]);
    }
    // (round 29) the straightened, rounded line keeps off every town's
    // square and core too: a corner cut across one is drawn tighter, and a
    // line that still crosses one is not laid
    let pts = null;
    for (const f of [1, 0.5, 0.25]) {
      const way = rdp([lead, ...mid, o2.lead], C.eps * f);
      pts = fillet([...head, ...way.slice(0, -1), ...tail], C.R * f);
      if (!pts || pts.length < 4) return null;
      if (!this._railInTown(pts)) break;
      if (f === 0.25) return null;
    }
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
    const Nr = this._railNear;
    let lastT = -1;
    for (let i = 0; i < n; i++) {
      const tx = Math.floor(pts[i * 2]),
        tz = Math.floor(pts[i * 2 + 1]);
      if (!w.inBounds(tx, tz)) continue;
      mask[tz * W + tx] |= kind === 'rail' ? 1 : 2;
      const t0 = tz * W + tx;
      if (kind !== 'rail' || !Nr || t0 === lastT) continue;
      lastT = t0;
      for (let dz = -3; dz <= 3; dz++)
        for (let dx = -3; dx <= 3; dx++) {
          if (!w.inBounds(tx + dx, tz + dz)) continue;
          const t = (tz + dz) * W + tx + dx;
          const c = Math.max(Math.abs(dx), Math.abs(dz)) + 1;
          if (!Nr[t] || Nr[t] > c) Nr[t] = c;
        }
    }
    return seg;
  },
  // a drawn line over a town's square (255) or a single town's core (2)
  // away from its own ends (_railBlocks)
  _railInTown(pts) {
    const w = this.world;
    const B = this._railBlk;
    if (!B) return false;
    const n = pts.length / 2;
    const sx = pts[0],
      sz = pts[1],
      ex = pts[n * 2 - 2],
      ez = pts[n * 2 - 1];
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2],
        z = pts[i * 2 + 1];
      const tx = Math.floor(x),
        tz = Math.floor(z);
      if (!w.inBounds(tx, tz)) continue;
      const b = B[tz * w.w + tx];
      if (b !== 255 && b !== 2) continue;
      const dE = Math.min(Math.hypot(x - sx, z - sz), Math.hypot(x - ex, z - ez));
      if (b === 255 ? dE > 1.5 : dE > 3.5) return true;
    }
    return false;
  },
  // A grid path pulled taut: each run goes straight on to the farthest
  // point it can see over ground no dearer than the path's own (a line used
  // to wind down a slope in a staircase of short zigzags); the curves are
  // rounded after.
  _railPull(q, cost) {
    const n = q.length;
    if (n < 3) return q;
    const cs = q.map((i) => cost(i));
    const out = [q[0]];
    let i = 0;
    while (i < n - 1) {
      let best = i + 1,
        mx = cs[i];
      const lim = Math.min(n - 1, i + 48);
      for (let j = i + 1; j <= lim; j++) {
        mx = Math.max(mx, cs[j]);
        if (j >= i + 2 && this._railSight(q[i], q[j], Math.min(mx, 4.5) + 0.6, cost)) best = j;
      }
      out.push(q[best]);
      i = best;
    }
    return out;
  },
  _railSight(a, b, maxC, cost) {
    const W = this.world.w;
    const ax = (a % W) + 0.5,
      az = ((a / W) | 0) + 0.5,
      bx = (b % W) + 0.5,
      bz = ((b / W) | 0) + 0.5;
    const k = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.3);
    let last = -1;
    for (let s = 0; s <= k; s++) {
      const t = Math.floor(az + ((bz - az) * s) / k) * W + Math.floor(ax + ((bx - ax) * s) / k);
      if (t === last) continue;
      last = t;
      if (!(cost(t) <= maxC)) return false;
    }
    return true;
  },
  _railCost(kind, mask, relaxed, ends = null, endsC = ends) {
    const w = this.world;
    const W = w.w;
    const use = this.use;
    const B = this._railBlk;
    // strict (ends given): inside a town a line runs only along a street or
    // within a few tiles of its own terminus (round 22: tracks braided and
    // looped through a Modern town's blocks and a trestle crossed an
    // Industrial centre); the ring round the edge is the way past it
    const nearEnd = (i) => {
      if (!ends) return true;
      const x = i % W,
        y = (i / W) | 0;
      return (Math.abs(x - ends[0]) <= 3 && Math.abs(y - ends[1]) <= 3) || (Math.abs(x - ends[2]) <= 3 && Math.abs(y - ends[3]) <= 3);
    };
    const Cr = this._railCor;
    const Nr = kind === 'rail' ? this._railNear : null;
    // a town, an airport's clear zone and the other lines nearby (see
    // _railBlocks and _railCorridor), on top of the ground's own price
    const nearC = (i) => {
      if (!endsC) return false;
      const x = i % W,
        y = (i / W) | 0;
      return (Math.abs(x - endsC[0]) <= 3 && Math.abs(y - endsC[1]) <= 3) || (Math.abs(x - endsC[2]) <= 3 && Math.abs(y - endsC[3]) <= 3);
    };
    const near = (i, c) => {
      const b = B ? B[i] : 0;
      if (b === 255) return Infinity;
      // (round 27) a conurbation's closed area, in every pass: only within
      // a few tiles of the line's own ends (its station on the outer edge)
      if (b === 253) {
        if (use[i] === USE.BUILDING || !nearC(i)) return Infinity;
        return c + (use[i] === USE.ROAD ? 8 : 16);
      }
      if (b === 254) return relaxed ? c + 40 : Infinity;
      // (inside a town a line keeps out of the blocks: crossing a street
      // costs a little less than a lawn, and the ring round its edge is
      // the cheap way past it)
      // (round 25: the blocks of a Modern or Future town are closed to every
      // kind of line in every pass: tracks, viaducts and guideways wound
      // across blocks and lawns, and viaducts crossed downtown and passed
      // through a factory. A line keeps round a town's core and over its
      // blocks only along a street, at grade; near its own station only it
      // may cross the town's open ground. 'relaxed' is the last resort of a
      // town hemmed in on every side.)
      if (b === 1 || b === 2) {
        const ne = nearEnd(i);
        if (use[i] === USE.BUILDING) return Infinity;
        // (round 29: a single town's core is closed like a conurbation's, in
        // every pass: a line reaches only its own station on the edge; a
        // track on a low viaduct crossed an Industrial town's main square)
        if (b === 2 && !nearC(i)) return Infinity;
        if (use[i] === USE.ROAD) c += b === 2 ? 8 : 4;
        else if (ends && !ne) return Infinity;
        else c += b === 2 ? 16 : relaxed ? 9 : 12;
      } else if (b === 3) c *= 0.9;
      // another line: right beside it (one shared corridor) is cheap, two or
      // three tiles off it (a second line braided along it) dear
      const k = Cr ? Cr[i] : 0;
      if (k === 1) c += 1.5;
      else if (k === 2) c *= 0.7;
      else if (k === 3) c += 4.5;
      // this network's own track: a branch leaves it at its switch and
      // keeps away, never running along it a tile or three off
      // (Nr: 1 on it, 2 right beside it, 3 and 4 two and three tiles off)
      const nr = Nr ? Nr[i] : 0;
      if (nr === 2) c += 2.5;
      else if (nr === 3) c += 2;
      else if (nr === 4) c += 1;
      return c;
    };
    const base0 = this._railCost0(kind, mask, relaxed);
    return (i) => {
      const c = base0(i);
      return c === Infinity ? c : near(i, c);
    };
  },
  _railCost0(kind, mask, relaxed) {
    const w = this.world;
    const use = this.use;
    // steep ground costs dear: a line keeps to a gentle grade and goes round
    // a cliff or a mesa rather than up its face
    const steep = (i, from, k) => {
      const sl = w.slopeAt(i % w.w, (i / w.w) | 0);
      return sl > from ? (sl - from) * k : 0;
    };
    if (kind === 'rail') {
      const base = this._roadCost();
      return (i) => {
        if (mask[i] & 1) return 2.4; // beside its own track: join it at a switch instead
        // along a street only where it must (it crosses streets freely)
        if (use[i] === USE.ROAD) return w.height[i] < SEA_LEVEL + 0.03 ? 2 : 1 + steep(i, 0.3, 9);
        const c = base(i);
        if (c === Infinity) return c;
        return c + steep(i, 0.3, 9);
      };
    }
    return (i) => {
      if (mask[i] & 2) return 3;
      if (w.height[i] < SEA_LEVEL) return 1.5;
      // (a guideway S-looped over lawns and a dome block: never over a building)
      if (use[i] === USE.BUILDING || this.airZone?.[i]) return Infinity;
      return 1 + w.slopeAt(i % w.w, (i / w.w) | 0) * 0.8 + steep(i, 0.45, 7);
    };
  },
  // A highway beside a track wherever it runs outside the towns and on land
  // (1; 2 on a bridge over a short stretch of water). It never ends in a
  // field: each end runs on into its town until it meets a street, or meets
  // its trunk's highway at a junction (or a road crossing it); an end that
  // finds neither is cut back to the last road it crossed, or dropped.
  _hwMask(s, segs = null) {
    const w = this.world;
    const W = w.w;
    const P = s.pts;
    const n = P.length / 2;
    const hw = new Uint8Array(n);
    const towns = this.villages.filter((v) => v?.alive);
    const C = [];
    // 0 blocked (a building), 1 open country, 2 in a town, 3 water
    const st = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const [x, z] = (C[i] = hwPoint(P, i));
      const tx = Math.floor(x),
        tz = Math.floor(z);
      if (!w.inBounds(tx, tz)) continue;
      if (w.heightAt(x, z) < SEA_LEVEL + 0.05) st[i] = 3;
      else if (this.use[tz * W + tx] === USE.BUILDING) st[i] = 0;
      else {
        st[i] = 1;
        for (const v of towns) if (Math.abs(v.cx - x) < v.radius && Math.hypot(v.cx - x, v.cz - z) < v.radius * 0.85) st[i] = 2;
      }
    }
    // (round 29) the highway never runs along over another track: where a
    // branch turned off to the left, its road (on the right of its track)
    // ran across its trunk's rails at a shallow angle into a jagged knot of
    // decks. A short stretch over a track is a level crossing; a long one
    // is blocked, so the road keeps a gap from the other corridor
    if (segs) {
      const Hm = new Map();
      let x0 = Infinity,
        x1 = -Infinity,
        z0 = Infinity,
        z1 = -Infinity;
      for (const [x, z] of C) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
      for (const o of segs) {
        if (o === s || o.kind !== 'rail') continue;
        const Q = o.pts;
        // (a branch of this line leaves it at its switch: that stretch never
        // breaks this line's own highway)
        let j0 = 0;
        if (o.junction && o.kingdom === s.kingdom)
          for (let m = 0; m + 1 < P.length; m += 2)
            if (Math.abs(P[m] - Q[0]) < 0.3 && Math.abs(P[m + 1] - Q[1]) < 0.3) {
              j0 = Math.round(5 / SPACING) * 2;
              break;
            }
        for (let j = j0; j + 1 < Q.length; j += 2) {
          const x = Q[j],
            z = Q[j + 1];
          if (x < x0 - 2 || x > x1 + 2 || z < z0 - 2 || z > z1 + 2) continue;
          const k = Math.floor(x) * 65536 + Math.floor(z);
          let a = Hm.get(k);
          if (!a) Hm.set(k, (a = []));
          a.push(x, z);
        }
      }
      if (Hm.size) {
        const over = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
          if (st[i] !== 1 && st[i] !== 3) continue;
          const [x, z] = C[i];
          const fx = Math.floor(x),
            fz = Math.floor(z);
          for (let dx = -1; dx <= 1 && !over[i]; dx++)
            for (let dz = -1; dz <= 1 && !over[i]; dz++) {
              const a = Hm.get((fx + dx) * 65536 + fz + dz);
              if (a) for (let m = 0; m < a.length; m += 2) if (Math.abs(a[m] - x) < 0.75 && Math.hypot(a[m] - x, a[m + 1] - z) < 0.75) over[i] = 1;
            }
        }
        for (let i = 0; i < n; ) {
          if (!over[i]) {
            i++;
            continue;
          }
          let j = i;
          while (j < n && over[j]) j++;
          if (j - i > 6) for (let m = i; m < j; m++) st[m] = 0;
          i = j;
        }
      }
    }
    // a street (not this highway's own road, mask 4) beside point i
    const street = (i) => {
      const tx = Math.floor(C[i][0]),
        tz = Math.floor(C[i][1]);
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!w.inBounds(tx + dx, tz + dz)) continue;
          const t = (tz + dz) * W + tx + dx;
          if (this.use[t] === USE.ROAD && !(this.railMask?.[t] & 4) && w.height[t] >= SEA_LEVEL) return true;
        }
      return false;
    };
    // a branch starts on its trunk: its highway joins the trunk's there
    let jA = false;
    if (s.up?.hw)
      for (let d = -6; d <= 6; d++)
        if (s.up.hw[s.at + d]) jA = true;
    for (let i = 0; i < n; ) {
      if (st[i] !== 1) {
        i++;
        continue;
      }
      let j = i;
      while (j < n) {
        if (st[j] === 1) {
          j++;
          continue;
        }
        if (st[j] === 3) {
          let m = j;
          while (m < n && st[m] === 3) m++;
          if (m < n && st[m] === 1 && m - j <= 10) {
            j = m;
            continue;
          }
        }
        break;
      }
      let a = i,
        b = j;
      let okA = street(a) || (a === 0 && jA);
      while (!okA && a > 0 && st[a - 1] === 2 && i - a < 40) okA = street(--a);
      let okB = street(b - 1);
      while (!okB && b < n && st[b] === 2 && b - j < 40) okB = street(b++);
      // an end that found no street: back to the last road the run crossed
      if (!okA) {
        while (a < b - 1 && !street(a)) a++;
        okA = street(a);
      }
      if (!okB) {
        while (b - 1 > a && !street(b - 1)) b--;
        okB = street(b - 1);
      }
      if (okA && okB && b - a >= 8) for (let m = a; m < b; m++) hw[m] = st[m] === 3 ? 2 : 1;
      i = Math.max(j, b);
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
  // the edge of a town's built ground (its blocks and streets end inside it)
  _townEdge(v) {
    return Math.max(v.radius || 6, (v.buildRadius || 0) + 1) + 1;
  },
  // a pylon near (x, z): never on a street, a square, a plot, a building
  // or the water, and never inside a town; nudged along or across the line
  // by up to two tiles, else none (the span runs on to the next)
  _pylonSpot(x, z, ux, uz) {
    const w = this.world;
    const ok = (px, pz) => {
      const tx = Math.floor(px),
        tz = Math.floor(pz);
      if (!w.inBounds(tx, tz)) return false;
      const i = tz * w.w + tx;
      if (w.height[i] < SEA_LEVEL + 0.08 || this.use[i] !== USE.FREE || this.keepClear?.[i] || this.railMask?.[i]) return false;
      if (w.type[i] === TILE.ROAD) return false;
      for (const v of this.villages) {
        if (!v?.alive) continue;
        const r = this._townEdge(v) - 0.5;
        if (Math.abs(v.cx - px) < r && Math.abs(v.cz - pz) < r && Math.hypot(v.cx - px, v.cz - pz) < r) return false;
      }
      return true;
    };
    for (const [a, c] of [[0, 0], [0.8, 0], [-0.8, 0], [0, 1], [0, -1], [1.6, 0], [-1.6, 0], [0, 2], [0, -2]]) {
      const px = x + ux * a - uz * c,
        pz = z + uz * a + ux * c;
      if (ok(px, pz)) return [px, pz];
    }
    return null;
  },
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
      // from the plant to the town's substation at the edge of town (round
      // 25: the line ran on to within 0.7 of the town's radius, its wires
      // over the blocks and a pylon stood on a main plaza): the town's
      // 'pylon' building when it stands at the edge, else the edge itself
      const dx = v.cx - best.x,
        dz = v.cz - best.z;
      const L = Math.hypot(dx, dz) || 1;
      const Re = this._townEdge(v);
      let ex = v.cx - (dx / L) * Re,
        ez = v.cz - (dz / L) * Re;
      const sub = v.buildings.find((b) => b.alive && b.type === 'pylon');
      if (sub && Math.hypot(sub.x - v.cx, sub.z - v.cz) > Re - 2.5) (ex = sub.x), (ez = sub.z);
      const len = Math.hypot(ex - best.x, ez - best.z);
      const pylons = [];
      const n = Math.max(1, Math.round(len / 5));
      for (let i = 1; i < n; i++) {
        const p = this._pylonSpot(best.x + ((ex - best.x) * i) / n, best.z + ((ez - best.z) * i) / n, (ex - best.x) / len, (ez - best.z) / len);
        if (p) pylons.push(p[0], p[1]);
      }
      lines.push({ id: best.id * 4096 + v.id, kingdom: k.id, from: best.id, to: v.id, pts: [best.x, best.z, ex, ez], pylons, sub: !!sub && ex === sub.x });
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
