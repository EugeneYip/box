import { createNoise2D } from 'simplex-noise';
import { mulberry32, hash2 } from '../core/Random.js';
import { TILE, SEA_LEVEL, MIN_HEIGHT } from './constants.js';
import { EARTH_MASK } from './data/earthMask.js';
import { RANGES, PLATEAUS, BASINS, SHELVES, MOISTURE, WARMTH, WETLANDS, RIVERS, LAKES } from './data/earthFeatures.js';

// World Map preset ('earth'): the real Earth on a 2:1 plate carree world,
// centred on the Pacific (central meridian 150°E, so the Atlantic splits at
// the left and right edges). Called from generateWorld() in worldgen.js,
// which lends its shared stages (terracing, despeckling, flora) as `H_`.
//
// Pipeline
//  1. Land: the Natural Earth land mask (data/earthMask.js, built by
//     tools/earth-mask.mjs) box-filtered to the tile grid; isolated islets
//     that cover a fair part of a tile are kept as one-tile islands.
//  2. Relief, all hand-authored in data/earthFeatures.js on top of coastal
//     plains and rolling hills: plateaus (flat tables), basins (lowered
//     plains), ridged mountain ranges and volcano cones, and the Greenland
//     and Antarctic ice domes. Seas get shelves, deep basins and shallow
//     continental seas.
//  3. Lakes (polygons and rift-lake centrelines) with lowered shores, then
//     rivers carved from the mountain front to the sea along smoothed,
//     meandering centrelines.
//  4. Climate: latitude temperature with regional anomalies and an altitude
//     lapse; moisture from latitude belts, distance from the sea and
//     hand-drawn desert / rainforest regions. Biomes by climate rules, snow
//     lines by latitude, sea ice at the poles.
//  5. Flora (shared with every preset).
// The geography is fixed; the seed only varies the small-scale noise.
//
// Geometry: tile (x, y) centre is lon = 150 - 180 + (x + 0.5) * 360 / W,
// lat = 90 - (y + 0.5) * 180 / H. world.meta describes it for other systems.
export const EARTH_LON0 = 150;
const LEFT = EARTH_LON0 - 180;
// Relief scale: real proportions at ~50 km per tile turn ranges into cliffs,
// so authored heights are lowered and ranges widened a little; the snow line
// and the altitude lapse rate are scaled to match.
const RELIEF = 0.68, // plateaus and high basins
  RANGE_RELIEF = 0.95, // mountain crests stand clearly above the plateaus
  RANGE_WIDEN = 1.45;

