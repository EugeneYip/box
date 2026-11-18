// Regional maps of the World Map preset (contract: docs/REGIONS.md, section 1).
//
// Each region is a plain longitude/latitude window rasterised onto a
// Vast-class tile grid (about 1024 x 512 = 524k tiles). Width and height are
// multiples of 64 (the terrain chunk grid) and the window is sized so that at
// its middle latitude one tile spans the same distance east-west as
// north-south: (lonMax - lonMin) / w * cos(midLat) = (latMax - latMin) / h.
// Taiwan (with Kinmen and Matsu) is taller than wide, so its map is
// portrait. Asia Mainland is the East Asian mainland (China, Mongolia and
// Korea).
//
// Shared by the game (src/core/params.js, src/world/earth.js) and the mask
// build tool (tools/region-masks.mjs). km is the approximate tile size.
//
// `lands` limits a map to its own land (docs/REGIONS.md section 4): a list of
// Natural Earth admin-0 codes (ADM0_A3) whose polygons are kept, or
// 'mainland' for the continental mainland only (every island removed).
// Other land in the window becomes open sea.
export const EARTH_REGIONS = [
  { id: 'great-east-asia', name: 'Great East Asia', w: 768, h: 704, lonMin: 73, lonMax: 150, latMin: -11.34, latMax: 54.34, km: 10.4 },
  { id: 'asia-mainland', name: 'Asia Mainland', w: 896, h: 640, lonMin: 72.52, lonMax: 135.48, latMin: 17.5, latMax: 54, km: 6.34, lands: 'mainland' },
  { id: 'japan', name: 'Japan', w: 704, h: 768, lonMin: 128, lonMax: 146.5, latMin: 29.94, latMax: 45.86, km: 2.31, lands: ['JPN'] },
  { id: 'taiwan', name: 'Taiwan', w: 640, h: 832, lonMin: 118.03, lonMax: 122.16, latMin: 21.62, latMax: 26.52, km: 0.65, lands: ['TWN'] },
  { id: 'europe', name: 'Europe', w: 832, h: 640, lonMin: -26.5, lonMax: 63.5, latMin: 32.17, latMax: 73.83, km: 7.25 },
  { id: 'north-america', name: 'North America', w: 832, h: 640, lonMin: -170, lonMax: -50, latMin: 6.17, latMax: 75.83, km: 12.1 },
];

export function earthRegion(id) {
  return EARTH_REGIONS.find((r) => r.id === id) || null;
}
