// Creature traits (Life module). Original set of 36 in five categories.
// Each: {id, name, category, description, icon, rarity (0..1 birth weight), mods, opposite?}
// mods are multipliers: hp, damage, speed, lifespan, work, fertility, diplomacy,
// fear, aggression, research, sight. Opposite traits never coexist.
// Scar traits are earned through events and are never inborn.
const T = (id, name, category, description, icon, rarity, mods, opposite = null) => ({ id, name, category, description, icon, rarity, mods, opposite });

export const TRAITS = [
  // ---- body
  T('mighty', 'Mighty', 'body', 'Broad-shouldered and strong; hits hard and shrugs off blows.', 'fist', 0.06, { hp: 1.15, damage: 1.3 }, 'frail'),
  T('frail', 'Frail', 'body', 'Thin-boned and easily hurt.', 'feather', 0.05, { hp: 0.75, damage: 0.8 }, 'mighty'),
  T('swift', 'Swift', 'body', 'Quick on their feet.', 'wind', 0.06, { speed: 1.2 }, 'lumbering'),
  T('lumbering', 'Lumbering', 'body', 'Slow and heavy, but hard to topple.', 'boulder', 0.04, { speed: 0.85, hp: 1.1 }, 'swift'),
  T('towering', 'Towering', 'body', 'A head above everyone else.', 'tower', 0.04, { hp: 1.2, damage: 1.1, speed: 0.95 }, 'small'),
  T('small', 'Small', 'body', 'Slight of build and nimble.', 'mouse', 0.05, { hp: 0.85, speed: 1.05, fertility: 1.1 }, 'towering'),
  T('hardy', 'Hardy', 'body', 'Rarely ill and long-lived.', 'shield', 0.06, { hp: 1.2, lifespan: 1.1 }, 'sickly'),
  T('sickly', 'Sickly', 'body', 'Often unwell; a shorter life.', 'drop', 0.04, { hp: 0.8, lifespan: 0.85 }, 'hardy'),
  T('fertile', 'Fertile', 'body', 'Has many children.', 'heart', 0.05, { fertility: 1.4 }, 'barren'),
  T('barren', 'Barren', 'body', 'Rarely has children.', 'stone', 0.03, { fertility: 0.3 }, 'fertile'),
  T('keen-eyed', 'Keen-eyed', 'body', 'Spots danger and prey from afar.', 'eye', 0.05, { sight: 1.3 }),
  // ---- mind
  T('sage', 'Sage', 'mind', 'Deeply learned; a boon to any council.', 'book', 0.04, { research: 1.5, work: 1.05, lifespan: 1.05 }, 'dim'),
  T('dim', 'Dim', 'mind', 'Slow to grasp new things.', 'fog', 0.05, { research: 0.6, work: 0.95 }, 'sage'),
  T('curious', 'Curious', 'mind', 'Wants to know how everything works.', 'compass', 0.06, { research: 1.2, fear: 0.85 }),
  T('stubborn', 'Stubborn', 'mind', 'Never backs down, never gives in.', 'anvil', 0.05, { fear: 0.8, diplomacy: 0.8 }),
  T('inventive', 'Inventive', 'mind', 'Always tinkering with a better way.', 'gear', 0.04, { research: 1.4, work: 1.1 }),
  // ---- spirit
  T('valiant', 'Valiant', 'spirit', 'Brave to a fault; first into battle.', 'sword', 0.05, { fear: 0.5, damage: 1.1, aggression: 1.2 }, 'craven'),
  T('craven', 'Craven', 'spirit', 'Flees at the first sign of danger.', 'run', 0.05, { fear: 1.8, damage: 0.9 }, 'valiant'),
  T('gentle', 'Gentle', 'spirit', 'Kind and slow to anger.', 'leaf', 0.06, { aggression: 0.6, diplomacy: 1.3 }, 'cruel'),
  T('cruel', 'Cruel', 'spirit', 'Delights in the suffering of others.', 'skull', 0.03, { aggression: 1.5, damage: 1.1, diplomacy: 0.7 }, 'gentle'),
  T('greedy', 'Greedy', 'spirit', 'Hoards whatever they can.', 'coin', 0.05, { work: 1.1, diplomacy: 0.85 }, 'generous'),
  T('generous', 'Generous', 'spirit', 'Shares freely with neighbours.', 'gift', 0.05, { diplomacy: 1.2 }, 'greedy'),
  T('devout', 'Devout', 'spirit', 'Faith keeps them steady.', 'candle', 0.05, { fear: 0.8, lifespan: 1.05 }),
  T('restless', 'Restless', 'spirit', 'Always wandering, never settled.', 'boot', 0.05, { speed: 1.05, work: 0.95 }),
  T('loyal', 'Loyal', 'spirit', 'Stands by their people through anything.', 'banner', 0.05, { diplomacy: 1.1, fear: 0.9 }),
  // ---- gifts (rare)
  T('lucky', 'Lucky', 'gift', 'Blows seem to miss them.', 'clover', 0.025, { hp: 1.05 }),
  T('starborn', 'Starborn', 'gift', 'Born under a falling star; glows faintly and excels at everything.', 'star', 0.006, { hp: 1.25, damage: 1.25, lifespan: 1.3, research: 1.2, work: 1.1 }),
  T('fireheart', 'Fireheart', 'gift', 'Flames barely touch them.', 'flame', 0.015, { damage: 1.15 }),
  T('frostborn', 'Frostborn', 'gift', 'Cold never bites them.', 'snowflake', 0.015, { hp: 1.05 }),
  T('green-thumbed', 'Green-thumbed', 'gift', 'Plants flourish under their care.', 'sprout', 0.02, { work: 1.25 }),
  T('silver-tongued', 'Silver-tongued', 'gift', 'Words that could charm a wolf.', 'chat', 0.015, { diplomacy: 1.6 }),
  // ---- scars (earned)
  T('veteran', 'Veteran', 'scar', 'Has survived many battles.', 'helmet', 0, { damage: 1.15, fear: 0.8 }),
  T('scarred', 'Scarred', 'scar', 'Carries the marks of a terrible wound.', 'scar', 0, { hp: 0.95, fear: 0.9 }),
  T('survivor', 'Survivor', 'scar', 'Lived through a disaster that took others.', 'flame', 0, { hp: 1.1, lifespan: 1.05 }),
  T('kinslayer', 'Kinslayer', 'scar', 'Killed one of their own people.', 'skull', 0, { aggression: 1.3, diplomacy: 0.6 }),
  T('plague-touched', 'Plague-touched', 'scar', 'Survived the plague; it cannot take them again.', 'drop', 0, { hp: 0.9 }),
  T('hero', 'Hero', 'scar', 'A living legend whose deeds are sung in every hall.', 'crown', 0, { hp: 1.3, damage: 1.3, fear: 0.3 }),
];

export const TRAIT_BY_ID = Object.fromEntries(TRAITS.map((t) => [t.id, t]));
// Inborn traits suitable for animals (body only).
export const ANIMAL_TRAITS = TRAITS.filter((t) => t.category === 'body' && t.rarity > 0).map((t) => t.id);
export const BORN_TRAITS = TRAITS.filter((t) => t.rarity > 0);
