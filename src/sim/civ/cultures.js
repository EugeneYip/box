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

// Drifted peoples ('vale~3') keep their ancestors' language and style.
export function baseCulture(id) {
  if (CULTURES[id]) return id;
  const b = String(id || '').split('~')[0];
  return CULTURES[b] ? b : 'vale';
}

export function personName(culture, sex, rng) {
  const c = CULTURES[baseCulture(culture)];
  const s = c.syl[sex === 'f' ? 'f' : 'm'];
  return joinName(pick(rng, s[0]), pick(rng, s[1]));
}

export function placeName(culture, rng, used = null) {
  const c = CULTURES[baseCulture(culture)];
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
  const c = CULTURES[baseCulture(culture)];
  return pick(rng, c.forms).replace('{n}', base);
}

export function rulerTitle(culture, sex) {
  const c = CULTURES[baseCulture(culture)];
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

// Heraldic palette: tinctures spread through hue AND lightness, so that with a
// dozen realms on the map neighbours can still be told apart at a glance.
// Rich, slightly muted, never neon, no white and no near-black.
export const HERALDRY = [
  { name: 'Crimson', color: 0xb8262e },
  { name: 'Burnt Orange', color: 0xc8601c },
  { name: 'Ochre', color: 0xc99a1e },
  { name: 'Olive', color: 0x7f9126 },
  { name: 'Deep Green', color: 0x2c8040 },
  { name: 'Teal', color: 0x1c8f8a },
  { name: 'Royal Blue', color: 0x2d52b0 },
  { name: 'Violet', color: 0x7040aa },
  { name: 'Plum', color: 0xa8357c },
  { name: 'Sky', color: 0x5aa2d8 },
  { name: 'Maroon', color: 0x6e1c2c },
  { name: 'Navy', color: 0x1f2e72 },
  { name: 'Rose', color: 0xdb7a96 },
  { name: 'Slate', color: 0x5d7488 },
  { name: 'Lavender', color: 0xa892dc },
  { name: 'Copper', color: 0x8c5426 },
];

// Perceptual colour (OKLab) and distance, for telling tinctures apart.
const _lab = new Map();
export function oklab(hex) {
  let c = _lab.get(hex);
  if (c) return c;
  const lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const r = lin(((hex >> 16) & 255) / 255),
    g = lin(((hex >> 8) & 255) / 255),
    b = lin((hex & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b),
    m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
    s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  c = [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  _lab.set(hex, c);
  return c;
}
export function colorDist(a, b) {
  if (a === b) return 0;
  const x = oklab(a),
    y = oklab(b);
  // lightness counts a little less than hue and chroma on banners and borders
  return Math.hypot((x[0] - y[0]) * 0.8, x[1] - y[1], x[2] - y[2]);
}

export function hueOf(hex) {
  const r = ((hex >> 16) & 255) / 255,
    g = ((hex >> 8) & 255) / 255,
    b = (hex & 255) / 255;
  const mx = Math.max(r, g, b),
    mn = Math.min(r, g, b);
  if (mx === mn) return 0;
  const d = mx - mn;
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

// Colours that would vanish against a culture's homeland biome.
export const HERALDRY_AVOID = {
  vale: ['Deep Green', 'Olive'], // meadows and forests are green
  mire: ['Deep Green', 'Olive', 'Teal'], // swamp and jungle greens
  frost: [], // every tincture reads against snow
  dune: ['Ochre', 'Burnt Orange', 'Copper'], // sand and savanna are yellow-orange
};
