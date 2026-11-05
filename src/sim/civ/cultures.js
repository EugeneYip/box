import { TILE } from '../../world/constants.js';

// Original Worldseed cultures. Each has its own homeland biomes, naming
// language, ruler titles, kingdom forms and an architecture style id that the
// BuildingRenderer understands ('vale' | 'dune' | 'frost' | 'mire').
//
//   Valeborn  — temperate meadow and forest folk: timber frames, whitewash, thatch and clay tile.
//   Qadari    — desert and savanna traders: sandstone, flat roofs, domes and wind-catchers.
//   Hrimfolk  — northern tundra clans: slate, fieldstone and dark timber under steep roofs.
//   Tikari    — swamp and jungle river people: stilt houses with saddle-shaped thatch roofs.

const pick = (rng, a) => a[Math.floor(rng.next() * a.length)];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function joinName(a, b) {
  // avoid triple letters and awkward doubled vowels at the seam
  const last = a[a.length - 1].toLowerCase();
  const first = b[0].toLowerCase();
  if (last === first && 'aeiou'.includes(last)) b = b.slice(1);
  return cap(a + b);
}

export const CULTURES = {
  vale: {
    id: 'vale',
    name: 'Valeborn',
    style: 'vale',
    homeland: [TILE.GRASS, TILE.FOREST, TILE.SOIL],
    titles: { m: 'King', f: 'Queen' },
    heir: 'Prince',
    forms: ['Kingdom of {n}', 'Crown of {n}', '{n} March', 'Realm of {n}', 'Duchy of {n}', 'Free Shires of {n}'],
    adjective: 'Valeborn',
    syl: {
      m: [['Al', 'Bran', 'Ced', 'Ed', 'Gar', 'Har', 'Os', 'Rod', 'Wil', 'Ald', 'Ber', 'Cuth', 'Dun', 'Fen', 'Gil', 'Mer', 'Tam', 'Wyn', 'Hal', 'Col'], ['ric', 'wyn', 'mund', 'ard', 'fred', 'ley', 'ton', 'win', 'bald', 'an', 'ock', 'red', 'wick', 'bert']],
      f: [['Ael', 'Bry', 'Cel', 'Eda', 'Gwen', 'Isol', 'Mar', 'Ros', 'Wyn', 'Ely', 'Hild', 'Mae', 'Sel', 'Tess', 'Ivy', 'Lor'], ['wen', 'da', 'ith', 'a', 'ys', 'elle', 'ora', 'wyn', 'ine', 'aine', 'ett', 'ian']],
      place: [['Ash', 'Bram', 'Elder', 'Fern', 'Hollow', 'Thorn', 'Wick', 'Briar', 'Mill', 'Oak', 'Willow', 'Marl', 'Hazel', 'Wren', 'Dun', 'Stone', 'Bright', 'Fox', 'Ember', 'Lark', 'Rush', 'Heath', 'Bell', 'Clover'], ['ford', 'wick', 'mere', 'stead', 'brook', 'dale', 'holm', 'ham', 'ton', 'field', 'bury', 'combe', 'ley', 'haven', 'moor', 'gate', 'well', 'vale', 'hurst', 'thorpe']],
    },
    peopleWord: 'villagers',
  },
  dune: {
    id: 'dune',
    name: 'Qadari',
    style: 'dune',
    homeland: [TILE.DESERT, TILE.SAVANNA, TILE.SAND],
    titles: { m: 'Emir', f: 'Emira' },
    heir: 'Vizier',
    forms: ['Emirate of {n}', 'Sunthrone of {n}', '{n} Dominion', 'Sands of {n}', 'Satrapy of {n}', 'Golden Court of {n}'],
    adjective: 'Qadari',
    syl: {
      m: [['Ka', 'Ra', 'Ze', 'Ha', 'Ta', 'Sa', 'Na', 'Fa', 'Ja', 'Ma', 'Az', 'Ib', 'Ul', 'Dar', 'Kha'], ['shir', 'rim', 'dun', 'zar', 'mal', 'kir', 'sim', 'had', 'ran', 'fir', 'lam', 'vash', 'rek']],
      f: [['Sa', 'La', 'Ya', 'Na', 'Ze', 'Am', 'Ra', 'Ish', 'Nu', 'Sha', 'Ta', 'Mi'], ['hra', 'rin', 'mira', 'sa', 'lia', 'dah', 'nia', 'ya', 'zeh', 'ani', 'rai']],
      place: [['Qa', 'Sar', 'Zah', 'Al', 'Bar', 'Kha', 'Nah', 'Tal', 'Esh', 'Mer', 'Dun', 'Ras', 'Sul', 'Az', 'Ima', 'Har', 'Qir', 'Oma'], ['rim', 'abad', 'qir', 'zan', 'hal', 'mar', 'esh', 'kand', 'ra', 'dur', 'sun', 'ira', 'thar', 'veh', 'mun']],
    },
    peopleWord: 'townsfolk',
  },
  frost: {
    id: 'frost',
    name: 'Hrimfolk',
    style: 'frost',
    homeland: [TILE.TUNDRA, TILE.SNOW],
    titles: { m: 'Jarl', f: 'Jarla' },
    heir: 'Thane',
    forms: ['Jarldom of {n}', '{n} Holds', 'Thanedom of {n}', 'Kingdom of {n}', 'Shieldlands of {n}', '{n} Hearthmoot'],
    adjective: 'Hrimfolk',
    syl: {
      m: [['Bjor', 'Hal', 'Tor', 'Ulf', 'Sig', 'Ein', 'Rag', 'Grim', 'Hrol', 'Sten', 'Vid', 'Ask', 'Orm', 'Skar', 'Arn', 'Kol'], ['vald', 'mund', 'geir', 'ulf', 'ar', 'rik', 'bjorn', 'dor', 'vin', 'stein', 'ketil', 'mar']],
      f: [['Ast', 'Ing', 'Sig', 'Gud', 'Hild', 'Rag', 'Sol', 'Thy', 'Fey', 'Ylv', 'Ran', 'Alf', 'Brun'], ['rid', 'a', 'run', 'dis', 'hild', 'veig', 'ny', 'borg', 'gerd', 'laug']],
      place: [['Hrim', 'Kald', 'Skel', 'Frost', 'Vind', 'Ulf', 'Jarn', 'Storm', 'Isen', 'Grav', 'Hvit', 'Mork', 'Fjel', 'Svart', 'Varg', 'Kolm'], ['heim', 'vik', 'gard', 'fjord', 'holt', 'stad', 'berg', 'by', 'nes', 'dal', 'hus', 'vang', 'mark']],
    },
    peopleWord: 'clansfolk',
  },
  mire: {
    id: 'mire',
    name: 'Tikari',
    style: 'mire',
    homeland: [TILE.SWAMP, TILE.JUNGLE],
    titles: { m: 'High Chief', f: 'High Chieftess' },
    heir: 'Elder',
    forms: ['{n} Confederacy', 'Chiefdom of {n}', '{n} League', 'Riverlands of {n}', 'Isles of {n}', 'Canopy of {n}'],
    adjective: 'Tikari',
    syl: {
      m: [['Ta', 'Ko', 'Mu', 'Ri', 'Ka', 'Lo', 'Ne', 'Pa', 'Tu', 'Wa', 'Ze', 'Ho', 'Ra', 'Iku'], ['nui', 'kai', 'loa', 'tu', 'mano', 'rau', 'iko', 'pe', 'ani', 'oro', 'tane']],
      f: [['Ai', 'Le', 'Ma', 'Na', 'Ki', 'Mo', 'Ilo', 'Ua', 'Ha', 'Pua', 'Re', 'Tia'], ['lani', 'ana', 'ea', 'mei', 'ira', 'ula', 'ini', 'oa', 'nehe']],
      place: [['Mo', 'Ta', 'Kai', 'Wai', 'Ulu', 'Nara', 'Pele', 'Oro', 'Rua', 'Tiki', 'Hana', 'Ivi', 'Lua', 'Vana', 'Kora'], ['moku', 'nui', 'kai', 'loa', 'pa', 'reva', 'tuku', 'vai', 'manu', 'anga', 'roa']],
    },
    peopleWord: 'tribesfolk',
  },
};

