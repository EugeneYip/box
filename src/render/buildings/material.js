import * as THREE from 'three';
import { CAM_CUT } from '../../core/CameraRig.js';

// Shared building material. Per-vertex: color, aTint (kingdom colour mask),
// aGlow (window / lamp mask). Per-instance: iColor (kingdom colour, linear),
// iState = (damage 0..1, burning 0..1, seed, clipY). clipY discards fragments
// above a local height so buildings visibly rise inside their scaffolding.
//
// On a THREE.BatchedMesh (one draw call for every building model, see
// BuildingRenderer DetailBatch) the per-instance colour and state come from
// a float texture instead (`inst`: { value: DataTexture }, two RGBA texels
// per instance: colour, state), indexed by the batch's instance id.
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
    // the close-zoom cutaway (CameraRig CAM_CUT, round 25)
    sh.uniforms.uCut = CAM_CUT.uCut;
    sh.uniforms.uCutD = CAM_CUT.uCutD;
    sh.uniforms.uCutTan = CAM_CUT.uCutTan;
    if (inst) sh.uniforms.uBInst = inst;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aTint;
attribute float aGlow;
attribute vec2 aRoof;
#ifdef USE_BATCHING
uniform highp sampler2D uBInst;
vec4 wsInst(const in float i, const in int k) {
  int size = textureSize(uBInst, 0).x;
  int j = int(i) * 2 + k;
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
varying float vFlags;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_BATCHING
float wsBi = getIndirectIndex(gl_DrawID);
vec4 wsC0 = wsInst(wsBi, 0);
vKCol = wsC0.rgb; vFlags = wsC0.a; vState = wsInst(wsBi, 1);
#else
vKCol = iColor; vState = iState; vFlags = 0.0;
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
uniform float uCut;
uniform float uCutD;
uniform float uCutTan;
varying float vTint;
varying float vGlow;
varying vec3 vKCol;
varying vec4 vState;
varying vec3 vLocal;
varying vec2 vRoof;
varying float vFlags;
float wsHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
// close-zoom cutaway: walls and roofs between the eye and the target open in
// a dithered screen-door round the middle of the frame (round 25)
if (uCut > 0.001) {
  float wsDep = vViewPosition.z;
  float wsR = length(vViewPosition.xy) / max(wsDep * uCutTan, 0.001);
  float wsW = uCut * (1.0 - smoothstep(0.3, 0.62, wsR)) * (1.0 - smoothstep(uCutD - 1.1, uCutD - 0.45, wsDep));
  float wsN = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
  if (wsW > 0.02 && wsW * 1.08 > wsN) discard;
}
${clip ? 'if (vLocal.y > vState.w) discard; if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.5, 0.47, 0.42) * (0.75 + 0.25 * clamp(vLocal.y / max(vState.w, 0.1), 0.0, 1.0));' : ''}
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
    totalEmissiveRadiance += vGlow * wc * (night * mix(1.4, 1.0, powered) * lit * pane * flick + 0.02);
  } else if (vGlow < 2.5) {
    // a red beacon blinking on a mast or tower
    float blink = step(0.55, fract(uTime * 0.7 + vState.z * 3.0));
    totalEmissiveRadiance += vec3(1.0, 0.12, 0.06) * (0.25 + (0.6 + night * 5.0) * blink);
  } else if (vGlow < 3.5) {
    // screens behind the glass: cool blue-white, each window its own
    float lit = step(0.62, wr);
    float sc = 0.8 + 0.2 * sin(uTime * 1.3 + wid * 2.1);
    totalEmissiveRadiance += vec3(0.5, 0.78, 1.0) * (night * 1.3 * lit * sc + 0.08 * lit);
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
