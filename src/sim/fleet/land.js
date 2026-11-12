import { TILE, FLORA_INFO } from '../../world/constants.js';
import { civPath } from '../civ/pathing.js';
import { BUILDING_TYPES } from '../civ/catalog.js';
import { USE } from '../civ/util.js';

// Land vehicles (mixed into Fleet): ox carts that pool a realm's goods along
// its roads (The Wheel), trade caravans between realms at peace (Banking),
// and battering rams and catapults that roll with armies (Siegecraft).
const ROAD_NODES = 2500; // across country (the laid roads are searched first, cheaply)

export const land = {
  // ------------------------------------------------------------------ API
  requestCart(o = {}) {
    const civ = this.game.civ;
    const kid = o.kingdom;
    const a = civ?.villages?.[o.from],
      b = civ?.villages?.[o.to];
    if (!a?.alive || !b?.alive || a === b) return null;
    if (this.landCount() >= this.budget.land) return null;
    const path = this._roadPath(a, b);
    if (!path) return null;
    const cargo = {};
    let any = 0;
    for (const [r, amt] of Object.entries(o.cargo || {})) {
      const take = Math.max(0, Math.min(amt, a[r] || 0));
      if (take <= 0) continue;
      a[r] -= take;
      cargo[r] = take;
      any += take;
    }
    const v = this.spawn('oxcart', kid ?? a.kingdom, path[0], path[1], { home: a.id, state: 'move', heading: Math.atan2(path[3] - path[1], path[2] - path[0]) });
    v.cargo = any ? cargo : null;
    v.anim.cargoType = cargo.wood ? 0 : cargo.stone ? 1 : cargo.ore ? 3 : 2;
    v.mission = { type: 'haul', phase: 'out', from: a.id, to: b.id };
    v.voyage = { from: a.id, to: b.id, fromName: a.name, toName: b.name };
    this.setPath(v, path);
    this.totals.hauls++;
    return v;
  },

  requestCaravan(o = {}) {
    const civ = this.game.civ;
    const a = civ?.villages?.[o.from],
      b = civ?.villages?.[o.to];
    if (!a?.alive || !b?.alive || a === b) return null;
    if (this.landCount() >= this.budget.land) return null;
    const path = this._roadPath(a, b, 5000);
    if (!path) return null;
    const kid = o.kingdom ?? a.kingdom;
    const v = this.spawn('caravan', kid, path[0], path[1], { home: a.id, state: 'move', heading: Math.atan2(path[3] - path[1], path[2] - path[0]) });
    v.cargo = { goods: 24 };
    const style = civ.cultureDef?.(a.culture)?.style || '';
    v.anim.cargoType = /dune/.test(style) || /dune/.test(a.culture || '') ? 2 : 0; // camels in the desert realms
    v.trail = [];
    v.mission = { type: 'caravan', phase: 'out', from: a.id, to: b.id, partner: b.kingdom };
    v.voyage = { from: a.id, to: b.id, fromName: a.name, toName: b.name };
    this.setPath(v, path);
    this.totals.caravans++;
    return v;
  },

  // ------------------------------------------------------------------ roads
  _door(v) {
    const h = v.hall;
    if (h && h.alive !== false && h.doorX != null) return [Math.floor(h.doorX), Math.floor(h.doorZ)];
    return [Math.floor(v.cx), Math.floor(v.cz)];
  },
  // Road-loving route between two villages (tile centres), cached a while.
  _roadPath(a, b, maxNodes = ROAD_NODES) {
    const civ = this.game.civ;
    const w = this.world;
    if (!civ._roadCost) return null;
    if (a.landId != null && b.landId != null && a.landId !== b.landId) return null;
    this._rp = this._rp || new Map();
    const key = a.id + '>' + b.id;
    const now = this.game.time.total;
    const c = this._rp.get(key);
    if (c && (c.path ? now - c.t < 120 && (c.fv === civ.fieldVersion || now - c.t < 20) : now - c.t < 240)) return c.path;
    // the way back is the way there, reversed
    const rc = this._rp.get(b.id + '>' + a.id);
    if (rc && rc.path && now - rc.t < 120) return reversePath(rc.path);
    // one long road search per tick at most
    if (this._roadBudget <= 0) return null;
    this._roadBudget--;
    const [sx, sy] = this._door(a),
      [gx, gy] = this._door(b);
    if (!w.inBounds(sx, sy) || !w.inBounds(gx, gy)) return null;
    // first along the laid roads only (cheap: few tiles), then across country
    const use = civ.use;
    const base = civ._roadCost();
    const roadsOnly = use
      ? (i) => {
          if (use[i] === USE.ROAD) return 0.4;
          const x = i % w.w,
            y = (i / w.w) | 0;
          return Math.abs(x - sx) + Math.abs(y - sy) <= 3 || Math.abs(x - gx) + Math.abs(y - gy) <= 3 ? base(i) : Infinity;
        }
      : null;
    let p = roadsOnly ? civPath(w, sx, sy, gx, gy, roadsOnly, 9000, 0.4) : null;
    if (p && p.length) {
      const last = p[p.length - 1];
      if (Math.hypot((last % w.w) - gx, ((last / w.w) | 0) - gy) > 3) p = null;
    }
    if (!p && Math.hypot(gx - sx, gy - sy) < maxNodes / 60) p = civPath(w, sx, sy, gx, gy, base, maxNodes, 0.75);
    let path = null;
    if (p && p.length > 3) {
      const last = p[p.length - 1];
      if (Math.hypot((last % w.w) - gx, ((last / w.w) | 0) - gy) <= 3) {
        path = [sx + 0.5, sy + 0.5];
        for (const i of p) path.push((i % w.w) + 0.5, ((i / w.w) | 0) + 0.5);
        path = chaikin(path);
      }
    }
    this._rp.set(key, { path, t: now, fv: civ.fieldVersion });
    if (this._rp.size > 200) this._rp.delete(this._rp.keys().next().value);
    return path;
  },

  // ------------------------------------------------------------------ scheduler
  _scheduleLand(k) {
    const kid = k.id;
    const civ = this.game.civ;
    const t = this._kt(kid);
    const now = this.game.time.total;
    // ox carts: surplus goes to the capital, or to the realm's neediest town
    if (this.auto.carts && this.hasTech(kid, 'wheel') && k.villages.length >= 2 && now - t.cart > 9) {
      t.cart = now;
      if (this.count(kid, 'oxcart') < this.cap(kid, 'oxcart') && this.landCount() < this.budget.land) this._sendCart(k);
    }
    // caravans to a neighbour at peace
    if (this.auto.caravans && this.hasTech(kid, 'banking') && now - t.caravan > 24) {
      t.caravan = now;
      if (this.count(kid, 'caravan') < this.cap(kid, 'caravan') && this.landCount() < this.budget.land) this._sendCaravan(k);
    }
    void civ;
  },

  // Ox carts even out a realm's stores. Food goes by need: from the town with
  // most to eat per head to the one with least (hungry towns first). Wood,
  // stone and ore go from the fullest store (relative to what a town can keep)
  // to the emptiest, the capital first: late in the game towns spend those on
  // arms and great works and rarely sit above a fixed mark, yet one is always
  // richer than another.
  _sendCart(k) {
    const civ = this.game.civ;
    const vs = k.villages.map((id) => civ.villages[id]).filter((v) => v?.alive);
    if (vs.length < 2) return;
    const cap = civ.villages[k.capital];
    const capOf = (v, r) => (r === 'wood' ? v.woodCap || 120 : r === 'stone' ? v.stoneCap || 100 : 60);
    const fill = (v, r) => (v[r] || 0) / Math.max(1, capOf(v, r));
    const perHead = (v) => (v.food || 0) / Math.max(4, v.pop || 0);
    let best = null,
      bs = 0;
    for (const from of vs) {
      for (const to of vs) {
        if (to === from || to.landId !== from.landId) continue;
        const d = Math.hypot(to.cx - from.cx, to.cz - from.cz);
        if (d < 8 || d > 110) continue;
        // food: days of bread per mouth, the hungry and the low first
        const reserve = (from.pop || 0) * 3 + 25;
        if ((from.food || 0) > reserve + 10) {
          const ph = perHead(from),
            pt = perHead(to);
          let need = (ph - pt) / Math.max(1, ph);
          if (to.starving) need += 0.8;
          if ((to.food || 0) < (to.pop || 0) * 2.5 + 6) need += 0.4;
          if ((to.food || 0) > (to.foodCap || 200) * 0.85) need -= 1;
          const sc = need * 1.2 - d * 0.002 + this.rng() * 0.08;
          if (need > 0.3 && sc > bs) {
            bs = sc;
            best = { from, to, r: 'food', amt: Math.min(30, ((from.food || 0) - reserve) * 0.5, Math.max(8, ((from.foodCap || 200) - (to.food || 0)) * 0.5)) };
          }
        }
        for (const r of ['wood', 'stone', 'ore']) {
          if ((from[r] || 0) < 18) continue;
          const gap = fill(from, r) - fill(to, r) + (to === cap ? 0.15 : 0);
          if (gap < 0.22) continue;
          const sc = gap - d * 0.002 + this.rng() * 0.08;
          if (sc > bs) {
            bs = sc;
            best = { from, to, r, amt: Math.min(24, (from[r] || 0) * 0.4, gap * 0.5 * capOf(to, r)) };
          }
        }
      }
    }
    if (!best) return;
    const amt = Math.floor(best.amt);
    if (amt < 4) return;
    this.requestCart({ kingdom: k.id, from: best.from.id, to: best.to.id, cargo: { [best.r]: amt } });
  },

  _sendCaravan(k) {
    const civ = this.game.civ;
    let best = null,
      bd = Infinity;
    for (const o of civ.kingdoms) {
      if (!o.alive || o.id === k.id || this.atWar(o.id, k.id)) continue;
      const r = civ.relations?.get?.(k.id < o.id ? k.id * 4096 + o.id : o.id * 4096 + k.id);
      if (r && !r.ally && (r.opinion ?? 0) < -10) continue;
      for (const va of k.villages) {
        const a = civ.villages[va];
        if (!a?.alive) continue;
        for (const vb of o.villages) {
          const b = civ.villages[vb];
          if (!b?.alive || b.landId !== a.landId) continue;
          const d = Math.hypot(a.cx - b.cx, a.cz - b.cz) - (r?.ally ? 20 : 0);
          if (d < bd && d < 120) {
            bd = d;
            best = { a, b };
          }
        }
      }
    }
    if (best) this.requestCaravan({ kingdom: k.id, from: best.a.id, to: best.b.id });
  },

  // ------------------------------------------------------------------ motion
  _landTick(v, step) {
    const a = v.anim;
    if (v.def.siege) this._siegeMove(v, step);
    else if (v.state === 'move' && v.path) {
      this._follow(v, step, v.def.speed);
      if (v.path == null) this._landArrive(v);
    } else if (v.state === 'rest') {
      if (v.stateT > 3) {
        if (v.mission?.phase === 'home' && v.path) v.state = 'move';
        else this.remove(v);
      }
    }
    if (!v.alive) return;
    a.wheel -= (v.speed * step) / 0.2;
    a.walk += v.speed * step * 5;
    if (v.trail) {
      const L = v.trail;
      const lx = L.length ? L[L.length - 2] : null,
        lz = L.length ? L[L.length - 1] : null;
      if (lx == null || Math.hypot(v.x - lx, v.z - lz) > 0.25) {
        L.push(v.x, v.z);
        if (L.length > 40) L.splice(0, 2);
      }
    }
    // raiders fall on carts and caravans of an enemy realm
    if (!v.def.siege && (v.raidT = (v.raidT || 0) - step) <= 0) {
      v.raidT = 1;
      const U = this.game.units;
      const foe = U?.nearest?.(v.x, v.z, 1.3, (o) => o.alive && o.species === 'human' && o.job === 'soldier' && this.atWar(o.kingdom, v.kingdom));
      if (foe) {
        const civ = this.game.civ;
        const rv = civ?.villages?.[foe.village];
        if (rv?.alive && v.cargo) for (const [r, n] of Object.entries(v.cargo)) if (typeof rv[r] === 'number') rv[r] += n;
        this.lose(v, 'raided', { id: foe.id, kind: 'soldier', kingdom: foe.kingdom });
      }
    }
  },

  // Follow v.path at speed (faster on roads, slower uphill).
  _follow(v, step, speed) {
    const P = v.path;
    const w = this.world;
    let tx = P[v.pi],
      tz = P[v.pi + 1];
    let d = Math.hypot(tx - v.x, tz - v.z);
    while (d < 0.35 && v.pi < P.length - 2) {
      v.pi += 2;
      tx = P[v.pi];
      tz = P[v.pi + 1];
      d = Math.hypot(tx - v.x, tz - v.z);
    }
    if (v.pi >= P.length - 2 && d < 0.3) {
      v.path = null;
      v.speed = 0;
      return true;
    }
    const want = Math.atan2(tz - v.z, tx - v.x);
    let diff = want - v.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    v.heading += Math.max(-v.def.turn * step, Math.min(v.def.turn * step, diff));
    const ti = w.idx(w.clampTx(Math.floor(v.x)), w.clampTy(Math.floor(v.z)));
    const road = w.type[ti] === TILE.ROAD ? 1.35 : 1;
    const slope = Math.min(0.5, w.slopeAt(Math.floor(v.x), Math.floor(v.z)) * 0.35);
    const target = speed * road * (1 - slope) * (Math.abs(diff) > 1.2 ? 0.4 : 1);
    v.speed += (target - v.speed) * Math.min(1, step * 3);
    const s = Math.min(d, v.speed * step);
    v.x += Math.cos(want) * s;
    v.z += Math.sin(want) * s;
    return false;
  },

  _landArrive(v) {
    const civ = this.game.civ;
    const m = v.mission;
    if (!m) return this.remove(v);
    if (m.phase === 'home') {
      if (v.kind === 'caravan') {
        const home = civ.villages[m.from];
        if (home?.alive) home.gold = (home.gold || 0) + 10 * (civ.techMod?.(v.kingdom, 'gold') ?? 1) * 0.67;
      }
      v.state = 'rest';
      v.stateT = 0;
      v.mission = null;
      return;
    }
    const to = civ.villages[m.to];
    if (v.kind === 'oxcart') {
      if (to?.alive && v.cargo) for (const [r, n] of Object.entries(v.cargo)) to[r] = (to[r] || 0) + n;
      this.game.events.emit('fleet:delivered', { vehicle: v, kind: v.kind, kingdom: v.kingdom, from: m.from, to: m.to, cargo: v.cargo });
      v.cargo = null;
      // trundle home empty
      m.phase = 'home';
      const back = civ.villages[m.from];
      const p = back?.alive ? this._roadPath(to, back) : null;
      if (p) {
        this.setPath(v, p);
        v.state = 'rest';
        v.stateT = 0;
      } else this.remove(v);
      return;
    }
    if (v.kind === 'caravan') {
      if (to?.alive) {
        to.gold = (to.gold || 0) + 8;
        const r = civ.rel?.(v.kingdom, to.kingdom);
        if (r && !r.war) r.opinion = Math.min(100, (r.opinion || 0) + 3);
      }
      this.game.events.emit('fleet:delivered', { vehicle: v, kind: v.kind, kingdom: v.kingdom, from: m.from, to: m.to, cargo: v.cargo });
      const kp = this.kname(v.kingdom);
      if (to) this.history(`A caravan of ${kp} trades in ${to.name}`, 'info', { x: to.cx, z: to.cz });
      v.cargo = { gold: 10 };
      m.phase = 'home';
      const back = civ.villages[m.from];
      const p = back?.alive && to ? this._roadPath(to, back, 5000) : null;
      if (p) {
        this.setPath(v, p);
        v.state = 'rest';
        v.stateT = 0;
      } else this.remove(v);
    }
  },

  // ------------------------------------------------------------------ siege
  _siegeTick(dt) {
    const civ = this.game.civ;
    this._siege = this._siege || new Map(); // army id -> [engines]
    this._trail = this._trail || new Map();
    const alive = new Set();
    for (const army of civ.armies || []) {
      alive.add(army.id);
      if (!this.auto.siege || army.dead || army.state === 'gather' || !army.units?.size) continue;
      if (!this.hasTech(army.kingdom, 'siegecraft')) continue;
      if (this._siege.has(army.id)) continue;
      if ((army.size0 || army.units.size) < 6 || this.landCount() >= this.budget.land) continue;
      const bearer = this.game.units?.byId?.get(army.bearer);
      const c = bearer || civ._armyCentre?.(army);
      if (!c) continue;
      const list = [];
      for (const kind of ['ram', 'catapult']) {
        const v = this.spawn(kind, army.kingdom, c.x - 1 - list.length, c.z - 1, { state: 'siege', home: army.home });
        v.army = army.id;
        v.ti = 0;
        v.mission = { type: 'siege', phase: 'out' };
        const tv = civ.villages[army.target];
        v.voyage = { from: army.home, to: army.target, fromName: civ.villages[army.home]?.name, toName: tv?.name };
        list.push(v);
      }
      this._siege.set(army.id, list);
      this._trail.set(army.id, [c.x, c.z]);
    }
    for (const [id, list] of this._siege) {
      if (alive.has(id)) continue;
      // the army is gone: the engines are left behind and broken up
      for (const v of list) {
        v.abandon = (v.abandon || 0) + dt;
        v.siegeTarget = null;
        if (v.abandon > 12) this.remove(v);
      }
      if (list.every((v) => !v.alive)) {
        this._siege.delete(id);
        this._trail.delete(id);
      }
    }
    // defenders hack at engines in reach
    const U = this.game.units;
    for (const list of this._siege.values())
      for (const v of list) {
        if (!v.alive) continue;
        const foes = U?.query?.(v.x, v.z, 1.2, (o) => o.alive && o.species === 'human' && o.job === 'soldier' && this.atWar(o.kingdom, v.kingdom)) || [];
        if (foes.length) this.hurt(v, foes.length * 5 * dt, 'battle', { kingdom: foes[0].kingdom });
      }
  },

  _siegeMove(v, step) {
    const civ = this.game.civ;
    const a = v.anim;
    const army = civ.armies?.find((x) => x.id === v.army);
    a.arm = Math.max(0, a.arm - step * 0.8);
    a.ram = Math.max(0, a.ram - step * 2.5);
    if (!army) {
      v.speed *= Math.exp(-step * 2);
      return;
    }
    // record the standard-bearer's march: the engines roll in its tracks
    const trail = this._trail.get(army.id);
    const bearer = this.game.units?.byId?.get(army.bearer);
    if (bearer && trail) {
      const lx = trail[trail.length - 2],
        lz = trail[trail.length - 1];
      if (Math.hypot(bearer.x - lx, bearer.z - lz) > 0.6) {
        trail.push(bearer.x, bearer.z);
        if (trail.length > 1200) {
          trail.splice(0, 200);
          v.ti = Math.max(0, v.ti - 200);
        }
      }
    }
    const target = civ.villages[army.target];
    // in the siege: find something to batter
    let b = null;
    // before the walls (the army's siege, or already in sight of the town on the march)
    const close = target?.alive && Math.hypot(target.cx - v.x, target.cz - v.z) < (target.radius || 9) + 14;
    if (target?.alive && (army.state === 'siege' || (army.state === 'march' && close))) {
      if ((v.pickT = (v.pickT || 0) - step) <= 0 || !v.siegeTarget?.alive) {
        v.pickT = 1.5;
        v.siegeTarget = this._siegePick(v, target);
      }
      b = v.siegeTarget;
    } else v.siegeTarget = null;
    const w = this.world;
    if (b) {
      const d = Math.hypot(b.x - v.x, b.z - v.z);
      const edge = Math.max(b.w, b.h) * 0.5;
      if (v.kind === 'catapult') {
        if (this._battery(v, b, target, step)) return;
        if (d <= 12 && d >= 3.5 && this._openGround(v.x, v.z)) {
          v.speed *= Math.exp(-step * 3);
          v.heading = turnTo(v.heading, Math.atan2(b.z - v.z, b.x - v.x), step * 1.5);
          if ((v.fireT = (v.fireT ?? 1) - step) <= 0) {
            v.fireT = 4.5 + this.rng();
            this._launchStone(v, b);
          }
          return;
        }
      } else if (d <= edge + 0.9) {
        v.speed *= Math.exp(-step * 4);
        v.heading = turnTo(v.heading, Math.atan2(b.z - v.z, b.x - v.x), step * 1.5);
        if ((v.fireT = (v.fireT ?? 0.5) - step) <= 0) {
          v.fireT = 2.2;
          a.ram = 1;
          const mod = civ.techMod?.(v.kingdom, 'siege') ?? 1;
          civ.damageBuilding?.(b, Math.max(24 * mod, (b.maxHp || 100) * (BUILDING_TYPES[b.type]?.wall ? 0.2 : 0.12) * mod), 'siege');
          this._fx('debris', b.x, b.z, 0.6);
          this._fx('dust', v.x + Math.cos(v.heading) * 0.8, v.z + Math.sin(v.heading) * 0.8, 0.5);
          this._sfx('hit', b.x, b.z, 0.5);
          this._siegeBreach(v, b);
        }
        return;
      }
      // roll straight at it when the ground allows
      const want = Math.atan2(b.z - v.z, b.x - v.x);
      const nx = v.x + Math.cos(want) * 0.6,
        nz = v.z + Math.sin(want) * 0.6;
      if (w.isWalkable(Math.floor(nx), Math.floor(nz)) || w.building[w.idx(Math.floor(nx), Math.floor(nz))] >= 0) {
        v.heading = turnTo(v.heading, want, step * v.def.turn);
        v.speed += (v.def.speed - v.speed) * Math.min(1, step * 2);
        const sx = v.x + Math.cos(want) * v.speed * step,
          sz = v.z + Math.sin(want) * v.speed * step;
        if (w.isWalkable(Math.floor(sx), Math.floor(sz))) {
          v.x = sx;
          v.z = sz;
        }
        return;
      }
    }
    // otherwise follow the march, keeping behind the front ranks
    if (!trail || v.ti >= trail.length - 2) {
      v.speed *= Math.exp(-step * 2);
      return;
    }
    if (bearer && Math.hypot(bearer.x - v.x, bearer.z - v.z) < (v.kind === 'ram' ? 2.5 : 4.5) && army.state !== 'siege') {
      v.speed *= Math.exp(-step * 2);
      return;
    }
    const tx = trail[v.ti],
      tz = trail[v.ti + 1];
    const d = Math.hypot(tx - v.x, tz - v.z);
    if (d < 0.4) {
      v.ti += 2;
      return;
    }
    const behind = (trail.length - v.ti) / 2;
    const want = Math.atan2(tz - v.z, tx - v.x);
    v.heading = turnTo(v.heading, want, step * v.def.turn);
    const tgt = v.def.speed * (behind > 24 ? 1.7 : behind > 10 ? 1.25 : 1);
    v.speed += (tgt - v.speed) * Math.min(1, step * 2);
    const s = Math.min(d, v.speed * step);
    v.x += Math.cos(want) * s;
    v.z += Math.sin(want) * s;
  },

  // A catapult works from a battery: open, level ground just outside the
  // town (beyond its outermost houses and walls), within range of them,
  // facing in. It rolls there, sets up and shoots at what lies in range.
  // Returns false when no battery can be found (then the old way applies).
  _battery(v, b, village, step) {
    const w = this.world;
    if (!v.battery || v.battery.vid !== village.id || (v.batT = (v.batT ?? 0) - step) <= 0 || v.battery.stuck > 8) {
      v.batT = 14;
      v.battery = this._batterySite(v, village);
    }
    const bt = v.battery;
    if (!bt) return false;
    const dx = bt.x - v.x,
      dz = bt.z - v.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.6) {
      // roll out to the battery, steering round what stands in the way
      const want = Math.atan2(dz, dx);
      let moved = false;
      for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) {
        const a = want + off;
        const sp = Math.max(0.3, v.speed);
        const nx = v.x + Math.cos(a) * sp * step,
          nz = v.z + Math.sin(a) * sp * step;
        const lx = v.x + Math.cos(a) * 0.7,
          lz = v.z + Math.sin(a) * 0.7;
        if (!w.isWalkable(Math.floor(nx), Math.floor(nz)) || !w.isWalkable(Math.floor(lx), Math.floor(lz))) continue;
        // round houses, not through them (unless boxed in among them)
        if ((bt.stuck || 0) < 4 && w.building[w.idx(Math.floor(lx), Math.floor(lz))] >= 0) continue;
        v.heading = turnTo(v.heading, a, step * v.def.turn);
        v.speed += (v.def.speed - v.speed) * Math.min(1, step * 2);
        v.x = nx;
        v.z = nz;
        moved = true;
        break;
      }
      if (!moved) {
        v.speed *= Math.exp(-step * 3);
        bt.stuck = (bt.stuck || 0) + step;
      }
      return true;
    }
    // in battery: pick the nearest thing in range from here
    v.speed *= Math.exp(-step * 3);
    let tgt = b && Math.hypot(b.x - v.x, b.z - v.z) <= 12.5 ? b : null;
    if (!tgt) {
      let bs = Infinity;
      for (const o of village.buildings || []) {
        if (!o.alive || o.constructing) continue;
        const od = Math.hypot(o.x - v.x, o.z - v.z);
        if (od > 12.5 || od < 3) continue;
        const sc = od - (BUILDING_TYPES[o.type]?.wall ? 3 : 0);
        if (sc < bs) {
          bs = sc;
          tgt = o;
        }
      }
      if (tgt) v.siegeTarget = tgt;
    }
    if (!tgt) {
      v.batT = Math.min(v.batT, 1); // nothing in reach any more: find a closer battery
      return true;
    }
    v.heading = turnTo(v.heading, Math.atan2(tgt.z - v.z, tgt.x - v.x), step * 1.5);
    if ((v.fireT = (v.fireT ?? 1) - step) <= 0) {
      v.fireT = 4.5 + this.rng();
      this._launchStone(v, tgt);
    }
    return true;
  },

  _batterySite(v, village) {
    const w = this.world;
    const B = (village.buildings || []).filter((o) => o.alive);
    if (!B.length) return null;
    const cx = village.cx,
      cz = village.cz;
    let ext = 0;
    for (const o of B) ext = Math.max(ext, Math.hypot(o.x - cx, o.z - cz) + Math.max(o.w || 1, o.h || 1) * 0.5);
    const base = Math.atan2(v.z - cz, v.x - cx);
    let best = null,
      bs = Infinity;
    for (let k = 0; k < 17; k++) {
      const ang = base + (k & 1 ? 1 : -1) * Math.ceil(k / 2) * 0.24;
      for (const r of [ext + 2.5, ext + 4, ext + 6]) {
        const x = cx + Math.cos(ang) * r,
          z = cz + Math.sin(ang) * r;
        const tx = Math.floor(x),
          tz = Math.floor(z);
        if (!w.inBounds(tx, tz) || !w.isWalkable(tx, tz) || !this._openGround(x, z)) continue;
        let clear = true,
          near = Infinity;
        for (const o of B) {
          const od = Math.hypot(o.x - x, o.z - z) - Math.max(o.w || 1, o.h || 1) * 0.5;
          if (od < 1.8) {
            clear = false;
            break;
          }
          if (od < near) near = od;
        }
        if (!clear || near > 10) continue;
        const sc = Math.ceil(k / 2) * 1.2 + Math.hypot(x - v.x, z - v.z) * 0.12 + (r - ext) * 0.4;
        if (sc < bs) {
          bs = sc;
          best = { x, z, vid: village.id, stuck: 0 };
        }
      }
    }
    return best;
  },

  // Clear, level ground (no trees close by): where a catapult can work and be seen.
  _openGround(x, z) {
    const w = this.world;
    const tx = Math.floor(x),
      tz = Math.floor(z);
    if (w.slopeAt(tx, tz) > 0.6) return false;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!w.inBounds(tx + dx, tz + dz)) continue;
        if (FLORA_INFO[w.flora[w.idx(tx + dx, tz + dz)]]?.isTree) return false;
      }
    return true;
  },

  _siegePick(v, village) {
    let best = null,
      bs = Infinity;
    for (const b of village.buildings || []) {
      if (!b.alive || b.constructing) continue;
      const def = BUILDING_TYPES[b.type];
      const d = Math.hypot(b.x - v.x, b.z - v.z);
      if (d > 26) continue;
      let sc = d;
      if (def?.wall) sc -= b.type === 'gate' ? (v.kind === 'ram' ? 12 : 4) : 6;
      else if (b.type === 'hall') sc -= 3;
      else if (b.type === 'watchtower') sc -= 2;
      if (sc < bs) {
        bs = sc;
        best = b;
      }
    }
    return best;
  },

  _launchStone(v, b) {
    const civ = this.game.civ;
    const w = this.world;
    const ax = v.x + Math.cos(v.heading) * 0.2,
      az = v.z + Math.sin(v.heading) * 0.2;
    const jx = (this.rng() - 0.5) * 0.8,
      jz = (this.rng() - 0.5) * 0.8;
    const d = Math.hypot(b.x - ax, b.z - az);
    v.anim.arm = 1;
    this.stones.push({ x0: ax, z0: az, y0: w.heightAt(ax, az) + 0.9, x1: b.x + jx, z1: b.z + jz, y1: (b.y ?? w.heightAt(b.x, b.z)) + 0.6, t: 0, dur: 1.6 + d * 0.1, peak: 1.2 + d * 0.22, b: b.id, kingdom: v.kingdom, dmg: Math.max(38, (b.maxHp || 100) * (BUILDING_TYPES[b.type]?.wall ? 0.24 : 0.14)) * (civ.techMod?.(v.kingdom, 'siege') ?? 1), from: v.id });
    this.totals.stones++;
    this._sfx('chop', v.x, v.z, 0.5);
  },

  _stonesTick(step) {
    if (!this.stones.length) return;
    const civ = this.game.civ;
    const keep = [];
    for (const s of this.stones) {
      s.t += step;
      if (s.t < s.dur) {
        keep.push(s);
        continue;
      }
      const b = civ?.buildingById?.(s.b) || civ?._bById?.get(s.b);
      if (b?.alive && Math.hypot(b.x - s.x1, b.z - s.z1) < Math.max(b.w, b.h) + 0.8) {
        civ.damageBuilding?.(b, s.dmg, 'siege');
        this._siegeBreach({ kingdom: s.kingdom, kind: 'catapult' }, b);
      }
      this._fx('explosion', s.x1, s.z1, 0.42, { y: s.y1 });
      this._fx('debris', s.x1, s.z1, 1.5, { y: s.y1 });
      this._fx('dust', s.x1, s.z1, 1.6);
      this._fx('dust', s.x1 + (this.rng() - 0.5), s.z1 + (this.rng() - 0.5), 1.1);
      this.game.fx?.shake?.(s.x1, s.z1, 0.15);
      this._sfx('hit', s.x1, s.z1, 0.7);
    }
    this.stones = keep;
  },

  _siegeBreach(v, b) {
    if (b.alive) return;
    const civ = this.game.civ;
    const vil = civ.villages?.[b.village];
    if (!vil) return;
    const def = BUILDING_TYPES[b.type];
    const what = def?.wall ? 'walls' : b.type === 'hall' ? 'great hall' : null;
    if (!what) return;
    const n = this.kname(v.kingdom);
    const by = v.kind === 'catapult' ? 'Catapult stones' : 'A battering ram';
    this.note(`⚔ ${by} of ${n} ${v.kind === 'catapult' ? 'breach' : 'breaches'} the ${what} of ${vil.name}`, 'war', { x: b.x, z: b.z }, 'breach' + vil.id, 120);
  },
};

function reversePath(p) {
  const out = new Array(p.length);
  for (let i = 0; i < p.length; i += 2) {
    out[p.length - 2 - i] = p[i];
    out[p.length - 1 - i] = p[i + 1];
  }
  return out;
}

function turnTo(h, want, maxStep) {
  let d = want - h;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return h + Math.max(-maxStep, Math.min(maxStep, d));
}

// One pass of corner cutting so carts round the corners of the tile path.
function chaikin(p) {
  const n = p.length / 2;
  if (n < 3) return p;
  const out = [p[0], p[1]];
  for (let i = 0; i < n - 1; i++) {
    const ax = p[i * 2],
      az = p[i * 2 + 1],
      bx = p[i * 2 + 2],
      bz = p[i * 2 + 3];
    out.push(ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25, ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75);
  }
  out.push(p[p.length - 2], p[p.length - 1]);
  return out;
}
