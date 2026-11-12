import { TILE, FLORA, SEA_LEVEL, MAX_HEIGHT } from '../../world/constants.js';

// Shared ecology tables for the flora simulation, the nature powers and the
// vegetation renderer. Pure data + small pure helpers; no game state.
//
// suit[tile] = 0..1 how happy a species is on a surface material.
//   >= 0.5  thrives and may spread there
//   <  0.15 hostile: the plant dries out and dies
const T = TILE;
const habitat = (o) => {
  const a = new Float32Array(16);
  for (const k in o) a[T[k]] = o[k];
  return a;
};

// growTime: game seconds from seed to maturity on perfect soil.
// spread:   chance per sweep visit that a mature plant seeds a neighbour.
// life:     average game seconds a mature plant lives (0 = forever).
// cap:      max same-group plants allowed in the 5x5 around a new seed.
export const SPECIES = [];
function def(id, o) {
  SPECIES[id] = {
    id,
    tree: false,
    growTime: 60,
    spread: 0,
    spreadRadius: 2,
    life: 0,
    stressTime: 10,
    deadAs: FLORA.NONE,
    cap: 8,
    suit: habitat({}),
    ...o,
  };
}
def(FLORA.OAK, {
  tree: true, growTime: 110, spread: 0.027, life: 2400, deadAs: FLORA.DEAD_TREE, cap: 11,
  suit: habitat({ GRASS: 1, FOREST: 1, SOIL: 0.7, JUNGLE: 0.45, SAVANNA: 0.35, SWAMP: 0.3, TUNDRA: 0.2, FARMLAND: 0.3, SAND: 0.12, ASH: 0.3 }),
});
def(FLORA.BIRCH, {
  tree: true, growTime: 80, spread: 0.03, life: 1600, deadAs: FLORA.DEAD_TREE, cap: 11,
  suit: habitat({ GRASS: 0.9, FOREST: 1, TUNDRA: 0.6, SOIL: 0.7, SWAMP: 0.35, SAVANNA: 0.25, SNOW: 0.16, FARMLAND: 0.3, ASH: 0.3 }),
});
def(FLORA.PINE, {
  tree: true, growTime: 100, spread: 0.027, life: 2600, deadAs: FLORA.DEAD_TREE, cap: 12,
  suit: habitat({ FOREST: 1, TUNDRA: 1, GRASS: 0.7, SNOW: 0.55, ROCK: 0.3, SOIL: 0.6, SAVANNA: 0.2, SWAMP: 0.25, FARMLAND: 0.25, ASH: 0.3 }),
});
def(FLORA.SNOW_PINE, {
  tree: true, growTime: 120, spread: 0.016, life: 3000, deadAs: FLORA.DEAD_TREE, cap: 11,
  suit: habitat({ SNOW: 1, TUNDRA: 0.9, ROCK: 0.4, ICE: 0.16, FOREST: 0.3, GRASS: 0.2, ASH: 0.25 }),
});
def(FLORA.PALM, {
  tree: true, growTime: 85, spread: 0.016, spreadRadius: 3, life: 2000, deadAs: FLORA.DEAD_TREE, cap: 4,
  suit: habitat({ SAND: 1, JUNGLE: 0.8, SAVANNA: 0.55, DESERT: 0.4, GRASS: 0.3, SWAMP: 0.25, SOIL: 0.3, ASH: 0.25 }),
});
def(FLORA.JUNGLE_TREE, {
  tree: true, growTime: 120, spread: 0.032, life: 2600, deadAs: FLORA.DEAD_TREE, cap: 13,
  suit: habitat({ JUNGLE: 1, SWAMP: 0.5, FOREST: 0.45, GRASS: 0.3, SAVANNA: 0.2, SOIL: 0.35, ASH: 0.3 }),
});
def(FLORA.ACACIA, {
  tree: true, growTime: 95, spread: 0.014, spreadRadius: 3, life: 2400, deadAs: FLORA.DEAD_TREE, cap: 3,
  suit: habitat({ SAVANNA: 1, DESERT: 0.3, GRASS: 0.5, SAND: 0.25, SOIL: 0.4, ASH: 0.3 }),
});
def(FLORA.SWAMP_TREE, {
  tree: true, growTime: 100, spread: 0.027, life: 2600, deadAs: FLORA.DEAD_TREE, cap: 8,
  suit: habitat({ SWAMP: 1, FOREST: 0.4, JUNGLE: 0.4, GRASS: 0.3, SOIL: 0.3, ASH: 0.25 }),
});
def(FLORA.DEAD_TREE, {
  tree: true, growTime: 1, life: 160, deadAs: FLORA.STUMP,
  suit: habitat({ SAND: 1, GRASS: 1, FOREST: 1, JUNGLE: 1, SAVANNA: 1, SWAMP: 1, TUNDRA: 1, SNOW: 1, ROCK: 1, ASH: 1, SOIL: 1, FARMLAND: 1, DESERT: 1, ROAD: 1, ICE: 1 }),
});
def(FLORA.BUSH, {
  growTime: 40, spread: 0.018, spreadRadius: 2, life: 900, cap: 3,
  suit: habitat({ GRASS: 1, FOREST: 1, JUNGLE: 1, SAVANNA: 0.7, SWAMP: 0.6, TUNDRA: 0.5, SOIL: 0.55, SAND: 0.2, DESERT: 0.3, FARMLAND: 0.2, ASH: 0.3 }),
});
def(FLORA.BERRY_BUSH, {
  growTime: 55, spread: 0.012, life: 900, cap: 3,
  suit: habitat({ GRASS: 1, FOREST: 0.9, TUNDRA: 0.5, SAVANNA: 0.35, SOIL: 0.5, JUNGLE: 0.5, ASH: 0.3 }),
});
def(FLORA.FLOWERS, {
  growTime: 22, spread: 0.03, spreadRadius: 2, life: 260, cap: 4,
  suit: habitat({ GRASS: 1, FOREST: 0.55, SAVANNA: 0.5, TUNDRA: 0.45, JUNGLE: 0.5, SWAMP: 0.3, SOIL: 0.4, ASH: 0.3 }),
});
def(FLORA.CACTUS, {
  growTime: 120, spread: 0.012, spreadRadius: 3, life: 3000, deadAs: FLORA.NONE, cap: 2,
  suit: habitat({ DESERT: 1, SAND: 0.6, SAVANNA: 0.5, ROCK: 0.25, SOIL: 0.2 }),
});
def(FLORA.REEDS, {
  growTime: 30, spread: 0.04, spreadRadius: 2, life: 900, cap: 9,
  suit: habitat({ SWAMP: 1, SAND: 0.12, GRASS: 0.12, SOIL: 0.12, FOREST: 0.12, JUNGLE: 0.12, TUNDRA: 0.12, SAVANNA: 0.12 }),
});
def(FLORA.MUSHROOM, {
  growTime: 25, spread: 0.03, spreadRadius: 2, life: 220, cap: 4,
  suit: habitat({ FOREST: 1, SWAMP: 1, JUNGLE: 0.7, GRASS: 0.3, TUNDRA: 0.25, SOIL: 0.3 }),
});
def(FLORA.WHEAT, {
  growTime: 60, stressTime: 20,
  suit: habitat({ FARMLAND: 1, SOIL: 0.6, GRASS: 0.45, SAVANNA: 0.35 }),
});
def(FLORA.STUMP, {
  growTime: 1, life: 140,
  suit: habitat({ SAND: 1, GRASS: 1, FOREST: 1, JUNGLE: 1, SAVANNA: 1, SWAMP: 1, TUNDRA: 1, SNOW: 1, ROCK: 1, ASH: 1, SOIL: 1, FARMLAND: 1, DESERT: 1, ROAD: 1, ICE: 1 }),
});
// Minerals are eternal.
const MINERAL = habitat({ SAND: 1, GRASS: 1, FOREST: 1, JUNGLE: 1, SAVANNA: 1, SWAMP: 1, TUNDRA: 1, SNOW: 1, ROCK: 1, ASH: 1, SOIL: 1, FARMLAND: 1, DESERT: 1, ROAD: 1, ICE: 1, LAVA: 1 });
def(FLORA.ROCK_SMALL, { growTime: 1, suit: MINERAL });
def(FLORA.BOULDER, { growTime: 1, suit: MINERAL });

