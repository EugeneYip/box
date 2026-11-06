import * as THREE from 'three';
import { Effect, BlendFunction } from 'postprocessing';

// Exposure, filmic tone mapping and the colour grade, in one pass.
//   - ACES (Hill fit) or Khronos Neutral tone curve
//   - gentle contrast in perceptual space
//   - split toning: cool shadows, warm highlights (time-of-day driven)
//   - saturation + vibrance (boosts muted colours more than vivid ones, so
//     the palette gets richer without going garish)
//   - soft, slightly tinted vignette
//   - additive flash (lightning, god powers)

const FRAG = /* glsl */ `
uniform float uExposure;
uniform vec3 uShadowTint;
uniform vec3 uHighTint;
uniform vec3 uMidTint;
uniform vec3 uFlash;
uniform vec4 uGrade;    // saturation, vibrance, contrast, pivot
uniform vec4 uVignette; // strength, inner radius, outer radius, unused
uniform vec3 uVignetteColor;

vec3 rrtOdtFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 acesFilm(vec3 color) {
  const mat3 inMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 outMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color = inMat * (color / 0.6);
  color = rrtOdtFit(color);
  return clamp(outMat * color, 0.0, 1.0);
}
vec3 neutralTone(vec3 color) {
  const float startC = 0.76;
  const float desat = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startC) return color;
  float d = 1.0 - startC;
  float newPeak = 1.0 - d * d / (peak + d - startC);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desat * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = max(inputColor.rgb, 0.0) * uExposure + uFlash;
#if TONEMAP == 1
  c = neutralTone(c);
#else
  c = acesFilm(c);
#endif
  // perceptual space for grading
  vec3 p = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
  float l = dot(p, vec3(0.2126, 0.7152, 0.0722));
  // contrast (soft, pivoted)
  p = (p - uGrade.w) * uGrade.z + uGrade.w;
  // split toning
  p += uShadowTint * (1.0 - smoothstep(0.0, 0.55, l)) + uHighTint * smoothstep(0.35, 1.0, l) + uMidTint * (4.0 * l * (1.0 - l));
  // saturation + vibrance
  l = dot(p, vec3(0.2126, 0.7152, 0.0722));
  float mx = max(p.r, max(p.g, p.b));
  float mn = min(p.r, min(p.g, p.b));
  float sat = mx - mn;
  p = mix(vec3(l), p, uGrade.x + uGrade.y * (1.0 - smoothstep(0.0, 0.6, sat)));
  // vignette
  vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
  float v = smoothstep(uVignette.y, uVignette.z, length(q));
  p = mix(p, p * uVignetteColor, v * uVignette.x);
  c = pow(clamp(p, 0.0, 1.0), vec3(2.2));
  outputColor = vec4(c, inputColor.a);
}
`;

export class GradeEffect extends Effect {
  constructor({ tonemap = 0 } = {}) {
    super('GradeEffect', FRAG, {
      blendFunction: BlendFunction.SRC,
      defines: new Map([['TONEMAP', String(tonemap)]]),
      uniforms: new Map([
        ['uExposure', new THREE.Uniform(1)],
        ['uShadowTint', new THREE.Uniform(new THREE.Vector3())],
        ['uHighTint', new THREE.Uniform(new THREE.Vector3())],
        ['uMidTint', new THREE.Uniform(new THREE.Vector3())],
        ['uFlash', new THREE.Uniform(new THREE.Vector3())],
        ['uGrade', new THREE.Uniform(new THREE.Vector4(1.08, 0.15, 1.05, 0.45))],
        ['uVignette', new THREE.Uniform(new THREE.Vector4(0.32, 0.45, 1.05, 0))],
        ['uVignetteColor', new THREE.Uniform(new THREE.Color(0.32, 0.26, 0.3))],
      ]),
    });
  }
}
