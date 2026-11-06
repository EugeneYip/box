import { TILE } from '../../world/constants.js';

// Species registry and the built-in Worldseed fauna. Units.js re-exports
// SPECIES / registerSpecies (the public contract); other modules may register
// their own species at import time.
//
// Every field below has a default, so a minimal definition such as
//   registerSpecies({ id: 'goat', diet: 'herbivore' })
// is a valid creature that uses the generic herbivore brain.
export const SPECIES = {};

const GRAZE = [TILE.GRASS, TILE.SAVANNA, TILE.FOREST, TILE.JUNGLE, TILE.TUNDRA, TILE.SWAMP, TILE.FARMLAND, TILE.SOIL];

export function registerSpecies(def) {
  const base = {
    name: def.id,
    kind: 'animal', // 'humanoid' | 'animal' | 'monster' | 'fish' | 'bird'
    habitat: 'land', // 'land' | 'water' | 'air'
    diet: 'herbivore', // 'herbivore' | 'carnivore' | 'omnivore'
    brain: null, // default brain family (see brains.js); derived from diet when null
    speed: 1.2, // tiles / game second (walking)
    runMul: 1.6, // speed multiplier when running / fleeing / hunting
    swimMul: 0.55, // speed multiplier while swimming
    canSwim: true, // land creatures may wade and swim through shallow water
    accel: 5,
    turnRate: 9,
    hp: 20,
    damage: 2,
    attackRange: 0.6,
    attackCooldown: 1.2,
    knockback: 0.6,
    mass: 1,
    lifespan: 20, // years (YEAR_SECONDS = 30 game seconds)
    maturity: 2, // years
    gestation: 0.4, // years
    litter: [1, 2],
    birthInterval: 0.8, // years between births per female
    fertility: 0.25, // chance per think to conceive when conditions allow
    size: 1, // render scale multiplier
    height: 0.4, // world units, used for effects / hit points
    radius: 0.18, // body radius for separation and hit tests
    breedChance: 0.02, // legacy field (kept for compatibility)
    maxPopulation: 300, // carrying capacity on a 256 x 256 map (scaled by area)
    sight: 8,
    aggressive: false,
    prey: [],
    flees: false, // runs from threats instead of fighting back
    fleeRange: 0.7, // fraction of sight at which threats trigger fleeing
    herd: false,
    pack: false,
    solitary: false,
    nocturnal: false,
    starves: true,
    hungerRate: 0.007,
    energyRate: 0.0026,
    food: 0.6, // nourishment this creature provides when eaten
    grazes: GRAZE,
    blood: true,
    retaliate: true,
    seed: null, // {tiles:[TILE...], groups, size:[min,max]} initial placement on a 256 map
    sound: null, // ambient voice for game.audio
    ...def,
  };
  if (!base.brain) {
    base.brain =
      base.kind === 'humanoid'
        ? 'human'
        : base.diet === 'carnivore'
          ? 'predator'
          : base.diet === 'omnivore'
            ? 'omnivore'
            : 'herbivore';
  }
  SPECIES[def.id] = base;
  return base;
}