export const isTreeId = (f) => !!SPECIES[f]?.tree && f !== FLORA.DEAD_TREE;
export const isMineral = (f) => f === FLORA.ROCK_SMALL || f === FLORA.BOULDER;
export const isLiving = (f) => f !== FLORA.NONE && !isMineral(f) && f !== FLORA.STUMP && f !== FLORA.DEAD_TREE;

// Groups used for density caps when spreading.
export function densityGroup(f) {
  if (isTreeId(f)) return 1;
  if (f === FLORA.BUSH || f === FLORA.BERRY_BUSH) return 2;
  if (f === FLORA.FLOWERS) return 3;
  if (f === FLORA.MUSHROOM) return 4;
  if (f === FLORA.REEDS) return 5;
  if (f === FLORA.CACTUS) return 6;
  return 0;
}

// Max trees in a 5x5 neighbourhood by biome (keeps forests from taking over).
export const TREE_CAP = new Uint8Array(16);
TREE_CAP[T.FOREST] = 10;
TREE_CAP[T.JUNGLE] = 11;
TREE_CAP[T.SWAMP] = 6;
TREE_CAP[T.GRASS] = 2;
TREE_CAP[T.TUNDRA] = 3;
TREE_CAP[T.SNOW] = 3;
TREE_CAP[T.SAVANNA] = 1;
TREE_CAP[T.SAND] = 1;
TREE_CAP[T.DESERT] = 1;
TREE_CAP[T.SOIL] = 1;
TREE_CAP[T.ROCK] = 1;
TREE_CAP[T.ASH] = 1;

