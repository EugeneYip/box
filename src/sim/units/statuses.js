// Temporary creature statuses (Life module). unit.statuses is a Map id -> seconds
// left (Infinity while a condition holds). Each: {id, name, icon, description,
// mods, defaultDuration, priority (icon order), emote (renderer icon)}.
const S = (id, name, icon, description, mods, defaultDuration, priority) => ({ id, name, icon, description, mods, defaultDuration, priority });

export const STATUSES = [
  S('burning', 'Burning', 'flame', 'On fire! Running and losing health fast.', { speed: 1.2, work: 0 }, 4, 10),
  S('sick', 'Sick', 'drop', 'Feverish and weak; may spread to others.', { speed: 0.8, work: 0.7, damage: 0.8 }, 120, 9),
  S('wounded', 'Wounded', 'cross', 'Badly hurt; slower and weaker until healed.', { speed: 0.85, damage: 0.85, work: 0.8 }, Infinity, 8),
  S('enraged', 'Enraged', 'anger', 'Blind with rage; attacks anything nearby.', { damage: 1.3, aggression: 2 }, 25, 7),
  S('frightened', 'Frightened', 'alert', 'Terrified and running for safety.', { speed: 1.15, fear: 1.5, work: 0.5 }, 5, 6),
  S('chilled', 'Chilled', 'snowflake', 'Bitter cold slows every step.', { speed: 0.8, work: 0.85 }, 30, 5),
  S('starving', 'Starving', 'bowl', 'Desperate for food; growing weaker.', { speed: 0.85, work: 0.7, damage: 0.85 }, Infinity, 4),
  S('exhausted', 'Exhausted', 'sweat', 'Needs rest badly.', { speed: 0.8, work: 0.75 }, Infinity, 3),
  S('mourning', 'Mourning', 'tear', 'Grieving a great loss.', { work: 0.85 }, 30, 2),
  S('inspired', 'Inspired', 'sun', 'Full of hope; works and fights with vigour.', { work: 1.25, damage: 1.1 }, 90, 1),
  S('blessed', 'Blessed', 'sparkle', 'Touched by the divine: tougher, faster, stronger.', { damage: 1.5, speed: 1.15 }, 40, 1),
  S('sleeping', 'Sleeping', 'zzz', 'Fast asleep.', { work: 0 }, Infinity, 0),
];

export const STATUS_BY_ID = Object.fromEntries(STATUSES.map((s) => [s.id, s]));
