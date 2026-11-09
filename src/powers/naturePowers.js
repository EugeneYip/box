import { registerPower } from './registry.js';
import { FLORA, TILE, SEA_LEVEL } from '../world/constants.js';
import { pickTree, pickUndergrowth, suitAt, naturalBiome, isLiving, isMineral, BARREN } from '../sim/flora/species.js';

// Nature powers (owned by Nature). Ids 'plant-forest' and 'clear-flora' are
// stable; the rest are additions. Seeds pick species per biome; plants start
// as saplings and are grown by the flora simulation.

const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICONS = {
  'plant-forest': svg('<path d="M12 21v-6"/><path d="M12 3l-5 7h3l-3.5 5h11L14 10h3z"/>'),
  'plant-flowers': svg('<circle cx="12" cy="9" r="2"/><path d="M12 5a2 2 0 0 1 0 0M12 11v10"/><path d="M9 7.5a2.2 2.2 0 1 1 3-3 2.2 2.2 0 1 1 3 3 2.2 2.2 0 1 1-1.5 3.6 2.2 2.2 0 1 1-3 0A2.2 2.2 0 1 1 9 7.5z"/><path d="M12 17c-2 0-4-1-5-3M12 19c2 0 4-1 5-3"/>'),
  'plant-grass': svg('<path d="M3 21h18"/><path d="M6 21c0-4-1-7-3-9M9 21c0-5 1-9 3-12M13 21c0-4 2-7 5-9M17 21c0-3 1-5 3-6"/>'),
  bloom: svg('<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3.2"/>'),
  wither: svg('<path d="M12 21v-7"/><path d="M12 14c-3 0-5-2-6-5 3 0 5 1 6 3"/><path d="M12 12c1-3 3-4 6-4-1 3-3 5-6 5"/><path d="M4 21h16"/><path d="M8 4l1.5 2M16 4l-1.5 2M12 2.5v2.5"/>'),
  'clear-flora': svg('<path d="M12 14v7"/><path d="M8 21l4-3 4 3"/><path d="M12 14c-4 0-6-3-6-6 3 0 6 2 6 6zM12 14c0-4 3-6 6-6 0 3-2 6-6 6z"/><path d="M4 4l16 16"/>'),
};

const near = (w, x, z) => ({ x, y: w.surfaceAt(x, z) + 0.6, z });

function plantable(w, tx, ty, i) {
  return w.isLand(tx, ty) && !w.flora[i] && w.building[i] < 0 && w.fire[i] <= 0 && !BARREN[w.type[i]] && w.type[i] !== TILE.FARMLAND;
}

function feedback(g, c, fxType, n, color) {
  const w = g.world;
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2,
      r = Math.sqrt(Math.random()) * Math.max(0.5, c.radius);
    const x = c.x + Math.cos(a) * r,
      z = c.z + Math.sin(a) * r;
    g.fx?.emit?.(fxType, near(w, x, z), { color, scale: 0.8 });
  }
}

registerPower({
  id: 'plant-forest',
  name: 'Forest Seeds',
  category: 'nature',
  description: 'Scatter seeds that grow into trees suited to the land: oaks and birches on meadows, pines in the cold, palms on beaches, acacias on the savanna, cacti in the desert.',
  icon: ICONS['plant-forest'],
  cursorColor: '#8fe070',
  brush: { size: 4, min: 1, max: 16 },
  interval: 0.12,
  apply: (g, c) => {
    const w = g.world;
    let planted = 0;
    w.forEachInRadius(c.x, c.z, c.radius, (tx, ty, d, i) => {
      if (!plantable(w, tx, ty, i) || Math.random() > 0.16 * (1 - d * 0.5)) return;
      let f = pickTree(w.type[i], w.temperature[i], Math.random());
      if (!f) return;
      if (suitAt(w, f, tx, ty, i) < 0.15) return;
      w.setFlora(tx, ty, f, 0.03 + Math.random() * 0.04);
      if (g.flora?.stress) g.flora.stress[i] = 0;
      planted++;
    });
    if (planted) {
      feedback(g, c, 'sparkle', Math.min(4, planted), 0xb8f070);
      if (Math.random() < 0.5) feedback(g, c, 'leaves', 1, 0x7ab040);
    }
    if (c.first) g.audio?.play?.('plant', { pos: c });
  },
});

