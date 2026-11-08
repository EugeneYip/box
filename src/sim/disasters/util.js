import { TILE, FLORA, FLORA_INFO, SEA_LEVEL, MIN_HEIGHT, MAX_HEIGHT } from '../../world/constants.js';
import { hash2 } from '../../core/Random.js';

// Shared helpers for disasters. Every cross-module call is guarded.

export function play(game, name, pos, volume = 1, pitch = 1) {
  try {
    game.audio?.play?.(name, { pos, volume, pitch });
  } catch (e) {
    /* audio is optional */
  }
}

export function hurt(game, x, z, r, unitDmg, buildingDmg, cause) {
  try {
    if (unitDmg > 0) game.units?.damageArea?.(x, z, r, unitDmg, cause);
  } catch (err) {
    console.error('[disasters] units.damageArea', err);
  }
  try {
    if (buildingDmg > 0) game.civ?.damageArea?.(x, z, r, buildingDmg, cause);
  } catch (err) {
    console.error('[disasters] civ.damageArea', err);
  }
}

export const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// Carve an impact crater: parabolic bowl with a raised, noisy rim of
// ejected material. Returns the tiles touched as a dirty rect.
export function carveCrater(game, cx, cz, R, depth, opts = {}) {
  const w = game.world;
  const rim = opts.rim ?? depth * 0.38;
  const ext = R * 1.75;
  const seed = (opts.seed ?? Math.random() * 1000) | 0;
  const fire = game.disasters?.fire;
  const rng = Math.random;
  w.forEachInRadius(cx, cz, ext, (tx, ty, dn, i) => {
    const d = (dn * ext) / R;
    const jitter = (hash2(tx, ty, seed) - 0.5) * 0.18;
    const dd = d + jitter;
    let dh = 0;
    if (dd < 1) dh -= depth * (1 - dd * dd);
    dh += rim * Math.exp(-(((dd - 0.98) / 0.3) ** 2)) * (0.75 + hash2(tx, ty, seed + 1) * 0.5);
    w.height[i] = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, w.height[i] + dh));
    const water = w.height[i] < SEA_LEVEL;
    if (d < 1.25 && w.flora[i] !== FLORA.NONE) {
      const info = FLORA_INFO[w.flora[i]];
      w.flora[i] = d < 0.9 || !info.isTree ? FLORA.NONE : FLORA.DEAD_TREE;
      w.floraGrowth[i] = w.flora[i] ? 0.8 : 0;
    }
    if (!water) {
      if (d < (opts.rockCore ?? 0.6)) w.type[i] = hash2(tx, ty, seed + 2) < 0.75 ? TILE.ROCK : TILE.ASH;
      else if (d < 1.15) w.type[i] = hash2(tx, ty, seed + 3) < 0.8 ? TILE.ASH : TILE.ROCK;
      else if (d < 1.5 && hash2(tx, ty, seed + 4) < 0.5 && (w.type[i] === TILE.GRASS || w.type[i] === TILE.FOREST || w.type[i] === TILE.SAVANNA)) w.type[i] = TILE.ASH;
    } else if (d < 1.1 && w.type[i] !== TILE.ROCK) w.type[i] = TILE.SAND;
    if (opts.ignite && !water && d > 0.85 && d < 1.75 && rng() < opts.ignite * (1.8 - d)) fire?.ignite(tx, ty, 0.9);
  });
  const r = Math.ceil(ext) + 1;
  const tx = Math.floor(cx),
    ty = Math.floor(cz);
  w.markDirty('height', tx - r, ty - r, tx + r, ty + r);
  w.markDirty('type', tx - r, ty - r, tx + r, ty + r);
  w.markDirty('flora', tx - r, ty - r, tx + r, ty + r);
  return { x0: tx - r, y0: ty - r, x1: tx + r, y1: ty + r };
}

export function rand(a, b) {
  return a + (b - a) * Math.random();
}

const DIRS = ['northern', 'north-eastern', 'eastern', 'south-eastern', 'southern', 'south-western', 'western', 'north-western'];

// "the northern hills", "the eastern waters near Oakridge", ... (direction
// from the map centre, terrain, nearest village if close)
export function regionName(g, x, z) {
  const w = g.world;
  const dx = x - w.w / 2,
    dz = z - w.h / 2;
  const far = Math.hypot(dx, dz) > Math.min(w.w, w.h) * 0.16;
  // north is -z (the top of the map at the default camera yaw)
  const ang = Math.atan2(dx, -dz);
  const dir = far ? DIRS[(Math.round(ang / (Math.PI / 4)) + 8) % 8] : 'central';
  const [tx, ty] = w.tileOf(x, z);
  const i = w.idx(tx, ty);
  const h = w.height[i];
  const t = w.type[i];
  let place;
  if (h < SEA_LEVEL) place = 'waters';
  else if (h > 10) place = 'peaks';
  else if (h > 5) place = 'hills';
  else if (w.isCoastal?.(tx, ty)) place = 'shore';
  else if (t === TILE.FOREST || t === TILE.JUNGLE) place = 'woods';
  else if (t === TILE.DESERT) place = 'dunes';
  else if (t === TILE.SNOW || t === TILE.TUNDRA || t === TILE.ICE) place = 'snowfields';
  else if (t === TILE.SWAMP) place = 'marshes';
  else if (t === TILE.SAVANNA) place = 'grasslands';
  else place = 'plains';
  let near = '';
  try {
    let best = 14 * 14;
    for (const v of g.civ?.villages || []) {
      if (!v || v.alive === false || !v.name) continue;
      const vx = v.x ?? v.cx,
        vz = v.z ?? v.cz;
      if (vx == null) continue;
      const d2 = (vx - x) ** 2 + (vz - z) ** 2;
      if (d2 < best) {
        best = d2;
        near = ' near ' + v.name;
      }
    }
  } catch (e) {
    /* villages are optional */
  }
  return `the ${dir} ${place}${near}`;
}

// Read a world law at the point of use (default when laws are missing).
export function law(game, key, fallback) {
  const v = game.laws?.[key];
  return v === undefined ? fallback : v;
}
