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
// truck); one whose town falls out of that share, out of the era or into
// another realm's hands leaves when it is out of sight. They are outside the
// world's land limit (Fleet.landTally), so intercity trucks and the civic
// services keep their places.
//
// PUBLIC CONTRACT (additions to game.fleet)
//   vehicle.town      the town (village id) a town vehicle serves
//   vehicle.mission   {type: 'town', town: true, job: 'loop'|'deliver'|'refuse',
//                      at (where it stands: 'stop', 'drop', 'depot', 'pickup',
//                      'dump', 'night', 'start'), goal {x, z, at, label},
//                      riders | parcels | load, stops (a bus's loop)}
//   townCount(vid?)   town vehicles (of one town)

const JOB = { bus: 'loop', van: 'deliver', garbage: 'refuse' };
// seconds at each kind of stop
const WAIT = { stop: 3.2, drop: 4.5, pickup: 2.4, depot: 6, dump: 5, start: 0.5 };
// a town bus at town pace (the transit buses' 2.0 outran every car on the street)
const BUS_DEF = Object.freeze({ ...KINDS.bus, capacity: 0, speed: 1.15 });
// a bus stop is named for the building it stands by
const STOP_NAME = { hall: 'Town Hall', market: 'Market', temple: 'Temple', library: 'Library', academy: 'Academy', campus: 'Campus', clinic: 'Clinic', hospital: 'Hospital', station: 'Station', factory: 'Factory', workshop: 'Workshops', park: 'Park', firestation: 'Fire Station', skyscraper: 'Towers', docks: 'Harbor', granary: 'Granary', barracks: 'Barracks', forum: 'Forum', statue: 'Statue', waterworks: 'Waterworks', powerstation: 'Power Station', airfield: 'Airfield', airport: 'Airport', observatory: 'Observatory', healer: 'Clinic', apartment: 'Apartments', rowhouse: 'Terrace' };
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
      const key = `${v.town}|${v.kind}|${v.kingdom}`;
      if (have.has(key)) this._ended(v, 'laid up');
      else have.set(key, v);
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
    for (const [key, v] of have) if (!keep.has(key) && (off || !this._townSeen(v))) this._ended(v, 'laid up');
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
  // A town's streets for its own vehicles (kept a few seconds on the town):
  // `all` the street tiles inside the town where a vehicle may stop (off the
  // square and the streets round it, Fleet._paveMask, and off the railway),
  // `curb` those beside a building or a plot, `comp` which stretch of
  // joined-up streets each street tile is on (joined without crossing the
  // square or the parade pad, civ.keepClear; across the railway), `main` the
  // stretch with the most curbs.
  _townRoads(t) {
    const now = this.game.time.total;
    const c = t._townR;
    if (c && now - c.t < 6) return c;
    const w = this.world;
    const civ = this.game.civ;
    const use = civ.use;
    const rail = civ.railMask;
    const pv = this._paveMask();
    const rr = (t.radius || 6) * 1.05 + 1;
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
    const R2 = (rr + 4) ** 2;
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
  // (x1, z1): road tiles only, never the square or the parade pad (the
  // streets round the square and the railway dear, the streets out of town
  // a little dearer), or null when it cannot get there.
  _townLeg(t, x0, z0, x1, z1) {
    const w = this.world;
    const civ = this.game.civ;
    const use = civ.use;
    const rail = civ.railMask;
    const pv = this._paveMask();
    const kc = civ.keepClear?.length === use.length ? civ.keepClear : null;
    const rr = ((t.radius || 6) * 1.25 + 2) ** 2;
    const sx = Math.floor(x0),
      sz = Math.floor(z0),
      gx = Math.floor(x1),
      gz = Math.floor(z1);
    if (!w.inBounds(sx, sz) || !w.inBounds(gx, gz) || (sx === gx && sz === gz)) return null;
    const cost = (i) => {
      if (use[i] !== USE.ROAD || kc?.[i]) return Infinity;
      if (pv[i]) return 8;
      if (rail?.[i]) return 9;
      const dx = (i % w.w) + 0.5 - t.cx,
        dz = ((i / w.w) | 0) + 0.5 - t.cz;
      return dx * dx + dz * dz > rr ? 4 : 1;
    };
    const p = civPath(w, sx, sz, gx, gz, cost, 1800, 1);
    if (!p || !p.length || p[p.length - 1] !== gz * w.w + gx) return null;
    const path = [x0, z0];
    for (const i of p) path.push((i % w.w) + 0.5, ((i / w.w) | 0) + 0.5);
    return path;
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
    const t = this.game.civ?.villages?.[m.vid];
    if (!t?.alive) return this._ended(v, 'laid up');
    v.speed = 0;
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
    if (!t?.alive) return this._ended(v, 'laid up');
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
      if (!m.stops || m.stops.some((s) => this.game.civ.use[s.i] !== USE.ROAD)) {
        m.stops = this._townStops(t, this._townComp(t, v));
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
    } else if (m.job === 'deliver') tgt = (m.parcels || 0) <= 0 ? this._townDepot(v, t) : this._townDrop(v, t);
    else tgt = (m.load || 0) >= 0.98 ? this._townDump(v, t) : this._townPickup(v, t);
    const path = tgt && this._townLeg(t, v.x, v.z, tgt.x, tgt.z);
    if (!path) {
      // (nowhere to go just now: it waits a moment and looks again)
      m.fail = (m.fail || 0) + 1;
      if (m.job === 'loop') m.stops = null;
      if (m.fail > 20) return this._ended(v, 'laid up');
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
  // Where it spends the night: a bus at its first stop, the others at the depot
  _townHome(v, t) {
    const m = v.mission;
    let s = null;
    if (m.job === 'loop') s = (m.stops || this._townStops(t, this._townComp(t, v)))?.[0];
    else s = this._townDepot(v, t);
    if (!s) return null;
    if (this.dist(s.x, s.z, v.x, v.z) < 0.6) {
      // (already there: it parks where it stands)
      m.at = 'night';
      m.goal = { ...s, at: 'night' };
      return null;
    }
    return { ...s, at: 'night' };
  },
  // A bus's loop: three to five curbs spread over the town (the first by the
  // town hall), in order round its middle, each named for what it stands by
  // (two, there and back, on a young town's short stretch of street).
  _townStops(t, cid) {
    const R = this._townRoads(t);
    const cur = R.curb.filter((i) => R.comp.get(i) === cid);
    const L = cur.length >= 6 ? cur : R.all.filter((i) => R.comp.get(i) === cid);
    if (L.length < 6) return null;
    const w = this.world;
    const n = Math.max(3, Math.min(5, Math.round(L.length / 12)));
    const P = (i) => [(i % w.w) + 0.5, ((i / w.w) | 0) + 0.5];
    const hx = t.hall?.doorX ?? t.cx,
      hz = t.hall?.doorZ ?? t.cz;
    let first = L[0],
      bd = Infinity;
    for (const i of L) {
      const [x, z] = P(i);
      const d = (x - hx) ** 2 + (z - hz) ** 2;
      if (d < bd) (bd = d), (first = i);
    }
    const pick = [first];
    while (pick.length < n) {
      let best = -1,
        bs = -1;
      for (const i of L) {
        const [x, z] = P(i);
        let md = Infinity;
        for (const j of pick) {
          const [px, pz] = P(j);
          md = Math.min(md, (x - px) ** 2 + (z - pz) ** 2);
        }
        if (md > bs) (bs = md), (best = i);
      }
      if (best < 0 || bs < 4) break;
      pick.push(best);
    }
    // (a young town's short stretch of street: two stops, there and back)
    if (pick.length < 2) return null;
    const ang = (i) => {
      const [x, z] = P(i);
      return Math.atan2(z - t.cz, x - t.cx);
    };
    const a0 = ang(first);
    pick.sort((a, b) => ((ang(a) - a0 + Math.PI * 4) % (Math.PI * 2)) - ((ang(b) - a0 + Math.PI * 4) % (Math.PI * 2)));
    const used = new Set();
    return pick.map((i) => {
      const [x, z] = P(i);
      let label = this._stopName(t, x, z);
      if (used.has(label)) label = `${label} ${COMPASS[Math.round(((Math.atan2(z - t.cz, x - t.cx) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8]}`;
      used.add(label);
      return this._townStop(i, 'stop', label);
    });
  },
  // A stop's name: the notable building beside it, else its side of town
  _stopName(t, x, z) {
    let best = null,
      bd = 3.6;
    for (const b of t.buildings || []) {
      if (!b.alive || b.constructing || !STOP_NAME[b.type]) continue;
      const cx = Math.max(b.tx, Math.min(b.tx + (b.w || 1), x)),
        cz = Math.max(b.ty, Math.min(b.ty + (b.h || 1), z));
      const d = Math.hypot(cx - x, cz - z) + (HOMES.has(b.type) ? 1.2 : 0);
      if (d < bd) (bd = d), (best = b);
    }
    if (best) return STOP_NAME[best.type];
    const a = Math.atan2(z - t.cz, x - t.cx);
    if (Math.hypot(x - t.cx, z - t.cz) < 3) return 'Main Street';
    return `${COMPASS[Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8]} End`;
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
    if (v.state === 'move') {
      if (g?.at === 'night') return m.job === 'loop' ? 'Heading to its stand for the night' : 'Heading back to the depot for the night';
      if (m.job === 'loop') return g?.label ? `Driving to the ${g.label} stop` : 'Running the town loop';
      if (m.job === 'deliver') return g?.at === 'depot' ? 'Driving back to the depot' : `Delivering a parcel to ${g?.label || 'a house'}`;
      return g?.at === 'dump' ? 'Taking the trash to the dump' : 'Collecting the trash';
    }
    if (m.at === 'night') return 'Parked for the night';
    if (m.at === 'start' || !m.at) return 'Setting out on its rounds';
    if (m.job === 'loop') return `Picking up riders at the ${g?.label || 'next'} stop`;
    if (m.job === 'deliver') return m.at === 'depot' ? 'Loading parcels at the depot' : `Dropping off a parcel at ${g?.label || 'a house'}`;
    return m.at === 'dump' ? 'Tipping its load at the dump' : 'Emptying the trash cans';
  },
  // The card's own rows for a town vehicle
  _townRows(v, stats) {
    const m = v.mission;
    if (!m?.town) return;
    if (m.job === 'loop') {
      stats.push(['Riders', `${m.riders | 0} aboard`]);
      if (m.stops?.length) stats.push(['Route', `Loop of ${m.stops.length} stops`]);
    } else if (m.job === 'deliver') stats.push(['Parcels', `${m.parcels | 0} left`]);
    else stats.push(['Load', `${Math.round((m.load || 0) * 100)}%`]);
  },
};
