import { registerPower } from './registry.js';
import { TILE, FLORA, SEA_LEVEL, MAX_HEIGHT, MIN_HEIGHT } from '../world/constants.js';

// BASELINE terrain-shaping and biome-painting powers (Landscape owner may
// refine falloff / feel, keep ids stable).
const smooth = (t) => t * t * (3 - 2 * t);

function sculpt(game, ctx, amount) {
  const w = game.world;
  const rate = amount * Math.max(ctx.dt, 1 / 30) * 6;
  w.forEachInRadius(ctx.x, ctx.z, ctx.radius, (tx, ty, d, i) => {
    const f = smooth(1 - d);
    w.height[i] = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, w.height[i] + rate * f));
    autoType(w, tx, ty, i);
  });
  const r = Math.ceil(ctx.radius) + 1;
  w.markDirty('height', ctx.tx - r, ctx.ty - r, ctx.tx + r, ctx.ty + r);
  w.markDirty('type', ctx.tx - r, ctx.ty - r, ctx.tx + r, ctx.ty + r);
  w.markDirty('flora', ctx.tx - r, ctx.ty - r, ctx.tx + r, ctx.ty + r);
}

// Keep surface types plausible after sculpting.
function autoType(w, tx, ty, i) {
  const h = w.height[i];
  const t = w.type[i];
  if (h < SEA_LEVEL) {
    if (w.flora[i] && w.flora[i] !== FLORA.REEDS) w.flora[i] = FLORA.NONE;
    if (t !== TILE.ROCK && t !== TILE.LAVA) w.type[i] = TILE.SAND;
  } else if (h > MAX_HEIGHT * 0.72) {
    w.type[i] = TILE.SNOW;
  } else if (h > MAX_HEIGHT * 0.48 && t !== TILE.SNOW) {
    w.type[i] = TILE.ROCK;
    if (w.flora[i] && w.flora[i] !== FLORA.BOULDER && w.flora[i] !== FLORA.ROCK_SMALL) w.flora[i] = FLORA.NONE;
  } else if (t === TILE.SAND && h > SEA_LEVEL + 1.2) {
    w.type[i] = TILE.GRASS;
  } else if ((t === TILE.ROCK || t === TILE.SNOW) && h < MAX_HEIGHT * 0.4) {
    w.type[i] = TILE.GRASS;
  }
}

function paint(game, ctx, type, opts = {}) {
  const w = game.world;
  w.forEachInRadius(ctx.x, ctx.z, ctx.radius, (tx, ty, d, i) => {
    if (w.height[i] < SEA_LEVEL && !opts.water) return;
    if (opts.raiseTo != null && w.height[i] < opts.raiseTo) w.height[i] = opts.raiseTo + (1 - d) * 0.3;
    w.type[i] = type;
    if (opts.clearFlora) w.flora[i] = FLORA.NONE;
  });
  const r = Math.ceil(ctx.radius) + 1;
  w.markDirty('type', ctx.tx - r, ctx.ty - r, ctx.tx + r, ctx.ty + r);
  if (opts.raiseTo != null) w.markDirty('height', ctx.tx - r, ctx.ty - r, ctx.tx + r, ctx.ty + r);
  if (opts.clearFlora) w.markDirty('flora', ctx.tx - r, ctx.ty - r, ctx.tx + r, ctx.ty + r);
  if (ctx.first) game.audio.play('paint', { pos: ctx });
}

