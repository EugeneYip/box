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
  // ---------------------------------------------------------------- modern water (docs/MODERN-ERAS.md, docs/TECH-BREADTH.md section 4)
  // `role` is the old kind whose routines a modern kind runs (trade like a
  // cog, war like a galley, ...); `era` holds a kind back until its realm has
  // reached that era as well as learned its art.
  steamer: { cls: 'sea', role: 'cog', name: 'Steamship', tech: 'steampower', era: 4, speed: 2.3, turn: 1.1, hp: 170, crew: 12, capacity: 90, scale: 0.75, length: 2.25, beam: 0.5, draft: 0.45, clear: 1.6, size: 0.95, dps: 2, sail: false, smoke: true },
  freighter: { cls: 'sea', role: 'cog', name: 'Motor freighter', tech: 'combustion', era: 5, speed: 2.6, turn: 1.0, hp: 210, crew: 14, capacity: 140, scale: 0.75, length: 2.55, beam: 0.52, draft: 0.5, clear: 1.8, size: 1.05, dps: 2, sail: false, smoke: true },
  container: { cls: 'sea', role: 'carrack', name: 'Container ship', tech: 'containers', era: 6, speed: 2.8, turn: 0.75, hp: 340, crew: 20, capacity: 300, scale: 0.75, length: 3.45, beam: 0.66, draft: 0.75, clear: 3, size: 1.4, dps: 2, sail: false, big: true },
  tanker: { cls: 'sea', role: 'carrack', name: 'Tanker', tech: 'containers', era: 6, speed: 2.5, turn: 0.7, hp: 320, crew: 18, capacity: 260, scale: 0.75, length: 3.3, beam: 0.66, draft: 0.8, clear: 3, size: 1.35, dps: 1, sail: false, big: true },
  liner: { cls: 'sea', role: 'cog', name: 'Cruise liner', tech: 'combustion', era: 6, speed: 2.7, turn: 0.8, hp: 300, crew: 60, capacity: 120, scale: 0.75, length: 3.15, beam: 0.62, draft: 0.7, clear: 2.6, size: 1.3, dps: 0, sail: false, big: true, liner: true },
  icebreaker: { cls: 'sea', role: 'icebreaker', name: 'Icebreaker', tech: 'combustion', era: 5, speed: 2.0, turn: 1.1, hp: 360, crew: 30, capacity: 20, scale: 0.75, length: 2.1, beam: 0.56, draft: 0.5, clear: 1.6, size: 1.0, dps: 1, sail: false, smoke: true },
  submarine: { cls: 'sea', role: 'galley', name: 'Submarine', tech: 'battleships', era: 6, speed: 2.4, turn: 1.2, hp: 220, crew: 40, capacity: 0, scale: 0.75, length: 1.95, beam: 0.3, draft: 0.5, clear: 2, size: 0.9, dps: 26, sail: false, war: true, sub: true },
  patrol: { cls: 'sea', role: 'galley', name: 'Destroyer', tech: 'battleships', era: 5, speed: 3.0, turn: 1.6, hp: 260, crew: 60, capacity: 0, scale: 0.75, length: 2.1, beam: 0.4, draft: 0.45, clear: 1.6, size: 0.95, dps: 20, sail: false, war: true, smoke: true, escort: true },
  hovercraft: { cls: 'sea', role: 'hover', name: 'Hovercraft', tech: 'combustion', era: 6, speed: 3.2, turn: 2.2, hp: 90, crew: 4, capacity: 30, scale: 0.75, length: 1.2, beam: 0.6, draft: 0.05, clear: 0, size: 0.6, dps: 0, sail: false, small: true },
  hydrofoil: { cls: 'sea', role: 'cog', name: 'Hydrofoil ferry', tech: 'combustion', era: 6, speed: 3.6, turn: 1.4, hp: 110, crew: 6, capacity: 40, scale: 0.75, length: 1.5, beam: 0.36, draft: 0.25, clear: 1, size: 0.7, dps: 0, sail: false, ferry: true },
  research: { cls: 'sea', role: 'explorer', name: 'Research vessel', tech: 'computing', era: 6, speed: 2.4, turn: 1.2, hp: 160, crew: 24, capacity: 6, scale: 0.75, length: 1.95, beam: 0.46, draft: 0.45, clear: 1.6, size: 0.9, dps: 0, sail: false, big: true },
  trimaran: { cls: 'sea', role: 'cog', name: 'Solar trimaran', tech: 'fusion', era: 7, speed: 3.0, turn: 1.2, hp: 200, crew: 8, capacity: 120, scale: 0.75, length: 2.1, beam: 0.8, draft: 0.35, clear: 1.6, size: 1.0, dps: 0, sail: false },
  autocargo: { cls: 'sea', role: 'carrack', name: 'Autonomous cargo ship', tech: 'robotics', era: 7, speed: 3.1, turn: 0.8, hp: 320, crew: 0, capacity: 320, scale: 0.75, length: 3.15, beam: 0.6, draft: 0.7, clear: 2.6, size: 1.3, dps: 0, sail: false, big: true },
  ironclad: { cls: 'sea', role: 'galley', name: 'Ironclad', tech: 'ironclads', era: 4, speed: 2.35, turn: 1.2, hp: 320, crew: 60, capacity: 0, scale: 0.75, length: 2.25, beam: 0.52, draft: 0.45, clear: 2, size: 1.0, dps: 22, sail: false, war: true, smoke: true },
  battleship: { cls: 'sea', role: 'galley', name: 'Battleship', tech: 'battleships', era: 5, speed: 2.55, turn: 0.9, hp: 520, crew: 120, capacity: 0, scale: 0.75, length: 3.3, beam: 0.62, draft: 0.7, clear: 2.6, size: 1.35, dps: 34, sail: false, war: true, big: true, smoke: true },
  carrier: { cls: 'sea', role: 'galley', name: 'Aircraft carrier', tech: 'carriers', era: 6, speed: 2.45, turn: 0.75, hp: 620, crew: 200, capacity: 0, scale: 0.75, length: 3.6, beam: 0.8, draft: 0.75, clear: 3, size: 1.5, dps: 30, sail: false, war: true, big: true, carrier: true },
  // ---------------------------------------------------------------- modern land
  // trains run along civ.railLines() (on the drawn track); a train is drawn as
  // its engine and the `cars` behind it on the rails, `length` (a house) apart
  train: { cls: 'land', role: 'train', name: 'Steam train', tech: 'railways', speed: 3.4, turn: 6, hp: 120, crew: 2, capacity: 80, scale: 1, length: 1.82, size: 0.8, dps: 0, rail: true, smoke: true, cars: 4 },
  maglev: { cls: 'land', role: 'train', name: 'Maglev train', tech: 'maglev', speed: 6.5, turn: 8, hp: 160, crew: 1, capacity: 120, scale: 1, length: 1.9, size: 0.9, dps: 0, rail: true, cars: 3 },
  truck: { cls: 'land', road: true, role: 'oxcart', name: 'Truck', tech: 'combustion', speed: 2.4, turn: 3, hp: 70, crew: 1, capacity: 48, scale: 1, length: 1.0, size: 0.6, dps: 0 },
  car: { cls: 'land', road: true, role: 'car', name: 'Car', tech: 'combustion', speed: 2.6, turn: 4, hp: 40, crew: 1, capacity: 4, scale: 1, length: 0.92, size: 0.45, dps: 0 },
  cannon: { cls: 'land', role: 'catapult', name: 'Cannon', tech: 'gunpowder', speed: 1.1, turn: 2, hp: 140, crew: 3, capacity: 0, scale: 1.3, length: 1.4, size: 1.0, dps: 0, siege: true, gun: true },
  artillery: { cls: 'land', role: 'catapult', name: 'Artillery', tech: 'battleships', speed: 1.35, turn: 2, hp: 190, crew: 4, capacity: 0, scale: 1.3, length: 1.5, size: 1.0, dps: 0, siege: true, gun: true },
  tank: { cls: 'land', role: 'ram', name: 'Tank', tech: 'battleships', speed: 1.7, turn: 2, hp: 420, crew: 4, capacity: 0, scale: 1.3, length: 1.4, size: 1.0, dps: 0, siege: true, gun: true },
  // civic vehicles (docs/TECH-BREADTH.md section 3)
  fireengine: { cls: 'land', road: true, role: 'service', name: 'Fire engine', tech: 'fireengines', speed: 3.2, turn: 4, hp: 90, crew: 4, capacity: 0, scale: 1, length: 1.05, size: 0.65, dps: 0, siren: true },
  ambulance: { cls: 'land', road: true, role: 'service', name: 'Ambulance', tech: 'antibiotics', speed: 3.0, turn: 4, hp: 60, crew: 2, capacity: 2, scale: 1, length: 0.85, size: 0.55, dps: 0, siren: true },
  tractor: { cls: 'land', road: true, role: 'service', name: 'Tractor', tech: 'tractors', speed: 0.9, turn: 3, hp: 60, crew: 1, capacity: 0, scale: 1, length: 0.7, size: 0.5, dps: 0 },
  tram: { cls: 'land', road: true, role: 'service', name: 'Tram', tech: 'transit', speed: 1.7, turn: 5, hp: 90, crew: 1, capacity: 40, scale: 1, length: 1.3, size: 0.7, dps: 0 },
  bus: { cls: 'land', road: true, role: 'service', name: 'Bus', tech: 'transit', speed: 2.0, turn: 4, hp: 80, crew: 1, capacity: 36, scale: 1, length: 1.15, size: 0.65, dps: 0 },
  // (round 33) a Modern town's own vehicles on its streets (town.js): not in
  // the god powers' chooser (LAND_KINDS), only ever sent by their towns
  van: { cls: 'land', road: true, role: 'town', name: 'Delivery van', tech: 'combustion', speed: 1.2, turn: 4, hp: 50, crew: 1, capacity: 0, scale: 1, length: 0.85, size: 0.55, dps: 0 },
  garbage: { cls: 'land', road: true, role: 'town', name: 'Garbage truck', tech: 'combustion', speed: 1.0, turn: 3.5, hp: 80, crew: 2, capacity: 0, scale: 1, length: 1.0, size: 0.6, dps: 0 },
};

