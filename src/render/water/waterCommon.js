import * as THREE from 'three';

// Shared optics for the landscape shaders.
//
// The seabed (terrain shader) and the water surface (water shader) must agree
// on how water absorbs and scatters light, otherwise the shoreline, the map
// edge and the open ocean would show seams. Both shaders include WATER_GLSL
// and read the same uniform objects (one set per Game, see landscapeUniforms).
//
// Model (stylised, physically motivated):
//   seen through water = seabed * T + deep * (1 - Tv)
//   T  = exp(-absorb * (pathDown + pathUp))   colour-dependent transmittance
//   Tv = exp(-absorb * pathUp)                 along the view ray only
// Red is absorbed fastest, so bright sand in the shallows reads turquoise
// and the deep ocean converges to sapphire.

const shared = new WeakMap();

export function landscapeUniforms(game) {
  let u = shared.get(game);
  if (!u) {
    u = {
      uLTime: { value: 0 },
      uSunDirW: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      uSunCol: { value: new THREE.Color(1, 0.96, 0.9) },
      uDay: { value: 1 },
      uSkyCol: { value: new THREE.Color(0.62, 0.77, 0.91) }, // horizon
      uZenCol: { value: new THREE.Color(0.05, 0.19, 0.62) }, // zenith
      uKeyCol: { value: new THREE.Color(3.3, 3.2, 3.0) }, // current key light (sun or moon), intensity-scaled
      uKeyDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      uAmbCol: { value: new THREE.Color(0.4, 0.55, 0.78) },
      uMoonDirW: { value: new THREE.Vector3(-0.4, 0.7, -0.3).normalize() },
      uWorldSize: { value: new THREE.Vector2(game.world.w, game.world.h) },
      uHeightTex: { value: null },
      uCloudTex: { value: null },
      uCloudParams: { value: new THREE.Vector4(0, 0, 0.01, 0) },
      uCloudOn: { value: 0 },
      uWet: { value: 0 },
      uCamDist: { value: 100 },
      uDetail: { value: 1 }, // 1 = full close-up detail .. 0 = far / power-saver path
      uPower: { value: 0 }, // 1 = power saver: fewer texture taps, no triplanar
    };
    shared.set(game, u);
  }
  return u;
}

// Per-frame refresh of the environment-driven shared uniforms (idempotent; the
// first caller each frame does the work). Reads Atmosphere's env fields
// (lightColor/lightDir = current key light already scaled by cloud cover,
// skyColor/horizonColor, ambientColor) with fallbacks for a bare env.
const _c = new THREE.Color();
export function refreshLandscapeUniforms(game, dt) {
  const u = landscapeUniforms(game);
  if (u._frame === game.frame) return u;
  u._frame = game.frame;
  const env = game.env || {};
  const scene = game.scene;
  u.uLTime.value = game.time?.realTime ?? 0;
  if (env.sunDir) u.uSunDirW.value.copy(env.sunDir).normalize();
  if (env.sunColor) u.uSunCol.value.copy(env.sunColor);
  u.uDay.value = env.daylight ?? 1;
  const s = u.uSunDirW.value;
  if (env.moonDir) u.uMoonDirW.value.copy(env.moonDir).normalize();
  else u.uMoonDirW.value.set(-s.x * 0.8 + 0.15, Math.max(0.35, Math.abs(s.y) * 0.8 + 0.3), -s.z * 0.8 - 0.25).normalize();
  // key light: what actually lights the world right now (dimmed by storms)
  if (env.lightColor) u.uKeyCol.value.copy(env.lightColor);
  else u.uKeyCol.value.copy(u.uSunCol.value).multiplyScalar(3.3 * u.uDay.value);
  if (env.lightDir) u.uKeyDir.value.copy(env.lightDir).normalize();
  else u.uKeyDir.value.copy(s);
  // sky colours for reflections: env first, then fog / background
  if (env.horizonColor) _c.copy(env.horizonColor);
  else if (scene?.fog?.color) _c.copy(scene.fog.color);
  else if (scene?.background?.isColor) _c.copy(scene.background);
  else _c.setRGB(0.62, 0.77, 0.91);
  u.uSkyCol.value.copy(_c);
  if (env.skyColor) u.uZenCol.value.copy(env.skyColor);
  else u.uZenCol.value.copy(_c).multiply(_c.clone().setRGB(0.5, 0.68, 1.05));
  if (env.ambientColor) u.uAmbCol.value.copy(env.ambientColor);
  else u.uAmbCol.value.copy(u.uSkyCol.value).multiplyScalar(0.3 + 0.5 * u.uDay.value);
  u.uCamDist.value = game.cameraRig?.cur?.dist ?? 100;
  // cloud shadows from Atmosphere (applied per material to direct light)
  const cs = env.cloudShadow;
  if (cs && cs.texture && cs.params) {
    u.uCloudTex.value = cs.texture;
    u.uCloudParams.value.copy(cs.params);
    u.uCloudOn.value = 1;
  } else {
    u.uCloudOn.value = 0;
  }
  // ground wetness from rain (Atmosphere's env.wetness when present)
  const w = env.weather || {};
  let target = w.type === 'rain' || w.type === 'storm' ? Math.min(1, 0.4 + 0.6 * (w.intensity ?? 1)) : 0;
  if (typeof env.wetness === 'number') target = Math.max(0, Math.min(1, env.wetness));
  const k = 1 - Math.exp(-(dt || 0.016) * (target > u.uWet.value ? 0.35 : 0.12));
  u.uWet.value += (target - u.uWet.value) * k;
  return u;
}

