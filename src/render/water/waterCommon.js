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
      uSkyCol: { value: new THREE.Color(0.62, 0.77, 0.91) },
      uMoonDirW: { value: new THREE.Vector3(-0.4, 0.7, -0.3).normalize() },
      uWorldSize: { value: new THREE.Vector2(game.world.w, game.world.h) },
      uHeightTex: { value: null },
      uCloudTex: { value: null },
      uCloudParams: { value: new THREE.Vector4(0, 0, 0.01, 0) },
      uCloudOn: { value: 0 },
      uWet: { value: 0 },
    };
    shared.set(game, u);
  }
  return u;
}

// Per-frame refresh of the environment-driven shared uniforms (idempotent; the
// first caller each frame does the work).
const _c = new THREE.Color();
export function refreshLandscapeUniforms(game, dt) {
  const u = landscapeUniforms(game);
  if (u._frame === game.frame) return u;
  u._frame = game.frame;
  const env = game.env || {};
  u.uLTime.value = game.time?.realTime ?? 0;
  if (env.sunDir) u.uSunDirW.value.copy(env.sunDir).normalize();
  if (env.sunColor) u.uSunCol.value.copy(env.sunColor);
  u.uDay.value = env.daylight ?? 1;
  // moon roughly opposite the sun, always above the horizon
  const s = u.uSunDirW.value;
  u.uMoonDirW.value.set(-s.x * 0.8 + 0.15, Math.max(0.35, Math.abs(s.y) * 0.8 + 0.3), -s.z * 0.8 - 0.25).normalize();
  // sky colour: fog colour (Atmosphere keeps it matched to the horizon)
  const scene = game.scene;
  if (scene?.fog?.color) _c.copy(scene.fog.color);
  else if (scene?.background?.isColor) _c.copy(scene.background);
  else _c.setRGB(0.62, 0.77, 0.91);
  u.uSkyCol.value.copy(_c);
  // optional cloud shadows from Atmosphere
  const cs = env.cloudShadow;
  if (cs && cs.texture && cs.params) {
    u.uCloudTex.value = cs.texture;
    u.uCloudParams.value.copy(cs.params);
    u.uCloudOn.value = 1;
  } else {
    u.uCloudOn.value = 0;
  }
  // ground wetness from rain (smoothed)
  const w = env.weather || {};
  const target = w.type === 'rain' || w.type === 'storm' ? Math.min(1, 0.4 + 0.6 * (w.intensity ?? 1)) : 0;
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
uniform vec3 uMoonDirW;
uniform vec2 uWorldSize;
uniform sampler2D uCloudTex;
uniform vec4 uCloudParams;
uniform float uCloudOn;
uniform float uWet;

// absorption per world unit of path (r, g, b)
const vec3 W_ABSORB = vec3(0.60, 0.150, 0.085);

// Light available inside the upper water column (sun + sky + moon).
vec3 waterIrradiance() {
  float sunUp = clamp(uSunDirW.y, 0.0, 1.0);
  vec3 sun = uSunCol * (0.30 + 0.70 * sunUp) * uDay;
  vec3 sky = uSkyCol * (0.25 + 0.35 * uDay);
  vec3 moon = vec3(0.030, 0.045, 0.085) * (1.0 - uDay);
  return sun + sky + moon;
}

// In-scattered colour of an infinitely deep column (deep sapphire), lit.
vec3 waterDeepColor() {
  return vec3(0.0055, 0.034, 0.105) * waterIrradiance();
}
// A lighter, greener scatter colour used for the shallow shelf haze.
vec3 waterShallowColor() {
  return vec3(0.018, 0.150, 0.165) * waterIrradiance();
}

float cloudShadowAt(vec2 xz) {
  if (uCloudOn < 0.5) return 1.0;
  vec2 uv = (xz + uCloudParams.xy) * uCloudParams.z;
  return clamp(1.0 - uCloudParams.w * texture2D(uCloudTex, uv).r, 0.0, 1.0);
}

// Combine a lit seabed colour with the water column above it.
// depth: vertical water depth at the seabed point; viewY: |view ray y| (0..1)
vec3 applyWaterColumn(vec3 seabed, float depth, float viewY) {
  float vy = max(viewY, 0.12);
  float sy = max(uSunDirW.y, 0.25);
  float up = depth / vy;
  float down = depth / sy;
  vec3 T = exp(-W_ABSORB * (up + down * 0.6));
  vec3 Tv = exp(-W_ABSORB * up * 1.15);
  // shallow haze tint fades into the deep colour with depth
  vec3 scat = mix(waterShallowColor(), waterDeepColor(), smoothstep(0.6, 6.0, depth));
  return seabed * T + scat * (1.0 - Tv);
}
`;
