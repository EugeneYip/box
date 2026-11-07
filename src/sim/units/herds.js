import { TILE, TILE_INFO, FLORA_INFO, SEA_LEVEL } from '../../world/constants.js';

// Village livestock (Life module). Every living village keeps small tended
// herds of sheep, chickens, cattle and pigs on a pasture beside its farms:
//  - herd targets grow with the village population;
//  - wild animals of those species wandering nearby are adopted, and a
//    breeding pair is brought in when a village has none;
//  - tended animals are fed (they do not need wild forage) and breed up to the
//    target; surplus animals are slaughtered, and more of them when the village
//    is short of food, adding to village.food.
// Units read: unit.data.tended (village id), unit.home (pasture), herd ids.
const SPECIES_ORDER = ['sheep', 'chicken', 'cow', 'pig'];
const MEAT = { sheep: 12, chicken: 4, cow: 22, pig: 14 };

export class VillageHerds {
  constructor(units) {
    this.U = units;
    this.pasture = new Map(); // village id -> {x, z, t}
    this.counts = new Map(); // `${vid}:${species}` -> tended count
    this.targetsBy = new Map(); // `${vid}:${species}` -> target
    this.founded = new Map(); // `${vid}:${species}` -> last founder time
    this.totalTended = 0;
  }

  reset() {
    this.pasture.clear();
    this.counts.clear();
    this.targetsBy.clear();
    this.founded.clear();
    this.totalTended = 0;
  }

  targets(v) {
    const p = v.pop || v.population || 0;
    if (p < 4) return null;
    return {
      sheep: Math.min(8, 2 + Math.floor(p / 8)),
      chicken: Math.min(6, 2 + Math.floor(p / 10)),
      cow: Math.min(4, Math.floor(p / 14)),
      pig: Math.min(4, Math.floor(p / 16)),
    };
  }

  herdId(vid, sp) {
    return 1e6 + vid * 8 + SPECIES_ORDER.indexOf(sp);
  }

  // A grassy spot beside the village fields (outside buildings and crops).
  pastureFor(v, now) {
    const cached = this.pasture.get(v.id);
    if (cached && now - cached.t < 120) return cached;
    const w = this.U.game.world;
    const cx = Math.floor(v.cx ?? v.x),
      cz = Math.floor(v.cz ?? v.z);
    let best = null,
      bs = -1e9;
    for (let r = 4; r <= 10; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = cx + dx,
            ty = cz + dy;
          if (!w.inBounds(tx, ty)) continue;
          const i = ty * w.w + tx;
          if (w.height[i] < SEA_LEVEL + 0.05 || w.building[i] >= 0) continue;
          const t = w.type[i];
          if (t === TILE.FARMLAND || t === TILE.ROAD || !TILE_INFO[t].walkable || FLORA_INFO[w.flora[i]].blocksMovement) continue;
          if (w.owner[i] >= 0 && w.owner[i] !== v.kingdom) continue;
          // prefer grass next to fields, not too far out
          let farm = 0,
            blocked = 0;
          for (let ey = -3; ey <= 3; ey++)
            for (let ex = -3; ex <= 3; ex++) {
              const x = tx + ex,
                y = ty + ey;
              if (!w.inBounds(x, y)) continue;
              const j = y * w.w + x;
              if (w.type[j] === TILE.FARMLAND) farm += Math.max(Math.abs(ex), Math.abs(ey)) <= 1 ? -4 : 1;
              if (w.building[j] >= 0) blocked++;
            }
          const sc = farm * 1.5 - blocked * 2 - r * 0.6 + TILE_INFO[t].fertile * 3 + Math.random() * 0.5;
          if (sc > bs) {
            bs = sc;
            best = { x: tx + 0.5, z: ty + 0.5, t: now };
          }
        }
    if (best) this.pasture.set(v.id, best);
    return best;
  }

  tend(u, v, P) {
    u.data.tended = v.id;
    u.home = { x: P.x, z: P.z };
    u.herd = this.herdId(v.id, u.species);
    u.pack = 0;
  }

  tick(now) {
    const U = this.U;
    const g = U.game;
    const civ = g.civ;
    this.counts.clear();
    this.targetsBy.clear();
    if (!civ?.villages?.length) {
      this.totalTended = 0;
      return;
    }
    const byVillage = new Map();
    let total = 0;
    for (const u of U.list) {
      const t = u.data.tended;
      if (t == null) continue;
      let h = byVillage.get(t);
      if (!h) byVillage.set(t, (h = []));
      h.push(u);
      total++;
    }
    for (const v of civ.villages) {
      const mine = byVillage.get(v.id) || [];
      if (!v.alive) {
        for (const u of mine) delete u.data.tended; // the herd goes feral
        continue;
      }
      const T = this.targets(v);
      if (!T) continue;
      const P = this.pastureFor(v, now);
      if (!P) continue;
      for (const sp of SPECIES_ORDER) {
        const key = v.id + ':' + sp;
        const have = mine.filter((u) => u.species === sp);
        const target = T[sp];
        this.targetsBy.set(key, target);
        if (target <= 0 && !have.length) continue;
        // keep strays on the pasture
        for (const u of have) if (u.home.x !== P.x || u.home.z !== P.z) u.home = { x: P.x, z: P.z };
        // adopt wild animals of this kind that wander close
        if (have.length < target) {
          const wild = U.nearest(P.x, P.z, 12, (o) => o.species === sp && o.data.tended == null && !o.combat);
          if (wild) {
            this.tend(wild, v, P);
            have.push(wild);
            total++;
          }
        }
        // founders: villagers bring in a breeding pair (rate-limited)
        if (have.length < Math.min(2, target) && now - (this.founded.get(key) ?? -1e9) > 150) {
          this.founded.set(key, now);
          for (const sex of ['f', 'm']) {
            if (have.length >= 2) break;
            const u = U.spawn(sp, P.x + (Math.random() - 0.5) * 1.5, P.z + (Math.random() - 0.5) * 1.5, { age: 2 + Math.random() * 2, sex, home: P });
            if (u) {
              this.tend(u, v, P);
              have.push(u);
              total++;
            }
          }
        }
        // slaughter: surplus over the target, or more when the village is hungry
        const pop = v.pop || 1;
        const hungry = v.starving || v.food < pop * 1.2;
        const keep = hungry ? Math.max(2, Math.ceil(target * 0.6)) : target;
        if (have.length > keep) {
          let cull = null;
          for (const u of have) if (u.age >= u.def.maturity && !(u.pregnant > 0) && (!cull || u.age > cull.age)) cull = u;
          if (cull) {
            U.kill(cull, 'slaughter');
            if (typeof v.food === 'number') v.food = Math.min(v.foodCap ?? Infinity, v.food + (MEAT[sp] || 8));
            have.splice(have.indexOf(cull), 1);
            total--;
          }
        }
        this.counts.set(key, have.length);
      }
    }
    this.totalTended = total;
  }

  // May this tended animal breed? (herd below its village target)
  canBreed(u) {
    const key = u.data.tended + ':' + u.species;
    const t = this.targetsBy.get(key);
    if (t == null) return false;
    return (this.counts.get(key) || 0) < t;
  }
}
