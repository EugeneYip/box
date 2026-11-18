// New people (Life module, docs/TECH-BREADTH.md section 3): firefighters and
// bucket brigades who run to fires and put them out, doctors and paramedics
// who tend the sick and the wounded, foresters who replant, police who walk
// the streets of modern towns, scientists at the campus, astronauts who
// board rockets. Civ decides who takes these roles (u.data.role =
// 'firefighter' | 'doctor' | 'forester' | 'police' | 'scientist' |
// 'astronaut'); Life draws them and drives them here. A role only takes over
// while it has something to do; otherwise the person keeps the trade the
// village brain gives them.
//
// Bucket brigades: when a building of a town burns, a few grown neighbours
// nearby grab buckets (u._brigade = until) and fight the fire as well.
// Robots (u.data.robot, realms that know robotics) work through the night.

export const PEOPLE_ROLES = { firefighter: 'Firefighter', doctor: 'Doctor', forester: 'Forester', police: 'Police officer', scientist: 'Scientist', astronaut: 'Astronaut' };
const FIRE_R = 14; // tiles a firefighter looks for flames
const STUDY = new Set(['campus', 'academy', 'library', 'observatory']);
const WORKERS = new Set(['builder', 'miner', 'woodcutter', 'farmer']);

export function installPeople(Units) {
  const P = Units.prototype;

  // Before the village brain (from _roleThink): true while the role holds the person.
  P._peopleThink = function (u, now, role) {
    const civ = this.game.civ;
    const v = civ?.villages?.[u.village];
    if (role === 'astronaut' && u._space > 0) return this._astronaut(u, now, v);
    if (u.combat || u.state === 'flee' || u.data.inside || u.age < u.def.maturity) return false;
    if (role === 'firefighter' || u._brigade > now) return v && v.alive && this._dlThreat(u, v) ? false : this._fireThink(u, now, v);
    if (!v || !v.alive) return false;
    switch (role) {
      case 'doctor':
        return this._healerThink(u, now);
      case 'forester':
        return this._foresterThink(u, now, v);
      case 'police':
        return this._policeThink(u, now, v);
      case 'scientist':
        return this._scienceThink(u, now, v);
      case 'astronaut':
        return this._astronaut(u, now, v);
      default:
        return false;
    }
  };

  // ---- fire -----------------------------------------------------------------
  P._fireThink = function (u, now, v) {
    const g = this.game;
    const w = g.world;
    const f = u.data.ff || (u.data.ff = { scanT: 0, x: 0, z: 0, b: 0, i: -1, last: now });
    const dt = Math.min(2, Math.max(0, now - f.last));
    f.last = now;
    if (now >= f.scanT || (f.i >= 0 && !(w.fire[f.i] > 0.02) && !f.b)) {
      f.scanT = now + 1.5;
      f.i = -1;
      f.b = 0;
      let bd = Infinity;
      // a burning building of the town first
      if (v && v.alive)
        for (const b of v.buildings) {
          if (!b.alive || !(b.burning > 0.08)) continue;
          const d2 = (b.x - u.x) ** 2 + (b.z - u.z) ** 2;
          if (d2 < bd && d2 < (FIRE_R * 1.6) ** 2) {
            bd = d2;
            f.b = b.id;
            f.x = b.x;
            f.z = b.z;
          }
        }
      if (!f.b) {
        const t = this.findNearestTile(u.x, u.z, FIRE_R, (tx, ty, i) => w.fire[i] > 0.05);
        if (t) {
          f.i = t.i;
          f.x = t.x;
          f.z = t.z;
        }
      }
    }
    if (f.i < 0 && !f.b) {
      if (u.data.workAnim === 'douse') u.data.workAnim = null;
      return false;
    }
    const b = f.b ? g.civ?._bById?.get(f.b) : null;
    if (f.b && (!b || !b.alive || !(b.burning > 0.02))) {
      f.b = 0;
      f.scanT = 0;
      return false;
    }
    // stand a step back from the flames
    const dx = f.x - u.x,
      dz = f.z - u.z;
    const d = Math.hypot(dx, dz) || 1;
    const stand = b ? 1.6 + (b.w || 2) * 0.3 : 1.3;
    if (d > stand + 0.5) {
      if (!u.target || Math.hypot(u.target.x - f.x, u.target.z - f.z) > stand + 1) {
        const a = Math.atan2(-dx, -dz) + ((u.id % 7) - 3) * 0.25;
        if (!this.moveTo(u, f.x + Math.sin(a) * stand, f.z + Math.cos(a) * stand)) this.moveTo(u, f.x - (dx / d) * stand, f.z - (dz / d) * stand);
      }
      u.state = 'run';
      u.data.workAnim = null;
      return true;
    }
    // at the fire: water on the flames
    u.target = null;
    u.path = null;
    u.state = 'work';
    u.data.workAnim = 'douse';
    u.heading = Math.atan2(dx, dz);
    const power = (u.data.role === 'firefighter' ? ((g.civ?.kingdoms?.[u.kingdom]?.era || 0) >= 5 ? 1.6 : 1) : 0.7) * dt;
    if (b) b.burning = Math.max(0, b.burning - power * 0.22);
    const fs = g.disasters?.fire;
    if (fs?.extinguish) {
      const cx = Math.floor(f.x),
        cz = Math.floor(f.z);
      for (let oz = -1; oz <= 1; oz++)
        for (let ox = -1; ox <= 1; ox++) {
          const tx = cx + ox,
            tz = cz + oz;
          if (!w.inBounds(tx, tz)) continue;
          const i = tz * w.w + tx;
          if (w.fire[i] > 0 && Math.random() < power * 0.45) fs.extinguish(tx, tz);
        }
    }
    // a splash and steam where the water lands (near the camera only)
    const fc = this._focus;
    if ((f.x - fc.x) ** 2 + (f.z - fc.z) ** 2 < fc.r2 && Math.random() < 0.6) {
      g.fx.emit?.('splash', { x: f.x + (Math.random() - 0.5) * 0.6, y: w.heightAt(f.x, f.z) + 0.3, z: f.z + (Math.random() - 0.5) * 0.6 }, { scale: 0.35 });
      if (Math.random() < 0.4) g.fx.emit?.('steam', { x: f.x, y: w.heightAt(f.x, f.z) + 0.4, z: f.z }, { scale: 0.35 });
    }
    if (!u._fireLogged && u.data.role === 'firefighter') {
      u._fireLogged = true;
      this.log(u, 'Fought a first fire');
    }
    return true;
  };
  // Every couple of seconds: a burning building calls neighbours with buckets.
  P._brigadeTick = function () {
    const civ = this.game.civ;
    if (!civ?.villages) return;
    const now = this.game.time.total;
    for (const v of civ.villages) {
      if (!v?.alive || !v.buildings) continue;
      let fire = null;
      for (const b of v.buildings) if (b.alive && b.burning > 0.15) fire = b;
      if (!fire) continue;
      let n = 0;
      for (const u of v.members) if (u.alive && u._brigade > now) n++;
      if (n >= 4) continue;
      this.forEachNear(fire.x, fire.z, 12, (o) => {
        if (n >= 4 || o.village !== v.id || o.species !== 'human' || o.age < 16 || o.job === 'soldier' || o.job === 'king' || o.combat || o.data.inside || o._brigade > now || o.data.role === 'firefighter') return;
        o._brigade = now + 25;
        if (o._dl) this._dlEnd(o);
        o.thinkT = Math.min(o.thinkT, 0.1);
        n++;
      });
    }
  };

  // ---- foresters ----------------------------------------------------------------
  // They plant groves at the edge of town (Civ's own planting walk), between
  // other errands.
  P._foresterThink = function (u, now, v) {
    const civ = this.game.civ;
    if (typeof civ._forester !== 'function') return false;
    const d = u.data.civ || (u.data.civ = { task: null });
    const fr = u.data.fr || (u.data.fr = { on: true, t: now + 40, last: now });
    const dt = Math.min(3, Math.max(0.05, now - fr.last));
    fr.last = now;
    if (now > fr.t) {
      fr.on = !fr.on;
      fr.t = now + (fr.on ? 45 : 25);
      if (!fr.on && d.task?.kind === 'plant-tree') d.task = null;
    }
    if (!fr.on) return false;
    try {
      civ._forester(u, v, d, dt);
    } catch (e) {
      return false;
    }
    return true;
  };

  // ---- police -----------------------------------------------------------------
  P._policeThink = function (u, now, v) {
    const pd = u.data.pd || (u.data.pd = { t: 0, watch: 0 });
    // trouble nearby: a raging creature or a brawl in the street
    if (now >= pd.t) {
      pd.t = now + 2 + Math.random() * 2;
      const trouble = this.nearest(u.x, u.z, 9, (o) => o !== u && (o.mad > now || (o.combat && o.species === 'human' && o.job !== 'soldier')));
      if (trouble) {
        pd.trouble = trouble.id;
        this.moveTo(u, trouble.x + 0.8, trouble.z + 0.8);
        u.state = 'run';
        return true;
      }
      pd.trouble = 0;
      if (u.target) return true;
      // the beat: from corner to corner of the town, a pause on watch
      if (Math.random() < 0.35) {
        pd.watch = now + 6 + Math.random() * 6;
        u.state = 'idle';
        u.activity = 'wait';
        return true;
      }
      const r = (v.buildRadius || 6) * 0.9;
      const a = Math.random() * Math.PI * 2;
      const w = this.game.world;
      const t = this.findNearestTile(v.cx + Math.sin(a) * r * Math.random(), v.cz + Math.cos(a) * r * Math.random(), 3, (tx, ty, i) => w.building[i] < 0 && this._pathable(u, tx, ty));
      if (t && this.moveTo(u, t.x, t.z)) {
        u.state = 'walk';
        u.activity = null;
      }
      return true;
    }
    if (pd.watch > now && !u.target) {
      u.state = 'idle';
      u.activity = 'wait';
    }
    return true;
  };

  // ---- scientists ----------------------------------------------------------------
  P._scienceThink = function (u, now, v) {
    const sd = u.data.sd || (u.data.sd = { on: true, t: now + 30 });
    if (now > sd.t) {
      sd.on = !sd.on;
      sd.t = now + (sd.on ? 35 : 20);
    }
    if (!sd.on) return false;
    let lab = null;
    for (const b of v.buildings) if (b.alive && !b.constructing && STUDY.has(b.type) && b.doorX != null && (!lab || b.type === 'campus')) lab = b;
    if (!lab) return false;
    sd.lab = lab.type;
    const sx = lab.doorX + ((u.id % 5) - 2) * 0.35,
      sz = lab.doorZ + 0.5;
    const d2 = (sx - u.x) ** 2 + (sz - u.z) ** 2;
    if (d2 > 0.6) {
      if (!u.target) this.moveTo(u, sx, sz);
      u.state = 'walk';
      u.data.workAnim = null;
      return true;
    }
    u.target = null;
    u.path = null;
    u.state = 'work';
    u.data.workAnim = 'study';
    u.heading = Math.atan2(lab.x - u.x, lab.z - u.z);
    return true;
  };

  // ---- astronauts ----------------------------------------------------------------
  // Train at the launch pad; when a rocket of the realm lifts off from it,
  // those waiting there go up with it and come back down a while later.
  P._astronaut = function (u, now, v) {
    if (u._space > 0) {
      if (now < u._space) {
        u._hid = true;
        u.target = null;
        u.path = null;
        u.state = 'idle';
        return true;
      }
      u._space = 0;
      u._hid = false;
      this.log(u, 'Came back down from orbit');
      return false;
    }
    if (!v || !v.alive) return false;
    let pad = null;
    for (const b of v.buildings) if (b.alive && !b.constructing && (b.type === 'launchpad' || b.type === 'spaceport') && b.doorX != null) pad = b;
    if (!pad) return false;
    const sx = pad.doorX + ((u.id % 3) - 1) * 0.4,
      sz = pad.doorZ + 0.6;
    if ((sx - u.x) ** 2 + (sz - u.z) ** 2 > 0.6) {
      if (!u.target) this.moveTo(u, sx, sz);
      u.state = 'walk';
      return true;
    }
    u.target = null;
    u.path = null;
    u.state = 'idle';
    u.activity = 'wait';
    u.heading = Math.atan2(pad.x - u.x, pad.z - u.z);
    return true;
  };
  // Robot workers: in realms that know robotics, one worker in four is a
  // machine (u.data.robot; Life's own choice until Civ assigns them).
  P._robotsTick = function () {
    const civ = this.game.civ;
    if (!civ?.kingdoms || typeof civ.hasTech !== 'function') return;
    for (const k of civ.kingdoms) {
      if (!k || k.alive === false) continue;
      const on = civ.hasTech(k.id, 'robotics');
      for (const vid of k.villages || []) {
        const v = civ.villages[vid];
        if (!v?.alive) continue;
        for (const u of v.members) {
          if (!u.alive) continue;
          const want = on && WORKERS.has(u.job) && u.id % 4 === 0 && u.age >= 16;
          if (want && !u.data.robot) u.data.robot = true;
          else if (!want && u.data.robot && !u.data.robotFixed) delete u.data.robot;
        }
      }
    }
  };
  P._installPeople = function () {
    const g = this.game;
    g.events.on('fleet:launched', ({ vessel, kind }) => {
      if (!vessel || (kind !== 'rocket' && kind !== 'starship')) return;
      const x = vessel.x ?? vessel.from?.x,
        z = vessel.z ?? vessel.from?.z;
      if (x == null) return;
      const now = g.time.total;
      this.forEachNear(x, z, 7, (o) => {
        if (o.data?.role !== 'astronaut' || o._space > 0 || (vessel.kingdom != null && o.kingdom !== vessel.kingdom)) return;
        o._space = now + 60 + Math.random() * 30;
        o._hid = true;
        this.log(o, kind === 'starship' ? 'Boarded a colony starship' : 'Flew to orbit on a rocket');
      });
    });
  };

  // ---- labels -----------------------------------------------------------------
  P._peopleLabel = function (u) {
    const r = u.data.role;
    if (u._space > 0 && r === 'astronaut') return 'In orbit';
    const wa = u.state === 'work' ? u.data.workAnim : null;
    if (wa === 'douse') return u.data.role === 'firefighter' && (this.game.civ?.kingdoms?.[u.kingdom]?.era || 0) >= 5 ? 'Hosing down the fire' : 'Fighting the fire';
    if ((r === 'firefighter' || u._brigade > this.game.time.total) && u.moving && u.data.ff && (u.data.ff.i >= 0 || u.data.ff.b)) return u.data.role === 'firefighter' ? 'Running to the fire' : 'Carrying water to the fire';
    if (wa === 'study') return u.data.sd?.lab === 'campus' ? 'Researching at the campus' : u.data.sd?.lab === 'observatory' ? 'Watching the stars' : 'Studying';
    if (r === 'forester' && u.state === 'work') return 'Planting trees';
    if (r === 'police') {
      if (u.data.pd?.trouble && u.moving) return 'Hurrying to trouble';
      if (u.activity === 'wait') return 'Keeping watch';
      if (u.moving) return 'Patrolling the streets';
    }
    if (r === 'astronaut' && u.activity === 'wait') return 'Waiting for the launch';
    if (r === 'doctor' && u.data.heal?.pid && u.moving) return 'Hurrying to a patient';
    return null;
  };
}
