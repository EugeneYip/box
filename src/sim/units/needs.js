// Needs that bite (Life module): villagers tire through the working day and
// sleep at night in their homes (unit.data.inside: not drawn, out of the
// world's spatial queries, safe until danger or dawn), the exhausted nap where
// they stand, and in a famine the hungry go out hunting to feed their town.
// Wild herds feel the seasons through their pasture (see Units._forageTick).
//
// Village hunger itself is set by Civ's village store (meals while the store
// holds food, smaller ones while it is rationed, none in a famine); Life adds
// the tiredness, the sleep and the foraging, and LEAN TIMES: a meal fills
// less in a hard season, so hunger settles higher and reads as a pressure.
//   winter (milder with a full granary), thin stores, a blighted age, a siege
//   or a war on the realm each raise the floor a meal leaves people at, up to
//   a little under 0.6 ("Hungry" begins at 0.6, famine is Civ's empty store).
// Lean times never starve anyone on their own: below 0.7 people still heal,
// and nobody goes hungrier than 0.57 while the store holds food.

const SLEEP_GAIN = 0.009; // energy per game second asleep at home
const NAP_GAIN = 0.012; // ...asleep where they stand
const MEAT = { deer: 10, rabbit: 3, sheep: 8, cow: 14, pig: 9, chicken: 2, goat: 7 };
const LEAN_MAX = 0.45; // most a hard time adds to the fed floor (0.12)
const LEAN_EVERY = 4; // game seconds between a village's lean reckonings
export const TODDLER_AGE = 5; // under this age a child keeps to its family's house (_homeOf)

