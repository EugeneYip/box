import { BUILDING_TYPES, costOf, canAfford, pay } from './catalog.js';
import { USE, YEAR } from './util.js';

// Urban renewal and heritage (docs/TECH-BREADTH.md section 2).
//
// From Zoning on, a town's old low buildings (huts, cottages and timber
// houses of earlier eras, early row houses) are replaced, one at a time per
// town, by denser buildings of the realm's era on the same ground: manors in
// the Industrial era, apartment blocks once concrete is known, towers at a
// city's heart in the Atomic era. Each goes as demolition dust, a cleared
// plot and then a construction site. The most crowded towns and the plots
// nearest the centre go first. Walls come down for a ring road once a town
// has outgrown them or its realm enters the Industrial era; a gatehouse
// stays. Heritage buildings (wonders, the oldest hall or temple, a gatehouse,
// a few of the oldest houses of the core; more with Heritage Conservation,
// and any the player marks) are never replaced and keep their era's look.
//
// PUBLIC CONTRACT (additions to game.civ)
//   setHeritage(building, on)   the player marks or unmarks a heritage building
//   building.heritage = {since: year designated, built: year built, player?}
//   building.renewed = true     a building raised by renewal
//   village.renewed             how many plots renewal has rebuilt (caps grow by it)
//   village.wallsDown = true    its walls were taken down for a ring road
// World Law civRenewal: 0 Off, 1 Slow, 2 Normal (default).

const HOMES = new Set(['house', 'rowhouse', 'apartment']);
const HERITAGE_CIVIC = new Set(['market', 'library', 'forum', 'observatory', 'academy', 'temple', 'aqueduct', 'statue']);

