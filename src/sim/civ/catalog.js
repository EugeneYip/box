import { FOOTPRINT } from '../../core/scale.js';

// Building catalogue: footprints (tiles, before rotation), costs, hit points,
// housing and build times per level. Levels are 1-based.
//
// Footprint convention: the building's front (door) faces local +Z. A
// rotation of 90° / 270° swaps the tile footprint (w <-> h).
//
// w x h below are design footprints (the round-13 plot a model is drawn for);
// the end of this table keeps them as dw x dh and sets w x h to the tiles the
// building takes at today's scale (FOOTPRINT in src/core/scale.js).

export const BUILDING_TYPES = {
  hall: {
    names: ['Longhall', 'Town Hall', 'Keep'],
    w: 3,
    h: 3,
    levels: 3,
    hp: [320, 520, 900],
    housing: [4, 5, 6],
    buildTime: [40, 60, 80],
    cost: [{ wood: 0 }, { wood: 40, stone: 30 }, { wood: 60, stone: 90, gold: 4 }],
    storage: true,
    banner: true,
  },
  house: {
    names: ['Hut', 'House', 'Manor'],
    w: 2,
    h: 2,
    levels: 3,
    hp: [80, 130, 190],
    housing: [3, 5, 8],
    buildTime: [14, 20, 28],
    cost: [{ wood: 10 }, { wood: 14, stone: 8 }, { wood: 22, stone: 20 }],
    chimney: true,
  },
  granary: { names: ['Granary'], w: 2, h: 2, levels: 1, hp: [120], buildTime: [20], cost: [{ wood: 16, stone: 4 }], foodCap: 220, storage: true },
  workshop: { names: ['Workshop', 'Forge'], w: 2, h: 2, levels: 2, hp: [120, 180], buildTime: [20, 26], cost: [{ wood: 14, stone: 8 }, { wood: 10, stone: 24 }], storage: true },
  well: { names: ['Well'], w: 1, h: 1, levels: 1, hp: [60], buildTime: [8], cost: [{ stone: 6 }] },
  windmill: { names: ['Windmill'], w: 2, h: 2, levels: 1, hp: [140], buildTime: [26], cost: [{ wood: 22, stone: 10 }] },
  docks: { names: ['Docks', 'Harbour'], w: 2, h: 2, levels: 2, hp: [110, 200], buildTime: [20, 30], cost: [{ wood: 18 }, { wood: 30, stone: 16 }], coastal: true, tech: [null, 'sailing'] },
  // monuments rise in three stages, each a construction of its own
  wonder: { names: ['Wonder Footings', 'Rising Wonder', 'Wonder'], w: 5, h: 5, levels: 3, hp: [700, 1100, 1600], buildTime: [70, 90, 110], cost: [{ wood: 50, stone: 80, gold: 10 }, { wood: 40, stone: 110, gold: 15 }, { wood: 30, stone: 130, gold: 25 }], banner: true, monument: true },
  colossus: { names: ['Colossus Pedestal', 'Rising Colossus', 'Colossus'], w: 3, h: 3, levels: 3, hp: [500, 800, 1200], buildTime: [60, 80, 100], cost: [{ wood: 30, stone: 70, gold: 10 }, { wood: 20, stone: 90, gold: 15 }, { wood: 10, stone: 100, gold: 25 }], banner: true, monument: true },
  // technology unlocks (docs/TECH-UNLOCKS.md)
  barn: { names: ['Farmstead Barn'], w: 2, h: 2, levels: 1, hp: [140], buildTime: [18], cost: [{ wood: 18 }], tech: ['agriculture'] },
  kiln: { names: ['Kiln'], w: 1, h: 1, levels: 1, hp: [90], buildTime: [10], cost: [{ wood: 4, stone: 6 }], tech: ['pottery'] },
  waterwheel: { names: ['Water Wheel'], w: 1, h: 1, levels: 1, hp: [90], buildTime: [12], cost: [{ wood: 12, stone: 2 }], tech: ['irrigation'] },
  stables: { names: ['Stables'], w: 2, h: 2, levels: 1, hp: [160], buildTime: [20], cost: [{ wood: 22, stone: 6 }], tech: ['horsemanship'] },
  bloomery: { names: ['Bloomery'], w: 1, h: 1, levels: 1, hp: [140], buildTime: [14], cost: [{ wood: 6, stone: 12 }], tech: ['ironworking'] },
  healer: { names: ["Healer's House"], w: 2, h: 1, levels: 1, hp: [110], buildTime: [16], cost: [{ wood: 14, stone: 6 }], tech: ['medicine'] },
  shipyard: { names: ['Shipyard'], w: 3, h: 2, levels: 1, hp: [220], buildTime: [30], cost: [{ wood: 40, stone: 10 }], coastal: true, tech: ['shipbuilding'] },
  foundry: { names: ['Foundry'], w: 2, h: 2, levels: 1, hp: [260], buildTime: [30], cost: [{ wood: 10, stone: 34 }], tech: ['steelworking'] },
  forum: { names: ['Forum'], w: 3, h: 3, levels: 1, hp: [320], buildTime: [44], cost: [{ wood: 10, stone: 50, gold: 6 }], tech: ['philosophy'] },
  watermill: { names: ['Watermill'], w: 2, h: 1, levels: 1, hp: [150], buildTime: [22], cost: [{ wood: 20, stone: 10 }], tech: ['engineering'] },
  bridge: { names: ['Stone Bridge'], w: 1, h: 1, levels: 1, hp: [400], buildTime: [10], cost: [{ stone: 6 }], wall: false, tech: ['architecture'] },
  statue: { names: ['Statue'], w: 1, h: 1, levels: 1, hp: [120], buildTime: [14], cost: [{ stone: 16, gold: 4 }] },
  // mastery 6: a domed academy in the capital and the great cities
  academy: { names: ['Academy'], w: 3, h: 2, levels: 1, hp: [380], buildTime: [60], cost: [{ wood: 30, stone: 60, gold: 15 }], banner: true },
  library: { names: ['Library'], w: 2, h: 2, levels: 1, hp: [160], buildTime: [30], cost: [{ wood: 18, stone: 24 }], tech: ['writing'] },
  observatory: { names: ['Observatory'], w: 2, h: 2, levels: 1, hp: [200], buildTime: [40], cost: [{ wood: 10, stone: 40, gold: 2 }], tech: ['astronomy'] },
  aqueduct: { names: ['Aqueduct'], w: 3, h: 1, levels: 1, hp: [260], buildTime: [36], cost: [{ stone: 44 }], tech: ['architecture'] },
  market: { names: ['Market', 'Market Hall'], w: 3, h: 3, levels: 2, hp: [120, 240], buildTime: [26, 40], cost: [{ wood: 26, stone: 10 }, { wood: 30, stone: 40, gold: 10 }], tech: [null, 'banking'] },
  temple: { names: ['Shrine', 'Temple'], w: 3, h: 3, levels: 2, hp: [220, 360], buildTime: [36, 48], cost: [{ wood: 20, stone: 26 }, { wood: 20, stone: 50, gold: 3 }] },
  barracks: { names: ['Barracks'], w: 3, h: 2, levels: 1, hp: [260], buildTime: [32], cost: [{ wood: 26, stone: 22 }], banner: true },
  watchtower: { names: ['Watchtower'], w: 1, h: 1, levels: 1, hp: [150], buildTime: [16], cost: [{ wood: 12, stone: 8 }], banner: true },
  wall: { names: ['Wall'], w: 1, h: 1, levels: 1, hp: [110], buildTime: [5], cost: [{ stone: 3 }], wall: true },
  tower: { names: ['Wall Tower'], w: 1, h: 1, levels: 1, hp: [170], buildTime: [12], cost: [{ stone: 10 }], wall: true, banner: true },
  gate: { names: ['Gatehouse'], w: 1, h: 1, levels: 1, hp: [190], buildTime: [12], cost: [{ stone: 10, wood: 4 }], wall: true },
  // ---- modern and future eras (docs/MODERN-ERAS.md) ----
  // `kind` is what the Buildings renderer keys its model on (until each has
  // a model of its own it draws a plain placeholder of the right size);
  // `modern` marks the types of eras 4-7; `smoke` how much haze a working
  // one puts out (civ.haze()); `power` how much it feeds the power lines.
  // They are paid mostly in gold (the towns of these eras run short of stone).
  factory: { names: ['Factory'], kind: 'factory', w: 3, h: 2, levels: 1, hp: [360], buildTime: [40], cost: [{ wood: 10, stone: 24, gold: 16 }], tech: ['industry'], modern: true, smoke: 1 },
  rowhouse: { names: ["Workers' Row Houses"], kind: 'rowhouse', w: 3, h: 1, levels: 1, hp: [200], housing: [10], buildTime: [26], cost: [{ wood: 10, stone: 14, gold: 4 }], tech: ['industry'], modern: true },
  waterworks: { names: ['Waterworks'], kind: 'waterworks', w: 2, h: 2, levels: 1, hp: [260], buildTime: [34], cost: [{ stone: 20, gold: 14 }], tech: ['sanitation'], modern: true },
  powerstation: { names: ['Power Station'], kind: 'powerstation', w: 3, h: 2, levels: 1, hp: [400], buildTime: [44], cost: [{ stone: 30, gold: 24 }], tech: ['electricity'], modern: true, smoke: 0.7, power: 1 },
  pylon: { names: ['Pylon'], kind: 'pylon', w: 1, h: 1, levels: 1, hp: [120], buildTime: [8], cost: [{ stone: 4, gold: 2 }], tech: ['electricity'], modern: true },
  radiomast: { names: ['Radio Mast'], kind: 'radiomast', w: 1, h: 1, levels: 1, hp: [140], buildTime: [16], cost: [{ stone: 6, gold: 8 }], tech: ['radio'], modern: true },
  apartment: { names: ['Apartment Block', 'Tall Apartment Block'], kind: 'apartment', w: 2, h: 2, levels: 2, hp: [320, 420], housing: [14, 20], buildTime: [36, 30], cost: [{ wood: 6, stone: 22, gold: 10 }, { stone: 20, gold: 12 }], tech: ['concrete', 'concrete'], modern: true },
  campus: { names: ['Research Campus'], kind: 'campus', w: 3, h: 2, levels: 1, hp: [380], buildTime: [50], cost: [{ stone: 30, gold: 30 }], tech: ['computing'], modern: true },
  skyscraper: { names: ['Skyscraper'], kind: 'skyscraper', w: 2, h: 2, levels: 1, hp: [700], housing: [30], buildTime: [70], cost: [{ stone: 40, gold: 40 }], tech: ['skyscrapers'], modern: true },
  nuclear: { names: ['Nuclear Power Plant'], kind: 'nuclear', w: 3, h: 3, levels: 1, hp: [800], buildTime: [80], cost: [{ stone: 50, gold: 60 }], tech: ['nuclear'], modern: true, power: 3 },
  fusion: { names: ['Fusion Plant'], kind: 'fusion', w: 3, h: 3, levels: 1, hp: [900], buildTime: [80], cost: [{ stone: 45, gold: 70 }], tech: ['fusion'], modern: true, power: 4 },
  arcology: { names: ['Arcology'], kind: 'arcology', w: 4, h: 4, levels: 1, hp: [1600], housing: [70], buildTime: [120], cost: [{ wood: 20, stone: 70, gold: 80 }], tech: ['arcology'], modern: true, banner: true },
  station: { names: ['Railway Station'], kind: 'station', w: 3, h: 1, levels: 1, hp: [260], buildTime: [30], cost: [{ wood: 10, stone: 16, gold: 6 }], tech: ['railways'], modern: true },
  airfield: { names: ['Airfield'], kind: 'airfield', w: 4, h: 2, levels: 1, hp: [200], buildTime: [30], cost: [{ wood: 6, stone: 14, gold: 12 }], tech: ['flight'], modern: true, air: 1 },
  airport: { names: ['Airport'], kind: 'airport', w: 5, h: 3, levels: 1, hp: [500], buildTime: [60], cost: [{ stone: 40, gold: 50 }], tech: ['jets'], modern: true, air: 2 },
  containerport: { names: ['Container Port'], kind: 'containerport', w: 3, h: 2, levels: 1, hp: [420], buildTime: [50], cost: [{ stone: 30, gold: 30 }], coastal: true, tech: ['containers'], modern: true },
  launchpad: { names: ['Launch Pad'], kind: 'launchpad', w: 3, h: 3, levels: 1, hp: [500], buildTime: [60], cost: [{ stone: 40, gold: 50 }], tech: ['rocketry'], modern: true },
  spaceport: { names: ['Spaceport'], kind: 'spaceport', w: 4, h: 4, levels: 1, hp: [900], buildTime: [90], cost: [{ stone: 60, gold: 80 }], tech: ['orbital'], modern: true },
  // ---- breadth branches (docs/TECH-BREADTH.md) ----
  // The early ones are drawn as plain blocks of their footprint and the modern
  // ones as neutral placeholders until the Buildings module models them.
  pasture: { names: ['Pasture Pens'], kind: 'pasture', w: 3, h: 2, levels: 1, hp: [90], buildTime: [14], cost: [{ wood: 12 }], tech: ['husbandry'], food: 0.05 },
  smokehouse: { names: ['Smokehouse'], kind: 'smokehouse', w: 1, h: 1, levels: 1, hp: [110], buildTime: [12], cost: [{ wood: 10, stone: 4 }], tech: ['preservation'] },
  lazaretto: { names: ['Lazaretto'], kind: 'lazaretto', w: 2, h: 1, levels: 1, hp: [160], buildTime: [20], cost: [{ wood: 14, stone: 12 }], tech: ['quarantine'] },
  qanat: { names: ['Qanat Well'], kind: 'qanat', w: 1, h: 1, levels: 1, hp: [100], buildTime: [12], cost: [{ stone: 10 }], tech: ['qanats'] },
  nursery: { names: ['Tree Nursery'], kind: 'nursery', w: 2, h: 1, levels: 1, hp: [90], buildTime: [14], cost: [{ wood: 10 }], tech: ['forestry'] },
  firestation: { names: ['Fire Station'], kind: 'firestation', w: 2, h: 1, levels: 1, hp: [200], buildTime: [20], cost: [{ wood: 12, stone: 14 }], tech: ['firebrigade'] },
  cannery: { names: ['Cannery'], kind: 'cannery', w: 2, h: 2, levels: 1, hp: [260], buildTime: [30], cost: [{ stone: 16, gold: 12 }], tech: ['canning'], modern: true, smoke: 0.3 },
  silo: { names: ['Grain Silos'], kind: 'silo', w: 1, h: 1, levels: 1, hp: [200], buildTime: [16], cost: [{ stone: 8, gold: 6 }], tech: ['tractors'], modern: true },
  greenhouse: { names: ['Greenhouses'], kind: 'greenhouse', w: 2, h: 2, levels: 1, hp: [180], buildTime: [24], cost: [{ stone: 10, gold: 14 }], tech: ['hybridcrops'], modern: true },
  vertfarm: { names: ['Vertical Farm'], kind: 'vertfarm', w: 2, h: 2, levels: 1, hp: [520], buildTime: [50], cost: [{ stone: 30, gold: 40 }], tech: ['vertfarms'], modern: true },
  clinic: { names: ['Clinic'], kind: 'clinic', w: 2, h: 1, levels: 1, hp: [220], buildTime: [24], cost: [{ stone: 14, gold: 10 }], tech: ['vaccination'], modern: true },
  hospital: { names: ['Hospital'], kind: 'hospital', w: 3, h: 2, levels: 1, hp: [420], buildTime: [44], cost: [{ stone: 28, gold: 28 }], tech: ['antibiotics'], modern: true },
  genelab: { names: ['Research Hospital'], kind: 'genelab', w: 3, h: 2, levels: 1, hp: [460], buildTime: [50], cost: [{ stone: 30, gold: 40 }], tech: ['genetics'], modern: true },
  levee: { names: ['Levee and Pumping Mill'], kind: 'levee', w: 3, h: 1, levels: 1, hp: [500], buildTime: [20], cost: [{ stone: 16, gold: 6 }], tech: ['levees'], modern: true },
  weatherstation: { names: ['Weather Station'], kind: 'weatherstation', w: 2, h: 2, levels: 1, hp: [200], buildTime: [26], cost: [{ stone: 12, gold: 16 }], tech: ['forecasting'], modern: true },
  desal: { names: ['Desalination Plant'], kind: 'desal', w: 3, h: 2, levels: 1, hp: [460], buildTime: [50], cost: [{ stone: 34, gold: 40 }], coastal: true, tech: ['desalination'], modern: true },
  climatetower: { names: ['Climate Tower'], kind: 'climatetower', w: 2, h: 2, levels: 1, hp: [600], buildTime: [60], cost: [{ stone: 40, gold: 50 }], tech: ['terraforming'], modern: true },
  controlspire: { names: ['Control Spire'], kind: 'controlspire', w: 1, h: 1, levels: 1, hp: [400], buildTime: [40], cost: [{ stone: 20, gold: 40 }], tech: ['smartcity'], modern: true },
  park: { names: ['City Park'], kind: 'park', w: 2, h: 2, levels: 1, hp: [120], buildTime: [20], cost: [{ wood: 6, gold: 10 }], tech: ['gardencity'], modern: true },
  skyshield: { names: ['Planetary Defense Station'], kind: 'skyshield', w: 2, h: 2, levels: 1, hp: [700], buildTime: [70], cost: [{ stone: 40, gold: 70 }], tech: ['skyshield'], modern: true },
};
export const MODERN_TYPES = Object.keys(BUILDING_TYPES).filter((t) => BUILDING_TYPES[t].modern);

