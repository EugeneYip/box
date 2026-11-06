// Shared sky radiance model (GLSL). Used by the sky dome, the environment
// (IBL) capture and the screen-space aerial-perspective pass, so distant
// terrain and ocean always fade into exactly the colour of the sky behind them.
//
// All colours are linear HDR. The CPU side (SkyModel.js) bakes time of day and
// weather into the palette uniforms; the shader only shapes them.

export const SKY_UNIFORMS_GLSL = /* glsl */ `
uniform vec3 uSunDir;      // direction to the sun (may be below the horizon)
uniform vec3 uMoonDir;     // direction to the moon
uniform vec3 uZenith;      // sky colour straight up
uniform vec3 uHorizon;     // sky colour at the horizon (away from the sun)
uniform vec3 uGlow;        // horizon glow on the sun side (sunrise / sunset drama)
uniform vec3 uBelt;        // anti-solar twilight band ("belt of Venus")
uniform vec3 uHalo;        // forward-scattering halo around the sun
uniform vec3 uGroundHaze;  // colour below the horizon
uniform float uGlowWidth;  // azimuthal tightness of the horizon glow
`;

export const SKY_FUNCS_GLSL = /* glsl */ `
// Horizon-to-zenith gradient with sun-side glow. dir must be normalised.
vec3 skyBase(vec3 dir) {
  float y = dir.y;
  float h = max(y, 0.0);
  // Fast blend just above the horizon, long tail toward the zenith.
  float t = 1.0 - pow(1.0 - h, 3.2);
  t = mix(t, sqrt(h), 0.35);
  vec3 col = mix(uHorizon, uZenith, clamp(t, 0.0, 1.0));

  vec2 sunH = uSunDir.xz;
  float sunHL = length(sunH);
  sunH = sunHL > 1e-4 ? sunH / sunHL : vec2(1.0, 0.0);
  vec2 dirH = dir.xz;
  float dirHL = length(dirH);
  dirH = dirHL > 1e-4 ? dirH / dirHL : sunH;
  float az = dot(dirH, sunH) * 0.5 + 0.5; // 1 toward the sun, 0 away

  // Sunrise / sunset glow: hugging the horizon, widest under the sun.
  float band = exp(-h * mix(9.0, 4.0, az * az));
  col += uGlow * pow(az, uGlowWidth) * band;
  // Anti-solar pink band a little above the horizon.
  col += uBelt * pow(1.0 - az, 2.2) * exp(-abs(y - 0.08) * 18.0) * smoothstep(0.0, 0.05, y);

  // Mie halo around the sun (soft, broad + tighter core).
  float mu = max(dot(dir, uSunDir), 0.0);
  col += uHalo * (pow(mu, 6.0) * 0.22 + pow(mu, 48.0) * 0.55 + pow(mu, 600.0) * 1.6);

  // Below the horizon blend into the ground haze so geometry-less regions
  // and the fogged ocean meet without an edge.
  col = mix(col, uGroundHaze, smoothstep(0.0, -0.28, y));
  return col;
}

// Colour of the haze in-scattered along a ray heading in 'dir' (any pitch):
// the sky colour just above the horizon in that azimuth.
vec3 hazeColor(vec3 dir) {
  vec3 d = vec3(dir.x, 0.035, dir.z);
  float l = length(d.xz);
  if (l < 1e-4) d = vec3(1.0, 0.035, 0.0);
  return skyBase(normalize(d));
}
`;
