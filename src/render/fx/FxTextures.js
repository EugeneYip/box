import * as THREE from 'three';

// Procedural textures for the effects system. Everything is generated in code
// (typed-array pixel synthesis plus a little Canvas2D for line art).
//
//   particleAtlas  4x4 frames, 256px each. A = coverage mask, R = detail /
//                  heat (flames: hot core = 1), G = second detail channel.
//   rampTexture    256 x RAMP_ROWS colour-over-life gradients (sRGB + alpha)
//   decalAtlas     4x4 frames. R = darkening (multiply decals), G = glow mask
//                  (additive decals), A = coverage.

export const PF = Object.freeze({
  SMOKE0: 0, SMOKE1: 1, SMOKE2: 2, SMOKE3: 3,
  FLAME0: 4, FLAME1: 5, FLAME2: 6, FLAME3: 7,
  GLOW: 8, SPARK: 9, DROP: 10, CHUNK: 11,
  GLINT: 12, LEAF: 13, RING: 14, WISP: 15,
});

export const DF = Object.freeze({
  SCORCH0: 0, SCORCH1: 1, CRATER: 2, CRACK0: 3,
  CRACK1: 4, RING: 5, GLOW: 6, RUNE: 7,
  SPLAT: 8, BLAST: 9, STAIN: 10, LAVASPLAT: 11,
  RIPPLE: 12, SCAR: 13, SOFTDARK: 14, CRACKLINE: 15,
});

// ---- small deterministic noise toolkit -----------------------------------
function makeRng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeValueNoise(seed) {
  const rnd = makeRng(seed);
  const N = 256;
  const perm = new Uint16Array(N * 2);
  const vals = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    perm[i] = i;
    vals[i] = rnd();
  }
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = perm[i];
    perm[i] = perm[j];
    perm[j] = t;
  }
  for (let i = 0; i < N; i++) perm[i + N] = perm[i];
  const lat = (x, y) => vals[perm[(perm[x & 255] + y) & 511] & 255];
  return (x, y) => {
    const xi = Math.floor(x),
      yi = Math.floor(y);
    const fx = x - xi,
      fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx),
      sy = fy * fy * (3 - 2 * fy);
    const a = lat(xi, yi),
      b = lat(xi + 1, yi),
      c = lat(xi, yi + 1),
      d = lat(xi + 1, yi + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}
function fbm(noise, x, y, oct = 4, lac = 2.03, gain = 0.5) {
  let s = 0,
    a = 0.5,
    f = 1,
    n = 0;
  for (let o = 0; o < oct; o++) {
    s += a * noise(x * f + o * 17.3, y * f - o * 9.1);
    n += a;
    a *= gain;
    f *= lac;
  }
  return s / n;
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ---- atlas helpers ---------------------------------------------------------
class Atlas {
  constructor(cell, grid) {
    this.cell = cell;
    this.grid = grid;
    this.size = cell * grid;
    this.data = new Uint8Array(this.size * this.size * 4);
  }
  // fn(u, v, out) with u,v in [-1,1] (v up); out = [r,g,b,a] in 0..1
  paint(frame, fn) {
    const { cell, grid, size, data } = this;
    const cx = (frame % grid) * cell,
      cy = Math.floor(frame / grid) * cell;
    const out = [0, 0, 0, 0];
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const u = ((x + 0.5) / cell) * 2 - 1;
        const v = 1 - ((y + 0.5) / cell) * 2;
        out[0] = out[1] = out[2] = out[3] = 0;
        fn(u, v, out);
        // keep a 2px transparent border so mips do not bleed between frames
        if (x < 2 || y < 2 || x >= cell - 2 || y >= cell - 2) out[3] = 0;
        const i = ((cy + y) * size + cx + x) * 4;
        data[i] = clamp01(out[0]) * 255;
        data[i + 1] = clamp01(out[1]) * 255;
        data[i + 2] = clamp01(out[2]) * 255;
        data[i + 3] = clamp01(out[3]) * 255;
      }
    }
  }
  // Blit an RGBA canvas (cell x cell) into a frame.
  blit(frame, canvas) {
    const { cell, grid, size, data } = this;
    const img = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, cell, cell).data;
    const cx = (frame % grid) * cell,
      cy = Math.floor(frame / grid) * cell;
    for (let y = 0; y < cell; y++)
      for (let x = 0; x < cell; x++) {
        const s = (y * cell + x) * 4;
        const d = ((cy + y) * size + cx + x) * 4;
        const border = x < 2 || y < 2 || x >= cell - 2 || y >= cell - 2;
        data[d] = img[s];
        data[d + 1] = img[s + 1];
        data[d + 2] = img[s + 2];
        data[d + 3] = border ? 0 : img[s + 3];
      }
  }
  texture() {
    const t = new THREE.DataTexture(this.data, this.size, this.size, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.flipY = false;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 4;
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  }
}

