import { WATER_PARS_GLSL } from '../water/waterCommon.js';

// Terrain surface shading, injected into MeshStandardMaterial via
// onBeforeCompile so three.js lighting, shadows and fog keep working.
//
// Per pixel:
//  1. The four tile centres around a noise-warped position are fetched from
//     the type texture and blended with smoothed bilinear weights, sharpened
//     by per-material "height" (height blending) so borders are organic.
//  2. Every material is procedural (shared mip-mapped noise samples).
//  3. Steep slopes blend to faceted, stratified cliff rock (projected on the
//     dominant vertical plane so it never stretches).
//  4. Below sea level the surface grades to seabed (sand -> deep rock),
//     gets caustics, and after lighting the water column tint is applied so
//     the seabed reads correctly through the (mostly clear) water surface.
//  5. Territory overlay (soft tint + crisp glowing borders), cloud shadows,
//     baked large-scale AO, rain wetness, lava / ember emission.

export const TERRAIN_VERTEX_PARS = /* glsl */ `
varying vec3 vWPos;
varying vec3 vWNormal;
`;
export const TERRAIN_VERTEX_MAIN = /* glsl */ `
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNormal = normalize(mat3(modelMatrix) * objectNormal);
`;

export const TERRAIN_FRAGMENT_PARS = /* glsl */ `
varying vec3 vWPos;
varying vec3 vWNormal;
uniform sampler2D uTypeTex;
uniform sampler2D uClimTex;
uniform sampler2D uNoise;
uniform sampler2D uCells;
uniform sampler2D uOverlay;
uniform float uOverlayOn;
uniform vec2 uOverlaySize;
uniform vec3 uTilePalette[32];
${WATER_PARS_GLSL}

// global surface outputs (set in terrainSurface)
vec3 tAlbedo;
float tRough;
vec3 tNormalW;
vec3 tEmissive;
float tAO;
float tCloud;
float tSpecK;

const mat2 ROT1 = mat2(0.80, -0.60, 0.60, 0.80);
const mat2 ROT2 = mat2(0.28, 0.96, -0.96, 0.28);
const mat2 ROT3 = mat2(-0.53, 0.85, -0.85, -0.53);

vec4 nz(vec2 p) { return texture2D(uNoise, p); }
vec4 cz(vec2 p) { return texture2D(uCells, p); }
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float tileTypeAt(ivec2 c) {
  ivec2 sz = ivec2(uWorldSize);
  c = clamp(c, ivec2(0), sz - 1);
  return floor(texelFetch(uTypeTex, c, 0).r * 255.0 + 0.5);
}

struct NS {
  vec3 p; vec3 n;
  vec4 macro; vec4 meso; vec4 det; vec4 micro;
  vec4 cellS; vec4 cellL;
  float moist; float temp; float ao; float fire;
  float fw;   // world-space pixel footprint
};

struct Mat { vec3 albedo; float rough; float h; float bump; vec3 emit; };

Mat mk(vec3 a, float r, float h, float b) { Mat m; m.albedo = a; m.rough = r; m.h = h; m.bump = b; m.emit = vec3(0.0); return m; }

// ---------------------------------------------------------------- materials
Mat matSand(NS s) {
  // fine wind ripples, slightly warped
  vec2 q = s.p.xz + (s.meso.rg - 0.5) * 3.0;
  float rip = sin(dot(q, vec2(2.3, 1.1)) * 2.6 + s.det.r * 5.0) * 0.5 + 0.5;
  float ripFade = 1.0 - smoothstep(0.05, 0.25, s.fw);
  vec3 c = vec3(0.70, 0.56, 0.33);
  c = mix(c, vec3(0.80, 0.67, 0.43), s.macro.r * 0.6);
  c *= 0.90 + 0.14 * s.det.g + 0.08 * (s.micro.a - 0.5);
  c *= 1.0 - 0.06 * rip * ripFade;
  // scattered shell / pebble specks
  float speck = smoothstep(0.10, 0.04, s.cellS.r) * step(0.82, s.cellS.b);
  c = mix(c, vec3(0.85, 0.80, 0.70), speck * 0.6 * ripFade);
  return mk(c, 0.92, 0.18 + 0.10 * s.det.r, 0.035 + 0.02 * rip * ripFade);
}
Mat matDesert(NS s) {
  // big dune bands + ripples on top
  vec2 q = s.p.xz + (s.macro.rg - 0.5) * 18.0;
  float dune = sin(dot(q, vec2(0.21, 0.13)) + s.meso.r * 3.0) * 0.5 + 0.5;
  float ripFade = 1.0 - smoothstep(0.05, 0.25, s.fw);
  float rip = sin(dot(s.p.xz + (s.meso.gb - 0.5) * 4.0, vec2(1.9, 2.6)) * 2.2) * 0.5 + 0.5;
  vec3 c = mix(vec3(0.58, 0.36, 0.16), vec3(0.74, 0.50, 0.25), dune);
  c *= 0.90 + 0.16 * s.det.r;
  c *= 1.0 - 0.07 * rip * ripFade;
  return mk(c, 0.95, 0.22 + 0.15 * dune, 0.05 + 0.03 * rip * ripFade);
}
Mat matGrass(NS s) {
  vec3 lush = vec3(0.085, 0.340, 0.040);
  vec3 dry = vec3(0.230, 0.330, 0.060);
  vec3 cold = vec3(0.090, 0.250, 0.100);
  vec3 c = mix(dry, lush, smoothstep(0.22, 0.72, s.moist));
  c = mix(cold, c, smoothstep(0.18, 0.48, s.temp));
  // soft meadow patches (sunny yellow-green / deeper green)
  float patchv = s.macro.r * 0.65 + s.meso.g * 0.35;
  c *= 0.80 + 0.40 * patchv;
  c = mix(c, c * vec3(1.22, 1.12, 0.70), smoothstep(0.60, 0.88, s.meso.r) * 0.40);
  c = mix(c, c * vec3(0.70, 0.95, 0.95), smoothstep(0.62, 0.9, s.macro.g) * 0.4);
  // clumps & blades (fine detail fades in up close)
  float near = 1.0 - smoothstep(0.03, 0.16, s.fw);
  float clump = s.det.r * 0.55 + s.micro.r * 0.45;
  float blade = s.micro.a;
  float tuft = smoothstep(0.6, 0.1, s.cellS.r);
  c *= 0.80 + 0.36 * clump + (blade - 0.5) * mix(0.10, 0.34, near);
  c *= mix(1.0, 0.86 + 0.24 * tuft, near);
  // tiny bright flower / seed specks at close range
  float nearS = 1.0 - smoothstep(0.03, 0.12, s.fw);
  float speck = smoothstep(0.12, 0.05, s.cellS.r) * step(0.90, s.cellS.a) * nearS;
  c = mix(c, mix(vec3(0.9, 0.85, 0.35), vec3(0.85, 0.55, 0.7), s.cellS.b), speck * 0.7);
  return mk(c, 0.86, 0.38 + 0.45 * clump, 0.05 + 0.05 * near * tuft);
}
Mat matForest(NS s) {
  vec3 c = vec3(0.060, 0.155, 0.040);
  float moss = smoothstep(0.35, 0.75, s.meso.g * 0.6 + s.det.r * 0.4);
  c = mix(c, vec3(0.105, 0.215, 0.040), moss);
  // leaf litter
  float litter = smoothstep(0.58, 0.78, s.det.g * 0.6 + s.micro.r * 0.4);
  c = mix(c, vec3(0.140, 0.090, 0.040), litter * 0.75);
  c = mix(c, c * vec3(0.8, 1.05, 1.1), smoothstep(0.2, 0.7, s.temp) * 0.0 + (1.0 - smoothstep(0.2, 0.45, s.temp)) * 0.4);
  c *= 0.82 + 0.30 * s.macro.r;
  c *= 0.88 + 0.22 * s.micro.a;
  return mk(c, 0.90, 0.48 + 0.4 * moss, 0.06);
}
Mat matJungle(NS s) {
  vec3 c = vec3(0.030, 0.165, 0.060);
  float v = s.meso.r * 0.5 + s.det.g * 0.5;
  c = mix(c, vec3(0.060, 0.230, 0.050), smoothstep(0.4, 0.8, v));
  c = mix(c, vec3(0.020, 0.120, 0.075), smoothstep(0.55, 0.85, s.macro.g) * 0.6);
  c *= 0.82 + 0.3 * s.micro.r;
  // wet dark humus spots
  float humus = smoothstep(0.62, 0.80, s.det.r);
  c = mix(c, vec3(0.06, 0.05, 0.025), humus * 0.45);
  return mk(c, 0.75, 0.5 + 0.35 * v, 0.06);
}
Mat matSavanna(NS s) {
  vec3 gold = vec3(0.520, 0.380, 0.120);
  vec3 olive = vec3(0.300, 0.285, 0.090);
  float v = s.macro.r * 0.5 + s.meso.g * 0.5;
  vec3 c = mix(gold, olive, smoothstep(0.45, 0.85, v + (s.moist - 0.4) * 0.5));
  // bare red soil patches
  float bare = smoothstep(0.66, 0.84, s.meso.r * 0.7 + s.det.g * 0.3);
  c = mix(c, vec3(0.38, 0.20, 0.09), bare * 0.7);
  // dry grass tufts (isotropic cells) and fine straw noise up close
  float near = 1.0 - smoothstep(0.03, 0.16, s.fw);
  float tuft = smoothstep(0.55, 0.15, s.cellS.r) * (0.6 + 0.4 * s.cellS.b);
  c *= 0.84 + 0.26 * s.det.r;
  c = mix(c, c * mix(vec3(1.18, 1.10, 0.85), vec3(0.78, 0.74, 0.62), s.cellS.a), tuft * 0.45 * near);
  c *= 1.0 + (s.micro.a - 0.5) * 0.30 * near;
  return mk(c, 0.92, 0.36 + 0.35 * s.det.r + tuft * 0.25 * near, 0.05 + 0.05 * tuft * near);
}
Mat matSwamp(NS s) {
  vec3 mud = vec3(0.090, 0.085, 0.045);
  vec3 moss = vec3(0.085, 0.140, 0.040);
  float v = s.meso.g * 0.6 + s.det.r * 0.4;
  vec3 c = mix(mud, moss, smoothstep(0.35, 0.7, v));
  c *= 0.85 + 0.25 * s.micro.r;
  // puddles of standing water
  float pud = smoothstep(0.40, 0.33, s.meso.r * 0.7 + s.det.g * 0.3);
  vec3 water = vec3(0.030, 0.050, 0.040);
  c = mix(c, water, pud * 0.85);
  Mat m = mk(c, mix(0.82, 0.08, pud), mix(0.42 + 0.3 * v, 0.05, pud), mix(0.05, 0.0, pud));
  return m;
}
Mat matTundra(NS s) {
  vec3 c = vec3(0.200, 0.235, 0.120);
  float lichen = smoothstep(0.5, 0.75, s.det.r * 0.6 + s.micro.r * 0.4);
  c = mix(c, vec3(0.40, 0.31, 0.15), lichen * 0.55);
  c = mix(c, vec3(0.30, 0.16, 0.10), smoothstep(0.62, 0.8, s.meso.g) * 0.35);
  float frost = smoothstep(0.70, 0.90, s.meso.r);
  c = mix(c, vec3(0.62, 0.66, 0.68), frost * 0.30);
  float stones = smoothstep(0.16, 0.08, s.cellS.r) * step(0.6, s.cellS.b);
  c = mix(c, vec3(0.32, 0.31, 0.30) * (0.8 + 0.4 * s.cellS.a), stones);
  c *= 0.86 + 0.24 * s.macro.g;
  return mk(c, 0.90, 0.40 + 0.3 * lichen + stones * 0.3, 0.05 + stones * 0.04);
}
Mat matSnow(NS s) {
  vec3 c = vec3(0.80, 0.84, 0.90);
  // soft blue in hollows and wind drifts
  float drift = s.meso.r * 0.6 + s.det.g * 0.4;
  c = mix(vec3(0.58, 0.66, 0.80), c, smoothstep(0.25, 0.65, drift));
  c *= 0.94 + 0.08 * s.micro.r;
  return mk(c, 0.62, 0.55 + 0.3 * drift, 0.06);
}
Mat matRock(NS s) {
  vec3 warm = vec3(0.340, 0.300, 0.255);
  vec3 cool = vec3(0.280, 0.285, 0.290);
  vec3 c = mix(warm, cool, s.macro.g);
  // slabs with crack seams
  float seam = smoothstep(0.0, 0.10, s.cellL.g);
  c *= 0.75 + 0.35 * s.cellL.b;
  c *= 0.55 + 0.45 * seam;
  c *= 0.85 + 0.25 * s.det.r;
  // lichen flecks
  float lich = smoothstep(0.72, 0.86, s.det.g) * (1.0 - smoothstep(0.3, 0.6, 1.0 - s.n.y));
  c = mix(c, vec3(0.30, 0.30, 0.16), lich * 0.5);
  return mk(c, 0.80, 0.62 + 0.3 * s.cellL.b, 0.10 * seam + 0.05);
}
Mat matLava(NS s) {
  float t = uLTime;
  // slowly drifting crust plates with glowing seams
  vec2 flow = vec2(t * 0.045, t * 0.02);
  vec2 wq = s.p.xz + (nz(s.p.xz * 0.04 + flow * 0.3).rg - 0.5) * 3.0;
  vec4 crust = cz(ROT1 * (wq + flow) * (1.0 / 22.0));
  vec4 crust2 = cz(ROT2 * (wq - flow * 0.7) * (1.0 / 9.0));
  float seam = 1.0 - smoothstep(0.0, 0.16, crust.g);
  float seam2 = 1.0 - smoothstep(0.0, 0.10, crust2.g);
  float pulse = 0.75 + 0.25 * sin(t * 1.7 + crust.b * 6.28) * sin(t * 0.9 + s.meso.r * 9.0);
  float molten = smoothstep(0.55, 0.85, nz(wq * 0.07 + flow * 0.5).r);
  float glow = clamp(seam * 0.9 + seam2 * 0.45 + molten * 0.85, 0.0, 1.0) * pulse;
  vec3 crustCol = mix(vec3(0.040, 0.028, 0.022), vec3(0.11, 0.06, 0.04), crust.b);
  vec3 hot = mix(vec3(1.0, 0.22, 0.02), vec3(1.0, 0.65, 0.18), glow * glow);
  Mat m = mk(mix(crustCol, hot * 0.6, glow), mix(0.85, 0.4, glow), 0.30 + 0.25 * (1.0 - seam), 0.08 * (1.0 - glow));
  m.emit = hot * (glow * 7.0 + 0.35) + vec3(0.35, 0.05, 0.0);
  return m;
}
Mat matAsh(NS s) {
  vec3 c = vec3(0.035, 0.031, 0.028);
  float grey = smoothstep(0.45, 0.75, s.meso.g * 0.5 + s.det.r * 0.5);
  c = mix(c, vec3(0.16, 0.15, 0.14), grey * 0.7);
  float cracks = 1.0 - smoothstep(0.0, 0.08, s.cellS.g);
  c *= 1.0 - cracks * 0.5;
  // charred sticks / coal glints
  float coal = smoothstep(0.80, 0.92, s.micro.r);
  c = mix(c, vec3(0.012, 0.010, 0.010), coal);
  return mk(c, 0.95, 0.30 + 0.2 * grey, 0.05);
}
Mat matSoil(NS s) {
  vec3 c = vec3(0.200, 0.120, 0.060);
  c *= 0.82 + 0.3 * s.det.r;
  c = mix(c, vec3(0.28, 0.19, 0.11), smoothstep(0.55, 0.8, s.meso.g) * 0.5);
  float peb = smoothstep(0.14, 0.06, s.cellS.r) * step(0.55, s.cellS.b);
  c = mix(c, vec3(0.33, 0.29, 0.24) * (0.8 + 0.4 * s.cellS.a), peb * 0.8);
  return mk(c, 0.93, 0.30 + 0.2 * s.det.r + peb * 0.2, 0.05 + peb * 0.05);
}
Mat matFarm(NS s) {
  // fields: each ~6x6 block gets its own furrow direction and crop tint
  vec2 blk = floor((s.p.xz + (s.macro.rg - 0.5) * 1.5) / 6.0);
  float r = hash12(blk);
  float ang = (r < 0.5 ? 0.0 : 1.5708) + (hash12(blk + 7.3) - 0.5) * 0.25;
  vec2 dir = vec2(cos(ang), sin(ang));
  float fur = sin(dot(s.p.xz, dir) * 6.2832 * 1.6) * 0.5 + 0.5;
  float near = 1.0 - smoothstep(0.08, 0.30, s.fw);
  vec3 dark = vec3(0.150, 0.080, 0.035);
  vec3 ridge = vec3(0.260, 0.155, 0.075);
  vec3 c = mix(dark, ridge, mix(0.5, fur, near));
  // some fields are green with young crops
  float crop = step(0.62, hash12(blk + 3.1));
  c = mix(c, mix(vec3(0.10, 0.20, 0.04), vec3(0.18, 0.28, 0.06), fur), crop * 0.75 * mix(0.85, smoothstep(0.35, 0.75, fur), near));
  c *= 0.88 + 0.2 * s.det.r;
  // hedgerow lines on block borders
  vec2 fb = fract((s.p.xz + (s.macro.rg - 0.5) * 1.5) / 6.0);
  float edge = min(min(fb.x, 1.0 - fb.x), min(fb.y, 1.0 - fb.y)) * 6.0;
  float hedge = 1.0 - smoothstep(0.06, 0.18, edge);
  c = mix(c, vec3(0.08, 0.15, 0.04), hedge * 0.85);
  return mk(c, 0.94, 0.30 + 0.25 * fur + hedge * 0.4, 0.06 * near * (1.0 - hedge) + hedge * 0.05);
}
Mat matRoad(NS s) {
  vec3 c = vec3(0.330, 0.250, 0.160);
  c *= 0.86 + 0.24 * s.det.r;
  // worn ruts & scattered cobbles
  float cob = smoothstep(0.02, 0.10, s.cellS.g);
  float hasCob = smoothstep(0.55, 0.70, s.meso.g);
  vec3 stone = vec3(0.36, 0.33, 0.29) * (0.8 + 0.4 * s.cellS.b);
  c = mix(c, mix(c * 0.6, stone, cob), hasCob * 0.75);
  return mk(c, 0.95, 0.25 + 0.2 * cob * hasCob, 0.03 + 0.05 * cob * hasCob);
}
Mat matIce(NS s) {
  vec3 c = vec3(0.48, 0.68, 0.82);
  float cracks = 1.0 - smoothstep(0.0, 0.05, s.cellL.g);
  c = mix(c, vec3(0.80, 0.90, 0.96), cracks * 0.7);
  c = mix(c, vec3(0.32, 0.55, 0.74), smoothstep(0.5, 0.8, s.meso.r) * 0.4);
  return mk(c, 0.07 + cracks * 0.3, 0.45, 0.02 + cracks * 0.02);
}

Mat evalMat(float t, NS s) {
  if (t < 0.5) return matSand(s);
  if (t < 1.5) return matGrass(s);
  if (t < 2.5) return matForest(s);
  if (t < 3.5) return matJungle(s);
  if (t < 4.5) return matSavanna(s);
  if (t < 5.5) return matSwamp(s);
  if (t < 6.5) return matTundra(s);
  if (t < 7.5) return matSnow(s);
  if (t < 8.5) return matRock(s);
  if (t < 9.5) return matLava(s);
  if (t < 10.5) return matAsh(s);
  if (t < 11.5) return matSoil(s);
  if (t < 12.5) return matFarm(s);
  if (t < 13.5) return matRoad(s);
  if (t < 14.5) return matDesert(s);
  if (t < 15.5) return matIce(s);
  // unknown future tile ids: palette colour with gentle detail
  vec3 c = uTilePalette[int(clamp(t, 0.0, 31.0))];
  return mk(c * (0.85 + 0.3 * s.det.r), 0.9, 0.4, 0.04);
}

// Cliff rock: faceted strata projected on the dominant vertical plane.
Mat matCliff(NS s, out vec3 facetN) {
  vec3 p = s.p;
  vec3 n = s.n;
  float wx = smoothstep(0.35, 0.65, abs(n.x) / (abs(n.x) + abs(n.z) + 1e-4));
  vec2 uvX = vec2(p.z, p.y);
  vec2 uvZ = vec2(p.x, p.y);
  vec4 tX = nz(uvX * 0.085);
  vec4 tZ = nz(uvZ * 0.085);
  vec4 t = mix(tZ, tX, wx);
  vec4 dX = nz(uvX * 0.37);
  vec4 dZ = nz(uvZ * 0.37);
  vec4 d = mix(dZ, dX, wx);
  // strata: bands in y, warped
  float sy = p.y * 0.95 + (t.r - 0.5) * 2.2 + (s.macro.r - 0.5) * 1.5;
  float band = fract(sy);
  float layer = floor(sy);
  float lr = hash12(vec2(layer, 3.7));
  vec3 cA = vec3(0.380, 0.330, 0.275);
  vec3 cB = vec3(0.265, 0.250, 0.235);
  vec3 cC = vec3(0.450, 0.385, 0.300);
  vec3 c = mix(mix(cB, cA, smoothstep(0.2, 0.6, lr)), cC, smoothstep(0.75, 0.95, lr));
  c *= 0.78 + 0.34 * d.r;
  float crease = smoothstep(0.0, 0.10, band) * smoothstep(1.0, 0.88, band);
  c *= 0.82 + 0.18 * crease;
  // facets: cells on the projected plane, each with its own tilt
  vec4 fX = cz(vec2(p.z * 0.16, p.y * 0.30 + p.x * 0.05));
  vec4 fZ = cz(vec2(p.x * 0.16, p.y * 0.30 + p.z * 0.05));
  vec4 f = mix(fZ, fX, wx);
  vec3 tA = normalize(cross(n, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
  vec3 tB = normalize(cross(tA, n));
  float near = 1.0 - smoothstep(0.15, 0.6, s.fw);
  facetN = normalize(n + (tA * (f.b - 0.5) * 0.9 + tB * (f.a - 0.5) * 0.7) * near);
  c *= 0.85 + 0.3 * f.b;
  float seam = 1.0 - smoothstep(0.0, 0.07, f.g);
  c *= 1.0 - seam * 0.16 * near;
  return mk(c, 0.82, 0.8, 0.06 * (1.0 - crease) + 0.03);
}

// Seabed: rippled sand in the shallows, silt and rock in the deep.
vec3 seabedColor(NS s, float depth, out float hgt) {
  vec2 q = s.p.xz + (s.meso.rg - 0.5) * 4.0;
  float rip = sin(dot(q, vec2(1.6, 0.9)) * 2.2 + s.det.r * 4.0) * 0.5 + 0.5;
  vec3 sand = vec3(0.60, 0.50, 0.32) * (0.88 + 0.16 * s.det.g);
  sand *= 1.0 - 0.10 * rip * (1.0 - smoothstep(0.1, 0.4, s.fw));
  vec3 silt = vec3(0.24, 0.24, 0.20) * (0.8 + 0.3 * s.meso.r);
  vec3 rock = vec3(0.12, 0.13, 0.13) * (0.7 + 0.5 * s.cellL.b) * (0.6 + 0.4 * smoothstep(0.0, 0.1, s.cellL.g));
  float k1 = smoothstep(1.8, 4.5, depth + (s.macro.r - 0.5) * 2.5);
  float k2 = smoothstep(4.0, 7.5, depth + (s.meso.g - 0.5) * 3.0);
  // patches of seagrass in sunny shallows
  float grass = smoothstep(0.62, 0.78, s.meso.b * 0.5 + s.macro.g * 0.5) * smoothstep(0.4, 1.0, depth) * (1.0 - k1);
  vec3 c = mix(sand, vec3(0.07, 0.16, 0.05) * (0.8 + 0.4 * s.det.r), grass * 0.8);
  c = mix(c, silt, k1);
  c = mix(c, rock, k2);
  hgt = 0.2 + rip * 0.1 + k2 * 0.3;
  return c;
}

float causticsAt(vec2 p, float t) {
  vec2 w = (nz(p * 0.035 + vec2(t * 0.006, -t * 0.004)).rg - 0.5) * 2.4;
  vec2 q1 = (p + w) * (1.0 / 21.0) + vec2(t * 0.0045, t * 0.0026);
  vec2 q2 = ROT1 * (p - w * 0.7) * (1.0 / 16.0) - vec2(t * 0.0032, -t * 0.0040);
  float e1 = cz(q1).g;
  float e2 = cz(q2).g;
  float c1 = 1.0 - smoothstep(0.0, 0.22, e1);
  float c2 = 1.0 - smoothstep(0.0, 0.22, e2);
  return c1 * 0.65 + c2 * 0.65 + c1 * c2 * 1.2;
}

vec3 bumpPerturb(vec3 pos, vec3 n, float H) {
  vec3 dpx = dFdx(pos);
  vec3 dpy = dFdy(pos);
  float dhx = dFdx(H);
  float dhy = dFdy(H);
  vec3 r1 = cross(dpy, n);
  vec3 r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  if (abs(det) < 1e-9) return n;
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * n - grad);
}

// Territory overlay: soft tint + crisp glowing border line.
void applyOverlay(vec2 p, inout vec3 albedo, inout vec3 emissive) {
  if (uOverlayOn < 0.5) return;
  ivec2 osz = ivec2(uOverlaySize);
  vec2 sc = uOverlaySize / uWorldSize;
  vec2 g = p * sc - 0.5;
  ivec2 c = ivec2(floor(g));
  vec2 f = g - floor(g);
  vec4 A = texelFetch(uOverlay, clamp(c, ivec2(0), osz - 1), 0);
  vec4 B = texelFetch(uOverlay, clamp(c + ivec2(1, 0), ivec2(0), osz - 1), 0);
  vec4 C = texelFetch(uOverlay, clamp(c + ivec2(0, 1), ivec2(0), osz - 1), 0);
  vec4 D = texelFetch(uOverlay, clamp(c + ivec2(1, 1), ivec2(0), osz - 1), 0);
  vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  // region membership field for each corner colour
  #define SAMEC(X, Y) (all(lessThan(abs((X) - (Y)), vec4(0.012))) ? 1.0 : 0.0)
  float fA = w.x + w.y * SAMEC(B, A) + w.z * SAMEC(C, A) + w.w * SAMEC(D, A);
  float fB = w.y + w.x * SAMEC(A, B) + w.z * SAMEC(C, B) + w.w * SAMEC(D, B);
  float fC = w.z + w.x * SAMEC(A, C) + w.y * SAMEC(B, C) + w.w * SAMEC(D, C);
  float fD = w.w + w.x * SAMEC(A, D) + w.y * SAMEC(B, D) + w.z * SAMEC(C, D);
  vec4 own = A; float fo = fA;
  if (fB > fo) { own = B; fo = fB; }
  if (fC > fo) { own = C; fo = fC; }
  if (fD > fo) { own = D; fo = fD; }
  if (own.a < 0.004) return;
  float uniformRegion = step(0.999, fo);
  // distance (in tiles) from the border contour, approximately
  float dist = (fo - 0.5);
  float fwd = max(fwidth(fo), 1e-4);
  float lineW = max(0.07, fwd * 1.1);
  float line = (1.0 - smoothstep(lineW, lineW + fwd * 1.2, dist)) * (1.0 - uniformRegion);
  float glow = exp(-max(dist, 0.0) * 7.0) * (1.0 - uniformRegion);
  vec3 col = own.rgb;
  float a = own.a;
  albedo = mix(albedo, albedo * 0.55 + col * 0.45, a * 0.42);
  albedo = mix(albedo, col * 0.9 + 0.1, line * a);
  emissive += col * (line * 0.9 + glow * 0.30) * a * (0.35 + 0.65 * (1.0 - uDay * 0.6));
}

void terrainSurface() {
  NS s;
  s.p = vWPos;
  s.n = normalize(vWNormal);
  vec2 p = s.p.xz;
  s.fw = length(fwidth(s.p));
  s.macro = nz(p * (1.0 / 97.0));
  s.meso = nz(ROT1 * p * (1.0 / 23.0));
  s.det = nz(ROT2 * p * (1.0 / 5.3));
  s.micro = nz(ROT3 * p * (1.0 / 1.37));
  s.cellS = cz(p * (1.0 / 9.0));
  s.cellL = cz(ROT1 * p * (1.0 / 37.0));
  vec4 clim = texture2D(uClimTex, p / uWorldSize);
  s.moist = clim.r;
  s.temp = clim.g;
  s.ao = clim.b;
  s.fire = clim.a;

  // ---- organic tile blending
  vec2 warp = (s.meso.rg - 0.5) * 1.5 + (s.det.gb - 0.5) * 0.55 + (s.micro.rg - 0.5) * 0.12;
  vec2 g = p + warp - 0.5;
  vec2 i0 = floor(g);
  vec2 f = g - i0;
  ivec2 c = ivec2(i0);
  float t0 = tileTypeAt(c);
  float t1 = tileTypeAt(c + ivec2(1, 0));
  float t2 = tileTypeAt(c + ivec2(0, 1));
  float t3 = tileTypeAt(c + ivec2(1, 1));
  vec2 sf = smoothstep(0.0, 1.0, f);
  vec4 w = vec4((1.0 - sf.x) * (1.0 - sf.y), sf.x * (1.0 - sf.y), (1.0 - sf.x) * sf.y, sf.x * sf.y);
  if (t1 == t0) { w.x += w.y; w.y = 0.0; }
  if (t2 == t0) { w.x += w.z; w.z = 0.0; } else if (t2 == t1) { w.y += w.z; w.z = 0.0; }
  if (t3 == t0) { w.x += w.w; w.w = 0.0; } else if (t3 == t1) { w.y += w.w; w.w = 0.0; } else if (t3 == t2) { w.z += w.w; w.w = 0.0; }

  Mat m0 = evalMat(t0, s);
  Mat m1 = m0; Mat m2 = m0; Mat m3 = m0;
  if (w.y > 0.0) m1 = evalMat(t1, s);
  if (w.z > 0.0) m2 = evalMat(t2, s);
  if (w.w > 0.0) m3 = evalMat(t3, s);
  vec4 live = step(1e-5, w);
  vec4 hv = (w + vec4(m0.h, m1.h, m2.h, m3.h) * 0.6) * live;
  float hm = max(max(hv.x, hv.y), max(hv.z, hv.w)) - 0.20;
  vec4 b = max(hv - hm, 0.0) * live;
  b /= max(b.x + b.y + b.z + b.w, 1e-5);

  vec3 albedo = m0.albedo * b.x + m1.albedo * b.y + m2.albedo * b.z + m3.albedo * b.w;
  float rough = m0.rough * b.x + m1.rough * b.y + m2.rough * b.z + m3.rough * b.w;
  float H = (m0.h * m0.bump) * b.x + (m1.h * m1.bump) * b.y + (m2.h * m2.bump) * b.z + (m3.h * m3.bump) * b.w;
  vec3 emit = m0.emit * b.x + m1.emit * b.y + m2.emit * b.z + m3.emit * b.w;
  vec4 isLava = vec4(equal(vec4(t0, t1, t2, t3), vec4(9.0))) * live;
  vec4 isSnow = vec4(equal(vec4(t0, t1, t2, t3), vec4(7.0))) * live;
  vec4 isIce = vec4(equal(vec4(t0, t1, t2, t3), vec4(15.0))) * live;
  float lavaRaw = dot(isLava, w);
  float snowB = dot(isSnow, b);
  float iceB = dot(isIce, b);

  // ---- slope driven cliffs
  vec3 nrm = s.n;
  float slopeN = s.n.y + (s.meso.b - 0.5) * 0.10 + (s.det.r - 0.5) * 0.06;
  float cliff = smoothstep(0.76, 0.60, slopeN) * (1.0 - lavaRaw) * (1.0 - iceB);
  vec3 facetN = nrm;
  if (cliff > 0.001) {
    Mat cm = matCliff(s, facetN);
    // snow clings to ledges that face up
    float snowLedge = snowB * smoothstep(0.55, 0.75, facetN.y + (s.det.g - 0.5) * 0.3);
    cm.albedo = mix(cm.albedo, vec3(0.78, 0.82, 0.88), snowLedge);
    albedo = mix(albedo, cm.albedo, cliff);
    rough = mix(rough, cm.rough, cliff);
    H = mix(H, cm.h * cm.bump, cliff);
    nrm = normalize(mix(nrm, facetN, cliff));
  }

  // ---- seabed & shore
  float depth = -s.p.y;
  float hb = 0.0;
  vec3 sea = seabedColor(s, max(depth, 0.0), hb);
  float under = smoothstep(-0.05, 0.9, depth + (s.det.r - 0.5) * 0.5);
  // sandy floors take the rippled seabed look; other beds keep their material, wet
  float sandy = dot(vec4(equal(vec4(t0, t1, t2, t3), vec4(0.0))) * live, b);
  vec3 wetBed = albedo * 0.62;
  float deepK = smoothstep(1.8, 4.5, depth + (s.macro.r - 0.5) * 2.5);
  albedo = mix(albedo, mix(wetBed, sea, max(sandy, deepK)), under * (1.0 - cliff * 0.6));
  H = mix(H, hb * 0.05, under);
  rough = mix(rough, 0.6, under);
  // wet band above the waterline (with a slow swash)
  float swash = 0.10 * sin(uLTime * 0.9 + s.meso.r * 12.0) + 0.05 * sin(uLTime * 1.7 + s.det.g * 9.0);
  float wetShore = smoothstep(0.55, 0.0, s.p.y - swash) * (1.0 - under);
  albedo *= mix(1.0, 0.62, wetShore);
  rough = mix(rough, 0.35, wetShore);

  // ---- weather wetness (rain): darker, glossier, puddles in hollows
  float wet = uWet * (1.0 - under) * (1.0 - lavaRaw);
  albedo *= mix(1.0, 0.72, wet);
  rough = mix(rough, rough * 0.45, wet);

  // ---- fire scorching & embers
  if (s.fire > 0.004) {
    float fl = 0.6 + 0.4 * sin(uLTime * 9.0 + s.det.r * 20.0) * sin(uLTime * 5.3 + s.micro.r * 13.0);
    albedo *= 1.0 - s.fire * 0.6;
    float ember = smoothstep(0.4, 0.9, s.det.g * 0.6 + s.micro.r * 0.4);
    emit += vec3(1.0, 0.30, 0.04) * s.fire * (0.4 + ember * 2.2) * fl;
  }
  // heat glow around lava
  emit += vec3(0.9, 0.18, 0.02) * smoothstep(0.0, 1.0, lavaRaw) * (1.0 - dot(isLava, b)) * 0.8;

  // ---- normals: material bump + seabed ripples
  vec3 nb = bumpPerturb(s.p, nrm, H);
  tNormalW = nb;

  // ---- snow sparkle (view dependent, band-limited)
  float snowAll = snowB * (1.0 - cliff * 0.7);
  if (snowAll > 0.01) {
    vec2 sp = p * 7.0;
    vec2 cid = floor(sp);
    float r = hash12(cid);
    vec3 vd = normalize(cameraPosition - s.p);
    float ph = fract(r * 13.7 + dot(vd, vec3(5.1, 3.7, 4.3)));
    float spark = smoothstep(0.965, 1.0, ph) * smoothstep(0.35, 0.05, length(fract(sp) - 0.5));
    spark *= 1.0 - smoothstep(0.04, 0.14, s.fw);
    emit += uSunCol * (spark * 1.6 * uDay + spark * 0.25) * snowAll;
  }

  // ---- territory overlay
  applyOverlay(p, albedo, emit);

  tAlbedo = albedo;
  tRough = clamp(rough, 0.04, 1.0);
  tEmissive = emit;
  // baked horizon AO, plus cliff creases
  tAO = mix(0.35, 1.0, s.ao);
  tCloud = cloudShadowAt(p);
  tSpecK = 1.0;
}
`;

