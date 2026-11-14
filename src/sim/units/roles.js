import { civPath } from '../civ/pathing.js';
import { SEA_LEVEL } from '../../world/constants.js';

// Roles that technologies unlock (Life module, docs/TECH-UNLOCKS.md):
// mounted riders (Horsemanship), healers (Medicine), and creatures riding
// transports (Fleets).
//
// Contract with Civ (who decides who does what):
//   u.job === 'healer' | 'messenger'  - or u.data.role with the same names
//   u.data.mounted === true           - the person rides a horse; cavalry are
//                                       soldiers with mounted set, messengers
//                                       always ride
// Life drives healer and messenger behaviour, gives riders their speed and
// charge, and renders the horses. Until Civ assigns these roles itself, a
// fallback here hands them out (u.data.role / u.data.mounted, marked
// u.data.lifeRole) in realms that know the technology; it stands down in any
// village where Civ has assigned the role.
//
// Contract with Fleets (all optional, game.fleet?.):
//   units.board(u, vessel | id)   hides u aboard (not drawn, not thinking,
//                                 out of spatial queries, follows the vessel)
//   units.disembark(u, x, z)      shows u again at the landing (nearest land)
//   units.aboard(vesselId)        -> units aboard
//   event 'fleet:lost' {vessel}   everyone aboard drowns, unless land is very
//                                 near and they swim for it
//   event 'fleet:arrived' {vessel} anyone still aboard steps ashore next tick

export const ROLE_NAMES = { healer: 'Healer', messenger: 'Messenger', cavalry: 'Cavalry' };
const RIDE_SPEED = { cavalry: 1.6, messenger: 1.75 };
const HEAL_RANGE = 16;
const TREAT_TIME = 3; // seconds at the bedside
const CHARGE_GAP = 6; // seconds between cavalry charges
const WORKER = new Set(['farmer', 'woodcutter', 'builder', 'miner']);

function needsCare(o) {
  const S = o.statuses;
  return !!(o.data?.plague || (S && (S.has('sick') || S.has('wounded'))));
}

