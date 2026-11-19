import * as THREE from 'three';
import { AIR_KINDS } from '../../sim/fleet/kinds.js';
import { smokePuff, RAMP } from '../fx/Effects.js';
import { VEHICLE } from '../../core/scale.js';
import { geoWrapOn } from '../../world/geo.js';

// The air layer of the Fleets renderer (docs/MODERN-ERAS.md): aircraft and
// rockets of game.fleet.air draw through the fleet's batched multi-draw
// (FleetRenderer VehicleBatch) with their own models (airModels.js): banking
// on turns, pitching on the climb and the descent, propellers and rotors
// spinning, navigation lights at night, a small shadow on the ground beneath
// them and contrails behind jets at mid zoom. Rockets climb on a bright
// plume and a trail of smoke and drop their boosters. game.fleet.orbit's
// satellites and the orbital station are moving points of light in the
// night sky (one draw call), and a solar storm hangs auroras over the world
// (one more, only while it lasts).

// rockets read as a spectacle and a landmark at the launch pad: a rocket
// stands about as tall as the pad's service tower (three houses), not a house
const ROCKET_SCALE = 2.6;
const SEAM = 30;
const TRAIL_MAX = 34;

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class AirLayer {
  constructor(game, fr) {
    this.game = game;
    this.fr = fr;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YZX');
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._white = new THREE.Color(1, 1, 1);
    this.trails = new Map(); // flight id -> [x, y, z, ...] behind a jet
    this.trailList = [];
    this._fxT = 0;
    // satellites and the station: points of light, sized per point
    const N = 96;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(N), 1).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(N), 1).setUsage(THREE.DynamicDrawUsage));
    this.sky = { uTime: { value: 0 }, uAlpha: { value: 0 }, uTumble: { value: 0 }, uPx: { value: 1 } };
    this.points = new THREE.Points(
      pg,
      new THREE.ShaderMaterial({
        uniforms: this.sky,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        vertexShader: /* glsl */ `
attribute float aSize;
attribute float aSeed;
uniform float uTime;
uniform float uTumble;
uniform float uPx;
varying float vA;
varying float vSeed;
void main() {
  vSeed = aSeed;
  // a satellite glints as it turns; in a solar storm they tumble and flicker
  float glint = 0.75 + 0.25 * sin(uTime * (1.3 + aSeed * 2.0) + aSeed * 40.0);
  float tumble = mix(1.0, step(0.45, fract(uTime * (2.0 + aSeed * 5.0) + aSeed * 9.0)), uTumble);
  vA = glint * tumble;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPx;
}`,
        fragmentShader: /* glsl */ `
uniform float uAlpha;
uniform float uTumble;
varying float vA;
varying float vSeed;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r = dot(d, d);
  if (r > 1.0) discard;
  float core = exp(-r * 5.0);
  vec3 col = mix(vec3(1.0, 0.97, 0.88), vec3(0.75, 1.0, 0.85), uTumble * step(0.5, vSeed));
  gl_FragColor = vec4(col * (0.4 + 1.6 * core), core * uAlpha * vA);
}`,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.points.visible = false;
    this.points.name = 'orbit-lights';
    fr.group.add(this.points);
    this._pN = N;
    this._aurora = null;
  }

  // ------------------------------------------------------------------ per frame
  update(night, dt = 1 / 60) {
    const g = this.game;
    const F = g.fleet;
    const rig = g.cameraRig;
    this.sky.uTime.value = this.fr.t;
    const storm = F?.solarStormLevel?.() ?? 0;
    this.sky.uTumble.value = storm;
    this.sky.uPx.value = Math.min(2, g.pipeline?.renderer?.getPixelRatio?.() ?? 1);
    // satellites: points that sweep across the sky over the land, kept round
    // the camera (the sky is far away: it moves with the eye, not the land)
    const orbit = F?.orbit || [];
    const pos = this.points.geometry.attributes.position,
      size = this.points.geometry.attributes.aSize,
      seed = this.points.geometry.attributes.aSeed;
    const cx = rig?.cur?.x ?? g.world.w / 2,
      cz = rig?.cur?.z ?? g.world.h / 2,
      dist = rig?.cur?.dist ?? 80;
    const gy = Math.max(0, g.world.heightAt(cx, cz));
    let m = 0;
    if (night > 0.05) {
      for (const o of orbit) {
        if (m >= this._pN) break;
        const R = dist * (0.9 + o.r * 1.4) + 20;
        const x = cx + Math.cos(o.a) * R,
          z = cz + Math.sin(o.a) * R * Math.cos(o.tilt) * 0.8;
        const y = gy + dist * (0.42 + 0.12 * Math.sin(o.tilt * 2.3)) + 14 + Math.sin(o.a) * Math.sin(o.tilt) * R * 0.15;
        pos.setXYZ(m, x, y, z);
        size.setX(m, o.kind === 'station' ? 6.5 : 3.4);
        seed.setX(m, (o.id * 0.6180339) % 1);
        m++;
      }
    }
    this.points.geometry.setDrawRange(0, m);
    pos.needsUpdate = size.needsUpdate = seed.needsUpdate = true;
    this.sky.uAlpha.value = Math.min(1, night * 1.5);
    this.points.visible = m > 0;
    this._auroraUpdate(storm, night, cx, cz, dist, gy);
    void dt;
  }

  // Aircraft and rockets into the fleet's batch; shadows and contrails.
  collect(vb, C, far, dist, cx, cz, viewR) {
    const g = this.game;
    const F = g.fleet;
    const air = F?.air || [];
    this.trailList.length = 0;
    if (!air.length) {
      if (this.trails.size) this.trails.clear();
      return;
    }
    const alpha = C.alpha;
    const W = g.world;
    const wrapW = geoWrapOn(W) ? W.w : 0;
    const trailsOn = !far && dist > 30 && dist < 175 && !g.settings?.powerSaver;
    const t = this.fr.t;
    const fxOn = !far && !g.paused && g.fx?.emit && dist < 160;
    let fxBudget = (this._fxT -= 1 / 60) <= 0 ? ((this._fxT = 0.08), 6) : 0;
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (const f of air) {
      if (!f.alive) continue;
      const x = f.px + (f.x - f.px) * alpha,
        y = f.py + (f.y - f.py) * alpha,
        z = f.pz + (f.z - f.pz) * alpha;
      const twins = wrapW && (x < SEAM || x > wrapW - SEAM) ? [0, x < SEAM ? wrapW : -wrapW] : [0];
      for (const off of twins) {
        const X = x + off;
        if (far || Math.abs(X - cx) > viewR || Math.abs(z - cz) > viewR) continue;
        // seam: the twin fades in as the craft fades out (by size)
        const fade = wrapW ? Math.min(1, Math.max(0.05, Math.min(X, wrapW - X) / SEAM + 0.05)) : 1;
        this._put(vb, f, X, y, z, alpha, fade, C);
      }
      // a rocket's smoke trail and the fire at the pad
      if (fxOn && f.cls === 'space' && fxBudget > 0 && (f.thrust ?? 0) > 0.05 && Math.abs(x - cx) < viewR * 1.2 && Math.abs(z - cz) < viewR * 1.2) {
        const s = (f.def?.scale || VEHICLE.air) * ROCKET_SCALE;
        const by = y - (f.stageV === 1 ? 0.05 : 0.15) * s;
        for (let i = g.fx.k(1); i > 0; i--) smokePuff(g.fx, x + (Math.random() - 0.5) * 0.2, by, z + (Math.random() - 0.5) * 0.2, { size: 0.35 + (f.kind === 'starship' ? 0.3 : 0), ramp: RAMP.SMOKE_LIGHT, rise: 0.15, drift: 0.6, drag: 1.2, grow: 3.4, life: 4 + Math.random() * 3, lit: 1, alpha: 0.75 });
        const ground = Math.max(0, W.heightAt(f.from?.x ?? x, f.from?.z ?? z));
        if (y - ground < 4) {
          g.fx.emit('fire', { x, y: ground + 0.2, z }, { scale: 0.9 });
          for (let i = g.fx.k(2); i > 0; i--) smokePuff(g.fx, x + (Math.random() - 0.5) * 2.2, ground + 0.2, z + (Math.random() - 0.5) * 2.2, { size: 0.6, ramp: RAMP.SMOKE_LIGHT, rise: 0.25, drift: 1.6, drag: 0.8, grow: 3, life: 5 + Math.random() * 3, lit: 1, alpha: 0.7 });
        }
        fxBudget--;
      }
      // jets lay contrails at height
      if (trailsOn && f.def?.jet && f.phase === 'cruise') {
        seen.add(f.id);
        let T = this.trails.get(f.id);
        if (!T) this.trails.set(f.id, (T = []));
        const n = T.length;
        if (!n || Math.hypot(x - T[n - 3], z - T[n - 1]) > 0.7) {
          if (n && Math.hypot(x - T[n - 3], z - T[n - 1]) > 8) T.length = 0;
          T.push(x, y, z);
          if (T.length > TRAIL_MAX * 3) T.splice(0, 3);
        }
        this.trailList.push({ T, x, y, z, w: f.kind === 'airliner' ? 0.08 : 0.05 });
      }
    }
    if (this.trails.size) for (const id of this.trails.keys()) if (!seen.has(id)) this.trails.delete(id);
    void t;
  }

  _put(vb, f, x, y, z, alpha, fade, C) {
    const def = f.def || AIR_KINDS[f.kind];
    const kc = this.fr._kingdomColor(f.kingdom);
    if (f.cls === 'space') {
      const s = (def.scale || VEHICLE.air) * ROCKET_SCALE * fade;
      // a rocket leans downrange as it climbs; a returning booster stands upright
      this._e.set(0, -(f.heading || 0), -(f.tilt || 0), 'YZX');
      this._q.setFromEuler(this._e);
      this._m.compose(this._p.set(x, y, z), this._q, this._s.setScalar(s));
      vb.push(f.kind === 'starship' ? 'starship' : 'rocket', this._m, kc, 0, 0, 0, 0, 0, 0, f.thrust ?? 0, f.stageV ?? 0);
      return;
    }
    // bank into the turn, pitch with the climb or the descent
    const h = lerpAngle(f.ph ?? f.heading, f.heading, alpha);
    const turn = f.turnRate || 0;
    f._bank = (f._bank || 0) + (Math.max(-0.6, Math.min(0.6, -turn * 0.9)) - (f._bank || 0)) * 0.1;
    const vy = f.vy || 0;
    const pitch = def.vtol ? Math.max(-0.12, Math.min(0.12, (f.speedNow || 0) * 0.02)) * -1 : Math.max(-0.25, Math.min(0.3, vy * 0.08));
    this._e.set(f._bank, -h, pitch, 'YZX');
    this._q.setFromEuler(this._e);
    const s = (def.scale || VEHICLE.air) * fade;
    this._m.compose(this._p.set(x, y, z), this._q, this._s.setScalar(s));
    const flying = f.phase !== 'parked';
    const spin = flying ? 1 : 0.15;
    vb.push(f.kind, this._m, kc, f.seed * 6.28, this.fr.t * 40 * spin, 0, spin, 0, f.burning || 0, 0, 0);
    // a small shadow on the ground (fainter the higher it flies)
    const ground = this.game.world.heightAt(x, z);
    const above = y - Math.max(0, ground);
    if (above < 40) C.blobList.push(x + 0.15 * above * 0.05, z + 0.1 * above * 0.05, (def.length || 0.6) * Math.max(0.5, 1.1 - above * 0.02), h);
  }

  // ------------------------------------------------------------------ aurora
  // Curtains of green and violet light hung in the sky while a solar storm
  // lasts (strongest at night), kept round the camera like the satellites.
  _auroraUpdate(storm, night, cx, cz, dist, gy) {
    const a = storm * (0.25 + 0.75 * night);
    if (a < 0.01) {
      if (this._aurora) this._aurora.visible = false;
      return;
    }
    if (!this._aurora) this._aurora = this._makeAurora();
    const A = this._aurora;
    A.visible = true;
    A.material.uniforms.uAlpha.value = a;
    A.material.uniforms.uTime.value = this.fr.t;
    const rig = this.game.cameraRig;
    const yaw = rig?.cur?.yaw ?? 0; // radians: the eye sits at +(sin, cos) from its target
    // ahead of the eye: beyond the camera's target, high over the land
    const fx = -Math.sin(yaw),
      fz = -Math.cos(yaw);
    A.position.set(cx + fx * dist * 0.9, gy + dist * 0.38, cz + fz * dist * 0.9);
    A.rotation.set(0, yaw, 0);
    A.scale.setScalar(dist * 1.6 + 40);
  }
  _makeAurora() {
    // three wavy curtains, each a strip of quads (unit size; scaled per frame)
    const P = [],
      UV = [];
    for (let c = 0; c < 3; c++) {
      const z0 = -0.15 + c * 0.16,
        N = 40;
      for (let i = 0; i < N; i++) {
        const u0 = i / N,
          u1 = (i + 1) / N;
        const x0 = (u0 - 0.5) * 1.6,
          x1 = (u1 - 0.5) * 1.6;
        const w0 = Math.sin(u0 * 9 + c * 2) * 0.05,
          w1 = Math.sin(u1 * 9 + c * 2) * 0.05;
        const h = 0.22 + c * 0.05;
        const q = [
          [x0, 0, z0 + w0, u0, 0],
          [x1, 0, z0 + w1, u1, 0],
          [x1, h, z0 + w1 * 1.3, u1, 1],
          [x0, 0, z0 + w0, u0, 0],
          [x1, h, z0 + w1 * 1.3, u1, 1],
          [x0, h, z0 + w0 * 1.3, u0, 1],
        ];
        for (const v of q) {
          P.push(v[0], v[1], v[2]);
          UV.push(v[3] + c * 0.37, v[4]);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  float u = vUv.x, v = vUv.y;
  float rays = 0.55 + 0.45 * sin(u * 70.0 + sin(u * 13.0 + uTime * 0.7) * 4.0 + uTime * 1.3);
  float drift = 0.6 + 0.4 * sin(u * 6.0 - uTime * 0.35);
  float base = smoothstep(0.0, 0.15, v) * (1.0 - smoothstep(0.35, 1.0, v));
  vec3 col = mix(vec3(0.15, 1.0, 0.45), vec3(0.65, 0.3, 1.0), smoothstep(0.35, 0.95, v));
  float a = base * rays * drift * uAlpha * smoothstep(0.0, 0.08, fract(u)) * smoothstep(1.0, 0.92, fract(u));
  gl_FragColor = vec4(col * a * 1.6, a);
}`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.name = 'aurora';
    this.fr.group.add(mesh);
    return mesh;
  }
}
