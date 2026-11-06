import * as THREE from 'three';
import { mulberry32 } from './util.js';

// Forked lightning: sharp, angular channels (midpoint displacement with
// straight segments) drawn as camera-facing HDR ribbons with a tapered
// white-hot core and a wide blue-violet halo. Each return stroke of the
// strobe re-forks the branches and re-jitters the channel. Impacts get a
// starburst and an expanding ground ring; Atmosphere turns the brightness
// into the world flash (scene light, sky, clouds, grade) and thunder.

const VERT = /* glsl */ `
attribute float aEdge;   // -1..1 across the ribbon
attribute float aGlow;   // 0 = core, 1 = halo
attribute float aBright; // per-vertex intensity
varying float vEdge;
varying float vGlow;
varying float vBright;
void main() {
  vEdge = aEdge;
  vGlow = aGlow;
  vBright = aBright;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;
const FRAG = /* glsl */ `
uniform vec3 uHalo;
varying float vEdge;
varying float vGlow;
varying float vBright;
void main() {
  float e = abs(vEdge);
  vec3 c;
  if (vGlow < 0.5) {
    float core = 1.0 - smoothstep(0.25, 1.0, e);
    c = vec3(0.92, 0.95, 1.0) * core * 6.0;
  } else {
    float halo = pow(1.0 - e, 2.2);
    c = uHalo * halo * 0.55;
  }
  c *= vBright;
  if (max(c.r, max(c.g, c.b)) < 0.002) discard;
  gl_FragColor = vec4(c, 1.0);
}
`;

// impact starburst (camera-facing) and ground ring (flat), one instance each
// per live bolt
const IMPACT_VERT = /* glsl */ `
attribute vec4 aImp;  // xyz position, w size
attribute vec2 aVal;  // x brightness, y age 0..1
uniform float uFlat;  // 0 billboard, 1 ground plane
varying vec2 vUv;
varying vec2 vVal;
void main() {
  vUv = position.xy;
  vVal = aVal;
  vec3 wp;
  if (uFlat > 0.5) {
    float grow = 0.25 + 1.6 * sqrt(aVal.y);
    wp = aImp.xyz + vec3(position.x, 0.0, position.y) * aImp.w * grow;
  } else {
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    wp = aImp.xyz + (right * position.x + up * position.y) * aImp.w;
  }
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  if (aVal.x < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;
const IMPACT_FRAG = /* glsl */ `
uniform float uFlat;
uniform vec3 uHalo;
varying vec2 vUv;
varying vec2 vVal;
void main() {
  float r = length(vUv);
  vec3 c;
  if (uFlat > 0.5) {
    float ring = smoothstep(0.7, 0.9, r) * (1.0 - smoothstep(0.9, 1.0, r));
    float scorch = (1.0 - smoothstep(0.0, 0.5, r)) * 0.5;
    c = mix(uHalo, vec3(1.0), 0.45) * (ring * 2.2 + scorch) * (1.0 - vVal.y);
  } else {
    float a = atan(vUv.y, vUv.x);
    float rays = pow(abs(cos(a * 3.0)), 60.0) + pow(abs(cos(a * 3.0 + 0.52)), 90.0) * 0.6 + pow(abs(cos(a * 7.0 + 1.1)), 120.0) * 0.4;
    float core = exp(-r * r * 30.0) * 3.0 + exp(-r * 5.0) * 0.6;
    c = (vec3(1.0, 1.0, 1.05) * core + mix(uHalo, vec3(1.0), 0.5) * rays * exp(-r * 3.2) * 2.2) * (1.0 - smoothstep(0.85, 1.0, r));
  }
  c *= vVal.x;
  if (max(c.r, max(c.g, c.b)) < 0.002) discard;
  gl_FragColor = vec4(c, 1.0);
}
`;

const MAX_VERTS = 8000;
const MAX_IMPACTS = 4;

export class Lightning {
  constructor(atmosphere) {
    this.atm = atmosphere;
    this.game = atmosphere.game;
    this.bolts = [];
    this.rnd = mulberry32(1234);
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX_VERTS * 3);
    this.edge = new Float32Array(MAX_VERTS);
    this.glow = new Float32Array(MAX_VERTS);
    this.bright = new Float32Array(MAX_VERTS);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aEdge', new THREE.BufferAttribute(this.edge, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aGlow', new THREE.BufferAttribute(this.glow, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aBright', new THREE.BufferAttribute(this.bright, 1).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint32Array((MAX_VERTS / 4) * 6);
    for (let q = 0, i = 0; q < MAX_VERTS / 4; q++) {
      const v = q * 4;
      idx[i++] = v;
      idx[i++] = v + 2;
      idx[i++] = v + 1;
      idx[i++] = v + 2;
      idx[i++] = v + 3;
      idx[i++] = v + 1;
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.geo = g;
    this.halo = new THREE.Color(0.48, 0.42, 1.0);
    const add = { transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ name: 'Lightning', uniforms: { uHalo: { value: this.halo } }, vertexShader: VERT, fragmentShader: FRAG, ...add }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    const scene = this.game.scene;
    scene.add(this.mesh);

    // impacts
    const ig = new THREE.InstancedBufferGeometry();
    ig.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
    ig.setIndex([0, 1, 2, 2, 1, 3]);
    this.impArr = new Float32Array(MAX_IMPACTS * 4);
    this.valArr = new Float32Array(MAX_IMPACTS * 2);
    this.aImp = new THREE.InstancedBufferAttribute(this.impArr, 4).setUsage(THREE.DynamicDrawUsage);
    this.aVal = new THREE.InstancedBufferAttribute(this.valArr, 2).setUsage(THREE.DynamicDrawUsage);
    ig.setAttribute('aImp', this.aImp);
    ig.setAttribute('aVal', this.aVal);
    ig.instanceCount = MAX_IMPACTS;
    const mk = (flat, order) => {
      const m = new THREE.Mesh(
        ig,
        new THREE.ShaderMaterial({
          uniforms: { uFlat: { value: flat }, uHalo: { value: this.halo } },
          vertexShader: IMPACT_VERT,
          fragmentShader: IMPACT_FRAG,
          ...add,
          depthTest: !!flat,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
        }),
      );
      m.frustumCulled = false;
      m.renderOrder = order;
      m.visible = false;
      scene.add(m);
      return m;
    };
    this.ring = mk(1, 29);
    this.star = mk(0, 31);
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._d = new THREE.Vector3();
  }

  // Create a bolt from opts.top down to (x, y, z). Returns the bolt.
  spawn(x, y, z, opts = {}) {
    const r = this.rnd;
    const top = opts.top ?? y + 60;
    const drift = (top - y) * (0.12 + r() * 0.18);
    const a = r() * Math.PI * 2;
    const bolt = {
      start: new THREE.Vector3(x + Math.cos(a) * drift, top, z + Math.sin(a) * drift),
      end: new THREE.Vector3(x, y, z),
      main: null,
      branches: [],
      age: 0,
      life: 0.8 + r() * 0.35,
      strokes: [0, 0.07 + r() * 0.06, 0.19 + r() * 0.12, 0.36 + r() * 0.1].slice(0, 2 + Math.floor(r() * 3)),
      stroke: -1,
      x,
      y,
      z,
      intensity: opts.intensity ?? 1,
      newStroke: false,
    };
    this.refork(bolt, true);
    this.bolts.push(bolt);
    if (this.bolts.length > MAX_IMPACTS) this.bolts.shift();
    return bolt;
  }

  // (Re)generate the channel and its branches for a new return stroke.
  refork(b, fresh) {
    const r = this.rnd;
    if (fresh || !b.main) b.main = this.path(b.start, b.end, 5, 0.42);
    else {
      // same leader, re-jittered a little
      for (let i = 1; i < b.main.length - 1; i++) {
        const p = b.main[i];
        const s = b.start.distanceTo(b.end) * 0.012;
        p.x += (r() - 0.5) * s;
        p.z += (r() - 0.5) * s;
      }
    }
    b.branches = [];
    const nb = 3 + Math.floor(r() * 4);
    for (let i = 0; i < nb; i++) {
      const k = Math.floor(b.main.length * (0.08 + r() * 0.6));
      const p0 = b.main[k];
      const remain = Math.max(4, p0.y - b.y);
      const len = remain * (0.22 + r() * 0.42);
      const ba = r() * Math.PI * 2;
      const p1 = new THREE.Vector3(p0.x + Math.cos(ba) * len * 0.75, p0.y - len * (0.6 + r() * 0.4), p0.z + Math.sin(ba) * len * 0.75);
      const pts = this.path(p0.clone(), p1, 4, 0.5);
      b.branches.push({ pts, w: 0.35 + r() * 0.25 });
      // occasional sub-branch
      if (r() < 0.45) {
        const q0 = pts[Math.floor(pts.length * (0.3 + r() * 0.4))];
        const l2 = len * (0.3 + r() * 0.3);
        const a2 = ba + (r() - 0.5) * 1.6;
        const q1 = new THREE.Vector3(q0.x + Math.cos(a2) * l2 * 0.8, q0.y - l2 * 0.7, q0.z + Math.sin(a2) * l2 * 0.8);
        b.branches.push({ pts: this.path(q0.clone(), q1, 3, 0.55), w: 0.2 + r() * 0.12 });
      }
    }
  }

  // Midpoint displacement with straight segments: crisp, angular kinks.
  path(a, b, levels, rough) {
    let pts = [a, b];
    let amp = a.distanceTo(b) * rough;
    for (let l = 0; l < levels; l++) {
      const next = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i],
          q = pts[i + 1];
        const m = p.clone().lerp(q, 0.35 + this.rnd() * 0.3);
        m.x += (this.rnd() - 0.5) * amp;
        m.z += (this.rnd() - 0.5) * amp;
        m.y += (this.rnd() - 0.5) * amp * 0.3;
        next.push(m, q);
      }
      pts = next;
      amp *= 0.56;
    }
    return pts;
  }

  // Strobe curve of a bolt at its age.
  brightness(b) {
    let v = 0;
    for (const s of b.strokes) {
      const t = b.age - s;
      if (t >= 0) v = Math.max(v, Math.exp(-t * 9) * (s === 0 ? 1 : 0.85));
    }
    v *= 1 - THREE.MathUtils.smoothstep(b.age, b.life * 0.55, b.life);
    return v * b.intensity;
  }

  // Returns the strongest flash this frame and how many new strokes fired.
  update(dt, camera, camDist) {
    let flash = 0;
    let strokes = 0;
    for (const b of this.bolts) {
      b.age += dt;
      let s = -1;
      for (let i = 0; i < b.strokes.length; i++) if (b.age >= b.strokes[i]) s = i;
      if (s !== b.stroke) {
        if (b.stroke >= 0) this.refork(b, false);
        b.stroke = s;
        strokes++;
      }
    }
    this.bolts = this.bolts.filter((b) => b.age < b.life);
    let vi = 0;
    const camPos = camera.position;
    const core = 0.05 + camDist * 0.0022;
    const write = (pts, w0, w1, bright) => {
      const n = pts.length;
      for (let i = 0; i < n - 1 && vi + 8 <= MAX_VERTS; i++) {
        const p = pts[i],
          q = pts[i + 1];
        this._d.subVectors(q, p);
        this._v.subVectors(camPos, p).normalize();
        this._s.crossVectors(this._d, this._v).normalize();
        const wa = w0 + (w1 - w0) * (i / (n - 1));
        const wb = w0 + (w1 - w0) * ((i + 1) / (n - 1));
        for (let layer = 0; layer < 2; layer++) {
          const k = layer === 0 ? 1 : 9;
          const base = vi;
          for (let c = 0; c < 4; c++) {
            const P = c < 2 ? p : q;
            const ww = (c < 2 ? wa : wb) * k;
            const sgn = c % 2 === 0 ? -1 : 1;
            this.pos[(base + c) * 3] = P.x + this._s.x * ww * sgn;
            this.pos[(base + c) * 3 + 1] = P.y + this._s.y * ww * sgn;
            this.pos[(base + c) * 3 + 2] = P.z + this._s.z * ww * sgn;
            this.edge[base + c] = sgn;
            this.glow[base + c] = layer;
            this.bright[base + c] = bright;
          }
          vi += 4;
        }
      }
    };
    let ii = 0;
    for (const b of this.bolts) {
      const br = this.brightness(b);
      flash = Math.max(flash, br);
      if (br >= 0.01) {
        write(b.main, core * 1.15, core * 0.7, br);
        for (const br2 of b.branches) write(br2.pts, core * br2.w * 1.3, core * br2.w * 0.25, br * 0.6);
      }
      if (ii < MAX_IMPACTS) {
        const life = Math.min(1, b.age / b.life);
        this.impArr[ii * 4] = b.x;
        this.impArr[ii * 4 + 1] = b.y + 0.15;
        this.impArr[ii * 4 + 2] = b.z;
        this.impArr[ii * 4 + 3] = 1.6 + camDist * 0.05;
        this.valArr[ii * 2] = Math.max(br, 0.5 * (1 - life));
        this.valArr[ii * 2 + 1] = life;
        ii++;
      }
    }
    for (; ii < MAX_IMPACTS; ii++) this.valArr[ii * 2] = 0;
    this.aImp.needsUpdate = true;
    this.aVal.needsUpdate = true;
    this.geo.setDrawRange(0, (vi / 4) * 6);
    for (const k of ['position', 'aEdge', 'aGlow', 'aBright']) this.geo.attributes[k].needsUpdate = true;
    this.mesh.visible = vi > 0;
    this.ring.visible = this.star.visible = this.bolts.length > 0;
    return { flash, strokes };
  }
}
