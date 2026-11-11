import * as THREE from 'three';

// Shader patches for the vegetation. Both the flora and the ground-cover
// materials are MeshStandardMaterial (so they keep PBR lighting, shadows and
// fog) with onBeforeCompile injections:
//   * growth: instances read their tile's displayed growth from a per-tile
//     state texture; young plants shrink, leaf clusters pull toward their
//     pivots and trunks thin out (saplings look like saplings)
//   * wind: trunks bend with travelling gusts, leaves flutter
//   * fire: burning tiles char toward black with flickering embers
//   * drought / dying: foliage turns olive -> ochre -> brown
//   * weather: snow settles on upward faces, rain darkens and adds sheen
//   * optional cloud shadows from game.env.cloudShadow
// Matching depth materials apply the same deformation so shadows follow.

export function createSharedUniforms(stateTexture, w, h) {
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  white.needsUpdate = true;
  return {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector4(0.9, 0.4, 0.35, 0) },
    uState: { value: stateTexture },
    uWorldSize: { value: new THREE.Vector2(w, h) },
    uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
    uSunColor: { value: new THREE.Color(1, 0.96, 0.9) },
    uDaylight: { value: 1 },
    uCloudTex: { value: white },
    uCloudParams: { value: new THREE.Vector4(0, 0, 0, 0) },
    uSnowCover: { value: 0 },
    uWet: { value: 0 },
    uFade: { value: new THREE.Vector2(40, 60) },
    uFlowerFade: { value: new THREE.Vector2(28, 40) },
    uOcc: { value: white },
    uOccStrength: { value: 0 },
    uFlutter: { value: 1 },
    uSeason: { value: 1.5 },
    uTempOff: { value: 0 },
    uFungiGlow: { value: 1 },
    uHeightTex: { value: null },
    uHasHeight: { value: 0 },
  };
}

const VERT_PARS = /* glsl */ `
attribute vec4 aInfo;
attribute vec3 aPivot;
uniform float uTime;
uniform vec4 uWind;
uniform sampler2D uState;
uniform vec2 uWorldSize;
uniform vec2 uFade;
uniform vec2 uFlowerFade;
uniform sampler2D uOcc;
uniform float uOccStrength;
uniform float uFlutter;
uniform float uSeason;
uniform float uTempOff;
#ifndef FLORA_DEPTH
varying vec4 vFState;
varying vec3 vFInfo;
varying vec3 vFWorld;
varying vec3 vFWNormal;
varying float vFOcc;
varying vec4 vFSeason;
varying float vFIH;
varying float vFWSnow;
varying vec2 vFGlow;
#endif
float fHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// Season weights (spring, summer, autumn, winter) for a continuous season t in [0,4).
vec4 fSeasonW(float t) {
  vec4 d = abs(vec4(t) - vec4(0.5, 1.5, 2.5, 3.5));
  d = min(d, 4.0 - d);
  vec4 w = clamp(1.0 - d, 0.0, 1.0);
  w = w * w * (3.0 - 2.0 * w);
  return w / max(dot(w, vec4(1.0)), 1e-4);
}
// Per-instance season (trees turn at slightly different times) adjusted for
// climate: hot lands stay summery, cold lands get a full winter.
vec4 fSeasonFor(vec3 origin, float temp) {
  float t = mod(uSeason + (fHash(origin.xz * 0.37 + 3.1) - 0.5) * 0.45, 4.0);
  vec4 w = fSeasonW(t);
  float cold = smoothstep(0.82, 0.5, temp);
  vec4 e = vec4(w.x * mix(0.4, 1.0, cold), w.y, w.z * cold, w.w * cold);
  e.y += 1.0 - dot(e, vec4(1.0));
  return e;
}
vec3 fWind(vec3 origin, vec3 lp, float bend, float flutter, float scale) {
  vec2 dir = uWind.xy;
  float str = uWind.z;
  float t = uTime;
  float ph = fHash(origin.xz) * 6.2831;
  float along = dot(origin.xz, dir);
  float across = dot(origin.xz, vec2(-dir.y, dir.x));
  float gust = 0.55 + 0.45 * sin(along * 0.13 - t * 1.25) * (0.65 + 0.35 * sin(across * 0.07 + t * 0.37));
  float sway = sin(t * 1.4 + ph) * 0.6 + sin(t * 2.45 + ph * 1.7) * 0.3;
  float push = str * (0.6 * gust + 0.4 * sway * (0.35 + 0.65 * gust));
  vec3 off = vec3(dir.x, 0.0, dir.y) * push * bend * 0.2 * scale;
  off += vec3(-dir.y, 0.0, dir.x) * sin(t * 1.13 + ph * 2.0) * str * bend * 0.045 * scale;
  off.y -= abs(push) * bend * 0.05 * scale;
  float fp = dot(lp, vec3(4.1, 3.3, 3.7)) + ph;
  vec3 fl = vec3(sin(t * 6.1 + fp), sin(t * 7.3 + fp * 1.3) * 0.7, cos(t * 5.7 + fp * 0.8));
  off += fl * flutter * uFlutter * (0.006 + 0.028 * str * gust) * scale;
  return off;
}
`;