registerPower({
  id: 'raise',
  name: 'Raise Land',
  category: 'terrain',
  description: 'Lift the earth. Hold to build hills and mountains.',
  brush: { size: 5, min: 1, max: 24 },
  apply: (g, c) => {
    sculpt(g, c, 1);
    if (c.first) g.audio.play('raise', { pos: c });
  },
});
registerPower({
  id: 'lower',
  name: 'Lower Land',
  category: 'terrain',
  description: 'Sink the earth. Hold to carve valleys, lakes and seas.',
  brush: { size: 5, min: 1, max: 24 },
  apply: (g, c) => {
    sculpt(g, c, -1);
    if (c.first) g.audio.play('lower', { pos: c });
  },
});
registerPower({
  id: 'flatten',
  name: 'Flatten',
  category: 'terrain',
  description: 'Level the ground to the height under the cursor.',
  brush: { size: 5, min: 1, max: 24 },
  apply: (g, c) => {
    const w = g.world;
    if (c.first) g._flattenTo = Math.max(SEA_LEVEL + 0.3, w.heightAt(c.x, c.z));
    const target = g._flattenTo ?? w.heightAt(c.x, c.z);
    w.forEachInRadius(c.x, c.z, c.radius, (tx, ty, d, i) => {
      const f = smooth(1 - d) * Math.min(1, c.dt * 6 + 0.05);
      w.height[i] += (target - w.height[i]) * f;
      autoType(w, tx, ty, i);
    });
    const r = Math.ceil(c.radius) + 1;
    w.markDirty('height', c.tx - r, c.ty - r, c.tx + r, c.ty + r);
    w.markDirty('type', c.tx - r, c.ty - r, c.tx + r, c.ty + r);
  },
});
registerPower({
  id: 'mountain',
  name: 'Mountain',
  category: 'terrain',
  description: 'Thrust a rocky peak out of the ground.',
  mode: 'click',
  brush: { size: 7, min: 3, max: 20 },
  apply: (g, c) => {
    const w = g.world;
    w.forEachInRadius(c.x, c.z, c.radius, (tx, ty, d, i) => {
      const f = Math.pow(1 - d, 1.6);
      const target = SEA_LEVEL + 2 + f * (MAX_HEIGHT * 0.85);
      w.height[i] = Math.max(w.height[i], target * (0.85 + Math.random() * 0.15));
      autoType(w, tx, ty, i);
    });
    const r = Math.ceil(c.radius) + 1;
    w.markDirty('height', c.tx - r, c.ty - r, c.tx + r, c.ty + r);
    w.markDirty('type', c.tx - r, c.ty - r, c.tx + r, c.ty + r);
    g.cameraRig.addShake(0.6);
    g.audio.play('quake', { pos: c });
  },
});
registerPower({
  id: 'ocean',
  name: 'Ocean',
  category: 'terrain',
  description: 'Flood the land with deep water.',
  brush: { size: 4, min: 1, max: 24 },
  apply: (g, c) => {
    const w = g.world;
    w.forEachInRadius(c.x, c.z, c.radius, (tx, ty, d, i) => {
      const target = SEA_LEVEL - 1.5 - smooth(1 - d) * 3;
      if (w.height[i] > target) w.height[i] += (target - w.height[i]) * Math.min(1, c.dt * 8 + 0.1);
      autoType(w, tx, ty, i);
    });
    const r = Math.ceil(c.radius) + 1;
    w.markDirty('height', c.tx - r, c.ty - r, c.tx + r, c.ty + r);
    w.markDirty('type', c.tx - r, c.ty - r, c.tx + r, c.ty + r);
    w.markDirty('flora', c.tx - r, c.ty - r, c.tx + r, c.ty + r);
    if (c.first) g.audio.play('splash', { pos: c });
  },
});
registerPower({
  id: 'land',
  name: 'New Land',
  category: 'terrain',
  description: 'Raise fresh grassland from the sea.',
  brush: { size: 4, min: 1, max: 24 },
  apply: (g, c) => {
    const w = g.world;
    w.forEachInRadius(c.x, c.z, c.radius, (tx, ty, d, i) => {
      const target = SEA_LEVEL + 0.8 + smooth(1 - d) * 0.8;
      if (w.height[i] < target) {
        w.height[i] += (target - w.height[i]) * Math.min(1, c.dt * 8 + 0.1);
        if (w.height[i] > SEA_LEVEL + 0.5) w.type[i] = TILE.GRASS;
        else w.type[i] = TILE.SAND;
      }
    });
    const r = Math.ceil(c.radius) + 1;
    w.markDirty('height', c.tx - r, c.ty - r, c.tx + r, c.ty + r);
    w.markDirty('type', c.tx - r, c.ty - r, c.tx + r, c.ty + r);
  },
});

const biome = (id, name, type, desc, extra = {}) =>
  registerPower({
    id,
    name,
    category: 'biome',
    description: desc,
    brush: { size: 5, min: 1, max: 24 },
    apply: (g, c) => paint(g, c, type, extra),
  });
biome('paint-grass', 'Grassland', TILE.GRASS, 'Paint fertile meadows.');
biome('paint-forest', 'Forest Soil', TILE.FOREST, 'Paint rich forest soil where woods will thrive.');
biome('paint-jungle', 'Jungle', TILE.JUNGLE, 'Paint steaming tropical jungle soil.');
biome('paint-savanna', 'Savanna', TILE.SAVANNA, 'Paint dry golden grassland.');
biome('paint-desert', 'Desert', TILE.DESERT, 'Paint scorching dunes.', { clearFlora: true });
biome('paint-sand', 'Sand', TILE.SAND, 'Paint beach sand.', { clearFlora: true });
biome('paint-swamp', 'Swamp', TILE.SWAMP, 'Paint murky wetlands.');
biome('paint-tundra', 'Tundra', TILE.TUNDRA, 'Paint cold windswept tundra.');
biome('paint-snow', 'Snow', TILE.SNOW, 'Blanket the land in snow.');
biome('paint-soil', 'Soil', TILE.SOIL, 'Paint bare tilled earth.', { clearFlora: true });
biome('paint-rock', 'Stone', TILE.ROCK, 'Paint bare stone.', { clearFlora: true });

export { autoType, sculpt, paint };
