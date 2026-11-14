import * as THREE from 'three';

// Materials of the Fleets renderer.
//
// Vehicle material: the buildings' look (vertex colours, realm tint through
// aTint, night lamps through aGlow, soot when damaged, flames when burning)
// plus vertex animation from aAnim (see models.js). Per instance:
//   iColor (realm colour, linear), iAnim (x row/walk phase, y wheel angle or
//   tack, z catapult arm / ram swing, w sail fill), iState (x damage, y burn,
//   z furl, w variant (land) or oar stroke (sea)).

const ANIM_GLSL = /* glsl */ `
attribute float aTint;
attribute float aGlow;
attribute vec4 aAnim;
attribute vec3 iColor;
attribute vec4 iAnim;
attribute vec4 iState;
uniform float uTime;
float wsHide = 0.0;
vec3 wsRotZ(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z); }
vec3 wsRotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
vec3 wsRotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }
void wsAnim(inout vec3 p, inout vec3 n) {
  float code = aAnim.x;
  float slot = floor(code / 16.0 + 0.001);
  float k = code - slot * 16.0;
  if (slot > 0.5 && abs(slot - 1.0 - iState.w) > 0.5) { wsHide = 1.0; return; }
  if (k < 0.5) return;
  if (k < 1.5) {
    // square sail: billows forward with the wind, furls up to its yard
    float fill = iAnim.w;
    float furl = iState.z;
    float b = sin(3.14159 * aAnim.y) * sin(3.14159 * clamp(aAnim.z * 0.85 + 0.15, 0.0, 1.0));
    float h = max(0.2, aAnim.w);
    p.x += b * fill * 0.14 * h * (1.0 - furl);
    p.x += sin(uTime * 5.0 + aAnim.y * 6.0 + iAnim.x) * 0.012 * (1.0 - fill) * (1.0 - furl);
    p.y = mix(p.y, aAnim.w - 0.03, furl * 0.94);
    float sg = n.x >= 0.0 ? 1.0 : -1.0;
    n = normalize(n + vec3(0.0, -cos(3.14159 * aAnim.z) * 0.35 * fill, -cos(3.14159 * aAnim.y) * 0.6 * fill) * sg);
    return;
  }
  if (k < 2.5) {
    // oar: sweeps fore and aft on its tholepin, the blade lifting on the return
    vec3 pv = aAnim.yzw;
    vec3 o = p - pv;
    float side = pv.z >= 0.0 ? 1.0 : -1.0;
    float amp = iState.w;
    float sweep = sin(iAnim.x) * 0.42 * amp;
    float lift = (cos(iAnim.x) * 0.2 + 0.05) * amp + (1.0 - amp) * 0.55;
    o = wsRotX(o, -lift * side);
    o = wsRotY(o, -sweep * side);
    n = wsRotY(wsRotX(n, -lift * side), -sweep * side);
    p = pv + o;
    return;
  }
  if (k < 3.5) { vec3 pv = aAnim.yzw; p = pv + wsRotZ(p - pv, iAnim.y); n = wsRotZ(n, iAnim.y); return; }
  if (k < 4.5) { float u = aAnim.y; p.z += sin(u * 7.0 - uTime * 9.0 + iAnim.x) * 0.04 * u; return; }
  if (k < 5.5) { vec3 pv = aAnim.yzw; p = pv + wsRotZ(p - pv, -iAnim.z); n = wsRotZ(n, -iAnim.z); return; }
  if (k < 6.5) { p.x += iAnim.z; return; }
  if (k < 8.5) {
    vec3 pv = aAnim.yzw;
    float a = sin(iAnim.x) * 0.5 * (k < 7.5 ? 1.0 : -1.0);
    p = pv + wsRotZ(p - pv, a);
    return;
  }
  if (k < 10.5) {
    // fore-and-aft sail: bellies to leeward, furls along its yard
    float fill = iAnim.w;
    float furl = iState.z;
    float b = sin(3.14159 * aAnim.y) * sin(3.14159 * clamp(aAnim.z, 0.0, 1.0));
    p.z += b * fill * 0.24 * iAnim.y * (1.0 - furl);
    p.y = mix(p.y, aAnim.w - 0.02, furl * 0.92);
    return;
  }
}
`;

