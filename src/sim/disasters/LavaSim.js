import { TILE, FLORA, FLORA_INFO, SEA_LEVEL, DIRS8 } from '../../world/constants.js';
import { law } from './util.js';

// Lava flow as a height-field fluid. world.height holds the lava SURFACE
// (ground + molten thickness `vol`), so the rendered terrain shows real 3D
// flows. Each tick, molten tiles pass volume to lower neighbours (viscosity
// rises as the lava cools), heat decays (faster when thin, raining or next
// to water) and cooled lava solidifies in place as ROCK (thick) or ASH
// (thin edges), permanently building new land. Lava pouring into water
// quenches: it raises the sea floor into new rock, makes steam and cools.
// Hot lava ignites flammable neighbours and destroys vegetation.

const COOL_HEAT = 0.16;

export class LavaSim {
  constructor(game) {
    this.game = game;
    const n = game.world.size;
    this.vol = new Float32Array(n);
    this.heat = new Float32Array(n);
    this.inList = new Uint8Array(n);
    this.list = new Int32Array(n);
    this.count = 0;
    this.sources = [];
    this.version = 0;
    this.steam = []; // visual events {x, z, s} consumed by Disasters.frame
    this.rng = game.rng.fork('lava');
    this._dh = null; // pending height dirty rect
    this._dt = null; // pending type dirty rect
    this._hTimer = 0;
  }

  reset() {
    this.vol.fill(0);
    this.heat.fill(0);
    this.inList.fill(0);
    this.count = 0;
    this.sources.length = 0;
    this.steam.length = 0;
    this._dh = this._dt = null;
    this.version++;
  }

  // Continuous source (volcano vent). rate in volume/s, for `duration` s.
  addSource(tx, ty, rate, duration) {
    const s = { tx, ty, rate, until: this.game.time.total + duration };
    this.sources.push(s);
    return s;
  }

  // Pour lava at a tile.
  pour(tx, ty, amount, heat = 1) {
    const w = this.game.world;
    if (!w.inBounds(tx, ty)) return;
    const i = w.idx(tx, ty);
    if (w.height[i] < SEA_LEVEL) {
      this._quench(i, amount);
      return;
    }
    const v = this.vol[i];
    this.heat[i] = v + amount > 0 ? (this.heat[i] * v + heat * amount) / (v + amount) : heat;
    this.vol[i] = v + amount;
    w.height[i] += amount;
    this._melt(i);
    this._add(i);
    this._markH(i);
  }

  _add(i) {
    if (this.inList[i]) return;
    this.inList[i] = 1;
    this.list[this.count++] = i;
  }

  _melt(i) {
    const w = this.game.world;
    const W = w.w;
    const x = i % W,
      y = (i / W) | 0;
    if (w.type[i] !== TILE.LAVA && this.vol[i] > 0.012) {
      w.type[i] = TILE.LAVA;
      this._markT(i);
    }
    if (w.flora[i]) {
      const info = FLORA_INFO[w.flora[i]];
      if (info.isTree || info.flammable > 0) this.game.disasters?.fire?.ignite(x, y, 1, { force: true });
      w.setFlora(x, y, FLORA.NONE);
    }
    if (w.building[i] >= 0) {
      try {
        this.game.civ?.damageArea?.(x + 0.5, y + 0.5, 0.8, 60, 'lava');
      } catch (err) {
        console.error('[lava] civ.damageArea', err);
      }
    }
  }

  _quench(j, amount) {
    const w = this.game.world;
    const W = w.w;
    // lava hitting water freezes into new rock on the sea floor
    w.height[j] = Math.min(SEA_LEVEL + 0.35, w.height[j] + amount * 1.6);
    if (w.height[j] >= SEA_LEVEL) {
      w.height[j] = Math.max(w.height[j], SEA_LEVEL + 0.12);
      w.type[j] = TILE.ROCK;
      this._markT(j);
    } else if (w.type[j] !== TILE.ROCK) {
      w.type[j] = TILE.ROCK;
      this._markT(j);
    }
    this._markH(j);
    if (this.steam.length < 64) this.steam.push({ x: (j % W) + 0.5, z: ((j / W) | 0) + 0.5, s: Math.min(2, 0.6 + amount * 3) });
  }

  _markH(i) {
    const W = this.game.world.w;
    this._dh = grow(this._dh, i % W, (i / W) | 0);
  }
  _markT(i) {
    const W = this.game.world.w;
    this._dt = grow(this._dt, i % W, (i / W) | 0);
  }

