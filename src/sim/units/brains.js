import { FLORA, FLORA_INFO, TILE, TILE_INFO, SEA_LEVEL } from '../../world/constants.js';

// Default behaviour brains, keyed by species.brain. Each is called on the
// unit's think tick (about every 0.6 game seconds) as fn(unit, units, game, now).
// A brain registered with game.units.registerBrain(species, fn) replaces these
// for that species (Civilization does this for humans).
//
// BRAIN_TICKS run every simulation tick for creatures that need fine timing
// (fire breath, surfacing serpents).

function d2(a, b) {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}

function walkableTile(w, i) {
  return w.height[i] >= SEA_LEVEL && TILE_INFO[w.type[i]].walkable && !FLORA_INFO[w.flora[i]].blocksMovement;
}

function onGraze(u, w) {
  const [tx, ty] = w.tileOf(u.x, u.z);
  const i = w.idx(tx, ty);
  return w.height[i] >= SEA_LEVEL && u.def.grazes.includes(w.type[i]);
}

// Herd centroid of herd-mates within r. Returns {x, z, n, leader}.
function herdInfo(u, U, r = 12) {
  let sx = 0,
    sz = 0,
    n = 0,
    leader = u;
  U.forEachNear(u.x, u.z, r, (o) => {
    if (o === u || o.herd !== u.herd || o.species !== u.species) return;
    sx += o.x;
    sz += o.z;
    n++;
    if (o.id < leader.id && o.age >= o.def.maturity) leader = o;
  });
  if (!n) return { x: u.x, z: u.z, n: 0, leader: u };
  return { x: sx / n, z: sz / n, n, leader };
}

