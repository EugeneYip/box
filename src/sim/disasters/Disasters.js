import { TILE, SEA_LEVEL } from '../../world/constants.js';
import { FireSim } from './FireSim.js';
import { LavaSim } from './LavaSim.js';
import { PlagueSim } from './Plague.js';
import { Meteor } from './Meteor.js';
import { lightningStrike, Smite } from './Strikes.js';
import { Earthquake } from './Earthquake.js';
import { Tornado } from './Tornado.js';
import { Volcano } from './Volcano.js';
import { Tsunami } from './Tsunami.js';
import { play, law } from './util.js';
import { Calamities } from './Calamities.js';

// Disasters & hazards (Effects & Disasters owner).
//
// PUBLIC CONTRACT
//   game.disasters.ignite(tx, ty, intensity=1)   start a fire at a tile
// Additional API (used by the disaster powers; safe for other modules):
//   extinguish(tx, ty), meteor(x, z, opts), meteorShower(x, z, radius, n),
//   lightning(x, z), smite(x, z, opts), earthquake(x, z, radius),
//   tornado(x, z, opts), volcano(x, z, radius), tsunami(x, z, opts),
//   plague(x, z, radius), inferno(x, z, radius), pourLava(tx, ty, amount)
//   fire  (FireSim: list/count of burning tiles, fuel, smoulder)
//   lava  (LavaSim: molten tiles, heat, volume)
//   plagueSim (PlagueSim: infected units)
// Simulation (fire spread, lava flow, plague) runs in tick() on game time.
// Disaster set pieces (meteor flight, tornado, quake, eruption) advance in
// frame() on a visual clock: real time scaled gently with game speed so
// they stay readable at 16x and freeze while paused.
export class Disasters {
  constructor(game) {
    this.game = game;
    this.fire = new FireSim(game);
    this.lava = new LavaSim(game);
    this.plagueSim = new PlagueSim(game);
    this.calamities = new Calamities(this);
    this.active = [];
    this._sky = 0;
    this._skyWritten = 0;
    this._plagueFx = 0;
  }

  reset() {
    for (const e of this.active) e.dispose?.();
    this.active.length = 0;
    this.fire.reset();
    this.lava.reset();
    this.plagueSim.reset();
    this.calamities.reset();
  }

  tick(step) {
    this.fire.tick(step);
    this.lava.tick(step);
    this.plagueSim.tick(step);
    this.calamities.tick(step);
    for (const e of this.active) e.tick?.(step);
  }