// Flora: growth morph + wind, in instance-local space.
const FLORA_BEGIN = /* glsl */ `
vec3 transformed = vec3(position);
vec3 fOrigin = instanceMatrix[3].xyz;
ivec2 fTile = clamp(ivec2(floor(fOrigin.xz)), ivec2(0), ivec2(uWorldSize) - 1);
vec4 fState = texelFetch(uState, fTile, 0);
float fG = fState.r;
float fLeaf = aInfo.z;
float fLeafK = mix(0.36, 1.0, smoothstep(0.04, 0.8, fG));
// seasons (per instance, per climate)
float fTemp = texelFetch(uOcc, fTile, 0).g + uTempOff;
vec4 fSW = fSeasonFor(fOrigin, fTemp);
float fDec = 1.0 - step(0.5, abs(aInfo.w - 9.0));
// petals close up with distance so mid-zoom meadows are not confetti, and
// follow the year: abundant in spring, gone in winter
float fPetal = 1.0 - step(0.5, abs(aInfo.w - 5.0));
float fPetalK = (1.0 - smoothstep(uFlowerFade.x, uFlowerFade.y, distance(fOrigin, cameraPosition))) * dot(fSW, vec4(1.15, 1.0, 0.6, 0.06));
fLeafK *= mix(1.0, fPetalK, fPetal);
transformed = mix(aPivot, transformed, mix(1.0, fLeafK, max(fLeaf, fPetal)));
#ifndef FLORA_DEPTH
// canopy over units: leaf clusters pull in and thin out (trunks stay)
float fOcc = texelFetch(uOcc, fTile, 0).r * uOccStrength * fLeaf;
transformed = mix(aPivot, transformed, 1.0 - 0.6 * fOcc);
vFOcc = fOcc;
vFSeason = fSW;
vFIH = fHash(fOrigin.xz + 17.31);
vFWSnow = fSW.w * smoothstep(0.5, 0.3, fTemp);
vFGlow = texelFetch(uOcc, fTile, 0).ba;
#endif
// winter: deciduous leaf clusters pull in to sparse tufts on bare boughs
transformed = mix(aPivot, transformed, 1.0 - 0.28 * fSW.w * fDec);
float fThin = mix(0.42, 1.0, smoothstep(0.0, 0.85, fG));
transformed.xz *= mix(fThin, 1.0, fLeaf);
float fScale = 0.14 + 0.86 * fG;
transformed *= fScale;
float fBurn = clamp(max(fState.g * 1.3, fState.b), 0.0, 1.0);
transformed = mix(transformed, aPivot * fScale, fLeaf * fBurn * 0.45);
vec3 fW = fWind(fOrigin, position, aInfo.x, aInfo.y * (1.0 - fBurn), fScale);
mat3 fIM = mat3(instanceMatrix);
transformed += transpose(fIM) * fW / max(dot(fIM[0], fIM[0]), 1e-5);
#ifndef FLORA_DEPTH
vFState = fState;
vFInfo = vec3(fLeaf, aInfo.w, 0.0);
vFWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
vFWNormal = normalize(mat3(modelMatrix) * (fIM * objectNormal));
#endif
`;