export function installRoles(Units) {
  const P = Units.prototype;

  // ---- who is what --------------------------------------------------------
  P.roleOf = function (u) {
    if (!u || u.species !== 'human') return null;
    const j = u.job;
    if (j === 'healer' || j === 'messenger') return j;
    const r = u.data?.role;
    if (r === 'healer' || r === 'messenger') return r;
    if (j === 'soldier' && u.data?.mounted) return 'cavalry';
    return null;
  };
  // Mounted right now (the renderer draws a horse under riders: u._riding).
  P.isRiding = function (u) {
    if (!u || !u.alive || u.species !== 'human' || u.age < u.def.maturity) return false;
    if (u.swimming || u.data.inside || u.data.aboard != null || u.data.hidden || u.sleeping) return false;
    const role = this.roleOf(u);
    if (role === 'messenger') {
      // a messenger with another trade leaves the horse at home while working there
      const ph = u.data.ride?.phase;
      return u.state !== 'work' && (!u.job || u.job === 'messenger' || ph === 'out' || ph === 'wait' || ph === 'back');
    }
    if (!u.data.mounted) return false;
    if (u.data.lifeRole && u.job !== 'soldier') return false;
    return u.state !== 'work';
  };
  P._updateRiding = function (u) {
    const r = this.isRiding(u);
    u._riding = r;
    u._rideMul = r ? RIDE_SPEED[this.roleOf(u) === 'messenger' ? 'messenger' : 'cavalry'] : 1;
    return r;
  };
  // Divine / test hook: give someone a role ('healer' | 'messenger' | 'cavalry' | null).
  P.setRole = function (u, role) {
    if (!u || u.species !== 'human') return false;
    if (role === 'cavalry') {
      u.data.mounted = true;
      if (u.data.role === 'messenger' || u.data.role === 'healer') delete u.data.role;
    } else if (role === 'healer' || role === 'messenger') {
      u.data.role = role;
      if (role === 'healer' && u.data.lifeRole) delete u.data.mounted;
    } else {
      delete u.data.role;
      delete u.data.mounted;
    }
    u.data.lifeRole = true;
    delete u.data.ride;
    delete u.data.heal;
    this._updateRiding(u);
    return true;
  };

  // ---- fallback assignment (until Civ hands out these roles) ---------------
  P._rolesTick = function () {
    const g = this.game;
    const civ = g.civ;
    if (!civ || !civ.villages || typeof civ.hasTech !== 'function') return;
    // Civ now hands out healers, messengers and cavalry itself (unlocks._riders,
    // the healer job): stand down and release anyone this fallback recruited,
    // so roles are not doubled.
    if (typeof civ._riders === 'function') {
      if (!this._rolesReleased) {
        this._rolesReleased = true;
        for (const u of this.list) {
          const d = u.alive && u.data;
          if (!d || !d.lifeRole) continue;
          delete d.lifeRole;
          if (d.role === 'healer' || d.role === 'messenger' || d.role === 'cavalry') delete d.role;
          delete d.ride;
          delete d.heal;
          delete d.mounted;
          this._updateRiding(u);
        }
      }
      return;
    }
    const vs = Array.isArray(civ.villages) ? civ.villages : Object.values(civ.villages);
    for (const v of vs) {
      if (!v || !v.alive || v.razed || !(v.kingdom >= 0) || !v.members) continue;
      const kid = v.kingdom;
      const horse = civ.hasTech(kid, 'horsemanship');
      const med = civ.hasTech(kid, 'medicine');
      let adults = 0,
        soldiers = 0,
        civHeal = 0,
        civMsg = 0,
        civCav = 0;
      const mine = { healer: [], messenger: [], cavalry: [] };
      const idle = [];
      for (const u of v.members) {
        if (!u.alive || u.species !== 'human' || u.age < u.def.maturity) continue;
        adults++;
        const d = u.data;
        if (u.job === 'healer') civHeal++;
        else if (u.job === 'messenger') civMsg++;
        if (u.job === 'soldier') {
          soldiers++;
          if (d.mounted && !d.lifeRole) civCav++;
          else if (d.mounted) mine.cavalry.push(u);
        } else if (d.lifeRole && d.mounted && d.role !== 'messenger') {
          delete d.mounted; // demobilised: the horse goes back to the stable
          this._updateRiding(u);
        }
        if (d.lifeRole && (d.role === 'healer' || d.role === 'messenger')) mine[d.role].push(u);
        else if (!u.job && !d.role && !d.civ?.royal && !d.civ?.army && !(d.civ?.task && d.civ.task.kind === 'migrate')) idle.push(u);
      }
      const drop = (u) => {
        delete u.data.role;
        delete u.data.ride;
        delete u.data.heal;
        if (u.job !== 'soldier') delete u.data.mounted;
        this._updateRiding(u);
      };
      // messengers ride between their other work; soldiers and rulers give it up
      mine.messenger = mine.messenger.filter((u) => {
        if (u.job !== 'soldier' && u.job !== 'king' && horse && !civMsg) return true;
        drop(u);
        return false;
      });
      if (!med || civHeal) for (const u of mine.healer.splice(0)) drop(u);
      if (!horse || civCav) for (const u of mine.cavalry.splice(0)) drop(u);
      // healers: one per small town, more in cities
      const wantHeal = med && !civHeal && adults >= 6 ? Math.min(3, 1 + Math.floor(adults / 28)) : 0;
      while (mine.healer.length < wantHeal) {
        let pick = idle.find((o) => o.age > 30) || idle[0];
        if (!pick) {
          for (const o of v.members)
            if (o.alive && o.species === 'human' && o.age > 26 && o.job && o.job !== 'soldier' && o.job !== 'king' && !o.data.role && !o.data.civ?.royal) {
              pick = o;
              break;
            }
        }
        if (!pick) break;
        idle.splice(idle.indexOf(pick), 1);
        pick.data.role = 'healer';
        pick.data.lifeRole = true;
        mine.healer.push(pick);
        if (!this._firstRole?.has('healer:' + kid)) this._announceRole(kid, 'healer', pick, v);
      }
      // messengers: towns of a realm with somewhere to ride to
      const K = civ.kingdoms?.[kid];
      const wantMsg = horse && !civMsg && adults >= 8 && (vs.some((o) => o && o.alive && o !== v && (o.kingdom === kid || (K && o.kingdom >= 0 && !civ.atWar?.(kid, o.kingdom))))) ? (K?.capital === v.id && adults >= 20 ? 2 : 1) : 0;
      while (mine.messenger.length < wantMsg) {
        let pick = idle.find((o) => o.age < 45) || idle[0];
        if (pick) idle.splice(idle.indexOf(pick), 1);
        else {
          // no one idle: borrow a worker from the busiest trade
          const by = {};
          for (const o of v.members) if (o.alive && o.species === 'human' && o.age >= o.def.maturity && o.age < 50 && WORKER.has(o.job) && !o.data.role && !o.data.civ?.royal) (by[o.job] || (by[o.job] = [])).push(o);
          let best = null;
          for (const j in by) if (!best || by[j].length > best.length) best = by[j];
          if (!best || best.length < 2) break;
          pick = best[0];
        }
        pick.data.role = 'messenger';
        pick.data.mounted = true;
        pick.data.lifeRole = true;
        mine.messenger.push(pick);
        this._updateRiding(pick);
        if (!this._firstRole?.has('messenger:' + kid)) this._announceRole(kid, 'messenger', pick, v);
      }
      // cavalry: about a third of the soldiers ride
      const wantCav = horse && !civCav && soldiers >= 2 ? Math.max(1, Math.round(soldiers * 0.34)) : 0;
      if (mine.cavalry.length < wantCav) {
        for (const u of v.members) {
          if (mine.cavalry.length >= wantCav) break;
          if (!u.alive || u.job !== 'soldier' || u.data.mounted || u.data.civ?.royal) continue;
          u.data.mounted = true;
          u.data.lifeRole = true;
          mine.cavalry.push(u);
          this._updateRiding(u);
          if (!this._firstRole?.has('cavalry:' + kid)) this._announceRole(kid, 'cavalry', u, v);
        }
      }
    }
  };
  // Chronicle: the first time a realm puts a new trade to use.
  P._announceRole = function (kid, role, u, v) {
    if (!this._firstRole) this._firstRole = new Set();
    this._firstRole.add(role + ':' + kid);
    const g = this.game;
    const realm = g.civ?.kingdomName?.(kid) || 'A realm';
    const text = role === 'healer' ? `${realm} trains its first healer, ${u.name} of ${v.name}` : role === 'messenger' ? `${realm} sends out its first mounted messenger, ${u.name} of ${v.name}` : `${realm} raises its first cavalry in ${v.name}`;
    try {
      const pos = { x: u.x, z: u.z };
      if (typeof g.civ?._note === 'function') g.civ._note(text, 'info', pos, 'role:' + role + ':' + kid, 1e9);
      else g.notify?.(text, 'info', pos);
    } catch (err) {
      /* the feed is optional */
    }
    this.log(u, role === 'healer' ? `Became a healer in ${v.name}` : role === 'messenger' ? `Became a mounted messenger of ${v.name}` : `Took up the lance as a rider of ${v.name}`);
  };

  // ---- behaviour hook (before the registered brain) -------------------------
  // Returns true when the role took over this think.
  P._roleThink = function (u, now) {
    this._updateRiding(u);
    if (u.combat || u.data.inside || u.age < u.def.maturity) return false;
    const role = this.roleOf(u);
    if (role === 'healer') return this._healerThink(u, now);
    if (role === 'messenger') {
      const took = this._messengerThink(u, now);
      this._updateRiding(u);
      return took;
    }
    return false;
  };

  // ---- healers --------------------------------------------------------------
  P._healerThink = function (u, now) {
    const h = u.data.heal || (u.data.heal = { pid: 0, t: 0, scanT: 0, last: now });
    const dt = Math.min(2, Math.max(0, now - h.last));
    h.last = now;
    let p = h.pid ? this.byId.get(h.pid) : null;
    // a patient whose treatment has begun is seen through to the end
    if (p && (!p.alive || (!needsCare(p) && h.t <= 0) || p.data.aboard != null || p.data.inside || p.combat)) {
      if (p._nurse === u.id) p._nurse = 0;
      p = null;
      h.pid = 0;
    }
    if (!p) {
      if (now < h.scanT) return false;
      h.scanT = now + 2 + Math.random();
      const kid = u.kingdom;
      p = this.nearest(u.x, u.z, HEAL_RANGE, (o) => o !== u && o.species === 'human' && !o.data.inside && o.data.aboard == null && !o.combat && needsCare(o) && (kid < 0 || o.kingdom === kid || o.kingdom < 0) && (!o._nurse || o._nurse === u.id || !this.byId.get(o._nurse)?.alive));
      if (!p) return false;
      h.pid = p.id;
      h.t = 0;
      p._nurse = u.id;
    }
    const dx = p.x - u.x,
      dz = p.z - u.z;
    const d = Math.hypot(dx, dz);
    // the patient waits once the healer is close
    if (d < 4 && !p.combat && p.state !== 'flee') p._nurseWait = now + 1.6;
    if (d > 0.7) {
      h.t = Math.max(0, h.t - dt * 0.5);
      if (!u.target || Math.hypot(u.target.x - p.x, u.target.z - p.z) > 0.8) this.moveTo(u, p.x - (dx / (d || 1)) * 0.45, p.z - (dz / (d || 1)) * 0.45);
      u.state = p.data.plague || d > 2 ? 'run' : 'walk';
      u.data.workAnim = null;
      return true;
    }
    // at the bedside: the patient keeps still while being tended
    u.target = null;
    u.path = null;
    u.moving = false;
    u.state = 'work';
    u.data.workAnim = 'heal';
    if (d > 1e-3) u.heading = Math.atan2(dx, dz);
    if (!p.combat && p.state !== 'flee') {
      p.target = null;
      p.path = null;
      p._nurseWait = now + 1.6;
    }
    p._healAt = now; // the renderer shows a soft green glint
    u._healAt = now;
    h.t += dt;
    if (h.t >= TREAT_TIME / Math.max(0.6, this.traitMod?.(u, 'work') ?? 1)) this._cure(u, p);
    return true;
  };
  P._cure = function (u, p) {
    const g = this.game;
    const st = this.healStats || (this.healStats = { cured: 0, plague: 0, sick: 0, wounds: 0 });
    let what = null;
    if (p.data.plague) {
      const ps = g.disasters?.plagueSim;
      if (ps?.cure) ps.cure(p);
      else {
        delete p.data.plague;
        this.removeStatus(p, 'sick');
      }
      st.plague++;
      what = 'plague';
    }
    if (this.removeStatus(p, 'sick')) {
      if (!what) st.sick++;
      what = what || 'fever';
    }
    if (p.statuses?.has('wounded') || p.hp < p.maxHp * 0.6) {
      p.hp = Math.max(p.hp, p.maxHp * 0.75);
      this.removeStatus(p, 'wounded');
      st.wounds++;
      what = what || 'wounds';
    }
    st.cured++;
    if (p._nurse === u.id) p._nurse = 0;
    const h = u.data.heal;
    if (h) {
      h.pid = 0;
      h.t = 0;
      h.scanT = g.time.total + 1.5;
    }
    u._cured = (u._cured || 0) + 1;
    this.addXP(u, 3);
    if (u._cured === 1) this.log(u, `Healed a first patient, ${p.name}`);
    else if (u._cured === 10 || u._cured === 50 || u._cured === 200) this.log(u, `Has healed ${u._cured} people`);
    this.log(p, what === 'plague' ? `Nursed through the plague by ${u.name}` : what === 'wounds' ? `Had wounds dressed by ${u.name}` : `Nursed back to health by ${u.name}`);
    this.emote(p, 'heart', 1.6);
    g.fx?.emit?.('heal', { x: p.x, z: p.z }, { scale: 0.6 });
    g.events.emit('unit:healed', { unit: p, healer: u, what });
  };

  // ---- messengers -----------------------------------------------------------
  P._messengerThink = function (u, now) {
    const g = this.game;
    const civ = g.civ;
    const home = civ?.villages?.[u.village];
    if (!home || !home.alive) return false;
    const m = u.data.ride || (u.data.ride = { phase: 'home', until: now + 8 + Math.random() * 25, to: -1, repath: 0 });
    const doorOf = (v) => (v.hall && v.hall.alive !== false ? { x: v.hall.doorX ?? v.cx, z: v.hall.doorZ ?? v.cz } : { x: v.cx, z: v.cz });
    if (m.phase === 'home') {
      if (now < m.until) return false;
      const dest = this._messengerDest(u, home);
      if (!dest) {
        m.until = now + 30;
        return false;
      }
      m.phase = 'out';
      m.to = dest.id;
      m.repath = 0;
      m.since = now;
    }
    if (m.phase === 'wait') {
      u.state = 'idle';
      u.target = null;
      u.path = null;
      if (now < m.until) return true;
      m.phase = 'back';
      m.repath = 0;
      m.since = now;
    }
    const tv = m.phase === 'out' ? civ.villages[m.to] : home;
    if (!tv || !tv.alive || now - (m.since ?? now) > 240) {
      if (m.phase === 'out' && tv !== home) {
        m.phase = 'back';
        m.repath = 0;
        m.since = now;
        return true;
      }
      m.phase = 'home';
      m.until = now + 30;
      return false;
    }
    const p = doorOf(tv);
    const d = Math.hypot(p.x - u.x, p.z - u.z);
    if (d < 1.8) {
      this.stop(u);
      if (m.phase === 'out') {
        this._deliver(u, home, tv);
        m.phase = 'wait';
        m.until = now + 4 + Math.random() * 3;
        return true;
      }
      m.phase = 'home';
      m.until = now + 35 + Math.random() * 45;
      return false;
    }
    if ((!u.target && !u.path) || now > m.repath) {
      m.repath = now + 25;
      this._ride(u, p.x, p.z);
    }
    if (u.state !== 'run') u.state = 'walk';
    u.data.workAnim = null;
    return true;
  };
  // Where a messenger rides: the capital, a sister town, or (at peace) a neighbour's capital.
  P._messengerDest = function (u, home) {
    const g = this.game;
    const civ = g.civ;
    const kid = home.kingdom;
    const K = civ.kingdoms?.[kid];
    const vs = Array.isArray(civ.villages) ? civ.villages : Object.values(civ.villages);
    const reach = Math.min(280, Math.max(150, Math.max(g.world.w, g.world.h) * 0.36));
    const near = (v) => v && v.alive && v !== home && Math.hypot(v.cx - home.cx, v.cz - home.cz) < reach;
    const own = vs.filter((v) => near(v) && v.kingdom === kid);
    const foreign = [];
    for (const k of civ.kingdoms || []) {
      if (!k || k.alive === false || k.id === kid || civ.atWar?.(kid, k.id)) continue;
      const cap = civ.villages[k.capital];
      if (near(cap)) foreign.push(cap); // riders are how distant realms first hear of each other
    }
    if (foreign.length && (!own.length || Math.random() < 0.35)) return foreign[Math.floor(Math.random() * foreign.length)];
    if (!own.length) return null;
    const cap = civ.villages[K?.capital];
    if (cap && cap !== home && own.includes(cap) && Math.random() < 0.5) return cap;
    return own[Math.floor(Math.random() * own.length)];
  };
  // Long rides follow the roads (Civ's road-preferring walk cost when available).
  P._ride = function (u, x, z) {
    const g = this.game;
    const w = g.world;
    const cost = g.civ?._walkCost?.();
    // long rides go in legs of up to ~40 tiles (a bounded search each), at most
    // one leg planned every few ticks across the world
    const dx = x - u.x,
      dz = z - u.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 44) {
      const t = this._shoreTile(u.x + (dx / dist) * 40, u.z + (dz / dist) * 40, 6);
      if (t) {
        x = t.x;
        z = t.z;
      }
    }
    if (cost && this._tickN - (this._rideTick ?? -99) >= 3) {
      this._rideTick = this._tickN;
      const sx = Math.min(w.w - 1, Math.max(0, Math.floor(u.x))),
        sy = Math.min(w.h - 1, Math.max(0, Math.floor(u.z)));
      const gx = Math.min(w.w - 1, Math.max(0, Math.floor(x))),
        gy = Math.min(w.h - 1, Math.max(0, Math.floor(z)));
      let p = null;
      try {
        p = civPath(w, sx, sy, gx, gy, cost, 3000, 0.5);
      } catch (err) {
        p = null;
      }
      if (p && p.length) {
        u.path = p;
        u.pathIdx = 0;
        u.target = { x, z };
        u.blockedT = 0;
        u._wantPath = false;
        return true;
      }
    }
    return this.moveTo(u, x, z);
  };
  // A message delivered: realms at peace warm to each other.
  P._deliver = function (u, home, tv) {
    const g = this.game;
    const civ = g.civ;
    const st = this.rideStats || (this.rideStats = { trips: 0, foreign: 0 });
    st.trips++;
    u._trips = (u._trips || 0) + 1;
    this.emote(u, 'chat', 2);
    if (tv.kingdom !== home.kingdom && tv.kingdom >= 0 && home.kingdom >= 0) {
      st.foreign++;
      try {
        const r = civ.rel?.(home.kingdom, tv.kingdom);
        if (r && !r.war) {
          r.opinion = Math.min(100, (r.opinion || 0) + 4);
          r.grievance = Math.max(0, (r.grievance || 0) - 1.5);
        }
      } catch (err) {
        /* diplomacy is Civ's; best effort */
      }
      if (u._trips === 1 || u._trips % 10 === 0) this.log(u, `Carried word to ${civ.kingdomName?.(tv.kingdom) || 'a neighbour'} at ${tv.name}`);
    } else if (u._trips === 1) this.log(u, `Rode with news to ${tv.name}`);
    this.addXP(u, 1);
  };

  // ---- cavalry ----------------------------------------------------------------
  // Charge: a rider that hits at speed strikes far harder (once every few seconds);
  // a rider striking a foe already locked with someone else lands a flanking blow.
  P._rideStrikeMul = function (u, t, now) {
    if (!u._riding) return 1;
    let m = 1.15;
    if (now - (u._chargeT ?? -99) > CHARGE_GAP && (u.speedNow || 0) > u.def.speed * 1.1) {
      u._chargeT = now;
      m *= 2;
      u._charged = now;
      this.game.fx?.emit?.('dust', { x: u.x, y: u.y + 0.05, z: u.z }, { scale: 0.8 });
    }
    if (t.combat && t.combat.target !== u.id) m *= 1.3;
    return m;
  };
  // Flankers look further and pick foes already fighting someone else.
  P._cavalryFoe = function (u, range) {
    let best = null,
      bs = Infinity;
    this.forEachNear(u.x, u.z, range * 1.5, (o, d2) => {
      if (o === u || !this.isHostile(u, o)) return;
      const busy = o.combat && o.combat.target !== u.id ? 0.35 : 1;
      const s = d2 * busy;
      if (s < bs) {
        bs = s;
        best = o;
      }
    });
    return best;
  };

  // ---- transports (Fleets) -----------------------------------------------------
  P._vessel = function (id) {
    const f = this.game.fleet;
    if (!f || id == null) return null;
    try {
      return f.byId?.get?.(id) ?? f.get?.(id) ?? f.vessel?.(id) ?? f.vessels?.find?.((v) => v.id === id) ?? null;
    } catch (err) {
      return null;
    }
  };
  P.board = function (u, vessel) {
    if (!u || !u.alive) return false;
    const id = typeof vessel === 'object' && vessel ? vessel.id : vessel;
    if (id == null) return false;
    if (u.combat) this.disengage(u);
    this.stop(u);
    u.data.aboard = id;
    u._away = true;
    u._aboardSince = this.game.time.total;
    u.sleeping = false;
    u.state = 'idle';
    u.moving = false;
    u._riding = false;
    if (u._cell >= 0) {
      this._gridRemove(u);
      u._cell = -1;
    }
    this.game.events.emit('unit:board', { unit: u, vessel: id });
    return true;
  };
  P.disembark = function (u, x, z) {
    if (!u || u.data.aboard == null) return false;
    const id = u.data.aboard;
    delete u.data.aboard;
    const w = this.game.world;
    let px = x ?? u.x,
      pz = z ?? u.z;
    if (u.def.habitat === 'land') {
      // step ashore at the nearest land (never into open water)
      const t = this._shoreTile(px, pz, 12) || this._shoreTile(px, pz, 48);
      if (t) {
        px = t.x + (Math.random() - 0.5) * 0.4;
        pz = t.z + (Math.random() - 0.5) * 0.4;
      }
    }
    u.x = u.px = Math.min(w.w - 0.05, Math.max(0.05, px));
    u.z = u.pz = Math.min(w.h - 0.05, Math.max(0.05, pz));
    u.y = u.py = this._groundY(u);
    this.stop(u);
    if (u._cell < 0 || u._cell == null) this._gridAdd(u);
    else this._gridUpdate(u);
    this._updateRiding(u);
    this.game.events.emit('unit:disembark', { unit: u, vessel: id });
    return true;
  };
  P.aboard = function (vesselId) {
    const out = [];
    for (const u of this.list) if (u.alive && u.data.aboard === vesselId) out.push(u);
    return out;
  };
  // Per tick for someone aboard: ride along with the vessel; step ashore if it is gone.
  P._aboardTick = function (u, now) {
    const v = this._vessel(u.data.aboard);
    if (v && v.alive !== false && !v.sunk && !v.dead) {
      if (Number.isFinite(v.x) && Number.isFinite(v.z)) {
        u.x = v.x;
        u.z = v.z;
      }
      u._lostT = 0;
      return;
    }
    // no such vessel any more (and no event told us): step ashore where it was
    u._lostT = (u._lostT || 0) + 1;
    if (u._lostT > 30 || !this.game.fleet) this.disembark(u, u.x, u.z);
  };
  P._installFleetHooks = function () {
    if (this._fleetHooked) return;
    this._fleetHooked = true;
    const ev = this.game.events;
    const vid = (e) => e?.vessel?.id ?? e?.id ?? e?.vesselId ?? null;
    const listed = (e) => {
      const v = e?.vessel || e;
      // only real lists: Fleets keeps `crew` as a head count, not a roster
      const L = [v?.passengers, v?.cargo?.units, e?.passengers, v?.crew].find((x) => Array.isArray(x)) || null;
      if (!L) return [];
      const out = [];
      for (const x of L) {
        const u = typeof x === 'object' ? x : this.byId.get(x);
        if (u && u.alive && u.data && u.data.aboard == null) out.push(u);
      }
      return out;
    };
    ev.on('fleet:lost', (e) => {
      const id = vid(e);
      const g = this.game;
      const w = g.world;
      const vx = e?.vessel?.x ?? e?.x,
        vz = e?.vessel?.z ?? e?.z;
      const lost = id == null ? [] : this.aboard(id);
      for (const u of listed(e)) if (!lost.includes(u)) lost.push(u);
      let drowned = 0;
      for (const u of lost) {
        if (u.data.aboard != null) delete u.data.aboard;
        if (Number.isFinite(vx)) {
          u.x = vx;
          u.z = vz;
        }
        // a strong swimmer close to shore may make it
        const shore = u.def.habitat === 'land' && u.def.canSwim !== false ? this.findNearestTile(u.x, u.z, 5, (tx, ty, i) => w.height[i] >= SEA_LEVEL) : null;
        if (shore && g.rng.chance(0.4)) {
          if (u._cell < 0 || u._cell == null) this._gridAdd(u);
          this.disembark(u, shore.x, shore.z);
          this.log(u, 'Swam ashore from a sinking ship');
          continue;
        }
        if (u._cell < 0 || u._cell == null) this._gridAdd(u);
        if (u.flags?.immortal) {
          this.disembark(u, u.x, u.z);
          continue;
        }
        if (u.def.kind === 'humanoid') this.log(u, 'Went down with a sinking ship');
        this.kill(u, 'drowned');
        drowned++;
      }
      if (drowned) ev.emit('unit:drowned', { vessel: id, count: drowned });
    });
    ev.on('fleet:arrived', (e) => {
      const id = vid(e);
      if (id == null) return;
      const x = e?.vessel?.x ?? e?.x,
        z = e?.vessel?.z ?? e?.z;
      // Civ applies the cargo first; anyone still aboard steps ashore on the next tick
      (this._landings || (this._landings = [])).push({ id, x, z, at: this.game.time.total });
    });
  };
  P._landingsTick = function () {
    const L = this._landings;
    if (!L || !L.length) return;
    this._landings = [];
    for (const l of L) for (const u of this.aboard(l.id)) this.disembark(u, l.x, l.z);
  };
}