// ---------------------------------------------------------------------------
// Built-in species. Sizes are in world units (one tile = 1, a human ~0.6 tall).
registerSpecies({
  id: 'human', name: 'Human', kind: 'humanoid', diet: 'omnivore', brain: 'human',
  speed: 1.3, runMul: 1.65, hp: 40, damage: 4, attackRange: 0.55, attackCooldown: 1.0,
  lifespan: 70, maturity: 16, breedChance: 0, fertility: 0, maxPopulation: 3000, sight: 10,
  height: 0.6, radius: 0.16, starves: false, hungerRate: 0.004, food: 0.6, flees: false,
  prey: [], sound: null,
});
registerSpecies({
  id: 'sheep', name: 'Sheep', diet: 'herbivore', herd: true, flees: true,
  speed: 0.85, runMul: 1.75, hp: 18, damage: 0, lifespan: 12, maturity: 1.3, gestation: 0.3, litter: [1, 2],
  birthInterval: 0.7, fertility: 0.3, maxPopulation: 150, sight: 6, height: 0.36, radius: 0.17, food: 0.8,
  sound: 'bleat', seed: { tiles: [TILE.GRASS, TILE.SAVANNA], groups: 9, size: [3, 6] },
});
registerSpecies({
  id: 'cow', name: 'Cow', diet: 'herbivore', herd: true, flees: true,
  speed: 0.7, runMul: 1.7, hp: 42, damage: 3, lifespan: 18, maturity: 2, gestation: 0.45, litter: [1, 1],
  birthInterval: 0.9, fertility: 0.3, maxPopulation: 90, sight: 6, height: 0.5, radius: 0.24, mass: 2.5, food: 1.2,
  crowd: 8, sound: 'bleat', seed: { tiles: [TILE.GRASS, TILE.SAVANNA], groups: 5, size: [3, 5] },
});
registerSpecies({
  id: 'pig', name: 'Pig', diet: 'herbivore', herd: true, flees: true,
  speed: 0.9, runMul: 1.7, hp: 22, damage: 1, lifespan: 12, maturity: 1.1, gestation: 0.3, litter: [2, 3],
  birthInterval: 0.8, fertility: 0.25, maxPopulation: 90, sight: 6, height: 0.3, radius: 0.17, mass: 1.4, food: 0.75,
  grazes: [TILE.FOREST, TILE.GRASS, TILE.SWAMP, TILE.JUNGLE, TILE.SOIL, TILE.FARMLAND],
  sound: 'bleat', seed: { tiles: [TILE.FOREST, TILE.GRASS, TILE.SWAMP], groups: 4, size: [2, 4] },
});
registerSpecies({
  id: 'chicken', name: 'Chicken', diet: 'herbivore', herd: true, flees: true,
  speed: 0.75, runMul: 1.9, hp: 6, damage: 0, lifespan: 6, maturity: 0.5, gestation: 0.15, litter: [1, 3],
  birthInterval: 0.6, fertility: 0.25, maxPopulation: 100, sight: 5, height: 0.22, radius: 0.1, mass: 0.3, food: 0.3,
  grazes: [TILE.GRASS, TILE.SAVANNA, TILE.SOIL, TILE.FARMLAND, TILE.SAND],
  sound: 'bleat', seed: { tiles: [TILE.GRASS, TILE.SAVANNA], groups: 4, size: [3, 5] },
});
registerSpecies({
  id: 'deer', name: 'Deer', diet: 'herbivore', herd: true, flees: true, fleeRange: 0.95,
  speed: 1.3, runMul: 2.0, hp: 24, damage: 2, lifespan: 14, maturity: 1.4, gestation: 0.4, litter: [1, 2],
  birthInterval: 0.8, fertility: 0.3, maxPopulation: 110, sight: 10, height: 0.55, radius: 0.18, mass: 1.3, food: 0.9,
  grazes: [TILE.FOREST, TILE.GRASS, TILE.JUNGLE, TILE.TUNDRA],
  seed: { tiles: [TILE.FOREST, TILE.GRASS, TILE.TUNDRA], groups: 7, size: [3, 5] },
});
registerSpecies({
  id: 'rabbit', name: 'Rabbit', diet: 'herbivore', herd: true, flees: true, fleeRange: 0.8,
  speed: 1.0, runMul: 2.0, hp: 5, damage: 0, lifespan: 6, maturity: 0.5, gestation: 0.15, litter: [1, 3],
  birthInterval: 0.6, fertility: 0.2, maxPopulation: 150, crowd: 9, sight: 6, height: 0.17, radius: 0.08, mass: 0.25, food: 0.35,
  grazes: [TILE.GRASS, TILE.FOREST, TILE.TUNDRA, TILE.SAVANNA, TILE.FARMLAND, TILE.SNOW],
  seed: { tiles: [TILE.GRASS, TILE.FOREST, TILE.TUNDRA], groups: 9, size: [2, 4] },
});
registerSpecies({
  id: 'wolf', name: 'Wolf', diet: 'carnivore', pack: true, nocturnal: true,
  speed: 1.35, runMul: 1.75, hp: 30, damage: 6, attackRange: 0.55, attackCooldown: 1.1, lifespan: 13, maturity: 1.8,
  gestation: 0.4, litter: [1, 3], birthInterval: 1.0, fertility: 0.35, maxPopulation: 40, sight: 12, aggressive: true,
  height: 0.36, radius: 0.18, hungerRate: 0.0052, food: 0.7, sound: 'growl', predRatio: 12,
  prey: ['sheep', 'deer', 'rabbit', 'chicken', 'pig', 'cow'],
  seed: { tiles: [TILE.FOREST, TILE.TUNDRA, TILE.GRASS], groups: 4, size: [3, 4] },
});
registerSpecies({
  id: 'bear', name: 'Bear', diet: 'omnivore', brain: 'bear', solitary: true,
  speed: 0.95, runMul: 1.7, hp: 85, damage: 12, attackRange: 0.7, attackCooldown: 1.6, knockback: 1.4, mass: 4,
  lifespan: 24, maturity: 2.5, gestation: 0.5, litter: [1, 2], birthInterval: 1.2, fertility: 0.5, maxPopulation: 16,
  sight: 9, height: 0.55, radius: 0.28, hungerRate: 0.0045, food: 1.4, sound: 'growl', predRatio: 32,
  prey: ['deer', 'sheep', 'pig', 'rabbit', 'cow'],
  seed: { tiles: [TILE.FOREST, TILE.TUNDRA], groups: 4, size: [1, 2] },
});
registerSpecies({
  id: 'fox', name: 'Fox', diet: 'carnivore', solitary: true, nocturnal: true,
  speed: 1.15, runMul: 2.05, hp: 12, damage: 3, attackRange: 0.45, attackCooldown: 0.9, lifespan: 10, maturity: 0.9,
  gestation: 0.3, litter: [2, 3], birthInterval: 0.8, fertility: 0.45, maxPopulation: 30, sight: 9, aggressive: true,
  height: 0.26, radius: 0.12, hungerRate: 0.006, food: 0.4, flees: true, mouses: true, predRatio: 4,
  prey: ['rabbit', 'chicken'],
  seed: { tiles: [TILE.FOREST, TILE.GRASS, TILE.TUNDRA], groups: 4, size: [2, 2] },
});

