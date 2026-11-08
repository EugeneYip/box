// Building catalogue: footprints (tiles, before rotation), costs, hit points,
// housing and build times per level. Levels are 1-based.
//
// Footprint convention: the building's front (door) faces local +Z. A
// rotation of 90° / 270° swaps the tile footprint (w <-> h).

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
  library: { names: ['Library'], w: 2, h: 2, levels: 1, hp: [160], buildTime: [30], cost: [{ wood: 18, stone: 24 }], tech: ['writing'] },
  observatory: { names: ['Observatory'], w: 2, h: 2, levels: 1, hp: [200], buildTime: [40], cost: [{ wood: 10, stone: 40, gold: 2 }], tech: ['astronomy'] },
  aqueduct: { names: ['Aqueduct'], w: 3, h: 1, levels: 1, hp: [260], buildTime: [36], cost: [{ stone: 44 }], tech: ['architecture'] },
  market: { names: ['Market'], w: 3, h: 3, levels: 1, hp: [120], buildTime: [26], cost: [{ wood: 26, stone: 10 }] },
  temple: { names: ['Shrine', 'Temple'], w: 3, h: 3, levels: 2, hp: [220, 360], buildTime: [36, 48], cost: [{ wood: 20, stone: 26 }, { wood: 20, stone: 50, gold: 3 }] },
  barracks: { names: ['Barracks'], w: 3, h: 2, levels: 1, hp: [260], buildTime: [32], cost: [{ wood: 26, stone: 22 }], banner: true },
  watchtower: { names: ['Watchtower'], w: 1, h: 1, levels: 1, hp: [150], buildTime: [16], cost: [{ wood: 12, stone: 8 }], banner: true },
  wall: { names: ['Wall'], w: 1, h: 1, levels: 1, hp: [200], buildTime: [5], cost: [{ stone: 3 }], wall: true },
  tower: { names: ['Wall Tower'], w: 1, h: 1, levels: 1, hp: [320], buildTime: [12], cost: [{ stone: 10 }], wall: true, banner: true },
  gate: { names: ['Gatehouse'], w: 1, h: 1, levels: 1, hp: [360], buildTime: [12], cost: [{ stone: 10, wood: 4 }], wall: true },
};

export const BUILDING_LABEL = {
  vale: { hall: ['Longhall', 'Town Hall', 'Castle Keep'], house: ['Thatched Cottage', 'Timber House', 'Manor House'], temple: ['Wayside Chapel', 'Stone Chapel'] },
  dune: { hall: ['Clay Palace', 'Domed Palace', 'Sun Citadel'], house: ['Mudbrick Hut', 'Terrace House', 'Courtyard Villa'], temple: ['Sun Shrine', 'Great Dome'], granary: ['Grain Domes'] },
  frost: { hall: ['Mead Hall', 'Jarl Hall', 'Stone Hold'], house: ['Turf Hut', 'Stave House', 'Longhouse'], temple: ['Rune Shrine', 'Stave Temple'] },
  mire: { hall: ['Council Lodge', 'Great Lodge', 'Canopy Palace'], house: ['Stilt Hut', 'Stilt House', 'Elder Lodge'], temple: ['Spirit Shrine', 'Step Temple'], granary: ['Rice Barn'] },
};

export function buildingLabel(b) {
  const def = BUILDING_TYPES[b.type];
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
