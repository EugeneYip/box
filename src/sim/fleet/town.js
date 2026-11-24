import { civPath } from '../civ/pathing.js';
import { USE } from '../civ/util.js';
import { KINDS } from './kinds.js';

// Town fleets (round 33), mixed into Fleet. The user asked that "unit
// movements could be further improved especially when there's city
// development": a Modern town's street cars are cheap records (traffic.js),
// and with intercity trucks off the roads a growing town had nothing on its
// streets a player could click. Besides the cars, every town of a realm in
// the Modern era or later (era 5+, Combustion) with streets enough keeps a
// few real vehicles on its own street grid, each one inspectable and
// followable like any other vehicle:
//   bus      runs a loop of two to five stops round the town all day,
//            setting down and picking up riders at each (at night it stands
//            at its first stop)
//   van      a delivery van: loads up at the depot (the market, a granary, a
//            workshop or a factory), takes a parcel to the door of a home,
//            shop or workshop at a time, then goes back to load up again
//   garbage  a garbage truck: along the streets, stopping by the houses to
//            empty the trash cans, then out to the dump at the town's edge
// The van and the garbage truck work by day and park at the depot at night.
// They keep to the streets: road tiles only, never across the town's square
// or parade pad (civ.keepClear; a stop is only ever chosen on the streets
// joined to where the vehicle stands without crossing them), round the
// streets beside the square only where they must, across the railway only
// where they must; and they stop only on a street clear of the square, by a
// building. The world keeps at most _townCap() of them, given to
// the towns nearest the camera first (a bus, then a van, then a garbage
// truck). They are outside the world's land limit (Fleet.landTally), so
// intercity trucks and the civic services keep their places.
// (round 37) Every stop and every leg lies inside the town's paving (the
// disc the terrain paves round an Industrial or later town, planner
// _pavedRadius): Elderley's loop ran from the end of a paved street down a
// dirt track into the trees to a "Granary" stop standing in the forest.
// (round 35) One no longer wanted (its town too small, out of that share,
// out of the era, in another realm's hands, or gone; a spare of its kind; one
// with no way through the streets) is never taken away under the player's
// eyes: while it is followed, selected or in view it drives back to its depot
// and parks there, its card saying why ("Off duty: parked at the depot", "No
// longer needed: Elderley is too small"), and it leaves only once it is out
// of view and not selected (back to work instead if its town wants it again
// first). A followed delivery van was laid up on screen within 49 s and the
// camera left over grass: the van had set out from its depot's own curb, asked
// the way to where it stood, failed 21 times and was laid up for it.
//
// PUBLIC CONTRACT (additions to game.fleet)
//   vehicle.town      the town (village id) a town vehicle serves
//   vehicle.mission   {type: 'town', town: true, job: 'loop'|'deliver'|'refuse',
//                      at (where it stands: 'stop', 'drop', 'depot', 'pickup',
//                      'dump', 'night', 'start', 'off'), goal {x, z, at, label},
//                      riders | parcels | load, stops (a bus's loop),
//                      retire (why it is off duty: 'small', 'share', 'era',
//                      'realm', 'lost', 'spare', 'stuck'; null at work)}
//   townCount(vid?)   town vehicles (of one town)
//   townLoopPath(v)   a town bus's loop along the streets, [x, z, ...] round
//                     its stops (closed), or null; kept on the bus

const JOB = { bus: 'loop', van: 'deliver', garbage: 'refuse' };
// seconds at each kind of stop
const WAIT = { stop: 3.2, drop: 4.5, pickup: 2.4, depot: 6, dump: 5, start: 0.5 };
// a town bus at town pace (the transit buses' 2.0 outran every car on the street)
const BUS_DEF = Object.freeze({ ...KINDS.bus, capacity: 0, speed: 1.15 });
// a bus stop is named for the building it stands by
const STOP_NAME = { hall: 'Town Hall', market: 'Market', temple: 'Temple', library: 'Library', academy: 'Academy', campus: 'Campus', clinic: 'Clinic', hospital: 'Hospital', station: 'Station', factory: 'Factory', workshop: 'Workshops', park: 'Park', firestation: 'Fire Station', skyscraper: 'Towers', docks: 'Harbor', granary: 'Granary', barracks: 'Barracks', forum: 'Forum', statue: 'Statue', waterworks: 'Waterworks', powerstation: 'Power Station', airfield: 'Airfield', airport: 'Airport', observatory: 'Observatory', healer: 'Clinic', apartment: 'Apartments', rowhouse: 'Terrace', silo: 'Silos', cannery: 'Cannery', smokehouse: 'Smokehouse', foundry: 'Foundry', bloomery: 'Forge', kiln: 'Kilns', windmill: 'Windmill', watermill: 'Mill', waterwheel: 'Mill', stables: 'Stables', well: 'Well', nursery: 'Nursery', greenhouse: 'Greenhouses', watchtower: 'Watchtower', shipyard: 'Shipyard', lazaretto: 'Lazaretto', radiomast: 'Radio Mast' };
// (round 35) a street's name, for a stop with no landmark beside it
const STREETS = ['High Street', 'Mill Lane', 'Elm Street', 'Station Road', 'Park Lane', 'Bridge Street', 'Oak Avenue', 'King Street', 'Queen Street', 'Garden Row', 'Water Street', 'Orchard Lane', 'Chapel Street', 'Main Street', 'Baker Street', 'Cedar Avenue', 'Willow Lane', 'Market Street'];
// where a parcel goes, in the card's words
const DROP_NAME = { house: 'a house', rowhouse: 'a row house', apartment: 'an apartment block', market: 'the market', workshop: 'a workshop', factory: 'the factory', granary: 'the granary', clinic: 'the clinic', hospital: 'the hospital', library: 'the library', academy: 'the academy', campus: 'the campus', temple: 'the temple', hall: 'the town hall', skyscraper: 'an office tower', firestation: 'the fire station', cannery: 'the cannery', smokehouse: 'the smokehouse', foundry: 'the foundry', station: 'the station', barracks: 'the barracks', healer: 'the clinic', observatory: 'the observatory', forum: 'the forum', kiln: 'the kiln', bloomery: 'the forge' };
const HOMES = new Set(['house', 'rowhouse', 'apartment']);
const DEPOTS = ['market', 'granary', 'workshop', 'factory', 'silo', 'cannery'];
const COMPASS = ['East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest', 'North', 'Northeast'];

