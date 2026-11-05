import * as THREE from 'three';
import { mulberry32 } from './util.js';

// Forked lightning bolts drawn as camera-facing HDR ribbons (the bloom pass
// turns them into glowing filaments), with a strobing multi-stroke flash.
// Atmosphere turns the flash into scene light, sky / cloud flashes and
// thunder.

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
uniform vec3 uColor;
varying float vEdge;
varying float vGlow;
varying float vBright;
void main() {
  float e = abs(vEdge);
  float core = 1.0 - smoothstep(0.35, 1.0, e);
  float halo = pow(1.0 - e, 2.0);
  float a = mix(core * 3.0, halo * 0.22, vGlow) * vBright;
  if (a < 0.002) discard;
  vec3 c = mix(vec3(1.0), uColor, vGlow * 0.8 + 0.15);
  gl_FragColor = vec4(c * a, 1.0);
}
`;

const MAX_VERTS = 6000;

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
    this.mesh = new THREE.Mesh(
      g,
      new THREE.ShaderMaterial({
        name: 'Lightning',
        uniforms: { uColor: { value: new THREE.Color(0.55, 0.7, 1.0) } },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    this.atm.game.scene.add(this.mesh);
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._d = new THREE.Vector3();
  }

  // Create a bolt from the cloud base down to (x, groundY, z). Returns bolt.
  spawn(x, y, z, opts = {}) {
    const r = this.rnd;
    const top = opts.top ?? y + 46 + r() * 14;
    const drift = 6 + r() * 10;
    const a = r() * Math.PI * 2;
    const start = new THREE.Vector3(x + Math.cos(a) * drift, top, z + Math.sin(a) * drift);
    const end = new THREE.Vector3(x, y, z);
    const main = this.path(start, end, 7, 0.32);
    const branches = [];
    const nb = 2 + Math.floor(r() * 4);
    for (let i = 0; i < nb; i++) {
      const k = Math.floor(main.length * (0.12 + r() * 0.55));
      const p0 = main[k];
      const remain = p0.y - y;
      const len = remain * (0.25 + r() * 0.4);
      const ba = r() * Math.PI * 2;
      const p1 = new THREE.Vector3(p0.x + Math.cos(ba) * len * 0.7, p0.y - len, p0.z + Math.sin(ba) * len * 0.7);
      branches.push({ pts: this.path(p0.clone(), p1, 5, 0.4), w: 0.45 + r() * 0.2 });
    }
    const bolt = {
      main,
      branches,
      age: 0,
      life: 0.75 + r() * 0.3,
      // return strokes: times of re-brightening
      strokes: [0, 0.07 + r() * 0.05, 0.2 + r() * 0.15].slice(0, 2 + Math.floor(r() * 2)),
      x,
      z,
      y,
      intensity: opts.intensity ?? 1,
    };
    this.bolts.push(bolt);
    if (this.bolts.length > 4) this.bolts.shift();
    return bolt;
  }

  path(a, b, levels, rough) {
    let pts = [a, b];
    let amp = a.distanceTo(b) * rough;
    for (let l = 0; l < levels; l++) {
      const next = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i],
          q = pts[i + 1];
        const m = p.clone().lerp(q, 0.4 + this.rnd() * 0.2);
        m.x += (this.rnd() - 0.5) * amp;
        m.z += (this.rnd() - 0.5) * amp;
        m.y += (this.rnd() - 0.5) * amp * 0.25;
        next.push(m, q);
      }
      pts = next;
      amp *= 0.5;
    }
    return pts;
  }

  // Strobe curve of a bolt at its age.
  brightness(b) {
    let v = 0;
    for (const s of b.strokes) {
      const t = b.age - s;
      if (t >= 0) v = Math.max(v, Math.exp(-t * 14) * (s === 0 ? 1 : 0.8));
    }
    v *= 1 - THREE.MathUtils.smoothstep(b.age, b.life * 0.6, b.life);
    return v * b.intensity;
  }

  update(dt, camera, camDist) {
    let flash = 0;
    for (const b of this.bolts) b.age += dt;
    this.bolts = this.bolts.filter((b) => b.age < b.life);
    let vi = 0;
    const camPos = camera.position;
    const core = 0.1 + camDist * 0.0028;
    const write = (pts, w, bright) => {
      for (let i = 0; i < pts.length - 1 && vi + 8 <= MAX_VERTS; i++) {
        const p = pts[i],
          q = pts[i + 1];
        this._d.subVectors(q, p);
        this._v.subVectors(camPos, p).normalize();
        this._s.crossVectors(this._d, this._v).normalize();
        for (let layer = 0; layer < 2; layer++) {
          const ww = layer === 0 ? w : w * 7;
          const base = vi;
          const fade = 1 - (i / pts.length) * 0.15;
          for (let c = 0; c < 4; c++) {
            const P = c < 2 ? p : q;
            const sgn = c % 2 === 0 ? -1 : 1;
            this.pos[(base + c) * 3] = P.x + this._s.x * ww * sgn;
            this.pos[(base + c) * 3 + 1] = P.y + this._s.y * ww * sgn;
            this.pos[(base + c) * 3 + 2] = P.z + this._s.z * ww * sgn;
            this.edge[base + c] = sgn;
            this.glow[base + c] = layer;
            this.bright[base + c] = bright * fade;
          }
          vi += 4;
        }
      }
    };
    for (const b of this.bolts) {
      const br = this.brightness(b);
      flash = Math.max(flash, br);
      if (br < 0.01) continue;
      write(b.main, core, br);
      for (const br2 of b.branches) write(br2.pts, core * br2.w, br * 0.55);
    }
    this.geo.setDrawRange(0, (vi / 4) * 6);
    for (const k of ['position', 'aEdge', 'aGlow', 'aBright']) this.geo.attributes[k].needsUpdate = true;
    this.mesh.visible = vi > 0;
    return flash;
  }
}
