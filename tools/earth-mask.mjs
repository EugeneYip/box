#!/usr/bin/env node
// One-off build step for the World Map preset: rasterizes Natural Earth land
// polygons (public domain, redistributed as TopoJSON by the `world-atlas`
// npm package) into a compact, run-length encoded land mask that the game
// imports as a small JS module (src/world/data/earthMask.js). The game never
// ships the TopoJSON itself.
//
//   npm pack world-atlas@2 && tar xzf world-atlas-2.*.tgz   (anywhere)
//   node tools/earth-mask.mjs path/to/package/land-50m.json [--w 2048] [--png preview.png]
//
// Projection: plate carrée (equirectangular), exactly 2:1, rotated so the
// central meridian (150°E) is the middle column; the seam runs through the
// Atlantic at 30°W. Pixel (x, y) centre is lon = lon0 - 180 + (x + 0.5) * 360 / W,
// lat = 90 - (y + 0.5) * 180 / H.
//
// Antimeridian: world-atlas v2 rings are stitched across ±180° (Eurasia via
// Chukotka, Wrangel Island, part of Fiji) and Antarctica's coast winds once
// around the south pole. Each ring is unwrapped so consecutive vertices never
// jump by more than 180°; rings whose longitudes wind a full turn are closed
// through the nearer pole; holes are shifted onto their outer ring's sheet.
// Scanline spans are then filled modulo the map width, so shapes that cross
// the seam or the antimeridian come out whole.
//
// Encoding: row-major bits (1 = land), alternating run lengths starting with
// a sea run, each as an unsigned LEB128 varint, then base64.
import fs from 'fs';
import zlib from 'zlib';

const args = process.argv.slice(2);
const opt = { w: 2048, lon0: 150, out: 'src/world/data/earthMask.js' };
const pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) opt[args[i].slice(2)] = args[++i];
  else pos.push(args[i]);
}
const src = pos[0] || 'node_modules/world-atlas/land-50m.json';
const MW = +opt.w,
  MH = MW / 2,
  LON0 = +opt.lon0;
const LEFT = LON0 - 180; // longitude of the left map edge

// ---- TopoJSON decode (quantized, delta-encoded arcs)
const topo = JSON.parse(fs.readFileSync(src, 'utf8'));
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
const polys = [];
for (const g of topo.objects.land.geometries) {
  if (g.type === 'Polygon') polys.push(g.arcs.map(ringOf));
  else if (g.type === 'MultiPolygon') for (const p of g.arcs) polys.push(p.map(ringOf));
}

// ---- unwrap a ring; returns { pts, net } with net = total longitude turn
function unwrap(r) {
  const pts = [[r[0][0], r[0][1]]];
  let off = 0;
  for (let k = 1; k < r.length; k++) {
    const d = r[k][0] - r[k - 1][0];
    if (d > 180) off -= 360;
    else if (d < -180) off += 360;
    pts.push([r[k][0] + off, r[k][1]]);
  }
  return { pts, net: pts[pts.length - 1][0] - pts[0][0] };
}
function inside(pts, x, y) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i],
      [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

const mask = new Uint8Array(MW * MH);
const rowsX = Array.from({ length: MH }, () => []);
let crossSeam = 0;
for (const poly of polys) {
  const rings = [];
  const outer = unwrap(poly[0]);
  let op = outer.pts;
  if (Math.abs(outer.net) > 180) {
    // winds around a pole: close through it (the nearer one to its centroid)
    const meanLat = op.reduce((s, p) => s + p[1], 0) / op.length;
    const pole = meanLat < 0 ? -90 : 90;
    op = [...op, [op[op.length - 1][0], pole], [op[0][0], pole]];
  }
  rings.push(op);
  for (const h of poly.slice(1)) {
    const u = unwrap(h);
    if (Math.abs(u.net) > 180) continue; // degenerate pole line (Antarctica)
    let best = u.pts;
    for (const s of [0, -360, 360]) {
      const p0 = u.pts[0];
      if (inside(op, p0[0] + s, p0[1])) {
        best = u.pts.map(([x, y]) => [x + s, y]);
        break;
      }
    }
    rings.push(best);
  }
  // scanline crossings, in pixel units (unwrapped)
  let minRow = MH,
    maxRow = -1;
  for (const pts of rings) {
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [x0, y0] = pts[j],
        [x1, y1] = pts[i];
      if (y0 === y1) continue;
      // rows whose centre latitude lies in [min(y), max(y))
      const lo = Math.min(y0, y1),
        hi = Math.max(y0, y1);
      const rA = Math.max(0, Math.ceil((90 - hi) / (180 / MH) - 0.5));
      const rB = Math.min(MH - 1, Math.floor((90 - lo) / (180 / MH) - 0.5));
      for (let r = rA; r <= rB; r++) {
        const lat = 90 - (r + 0.5) * (180 / MH);
        if (!(lat >= lo && lat < hi)) continue;
        const lon = x0 + ((lat - y0) / (y1 - y0)) * (x1 - x0);
        rowsX[r].push(((lon - LEFT) / 360) * MW);
        if (r < minRow) minRow = r;
        if (r > maxRow) maxRow = r;
      }
    }
  }
  for (let r = minRow; r <= maxRow; r++) {
    const xs = rowsX[r];
    if (!xs.length) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // pixel centres c + 0.5 in [xs[k], xs[k+1])
      const a = Math.ceil(xs[k] - 0.5),
        b = Math.ceil(xs[k + 1] - 0.5) - 1;
      if (a < 0 || b >= MW) crossSeam++;
      for (let c = a; c <= b; c++) mask[r * MW + (((c % MW) + MW) % MW)] = 1;
    }
    xs.length = 0;
  }
}

// ---- RLE + LEB128 + base64
const bytes = [];
const varint = (n) => {
  while (n >= 0x80) {
    bytes.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  bytes.push(n);
};
let cur = 0,
  run = 0,
  land = 0;
for (let i = 0; i < mask.length; i++) {
  land += mask[i];
  if (mask[i] === cur) run++;
  else {
    varint(run);
    cur = mask[i];
    run = 1;
  }
}
varint(run);
const b64 = Buffer.from(bytes).toString('base64');
const js = `// Generated by tools/earth-mask.mjs from Natural Earth 1:50m land polygons
// (public domain; via the world-atlas npm package). Do not edit by hand.
// ${MW} x ${MH} plate carree land mask, central meridian ${LON0}E (seam at ${((LEFT + 540) % 360) - 180}).
// Row-major, alternating run lengths (sea first) as LEB128 varints, base64.
export const EARTH_MASK = { w: ${MW}, h: ${MH}, lon0: ${LON0}, rle: '${b64}' };
`;
fs.mkdirSync(opt.out.replace(/\/[^/]*$/, ''), { recursive: true });
fs.writeFileSync(opt.out, js);
console.log(`${opt.out}: ${MW}x${MH}, land ${((land / mask.length) * 100).toFixed(1)}%, ${bytes.length} bytes RLE, ${js.length} bytes module, ${crossSeam} spans wrapped`);

// ---- optional preview PNG (grayscale)
if (opt.png) {
  const raw = Buffer.alloc((MW + 1) * MH);
  for (let y = 0; y < MH; y++) {
    raw[y * (MW + 1)] = 0;
    for (let x = 0; x < MW; x++) raw[y * (MW + 1) + 1 + x] = mask[y * MW + x] ? 235 : 40;
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
  ihdr.writeUInt32BE(MW, 0);
  ihdr.writeUInt32BE(MH, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  fs.writeFileSync(opt.png, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  console.log('preview', opt.png);
}
