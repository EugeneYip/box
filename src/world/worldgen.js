import { createNoise2D } from 'simplex-noise';
import { mulberry32, hash2 } from '../core/Random.js';
import { TILE, FLORA, SEA_LEVEL, MAX_HEIGHT, MIN_HEIGHT } from './constants.js';

// Procedural world generation. Fills height / type / temperature / moisture /
// flora of a World. Deterministic for a given seed.
//
// options.preset: 'continent' | 'archipelago' | 'pangaea' | 'islands'
export function generateWorld(world, seed = 1, options = {}) {
  const preset = options.preset || 'continent';
  world.seed = seed;
  const rand = mulberry32(seed);
  const nElev = createNoise2D(mulberry32(seed * 7 + 1));
  const nWarpX = createNoise2D(mulberry32(seed * 7 + 2));
  const nWarpY = createNoise2D(mulberry32(seed * 7 + 3));
  const nRidge = createNoise2D(mulberry32(seed * 7 + 4));
  const nMoist = createNoise2D(mulberry32(seed * 7 + 5));
  const nTemp = createNoise2D(mulberry32(seed * 7 + 6));
  const nDetail = createNoise2D(mulberry32(seed * 7 + 7));

  const W = world.w;
  const H = world.h;
  const S = Math.max(W, H);

  const fbm = (noise, x, y, oct, lac = 2, gain = 0.5) => {
    let a = 1,
      f = 1,
      s = 0,
      n = 0;
    for (let o = 0; o < oct; o++) {
      s += a * noise(x * f, y * f);
      n += a;
      a *= gain;
      f *= lac;
    }
    return s / n;
  };
  const ridged = (x, y, oct) => {
    let a = 0.5,
      f = 1,
      s = 0,
      prev = 1;
    for (let o = 0; o < oct; o++) {
      let r = 1 - Math.abs(nRidge(x * f, y * f));
      r *= r;
      s += r * a * prev;
      prev = r;
      a *= 0.5;
      f *= 2.1;
    }
    return s;
  };

  // Preset parameters
  const P = {
    continent: { scale: 2.2, falloff: 1.0, bias: 0.06, blobs: 1 },
    pangaea: { scale: 1.6, falloff: 1.25, bias: 0.16, blobs: 1 },
    archipelago: { scale: 4.2, falloff: 0.7, bias: -0.06, blobs: 0 },
    islands: { scale: 3.2, falloff: 0.85, bias: -0.02, blobs: 0 },
  }[preset] || { scale: 2.2, falloff: 1.0, bias: 0.06, blobs: 1 };

  const ox = rand() * 1000;
  const oy = rand() * 1000;

  const elev = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / S;
      const v = y / S;
      // domain warp
      const wx = fbm(nWarpX, u * 2 + ox, v * 2 + oy, 3) * 0.35;
      const wy = fbm(nWarpY, u * 2 + ox, v * 2 + oy, 3) * 0.35;
      let e = fbm(nElev, (u + wx) * P.scale + ox, (v + wy) * P.scale + oy, 6);
      // radial falloff so the map is surrounded by ocean
      const dx = (x / W) * 2 - 1;
      const dy = (y / H) * 2 - 1;
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy) / 1.05);
      const edge = Math.pow(d, 2.6) * P.falloff;
      e = e + P.bias - edge * 0.9;
      // mountains along ridges, only on land-ish areas
      const land = Math.max(0, e);
      const r = ridged((u + wx) * 3.1 + ox, (v + wy) * 3.1 + oy, 5);
      e += r * r * Math.min(1, land * 4.0) * 0.75;
      // fine detail
      e += nDetail(u * 40, v * 40) * 0.012;
      elev[y * W + x] = e;
    }
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const e = elev[i];
      let hgt;
      if (e >= 0) {
        // land: gentle lowlands, dramatic peaks
        const t = Math.min(1, e / 0.75);
        hgt = SEA_LEVEL + 0.25 + Math.pow(t, 1.9) * (MAX_HEIGHT - 0.25);
      } else {
        const t = Math.min(1, -e / 0.35);
        hgt = SEA_LEVEL - 0.15 - Math.pow(t, 0.8) * (SEA_LEVEL - MIN_HEIGHT);
      }
      world.height[i] = hgt;

      const u = x / S;
      const v = y / S;
      // latitude-ish temperature with noise; colder at altitude
      const lat = Math.abs(y / H - 0.5) * 2; // 0 equator (middle) .. 1 poles
      let temp = 1 - lat * 0.85 + fbm(nTemp, u * 3 + ox, v * 3 + oy, 3) * 0.35;
      temp -= Math.max(0, hgt) / MAX_HEIGHT * 0.9;
      temp = Math.max(0, Math.min(1, temp));
      let moist = 0.5 + fbm(nMoist, u * 3.5 + oy, v * 3.5 + ox, 4) * 0.75;
      moist = Math.max(0, Math.min(1, moist));
      world.temperature[i] = temp;
      world.moisture[i] = moist;
    }
  }

  // Boost moisture near water (simple distance falloff via blur of water mask)
  // and assign biomes.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const hgt = world.height[i];
      const temp = world.temperature[i];
      const moist = world.moisture[i];
      let t;
      if (hgt < SEA_LEVEL) {
        t = hgt < SEA_LEVEL - 4 ? TILE.ROCK : TILE.SAND;
      } else if (hgt < SEA_LEVEL + 0.7 && temp > 0.25) {
        t = TILE.SAND;
      } else if (hgt > MAX_HEIGHT * 0.72 || (temp < 0.12 && hgt > MAX_HEIGHT * 0.35)) {
        t = TILE.SNOW;
      } else if (hgt > MAX_HEIGHT * 0.5) {
        t = TILE.ROCK;
      } else if (temp < 0.18) {
        t = TILE.SNOW;
      } else if (temp < 0.32) {
        t = TILE.TUNDRA;
      } else if (temp > 0.78) {
        if (moist < 0.35) t = TILE.DESERT;
        else if (moist < 0.55) t = TILE.SAVANNA;
        else t = TILE.JUNGLE;
      } else {
        if (moist > 0.82 && hgt < SEA_LEVEL + 2.5) t = TILE.SWAMP;
        else if (moist > 0.58) t = TILE.FOREST;
        else if (moist < 0.22) t = TILE.SAVANNA;
        else t = TILE.GRASS;
      }
      world.type[i] = t;
    }
  }

  // Flora
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      world.flora[i] = FLORA.NONE;
      world.floraGrowth[i] = 0;
      if (world.height[i] < SEA_LEVEL) continue;
      const r = hash2(x, y, seed);
      const r2 = hash2(y, x, seed + 17);
      const cluster = 0.5 + 0.5 * nDetail(x / 9, y / 9);
      let f = FLORA.NONE;
      switch (world.type[i]) {
        case TILE.FOREST:
          if (r < 0.42 * cluster + 0.12) f = r2 < 0.65 ? FLORA.OAK : r2 < 0.85 ? FLORA.BIRCH : FLORA.PINE;
          else if (r < 0.6) f = r2 < 0.5 ? FLORA.BUSH : FLORA.MUSHROOM;
          break;
        case TILE.GRASS:
          if (r < 0.1 * cluster) f = r2 < 0.7 ? FLORA.OAK : FLORA.BIRCH;
          else if (r < 0.16) f = FLORA.FLOWERS;
          else if (r < 0.19) f = r2 < 0.5 ? FLORA.BUSH : FLORA.BERRY_BUSH;
          else if (r < 0.2) f = FLORA.ROCK_SMALL;
          break;
        case TILE.JUNGLE:
          if (r < 0.5 * cluster + 0.15) f = r2 < 0.8 ? FLORA.JUNGLE_TREE : FLORA.PALM;
          else if (r < 0.7) f = FLORA.BUSH;
          break;
        case TILE.SAVANNA:
          if (r < 0.05) f = FLORA.ACACIA;
          else if (r < 0.09) f = FLORA.BUSH;
          break;
        case TILE.SWAMP:
          if (r < 0.2) f = FLORA.SWAMP_TREE;
          else if (r < 0.4) f = FLORA.REEDS;
          else if (r < 0.45) f = FLORA.MUSHROOM;
          break;
        case TILE.TUNDRA:
          if (r < 0.14 * cluster) f = FLORA.PINE;
          else if (r < 0.18) f = FLORA.ROCK_SMALL;
          break;
        case TILE.SNOW:
          if (world.height[i] < MAX_HEIGHT * 0.55 && r < 0.12 * cluster) f = FLORA.SNOW_PINE;
          break;
        case TILE.ROCK:
          if (r < 0.06) f = FLORA.BOULDER;
          else if (r < 0.14) f = FLORA.ROCK_SMALL;
          break;
        case TILE.DESERT:
          if (r < 0.015) f = FLORA.CACTUS;
          else if (r < 0.025) f = FLORA.ROCK_SMALL;
          break;
        case TILE.SAND:
          if (r < 0.03 && world.temperature[i] > 0.6) f = FLORA.PALM;
          break;
      }
      if (f !== FLORA.NONE) {
        world.flora[i] = f;
        world.floraGrowth[i] = 0.6 + 0.4 * r2;
      }
    }
  }

  world.owner.fill(-1);
  world.building.fill(-1);
  world.fire.fill(0);
  world.wetness.fill(0);
  world.markAllDirty();
}

// Find a random land tile that satisfies a predicate (returns [tx,ty] or null).
export function findLandTile(world, rng, predicate = () => true, tries = 4000) {
  for (let k = 0; k < tries; k++) {
    const tx = Math.floor(rng.next() * world.w);
    const ty = Math.floor(rng.next() * world.h);
    if (world.isWalkable(tx, ty) && predicate(tx, ty)) return [tx, ty];
  }
  return null;
}
