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
  // ---- Breadth (docs/TECH-BREADTH.md): food, medicine, the land's biomes,
  // city development, urban planning and defense against the sky. These are
  // SIDE ARTS (`side: true`): a share of each realm's learning goes to them
  // beside its main study (SIDE_SHARE), they never count toward an era (so
  // the era pacing counts main arts only) and a side art of an era opens once
  // the realm has entered that era. Each answers a danger of the world.
  // Food (famine, hard winters, sieges)
  { id: 'husbandry', side: true, branch: 'food', name: 'Animal Husbandry', era: 1, cost: 70, requires: ['agriculture'], description: 'Herds of sheep, goats and cattle beside the farms.', effects: { harvest: 1.04 }, unlocks: ['Pens and pastures with sheep, goats and cattle beside the farms', 'Food from the herds; less famine on poor soil'], builds: ['pasture'] },
  { id: 'rotation', side: true, branch: 'food', name: 'Crop Rotation', era: 2, cost: 170, requires: ['husbandry', 'irrigation'], description: 'Fields in turn: crops one year, fallow the next.', effects: { harvest: 1.06 }, unlocks: ['Fields in alternating crops and fallow strips', 'Steadier harvests: famine strikes less often'] },
  { id: 'preservation', side: true, branch: 'food', name: 'Preservation', era: 3, cost: 320, requires: ['rotation', 'pottery'], description: 'Smoke, salt and brine keep food through the winter.', effects: { foodCap: 1.15 }, unlocks: ['Smokehouses and salting sheds; barrels in the granaries', 'Food keeps longer: winters and sieges starve fewer'], builds: ['smokehouse'] },
  { id: 'canning', side: true, branch: 'food', name: 'Canning & Fertilizer', era: 4, cost: 9000, requires: ['preservation', 'industry'], description: 'Tins that keep for years and fertilizer for the fields.', effects: { harvest: 1.1 }, unlocks: ['Canneries; fertilizer carts in the fields', 'Bigger harvests', 'Tinned food sent to the starving towns of the realm'], builds: ['cannery'] },
  { id: 'tractors', side: true, branch: 'food', name: 'Mechanized Farming', era: 5, cost: 14000, requires: ['canning', 'combustion'], description: 'Tractors and silos: few farmers feed many.', effects: { harvest: 1.1 }, unlocks: ['Tractors in the fields', 'Grain silos', 'Fewer farmers feed more people'], builds: ['silo'] },
  { id: 'hybridcrops', side: true, branch: 'food', name: 'Green Revolution', era: 6, cost: 30000, requires: ['tractors', 'genetics'], description: 'New strains, greenhouses and irrigated circles.', effects: { harvest: 1.08 }, unlocks: ['Greenhouses and irrigated circles', 'Farms thrive in dry land'], builds: ['greenhouse'] },
  { id: 'vertfarms', side: true, branch: 'food', name: 'Vertical Farms', era: 7, cost: 55000, requires: ['hybridcrops', 'robotics'], description: 'Fields stacked in lit towers.', effects: { foodCap: 1.2 }, unlocks: ['Vertical farm towers', 'Food independent of season and biome'], builds: ['vertfarm'] },
  // Medicine (plague, wounds, old age)
  { id: 'quarantine', side: true, branch: 'medicine', name: 'Quarantine', era: 3, cost: 320, requires: ['medicine'], description: 'The sick are kept apart until the sickness passes.', effects: {}, unlocks: ['Plague flags on sick houses', 'A lazaretto outside town', 'Plague spreads far less between towns'], builds: ['lazaretto'] },
  { id: 'vaccination', side: true, branch: 'medicine', name: 'Vaccination', era: 4, cost: 9000, requires: ['quarantine', 'sanitation'], description: 'A small sickness that guards against a great one.', effects: { birth: 1.05 }, unlocks: ['Clinics; doctors visit the houses', 'Fewer plague cases; more children survive'], builds: ['clinic'] },
  { id: 'antibiotics', side: true, branch: 'medicine', name: 'Antibiotics & Hospitals', era: 5, cost: 14000, requires: ['vaccination', 'electricity'], description: 'Hospitals and the medicines that cure infection.', effects: { birth: 1.04 }, unlocks: ['Hospitals with ambulances', 'The wounded and sick recover', 'Plague deaths fall sharply'], builds: ['hospital'] },
  { id: 'genetics', side: true, branch: 'medicine', name: 'Genetics', era: 6, cost: 30000, requires: ['antibiotics', 'computing'], description: 'The code of life, read and mended.', effects: { birth: 1.03 }, unlocks: ['A research hospital with a helix sign', 'Longer lives; fewer inherited ailments'], builds: ['genelab'] },
  { id: 'nanomed', side: true, branch: 'medicine', name: 'Nanomedicine', era: 7, cost: 55000, requires: ['genetics', 'robotics'], description: 'Machines smaller than a cell hunt disease.', effects: {}, unlocks: ['Medical drones over the towns', 'Very long lives; plague nearly harmless'] },
  // Biomes and environment (harsh land, deforestation, drought, floods, storms)
  { id: 'terracing', side: true, branch: 'land', name: 'Terracing', era: 1, cost: 70, requires: ['agriculture', 'masonry'], description: 'Stepped fields climb the hills.', effects: {}, unlocks: ['Terraced hillside fields', 'Farms on slopes and in the mountains'] },
  { id: 'qanats', side: true, branch: 'land', name: 'Wells & Qanats', era: 2, cost: 170, requires: ['irrigation', 'masonry'], description: 'Deep wells and channels under the sand.', effects: {}, unlocks: ['Wells and underground channels in dry land', 'Towns and farms in deserts and steppe'], builds: ['qanat'] },
  { id: 'coldbuild', side: true, branch: 'land', name: 'Cold Building', era: 2, cost: 170, requires: ['masonry', 'pottery'], description: 'Thick walls, steep roofs and stoves against the frost.', effects: {}, unlocks: ['Thick-walled houses with steep roofs and stoves', 'Towns in tundra and snow; winters kill fewer'] },
  { id: 'forestry', side: true, branch: 'land', name: 'Forestry', era: 3, cost: 320, requires: ['husbandry', 'mathematics'], description: 'Woods tended, felled and replanted in turn.', effects: {}, unlocks: ['Foresters replant; tree nurseries', 'Woods regrow near towns'], builds: ['nursery'] },
  { id: 'levees', side: true, branch: 'land', name: 'Drainage & Levees', era: 4, cost: 9000, requires: ['engineering', 'industry'], description: 'Embankments, polders and pumping mills.', effects: {}, unlocks: ['Levees along rivers and shores, polders and pumping mills', 'Floods and tsunamis do far less harm', 'Marsh becomes farmland'], builds: ['levee'] },
  { id: 'forecasting', side: true, branch: 'land', name: 'Weather Forecasting', era: 5, cost: 14000, requires: ['radio'], description: 'Barometers, balloons and radar read the sky.', effects: {}, unlocks: ['Weather stations and radar domes', 'Warning before storms, tornadoes and tsunamis: people take shelter, ships make port, aircraft stay down'], builds: ['weatherstation'] },
  { id: 'desalination', side: true, branch: 'land', name: 'Desalination', era: 6, cost: 30000, requires: ['levees', 'nuclear'], description: 'Fresh water from the sea.', effects: {}, unlocks: ['Desalination plants on dry coasts', 'Coastal deserts bloom; drought cannot starve a town'], builds: ['desal'] },
  { id: 'terraforming', side: true, branch: 'land', name: 'Terraforming', era: 7, cost: 55000, requires: ['desalination', 'fusion'], description: 'Climate towers green the barren land.', effects: {}, unlocks: ['Climate towers; the land greens around the cities', 'Desert and tundra near cities slowly turn to grassland'], builds: ['climatetower'] },
  // City development (fire, earthquakes, overcrowding)
  { id: 'firebrigade', side: true, branch: 'city', name: 'Fire Brigades', era: 3, cost: 320, requires: ['engineering'], description: 'Buckets, ladders and a bell in every town.', effects: {}, unlocks: ['Fire stations', 'Bucket brigades run to fires', 'Fires in towns are put out quickly'], builds: ['firestation'] },
  { id: 'buildcodes', side: true, branch: 'city', name: 'Building Codes', era: 4, cost: 9000, requires: ['firebrigade', 'industry'], description: 'Fire walls between houses and hydrants on the streets.', effects: {}, unlocks: ['Fire walls between houses, hydrants', 'Fires spread less; buildings last longer'] },
  { id: 'fireengines', side: true, branch: 'city', name: 'Fire Engines', era: 5, cost: 14000, requires: ['buildcodes', 'combustion'], description: 'Pumps on wheels, sirens in the streets.', effects: {}, unlocks: ['Fire engines race to fires with sirens', 'Fires stopped within moments'] },
  { id: 'seismic', side: true, branch: 'city', name: 'Seismic Engineering', era: 6, cost: 30000, requires: ['concrete', 'computing'], description: 'Braced frames and base isolators.', effects: {}, unlocks: ['Braced towers and base isolators', 'Earthquakes topple few buildings'] },
  { id: 'smartcity', side: true, branch: 'city', name: 'Smart Cities', era: 7, cost: 55000, requires: ['seismic', 'robotics'], description: 'The city watches over itself.', effects: {}, unlocks: ['Glowing control spires; traffic flows', 'Disasters answered at once; growth boost'], builds: ['controlspire'] },
  // Urban planning (lack of land; drives urban renewal)
  { id: 'townplan', side: true, branch: 'urban', name: 'Town Planning', era: 2, cost: 170, requires: ['mathematics'], description: 'Surveyed streets in straight lines.', effects: {}, unlocks: ['Grid streets in new quarters', 'Tidier, denser new quarters'] },
  { id: 'zoning', side: true, branch: 'urban', name: 'Zoning', era: 4, cost: 9000, requires: ['townplan', 'industry'], description: 'Homes here, mills there, markets between.', effects: {}, unlocks: ['Distinct districts: homes, industry, markets', 'Factories and haze kept away from homes', 'Urban renewal begins: old low houses rebuilt denser'] },
  { id: 'transit', side: true, branch: 'urban', name: 'Public Transit', era: 5, cost: 14000, requires: ['zoning', 'electricity'], description: 'Trams and buses on the town streets.', effects: {}, unlocks: ['Trams and buses on town streets', 'Bigger towns stay connected; growth boost'] },
  { id: 'heritage', side: true, branch: 'urban', name: 'Heritage Conservation', era: 5, cost: 14000, requires: ['zoning', 'philosophy'], description: 'The old quarters are kept and restored.', effects: { loyalty: 4 }, unlocks: ['Heritage plaques; restored old buildings lit at night', 'More old buildings protected; loyalty and culture boost'] },
  { id: 'renewal', side: true, branch: 'urban', name: 'Urban Renewal', era: 6, cost: 30000, requires: ['heritage', 'skyscrapers'], description: 'Old blocks give way to towers; ring roads where the walls stood.', effects: {}, unlocks: ['Old blocks replaced by apartment towers', 'Ring roads where walls stood', 'Renewal at full pace'] },
  { id: 'gardencity', side: true, branch: 'urban', name: 'Garden Cities', era: 7, cost: 55000, requires: ['renewal', 'arcology'], description: 'Parks, green roofs and walkways in the air.', effects: {}, unlocks: ['Parks and green roofs; elevated walkways', 'Very large city caps without crowding'], builds: ['park'] },
  // Defense against the sky (meteors)
  { id: 'skyshield', side: true, branch: 'city', name: 'Planetary Defense', era: 7, cost: 55000, requires: ['orbital', 'computing'], description: 'Tracking stations whose beams break up falling stones.', effects: {}, unlocks: ['A tracking station whose beams break up incoming meteors', 'Meteors aimed at a protected town burst into harmless fragments in the sky'], builds: ['skyshield'] },
];

