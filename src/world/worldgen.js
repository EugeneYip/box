import { createNoise2D } from 'simplex-noise';
import { mulberry32, hash2 } from '../core/Random.js';
import { TILE, FLORA, SEA_LEVEL, MAX_HEIGHT, MIN_HEIGHT } from './constants.js';
import { generateEarth } from './earth.js';

// Procedural world generation (Landscape). Fills height / type / temperature /
// moisture / flora of a World. Deterministic for a given seed.
//
// options.preset: 'continent' | 'pangaea' | 'archipelago' | 'islands' | 'earth'
// ('earth' is the World Map: real geography on a 2:1 world, src/world/earth.js)
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

// Preset ids this generator can build; the UI only offers these.
// (A preset implemented outside PRESETS, such as the World Map, appends its id.)
export const WORLD_PRESET_IDS = [...Object.keys(PRESETS), 'earth'];

export function generateWorld(world, seed = 1, options = {}) {
  if (options.preset === 'earth') return generateEarth(world, seed, options, EARTH_HELPERS);
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
  // Feature scale: noise frequencies grow with the map so a Huge map gets more
  // continents, ranges and lakes instead of one magnified island.
  const fs = Math.max(1, sc);
  const ds = Math.min(1, sc); // distance shaping in absolute tiles on big maps
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
  const warpX1 = coarse(2, (u, v) => fbm(nWarpA, u * 2.1 * fs + ox, v * 2.1 * fs + oy, 3));
  const warpY1 = coarse(2, (u, v) => fbm(nWarpB, u * 2.1 * fs + ox, v * 2.1 * fs + oy, 3));

  _t('shape0');
  // ------------------------------------------------------------------ 1. shape
  const blobs = makeBlobs(presetName, rand, fs);
  const warpAmp = P.warp / fs;
  // big continent maps: keep the continents apart (max-like union, a little less land)
  const bigCont = presetName === 'continent' && fs >= 1.25;
  const union = bigCont ? 0.97 : P.union ?? 0.5;
  const landFrac = bigCont ? P.land - 0.06 * Math.min(1, fs - 1) : P.land;
  // shape(u, v) -> [shape, warpedU, warpedV]; evaluated per tile, or on a half
  // resolution grid on Large / Huge maps (the field is smooth at that scale)
  const shapeAt = (u, v, wx1, wy1, out) => {
    const wx2 = nWarpA(u * 7.3 * fs + oy + wx1, v * 7.3 * fs + ox);
    const wy2 = nWarpB(u * 7.3 * fs + ox, v * 7.3 * fs + oy + wy1);
    const uu = u + wx1 * warpAmp + wx2 * warpAmp * 0.22;
    const vv = v + wy1 * warpAmp + wy2 * warpAmp * 0.22;
    let bsum = 0;
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
        bsum = bsum + k - bsum * k * union; // soft union (1 = max-like)
      }
    }
    const n1 = fbm(nShape, uu * 3.2 * fs + ox, vv * 3.2 * fs + oy, 5);
    const n2 = fbm(nDetail, uu * 11 * fs + oy, vv * 11 * fs + ox, 3);
    // keep the border oceanic (rounded square falloff)
    const ex = Math.abs(u - 0.5) * 2,
      ey = Math.abs(v - 0.5) * 2;
    const rr = Math.cbrt(ex * ex * ex + ey * ey * ey); // squircle
    const edge = smoothstep(0.62, 1.0, rr);
    out[0] = bsum * 1.15 + n1 * (0.42 - P.detail * 0.25) + n2 * P.detail * 0.32 - edge * edge * 1.4;
    out[1] = uu;
    out[2] = vv;
  };
  const shape = new Float32Array(N);
  const warpU = new Float32Array(N),
    warpV = new Float32Array(N);
  const tmp3 = [0, 0, 0];
  const sstep = sc >= 1.4 ? 2 : 1;
  if (sstep === 1) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        shapeAt((x + 0.5) / W, (y + 0.5) / H, warpX1[i], warpY1[i], tmp3);
        shape[i] = tmp3[0];
        warpU[i] = tmp3[1];
        warpV[i] = tmp3[2];
      }
  } else {
    const cw = Math.ceil(W / sstep) + 2,
      chh = Math.ceil(H / sstep) + 2;
    const cS = new Float32Array(cw * chh),
      cU = new Float32Array(cw * chh),
      cV = new Float32Array(cw * chh);
    for (let j = 0; j < chh; j++)
      for (let i = 0; i < cw; i++) {
        const x = Math.min(W - 1, i * sstep),
          y = Math.min(H - 1, j * sstep);
        const k = y * W + x;
        shapeAt((i * sstep + 0.5) / W, (j * sstep + 0.5) / H, warpX1[k], warpY1[k], tmp3);
        cS[j * cw + i] = tmp3[0];
        cU[j * cw + i] = tmp3[1];
        cV[j * cw + i] = tmp3[2];
      }
    for (let y = 0; y < H; y++) {
      const fy = y / sstep,
        j0 = Math.floor(fy),
        ty = fy - j0;
      for (let x = 0; x < W; x++) {
        const fx = x / sstep,
          i0 = Math.floor(fx),
          tx = fx - i0;
        const a00 = j0 * cw + i0,
          a10 = a00 + 1,
          a01 = a00 + cw,
          a11 = a01 + 1;
        const w00 = (1 - tx) * (1 - ty),
          w10 = tx * (1 - ty),
          w01 = (1 - tx) * ty,
          w11 = tx * ty;
        const i = y * W + x;
        shape[i] = cS[a00] * w00 + cS[a10] * w10 + cS[a01] * w01 + cS[a11] * w11;
        warpU[i] = cU[a00] * w00 + cU[a10] * w10 + cU[a01] * w01 + cU[a11] * w11;
        warpV[i] = cV[a00] * w00 + cV[a10] * w10 + cV[a01] * w01 + cV[a11] * w11;
      }
    }
  }
  // threshold at the preset's land fraction
  const thr = quantile(shape, 1 - landFrac);
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
  const cliffF = coarse(2, (u, v) => nCliff(u * 3 * fs + ox, v * 3 * fs + oy));
  const regionalF = coarse(4, (u, v) => {
    // evaluated on unwarped coordinates (smooth enough at this frequency)
    return fbm(nMisc, u * 1.7 * fs + ox * 0.5, v * 1.7 * fs + oy * 0.5, 2) * 0.5 + 0.5;
  });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const uu = warpU[i],
        vv = warpV[i];
      if (land[i]) {
        const d = dLand[i] / ds;
        // coastal plain rising inland
        let e = 0.28 + 2.1 * (1 - Math.exp(-d / 7));
        // rolling hills
        const hn = fbm(nHills, uu * 9 * fs + ox, vv * 9 * fs + oy, sstep > 1 ? 3 : 4);
        const hillK = smoothstep(1, 9, d);
        e += Math.pow(Math.max(0, hn * 0.5 + 0.5), 2.2) * 4.2 * hillK;
        // mountain spines: ridged low-frequency noise along warped coordinates
        const rn = nRange(uu * 2.3 * fs + oy, vv * 2.3 * fs + ox);
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
          let r = 1 - Math.abs(nRidge(uu * 6.5 * fs * freq + ox, vv * 6.5 * fs * freq + oy));
          r *= r;
          rr += r * amp * prev;
          prev = r;
          amp *= 0.5;
          freq *= 2.05;
        }
        // several sharp summits per massif: a finer ridge field and scattered peaks
        let pk = 1 - Math.abs(nRidge(uu * 15.5 * fs + oy * 1.7, vv * 15.5 * fs - ox * 1.3));
        pk = pk * pk * pk;
        const bumps = Math.max(0, nHills(uu * 11 * fs - oy, vv * 11 * fs + ox));
        e += foot * (2.2 + hn * 1.2) + core * (4.0 + Math.pow(rr, 1.35) * 10.5 + pk * 4.5 + bumps * bumps * 5.0);
        rangeMask[i] = Math.max(foot, core);
        hgt[i] = e;
      } else {
        const d = dSea[i] / ds;
        const shelf = 3.6 * P.shelf;
        const bank = fbm(nMisc, uu * 6 * fs + oy, vv * 6 * fs + ox, 3);
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
  terraceMountains(hgt, rangeMask, W, H);

  _t('elev');
  // ---------------------------------------------------------------- 4. lakes
  const nLakes = Math.round((P.lakes[0] + rand() * (P.lakes[1] - P.lakes[0])) * sc * sc);
  for (let k = 0, tries = 0; k < nLakes && tries < 400; tries++) {
    const x = Math.floor(rand() * W),
      y = Math.floor(rand() * H);
    const i = y * W + x;
    if (!land[i] || dLand[i] < 9 * ds || hgt[i] > 6.5 || rangeMask[i] > 0.3) continue;
    const r = (3 + rand() * 4.5) * ds;
    carveLake(hgt, land, W, H, x, y, r, rand, nMisc);
    k++;
  }

  _t('lakes');
  // --------------------------------------------------------------- 5. rivers
  const moistPre = coarse(3, (u, v) => 0.5 + 0.5 * fbm(nMoist, u * 3.1 * fs + oy, v * 3.1 * fs + ox, 3));
  const sea = oceanMask(hgt, W, H); // before rivers join everything to the ocean
  const riverMask = carveRivers(world, land, moistPre, P, sc, rand);

  _t('rivers');
  // ---------------------------------------------------------------- 6. climate
  const ocean = oceanMask(hgt, W, H);
  const wet = new Uint8Array(N);
  for (let i = 0; i < N; i++) wet[i] = hgt[i] < SEA_LEVEL ? 1 : 0;
  const dWater = distanceField(wet, W, H, 0, true); // land tiles: dist to any water
  const dOcean = distanceField(sea, W, H, 0, true); // land tiles: dist to the open sea (not rivers)
  const tempN = coarse(3, (u, v) => fbm(nTemp, u * 2.6 * fs + ox, v * 2.6 * fs + oy, 3));
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
  // tiny snow islands (a tile or two of snow inside a forest) read as glitches
  dissolveSmallPatches(type, hgt, W, H, TILE.SNOW, Math.round(12 * Math.max(1, sc)), (i) =>
    world.temperature[i] < 0.3 ? TILE.TUNDRA : biomeFor(world.temperature[i], world.moisture[i], hgt[i], 8),
  );

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

function makeBlobs(preset, rand, fs = 1) {
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
  const f2 = fs * fs;
  if (preset === 'pangaea') {
    add(0.5 + (rand() - 0.5) * 0.06, 0.5 + (rand() - 0.5) * 0.06, 0.36, 1.25, 1.1);
    const lobes = Math.round(3 + 2 * (fs - 1));
    for (let k = 0; k < lobes; k++) {
      const a = rand() * Math.PI * 2;
      const r = 0.18 + rand() * 0.08;
      add(0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r, (0.17 + rand() * 0.06) / Math.sqrt(fs), 1.5, 0.9);
    }
  } else if (preset === 'archipelago') {
    spread(Math.round(22 * f2), 0.135 / fs, 0.035 / fs, 0.075 / fs, 0.1, 1.0, 2.0);
  } else if (preset === 'islands') {
    spread(Math.round(6 * f2), 0.27 / fs, 0.10 / fs, 0.145 / fs, 0.16, 1.0, 1.7);
    spread(Math.round(5 * f2), 0.08 / fs, 0.025 / fs, 0.04 / fs, 0.1, 0.8, 1.5);
  } else if (fs >= 1.25) {
    // big continent maps: several continents, each with a satellite, plus islets
    const nC = fs >= 1.75 ? 3 : 2;
    const centres = spread(nC, nC >= 3 ? 0.4 : 0.46, 0.22 / Math.sqrt(nC) * 1.2, 0.25 / Math.sqrt(nC) * 1.3, 0.2, 1.05, 1.6);
    for (const [x, y] of centres) {
      const a = rand() * Math.PI * 2;
      add(x + Math.cos(a) * 0.14, y + Math.sin(a) * 0.14, 0.09 + rand() * 0.04, 1.8, 0.9);
    }
    spread(Math.round(5 * f2), 0.1 / fs, 0.025 / fs, 0.05 / fs, 0.08, 0.75, 1.6);
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
function terraceMountains(hgt, rangeMask, W, H) {
  // Terraces only where the ground is gentle enough for a bench; on steep faces
  // per-tile terracing carved downhill grooves (vertical banding), so those keep
  // their natural slope and get their ledges from the strata shading instead.
  const N = W * H;
  const step = 3.0;
  const src = hgt.slice();
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const m = rangeMask[i];
      if (m <= 0.08) continue;
      const h = src[i];
      if (h < 2.5) continue;
      const slope = Math.max(Math.abs(src[i + 1] - src[i - 1]), Math.abs(src[i + W] - src[i - W])) * 0.5;
      const b = Math.floor(h / step) * step;
      const f = (h - b) / step;
      const g = smoothstep(0.6, 1.0, f);
      const k = 0.8 * smoothstep(0.08, 0.45, m) * smoothstep(2.5, 5, h) * (1 - smoothstep(0.9, 1.9, slope));
      hgt[i] = h + (b + g * step - h) * k;
    }
  // light relaxation across massifs removes column-to-column grooves
  const tmp = hgt.slice();
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const m = rangeMask[i];
      if (m <= 0.08) continue;
      const avg = (tmp[i - 1] + tmp[i + 1] + tmp[i - W] + tmp[i + W]) * 0.25;
      hgt[i] = tmp[i] + (avg - tmp[i]) * 0.35 * Math.min(1, m * 2);
    }
  void N;
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
  const mf = Math.max(1, sc); // meanders keep their size in tiles on big maps
  const meander = lowRes(W, H, 2, (u, v) => nMe(u * 15.4 * mf, v * 15.4 * mf) * 0.9 + nMe(u * 48.6 * mf + 40, v * 48.6 * mf) * 0.35);
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
  const minLen = 14 * Math.min(1, sc);
  for (let k = 0; k < oc; k++) {
    const i = order[k];
    if (!river[i]) continue;
    const d = down[i];
    keep[i] = d >= 0 && river[d] ? keep[d] : len[i] >= minLen ? 1 : 0;
  }
  // ---- smooth, meandering centrelines. The drainage tree runs in D8 steps
  // (45/90 degree jogs); relax each river point toward its main up- and
  // downstream neighbours, then push it sideways by a meander that grows with
  // the river, then relax once more. Channels are carved along the segments
  // between successive points, so they stay connected all the way to the sea.
  const riv = [];
  for (let k = 0; k < oc; k++) if (keep[order[k]]) riv.push(order[k]); // mouth-first order
  const px = new Float32Array(N),
    pz = new Float32Array(N);
  const mainUp = new Int32Array(N).fill(-1);
  const sAlong = new Float32Array(N);
  const phase = new Float32Array(N);
  for (const i of riv) {
    px[i] = (i % W) + 0.5;
    pz[i] = ((i / W) | 0) + 0.5;
    const d = down[i];
    if (d >= 0 && keep[d] && (mainUp[d] < 0 || acc[i] > acc[mainUp[d]])) mainUp[d] = i;
  }
  for (const i of riv) {
    const d = down[i];
    if (d >= 0 && keep[d]) {
      const step = Math.abs(i - d) === 1 || Math.abs(i - d) === W ? 1 : 1.414;
      sAlong[i] = sAlong[d] + step;
      phase[i] = phase[d];
    } else {
      sAlong[i] = 0;
      phase[i] = rand() * 100;
    }
  }
  const nx = new Float32Array(N),
    nz = new Float32Array(N);
  const relax = (passes) => {
    for (let pass = 0; pass < passes; pass++) {
      for (const i of riv) {
        const u = mainUp[i] >= 0 ? mainUp[i] : i;
        const d = down[i];
        const dx = d >= 0 && keep[d] ? px[d] : d >= 0 ? (d % W) + 0.5 : px[i];
        const dz = d >= 0 && keep[d] ? pz[d] : d >= 0 ? ((d / W) | 0) + 0.5 : pz[i];
        nx[i] = px[u] * 0.25 + px[i] * 0.5 + dx * 0.25;
        nz[i] = pz[u] * 0.25 + pz[i] * 0.5 + dz * 0.25;
      }
      for (const i of riv) {
        px[i] = nx[i];
        pz[i] = nz[i];
      }
    }
  };
  relax(3);
  const sizeOf = (i) => Math.min(1, Math.log2(acc[i] / T + 1) / 3.2);
  for (const i of riv) {
    const u = mainUp[i] >= 0 ? mainUp[i] : i;
    const d = down[i] >= 0 && keep[down[i]] ? down[i] : i;
    let tx = px[d] - px[u],
      tz = pz[d] - pz[u];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const sa = sAlong[i],
      ph = phase[i];
    const amp = (0.45 + 1.1 * sizeOf(i)) * smoothstep(1, 6, sa);
    const off = (Math.sin(sa * 0.27 + ph) + 0.55 * Math.sin(sa * 0.113 + ph * 1.7)) * amp;
    nx[i] = px[i] - tz * off;
    nz[i] = pz[i] + tx * off;
  }
  for (const i of riv) {
    px[i] = nx[i];
    pz[i] = nz[i];
  }
  relax(1);

  // ---- carve channels and valleys along the segments (min of all profiles)
  const target = new Float32Array(N).fill(1e9);
  for (const i of riv) {
    const d = down[i];
    if (d < 0) continue;
    const ax = px[i],
      az = pz[i];
    const bx = keep[d] ? px[d] : (d % W) + 0.5,
      bz = keep[d] ? pz[d] : ((d / W) | 0) + 0.5;
    const size = sizeOf(i);
    // width follows the flow and breathes gently along the river
    const breathe = 0.5 + 0.5 * Math.sin(sAlong[i] * 0.17 + phase[i] * 3.1) * Math.sin(sAlong[i] * 0.071 + phase[i]);
    const w = (0.14 + 0.78 * size) * (0.75 + 0.5 * breathe);
    const bed = -(0.30 + 0.45 * size);
    const R = w + 15;
    const vx = bx - ax,
      vz = bz - az;
    const L2 = vx * vx + vz * vz;
    const x0 = Math.max(1, Math.floor(Math.min(ax, bx) - R)),
      x1 = Math.min(W - 2, Math.ceil(Math.max(ax, bx) + R));
    const y0 = Math.max(1, Math.floor(Math.min(az, bz) - R)),
      y1 = Math.min(H - 2, Math.ceil(Math.max(az, bz) + R));
    for (let yy = y0; yy <= y1; yy++)
      for (let xx = x0; xx <= x1; xx++) {
        const qx = xx + 0.5 - ax,
          qz = yy + 0.5 - az;
        const tt = L2 > 1e-6 ? Math.max(0, Math.min(1, (qx * vx + qz * vz) / L2)) : 0;
        const ex = qx - vx * tt,
          ez = qz - vz * tt;
        const d2 = ex * ex + ez * ez;
        if (d2 > R * R) continue;
        const e = Math.max(0, Math.sqrt(d2) - w);
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

// Replace connected land patches of `t` smaller than minSize tiles (4-connected).
function dissolveSmallPatches(type, hgt, W, H, t, minSize, replacement) {
  const N = W * H;
  const seen = new Uint8Array(N);
  const stack = new Int32Array(N);
  const comp = new Int32Array(N);
  for (let s0 = 0; s0 < N; s0++) {
    if (seen[s0] || type[s0] !== t || hgt[s0] < SEA_LEVEL) continue;
    let sp = 0,
      cn = 0;
    stack[sp++] = s0;
    seen[s0] = 1;
    while (sp) {
      const i = stack[--sp];
      comp[cn++] = i;
      const x = i % W,
        y = (i / W) | 0;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (let q = 0; q < 4; q++) {
        const j = nb[q];
        if (j >= 0 && !seen[j] && type[j] === t && hgt[j] >= SEA_LEVEL) {
          seen[j] = 1;
          stack[sp++] = j;
        }
      }
    }
    if (cn < minSize) for (let k = 0; k < cn; k++) type[comp[k]] = replacement(comp[k]);
  }
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

// Shared stages lent to the World Map generator (src/world/earth.js), so the
// real-Earth preset gets the same terracing, typing and flora as every map.
const EARTH_HELPERS = { distanceField, blurHeights, terraceMountains, slopeOf, despeckleTypes, dissolveSmallPatches, placeFlora, biomeFor, removeSpecks };
