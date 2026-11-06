import * as THREE from 'three';
import { Effect, BlendFunction } from 'postprocessing';
import { FSQuad, FS_VERT } from './LinearDepthPass.js';

// "Miniature" depth of field: a physically shaped circle of confusion around
// the camera target. Because the god camera looks down on a tilted ground
// plane, a real thin-lens CoC naturally produces the tilt-shift look: a crisp
// band through the focus point, softening toward the top and bottom of the
// frame. Strength is driven by zoom (strong close up, gone when zoomed out).
//
// Half resolution pipeline (like modern engines' bokeh DOF):
//   prefilter  : 2x2 Karis-weighted downsample + signed CoC (nearest depth)
//   gather     : golden-angle disc kernel, scatter-as-gather weighting so
//                sharp pixels never bleed into blur and background never
//                smears over in-focus foreground edges
//   postfilter : tent filter to remove kernel structure
//   composite  : full resolution blend by per-pixel CoC

const COC_GLSL = /* glsl */ `
uniform vec4 uCoc; // focus distance, band, ramp, max CoC (half-res px)
uniform float uNearBoost;
float cocOf(float d) {
  float x = 1.0 - uCoc.x / max(d, 1e-3);
  float ax = abs(x);
  float c = smoothstep(uCoc.y, uCoc.y + uCoc.z, ax);
  if (x < 0.0) c = min(1.0, c * uNearBoost);
  return sign(x) * c * uCoc.w;
}
`;

const PREFILTER = /* glsl */ `
uniform sampler2D tColor;
uniform highp sampler2D tLinDepth;
uniform vec2 uTexel; // full-res texel
${COC_GLSL}
varying vec2 vUv;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  vec2 o = uTexel * 0.5;
  vec2 uv0 = vUv + vec2(-o.x, -o.y), uv1 = vUv + vec2(o.x, -o.y), uv2 = vUv + vec2(-o.x, o.y), uv3 = vUv + vec2(o.x, o.y);
  vec3 c0 = texture2D(tColor, uv0).rgb, c1 = texture2D(tColor, uv1).rgb, c2 = texture2D(tColor, uv2).rgb, c3 = texture2D(tColor, uv3).rgb;
  float w0 = 1.0 / (1.0 + luma(c0)), w1 = 1.0 / (1.0 + luma(c1)), w2 = 1.0 / (1.0 + luma(c2)), w3 = 1.0 / (1.0 + luma(c3));
  vec3 c = (c0 * w0 + c1 * w1 + c2 * w2 + c3 * w3) / (w0 + w1 + w2 + w3);
  float d = min(min(texture2D(tLinDepth, uv0).r, texture2D(tLinDepth, uv1).r), min(texture2D(tLinDepth, uv2).r, texture2D(tLinDepth, uv3).r));
  gl_FragColor = vec4(c, cocOf(d));
}
`;

const GATHER = /* glsl */ `
uniform sampler2D tPre;
uniform vec2 uTexel; // half-res texel
uniform float uMaxCoc;
varying vec2 vUv;
void main() {
  vec4 center = texture2D(tPre, vUv);
  float cc = abs(center.a);
  vec3 acc = center.rgb;
  float wsum = 1.0;
  float cocAcc = cc;
  const float GA = 2.39996323;
  for (int i = 0; i < SAMPLES; i++) {
    float fi = float(i) + 0.5;
    float r = sqrt(fi / float(SAMPLES)) * uMaxCoc;
    float th = fi * GA;
    vec2 off = vec2(cos(th), sin(th)) * r;
    vec4 s = texture2D(tPre, vUv + off * uTexel);
    float sc = abs(s.a);
    // a farther sample may not blur over a sharper (nearer) centre
    if (s.a > center.a) sc = min(sc, cc * 2.0);
    float w = smoothstep(r - 0.6, r + 0.4, sc);
    acc += s.rgb * w;
    wsum += w;
    cocAcc += sc * w;
  }
  gl_FragColor = vec4(acc / wsum, cocAcc / wsum);
}
`;

