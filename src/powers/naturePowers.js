import { registerPower } from './registry.js';
import { FLORA, TILE } from '../world/constants.js';

// BASELINE nature powers (Nature owner extends; keep ids stable).
registerPower({
  id: 'plant-forest',
  name: 'Forest Seeds',
  category: 'nature',
  description: 'Scatter seeds that grow into trees suited to the land.',
  brush: { size: 4, min: 1, max: 16 },
  interval: 0.1,
  apply: (g, c) => {
    const w = g.world;
    w.forEachInRadius(c.x, c.z, c.radius, (tx, ty, d, i) => {
      if (!w.isLand(tx, ty) || w.flora[i] || w.building[i] >= 0 || Math.random() > 0.15) return;
      const t = w.type[i];
      const f =
        t === TILE.SNOW || t === TILE.TUNDRA ? FLORA.SNOW_PINE :
        t === TILE.JUNGLE ? FLORA.JUNGLE_TREE :
        t === TILE.SAND ? FLORA.PALM :
        t === TILE.DESERT ? FLORA.CACTUS :
        t === TILE.SAVANNA ? FLORA.ACACIA :
        t === TILE.SWAMP ? FLORA.SWAMP_TREE :
        Math.random() < 0.7 ? FLORA.OAK : FLORA.BIRCH;
      w.flora[i] = f;
      w.floraGrowth[i] = 0.15;
    });
    const r = Math.ceil(c.radius) + 1;
    w.markDirty('flora', c.tx - r, c.ty - r, c.tx + r, c.ty + r);
    if (c.first) g.audio.play('plant', { pos: c });
  },
});
registerPower({
  id: 'clear-flora',
  name: 'Uproot',
  category: 'nature',
  description: 'Remove trees and plants.',
  brush: { size: 3, min: 1, max: 16 },
  apply: (g, c) => {
    const w = g.world;
    w.forEachInRadius(c.x, c.z, c.radius, (tx, ty, d, i) => (w.flora[i] = FLORA.NONE));
    const r = Math.ceil(c.radius) + 1;
    w.markDirty('flora', c.tx - r, c.ty - r, c.tx + r, c.ty + r);
  },
});