function herbivore(u, U, g, now) {
  const def = u.def;
  const rng = g.rng;
  const w = g.world;
  if (u.combat) return;
  let threat = U.findThreat(u);
  if (!threat && u.alarm) {
    const t = U.byId.get(u.alarm);
    u.alarm = 0;
    if (t && t.alive && d2(t, u) < (def.sight * 1.3) ** 2) threat = t;
  }
  if (threat) {
    if (u.fleeUntil < now + 0.8 || !u.target) {
      U.flee(u, threat.x, threat.z, 4.5 + rng.float(0, 3));
      if (rng.chance(0.35)) U.emote(u, 'alert', 1.1);
      U._alertGroup(u, threat);
    }
    return;
  }
  if (u.fleeUntil > now && u.target) return;
  if (U.sleepLogic(u)) return;
  if (u.busyUntil > now) return;
  // the herd leader keeps the herd moving onto good pasture (rotational grazing)
  if (now > (u._pastureT || 0)) {
    const fr0 = U.forageAt(u.x, u.z);
    if (fr0 < 0.5) {
      u._pastureT = now + 7;
      const h0 = def.herd && u.herd ? herdInfo(u, U) : null;
      if (!h0 || h0.n === 0 || h0.leader === u) {
        const best = U.bestPasture(u, 3);
        if (best && U.forageAt(best.x, best.z) > fr0 + 0.2 && U.moveTo(u, best.x + rng.float(-2.5, 2.5), best.z + rng.float(-2.5, 2.5))) {
          u.state = 'walk';
          u.home = { x: best.x, z: best.z };
          return;
        }
      }
    }
  }
  // hunger: graze here, or lead / follow the herd to fresher pasture
  if (u.hunger > 0.4) {
    const fr = U.forageAt(u.x, u.z);
    if (onGraze(u, w) && fr > 0.12) {
      U.startActivity(u, 'eat', rng.float(2.5, 4.5));
      return;
    }
    if (fr <= 0.25 && now > (u._pastureT || 0)) {
      u._pastureT = now + 6;
      const best = U.bestPasture(u, u.hunger > 0.7 ? 3 : 2);
      if (best && U.forageAt(best.x, best.z) > fr + 0.15) {
        const ok = U.moveTo(u, best.x + rng.float(-2.5, 2.5), best.z + rng.float(-2.5, 2.5));
        if (ok) {
          u.state = 'walk';
          if (def.herd && u.herd) u.home = { x: best.x, z: best.z };
          return;
        }
      }
    }
    const t = U.findNearestTile(u.x, u.z, u.hunger > 0.7 ? 16 : 7, (tx, ty, i) => def.grazes.includes(w.type[i]) && walkableTile(w, i));
    if (t) {
      U.moveTo(u, t.x + rng.float(-0.3, 0.3), t.z + rng.float(-0.3, 0.3));
      u.state = 'walk';
      return;
    }
  }
  if (U.tryBreed(u)) return;
  // young follow their mother
  if (u.age < def.maturity) {
    const mom = U.nearest(u.x, u.z, 10, (o) => o.species === u.species && o.sex === 'f' && o.age >= def.maturity && (o.herd === u.herd || !u.herd));
    if (mom && d2(mom, u) > 1.0) {
      U.moveTo(u, mom.x + rng.float(-0.5, 0.5), mom.z + rng.float(-0.5, 0.5));
      u.state = 'walk';
      return;
    }
  }
  // herd cohesion
  let center = null;
  if (def.herd) {
    if (!u.herd) u.herd = U._nextGroup++;
    const h = herdInfo(u, U);
    if (h.n === 0) {
      const other = U.nearest(u.x, u.z, 10, (o) => o !== u && o.species === u.species);
      if (other) u.herd = other.herd || (other.herd = U._nextGroup++);
    } else {
      center = h;
      const spread = 1.1 + 0.4 * Math.sqrt(h.n);
      if (d2(u, h) > spread * spread) {
        U.moveTo(u, h.x + rng.float(-spread, spread) * 0.5, h.z + rng.float(-spread, spread) * 0.5);
        u.state = 'walk';
        return;
      }
      if (h.leader === u) {
        // keep clear of other species' herds
        let ox = 0,
          oz = 0,
          on = 0;
        U.forEachNear(u.x, u.z, 4, (o) => {
          if (o.species !== u.species && o.def.kind === 'animal' && o.def.diet !== 'carnivore') {
            ox += o.x;
            oz += o.z;
            on++;
          }
        });
        if (on >= 3) {
          const ax = u.x - ox / on,
            az = u.z - oz / on;
          const l = Math.hypot(ax, az) || 1;
          if (U.moveTo(u, u.x + (ax / l) * 5 + rng.float(-1, 1), u.z + (az / l) * 5 + rng.float(-1, 1))) {
            u.state = 'walk';
            return;
          }
        }
        if (rng.chance(0.25)) {
          // the herd leader drifts towards fresh pasture, the rest follow
          U.wander(u, 5);
          return;
        }
      }
    }
  }
  const r = rng.next();
  if (r < 0.28 && onGraze(u, w)) U.startActivity(u, 'eat', rng.float(1.5, 3.5));
  else if (r < 0.55) U.wander(u, def.herd ? 2.5 : 4, center);
  else if (!u.target) {
    u.state = 'idle';
    if ((u.species === 'sheep' || u.species === 'goat') && !u._far && rng.chance(0.05)) U.sfx('bleat', u.x, u.z, { volume: 0.3, pitch: rng.float(0.9, 1.2) * (u.age < def.maturity ? 1.3 : 1) });
  }
}