// Surfaces nothing new may sprout on.
export const BARREN = new Uint8Array(16);
for (const t of [T.LAVA, T.ROAD, T.ICE]) BARREN[t] = 1;

// Weighted species choice for a seed landing on a biome.
const MIX = [];
MIX[T.GRASS] = [[FLORA.OAK, 6], [FLORA.BIRCH, 3], [FLORA.PINE, 1]];
MIX[T.FOREST] = [[FLORA.OAK, 5], [FLORA.BIRCH, 3], [FLORA.PINE, 2]];
MIX[T.SOIL] = [[FLORA.OAK, 5], [FLORA.BIRCH, 3]];
MIX[T.ASH] = [[FLORA.BIRCH, 4], [FLORA.OAK, 3], [FLORA.PINE, 2]];
MIX[T.FARMLAND] = [[FLORA.OAK, 1]];
MIX[T.JUNGLE] = [[FLORA.JUNGLE_TREE, 8], [FLORA.PALM, 2]];
MIX[T.SAVANNA] = [[FLORA.ACACIA, 1]];
MIX[T.SWAMP] = [[FLORA.SWAMP_TREE, 1]];
MIX[T.TUNDRA] = [[FLORA.PINE, 6], [FLORA.SNOW_PINE, 2], [FLORA.BIRCH, 2]];
MIX[T.SNOW] = [[FLORA.SNOW_PINE, 1]];
MIX[T.ROCK] = [[FLORA.PINE, 2], [FLORA.SNOW_PINE, 1]];
MIX[T.SAND] = [[FLORA.PALM, 1]];
MIX[T.DESERT] = [[FLORA.CACTUS, 3], [FLORA.PALM, 1]];
MIX[T.ICE] = [[FLORA.SNOW_PINE, 1]];

function pickWeighted(list, r) {
  if (!list || !list.length) return FLORA.NONE;
  let sum = 0;
  for (const [, w] of list) sum += w;
  let x = r * sum;
  for (const [f, w] of list) {
    if ((x -= w) <= 0) return f;
  }
  return list[list.length - 1][0];
}

// A tree species that suits the tile (temperature nudges cold / warm picks).
export function pickTree(tileType, temperature = 0.5, r = Math.random()) {
  if (tileType === T.GRASS || tileType === T.FOREST || tileType === T.SOIL || tileType === T.ASH) {
    if (temperature < 0.3) return r < 0.7 ? FLORA.PINE : FLORA.BIRCH;
    if (temperature > 0.76 && r < 0.3) return FLORA.ACACIA;
  }
  let f = pickWeighted(MIX[tileType], r);
  if (f && climateFactor(f, temperature) < 0.5) {
    // fall back to whichever candidate of this biome suits the climate best
    let best = FLORA.NONE,
      bs = 0.5;
    for (const [g] of MIX[tileType] || []) {
      const c = climateFactor(g, temperature);
      if (c > bs) (best = g), (bs = c);
    }
    if (!best && (tileType === T.JUNGLE || tileType === T.SAVANNA))
      best = temperature < 0.4 ? FLORA.PINE : temperature < 0.74 ? FLORA.OAK : FLORA.NONE;
    f = best;
  }
  return f;
}

