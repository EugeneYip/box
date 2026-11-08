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
  vec3 hc = mix(hazeColor(dir), mix(uHorizon, uZenith, 0.55), smoothstep(0.08, 0.5, -dir.y));
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
    for (const k of ['uSunDir', 'uMoonDir', 'uZenith', 'uHorizon', 'uGlow', 'uBelt', 'uHalo', 'uGroundHaze']) U.get(k).value.copy(sky[k].value);
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
