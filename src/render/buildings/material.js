import * as THREE from 'three';
import { CAM_CUT, CUT_N } from '../../core/CameraRig.js';

// Shared building material. Per-vertex: color, aTint (kingdom colour mask),
// aGlow (window / lamp mask). Per-instance: iColor (kingdom colour, linear),
// iState = (damage 0..1, burning 0..1, seed, clipY). clipY discards fragments
// above a local height so buildings visibly rise inside their scaffolding.
//
// On a THREE.BatchedMesh (one draw call for every building model, see
// BuildingRenderer DetailBatch) the per-instance colour and state come from
// a float texture instead (`inst`: { value: DataTexture }, INST_TEXELS RGBA
// texels per instance: colour, state, cut), indexed by the batch's instance id.
export const INST_TEXELS = 3;
// (round 37) how far a cut piece is faded, from its building's eased share
// times the overall strength: sharpened, so between 12 and 17 tiles (the
// overall strength part way) and on slow frames (the share part way for a
// frame or two) a building is either whole or gone, never left standing as
// a screen-door ghost; it passes through the dither in a moment
export const CUT_SHARE = 'float cutShare(float s) { return smoothstep(0.25, 0.75, s); }';
export function createBuildingMaterial(uniforms, { clip = false, inst = null } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.84,
    metalness: 0.0,
    side: clip ? THREE.DoubleSide : THREE.FrontSide,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.uniforms.uNight = uniforms.uNight;
    sh.uniforms.uSnow = uniforms.uSnow || { value: 0 };
    // the close-zoom cutaway (CameraRig CAM_CUT): its overall strength; each
    // instance's own share is texel 2 of its instance data
    sh.uniforms.uCut = CAM_CUT.uCut;
    if (inst) sh.uniforms.uBInst = inst;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aTint;
attribute float aGlow;
attribute vec2 aRoof;
uniform float uCut;
${CUT_SHARE}
#ifdef USE_BATCHING
uniform highp sampler2D uBInst;
vec4 wsInst(const in float i, const in int k) {
  int size = textureSize(uBInst, 0).x;
  int j = int(i) * ${INST_TEXELS} + k;
  return texelFetch(uBInst, ivec2(j % size, j / size), 0);
}
#else
attribute vec3 iColor;
attribute vec4 iState;
#endif
varying vec2 vRoof;
varying float vTint;
varying float vGlow;
varying vec3 vKCol;
varying vec4 vState;
varying vec3 vLocal;
varying float vFlags;
varying float vCut;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_BATCHING
float wsBi = getIndirectIndex(gl_DrawID);
vec4 wsC0 = wsInst(wsBi, 0);
vKCol = wsC0.rgb; vFlags = wsC0.a; vState = wsInst(wsBi, 1);
vCut = cutShare(wsInst(wsBi, 2).x * uCut);
#else
vKCol = iColor; vState = iState; vFlags = 0.0; vCut = 0.0;
#endif
vTint = aTint; vGlow = aGlow; vLocal = position; vRoof = aRoof;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform float uNight;
uniform float uSnow;
varying float vTint;
varying float vGlow;
varying vec3 vKCol;
varying vec4 vState;
varying vec3 vLocal;
varying vec2 vRoof;
varying float vFlags;
varying float vCut;
float wsHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
// (round 37) The close-zoom cutaway: a building the camera flagged (on the
// sight line to the target, or close in front of the eye) fades out whole,
// every piece of it at once (walls, roof, plinth, rods, balconies, panels:
// the cut is written per instance, so nothing of a neighbour is touched),
// through an even ordered dither, and is gone when the fade is done; the
// renderer draws a faint outline of its plot on the ground instead. (Round
// 29's level cut at the sight line was judged by world boxes that reached
// into the neighbours, left their glass open round a cage of frame rods,
// showed the open walls' insides and darkened the plinths into slabs.)
if (vCut > 0.001) {
  const float wsBayer[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  float wsTh = (wsBayer[int(mod(gl_FragCoord.x, 4.0)) + 4 * int(mod(gl_FragCoord.y, 4.0))] + 0.5) / 16.0;
  if (vCut > wsTh || vCut > 0.9) discard;
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
${clip ?'if (vLocal.y > vState.w) discard; if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.5, 0.47, 0.42) * (0.75 + 0.25 * clamp(vLocal.y / max(vState.w, 0.1), 0.0, 1.0));' : ''}
// roof surface detail: courses, tiles, slate, turf, eave shadow, weathering
if (vRoof.x > 0.5) {
  float kind = vRoof.x;
  float v = vRoof.y;
  float along = vLocal.x * 0.8 + vLocal.z * 0.6;
  float courses = kind < 1.5 ? 8.0 : kind < 2.5 ? 11.0 : kind < 3.5 ? 13.0 : 5.0;
  float row = v * courses;
  float fr = fract(row);
  float ri = floor(row);
  float lip = mix(0.74, 1.0, smoothstep(0.0, 0.3, fr));
  float m = 1.0;
  if (kind < 1.5) {
    float st = wsHash(vec3(floor(along * 46.0), ri, 1.0));
    float st2 = wsHash(vec3(floor(along * 17.0 + 0.5), ri, 4.0));
    m = lip * (0.88 + 0.1 * st + 0.06 * st2);
  } else if (kind < 3.5) {
    float cols = kind < 2.5 ? 9.0 : 12.0;
    float c = along * cols + mod(ri, 2.0) * 0.5;
    float fc = fract(c);
    float joint = smoothstep(0.0, 0.07, fc) * smoothstep(1.0, 0.93, fc);
    float tv = wsHash(vec3(floor(c), ri, 2.0 + vState.z));
    m = lip * (0.8 + 0.2 * joint) * (0.88 + 0.2 * tv);
  } else {
    float tv = wsHash(vec3(floor(along * 12.0), floor(v * 9.0), 3.0));
    m = 0.84 + 0.22 * tv;
  }
  m *= mix(0.6, 1.0, smoothstep(0.0, 0.09, v));
  float wear = wsHash(vec3(floor(along * 2.5), floor(v * 3.0), vState.z * 9.0));
  diffuseColor.rgb *= m * (0.92 + 0.1 * wear);
  if (kind < 1.5 || kind > 3.5) diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.8, 0.92, 0.62), 0.3 * (1.0 - v) * wear);
  // winter: snow settles on sod and slate roofs (the northern styles)
  if (kind > 2.5 && uSnow > 0.001) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.97), uSnow * (kind > 3.5 ? 0.88 : 0.62) * (0.75 + 0.25 * wear));
}
{
  float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  vec3 kc = vKCol;
  vec3 tinted = kc * (0.38 + 2.1 * lum);
  diffuseColor.rgb = mix(diffuseColor.rgb, tinted, vTint);
  // night: unlit walls fall dark and only the windows glow (pale tower
  // walls and the white Future drums read as lanterns under the moon and
  // the night bloom). Pale surfaces darken most; window glass darkens too,
  // so its lit cells (emissive, below) stand out against dark panes.
  float wsLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  float wsGl = step(0.05, vGlow) * step(vGlow, 1.5);
  // green roofs (turf, garden terraces) grey and darken under the moon, as
  // the lawns below do (round 28: they stayed a lit green at night)
  float wsGr = smoothstep(0.01, 0.07, diffuseColor.g - max(diffuseColor.r, diffuseColor.b)) * (1.0 - wsGl);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(wsLum) * vec3(0.42, 0.47, 0.52), wsGr * uNight * 0.75);
  // (round 25: pale civic buildings and the white Future cylinders still
  // read as lanterns at night: pale walls now keep under a fifth of their
  // daylight colour, so only the lit windows carry them)
  diffuseColor.rgb *= 1.0 - uNight * mix(0.2 + 0.64 * smoothstep(0.22, 0.75, wsLum), 0.6, wsGl);
  float dmg = vState.x;
  if (dmg > 0.0) {
    float n = wsHash(floor(vLocal * 6.0) + vState.z * 13.0);
    float soot = smoothstep(0.2, 0.9, n + dmg * 0.6);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.22, 0.2, 0.19), dmg * soot);
  }
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  // instance flags: 1 powered town (electric light), 2 floodlit heritage
  float powered = mod(vFlags, 2.0);
  float flood = mod(floor(vFlags * 0.5 + 0.01), 2.0);
  float wid = floor(vLocal.x * 4.0 + 0.5) * 1.7 + floor(vLocal.z * 4.0 + 0.5) * 2.3 + floor(vLocal.y * 3.0) * 3.1;
  // each window cell's own random number (a hash, so lit and dark windows
  // scatter instead of running in diagonal stripes)
  float wr = wsHash(vec3(floor(vLocal.x * 4.0 + 0.5) + floor(vLocal.z * 4.0 + 0.5) * 7.0 + 0.37, floor(vLocal.y * 3.0) + 0.61, fract(vState.z * 3.17) * 19.0 + 2.3));
  float night = uNight * (1.0 - vState.x);
  if (vGlow < 1.5) {
    // windows: warm lamplight, or steadier electric light in a powered town.
    // Each window cell is lit or dark on its own (35-60% lit, a share of its
    // own per building), with a dark frame between floors and panes, and a
    // capped brightness, so a tower at night is a grid of lights under bloom,
    // never a solid white bar. Electric light mixes warm and cool windows.
    // (towers at 22:00 read fully lit: the upper floors of a tall block
    // light fewer windows, and electric light is a little dimmer)
    // (towers at 22:00 still read ~75% lit: electric light now 26-46% of
    // the windows, 20-36% on the upper floors, and the lamplight of a tall
    // block in an unpowered town no more than 40%, not a cottage's 80%)
    float share = mix(0.26, 0.46, fract(vState.z * 13.7)) * mix(1.0, 0.78, smoothstep(1.4, 3.0, vLocal.y));
    float lit = step(1.0 - mix(mix(0.8, 0.4, smoothstep(1.3, 2.6, vLocal.y)), share, powered), wr);
    float fy = fract(vLocal.y * 3.0);
    float fa = fract((vLocal.x + vLocal.z) * 4.0 + 0.5);
    float pane = smoothstep(0.06, 0.16, fy) * smoothstep(0.94, 0.82, fy) * mix(1.0, smoothstep(0.08, 0.18, fa) * smoothstep(0.92, 0.82, fa), powered);
    float flick = mix(0.88 + 0.12 * sin(uTime * 2.7 + vState.z * 40.0 + wid), 1.0, powered);
    float cool = step(0.62, fract(wr * 17.3)) * powered;
    vec3 wc = mix(vec3(1.0, 0.6, 0.26), mix(vec3(1.0, 0.8, 0.52), vec3(0.72, 0.86, 1.0), cool), powered);
    // (round 35: no glow by day; a faint warm floor on every window cell
    // read, on the shaded side of a dark tower, as lit windows at 11:00)
    totalEmissiveRadiance += vGlow * wc * night * (mix(1.4, 1.0, powered) * lit * pane * flick + 0.02);
  } else if (vGlow < 2.5) {
    // a red beacon blinking on a mast or tower
    float blink = step(0.55, fract(uTime * 0.7 + vState.z * 3.0));
    totalEmissiveRadiance += vec3(1.0, 0.12, 0.06) * (0.25 + (0.6 + night * 5.0) * blink);
  } else if (vGlow < 3.5) {
    // screens behind the glass: cool blue-white, each window its own
    float lit = step(0.62, wr);
    float sc = 0.8 + 0.2 * sin(uTime * 1.3 + wid * 2.1);
    totalEmissiveRadiance += vec3(0.5, 0.78, 1.0) * night * (1.3 * sc + 0.08) * lit;
  } else if (vGlow < 4.5) {
    // the steady cyan light of the future (fusion rings, crowns)
    totalEmissiveRadiance += vec3(0.4, 0.95, 1.0) * (0.5 + night * 1.0) * (0.88 + 0.12 * sin(uTime * 2.0 + vLocal.y * 4.0 + vLocal.x * 2.0));
  } else {
    // a lamp head: bright at night only
    totalEmissiveRadiance += vec3(1.0, 0.86, 0.6) * (night * 2.3 + 0.03);
  }
  // heritage: soft floodlight washing up the walls at night
  // (a low wash at the foot of the walls only: it lit whole pale facades)
  if (flood > 0.5) totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.84, 0.62) * night * 0.6 * (1.0 - smoothstep(0.05, 0.9, vLocal.y));
  float burn = vState.y;
  if (burn > 0.001) {
    float t = uTime;
    float n1 = wsHash(floor(vLocal * 8.0 + vec3(0.0, -t * 2.2, 0.0)));
    float n2 = wsHash(floor(vLocal * 5.0 + vec3(t * 0.7, -t * 1.4, 0.0)) + 3.1);
    float tongue = smoothstep(0.45, 0.95, max(n1, n2 * 0.9));
    float fl = 0.65 + 0.35 * sin(t * 13.0 + vLocal.x * 9.0 + vLocal.z * 7.0);
    totalEmissiveRadiance += burn * vec3(1.0, 0.36, 0.07) * (0.25 + 2.2 * tongue) * fl;
  }
}`,
      );
  };
  mat.customProgramCacheKey = () => 'wsBuilding' + (clip ? '-clip' : '');
  return mat;
}

// Plain vertex-coloured material for props (fences, scarecrows, boats).
export function createPropMaterial() {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
}

// (round 33) The close-zoom cutaway (CameraRig CAM_CUT) for the things that
// stand with the buildings but are drawn with materials of their own: the
// realm's standards and their staffs, banners, fences, windmill sails and
// the like. Inside a cut building's plot (CameraRig uCutBox) they fade out
// with it, through the same dither (round 37: they were cut level at the
// building's cut height, and the boxes reached into the neighbours).
export function withCutaway(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, renderer) => {
    if (prev) prev.call(mat, sh, renderer);
    sh.uniforms.uCut = CAM_CUT.uCut;
    sh.uniforms.uCutBox = CAM_CUT.uCutBox;
    sh.uniforms.uCutA = CAM_CUT.uCutA;
    sh.uniforms.uCamW = CAM_CUT.uCamW;
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uCut;
uniform vec4 uCutBox[${CUT_N}];
uniform float uCutA[${CUT_N}];
uniform mat4 uCamW;
${CUT_SHARE}`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
if (uCut > 0.001) {
  vec3 wsCp = (uCamW * vec4(-vViewPosition, 1.0)).xyz;
  float wsCa = 0.0;
  for (int i = 0; i < ${CUT_N}; i++) {
    vec4 bx = uCutBox[i];
    if (wsCp.x > bx.x && wsCp.x < bx.z && wsCp.z > bx.y && wsCp.z < bx.w) wsCa = max(wsCa, uCutA[i]);
  }
  wsCa = cutShare(wsCa * uCut);
  if (wsCa > 0.001) {
    const float wsBayer[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
    float wsTh = (wsBayer[int(mod(gl_FragCoord.x, 4.0)) + 4 * int(mod(gl_FragCoord.y, 4.0))] + 0.5) / 16.0;
    if (wsCa > wsTh || wsCa > 0.9) discard;
  }
}`,
      );
  };
  const key = mat.customProgramCacheKey ? mat.customProgramCacheKey.call(mat) : '';
  mat.customProgramCacheKey = () => key + '|cutaway';
  return mat;
}
