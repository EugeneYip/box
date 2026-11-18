#!/usr/bin/env node
// Build step for the World Map's regional maps (docs/REGIONS.md): rasterises
// Natural Earth land and lakes (public domain) over each region's lon/lat
// window into compact run-length encoded masks that the game imports as small
// JS modules (src/world/data/mask-<region>.js). The game never ships the
// source GeoJSON / TopoJSON.
//
//   npm pack which-country-ne-10m && tar xzf which-country-ne-10m-*.tgz
//     -> package/lib/data.geo.json  (Natural Earth 1:10m admin-0 countries;
//        their union is the 1:10m land)
//   npm pack sane-topojson && tar xzf sane-topojson-*.tgz
//     -> package/dist/world_50m.json (Natural Earth 1:50m, for the lakes)
//   node tools/region-masks.mjs <data.geo.json> <world_50m.json> [--only japan] [--png dir]
//
// Windows and tile sizes come from src/world/data/regions.js. Masks are
// rasterised at twice the tile resolution (the generator box-filters them to
// tile coverage). Pixel (x, y) centre: lon = lonMin + (x + 0.5) * dLon / PW,
// lat = latMax - (y + 0.5) * dLat / PH. No window crosses the antimeridian.
//
// On the finest grids (Taiwan, Japan) the 1:10m outlines are a little
// angular next to the tiles, so their rings are rounded first with Chaikin
// corner cutting.
//
// A region's `lands` (src/world/data/regions.js) keeps only that land: the
// polygons of the listed countries, or the continental mainland; the rest of
// the window becomes open sea (docs/REGIONS.md section 4).
//
// Encoding (per layer): row-major bits, alternating run lengths starting with
// a 0 run, each as an unsigned LEB128 varint, then base64. Two layers: land
// (1 = land) and lakes (1 = lake water inside the land).
import fs from 'fs';
import zlib from 'zlib';
import { EARTH_REGIONS } from '../src/world/data/regions.js';

const args = process.argv.slice(2);
const opt = { out: 'src/world/data' };
const pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) opt[args[i].slice(2)] = args[++i];
  else pos.push(args[i]);
}
const [landSrc, lakeSrc] = pos;
if (!landSrc || !lakeSrc) {
  console.error('usage: node tools/region-masks.mjs <ne_10m_admin_0 data.geo.json> <sane-topojson world_50m.json> [--only id] [--png dir]');
  process.exit(1);
}
const SUPER = 2; // mask pixels per tile, each way

// ---- sources -> lists of polygons (arrays of rings of [lon, lat])
// (each land polygon carries its country's admin-0 code as .a3)
const landPolys = [];
{
  const gj = JSON.parse(fs.readFileSync(landSrc, 'utf8'));
  for (const f of gj.features) {
    const g = f.geometry;
    if (!g) continue;
    const a3 = f.properties.ADM0_A3;
    const add = (p) => ((p.a3 = a3), landPolys.push(p));
    if (g.type === 'Polygon') add(g.coordinates);
    else if (g.type === 'MultiPolygon') for (const p of g.coordinates) add(p);
  }
}
// Islands the 1:10m countries lack, as rough outlines from their real
// positions and sizes, added to the land of the country named: the Matsu
// Islands (Nangan, Beigan, Juguang, Dongyin) and Lesser Kinmen (Lieyu), held
// by the ROC.
const blob = (lon, lat, rx, ry, k = [1, 0.85, 1.1, 0.9, 1.05, 0.8, 1, 0.95]) =>
  [k.map((f, i) => {
    const a = (i / k.length) * Math.PI * 2;
    return [lon + Math.cos(a) * rx * f, lat + Math.sin(a) * ry * f];
  })];
