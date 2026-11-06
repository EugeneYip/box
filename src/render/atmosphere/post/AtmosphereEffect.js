import * as THREE from 'three';
import { Effect, BlendFunction } from 'postprocessing';
import { SKY_UNIFORMS_GLSL, SKY_FUNCS_GLSL } from '../shaders/skyChunk.js';

// Screen-space aerial perspective, ground mist and cloud shadows.
//
// World positions are rebuilt from linear depth. Haze takes the colour of the
// sky in the direction of each ray (same GLSL as the dome), so far land and
// ocean dissolve into the horizon with no seam, warm toward the sun at golden
// hour and cool away from it. Mist is an analytic exponential height fog
// that pools in valleys and over the sea. Cloud shadows are the published
// env.cloudShadow texture applied to everything on screen.

const FRAG = /* glsl */ `
uniform highp sampler2D tLinDepth;
uniform sampler2D tCloud;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform vec4 uHaze;   // start, density, height falloff, max
uniform vec4 uMist;   // density, falloff (1/H), base height, max
uniform vec3 uMistColor;
uniform vec4 uCloud;  // offX, offZ, 1/scale, strength
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

  // ---- cloud shadows ---------------------------------------------------
  if (uCloud.w > 0.001) {
    vec2 cuv = (wp.xz + uCloud.xy) * uCloud.z;
    float inside = step(0.0, cuv.x) * step(cuv.x, 1.0) * step(0.0, cuv.y) * step(cuv.y, 1.0);
    float cs = texture2D(tCloud, cuv).r * inside;
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col *= 1.0 - uCloud.w * cs * (1.0 - smoothstep(1.4, 4.0, lum));
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
  hz = min(hz, uHaze.w);
  col = mix(col, hazeColor(dir), hz);

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
        ['tCloud', u(cloudTex)],
        ['uInvProj', u(new THREE.Matrix4())],
        ['uCamWorld', u(new THREE.Matrix4())],
        ['uCamPos', u(new THREE.Vector3())],
        ['uHaze', u(new THREE.Vector4(300, 0.004, 0.02, 1))],
        ['uMist', u(new THREE.Vector4(0, 0.4, 0, 0.9))],
        ['uMistColor', u(new THREE.Color(0.8, 0.85, 0.9))],
        ['uCloud', u(new THREE.Vector4(0, 0, 1 / 512, 0))],
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
      U.get('uCloud').value.copy(params.cloud);
      if (params.cloudTex) U.get('tCloud').value = params.cloudTex;
    }
  }
}
