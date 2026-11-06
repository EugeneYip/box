import * as THREE from 'three';
import { HEIGHT_GLSL } from './HeightField.js';

// GPU particle layer: one instanced quad per particle. Motion is evaluated
// analytically in the vertex shader from spawn-time parameters, so the CPU
// only writes a particle once (when it is born) and uploads just the slots
// that changed. Supports:
//   mode 0  camera-facing billboard with spin
//   mode 1  velocity-stretched streak (sparks, embers, droplets)
//   mode 2  upright flame (axis = world up + wind lean, anchored at its base)
//   mode 3  flat on a horizontal plane (ripples, ground rings)
//   mode 4  swirl around a vertical axis (tornado dust)
// Motion (modes 0-3): exponential approach from the initial velocity v0 to
// a terminal velocity vT with drag k (vT carries wind drift, buoyancy and
// gravity): p(t) = p0 + (v0 - vT)(1 - e^-kt)/k + vT t.
// Colour/alpha over life comes from a ramp row multiplied by a tint; flames
// shift the ramp lookup by the texture heat channel so cores stay white-hot.
// Lit particles (smoke, dust) use a spherical billboard normal and the
// current sun / ambient colours. Soft particles fade where they meet the
// terrain or water surface (height field sampled per corner).
// Output is premultiplied: 'add' = 1 makes a particle purely additive, 0 is
// normal alpha blending, so one layer can mix both without sorting issues.