export const town = {
  townCount(vid = null) {
    let n = 0;
    for (const v of this.list) if (v.alive && v.town != null && (vid == null || v.town === vid)) n++;
    return n;
  },
  // Town vehicles the world keeps at once (the towns nearest the camera
  // first): about two fifths of the land limit, 15 to 45.
  _townCap() {
    return Math.min(45, Math.max(15, Math.round(this.budget.land * 0.4)));
  },
  // What a town keeps on its streets: a bus once it is a town (or its
  // streets are long), a van, and a garbage truck once it is a few streets big.
  _townWants(t) {
    const roads = t.roadTiles?.length || 0;
    const pop = t.pop || 0;
    if (roads < 10 || pop < 8) return [];
    const out = [];
    if ((t.tier || 0) >= 1 || roads >= 24) out.push('bus');
    out.push('van');
    if (roads >= 16 && pop >= 12) out.push('garbage');
    return out;
  },
  // Every couple of seconds (Fleet.tick): the towns that keep a town fleet,
  // nearest the camera first, up to the cap; a missing vehicle sets out (two
  // at a time), and one no longer wanted leaves when out of sight.
  _townPlan() {
    const civ = this.game.civ;
    if (!civ) return;
    const off = this.law('fleetLand', true) === false;
    const cam = this.game.cameraRig?.cur;
    const cand = [];
    if (!off)
      for (const k of civ.kingdoms) {
        if (!k || k.alive === false || (k.era || 0) < 5 || !k.techs?.has?.('combustion') || !k.villages?.length) continue;
        for (const vid of k.villages) {
          const t = civ.villages[vid];
          if (!t?.alive) continue;
          const wants = this._townWants(t);
          if (wants.length) cand.push({ k, t, wants, d: cam ? this.dist(t.cx, t.cz, cam.x, cam.z) : 0 });
        }
      }
    cand.sort((a, b) => a.d - b.d);
    const have = new Map();
    for (const v of this.list) {
      if (!v.alive || v.town == null) continue;
      // (round 35) an off-duty vehicle leaves once no one can see it
      if (v.mission?.retire && !this._townSeen(v)) {
        this._ended(v, 'off duty');
        continue;
      }
      const key = `${v.town}|${v.kind}|${v.kingdom}`;
      const o = have.get(key);
      if (o) {
        // two of a kind in one town: the spare goes off duty (one already off duty first)
        const spare = o.mission?.retire && !v.mission?.retire ? o : v;
        if (spare === o) have.set(key, v);
        this._townRetire(spare, 'spare');
      } else have.set(key, v);
    }
    let room = this._townCap();
    let spawns = 2;
    const keep = new Set();
    for (const c of cand) {
      for (const kind of c.wants) {
        if (room <= 0) break;
        room--;
        const key = `${c.t.id}|${kind}|${c.k.id}`;
        keep.add(key);
        if (!have.has(key) && spawns > 0 && this._townSpawn(kind, c.k, c.t)) spawns--;
      }
      if (room <= 0) break;
    }
    for (const [key, v] of have) {
      if (!v.alive) continue;
      if (keep.has(key)) {
        // wanted again before it left: back to work
        if (v.mission?.retire && v.mission.retire !== 'stuck') this._townResume(v);
        continue;
      }
      // (World Laws: town traffic switched off by the player goes at once)
      if (off) this._ended(v, 'off duty');
      else this._townRetire(v, this._townWhy(v));
    }
  },
  // Why a town vehicle is no longer wanted (see _townRetire)
  _townWhy(v) {
    const civ = this.game.civ;
    const t = civ?.villages?.[v.town];
    if (!t?.alive) return 'lost';
    if (t.kingdom !== v.kingdom) return 'realm';
    const k = civ.kingdoms?.[t.kingdom];
    if (!k || (k.era || 0) < 5 || !k.techs?.has?.('combustion')) return 'era';
    if (!this._townWants(t).includes(v.kind)) return 'small';
    return 'share';
  },
  // (round 35) Off duty: a vehicle out of sight leaves now; one in view (or
  // followed, or selected) drives back to its depot and parks there until no
  // one can see it (Fleet.tick's _townPlan, _townWork).
  _townRetire(v, why) {
    const m = v.mission;
    if (!v.alive || !m) return;
    if (!this._townSeen(v)) return this._ended(v, 'off duty');
    const was = m.retire;
    m.retire = why;
    if (was) return;
    m.wait = null;
    m.fail = 0;
    const t = this.game.civ?.villages?.[m.vid];
    const tgt = t ? this._townDepot(v, t) : null;
    if (tgt && (Math.floor(tgt.x) !== Math.floor(v.x) || Math.floor(tgt.z) !== Math.floor(v.z))) {
      const path = this._townLeg(t, v.x, v.z, tgt.x, tgt.z);
      if (path) {
        m.goal = { ...tgt, at: 'off' };
        this.setPath(v, path);
        v.state = 'move';
        v.stateT = 0;
        return;
      }
    } else if (tgt) m.goal = { ...tgt, at: 'off' };
    else m.goal = null;
    // (already at the depot, or no way there: it parks where it stands)
    v.path = null;
    v.state = 'work';
    v.stateT = 0;
    v.speed = 0;
    m.at = 'off';
    if (m.goal?.heading != null) this._settleTo(v, m.goal.heading);
  },
  // Wanted again while still in view: back on its rounds
  _townResume(v) {
    const m = v.mission;
    m.retire = null;
    if (m.goal?.at === 'off') m.goal = { ...m.goal, at: 'start' };
    if (v.state === 'work' && m.at === 'off') {
      m.at = 'start';
      v.stateT = 0;
    }
  },
  // Followed, selected or within the drawn radius of the camera
  _townSeen(v) {
    const g = this.game;
    if (g.cameraRig?.follow === v || g.selected?.ref === v) return true;
    const cam = g.cameraRig?.cur;
    if (!cam || cam.dist > 175) return false;
    const R = cam.dist * 1.7 + 24;
    return Math.abs(v.x - cam.x) <= R && Math.abs(v.z - cam.z) <= R;
  },
  // (round 37) How far from the town's middle its streets are paved (the
  // planner's _pavedRadius, as Terrain._writeSettle draws it), less a margin
  // so a vehicle never stands on the end of a street where the paving stops
  _townPaved(t) {
    return Math.max(5, (t.buildRadius || t.radius || 6) * 1.15 + 2) - 0.6;
  },
  _townInPave(t, x, z, pr = this._townPaved(t)) {
    return (x - t.cx) ** 2 + (z - t.cz) ** 2 <= pr * pr;
  },
  // A town's streets for its own vehicles (kept a few seconds on the town):
  // `all` the street tiles inside the town's paving where a vehicle may stop
  // (off the square and the streets round it, Fleet._paveMask, and off the
  // railway), `curb` those beside a building or a plot, `comp` which stretch
  // of joined-up paved streets each street tile is on (joined without
  // crossing the square or the parade pad, civ.keepClear, or leaving the
  // paving; across the railway), `main` the stretch with the most curbs.
  _townRoads(t) {
    const now = this.game.time.total;
    const c = t._townR;
    if (c && now - c.t < 6) return c;
    const w = this.world;
    const civ = this.game.civ;
    const use = civ.use;
    const rail = civ.railMask;
    const pv = this._paveMask();
    const rr = this._townPaved(t);
    const all = [],
      curb = [];
    for (const i of t.roadTiles || []) {
      if (use[i] !== USE.ROAD || pv[i] || rail?.[i]) continue;
      const x = i % w.w,
        z = (i / w.w) | 0;
      if ((x + 0.5 - t.cx) ** 2 + (z + 0.5 - t.cz) ** 2 > rr * rr) continue;
      all.push(i);
      if (x < 1 || z < 1 || x >= w.w - 1 || z >= w.h - 1) continue;
      const u = (j) => use[j] === USE.BUILDING || use[j] === USE.PLOT;
      if (u(i + 1) || u(i - 1) || u(i + w.w) || u(i - w.w)) curb.push(i);
    }
    const kc = civ.keepClear?.length === use.length ? civ.keepClear : null;
    const comp = new Map();
    const R2 = rr * rr;
    let nc = 0;
    const Q = [];
    for (const i0 of all) {
      if (comp.has(i0)) continue;
      comp.set(i0, nc);
      Q.length = 0;
      Q.push(i0);
      for (let q = 0; q < Q.length; q++) {
        const i = Q[q];
        const x = i % w.w,
          z = (i / w.w) | 0;
        for (let d = 0; d < 4; d++) {
          const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0),
            nz = z + (d === 2 ? 1 : d === 3 ? -1 : 0);
          if (nx < 0 || nz < 0 || nx >= w.w || nz >= w.h) continue;
          const j = nz * w.w + nx;
          if (comp.has(j) || use[j] !== USE.ROAD || kc?.[j] || (nx + 0.5 - t.cx) ** 2 + (nz + 0.5 - t.cz) ** 2 > R2) continue;
          comp.set(j, nc);
          Q.push(j);
        }
      }
      nc++;
    }
    const nCurb = new Array(nc).fill(0);
    for (const i of curb) nCurb[comp.get(i)]++;
    const nAll = new Array(nc).fill(0);
    for (const i of all) nAll[comp.get(i)]++;
    let main = 0;
    for (let c = 1; c < nc; c++) if (nCurb[c] * 4 + nAll[c] > nCurb[main] * 4 + nAll[main]) main = c;
    return (t._townR = { t: now, all, curb, comp, main });
  },
  // The stretch of streets a vehicle stands on (the town's main one if it
  // stands off them)
  _townComp(t, v) {
    const R = this._townRoads(t);
    const w = this.world;
    const c = R.comp.get(Math.floor(v.z) * w.w + Math.floor(v.x));
    return c ?? R.main;
  },
  // The way along the town's streets from (x0, z0) to the street tile at
  // (x1, z1): paved road tiles only, never the square or the parade pad (the
  // streets round the square and the railway dear), never out past the
  // paving (round 37: the bus drove a dirt track into the woods), or null
  // when it cannot get there. (loose: a vehicle left standing off the
  // streets drives over the square, the unpaved street, and the open ground
  // right beside it, to get back to them.)
  _townLeg(t, x0, z0, x1, z1, loose = false) {
    const w = this.world;
    const civ = this.game.civ;
    const use = civ.use;
    const rail = civ.railMask;
    const pv = this._paveMask();
    const kc = civ.keepClear?.length === use.length ? civ.keepClear : null;
    const rr = this._townPaved(t) ** 2;
    const sx = Math.floor(x0),
      sz = Math.floor(z0),
      gx = Math.floor(x1),
      gz = Math.floor(z1);
    if (!w.inBounds(sx, sz) || !w.inBounds(gx, gz) || (sx === gx && sz === gz)) return null;
    const cost = (i) => {
      if (loose && (use[i] !== USE.ROAD || kc?.[i])) {
        if (kc?.[i] || pv[i]) return 6;
        const ox = (i % w.w) + 0.5 - x0,
          oz = ((i / w.w) | 0) + 0.5 - z0;
        return use[i] === USE.FREE && ox * ox + oz * oz < 2.3 ? 8 : Infinity;
      }
      if (use[i] !== USE.ROAD || kc?.[i]) return Infinity;
      const dx = (i % w.w) + 0.5 - t.cx,
        dz = ((i / w.w) | 0) + 0.5 - t.cz;
      if (dx * dx + dz * dz > rr) return loose ? 6 : Infinity;
      if (pv[i]) return 8;
      if (rail?.[i]) return 9;
      return 1;
    };
    // (round 35: 4000 nodes, up from 1800, which a long leg past the dear
    // paving of the square ran out of, so the way was "not found")
    const p = civPath(w, sx, sz, gx, gz, cost, 4000, 1);
    if (!p || !p.length || p[p.length - 1] !== gz * w.w + gx) return null;
    const path = [x0, z0];
    for (const i of p) path.push((i % w.w) + 0.5, ((i / w.w) | 0) + 0.5);
    return path;
  },
  // (round 35) Standing off the streets: on a tile that is no longer a
  // street, or on the town's square or a parade pad (round 37: or out past
  // the paving, where the town's street runs on as a dirt track)
  _townOffStreet(v, t = null) {
    const civ = this.game.civ;
    const w = this.world;
    const tx = Math.floor(v.x),
      tz = Math.floor(v.z);
    if (!w.inBounds(tx, tz)) return false;
    const i = tz * w.w + tx;
    const kc = civ.keepClear?.length === civ.use.length ? civ.keepClear : null;
    return civ.use[i] !== USE.ROAD || !!kc?.[i] || (!!t && !this._townInPave(t, tx + 0.5, tz + 0.5));
  },
  // ...and back onto the nearest of the town's streets: out of view it is
  // simply moved there; in view it drives there over the square or the open
  // ground beside it. False when there is no way.
  _townUnstick(v, t) {
    const R = this._townRoads(t);
    const w = this.world;
    let best = -1,
      bd = Infinity;
    for (const i of R.all) {
      const d = ((i % w.w) + 0.5 - v.x) ** 2 + (((i / w.w) | 0) + 0.5 - v.z) ** 2;
      if (d < bd) (bd = d), (best = i);
    }
    if (best < 0) return false;
    const st = this._townStop(best, 'start', null);
    const m = v.mission;
    if (!this._townSeen(v)) return this._townPlace(v, st);
    const path = this._townLeg(t, v.x, v.z, st.x, st.z, true);
    if (!path) return false;
    m.goal = st;
    m.wait = null;
    this.setPath(v, path);
    v.state = 'move';
    v.stateT = 0;
    return true;
  },
  // (round 35) Stuck out of view on a short stretch of street with nothing
  // to do there: moved onto the town's main streets
  _townRelocate(v, t) {
    const R = this._townRoads(t);
    let L = R.curb.filter((i) => R.comp.get(i) === R.main);
    if (L.length < 4) L = R.all.filter((i) => R.comp.get(i) === R.main);
    if (!L.length) return false;
    return this._townPlace(v, this._townStop(L[(this.rng() * L.length) | 0], 'start', null));
  },
  // A town vehicle set down on a street tile (out of view), ready to set out
  _townPlace(v, st) {
    const m = v.mission;
    v.x = v.px = st.x;
    v.z = v.pz = st.z;
    if (st.heading != null) v.heading = v.ph = st.heading;
    v.path = null;
    v.trail = v.trail ? [] : v.trail;
    v.state = 'work';
    v.stateT = 0;
    v.speed = 0;
    m.at = 'start';
    m.goal = null;
    m.wait = null;
    m.fail = 0;
    if (m.job === 'loop') m.si = -1;
    return true;
  },
  // A stop on street tile i: its middle, the heading along the street there
  _townStop(i, at, label) {
    const w = this.world;
    const use = this.game.civ.use;
    const ew = use[i + 1] === USE.ROAD || use[i - 1] === USE.ROAD;
    const ns = use[i + w.w] === USE.ROAD || use[i - w.w] === USE.ROAD;
    return { i, x: (i % w.w) + 0.5, z: ((i / w.w) | 0) + 0.5, heading: ew && !ns ? 0 : !ew && ns ? Math.PI / 2 : null, at, label };
  },
  _townSpawn(kind, k, t) {
    const R = this._townRoads(t);
    let L = R.curb.filter((i) => R.comp.get(i) === R.main);
    // (a young town's streets lie mostly round its square: too few curbs
    // off it, so any street of the main stretch will do)
    if (L.length < 4) L = R.all.filter((i) => R.comp.get(i) === R.main);
    if (L.length < 4) return null;
    const w = this.world;
    const i = L[(this.rng() * L.length) | 0];
    const st = this._townStop(i, 'start', null);
    const v = this.spawn(kind, k.id, st.x, st.z, { home: t.id, state: 'work', heading: st.heading ?? this.rng() * Math.PI * 2 });
    if (!v) return null;
    if (kind === 'bus') v.def = BUS_DEF;
    v.town = t.id;
    v.voyage = null;
    v.speed = 0;
    v.mission = { type: 'town', town: true, job: JOB[kind], phase: 'out', vid: t.id, from: t.id, to: t.id, at: 'start', goal: null, fail: 0, riders: 0, parcels: 0, load: this.rng() * 0.4, seen: [] };
    void w;
    return v;
  },
  _townNight(job) {
    const h = this.game.time?.hour ?? 12;
    return job === 'loop' ? h < 5.5 || h >= 23.5 : h < 6.5 || h >= 20.5;
  },
  // A town vehicle standing (at a stop, a door, the depot, the dump, or
  // parked for the night): it waits there its while, then sets out again.
  _townWork(v, step) {
    const m = v.mission;
    v.speed = 0;
    // (round 35) off duty, parked: it leaves once no one can see it
    if (m.retire) {
      if (!this._townSeen(v)) this._ended(v, 'off duty');
      return;
    }
    if (m.at === 'off') m.at = 'start';
    const t = this.game.civ?.villages?.[m.vid];
    if (!t?.alive) return this._townRetire(v, 'lost');
    const night = this._townNight(m.job);
    if (m.at === 'night') {
      if (night) return;
      m.at = null;
      m.fail = 0;
      return this._townNext(v);
    }
    if (v.stateT < (m.wait ?? WAIT[m.at] ?? 3)) return;
    this._townServe(v, m);
    this._townNext(v);
    void step;
  },
  // The business of a stop: riders off and on, a parcel left, the bins emptied
  _townServe(v, m) {
    const r = this.rng;
    const h = this.game.time?.hour ?? 12;
    if (m.at === 'stop') {
      const rush = (h > 7 && h < 9.5) || (h > 16.5 && h < 18.5) ? 2 : h > 21 || h < 6 ? 0.4 : 1;
      const off = Math.round((m.riders || 0) * (0.2 + r() * 0.4));
      const on = Math.round(r() * 5 * rush);
      m.riders = Math.max(0, Math.min(36, (m.riders || 0) - off + on));
    } else if (m.at === 'drop') m.parcels = Math.max(0, (m.parcels || 0) - 1);
    else if (m.at === 'depot') m.parcels = 6 + ((r() * 6) | 0);
    else if (m.at === 'pickup') m.load = Math.min(1, (m.load || 0) + 0.06 + r() * 0.06);
    else if (m.at === 'dump') m.load = 0;
  },
  // Where to next, and the way there along the streets.
  _townNext(v) {
    const m = v.mission;
    const t = this.game.civ?.villages?.[m.vid];
    if (!t?.alive) return this._townRetire(v, 'lost');
    // (round 35) standing where the street is no longer (the square laid
    // over it, a plot): off it first (a vehicle stood on the square all along)
    if (this._townOffStreet(v, t) && this._townUnstick(v, t)) return;
    let tgt = null;
    if (this._townNight(m.job)) {
      tgt = this._townHome(v, t);
      // (already at its stand: parked there for the night)
      if (!tgt && m.at === 'night') {
        v.state = 'work';
        v.stateT = 0;
        return;
      }
    } else if (m.job === 'loop') {
      // (round 35) and laid out afresh now and then as the town grows (at
      // the end of a round), so new streets and landmarks get their stops
      const now = this.game.time.total;
      const due = m.stops && m.si === m.stops.length - 1 && now - (m.stopsT || 0) > 120;
      if (!m.stops || due || m.stops.some((s) => this.game.civ.use[s.i] !== USE.ROAD || !this._townInPave(t, s.x, s.z))) {
        // (on a short stretch the square cut off from the rest: the main streets' loop)
        m.stops = this._townStops(t, this._townComp(t, v)) || this._townStops(t, this._townRoads(t).main);
        m.stopsT = now;
        m.si = -1;
      }
      if (m.stops) {
        // (from where it was set down, the stop after the nearest)
        if (m.si == null || m.si < 0) {
          let bd = Infinity;
          m.stops.forEach((s, j) => {
            const d = this.dist(s.x, s.z, v.x, v.z);
            if (d < bd) (bd = d), (m.si = j);
          });
        }
        m.si = (m.si + 1) % m.stops.length;
        tgt = m.stops[m.si];
      }
    } else if (m.job === 'deliver') tgt = (m.parcels || 0) <= 0 ? this._townDepot(v, t) : this._townDrop(v, t) || this._townDepot(v, t);
    else {
      tgt = (m.load || 0) >= 0.98 ? this._townDump(v, t) : this._townPickup(v, t);
      // (round 35) no more cans on this stretch: tip what it has, else back to the depot
      if (!tgt) tgt = (m.load || 0) > 0.3 ? this._townDump(v, t) : this._townDepot(v, t);
    }
    // (round 35) already there (a van loading at the depot it set out from
    // asked the way to its own curb, and was laid up after 21 tries)
    if (tgt && Math.floor(tgt.x) === Math.floor(v.x) && Math.floor(tgt.z) === Math.floor(v.z)) {
      m.fail = 0;
      m.goal = tgt;
      return this._townArrive(v);
    }
    let path = tgt && this._townLeg(t, v.x, v.z, tgt.x, tgt.z);
    // (round 35) the square laid down across its street since it set out
    // (it stands on a stretch cut off from its goal's): after a few tries it
    // crosses the square, slowly, to get there
    if (!path && tgt && (m.fail || 0) >= 4) {
      const R = this._townRoads(t);
      if (R.comp.get(Math.floor(v.z) * this.world.w + Math.floor(v.x)) !== R.comp.get(tgt.i)) path = this._townLeg(t, v.x, v.z, tgt.x, tgt.z, true);
    }
    if (!path) {
      // (nowhere to go just now: it waits a moment and looks again)
      m.fail = (m.fail || 0) + 1;
      if (m.job === 'loop') m.stops = null;
      // (round 35) stuck on a short stretch of street out of view: it is
      // moved onto the town's main streets; in view it keeps trying, and
      // after a while goes off duty where it stands
      if (m.fail >= 4 && !this._townSeen(v) && this._townRelocate(v, t)) return;
      if (m.fail > 20) return this._townRetire(v, 'stuck');
      v.state = 'work';
      v.stateT = 0;
      m.wait = 2 + this.rng() * 2;
      if (!m.at || m.at === 'night') m.at = 'start';
      return;
    }
    m.fail = 0;
    m.goal = tgt;
    m.wait = null;
    this.setPath(v, path);
    v.state = 'move';
    v.stateT = 0;
  },
  // (round 35) A bus still on its way to a stop when the last run ends
  // (11:30 pm) turns for the nearest stand at once instead of finishing the
  // leg first (Fleet land.js, while it drives; looked at once a second).
  _townDriveCheck(v, step) {
    const m = v.mission;
    if (m.job !== 'loop' || m.goal?.at === 'night' || (v._tnT = (v._tnT || 0) + step) < 1) return;
    v._tnT = 0;
    if (this._townNight(m.job)) this._townNext(v);
  },
  // At the end of its way (Fleet land.js _landArrive): it stands there.
  _townArrive(v) {
    const m = v.mission;
    const g = m.goal;
    v.state = 'work';
    v.stateT = 0;
    v.speed = 0;
    m.at = g?.at || 'stop';
    m.wait = null;
    if (g?.heading != null) this._settleTo(v, g.heading);
    if (m.at === 'pickup' && m.seen) {
      m.seen.push(g.i);
      if (m.seen.length > 6) m.seen.shift();
    }
  },
  // Where it spends the night: a bus at the nearest of its stops (round 35:
  // its first stop, by the hall, was often a long drive across town, and
  // 28% of the buses were still on their way three hours after the last
  // run), the others at the depot
  _townHome(v, t) {
    const m = v.mission;
    let s = null;
    if (m.job === 'loop') {
      const S = m.stops || this._townStops(t, this._townComp(t, v));
      let bd = Infinity;
      if (S) for (const o of S) {
        const d = this.dist(o.x, o.z, v.x, v.z);
        if (d < bd) (bd = d), (s = o);
      }
    } else s = this._townDepot(v, t);
    if (!s) return null;
    // (on the stand's own tile the street search has nowhere to go)
    if (this.dist(s.x, s.z, v.x, v.z) < 0.6 || (Math.floor(s.x) === Math.floor(v.x) && Math.floor(s.z) === Math.floor(v.z))) {
      // (already there: it parks where it stands)
      m.at = 'night';
      m.goal = { ...s, at: 'night' };
      return null;
    }
    return { ...s, at: 'night' };
  },
  // A bus's loop: three to five stops spread over the town (the first by the
  // town hall), in order round its middle, each named for what it stands by.
  // (round 35) Stops stand on through streets inside the town's paving, by a
  // building (a farthest-apart pick put "Town Hall Northeast" on a dead-end
  // stub in a field), are drawn to distinct landmarks (market, temple,
  // academy, depot...), and take a street's name where none stands near
  // ("Town Hall > Town Hall North > Town Hall Northeast" read as one place).
  // (round 37) Only paved streets are candidates (_townRoads), and a stop
  // stands a tile and more inside the paving's edge.
  _townStops(t, cid) {
    const R = this._townRoads(t);
    const w = this.world;
    const civ = this.game.civ;
    const use = civ.use;
    const kc = civ.keepClear?.length === use.length ? civ.keepClear : null;
    const P = (i) => [(i % w.w) + 0.5, ((i / w.w) | 0) + 0.5];
    const road = (j) => use[j] === USE.ROAD && !kc?.[j];
    const bld = (j) => use[j] === USE.BUILDING;
    // (the paving the terrain draws, less a tile: the ring and the bus stand clear of its edge)
    const pr = this._townPaved(t) - 0.9;
    const inComp = R.all.filter((i) => R.comp.get(i) === cid);
    // a straight stretch of street (the way on and the way back both street,
    // nothing crossing) with a building on one side
    const straight = (i) => {
      const e = road(i + 1),
        o = road(i - 1),
        s2 = road(i + w.w),
        n = road(i - w.w);
      if (e && o && !s2 && !n) return bld(i + w.w) || bld(i - w.w);
      if (s2 && n && !e && !o) return bld(i + 1) || bld(i - 1);
      return false;
    };
    const inside = (i) => {
      const [x, z] = P(i);
      return (x - t.cx) ** 2 + (z - t.cz) ** 2 <= pr * pr;
    };
    const curbs = new Set(R.curb);
    const deg = (i) => (road(i + 1) ? 1 : 0) + (road(i - 1) ? 1 : 0) + (road(i + w.w) ? 1 : 0) + (road(i - w.w) ? 1 : 0);
    if (inComp.length < 6) return null;
    // how poor a place for a stop each street tile is: off the paving, a
    // dead end, a crossing or a bend, nothing built beside it
    const bad = (i) => (inside(i) ? 0 : 5) + (deg(i) < 2 ? 8 : 0) + (straight(i) ? 0 : curbs.has(i) ? 1.2 : 2.4);
    // (a young town's few streets: any of them, dead ends too, out to the paving's edge)
    let L = inComp.filter((i) => inside(i) && bad(i) < 8);
    if (L.length < 4) L = inComp.filter((i) => bad(i) < 8);
    if (L.length < 4) L = inComp;
    const good = L.filter((i) => bad(i) < 2).length;
    const n = Math.max(3, Math.min(5, Math.round(good / 8)));
    const hx = t.hall?.doorX ?? t.cx,
      hz = t.hall?.doorZ ?? t.cz;
    let first = L[0],
      bd = Infinity;
    for (const i of L) {
      const [x, z] = P(i);
      const d = Math.hypot(x - hx, z - hz) + bad(i) * 0.6;
      if (d < bd) (bd = d), (first = i);
    }
    const marks = this._stopMarks(t);
    const markOf = (i, avoid) => {
      const [x, z] = P(i);
      let best = null,
        bd2 = 2.6;
      for (const mk of marks) {
        if (avoid && avoid.has(mk.name)) continue;
        const d = mk.d(x, z);
        if (d < bd2) (bd2 = d), (best = mk);
      }
      return best;
    };
    const pick = [first];
    const usedB = new Set([STOP_NAME.hall]);
    while (pick.length < n) {
      let best = -1,
        bs = -Infinity;
      for (const i of L) {
        const [x, z] = P(i);
        let md = Infinity;
        for (const j of pick) {
          const [px, pz] = P(j);
          md = Math.min(md, Math.hypot(x - px, z - pz));
        }
        if (md < 3.2) continue;
        // spread out, by a landmark of its own, on a good street, not out at the edge
        const sc = Math.min(md, 7) + (markOf(i, usedB) ? 2.5 : 0) - bad(i) - 0.08 * Math.hypot(x - t.cx, z - t.cz);
        if (sc > bs) (bs = sc), (best = i);
      }
      if (best < 0) break;
      pick.push(best);
      const mk = markOf(best, usedB);
      if (mk) usedB.add(mk.name);
    }
    if (pick.length < 2) return null;
    const ang = (i) => {
      const [x, z] = P(i);
      return Math.atan2(z - t.cz, x - t.cx);
    };
    const a0 = ang(first);
    pick.sort((a, b) => ((ang(a) - a0 + Math.PI * 4) % (Math.PI * 2)) - ((ang(b) - a0 + Math.PI * 4) % (Math.PI * 2)));
    // names: each its own landmark, else the street it stands on
    // (the first, by the hall door, is the Town Hall stop; no other takes that name)
    const used = new Set();
    return pick.map((i) => {
      let mk = i === first ? marks.find((o) => o.name === STOP_NAME.hall && o.d(...P(i)) < 3.5) || null : null;
      if (!mk) mk = markOf(i, new Set([...used, STOP_NAME.hall]));
      const label = mk ? mk.name : this._streetName(t, i, used);
      used.add(label);
      return this._townStop(i, 'stop', label);
    });
  },
  // The landmarks a bus stop may be named for: the town's notable buildings,
  // each with its distance from a point to its footprint
  _stopMarks(t) {
    const out = [];
    const add = (b, name) => {
      const x0 = b.tx,
        z0 = b.ty,
        x1 = b.tx + (b.w || 1),
        z1 = b.ty + (b.h || 1);
      const extra = HOMES.has(b.type) ? 0.8 : 0;
      out.push({ name, d: (x, z) => Math.hypot(x - Math.max(x0, Math.min(x1, x)), z - Math.max(z0, Math.min(z1, z))) + extra });
    };
    for (const b of t.buildings || []) if (b.alive && !b.constructing && STOP_NAME[b.type] && b.tx != null) add(b, STOP_NAME[b.type]);
    const h = t.hall;
    if (h && h.alive !== false && h.tx != null && !(t.buildings || []).includes(h)) add(h, STOP_NAME.hall);
    return out;
  },
  // A street's name for a stop with no landmark beside it: the same name all
  // along one street of a town (by the street's line), never one the loop
  // has already used
  _streetName(t, i, used) {
    const w = this.world;
    const use = this.game.civ.use;
    const x = i % w.w,
      z = (i / w.w) | 0;
    const ew = use[i + 1] === USE.ROAD || use[i - 1] === USE.ROAD;
    const h = (((t.id + 1) * 2654435761) ^ (ew ? z * 40503 : x * 69069 + 17)) >>> 0;
    for (let k = 0; k < STREETS.length; k++) {
      const name = STREETS[(h + k) % STREETS.length];
      if (!used.has(name)) return name;
    }
    return `${COMPASS[Math.round(((Math.atan2(z + 0.5 - t.cz, x + 0.5 - t.cx) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8]} End`;
  },
  // (round 35) A town bus's loop along the streets round its stops, for the
  // map while the bus is selected: [x, z, ...] (closed), kept on the bus
  // until its stops change
  townLoopPath(v) {
    const m = v?.mission;
    if (!v?.alive || !m?.town || m.job !== 'loop' || !m.stops || m.stops.length < 2) return null;
    const key = m.stops.map((s) => s.i).join(',');
    if (m._loop?.key === key) return m._loop.pts;
    const t = this.game.civ?.villages?.[m.vid];
    if (!t) return null;
    const pts = [];
    for (let j = 0; j < m.stops.length; j++) {
      const a = m.stops[j],
        b = m.stops[(j + 1) % m.stops.length];
      const leg = this._townLeg(t, a.x, a.z, b.x, b.z);
      if (!leg) pts.push(a.x, a.z);
      else for (let k = 0; k < leg.length - 2; k += 2) pts.push(leg[k], leg[k + 1]);
    }
    m._loop = { key, pts };
    return pts;
  },
  // The street tile nearest a building's door, beside its footprint (within
  // a tile and a half of it), on the stretch of streets cid
  _curbBy(t, b, cid) {
    const R = this._townRoads(t);
    const w = this.world;
    let best = -1,
      bd = 2.3;
    const dx0 = b.doorX ?? b.x,
      dz0 = b.doorZ ?? b.z;
    for (const i of R.all) {
      if (R.comp.get(i) !== cid) continue;
      const x = (i % w.w) + 0.5,
        z = ((i / w.w) | 0) + 0.5;
      if (x < b.tx - 1.5 || x > b.tx + (b.w || 1) + 1.5 || z < b.ty - 1.5 || z > b.ty + (b.h || 1) + 1.5) continue;
      const d = Math.hypot(x - dx0, z - dz0);
      if (d < bd) (bd = d), (best = i);
    }
    return best;
  },
  // The van's depot: the curb by the market (else a granary, a workshop or a
  // factory; else the town hall), kept on the van while its street stands
  _townDepot(v, t) {
    const m = v.mission;
    const R = this._townRoads(t);
    const cid = this._townComp(t, v);
    if (m.depot && this.game.civ.use[m.depot.i] === USE.ROAD && R.comp.get(m.depot.i) === cid) return m.depot;
    for (const type of [...DEPOTS, 'hall']) {
      const B = type === 'hall' ? (t.hall?.alive ? [t.hall] : []) : (t.buildings || []).filter((b) => b.alive && !b.constructing && b.type === type);
      for (const b of B) {
        const i = this._curbBy(t, b, cid);
        if (i >= 0) return (m.depot = this._townStop(i, 'depot', type === 'hall' ? 'the town hall' : DROP_NAME[type] || 'the depot'));
      }
    }
    const L = (R.curb.length ? R.curb : R.all).filter((i) => R.comp.get(i) === cid);
    return L.length ? (m.depot = this._townStop(L[0], 'depot', 'the depot')) : null;
  },
  // A door for the next parcel: a home, a shop or a workshop of the town,
  // a few streets from where the van stands
  _townDrop(v, t) {
    const B = (t.buildings || []).filter((b) => b.alive && !b.constructing && DROP_NAME[b.type] && Math.hypot(b.x - v.x, b.z - v.z) >= 3);
    const cid = this._townComp(t, v);
    for (let k = 0; k < 10 && B.length; k++) {
      const j = (this.rng() * B.length) | 0;
      const b = B[j];
      B[j] = B[B.length - 1];
      B.pop();
      const i = this._curbBy(t, b, cid);
      if (i >= 0) return this._townStop(i, 'drop', DROP_NAME[b.type]);
    }
    return null;
  },
  // The next houses for the garbage truck: a curb by a home three to nine
  // tiles on (not one of its last few), else any curb a few tiles on
  _townPickup(v, t) {
    const R = this._townRoads(t);
    const w = this.world;
    const use = this.game.civ.use;
    const seen = v.mission.seen || [];
    const home = (j) => {
      if (use[j] !== USE.BUILDING) return false;
      const b = this.game.civ._bById?.get(w.building[j]);
      return !!b && HOMES.has(b.type);
    };
    const cid = this._townComp(t, v);
    let alt = -1;
    for (let k = 0; k < 32; k++) {
      const i = R.curb[(this.rng() * R.curb.length) | 0];
      if (i == null || seen.includes(i) || R.comp.get(i) !== cid) continue;
      const d = Math.hypot((i % w.w) + 0.5 - v.x, ((i / w.w) | 0) + 0.5 - v.z);
      if (d < 2.5 || d > 9) continue;
      if (home(i + 1) || home(i - 1) || home(i + w.w) || home(i - w.w)) return this._townStop(i, 'pickup', null);
      if (alt < 0) alt = i;
    }
    return alt >= 0 ? this._townStop(alt, 'pickup', null) : null;
  },
  // The dump: the street tile farthest out from the town's middle
  _townDump(v, t) {
    const R = this._townRoads(t);
    const w = this.world;
    const cid = this._townComp(t, v);
    let best = -1,
      bd = -1;
    for (const i of R.all) {
      if (R.comp.get(i) !== cid) continue;
      const d = ((i % w.w) + 0.5 - t.cx) ** 2 + (((i / w.w) | 0) + 0.5 - t.cz) ** 2;
      if (d > bd) (bd = d), (best = i);
    }
    return best >= 0 ? this._townStop(best, 'dump', 'the dump') : null;
  },
  // What a town vehicle is doing, in the card's words
  _townDoing(v) {
    const m = v.mission;
    const g = m.goal;
    // (round 35) off duty, in plain words (it was "Laid up")
    if (m.retire) {
      if (v.state === 'move') return 'Off duty: driving back to the depot';
      return g?.at === 'off' && Math.hypot(g.x - v.x, g.z - v.z) < 0.9 ? 'Off duty: parked at the depot' : 'Off duty: parked by the curb';
    }
    if (v.state === 'move') {
      if (g?.at === 'night') return m.job === 'loop' ? 'Heading to its stand for the night' : 'Heading back to the depot for the night';
      if (m.job === 'loop') return g?.label ? `Driving to the ${g.label} stop` : 'Running the town loop';
      if (m.job === 'deliver') return g?.at === 'depot' ? 'Driving back to the depot' : `Delivering a parcel to ${g?.label || 'a house'}`;
      return g?.at === 'dump' ? 'Taking the trash to the dump' : g?.at === 'depot' ? 'Driving back to the depot' : 'Collecting the trash';
    }
    if (m.at === 'night') return 'Parked for the night';
    if (m.at === 'start' || m.at === 'off' || !m.at) return 'Setting out on its rounds';
    if (m.job === 'loop') return `Picking up riders at the ${g?.label || 'next'} stop`;
    if (m.job === 'deliver') return m.at === 'depot' ? 'Loading parcels at the depot' : `Dropping off a parcel at ${g?.label || 'a house'}`;
    return m.at === 'dump' ? 'Tipping its load at the dump' : m.at === 'depot' ? 'Waiting at the depot for more rounds' : 'Emptying the trash cans';
  },
  // (round 35) Why a town vehicle is off duty, in the card's words
  _townWhyText(v) {
    const m = v.mission;
    const name = this.game.civ?.villages?.[m.vid]?.name || 'the town';
    switch (m.retire) {
      case 'small':
        return `No longer needed: ${name} is too small`;
      case 'lost':
        return `No longer needed: ${name} is gone`;
      case 'realm':
        return `No longer needed: ${name} changed hands`;
      case 'era':
        return `No longer needed: ${name} can no longer run motor vehicles`;
      case 'spare':
        return `No longer needed: ${name} has another one`;
      case 'stuck':
        return 'No way on through the streets';
      default:
        return 'Resting: only so many town vehicles run at once';
    }
  },
  // The card's own rows for a town vehicle
  _townRows(v, stats) {
    const m = v.mission;
    if (!m?.town) return;
    if (m.retire) stats.push(['Why', this._townWhyText(v)]);
    if (m.job === 'loop') {
      stats.push(['Riders', `${m.riders | 0} aboard`]);
      // (round 35) the loop by its stops' names, not a bare count
      if (m.stops?.length) stats.push(['Route', m.stops.map((st) => st.label || 'Stop').join(' › ')]);
    } else if (m.job === 'deliver') stats.push(['Parcels', `${m.parcels | 0} left`]);
    else stats.push(['Load', `${Math.round((m.load || 0) * 100)}%`]);
  },
};