export const WATER_PARS_GLSL = /* glsl */ `
uniform float uLTime;
uniform vec3 uSunDirW;
uniform vec3 uSunCol;
uniform float uDay;
uniform vec3 uSkyCol;
uniform vec3 uZenCol;
uniform vec3 uKeyCol;
uniform vec3 uKeyDir;
uniform vec3 uAmbCol;
uniform vec3 uMoonDirW;
uniform vec2 uWorldSize;
uniform sampler2D uCloudTex;
uniform vec4 uCloudParams;
uniform float uCloudOn;
uniform float uWet;
uniform float uCamDist;
uniform float uDetail;
uniform float uPower;

// key light normalised so the noon sun is ~1
const float KEYN = 0.30;
// climate of the water being shaded: 0 temperate/tropical .. 1 polar (set by callers)
float gCold = 0.0;

// absorption per world unit of path (r, g, b); polar water is greyer
vec3 waterAbsorb() { return mix(vec3(0.60, 0.150, 0.085), vec3(0.36, 0.24, 0.20), gCold); }

// Light available inside the upper water column; vis = shadow * cloud factor.
vec3 waterIrradianceV(float vis) {
  float up = clamp(uKeyDir.y, 0.0, 1.0);
  // when the sun is low the blue zenith keeps the water column blue-teal
  float lowK = 1.0 - smoothstep(0.15, 0.5, uKeyDir.y);
  return uKeyCol * KEYN * (0.30 + 0.70 * up) * vis + uAmbCol * 0.55 + uZenCol * 0.32 * lowK;
}
vec3 waterIrradiance() { return waterIrradianceV(1.0); }

// In-scattered colour of an infinitely deep column (deep sapphire / polar slate), lit.
vec3 waterDeepColorV(float vis) {
  return mix(vec3(0.0055, 0.034, 0.105), vec3(0.010, 0.024, 0.038), gCold) * waterIrradianceV(vis);
}
vec3 waterDeepColor() { return waterDeepColorV(1.0); }
// Lighter scatter colour of the shallow shelf haze (turquoise / cold teal-grey).
vec3 waterShallowColorV(float vis) {
  return mix(vec3(0.018, 0.150, 0.165), vec3(0.022, 0.048, 0.056), gCold) * waterIrradianceV(vis);
}
vec3 waterShallowColor() { return waterShallowColorV(1.0); }

float cloudShadowAt(vec2 xz) {
  if (uCloudOn < 0.5) return 1.0;
  vec2 uv = (xz + uCloudParams.xy) * uCloudParams.z;
  return clamp(1.0 - uCloudParams.w * texture2D(uCloudTex, uv).r, 0.0, 1.0);
}

// Combine a lit seabed colour with the water column above it.
// depth: vertical water depth at the seabed point; viewY: |view ray y| (0..1)
vec3 applyWaterColumn(vec3 seabed, float depth, float viewY, float vis) {
  float vy = max(viewY, 0.12);
  float sy = max(uKeyDir.y, 0.25);
  float up = depth / vy;
  float down = depth / sy;
  vec3 ab = waterAbsorb();
  vec3 T = exp(-ab * (up + down * 0.6));
  vec3 Tv = exp(-ab * up * 1.15);
  vec3 scat = mix(waterShallowColorV(vis), waterDeepColorV(vis), smoothstep(0.6, 6.0, depth));
  return seabed * T + scat * (1.0 - Tv);
}
`;