export const renewal = {
  // The player marks or unmarks a building as heritage (the inspector).
  setHeritage(b, on) {
    if (!b || !b.alive) return false;
    if (on) {
      b.heritage = { since: Math.floor(this.game.time.total / YEAR), built: Math.floor((b.builtAt || 0) / YEAR), player: true };
      delete b.heritageOff;
    } else {
      delete b.heritage;
      b.heritageOff = true; // the realm will not choose it again
    }
    this.version++;
    return true;
  },

  // Every 2 s (from _breadthTick).
  _renewalTick() {
    const now = this.game.time.total;
    const mode = Math.round(this.law('civRenewal', 2));
    for (const k of this.kingdoms) {
      if (!k.alive || !k.techs || !k.villages.length) continue;
      const zoning = k.techs.has('zoning');
      const industrial = (k.era || 0) >= 4;
      for (const vid of k.villages) {
        const v = this.villages[vid];
        if (!v?.alive || v.razed) continue;
        if ((zoning || v.wallsDown) && now - (v.heritT || -1e9) > 20) {
          v.heritT = now;
          this._designateHeritage(v, k);
        }
        if (mode <= 0 || v.policy?.buildings === false) continue;
        if (v.wallsPlanned && !v.wallsDown && (k.era || 0) >= 3 && now - (v.wallT || -1e9) > (industrial ? 4 : 20)) {
          v.wallT = now;
          this._ringRoad(v, k, industrial);
        }
        if (zoning) this._renewTown(v, k, now, mode);
      }
    }
  },

  // ------------------------------------------------------------ renewal
  _renewTown(v, k, now, mode) {
    // a cleared plot: the new building's site is laid out
    const P = v.renewPend;
    if (P) {
      if (now < P.at) return;
      v.renewPend = null;
      this._rebuild(v, k, P);
      return;
    }
    const site = v.renewSite != null ? this._bById.get(v.renewSite) : null;
    if (site?.alive && site.constructing) return;
    v.renewSite = null;
    if (v.tier < 1 && v.pop < 30) return;
    // pace: Urban Renewal at full pace, the law's Slow at a third; crowded towns first
    let every = (k.techs.has('renewal') ? 2.5 : 6) * YEAR * (mode === 1 ? 3 : 1);
    if (v.pop >= v.housing - 2) every *= 0.6;
    if (v.tier >= 2) every *= 0.8;
    if (now - (v.renewT ?? v.founded ?? 0) < every) return;
    const c = this._renewCandidate(v, k);
    v.renewT = now - (c ? 0 : every * 0.5);
    if (!c) return;
    const cost = costOf(c.type, c.level, v.culture);
    if (!canAfford(v, cost)) {
      v.renewT = now - every * 0.7; // try again soon
      return;
    }
    pay(v, cost);
    const old = c.b;
    v.renewPend = { tx: old.tx, ty: old.ty, rot: old.rot, type: c.type, level: c.level, at: now + 4, home: old.id, was: { id: old.id, type: old.type, level: old.level, style: old.style, era: old.builtEra ?? old.era ?? 0 } };
    // demolition: dust, and a cleared plot held for the builders
    this._fx('dust', old.x, old.z, 1.4, true);
    this._fx('debris', old.x, old.z, 0.8, true);
    this._unbuild(old, USE.RUIN);
  },

  // The building renewal replaces next (or null): homes of earlier eras or
  // low ones, the least housing for their ground first, near the centre first.
  _renewCandidate(v, k) {
    const era = k.era || 0;
    const has = (t) => k.techs.has(t);
    let best = null,
      bs = Infinity;
    const R = Math.max(4, v.radius || 8);
    for (const b of v.buildings) {
      if (!b.alive || b.constructing || b.upgrading || b.heritage || !HOMES.has(b.type) || b.abandoned) continue;
      const def = BUILDING_TYPES[b.type];
      const housing = def.housing?.[b.level - 1] || 0;
      const d = Math.hypot(b.x - v.cx, b.z - v.cz);
      // what would rise here
      let type = null,
        level = 1;
      if (has('skyscrapers') && v.tier >= 2 && d < R * 0.5 && (has('renewal') || era >= 6)) type = 'skyscraper';
      else if (has('concrete')) {
        type = 'apartment';
        level = has('skyscrapers') || has('renewal') ? 2 : 1;
      } else if (b.type === 'house') {
        type = 'house';
        level = 3;
      }
      if (!type) continue;
      const nd = BUILDING_TYPES[type];
      const nh = nd.housing?.[level - 1] || 0;
      if (nh <= housing + 2) continue;
      // an old building of the same kind is renewed only if from an earlier era
      if (type === b.type && level <= b.level && (b.era ?? 0) >= era) continue;
      if ((b.era ?? 0) >= era && b.type !== 'house' && type === b.type) continue;
      // the new footprint must fit the old one
      const fw = b.rot & 1 ? nd.h : nd.w,
        fh = b.rot & 1 ? nd.w : nd.h;
      if (fw > b.w || fh > b.h) continue;
      const s = housing / (b.w * b.h) + (d / R) * 3 - ((era - (b.era ?? 0)) * 0.6);
      if (s < bs) (bs = s), (best = { b, type, level });
    }
    return best;
  },

  _rebuild(v, k, P) {
    const w = this.world;
    const def = BUILDING_TYPES[P.type];
    const fw = P.rot & 1 ? def.h : def.w,
      fh = P.rot & 1 ? def.w : def.h;
    for (let y = P.ty; y < P.ty + fh; y++)
      for (let x = P.tx; x < P.tx + fw; x++) {
        const i = y * w.w + x;
        if (this.use[i] === USE.RUIN) this.use[i] = USE.FREE;
      }
    // (any part of the old footprint the new one leaves is freed as well)
    for (const r of v.renewFree || []) if (this.use[r] === USE.RUIN) this.use[r] = USE.FREE;
    v.renewFree = null;
    if (!this._footprintOK(P.tx, P.ty, fw, fh, 9, false)) return;
    const b = this.addBuilding(v, P.type, P.tx, P.ty, P.rot, { level: P.level, noFlatten: true });
    b.renewed = true;
    b.replaces = P.was || null; // (round 23: the inspector names what it replaces)
    v.renewSite = b.id;
    v.renewed = (v.renewed || 0) + 1;
    k.renewed = (k.renewed || 0) + 1;
    for (const u of v.members) if (u.data?.civ?.home === P.home) u.data.civ.home = b.id;
    this._firstUse(k, 'renewal', { x: b.x, z: b.z });
  },

  // Take a building off the map at once (renewal, walls): no ruin is left.
  // `hold` marks its tiles (USE.RUIN keeps a cleared plot for a new building).
  _unbuild(b, hold = USE.FREE) {
    const w = this.world;
    b.alive = false;
    b.gone = true;
    b.constructing = false;
    b.upgrading = false;
    const v = this.villages[b.village];
    const freed = [];
    for (let y = b.ty; y < b.ty + b.h; y++)
      for (let x = b.tx; x < b.tx + b.w; x++) {
        const i = y * w.w + x;
        if (w.building[i] === b.id) w.building[i] = -1;
        if (this.use[i] === USE.BUILDING || this.use[i] === USE.FREE) this.use[i] = hold;
        freed.push(i);
      }
    if (v) {
      v.buildings = v.buildings.filter((o) => o !== b);
      if (hold === USE.RUIN) v.renewFree = freed;
      this._updateVillageDerived(v);
    }
    const ix = this.buildings.indexOf(b);
    if (ix >= 0) this.buildings.splice(ix, 1);
    this._bById.delete(b.id);
    this.version++;
    this.stateVersion++;
  },

  // ------------------------------------------------------------ walls to ring roads
  // A town that has outgrown its walls (a third of its buildings outside),
  // or whose realm has entered the Industrial era, takes them down a few
  // sections at a time; the ring road follows their line and a gatehouse stays.
  _ringRoad(v, k, industrial) {
    const walls = [];
    for (const b of v.buildings) if (b.alive && BUILDING_TYPES[b.type].wall && b.type !== 'bridge') walls.push(b);
    if (!walls.length) return;
    if (!industrial) {
      // outgrown? the ring's mean radius against the town's buildings
      let r = 0;
      for (const b of walls) r += Math.hypot(b.x - v.cx, b.z - v.cz);
      r /= walls.length;
      let n = 0,
        out = 0;
      for (const b of v.buildings) {
        if (!b.alive || BUILDING_TYPES[b.type].wall || b.type === 'docks' || b.type === 'bridge') continue;
        n++;
        if (Math.hypot(b.x - v.cx, b.z - v.cz) > r + 1.5) out++;
      }
      if (n < 10 || out < n * 0.34 || (k.era || 0) < 3) return;
    }
    v.wallPlan = []; // no more sections are raised
    // a gatehouse stays as heritage (the one nearest the hall)
    if (!walls.some((b) => b.heritage)) {
      let gate = null,
        gd = Infinity;
      for (const b of walls) {
        if (b.type !== 'gate' || b.heritageOff) continue;
        const d = v.hall ? Math.hypot(b.x - v.hall.x, b.z - v.hall.z) : 0;
        if (d < gd) (gd = d), (gate = b);
      }
      if (gate) gate.heritage = { since: Math.floor(this.game.time.total / YEAR), built: Math.floor((gate.builtAt || 0) / YEAR) };
    }
    let n = 0;
    for (const b of walls) {
      if (n >= 3) break;
      if (b.heritage) continue;
      const tiles = [];
      for (let y = b.ty; y < b.ty + b.h; y++) for (let x = b.tx; x < b.tx + b.w; x++) tiles.push(y * this.world.w + x);
      this._fx('dust', b.x, b.z, 0.9, true);
      this._unbuild(b);
      if (this.law('civRoads')) for (const i of tiles) this.layRoad(v, i);
      n++;
    }
    this.fieldVersion++;
    if (!v.buildings.some((b) => b.alive && BUILDING_TYPES[b.type].wall && b.type !== 'bridge' && !b.heritage)) {
      v.wallsDown = true;
      this._firstUse(k, 'ringroad', { x: v.cx, z: v.cz });
      this._history(`🛣 ${v.name} takes down its walls: a ring road follows their line`, 'info', { x: v.cx, z: v.cz });
    }
  },

  // ------------------------------------------------------------ heritage
  // The realm chooses what to keep: wonders, the oldest hall or temple, and a
  // few of the oldest houses of the core; with Heritage Conservation more of
  // the old civic buildings and houses, restored.
  _designateHeritage(v, k) {
    const year = Math.floor(this.game.time.total / YEAR);
    const cons = k.techs.has('heritage');
    const mark = (b) => {
      if (!b || b.heritage || b.heritageOff || !b.alive || b.constructing) return false;
      b.heritage = { since: year, built: Math.floor((b.builtAt || 0) / YEAR) };
      this.version++;
      this._firstUse(k, 'heritage', { x: b.x, z: b.z });
      return true;
    };
    let oldest = null;
    const houses = [];
    const R = Math.max(4, (v.radius || 8) * 0.6);
    for (const b of v.buildings) {
      if (!b.alive || b.constructing) continue;
      if (BUILDING_TYPES[b.type].monument) mark(b);
      else if ((b.type === 'hall' || b.type === 'temple') && (!oldest || (b.builtAt || 0) < (oldest.builtAt || 0))) oldest = b;
      else if (b.type === 'house' && Math.hypot(b.x - v.cx, b.z - v.cz) < R) houses.push(b);
      else if (cons && HERITAGE_CIVIC.has(b.type) && (b.era ?? 0) <= 3) mark(b);
    }
    mark(oldest);
    if (v.tier < 1) return;
    houses.sort((a, b) => (a.builtAt || 0) - (b.builtAt || 0));
    // (round 31) in the Modern eras only the oldest one or two houses stay as
    // heritage: rows of Victorian houses had stood in Future towns. The
    // houses the realm chose beyond that are let go (newest first) and renew
    // with the rest; the player's own choices are kept.
    const modern = (k.era || 0) >= 5;
    const want = modern ? (cons ? 2 : 1) : (cons ? 5 : 2) + (v.tier >= 2 ? 1 : 0);
    let have = 0;
    for (const b of v.buildings) if (b.alive && b.type === 'house' && b.heritage) have++;
    if (modern && have > want) {
      const mine = v.buildings.filter((b) => b.alive && b.type === 'house' && b.heritage && !b.heritage.player);
      mine.sort((a, b) => (b.builtAt || 0) - (a.builtAt || 0));
      for (const b of mine) {
        if (have <= want) break;
        delete b.heritage;
        b.restored = false;
        have--;
        this.version++;
      }
    }
    for (const b of houses) {
      if (have >= want) break;
      if (mark(b)) have++;
    }
    // Heritage Conservation: the chosen buildings are restored
    if (cons)
      for (const b of v.buildings)
        if (b.alive && b.heritage && !b.restored) {
          b.restored = true;
          b.hp = b.maxHp;
          b.abandoned = false;
        }
  },
};
