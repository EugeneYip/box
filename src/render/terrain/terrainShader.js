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
float tCold;

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
  float fwy;  // screen-space rate of change of world y (for strata AA)
  vec3 fn;    // flat (per-triangle) geometric normal, world space
};

struct Mat { vec3 albedo; float rough; float h; float bump; vec3 emit; };

Mat mk(vec3 a, float r, float h, float b) { Mat m; m.albedo = a; m.rough = r; m.h = h; m.bump = b; m.emit = vec3(0.0); return m; }

// Seasonal hue of living ground cover: fresh spring green, deep summer green,
// autumn gold-brown, frost-dulled winter; warm ages bake it dry. k = how much the
// material follows the year (evergreen tropics barely do).
vec3 seasonal(vec3 c, float k, float temp) {
  k *= 1.0 - smoothstep(0.66, 0.88, temp);
  const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
  float lc = dot(c, LW);
  // hue shift toward the season's colour at this surface's own luminance
  vec3 tgt = uSeasonTint.rgb * (lc / max(dot(uSeasonTint.rgb, LW), 1e-3));
  // warm seasons (autumn gold) glow a little brighter than the green they replace
  tgt *= 1.0 + 0.30 * smoothstep(0.0, 0.2, uSeasonTint.r - uSeasonTint.g);
  vec3 t = mix(c, tgt, uSeasonTint.w);
  vec3 dryC = vec3(0.45, 0.34, 0.10) * (lc / 0.33) * 1.05;
  t = mix(t, dryC, uDry * 0.6);
  return mix(c, t, k);
}