function predator(u, U, g, now) {
  const def = u.def;
  const rng = g.rng;
  if (u.combat) return;
  if (def.flees) {
    const t = U.findThreat(u);
    if (t && t.def.mass > def.mass) {
      U.flee(u, t.x, t.z, 6);
      return;
    }
  }
  // refuge: wild predators shun people and towns unless starving
  if (u.hunger < 0.8) {
    const person = U.nearest(u.x, u.z, 5, (o) => o.species === 'human' && o.age >= o.def.maturity);
    const [ptx, pty] = g.world.tileOf(u.x, u.z);
    const owned = g.world.owner[g.world.idx(ptx, pty)] >= 0;
    if (person || (owned && rng.chance(0.5))) {
      const fx = person ? person.x : u.home.x * 2 - u.x;
      const fz = person ? person.z : u.home.z * 2 - u.z;
      if (U.flee(u, fx, fz, 7)) {
        u.state = 'walk';
        u.fleeUntil = 0;
        if (person && u.pack) {
          const p = U.packs.get(u.pack);
          if (p) p.home = { x: u.target.x, z: u.target.z };
        }
        return;
      }
    }
  }
  if (U.sleepLogic(u)) return;
  if (u.busyUntil > now) return;
  // feed at a carcass
  if (u.hunger > 0.12) {
    const c = U.nearestCarcass(u, 9);
    if (c) {
      if (d2(c, u) < 0.5) {
        U.startActivity(u, 'eat', rng.float(3, 5));
        u._carcass = c;
      } else {
        U.moveTo(u, c.x + rng.float(-0.35, 0.35), c.z + rng.float(-0.35, 0.35));
        u.state = 'walk';
      }
      return;
    }
  }
  const pack = u.pack ? U.packs.get(u.pack) : null;
  // hunt
  if (u.hunger > 0.5 || (pack && pack.target && u.hunger > 0.2)) {
    let prey = pack && pack.target ? U.byId.get(pack.target) : null;
    if (!prey || !prey.alive || d2(prey, u) > 20 * 20) {
      prey = U.findPrey(u, def.sight * (pack ? 1.3 : 1));
      if (pack) pack.target = prey ? prey.id : 0;
    }
    if (prey) {
      U.engage(u, prey, { hunt: true });
      return;
    }
    // foxes catch voles in long grass when nothing bigger is around
    if (def.mouses && rng.chance(0.45) && onGraze(u, g.world)) {
      U.startActivity(u, 'eat', 1.6, 'pounce');
      return;
    }
    // nothing in sight: the leader (or a loner) scouts towards distant prey
    const leader = pack ? U.packLeader(u) : u;
    if (leader === u && (!u.target || u.state !== 'run') && u.hunger > 0.55 && now > (u._scoutT || 0)) {
      u._scoutT = now + 5;
      const far = U.nearest(u.x, u.z, 48, (o) => def.prey.includes(o.species) && U.count(o.species) >= 6);
      let gx, gz;
      if (far) {
        const l = Math.hypot(far.x - u.x, far.z - u.z) || 1;
        const step = Math.min(l, 14);
        gx = u.x + ((far.x - u.x) / l) * step;
        gz = u.z + ((far.z - u.z) / l) * step;
      } else {
        const a = rng.float(0, Math.PI * 2);
        gx = u.x + Math.sin(a) * 14;
        gz = u.z + Math.cos(a) * 14;
      }
      if (U.moveTo(u, gx, gz)) {
        u.state = 'walk';
        if (pack) pack.home = { x: gx, z: gz };
        else u.home = { x: gx, z: gz };
      }
      return;
    }
  }
  if (U.tryBreed(u)) return;
  // pack: stay near the leader; leader roams
  if (pack) {
    const leader = U.packLeader(u);
    if (leader && leader !== u) {
      if (d2(leader, u) > 3.2 * 3.2) {
        U.moveTo(u, leader.x + rng.float(-1.5, 1.5), leader.z + rng.float(-1.5, 1.5));
        u.state = 'walk';
        return;
      }
      if (rng.chance(0.3)) U.wander(u, 2, leader);
      else if (!u.target) u.state = 'idle';
      return;
    }
    if (!u.target && rng.chance(0.4)) {
      if (d2(u, pack.home) > 18 * 18) U.moveTo(u, pack.home.x + rng.float(-4, 4), pack.home.z + rng.float(-4, 4));
      else U.wander(u, 9);
      if (rng.chance(0.1)) pack.home = { x: u.x, z: u.z };
    }
    const day = g.env?.daylight ?? 1;
    if (day < 0.2 && rng.chance(0.02)) {
      U.emote(u, 'note', 2);
      U.sfx('growl', u.x, u.z, { volume: 0.3, pitch: 1.5 });
    }
    return;
  }
  if (!u.target && rng.chance(0.45)) U.wander(u, 7, d2(u, u.home) > 20 * 20 ? u.home : null);
  else if (!u.target) u.state = 'idle';
}

