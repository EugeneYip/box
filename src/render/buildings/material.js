import * as THREE from 'three';

// Shared building material. Per-vertex: color, aTint (kingdom colour mask),
// aGlow (window / lamp mask). Per-instance: iColor (kingdom colour, linear),
// iState = (damage 0..1, burning 0..1, seed, clipY). clipY discards fragments
// above a local height so buildings visibly rise inside their scaffolding.
export function createBuildingMaterial(uniforms, { clip = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.84,
    metalness: 0.0,
    side: clip ? THREE.DoubleSide : THREE.FrontSide,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.uniforms.uNight = uniforms.uNight;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aTint;
attribute float aGlow;
attribute vec3 iColor;
attribute vec4 iState;
varying float vTint;
varying float vGlow;
varying vec3 vKCol;
varying vec4 vState;
varying vec3 vLocal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vTint = aTint; vGlow = aGlow; vKCol = iColor; vState = iState; vLocal = position;`,
      );
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
${clip ? 'if (vLocal.y > vState.w) discard;' : ''}
{
  float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  vec3 kc = vKCol;
  vec3 tinted = kc * (0.38 + 2.1 * lum);
  diffuseColor.rgb = mix(diffuseColor.rgb, tinted, vTint);
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
  float wid = floor(vLocal.x * 4.0 + 0.5) * 1.7 + floor(vLocal.z * 4.0 + 0.5) * 2.3 + floor(vLocal.y * 3.0) * 3.1;
  float lit = step(0.22, fract(vState.z * 7.31 + wid * 0.137));
  float flick = 0.88 + 0.12 * sin(uTime * 2.7 + vState.z * 40.0 + wid);
  float night = uNight * (1.0 - vState.x);
  totalEmissiveRadiance += vGlow * vec3(1.0, 0.6, 0.26) * (night * 2.6 * lit * flick + 0.02);
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
