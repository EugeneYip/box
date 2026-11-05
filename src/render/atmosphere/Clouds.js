import * as THREE from 'three';
import { mulberry32 } from './util.js';

// Stylised cumulus: each cloud is a cluster of smooth puffs with a flattened
// base, softly lit (warm tops, cool lavender undersides, silver lining when
// back-lit). Clouds drift with the wind across a wrapping field twice the size
// of the world, appear / disappear with weather cover, and fade out when the
// camera comes close so they never block play.
//
// A depth pre-pass lets a whole cloud fade as one translucent volume (no
// overlapping-sphere artefacts). The same puffs are splatted top-down into a
// small coverage texture published as game.env.cloudShadow.

const CLOUD_VERT = /* glsl */ `
attribute vec4 aCloud;   // x: fade, y: base height (world), z: thickness, w: seed
varying vec3 vN;
varying vec3 vW;
varying float vFade;
varying float vH;
varying float vSeed;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec4 wp = m * vec4(position, 1.0);
  vec3 n = normalize(mat3(m) * normal);
  float base = aCloud.y;
  float under = base - wp.y;
  if (under > 0.0) {
    wp.y = base - under * 0.12;
    n = normalize(mix(n, vec3(0.0, -1.0, 0.0), 0.75));
  }
  vN = n;
  vW = wp.xyz;
  vFade = aCloud.x;
  vH = clamp((wp.y - base) / max(aCloud.z, 0.5), 0.0, 1.0);
  vSeed = aCloud.w;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #ifdef PREPASS
  if (aCloud.x < 0.03) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  #endif
}
`;

