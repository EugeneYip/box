import * as THREE from 'three';
import { Effect, BlendFunction } from 'postprocessing';
import { SKY_UNIFORMS_GLSL, SKY_FUNCS_GLSL } from '../shaders/skyChunk.js';

// Screen-space aerial perspective, ground mist and cloud shadows.
//
// World positions are rebuilt from linear depth. Haze takes the colour of the
// sky in the direction of each ray (same GLSL as the dome), so far land and
// ocean dissolve into the horizon with no seam, warm toward the sun at golden
// hour and cool away from it. Mist is an analytic exponential height fog
// that pools in valleys and over the sea. During rain a wet sheen (sky
// reflection + key-light glints) is added to upward-facing surfaces.
// Cloud shadows are NOT applied here: materials apply env.cloudShadow to
// their direct light.

const FRAG = /* glsl */ `
uniform highp sampler2D tLinDepth;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform vec4 uHaze;   // start, density, height falloff, max
uniform vec4 uMist;   // density, falloff (1/H), base height, max
uniform vec3 uMistColor;
uniform sampler2D tHeight;  // world heights (game.terrain.heightTexture)
uniform vec3 uWorld;       // world w, h, has-height-texture
uniform float uWet;
uniform vec3 uLightDir;
uniform vec3 uLightCol;
uniform vec2 uCloudOffset;
uniform float uCover;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
float hHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hHash(i), hHash(i + vec2(1, 0)), u.x), mix(hHash(i + vec2(0, 1)), hHash(i + vec2(1, 1)), u.x), u.y);
}
float hFbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * hNoise(p); p = mat2(0.8, -0.6, 0.6, 0.8) * p * 2.03 + 11.7; a *= 0.5; }
  return s / 0.9375;
}
${SKY_UNIFORMS_GLSL}
${SKY_FUNCS_GLSL}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float lin = texture2D(tLinDepth, uv).r;
  if (lin > 60000.0) { outputColor = inputColor; return; }
  vec4 fp = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 vdir = fp.xyz / fp.w;
  vec3 viewPos = vdir * (lin / -vdir.z);
  vec3 wp = (uCamWorld * vec4(viewPos, 1.0)).xyz;
  vec3 ray = wp - uCamPos;
  float dist = length(ray);
  vec3 dir = ray / max(dist, 1e-4);
  vec3 col = inputColor.rgb;

  // ---- wet sheen (rain): sky reflection + key-light glint on soaked ground
  // (cloud shadows are applied per material to direct light, not here)
  if (uWet > 0.01) {
    vec3 dx = dFdx(wp), dy = dFdy(wp);
    vec3 nrm = normalize(cross(dx, dy));
    if (dot(nrm, dir) > 0.0) nrm = -nrm;
    float valid = 1.0 - smoothstep(dist * 0.01, dist * 0.03, max(length(dx), length(dy)));
    float up = smoothstep(0.35, 0.85, nrm.y);
    // Depth-derived normals are faceted per terrain triangle, so a sharp
    // glint would light up whole tiles. Use a heavily smoothed normal and a
    // broad, dim sheen instead.
    vec3 ns = normalize(mix(vec3(0.0, 1.0, 0.0), nrm, 0.25));
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(ns, -dir), 0.0), 5.0);
    vec3 r = reflect(dir, ns);
    vec3 refl = skyBase(normalize(vec3(r.x, max(r.y, 0.03), r.z)));
    float sheen = pow(max(dot(r, uLightDir), 0.0), 8.0) * 0.03;
    col = mix(col, col * 0.88, uWet * up * valid * 0.5); // darker when soaked
    col += uWet * up * valid * (refl * fres * 0.4 + uLightCol * sheen);
  }

  // ---- ground mist (exponential height fog, integrated along the ray) ---
  if (uMist.x > 1e-6) {
    float b = uMist.y;
    float y0 = uCamPos.y - uMist.z;
    float y1 = max(wp.y - uMist.z, -1.5);
    float dy = y1 - y0;
    float od = abs(dy) < 1e-3
      ? uMist.x * dist * exp(-b * y0)
      : uMist.x * dist * (exp(-b * y0) - exp(-b * y1)) / (b * dy);
    float mist = min(1.0 - exp(-max(od, 0.0)), uMist.w);
    float fwd = pow(max(dot(dir, uSunDir), 0.0), 5.0);
    vec3 mc = uMistColor + uHalo * fwd * 0.35;
    col = mix(col, mc, mist);
  }

  // ---- aerial haze ---------------------------------------------------------
  float hz = 1.0 - exp(-max(dist - uHaze.x, 0.0) * uHaze.y);
  hz *= mix(1.0, exp(-max(wp.y, 0.0) * uHaze.z), 0.7);
  // Looking down at the map the haze stays a light veil (land and sea stay
  // readable) and takes the sky's colour; only near-horizontal rays may fog
  // out completely into the horizon glow.
  float down = smoothstep(0.06, 0.4, -dir.y);
  hz = min(hz, mix(uHaze.w, 0.35, down));
  // much less haze over open water seen from above: the sea keeps its own
  // colour (and the sun-path glitter) instead of turning into a flat veil
  float water = smoothstep(0.6, 0.05, wp.y);
  if (uWorld.z > 0.5) {
    vec2 huv = wp.xz / uWorld.xy;
    bool inside = huv.x > 0.0 && huv.y > 0.0 && huv.x < 1.0 && huv.y < 1.0;
    float th = inside ? texture2D(tHeight, huv).r : -4.0;
    water = smoothstep(0.25, -0.35, th);
  }
  hz *= mix(1.0, 0.35, water * down);
  vec3 hc = mix(hazeColor(dir), mix(uHorizon, uZenith, 0.68), smoothstep(0.08, 0.5, -dir.y));
  // Near-horizontal rays (low camera pitch): instead of a flat haze wall the
  // far distance dissolves into a painted sky band: a real gradient (lower
  // rays read higher, bluer sky), the sun's glow, and distant cloud banks.
  float horiz = 1.0 - smoothstep(0.02, 0.16, -dir.y);
  if (horiz > 0.001 && hz > 0.02) {
    float ly = 0.012 + max(0.0, -dir.y) * 1.6;
    vec3 sd = normalize(vec3(dir.x, ly, dir.z));
    vec3 band = skyBase(sd);
    vec2 cp = sd.xz / (ly + 0.06) * 0.9 + uCloudOffset;
    float n = hFbm(cp);
    float cov = clamp(0.32 + uCover * 0.8, 0.0, 1.0);
    float cb = smoothstep(1.02 - cov, 1.25 - cov * 0.6, n) * (1.0 - smoothstep(0.05, 0.3, ly));
    float shade = smoothstep(0.3, 0.9, hFbm(cp * 1.7 + vec2(0.4, 0.2)));
    float sunSide = pow(max(dot(normalize(sd.xz + 1e-4), normalize(uSunDir.xz + 1e-4)) * 0.5 + 0.5, 0.0), 3.0);
    vec3 litC = uCloudLit * 1.15 + uCloudShade * 0.55;
    vec3 darkC = uCloudShade * 0.6 + uCloudLit * 0.12;
    vec3 cc = mix(mix(litC, darkC, sunSide * 0.8), uCloudShade * 0.55, shade * 0.45);
    cc += uGlow * sunSide * (1.0 - smoothstep(0.0, 0.6, cb)) * 1.2;
    band = mix(band, cc, cb * 0.9);
    // over open water the far sea stays a darker, sky-reflecting band, so a
    // clear horizon line separates sea from sky
    vec3 seaRefl = skyBase(normalize(vec3(sd.x, 0.05 + ly * 0.8, sd.z))) * 0.58;
    seaRefl += uHalo * pow(max(dot(normalize(vec3(sd.x, 0.0, sd.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0), 40.0) * 0.5;
    band = mix(band, seaRefl, water);
    hc = mix(hc, band, horiz);
    hz = min(hz, mix(0.95, 0.8, water));
  }
  col = mix(col, hc, hz);

  outputColor = vec4(col, inputColor.a);
}
`;

