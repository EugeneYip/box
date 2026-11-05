import { WATER_PARS_GLSL } from './waterCommon.js';

// Water surface shading (MeshStandardMaterial + onBeforeCompile so that
// shadows, fog and the light uniforms are provided by three.js). The final
// colour is composed here and written premultiplied (blend: ONE,
// ONE_MINUS_SRC_ALPHA): reflections, glints and foam add on top of the
// seabed, which the terrain shader has already tinted with the water column.
export const WATER_VERTEX_PARS = /* glsl */ `
varying vec3 vWPos;
`;
export const WATER_VERTEX_MAIN = /* glsl */ `
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

export const WATER_FRAGMENT_PARS = /* glsl */ `
varying vec3 vWPos;
uniform sampler2D uHeightTex;
uniform sampler2D uShoreTex;
uniform sampler2D uTypeTex;
uniform sampler2D uNoise;
uniform sampler2D uCells;
uniform float uCamFar;
${WATER_PARS_GLSL}

const mat2 WROT1 = mat2(0.80, -0.60, 0.60, 0.80);
const mat2 WROT2 = mat2(0.28, 0.96, -0.96, 0.28);

float hAt(vec2 xz) { return texture2D(uHeightTex, xz / uWorldSize).r; }
float isIceAt(ivec2 c, ivec2 isz) {
  float t = floor(texelFetch(uTypeTex, clamp(c, ivec2(0), isz), 0).r * 255.0 + 0.5);
  return t == 15.0 ? 1.0 : 0.0;
}

vec2 swell(vec2 p, vec2 d, float k, float a, float w, float t) {
  float ph = dot(d, p) * k + t * w;
  return d * (a * k * cos(ph));
}

