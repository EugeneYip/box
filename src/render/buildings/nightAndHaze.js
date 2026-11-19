import * as THREE from 'three';
import { BUILDING } from '../../core/scale.js';

// Two cheap batched layers over the towns, one draw call each:
//  GlowSprites — soft points of light at street lights and floodlights, so a
//                powered town glows at night out to mid zoom (the lamp models
//                and ground pools stop at prop range).
//  HazeLayer   — factory haze (civ.haze()): a few wide, soft, translucent
//                grey-beige puffs low over each working factory and power
//                station, never over water, fading as it clears (fusion).
// Both are camera-facing quads expanded in the vertex shader from an
// InstancedMesh; no per-light or per-puff objects.

const VERT = `
attribute float aAlpha;
attribute float aSeed;
uniform float uTime;
uniform float uDrift;
varying vec2 vUv;
varying float vA;
varying float vSeed;
void main() {
  vUv = uv;
  vA = aAlpha;
  vSeed = aSeed;
  vec3 c = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float s = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
  c.x += sin(uTime * 0.07 + aSeed * 6.28) * uDrift * s;
  c.z += cos(uTime * 0.05 + aSeed * 4.1) * uDrift * s;
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  mv.xy += position.xy * s;
  gl_Position = projectionMatrix * mv;
}`;

function sprites(cap, frag, uniforms, blending) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, transparent: true, depthWrite: false, blending });
  const mesh = new THREE.InstancedMesh(geo, mat, cap);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  const a = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
  const sd = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
  a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aAlpha', a);
  geo.setAttribute('aSeed', sd);
  return mesh;
}
function grow(holder, key, n, make) {
  const m = holder[key];
  if (m.instanceMatrix.count >= n) return m;
  const nm = make(Math.ceil(n * 1.5));
  nm.renderOrder = m.renderOrder;
  m.parent?.add(nm);
  m.parent?.remove(m);
  m.geometry.dispose();
  holder[key] = nm;
  return nm;
}

const _m = new THREE.Matrix4();

export class GlowSprites {
  constructor(parent) {
    this.uniforms = { uTime: { value: 0 }, uDrift: { value: 0 }, uNight: { value: 0 } };
    this.frag = `
uniform float uNight;
varying vec2 vUv;
varying float vA;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - d), 2.2);
  gl_FragColor = vec4(vec3(1.0, 0.82, 0.55) * a * vA * uNight * 1.1, 1.0);
}`;
    this.mesh = this._make(64);
    this.mesh.renderOrder = 5;
    parent.add(this.mesh);
  }
  _make(cap) {
    return sprites(cap, this.frag, this.uniforms, THREE.AdditiveBlending);
  }
  // flat list: x, y, z, size (in units of BUILDING scale), ...
  set(L) {
    const n = L.length / 4;
    const m = grow(this, 'mesh', n, (c) => this._make(c));
    const al = m.geometry.getAttribute('aAlpha');
    for (let i = 0; i < n; i++) {
      const s = L[i * 4 + 3] * BUILDING.scale;
      _m.makeScale(s, s, s).setPosition(L[i * 4], L[i * 4 + 1], L[i * 4 + 2]);
      m.setMatrixAt(i, _m);
      al.array[i] = 0.75;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    al.needsUpdate = true;
  }
  update(night, show) {
    this.uniforms.uNight.value = night;
    this.mesh.visible = show && night > 0.02 && this.mesh.count > 0;
  }
}

export class HazeLayer {
  constructor(parent) {
    this.uniforms = { uTime: { value: 0 }, uDrift: { value: 0.35 }, uColor: { value: new THREE.Color(0xb4ab9a) }, uOpacity: { value: 0.15 } };
    this.frag = `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
varying float vA;
varying float vSeed;
void main() {
  vec2 p = vUv - 0.5;
  float d = length(p) * 2.0;
  float wob = 0.85 + 0.15 * sin(atan(p.y, p.x) * 3.0 + vSeed * 9.0);
  float a = smoothstep(1.0, 0.0, d / wob);
  a = a * a * (3.0 - 2.0 * a) * 0.85;
  gl_FragColor = vec4(uColor, a * vA * uOpacity);
}`;
    this.mesh = this._make(64);
    this.mesh.renderOrder = 6;
    parent.add(this.mesh);
    this.cur = new Map(); // key -> { x, z, r, a, target }
    this._t = -1;
  }
  _make(cap) {
    return sprites(cap, this.frag, this.uniforms, THREE.NormalBlending);
  }
  // haze: civ.haze() list; ground(x, z) -> height; daylight 0..1
  update(dt, haze, ground, daylight, t) {
    this.uniforms.uTime.value = t;
    // dusk and night: the haze darkens with the land
    this.uniforms.uColor.value.setRGB(0.71, 0.68, 0.61).multiplyScalar(0.35 + 0.65 * daylight);
    const seen = new Set();
    for (const h of haze || []) {
      const key = Math.round(h.x * 4) * 65536 + Math.round(h.z * 4);
      seen.add(key);
      let e = this.cur.get(key);
      if (!e) this.cur.set(key, (e = { x: h.x, z: h.z, r: h.r, a: 0, target: 0, k: key }));
      e.r = h.r;
      e.target = Math.min(1, h.s);
    }
    for (const e of this.cur.values()) if (!seen.has(e.k)) e.target = 0;
    // ease toward the target so haze thickens and clears gently
    const k = Math.min(1, dt * 0.25);
    let n = 0;
    const list = [];
    for (const [key, e] of this.cur) {
      e.a += (e.target - e.a) * k;
      if (e.target === 0 && e.a < 0.01) {
        this.cur.delete(key);
        continue;
      }
      list.push(e);
      n += 7;
    }
    const m = grow(this, 'mesh', n, (c) => this._make(c));
    const al = m.geometry.getAttribute('aAlpha'),
      sd = m.geometry.getAttribute('aSeed');
    let i = 0;
    for (const e of list) {
      const g0 = ground(e.x, e.z);
      if (g0 == null) continue;
      for (let j = 0; j < 7; j++) {
        const sx = Math.sin(e.k * 0.37 + j * 2.4),
          sz = Math.cos(e.k * 0.53 + j * 1.7);
        const off = j === 0 ? 0 : e.r * (0.4 + 0.12 * (j % 3));
        const px = e.x + sx * off,
          pz = e.z + sz * off;
        // a puff whose middle would sit over water is left out
        const gy = ground(px, pz);
        if (gy == null) continue;
        let s = e.r * (j === 0 ? 2.3 : 1.7);
        // by the shore the puff shrinks so its soft body stays over the land
        const q = s * 0.3;
        if (ground(px + q, pz) == null || ground(px - q, pz) == null || ground(px, pz + q) == null || ground(px, pz - q) == null) s *= 0.45;
        _m.makeScale(s, s, s).setPosition(px, Math.max(gy, g0) + 1.2 + j * 0.2 + e.r * 0.12, pz);
        m.setMatrixAt(i, _m);
        al.array[i] = e.a * (j === 0 ? 0.85 : 0.6);
        sd.array[i] = ((e.k % 997) / 997 + j * 0.31) % 1;
        i++;
      }
    }
    m.count = i;
    m.instanceMatrix.needsUpdate = true;
    al.needsUpdate = true;
    sd.needsUpdate = true;
    m.visible = i > 0;
  }
}
