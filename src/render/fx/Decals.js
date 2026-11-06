import * as THREE from 'three';
import { HEIGHT_GLSL } from './HeightField.js';

// Ground decals: instanced subdivided quads whose vertices are snapped to the
// terrain height field in the vertex shader, so marks hug hills and crater
// walls. Two batches share one atlas:
//   multiply  darkens what is below (scorch, crater soot, cracks, stains);
//             lighting-correct because it multiplies the final lit colour.
//   additive  emissive glows (hot crater floors, glowing cracks, shockwave
//             rings, rune circles, water ripples).
// surface: 0 = land only (fades out over water), 1 = water surface only,
//          2 = whichever is on top.

const VERT = /* glsl */ `
uniform float uTime;
attribute vec4 dA; // x, z, size, rotation
attribute vec4 dB; // t0, life, fadeIn, grow
attribute vec4 dC; // colour rgb (linear), alpha/strength
attribute vec4 dD; // frame, surface, intensity, cool
attribute vec4 dE; // fadeOutStart, grain, lift, spin
varying vec2 vUv;
varying vec4 vCol;
varying float vA;
varying float vFogDepth;
varying vec2 vWorld;
varying float vT;
varying vec2 vLocal;
varying float vInt;
varying float vGrain;
${HEIGHT_GLSL}
void main() {
  float age = uTime - dB.x;
  float t = age / max(dB.y, 1e-3);
  if (age < 0.0 || t >= 1.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  float g = 1.0 - pow(1.0 - t, 3.0);
  float size = dA.z * mix(1.0, dB.w, g);
  float rot = dA.w + dE.w * age;
  float c = cos(rot), s = sin(rot);
  vec2 l = position.xy;
  vec2 o = vec2(c * l.x - s * l.y, s * l.x + c * l.y) * size;
  vec2 xz = dA.xy + o;
  float h = fxGroundAt(xz);
  float y;
  float vis = 1.0;
  if (dD.y < 0.5) {
    y = h;
    vis = smoothstep(-0.25, 0.02, h);
  } else if (dD.y < 1.5) {
    y = 0.0;
    vis = 1.0 - smoothstep(-0.12, 0.05, h);
  } else {
    y = max(h, 0.0);
  }
  vec4 mv = viewMatrix * vec4(xz.x, y + 0.035 + dE.z, xz.y, 1.0);
  mv.xyz *= 0.9985;
  gl_Position = projectionMatrix * mv;
  vFogDepth = -mv.z;
  float f = dD.x;
  vec2 cell = vec2(mod(f, 4.0), floor(f / 4.0));
  vUv = (cell + vec2(l.x + 0.5, 0.5 - l.y)) * 0.25;
  float fadeIn = dB.z > 0.0 ? smoothstep(0.0, dB.z, t) : 1.0;
  float fadeOut = 1.0 - smoothstep(dE.x, 1.0, t);
  vA = fadeIn * fadeOut * vis;
  vec3 col = dC.rgb;
  // cooling: hot glows drift from their colour toward deep red, then out
  col = mix(col, vec3(0.5, 0.04, 0.0) * length(col) * 0.6, clamp(t * dD.w, 0.0, 1.0));
  vCol = vec4(col, dC.a);
  vInt = dD.z;
  vWorld = xz;
  vLocal = l;
  vT = t;
  vGrain = dE.y;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uDecal;
uniform float uMultiply;
uniform float uTime;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
uniform float fogDensity;
varying vec2 vUv;
varying vec4 vCol;
varying float vA;
varying float vFogDepth;
varying vec2 vWorld;
varying float vT;
varying vec2 vLocal;
varying float vInt;
varying float vGrain;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  vec4 tx = texture2D(uDecal, vUv);
  float fog = 0.0;
#ifdef USE_FOG
#ifdef FOG_EXP2
  fog = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
#else
  fog = smoothstep(fogNear, fogFar, vFogDepth);
#endif
#endif
  float grain = mix(1.0, 0.55 + 0.9 * vnoise(vWorld * 3.1) * vnoise(vWorld * 0.9 + 7.0), vGrain);
  float a = tx.a * vA * (1.0 - fog);
  if (uMultiply > 0.5) {
    float d = clamp(tx.r * a * vCol.a * grain, 0.0, 1.0);
    if (d < 0.004) discard;
    gl_FragColor = vec4(mix(vec3(1.0), vCol.rgb, d), 1.0);
  } else {
    float flick = 1.0;
    float m = tx.g * a * vCol.a * grain;
    if (m < 0.002) discard;
    gl_FragColor = vec4(vCol.rgb * m * vInt * flick, 1.0);
#include <colorspace_fragment>
  }
}
`;

