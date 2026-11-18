import { VEHICLE } from '../../core/scale.js';

// Vessel and vehicle kinds of the Fleets module. Speeds in tiles per game
// second, lengths in tiles. `tech` gates who may build it; `sail` ships ride
// the wind, `oars` are rowed. `size` is the hit radius for the inspector and
// combat; `dps` the damage a crew deals in a fight.
// `scale` shrinks the model to the world (ships read beside houses, not over
// them); length, beam and size below are the scaled measures at design size
// (round 13); the loop after the table brings them to today's world scale.
// `draft` is how deep the keel sits (water must be at least this deep where
// the ship moors), `clear` the open water (tiles to the nearest land) it
// needs along its route: big ships keep to the sea, wide lakes and estuaries.
export const KINDS = {
  // ---------------------------------------------------------------- water
  fishing: { cls: 'sea', name: 'Fishing boat', tech: 'fishing', speed: 1.35, turn: 2.4, hp: 30, crew: 2, capacity: 12, scale: 0.85, length: 0.85, beam: 0.31, draft: 0.12, clear: 0, size: 0.5, dps: 0, sail: true, oars: true, small: true },
  cog: { cls: 'sea', name: 'Trading cog', tech: 'sailing', speed: 1.75, turn: 1.1, hp: 110, crew: 6, capacity: 60, scale: 0.75, length: 1.65, beam: 0.58, draft: 0.4, clear: 1.6, size: 0.85, dps: 1.5, sail: true },
  transport: { cls: 'sea', name: 'Transport', tech: 'sailing', speed: 1.6, turn: 1.0, hp: 120, crew: 6, capacity: 10, scale: 0.75, length: 1.8, beam: 0.68, draft: 0.4, clear: 1.6, size: 0.9, dps: 1, sail: true },
  galley: { cls: 'sea', name: 'War galley', tech: 'shipbuilding', speed: 2.25, turn: 1.5, hp: 170, crew: 24, capacity: 0, scale: 0.75, length: 2.4, beam: 0.47, draft: 0.3, clear: 2, size: 1.05, dps: 14, sail: true, oars: true, war: true },
  explorer: { cls: 'sea', name: 'Exploration ship', tech: 'astronomy', speed: 2.35, turn: 1.4, hp: 100, crew: 10, capacity: 6, scale: 0.75, length: 1.9, beam: 0.51, draft: 0.4, clear: 2, size: 0.9, dps: 2, sail: true, big: true },
  carrack: { cls: 'sea', name: 'Carrack', tech: 'navigation', speed: 2.1, turn: 0.9, hp: 260, crew: 18, capacity: 160, scale: 0.75, length: 2.6, beam: 0.81, draft: 0.65, clear: 3, size: 1.2, dps: 5, sail: true, big: true },
  // ---------------------------------------------------------------- land
  oxcart: { cls: 'land', name: 'Ox cart', tech: 'wheel', speed: 1.0, turn: 3, hp: 40, crew: 1, capacity: 24, scale: 1, length: 1.5, size: 0.7, dps: 0 },
  caravan: { cls: 'land', name: 'Trade caravan', tech: 'banking', speed: 1.1, turn: 3, hp: 50, crew: 2, capacity: 30, scale: 1.3, length: 1.0, size: 0.8, dps: 0 },
  ram: { cls: 'land', name: 'Battering ram', tech: 'siegecraft', speed: 1.05, turn: 2, hp: 140, crew: 4, capacity: 0, scale: 1.3, length: 1.8, size: 1.0, dps: 0, siege: true },
  catapult: { cls: 'land', name: 'Catapult', tech: 'siegecraft', speed: 1.0, turn: 2, hp: 100, crew: 3, capacity: 0, scale: 1.5, length: 1.95, size: 1.1, dps: 0, siege: true },
};

// Design sizes to the world's (VEHICLE in src/core/scale.js): the model scale,
// length, beam and hit size shrink together; speeds stay (tiles per second).
for (const d of Object.values(KINDS)) {
  const k = VEHICLE.of(d.cls);
  d.scale *= k;
  d.length *= k;
  if (d.beam) d.beam *= k;
  d.size *= k;
}

