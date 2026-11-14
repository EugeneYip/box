// Needs that bite (Life module): villagers tire through the working day and
// sleep at night in their homes (unit.data.inside: not drawn, out of the
// world's spatial queries, safe until danger or dawn), the exhausted nap where
// they stand, and in a famine the hungry go out hunting to feed their town.
// Wild herds feel the seasons through their pasture (see Units._forageTick).
//
// Village hunger itself is set by Civ's village store (meals while the store
// holds food); Life adds the tiredness, the sleep and the foraging.

const SLEEP_GAIN = 0.009; // energy per game second asleep at home
const NAP_GAIN = 0.012; // ...asleep where they stand
const MEAT = { deer: 10, rabbit: 3, sheep: 8, cow: 14, pig: 9, chicken: 2, goat: 7 };

export function installNeeds(Units) {
  const P = Units.prototype;

  // Before the village brain: returns true when tiredness or hunger took over.
  P._needsThink = function (u, now) {
    const g = this.game;
    const civ = g.civ;
    if (!civ || u.combat || u.state === 'flee' || u.data.aboard != null || u.def.kind !== 'humanoid') return false;
    const d = u.data;
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
    const day = this.daylight();
    const ride = d.ride && (d.ride.phase === 'out' || d.ride.phase === 'back');
    const army = d.civ?.army != null;
    const guard = u.job === 'soldier' && (u.id & 1) === 0; // half the soldiers keep the watch
    // night: home to bed (riders on the road and armies on the march press on)
    if (day < 0.16 && u.energy < 0.92 && !guard && !army && !ride) {
      const b = this._homeOf(u, v);
      if (!b) return this._nap0(u);
      const dx = b.doorX - u.x,
        dz = b.doorZ - u.z;
      if (dx * dx + dz * dz > 0.8) {
        if (!u.target || Math.abs(u.target.x - b.doorX) + Math.abs(u.target.z - b.doorZ) > 0.6) {
          if (!this.moveTo(u, b.doorX, b.doorZ)) return this._nap0(u);
        }
        if (u.state !== 'run') u.state = 'walk';
        u.data.workAnim = null;
        return true;
      }
      this._goInside(u, b);
      return true;
    }
    // worn out by day: a nap on the spot
    if (u.energy < 0.07 && !guard && !army) return this._nap0(u);
    // famine: the hungry go hunting to feed their town
    if (v.starving && u.hunger > 0.55 && u.age >= u.def.maturity && u.job !== 'king' && !d.civ?.royal) {
      const prey = this.nearest(u.x, u.z, 18, (o) => o.def.kind === 'animal' && o.def.diet === 'herbivore' && o.data.tended == null && o.alive);
      if (prey && this.engage(u, prey, { hunt: true, maxTime: 20 })) {
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
  P._nap0 = function (u) {
    this.stop(u);
    u._nap = true;
    u.sleeping = true;
    u.state = 'sleep';
    u.data.workAnim = null;
    return true;
  };
  // A home to sleep in: a house of their town (spread by id), else the hall.
  P._homeOf = function (u, v) {
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
    u.data.inside = true;
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
  P._insideTick = function (u, dt, now, tickN) {
    u.energy = Math.min(1, u.energy + dt * SLEEP_GAIN);
    u.hunger = Math.min(1, u.hunger + dt * u.def.hungerRate * 0.4);
    if ((tickN + u.id) % 15 !== 0) return;
    const g = this.game;
    const b = g.civ?._bById?.get(u._homeB);
    const day = this.daylight();
    let out = !b || !b.alive || (day > 0.28 && u.energy > 0.5) || u.energy >= 0.999 || !g.civ?.villages?.[u.village]?.alive;
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