function bear(u, U, g, now) {
  const def = u.def;
  const rng = g.rng;
  const w = g.world;
  if (u.combat) return;
  if (U.sleepLogic(u)) return;
  if (u.busyUntil > now) return;
  // humans that come too close get a warning, then a swipe
  const intruder = U.nearest(u.x, u.z, 2.2, (o) => o.species === 'human' && !o.sleeping);
  if (intruder) {
    if (rng.chance(u.hunger > 0.7 ? 0.5 : 0.18)) {
      U.engage(u, intruder, { maxTime: 8 });
      return;
    }
    U.emote(u, 'anger', 1.5);
    if (rng.chance(0.3)) U.sfx('growl', u.x, u.z, { volume: 0.45 });
  }
  // territorial: avoid other adult bears
  const rival = U.nearest(u.x, u.z, 5, (o) => o !== u && o.species === 'bear' && o.age >= def.maturity && u.age >= def.maturity);
  if (rival && rng.chance(0.5)) {
    U.flee(u, rival.x, rival.z, 6);
    u.state = 'walk';
    u.fleeUntil = 0;
    return;
  }
  if (u.hunger > 0.4) {
    const c = U.nearestCarcass(u, 8);
    if (c) {
      if (d2(c, u) < 0.6) {
        U.startActivity(u, 'eat', rng.float(3, 5));
        u._carcass = c;
      } else U.moveTo(u, c.x, c.z);
      return;
    }
    // berries and mushrooms
    const b = U.findNearestTile(u.x, u.z, 8, (tx, ty, i) => (w.flora[i] === FLORA.BERRY_BUSH || w.flora[i] === FLORA.MUSHROOM) && w.height[i] >= SEA_LEVEL);
    if (b) {
      if ((b.x - u.x) ** 2 + (b.z - u.z) ** 2 < 0.9) {
        U.startActivity(u, 'eat', rng.float(3, 5));
        u.hunger = Math.max(0, u.hunger - 0.15);
      } else {
        U.moveTo(u, b.x + rng.float(-0.4, 0.4), b.z + rng.float(-0.4, 0.4));
        u.state = 'walk';
      }
      return;
    }
    // fishing at the shore
    if (w.isCoastal(...w.tileOf(u.x, u.z))) {
      const [tx, ty] = w.tileOf(u.x, u.z);
      U.startActivity(u, 'eat', rng.float(3, 6), 'fish');
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
        if (w.isWater(tx + dx, ty + dy)) u.heading = Math.atan2(dx, dy);
      if (rng.chance(0.5)) u.hunger = Math.max(0, u.hunger - 0.2);
      return;
    }
    if (u.hunger > 0.6) {
      const prey = U.findPrey(u);
      if (prey) {
        U.engage(u, prey, { hunt: true });
        return;
      }
    }
    const coast = U.findNearestTile(u.x, u.z, 10, (tx, ty, i) => w.height[i] >= SEA_LEVEL && w.isCoastal(tx, ty) && walkableTile(w, i));
    if (coast && rng.chance(0.5)) {
      U.moveTo(u, coast.x, coast.z);
      u.state = 'walk';
      return;
    }
  }
  if (U.tryBreed(u)) return;
  // cubs follow their mother
  if (u.age < def.maturity) {
    const mom = U.nearest(u.x, u.z, 12, (o) => o.species === 'bear' && o.sex === 'f' && o.age >= def.maturity);
    if (mom && d2(mom, u) > 1.4) {
      U.moveTo(u, mom.x + rng.float(-0.6, 0.6), mom.z + rng.float(-0.6, 0.6));
      return;
    }
  }
  if (!u.target && rng.chance(0.35)) U.wander(u, 8, d2(u, u.home) > 25 * 25 ? u.home : null);
  else if (!u.target) u.state = 'idle';
}

