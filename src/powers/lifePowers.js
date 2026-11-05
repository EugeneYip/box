import { registerPower } from './registry.js';

// BASELINE creature-spawning powers (Life owner extends; keep ids stable).
function spawner(id, name, species, desc, count = 1) {
  registerPower({
    id,
    name,
    category: 'life',
    description: desc,
    mode: 'brush',
    interval: 0.18,
    brush: { size: 1, min: 1, max: 6 },
    apply: (g, c) => {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2,
          r = Math.random() * c.radius;
        const x = c.x + Math.cos(a) * r,
          z = c.z + Math.sin(a) * r;
        const [tx, ty] = g.world.tileOf(x, z);
        const sp = species;
        const water = g.world.isWater(tx, ty);
        if (water && sp !== 'fish') continue;
        const u = g.units.spawn(sp, x, z, { age: sp === 'human' ? 18 + Math.random() * 10 : 1 + Math.random() * 3 });
        if (u) {
          g.fx.emit('spawn', { x, z });
          g.audio.play('spawn', { pos: { x, z } });
        }
      }
    },
  });
}
spawner('spawn-human', 'Humans', 'human', 'Place curious, ambitious humans who will found villages.');
spawner('spawn-sheep', 'Sheep', 'sheep', 'Place gentle grazing sheep.');
spawner('spawn-wolf', 'Wolves', 'wolf', 'Place hungry wolves that hunt in packs.');

export { spawner };