const VERT = /* glsl */ `
uniform float uTime;
uniform vec3 uWind;
uniform float uNear;
uniform vec4 uPL[6];
uniform vec3 uPLC[6];
varying vec3 vPL;
attribute vec4 iA;
attribute vec4 iB;
attribute vec4 iC;
attribute vec4 iD;
attribute vec4 iE;
attribute vec4 iF;
attribute vec4 iG;
attribute vec4 iH;
varying vec2 vUvA;
varying vec2 vUvB;
varying float vMix;
varying vec2 vQuad;
varying vec4 vTint;
varying float vT;
varying float vRow;
varying vec4 vP;
varying float vGlow;
varying float vSoft;
varying float vFogDepth;
${HEIGHT_GLSL}
vec2 frameUv(float f, vec2 uv) {
  f = mod(f, 16.0);
  vec2 cell = vec2(mod(f, 4.0), floor(f / 4.0));
  return (cell + uv) * 0.25;
}
void main() {
  float age = uTime - iA.w;
  float life = iB.w;
  float t = age / max(life, 1e-4);
  if (age < 0.0 || t >= 1.0 || life <= 0.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  float mode = iF.w;
  vec3 p;
  vec3 vel;
  if (mode > 3.5) {
    float r = max(0.0, iB.x + iC.x * age);
    float th = iB.y + iC.y * age;
    p = iA.xyz + vec3(cos(th) * r + iC.z * age, iB.z * age, sin(th) * r + iC.w * age);
    vel = vec3(-sin(th) * r * iC.y + cos(th) * iC.x + iC.z, iB.z, cos(th) * r * iC.y + sin(th) * iC.x + iC.w);
  } else {
    float k = max(iC.w, 0.02);
    float e = exp(-k * age);
    vec3 dv = iB.xyz - iC.xyz;
    p = iA.xyz + dv * ((1.0 - e) / k) + iC.xyz * age;
    vel = dv * e + iC.xyz;
  }
  float ease = 1.0 - (1.0 - t) * (1.0 - t);
  float size = mix(iD.x, iD.y, ease);
  float len = size * iH.z;
  vec2 corner = position.xy;
  float seed = fract(sin(float(gl_InstanceID) * 12.9898 + iA.w * 78.233) * 43758.5453);
  vec4 mv;
  vec2 q;
  if (mode > 2.5 && mode < 3.5) {
    float rot = iD.z + iD.w * age;
    float c = cos(rot), s = sin(rot);
    vec2 o = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * size;
    vec3 world = p + vec3(o.x, 0.0, o.y);
    mv = viewMatrix * vec4(world, 1.0);
    q = corner * 2.0;
    vSoft = 1.0;
  } else {
    vec2 axis;
    float anchor = 0.0;
    if (mode > 0.5 && mode < 1.5) {
      vec3 vv = (viewMatrix * vec4(vel, 0.0)).xyz;
      float sp = length(vv.xy);
      axis = sp > 1e-4 ? vv.xy / sp : vec2(0.0, 1.0);
      len = size * (iH.z + iG.w * sp);
      anchor = -0.35;
    } else if (mode > 1.5) {
      vec3 up = vec3(0.0, 1.0, 0.0) + uWind * iG.w
        + vec3(sin(uTime * 6.0 + seed * 40.0), 0.0, cos(uTime * 4.7 + seed * 31.0)) * 0.14;
      vec2 a = (viewMatrix * vec4(up, 0.0)).xy;
      float l = length(a);
      axis = l > 1e-3 ? a / l : vec2(0.0, 1.0);
      anchor = 0.42;
    } else {
      float rot = iD.z + iD.w * age;
      axis = vec2(-sin(rot), cos(rot));
    }
    vec2 side = vec2(axis.y, -axis.x);
    vec2 off = side * (corner.x * size) + axis * ((corner.y + anchor) * len);
    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 world = p + camRight * off.x + camUp * off.y;
    mv = viewMatrix * vec4(p, 1.0) + vec4(off, 0.0, 0.0);
    q = off / (0.5 * size);
    vSoft = iH.y > 0.0 ? (world.y - fxSurfaceAt(world.xz)) / max(iH.y * size, 0.03) : 1.0;
  }
  gl_Position = projectionMatrix * mv;
  vFogDepth = -mv.z;
  float nearFade = smoothstep(uNear, uNear + max(size, 0.5) * 2.0, -mv.z);
  float fc = max(iF.y, 1.0);
  vec2 luv = vec2(corner.x + 0.5, 0.5 - corner.y);
  float fpos = t * fc + (fc > 1.5 ? floor(seed * fc) : 0.0);
  float fa = floor(fpos);
  vMix = fc > 1.5 ? fract(fpos) : 0.0;
  vUvA = frameUv(iF.x + mod(fa, fc), luv);
  vUvB = frameUv(iF.x + mod(fa + 1.0, fc), luv);
  vQuad = q;
  vTint = iE;
  vTint.a *= nearFade;
  vT = t;
  vRow = (iF.z + 0.5) / 32.0;
  vP = vec4(iG.z, iG.y, iH.x, iG.x);
  vGlow = iH.w * pow(1.0 - t, 3.0);
  // pooled point lights (fires, explosions) light lit particles from nearby
  vec3 pl = vec3(0.0);
  if (iG.y > 0.0) {
    for (int k = 0; k < 6; k++) {
      vec3 d = p - uPL[k].xyz;
      float dd = dot(d, d);
      float r = uPL[k].w;
      float win = clamp(1.0 - dd / max(r * r, 1e-3), 0.0, 1.0);
      pl += uPLC[k] * (win * win / (1.0 + dd * 0.025));
    }
  }
  vPL = pl;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform sampler2D uRamp;
uniform vec3 uSunView;
uniform vec3 uSunCol;
uniform vec3 uAmbient;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
uniform float fogDensity;
varying vec2 vUvA;
varying vec2 vUvB;
varying float vMix;
varying vec2 vQuad;
varying vec4 vTint;
varying float vT;
varying float vRow;
varying vec4 vP;
varying float vGlow;
varying float vSoft;
varying float vFogDepth;
varying vec3 vPL;
void main() {
  vec4 tx = texture2D(uAtlas, vUvA);
  if (vMix > 0.0) tx = mix(tx, texture2D(uAtlas, vUvB), vMix);
  float rt = clamp(vT + vP.x * (1.0 - tx.r), 0.0, 1.0);
  vec4 rc = texture2D(uRamp, vec2(rt * (255.0 / 256.0) + 0.5 / 256.0, vRow));
  float a = tx.a * rc.a * vTint.a * clamp(vSoft, 0.0, 1.0);
  if (a < 0.003) discard;
  vec3 base = rc.rgb * vTint.rgb;
  vec3 col = base * vP.w;
  if (vP.y > 0.0) {
    float r2 = dot(vQuad, vQuad);
    vec3 n = normalize(vec3(vQuad * 0.85, sqrt(max(0.0, 1.0 - r2)) + 0.35));
    float ndl = dot(n, uSunView) * 0.5 + 0.5;
    vec3 light = (uAmbient + uSunCol * ndl * ndl) * mix(0.7, 1.2, tx.r) + vPL * mix(1.2, 0.7, ndl);
    col = mix(col, base * light, vP.y);
  }
  col += base * vGlow;
  float fog = 0.0;
#ifdef USE_FOG
#ifdef FOG_EXP2
  fog = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
#else
  fog = smoothstep(fogNear, fogFar, vFogDepth);
#endif
#endif
  col = mix(col, fogColor, fog * (1.0 - vP.z));
  a *= 1.0 - fog * vP.z;
  gl_FragColor = vec4(col, 1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * a, a * (1.0 - vP.z));
}
`;

