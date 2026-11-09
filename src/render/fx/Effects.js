import * as THREE from 'three';
import { createParticleAtlas, createRampTexture, createDecalAtlas, PF, DF, RAMP } from './FxTextures.js';
import { HeightField } from './HeightField.js';
import { ParticleLayer, ParticleSpec } from './ParticleLayer.js';
import { Decals } from './Decals.js';
import { Debris, TRAIL } from './Debris.js';
import { Beams } from './Beams.js';
import { LightPool } from './Lights.js';
import { PRESETS, flame, ember, sparks, glowFlash, _smokePuff as smokePuff, dustPuff } from './presets.js';
import { FireVisuals } from './FireVisuals.js';

// Effects & particles.
//
// PUBLIC CONTRACT (other modules call these; keep the signatures stable):
//   game.fx.emit(type, pos, opts?)       one-shot effect at a world position
//       pos = {x, y?, z}  (y defaults to the surface height)
//       types: 'smoke' 'fire' 'embers' 'explosion' 'dust' 'splash' 'sparkle'
//              'blood' 'debris' 'heal' 'spawn' 'lightning' 'steam' 'magic'
//              'leaves' 'snowpuff' 'build' 'death'
//              (extras: 'flame' 'sparks' 'shockwave' 'miasma' 'ash'
//               'lavaPop' 'fireball')
//       opts: { scale=1, count, color, dir:{x,y,z}, duration }
//             duration > 0 turns the call into a continuous emitter for that
//             many seconds (opts.rate = emissions per second, default 8).
//   game.fx.burst(type, pos, count, opts?)   convenience: emit many
//   game.fx.addLight(pos, color, intensity, duration)  transient point light
//   game.fx.screenFlash(color, intensity)      brief full-screen flash
// All calls are cheap no-ops when an effect type is unknown.
//
// Additional helpers (additive, used by disasters; safe for others to use):
//   fx.decal({frame, x, z, size, life, color, additive, ...})  ground decal
//   fx.shockwave(x, z, radius, opts)    expanding ground ring + air shell
//   fx.shell(x, y, z, radius, opts)     expanding fresnel dome
//   fx.beams.bolt(x0,y0,z0, x1,y1,z1, opts)  jagged lightning bolt
//   fx.debris.spawn({...})              physical 3D debris chunk
//   fx.lights.request(key, x,y,z, color, intensity, range)  per-frame light
//   fx.shake(x, z, amount)              camera shake attenuated by distance
//
// Timing: particles animate on real time (fx.time) so they look the same at
// 1x and 16x game speed and keep moving while paused.

const SHELL_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const SHELL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uPower;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPower);
  vec3 c = uColor * f * uAlpha;
  gl_FragColor = vec4(1.0 - exp(-c), 1.0);
#include <colorspace_fragment>
}`;

const FLASH_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  vec2 d = vUv - 0.5;
  float vign = 1.0 - dot(d, d) * 0.8;
  gl_FragColor = vec4(uColor * uAlpha * vign, 1.0);
#include <colorspace_fragment>
}`;

