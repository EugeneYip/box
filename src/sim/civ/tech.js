import { YEAR } from './util.js';

// Eras and technology. Each kingdom accumulates knowledge (population,
// temples, libraries, observatories, wise rulers, Scholarly culture), scaled
// by the civTechSpeed law and the age's techRate, and researches one
// technology at a time, choosing by its culture's leanings. Two technologies
// of an era carry the kingdom into it, which shows in its architecture.
//
// API (on game.civ): hasTech(kingdomId, techId), kingdomEra(kingdomId),
//   ERAS, TECHS, techById, kingdom fields {knowledge, techs:Set, era, researching}.

export const ERAS = [
  { id: 0, name: 'Hearth', description: 'Thatch, timber and the first fields.' },
  { id: 1, name: 'Bronze', description: 'Stone footings, fired tile and bronze blades.' },
  { id: 2, name: 'Iron', description: 'Slate, stone towers and iron arms.' },
  { id: 3, name: 'Enlightened', description: 'Dressed stone, glass windows and learning.' },
  // modern and future eras (docs/MODERN-ERAS.md)
  { id: 4, name: 'Industrial', description: 'Brick, iron and glass; chimneys and smoke.' },
  { id: 5, name: 'Modern', description: 'Concrete, steel and electric light; streets lit at night.' },
  { id: 6, name: 'Atomic', description: 'Glass towers, highways and airports.' },
  { id: 7, name: 'Future', description: 'Arcologies, green towers and clean light.' },
];
// The art a realm must know to enter an era (with any second one of that era).
export const ERA_KEY = { 1: 'bronzeworking', 2: 'ironworking', 4: 'steampower', 5: 'electricity', 6: 'computing', 7: 'fusion' };
export const LAST_ERA = ERAS.length - 1;

