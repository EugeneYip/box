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
  // a small warm pool, not a white disc (the lamps read as oversized dots)
  float a = pow(max(0.0, 1.0 - d), 3.2);
  gl_FragColor = vec4(vec3(1.0, 0.82, 0.55) * a * vA * uNight * 0.62, 1.0);
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
    this.uniforms = { uTime: { value: 0 }, uDrift: { value: 0.35 }, uColor: { value: new THREE.Color(0xb4ab9a) }, uOpacity: { value: 0.11 } };
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
  // haze: civ.haze() list; ground(x, z) -> height; daylight 0..1; dist the
  // camera distance; eraOf(kingdom) the realm's era
  update(dt, haze, ground, daylight, t, dist = 60, eraOf = null) {
    this.uniforms.uTime.value = t;
    // a far-zoom touch only (round 31): from a 25-40 tile camera the puffs sat
    // between the eye and the town and laid a milky veil over every Modern
    // town, by day and by night. None closer than ~35 tiles, full by ~65, and
    // gone again past ~90, where the soft discs lay on slopes as bruises.
    const fin = Math.min(1, Math.max(0, (dist - 35) / 30)),
      fout = Math.min(1, Math.max(0, (dist - 78) / 14));
    const zoomK = fin * fin * (3 - 2 * fin) * (1 - fout * fout * (3 - 2 * fout));
    // dusk and night: the haze darkens with the land, down to below the
    // night ground's own brightness (a 0.23 grey whitened the dark town into
    // the white night haze), and thins
    const dl = Math.max(0, Math.min(1, daylight));
    this.uniforms.uColor.value.setRGB(0.67, 0.67, 0.66).multiplyScalar(0.04 + 0.96 * dl * Math.sqrt(dl));
    this.uniforms.uOpacity.value = 0.11 * zoomK * (0.4 + 0.6 * dl);
    // sources closer than ~6 tiles merge into one (a works district of a dozen
    // stacks piled a dozen haze discs into one opaque sheet); fusion-era
    // (Future) towns burn clean and put out none
    if (haze !== this._src || this._srcN !== (haze?.length ?? 0)) {
      this._src = haze;
      this._srcN = haze?.length ?? 0;
      const cl = [];
      for (const h of haze || []) {
        if (eraOf && eraOf(h.kingdom) >= 7) continue;
        let c = null;
        for (const q of cl)
          if (Math.hypot(q.x - h.x, q.z - h.z) < 6) {
            c = q;
            break;
          }
        if (!c) cl.push({ x: h.x, z: h.z, r: h.r, s: h.s, n: 1 });
        else {
          c.x = (c.x * c.n + h.x) / (c.n + 1);
          c.z = (c.z * c.n + h.z) / (c.n + 1);
          c.n++;
          c.r = Math.min(Math.max(c.r, h.r) + 0.25, 6);
          c.s = Math.max(c.s, h.s);
        }
      }
      this._cl = cl;
    }
    const seen = new Set();
    for (const h of this._cl) {
      const key = Math.round(h.x) * 65536 + Math.round(h.z);
      seen.add(key);
      let e = this.cur.get(key);
      if (!e) this.cur.set(key, (e = { x: h.x, z: h.z, r: h.r, a: 0, target: 0, k: key }));
      e.x = h.x;
      e.z = h.z;
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
        // (lifted well clear of the roofs: low down it read as brown smears on the ground)
        _m.makeScale(s, s, s).setPosition(px, Math.max(gy, g0) + 2.6 + j * 0.3 + e.r * 0.15, pz);
        m.setMatrixAt(i, _m);
        // (a puff's own alpha is capped low: overlapping puffs add up)
        al.array[i] = e.a * (j === 0 ? 0.32 : 0.24);
        sd.array[i] = ((e.k % 997) / 997 + j * 0.31) % 1;
        i++;
      }
    }
    m.count = i;
    m.instanceMatrix.needsUpdate = true;
    al.needsUpdate = true;
    sd.needsUpdate = true;
    m.visible = i > 0 && zoomK > 0.001;
  }
}

