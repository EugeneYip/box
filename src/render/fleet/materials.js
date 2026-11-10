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
vec3 wsRotZ(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z); }
vec3 wsRotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
vec3 wsRotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }
void wsAnim(inout vec3 p, inout vec3 n) {
  float code = aAnim.x;
  float slot = floor(code / 16.0 + 0.001);
  float k = code - slot * 16.0;
  if (slot > 0.5 && abs(slot - 1.0 - iState.w) > 0.5) { p = vec3(0.0, -80.0, 0.0); return; }
  if (k < 0.5) return;
  if (k < 1.5) {
    // square sail: billows forward with the wind, furls up to its yard
    float fill = iAnim.w;
    float furl = iState.z;
    float b = sin(3.14159 * aAnim.y) * sin(3.14159 * clamp(aAnim.z * 0.85 + 0.15, 0.0, 1.0));
    float h = max(0.2, aAnim.w);
    p.x += b * fill * 0.09 * h * (1.0 - furl);
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
    p.z += b * fill * 0.16 * iAnim.y * (1.0 - furl);
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
      .replace('#include <begin_vertex>', `vec3 transformed = wsP;\nvTint = aTint; vGlow = aGlow; vKCol = iColor; vState = iState; vLocal = position;`);
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
    float n1 = wsHash(floor(vLocal * 9.0 + vec3(0.0, -t * 2.4, 0.0)));
    float tongue = smoothstep(0.5, 0.95, n1);
    totalEmissiveRadiance += burn * vec3(1.0, 0.38, 0.08) * (0.2 + 2.0 * tongue) * (0.7 + 0.3 * sin(t * 12.0 + vLocal.z * 9.0));
  }
}`,
      );
  };
  mat.customProgramCacheKey = () => 'wsVehicle';
  return mat;
}

// Shadow depth with the same animation (furled sails, hidden variants).
export function createVehicleDepthMaterial(uniforms) {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${ANIM_GLSL}`).replace('#include <begin_vertex>', `vec3 wsP = position;\nvec3 wsN = vec3(0.0, 1.0, 0.0);\nwsAnim(wsP, wsN);\nvec3 transformed = wsP;`);
  };
  mat.customProgramCacheKey = () => 'wsVehicleDepth';
  return mat;
}

// Wake and bow wave: one instanced quad per vessel, drawn on the water in
// ship-length units (bow at x = +0.5, stern at -0.5). Per instance: iWake
// (x speed 0..1, y beam/length, z time offset, w rowing 0..1).
export function createWakeMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uLight: uniforms.uLight },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
attribute vec4 iWake;
varying vec2 vP;
varying vec4 vW;
void main() {
  vP = position.xz;
  vW = iWake;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`,
    fragmentShader: /* glsl */ `
uniform float uTime;
uniform float uLight;
varying vec2 vP;
varying vec4 vW;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float spd = vW.x;
  if (spd < 0.02) discard;
  float x = vP.x, z = vP.y;
  float az = abs(z);
  float beam = vW.y;
  float t = uTime + vW.z;
  float foam = 0.0;
  // foam hugging the hull at the waterline
  float e = length(vec2(x / 0.52, z / max(0.05, beam * 0.55)));
  foam += smoothstep(0.22, 0.0, abs(e - 1.0)) * (0.35 + 0.65 * spd) * step(x, 0.48);
  // bow wave: two arms spreading back from the stem
  float bx = 0.5 - x;
  if (bx > 0.0) {
    float arm = bx * 0.55 + beam * 0.22;
    float w = 0.03 + bx * 0.035;
    float br = smoothstep(w, 0.0, abs(az - arm)) * exp(-bx * 2.6);
    foam += br * (0.3 + 0.55 * spd) * (0.8 + 0.2 * vnoise(vec2(bx * 9.0 - t * 2.0, z * 9.0)));
  }
  // Kelvin wake: a V from the stern with soft transverse ripples
  float sx = -0.5 - x;
  if (sx > 0.0) {
    float arm = sx * 0.34 + beam * 0.28;
    float w = 0.035 + sx * 0.04;
    float k = smoothstep(w, 0.0, abs(az - arm)) * exp(-sx * 1.25);
    float rip = 0.78 + 0.22 * sin(sx * 22.0 - t * 4.0 + az * 6.0);
    foam += k * rip * spd * 0.65;
    // churned water straight behind
    float cw = beam * 0.32 + sx * 0.1;
    float c = smoothstep(cw, cw * 0.15, az) * exp(-sx * 1.5);
    c *= 0.4 + 0.6 * vnoise(vec2(sx * 7.0 - t * 3.0, z * 12.0));
    foam += c * spd * 0.6;
  }
  // oar splashes along the sides
  if (vW.w > 0.01 && abs(x) < 0.4) {
    float sp = smoothstep(0.08, 0.0, abs(az - beam * 0.95)) * (0.5 + 0.5 * sin(x * 50.0 + t * 6.0)) * (0.5 + 0.5 * sin(t * 3.2));
    foam += sp * vW.w * 0.5;
  }
  foam = clamp(foam, 0.0, 1.0);
  if (foam < 0.01) discard;
  vec3 col = vec3(0.92, 0.96, 1.0) * mix(0.28, 1.0, uLight);
  gl_FragColor = vec4(col, foam * 0.72);
  #include <colorspace_fragment>
}`,
  });
}
