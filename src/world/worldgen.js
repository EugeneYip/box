import { createNoise2D } from 'simplex-noise';
import { mulberry32, hash2 } from '../core/Random.js';
import { TILE, FLORA, SEA_LEVEL, MAX_HEIGHT, MIN_HEIGHT } from './constants.js';

// Procedural world generation (Landscape). Fills height / type / temperature /
// moisture / flora of a World. Deterministic for a given seed.
//
// options.preset: 'continent' | 'pangaea' | 'archipelago' | 'islands'
//
// Pipeline
//  1. Land shape: preset-specific "blobs" (landmass seeds) + domain-warped
//     fractal noise, thresholded at a quantile so every seed gets the preset's
//     land fraction. Map borders are always ocean.
//  2. Distance fields (exact EDT) to the coast on both sides.
//  3. Elevation: coastal plains rising inland, rolling hills, and broad
//     mountain ranges (ridged noise along warped spines) with foothills.
//     Ocean: shallow shelves near coasts, dropping to the deep sea.
//  4. Lakes carved into lowland basins.
//  5. Rivers: priority-flood drainage + flow accumulation; the largest
//     channels are carved just below sea level with U-shaped valleys, so they
//     run from the highlands to the sea (or through lakes).
//  6. Climate: latitude + altitude temperature, moisture from noise and
//     proximity to water. Biomes, beaches, sea cliffs, snow caps, sea ice.
//  7. Initial flora.
const PRESETS = {
  continent: { land: 0.42, warp: 0.20, detail: 0.30, mountains: 1.0, shelf: 1.0, lakes: [3, 6], rivers: 0.016 },
  pangaea: { land: 0.58, warp: 0.22, detail: 0.28, mountains: 1.1, shelf: 0.9, lakes: [5, 9], rivers: 0.018 },
  archipelago: { land: 0.25, warp: 0.13, detail: 0.30, mountains: 1.0, shelf: 1.2, lakes: [0, 2], rivers: 0.008, inland: 7, union: 0.9 },
  islands: { land: 0.33, warp: 0.16, detail: 0.28, mountains: 0.95, shelf: 1.1, lakes: [1, 3], rivers: 0.012, inland: 10, union: 0.8 },
};