// Ground cover: fades with camera distance, shrinks on burnt tiles.
const GROUND_BEGIN = /* glsl */ `
vec3 transformed = vec3(position);
vec3 fOrigin = instanceMatrix[3].xyz;
ivec2 fTile = clamp(ivec2(floor(fOrigin.xz)), ivec2(0), ivec2(uWorldSize) - 1);
vec4 fState = texelFetch(uState, fTile, 0);
float fDist = distance(fOrigin, cameraPosition);
float fFade = 1.0 - smoothstep(uFade.x, uFade.y, fDist);
float fBurn = clamp(max(fState.g * 1.5, fState.b), 0.0, 1.0);
float fK = fFade * (1.0 - 0.8 * fBurn);
float fPetal = 1.0 - step(0.5, abs(aInfo.w - 5.0));
vec4 fGS = fSeasonW(mod(uSeason + (fHash(fOrigin.xz * 0.37 + 3.1) - 0.5) * 0.45, 4.0));
fK *= mix(1.0, (1.0 - smoothstep(uFlowerFade.x, uFlowerFade.y, fDist)) * dot(fGS, vec4(1.15, 1.0, 0.55, 0.05)), fPetal);
transformed.y *= fK;
transformed.xz *= mix(0.35, 1.0, fK);
vec3 fW = fWind(fOrigin, position, aInfo.x, aInfo.y, 1.0) * fK;
mat3 fIM = mat3(instanceMatrix);
transformed += transpose(fIM) * fW / max(dot(fIM[0], fIM[0]), 1e-5);
#ifndef FLORA_DEPTH
vFState = vec4(1.0, fState.g, fState.b, fState.a * 0.6);
vFOcc = 0.0;
float fGTemp = texelFetch(uOcc, fTile, 0).g + uTempOff;
vFSeason = fSeasonFor(fOrigin, fGTemp);
vFIH = 0.95;
vFGlow = texelFetch(uOcc, fTile, 0).ba;
vFWSnow = vFSeason.w * smoothstep(0.48, 0.3, fGTemp);
vFInfo = vec3(aInfo.z, aInfo.w, fK);
vFWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
vFWNormal = normalize(mat3(modelMatrix) * (fIM * objectNormal));
#endif
`;

const COLOR_VERTEX = /* glsl */ `
vColor = vec3(1.0);
vColor *= color;
#ifdef USE_INSTANCING_COLOR
  float fIsSnowV = 1.0 - step(0.5, abs(aInfo.w - 3.0));
  #ifdef FLORA_GROUND
    vColor *= mix(instanceColor, vec3(1.0), 1.0 - step(0.5, abs(aInfo.w - 5.0)));
  #else
    vColor *= mix(vec3(1.0), instanceColor, aInfo.z * (1.0 - fIsSnowV));
  #endif
#endif
`;