export const SEA_KINDS = ['fishing', 'cog', 'transport', 'galley', 'explorer', 'carrack'];
export const LAND_KINDS = ['oxcart', 'caravan', 'ram', 'catapult'];
export const ALL_KINDS = [...SEA_KINDS, ...LAND_KINDS];

// ---------------------------------------------------------------- modern and future (docs/MODERN-ERAS.md)
// STUBS until the Fleets module gives each its own model and behaviour. A
// stub with a `base` runs as that existing kind: it is spawned as the base
// kind (so every routine and the renderer's batches handle it), with its own
// name, speed, strength and capacity, and `vehicle.model` naming what it
// really is (the renderer and the inspector can key on it). Air and space
// stubs (`cls` 'air' / 'space') have no base: they fly as plain records in
// fleet.air (straight routes at an altitude) and fleet.orbit (satellites,
// stations), which the air layer will draw. To make a stub real: add the kind
// to KINDS and to SEA_KINDS / LAND_KINDS with its model, and delete it here.
export const STUB_KINDS = {
  // sea: cogs give way to steamers, freighters and container ships
  steamer: { base: 'cog', name: 'Steamship', tech: 'steampower', speed: 2.3, capacity: 90, hp: 170, smoke: true, sail: false },
  freighter: { base: 'cog', name: 'Motor freighter', tech: 'combustion', speed: 2.6, capacity: 140, hp: 210, smoke: true, sail: false },
  container: { base: 'carrack', name: 'Container ship', tech: 'containers', speed: 2.8, capacity: 300, hp: 340, sail: false },
  ironclad: { base: 'galley', name: 'Ironclad', tech: 'ironclads', speed: 2.35, hp: 320, dps: 22, smoke: true, sail: false, oars: false },
  battleship: { base: 'galley', name: 'Battleship', tech: 'battleships', speed: 2.55, hp: 520, dps: 34, sail: false, oars: false },
  carrier: { base: 'galley', name: 'Aircraft carrier', tech: 'carriers', speed: 2.45, hp: 620, dps: 30, sail: false, oars: false },
  // land: carts give way to trains and trucks; siege engines to guns and armour
  train: { base: 'oxcart', name: 'Steam train', tech: 'railways', speed: 3.4, capacity: 80, hp: 120, rail: true },
  maglev: { base: 'oxcart', name: 'Maglev train', tech: 'maglev', speed: 6.5, capacity: 120, hp: 160, rail: true },
  truck: { base: 'oxcart', name: 'Truck', tech: 'combustion', speed: 2.4, capacity: 48, hp: 70 },
  car: { base: 'oxcart', name: 'Car', tech: 'combustion', speed: 2.6, capacity: 4, hp: 40 },
  cannon: { base: 'catapult', name: 'Cannon', tech: 'gunpowder', speed: 1.1, hp: 140 },
  tank: { base: 'ram', name: 'Tank', tech: 'battleships', speed: 1.7, hp: 420 },
  artillery: { base: 'catapult', name: 'Artillery', tech: 'battleships', speed: 1.35, hp: 190 },
  // air (no terrain pathing: straight or gently curved routes at altitude)
  plane: { cls: 'air', name: 'Transport plane', tech: 'flight', speed: 6, alt: 6, capacity: 20, hp: 60 },
  biplane: { cls: 'air', name: 'Biplane', tech: 'flight', speed: 7, alt: 5, hp: 50, war: true },
  airliner: { cls: 'air', name: 'Jet airliner', tech: 'jets', speed: 14, alt: 11, capacity: 60, hp: 120 },
  jet: { cls: 'air', name: 'Jet fighter', tech: 'jets', speed: 18, alt: 9, hp: 90, war: true },
  drone: { cls: 'air', name: 'Delivery drone', tech: 'robotics', speed: 3.5, alt: 2.2, capacity: 2, hp: 10 },
  skytaxi: { cls: 'air', name: 'Sky taxi', tech: 'vtol', speed: 8, alt: 4.5, capacity: 4, hp: 60 },
  // space
  rocket: { cls: 'space', name: 'Rocket', tech: 'rocketry', speed: 4, hp: 80 },
  satellite: { cls: 'space', name: 'Satellite', tech: 'rocketry', hp: 20 },
  station: { cls: 'space', name: 'Orbital station', tech: 'orbital', hp: 400 },
  starship: { cls: 'space', name: 'Colony starship', tech: 'starships', speed: 3, hp: 600 },
};
const _stubDefs = new Map();
// The def a stub vehicle runs with: its base kind's, with the stub's own stats.
export function stubDef(model) {
  let d = _stubDefs.get(model);
  if (d) return d;
  const s = STUB_KINDS[model];
  if (!s) return null;
  const base = s.base ? KINDS[s.base] : null;
  d = { ...(base || { cls: s.cls, turn: 2, crew: 1, capacity: 0, scale: 1, length: 1, size: 0.6, dps: 0 }), ...s, model, stub: true };
  if (base) d.cls = base.cls;
  _stubDefs.set(model, d);
  return d;
}

