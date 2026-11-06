import * as THREE from 'three';

// Camera-facing ribbon segments for lightning bolts, divine beams and other
// energy arcs. One instanced draw; each instance is a segment with its own
// colour, width, lifetime and flicker pattern. Additive.

const VERT = /* glsl */ `
uniform float uTime;
attribute vec4 bA; // start xyz, t0
attribute vec4 bB; // end xyz, life
attribute vec4 bC; // colour rgb, width
attribute vec4 bD; // seed, flicker amount, intensity, taper (end width factor)
varying vec2 vUv;
varying vec3 vCol;
varying float vI;
void main() {
  float age = uTime - bA.w;
  float t = age / max(bB.w, 1e-3);
  if (age < 0.0 || t >= 1.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  vec3 s = bA.xyz, e = bB.xyz;
  vec3 dir = e - s;
  float L = max(length(dir), 1e-4);
  vec3 d = dir / L;
  float along = position.y + 0.5;
  float w = bC.w * mix(1.0, bD.w, along);
  // extend both ends by half a width so consecutive segments overlap
  vec3 P = s + d * (along * (L + w) - 0.5 * w);
  vec3 toCam = normalize(cameraPosition - P);
  vec3 side = cross(d, toCam);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
  P += side * position.x * w;
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
  vUv = vec2(position.x * 2.0, along);
  // flicker: first frames always bright, then stepped random pulses
  float seed = bD.x;
  float pulse = step(0.42, fract(sin(floor(age * 24.0) * 91.31 + seed * 17.0) * 437.58));
  float fl = age < 0.06 ? 1.0 : mix(1.0, 0.18 + 0.82 * pulse, bD.y);
  float fade = 1.0 - smoothstep(0.55, 1.0, t);
  float fin = smoothstep(0.0, 0.03, age) ;
  vI = bD.z * fl * fade * max(fin, 0.6);
  vCol = bC.rgb;
}
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
varying float vI;
void main() {
  float d = abs(vUv.x);
  float core = exp(-d * d * 28.0);
  float glow = exp(-d * d * 4.0) * 0.45;
  float endFade = smoothstep(0.0, 0.04, vUv.y) * smoothstep(1.0, 0.96, vUv.y) * 0.5 + 0.5;
  vec3 c = (vCol * glow + mix(vCol, vec3(1.0), 0.75) * core) * vI * endFade;
  c = 1.0 - exp(-c * 1.6);
  if (max(c.r, max(c.g, c.b)) < 0.002) discard;
  gl_FragColor = vec4(c, 1.0);
#include <colorspace_fragment>
}
`;