export const CULTURE_IDS = Object.keys(CULTURES);

export function personName(culture, sex, rng) {
  const c = CULTURES[culture] || CULTURES.vale;
  const s = c.syl[sex === 'f' ? 'f' : 'm'];
  return joinName(pick(rng, s[0]), pick(rng, s[1]));
}

export function placeName(culture, rng, used = null) {
  const c = CULTURES[culture] || CULTURES.vale;
  for (let k = 0; k < 30; k++) {
    const n = joinName(pick(rng, c.syl.place[0]), pick(rng, c.syl.place[1]));
    if (!used || !used.has(n)) {
      used?.add(n);
      return n;
    }
  }
  return joinName(pick(rng, c.syl.place[0]), pick(rng, c.syl.place[1])) + ' ' + rng.int(2, 9);
}

export function kingdomName(culture, base, rng) {
  const c = CULTURES[culture] || CULTURES.vale;
  return pick(rng, c.forms).replace('{n}', base);
}

export function rulerTitle(culture, sex) {
  const c = CULTURES[culture] || CULTURES.vale;
  return c.titles[sex === 'f' ? 'f' : 'm'];
}

// Score how well a tile suits each culture (temperature / moisture / biome).
export function cultureForSite(world, tx, ty, radius = 6) {
  const score = { vale: 0, dune: 0, frost: 0, mire: 0 };
  world.forEachInRadius(tx + 0.5, ty + 0.5, radius, (x, y, d, i) => {
    if (world.height[i] < 0) return;
    const t = world.type[i];
    const temp = world.temperature[i];
    const moist = world.moisture[i];
    for (const id of CULTURE_IDS) if (CULTURES[id].homeland.includes(t)) score[id] += 1.2;
    if (temp < 0.34) score.frost += 0.8;
    else if (temp > 0.74 && moist < 0.45) score.dune += 0.8;
    else if (moist > 0.7 && temp > 0.55) score.mire += 0.6;
    else score.vale += 0.5;
  });
  let best = 'vale',
    bv = -1;
  for (const id of CULTURE_IDS)
    if (score[id] > bv) {
      bv = score[id];
      best = id;
    }
  return best;
}

// Curated heraldic palette: saturated, distinct from each other and from the
// terrain greens / sands so territory tints stay readable.
export const HERALDRY = [
  { name: 'Crimson', color: 0xd23b3b },
  { name: 'Azure', color: 0x2f6fe0 },
  { name: 'Gold', color: 0xf0b62a },
  { name: 'Violet', color: 0x8c46d0 },
  { name: 'Teal', color: 0x17b3a6 },
  { name: 'Ember', color: 0xf27420 },
  { name: 'Rose', color: 0xe9559e },
  { name: 'Ivory', color: 0xf3ede0 },
  { name: 'Indigo', color: 0x3b3fa8 },
  { name: 'Burgundy', color: 0x8e1f3a },
  { name: 'Sky', color: 0x3cc2ee },
  { name: 'Sable', color: 0x3a3842 },
  { name: 'Copper', color: 0xb5651d },
  { name: 'Lilac', color: 0xc29be8 },
];
