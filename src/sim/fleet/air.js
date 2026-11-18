import { STUB_KINDS, stubDef } from './kinds.js';
import { civPath } from '../civ/pathing.js';
import { USE } from '../civ/util.js';

const YEAR = 30;

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
    return null;
  },
  siegeModel(kid, kind) {
    if (kind === 'ram') return this.hasTech(kid, 'battleships') ? 'tank' : null;
    if (kind === 'catapult') return this.hasTech(kid, 'battleships') ? 'artillery' : this.hasTech(kid, 'gunpowder') ? 'cannon' : null;
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
    if (!L.length) return null;
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
    const fwd = o.reverse ? reversePts(line.pts) : line.pts.slice();
    const from = o.reverse ? b : a,
      to = o.reverse ? a : b;
    const model = line.kind === 'maglev' ? 'maglev' : 'train';
    const v = this.spawn('oxcart', kid, fwd[0], fwd[1], { home: from.id, state: 'move', heading: Math.atan2(fwd[3] - fwd[1], fwd[2] - fwd[0]), model });
    if (!v) return null;
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
    this.setPath(v, fwd);
    this.totals.trains = (this.totals.trains || 0) + 1;
    return v;
  },
  _trainArrive(v, m, to) {
    const civ = this.game.civ;
    if (to?.alive && v.cargo) for (const [r, n] of Object.entries(v.cargo)) to[r] = (to[r] || 0) + n;
    this.game.events.emit('fleet:delivered', { vehicle: v, kind: v.kind, model: v.model, kingdom: v.kingdom, from: m.from, to: m.to, cargo: v.cargo });
    v.cargo = null;
    m.phase = 'home';
    const line = civ.railLine?.(m.rail);
    if (!line?.pts) return this.remove(v);
    this.setPath(v, line.a === m.from ? reversePts(line.pts) : line.pts.slice());
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
  airCount(kid = null, kind = null) {
    let n = 0;
    for (const f of this.air) if (f.alive && (kid == null || f.kingdom === kid) && (kind == null || f.kind === kind)) n++;
    return n;
  },
  _airPoint(ref) {
    if (ref == null) return null;
    if (typeof ref === 'object' && ref.x != null) return { x: ref.x, z: ref.z, building: ref.building ?? null };
    const b = this.game.civ?._bById?.get(ref);
    return b && b.alive ? { x: b.x, z: b.z, building: b.id } : null;
  },
  requestFlight(o = {}) {
    const refuse = (why) => {
      this.lastRefusal = why;
      return null;
    };
    const s = STUB_KINDS[o.kind];
    if (!s || s.cls !== 'air') return refuse('no such aircraft');
    const K = this.kingdom(o.kingdom);
    if (!K || K.alive === false) return refuse('no such realm');
    if (this.storm() > 0.5) return refuse('aircraft are grounded by the storm');
    if (this.air.length >= this.budget.air) return refuse('the skies are crowded');
    const from = this._airPoint(o.from),
      to = this._airPoint(o.to);
    if (!from || !to) return refuse('no airfield');
    const def = stubDef(o.kind);
    const d = Math.hypot(to.x - from.x, to.z - from.z);
    if (d < 1) return refuse('nowhere to fly');
    const f = this._airRecord(o.kind, def, o.kingdom, from, to, o.cargo);
    f.dur = d / def.speed + 4; // climb and descent
    f.arc = Math.min(0.12, 6 / Math.max(10, d)) * (this.rng() < 0.5 ? -1 : 1); // a gentle curve
    this.first(o.kingdom, o.kind, { x: from.x, z: from.z });
    this.game.events.emit('fleet:launched', { vessel: f, kind: o.kind, model: o.kind, kingdom: o.kingdom });
    return f;
  },
  requestLaunch(o = {}) {
    const refuse = (why) => {
      this.lastRefusal = why;
      return null;
    };
    const payload = o.payload || 'satellite';
    if (!STUB_KINDS[payload] || STUB_KINDS[payload].cls !== 'space') return refuse('no such payload');
    const K = this.kingdom(o.kingdom);
    if (!K || K.alive === false) return refuse('no such realm');
    if (this.storm() > 0.7) return refuse('the launch waits for the storm to pass');
    const from = this._airPoint(o.from);
    if (!from) return refuse('no launch pad');
    const kind = payload === 'starship' ? 'starship' : 'rocket';
    const def = stubDef(kind);
    const f = this._airRecord(kind, def, o.kingdom, from, { x: from.x, z: from.z, building: null }, { payload });
    f.dur = 14; // the climb to orbit
    f.payload = payload;
    this.first(o.kingdom, 'rocket', { x: from.x, z: from.z });
    this.game.events.emit('fleet:launched', { vessel: f, kind, model: kind, kingdom: o.kingdom });
    return f;
  },
  _airRecord(kind, def, kid, from, to, cargo) {
    const g = this.game;
    const gy = this.world.heightAt(from.x, from.z);
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
      y: gy,
      px: from.x,
      pz: from.z,
      py: gy,
      heading: Math.atan2(to.z - from.z, to.x - from.x),
      hp: def.hp || 50,
      maxHp: def.hp || 50,
      alive: true,
      phase: 'climb',
      t: 0,
      dur: 10,
      arc: 0,
      from,
      to,
      cargo: cargo || null,
      born: g.time.total,
      seed: this.rng(),
    };
    this.air.push(f);
    this.version++;
    return f;
  },
  _airTick(step) {
    const w = this.world;
    for (const f of this.air) {
      if (!f.alive) continue;
      f.px = f.x;
      f.pz = f.z;
      f.py = f.y;
      f.t += step;
      const u = Math.min(1, f.t / f.dur);
      if (f.cls === 'space') {
        // straight up on a plume, leaning a little downrange
        const gy = w.heightAt(f.from.x, f.from.z);
        f.phase = u < 0.15 ? 'launch' : 'climb';
        f.y = gy + Math.pow(u, 1.6) * 160;
        f.x = f.from.x + u * u * 6;
        if (u >= 1) this._reachOrbit(f);
        continue;
      }
      // a straight (gently curved) route: climb, cruise, descend
      const dx = f.to.x - f.from.x,
        dz = f.to.z - f.from.z;
      const bow = Math.sin(u * Math.PI) * f.arc;
      f.x = f.from.x + dx * u - dz * bow;
      f.z = f.from.z + dz * u + dx * bow;
      const ground = w.heightAt(f.x, f.z);
      const alt = f.def.alt || 5;
      const lift = Math.min(1, u * 6, (1 - u) * 6);
      f.y = Math.max(ground + 0.3, Math.max(0, ground) + alt * lift);
      f.phase = lift < 1 ? (u < 0.5 ? 'climb' : 'land') : 'cruise';
      if (Math.hypot(f.x - f.px, f.z - f.pz) > 1e-4) f.heading = Math.atan2(f.z - f.pz, f.x - f.px);
      // storms ground aircraft: those aloft make for the nearest field (they land early)
      if (u >= 1 || (this._stormNow > 0.8 && f.phase === 'cruise' && this.rng() < step * 0.2)) this._land(f);
    }
    if (this.air.some((f) => !f.alive)) this.air = this.air.filter((f) => f.alive);
    for (const o of this.orbit) o.a += o.speed * step;
  },
  _land(f) {
    f.alive = false;
    this.version++;
    this.game.events.emit('fleet:landed', { flight: f, kind: f.kind, kingdom: f.kingdom, from: f.from.building, to: f.to.building, cargo: f.cargo, x: f.x, z: f.z, early: f.t < f.dur });
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
  // the inspector: an aircraft near the pointer
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
    const nameAt = (p) => (p?.building != null ? civ?.villages?.[civ._bById?.get(p.building)?.village]?.name : null) || 'the open country';
    const doing = best.cls === 'space' ? (best.payload === 'starship' ? 'Leaving for the stars' : `Carrying a ${best.payload} to orbit`) : best.cargo?.strike ? 'Flying a sortie' : best.phase === 'cruise' ? 'Cruising' : best.phase === 'climb' ? 'Climbing away' : 'Coming in to land';
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
        ['Health', `${Math.ceil(best.hp)} / ${best.maxHp}`],
      ],
      x: best.x,
      z: best.z,
    };
  },
};

function reversePts(p) {
  const out = new Array(p.length);
  for (let i = 0; i < p.length; i += 2) {
    out[p.length - 2 - i] = p[i];
    out[p.length - 1 - i] = p[i + 1];
  }
  return out;
}

export { YEAR as AIR_YEAR };