export class Beams {
  constructor(fx, capacity = 1200) {
    this.fx = fx;
    this.capacity = capacity;
    this.death = new Float32Array(capacity).fill(-1);
    this.cursor = 0;
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    this.attrs = {};
    for (const k of ['bA', 'bB', 'bC', 'bD']) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(k, a);
      this.attrs[k] = a;
    }
    geo.instanceCount = capacity;
    // mark all dead
    for (let i = 0; i < capacity; i++) this.attrs.bB.array[i * 4 + 3] = 0;
    this.material = new THREE.ShaderMaterial({
      name: 'fx-beams',
      uniforms: { uTime: fx.uniforms.uTime },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 14;
    this._c = new THREE.Color();
    this._lo = Infinity;
    this._hi = -1;
  }

  segment(x0, y0, z0, x1, y1, z1, o) {
    const now = this.fx.time;
    let i = this.cursor;
    for (let k = 0; k < 32; k++) {
      const j = (this.cursor + k) % this.capacity;
      if (this.death[j] <= now) {
        i = j;
        break;
      }
    }
    this.cursor = (i + 1) % this.capacity;
    const t0 = now + (o.delay || 0);
    this.death[i] = t0 + o.life;
    const c = o.color;
    const w = (k, a, b, cc, d) => {
      const A = this.attrs[k].array;
      const p = i * 4;
      A[p] = a;
      A[p + 1] = b;
      A[p + 2] = cc;
      A[p + 3] = d;
    };
    w('bA', x0, y0, z0, t0);
    w('bB', x1, y1, z1, o.life);
    w('bC', c.r, c.g, c.b, o.width);
    w('bD', o.seed ?? Math.random(), o.flicker ?? 1, o.intensity ?? 1, o.taper ?? 1);
    if (i < this._lo) this._lo = i;
    if (i > this._hi) this._hi = i;
  }

  // Jagged branching lightning from (x0,y0,z0) down to (x1,y1,z1).
  bolt(x0, y0, z0, x1, y1, z1, opts = {}) {
    const color = this._c.setHex(opts.color ?? 0xbcd8ff).clone();
    const life = opts.life ?? 0.5;
    const width = opts.width ?? 0.35;
    const seed = Math.random();
    const delay = opts.delay ?? 0;
    const pts = [[x0, y0, z0], [x1, y1, z1]];
    const subdivide = (pts, rough, depth) => {
      for (let d = 0; d < depth; d++) {
        const out = [pts[0]];
        for (let k = 0; k < pts.length - 1; k++) {
          const a = pts[k],
            b = pts[k + 1];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
          const off = len * rough;
          out.push([(a[0] + b[0]) / 2 + (Math.random() - 0.5) * off, (a[1] + b[1]) / 2 + (Math.random() - 0.5) * off * 0.35, (a[2] + b[2]) / 2 + (Math.random() - 0.5) * off]);
          out.push(b);
        }
        pts = out;
      }
      return pts;
    };
    const main = subdivide(pts, 0.42, opts.detail ?? 6);
    const emit = (line, wd, inten, taper) => {
      const n = line.length - 1;
      for (let k = 0; k < n; k++) {
        const a = line[k],
          b = line[k + 1];
        const f0 = 1 - (k / n) * (1 - taper),
          f1 = 1 - ((k + 1) / n) * (1 - taper);
        const ww = wd * (f0 + f1) * 0.5;
        this.segment(a[0], a[1], a[2], b[0], b[1], b[2], { color, life, width: ww, intensity: inten, seed, flicker: opts.flicker ?? 1, delay });
        this.segment(a[0], a[1], a[2], b[0], b[1], b[2], { color, life: life * 1.1, width: ww * 6, intensity: inten * 0.22, seed, flicker: opts.flicker ?? 1, delay });
      }
    };
    emit(main, width, opts.intensity ?? 2.2, 0.7);
    const nb = opts.branches ?? 4;
    for (let b = 0; b < nb; b++) {
      const k = 2 + Math.floor(Math.random() * (main.length * 0.7));
      const s = main[Math.min(k, main.length - 2)];
      const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0) * (0.15 + Math.random() * 0.25);
      const ang = Math.random() * Math.PI * 2;
      const e = [s[0] + Math.cos(ang) * len * 0.6, s[1] - len * (0.5 + Math.random() * 0.4), s[2] + Math.sin(ang) * len * 0.6];
      if (e[1] < y1) e[1] = y1 + 0.5;
      const br = subdivide([s, e], 0.5, 4);
      emit(br, width * 0.45, (opts.intensity ?? 2.2) * 0.55, 0.2);
    }
    return main;
  }

  clear() {
    this.death.fill(-1);
    for (let i = 0; i < this.capacity; i++) this.attrs.bB.array[i * 4 + 3] = 0;
    for (const k in this.attrs) this.attrs[k].needsUpdate = true;
  }

  update() {
    if (this._hi < 0) return;
    for (const k in this.attrs) {
      const at = this.attrs[k];
      at.clearUpdateRanges();
      at.addUpdateRange(this._lo * 4, (this._hi - this._lo + 1) * 4);
      at.needsUpdate = true;
    }
    this._lo = Infinity;
    this._hi = -1;
  }
}