const TENT = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec4 o = uTexel.xyxy * vec2(-0.5, 0.5).xxyy;
  vec4 s = texture2D(tSrc, vUv + o.xy) + texture2D(tSrc, vUv + o.zy) + texture2D(tSrc, vUv + o.xw) + texture2D(tSrc, vUv + o.zw);
  gl_FragColor = s * 0.25;
}
`;

const COMPOSITE = /* glsl */ `
uniform sampler2D tBlur;
uniform highp sampler2D tLinDepth;
${COC_GLSL}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (uCoc.w < 0.05) { outputColor = inputColor; return; }
  float d = texture2D(tLinDepth, uv).r;
  float coc = abs(cocOf(d));
  vec4 b = texture2D(tBlur, uv);
  float t = smoothstep(0.22, 1.1, max(coc, b.a * 0.9));
  outputColor = vec4(mix(inputColor.rgb, b.rgb, t), inputColor.a);
}
`;

export class MiniatureDOF extends Effect {
  constructor(linDepthTex, { samples = 28 } = {}) {
    super('MiniatureDOF', COMPOSITE, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map([
        ['tBlur', new THREE.Uniform(null)],
        ['tLinDepth', new THREE.Uniform(linDepthTex)],
        ['uCoc', new THREE.Uniform(new THREE.Vector4(40, 0.08, 0.3, 0))],
        ['uNearBoost', new THREE.Uniform(1.4)],
      ]),
    });
    const rtOpts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false };
    this.rtPre = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.rtA = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.rtB = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.cocUniforms = { uCoc: this.uniforms.get('uCoc'), uNearBoost: this.uniforms.get('uNearBoost') };
    this.pre = new FSQuad(
      new THREE.ShaderMaterial({
        uniforms: { tColor: { value: null }, tLinDepth: { value: linDepthTex }, uTexel: { value: new THREE.Vector2() }, ...this.cocUniforms },
        vertexShader: FS_VERT,
        fragmentShader: PREFILTER,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.gather = new FSQuad(
      new THREE.ShaderMaterial({
        defines: { SAMPLES: samples },
        uniforms: { tPre: { value: this.rtPre.texture }, uTexel: { value: new THREE.Vector2() }, uMaxCoc: { value: 6 } },
        vertexShader: FS_VERT,
        fragmentShader: GATHER,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.tent = new FSQuad(
      new THREE.ShaderMaterial({
        uniforms: { tSrc: { value: this.rtA.texture }, uTexel: { value: new THREE.Vector2() } },
        vertexShader: FS_VERT,
        fragmentShader: TENT,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.uniforms.get('tBlur').value = this.rtB.texture;
    this.active = true;
  }

  // focus: world distance; band/ramp: |1 - F/d| thresholds; maxCoc: half-res px
  setFocus(focus, band, ramp, maxCoc, nearBoost = 1.4) {
    this.uniforms.get('uCoc').value.set(focus, band, ramp, maxCoc);
    this.uniforms.get('uNearBoost').value = nearBoost;
    this.gather.material.uniforms.uMaxCoc.value = Math.max(1, maxCoc);
    this.active = maxCoc >= 0.05;
  }

  update(renderer, inputBuffer) {
    if (!this.active) return;
    this.pre.material.uniforms.tColor.value = inputBuffer.texture;
    this.pre.render(renderer, this.rtPre);
    this.gather.render(renderer, this.rtA);
    this.tent.render(renderer, this.rtB);
  }

  setSize(w, h) {
    const hw = Math.max(1, Math.ceil(w / 2)),
      hh = Math.max(1, Math.ceil(h / 2));
    this.rtPre.setSize(hw, hh);
    this.rtA.setSize(hw, hh);
    this.rtB.setSize(hw, hh);
    this.pre.material.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.gather.material.uniforms.uTexel.value.set(1 / hw, 1 / hh);
    this.tent.material.uniforms.uTexel.value.set(1 / hw, 1 / hh);
  }

  dispose() {
    super.dispose();
    for (const rt of [this.rtPre, this.rtA, this.rtB]) rt.dispose();
    for (const q of [this.pre, this.gather, this.tent]) q.dispose();
  }
}
