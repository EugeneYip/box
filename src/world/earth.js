import { createNoise2D } from 'simplex-noise';
import { mulberry32, hash2 } from '../core/Random.js';
import { TILE, SEA_LEVEL, MIN_HEIGHT, FLORA_INFO } from './constants.js';
import { EARTH_MASK } from './data/earthMask.js';
import { RANGES, PLATEAUS, BASINS, SHELVES, MOISTURE, WARMTH, WETLANDS, RIVERS, LAKES, ISLAND_SPINES, COAST_PLAINS } from './data/earthFeatures.js';
import { earthRegion } from './data/regions.js';
import { REGION_SETS } from './data/regionFeatures.js';
import { REGION_MASK as MASK_GEA } from './data/mask-great-east-asia.js';
import { REGION_MASK as MASK_AM } from './data/mask-asia-mainland.js';
import { REGION_MASK as MASK_JP } from './data/mask-japan.js';
import { REGION_MASK as MASK_TW } from './data/mask-taiwan.js';
import { REGION_MASK as MASK_EU } from './data/mask-europe.js';
import { REGION_MASK as MASK_NA } from './data/mask-north-america.js';

const REGION_MASKS = { 'great-east-asia': MASK_GEA, 'asia-mainland': MASK_AM, japan: MASK_JP, taiwan: MASK_TW, europe: MASK_EU, 'north-america': MASK_NA };
// Authored heights are game units of about 2.7 per real kilometre on every map
// (the whole Earth's 22-unit Everest). Regional maps keep that scale, a
// little taller where the zoom is finest so Taiwan's and Japan's ranges still
// stand up as mountains; climate reads heights divided by this factor.
const REGION_VK = { taiwan: 1.6, japan: 1.25 };
const KM_UNITS = 2.7;

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

