import * as THREE from 'three';
import { mulberry32 } from '../../core/Random.js';

// Procedurally generated, tileable noise textures shared by the landscape
// shaders (terrain, seabed, water). Sampling mip-mapped textures is far
// cheaper than evaluating noise arithmetically per pixel and, crucially, it
// is band-limited: distant detail fades out instead of shimmering.
//
//   noise (RGBA8, 256², repeat, mipmaps)
//     R  fbm gradient noise, base period 4 cells / tile, 5 octaves
//     G  fbm gradient noise, independent, base period 8, 5 octaves
//     B  ridged noise (1 - |n|)², period 8, 3 octaves (veins, ripples)
//     A  high-frequency gradient noise, period 32, 2 octaves (micro detail)
//
//   cells (RGBA8, 256², repeat, mipmaps) - Worley / Voronoi on a 16×16 grid
//     R  F1 distance (0 at feature points, ~1 far away)
//     G  F2 - F1 (0 on cell borders: cracks, cobble joints, lava crust seams)
//     B  random value of the nearest cell
//     A  second random value of the nearest cell
//
// Both textures tile seamlessly, so shaders can sample them at any scale.
const SIZE = 256;

function makeGradNoise(rand, period) {
  // Periodic 2D gradient (Perlin) noise with an integer lattice period.
  const n = period;
  const gx = new Float32Array(n * n);
  const gy = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const a = rand() * Math.PI * 2;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    // x, y in lattice units, wrapped by period
    const xi = Math.floor(x),
      yi = Math.floor(y);
    const xf = x - xi,
      yf = y - yi;
    const x0 = ((xi % n) + n) % n,
      y0 = ((yi % n) + n) % n;
    const x1 = (x0 + 1) % n,
      y1 = (y0 + 1) % n;
    const d = (ix, iy, dx, dy) => {
      const k = iy * n + ix;
      return gx[k] * dx + gy[k] * dy;
    };
    const u = fade(xf),
      v = fade(yf);
    const a = d(x0, y0, xf, yf);
    const b = d(x1, y0, xf - 1, yf);
    const c = d(x0, y1, xf, yf - 1);
    const e = d(x1, y1, xf - 1, yf - 1);
    return (a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v) * 1.41;
  };
}

function fbmChannel(rand, basePeriod, octaves, gain = 0.5, ridged = false) {
  const layers = [];
  let p = basePeriod;
  for (let o = 0; o < octaves; o++) {
    layers.push({ fn: makeGradNoise(rand, p), period: p });
    p *= 2;
  }
  const out = new Float32Array(SIZE * SIZE);
  let mn = Infinity,
    mx = -Infinity;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let s = 0,
        a = 1,
        norm = 0;
      for (const L of layers) {
        const k = L.period / SIZE;
        let v = L.fn(x * k, y * k);
        if (ridged) {
          v = 1 - Math.abs(v);
          v *= v;
        }
        s += v * a;
        norm += a;
        a *= gain;
      }
      s /= norm;
      out[y * SIZE + x] = s;
      if (s < mn) mn = s;
      if (s > mx) mx = s;
    }
  }
  // normalise to 0..1 with a gentle contrast so the channel uses its range
  const r = mx - mn || 1;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) / r;
  return out;
}

function worley(rand, cells) {
  const cs = SIZE / cells;
  const fx = new Float32Array(cells * cells);
  const fy = new Float32Array(cells * cells);
  const r1 = new Float32Array(cells * cells);
  const r2 = new Float32Array(cells * cells);
  for (let i = 0; i < cells * cells; i++) {
    fx[i] = 0.12 + rand() * 0.76;
    fy[i] = 0.12 + rand() * 0.76;
    r1[i] = rand();
    r2[i] = rand();
  }
  const F1 = new Float32Array(SIZE * SIZE);
  const E = new Float32Array(SIZE * SIZE);
  const R1 = new Float32Array(SIZE * SIZE);
  const R2 = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const px = (x + 0.5) / cs,
        py = (y + 0.5) / cs;
      const cx = Math.floor(px),
        cy = Math.floor(py);
      let d1 = 1e9,
        best = 0,
        bx = 0,
        by = 0;
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox,
            gy = cy + oy;
          const k = (((gy % cells) + cells) % cells) * cells + (((gx % cells) + cells) % cells);
          const qx = gx + fx[k],
            qy = gy + fy[k];
          const d = (qx - px) * (qx - px) + (qy - py) * (qy - py);
          if (d < d1) {
            d1 = d;
            best = k;
            bx = qx;
            by = qy;
          }
        }
      // exact distance to the nearest Voronoi border (bisector distance)
      let edge = 1e9;
      for (let oy = -2; oy <= 2; oy++)
        for (let ox = -2; ox <= 2; ox++) {
          const gx = cx + ox,
            gy = cy + oy;
          const k = (((gy % cells) + cells) % cells) * cells + (((gx % cells) + cells) % cells);
          const qx = gx + fx[k],
            qy = gy + fy[k];
          if (Math.abs(qx - bx) < 1e-6 && Math.abs(qy - by) < 1e-6) continue;
          let nx = qx - bx,
            ny = qy - by;
          const nl = Math.hypot(nx, ny) || 1;
          nx /= nl;
          ny /= nl;
          const dd = ((bx + qx) * 0.5 - px) * nx + ((by + qy) * 0.5 - py) * ny;
          if (dd < edge) edge = dd;
        }
      const i = y * SIZE + x;
      F1[i] = Math.min(1, Math.sqrt(d1) / 0.75);
      E[i] = Math.min(1, Math.max(0, edge) / 0.5);
      R1[i] = r1[best];
      R2[i] = r2[best];
    }
  }
  return { F1, E, R1, R2 };
}

function pack(channels) {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) {
    for (let c = 0; c < 4; c++) data[i * 4 + c] = Math.max(0, Math.min(255, Math.round(channels[c][i] * 255)));
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

let cached = null;
// Returns { noise, cells } (generated once, shared).
export function getNoiseTextures() {
  if (cached) return cached;
  const rand = mulberry32(0x5eed1e);
  const R = fbmChannel(rand, 4, 5, 0.5);
  const G = fbmChannel(rand, 8, 5, 0.55);
  const B = fbmChannel(rand, 8, 3, 0.5, true);
  const A = fbmChannel(rand, 32, 2, 0.5);
  const noise = pack([R, G, B, A]);
  const w = worley(rand, 16);
  const cells = pack([w.F1, w.E, w.R1, w.R2]);
  cached = { noise, cells };
  return cached;
}