// Design sizes to the world's (VEHICLE in src/core/scale.js): the model scale,
// length, beam and hit size shrink together; speeds stay (tiles per second).
// `road` vehicles take VEHICLE.road (in proportion with the people beside them).
// Every kind's `role` is the routine it runs (an old kind is its own role).
for (const [k, d] of Object.entries(KINDS)) {
  const s = VEHICLE.of(d.cls, !!d.road);
  d.scale *= s;
  d.length *= s;
  if (d.beam) d.beam *= s;
  d.size *= s;
  d.kind = k;
  if (!d.role) d.role = k;
}

export const SEA_KINDS = ['fishing', 'cog', 'transport', 'galley', 'explorer', 'carrack', 'steamer', 'freighter', 'container', 'tanker', 'liner', 'icebreaker', 'submarine', 'patrol', 'hovercraft', 'hydrofoil', 'research', 'trimaran', 'autocargo', 'ironclad', 'battleship', 'carrier'];
export const LAND_KINDS = ['oxcart', 'caravan', 'ram', 'catapult', 'train', 'maglev', 'truck', 'car', 'cannon', 'artillery', 'tank', 'fireengine', 'ambulance', 'tractor', 'tram', 'bus'];
export const ALL_KINDS = [...SEA_KINDS, ...LAND_KINDS];