// Run-length decoding of a mask layer (alternating runs, 0 first, LEB128).
function decodeRLE(rle, n) {
  const bin = atob(rle);
  const data = new Uint8Array(n);
  let p = 0,
    cur = 0;
  for (let i = 0; i < bin.length; ) {
    let k = 0,
      shift = 0,
      b;
    do {
      b = bin.charCodeAt(i++);
      k |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    if (cur) data.fill(1, p, p + k);
    p += k;
    cur ^= 1;
  }
  return data;
}
let _mask = null;
function decodeMask() {
  if (_mask) return _mask;
  const { w, h, rle } = EARTH_MASK;
  _mask = { w, h, data: decodeRLE(rle, w * h) };
  return _mask;
}
const _regionMasks = {};
function decodeRegionMask(id) {
  if (_regionMasks[id]) return _regionMasks[id];
  const M = REGION_MASKS[id];
  return (_regionMasks[id] = { w: M.w, h: M.h, land: decodeRLE(M.land, M.w * M.h), lakes: decodeRLE(M.lakes, M.w * M.h) });
}

// Box-filtered land coverage (0..1) of each tile (the whole-Earth mask, or a
// regional mask layer at a whole multiple of the tile grid).
function landCoverage(W, H, M = decodeMask(), layer = M.data) {
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
        if (wgt > 0 && layer[o + (mx % MW)]) s += wgt;
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

  // ---- the window on the globe: the whole Earth (2:1, wrapping east-west)
  // or a regional map (docs/REGIONS.md) with square tiles at its middle latitude
  const REG = options.region && options.region !== 'world' && REGION_MASKS[options.region] ? earthRegion(options.region) : null;
  if (REG && (REG.w !== W || REG.h !== H)) throw new Error(`World Map region ${REG.id} needs a ${REG.w} x ${REG.h} world, got ${W} x ${H}`);
  const GEO = REG ? { region: REG.id, lonMin: REG.lonMin, lonMax: REG.lonMax, latMin: REG.latMin, latMax: REG.latMax, wrap: false } : { region: 'world', lonMin: LEFT, lonMax: LEFT + 360, latMin: -90, latMax: 90, wrap: true };
  const VK = REG ? REGION_VK[REG.id] || 1 : 1; // height scale (climate reads h / VK)
  // ---- geometry: tiles per degree, per-row latitude, per-column longitude
  const tpdX = W / (GEO.lonMax - GEO.lonMin),
    tpdY = H / (GEO.latMax - GEO.latMin);
  const tpd = REG ? tpdY : W / 360; // tiles per degree of latitude (and of longitude on the whole Earth)
  const kmTile = REG ? 111.2 / tpdY : 40075 / W; // tile size in km (at the equator on the whole Earth)
  // Feature sizes are authored in tiles of a 768-wide whole-Earth map. On a
  // regional map every tile-based texture (noise, beaches, banks, ...) keeps
  // the scale it has on that map, while geography stays in lon/lat.
  const scale768 = REG ? 1 : W / 768;
  const NT = REG ? 768 / 360 : tpd; // tiles per noise unit
  const latY = new Float32Array(H),
    cosY = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    latY[y] = GEO.latMax - (y + 0.5) / tpdY;
    cosY[y] = Math.max(0.035, Math.cos((latY[y] * Math.PI) / 180));
  }
  const lonX = new Float32Array(W);
  for (let x = 0; x < W; x++) lonX[x] = REG ? GEO.lonMin + (x + 0.5) / tpdX : wrap180(LEFT + ((x + 0.5) * 360) / W);
  // fractional tile coordinates of a lon/lat (x unwrapped relative to refX)
  const toX = REG
    ? (lon) => (lon - GEO.lonMin) * tpdX - 0.5
    : (lon, refX = null) => {
        let x = ((((lon - LEFT) % 360) + 360) % 360) * tpd - 0.5;
        if (refX != null) {
          while (x - refX > W / 2) x -= W;
          while (refX - x > W / 2) x += W;
        }
        return x;
      };
  const toY = (lat) => (GEO.latMax - lat) * tpdY - 0.5;
  // features that apply to this map: whole-Earth data, plus the regional
  // detail sets for this zoom (which may replace the whole-Earth ranges)
  const SETS = REG ? REGION_SETS.filter((s) => kmTile <= s.maxKm && s.box[2] >= GEO.lonMin && s.box[0] <= GEO.lonMax && s.box[3] >= GEO.latMin && s.box[1] <= GEO.latMax) : [];
  const inBox = (b, p) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
  // (km heights become game units at the set's scale: `ku` units per km)
  // (and a set's `widen` broadens its ranges, not its volcano cones)
  const kmPts = (f, ku, wk = 1) => {
    const k = f.cone ? 1 : wk;
    return { ...f, h: (f.km ?? 0) * ku, w: f.w != null ? f.w * k : f.w, pts: f.pts.map((p) => (p.length > 2 ? [p[0], p[1], p[2] * ku, ...(p.length > 3 ? [p[3] * k] : [])] : p)) };
  };
  const fromSets = (key, km = false) => SETS.flatMap((s) => (s[key] || []).map((f) => (km ? kmPts(f, s.ku ?? KM_UNITS, s.widen ?? 1) : f)));
  const keepWorld = (f) => !SETS.some((s) => s.skipWorld && inBox(s.box, f.pts[0]));
  const F_RANGES = [...(REG ? RANGES.filter(keepWorld) : RANGES), ...fromSets('ranges', true)];
  const F_PLATEAUS = [...(REG ? PLATEAUS.filter(keepWorld) : PLATEAUS), ...fromSets('plateaus', true)];
  const F_BASINS = [...BASINS, ...fromSets('basins')];
  const F_SHELVES = [...SHELVES, ...fromSets('shelves')];
  const F_MOISTURE = [...MOISTURE, ...fromSets('moisture')];
  const F_RIVERS = [...(REG ? RIVERS.filter((f) => !SETS.some((s) => s.skipWorld && inBox(s.box, f.pts[f.pts.length - 1]))) : RIVERS), ...fromSets('rivers')];

  // ---- feature stamping: nearest-segment distance (degrees of arc) for every
  // tile within reach of a polyline, with interpolated h / w, the distance
  // along the line and the side of it (+1 / -1). visit(i, d, h, w, s, side)
  // runs once per touched tile.
  const bestT = new Float32Array(N).fill(1e9);
  const bestD = new Float32Array(N),
    bestH = new Float32Array(N),
    bestW = new Float32Array(N),
    bestS = new Float32Array(N),
    bestSg = new Int8Array(N);
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
        const span = (Math.abs(B[0] - A[0]) + 2 * lonR) * tpdX;
        let xa = Math.floor(ax),
          xb = Math.min(xa + W - 1, Math.ceil(ax + span));
        if (REG) {
          // no wrap: clip to the map
          xa = Math.max(0, xa);
          xb = Math.min(W - 1, xb);
        }
        const vx = (B[0] - A[0]) * c,
          vy = B[1] - A[1];
        const L2 = vx * vx + vy * vy;
        for (let xi = xa; xi <= xb; xi++) {
          const x = REG ? xi : ((xi % W) + W) % W;
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
            bestSg[i] = vx * ey - vy * ex >= 0 ? 1 : -1;
          }
        }
      }
      sAcc += segLenRaw;
    }
    for (let k = 0; k < nt; k++) {
      const i = touched[k];
      visit(i, bestD[i], bestH[i], bestW[i], bestS[i], bestSg[i]);
      bestT[i] = 1e9;
    }
  };
  // map-space noise coordinates (degrees across the whole-Earth map; on a
  // regional map, the same tile scale as the Huge whole-Earth map)
  const U = (i) => (i % W) / NT;
  const V = (i) => ((i / W) | 0) / NT;
  // degrees across the map (edge wobble of features authored in degrees)
  const Ud = (i) => (i % W) / tpdX;
  const Vd = (i) => ((i / W) | 0) / tpdY;
  const falloff = (d, w, edge, i, wob = 0.45) => {
    const dn = d + nWarp(Ud(i) * 0.4 + 17, Vd(i) * 0.4 - 5) * edge * wob;
    return dn <= w ? 1 : 1 - smoothstep(0, 1, (dn - w) / Math.max(1e-3, edge));
  };

  _t('setup');
  // ------------------------------------------------------------------ 1. land
  let cov, lakeCov = null;
  if (REG) {
    // regional masks: Natural Earth 1:10m land and the larger lakes, at 2x
    const M = decodeRegionMask(REG.id);
    cov = landCoverage(W, H, M, M.land);
    lakeCov = landCoverage(W, H, M, M.lakes);
    for (let i = 0; i < N; i++) cov[i] += lakeCov[i];
  } else cov = landCoverage(W, H);
  const land = new Uint8Array(N);
  for (let i = 0; i < N; i++) land[i] = cov[i] >= 0.5 ? 1 : 0;
  // key named islands keep a minimum width (at least ~2 tiles across)
  for (const f of REG ? [] : ISLAND_SPINES) {
    const minW = 0.95 / tpd;
    const g = { ...f, w: Math.max(f.w, minW) };
    stamp(g, 1, 0, (i, d, h, w) => {
      if (d <= w || cov[i] >= 0.3) land[i] = 1;
    });
  }
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
  // around 81-86°S) with open sea between it and the border, instead of a
  // white slab cut straight by the map edge.
  const southCut = new Float32Array(W).fill(-1e9);
  for (let x = 0; x < W && !REG; x++) {
    const u = x / tpd;
    const cut = -83.2 + fbm(nWarp, u / 16 + 50, 3.7, 3) * 2.4 + nWarp(u / 3.5 - 20, 8.1) * 0.8;
    southCut[x] = cut;
    for (let y = H - 1; y >= 0 && latY[y] < cut; y--) land[y * W + x] = 0;
  }
  // natural ends at the Atlantic seam (the left / right edges): Antarctica's
  // coast curves back south to nothing near both edges, and Greenland is cut
  // back to a ragged coast well inside the right edge (its far east coast
  // would otherwise be sliced straight by the border on both sides)
  const ringX0 = Math.max(2, Math.round(5 * scale768));
  const sideK = new Float32Array(W).fill(1); // 0 at the side borders .. 1 inland
  if (!REG) for (let x = 0; x < W; x++) sideK[x] = smoothstep(ringX0 + 1, ringX0 + 34 * scale768, Math.min(x, W - 1 - x));
  for (let x = 0; x < W && !REG; x++) {
    const u = x / tpd;
    const ek = sideK[x];
    if (ek < 1) {
      const capN = -84.5 + 24 * Math.sqrt(ek) + nWarp(u / 2.2 + 3, 41.7) * 1.6 * ek;
      for (let y = H - 1; y >= 0 && latY[y] < -58; y--) if (latY[y] > capN) land[y * W + x] = 0;
    }
  }
  for (let y = 0; y < H && !REG; y++) {
    const lat = latY[y];
    if (lat < 66.9 || lat > 86) continue;
    const cutLon = -36 - 7 * smoothstep(70, 82, lat) + nWarp(lat / 1.7 + 9, 2.9) * 2.4;
    for (let x = 0; x < W; x++) {
      const lo = lonX[x];
      if (lo > cutLon && lo < -8) land[y * W + x] = 0;
    }
  }
  // clean borders: a thin ring of open sea all round. The shaders and the
  // terrain skirt clamp edge tiles outward, so polar ice or Antarctica's snow
  // on the edge would continue as white bands beyond the map. (This splits
  // Greenland's east coast at the Atlantic seam and gives Antarctica a far
  // coast just inside the bottom edge.)
  const ringX = REG ? 4 : Math.max(2, Math.round(5 * scale768)), // wide enough that the shore field clamped past the side edges reads as open sea
    ringY = REG ? 4 : Math.max(2, Math.round(3 * scale768));
  const edgeDist = (x, y) => Math.min(x, W - 1 - x, y, H - 1 - y); // tiles to the border
  const inRing = (x, y) => x < ringX || x >= W - ringX || y < ringY || y >= H - ringY;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (x < ringX || x >= W - ringX || y < ringY || y >= H - ringY) land[y * W + x] = 0;
  // regional maps: land that runs off the window ends in a ragged natural
  // coast a few tiles inside the border (bays and capes), not a straight cut
  const edgeCut = new Float32Array(REG ? N : 0); // 0 at the cut coast .. 1 inland (regional maps)
  if (REG) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const e = edgeDist(x, y);
        if (e > 64) {
          edgeCut[i] = 1;
          continue;
        }
        // 6-22 tiles in: broad bays and headlands, with smaller coves
        const bay = clamp01(fbm(nWarp, x / 53 + 3.1, y / 53 - 8.3, 3) * 0.9 + 0.5);
        const cut = ringX + 2 + bay * bay * 16 + nWarp(x / 11 - 4, y / 11 + 2) * 2.2;
        if (e < cut) land[i] = 0;
        edgeCut[i] = smoothstep(cut, cut + 28, e);
      }
  }
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
    const u = U(i),
      v = V(i);
    const hn = fbm(nHills, u / 5.5, v / 5.5, 4);
    let e;
    if (REG) {
      // regional: the plains rise slowly over hundreds of km; rolling hills
      // where a broad (geographic-scale) noise says the country is hilly
      const dKm = dLand[i] * kmTile;
      e = 0.25 + 1.2 * (1 - Math.exp(-dKm / 380));
      const hilly = 0.3 + 0.7 * smoothstep(-0.35, 0.45, fbm(nWarp, Ud(i) / 6 + 11, Vd(i) / 6 - 3, 2));
      e += Math.pow(Math.max(0, hn * 0.5 + 0.5), 2.0) * 1.35 * hilly * smoothstep(0.5, 5, dLand[i]);
      e *= 0.45 + 0.55 * edgeCut[i];
    } else {
      const dT = dLand[i] / scale768; // tiles of a 768 map
      e = 0.26 + 1.45 * (1 - Math.exp(-dT / 7));
      e += Math.pow(Math.max(0, hn * 0.5 + 0.5), 2.0) * 1.7 * smoothstep(0.5, 6, dT);
    }
    hgt[i] = e;
  }
  // plateaus: flat tables with softly wobbling edges and gentle roughness (on
  // regional maps, rolling uplands: broad swells and low ridged hills)
  const platH = REG ? RELIEF * VK : RELIEF;
  const plat = new Float32Array(N);
  const platK = new Float32Array(N);
  for (const f of F_PLATEAUS) {
    const edge = f.edge ?? 1.5;
    stamp(f, 1, edge * 1.5, (i, d, h, w) => {
      if (!land[i]) return;
      const k = falloff(d, w, edge, i);
      if (k <= 0) return;
      // (high plateaus such as Tibet roll in broad swells and low ridged hills
      // on every map, instead of lying flat as a table)
      const high = !REG && h >= 9; // Tibet, Pamir, Altiplano on the whole Earth
      const r = REG || high ? (fbm(nRough, U(i) / 3.2, V(i) / 3.2, 3) * (0.5 + h * 0.06) + (ridged(nRidge, U(i) / 1.7 + 5, V(i) / 1.7 - 2) - 0.45) * (0.3 + h * 0.05)) * (high ? 1.6 : 1) : fbm(nRough, U(i) / 1.6, V(i) / 1.6, 3) * (0.25 + h * 0.03);
      // (and stand a little lower, leaving their great peaks room to rise above)
      const val = h * (high ? 0.6 : platH) * k + r * k;
      if (val > plat[i]) plat[i] = val;
      if (k > platK[i]) platK[i] = k;
    });
  }
  for (let i = 0; i < N; i++) if (land[i] && plat[i] > 0) hgt[i] = smax(hgt[i], plat[i] * (REG ? 0.4 + 0.6 * edgeCut[i] : 1), 0.8);
  // basins: the ground sinks toward the basin floor
  for (const f of F_BASINS) {
    const edge = f.edge ?? 2;
    stamp(f, 1, edge * 1.5, (i, d, h, w) => {
      if (!land[i]) return;
      const k = falloff(d, w, edge, i, 0.3);
      if (k <= 0) return;
      const ft = f.t > 2 ? f.t * platH : f.t;
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
    const r = REG ? 10 : Math.max(3, Math.round(6 * scale768));
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
  const iceR = new Uint8Array(REG ? N : 0);
  const peakK = new Float32Array(N); // 0..1 inside `peaks` ranges (whole Earth)
  // ranges keep at least ~2 tiles of half-width on any map size, so narrow
  // ones (Taiwan, the Cascades) are not single-tile spikes the blur flattens
  const minRangeW = (REG ? 3 : 2.2) / tpd,
    minConeW = (REG ? 2.5 : 1.8) / tpd;
  // Regional maps zoom in 4-100x: a range is many tiles wide, so its relief
  // comes from erosion-like detail inside the range's envelope: a warped
  // ridged multifractal (crests and peaks with smooth valleys between, spaced
  // for the range's width) times drainage valleys running down the flanks.
  const regionalRange = (f, f0) => (i, d, h, w, sAl, side) => {
    if (!land[i]) return;
    const x = i % W,
      y = (i / W) | 0;
    const u = U(i),
      v = V(i);
    const wt = w * tpd; // half-width in tiles
    let t = d / w + nWarp(u * 0.6 + 3, v * 0.6 + 7) * 0.08 + nWarp(u * 1.7 - 9, v * 1.7 + 2) * 0.04;
    if (t >= 1) return;
    t = Math.max(0, t);
    let env, m;
    if (f.cone) {
      // volcano: a smooth cone scored by radial gullies
      env = Math.pow(1 - t, 1.5);
      m = 0.84 + 0.16 * ridged(nRidge, x / 5 + 3, y / 5 - 1);
    } else {
      env = Math.pow(1 - t, 1.3) * (1 + 1.3 * t);
      // spurs and valleys running down each flank from the crest: ridged
      // noise in (along the range, out from the crest) space, stretched
      // across the range and warped so the valleys wander
      const lam = Math.max(6, Math.min(16, wt * 0.24)); // valley spacing (tiles)
      const along = sAl * tpd + nWarp(x / 23 + 5, y / 23 - 3) * lam * 0.55,
        across = t * wt;
      const sOff = (f0.pts[0][0] % 7) + (side > 0 ? 0 : 31.7);
      const sp = ridged(nWarp, along / lam + sOff, across / (lam * 2.6) + 4.3);
      const sp2 = ridged(nRough, along / (lam * 0.6) - sOff, across / (lam * 1.3) + 8.1);
      const spur = clamp01(0.72 * sp + 0.28 * sp2);
      // summits and saddles along the crest, and broad massifs
      const crest = 0.68 + 0.32 * ridged(nRidge, along / (lam * 1.6) + 13, sOff * 0.3 + across / (lam * 4));
      const mass = 0.82 + 0.18 * fbm(nHills, x / (lam * 5) + 7, y / (lam * 5) - 2, 2);
      // valleys cut deeper away from the crest
      const vd = 0.62 * smoothstep(0.04, 0.45, t);
      m = crest * mass * (1 - vd * (1 - spur));
    }
    const coastK = f.cone ? 1 : 0.6 + 0.4 * smoothstep(1, 9, landW[i]);
    const val = Math.min(21.5, h * VK * env * m * coastK * (0.3 + 0.7 * edgeCut[i]));
    if (val > rng[i]) rng[i] = val;
    if (env > rangeMask[i]) rangeMask[i] = env;
    if (f.ice && env > 0.3) iceR[i] = 1; // ice caps (Iceland's glaciers)
  };
  for (const f0 of F_RANGES) {
    const mw = f0.cone ? minConeW : minRangeW;
    const k = f0.cone || REG ? 1 : RANGE_WIDEN;
    const f = { ...f0, w: Math.max((f0.w ?? 1) * k, mw), pts: f0.pts.map((p) => (p.length > 3 ? [p[0], p[1], p[2], Math.max(p[3] * k, mw)] : p)) };
    if (REG) {
      stamp(f, 1.15, 0, regionalRange(f, f0));
      continue;
    }
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
        // (f.peaks: separate summits over deep saddles, a field of peaks)
        crest = f.peaks ? 0.4 + 0.9 * Math.pow(0.55 * r1 + 0.45 * r2, 1.35) : 0.68 + 0.55 * (0.6 * r1 + 0.4 * r2);
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
      if (f.peaks && bump > peakK[i]) peakK[i] = bump;
    });
  }
  // smooth the range layer on its own (tile-to-tile spikes), then merge
  {
    const src = rng.slice();
    for (let pass = 0; pass < (REG ? 0 : 2); pass++) {
      const a = pass ? rng.slice() : src;
      for (let y = 1; y < H - 1; y++)
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          if (!a[i] && !a[i - 1] && !a[i + 1] && !a[i - W] && !a[i + W]) continue;
          rng[i] = (a[i] * 4 + (a[i - 1] + a[i + 1] + a[i - W] + a[i + W]) * 2 + a[i - W - 1] + a[i - W + 1] + a[i + W - 1] + a[i + W + 1]) / 16;
        }
    }
  }
  options.debug?.({ rng: rng.slice(), base: hgt.slice() });
  for (let i = 0; i < N; i++) if (rng[i] > 0 && land[i]) hgt[i] = smax(hgt[i], rng[i], 1.0);
  // no sheer ramparts: inland, the ground may rise at most ~2.4 units per tile
  // (chamfer passes over land neighbours only, so sea cliffs keep their drop).
  // Great fronts (the Himalaya above the Ganges) become stepped slopes of spurs
  // and summits instead of one wall hundreds of pixels tall.
  const limitSlopes = () => {
    const S = REG ? 2.8 : 1.5 / Math.max(0.6, scale768),
      SD = S * 1.414;
    const minDL = REG ? 4 : 4 * scale768;
    const cap = new Float32Array(N).fill(1e9);
    for (let i = 0; i < N; i++) if (land[i] && hgt[i] < 3.5 && dLand[i] >= minDL) cap[i] = hgt[i];
    const rel = (i, j, s) => {
      if (land[j] && cap[j] + s < cap[i]) cap[i] = cap[j] + s;
    };
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 1; y < H - 1; y++)
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          if (land[i]) rel(i, i - 1, S), rel(i, i - W, S), rel(i, i - W - 1, SD), rel(i, i - W + 1, SD);
        }
      for (let y = H - 2; y >= 1; y--)
        for (let x = W - 2; x >= 1; x--) {
          const i = y * W + x;
          if (land[i]) rel(i, i + 1, S), rel(i, i + W, S), rel(i, i + W + 1, SD), rel(i, i + W - 1, SD);
        }
    }
    for (let i = 0; i < N; i++) {
      if (!land[i] || !rangeMask[i] || cap[i] >= hgt[i]) continue;
      // (on `peaks` ranges the capped face is scored by spurs and gullies,
      // and summits keep part of their height above the ramp, so a great
      // front reads as a field of peaks over spurs, not one wall)
      const pk = peakK[i];
      const c = cap[i] + fbm(nRough, U(i) / 0.9 + 21, V(i) / 0.9 - 4, 2) * 1.0 + (pk ? (ridged(nRidge, U(i) / 0.6 + 3, V(i) / 0.6 - 8) - 0.42) * 3.2 * pk : 0);
      if (c < hgt[i]) hgt[i] = c + (hgt[i] - c) * 0.55 * pk;
    }
  };
  limitSlopes();
  for (const f of REG ? [] : COAST_PLAINS) {
    stamp(f, 1, 0, (i) => {
      if (!land[i]) return;
      const d = dLand[i] / Math.max(0.7, scale768);
      if (d <= 3.8) hgt[i] = Math.min(hgt[i], 0.35 + d * 0.5 + Math.max(0, d - 2.8) * 1.2);
    });
  }
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
  if (REG) for (let i = 0; i < N; i++) if (iceR[i] && land[i]) icecap[i] = 1;
  for (let y = 0; y < H; y++) {
    const lat = latY[y];
    if (lat > -60 && lat < 59) continue;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!land[i]) continue;
      const dT = REG ? (dLand[i] * kmTile) / 52 : dLand[i] / scale768;
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
    // (regional maps: a shore band of shallows about as wide on screen as on
    // the whole Earth; the great shelves come from SHELVES)
    const dT = REG ? (dSea[i] * Math.max(kmTile, 10)) / 52 : dSea[i] / scale768;
    const u = U(i),
      v = V(i);
    const bank = fbm(nBank, u / 3, v / 3, 3);
    let depth = 0.24 + 1.35 * smoothstep(0, 2.2, dT) + 6.6 * smoothstep(1.6, 11, dT);
    depth += bank * 1.0 * smoothstep(1, 5, dT);
    hgt[i] = -Math.max(0.2, depth);
  }
  for (const f of F_SHELVES) {
    const edge = f.edge ?? 1.5;
    stamp(f, 1, edge * 1.5, (i, d, h, w) => {
      if (land[i]) return;
      const k = falloff(d, w, edge, i, 0.4);
      // (regional maps zoom in on these shelves: a mid-blue sea rather than a
      // pale field of shallows)
      const target = -((REG ? Math.max(1, f.d) * 1.9 : f.d) + Math.max(0, fbm(nBank, U(i) / 1.5, V(i) / 1.5, 2)) * 0.4);
      if (target > hgt[i]) hgt[i] += (target - hgt[i]) * k;
    });
  }
  // regional maps: the sea deepens toward the window's edges, so no shelf
  // runs into the border as a straight pale line
  if (REG)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (land[i]) continue;
        const k = (1 - smoothstep(ringY, ringY + 56, edgeDist(x, y) + fbm(nBank, x / 41, y / 41, 2) * 14)) * smoothstep(1.5, 8, dSea[i]);
        if (k > 0) hgt[i] = Math.min(hgt[i], hgt[i] + (-7.6 - hgt[i]) * k);
      }
  for (let i = 0; i < N; i++) {
    if (land[i]) hgt[i] = Math.max(hgt[i], 0.24);
    else hgt[i] = Math.min(-0.2, Math.max(hgt[i], MIN_HEIGHT));
    // lone islets (a tile or two in open ocean) rise as small volcanic hills,
    // not flat sand discs that read as foam rings
    if (land[i] && landW[i] <= 1.01) hgt[i] = Math.max(hgt[i], 0.85 + hash2(i % W, (i / W) | 0, seed + 9) * 0.45);
  }
  // ...standing in a shallow ring of seabed, so they read as small islands
  // rather than needles rising from deep water
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (land[i] || dSea[i] > 1.5) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (land[i + dy * W + dx] && landW[i + dy * W + dx] <= 1.01) near = true;
      if (near) hgt[i] = Math.max(hgt[i], -0.45 - hash2(x, y, seed + 13) * 0.3);
    }
  // narrow islands and peninsulas (Japan, the Philippines, Italy) rise gently
  // from their shores: green slopes and beaches instead of a rock spine
  // walled by sea cliffs
  if (!REG)
    for (let i = 0; i < N; i++) {
      if (!land[i] || landW[i] > 3.2 * scale768 || landW[i] <= 1.01) continue;
      const d = dLand[i] / scale768;
      const cap = 0.35 + d * 0.9 + Math.max(0, d - 1.4) * 1.1;
      if (hgt[i] > cap) hgt[i] = cap + (hgt[i] - cap) * 0.25;
    }
  // terraced benches on the flanks and plateau rims; crests stay sharp
  const benchMask = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let m = 0;
    // (not on the high plateaus: Tibet's rim read as a terraced fortress wall)
    if (plat[i] > 4 && plat[i] < 6.5 && !REG) m = platK[i] * 0.25 * (1 - smoothstep(0.15, 0.4, rangeMask[i]));
    benchMask[i] = m;
  }
  H_.terraceMountains(hgt, benchMask, W, H);
  _t('relief');

  // ------------------------------------------------------------------ 4. lakes
  const lake = new Uint8Array(N);
  // regional maps: the Natural Earth lakes from the mask, plus a few the
  // 1:50m data lacks (Biwa, ...); the whole Earth: the sketched lakes
  if (REG) for (let i = 0; i < N; i++) if (land[i] && lakeCov[i] >= 0.5 * cov[i]) lake[i] = 1;
  const xWrap = (x) => (REG ? (x < 0 || x >= W ? -1 : x) : ((x % W) + W) % W);
  for (const L of REG ? fromSets('lakes') : LAKES) {
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
          for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) if (xWrap(x) >= 0) lake[y * W + xWrap(x)] = 1;
      }
      // tiny lakes: at least the tile under the centroid
      const cx = Math.round(P.reduce((s, p) => s + p[0], 0) / P.length),
        cy = Math.round(P.reduce((s, p) => s + p[1], 0) / P.length);
      if (cy >= 0 && cy < H && xWrap(cx) >= 0) lake[cy * W + xWrap(cx)] = 1;
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
    // regional maps: valleys a little wider, meanders at the Huge map's scale
    const VW = REG ? 1.7 : 1,
      MZ = REG ? 2.2 : Math.max(0.6, scale768);
    for (const R of F_RIVERS) {
      // authored points -> tile space -> Catmull-Rom, sampled ~2 per tile
      const P = [];
      for (const [lon, lat] of R.pts) P.push([toX(lon, P.length ? P[P.length - 1][0] : null), toY(lat)]);
      if (REG && !P.some(([x, y]) => x > -20 && x < W + 20 && y > -20 && y < H + 20)) continue;
      // carry the mouth a little past the coast
      const a = P[P.length - 2],
        b = P[P.length - 1];
      const ml = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const ext = REG ? 3 : 2.5 * scale768;
      if (!R.trib) P.push([b[0] + ((b[0] - a[0]) / ml) * ext, b[1] + ((b[1] - a[1]) / ml) * ext]);
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
        const x = REG ? Math.min(W - 1, Math.max(0, Math.round(p[0]))) : ((Math.round(p[0]) % W) + W) % W,
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
        const amp = (0.35 + 0.55 * Math.min(1, s / L)) * Math.min(1, s / 3, (L - s) / 2 + 0.2) * MZ;
        const off = nMeander((s * 0.11) / MZ, seed * 0.01 + R.pts[0][0]) * amp;
        return [p[0] - ty * off, p[1] + tx * off];
      });
      for (let k = 0; k < M.length - 1; k++) {
        const [ax, az] = M[k],
          [bx, bz] = M[k + 1];
        const s = sAlong[k] / L;
        // (regional maps: about a tile wide at the mouth, a little more for the great rivers)
        const w = REG ? Math.max(0.3, 0.3 + (0.15 + R.w * 0.9) * Math.pow(s, 0.65)) : Math.max(0.16, (0.2 + (R.w - 0.2) * Math.pow(s, 0.65)) * wScale);
        const size = Math.min(1, w / 1.1);
        const bed = -(0.32 + 0.45 * size);
        const Rr = w + 3.2 * VW;
        const vx = bx - ax,
          vz = bz - az;
        const L2 = vx * vx + vz * vz;
        const y0 = Math.max(1, Math.floor(Math.min(az, bz) - Rr)),
          y1 = Math.min(H - 2, Math.ceil(Math.max(az, bz) + Rr));
        const x0 = Math.floor(Math.min(ax, bx) - Rr),
          x1 = Math.ceil(Math.max(ax, bx) + Rr);
        for (let yy = y0; yy <= y1; yy++)
          for (let xi = x0; xi <= x1; xi++) {
            if (REG && (xi < 0 || xi >= W)) continue;
            const xx = REG ? xi : ((xi % W) + W) % W;
            const qx = xi - ax,
              qz = yy - az;
            const tt = L2 > 1e-6 ? Math.max(0, Math.min(1, (qx * vx + qz * vz) / L2)) : 0;
            const ex = qx - vx * tt,
              ez = qz - vz * tt;
            const d2 = ex * ex + ez * ez;
            if (d2 > Rr * Rr) continue;
            const e = Math.max(0, Math.sqrt(d2) - w);
            const ev = Math.max(0, e - 1.1) / VW;
            // narrow valleys with steep walls: a river only shapes the ground
            // a few tiles either side (tiles are ~50 km here; regional maps
            // keep the channel narrow and open the valley a little wider)
            const t = bed + (0.42 - bed) * smoothstep(0, REG ? 0.8 : 1.1, e) + ev * 1.2 + ev * ev * 1.2;
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
  limitSlopes();
  _t('rivers');

  // the border ring is deep open sea: the water shader and the terrain skirt
  // extend the edge tiles' depth outward, so shallows there would show as a
  // pale band beyond the map
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      // open sea below Antarctica's far coast: a short shelf, then deep water
      if (!land[i] && latY[y] < southCut[x] - 0.2) hgt[i] = Math.min(hgt[i], -Math.min(6, 1.0 + 1.3 * dSea[i] / Math.max(0.7, scale768)));
      // the sea deepens over a broad band toward the border, so the map's
      // ocean meets the deep water beyond it without a visible box edge
      // (the Arctic shelf and the sea below Antarctica used to end in a line)
      if (!land[i] && !REG) {
        const ek = (1 - smoothstep(ringY, ringY + 28 * scale768, edgeDist(x, y) + fbm(nBank, x / NT / 2.5, y / NT / 2.5, 2) * 5 * scale768)) * smoothstep(1, 4 * scale768, dSea[i]);
        if (ek > 0) hgt[i] = Math.min(hgt[i], hgt[i] + (-8.6 - hgt[i]) * ek);
      }
      if (!inRing(x, y)) continue;
      const k = Math.min(1, edgeDist(x, y) / ringY); // 0 at the border
      hgt[i] = Math.min(hgt[i], -(REG ? 8 - 3 * k : 8.6 - 4 * k) + fbm(nBank, x / NT / 3, y / NT / 3, 2) * 0.5);
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
      bt -= 0.2 * smoothstep(-57, -67, lat + fbm(nMoist, u / 7 + 3, v / 7, 2) * 2.5); // Antarctica and its ice shelves
      if (icecap[i]) bt -= 0.08;
      baseT[i] = bt;
      const h = Math.max(0, hgt[i]) / VK;
      temp[i] = clamp01(bt - h * 0.05 - Math.max(0, h - 4.5) * 0.04);
      const dOc = dOcean[i] / tpd; // degrees on the map
      let m = ml - 0.26 * smoothstep(4, 22, dOc) * contK + 0.08 * Math.exp(-dOc / 2.5);
      m += fbm(nMoist, u / 6, v / 6, 3) * 0.07;
      moist[i] = m;
    }
  }
  for (const f of F_MOISTURE) {
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
    for (let x = 0; x < W; x++)
      if (latY[y] < southCut[x] - 0.4 && hgt[y * W + x] < SEA_LEVEL) temp[y * W + x] = Math.max(temp[y * W + x], 0.42);
      else {
        const ek = 1 - smoothstep(ringY, ringY + 10 * scale768, Math.min(edgeDist(x, y), Math.min(x, W - 1 - x)));
        if (ek > 0) temp[y * W + x] = Math.max(temp[y * W + x], 0.42 * ek + temp[y * W + x] * (1 - ek));
      }
  // The water's cold slate tint follows temperature: over open sea it fades
  // out gradually across a broad band toward the border, so the polar seas
  // meet the outer ocean beyond the map without a straight line where the
  // tint used to stop (the top and bottom of the whole Earth)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (hgt[i] >= SEA_LEVEL) continue;
      const ek = Math.pow(1 - smoothstep(ringY, ringY + (REG ? 90 : 70 * scale768), edgeDist(x, y)), 1.5);
      if (ek > 0) temp[i] = Math.max(temp[i], temp[i] + (0.52 - temp[i]) * ek);
    }
  // rivers and lakes water their banks (green valleys through dry land)
  for (let i = 0; i < N; i++) {
    if (hgt[i] < SEA_LEVEL) continue;
    const dw = dWater[i] / Math.max(0.7, scale768);
    if (dOcean[i] > dWater[i] + 0.5) moist[i] += 0.38 * Math.exp(-dw / 1.3);
    moist[i] = clamp01(moist[i]);
  }
  const wetland = new Uint8Array(N);
  // (regional maps: marshes in patches among the meadows, not one solid field)
  for (const f of WETLANDS) stamp(f, 1, 0, (i, d, h, w) => (falloff(d, w * 0.7, w * 0.3, i, 0.6) > 0.3 && (!REG || fbm(nMoist, U(i) / 1.3 + 7, V(i) / 1.3 - 5, 3) > 0.02) ? (wetland[i] = 1) : 0));
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
          const ds = REG ? (dSea[i] * kmTile) / 45 : dSea[i] / scale768;
          // Arctic pack: a ragged band with open water before the border;
          // around Antarctica: ice shelves and fast ice hugging the coast
          const pk = nWarp(x / tpd / 9 + 70, 2.3) * 2.6 + nWarp(x / tpd / 2.6 - 40, 5.5) * 0.9;
          // the pack thins out toward the side borders (natural ends)
          const ek = sideK[x];
          // (no open-ocean pack band: at the top of a plate carree any pack reads as a white strip or a dashed row)
          void ek;
          if (lat > 70 && ds < 2.2 + bn) ice = true;
          else if (lat < -60 && ds < 2.4 + bn * 1.2 + Math.max(0, pk) * 0.9) ice = true;
          else if (lat > southCut[x] + 1.4) {
            // the Ross and Filchner-Ronne ice shelves (water in the land mask)
            const lo = lonX[x];
            if (((lo > 158 || lo < -146) && lat < -77.8 + bn) || (lo > -82 && lo < -28 && lat < -74.8 + bn)) ice = true;
          }
          // open sea south of Antarctica's far coast, and short of the border
          if (lat < southCut[x] - 0.2) ice = false;
          if (Math.min(x, W - 1 - x) < ringX + 1 + bn || Math.min(y, H - 1 - y) < ringY + 2 + bn) ice = false;
          if (sideK[x] < 0.35 + bn * 0.25) ice = false;
        }
        if (ice) type[i] = TILE.ICE;
        else if (!sea[i]) type[i] = riverMask[i] || depth > 1.1 + bn * 0.5 ? TILE.SOIL : TILE.SAND;
        else type[i] = depth < 2.8 + bn * 1.2 ? TILE.SAND : TILE.ROCK;
        continue;
      }
      const t = temp[i],
        m = moist[i];
      const slope = H_.slopeOf(hgt, W, H, x, y) * slopeK;
      // crests of the great ranges carry snow even where the lowered relief stays under the regional line
      const snowLine = (5 + 7.2 * clamp01(baseT[i]) + bn * 1.0 - (REG ? 1.2 : 2.6) * smoothstep(0.35, 0.85, rangeMask[i])) * VK;
      const rockLine = snowLine - (2.5 - bn * 0.5) * VK;
      const dOcT = dOcean[i]; // tiles to the open sea
      let tt;
      if (icecap[i] && dLand[i] >= 1 && dLand[i] < 9 * scale768 && ridged(nRidge, x / tpd / 1.3 + 7, y / tpd / 1.3 - 3) > 0.86) tt = TILE.ROCK; // nunataks
      else if (icecap[i] || h > snowLine || t < 0.11 + bn * 0.02) tt = TILE.SNOW;
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
  for (let i = 0; i < N; i++) {
    if (type[i] !== TILE.ROCK || hgt[i] < SEA_LEVEL) continue;
    if (moist[i] < 0.14 && temp[i] > 0.42 && baseT[i] > 0.6) type[i] = TILE.DESERT;
  }
  for (let i = 0; i < N; i++) {
    if (hgt[i] < 5 * VK || plat[i] < 5.5 * VK || rangeMask[i] > 0.4) continue;
    const t = type[i];
    // (the cold plateau floor below the snow line is steppe, not snowfield)
    const lowSnow = t === TILE.SNOW && hgt[i] < (5 + 7.2 * clamp01(baseT[i]) - 1.5) * VK && !icecap[i];
    if (t === TILE.FOREST || t === TILE.GRASS || t === TILE.JUNGLE || t === TILE.SWAMP || lowSnow) {
      type[i] = TILE.TUNDRA;
      moist[i] = Math.min(moist[i], 0.36);
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
    const x = i % W,
      y = (i / W) | 0;
    const steep = FLORA_INFO[f]?.isTree && x > 0 && y > 0 && x < W - 1 && y < H - 1 && H_.slopeOf(hgt, W, H, x, y) > 1.05;
    const bare = steep || (icecap[i] ? dLand[i] > 2 || hash2(x, y, seed + 5) > 0.15 : (hgt[i] > 7 * VK || plat[i] >= 5.5 * VK) && type[i] === TILE.TUNDRA && FLORA_INFO[f]?.isTree);
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
  world.meta = {
    preset: 'earth',
    region: GEO.region,
    lon0: REG ? (GEO.lonMin + GEO.lonMax) / 2 : EARTH_LON0,
    projection: 'plate-carree',
    spreadStarts: true,
    // (regional maps: capped near the Vast whole Earth's ~345k, so a map of
    // mostly land such as Asia Mainland does not run several times its
    // population; Taiwan and Japan come in a little under the cap)
    budgetArea: REG ? Math.min(Math.round(habitable / 0.3), 440000) : Math.round(habitable / 0.3),
    kmPerTile: kmTile,
    geo: GEO, // see src/world/geo.js
  };
  world.owner.fill(-1);
  world.building.fill(-1);
  world.fire.fill(0);
  world.wetness.fill(0);
  world.markAllDirty();
  if (_times) options.profile(_times);
}

// Longitude / latitude (degrees) at a world position on the whole-Earth World
// Map (regional maps: use geoLonLat in src/world/geo.js).
export function earthLonLat(world, x, z) {
  const lon = wrap180(LEFT + (x / world.w) * 360);
  const lat = 90 - (z / world.h) * 180;
  return [lon, lat];
}