// `unlocks` lists, in plain words, what each technology adds to the world
// (the tech panel and tooltips show it); `builds` are the building types it
// permits (Civ); vehicles listed are run by the Fleets module.
export const TECHS = [
  // Hearth
  { id: 'agriculture', name: 'Agriculture', era: 0, cost: 60, requires: [], description: 'Plows and seed-saving: richer harvests.', effects: { harvest: 1.15 }, unlocks: ['Plowed field rows', 'Farmstead barns'], builds: ['barn'] },
  { id: 'masonry', name: 'Masonry', era: 0, cost: 70, requires: [], description: 'Cut stone for footings and walls.', effects: { stone: 1.2 }, unlocks: ['Stone footings and stone houses', 'A paved village square', 'Sturdier, fire-resistant buildings'], builds: ['plaza'] },
  { id: 'pottery', name: 'Pottery', era: 0, cost: 60, requires: [], description: 'Fired jars keep grain longer.', effects: { foodCap: 1.25 }, unlocks: ['Kilns', 'Granaries full of jars'], builds: ['kiln'] },
  { id: 'fishing', name: 'Fishing', era: 0, cost: 55, requires: [], description: 'Nets and weirs fill the larder.', effects: { fish: 1.3 }, unlocks: ['Fishing jetties', 'Fishing boats over the shoals'], builds: ['docks'] },
  { id: 'wheel', name: 'The Wheel', era: 0, cost: 80, requires: ['agriculture'], description: 'Axles and spoked wheels: ox carts carry the harvest.', effects: { work: 1.03 }, unlocks: ['Ox carts hauling wood, stone, food and ore between villages'] },
  // Bronze
  { id: 'bronzeworking', name: 'Bronzeworking', era: 1, cost: 210, requires: ['masonry'], description: 'Bronze tools and blades.', effects: { material: 'bronze', work: 1.08 }, unlocks: ['A forge with a glowing hearth', 'Bronze arms and tools'] },
  { id: 'sailing', name: 'Sailing', era: 1, cost: 200, requires: ['fishing'], description: 'Harbors and sea-going ships.', effects: { fish: 1.2 }, unlocks: ['Harbors', 'Trading cogs between friendly ports', 'Transport ships for settlers and armies'], builds: ['harbour'] },
  { id: 'writing', name: 'Writing', era: 1, cost: 220, requires: ['pottery'], description: 'Scribes and libraries.', effects: { research: 1.15 }, unlocks: ['Libraries', 'Scribes carrying scrolls'], builds: ['library'] },
  { id: 'irrigation', name: 'Irrigation', era: 1, cost: 190, requires: ['agriculture'], description: 'Channels water the fields.', effects: { harvest: 1.15 }, unlocks: ['Irrigation channels beside the fields', 'Water wheels'], builds: ['waterwheel'] },
  { id: 'horsemanship', name: 'Horsemanship', era: 1, cost: 180, requires: ['agriculture'], description: 'Riders carry news and armies further.', effects: { march: 1.15 }, unlocks: ['Stables', 'Mounted messengers on the roads', 'Cavalry'], builds: ['stables'] },
  // Iron
  { id: 'ironworking', name: 'Ironworking', era: 2, cost: 520, requires: ['bronzeworking'], description: 'Iron arms and armor.', effects: { material: 'iron', work: 1.08 }, unlocks: ['A smoking bloomery', 'Iron arms and armor'], builds: ['bloomery'] },
  { id: 'fortification', name: 'Fortification', era: 2, cost: 480, requires: ['masonry', 'bronzeworking'], description: 'Curtain walls, gates and towers.', effects: { walls: true }, unlocks: ['Town walls and gatehouses', 'Watchtowers whose archers shoot at raiders'], builds: ['walls'] },
  { id: 'medicine', name: 'Medicine', era: 2, cost: 460, requires: ['writing'], description: 'Healers: more children live to grow up.', effects: { birth: 1.2 }, unlocks: ["A healer's house with an herb garden", 'Healers who tend the sick and wounded'], builds: ['healer'] },
  { id: 'mathematics', name: 'Mathematics', era: 2, cost: 470, requires: ['writing'], description: 'Numbers speed every inquiry.', effects: { research: 1.15 }, unlocks: ["Surveyors' straight roads linking the realm's villages"] },
  { id: 'architecture', name: 'Architecture', era: 2, cost: 500, requires: ['masonry', 'mathematics'], description: 'Arches, aqueducts and grand halls.', effects: { build: 1.15 }, unlocks: ['Aqueducts', 'Stone bridges over rivers'], builds: ['aqueduct', 'bridge'] },
  { id: 'shipbuilding', name: 'Shipbuilding', era: 2, cost: 560, requires: ['sailing', 'ironworking'], description: 'Keels and ribs on the slipway: ships of war.', effects: { fish: 1.05 }, unlocks: ['A shipyard slipway with a hull on the stocks', 'War galleys'], builds: ['shipyard'] },
  { id: 'siegecraft', name: 'Siegecraft', era: 2, cost: 540, requires: ['fortification', 'mathematics'], description: 'Rams and catapults to break walls.', effects: { siege: 1.6 }, unlocks: ['Battering rams and catapults with the armies'] },
  // Enlightened
  { id: 'steelworking', name: 'Steelworking', era: 3, cost: 1000, requires: ['ironworking'], description: 'Steel: the finest blades.', effects: { material: 'steel' }, unlocks: ['A foundry', 'Steel arms and armor'], builds: ['foundry'] },
  { id: 'philosophy', name: 'Philosophy', era: 3, cost: 900, requires: ['mathematics', 'medicine'], description: 'Wise laws keep provinces loyal.', effects: { loyalty: 7 }, unlocks: ['A forum where citizens gather'], builds: ['forum'] },
  { id: 'banking', name: 'Banking', era: 3, cost: 940, requires: ['mathematics'], description: 'Coin works harder: markets prosper.', effects: { gold: 1.5 }, unlocks: ['A market hall with stalls and a counting house', 'Trade caravans between realms at peace'], builds: ['markethall'] },
  { id: 'engineering', name: 'Engineering', era: 3, cost: 960, requires: ['architecture'], description: 'Cranes and mills: faster building.', effects: { build: 1.25 }, unlocks: ['Watermills on the rivers', 'Cranes over building sites'], builds: ['watermill'] },
  { id: 'astronomy', name: 'Astronomy', era: 3, cost: 920, requires: ['mathematics', 'sailing'], description: 'Star charts and observatories.', effects: { research: 1.1 }, unlocks: ['Observatories', 'Exploration ships that chart the world'], builds: ['observatory'] },
  { id: 'navigation', name: 'Navigation', era: 3, cost: 1050, requires: ['astronomy', 'shipbuilding'], description: 'Compass and charts: ships cross the open ocean.', effects: { research: 1.03 }, unlocks: ['Great carracks for ocean trade and overseas colonies'] },
  // Industrial (docs/MODERN-ERAS.md). The costs and MOMENTUM set the pacing:
  // on a Medium map at the default research speed the first realm reaches the
  // Industrial era around Year 200-260, Modern 300-360, Atomic 400-460 and
  // Future after 500. An era's first arts are the dearest (the first steps
  // into a new age come slowly); each one learned speeds the rest of its era.
  { id: 'gunpowder', name: 'Gunpowder', era: 4, cost: 33800, requires: ['steelworking', 'engineering'], description: 'Powder and shot: muskets and cannon.', effects: { siegeFire: 1.5 }, unlocks: ['Musketeers with smoking muskets', 'Cannon in place of catapults', 'Star-shaped bastions on town walls'] },
  { id: 'steampower', name: 'Steam Power', era: 4, cost: 32500, requires: ['engineering', 'navigation'], description: 'Boilers and pistons: ships leave the wind behind.', effects: { work: 1.05 }, unlocks: ['Steamships for trade and transport, trailing smoke'] },
  { id: 'railways', name: 'Railways', era: 4, cost: 37700, requires: ['steampower', 'architecture'], description: 'Iron rails link the towns of the realm.', effects: { march: 1.1 }, unlocks: ['Rail lines between the towns of the realm', 'Railway stations', 'Steam trains carrying goods and people'], builds: ['station'] },
  { id: 'industry', name: 'Industry', era: 4, cost: 36400, requires: ['steampower', 'banking'], description: 'Factories and their workers: production on a new scale.', effects: { work: 1.12, gold: 1.15 }, unlocks: ['Factories with smoking chimneys', "Workers' row houses", 'A haze of smoke near the factories'], builds: ['factory', 'rowhouse'] },
  { id: 'sanitation', name: 'Sanitation', era: 4, cost: 34000, requires: ['medicine', 'engineering'], description: 'Clean water and sewers: towns grow and plague retreats.', effects: { birth: 1.08 }, unlocks: ['Waterworks, sewers and public baths', 'Bigger towns', 'Far fewer deaths from plague'], builds: ['waterworks'] },
  { id: 'ironclads', name: 'Ironclads', era: 4, cost: 40300, requires: ['gunpowder', 'steampower', 'steelworking'], description: 'Armored steam warships with cannon.', effects: {}, unlocks: ['Ironclad steam warships with cannon'] },
  // Modern
  { id: 'electricity', name: 'Electricity', era: 5, cost: 52800, requires: ['industry'], description: 'Power stations light the streets and drive the machines.', effects: { work: 1.1, research: 1.1 }, unlocks: ['Power stations', 'Pylons and power lines to the towns', 'Street lights and lit windows at night'], builds: ['powerstation', 'pylon'] },
  { id: 'combustion', name: 'Combustion Engine', era: 5, cost: 55200, requires: ['industry', 'railways'], description: 'Engines on the roads and at sea.', effects: { work: 1.04 }, unlocks: ['Trucks and cars on the roads', 'Motor freighters at sea'] },
  { id: 'flight', name: 'Flight', era: 5, cost: 60000, requires: ['combustion'], description: 'Wings of canvas and wire.', effects: { march: 1.05 }, unlocks: ['Airfields', 'Mail and transport planes between towns', 'Biplanes that scout and strafe in war'], builds: ['airfield'] },
  { id: 'radio', name: 'Radio', era: 5, cost: 54000, requires: ['electricity'], description: 'Voices through the air: news and treaties travel fast.', effects: { research: 1.04, diplomacy: 1.6 }, unlocks: ['Radio masts with blinking lights', 'Faster diplomacy; allies answer sooner'], builds: ['radiomast'] },
  { id: 'concrete', name: 'Reinforced Concrete', era: 5, cost: 52800, requires: ['industry', 'architecture'], description: 'Steel and concrete: towns grow upward.', effects: { build: 1.1 }, unlocks: ['Apartment blocks', 'Taller, larger towns on the same land'], builds: ['apartment'] },
  { id: 'battleships', name: 'Battleships', era: 5, cost: 62400, requires: ['ironclads', 'electricity'], description: 'Steel turrets at sea, armor on land.', effects: { siegeFire: 1.2 }, unlocks: ['Steel battleships with turrets', 'Tanks and artillery with the armies'] },
  // Atomic
  { id: 'jets', name: 'Jet Engines', era: 6, cost: 112000, requires: ['flight', 'electricity'], description: 'Jets cross the world in hours.', effects: { gold: 1.1 }, unlocks: ['Airports with runways', 'Jet airliners between realms at peace', 'Jet fighters in war'], builds: ['airport'] },
  { id: 'rocketry', name: 'Rocketry', era: 6, cost: 124800, requires: ['jets', 'radio'], description: 'Rockets climb to orbit.', effects: { research: 1.03 }, unlocks: ['Launch pads', 'Rockets lifting off on plumes of fire', 'Satellites crossing the night sky, each one speeding research'], builds: ['launchpad'] },
  { id: 'computing', name: 'Computing', era: 6, cost: 115200, requires: ['radio', 'concrete'], description: 'Thinking machines speed every inquiry.', effects: { research: 1.3 }, unlocks: ['Research campuses', 'Glowing screens in the windows'], builds: ['campus'] },
  { id: 'containers', name: 'Container Shipping', era: 6, cost: 108800, requires: ['combustion', 'concrete'], description: 'Boxes by the thousand: bulk sea trade.', effects: { gold: 1.15 }, unlocks: ['Container ships', 'Ports with gantry cranes and stacked containers'], builds: ['containerport'] },
  { id: 'skyscrapers', name: 'Skyscrapers', era: 6, cost: 112000, requires: ['concrete', 'electricity'], description: 'Towers of steel and glass at the heart of the city.', effects: { build: 1.05 }, unlocks: ['High-rise towers at city centers', 'Larger cities'], builds: ['skyscraper'] },
  { id: 'carriers', name: 'Carriers', era: 6, cost: 124800, requires: ['battleships', 'jets'], description: 'Floating airfields.', effects: {}, unlocks: ['Aircraft carriers that launch and recover jets'] },
  { id: 'nuclear', name: 'Nuclear Power', era: 6, cost: 128000, requires: ['electricity', 'computing'], description: 'Power from the atom, and never its weapons.', effects: { work: 1.2 }, unlocks: ['Power plants with cooling towers and steam', 'A large boost to work'], builds: ['nuclear'] },
  // Future
  { id: 'fusion', name: 'Fusion', era: 7, cost: 210000, requires: ['nuclear'], description: 'A star in a bottle: clean, boundless power.', effects: { work: 1.12, birth: 1.08 }, unlocks: ['Fusion plants with a glowing ring', 'The factory haze clears'], builds: ['fusion'] },
  { id: 'maglev', name: 'Maglev', era: 7, cost: 220000, requires: ['railways', 'fusion'], description: 'Trains that float above their rails.', effects: { march: 1.1, gold: 1.05 }, unlocks: ['Elevated maglev lines between cities', 'Sleek maglev trains'] },
  { id: 'robotics', name: 'Robotics', era: 7, cost: 200000, requires: ['computing'], description: 'Machines that build and carry.', effects: { build: 1.25, work: 1.08 }, unlocks: ['Delivery drones over the towns', 'Robot workers'] },
  { id: 'vtol', name: 'VTOL Transport', era: 7, cost: 220000, requires: ['jets', 'robotics'], description: 'Craft that rise straight up.', effects: { march: 1.05 }, unlocks: ['Sky taxis and VTOL transports between towns'] },
  { id: 'arcology', name: 'Arcology', era: 7, cost: 230000, requires: ['skyscrapers', 'fusion'], description: 'Whole cities in one green tower.', effects: { foodCap: 1.2 }, unlocks: ['Arcologies: vast green tower-cities', 'Very large cities'], builds: ['arcology'] },
  { id: 'orbital', name: 'Orbital Industry', era: 7, cost: 240000, requires: ['rocketry', 'fusion'], description: 'Factories and harbors in orbit.', effects: { research: 1.12, gold: 1.25 }, unlocks: ['A spaceport where reusable rockets land', 'An orbital station in the sky'], builds: ['spaceport'] },
  { id: 'starships', name: 'Starships', era: 7, cost: 270000, requires: ['orbital', 'arcology'], description: 'Colony ships for the stars.', effects: { research: 1.05 }, unlocks: ['Colony starships launched to the stars'] },
];

