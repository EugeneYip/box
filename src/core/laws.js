// World Laws: player-editable rules of the simulation (game.laws).
//
// PUBLIC CONTRACT
//   game.laws[key]            current value (boolean or number)
//   game.setLaw(key, value)   change a law; persists and emits 'laws' {key, value}
//   game.resetLaws()          restore defaults; emits 'laws' {key: null}
//   LAW_CATEGORIES, LAWS      registry the UI builds its panel from
// Each law names the module that honours it (`owner`). Modules read the value
// at the point of use (no caching) so a toggle takes effect on the next tick.
// Number laws are multipliers (1 = normal) unless the description says
// otherwise. Keys are stable: never rename one, only add.
export const LAW_CATEGORIES = [
  { id: 'harmony', name: 'Harmony', blurb: 'How content and loyal the peoples are.' },
  { id: 'diplomacy', name: 'Diplomacy', blurb: 'War, peace and alliances between kingdoms.' },
  { id: 'civilization', name: 'Civilization', blurb: 'Growth, knowledge and building.' },
  { id: 'creatures', name: 'Creatures', blurb: 'The lives of people and animals.' },
  { id: 'beasts', name: 'Beasts', blurb: 'Predators and monsters of the wilds.' },
  { id: 'spawning', name: 'Spawning', blurb: 'What appears in the world by itself.' },
  { id: 'trees', name: 'Trees', blurb: 'Forests and woodland.' },
  { id: 'plants', name: 'Plants', blurb: 'Grass, flowers, bushes and crops.' },
  { id: 'fungi', name: 'Fungi', blurb: 'Mushrooms and damp-loving growth.' },
  { id: 'biomes', name: 'Biomes', blurb: 'How the land itself changes.' },
  { id: 'weather', name: 'Weather & Time', blurb: 'Sky, seasons and the passing of days.' },
  { id: 'calamities', name: 'Calamities', blurb: 'Fire, plague and disaster.' },
  { id: 'ages', name: 'Ages', blurb: 'The great eras that sweep over the world.' },
  { id: 'others', name: 'Others', blurb: 'Everything else.' },
];

const B = (key, category, label, description, def, owner) => ({ key, category, label, description, type: 'bool', default: def, owner });
const N = (key, category, label, description, def, min, max, step, owner) => ({ key, category, label, description, type: 'number', default: def, min, max, step, owner });

