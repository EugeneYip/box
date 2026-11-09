import { registerPower } from './registry.js';

// Civilization powers (category 'civ'). Ids are stable; the UI keys icons on them.
//
// Two-kingdom powers (war, peace, alliance) are picked in sequence: the first
// click chooses a realm (its capital is ringed in its colour), the second click
// chooses the other realm. Clicking the same realm again, or Esc, cancels.

const CULTURE_POWERS = [
  ['found-vale', 'Valeborn Village', 'vale', 'Found a Valeborn village of timber frames and golden thatch. Thrives in green meadows and forests.'],
  ['found-dune', 'Qadari Village', 'dune', 'Found a Qadari village of sandstone, domes and wind-catchers. At home in deserts and savanna.'],
  ['found-frost', 'Hrimfolk Village', 'frost', 'Found a Hrimfolk village of fieldstone and steep slate roofs. Hardy folk of the cold north.'],
  ['found-mire', 'Tikari Village', 'mire', 'Found a Tikari village of stilt houses and saddle-shaped roofs. Masters of swamp and jungle.'],
];

function landOk(g, c) {
  if (!g.world.isLand(c.tx, c.ty)) {
    g.notify('Settlers need dry land to build on.', 'bad', { x: c.x, z: c.z });
    return false;
  }
  return true;
}

function found(g, c, culture) {
  if (!landOk(g, c)) return;
  const owner = g.civ.kingdomAt?.(c.tx, c.ty);
  // inside a kingdom's borders the settlers swear fealty to it
  const v = g.civ.foundVillage(c.tx, c.ty, { culture, kingdom: owner ? owner.id : null, starter: true, houses: 1, settlers: 9 });
  if (v) {
    g.fx?.burst?.('spawn', { x: v.cx, z: v.cz }, 10, { scale: 1.5 });
    g.audio?.play?.('bell', { pos: { x: v.cx, z: v.cz } });
    if (owner) g.notify(`${v.name} is founded within the ${owner.name}.`, 'good', { x: v.cx, z: v.cz });
  }
}

registerPower({
  id: 'found-village',
  name: 'Found Village',
  category: 'civ',
  description: 'Send a band of settlers to found a new village here. Their culture follows the land.',
  mode: 'click',
  brush: null,
  apply: (g, c) => found(g, c, null),
});

for (const [id, name, culture, desc] of CULTURE_POWERS) {
  registerPower({ id, name, category: 'civ', description: desc, mode: 'click', brush: null, apply: (g, c) => found(g, c, culture) });
}

// ------------------------------------------------------------------ kingdom picking
function kingdomUnder(g, c) {
  const civ = g.civ;
  let k = civ.kingdomAt?.(c.tx, c.ty);
  if (!k) {
    const v = civ.villageAt?.(c.x, c.z, 14);
    if (v) k = civ.kingdoms[v.kingdom];
  }
  return k && k.alive ? k : null;
}

let picking = null; // {power, first}

function resetPick(g) {
  picking = null;
  if (g.civ) g.civ.powerPick = null;
}

function pairPower(id, name, description, verb, act) {
  registerPower({
    id,
    name,
    category: 'civ',
    description,
    mode: 'click',
    brush: null,
    onSelect: (g) => {
      resetPick(g);
      g.notify(`${name}: click the first kingdom.`, 'info');
    },
    onDeselect: (g) => resetPick(g),
    apply: (g, c) => {
      const k = kingdomUnder(g, c);
      if (!k) {
        g.notify('Click inside a kingdom’s borders.', 'bad', { x: c.x, z: c.z });
        return;
      }
      if (!picking || picking.power !== id) {
        picking = { power: id, first: k.id };
        g.civ.powerPick = { kingdom: k.id, t: g.time.realTime };
        g.notify(`The ${k.name} is chosen. Now click the kingdom it will ${verb}.`, 'info', g.civ._kingdomPos?.(k));
        return;
      }
      const a = picking.first;
      if (a === k.id) {
        resetPick(g);
        g.notify('Selection cleared.', 'info');
        return;
      }
      act(g, a, k.id);
      resetPick(g);
    },
  });
}