export function generateWorld(world, seed = 1, options = {}) {
  const presetName = PRESETS[options.preset] ? options.preset : 'continent';
  const P = PRESETS[presetName];
  world.seed = seed;
  const _times = options.profile ? {} : null;
  let _tl = performance.now();
  const _t = (k) => {
    if (!_times) return;
    const n = performance.now();
    _times[k] = n - _tl;
    _tl = n;
  };
  const rand = mulberry32((seed * 2654435761) >>> 0 || 1);
  const mk = (k) => createNoise2D(mulberry32((seed * 7919 + k * 104729) >>> 0));
  const nWarpA = mk(1),
    nWarpB = mk(2),
    nShape = mk(3),
    nDetail = mk(4),
    nRange = mk(5),
    nRidge = mk(6),
    nHills = mk(7),
    nTemp = mk(8),
    nMoist = mk(9),
    nMisc = mk(10),
    nCliff = mk(11);

  const W = world.w,
    H = world.h,
    N = W * H;
  const S = Math.max(W, H);
  const sc = S / 256; // tile-distance scale relative to a 256 map
  const ox = rand() * 100,
    oy = rand() * 100;

  const fbm = (noise, x, y, oct, gain = 0.5, lac = 2.03) => {
    let a = 1,
      f = 1,
      s = 0,
      n = 0;
    for (let o = 0; o < oct; o++) {
      s += a * noise(x * f, y * f);
      n += a;
      a *= gain;
      f *= lac;
    }
    return s / n;
  };

  // Low-frequency fields are evaluated on a coarse grid and upsampled.
  const coarse = (step, fn) => lowRes(W, H, step, fn);
  const warpX1 = coarse(2, (u, v) => fbm(nWarpA, u * 2.1 + ox, v * 2.1 + oy, 3));
  const warpY1 = coarse(2, (u, v) => fbm(nWarpB, u * 2.1 + ox, v * 2.1 + oy, 3));

  _t('shape0');
  // ------------------------------------------------------------------ 1. shape
  const blobs = makeBlobs(presetName, rand);
  const shape = new Float32Array(N);
  const warpU = new Float32Array(N),
    warpV = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const u = (x + 0.5) / W,
        v = (y + 0.5) / H;
      // two-level domain warp: big bends (bays, peninsulas) + curly detail
      const wx1 = warpX1[i];
      const wy1 = warpY1[i];
      const wx2 = nWarpA(u * 7.3 + oy + wx1, v * 7.3 + ox);
      const wy2 = nWarpB(u * 7.3 + ox, v * 7.3 + oy + wy1);
      const uu = u + wx1 * P.warp + wx2 * P.warp * 0.22;
      const vv = v + wy1 * P.warp + wy2 * P.warp * 0.22;
      warpU[i] = uu;
      warpV[i] = vv;
      let b = 0;
      for (let bi = 0; bi < blobs.length; bi++) {
        const bl = blobs[bi];
        const dx = uu - bl.x,
          dy = vv - bl.y;
        const rx = dx * bl.c + dy * bl.s,
          ry = -dx * bl.s + dy * bl.c;
        const d = Math.sqrt((rx * rx) / (bl.a * bl.a) + (ry * ry) / (bl.b * bl.b));
        if (d < 1.35) {
          const t = Math.max(0, 1 - d / 1.35);
          const k = t * t * (3 - 2 * t) * bl.w;
          b = b + k - b * k * (P.union ?? 0.5); // soft union (1 = max-like)
        }
      }
      const n1 = fbm(nShape, uu * 3.2 + ox, vv * 3.2 + oy, 5);
      const n2 = fbm(nDetail, uu * 11 + oy, vv * 11 + ox, 3);
      // keep the border oceanic (rounded square falloff)
      const ex = Math.abs(u - 0.5) * 2,
        ey = Math.abs(v - 0.5) * 2;
      const rr = Math.cbrt(ex * ex * ex + ey * ey * ey); // squircle
      const edge = smoothstep(0.62, 1.0, rr);
      shape[i] = b * 1.15 + n1 * (0.42 - P.detail * 0.25) + n2 * P.detail * 0.32 - edge * edge * 1.4;
    }
  }
  // threshold at the preset's land fraction
  const thr = quantile(shape, 1 - P.land);
  const land = new Uint8Array(N);
  for (let i = 0; i < N; i++) land[i] = shape[i] > thr ? 1 : 0;
  // hard-clear a 3-tile ring at the map edge
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (x < 3 || y < 3 || x >= W - 3 || y >= H - 3) land[y * W + x] = 0;
  removeSpecks(land, W, H, Math.round(6 * sc * sc));

  _t('shape');
  // ------------------------------------------------------------ 2. distances
  const dLand = distanceField(land, W, H, 1); // for land tiles: distance to water
  const dSea = distanceField(land, W, H, 0); // for water tiles: distance to land

  _t('dist');
  // ------------------------------------------------------------ 3. elevation
  const hgt = world.height;
  const rangeMask = new Float32Array(N);
  const cliffF = coarse(2, (u, v) => nCliff(u * 3 + ox, v * 3 + oy));
  const regionalF = coarse(4, (u, v) => {
    // evaluated on unwarped coordinates (smooth enough at this frequency)
    return fbm(nMisc, u * 1.7 + ox * 0.5, v * 1.7 + oy * 0.5, 2) * 0.5 + 0.5;
  });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const uu = warpU[i],
        vv = warpV[i];
      if (land[i]) {
        const d = dLand[i] / sc;
        // coastal plain rising inland
        let e = 0.28 + 2.1 * (1 - Math.exp(-d / 7));
        // rolling hills
        const hn = fbm(nHills, uu * 9 + ox, vv * 9 + oy, 4);
        const hillK = smoothstep(1, 9, d);
        e += Math.pow(Math.max(0, hn * 0.5 + 0.5), 2.2) * 4.2 * hillK;
        // mountain spines: ridged low-frequency noise along warped coordinates
        const rn = nRange(uu * 2.3 + oy, vv * 2.3 + ox);
        const spine = 1 - Math.abs(rn);
        const regional = regionalF[i];
        const rm = spine * spine * (0.55 + 0.75 * regional) * P.mountains;
        // cliffs: in some regions highlands meet the sea directly
        const cliffy = smoothstep(0.35, 0.7, cliffF[i]);
        const inland = Math.max(smoothstep(2, P.inland ?? 15, d), cliffy * smoothstep(0, 3.5, d));
        const foot = smoothstep(0.38, 0.78, rm) * inland;
        const core = smoothstep(0.62, 1.05, rm) * inland;
        // ridged multifractal detail for peaks
        let rr = 0,
          amp = 0.5,
          freq = 1,
          prev = 1;
        for (let o = 0; o < 4; o++) {
          let r = 1 - Math.abs(nRidge(uu * 6.5 * freq + ox, vv * 6.5 * freq + oy));
          r *= r;
          rr += r * amp * prev;
          prev = r;
          amp *= 0.5;
          freq *= 2.05;
        }
        // several sharp summits per massif: a finer ridge field and scattered peaks
        let pk = 1 - Math.abs(nRidge(uu * 15.5 + oy * 1.7, vv * 15.5 - ox * 1.3));
        pk = pk * pk * pk;
        const bumps = Math.max(0, nHills(uu * 11 - oy, vv * 11 + ox));
        e += foot * (2.2 + hn * 1.2) + core * (4.0 + Math.pow(rr, 1.35) * 10.5 + pk * 4.5 + bumps * bumps * 5.0);
        rangeMask[i] = Math.max(foot, core);
        hgt[i] = e;
      } else {
        const d = dSea[i] / sc;
        const shelf = 3.6 * P.shelf;
        const bank = fbm(nMisc, uu * 6 + oy, vv * 6 + ox, 3);
        let depth = 0.22 + 1.35 * smoothstep(0, shelf, d) + 6.4 * smoothstep(shelf * 0.7, shelf * 3.4, d);
        depth += bank * 1.1 * smoothstep(1, shelf, d);
        // occasional shallow reefs / sand banks
        if (bank > 0.42) depth -= (bank - 0.42) * 6 * smoothstep(3, 10, d);
        depth = Math.max(0.2, depth);
        hgt[i] = -Math.min(depth, -MIN_HEIGHT);
      }
    }
  }
  // soften: blur land heights (kills single-tile spikes), keep coastline sign
  blurHeights(hgt, land, W, H, 2);
  terraceMountains(hgt, rangeMask, N);

  _t('elev');
  // ---------------------------------------------------------------- 4. lakes
  const nLakes = Math.round((P.lakes[0] + rand() * (P.lakes[1] - P.lakes[0])) * sc * sc);
  for (let k = 0, tries = 0; k < nLakes && tries < 400; tries++) {
    const x = Math.floor(rand() * W),
      y = Math.floor(rand() * H);
    const i = y * W + x;
    if (!land[i] || dLand[i] < 9 * sc || hgt[i] > 6.5 || rangeMask[i] > 0.3) continue;
    const r = (3 + rand() * 4.5) * sc;
    carveLake(hgt, land, W, H, x, y, r, rand, nMisc);
    k++;
  }

  _t('lakes');
  // --------------------------------------------------------------- 5. rivers
  const moistPre = coarse(3, (u, v) => 0.5 + 0.5 * fbm(nMoist, u * 3.1 + oy, v * 3.1 + ox, 3));
  const sea = oceanMask(hgt, W, H); // before rivers join everything to the ocean
  const riverMask = carveRivers(world, land, moistPre, P, sc, rand);

  _t('rivers');
  // ---------------------------------------------------------------- 6. climate
  const ocean = oceanMask(hgt, W, H);
  const wet = new Uint8Array(N);
  for (let i = 0; i < N; i++) wet[i] = hgt[i] < SEA_LEVEL ? 1 : 0;
  const dWater = distanceField(wet, W, H, 0, true); // land tiles: dist to any water
  const dOcean = distanceField(sea, W, H, 0, true); // land tiles: dist to the open sea (not rivers)
  const tempN = coarse(3, (u, v) => fbm(nTemp, u * 2.6 + ox, v * 2.6 + oy, 3));
  const flip = rand() < 0.5;
  const eq = 0.82 + rand() * 0.25; // the warm side of the map
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const h = hgt[i];
      const u = x / S,
        v = y / S;
      let lat = (y + 0.5) / H;
      if (flip) lat = 1 - lat;
      const latT = Math.max(0, Math.min(1, lat / eq));
      let temp = 0.06 + 0.92 * latT + tempN[i] * 0.2;
      world.temperature[i] = clamp01(temp - Math.max(0, h) / MAX_HEIGHT * 0.55);
      let moist = moistPre[i] * 0.85 + fbm(nMoist, u * 9 + ox, v * 9 + oy, 2) * 0.1;
      if (h >= SEA_LEVEL) moist += 0.32 * Math.exp(-Math.sqrt(dWater[i]) / (6 * sc)) - 0.05;
      world.moisture[i] = clamp01(moist);
      // lat-only temperature is used for snow lines
      shape[i] = clamp01(temp);
    }
  }

  _t('climate');
  // ---------------------------------------------------------------- biomes
  const type = world.type;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const h = hgt[i];
      const temp = world.temperature[i];
      const moist = world.moisture[i];
      const jn = hash2(x, y, seed) - 0.5; // tile jitter for ragged borders
      const bn = nMisc(x * 0.09 + ox, y * 0.09 + oy); // smooth border noise
      if (h < SEA_LEVEL) {
        const depth = -h;
        const polar = shape[i] < 0.14 + bn * 0.04;
        if (polar && depth < 3.2 && sea[i]) type[i] = TILE.ICE;
        else if (polar && !sea[i]) type[i] = TILE.ICE;
        else if (!sea[i]) type[i] = riverMask[i] || depth > 1.1 + bn * 0.5 ? TILE.SOIL : TILE.SAND; // river & lake beds
        else type[i] = depth < 2.8 + bn * 1.2 ? TILE.SAND : TILE.ROCK;
        continue;
      }
      const slope = slopeOf(hgt, W, H, x, y);
      const snowLine = 11.5 + shape[i] * 8.5 + bn * 1.6;
      const rockLine = snowLine - 4.2 + bn * 0.8;
      const dOc = Math.sqrt(dOcean[i]);
      const dW = Math.sqrt(dWater[i]);
      let t;
      if (h > snowLine || (temp < 0.1 + bn * 0.03 && h > 2)) t = TILE.SNOW;
      else if ((h > rockLine && slope > 0.55 + bn * 0.2) || slope > 2.1 + bn * 0.4) t = TILE.ROCK;
      else if (h > rockLine) t = temp > 0.32 ? TILE.TUNDRA : TILE.SNOW; // alpine meadow on high benches
      else if (dOc <= 2.2 + bn * 1.2 && h < 1.05 + bn * 0.35 && slope < 0.75) t = TILE.SAND;
      else if (dOc <= 1.5 && slope >= 0.75) t = TILE.ROCK; // sea cliffs
      else if (dW <= 1.1 && h < 0.42 && !ocean[i] && temp > 0.3 && moist < 0.62) t = TILE.SAND; // lake beaches
      else t = biomeFor(temp + bn * 0.06 + jn * 0.01, moist - bn * 0.07 + jn * 0.012, h, dW);
      type[i] = t;
    }
  }
  // tidy isolated single-tile specks (keeps biome blobs clean)
  despeckleTypes(type, hgt, W, H);

  _t('biomes');
  // ----------------------------------------------------------------- flora
  placeFlora(world, seed, nDetail);

  _t('flora');
  world.owner.fill(-1);
  world.building.fill(-1);
  world.fire.fill(0);
  world.wetness.fill(0);
  world.markAllDirty();
  if (_times) options.profile(_times);
}

