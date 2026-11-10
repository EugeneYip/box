// Vessel and vehicle kinds of the Fleets module. Speeds in tiles per game
// second, lengths in tiles. `tech` gates who may build it; `sail` ships ride
// the wind, `oars` are rowed. `size` is the hit radius for the inspector and
// combat; `dps` the damage a crew deals in a fight.
export const KINDS = {
  // ---------------------------------------------------------------- water
  fishing: { cls: 'sea', name: 'Fishing boat', tech: 'fishing', speed: 1.35, turn: 2.4, hp: 30, crew: 2, capacity: 12, length: 1.0, size: 0.6, dps: 0, sail: true, oars: true, small: true },
  cog: { cls: 'sea', name: 'Trading cog', tech: 'sailing', speed: 1.75, turn: 1.1, hp: 110, crew: 6, capacity: 60, length: 2.2, size: 1.1, dps: 1.5, sail: true },
  transport: { cls: 'sea', name: 'Transport', tech: 'sailing', speed: 1.6, turn: 1.0, hp: 120, crew: 6, capacity: 10, length: 2.4, size: 1.2, dps: 1, sail: true },
  galley: { cls: 'sea', name: 'War galley', tech: 'shipbuilding', speed: 2.25, turn: 1.5, hp: 170, crew: 24, capacity: 0, length: 3.2, size: 1.4, dps: 11, sail: true, oars: true, war: true },
  explorer: { cls: 'sea', name: 'Exploration ship', tech: 'astronomy', speed: 2.35, turn: 1.4, hp: 100, crew: 10, capacity: 6, length: 2.5, size: 1.2, dps: 2, sail: true, big: true },
  carrack: { cls: 'sea', name: 'Carrack', tech: 'navigation', speed: 2.1, turn: 0.9, hp: 260, crew: 18, capacity: 160, length: 3.5, size: 1.6, dps: 5, sail: true, big: true },
  // ---------------------------------------------------------------- land
  oxcart: { cls: 'land', name: 'Ox cart', tech: 'wheel', speed: 1.0, turn: 3, hp: 40, crew: 1, capacity: 24, length: 1.5, size: 0.7, dps: 0 },
  caravan: { cls: 'land', name: 'Trade caravan', tech: 'banking', speed: 1.1, turn: 3, hp: 50, crew: 2, capacity: 30, length: 1.0, size: 0.8, dps: 0 },
  ram: { cls: 'land', name: 'Battering ram', tech: 'siegecraft', speed: 0.85, turn: 2, hp: 140, crew: 4, capacity: 0, length: 1.4, size: 0.8, dps: 0, siege: true },
  catapult: { cls: 'land', name: 'Catapult', tech: 'siegecraft', speed: 0.8, turn: 2, hp: 100, crew: 3, capacity: 0, length: 1.3, size: 0.8, dps: 0, siege: true },
};

export const SEA_KINDS = ['fishing', 'cog', 'transport', 'galley', 'explorer', 'carrack'];
export const LAND_KINDS = ['oxcart', 'caravan', 'ram', 'catapult'];
export const ALL_KINDS = [...SEA_KINDS, ...LAND_KINDS];

// Proud names for ships (the chronicle and the inspector use them).
const ADJ = ['Swift', 'Grey', 'Golden', 'Bold', 'Silver', 'Red', 'Morning', 'Wandering', 'Faithful', 'Northern', 'Lucky', 'Proud', 'Quiet', 'Salt', 'Iron', 'Merry', 'Blue', 'Brave', 'Old', 'Evening'];
const NOUN = ['Heron', 'Gull', 'Star', 'Otter', 'Wind', 'Maiden', 'Dolphin', 'Lantern', 'Crown', 'Swan', 'Tide', 'Pike', 'Hawk', 'Rose', 'Promise', 'Seal', 'Petrel', 'Fortune', 'Wave', 'Anchor'];
export function shipName(rng) {
  const a = ADJ[Math.floor(rng() * ADJ.length)];
  const n = NOUN[Math.floor(rng() * NOUN.length)];
  return `${a} ${n}`;
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
