import * as THREE from 'three';

// Animated tornado funnel: two nested open cylinders deformed in the vertex
// shader into a flared, bending, wobbling vortex. The fragment shader draws
// twisting dust streaks that spiral upward, denser at the silhouette, lit by
// the sun with wrap lighting. Back faces render before front faces so the
// translucent layers composite cleanly.

const VERT = /* glsl */ `
uniform float uTime;
uniform float uHeight;
uniform float uR0;
uniform float uR1;
uniform vec2 uBend;
uniform float uSpin;
varying vec2 vUv;
varying float vH;
varying vec3 vN;
varying vec3 vWorld;
void main() {
  float h = position.y;
  float ang = atan(position.z, position.x);
  float prof = uR0 + (uR1 - uR0) * pow(h, 1.9);
  prof += uR0 * 1.2 * exp(-h * 14.0);
  float wob = 1.0 + 0.13 * sin(ang * 3.0 + uTime * 5.0 + h * 9.0) + 0.07 * sin(ang * 5.0 - uTime * 7.0 + h * 17.0);
  vec3 p = vec3(cos(ang) * prof * wob, h * uHeight, sin(ang) * prof * wob);
  float s = h * h * (3.0 - 2.0 * h);
  p.xz += uBend * s + vec2(sin(uTime * 1.3 + h * 4.0), cos(uTime * 1.1 + h * 3.3)) * 0.55 * h;
  float dr = (uR1 - uR0) * 1.9 * pow(max(h, 0.001), 0.9) / uHeight;
  vN = normalize(mat3(modelMatrix) * normalize(vec3(cos(ang), -dr, sin(ang))));
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vUv = vec2(ang / 6.2831853 + 0.5, h);
  vH = h;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uSpin;
uniform vec3 uColor;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmbient;
uniform float uDensity;
uniform float uFloor;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
varying vec2 vUv;
varying float vH;
varying vec3 vN;
varying vec3 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
// tileable in x (period = p)
float tnoise(vec2 q, float p) {
  vec2 i = floor(q), f = fract(q);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(vec2(mod(i.x, p), i.y));
  float b = hash(vec2(mod(i.x + 1.0, p), i.y));
  float c = hash(vec2(mod(i.x, p), i.y + 1.0));
  float d = hash(vec2(mod(i.x + 1.0, p), i.y + 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
void main() {
  // twist with height, rotate with time (never multiply time by height:
  // that would make the streak frequency grow without bound)
  float a = vUv.x + vH * 1.9 - uTime * uSpin * 0.8 + 0.05 * sin(vH * 6.0 + uTime * 2.0);
  // streaks run along the twist (low frequency in height): horizontal
  // bands would read as concentric rings from the god-view camera
  float n1 = tnoise(vec2(a * 10.0, vH * 2.5 - uTime * 1.2), 10.0);
  float n2 = tnoise(vec2(a * 20.0, vH * 4.5 - uTime * 2.0), 20.0);
  float streak = n1 * 0.65 + n2 * 0.35;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vN);
  float facing = abs(dot(N, V));
  float rim = pow(1.0 - facing, 1.6);
  float ends = smoothstep(0.0, 0.04, vH) * (1.0 - smoothstep(0.86, 1.0, vH));
  float dens = (0.2 + 0.8 * smoothstep(0.3, 0.8, streak)) * (0.45 + 0.9 * rim) * uDensity;
  // the core layer has an opacity floor so the vortex reads as solid mass
  dens = max(dens, uFloor * (0.9 + 0.1 * streak)) * ends;
  float alpha = clamp(dens * uAlpha, 0.0, 0.99);
  if (alpha < 0.004) discard;
  float ndl = dot(N, uSunDir) * 0.5 + 0.5;
  vec3 grad = mix(vec3(0.78, 0.64, 0.48), vec3(1.08, 1.06, 1.06), smoothstep(0.05, 0.9, vH));
  vec3 col = uColor * grad * (uAmbient + uSunCol * ndl) * (0.62 + 0.6 * streak);
  // darker toward the silhouette edge for a rounded, solid read
  col *= mix(0.8, 1.0, vH) * mix(1.0, 0.75, rim);
  float fog = smoothstep(fogNear, fogFar, length(cameraPosition - vWorld));
  col = mix(col, fogColor, fog);
  gl_FragColor = vec4(col, 1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * alpha, alpha);
}`;