export function createVehicleMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.uniforms.uNight = uniforms.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${ANIM_GLSL}\nvarying float vTint;\nvarying float vGlow;\nvarying vec3 vKCol;\nvarying vec4 vState;\nvarying vec3 vLocal;`)
      .replace('#include <beginnormal_vertex>', `vec3 wsP = position;\nvec3 wsN = normal;\nwsAnim(wsP, wsN);\nvec3 objectNormal = wsN;`)
      .replace('#include <begin_vertex>', `vec3 transformed = wsP;\nvTint = aTint; vGlow = aGlow; vKCol = iColor; vState = iState; vLocal = position;`)
      .replace('#include <project_vertex>', `#include <project_vertex>\nif (wsHide > 0.5) gl_Position = vec4(4.0, 4.0, 4.0, 1.0); // hidden variant: clipped away`);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform float uNight;
varying float vTint;
varying float vGlow;
varying vec3 vKCol;
varying vec4 vState;
varying vec3 vLocal;
float wsHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  diffuseColor.rgb = mix(diffuseColor.rgb, vKCol * (0.42 + 1.9 * lum), vTint);
  float dmg = vState.x;
  if (dmg > 0.0) {
    float n = wsHash(floor(vLocal * 7.0) + 3.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.25, 0.22, 0.2), dmg * smoothstep(0.25, 0.9, n + dmg * 0.5));
  }
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  float flick = 0.85 + 0.15 * sin(uTime * 3.1 + vLocal.x * 13.0);
  totalEmissiveRadiance += vGlow * vec3(1.0, 0.62, 0.28) * (uNight * 2.4 * flick + 0.05);
  float burn = vState.y;
  if (burn > 0.001) {
    float t = uTime;
    // flames lick up from the hull: low, warm, flickering (no blocky noise)
    float low = 1.0 - smoothstep(0.1, 1.2, vLocal.y);
    float n1 = 0.5 + 0.5 * sin(vLocal.x * 11.0 + t * 5.0) * sin(vLocal.z * 13.0 - t * 4.0 + vLocal.y * 6.0);
    float tongue = smoothstep(0.5, 0.95, n1);
    totalEmissiveRadiance += burn * low * vec3(1.0, 0.4, 0.1) * (0.15 + 1.1 * tongue) * (0.75 + 0.25 * sin(t * 12.0 + vLocal.z * 9.0));
  }
}`,
      );
  };
  mat.customProgramCacheKey = () => 'wsVehicle';
  return mat;
}

// Shadow depth with the same animation (furled sails, hidden variants).
export function createVehicleDepthMaterial(uniforms) {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${ANIM_GLSL}`).replace('#include <begin_vertex>', `vec3 wsP = position;\nvec3 wsN = vec3(0.0, 1.0, 0.0);\nwsAnim(wsP, wsN);\nvec3 transformed = wsP;`).replace('#include <project_vertex>', `#include <project_vertex>\nif (wsHide > 0.5) gl_Position = vec4(4.0, 4.0, 4.0, 1.0);`);
  };
  mat.customProgramCacheKey = () => 'wsVehicleDepth';
  return mat;
}