export const LAWS = [
  // ---- Harmony -----------------------------------------------------------
  B('civRebellions', 'harmony', 'Rebellions', 'Unrest can spark open rebellion against the crown.', true, 'civ'),
  B('harmonySecession', 'harmony', 'Breakaway villages', 'Distant, discontented villages may declare independence.', true, 'civ'),
  B('harmonyMigration', 'harmony', 'Migration', 'Hungry or unhappy villagers leave in search of better lands.', true, 'civ'),
  B('harmonyUnrest', 'harmony', 'Hardship breeds unrest', 'Famine, plague and heavy war losses stir discontent.', true, 'civ'),
  N('harmonyLoyalty', 'harmony', 'Loyalty', 'Higher keeps villages loyal to their kingdom.', 1, 0.25, 3, 0.25, 'civ'),
  // ---- Diplomacy -------------------------------------------------------------
  B('civWars', 'diplomacy', 'Wars', 'Kingdoms may declare war and march armies.', true, 'civ'),
  B('civDiplomacy', 'diplomacy', 'Alliances', 'Friendly kingdoms forge alliances and fight side by side.', true, 'civ'),
  B('diploPeace', 'diplomacy', 'Peace treaties', 'War-weary kingdoms sue for peace.', true, 'civ'),
  B('diploCultureFriction', 'diplomacy', 'Cultural rivalry', 'Kingdoms of different cultures distrust one another.', true, 'civ'),
  N('diploWarlike', 'diplomacy', 'Warmongering', 'How eager rulers are to start wars.', 1, 0, 3, 0.25, 'civ'),
  // ---- Civilization -------------------------------------------------------------
  B('civExpansion', 'civilization', 'Settlers', 'Villages send settlers to found new villages.', true, 'civ'),
  B('civNewKingdoms', 'civilization', 'New kingdoms', 'Far-flung settlements may crown rulers of their own.', true, 'civ'),
  N('civGrowth', 'civilization', 'Birth rate', 'How quickly villages grow.', 1, 0.25, 3, 0.25, 'civ'),
  B('civTechnology', 'civilization', 'Knowledge', 'Kingdoms research technologies and advance through eras.', true, 'civ'),
  N('civTechSpeed', 'civilization', 'Research speed', 'How quickly kingdoms gain knowledge.', 1, 0.25, 4, 0.25, 'civ'),
  B('civRoads', 'civilization', 'Roads', 'Villages pave paths between their buildings and neighbours.', true, 'civ'),
  B('civWalls', 'civilization', 'Fortifications', 'Cities raise walls, gates and watchtowers.', true, 'civ'),
  // ---- Creatures -------------------------------------------------------------
  B('lifeHunger', 'creatures', 'Hunger', 'Creatures must eat to survive.', true, 'life'),
  B('lifeAging', 'creatures', 'Old age', 'Creatures grow old and pass away.', true, 'life'),
  N('lifeLifespan', 'creatures', 'Lifespan', 'How long creatures live.', 1, 0.5, 3, 0.25, 'life'),
  B('lifeTraits', 'creatures', 'Traits', 'Creatures are born with traits and earn new ones through life.', true, 'life'),
  B('lifeInheritance', 'creatures', 'Inheritance', 'Children inherit traits from their parents, with rare mutations.', true, 'life'),
  B('lifeExperience', 'creatures', 'Experience', 'Creatures level up from battles and hard work.', true, 'life'),
  B('lifeEquipment', 'creatures', 'Equipment', 'Smiths forge tools, weapons and armour for their people.', true, 'life'),
  // ---- Beasts -------------------------------------------------------------
  B('lifePredators', 'beasts', 'Predators', 'Wolves, bears and foxes hunt.', true, 'life'),
  B('beastsHuntPeople', 'beasts', 'Beasts attack people', 'Predators and monsters may attack villagers.', true, 'life'),
  B('beastsMonsters', 'beasts', 'Wandering monsters', 'Monsters occasionally emerge from the deep wilds.', false, 'life'),
  N('beastsFerocity', 'beasts', 'Ferocity', 'How strong and aggressive beasts are.', 1, 0.5, 3, 0.25, 'life'),
  // ---- Spawning -------------------------------------------------------------
  B('lifeWildlife', 'spawning', 'Wildlife', 'Wild animals breed and migrate in from the wilds.', true, 'life'),
  B('spawnWanderers', 'spawning', 'Wanderers', 'Small bands of people sometimes arrive on empty fertile land.', false, 'civ'),
  B('spawnAmbient', 'spawning', 'Fish and birds', 'Schools of fish and flocks of birds fill the seas and skies.', true, 'life'),
  N('spawnRate', 'spawning', 'Spawn rate', 'How often wildlife appears.', 1, 0.25, 3, 0.25, 'life'),
  // ---- Trees -------------------------------------------------------------
  B('treesSpread', 'trees', 'Forests spread', 'Mature trees seed the land around them.', true, 'nature'),
  N('treesGrowSpeed', 'trees', 'Tree growth', 'How fast saplings become trees.', 1, 0.25, 4, 0.25, 'nature'),
  N('treesDensity', 'trees', 'Forest density', 'How thick forests can grow.', 1, 0.25, 2, 0.25, 'nature'),
  // ---- Plants -------------------------------------------------------------
  B('natureGrowth', 'plants', 'Plant growth', 'Plants grow and mature.', true, 'nature'),
  B('plantsSpread', 'plants', 'Wildflowers and bushes', 'Flowers, bushes and berries spread across meadows.', true, 'nature'),
  N('plantsCrops', 'plants', 'Harvest bounty', 'How fast crops ripen in the fields.', 1, 0.25, 3, 0.25, 'nature'),
  // ---- Fungi -------------------------------------------------------------
  B('fungiSpread', 'fungi', 'Mushrooms spread', 'Fungi creep through damp forests and swamps.', true, 'nature'),
  B('fungiGlow', 'fungi', 'Glowing mushrooms', 'Some fungi glow softly at night.', true, 'nature'),
  // ---- Biomes -------------------------------------------------------------
  B('natureRegrowth', 'biomes', 'Healing land', 'Burnt ground slowly turns green again.', true, 'nature'),
  B('biomeShift', 'biomes', 'Living biomes', 'Biomes slowly shift with the climate: forests advance, deserts creep, snow retreats.', true, 'nature'),
  N('biomeFrost', 'biomes', 'Frost reach', 'How far snow and ice reach down mountains and toward the poles.', 1, 0.5, 2, 0.25, 'landscape'),
  // ---- Weather & Time -------------------------------------------------------------
  B('skyDayNight', 'weather', 'Day and night', 'The sun rises and sets.', true, 'core'),
  N('skyDaySpeed', 'weather', 'Day length', 'Higher is a faster day-night cycle.', 1, 0.25, 4, 0.25, 'core'),
  B('weatherSeasons', 'weather', 'Seasons', 'Spring, summer, autumn and winter turn across the years.', true, 'core'),
  N('weatherSeasonLength', 'weather', 'Season length', 'Years each season lasts. Seasons here are long: lower it for a quicker turn of the year, raise it for epic winters.', 12, 3, 24, 1, 'core'),
  B('skyWeather', 'weather', 'Changing weather', 'Rain, storms and snow come and go by themselves.', true, 'atmosphere'),
  N('weatherStorms', 'weather', 'Storminess', 'How often storms gather.', 1, 0, 3, 0.25, 'atmosphere'),
  // ---- Calamities -------------------------------------------------------------
  B('calamityNatural', 'calamities', 'Natural disasters', 'Earthquakes, tornadoes, meteors and eruptions strike at random.', false, 'effects'),
  N('calamityFrequency', 'calamities', 'Disaster frequency', 'How often random disasters strike.', 1, 0.25, 4, 0.25, 'effects'),
  B('calamityPlague', 'calamities', 'Contagion', 'Plague spreads between people.', true, 'effects'),
  B('calamityLightning', 'calamities', 'Lightning fires', 'Storm lightning can set the land alight.', true, 'effects'),
  B('natureFireSpread', 'calamities', 'Spreading fire', 'Flames spread to neighbouring land.', true, 'effects'),
  B('natureLavaFlow', 'calamities', 'Flowing lava', 'Lava runs downhill and cools to stone.', true, 'effects'),
  // ---- Ages -------------------------------------------------------------
  B('ageCycle', 'ages', 'Turning ages', 'Great ages change by themselves over the centuries.', true, 'core'),
  N('ageLength', 'ages', 'Age length', 'How long each age endures.', 1, 0.25, 4, 0.25, 'core'),
  N('ageIntensity', 'ages', 'Age intensity', 'How strongly an age shapes the world.', 1, 0, 2, 0.25, 'core'),
  // ---- Others -------------------------------------------------------------
  B('miscRuins', 'others', 'Lasting ruins', 'Destroyed buildings leave ruins that slowly crumble away.', true, 'civ'),
  B('miscMinorEvents', 'others', 'Minor chronicle events', 'Record births of heroes, legendary items and other small events.', true, 'ui'),
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