function makeCanvas(n) {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  return c;
}

// ---- particle atlas ---------------------------------------------------------
export function createParticleAtlas() {
  const A = new Atlas(256, 4);
  const n1 = makeValueNoise(11),
    n2 = makeValueNoise(23),
    n3 = makeValueNoise(37);

  // Billowy smoke puffs: a soft gaussian body whose edge is eaten away by
  // domain-warped fbm (cauliflower billows). R stores self-shadowing detail
  // (bright billows, darker creases) used by the particle lighting.
  for (let k = 0; k < 4; k++) {
    const ox = k * 13.7,
      oy = k * 7.3;
    A.paint(PF.SMOKE0 + k, (u, v, o) => {
      const wx = fbm(n1, u * 1.4 + ox, v * 1.4 + oy, 3) - 0.5;
      const wy = fbm(n2, u * 1.4 - oy, v * 1.4 + ox, 3) - 0.5;
      const uu = u + wx * 0.45,
        vv = v + wy * 0.45;
      const r2 = uu * uu + vv * vv;
      const billow = fbm(n3, uu * 2.6 + ox, vv * 2.6 + oy, 5);
      const body = Math.exp(-r2 * 2.6);
      let a = body * (0.35 + 1.1 * billow) - 0.12;
      a = clamp01(a * 1.35) * smoothstep(1.0, 0.82, Math.sqrt(u * u + v * v));
      o[3] = a * a * (3 - 2 * a) * 0.92;
      o[0] = clamp01(0.35 + (billow - 0.45) * 1.5 + vv * 0.18);
      o[1] = billow;
    });
  }

  // Flame tongues: teardrop with noise-licked edges, hot core in R.
  for (let k = 0; k < 4; k++) {
    const seed = k * 31.7 + 3;
    A.paint(PF.FLAME0 + k, (u, v, o) => {
      const t = (v + 1) * 0.5; // 0 bottom .. 1 top
      const sway = (fbm(n2, t * 2.2 + seed, seed * 0.3, 3) - 0.5) * 0.55 * t * t;
      const uu = u - sway;
      const lick = fbm(n1, uu * 2.5 + seed, t * 3.5 - seed, 4);
      let w = 0.62 * Math.pow(Math.sin(Math.PI * Math.pow(clamp01(t * 1.02), 0.62)), 0.85) * Math.pow(1 - t, 0.18);
      w *= 0.8 + 0.45 * lick;
      const edge = Math.abs(uu) / Math.max(w, 1e-3);
      let a = Math.pow(1 - smoothstep(0.1, 1.0, edge), 1.3);
      a *= 1 - smoothstep(0.7, 1.0, t + (lick - 0.5) * 0.35);
      a *= smoothstep(0.0, 0.12, t);
      // break the upper half into separate tongues
      const tongues = smoothstep(0.32, 0.62, fbm(n3, uu * 3.2 + seed, t * 2.6 - seed * 0.5, 3) + (1 - t) * 0.5);
      a *= tongues;
      o[3] = clamp01(a * 1.15);
      const core = clamp01(1 - edge) * clamp01(1.15 - t * 1.1);
      o[0] = clamp01(core * 1.2 * (0.75 + 0.5 * lick));
      o[1] = lick;
    });
  }

  A.paint(PF.GLOW, (u, v, o) => {
    const r2 = u * u + v * v;
    o[3] = Math.exp(-r2 * 4.5) * smoothstep(1, 0.85, Math.sqrt(r2));
    o[0] = Math.exp(-r2 * 9);
    o[1] = 1;
  });
  A.paint(PF.SPARK, (u, v, o) => {
    const r2 = u * u + v * v;
    o[3] = clamp01(Math.exp(-r2 * 26) + 0.35 * Math.exp(-r2 * 6)) * smoothstep(1, 0.8, Math.sqrt(r2));
    o[0] = Math.exp(-r2 * 30);
    o[1] = 1;
  });
  // Droplet: rounded bottom, tapered top, specular highlight in R.
  A.paint(PF.DROP, (u, v, o) => {
    const t = (v + 1) * 0.5;
    const w = t < 0.4 ? Math.sqrt(Math.max(0, 1 - Math.pow((0.4 - t) / 0.4, 2))) * 0.55 : 0.55 * Math.pow(1 - (t - 0.4) / 0.6, 1.4);
    const e = Math.abs(u) / Math.max(w, 1e-3);
    o[3] = (1 - smoothstep(0.75, 1, e)) * smoothstep(0.02, 0.08, t);
    const hx = u + 0.18,
      hy = t - 0.28;
    o[0] = clamp01(0.55 + 0.45 * Math.exp(-(hx * hx + hy * hy) * 60) - e * 0.25);
    o[1] = 1;
  });
  // Debris chunk: faceted polygon silhouette with per-facet shading.
  {
    const rnd = makeRng(99);
    const pts = [];
    const nv = 7;
    for (let i = 0; i < nv; i++) {
      const a = (i / nv) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
      const r = 0.55 + rnd() * 0.35;
      pts.push([Math.cos(a) * r, Math.sin(a) * r, 0.35 + rnd() * 0.65]);
    }
    A.paint(PF.CHUNK, (u, v, o) => {
      const a = Math.atan2(v, u);
      let ai = Math.floor(((a < 0 ? a + Math.PI * 2 : a) / (Math.PI * 2)) * nv) % nv;
      // find containing wedge precisely by angle ordering
      for (let k = 0; k < nv; k++) {
        const p0 = pts[k],
          p1 = pts[(k + 1) % nv];
        const c0 = p0[0] * v - p0[1] * u,
          c1 = p1[0] * v - p1[1] * u;
        if (c0 >= 0 && c1 <= 0) {
          ai = k;
          break;
        }
      }
      const p0 = pts[ai],
        p1 = pts[(ai + 1) % nv];
      // inside test against edge p0->p1
      const ex = p1[0] - p0[0],
        ey = p1[1] - p0[1];
      const side = ex * (v - p0[1]) - ey * (u - p0[0]);
      const len = Math.hypot(ex, ey);
      const dist = side / len; // >0 inside (CCW)
      o[3] = smoothstep(-0.01, 0.04, dist);
      o[0] = clamp01(p0[2] * (0.75 + 0.25 * smoothstep(0, 0.25, dist)) + (fbm(n1, u * 8, v * 8, 2) - 0.5) * 0.3);
      o[1] = 1;
    });
  }
  A.paint(PF.GLINT, (u, v, o) => {
    const ax = Math.abs(u),
      ay = Math.abs(v);
    const r2 = u * u + v * v;
    const star = Math.exp(-ax * 22) * Math.exp(-ay * 2.6) + Math.exp(-ay * 22) * Math.exp(-ax * 2.6);
    const diag = 0.35 * (Math.exp(-Math.abs(u - v) * 18) + Math.exp(-Math.abs(u + v) * 18)) * Math.exp(-r2 * 6);
    o[3] = clamp01(star + diag + Math.exp(-r2 * 30)) * smoothstep(1, 0.8, Math.sqrt(r2));
    o[0] = Math.exp(-r2 * 25);
    o[1] = 1;
  });
  A.paint(PF.LEAF, (u, v, o) => {
    // diagonal leaf with a midrib
    const c = Math.SQRT1_2;
    const x = (u + v) * c,
      y = (v - u) * c; // y along the leaf
    const t = (y + 0.85) / 1.7;
    const w = 0.36 * Math.pow(Math.sin(Math.PI * clamp01(t)), 0.8);
    const e = Math.abs(x) / Math.max(w, 1e-3);
    o[3] = (1 - smoothstep(0.8, 1, e)) * (t > 0 && t < 1 ? 1 : 0);
    o[0] = clamp01(0.7 + 0.3 * (1 - e) - 0.35 * Math.exp(-x * x * 900) + (fbm(n2, u * 6, v * 6, 2) - 0.5) * 0.2);
    o[1] = 1;
  });
  A.paint(PF.RING, (u, v, o) => {
    const r = Math.hypot(u, v);
    const d = (r - 0.78) / 0.085;
    o[3] = Math.exp(-d * d) + 0.25 * Math.exp(-(((r - 0.7) / 0.2) ** 2)) * (r < 0.78 ? 1 : 0);
    o[0] = Math.exp(-d * d * 2);
    o[1] = 1;
  });
  A.paint(PF.WISP, (u, v, o) => {
    const streak = fbm(n3, u * 6, v * 1.2, 3);
    const a = Math.exp(-(u * u) / 0.12) * Math.exp(-(v * v) / 0.55) * (0.45 + 0.75 * streak);
    o[3] = clamp01(a) * smoothstep(1, 0.8, Math.max(Math.abs(u), Math.abs(v)));
    o[0] = streak;
    o[1] = 1;
  });
  return A.texture();
}