for (const [a3, lon, lat, rx, ry, k] of [
  ['TWN', 119.935, 26.155, 0.027, 0.014], // Nangan
  ['TWN', 120.003, 26.222, 0.024, 0.014, [1.1, 0.8, 1, 1.05, 0.9, 0.85, 1.1, 0.9]], // Beigan
  ['TWN', 120.49, 26.368, 0.012, 0.008], // Dongyin
  ['TWN', 119.94, 25.968, 0.008, 0.007], // Xiju
  ['TWN', 119.976, 25.957, 0.009, 0.008], // Dongju
  ['TWN', 118.243, 24.428, 0.02, 0.016], // Lieyu (Lesser Kinmen)
]) {
  const p = blob(lon, lat, rx, ry, k);
  p.a3 = a3;
  landPolys.push(p);
}
// The continental mainland (for `lands: 'mainland'`): countries' polygons
// that share a land border share boundary vertices, so polygons linked by
// shared vertices form one landmass; the mainland is the landmass with the
// most land inside the window (Eurasia with Africa on Asia Mainland). Islands,
// even those split between countries (Borneo, Timor, New Guinea), form
// landmasses of their own.
let _landmass = null;
function landmassOf() {
  if (_landmass) return _landmass;
  const parent = landPolys.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const owner = new Map(); // vertex key -> first polygon seen there
  const shared = new Map(); // polygon pair -> shared vertex count
  // (all rings: an enclave such as Baikonur shares the hole of its host)
  landPolys.forEach((poly, pi) => {
    for (const [x, y] of poly.flat()) {
      const k = `${x.toFixed(6)},${y.toFixed(6)}`;
      const o = owner.get(k);
      if (o == null) owner.set(k, pi);
      else if (o !== pi) {
        const pk = o < pi ? `${o}:${pi}` : `${pi}:${o}`;
        const n = (shared.get(pk) || 0) + 1;
        shared.set(pk, n);
        if (n === 2) parent[find(o)] = find(pi);
      }
    }
  });
  return (_landmass = landPolys.map((_, pi) => find(pi)));
}
function mainlandSet(R, PW, PH, hit) {
  const lm = landmassOf();
  const label = new Int32Array(PW * PH).fill(-1);
  landPolys.forEach((poly, pi) => hit(bbox(poly[0])) && fillPoly(label, PW, PH, R, poly, pi));
  const area = new Map();
  for (const v of label) if (v >= 0) area.set(lm[v], (area.get(lm[v]) || 0) + 1);
  let root = -1,
    best = 0;
  for (const [r, a] of area) if (a > best) (best = a), (root = r);
  return new Set(landPolys.map((_, pi) => pi).filter((pi) => lm[pi] === root));
}

const lakePolys = [];
{
  const topo = JSON.parse(fs.readFileSync(lakeSrc, 'utf8'));
  const { scale, translate } = topo.transform;
  const arcs = topo.arcs.map((a) => {
    let x = 0,
      y = 0;
    return a.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });
  const ringOf = (r) => {
    const out = [];
    for (const i of r) {
      const a = i >= 0 ? arcs[i] : arcs[~i].slice().reverse();
      for (let k = out.length ? 1 : 0; k < a.length; k++) out.push(a[k]);
    }
    return out;
  };
  for (const g of topo.objects.lakes.geometries) {
    if (g.type === 'Polygon') lakePolys.push(g.arcs.map(ringOf));
    else if (g.type === 'MultiPolygon') for (const p of g.arcs) lakePolys.push(p.map(ringOf));
  }
}
console.log(`sources: ${landPolys.length} land polygons, ${lakePolys.length} lakes`);

function bbox(ring) {
  let a = Infinity,
    b = -Infinity,
    c = Infinity,
    d = -Infinity;
  for (const [x, y] of ring) {
    if (x < a) a = x;
    if (x > b) b = x;
    if (y < c) c = y;
    if (y > d) d = y;
  }
  return [a, b, c, d];
}
function chaikin(ring, n) {
  let r = ring;
  for (let it = 0; it < n; it++) {
    const out = [];
    const m = r.length - (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? 1 : 0);
    for (let i = 0; i < m; i++) {
      const p = r[i],
        q = r[(i + 1) % m];
      out.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]], [0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
    }
    r = out;
  }
  return r;
}

// Even-odd scanline fill of one polygon (all its rings) into mask (OR).
function fillPoly(mask, PW, PH, R, rings, val = 1) {
  const dLon = R.lonMax - R.lonMin,
    dLat = R.latMax - R.latMin;
  const rows = new Map();
  for (const pts of rings) {
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [x0, y0] = pts[j],
        [x1, y1] = pts[i];
      if (y0 === y1) continue;
      const lo = Math.min(y0, y1),
        hi = Math.max(y0, y1);
      const rA = Math.max(0, Math.ceil(((R.latMax - hi) / dLat) * PH - 0.5));
      const rB = Math.min(PH - 1, Math.floor(((R.latMax - lo) / dLat) * PH - 0.5));
      for (let r = rA; r <= rB; r++) {
        const lat = R.latMax - ((r + 0.5) * dLat) / PH;
        if (!(lat >= lo && lat < hi)) continue;
        const lon = x0 + ((lat - y0) / (y1 - y0)) * (x1 - x0);
        let xs = rows.get(r);
        if (!xs) rows.set(r, (xs = []));
        xs.push(((lon - R.lonMin) / dLon) * PW);
      }
    }
  }
  for (const [r, xs] of rows) {
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k] - 0.5)),
        b = Math.min(PW - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
      for (let c = a; c <= b; c++) mask[r * PW + c] = val;
    }
  }
}

