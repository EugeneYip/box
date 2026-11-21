import { USE } from '../civ/util.js';

// Street traffic (docs/MODERN-ERAS.md: "civilian traffic in towns"), mixed
// into Fleet. Towns of a Modern realm (era 5+, Combustion Engine) fill their
// streets with cars: cheap records in `fleet.traffic`, not inspectable
// vehicles. A car drives from street tile to street tile with no
// pathfinding: at each tile it picks the way on (straight ahead more often
// than a turn, never back the way it came unless the street ends, keeping
// inside its town and off the railway where it can). FleetRenderer draws them
// in the fleet's batch on the right-hand side of the street. On a straight
// stretch of street in front of a building a car now and then pulls in and
// stays parked a while along the curb, nose along the street (a car joining
// the traffic may start out parked there). Budgets: a
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
const LOOK = 0.28; // the way on is chosen this far before a tile's middle
const GAP0 = 0.34; // a car stops this close behind the car ahead (tiles)...
const GAP1 = 0.62; // ...and drives at full speed from this far

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
      const c = { x: x + 0.5, z: z + 0.5, px: 0, pz: 0, h: 0, ph: 0, tx: 0, tz: 0, fx: -1, fz: -1, vid: v.id, kingdom: k.id, v: (this.rng() * 4) | 0, s: SPEED * (0.92 + this.rng() * 0.16), r2: ((v.radius || 6) * 1.25 + 2) ** 2, cx: v.cx, cz: v.cz, k: (this.rng() * 4) | 0, acc: 0 };
      if (!this._trafficNext(c, x, z)) continue;
      c.h = c.ph = Math.atan2(c.tz - c.z, c.tx - c.x);
      c.px = c.x;
      c.pz = c.z;
      c.park = 0;
      if (this.rng() < 0.4 && this._trafficKerb(x, z, c)) c.park = 4 + this.rng() * 30;
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
  // A straight stretch of street (the way on and the way back both street,
  // the street not crossing here) with a building beside it: a place to park.
  _trafficKerb(x, z, c) {
    const w = this.world;
    const use = this.game.civ.use;
    if (x < 1 || z < 1 || x >= w.w - 1 || z >= w.h - 1) return false;
    const r = (dx, dz) => use[(z + dz) * w.w + x + dx] === USE.ROAD;
    const ew = r(1, 0) && r(-1, 0),
      ns = r(0, 1) && r(0, -1);
    if (ew === ns) return false;
    // never on a town's square or a barracks' parade pad
    if (this._onSquare(x + 0.5, z + 0.5)) return false;
    // heading along the street (the way the car is going, else east / south)
    const along = ew ? Math.abs(Math.cos(c.h)) > 0.7 : Math.abs(Math.sin(c.h)) > 0.7;
    if (!along) return false;
    const B = USE.BUILDING;
    return ew ? use[(z + 1) * w.w + x] === B || use[(z - 1) * w.w + x] === B : use[z * w.w + x + 1] === B || use[z * w.w + x - 1] === B;
  },
  _trafficTick(step) {
    const T = this.traffic;
    const use = this.game.civ?.use;
    if (!use) return;
    const w = this.world;
    let drop = false;
    // A car parked at the curb, or out of the drawn radius (FleetRenderer
    // draws the street cars within the camera's distance x 1.7 + 24, at most
    // 80 tiles, and none in the overview), drives on every fourth tick with
    // the time it missed: nothing that can be seen changes.
    const g = this.game;
    const cam = g.cameraRig?.cur;
    const R = !cam || g.view?.far || cam.dist > 175 ? -1 : Math.min(cam.dist * 1.7 + 24, 80) + 4;
    const lod = !this._noLod;
    const gwt = this._gwTick || 0;
    // the cars in sight, by tile (for keeping a gap to the car ahead)
    const cell = this._tCell || (this._tCell = new Map());
    cell.clear();
    if (R > 0)
      for (let i = 0; i < T.length; i++) {
        const c = T[i];
        c._tn = null;
        if (Math.abs(c.x - cam.x) > R || Math.abs(c.z - cam.z) > R) continue;
        const ti = Math.floor(c.z) * w.w + Math.floor(c.x);
        c._tn = cell.get(ti) || null;
        cell.set(ti, c);
      }
    for (let i = 0; i < T.length; i++) {
      const c = T[i];
      c.px = c.x;
      c.pz = c.z;
      c.ph = c.h;
      let st = step;
      if (lod && (c.park > 0 || R < 0 || Math.abs(c.x - cam.x) > R || Math.abs(c.z - cam.z) > R)) {
        c.acc = (c.acc || 0) + step;
        if (((gwt + (c.k | 0)) & 3) !== 0) continue;
        st = c.acc;
      }
      c.acc = 0;
      // parked at the curb: waits, then drives on (or leaves if the street went)
      if (c.park > 0) {
        c.park -= st;
        if (use[Math.floor(c.z) * w.w + Math.floor(c.x)] !== USE.ROAD) {
          c.gone = true;
          drop = true;
        }
        continue;
      }
      // (round 23) a car drives where its nose points, steering toward the
      // tile ahead, and picks its way on a little before the tile's middle,
      // so it rounds corners on an arc instead of sliding sideways round a
      // right angle (and a dead end is a tight loop, not a spin on the spot);
      // it slows behind a car ahead in its lane instead of driving through it
      const gv = st === step && R > 0 ? this._trafficGap(c, cell, st) : 1;
      const v = Math.max(1e-3, c.s * gv);
      let rest = v * st;
      for (let guard = 0; guard < 16 && rest > 1e-4; guard++) {
        let dx = c.tx - c.x,
          dz = c.tz - c.z;
        let d = Math.hypot(dx, dz);
        if (d < LOOK) {
          const tx = Math.floor(c.tx),
            tz = Math.floor(c.tz);
          // the street was built over: the car leaves
          if (use[tz * w.w + tx] !== USE.ROAD || !this._trafficNext(c, tx, tz)) {
            c.gone = true;
            drop = true;
            break;
          }
          // now and then pull in at the curb (only once squared up to the street)
          const a = Math.atan2(c.tz - c.z, c.tx - c.x);
          if (this.rng() < 0.07 && Math.abs(Math.sin(a - c.h)) < 0.12 && Math.cos(a - c.h) > 0 && this._trafficKerb(tx, tz, c)) {
            c.park = 6 + this.rng() * 26;
            // square the car up with the street, on the tile's middle line
            c.h = Math.round(c.h / (Math.PI / 2)) * (Math.PI / 2);
            if (Math.abs(Math.cos(c.h)) > 0.5) c.z = tz + 0.5;
            else c.x = tx + 0.5;
            break;
          }
          dx = c.tx - c.x;
          dz = c.tz - c.z;
          d = Math.hypot(dx, dz);
          if (d < 1e-4) continue;
        }
        let dh = Math.atan2(dz, dx) - c.h;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        // a turn round (the street ends) goes left, across the street
        if (dh > 3.0) dh -= Math.PI * 2;
        // slower through a sharp turn (a tighter arc)
        const slow = Math.cos(dh) > 0.35 ? 1 : 0.55;
        const sub = Math.min(rest, 0.12);
        const mx = (TURN * sub) / v;
        c.h += dh > mx ? mx : dh < -mx ? -mx : dh;
        const ln = Math.min(sub * slow, d);
        c.x += Math.cos(c.h) * ln;
        c.z += Math.sin(c.h) * ln;
        c.wd = (c.wd || 0) + ln;
        rest -= sub;
      }
    }
    if (drop) this.traffic = T.filter((c) => !c.gone);
  },
  // How fast a car may go (0..1 of its speed) for the car ahead of it in its
  // lane (the same tile or the next, heading the same way). A car held up for
  // a few seconds edges on regardless, so a crossing never locks up.
  _trafficGap(c, cell, st) {
    const W = this.world.w;
    const co = Math.cos(c.h),
      si = Math.sin(c.h);
    let near = Infinity;
    for (let k = 0; k < 2; k++) {
      const i = k === 0 ? Math.floor(c.z) * W + Math.floor(c.x) : Math.floor(c.tz) * W + Math.floor(c.tx);
      for (let o = cell.get(i); o; o = o._tn) {
        if (o === c || o.park > 0 || o.gone) continue;
        if (co * Math.cos(o.h) + si * Math.sin(o.h) < 0.5) continue;
        const ox = o.x - c.x,
          oz = o.z - c.z;
        const ahead = ox * co + oz * si;
        if (ahead <= 0.02 || ahead >= near) continue;
        if (Math.abs(ox * si - oz * co) > 0.22) continue;
        near = ahead;
      }
    }
    let want = near === Infinity ? 1 : Math.max(0, Math.min(1, (near - GAP0) / (GAP1 - GAP0)));
    if (want < 0.15) {
      c.hold = (c.hold || 0) + st;
      if (c.hold > 3) want = 0.35;
    } else c.hold = 0;
    c.gv = (c.gv ?? 1) + (want - (c.gv ?? 1)) * Math.min(1, st * 8);
    return c.gv;
  },
};
