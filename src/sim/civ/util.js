// Shared helpers for the civilization simulation.

export const YEAR = 30; // game seconds per year (mirrors YEAR_SECONDS in Game.js)
export const ADULT_AGE = 16;

// Tile-use codes kept in Civilization.use (the civ's own knowledge of the map).
export const USE = Object.freeze({ FREE: 0, BUILDING: 1, ROAD: 2, PLOT: 3, RUIN: 4, QUARRY: 5 });

// Tile offsets sorted by distance (spiral search), radius <= SPIRAL_R.
export const SPIRAL_R = 30;
export const SPIRAL = (() => {
  const out = [];
  for (let dy = -SPIRAL_R; dy <= SPIRAL_R; dy++)
    for (let dx = -SPIRAL_R; dx <= SPIRAL_R; dx++) {
      const d = Math.hypot(dx, dy);
      if (d <= SPIRAL_R) out.push([dx, dy, d]);
    }
  out.sort((a, b) => a[2] - b[2]);
  return out;
})();
// number of spiral entries within radius r
export function spiralCount(r) {
  let lo = 0,
    hi = SPIRAL.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (SPIRAL[m][2] <= r) lo = m + 1;
    else hi = m;
  }
  return lo;
}

// Rotation helpers: door faces local +Z; rot index 0..3 -> radians.
export const ROT = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
// Unit vector the door faces for a rotation index (world X, Z).
export const ROT_DIR = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];
export function rotIndexFromDir(dx, dz) {
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 1 : 3;
  return dz > 0 ? 0 : 2;
}

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
export function lerp(a, b, t) {
  return a + (b - a) * t;
}
export function dist2(ax, az, bx, bz) {
  const dx = ax - bx,
    dz = az - bz;
  return dx * dx + dz * dz;
}