  // Visual clock: called every rendered frame by game.fx.update(dt).
  frame(dt) {
    const g = this.game;
    const vs = g.paused ? 0 : Math.min(3, Math.max(1, Math.pow(g.speed || 1, 0.4)));
    const vt = dt * vs;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      let alive = true;
      try {
        alive = e.update(vt, dt);
      } catch (err) {
        console.error('[disasters]', e.constructor?.name, err);
        alive = false;
      }
      if (!alive) {
        e.dispose?.();
        this.active.splice(i, 1);
      }
    }
    // steam where lava meets water
    const st = this.lava.steam;
    if (st.length) {
      // a wide lava front can quench dozens of tiles per tick: sample a few
      // events per frame and rate-limit the big columns so steam marks the
      // contact without burying the scene
      this._steamT = (this._steamT || 0) - dt;
      const n = Math.min(3, st.length);
      for (let k = 0; k < n; k++) {
        const s = st[(Math.random() * st.length) | 0];
        g.fx.emit('steam', { x: s.x, y: SEA_LEVEL + 0.1, z: s.z }, { scale: Math.min(1.6, s.s), count: 1 });
        if (this._steamT <= 0) {
          this._steamT = 0.35;
          g.fx.emit('steamColumn', { x: s.x, y: SEA_LEVEL + 0.2, z: s.z }, { scale: 0.7 + Math.min(1, s.s) * 0.4, count: 1 });
        }
      }
      if (Math.random() < 0.3) play(g, 'splash', st[0], 0.3, 0.6);
      st.length = 0;
    }
    // plague miasma around the sick
    const inf = this.plagueSim.infected;
    if (inf.size) {
      this._plagueFx += dt * Math.min(inf.size, 120) * 1.4;
      const arr = this._plagueFx >= 1 ? [...inf] : null;
      while (this._plagueFx >= 1 && arr.length) {
        this._plagueFx -= 1;
        const u = arr[(Math.random() * arr.length) | 0];
        g.fx.emit('miasma', { x: u.x, y: u.y + 0.2, z: u.z }, { count: 1, scale: 0.55 });
      }
      this._plagueFx = Math.min(this._plagueFx, 2);
    }
    // sky flash for our own lightning (when atmosphere does not draw it)
    if (this._sky > 0.01) {
      this._sky *= Math.exp(-dt * 9);
      g.env.lightning = Math.max(g.env.lightning || 0, this._sky);
      this._skyWritten = g.env.lightning;
    } else if (this._skyWritten) {
      if (g.env.lightning === this._skyWritten) g.env.lightning = 0;
      this._skyWritten = 0;
      this._sky = 0;
    }
  }

  flashSky(v = 1) {
    this._sky = Math.max(this._sky, v);
  }

  add(entity) {
    this.active.push(entity);
    return entity;
  }

  // ---- contract -------------------------------------------------------------
  // Hook for storm bolts drawn by other modules (e.g. the atmosphere):
  // applies the ground effects of a natural strike; ignition follows the
  // calamityLightning law.
  onStrike(x, z) {
    const w = this.game.world;
    if (!law(this.game, "calamityLightning", true)) return;
    const [tx, ty] = w.tileOf(x, z);
    if (w.isLand(tx, ty) && Math.random() < 0.6) this.ignite(tx, ty, 0.9);
  }
  ignite(tx, ty, intensity = 1) {
    return this.fire.ignite(tx, ty, intensity);
  }
  extinguish(tx, ty) {
    this.fire.extinguish(tx, ty);
  }

  // ---- disasters --------------------------------------------------------------
  meteor(x, z, opts = {}) {
    return this.add(new Meteor(this, x, z, opts));
  }
  meteorShower(x, z, radius = 14, n = 8) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2,
        r = Math.sqrt(Math.random()) * radius;
      const az = (this._showerAz ??= Math.random() * Math.PI * 2) + (Math.random() - 0.5) * 0.3;
      this.add(new Meteor(this, x + Math.cos(a) * r, z + Math.sin(a) * r, { size: 1.6 + Math.random() * 2, delay: k * 0.28 + Math.random() * 0.2, azimuth: az }));
    }
    this._showerAz = null;
  }
  lightning(x, z, opts) {
    lightningStrike(this, x, z, opts);
  }
  smite(x, z, opts) {
    return this.add(new Smite(this, x, z, opts));
  }
  earthquake(x, z, radius = 14) {
    return this.add(new Earthquake(this, x, z, radius));
  }
  tornado(x, z, opts) {
    return this.add(new Tornado(this, x, z, opts));
  }
  volcano(x, z, radius = 9) {
    return this.add(new Volcano(this, x, z, radius));
  }
  tsunami(x, z, opts) {
    return this.add(new Tsunami(this, x, z, opts));
  }
  pourLava(tx, ty, amount = 0.5) {
    this.lava.pour(tx, ty, amount, 1);
  }
  plague(x, z, radius = 3) {
    const g = this.game;
    const n = this.plagueSim.infectArea(x, z, radius);
    g.fx.emit('miasma', { x, z }, { count: 10, scale: 1.4 + radius * 0.2 });
    g.fx.emit('miasma', { x, z }, { count: 2, scale: 1.2, duration: 3, rate: 5 });
    g.fx.decal({ frame: 10, x, z, size: radius * 2.4, life: 40, color: 0x3e5a1e, alpha: 0.5, fadeIn: 0.05, fadeOut: 0.6 });
    play(g, 'magic', { x, z }, 0.6, 0.6);
    return n;
  }

  // ---- reporting -----------------------------------------------------------
  stats() {
    return { fires: this.fire.count, lava: this.lava.count, infected: this.plagueSim.infected.size };
  }
  inspect(hit) {
    const w = this.game.world;
    if (!hit || !w.inBounds(hit.tx, hit.ty)) return null;
    const i = w.idx(hit.tx, hit.ty);
    if (this.lava.heat[i] > 0.16)
      return { priority: 4, title: 'Molten Lava', subtitle: 'Flowing rock, slowly cooling', stats: [['Heat', Math.round(this.lava.heat[i] * 1200) + ' °C'], ['Depth', this.lava.vol[i].toFixed(2)]] };
    if (w.fire[i] > 0.02)
      return { priority: 4, title: 'Wildfire', subtitle: 'Spreading with the wind', stats: [['Intensity', Math.round(w.fire[i] * 100) + '%'], ['Fuel left', Math.round((this.fire.fuel[i] / Math.max(0.01, this.fire.fuel0[i])) * 100) + '%'], ['Burning tiles', this.fire.count]] };
    if (w.type[i] === TILE.ASH && this.fire.smolder[i] > 0.05) return { priority: 1, title: 'Smouldering Ash', stats: [] };
    return null;
  }
}