const UNDERGROWTH = [];
UNDERGROWTH[T.GRASS] = [[FLORA.FLOWERS, 5], [FLORA.BUSH, 3], [FLORA.BERRY_BUSH, 1.5]];
UNDERGROWTH[T.FOREST] = [[FLORA.BUSH, 4], [FLORA.MUSHROOM, 3], [FLORA.FLOWERS, 1.5], [FLORA.BERRY_BUSH, 1.5]];
UNDERGROWTH[T.JUNGLE] = [[FLORA.BUSH, 5], [FLORA.FLOWERS, 1], [FLORA.MUSHROOM, 1]];
UNDERGROWTH[T.SAVANNA] = [[FLORA.BUSH, 3], [FLORA.FLOWERS, 1]];
UNDERGROWTH[T.SWAMP] = [[FLORA.REEDS, 5], [FLORA.MUSHROOM, 2], [FLORA.BUSH, 1]];
UNDERGROWTH[T.TUNDRA] = [[FLORA.BUSH, 2], [FLORA.BERRY_BUSH, 1], [FLORA.FLOWERS, 1], [FLORA.ROCK_SMALL, 1]];
UNDERGROWTH[T.SOIL] = [[FLORA.BUSH, 2], [FLORA.FLOWERS, 1]];
UNDERGROWTH[T.ASH] = [[FLORA.BUSH, 2], [FLORA.FLOWERS, 2]];
UNDERGROWTH[T.DESERT] = [[FLORA.CACTUS, 1]];
UNDERGROWTH[T.SAND] = [[FLORA.REEDS, 1]];
export function pickUndergrowth(tileType, r = Math.random()) {
  return pickWeighted(UNDERGROWTH[tileType], r);
}

// Climate windows on world.temperature (0 cold .. 1 hot) with a soft margin:
// palms, jungle trees, acacias and cacti need warmth; snowy pines need cold.
const CLIMATE = [];
CLIMATE[FLORA.PALM] = [0.72, 2];
CLIMATE[FLORA.JUNGLE_TREE] = [0.62, 2];
CLIMATE[FLORA.ACACIA] = [0.5, 2];
CLIMATE[FLORA.CACTUS] = [0.5, 2];
CLIMATE[FLORA.SNOW_PINE] = [-1, 0.42];
CLIMATE[FLORA.PINE] = [-1, 0.6];
CLIMATE[FLORA.BIRCH] = [0.1, 0.66];
CLIMATE[FLORA.OAK] = [0.22, 0.86];
CLIMATE[FLORA.SWAMP_TREE] = [0.28, 0.9];
CLIMATE[FLORA.BERRY_BUSH] = [0.12, 0.82];
export function climateFactor(f, temp) {
  const c = CLIMATE[f];
  if (!c) return 1;
  const m = 0.07;
  if (temp < c[0]) return Math.max(0, 1 - (c[0] - temp) / m);
  if (temp > c[1]) return Math.max(0, 1 - (temp - c[1]) / m);
  return 1;
}

// Low-frequency "drift" field: wildflowers gather in natural drifts rather
// than an even sprinkle. Returns 0..1.
export function flowerDrift(x, y) {
  const a = Math.sin(x * 0.083 + Math.sin(y * 0.061) * 1.9) * Math.cos(y * 0.071 - Math.sin(x * 0.047) * 2.3);
  const b = Math.sin((x + y) * 0.137 + 1.7) * 0.35;
  return Math.min(1, Math.max(0, 0.5 + 0.55 * a + b * 0.5));
}

// Small plants do not cling to cliffs.
const SMALL = new Uint8Array(32);
for (const f of [FLORA.FLOWERS, FLORA.BUSH, FLORA.BERRY_BUSH, FLORA.MUSHROOM, FLORA.REEDS, FLORA.WHEAT]) SMALL[f] = 1;
export const isSmallPlant = (f) => !!SMALL[f];

export function suitability(f, tileType) {
  const s = SPECIES[f];
  if (!s) return 1;
  return s.suit[tileType] ?? 0;
}

// Reeds want water nearby; everything else uses the habitat table.
// Palms never share a grove with temperate trees, even on a warm river bank.
export function palmNeighbourhoodOK(world, tx, ty) {
  let oaks = 0;
  for (let dy = -6; dy <= 6; dy++)
    for (let dx = -6; dx <= 6; dx++) {
      const x = tx + dx,
        y = ty + dy;
      if (x < 0 || y < 0 || x >= world.w || y >= world.h) continue;
      const g = world.flora[y * world.w + x];
      if (g === FLORA.PINE || g === FLORA.BIRCH || g === FLORA.SNOW_PINE) return false;
      if (g === FLORA.OAK && Math.abs(dx) <= 5 && Math.abs(dy) <= 5 && ++oaks >= 4) return false;
    }
  return true;
}

