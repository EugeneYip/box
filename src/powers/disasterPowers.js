import { registerPower } from './registry.js';

// Disaster powers (category 'disaster', shown under "Wrath"). Ids are stable;
// the UI renders icons by id. All heavy lifting lives in game.disasters.
const R = Math.random;
const audio = (g, name, c, v = 1) => {
  try {
    g.audio?.play?.(name, { pos: { x: c.x, z: c.z }, volume: v });
  } catch (e) {
    /* optional */
  }
};

registerPower({
  id: 'fire',
  name: 'Fire',
  category: 'disaster',
  description: 'Set the land ablaze. Fire races downwind and uphill through dry grass and forest.',
  brush: { size: 1, min: 1, max: 6 },
  interval: 0.1,
  cursorColor: '#ff9a3c',
  apply: (g, c) => {
    const ds = g.disasters;
    g.world.forEachInRadius(c.x, c.z, c.radius, (tx, ty, d) => {
      if (R() < 0.75 - d * 0.35) ds.fire.ignite(tx, ty, 1, { flash: true });
    });
    const n = 1 + Math.round(c.radius * 0.8);
    for (let k = 0; k < n; k++) {
      const a = R() * Math.PI * 2,
        r = Math.sqrt(R()) * c.radius;
      g.fx.emit('fire', { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r }, { scale: 0.9, count: 3 });
    }
    if (c.first) audio(g, 'fire-start', c);
  },
});

registerPower({
  id: 'inferno',
  name: 'Inferno',
  category: 'disaster',
  description: 'Paint a roaring wall of flame that burns even damp ground.',
  brush: { size: 4, min: 2, max: 12 },
  interval: 0.12,
  cursorColor: '#ff5a1c',
  apply: (g, c) => {
    const ds = g.disasters;
    g.world.forEachInRadius(c.x, c.z, c.radius, (tx, ty, d) => {
      if (R() < 0.9 - d * 0.3) ds.fire.ignite(tx, ty, 1, { flash: true, fuelBoost: 0.5 });
    });
    const n = 2 + Math.round(c.radius * 0.9);
    for (let k = 0; k < n; k++) {
      const a = R() * Math.PI * 2,
        r = Math.sqrt(R()) * c.radius;
      const x = c.x + Math.cos(a) * r,
        z = c.z + Math.sin(a) * r;
      g.fx.emit('fireball', { x, z }, { scale: 0.8 + R() * 0.6, count: 2 });
      g.fx.emit('fire', { x, z }, { scale: 1.4, count: 3 });
    }
    g.fx.emit('embers', { x: c.x, z: c.z }, { count: 6, scale: 1.4 });
    g.fx.addLight({ x: c.x, z: c.z }, 0xff8a30, 2.5, 0.35);
    if (c.first) audio(g, 'fire-start', c, 1);
  },
});

registerPower({
  id: 'meteor',
  name: 'Meteor',
  category: 'disaster',
  description: 'Call down a blazing meteor. Brush size sets the crater.',
  mode: 'click',
  brush: { size: 4, min: 2, max: 9 },
  cursorColor: '#ffb070',
  apply: (g, c) => g.disasters.meteor(c.x, c.z, { size: Math.max(2, c.radius || 4) }),
});

registerPower({
  id: 'meteor-shower',
  name: 'Meteor Shower',
  category: 'disaster',
  description: 'A volley of fiery stones rains over a wide area.',
  mode: 'click',
  brush: { size: 14, min: 6, max: 24 },
  cursorColor: '#ffb070',
  apply: (g, c) => g.disasters.meteorShower(c.x, c.z, c.radius || 14, 6 + Math.round((c.radius || 14) * 0.35)),
});

registerPower({
  id: 'lightning',
  name: 'Lightning',
  category: 'disaster',
  description: 'Strike the ground with a bolt from the heavens. Sets dry land alight.',
  mode: 'click',
  brush: null,
  cursorColor: '#b8d4ff',
  apply: (g, c) => g.disasters.lightning(c.x, c.z),
});

registerPower({
  id: 'smite',
  name: 'Divine Smite',
  category: 'disaster',
  description: 'A pillar of golden light annihilates everything beneath it.',
  mode: 'click',
  brush: { size: 2, min: 1, max: 5 },
  cursorColor: '#ffd27a',
  apply: (g, c) => g.disasters.smite(c.x, c.z, { radius: Math.max(1.4, (c.radius || 2) * 1.1) }),
});

registerPower({
  id: 'earthquake',
  name: 'Earthquake',
  category: 'disaster',
  description: 'Tear the ground open along fault lines. Topples trees and buildings.',
  mode: 'click',
  brush: { size: 14, min: 6, max: 30 },
  cursorColor: '#d8b080',
  apply: (g, c) => g.disasters.earthquake?.(c.x, c.z, c.radius || 14),
});

registerPower({
  id: 'tornado',
  name: 'Tornado',
  category: 'disaster',
  description: 'Spin up a twister that wanders the land, uprooting everything in its path.',
  mode: 'click',
  brush: null,
  cursorColor: '#c8c0b0',
  apply: (g, c) => g.disasters.tornado?.(c.x, c.z),
});

registerPower({
  id: 'volcano',
  name: 'Volcano',
  category: 'disaster',
  description: 'Raise a volcano that erupts lava bombs and rivers of molten rock.',
  mode: 'click',
  brush: { size: 9, min: 6, max: 14 },
  cursorColor: '#ff6a2a',
  apply: (g, c) => g.disasters.volcano?.(c.x, c.z, c.radius || 9),
});

registerPower({
  id: 'lava',
  name: 'Lava',
  category: 'disaster',
  description: 'Pour molten rock that flows downhill, burns and hardens into stone.',
  brush: { size: 2, min: 1, max: 6 },
  interval: 0.08,
  cursorColor: '#ff6a2a',
  apply: (g, c) => {
    g.world.forEachInRadius(c.x, c.z, c.radius, (tx, ty, d) => g.disasters.pourLava(tx, ty, 0.12 * (1 - d * 0.5)));
    if (c.first) audio(g, 'fire-start', c, 0.6);
  },
});

registerPower({
  id: 'tsunami',
  name: 'Great Wave',
  category: 'disaster',
  description: 'Send a towering wave from the sea crashing onto the shore.',
  mode: 'click',
  brush: null,
  cursorColor: '#9ad8ff',
  apply: (g, c) => g.disasters.tsunami?.(c.x, c.z),
});

registerPower({
  id: 'plague',
  name: 'Plague',
  category: 'disaster',
  description: 'Release a sickly miasma. The disease spreads between people.',
  brush: { size: 3, min: 1, max: 8 },
  mode: 'click',
  cursorColor: '#a8d040',
  apply: (g, c) => g.disasters.plague(c.x, c.z, c.radius || 3),
});