// ---- colour ramps -----------------------------------------------------------
// Each ramp: list of [t, hexColour, alpha].
export const RAMP = {};
const RAMP_DEFS = [
  ['WHITE', [[0, 0xffffff, 0], [0.06, 0xffffff, 1], [0.6, 0xffffff, 0.85], [1, 0xffffff, 0]]],
  ['FIRE', [[0, 0xffc870, 0], [0.06, 0xffaa48, 0.85], [0.2, 0xff7420, 0.88], [0.42, 0xe8460e, 0.78], [0.65, 0xaa220a, 0.5], [0.85, 0x4a1006, 0.18], [1, 0x200804, 0]]],
  ['EMBER', [[0, 0xfff4d0, 1], [0.25, 0xffc050, 1], [0.6, 0xff6a14, 0.9], [0.85, 0xb02808, 0.5], [1, 0x400800, 0]]],
  ['SMOKE_DARK', [[0, 0x625a54, 0], [0.08, 0x5e5650, 0.6], [0.4, 0x6e6862, 0.5], [0.75, 0x86817c, 0.28], [1, 0x96928e, 0]]],
  ['SMOKE_LIGHT', [[0, 0xd0ccc4, 0], [0.08, 0xd0ccc4, 0.55], [0.5, 0xdcd8d2, 0.35], [1, 0xe6e3de, 0]]],
  ['FIRE_SMOKE', [[0, 0xffa050, 0], [0.04, 0xa8704c, 0.6], [0.12, 0x6c5c52, 0.78], [0.4, 0x7a726a, 0.7], [0.7, 0x908a84, 0.42], [1, 0xa6a29e, 0]]],
  ['DUST', [[0, 0xc8b08a, 0], [0.08, 0xc0a882, 0.65], [0.55, 0xb09a7c, 0.35], [1, 0xa89680, 0]]],
  ['STEAM', [[0, 0xffffff, 0], [0.06, 0xf8fbff, 0.72], [0.45, 0xf0f4f8, 0.5], [1, 0xeef2f6, 0]]],
  ['ELECTRIC', [[0, 0xffffff, 1], [0.25, 0xd0e6ff, 1], [0.6, 0x80b0ff, 0.7], [1, 0x3050ff, 0]]],
  ['MAGIC', [[0, 0xffffff, 0], [0.08, 0xf4eaff, 1], [0.35, 0xc8a8ff, 0.9], [0.7, 0x7a58ff, 0.5], [1, 0x3a20b0, 0]]],
  ['HEAL', [[0, 0xffffff, 0], [0.1, 0xf0ffe0, 1], [0.45, 0xb8f080, 0.8], [1, 0x50c060, 0]]],
  ['BLOOD', [[0, 0xb01818, 1], [0.6, 0x8a0c0c, 1], [1, 0x600808, 0]]],
  ['MIASMA', [[0, 0xa8d040, 0], [0.12, 0x8aa838, 0.45], [0.55, 0x627e2a, 0.3], [1, 0x445a20, 0]]],
  ['EXPLOSION', [[0, 0xffffff, 1], [0.08, 0xfff4c0, 1], [0.25, 0xffb040, 0.95], [0.5, 0xe05514, 0.7], [0.75, 0x902a0c, 0.35], [1, 0x301008, 0]]],
  ['WATER', [[0, 0xffffff, 0.95], [0.5, 0xe0f4ff, 0.85], [1, 0xb0dcf4, 0]]],
  ['SOLID', [[0, 0xffffff, 1], [0.75, 0xffffff, 1], [1, 0xffffff, 0]]],
  ['GOLD', [[0, 0xffffff, 0], [0.06, 0xfffbe8, 1], [0.3, 0xffe9a0, 1], [0.7, 0xffc040, 0.6], [1, 0xa06010, 0]]],
  ['ASH', [[0, 0x6a6460, 0], [0.15, 0x6a6460, 0.8], [0.8, 0x5a5652, 0.7], [1, 0x5a5652, 0]]],
  ['LAVA', [[0, 0xfff0a0, 1], [0.2, 0xffa830, 1], [0.55, 0xff4a08, 0.9], [0.85, 0x901000, 0.45], [1, 0x400000, 0]]],
  ['FLASH', [[0, 0xffffff, 1], [0.3, 0xffffff, 0.6], [1, 0xffffff, 0]]],
  ['SHOCK', [[0, 0xffffff, 0.95], [0.25, 0xfff0c8, 0.7], [0.6, 0xffb070, 0.35], [1, 0xff8040, 0]]],
  ['PLAGUE_GLOW', [[0, 0xe0ff80, 0], [0.1, 0xc8f060, 0.9], [0.6, 0x88c030, 0.5], [1, 0x406010, 0]]],
  ['BUILD', [[0, 0xfff8e0, 0], [0.1, 0xf0e2b8, 0.75], [0.6, 0xe0cca0, 0.4], [1, 0xd8c090, 0]]],
  ['SNOW', [[0, 0xffffff, 0], [0.06, 0xffffff, 1], [0.7, 0xf4f8ff, 0.85], [1, 0xf0f6ff, 0]]],
  ['SMOKE_BLACK', [[0, 0x221c18, 0], [0.04, 0x241e1a, 0.92], [0.4, 0x2e2824, 0.86], [0.75, 0x3e3935, 0.5], [1, 0x4a4541, 0]]],
  ['DEATH', [[0, 0xffffff, 0], [0.1, 0xe8e4f0, 0.7], [0.5, 0xb0a8c0, 0.4], [1, 0x807890, 0]]],
  ['SPLASH', [[0, 0xffffff, 0], [0.04, 0xffffff, 0.95], [0.4, 0xeaf6ff, 0.75], [1, 0xd8eefa, 0]]],
  ['HOT_SMOKE', [[0, 0xffd080, 0], [0.04, 0xff9a40, 0.6], [0.14, 0x84543c, 0.65], [0.4, 0x4e4642, 0.58], [0.75, 0x625c58, 0.3], [1, 0x6e6a66, 0]]],
  // alpha-blended fireball: hot shell over a dark sooty core
  ['FIREBALL', [[0, 0xffe2a0, 0.9], [0.06, 0xffa238, 1], [0.16, 0xe0561a, 1], [0.3, 0x6a2a14, 0.97], [0.5, 0x2e221e, 0.92], [0.78, 0x3c3632, 0.6], [1, 0x4a4542, 0]]],
  ['DUST_THICK', [[0, 0xb49c7c, 0], [0.04, 0xae9676, 0.92], [0.45, 0xa48e72, 0.78], [0.8, 0x9e8c76, 0.4], [1, 0x9a8a78, 0]]],
  // fire plume: dark grey at the base, lightening as it rises and thins
  ['PLUME', [[0, 0x3a302a, 0], [0.04, 0x3e3430, 0.85], [0.25, 0x5a524c, 0.85], [0.55, 0x7e7872, 0.68], [0.8, 0x9a9590, 0.38], [1, 0xaaa6a2, 0]]],
  ['FIRE_DEEP', [[0, 0xff9a40, 0], [0.08, 0xff7a24, 0.8], [0.3, 0xe04a10, 0.8], [0.6, 0x9a1e08, 0.5], [1, 0x300804, 0]]],
];
export const RAMP_ROWS = 32;
RAMP_DEFS.forEach(([name], i) => (RAMP[name] = i));