function rle(mask) {
  const bytes = [];
  const varint = (n) => {
    while (n >= 0x80) {
      bytes.push((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    bytes.push(n);
  };
  let cur = 0,
    run = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === cur) run++;
    else {
      varint(run);
      cur = mask[i];
      run = 1;
    }
  }
  varint(run);
  return Buffer.from(bytes).toString('base64');
}

function png(file, PW, PH, pix) {
  const raw = Buffer.alloc((PW + 1) * PH);
  for (let y = 0; y < PH; y++) {
    raw[y * (PW + 1)] = 0;
    for (let x = 0; x < PW; x++) raw[y * (PW + 1) + 1 + x] = pix(y * PW + x);
  }
  const crcT = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc = (b) => {
    let c = -1;
    for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (t, d) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t), d]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(PW, 0);
  ihdr.writeUInt32BE(PH, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

for (const R of EARTH_REGIONS) {
  if (opt.only && opt.only !== R.id) continue;
  const t0 = Date.now();
  const PW = R.w * SUPER,
    PH = R.h * SUPER;
  const pxKm = R.km / SUPER;
  const smooth = pxKm < 0.5 ? 2 : pxKm < 1.5 ? 1 : 0;
  const m = 0.5; // degrees of margin when picking polygons
  const hit = (b) => b[1] >= R.lonMin - m && b[0] <= R.lonMax + m && b[3] >= R.latMin - m && b[2] <= R.latMax + m;
  const land = new Uint8Array(PW * PH);
  // (land outside the map's own `lands`: drawn here only to drop the lakes on it)
  const gone = new Uint8Array(R.lands ? PW * PH : 0);
  const main = R.lands === 'mainland' ? mainlandSet(R, PW, PH, hit) : null;
  const keepPoly = (poly, pi) => !R.lands || (main ? main.has(pi) : R.lands.includes(poly.a3));
  let nPolys = 0,
    nGone = 0;
  landPolys.forEach((poly, pi) => {
    if (!hit(bbox(poly[0]))) return;
    const keep = keepPoly(poly, pi);
    keep ? nPolys++ : nGone++;
    fillPoly(keep ? land : gone, PW, PH, R, smooth ? poly.map((r) => chaikin(r, smooth)) : poly);
  });
  // lakes: the larger Natural Earth 1:50m lakes (at least ~12 tiles of water)
  const lake = new Uint8Array(PW * PH);
  let nLakes = 0;
  const tmp = new Uint8Array(PW * PH);
  for (const poly of lakePolys) {
    if (!hit(bbox(poly[0]))) continue;
    tmp.fill(0);
    fillPoly(tmp, PW, PH, R, poly.map((r) => chaikin(r, 1)));
    let n = 0;
    for (let i = 0; i < tmp.length; i++) n += tmp[i];
    if (n < 12 * SUPER * SUPER) continue;
    nLakes++;
    for (let i = 0; i < tmp.length; i++) if (tmp[i]) lake[i] = 1;
  }
  let nLand = 0,
    nLake = 0;
  for (let i = 0; i < land.length; i++) {
    if (gone.length && gone[i] && !land[i]) lake[i] = 0; // lakes of removed land are sea
    if (lake[i]) land[i] = 0;
    nLand += land[i];
    nLake += lake[i];
  }
  const L = rle(land),
    K = rle(lake);
  const file = `${opt.out}/mask-${R.id}.js`;
  const js = `// Generated by tools/region-masks.mjs from Natural Earth (public domain):
// 1:10m admin-0 countries (their union is the land) and 1:50m lakes.
// Do not edit by hand. Region "${R.id}"${R.lands ? ` (only ${R.lands === 'mainland' ? 'the continental mainland' : R.lands.join(', ')})` : ''}: ${PW} x ${PH} pixels (${SUPER}x the ${R.w} x ${R.h} tile grid)
// over lon ${R.lonMin}..${R.lonMax}, lat ${R.latMin}..${R.latMax}.
// Per layer: row-major, alternating run lengths (0 first) as LEB128 varints, base64.
export const REGION_MASK = { id: '${R.id}', w: ${PW}, h: ${PH}, lonMin: ${R.lonMin}, lonMax: ${R.lonMax}, latMin: ${R.latMin}, latMax: ${R.latMax}, land: '${L}', lakes: '${K}' };
`;
  fs.writeFileSync(file, js);
  console.log(`${file}: ${PW}x${PH}, ${nPolys} polygons${nGone ? ` (${nGone} removed: ${R.lands === 'mainland' ? 'islands' : 'not ' + R.lands.join('/')})` : ''}, ${nLakes} lakes, land ${((nLand / land.length) * 100).toFixed(1)}%, lakes ${((nLake / land.length) * 100).toFixed(2)}%, ${(js.length / 1024).toFixed(0)} KB, ${Date.now() - t0} ms`);
  if (opt.png) png(`${opt.png}/mask-${R.id}.png`, PW, PH, (i) => (lake[i] ? 120 : land[i] ? 235 : 30));
}
