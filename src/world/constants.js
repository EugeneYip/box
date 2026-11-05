// Shared world constants. This file is part of the cross-module contract.
// Modules may APPEND new entries (new ids at the end) but must never renumber
// or remove existing ones, because ids are stored in typed arrays.

export const SEA_LEVEL = 0; // world-space Y of the still water surface
export const MAX_HEIGHT = 22; // highest mountain peaks (world units)
export const MIN_HEIGHT = -9; // deepest ocean floor (world units)
export const SHALLOW_DEPTH = 1.6; // water shallower than this counts as "shallow"

// Surface material of a tile. Water is NOT a tile type: a tile is water when
// its height is below SEA_LEVEL. Underwater tiles keep a seabed material.
export const TILE = Object.freeze({
  SAND: 0,
  GRASS: 1,
  FOREST: 2, // lush, dark forest floor
  JUNGLE: 3,
  SAVANNA: 4,
  SWAMP: 5,
  TUNDRA: 6,
  SNOW: 7,
  ROCK: 8, // bare mountain stone
  LAVA: 9,
  ASH: 10, // scorched earth after fire / lava
  SOIL: 11, // bare dirt
  FARMLAND: 12, // tilled fields (civilization)
  ROAD: 13, // paths & roads (civilization)
  DESERT: 14, // inland dunes (warmer than beach sand)
  ICE: 15, // frozen water surface / glacier
});

export const TILE_INFO = [];
function defTile(id, name, color, opts = {}) {
  TILE_INFO[id] = {
    id,
    name,
    color, // base albedo used by minimap / fallback renderers (sRGB hex)
    walkable: opts.walkable ?? true,
    fertile: opts.fertile ?? 0, // 0..1, how well plants grow
    flammable: opts.flammable ?? 0, // 0..1, how readily fire spreads across it
    buildable: opts.buildable ?? true,
    temperature: opts.temperature ?? 0.5, // 0 cold .. 1 hot (visual / AI hints)
  };
}
defTile(TILE.SAND, 'Beach Sand', 0xe8d39a, { fertile: 0.1, temperature: 0.7 });
defTile(TILE.GRASS, 'Grassland', 0x6fb54a, { fertile: 1.0, flammable: 0.5 });
defTile(TILE.FOREST, 'Forest Floor', 0x3f8a3a, { fertile: 0.9, flammable: 0.8 });
defTile(TILE.JUNGLE, 'Jungle', 0x2f9a4a, { fertile: 1.0, flammable: 0.4, temperature: 0.85 });
defTile(TILE.SAVANNA, 'Savanna', 0xc2b25a, { fertile: 0.5, flammable: 0.9, temperature: 0.8 });
defTile(TILE.SWAMP, 'Swamp', 0x56704a, { fertile: 0.6, flammable: 0.1 });
defTile(TILE.TUNDRA, 'Tundra', 0x8ea58a, { fertile: 0.3, flammable: 0.3, temperature: 0.2 });
defTile(TILE.SNOW, 'Snow', 0xf2f6fa, { fertile: 0.05, temperature: 0.0 });
defTile(TILE.ROCK, 'Mountain Rock', 0x8a8580, { fertile: 0.0, buildable: false, temperature: 0.3 });
defTile(TILE.LAVA, 'Lava', 0xff5a10, { walkable: false, buildable: false, temperature: 1.0 });
defTile(TILE.ASH, 'Scorched Earth', 0x3d3733, { fertile: 0.2 });
defTile(TILE.SOIL, 'Bare Soil', 0x8a6a48, { fertile: 0.8 });
defTile(TILE.FARMLAND, 'Farmland', 0x7a5634, { fertile: 1.0, flammable: 0.6 });
defTile(TILE.ROAD, 'Road', 0xb59a74, { fertile: 0.0 });
defTile(TILE.DESERT, 'Desert', 0xe2b872, { fertile: 0.02, temperature: 0.95 });
defTile(TILE.ICE, 'Ice', 0xcfe6f2, { fertile: 0.0, buildable: false, temperature: 0.0 });

// Vegetation / props occupying a tile (at most one per tile).
export const FLORA = Object.freeze({
  NONE: 0,
  OAK: 1,
  PINE: 2,
  PALM: 3,
  JUNGLE_TREE: 4,
  BIRCH: 5,
  BUSH: 6,
  FLOWERS: 7,
  CACTUS: 8,
  DEAD_TREE: 9,
  SNOW_PINE: 10,
  SWAMP_TREE: 11,
  ROCK_SMALL: 12,
  BOULDER: 13,
  REEDS: 14,
  MUSHROOM: 15,
  WHEAT: 16, // crop planted by farmers
  STUMP: 17, // left behind when a tree is chopped
  BERRY_BUSH: 18,
  ACACIA: 19,
});

export const FLORA_INFO = [];
function defFlora(id, name, opts = {}) {
  FLORA_INFO[id] = {
    id,
    name,
    isTree: opts.isTree ?? false,
    wood: opts.wood ?? 0, // wood yielded when chopped
    food: opts.food ?? 0, // food yielded when harvested
    flammable: opts.flammable ?? 0,
    blocksBuilding: opts.blocksBuilding ?? true,
    blocksMovement: opts.blocksMovement ?? false,
  };
}
defFlora(FLORA.NONE, 'Nothing', { blocksBuilding: false });
defFlora(FLORA.OAK, 'Oak', { isTree: true, wood: 4, flammable: 0.8 });
defFlora(FLORA.PINE, 'Pine', { isTree: true, wood: 4, flammable: 0.9 });
defFlora(FLORA.PALM, 'Palm', { isTree: true, wood: 2, food: 1, flammable: 0.6 });
defFlora(FLORA.JUNGLE_TREE, 'Jungle Tree', { isTree: true, wood: 5, flammable: 0.5 });
defFlora(FLORA.BIRCH, 'Birch', { isTree: true, wood: 3, flammable: 0.8 });
defFlora(FLORA.BUSH, 'Bush', { flammable: 0.9, blocksBuilding: false });
defFlora(FLORA.FLOWERS, 'Wildflowers', { flammable: 0.6, blocksBuilding: false });
defFlora(FLORA.CACTUS, 'Cactus', { flammable: 0.2, food: 1 });
defFlora(FLORA.DEAD_TREE, 'Dead Tree', { isTree: true, wood: 1, flammable: 1.0 });
defFlora(FLORA.SNOW_PINE, 'Snowy Pine', { isTree: true, wood: 4, flammable: 0.5 });
defFlora(FLORA.SWAMP_TREE, 'Swamp Willow', { isTree: true, wood: 3, flammable: 0.3 });
defFlora(FLORA.ROCK_SMALL, 'Stones', { blocksBuilding: false });
defFlora(FLORA.BOULDER, 'Boulder', { blocksMovement: true });
defFlora(FLORA.REEDS, 'Reeds', { flammable: 0.5, blocksBuilding: false });
defFlora(FLORA.MUSHROOM, 'Mushrooms', { food: 1, blocksBuilding: false });
defFlora(FLORA.WHEAT, 'Wheat', { food: 3, flammable: 1.0, blocksBuilding: false });
defFlora(FLORA.STUMP, 'Stump', { blocksBuilding: false });
defFlora(FLORA.BERRY_BUSH, 'Berry Bush', { food: 2, flammable: 0.8, blocksBuilding: false });
defFlora(FLORA.ACACIA, 'Acacia', { isTree: true, wood: 3, flammable: 0.9 });

export const DIRS4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
export const DIRS8 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