// ---- original fantasy creatures (spawned by god powers) -------------------
registerSpecies({
  id: 'golem', name: 'Stone Golem', kind: 'monster', diet: 'carnivore', brain: 'golem',
  speed: 0.5, runMul: 1.35, hp: 420, damage: 24, attackRange: 0.95, attackCooldown: 2.4, knockback: 2.2, mass: 12,
  lifespan: 100000, maturity: 0, fertility: 0, maxPopulation: 12, sight: 7, aggressive: true, starves: false,
  height: 1.7, radius: 0.5, canSwim: false, blood: false, turnRate: 3, accel: 2, food: 0,
  prey: ['human', 'wolf', 'bear', 'fox'], sound: 'quake',
});
registerSpecies({
  id: 'serpent', name: 'Tidewyrm', kind: 'monster', habitat: 'water', diet: 'carnivore', brain: 'serpent',
  speed: 1.2, runMul: 1.6, hp: 300, damage: 18, attackRange: 1.7, attackCooldown: 2.2, knockback: 1.6, mass: 10,
  lifespan: 100000, maturity: 0, fertility: 0, maxPopulation: 8, sight: 10, aggressive: true, starves: false,
  height: 1.2, radius: 0.5, turnRate: 2.5, accel: 2, food: 0,
  prey: ['human', 'sheep', 'cow', 'pig', 'deer', 'wolf', 'bear', 'chicken', 'rabbit', 'fox'], sound: 'growl',
});
registerSpecies({
  id: 'skywyrm', name: 'Skywyrm', kind: 'monster', habitat: 'air', diet: 'carnivore', brain: 'skywyrm',
  speed: 2.4, runMul: 1.4, hp: 260, damage: 14, attackRange: 1.3, attackCooldown: 1.6, knockback: 1.2, mass: 8,
  lifespan: 100000, maturity: 0, fertility: 0, maxPopulation: 6, sight: 14, aggressive: true, starves: false,
  height: 1.0, radius: 0.6, turnRate: 1.8, accel: 1.5, food: 0, canSwim: false,
  prey: ['human', 'sheep', 'cow', 'deer', 'pig'], sound: 'growl',
});

export const WILD_SPECIES = () => Object.values(SPECIES).filter((s) => s.seed);
