import { SEA_LEVEL, TILE } from './constants.js';

// Sea ice and seasonal ice: one per-tile field that both the water shader
// (what is drawn as ice) and the fleet (where keels may go) read, so a boat
// never sails across what the player sees as ice.
//
// Every water tile has a freeze key. The tile is frozen while the freeze
// level of the season, age and frost law (freezeLevel) is above its key:
//
//   frozen(i) = level > key[i]
//
//   ICE tiles (sea ice laid down by world generation or the Ice brush): the
//     polar pack (temperature <= THAW_T) stays frozen all year; warmer ice,
//     a cool lagoon say, is open water through summer and freezes over with
//     the winter. Near the pack's edge the key ramps up by RAMP tiles, so
//     the margin comes and goes smoothly instead of a whole tile at once.
//   other calm water (lakes, rivers, lagoons, shallows): a shelf that grows
//     out from the shore and from the pack, SHELF tiles per unit of cold.
//     Wide, deep open sea barely freezes.
//
// The water shader reads the keys through a float texture (uIceKey) and the
// level through uFreezeT; ships use frozen() with a small pad that covers the
// shader's ragged edge (FleetIce in src/sim/fleet/Fleet.js).

export const THAW_T = 0.15; // ICE tiles warmer than this thaw outside winter
export const SHELF = 70; // tiles of seasonal shelf per unit of freeze level
export const RAMP = 4; // tiles over which the pack's margin ramps
export const NAV_PAD = 0.012; // ships keep this much level clear of the drawn edge
export const LAND_KEY = 9; // keys of land tiles never decide a ship's way
export const BERG_KEY = -0.25; // an iceberg's tile: frozen at every level an age can bring

const _ease = (t) => t * t * (3 - 2 * t);

// How much winter it is at season s (0 spring .. 4): full around mid-winter,
// building in late autumn and melting in early spring.
export function winterAmount(s) {
  if (typeof s !== 'number' || !isFinite(s)) s = 1.5;
  s = ((s % 4) + 4) % 4;
  let d = Math.abs(s - 3.5);
  d = Math.min(d, 4 - d);
  return _ease(Math.max(0, Math.min(1, 1 - (d - 0.3) / 0.65)));
}

// The freeze level now (the target the water shader's uFreezeT eases to).
export function freezeLevel(game) {
  const temp = Math.max(-0.5, Math.min(0.5, game.age?.mods?.temperature ?? 0));
  const frost = Math.max(0.5, Math.min(2, game.laws?.biomeFrost ?? 1));
  const cold = Math.max(0, -temp),
    warm = Math.max(0, temp);
  return (winterAmount(game.time?.season) * 0.2 + cold * 0.6) * frost - warm * 0.3;
}

// The highest level any age and frost law can reach: tiles keyed above it
// can never freeze, so ships and the shader need not look at them.
export const LEVEL_MAX = (0.2 + 0.5 * 0.6) * 2;

const shared = new WeakMap();
export function seaIceOf(game) {
  let s = shared.get(game);
  if (!s || s.world !== game.world) {
    s = new SeaIce(game.world);
    shared.set(game, s);
  }
  return s;
}

export class SeaIce {
  constructor(world) {
    this.world = world;
    this.w = world.w;
    this.h = world.h;
    const N = this.w * this.h;
    this.key = new Float32Array(N); // freeze key per tile (LAND_KEY on land)
    this.berg = new Uint8Array(N); // 1 = an iceberg rides in this tile (frozen while it is cold)
    this.version = 0;
    this._dirty = true;
    this._ice = new Uint8Array(N); // ICE-ness of each water tile at the last build
    this._wet = new Uint8Array(N); // water tiles at the last build
    const ev = world.events;
    if (ev?.on) {
      // the keys follow the water: a dig or a raise on dry land changes nothing
      ev.on('world:height', (r) => {
        if (this._dirty) return;
        const W = this.w,
          hgt = world.height,
          wet = this._wet;
        for (let y = Math.max(0, r.y0); y <= Math.min(this.h - 1, r.y1) && !this._dirty; y++)
          for (let x = Math.max(0, r.x0); x <= Math.min(W - 1, r.x1); x++) {
            const i = y * W + x;
            if (wet[i] || hgt[i] < SEA_LEVEL) {
              this._dirty = true;
              break;
            }
          }
      });
      // only water freezing over or thawing (the Ice brush, an icebreaker)
      // changes the keys: farms and roads on land do not
      ev.on('world:type', (r) => {
        if (this._dirty) return;
        const W = this.w,
          hgt = world.height,
          ty = world.type;
        for (let y = Math.max(0, r.y0); y <= Math.min(this.h - 1, r.y1) && !this._dirty; y++)
          for (let x = Math.max(0, r.x0); x <= Math.min(W - 1, r.x1); x++) {
            const i = y * W + x;
            if ((hgt[i] < SEA_LEVEL && ty[i] === TILE.ICE ? 1 : 0) !== this._ice[i]) {
              this._dirty = true;
              break;
            }
          }
      });
    }
  }

