import { registerPower } from './registry.js';

// BASELINE civilization powers (Civilization owner extends; keep ids stable).
registerPower({
  id: 'found-village',
  name: 'Found Village',
  category: 'civ',
  description: 'Send a band of settlers to found a new village here.',
  mode: 'click',
  brush: null,
  apply: (g, c) => {
    if (!g.world.isLand(c.tx, c.ty)) return;
    g.civ.foundVillage(c.tx, c.ty);
  },
});