// Biome lookup for dry land (temperature, moisture both 0..1).
export function biomeFor(temp, moist, h = 1, dWater = 99) {
  if (temp < 0.17) return TILE.SNOW;
  if (temp < 0.3) return moist > 0.6 ? TILE.FOREST : TILE.TUNDRA;
  if (temp < 0.68) {
    if (moist > 0.8 && h < 2.2 && dWater < 6) return TILE.SWAMP;
    if (moist > 0.56) return TILE.FOREST;
    if (moist < 0.22) return TILE.SAVANNA;
    return TILE.GRASS;
  }
  if (moist < 0.3) return TILE.DESERT;
  if (moist < 0.46) return TILE.SAVANNA;
  if (moist > 0.82 && h < 2.0 && dWater < 5) return TILE.SWAMP;
  if (moist > 0.6) return TILE.JUNGLE;
  return TILE.GRASS;
}

// ------------------------------------------------------------------ helpers
// Evaluate fn(u, v) (u, v = normalised tile-centre coordinates against the
// larger map side) every `step` tiles and bilinearly upsample to W x H.
function lowRes(W, H, step, fn) {
  const S = Math.max(W, H);
  const cw = Math.ceil(W / step) + 2,
    ch = Math.ceil(H / step) + 2;
  const g = new Float32Array(cw * ch);
  for (let j = 0; j < ch; j++)
    for (let i = 0; i < cw; i++) g[j * cw + i] = fn((i * step + 0.5) / S, (j * step + 0.5) / S);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const fy = y / step,
      j0 = Math.floor(fy),
      ty = fy - j0;
    for (let x = 0; x < W; x++) {
      const fx = x / step,
        i0 = Math.floor(fx),
        tx = fx - i0;
      const a = g[j0 * cw + i0],
        b = g[j0 * cw + i0 + 1],
        c = g[(j0 + 1) * cw + i0],
        d = g[(j0 + 1) * cw + i0 + 1];
      out[y * W + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return out;
}
function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function makeBlobs(preset, rand) {
  const blobs = [];
  const add = (x, y, r, aspect = 1, w = 1) => {
    const ang = rand() * Math.PI;
    blobs.push({ x, y, a: r * Math.sqrt(aspect), b: r / Math.sqrt(aspect), c: Math.cos(ang), s: Math.sin(ang), w });
  };
  const spread = (n, minSep, rMin, rMax, margin, w = 1, aspect = 1.6) => {
    const pts = [];
    for (let k = 0, tries = 0; k < n && tries < 2000; tries++) {
      const x = margin + rand() * (1 - 2 * margin),
        y = margin + rand() * (1 - 2 * margin);
      if (pts.some((p) => Math.hypot(p[0] - x, p[1] - y) < minSep)) continue;
      pts.push([x, y]);
      add(x, y, rMin + rand() * (rMax - rMin), 1 + rand() * (aspect - 1), w);
      k++;
    }
    return pts;
  };
  if (preset === 'pangaea') {
    add(0.5 + (rand() - 0.5) * 0.06, 0.5 + (rand() - 0.5) * 0.06, 0.36, 1.25, 1.1);
    for (let k = 0; k < 3; k++) {
      const a = rand() * Math.PI * 2;
      add(0.5 + Math.cos(a) * 0.2, 0.5 + Math.sin(a) * 0.2, 0.17 + rand() * 0.06, 1.5, 0.9);
    }
  } else if (preset === 'archipelago') {
    spread(22, 0.135, 0.035, 0.075, 0.12, 1.0, 2.0);
  } else if (preset === 'islands') {
    spread(6, 0.27, 0.10, 0.145, 0.2, 1.0, 1.7);
    spread(5, 0.08, 0.025, 0.04, 0.12, 0.8, 1.5);
  } else {
    // continent: a main landmass, a sizeable second one and a few islets
    const cx = 0.5 + (rand() - 0.5) * 0.12,
      cy = 0.5 + (rand() - 0.5) * 0.12;
    add(cx, cy, 0.27, 1.5, 1.05);
    const a = rand() * Math.PI * 2;
    add(cx + Math.cos(a) * 0.24, cy + Math.sin(a) * 0.24, 0.15, 1.8, 0.95);
    const a2 = a + Math.PI * (0.6 + rand() * 0.8);
    add(cx + Math.cos(a2) * 0.2, cy + Math.sin(a2) * 0.2, 0.11, 2.0, 0.85);
    spread(5, 0.1, 0.025, 0.05, 0.1, 0.75, 1.6);
  }
  return blobs;
}

function quantile(arr, q) {
  // sample every 3rd value for speed (plenty for a threshold)
  const n = Math.ceil(arr.length / 3);
  const tmp = new Float32Array(n);
  for (let i = 0, k = 0; i < arr.length; i += 3, k++) tmp[k] = arr[i];
  tmp.sort();
  return tmp[Math.min(n - 1, Math.max(0, Math.floor(q * n)))];
}

// Remove connected land components smaller than minSize tiles (4-connected).
function removeSpecks(land, W, H, minSize) {
  const seen = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  const comp = new Int32Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (!land[s] || seen[s]) continue;
    let sp = 0,
      cn = 0;
    stack[sp++] = s;
    seen[s] = 1;
    while (sp) {
      const i = stack[--sp];
      comp[cn++] = i;
      const x = i % W,
        y = (i / W) | 0;
      if (x > 0 && land[i - 1] && !seen[i - 1]) (seen[i - 1] = 1), (stack[sp++] = i - 1);
      if (x < W - 1 && land[i + 1] && !seen[i + 1]) (seen[i + 1] = 1), (stack[sp++] = i + 1);
      if (y > 0 && land[i - W] && !seen[i - W]) (seen[i - W] = 1), (stack[sp++] = i - W);
      if (y < H - 1 && land[i + W] && !seen[i + W]) (seen[i + W] = 1), (stack[sp++] = i + W);
    }
    if (cn < minSize) for (let k = 0; k < cn; k++) land[comp[k]] = 0;
  }
}

// Euclidean distance (tiles) for tiles where mask == value, to the nearest tile
// where mask != value. Returns squared distances when squared is true.
function distanceField(mask, W, H, value, squared = false) {
  const INF = 1e9;
  const g = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = mask[i] === value ? INF : 0;
  edt2d(g, W, H);
  if (!squared) for (let i = 0; i < W * H; i++) g[i] = Math.sqrt(g[i]);
  return g;
}
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}
function edt2d(grid, W, H) {
  const n = Math.max(W, H);
  const f = new Float64Array(n),
    d = new Float64Array(n),
    v = new Int32Array(n),
    z = new Float64Array(n + 1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = grid[y * W + x];
    edt1d(f, H, d, v, z);
    for (let y = 0; y < H; y++) grid[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = grid[y * W + x];
    edt1d(f, W, d, v, z);
    for (let x = 0; x < W; x++) grid[y * W + x] = d[x];
  }
}

function blurHeights(hgt, land, W, H, passes) {
  const tmp = new Float32Array(W * H);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        let s = hgt[i] * 4,
          n = 4;
        if (x > 0) (s += hgt[i - 1] * 2), (n += 2);
        if (x < W - 1) (s += hgt[i + 1] * 2), (n += 2);
        if (y > 0) (s += hgt[i - W] * 2), (n += 2);
        if (y < H - 1) (s += hgt[i + W] * 2), (n += 2);
        if (x > 0 && y > 0) (s += hgt[i - W - 1]), n++;
        if (x < W - 1 && y > 0) (s += hgt[i - W + 1]), n++;
        if (x > 0 && y < H - 1) (s += hgt[i + W - 1]), n++;
        if (x < W - 1 && y < H - 1) (s += hgt[i + W + 1]), n++;
        tmp[i] = s / n;
      }
    for (let i = 0; i < W * H; i++) {
      let v = tmp[i];
      if (land[i]) v = Math.max(v, 0.22);
      else v = Math.min(v, -0.18);
      hgt[i] = v;
    }
  }
}

