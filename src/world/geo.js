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