export const techById = Object.fromEntries(TECHS.map((t) => [t.id, t]));
// mean cost of each era's arts (the research choice weighs a modern art
// against its own era's price)
const ERA_COST = {};
for (let e = 0; e <= LAST_ERA; e++) {
  const L = TECHS.filter((t) => t.era === e);
  ERA_COST[e] = L.length ? L.reduce((a, t) => a + t.cost, 0) / L.length : 1000;
}
// Once a realm knows every art up to the Enlightened era, this share of its
// learning refines those arts (Mastery: statues, gilded halls, academies)
// while the rest goes into the modern arts.
const MASTERY_SHARE = 0.3;
// Each art a realm knows of a modern era speeds its study of that era's
// others by this much (the first steps into an age are slow, the rest
// quick), and each modern art it knows at all speeds every later one a
// little (CARRY). Tuned against in-browser Medium runs (the headless
// census researches about twice as fast as the full game).
const MOMENTUM = 2;
const CARRY = 0.3;

// Extra research on big maps (planner _bigMap: none on Medium): their realms
// stay small and far apart, and on their own reached the Enlightened arts
// late in the first century or not at all (Japan lacked 9 of 23 at Year 100).
const BIG_RESEARCH = 0.6;
// In an age of learning, each realm in touch adds this much (per point of
// the age's extra research rate, up to five realms).
const LORE_EXCHANGE = 0.025;