// ---------------------------------------------------------------- the air and space (air.js)
// Aircraft fly as plain records in fleet.air (straight or gently curved
// routes at an altitude, no terrain pathing), taking off from and landing at
// airfields and airports; rockets climb from launch pads; satellites and
// stations circle in fleet.orbit.
export const AIR_KINDS = {
  plane: { cls: 'air', name: 'Transport plane', tech: 'flight', speed: 6, alt: 6, capacity: 20, hp: 60, length: 1.1, size: 0.7, prop: true },
  biplane: { cls: 'air', name: 'Biplane', tech: 'flight', speed: 7, alt: 5, hp: 50, war: true, length: 0.8, size: 0.6, prop: true },
  airliner: { cls: 'air', name: 'Jet airliner', tech: 'jets', speed: 14, alt: 11, capacity: 60, hp: 120, length: 1.6, size: 0.9, jet: true },
  jet: { cls: 'air', name: 'Jet fighter', tech: 'jets', speed: 18, alt: 9, hp: 90, war: true, length: 0.9, size: 0.6, jet: true },
  drone: { cls: 'air', name: 'Delivery drone', tech: 'robotics', speed: 3.5, alt: 2.2, capacity: 2, hp: 10, length: 0.3, size: 0.3, vtol: true },
  skytaxi: { cls: 'air', name: 'Sky taxi', tech: 'vtol', speed: 8, alt: 4.5, capacity: 4, hp: 60, length: 0.7, size: 0.5, vtol: true },
  helicopter: { cls: 'air', name: 'Rescue helicopter', tech: 'flight', era: 5, speed: 5, alt: 4, capacity: 4, hp: 60, length: 0.8, size: 0.55, vtol: true },
  rocket: { cls: 'space', name: 'Rocket', tech: 'rocketry', speed: 4, hp: 80, length: 1.6, size: 0.5 },
  satellite: { cls: 'space', name: 'Satellite', tech: 'rocketry', hp: 20, length: 0.3, size: 0.3 },
  station: { cls: 'space', name: 'Orbital station', tech: 'orbital', hp: 400, length: 1, size: 1 },
  starship: { cls: 'space', name: 'Colony starship', tech: 'starships', speed: 3, hp: 600, length: 2.6, size: 0.8 },
};
for (const [k, d] of Object.entries(AIR_KINDS)) {
  const s = VEHICLE.air;
  d.scale = s;
  d.length *= s;
  d.size *= s;
  d.kind = k;
  d.role = k;
  d.turn = 2;
  d.crew = 1;
  d.dps = 0;
  if (d.capacity == null) d.capacity = 0;
}
// (the first round-14 sim called the aircraft and space kinds stubs)
export const STUB_KINDS = AIR_KINDS;
export function stubDef(kind) {
  return AIR_KINDS[kind] || null;
}
// Any kind's def: water, land, air or space.
export function kindDef(kind) {
  return KINDS[kind] || AIR_KINDS[kind] || null;
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

// Emergency vehicles: never set upon by raiders, nor burned at the fire they serve.
export const SERVICE_KINDS = new Set(['ambulance', 'fireengine']);
