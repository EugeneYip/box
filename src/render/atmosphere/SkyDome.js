import * as THREE from 'three';
import { SKY_UNIFORMS_GLSL, SKY_FUNCS_GLSL } from './shaders/skyChunk.js';

// Procedural sky dome: gradient + horizon glow + sun disc and halo, moon with
// true phase lighting, twinkling star field with a faint galactic band, and a
// distant cloud deck near the horizon. A second copy of the material (env
// mode: no discs, earthy lower hemisphere) is captured into a PMREM so every
// MeshStandardMaterial in the world is lit and reflects the same sky.

const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
  return s;
}
`;

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
  gl_Position.z = p.w * 0.99999;
}
`;

const FRAG = /* glsl */ `
${SKY_UNIFORMS_GLSL}
uniform vec3 uSunDisc;
uniform float uSunVis;
uniform vec3 uMoonColor;
uniform float uMoonVis;
uniform float uStarVis;
uniform float uTime;
uniform mat3 uStarRot;
uniform float uFlash;
uniform float uCover;
uniform float uOvercast;
uniform float uStorm;
uniform vec2 uCloudOffset;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uEnvMode;
uniform vec3 uEnvGround;
uniform float uDetail;
varying vec3 vDir;
${SKY_FUNCS_GLSL}
${NOISE_GLSL}

vec3 starField(vec3 d) {
  // cube-face projection keeps the cells roughly square everywhere
  vec3 a = abs(d);
  vec2 uv; float face;
  if (a.x > a.y && a.x > a.z) { uv = d.yz / a.x; face = sign(d.x); }
  else if (a.y > a.z) { uv = d.xz / a.y; face = 2.0 + sign(d.y); }
  else { uv = d.xy / a.z; face = 4.0 + sign(d.z); }
  vec3 col = vec3(0.0);
  for (int layer = 0; layer < 2; layer++) {
    float N = layer == 0 ? 70.0 : 150.0;
    vec2 g = uv * N + face * 17.0;
    vec2 id = floor(g);
    vec2 f = fract(g);
    float h = hash12(id + float(layer) * 31.0);
    float thresh = layer == 0 ? 0.9 : 0.8;
    if (h > thresh) {
      vec2 o = 0.2 + 0.6 * hash22(id + 7.0);
      float px = max(fwidth(g.x), 1e-4);
      float d2 = length(f - o) / px;   // distance in pixels
      float mag = pow(fract(h * 91.7), 3.0);
      float b = exp(-d2 * d2 * 0.9) * (layer == 0 ? (0.6 + 2.4 * mag) : (0.25 + 0.6 * mag));
      float tw = 0.7 + 0.3 * sin(uTime * (1.5 + 4.0 * fract(h * 13.1)) + h * 60.0);
      vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.86, 0.7), fract(h * 47.3));
      col += tint * b * tw;
    }
  }
  return col;
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 col = skyBase(dir);
  float y = dir.y;

  if (uEnvMode > 0.5) {
    // IBL capture: the lower hemisphere is the land, not haze. The sun's
    // tight halo is left out (specular sun glints come from the key light).
    float muE = max(dot(dir, uSunDir), 0.0);
    col -= uHalo * (pow(muE, 48.0) * 0.55 + pow(muE, 600.0) * 1.6) * 0.85;
    col = mix(max(col, 0.0), uEnvGround, smoothstep(0.02, -0.25, y));
    col += vec3(0.55, 0.65, 0.9) * uFlash * 0.6;
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  // ---- night sky -------------------------------------------------------
  if (uDetail > 0.5 && uStarVis > 0.001 && y > -0.05) {
    vec3 sd = uStarRot * dir;
    float horizonFade = smoothstep(-0.02, 0.18, y);
    vec3 st = starField(sd);
    // faint galactic band
    vec3 bandN = normalize(vec3(0.35, 0.25, 0.9));
    float bd = dot(sd, bandN);
    float band = exp(-bd * bd * 30.0);
    vec2 bp = vec2(atan(sd.z, sd.x) * 3.0, sd.y * 6.0);
    float milky = band * (0.35 + 0.65 * fbm(bp * 1.7)) * (0.6 + 0.4 * fbm(bp * 4.0 + 3.0));
    col += (st * (1.0 + band * 1.5) * 0.9 + vec3(0.32, 0.36, 0.55) * milky * 0.09) * uStarVis * horizonFade;
  }

  // ---- moon ---------------------------------------------------------------
  if (uDetail > 0.5 && uMoonVis > 0.001) {
    float mu = dot(dir, uMoonDir);
    float R = 0.032; // angular radius (stylised: larger than life)
    vec3 t1 = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    vec3 t2 = cross(t1, uMoonDir);
    vec2 q = vec2(dot(dir, t1), dot(dir, t2)) / R;
    float r2 = dot(q, q);
    float aa = fwidth(length(q)) * 1.5 + 1e-4;
    float inside = (1.0 - smoothstep(1.0 - aa, 1.0 + aa, sqrt(r2))) * step(0.0, mu);
    vec3 glowM = uMoonColor * (pow(max(mu, 0.0), 2200.0) * 0.35 + pow(max(mu, 0.0), 160.0) * 0.06 + pow(max(mu, 0.0), 12.0) * 0.015);
    col += glowM * uMoonVis;
    if (inside > 0.0) {
      vec3 n = normalize(q.x * t1 + q.y * t2 - uMoonDir * sqrt(max(0.0, 1.0 - r2)));
      float lit = smoothstep(-0.08, 0.2, dot(n, uSunDir));
      float maria = fbm(q * 2.2 + 4.0);
      float albedo = 0.72 - 0.28 * smoothstep(0.45, 0.7, maria) + 0.06 * vnoise(q * 9.0);
      vec3 disc = uMoonColor * albedo * (0.06 + 0.94 * lit) * 2.6;
      col = mix(col, disc + col * 0.15, inside * uMoonVis);
    }
  }

  // ---- distant cloud deck (seen only from low camera angles) -----------
  if (uDetail > 0.5 && y > -0.02) {
    float h = max(y, 0.0);
    vec2 p = dir.xz / (h + 0.09) * 1.1 + uCloudOffset;
    float n = fbm(p * 0.9);
    float cov = clamp(uCover * 0.8 + uOvercast * 0.35 + 0.12, 0.0, 1.0);
    float c = smoothstep(1.0 - cov * 0.95 - 0.05, 1.12 - cov * 0.55, n);
    c *= smoothstep(-0.01, 0.06, y) * (1.0 - smoothstep(0.25, 0.6, y));
    float shade = smoothstep(0.35, 0.95, fbm(p * 0.9 + vec2(0.35, 0.2)));
    float sunSide = pow(max(dot(normalize(dir.xz + 1e-4), normalize(uSunDir.xz + 1e-4)) * 0.5 + 0.5, 0.0), 3.0);
    // toward the sun the bank reads as a dark silhouette with a golden rim,
    // away from it as sunlit cumulus
    vec3 litC = uCloudLit * 1.15 + uCloudShade * 0.55;
    vec3 darkC = uCloudShade * 0.6 + uCloudLit * 0.12;
    vec3 cc = mix(litC, darkC, sunSide * 0.8);
    cc = mix(cc, uCloudShade * 0.55, shade * 0.45);
    cc += uGlow * sunSide * (1.0 - smoothstep(0.0, 0.5, c)) * 1.4;
    cc = mix(cc, uHorizon, smoothstep(0.08, 0.0, y) * 0.6); // aerial fade
    cc *= mix(1.0, 0.55, uStorm);
    col = mix(col, cc, c * 0.85);
  }

  // ---- sun disc -----------------------------------------------------------
  if (uSunVis > 0.001) {
    float mu = dot(dir, uSunDir);
    float ang = acos(clamp(mu, -1.0, 1.0));
    float R = 0.028;
    float aa = fwidth(ang) * 1.5 + 1e-5;
    float disc = 1.0 - smoothstep(R - aa, R + aa, ang);
    float limb = 0.75 + 0.25 * sqrt(max(0.0, 1.0 - (ang / R) * (ang / R)));
    col += uSunDisc * disc * limb * uSunVis * smoothstep(-0.03, 0.01, y);
  }

  col += vec3(0.55, 0.62, 0.85) * uFlash * (0.35 + 0.65 * uOvercast);
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

export class SkyDome {
  constructor(atmosphere) {
    this.atm = atmosphere;
    const game = atmosphere.game;
    this.game = game;
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() },
      uBelt: { value: new THREE.Color() },
      uHalo: { value: new THREE.Color() },
      uGroundHaze: { value: new THREE.Color() },
      uGlowWidth: { value: 2.5 },
      uSunDisc: { value: new THREE.Color() },
      uSunVis: { value: 1 },
      uMoonColor: { value: new THREE.Color(0.8, 0.86, 1.0) },
      uMoonVis: { value: 0 },
      uStarVis: { value: 0 },
      uTime: { value: 0 },
      uStarRot: { value: new THREE.Matrix3() },
      uFlash: { value: 0 },
      uCover: { value: 0.3 },
      uOvercast: { value: 0 },
      uStorm: { value: 0 },
      uCloudOffset: { value: new THREE.Vector2() },
      uCloudLit: { value: new THREE.Color() },
      uCloudShade: { value: new THREE.Color() },
      uEnvMode: { value: 0 },
      uEnvGround: { value: new THREE.Color() },
      uDetail: { value: 1 },
    };
    const geo = new THREE.SphereGeometry(1, 48, 24);
    this.material = new THREE.ShaderMaterial({
      name: 'SkyDome',
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      // Writes a depth just in front of the far plane (window depth
      // 0.999995) instead of leaving the cleared 1.0: N8AO's half-res
      // composite treats depth == 1.0 as fully occluded (black sky).
      // LinearDepthPass maps this depth back to "sky".
      depthWrite: true,
      depthTest: true,
      depthFunc: THREE.AlwaysDepth,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.onBeforeRender = (r, s, cam) => {
      // keep the dome centred on whichever camera is drawing it this instant
      this.mesh.position.setFromMatrixPosition(cam.matrixWorld);
      this.mesh.updateMatrixWorld();
      // first draw of the main pass: three's shadow pass has just run
      if (cam === game.cameraRig?.camera) this.atm.shadowCache?.composite(r);
    };
    game.scene.add(this.mesh);

    // environment capture scene
    const envUniforms = { ...this.uniforms, uEnvMode: { value: 1 } };
    this.envMaterial = new THREE.ShaderMaterial({
      name: 'SkyEnv',
      uniforms: envUniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.envScene = new THREE.Scene();
    const envMesh = new THREE.Mesh(geo, this.envMaterial);
    envMesh.scale.setScalar(10);
    envMesh.frustumCulled = false;
    this.envScene.add(envMesh);
    this.pmrem = null;
    this.envRT = null;
    this._envSig = null;
    this._envTimer = 0;
    this._starAxis = new THREE.Vector3(0.25, 0.92, -0.3).normalize();
    this._m4 = new THREE.Matrix4();
  }

  sync(model, weather, dt, time) {
    const u = this.uniforms;
    u.uSunDir.value.copy(model.sunDir);
    u.uMoonDir.value.copy(model.moonDir);
    u.uZenith.value.copy(model.zenith);
    u.uHorizon.value.copy(model.horizon);
    u.uGlow.value.copy(model.glow);
    u.uBelt.value.copy(model.belt);
    u.uHalo.value.copy(model.halo);
    u.uGroundHaze.value.copy(model.groundHaze);
    u.uSunDisc.value.copy(model.sunDisc);
    u.uSunVis.value = model.sunVis;
    u.uMoonVis.value = model.moonVis;
    u.uStarVis.value = model.starVis;
    u.uTime.value = time;
    u.uCover.value = weather.cover;
    u.uOvercast.value = weather.overcast;
    u.uStorm.value = weather.storm;
    u.uCloudLit.value.copy(model.cloudLit);
    u.uCloudShade.value.copy(model.cloudShade);
    u.uEnvGround.value.copy(model.envGround);
    // stars, moon and the distant cloud deck only matter when the horizon can show
    u.uDetail.value = this.game.settings?.powerSaver || (this.game.view?.zoom01 ?? 0) > 0.6 ? 0 : 1;
    // the celestial sphere turns with the hour
    const hour = this.game.time.hour + (this.game.time.day || 0) * 24;
    this._m4.makeRotationAxis(this._starAxis, (hour / 24) * Math.PI * 2);
    u.uStarRot.value.setFromMatrix4(this._m4);
  }

  // Regenerate the IBL environment when the sky has changed noticeably.
  updateEnvironment(renderer, scene, dt, force = false) {
    this._envTimer -= dt;
    const u = this.uniforms;
    const sig = [u.uZenith.value, u.uHorizon.value, u.uGlow.value, u.uEnvGround.value, u.uHalo.value];
    let delta = 0;
    if (this._envSig) {
      for (let i = 0; i < sig.length; i++) {
        const c = sig[i],
          p = this._envSig[i];
        delta += Math.abs(c.r - p.r) + Math.abs(c.g - p.g) + Math.abs(c.b - p.b);
      }
      delta += this._sunPrev.distanceTo(u.uSunDir.value) * 0.5;
    }
    if (!force && this._envSig && (this._envTimer > 0 || delta < 0.015)) return;
    try {
      if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(renderer);
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 100);
      scene.environment = rt.texture;
      this.envRT?.dispose();
      this.envRT = rt;
      this._envSig = sig.map((c) => c.clone());
      this._sunPrev = u.uSunDir.value.clone();
      this._envTimer = 1.2;
    } catch (err) {
      console.warn('[atmosphere] environment capture failed', err);
      this._envTimer = 1e9;
    }
  }
}