class DecalBatch {
  constructor(fx, capacity, multiply, renderOrder) {
    this.fx = fx;
    this.capacity = capacity;
    this.death = new Float32Array(capacity).fill(-1);
    this.cursor = 0;
    const geo = new THREE.InstancedBufferGeometry();
    const grid = new THREE.PlaneGeometry(1, 1, 14, 14);
    geo.index = grid.index;
    geo.setAttribute('position', grid.getAttribute('position'));
    this.attrs = {};
    for (const k of ['dA', 'dB', 'dC', 'dD', 'dE']) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(k, a);
      this.attrs[k] = a;
    }
    geo.instanceCount = 0;
    this.geo = geo;
    this.used = 0;
    const blend = multiply
      ? { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor }
      : { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor };
    this.material = new THREE.ShaderMaterial({
      name: multiply ? 'fx-decals-mul' : 'fx-decals-add',
      uniforms: {
        uTime: fx.uniforms.uTime,
        uDecal: { value: fx.textures.decals },
        uMultiply: { value: multiply ? 1 : 0 },
        ...fx.heightField.uniforms(),
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -6,
      toneMapped: false,
      ...blend,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = this.material.name;
  }
  add(d, now) {
    // reuse a dead slot or the one dying soonest
    let slot = -1,
      best = Infinity;
    for (let k = 0; k < this.capacity; k++) {
      const i = (this.cursor + k) % this.capacity;
      if (this.death[i] <= now) {
        slot = i;
        break;
      }
      if (this.death[i] < best) {
        best = this.death[i];
        slot = i;
      }
      if (k > 64 && slot >= 0 && best < now + 2) break;
    }
    this.cursor = (slot + 1) % this.capacity;
    const t0 = now + (d.delay || 0);
    this.death[slot] = t0 + d.life;
    const o = slot * 4;
    const w = (k, a, b, c, e) => {
      const A = this.attrs[k].array;
      A[o] = a;
      A[o + 1] = b;
      A[o + 2] = c;
      A[o + 3] = e;
    };
    w('dA', d.x, d.z, d.size, d.rot ?? Math.random() * Math.PI * 2);
    w('dB', t0, d.life, d.fadeIn ?? 0.02, d.grow ?? 1);
    const c = d.color;
    w('dC', c.r, c.g, c.b, d.alpha ?? 1);
    w('dD', d.frame, d.surface ?? 0, d.intensity ?? 1, d.cool ?? 0);
    w('dE', d.fadeOut ?? 0.7, d.grain ?? 0.6, d.lift ?? 0, d.spin ?? 0);
    for (const k in this.attrs) {
      const at = this.attrs[k];
      at.addUpdateRange(o, 4);
      at.needsUpdate = true;
    }
    this.used = Math.max(this.used, slot + 1);
    this.geo.instanceCount = this.used;
  }
  flushRanges() {
    for (const k in this.attrs) if (this.attrs[k].updateRanges.length > 32) {
      // collapse many tiny ranges into one span to keep uploads cheap
      const at = this.attrs[k];
      let lo = Infinity,
        hi = -1;
      for (const r of at.updateRanges) {
        lo = Math.min(lo, r.start);
        hi = Math.max(hi, r.start + r.count);
      }
      at.clearUpdateRanges();
      at.addUpdateRange(lo, hi - lo);
    }
  }
  clear() {
    this.death.fill(-1);
    this.used = 0;
    this.geo.instanceCount = 0;
  }
}

export class Decals {
  constructor(fx) {
    this.fx = fx;
    this.mul = new DecalBatch(fx, 320, true, 4);
    this.add = new DecalBatch(fx, 256, false, 5);
    this._c = new THREE.Color();
  }
  addTo(scene) {
    scene.add(this.mul.mesh, this.add.mesh);
  }
  // d: {x, z, size, frame, life, color(hex|Color), alpha, additive, rot,
  //     fadeIn, fadeOut, grow, surface, intensity, cool, grain, delay, spin}
  spawn(d) {
    const c = d.color instanceof THREE.Color ? d.color : this._c.setHex(d.color ?? (d.additive ? 0xffa040 : 0x1a1410));
    const rec = { ...d, color: c };
    (d.additive ? this.add : this.mul).add(rec, this.fx.time);
  }
  update() {
    this.mul.flushRanges();
    this.add.flushRanges();
  }
  clear() {
    this.mul.clear();
    this.add.clear();
  }
}