export class Effects {
  constructor(game) {
    this.game = game;
    this.time = 0;
    this.budget = 1;
    this.saver = false;
    this.tinyOK = true;
    this.P = new ParticleSpec();
    this.wind = { x: 0, z: 0 };
    this._tmpC = new THREE.Color();
    this._v3 = new THREE.Vector3();
    this.emitters = [];
    this.uniforms = {
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector3() },
      uNear: { value: 0.5 },
      uSunView: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Color(1, 1, 1) },
      uAmbient: { value: new THREE.Color(0.5, 0.55, 0.6) },
      uPL: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, -1000, 0, 1)) },
      uPLC: { value: Array.from({ length: 6 }, () => new THREE.Vector3()) },
      uPLOn: { value: 1 },
    };
    this.textures = {
      atlas: createParticleAtlas(),
      ramp: createRampTexture(),
      decals: createDecalAtlas(),
    };
    this.heightField = new HeightField(game);
    this.smoke = new ParticleLayer(this, { capacity: 12000, renderOrder: 20, name: 'fx-smoke' });
    this.glow = new ParticleLayer(this, { capacity: 9000, renderOrder: 22, name: 'fx-glow' });
    this.decals = new Decals(this);
    this.debris = new Debris(this);
    this.beams = new Beams(this);
    this.lights = new LightPool(this);
    this.fire = new FireVisuals(this);
    const scene = game.scene;
    scene.add(this.smoke.mesh, this.glow.mesh, this.beams.mesh);
    this.decals.addTo(scene);
    this._initShells();
    this._initFlash();
    this.presets = PRESETS;
  }

  // ---- internal particle commit --------------------------------------------
  pSmoke() {
    this.smoke.spawn(this.P, this.time);
  }
  pGlow() {
    this.glow.spawn(this.P, this.time);
  }
  // Budget-scaled count with stochastic rounding.
  k(n) {
    const v = n * this.budget;
    const f = Math.floor(v);
    return f + (Math.random() < v - f ? 1 : 0);
  }

  // ---- public contract --------------------------------------------------------
  emit(type, pos, opts = {}) {
    const fn = this.presets[type];
    if (!fn || !pos) return;
    try {
      const p = { x: pos.x, y: pos.y ?? this.game.world.surfaceAt(pos.x, pos.z), z: pos.z };
      if (opts.duration > 0) {
        const { duration, ...rest } = opts;
        this.emitters.push({ fn, p, opts: rest, until: this.time + duration, rate: opts.rate ?? 8, acc: 0 });
        if (this.emitters.length > 64) this.emitters.shift();
        return;
      }
      fn(this, p, opts);
    } catch (err) {
      console.error('[fx] emit', type, err);
    }
  }
  burst(type, pos, count = 8, opts = {}) {
    for (let i = 0; i < count; i++) this.emit(type, pos, opts);
  }
  addLight(pos, color = 0xffaa55, intensity = 1, duration = 0.5) {
    if (!pos) return;
    this.lights.transient(pos, color, intensity, duration);
  }
  screenFlash(color = 0xffffff, intensity = 1) {
    // prefer the post pipeline's HDR flash (it also nudges exposure)
    if (typeof this.game.pipeline?.flash === 'function') {
      try {
        this.game.pipeline.flash(color, intensity * 0.6);
        return;
      } catch (e) {
        /* fall back to our overlay */
      }
    }
    this._tmpC.set(color);
    const f = this.flash;
    // combine with any running flash
    f.color.lerp(this._tmpC, f.alpha > 0 ? 0.5 : 1);
    f.alpha = Math.min(1.2, Math.max(f.alpha, 0.65 * intensity));
  }

  // ---- extra helpers ------------------------------------------------------------
  // Brief hit-stop: effects and disaster set pieces nearly freeze for `s`
  // real seconds so big impacts land with weight.
  hitStop(s = 0.08) {
    this._hitStop = Math.max(this._hitStop || 0, s);
  }
  decal(d) {
    this.decals.spawn(d);
  }
  shake(x, z, amount) {
    const rig = this.game.cameraRig;
    if (!rig?.addShake) return;
    const d = Math.hypot(x - rig.cur.x, z - rig.cur.z);
    const f = Math.max(0, 1 - d / Math.max(40, rig.cur.dist * 1.6));
    if (f > 0) rig.addShake(amount * f);
  }
  shockwave(x, z, radius, o = {}) {
    const y = this.game.world.surfaceAt(x, z);
    this.decal({ frame: DF.RING, x, z, size: radius * 0.25, grow: 4, life: o.life ?? 0.7, additive: true, surface: 2, color: o.color ?? 0xffe2b0, intensity: o.intensity ?? 1.6, fadeIn: 0.01, fadeOut: 0.15, grain: 0 });
    this.decal({ frame: DF.RING, x, z, size: radius * 0.2, grow: 5, life: (o.life ?? 0.7) * 1.4, color: 0x8a7a68, alpha: 0.35, fadeIn: 0.01, fadeOut: 0.1, grain: 0 });
    if (o.shell === true) this.shell(x, y, z, radius * 0.7, { life: (o.life ?? 0.7) * 0.6, color: o.color ?? 0xffe8c8, intensity: 0.9, power: 4 });
    // ground-hugging dust wall
    const n = this.k(Math.min(40, 10 + radius * 3));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.2;
      const gx = x + Math.cos(a) * radius * 0.15,
        gz = z + Math.sin(a) * radius * 0.15;
      dustPuff(this, gx, this.game.world.surfaceAt(gx, gz), gz, 0.25 + radius * 0.09, { ang: a, out: radius * (1.6 + Math.random() * 0.8), drag: 2.2, life: 1.2 + Math.random() * 1.2, up: 0.5, ramp: y <= 0.05 ? RAMP.SPLASH : RAMP.DUST });
    }
  }
  shell(x, y, z, radius, o = {}) {
    const s = this.shells.find((s) => s.t >= s.life) || this.shells[0];
    s.mesh.position.set(x, y, z);
    s.t = 0;
    s.life = o.life ?? 0.5;
    s.r0 = radius * (o.from ?? 0.1);
    s.r1 = radius;
    s.mesh.material.uniforms.uColor.value.set(o.color ?? 0xffe8c8).multiplyScalar(o.intensity ?? 2.2);
    s.mesh.material.uniforms.uPower.value = o.power ?? 3;
    s.mesh.scale.set(1, o.squash ?? 0.55, 1);
    s.mesh.visible = true;
  }

  // Trails used by debris (smoke behind rocks, fire behind lava bombs).
  _trail(kind, x, y, z, vx, vy, vz, size, heat) {
    if (kind === TRAIL.DUST) {
      if (Math.random() < 0.5) smokePuff(this, x, y, z, { size: 0.35 + size * 0.5, ramp: RAMP.DUST, rise: 0.2, life: 1.2 + Math.random(), drift: 1 });
    } else if (kind === TRAIL.FIRE || kind === TRAIL.LAVA) {
      if (heat > 0.15) {
        const P = this.P.reset();
        P.x = x;
        P.y = y;
        P.z = z;
        P.vx = vx * 0.1;
        P.vy = vy * 0.1 + 0.3;
        P.vz = vz * 0.1;
        P.ty = 0.8;
        P.drag = 2;
        P.life = 0.35 + Math.random() * 0.25;
        P.s0 = (0.35 + size * 0.9) * (0.5 + heat * 0.7);
        P.s1 = P.s0 * 0.3;
        P.frame = PF.SMOKE0 + ((Math.random() * 4) | 0);
        P.rot = Math.random() * 6.28;
        P.ramp = RAMP.EXPLOSION;
        P.heat = 0.2;
        P.bright = 2.6 * heat + 0.4;
        P.add = 1;
        P.soft = 0.1;
        this.pGlow();
      }
      if (kind !== TRAIL.LAVA || Math.random() < 0.35) smokePuff(this, x, y, z, { size: 0.3 + size * 0.7, ramp: heat > 0.3 ? RAMP.HOT_SMOKE : RAMP.SMOKE_DARK, rise: 0.4, life: 1.6 + Math.random() * 1.4, drift: 1.4, glow: heat * 0.8, vx: -vx * 0.05, vz: -vz * 0.05 });
    } else if (kind === TRAIL.LEAF) {
      if (Math.random() < 0.25) this.emit('leaves', { x, y: y - 0.8, z }, { count: 1, scale: 0.8 });
    }
  }

  // ---- shells & flash ---------------------------------------------------------
  _initShells() {
    const geo = new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.55);
    this.shells = [];
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uPower: { value: 3 } },
        vertexShader: SHELL_VERT,
        fragmentShader: SHELL_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        toneMapped: false,
      });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = 24;
      this.game.scene.add(m);
      this.shells.push({ mesh: m, t: 1, life: 1, r0: 0, r1: 1 });
    }
  }
  _updateShells(dt) {
    for (const s of this.shells) {
      if (!s.mesh.visible) continue;
      s.t += dt;
      const t = s.t / s.life;
      if (t >= 1) {
        s.mesh.visible = false;
        continue;
      }
      const e = 1 - Math.pow(1 - t, 2.4);
      const r = s.r0 + (s.r1 - s.r0) * e;
      const sy = s.mesh.scale.y / Math.max(1e-6, s.mesh.scale.x);
      s.mesh.scale.set(r, r * sy, r);
      s.mesh.material.uniforms.uAlpha.value = Math.pow(1 - t, 1.6);
    }
  }
  _initFlash() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uAlpha: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: FLASH_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      toneMapped: false,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    m.frustumCulled = false;
    m.renderOrder = 10000;
    m.visible = false;
    this.game.scene.add(m);
    this.flash = { mesh: m, color: mat.uniforms.uColor.value, alpha: 0 };
  }

  // ---- frame update -----------------------------------------------------------
  reset() {
    this.smoke.clear();
    this.glow.clear();
    this.decals.clear();
    this.debris.clear();
    this.beams.clear();
    this.lights.clear();
    this.emitters.length = 0;
    this.heightField.reset();
    this.fire.reset?.();
  }

  update(dt) {
    const g = this.game;
    if (this._hitStop > 0) {
      this._hitStop -= dt;
      dt *= 0.04;
    }
    this.time += dt;
    const U = this.uniforms;
    U.uTime.value = this.time;
    const w = g.env.wind || { x: 0, z: 0, strength: 0 };
    const ws = (w.strength ?? 0.3) * 2.4;
    this.wind.x = (w.x || 0) * ws;
    this.wind.z = (w.z || 0) * ws;
    U.uWind.value.set(this.wind.x * 0.12, 0, this.wind.z * 0.12);
    const cam = g.cameraRig.camera;
    U.uNear.value = cam.near;
    // level of detail: power saver + far zoom shed the cheapest-to-lose work
    this.saver = !!g.settings?.powerSaver;
    const z01 = g.view?.zoom01 ?? 0.5;
    this.tinyOK = z01 < 0.55; // tiny sparks / embers / glints are invisible beyond this
    U.uPLOn.value = this.saver ? 0 : 1;
    this.lights.setMax(this.saver ? 3 : 6);
    this._updateLighting(cam);
    this.heightField.update(dt);

    // particle budget: back off emission as layers fill up
    if ((g.frame & 7) === 0) {
      const ls = this.smoke.countLive(this.time) / this.smoke.capacity;
      const lg = this.glow.countLive(this.time) / this.glow.capacity;
      // power saver halves the particle budget (effective capacity and rate)
      const fill = Math.max(ls, lg) * (this.saver ? 2 : 1);
      this.budget = THREE.MathUtils.clamp((0.95 - fill) / 0.35, 0.08, 1) * (this.saver ? 0.5 : 1);
    }

    // continuous emitters
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      if (this.time > e.until) {
        this.emitters.splice(i, 1);
        continue;
      }
      e.acc += dt * e.rate;
      while (e.acc >= 1) {
        e.acc -= 1;
        try {
          e.fn(this, e.p, e.opts);
        } catch (err) {
          console.error('[fx] emitter', err);
          e.until = 0;
          break;
        }
      }
    }

    // disaster visuals are driven from here (Disasters is a sim-only system)
    try {
      g.disasters?.frame?.(dt);
    } catch (err) {
      console.error('[fx] disasters.frame', err);
    }
    try {
      this.fire.update(dt);
    } catch (err) {
      console.error('[fx] fire visuals', err);
    }
    this.debris.update(dt);
    this._updateShells(dt);
    // flash
    const f = this.flash;
    if (f.alpha > 0.001) {
      f.mesh.visible = true;
      f.mesh.material.uniforms.uAlpha.value = Math.min(1, f.alpha);
      f.alpha *= Math.exp(-dt * 7);
    } else {
      f.alpha = 0;
      f.mesh.visible = false;
    }
    this.lights.update(dt);
    this.decals.update();
    this.beams.update();
    this.smoke.flush();
    this.glow.flush();
  }

  _updateLighting(cam) {
    const env = this.game.env;
    const U = this.uniforms;
    const day = env.daylight ?? 1;
    // sun direction in view space
    const v = this._v3.copy(env.sunDir || { x: 0.5, y: 0.8, z: 0.3 }).transformDirection(cam.matrixWorldInverse);
    U.uSunView.value.copy(v);
    const sc = env.sunColor || { r: 1, g: 0.96, b: 0.9 };
    const lightning = env.lightning || 0;
    U.uSunCol.value.setRGB(sc.r, sc.g, sc.b).multiplyScalar(0.12 + 1.25 * day);
    const sky = this.game.scene.fog?.color || this.game.scene.background;
    const amb = U.uAmbient.value;
    if (sky && sky.isColor) amb.copy(sky).multiplyScalar(0.25 + 0.35 * day);
    else amb.setRGB(0.4, 0.45, 0.5).multiplyScalar(0.25 + 0.35 * day);
    amb.r += 0.05 + lightning * 0.6;
    amb.g += 0.06 + lightning * 0.65;
    amb.b += 0.1 + lightning * 0.8;
  }

}

export { PF, DF, RAMP, TRAIL, flame, ember, sparks, glowFlash, smokePuff, dustPuff };