  tick(step) {
    const g = this.game;
    const w = g.world;
    const W = w.w;
    // sources
    for (let s = this.sources.length - 1; s >= 0; s--) {
      const src = this.sources[s];
      if (g.time.total > src.until) {
        this.sources.splice(s, 1);
        continue;
      }
      this.pour(src.tx, src.ty, src.rate * step, 1);
    }
    if (!this.count) {
      this._flushDirty(step);
      return;
    }
    const env = g.env;
    const wt = env.weather?.type;
    const rain = wt === 'rain' || wt === 'storm' ? 1 : 0;
    const rng = this.rng;
    const fire = g.disasters?.fire;
    const flowOn = law(g, "natureLavaFlow", true);
    for (let k = this.count - 1; k >= 0; k--) {
      const i = this.list[k];
      const x = i % W,
        y = (i / W) | 0;
      let v = this.vol[i];
      let h = this.heat[i];
      // ---- flow ----
      // World Law natureLavaFlow: when off, lava stays put and simply cools
      if (flowOn && v > 0.02 && h > COOL_HEAT) {
        const visc = Math.min(1, (h - COOL_HEAT) * 2.6); // hot = runny
        const L = w.height[i];
        let total = 0;
        const drops = this._drops || (this._drops = new Float32Array(8));
        for (let d = 0; d < 8; d++) {
          const nx = x + DIRS8[d][0],
            ny = y + DIRS8[d][1];
          drops[d] = 0;
          if (nx < 0 || ny < 0 || nx >= W || ny >= w.h) continue;
          const j = ny * W + nx;
          const dh = L - Math.max(w.height[j], SEA_LEVEL - 0.05) - (w.height[j] < SEA_LEVEL ? 0 : 0.04);
          if (dh > 0) {
            const dd = dh * (d >= 4 ? 0.7 : 1);
            drops[d] = dd;
            total += dd;
          }
        }
        if (total > 0) {
          const move = Math.min(v * 0.9, total * 0.48) * visc * Math.min(1, step * 12);
          for (let d = 0; d < 8; d++) {
            if (drops[d] <= 0) continue;
            const j = (y + DIRS8[d][1]) * W + x + DIRS8[d][0];
            const m = (move * drops[d]) / total;
            if (m <= 1e-5) continue;
            w.height[i] -= m;
            v -= m;
            if (w.height[j] < SEA_LEVEL) {
              this._quench(j, m);
              h -= 0.25 * step; // the front quenches against the sea
            } else {
              const vj = this.vol[j];
              this.heat[j] = (this.heat[j] * vj + h * m) / (vj + m);
              this.vol[j] = vj + m;
              w.height[j] += m;
              if (!this.inList[j]) {
                this._melt(j);
                this._add(j);
              } else if (w.type[j] !== TILE.LAVA && this.vol[j] > 0.012) this._melt(j);
              this._markH(j);
            }
          }
          this._markH(i);
        }
      }
      // ---- cooling ----
      let cool = step * (0.008 + 0.022 / (1 + v * 4)) * (1 + rain * 2.5);
      // neighbouring water chills fast
      if (w.isCoastal(x, y)) cool += step * 0.02;
      h -= cool;
      // ---- ignite surroundings ----
      if (h > 0.45 && fire && rng.next() < step * 0.6 * h) {
        const d = DIRS8[(rng.next() * 8) | 0];
        const nx = x + d[0] + Math.round((rng.next() - 0.5) * 2),
          ny = y + d[1] + Math.round((rng.next() - 0.5) * 2);
        if (w.inBounds(nx, ny) && !this.inList[ny * W + nx]) fire.ignite(nx, ny, 0.9);
      }
      this.vol[i] = Math.max(0, v);
      this.heat[i] = h;
      // ---- solidify ----
      if (h <= COOL_HEAT || v <= 0.002) {
        const thick = this.vol[i];
        this.vol[i] = 0;
        this.heat[i] = 0;
        w.type[i] = thick > 0.25 || w.height[i] > 3 ? TILE.ROCK : rng.next() < 0.6 ? TILE.ASH : TILE.ROCK;
        this._markT(i);
        this.inList[i] = 0;
        this.count--;
        this.list[k] = this.list[this.count];
      }
    }
    this.version++;
    this._flushDirty(step);
  }

  _flushDirty(step) {
    const w = this.game.world;
    if (this._dt) {
      const r = this._dt;
      this._dt = null;
      w.markDirty('type', r.x0, r.y0, r.x1, r.y1);
    }
    // throttle height re-meshing: flows change slowly
    this._hTimer -= step;
    if (this._dh && this._hTimer <= 0) {
      const r = this._dh;
      this._dh = null;
      this._hTimer = 0.25;
      w.markDirty('height', r.x0 - 1, r.y0 - 1, r.x1 + 1, r.y1 + 1);
    }
  }

  isMolten(tx, ty) {
    const w = this.game.world;
    if (!w.inBounds(tx, ty)) return false;
    return this.heat[w.idx(tx, ty)] > COOL_HEAT;
  }
}

function grow(r, x, y) {
  if (!r) return { x0: x, y0: y, x1: x, y1: y };
  if (x < r.x0) r.x0 = x;
  if (x > r.x1) r.x1 = x;
  if (y < r.y0) r.y0 = y;
  if (y > r.y1) r.y1 = y;
  return r;
}
