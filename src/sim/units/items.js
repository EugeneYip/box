// Equipment (Life module): slots, materials, quality and legendary items.
// Item: {id, slot, kind, material, quality, name, power, origin?, history?, legendary?}
export const SLOTS = ['weapon', 'armor', 'tool', 'trinket'];

// index = renderer palette slot (metal colour on the model)
export const MATERIALS = {
  wood: { name: 'Wooden', power: 0.6, index: 1, color: 0x9a6a3c },
  stone: { name: 'Stone', power: 0.8, index: 2, color: 0x9a968f },
  bronze: { name: 'Bronze', power: 1.0, index: 3, color: 0xc8894a },
  iron: { name: 'Iron', power: 1.3, index: 4, color: 0x8a8f98 },
  steel: { name: 'Steel', power: 1.6, index: 5, color: 0xd6dde6 },
  starsteel: { name: 'Starsteel', power: 2.4, index: 6, color: 0x9fd8ff },
};
export const QUALITIES = {
  crude: { name: 'Crude', power: 0.7 },
  common: { name: '', power: 1.0 },
  fine: { name: 'Fine', power: 1.2 },
  masterwork: { name: 'Masterwork', power: 1.45 },
  legendary: { name: 'Legendary', power: 1.9 },
};
const BASE = { weapon: 6, armor: 5, tool: 4, trinket: 2 };
const KIND_NAME = { sword: 'Sword', axe: 'Axe', spear: 'Spear', bow: 'Bow', mace: 'Mace', hammer: 'Hammer', mail: 'Mail', plate: 'Plate', shield: 'Shield', pick: 'Pick', sickle: 'Sickle', amulet: 'Amulet', ring: 'Ring', charm: 'Charm' };
const DEFAULT_KIND = { weapon: 'sword', armor: 'mail', tool: 'hammer', trinket: 'charm' };

// Legendary names: original two-part compounds.
const LA = ['Dawn', 'Ember', 'Frost', 'Storm', 'Star', 'Thorn', 'Ash', 'Gloam', 'Iron', 'Sun', 'Moon', 'Wyrm', 'Oath', 'Rime', 'Hollow', 'Bright', 'Grief', 'Wild', 'Dusk', 'Gale', 'Brine', 'Cinder', 'Hearth', 'Raven', 'Silver', 'Thunder', 'Vale', 'Wraith', 'Elder', 'Night', 'Kestrel', 'Morrow', 'Sorrow', 'Glimmer', 'Barrow', 'Tide'];
const LB = { weapon: ['brand', 'fang', 'reaver', 'song', 'bite', 'edge', 'call', 'wrath', 'cleaver', 'thorn', 'sunder', 'spite', 'claw', 'warden', 'howl', 'fall', 'mourn', 'breaker'], armor: ['ward', 'mantle', 'shell', 'aegis', 'hide', 'bulwark', 'veil', 'carapace', 'bastion', 'shroud'], tool: ['maker', 'wright', 'delver', 'hand', 'shaper', 'mender'], trinket: ['heart', 'eye', 'tear', 'seal', 'charm', 'star', 'locket', 'knot'] };

let nextId = 1;
function pick(a, r) {
  return a[Math.floor(r * a.length) % a.length];
}

// spec: {slot, kind?, material?, quality?, origin?, year?, name?, maker?}
export function makeItem(spec = {}, rng = Math.random) {
  const slot = SLOTS.includes(spec.slot) ? spec.slot : 'weapon';
  const quality = QUALITIES[spec.quality] ? spec.quality : 'common';
  let material = MATERIALS[spec.material] ? spec.material : slot === 'trinket' ? 'bronze' : 'iron';
  if (material === 'starsteel' && quality !== 'legendary') material = 'steel';
  const kind = spec.kind || DEFAULT_KIND[slot];
  const power = Math.round(BASE[slot] * MATERIALS[material].power * QUALITIES[quality].power * 10) / 10;
  const item = { id: 'it' + nextId++, slot, kind, material, quality, power, name: '' };
  if (quality === 'legendary') {
    item.legendary = true;
    item.name = spec.name || pick(LA, rng()) + pick(LB[slot], rng());
    if (spec.taken) for (let k = 0; k < 40 && spec.taken.has(item.name); k++) item.name = pick(LA, rng()) + pick(LB[slot], rng());
    const where = spec.origin ? `forged in ${spec.origin}` : 'of unknown make';
    item.history = `${where}${spec.year != null ? `, Year ${spec.year}` : ''}`;
  } else {
    const q = QUALITIES[quality].name;
    item.name = [q, MATERIALS[material].name, KIND_NAME[kind] || kind].filter(Boolean).join(' ');
  }
  if (spec.origin) item.origin = spec.origin;
  return item;
}

// Renderer tool option for a weapon kind (see models/humanoid.js TOOL_OPT)
export const WEAPON_TOOL = { sword: 8, axe: 1, spear: 5, bow: 9, mace: 4, hammer: 4, pick: 3 };