pairPower('declare-war', 'Declare War', 'Pit two kingdoms against each other: click the aggressor, then its victim.', 'attack', (g, a, b) => {
  const civ = g.civ;
  if (civ.atWar(a, b)) return g.notify('Those kingdoms are already at war.', 'info');
  const r = civ.rel(a, b);
  r.truceUntil = 0;
  civ.declareWar(a, b, 'god');
  g.cameraRig?.addShake?.(0.3);
});

pairPower('make-peace', 'Make Peace', 'Force two warring kingdoms to lay down their arms: click one, then the other.', 'make peace with', (g, a, b) => {
  const civ = g.civ;
  if (!civ.atWar(a, b)) return g.notify(`The ${civ.kingdomName(a)} and the ${civ.kingdomName(b)} are not at war.`, 'info');
  civ.makePeace(a, b);
  g.audio?.play?.('bell', {});
});

pairPower('forge-alliance', 'Forge Alliance', 'Bind two kingdoms in friendship: click one, then the other.', 'ally with', (g, a, b) => {
  const civ = g.civ;
  if (civ.atWar(a, b)) civ.makePeace(a, b, true);
  const r = civ.rel(a, b);
  r.ally = true;
  r.opinion = Math.max(r.opinion, 70);
  g.notify(`The ${civ.kingdomName(a)} and the ${civ.kingdomName(b)} swear an alliance.`, 'good', civ._kingdomPos?.(civ.kingdoms[a]));
});

// ------------------------------------------------------------------ single-target
function villageUnder(g, c) {
  const civ = g.civ;
  const b = civ._buildingAtPoint?.(c.x, c.z);
  if (b && b.alive) return civ.villages[b.village];
  const v = civ.villageAt?.(c.x, c.z, 16);
  return v && v.alive ? v : null;
}

registerPower({
  id: 'incite-rebellion',
  name: 'Incite Rebellion',
  category: 'civ',
  description: 'Whisper sedition in a village: it rises against its kingdom and proclaims a realm of its own.',
  mode: 'click',
  brush: null,
  apply: (g, c) => {
    const civ = g.civ;
    const v = villageUnder(g, c);
    if (!v) return g.notify('Click on a village.', 'bad', { x: c.x, z: c.z });
    const k = civ.kingdoms[v.kingdom];
    if (k && k.capital === v.id) {
      if (k.villages.length <= 1) return g.notify(`${v.name} is the heart of its realm; there is no one to rebel against.`, 'info', { x: v.cx, z: v.cz });
      // the capital topples its ruler instead: the realm splits around the largest town
      const other = k.villages.map((id) => civ.villages[id]).filter((o) => o && o.alive && o.id !== v.id).sort((p, q) => q.pop - p.pop)[0];
      if (other) civ.rebel(other, false, true);
      return;
    }
    civ.rebel(v, false, true);
    g.fx?.burst?.('magic', { x: v.cx, z: v.cz }, 10, { scale: 1.5, color: 0xff4040 });
    g.cameraRig?.addShake?.(0.2);
  },
});

registerPower({
  id: 'golden-age',
  name: 'Golden Age',
  category: 'civ',
  description: 'Bless a kingdom with a golden age: faster work, more births and loyal subjects for years.',
  mode: 'click',
  brush: null,
  apply: (g, c) => {
    const k = kingdomUnder(g, c);
    if (!k) return g.notify('Click inside a kingdom’s borders.', 'bad', { x: c.x, z: c.z });
    g.civ.goldenAge(k.id);
    g.fx?.screenFlash?.(0xfff0b0, 0.25);
  },
});

registerPower({
  id: 'bountiful-harvest',
  name: 'Bountiful Harvest',
  category: 'civ',
  description: 'Grant a village plenty: its granaries fill and every field ripens at once.',
  mode: 'click',
  brush: null,
  apply: (g, c) => {
    const v = villageUnder(g, c);
    if (!v) return g.notify('Click on a village.', 'bad', { x: c.x, z: c.z });
    g.civ.grantPlenty(v);
  },
});
