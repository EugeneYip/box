// Geographic mapping for the World Map preset and its regional maps.
//
// Every World Map world (the whole Earth and each regional map such as Japan
// or Europe) describes its window on the globe in `world.meta.geo`:
//   { region, lonMin, lonMax, latMin, latMax, wrap }
// Tile (x, y) has its centre at world position (x + 0.5, y + 0.5). The map is
// a plain longitude/latitude grid over that window (regional maps choose
// their tile dimensions so that shapes keep their real proportions at the
// window's middle latitude). `wrap` is true only for the whole Earth, whose
// left and right edges meet in the Atlantic.
//
// Contract: docs/REGIONS.md. The World Map generator (src/world/earth.js)
// sets meta.geo; Civ places real cities with geoTile().

const WORLD_GEO = { region: 'world', lonMin: -30, lonMax: 330, latMin: -90, latMax: 90, wrap: true };

// The window a world covers, or null for a world that is not a map of Earth.
export function geoInfo(world) {
  const m = world?.meta;
  if (!m || m.preset !== 'earth') return null;
  return m.geo || WORLD_GEO;
}

// Region id of a World Map world ('world', 'japan', ...), or null.
export function geoRegion(world) {
  return geoInfo(world)?.region || null;
}

function wrap180(d) {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

// Longitude and latitude (degrees) at world position (x, z).
export function geoLonLat(world, x, z) {
  const g = geoInfo(world);
  if (!g) return null;
  const lon = g.lonMin + (x / world.w) * (g.lonMax - g.lonMin);
  const lat = g.latMax - (z / world.h) * (g.latMax - g.latMin);
  return [g.wrap ? wrap180(lon) : lon, lat];
}

// World position {x, z} of a longitude and latitude, or null when the point
// lies outside the map's window.
export function geoTile(world, lon, lat) {
  const g = geoInfo(world);
  if (!g) return null;
  if (lat < g.latMin || lat > g.latMax) return null;
  let dl = lon - g.lonMin;
  const span = g.lonMax - g.lonMin;
  if (g.wrap) dl = ((dl % 360) + 360) % 360;
  else if (dl < 0 || dl > span) return null;
  return { x: (dl / span) * world.w, z: ((g.latMax - lat) / (g.latMax - g.latMin)) * world.h };
}

// Approximate size of one tile in kilometres at a world position (east-west
// and north-south are equal at a regional map's middle latitude; on the whole
// Earth the east-west size shrinks toward the poles). Without a position, the
// north-south size, which is the same everywhere on the map.
export function geoKmPerTile(world, x = null, z = null) {
  const g = geoInfo(world);
  if (!g) return null;
  const ns = ((g.latMax - g.latMin) / world.h) * 111.2;
  if (x == null || z == null) return ns;
  const lat = g.latMax - (z / world.h) * (g.latMax - g.latMin);
  const ew = ((g.lonMax - g.lonMin) / world.w) * 111.32 * Math.cos((lat * Math.PI) / 180);
  return (ns + ew) / 2;
}

// ---- Round world (docs/ROUND-WORLD.md) ------------------------------------
// On the whole Earth the map's left and right edges meet in the mid-Atlantic
// (longitude -30). With the "Round world" setting on (World Law `worldWrap`,
// mirrored on the World instance as `world.wrapTravel` by the game), travel
// crosses that seam: tiles at x = 0 and x = w - 1 are neighbours and every
// distance compared across the map is measured the short way round. Regional
// maps and square presets never wrap, and with the setting off every helper
// below gives exactly the plain flat-map answer.

// True when travel crosses the whole Earth's left and right edges.
export function geoWrapOn(world) {
  if (!world || world.wrapTravel === false) return false;
  const m = world.meta;
  if (!m || m.preset !== 'earth') return false;
  return (m.geo || WORLD_GEO).wrap === true;
}

// Shortest east-west step from ax to bx (bx - ax, the short way round when
// the world wraps).
export function geoDx(world, ax, bx) {
  let dx = bx - ax;
  if (geoWrapOn(world)) {
    const W = world.w;
    if (dx > W / 2) dx -= W;
    else if (dx < -W / 2) dx += W;
  }
  return dx;
}

// Shortest step {dx, dz} from (ax, az) to (bx, bz).
export function geoDelta(world, ax, az, bx, bz) {
  return { dx: geoDx(world, ax, bx), dz: bz - az };
}

// Distance between two points (tiles), the short way round when the world
// wraps; Math.hypot of the plain difference otherwise.
export function geoDist(world, ax, az, bx, bz) {
  return Math.hypot(geoDx(world, ax, bx), bz - az);
}

// A world x brought back onto the map ([0, w)) when the world wraps; x
// unchanged otherwise.
export function geoWrapX(world, x) {
  if (!geoWrapOn(world)) return x;
  const W = world.w;
  return x >= 0 && x < W ? x : ((x % W) + W) % W;
}

// The tile one step (dx, dy) from tile (tx, ty), across the seam when the
// world wraps: its index, or -1 off the map.
export function geoNeighbor(world, tx, ty, dx, dy) {
  let x = tx + dx;
  const y = ty + dy;
  if (y < 0 || y >= world.h) return -1;
  if (x < 0 || x >= world.w) {
    if (!geoWrapOn(world)) return -1;
    x = ((x % world.w) + world.w) % world.w;
  }
  return y * world.w + x;
}
