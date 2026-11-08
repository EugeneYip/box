// Defensive access to the depth registries other teams own (traits, statuses,
// items, technology). They may not exist yet: import.meta.glob only binds to
// files present at build time, so a missing module simply stays null and
// every helper below degrades gracefully.
const MODS = import.meta.glob(['../sim/units/traits.js', '../sim/units/statuses.js', '../sim/units/items.js', '../sim/civ/tech.js']);
const KEY = {
  '../sim/units/traits.js': 'traits',
  '../sim/units/statuses.js': 'statuses',
  '../sim/units/items.js': 'items',
  '../sim/civ/tech.js': 'tech',
};
export const REG = { traits: null, statuses: null, items: null, tech: null };
let started = false;
export function loadRegistries(onLoad) {
  if (started) return;
  started = true;
  for (const [path, load] of Object.entries(MODS)) {
    Promise.resolve()
      .then(load)
      .then((m) => {
        REG[KEY[path]] = m;
        onLoad?.(KEY[path]);
      })
      .catch(() => {});
  }
}

const listOf = (v) => (!v ? [] : Array.isArray(v) ? v : v instanceof Map ? [...v.values()] : typeof v === 'object' ? Object.values(v) : []);
const findIn = (v, id) => {
  if (!v || id == null) return null;
  if (v instanceof Map) return v.get(id) || null;
  if (Array.isArray(v)) return v.find((x) => x && x.id === id) || null;
  return v[id] || null;
};

export function traitDef(game, id) {
  return findIn(REG.traits?.TRAITS ?? game?.units?.TRAITS, id);
}
export function statusDef(game, id) {
  return findIn(REG.statuses?.STATUSES ?? game?.units?.STATUSES, id);
}
export function techList(game) {
  return listOf(REG.tech?.TECHS ?? REG.tech?.TECH ?? game?.civ?.TECHS);
}
export function techDef(game, id) {
  return findIn(REG.tech?.TECHS ?? REG.tech?.TECH ?? game?.civ?.TECHS, id) || techList(game).find((t) => t.id === id) || null;
}
export const ERA_NAMES = ['Hearth', 'Bronze', 'Iron', 'Enlightened'];
export function eraNames() {
  const e = REG.tech?.ERAS;
  if (Array.isArray(e) && e.length) return e.map((x) => (typeof x === 'string' ? x : x?.name || ''));
  return ERA_NAMES;
}

export const prettyId = (s) =>
  String(s ?? '')
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());

// Human-readable modifier lines, e.g. {storms: 3} -> "Storms ×3".
const MOD_LABEL = {
  fertility: 'Harvests',
  birth: 'Births',
  storms: 'Storms',
  lightning: 'Lightning',
  fireRisk: 'Wildfire',
  plague: 'Plague',
  fungi: 'Fungi',
  monsters: 'Monsters',
  warlike: 'War fever',
  techRate: 'Research',
  harmony: 'Harmony',
  hp: 'Health',
  damage: 'Damage',
  speed: 'Speed',
  lifespan: 'Lifespan',
  work: 'Work speed',
  diplomacy: 'Diplomacy',
  fear: 'Fear',
  aggression: 'Aggression',
  research: 'Research',
};
export function modLines(mods) {
  const out = [];
  for (const [k, v] of Object.entries(mods || {})) {
    if (v == null) continue;
    if (k === 'skyTint') continue;
    if (k === 'temperature') {
      if (v) out.push({ text: v > 0 ? 'Warmer climate' : 'Colder climate', good: null });
      continue;
    }
    if (k === 'night') {
      if (v) out.push({ text: 'Long, dim nights', good: null });
      continue;
    }
    if (typeof v !== 'number') continue;
    const label = MOD_LABEL[k] || prettyId(k);
    if (Math.abs(v - 1) < 1e-3 && v !== 0) continue;
    const txt = `×${+v.toFixed(2)}`;
    const bad = /plague|storms|lightning|fireRisk|monsters|warlike|fear/.test(k);
    out.push({ text: `${label} ${txt}`, good: v > 1 ? !bad : bad });
  }
  return out;
}