// Design footprints to tiles. The hall keeps its 3 x 3 plot: a smaller hall
// stands on a square, and the village centre stays where the planner and
// the realm seeding expect it. Walls, towers, gates and bridges are one tile.
for (const [id, d] of Object.entries(BUILDING_TYPES)) {
  d.dw = d.w;
  d.dh = d.h;
  if (id === 'hall' || d.wall || id === 'bridge') continue;
  d.w = FOOTPRINT.tiles(d.w);
  d.h = FOOTPRINT.tiles(d.h);
}

export const BUILDING_LABEL = {
  vale: { academy: ['Royal Academy'], wonder: ['Great Spire Footings', 'Rising Spire', 'Great Spire'], colossus: ['Founder Pedestal', 'Rising Founder', 'Colossus of the Founder'], statue: ['Hero Statue'], hall: ['Longhall', 'Town Hall', 'Castle Keep'], house: ['Thatched Cottage', 'Timber House', 'Manor House'], temple: ['Wayside Chapel', 'Stone Chapel'] },
  dune: { academy: ['House of Wisdom'], wonder: ['Sun Terrace', 'Rising Pillar', 'Sun Pillar'], colossus: ['Sun Pedestal', 'Rising Sun King', 'Sun King Colossus'], statue: ['Sun Idol'], hall: ['Clay Palace', 'Domed Palace', 'Sun Citadel'], house: ['Mudbrick Hut', 'Terrace House', 'Courtyard Villa'], temple: ['Sun Shrine', 'Great Dome'], granary: ['Grain Domes'] },
  frost: { academy: ['Saga Hall'], wonder: ['Rune Ring', 'Rising Rune Tower', 'Rune Tower'], colossus: ['Jarl Pedestal', 'Rising Jarl', 'Colossus of the Jarl'], statue: ['Hero Stone'], hall: ['Mead Hall', 'Jarl Hall', 'Stone Hold'], house: ['Turf Hut', 'Stave House', 'Longhouse'], temple: ['Rune Shrine', 'Stave Temple'] },
  mire: { academy: ['Lodge of Elders'], wonder: ['Totem Mound', 'Rising Totem', 'Sky Totem'], colossus: ['Spirit Mound', 'Rising Spirit', 'Spirit Colossus'], statue: ['Ancestor Post'], hall: ['Council Lodge', 'Great Lodge', 'Canopy Palace'], house: ['Stilt Hut', 'Stilt House', 'Elder Lodge'], temple: ['Spirit Shrine', 'Step Temple'], granary: ['Rice Barn'] },
};