// Research leanings of culture traits.
const LEANINGS = {
  Seafaring: ['fishing', 'sailing', 'astronomy', 'shipbuilding', 'navigation', 'steampower', 'ironclads', 'containers', 'carriers'],
  Martial: ['bronzeworking', 'horsemanship', 'ironworking', 'fortification', 'steelworking', 'siegecraft', 'gunpowder', 'ironclads', 'battleships', 'carriers'],
  Scholarly: ['writing', 'mathematics', 'philosophy', 'astronomy', 'radio', 'computing', 'rocketry', 'orbital'],
  Pastoral: ['agriculture', 'irrigation', 'medicine', 'sanitation', 'fusion', 'arcology'],
  Mystic: ['pottery', 'medicine', 'philosophy', 'astronomy', 'rocketry', 'starships'],
  Mercantile: ['pottery', 'sailing', 'banking', 'wheel', 'industry', 'railways', 'containers', 'jets'],
  Masons: ['masonry', 'architecture', 'engineering', 'fortification', 'concrete', 'skyscrapers', 'arcology'],
  Wanderers: ['horsemanship', 'fishing', 'agriculture', 'wheel', 'navigation', 'railways', 'combustion', 'flight', 'vtol'],
};
// Leanings matter less among the modern arts: their costs differ by
// thousands, and a leaning must not keep a realm from its key technology.