// Scratch particle description reused by every emitter (avoids garbage).
export class ParticleSpec {
  constructor() {
    this.reset();
  }
  reset() {
    this.x = this.y = this.z = 0;
    this.vx = this.vy = this.vz = 0;
    this.tx = this.ty = this.tz = 0; // terminal velocity (or swirl params)
    this.tw = 0; // swirl: drift z
    this.drag = 1;
    this.life = 1;
    this.delay = 0;
    this.s0 = 1;
    this.s1 = 1;
    this.rot = 0;
    this.spin = 0;
    this.r = this.g = this.b = this.a = 1;
    this.frame = 0;
    this.frames = 1;
    this.ramp = 0;
    this.mode = 0;
    this.bright = 1;
    this.lit = 0;
    this.heat = 0;
    this.stretch = 0; // mode 1: length per unit speed; mode 2: wind lean
    this.add = 0;
    this.soft = 0.4;
    this.aspect = 1;
    this.glow = 0;
    return this;
  }
  color(c, a = 1) {
    // c: THREE.Color in linear space
    this.r = c.r;
    this.g = c.g;
    this.b = c.b;
    this.a = a;
    return this;
  }
}

export class ParticleLayer {
  constructor(fx, { capacity = 10000, renderOrder = 10, name = 'particles' } = {}) {
    this.fx = fx;
    this.capacity = capacity;
    this.death = new Float32Array(capacity); // CPU mirror of death time per slot
    this.cursor = 0;
    this.live = 0;
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    this.attrs = {};
    for (const k of ['iA', 'iB', 'iC', 'iD', 'iE', 'iF', 'iG', 'iH']) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(k, a);
      this.attrs[k] = a;
    }
    // death time far in the past for every slot => all dead
    this.death.fill(-1);
    const A = this.attrs.iB.array;
    for (let i = 0; i < capacity; i++) A[i * 4 + 3] = 0;
    geo.instanceCount = capacity;
    this.geo = geo;
    this.uniforms = {
      uTime: fx.uniforms.uTime,
      uWind: fx.uniforms.uWind,
      uNear: fx.uniforms.uNear,
      uPL: fx.uniforms.uPL,
      uPLC: fx.uniforms.uPLC,
      uAtlas: { value: fx.textures.atlas },
      uRamp: { value: fx.textures.ramp },
      uSunView: fx.uniforms.uSunView,
      uSunCol: fx.uniforms.uSunCol,
      uAmbient: fx.uniforms.uAmbient,
      ...fx.heightField.uniforms(),
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    };
    this.material = new THREE.ShaderMaterial({
      name,
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = name;
    this._dmin = Infinity;
    this._dmax = -1;
    this._ranges = [];
  }

  // Allocate a slot: prefer dead slots near the cursor, else steal the one
  // that dies soonest among those scanned.
  _alloc(now) {
    const cap = this.capacity;
    let best = -1,
      bestDeath = Infinity;
    for (let k = 0; k < 48; k++) {
      const i = this.cursor;
      this.cursor = this.cursor + 1 === cap ? 0 : this.cursor + 1;
      const d = this.death[i];
      if (d <= now) return i;
      if (d < bestDeath) {
        bestDeath = d;
        best = i;
      }
    }
    return best;
  }

  spawn(p, now) {
    const i = this._alloc(now);
    if (i < 0) return -1;
    const t0 = now + p.delay;
    const life = Math.max(0.02, p.life);
    this.death[i] = t0 + life;
    const o = i * 4;
    const a = this.attrs;
    let A = a.iA.array;
    A[o] = p.x;
    A[o + 1] = p.y;
    A[o + 2] = p.z;
    A[o + 3] = t0;
    A = a.iB.array;
    A[o] = p.vx;
    A[o + 1] = p.vy;
    A[o + 2] = p.vz;
    A[o + 3] = life;
    A = a.iC.array;
    A[o] = p.tx;
    A[o + 1] = p.ty;
    A[o + 2] = p.tz;
    A[o + 3] = p.mode === 4 ? p.tw : p.drag;
    A = a.iD.array;
    A[o] = p.s0;
    A[o + 1] = p.s1;
    A[o + 2] = p.rot;
    A[o + 3] = p.spin;
    A = a.iE.array;
    A[o] = p.r;
    A[o + 1] = p.g;
    A[o + 2] = p.b;
    A[o + 3] = p.a;
    A = a.iF.array;
    A[o] = p.frame;
    A[o + 1] = p.frames;
    A[o + 2] = p.ramp;
    A[o + 3] = p.mode;
    A = a.iG.array;
    A[o] = p.bright;
    A[o + 1] = p.lit;
    A[o + 2] = p.heat;
    A[o + 3] = p.stretch;
    A = a.iH.array;
    A[o] = p.add;
    A[o + 1] = p.soft;
    A[o + 2] = p.aspect;
    A[o + 3] = p.glow;
    this._mark(i);
    return i;
  }

  countLive(now) {
    let n = 0;
    const d = this.death;
    for (let i = 0; i < d.length; i++) if (d[i] > now) n++;
    this.live = n;
    return n;
  }

  clear() {
    this.death.fill(-1);
    const A = this.attrs.iB.array;
    for (let i = 0; i < this.capacity; i++) A[i * 4 + 3] = 0;
    for (const k in this.attrs) {
      this.attrs[k].clearUpdateRanges();
      this.attrs[k].needsUpdate = true;
    }
    this._ranges.length = 0;
    this._dmin = Infinity;
    this._dmax = -1;
  }

  // Track written slots as a few contiguous ranges (the cursor may wrap).
  _mark(i) {
    if (this._dmax < 0) {
      this._dmin = this._dmax = i;
    } else if (i >= this._dmin - 64 && i <= this._dmax + 64) {
      if (i < this._dmin) this._dmin = i;
      if (i > this._dmax) this._dmax = i;
    } else {
      this._ranges.push(this._dmin, this._dmax);
      this._dmin = this._dmax = i;
    }
  }

  // Upload the slots written this frame.
  flush() {
    if (this._dmax < 0) return;
    this._ranges.push(this._dmin, this._dmax);
    for (const k in this.attrs) {
      const at = this.attrs[k];
      at.clearUpdateRanges();
      for (let r = 0; r < this._ranges.length; r += 2) at.addUpdateRange(this._ranges[r] * 4, (this._ranges[r + 1] - this._ranges[r] + 1) * 4);
      at.needsUpdate = true;
    }
    this._ranges.length = 0;
    this._dmin = Infinity;
    this._dmax = -1;
  }
}
