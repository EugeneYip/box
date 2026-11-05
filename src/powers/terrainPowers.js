import { registerPower } from './registry.js';
import { TILE, FLORA, FLORA_INFO, SEA_LEVEL, MAX_HEIGHT, MIN_HEIGHT } from '../world/constants.js';
import { biomeFor } from '../world/worldgen.js';

// Terrain shaping and biome painting powers (Landscape).
//
// Feel goals: smooth bell-shaped falloff (no rings, no spikes), soft limits
// instead of hard clamps (no flat-topped terraces), a light relaxation pass so
// repeated strokes stay natural, and automatic surface typing (beaches at the
// waterline, rock on steep or high ground, snow on peaks, the local climate's
// biome when land rises out of the sea).

// ---------------------------------------------------------------- helpers
const smooth = (t) => t * t * (3 - 2 * t);
const bell = (d) => {
  // d in 0..1 -> 1..0 with zero slope at both ends
  const t = Math.max(0, 1 - d * d);
  return t * t;
};
function vnoise(x, y) {
  // smooth value noise in [-1, 1]
  const xi = Math.floor(x),
    yi = Math.floor(y);
  const xf = x - xi,
    yf = y - yi;
  const h = (a, b) => {
    let n = (a * 374761393 + b * 668265263) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 2147483648 - 1;
  };
  const u = smooth(xf),
    v = smooth(yf);
  const a = h(xi, yi),
    b = h(xi + 1, yi),
    c = h(xi, yi + 1),
    d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Lapse rate used by worldgen (temperature falls with altitude).
const LAPSE = 0.55;

function markAll(w, tx, ty, r) {
  w.markDirty('height', tx - r, ty - r, tx + r, ty + r);
  w.markDirty('type', tx - r, ty - r, tx + r, ty + r);
  w.markDirty('flora', tx - r, ty - r, tx + r, ty + r);
}

// Iterate tiles in a radius with an effective radius of at least 1.6 tiles so
// a tiny brush never produces a single-tile spike.
function eachInBrush(w, ctx, fn, minR = 1.6) {
  const r = Math.max(minR, ctx.radius || 0);
  w.forEachInRadius(ctx.x, ctx.z, r, (tx, ty, d, i) => fn(tx, ty, d, i, r));
  return r;
}

// Change a tile's height, keeping its sea-level temperature consistent.
function setH(w, i, h) {
  const old = w.height[i];
  if (h === old) return;
  const base = w.temperature[i] + (Math.max(0, old) / MAX_HEIGHT) * LAPSE;
  w.height[i] = h;
  w.temperature[i] = Math.max(0, Math.min(1, base - (Math.max(0, h) / MAX_HEIGHT) * LAPSE));
}

function neighbourAvg(w, tx, ty) {
  let s = 0,
    n = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = tx + dx,
        y = ty + dy;
      if (!w.inBounds(x, y)) continue;
      const k = dx && dy ? 0.7 : 1;
      s += w.height[w.idx(x, y)] * k;
      n += k;
    }
  return n ? s / n : w.height[w.idx(tx, ty)];
}

const LAND_ONLY = new Set([TILE.GRASS, TILE.FOREST, TILE.JUNGLE, TILE.SAVANNA, TILE.SWAMP, TILE.TUNDRA, TILE.FARMLAND, TILE.ROAD, TILE.DESERT, TILE.SNOW, TILE.ASH]);
const KEEP_ROCKS = new Set([FLORA.BOULDER, FLORA.ROCK_SMALL]);

// Keep surface types plausible after sculpting.
function autoType(w, tx, ty, i = w.idx(tx, ty)) {
  const h = w.height[i];
  const t = w.type[i];
  if (t === TILE.LAVA) return;
  if (h < SEA_LEVEL) {
    const f = w.flora[i];
    if (f && f !== FLORA.REEDS) w.flora[i] = FLORA.NONE;
    if (f === FLORA.REEDS && h < SEA_LEVEL - 0.8) w.flora[i] = FLORA.NONE;
    if (LAND_ONLY.has(t)) w.type[i] = h < SEA_LEVEL - 3.2 ? TILE.ROCK : TILE.SAND;
    return;
  }
  const slope = w.slopeAt(tx, ty);
  const baseTemp = w.temperature[i] + (h / MAX_HEIGHT) * LAPSE;
  const snowLine = 11.5 + baseTemp * 8.5;
  const rockLine = snowLine - 4.2;
  const coastal = w.isCoastal(tx, ty);
  let nt = t;
  if (h > snowLine) nt = TILE.SNOW;
  else if (coastal && h < SEA_LEVEL + 0.75 && t !== TILE.ROAD && t !== TILE.FARMLAND) nt = TILE.SAND;
  else if (h > rockLine || (slope > 2.3 && h > SEA_LEVEL + 1.2)) nt = TILE.ROCK;
  else if (t === TILE.SNOW || t === TILE.ROCK || (t === TILE.SAND && (h > SEA_LEVEL + 1.3 || !coastal)) || t === TILE.SOIL) {
    // the surface was mountain / beach / bare bed: give it the local biome
    nt = t === TILE.SOIL && h < SEA_LEVEL + 0.6 ? TILE.SOIL : biomeFor(w.temperature[i], w.moisture[i], h, coastal ? 1 : 8);
  }
  if (nt !== t) w.type[i] = nt;
  // flora that cannot live here any more
  const f = w.flora[i];
  if (f && (nt === TILE.ROCK || nt === TILE.SNOW) && !KEEP_ROCKS.has(f) && f !== FLORA.SNOW_PINE) {
    if (FLORA_INFO[f]?.isTree || f === FLORA.FLOWERS || f === FLORA.BUSH || f === FLORA.WHEAT || f === FLORA.BERRY_BUSH) w.flora[i] = FLORA.NONE;
  }
}
function autoTypeArea(w, cx, cz, r) {
  w.forEachInRadius(cx, cz, r + 1.5, (tx, ty, d, i) => autoType(w, tx, ty, i));
}

