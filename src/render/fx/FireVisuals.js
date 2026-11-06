import * as THREE from 'three';
import { HEIGHT_GLSL } from './HeightField.js';
import { FLORA_INFO } from '../../world/constants.js';
import { RAMP, PF } from './FxTextures.js';

const PF_GLOW = PF.GLOW;
import { flame, ember, _smokePuff as smokePuff, PRESETS } from './presets.js';

// Visuals for the fire and lava simulations owned by game.disasters:
//  - a ground glow layer (one terrain-hugging additive splat per burning,
//    smouldering or molten tile; flicker is computed on the GPU) that reads
//    as a glowing orange fire front from far zoom and as speckled embers in
//    fresh ash at night,
//  - dancing flame billboards, rising smoke columns that drift downwind and
//    embers, emitted per visible burning tile with zoom-dependent LOD so a
//    huge wildfire stays within the particle budget,
//  - warm flickering pooled lights placed on the largest fire clusters.

const VERT = /* glsl */ `
uniform float uTime;
attribute vec4 gA; // x, z, intensity, kind (0 fire, 1 smoulder, 2 lava)
varying float vI;
varying float vKind;
varying vec2 vL;
varying vec2 vW;
varying float vSeed;
varying float vFogDepth;
${HEIGHT_GLSL}
void main() {
  float kind = gA.w;
  float size = kind < 0.5 ? 2.9 : (kind < 1.5 ? 1.7 : 3.6);
  vec2 xz = gA.xy + position.xy * size;
  float h = fxGroundAt(xz);
  vec4 mv = viewMatrix * vec4(xz.x, max(h, 0.0) + 0.05, xz.y, 1.0);
  mv.xyz *= 0.9982;
  gl_Position = projectionMatrix * mv;
  vFogDepth = -mv.z;
  vI = gA.z * (h < -0.05 && kind < 1.5 ? 0.0 : 1.0);
  vKind = kind;
  vL = position.xy;
  vW = xz;
  vSeed = fract(sin(dot(gA.xy, vec2(12.9898, 78.233))) * 43758.5453);
}`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uNight;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
uniform float fogDensity;
varying float vI;
varying float vKind;
varying vec2 vL;
varying vec2 vW;
varying float vSeed;
varying float vFogDepth;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  if (vI <= 0.001) discard;
  float r = length(vL) * 2.0;
  float edge = 1.0 - smoothstep(0.75, 1.0, r);
  vec3 col;
  float fall;
  if (vKind < 0.5) {
    fall = exp(-r * r * 3.4) * edge;
    float fl = 0.72 + 0.28 * sin(uTime * 11.0 + vSeed * 40.0) * sin(uTime * 6.7 + vSeed * 13.0);
    float n = vnoise(vW * 1.7 + vec2(uTime * 0.6, -uTime * 0.4));
    col = mix(vec3(1.0, 0.22, 0.02), vec3(1.0, 0.6, 0.16), vI * (0.6 + 0.4 * n)) * vI * fl * (0.75 + 0.5 * n) * 1.25;
  } else if (vKind < 1.5) {
    fall = exp(-r * r * 2.2) * edge;
    float sp = vnoise(vW * 6.0 + vSeed) * vnoise(vW * 2.3 - uTime * 0.05);
    float pulse = 0.75 + 0.25 * sin(uTime * 1.7 + vSeed * 30.0 + vW.x);
    col = vec3(1.0, 0.16, 0.01) * vI * smoothstep(0.18, 0.5, sp) * 1.8 * pulse;
  } else {
    fall = exp(-r * r * 2.6) * edge;
    col = mix(vec3(0.9, 0.12, 0.0), vec3(1.0, 0.42, 0.06), vI) * vI * 0.55;
  }
  float fog = 0.0;
#ifdef USE_FOG
#ifdef FOG_EXP2
  fog = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
#else
  fog = smoothstep(fogNear, fogFar, vFogDepth);
#endif
#endif
  col *= fall * mix(0.5, 1.0, uNight) * (1.0 - fog);
  if (max(col.r, max(col.g, col.b)) < 0.002) discard;
  gl_FragColor = vec4(col, 1.0);
