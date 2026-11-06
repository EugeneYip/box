import * as THREE from 'three';

// Ribbon mesh for a travelling great wave. The CPU rebuilds the vertices each
// frame from the wave front (N columns along the crest, M rows across the
// wave profile); the shader draws translucent teal water darkening toward
// the trough, a churning white foam crest and spray streaks, lit by the sun
// with a fresnel sheen.

const VERT = /* glsl */ `
attribute float aFoam;
attribute float aAlpha;
varying vec3 vN;
varying vec3 vW;
varying float vFoam;
varying float vAlpha;
varying vec2 vUv;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(normal);
  vFoam = aFoam;
  vAlpha = aAlpha;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmbient;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
varying vec3 vN;
varying vec3 vW;
varying float vFoam;
varying float vAlpha;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vW);
  float ndl = max(dot(N, uSunDir), 0.0);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 water = mix(uDeep, uShallow, clamp(vUv.y * 1.2, 0.0, 1.0));
  vec3 col = water * (uAmbient * 1.1 + uSunCol * (0.35 + 0.65 * ndl)) + fres * vec3(0.55, 0.7, 0.8) * 0.5;
  vec3 H = normalize(uSunDir + V);
  col += uSunCol * pow(max(dot(N, H), 0.0), 60.0) * 0.8;
  float n = vnoise(vW.xz * 1.6 + vec2(uTime * 0.7, -uTime * 0.9)) * 0.6 + vnoise(vW.xz * 4.0 - uTime * 1.3) * 0.4;
  float foam = smoothstep(0.35, 0.75, vFoam + (n - 0.5) * 0.7);
  vec3 foamCol = vec3(0.95, 0.98, 1.0) * (uAmbient + uSunCol * (0.5 + 0.5 * ndl));
  col = mix(col, foamCol, foam);
  float a = mix(0.82, 0.97, foam) * vAlpha;
  float fog = smoothstep(fogNear, fogFar, length(cameraPosition - vW));
  col = mix(col, fogColor, fog);
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, 1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * a, a);
}`;

// Cross-section of the wave: [forward offset, height, foam] in units of the
// local amplitude. Index 0 is the long back slope, the last is the curling lip.
export const PROFILE = [
  [-5.0, 0.0, 0.0],
  [-3.6, 0.22, 0.0],
  [-2.4, 0.5, 0.05],
  [-1.4, 0.8, 0.15],
  [-0.6, 0.97, 0.45],
  [0.0, 1.0, 0.85],
  [0.45, 0.88, 1.0],
  [0.7, 0.6, 1.0],
  [0.62, 0.35, 0.9],
];

export class WaveMesh {
  constructor(fx, columns) {
    this.fx = fx;
    this.N = columns;
    this.M = PROFILE.length;
    const nv = this.N * this.M;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(nv * 3);
    this.nrm = new Float32Array(nv * 3);
    this.foam = new Float32Array(nv);
    this.alpha = new Float32Array(nv);
    const uv = new Float32Array(nv * 2);
    for (let i = 0; i < this.N; i++)
      for (let j = 0; j < this.M; j++) {
        const v = i * this.M + j;
        uv[v * 2] = i / (this.N - 1);
        uv[v * 2 + 1] = PROFILE[j][1];
        this.foam[v] = PROFILE[j][2];
      }
    const idx = [];
    for (let i = 0; i < this.N - 1; i++)
      for (let j = 0; j < this.M - 1; j++) {
        const a = i * this.M + j,
          b = (i + 1) * this.M + j;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aFoam', new THREE.BufferAttribute(this.foam, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geo = geo;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: fx.uniforms.uTime,
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunCol: fx.uniforms.uSunCol,
        uAmbient: fx.uniforms.uAmbient,
        uDeep: { value: new THREE.Color(0x0f5a78) },
        uShallow: { value: new THREE.Color(0x3fb4c4) },
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      fog: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    fx.game.scene.add(this.mesh);
  }

  // cols: array of {x, z, y (base water level), amp, alpha}; dir = unit heading
  build(cols, dx, dz) {
    const { N, M, pos, alpha } = this;
    for (let i = 0; i < N; i++) {
      const c = cols[i];
      for (let j = 0; j < M; j++) {
        const v = (i * M + j) * 3;
        const p = PROFILE[j];
        const a = c.amp;
        pos[v] = c.x + dx * p[0] * a * 1.3;
        pos[v + 1] = c.y + p[1] * a;
        pos[v + 2] = c.z + dz * p[0] * a * 1.3;
        alpha[i * M + j] = c.alpha;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.computeVertexNormals();
    const env = this.fx.game.env;
    if (env.sunDir) this.material.uniforms.uSunDir.value.copy(env.sunDir);
  }

  dispose() {
    this.fx.game.scene.remove(this.mesh);
    this.geo.dispose();
    this.material.dispose();
  }
}