// ---------------------------------------------------------------- materials
Mat matSand(NS s) {
  // fine wind ripples, slightly warped
  vec2 q = s.p.xz + (s.meso.rg - 0.5) * 3.0;
  float rip = sin(dot(q, vec2(2.3, 1.1)) * 2.6 + s.det.r * 5.0) * 0.5 + 0.5;
  float ripFade = 1.0 - smoothstep(0.05, 0.25, s.fw);
  vec3 c = vec3(0.70, 0.56, 0.33);
  c = mix(c, vec3(0.80, 0.67, 0.43), s.macro.r * 0.6);
  c *= 0.92 + 0.10 * s.det.g;
  // fine grain (value noise, no cells): reads as sand at every distance
  float grain = nz(s.p.xz * 1.9).a * 0.5 + nz(ROT2 * s.p.xz * 4.3).a * 0.5;
  c *= 1.0 + (grain - 0.5) * 0.16 * ripFade;
  c *= 1.0 - 0.06 * rip * ripFade;
  // polar beaches: grey shingle of small rounded pebbles (~0.2 units) with dark gaps
  float cold = 1.0 - smoothstep(0.22, 0.50, s.temp);
  // mixed pebbles (0.08-0.3 units): two cell layers, elongated and rotated per patch,
  // random size / tone / presence, coarse sand filling the gaps, patchy density
  float ang = (s.meso.r - 0.5) * 6.28;
  vec2 sp = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * s.p.xz;
  vec4 pa = cz(vec2(sp.x, sp.y * 1.55) * (1.0 / 4.4) + 0.13);
  vec4 pc = cz(ROT2 * vec2(sp.x * 1.4, sp.y) * (1.0 / 1.8) + 0.71);
  float ra = 0.28 + 0.42 * pa.b;
  float rc = 0.30 + 0.40 * pc.b;
  float densA = smoothstep(0.32, 0.62, s.det.g * 0.6 + s.meso.b * 0.4);
  float densC = smoothstep(0.28, 0.58, s.det.b * 0.6 + s.micro.g * 0.4);
  float pebA = (1.0 - smoothstep(ra - 0.10, ra, pa.r)) * step(0.22, pa.a) * densA;
  float pebC = (1.0 - smoothstep(rc - 0.10, rc, pc.r)) * step(0.30, pc.a) * densC * (1.0 - pebA);
  vec3 toneA = mix(vec3(0.42, 0.40, 0.37), vec3(0.19, 0.19, 0.20), pa.a) * (0.85 + 0.3 * pa.b);
  vec3 toneC = mix(vec3(0.38, 0.36, 0.33), vec3(0.22, 0.21, 0.21), pc.a) * (0.85 + 0.3 * pc.b);
  toneA *= 0.72 + 0.28 * smoothstep(ra, ra - 0.18, pa.r); // darker rims, rounded look
  toneC *= 0.75 + 0.25 * smoothstep(rc, rc - 0.16, pc.r);
  vec3 gapSand = vec3(0.29, 0.27, 0.235) * (0.85 + 0.3 * grain);
  vec3 shingle = mix(mix(gapSand, toneA, pebA), toneC, pebC);
  float pebble = max(pebA, pebC);
  float pebFade = 1.0 - smoothstep(0.02, 0.09, s.fw);
  shingle = mix(vec3(0.285, 0.272, 0.25) * (0.9 + 0.2 * s.det.r), shingle, pebFade);
  c = mix(c, shingle, cold);
  return mk(c, mix(0.92, 0.72, cold), 0.18 + 0.10 * s.det.r + cold * pebble * pebFade * 0.3, mix(0.035 + 0.02 * rip * ripFade, 0.035 * pebFade * pebble, cold));
}
Mat matDesert(NS s) {
  // wind-shaped dune field: warped crests ~7 units apart, gentle sunlit windward
  // slopes and short steep lee faces; crest strength varies across the field
  vec2 q = s.p.xz + (s.macro.rg - 0.5) * 14.0 + (s.meso.gb - 0.5) * 5.0;
  float dph = fract(dot(q, vec2(0.83, 0.56)) * 0.145 + s.meso.r * 0.35);
  float field = smoothstep(0.25, 0.65, s.meso.g * 0.7 + s.macro.b * 0.3);
  float dune = smoothstep(0.0, 0.78, dph) * (1.0 - smoothstep(0.78, 1.0, dph)) * mix(0.3, 1.0, field);
  float lee = smoothstep(0.78, 0.83, dph) * (1.0 - smoothstep(0.93, 1.0, dph)) * field;
  float duneFade = 1.0 - smoothstep(0.6, 1.6, s.fw);
  float ripFade = 1.0 - smoothstep(0.05, 0.25, s.fw);
  float rip = sin(dot(s.p.xz + (s.meso.gb - 0.5) * 4.0, vec2(1.9, 2.6)) * 2.2) * 0.5 + 0.5;
  vec3 c = mix(vec3(0.60, 0.38, 0.18), vec3(0.79, 0.55, 0.30), dune);
  c *= 1.0 - 0.20 * lee * duneFade;
  c *= 0.90 + 0.16 * s.det.r;
  c *= 1.0 - 0.07 * rip * ripFade;
  // darker gravel (reg) flats between the dune fields
  float reg = smoothstep(0.62, 0.80, s.meso.b * 0.6 + s.det.g * 0.4) * (1.0 - field);
  c = mix(c, vec3(0.44, 0.29, 0.17) * (0.85 + 0.3 * s.micro.r), reg * 0.55);
  float h = 0.22 + 0.15 * dune;
  return mk(c, 0.95, h, 0.04 + 1.0 * dune * duneFade + 0.03 * rip * ripFade);
}
Mat matGrass(NS s) {
  // three grassland regimes read at overview scale: khaki steppe, bright meadow,
  // deep lush lowland (moisture plus a broad variety field)
  vec3 steppe = vec3(0.285, 0.300, 0.100);
  vec3 meadow = vec3(0.130, 0.380, 0.055);
  vec3 lush = vec3(0.060, 0.290, 0.050);
  vec3 cold = vec3(0.090, 0.250, 0.100);
  float mv = s.moist + (nz(s.p.xz * (1.0 / 210.0) + 3.7).b - 0.5) * 0.35;
  vec3 c = mix(steppe, meadow, smoothstep(0.26, 0.46, mv));
  c = mix(c, lush, smoothstep(0.58, 0.80, mv));
  c = mix(cold, c, smoothstep(0.18, 0.48, s.temp));
  // soft meadow patches (sunny yellow-green / deeper green)
  float patchv = s.macro.r * 0.65 + s.meso.g * 0.35;
  c *= 0.80 + 0.40 * patchv;
  c = mix(c, c * vec3(1.22, 1.12, 0.70), smoothstep(0.60, 0.88, s.meso.r) * 0.40);
  c = mix(c, c * vec3(0.70, 0.95, 0.95), smoothstep(0.62, 0.9, s.macro.g) * 0.4);
  // broad +-10% hue / value drift over 20-60 units, darker hollows (not a putting green)
  vec4 lg = nz(s.p.xz * (1.0 / 150.0) + 17.3);
  float hd = lg.r - 0.5, vd = lg.g - 0.5;
  c *= vec3(1.0 + hd * 0.24, 1.0 + hd * 0.05, 1.0 - hd * 0.24) * (1.0 + vd * 0.24);
  c *= mix(0.68, 1.0, smoothstep(0.35, 0.95, s.ao));
  // clumps & blades (fine detail fades in up close)
  float near = 1.0 - smoothstep(0.03, 0.16, s.fw);
  float clump = s.det.r * 0.55 + s.micro.r * 0.45;
  float blade = s.micro.a;
  c *= 0.86 + 0.24 * clump + (blade - 0.5) * mix(0.06, 0.16, near);
  // brush-stroke grain along a slowly turning direction (no cellular dots)
  vec2 sd = normalize(vec2(0.8, 0.35) + (s.meso.gb - 0.5) * 1.4);
  vec2 spq = vec2(dot(s.p.xz, sd), dot(s.p.xz, vec2(-sd.y, sd.x)));
  float stroke = nz(vec2(spq.x * 0.22, spq.y * 1.25)).a;
  c *= 1.0 + (stroke - 0.5) * 0.08 * mix(0.5, 1.0, near);
  // tiny bright flower / seed specks at close range
  float nearS = 1.0 - smoothstep(0.03, 0.12, s.fw);
  float speck = smoothstep(0.12, 0.05, s.cellS.r) * step(0.90, s.cellS.a) * nearS;
  c = mix(c, mix(vec3(0.9, 0.85, 0.35), vec3(0.85, 0.55, 0.7), s.cellS.b), speck * 0.5);
  c = seasonal(c, 1.0, s.temp);
  return mk(c, 0.86, 0.38 + 0.45 * (s.det.r * 0.7 + s.meso.g * 0.3), 0.05 + 0.03 * near * stroke);
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
  c = seasonal(c, 0.6, s.temp);
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
  c = seasonal(c, 0.2, s.temp);
  return mk(c, 0.75, 0.5 + 0.35 * v, 0.06);
}
Mat matSavanna(NS s) {
  vec3 gold = vec3(0.500, 0.410, 0.130);
  vec3 olive = vec3(0.320, 0.320, 0.095);
  float v = s.macro.r * 0.5 + s.meso.g * 0.5;
  vec3 c = mix(gold, olive, smoothstep(0.45, 0.85, v + (s.moist - 0.4) * 0.5));
  // bare red soil patches
  float bare = smoothstep(0.66, 0.84, s.meso.r * 0.7 + s.det.g * 0.3);
  c = mix(c, vec3(0.38, 0.20, 0.09), bare * 0.7);
  // dry grass tufts (isotropic cells) and fine straw noise up close
  float near = 1.0 - smoothstep(0.03, 0.16, s.fw);
  float tuft = smoothstep(0.55, 0.15, s.cellS.r) * (0.6 + 0.4 * s.cellS.b);
  c *= 0.84 + 0.26 * s.det.r;
  c = mix(c, c * mix(vec3(1.08, 1.05, 0.92), vec3(0.92, 0.90, 0.84), s.cellS.a), tuft * 0.5 * near);
  c *= 1.0 + (s.micro.a - 0.5) * 0.30 * near;
  // greener hollows inside steppe so it reads as dry grassland, not a stain
  c = mix(c, vec3(0.20, 0.27, 0.08) * (0.9 + 0.2 * s.micro.g), smoothstep(0.58, 0.78, s.meso.b * 0.6 + s.moist * 0.4) * 0.45);
  return mk(c, 0.92, 0.28 + 0.25 * s.det.r, 0.05 + 0.05 * tuft * near);
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
  // clean patches: moss green base, lichen ochre, russet heath, grey stone
  vec3 c = vec3(0.130, 0.190, 0.080) * (0.88 + 0.24 * s.det.g);
  float lich = smoothstep(0.52, 0.68, s.meso.g * 0.60 + s.det.r * 0.30 + s.micro.r * 0.10);
  c = mix(c, vec3(0.340, 0.280, 0.130) * (0.9 + 0.2 * s.micro.g), lich * 0.75);
  float hth = smoothstep(0.58, 0.72, s.meso.r * 0.6 + s.det.b * 0.4) * (1.0 - lich);
  c = mix(c, vec3(0.210, 0.130, 0.090) * (0.9 + 0.2 * s.micro.r), hth * 0.55);
  float stn = smoothstep(0.60, 0.74, s.meso.b * 0.6 + s.det.g * 0.4);
  float peb = smoothstep(0.6, 0.3, s.cellS.r);
  c = mix(c, vec3(0.30, 0.30, 0.29) * (0.80 + 0.35 * s.cellS.b) * mix(0.78, 1.0, peb), stn * 0.85);
  c *= 0.90 + 0.2 * s.macro.g;
  // high, dry plateaus (Tibet, the Altiplano): khaki high steppe with ochre
  // and russet patches instead of polar moss
  float hiDry = smoothstep(4.0, 7.0, s.p.y) * (1.0 - smoothstep(0.30, 0.55, s.moist));
  vec3 steppeH = mix(vec3(0.36, 0.31, 0.17), vec3(0.45, 0.37, 0.20), smoothstep(0.35, 0.7, s.meso.g * 0.6 + s.det.r * 0.4));
  steppeH = mix(steppeH, vec3(0.34, 0.22, 0.13), smoothstep(0.62, 0.8, s.meso.r * 0.6 + s.det.b * 0.4) * 0.6);
  steppeH *= 0.88 + 0.22 * s.micro.r;
  c = mix(c, mix(steppeH, c, stn * 0.7), hiDry);
  c = seasonal(c, 0.45, s.temp);
  return mk(c, 0.90, 0.40 + 0.25 * lich + 0.3 * stn, 0.05 + 0.04 * stn);
}
Mat matSnow(NS s) {
  // mid-value snow (never paper white): blue-violet hollows, wind ripples
  float drift = s.meso.r * 0.6 + s.det.g * 0.4;
  // clean, soft, bright snow (never paper white), gentle neutral-blue shading
  vec3 c = mix(vec3(0.58, 0.61, 0.66), vec3(0.67, 0.70, 0.74), smoothstep(0.2, 0.72, drift));
  c = mix(c, vec3(0.47, 0.52, 0.60), (1.0 - s.ao) * 0.35);
  // slopes cool slightly
  c = mix(c, c * vec3(0.92, 0.95, 1.02), smoothstep(0.97, 0.78, s.n.y));
  // broad wind ridges (read at mid zoom): gentle windward face, blue lee shadow
  vec2 wd = vec2(0.917, 0.401);
  vec2 q = s.p.xz + (s.meso.gb - 0.5) * 7.0;
  float rp = fract(dot(q, wd) * 0.19 + s.det.r * 0.5);
  float ridge = smoothstep(0.0, 0.78, rp) * (1.0 - smoothstep(0.78, 1.0, rp));
  float ridgeFade = 1.0 - smoothstep(0.3, 1.0, s.fw);
  c = mix(c, c * vec3(0.90, 0.93, 1.0), (1.0 - ridge) * 0.25 * ridgeFade);
  float rip = sin(dot(q, wd) * 3.4 + s.det.r * 6.0) * 0.5 + 0.5;
  float ripFade = 1.0 - smoothstep(0.05, 0.3, s.fw);
  c *= 0.96 + 0.05 * s.micro.r;
  c *= 1.0 - 0.02 * rip * ripFade;
  return mk(c, 0.62, 0.40 + 0.3 * drift, 0.025 + 0.12 * ridge * ridgeFade + 0.015 * rip * ripFade);
}
Mat matRock(NS s) {
  vec3 warm = vec3(0.330, 0.290, 0.245);
  vec3 cool = vec3(0.255, 0.262, 0.270);
  vec3 c = mix(warm, cool, s.macro.g);
  float fineK = 1.0 - smoothstep(0.06, 0.30, s.fw);
  // broad variance: ochre weathering patches, brighter ridges, stained hollows
  c *= mix(vec3(1.0), vec3(1.08, 1.01, 0.90), smoothstep(0.5, 0.8, s.meso.g) * 0.8);
  c *= 0.84 + 0.28 * s.meso.b;
  // angular blocks (warped cells): joints show only in places (no paving net,
  // no rounded pebbles), each block a slightly different tone
  vec4 bk = cz(ROT2 * (s.p.xz + (s.det.rg - 0.5) * 2.2) * (1.0 / 26.0) + 0.29);
  float crackM = smoothstep(0.38, 0.62, s.meso.r * 0.55 + s.det.b * 0.45);
  float blockC = (1.0 - smoothstep(0.0, 0.05, bk.g + (s.micro.b - 0.5) * 0.03)) * crackM * fineK;
  c *= mix(1.0, 0.88 + 0.22 * bk.b, crackM);
  c *= 1.0 - 0.38 * blockC;
  // weathered stone: irregular (noise-warped) fissures, grain and mottling
  vec4 cr = cz((s.p.xz + (s.meso.gb - 0.5) * 6.0 + (s.det.rg - 0.5) * 1.5) * (1.0 / 29.0));
  float seam = smoothstep(0.0, 0.06, cr.g + (s.det.b - 0.5) * 0.08);
  c *= 0.88 + 0.16 * cr.b;
  c *= 0.84 + 0.16 * mix(1.0, seam, smoothstep(0.35, 0.65, s.meso.r));
  c *= 0.80 + 0.30 * s.det.r;
  c *= 0.90 + 0.18 * s.micro.r;
  float stone = bk.b * crackM;
  // lichen flecks
  float lich = smoothstep(0.72, 0.86, s.det.g) * (1.0 - smoothstep(0.3, 0.6, 1.0 - s.n.y));
  c = mix(c, vec3(0.30, 0.30, 0.16), lich * 0.5);
  // flat rock is mostly overgrown: turf with exposed outcrops (never a grey stain)
  float flatK = smoothstep(0.80, 0.94, s.n.y);
  float turf = flatK * smoothstep(0.36, 0.60, s.meso.g * 0.55 + s.det.r * 0.30 + s.micro.r * 0.15) * (1.0 - smoothstep(0.1, 0.3, 0.4 - s.temp));
  vec3 turfC = mix(vec3(0.10, 0.20, 0.055), vec3(0.20, 0.22, 0.10), s.det.g) * (0.85 + 0.3 * s.micro.r);
  c = mix(c, turfC, turf * 0.92);
  float hgt = 0.30 + 0.20 * s.det.r + 0.18 * s.meso.b + 0.14 * stone - 0.40 * blockC - 0.25 * (1.0 - seam) + 0.12 * (s.micro.g - 0.5) * fineK;
  return mk(c, 0.80, mix(clamp(hgt, 0.0, 1.0), 0.32 + 0.22 * s.det.r, turf), mix(0.10, 0.05, turf));
}
Mat matLava(NS s) {
  float t = uLTime;
  // dark basalt crust plates drifting on the flow, glowing only in the cracks
  vec2 flow = vec2(t * 0.06, t * 0.025);
  vec2 wq = s.p.xz + (nz(s.p.xz * 0.04 + flow * 0.3).rg - 0.5) * 3.0;
  vec4 crust = cz(ROT1 * (wq + flow) * (1.0 / 14.0));
  vec4 crust2 = cz(ROT2 * (wq - flow * 0.6) * (1.0 / 6.0));
  float crack = 1.0 - smoothstep(0.0, 0.075, crust.g);
  float crack2 = 1.0 - smoothstep(0.0, 0.045, crust2.g);
  float rim = 1.0 - smoothstep(0.0, 0.24, crust.g);
  float pulse = 0.8 + 0.2 * sin(t * 1.6 + crust.b * 6.28);
  float pool = smoothstep(0.80, 0.93, nz(wq * 0.06 + flow * 0.4).r);
  float glow = clamp(crack + crack2 * 0.45 + pool, 0.0, 1.0) * pulse;
  vec3 crustCol = mix(vec3(0.026, 0.019, 0.017), vec3(0.070, 0.042, 0.030), crust.b) * (0.8 + 0.4 * s.det.r);
  crustCol = mix(crustCol, vec3(0.16, 0.04, 0.01), rim * 0.35);
  vec3 hot = mix(vec3(0.95, 0.20, 0.02), vec3(1.0, 0.48, 0.08), glow);
  Mat m = mk(mix(crustCol, hot * 0.3, glow), mix(0.85, 0.5, glow), 0.35 + 0.35 * s.meso.b + 0.2 * crust.b, 0.06 * (1.0 - glow));
  m.emit = hot * glow * 3.0 + vec3(0.8, 0.14, 0.01) * rim * 0.30 * pulse;
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
  // crops follow the year (each field a little ahead or behind): young green
  // in spring, ripening gold through summer, stubble after the autumn
  // harvest, bare tilled earth in winter; a few fields lie fallow
  float ss = mod(uSeason + (hash12(blk + 5.7) - 0.5) * 0.5, 4.0);
  float green = ss < 2.0 ? smoothstep(0.0, 0.45, ss) * (1.0 - smoothstep(1.0, 1.6, ss)) : 0.0;
  float gold = smoothstep(1.0, 1.6, ss) * (1.0 - smoothstep(2.3, 2.7, ss));
  float stubble = smoothstep(2.3, 2.7, ss) * (1.0 - smoothstep(2.95, 3.25, ss));
  float sown = step(0.22, hash12(blk + 3.1));
  float rows = mix(0.85, smoothstep(0.35, 0.75, fur), near);
  vec3 young = mix(vec3(0.11, 0.24, 0.045), vec3(0.19, 0.31, 0.07), fur);
  vec3 ripe = mix(vec3(0.47, 0.37, 0.12), vec3(0.60, 0.48, 0.17), fur);
  vec3 straw = mix(vec3(0.40, 0.32, 0.17), vec3(0.50, 0.41, 0.23), fur);
  c = mix(c, young, green * sown * 0.85 * rows);
  c = mix(c, ripe, gold * sown * 0.9 * mix(0.9, 1.0, rows));
  c = mix(c, straw, stubble * sown * 0.8);
  // winter: darker, frost-dulled soil, snow dusting the furrow ridges first
  float wint = ss > 2.9 ? smoothstep(2.9, 3.3, ss) : 0.0;
  c = mix(c, c * vec3(0.86, 0.86, 0.92), wint);
  float dust = smoothstep(-0.10, 0.0, uSnowT - s.temp) * mix(0.5, fur, near);
  c = mix(c, vec3(0.60, 0.62, 0.67), dust * 0.7);
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
  vec3 c = vec3(0.28, 0.36, 0.44);
  float cracks = 1.0 - smoothstep(0.0, 0.05, s.cellL.g);
  c = mix(c, vec3(0.16, 0.20, 0.26), cracks * 0.6);
  c = mix(c, vec3(0.22, 0.30, 0.40), smoothstep(0.5, 0.8, s.meso.r) * 0.4);
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

// Cliff rock: true triplanar blending (weights from the normal). Strata with
// irregular spacing that pinch out along their length (never continuous rings),
// vertical joints, erosion gullies and runoff streaks, per-bed mineral tints,
// gritty micro relief and chiselled facets. volc: basalt / scoria on volcanoes.
Mat matCliff(NS s, float volc, out vec3 facetN) {
  vec3 p = s.p;
  vec3 n = s.n;
  vec3 bw = pow(abs(n), vec3(4.0));
  bw /= (bw.x + bw.y + bw.z + 1e-4);
  vec2 uvX = vec2(p.z, p.y);
  vec2 uvZ = vec2(p.x, p.y);
  vec2 uvY = p.xz;
  float wxz = bw.x / max(bw.x + bw.z, 1e-4);
  vec2 uvD = bw.x > bw.z ? uvX : uvZ;
  vec4 t, d;
  if (uPower > 0.5) {
    // power saver: dominant vertical projection only (no triplanar blend)
    t = nz(uvD * 0.085);
    d = nz(uvD * 0.37);
  } else {
    t = nz(uvX * 0.085) * bw.x + nz(uvZ * 0.085) * bw.z + nz(uvY * 0.085) * bw.y;
    d = nz(uvX * 0.37) * bw.x + nz(uvZ * 0.37) * bw.z + nz(uvY * 0.37) * bw.y;
  }
  float near = 1.0 - smoothstep(0.25, 0.9, s.fw);
  float fineK = 1.0 - smoothstep(0.06, 0.30, s.fw);

  // strata: irregular spacing (monotonic warp of height), gently dipping beds
  float yy = p.y + (s.macro.r - 0.5) * 2.2 + (t.r - 0.5) * 0.45;
  float sy = yy * 0.75 + 0.30 * sin(yy * 0.29 + 1.3) + 0.17 * sin(yy * 0.71 + 4.1);
  float layer = floor(sy);
  float aa = clamp(s.fwy * 1.4, 0.02, 0.5);
  float lt = smoothstep(1.0 - aa, 1.0, fract(sy));
  float lr = mix(hash12(vec2(layer, 3.7)), hash12(vec2(layer + 1.0, 3.7)), lt);
  float lh = mix(hash12(vec2(layer, 8.3)), hash12(vec2(layer + 1.0, 8.3)), lt);
  float bandFade = 1.0 - smoothstep(0.25, 0.7, s.fwy * 0.95);
  // beds pinch out: their contrast comes and goes along each layer
  float lens = smoothstep(0.30, 0.70, t.g * 0.75 + lh * 0.5 - 0.1);
  // high alpine rock (crystalline cores) shows little bedding: no fortress courses
  float bandK = bandFade * mix(0.30, 1.0, lens) * (1.0 - 0.8 * volc) * (1.0 - 0.65 * smoothstep(8.0, 13.0, p.y));
  lr = mix(0.5, lr, bandK);
  vec3 cA = vec3(0.370, 0.345, 0.310);
  vec3 cB = vec3(0.275, 0.265, 0.252);
  vec3 cC = vec3(0.450, 0.410, 0.350);
  // hot, dry lands: warm sandstone cliffs
  // climate, not altitude: a high mesa in a hot land is still warm sandstone
  float tLat = s.temp + max(s.p.y, 0.0) * (0.55 / 22.0);
  float hotK = smoothstep(0.55, 0.78, tLat) * (1.0 - 0.7 * smoothstep(0.55, 0.85, s.moist));
  cA = mix(cA, vec3(0.52, 0.39, 0.28), hotK);
  cB = mix(cB, vec3(0.40, 0.29, 0.21), hotK);
  cC = mix(cC, vec3(0.62, 0.50, 0.36), hotK);
  vec3 c = mix(mix(cB, cA, smoothstep(0.15, 0.6, lr)), cC, smoothstep(0.75, 0.97, lr));
  // per-bed mineral tint (cool grey, buff, rust) and broad weathering patches
  vec3 bedT = mix(mix(vec3(0.93, 0.98, 1.05), vec3(1.07, 1.00, 0.90), smoothstep(0.25, 0.5, lh)), vec3(1.06, 0.96, 0.89), smoothstep(0.72, 0.9, lh));
  c *= mix(vec3(1.0), bedT, bandK * 0.85);
  c *= mix(vec3(1.0), vec3(1.08, 1.00, 0.90), smoothstep(0.5, 0.8, s.meso.g) * 0.8);
  c *= mix(vec3(1.0), vec3(0.91, 0.96, 1.04), smoothstep(0.55, 0.85, s.macro.b) * (1.0 - hotK));
  c *= 0.78 + 0.32 * d.r;
  // ledges: dark lip just above each layer boundary, lit top surface
  float led = smoothstep(0.0, max(0.34, aa * 3.0), fract(sy));
  c *= mix(1.0, mix(0.82, 1.05, led), bandK);

  // vertical joints: cells stretched along the fall line on each vertical plane
  vec2 jw = (d.gb - 0.5) * 0.9;
  vec4 jX = cz(vec2((p.z + jw.x) * 0.042, (p.y + jw.y) * 0.0085) + 0.17);
  vec4 jZ = cz(vec2((p.x + jw.x) * 0.042, (p.y + jw.y) * 0.0085) + 0.61);
  float jg = mix(jZ.g, jX.g, wxz);
  // joint width never below ~2 px (edge distance unit = 0.75 world units here)
  float jW = max(0.2, s.fw * 3.6);
  float vf = smoothstep(0.25, 0.65, 1.0 - bw.y); // 0 on moderate slopes .. 1 on true faces
  float joint = (1.0 - smoothstep(0.0, jW, jg)) * near * mix(0.45, 1.0, smoothstep(0.3, 0.6, d.b)) * (1.0 - smoothstep(0.25, 0.5, jW)) * vf;
  // erosion gullies (ridged noise along the fall line) and dark runoff streaks
  vec4 gX = nz(vec2(p.z * 0.06, p.y * 0.016) + 0.31);
  vec4 gZ = nz(vec2(p.x * 0.06, p.y * 0.016) + 0.73);
  vec4 gv = mix(gZ, gX, wxz);
  float gully = smoothstep(0.55, 0.85, gv.b) * mix(0.7, 1.0, volc) * vf;
  float streak = smoothstep(0.56, 0.80, gv.g) * (1.0 - hotK * 0.5) * vf;
  // fine grit: crisp micro relief so faces never look moulded
  vec4 e = mix(nz(ROT1 * uvY * 0.45 + 0.43), nz(uvD * 0.45 + 0.43), vf);
  c *= 0.90 + 0.20 * mix(0.5, e.g, fineK);
  c *= 1.0 - 0.18 * joint;
  c *= 1.0 - 0.30 * gully;
  c = mix(c, c * vec3(0.80, 0.82, 0.87), streak * 0.75);

  // volcanic rock: dark basalt with rusty oxidised patches and scoria pits
  vec4 sc = cz(mix(uvY, uvD, step(0.5, vf)) * 0.11 + 0.47);
  {
    vec3 bas = mix(vec3(0.150, 0.138, 0.130), vec3(0.250, 0.175, 0.135), smoothstep(0.45, 0.8, s.meso.g * 0.6 + d.g * 0.4));
    float pit = smoothstep(0.32, 0.12, sc.r) * step(0.35, sc.b) * fineK;
    bas *= (0.80 + 0.40 * d.r) * (1.0 - 0.35 * pit) * (1.0 - 0.35 * joint);
    c = mix(c, bas, volc);
  }

  // facets: geometric (per-triangle) normal plus nearest-sampled facet cells on
  // both vertical planes, blended by the triplanar weights (no hard plane switch)
  vec4 fX = cz(vec2(p.z * 0.055, p.y * 0.085 + p.x * 0.02));
  vec4 fZ = cz(vec2(p.x * 0.055, p.y * 0.085 + p.z * 0.02));
  vec2 ft = mix(fZ.ba, fX.ba, wxz);
  float facetK = near * vf * smoothstep(0.03, 0.08, s.fw);
  vec3 tA = normalize(cross(n, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
  vec3 tB = normalize(cross(tA, n));
  vec3 base = normalize(mix(n, s.fn, 0.25 * near));
  facetN = normalize(base + (tA * (ft.x - 0.5) * 0.20 + tB * (ft.y - 0.5) * 0.15) * facetK);
  c *= mix(1.0, 0.96 + 0.08 * ft.x, facetK);
  // relief for the derivative bump: grooved joints and gullies, ledge steps, grit
  float hgt = 0.55 + 0.20 * (lr - 0.5) * bandK + 0.16 * (d.r - 0.5) + 0.14 * (e.g - 0.5) * fineK
            - 0.18 * joint - 0.30 * gully + 0.04 * led * bandK;
  return mk(c, 0.84 + 0.08 * volc, hgt, 0.13 * near + 0.03 * volc);
}

// Seabed: rippled sand in the shallows, silt and rock in the deep.
vec3 seabedColor(NS s, float depth, out float hgt) {
  vec2 q = s.p.xz + (s.meso.rg - 0.5) * 4.0;
  float rip = sin(dot(q, vec2(1.6, 0.9)) * 2.2 + s.det.r * 4.0) * 0.5 + 0.5;
  vec3 sand = mix(vec3(0.60, 0.50, 0.32), vec3(0.25, 0.245, 0.235), 1.0 - smoothstep(0.22, 0.50, s.temp)) * (0.88 + 0.16 * s.det.g);
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
  // fine, broken caustic net: two small drifting cell layers multiplied, gated by noise
  vec2 w = (nz(p * 0.06 + vec2(t * 0.008, -t * 0.006)).rg - 0.5) * 2.8 + (nz(p * 0.21 - vec2(t * 0.01, 0.0)).gb - 0.5) * 1.1;
  vec2 q1 = (p + w) * (1.0 / 8.5) + vec2(t * 0.011, t * 0.007);
  vec2 q2 = ROT1 * (p - w * 0.7) * (1.0 / 6.3) - vec2(t * 0.008, -t * 0.010);
  float c1 = 1.0 - smoothstep(0.0, 0.10, cz(q1).g);
  float c2 = 1.0 - smoothstep(0.0, 0.10, cz(q2).g);
  float br = smoothstep(0.35, 0.70, nz(p * 0.11 + t * 0.004).g);
  return c1 * c2 * 1.7 * (0.25 + 0.75 * br);
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
void applyOverlay(vec2 p, inout vec3 albedo, inout vec3 emissive, float snowK) {
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
  // derivative before any non-uniform branch
  float fwd = max(fwidth(fo), 1e-4);
  if (own.a < 0.004) return;
  float uniformRegion = step(0.999, fo);
  // distance (in tiles) from the border contour, approximately
  float dist = (fo - 0.5);
  // crisp 2-3 px borders at every zoom; fill strength fades out up close
  // border in screen pixels: a ~1.3 px darker outer edge on the contour, then a
  // ~2.4 px coloured band inside it, so borders read on every biome and zoom
  float px = dist / fwd;
  float edge = (1.0 - smoothstep(1.0, 1.8, px)) * (1.0 - uniformRegion);
  float line = smoothstep(1.0, 1.8, px) * (1.0 - smoothstep(3.4, 4.2, px)) * (1.0 - uniformRegion);
  float glow = exp(-max(dist, 0.0) * 4.5) * (1.0 - uniformRegion);
  // fill: none closer than ~22, ~18% at mid zoom (30-80), >= 40% at map zoom
  float fillAmt = 0.25 * smoothstep(22.0, 32.0, uCamDist) + 0.20 * smoothstep(80.0, 180.0, uCamDist);
  float fillK = smoothstep(22.0, 110.0, uCamDist);
  vec3 col = pow(own.rgb, vec3(2.2)); // overlay colours are authored in sRGB
  float a = own.a;
  // fill saturates on alpha (owners may write partial strength): >= 40% at map zoom
  float aFill = clamp(a * 1.7, 0.0, 1.0);
  // saturation-preserving tint: the kingdom's chroma at the terrain's own luminance
  float la = lum(albedo);
  vec3 tintC = min(col * (la / max(lum(col), 0.03)), vec3(1.0));
  tintC = mix(tintC, col * 0.6, 0.2);
  // snow composites above the territory tint (borders still read)
  float onSnow = 1.0 - 0.85 * snowK;
  albedo = mix(albedo, tintC, min(1.0, aFill * fillAmt * 1.3) * onSnow);
  vec3 lineCol = col * 1.05 + 0.015;
  albedo = mix(albedo, albedo * (1.0 - 0.35 * a) + col * 0.35 * a, glow * mix(0.3, 0.6, fillK) * onSnow);
  float aLine = min(1.0, a * 1.3);
  albedo = mix(albedo, lineCol, line * aLine);
  albedo = mix(albedo, albedo * 0.3 + col * 0.06, edge * aLine * 0.85);
  // gentle self-glow by day, dim at night (lamps and fires must stay brighter)
  emissive += (lineCol * line * 0.9 + col * glow * 0.3) * a * mix(0.05, 0.30, uDay);
}

void terrainSurface() {
  NS s;
  s.p = vWPos;
  s.n = normalize(vWNormal);
  vec2 p = s.p.xz;
  s.fw = length(fwidth(s.p));
  s.fwy = fwidth(s.p.y);
  s.fn = normalize(cross(dFdx(s.p), dFdy(s.p)));
  s.fn *= s.fn.y < 0.0 ? -1.0 : 1.0;
  s.macro = nz(p * (1.0 / 97.0));
  s.meso = nz(ROT1 * p * (1.0 / 23.0));
  s.det = nz(ROT2 * p * (1.0 / 5.3));
  // fine layers only when they can be seen (uniform branch: derivatives stay valid)
  bool fine = uDetail > 0.001;
  s.micro = fine ? nz(ROT3 * p * (1.0 / 1.37)) : vec4(0.5);
  s.cellS = fine ? cz(p * (1.0 / 9.0)) : vec4(0.45, 0.5, 0.5, 0.5);
  s.cellL = cz(ROT1 * p * (1.0 / 37.0));
  vec4 clim = texture2D(uClimTex, p / uWorldSize);
  s.moist = clim.r;
  s.temp = clim.g;
  s.ao = clim.b;
  s.fire = clim.a;

  // ---- organic tile blending
  vec2 warp = (s.meso.rg - 0.5) * 1.6 + (s.det.gb - 0.5) * 0.9 + (s.micro.rg - 0.5) * 0.05;
  vec2 g = p + warp - 0.5;
  vec2 i0 = floor(g);
  vec2 f = g - i0;
  ivec2 c = ivec2(i0);
  float t0 = tileTypeAt(c);
  float t1 = tileTypeAt(c + ivec2(1, 0));
  float t2 = tileTypeAt(c + ivec2(0, 1));
  float t3 = tileTypeAt(c + ivec2(1, 1));
  // noise-jittered blend weights: the jitter vanishes at cell borders (weights stay
  // continuous) but bends every boundary inside the cell, so edges never staircase
  vec2 fj = (s.det.rg - 0.5) * 0.95 + (s.micro.gb - 0.5) * 0.10;
  vec2 sf = smoothstep(0.0, 1.0, clamp(f + fj * f * (1.0 - f) * 4.0, 0.0, 1.0));
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
  float hm = max(max(hv.x, hv.y), max(hv.z, hv.w)) - 0.30;
  vec4 b = max(hv - hm, 0.0) * live;
  b /= max(b.x + b.y + b.z + b.w, 1e-5);

  vec3 albedo = m0.albedo * b.x + m1.albedo * b.y + m2.albedo * b.z + m3.albedo * b.w;
  float rough = m0.rough * b.x + m1.rough * b.y + m2.rough * b.z + m3.rough * b.w;
  // bump relief uses the smooth bilinear weights: with the sharp height-blend
  // weights it stepped at every biome border and drew a dark aliased fringe
  float H = (m0.h * m0.bump) * w.x + (m1.h * m1.bump) * w.y + (m2.h * m2.bump) * w.z + (m3.h * m3.bump) * w.w;
  vec3 emit = m0.emit * b.x + m1.emit * b.y + m2.emit * b.z + m3.emit * b.w;
  vec4 isLava = vec4(equal(vec4(t0, t1, t2, t3), vec4(9.0))) * live;
  vec4 isSnow = vec4(equal(vec4(t0, t1, t2, t3), vec4(7.0))) * live;
  vec4 isIce = vec4(equal(vec4(t0, t1, t2, t3), vec4(15.0))) * live;
  float lavaRaw = dot(isLava, w);
  float snowB = dot(isSnow, b);
  float iceB = dot(isIce, b);

  // ---- soft snow cover: snow edges dissolve into the ground over ~1.5 tiles
  vec2 gs = p + (s.macro.gb - 0.5) * 3.0 + (s.det.rg - 0.5) * 1.2 - 0.5;
  ivec2 cs2 = ivec2(floor(gs));
  vec2 fs2 = smoothstep(0.0, 1.0, fract(gs));
  float s00 = tileTypeAt(cs2) == 7.0 ? 1.0 : 0.0;
  float s10 = tileTypeAt(cs2 + ivec2(1, 0)) == 7.0 ? 1.0 : 0.0;
  float s01 = tileTypeAt(cs2 + ivec2(0, 1)) == 7.0 ? 1.0 : 0.0;
  float s11 = tileTypeAt(cs2 + ivec2(1, 1)) == 7.0 ? 1.0 : 0.0;
  float snowF = mix(mix(s00, s10, fs2.x), mix(s01, s11, fs2.x), fs2.y);
  float anySnow = dot(isSnow, live);
  if (snowF > 0.0 || anySnow > 0.0) {
    float cover = smoothstep(0.22, 0.78, snowF + (s.micro.r - 0.5) * 0.35 + (s.det.b - 0.5) * 0.25) * smoothstep(-0.04, 0.12, s.p.y);
    // warm ages / low frost: snow fields retreat up to the peaks
    if (uMeltH > 0.01) cover *= smoothstep(uMeltH - 2.0, uMeltH + 2.0, s.p.y + (s.det.r - 0.5) * 2.0);
    vec4 bn = b * (1.0 - isSnow);
    float bsum = bn.x + bn.y + bn.z + bn.w;
    vec3 ground = bsum > 1e-4 ? (m0.albedo * bn.x + m1.albedo * bn.y + m2.albedo * bn.z + m3.albedo * bn.w) / bsum : matTundra(s).albedo;
    albedo = mix(ground, matSnow(s).albedo, cover);
    rough = mix(rough, 0.62, cover * (1.0 - snowB));
    snowB = cover;
  }

  // ---- slope driven cliffs
  vec3 nrm = s.n;
  float slopeN = s.n.y + (s.meso.b - 0.5) * 0.10 + (s.det.r - 0.5) * 0.06;
  float cliff = smoothstep(0.745, 0.665, slopeN) * (1.0 - lavaRaw) * (1.0 - iceB);
  // rock ground takes the triplanar rock from moderate slopes up: projected
  // top-down, its detail stretched into a grey smear on any steeper face
  float rockT = dot(vec4(equal(vec4(t0, t1, t2, t3), vec4(8.0))) * live, b);
  cliff = max(cliff, rockT * smoothstep(0.98, 0.78, slopeN + (s.meso.g - 0.5) * 0.08) * (1.0 - lavaRaw) * (1.0 - iceB));
  // a darker, lusher lip of turf along the top of every rock face
  float lip = smoothstep(0.83, 0.75, slopeN) * (1.0 - cliff) * (1.0 - snowB) * (1.0 - dot(vec4(equal(vec4(t0, t1, t2, t3), vec4(0.0))) * live, b));
  albedo = mix(albedo, albedo * vec3(0.72, 0.84, 0.70), lip * 0.8);
  vec3 facetN = nrm;
  if (cliff > 0.001) {
    // ash / lava around: basalt cone rock instead of layered sediment
    float volc = clamp(dot(vec4(equal(vec4(t0, t1, t2, t3), vec4(10.0))) * live, w) * 1.8 + lavaRaw, 0.0, 1.0);
    Mat cm = matCliff(s, volc, facetN);
    // snow clings to ledges that face up
    float snowLedge = snowB * smoothstep(0.55, 0.75, facetN.y + (s.det.g - 0.5) * 0.3);
    // above the snow line steep faces carry snowfields too: rock shows through
    // only on the steepest ribs and in noisy breaks (no white lip on a bare wall)
    float snowSteep = snowB * smoothstep(0.30, 0.58, facetN.y + (s.meso.g - 0.5) * 0.45 + (s.det.b - 0.5) * 0.25);
    snowLedge = max(snowLedge, snowSteep * 0.92);
    cm.albedo = mix(cm.albedo, mix(vec3(0.50, 0.53, 0.60), vec3(0.60, 0.63, 0.68), snowSteep), snowLedge);
    albedo = mix(albedo, cm.albedo, cliff);
    rough = mix(rough, cm.rough, cliff);
    H = mix(H, cm.h * cm.bump, cliff);
    nrm = normalize(mix(nrm, facetN, cliff));
  }

  // ---- seasonal / climate snow: winter, Age of Rime, frost law. Colder ground
  // (higher latitude, higher altitude) whitens first; noisy edges blend in.
  if (uSnowT > -0.15) {
    float sv = uSnowT - s.temp + (s.det.b - 0.5) * 0.05 + (s.meso.r - 0.5) * 0.08;
    float sn = smoothstep(-0.03, 0.03, sv) * smoothstep(-0.02, 0.3, s.p.y) * (1.0 - lavaRaw);
    sn *= mix(1.0, smoothstep(0.55, 0.78, nrm.y), cliff);
    if (sn > 0.001) {
      albedo = mix(albedo, matSnow(s).albedo, sn);
      rough = mix(rough, 0.62, sn);
      snowB = max(snowB, sn);
    }
  }

  // ---- overview relief: at far zoom a map-style hillshade, slope darkening and a
  // cool lift on high ground let ranges read through the green (close-ups unchanged)
  float farR = 1.0 - uDetail;
  if (farR > 0.0 && s.p.y > 0.0) {
    float hs = dot(nrm, normalize(vec3(-0.5, 0.8, -0.35)));
    albedo *= mix(1.0, (0.76 + 0.44 * hs) * mix(0.68, 1.0, smoothstep(0.55, 0.98, nrm.y)), farR * 0.85);
    albedo = mix(albedo, albedo * vec3(0.96, 1.0, 1.08) * 1.14, smoothstep(6.0, 16.0, s.p.y) * 0.5 * farR);
    // biome distinctiveness at map scale: deep blue-green forests, brighter meadows
    albedo = mix(albedo, albedo * vec3(0.80, 0.84, 0.90), snowB * farR * (0.6 + 0.4 * smoothstep(0.4, 0.7, s.macro.g)));
    float forestB = dot(vec4(equal(vec4(t0, t1, t2, t3), vec4(2.0))) * live, b) + 0.6 * dot(vec4(equal(vec4(t0, t1, t2, t3), vec4(3.0))) * live, b);
    float grassB = dot(vec4(equal(vec4(t0, t1, t2, t3), vec4(1.0))) * live, b);
    albedo = mix(albedo, albedo * vec3(0.72, 0.85, 0.92), forestB * farR * 0.6 * (1.0 - snowB));
    // map-scale variety: dry uplands and drier climates toward ochre-khaki,
    // wet lowlands deep green (and a neutral, not olive, desaturation)
    float gv = s.macro.b * 0.6 + s.macro.r * 0.4;
    float dryv = clamp(smoothstep(0.55, 0.25, s.moist) * 0.7 + smoothstep(0.5, 0.75, gv) * 0.5 + smoothstep(2.5, 6.0, s.p.y) * 0.3, 0.0, 1.0);
    vec3 gTint = mix(vec3(0.78, 0.90, 0.80), vec3(1.24, 1.06, 0.68), dryv);
    vec3 gAlb = mix(albedo * gTint, vec3(lum(albedo)) * vec3(1.02, 1.0, 0.9), 0.15);
    albedo = mix(albedo, gAlb, grassB * farR * (1.0 - snowB));
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
  // lava: cooled crust at the pool edge, organic heat glow around it
  float lavaB = dot(isLava, b);
  emit *= mix(1.0, smoothstep(0.2, 0.85, lavaB), step(0.001, lavaB));
  emit += vec3(0.8, 0.15, 0.015) * smoothstep(0.05, 1.0, lavaRaw) * (1.0 - lavaB) * 0.45 * (0.6 + 0.8 * s.meso.r);

  // ---- normals: material bump + seabed ripples
  vec3 nb = fine ? bumpPerturb(s.p, nrm, H * uDetail) : nrm;
  tNormalW = nb;

  // ---- snow sparkle (view dependent, band-limited)
  float snowAll = snowB * (1.0 - cliff * 0.7);
  if (snowAll > 0.01 && fine) {
    vec2 sp = p * 7.0;
    vec2 cid = floor(sp);
    float r = hash12(cid);
    vec3 vd = normalize(cameraPosition - s.p);
    float ph = fract(r * 13.7 + dot(vd, vec3(5.1, 3.7, 4.3)));
    float spark = smoothstep(0.965, 1.0, ph) * smoothstep(0.35, 0.05, length(fract(sp) - 0.5));
    spark *= 1.0 - smoothstep(0.04, 0.14, s.fw);
    emit += uKeyCol * KEYN * spark * 1.2 * snowAll;
  }

  // ---- territory overlay
  applyOverlay(p, albedo, emit, clamp(snowB, 0.0, 1.0));

  tAlbedo = albedo;
  tRough = clamp(rough, 0.04, 1.0);
  tEmissive = emit;
  // baked horizon AO, plus cliff creases
  tAO = mix(0.35, 1.0, s.ao);
  tCloud = cloudShadowAt(p);
  tSpecK = 1.0;
  tCold = 1.0 - smoothstep(0.22, 0.50, s.temp);
}
`;

export const TERRAIN_FRAGMENT_POST = /* glsl */ `
{
  // water column over the seabed
  float depthW = -vWPos.y;
  float cfw = length(fwidth(vWPos.xz));
  if (depthW > 0.0) {
    vec3 vdir = normalize(vWPos - cameraPosition);
    float viewY = abs(vdir.y);
    // caustics are light: modulate the lit seabed in shallow, sunny water
    float cs = (uDetail > 0.001 ? causticsAt(vWPos.xz, uLTime) * uDetail : 0.0) * (1.0 - smoothstep(0.3, 4.5, depthW)) * smoothstep(0.0, 0.35, depthW) * (1.0 - smoothstep(0.06, 0.25, cfw)) * (1.0 - tCold);
    float sunVis = clamp(lum(uKeyCol * KEYN), 0.0, 1.0) * smoothstep(0.0, 0.2, uKeyDir.y) * tCloud;
    gCold = tCold;
    outgoingLight *= 1.0 + cs * 0.45 * sunVis;
    outgoingLight = applyWaterColumn(outgoingLight, depthW, viewY, tCloud);
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
  material.customProgramCacheKey = () => 'worldseed-terrain-v8';
}