// Raise / lower with a bell falloff, soft limits and gentle relaxation.
function sculpt(game, ctx, amount) {
  const w = game.world;
  const dt = Math.min(0.12, Math.max(ctx.dt || 0.016, 1 / 60));
  const strength = ctx.strength ?? 1;
  const r = eachInBrush(w, ctx, (tx, ty, d, i) => {
    const f = bell(d) * (0.88 + 0.24 * vnoise(tx * 0.31, ty * 0.31));
    const h = w.height[i];
    // soft ceiling / floor: the closer to the limit, the slower it moves
    const room = amount > 0 ? 1 - smooth(Math.max(0, Math.min(1, (h - MAX_HEIGHT * 0.55) / (MAX_HEIGHT * 0.45)))) : 1 - smooth(Math.max(0, Math.min(1, (MIN_HEIGHT * 0.5 - h) / (-MIN_HEIGHT * 0.5))));
    let nh = h + amount * 5.2 * dt * strength * f * room;
    // relax toward neighbours a little so strokes never build noise
    nh += (neighbourAvg(w, tx, ty) - nh) * 0.05 * f;
    setH(w, i, Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, nh)));
  });
  autoTypeArea(w, ctx.x, ctx.z, r);
  markAll(w, ctx.tx, ctx.ty, Math.ceil(r) + 2);
}

function paint(game, ctx, type, opts = {}) {
  const w = game.world;
  w.forEachInRadius(ctx.x, ctx.z, ctx.radius, (tx, ty, d, i) => {
    if (w.height[i] < SEA_LEVEL && !opts.water) return;
    if (opts.raiseTo != null && w.height[i] < opts.raiseTo) setH(w, i, opts.raiseTo + (1 - d) * 0.3);
    w.type[i] = type;
    if (opts.clearFlora) w.flora[i] = FLORA.NONE;
    else if (opts.clearTrees && FLORA_INFO[w.flora[i]]?.isTree) w.flora[i] = FLORA.NONE;
  });
  const r = Math.ceil(ctx.radius) + 1;
  w.markDirty('type', ctx.tx - r, ctx.ty - r, ctx.tx + r, ctx.ty + r);
  if (opts.raiseTo != null) w.markDirty('height', ctx.tx - r, ctx.ty - r, ctx.tx + r, ctx.ty + r);
  if (opts.clearFlora || opts.clearTrees) w.markDirty('flora', ctx.tx - r, ctx.ty - r, ctx.tx + r, ctx.ty + r);
  if (ctx.first) game.audio?.play?.('paint', { pos: ctx });
}

