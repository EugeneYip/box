// Little coastline maps of the World Map's regional maps (New World cards and
// the title screen's region chips), drawn from the same land masks the
// regions are built from (src/world/data/mask-<id>.js), so each card shows
// its own shores instead of a shared gradient.
import { REGION_MASK as GEA } from '../world/data/mask-great-east-asia.js';
import { REGION_MASK as AM } from '../world/data/mask-asia-mainland.js';
import { REGION_MASK as JP } from '../world/data/mask-japan.js';
import { REGION_MASK as TW } from '../world/data/mask-taiwan.js';
import { REGION_MASK as EU } from '../world/data/mask-europe.js';
import { REGION_MASK as NA } from '../world/data/mask-north-america.js';

const MASKS = { 'great-east-asia': GEA, 'asia-mainland': AM, japan: JP, taiwan: TW, europe: EU, 'north-america': NA };
const cache = new Map();

export const hasRegionThumb = (id) => !!MASKS[id];

// Land coverage (0..1) of each thumbnail pixel, streamed from the run-length
// layer (alternating runs, sea first, LEB128 varints in base64) without
// unpacking the full mask.
function coverage(M, W, H) {
  const mw = M.w,
    mh = M.h;
  const sx = W / mw,
    sy = H / mh;
  const cov = new Float32Array(W * H);
  const bin = atob(M.land);
  let p = 0,
    cur = 0;
  const addRow = (y, x0, x1) => {
    const by = Math.min(H - 1, Math.floor(y * sy));
    const o = by * W;
    for (let b = Math.floor(x0 * sx), e = Math.min(W - 1, Math.floor((x1 - 1e-6) * sx)); b <= e; b++) {
      const a = Math.max(x0, b / sx),
        z = Math.min(x1, (b + 1) / sx);
      if (z > a) cov[o + b] += z - a;
    }
  };
  for (let i = 0; i < bin.length; ) {
    let k = 0,
      shift = 0,
      c;
    do {
      c = bin.charCodeAt(i++);
      k += (c & 0x7f) * 2 ** shift;
      shift += 7;
    } while (c & 0x80);
    if (cur && k) {
      let q = p,
        left = k;
      while (left > 0) {
        const y = Math.floor(q / mw),
          x0 = q - y * mw,
          n = Math.min(left, mw - x0);
        if (y >= mh) break;
        addRow(y, x0, x0 + n);
        q += n;
        left -= n;
      }
    }
    p += k;
    cur ^= 1;
  }
  const area = 1 / sx / sy;
  for (let j = 0; j < cov.length; j++) cov[j] = Math.min(1, cov[j] / area);
  return cov;
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const SEA_IN = [47, 143, 184],
  SEA_OUT = [18, 62, 102],
  SAND = [230, 210, 154],
  LAND = [94, 168, 74],
  LAND_HI = [126, 190, 96];

// A data URL of the region's map, fitted inside maxW x maxH CSS pixels (drawn
// at twice that for sharp screens), and its CSS size.
export function regionThumb(id, maxW = 56, maxH = 36) {
  const M = MASKS[id];
  if (!M) return null;
  const key = `${id}|${maxW}|${maxH}`;
  if (cache.has(key)) return cache.get(key);
  const ar = M.w / M.h;
  let w = maxW,
    h = maxW / ar;
  if (h > maxH) {
    h = maxH;
    w = maxH * ar;
  }
  const W = Math.max(8, Math.round(w * 2)),
    H = Math.max(8, Math.round(h * 2));
  let out = null;
  try {
    const cov = coverage(M, W, H);
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(W, H);
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : cov[y * W + x]);
    // a region that is mostly land (Asia Mainland) keeps its real coast crisp,
    // and where its land is cut by the map's edge (inland borders, not shores)
    // a thin dashed atlas line marks the cut
    let landShare = 0;
    for (let j = 0; j < cov.length; j++) landShare += cov[j];
    landShare /= cov.length;
    const inland = landShare > 0.6;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = cov[y * W + x];
        const dx = x / W - 0.5,
          dy = y / H - 0.45;
        const sea = mix(SEA_IN, SEA_OUT, Math.min(1, Math.sqrt(dx * dx + dy * dy) * 1.5));
        // a pixel beside the sea is shore (sand), the rest is green land
        const near = Math.min(at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1));
        const land = near > 0.5 ? mix(LAND, LAND_HI, (1 - y / H) * 0.5) : SAND;
        const t = Math.max(0, Math.min(1, (c - 0.2) / 0.5));
        const col = mix(sea, land, t);
        const o = (y * W + x) * 4;
        img.data[o] = col[0];
        img.data[o + 1] = col[1];
        img.data[o + 2] = col[2];
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    if (inland) {
      const u = Math.max(1, W / 112);
      ctx.strokeStyle = 'rgba(255, 246, 222, 0.9)';
      ctx.lineWidth = u;
      ctx.setLineDash([3 * u, 2 * u]);
      const off = u * 0.5 + 0.5;
      // runs of land along one edge: [start, end) in pixels
      const runs = (n, landAt) => {
        const r = [];
        let s0 = -1;
        for (let i = 0; i <= n; i++) {
          const l = i < n && landAt(i) > 0.5;
          if (l && s0 < 0) s0 = i;
          else if (!l && s0 >= 0) r.push([s0, i]), (s0 = -1);
        }
        return r;
      };
      ctx.beginPath();
      for (const [a, b] of runs(W, (x) => at(x, 0))) ctx.moveTo(a, off), ctx.lineTo(b, off);
      for (const [a, b] of runs(W, (x) => at(x, H - 1))) ctx.moveTo(a, H - off), ctx.lineTo(b, H - off);
      for (const [a, b] of runs(H, (y) => at(0, y))) ctx.moveTo(off, a), ctx.lineTo(off, b);
      for (const [a, b] of runs(H, (y) => at(W - 1, y))) ctx.moveTo(W - off, a), ctx.lineTo(W - off, b);
      ctx.stroke();
    }
    out = { url: cv.toDataURL(), w: Math.round(w), h: Math.round(h) };
  } catch (e) {
    out = null;
  }
  cache.set(key, out);
  return out;
}