// StackPlumes — the smoke of factory, foundry and power-station stacks (and
// the steam of cooling towers): per stack a column of soft puffs that rise,
// bend over and drift downwind, growing and thinning as they go, so a works
// town shows its plumes at day and mid zoom (the particle puffs were lost at
// that range, and the low haze read as brown smears on the ground). The
// whole life of each puff is computed in the vertex shader from the time,
// so this is ONE instanced draw with no per-frame CPU work; instances are
// written only when the town changes (BuildingRenderer._rebuild).
const PLUME_VERT = `
attribute float aTone;
attribute float aSeed;
uniform float uTime;
uniform vec2 uWind;
uniform float uFar;
varying vec2 vUv;
varying float vA;
varying float vTone;
varying float vSeed;
void main() {
  vUv = uv;
  vTone = aTone;
  // far zoom (past ~100 tiles): most puffs of each column drop out and the
  // rest thin to a faint wisp (a town's plumes read as cotton balls there)
  if (fract(aSeed * 7.31 + 0.13) < uFar * 0.7) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  vSeed = aSeed;
  vec3 c = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float s = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
  float t = fract(uTime * 0.085 + aSeed);
  // buoyant rise that slows as the plume bends over, then drifts downwind
  c.y += s * (0.15 + 3.4 * sqrt(t) + 0.6 * t);
  vec2 w = uWind * s * (0.5 * t + 4.2 * t * t);
  c.x += w.x + sin(uTime * 0.6 + aSeed * 23.0) * 0.18 * s * t;
  c.z += w.y + cos(uTime * 0.5 + aSeed * 17.0) * 0.18 * s * t;
  float size = s * (0.42 + 1.55 * t);
  vA = smoothstep(0.0, 0.07, t) * (1.0 - smoothstep(0.5, 1.0, t)) * (1.0 - 0.55 * uFar);
  size *= 1.0 - 0.3 * uFar;
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
}`;
const PLUME_FRAG = `
uniform float uLight;
uniform float uOpacity;
varying vec2 vUv;
varying float vA;
varying float vTone;
varying float vSeed;
void main() {
  vec2 p = vUv - 0.5;
  float d = length(p) * 2.0;
  // (round 27: a four-lobed wobble turned faint puffs into four-point
  // stars) a slight lumpiness of two odd frequencies, each puff turned its
  // own way, so the outline stays a soft round blob
  float th = atan(p.y, p.x);
  float wob = 0.93 + 0.035 * sin(th * 3.0 + vSeed * 31.0) + 0.025 * sin(th * 5.0 + vSeed * 57.0 + 1.7);
  float a = 1.0 - smoothstep(0.25, 0.95, d / wob);
  if (a <= 0.003) discard;
  // pale grey smoke (works), dark soot (foundries), white steam (cooling towers)
  vec3 col = vTone > 1.5 ? vec3(0.93, 0.94, 0.95) : mix(vec3(0.74, 0.73, 0.71), vec3(0.34, 0.32, 0.30), vTone);
  // a lit top and a shaded underside, so a puff reads as a volume
  col *= 0.8 + 0.32 * (p.y + 0.5);
  col *= uLight;
  gl_FragColor = vec4(col, a * vA * uOpacity);
}`;

export class StackPlumes {
  constructor(parent, puffs = 9) {
    this.puffs = puffs;
    this.uniforms = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0.6, 0.2) }, uLight: { value: 1 }, uOpacity: { value: 0.72 }, uFar: { value: 0 } };
    this.parent = parent;
    this.mesh = this._make(64);
    parent.add(this.mesh);
  }
  _make(cap) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.ShaderMaterial({ vertexShader: PLUME_VERT, fragmentShader: PLUME_FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false });
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.name = 'buildings:plumes';
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 6;
    geo.setAttribute('aTone', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
    return mesh;
  }
  // list of {x, y, z, s (plume scale, world units), tone (0 smoke, 1 soot, 2 steam)}
  set(L) {
    const n = L.length * this.puffs;
    if (this.mesh.instanceMatrix.count < n) {
      const nm = this._make(Math.ceil(n * 1.5));
      this.parent.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = nm;
      this.parent.add(nm);
    }
    const m = this.mesh;
    const tone = m.geometry.getAttribute('aTone'),
      seed = m.geometry.getAttribute('aSeed');
    let i = 0;
    for (let k = 0; k < L.length; k++) {
      const e = L[k];
      const ph = Math.abs(Math.sin(e.x * 12.9898 + e.z * 78.233)) % 1;
      for (let j = 0; j < this.puffs; j++, i++) {
        _m.makeScale(e.s, e.s, e.s).setPosition(e.x, e.y, e.z);
        m.setMatrixAt(i, _m);
        tone.array[i] = e.tone;
        seed.array[i] = (j / this.puffs + ph + (j % 2) * 0.031) % 1;
      }
    }
    m.count = i;
    m.instanceMatrix.needsUpdate = true;
    tone.needsUpdate = true;
    seed.needsUpdate = true;
  }
  update(t, wind, daylight, show, dist = 60) {
    this.uniforms.uTime.value = t;
    const fk = Math.min(1, Math.max(0, (dist - 95) / 45));
    this.uniforms.uFar.value = fk * fk * (3 - 2 * fk);
    const st = Math.max(0.3, Math.min(1.2, wind?.strength ?? 0.35));
    const wx = wind?.x ?? 1,
      wz = wind?.z ?? 0;
    const l = Math.hypot(wx, wz) || 1;
    this.uniforms.uWind.value.set((wx / l) * st, (wz / l) * st);
    // (round 31: at night the white plumes glowed over the dark town; they
    // take the daylight down to a dim grey and thin out)
    const dl = Math.max(0, Math.min(1, daylight));
    this.uniforms.uLight.value = 0.06 + 0.94 * dl * Math.sqrt(dl);
    this.uniforms.uOpacity.value = 0.72 * (0.45 + 0.55 * dl);
    this.mesh.visible = show && this.mesh.count > 0;
  }
}