const CAP_VERT = /* glsl */ `
varying vec2 vP;
varying vec3 vW;
void main() {
  vP = position.xz;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  // slight dome so the cap bulges like a wall cloud
  wp.y += (1.0 - dot(position.xz, position.xz)) * 1.6;
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const CAP_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform vec3 uColor;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmbient;
varying vec2 vP;
varying vec3 vW;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  float r = length(vP);
  if (r > 1.0) discard;
  float a = atan(vP.y, vP.x);
  // a compact churning cloud: rotating noise only (no spiral arms, which
  // read as concentric grooves from above)
  // rigid rotation plus a FIXED twist: a radius-dependent spin rate winds
  // the noise into concentric rings within seconds
  float ra = a + uTime * 0.45 + r * 1.4;
  vec2 q = vec2(cos(ra), sin(ra)) * r * 3.0;
  float n = vnoise(q + 3.0) * 0.55 + vnoise(q * 2.3 + 7.0) * 0.3 + vnoise(q * 5.1) * 0.15;
  // soft, lumpy edge and strong light/dark churn: from above it must read
  // as a storm cell over the funnel, not a dark hole in the ground
  float dens = 0.55 + 0.6 * n;
  dens *= 1.0 - smoothstep(0.2, 1.0, r + (n - 0.5) * 0.55);
  float alpha = clamp(dens * uAlpha, 0.0, 0.9);
  if (alpha < 0.005) discard;
  float lit = 0.4 + 0.85 * n;
  vec3 col = uColor * (uAmbient * 1.2 + uSunCol * max(uSunDir.y, 0.15) * lit);
  gl_FragColor = vec4(col, 1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * alpha, alpha);
}`;

export class TornadoFunnel {
  constructor(fx) {
    this.fx = fx;
    const geo = new THREE.CylinderGeometry(1, 1, 1, 48, 40, true);
    geo.translate(0, 0.5, 0);
    this.group = new THREE.Group();
    this.layers = [];
    const mk = (side, order, color, density, r0, r1, spin, floor = 0) => {
      const u = {
        uFloor: { value: floor },
        uTime: { value: 0 },
        uHeight: { value: 16 },
        uR0: { value: r0 },
        uR1: { value: r1 },
        uBend: { value: new THREE.Vector2() },
        uSpin: { value: spin },
        uAlpha: { value: 0 },
        uColor: { value: new THREE.Color(color) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunCol: fx.uniforms.uSunCol,
        uAmbient: fx.uniforms.uAmbient,
        uDensity: { value: density },
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      };
      const mat = new THREE.ShaderMaterial({
        uniforms: u,
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        side,
        fog: true,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      });
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      m.renderOrder = order;
      this.group.add(m);
      this.layers.push({ mesh: m, u, r0, r1, base: u.uColor.value.clone() });
    };
    // dark opaque core + lighter churning dust sleeve (radii doubled)
    mk(THREE.BackSide, 16, 0x3e342a, 1.4, 0.2, 0.95, 1.1, 0.9);
    mk(THREE.FrontSide, 17, 0x3e342a, 1.4, 0.2, 0.95, 1.1, 0.9);
    mk(THREE.BackSide, 18, 0x9a8a72, 0.8, 0.5, 2.6, 0.75);
    mk(THREE.FrontSide, 19, 0x9a8a72, 0.8, 0.5, 2.6, 0.75);
    // rotating cloud cap (what a top-down camera mostly sees)
    this.capU = {
      uTime: { value: 0 },
      uAlpha: { value: 0 },
      uColor: { value: new THREE.Color(0x4e4842) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: fx.uniforms.uSunCol,
      uAmbient: fx.uniforms.uAmbient,
    };
    this.cap = new THREE.Mesh(
      new THREE.CircleGeometry(1, 64, 0, Math.PI * 2).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        uniforms: this.capU,
        vertexShader: CAP_VERT,
        fragmentShader: CAP_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      }),
    );
    this.cap.frustumCulled = false;
    this.cap.renderOrder = 21;
    fx.game.scene.add(this.cap);
    fx.game.scene.add(this.group);
  }

  set(x, y, z, opts) {
    this.group.position.set(x, y, z);
    const env = this.fx.game.env;
    for (const L of this.layers) {
      const u = L.u;
      u.uTime.value = this.fx.time + (opts.seed || 0);
      u.uHeight.value = opts.height;
      u.uR0.value = L.r0 * opts.width;
      u.uR1.value = L.r1 * opts.width;
      u.uBend.value.set(opts.bendX, opts.bendZ);
      u.uAlpha.value = opts.alpha;
      if (env.sunDir) u.uSunDir.value.copy(env.sunDir);
      u.uColor.value.copy(L.base);
      if (opts.tint) u.uColor.value.multiply(opts.tint);
    }
    // cap sits on top of the bent funnel
    // kept small: at the default pitch a wide cap hides the whole stem
    const capR = 1.3 + 1.6 * opts.width;
    this.cap.position.set(x + opts.bendX, y + opts.height * 0.97, z + opts.bendZ);
    this.cap.scale.set(capR, 1, capR);
    this.capU.uTime.value = this.fx.time + (opts.seed || 0);
    this.capU.uAlpha.value = opts.alpha;
    if (env.sunDir) this.capU.uSunDir.value.copy(env.sunDir);
  }

  dispose() {
    this.fx.game.scene.remove(this.group);
    this.fx.game.scene.remove(this.cap);
    for (const L of this.layers) L.mesh.material.dispose();
    this.cap.material.dispose();
    this.cap.geometry.dispose();
  }
}