// Soft terracing of mountain cores: flat benches separated by steep risers, so
// ranges read as stepped, stratified massifs instead of smooth cones.
function terraceMountains(hgt, rangeMask, N) {
  const step = 3.0;
  for (let i = 0; i < N; i++) {
    const m = rangeMask[i];
    if (m <= 0.08) continue;
    const h = hgt[i];
    if (h < 2.5) continue;
    const b = Math.floor(h / step) * step;
    const f = (h - b) / step;
    const g = smoothstep(0.6, 1.0, f);
    const k = smoothstep(0.08, 0.45, m) * smoothstep(2.5, 5, h);
    hgt[i] = h + (b + g * step - h) * k;
  }
}

function slopeOf(hgt, W, H, x, y) {
  const h = hgt[y * W + x];
  let m = 0;
  if (x > 0) m = Math.max(m, Math.abs(hgt[y * W + x - 1] - h));
  if (x < W - 1) m = Math.max(m, Math.abs(hgt[y * W + x + 1] - h));
  if (y > 0) m = Math.max(m, Math.abs(hgt[(y - 1) * W + x] - h));
  if (y < H - 1) m = Math.max(m, Math.abs(hgt[(y + 1) * W + x] - h));
  return m;
}

function carveLake(hgt, land, W, H, cx, cy, r, rand, noise) {
  const depth = 1.0 + rand() * 1.4;
  const R = Math.ceil(r * 1.6) + 2;
  const ang = rand() * Math.PI;
  const asp = 1 + rand() * 0.8;
  const c = Math.cos(ang),
    s = Math.sin(ang);
  const seed = rand() * 50;
  for (let y = cy - R; y <= cy + R; y++)
    for (let x = cx - R; x <= cx + R; x++) {
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) continue;
      const i = y * W + x;
      const dx = x - cx,
        dy = y - cy;
      const rx = (dx * c + dy * s) / Math.sqrt(asp),
        ry = (-dx * s + dy * c) * Math.sqrt(asp);
      const a = Math.atan2(ry, rx);
      const wob = 1 + 0.38 * noise(Math.cos(a) * 1.1 + seed, Math.sin(a) * 1.1 + seed) + 0.22 * noise(Math.cos(a) * 2.7 - seed, Math.sin(a) * 2.7) + 0.12 * noise(x * 0.35 + seed, y * 0.35);
      const dn = Math.hypot(rx, ry) / (r * wob);
      if (dn > 1.5) continue;
      const k = smoothstep(0.45, 1.35, dn);
      const target = -depth * (1 - k) + hgt[i] * k;
      if (target < hgt[i]) hgt[i] = target;
    }
}

