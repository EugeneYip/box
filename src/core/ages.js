// World Ages: great eras that sweep over the world and bend its rules.
//
// PUBLIC CONTRACT (read by every module; owned by core)
//   game.age                     the current age, always defined:
//     { id, name, title, description, color (hex), startedAt (game s),
//       duration (game s), progress (0..1), mods }
//   game.age.mods                effective modifiers (already scaled by the
//                                ageIntensity law). Multipliers are 1 when
//                                neutral, offsets 0:
//     fertility   plant growth, crop yield, grazing        (multiplier)
//     birth       birth / growth of peoples                (multiplier)
//     storms      storm frequency                          (multiplier)
//     lightning   lightning frequency                      (multiplier)
//     fireRisk    fire ignition and spread                 (multiplier)
//     plague      contagion strength                       (multiplier)
//     fungi       mushroom spread                          (multiplier)
//     monsters    wandering monster appearances            (multiplier)
//     warlike     eagerness for war                        (multiplier)
//     techRate    research speed                           (multiplier)
//     harmony     loyalty and contentment                  (multiplier)
//     temperature climate offset, -0.5 .. +0.5 (cold .. hot)  (offset)
//     night       0 normal .. 1 long, dim nights           (offset)
//     skyTint     hex colour the sky and grade lean toward, or null
//   game.setAge(id)              begin an age now (emits 'age' {age, previous})
//   AGES                         registry, for UI listings
// Ages advance by themselves while the 'ageCycle' law is on; 'ageLength'
// scales durations and 'ageIntensity' scales the modifiers.
import { YEAR } from './time.js';

const NEUTRAL = {
  fertility: 1,
  birth: 1,
  storms: 1,
  lightning: 1,
  fireRisk: 1,
  plague: 1,
  fungi: 1,
  monsters: 1,
  warlike: 1,
  techRate: 1,
  harmony: 1,
  temperature: 0,
  night: 0,
  skyTint: null,
};

export const AGES = [
  {
    id: 'dawn',
    name: 'Age of Dawn',
    title: 'Dawn',
    description: 'A gentle, balanced era. The world breathes evenly.',
    color: 0xf2d79b,
    weight: 3,
    years: [60, 110],
    mods: {},
  },
  {
    id: 'bounty',
    name: 'Age of Bounty',
    title: 'Bounty',
    description: 'Fields overflow and families grow large. Storms are rare and plagues fade.',
    color: 0x9fd46a,
    weight: 2,
    years: [40, 80],
    mods: { fertility: 1.6, birth: 1.35, storms: 0.6, plague: 0.5, harmony: 1.2 },
  },
  {
    id: 'embers',
    name: 'Age of Embers',
    title: 'Embers',
    description: 'A hot, dry era. Forests burn easily and harvests thin.',
    color: 0xff9a52,
    weight: 1.5,
    years: [35, 70],
    mods: { temperature: 0.3, fireRisk: 2.2, lightning: 1.5, fertility: 0.8, storms: 0.7, skyTint: 0xffb070 },
  },
  {
    id: 'rime',
    name: 'Age of Rime',
    title: 'Rime',
    description: 'A long cold. Snow creeps down the mountains and rivers freeze.',
    color: 0xa9cdf0,
    weight: 1.5,
    years: [35, 70],
    mods: { temperature: -0.4, fertility: 0.6, birth: 0.85, fireRisk: 0.5, skyTint: 0xbcd6ff },
  },
  {
    id: 'tempests',
    name: 'Age of Tempests',
    title: 'Tempests',
    description: 'The skies rage. Storms and lightning lash the land.',
    color: 0x7f93ad,
    weight: 1.2,
    years: [25, 55],
    mods: { storms: 3, lightning: 2.2, fireRisk: 0.8, skyTint: 0x8a98ab },
  },
  {
    id: 'lore',
    name: 'Age of Lore',
    title: 'Lore',
    description: 'Scholars flourish. Knowledge spreads quickly and rulers favour peace.',
    color: 0xc7a6ff,
    weight: 1.5,
    years: [40, 80],
    mods: { techRate: 2.2, harmony: 1.3, warlike: 0.6 },
  },
  {
    id: 'blight',
    name: 'Age of Blight',
    title: 'Blight',
    description: 'Sickness spreads and fungi thrive while crops wither.',
    color: 0xa4b56e,
    weight: 1,
    years: [25, 50],
    mods: { plague: 3, fungi: 2.5, fertility: 0.65, birth: 0.85, harmony: 0.85, skyTint: 0xb3c08a },
  },
  {
    id: 'twilight',
    name: 'Age of Twilight',
    title: 'Twilight',
    description: 'Long, dim nights. Monsters stir in the darkness.',
    color: 0x7b6bc2,
    weight: 1,
    years: [25, 50],
    mods: { night: 0.8, monsters: 2.5, harmony: 0.9, skyTint: 0x6f62a8 },
  },
  {
    id: 'iron',
    name: 'Age of Iron',
    title: 'Iron',
    description: 'An era of conquest. Rulers covet their neighbours and armies swell.',
    color: 0xb8bcc4,
    weight: 1.2,
    years: [30, 60],
    mods: { warlike: 2.2, techRate: 1.2, harmony: 0.85 },
  },
];

export function ageDef(id) {
  return AGES.find((a) => a.id === id) || AGES[0];
}

// Scale a definition's modifiers by intensity (0 = neutral, 1 = as written).
export function effectiveMods(def, intensity = 1) {
  const out = { ...NEUTRAL };
  for (const [k, v] of Object.entries(def.mods)) {
    if (k === 'skyTint') out.skyTint = intensity > 0 ? v : null;
    else if (k === 'temperature' || k === 'night') out[k] = v * intensity;
    else out[k] = 1 + (v - 1) * intensity;
  }
  return out;
}

export class Ages {
  constructor(game) {
    this.game = game;
    this.rng = game.rng.fork('ages');
    this.begin('dawn', true);
    game.events.on('laws', ({ key }) => {
      if (key === 'ageIntensity' || key === null) this.refreshMods();
    });
  }

  begin(id, silent = false) {
    const g = this.game;
    const def = ageDef(id);
    const previous = g.age ? { ...g.age } : null;
    const [a, b] = def.years;
    const years = (a + this.rng.next() * (b - a)) * (g.laws.ageLength || 1);
    g.age = {
      id: def.id,
      name: def.name,
      title: def.title,
      description: def.description,
      color: def.color,
      startedAt: g.time.total,
      duration: years * YEAR,
      progress: 0,
      mods: effectiveMods(def, g.laws.ageIntensity ?? 1),
    };
    if (!silent) {
      g.events.emit('age', { age: g.age, previous });
      g.notify(`${def.name} begins. ${def.description}`, 'age');
    }
  }

  refreshMods() {
    const g = this.game;
    g.age.mods = effectiveMods(ageDef(g.age.id), g.laws.ageIntensity ?? 1);
  }

  next() {
    const cur = this.game.age.id;
    const pool = AGES.filter((a) => a.id !== cur);
    let total = 0;
    for (const a of pool) total += a.weight;
    let r = this.rng.next() * total;
    for (const a of pool) {
      r -= a.weight;
      if (r <= 0) return a.id;
    }
    return pool[0].id;
  }

  tick() {
    const g = this.game;
    const age = g.age;
    age.progress = Math.min(1, (g.time.total - age.startedAt) / Math.max(1, age.duration));
    if (age.progress >= 1 && g.laws.ageCycle) this.begin(this.next());
  }

  reset() {
    this.begin('dawn', true);
  }
}