function omnivore(u, U, g, now) {
  // generic omnivore: forage like a herbivore, opportunistically hunt
  if (u.hunger > 0.7 && u.def.prey.length) {
    const prey = U.findPrey(u);
    if (prey) {
      U.engage(u, prey, { hunt: true });
      return;
    }
  }
  herbivore(u, U, g, now);
}

// Natural-looking human behaviour when no Civilization brain is registered:
// wander near a camp, forage, chat with neighbours, sleep at night, flee danger.
function human(u, U, g, now) {
  const rng = g.rng;
  const w = g.world;
  if (u.combat) return;
  const brave = u.job === 'soldier' || u.job === 'king';
  const threat = U.nearest(u.x, u.z, 6, (o) => {
    if (o === u || o.sleeping) return false;
    if (o.mad > now) return true;
    if (o.combat && o.combat.target === u.id) return !brave && u.hp < u.maxHp * 0.4;
    if (o.def.kind === 'monster') return true;
    if (o.def.prey.includes('human')) return true;
    if ((o.species === 'wolf' || o.species === 'bear') && (o.x - u.x) ** 2 + (o.z - u.z) ** 2 < 9) return !brave;
    return false;
  });
  if (threat) {
    if (brave && threat.def.kind !== 'monster' && U.attackDamage(u) > 0) U.engage(u, threat);
    else {
      U.flee(u, threat.x, threat.z, 7);
      if (rng.chance(0.4)) U.emote(u, 'alert', 1.2);
    }
    return;
  }
  if (u.fleeUntil > now && u.target) return;
  if (U.sleepLogic(u)) return;
  if (u.busyUntil > now) return;
  // drift the camp very slowly with the group
  if (rng.chance(0.02)) u.home = { x: u.home.x * 0.8 + u.x * 0.2, z: u.home.z * 0.8 + u.z * 0.2 };
  // forage
  if (u.hunger > 0.45) {
    const f = U.findNearestTile(u.x, u.z, 9, (tx, ty, i) => FLORA_INFO[w.flora[i]].food > 0 && w.height[i] >= SEA_LEVEL);
    if (f) {
      if ((f.x - u.x) ** 2 + (f.z - u.z) ** 2 < 0.8) {
        U.startActivity(u, 'work', rng.float(2.5, 4));
        u.data.workAnim = 'harvest';
        u.heading = Math.atan2(f.x - u.x, f.z - u.z);
        u.hunger = Math.max(0, u.hunger - 0.45);
      } else {
        U.moveTo(u, f.x + rng.float(-0.35, 0.35), f.z + rng.float(-0.35, 0.35));
        u.state = 'walk';
      }
      return;
    }
    if (u.hunger > 0.75 && u.age >= u.def.maturity) {
      const game = U.nearest(u.x, u.z, 8, (o) => o.species === 'rabbit' || o.species === 'chicken' || o.species === 'pig' || o.species === 'sheep');
      if (game && U.count(game.species) > 8) {
        U.engage(u, game, { hunt: true, maxTime: 10 });
        return;
      }
      const c = U.nearestCarcass(u, 8);
      if (c) {
        if (d2(c, u) < 0.5) {
          U.startActivity(u, 'eat', 3);
          u._carcass = c;
        } else U.moveTo(u, c.x, c.z);
        return;
      }
    }
  }
  const r = rng.next();
  if (r < 0.14) {
    // chat with a neighbour
    const friend = U.nearest(u.x, u.z, 7, (o) => o !== u && o.species === 'human' && !o.sleeping && !o.combat && o.busyUntil < now);
    if (friend) {
      const a = Math.atan2(u.x - friend.x, u.z - friend.z);
      const tx = friend.x + Math.sin(a) * 0.55,
        tz = friend.z + Math.cos(a) * 0.55;
      if ((tx - u.x) ** 2 + (tz - u.z) ** 2 > 0.15) {
        U.moveTo(u, tx, tz);
        u.state = 'walk';
        u._chatWith = friend.id;
      } else {
        const dur = rng.float(3, 6);
        U.startActivity(u, 'idle', dur, 'talk');
        u.heading = Math.atan2(friend.x - u.x, friend.z - u.z);
        if (friend.busyUntil < now && !friend.target) {
          U.startActivity(friend, 'idle', dur, 'talk');
          friend.heading = Math.atan2(u.x - friend.x, u.z - friend.z);
        }
        if (rng.chance(0.5)) U.emote(u, 'chat', 1.8);
      }
      return;
    }
  }
  if (u._chatWith && !u.target) {
    const f = U.byId.get(u._chatWith);
    u._chatWith = 0;
    if (f && f.alive && d2(f, u) < 1.2) {
      const dur = rng.float(3, 6);
      U.startActivity(u, 'idle', dur, 'talk');
      u.heading = Math.atan2(f.x - u.x, f.z - u.z);
      if (f.busyUntil < now && !f.target) {
        U.startActivity(f, 'idle', dur, 'talk');
        f.heading = Math.atan2(u.x - f.x, u.z - f.z);
      }
      return;
    }
  }
  if (r < 0.5 && !u.target) {
    if (d2(u, u.home) > 8 * 8) U.moveTo(u, u.home.x + rng.float(-3, 3), u.home.z + rng.float(-3, 3));
    else U.wander(u, 4);
  } else if (!u.target) {
    u.state = 'idle';
    if (rng.chance(0.12)) U.startActivity(u, 'idle', rng.float(2, 4), 'look');
  }
}

