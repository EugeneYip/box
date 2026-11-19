import { USE } from '../civ/util.js';

// Street traffic (docs/MODERN-ERAS.md: "civilian traffic in towns"), mixed
// into Fleet. Towns of a Modern realm (era 5+, Combustion Engine) fill their
// streets with cars: cheap records in `fleet.traffic`, not inspectable
// vehicles. A car drives from street tile to street tile with no
// pathfinding: at each tile it picks the way on (straight ahead more often
// than a turn, never back the way it came unless the street ends, keeping
// inside its town and off the railway where it can). FleetRenderer draws them
// in the fleet's batch on the right-hand side of the street. Budgets: a
// share per town by its size and era, and a cap for the whole world
// (budget.traffic).
//
// PUBLIC CONTRACT (additions to game.fleet)
//   traffic: [{x, z, px, pz, h, ph, vid (village id), kingdom, v (body colour
//             0..3), s (speed, tiles a second)}]
//   trafficCount(kid?) -> cars in the streets
//   totals.cars        cars that have joined the traffic

const SPEED = 1.45; // tiles per second in town
const TURN = 7; // radians per second

export const traffic = {
  trafficCount(kid = null) {
    if (kid == null) return this.traffic.length;
    let n = 0;
    for (const c of this.traffic) if (c.kingdom === kid) n++;
    return n;
  },
  // How many cars a town's streets hold: none before the Modern era, then
  // more for bigger towns, more again in the Atomic and Future eras.
  _trafficWant(k, v) {
    if ((k.era || 0) < 5 || !k.techs?.has?.('combustion')) return 0;
    const roads = v.roadTiles?.length || 0;
    if (roads < 6 || (v.pop || 0) < 8) return 0;
    const tier = v.tier || 0;
    const era = (k.era || 0) >= 6 ? 1.35 : 1;
    return Math.min(20, Math.floor((3 + tier * 4 + roads / 12) * era), Math.floor((v.pop || 0) / 3), Math.floor(roads / 3));
  },
  // Every couple of seconds: cars join the streets of towns short of their
  // share and leave towns over it (or gone, or fallen out of the era).
  _trafficPlan() {
    const civ = this.game.civ;
    if (!civ || this.law('fleetLand', true) === false) {
      this.traffic.length = 0;
      return;
    }
    const have = this._trafficHave || (this._trafficHave = new Map());
    have.clear();
    for (const c of this.traffic) have.set(c.vid, (have.get(c.vid) || 0) + 1);
    const want = new Map();
    let room = this.budget.traffic - this.traffic.length;
    for (const k of civ.kingdoms) {
      if (!k || k.alive === false || (k.era || 0) < 5 || !k.villages?.length) continue;
      for (const vid of k.villages) {
        const v = civ.villages[vid];
        if (!v?.alive) continue;
        const n = this._trafficWant(k, v);
        if (n > 0) want.set(vid, n);
        // a few at a time, so the streets fill over a minute or so
        let add = Math.min(2, n - (have.get(vid) || 0));
        while (add-- > 0 && room > 0) if (this._trafficSpawn(k, v)) room--;
      }
    }
    // cars of towns over their share (or gone) leave the streets
    let drop = false;
    for (const c of this.traffic) {
      const n = want.get(c.vid) || 0;
      const h = have.get(c.vid) || 0;
      if (h > n) {
        c.gone = true;
        have.set(c.vid, h - 1);
        drop = true;
      }
    }
    if (drop) this.traffic = this.traffic.filter((c) => !c.gone);
  },
  _trafficSpawn(k, v) {
    const w = this.world;
    const use = this.game.civ.use;
    const R = v.roadTiles;
    for (let tries = 0; tries < 4; tries++) {
      const i = R[(this.rng() * R.length) | 0];
      if (use[i] !== USE.ROAD) continue;
      const x = i % w.w,
        z = (i / w.w) | 0;
      const c = { x: x + 0.5, z: z + 0.5, px: 0, pz: 0, h: 0, ph: 0, tx: 0, tz: 0, fx: -1, fz: -1, vid: v.id, kingdom: k.id, v: (this.rng() * 4) | 0, s: SPEED * (0.92 + this.rng() * 0.16), r2: ((v.radius || 6) * 1.25 + 2) ** 2, cx: v.cx, cz: v.cz };
      if (!this._trafficNext(c, x, z)) continue;
      c.h = c.ph = Math.atan2(c.tz - c.z, c.tx - c.x);
      c.px = c.x;
      c.pz = c.z;
      this.traffic.push(c);
      this.totals.cars = (this.totals.cars || 0) + 1;
      this.first(k.id, 'car', { x: c.x, z: c.z });
      return true;
    }
    return false;
  },
  // The next street tile on from tile (x, z): sets the car's target, or
  // false when it has nowhere to go.
  _trafficNext(c, x, z) {
    const w = this.world;
    const use = this.game.civ.use;
    const rail = this.game.civ.railMask;
    let best = -1,
      sum = 0,
      back = -1;
    const fx = c.fx,
      fz = c.fz;
    // straight on is the way the car came in (from fx, fz to x, z)
    const sx = fx < 0 ? 0 : x - fx,
      sz = fx < 0 ? 0 : z - fz;
    for (let d = 0; d < 4; d++) {
      const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0),
        nz = z + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (nx < 0 || nz < 0 || nx >= w.w || nz >= w.h) continue;
      const i = nz * w.w + nx;
      if (use[i] !== USE.ROAD) continue;
      if (nx === fx && nz === fz) {
        back = i;
        continue;
      }
      const ox = nx + 0.5 - c.cx,
        oz = nz + 0.5 - c.cz;
      let wt = ox * ox + oz * oz > c.r2 ? 0.08 : 1;
      if (nx - x === sx && nz - z === sz) wt *= 3;
      if (rail?.[i]) wt *= 0.15;
      sum += wt;
      if (this.rng() * sum < wt) best = i;
    }
    if (best < 0) best = back;
    if (best < 0) return false;
    c.fx = x;
    c.fz = z;
    c.tx = (best % w.w) + 0.5;
    c.tz = ((best / w.w) | 0) + 0.5;
    return true;
  },
  _trafficTick(step) {
    const T = this.traffic;
    const use = this.game.civ?.use;
    if (!use) return;
    const w = this.world;
    let drop = false;
    for (let i = 0; i < T.length; i++) {
      const c = T[i];
      c.px = c.x;
      c.pz = c.z;
      c.ph = c.h;
      let mv = c.s * step;
      for (let guard = 0; guard < 3 && mv > 0; guard++) {
        const dx = c.tx - c.x,
          dz = c.tz - c.z;
        const d = Math.hypot(dx, dz);
        if (d > mv) {
          c.x += (dx / d) * mv;
          c.z += (dz / d) * mv;
          mv = 0;
          break;
        }
        c.x = c.tx;
        c.z = c.tz;
        mv -= d;
        const tx = Math.floor(c.tx),
          tz = Math.floor(c.tz);
        // the street was built over: the car leaves
        if (use[tz * w.w + tx] !== USE.ROAD || !this._trafficNext(c, tx, tz)) {
          c.gone = true;
          drop = true;
          break;
        }
      }
      // turn smoothly toward the way ahead
      let dh = Math.atan2(c.tz - c.z, c.tx - c.x) - c.h;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const mx = TURN * step;
      c.h += dh > mx ? mx : dh < -mx ? -mx : dh;
    }
    if (drop) this.traffic = T.filter((c) => !c.gone);
  },
};
