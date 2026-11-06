import * as THREE from 'three';
import { GeoBuilder, shade } from './geom.js';
import { PAL } from './archetypes.js';

// ---------------------------------------------------------------- banners
// Cloth geometry per culture with an aFlex attribute (0 at the pole, 1 at the
// free edge) that drives the wind wave in the vertex shader.
export function bannerGeometry(style) {
  let w = 0.36,
    h = 0.24,
    sx = 12,
    sy = 3;
  if (style === 'mire') {
    w = 0.14;
    h = 0.5;
    sx = 3;
    sy = 10;
  }
  const g = new THREE.PlaneGeometry(w, h, sx, sy);
  g.translate(w / 2, -h / 2, 0);
  const pos = g.attributes.position;
  const flex = new Float32Array(pos.count);
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i),
      y = pos.getY(i);
    const u = x / w,
      v = -y / h; // 0 top .. 1 bottom
    if (style === 'dune') {
      // tapering pennant
      const k = 1 - u * 0.88;
      y = -h / 2 + (y + h / 2) * k;
    } else if (style === 'frost') {
      // swallowtail notch
      if (u > 0.7) {
        const notch = (u - 0.7) / 0.3;
        const c = Math.abs(v - 0.5) * 2;
        if (c < notch) x -= (notch - c) * w * 0.28;
      }
    }
    pos.setXY(i, x, y);
    flex[i] = style === 'mire' ? Math.max(0, v) * 0.9 + u * 0.1 : u;
    // a darker trim band near the hoist and the edges
    const trim = u < 0.1 || v < 0.1 || v > 0.9 ? 0.62 : 1;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = trim;
  }
  g.setAttribute('aFlex', new THREE.BufferAttribute(flex, 1));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function bannerMaterial(uniforms) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.uniforms.uWind = uniforms.uWind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFlex;\nuniform float uTime;\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  vec4 ip = instanceMatrix[3];
  float ph = ip.x * 1.7 + ip.z * 1.3;
  float w = 0.35 + uWind * 0.9;
  float wave = sin(aFlex * 7.0 - uTime * (4.0 + uWind * 5.0) + ph) * 0.055 * aFlex * w
             + sin(aFlex * 13.0 - uTime * 9.0 + ph * 2.0) * 0.012 * aFlex;
  transformed.z += wave;
  transformed.y -= aFlex * aFlex * 0.06 * (1.0 - min(1.0, w));
}`,
      );
  };
  m.customProgramCacheKey = () => 'wsBanner';
  return m;
}

// ---------------------------------------------------------------- windmill sails
export function bladesGeometry(style) {
  const K = PAL[style] || PAL.vale;
  const g = new GeoBuilder(21, { ao: false });
  const cloth = style === 'dune' ? K.cloth : style === 'frost' ? 0xd9d2c0 : 0xf0e8d6;
  // hub (axis along +Z)
  g.push();
  g.rotateX(Math.PI / 2);
  g.cyl(0, -0.06, 0, 0.07, 0.14, 8, K.timber, {});
  g.pop();
  // four arms in the XY plane (the sail disc faces +Z)
  for (let i = 0; i < 4; i++) {
    g.push();
    g.rotateZ((i * Math.PI) / 2);
    g.box(0.5, -0.025, 0, 1.0, 0.05, 0.04, K.timber);
    g.box(0.6, 0.03, 0.022, 0.74, 0.2, 0.012, cloth, { tint: 0.12 });
    for (let k = 0; k < 5; k++) g.box(0.27 + k * 0.17, -0.01, 0.032, 0.016, 0.25, 0.012, K.timber2);
    g.box(0.6, 0.225, 0.032, 0.74, 0.014, 0.012, K.timber2);
    g.pop();
  }
  return g.build();
}

// ---------------------------------------------------------------- boats
export function boatGeometry(style) {
  const K = PAL[style] || PAL.vale;
  const g = new GeoBuilder(33, { ao: false });
  const L = style === 'mire' ? 1.0 : style === 'frost' ? 1.05 : 0.9;
  const W = style === 'mire' ? 0.2 : 0.32;
  const H = style === 'mire' ? 0.1 : 0.14;
  const hull = style === 'dune' ? 0xa0784a : style === 'frost' ? 0x5c4230 : style === 'mire' ? 0x6e4a2c : 0x8a5e38;
  const ctr = [0, H * 0.5, 0];
  const B = [L / 2, H + 0.05, 0],
    Bl = [L / 2 - 0.07, 0.0, 0];
  const S = (s) => [L * 0.15, H, (s * W) / 2],
    s0 = (s) => [L * 0.15, 0, s * W * 0.3];
  const A = (s) => [-L * 0.3, H, (s * W) / 2],
    a0 = (s) => [-L * 0.3, 0, s * W * 0.3];
  const T = (s) => [-L / 2, H + (style === 'frost' ? 0.05 : 0.02), s * W * (style === 'frost' ? 0.05 : 0.36)],
    t0 = (s) => [-L / 2 + 0.05, 0.02, s * W * (style === 'frost' ? 0.04 : 0.22)];
  for (const s of [-1, 1]) {
    g.tri(B, S(s), s0(s), hull, 0, 0, ctr);
    g.tri(B, s0(s), Bl, hull, 0, 0, ctr);
    g.quad(S(s), A(s), a0(s), s0(s), shade(hull, 1.05), 0, 0, ctr);
    g.quad(A(s), T(s), t0(s), a0(s), hull, 0, 0, ctr);
  }
  g.quad(s0(1), s0(-1), a0(-1), a0(1), shade(hull, 0.7), 0, 0, ctr);
  g.tri(Bl, s0(1), s0(-1), shade(hull, 0.7), 0, 0, ctr);
  g.quad(a0(1), a0(-1), t0(-1), t0(1), shade(hull, 0.7), 0, 0, ctr);
  g.quad(T(1), T(-1), t0(-1), t0(1), shade(hull, 0.9), 0, 0, ctr);
  // deck (inside)
  const deck = 0x3a2a1c;
  const up = [0, -5, 0];
  g.tri(B, S(1), S(-1), deck, 0, 0, up);
  g.quad(S(1), A(1), A(-1), S(-1), deck, 0, 0, up);
  g.quad(A(1), T(1), T(-1), A(-1), deck, 0, 0, up);
  g.box(0.0, H - 0.04, 0, 0.06, 0.03, W * 0.9, K.plank);
  g.box(-L * 0.25, H - 0.04, 0, 0.06, 0.03, W * 0.85, K.plank);
  if (style === 'dune') {
    g.box(0.05, H, 0, 0.03, 0.75, 0.03, K.timber);
    g.beam(-0.35, H + 0.15, 0, 0.42, H + 0.95, 0, 0.02, K.timber);
    g.tri([-0.33, H + 0.16, 0.005], [0.4, H + 0.93, 0.005], [0.36, H + 0.2, 0.005], K.cloth, 0.8, 0, [0, H + 0.4, -1]);
    g.tri([-0.33, H + 0.16, -0.005], [0.4, H + 0.93, -0.005], [0.36, H + 0.2, -0.005], K.cloth, 0.8, 0, [0, H + 0.4, 1]);
  } else if (style === 'frost') {
    g.box(0, H, 0, 0.035, 0.8, 0.035, K.timber);
    g.box(0, H + 0.55, 0.0, 0.025, 0.4, 0.04, K.cloth, { tint: 0.7 });
    g.box(0.0, H + 0.74, 0, 0.03, 0.03, 0.5, K.timber);
    g.box(0.0, H + 0.36, 0, 0.012, 0.38, 0.46, K.cloth, { tint: 0.55 });
    for (let i = 0; i < 4; i++)
      for (const s of [-1, 1]) {
        g.push();
        g.translate(-0.3 + i * 0.18, H - 0.02, (s * W) / 2 + s * 0.01);
        g.rotateX(Math.PI / 2);
        g.cyl(0, -0.01, 0, 0.055, 0.02, 8, i % 2 ? K.cloth : K.trim, { tint: i % 2 ? 1 : 0 });
        g.pop();
      }
    g.beam(L / 2 - 0.02, H + 0.05, 0, L / 2 + 0.05, H + 0.25, 0, 0.035, K.timber, { tint: 0.4 });
  } else if (style === 'vale') {
    g.beam(-0.1, H + 0.02, -W * 0.5, -0.25, H - 0.08, -W * 1.2, 0.02, K.timber2);
    g.beam(-0.1, H + 0.02, W * 0.5, -0.25, H - 0.08, W * 1.2, 0.02, K.timber2);
    g.box(-0.32, H - 0.03, 0, 0.12, 0.05, 0.1, 0x8a7a5a);
  } else {
    g.box(-0.1, H - 0.04, 0, 0.18, 0.06, 0.12, 0x8a7a4a);
    g.beam(0.2, H, 0.05, -0.2, H + 0.12, 0.25, 0.018, K.timber2);
  }
  return g.build();
}

// ---------------------------------------------------------------- fences
export const FENCE = {
  vale: { post: [0.05, 0.3, 0.05], rails: [0.12, 0.23], rail: [0.035, 0.035], color: 0x8a6440, wall: false },
  mire: { post: [0.04, 0.34, 0.04], rails: [0.1, 0.2, 0.3], rail: [0.025, 0.025], color: 0xb89a5a, wall: false },
  dune: { post: [0.12, 0.2, 0.12], rails: [], rail: [0.08, 0.16], color: 0xd9b37c, wall: true },
  frost: { post: [0.13, 0.2, 0.13], rails: [], rail: [0.12, 0.17], color: 0x8a8d90, wall: true },
};

export function scarecrowGeometry(style) {
  const K = PAL[style] || PAL.vale;
  const g = new GeoBuilder(55);
  g.box(0, -0.1, 0, 0.04, 0.68, 0.04, K.timber);
  g.box(0, 0.38, 0, 0.42, 0.035, 0.035, K.timber);
  g.box(0, 0.26, 0, 0.18, 0.22, 0.1, style === 'frost' ? 0x5a6a8a : 0x8a5a3a);
  g.box(-0.16, 0.34, 0, 0.12, 0.08, 0.06, 0x9a7a4a);
  g.box(0.16, 0.34, 0, 0.12, 0.08, 0.06, 0x9a7a4a);
  g.bead(0, 0.5, 0, 0.065, 0xd9c48a);
  g.cone(0, 0.6, 0, 0.13, 0.12, 8, style === 'mire' ? K.thatch : 0x6e5a3a);
  return g.build();
}

// ---------------------------------------------------------------- glow decal
let _glowTex = null;
export function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,210,140,1)');
  gr.addColorStop(0.35, 'rgba(255,160,70,0.45)');
  gr.addColorStop(1, 'rgba(255,120,40,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 64, 64);
  _glowTex = new THREE.CanvasTexture(c);
  _glowTex.colorSpace = THREE.SRGBColorSpace;
  return _glowTex;
}

// ---------------------------------------------------------------- fallback smoke
// Used only when the Effects module has no real particle system yet: stylised
// low-poly puffs drifting with the wind.
export class PuffSystem {
  constructor(scene, max = 360) {
    this.max = max;
    const geo = new THREE.IcosahedronGeometry(0.16, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, transparent: true, opacity: 0.85, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.p = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._c = new THREE.Color();
  }
  emit(x, y, z, kind = 'smoke', scale = 1) {
    if (this.p.length >= this.max) this.p.shift();
    const fire = kind === 'fire';
    this.p.push({
      x: x + (Math.random() - 0.5) * 0.08,
      y,
      z: z + (Math.random() - 0.5) * 0.08,
      vy: fire ? 0.9 : 0.32 + Math.random() * 0.12,
      age: 0,
      life: fire ? 0.7 + Math.random() * 0.4 : 3.2 + Math.random() * 1.6,
      s: scale * (fire ? 0.9 : 0.55 + Math.random() * 0.3),
      rot: Math.random() * 6,
      kind,
      dark: kind === 'soot' ? 1 : 0,
    });
  }
  update(dt, wind) {
    const live = [];
    for (const q of this.p) {
      q.age += dt;
      if (q.age >= q.life) continue;
      const t = q.age / q.life;
      q.y += q.vy * dt * (1 - t * 0.5);
      q.x += wind.x * wind.strength * dt * (0.4 + t * 1.2);
      q.z += wind.z * wind.strength * dt * (0.4 + t * 1.2);
      live.push(q);
    }
    this.p = live;
    const n = Math.min(this.max, live.length);
    for (let i = 0; i < n; i++) {
      const q = live[i];
      const t = q.age / q.life;
      let s;
      if (q.kind === 'fire') {
        s = q.s * (1 - t) * 0.9;
        this._c.setRGB(1.6, 0.55 + (1 - t) * 0.5, 0.12);
      } else {
        s = q.s * (0.35 + t * 1.4) * (t > 0.75 ? (1 - t) * 4 : 1);
        const g = q.dark ? 0.18 + t * 0.25 : 0.82 - t * 0.12;
        this._c.setRGB(g, g * 0.98, g * 0.96);
      }
      this._q.setFromAxisAngle(this._v.set(0, 1, 0), q.rot + t);
      this._m.compose(this._v.set(q.x, q.y, q.z), this._q, this._s.set(s, s, s));
      this.mesh.setMatrixAt(i, this._m);
      this.mesh.setColorAt(i, this._c);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  clear() {
    this.p.length = 0;
    this.mesh.count = 0;
  }
}
