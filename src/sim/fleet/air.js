import { AIR_KINDS } from './kinds.js';
import { geoDelta } from '../../world/geo.js';
import { BUILDING, VEHICLE } from '../../core/scale.js';
import { civPath } from '../civ/pathing.js';
import { USE } from '../civ/util.js';

const YEAR = 30;
const COUNT = 6; // a rocket's countdown on the pad (seconds) before it lifts off

// Modern and future vehicles (docs/MODERN-ERAS.md), mixed into Fleet. STUBS:
// trains, trucks, cars and the modern warships and guns run as the nearest
// existing kind with their own stats (kinds.js STUB_KINDS; vehicle.model is
// the real kind). Aircraft and rockets fly as plain records in `this.air`
// (straight routes at altitude, no terrain pathing) and satellites and
// stations circle in `this.orbit`; the air layer that draws them comes next.
//
// PUBLIC CONTRACT (additions to game.fleet)
//   warModel(kid) / siegeModel(kid, kind) / tradeModel(kid)  the realm's newest kind
//   requestTrain({kingdom, line})          a train along a rail or maglev line (civ.railLines())
//   requestCar({kingdom, village})          a car on a short drive through a town
//   requestFlight({kind, kingdom, from, to, cargo})
//       kind: plane|biplane|airliner|jet|drone|skytaxi; from: building id
//       (airfield, airport, or any building such as a town hall for drones and
//       sky taxis); to: building id | {x, z}. Refused in a storm (aircraft are
//       grounded) and beyond the air budget. Emits 'fleet:landed'
//       {flight, kind, kingdom, from, to, cargo, x, z} on arrival.
//   requestLaunch({kingdom, from, payload})  payload: satellite|station|starship;
//       from: a launch pad or spaceport building id. Emits 'fleet:orbit'
//       {kingdom, payload, x, z} when the payload reaches orbit (a starship
//       then leaves for the stars).
//   air: [{id, kind, model, cls 'air'|'space', def, kingdom, name, x, y, z,
//          px, py, pz, heading, alive, phase, t, dur, from, to, cargo}]
//   orbit: [{id, kind 'satellite'|'station', kingdom, a (angle), r (radius
//          as a share of the world), speed, tilt}]  for the night sky
export const air = {
  // ------------------------------------------------------------------ newest kinds
  // A war fleet of the era: battleships with destroyers to screen them,
  // submarines and, once known, a carrier (one per realm at a time).
  warModel(kid) {
    const r = this.rng();
    if (this.canUse(kid, 'carrier') && r < 0.3 && this.count(kid, 'carrier') < 1) return 'carrier';
    if (this.canUse(kid, 'submarine') && r < 0.5) return 'submarine';
    if (this.canUse(kid, 'patrol') && r < 0.75) return 'patrol';
    if (this.canUse(kid, 'battleship')) return 'battleship';
    if (this.canUse(kid, 'ironclad')) return 'ironclad';
    return this._modernEra(kid) ? 'patrol' : null;
  },
  // A realm of the Modern era or later (era 5+) fields no old kinds: no rams,
  // ox carts, galleys or cogs (a Future realm still sent a battering ram to
  // war at Year 600). Civilization retires the ones it still has.
  _modernEra(kid) {
    return (this.kingdom(kid)?.era ?? 0) >= 5;
  },
  siegeModel(kid, kind) {
    const late = this._modernEra(kid);
    if (kind === 'ram') return late || this.hasTech(kid, 'battleships') ? 'tank' : null;
    if (kind === 'catapult') return late || this.hasTech(kid, 'battleships') ? 'artillery' : this.hasTech(kid, 'gunpowder') ? 'cannon' : null;
    return null;
  },
  // Road haulage: trucks take over from carts, a few carts at a time, and
  // carts are gone altogether in the Modern era
  cartModel(kid) {
    if (this._modernEra(kid)) return 'truck';
    return this.hasTech(kid, 'combustion') && this.rng() < 0.75 ? 'truck' : null;
  },
  // The modern ship of the same routine for an old kind a Modern realm asks
  // for (requestVoyage), or null to sail the old kind
  voyageModel(kid, kind) {
    if (!this._modernEra(kid)) return null;
    if (kind === 'galley') return this.warModel(kid);
    if (kind === 'cog') return this.canUse(kid, 'freighter') ? 'freighter' : 'steamer';
    return null;
  },
  // Sea trade: the newest hull most of the time, the one before it now and
  // then (older kinds give way gradually, never all at once).
  // Atomic realms add tankers to the bulk trade, the Future crewless cargo
  // ships and solar trimarans; `o.passengers` (a friendly port of another
  // realm) may sail a cruise liner, `o.short` a hydrofoil ferry.
  tradeModel(kid, o = {}) {
    const L = [];
    if (this.canUse(kid, 'steamer')) L.push('steamer');
    if (this.canUse(kid, 'freighter')) L.push('freighter');
    if (this.canUse(kid, 'container')) L.push(this.canUse(kid, 'tanker') && this.rng() < 0.35 ? 'tanker' : 'container');
    if (this.canUse(kid, 'autocargo')) L.push(this.rng() < 0.5 ? 'trimaran' : 'autocargo');
    if (!L.length) return this._modernEra(kid) ? 'steamer' : null;
    if (o.passengers && this.canUse(kid, 'liner') && this.rng() < 0.3 && this.count(kid, 'liner') < 2) return 'liner';
    if (o.short && this.canUse(kid, 'hydrofoil') && this.rng() < 0.4 && this.count(kid, 'hydrofoil') < 3) return 'hydrofoil';
    const r = this.rng();
    return r < 0.7 || L.length === 1 ? L[L.length - 1] : L[L.length - 2];
  },

  // ------------------------------------------------------------------ rails and roads
  requestTrain(o = {}) {
    const civ = this.game.civ;
    const line = typeof o.line === 'object' ? o.line : civ?.railLine?.(o.line);
    if (!line || !line.pts || line.pts.length < 4) return null;
    if (this.landCount() >= this.budget.land) return null;
    const a = civ.villages[line.a],
      b = civ.villages[line.b];
    if (!a?.alive || !b?.alive) return null;
    const kid = o.kingdom ?? line.kingdom;
    // one train at a time on a line
    if (this.list.some((v) => v.alive && v.mission?.rail === line.id)) return null;
    // on the rails themselves: a line's pts are the centre of the drawn track
    const fwd = o.reverse ? reversePts(line.pts) : line.pts;
    const from = o.reverse ? b : a,
      to = o.reverse ? a : b;
    const model = line.kind === 'maglev' ? 'maglev' : 'train';
    const v = this.spawn('oxcart', kid, fwd[0], fwd[1], { home: from.id, state: 'move', heading: Math.atan2(fwd[3] - fwd[1], fwd[2] - fwd[0]), model });
    if (!v) return null;
    v.trail = null; // (the cars ride the rails behind the engine: FleetRenderer reads v.path)
    // goods ride from the fuller store to the emptier
    const cargo = {};
    for (const r of ['food', 'wood', 'stone']) {
      const spare = (from[r] || 0) - (r === 'food' ? (from.pop || 0) * 3 + 25 : 30);
      if (spare > 8 && (to[r] || 0) < (from[r] || 0)) {
        const take = Math.floor(Math.min(spare * 0.5, v.def.capacity / 2));
        from[r] -= take;
        cargo[r] = take;
      }
    }
    v.cargo = Object.keys(cargo).length ? cargo : null;
    v.anim.cargoType = cargo.wood ? 0 : cargo.stone ? 1 : 2;
    v.mission = { type: 'train', phase: 'out', from: from.id, to: to.id, rail: line.id };
    v.voyage = { from: from.id, to: to.id, fromName: from.name, toName: to.name };
    this._trainOnto(v, fwd);
    this.totals.trains = (this.totals.trains || 0) + 1;
    return v;
  },
  // Set a train on its route with its whole length on the rails: the engine
  // a train's length along from the start (its cars behind it to the buffer).
  _trainOnto(v, P) {
    this.setPath(v, P);
    let back = Math.max(0, (v.def.cars || 1) - 1) * v.def.length + 0.1;
    for (let k = 0; k + 3 < P.length; k += 2) {
      const L = Math.hypot(P[k + 2] - P[k], P[k + 3] - P[k + 1]);
      if (L >= back) {
        const t = back / (L || 1);
        v.x = v.px = P[k] + (P[k + 2] - P[k]) * t;
        v.z = v.pz = P[k + 1] + (P[k + 3] - P[k + 1]) * t;
        v.heading = v.ph = Math.atan2(P[k + 3] - P[k + 1], P[k + 2] - P[k]);
        v.pi = k + 2;
        return;
      }
      back -= L;
    }
    // (a line shorter than the train: it starts at the beginning)
    v.x = v.px = P[0];
    v.z = v.pz = P[1];
  },
  _trainArrive(v, m, to) {
    const civ = this.game.civ;
    if (to?.alive && v.cargo) for (const [r, n] of Object.entries(v.cargo)) to[r] = (to[r] || 0) + n;
    this.game.events.emit('fleet:delivered', { vehicle: v, kind: v.kind, model: v.model, kingdom: v.kingdom, from: m.from, to: m.to, cargo: v.cargo });
    v.cargo = null;
    m.phase = 'home';
    const line = civ.railLine?.(m.rail);
    if (!line?.pts) return this.remove(v);
    // the engine runs round to the other end of its train for the way home
    this._trainOnto(v, line.a === m.from ? reversePts(line.pts) : line.pts);
    v.state = 'rest';
    v.stateT = 0;
  },
  // Combustion: a car drives a short way along a town's streets.
  requestCar(o = {}) {
    const civ = this.game.civ;
    const v0 = civ?.villages?.[o.village];
    if (!v0?.alive || !v0.roadTiles?.length || this.landCount() >= this.budget.land * 0.9) return null;
    const w = this.world;
    const R = v0.roadTiles;
    const i0 = R[(this.rng() * R.length) | 0],
      i1 = R[(this.rng() * R.length) | 0];
    if (i0 === i1 || civ.use?.[i0] !== USE.ROAD || civ.use?.[i1] !== USE.ROAD) return null;
    const x0 = i0 % w.w,
      y0 = (i0 / w.w) | 0,
      x1 = i1 % w.w,
      y1 = (i1 / w.w) | 0;
    if (Math.hypot(x1 - x0, y1 - y0) < 5) return null;
    const use = civ.use;
    const p = civPath(w, x0, y0, x1, y1, (i) => (use[i] === USE.ROAD ? 1 : Infinity), 1500, 1);
    if (!p || p.length < 4) return null;
    const path = [x0 + 0.5, y0 + 0.5];
    for (const i of p) path.push((i % w.w) + 0.5, ((i / w.w) | 0) + 0.5);
    const v = this.spawn('oxcart', o.kingdom ?? v0.kingdom, path[0], path[1], { home: v0.id, state: 'move', heading: Math.atan2(path[3] - path[1], path[2] - path[0]), model: 'car' });
    if (!v) return null;
    v.mission = { type: 'drive', phase: 'out', from: v0.id, to: v0.id };
    v.voyage = { from: v0.id, to: v0.id, fromName: v0.name, toName: v0.name };
    this.setPath(v, path);
    return v;
  },

  // ------------------------------------------------------------------ the air
  // Aircraft take off from a runway (an airfield's or an airport's, or a
  // carrier's deck), climb, cruise at their height above the land on a
  // straight or gently curving course (the short way round a Round world),
  // turn onto the approach, land and roll out; drones, sky taxis and rescue
  // helicopters rise and settle straight up and down. Storms, solar storms
  // and Blackouts ground them: those aloft make for the nearest field.
  airCount(kid = null, kind = null) {
    let n = 0;
    for (const f of this.air) if (f.alive && (kid == null || f.kingdom === kid) && (kind == null || f.kind === kind)) n++;
    return n;
  },
  // Grounded: a storm, a solar storm, or (Blackout) a town without power.
  grounded(x = null, z = null) {
    if (this.storm() > 0.5 || this.solarStormLevel() > 0.2) return true;
    if (x != null) {
      const civ = this.game.civ;
      const v = civ?.villageAt?.(x, z, 12);
      // (Blackout, Civ development: a town dark until game time blackoutUntil, or blackout)
      if (v && (v.blackoutUntil ?? v.blackout ?? 0) > this.game.time.total) return true;
    }
    return false;
  },
  solarStormLevel() {
    const S = this.solarStorm;
    if (!S) return 0;
    const now = this.game.time.total;
    if (now > S.until) return 0;
    return Math.min(1, (now - S.start) / 4, (S.until - now) / 8);
  },
  // A place an aircraft flies from or to: a building (its runway when it is
  // an airfield or an airport), a ship (a carrier: {vessel: id}) or a point.
  _airPoint(ref) {
    if (ref == null) return null;
    if (typeof ref === 'object' && ref.vessel != null) {
      const v = this.byId.get(ref.vessel);
      return v && v.alive && v.state !== 'sinking' ? { x: v.x, z: v.z, vessel: v.id, building: null } : null;
    }
    if (typeof ref === 'object' && ref.x != null) return { x: ref.x, z: ref.z, building: ref.building ?? null };
    const b = this.game.civ?._bById?.get(ref);
    if (!b || !b.alive) return null;
    return { x: b.x, z: b.z, building: b.id, rw: this._runway(b) };
  },
  // The runway of an airfield or an airport: its two ends in the world (the
  // models' strips run along their local x; BuildingRenderer turns them by
  // b.rotation and scales them by BUILDING.scale).
  _runway(b) {
    const R = RUNWAYS[b.type];
    if (!R) return null;
    const r = b.rotation || 0,
      c = Math.cos(r),
      s = Math.sin(r);
    const S = BUILDING.scale;
    const P = (lx, lz) => ({ x: b.x + (lx * c + lz * s) * S, z: b.z + (-lx * s + lz * c) * S });
    return { a: P(R.x0, R.z), b: P(R.x1, R.z), len: (R.x1 - R.x0) * S, y: (R.y || 0) * S };
  },
  // Airfields of a realm, for the storm diversions and carriers' jets.
  _fields(kid) {
    const out = [];
    const k = this.kingdom(kid);
    const civ = this.game.civ;
    for (const vid of k?.villages || []) for (const b of civ.villages[vid]?.buildings || []) if (b.alive && !b.constructing && RUNWAYS[b.type]) out.push(b);
    return out;
  },
  requestFlight(o = {}) {
    const refuse = (why) => {
      this.lastRefusal = why;
      return null;
    };
    const def = AIR_KINDS[o.kind];
    if (!def || def.cls !== 'air') return refuse('no such aircraft');
    const K = this.kingdom(o.kingdom);
    if (!K || K.alive === false) return refuse('no such realm');
    // drones, sky taxis and helicopters share half the air budget, so the
    // planes that use the runways always find room in the sky (round 16: the
    // drones of a Future realm filled it and no airport saw a take-off)
    if (this._airFull(def)) return refuse('the skies are crowded');
    const from = this._airPoint(o.from),
      to = this._airPoint(o.to);
    if (!from || !to) return refuse('no airfield');
    if (this.grounded(from.x, from.z)) return refuse(this.solarStormLevel() > 0.2 ? 'aircraft are grounded by the solar storm' : this.storm() > 0.5 ? 'aircraft are grounded by the storm' : 'the airfield has no power');
    if (this.dist(from.x, from.z, to.x, to.z) < 1) return refuse('nowhere to fly');
    const f = this._airRecord(o.kind, def, o.kingdom, from, to, o.cargo);
    f.home = o.home ?? (o.cargo?.strike || o.cargo?.rescue ? from : null); // sorties and rescues fly home again
    f.arc = (this.rng() < 0.5 ? -1 : 1) * (0.25 + this.rng() * 0.5); // a gentle curve (heading drift)
    this._depart(f);
    this.first(o.kingdom, o.kind, { x: from.x, z: from.z });
    this.game.events.emit('fleet:launched', { vessel: f, kind: o.kind, model: o.kind, kingdom: o.kingdom });
    return f;
  },
  _airFull(def) {
    let vt = 0,
      wing = 0;
    for (const f of this.air) if (f.alive && f.cls === 'air') f.def?.vtol ? vt++ : wing++;
    const cap = this.budget.air;
    return def.vtol ? vt >= Math.ceil(cap * 0.5) || vt + wing >= cap : wing >= cap;
  },
  // Airports and airfields keep busy: every so often each sends a plane up
  // (to another field of its realm or a friendly airport, or round a circuit
  // over the country and back onto its own runway), so a look at a field
  // soon finds a take-off or a landing.
  _airportOps(dt) {
    const civ = this.game.civ;
    if (!civ) return;
    const now = this.game.time.total;
    if (!this._fieldList || now - (this._fieldT ?? -99) > 10) {
      this._fieldT = now;
      this._fieldList = civ.buildings.filter((b) => b && b.alive && !b.gone && !b.constructing && RUNWAYS[b.type]);
    }
    if (!this._fieldList.length || this.grounded()) return;
    void dt;
    for (const b of this._fieldList) {
      if (!b.alive || b.constructing) continue;
      if (b._airNext == null) b._airNext = now + 4 + this.rng() * 10;
      if (now < b._airNext) continue;
      const port = b.type === 'airport';
      b._airNext = now + (port ? 16 : 28) + this.rng() * (port ? 12 : 16);
      const K = this.kingdom(b.kingdom);
      if (!K || K.alive === false || !this.hasTech(b.kingdom, 'flight')) continue;
      const kind = port && this.hasTech(b.kingdom, 'jets') ? 'airliner' : 'plane';
      if (this._airFull(AIR_KINDS[kind]) || this.grounded(b.x, b.z)) continue;
      // somewhere to fly: a field of its own realm or a friendly airport,
      // not too near and not across half the world; else a circuit
      let to = null;
      if (this.rng() < 0.5) {
        const L = this._fieldList.filter((o) => o !== b && o.alive && (o.kingdom === b.kingdom || (o.type === 'airport' && !civ.atWar?.(o.kingdom, b.kingdom))) && this.dist(o.x, o.z, b.x, b.z) > 24 && this.dist(o.x, o.z, b.x, b.z) < 180);
        if (L.length) to = L[(this.rng() * L.length) | 0];
      }
      const rw = this._runway(b);
      let f;
      if (to) f = this.requestFlight({ kind, kingdom: b.kingdom, from: b.id, to: to.id });
      else if (rw) {
        // out along the runway, a wide turn and back in to land
        const ux = (rw.b.x - rw.a.x) / (rw.len || 1),
          uz = (rw.b.z - rw.a.z) / (rw.len || 1);
        const sd = this.rng() < 0.5 ? -1 : 1;
        const out = 26 + this.rng() * 14;
        const W = this.world;
        const px = Math.max(2, Math.min(W.w - 2, b.x + ux * out * sd - uz * out * 0.6)),
          pz = Math.max(2, Math.min(W.h - 2, b.z + uz * out * sd + ux * out * 0.6));
        f = this.requestFlight({ kind, kingdom: b.kingdom, from: b.id, to: { x: px, z: pz } });
        if (f) f.circuit = { x: b.x, z: b.z, building: b.id, rw };
      }
      if (f) f.local = true;
    }
  },
  _airRecord(kind, def, kid, from, to, cargo) {
    const g = this.game;
    const gy = Math.max(0, this.world.heightAt(from.x, from.z));
    const d = geoDelta(this.world, from.x, from.z, to.x, to.z);
    const f = {
      id: this._nextId++,
      kind,
      model: kind,
      cls: def.cls,
      def,
      kingdom: kid,
      name: `${def.name}${this.kingdom(kid) ? ' of ' + this.kname(kid) : ''}`,
      x: from.x,
      z: from.z,
      y: gy + 0.05,
      px: from.x,
      pz: from.z,
      py: gy + 0.05,
      heading: Math.atan2(d.dz, d.dx),
      ph: 0,
      turnRate: 0,
      vy: 0,
      speedNow: 0,
      hp: def.hp || 50,
      maxHp: def.hp || 50,
      alive: true,
      phase: 'parked',
      t: 0,
      dur: 10,
      arc: 0,
      from,
      to,
      cargo: cargo || null,
      born: g.time.total,
      seed: this.rng(),
      thrust: 0,
      stageV: 0,
      tilt: 0,
    };
    f.ph = f.heading;
    this.air.push(f);
    this.version++;
    return f;
  },
  // Line up for take-off: on the runway (the end that sends it toward its
  // goal), on a carrier's deck, or (VTOL) straight up from where it stands.
  _depart(f) {
    const from = f.from;
    f.t = 0;
    f.speedNow = 0;
    if (f.def.vtol) {
      f.phase = 'rise';
      return;
    }
    const rw = from.rw;
    if (from.vessel != null) {
      const v = this.byId.get(from.vessel);
      f.heading = f.ph = v ? v.heading : f.heading;
      f.deck = { vessel: from.vessel, run: 0 };
      f.phase = 'roll';
      f.y = f.py = 0.35 * VEHICLE.sea;
      return;
    }
    if (rw) {
      const d = geoDelta(this.world, f.x, f.z, f.to.x, f.to.z);
      const ab = Math.atan2(rw.b.z - rw.a.z, rw.b.x - rw.a.x);
      const fwd = Math.cos(ab) * d.dx + Math.sin(ab) * d.dz >= 0;
      const s = fwd ? rw.a : rw.b,
        e = fwd ? rw.b : rw.a;
      f.x = f.px = s.x;
      f.z = f.pz = s.z;
      f.heading = f.ph = Math.atan2(e.z - s.z, e.x - s.x);
      f.rollLen = rw.len;
    } else f.rollLen = 2;
    f.wheels = wheelsY(rw);
    f.y = f.py = Math.max(0, this.world.heightAt(f.x, f.z)) + f.wheels;
    f.phase = 'roll';
    f.rolled = 0;
  },
  // Where an aircraft is going now: its goal, or the start of its approach.
  _airGoal(f) {
    const to = f.to;
    if (to.vessel != null) {
      const v = this.byId.get(to.vessel);
      if (!v || !v.alive || v.state === 'sinking') return null;
      to.x = v.x;
      to.z = v.z;
      to.h = v.heading;
    }
    return to;
  },
  _airTick(step) {
    const w = this.world;
    const W = w.w;
    const wrap = this.nav.wrap;
    const now = this.game.time.total;
    for (const f of this.air) {
      if (!f.alive) continue;
      f.px = f.x;
      f.pz = f.z;
      f.py = f.y;
      f.ph = f.heading;
      f.t += step;
      if (f.cls === 'space') {
        this._rocketTick(f, step);
        continue;
      }
      const def = f.def;
      const ground = (x, z) => Math.max(0, w.heightAt(x, z));
      const alt = def.alt || 5;
      if (f.phase === 'crash') {
        // struck down: it falls burning, spinning, and is lost where it lands
        f.vy = (f.vy || 0) - step * 9;
        f.heading += step * 2.5;
        f.turnRate = 2.5;
        f.x += Math.cos(f.heading) * (f.speedNow || 0) * step * 0.6;
        f.z = Math.max(0, Math.min(w.h - 0.01, f.z + Math.sin(f.heading) * (f.speedNow || 0) * step * 0.6));
        f.y += f.vy * step;
        if (this.rng() < step * 6) this._fx('smoke', f.x, f.z, 0.5, { y: f.y, dark: true, count: 1 });
        if (f.y <= ground(f.x, f.z)) {
          f.alive = false;
          this.version++;
          const sea = w.heightAt(f.x, f.z) < 0;
          this._fx(sea ? 'splash' : 'explosion', f.x, f.z, 0.8);
          this._sfx(sea ? 'splash' : 'explosion', f.x, f.z, 0.5);
          this.game.events.emit('fleet:lost', { vessel: f, vehicle: f, id: f.id, kind: f.kind, kingdom: f.kingdom, cargo: f.cargo, cause: f.lastCause || 'crash', x: f.x, z: f.z });
        }
        continue;
      }
      // aloft in a storm (or a solar storm): make for the nearest field
      if (!f.diverted && f.phase === 'cruise' && this.grounded() && !f.cargo?.strike) this._divert(f);
      const goal = this._airGoal(f);
      if (!goal) {
        // the carrier it flew from is gone: the nearest field of its realm
        if (!this._divert(f)) this._land(f, true);
        continue;
      }
      const d = geoDelta(w, f.x, f.z, goal.x, goal.z);
      const dist = Math.hypot(d.dx, d.dz);
      let want = f.heading,
        speed = def.speed,
        y = f.y;
      switch (f.phase) {
        case 'roll': {
          // the take-off run: faster and faster down the runway, then lift
          // (on a runway it gathers speed along the whole strip, so the run
          // reads; off a carrier's deck the catapult flings it)
          const vr = def.speed * 0.45;
          f.speedNow = Math.min(vr, f.speedNow + vr * step * (f.deck ? 2.2 : 0.5));
          speed = f.speedNow;
          if (f.deck) {
            const v = this.byId.get(f.deck.vessel);
            if (v) f.heading = v.heading;
            f.deck.run += speed * step;
            y = 0.35 * VEHICLE.sea;
            if (f.deck.run > (v?.def.length ?? 1.5) * 0.45) (f.phase = 'climb'), (f.deck = null);
          } else {
            f.rolled = (f.rolled || 0) + speed * step;
            y = ground(f.x, f.z) + (f.wheels ?? 0.05);
            if (f.rolled > (f.rollLen || 2) * 0.8) f.phase = 'climb';
          }
          want = f.heading;
          break;
        }
        case 'rise': {
          // VTOL: straight up, turning toward the goal
          speed = 0;
          want = Math.atan2(d.dz, d.dx);
          const top = ground(f.x, f.z) + alt;
          y = Math.min(top, f.y + step * Math.max(1.2, alt * 0.5));
          if (y >= top - 0.05) f.phase = 'cruise';
          f.speedNow = 0;
          break;
        }
        case 'climb':
        case 'cruise': {
          f.speedNow = Math.min(def.speed, f.speedNow + def.speed * step * 0.6);
          speed = f.speedNow;
          // the gentle curve: a heading drift that fades as the goal nears
          want = Math.atan2(d.dz, d.dx) + f.arc * Math.min(1, dist / 60) * Math.min(1, f.t / 6);
          const top = ground(f.x, f.z) + alt;
          // (a shallow climb out at first, steeper as it gathers speed)
          const climb = Math.min(alt * 0.35, f.speedNow * 0.22);
          y = f.phase === 'climb' ? Math.min(top, f.y + step * climb) : f.y + (top - f.y) * Math.min(1, step * 1.5);
          if (f.phase === 'climb' && y >= top - 0.1) f.phase = 'cruise';
          // a circuit: round its turning point and home to its own runway
          if (f.circuit && dist < Math.max(3, speed * 0.6)) {
            f.to = f.circuit;
            f.circuit = null;
            f._ap = null;
            break;
          }
          // no runway where it is bound (a town hall's green): it comes in on a
          // strip of its own, laid along its way in
          if (!f.circuit && !def.vtol && !goal.rw && goal.vessel == null && !f.cargo?.strike && dist < 40) {
            const ux = d.dx / (dist || 1),
              uz = d.dz / (dist || 1);
            goal.rw = { a: { x: goal.x - ux * 0.9, z: goal.z - uz * 0.9 }, b: { x: goal.x + ux * 0.9, z: goal.z + uz * 0.9 }, len: 1.8 };
          }
          // the approach: VTOL settles over the spot; others line up with the runway
          if (def.vtol) {
            if (dist < Math.max(0.6, speed * 0.4)) f.phase = 'settle';
          } else if (goal.rw && !f.cargo?.strike) {
            const ap = this._approach(goal.rw, f);
            const da = geoDelta(w, f.x, f.z, ap.x, ap.z);
            const dap = Math.hypot(da.dx, da.dz);
            want = Math.atan2(da.dz, da.dx);
            if (dap < Math.max(1.5, speed * 0.5)) {
              f.final = ap;
              f.phase = 'final';
            }
          } else if (goal.vessel != null) {
            // a carrier: in astern of her, down onto the deck
            const bx = goal.x - Math.cos(goal.h) * 6,
              bz = goal.z - Math.sin(goal.h) * 6;
            const da = geoDelta(w, f.x, f.z, bx, bz);
            if (Math.hypot(da.dx, da.dz) < 2.5 || f.astern) {
              f.astern = true;
              want = Math.atan2(d.dz, d.dx);
              y = Math.max(0.35 * VEHICLE.sea, f.y - step * alt * 0.4);
              speed = Math.max(def.speed * 0.4, speed * 0.98);
              if (dist < 0.6) {
                this._land(f);
                continue;
              }
            } else want = Math.atan2(da.dz, da.dx);
          } else if (dist < Math.max(1, speed * step * 2)) {
            // a point: a strike's target or a field without a runway
            if (f.cargo?.strike) {
              this._strike(f);
              continue;
            }
            this._land(f);
            continue;
          }
          break;
        }
        case 'final': {
          // down the glide path to the threshold, then the roll-out
          const rw = goal.rw;
          const T = f.final.t,
            E = f.final.e;
          const dt = geoDelta(w, f.x, f.z, T.x, T.z);
          const dtd = Math.hypot(dt.dx, dt.dz);
          want = Math.atan2(E.z - T.z, E.x - T.x);
          if (dtd > 0.3) want = Math.atan2(dt.dz, dt.dx);
          speed = Math.max(def.speed * 0.4, f.speedNow * (1 - step * 0.3));
          f.speedNow = speed;
          f.wheels = wheelsY(rw);
          const gy = ground(f.x, f.z) + f.wheels;
          y = gy + Math.min(f.y - gy, Math.max(0, dtd) * (alt / Math.max(4, f.final.len)));
          if (dtd < 0.4 || y <= gy + 0.02) {
            f.phase = 'rollout';
            f.heading = Math.atan2(E.z - T.z, E.x - T.x);
            f.rolled = 0;
            f.rollLen = rw.len;
          }
          break;
        }
        case 'rollout': {
          f.speedNow = Math.max(0, f.speedNow - def.speed * step * 0.5);
          speed = f.speedNow;
          want = f.heading;
          y = ground(f.x, f.z) + (f.wheels ?? 0.05);
          f.rolled += speed * step;
          if (speed < 0.05 || f.rolled > f.rollLen * 0.85) {
            f.phase = 'parked';
            f.t = 0;
            f.speedNow = 0;
          }
          break;
        }
        case 'settle': {
          // VTOL: hover down onto the spot (a rescue hangs over it a while)
          speed = Math.min(dist * 2, def.speed * 0.3);
          want = Math.atan2(d.dz, d.dx);
          const gy = ground(goal.x, goal.z) + 0.1;
          if (f.cargo?.rescue && !f.rescued) {
            y = f.y + (gy + 1.6 - f.y) * Math.min(1, step);
            f.hoverT = (f.hoverT || 0) + step;
            if (f.hoverT > 7) this._rescue(f);
          } else {
            y = Math.max(gy, f.y - step * Math.max(1, alt * 0.45));
            if (y <= gy + 0.02 && dist < 0.4) {
              this._land(f);
              continue;
            }
          }
          break;
        }
        case 'parked': {
          speed = 0;
          y = ground(f.x, f.z) + (f.wheels ?? 0.05);
          if (f.t > 2.5) {
            this._land(f);
            continue;
          }
          break;
        }
      }
      // steer and move (the short way round, coming back on at the far edge)
      const turnMax = (def.vtol ? 2.2 : def.jet ? 0.9 : 1.2) * step;
      let dh = want - f.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const dd = Math.max(-turnMax, Math.min(turnMax, dh));
      f.heading += dd;
      f.turnRate = dd / Math.max(1e-4, step);
      f.x += Math.cos(f.heading) * speed * step;
      f.z += Math.sin(f.heading) * speed * step;
      f.vy = (y - f.y) / Math.max(1e-4, step);
      f.y = y;
      if (wrap && (f.x < 0 || f.x >= W)) {
        const s = f.x < 0 ? W : -W;
        f.x += s;
        f.px += s;
      }
      f.z = Math.max(0, Math.min(w.h - 0.01, f.z));
      if (f.t > 600) this._land(f, true); // lost its way: never hangs in the sky
    }
    if (this.air.some((f) => !f.alive)) this.air = this.air.filter((f) => f.alive);
    for (const o of this.orbit) o.a += o.speed * step * (o.tumble > now ? 0.6 : 1);
  },
  // The approach to a runway: the threshold (the end facing the aircraft's
  // way in) and a point well out on the extended centreline.
  _approach(rw, f) {
    if (f._ap && f._ap.rw === rw) return f._ap;
    const d1 = this.dist(f.x, f.z, rw.a.x, rw.a.z),
      d2 = this.dist(f.x, f.z, rw.b.x, rw.b.z);
    const t = d1 < d2 ? rw.a : rw.b,
      e = d1 < d2 ? rw.b : rw.a;
    const L = rw.len || 2;
    const ux = (e.x - t.x) / L,
      uz = (e.z - t.z) / L;
    const out = Math.max(8, (f.def.alt || 5) * 2.4); // (a glide of about 1 in 2.4)
    f._ap = { rw, t, e, len: out, x: t.x - ux * out, z: t.z - uz * out };
    return f._ap;
  },
  // Grounded in the air: the nearest field of its realm (or home).
  _divert(f) {
    let best = null,
      bd = Infinity;
    for (const b of this._fields(f.kingdom)) {
      const d = this.dist(f.x, f.z, b.x, b.z);
      if (d < bd) (bd = d), (best = b);
    }
    f.diverted = true;
    if (best) {
      f.to = { x: best.x, z: best.z, building: best.id, rw: this._runway(best) };
      f._ap = null;
      return true;
    }
    if (f.from?.building != null && !f.def.vtol) {
      f.to = f.from;
      f._ap = null;
      return true;
    }
    return false;
  },
  // A sortie's pass over its target (Civ applies it on 'fleet:landed'), then home.
  _strike(f) {
    this.game.events.emit('fleet:landed', { flight: f, kind: f.kind, kingdom: f.kingdom, from: f.from.building, to: null, cargo: f.cargo, x: f.x, z: f.z, early: false });
    this._fx('sparks', f.x, f.z, 0.6, { y: Math.max(0, this.world.heightAt(f.x, f.z)) + 0.3 });
    f.cargo = null;
    const home = f.home || f.from;
    f.home = null;
    f.to = home.vessel != null ? { vessel: home.vessel } : { ...home };
    f._ap = null;
    f.arc *= -1;
  },
  // A rescue helicopter has hung over the disaster: the hurt are lifted out
  // (healed) and it flies them home.
  _rescue(f) {
    f.rescued = true;
    const U = this.game.units;
    const hurt = U?.query?.(f.to.x, f.to.z, 5, (u) => u.alive && u.species === 'human' && (u.statuses?.has('wounded') || u.hp < u.maxHp * 0.6)) || [];
    for (const u of hurt.slice(0, 4)) {
      U.heal?.(u, u.maxHp);
      u.statuses?.delete('wounded');
    }
    this.game.events.emit('fleet:rescue', { flight: f, kingdom: f.kingdom, x: f.to.x, z: f.to.z, saved: Math.min(4, hurt.length) });
    const home = f.home || f.from;
    f.home = null;
    f.cargo = { rescued: Math.min(4, hurt.length) };
    f.to = { ...home };
    f.phase = 'cruise';
  },
  // An aircraft struck from the sky (a god's lightning, a meteor, a whirlwind).
  _crash(f, cause) {
    if (f.phase === 'crash' || !f.alive) return;
    f.phase = 'crash';
    f.lastCause = cause;
    f.vy = Math.min(0, f.vy || 0);
    f.speedNow = f.speedNow || f.def.speed * 0.5;
    const n = this.kname(f.kingdom);
    this.note(`💥 ${f.def.name === 'Delivery drone' ? 'A delivery drone' : 'An aircraft'} of ${n} is struck from the sky`, 'disaster', { x: f.x, z: f.z }, 'aircrash' + f.kingdom, 60);
  },
  _land(f, early = false) {
    if (!f.alive) return;
    f.alive = false;
    this.version++;
    // a sortie or rescue that has done its work comes home with nothing to deliver
    this.game.events.emit('fleet:landed', { flight: f, kind: f.kind, kingdom: f.kingdom, from: f.from?.building ?? null, to: f.to?.building ?? null, cargo: f.cargo, x: f.x, z: f.z, early: early || !!f.diverted });
  },

  // ------------------------------------------------------------------ rockets
  // A rocket rises from its pad on a bright plume, leans downrange, drops its
  // booster and climbs out of sight; with Orbital Industry the booster flies
  // back and lands on its pad. A colony starship is the same, on a far
  // greater scale. Refused in a storm or a solar storm.
  requestLaunch(o = {}) {
    const refuse = (why) => {
      this.lastRefusal = why;
      return null;
    };
    const payload = o.payload || 'satellite';
    if (!AIR_KINDS[payload] || AIR_KINDS[payload].cls !== 'space') return refuse('no such payload');
    const K = this.kingdom(o.kingdom);
    if (!K || K.alive === false) return refuse('no such realm');
    if (this.storm() > 0.7) return refuse('the launch waits for the storm to pass');
    if (this.solarStormLevel() > 0.2) return refuse('the launch waits for the solar storm to pass');
    let from = this._airPoint(o.from);
    if (!from) return refuse('no launch pad');
    const kind = payload === 'starship' ? 'starship' : 'rocket';
    if (this.air.some((f) => f.alive && f.cls === 'space' && f.stageV !== 2 && f.from?.building === from.building && f.t < COUNT + 4)) return refuse('the pad is busy');
    // on a launch pad the rocket stands on the launch mount (the model's
    // mount sits 0.15 design units along its local x, its plate 0.46 up)
    const pb = this.game.civ?._bById?.get(from.building);
    let base = 0.14;
    if (pb && pb.type === 'launchpad') {
      const r = pb.rotation || 0;
      from = { ...from, x: pb.x + Math.cos(r) * 0.15 * BUILDING.scale, z: pb.z - Math.sin(r) * 0.15 * BUILDING.scale };
      base = 0.48;
    }
    const def = AIR_KINDS[kind];
    const f = this._airRecord(kind, def, o.kingdom, from, { x: from.x, z: from.z, building: from.building }, { payload });
    f.dur = kind === 'starship' ? 26 : 20; // the climb to orbit
    f.stageAt = kind === 'starship' ? 13 : 9;
    f.payload = payload;
    f.phase = 'count';
    f.heading = this.rng() * Math.PI * 2; // downrange
    f.reuse = this.hasTech(o.kingdom, 'orbital');
    f.y = f.py = Math.max(0, this.world.heightAt(from.x, from.z)) + base * BUILDING.scale;
    f.gy = f.y;
    this.first(o.kingdom, 'rocket', { x: from.x, z: from.z });
    if (kind === 'starship') this.note(`🚀 ${this.kname(o.kingdom)[0].toUpperCase() + this.kname(o.kingdom).slice(1)} counts down to a starship launch`, 'good', { x: from.x, z: from.z }, 'starcount' + o.kingdom, 60);
    this.game.events.emit('fleet:launched', { vessel: f, kind, model: kind, kingdom: o.kingdom });
    return f;
  },
  _rocketTick(f, step) {
    const T = f.t;
    if (f.stageV === 2) return this._boosterTick(f, step);
    if (f.phase === 'count') {
      // the count: the rocket stands at the pad a while, vapour, then ignition
      f.thrust = T > COUNT - 0.6 ? Math.min(1, (T - COUNT + 0.6) * 2) : 0;
      if (T > COUNT) {
        f.phase = 'launch';
        f.t0 = T;
        this._sfx('explosion', f.x, f.z, 0.5);
      }
      return;
    }
    const u = T - (f.t0 || COUNT);
    const big = f.kind === 'starship' ? 1.25 : 1;
    f.thrust = 1;
    f.phase = u < 3 ? 'launch' : 'climb';
    const prevY = f.y;
    f.y = f.gy + 0.3 * Math.pow(u, 2.2) * big;
    // the gravity turn: lean over downrange, ever further
    f.tilt = Math.min(0.75, Math.max(0, (u - 2.5) * 0.06));
    const run = 0.035 * Math.pow(Math.max(0, u - 2), 2.5) * big;
    f.x = f.from.x + Math.cos(f.heading) * run;
    f.z = Math.max(0, Math.min(this.world.h - 0.01, f.from.z + Math.sin(f.heading) * run));
    f.vy = (f.y - prevY) / Math.max(1e-4, step);
    // staging: the booster falls away (or flies home) and the upper stage goes on
    if (f.stageV === 0 && u >= f.stageAt) {
      f.stageV = 1;
      this._booster(f);
    }
    if (u >= f.dur) this._reachOrbit(f);
  },
  _booster(f) {
    const b = this._airRecord(f.kind, f.def, f.kingdom, { x: f.x, z: f.z, building: null }, { x: f.from.x, z: f.from.z, building: f.from.building }, null);
    b.cls = 'space';
    b.stageV = 2;
    b.y = b.py = f.y - 0.3;
    b.sx = f.x;
    b.sz = f.z;
    b.sy = b.y;
    b.heading = f.heading;
    b.tilt = f.tilt;
    b.phase = f.reuse ? 'boostback' : 'fall';
    b.name = `${f.kind === 'starship' ? 'Starship booster' : 'Booster'} of ${this.kname(f.kingdom)}`;
    b.dur = f.reuse ? 11 : 8;
    b.gy = f.gy;
    b.t = 0;
  },
  // A booster: flies back and lands upright on its pad, or tumbles away.
  _boosterTick(f, step) {
    const u = Math.min(1, f.t / f.dur);
    if (f.phase === 'fall') {
      f.thrust = 0;
      f.tilt += step * 0.9;
      f.y -= step * (2 + f.t * 3);
      f.x += Math.cos(f.heading) * step * 2;
      if (f.t > f.dur || f.y < f.gy + 3) {
        f.alive = false;
        this.version++;
      }
      return;
    }
    if (f.phase === 'landed') {
      f.thrust = 0;
      if (f.t > 4) {
        f.alive = false;
        this.version++;
      }
      return;
    }
    // boost back, coast, the landing burn
    const e = u * u * (3 - 2 * u);
    f.x = f.sx + (f.to.x - f.sx) * e;
    f.z = f.sz + (f.to.z - f.sz) * e;
    f.y = f.gy + (f.sy - f.gy) * Math.pow(1 - u, 1.6);
    f.tilt = Math.max(0, f.tilt - step * 0.4);
    f.thrust = u < 0.12 ? 1 : u > 0.78 ? 0.6 + 0.4 * Math.sin(f.t * 30) * 0 : 0;
    if (u >= 1) {
      f.y = f.gy;
      f.phase = 'landed';
      f.t = 0;
      f.thrust = 0;
      this._fx('dust', f.x, f.z, 1.2);
    }
  },
  _reachOrbit(f) {
    f.alive = false;
    this.version++;
    const p = f.payload;
    if (p === 'satellite' || p === 'station') {
      this.orbit.push({ id: f.id, kind: p, kingdom: f.kingdom, a: this.rng() * Math.PI * 2, r: 0.35 + this.rng() * 0.25, speed: (p === 'station' ? 0.02 : 0.035) * (0.8 + this.rng() * 0.4), tilt: this.rng() * Math.PI });
      if (this.orbit.length > 80) this.orbit.shift();
    }
    this.game.events.emit('fleet:orbit', { kingdom: f.kingdom, payload: p, x: f.from.x, z: f.from.z });
  },

  // ------------------------------------------------------------------ carriers
  // A carrier at war sends her jets against the enemy's ships and armies
  // near her, and takes them back aboard.
  _carrierOps(dt) {
    for (const v of this.list) {
      if (!v.alive || !v.def.carrier || v.state === 'sinking' || v.state === 'moored') continue;
      if ((v.airT = (v.airT || 0) - dt) > 0) continue;
      v.airT = 14 + this.rng() * 10;
      if (this.grounded() || !this.canUse(v.kingdom, 'jet')) continue;
      if (this.air.filter((f) => f.alive && f.from?.vessel === v.id).length >= 2) continue;
      let tgt = v.target != null ? this.byId.get(v.target) : null;
      if (!tgt) {
        const civ = this.game.civ;
        const foes = civ?.enemiesOf?.(v.kingdom) || [];
        let bd = 60;
        for (const o of this.list) {
          if (!o.alive || o.cls !== 'sea' || !foes.includes(o.kingdom) || o.state === 'sinking') continue;
          const d = this.dist(o.x, o.z, v.x, v.z);
          if (d < bd) (bd = d), (tgt = o);
        }
      }
      if (!tgt) continue;
      const f = this.requestFlight({ kind: 'jet', kingdom: v.kingdom, from: { vessel: v.id }, to: { x: tgt.x, z: tgt.z }, cargo: { strike: true, ship: tgt.id } });
      if (f) f.home = { vessel: v.id };
    }
  },
  // the inspector: an aircraft or rocket near the pointer
  inspectAir(hit) {
    let best = null,
      bd = 1.6;
    for (const f of this.air) {
      if (!f.alive) continue;
      const d = Math.hypot(f.x - hit.x, f.z - hit.z);
      if (d < bd) (bd = d), (best = f);
    }
    if (!best) return null;
    const k = this.kingdom(best.kingdom);
    const civ = this.game.civ;
    const nameAt = (p) => (p?.vessel != null ? 'a carrier at sea' : p?.building != null ? civ?.villages?.[civ._bById?.get(p.building)?.village]?.name : null) || 'the open country';
    const phase = { roll: 'Taking off', rise: 'Lifting off', climb: 'Climbing away', cruise: 'Cruising', final: 'On final approach', rollout: 'Landing', settle: 'Coming down', parked: 'On the ground' }[best.phase] || 'Flying';
    const doing = best.cls === 'space' ? (best.stageV === 2 ? (best.phase === 'fall' ? 'Falling away, spent' : best.phase === 'landed' ? 'Landed on its pad' : 'Flying back to land') : best.phase === 'count' ? 'Counting down' : best.payload === 'starship' ? 'Leaving for the stars' : `Carrying a ${best.payload} to orbit`) : best.cargo?.strike ? 'Flying a sortie' : best.cargo?.rescue ? (best.rescued ? 'Flying the rescued home' : 'Flying to a disaster') : best.diverted ? 'Diverting to land' : phase;
    return {
      priority: 28,
      kind: 'vehicle',
      building: best,
      vessel: best,
      title: best.name,
      subtitle: `${k ? k.name : 'No realm'}${best.cls === 'air' ? ' · ' + nameAt(best.from) + ' → ' + nameAt(best.to) : ''}`,
      stats: [
        ['Doing', doing],
        ['Altitude', `${Math.max(0, Math.round((best.y - Math.max(0, this.world.heightAt(best.x, best.z))) * 10))} paces`],
        best.cls === 'space' ? ['Climb', `${Math.round(Math.abs(best.vy || 0) * 10)} paces up`] : ['Speed', `${Math.round((best.speedNow || 0) * 10)} knots`],
        ['Health', `${Math.ceil(best.hp)} / ${best.maxHp}`],
      ],
      x: best.x,
      z: best.z,
    };
  },
};

// Runway strips of the airfield and airport models (src/render/buildings/
// modernArch.js), in the models' design units along their local x.
// The runways of the models (src/render/buildings/modernModels.js), in
// design units along their local x: the two ends, the centre line's z and the
// height of the surface above the plot (the airport's runway stands on its
// raised apron; the airfield's strip lies under the levelled site's platform).
const RUNWAYS = {
  airfield: { x0: -1.35, x1: 1.65, z: 0.42, y: 0.07 },
  airport: { x0: -2.1, x1: 2.1, z: -0.98, y: 0.11 },
};
// An aircraft on its wheels: the belly above the surface it rolls on.
const BELLY = 0.13 * VEHICLE.air;
// how far up an aircraft rides on the ground: on a runway's surface, or
// a little above the land on a strip of its own
function wheelsY(rw) {
  return rw && rw.y != null ? rw.y + BELLY : 0.05;
}

function reversePts(p) {
  const out = new Array(p.length);
  for (let i = 0; i < p.length; i += 2) {
    out[p.length - 2 - i] = p[i];
    out[p.length - 1 - i] = p[i + 1];
  }
  return out;
}

export { YEAR as AIR_YEAR };
