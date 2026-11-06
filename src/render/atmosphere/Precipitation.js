import * as THREE from 'three';
import { mulberry32 } from './util.js';

// Rain streaks, ground splashes and snow flakes.
//
// Drops live in a world-anchored repeating volume that is re-centred between
// the camera and its target every frame and scaled with the zoom, so the
// on-screen density is constant from close-ups to the full-map view and
// panning never drags the rain along with the camera. All motion happens in
// the vertex shader; the CPU only advances a wrapped offset.

const RAIN_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec3 uOffset;
uniform vec3 uVel;
uniform float uLen;
uniform float uWidth;
uniform float uPix;
uniform float uAmount;
uniform float uNear;
varying float vA;
varying vec2 vQ;
void main() {
  vec3 cell = aSeed.xyz * uBox + uOffset;
  vec3 rel = fract((cell - uCenter) / uBox + 0.5) - 0.5;
  vec3 head = uCenter + rel * uBox;
  float isOn = step(aSeed.w, uAmount);
  vec3 v = normalize(uVel);
  float len = uLen * (0.6 + 0.8 * fract(aSeed.w * 13.7));
  vec3 p = head - v * len * position.y;
  vec3 toCam = cameraPosition - p;
  float dist = length(toCam);
  vec3 side = normalize(cross(v, toCam / max(dist, 1e-3)));
  float minW = dist * uPix * 0.9;
  float w = max(uWidth, minW);
  p += side * position.x * w;
  vec3 e = smoothstep(vec3(0.5), vec3(0.36), abs(rel));
  vA = e.x * e.y * e.z * isOn * smoothstep(uNear * 0.4, uNear, dist) * clamp(uWidth / minW, 0.35, 1.0);
  vQ = position.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const RAIN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vA;
varying vec2 vQ;
void main() {
  float side = 1.0 - vQ.x * vQ.x;
  float along = (1.0 - vQ.y) * smoothstep(0.0, 0.12, vQ.y + 0.02);
  float a = vA * uOpacity * side * (0.25 + 0.75 * along);
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

const SNOW_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec3 uOffset;
uniform float uSize;
uniform float uPix;
uniform float uAmount;
uniform float uTime;
uniform float uNear;
varying float vA;
varying vec2 vQ;
void main() {
  vec3 cell = aSeed.xyz * uBox + uOffset;
  float ph = aSeed.w * 40.0;
  cell.x += sin(uTime * (0.6 + aSeed.w) + ph) * uBox.y * 0.012;
  cell.z += cos(uTime * (0.5 + aSeed.w * 0.7) + ph * 1.3) * uBox.y * 0.012;
  vec3 rel = fract((cell - uCenter) / uBox + 0.5) - 0.5;
  vec3 c = uCenter + rel * uBox;
  float isOn = step(aSeed.w, uAmount);
  vec4 mv = viewMatrix * vec4(c, 1.0);
  float dist = -mv.z;
  float s = uSize * (0.6 + 0.8 * fract(aSeed.w * 7.31));
  float minS = dist * uPix * 1.8;
  float sz = max(s, minS);
  mv.xy += position.xy * sz;
  vec3 e = smoothstep(vec3(0.5), vec3(0.36), abs(rel));
  vA = e.x * e.y * e.z * isOn * smoothstep(uNear * 0.4, uNear, dist) * clamp(s / minS, 0.3, 1.0);
  vQ = position.xy;
  gl_Position = projectionMatrix * mv;
}
`;
const SNOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vA;
varying vec2 vQ;
void main() {
  float r = length(vQ);
  float a = vA * uOpacity * (1.0 - smoothstep(0.35, 1.0, r));
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * (1.0 + 0.25 * (1.0 - r)), a);
}
`;

const SPLASH_VERT = /* glsl */ `
attribute vec4 aSplash; // xyz position, w birth time
uniform float uTime;
uniform float uLife;
uniform float uSize;
varying vec2 vQ;
varying float vT;
void main() {
  float t = (uTime - aSplash.w) / uLife;
  vT = t;
  vQ = position.xz;
  vec3 p = aSplash.xyz + vec3(position.x, 0.0, position.z) * uSize * (0.35 + 0.9 * clamp(t, 0.0, 1.0));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const SPLASH_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vQ;
varying float vT;
void main() {
  if (vT < 0.0 || vT > 1.0) discard;
  float r = length(vQ);
  float ring = smoothstep(0.62, 0.86, r) * (1.0 - smoothstep(0.86, 1.0, r));
  float core = (1.0 - smoothstep(0.0, 0.3, r)) * (1.0 - smoothstep(0.0, 0.35, vT));
  float a = (ring * (1.0 - vT) + core * 0.8) * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

function makeQuadInstances(count, seed) {
  const g = new THREE.InstancedBufferGeometry();
  // corners: x = side (-1..1), y = along (0..1) for rain; billboard uses xy in [-1,1]
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
  g.setIndex([0, 2, 1, 2, 3, 1]);
  const rnd = mulberry32(seed);
  const a = new Float32Array(count * 4);
  for (let i = 0; i < a.length; i++) a[i] = rnd();
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(a, 4));
  g.instanceCount = count;
  return g;
}

export class Precipitation {
  constructor(atmosphere) {
    this.atm = atmosphere;
    const game = atmosphere.game;
    this.game = game;
    const q = game.pipeline?.quality || 'high';
    const rainN = q === 'low' ? 3500 : q === 'medium' ? 6000 : 9000;
    const snowN = q === 'low' ? 3000 : q === 'medium' ? 5000 : 7500;

    const common = () => ({
      uCenter: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(40, 30, 40) },
      uOffset: { value: new THREE.Vector3() },
      uPix: { value: 0.001 },
      uAmount: { value: 0 },
      uColor: { value: new THREE.Color(0.7, 0.75, 0.8) },
      uOpacity: { value: 0.4 },
      uNear: { value: 4 },
    });
    this.rainU = { ...common(), uVel: { value: new THREE.Vector3(0.2, -1, 0.1) }, uLen: { value: 0.8 }, uWidth: { value: 0.02 } };
    this.rain = new THREE.Mesh(
      makeQuadInstances(rainN, 77),
      new THREE.ShaderMaterial({ name: 'Rain', uniforms: this.rainU, vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    // billboard corners for snow: remap rain quad (y 0..1) to (-1..1)
    const sg = makeQuadInstances(snowN, 91);
    sg.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
    this.snowU = { ...common(), uSize: { value: 0.06 }, uTime: { value: 0 } };
    this.snow = new THREE.Mesh(
      sg,
      new THREE.ShaderMaterial({ name: 'Snow', uniforms: this.snowU, vertexShader: SNOW_VERT, fragmentShader: SNOW_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );

    // ground splashes (close-up only)
    this.splashN = q === 'low' ? 120 : 320;
    const spg = new THREE.InstancedBufferGeometry();
    spg.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, -1, 0, 1, 1, 0, 1], 3));
    spg.setIndex([0, 2, 1, 2, 3, 1]);
    this.splashAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.splashN * 4), 4);
    this.splashAttr.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.splashN; i++) this.splashAttr.array[i * 4 + 3] = -100;
    spg.setAttribute('aSplash', this.splashAttr);
    spg.instanceCount = this.splashN;
    this.splashU = {
      uTime: { value: 0 },
      uLife: { value: 0.42 },
      uSize: { value: 0.12 },
      uColor: { value: new THREE.Color(0.8, 0.85, 0.9) },
      uOpacity: { value: 0.5 },
    };
    this.splash = new THREE.Mesh(
      spg,
      new THREE.ShaderMaterial({
        name: 'RainSplash',
        uniforms: this.splashU,
        vertexShader: SPLASH_VERT,
        fragmentShader: SPLASH_FRAG,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    this._splashT = 0;
    this._splashI = 0;
    this._rnd = mulberry32(4242);

    for (const m of [this.rain, this.snow, this.splash]) {
      m.frustumCulled = false;
      m.renderOrder = 20;
      m.visible = false;
      game.scene.add(m);
    }
    this.rainOffset = new THREE.Vector3();
    this.snowOffset = new THREE.Vector3();
    this._c = new THREE.Vector3();
  }

  update(dt, time, weather, env, model) {
    const game = this.game;
    const rig = game.cameraRig;
    const cam = rig.camera;
    const D = rig.cur.dist;
    const pipe = game.pipeline;
    const h = pipe?.size?.y || innerHeight;
    const pix = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / h;

    // volume between the lens and the ground, sized to the view
    const center = this._c.copy(rig.target).lerp(cam.position, 0.42);
    const boxW = 18 + D * 1.75;
    const boxH = 10 + D * 1.05;
    const lum = model.hemiSky.r * 0.3 + model.hemiSky.g * 0.59 + model.hemiSky.b * 0.11;
    const ambient = Math.min(1.4, model.hemiIntensity * lum * 1.1 + model.keyIntensity * 0.06);
    const flash = env.lightning || 0;

    // ---- rain --------------------------------------------------------
    const rain = weather.rain;
    this.rain.visible = rain > 0.01;
    if (this.rain.visible) {
      const u = this.rainU;
      const fall = 14 + D * 1.15;
      const wind = env.wind;
      const slant = 0.08 + 0.22 * wind.strength;
      u.uVel.value.set(wind.x * fall * slant, -fall, wind.z * fall * slant);
      this.rainOffset.addScaledVector(u.uVel.value, dt);
      u.uBox.value.set(boxW, boxH, boxW);
      wrapOffset(this.rainOffset, u.uBox.value);
      u.uOffset.value.copy(this.rainOffset);
      u.uCenter.value.copy(center);
      u.uLen.value = 0.35 + D * 0.03;
      u.uWidth.value = 0.008 + D * 0.0003;
      u.uNear.value = 2 + D * 0.3;
      u.uPix.value = pix;
      u.uAmount.value = 0.15 + 0.85 * rain;
      const c = u.uColor.value;
      c.setRGB(0.6, 0.66, 0.74).multiplyScalar(0.4 + 0.5 * ambient).addScalar(flash * 0.25);
      u.uOpacity.value = 0.1 + 0.12 * rain;
    }

    // ---- splashes ------------------------------------------------------
    const showSplash = rain > 0.15 && D < 75;
    this.splash.visible = showSplash;
    this.splashU.uTime.value = time;
    if (showSplash) {
      const world = game.world;
      const span = 6 + D * 0.85;
      const rate = this.splashN / this.splashU.uLife.value * Math.min(1, rain * 1.3);
      this._splashT += dt * rate;
      const arr = this.splashAttr.array;
      let n = Math.min(this.splashN, Math.floor(this._splashT));
      this._splashT -= n;
      const tx = rig.target.x,
        tz = rig.target.z;
      // bias spawns toward the lower (nearer) half of the screen
      const yaw = rig.cur.yaw;
      const fx = Math.sin(yaw),
        fz = Math.cos(yaw);
      while (n-- > 0) {
        const i = this._splashI;
        this._splashI = (this._splashI + 1) % this.splashN;
        const r1 = this._rnd() - 0.5,
          r2 = this._rnd() - 0.35;
        const x = tx + (r1 * fz + r2 * fx) * span * 1.4;
        const z = tz + (-r1 * fx + r2 * fz) * span * 1.4;
        if (x < 0 || z < 0 || x > world.w || z > world.h) {
          arr[i * 4 + 3] = -100;
          continue;
        }
        arr[i * 4] = x;
        arr[i * 4 + 1] = world.surfaceAt(x, z) + 0.03;
        arr[i * 4 + 2] = z;
        arr[i * 4 + 3] = time - this._rnd() * 0.05;
      }
      this.splashAttr.needsUpdate = true;
      this.splashU.uSize.value = 0.08 + D * 0.004;
      this.splashU.uOpacity.value = 0.55 * Math.min(1, rain * 1.4) * THREE.MathUtils.smoothstep(D, 75, 40);
      this.splashU.uColor.value.copy(this.rainU.uColor.value).multiplyScalar(1.1);
    }

    // ---- snow ----------------------------------------------------------
    const snow = weather.snow;
    this.snow.visible = snow > 0.01;
    if (this.snow.visible) {
      const u = this.snowU;
      const fall = 1.3 + D * 0.09;
      const wind = env.wind;
      const drift = fall * (0.25 + 0.9 * wind.strength);
      this.snowOffset.x += wind.x * drift * dt;
      this.snowOffset.z += wind.z * drift * dt;
      this.snowOffset.y -= fall * dt;
      u.uBox.value.set(boxW, boxH, boxW);
      wrapOffset(this.snowOffset, u.uBox.value);
      u.uOffset.value.copy(this.snowOffset);
      u.uCenter.value.copy(center);
      u.uSize.value = 0.06 + D * 0.0026;
      u.uNear.value = 2 + D * 0.32;
      u.uPix.value = pix;
      u.uTime.value = time;
      u.uAmount.value = 0.1 + 0.9 * snow;
      u.uColor.value.setRGB(0.92, 0.95, 1.0).multiplyScalar(0.35 + 0.75 * ambient).addScalar(flash * 0.6);
      u.uOpacity.value = 0.42 + 0.2 * snow;
    }
  }
}

function wrapOffset(o, box) {
  o.x = ((o.x % box.x) + box.x) % box.x;
  o.y = ((o.y % box.y) + box.y) % box.y;
  o.z = ((o.z % box.z) + box.z) % box.z;
}