// Water tiles connected to the map border.
function oceanMask(hgt, W, H) {
  const N = W * H;
  const m = new Uint8Array(N);
  const stack = new Int32Array(N);
  let sp = 0;
  const push = (i) => {
    if (!m[i] && hgt[i] < SEA_LEVEL) {
      m[i] = 1;
      stack[sp++] = i;
    }
  };
  for (let x = 0; x < W; x++) push(x), push((H - 1) * W + x);
  for (let y = 0; y < H; y++) push(y * W), push(y * W + W - 1);
  while (sp) {
    const i = stack[--sp];
    const x = i % W,
      y = (i / W) | 0;
    if (x > 0) push(i - 1);
    if (x < W - 1) push(i + 1);
    if (y > 0) push(i - W);
    if (y < H - 1) push(i + W);
  }
  return m;
}

class MinHeap {
  constructor(cap) {
    this.k = new Float32Array(cap);
    this.v = new Int32Array(cap);
    this.n = 0;
  }
  push(key, val) {
    let i = this.n++;
    const k = this.k,
      v = this.v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop() {
    const k = this.k,
      v = this.v;
    const top = v[0];
    const lk = k[--this.n],
      lv = v[this.n];
    let i = 0;
    const n = this.n;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && k[c + 1] < k[c]) c++;
      if (k[c] >= lk) break;
      k[i] = k[c];
      v[i] = v[c];
      i = c;
    }
    k[i] = lk;
    v[i] = lv;
    return top;
  }
}

