import * as THREE from 'three';
import { mulberry32 } from './util.js';

// Stylised cumulus seen from above: each cloud is a cluster of soft,
// noise-eroded billboard puffs (no hard silhouettes), lit with a pseudo
// spherical normal (warm sunlit tops, cool lavender undersides, silver lining
// when back-lit) and cut flat at the cluster base. Puffs are sorted back to
// front every frame so the translucent layers blend correctly. Clouds drift
// with the wind across a wrapping field twice the size of the world, appear
// and dissolve with weather cover, and fade out as the camera comes close.
//
// The same puffs are splatted top-down into a small coverage texture that is
// published as game.env.cloudShadow (consumers apply it to DIRECT light only).
// In storms a fast, wind-driven noise field is added to that texture and a
// translucent low scud layer races between the camera and the ground.

const NOISE = /* glsl */ `
float cHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float cNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(cHash(i), cHash(i + vec2(1, 0)), u.x), mix(cHash(i + vec2(0, 1)), cHash(i + vec2(1, 1)), u.x), u.y);
}
float cFbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * cNoise(p); p = mat2(0.8, -0.6, 0.6, 0.8) * p * 2.07 + 5.3; a *= 0.5; }
  return s / 0.9375;
}
`;

const PUFF_VERT = /* glsl */ `
attribute vec4 aPuff;   // xyz centre, w radius
attribute vec4 aCloud;  // x fade, y base height, z thickness, w seed
varying vec2 vUv;
varying vec3 vW;
varying vec3 vC;
varying vec3 vRight;
varying vec3 vUp;
varying vec4 vCloud;
void main() {
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float r = aPuff.w * 1.3;
  vec3 wp = aPuff.xyz + (right * position.x + up * position.y) * r;
  vUv = position.xy;
  vW = wp;
  vC = aPuff.xyz;
  vRight = right;
  vUp = up;
  vCloud = aCloud;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  if (aCloud.x < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const PUFF_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uFlash;
uniform float uDark;
uniform float uOpacity;
uniform float uNearFade;
uniform float uTime;
varying vec2 vUv;
varying vec3 vW;
varying vec3 vC;
varying vec3 vRight;
varying vec3 vUp;
varying vec4 vCloud;
${NOISE}
void main() {
  float rr = length(vUv);
  if (rr > 1.0) discard;
  float seed = vCloud.w;
  // noise-eroded soft edge (slowly boiling)
  float n = cFbm(vUv * 1.6 + seed * 37.0 + vec2(uTime * 0.012, -uTime * 0.009));
  float n2 = cNoise(vUv * 5.0 + seed * 11.0);
  float edge = rr + (n - 0.5) * 0.62 + (n2 - 0.5) * 0.12;
  float dens = 1.0 - smoothstep(0.32, 0.92, edge);
  // flat, shaded cluster base
  float h = (vW.y - vCloud.y) / max(vCloud.z, 0.5);
  dens *= smoothstep(-0.08, 0.1, h);
  if (dens < 0.004) discard;

  // pseudo spherical normal for the puff
  float nz = sqrt(max(0.0, 1.0 - rr * rr));
  vec3 toCam = normalize(cameraPosition - vC);
  vec3 N = normalize(vRight * vUv.x + vUp * vUv.y + toCam * (nz + 0.25));
  float ndl = dot(N, uSunDir);
  float wrap = smoothstep(-0.55, 0.95, ndl);
  float hh = clamp(h, 0.0, 1.0);
  vec3 amb = uShade * (0.68 + 0.32 * N.y) * mix(0.68, 1.06, hh);
  vec3 col = amb + uLit * wrap * mix(0.5, 1.02, hh);
  col *= mix(0.74, 1.0, smoothstep(0.0, 0.3, hh)); // darker base band
  float back = pow(max(dot(-toCam, uSunDir), 0.0), 3.0);
  col += uLit * pow(1.0 - nz, 2.0) * (0.12 + 1.1 * back) * (0.4 + 0.6 * hh);
  col *= 0.95 + 0.1 * seed;
  col *= mix(1.0, 0.42, uDark);
  col += uFlash * (0.5 + 0.5 * hh);

  float a = dens * vCloud.x * uOpacity * 0.62;
  a *= smoothstep(uNearFade * 0.35, uNearFade, distance(cameraPosition, vW));
  gl_FragColor = vec4(col, a);
}
`;

