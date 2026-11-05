// God-power registry. Each power module calls registerPower() at import time;
// src/powers/index.js imports every power module. The UI builds its toolbar
// from listPowers() grouped by category.
//
// Power definition:
// {
//   id: 'raise',                 unique id (also used as icon key by the UI)
//   name: 'Raise Land',          display name
//   category: 'terrain',         one of CATEGORIES ids
//   description: '...',          tooltip text
//   mode: 'brush' | 'click',     brush: applied every frame while held;
//                                click: applied once per press
//   brush: { size: 4, min: 1, max: 24 } | null,   default brush radius (tiles)
//   interval: 0,                 brush mode: min seconds between applications
//   icon: '<svg…>' (optional)    otherwise the UI's own icon set is used
//   cursorColor: '#ffffff' (optional) brush ring tint
//   apply(game, ctx)             ctx = { x, z, tx, ty, radius, dt, first,
//                                        button, shift, strength }
//   onSelect?(game), onDeselect?(game)
// }
export const CATEGORIES = [
  { id: 'terrain', name: 'Shape' },
  { id: 'biome', name: 'Biomes' },
  { id: 'nature', name: 'Nature' },
  { id: 'life', name: 'Life' },
  { id: 'civ', name: 'Peoples' },
  { id: 'disaster', name: 'Wrath' },
  { id: 'world', name: 'World' },
];

const powers = new Map();
const order = [];

export function registerPower(def) {
  if (!def || !def.id) throw new Error('power needs an id');
  const p = {
    mode: 'brush',
    brush: { size: 3, min: 1, max: 24 },
    interval: 0,
    description: '',
    ...def,
  };
  if (!powers.has(p.id)) order.push(p.id);
  powers.set(p.id, p);
  return p;
}
export function getPower(id) {
  return powers.get(id) || null;
}
export function listPowers(category = null) {
  return order.map((id) => powers.get(id)).filter((p) => !category || p.category === category);
}