const NBX = [1, -1, 0, 0, 1, 1, -1, -1];
const NBY = [0, 0, 1, -1, 1, -1, 1, -1];
const NBC = [1, 1, 1, 1, 1.414, 1.414, 1.414, 1.414];

function carveRivers(world, land, moist, P, sc, rand) {
  const W = world.w,
    H = world.h,
    N = W * H;
  const hgt = world.height;
  const ocean = oceanMask(hgt, W, H);
  // ---- priority flood from the ocean: drainage directions for all land
  // routing surface: real heights plus gentle noise so channels meander
  // across flats instead of running in straight D8 lines
  const nMe = createNoise2D(mulberry32((world.seed * 31 + 7) >>> 0));
  const meander = lowRes(W, H, 2, (u, v) => nMe(u * 15.4, v * 15.4) * 0.9 + nMe(u * 48.6 + 40, v * 48.6) * 0.35);
  const route = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const m = meander[i];
    route[i] = hgt[i] + (hgt[i] > 0 ? m * (0.6 + Math.min(1, hgt[i] / 6)) : 0);
  }
  const visited = new Uint8Array(N);
  const down = new Int32Array(N).fill(-1);
  const order = new Int32Array(N);
  const filled = new Float32Array(N);
  let oc = 0;
  const heap = new MinHeap(N * 2);
  for (let i = 0; i < N; i++) {
    if (!ocean[i]) continue;
    visited[i] = 1;
    const x = i % W,
      y = (i / W) | 0;
    let coast = false;
    for (let q = 0; q < 8; q++) {
      const xx = x + NBX[q],
        yy = y + NBY[q];
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && !ocean[yy * W + xx]) coast = true;
    }
    if (coast) heap.push(0, i);
    filled[i] = 0;
  }
  while (heap.n) {
    const i = heap.pop();
    const x = i % W,
      y = (i / W) | 0;
    const fi = filled[i];
    for (let q = 0; q < 8; q++) {
      const xx = x + NBX[q],
        yy = y + NBY[q],
        dc = NBC[q];
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const j = yy * W + xx;
      if (visited[j]) continue;
      visited[j] = 1;
      filled[j] = Math.max(route[j], fi + 0.002 * dc);
      down[j] = i;
      order[oc++] = j;
      heap.push(filled[j], j);
    }
  }
  // ---- flow accumulation (upstream first), orographic rain
  const acc = new Float32Array(N);
  for (let k = 0; k < oc; k++) {
    const i = order[k];
    acc[i] = 0.35 + moist[i] * 0.9 + Math.max(0, hgt[i]) / MAX_HEIGHT * 1.6;
  }
  for (let k = oc - 1; k >= 0; k--) {
    const i = order[k];
    const d = down[i];
    if (d >= 0 && !ocean[d]) acc[d] += acc[i];
  }
  // ---- threshold for the target river coverage
  let landCount = 0;
  for (let k = 0; k < oc; k++) if (hgt[order[k]] >= SEA_LEVEL) landCount++;
  const vals = new Float32Array(oc);
  for (let k = 0; k < oc; k++) vals[k] = acc[order[k]];
  vals.sort();
  const nRiver = Math.max(1, Math.floor(landCount * P.rivers));
  const T = Math.max(40 * sc * sc, vals[Math.max(0, oc - nRiver)]);
  const river = new Uint8Array(N);
  for (let k = 0; k < oc; k++) if (acc[order[k]] >= T) river[order[k]] = 1;
  // ---- prune short systems: length of the longest channel above each tile
  const len = new Float32Array(N);
  for (let k = oc - 1; k >= 0; k--) {
    const i = order[k];
    if (!river[i]) continue;
    len[i] += 1;
    const d = down[i];
    if (d >= 0 && river[d]) len[d] = Math.max(len[d], len[i]);
  }
  const keep = new Uint8Array(N);
  const minLen = 14 * sc;
  for (let k = 0; k < oc; k++) {
    const i = order[k];
    if (!river[i]) continue;
    const d = down[i];
    keep[i] = d >= 0 && river[d] ? keep[d] : len[i] >= minLen ? 1 : 0;
  }
  // ---- carve channels and valleys (downstream tiles first is irrelevant: min)
  const target = new Float32Array(N).fill(1e9);
  for (let k = 0; k < oc; k++) {
    const i = order[k];
    if (!keep[i]) continue;
    const size = Math.min(1, Math.log2(acc[i] / T + 1) / 3.2);
    const w = (0.12 + 0.62 * size) * Math.max(1, sc * 0.8);
    const bed = -(0.30 + 0.45 * size);
    const R = Math.ceil(w + 15);
    const x = i % W,
      y = (i / W) | 0;
    for (let yy = y - R; yy <= y + R; yy++)
      for (let xx = x - R; xx <= x + R; xx++) {
        if (xx < 1 || yy < 1 || xx >= W - 1 || yy >= H - 1) continue;
        const ddx = xx - x,
          ddy = yy - y;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 > R * R) continue;
        const d = Math.sqrt(d2);
        const e = Math.max(0, d - w);
        const ev = Math.max(0, e - 1.1);
        const t = bed + (0.45 - bed) * smoothstep(0, 1.1, e) + ev * 0.27 + ev * ev * 0.034;
        const j = yy * W + xx;
        if (t < target[j]) target[j] = t;
      }
  }
  // the returned mask marks river channel tiles (centrelines and newly
  // flooded banks) so their beds can be typed as pebbly soil
  for (let i = 0; i < N; i++) {
    if (target[i] < hgt[i]) {
      if (target[i] < SEA_LEVEL && hgt[i] >= SEA_LEVEL) keep[i] = 1;
      hgt[i] = target[i];
    }
  }
  return keep;
}

