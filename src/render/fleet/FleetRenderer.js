import * as THREE from 'three';
import { vehicleModel, debrisGeometry, stoneGeometry, arrowGeometry } from './models.js';
import { createVehicleMaterial, createVehicleDepthMaterial, createWaterFxMaterial } from './materials.js';
import { bannerGeometry, bannerMaterial } from '../buildings/props.js';
import { emblemAtlas, EMBLEM_IDS, FIELD_IDS } from '../buildings/emblems.js';
import { ALL_KINDS, KINDS } from '../../sim/fleet/kinds.js';

// Draws game.fleet: one instanced batch per vehicle kind (sails, oars, wheels
// and legs animate in the vertex shader), realm flags with their emblems,
// wakes and bow waves, floating wreckage, catapult stones, faint trade lanes
// at mid zoom, and a dot per vehicle when the camera is far.
// Cheaper paths in power saver and at far zoom (see update()).

const TICK = 1 / 15;
const DETAIL_DIST = 175; // beyond this camera distance vehicles draw as dots
const FLAG_DIST = 115;
const WAKE_DIST = 165;
const BEAM = { fishing: 0.36, cog: 0.35, transport: 0.37, galley: 0.19, explorer: 0.27, carrack: 0.31 };

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class FleetRenderer {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'fleet';
    game.scene.add(this.group);
    this.t = 0;
    this.uniforms = { uTime: { value: 0 }, uNight: { value: 0 }, uLight: { value: 1 }, uLaneAlpha: { value: 0.5 }, uWind: { value: 0.35 }, uEmblems: { value: emblemAtlas() } };
    this.mat = createVehicleMaterial(this.uniforms);
    this.depthMat = createVehicleDepthMaterial(this.uniforms);
    this.batches = new Map();
    for (const kind of ALL_KINDS) this.batches.set(kind, { kind, model: null, mesh: null, cap: 0 });
    this._m = new THREE.Matrix4();
    this._m2 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YZX');
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._c = new THREE.Color();
    this._v = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._kcol = new Map();
    this._fxT = 0;
    this._laneT = 0;
    this._initProps();
  }

  reset() {
    this._laneT = 0;
  }

  _initProps() {
    // flags
    this.flagMat = bannerMaterial(this.uniforms);
    this.flags = this._inst(bannerGeometry('vale'), this.flagMat, 32);
    this.flags.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(32 * 3), 3);
    this._flagAttr(32);
    // wakes along each ship's track, hull foam and bow waves, contact shadows:
    // one dynamic mesh, one program, one draw call
    const FXV = 36000;
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FXV * 3), 3).setUsage(THREE.DynamicDrawUsage));
    fg.setAttribute('aUV', new THREE.BufferAttribute(new Float32Array(FXV * 2), 2).setUsage(THREE.DynamicDrawUsage));
    fg.setAttribute('aK', new THREE.BufferAttribute(new Float32Array(FXV * 4), 4).setUsage(THREE.DynamicDrawUsage));
    fg.setAttribute('aC', new THREE.BufferAttribute(new Float32Array(FXV * 3), 3).setUsage(THREE.DynamicDrawUsage));
    fg.setDrawRange(0, 0);
    this.fxMat = createWaterFxMaterial(this.uniforms);
    this.waterFx = new THREE.Mesh(fg, this.fxMat);
    this.waterFx.frustumCulled = false;
    this.waterFx.renderOrder = -4; // just after the water sheet
    this.waterFx.visible = false;
    this.group.add(this.waterFx);
    this._fxMax = FXV;
    this._hist = new Map(); // vessel id -> recent track [x, z, ...] (newest last)
    this._histT = 0;
    // wreckage and catapult stones
    this.propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    this.debris = this._inst(debrisGeometry(), this.propMat, 64);
    // stones, arrows and wreckage share one vertex-coloured material (one program)
    this.stones = this._inst(stoneGeometry(), this.propMat, 32);
    this.arrows = this._inst(arrowGeometry(), this.propMat, 64);
    // trade lanes (dashed, faint, mid zoom): the same water-fx program as lines
    const MAXV = 6000;
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXV * 3), 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('aC', new THREE.BufferAttribute(new Float32Array(MAXV * 3), 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('aUV', new THREE.BufferAttribute(new Float32Array(MAXV * 2), 2).setUsage(THREE.DynamicDrawUsage));
    const lk = new Float32Array(MAXV * 4);
    for (let i = 0; i < MAXV; i++) lk[i * 4] = 5;
    lg.setAttribute('aK', new THREE.BufferAttribute(lk, 4));
    lg.setDrawRange(0, 0);
    this.lanes = new THREE.LineSegments(lg, this.fxMat);
    this.lanes.frustumCulled = false;
    this.lanes.renderOrder = -3;
    this.lanes.visible = false;
    this.group.add(this.lanes);
    this._laneMax = MAXV;
  }

  _inst(geo, mat, cap) {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.castShadow = false;
    m.receiveShadow = false;
    m.count = 0;
    m.visible = false;
    this.group.add(m);
    return m;
  }

  _flagAttr(cap) {
    const ea = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2).fill(-1), 2);
    ea.setUsage(THREE.DynamicDrawUsage);
    this.flags.geometry.setAttribute('aEmblem', ea);
  }
  // grow an instanced prop mesh, keeping its extra attributes
  _growProp(name, n, extra) {
    const m = this[name];
    if (m.instanceMatrix.count >= n) return m;
    const cap = Math.ceil(n * 1.5);
    const nm = new THREE.InstancedMesh(m.geometry, m.material, cap);
    nm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    nm.frustumCulled = false;
    nm.renderOrder = m.renderOrder;
    nm.castShadow = m.castShadow;
    nm.receiveShadow = m.receiveShadow;
    if (m.instanceColor) nm.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.group.remove(m);
    m.dispose();
    this.group.add(nm);
    this[name] = nm;
    extra?.(cap);
    return nm;
  }

  // one batch per vehicle kind, with per-instance colour, animation and state
  _batch(kind, n) {
    const b = this.batches.get(kind);
    if (b.mesh && b.cap >= n) return b;
    if (!b.model) b.model = vehicleModel(kind);
    const cap = Math.max(8, Math.ceil(n * 1.5));
    const geo = new THREE.BufferGeometry();
    for (const k of Object.keys(b.model.geo.attributes)) geo.setAttribute(k, b.model.geo.attributes[k]);
    geo.boundingSphere = b.model.geo.boundingSphere;
    b.iColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    b.iAnim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    b.iState = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iColor', b.iColor);
    geo.setAttribute('iAnim', b.iAnim);
    geo.setAttribute('iState', b.iState);
    const mesh = new THREE.InstancedMesh(geo, this.mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    // cast through the shadow cache's dynamic pass (near the camera), with the
    // animated depth material below
    mesh.castShadow = !this.game.settings?.powerSaver;
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = this.depthMat;
    mesh.count = 0;
    mesh.name = 'fleet-' + kind;
    if (b.mesh) {
      this.group.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mesh.dispose();
    }
    b.mesh = mesh;
    b.cap = cap;
    this.group.add(mesh);
    return b;
  }

  _kingdomColor(kid) {
    const hex = this.game.civ?.kingdomColor?.(kid) ?? 0xd8c8a8;
    let c = this._kcol.get(hex);
    if (!c) {
      c = new THREE.Color(hex);
      this._kcol.set(hex, c);
    }
    return c;
  }

  // ------------------------------------------------------------------ frame
  update(dt) {
    const g = this.game;
    const F = g.fleet;
    if (!F) return;
    this.t += dt;
    const U = this.uniforms;
    U.uTime.value = this.t;
    const day = g.env?.daylight ?? 1;
    const night = 1 - THREE.MathUtils.smoothstep(day, 0.12, 0.62);
    U.uNight.value += (night - U.uNight.value) * Math.min(1, dt * 3);
    U.uLight.value = 0.25 + 0.75 * Math.min(1, day * 1.4);
    U.uWind.value = g.env?.wind?.strength ?? 0.35;
    const rig = g.cameraRig;
    const dist = rig?.cur?.dist ?? 80;
    const cx = rig?.cur?.x ?? 0,
      cz = rig?.cur?.z ?? 0;
    const ps = !!g.settings?.powerSaver;
    const far = !!g.view?.far || dist > DETAIL_DIST;
    const viewR = dist * 1.7 + 24;
    const alpha = g.paused ? 1 : Math.min(1, Math.max(0, (g._acc || 0) / (g.simStep || TICK)));
    const list = F.list;
    // ---- detailed vehicles
    const per = new Map();
    let visible = 0;
    if (!far) {
      for (const v of list) {
        if (!v.alive) continue;
        if (Math.abs(v.x - cx) > viewR || Math.abs(v.z - cz) > viewR) continue;
        let L = per.get(v.kind);
        if (!L) per.set(v.kind, (L = []));
        L.push(v);
        visible++;
      }
    }
    const flagsOn = !far && dist < (ps ? FLAG_DIST * 0.7 : FLAG_DIST);
    const wakesOn = !far && dist < (ps ? WAKE_DIST * 0.55 : WAKE_DIST);
    const flagList = [];
    const wakeList = [];
    const blobList = [];
    const st = F.storm?.() ?? 0;
    const wind = g.env?.wind || { x: 1, z: 0, strength: 0.3 };
    const W = g.world;
    for (const [kind, b] of this.batches) {
      const L = per.get(kind) || [];
      let n = L.length;
      if (kind === 'caravan') n *= 4;
      if (!n) {
        if (b.mesh) {
          b.mesh.count = 0;
          b.mesh.visible = false;
        }
        continue;
      }
      this._batch(kind, n);
      const mesh = b.mesh;
      const iC = b.iColor.array,
        iA = b.iAnim.array,
        iS = b.iState.array;
      let k = 0;
      for (const v of L) {
        const def = v.def;
        const x = v.px + (v.x - v.px) * alpha,
          z = v.pz + (v.z - v.pz) * alpha;
        const h = lerpAngle(v.ph ?? v.heading, v.heading, alpha);
        const kc = this._kingdomColor(v.kingdom);
        const dmg = Math.min(1, Math.max(0, 1 - v.hp / v.maxHp - 0.12) / 0.88);
        const a = v.anim;
        if (v.cls === 'sea') {
          const ph = this.t + v.seed * 20;
          const rough = 1 + st * 2.5;
          let y = Math.sin(ph * 1.5) * 0.025 * rough;
          let roll = Math.sin(ph * 1.1) * 0.03 * rough + (v.heading - (v.ph ?? v.heading)) * 1.5;
          let pitch = Math.sin(ph * 0.9 + 1) * 0.02 * rough;
          if (v.sink > 0) {
            const s = v.sink;
            y -= s * s * (def.length * 0.35 + 0.8);
            roll += s * 0.9 * (v.seed > 0.5 ? 1 : -1);
            pitch += s * 0.45 * (v.seed > 0.3 ? 1 : -1);
          }
          v.y = 0;
          this._e.set(roll, -h, pitch, 'YZX');
          this._q.setFromEuler(this._e);
          this._m.compose(this._p.set(x, y, z), this._q, this._s.setScalar(def.scale || 1));
          mesh.setMatrixAt(k, this._m);
          iC[k * 3] = kc.r;
          iC[k * 3 + 1] = kc.g;
          iC[k * 3 + 2] = kc.b;
          // which side the wind fills the fore-and-aft sails from
          const tack = Math.sign(Math.sin(h) * wind.x - Math.cos(h) * wind.z) || 1;
          iA[k * 4] = a.row;
          iA[k * 4 + 1] = tack;
          iA[k * 4 + 2] = 0;
          iA[k * 4 + 3] = a.fill * (1 - a.furl);
          iS[k * 4] = dmg;
          iS[k * 4 + 1] = v.burning;
          iS[k * 4 + 2] = a.furl;
          iS[k * 4 + 3] = a.oar;
          k++;
          if (flagsOn && b.model.flags.length && v.sink < 0.4) for (const f of b.model.flags) flagList.push({ f, m: this._m.clone(), v, h });
          if (wakesOn && v.speed > 0.06 && v.sink < 0.3 && (v.state === 'sail' || v.state === 'patrol' || v.speed > 0.3)) wakeList.push({ x, z, h, v, beam: BEAM[kind] || 0.3 });
        } else {
          // land: sit on the ground, tilt with the slope
          const y = W.heightAt(x, z);
          v.y = y;
          const c = Math.cos(h),
            s = Math.sin(h);
          const hl = def.length * 0.35;
          const pitch = Math.max(-0.35, Math.min(0.35, Math.atan2(W.heightAt(x + c * hl, z + s * hl) - W.heightAt(x - c * hl, z - s * hl), hl * 2)));
          const roll = Math.max(-0.25, Math.min(0.25, -Math.atan2(W.heightAt(x - s * 0.3, z + c * 0.3) - W.heightAt(x + s * 0.3, z - c * 0.3), 0.6) * 0.6));
          const put = (px, pz, ph, variant, py) => {
            this._e.set(roll, -ph, pitch, 'YZX');
            this._q.setFromEuler(this._e);
            this._m.compose(this._p.set(px, py ?? y, pz), this._q, this._s.setScalar(def.scale || 1));
            mesh.setMatrixAt(k, this._m);
            iC[k * 3] = kc.r;
            iC[k * 3 + 1] = kc.g;
            iC[k * 3 + 2] = kc.b;
            iA[k * 4] = a.walk + variant * 1.3;
            iA[k * 4 + 1] = a.wheel;
            iA[k * 4 + 2] = kind === 'catapult' ? Math.pow(a.arm, 0.35) * 2.0 : kind === 'ram' ? Math.sin(a.ram * Math.PI) * 0.28 : 0;
            iA[k * 4 + 3] = 0;
            iS[k * 4] = dmg;
            iS[k * 4 + 1] = v.burning || 0;
            iS[k * 4 + 2] = 0;
            iS[k * 4 + 3] = kind === 'oxcart' ? a.cargoType : variant;
            k++;
            blobList.push(px, pz, def.length * (kind === 'caravan' ? 0.9 : 1.1), ph);
          };
          if (kind === 'caravan') {
            const camel = a.cargoType === 2 ? 2 : 0;
            const T = v.trail;
            for (let i = 0; i < 4; i++) {
              const back = i * 0.9;
              const p = trailPoint(T, x, z, h, back);
              put(p.x, p.z, p.h, camel + (i === 0 ? 1 : 0), W.heightAt(p.x, p.z));
            }
          } else put(x, z, h, 0);
        }
      }
      mesh.count = k;
      mesh.visible = k > 0;
      mesh.instanceMatrix.needsUpdate = true;
      b.iColor.needsUpdate = true;
      b.iAnim.needsUpdate = true;
      b.iState.needsUpdate = true;
    }
    this._flags(flagList, flagsOn, wind);
    this._waterFxUpdate(wakeList, wakesOn, blobList, !far, dt, far ? { list, dist, cx, cz, R: viewR * 1.4 } : null);
    this._debris(F, !far, alpha);
    this._stones(F, alpha);
    this._shots(F, alpha, far);
    this._lanes(F, dt, dist, far);
    this._effects(F, dt, far, dist, cx, cz);
    this.visibleCount = visible;
  }

  _flags(L, on, wind) {
    let n = 0;
    if (on && L.length) {
      const mesh = this._growProp('flags', L.length, (cap) => this._flagAttr(cap));
      const civ = this.game.civ;
      const ea = mesh.geometry.getAttribute('aEmblem');
      for (const { f, m, v, h } of L) {
        this._p.set(f.x, f.y, f.z).applyMatrix4(m);
        // stream with the apparent wind (true wind minus the ship's way)
        const ax = (wind.x || 0) * (0.6 + (wind.strength ?? 0.3)) - Math.cos(h) * v.speed * 0.6,
          az = (wind.z || 0) * (0.6 + (wind.strength ?? 0.3)) - Math.sin(h) * v.speed * 0.6;
        const yaw = Math.atan2(az, ax);
        this._q.setFromAxisAngle(this._up, -yaw);
        const s = f.s * 1.05 * (v.def.scale || 1);
        this._m2.compose(this._p, this._q, this._s.set(s, s, s));
        mesh.setMatrixAt(n, this._m2);
        const kb = civ?.kingdoms?.[v.kingdom];
        mesh.setColorAt(n, this._c.setHex(kb?.color ?? 0xd8c8a8));
        const ban = kb?.banner;
        ea.setXY(n, ban ? EMBLEM_IDS.indexOf(ban.symbol) : -1, ban ? Math.max(0, FIELD_IDS.indexOf(ban.field)) : 0);
        n++;
      }
      ea.needsUpdate = true;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.flags.count = n;
    this.flags.visible = n > 0;
  }

  // Wakes laid along each ship's own track (a Kelvin V that bends with its
  // turns and fades within a few lengths), hull foam and a short bow wave,
  // and soft contact shadows under carts and engines.
  _waterFxUpdate(wakes, wakesOn, blobs, blobsOn, dt, dots = null) {
    const g = this.waterFx.geometry;
    const P = g.attributes.position.array,
      UV = g.attributes.aUV.array,
      K = g.attributes.aK.array,
      CC = g.attributes.aC.array;
    const max = this._fxMax - 6;
    let n = 0;
    let cr = 1,
      cg = 1,
      cb = 1;
    const vert = (x, y, z, u, v, kind, a, beam, s) => {
      CC[n * 3] = cr;
      CC[n * 3 + 1] = cg;
      CC[n * 3 + 2] = cb;
      P[n * 3] = x;
      P[n * 3 + 1] = y;
      P[n * 3 + 2] = z;
      UV[n * 2] = u;
      UV[n * 2 + 1] = v;
      K[n * 4] = kind;
      K[n * 4 + 1] = a;
      K[n * 4 + 2] = beam;
      K[n * 4 + 3] = s;
      n++;
    };
    const quad = (ax, az, bx, bz, cx, cz, dx, dz, ua, va, ub, vb, uc, vc, ud, vd, kind, aa, ab, beam, sa, sb, y = 0.02) => {
      vert(ax, y, az, ua, va, kind, aa, beam, sa);
      vert(bx, y, bz, ub, vb, kind, aa, beam, sa);
      vert(cx, y, cz, uc, vc, kind, ab, beam, sb);
      vert(ax, y, az, ua, va, kind, aa, beam, sa);
      vert(cx, y, cz, uc, vc, kind, ab, beam, sb);
      vert(dx, y, dz, ud, vd, kind, ab, beam, sb);
    };
    // track history (sampled as ships move)
    const H = this._hist;
    if ((this._histT -= dt) <= 0) {
      this._histT = 2;
      const F = this.game.fleet;
      for (const id of H.keys()) {
        const v = F.byId.get(id);
        if (!v || !v.alive || v.state === 'moored') H.delete(id);
      }
    }
    if (wakesOn) {
      for (const w of wakes) {
        const v = w.v;
        const L = v.def.length;
        let T = H.get(v.id);
        if (!T) H.set(v.id, (T = []));
        const lx = T[T.length - 2],
          lz = T[T.length - 1];
        if (lx == null || Math.hypot(w.x - lx, w.z - lz) > Math.max(0.15, L * 0.12)) {
          T.push(w.x, w.z);
          if (T.length > 64) T.splice(0, 2);
        }
        const spd = Math.min(1, v.speed / v.def.speed);
        const beam = (v.def.beam || 0.4) / L;
        const fx = Math.cos(w.h),
          fz = Math.sin(w.h);
        // hull foam and bow wave
        if (n < max) {
          const hl = L * 0.72,
            hw = (v.def.beam || 0.4) * 0.5 + L * 0.3;
          const px = -fz,
            pz = fx;
          const c0x = w.x - fx * L * 0.62,
            c0z = w.z - fz * L * 0.62;
          const c1x = w.x + fx * hl,
            c1z = w.z + fz * hl;
          quad(c0x + px * hw, c0z + pz * hw, c1x + px * hw, c1z + pz * hw, c1x - px * hw, c1z - pz * hw, c0x - px * hw, c0z - pz * hw, -0.62, hw / L, hl / L, hw / L, hl / L, -hw / L, -0.62, -hw / L, 2, spd, spd, beam, 0, 0, 0.022);
        }
        // the wake: walk back along the track from the stern
        const maxS = L * 3.2;
        let px0 = w.x - fx * L * 0.5,
          pz0 = w.z - fz * L * 0.5;
        let dirx = fx,
          dirz = fz;
        let s0 = 0;
        let prev = null;
        for (let i = T.length - 2; i >= -2 && s0 < maxS && n < max - 18; i -= 2) {
          let qx, qz;
          if (i >= 0) {
            qx = T[i];
            qz = T[i + 1];
            // points ahead of the stern are skipped
            if ((qx - px0) * fx + (qz - pz0) * fz > -0.05 && prev == null) continue;
          } else {
            // no more history: run straight back to finish the fade
            qx = px0 - dirx * (maxS - s0);
            qz = pz0 - dirz * (maxS - s0);
          }
          const sl = Math.hypot(qx - px0, qz - pz0);
          if (sl < 1e-3) continue;
          const ndx = (px0 - qx) / sl,
            ndz = (pz0 - qz) / sl;
          dirx = ndx;
          dirz = ndz;
          const s1 = Math.min(maxS, s0 + sl);
          const t1 = Math.min(1, (s1 - s0) / sl);
          const ex = px0 - ndx * sl * t1,
            ez = pz0 - ndz * sl * t1;
          const nx = -ndz,
            nz = ndx;
          const fade = (s) => Math.pow(Math.max(0, 1 - s / maxS), 2.4) * spd;
          const arm = (s) => (v.def.beam || 0.4) * 0.45 + s * 0.34;
          const bw = (s) => 0.07 + s * 0.11;
          const a0 = fade(s0),
            a1 = fade(s1);
          for (const side of [1, -1]) {
            const i0 = arm(s0) - bw(s0),
              o0 = arm(s0) + bw(s0),
              i1 = arm(s1) - bw(s1),
              o1 = arm(s1) + bw(s1);
            quad(px0 + nx * side * i0, pz0 + nz * side * i0, px0 + nx * side * o0, pz0 + nz * side * o0, ex + nx * side * o1, ez + nz * side * o1, ex + nx * side * i1, ez + nz * side * i1, s0, 0, s0, 1, s1, 1, s1, 0, 0, a0, a1, beam, s0, s1);
          }
          const cw0 = (v.def.beam || 0.4) * 0.3 + s0 * 0.08,
            cw1 = (v.def.beam || 0.4) * 0.3 + s1 * 0.08;
          quad(px0 + nx * cw0, pz0 + nz * cw0, px0 - nx * cw0, pz0 - nz * cw0, ex - nx * cw1, ez - nz * cw1, ex + nx * cw1, ez + nz * cw1, s0, 0, s0, 1, s1, 1, s1, 0, 1, a0 * (v.anim.oar > 0.3 ? 1 : 0.8), a1, beam, s0, s1);
          prev = [ex, ez];
          px0 = ex;
          pz0 = ez;
          s0 = s1;
        }
      }
    }
    if (blobsOn) {
      const W = this.game.world;
      for (let i = 0; i < blobs.length && n < max; i += 4) {
        const x = blobs[i],
          z = blobs[i + 1],
          sz = blobs[i + 2] * 0.5,
          h = blobs[i + 3];
        const c = Math.cos(h),
          s = Math.sin(h);
        const ax = c * sz,
          az = s * sz,
          bx = -s * sz * 0.6,
          bz = c * sz * 0.6;
        const y = W.heightAt(x, z) + 0.05;
        quad(x - ax - bx, z - az - bz, x + ax - bx, z + az - bz, x + ax + bx, z + az + bz, x - ax + bx, z - az + bz, 0, 0, 1, 0, 1, 1, 0, 1, 3, 1, 1, 0, 0, 0, y);
      }
    }
    // far zoom: a dot per craft in its realm's colour
    if (dots) {
      const W = this.game.world;
      const { list, dist, cx, cz, R } = dots;
      const base = Math.max(0.5, dist * 0.0068);
      for (const v of list) {
        if (n >= max) break;
        if (!v.alive || v.state === 'sinking') continue;
        if (Math.abs(v.x - cx) > R || Math.abs(v.z - cz) > R) continue;
        const sc = base * (v.cls === 'sea' ? (v.def.length > 2.3 ? 1.35 : v.kind === 'fishing' ? 0.7 : 1.1) : 0.75);
        const y = v.cls === 'sea' ? 0.6 + dist * 0.004 : W.heightAt(v.x, v.z) + 1.2 + dist * 0.004;
        const c = this._kingdomColor(v.kingdom);
        cr = c.r;
        cg = c.g;
        cb = c.b;
        quad(v.x - sc, v.z - sc, v.x + sc, v.z - sc, v.x + sc, v.z + sc, v.x - sc, v.z + sc, 0, 0, 1, 0, 1, 1, 0, 1, 4, 1, 1, 0, 0, 0, y);
      }
      cr = cg = cb = 1;
    }
    g.setDrawRange(0, n);
    g.attributes.position.needsUpdate = true;
    g.attributes.aUV.needsUpdate = true;
    g.attributes.aK.needsUpdate = true;
    g.attributes.aC.needsUpdate = true;
    this.waterFx.visible = n > 0;
  }

  _debris(F, on, alpha) {
    let n = 0;
    const L = F.debris;
    if (on && L.length) {
      const mesh = this._growProp('debris', L.length);
      for (const d of L) {
        const sinkAt = d.life - 8;
        const y = 0.01 + Math.sin(this.t * 1.3 + d.seed * 20) * 0.015 - (d.age > sinkAt ? (d.age - sinkAt) * 0.04 : 0);
        this._e.set(Math.sin(this.t + d.seed * 9) * 0.08, d.rot, Math.sin(this.t * 0.8 + d.seed * 5) * 0.06, 'YZX');
        this._q.setFromEuler(this._e);
        this._m.compose(this._p.set(d.x, y, d.z), this._q, this._s.set(d.size, d.size, d.size));
        mesh.setMatrixAt(n++, this._m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.debris.count = n;
    this.debris.visible = n > 0;
    void alpha;
  }

  // Catapult stones on their arc, with a dotted trail of grit behind them
  // and a puff of dust where they fly.
  _stones(F, alpha) {
    let n = 0;
    const L = F.stones;
    if (L.length) {
      const mesh = this._growProp('stones', L.length * 5);
      const step = this.game.simStep || TICK;
      const at = (st, u) => {
        const x = st.x0 + (st.x1 - st.x0) * u,
          z = st.z0 + (st.z1 - st.z0) * u;
        return [x, st.y0 + (st.y1 - st.y0) * u + 4 * st.peak * u * (1 - u), z];
      };
      for (const st of L) {
        const u = Math.max(0, Math.min(1, (st.t + alpha * step) / st.dur));
        for (let k = 0; k < 5; k++) {
          const uk = u - k * 0.045;
          if (uk < 0) break;
          const [x, y, z] = at(st, uk);
          const sc = k === 0 ? 1 : 0.42 - k * 0.07;
          this._q.setFromAxisAngle(this._up, uk * 9);
          this._m.compose(this._p.set(x, y, z), this._q, this._s.setScalar(sc));
          mesh.setMatrixAt(n++, this._m);
        }
        if (this.game.fx?.emit && (st._puff = (st._puff || 0) + 1) % 6 === 0) {
          const [x, y, z] = at(st, u);
          this.game.fx.emit('dust', { x, y, z }, { scale: 0.35 });
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.stones.count = n;
    this.stones.visible = n > 0;
  }

  // Arrows and fire pots arcing between ships.
  _shots(F, alpha, far) {
    let n = 0;
    const L = F.shots || [];
    if (L.length && !far) {
      const mesh = this._growProp('arrows', L.length);
      const step = this.game.simStep || TICK;
      for (const sh of L) {
        const u = (sh.t + alpha * step) / sh.dur;
        if (u < 0 || u > 1) continue;
        const dx = sh.x1 - sh.x0,
          dz = sh.z1 - sh.z0;
        const d = Math.hypot(dx, dz) || 1;
        const peak = 0.4 + d * 0.09;
        const x = sh.x0 + dx * u,
          z = sh.z0 + dz * u,
          y = 0.55 + 4 * peak * u * (1 - u);
        const pitch = Math.atan2(4 * peak * (1 - 2 * u), d);
        this._e.set(0, -Math.atan2(dz, dx), pitch, 'YZX');
        this._q.setFromEuler(this._e);
        this._m.compose(this._p.set(x, y, z), this._q, this._s.setScalar(sh.pot ? 1.6 : 1));
        mesh.setMatrixAt(n++, this._m);
        if (sh.pot && this.game.fx?.emit && Math.random() < 0.35) this.game.fx.emit('fire', { x, y, z }, { scale: 0.25 });
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.arrows.count = n;
    this.arrows.visible = n > 0;
  }

  // Faint dashed trade lanes at mid zoom (rebuilt twice a second).
  _lanes(F, dt, dist, far) {
    const z01 = this.game.view?.zoom01 ?? 0.5;
    const on = !far && z01 > 0.12 && dist > 45 && !this.game.settings?.powerSaver;
    this.lanes.visible = on;
    if (!on) return;
    this.uniforms.uLaneAlpha.value = Math.min(0.55, (dist - 45) / 60) * 0.85;
    if ((this._laneT -= dt) > 0) return;
    this._laneT = 0.5;
    const geo = this.lanes.geometry;
    const P = geo.attributes.position.array,
      C = geo.attributes.aC.array,
      D = geo.attributes.aUV.array;
    let n = 0;
    for (const lane of F.lanes()) {
      const v = F.get(lane.id);
      const p = lane.path;
      const c = this._kingdomColor(lane.kingdom);
      let acc = 0;
      let px = v ? v.x : p[0],
        pz = v ? v.z : p[1];
      for (let i = Math.max(0, (v?.pi ?? 0)); i < p.length; i += 2) {
        if (n + 2 > this._laneMax) break;
        const x = p[i],
          z = p[i + 1];
        const L = Math.hypot(x - px, z - pz);
        P[n * 3] = px;
        P[n * 3 + 1] = 0.05;
        P[n * 3 + 2] = pz;
        P[n * 3 + 3] = x;
        P[n * 3 + 4] = 0.05;
        P[n * 3 + 5] = z;
        for (let q = 0; q < 2; q++) {
          C[(n + q) * 3] = c.r * 1.3 + 0.2;
          C[(n + q) * 3 + 1] = c.g * 1.3 + 0.2;
          C[(n + q) * 3 + 2] = c.b * 1.3 + 0.2;
        }
        D[n * 2] = acc;
        D[n * 2 + 2] = acc + L;
        acc += L;
        n += 2;
        px = x;
        pz = z;
      }
    }
    geo.setDrawRange(0, n);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aC.needsUpdate = true;
    geo.attributes.aUV.needsUpdate = true;
  }

  // Smoke and flames over burning ships, spray in a storm.
  _effects(F, dt, far, dist, cx, cz) {
    const fx = this.game.fx;
    if (!fx?.emit || far || dist > 120) return;
    if ((this._fxT -= dt) > 0) return;
    this._fxT = this.game.settings?.powerSaver ? 0.5 : 0.25;
    const R = dist * 1.1 + 12;
    let budget = 6;
    for (const v of F.list) {
      if (!v.alive || budget <= 0) continue;
      if (Math.abs(v.x - cx) > R || Math.abs(v.z - cz) > R) continue;
      if (v.burning > 0.15 || (v.sink > 0 && v.sink < 0.5)) {
        fx.emit('smoke', { x: v.x, y: (v.y || 0) + 0.6, z: v.z }, { scale: 0.6 + v.def.length * 0.2 });
        if (v.burning > 0.3) fx.emit('fire', { x: v.x + (Math.random() - 0.5) * 0.5, y: (v.y || 0) + 0.4, z: v.z }, { scale: 0.5 });
        budget--;
      }
      if (v.sink > 0 && v.sink < 0.25) {
        fx.emit('splash', { x: v.x, y: 0, z: v.z }, { scale: 0.5 });
        budget--;
      }
    }
  }

  // fleet draw calls (for the performance overlay and tests)
  drawStats() {
    let draws = 0;
    this.group.traverse((o) => {
      if (!o.visible) return;
      if (o.isInstancedMesh && o.count === 0) return;
      if (o.isMesh || o.isLineSegments) draws++;
    });
    return { draws, vehicles: this.visibleCount || 0 };
  }
}

// A point `back` tiles behind the head along a trail of recent positions.
function trailPoint(T, x, z, h, back) {
  if (back <= 0 || !T || T.length < 4) return { x: x - Math.cos(h) * back, z: z - Math.sin(h) * back, h };
  let px = x,
    pz = z,
    rem = back;
  for (let i = T.length - 2; i >= 0; i -= 2) {
    const qx = T[i],
      qz = T[i + 1];
    const L = Math.hypot(px - qx, pz - qz);
    if (L >= rem && L > 1e-4) {
      const t = rem / L;
      return { x: px + (qx - px) * t, z: pz + (qz - pz) * t, h: Math.atan2(pz - qz, px - qx) };
    }
    rem -= L;
    px = qx;
    pz = qz;
  }
  return { x: px - Math.cos(h) * rem, z: pz - Math.sin(h) * rem, h };
}
export { KINDS };