export function createRampTexture() {
  const W = 256;
  const data = new Uint8Array(W * RAMP_ROWS * 4);
  const c0 = new THREE.Color(),
    c1 = new THREE.Color();
  RAMP_DEFS.forEach(([, stops], row) => {
    for (let x = 0; x < W; x++) {
      const t = x / (W - 1);
      let k = 0;
      while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
      const s0 = stops[k],
        s1 = stops[k + 1];
      const f = clamp01((t - s0[0]) / Math.max(1e-5, s1[0] - s0[0]));
      c0.setHex(s0[1], THREE.LinearSRGBColorSpace); // raw sRGB bytes (texture decodes)
      c1.setHex(s1[1], THREE.LinearSRGBColorSpace);
      // interpolate in sRGB (the texture is decoded to linear on the GPU)
      const i = (row * W + x) * 4;
      data[i] = Math.round((c0.r + (c1.r - c0.r) * f) * 255);
      data[i + 1] = Math.round((c0.g + (c1.g - c0.g) * f) * 255);
      data[i + 2] = Math.round((c0.b + (c1.b - c0.b) * f) * 255);
      data[i + 3] = Math.round((s0[2] + (s1[2] - s0[2]) * f) * 255);
    }
  });
  const t = new THREE.DataTexture(data, W, RAMP_ROWS, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

// ---- decal atlas ------------------------------------------------------------
export function createDecalAtlas() {
  const A = new Atlas(256, 4);
  const n1 = makeValueNoise(5),
    n2 = makeValueNoise(77),
    n3 = makeValueNoise(141);

  const scorch = (frame, seed) =>
    A.paint(frame, (u, v, o) => {
      const r = Math.hypot(u, v);
      const ang = Math.atan2(v, u);
      const edgeN = fbm(n1, Math.cos(ang) * 1.6 + seed, Math.sin(ang) * 1.6 - seed, 4);
      const rays = Math.pow(Math.abs(Math.sin(ang * 7 + edgeN * 6 + seed)), 6) * 0.25;
      const reach = 0.62 + (edgeN - 0.5) * 0.5 + rays;
      const body = 1 - smoothstep(reach * 0.45, reach, r);
      const grain = fbm(n2, u * 7 + seed, v * 7, 4);
      o[3] = clamp01(body * (0.75 + 0.5 * grain));
      o[0] = clamp01(body * (0.65 + 0.45 * grain) + (1 - smoothstep(0, 0.35, r)) * 0.2);
      o[1] = clamp01((1 - smoothstep(0.0, reach * 0.6, r)) * smoothstep(0.45, 0.7, grain));
    });
  scorch(DF.SCORCH0, 1.3);
  scorch(DF.SCORCH1, 7.9);

  // Crater: dark bowl, bright-ish rim band (less darkening), radial ejecta.
  A.paint(DF.CRATER, (u, v, o) => {
    const r = Math.hypot(u, v);
    const ang = Math.atan2(v, u);
    const en = fbm(n1, Math.cos(ang) * 2 + 3, Math.sin(ang) * 2 - 1, 4);
    const ray = Math.pow(Math.abs(Math.sin(ang * 11 + en * 5)), 8) * smoothstep(0.35, 0.55, r) * (1 - smoothstep(0.6, 0.98, r));
    const bowl = 1 - smoothstep(0.3, 0.46 + (en - 0.5) * 0.1, r);
    const rim = Math.exp(-(((r - 0.5) / 0.08) ** 2));
    const ejecta = (1 - smoothstep(0.45, 0.95 + (en - 0.5) * 0.2, r)) * (0.35 + 0.65 * fbm(n2, u * 6, v * 6, 3));
    const grain = fbm(n3, u * 10, v * 10, 3);
    o[3] = clamp01(Math.max(bowl, ejecta * 0.85 + ray * 0.6) * (0.8 + 0.3 * grain));
    o[0] = clamp01(bowl * (0.85 + 0.2 * grain) + ejecta * 0.45 + ray * 0.4 - rim * 0.25);
    o[1] = clamp01((1 - smoothstep(0.05, 0.4, r)) * (0.5 + 0.7 * fbm(n2, u * 5 + 9, v * 5, 3)) + rim * 0.35);
  });

  // Cracks drawn with Canvas2D (branching random walks) then blurred a touch.
  const crack = (frame, seed, lineMode = false) => {
    const S = 256;
    const cv = makeCanvas(S);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const rnd = makeRng(seed);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const branch = (x, y, ang, len, width, depth) => {
      ctx.beginPath();
      ctx.moveTo(x, y);
      const steps = Math.ceil(len / 6);
      for (let i = 0; i < steps; i++) {
        ang += (rnd() - 0.5) * 0.9;
        x += Math.cos(ang) * 6;
        y += Math.sin(ang) * 6;
        ctx.lineTo(x, y);
        if (depth < 3 && rnd() < 0.12) {
          ctx.lineWidth = width;
          ctx.stroke();
          branch(x, y, ang + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.7), len * (0.35 + rnd() * 0.3), width * 0.6, depth + 1);
          ctx.beginPath();
          ctx.moveTo(x, y);
        }
      }
      ctx.lineWidth = width;
      ctx.stroke();
    };
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    if (lineMode) {
      // a gaping chasm crossing the frame horizontally: a thick band with
      // jagged lips (about a third of the frame wide) plus hairline cracks
      // branching off both lips
      ctx.fillStyle = 'rgba(255,255,255,1)';
      const top = [],
        bot = [];
      let wt = 30,
        wb = 30,
        mid = S / 2;
      for (let x = -4; x <= S + 4; x += 6) {
        wt = Math.max(16, Math.min(46, wt + (rnd() - 0.5) * 14));
        wb = Math.max(16, Math.min(46, wb + (rnd() - 0.5) * 14));
        mid += (rnd() - 0.5) * 4;
        mid = Math.max(S / 2 - 10, Math.min(S / 2 + 10, mid));
        top.push([x, mid - wt]);
        bot.push([x, mid + wb]);
      }
      ctx.beginPath();
      ctx.moveTo(top[0][0], top[0][1]);
      for (const p of top) ctx.lineTo(p[0], p[1]);
      for (let k = bot.length - 1; k >= 0; k--) ctx.lineTo(bot[k][0], bot[k][1]);
      ctx.closePath();
      ctx.fill();
      for (let k = 0; k < 7; k++) {
        const p = (rnd() < 0.5 ? top : bot)[1 + ((rnd() * (top.length - 2)) | 0)];
        branch(p[0], p[1], (p[1] < S / 2 ? -1 : 1) * (Math.PI / 2 + (rnd() - 0.5) * 1.2), 30 + rnd() * 40, 4, 2);
      }
    } else {
      const n = 6;
      for (let i = 0; i < n; i++) branch(S / 2, S / 2, (i / n) * Math.PI * 2 + rnd() * 0.6, 70 + rnd() * 50, 5 - i * 0.3, 0);
    }
    // soft blur pass to create a dark halo (second channel)
    const sharp = ctx.getImageData(0, 0, S, S).data;
    ctx.filter = 'blur(5px)';
    ctx.drawImage(cv, 0, 0);
    const blurred = ctx.getImageData(0, 0, S, S).data;
    A.paint(frame, (u, v, o) => {
      const x = Math.min(S - 1, Math.floor(((u + 1) / 2) * S));
      const y = Math.min(S - 1, Math.floor(((1 - v) / 2) * S));
      const i = (y * S + x) * 4 + 3;
      const s = sharp[i] / 255,
        b = blurred[i] / 255;
      const fade = lineMode ? 1 - smoothstep(0.9, 1, Math.abs(u)) : 1 - smoothstep(0.7, 1, Math.hypot(u, v));
      o[3] = clamp01((s + b * 0.6) * fade);
      o[0] = clamp01(s * 0.95 + b * 0.35);
      o[1] = clamp01(s);
    });
  };
  crack(DF.CRACK0, 1234);
  crack(DF.CRACK1, 98765);
  crack(DF.CRACKLINE, 4242, true);

  A.paint(DF.RING, (u, v, o) => {
    const r = Math.hypot(u, v);
    const d = (r - 0.82) / 0.07;
    const inner = smoothstep(0.3, 0.82, r) * (r < 0.82 ? 1 : 0) * 0.35;
    o[3] = clamp01(Math.exp(-d * d) + inner);
    o[0] = o[3] * 0.5;
    o[1] = clamp01(Math.exp(-d * d) + inner * 0.6);
  });
  A.paint(DF.GLOW, (u, v, o) => {
    const r2 = u * u + v * v;
    o[3] = Math.exp(-r2 * 3.2) * smoothstep(1, 0.8, Math.sqrt(r2));
    o[0] = o[3];
    o[1] = o[3];
  });
  // Rune circle: an original sigil of concentric rings, ticks and nodes.
  {
    const S = 256;
    const cv = makeCanvas(S);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.translate(S / 2, S / 2);
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    const ring = (r, w) => {
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    };
    ring(118, 4);
    ring(106, 2);
    ring(64, 3);
    ring(40, 2);
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const l = i % 4 === 0 ? 12 : 5;
      ctx.lineWidth = i % 4 === 0 ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 106, Math.sin(a) * 106);
      ctx.lineTo(Math.cos(a) * (106 - l), Math.sin(a) * (106 - l));
      ctx.stroke();
    }
    // interlaced triangles
    for (let k = 0; k < 2; k++) {
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i <= 3; i++) {
        const a = (i / 3) * Math.PI * 2 + k * Math.PI + Math.PI / 2;
        const x = Math.cos(a) * 100,
          y = Math.sin(a) * 100;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 82, Math.sin(a) * 82, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fill();
    const sharp = ctx.getImageData(0, 0, S, S).data.slice();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = 'blur(4px)';
    ctx.drawImage(cv, 0, 0);
    const blur = ctx.getImageData(0, 0, S, S).data;
    A.paint(DF.RUNE, (u, v, o) => {
      const x = Math.min(S - 1, Math.floor(((u + 1) / 2) * S));
      const y = Math.min(S - 1, Math.floor(((1 - v) / 2) * S));
      const i = (y * S + x) * 4 + 3;
      const s = sharp[i] / 255,
        b = blur[i] / 255;
      o[3] = clamp01(s + b * 0.9);
      o[0] = clamp01(s * 0.6 + b * 0.3);
      o[1] = clamp01(s + b * 0.7);
    });
  }
  // Liquid splat with satellite droplets.
  A.paint(DF.SPLAT, (u, v, o) => {
    const ang = Math.atan2(v, u);
    const r = Math.hypot(u, v);
    const en = fbm(n2, Math.cos(ang) * 2.2 + 5, Math.sin(ang) * 2.2, 3);
    const main = 1 - smoothstep(0.32 + en * 0.25, 0.42 + en * 0.28, r);
    let drops = 0;
    for (let k = 0; k < 9; k++) {
      const a = k * 2.399 + 0.4,
        d = 0.55 + ((k * 0.37) % 0.35);
      const dx = u - Math.cos(a) * d,
        dy = v - Math.sin(a) * d;
      drops = Math.max(drops, 1 - smoothstep(0.03 + (k % 3) * 0.015, 0.06 + (k % 3) * 0.015, Math.hypot(dx, dy)));
    }
    o[3] = Math.max(main, drops);
    o[0] = o[3];
    o[1] = o[3] * (0.6 + 0.4 * en);
  });
  // Blast streaks: radial rays from the centre (explosion burn).
  A.paint(DF.BLAST, (u, v, o) => {
    const r = Math.hypot(u, v);
    const ang = Math.atan2(v, u);
    const rays = fbm(n1, Math.cos(ang) * 6 + 2, Math.sin(ang) * 6 - 2, 3);
    const len = 0.45 + rays * 0.55;
    const body = (1 - smoothstep(len * 0.6, len, r)) * (0.5 + 0.5 * Math.pow(rays, 1.5));
    const core = 1 - smoothstep(0.1, 0.32, r);
    o[3] = clamp01(Math.max(body, core) * (0.8 + 0.3 * fbm(n3, u * 9, v * 9, 3)));
    o[0] = o[3];
    o[1] = clamp01(core * 0.8 + body * 0.3);
  });
  // Blotchy stain (plague / miasma soil discolouration).
  A.paint(DF.STAIN, (u, v, o) => {
    const r = Math.hypot(u, v);
    const b = fbm(n3, u * 2.5 + 4, v * 2.5 - 2, 4);
    const m = (1 - smoothstep(0.35, 0.95, r + (b - 0.5) * 0.7)) * smoothstep(0.38, 0.6, b + 0.1);
    o[3] = m;
    o[0] = m;
    o[1] = m * b;
  });
  // Lava splat: glowing core with crusted ring.
  A.paint(DF.LAVASPLAT, (u, v, o) => {
    const ang = Math.atan2(v, u);
    const r = Math.hypot(u, v);
    const en = fbm(n1, Math.cos(ang) * 2.5, Math.sin(ang) * 2.5 + 7, 3);
    const body = 1 - smoothstep(0.35 + en * 0.3, 0.5 + en * 0.3, r);
    const crust = fbm(n2, u * 8, v * 8, 3);
    o[3] = body;
    o[0] = body * (0.7 + 0.3 * crust);
    o[1] = body * clamp01(1.2 - r * 1.6) * smoothstep(0.35, 0.7, crust + 0.25);
  });
  // Water ripple rings.
  A.paint(DF.RIPPLE, (u, v, o) => {
    const r = Math.hypot(u, v);
    const w = Math.exp(-(((r - 0.8) / 0.05) ** 2)) + 0.5 * Math.exp(-(((r - 0.62) / 0.04) ** 2)) + 0.25 * Math.exp(-(((r - 0.45) / 0.035) ** 2));
    o[3] = clamp01(w);
    o[0] = 0;
    o[1] = clamp01(w);
  });
  // Ground scar / scuff (tornado track, landslide).
  A.paint(DF.SCAR, (u, v, o) => {
    const b = fbm(n2, u * 3 + 1, v * 1.2 + 3, 4);
    const m = Math.exp(-(u * u) / 0.35) * (1 - smoothstep(0.75, 1, Math.abs(v))) * smoothstep(0.3, 0.55, b + 0.1);
    o[3] = clamp01(m * 1.3);
    o[0] = clamp01(m * (0.6 + 0.4 * fbm(n3, u * 9, v * 9, 2)));
    o[1] = 0;
  });
  A.paint(DF.SOFTDARK, (u, v, o) => {
    const r2 = u * u + v * v;
    const m = Math.exp(-r2 * 2.6) * smoothstep(1, 0.75, Math.sqrt(r2));
    o[3] = m;
    o[0] = m * (0.8 + 0.4 * (fbm(n1, u * 5, v * 5, 3) - 0.5));
    o[1] = m;
  });
  return A.texture();
}
