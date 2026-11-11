import { TILE, TILE_INFO, FLORA, FLORA_INFO, SEA_LEVEL } from '../../world/constants.js';
import { BUILDING_TYPES } from './catalog.js';
import { USE, YEAR, ADULT_AGE, SPIRAL, spiralCount, ROT_DIR } from './util.js';
import { civPath } from './pathing.js';

// The human brain: villagers pick up their job's work loop and visibly do it
// (Life renders unit.state 'work' + unit.data.workAnim and unit.carry).
// Mixed into Civilization.prototype.

const ARRIVED = 1,
  WALKING = 2,
  FAIL = 3,
  WAIT = 4;

const CARRY_MAX = { wood: 32, stone: 18, food: 40, gold: 3 };
const CHILD_AGE_RATE = 1.7; // extra years per year while a child (childhood ~6 game years)

export const brain = {
  think(u, dt) {
    try {
      this._think(u, dt);
    } catch (err) {
      if (!this._brainErr) {
        this._brainErr = true;
        console.error('[civ brain]', err);
      }
    }
  },

  hostileTo(u, o) {
    if (!o || !o.alive || o === u) return false;
    if (o.species === 'human') {
      if (!(u.kingdom >= 0 && o.kingdom >= 0 && this.atWar(u.kingdom, o.kingdom))) return false;
      // war is fought between soldiers; villagers are spared
      return o.job === 'soldier' || (u.job === 'soldier' && o.job === 'king' && o.hp < o.maxHp * 0.999);
    }
    return !!(o.def?.aggressive && o.def.kind !== 'humanoid');
  },

  _think(u, dt) {
    const g = this.game;
    const d = u.data.civ || (u.data.civ = { task: null });
    if (!u.data.hostile) u.data.hostile = (o) => this.hostileTo(u, o);
    const v = this.villages[u.village];
    const now = g.time.total;
    // a fight in progress is driven by the creature module's combat system
    if (u.combat) {
      const foe = g.units.byId.get(u.combat.target);
      if (foe && foe.alive) {
        if (this.rng.chance(0.25) && Math.hypot(foe.x - u.x, foe.z - u.z) < 1.4) this._fx('sparks', (foe.x + u.x) / 2, (foe.z + u.z) / 2, 0.5);
        return;
      }
    }
    if (!v || !v.alive) return this._homeless(u, d, dt);
    if (!u.data.culture) u.data.culture = v.culture;
    if (u.kingdom !== v.kingdom) u.kingdom = v.kingdom;

    // hunger is managed by the village store
    if (v.starving) {
      if (u.hunger >= 0.97 && !d.royal && v.pop > 8) g.units.damage(u, dt * 0.25);
    } else if (u.hunger > 0.3) u.hunger = 0.12 + this.rng.next() * 0.1;
    if (!u.alive) return;

    // migrations / arrivals have priority
    if (d.task && d.task.kind === 'migrate') return this._migrate(u, d, dt);
    if (d.task && d.task.kind === 'arrive') {
      const r = this._go(u, v.hall ? v.hall.doorX : v.cx, v.hall ? v.hall.doorZ : v.cz, 1.2, true);
      if (r !== WALKING && r !== WAIT) d.task = null;
      return;
    }

    // children
    if (u.age < ADULT_AGE) {
      u.age += (dt / YEAR) * CHILD_AGE_RATE;
      u.job = 'child';
      return this._child(u, v, d, dt);
    }
    if (u.job === 'child') {
      u.job = null;
      d.task = null;
    }

    // danger
    if ((d.threatT = (d.threatT || 0) - dt) <= 0) {
      d.threatT = 1.2;
      d.threat = null;
      if (u.job !== 'soldier') {
        const t = g.units.nearest(u.x, u.z, 5.5, (o) => o.species === 'human' && o.job === 'soldier' && this.atWar(u.kingdom, o.kingdom));
        if (t) d.threat = t.id;
      }
    }
    if (d.threat != null && u.job !== 'soldier') {
      const t = g.units.byId.get(d.threat);
      if (t && t.alive) return this._flee(u, v, d, t);
      d.threat = null;
    }

    switch (u.job) {
      case 'woodcutter':
        return this._jobWood(u, v, d, dt);
      case 'farmer':
        return this._jobFarm(u, v, d, dt);
      case 'builder':
        return this._jobBuild(u, v, d, dt);
      case 'miner':
        return this._jobMine(u, v, d, dt);
      case 'fisher':
        return this._jobFish(u, v, d, dt);
      case 'soldier':
        return this._jobSoldier(u, v, d, dt);
      case 'king':
        return this._jobKing(u, v, d, dt);
      case 'healer':
        return this._jobHealer(u, v, d, dt);
      case 'messenger':
        return this._jobMessenger(u, v, d, dt);
      default:
        return this._jobIdle(u, v, d, dt);
    }
  },

  // Medicine: the healer walks to the sick and the wounded and tends them.
  _jobHealer(u, v, d, dt) {
    const U = this.game.units;
    let t = d.task;
    if (!t || t.kind !== 'heal') {
      if ((d.scanT = (d.scanT || 0) - dt) > 0) return this._jobIdle(u, v, d, dt);
      d.scanT = 2;
      let best = null,
        bd = Infinity;
      for (const m of v.members) {
        if (!m.alive || m === u) continue;
        if (!(U.hasStatus?.(m, 'sick') || U.hasStatus?.(m, 'wounded') || m.hp < m.maxHp * 0.5)) continue;
        const dd = Math.hypot(m.x - u.x, m.z - u.z);
        if (dd < bd && dd < 40) (bd = dd), (best = m);
      }
      if (!best) return this._jobIdle(u, v, d, dt);
      t = d.task = { kind: 'heal', id: best.id, phase: 'go', t: 0 };
    }
    const m = U.byId.get(t.id);
    if (!m || !m.alive) {
      d.task = null;
      return;
    }
    if (t.phase === 'go') {
      const close = Math.hypot(m.x - u.x, m.z - u.z) < 1.2;
      if (!close) {
        const r = this._go(u, m.x, m.z, 0.9);
        if (r === FAIL) d.task = null;
        if (r !== ARRIVED) return;
      }
      t.phase = 'tend';
      t.t = 2.2;
    }
    this._work(u, 'harvest', m.x, m.z);
    t.t -= dt;
    if (t.t > 0) return;
    U.removeStatus?.(m, 'sick');
    m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.35);
    this._fx('heal', m.x, m.z, 0.7);
    this._xp(u, 1.5);
    this._firstUse?.(this.kingdoms[v.kingdom], 'healers', { x: m.x, z: m.z });
    d.task = null;
    this._idle(u);
  },

  // Horsemanship: the mounted messenger rides between the realm's towns.
  _jobMessenger(u, v, d, dt) {
    const k = this.kingdoms[v.kingdom];
    let t = d.task;
    if (!t || t.kind !== 'ride') {
      const vs = (k?.villages || []).map((id) => this.villages[id]).filter((o) => o?.alive && o.landId === v.landId);
      if (vs.length < 2) return this._jobIdle(u, v, d, dt);
      t = d.task = { kind: 'ride', vid: vs[(this.rng.next() * vs.length) | 0].id };
    }
    const dest = this.villages[t.vid];
    if (!dest?.alive) {
      d.task = null;
      return;
    }
    const r = this._go(u, dest.cx + 1.5, dest.cz + 1.5, 2.2, true);
    if (r === ARRIVED || r === FAIL) {
      d.task = null;
      // news from the crown steadies the province
      if (r === ARRIVED && dest.id !== k?.capital) dest.loyaltyBoost = Math.max(dest.loyaltyBoost || 0, 2);
    }
  },

  // ------------------------------------------------------------------ motion
  _walkCost() {
    if (this.__walkCost) return this.__walkCost;
    const w = this.world;
    this.__walkCost = (i) => {
      if (w.height[i] < SEA_LEVEL) return Infinity;
      const t = w.type[i];
      if (!TILE_INFO[t].walkable) return Infinity;
      const f = w.flora[i];
      if (f && FLORA_INFO[f].blocksMovement) return Infinity;
      const use = this.use[i];
      if (use === USE.ROAD) return 0.5;
      if (use === USE.BUILDING) {
        const b = this._bById.get(w.building[i]);
        if (!b) return 1;
        if (b.type === 'gate') return 0.55;
        return Infinity; // never cut through houses
      }
      if (use === USE.PLOT) return 1.4;
      if (w.fire[i] > 0.3) return 8;
      return 1;
    };
    return this.__walkCost;
  },

  _pathTo(u, x, z, long = false) {
    const w = this.world;
    const sx = Math.floor(u.x),
      sy = Math.floor(u.z);
    const gx = Math.floor(x),
      gy = Math.floor(z);
    if (!w.inBounds(gx, gy)) return false;
    if (Math.abs(sx - gx) + Math.abs(sy - gy) <= 2) {
      u.path = null;
      u.target = { x, z };
      return true;
    }
    if (long ? this._longBudget <= 0 : this._pathBudget <= 0) return WAIT;
    if (long) this._longBudget--;
    else this._pathBudget--;
    const p = civPath(w, w.clampTx(sx), w.clampTy(sy), gx, gy, this._walkCost(), long ? 32000 : 3200, 0.5);
    if (!p) {
      u.target = null;
      u.path = null;
      return false;
    }
    u.path = p;
    u.pathIdx = 0;
    u.target = { x, z };
    return true;
  },

  // Walk toward (x,z). Returns ARRIVED / WALKING / FAIL / WAIT.
  _go(u, x, z, near = 0.4, long = false) {
    const d = u.data.civ;
    const dx = x - u.x,
      dz = z - u.z;
    if (dx * dx + dz * dz <= near * near) {
      if (d.gx === x && d.gz === z) {
        u.target = null;
        u.path = null;
      }
      d.gx = null;
      return ARRIVED;
    }
    if (u.target && d.gx === x && d.gz === z) {
      if (u.state !== 'run') u.state = 'walk';
      if (this.game.time.total - d.gt > (long ? 400 : 60)) {
        d.gx = null;
        return FAIL;
      }
      return WALKING;
    }
    if (d.gx === x && d.gz === z) {
      if (++d.repath > 5) {
        d.gx = null;
        return FAIL;
      }
    } else {
      d.repath = 0;
      d.gt = this.game.time.total;
    }
    const r = this._pathTo(u, x, z, long);
    if (r === WAIT) {
      u.state = 'idle';
      return WAIT;
    }
    if (!r) {
      d.gx = null;
      return FAIL;
    }
    d.gx = x;
    d.gz = z;
    if (u.state !== 'run') u.state = 'walk';
    return WALKING;
  },

  _work(u, anim, faceX, faceZ) {
    u.target = null;
    u.path = null;
    u.moving = false;
    u.state = 'work';
    u.data.workAnim = anim;
    if (faceX != null) {
      const dx = faceX - u.x,
        dz = faceZ - u.z;
      if (dx * dx + dz * dz > 1e-4) u.heading = Math.atan2(dx, dz);
    }
  },

  _idle(u) {
    if (!u.target) u.state = 'idle';
    u.data.workAnim = null;
  },

  _wanderNear(u, x, z, r, chance = 0.35) {
    if (u.target || !this.rng.chance(chance)) {
      if (!u.target) u.state = 'idle';
      return;
    }
    const w = this.world;
    for (let k = 0; k < 6; k++) {
      const tx = x + this.rng.float(-r, r),
        tz = z + this.rng.float(-r, r);
      const ix = Math.floor(tx),
        iz = Math.floor(tz);
      if (!w.isWalkable(ix, iz)) continue;
      const use = this.use[iz * w.w + ix];
      if (use === USE.BUILDING) continue;
      const res = this._pathTo(u, tx, tz);
      if (res === true) {
        u.state = 'walk';
        u.data.workAnim = null;
      }
      return;
    }
  },

  _speed(v) {
    let s = 1;
    const k = this.kingdoms[v.kingdom];
    if (k && this.game.time.total < k.goldenUntil) s *= 1.45;
    if (v.hasForge) s *= 1.2;
    else if (v.hasWorkshop) s *= 1.1;
    if (v.starving) s *= 0.6;
    return s;
  },

  // How fast this worker works: village (golden age, forge, famine), the
  // worker's traits and statuses (Green-thumbed, Inventive, Inspired,
  // Exhausted, Sick...), the tool in hand and the kingdom's metallurgy.
  _workMul(u, v) {
    const U = this.game.units;
    let m = this._speed(v) * (U.traitMod?.(u, 'work') ?? 1) * this.techMod(v.kingdom, 'work');
    const tool = u.equipment?.tool || u.data.civ?.gear?.tool;
    if (tool) m *= 1 + Math.min(0.4, (tool.power || 3) * 0.035);
    return Math.max(0.25, m);
  },
  _xp(u, n) {
    this.game.units.addXP?.(u, n);
  },

  _reserve(i, u, secs = 30) {
    this.reservedBy[i] = u.id;
    this.reservedT[i] = this.game.time.total + secs;
  },
  _reservedByOther(i, u) {
    return this.reservedBy[i] !== 0 && this.reservedBy[i] !== u.id && this.reservedT[i] > this.game.time.total;
  },
  _release(i, u) {
    if (i != null && i >= 0 && this.reservedBy[i] === u.id) this.reservedBy[i] = 0;
  },

  // ------------------------------------------------------------------ storage
  _storageFor(v, type, u) {
    let best = null,
      bd = Infinity;
    for (const b of v.buildings) {
      if (!b.alive || b.constructing) continue;
      const def = BUILDING_TYPES[b.type];
      if (!def.storage) continue;
      if (type === 'food' && b.type === 'workshop') continue;
      if (type !== 'food' && b.type === 'granary') continue;
      const dd = (b.doorX - u.x) ** 2 + (b.doorZ - u.z) ** 2;
      if (dd < bd) {
        bd = dd;
        best = b;
      }
    }
    return best || v.hall;
  },

  _deposit(u, v, d) {
    const c = u.carry;
    if (!c) return false;
    const st = this._storageFor(v, c.type, u);
    const x = st ? st.doorX : v.cx,
      z = st ? st.doorZ : v.cz;
    const r = this._go(u, x, z, 0.55);
    if (r === ARRIVED || r === FAIL) {
      if (r === ARRIVED || Math.hypot(u.x - v.cx, u.z - v.cz) < v.radius) {
        if (c.type === 'food') v.food = Math.min(v.foodCap, v.food + c.amount);
        else if (c.type === 'wood') v.wood += c.amount;
        else if (c.type === 'stone') v.stone += c.amount;
        else if (c.type === 'gold') v.gold += c.amount;
        else if (c.type === 'ore') v.ore = Math.min(80, (v.ore || 0) + c.amount);
        v.produced[c.type] = (v.produced[c.type] || 0) + c.amount;
      }
      u.carry = null;
      this._idle(u);
    }
    return true;
  },

  // ------------------------------------------------------------------ jobs
  _jobWood(u, v, d, dt) {
    const w = this.world;
    if (u.carry && u.carry.type !== 'wood') return this._deposit(u, v, d);
    if (u.carry && u.carry.amount >= CARRY_MAX.wood) return this._deposit(u, v, d);
    let t = d.task;
    if ((!t || t.kind !== 'chop') && v.wood > (v.woodCap || 200) * 0.6 && (v.trees ?? 99) < 60) return this._forester(u, v, d, dt);
    if (!t || t.kind !== 'chop') {
      const i = this._findTree(u, v);
      if (i < 0) {
        if (u.carry) return this._deposit(u, v, d);
        return this._forester(u, v, d, dt);
      }
      const tx = i % w.w,
        ty = (i / w.w) | 0;
      const cx = tx + 0.5,
        cz = ty + 0.5;
      const dx = u.x - cx,
        dz = u.z - cz;
      const l = Math.hypot(dx, dz) || 1;
      t = d.task = { kind: 'chop', i, x: cx + (dx / l) * 0.5, z: cz + (dz / l) * 0.5, cx, cz, phase: 'go', t: 0 };
      this._reserve(i, u, 60);
    }
    if (t.phase === 'go') {
      const r = this._go(u, t.x, t.z, 0.35);
      if (r === FAIL) {
        this._release(t.i, u);
        this.reservedBy[t.i] = -1; // remember as unreachable for a while
        this.reservedT[t.i] = this.game.time.total + 40;
        d.task = null;
        return;
      }
      if (r !== ARRIVED) return;
      t.phase = 'work';
      t.t = 9 / this._workMul(u, v);
    }
    const f = w.flora[t.i];
    if (!FLORA_INFO[f]?.isTree) {
      this._release(t.i, u);
      d.task = null;
      return;
    }
    this._work(u, 'chop', t.cx, t.cz);
    t.t -= dt;
    if (t.t > 0) {
      if (this.rng.chance(0.15)) this._fx('leaves', t.cx, t.cz, 0.5);
      if (this.rng.chance(0.5)) this._sfx('chop', t.cx, t.cz, 0.45);
      return;
    }
    const tx = t.i % w.w,
      ty = (t.i / w.w) | 0;
    const wood = Math.max(4, FLORA_INFO[f].wood || 2) * 2;
    w.setFlora(tx, ty, FLORA.STUMP, 1);
    this._fx('debris', t.cx, t.cz, 0.4);
    if (this.rng.chance(0.95)) this.regrow.push({ i: t.i, at: this.game.time.total + YEAR * (1.5 + this.rng.next() * 2), flora: f });
    else this.regrow.push({ i: t.i, at: this.game.time.total + YEAR * 3, flora: FLORA.NONE });
    this._release(t.i, u);
    u.carry = { type: 'wood', amount: Math.min(CARRY_MAX.wood, (u.carry?.amount || 0) + Math.round(wood * (this.game.units.traitMod?.(u, 'work') ?? 1))) };
    this._xp(u, 1.5);
    d.task = null;
  },

  // No mature trees in reach: plant a woodlot on the outskirts.
  _forester(u, v, d, dt) {
    const w = this.world;
    let t = d.task;
    if (!t || t.kind !== 'plant-tree') {
      const species = { vale: [FLORA.OAK, FLORA.BIRCH], dune: [FLORA.PALM, FLORA.ACACIA], frost: [FLORA.PINE, FLORA.PINE], mire: [FLORA.JUNGLE_TREE, FLORA.SWAMP_TREE] }[v.culture] || [FLORA.OAK];
      let spot = -1;
      // woodlots cluster on one side of the village so they read as groves
      if (v.groveAngle == null) v.groveAngle = this.rng.float(0, Math.PI * 2);
      for (let k = 0; k < 24; k++) {
        const a = v.groveAngle + this.rng.float(-1.1, 1.1) + (k > 12 ? this.rng.float(-2, 2) : 0);
        const r = v.buildRadius + 1 + this.rng.next() * 8;
        const x = Math.floor(v.cx + Math.cos(a) * r),
          y = Math.floor(v.cz + Math.sin(a) * r);
        if (!w.inBounds(x, y)) continue;
        const i = y * w.w + x;
        const f = w.flora[i];
        const clutter = f === FLORA.ROCK_SMALL || f === FLORA.FLOWERS || f === FLORA.BUSH || f === FLORA.STUMP || f === FLORA.REEDS;
        if (!this._tileFree(i) || (f && !clutter) || w.type[i] === TILE.FARMLAND || w.type[i] === TILE.ROAD || w.type[i] === TILE.ROCK) continue;
        if (w.owner[i] >= 0 && w.owner[i] !== v.kingdom) continue;
        spot = i;
        break;
      }
      if (spot < 0) return this._jobIdle(u, v, d, dt);
      t = d.task = { kind: 'plant-tree', i: spot, x: (spot % w.w) + 0.5, z: ((spot / w.w) | 0) + 0.5 + 0.4, phase: 'go', t: 0, flora: species[(this.rng.next() * species.length) | 0] };
    }
    if (t.phase === 'go') {
      const r = this._go(u, t.x, t.z, 0.4);
      if (r === FAIL) {
        d.task = null;
        return;
      }
      if (r !== ARRIVED) return;
      t.phase = 'work';
      t.t = 2.2;
    }
    this._work(u, 'dig', t.x, t.z - 0.4);
    t.t -= dt;
    if (t.t > 0) return;
    const x = t.i % w.w,
      y = (t.i / w.w) | 0;
    const f0 = w.flora[t.i];
    if ((!f0 || !FLORA_INFO[f0].isTree) && this.use[t.i] === USE.FREE) w.setFlora(x, y, t.flora, 0.18);
    d.task = null;
  },

  _findTree(u, v) {
    const w = this.world;
    const W = w.w;
    // search outward from the woodcutter while working inside the village lands
    const nearHome = Math.hypot(u.x - v.cx, u.z - v.cz) < v.radius + 10;
    const cx = Math.floor(nearHome ? u.x : v.cx),
      cy = Math.floor(nearHome ? u.z : v.cz);
    const n = spiralCount(30);
    const coreR = 3.5;
    let best = -1,
      bd = Infinity;
    let found = 0;
    for (let k = 0; k < n; k++) {
      const [dx, dy, dd] = SPIRAL[k];
      if (dd < coreR) continue;
      const x = cx + dx,
        y = cy + dy;
      if (x < 0 || y < 0 || x >= W || y >= w.h) continue;
      const i = y * W + x;
      const f = w.flora[i];
      if (!f || !FLORA_INFO[f].isTree || w.floraGrowth[i] < 0.6) continue;
      // keep shade trees in town and never strip the last of a grove
      if (dd < 5 && this.use[i] !== USE.PLOT) continue;
      if (this._reservedByOther(i, u)) continue;
      if (this.use[i] === USE.PLOT && u.job !== 'farmer') continue;
      if (w.owner[i] >= 0 && w.owner[i] !== v.kingdom) continue;
      const du = (x + 0.5 - u.x) ** 2 + (y + 0.5 - u.z) ** 2;
      const score = du + dd * dd * 0.3;
      if (score < bd) {
        bd = score;
        best = i;
      }
      if (++found > 14) break;
    }
    return best;
  },

  _jobFarm(u, v, d, dt) {
    const w = this.world;
    if (u.carry && u.carry.type !== 'food') return this._deposit(u, v, d);
    let t = d.task;
    if (!t || t.kind !== 'farm') {
      if (u.carry && u.carry.amount >= CARRY_MAX.food) return this._deposit(u, v, d);
      const pick = this._pickFieldTile(u, v);
      if (!pick) {
        if (u.carry) return this._deposit(u, v, d);
        // nothing to do: forage berries or tend the crop
        return this._forage(u, v, d, dt);
      }
      const tx = pick.i % w.w,
        ty = (pick.i / w.w) | 0;
      t = d.task = { kind: 'farm', act: pick.act, i: pick.i, x: tx + 0.5 + this.rng.float(-0.2, 0.2), z: ty + 0.5 + this.rng.float(-0.2, 0.2), phase: 'go', t: 0 };
      this._reserve(pick.i, u, 40);
    }
    if (t.phase === 'go') {
      const r = this._go(u, t.x, t.z, 0.3);
      if (r === FAIL) {
        this._release(t.i, u);
        d.task = null;
        return;
      }
      if (r !== ARRIVED) return;
      t.phase = 'work';
      const sp = this._workMul(u, v);
      t.t = (t.act === 'harvest' ? 6 : t.act === 'till' ? 6 : t.act === 'chop' ? 8 : t.act === 'tend' ? 8 : 5) / sp;
    }
    const anim = t.act === 'harvest' || t.act === 'tend' ? 'harvest' : t.act === 'chop' ? 'chop' : 'dig';
    this._work(u, anim, t.x + Math.sin(u.id) * 0.3, t.z + Math.cos(u.id) * 0.3);
    t.t -= dt;
    if (t.t > 0) {
      if (t.act === 'till' && this.rng.chance(0.2)) this._fx('dust', t.x, t.z, 0.35);
      return;
    }
    const i = t.i,
      tx = i % w.w,
      ty = (i / w.w) | 0;
    const f = w.flora[i];
    switch (t.act) {
      case 'harvest':
        if (f === FLORA.WHEAT && w.floraGrowth[i] >= 0.98) {
          // reap and resow in one pass, except at the year's end: the last
          // harvest of autumn leaves the field to lie fallow through winter
          const se = this.game.time.season ?? 1.5;
          if (se >= 2.7) w.setFlora(tx, ty, FLORA.NONE);
          else w.setFlora(tx, ty, FLORA.WHEAT, 0.05);
          let y = 5 * (1 + ((this._easedMods?.().fertility ?? this.game.age?.mods?.fertility ?? 1) - 1) * 0.5) * this.techMod(v.kingdom, 'harvest');
          if (v.hasWindmill) y += 2;
          if (this.game.time.total < (this.kingdoms[v.kingdom]?.goldenUntil || 0)) y += 1;
          y *= this.game.units.traitMod?.(u, 'work') ?? 1;
          u.carry = { type: 'food', amount: (u.carry?.amount || 0) + Math.round(y) };
          this._xp(u, 1.2);
        }
        break;
      case 'chop':
        if (FLORA_INFO[f]?.isTree) {
          w.setFlora(tx, ty, FLORA.NONE);
          v.wood += Math.max(1, FLORA_INFO[f].wood >> 1);
        }
        break;
      case 'till':
        if (this.use[i] === USE.PLOT) {
          if (f) w.setFlora(tx, ty, FLORA.NONE);
          w.setType(tx, ty, TILE.FARMLAND);
          this.fieldVersion++;
        }
        break;
      case 'plant':
        if (this.use[i] === USE.PLOT && w.type[i] === TILE.FARMLAND && (f === FLORA.NONE || !FLORA_INFO[f].isTree)) w.setFlora(tx, ty, FLORA.WHEAT, 0.04);
        break;
      case 'tend':
        if (f === FLORA.WHEAT) {
          w.floraGrowth[i] = Math.min(1, w.floraGrowth[i] + 0.08);
          w.markDirty('flora', tx, ty);
        }
        break;
    }
    this._release(i, u);
    d.task = null;
    this._idle(u);
  },

  _pickFieldTile(u, v) {
    const w = this.world;
    let best = null,
      bs = Infinity;
    for (const p of v.plots) {
      for (const i of p.tiles) {
        if (this._reservedByOther(i, u)) continue;
        const f = w.flora[i];
        let act = null,
          pri = 0;
        if (w.type[i] !== TILE.FARMLAND) {
          if (FLORA_INFO[f]?.isTree) {
            act = 'chop';
            pri = 2;
          } else {
            act = 'till';
            pri = 3;
          }
        } else if (f === FLORA.WHEAT) {
          if (w.floraGrowth[i] >= 0.98) {
            act = 'harvest';
            pri = 0;
          } else continue;
        } else if (f === FLORA.NONE || !FLORA_INFO[f].isTree) {
          const se = this.game.time.season ?? 1.5;
          if (se >= 2.85 && se < 3.92) continue; // no sowing from late autumn until the thaw
          act = 'plant';
          pri = 1;
        } else {
          act = 'chop';
          pri = 2;
        }
        const x = i % w.w,
          y = (i / w.w) | 0;
        const dd = Math.hypot(x + 0.5 - u.x, y + 0.5 - u.z);
        const s = pri * 30 + dd;
        if (s < bs) {
          bs = s;
          best = { i, act };
        }
      }
    }
    return best;
  },

  _forage(u, v, d, dt) {
    const w = this.world;
    // tend a growing crop (farmers stay inside their fences)
    if (v.plots.length) {
      const p = v.plots[(this.rng.next() * v.plots.length) | 0];
      const i = p.tiles[(this.rng.next() * p.tiles.length) | 0];
      if (i != null && w.flora[i] === FLORA.WHEAT && w.floraGrowth[i] < 0.98 && !this._reservedByOther(i, u)) {
        const tx = i % w.w,
          ty = (i / w.w) | 0;
        d.task = { kind: 'farm', act: 'tend', i, x: tx + 0.5, z: ty + 0.5, phase: 'go', t: 0 };
        this._reserve(i, u, 20);
        return;
      }
      if (v.fieldCount >= 8) return this._jobIdle(u, v, d, dt);
    }
    // berries
    const cx = Math.floor(v.cx),
      cy = Math.floor(v.cz);
    const n = spiralCount(Math.min(26, v.buildRadius + 10));
    for (let k = 0; k < n; k += 2) {
      const [dx, dy] = SPIRAL[k];
      const x = cx + dx,
        y = cy + dy;
      if (!w.inBounds(x, y)) continue;
      const i = y * w.w + x;
      if (w.flora[i] !== FLORA.BERRY_BUSH || w.floraGrowth[i] < 0.9 || this._reservedByOther(i, u)) continue;
      d.task = { kind: 'berry', i, x: x + 0.5, z: y + 0.5 + 0.45, phase: 'go', t: 0 };
      this._reserve(i, u, 30);
      break;
    }
    const t = d.task;
    if (!t || t.kind !== 'berry') return this._jobIdle(u, v, d, dt);
    if (t.phase === 'go') {
      const r = this._go(u, t.x, t.z, 0.35);
      if (r === FAIL) {
        this._release(t.i, u);
        d.task = null;
        return;
      }
      if (r !== ARRIVED) return;
      t.phase = 'work';
      t.t = 2.5;
    }
    this._work(u, 'harvest', t.x, t.z - 0.45);
    t.t -= dt;
    if (t.t > 0) return;
    if (w.flora[t.i] === FLORA.BERRY_BUSH) {
      w.floraGrowth[t.i] = 0.2;
      w.markDirty('flora', t.i % w.w, (t.i / w.w) | 0);
      u.carry = { type: 'food', amount: (u.carry?.amount || 0) + 3 };
    }
    this._release(t.i, u);
    d.task = null;
  },

  _jobBuild(u, v, d, dt) {
    if (u.carry) return this._deposit(u, v, d);
    let t = d.task;
    let b = t && t.kind === 'build' ? this._bById.get(t.b) : null;
    if (!b || !b.alive || !this._needsWork(b)) {
      b = this._pickSite(u, v);
      if (!b) {
        // no site: mend roofs and walls of the nearest standing building
        let t2 = d.task;
        if (!t2 || t2.kind !== 'upkeep') {
          let near = null,
            nd = Infinity;
          for (const o of v.buildings) {
            if (!o.alive || o.constructing) continue;
            const dd = Math.hypot(o.x - u.x, o.z - u.z) + this.rng.next() * 4;
            if (dd < nd) {
              nd = dd;
              near = o;
            }
          }
          if (!near) return this._jobIdle(u, v, d, dt);
          const spot = this._workSpot(near, u);
          t2 = d.task = { kind: 'upkeep', b: near.id, x: spot[0], z: spot[1], phase: 'go', t: 0, bx: near.x, bz: near.z };
        }
        if (t2.phase === 'go') {
          const r = this._go(u, t2.x, t2.z, 0.45);
          if (r === FAIL) d.task = null;
          if (r !== ARRIVED) return;
          t2.phase = 'work';
          t2.t = 12 + this.rng.next() * 10;
        }
        this._work(u, 'hammer', t2.bx, t2.bz);
        t2.t -= dt;
        if (t2.t <= 0) d.task = null;
        return;
      }
      const spot = this._workSpot(b, u);
      t = d.task = { kind: 'build', b: b.id, x: spot[0], z: spot[1], phase: 'go', t: 0 };
    }
    if (t.phase === 'go') {
      const r = this._go(u, t.x, t.z, 0.45);
      if (r === FAIL) {
        // try another side next time
        t.fails = (t.fails || 0) + 1;
        if (t.fails > 2) {
          d.task = null;
          b.unreachable = (b.unreachable || 0) + 1;
          return;
        }
        const spot = this._workSpot(b, u, t.fails);
        t.x = spot[0];
        t.z = spot[1];
        return;
      }
      if (r !== ARRIVED) return;
      t.phase = 'work';
      t.t = 2;
    }
    const fire = b.burning > 0.05;
    this._work(u, fire ? 'harvest' : 'hammer', b.x, b.z);
    b.lastWorked = this.game.time.total;
    t.t -= dt;
    if (t.t > 0) return;
    t.t = 2;
    const sp = this._workMul(u, v) * this.techMod(v.kingdom, 'build') * (this.hasCultureTrait(v.culture, 'Masons') ? 1.2 : 1);
    const def = BUILDING_TYPES[b.type];
    this._xp(u, 0.45);
    if (fire) {
      b.burning = Math.max(0, b.burning - (v.hasWell ? 0.22 : 0.14));
      this._fx('steam', b.x, b.z, 0.6);
    } else if (b.constructing) {
      const bt = def.buildTime[(b.level || 1) - 1] || 20;
      b.progress = Math.min(1, b.progress + (2 * sp) / bt);
      b.hp = Math.max(b.hp, b.maxHp * (0.3 + 0.7 * b.progress));
      this._fx('build', b.x + this.rng.float(-0.5, 0.5), b.z + this.rng.float(-0.5, 0.5), 0.7);
      this._sfx('build', b.x, b.z, 0.5);
      if (b.progress >= 1) this._finishBuilding(b);
    } else if (b.upgrading) {
      const bt = def.buildTime[Math.min(def.levels, b.level + 1) - 1] || 25;
      b.upgradeProgress = Math.min(1, b.upgradeProgress + (2 * sp) / bt);
      this._fx('build', b.x + this.rng.float(-0.5, 0.5), b.z + this.rng.float(-0.5, 0.5), 0.7);
      if (b.upgradeProgress >= 1) this._finishUpgrade(b);
    } else if (b.hp < b.maxHp) {
      b.hp = Math.min(b.maxHp, b.hp + 10 * sp);
    }
    this.stateVersion++;
  },

  _needsWork(b) {
    return b.constructing || b.upgrading || b.burning > 0.05 || b.hp < b.maxHp * 0.85;
  },

  _pickSite(u, v) {
    let best = null,
      bs = Infinity;
    for (const b of v.buildings) {
      if (!b.alive || !this._needsWork(b)) continue;
      if ((b.unreachable || 0) > 6) continue;
      const crew = b._crew || 0;
      const cap = b.burning > 0.05 ? 6 : BUILDING_TYPES[b.type].wall ? 1 : b.type === 'hall' ? 4 : 3;
      if (crew >= cap && !(d0(u, b) < 2)) continue;
      let s = Math.hypot(b.x - u.x, b.z - u.z) + crew * 6;
      if (b.burning > 0.05) s -= 40;
      if (b.type === 'house') s -= 4;
      if (b.type === 'hall') s -= 8;
      if (s < bs) {
        bs = s;
        best = b;
      }
    }
    if (best) best._crew = (best._crew || 0) + 1;
    return best;
  },

  _workSpot(b, u, k = 0) {
    const w = this.world;
    const hw = b.w / 2 + 0.35,
      hh = b.h / 2 + 0.35;
    const opts = [];
    const n = 8;
    for (let j = 0; j < n; j++) {
      const a = ((u.id * 2.39 + j + k * 3) % n) / n * Math.PI * 2;
      let x = b.x + Math.cos(a) * hw * 1.3,
        z = b.z + Math.sin(a) * hh * 1.3;
      x = Math.max(b.x - hw, Math.min(b.x + hw, x));
      z = Math.max(b.z - hh, Math.min(b.z + hh, z));
      const ix = Math.floor(x),
        iz = Math.floor(z);
      if (!w.isWalkable(ix, iz)) continue;
      if (this.use[iz * w.w + ix] === USE.BUILDING && w.building[iz * w.w + ix] !== b.id) continue;
      opts.push([x, z]);
    }
    if (!opts.length) return [b.doorX, b.doorZ];
    return opts[0];
  },

  _jobMine(u, v, d, dt) {
    const w = this.world;
    if (u.carry && (u.carry.type === 'wood' || u.carry.type === 'food' || (u.carry.type === 'ore' && u.carry.amount >= 3))) return this._deposit(u, v, d);
    if (u.carry && u.carry.amount >= CARRY_MAX.stone) return this._deposit(u, v, d);
    let t = d.task;
    if (!t || t.kind !== 'mine') {
      const r = this._findRock(u, v) || this._quarry(u, v);
      if (!r) {
        if (u.carry) return this._deposit(u, v, d);
        return this._jobIdle(u, v, d, dt);
      }
      t = d.task = { kind: 'mine', ...r, phase: 'go', t: 0 };
      this._reserve(r.i, u, 60);
    }
    if (t.phase === 'go') {
      const r = this._go(u, t.x, t.z, 0.4);
      if (r === FAIL) {
        this._release(t.i, u);
        this.reservedBy[t.i] = -1;
        this.reservedT[t.i] = this.game.time.total + 60;
        d.task = null;
        return;
      }
      if (r !== ARRIVED) return;
      t.phase = 'work';
      t.t = 14 / this._workMul(u, v);
    }
    this._work(u, 'dig', t.cx, t.cz);
    t.t -= dt;
    if (t.t > 0) {
      if (this.rng.chance(0.2)) this._fx('dust', t.cx, t.cz, 0.4);
      if (this.rng.chance(0.5)) this._sfx('mine', t.cx, t.cz, 0.6);
      return;
    }
    const i = t.i,
      tx = i % w.w,
      ty = (i / w.w) | 0;
    const f = w.flora[i];
    let stone = 0,
      gold = 0;
    if (f === FLORA.BOULDER) {
      stone = 3;
      const hits = (this.rockHits.get(i) || 0) + 1;
      this.rockHits.set(i, hits);
      if (hits >= 4) {
        w.setFlora(tx, ty, FLORA.ROCK_SMALL, 1);
        this.rockHits.delete(i);
      }
      if (this.rng.chance(0.04)) gold = 1;
    } else if (f === FLORA.ROCK_SMALL) {
      stone = 2;
      const hits = (this.rockHits.get(i) || 0) + 1;
      this.rockHits.set(i, hits);
      if (hits >= 2) {
        w.setFlora(tx, ty, FLORA.NONE);
        this.rockHits.delete(i);
      }
    } else if (w.type[i] === TILE.ROCK) {
      stone = 3;
      if (this.rng.chance(0.08)) gold = 1;
    }
    this._release(i, u);
    d.task = null;
    stone = Math.round(stone * this.techMod(v.kingdom, 'stone') * (this.game.units.traitMod?.(u, 'work') ?? 1));
    this._xp(u, 1.5);
    const ore = !gold && stone && this.rng.chance(f === FLORA.BOULDER || w.type[i] === TILE.ROCK ? 0.38 : v.quarry === i || this.use[i] === USE.QUARRY ? 0.25 : 0.14);
    if (u.carry?.type === 'ore') {
      // already hauling ore: stone goes straight on the pile, more ore into the sack
      v.stone += stone;
      if (ore) u.carry.amount++;
      return;
    }
    if (ore) {
      if (u.carry?.type === 'stone') v.stone += u.carry.amount;
      u.carry = { type: 'ore', amount: 1 };
      return;
    }
    if (gold) u.carry = { type: 'gold', amount: gold };
    else if (stone) u.carry = { type: 'stone', amount: Math.min(CARRY_MAX.stone, (u.carry?.type === 'stone' ? u.carry.amount : 0) + stone) };
  },

  _findRock(u, v, near = -1) {
    const w = this.world;
    const W = w.w;
    const cx = near >= 0 ? near % W : Math.floor(v.cx),
      cy = near >= 0 ? (near / W) | 0 : Math.floor(v.cz);
    const n = spiralCount(near >= 0 ? 3 : Math.min(30, v.buildRadius + 16));
    for (let k = 0; k < n; k++) {
      const [dx, dy] = SPIRAL[k];
      const x = cx + dx,
        y = cy + dy;
      if (x < 1 || y < 1 || x >= W - 1 || y >= w.h - 1) continue;
      const i = y * W + x;
      const f = w.flora[i];
      const isRock = f === FLORA.BOULDER || f === FLORA.ROCK_SMALL;
      const face = !isRock && w.type[i] === TILE.ROCK && w.height[i] >= SEA_LEVEL;
      if (!isRock && !face) continue;
      if (this._reservedByOther(i, u)) continue;
      if (w.owner[i] >= 0 && w.owner[i] !== v.kingdom) continue;
      // stand on a walkable neighbour
      let sx = -1,
        sy = -1;
      if (f === FLORA.ROCK_SMALL && w.isWalkable(x, y)) {
        sx = x;
        sy = y;
      } else {
        for (const [ox, oy] of ROT_DIR) {
          if (w.isWalkable(x + ox, y + oy) && w.type[(y + oy) * W + x + ox] !== TILE.ROCK) {
            sx = x + ox;
            sy = y + oy;
            break;
          }
        }
        if (sx < 0)
          for (const [ox, oy] of ROT_DIR)
            if (w.isWalkable(x + ox, y + oy)) {
              sx = x + ox;
              sy = y + oy;
              break;
            }
      }
      if (sx < 0) continue;
      const px = sx + 0.5 + (x - sx) * 0.35,
        pz = sy + 0.5 + (y - sy) * 0.35;
      return { i, x: px, z: pz, cx: x + 0.5, cz: y + 0.5 };
    }
    return null;
  },

  // No loose stone nearby: open a quarry pit on the outskirts.
  _quarry(u, v) {
    const w = this.world;
    const W = w.w;
    if (v.quarry == null) {
      const cx = Math.floor(v.cx),
        cy = Math.floor(v.cz);
      const n = spiralCount(Math.min(30, v.buildRadius + 9));
      let best = -1,
        bs = -Infinity;
      for (let k = 0; k < n; k += 3) {
        const [dx, dy, dd] = SPIRAL[k];
        if (dd < v.buildRadius * 0.8) continue;
        const x = cx + dx,
          y = cy + dy;
        if (x < 3 || y < 3 || x >= W - 4 || y >= w.h - 4) continue;
        let ok = true;
        for (let oy = 0; oy < 2 && ok; oy++)
          for (let ox = 0; ox < 2; ox++) {
            const i = (y + oy) * W + x + ox;
            if (!this._tileFree(i, false) || w.type[i] === TILE.FARMLAND || w.height[i] < SEA_LEVEL + 0.3) ok = false;
          }
        if (!ok) continue;
        const s = w.height[y * W + x] * 0.6 + w.slopeAt(x, y) * 2 - dd * 0.3 + this.rng.next();
        if (s > bs) {
          bs = s;
          best = y * W + x;
        }
      }
      if (best < 0) {
        v.quarry = -1;
        return null;
      }
      v.quarry = best;
      const x = best % W,
        y = (best / W) | 0;
      for (let oy = 0; oy < 2; oy++)
        for (let ox = 0; ox < 2; ox++) {
          const i = (y + oy) * W + x + ox;
          this.use[i] = USE.QUARRY;
          if (w.flora[i]) w.setFlora(x + ox, y + oy, FLORA.NONE);
          w.setType(x + ox, y + oy, TILE.ROCK);
          if ((ox + oy) % 2 === 0) w.setFlora(x + ox, y + oy, FLORA.ROCK_SMALL, 1);
        }
      this.fieldVersion++;
    }
    if (v.quarry < 0) return null;
    return this._findRock(u, v, v.quarry);
  },

  _jobFish(u, v, d, dt) {
    const w = this.world;
    if (u.carry && (u.carry.type !== 'food' || u.carry.amount >= 20)) return this._deposit(u, v, d);
    let t = d.task;
    if (!t || t.kind !== 'fish') {
      const docks = v.buildings.filter((b) => b.alive && b.type === 'docks' && !b.constructing);
      if (docks.length) {
        const b = docks[u.id % docks.length];
        const [fx, fz] = ROT_DIR[b.rot];
        const side = ((u.id >> 1) % 2 ? 1 : -1) * 0.4;
        t = d.task = { kind: 'fish', x: b.x + fx * 0.75 + fz * side, z: b.z + fz * 0.75 + fx * side, fx: b.x + fx * 3, fz: b.z + fz * 3, phase: 'go', t: 0, dock: true };
      } else {
        const spot = this._findShore(u, v);
        if (!spot) {
          u.job = null;
          return this._jobIdle(u, v, d, dt);
        }
        t = d.task = { kind: 'fish', ...spot, phase: 'go', t: 0, dock: false };
      }
    }
    if (t.phase === 'go') {
      const r = this._go(u, t.x, t.z, 0.4);
      if (r === FAIL) {
        d.task = null;
        return;
      }
      if (r !== ARRIVED) return;
      t.phase = 'work';
      t.t = (t.dock ? 14 : 16) / this._workMul(u, v);
    }
    this._work(u, 'harvest', t.fx, t.fz);
    t.t -= dt;
    if (t.t > 0) {
      if (this.rng.chance(0.06)) this._fx('splash', t.fx, t.fz, 0.3);
      return;
    }
    u.carry = { type: 'food', amount: (u.carry?.amount || 0) + Math.round((t.dock ? 5 : 3) * this.techMod(v.kingdom, 'fish') * (this.game.units.traitMod?.(u, 'work') ?? 1)) };
    this._xp(u, 1.5);
    d.task = null;
  },

  _findShore(u, v) {
    const w = this.world;
    const W = w.w;
    const cx = Math.floor(v.cx),
      cy = Math.floor(v.cz);
    const n = spiralCount(18);
    const start = (u.id * 7) % 20;
    for (let k = start; k < n; k++) {
      const [dx, dy] = SPIRAL[k];
      const x = cx + dx,
        y = cy + dy;
      if (!w.isWalkable(x, y)) continue;
      if (this.use[y * W + x] === USE.BUILDING) continue;
      for (const [ox, oy] of ROT_DIR) {
        if (w.inBounds(x + ox, y + oy) && w.height[(y + oy) * W + x + ox] < SEA_LEVEL - 0.2) {
          return { x: x + 0.5 + ox * 0.3, z: y + 0.5 + oy * 0.3, fx: x + 0.5 + ox * 2, fz: y + 0.5 + oy * 2 };
        }
      }
    }
    return null;
  },

  _jobSoldier(u, v, d, dt) {
    const g = this.game;
    const now = g.time.total;
    const army = this.armyOf(u);
    const sight = army ? 9 : 8;
    // enemies first
    if ((d.scanT = (d.scanT || 0) - dt) <= 0) {
      d.scanT = 0.9;
      let foe = g.units.nearest(u.x, u.z, sight, (o) => o.species === 'human' && o.job === 'soldier' && this.hostileTo(u, o));
      if (!foe && (army?.state === 'siege' || this._inOwnTerritory(u)))
        foe = g.units.nearest(u.x, u.z, army ? 6 : sight, (o) => this.hostileTo(u, o) && (o.species === 'human' || this._inOwnTerritory(o)));
      d.foe = foe ? foe.id : null;
    }
    if (d.foe != null) {
      const foe = g.units.byId.get(d.foe);
      if (foe && foe.alive && Math.hypot(foe.x - u.x, foe.z - u.z) < sight + 3) return this._fight(u, d, foe, now);
      d.foe = null;
      d.engaged = null;
    }
    if (army) return this._armyOrders(u, v, d, dt, army);
    // an enemy army bears down on us: form a shield line before the hall
    const threat = this._threatTo(v);
    if (threat) {
      const c = this._armyCentre(threat);
      const hx = v.hall ? v.hall.x : v.cx,
        hz = v.hall ? v.hall.z : v.cz;
      const dx = c.x - hx,
        dz = c.z - hz;
      const L = Math.hypot(dx, dz) || 1;
      const ux = dx / L,
        uz = dz / L;
      const rank = d.lineRank ?? (d.lineRank = (u.id * 7) % 11);
      const off = (rank % 2 ? 1 : -1) * Math.ceil(rank / 2) * 0.7;
      const row = rank > 8 ? 1 : 0;
      const dx0 = v.hall ? v.hall.doorX : hx,
        dz0 = v.hall ? v.hall.doorZ : hz;
      const sx = dx0 + ux * (1.4 - row * 0.7) - uz * off,
        sz = dz0 + uz * (1.4 - row * 0.7) + ux * off;
      const r = this._go(u, sx, sz, 0.5);
      if (r === ARRIVED) {
        this._idle(u);
        u.heading = Math.atan2(ux, uz);
      }
      return;
    }
    // patrol
    let t = d.task;
    if (!t || t.kind !== 'patrol') {
      const towers = v.buildings.filter((b) => b.alive && !b.constructing && (b.type === 'watchtower' || b.type === 'tower' || b.type === 'gate' || b.type === 'barracks'));
      let x, z;
      if (towers.length && this.rng.chance(0.5)) {
        const b = towers[(this.rng.next() * towers.length) | 0];
        x = b.doorX + this.rng.float(-0.6, 0.6);
        z = b.doorZ + this.rng.float(-0.6, 0.6);
      } else if (this.rng.chance(0.75) && v.hall) {
        x = v.hall.doorX + this.rng.float(-2.5, 2.5);
        z = v.hall.doorZ + this.rng.float(-2.5, 2.5);
      } else {
        const a = this.rng.float(0, Math.PI * 2),
          r = v.radius * this.rng.float(0.35, 0.75);
        x = v.cx + Math.cos(a) * r;
        z = v.cz + Math.sin(a) * r;
      }
      t = d.task = { kind: 'patrol', x, z, phase: 'go', t: 0 };
    }
    if (t.phase === 'go') {
      const r = this._go(u, t.x, t.z, 0.6);
      if (r === FAIL) d.task = null;
      if (r !== ARRIVED) return;
      t.phase = 'wait';
      t.t = 20 + this.rng.next() * 25;
      t.drill = this.rng.chance(0.85);
    }
    if (t.drill) this._work(u, 'chop', u.x + Math.sin(u.id), u.z + Math.cos(u.id));
    else this._idle(u);
    t.t -= dt;
    if (t.t <= 0) d.task = null;
  },

  _threatTo(v) {
    for (const a of this.armies) {
      if (a.dead || a.target !== v.id || a.state === 'gather') continue;
      const c = this._armyCentre(a);
      if (Math.hypot(c.x - v.cx, c.z - v.cz) < v.radius + 18) return a;
    }
    return null;
  },

  _inOwnTerritory(o) {
    const w = this.world;
    const i = Math.floor(o.z) * w.w + Math.floor(o.x);
    return i >= 0 && i < w.size && w.owner[i] >= 0;
  },

  _fight(u, d, foe, now) {
    const g = this.game;
    const dx = foe.x - u.x,
      dz = foe.z - u.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const canEngage = typeof g.units.engage === 'function' && !(d.noEngage > now);
    if (canEngage) {
      if (d.engaged !== foe.id) {
        let res;
        try {
          res = g.units.engage(u, foe);
        } catch (e) {
          res = false;
        }
        if (res === false) d.noEngage = now + 20;
        else {
          d.engaged = foe.id;
          d.engT = now;
          d.engHp = foe.hp;
          d.engDist = dist;
          return;
        }
      } else {
        if (now - d.engT > 5) {
          // stalled? fall back to our own melee for a while
          if (foe.hp >= d.engHp - 0.01 && dist >= d.engDist - 0.3 && u.state !== 'attack') d.noEngage = now + 20;
          d.engT = now;
          d.engHp = foe.hp;
          d.engDist = dist;
        }
        if (!(d.noEngage > now)) return;
      }
    }
    const range = (u.def.attackRange || 0.8) + 0.15;
    if (dist > range) {
      u.state = 'run';
      u.path = null;
      u.data.workAnim = null;
      u.target = { x: foe.x - (dx / dist) * 0.45, z: foe.z - (dz / dist) * 0.45 };
      return;
    }
    u.state = 'attack';
    u.target = null;
    u.path = null;
    u.heading = Math.atan2(dx, dz);
    if (u.attackCd <= 0) {
      const v = this.villages[u.village];
      const dmg = (u.data.civ.power || u.def.damage || 4) * (v?.hasForge ? 1.25 : 1) * (0.8 + this.rng.next() * 0.4);
      g.units.damage(foe, dmg, u);
      u.attackCd = u.def.attackCooldown || 1.2;
      this._fx('blood', foe.x, foe.z, 0.5);
      this._fx('sparks', (foe.x + u.x) / 2, (foe.z + u.z) / 2, 0.5);
      if (!foe.alive) {
        d.foe = null;
        d.engaged = null;
      }
    }
  },

  _armyOrders(u, v, d, dt, army) {
    const now = this.game.time.total;
    const idx = (u.id * 7) % 23;
    const ang = idx * 2.39996;
    const rad = 1.2 + (idx % 5) * 0.55;
    if (army.state === 'gather') {
      const x = army.rally.x + Math.cos(ang) * rad,
        z = army.rally.z + Math.sin(ang) * rad;
      const r = this._go(u, x, z, 0.7, true);
      if (r === ARRIVED) this._idle(u);
      return;
    }
    const tv = this.villages[army.target];
    if (!tv) return;
    if (army.state === 'march') {
      const bearer = this.game.units.byId.get(army.bearer);
      if (!bearer || !bearer.alive || bearer === u) {
        // the standard-bearer leads the column straight for the enemy hall
        const r = this._go(u, tv.cx + 1.5, tv.cz + 1.5, 2.5, true);
        if (r === FAIL) {
          d.armyFail = (d.armyFail || 0) + 1;
          if (d.armyFail > 3) {
            army.units.delete(u);
            d.army = null;
          }
        }
        if (r === ARRIVED) this._idle(u);
        if (this.rng.chance(0.35)) this._fx('dust', u.x, u.z, 0.9);
        return;
      }
      // everyone else falls in behind in ranks of three, deploying into a
      // wide battle line once the enemy is close
      const rank = d.rank ?? (d.rank = [...army.units].indexOf(u));
      const near = Math.hypot(bearer.x - tv.cx, bearer.z - tv.cz) < tv.radius + 10;
      const per = near ? 6 : 3;
      const row = (near ? 0 : 1) + Math.floor(rank / per),
        col = (rank % per) - (per - 1) / 2;
      let hx = Math.sin(bearer.heading),
        hz = Math.cos(bearer.heading);
      if (near) {
        const L = Math.hypot(tv.cx - bearer.x, tv.cz - bearer.z) || 1;
        hx = (tv.cx - bearer.x) / L;
        hz = (tv.cz - bearer.z) / L;
      }
      const sx = bearer.x - hx * row * 0.8 + hz * col * 0.7,
        sz = bearer.z - hz * row * 0.8 - hx * col * 0.7;
      const far = Math.hypot(sx - u.x, sz - u.z);
      if (far > 7) this._go(u, sx, sz, 1.0, true);
      else if (far > 0.25) {
        u.path = null;
        u.target = { x: sx, z: sz };
        u.state = far > 2 ? 'run' : 'walk';
        d.gx = null;
      } else this._idle(u);
      if (this.rng.chance(0.12)) this._fx('dust', u.x, u.z, 0.7);
      void ang;
      void rad;
      return;
    }
    // siege: strike the nearest enemy building (hall first when close)
    let t = d.task;
    let b = t && t.kind === 'siege' ? this._bById.get(t.b) : null;
    if (!b || !b.alive || b.kingdom === u.kingdom) {
      b = null;
      let bd = Infinity;
      const breach = (d.breachUntil || 0) > now;
      for (const o of tv.buildings) {
        if (!o.alive || o.kingdom === u.kingdom) continue;
        let s = Math.hypot(o.x - u.x, o.z - u.z);
        if (breach) s -= BUILDING_TYPES[o.type].wall ? 40 : 0; // no way in: batter the wall
        else if (o.type === 'hall') s -= 60;
        if (s < bd) {
          bd = s;
          b = o;
        }
      }
      if (!b) return this._idle(u);
      const spot = this._workSpot(b, u);
      t = d.task = { kind: 'siege', b: b.id, x: spot[0], z: spot[1], phase: 'go', t: 0 };
    }
    if (t.phase === 'go') {
      const r = this._go(u, t.x, t.z, 0.6, true);
      if (r === FAIL) {
        d.task = null;
        d.breachUntil = now + 25;
        return;
      }
      if (r !== ARRIVED) return;
      t.phase = 'hit';
      t.t = 0;
    }
    this._work(u, 'hammer', b.x, b.z);
    u.state = 'attack';
    t.t -= dt;
    if (t.t <= 0) {
      t.t = 1.3;
      let ring = 0;
      if (b.type === 'hall') for (const o of army.units) if (Math.hypot(o.x - b.x, o.z - b.z) < Math.max(b.w, b.h) * 0.5 + 1.6) ring++;
      const mult = b.type === 'hall' ? 1 + Math.min(4, ring) * 0.6 : BUILDING_TYPES[b.type].wall ? 1.6 : 1;
      this.damageBuilding(b, (6 + this.rng.next() * 4) * mult, 'siege');
      b.besieged = this.game.time.total;
      if (this.rng.chance(0.14)) b.burning = Math.max(b.burning, 0.45);
      this._fx('debris', b.x + this.rng.float(-0.5, 0.5), b.z + this.rng.float(-0.5, 0.5), 0.4);
      if (this.rng.chance(0.4)) this._fx('sparks', (u.x + b.x) / 2, (u.z + b.z) / 2, 0.6);
    }
  },

  _flee(u, v, d, t) {
    const hall = v.hall;
    let x, z;
    const dxh = hall ? hall.doorX - t.x : 0,
      dzh = hall ? hall.doorZ - t.z : 0;
    if (hall && hall.alive && Math.hypot(dxh, dzh) > 6) {
      x = hall.doorX;
      z = hall.doorZ;
    } else {
      const ax = u.x - t.x,
        az = u.z - t.z;
      const l = Math.hypot(ax, az) || 1;
      x = u.x + (ax / l) * 7;
      z = u.z + (az / l) * 7;
    }
    u.state = 'run';
    d.task = null;
    if (!u.target || this.rng.chance(0.3)) {
      const w = this.world;
      const ix = Math.floor(x),
        iz = Math.floor(z);
      if (w.isWalkable(ix, iz)) {
        u.path = null;
        u.target = { x, z };
      } else this._pathTo(u, x, z);
    }
    u.state = 'run';
  },

  _jobKing(u, v, d, dt) {
    const h = v.hall;
    const x = h ? h.doorX : v.cx,
      z = h ? h.doorZ : v.cz;
    // in war or famine the ruler keeps to the hall
    const danger = this.warCount(v.kingdom) > 0 || v.starving;
    if (u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + dt * 2);
    if (Math.hypot(u.x - x, u.z - z) > (danger ? 1.2 : 5)) {
      this._go(u, x, z, danger ? 0.5 : 1.0);
      return;
    }
    if (danger) return this._idle(u);
    this._wanderNear(u, x, z, 2.5, 0.08);
  },

  _jobIdle(u, v, d, dt) {
    // labourers lend a hand on building sites, otherwise mill about the square
    if (u.job == null) {
      const site = v.buildings.find((b) => b.alive && (b.constructing || b.burning > 0.1) && (b._crew || 0) < 2);
      if (site && this.rng.chance(0.5)) {
        u.job = 'builder';
        return;
      }
    }
    if (u.carry) return this._deposit(u, v, d);
    const h = v.hall;
    const x = h ? h.doorX : v.cx,
      z = h ? h.doorZ : v.cz;
    if (Math.hypot(u.x - x, u.z - z) > 9) {
      this._go(u, x, z, 2.5);
      return;
    }
    this._wanderNear(u, x, z, 3, 0.08);
  },

  _child(u, v, d, dt) {
    const home = this._bById.get(d.home);
    const x = home && home.alive ? home.doorX : v.cx,
      z = home && home.alive ? home.doorZ : v.cz;
    if (Math.hypot(u.x - x, u.z - z) > 16) {
      this._go(u, x, z, 2.5);
      return;
    }
    if (u.age >= 7) {
      let t = d.task;
      if (!t || t.kind !== 'chore') {
        const w = this.world;
        let cx = u.x + this.rng.float(-1.5, 1.5),
          cz = u.z + this.rng.float(-1.5, 1.5);
        if (v.plots.length && this.rng.chance(0.5)) {
          const pl = v.plots[(this.rng.next() * v.plots.length) | 0];
          const i = pl.tiles[(this.rng.next() * pl.tiles.length) | 0];
          if (i != null && Math.hypot((i % w.w) - u.x, ((i / w.w) | 0) - u.z) < 8) {
            cx = (i % w.w) + 0.5;
            cz = ((i / w.w) | 0) + 0.5;
          }
        }
        t = d.task = { kind: 'chore', x: cx, z: cz, phase: 'go', t: 0, anim: this.rng.chance(0.5) ? 'harvest' : 'dig' };
      }
      if (t.phase === 'go') {
        const r = this._go(u, t.x, t.z, 0.4);
        if (r === FAIL) d.task = null;
        if (r !== ARRIVED) return;
        t.phase = 'work';
        t.t = 14 + this.rng.next() * 12;
      }
      this._work(u, t.anim, t.x + 0.3, t.z + 0.3);
      t.t -= dt;
      if (t.t <= 0) d.task = null;
      return;
    }
    if (!u.target && this.rng.chance(0.05)) {
      this._wanderNear(u, x, z, 2.5, 1);
      if (u.target && this.rng.chance(0.5)) u.state = 'run';
    } else if (!u.target) u.state = 'idle';
  },

  _migrate(u, d, dt) {
    const exp = this.expeditions.find((e) => e.id === d.task.exp);
    if (!exp) {
      d.task = null;
      return;
    }
    if (exp.village != null) {
      const nv = this.villages[exp.village];
      if (nv && nv.alive) {
        this._moveMember(u, nv);
        d.task = { kind: 'arrive' };
        return;
      }
    }
    const x = exp.site.tx + 0.5,
      z = exp.site.ty + 0.5;
    const leader = exp.leader === u.id;
    const r = this._go(u, leader ? x : x + Math.sin(u.id) * 1.5, leader ? z : z + Math.cos(u.id) * 1.5, 2.5, true);
    if (r === ARRIVED || (r === FAIL && Math.hypot(u.x - x, u.z - z) < 6)) {
      this._settleExpedition(exp, u);
    } else if (r === FAIL) {
      exp.fails = (exp.fails || 0) + 1;
      if (exp.fails > 8) this._abortExpedition(exp);
    }
    if (this.game.time.total - exp.t > 400) this._abortExpedition(exp);
  },

  _homeless(u, d, dt) {
    if (u.age < ADULT_AGE) u.age += (dt / YEAR) * CHILD_AGE_RATE;
    if ((d.homelessT = (d.homelessT || 0) - dt) > 0) {
      if (!u.target) this.game.units.wander?.(u, 4);
      return;
    }
    d.homelessT = 4;
    let best = null,
      bd = Infinity;
    for (const v of this.villages) {
      if (!v.alive || v.razed) continue;
      let dd = Math.hypot(v.cx - u.x, v.cz - u.z);
      if (v.kingdom === u.kingdom) dd *= 0.5;
      if (u.kingdom >= 0 && this.atWar(u.kingdom, v.kingdom)) continue;
      if (dd < bd) {
        bd = dd;
        best = v;
      }
    }
    if (best && bd < 90) {
      this._moveMember(u, best);
      d.task = { kind: 'arrive' };
    } else if (!u.target) this.game.units.wander?.(u, 5);
  },
};

function d0(u, b) {
  return Math.hypot(u.x - b.x, u.z - b.z);
}

export { ARRIVED, WALKING, FAIL, WAIT };