const FRAG_PARS = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uDaylight;
uniform sampler2D uCloudTex;
uniform vec4 uCloudParams;
uniform float uSnowCover;
uniform float uWet;
varying vec4 vFState;
varying vec3 vFInfo;
varying vec3 vFWorld;
varying vec3 vFWNormal;
varying float vFOcc;
varying vec4 vFSeason;
varying float vFIH;
varying float vFWSnow;
varying vec2 vFGlow;
uniform float uFungiGlow;
vec3 fGlowPal(float hue) { return hue < 0.25 ? vec3(0.05, 0.85, 0.6) : hue < 0.75 ? vec3(0.55, 0.22, 1.0) : vec3(1.0, 0.55, 0.08); }
float fVHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
float fVNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(fVHash(i), fVHash(i + vec3(1.0, 0.0, 0.0)), f.x);
  float b = mix(fVHash(i + vec3(0.0, 1.0, 0.0)), fVHash(i + vec3(1.0, 1.0, 0.0)), f.x);
  float c = mix(fVHash(i + vec3(0.0, 0.0, 1.0)), fVHash(i + vec3(1.0, 0.0, 1.0)), f.x);
  float d = mix(fVHash(i + vec3(0.0, 1.0, 1.0)), fVHash(i + vec3(1.0, 1.0, 1.0)), f.x);
  return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}