// Stone golem: slow, territorial, wakes from a dormant "boulder" pose.
function golem(u, U, g, now) {
  const rng = g.rng;
  if (u.combat) return;
  const foe = U.nearest(u.x, u.z, u.def.sight, (o) => {
    if (o === u || o.def.kind === 'monster') return false;
    if (o.combat && o.combat.target === u.id) return true;
    if (o.mad > now) return true;
    return u.def.prey.includes(o.species) && o.age >= o.def.maturity && (o.x - u.x) ** 2 + (o.z - u.z) ** 2 < (u.sleeping ? 9 : 36);
  });
  if (foe) {
    if (u.sleeping) {
      U._wake(u);
      U.emote(u, 'anger', 2);
      g.audio.play?.('quake', { pos: { x: u.x, z: u.z }, volume: 0.35, pitch: 0.7 });
    }
    U.engage(u, foe, { maxTime: 25 });
    return;
  }
  const day = g.env?.daylight ?? 1;
  if (u.sleeping) {
    if (day > 0.3 && rng.chance(0.08)) U._wake(u);
    else return;
  }
  if (day < 0.12 && rng.chance(0.2)) {
    U.stop(u);
    u.sleeping = true;
    u.state = 'sleep';
    return;
  }
  if (!u.target && rng.chance(0.3)) U.wander(u, 5, d2(u, u.home) > 12 * 12 ? u.home : null);
  else if (!u.target) u.state = 'idle';
}