let _mask = null;
function decodeMask() {
  if (_mask) return _mask;
  const { w, h, rle } = EARTH_MASK;
  const bin = atob(rle);
  const data = new Uint8Array(w * h);
  let p = 0,
    cur = 0;
  for (let i = 0; i < bin.length; ) {
    let n = 0,
      shift = 0,
      b;
    do {
      b = bin.charCodeAt(i++);
      n |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    if (cur) data.fill(1, p, p + n);
    p += n;
    cur ^= 1;
  }
  _mask = { w, h, data };
  return _mask;
}

// Box-filtered land coverage (0..1) of each tile.
function landCoverage(W, H) {
  const M = decodeMask();
  const MW = M.w,
    MH = M.h;
  const fx = MW / W,
    fy = MH / H;
  // horizontal pass: each mask row -> W column coverages
  const rows = new Float32Array(MH * W);
  for (let my = 0; my < MH; my++) {
    const o = my * MW;
    for (let x = 0; x < W; x++) {
      const a = x * fx,
        b = a + fx;
      let s = 0;
      for (let mx = Math.floor(a); mx < b; mx++) {
        const wgt = Math.min(b, mx + 1) - Math.max(a, mx);
        if (wgt > 0 && M.data[o + (mx % MW)]) s += wgt;
      }
      rows[my * W + x] = s / fx;
    }
  }
  const cov = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const a = y * fy,
      b = a + fy;
    for (let my = Math.floor(a); my < b && my < MH; my++) {
      const wgt = (Math.min(b, my + 1) - Math.max(a, my)) / fy;
      if (wgt <= 0) continue;
      const ro = my * W,
        co = y * W;
      for (let x = 0; x < W; x++) cov[co + x] += rows[ro + x] * wgt;
    }
  }
  return cov;
}

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function smax(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}
function wrap180(d) {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}
function table(t, x) {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++)
    if (x <= t[i][0]) {
      const [x0, y0] = t[i - 1],
        [x1, y1] = t[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  return t[t.length - 1][1];
}

// Mean temperature (0 cold .. 1 hot) by absolute latitude, before anomalies
// and altitude. Tuned to the shared biome thresholds: tree line near 67°N,
// taiga below ~0.34, hot climates above ~0.64.
const TEMP_LAT = [[0, 0.95], [10, 0.93], [20, 0.86], [25, 0.8], [30, 0.72], [35, 0.64], [40, 0.57], [45, 0.5], [50, 0.43], [55, 0.37], [60, 0.31], [65, 0.245], [70, 0.18], [75, 0.12], [80, 0.07], [90, 0]];
// Annual moisture by distance from the thermal equator (about 4°N): the wet
// tropics, the dry subtropical belt, the wet westerlies, the dry poles.
const MOIST_LAT = [[0, 0.8], [4, 0.72], [8, 0.56], [12, 0.43], [18, 0.29], [24, 0.21], [30, 0.3], [36, 0.45], [44, 0.55], [52, 0.6], [62, 0.55], [72, 0.42], [90, 0.3]];

export function generateEarth(world, seed = 1, options = {}, H_) {
  const W = world.w,
    H = world.h,
    N = W * H;
  world.seed = seed;
  const _times = options.profile ? {} : null;
  let _tl = performance.now();
  const _t = (k) => {
    if (!_times) return;
    const n = performance.now();
    _times[k] = n - _tl;
    _tl = n;
  };
  const mk = (k) => createNoise2D(mulberry32((seed * 7919 + k * 104729) >>> 0));
  const nHills = mk(1),
    nRidge = mk(2),
    nWarp = mk(3),
    nRough = mk(4),
    nMoist = mk(5),
    nBorder = mk(6),
    nMeander = mk(7),
    nDetail = mk(8),
    nBank = mk(9);
  const fbm = (noise, x, y, oct, gain = 0.5) => {
    let a = 1,
      f = 1,
      s = 0,
      n = 0;
    for (let o = 0; o < oct; o++) {
      s += a * noise(x * f, y * f);
      n += a;
      a *= gain;
      f *= 2.03;
    }
    return s / n;
  };
  const ridged = (noise, x, y) => {
    const r = 1 - Math.abs(noise(x, y));
    return r * r;
  };

  // ---- geometry: tiles per degree, per-row latitude, per-column longitude
  const tpd = W / 360;
  const scale768 = W / 768; // feature sizes are authored in tiles of a 768-wide map
  const latY = new Float32Array(H),
    cosY = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    latY[y] = 90 - ((y + 0.5) * 180) / H;
    cosY[y] = Math.max(0.035, Math.cos((latY[y] * Math.PI) / 180));
  }
  const lonX = new Float32Array(W);
  for (let x = 0; x < W; x++) lonX[x] = wrap180(LEFT + ((x + 0.5) * 360) / W);
  // fractional tile coordinates of a lon/lat (x unwrapped relative to refX)
  const toX = (lon, refX = null) => {
    let x = (((lon - LEFT) % 360) + 360) % 360 * tpd - 0.5;
    if (refX != null) {
      while (x - refX > W / 2) x -= W;
      while (refX - x > W / 2) x += W;
    }
    return x;
  };
  const toY = (lat) => ((90 - lat) * H) / 180 - 0.5;

  // ---- feature stamping: nearest-segment distance (degrees of arc) for every
  // tile within reach of a polyline, with interpolated h / w and the distance
  // along the line. visit(i, d, h, w, s) runs once per touched tile.
  const bestT = new Float32Array(N).fill(1e9);
  const bestD = new Float32Array(N),
    bestH = new Float32Array(N),
    bestW = new Float32Array(N),
    bestS = new Float32Array(N);
  const touched = new Int32Array(N);
  const stamp = (f, reachK, extra, visit) => {
    const pts = f.pts;
    const P = pts.map((p) => [p[0], p[1], p[2] ?? f.h ?? 0, p[3] ?? f.w ?? 1]);
    for (let k = 1; k < P.length; k++) P[k][0] = P[k - 1][0] + wrap180(P[k][0] - P[k - 1][0]);
    let nt = 0;
    let sAcc = 0;
    const segs = P.length === 1 ? [[P[0], P[0]]] : P.slice(1).map((b, k) => [P[k], b]);
    for (const [A, B] of segs) {
      const reach = Math.max(A[3], B[3]) * reachK + extra;
      const latMin = Math.min(A[1], B[1]) - reach,
        latMax = Math.max(A[1], B[1]) + reach;
      const y0 = Math.max(0, Math.floor(toY(latMax))),
        y1 = Math.min(H - 1, Math.ceil(toY(latMin)));
      const segLenRaw = Math.hypot((B[0] - A[0]) * Math.cos((((A[1] + B[1]) / 2) * Math.PI) / 180), B[1] - A[1]);
      for (let y = y0; y <= y1; y++) {
        const lat = latY[y],
          c = cosY[y];
        const lonR = Math.min(180, reach / c);
        const ax = toX(Math.min(A[0], B[0]) - lonR);
        const span = (Math.abs(B[0] - A[0]) + 2 * lonR) * tpd;
        const xa = Math.floor(ax),
          xb = Math.min(xa + W - 1, Math.ceil(ax + span));
        const vx = (B[0] - A[0]) * c,
          vy = B[1] - A[1];
        const L2 = vx * vx + vy * vy;
        for (let xi = xa; xi <= xb; xi++) {
          const x = ((xi % W) + W) % W;
          const i = y * W + x;
          const px = wrap180(lonX[x] - A[0]) * c,
            py = lat - A[1];
          const tt = L2 > 1e-9 ? Math.max(0, Math.min(1, (px * vx + py * vy) / L2)) : 0;
          const ex = px - vx * tt,
            ey = py - vy * tt;
          const d = Math.sqrt(ex * ex + ey * ey);
          const w = A[3] + (B[3] - A[3]) * tt;
          const t = d / Math.max(1e-3, w * reachK + extra);
          if (t >= 1) continue;
          if (t < bestT[i]) {
            if (bestT[i] >= 1e8) touched[nt++] = i;
            bestT[i] = t;
            bestD[i] = d;
            bestH[i] = A[2] + (B[2] - A[2]) * tt;
            bestW[i] = w;
            bestS[i] = sAcc + tt * segLenRaw;
          }
        }
      }
      sAcc += segLenRaw;
    }
    for (let k = 0; k < nt; k++) {
      const i = touched[k];
      visit(i, bestD[i], bestH[i], bestW[i], bestS[i]);
      bestT[i] = 1e9;
    }
  };
  // map-space noise coordinates (degrees across the map)
  const U = (i) => (i % W) / tpd;
  const V = (i) => ((i / W) | 0) / tpd;
  const falloff = (d, w, edge, i, wob = 0.45) => {
    const dn = d + nWarp(U(i) * 0.4 + 17, V(i) * 0.4 - 5) * edge * wob;
    return dn <= w ? 1 : 1 - smoothstep(0, 1, (dn - w) / Math.max(1e-3, edge));
  };

  _t('setup');
  // ------------------------------------------------------------------ 1. land
  const cov = landCoverage(W, H);
  const land = new Uint8Array(N);
  for (let i = 0; i < N; i++) land[i] = cov[i] >= 0.5 ? 1 : 0;
  // keep small islands: an isolated local maximum of coverage becomes land
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (land[i] || cov[i] < 0.16) continue;
      let max = true,
        nearLand = false;
      for (let dy = -1; dy <= 1 && max; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const j = i + dy * W + dx;
          if (cov[j] > cov[i]) max = false;
          if (land[j]) nearLand = true;
        }
      if (max && !nearLand) land[i] = 1;
    }
  // Antarctica's far side: on a plate carree the pole is the whole bottom
  // edge, so the ice sheet is given a ragged southern coast (bays and capes
  // around 82-88°S) with open sea between it and the border, instead of a
  // white slab cut straight by the map edge.
  const southCut = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const u = x / tpd;
    const cut = -85.4 + fbm(nWarp, u / 16 + 50, 3.7, 3) * 2.6 + nWarp(u / 3.5 - 20, 8.1) * 0.8;
    southCut[x] = cut;
    for (let y = H - 1; y >= 0 && latY[y] < cut; y--) land[y * W + x] = 0;
  }
  // clean borders: a thin ring of open sea all round. The shaders and the
  // terrain skirt clamp edge tiles outward, so polar ice or Antarctica's snow
  // on the edge would continue as white bands beyond the map. (This splits
  // Greenland's east coast at the Atlantic seam and gives Antarctica a far
  // coast just inside the bottom edge.)
  const ringX = Math.max(2, Math.round(5 * scale768)), // wide enough that the shore field clamped past the side edges reads as open sea
    ringY = Math.max(2, Math.round(3 * scale768));
  const edgeDist = (x, y) => Math.min(x, W - 1 - x, y, H - 1 - y); // tiles to the border
  const inRing = (x, y) => x < ringX || x >= W - ringX || y < ringY || y >= H - ringY;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (x < ringX || x >= W - ringX || y < ringY || y >= H - ringY) land[y * W + x] = 0;
  _t('land');

  // ------------------------------------------------------------- 2. distances
  const dLand = H_.distanceField(land, W, H, 1); // land tiles: tiles to the sea
  const dSea = H_.distanceField(land, W, H, 0); // sea tiles: tiles to land
  // open sea vs. enclosed water: connected water bodies larger than a small
  // sea (the Caspian and the Black Sea count as seas) or touching the edge
  const sea = new Uint8Array(N);
  {
    const seen = new Uint8Array(N);
    const stack = new Int32Array(N);
    const comp = new Int32Array(N);
    const minSea = Math.round(110 * scale768 * scale768);
    for (let s0 = 0; s0 < N; s0++) {
      if (land[s0] || seen[s0]) continue;
      let sp = 0,
        cn = 0,
        edge = false;
      stack[sp++] = s0;
      seen[s0] = 1;
      while (sp) {
        const i = stack[--sp];
        comp[cn++] = i;
        const x = i % W,
          y = (i / W) | 0;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
        if (x > 0 && !land[i - 1] && !seen[i - 1]) (seen[i - 1] = 1), (stack[sp++] = i - 1);
        if (x < W - 1 && !land[i + 1] && !seen[i + 1]) (seen[i + 1] = 1), (stack[sp++] = i + 1);
        if (y > 0 && !land[i - W] && !seen[i - W]) (seen[i - W] = 1), (stack[sp++] = i - W);
        if (y < H - 1 && !land[i + W] && !seen[i + W]) (seen[i + W] = 1), (stack[sp++] = i + W);
      }
      if (edge || cn >= minSea) for (let k = 0; k < cn; k++) sea[comp[k]] = 1;
    }
  }
  _t('dist');

  // ------------------------------------------------------------- 3. relief
  const hgt = world.height;
  const rangeMask = new Float32Array(N);
  // land: coastal plains rising inland, rolling hills
  for (let i = 0; i < N; i++) {
    if (!land[i]) continue;
    const dT = dLand[i] / scale768; // tiles of a 768 map
    const u = U(i),
      v = V(i);
    let e = 0.26 + 1.45 * (1 - Math.exp(-dT / 7));
    const hn = fbm(nHills, u / 5.5, v / 5.5, 4);
    e += Math.pow(Math.max(0, hn * 0.5 + 0.5), 2.0) * 1.7 * smoothstep(0.5, 6, dT);
    hgt[i] = e;
  }
  // plateaus: flat tables with softly wobbling edges and gentle roughness
  const plat = new Float32Array(N);
  const platK = new Float32Array(N);
  for (const f of PLATEAUS) {
    const edge = f.edge ?? 1.5;
    stamp(f, 1, edge * 1.5, (i, d, h, w) => {
      if (!land[i]) return;
      const k = falloff(d, w, edge, i);
      if (k <= 0) return;
      const r = fbm(nRough, U(i) / 1.6, V(i) / 1.6, 3);
      const val = h * RELIEF * k + r * (0.25 + h * 0.03) * k;
      if (val > plat[i]) plat[i] = val;
      if (k > platK[i]) platK[i] = k;
    });
  }
  for (let i = 0; i < N; i++) if (land[i] && plat[i] > 0) hgt[i] = smax(hgt[i], plat[i], 0.8);
  // basins: the ground sinks toward the basin floor
  for (const f of BASINS) {
    const edge = f.edge ?? 2;
    stamp(f, 1, edge * 1.5, (i, d, h, w) => {
      if (!land[i]) return;
      const k = falloff(d, w, edge, i, 0.3);
      if (k <= 0) return;
      const ft = f.t > 2 ? f.t * RELIEF : f.t;
      const floor = ft + Math.max(0, fbm(nRough, U(i) / 2.2 + 9, V(i) / 2.2, 2)) * (0.25 + ft * 0.08);
      if (floor < hgt[i]) hgt[i] += (floor - hgt[i]) * k;
    });
  }
  // soften plains, plateau rims and basins (ranges are added unblurred so
  // their crests keep their height)
  H_.blurHeights(hgt, land, W, H, 1);
  // local land width: the deepest inland distance within a few tiles
  // (narrow islands and isthmuses score low, continents high)
  const landW = new Float32Array(N);
  {
    const r = Math.max(3, Math.round(6 * scale768));
    const tmp = new Float32Array(N);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let m = 0;
        for (let k = Math.max(0, x - r); k <= Math.min(W - 1, x + r); k++) m = Math.max(m, dLand[y * W + k]);
        tmp[y * W + x] = m;
      }
    for (let x = 0; x < W; x++)
      for (let y = 0; y < H; y++) {
        let m = 0;
        for (let k = Math.max(0, y - r); k <= Math.min(H - 1, y + r); k++) m = Math.max(m, tmp[k * W + x]);
        landW[y * W + x] = m;
      }
  }
  // mountain ranges: ridged crests, several summits along each range
  const rng = new Float32Array(N);
  // ranges keep at least ~2 tiles of half-width on any map size, so narrow
  // ones (Taiwan, the Cascades) are not single-tile spikes the blur flattens
  const minRangeW = 2.2 / tpd,
    minConeW = 1.8 / tpd;
  for (const f0 of RANGES) {
    const mw = f0.cone ? minConeW : minRangeW;
    const k = f0.cone ? 1 : RANGE_WIDEN;
    const f = { ...f0, w: Math.max((f0.w ?? 1) * k, mw), pts: f0.pts.map((p) => (p.length > 3 ? [p[0], p[1], p[2], Math.max(p[3] * k, mw)] : p)) };
    stamp(f, 1.25, 0, (i, d, h, w, sAl) => {
      if (!land[i]) return;
      const u = U(i),
        v = V(i);
      let t = d / w + (f.cone ? nWarp(u * 0.5 + 3, v * 0.5 + 7) * 0.08 : nWarp(u * 0.5 + 3, v * 0.5 + 7) * 0.2 + nWarp(u * 1.3 - 9, v * 1.3 + 2) * 0.1);
      if (t >= 1) return;
      t = Math.max(0, t);
      let bump, crest;
      if (f.cone) {
        bump = Math.pow(1 - t, 1.6);
        crest = 0.9 + 0.1 * ridged(nRidge, u * 2.5, v * 2.5);
      } else {
        // a peaked crest over long foothills; summits and saddles along the
        // range from two octaves of ridged noise (massifs ~3 tiles, peaks ~1.5)
        bump = Math.pow(1 - t, 1.9) * (1 + 0.9 * t);
        const r1 = ridged(nRidge, u * 0.7 + 13, v * 0.7),
          r2 = ridged(nRidge, u * 1.15 - 7, v * 1.15 + 3);
        crest = 0.68 + 0.55 * (0.6 * r1 + 0.4 * r2);
        // spurs and gullies running down the flanks, across the range: noise
        // in (distance along the range, distance from the crest) space
        const g = ridged(nWarp, sAl * 0.9 + (f0.pts[0][0] % 7), t * 0.7 + 4.3);
        crest *= 1 - smoothstep(0.18, 0.6, t) * (0.55 - 0.55 * g);
      }
      // ranges on narrow land (island arcs, coastal cordilleras) stay lower
      // near the sea, so islands keep green flanks instead of rock walls
      const coastK = f.cone ? 1 : 0.45 + 0.55 * smoothstep(1, 5 * scale768, landW[i]);
      const val = Math.min(19, h * (f.cone ? RELIEF : RANGE_RELIEF) * bump * crest * coastK);
      if (val > rng[i]) rng[i] = val;
      if (bump > rangeMask[i]) rangeMask[i] = bump;
    });
  }
  // smooth the range layer on its own (tile-to-tile spikes), then merge
  {
    const src = rng.slice();
    for (let pass = 0; pass < 2; pass++) {
      const a = pass ? rng.slice() : src;
      for (let y = 1; y < H - 1; y++)
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          if (!a[i] && !a[i - 1] && !a[i + 1] && !a[i - W] && !a[i + W]) continue;
          rng[i] = (a[i] * 4 + (a[i - 1] + a[i + 1] + a[i - W] + a[i + W]) * 2 + a[i - W - 1] + a[i - W + 1] + a[i + W - 1] + a[i + W + 1]) / 16;
        }
    }
  }
  for (let i = 0; i < N; i++) if (rng[i] > 0 && land[i]) hgt[i] = smax(hgt[i], rng[i], 1.0);
  // ice domes: Greenland and Antarctica rise from their coasts
  const GREENLAND = [[-73, 78], [-60, 82.5], [-30, 84], [-10, 82], [-17, 75], [-21, 70], [-32, 68], [-40, 64.5], [-43, 59.5], [-50, 61], [-54, 66], [-56, 71], [-66, 76]];
  const inPoly = (poly, lon, lat) => {
    let c = false;
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
      const [xa, ya] = poly[a],
        [xb, yb] = poly[b];
      if (ya > lat !== yb > lat && lon < ((xb - xa) * (lat - ya)) / (yb - ya) + xa) c = !c;
    }
    return c;
  };
  const icecap = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    const lat = latY[y];
    if (lat > -60 && lat < 59) continue;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!land[i]) continue;
      const dT = dLand[i] / scale768;
      let dome = 0;
      if (lat <= -60) dome = 1.3 + 9.8 * (1 - Math.exp(-dT / 7.5));
      else if (inPoly(GREENLAND, lonX[x], lat)) dome = 1.2 + 9.8 * (1 - Math.exp(-dT / 5));
      if (!dome) continue;
      icecap[i] = 1;
      // undulating ice: broad swells and ridged drainage divides, flattening
      // toward the coast where outlet glaciers run down to the sea
      const sw = fbm(nRough, U(i) / 3, V(i) / 3, 3);
      const rd = ridged(nRidge, U(i) / 2.2 + 31, V(i) / 2.2 - 17);
      dome += (sw * 0.9 + (rd - 0.45) * 1.1) * smoothstep(1, 7, dT);
      hgt[i] = smax(hgt[i], dome, 1.2);
    }
  }
  // seas: shelves near the coast, deep basins offshore, shallow seas
  for (let i = 0; i < N; i++) {
    if (land[i]) continue;
    const dT = dSea[i] / scale768;
    const u = U(i),
      v = V(i);
    const bank = fbm(nBank, u / 3, v / 3, 3);
    let depth = 0.24 + 1.35 * smoothstep(0, 2.2, dT) + 6.6 * smoothstep(1.6, 11, dT);
    depth += bank * 1.0 * smoothstep(1, 5, dT);
    hgt[i] = -Math.max(0.2, depth);
  }
  for (const f of SHELVES) {
    const edge = f.edge ?? 1.5;
    stamp(f, 1, edge * 1.5, (i, d, h, w) => {
      if (land[i]) return;
      const k = falloff(d, w, edge, i, 0.4);
      const target = -(f.d + Math.max(0, fbm(nBank, U(i) / 1.5, V(i) / 1.5, 2)) * 0.4);
      if (target > hgt[i]) hgt[i] += (target - hgt[i]) * k;
    });
  }
  for (let i = 0; i < N; i++) {
    if (land[i]) hgt[i] = Math.max(hgt[i], 0.24);
    else hgt[i] = Math.min(-0.2, Math.max(hgt[i], MIN_HEIGHT));
  }
  // terraced benches on the flanks and plateau rims; crests stay sharp
  const benchMask = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let m = rangeMask[i] * 0.45 * (1 - smoothstep(0.45, 0.8, rangeMask[i]));
    if (plat[i] > 4) m = Math.max(m, platK[i] * 0.6 * (1 - smoothstep(0.25, 0.6, rangeMask[i])));
    benchMask[i] = m;
  }
  H_.terraceMountains(hgt, benchMask, W, H);
  _t('relief');

  // ------------------------------------------------------------------ 4. lakes
  const lake = new Uint8Array(N);
  for (const L of LAKES) {
    if (L.poly) {
      // even-odd fill at tile centres (no lake crosses the map seam)
      const P = L.poly.map(([lon, lat]) => [toX(lon), toY(lat)]);
      for (let k = 1; k < P.length; k++) P[k][0] = toX(L.poly[k][0], P[0][0]);
      let ymin = Infinity,
        ymax = -Infinity;
      for (const p of P) (ymin = Math.min(ymin, p[1])), (ymax = Math.max(ymax, p[1]));
      for (let y = Math.max(0, Math.floor(ymin)); y <= Math.min(H - 1, Math.ceil(ymax)); y++) {
        const xs = [];
        for (let a = 0, b = P.length - 1; a < P.length; b = a++) {
          const [xa, ya] = P[a],
            [xb, yb] = P[b];
          if (ya > y !== yb > y) xs.push(xa + ((y - ya) * (xb - xa)) / (yb - ya));
        }
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2)
          for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) lake[y * W + (((x % W) + W) % W)] = 1;
      }
      // tiny lakes: at least the tile under the centroid
      const cx = Math.round(P.reduce((s, p) => s + p[0], 0) / P.length),
        cy = Math.round(P.reduce((s, p) => s + p[1], 0) / P.length);
      if (cy >= 0 && cy < H) lake[cy * W + (((cx % W) + W) % W)] = 1;
    } else {
      // centreline lakes: at least ~1.2 tiles wide on any map size
      const minW = 0.62 / tpd;
      stamp({ pts: L.pts, w: Math.max(L.w, minW) }, 1, 0, (i) => (lake[i] = 1));
    }
  }
  for (let i = 0; i < N; i++) if (lake[i] && !land[i]) lake[i] = 0;
  {
    const dIn = H_.distanceField(lake, W, H, 1); // lake tiles: distance to the shore
    const dOut = H_.distanceField(lake, W, H, 0); // land tiles: distance to a lake
    for (let i = 0; i < N; i++) {
      if (lake[i]) {
        hgt[i] = -(0.45 + 1.5 * smoothstep(0.5, 3.5 * Math.max(0.7, scale768), dIn[i]));
      } else if (land[i] && dOut[i] < 7) {
        // shores rise quickly: a lake only shapes the land a few tiles around it
        const d = dOut[i];
        const shore = 0.3 + d * 0.8 + d * d * 0.28;
        if (shore < hgt[i]) hgt[i] = shore;
      }
    }
  }
  _t('lakes');

  // ----------------------------------------------------------------- 5. rivers
  const riverMask = new Uint8Array(N);
  {
    const wScale = Math.sqrt(scale768);
    const target = new Float32Array(N).fill(1e9);
    const TRIM = 6.2;
    for (const R of RIVERS) {
      // authored points -> tile space -> Catmull-Rom, sampled ~2 per tile
      const P = [];
      for (const [lon, lat] of R.pts) P.push([toX(lon, P.length ? P[P.length - 1][0] : null), toY(lat)]);
      // carry the mouth a little past the coast
      const a = P[P.length - 2],
        b = P[P.length - 1];
      const ml = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      if (!R.trib) P.push([b[0] + ((b[0] - a[0]) / ml) * 2.5 * scale768, b[1] + ((b[1] - a[1]) / ml) * 2.5 * scale768]);
      const pts = [];
      for (let k = 0; k < P.length - 1; k++) {
        const p0 = P[Math.max(0, k - 1)],
          p1 = P[k],
          p2 = P[k + 1],
          p3 = P[Math.min(P.length - 1, k + 2)];
        const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * 2));
        for (let s = 0; s < n; s++) {
          const t = s / n,
            t2 = t * t,
            t3 = t2 * t;
          const f = (q) => 0.5 * (2 * p1[q] + (-p0[q] + p2[q]) * t + (2 * p0[q] - 5 * p1[q] + 4 * p2[q] - p3[q]) * t2 + (-p0[q] + 3 * p1[q] - 3 * p2[q] + p3[q]) * t3);
          pts.push([f(0), f(1)]);
        }
      }
      pts.push(P[P.length - 1].slice());
      // trim the upper course on high ground: rivers emerge from the mountain front
      const hAt = (p) => {
        const x = ((Math.round(p[0]) % W) + W) % W,
          y = Math.min(H - 1, Math.max(0, Math.round(p[1])));
        return hgt[y * W + x];
      };
      let start = 0;
      while (start < pts.length - 4 && hAt(pts[start]) > TRIM) start++;
      const C = pts.slice(start);
      if (C.length < 4) continue;
      // meander sideways (grows downstream), then carve
      const sAlong = [0];
      for (let k = 1; k < C.length; k++) sAlong.push(sAlong[k - 1] + Math.hypot(C[k][0] - C[k - 1][0], C[k][1] - C[k - 1][1]));
      const L = sAlong[sAlong.length - 1] || 1;
      const M = C.map((p, k) => {
        const q = C[Math.min(C.length - 1, k + 1)],
          o = C[Math.max(0, k - 1)];
        let tx = q[0] - o[0],
          ty = q[1] - o[1];
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        const s = sAlong[k];
        const amp = (0.35 + 0.55 * Math.min(1, s / L)) * Math.min(1, s / 3, (L - s) / 2 + 0.2) * Math.max(0.6, scale768);
        const off = nMeander(s * 0.11 / Math.max(0.6, scale768), seed * 0.01 + R.pts[0][0]) * amp;
        return [p[0] - ty * off, p[1] + tx * off];
      });
      for (let k = 0; k < M.length - 1; k++) {
        const [ax, az] = M[k],
          [bx, bz] = M[k + 1];
        const s = sAlong[k] / L;
        const w = Math.max(0.16, (0.2 + (R.w - 0.2) * Math.pow(s, 0.65)) * wScale);
        const size = Math.min(1, w / 1.1);
        const bed = -(0.32 + 0.45 * size);
        const Rr = w + 3.2;
        const vx = bx - ax,
          vz = bz - az;
        const L2 = vx * vx + vz * vz;
        const y0 = Math.max(1, Math.floor(Math.min(az, bz) - Rr)),
          y1 = Math.min(H - 2, Math.ceil(Math.max(az, bz) + Rr));
        const x0 = Math.floor(Math.min(ax, bx) - Rr),
          x1 = Math.ceil(Math.max(ax, bx) + Rr);
        for (let yy = y0; yy <= y1; yy++)
          for (let xi = x0; xi <= x1; xi++) {
            const xx = ((xi % W) + W) % W;
            const qx = xi - ax,
              qz = yy - az;
            const tt = L2 > 1e-6 ? Math.max(0, Math.min(1, (qx * vx + qz * vz) / L2)) : 0;
            const ex = qx - vx * tt,
              ez = qz - vz * tt;
            const d2 = ex * ex + ez * ez;
            if (d2 > Rr * Rr) continue;
            const e = Math.max(0, Math.sqrt(d2) - w);
            const ev = Math.max(0, e - 1.1);
            // narrow valleys with steep walls: a river only shapes the ground
            // a few tiles either side (tiles are ~50 km here)
            const t = bed + (0.42 - bed) * smoothstep(0, 1.1, e) + ev * 1.2 + ev * ev * 1.2;
            const j = yy * W + xx;
            if (t < target[j]) target[j] = t;
          }
      }
    }
    for (let i = 0; i < N; i++) {
      if (target[i] < hgt[i]) {
        if (target[i] < SEA_LEVEL && hgt[i] >= SEA_LEVEL) riverMask[i] = 1;
        hgt[i] = target[i];
      }
    }
  }
  _t('rivers');

  // the border ring is deep open sea: the water shader and the terrain skirt
  // extend the edge tiles' depth outward, so shallows there would show as a
  // pale band beyond the map
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!inRing(x, y)) continue;
      const i = y * W + x;
      const k = Math.min(1, edgeDist(x, y) / ringY); // 0 at the border
      hgt[i] = Math.min(hgt[i], -(6.2 - 2.4 * k) + fbm(nBank, x / tpd / 3, y / tpd / 3, 2) * 0.5);
    }
  // ----------------------------------------------------------------- 6. climate
  const wet = new Uint8Array(N);
  for (let i = 0; i < N; i++) wet[i] = hgt[i] < SEA_LEVEL ? 1 : 0;
  const dWater = H_.distanceField(wet, W, H, 0); // land: tiles to any water
  const dOcean = H_.distanceField(sea, W, H, 0); // land: tiles to the open sea
  const warm = new Float32Array(N);
  for (const f of WARMTH) {
    const edge = f.edge ?? 3;
    stamp(f, 1, edge * 1.5, (i, d, h, w) => {
      const k = falloff(d, w, edge, i, 0.3);
      if (Math.abs(f.dt * k) > Math.abs(warm[i])) warm[i] = f.dt * k;
    });
  }
  const baseT = new Float32Array(N); // latitude climate + anomalies (no altitude)
  const temp = world.temperature,
    moist = world.moisture;
  for (let y = 0; y < H; y++) {
    const lat = latY[y],
      alat = Math.abs(lat);
    const tl = table(TEMP_LAT, alat);
    const ml = table(MOIST_LAT, Math.abs(lat - 4));
    const contK = alat < 20 ? 0.5 : alat < 30 ? 0.5 + (alat - 20) * 0.05 : alat < 58 ? 1 : 0.7;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const u = U(i),
        v = V(i);
      let bt = tl + warm[i] + fbm(nMoist, u / 9 + 40, v / 9, 2) * 0.025;
      if (lat < -60) bt -= 0.2; // the Antarctic continent and its ice shelves
      if (icecap[i]) bt -= 0.08;
      baseT[i] = bt;
      const h = Math.max(0, hgt[i]);
      temp[i] = clamp01(bt - h * 0.05 - Math.max(0, h - 4.5) * 0.04);
      const dOc = dOcean[i] / tpd; // degrees on the map
      let m = ml - 0.26 * smoothstep(4, 22, dOc) * contK + 0.08 * Math.exp(-dOc / 2.5);
      m += fbm(nMoist, u / 6, v / 6, 3) * 0.07;
      moist[i] = m;
    }
  }
  for (const f of MOISTURE) {
    const edge = f.edge ?? 2;
    stamp(f, 1, edge * 1.5, (i, d, h, w) => {
      const k = falloff(d, w, edge, i, 0.5) * (f.k ?? 1);
      if (k > 0) moist[i] += (f.m - moist[i]) * k;
    });
  }
  // ...and never cold enough to freeze: the seasonal sea-ice shelf is drawn
  // from the (edge-clamped) temperature, so a frozen border would spread
  // ice beyond the map in winter
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (inRing(x, y)) temp[y * W + x] = Math.max(temp[y * W + x], 0.42);
  // rivers and lakes water their banks (green valleys through dry land)
  for (let i = 0; i < N; i++) {
    if (hgt[i] < SEA_LEVEL) continue;
    const dw = dWater[i] / Math.max(0.7, scale768);
    if (dOcean[i] > dWater[i] + 0.5) moist[i] += 0.38 * Math.exp(-dw / 1.3);
    moist[i] = clamp01(moist[i]);
  }
  const wetland = new Uint8Array(N);
  for (const f of WETLANDS) stamp(f, 1, 0, (i, d, h, w) => (falloff(d, w * 0.7, w * 0.3, i, 0.6) > 0.3 ? (wetland[i] = 1) : 0));
  _t('climate');

  // ----------------------------------------------------------------- biomes
  const type = world.type;
  const biome = (t, m) => {
    if (t < 0.12) return TILE.SNOW;
    if (t < 0.22) return m > 0.62 && t > 0.19 ? TILE.FOREST : TILE.TUNDRA;
    if (t < 0.355) return m >= 0.36 ? TILE.FOREST : m >= 0.24 && t > 0.29 ? TILE.GRASS : TILE.TUNDRA;
    if (t < 0.64) return m >= 0.55 ? TILE.FOREST : m >= 0.3 ? TILE.GRASS : m >= 0.15 ? TILE.SAVANNA : TILE.DESERT;
    if (m >= 0.7 && t >= 0.74) return TILE.JUNGLE;
    if (m >= 0.62) return TILE.FOREST;
    if (m >= 0.45) return TILE.GRASS;
    if (m >= 0.2) return TILE.SAVANNA;
    return TILE.DESERT;
  };
  const beachW = Math.max(1.05, 1.25 * scale768);
  const slopeK = Math.min(1, Math.sqrt(scale768)); // coarser tiles are steeper per tile
  for (let y = 0; y < H; y++) {
    const lat = latY[y];
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const h = hgt[i];
      const bn = nBorder(x * 0.11 / scale768, y * 0.11 / scale768);
      if (h < SEA_LEVEL) {
        const depth = -h;
        let ice = false;
        if (sea[i] && !riverMask[i]) {
          const ds = dSea[i] / scale768;
          // Arctic pack: a ragged band with open water before the border;
          // around Antarctica: ice shelves and fast ice hugging the coast
          const pk = nWarp(x / tpd / 9 + 70, 2.3) * 2.6 + nWarp(x / tpd / 2.6 - 40, 5.5) * 0.9;
          if (lat > 78.5 + pk + bn && lat < 86.6 + pk * 0.45 - bn * 0.6) ice = true;
          else if (lat > 70 && ds < 2.2 + bn) ice = true;
          else if (lat < -60 && ds < 2.4 + bn * 1.2 + Math.max(0, pk) * 0.9) ice = true;
          else if (lat > southCut[x] + 1.4) {
            // the Ross and Filchner-Ronne ice shelves (water in the land mask)
            const lo = lonX[x];
            if (((lo > 158 || lo < -146) && lat < -77.8 + bn) || (lo > -82 && lo < -28 && lat < -74.8 + bn)) ice = true;
          }
          // the pack ice stops short of the border (open water beyond it)
          if (Math.min(x, W - 1 - x) < ringX + 1 + bn || Math.min(y, H - 1 - y) < ringY + 2 + bn) ice = false;
        }
        if (ice) type[i] = TILE.ICE;
        else if (!sea[i]) type[i] = riverMask[i] || depth > 1.1 + bn * 0.5 ? TILE.SOIL : TILE.SAND;
        else type[i] = depth < 2.8 + bn * 1.2 ? TILE.SAND : TILE.ROCK;
        continue;
      }
      const t = temp[i],
        m = moist[i];
      const slope = H_.slopeOf(hgt, W, H, x, y) * slopeK;
      const snowLine = 5 + 7.2 * clamp01(baseT[i]) + bn * 1.0;
      const rockLine = snowLine - 2.5 + bn * 0.5;
      const dOcT = dOcean[i]; // tiles to the open sea
      let tt;
      if (icecap[i] || h > snowLine || t < 0.11 + bn * 0.02) tt = TILE.SNOW;
      else if ((h > rockLine && slope > 0.6 + bn * 0.2) || slope > 2.2 + bn * 0.4) tt = TILE.ROCK;
      else if (h > rockLine) tt = t > 0.17 ? TILE.TUNDRA : TILE.SNOW; // alpine meadow, high plateaus
      else if (dOcT <= beachW + bn * 0.6 && h < 0.9 + bn * 0.3 && slope < 0.7 && t > 0.3) tt = TILE.SAND;
      else if (dOcT <= 1.5 && slope >= 1.3 && h > 1.2) tt = TILE.ROCK; // sea cliffs
      else if (wetland[i] && h < 3.2 && t > 0.24 && m > 0.35) tt = TILE.SWAMP;
      else if (m > 0.86 && h < 1.2 && dWater[i] < 3 && t > 0.3) tt = TILE.SWAMP;
      else tt = biome(t + bn * 0.02 + (hash2(x, y, seed) - 0.5) * 0.01, m - bn * 0.04);
      type[i] = tt;
    }
  }
  H_.despeckleTypes(type, hgt, W, H);
  H_.dissolveSmallPatches(type, hgt, W, H, TILE.SNOW, 10, (i) => (icecap[i] ? TILE.SNOW : temp[i] < 0.3 ? TILE.TUNDRA : biome(temp[i], moist[i])));
  _t('biomes');

  // ------------------------------------------------------------------ flora
  H_.placeFlora(world, seed, nDetail);
  // the ice sheets stay bare (a few stones near the coast at most), and the
  // high plateaus above the tree line keep only stones and boulders
  for (let i = 0; i < N; i++) {
    const f = world.flora[i];
    if (!f) continue;
    const bare = icecap[i] ? dLand[i] > 2 || hash2(i % W, (i / W) | 0, seed + 5) > 0.15 : hgt[i] > 7 && type[i] === TILE.TUNDRA && f !== 12 && f !== 13;
    if (bare) {
      world.flora[i] = 0;
      world.floraGrowth[i] = 0;
    }
  }
  _t('flora');

  // budgetArea: the map area (tiles) whose population and building budgets
  // this world should get. Much of the World Map is ocean and ice, so it is
  // scaled from habitable land (typical presets are ~30% habitable land).
  let habitable = 0;
  for (let i = 0; i < N; i++) if (hgt[i] >= SEA_LEVEL && type[i] !== TILE.SNOW && type[i] !== TILE.ICE && type[i] !== TILE.ROCK) habitable++;
  world.meta = { preset: 'earth', lon0: EARTH_LON0, projection: 'plate-carree', spreadStarts: true, budgetArea: Math.round(habitable / 0.3) };
  world.owner.fill(-1);
  world.building.fill(-1);
  world.fire.fill(0);
  world.wetness.fill(0);
  world.markAllDirty();
  if (_times) options.profile(_times);
}

// Longitude / latitude (degrees) at a world position on the World Map.
export function earthLonLat(world, x, z) {
  const lon = wrap180(LEFT + (x / world.w) * 360);
  const lat = 90 - (z / world.h) * 180;
  return [lon, lat];
}