const SPLAT_VERT = /* glsl */ `
attribute vec4 aPuff;
attribute vec4 aCloud;
varying vec2 vUv;
varying float vFade;
varying float vSeed;
void main() {
  vUv = position.xy;
  vFade = aCloud.x;
  vSeed = aCloud.w;
  vec3 wp = aPuff.xyz + vec3(position.x, 0.0, position.y) * aPuff.w * 1.3;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const SPLAT_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vFade;
varying float vSeed;
${NOISE}
void main() {
  float r = length(vUv);
  float n = cFbm(vUv * 1.6 + vSeed * 37.0);
  float a = (1.0 - smoothstep(0.25, 0.95, r + (n - 0.5) * 0.5)) * vFade;
  gl_FragColor = vec4(a, a, a, a);
}
`;

// storm: fast wind-driven shadow field over the whole cloud field
const STORM_SHADOW_FRAG = /* glsl */ `
uniform vec2 uOff;
uniform float uAmt;
varying vec2 vW;
${NOISE}
void main() {
  float n = cFbm(vW / 32.0 + uOff);
  float a = smoothstep(0.38, 0.72, n) * uAmt;
  gl_FragColor = vec4(a, a, a, a);
}
`;
const STORM_SHADOW_VERT = /* glsl */ `
varying vec2 vW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

// storm: translucent low scud layer between the camera and the land
const SCUD_VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const SCUD_FRAG = /* glsl */ `
uniform vec2 uOff;     // shared with the storm cloud-shadow field
uniform float uAmt;
uniform vec3 uCenter;
uniform float uRadius;
uniform vec3 uTop;
uniform vec3 uUnder;
uniform vec3 uSunDir;
uniform vec3 uFlash;
uniform float uTime;
varying vec3 vW;
${NOISE}
// cloud-top height field: the large shapes match the storm shadow field
float deckBase(vec2 xz) { return cFbm(xz / 32.0 + uOff); }
void main() {
  vec2 xz = vW.xz;
  vec2 p = xz / 32.0 + uOff;
  float base = cFbm(p);
  float radial = 1.0 - smoothstep(uRadius * 0.55, uRadius, distance(xz, uCenter.xz));
  if (base < 0.3 || radial <= 0.0) discard;
  // billowing detail (domain warped, slowly boiling)
  vec2 w = vec2(cFbm(p * 2.1 + uTime * 0.03), cFbm(p * 2.1 + 5.2 - uTime * 0.025));
  float det = cFbm(p * 3.3 + w * 0.7);
  float h = base + (det - 0.5) * 0.24;
  float cov = smoothstep(0.47, 0.64, h);          // broken deck with real gaps
  if (cov < 0.004) discard;
  // lit from above: normal from the height field gradient
  float e = 2.0;
  float hx = deckBase(xz + vec2(e, 0.0)) - base;
  float hz = deckBase(xz + vec2(0.0, e)) - base;
  vec3 N = normalize(vec3(-hx * 24.0 - (det - 0.5) * 0.9, 1.0, -hz * 24.0 - (w.x - 0.5) * 0.9));
  float lam = clamp(dot(N, uSunDir) * 0.55 + 0.45, 0.0, 1.0);
  float thick = smoothstep(0.42, 0.78, h);
  vec3 col = mix(uUnder, uTop * (0.7 + 0.5 * lam), thick);
  col *= mix(0.62, 1.0, smoothstep(0.0, 0.55, cov));  // darker underside at the thin edges
  col += uFlash * (0.3 + 0.7 * thick);
  float a = cov * uAmt * mix(0.42, 0.82, thick) * radial;
  gl_FragColor = vec4(col, a);
}
`;


// high, thin cirrus / altostratus streaks: a second, faster layer above the
// cumulus (wind-stretched fbm), only seen from map zoom
const CIRRUS_VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const CIRRUS_FRAG = /* glsl */ `
uniform vec2 uOff;
uniform vec2 uWind;
uniform float uAmt;
uniform vec3 uCol;
uniform vec3 uCenter;
uniform float uRadius;
varying vec3 vW;
${NOISE}
void main() {
  vec2 w = normalize(uWind + 1e-4);
  vec2 q = vec2(dot(vW.xz, w), dot(vW.xz, vec2(-w.y, w.x)));
  vec2 p = vec2(q.x / 160.0, q.y / 38.0) + uOff;   // stretched along the wind
  float n = cFbm(p);
  float n2 = cFbm(p * vec2(1.0, 3.5) + 4.1);
  float d = smoothstep(0.52, 0.85, n * 0.7 + n2 * 0.4);
  float radial = 1.0 - smoothstep(uRadius * 0.5, uRadius, distance(vW.xz, uCenter.xz));
  float a = d * uAmt * radial;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uCol * (0.9 + 0.2 * n2), a);
}
`;

export class Clouds {
  constructor(atmosphere) {
    this.atm = atmosphere;
    const game = atmosphere.game;
    this.game = game;
    const W = game.world.w,
      H = game.world.h;
    this.field = { x0: -W * 0.5, z0: -H * 0.5, sx: W * 2, sz: H * 2 };
    this.altitude = 62;
    this.deckAltitude = 40; // storm deck
    const q = game.pipeline?.quality || 'high';
    const area = Math.min(4, (W * H) / (256 * 256)); // field grows with the map
    const count = Math.round((q === 'low' ? 24 : q === 'medium' ? 36 : 50) * Math.max(0.6, area));
    const rnd = mulberry32(9137);
    this.clouds = [];
    let puffTotal = 0;
    for (let i = 0; i < count; i++) {
      const c = {
        x: this.field.x0 + rnd() * this.field.sx,
        z: this.field.z0 + rnd() * this.field.sz,
        y: 56 + rnd() * 12,
        size: 8 + Math.pow(rnd(), 1.6) * 14,
        rank: (i + rnd() * 0.8) / count, // presence threshold vs cover
        seed: rnd(),
        puffs: [],
        presence: 0,
        stretch: 1.2 + rnd() * 0.9,
        rot: rnd() * Math.PI,
      };
      const n = 6 + Math.floor(rnd() * 5 + c.size / 5);
      for (let p = 0; p < n; p++) {
        const t = n === 1 ? 0 : p / (n - 1) - 0.5;
        const centrality = 1 - Math.abs(t) * 1.5;
        const r = c.size * (0.3 + 0.24 * centrality + 0.12 * rnd());
        c.puffs.push({
          ox: t * c.size * 0.95 * c.stretch,
          oz: (rnd() - 0.5) * c.size * 0.6,
          oy: r * (0.2 + 0.35 * centrality * rnd()),
          r,
        });
      }
      const crowns = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < crowns; k++) {
        const r = c.size * (0.26 + 0.14 * rnd());
        c.puffs.push({ ox: (rnd() - 0.5) * c.size * 0.6, oz: (rnd() - 0.5) * c.size * 0.3, oy: c.size * (0.3 + 0.18 * rnd()), r });
      }
      c.thickness = c.size * 0.7;
      puffTotal += c.puffs.length;
      this.clouds.push(c);
    }
    this.puffTotal = puffTotal;

    // per-puff instance data (re-sorted back to front every frame)
    this.puffArr = new Float32Array(puffTotal * 4);
    this.cloudArr = new Float32Array(puffTotal * 4);
    this.aPuff = new THREE.InstancedBufferAttribute(this.puffArr, 4).setUsage(THREE.DynamicDrawUsage);
    this.aCloud = new THREE.InstancedBufferAttribute(this.cloudArr, 4).setUsage(THREE.DynamicDrawUsage);
    this._raw = new Float32Array(puffTotal * 8); // unsorted
    this._order = new Uint16Array(puffTotal);
    this._depth = new Float32Array(puffTotal);
    for (let i = 0; i < puffTotal; i++) this._order[i] = i;

    const quad = () => {
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
      g.setIndex([0, 1, 2, 2, 1, 3]);
      g.setAttribute('aPuff', this.aPuff);
      g.setAttribute('aCloud', this.aCloud);
      g.instanceCount = puffTotal;
      return g;
    };

    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uLit: { value: new THREE.Color(1, 1, 1) },
      uShade: { value: new THREE.Color(0.6, 0.65, 0.8) },
      uFlash: { value: new THREE.Color(0, 0, 0) },
      uDark: { value: 0 },
      uOpacity: { value: 1 },
      uNearFade: { value: 40 },
      uTime: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      name: 'CloudPuff',
      uniforms: this.uniforms,
      vertexShader: PUFF_VERT,
      fragmentShader: PUFF_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(quad(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.group = new THREE.Group();
    this.group.name = 'clouds';
    this.group.add(this.mesh);
    this.cirrusU = {
      uOff: { value: new THREE.Vector2() },
      uWind: { value: new THREE.Vector2(1, 0) },
      uAmt: { value: 0 },
      uCol: { value: new THREE.Color(1, 1, 1) },
      uCenter: { value: new THREE.Vector3() },
      uRadius: { value: 300 },
    };
    this.cirrus = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({ name: 'Cirrus', uniforms: this.cirrusU, vertexShader: CIRRUS_VERT, fragmentShader: CIRRUS_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.cirrus.frustumCulled = false;
    this.cirrus.renderOrder = 10;
    game.scene.add(this.cirrus);
    game.scene.add(this.group);

    // ---- storm scud layer --------------------------------------------------
    this.scudU = {
      uOff: null, // shared with the storm shadow field (set below)
      uAmt: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uRadius: { value: 100 },
      uTop: { value: new THREE.Color(0.5, 0.52, 0.56) },
      uUnder: { value: new THREE.Color(0.1, 0.11, 0.13) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uFlash: { value: new THREE.Color(0, 0, 0) },
      uTime: { value: 0 },
    };
    this.scud = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        name: 'StormScud',
        uniforms: this.scudU,
        vertexShader: SCUD_VERT,
        fragmentShader: SCUD_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.scud.frustumCulled = false;
    this.scud.renderOrder = 12;
    this.scud.visible = false;
    game.scene.add(this.scud);
    this.scudOff = new THREE.Vector2();

    // ---- coverage (shadow) map ---------------------------------------------
    const res = q === 'low' ? 128 : 256;
    this.shadowRT = new THREE.WebGLRenderTarget(res, res, {
      depthBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });
    this.shadowRT.texture.name = 'CloudShadow';
    this.splatScene = new THREE.Scene();
    const maxBlend = {
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    };
    this.splatMesh = new THREE.Mesh(quad(), new THREE.ShaderMaterial({ vertexShader: SPLAT_VERT, fragmentShader: SPLAT_FRAG, ...maxBlend }));
    this.splatMesh.frustumCulled = false;
    this.splatScene.add(this.splatMesh);
    const f = this.field;
    this.stormShadowU = { uOff: { value: new THREE.Vector2() }, uAmt: { value: 0 } };
    this.scudU.uOff = this.stormShadowU.uOff; // deck and its shadows move as one
    this.stormShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(f.sx, f.sz).rotateX(-Math.PI / 2).translate(f.x0 + f.sx / 2, 50, f.z0 + f.sz / 2),
      new THREE.ShaderMaterial({ uniforms: this.stormShadowU, vertexShader: STORM_SHADOW_VERT, fragmentShader: STORM_SHADOW_FRAG, ...maxBlend }),
    );
    this.stormShadow.frustumCulled = false;
    this.stormShadow.visible = false;
    this.splatScene.add(this.stormShadow);
    // Looking straight down (rotation -90deg about X: view x = world x,
    // view y = -world z). The projection is flipped vertically so texture v
    // grows with world Z, matching the published ground-space UV contract.
    this.splatCam = new THREE.OrthographicCamera(f.x0, f.x0 + f.sx, -(f.z0 + f.sz), -f.z0, -100, 300);
    this.splatCam.position.set(0, 200, 0);
    this.splatCam.rotation.set(-Math.PI / 2, 0, 0);
    this.splatCam.updateMatrixWorld();
    this.splatCam.updateProjectionMatrix();

    this.shadow = {
      texture: this.shadowRT.texture,
      params: new THREE.Vector4(-f.x0, -f.z0, 1 / f.sx, 0.4),
    };
    game.env.cloudShadow = this.shadow;

    this.drift = new THREE.Vector2(0, 0);
    this._first = true;
    this._v = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  update(dt, model, weather, env) {
    const game = this.game;
    const rig = game.cameraRig;
    const cam = rig.camera;
    const f = this.field;
    const wind = env.wind;
    const sp = 1.2 + 5.5 * wind.strength;
    this.drift.x += wind.x * sp * dt;
    this.drift.y += wind.z * sp * dt;

    const cover = weather.cover;
    const grow = 1 + 0.3 * weather.storm + 0.12 * weather.overcast;
    const raw = this._raw;
    let k = 0;
    const camDist = rig.cur.dist;
    for (const c of this.clouds) {
      const target = THREE.MathUtils.smoothstep(cover, c.rank - 0.06, c.rank + 0.06);
      if (this._first) c.presence = target;
      else c.presence += (target - c.presence) * Math.min(1, dt * 0.35);
      let x = c.x + this.drift.x;
      let z = c.z + this.drift.y;
      x = f.x0 + ((((x - f.x0) % f.sx) + f.sx) % f.sx);
      z = f.z0 + ((((z - f.z0) % f.sz) + f.sz) % f.sz);
      const ex = Math.min(x - f.x0, f.x0 + f.sx - x) / 50;
      const ez = Math.min(z - f.z0, f.z0 + f.sz - z) / 50;
      const edge = THREE.MathUtils.clamp(Math.min(ex, ez), 0, 1);
      const pres = c.presence * edge;
      const scale = (0.55 + 0.45 * Math.sqrt(c.presence)) * grow;
      const cs = Math.cos(c.rot),
        sn = Math.sin(c.rot);
      const cy = c.y;
      const base = cy - c.size * 0.05;
      for (const p of c.puffs) {
        const o = k * 8;
        raw[o] = x + (p.ox * cs - p.oz * sn) * scale;
        raw[o + 1] = cy + p.oy * scale;
        raw[o + 2] = z + (p.ox * sn + p.oz * cs) * scale;
        raw[o + 3] = p.r * scale;
        raw[o + 4] = pres;
        raw[o + 5] = base;
        raw[o + 6] = c.thickness * scale;
        raw[o + 7] = c.seed;
        k++;
      }
    }
    this._first = false;
    // back-to-front sort by view depth
    const cp = cam.position;
    const fwd = cam.getWorldDirection(this._v);
    const depth = this._depth;
    for (let i = 0; i < k; i++) {
      const o = i * 8;
      depth[i] = (raw[o] - cp.x) * fwd.x + (raw[o + 1] - cp.y) * fwd.y + (raw[o + 2] - cp.z) * fwd.z;
    }
    const order = Array.from(this._order);
    order.sort((a, b) => depth[b] - depth[a]);
    const pa = this.puffArr,
      ca = this.cloudArr;
    for (let i = 0; i < k; i++) {
      const o = order[i] * 8;
      pa[i * 4] = raw[o];
      pa[i * 4 + 1] = raw[o + 1];
      pa[i * 4 + 2] = raw[o + 2];
      pa[i * 4 + 3] = raw[o + 3];
      ca[i * 4] = raw[o + 4];
      ca[i * 4 + 1] = raw[o + 5];
      ca[i * 4 + 2] = raw[o + 6];
      ca[i * 4 + 3] = raw[o + 7];
    }
    this.aPuff.needsUpdate = true;
    this.aCloud.needsUpdate = true;

    // lighting
    const u = this.uniforms;
    u.uTime.value = game.time.realTime;
    u.uSunDir.value.copy(model.keyIsMoon ? model.keyDir : model.sunDir);
    if (u.uSunDir.value.y < 0.05) u.uSunDir.value.y = 0.05;
    u.uSunDir.value.normalize();
    u.uLit.value.copy(model.cloudLit);
    u.uShade.value.copy(model.cloudShade);
    u.uDark.value = Math.min(1, weather.storm * 0.85 + weather.overcast * 0.3);
    const flash = env.lightning || 0;
    u.uFlash.value.setRGB(0.85, 0.9, 1.25).multiplyScalar(flash * 1.2);
    // visibility: gone when close, soft and prominent when zoomed out
    // In storms the low structured deck carries the drama; the high puffs
    // keep their normal zoom fade so they never become a milky veil right
    // under the lens at mid zoom.
    const vis = THREE.MathUtils.smoothstep(camDist, 80, 165);
    u.uOpacity.value = vis * (0.82 + 0.18 * weather.overcast) * (1 - 0.35 * weather.storm);
    u.uNearFade.value = 40 + camDist * 0.28;
    this.group.visible = vis > 0.01;
    // high cirrus layer
    const C = this.cirrusU;
    const cirrusAmt = vis * (0.22 + 0.25 * Math.min(1, weather.cover)) * (1 - 0.8 * weather.storm);
    this.cirrus.visible = cirrusAmt > 0.01;
    if (this.cirrus.visible) {
      const t = rig.target;
      const size = (f.sx + f.sz) * 1.2;
      this.cirrus.position.set(t.x, 92, t.z);
      this.cirrus.scale.set(size, 1, size);
      C.uCenter.value.set(t.x, 92, t.z);
      C.uRadius.value = size * 0.5;
      C.uAmt.value = cirrusAmt;
      C.uWind.value.set(wind.x, wind.z);
      C.uOff.value.x -= (dt * (2 + 6 * wind.strength)) / 160;
      C.uCol.value.copy(model.cloudLit).multiplyScalar(0.9).add(this._c.copy(model.cloudShade).multiplyScalar(0.8));
    }

    // ---- storm scud layer ------------------------------------------------
    const storm = Math.max(weather.storm, weather.rain * 0.35);
    this.scud.visible = storm > 0.02;
    if (this.scud.visible) {
      const t = rig.target;
      const camY = cam.position.y;
      // a fixed-altitude deck, kept below the lens when zoomed in
      const y = Math.min(this.deckAltitude, t.y + (camY - t.y) * 0.6);
      const size = 80 + camDist * 6;
      this.scud.position.set(t.x, y, t.z);
      this.scud.scale.set(size, 1, size);
      const S = this.scudU;
      S.uAmt.value = storm;
      S.uCenter.value.set(t.x, y, t.z);
      S.uRadius.value = size * 0.5;
      S.uTime.value = game.time.realTime;
      S.uSunDir.value.copy(u.uSunDir.value);
      // tops lit by the dim storm sun + skylight, slate undersides
      S.uTop.value.copy(model.cloudShade).multiplyScalar(0.42).add(this._c.copy(model.cloudLit).multiplyScalar(0.28));
      S.uUnder.value.copy(model.cloudShade).multiplyScalar(0.1);
      S.uFlash.value.setRGB(0.75, 0.8, 1.05).multiplyScalar(flash * 0.4);
    }
    this.stormShadow.visible = weather.storm > 0.02 || weather.overcast > 0.6;
    const SS = this.stormShadowU;
    SS.uAmt.value = Math.min(1, weather.storm * 0.9 + Math.max(0, weather.overcast - 0.6));
    SS.uOff.value.x -= (wind.x * (2.5 + 9 * wind.strength) * dt) / 32;
    SS.uOff.value.y -= (wind.z * (2.5 + 9 * wind.strength) * dt) / 32;

    // cloud shadow parameters: project along the sun to the ground
    const sd = model.sunDir;
    const sy = Math.max(0.35, sd.y);
    const P = this.shadow.params;
    const alt = this.altitude - (this.altitude - this.deckAltitude) * weather.storm;
    P.x = -f.x0 + (sd.x / sy) * alt;
    P.y = -f.z0 + (sd.z / sy) * alt;
    P.z = 1 / f.sx;
    P.w = (0.6 + 0.25 * weather.storm) * THREE.MathUtils.smoothstep(sd.y, 0.04, 0.3) * (model.keyIsMoon ? 0 : 1);
  }

  renderShadow(renderer) {
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevAuto = renderer.autoClear;
    renderer.setRenderTarget(this.shadowRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.autoClear = false;
    renderer.render(this.splatScene, this.splatCam);
    renderer.autoClear = prevAuto;
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.setRenderTarget(prevTarget);
  }
}