// Tidewyrm: patrols the water, lunges at creatures near the shore or swimming.
function serpent(u, U, g, now) {
  const rng = g.rng;
  const w = g.world;
  if (u.combat) return;
  const prey = U.nearest(u.x, u.z, u.def.sight, (o) => {
    if (o === u || o.def.kind === 'monster' || !u.def.prey.includes(o.species)) return false;
    if (o.swimming || o.wading) return true;
    const [tx, ty] = w.tileOf(o.x, o.z);
    return w.isCoastal(tx, ty) && (o.x - u.x) ** 2 + (o.z - u.z) ** 2 < 25;
  });
  if (prey && rng.chance(0.6)) {
    U.engage(u, prey, { hunt: true, maxTime: 12 });
    g.audio.play?.('splash', { pos: { x: u.x, z: u.z }, volume: 0.5, pitch: 0.6 });
    return;
  }
  if (!u.target && rng.chance(0.4)) {
    for (let t = 0; t < 8; t++) {
      const a = rng.float(0, Math.PI * 2),
        r = rng.float(4, 12);
      const x = u.x + Math.sin(a) * r,
        z = u.z + Math.cos(a) * r;
      const [tx, ty] = w.tileOf(x, z);
      if (w.inBounds(tx, ty) && w.height[w.idx(tx, ty)] < SEA_LEVEL - 0.8) {
        U.moveTo(u, x, z);
        u.state = 'walk';
        break;
      }
    }
  }
}

function serpentTick(u, dt, U, g, now) {
  // surface / dive cycle drives the renderer (data.surface 0..1)
  const d = u.data;
  if (d.surface == null) d.surface = 1;
  if (!d.nextDive) d.nextDive = now + 20 + Math.random() * 25;
  const want = u.combat ? 1 : now > d.nextDive && now < d.nextDive + 8 ? 0.15 : 1;
  if (now > d.nextDive + 8) d.nextDive = now + 20 + Math.random() * 25;
  d.surface += (want - d.surface) * Math.min(1, dt * 0.8);
}

// Skywyrm: soars in wide loops, periodically strafes a target with fire,
// roosts on high ground at night.
function skywyrm(u, U, g, now) {
  const rng = g.rng;
  const w = g.world;
  const d = u.data;
  if (!d.nextBreath) d.nextBreath = now + rng.float(12, 22);
  const day = g.env?.daylight ?? 1;
  if (u.sleeping) {
    if (day > 0.3 || u.hp < u.maxHp * 0.6) {
      U._wake(u);
      u.altGoal = 7;
    } else return;
  }
  if (day < 0.1 && !u.combat && !d.fireTarget) {
    if (!d.roost) {
      const r = U.findNearestTile(u.x, u.z, 30, (tx, ty, i) => w.height[i] > 5 && walkableTile(w, i));
      d.roost = r ? { x: r.x, z: r.z } : { x: u.x, z: u.z };
    }
    const dist = Math.sqrt(d2(u, d.roost));
    if (dist > 1) {
      U.moveTo(u, d.roost.x, d.roost.z);
      u.altGoal = Math.max(1.5, Math.min(7, dist * 0.6));
    } else {
      u.altGoal = 0;
      if (u.alt < 0.3) {
        U.stop(u);
        u.sleeping = true;
        u.state = 'sleep';
      }
    }
    return;
  }
  d.roost = null;
  if (u.combat) {
    // fight back with fire
    const t = U.byId.get(u.combat.target);
    if (t && !(d.breath > now) && now > (d.nextBreath - 15)) d.fireTarget = { x: t.x, z: t.z, unit: t.id };
  }
  if (d.fireTarget) {
    const T = d.fireTarget;
    const tu = T.unit ? U.byId.get(T.unit) : null;
    if (tu && tu.alive) {
      T.x = tu.x;
      T.z = tu.z;
    }
    const dist = Math.hypot(T.x - u.x, T.z - u.z);
    if (d.breath > now) return;
    if (d.breath && now >= d.breath) {
      d.breath = 0;
      d.fireTarget = null;
      d.nextBreath = now + rng.float(28, 48);
      u.altGoal = 6.5 + rng.float(0, 2);
      U.disengage(u);
      U.wander(u, 16);
      return;
    }
    if (dist < 4.5) {
      d.breath = now + 2.6;
      u.altGoal = 2.4;
      g.audio.play?.('fire-start', { pos: { x: u.x, z: u.z }, volume: 0.7, pitch: 0.7 });
      g.audio.play?.('growl', { pos: { x: u.x, z: u.z }, volume: 0.6, pitch: 0.6 });
      // keep flying straight through the target
      const l = dist || 1;
      u.target = { x: Math.min(w.w - 1, Math.max(1, T.x + ((T.x - u.x) / l) * 6)), z: Math.min(w.h - 1, Math.max(1, T.z + ((T.z - u.z) / l) * 6)) };
      return;
    }
    // approach from a distance so the run is straight
    u.target = { x: T.x, z: T.z };
    u.altGoal = dist < 14 ? 3 : 7;
    return;
  }
  if (now > d.nextBreath) {
    let T = null;
    const victim = U.nearest(u.x, u.z, 40, (o) => o.species === 'human' || (o.def.kind === 'animal' && o.def.mass >= 1));
    if (victim) T = { x: victim.x, z: victim.z, unit: victim.id };
    else {
      const f = U.findNearestTile(u.x, u.z, 25, (tx, ty, i) => FLORA_INFO[w.flora[i]].isTree);
      if (f) T = { x: f.x, z: f.z };
    }
    if (T) d.fireTarget = T;
    else d.nextBreath = now + 15;
    return;
  }
  if (!u.target || rng.chance(0.05)) {
    const home = d2(u, u.home) > 40 * 40 ? u.home : null;
    U.wander(u, 18, home);
    u.altGoal = 6 + rng.float(0, 3);
  }
}