function despeckleTypes(type, hgt, W, H) {
  const out = type.slice();
  const counts = new Uint8Array(32);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (hgt[i] < SEA_LEVEL) continue;
      const t = type[i];
      let same = 0;
      counts.fill(0);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const j = i + dy * W + dx;
          if (hgt[j] < SEA_LEVEL) continue;
          const tj = type[j];
          if (tj === t) same++;
          counts[tj]++;
        }
      if (same <= 1) {
        let best = t,
          bc = 0;
        for (let k = 0; k < 32; k++)
          if (counts[k] > bc) {
            bc = counts[k];
            best = k;
          }
        if (bc >= 4 && t !== TILE.SAND && best !== TILE.SAND) out[i] = best;
      }
    }
  type.set(out);
}

function placeFlora(world, seed, nDetail) {
  const W = world.w,
    H = world.h;
  const hgt = world.height;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      world.flora[i] = FLORA.NONE;
      world.floraGrowth[i] = 0;
      if (hgt[i] < SEA_LEVEL) continue;
      const r = hash2(x, y, seed);
      const r2 = hash2(y, x, seed + 17);
      const cluster = 0.5 + 0.5 * nDetail(x / 9, y / 9);
      const temp = world.temperature[i];
      const slope = slopeOf(hgt, W, H, x, y);
      const nearWater = isNearWater(hgt, W, H, x, y);
      let f = FLORA.NONE;
      switch (world.type[i]) {
        case TILE.FOREST:
          if (r < 0.40 * cluster + 0.12) {
            if (temp < 0.34) f = r2 < 0.75 ? FLORA.PINE : FLORA.BIRCH;
            else f = r2 < 0.62 ? FLORA.OAK : r2 < 0.84 ? FLORA.BIRCH : FLORA.PINE;
          } else if (r < 0.56) f = r2 < 0.55 ? FLORA.BUSH : r2 < 0.8 ? FLORA.MUSHROOM : FLORA.BERRY_BUSH;
          break;
        case TILE.GRASS:
          if (r < 0.08 * cluster) f = r2 < 0.7 ? FLORA.OAK : FLORA.BIRCH;
          else if (r < 0.15) f = FLORA.FLOWERS;
          else if (r < 0.18) f = r2 < 0.5 ? FLORA.BUSH : FLORA.BERRY_BUSH;
          else if (r < 0.19) f = FLORA.ROCK_SMALL;
          else if (nearWater && r < 0.3) f = FLORA.REEDS;
          break;
        case TILE.JUNGLE:
          if (r < 0.46 * cluster + 0.14) f = r2 < 0.8 ? FLORA.JUNGLE_TREE : FLORA.PALM;
          else if (r < 0.66) f = FLORA.BUSH;
          break;
        case TILE.SAVANNA:
          if (r < 0.045 * (0.5 + cluster)) f = FLORA.ACACIA;
          else if (r < 0.09) f = FLORA.BUSH;
          else if (r < 0.1) f = FLORA.ROCK_SMALL;
          break;
        case TILE.SWAMP:
          if (r < 0.2) f = FLORA.SWAMP_TREE;
          else if (r < 0.42) f = FLORA.REEDS;
          else if (r < 0.47) f = FLORA.MUSHROOM;
          break;
        case TILE.TUNDRA:
          if (r < 0.12 * cluster) f = FLORA.PINE;
          else if (r < 0.17) f = FLORA.ROCK_SMALL;
          else if (r < 0.19) f = FLORA.BOULDER;
          break;
        case TILE.SNOW:
          if (hgt[i] < 9 && slope < 1.2 && r < 0.14 * cluster) f = FLORA.SNOW_PINE;
          break;
        case TILE.ROCK:
          if (slope < 1.6 && r < 0.05) f = FLORA.BOULDER;
          else if (r < 0.12) f = FLORA.ROCK_SMALL;
          break;
        case TILE.DESERT:
          if (r < 0.014) f = FLORA.CACTUS;
          else if (r < 0.022) f = FLORA.ROCK_SMALL;
          else if (nearWater && r < 0.25) f = r2 < 0.5 ? FLORA.PALM : FLORA.BUSH;
          break;
        case TILE.SAND:
          if (r < 0.035 && temp > 0.58 && slope < 0.6) f = FLORA.PALM;
          break;
      }
      if (f !== FLORA.NONE) {
        world.flora[i] = f;
        world.floraGrowth[i] = 0.6 + 0.4 * r2;
      }
    }
  }
}

function isNearWater(hgt, W, H, x, y) {
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx,
        yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && hgt[yy * W + xx] < SEA_LEVEL) return true;
    }
  return false;
}

// Find a random land tile that satisfies a predicate (returns [tx,ty] or null).
export function findLandTile(world, rng, predicate = () => true, tries = 4000) {
  for (let k = 0; k < tries; k++) {
    const tx = Math.floor(rng.next() * world.w);
    const ty = Math.floor(rng.next() * world.h);
    if (world.isWalkable(tx, ty) && predicate(tx, ty)) return [tx, ty];
  }
  return null;
}