// Proud names for ships (the chronicle and the inspector use them).
const ADJ = ['Swift', 'Gray', 'Golden', 'Bold', 'Silver', 'Red', 'Morning', 'Wandering', 'Faithful', 'Northern', 'Lucky', 'Proud', 'Quiet', 'Salt', 'Iron', 'Merry', 'Blue', 'Brave', 'Old', 'Evening'];
const NOUN = ['Heron', 'Gull', 'Star', 'Otter', 'Wind', 'Maiden', 'Dolphin', 'Lantern', 'Crown', 'Swan', 'Tide', 'Pike', 'Hawk', 'Rose', 'Promise', 'Seal', 'Petrel', 'Fortune', 'Wave', 'Anchor'];
const SMALL = ['Little', 'Bonny', 'Wee', 'Busy', 'Patient', 'Quick', 'Brown', 'Lucky', 'Spry', 'Humble'];
const FISH = ['Herring', 'Minnow', 'Sprat', 'Tern', 'Cockle', 'Mullet', 'Puffin', 'Shrimp', 'Eel', 'Kittiwake'];
export function shipName(rng, kind = null) {
  if (kind === 'fishing') return `${SMALL[Math.floor(rng() * SMALL.length)]} ${FISH[Math.floor(rng() * FISH.length)]}`;
  const a = ADJ[Math.floor(rng() * ADJ.length)];
  const n = NOUN[Math.floor(rng() * NOUN.length)];
  return `${a} ${n}`;
}
// Names for land craft: a town's wain, a caravan, an engine of war.
const WAIN = ['Old', 'Red', 'Long', 'Stout', 'Creaking', 'Green', 'Faithful', 'Slow'];
const ENGINE = ['Wallbreaker', 'Thunder', 'Old Grudge', 'Stonefist', 'Gatecrusher', 'Iron Goat', 'Long Arm', 'Hammer'];
export function craftName(rng, kind, town = null) {
  const pick = (L) => L[Math.floor(rng() * L.length)];
  if (kind === 'oxcart') return `${pick(WAIN)} Wain${town ? ' of ' + town : ''}`;
  if (kind === 'caravan') return `${town ? town + ' ' : ''}Caravan`;
  return pick(ENGINE);
}

// Cargo for the inspector, in plain words.
export function cargoText(c) {
  if (!c) return 'Empty';
  const parts = [];
  if (c.settlers) parts.push(`${Array.isArray(c.settlers) ? c.settlers.length : c.settlers} settlers`);
  if (c.army) parts.push(`${Array.isArray(c.army) ? c.army.length : c.army} soldiers`);
  for (const k of ['fish', 'food', 'wood', 'stone', 'ore', 'gold', 'goods']) if (c[k] > 0) parts.push(`${Math.round(c[k])} ${k}`);
  return parts.length ? parts.join(', ') : 'Empty';
}