// Surface slope (dh/dx, dh/dz) of the stylised wave field.
vec2 waveSlope(vec2 p, float t, float fw, float calm) {
  vec2 g = vec2(0.0);
  float f1 = 1.0 - smoothstep(0.6, 2.5, fw);
  float f2 = 1.0 - smoothstep(0.12, 0.6, fw);
  float f3 = 1.0 - smoothstep(0.05, 0.25, fw);
  g += swell(p, vec2(0.83, 0.56), 0.33, 0.20, 0.85, t);
  g += swell(p, vec2(-0.45, 0.89), 0.47, 0.13, 1.05, t);
  g += swell(p, vec2(0.97, -0.24), 0.71, 0.08, 1.35, t) * f1;
  g += swell(p, vec2(0.20, 0.98), 1.13, 0.05, 1.80, t) * f1;
  g += swell(p, vec2(-0.86, -0.51), 1.77, 0.030, 2.30, t) * f2;
  // choppy detail from two scrolling noise layers
  vec4 a = texture2D(uNoise, p * (1.0 / 9.0) + vec2(t * 0.011, t * 0.007));
  vec4 b = texture2D(uNoise, WROT1 * p * (1.0 / 5.7) - vec2(t * 0.009, -t * 0.012));
  g += ((a.rg - 0.5) * 0.55 + (b.gr - 0.5) * 0.45) * 0.35 * f2;
  vec4 c = texture2D(uNoise, WROT2 * p * (1.0 / 2.1) + vec2(-t * 0.02, t * 0.015));
  g += (c.rg - 0.5) * 0.22 * f3;
  return g * calm;
}
`;

export const WATER_FRAGMENT_MAIN = /* glsl */ `
{
  vec3 wp = vWPos;
  vec2 p = wp.xz;
  float t = uLTime;
  vec3 V = normalize(cameraPosition - wp);
  float viewDist = length(cameraPosition - wp);
  float fw = length(fwidth(p));

  // ---- depth from the height texture (no depth prepass)
  float hc = hAt(p);
  vec2 od = max(max(-p, p - uWorldSize), 0.0);
  float outside = length(od);
  float outK = smoothstep(4.0, 70.0, outside);
  float depth = mix(max(0.0, -hc), 16.0, outK);
  float e = 0.6;
  vec2 grad = vec2(hAt(p + vec2(e, 0.0)) - hAt(p - vec2(e, 0.0)), hAt(p + vec2(0.0, e)) - hAt(p - vec2(0.0, e))) / (2.0 * e);
  float gl = length(grad);
  // distance to the coastline: first-order estimate near shore, CPU field farther out
  vec4 sh = texture2D(uShoreTex, p / uWorldSize);
  float edt = sh.r * 16.0;
  float wide = sh.g * 16.0;
  float dGrad = depth / max(gl, 0.22);
  float shoreD = mix(dGrad, max(edt - 0.5, dGrad), smoothstep(1.2, 2.6, edt));
  shoreD = mix(shoreD, 40.0, outK);
  float open = smoothstep(1.4, 4.0, wide) * (1.0 - outK);

  // ---- waves
  float calm = mix(0.55, 1.0, smoothstep(0.0, 2.5, depth)) * mix(1.0, 0.75, outK);
  vec2 sl = waveSlope(p, t, fw, calm);
  vec3 N = normalize(vec3(-sl.x, 1.0, -sl.y));
  float NdV = max(dot(N, V), 0.0);

  // ---- reflection of the sky (stylised gradient from the fog/horizon colour)
  vec3 R = reflect(-V, N);
  vec3 horizon = uSkyCol;
  vec3 zenith = uSkyCol * vec3(0.50, 0.68, 1.05) * (0.55 + 0.45 * uDay);
  vec3 sky = mix(horizon, zenith, pow(clamp(R.y, 0.0, 1.0), 0.6));
  float F = 0.025 + 0.975 * pow(1.0 - NdV, 5.0);
  F = clamp(F * 1.35, 0.0, 1.0);

  // ---- sun shadow on the surface
  float sunSh = 1.0;
  #if defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 )
    DirectionalLightShadow dls = directionalLightShadows[ 0 ];
    sunSh = getShadow( directionalShadowMap[ 0 ], dls.shadowMapSize, dls.shadowIntensity, dls.shadowBias, dls.shadowRadius, vDirectionalShadowCoord[ 0 ] );
  #endif
  float cloud = cloudShadowAt(p);
  float lightVis = sunSh * cloud;

  // ---- sun glints + moon path
  vec3 L = normalize(uSunDirW);
  vec3 Hs = normalize(L + V);
  float nh = max(dot(N, Hs), 0.0);
  float sunUp = smoothstep(-0.02, 0.12, L.y);
  // sharp sparkles only where they can be resolved (no far-zoom aliasing)
  float sharpK = 1.0 - smoothstep(0.06, 0.32, fw);
  float glint = (pow(nh, 1200.0) * 10.0 + pow(nh, 160.0) * 0.8) * sharpK + pow(nh, 30.0) * 0.07;
  // broad, stable sun sheen from the large swell only (reads at any zoom)
  vec3 Nb = normalize(vec3(-sl.x * 0.25, 1.0, -sl.y * 0.25));
  glint += pow(max(dot(Nb, Hs), 0.0), 220.0) * 0.9 * (1.0 - sharpK);
  vec3 spec = uSunCol * glint * sunUp * uDay * lightVis;
  vec3 Lm = normalize(uMoonDirW);
  vec3 Hm = normalize(Lm + V);
  float nhm = max(dot(N, Hm), 0.0);
  spec += vec3(0.55, 0.65, 0.85) * (pow(nhm, 500.0) * 3.0 + pow(nhm, 60.0) * 0.12) * (1.0 - uDay) * cloud;

  // ---- water body veil (the seabed below is already tinted by the terrain)
  vec3 scat = mix(waterShallowColor(), waterDeepColor(), smoothstep(0.6, 6.0, depth));
  float vy = max(abs(V.y), 0.12);
  float veil = 1.0 - exp(-depth / vy * 0.16);
  veil = clamp(veil * 0.85, 0.0, 0.92);
  veil = mix(veil, 1.0, outK);
  // gentle brighter crests in open water
  float crest = smoothstep(0.10, 0.30, length(sl)) * open * 0.25;

  // ---- foam
  vec2 drift = vec2(t * 0.020, t * 0.013);
  vec4 fn = texture2D(uNoise, p * (1.0 / 13.0) + drift);
  vec4 fc = texture2D(uCells, WROT1 * p * (1.0 / 6.5) + drift * 0.6);
  vec4 fc2 = texture2D(uCells, WROT2 * p * (1.0 / 3.1) - drift * 0.8);
  float breakup = smoothstep(0.12, 0.55, fc.g + (fn.r - 0.5) * 0.5) * 0.65 + smoothstep(0.05, 0.4, fc2.g) * 0.35;
  float breath = 0.5 + 0.5 * sin(t * 0.9 + fn.g * 6.0);
  float contactW = 0.30 + 0.25 * breath + 0.15 * fn.b;
  float contact = 1.0 - smoothstep(contactW * 0.25, contactW * 1.15, shoreD);
  contact *= (0.45 + 0.55 * breakup) * mix(0.22, 1.0, open);
  // soft lighter wash just off the beach
  float wash = (1.0 - smoothstep(0.0, 1.6 + 0.6 * breath, shoreD)) * 0.35 * open;
  // travelling bands that wash toward the shore and fade out
  float ph = shoreD * 0.95 - t * 0.32 + (fn.r - 0.5) * 1.3;
  float bandWave = fract(ph);
  float band = smoothstep(0.0, 0.10, bandWave) * (1.0 - smoothstep(0.10, 0.34, bandWave));
  float bandMask = exp(-shoreD * 0.55) * smoothstep(0.15, 0.6, shoreD) * open * 0.8;
  float bands = band * bandMask * smoothstep(0.30, 0.75, breakup + 0.1);
  // a faint lace of foam on wider open water
  float lace = smoothstep(0.82, 0.96, 1.0 - fc2.g) * smoothstep(0.62, 0.8, fn.g) * open * 0.18 * (1.0 - smoothstep(0.4, 1.6, fw));
  float foam = clamp(max(contact * 0.9, bands * 0.75) + lace, 0.0, 1.0);
  foam *= 1.0 - outK;
  foam *= smoothstep(0.0, 0.02, depth + 0.02);
  vec3 foamCol = vec3(0.92, 0.96, 1.0) * (waterIrradiance() * 0.80 * mix(1.0, lightVis, 0.6 * uDay) + vec3(0.02));

  // ---- frozen water (ICE tiles under the surface) - opaque sheet
  vec2 iq = p + (fn.rg - 0.5) * 1.2 - 0.5;
  ivec2 ic = ivec2(floor(iq));
  vec2 ifr = smoothstep(0.0, 1.0, fract(iq));
  ivec2 isz = ivec2(uWorldSize) - 1;
  float i00 = isIceAt(ic, isz);
  float i10 = isIceAt(ic + ivec2(1, 0), isz);
  float i01 = isIceAt(ic + ivec2(0, 1), isz);
  float i11 = isIceAt(ic + ivec2(1, 1), isz);
  float iceF = mix(mix(i00, i10, ifr.x), mix(i01, i11, ifr.x), ifr.y);
  float ice = smoothstep(0.42, 0.58, iceF + (fc.b - 0.5) * 0.2) * (1.0 - outK) * step(0.001, depth);

  // ---- compose (premultiplied)
  vec3 refl = sky * F;
  float a = 1.0 - (1.0 - veil) * (1.0 - F);
  vec3 col = scat * veil * (1.0 - F) + refl + scat * crest;
  // shore wash: brighten towards the turquoise of sunlit shallows
  col += waterShallowColor() * 1.6 * wash * (1.0 - outK);
  a = clamp(a + wash * 0.25, 0.0, 1.0);
  // foam is diffuse and opaque
  col = mix(col, foamCol, foam);
  a = mix(a, 1.0, foam);
  col += spec * (1.0 - foam);
  a = clamp(a + lum(spec) * 0.5, 0.0, 1.0);
  if (ice > 0.0) {
    float cracks = 1.0 - smoothstep(0.0, 0.06, fc.g);
    vec3 iceAlb = mix(vec3(0.62, 0.78, 0.90), vec3(0.86, 0.93, 0.98), smoothstep(0.3, 0.8, fn.r)) * (1.0 - cracks * 0.25);
    float ndl = max(L.y, 0.0);
    vec3 iceCol = iceAlb * (uSunCol * ndl * uDay * lightVis * 0.9 + waterIrradiance() * 0.45);
    float Fi = 0.04 + 0.96 * pow(1.0 - max(V.y, 0.0), 5.0);
    iceCol += sky * Fi * 0.6 + uSunCol * pow(max(dot(vec3(0.0, 1.0, 0.0), Hs), 0.0), 300.0) * 2.0 * uDay * lightVis;
    col = mix(col, iceCol, ice);
    a = mix(a, 1.0, ice);
  }

  // ---- distance fade into the horizon (never show the far-plane cut)
  float farK = smoothstep(uCamFar * 0.55, uCamFar * 0.92, viewDist);
  col = mix(col, uSkyCol, farK);
  a = mix(a, 1.0, farK);

  gl_FragColor = vec4(col, a);
}
`;

// fog that respects premultiplied colour
export const WATER_FOG = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor * gl_FragColor.a, fogFactor );
#endif
`;

export function patchWaterMaterial(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + WATER_VERTEX_PARS)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + WATER_VERTEX_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nfloat lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }\n')
      .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n' + WATER_FRAGMENT_PARS)
      .replace('#include <opaque_fragment>', WATER_FRAGMENT_MAIN)
      .replace('#include <fog_fragment>', WATER_FOG)
      .replace('#include <premultiplied_alpha_fragment>', '');
  };
  material.customProgramCacheKey = () => 'worldseed-water-v1';
}