export const tech = {
  // The latest era realms may reach (World Law civEraCap, default Future).
  eraCap() {
    const v = Math.round(this.law('civEraCap', LAST_ERA));
    return Number.isFinite(v) ? Math.max(0, Math.min(LAST_ERA, v)) : LAST_ERA;
  },
  hasTech(kid, techId) {
    const k = this.kingdoms[kid];
    return !!(k && k.techs && k.techs.has(techId));
  },
  kingdomEra(kid) {
    return this.kingdoms[kid]?.era ?? 0;
  },
  eraName(kid) {
    return ERAS[this.kingdomEra(kid)]?.name || 'Hearth';
  },
  // Combined multiplier of a technology effect across a kingdom's learning.
  techMod(kid, key) {
    const k = this.kingdoms[kid];
    if (!k?.techs) return 1;
    let m = key === 'work' || key === 'harvest' || key === 'build' ? 1 + Math.min(0.5, (k.mastery || 0) * 0.03) : 1;
    for (const id of k.techs) {
      const e = techById[id]?.effects;
      if (e && typeof e[key] === 'number') m *= e[key];
    }
    if (k.wonderFx?.[key]) m *= k.wonderFx[key];
    return m;
  },
  techAdd(kid, key) {
    const k = this.kingdoms[kid];
    if (!k?.techs) return 0;
    let a = 0;
    for (const id of k.techs) {
      const e = techById[id]?.effects;
      if (e && typeof e[key] === 'number') a += e[key];
    }
    if (k.wonderFx?.[key + '+']) a += k.wonderFx[key + '+'];
    return a;
  },
  // Best weapon/armour material the kingdom can forge.
  bestMaterial(kid) {
    if (this.hasTech(kid, 'steelworking')) return 'steel';
    if (this.hasTech(kid, 'ironworking')) return 'iron';
    if (this.hasTech(kid, 'bronzeworking')) return 'bronze';
    return this.hasTech(kid, 'masonry') ? 'stone' : 'wood';
  },

  masteryCost(k) {
    return Math.round(1400 * Math.pow(1.35, k.mastery || 0));
  },
  researchLabel(k) {
    if (!k?.researching) return null;
    if (k.researching === 'mastery') return { name: `Mastery ${(k.mastery || 0) + 1}`, cost: this.masteryCost(k) };
    const t = techById[k.researching];
    return t ? { name: t.name, cost: t.cost } : null;
  },

  _initTech(k) {
    k.knowledge = 0;
    k.techs = k.techs instanceof Set ? k.techs : new Set();
    k.era = k.era || 0;
    k.researching = null;
  },

  _availableTechs(k) {
    const known = k.techs;
    const inEra = (e) => TECHS.filter((t) => t.era === e && known.has(t.id)).length;
    // (the World Law civEraCap holds every realm at the chosen era)
    const maxEra = Math.min(this.eraCap(), k.era + (inEra(k.era) >= 3 || (k.era > 0 && inEra(k.era) >= 2) ? 1 : 0));
    return TECHS.filter((t) => !known.has(t.id) && t.era <= maxEra && t.requires.every((r) => known.has(r)));
  },

  // How strongly a realm is drawn to the sea (0..1): its share of coastal
  // towns, on a big map (the World Map's regions, Taiwan an island map) or
  // when its homeland is an island (under a sixth of the world's land).
  // A Medium continent's realms keep their old pace to Sailing.
  _seaPull(k) {
    let lean = this._bigMap();
    if (lean < 1) {
      const cap = this.villages[k.capital];
      const home = cap ? this._landSizes.get(cap.landId) || 0 : 0;
      let land = 0;
      for (const n of this._landSizes.values()) land += n;
      if (home > 0 && home < land / 6) lean = 1;
    }
    if (!lean) return 0;
    let n = 0,
      c = 0;
    for (const vid of k.villages) {
      const v = this.villages[vid];
      if (!v?.alive) continue;
      n++;
      if (v.coastal) c++;
    }
    return n ? (lean * c) / n : 0;
  },

  // Realms in contact (borders, near neighbours, allies): kingdom id -> the
  // living realms it is in touch with, rebuilt every research tick. On a big
  // map a tech a neighbour already knows comes more easily; in an age of
  // learning (Lore) every court gains by its scholars' letters.
  _contactLore() {
    const out = new Map();
    for (const r of this.relations.values()) {
      if (!r.contact && !r.ally) continue;
      const A = this.kingdoms[r.a],
        B = this.kingdoms[r.b];
      if (!A?.alive || !B?.alive || !A.techs || !B.techs) continue;
      (out.get(A.id) || out.set(A.id, []).get(A.id)).push(B);
      (out.get(B.id) || out.set(B.id, []).get(B.id)).push(A);
    }
    return out;
  },

  _chooseResearch(k) {
    let opts = this._availableTechs(k);
    if (!opts.length) return null;
    // the old arts first: no modern art while one up to the Enlightened era
    // is still to learn (round 13's pacing of eras 0-3 stays as it was)
    if (opts.some((t) => t.era <= 3)) opts = opts.filter((t) => t.era <= 3);
    const traits = this.cultureDef(k.culture)?.traits || [];
    // a realm of harbours and islands takes to the sea first (an island
    // map's realms reached the Iron era without Sailing)
    const sea = opts.some((t) => t.id === 'fishing' || t.id === 'sailing') ? this._seaPull(k) : 0;
    let best = null,
      bs = -Infinity;
    for (const t of opts) {
      // the modern arts cost tens of thousands: weigh them against their
      // era's own price, prefer the realm's own era and its key art
      let s = t.era >= 4 ? -(t.cost / ERA_COST[t.era]) * 12 - Math.max(0, t.era - k.era) * 4 + (ERA_KEY[k.era + 1] === t.id ? 2 : 0) : -t.cost / 100;
      s += this.rng.next() * 1.5;
      for (const tr of traits) if (LEANINGS[tr]?.includes(t.id)) s += 2.5;
      if (sea > 0.3 && (t.id === 'fishing' || t.id === 'sailing')) s += 1 + sea * 2;
      if (t.era < k.era) s += 1; // catch up on the basics first
      if (s > bs) {
        bs = s;
        best = t;
      }
    }
    return best.id;
  },

  // Called every 2 s.
  _researchTick(dt) {
    if (!this.law('civTechnology') && !this.kingdoms.some((k) => k.policy?.technology)) return;
    const g = this.game;
    const ageRate = g.age?.mods?.techRate ?? 1;
    const speed = this.law('civTechSpeed', 1) * ageRate;
    const big = this._bigMap();
    // an age of learning: knowledge spreads between the courts (any map)
    const spread = Math.max(0, ageRate - 1);
    const lore = big > 0 || spread > 0 ? this._contactLore() : null;
    for (const k of this.kingdoms) {
      if (!k.alive || !k.villages.length) continue;
      if (!this._kLaw(k.id, 'civTechnology')) continue;
      if (!k.techs) this._initTech(k);
      let pop = 0,
        temples = 0,
        libraries = 0,
        observatories = 0,
        campuses = 0;
      for (const vid of k.villages) {
        const v = this.villages[vid];
        if (!v?.alive) continue;
        pop += v.pop;
        for (const b of v.buildings) {
          if (!b.alive || b.constructing) continue;
          if (b.type === 'temple') temples += b.level;
          else if (b.type === 'library') libraries++;
          else if (b.type === 'observatory') observatories++;
          else if (b.type === 'campus') campuses++;
        }
      }
      let rate = 0.2 + pop * 0.011 + temples * 0.3 + libraries * 0.9 + observatories * 1.4 + campuses * 4;
      rate *= this.techMod(k.id, 'research');
      const traits = this.cultureDef(k.culture)?.traits || [];
      if (traits.includes('Scholarly')) rate *= 1.35;
      if (traits.includes('Mystic')) rate *= 1.1;
      const ruler = g.units.byId.get(k.ruler);
      if (ruler && (g.units.hasTrait?.(ruler, 'sage') || g.units.hasTrait?.(ruler, 'inventive'))) rate *= 1.3;
      if (ruler) rate *= g.units.traitMod?.(ruler, 'research') ?? 1;
      // scholars: learned folk in the libraries' towns add their wit
      if (libraries && g.units.traitMod) {
        let wit = 0,
          n = 0;
        for (const vid of k.villages) {
          const v = this.villages[vid];
          if (!v?.alive || !v.buildings.some((b) => b.type === 'library' && b.alive)) continue;
          for (const u of v.members) {
            if (n > 40) break;
            const r = g.units.traitMod(u, 'research');
            if (r !== 1) wit += r - 1;
            n++;
          }
        }
        rate *= 1 + Math.max(-0.3, Math.min(0.6, wit * 0.15));
      }
      if (g.time.total < k.goldenUntil) rate *= 1.3;
      // Rocketry: each satellite in orbit speeds research; an orbital station more
      if (k.satellites) rate *= 1 + 0.05 * Math.min(6, k.satellites);
      if (k.orbitalStation) rate *= 1.1;
      if (spread > 0 && lore) {
        const c = lore.get(k.id)?.length || 0;
        if (c) rate *= 1 + spread * LORE_EXCHANGE * Math.min(5, c);
      }
      if (big > 0) {
        // big maps: scholars, letters and travellers cross the wide lands
        rate *= 1 + big * BIG_RESEARCH;
        // and what a neighbour knows is learned the sooner
        const t = techById[k.researching];
        if (t && lore) {
          let n = 0;
          for (const o of lore.get(k.id) || []) if (o.techs.has(t.id)) n++;
          if (n) rate *= 1 + big * 0.3 * Math.min(3, n);
        }
      }
      let gain = rate * speed * dt;
      k.knowRate = rate * speed; // knowledge a second (the tech panel and the pacing census read it)
      if (!k.researching || k.techs.has(k.researching)) k.researching = this._chooseResearch(k) || 'mastery';
      // the old arts all known and a modern one under study: Mastery goes on beside it
      const rt = k.researching !== 'mastery' ? techById[k.researching] : null;
      if (rt && rt.era >= 4) {
        const m = gain * MASTERY_SHARE;
        gain -= m;
        let n = 0,
          all = 0;
        for (const t of TECHS) {
          if (t.era < 4 || !k.techs.has(t.id)) continue;
          all++;
          if (t.era === rt.era) n++;
        }
        gain *= 1 + MOMENTUM * n + CARRY * all;
        k.masteryKnowledge = (k.masteryKnowledge || 0) + m;
        if (k.masteryKnowledge >= this.masteryCost(k)) {
          k.masteryKnowledge -= this.masteryCost(k);
          this._gainMastery(k);
        }
      }
      k.knowledge += gain;
      if (k.researching === 'mastery') {
        // every discovery made: refine the arts, one Mastery at a time
        const cost = this.masteryCost(k);
        if (k.knowledge >= cost) {
          k.knowledge -= cost;
          this._gainMastery(k);
          k.researching = null;
        }
        continue;
      }
      const t = techById[k.researching];
      if (t && k.knowledge >= t.cost) {
        k.knowledge -= t.cost;
        this.learnTech(k, t.id);
      }
    }
  },

  _gainMastery(k) {
    k.mastery = (k.mastery || 0) + 1;
    this._history(`📜 ${this._kn(k)} attains Mastery ${k.mastery}`, 'info', this._kingdomPos(k));
    const unlock = { 2: 'statues of its heroes rise', 3: 'a second great work may begin', 4: 'its halls are gilded', 6: 'scholars found an academy', 8: 'its harbors fill with ships', 10: 'lamps line its grand roads' }[k.mastery];
    if (unlock || k.mastery % 3 === 0) this._note(`📜 ${this._kn(k)} attains Mastery ${k.mastery}${unlock ? ': ' + unlock : ''}`, 'good', this._kingdomPos(k), 'mastery' + k.id, 1);
  },

  learnTech(k, id, silent = false) {
    if (k.techs.has(id)) return;
    k.techs.add(id);
    k.researching = null;
    const t = techById[id];
    const first = !this._techFirst.has(id);
    this._techFirst.add(id);
    this._history(`📜 ${this._kn(k)} learns ${t.name}`, 'info', this._kingdomPos(k));
    if (first && !silent) this._note(`📜 ${this._kn(k)} is first to master ${t.name}`, 'good', this._kingdomPos(k), 'tech' + id, 1);
    // era advance: two technologies of the next era, one of them its defining art
    const inEra = (e) => TECHS.filter((x) => x.era === e && k.techs.has(x.id)).length;
    const cap = Math.max(k.era, this.eraCap());
    while (k.era < cap && inEra(k.era + 1) >= 2 && (!ERA_KEY[k.era + 1] || k.techs.has(ERA_KEY[k.era + 1]))) {
      k.era++;
      if (!silent) {
        const icon = ['🏛', '🏛', '🏛', '🏛', '🏭', '💡', '⚛', '🌌'][k.era] || '🏛';
        this._note(`${icon} ${this._kn(k)} enters the ${ERAS[k.era].name} Era`, 'good', this._kingdomPos(k), 'era' + k.id + k.era, 1);
        // the first realm into a modern era: what its towns now look like
        if (k.era >= 4 && !this._techFirst.has('era' + k.era)) {
          this._techFirst.add('era' + k.era);
          this._history(`${icon} The ${ERAS[k.era].name} Era dawns: ${ERAS[k.era].description.toLowerCase()}`, 'good', this._kingdomPos(k));
        }
      }
      this.version++;
    }
    this.colorVersion++;
  },
};

export { LEANINGS, YEAR as TECH_YEAR };
