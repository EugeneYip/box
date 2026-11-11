// War at sea and the perils of the deep (mixed into Fleet): galleys of realms
// at war hunt enemy ships and blockade their harbours; storms, sea monsters,
// fire and the powers of the gods sink ships.
const MAT = { steel: 1.35, iron: 1.2, bronze: 1.08 };

export const war = {
  _matMod(kid) {
    return MAT[this.game.civ?.bestMaterial?.(kid)] || 1;
  },

  _warTick(dt) {
    const civ = this.game.civ;
    const now = this.game.time.total;
    for (const [id, until] of this.blockades) if (until < now) this.blockades.delete(id);
    const naval = this.law('fleetNaval');
    for (const v of this.list) {
      if (!v.alive || v.state === 'sinking' || v.cls !== 'sea') continue;
      if (v.kind !== 'galley') {
        // merchantmen run before enemy galleys
        v.chase = false;
        continue;
      }
      const enemies = naval ? civ.enemiesOf?.(v.kingdom) || [] : [];
      if (!enemies.length || v.layup) {
        v.target = null;
        v.chase = false;
        if (v.mission?.type === 'patrol') {
          v.mission = { type: 'home', phase: 'home' };
          this._goHome(v);
        }
        continue;
      }
      if (v.state === 'moored') {
        v.mission = { type: 'patrol', phase: 'out', t: 0 };
        v.state = 'patrol';
      }
      if (v.mission?.type !== 'patrol') continue;
      this._galley(v, enemies, dt, now);
    }
  },

  _galley(v, enemies, dt, now) {
    const nav = this.nav;
    let tgt = v.target != null ? this.byId.get(v.target) : null;
    if (tgt && (!tgt.alive || tgt.state === 'sinking' || tgt.state === 'moored' || !enemies.includes(tgt.kingdom) || Math.hypot(tgt.x - v.x, tgt.z - v.z) > 40)) tgt = null;
    if (!tgt) {
      // nearest enemy ship (warships and transports first)
      let bs = Infinity;
      this.near(v.x, v.z, 30, (o, d) => {
        if (o.cls !== 'sea' || o.state === 'sinking' || o.state === 'moored' || !enemies.includes(o.kingdom)) return;
        const sc = d - (o.kind === 'galley' ? 6 : o.kind === 'transport' ? 4 : 0);
        if (sc < bs) {
          bs = sc;
          tgt = o;
        }
      });
      if (tgt && nav.comp(tgt.x, tgt.z) !== nav.comp(v.x, v.z)) tgt = null;
    }
    const m = v.mission;
    if (tgt) {
      v.target = tgt.id;
      v.chase = true;
      m.blockade = null;
      const d = Math.hypot(tgt.x - v.x, tgt.z - v.z);
      const reach = 1.6 + (v.def.size + tgt.def.size) * 0.5;
      if (d <= reach) {
        this._fight(v, tgt, dt);
        if (!v.alive || v.state === 'sinking') return;
        v.state = 'patrol';
        v.path = null;
        // turn alongside
        const want = Math.atan2(tgt.z - v.z, tgt.x - v.x) + Math.PI / 2;
        v.heading += Math.max(-0.5, Math.min(0.5, ((want - v.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI)) * dt;
      } else if ((m.repath = (m.repath || 0) - dt) <= 0) {
        m.repath = 4;
        // close in, straight when the water allows
        const ax = tgt.x - Math.cos(tgt.heading) * 0.5,
          az = tgt.z - Math.sin(tgt.heading) * 0.5;
        if (nav.los(v.x, v.z, ax, az, 0)) {
          v.dest = { x: ax, z: az };
          this.setPath(v, [v.x, v.z, ax, az]);
          v.state = 'sail';
        } else this._sail(v, { x: tgt.x, z: tgt.z });
        m.phase = 'out';
      }
      return;
    }
    v.target = null;
    v.chase = false;
    // blockade the nearest enemy harbour on these waters
    let bh = m.blockade != null ? this.harbourInfo(m.blockade) : null;
    if (bh && !enemies.includes(bh.kingdom)) bh = null;
    if (!bh) {
      const comp = nav.comp(v.x, v.z);
      let bd = Infinity;
      for (const e of enemies)
        for (const h of this.harbours(e)) {
          if (h.water !== comp) continue;
          const d = Math.hypot(h.berth.x - v.x, h.berth.z - v.z);
          if (d < bd && d < this.range(v.kingdom, 'galley')) {
            bd = d;
            bh = h;
          }
        }
    }
    let px, pz;
    if (bh) {
      m.blockade = bh.id;
      const sp = nav.waterNear(bh.berth.x + bh.dirX * 5, bh.berth.z + bh.dirZ * 5, 4, 1.5) || bh.berth;
      px = sp.x;
      pz = sp.z;
    } else {
      // guard the home waters
      const home = v.harbour != null ? this.harbourInfo(v.harbour) : null;
      if (!home) return;
      const sp = nav.waterNear(home.berth.x + home.dirX * 6, home.berth.z + home.dirZ * 6, 4, 1.5) || home.berth;
      px = sp.x;
      pz = sp.z;
    }
    const dd = Math.hypot(px - v.x, pz - v.z);
    if (dd > 3.5) {
      if (v.state !== 'sail' || !v.dest || Math.hypot(v.dest.x - px, v.dest.z - pz) > 2) {
        m.phase = 'out';
        if (!this._sail(v, { x: px, z: pz })) {
          m.blockade = null;
          v.state = 'patrol';
        }
      }
    } else {
      v.state = 'patrol';
      if (bh) {
        this.blockades.set(bh.id, now + 4);
        if (!m.announced) {
          m.announced = true;
          this.note(`⚓ Galleys of ${this.kname(v.kingdom)} blockade the harbour of ${bh.name}`, 'war', { x: bh.x, z: bh.z }, 'blockade' + bh.id, 300);
        }
      }
    }
  },

  // Volleys of arrows, grapples and rams: both crews trade blows.
  _fight(a, b, dt) {
    const crew = (v) => 0.45 + 0.55 * (v.hp / v.maxHp);
    // volleys of arrows and the odd fire pot, both ways (seen in flight)
    const volley = (from, to, n) => {
      for (let i = 0; i < n; i++) {
        const pot = this.rng() < 0.12;
        const hit = this.rng() < (pot ? 0.55 : 0.6);
        const ox = (this.rng() - 0.5) * from.def.length * 0.6,
          oz = (this.rng() - 0.5) * from.def.length * 0.6;
        const mx = hit ? (this.rng() - 0.5) * to.def.length * 0.5 : (this.rng() - 0.5) * 3,
          mz = hit ? (this.rng() - 0.5) * to.def.length * 0.5 : (this.rng() - 0.5) * 3;
        if (this.shots.length > 160) this.shots.shift();
        this.shots.push({ x0: from.x + ox, z0: from.z + oz, x1: to.x + mx, z1: to.z + mz, t: -this.rng() * 0.4, dur: 0.55 + this.rng() * 0.3, pot, hit, target: to.id });
      }
    };
    volley(a, b, 2 + Math.floor(this.rng() * 3));
    if (b.def.dps > 0) volley(b, a, 1 + Math.floor(this.rng() * 2));
    // grappled: both ships lose way and fight it out where they are
    a.grappled = b.grappled = this.game.time.total + 1.5;
    const da = a.def.dps * this._matMod(a.kingdom) * crew(a) * dt;
    this.hurt(b, da, 'battle', a);
    if (b.alive && b.state !== 'sinking' && b.def.dps > 0) this.hurt(a, b.def.dps * this._matMod(b.kingdom) * crew(b) * dt * 0.85, 'battle', b);
    a.lastFight = b.lastFight = this.game.time.total;
    a.fightWith = b.id;
    b.fightWith = a.id;
    const ka = Math.min(a.kingdom, b.kingdom),
      kb = Math.max(a.kingdom, b.kingdom);
    if (b.kind === 'galley') {
      const where = this._placeName((a.x + b.x) / 2, (a.z + b.z) / 2);
      this.note(`⚔ A sea battle off ${where}: galleys of ${this.kname(a.kingdom)} and ${this.kname(b.kingdom)} clash`, 'war', { x: a.x, z: a.z }, 'seabattle' + ka + '-' + kb, 150);
    }
  },

  _hazardTick(dt) {
    const g = this.game;
    // storms: lightning finds masts, waves swamp small boats
    const st = this.storm();
    if (st > 0.4) {
      const rig = g.cameraRig;
      for (const v of this.list) {
        if (!v.alive || v.cls !== 'sea' || v.state === 'sinking' || v.state === 'moored') continue;
        const p = 0.0028 * st * (v.def.small ? 2.2 : 1) * (this.hasTech(v.kingdom, 'navigation') ? 0.5 : 1) * dt;
        if (this.rng() >= p) continue;
        const near = rig && Math.hypot(rig.cur.x - v.x, rig.cur.z - v.z) < rig.cur.dist * 1.1 + 10;
        if (near) {
          try {
            g.atmosphere?.strike?.(v.x, v.z, { intensity: 0.9 });
          } catch {
            /* optional */
          }
        }
        this.hurt(v, 28 + this.rng() * 40, 'storm');
        if (v.alive && v.state !== 'sinking') v.burning = Math.min(1, v.burning + 0.3);
      }
    }
    // sea monsters
    const U = g.units;
    if (U?.list) {
      if (!this._serpT || g.time.total - this._serpT > 3) {
        this._serpT = g.time.total;
        this._serpents = U.list.filter((u) => u.alive && (u.species === 'serpent' || (u.def?.habitat === 'water' && u.def?.kind === 'monster')));
      }
      for (const s of this._serpents || []) {
        if (!s.alive) continue;
        this.near(s.x, s.z, 1.8 * (s.scale || 1), (v) => {
          if (v.cls !== 'sea' || v.state === 'sinking') return;
          this.hurt(v, 14 * dt, 'serpent');
          if (v.def.dps > 0 && s.alive) U.damage?.(s, v.def.dps * 0.5 * dt, null, { cause: 'ship' });
          if (this.rng() < 0.4) this._fx('splash', v.x, v.z, 0.7);
        });
      }
    }
  },
};