// Cacti and succulents belong to dry, open country only: never on meadow,
// woodland or village gardens, nor in moist land.
const ARID = new Uint8Array(32);
for (const t of [T.DESERT, T.SAND, T.SAVANNA, T.ROCK, T.ASH]) ARID[t] = 1;
export function cactusOK(world, i) {
  return !!ARID[world.type[i]] && world.moisture[i] <= 0.42;
}
// Snow-laden spruce keep to snow country (snow fields, ice, or truly cold land).
export function snowPineOK(world, i, tOff = 0) {
  const t = world.type[i];
  return t === T.SNOW || t === T.ICE || world.temperature[i] + tOff < 0.3;
}
// A plant that does not belong where it stands becomes its local counterpart
// (cactus -> shrub, snowy spruce -> pine), or 0 when it belongs.
export function misfitAs(world, f, i, tOff = 0) {
  if (f === FLORA.CACTUS && !cactusOK(world, i)) return FLORA.BUSH;
  if (f === FLORA.SNOW_PINE && !snowPineOK(world, i, tOff)) return FLORA.PINE;
  return 0;
}

// tOff: climate offset of the current World Age (-0.5 cold .. +0.5 hot).
export function suitAt(world, f, tx, ty, i, tOff = 0) {
  const t = world.type[i];
  let s = suitability(f, t) * climateFactor(f, world.temperature[i] + tOff);
  if (f === FLORA.PALM && s > 0 && !palmNeighbourhoodOK(world, tx, ty)) return 0;
  // cacti and succulents belong to dry land only (never beside jungle)
  if (f === FLORA.CACTUS && !cactusOK(world, i)) return 0;
  if (f === FLORA.SNOW_PINE && !snowPineOK(world, i, tOff)) return 0;
  if (SMALL[f] && f !== FLORA.REEDS && world.slopeAt(tx, ty) > 1.15) s = 0;
  if (f === FLORA.REEDS) {
    if (world.height[i] < SEA_LEVEL) return world.height[i] > SEA_LEVEL - 0.7 ? 1 : 0;
    if (t !== T.SWAMP && world.isCoastal(tx, ty)) s = Math.max(s, t === T.ROCK || t === T.SNOW || t === T.LAVA ? 0 : 0.9);
  }
  return s;
}

// What a tile would naturally be, from its climate (mirrors worldgen so that
// burnt land heals back into the right biome).
export function naturalBiome(world, i, tOff = 0) {
  const hgt = world.height[i];
  const temp = world.temperature[i] + tOff;
  const moist = world.moisture[i];
  if (hgt < SEA_LEVEL) return T.SAND;
  if (hgt < SEA_LEVEL + 0.7 && temp > 0.25) return T.SAND;
  if (hgt > MAX_HEIGHT * 0.72 || (temp < 0.12 && hgt > MAX_HEIGHT * 0.35)) return T.SNOW;
  if (hgt > MAX_HEIGHT * 0.5) return T.ROCK;
  if (temp < 0.18) return T.SNOW;
  if (temp < 0.32) return T.TUNDRA;
  if (temp > 0.78) {
    if (moist < 0.35) return T.DESERT;
    if (moist < 0.55) return T.SAVANNA;
    return T.JUNGLE;
  }
  if (moist > 0.82 && hgt < SEA_LEVEL + 2.5) return T.SWAMP;
  if (moist > 0.58) return T.FOREST;
  if (moist < 0.22) return T.SAVANNA;
  return T.GRASS;
}

// Growth stage label used by the inspector.
export function stageName(f, g) {
  if (f === FLORA.WHEAT) return g < 0.25 ? 'Sprouting' : g < 0.6 ? 'Growing' : g < 0.95 ? 'Ripening' : 'Ripe';
  if (f === FLORA.FLOWERS) return g < 0.35 ? 'Budding' : g < 0.9 ? 'Opening' : 'In bloom';
  if (isMineral(f) || f === FLORA.STUMP || f === FLORA.DEAD_TREE) return null;
  if (isTreeId(f)) return g < 0.3 ? 'Sapling' : g < 0.7 ? 'Young' : g < 0.97 ? 'Growing' : 'Mature';
  return g < 0.4 ? 'Seedling' : g < 0.97 ? 'Growing' : 'Mature';
}
