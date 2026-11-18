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
      if (v.role !== 'galley') {
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
        if (v.hp < v.maxHp * 0.85) continue; // still refitting
        v.mission = { type: 'patrol', phase: 'out', t: 0 };
        v.state = 'patrol';
      }
      if (v.mission?.type !== 'patrol') continue;
      // badly hurt: break off and row home to refit
      if (v.hp < v.maxHp * 0.4) {
        v.target = null;
        v.chase = false;
        v.mission = { type: 'home', phase: 'home' };
        this._goHome(v);
        continue;
      }
      this._galley(v, enemies, dt, now);
    }
  },

  _galley(v, enemies, dt, now) {
    const nav = this.nav;
    // lookouts see further over a big map's wide seas (enemy sail was rarely
    // within sight there: no ship was sunk on the World Map in a century)
    const look = this.seaScale();
    const m = v.mission;
    let tgt = v.target != null ? this.byId.get(v.target) : null;
    // a raid on a ship moored in a blockaded harbour (below) is given up after a while
    if (tgt && m.raid === tgt.id && (now - m.raidAt > 30 || !tgt.alive || tgt.state === 'sinking' || !enemies.includes(tgt.kingdom))) {
      m.raid = null;
      tgt = null;
    }
    if (tgt && m.raid !== tgt.id && (!tgt.alive || tgt.state === 'sinking' || tgt.state === 'moored' || tgt.role === 'fishing' || !enemies.includes(tgt.kingdom) || this.dist(tgt.x, tgt.z, v.x, v.z) > 40 * look)) tgt = null;
    if (!tgt) {
      // nearest enemy ship: warships and transports first. Fishermen are
      // never hunted, at any map size: a blockade drives them home instead
      // (below), and a blockaded harbour sends none out.
      let bs = Infinity;
      this.near(v.x, v.z, 30 * look, (o, d) => {
        if (o.cls !== 'sea' || o.state === 'sinking' || o.state === 'moored' || o.role === 'fishing' || !enemies.includes(o.kingdom)) return;
        const sc = d - (o.role === 'galley' ? 8 : o.role === 'transport' ? 7 : o.role === 'carrack' || o.role === 'cog' ? 3 : 0);
        if (sc < bs) {
          bs = sc;
          tgt = o;
        }
      });
      if (tgt && (nav.comp(tgt.x, tgt.z) !== nav.comp(v.x, v.z) || nav.clearAt(tgt.x, tgt.z) < 1.8)) tgt = null;
    }
    if (tgt) {
      v.target = tgt.id;
      v.chase = true;
      m.blockade = null;
      const d = Math.hypot(tgt.x - v.x, tgt.z - v.z);
      // (hulls keep a hand's breadth apart: bow to stern still counts as alongside)
      const reach = Math.max(1.6 + (v.def.size + tgt.def.size) * 0.5, (v.def.length + tgt.def.length) * 0.5 + 0.45);
      if (d <= reach) {
        this._fight(v, tgt, dt);
        if (!v.alive || v.state === 'sinking') return;
        v.state = 'patrol';
        v.path = null;
        // turn alongside
        const want = Math.atan2(tgt.z - v.z, tgt.x - v.x) + Math.PI / 2;
        v.heading += Math.max(-0.5, Math.min(0.5, ((want - v.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI)) * dt;
      } else {
        // within bowshot: volleys of arrows and fire pots while closing
        if (d <= 9 && nav.los(v.x, v.z, tgt.x, tgt.z, 0)) this._archery(v, tgt, dt, d);
        if (!v.alive || v.state === 'sinking') return;
      }
      if (d > reach && (m.repath = (m.repath || 0) - dt) <= 0) {
        m.repath = d < 14 ? 1.5 : 4;
        // close in, straight when the water allows
        const ax = tgt.x - Math.cos(tgt.heading) * 0.5,
          az = tgt.z - Math.sin(tgt.heading) * 0.5;
        if (nav.los(v.x, v.z, ax, az, 1.2)) {
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
          const d = this.dist(h.berth.x, h.berth.z, v.x, v.z);
          if (d < bd && d < this.range(v.kingdom, 'galley')) {
            bd = d;
            bh = h;
          }
        }
    }
    let px, pz;
    if (bh) {
      m.blockade = bh.id;
      const sp = nav.waterNear(bh.berth.x + bh.dirX * 6, bh.berth.z + bh.dirZ * 6, 5, 2.5) || nav.waterNear(bh.berth.x + bh.dirX * 5, bh.berth.z + bh.dirZ * 5, 4, 1.5) || bh.berth;
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
    // each galley of the squadron keeps its own station, line abreast
    const st = this._station(v, px, pz, bh || (v.harbour != null ? this.harbourInfo(v.harbour) : null));
    px = st.x;
    pz = st.z;
    const dd = this.dist(px, pz, v.x, v.z);
    if (dd > 3.5) {
      if (v.state !== 'sail' || !v.dest || this.dist(v.dest.x, v.dest.z, px, pz) > 2) {
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
        // holding the blockade a while, the galley rows in to burn a ship
        // moored in the harbour (never a fishing boat): on a big map's wide
        // seas enemy sail seldom passes a blockade, and none leaves port
        if ((m.raidWait = (m.raidWait ?? 20) - dt) <= 0) {
          m.raidWait = 30;
          let prey = null,
            pd = 14;
          this.near(v.x, v.z, 14, (o, d) => {
            if (o.cls !== 'sea' || o.role === 'fishing' || o.state !== 'moored' || o.harbour !== bh.id || !enemies.includes(o.kingdom) || d >= pd) return;
            pd = d;
            prey = o;
          });
          if (prey) {
            m.raid = prey.id;
            m.raidAt = now;
            v.target = prey.id;
          }
        }
        // the harbour's fishing boats put about and run for home
        this.near(v.x, v.z, 10, (o) => {
          if (o.role !== 'fishing' || o.harbour !== bh.id || o.state === 'sinking' || o.state === 'moored' || o.mission?.phase === 'home') return;
          o.cargo = { fish: Math.round(1 + this.rng() * 2) };
          this._goHome(o);
        });
        if (!m.announced) {
          m.announced = true;
          this.note(`⚓ Galleys of ${this.kname(v.kingdom)} blockade the harbour of ${bh.name}`, 'war', { x: bh.x, z: bh.z }, 'blockade' + v.kingdom + '-' + bh.kingdom, 1200);
        }
      }
    }
  },

  // A galley's own station off a harbour: its squadron (the realm's galleys
  // keeping the same watch) lies line abreast across the approach, a few
  // hull lengths apart, instead of piling onto one point.
  _station(v, px, pz, h) {
    const key = (v.mission.station = h ? h.id : -1);
    let i = 0,
      n = 0;
    for (const o of this.list) {
      if (!o.alive || o.role !== 'galley' || o.kingdom !== v.kingdom || o.state === 'sinking' || o.mission?.type !== 'patrol' || o.target != null) continue;
      if (o !== v && o.mission.station !== key) continue;
      if (o.id < v.id) i++;
      n++;
    }
    if (n <= 1 || !h) return { x: px, z: pz };
    const ax = -h.dirZ,
      az = h.dirX;
    const slot = i - (n - 1) / 2;
    const gap = v.def.length + 2.2;
    for (const f of [1, 0.6, -1]) {
      const x = px + ax * slot * gap * f,
        z = pz + az * slot * gap * f;
      const p = this.nav.waterNear(x, z, 2, 1.2);
      if (p && this.nav.comp(p.x, p.z) === this.nav.comp(px, pz)) return p;
    }
    return { x: px, z: pz };
  },

  // Arrows and fire pots from one ship at another, seen in flight: longer
  // shots fly longer and miss more often (into the sea, with a splash).
  _volley(from, to, n, potP = 0.12) {
    const d = Math.hypot(to.x - from.x, to.z - from.z);
    for (let i = 0; i < n; i++) {
      const shell = from.def.sail === false && from.def.dps > 5; // a gun: shells, not arrows
      const pot = !shell && this.rng() < potP;
      const hit = this.rng() < (pot ? 0.6 : 0.62) - Math.max(0, d - 3) * 0.035;
      const ox = (this.rng() - 0.5) * from.def.length * 0.6,
        oz = (this.rng() - 0.5) * from.def.length * 0.6;
      const spread = 1.2 + d * 0.25;
      const mx = hit ? (this.rng() - 0.5) * to.def.length * 0.5 : (this.rng() - 0.5) * spread * 2,
        mz = hit ? (this.rng() - 0.5) * to.def.length * 0.5 : (this.rng() - 0.5) * spread * 2;
      // lead the target a little: it sails on while the arrow flies
      const dur = 0.5 + d * 0.085 + this.rng() * 0.25;
      const lead = Math.min(1, to.speed || 0) * dur * 0.8;
      if (this.shots.length > 160) this.shots.shift();
      this.shots.push({ x0: from.x + ox, z0: from.z + oz, x1: to.x + Math.cos(to.heading) * lead + mx, z1: to.z + Math.sin(to.heading) * lead + mz, t: -this.rng() * 0.45, dur: shell ? dur * 0.6 : dur, pot, shell, hit, target: to.id });
    }
  },

  // Within bowshot but not yet alongside: both crews loose at each other.
  _archery(a, b, dt, d) {
    const crew = (v) => 0.45 + 0.55 * (v.hp / v.maxHp);
    this._volley(a, b, 2 + Math.floor(this.rng() * 3), 0.07);
    if (b.def.dps > 0 && d < 7.5) this._volley(b, a, 1 + Math.floor(this.rng() * 2), 0.05);
    this.hurt(b, a.def.dps * 0.1 * this._matMod(a.kingdom) * crew(a) * dt, 'battle', a);
    if (b.alive && b.state !== 'sinking' && b.def.dps > 0 && d < 7.5) this.hurt(a, b.def.dps * 0.1 * this._matMod(b.kingdom) * crew(b) * dt, 'battle', b);
    a.lastFight = b.lastFight = this.game.time.total;
  },

  // Volleys of arrows, grapples and rams: both crews trade blows.
  _fight(a, b, dt) {
    const crew = (v) => 0.45 + 0.55 * (v.hp / v.maxHp);
    // first contact: the galley drives its ram home
    if (a.kind === 'galley' && a.rammed !== b.id) {
      a.rammed = b.id;
      const mx = (a.x + b.x) / 2,
        mz = (a.z + b.z) / 2;
      this._fx('splash', mx, mz, 0.9);
      this._fx('debris', mx, mz, 0.7, { y: 0.3 });
      this._sfx('hit', mx, mz, 0.7);
      for (let i = 0; i < 2; i++) this._addDebris(b.x + (this.rng() - 0.5) * b.def.length * 0.6, b.z + (this.rng() - 0.5) * b.def.length * 0.4, i);
      this.hurt(b, b.maxHp * 0.1 * this._matMod(a.kingdom), 'battle', a);
      if (!b.alive || b.state === 'sinking') return;
    }
    // volleys of arrows and the odd fire pot, both ways (seen in flight)
    this._volley(a, b, 2 + Math.floor(this.rng() * 3), 0.12);
    if (b.def.dps > 0) this._volley(b, a, 1 + Math.floor(this.rng() * 2), 0.12);
    // grappled: both ships lose way and fight it out where they are
    if (a.def.sail !== false && b.def.sail !== false) a.grappled = b.grappled = this.game.time.total + 1.5;
    const da = a.def.dps * this._matMod(a.kingdom) * crew(a) * dt;
    this.hurt(b, da, 'battle', a);
    if (b.alive && b.state !== 'sinking' && b.def.dps > 0) this.hurt(a, b.def.dps * this._matMod(b.kingdom) * crew(b) * dt * 0.85, 'battle', b);
    a.lastFight = b.lastFight = this.game.time.total;
    a.fightWith = b.id;
    b.fightWith = a.id;
    const ka = Math.min(a.kingdom, b.kingdom),
      kb = Math.max(a.kingdom, b.kingdom);
    if (b.role === 'galley') {
      // a battle worth the chronicle: three or more warships in the fight
      let n = 0;
      this.near((a.x + b.x) / 2, (a.z + b.z) / 2, 10, (o) => {
        if (o.role === 'galley' && o.state !== 'sinking' && (o.kingdom === a.kingdom || o.kingdom === b.kingdom)) n++;
      });
      if (n >= 3) {
        const where = this._placeName((a.x + b.x) / 2, (a.z + b.z) / 2);
        this.note(`⚔ A sea battle off ${where}: ${n} ${a.kind === 'galley' && b.kind === 'galley' ? 'galleys' : 'warships'} of ${this.kname(a.kingdom)} and ${this.kname(b.kingdom)} clash`, 'war', { x: a.x, z: a.z }, 'seabattle' + ka + '-' + kb, 900);
      }
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
