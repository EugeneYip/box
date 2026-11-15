// URL parameters (used heavily by the screenshot tooling).
//   ?seed=42            world seed
//   ?size=256           world size in tiles (square); for the World Map, the width
//                       of a 2:1 map (size=768 is 768 x 384)
//   ?preset=continent   continent | pangaea | archipelago | islands | earth (World Map)
//   ?region=japan       World Map only: a regional map (great-east-asia | asia-mainland |
//                       japan | taiwan | europe | north-america); size is then implied
//   ?cam=x,z,dist,yaw,pitch   initial camera (yaw/pitch in degrees; pitch optional)
//   ?hour=13.5          time of day (0-24)
//   ?ff=120             fast-forward N game seconds of simulation after load
//   ?speed=1            initial game speed (0 = paused)
//   ?weather=rain       clear | rain | storm | snow | fog
//   ?ui=0               hide the HTML UI (clean screenshots)
//   ?title=0            skip the title / intro screen
//   ?quality=high       low | medium | high | ultra
//   ?audio=0            disable audio
//   ?civs=3             number of starting villages to seed (0 for none)
//   ?power=1            power saver (30 fps cap, lighter rendering); default on for touch devices

import { EARTH_REGIONS, earthRegion } from '../world/data/regions.js';

// World size presets (square, in tiles). Sizes are multiples of 32 so the
// terrain / vegetation chunk grids divide evenly.
export const WORLD_SIZES = [
  { id: 'tiny', name: 'Tiny', size: 128 },
  { id: 'small', name: 'Small', size: 192 },
  { id: 'medium', name: 'Medium', size: 256 },
  { id: 'large', name: 'Large', size: 384 },
  { id: 'huge', name: 'Huge', size: 512 },
];
export const MIN_WORLD_SIZE = 96;
export const MAX_WORLD_SIZE = 512;

export const IS_TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

// World Map (preset 'earth'), docs/REGIONS.md section 1: the real Earth on a
// 2:1 rectangle centred on the Pacific (`size` is the map width; the height is
// half of it), or one of six regional maps. Vast (1024 x 512) is the default
// on desktops; it and the regional maps (each about Vast's tile count, with
// the region's name shown as its size) are offered on desktops only, so
// touch devices keep Large by default. A regional map is chosen with
// ?region=<id>; its size is then 1024 (Vast-class) and its dimensions are the
// region's own (Taiwan is portrait).
export const EARTH_SIZES = [
  { id: 'large', name: 'Large', size: 512, w: 512, h: 256 },
  { id: 'huge', name: 'Huge', size: 768, w: 768, h: 384 },
  { id: 'vast', name: 'Vast', size: 1024, w: 1024, h: 512, desktopOnly: true, note: 'Desktop only: about twice the work of Huge' },
  ...EARTH_REGIONS.map((r) => ({ id: r.id, name: r.name, size: 1024, w: r.w, h: r.h, region: r.id, desktopOnly: true })),
];
export const EARTH_DEFAULT_SIZE = IS_TOUCH ? 512 : 1024;

// The World Map choices this device offers (Vast and the regions are desktop only).
export function earthChoices() {
  return EARTH_SIZES.filter((z) => !(IS_TOUCH && z.desktopOnly));
}
// The World Map choice for a size and region ('vast', 'japan', ...).
export function earthChoice(size, region = null) {
  if (region) return EARTH_SIZES.find((z) => z.region === region) || null;
  return EARTH_SIZES.find((z) => !z.region && z.size === size) || null;
}
// A valid regional map id for this device, or null.
export function validRegion(id) {
  return id && !IS_TOUCH && earthRegion(id) ? id : null;
}
// Loading label for a World Map choice: "Shaping the World Map · Vast",
// "Shaping Japan".
export function earthLabel(size, region = null) {
  const z = earthChoice(size, region);
  if (z?.region) return `Shaping ${z.name}`;
  return `Shaping the World Map${z ? ` · ${z.name}` : ''}`;
}
const EARTH_MIN = 256,
  EARTH_MAX = 1024;

// True for presets generated on a 2:1 rectangle instead of a square.
export function isWidePreset(preset) {
  return preset === 'earth';
}

// Clamp a requested size for a preset (multiples of 32 for squares, of 64
// for the 2:1 World Map so both sides divide the chunk grids evenly).
export function clampSize(n, preset = null) {
  if (isWidePreset(preset)) {
    if (!isFinite(n)) return EARTH_DEFAULT_SIZE;
    const s = Math.round(n / 64) * 64;
    return Math.max(EARTH_MIN, Math.min(IS_TOUCH ? 768 : EARTH_MAX, s));
  }
  if (!isFinite(n)) return 256;
  const s = Math.round(n / 32) * 32;
  return Math.max(MIN_WORLD_SIZE, Math.min(MAX_WORLD_SIZE, s));
}

// Tile dimensions of a world of `size` for a preset (and World Map region).
export function worldDims(size, preset = null, region = null) {
  const r = isWidePreset(preset) && validRegion(region) ? earthRegion(region) : null;
  if (r) return { size: 1024, w: r.w, h: r.h, region: r.id };
  const s = clampSize(size, preset);
  return isWidePreset(preset) ? { size: s, w: s, h: s / 2 } : { size: s, w: s, h: s };
}

// The size to use when switching presets: the same size within a family.
// Into the World Map: a Large square becomes a Large map, anything else the
// default (Vast on desktops). Out of it: Huge, Vast and the regional maps
// (size 1024) become a Huge square, Large a Large one.
export function sizeForPreset(size, fromPreset, toPreset) {
  const a = isWidePreset(fromPreset),
    b = isWidePreset(toPreset);
  if (a === b) return clampSize(size, toPreset);
  if (b) return size === 384 ? 512 : EARTH_DEFAULT_SIZE;
  return size >= 768 ? 512 : size >= 512 ? 384 : 256;
}

export function readParams() {
  const q = new URLSearchParams(location.search);
  const num = (k, d) => (q.has(k) && q.get(k) !== '' && !isNaN(+q.get(k)) ? +q.get(k) : d);
  const cam = q.has('cam') ? q.get('cam').split(',').map(Number) : null;
  const preset = q.get('preset') || 'continent';
  const region = isWidePreset(preset) ? validRegion(q.get('region')) : null;
  const size = region ? 1024 : isWidePreset(preset) ? clampSize(num('size', EARTH_DEFAULT_SIZE), preset) : clampSize(num('size', IS_TOUCH ? 192 : 256));
  return {
    seed: num('seed', Math.floor(Math.random() * 1e9)),
    seedGiven: q.has('seed'),
    size,
    preset,
    region,
    cam,
    hour: q.has('hour') ? num('hour', 10) : null,
    ff: num('ff', 0),
    speed: num('speed', 1),
    weather: q.get('weather') || null,
    ui: q.get('ui') !== '0',
    title: q.get('title') !== '0',
    quality: q.get('quality') || null,
    audio: q.get('audio') !== '0',
    civs: num('civs', 3),
    power: q.has('power') ? q.get('power') !== '0' : null,
    debug: q.has('debug'),
    raw: q,
  };
}