export class AtmosphereEffect extends Effect {
  constructor(linDepthTex, cloudTex) {
    const u = (v) => new THREE.Uniform(v);
    super('AtmosphereEffect', FRAG, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map([
        ['tLinDepth', u(linDepthTex)],
        ['uInvProj', u(new THREE.Matrix4())],
        ['uCamWorld', u(new THREE.Matrix4())],
        ['uCamPos', u(new THREE.Vector3())],
        ['uHaze', u(new THREE.Vector4(300, 0.004, 0.02, 1))],
        ['uMist', u(new THREE.Vector4(0, 0.4, 0, 0.9))],
        ['uMistColor', u(new THREE.Color(0.8, 0.85, 0.9))],
        ['tHeight', u(null)],
        ['uWorld', u(new THREE.Vector3(256, 256, 0))],
        ['uWet', u(0)],
        ['uLightDir', u(new THREE.Vector3(0, 1, 0))],
        ['uLightCol', u(new THREE.Color())],
        ['uCloudOffset', u(new THREE.Vector2())],
        ['uCover', u(0.4)],
        ['uCloudLit', u(new THREE.Color())],
        ['uCloudShade', u(new THREE.Color())],
        ['uSunDir', u(new THREE.Vector3(0, 1, 0))],
        ['uMoonDir', u(new THREE.Vector3(0, 1, 0))],
        ['uZenith', u(new THREE.Color())],
        ['uHorizon', u(new THREE.Color())],
        ['uGlow', u(new THREE.Color())],
        ['uBelt', u(new THREE.Color())],
        ['uHalo', u(new THREE.Color())],
        ['uGroundHaze', u(new THREE.Color())],
        ['uGlowWidth', u(2.5)],
      ]),
    });
  }

  sync(camera, sky, params) {
    const U = this.uniforms;
    U.get('uInvProj').value.copy(camera.projectionMatrixInverse);
    U.get('uCamWorld').value.copy(camera.matrixWorld);
    U.get('uCamPos').value.setFromMatrixPosition(camera.matrixWorld);
    for (const k of ['uSunDir', 'uMoonDir', 'uZenith', 'uHorizon', 'uGlow', 'uBelt', 'uHalo', 'uGroundHaze', 'uCloudOffset', 'uCloudLit', 'uCloudShade']) U.get(k).value.copy(sky[k].value);
    U.get('uCover').value = sky.uCover.value;
    U.get('uGlowWidth').value = sky.uGlowWidth.value;
    if (params) {
      U.get('uHaze').value.copy(params.haze);
      U.get('uMist').value.copy(params.mist);
      U.get('uMistColor').value.copy(params.mistColor);
      U.get('uWet').value = params.wet || 0;
      U.get('tHeight').value = params.heightTex || null;
      U.get('uWorld').value.set(params.worldW || 256, params.worldH || 256, params.heightTex ? 1 : 0);
      U.get('uLightDir').value.copy(params.lightDir);
      U.get('uLightCol').value.copy(params.lightColor);
    }
  }
}