// Water effects, one program and one draw call for every vessel and vehicle:
//   kind 0  Kelvin wake arm: a soft band laid along the ship's own track
//           (path history), fading within a few ship lengths
//   kind 1  churned water straight behind the stern, along the track
//   kind 2  hull foam and the bow wave (local quad, uv in ship lengths)
//   kind 3  contact shadow under a land vehicle
//   kind 4  far-zoom dot in the realm's colour (aC), dark rim
//   kind 5  dashed trade lane (LineSegments; aUV.x = distance along)
// Attributes: aUV (x: along / local x, y: across 0..1 / local z),
// aK (x: kind, y: strength 0..1, z: beam in ship lengths, w: distance along).
export function createWaterFxMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uLight: uniforms.uLight, uLaneAlpha: uniforms.uLaneAlpha },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
attribute vec2 aUV;
attribute vec4 aK;
attribute vec3 aC;
varying vec2 vUV;
varying vec4 vK;
varying vec3 vC;
void main() {
  vUV = aUV;
  vK = aK;
  vC = aC;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform float uTime;
uniform float uLight;
uniform float uLaneAlpha;
varying vec2 vUV;
varying vec4 vK;
varying vec3 vC;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float kind = vK.x;
  float a = vK.y;
  vec3 foamCol = vec3(0.92, 0.96, 1.0) * mix(0.3, 1.0, uLight);
  if (kind < 0.5) {
    // a Kelvin arm of broken foam: clumps and flecks that stay put in the
    // water (u runs with the water, not the ship), soft and ragged at the
    // edges, a firmer crest near the stern that frays as it spreads
    float v = vUV.y;
    float u = vUV.x;
    float s = vK.w; // ship lengths behind the stern
    float band = smoothstep(0.0, 0.42, v) * smoothstep(1.0, 0.58, v);
    float n1 = vnoise(vec2(u * 2.6, v * 1.7 + 3.0));
    float n2 = vnoise(vec2(u * 7.5 + 11.0, v * 4.0 - uTime * 0.15));
    float crest = 0.22 * (1.0 - clamp(s * 0.8, 0.0, 1.0));
    float foam = smoothstep(0.34, 0.8, n1 * 0.62 + n2 * 0.48 + crest);
    float al = band * foam * a;
    if (al < 0.01) discard;
    gl_FragColor = vec4(foamCol, min(1.0, al * 0.85));
  } else if (kind < 1.5) {
    // the churn behind the stern: boiling, bubbly, quick to settle
    float v = abs(vUV.y * 2.0 - 1.0);
    float band = 1.0 - v * v;
    float u = vUV.x;
    float n = vnoise(vec2(u * 3.0, vUV.y * 5.0 + uTime * 0.6)) * 0.6 + vnoise(vec2(u * 8.0 - uTime * 0.4, vUV.y * 9.0)) * 0.5;
    float al = band * smoothstep(0.28, 0.85, n) * a;
    if (al < 0.01) discard;
    gl_FragColor = vec4(foamCol, al * 0.6);
  } else if (kind < 2.5) {
    // hull foam at the waterline and a short bow wave
    float x = vUV.x, z = vUV.y;
    float az = abs(z);
    float beam = vK.z;
    float e = length(vec2(x / 0.5, z / max(0.05, beam * 0.55)));
    float foam = smoothstep(0.24, 0.0, abs(e - 1.0)) * (0.3 + 0.7 * a) * smoothstep(0.58, 0.4, x); // soft at the stem, no hard chord
    // the bow wave: two soft fans of broken foam that peel off the stem,
    // curl aft and outward, widen and die away within half a length (no
    // crisp lines; the noise runs aft past the hull with the ship's way)
    float bx = 0.5 - x;
    if (bx > -0.06 && bx < 0.55 && a > 0.02) {
      float t = clamp(bx / 0.55, 0.0, 1.0);
      float c = beam * 0.3 + 0.36 * bx - 0.22 * bx * bx;
      float wdt = 0.02 + 0.1 * t;
      float d = (az - c) / wdt;
      float prof = exp(-d * d * 1.4);
      float n = vnoise(vec2(bx * 13.0 - uTime * 1.3 * a, az * 17.0)) * 0.6 + vnoise(vec2(bx * 29.0 - uTime * 2.1 * a, az * 31.0 + 5.0)) * 0.5;
      float broken = smoothstep(0.3, 0.9, n + (1.0 - t) * 0.3);
      float fade = (1.0 - t) * (1.0 - t) * smoothstep(-0.06, 0.05, bx);
      float edge = beam * 0.5 + 0.38;
      foam += prof * broken * fade * smoothstep(edge, edge - 0.08, az) * (0.15 + 0.85 * a) * 0.8;
    }
    foam = clamp(foam, 0.0, 1.0);
    if (foam < 0.01) discard;
    gl_FragColor = vec4(foamCol, foam * 0.78);
  } else if (kind < 3.5) {
    float r = length(vUV * 2.0 - 1.0);
    float al = (1.0 - smoothstep(0.25, 1.0, r)) * 0.42 * a;
    if (al < 0.01) discard;
    gl_FragColor = vec4(0.0, 0.0, 0.0, al);
  } else if (kind < 4.5) {
    float r = length(vUV * 2.0 - 1.0);
    if (r > 1.0) discard;
    gl_FragColor = vec4(r > 0.78 ? vC * 0.2 : vC * 1.25, 0.95);
  } else {
    float d = fract(vUV.x * 0.7 - uTime * 0.25);
    if (d > 0.55) discard;
    gl_FragColor = vec4(vC * 1.3 + 0.2, uLaneAlpha);
  }
  #include <colorspace_fragment>
}`,
  });
}