export function buildingLabel(b) {
  const def = BUILDING_TYPES[b.type];
  if (def?.monument && b.title) return (b.level || 1) >= 3 ? b.title : `${b.title} (stage ${b.level || 1} of 3)`;
  const per = BUILDING_LABEL[b.style]?.[b.type];
  const lv = Math.max(1, Math.min(b.level || 1, def?.levels || 1));
  return per?.[lv - 1] || def?.names?.[lv - 1] || b.type;
}

// Qadari build in sun-dried mudbrick: half the timber of other cultures.
export function costOf(type, level = 1, culture = null) {
  const def = BUILDING_TYPES[type];
  const c = def?.cost?.[Math.min(level, def.levels) - 1] || {};
  if (culture === 'dune' && c.wood) return { ...c, wood: Math.ceil(c.wood * 0.5) };
  // Hrimfolk raise fieldstone and turf walls: less timber, more stone.
  if (culture === 'frost' && c.wood) return { ...c, wood: Math.ceil(c.wood * 0.5), stone: (c.stone || 0) + Math.ceil(c.wood * 0.3) };
  return c;
}

export function canAfford(v, cost) {
  return (v.wood >= (cost.wood || 0)) && (v.stone >= (cost.stone || 0)) && (v.gold >= (cost.gold || 0));
}

export function pay(v, cost) {
  v.wood -= cost.wood || 0;
  v.stone -= cost.stone || 0;
  v.gold -= cost.gold || 0;
}
