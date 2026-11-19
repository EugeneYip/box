import { simWeather } from '../disasters/util.js';

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
    const wake = 5.2 + hash(u.id, 4) * 1.0 + (s === 3 ? 0.5 : 0);
    return { bed, wake };
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
      houses = 0;
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
      else if (t === 'house' || t === 'rowhouse' || t === 'apartment') houses++;
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
    c.groups = Math.max(1, Math.min(8, Math.round((v.pop || 6) / 5)));
    return c;
  };

  // A free standing spot near (x, z) for this person (not in a building or the water).
  P._dlSpot = function (u, x, z, r = 3) {
    const w = this.game.world;
    const tx = Math.floor(x),
      tz = Math.floor(z);
    if (w.inBounds(tx, tz) && w.building[tz * w.w + tx] < 0 && this._pathable(u, tx, tz)) return { x, z };
    const t = this.findNearestTile(x, z, r, (ax, ay, i) => w.building[i] < 0 && this._pathable(u, ax, ay));
    return t ? { x: t.x + (hash(u.id, 9) - 0.5) * 0.5, z: t.z + (hash(u.id, 10) - 0.5) * 0.5 } : null;
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
    // children grow up while they play (the village brain ages them, see civ/brain.js)
    const child = u.age < ADULT;
    if (child && u._dl && !u.flags?.frozenAge && !d.frozenAge) u.age += ((elapsed || 0) / 30) * 1.7;
    if (u._dl) {
      if (now < u._dl.until && this._dlStep(u, now, v)) return true;
      const was = u._dl.k;
      this._dlEnd(u);
      // after a chore the brain looks for real work this think; if it has
      // none, the next think finds another chore (no idle gap between them)
      u._dlNext = was === 'chore' || was === 'school' ? now + 0.5 : now + (child ? 1.5 : 4) + hash(u.id, (now * 7) | 0) * 4;
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
        if (dl.music) a = 'sing';
        else if (dl.supper && hr < 19.6) a = 'eat';
        else if (pl.fest) a = r < 0.38 ? 'dance' : r < 0.58 ? 'sing' : r < 0.74 ? 'laugh' : r < 0.84 ? 'cheer' : 'talk';
        else a = r < 0.56 ? 'talk' : r < (happy ? 0.76 : 0.64) ? 'laugh' : r < (happy ? 0.86 : 0.7) ? 'sing' : 'talk';
        if (!happy && r > 0.9 && !dl.music) a = 'sit';
        u.activity = a;
        dl.lab = dl.music ? (pl.era >= 5 ? 'Playing guitar on the square' : 'Playing music on the square') : a === 'eat' ? 'Sharing supper on the square' : a === 'talk' ? (dl.wn ? `Chatting with ${dl.wn}` : pl.market ? 'Gossiping at the market' : 'Chatting') : a === 'cheer' ? (pl.harvest ? 'Celebrating the harvest' : 'Celebrating the festival') : a === 'sing' && pl.fest ? 'Singing at the festival' : null;
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
      case 'chore':
      case 'drill':
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
    const evening = h >= 16.9 + hash(u.id, 6) * 0.6 && h < bed;
    if (evening && !guard) return this._dlEvening(u, now, v, pl, child, bed, h);
    // children by day: play with the others, now and then
    if (child) {
      const school = pl.library || pl.era >= 3 ? pl.library || pl.hallB : null;
      if (u.age >= 6 && school && h < 15 && rng() < 0.5) {
        this._dlStart(u, 'school', 20 + rng() * 25, { x: school.doorX, z: school.doorZ, lab: 'At school', go: 'Walking to school', free: true });
        return true;
      }
      if (u.age >= 4 && rng() < 0.8) return this._dlPlay(u, v, pl, 12 + rng() * 14, u.x, u.z);
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
    // the jobless and the off-duty: errands about town
    const r = rng();
    if (pl.market && r < 0.28) {
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
    return false;
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
    const r = rng();
    const d = u.data;
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
  P._dlSocial = function (u, v, pl, dur, child) {
    const day = this.game.time.day | 0;
    const ng = pl.groups;
    const gi = Math.floor(hash(u.id, day) * ng);
    const ga = (gi / ng) * Math.PI * 2 + hash(v.id, day) * 3;
    const gr = ng === 1 ? 0 : 1.1 + (gi % 3) * 0.75;
    const gx = pl.sq.x + Math.sin(ga) * gr,
      gz = pl.sq.z + Math.cos(ga) * gr;
    const a = hash(u.id, day + 17) * Math.PI * 2;
    const rr = 0.3 + hash(u.id, 23) * 0.12;
    const dl = this._dlStart(u, 'social', Math.min(40, Math.max(8, dur)), { x: gx + Math.sin(a) * rr, z: gz + Math.cos(a) * rr, fx: gx, fz: gz, g: v.id * 16 + gi + 1, go: pl.market ? 'Walking to the market' : 'Walking to the square', act: 'talk' });
    // one in eight plays music for the group; some bring their supper along
    if (!child && hash(u.id, day + 5) < 0.12) dl.music = true;
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
    if (u.carry) return `Carrying ${u.carry.type} to the store`;
    const d = u.data;
    if (d.civ?.army != null) return 'Marching';
    if (u._homeT > this.game.time.total - 30 && this._bedtimeCheap(u)) return 'Walking home';
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
        return 'On patrol';
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