const CLOUD_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uFlash;
uniform float uDark;
uniform float uOpacity;
uniform float uNearFade;
varying vec3 vN;
varying vec3 vW;
varying float vFade;
varying float vH;
varying float vSeed;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float ndl = dot(N, uSunDir);
  float wrap = smoothstep(-0.45, 0.85, ndl);
  float h = vH;
  vec3 amb = uShade * (0.62 + 0.38 * N.y) * mix(0.72, 1.08, h);
  vec3 col = amb + uLit * wrap * mix(0.62, 1.05, h);
  float facing = max(dot(N, V), 0.0);
  float rim = pow(1.0 - facing, 2.5);
  float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
  col += uLit * rim * (0.18 + 1.2 * back) * (0.5 + 0.5 * h);
  col *= 0.94 + 0.12 * vSeed;
  col *= mix(1.0, 0.42, uDark);
  col += uFlash * (0.6 + 0.4 * h);
  float a = vFade * uOpacity;
  a *= mix(0.5, 1.0, smoothstep(0.0, 0.45, facing));
  // never let a cloud sit in the camera's face
  a *= smoothstep(uNearFade * 0.35, uNearFade, distance(cameraPosition, vW));
  gl_FragColor = vec4(col, a);
}
`;

const SPLAT_VERT = /* glsl */ `
attribute vec4 aCloud;
varying vec2 vUv;
varying float vFade;
void main() {
  vUv = uv * 2.0 - 1.0;
  vFade = aCloud.x;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const SPLAT_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vFade;
void main() {
  float r = length(vUv);
  float a = (1.0 - smoothstep(0.25, 1.0, r)) * vFade;
  gl_FragColor = vec4(a, a, a, a);
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
    const q = game.pipeline?.quality || 'high';
    const count = q === 'low' ? 18 : q === 'medium' ? 26 : 34;
    const rnd = mulberry32(9137);
    this.clouds = [];
    let puffTotal = 0;
    for (let i = 0; i < count; i++) {
      const c = {
        x: this.field.x0 + rnd() * this.field.sx,
        z: this.field.z0 + rnd() * this.field.sz,
        y: 40 + rnd() * 10,
        size: 7 + Math.pow(rnd(), 1.6) * 13,
        rank: (i + rnd() * 0.8) / count, // presence threshold vs cover
        seed: rnd(),
        puffs: [],
        presence: 0,
        stretch: 1.2 + rnd() * 0.9,
        rot: rnd() * Math.PI,
      };
      const n = 5 + Math.floor(rnd() * 6 + c.size / 5);
      for (let p = 0; p < n; p++) {
        const t = n === 1 ? 0 : p / (n - 1) - 0.5; // along the long axis
        const along = t * c.size * 0.95 * c.stretch;
        const side = (rnd() - 0.5) * c.size * 0.55;
        const centrality = 1 - Math.abs(t) * 1.5;
        const r = c.size * (0.26 + 0.24 * centrality + 0.12 * rnd());
        c.puffs.push({
          ox: along,
          oz: side,
          oy: r * (0.15 + 0.45 * centrality * rnd()),
          r,
          sy: 0.78 + rnd() * 0.2,
        });
      }
      // a couple of crown puffs on top for the cumulus tower
      const crowns = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < crowns; k++) {
        const r = c.size * (0.22 + 0.14 * rnd());
        c.puffs.push({ ox: (rnd() - 0.5) * c.size * 0.6, oz: (rnd() - 0.5) * c.size * 0.3, oy: c.size * (0.28 + 0.2 * rnd()), r, sy: 0.9 });
      }
      c.thickness = c.size * 0.75;
      puffTotal += c.puffs.length;
      this.clouds.push(c);
    }
    this.puffTotal = puffTotal;

    const detail = q === 'low' ? 1 : 2;
    const geo = new THREE.IcosahedronGeometry(1, detail);
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(puffTotal * 4), 4);
    attr.setUsage(THREE.DynamicDrawUsage);
    this.attr = attr;
    geo.setAttribute('aCloud', attr);

    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uLit: { value: new THREE.Color(1, 1, 1) },
      uShade: { value: new THREE.Color(0.6, 0.65, 0.8) },
      uFlash: { value: new THREE.Color(0, 0, 0) },
      uDark: { value: 0 },
      uOpacity: { value: 1 },
      uNearFade: { value: 40 },
    };
    this.prepassMat = new THREE.ShaderMaterial({
      name: 'CloudDepth',
      uniforms: this.uniforms,
      vertexShader: CLOUD_VERT,
      fragmentShader: 'void main(){ gl_FragColor = vec4(0.0); }',
      defines: { PREPASS: 1 },
      colorWrite: false,
      depthWrite: true,
      transparent: true,
    });
    this.material = new THREE.ShaderMaterial({
      name: 'Cloud',
      uniforms: this.uniforms,
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      transparent: true,
      depthWrite: false,
      depthFunc: THREE.LessEqualDepth,
    });
    this.prepass = new THREE.InstancedMesh(geo, this.prepassMat, puffTotal);
    this.mesh = new THREE.InstancedMesh(geo, this.material, puffTotal);
    for (const m of [this.prepass, this.mesh]) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = false;
      m.receiveShadow = false;
    }
    this.prepass.instanceMatrix = this.mesh.instanceMatrix; // share
    this.prepass.renderOrder = 10;
    this.mesh.renderOrder = 11;
    this.group = new THREE.Group();
    this.group.name = 'clouds';
    this.group.add(this.prepass, this.mesh);
    game.scene.add(this.group);

    // ---- coverage (shadow) map -------------------------------------------
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
    const quad = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    quad.setAttribute('aCloud', attr);
    this.splatMesh = new THREE.InstancedMesh(
      quad,
      new THREE.ShaderMaterial({
        vertexShader: SPLAT_VERT,
        fragmentShader: SPLAT_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.CustomBlending,
        blendEquation: THREE.MaxEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
      }),
      puffTotal,
    );
    this.splatMesh.frustumCulled = false;
    this.splatMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.splatScene.add(this.splatMesh);
    const f = this.field;
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
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._shadowTimer = 0;
  }

  update(dt, model, weather, env) {
    const game = this.game;
    const rig = game.cameraRig;
    const f = this.field;
    // drift with the wind (world units / real second)
    const sp = 1.2 + 5.5 * env.wind.strength;
    this.drift.x += env.wind.x * sp * dt;
    this.drift.y += env.wind.z * sp * dt;

    const cover = weather.cover;
    const grow = 1 + 0.35 * weather.storm + 0.15 * weather.overcast;
    const arr = this.attr.array;
    let k = 0;
    const camDist = rig.cur.dist;
    for (const c of this.clouds) {
      const target = THREE.MathUtils.smoothstep(cover, c.rank - 0.06, c.rank + 0.06);
      // smooth birth / dissolve
      c.presence += (target - c.presence) * Math.min(1, dt * 0.35);
      let x = c.x + this.drift.x;
      let z = c.z + this.drift.y;
      x = f.x0 + ((((x - f.x0) % f.sx) + f.sx) % f.sx);
      z = f.z0 + ((((z - f.z0) % f.sz) + f.sz) % f.sz);
      // fade near the wrap boundary so wrapping never pops
      const ex = Math.min(x - f.x0, f.x0 + f.sx - x) / 50;
      const ez = Math.min(z - f.z0, f.z0 + f.sz - z) / 50;
      const edge = THREE.MathUtils.clamp(Math.min(ex, ez), 0, 1);
      const pres = c.presence * edge;
      const scale = (0.55 + 0.45 * Math.sqrt(c.presence)) * grow;
      const cs = Math.cos(c.rot),
        sn = Math.sin(c.rot);
      const base = c.y - c.size * 0.12;
      for (const p of c.puffs) {
        const px = x + (p.ox * cs - p.oz * sn) * scale;
        const pz = z + (p.ox * sn + p.oz * cs) * scale;
        const py = c.y + p.oy * scale;
        const r = p.r * scale;
        this._p.set(px, py, pz);
        this._s.set(r, r * p.sy, r);
        this._m.compose(this._p, this._q.identity(), this._s);
        this.mesh.setMatrixAt(k, this._m);
        // splat quad: footprint slightly larger than the puff
        this._s.set(r * 1.35, 1, r * 1.35);
        this._m.compose(this._p, this._q, this._s);
        this.splatMesh.setMatrixAt(k, this._m);
        arr[k * 4] = pres;
        arr[k * 4 + 1] = base;
        arr[k * 4 + 2] = c.thickness * scale;
        arr[k * 4 + 3] = c.seed;
        k++;
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.splatMesh.instanceMatrix.needsUpdate = true;
    this.attr.needsUpdate = true;

    // lighting
    const u = this.uniforms;
    u.uSunDir.value.copy(model.keyIsMoon ? model.keyDir : model.sunDir);
    if (u.uSunDir.value.y < 0.05) u.uSunDir.value.y = 0.05;
    u.uSunDir.value.normalize();
    // Clouds are lit by the sun even a little after it set (they are high up)
    u.uLit.value.copy(model.cloudLit);
    u.uShade.value.copy(model.cloudShade);
    u.uDark.value = Math.min(1, weather.storm * 0.9 + weather.overcast * 0.35);
    const flash = env.lightning || 0;
    u.uFlash.value.setRGB(0.9, 0.95, 1.2).multiplyScalar(flash * 1.4);
    // visibility: hidden when close, prominent when zoomed out
    const vis = THREE.MathUtils.smoothstep(camDist, 62, 150);
    u.uOpacity.value = vis * (0.82 + 0.13 * weather.overcast);
    u.uNearFade.value = 45 + camDist * 0.25;
    this.group.visible = vis > 0.01;

    // cloud shadow parameters: project along the sun to the ground
    const sd = model.sunDir;
    const sy = Math.max(0.35, sd.y);
    const alt = 44;
    const P = this.shadow.params;
    P.x = -f.x0 + (sd.x / sy) * alt;
    P.y = -f.z0 + (sd.z / sy) * alt;
    P.z = 1 / f.sx;
    P.w = 0.42 * THREE.MathUtils.smoothstep(sd.y, 0.04, 0.3) * (1 - 0.65 * weather.overcast) * (model.keyIsMoon ? 0 : 1);
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
