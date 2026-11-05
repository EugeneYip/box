import { registerPower } from './registry.js';

// BASELINE disaster powers (Effects & Disasters owner extends; keep ids stable).
registerPower({
  id: 'fire',
  name: 'Fire',
  category: 'disaster',
  description: 'Set the land ablaze.',
  brush: { size: 1, min: 1, max: 6 },
  interval: 0.1,
  apply: (g, c) => {
    g.world.forEachInRadius(c.x, c.z, c.radius, (tx, ty) => g.disasters.ignite(tx, ty, 1));
  },
});
