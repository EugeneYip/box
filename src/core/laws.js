// World Laws: player-editable rules of the simulation (game.laws).
//
// PUBLIC CONTRACT
//   game.laws[key]            current value (boolean or number)
//   game.setLaw(key, value)   change a law; persists and emits 'laws' {key, value}
//   game.resetLaws()          restore defaults; emits 'laws' {key: null}
//   LAW_CATEGORIES, LAWS      registry the UI builds its panel from
// Modules read the value at the point of use (no caching), so a toggle takes
// effect on the next tick. Number laws are multipliers unless noted.
export const LAW_CATEGORIES = [
  { id: 'peoples', name: 'Peoples' },
  { id: 'life', name: 'Life' },
  { id: 'nature', name: 'Nature' },
  { id: 'sky', name: 'Sky & Time' },
  { id: 'calamity', name: 'Calamities' },
];

export const LAWS = [
  // Peoples (Civilization)
  { key: 'civExpansion', category: 'peoples', label: 'Settlers', description: 'Villages send settlers to found new villages.', type: 'bool', default: true },
  { key: 'civWars', category: 'peoples', label: 'Wars', description: 'Kingdoms may declare war and march armies.', type: 'bool', default: true },
  { key: 'civRebellions', category: 'peoples', label: 'Rebellions', description: 'Unrest can spark rebellions and secession.', type: 'bool', default: true },
  { key: 'civDiplomacy', category: 'peoples', label: 'Diplomacy', description: 'Kingdoms forge alliances and sign peace.', type: 'bool', default: true },
  { key: 'civGrowth', category: 'peoples', label: 'Birth rate', description: 'How quickly villages grow.', type: 'number', default: 1, min: 0.25, max: 3, step: 0.25 },
  // Life (creatures)
  { key: 'lifeWildlife', category: 'life', label: 'Wildlife', description: 'Wild animals breed and migrate in from the wilds.', type: 'bool', default: true },
  { key: 'lifePredators', category: 'life', label: 'Predators', description: 'Wolves, bears and foxes hunt.', type: 'bool', default: true },
  { key: 'lifeHunger', category: 'life', label: 'Hunger', description: 'Creatures must eat to survive.', type: 'bool', default: true },
  { key: 'lifeAging', category: 'life', label: 'Old age', description: 'Creatures grow old and pass away.', type: 'bool', default: true },
  // Nature
  { key: 'natureGrowth', category: 'nature', label: 'Plant growth', description: 'Plants grow and forests spread.', type: 'bool', default: true },
  { key: 'natureRegrowth', category: 'nature', label: 'Healing land', description: 'Burnt ground slowly turns green again.', type: 'bool', default: true },
  { key: 'natureFireSpread', category: 'nature', label: 'Spreading fire', description: 'Flames spread to neighbouring land.', type: 'bool', default: true },
  { key: 'natureLavaFlow', category: 'nature', label: 'Flowing lava', description: 'Lava runs downhill and cools to stone.', type: 'bool', default: true },
  // Sky & Time (Atmosphere / core)
  { key: 'skyDayNight', category: 'sky', label: 'Day and night', description: 'The sun rises and sets.', type: 'bool', default: true },
  { key: 'skyDaySpeed', category: 'sky', label: 'Day length', description: 'Higher is a faster day-night cycle.', type: 'number', default: 1, min: 0.25, max: 4, step: 0.25 },
  { key: 'skyWeather', category: 'sky', label: 'Changing weather', description: 'Rain, storms and snow come and go by themselves.', type: 'bool', default: true },
  // Calamities (Effects & Disasters)
  { key: 'calamityNatural', category: 'calamity', label: 'Natural disasters', description: 'Earthquakes, tornadoes, meteors and eruptions strike at random.', type: 'bool', default: false },
  { key: 'calamityFrequency', category: 'calamity', label: 'Disaster frequency', description: 'How often random disasters strike.', type: 'number', default: 1, min: 0.25, max: 4, step: 0.25 },
  { key: 'calamityPlague', category: 'calamity', label: 'Contagion', description: 'Plague spreads between people.', type: 'bool', default: true },
  { key: 'calamityLightning', category: 'calamity', label: 'Lightning fires', description: 'Storm lightning can set the land alight.', type: 'bool', default: true },
];

const STORE_KEY = 'worldseed.laws.v1';

export function defaultLaws() {
  const out = {};
  for (const l of LAWS) out[l.key] = l.default;
  return out;
}

export function loadLaws() {
  const laws = defaultLaws();
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      for (const l of LAWS) {
        const v = saved[l.key];
        if (l.type === 'bool' && typeof v === 'boolean') laws[l.key] = v;
        if (l.type === 'number' && typeof v === 'number' && isFinite(v)) laws[l.key] = Math.min(l.max, Math.max(l.min, v));
      }
    }
  } catch {
    /* storage unavailable: defaults */
  }
  return laws;
}

export function saveLaws(laws) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(laws));
  } catch {
    /* ignore */
  }
}

export function lawDef(key) {
  return LAWS.find((l) => l.key === key) || null;
}
