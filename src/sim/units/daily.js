import { simWeather } from '../disasters/util.js';
import { SEA_LEVEL } from '../../world/constants.js';
import { UNIT } from '../../core/scale.js';

// Daily life (Life module, docs/DAILY-LIFE.md): the everyday round of village
// people on top of their work. A daily rhythm (sleep at night, three meals,
// work by day, social evenings and festival nights) shifted by season and
// weather, and needs (hunger, energy, a cheap social need) choose between
// short EPISODES: eating, chatting, laughing, singing, dancing, courting,
// minding the children, playing, praying, thinking, reading, waiting,
// shopping, a discreet visit to the privy, mourning and celebrating.
//
// An episode is one small object on the person (u._dl) and takes over from
// the village brain while it lasts (Units._think: needs, roles, then this,
// then Civ's brain). Episodes only change state, heading, a target and
// u.activity; the renderer poses them and draws small icons near the camera,
// so far away they cost a label and a few comparisons per think.
//
//   u._dl = {k: kind, until, ph: 'go'|'do', x, z, fx, fz (face), g (group key),
//            w (with: unit id), lab (label while doing), go (label on the way)}
//   u.activity: 'talk' | 'laugh' | 'sing' | 'dance' | 'cheer' | 'pray' | 'think'
//            | 'read' | 'wait' | 'shop' | 'mourn' | 'mind' | 'court' | 'sit'
//            | 'play' | 'eat' (renderer poses, see poses.js)
//   u._hid   true while out of sight (the privy): not drawn, not picked
//
// Village helpers (cached per village and game day): the square (market,
// else the hall), the temple, the docks, the station, festival nights.

const ADULT = 16;
// day episodes the evening ends (round 19)
const DAY_EP = new Set(['inside', 'chore', 'shop', 'wait', 'school', 'hold']);
// episodes a soldier keeps when the drill begins
const SOLDIER_KEEP = new Set(['drill', 'guard', 'privy', 'eat', 'mourn', 'cheer']);
const DAY_S = 360; // game seconds per day (src/core/Game.js DAY_SECONDS)
const H = DAY_S / 24; // game seconds per hour
const MEAL = [
  ['breakfast', 'Eating breakfast'],
  ['lunch', 'Having lunch'],
  ['supper', 'Having supper'],
];
const BUY = ['Buying bread', 'Buying fish', 'Buying cloth', 'Haggling at the market', 'Buying apples', 'Buying salt'];
const ACT_LABEL = {
  talk: 'Chatting',
  laugh: 'Laughing',
  sing: 'Singing',
  dance: 'Dancing',
  cheer: 'Celebrating',
  pray: 'Praying',
  think: 'Thinking',
  read: 'Reading',
  wait: 'Waiting',
  shop: 'Shopping',
  mourn: 'Mourning',
  mind: 'Minding the children',
  court: 'Courting',
  sit: 'Sitting alone',
  play: 'Playing tag',
  eat: 'Eating',
};

// Places of work in modern towns, where the jobless spend a working day out of sight.
const WORK_LAB = {
  factory: 'At work in the factory',
  cannery: 'At work in the cannery',
  powerstation: 'At work at the power station',
  nuclear: 'At work at the power plant',
  fusion: 'At work at the power plant',
  skyscraper: 'At the office',
  arcology: 'At the office',
  controlspire: 'At the office',
  campus: 'At work in the laboratory',
  genelab: 'At work in the laboratory',
  hospital: 'At work in the hospital',
  clinic: 'At work in the clinic',
  station: 'At work at the station',
  airport: 'At work at the airport',
  containerport: 'At work at the port',
  greenhouse: 'At work in the greenhouse',
  vertfarm: 'At work in the vertical farm',
  waterworks: 'At work at the waterworks',
};

