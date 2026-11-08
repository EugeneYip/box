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
uniform sampler2D uClimTex;
uniform float uCamFar;
${WATER_PARS_GLSL}

const mat2 WROT1 = mat2(0.80, -0.60, 0.60, 0.80);
const mat2 WROT2 = mat2(0.28, 0.96, -0.96, 0.28);

float hAt(vec2 xz) { return texture2D(uHeightTex, xz / uWorldSize).r; }
float edtAt(vec2 xz) { return texture2D(uShoreTex, xz / uWorldSize).r * 16.0; }
float ggxD(float nh, float r) {
  float a2 = r * r;
  float d = nh * nh * (a2 - 1.0) + 1.0;
  return a2 / (3.14159 * d * d);
}
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
  float f1 = 1.0 - smoothstep(0.15, 0.40, fw);
  float f2 = 1.0 - smoothstep(0.08, 0.30, fw);
  float f3 = 1.0 - smoothstep(0.05, 0.25, fw);
  float f0 = 1.0 - smoothstep(0.30, 0.50, fw); // long swell reads as stripes from afar: drop it
  g += swell(p, vec2(0.83, 0.56), 0.33, 0.20, 0.85, t) * f0;
  g += swell(p, vec2(-0.45, 0.89), 0.47, 0.13, 1.05, t) * f0;
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
  // very shallow flats: never closer to shore than the tile distance says
  shoreD = max(shoreD, edt - 1.0);
  shoreD = mix(shoreD, 40.0, outK);
  float open = smoothstep(1.4, 4.0, wide) * (1.0 - outK);
  float narrow = (1.0 - smoothstep(1.2, 3.6, wide)) * (1.0 - outK) * smoothstep(0.0, 0.22, depth);

  // ---- climate: polar water is slate-teal, not tropical turquoise
  float temp = texture2D(uClimTex, p / uWorldSize).g;
  gCold = (1.0 - smoothstep(0.22, 0.50, temp)) * (1.0 - outK * 0.5);

  // ---- waves
  float calm = mix(0.55, 1.0, smoothstep(0.0, 2.5, depth)) * mix(1.0, 0.75, outK) * mix(1.0, 0.5, narrow);
  vec2 sl = waveSlope(p, t, fw, calm);

  // ---- river flow: downstream direction from the broad valley slope, with the
  // across-channel part removed (sign-invariant, so no seam on the centreline)
  float ee = 0.75;
  vec2 across = vec2(edtAt(p + vec2(ee, 0.0)) - edtAt(p - vec2(ee, 0.0)), edtAt(p + vec2(0.0, ee)) - edtAt(p - vec2(0.0, ee)));
  float al = length(across);
  vec2 an = al > 1e-4 ? across / al : vec2(0.0);
  float E = 5.0;
  vec2 dn = -vec2(hAt(p + vec2(E, 0.0)) - hAt(p - vec2(E, 0.0)), hAt(p + vec2(0.0, E)) - hAt(p - vec2(0.0, E)));
  dn -= an * dot(dn, an);
  float dl = length(dn);
  vec2 flow = dl > 1e-4 ? dn / dl : vec2(0.7071);
  vec2 perp = vec2(-flow.y, flow.x);
  float fu = dot(p, flow), fv = dot(p, perp);
  vec4 st1 = texture2D(uNoise, vec2(fu * 0.16 - t * 0.085, fv * 0.85));
  vec4 st2 = texture2D(uNoise, vec2(fu * 0.42 - t * 0.21, fv * 1.9) + 0.37);
  float streak = smoothstep(0.56, 0.86, st1.r) * 0.7 + smoothstep(0.6, 0.9, st2.g) * 0.5 * (1.0 - smoothstep(0.08, 0.35, fw));
  float riffle = smoothstep(0.62, 0.92, st2.r) * (1.0 - smoothstep(0.25, 0.7, depth)) * (1.0 - smoothstep(0.1, 0.4, fw));
  // bends: how fast the flow direction turns per world unit
  float bend = smoothstep(0.35, 0.95, length(fwidth(flow)) / max(fw, 1e-3));
  // flow ripples tilt the surface along the current
  sl += flow * (st1.g - 0.5) * 0.25 * narrow * (1.0 - smoothstep(0.1, 0.5, fw));

  vec3 N = normalize(vec3(-sl.x, 1.0, -sl.y));
  float NdV = max(dot(N, V), 0.0);

  // ---- reflection of the actual sky gradient (Atmosphere's zenith / horizon)
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uSkyCol, uZenCol, pow(clamp(R.y, 0.0, 1.0), 0.55));
  // ~3.5% straight down, rising towards grazing angles (Schlick)
  float F = clamp(0.035 + 0.965 * pow(1.0 - NdV, 5.0), 0.0, 1.0);

  // ---- key-light shadow on the surface (+ clouds)
  float sunSh = 1.0;
  #if defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 )
    DirectionalLightShadow dls = directionalLightShadows[ 0 ];
    sunSh = getShadow( directionalShadowMap[ 0 ], dls.shadowMapSize, dls.shadowIntensity, dls.shadowBias, dls.shadowRadius, vDirectionalShadowCoord[ 0 ] );
  #endif
  float cloud = cloudShadowAt(p);
  float lightVis = sunSh * cloud;

  // ---- glints from the current key light (sun by day, moon by night; storms dim it)
  vec3 L = normalize(uKeyDir);
  vec3 Hs = normalize(L + V);
  float nh = max(dot(N, Hs), 0.0);
  float keyUp = smoothstep(-0.02, 0.12, L.y);
  float sharpK = 1.0 - smoothstep(0.06, 0.32, fw);
  // roughness widens with the pixel footprint: a soft sheen far away, crisp glints up close
  float rgh = mix(0.07, 0.30, smoothstep(0.06, 0.6, fw));
  float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(V, Hs), 0.0), 5.0);
  float glint = ggxD(nh, rgh) * Fs * mix(1.1, 0.55, smoothstep(0.1, 0.6, fw)) + pow(nh, 1400.0) * 6.5 * sharpK;
  glint *= mix(1.0, 0.35, narrow); // rivers must not flare to white
  vec3 keyL = uKeyCol * KEYN;
  vec3 spec = keyL * glint * keyUp * lightVis;
  // low sun: a glittering sun path on the water toward the sun (resolvable at map zoom)
  float lowSun = smoothstep(0.02, 0.10, L.y) * (1.0 - smoothstep(0.25, 0.55, L.y));
  vec4 gz1 = texture2D(uNoise, p * (1.0 / 16.0) + vec2(t * 0.012, -t * 0.009));
  vec4 gz2 = texture2D(uNoise, WROT1 * p * (1.0 / 9.0) - vec2(t * 0.010, t * 0.013));
  vec2 gs = ((gz1.rg - 0.5) + (gz2.gr - 0.5)) * 1.4;
  vec3 Ng = normalize(vec3(-gs.x, 1.0, -gs.y));
  float pathK = ggxD(max(dot(Ng, Hs), 0.0), 0.45) * Fs * 5.0;
  float flick = smoothstep(0.55, 0.85, gz1.b);
  spec += keyL * pathK * (0.5 + 1.5 * flick) * lowSun * lightVis * (1.0 - narrow * 0.7);

  // ---- water body veil (the seabed below is already tinted by the terrain)
  vec3 scat = mix(waterShallowColorV(lightVis), waterDeepColorV(lightVis), smoothstep(0.6, 6.0, depth));
  // broad colour variation so open water is never a flat slab
  float mac = texture2D(uNoise, p * (1.0 / 190.0) + vec2(t * 0.0015, 0.0)).r;
  scat *= 0.82 + 0.36 * mac;
  float vy = max(abs(V.y), 0.12);
  float veil = 1.0 - exp(-depth / vy * 0.16);
  veil = clamp(veil * 0.85, 0.0, 0.92);
  veil = mix(veil, 1.0, outK);
  // rivers and narrow channels: a clear teal body of their own
  vec3 rivTeal = mix(vec3(0.020, 0.130, 0.130), vec3(0.030, 0.075, 0.080), gCold) * waterIrradianceV(lightVis);
  scat = mix(scat, rivTeal, narrow);
  veil = max(veil, 0.64 * narrow);
  float crest = smoothstep(0.10, 0.30, length(sl)) * open * 0.25;

  // ---- foam
  vec2 drift = vec2(t * 0.020, t * 0.013);
  vec4 fn = texture2D(uNoise, p * (1.0 / 13.0) + drift);
  vec4 fc = texture2D(uCells, WROT1 * p * (1.0 / 6.5) + drift * 0.6);
  vec4 fc2 = texture2D(uCells, WROT2 * p * (1.0 / 3.1) - drift * 0.8);
  vec4 fcl = texture2D(uCells, WROT1 * (p + (fn.gb - 0.5) * 3.2) * (1.0 / 4.3) - drift * 0.7);
  float breakup = smoothstep(0.12, 0.55, fc.g + (fn.r - 0.5) * 0.5) * 0.65 + smoothstep(0.05, 0.4, fc2.g) * 0.35;
  float breath = 0.5 + 0.5 * sin(t * 0.9 + fn.g * 6.0);
  float contactW = 0.30 + 0.25 * breath + 0.15 * fn.b;
  float contact = 1.0 - smoothstep(contactW * 0.25, contactW * 1.15, shoreD);
  contact *= (0.45 + 0.55 * breakup) * mix(0.08, 1.0, open);
  float wash = (1.0 - smoothstep(0.0, 1.6 + 0.6 * breath, shoreD)) * 0.30 * open * smoothstep(0.08, 0.40, uKeyDir.y) * (1.0 - gCold * 0.7);
  float ph = shoreD * 0.95 - t * 0.32 + (fn.r - 0.5) * 1.3;
  float bandWave = fract(ph);
  float band = smoothstep(0.0, 0.10, bandWave) * (1.0 - smoothstep(0.10, 0.34, bandWave));
  float bandMask = exp(-shoreD * 0.55) * smoothstep(0.15, 0.6, shoreD) * open * 0.8;
  float bands = band * bandMask * smoothstep(0.30, 0.75, breakup + 0.1);
  float lace = smoothstep(0.90, 0.98, 1.0 - fcl.g) * smoothstep(0.66, 0.84, fn.g) * open * 0.06 * (1.0 - smoothstep(0.4, 1.6, fw)) * (1.0 - gCold * 0.7);
  // river foam: flecks at bends and riffles, carried downstream
  float rivFoam = narrow * clamp(bend * 0.8 * smoothstep(0.55, 0.85, st1.b) + riffle * 0.55 + (1.0 - smoothstep(0.05, 0.45, shoreD)) * 0.25 * st1.a, 0.0, 1.0);
  float foam = clamp(max(contact * 0.9, bands * 0.75) + lace + min(rivFoam, 0.5) * 0.6, 0.0, 1.0);
  foam = min(foam, mix(1.0, 0.35, narrow)); // steep narrow channels must never turn into a white slab
  foam *= mix(1.0, 0.45, (1.0 - smoothstep(0.06, 0.3, depth)) * smoothstep(1.2, 2.5, edt)); // shallow flats
  foam *= 1.0 - outK;
  foam *= smoothstep(0.0, 0.02, depth + 0.02);
  foam *= 1.0 - gCold * 0.35;
  vec3 foamCol = vec3(0.90, 0.95, 1.0) * (waterIrradianceV(lightVis) * 0.78 + vec3(0.02));

  // ---- frozen water (ICE tiles under the surface) - opaque sheet, soft edges
  vec2 iq = p + (fn.rg - 0.5) * 1.2 - 0.5;
  ivec2 ic = ivec2(floor(iq));
  vec2 ifr = smoothstep(0.0, 1.0, fract(iq));
  ivec2 isz = ivec2(uWorldSize) - 1;
  float i00 = isIceAt(ic, isz);
  float i10 = isIceAt(ic + ivec2(1, 0), isz);
  float i01 = isIceAt(ic + ivec2(0, 1), isz);
  float i11 = isIceAt(ic + ivec2(1, 1), isz);
  float iceF = mix(mix(i00, i10, ifr.x), mix(i01, i11, ifr.x), ifr.y);
  float ice = smoothstep(0.18, 0.82, iceF + (fc.b - 0.5) * 0.3 + (fn.g - 0.5) * 0.25) * (1.0 - outK) * step(0.001, depth);

  // ---- compose (premultiplied)
  vec3 refl = sky * F;
  float a = 1.0 - (1.0 - veil) * (1.0 - F);
  vec3 col = scat * veil * (1.0 - F) + refl + scat * crest;
  col += waterShallowColorV(lightVis) * 1.6 * wash * (1.0 - outK);
  a = clamp(a + wash * 0.25, 0.0, 1.0);
  // river streaks: lighter, sky-tinted bands moving downstream
  col += narrow * streak * (waterShallowColorV(lightVis) * 0.9 + sky * 0.05);
  // from afar, rivers read as bright teal ribbons with a sky sheen, not dark roads
  float farR = smoothstep(60.0, 220.0, uCamDist);
  col += narrow * farR * (rivTeal * 1.3 + sky * 0.14);
  // steep channels: stylised cascades = brighter streaks running downhill, never solid white
  float cascade = narrow * smoothstep(1.2, 3.5, dl);
  col += cascade * streak * foamCol * 0.30;
  col = mix(col, foamCol, foam);
  a = mix(a, 1.0, foam);
  col += spec * (1.0 - foam);
  a = clamp(a + lum(spec) * 0.5, 0.0, 1.0);
  if (ice > 0.0) {
    float cracks = 1.0 - smoothstep(0.0, 0.06, fc.g);
    vec3 iceAlb = mix(vec3(0.24, 0.30, 0.37), vec3(0.33, 0.39, 0.45), smoothstep(0.3, 0.8, fn.r));
    iceAlb = mix(iceAlb, vec3(0.20, 0.24, 0.33), smoothstep(0.55, 0.85, fn.b) * 0.5); // blue-violet hollows
    float cracks2 = 1.0 - smoothstep(0.0, 0.05, fc2.g);
    iceAlb *= (1.0 - cracks * 0.38) * (1.0 - cracks2 * 0.18);
    // thin, darker slush towards the floe edge
    iceAlb = mix(scat * 4.0 + vec3(0.06, 0.08, 0.10), iceAlb, smoothstep(0.0, 0.6, ice));
    float ndl = max(L.y, 0.0);
    vec3 iceCol = iceAlb * (keyL * ndl * lightVis * 0.85 + uAmbCol * 0.65);
    float Fi = 0.04 + 0.96 * pow(1.0 - max(V.y, 0.0), 5.0);
    iceCol += sky * Fi * 0.5 + keyL * ggxD(max(dot(vec3(0.0, 1.0, 0.0), Hs), 0.0), 0.12) * 0.04 * lightVis;
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
  material.customProgramCacheKey = () => 'worldseed-water-v3';
}