function skywyrmTick(u, dt, U, g, now) {
  const d = u.data;
  if (!(d.breath > now)) return;
  const w = g.world;
  const hx = Math.sin(u.heading),
    hz = Math.cos(u.heading);
  const y0 = u.y + 0.2;
  // flames stream from the jaws down and ahead
  d.fireT = (d.fireT || 0) - dt;
  const reach = 2.2 + Math.random() * 3.2;
  const fx = u.x + hx * (1.3 + reach),
    fz = u.z + hz * (1.3 + reach);
  const gy = Math.max(SEA_LEVEL, w.heightAt(fx, fz));
  g.fx.emit?.('fire', { x: u.x + hx * 1.4, y: y0, z: u.z + hz * 1.4 }, { dir: { x: hx * 3, y: (gy - y0) * 0.6, z: hz * 3 }, scale: 0.9 });
  if (d.fireT <= 0) {
    d.fireT = 0.3;
    g.fx.emit?.('fire', { x: fx, y: gy + 0.1, z: fz }, { scale: 1.3 });
    g.fx.emit?.('embers', { x: fx, y: gy + 0.2, z: fz }, { scale: 1 });
    const [tx, ty] = w.tileOf(fx, fz);
    const i = w.idx(tx, ty);
    if (w.height[i] >= SEA_LEVEL && (TILE_INFO[w.type[i]].flammable > 0.2 || FLORA_INFO[w.flora[i]].flammable > 0.3) && Math.random() < 0.55) {
      if (g.disasters?.ignite) g.disasters.ignite(tx, ty, 0.8);
      else w.setFire(tx, ty, 0.8);
    }
    U.forEachNear(fx, fz, 1.6, (o) => {
      if (o !== u && o.def.kind !== 'monster') U.damage(o, 9, u, { knock: 0.4, dirX: hx, dirZ: hz, cause: 'fire' });
    });
    g.civ?.damageArea?.(fx, fz, 1.5, 8, 'fire');
  }
}

export const BRAINS = { herbivore, predator, bear, omnivore, human, golem, serpent, skywyrm };
export const BRAIN_TICKS = { serpent: serpentTick, skywyrm: skywyrmTick };
export { TILE };