registerPower({
  id: 'plant-flowers',
  name: 'Wildflowers',
  category: 'nature',
  description: 'Sow drifts of wildflowers, berry bushes and shrubs. They bloom, spread gently and feed wildlife.',
  icon: ICONS['plant-flowers'],
  cursorColor: '#ff9ad0',
  brush: { size: 4, min: 1, max: 16 },
  interval: 0.1,
  apply: (g, c) => {
    const w = g.world;
    let planted = 0;
    w.forEachInRadius(c.x, c.z, c.radius, (tx, ty, d, i) => {
      if (!plantable(w, tx, ty, i) || Math.random() > 0.22) return;
      const t = w.type[i];
      const r = Math.random();
      let f = r < 0.72 ? FLORA.FLOWERS : r < 0.86 ? FLORA.BUSH : FLORA.BERRY_BUSH;
      if (t === TILE.DESERT) f = FLORA.CACTUS;
      else if (t === TILE.SWAMP && r < 0.5) f = FLORA.REEDS;
      if (suitAt(w, f, tx, ty, i) < 0.15) return;
      w.setFlora(tx, ty, f, 0.08 + Math.random() * 0.1);
      planted++;
    });
    if (planted) feedback(g, c, 'sparkle', Math.min(4, planted), 0xffb0e0);
    if (c.first) g.audio?.play?.('plant', { pos: c });
  },
});

registerPower({
  id: 'plant-grass',
  name: 'Meadow',
  category: 'nature',
  description: 'Green barren ground: scorched earth, bare soil, dunes and dry savanna turn into lush meadow dotted with flowers.',
  icon: ICONS['plant-grass'],
  cursorColor: '#7ad65a',
  brush: { size: 5, min: 1, max: 20 },
  interval: 0.1,
  apply: (g, c) => {
    const w = g.world;
    let changed = 0;
    w.forEachInRadius(c.x, c.z, c.radius, (tx, ty, d, i) => {
      if (!w.isLand(tx, ty) || w.building[i] >= 0) return;
      const t = w.type[i];
      const convertible = t === TILE.ASH || t === TILE.SOIL || t === TILE.DESERT || t === TILE.SAVANNA || t === TILE.TUNDRA || (t === TILE.SAND && !w.isCoastal(tx, ty));
      if (convertible && Math.random() < 0.55 * (1 - d * 0.4)) {
        w.setType(tx, ty, TILE.GRASS);
        if (w.flora[i] && isLiving(w.flora[i]) && suitAt(w, w.flora[i], tx, ty, i) < 0.15) w.setFlora(tx, ty, FLORA.NONE);
        changed++;
      }
      if (g.flora?.bless) g.flora.bless(i, 0.2);
      if (w.type[i] === TILE.GRASS && !w.flora[i] && w.fire[i] <= 0 && Math.random() < 0.025) {
        w.setFlora(tx, ty, Math.random() < 0.8 ? FLORA.FLOWERS : FLORA.BUSH, 0.1);
      }
    });
    if (changed) feedback(g, c, 'leaves', 2, 0x8fd060);
    if (c.first) g.audio?.play?.('plant', { pos: c });
  },
});