  invalidate() {
    this._dirty = true;
  }
  get dirty() {
    return this._dirty;
  }

  // The keys, rebuilt first when the water changed.
  ensure() {
    if (this._dirty) this._build();
    return this.key;
  }

  // Is water tile i frozen at this level (pad: extra level, the ships' margin)?
  frozen(i, level, pad = 0) {
    return this.key[i] < level + pad;
  }

  _build() {
    this._dirty = false;
    const world = this.world;
    const W = this.w,
      H = this.h,
      N = W * H;
    const hgt = world.height,
      ty = world.type,
      tmp = world.temperature;
    const INF = 1e9;
    const isW = (i) => hgt[i] < SEA_LEVEL;
    const ice = this._ice,
      wet = this._wet;
    for (let i = 0; i < N; i++) {
      wet[i] = isW(i) ? 1 : 0;
      ice[i] = wet[i] && ty[i] === TILE.ICE ? 1 : 0;
    }
    // tiles to the nearest land
    const dl = new Float32Array(N);
    for (let i = 0; i < N; i++) dl[i] = isW(i) ? INF : 0;
    edt2d(dl, W, H);
    // tiles from a pack tile to the nearest open water (land does not count)
    const din = new Float32Array(N);
    for (let i = 0; i < N; i++) din[i] = ice[i] ? INF : isW(i) ? 0 : INF;
    edt2d(din, W, H);
    // tiles from open water to the nearest pack tile
    const di = new Float32Array(N);
    for (let i = 0; i < N; i++) di[i] = ice[i] ? 0 : INF;
    edt2d(di, W, H);
    // how wide the water is here: the land distance, dilated over 4 tiles
    const wide = dilate(dl, W, H, 4);
    const key = this.key,
      berg = this.berg;
    berg.fill(0);
    const sm = (a, b, x) => {
      const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!isW(i)) {
          key[i] = LAND_KEY;
          continue;
        }
        const t = tmp[i];
        let packN = 0;
        if (!ice[i])
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx,
                yy = y + dy;
              if ((dx || dy) && xx >= 0 && yy >= 0 && xx < W && yy < H && ice[yy * W + xx]) packN++;
            }
        if (ice[i] || packN >= 5) {
          // the pack (and the odd open pocket or notch in it)
          const r = ice[i] ? Math.min(Math.sqrt(din[i]), RAMP) : 1;
          key[i] = t <= THAW_T ? -r / SHELF : 0.06 + (t - THAW_T) - r / SHELF;
          continue;
        }
        const depth = -hgt[i];
        const open = sm(1.4, 4.0, Math.sqrt(wide[i]));
        const calm = Math.max(1 - open, 1 - sm(1.2, 3.0, depth));
        const shore = Math.min(Math.sqrt(dl[i]), Math.sqrt(di[i]));
        // (calm, shallow water freezes first: a cool lagoon ices over in
        // midwinter, while the open sea beside it stays dark)
        const still = calm * (1 - sm(0.8, 2.6, depth));
        key[i] = t + shore / SHELF + (1 - calm) * 0.6 - 0.05 * still;
        // icebergs: a rare berg in cold, deep, open water, one tile across and
        // well clear of any shore (frozen to ships while the sea is cold)
        if (t < 0.3 && depth > 3 && dl[i] > 36 && di[i] > 9 && hash2(x, y) < 0.0017 * (1 - sm(0.12, 0.3, t))) {
          berg[i] = 1;
          key[i] = BERG_KEY;
        }
      }
    // land: just below the lowest water key around it, so a frozen shore
    // stays frozen right up to the beach in the shader's interpolation
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (isW(i)) continue;
        let m = Infinity;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx,
              yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            const j = yy * W + xx;
            if (isW(j) && key[j] < m) m = key[j];
          }
        key[i] = m < Infinity ? m - 1 / SHELF : LAND_KEY;
      }
    this.version++;
  }
}

function hash2(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// max filter of radius r (separable)
function dilate(src, W, H, r) {
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let m = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(W - 1, x + r); k++) {
        const v = src[y * W + k];
        if (v > m) m = v;
      }
      tmp[y * W + x] = m;
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let m = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(H - 1, y + r); k++) {
        const v = tmp[k * W + x];
        if (v > m) m = v;
      }
      out[y * W + x] = m;
    }
  return out;
}

// Felzenszwalb-Huttenlocher squared Euclidean distance transform (in place).
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}
export function edt2d(grid, W, H) {
  const n = Math.max(W, H);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = grid[y * W + x];
    edt1d(f, H, d, v, z);
    for (let y = 0; y < H; y++) grid[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = grid[y * W + x];
    edt1d(f, W, d, v, z);
    for (let x = 0; x < W; x++) grid[y * W + x] = d[x];
  }
  return grid;
}