export const techById = Object.fromEntries(TECHS.map((t) => [t.id, t]));
// mean cost of each era's arts (the research choice weighs a modern art
// against its own era's price)
const ERA_COST = {};
const OLD_KINDS = new Set(['ram', 'oxcart', 'galley', 'cog']);
for (let e = 0; e <= LAST_ERA; e++) {
  const L = TECHS.filter((t) => t.era === e && !t.side);
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
// Side arts (the breadth branches): this share of a realm's learning goes to
// them beside its main study (not taken from it), all of it once the main
// arts are known.
const SIDE_SHARE = 0.25;
const SIDE_ALONE = 0.6;
export const SIDE_TECHS = TECHS.filter((t) => t.side);
// Era pacing (docs/MODERN-ERAS.md): the year the world's first realm should
// enter each era on any map at the default research speed. A realm whose
// study would carry it into the next era before its year is slowed toward
// it, and the world's leading realm, if late, is hurried a little: the
// realms' research rates differed twenty-fold between worlds (300 to 8,000 a
// year) and the modern momentum amplified it, so one world reached the Future
// by Year 360 and another not by 600. Eras 1-3 were unpaced until round 23:
// the World Map's realms stood in the Enlightened era by Year 40-70 and a
// Medium world's in the Iron era by Year 70.
export const ERA_YEAR = { 1: 45, 2: 100, 3: 160, 4: 225, 5: 325, 6: 425, 7: 515 };
const PACE_MIN = 0.08;
const PACE_LEAD = 2.2; // most the leading realm is hurried when late (x research speed)
const FOLLOW_HURRY = 1.5; // most a follower past its own year is hurried
// The other realms follow the leader into an era over the next decades, not
// all in the same year: each realm's own year for an era lies up to
// FOLLOW_YEARS after the era's year (a fixed share per realm and era, so the
// last into one age is not always the last into the next).
const FOLLOW_YEARS = 55;
function followShare(kid, era) {
  let h = (Math.imul((kid | 0) + 1, 0x9e3779b1) ^ Math.imul(era + 7, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}
// Catch-up: an art that a neighbour, ally or trade partner already knows is
// learned far sooner than it was first invented, the more so the further
// behind the realm stands (x2.4 one era behind, x5.7 two, x13 three, x32
// four). The world's leaders teach a realm out of touch one era less. A
// one-town realm sat in the Enlightened era for 294 years beside Future realms.
const CATCH_BASE = 2;
const CATCH_EXP = 1.25;
// A realm two or more eras behind the world's leader still sat for two
// centuries (a one-town realm learned one art from Year 206 to 401): the
// multiplier above scales a rate of under one point a second, and a modern
// art costs over 30,000. Such a realm learns from the wider world, whatever
// it has built (no temple, library or campus needed): its study goes at least
// fast enough to cross its next era in LAG_YEARS / (eras behind - 1) years.
const LAG_YEARS = 30;
// One era behind, a much gentler floor (an era in LAG1_YEARS) keeps a small
// realm from standing still for a century until it falls two behind.
const LAG1_YEARS = 90;

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

  // Realms of the Modern era and later lay up their old kinds over a few
  // years (the fleet gives them only modern kinds from then on: air.js
  // _modernEra): a ram, ox cart, galley or cog still about is retired once
  // it is idle, or regardless after three years more.
  _retireOldKinds() {
    const F = this.game.fleet;
    if (!F?.list) return;
    const now = this.game.time.total;
    for (const v of F.list) {
      if (!v.alive || !OLD_KINDS.has(v.kind) || (this.kingdoms[v.kingdom]?.era ?? 0) < 5) continue;
      if (v.retireAt == null) {
        v.retireAt = now + YEAR * (1 + this.rng.next() * 3);
        continue;
      }
      if (now < v.retireAt) continue;
      const idle = v.state === 'moored' || v.state === 'anchored' || !v.mission || v.abandon > 0;
      if (idle || now > v.retireAt + YEAR * 3) F.remove(v, 'retired');
    }
  },

  // A realm that rises from no parent (wanderers) knows what every living
  // realm already knows, and stands in the era they all share.
  _commonTechs(k) {
    const live = this.kingdoms.filter((o) => o !== k && o.alive && o.villages.length && o.techs);
    if (!live.length) return;
    for (const t of live[0].techs) if (live.every((o) => o.techs.has(t))) k.techs.add(t);
    k.era = Math.min(...live.map((o) => o.era || 0));
  },

  _availableTechs(k) {
    const known = k.techs;
    const inEra = (e) => TECHS.filter((t) => t.era === e && !t.side && known.has(t.id)).length;
    // (the World Law civEraCap holds every realm at the chosen era)
    const maxEra = Math.min(this.eraCap(), k.era + (inEra(k.era) >= 3 || (k.era > 0 && inEra(k.era) >= 2) ? 1 : 0));
    return TECHS.filter((t) => !t.side && !known.has(t.id) && t.era <= maxEra && t.requires.every((r) => known.has(r)));
  },
  // Side arts open to a realm: of its own era or earlier (and within the
  // era cap), their requirements known.
  _availableSide(k) {
    const known = k.techs;
    const cap = Math.min(this.eraCap(), k.era || 0);
    return SIDE_TECHS.filter((t) => !known.has(t.id) && t.era <= cap && t.requires.every((r) => known.has(r)));
  },
  // The side art a realm studies next: the cheapest, drawn to the danger it
  // has suffered most lately (k.dangers: fire, quake, flood, storm, plague,
  // famine, meteor) and to the land it lives on.
  _chooseSide(k) {
    const opts = this._availableSide(k);
    if (!opts.length) return null;
    const D = k.dangers || {};
    const need = { food: (D.famine || 0) + (D.winter || 0), medicine: D.plague || 0, land: (D.flood || 0) + (D.storm || 0) + (k.harsh || 0), city: (D.fire || 0) + (D.quake || 0) + (D.meteor || 0), urban: k.crowded || 0 };
    let best = null,
      bs = -Infinity;
    for (const t of opts) {
      const s = -t.cost / (ERA_COST[t.era] || 1000) * 6 - (t.era < (k.era || 0) ? 0 : 1) + Math.min(3, need[t.branch] || 0) + this.rng.next() * 1.2;
      if (s > bs) (bs = s), (best = t);
    }
    return best.id;
  },
  // Years until a realm could enter its next era at today's pace (main arts
  // only), and the knowledge that takes.
  _eraNeed(k) {
    const next = (k.era || 0) + 1;
    const key = ERA_KEY[next];
    const known = k.techs;
    let cost = 0;
    const seen = new Set();
    const add = (id) => {
      if (!id || known.has(id) || seen.has(id)) return;
      seen.add(id);
      const t = techById[id];
      if (!t) return;
      for (const r of t.requires) add(r);
      cost += t.cost;
    };
    add(key);
    let n = 0;
    for (const t of TECHS) if (t.era === next && !t.side && (known.has(t.id) || seen.has(t.id))) n++;
    // the cheapest other arts of that era after the key's chain, each with
    // the arts it requires (the Enlightened era has no key art)
    const chain = (id, acc) => {
      if (known.has(id) || seen.has(id) || acc.has(id)) return 0;
      acc.add(id);
      const t = techById[id];
      let c = t ? t.cost : 0;
      if (t) for (const r of t.requires) c += chain(r, acc);
      return c;
    };
    for (; n < 2; n++) {
      let c = Infinity,
        pick = null;
      for (const t of TECHS) {
        if (t.era !== next || t.side || known.has(t.id) || seen.has(t.id)) continue;
        const acc = new Set();
        const x = chain(t.id, acc);
        if (x < c) (c = x), (pick = acc);
      }
      if (!pick) break;
      for (const id of pick) seen.add(id);
      cost += c;
    }
    if (next >= 4) {
      // the old arts come first (_chooseResearch): every one still unknown
      for (const t of TECHS) if (t.era <= 3 && !t.side && !known.has(t.id) && !seen.has(t.id)) cost += t.cost;
    } else {
      // the next era's arts open only once enough of this era's are known
      // (_availableTechs): three of the Hearth, two of a later era
      const cur = next - 1;
      let have = 0;
      const left = [];
      for (const t of TECHS) {
        if (t.era !== cur || t.side) continue;
        if (known.has(t.id) || seen.has(t.id)) have++;
        else left.push(t.cost);
      }
      left.sort((a, b) => a - b);
      for (let i = 0; i < (cur === 0 ? 3 : 2) - have && i < left.length; i++) cost += left[i];
    }
    // (an art under study off that path is finished first)
    const rt = k.researching && k.researching !== 'mastery' ? techById[k.researching] : null;
    if (rt && !known.has(rt.id) && !seen.has(rt.id)) cost += rt.cost;
    if (rt) cost -= Math.min(k.knowledge || 0, rt.cost);
    return Math.max(0, cost);
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

  // Trade partners (realms whose caravans, trains or ships delivered to one
  // another's towns in the last ten years), recorded from fleet deliveries.
  _hookTrade() {
    if (this._tradeHooked) return;
    this._tradeHooked = true;
    this._trade = new Map();
    this.game.events?.on?.('fleet:delivered', (e) => {
      const a = e?.kingdom,
        b = this.villages[e?.to]?.kingdom;
      if (a == null || b == null || a === b || a < 0 || b < 0) return;
      const t = this.game.time.total;
      (this._trade.get(a) || this._trade.set(a, new Map()).get(a)).set(b, t);
      (this._trade.get(b) || this._trade.set(b, new Map()).get(b)).set(a, t);
    });
  },
  // How many eras a realm stands behind those it can learn from (0 when
  // level): its neighbours, allies and trade partners, else the world's
  // leading realm less one era. Only while the art under study is known to
  // one of them.
  _catchUp(k, lore, leader) {
    const era = k.era || 0;
    const id = k.researching;
    let gap = 0;
    const learn = (o) => {
      if (!o?.alive || !o.villages.length || !o.techs) return;
      const d = (o.era || 0) - era;
      if (d > gap && (!id || id === 'mastery' || o.techs.has(id))) gap = d;
    };
    for (const o of lore?.get(k.id) || []) learn(o);
    const now = this.game.time.total;
    const tr = this._trade?.get(k.id);
    if (tr) for (const [kid, t] of tr) if (now - t < YEAR * 10) learn(this.kingdoms[kid]);
    if (leader && leader !== k && (!id || id === 'mastery' || leader.techs?.has(id))) gap = Math.max(gap, (leader.era || 0) - era - 1);
    return gap;
  },

  _chooseResearch(k) {
    let opts = this._availableTechs(k);
    if (!opts.length) return null;
    // the old arts first: no modern art while one up to the Enlightened era
    // is still to learn (the pacing's _eraNeed counts them)
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
    const lore = this._contactLore();
    this._hookTrade();
    // the world's single most advanced realm (the pacing hurries only it when
    // late): the latest era, then the most main arts known, then the most
    // knowledge in hand. Every realm tied for the top era used to count as a
    // leader, so a whole crowd of era-3 realms was hurried at once.
    let leader = null,
      ls = -1,
      top = 0;
    for (const k of this.kingdoms) {
      if (!k.alive || !k.villages.length || !k.techs) continue;
      let main = 0;
      for (const id of k.techs) if (!techById[id]?.side) main++;
      const s = (k.era || 0) * 1e9 + main * 1e5 + Math.min(99999, k.knowledge || 0);
      if (s > ls) (ls = s), (leader = k), (top = k.era || 0);
    }
    const year = g.time.total / YEAR;
    const tsp = Math.max(0.25, this.law('civTechSpeed', 1));
    // (round 27) From the Modern era on, and for any era whose year has
    // passed with no realm in it, the pacing's leader is the top-era realm
    // nearest to finishing the next era (its unhurried years to go, kept
    // from the last tick), not the one with the most arts: that realm could
    // not finish the Modern arts by Year 325 even hurried, and Modern came at
    // 372 (round 24: 323). Once the year has passed, every realm's hold on
    // that era is lifted until one enters, and the leader is hurried the
    // harder the later it is.
    const nextE = top + 1;
    const overdue = ERA_YEAR[nextE] != null && nextE <= this.eraCap() && year > ERA_YEAR[nextE] / tsp ? year - ERA_YEAR[nextE] / tsp : 0;
    if (ERA_YEAR[nextE] != null && (nextE >= 5 || overdue > 0)) {
      let best = null,
        be = Infinity;
      for (const k of this.kingdoms) {
        if (!k.alive || !k.villages.length || !k.techs || (k.era || 0) !== top) continue;
        if (k.eraEta < be) (be = k.eraEta), (best = k);
      }
      if (best) leader = best;
    }
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
      // a realm left behind learns from those ahead of it
      const lag = this._catchUp(k, lore, leader);
      if (lag > 0) rate *= Math.pow(CATCH_BASE, lag * CATCH_EXP);
      // ...and behind it, at no less than a floor rate (by contact and
      // travellers, not its own buildings: see LAG_YEARS, LAG1_YEARS)
      const behind = leader && leader !== k ? (leader.era || 0) - (k.era || 0) : 0;
      const floor = behind >= 1 ? (2.2 * (ERA_COST[(k.era || 0) + 1] || 0)) / (YEAR * (behind >= 2 ? LAG_YEARS / (behind - 1) : LAG1_YEARS)) : 0;
      k.lagFloor = floor; // (knowledge a second; 0 when not far behind)
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
      if (!k.researching || k.techs.has(k.researching)) k.researching = this._chooseResearch(k) || 'mastery';
      // the old arts all known and a modern one under study: Mastery goes on beside it
      const rt = k.researching !== 'mastery' ? techById[k.researching] : null;
      let m = 0;
      if (rt && rt.era >= 4) {
        m = gain * MASTERY_SHARE;
        gain -= m;
        let n = 0,
          all = 0;
        for (const t of TECHS) {
          if (t.era < 4 || t.side || !k.techs.has(t.id)) continue;
          all++;
          if (t.era === rt.era) n++;
        }
        gain *= 1 + MOMENTUM * n + CARRY * all;
      }
      if (floor > 0 && rt && gain < floor * speed * dt) gain = floor * speed * dt;
      // pacing: toward the realm's own year for its next era (ERA_YEAR plus
      // its follower's delay; sooner at a higher research speed). It comes
      // after the catch-up and the laggard floor, so neither carries a realm
      // into an era before its year: they only lift those behind it.
      const next = (k.era || 0) + 1;
      k.eraHold = 0;
      k.eraEta = Infinity;
      if (rt && ERA_YEAR[next] != null && next <= this.eraCap() && gain > 0) {
        const ts = tsp;
        const lead = k === leader;
        // an overdue era no realm has entered: no follower's delay (no hold)
        const open = overdue > 0 && next === nextE;
        const target = (ERA_YEAR[next] + (lead || open ? 0 : FOLLOW_YEARS * followShare(k.id, next))) / ts;
        const eta = this._eraNeed(k) / ((gain / dt) * YEAR);
        k.eraEta = eta;
        const left = target - year;
        // (round 25) the leader may be hurried the harder at a higher research
        // speed (its towns have had half the years to grow at 2x: no realm
        // was Industrial by Year 130, against 112.5), and a follower past its
        // own year up to FOLLOW_HURRY (eleven of sixteen realms were still
        // Industrial 77 years after the first Modern one)
        const late = lead && open ? Math.min(3, 1 + overdue / 8) : 1;
        const hurry = lead ? PACE_LEAD * Math.max(1, ts) * late : left > 1 ? 1 : FOLLOW_HURRY;
        let f = left > 1 ? eta / left : hurry;
        f = Math.max(PACE_MIN, Math.min(hurry, f));
        k.pace = k.pace == null ? f : k.pace + (f - k.pace) * 0.25;
        gain *= k.pace;
        // the art that would carry the realm into the era waits for its year
        // (a strong court still came in 9-18 years early at the floor pace)
        if (left > 0) k.eraHold = target;
      } else k.pace = 1;
      // knowledge a second, before the modern momentum (the tech panel, the
      // pacing census and a satellite's year of research read it)
      k.knowRate = Math.max(rate, rt ? floor : 0) * speed * (k.pace ?? 1);
      if (m) {
        k.masteryKnowledge = (k.masteryKnowledge || 0) + m;
        if (k.masteryKnowledge >= this.masteryCost(k)) {
          k.masteryKnowledge -= this.masteryCost(k);
          this._gainMastery(k);
        }
      }
      k.knowledge += gain;
      // the side arts (breadth branches) beside the main study
      if (!k.researchSide || k.techs.has(k.researchSide)) k.researchSide = this._chooseSide(k);
      if (k.researchSide) {
        k.sideKnowledge = (k.sideKnowledge || 0) + gain * (k.researching === 'mastery' ? SIDE_ALONE : SIDE_SHARE);
        const st = techById[k.researchSide];
        if (st && k.sideKnowledge >= st.cost) {
          k.sideKnowledge -= st.cost;
          const id = k.researchSide;
          k.researchSide = null;
          this.learnTech(k, id);
        }
      }
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
        if (k.eraHold > year && this._entersEra(k, t)) {
          // held: the knowledge waits in hand (no more than the art's price)
          k.knowledge = t.cost;
          continue;
        }
        k.knowledge -= t.cost;
        this.learnTech(k, t.id);
      }
    }
  },

  // Would learning this art carry the realm into its next era (two arts of
  // that era known, its key art among them)?
  _entersEra(k, t) {
    const next = (k.era || 0) + 1;
    if (t.side || t.era !== next) return false;
    let n = 1;
    for (const x of TECHS) if (x.era === next && !x.side && x.id !== t.id && k.techs.has(x.id)) n++;
    const key = ERA_KEY[next];
    return n >= 2 && (!key || key === t.id || k.techs.has(key));
  },

  _gainMastery(k) {
    k.mastery = (k.mastery || 0) + 1;
    // the realm's name opens the sentence, so it takes a capital ("The Elderley March")
    const kn = this._kn(k), Kn = kn.charAt(0).toUpperCase() + kn.slice(1);
    this._history(`${Kn} attains Mastery ${k.mastery}`, 'info', this._kingdomPos(k));
    const unlock = { 2: 'statues of its heroes rise', 3: 'a second great work may begin', 4: 'its halls are gilded', 6: 'scholars found an academy', 8: 'its harbors fill with ships', 10: 'lamps line its grand roads' }[k.mastery];
    if (unlock || k.mastery % 3 === 0) this._note(`${Kn} attains Mastery ${k.mastery}${unlock ? ': ' + unlock : ''}`, 'good', this._kingdomPos(k), 'mastery' + k.id, 1);
  },

  learnTech(k, id, silent = false) {
    if (k.techs.has(id)) return;
    k.techs.add(id);
    const t = techById[id];
    if (t?.side) {
      if (k.researchSide === id) k.researchSide = null;
    } else if (k.researching === id || !t) k.researching = null;
    const first = !this._techFirst.has(id);
    this._techFirst.add(id);
    this._history(`📜 ${this._kn(k)} learns ${t.name}`, 'info', this._kingdomPos(k));
    if (first && !silent) this._note(`📜 ${this._kn(k)} is first to master ${t.name}`, 'good', this._kingdomPos(k), 'tech' + id, 1);
    // era advance: two technologies of the next era, one of them its defining art
    const inEra = (e) => TECHS.filter((x) => x.era === e && !x.side && k.techs.has(x.id)).length;
    const cap = Math.max(k.era, this.eraCap());
    while (k.era < cap && inEra(k.era + 1) >= 2 && (!ERA_KEY[k.era + 1] || k.techs.has(ERA_KEY[k.era + 1]))) {
      k.era++;
      if (!silent) {
        const icon = ['🏛', '🏛', '🏛', '🏛', '🏭', '💡', '⚛', '🌌'][k.era] || '🏛';
        this._note(`${icon} ${this._kn(k)} enters the ${ERAS[k.era].name} era`, 'good', this._kingdomPos(k), 'era' + k.id + k.era, 1);
        // the first realm into a modern era: what its towns now look like
        if (k.era >= 4 && !this._techFirst.has('era' + k.era)) {
          this._techFirst.add('era' + k.era);
          this._history(`${icon} The ${ERAS[k.era].name} era dawns: ${ERAS[k.era].description.toLowerCase()}`, 'good', this._kingdomPos(k));
        }
      }
      this.version++;
    }
    this.colorVersion++;
  },
};

export { LEANINGS, YEAR as TECH_YEAR };