registerPower({
  id: 'bloom',
  name: 'Bloom',
  category: 'nature',
  description: 'A breath of fertility: plants surge toward maturity, wheat ripens, withered growth recovers and burnt land heals.',
  icon: ICONS.bloom,
  cursorColor: '#ffe27a',
  brush: { size: 5, min: 1, max: 20 },
  interval: 0.1,
  apply: (g, c) => {
    const w = g.world;
    const dt = Math.max(c.dt || 0.1, 0.05);
    w.forEachInRadius(c.x, c.z, c.radius, (tx, ty, d, i) => {
      if (!w.isLand(tx, ty)) return;
      const k = 1 - d * 0.5;
      g.flora?.bless?.(i, 0.6 * k);
      const f = w.flora[i];
      if (f && !isMineral(f) && f !== FLORA.STUMP && f !== FLORA.DEAD_TREE && w.floraGrowth[i] < 1) {
        w.floraGrowth[i] = Math.min(1, w.floraGrowth[i] + dt * 1.6 * k);
      }
      if (w.type[i] === TILE.ASH && w.fire[i] <= 0 && Math.random() < 0.3 * k) {
        const nat = g.flora?.native?.[i];
        w.setType(tx, ty, nat != null && nat !== TILE.ASH && nat !== TILE.LAVA && nat !== TILE.SOIL && nat !== TILE.FARMLAND && nat !== TILE.ROAD ? nat : naturalBiome(w, i));
      }
      if (!f && plantable(w, tx, ty, i) && Math.random() < 0.01 * k) {
        const u = pickUndergrowth(w.type[i], Math.random());
        if (u && suitAt(w, u, tx, ty, i) >= 0.5) w.setFlora(tx, ty, u, 0.1);
      }
    });
    const r = Math.ceil(c.radius) + 1;
    w.markDirty('flora', c.tx - r, c.ty - r, c.tx + r, c.ty + r);
    feedback(g, c, 'sparkle', 2, 0xfff0a0);
    if (Math.random() < 0.3) feedback(g, c, 'leaves', 1, 0xa8e070);
    if (c.first) g.audio?.play?.('plant', { pos: c, pitch: 1.25 });
  },
});

// Drought dries a biome one step toward desert.
const DRIER = [];
DRIER[TILE.GRASS] = TILE.SAVANNA;
DRIER[TILE.FOREST] = TILE.GRASS;
DRIER[TILE.JUNGLE] = TILE.SAVANNA;
DRIER[TILE.SWAMP] = TILE.GRASS;
DRIER[TILE.SAVANNA] = TILE.DESERT;
DRIER[TILE.FARMLAND] = TILE.SOIL;

registerPower({
  id: 'wither',
  name: 'Drought',
  category: 'nature',
  description: 'Scorch the land with drought. Foliage browns and dies, meadows parch to savanna and savanna to desert. Hold to deepen it.',
  icon: ICONS.wither,
  cursorColor: '#d8a050',
  brush: { size: 5, min: 1, max: 20 },
  interval: 0.12,
  apply: (g, c) => {
    const w = g.world;
    w.forEachInRadius(c.x, c.z, c.radius, (tx, ty, d, i) => {
      if (!w.isLand(tx, ty)) return;
      const k = 1 - d * 0.6;
      const f = w.flora[i];
      if (f && isLiving(f)) g.flora?.wither?.(i, 0.12 * k);
      const dry = DRIER[w.type[i]];
      if (dry != null && Math.random() < 0.035 * k && w.building[i] < 0) w.setType(tx, ty, dry);
    });
    if (Math.random() < 0.5) feedback(g, c, 'dust', 2, 0xc8a070);
    if (c.first) g.audio?.play?.('paint', { pos: c, pitch: 0.8 });
  },
});

registerPower({
  id: 'clear-flora',
  name: 'Uproot',
  category: 'nature',
  description: 'Remove trees and plants.',
  icon: ICONS['clear-flora'],
  cursorColor: '#e0c090',
  brush: { size: 3, min: 1, max: 16 },
  apply: (g, c) => {
    const w = g.world;
    let removed = 0;
    w.forEachInRadius(c.x, c.z, c.radius, (tx, ty, d, i) => {
      if (w.flora[i]) {
        w.flora[i] = FLORA.NONE;
        w.floraGrowth[i] = 0;
        if (g.flora?.stress) g.flora.stress[i] = 0;
        removed++;
      }
    });
    const r = Math.ceil(c.radius) + 1;
    w.markDirty('flora', c.tx - r, c.ty - r, c.tx + r, c.ty + r);
    if (removed) {
      feedback(g, c, 'dust', Math.min(3, removed), 0x9a7a50);
      feedback(g, c, 'leaves', 1, 0x6a9a40);
    }
    if (c.first) g.audio?.play?.('chop', { pos: c, volume: 0.6 });
  },
});

export { SEA_LEVEL };