// ---------------------------------------------------------------- shaping
registerPower({
  id: 'raise',
  name: 'Raise Land',
  category: 'terrain',
  description: 'Lift the earth. Hold to build hills and mountains.',
  brush: { size: 5, min: 1, max: 24 },
  apply: (g, c) => {
    sculpt(g, c, 1);
    if (c.first) g.audio?.play?.('raise', { pos: c });
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
    if (c.first) g.audio?.play?.('lower', { pos: c });
  },
});
registerPower({
  id: 'flatten',
  name: 'Flatten',
  category: 'terrain',
  description: 'Level the ground to the height where you first press.',
  brush: { size: 5, min: 1, max: 24 },
  apply: (g, c) => {
    const w = g.world;
    if (c.first || g._flattenTo == null) g._flattenTo = Math.max(SEA_LEVEL + 0.3, w.heightAt(c.x, c.z));
    const target = g._flattenTo;
    const k = Math.min(1, (c.dt || 0.016) * 7 + 0.04);
    const r = eachInBrush(w, c, (tx, ty, d, i) => {
      const f = smooth(Math.min(1, (1 - d) * 1.6)) * k;
      setH(w, i, w.height[i] + (target - w.height[i]) * f);
    });
    autoTypeArea(w, c.x, c.z, r);
    markAll(w, c.tx, c.ty, Math.ceil(r) + 2);
  },
});
registerPower({
  id: 'smooth',
  name: 'Smooth',
  category: 'terrain',
  description: 'Soften the land: round off peaks, fill pits and blend slopes.',
  brush: { size: 5, min: 1, max: 24 },
  apply: (g, c) => {
    const w = g.world;
    const k = Math.min(1, (c.dt || 0.016) * 6 + 0.05);
    const r = Math.max(1.6, c.radius);
    const x0 = Math.max(0, Math.floor(c.x - r - 2)),
      x1 = Math.min(w.w - 1, Math.ceil(c.x + r + 2));
    const y0 = Math.max(0, Math.floor(c.z - r - 2)),
      y1 = Math.min(w.h - 1, Math.ceil(c.z + r + 2));
    // Gaussian (radius 2) of the neighbourhood, computed before writing
    const bw = x1 - x0 + 1;
    const blurred = new Float32Array(bw * (y1 - y0 + 1));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        let s = 0,
          n = 0;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const wt = Math.exp(-(dx * dx + dy * dy) / 2.2);
            s += w.getHeight(x + dx, y + dy) * wt;
            n += wt;
          }
        blurred[(y - y0) * bw + (x - x0)] = s / n;
      }
    w.forEachInRadius(c.x, c.z, r, (tx, ty, d, i) => {
      const f = bell(d) * k;
      const b = blurred[(ty - y0) * bw + (tx - x0)];
      let nh = w.height[i] + (b - w.height[i]) * f;
      // do not let smoothing flip a coastline by a hair
      if (w.height[i] >= SEA_LEVEL && nh < SEA_LEVEL && nh > SEA_LEVEL - 0.05) nh = SEA_LEVEL;
      setH(w, i, nh);
    });
    autoTypeArea(w, c.x, c.z, r);
    markAll(w, c.tx, c.ty, Math.ceil(r) + 3);
  },
});
registerPower({
  id: 'mountain',
  name: 'Mountain',
  category: 'terrain',
  description: 'Thrust a rugged mountain with foothills out of the ground.',
  mode: 'click',
  brush: { size: 8, min: 3, max: 20 },
  apply: (g, c) => {
    const w = g.world;
    const R = Math.max(3, c.radius) * 1.25;
    const rnd = (k) => {
      const v = Math.sin((c.tx * 12.9898 + c.ty * 78.233 + k * 37.719) * 43758.5453);
      return v - Math.floor(v);
    };
    const ang = rnd(1) * Math.PI;
    const asp = 1.3 + rnd(2) * 0.7;
    const ca = Math.cos(ang),
      sa = Math.sin(ang);
    const peak = Math.min(MAX_HEIGHT * 0.92, (6 + R * 1.05) * (0.85 + rnd(3) * 0.25));
    const seed = rnd(4) * 100;
    w.forEachInRadius(c.x, c.z, R, (tx, ty, d, i) => {
      const dx = tx + 0.5 - c.x,
        dz = ty + 0.5 - c.z;
      const u = (dx * ca + dz * sa) / Math.sqrt(asp),
        v = (-dx * sa + dz * ca) * Math.sqrt(asp);
      const de = Math.min(1, Math.hypot(u, v) / R);
      // ridged detail along the range
      let ridge = 0,
        amp = 0.5,
        fq = 0.22;
      for (let o = 0; o < 3; o++) {
        const n = 1 - Math.abs(vnoise(tx * fq + seed, ty * fq - seed));
        ridge += n * n * amp;
        amp *= 0.5;
        fq *= 2.1;
      }
      const massif = Math.pow(bell(de), 1.15);
      const foot = bell(Math.min(1, de * 0.85)) * 0.25;
      const prof = peak * (massif * (0.62 + 0.55 * ridge) + foot);
      const base = Math.max(w.height[i], SEA_LEVEL + 0.4 * bell(de));
      const nh = Math.max(w.height[i], base + prof * (1 - Math.max(0, w.height[i]) / (MAX_HEIGHT * 1.6)));
      setH(w, i, Math.min(MAX_HEIGHT, nh));
    });
    // two light relaxation passes to remove tile-scale jaggies
    for (let pass = 0; pass < 2; pass++)
      w.forEachInRadius(c.x, c.z, R, (tx, ty, d, i) => {
        setH(w, i, w.height[i] + (neighbourAvg(w, tx, ty) - w.height[i]) * 0.25 * (1 - d * 0.5));
      });
    autoTypeArea(w, c.x, c.z, R);
    markAll(w, c.tx, c.ty, Math.ceil(R) + 2);
    g.cameraRig?.addShake?.(0.6);
    g.audio?.play?.('quake', { pos: c });
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
    const k = Math.min(1, (c.dt || 0.016) * 6 + 0.08);
    const r = eachInBrush(w, c, (tx, ty, d, i) => {
      const target = SEA_LEVEL - 0.8 - bell(d) * 4.2;
      const f = smooth(Math.min(1, (1 - d) * 1.5)) * k;
      if (w.height[i] > target) setH(w, i, w.height[i] + (target - w.height[i]) * f);
    });
    autoTypeArea(w, c.x, c.z, r);
    markAll(w, c.tx, c.ty, Math.ceil(r) + 2);
    if (c.first) g.audio?.play?.('splash', { pos: c });
  },
});
registerPower({
  id: 'land',
  name: 'New Land',
  category: 'terrain',
  description: 'Raise fresh land from the sea, ringed by beaches.',
  brush: { size: 4, min: 1, max: 24 },
  apply: (g, c) => {
    const w = g.world;
    const k = Math.min(1, (c.dt || 0.016) * 6 + 0.08);
    const r = eachInBrush(w, c, (tx, ty, d, i) => {
      const target = SEA_LEVEL + 0.55 + bell(d) * 1.1 + vnoise(tx * 0.4, ty * 0.4) * 0.15;
      const f = smooth(Math.min(1, (1 - d) * 1.4)) * k;
      if (w.height[i] < target) {
        const was = w.height[i];
        setH(w, i, was + (target - was) * f);
        if (was < SEA_LEVEL && w.height[i] >= SEA_LEVEL) w.type[i] = TILE.SAND; // autoType turns inland sand into the local biome
      }
    });
    autoTypeArea(w, c.x, c.z, r);
    markAll(w, c.tx, c.ty, Math.ceil(r) + 2);
  },
});
registerPower({
  id: 'river',
  name: 'Dig River',
  category: 'terrain',
  description: 'Drag to carve a river channel with gentle banks. Connect it to the sea.',
  brush: { size: 1, min: 1, max: 4 },
  apply: (g, c) => {
    const w = g.world;
    const last = !c.first && g._riverLast ? g._riverLast : { x: c.x, z: c.z };
    g._riverLast = { x: c.x, z: c.z };
    const half = 0.25 + c.radius * 0.45; // channel half width (tiles)
    const bed = SEA_LEVEL - 0.35 - c.radius * 0.1;
    const R = half + 6;
    const ax = last.x,
      az = last.z,
      bx = c.x,
      bz = c.z;
    const vx = bx - ax,
      vz = bz - az;
    const L2 = vx * vx + vz * vz;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - R)),
      x1 = Math.min(w.w - 1, Math.ceil(Math.max(ax, bx) + R));
    const y0 = Math.max(0, Math.floor(Math.min(az, bz) - R)),
      y1 = Math.min(w.h - 1, Math.ceil(Math.max(az, bz) + R));
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        const px = tx + 0.5,
          pz = ty + 0.5;
        const t = L2 > 1e-6 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / L2)) : 0;
        const d = Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
        if (d > R) continue;
        const e = Math.max(0, d - half);
        const target = bed + e * 0.38 + e * e * 0.12;
        const i = w.idx(tx, ty);
        if (target < w.height[i]) {
          setH(w, i, target);
          if (d <= half + 0.6 && target < SEA_LEVEL) w.type[i] = TILE.SOIL;
        }
      }
    const cx = (ax + bx) / 2,
      cz = (az + bz) / 2;
    const rr = Math.hypot(vx, vz) / 2 + R;
    autoTypeArea(w, cx, cz, rr);
    w.markDirty('height', x0 - 1, y0 - 1, x1 + 1, y1 + 1);
    w.markDirty('type', x0 - 1, y0 - 1, x1 + 1, y1 + 1);
    w.markDirty('flora', x0 - 1, y0 - 1, x1 + 1, y1 + 1);
    if (c.first) g.audio?.play?.('splash', { pos: c });
  },
});

// ---------------------------------------------------------------- biomes
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
biome('paint-snow', 'Snow', TILE.SNOW, 'Blanket the land in snow.', { clearTrees: false });
biome('paint-soil', 'Soil', TILE.SOIL, 'Paint bare tilled earth.', { clearFlora: true });
biome('paint-rock', 'Stone', TILE.ROCK, 'Paint bare stone.', { clearFlora: true });
biome('paint-ice', 'Ice', TILE.ICE, 'Freeze lakes and seas into glossy ice sheets.', { water: true, clearFlora: true });

export { autoType, sculpt, paint };