export function installNeeds(Units) {
  const P = Units.prototype;

  // How lean the times are in a village: {p: 0..LEAN_MAX, why: label|null}.
  P.leanOf = function (v) {
    if (!v || !v.alive) return null;
    const g = this.game;
    const now = g.time.total;
    const M = this._leanMap || (this._leanMap = new Map());
    let c = M.get(v.id);
    if (c && now - c.t < LEAN_EVERY && now >= c.t) return c;
    if (!c) M.set(v.id, (c = { t: 0, p: 0, why: null, v: -1 }));
    c.t = now;
    let p = 0,
      why = null,
      top = 0;
    const add = (k, label) => {
      p += k;
      if (k > top) {
        top = k;
        why = label;
      }
    };
    if (v.starving) {
      c.p = 0;
      c.why = 'famine';
      return c;
    }
    const pop = Math.max(1, v.pop || 1);
    const food = typeof v.food === 'number' ? v.food : pop * 4;
    // the granary: a year and a half of meals counts as full
    const store = Math.min(1, Math.max(0, food / (pop * 3)));
    const s = g.laws?.weatherSeasons === false ? 1.5 : (g.time.season ?? 1.5);
    // winter, and the hungry gap of early spring before the first harvest
    const wk = s >= 3 ? 1 : s >= 2.75 ? (s - 2.75) * 4 : s < 0.35 ? 1 - s / 0.35 : 0;
    if (wk > 0) add(0.22 * wk * (1 - 0.6 * store), s >= 2.75 ? 'lean winter' : 'hungry spring');
    if (store < 0.35) add(0.16 * (1 - store / 0.35), 'thin stores');
    // a blighted or barren age: harvests fail
    const fert = g.age?.mods?.fertility ?? 1;
    if (fert < 0.95) add(Math.min(0.2, 0.4 * (1 - fert)), 'failed harvests');
    // a siege at the gates (walls, halls or houses struck lately), or a war on
    if (v.buildings?.some?.((b) => b.alive && b.besieged && now - b.besieged < 25)) add(0.26, 'siege');
    else if (v.kingdom >= 0 && (g.civ?.warCount?.(v.kingdom) || 0) > 0) add(0.05, 'war rations');
    c.p = Math.min(LEAN_MAX, p);
    c.why = c.p >= 0.08 ? why : null;
    return c;
  };
  // After a meal: the hungry floor of lean times (royals eat first).
  P._leanFloor = function (u) {
    if (!this.law('lifeHunger')) return;
    const v = this.game.civ?.villages?.[u.village];
    const c = this.leanOf(v);
    if (!c || c.p <= 0) return;
    const p = u.data.civ?.royal || u.job === 'king' ? c.p * 0.35 : c.p;
    const floor = 0.12 + p;
    if (u.hunger < floor) u.hunger = Math.min(0.58, floor + ((u.id * 0.618) % 1) * 0.06);
  };
  // World-wide lean summary (tests and tools): villages by reason.
  P._leanStats = function () {
    const out = {};
    for (const v of this.game.civ?.villages || []) {
      if (!v?.alive) continue;
      const c = this.leanOf(v);
      const k = c?.why || 'fed';
      out[k] = (out[k] || 0) + 1;
    }
    return out;
  };

  // Before the village brain: returns true when tiredness or hunger took over.
  P._needsThink = function (u, now) {
    const g = this.game;
    const civ = g.civ;
    if (!civ || u.combat || u.state === 'flee' || u.data.aboard != null || u.def.kind !== 'humanoid') return false;
    // astronauts in orbit are away
    if (u._space > 0) return false;
    const d = u.data;
    // (round 21) robot workers keep the same hours as everyone: at bedtime
    // they go in to recharge (they used to work through the night, and in
    // Future realms one worker in four out in the fields, woods and mines at
    // 1 am was 8-10% of the grown-ups); by day they skip naps and famine hunts
    const robot = !!d.robot;
    // a nap where they stand, until rested enough to go on
    if (u._nap) {
      if (u.energy > 0.45 || u.combat) {
        u._nap = false;
        u.sleeping = false;
        u.state = 'idle';
        return false;
      }
      u.state = 'sleep';
      return true;
    }
    const v = civ.villages?.[u.village];
    if (!v || !v.alive) return false;
    const ride = d.ride && (d.ride.phase === 'out' || d.ride.phase === 'back');
    const army = d.civ?.army != null;
    const guard = u.job === 'soldier' && (u.id & 1) === 0; // half the soldiers keep the watch
    // settlers on the way to found a village, and newcomers walking in to
    // their new town, are not home yet: they press on (they used to turn back
    // to sleep in the town they had left, a long walk each way every night,
    // and many expeditions ran out of time and gave up)
    const travel = d.civ?.task && (d.civ.task.kind === 'migrate' || d.civ.task.kind === 'arrive');
    // emergencies keep people up past bedtime: a fire to fight (firefighters
    // and bucket brigades), and the hunters of a town in famine
    // night: home to bed at the person's bedtime (daily.js: later in summer,
    // earlier in winter and in the rain; children first); riders on the road
    // and armies on the march press on
    if (!guard && !army && !ride && !travel && !this._nightEmergency(u, now) && this._bedtime(u)) {
      if (u._dl) this._dlEnd(u);
      // (round 19) the day's load goes into the town's store at bedtime, so
      // nobody walks home through the night (or naps) with food, wood or ore
      // on the back; the Civ brain's task is dropped so it does not resume
      // the work in the small hours (the Year 600 night count was 11-22% of
      // grown-ups, mostly loads carried home or slept on)
      if (u.carry) {
        const c = u.carry;
        if (c.type === 'food') v.food = Math.min(v.foodCap ?? Infinity, (v.food || 0) + c.amount);
        else if (c.type === 'wood') v.wood = (v.wood || 0) + c.amount;
        else if (c.type === 'stone') v.stone = (v.stone || 0) + c.amount;
        else if (c.type === 'gold') v.gold = (v.gold || 0) + c.amount;
        else if (c.type === 'ore') v.ore = Math.min(80, (v.ore || 0) + c.amount);
        u.carry = null;
      }
      if (d.civ?.task && d.civ.task.kind !== 'migrate' && d.civ.task.kind !== 'arrive') d.civ.task = null;
      if (u.state === 'work') u.state = 'idle';
      // (round 29) a soldier sleeps in the barracks (docs/DAILY-LIFE.md), else
      // at home: soldiers with no house napped in the street
      const bk = u.job === 'soldier' ? this._dlPlaces?.(v)?.barracks : null;
      const b = (bk?.alive && bk.doorX != null && bk) || this._homeOf(u, v);
      if (!b) return this._nap0(u);
      const dx = b.doorX - u.x,
        dz = b.doorZ - u.z;
      const dd = dx * dx + dz * dz;
      if (dd > 0.8) {
        if (!u.target || Math.abs(u.target.x - b.doorX) + Math.abs(u.target.z - b.doorZ) > 0.6) {
          // one walk home a night: a path that fell short of the door (a
          // crowded lane, a blocked doorstep) is not searched again and again;
          // close by they slip in anyway, further off they sleep where they are
          if (now - u._homeT < 30) {
            if (!u.target) {
              if (dd < 6) {
                this._goInside(u, b);
                return true;
              }
              return this._nap0(u);
            }
            // else: still on the way along a path that ends short of the door
          } else {
            u._homeT = now;
            if (!this.moveTo(u, b.doorX, b.doorZ)) return this._nap0(u);
          }
        }
        if (u.state !== 'run') u.state = 'walk';
        u.data.workAnim = null;
        return true;
      }
      this._goInside(u, b);
      return true;
    }
    if (robot) return false;
    // worn out by day: a nap on the spot
    if (u.energy < 0.07 && !guard && !army) return this._nap0(u);
    // famine: the hungry go hunting to feed their town
    // (two hunters per town per half minute, and never the last of a herd)
    if (v.starving && u.hunger > 0.55 && u.age >= u.def.maturity && u.job !== 'king' && !d.civ?.royal && (v._hunters?.t !== ((now / 30) | 0) ? true : v._hunters.n < 2)) {
      let herd = 0,
        prey = null,
        bd = Infinity;
      this.forEachNear(u.x, u.z, 18, (o, d2) => {
        if (o.def.kind !== 'animal' || o.def.diet !== 'herbivore' || o.data.tended != null) return;
        herd++;
        if (d2 < bd) {
          bd = d2;
          prey = o;
        }
      });
      if (prey && herd >= 4 && this.engage(u, prey, { hunt: true, maxTime: 20 })) {
        if (v._hunters?.t !== ((now / 30) | 0)) v._hunters = { t: (now / 30) | 0, n: 0 };
        v._hunters.n++;
        u._forager = v.id;
        if (!u._foraged) {
          u._foraged = true;
          this.log(u, `Went hunting to feed ${v.name} in the famine`);
        }
        return true;
      }
    }
    return false;
  };
  // An emergency that keeps a person up and at it past bedtime: a fire they
  // are fighting (a firefighter's run, a bucket brigade), or a famine hunt.
  P._nightEmergency = function (u, now) {
    if (u._brigade > now) return true;
    const d = u.data;
    if (d.role === 'firefighter' && d.ff && (d.ff.i >= 0 || d.ff.b)) return true;
    if (u._forager != null && u.combat) return true;
    return false;
  };
  P._nap0 = function (u) {
    this.stop(u);
    u._nap = true;
    u.sleeping = true;
    u.state = 'sleep';
    u.data.workAnim = null;
    return true;
  };
  // A home to sleep in: a house of their town (spread by id), else the hall.
  // (round 35) A toddler's home is its family's house, the one the Civ brain
  // keeps it near: the two were different houses, and toddlers spent a
  // quarter of the day "Toddling home" between them.
  P._homeOf = function (u, v) {
    if (u.age < TODDLER_AGE) {
      const f = this.game.civ?._bById?.get(u.data?.civ?.home);
      if (f && f.alive && !f.constructing && f.village === v.id && f.doorX != null) {
        u._homeB = f.id;
        return f;
      }
    }
    let b = u._homeB != null ? this.game.civ._bById?.get(u._homeB) : null;
    if (b && b.alive && !b.constructing && b.village === v.id) return b;
    const homes = [];
    for (const o of v.buildings) if (o.alive && !o.constructing && (o.type === 'house' || o.type === 'hall') && o.doorX != null) homes.push(o);
    if (!homes.length) return null;
    const houses = homes.filter((o) => o.type === 'house');
    const pool = houses.length ? houses : homes;
    b = pool[u.id % pool.length];
    u._homeB = b.id;
    return b;
  };
  P._goInside = function (u, b) {
    this.stop(u);
    if (u._dl) this._dlEnd(u);
    u.activity = null;
    u.data.inside = true;
    u._inAcc = 0;
    u._away = true;
    u._homeB = b.id;
    u.sleeping = true;
    u.state = 'sleep';
    u._nap = false;
    u.data.workAnim = null;
    if (u._cell >= 0) {
      this._gridRemove(u);
      u._cell = -1;
    }
  };
  P._comeOut = function (u) {
    const b = this.game.civ?._bById?.get(u._homeB);
    u.data.inside = false;
    u._away = false;
    u.sleeping = false;
    u.state = 'idle';
    if (b) {
      u.x = u.px = (b.doorX ?? u.x) + (Math.random() - 0.5) * 0.3;
      u.z = u.pz = (b.doorZ ?? u.z) + (Math.random() - 0.5) * 0.3;
    }
    u._ex = u.x;
    u._ez = u.z;
    u.y = u.py = this._groundY(u);
    if (u._cell < 0 || u._cell == null) this._gridAdd(u);
  };
  // Per tick while asleep at home: rest, and wake at dawn, when rested, or to danger.
  // (a sleeper rests in steps of four ticks: the night's rest is the same, at a
  // quarter of the cost for the thousand or so asleep at once in a big world)
  P._insideTick = function (u, dt, now, tickN) {
    const acc = (u._inAcc || 0) + dt;
    const slot = tickN + u.id;
    if ((slot & 3) !== 0 && acc < 0.6) {
      u._inAcc = acc;
      return;
    }
    u._inAcc = 0;
    dt = acc;
    u.energy = Math.min(1, u.energy + dt * SLEEP_GAIN);
    u.hunger = Math.min(1, u.hunger + dt * u.def.hungerRate * 0.4);
    // children grow up through the night too (the village brain ages them by day)
    if (u.age < 16 && !u.flags?.frozenAge && !u.data.frozenAge) u.age += (dt / 30) * 1.7;
    if ((slot & 15) !== 0) return;
    const g = this.game;
    const b = g.civ?._bById?.get(u._homeB);
    // wake at the person's hour (a pinned clock: at daylight, or when rested)
    const live = !!g.settings?.dayNight;
    const wake = live ? !this._bedtime(u) && u.energy > 0.4 : (this.daylight() > 0.28 && u.energy > 0.5) || u.energy >= 0.999;
    let out = !b || !b.alive || wake || !g.civ?.villages?.[u.village]?.alive;
    if (!out && b && (b.burning > 0.2 || (b.hp != null && b.maxHp && b.hp < b.maxHp * 0.5))) out = true;
    if (!out && b && u.data.hostile && this.dangerNear(b.doorX, b.doorZ, 6)) {
      out = !!this.nearest(b.doorX, b.doorZ, 6, (o) => {
        try {
          return u.data.hostile(o);
        } catch (err) {
          return false;
        }
      });
    }
    if (out) this._comeOut(u);
  };
  // Food from a famine hunt goes to the hunter's town.
  P._foragerKill = function (killer, prey) {
    const v = this.game.civ?.villages?.[killer._forager];
    if (!v || !v.alive || typeof v.food !== 'number') return;
    v.food = Math.min(v.foodCap ?? Infinity, v.food + (MEAT[prey.species] || Math.round(6 * (prey.def.food || 1))));
    this.emote(killer, 'heart', 1.2);
  };
}
