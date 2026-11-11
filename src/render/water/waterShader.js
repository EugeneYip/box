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
  // long swell reads as regular diagonal stripes from afar: it fades out well
  // before map zoom and its strength wanders, so it never bands the ocean
  float swK = 0.35 + 0.9 * smoothstep(0.30, 0.75, texture2D(uNoise, p * (1.0 / 140.0) + 0.21).g);
  float f0 = (1.0 - smoothstep(0.12, 0.26, fw)) * swK;
  g += swell(p, vec2(0.83, 0.56), 0.33, 0.20, 0.85, t) * f0;
  g += swell(p, vec2(-0.45, 0.89), 0.47, 0.13, 1.05, t) * f0;
  g += swell(p, vec2(0.97, -0.24), 0.71, 0.08, 1.35, t) * f1;
  g += swell(p, vec2(0.20, 0.98), 1.13, 0.05, 1.80, t) * f1;
  g += swell(p, vec2(-0.86, -0.51), 1.77, 0.030, 2.30, t) * f2;
  // choppy detail from scrolling noise layers (skipped when far / power saver)
  vec4 a = texture2D(uNoise, p * (1.0 / 9.0) + vec2(t * 0.011, t * 0.007));
  if (uDetail > 0.001) {
    vec4 b = texture2D(uNoise, WROT1 * p * (1.0 / 5.7) - vec2(t * 0.009, -t * 0.012));
    g += ((a.rg - 0.5) * 0.55 + (b.gr - 0.5) * 0.45) * 0.35 * f2;
    vec4 c = texture2D(uNoise, WROT2 * p * (1.0 / 2.1) + vec2(-t * 0.02, t * 0.015));
    g += (c.rg - 0.5) * 0.22 * f3;
  } else {
    g += (a.rg - 0.5) * 0.35 * f2;
  }
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
  float oscale = max(1.0, max(uWorldSize.x, uWorldSize.y) / 256.0);
  float outK = smoothstep(4.0 * oscale, 70.0 * oscale, outside);
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
  bool fineW = uDetail > 0.001;
  vec4 st1 = fineW ? texture2D(uNoise, vec2(fu * 0.16 - t * 0.085, fv * 0.85)) : vec4(0.5);
  vec4 st2 = fineW ? texture2D(uNoise, vec2(fu * 0.42 - t * 0.21, fv * 1.9) + 0.37) : vec4(0.5);
  float streak = smoothstep(0.56, 0.86, st1.r) * 0.7 + smoothstep(0.6, 0.9, st2.g) * 0.5 * (1.0 - smoothstep(0.08, 0.35, fw));
  float riffle = smoothstep(0.62, 0.92, st2.r) * (1.0 - smoothstep(0.25, 0.7, depth)) * (1.0 - smoothstep(0.1, 0.4, fw));
  // bends: how fast the flow direction turns per world unit
  float bend = smoothstep(0.35, 0.95, length(fwidth(flow)) / max(fw, 1e-3));
  // flow ripples tilt the surface along the current
  sl += flow * (st1.g - 0.5) * 0.25 * narrow * (1.0 - smoothstep(0.1, 0.5, fw));

  vec3 N = normalize(vec3(-sl.x, 1.0, -sl.y));
  float NdV = max(dot(N, V), 0.0);

  // ---- reflection of the actual sky gradient (Atmosphere's zenith / horizon).
  // At golden hour the warm horizon colour is only reflected along the sun's
  // path; elsewhere the sea mirrors the blue zenith and keeps its own blue body.
  vec3 Lk = normalize(uKeyDir);
  float lowSunE = smoothstep(0.02, 0.10, Lk.y) * (1.0 - smoothstep(0.25, 0.55, Lk.y));
  vec2 vdirE = wp.xz - cameraPosition.xz;
  float pathE = smoothstep(0.88, 0.99, dot(vdirE / max(length(vdirE), 1e-3), Lk.xz / max(length(Lk.xz), 1e-3)));
  vec3 horizonE = mix(uSkyCol, mix(uZenCol * 1.15, uSkyCol, pathE), lowSunE);
  vec3 R = reflect(-V, N);
  vec3 sky = mix(horizonE, uZenCol, pow(clamp(R.y, 0.0, 1.0), 0.55));
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
  // crisp sparkles only up close and with some wind; beyond that the sun's
  // reflection is a broad soft sheen (sharp lobes on the chop clumped into a
  // white "rash" at mid zoom)
  float sharpK = (1.0 - smoothstep(0.03, 0.10, fw)) * (0.25 + 0.75 * smoothstep(0.15, 0.6, uWind));
  // roughness widens with the pixel footprint: a soft sheen far away, crisp glints up close
  float rgh = mix(0.08, 0.45, smoothstep(0.02, 0.16, fw));
  float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(V, Hs), 0.0), 5.0);
  float glint = ggxD(nh, rgh) * Fs * mix(1.0, 0.45, smoothstep(0.04, 0.4, fw)) + pow(nh, 1400.0) * 4.0 * sharpK;
  // rivers, channels and calm shallow flats are not mirrors: never flare to white
  float narrowW = (1.0 - smoothstep(1.2, 3.6, wide)) * (1.0 - outK);
  float shallowK = 1.0 - smoothstep(0.05, 0.6, depth);
  glint *= mix(1.0, 0.3, max(max(narrow, narrowW), shallowK * 0.8));
  vec3 keyL = uKeyCol * KEYN;
  vec3 spec = keyL * glint * keyUp * lightVis;
  // low sun: a glittering sun path on the water toward the sun (resolvable at map zoom)
  float lowSun = smoothstep(0.02, 0.10, L.y) * (1.0 - smoothstep(0.25, 0.55, L.y));
  bool glit = lowSun > 0.0; // uniform: depends on the key light only
  // low sun: a broad, smooth, clamped sheen (no high-frequency glitter noise)
  vec4 gz1 = glit ? texture2D(uNoise, p * (1.0 / 24.0) + vec2(t * 0.010, -t * 0.007)) : vec4(0.5);
  vec2 gs = (gz1.rg - 0.5) * 0.7;
  vec3 Ng = normalize(vec3(-gs.x, 1.0, -gs.y));
  float pathK = min(ggxD(max(dot(Ng, Hs), 0.0), 0.40) * Fs * 3.0, 0.9);
  // at golden hour the crisp glints and sparkle give way to the sheen
  spec *= mix(1.0, 0.4, lowSun);
  // confine it to a strip running from below the camera toward the sun's azimuth
  vec2 vdir = wp.xz - cameraPosition.xz;
  float al2 = dot(vdir / max(length(vdir), 1e-3), L.xz / max(length(L.xz), 1e-3));
  float pathMask = smoothstep(0.86, 0.99, al2);
  // mirror condition: the sheen lives only where a gently tilted facet can send
  // the low sun into the eye (views near the sun's elevation, i.e. toward the
  // horizon under the sun). Looking steeply down, the sea keeps its blue body.
  float tiltNeed = acos(clamp(Hs.y, 0.0, 1.0));
  float mirrorK = 1.0 - smoothstep(0.10, 0.28, tiltNeed);
  spec *= mix(1.0, 1.0 - smoothstep(0.22, 0.45, tiltNeed), lowSun);
  spec += keyL * pathK * 0.8 * lowSun * lightVis * (1.0 - narrow * 0.7) * pathMask * mirrorK;
  // the far sheen never burns to white: capped lower with distance
  spec = min(spec, vec3(mix(1.0, 0.42, smoothstep(0.03, 0.2, fw))));

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
  // rivers keep their teal under overcast skies: a soft light floor (scaled at night)
  vec3 irrR = max(waterIrradianceV(lightVis), vec3(0.44, 0.66, 0.64) * (0.25 + 0.75 * uDay));
  // overcast: dim key light -> rivers must not mirror the grey sky into a pale ribbon
  float overcastK = 1.0 - smoothstep(0.25, 0.8, lum(uKeyCol * KEYN));
  vec3 rivTeal = mix(vec3(0.020, 0.130, 0.130), vec3(0.030, 0.075, 0.080), gCold);
  // grey storm light and the storm grade desaturate: the river body gets richer
  rivTeal = mix(rivTeal, vec3(0.014, 0.200, 0.180), overcastK * (1.0 - gCold)) * irrR;
  scat = mix(scat, rivTeal, narrow);
  veil = max(veil, 0.64 * narrow);
  float crest = smoothstep(0.10, 0.30, length(sl)) * open * 0.25;

  // ---- foam
  vec2 drift = vec2(t * 0.020, t * 0.013);
  vec4 fn = texture2D(uNoise, p * (1.0 / 13.0) + drift);
  vec4 fc = texture2D(uCells, WROT1 * p * (1.0 / 6.5) + drift * 0.6);
  vec4 fc2 = fineW ? texture2D(uCells, WROT2 * p * (1.0 / 3.1) - drift * 0.8) : vec4(0.45, 0.5, 0.5, 0.5);
  vec4 fcl = fineW ? texture2D(uCells, WROT1 * (p + (fn.gb - 0.5) * 3.2) * (1.0 / 4.3) - drift * 0.7) : vec4(0.45, 0.5, 0.5, 0.5);
  // organic (noise-led) breakup; cell edges only as a warped minor term (no crackle glaze)
  float breakup = smoothstep(0.30, 0.70, fn.r * 0.55 + fn.b * 0.25 + fcl.g * 0.35);
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
  // seasonal freeze: lakes, rivers and calm shallows at the coldest latitudes
  if (uFreezeT > -0.1) {
    // coherent: the shelf grows out from the shore as the cold deepens (smooth
    // fields only, so warm lagoons near the threshold never break out in a rash)
    float calmW = max(1.0 - open, 1.0 - smoothstep(1.2, 3.0, depth));
    float coldness = uFreezeT - temp + (mac - 0.5) * 0.03;
    float shelfW = clamp(coldness * 70.0, 0.0, 40.0);
    float fz = (1.0 - smoothstep(shelfW, shelfW + 0.7 + 0.5 * fn.r, shoreD + (fn.b - 0.5) * 0.7)) * smoothstep(0.0, 0.008, coldness);
    ice = max(ice, fz * calmW * (1.0 - outK) * step(0.001, depth));
  }
  // fast ice: a shelf welded to cold shores
  float fastI = smoothstep(0.72, 0.92, gCold) * (1.0 - smoothstep(1.3 + 0.9 * fn.r, 2.4 + 0.9 * fn.r, shoreD)) * (1.0 - outK) * step(0.001, depth);
  // cold rivers: not two parallel shelves with a median; ice reaches across in
  // places, the open lead wanders, narrows, widens and closes, edges are ragged
  float rivIce = (1.0 - smoothstep(2.5, 6.0, wide)) * smoothstep(0.72, 0.92, gCold) * (1.0 - outK) * step(0.001, depth);
  if (rivIce > 0.0) {
    vec4 rl = texture2D(uNoise, p * (1.0 / 31.0) + 0.57);
    float leadFrac = clamp((rl.r - 0.47) * 1.8 + (fn.g - 0.5) * 0.6, 0.0, 0.75);
    // ice bridges close the lead every 10-20 units along the river
    leadFrac *= smoothstep(0.30, 0.46, fn.r);
    float halfW = max(wide, 0.6);
    float rag = ((fc.g - 0.5) * 0.35 + (fn.b - 0.5) * 0.5 + (fcl.r - 0.5) * 0.15) * (0.6 + 0.35 * halfW);
    float rlead = smoothstep(halfW * (1.0 - leadFrac) - 0.12, halfW * (1.0 - leadFrac) + 0.12, shoreD + rag);
    fastI = mix(fastI, 1.0 - rlead, rivIce);
  }
  ice = max(ice, fastI);
  // floes: the sheet breaks into plates with dark leads, wider toward the margin;
  // a few loose floes drift just beyond the edge
  // irregular plates: the cell lookup is warped so leads never form a regular net
  vec4 fl = texture2D(uCells, WROT2 * (p + (fn.rg - 0.5) * 7.0 + (fc.rg - 0.5) * 1.6) * (1.0 / 38.0) + 0.37);
  float iceW = iceF + (fc.b - 0.5) * 0.3 + (fn.g - 0.5) * 0.25;
  float edgeZone = 1.0 - smoothstep(0.55, 0.95, max(iceW, fastI));
  float gapW = max(mix(0.05, 0.12, edgeZone), fw * 1.4);
  float lead = 1.0 - smoothstep(gapW * 0.45, gapW, fl.g);
  // loose floes and edge shadows only where real ice is near (iceW alone is
  // noise-perturbed and is positive in warm open water)
  float nearIce = max(smoothstep(0.0, 0.05, iceF), fastI);
  // margin zone: how much sheet ice lies within ~2-4 tiles (exact fetches, cold water only)
  float margin = 0.0;
  if (gCold > 0.4 && iceF < 0.5 && outK < 0.9) {
    ivec2 mc = ivec2(floor(p));
    for (int k = 0; k < 8; k++) {
      float a = float(k) * 0.785 + 0.3;
      vec2 o = vec2(cos(a), sin(a));
      margin += isIceAt(mc + ivec2(o * 2.2), isz) * 0.09 + isIceAt(mc + ivec2(o * 4.0), isz) * 0.035;
    }
  }
  float driftK = max(nearIce * smoothstep(0.06, 0.2, iceW), clamp(margin * 1.4, 0.0, 1.0));
  // floes are whole cells with a gap (polygonal plates), fewer farther out
  float floeDrift = smoothstep(0.05, 0.08, fl.g) * step(1.0 - 0.35 * driftK, fl.b) * step(0.08, driftK) * (1.0 - outK) * step(0.001, depth);
  // leads open to dark water only at the margin; inside the sheet they are lighter
  // refrozen seams (thin ice) instead of a black crack net
  float openLead = lead * smoothstep(0.15, 0.6, edgeZone);
  float thinLead = lead * (1.0 - smoothstep(0.15, 0.6, edgeZone));
  ice = max(ice * (1.0 - openLead * smoothstep(0.05, 0.4, ice)), floeDrift * (1.0 - lead));
  float iceRim = (1.0 - smoothstep(gapW, gapW * 2.4, fl.g)) * (1.0 - lead);
  iceRim = max(iceRim, floeDrift * (1.0 - smoothstep(0.08, 0.14, fl.g)));
  // icebergs: rare faceted bergs in cold open water
  vec2 bgUV = p * (1.0 / 150.0) + (fn.gb - 0.5) * 0.012 + 0.53;
  vec4 bg = texture2D(uCells, bgUV);
  float bergGate = step(0.84, bg.b) * smoothstep(0.55, 0.8, gCold) * smoothstep(1.5, 3.0, depth) * (1.0 - outK);
  float berg = smoothstep(0.11, 0.075, bg.r) * bergGate;
  // shadow a berg throws onto the water, away from the sun
  vec2 sunXZ = L.xz / max(length(L.xz), 1e-3);
  vec4 bgS = texture2D(uCells, bgUV + sunXZ * (1.4 / 150.0));
  float bergShadow = smoothstep(0.11, 0.08, bgS.r) * step(0.84, bgS.b) * smoothstep(0.55, 0.8, gCold) * (1.0 - berg);
  // shadow line on the water just outside any ice edge (thickness)
  float iceNear = max(smoothstep(0.0, 0.35, iceW) * nearIce, smoothstep(0.16, 0.11, bg.r) * step(0.84, bg.b) * smoothstep(0.55, 0.8, gCold));

  // ---- compose (premultiplied)
  vec3 refl = sky * F * mix(1.0, 0.22, max(narrow, narrowW) * overcastK);
  float a = 1.0 - (1.0 - veil) * (1.0 - F);
  vec3 col = scat * veil * (1.0 - F) + refl + scat * crest;
  col += waterShallowColorV(lightVis) * 1.6 * wash * (1.0 - outK);
  a = clamp(a + wash * 0.25, 0.0, 1.0);
  // river streaks: lighter, sky-tinted bands moving downstream
  // flow streaks: rivers, plus steep enclosed water (gorge lakes, rapids)
  float flowK = max(narrow, (1.0 - outK) * smoothstep(1.5, 4.0, dl) * (1.0 - smoothstep(4.0, 9.0, wide)) * 0.75);
  col += flowK * streak * (mix(waterShallowColorV(lightVis), rivTeal * 1.6, overcastK * narrow) * 0.9 + sky * 0.05 * (1.0 - overcastK * 0.8));
  // from afar, rivers read as bright teal ribbons with a sky sheen, not dark roads
  float farR = smoothstep(60.0, 220.0, uCamDist);
  col += narrow * farR * (rivTeal * 1.3 + sky * 0.14 * (1.0 - overcastK * 0.7));
  // steep channels: stylised cascades = brighter streaks running downhill, never solid white
  float cascade = flowK * smoothstep(1.2, 3.5, dl);
  col += cascade * streak * foamCol * 0.30;
  col = mix(col, foamCol, foam);
  a = mix(a, 1.0, foam);
  col += spec * (1.0 - foam);
  a = clamp(a + lum(spec) * 0.25, 0.0, 1.0); // glare adds light, it must not hide the water's blue
  col *= 1.0 - 0.35 * iceNear * (1.0 - ice) * (1.0 - outK);
  col *= 1.0 - 0.45 * bergShadow * (1.0 - ice);
  if (ice > 0.0) {
    float cracks = 1.0 - smoothstep(0.0, 0.06, fc.g);
    vec3 iceAlb = mix(vec3(0.27, 0.33, 0.40), vec3(0.38, 0.44, 0.50), smoothstep(0.3, 0.8, fn.r));
    iceAlb = mix(iceAlb, vec3(0.20, 0.24, 0.33), smoothstep(0.55, 0.85, fn.b) * 0.5); // blue-violet hollows
    float cracks2 = 1.0 - smoothstep(0.0, 0.05, fc2.g);
    iceAlb *= (1.0 - cracks * 0.30) * (1.0 - cracks2 * 0.14);
    // plates: each a slightly different tone, separated by darker refrozen seams
    iceAlb *= 0.88 + 0.22 * fl.a;
    iceAlb = mix(iceAlb, iceAlb * 0.60 + vec3(0.03, 0.05, 0.07), thinLead);
    // thin, darker slush towards the floe edge
    iceAlb = mix(scat * 4.0 + vec3(0.06, 0.08, 0.10), iceAlb, smoothstep(0.0, 0.6, ice));
    // raised rim along every plate and sheet edge (reads as thickness)
    float rimK = max(iceRim, smoothstep(0.3, 0.5, ice) * (1.0 - smoothstep(0.55, 0.85, ice)));
    iceAlb = mix(iceAlb, vec3(0.52, 0.58, 0.63), rimK * 0.55);
    float ndl = max(L.y, 0.0);
    vec3 iceCol = iceAlb * (keyL * ndl * lightVis * 0.85 + uAmbCol * 0.65);
    float Fi = 0.04 + 0.96 * pow(1.0 - max(V.y, 0.0), 5.0);
    iceCol += sky * Fi * 0.5 + keyL * ggxD(max(dot(vec3(0.0, 1.0, 0.0), Hs), 0.0), 0.12) * 0.04 * lightVis;
    col = mix(col, iceCol, ice);
    a = mix(a, 1.0, ice);
  }
  if (berg > 0.0) {
    // a berg with height: dome normal from the cell distance gradient (lit face vs
    // shaded face), faceted by a fine cell layer, cool rim at the waterline
    float eb = 0.6 / 150.0;
    float gx = texture2D(uCells, bgUV + vec2(eb, 0.0)).r - texture2D(uCells, bgUV - vec2(eb, 0.0)).r;
    float gz = texture2D(uCells, bgUV + vec2(0.0, eb)).r - texture2D(uCells, bgUV - vec2(0.0, eb)).r;
    vec4 bf = texture2D(uCells, p * (1.0 / 5.0) + 0.21);
    vec3 Nb = normalize(vec3(gx * 18.0 + (bf.b - 0.5) * 0.5, 1.0, gz * 18.0 + (bf.a - 0.5) * 0.5));
    float topK = smoothstep(0.6, 0.0, bg.r / 0.11);
    vec3 bAlb = mix(vec3(0.34, 0.42, 0.50), vec3(0.58, 0.64, 0.69), topK) * (0.9 + 0.2 * bf.b);
    float ndlB = max(dot(Nb, L), 0.0);
    vec3 bCol = bAlb * (keyL * ndlB * lightVis + uAmbCol * 0.6);
    bCol = mix(bCol * 0.7, bCol, smoothstep(0.11, 0.095, bg.r)); // darker waterline rim
    col = mix(col, bCol, berg);
    a = mix(a, 1.0, berg);
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
  material.customProgramCacheKey = () => 'worldseed-water-v6';
}