function frac(x) {
  return x - Math.floor(x);
}
function hash(a, b = 0) {
  let x = (a * 374761393 + b * 668265263) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
function first(name) {
  return name ? String(name).split(' ')[0] : 'a friend';
}

export function installDaily(Units) {
  const P = Units.prototype;

  // ---- the clock -------------------------------------------------------------
  // Hour of day and whether the clock runs (a pinned ?hour= keeps the old
  // daylight rule, so screenshots at a fixed hour behave as before).
  P._clock = function () {
    const g = this.game;
    return { h: g.time.hour ?? 12, live: !!g.settings?.dayNight, day: g.time.day | 0 };
  };
  // Wet or snowy weather shortens the evening out of doors.
  P._wet = function () {
    const g = this.game;
    if (this._wetT === ((g.time.total / 4) | 0)) return this._wetV;
    this._wetT = (g.time.total / 4) | 0;
    let w = 0;
    try {
      const W = simWeather(g);
      if (W && (W.type === 'rain' || W.type === 'storm' || W.type === 'snow')) w = Math.min(1, W.intensity ?? 0.6);
    } catch (e) {
      w = 0;
    }
    this._wetV = w;
    return w;
  };
  // A person's bedtime and waking hour: the season, the weather, age and a
  // personal lean (some are early birds, some night owls).
  P._sleepHours = function (u) {
    const off = hash(u.id, 3);
    const s = Math.floor(this.game.time.season ?? 1) % 4;
    const wet = this._wet();
    let bed = 20.7 + off * 1.3 + (s === 1 ? 0.4 : s === 3 ? -0.8 : 0) - wet * 0.9;
    if (u.age < ADULT) bed -= 1.3 - Math.min(1, u.age / ADULT) * 0.6;
    else if (u.age > 58) bed -= 0.5;
    // the evening's regulars keep the main square until half past nine in any
    // season or weather (round 23: in winter, or in the rain, everyone used
    // to be abed by 20:30 and the square stood empty)
    else if (this._owl(u)) bed = Math.max(bed, 21.55 + hash(u.id, 61) * 0.4);
    const wake = 5.2 + hash(u.id, 4) * 1.0 + (s === 3 ? 0.5 : 0);
    return { bed, wake };
  };
  // One of tonight's regulars on the town's main square: about sixteen of
  // the grown-ups, a different few each day (soldiers on duty keep their own
  // hours). v._owlP is the share, set with the village places.
  P._owl = function (u) {
    if (u.job === 'soldier' || u.job === 'king' || u.data.robot || !(u.village >= 0)) return false;
    const v = this.game.civ?.villages?.[u.village];
    if (!v || !v.alive) return false;
    const p = v._owlP ?? ((v.pop || 0) >= 10 ? Math.min(1, 20 / Math.max(1, v.pop * 0.5)) : 0);
    return hash(u.id, (this.game.time.day | 0) * 7 + 77) < p;
  };
  // Bedtime now? (the hour runs: by the person's hours; pinned: by daylight)
  P._bedtime = function (u) {
    const c = this._clock();
    if (!c.live) return this.daylight() < 0.16;
    const { bed, wake } = this._sleepHours(u);
    return c.h >= bed || c.h < wake;
  };

  // ---- village places (cached per village per game day) ---------------------
  P._dlPlaces = function (v) {
    const g = this.game;
    const M = this._dlV || (this._dlV = new Map());
    const day = g.time.day | 0;
    let c = M.get(v.id);
    if (c && c.day === day && g.time.total - c.t < 90 && c.nb === v.buildings.length) return c;
    if (!c) M.set(v.id, (c = {}));
    c.day = day;
    c.t = g.time.total;
    c.nb = v.buildings.length;
    c.barracks = null;
    let market = null,
      temple = null,
      docks = null,
      station = null,
      library = null,
      hall = null,
      plaza = null,
      park = null,
      houses = 0;
    c.pasture = null;
    c.well = null;
    c.work = [];
    c.homes = [];
    for (const b of v.buildings) {
      if (!b.alive || b.constructing || b.doorX == null) continue;
      const t = b.type;
      if (t === 'market') market = market || b;
      else if (t === 'temple') temple = temple || b;
      else if (t === 'docks') docks = docks || b;
      else if (t === 'station') station = station || b;
      else if (t === 'library' || t === 'academy' || t === 'campus') library = library || b;
      else if (t === 'hall') hall = c.hallB = b;
      else if (t === 'plaza') plaza = plaza || b;
      else if (t === 'barracks') c.barracks = c.barracks?.alive && c.barracks !== b ? c.barracks : b;
      else if (t === 'house' || t === 'rowhouse' || t === 'apartment') {
        houses++;
        if (c.homes.length < 24) c.homes.push(b);
      } else if (t === 'pasture') c.pasture = c.pasture || b;
      else if (t === 'well' || t === 'qanat') c.well = c.well || b;
      else if (t === 'park') park = park || b;
      if (WORK_LAB[t] && c.work.length < 16) c.work.push(b);
    }
    const sq = plaza || market || hall;
    // the square: in front of the market (or the hall), a step out from the door
    let sx = v.cx + 0.5,
      sz = v.cz + 0.5;
    if (sq) {
      const dx = sq.doorX - (sq.x ?? sq.doorX),
        dz = sq.doorZ - (sq.z ?? sq.doorZ);
      const l = Math.hypot(dx, dz) || 1;
      sx = sq.doorX + (dx / l) * 1.6;
      sz = sq.doorZ + (dz / l) * 1.6;
    }
    c.sq = { x: sx, z: sz };
    // the evening's squares: the main one, then the hall, a park and the temple
    // when they stand apart (a big town's crowd spreads over them in groups)
    c.sqs = [c.sq];
    for (const b of [hall, park, temple]) {
      if (!b || b === sq || c.sqs.length >= 1 + Math.floor((v.pop || 6) / 40)) continue;
      const dx = b.doorX - (b.x ?? b.doorX),
        dz = b.doorZ - (b.z ?? b.doorZ);
      const l = Math.hypot(dx, dz) || 1;
      const p = { x: b.doorX + (dx / l) * 1.6, z: b.doorZ + (dz / l) * 1.6 };
      if (c.sqs.every((q) => (q.x - p.x) ** 2 + (q.z - p.z) ** 2 > 16)) c.sqs.push(p);
    }
    // benches and a food stall about the main square of a town (round 19;
    // drawn by the units renderer's prop batch from v._props)
    c.props = null;
    if ((v.pop || 0) >= 10) c.props = v._props = this._dlProps(v, c.sq, c.era);
    else v._props = null;
    c.market = market;
    c.temple = temple;
    c.docks = docks;
    c.station = station;
    c.library = library;
    c.houses = houses;
    const K = g.civ?.kingdoms?.[v.kingdom];
    c.era = K?.era || 0;
    const war = v.kingdom >= 0 && (g.civ?.warCount?.(v.kingdom) || 0) > 0;
    c.war = war;
    const golden = K && g.time.total < (K.goldenUntil || 0);
    // festival nights: one in four (one in two in a golden age), never in war or famine
    c.fest = !war && !v.starving && ((day + v.id) % (golden ? 2 : 4) === 0);
    // the harvest festival in early autumn
    const s = g.time.season ?? 1.5;
    c.harvest = c.fest && s >= 2 && s < 2.6;
    c.groups = Math.max(1, Math.min(8 * c.sqs.length, Math.round((v.pop || 6) / 5)));
    // tonight's regulars on the main square (see _owl): enough grown-ups that
    // twelve to fifteen of them are there through the evening
    v._owlP = (v.pop || 0) >= 10 ? Math.min(1, 20 / Math.max(1, (v.pop || 6) * 0.5)) : 0;
    return c;
  };

  // Benches and a food stall round a square: free land tiles at the edge of
  // the gathering, facing in. {stall: {x, z, rot} | null, benches: [...]}
  P._dlProps = function (v, sq, era) {
    const old = v._props;
    if (old && Math.abs(old.sx - sq.x) < 0.01 && Math.abs(old.sz - sq.z) < 0.01 && old.era === era) return old;
    const w = this.game.world;
    const ok = (x, z) => {
      const tx = Math.floor(x),
        tz = Math.floor(z);
      if (!w.inBounds(tx, tz)) return false;
      const i = tz * w.w + tx;
      return w.building[i] < 0 && w.height[i] > SEA_LEVEL + 0.05 && !rm?.[i];
    };
    const rm = this.game.civ?.railMask?.length === w.size ? this.game.civ.railMask : null;
    const used = [];
    const place = (r, a0) => {
      for (let k = 0; k < 12; k++) {
        const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.45;
        const x = sq.x + Math.sin(a) * r,
          z = sq.z + Math.cos(a) * r;
        if (!ok(x, z) || used.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 0.8)) continue;
        const p = { x, z, rot: Math.atan2(sq.x - x, sq.z - z) };
        used.push(p);
        return p;
      }
      return null;
    };
    const a0 = hash(v.id, 31) * Math.PI * 2;
    const stall = place(2.7, a0);
    const benches = [];
    for (const da of [2.0, -2.0, Math.PI]) {
      const b = place(2.3, a0 + da);
      if (b) benches.push(b);
    }
    return { sx: sq.x, sz: sq.z, era, stall, benches, y: w.heightAt(sq.x, sq.z) };
  };

  // A free standing spot near (x, z) for this person (not in a building or the water).
  P._dlSpot = function (u, x, z, r = 3) {
    const w = this.game.world;
    const tx = Math.floor(x),
      tz = Math.floor(z);
    // (round 25: on dry ground only: people stood about in the surf off sea
    // fronts and by the jetties, the shallows being walkable)
    const dry = (i) => w.height[i] > SEA_LEVEL + 0.03;
    if (w.inBounds(tx, tz) && w.building[tz * w.w + tx] < 0 && dry(tz * w.w + tx) && w.heightAt(x, z) > SEA_LEVEL && this._pathable(u, tx, tz)) return { x, z };
    const t = this.findNearestTile(x, z, r, (ax, ay, i) => w.building[i] < 0 && dry(i) && this._pathable(u, ax, ay));
    return t ? { x: t.x + (hash(u.id, 9) - 0.5) * 0.5, z: t.z + (hash(u.id, 10) - 0.5) * 0.5 } : null;
  };

  // ---- the parade square (round 19) ------------------------------------------
  // Soldiers drill together in ranks of up to six on a paved square before the
  // barracks (or the hall), facing it, in step (the renderer's 'drill' pose
  // runs on the shared clock). v._parade = {b, ok, x, z, ax, az (out from the
  // door), W, D, slots: unit ids}. The renderer paves it (units/props).
  // (round 23) ONE parade square per town, whichever building asks (the
  // barracks first, else the hall): the barracks and the hall used to be
  // tried in turn and each overwrote the other's square, so the ranks were
  // reset and the site searched again on every call; and the site had to lie
  // straight before the door on nearly level ground, which 16 of 19 Modern
  // towns on seed 7 did not have, so drill almost never happened there. Now
  // the search walks all four sides of the barracks and the hall, out to
  // about six tiles and along each side, and takes the most level site near
  // the door (a free or paved tile, never a field, a railway or the water).
  P._parade = function (v, b0) {
    const g = this.game;
    const now = g.time.total;
    const pl = this._dlPlaces(v);
    const cands = [];
    for (const b of [pl.barracks, pl.hallB || v.hall, b0]) if (b && b.alive !== false && b.doorX != null && !cands.includes(b)) cands.push(b);
    if (!cands.length) return null;
    const key = cands.map((b) => b.id).join(':');
    let pd = v._parade;
    if (pd && pd.key === key && now - pd.t < (pd.ok ? 90 : 60)) return pd.ok ? pd : null;
    const w = g.world;
    const rm = g.civ?.railMask?.length === w.size ? g.civ.railMask : null; // never across a railway or highway
    const use = g.civ?.use?.length === w.size ? g.civ.use : null;
    const kc = g.civ?.keepClear?.length === w.size ? g.civ.keepClear : null;
    const free = (x, z) => {
      const tx = Math.floor(x),
        tz = Math.floor(z);
      if (!w.inBounds(tx, tz)) return -1;
      const i = tz * w.w + tx;
      if (w.building[i] >= 0 || w.height[i] <= SEA_LEVEL + 0.05 || rm?.[i]) return -1;
      const us = use ? use[i] : 0;
      // open ground only (round 25: the pad lay over the cobbled streets on
      // two sides and over a Future plaza): never a street or the square
      return us === 0 && !(kc && kc[i] & 1) ? 0 : -1;
    };
    const sq = pl.sq;
    let best = null,
      bs = 1e9;
    for (let bi = 0; bi < cands.length; bi++) {
      const b = cands[bi];
      const bx = b.x ?? b.doorX,
        bz = b.z ?? b.doorZ;
      const dx = b.doorX - bx,
        dz = b.doorZ - bz;
      const L = Math.hypot(dx, dz) || 1;
      const ux = dx / L,
        uz = dz / L;
      const hw = (b.w || 1) / 2,
        hh = (b.h || 1) / 2;
      // (round 25: sized to two ranks of six half-size soldiers with room
      // round them; the 3.4 x 2.4 pad was some forty soldiers across)
      // (round 27: and a smaller pad on rougher ground, further out: drill
      // fell from 23% of a soldier's day to 8% once the pad kept off streets)
      for (const [W, D, flat] of [
        [2.4, 1.6, 0.2],
        [2.0, 1.4, 0.3],
        [1.7, 1.2, 0.42],
      ])
        for (const [ax, az] of [
          [ux, uz],
          [-uz, ux],
          [uz, -ux],
          [-ux, -uz],
        ]) {
          // out from the building's side, the ranks facing it
          const half = Math.abs(ax) > 0.5 ? hw : hh;
          const door = ax * ux + az * uz > 0.5;
          for (let k = 0; k < (W < 1.9 ? 13 : 9); k++) {
            const dist = half + 0.35 + D / 2 + k * 0.55;
            for (const lat of W < 1.9 ? [0, -1, 1, -2, 2, -3, 3, -4, 4] : [0, -1, 1, -2, 2, -3, 3]) {
              const cx = bx + ax * dist - az * lat,
                cz = bz + az * dist + ax * lat;
              // not on the evening square's gathering
              if ((cx - sq.x) ** 2 + (cz - sq.z) ** 2 < 6.5 && cands[bi] !== pl.barracks) continue;
              let ok = true,
                lo = 1e9,
                hi = -1e9,
                paved = 0;
              for (let a = -0.5; a <= 0.5 && ok; a += 0.25)
                for (let c = -0.5; c <= 0.5 && ok; c += 0.5) {
                  const x = cx - az * a * W + ax * c * D,
                    z = cz + ax * a * W + az * c * D;
                  const f = free(x, z);
                  if (f < 0) ok = false;
                  else {
                    paved += f;
                    const h = w.heightAt(x, z);
                    if (h < lo) lo = h;
                    if (h > hi) hi = h;
                  }
                }
              if (!ok || hi - lo >= flat) continue;
              const s = (hi - lo) * 6 + k * 0.35 + Math.abs(lat) * 0.3 + paved * 0.05 + (door ? 0 : 0.6) + bi * 1.5 + (W < 2.2 ? 0.8 : 0) + (W < 1.9 ? 1.6 : 0);
              if (s < bs) {
                bs = s;
                best = { b: b.id, key, ok: true, x: cx, z: cz, ax, az, W, D, y: hi, lo, slots: [], t: now, v: v.id, type: b.type };
              }
            }
          }
        }
    }
    // the ranks already formed keep their places when the site holds
    if (best && pd && pd.ok && Math.abs(pd.x - best.x) < 0.01 && Math.abs(pd.z - best.z) < 0.01) {
      pd.key = key;
      pd.t = now;
      return pd;
    }
    v._parade = best || { b: cands[0].id, key, ok: false, t: now };
    return best;
  };
  // This soldier's place in the ranks (null: the ranks are full). Six to a
  // rank, filled from the middle out; places of those no longer drilling free up.
  const COLS = [2, 3, 1, 4, 0, 5];
  P._paradeSlot = function (pd, u) {
    const live = (id) => {
      const o = this.byId.get(id);
      return o && o.alive && ((o._dl && o._dl.pd === pd) || (o._offd && o._offd.pd === pd));
    };
    let i = pd.slots.indexOf(u.id);
    if (i < 0) {
      for (let k = 0; k < pd.slots.length; k++) if (pd.slots[k] !== u.id && !live(pd.slots[k])) pd.slots[k] = -1;
      i = pd.slots.indexOf(-1);
      if (i < 0) {
        if (pd.slots.length >= 12) return null;
        i = pd.slots.length;
        pd.slots.push(u.id);
      } else pd.slots[i] = u.id;
    }
    // (round 25: the places fill both ranks in turn, so four soldiers stand
    // two by two and twelve in two ranks of six, never four in one file)
    const row = i % 2,
      col = (COLS[Math.floor(i / 2) % 6] - 2.5) * Math.min(pd.W / 6.8, 0.75 * UNIT.scale);
    // two ranks of six (round 23: 6-12 to a square), rank 0 nearest the
    // barracks; everyone faces it
    const f = (row - 0.5) * Math.min(pd.D / 2.9, 1.5 * UNIT.scale);
    return { x: pd.x - pd.az * col + pd.ax * f, z: pd.z + pd.ax * col + pd.az * f, fx: pd.x - pd.ax * 9, fz: pd.z - pd.az * 9 };
  };
  // Drill hours: the morning parade and the afternoon one.
  P._drillHours = function (h = this.game.time.hour ?? 12) {
    return (h >= 8 && h < 11) || (h >= 13.5 && h < 16.3);
  };
  // Game seconds left in this drill (the morning or the afternoon parade).
  P._drillLeft = function () {
    const h = this.game.time.hour ?? 12;
    const end = h < 11 ? 11 : 16.3;
    return Math.max(0, (end - h) * H);
  };
  // Drilling now on this square (in the ranks or falling in).
  P._drillN = function (pd, not) {
    let n = 0;
    for (const id of pd.slots) {
      const o = id >= 0 ? this.byId.get(id) : null;
      if (o && o !== not && o.alive && ((o._dl && o._dl.pd === pd) || (o._offd && o._offd.pd === pd))) n++;
    }
    return n;
  };
  // (round 21) A soldier free in the drill hours falls in on the town's
  // parade square (before the barracks, else the hall) while the ranks have
  // a place: true when a drill episode began. Called on every decision in
  // the drill hours, not only as they begin (at 10:30 three soldiers drilled
  // in the whole world against 91 on guard).
  // (round 23) The off-duty half fill the ranks to twelve; guards on duty
  // top them up only to six, so the posts stay manned. A soldier who falls
  // in stays until the drill ends (a spell of half an hour used to leave the
  // ranks thin), and the square is the town's one parade square.
  P._drillJoin = function (u, v, pl, need = 12) {
    if (!this.game.settings?.dayNight || !this._drillHours() || pl.war) return false;
    if (u.kingdom >= 0 && (this.game.civ?.warCount?.(u.kingdom) || 0) > 0) return false;
    const pb = pl.barracks || pl.hallB || v.hall;
    if (!pb || pb.alive === false || pb.doorX == null) return false;
    const pd = this._parade(v, pb);
    if (!pd) return false;
    if ((u.id & 1) === 0) need = Math.min(need, 6);
    if (this._drillN(pd, u) >= need) return false;
    const spot = this._paradeSlot(pd, u);
    if (!spot) return false;
    const era = this.game.civ?.kingdoms?.[v.kingdom]?.era || 0;
    const lab = pd.type === 'barracks' ? 'Drilling on the parade square' : era >= 4 ? 'Drilling on the parade ground' : 'Drilling on the square';
    const left = this._drillLeft();
    const dl = this._dlStart(u, 'drill', Math.max(10, left - 1 + Math.random() * 2), { lab, act: null, x: spot.x, z: spot.z, free: true, fx: spot.fx, fz: spot.fz, go: 'Falling in for drill' });
    dl.anim = 'drill';
    dl.nt = false;
    dl.pd = pd;
    if (dl.ph === 'do') this._dlArrive(u, dl);
    return true;
  };

  // ---- episodes ---------------------------------------------------------------
  P._dlStart = function (u, k, dur, opts = {}) {
    const now = this.game.time.total;
    this.stop(u);
    u.busyUntil = 0;
    u.data.workAnim = null;
    u.activity = null;
    const dl = (u._dl = {
      k,
      until: now + dur,
      ph: 'do',
      x: u.x,
      z: u.z,
      fx: null,
      fz: null,
      g: opts.g ?? 0,
      w: opts.w ?? 0,
      lab: opts.lab || null,
      go: opts.go || null,
      act: opts.act === null ? null : opts.act || k,
      tries: 0,
      t0: now,
      h0: this.game.time.hour ?? 12,
    });
    if (opts.x != null) {
      const s = opts.free ? { x: opts.x, z: opts.z } : this._dlSpot(u, opts.x, opts.z);
      if (s && (s.x - u.x) ** 2 + (s.z - u.z) ** 2 > 0.3) {
        dl.x = s.x;
        dl.z = s.z;
        dl.ph = 'go';
        if (!this.moveTo(u, s.x, s.z)) dl.ph = 'do';
        else u.state = 'walk';
      } else if (s) {
        dl.x = s.x;
        dl.z = s.z;
      }
    }
    if (opts.fx != null) {
      dl.fx = opts.fx;
      dl.fz = opts.fz;
    }
    if (dl.ph === 'do') this._dlArrive(u, dl);
    return dl;
  };
  P._dlEnd = function (u) {
    const dl = u._dl;
    u._dl = null;
    if (u._hid) u._hid = false;
    if (dl && u.activity && u.activity !== 'fish') u.activity = null;
    if (dl && (dl.k === 'chore' || dl.k === 'drill')) {
      u.data.workAnim = null;
      if (u.state === 'work') u.state = 'idle';
    }
    if (u.state === 'eat' || u.state === 'idle') u.state = 'idle';
    u.busyUntil = 0;
  };
  P._dlArrive = function (u, dl) {
    dl.ph = 'do';
    if (dl.k === 'goto' && dl.then === 'play') {
      dl.k = 'play';
      dl.act = 'play';
      dl.lab = (u.id + (this.game.time.day | 0)) % 3 === 0 ? 'Playing ball' : 'Playing tag';
    }
    this.stop(u);
    u.state = dl.k === 'eat' ? 'eat' : 'idle';
    u.activity = dl.act;
    if (dl.fx != null) u.heading = Math.atan2(dl.fx - u.x, dl.fz - u.z);
    if (dl.k === 'privy' || dl.k === 'school' || dl.k === 'inside') {
      u._hid = true;
      u.activity = null;
    }
    if (dl.k === 'chore' || dl.k === 'drill') {
      u.state = 'work';
      u.activity = null;
      u.data.workAnim = dl.anim;
    }
  };

  // Called from Units._think for village people (after needs and roles).
  // Returns true while an episode holds the person.
  P._dailyThink = function (u, now, elapsed) {
    if (u.combat || u.state === 'flee' || u.data.aboard != null || u.data.inside || u.swimming || u.data.robot || u._space > 0 || u._brigade > now) {
      if (u._dl) this._dlEnd(u);
      return false;
    }
    const d = u.data;
    const civ = this.game.civ;
    if (!civ || u.village < 0) return false;
    const v = civ.villages?.[u.village];
    if (!v || !v.alive) {
      if (u._dl) this._dlEnd(u);
      return false;
    }
    if (d.civ?.task && (d.civ.task.kind === 'migrate' || d.civ.task.kind === 'arrive')) return false;
    if (d.civ?.army != null || (d.ride && d.ride.phase !== 'home')) {
      if (u._dl) this._dlEnd(u);
      return false;
    }
    // bedtime, yet not on the way home (a nap outdoors just ended): none of the
    // day's work or play this think (it used to start a chore, a game or school
    // in the small hours); the walk home follows from needs.js
    if (u.job !== 'soldier' && !d.robot && this.game.settings?.dayNight && this._bedtime(u)) {
      if (u._dl) this._dlEnd(u);
      this.stop(u);
      u.state = 'idle';
      return true;
    }
    // children grow up while they play (the village brain ages them, see civ/brain.js)
    const child = u.age < ADULT;
    if (child && u._dl && !u.flags?.frozenAge && !d.frozenAge) u.age += ((elapsed || 0) / 30) * 1.7;
    // the evening begins: the day's errands end (indoors at work or a
    // neighbor's, a chore, the market, school), so the town comes out to the
    // square at dusk (round 19; also when the clock is set straight to evening)
    if (u._dl && DAY_EP.has(u._dl.k) && u.job !== 'soldier' && this.game.settings?.dayNight) {
      const h = this.game.time.hour ?? 12;
      const e0 = 16.9 + hash(u.id, 6) * 0.6;
      if (h >= e0 && u._dl.h0 < e0 - 0.05 && h < 23) {
        this._dlEnd(u);
        u._dlNext = now;
      }
    }
    // (round 23) the drill hours begin: an off-duty soldier busy with the
    // morning's errands (or caught by a jump of the clock) falls in
    if (u._dl && u.job === 'soldier' && ((u.id & 1) === 1 ? !SOLDIER_KEEP.has(u._dl.k) : u._dl.k === 'guard') && this.game.settings?.dayNight && this._drillHours() && !this._drillHours(u._dl.h0)) {
      this._dlEnd(u);
      u._dlNext = now;
    }
    if (u._dl) {
      if (now < u._dl.until && this._dlStep(u, now, v)) return true;
      const was = u._dl.k;
      const sq0 = !!u._dl.sq0;
      this._dlEnd(u);
      // after a chore the brain looks for real work this think; if it has
      // none, the next think finds another chore (no idle gap between them);
      // one of the square's crowd finds a new place in it at once
      u._dlNext = was === 'chore' || was === 'school' || sq0 || (child && was !== 'goto') ? now + 0.5 : now + (child ? 1.5 : 4) + hash(u.id, (now * 7) | 0) * 4;
      return false;
    }
    if (now < u._dlNext) return false;
    u._dlNext = now + 2.5 + Math.random() * 3;
    return this._dlDecide(u, now, v, child);
  };

  // One think inside an episode: walking there, then doing it.
  P._dlStep = function (u, now, v) {
    const dl = u._dl;
    if (dl.ph === 'go') {
      // a person of a realm at war breaks off when the enemy comes near
      if (this._dlThreat(u, v)) return false;
      if (!u.target && !u.path) {
        const dd = (dl.x - u.x) ** 2 + (dl.z - u.z) ** 2;
        if (dd < 0.7 || ++dl.tries > 2) this._dlArrive(u, dl);
        else if (!this.moveTo(u, dl.x, dl.z)) this._dlArrive(u, dl);
        else u.state = 'walk';
      } else if (u.state !== 'walk' && u.state !== 'run') u.state = 'walk';
      // a long walk counts down only once there
      if (dl.ph === 'go') dl.until = Math.max(dl.until, now + 2);
      return true;
    }
    if (this._dlThreat(u, v)) return false;
    const r = Math.random();
    switch (dl.k) {
      case 'social': {
        // the evening round: talk, laugh, sing, dance on festival nights
        const pl = this._dlPlaces(v);
        const happy = u.hunger < 0.5 && u.energy > 0.25 && !u.statuses?.has('mourning');
        let a;
        const hr = this.game.time.hour ?? 19;
        if (dl.bench) {
          u.activity = r < 0.8 ? 'sit' : 'laugh';
          dl.lab = 'Sitting on a bench';
          if (dl.fx != null) u.heading = Math.atan2(dl.fx - u.x, dl.fz - u.z);
          return true;
        }
        if (dl.music) a = 'sing';
        else if (dl.supper && hr < 20.2) a = 'eat';
        else if (pl.fest) a = r < 0.38 ? 'dance' : r < 0.58 ? 'sing' : r < 0.74 ? 'laugh' : r < 0.84 ? 'cheer' : 'talk';
        else a = r < 0.56 ? 'talk' : r < (happy ? 0.76 : 0.64) ? 'laugh' : r < (happy ? 0.86 : 0.7) ? 'sing' : 'talk';
        if (!happy && r > 0.9 && !dl.music) a = 'sit';
        u.activity = a;
        dl.lab = dl.music ? (pl.era >= 5 ? 'Playing guitar on the square' : 'Playing music on the square') : a === 'eat' ? (dl.sq0 && pl.props?.stall ? 'Eating at the food stall' : 'Sharing supper on the square') : a === 'talk' ? (dl.wn ? `Chatting with ${dl.wn}` : dl.lab0 || (pl.market ? 'Gossiping at the market' : 'Chatting')) : a === 'cheer' ? (pl.harvest ? 'Celebrating the harvest' : 'Celebrating the festival') : a === 'sing' && pl.fest ? 'Singing at the festival' : null;
        if (dl.fx != null) u.heading = Math.atan2(dl.fx - u.x, dl.fz - u.z);
        return true;
      }
      case 'play': {
        // tag: dash about the play spot, now and then stop for breath and laugh
        if (!u.target) {
          if (r < 0.75) {
            const a = Math.random() * Math.PI * 2,
              rr = 0.6 + Math.random() * 1.6;
            const tx = dl.cx + Math.sin(a) * rr,
              tz = dl.cz + Math.cos(a) * rr;
            const w = this.game.world;
            const ti = Math.floor(tz) * w.w + Math.floor(tx);
            if (w.building[ti] < 0 && this._pathable(u, Math.floor(tx), Math.floor(tz))) {
              u.target = { x: tx, z: tz };
              u.path = null;
              u.state = 'run';
              u.activity = 'play';
            }
          } else {
            u.state = 'idle';
            u.activity = 'laugh';
          }
        }
        return true;
      }
      case 'court': {
        // a stroll side by side, then sitting together
        const p = this.byId.get(dl.w);
        if (!p || !p.alive || !p._dl || p._dl.w !== u.id) return false;
        const dx = p.x - u.x,
          dz = p.z - u.z;
        const d2 = dx * dx + dz * dz;
        if (dl.lead && !u.target && now - dl.t0 < dl.walk) {
          const a = hash(u.id, (now / 6) | 0) * Math.PI * 2;
          const tx = dl.cx + Math.sin(a) * 2.2,
            tz = dl.cz + Math.cos(a) * 2.2;
          if (this._pathable(u, Math.floor(tx), Math.floor(tz))) {
            u.target = { x: tx, z: tz };
            u.path = null;
            u.state = 'walk';
            u.activity = 'court';
          }
        } else if (!dl.lead && now - dl.t0 < dl.walk) {
          // keep beside the leader
          const hx = Math.sin(p.heading),
            hz = Math.cos(p.heading);
          const tx = p.x - hz * 0.32,
            tz = p.z + hx * 0.32;
          if ((tx - u.x) ** 2 + (tz - u.z) ** 2 > 0.04) {
            u.target = { x: tx, z: tz };
            u.path = null;
            u.state = 'walk';
          }
        } else if (!u.target) {
          u.state = 'idle';
          u.activity = 'sit';
          if (d2 > 1e-4) u.heading = Math.atan2(dx, dz);
          if (Math.random() < 0.25) this.emote(u, 'heart', 1.4);
          u.activity = 'court';
        }
        return true;
      }
      case 'mind': {
        const c = this.byId.get(dl.w);
        if (!c || !c.alive) return false;
        const dx = c.x - u.x,
          dz = c.z - u.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 4 && !u.target) {
          u.target = { x: c.x - dx * 0.25, z: c.z - dz * 0.25 };
          u.path = null;
          u.state = 'walk';
        } else if (!u.target) {
          u.state = 'idle';
          u.activity = 'mind';
          if (d2 > 1e-4) u.heading = Math.atan2(dx, dz);
        }
        return true;
      }
      case 'eat':
        if (u.state !== 'eat') u.state = 'eat';
        return true;
      case 'guard':
        // a guard's spell ends at bedtime (the night watch takes over) or at dawn
        if (dl.nt != null && this._bedtime(u) !== dl.nt) return false;
        if (dl.fx != null) u.heading = Math.atan2(dl.fx - u.x, dl.fz - u.z);
        if (u.state !== 'idle' && !u.target) u.state = 'idle';
        return true;
      case 'chore':
      case 'drill':
        if (dl.k === 'drill' && dl.nt != null && this._bedtime(u) !== dl.nt) return false;
        if (u.state !== 'work') u.state = 'work';
        u.data.workAnim = dl.anim;
        if (dl.fx != null) u.heading = Math.atan2(dl.fx - u.x, dl.fz - u.z);
        return true;
      default:
        if (dl.fx != null && dl.k !== 'privy') u.heading = Math.atan2(dl.fx - u.x, dl.fz - u.z);
        if (u.state !== 'idle' && !u.target) u.state = 'idle';
        return true;
    }
  };

  // Enemy soldiers close by (only looked for while the realm is at war).
  P._dlThreat = function (u, v) {
    const civ = this.game.civ;
    if (!(u.kingdom >= 0) || !((civ.warCount?.(u.kingdom) || 0) > 0)) return false;
    return !!this.nearest(u.x, u.z, 6, (o) => o.species === 'human' && o.job === 'soldier' && o.kingdom !== u.kingdom && civ.atWar?.(u.kingdom, o.kingdom));
  };

  // ---- choosing what to do --------------------------------------------------
  P._dlDecide = function (u, now, v, child) {
    const c = this._clock();
    const h = c.h;
    const pl = this._dlPlaces(v);
    const d = u.data;
    const job = u.job;
    const rng = Math.random;
    const working = u.state === 'work' || !!u.carry;
    const soldier = job === 'soldier';
    const guard = soldier && ((u.id & 1) === 0 || pl.war);
    const home = this._homeOf(u, v);
    const hx = home ? home.doorX : pl.sq.x,
      hz = home ? home.doorZ : pl.sq.z;
    if (!c.live) {
      // (round 23) a pinned evening hour is an evening: the square fills
      if (h >= 17.5 && h < 21.5 && !working && !guard) return this._dlEvening(u, now, v, pl, child, 22, h);
      // a pinned hour: a gentle mix without the clock
      if (rng() < 0.08 && !working && !guard) return this._dlSocial(u, v, pl, 18 + rng() * 10, child);
      return false;
    }
    const { bed, wake } = this._sleepHours(u);
    // grief: a widow, a widower, a parent
    if (u.statuses?.has('mourning') && rng() < 0.45 && !guard) {
      const who = d.mourn ? `Mourning ${first(d.mourn)}` : 'Mourning';
      this._dlStart(u, 'mourn', 10 + rng() * 10, { x: hx + 0.6, z: hz + 0.6, lab: who, go: 'Walking home' });
      return true;
    }
    // a wedding: the couple and their neighbours celebrate (first sight of a spouse)
    const sp = d.civ?.spouse;
    if (u._spSeen === undefined) u._spSeen = sp ?? null;
    else if ((sp ?? null) !== u._spSeen) {
      u._spSeen = sp ?? null;
      if (sp != null) v._cele = { k: 'wedding', until: now + 30, x: u.x, z: u.z };
    }
    // celebrations: a birth, a wedding, peace won. The near neighbors who are
    // free join a birth or a wedding (workers keep at it); the whole town
    // turns out for peace. (Everyone within ten tiles, at work or not, used to
    // drop everything for every birth, and "Celebrating" became a growing
    // town's most common label.)
    const ce = v._cele;
    // (one chance per person per celebration, not a new roll every decision)
    if (ce && now < ce.until && !guard && u._celeSeen !== ce && (ce.k === 'peace' || (!working && (ce.x - u.x) ** 2 + (ce.z - u.z) ** 2 < 36)) && ((u._celeSeen = ce), rng() < (ce.k === 'peace' ? 0.5 : 0.35))) {
      const lab = ce.k === 'birth' ? 'Celebrating a birth' : ce.k === 'wedding' ? 'Celebrating a wedding' : 'Celebrating the peace';
      this._dlStart(u, 'cheer', 6 + rng() * 6, { x: ce.x + (rng() - 0.5) * 2.4, z: ce.z + (rng() - 0.5) * 2.4, lab, go: 'Joining the celebration', fx: ce.x, fz: ce.z, act: 'cheer' });
      return true;
    }
    // meals: breakfast after waking, lunch at midday, supper at dusk
    const mi = h >= wake && h < wake + 1.4 ? 0 : h >= 11.7 && h < 13.3 ? 1 : h >= 16.2 && h < 17.3 ? 2 : -1;
    if (mi >= 0 && !guard) {
      const key = c.day * 4 + mi;
      if (u._meal !== key) {
        u._meal = key;
        const [meal, lab] = MEAL[mi];
        // lunch where the work is (or at the market); breakfast and supper at home
        if (mi === 1 && (working || u.job)) this._dlStart(u, 'eat', 7 + rng() * 5, { lab, act: 'eat' });
        else if (mi === 1 && pl.market && rng() < 0.5) this._dlStart(u, 'eat', 8 + rng() * 5, { x: pl.market.doorX + (rng() - 0.5) * 2, z: pl.market.doorZ + (rng() - 0.5) * 2, lab: 'Eating at the market', go: 'Walking to the market', act: 'eat' });
        else this._dlStart(u, 'eat', 6 + rng() * 4, { x: hx + (rng() - 0.5) * 1.2, z: hz + (rng() - 0.5) * 1.2, lab, go: 'Walking home', act: 'eat' });
        u._dl.meal = meal;
        return true;
      }
    }
    // the privy, a few times a day (out of sight a moment, never shown)
    if (!(u._privyT > now)) {
      if (u._privyT == null) u._privyT = now + 30 + hash(u.id, 5) * 160;
      else {
        u._privyT = now + 120 + rng() * 140;
        if (!guard || rng() < 0.5) return this._dlPrivy(u, v, pl);
      }
    }
    // (round 23) in the drill hours every soldier's decision fills the ranks
    // first: the off-duty half to twelve, guards on duty to six (guards are
    // led by the Civ brain's rounds and used to fall in only now and then,
    // so a town of a dozen soldiers drilled one or two)
    if (soldier && this._drillHours(h) && !(v.wood < Math.max(15, (v.woodCap || 90) * 0.2)) && this._drillJoin(u, v, pl)) return true;
    const evening = h >= 16.9 + hash(u.id, 6) * 0.6 && h < bed;
    if (evening && !guard) return this._dlEvening(u, now, v, pl, child, bed, h);
    // children by day: play with the others, now and then
    if (child) {
      const school = pl.library || pl.era >= 3 ? pl.library || pl.hallB : null;
      // (round 23) a longer school day, more of it spent in class than on the
      // walk there (7% of the children were at school by day, 5% walking)
      // (round 27) the class lasts to the end of the school day: children
      // used to leave after an hour or two and walk back (school fell to
      // 9.7% of a child's day plus 6.2% walking; resting was their top
      // activity)
      if (u.age >= 6 && school && h >= 7.5 && h < 14.8 && rng() < 0.8) {
        const dur = Math.max(12, (15.2 - h) * H + rng() * 0.3 * H);
        this._dlStart(u, 'school', dur, { x: school.doorX, z: school.doorZ, lab: 'At school', go: 'Walking to school', free: true });
        return true;
      }
      // the older ones help lightly (water, the hens, the animals), never in the fields
      if (u.age >= 8 && h < 15.5 && rng() < 0.3 && this._dlHelp(u, v, pl, home, rng)) return true;
      if (u.age >= 4) return this._dlPlay(u, v, pl, 12 + rng() * 14, u.x, u.z);
      return false;
    }
    // by day: rulers think, the idle shop and wait, workers take a short break
    if (job === 'king') {
      if (rng() < 0.2) {
        this._dlStart(u, 'think', 8 + rng() * 8, { lab: 'Pondering the realm', act: 'think' });
        return true;
      }
      const hb = pl.hallB;
      if (hb && !u.moving && rng() < 0.6) {
        this._dlStart(u, 'hold', 14 + rng() * 12, { x: hb.doorX, z: hb.doorZ, fx: hb.x ?? hb.doorX, fz: hb.z ?? hb.doorZ, lab: 'Holding court', go: 'Walking to the hall', act: 'talk' });
        return true;
      }
      return false;
    }
    if (working || guard) {
      // a work song: in the fields at harvest time, now and then elsewhere
      const s = this.game.time.season ?? 1.5;
      if (u.state === 'work' && rng() < (job === 'farmer' && s >= 1.6 && s < 2.8 ? 0.22 : 0.03)) u._singUntil = now + 5 + rng() * 6;
      // a word with a workmate
      if (u.state === 'work' && rng() < 0.04) {
        const m = this.nearest(u.x, u.z, 2.5, (o) => o !== u && o.species === 'human' && o.state === 'work' && !o._dl && o.village === u.village);
        if (m) {
          this._dlPair(u, m, 'talk', 4 + rng() * 3);
          return true;
        }
      }
      return false;
    }
    if (u.job && u.job !== 'soldier') {
      if (h >= wake + 1.4 && h < 16.6 && u.state === 'idle' && !u.moving && !d.civ?.task) return this._dlChore(u, v, pl, rng);
      return false;
    }
    if (soldier) {
      // off duty with no barracks in town: wood while it is short, a post to
      // guard or a drill on the square (the brain), a rest at home, an errand
      if (v.wood < Math.max(15, (v.woodCap || 90) * 0.2)) return false;
      if (this._drillJoin(u, v, pl)) return true;
      const r0 = rng();
      if (r0 < 0.3 && home) {
        this._dlStart(u, 'inside', 18 + rng() * 18, { x: hx, z: hz, free: true, lab: 'Off duty at home', go: 'Walking home', act: null });
        return true;
      }
      if (r0 < 0.6) return false;
    }
    // the jobless and the off-duty: errands about town
    const r = rng();
    if (pl.market && r < 0.28 && this._dlRoom(pl.market, 22)) {
      const m = pl.market;
      const a = rng() * Math.PI * 2;
      const modern = pl.era >= 5;
      this._dlStart(u, 'shop', 8 + rng() * 8, { x: m.doorX + Math.sin(a) * 1.3, z: m.doorZ + Math.cos(a) * 1.3, fx: m.doorX, fz: m.doorZ, lab: modern ? 'Shopping at the market' : BUY[(u.id + c.day) % BUY.length], go: 'Walking to the market', act: 'shop' });
      return true;
    }
    if (r < 0.4 && (pl.docks || pl.station)) {
      const b = pl.station && (!pl.docks || rng() < 0.5) ? pl.station : pl.docks;
      const isTrain = b === pl.station;
      const a = rng() * Math.PI * 2;
      this._dlStart(u, 'wait', 12 + rng() * 12, { x: b.doorX + Math.sin(a) * 0.9, z: b.doorZ + Math.cos(a) * 0.9, fx: b.x ?? b.doorX, fz: b.z ?? b.doorZ, lab: isTrain ? 'Waiting for the train' : 'Waiting for the ship', go: isTrain ? 'Walking to the station' : 'Walking to the harbor', act: 'wait' });
      return true;
    }
    if (r < 0.52 && pl.temple && (u.age > 45 || this._hardTimes(v))) {
      return this._dlPray(u, pl);
    }
    if (r < 0.62) {
      if (u.age > 50 || pl.library) {
        this._dlStart(u, pl.library && rng() < 0.5 ? 'read' : 'think', 8 + rng() * 10, { act: pl.library && rng() < 0.5 ? 'read' : 'think' });
        u.activity = u._dl.k;
        return true;
      }
    }
    if (r < 0.8) {
      const m = this.nearest(u.x, u.z, 5, (o) => o !== u && o.species === 'human' && o.age >= ADULT && !o._dl && !o.combat && o.village === u.village && o.state !== 'work' && !o.carry);
      if (m) {
        this._dlPair(u, m, 'talk', 5 + rng() * 5);
        return true;
      }
    }
    // the rest of a jobless day away from the square (a big town's idle used
    // to mill about the hall in a crowd of hundreds): busy at home, a visit,
    // and in modern towns a working day at the office, the factory or the lab
    if (!soldier) return this._dlAway(u, v, pl, home, rng);
    return false;
  };

  // Not too many standing at one place already (a market crowd of a few dozen at most).
  P._dlRoom = function (b, max) {
    let n = 0;
    this.forEachNear(b.doorX, b.doorZ, 3.2, (o) => {
      if (o._dl && !o.moving) n++;
    });
    return n < max;
  };

  P._dlAway = function (u, v, pl, home, rng) {
    let b = null,
      lab,
      go;
    const r = rng();
    if (pl.era >= 4 && pl.work.length && r < 0.65) {
      b = pl.work[(u.id + (this.game.time.day | 0)) % pl.work.length];
      lab = WORK_LAB[b.type] || 'At work';
      go = 'Walking to work';
    } else if (r < 0.8 && pl.homes.length > 1) {
      b = pl.homes[(rng() * pl.homes.length) | 0];
      if (b === home) b = null;
      lab = 'Visiting a neighbor';
      go = 'Walking to a neighbor';
    }
    if (!b) {
      b = home;
      lab = rng() < 0.5 ? 'Doing the housework' : 'Busy at home';
      go = 'Walking home';
    }
    if (!b) return false;
    this._dlStart(u, 'inside', 22 + rng() * 26, { x: b.doorX, z: b.doorZ, free: true, lab, go, act: null });
    return true;
  };

  // Light help for the older children: water from the well, the hens fed, the
  // town's sheep and goats minded on the pasture (never work in the fields).
  P._dlHelp = function (u, v, pl, home, rng) {
    const r = rng();
    const near = (b, s = 1.2) => ({ x: b.doorX + (rng() - 0.5) * s * 2, z: b.doorZ + (rng() - 0.5) * s * 2, fx: b.x ?? b.doorX, fz: b.z ?? b.doorZ });
    let at, lab, go, anim = null, act = null;
    if (r < 0.4 && pl.pasture && pl.era < 6) {
      at = near(pl.pasture, 1.6);
      lab = 'Minding the animals';
      go = 'Walking to the pasture';
      act = 'mind';
    } else if (r < 0.7 && pl.well && pl.era < 5) {
      at = near(pl.well, 0.7);
      lab = 'Drawing water at the well';
      go = 'Fetching water';
      anim = 'harvest';
    } else if (home) {
      at = near(home);
      lab = pl.era >= 5 ? 'Watering the garden' : 'Feeding the hens';
      go = 'Walking home';
      anim = 'harvest';
    } else return false;
    const dl = this._dlStart(u, anim ? 'chore' : 'help', 12 + rng() * 12, { x: at.x, z: at.z, fx: at.fx, fz: at.fz, lab, go, act });
    if (anim) {
      dl.anim = anim;
      if (dl.ph === 'do') this._dlArrive(u, dl);
    }
    return true;
  };

  // A chore of the person's own trade while the village brain has no task for
  // them (crops still growing, no tree marked, nothing to build): short, so the
  // brain looks again soon. Farmers tend and weed their plots (mend fences in
  // winter), woodcutters split firewood, builders patch a house, miners and
  // fishers mend their tools and nets, healers grind remedies.
  P._dlChore = function (u, v, pl, rng) {
    const w = this.game.world;
    const job = u.job;
    const dur = 18 + rng() * 14;
    const home = this._homeOf(u, v);
    const near = (b, r = 1.2) => (b ? { x: b.doorX + (rng() - 0.5) * r * 2, z: b.doorZ + (rng() - 0.5) * r * 2, fx: b.x ?? b.doorX, fz: b.z ?? b.doorZ } : { x: u.x, z: u.z });
    let at, anim, lab;
    if (job === 'farmer') {
      const plots = v.plots || [];
      const p = plots.length ? plots[(rng() * plots.length) | 0] : null;
      const i = p?.tiles?.length ? p.tiles[(rng() * p.tiles.length) | 0] : -1;
      const winter = (this.game.time.season ?? 1.5) >= 3;
      if (i >= 0) {
        at = { x: (i % w.w) + 0.5, z: ((i / w.w) | 0) + 0.5 };
        anim = winter ? 'hammer' : 'harvest';
        lab = winter ? 'Mending the fences' : rng() < 0.5 ? 'Weeding the fields' : 'Tending the crops';
      } else {
        at = near(home);
        anim = 'hammer';
        lab = 'Mending tools';
      }
    } else if (job === 'woodcutter') {
      at = near(home);
      anim = 'chop';
      lab = 'Splitting firewood';
    } else if (job === 'builder') {
      const hs = v.buildings;
      const b = hs.length ? hs[(rng() * hs.length) | 0] : null;
      at = near(b && b.alive && !b.constructing && b.doorX != null ? b : home);
      anim = 'hammer';
      lab = pl.era >= 5 ? 'Doing repairs' : 'Patching a roof';
    } else if (job === 'miner') {
      at = near(home);
      anim = 'hammer';
      lab = 'Sharpening tools';
    } else if (job === 'fisher') {
      at = near(pl.docks || home);
      anim = 'hammer';
      lab = 'Mending the nets';
    } else if (job === 'healer') {
      at = near(home);
      anim = 'harvest';
      lab = 'Grinding remedies';
    } else return false;
    this._dlStart(u, 'chore', dur, { x: at.x, z: at.z, fx: at.fx, fz: at.fz, lab, go: 'Walking to work', act: null });
    if (u._dl) u._dl.anim = anim;
    if (u._dl?.ph === 'do') this._dlArrive(u, u._dl);
    return true;
  };

  P._hardTimes = function (v) {
    const civ = this.game.civ;
    return !!(v.starving || (v.kingdom >= 0 && (civ.warCount?.(v.kingdom) || 0) > 0) || this.game.disasters?.plagueSim?.active);
  };

  // Two people face each other and talk ("Chatting with ...").
  P._dlPair = function (u, m, act, dur) {
    const a = this._dlStart(u, 'pair', dur, { w: m.id, fx: m.x, fz: m.z, act, lab: `Chatting with ${first(m.name)}` });
    this._dlStart(m, 'pair', dur, { w: u.id, fx: u.x, fz: u.z, act, lab: `Chatting with ${first(u.name)}` });
    if (Math.random() < 0.5) this.emote(u, 'chat', 1.6);
    return a;
  };

  P._dlPray = function (u, pl) {
    const t = pl.temple;
    const a = Math.random() * Math.PI * 2;
    this._dlStart(u, 'pray', 10 + Math.random() * 10, { x: t.doorX + Math.sin(a) * 1.1, z: t.doorZ + Math.cos(a) * 1.1, fx: t.x ?? t.doorX, fz: t.z ?? t.doorZ, lab: 'Praying at the temple', go: 'Walking to the temple', act: 'pray' });
    return true;
  };

  // Out of sight for a moment: a house or the hall (the privy or restroom),
  // in the wilds behind a bush or a tree.
  P._dlPrivy = function (u, v, pl) {
    const g = this.game;
    const w = g.world;
    let best = null,
      bd = 100;
    for (const b of v.buildings) {
      if (!b.alive || b.constructing || b.doorX == null) continue;
      if (b.type !== 'house' && b.type !== 'hall' && b.type !== 'rowhouse' && b.type !== 'apartment' && b.type !== 'market' && b.type !== 'station') continue;
      const d2 = (b.doorX - u.x) ** 2 + (b.doorZ - u.z) ** 2;
      if (d2 < bd) {
        bd = d2;
        best = b;
      }
    }
    const lab = pl.era >= 5 ? 'Visiting the restroom' : 'Visiting the privy';
    if (best) {
      this._dlStart(u, 'privy', 4 + Math.random() * 3, { x: best.doorX, z: best.doorZ, lab, go: lab, free: true });
      return true;
    }
    // the wilds: behind the nearest bush or tree
    const t = this.findNearestTile(u.x, u.z, 6, (tx, ty, i) => w.flora[i] > 0 && w.building[i] < 0 && this._pathable(u, tx, ty));
    if (!t) return false;
    this._dlStart(u, 'privy', 4 + Math.random() * 3, { x: t.x, z: t.z, lab, go: lab });
    return true;
  };

  P._dlPlay = function (u, v, pl, dur, cx, cz) {
    const dl = this._dlStart(u, 'play', dur, { act: 'play', lab: (u.id + (this.game.time.day | 0)) % 3 === 0 ? 'Playing ball' : 'Playing tag' });
    dl.cx = cx;
    dl.cz = cz;
    // a parent at the square keeps an eye on the little ones
    const m = this.byId.get(u.data.civ?.mother) || this.byId.get(u.data.civ?.father);
    if (m && m.alive && u.age < 9 && m._dl && m._dl.k === 'social' && (m.x - u.x) ** 2 + (m.z - u.z) ** 2 < 64) {
      m._dl.k = 'mind';
      m._dl.w = u.id;
      m._dl.lab = 'Minding the children';
      m.activity = 'mind';
    }
    return true;
  };

  // The social evening: the square, the temple, a stroll, a book, the stars.
  P._dlEvening = function (u, now, v, pl, child, bed, h) {
    const rng = Math.random;
    const left = Math.max(6, Math.min(40, (bed - h) * H));
    if (child) {
      // the children play near the square
      const a = hash(v.id, 7) * Math.PI * 2;
      const cx = pl.sq.x + Math.sin(a) * 2.6,
        cz = pl.sq.z + Math.cos(a) * 2.6;
      if (u.age < 4) return false;
      const s = this._dlSpot(u, cx, cz, 4);
      if (!s) return false;
      if ((s.x - u.x) ** 2 + (s.z - u.z) ** 2 > 2.5) {
        // first walk there
        this._dlStart(u, 'goto', Math.min(left, 25), { x: s.x, z: s.z, go: 'Running to the square', act: null });
        u._dl.then = 'play';
        u._dl.cx = s.x;
        u._dl.cz = s.z;
        return true;
      }
      return this._dlPlay(u, v, pl, Math.min(left, 14 + rng() * 10), s.x, s.z);
    }
    const d = u.data;
    // (round 21) the square keeps its crowd the whole evening: from six to
    // half past nine, while the main square holds fewer than eight, a
    // grown-up who lives within reach goes there first (it used to fill
    // only as the evening began, and a square could stand empty at 19:18)
    // (round 23) tonight's regulars (see _owl) go there too while it holds
    // fewer than fifteen, from any decision in the window, so the crowd is
    // there after a jump of the clock and in every season
    if (h >= 18 && h < 21.5 && pl.sqs?.[0]) {
      const E = v._eve;
      const n = E && E.day === (this.game.time.day | 0) ? E.ids.filter((id) => this.byId.get(id)?._dl?.sq0).length : 0;
      const sq0 = pl.sqs[0];
      if ((n < 10 || (n < 15 && this._owl(u))) && (u.x - sq0.x) ** 2 + (u.z - sq0.z) ** 2 < 26 * 26) return this._dlSocial(u, v, pl, left, false);
    }
    const r = rng();
    // courting: the unwed of an age walk out together
    if (r < 0.16 && u.age < 40 && d.civ && d.civ.spouse == null) {
      const p = this.nearest(u.x, u.z, 14, (o) => o !== u && o.species === 'human' && o.village === u.village && o.sex !== u.sex && o.age >= ADULT + 1 && o.age < 42 && o.data.civ && o.data.civ.spouse == null && (!o._dl || o._dl.k === 'social') && !o.combat && !o.data.inside);
      if (p) return this._dlCourt(u, p, pl, left, false);
    }
    // a married couple out for a stroll
    if (r < 0.22 && d.civ?.spouse != null) {
      const p = this.byId.get(d.civ.spouse);
      if (p && p.alive && !p.data.inside && (!p._dl || p._dl.k === 'social') && (p.x - u.x) ** 2 + (p.z - u.z) ** 2 < 200) return this._dlCourt(u, p, pl, left, true);
    }
    if (r < 0.3 && pl.temple) return this._dlPray(u, pl);
    const night = h >= 20 || this.daylight() < 0.2;
    if (r < 0.38 && (u.age > 50 || u.job === 'king' || pl.library)) {
      this._dlStart(u, 'think', Math.min(left, 10 + rng() * 10), { lab: night ? 'Pondering the stars' : 'Thinking', act: 'think' });
      return true;
    }
    if (r < 0.45 && (pl.library || pl.era >= 4)) {
      const home = this._homeOf(u, v);
      this._dlStart(u, 'read', Math.min(left, 12 + rng() * 12), { x: home ? home.doorX + 0.5 : u.x, z: home ? home.doorZ + 0.5 : u.z, lab: pl.era >= 6 ? 'Reading the news' : 'Reading', go: 'Walking home', act: 'read' });
      return true;
    }
    return this._dlSocial(u, v, pl, left, false);
  };

  // Groups of two to five at the square, facing in.
  // (round 19) The main square fills first: up to fifteen grown-ups who live
  // within reach of it gather there each evening, in three chatting groups
  // round a musician, with some eating from the food stall; the rest go to the
  // town's other squares or chat with the neighbors by their doors.
  P._dlSocial = function (u, v, pl, dur, child) {
    const day = this.game.time.day | 0;
    const sq0 = pl.sqs[0];
    let E = v._eve;
    if (!E || E.day !== day) E = v._eve = { day, ids: [] };
    if (!child) {
      E.ids = E.ids.filter((id) => {
        const o = this.byId.get(id);
        return o && o !== u && o.alive && o._dl && o._dl.k === 'social' && o._dl.sq0;
      });
      if (E.ids.length < 15 && (u.x - sq0.x) ** 2 + (u.z - sq0.z) ** 2 < 26 * 26) return this._dlSquare(u, v, pl, dur, E);
    }
    const ng = pl.groups;
    const gi = Math.floor(hash(u.id, day) * ng);
    const ga = (gi / ng) * Math.PI * 2 + hash(v.id, day) * 3;
    const others = pl.sqs.length > 1 ? pl.sqs.length - 1 : 0;
    const home = !child && !others ? this._homeOf(u, v) : null;
    const sq = others ? pl.sqs[1 + (gi % others)] : home ? { x: home.doorX, z: home.doorZ } : sq0;
    const gq = Math.floor(gi / Math.max(1, others));
    const gr = (home ? 0.9 : ng <= pl.sqs.length ? 0 : 1.1 + (gq % 3) * 0.75) * UNIT.rel;
    const gx = sq.x + Math.sin(ga) * gr,
      gz = sq.z + Math.cos(ga) * gr;
    const a = hash(u.id, day + 17) * Math.PI * 2;
    const rr = (0.3 + hash(u.id, 23) * 0.12) * UNIT.rel;
    const dl = this._dlStart(u, 'social', Math.min(40, Math.max(8, dur)), { x: gx + Math.sin(a) * rr, z: gz + Math.cos(a) * rr, fx: gx, fz: gz, g: home ? -(home.id + 1) : v.id * 16 + gi + 1, go: home ? 'Walking home' : pl.market ? 'Walking to the market' : 'Walking to the square', act: 'talk' });
    if (home) dl.lab0 = 'Chatting with the neighbors';
    // one in eight plays music for the group; some bring their supper along
    if (!child && !home && hash(u.id, day + 5) < 0.12) dl.music = true;
    else if (!child && hash(u.id, day + 9) < 0.3) dl.supper = true;
    // a friend to name ("Chatting with ...")
    const key = dl.g;
    let best = null,
      bd = 9;
    this.forEachNear(dl.x, dl.z, 2.2, (o, d2) => {
      if (o !== u && o._dl && o._dl.g === key && d2 < bd) {
        bd = d2;
        best = o;
      }
    });
    if (best) {
      dl.wn = first(best.name);
      if (best._dl && !best._dl.wn) best._dl.wn = first(u.name);
    }
    return true;
  };

  P._dlSquare = function (u, v, pl, dur, E) {
    const sq = pl.sqs[0];
    const day = this.game.time.day | 0;
    const k = E.ids.length;
    E.ids.push(u.id);
    const props = pl.props;
    const base = hash(v.id, day) * Math.PI * 2;
    // is anyone playing yet? the first to come brings an instrument
    const mus = E.ids.some((id) => id !== u.id && this.byId.get(id)?._dl?.music);
    let x,
      z,
      fx = sq.x,
      fz = sq.z,
      g = v.id * 16 + 15,
      music = false,
      supper = false;
    const r = hash(u.id, day + 9);
    if (!mus) {
      // the musician: at the middle of the square, facing the biggest group
      music = true;
      x = sq.x + Math.sin(base) * 0.35 * UNIT.rel;
      z = sq.z + Math.cos(base) * 0.35 * UNIT.rel;
      fx = sq.x + Math.sin(base) * 3;
      fz = sq.z + Math.cos(base) * 3;
    } else if (props?.stall && r < 0.3 && (this.game.time.hour ?? 19) < 20.2) {
      // supper from the food stall, standing before it
      supper = true;
      const st = props.stall;
      const lat = (hash(u.id, 41) - 0.5) * 1.0 * UNIT.rel;
      const ox = Math.sin(st.rot),
        oz = Math.cos(st.rot);
      x = st.x + ox * 0.6 * UNIT.rel + oz * lat;
      z = st.z + oz * 0.6 * UNIT.rel - ox * lat;
      fx = st.x;
      fz = st.z;
      g = v.id * 16 + 14;
    } else if (props?.benches?.length && r >= 0.3 && r < 0.46) {
      // a seat on a bench, looking over the square
      const b = props.benches[k % props.benches.length];
      const lat = (hash(u.id, 43) < 0.5 ? -0.1 : 0.1) * UNIT.rel;
      const ox = Math.sin(b.rot),
        oz = Math.cos(b.rot);
      x = b.x + oz * lat - ox * 0.02 * UNIT.rel;
      z = b.z - ox * lat - oz * 0.02 * UNIT.rel;
      fx = b.x + ox * 3;
      fz = b.z + oz * 3;
      g = v.id * 16 + 13;
    } else {
      // three groups round the musician, four or five to a group
      const gi = k % 3;
      const ga = base + (gi / 3) * Math.PI * 2 + 0.5;
      const gx = sq.x + Math.sin(ga) * 1.35 * UNIT.rel,
        gz = sq.z + Math.cos(ga) * 1.35 * UNIT.rel;
      const a = (Math.floor(k / 3) / 5) * Math.PI * 2 + hash(u.id, 17);
      const rr = (0.32 + hash(u.id, 23) * 0.08) * UNIT.rel;
      x = gx + Math.sin(a) * rr;
      z = gz + Math.cos(a) * rr;
      fx = gx;
      fz = gz;
      g = v.id * 16 + 1 + gi;
    }
    const dl = this._dlStart(u, 'social', Math.min(40, Math.max(12, dur)), { x, z, fx, fz, g, go: pl.market ? 'Walking to the market' : 'Walking to the square', act: 'talk' });
    dl.sq0 = true;
    dl.music = music;
    dl.supper = supper;
    if (g === v.id * 16 + 13) dl.bench = true;
    return true;
  };

  P._dlCourt = function (u, p, pl, left, wed) {
    const dur = Math.min(left, 18 + Math.random() * 14);
    const cx = pl.sq.x + (Math.random() - 0.5) * 6,
      cz = pl.sq.z + (Math.random() - 0.5) * 6;
    const lu = wed ? `Strolling with ${first(p.name)}` : `Courting ${first(p.name)}`;
    const lp = wed ? `Strolling with ${first(u.name)}` : `Courting ${first(u.name)}`;
    const a = this._dlStart(u, 'court', dur, { w: p.id, lab: lu, act: 'court' });
    const b = this._dlStart(p, 'court', dur, { w: u.id, lab: lp, act: 'court' });
    a.lead = true;
    a.cx = b.cx = cx;
    a.cz = b.cz = cz;
    a.walk = b.walk = dur * 0.5;
    this.emote(u, 'heart', 1.6);
    return true;
  };

  // ---- labels -----------------------------------------------------------------
  // The inspector's "Doing" line for an episode (null: none).
  P._dailyLabel = function (u) {
    const dl = u._dl;
    if (!dl) return null;
    if (dl.k === 'privy') return dl.lab || 'Visiting the privy';
    if (dl.ph === 'go' && u.moving) return dl.go || (dl.k === 'social' ? 'Walking to the square' : 'Walking over');
    if (dl.k === 'play' && u.activity === 'laugh') return 'Laughing';
    if ((dl.k === 'play' || u.activity === 'play') && u.age >= ADULT) return u.age > 55 ? 'Watching the children' : 'Laughing';
    if (dl.k === 'social') {
      if (dl.lab && (u.activity === 'talk' || u.activity === 'cheer' || u.activity === 'sing' || u.activity === 'eat')) return dl.lab;
      return ACT_LABEL[u.activity] || 'Chatting';
    }
    if (dl.k === 'court' && u.moving) return dl.lab;
    return dl.lab || ACT_LABEL[u.activity] || ACT_LABEL[dl.k] || null;
  };

  // Purposeful walking under the village brain (distinct from wandering).
  P._walkLabel = function (u) {
    if (u.species !== 'human' || !u.moving) return null;
    const now = this.game.time.total;
    if (u.job === 'soldier' && u._bedT > now - 6) return u._bedB ? 'Walking to the barracks' : 'Walking home';
    // (at bedtime the walk home comes first: a load still in hand is not
    // "carried to the store" through the night)
    const d = u.data;
    if (d.civ?.army != null) return 'Marching';
    const tk = d.civ?.task?.kind;
    if (u.job !== 'soldier' && tk !== 'migrate' && tk !== 'arrive' && (u._homeT > now - 30 || this.game.settings?.dayNight) && this._bedtimeCheap(u)) return 'Walking home';
    if (u.carry) return `Carrying ${u.carry.type} to the store`;
    switch (u.job) {
      case 'farmer':
        return 'Walking to the fields';
      case 'woodcutter':
        return 'Walking to the woods';
      case 'miner':
        return 'Walking to the quarry';
      case 'builder':
        return 'Walking to the building site';
      case 'fisher':
        return 'Walking to the shore';
      case 'soldier':
        return d.civ?.task?.kind === 'chop' ? 'Walking to the woods' : 'On patrol';
      case 'child':
        return u.state === 'run' ? 'Running about' : 'Walking';
      case 'king':
        return 'Walking to the hall';
      default:
        return u.job ? 'Walking to work' : 'Strolling';
    }
  };
  P._bedtimeCheap = function (u) {
    try {
      return this._bedtime(u);
    } catch (e) {
      return false;
    }
  };

  // ---- village events ---------------------------------------------------------
  // Births and peace start celebrations (weddings are seen in _dlDecide).
  P._installDaily = function () {
    const g = this.game;
    g.events.on('unit:spawn', ({ unit }) => {
      if (!unit || unit.species !== 'human' || unit.age > 0.05 || unit.village < 0) return;
      const v = g.civ?.villages?.[unit.village];
      if (v && v.alive) v._cele = { k: 'birth', until: g.time.total + 25, x: unit.x, z: unit.z };
    });
  };
  // Every few seconds: a realm whose wars just ended celebrates the peace.
  P._dailyTick = function () {
    const civ = this.game.civ;
    if (!civ?.kingdoms || typeof civ.warCount !== 'function') return;
    const W = this._warWas || (this._warWas = new Map());
    const now = this.game.time.total;
    for (const k of civ.kingdoms) {
      if (!k || k.alive === false) continue;
      const n = civ.warCount(k.id) || 0;
      const was = W.get(k.id) || 0;
      W.set(k.id, n);
      if (was > 0 && n === 0) {
        for (const vid of k.villages || []) {
          const v = civ.villages[vid];
          if (v?.alive) {
            const pl = this._dlPlaces(v);
            v._cele = { k: 'peace', until: now + 60, x: pl.sq.x, z: pl.sq.z };
          }
        }
      }
    }
  };
}

// The animals' small set of labels (grazing, sleeping, playing young,
// courting in spring, keeping to the herd).
export function animalLabel(U, u, now) {
  if (u.def.kind !== 'animal') return null;
  if (u.emote && u.emote.kind === 'heart' && now < u.emote.until + 3) return 'Courting';
  if (u.age < u.def.maturity && u.moving && u.state !== 'flee') return 'Playing';
  if (u.herd && u.def.herd && u.moving && u.state === 'walk') return 'Moving with the herd';
  return null;
}

export { frac as _frac };