#include <colorspace_fragment>
}`;

const CAP = 14000;

export class FireVisuals {
  constructor(fx) {
    this.fx = fx;
    this.game = fx.game;
    const geo = new THREE.InstancedBufferGeometry();
    const grid = new THREE.PlaneGeometry(1, 1, 4, 4);
    geo.index = grid.index;
    geo.setAttribute('position', grid.getAttribute('position'));
    this.attr = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('gA', this.attr);
    geo.instanceCount = 0;
    this.geo = geo;
    this.uNight = { value: 0 };
    this.material = new THREE.ShaderMaterial({
      name: 'fx-fireglow',
      uniforms: { uTime: fx.uniforms.uTime, uNight: this.uNight, ...fx.heightField.uniforms(), ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -6,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    fx.game.scene.add(this.mesh);
    this._ver = -1;
    this._cells = new Map();
    this._flick = 0;
  }

  reset() {
    this.geo.instanceCount = 0;
    this._ver = -1;
  }

  update(dt) {
    const g = this.game;
    const ds = g.disasters;
    if (!ds || !ds.fire) return;
    const fire = ds.fire,
      lava = ds.lava;
    const world = g.world;
    const W = world.w;
    this.uNight.value = 1 - (g.env.daylight ?? 1);

    // ---- glow instances (rebuilt only when the simulation changed) ----
    const ver = fire.version + (lava ? lava.version * 7919 : 0);
    if (ver !== this._ver) {
      this._ver = ver;
      const A = this.attr.array;
      let n = 0;
      for (let k = 0; k < fire.count && n < CAP; k++) {
        const i = fire.list[k];
        const f = world.fire[i];
        if (f <= 0.01) continue;
        const o = n * 4;
        A[o] = (i % W) + 0.5;
        A[o + 1] = ((i / W) | 0) + 0.5;
        A[o + 2] = Math.min(1, f);
        A[o + 3] = 0;
        n++;
      }
      for (let k = 0; k < fire.smCount && n < CAP; k++) {
        const i = fire.smList[k];
        const s = fire.smolder[i];
        if (s <= 0.02 || world.fire[i] > 0.05) continue;
        const o = n * 4;
        A[o] = (i % W) + 0.5;
        A[o + 1] = ((i / W) | 0) + 0.5;
        A[o + 2] = s;
        A[o + 3] = 1;
        n++;
      }
      if (lava)
        for (let k = 0; k < lava.count && n < CAP; k++) {
          const i = lava.list[k];
          const h = lava.heat[i];
          if (h <= 0.05) continue;
          const o = n * 4;
          A[o] = (i % W) + 0.5;
          A[o + 1] = ((i / W) | 0) + 0.5;
          A[o + 2] = Math.min(1, h);
          A[o + 3] = 2;
          n++;
        }
      this.geo.instanceCount = n;
      if (n) {
        this.attr.clearUpdateRanges();
        this.attr.addUpdateRange(0, n * 4);
        this.attr.needsUpdate = true;
      }
    }

    // ---- particle emission for visible tiles ----
    const rig = g.cameraRig;
    const cx = rig.cur.x,
      cz = rig.cur.z,
      dist = rig.cur.dist;
    const R = dist * 1.05 + 14;
    const R2 = R * R;
    const lod = THREE.MathUtils.clamp(dist / 48, 1, 3.4);
    const fx = this.fx;
    const budget = fx.budget;
    const rateK = budget / (lod * lod);
    const cells = this._cells;
    cells.clear();
    const flora = world.flora,
      growth = world.floraGrowth;
    const wt = g.env.weather?.type;
    const raining = wt === 'rain' || wt === 'storm';
    const rnd = Math.random;
    for (let k = 0; k < fire.count; k++) {
      const i = fire.list[k];
      const f = world.fire[i];
      if (f <= 0.02) continue;
      const tx = i % W,
        ty = (i / W) | 0;
      const x = tx + 0.5,
        z = ty + 0.5;
      const dx = x - cx,
        dz = z - cz;
      // light clustering uses every burning tile
      const ck = ((tx >> 3) << 10) | (ty >> 3);
      let c = cells.get(ck);
      if (!c) cells.set(ck, (c = { n: 0, x: 0, z: 0, f: 0 }));
      c.n++;
      c.x += x;
      c.z += z;
      c.f += f;
      if (dx * dx + dz * dz > R2) continue;
      const fl = flora[i];
      const info = FLORA_INFO[fl];
      const tree = info && info.isTree;
      const gr = tree ? 0.4 + 0.6 * growth[i] : 0;
      const ground = world.heightAt(x, z);
      // flames
      let e = (tree ? 8 : 4.5) * f * dt * rateK;
      while (e > 0) {
        if (e < 1 && rnd() > e) break;
        e -= 1;
        const jx = (rnd() - 0.5) * 0.85,
          jz = (rnd() - 0.5) * 0.85;
        const fy = tree ? ground + gr * (0.2 + rnd() * 1.2) : ground + 0.02;
        const size = (tree ? 0.7 + rnd() * 0.75 : 0.35 + rnd() * 0.45) * (0.5 + 0.65 * f) * lod;
        flame(fx, x + jx, fy, z + jz, size, { bright: 1.5 + f * 0.6 });
      }
      // soft volumetric halo behind the tongues
      e = (tree ? 2.2 : 1.2) * f * dt * rateK;
      if (rnd() < e) {
        const P = fx.P.reset();
        P.x = x + (rnd() - 0.5) * 0.5;
        P.y = ground + (tree ? gr * 0.9 : 0.3);
        P.z = z + (rnd() - 0.5) * 0.5;
        P.vy = 0.6;
        P.ty = 0.8;
        P.tx = fx.wind.x * 0.6;
        P.tz = fx.wind.z * 0.6;
        P.drag = 1.5;
        P.life = 0.5 + rnd() * 0.4;
        P.s0 = (tree ? 2.6 : 1.7) * lod * (0.6 + 0.5 * f);
        P.s1 = P.s0 * 1.25;
        P.frame = PF_GLOW;
        P.ramp = RAMP.FIRE;
        P.bright = 0.9;
        P.a = 0.45;
        P.add = 1;
        P.soft = 0.3;
        fx.pGlow();
      }
      // embers
      e = (tree ? 1.6 : 0.45) * f * dt * budget / lod;
      if (rnd() < e) ember(fx, x, ground + (tree ? gr * 1.2 : 0.3), z, { size: lod * 0.9 });
      // smoke: big overlapping puffs that build a drifting column
      e = (tree ? 0.75 : 0.4) * f * dt * rateK;
      if (rnd() < e) {
        smokePuff(fx, x + (rnd() - 0.5) * 0.6, ground + (tree ? gr * 1.7 : 0.6), z + (rnd() - 0.5) * 0.6, {
          size: (tree ? 1.5 : 1.1) * lod,
          grow: 3.2,
          ramp: raining && rnd() < 0.6 ? RAMP.STEAM : RAMP.FIRE_SMOKE,
          glow: 0.8,
          rise: 1.25 * Math.sqrt(lod),
          life: (6 + rnd() * 3.5) * (0.8 + lod * 0.25),
          drift: 2.4,
        });
      }
    }
    // smouldering ash: thin wisps
    for (let k = 0; k < fire.smCount; k++) {
      const i = fire.smList[k];
      const s = fire.smolder[i];
      if (s < 0.15 || rnd() > s * dt * 0.35 * rateK) continue;
      const x = (i % W) + 0.5,
        z = ((i / W) | 0) + 0.5;
      const dx = x - cx,
        dz = z - cz;
      if (dx * dx + dz * dz > R2) continue;
      smokePuff(fx, x, world.heightAt(x, z) + 0.1, z, { size: 0.45 * lod, ramp: RAMP.SMOKE_LIGHT, rise: 0.7, life: 3 + rnd() * 2, alpha: 0.55 * s });
    }
    // lava sparks / pops
    if (lava) {
      for (let k = 0; k < lava.count; k++) {
        const i = lava.list[k];
        const h = lava.heat[i];
        if (h < 0.3) continue;
        const tx = i % W,
          ty = (i / W) | 0;
        const x = tx + 0.5,
          z = ty + 0.5;
        const ck = 0x40000000 | ((tx >> 3) << 10) | (ty >> 3);
        let c = cells.get(ck);
        if (!c) cells.set(ck, (c = { n: 0, x: 0, z: 0, f: 0, lava: true }));
        c.n++;
        c.x += x;
        c.z += z;
        c.f += h;
        const dx = x - cx,
          dz = z - cz;
        if (dx * dx + dz * dz > R2) continue;
        if (rnd() < h * dt * 0.5 * budget) PRESETS.lavaPop(fx, { x: x + (rnd() - 0.5) * 0.8, y: world.heightAt(x, z), z: z + (rnd() - 0.5) * 0.8 }, { scale: 0.6 + rnd() * 0.5 });
        if (rnd() < h * dt * 0.25 * rateK) smokePuff(fx, x, world.heightAt(x, z) + 0.2, z, { size: 0.6 * lod, ramp: RAMP.HOT_SMOKE, glow: 0.7, rise: 1, life: 2.5 + rnd() * 2, alpha: 0.6 });
      }
    }
    // ---- lights on the biggest clusters near the camera ----
    if (cells.size) {
      const arr = [...cells.entries()];
      for (const [, c] of arr) {
        c.x /= c.n;
        c.z /= c.n;
        const d = Math.hypot(c.x - cx, c.z - cz);
        c.score = Math.sqrt(c.f) / (1 + (d * d) / (R2 * 0.5));
      }
      arr.sort((a, b) => b[1].score - a[1].score);
      this._flick += dt;
      const t = this._flick;
      const night = this.uNight.value;
      for (let j = 0; j < Math.min(4, arr.length); j++) {
        const [key, c] = arr[j];
        const fl = 0.8 + 0.12 * Math.sin(t * 13 + key) + 0.08 * Math.sin(t * 29.7 + key * 3.1);
        const inten = Math.min(4.5, 0.7 + Math.sqrt(c.f) * 0.5) * fl * (0.55 + 0.7 * night);
        const y = world.surfaceAt(c.x, c.z) + 2.4 + Math.min(3, Math.sqrt(c.n) * 0.3);
        const col = c.lava ? this._lavaCol : this._fireCol;
        fx.lights.request('fl' + key, c.x, y, c.z, col, inten, 12 + Math.sqrt(c.n) * 2.2);
      }
    }
  }
  get _fireCol() {
    return (this.__fc ||= new THREE.Color(1.0, 0.55, 0.2));
  }
  get _lavaCol() {
    return (this.__lc ||= new THREE.Color(1.0, 0.38, 0.1));
  }
}