const float fBayer[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
`;

const FRAG_COLOR = /* glsl */ `
float fLeafM = vFInfo.x;
float fMat = vFInfo.y;
if (abs(fMat - 11.0) < 0.5) {
  diffuseColor.rgb *= mix(vec3(1.0), fGlowPal(vFGlow.y), 0.45 * (1.0 - smoothstep(16.0, 42.0, distance(vFWorld, cameraPosition))));
}
float fCell = fract(sin(dot(floor(vFWorld * 6.0), vec3(12.9898, 78.233, 45.164))) * 43758.5453);
if (abs(fMat - 9.0) < 0.5) {
  vec4 sw = vFSeason;
  vec3 base = diffuseColor.rgb;
  float lum = dot(base, vec3(0.3, 0.59, 0.11));
  vec3 spring = base * vec3(1.06, 1.15, 0.78) + vec3(0.012, 0.02, 0.0);
  vec3 summer = base * vec3(0.9, 1.0, 0.86);
  vec3 aHue = vFIH < 0.34 ? vec3(0.80, 0.40, 0.03) : vFIH < 0.68 ? vec3(0.70, 0.15, 0.03) : vec3(0.86, 0.60, 0.06);
  vec3 autumn = mix(base, aHue * (0.5 + lum * 2.2), smoothstep(0.12, 0.55, sw.z + (fCell - 0.5) * 0.45));
  // winter: a grey-brown mass of bare twigs (no white puffs)
  vec3 winter = mix(vec3(0.17, 0.13, 0.1), vec3(0.27, 0.2, 0.14), fCell) * (0.75 + lum * 0.8);
  diffuseColor.rgb = spring * sw.x + summer * sw.y + autumn * sw.z + winter * sw.w;
  // bare crowns read as lace: holes cut by world-space noise (stable, no screen-door)
  if (sw.w > 0.15) {
    float lace = fVNoise(vFWorld * 9.0 + vFIH * 17.0) * 0.65 + fVNoise(vFWorld * 23.0) * 0.35;
    if (lace < (sw.w - 0.15) * 0.68) discard;
  }
  // spring blossom (pink or white) on some trees
  // soft scattered blossom clusters (smooth value noise) within the green,
  // mostly on upward faces, on about a third of the trees
  float bn = fVNoise(vFWorld * 11.0 + vFIH * 31.0);
  float up = smoothstep(-0.4, 0.5, normalize(vFWNormal).y);
  float bloom = step(fract(vFIH * 7.13), 0.34) * smoothstep(0.3, 0.8, sw.x) * smoothstep(0.6, 0.7, bn) * up;
  vec3 bc = fract(vFIH * 13.7) < 0.8 ? vec3(0.84, 0.3, 0.46) : vec3(0.9, 0.74, 0.78);
  bc = mix(bc, vec3(0.95, 0.86, 0.88), smoothstep(0.72, 0.82, bn) * 0.45);
  diffuseColor.rgb = mix(diffuseColor.rgb, bc, bloom * 0.9);
  // winter thinning
}
if (abs(fMat - 8.0) < 0.5) {
  vec4 sw = vFSeason;
  float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.48, 0.16) * (0.4 + lum * 1.5), sw.z * 0.4);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * vec3(0.95, 0.92, 0.85), sw.w * 0.45);
}
float fIsSnow = 1.0 - step(0.5, abs(fMat - 3.0));
float fLum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
// wheat ripens from green to gold
if (abs(fMat - 6.0) < 0.5) {
  vec3 young = vec3(0.10, 0.27, 0.045) * (0.45 + fLum * 1.6);
  vec3 mid = vec3(0.34, 0.42, 0.08) * (0.45 + fLum * 1.6);
  float g = vFState.r;
  vec3 c = mix(young, mid, smoothstep(0.35, 0.65, g));
  diffuseColor.rgb = mix(c, diffuseColor.rgb, smoothstep(0.6, 0.95, g));
}
// drought / dying foliage
float fDry = vFState.a * fLeafM * (1.0 - fIsSnow);
vec3 fDryC = mix(vec3(0.46, 0.34, 0.09), vec3(0.28, 0.16, 0.06), smoothstep(0.5, 1.0, fDry)) * (0.55 + fLum * 1.4);
diffuseColor.rgb = mix(diffuseColor.rgb, fDryC, smoothstep(0.0, 0.85, fDry));
// foliage settles into the night instead of keeping its daytime brilliance
diffuseColor.rgb *= mix(1.0, mix(0.62, 1.0, clamp(uDaylight, 0.0, 1.0)), fLeafM * (1.0 - fIsSnow));
// fire: char
float fChar = clamp(max(vFState.g * 1.25, vFState.b), 0.0, 1.0);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.026, 0.022), fChar * 0.92);
// weather
vec3 fWN = normalize(vFWNormal);
float fIsDec = 1.0 - step(0.5, abs(fMat - 9.0));
float fSnowAmt = max(uSnowCover, vFWSnow * 0.85) * smoothstep(0.3, 0.8, fWN.y) * (1.0 - fChar) * (1.0 - 0.78 * fIsDec);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 0.99), fSnowAmt);
diffuseColor.rgb *= 1.0 - uWet * 0.16 * (1.0 - fIsSnow) * (1.0 - fSnowAmt);
`;

const FRAG_ROUGH = /* glsl */ `
float fR = 0.88;
if (fMat < 0.5) fR = 0.92;
else if (fMat < 1.5) fR = 0.74;
else if (fMat < 2.5) fR = 0.86;
else if (fMat < 3.5) fR = 0.5;
else if (fMat < 4.5) fR = 0.34;
else if (fMat < 5.5) fR = 0.62;
else if (fMat < 6.5) fR = 0.7;
else if (fMat < 7.5) fR = 0.58;
else if (fMat < 8.5) fR = 0.85;
else if (fMat < 9.5) fR = 0.74;
else if (fMat < 10.5) fR = 0.36;
else fR = 0.42;
roughnessFactor = mix(fR, fR * 0.55, uWet);
`;

const FRAG_EMISSIVE = /* glsl */ `
float fFire = vFState.g;
if (fFire > 0.002) {
  // sparse, flickering embers glowing through blackened wood and leaves
  vec3 fq = vFWorld * 9.0 + vec3(0.0, uTime * 0.6, 0.0);
  float n1 = fract(sin(dot(floor(fq), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  float n2 = fract(sin(dot(floor(vFWorld * 3.0), vec3(39.34, 11.13, 83.17))) * 24634.6345);
  float flick = 0.5 + 0.5 * sin(uTime * (6.0 + n1 * 7.0) + n1 * 6.283);
  float ember = smoothstep(0.72, 1.0, n1) * flick * (0.6 + 0.8 * n2);
  float smoulder = 0.04 + 0.08 * n2 * (1.0 - fLeafM * 0.5);
  totalEmissiveRadiance += mix(vec3(1.0, 0.22, 0.03), vec3(1.0, 0.55, 0.12), ember) * fFire * (smoulder + 3.0 * ember);
}
// bioluminescent glowcaps: teal, violet or amber, brightening as night falls
if (abs(fMat - 11.0) < 0.5) {
  float night = clamp(1.0 - uDaylight, 0.0, 1.0);
  float pulse = 0.8 + 0.2 * sin(uTime * 1.3 + vFIH * 40.0);
  float gDist = smoothstep(16.0, 42.0, distance(vFWorld, cameraPosition));
  totalEmissiveRadiance += fGlowPal(vFGlow.y) * (0.05 + 0.85 * night) * pulse * uFungiGlow * (1.0 - gDist);
}
// light from nearby glowcap groves falls on trunks, caps, bushes and grass
if (vFGlow.x > 0.01 && uFungiGlow > 0.001) {
  float night = clamp(1.0 - uDaylight * 1.2, 0.0, 1.0);
  totalEmissiveRadiance += fGlowPal(vFGlow.y) * vFGlow.x * night * uFungiGlow * (0.06 + 0.9 * diffuseColor.rgb);
}
float fBack = clamp(-dot(fWN, uSunDir), 0.0, 1.0);
float fTrans = fLeafM * (1.0 - fChar) * (1.0 - fSnowAmt) * uDaylight * (1.0 - fIsSnow);
totalEmissiveRadiance += diffuseColor.rgb * uSunColor * fTrans * (0.05 + 0.2 * fBack * fBack);
// canopy ambient lift: dense foliage never sinks to black in shadow
totalEmissiveRadiance += diffuseColor.rgb * fLeafM * (1.0 - fChar) * 0.09 * uDaylight * uDaylight;
`;

const FRAG_LIGHT = /* glsl */ `
if (uCloudParams.w > 0.0) {
  vec2 fCuv = (vFWorld.xz + uCloudParams.xy) * uCloudParams.z;
  float fCs = 1.0 - uCloudParams.w * texture2D(uCloudTex, fCuv).r;
  reflectedLight.directDiffuse *= fCs;
  reflectedLight.directSpecular *= fCs;
}
`;

function patch(shader, shared, kind, depth) {
  for (const k in shared) shader.uniforms[k] = shared[k];
  const defs = (depth ? '#define FLORA_DEPTH\n' : '') + (kind === 'ground' ? '#define FLORA_GROUND\n' : '');
  shader.vertexShader = defs + shader.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_PARS);
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', kind === 'ground' ? GROUND_BEGIN : FLORA_BEGIN);
  if (depth) return;
  shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', COLOR_VERTEX);
  shader.fragmentShader = defs + shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
    .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + FRAG_ROUGH)
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FRAG_EMISSIVE)
    .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + FRAG_LIGHT);
}

// Ground decals: soft additive glow pools under glowcap groves (night only)
// and a multiplicative contact-shadow blob under trees.
export function createDecalMaterials(shared) {
  // Each decal is a small grid that follows the terrain (sampled from
  // game.terrain.heightTexture) so it hugs slopes instead of clipping.
  const common = /* glsl */ `
    uniform sampler2D uHeightTex;
    uniform float uHasHeight;
    uniform sampler2D uOcc;
    uniform vec2 uWorldSize;
    varying vec2 vUv;
    varying float vPh;
    float fHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float groundAt(vec2 xz, float fallback) {
      if (uHasHeight < 0.5) return fallback;
      return texture2D(uHeightTex, xz / uWorldSize).r;
    }`;
  const glow = new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uDaylight: shared.uDaylight, uFungiGlow: shared.uFungiGlow, uHeightTex: shared.uHeightTex, uHasHeight: shared.uHasHeight, uOcc: shared.uOcc, uWorldSize: shared.uWorldSize },
    vertexShader: common + /* glsl */ `
      varying vec3 vCol;
      varying float vNear;
      vec3 fGlowPal(float hue) { return hue < 0.25 ? vec3(0.05, 0.85, 0.6) : hue < 0.75 ? vec3(0.55, 0.22, 1.0) : vec3(1.0, 0.55, 0.08); }
      void main() {
        vUv = uv;
        vec3 o = instanceMatrix[3].xyz;
        vec4 wp = instanceMatrix * vec4(position, 1.0);
        wp.y = groundAt(wp.xz, o.y) + 0.06;
        ivec2 t = clamp(ivec2(floor(o.xz)), ivec2(0), ivec2(uWorldSize) - 1);
        vCol = fGlowPal(texelFetch(uOcc, t, 0).a);
        // pools shrink to faint glints with distance (no bokeh blobs at mid zoom)
        vNear = 1.0 - smoothstep(16.0, 40.0, distance(o, cameraPosition));
        vPh = fHash(o.xz) * 40.0;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vCol;
      varying float vPh;
      varying float vNear;
      uniform float uTime;
      uniform float uDaylight;
      uniform float uFungiGlow;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = exp(-d * d * 5.0) * (1.0 - smoothstep(0.55, 0.95, d));
        float night = clamp(1.0 - uDaylight * 1.2, 0.0, 1.0);
        float pulse = 0.8 + 0.2 * sin(uTime * 1.3 + vPh);
        gl_FragColor = vec4(vCol * a * night * uFungiGlow * pulse * 0.5 * vNear, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  glow.name = 'nature-fungi-glow';
  // Contact shadow: a soft blob at the trunk stretched away from the sun so
  // trees read as casting a shadow even when the sun's shadow map is faint.
  const ao = new THREE.ShaderMaterial({
    uniforms: { uSunDir: shared.uSunDir, uDaylight: shared.uDaylight, uHeightTex: shared.uHeightTex, uHasHeight: shared.uHasHeight, uOcc: shared.uOcc, uWorldSize: shared.uWorldSize },
    vertexShader: common + /* glsl */ `
      uniform vec3 uSunDir;
      varying float vLen;
      void main() {
        vUv = uv;
        vec3 o = instanceMatrix[3].xyz;
        float size = length(instanceMatrix[0].xyz);
        vec2 dir = -normalize(uSunDir.xz + vec2(1e-4));
        float len = clamp(0.55 / max(uSunDir.y, 0.25), 0.4, 1.8);
        vec2 local = position.xz * size;
        local += dir * dot(local, dir) * (len * 0.55);
        vec2 xz = o.xz + local + dir * size * len * 0.22;
        vec4 wp = vec4(xz.x, groundAt(xz, o.y) + 0.035, xz.y, 1.0);
        vLen = len;
        vPh = 0.0;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uDaylight;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.1, d);
        float k = 0.2 + 0.36 * clamp(uDaylight, 0.0, 1.0);
        gl_FragColor = vec4(vec3(1.0 - k * a), 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.ZeroFactor,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  ao.name = 'nature-contact-ao';
  const geo = new THREE.PlaneGeometry(1, 1, 2, 2).rotateX(-Math.PI / 2);
  return { glow, ao, geo };
}

export function createMaterials(shared) {
  const make = (kind) => {
    // Flora: closed canopies cull back faces (thin parts carry both windings).
    // Ground cover blades are single sheets, so they render double-sided.
    const side = kind === 'ground' ? THREE.DoubleSide : THREE.FrontSide;
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side });
    m.onBeforeCompile = (s) => patch(s, shared, kind, false);
    m.customProgramCacheKey = () => 'worldseed-' + kind;
    m.name = 'nature-' + kind;
    const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side });
    d.onBeforeCompile = (s) => patch(s, shared, kind, true);
    d.customProgramCacheKey = () => 'worldseed-' + kind + '-depth';
    d.name = 'nature-' + kind + '-depth';
    return { material: m, depth: d };
  };
  return { flora: make('flora'), ground: make('ground') };
}