export const TERRAIN_FRAGMENT_POST = /* glsl */ `
{
  // water column over the seabed
  float depthW = -vWPos.y;
  if (depthW > 0.0) {
    vec3 vdir = normalize(vWPos - cameraPosition);
    float viewY = abs(vdir.y);
    // caustics are light: modulate the lit seabed in shallow, sunny water
    float cs = causticsAt(vWPos.xz, uLTime) * (1.0 - smoothstep(0.3, 4.5, depthW)) * smoothstep(0.0, 0.35, depthW);
    float sunVis = clamp(uDay, 0.0, 1.0) * tCloud;
    outgoingLight *= 1.0 + cs * 0.55 * sunVis;
    outgoingLight = applyWaterColumn(outgoingLight, depthW, viewY);
  }
}
`;

// Patch a MeshStandardMaterial in place. `uniforms` is merged into the shader.
export function patchTerrainMaterial(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + TERRAIN_VERTEX_PARS)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + TERRAIN_VERTEX_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + TERRAIN_FRAGMENT_PARS)
      .replace('#include <map_fragment>', 'terrainSurface();\ndiffuseColor.rgb = tAlbedo;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(tNormalW, 0.0)).xyz);')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += tEmissive;')
      .replace(
        '#include <aomap_fragment>',
        `reflectedLight.indirectDiffuse *= tAO;
         reflectedLight.indirectSpecular *= tAO;
         reflectedLight.directDiffuse *= mix(1.0, tAO, 0.45) * tCloud;
         reflectedLight.directSpecular *= tAO * tCloud;`,
      )
      .replace('#include <opaque_fragment>', TERRAIN_FRAGMENT_POST + '\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => 'worldseed-terrain-v1';
}
