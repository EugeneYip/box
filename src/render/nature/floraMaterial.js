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
#ifndef FLORA_DEPTH
varying vec4 vFState;
varying vec3 vFInfo;
varying vec3 vFWorld;
varying vec3 vFWNormal;
varying float vFOcc;
#endif
float fHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
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
  off += fl * flutter * (0.006 + 0.028 * str * gust) * scale;
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
// petals close up with distance so mid-zoom meadows are not confetti
float fPetal = 1.0 - step(0.5, abs(aInfo.w - 5.0));
float fPetalK = 1.0 - smoothstep(uFlowerFade.x, uFlowerFade.y, distance(fOrigin, cameraPosition));
fLeafK *= mix(1.0, fPetalK, fPetal);
transformed = mix(aPivot, transformed, mix(1.0, fLeafK, max(fLeaf, fPetal)));
#ifndef FLORA_DEPTH
// canopy over units: leaf clusters pull in and thin out (trunks stay)
float fOcc = texelFetch(uOcc, fTile, 0).r * uOccStrength * fLeaf;
transformed = mix(aPivot, transformed, 1.0 - 0.42 * fOcc);
vFOcc = fOcc;
#endif
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
fK *= mix(1.0, 1.0 - smoothstep(uFlowerFade.x, uFlowerFade.y, fDist), fPetal);
transformed.y *= fK;
transformed.xz *= mix(0.35, 1.0, fK);
vec3 fW = fWind(fOrigin, position, aInfo.x, aInfo.y, 1.0) * fK;
mat3 fIM = mat3(instanceMatrix);
transformed += transpose(fIM) * fW / max(dot(fIM[0], fIM[0]), 1e-5);
#ifndef FLORA_DEPTH
vFState = vec4(1.0, fState.g, fState.b, fState.a * 0.6);
vFOcc = 0.0;
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
const float fBayer[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
`;

const FRAG_COLOR = /* glsl */ `
if (vFOcc > 0.01) {
  ivec2 fbp = ivec2(mod(floor(gl_FragCoord.xy), 4.0));
  if ((fBayer[fbp.x + fbp.y * 4] + 0.5) / 16.0 < vFOcc * 0.82) discard;
}
float fLeafM = vFInfo.x;
float fMat = vFInfo.y;
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
// fire: char
float fChar = clamp(max(vFState.g * 1.25, vFState.b), 0.0, 1.0);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.026, 0.022), fChar * 0.92);
// weather
vec3 fWN = normalize(vFWNormal);
float fSnowAmt = uSnowCover * smoothstep(0.3, 0.8, fWN.y) * (1.0 - fChar);
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
else fR = 0.85;
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
float fBack = clamp(-dot(fWN, uSunDir), 0.0, 1.0);
float fTrans = fLeafM * (1.0 - fChar) * (1.0 - fSnowAmt) * uDaylight * (1.0 - fIsSnow);
totalEmissiveRadiance += diffuseColor.rgb * uSunColor * fTrans * (0.05 + 0.2 * fBack * fBack);
// canopy ambient lift: dense foliage never sinks to black in shadow
totalEmissiveRadiance += diffuseColor.rgb * fLeafM * (1.0 - fChar) * (0.035 + 0.06 * uDaylight);
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
