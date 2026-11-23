import * as THREE from 'three';
import { vehicleModel, hasLo, debrisGeometry, stoneGeometry, tracerGeometry, potGeometry } from './models.js';
import { createVehicleMaterial, createVehicleDepthMaterial, createWaterFxMaterial } from './materials.js';
import { bannerGeometry, bannerMaterial } from '../buildings/props.js';
import { emblemAtlas, EMBLEM_IDS, FIELD_IDS } from '../buildings/emblems.js';
import { KINDS } from '../../sim/fleet/kinds.js';
import { smokePuff, RAMP } from '../fx/Effects.js';
import { AirLayer } from './AirLayer.js';
import './modernModels.js';
import './airModels.js';
import { VEHICLE, BUILDING } from '../../core/scale.js';
import { SEA_LEVEL } from '../../world/constants.js';
import { geoWrapOn } from '../../world/geo.js';
import { hwPoint } from '../../sim/civ/modern.js';
import { roadBoost, laneOffset } from '../../sim/fleet/traffic.js';

// Draws game.fleet: every vessel, land vehicle, aircraft and rocket through
// ONE batched multi-draw (a THREE.BatchedMesh holding each kind's full and
// distant model once; sails, oars, wheels, turrets, propellers and legs
// animate in the vertex shader), realm flags with their emblems, wakes and
// bow waves, contrails and contact shadows, smoke from funnels and engines,
// floating wreckage, catapult stones and shells, faint trade lanes at mid
// zoom, and a dot per vehicle when the camera is far. The air layer
// (AirLayer.js) adds aircraft, rockets, satellites and the aurora.
// Cheaper paths in power saver and at far zoom (see update()).

const TICK = 1 / 15;
const DETAIL_DIST = 175; // beyond this camera distance vehicles draw as dots
// past this camera distance parked and slow land vehicles (cars at the curb,
// carts, idling trucks) and the street traffic are not drawn: they only
// peppered a town's grey patch with dots. Trains, ships and aircraft stay.
const FAR_CUT = 90;
// smallest on-screen length (px) of a road vehicle at mid zoom (round 27:
// 8, up from 5.5, so traffic reads as cars in a growing town at 30-75 tiles;
// up close every car keeps its true half size)
const MIN_CAR_PX = 8;
const farHidden = (v) => v.cls !== 'sea' && !v.def.rail && !(v.speed > 0.5 * (v.def.speed || 1));
const FLAG_DIST = 115;
const WAKE_DIST = 165;
const LO_ZOOM = 120; // beyond this camera distance every kind with a distant model uses it
const PLUME_TINT = 0xeceff3; // a cool near-white: smoke over the sea reads grey, not brown
const STONE_SCALE = 0.62 * VEHICLE.land; // catapult stone: a third of the arm (~0.38 tiles across at design size)
// rails and the maglev guideway (InfraRenderer draws them at these heights)
const RAIL_Y = 0.02 + 0.083 * VEHICLE.land; // the bed (0.02) plus sleeper and rail, sized with the trains
const MAGLEV_Y = 0.95 * BUILDING.scale; // the guideway's clearance (InfraRenderer MAG_Y)
const MAGLEV_HOVER = 0.03;
const BRIDGE_Y = SEA_LEVEL + 0.3 * BUILDING.scale; // a rail bridge's deck over water
// Round world (docs/ROUND-WORLD.md): within this many tiles of the seam a ship
// is drawn twice, once one map width over, so she sails on past one edge
// while her twin comes in at the other (the sea runs on beyond the map)
const SEAM_TWIN = 28;

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
function angWrap(d) {
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Every model of every vehicle kind in ONE draw call: a THREE.BatchedMesh
// holds each model's geometry once and draws all instances with a single
// multi-draw (three culls each instance against the camera, and against the
// light for the shadow pass). Instance colour, animation and state live in a
// float texture read by the vehicle material (materials.js): three RGBA
// texels per instance. Fill it each frame: begin(), push() per instance, end().
export class VehicleBatch {
  constructor(parent, uniforms, game) {
    this.parent = parent;
    this.game = game;
    this.inst = { value: null };
    this.material = createVehicleMaterial(uniforms, this.inst);
    this.depth = createVehicleDepthMaterial(uniforms, this.inst);
    this.geoIds = new Map();
    this.vUsed = 0;
    this.cap = 0;
    this.vcap = 0;
    this.nInst = 0;
    this.n = 0;
    this.mesh = null;
    this.data = null;
    this.keys = [];
    this.mats = new Float32Array(64 * 16);
    this.vals = new Float32Array(64 * 12);
  }
  _tex(cap) {
    const size = Math.max(4, Math.ceil(Math.sqrt(cap * 3)));
    const data = new Float32Array(size * size * 4);
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true;
    this.inst.value?.dispose?.();
    this.inst.value = tex;
    this.data = data;
  }
  _ensure(nInst, vNeed) {
    if (!this.mesh) {
      this.cap = Math.max(128, Math.ceil(nInst * 1.5));
      this.vcap = Math.max(1 << 17, Math.ceil(vNeed * 1.5));
      const m = new THREE.BatchedMesh(this.cap, this.vcap, 0, this.material);
      m.name = 'fleet:vehicles';
      m.castShadow = true;
      m.receiveShadow = true;
      m.customDepthMaterial = this.depth;
      m.frustumCulled = false; // three culls each instance itself
      m.perObjectFrustumCulled = true;
      m.sortObjects = false;
      this.mesh = m;
      this._tex(this.cap);
      this.parent.add(m);
      return;
    }
    if (nInst > this.cap) {
      this.cap = Math.ceil(nInst * 1.5);
      this.mesh.setInstanceCount(this.cap);
      this._tex(this.cap);
    }
    if (vNeed > this.vcap) {
      this.vcap = Math.ceil(vNeed * 1.5);
      this.mesh.setGeometrySize(this.vcap, 0);
    }
  }
  _geoId(key) {
    let id = this.geoIds.get(key);
    if (id != null) return id;
    const i = key.indexOf(':');
    const md = vehicleModel(i < 0 ? key : key.slice(0, i), i >= 0);
    if (!md) return -1;
    const vc = md.geo.attributes.position.count;
    this._ensure(this.cap, this.vUsed + vc);
    id = this.mesh.addGeometry(md.geo);
    this.vUsed += vc;
    this.geoIds.set(key, id);
    return id;
  }
  begin() {
    this.n = 0;
  }
  // key: kind or 'kind:lo'; m: Matrix4; c: Color (linear); a0..a3 the anim, s0..s3 the state
  push(key, m, c, a0, a1, a2, a3, s0, s1, s2, s3) {
    const n = this.n++;
    if ((n + 1) * 16 > this.mats.length) {
      const M = new Float32Array(this.mats.length * 2);
      M.set(this.mats);
      this.mats = M;
      const V = new Float32Array(this.vals.length * 2);
      V.set(this.vals);
      this.vals = V;
    }
    this.keys[n] = key;
    this.mats.set(m.elements, n * 16);
    const o = n * 12,
      V = this.vals;
    V[o] = c.r;
    V[o + 1] = c.g;
    V[o + 2] = c.b;
    V[o + 3] = 0;
    V[o + 4] = a0;
    V[o + 5] = a1;
    V[o + 6] = a2;
    V[o + 7] = a3;
    V[o + 8] = s0;
    V[o + 9] = s1;
    V[o + 10] = s2;
    V[o + 11] = s3;
  }
  end(shadows = true) {
    const n = this.n;
    if (!n && !this.mesh) return;
    this._ensure(Math.max(n, 1), this.vUsed);
    const m = this.mesh;
    const gids = this._gids && this._gids.length >= n ? this._gids : (this._gids = new Int32Array(Math.max(64, n * 2)));
    for (let i = 0; i < n; i++) gids[i] = this._geoId(this.keys[i]);
    while (this.nInst < n) m.addInstance(gids[this.nInst++]);
    const mats = m._matricesTexture.image.data;
    for (let i = 0; i < n; i++) {
      if (gids[i] < 0) {
        if (m.getVisibleAt(i)) m.setVisibleAt(i, false);
        continue;
      }
      if (m.getGeometryIdAt(i) !== gids[i]) m.setGeometryIdAt(i, gids[i]);
      if (!m.getVisibleAt(i)) m.setVisibleAt(i, true);
    }
    mats.set(this.mats.subarray(0, n * 16));
    for (let i = n; i < this.nInst; i++) if (m.getVisibleAt(i)) m.setVisibleAt(i, false);
    m._matricesTexture.needsUpdate = true;
    this.data.set(this.vals.subarray(0, n * 12));
    this.inst.value.needsUpdate = true;
    m.visible = n > 0;
    m.castShadow = shadows;
  }
}

export class FleetRenderer {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'fleet';
    game.scene.add(this.group);
    this.t = 0;
    this.uniforms = { uTime: { value: 0 }, uNight: { value: 0 }, uLight: { value: 1 }, uLaneAlpha: { value: 0.5 }, uWind: { value: 0.35 }, uEmblems: { value: emblemAtlas() } };
    // every vessel, vehicle, aircraft and rocket: one batched multi-draw
    this.vb = new VehicleBatch(this.group, this.uniforms, game);
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
    this.air = new AirLayer(game, this); // aircraft, rockets, satellites and the aurora
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
    this._hist = new Map(); // vessel id -> odometer {x, z, d}: wake foam stays put in the water
    this._histT = 0;
    // wreckage and catapult stones
    this.propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    this.debris = this._inst(debrisGeometry(), this.propMat, 64);
    // stones and wreckage share one vertex-coloured material (one program)
    this.stones = this._inst(stoneGeometry(), this.propMat, 32);
    // arrows and fire pots fly as thin glowing streaks: unlit, a faint glow,
    // a pixel or two wide and short at any battle zoom
    this.tracerMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, depthWrite: false });
    this.arrows = this._inst(tracerGeometry(), this.tracerMat, 64);
    this.arrows.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3), 3);
    this.pots = this._inst(potGeometry(), this.tracerMat, 16);
    this.pots.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(16 * 3), 3);
    // (pale gold at the head, fading orange down the tail; just bright
    // enough to glow, not to bloom into planks)
    this._cArrow = new THREE.Color(1.35, 1.0, 0.55);
    this._cShell = new THREE.Color(2.4, 1.9, 1.2); // a shell: a white-hot streak
    this._cPotTail = new THREE.Color(1.7, 0.75, 0.2);
    this._cPot = new THREE.Color(2.2, 1.1, 0.35);
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

  // The model of a kind at this range: the full model near the camera, the
  // simple one (hull and blocks) farther off, where the kind has one.
  _key(kind, x, z) {
    if (!hasLo(kind)) return kind;
    const d = Math.max(Math.abs(x - this._cx), Math.abs(z - this._cz));
    return this._dist > LO_ZOOM || d > this._loR ? kind + ':lo' : kind;
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
    this.air?.update(U.uNight.value);
    U.uLight.value = 0.25 + 0.75 * Math.min(1, day * 1.4);
    U.uWind.value = g.env?.wind?.strength ?? 0.35;
    const rig = g.cameraRig;
    const dist = rig?.cur?.dist ?? 80;
    const cx = rig?.cur?.x ?? 0,
      cz = rig?.cur?.z ?? 0;
    const ps = !!g.settings?.powerSaver;
    const far = !!g.view?.far || dist > DETAIL_DIST;
    const farCut = dist > FAR_CUT;
    const viewR = dist * 1.7 + 24;
    const alpha = g.paused ? 1 : Math.min(1, Math.max(0, (g._acc || 0) / (g.simStep || TICK)));
    const list = F.list;
    // (round 29) a kind seen for the first time has both its models built
    // and added to the batch at once, wherever it is, so it is drawn on its
    // first frame in view and never pops in at the switch to its simple
    // model (a carrier spawned off screen was not drawn for seconds)
    const seen = this._seenKinds || (this._seenKinds = new Set());
    for (let i = 0; i < list.length; i++) {
      const k = list[i].kind;
      if (seen.has(k)) continue;
      seen.add(k);
      this.vb._geoId(k);
      if (hasLo(k)) this.vb._geoId(k + ':lo');
    }
    this._hwDecks();
    // ---- detailed vehicles (one batched multi-draw with the aircraft)
    this._cx = cx;
    this._cz = cz;
    this._dist = dist;
    this._loR = Math.max(45, dist * 0.9);
    const vb = this.vb;
    vb.begin();
    let visible = 0;
    const wrapW = geoWrapOn(g.world) ? g.world.w : 0;
    const flagsOn = !far && dist < (ps ? FLAG_DIST * 0.7 : FLAG_DIST);
    const wakesOn = !far && dist < (ps ? WAKE_DIST * 0.55 : WAKE_DIST);
    const C = this._ctx || (this._ctx = { flagList: [], wakeList: [], blobList: [] });
    const flagList = (C.flagList.length = 0, C.flagList);
    const wakeList = (C.wakeList.length = 0, C.wakeList);
    const blobList = (C.blobList.length = 0, C.blobList);
    C.alpha = alpha;
    C.st = F.storm?.() ?? 0;
    C.wind = g.env?.wind || { x: 1, z: 0, strength: 0.3 };
    C.flagsOn = flagsOn;
    C.wakesOn = wakesOn;
    // road vehicles grow a little as the camera pulls back, a third as much as
    // the people do (UnitRenderer's readability boost), so a car stays about
    // two people long at play zoom as well as up close
    C.roadBoost = roadBoost(dist);
    // round 25: out to about 75 tiles a car keeps at least ~5.5 px of length
    // on screen (half-size cars had shrunk to specks at 30 tiles and vanished
    // at 55); up close it keeps its true half size
    {
      const cam = rig?.camera;
      const H = g.pipeline?.size?.y || innerHeight;
      const ppuT = cam ? H / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) / Math.max(1, dist) : 20;
      C.minRoadLen = dist < 82 ? (MIN_CAR_PX / ppuT) * (1 - smoothstep(72, 82, dist)) : 0;
    }
    const wind = C.wind;
    if (!far) {
      for (const v of list) {
        if (!v.alive) continue;
        // (Round world: a ship near the seam also sails on past the edge)
        if (wrapW && v.cls === 'sea' && (v.x < SEAM_TWIN || v.x > wrapW - SEAM_TWIN)) {
          const t = this._twin(v, v.x < SEAM_TWIN ? wrapW : -wrapW);
          if (Math.abs(t.x - cx) <= viewR && Math.abs(t.z - cz) <= viewR) this._drawVehicle(t, C);
        }
        if (Math.abs(v.x - cx) > viewR || Math.abs(v.z - cz) > viewR) continue;
        if (farCut && farHidden(v)) continue;
        if (v.garaged && v.state === 'parked') continue; // armour garaged in its barracks
        this._drawVehicle(v, C);
        visible++;
      }
    }
    if (!far && !farCut && F.traffic?.length) visible += this._drawTraffic(F.traffic, C, cx, cz, Math.min(viewR, ps ? 50 : 80));
    this.air.collect(vb, C, far, dist, cx, cz, viewR);
    vb.end(!ps);
    this._flags(flagList, flagsOn, wind);
    this._waterFxUpdate(wakeList, wakesOn, blobList, !far, dt, far ? { list, dist, cx, cz, R: viewR * 1.4 } : null);
    this._debris(F, !far, alpha);
    this._stones(F, alpha);
    this._shots(F, alpha, far);
    this._lanes(F, dt, dist, far);
    this._effects(F, dt, far, dist, cx, cz);
    this.visibleCount = visible;
  }

  // One vessel or land vehicle into the batch (a caravan or a train as each
  // beast or car along its trail), with its flags, wake and contact shadow.
  _drawVehicle(v, C) {
    const vb = this.vb;
    const W = this.game.world;
    const def = v.def;
    const kind = v.kind;
    const alpha = C.alpha;
    const x = v.px + (v.x - v.px) * alpha,
      z = v.pz + (v.z - v.pz) * alpha;
    const h = lerpAngle(v.ph ?? v.heading, v.heading, alpha);
    const kc = this._kingdomColor(v.kingdom);
    const dmg = Math.min(1, Math.max(0, 1 - v.hp / v.maxHp - 0.12) / 0.88);
    const a = v.anim;
    let sc = (def.scale || 1) * (def.road ? C.roadBoost || 1 : 1);
    if (def.road && C.minRoadLen > 0 && def.length > 0) sc *= Math.max(1, Math.min(3.2, C.minRoadLen / (def.length * (C.roadBoost || 1))));
    if (v.cls === 'sea') {
      const ph = this.t + v.seed * 20;
      const rough = (1 + C.st * 2.5) * (def.length > 2 * VEHICLE.sea ? 0.6 : 1);
      let y = Math.sin(ph * 1.5) * 0.025 * rough;
      let roll = Math.sin(ph * 1.1) * 0.03 * rough + (v.heading - (v.ph ?? v.heading)) * 1.5;
      let pitch = Math.sin(ph * 0.9 + 1) * 0.02 * rough;
      if (dmg > 0.3) {
        // holed: she lists and settles
        const l = (dmg - 0.3) / 0.7;
        roll += l * 0.22 * (v.seed > 0.5 ? 1 : -1);
        y -= l * 0.08;
      }
      if (v.sink > 0) {
        const s = v.sink;
        y -= s * s * (def.length * 0.35 + 0.8 * VEHICLE.sea);
        roll += s * 0.9 * (v.seed > 0.5 ? 1 : -1);
        pitch += s * 0.45 * (v.seed > 0.3 ? 1 : -1);
      }
      // a submarine runs awash in port and dives to her sail at sea; a
      // hydrofoil rises onto her foils at speed; a hovercraft rides the land
      if (def.sub) y -= (v.state === 'moored' ? 0.02 : 0.11) * sc / 0.45;
      if (def.ferry) {
        const f = Math.min(1, v.speed / def.speed);
        y += 0.22 * sc * f * f;
        pitch -= 0.03 * f;
      }
      if (v.role === 'hover') {
        y = Math.max(0, v.y || 0) + 0.03 + Math.sin(ph * 3) * 0.008;
        roll *= 0.4;
      }
      v.y = 0;
      this._e.set(roll, -h, pitch, 'YZX');
      this._q.setFromEuler(this._e);
      this._m.compose(this._p.set(x, y, z), this._q, this._s.setScalar(sc));
      // which side the wind fills the fore-and-aft sails from
      const tack = Math.sign(Math.sin(h) * C.wind.x - Math.cos(h) * C.wind.z) || 1;
      // turrets train on the enemy
      let aim = 0;
      if (def.war && def.sail === false) {
        const t = v.target != null ? this.game.fleet.byId.get(v.target) : null;
        const want = t && t.alive ? angWrap(h - Math.atan2(t.z - z, t.x - x)) : 0;
        v._aim = (v._aim || 0) + angWrap(want - (v._aim || 0)) * 0.08;
        aim = Math.abs(v._aim) < 0.002 ? 0 : v._aim;
      }
      const spin = def.small || v.role === 'hover' ? Math.min(1, 0.3 + v.speed) : 0;
      vb.push(this._key(kind, x, z), this._m, kc, a.row, tack, aim, kind === 'hovercraft' ? spin : a.fill * (1 - a.furl), dmg, v.burning, a.furl, a.oar);
      const md = vehicleModel(kind);
      if (C.flagsOn && md.flags.length && v.sink < 0.4) for (const f of md.flags) C.flagList.push({ f, m: this._m.clone(), v, h });
      if (C.wakesOn && v.speed > 0.05 && !(v.sink > 0) && v.state !== 'moored' && !(v.role === 'hover' && (v.y || 0) > 0.02)) C.wakeList.push({ x, z, h, v });
      return;
    }
    // land: sit on the ground (trains on their rails, a maglev on its
    // guideway), tilt with the slope
    const lift = def.rail ? (kind === 'maglev' ? MAGLEV_HOVER : RAIL_Y) : 0;
    const y = (def.rail ? this._railY(kind, v.path, (v.pi ?? 2) - 2, x, z) : def.road ? this._roadY(x, z, h) : W.heightAt(x, z)) + lift;
    v.y = y;
    const c = Math.cos(h),
      s = Math.sin(h);
    const hl = def.length * 0.35;
    // (eased from frame to frame and kept small across the vehicle: a wheeled
    // vehicle leans a little on a side slope, never tips over; the slope
    // is read across its own width, not a tile around it)
    let pitch = 0,
      roll = 0;
    if (!def.rail) {
      const bw = Math.max(0.1, (def.size || 0.5) * 0.35);
      const hy = def.road ? (px, pz) => this._roadY(px, pz, h) : (px, pz) => W.heightAt(px, pz);
      const wantP = Math.max(-0.3, Math.min(0.3, Math.atan2(hy(x + c * hl, z + s * hl) - hy(x - c * hl, z - s * hl), hl * 2)));
      const wantR = Math.max(-0.1, Math.min(0.1, -Math.atan2(W.heightAt(x - s * bw, z + c * bw) - W.heightAt(x + s * bw, z - c * bw), bw * 2) * 0.5));
      v._pitch = v._pitch == null ? wantP : v._pitch + (wantP - v._pitch) * 0.2;
      v._roll = v._roll == null ? wantR : v._roll + (wantR - v._roll) * 0.2;
      pitch = v._pitch;
      roll = v._roll;
    }
    const role = v.role;
    // the third anim value: a catapult's arm, a ram's swing, a gun's recoil, a turret's aim
    let a3 = 0;
    if (kind === 'catapult') a3 = Math.pow(a.arm, 0.35) * 2.0;
    else if (kind === 'ram') a3 = Math.sin(a.ram * Math.PI) * 0.28;
    else if (def.gun && role === 'catapult') a3 = -0.18 * a.arm * a.arm;
    else if (kind === 'tank') {
      const t = v.siegeTarget;
      const b = t == null ? null : typeof t === 'object' ? t : this.game.civ?._bById?.get(t);
      const want = b ? angWrap(h - Math.atan2(b.z - z, b.x - x)) : 0;
      v._aim = (v._aim || 0) + angWrap(want - (v._aim || 0)) * 0.08;
      a3 = Math.abs(v._aim) < 0.002 ? 0 : v._aim;
    }
    const siren = def.siren && v.mission?.siren ? 1 : 0;
    const put = (px, pz, ph, variant, py) => {
      this._e.set(roll, -ph, pitch, 'YZX');
      this._q.setFromEuler(this._e);
      this._m.compose(this._p.set(px, py ?? y, pz), this._q, this._s.setScalar(sc));
      vb.push(this._key(kind, px, pz), this._m, kc, a.walk + variant * 1.3, a.wheel, a3, 0, dmg, v.burning || 0, siren, kind === 'oxcart' ? a.cargoType : variant);
      C.blobList.push(px, pz, def.length * (kind === 'caravan' ? 0.9 : 1.1) * (def.road ? C.roadBoost || 1 : 1), ph);
    };
    if (kind === 'caravan') {
      const camel = a.cargoType === 2 ? 2 : 0;
      for (let i = 0; i < 4; i++) {
        const p = trailPoint(v.trail, x, z, h, i * 0.9);
        put(p.x, p.z, p.h, camel + (i === 0 ? 1 : 0), W.heightAt(p.x, p.z));
      }
    } else if (def.cars) {
      // an engine and the cars behind it, each on the rails of its route
      // (v.path: the line's track) a car's length apart
      const n = def.cars;
      const gap = def.length;
      const diesel = kind === 'train' && (this.game.civ?.kingdoms?.[v.kingdom]?.era ?? 0) >= 6;
      const P = v.path || v.donePath || null;
      let k = v.path ? Math.min(v.pi, P.length - 2) - 2 : P ? P.length - 2 : -2,
        hx = x,
        hz = z,
        rem = 0;
      for (let i = 0; i < n; i++) {
        let px = hx,
          pz = hz,
          ph = h;
        if (i > 0) {
          rem += gap;
          // walk back along the route from the head
          while (k >= 0) {
            const qx = P[k],
              qz = P[k + 1];
            const L = Math.hypot(hx - qx, hz - qz);
            if (L >= rem && L > 1e-4) {
              const t = rem / L;
              px = hx + (qx - hx) * t;
              pz = hz + (qz - hz) * t;
              ph = Math.atan2(hz - qz, hx - qx);
              hx = px;
              hz = pz;
              rem = 0;
              break;
            }
            rem -= L;
            hx = qx;
            hz = qz;
            k -= 2;
          }
          if (k < 0) {
            // before the start of the route: straight on back
            const bh = P && P.length >= 4 ? Math.atan2(P[3] - P[1], P[2] - P[0]) : h;
            px = hx - Math.cos(bh) * rem;
            pz = hz - Math.sin(bh) * rem;
            ph = bh;
            hx = px;
            hz = pz;
            rem = 0;
          }
        }
        const variant = kind === 'maglev' ? (i ? 1 : 0) : i === 0 ? (diesel ? 3 : 0) : (i + (v.seed > 0.5 ? 1 : 0)) % 2 ? 1 : 2;
        put(px, pz, ph, variant, this._railY(kind, P, k, px, pz) + lift);
      }
    } else put(x, z, h, kind === 'car' ? Math.floor(v.seed * 4) : 0);
  }

  // Cars in the streets (fleet.traffic): on the right-hand side of the
  // street, nosing up and down the slopes, wheels turning.
  _drawTraffic(T, C, cx, cz, R) {
    const W = this.game.world;
    const vb = this.vb;
    const alpha = C.alpha;
    const def = KINDS.car;
    const grow = C.minRoadLen > 0 && def.length > 0 ? Math.max(1, Math.min(3.2, C.minRoadLen / (def.length * (C.roadBoost || 1)))) : 1;
    const sc = (def.scale || 1) * (C.roadBoost || 1) * grow;
    const hl = def.length * 0.4 * grow;
    // (the right-hand lane: half a car's width and a little off the crown;
    // the picker and the camera find a street car there too, traffic.js)
    const lane = laneOffset(C.roadBoost);
    let n = 0;
    for (let i = 0; i < T.length; i++) {
      const c = T[i];
      if (Math.abs(c.x - cx) > R || Math.abs(c.z - cz) > R) continue;
      const h = lerpAngle(c.ph, c.h, alpha);
      const co = Math.cos(h),
        si = Math.sin(h);
      const x = c.px + (c.x - c.px) * alpha - si * lane,
        z = c.pz + (c.z - c.pz) * alpha + co * lane;
      const y = this._roadY(x, z, h);
      const pitch = Math.max(-0.3, Math.min(0.3, Math.atan2(this._roadY(x + co * hl, z + si * hl, h) - this._roadY(x - co * hl, z - si * hl, h), hl * 2)));
      this._e.set(0, -h, pitch, 'YZX');
      this._q.setFromEuler(this._e);
      this._m.compose(this._p.set(x, Math.max(y, 0), z), this._q, this._s.setScalar(sc));
      const wheel = -((c.wd || 0) / (0.08 * sc)) - i; // (round 23: turns with the distance driven, still when parked)
      vb.push(this._key('car', x, z), this._m, this._kingdomColor(c.kingdom), 0, wheel, 0, 0, 0, 0, 0, c.v);
      C.blobList.push(x, z, def.length * (C.roadBoost || 1), h);
      n++;
    }
    return n;
  }

  // Where a road vehicle drives: on a highway's deck where the highway stands
  // raised on piers (a bridge or a viaduct, as InfraRenderer lays it: the
  // ground plus a little, held to a gentle grade), else on the ground. (A car
  // on a highway's road below its viaduct drove along the ground under it,
  // or seemed to hang in the air beside the cliff the deck runs past.)
  _hwDecks() {
    const civ = this.game.civ;
    const ver = civ?.infraVersion ?? -1;
    if (this._hwVer === ver && this._hwMap) return this._hwMap;
    this._hwVer = ver;
    const M = (this._hwMap = new Map());
    const W = this.game.world;
    for (const seg of civ?.railSegs?.() || []) {
      const P = seg.pts,
        hw = seg.hw;
      if (!hw || !P || P.length < 4) continue;
      const n = P.length / 2;
      const C = [],
        G = [],
        Y = [];
      for (let i = 0; i < n; i++) {
        const c = hwPoint(P, i);
        const g = W.heightAt(c[0], c[1]);
        C.push(c);
        G.push(g);
        Y.push(hw[i] === 2 || g < SEA_LEVEL ? SEA_LEVEL + 0.3 * BUILDING.scale : g + 0.03);
      }
      for (let i = 1; i < n; i++) Y[i] = Math.max(Y[i], Y[i - 1] - 0.08);
      for (let i = n - 2; i >= 0; i--) Y[i] = Math.max(Y[i], Y[i + 1] - 0.08);
      for (let i = 0; i < n; i++) {
        // (a point of a drawn stretch: InfraRenderer draws between two marked points)
        if (!hw[i] || !(hw[i - 1] || hw[i + 1])) continue;
        const t = Math.floor(C[i][1]) * W.w + Math.floor(C[i][0]);
        let L = M.get(t);
        if (!L) M.set(t, (L = []));
        // (with the deck's direction: a street crossing under it stays below)
        const j = Math.min(n - 1, i + 1),
          k = Math.max(0, i - 1);
        const dx = C[j][0] - C[k][0],
          dz = C[j][1] - C[k][1],
          dl = Math.hypot(dx, dz) || 1;
        L.push(C[i][0], C[i][1], Y[i] + 0.004, dx / dl, dz / dl);
      }
    }
    return M;
  }
  _roadY(x, z, h = null) {
    const W = this.game.world;
    const g = W.heightAt(x, z);
    const M = this._hwMap;
    if (!M || !M.size) return g;
    const L = M.get(Math.floor(z) * W.w + Math.floor(x));
    if (!L) return g;
    // the deck's level here: its points in this tile, nearer ones counting
    // more (only for a vehicle heading along the deck, not across it)
    const hc = h == null ? 0 : Math.cos(h),
      hs = h == null ? 0 : Math.sin(h);
    let s = 0,
      ws = 0;
    for (let i = 0; i < L.length; i += 5) {
      if (h != null && Math.abs(hc * L[i + 3] + hs * L[i + 4]) < 0.6) continue;
      const wt = 1 / (0.02 + (L[i] - x) ** 2 + (L[i + 1] - z) ** 2);
      s += L[i + 2] * wt;
      ws += wt;
    }
    return ws > 0 ? Math.max(g, s / ws) : g;
  }

  // The level a train runs at near point k of its route: the ground (a
  // bridge's deck over water); a maglev's guideway runs level over bumps
  // (InfraRenderer averages its height over a few tiles: so does this).
  _railY(kind, P, k, x, z) {
    // on the drawn network: the level the sim gave the track (bridges and
    // viaducts keep a gentle grade over valleys)
    const d = this.game.civ?.railDeckAt?.(kind, P, k, x, z);
    if (d != null) return d;
    const W = this.game.world;
    const g = W.heightAt(x, z);
    if (kind !== 'maglev') return g < SEA_LEVEL ? BRIDGE_Y : g;
    if (!P || P.length < 4) return Math.max(g, SEA_LEVEL) + MAGLEV_Y;
    const n = P.length / 2;
    const i0 = Math.max(0, Math.min(n - 1, k >> 1));
    let s = 0,
      c = 0;
    for (let j = Math.max(0, i0 - 6); j <= Math.min(n - 1, i0 + 6); j++) {
      const h = W.heightAt(P[j * 2], P[j * 2 + 1]);
      s += Math.max(h + 0.2 * BUILDING.scale, h + MAGLEV_Y);
      c++;
    }
    return Math.max(s / c, g + MAGLEV_Y * 0.8, g < SEA_LEVEL ? SEA_LEVEL + MAGLEV_Y * 0.8 : -1e9);
  }

  // A ship's twin one map width over (Round world): reads through to the ship
  // for everything but where she is (and her wake, which moves with her).
  _twin(v, s) {
    const t = Object.create(v);
    t.x = v.x + s;
    t.px = v.px + s;
    t.id = -v.id; // her own wake odometer
    if (v.track) {
      const T = (t.track = v.track.slice());
      for (let i = 0; i < T.length; i += 2) T[i] += s;
    }
    return t;
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

  // Wakes: a short V of foam off the bow and a churned trail along the
  // ship's own track that settles within a hull length or two, both sized by
  // her speed and gone when she stops; soft contact shadows under carts and
  // engines; far-zoom dots.
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
        if (!v || !v.alive || v.state === 'moored' || v.state === 'sinking') H.delete(id);
      }
    }
    if (wakesOn) {
      for (const w of wakes) {
        const v = w.v;
        const L = v.def.length;
        const T = v.track || [];
        // wake strength: grows with speed, nothing at all when she lies still
        const a = Math.min(1, v.speed / v.def.speed) * smoothstep(0.05, 0.3, v.speed);
        if (a < 0.01) continue;
        const beam = (v.def.beam || 0.4) / L;
        const fx = Math.cos(w.h),
          fz = Math.sin(w.h);
        // waterline foam and a short V of foam off the bow (local quad, in
        // ship lengths: the arms reach from the stem to just past the stern
        // at full speed, less when slow)
        const vLen = 0.5 + 0.8 * a;
        if (n < max) {
          const xb = 0.5 - vLen - 0.06,
            xf = 0.62;
          const zw = Math.max(beam * 0.6 + 0.05, beam * 0.22 + 0.34 * vLen + 0.14);
          const px = -fz,
            pz = fx;
          const c0x = w.x + fx * L * xb,
            c0z = w.z + fz * L * xb;
          const c1x = w.x + fx * L * xf,
            c1z = w.z + fz * L * xf;
          const hw = zw * L;
          quad(c0x + px * hw, c0z + pz * hw, c1x + px * hw, c1z + pz * hw, c1x - px * hw, c1z - pz * hw, c0x - px * hw, c0z - pz * hw, xb, zw, xf, zw, xf, -zw, xb, -zw, 2, a, a, beam, vLen, vLen, 0.022);
        }
        // the churned trail: resample the track back from the stern at even
        // steps and lay a short ribbon of broken water that settles within
        // one or two hull lengths (shorter when slow)
        let o = H.get(v.id);
        if (!o) H.set(v.id, (o = { x: w.x, z: w.z, d: 0 }));
        const mv = Math.hypot(w.x - o.x, w.z - o.z);
        o.d = (o.d + (mv < 3 ? mv : 0)) % 256;
        o.x = w.x;
        o.z = w.z;
        const odo = o.d;
        const maxS = L * (0.45 + 1.05 * a);
        const ds = Math.max(0.1, L * 0.13);
        const S = this._wk || (this._wk = new Float32Array(64 * 3));
        let ns = 0;
        let ax = w.x - fx * L * 0.5,
          az = w.z - fz * L * 0.5;
        S[0] = ax;
        S[1] = az;
        S[2] = 0;
        ns = 1;
        let acc = 0,
          next = ds,
          dirx = fx,
          dirz = fz;
        let i = T.length - 2;
        // points ahead of the stern are skipped
        while (i >= 0 && (T[i] - ax) * fx + (T[i + 1] - az) * fz > -0.05) i -= 2;
        let tail = false;
        while (acc < maxS && ns < 63) {
          let bx, bz;
          if (i >= 0) {
            bx = T[i];
            bz = T[i + 1];
            i -= 2;
          } else if (!tail) {
            // the track runs out: a short straight tail
            tail = true;
            const rest = Math.min(maxS - acc, L * 0.3);
            if (rest < 0.05) break;
            bx = ax - dirx * rest;
            bz = az - dirz * rest;
          } else break;
          const sl = Math.hypot(bx - ax, bz - az);
          if (sl < 1e-3) continue;
          if (sl > Math.max(3, L * 2)) break; // a jump in the track: end the wake here
          dirx = (ax - bx) / sl;
          dirz = (az - bz) / sl;
          while (next <= acc + sl && next <= maxS && ns < 63) {
            const k = (next - acc) / sl;
            S[ns * 3] = ax + (bx - ax) * k;
            S[ns * 3 + 1] = az + (bz - az) * k;
            S[ns * 3 + 2] = next;
            ns++;
            next += ds;
          }
          acc += sl;
          ax = bx;
          az = bz;
        }
        if (ns < 2 || n >= max - 6 * ns) continue;
        const hb = (v.def.beam || 0.4) * 0.5;
        const cw = (s) => hb * 0.6 + s * 0.09;
        const cfade = (s) => a * Math.min(1, 0.5 + s / (L * 0.2)) * Math.pow(Math.max(0, 1 - s / maxS), 1.6) * (v.anim.oar > 0.3 ? 1 : 0.85);
        // the normal at each sample, from its neighbours (smooth through turns)
        const nrm = (j) => {
          const j0 = Math.max(0, j - 1),
            j1 = Math.min(ns - 1, j + 1);
          let tx = S[j0 * 3] - S[j1 * 3],
            tz = S[j0 * 3 + 1] - S[j1 * 3 + 1];
          const tl = Math.hypot(tx, tz) || 1;
          return [-tz / tl, tx / tl];
        };
        let [n0x, n0z] = nrm(0);
        for (let j = 0; j < ns - 1; j++) {
          const [n1x, n1z] = nrm(j + 1);
          const x0 = S[j * 3],
            z0 = S[j * 3 + 1],
            s0 = S[j * 3 + 2],
            x1 = S[j * 3 + 3],
            z1 = S[j * 3 + 4],
            s1 = S[j * 3 + 5];
          const u0 = odo - s0,
            u1 = odo - s1;
          const c0 = cw(s0),
            c1 = cw(s1);
          quad(x0 + n0x * c0, z0 + n0z * c0, x0 - n0x * c0, z0 - n0z * c0, x1 - n1x * c1, z1 - n1z * c1, x1 + n1x * c1, z1 + n1z * c1, u0, 0, u0, 1, u1, 1, u1, 0, 1, cfade(s0), cfade(s1), beam, s0 / L, s1 / L);
          n0x = n1x;
          n0z = n1z;
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
        const y = Math.max(0.03, W.heightAt(x, z) + 0.05); // (an aircraft's shadow lies on the water too)
        quad(x - ax - bx, z - az - bz, x + ax - bx, z + az - bz, x + ax + bx, z + az + bz, x - ax + bx, z - az + bz, 0, 0, 1, 0, 1, 1, 0, 1, 3, 1, 1, 0, 0, 0, y);
      }
    }
    // contrails behind jets at height: soft ribbons widening as they fade
    const TL = blobsOn ? this.air?.trailList : null;
    if (TL?.length) {
      for (const tr of TL) {
        const T = tr.T;
        const np = T.length / 3;
        if (np < 2 || n >= max - 6 * np) continue;
        for (let j = np - 1; j > 0; j--) {
          const k0 = np - 1 - j,
            k1 = k0 + 1;
          const x0 = j === np - 1 ? tr.x : T[j * 3],
            z0 = j === np - 1 ? tr.z : T[j * 3 + 2],
            x1 = T[(j - 1) * 3],
            z1 = T[(j - 1) * 3 + 2];
          const dx = x1 - x0,
            dz = z1 - z0,
            L = Math.hypot(dx, dz) || 1;
          const px = -dz / L,
            pz = dx / L;
          const w0 = tr.w * (1 + k0 * 0.3),
            w1 = tr.w * (1 + k1 * 0.3);
          const a0 = (1 - k0 / (np - 1)) * Math.min(1, k0 * 0.5 + 0.15),
            a1 = (1 - k1 / (np - 1)) * Math.min(1, k1 * 0.5 + 0.15);
          const y = (T[j * 3 + 1] + T[(j - 1) * 3 + 1]) * 0.5 - 0.05;
          quad(x0 + px * w0, z0 + pz * w0, x0 - px * w0, z0 - pz * w0, x1 - px * w1, z1 - pz * w1, x1 + px * w1, z1 + pz * w1, k0, 0, k0, 1, k1, 1, k1, 0, 6, a0, a1, 0, 0, 0, y);
        }
      }
    }
    // far zoom: a dot per craft in its realm's colour
    if (dots) {
      const W = this.game.world;
      const { list, dist, cx, cz, R } = dots;
      const base = Math.max(0.5, dist * 0.0068);
      for (const v of list) {
        if (n >= max) break;
        if (!v.alive || v.state === 'sinking' || farHidden(v)) continue;
        if (Math.abs(v.x - cx) > R || Math.abs(v.z - cz) > R) continue;
        const sc = base * (v.cls === 'sea' ? (v.def.length > 2.3 * VEHICLE.sea ? 1.35 : v.kind === 'fishing' ? 0.7 : 1.1) : 0.75);
        const y = v.cls === 'sea' ? 0.6 + dist * 0.004 : W.heightAt(v.x, v.z) + 1.2 + dist * 0.004;
        const c = this._kingdomColor(v.kingdom);
        cr = c.r;
        cg = c.g;
        cb = c.b;
        quad(v.x - sc, v.z - sc, v.x + sc, v.z - sc, v.x + sc, v.z + sc, v.x - sc, v.z + sc, 0, 0, 1, 0, 1, 1, 0, 1, 4, 1, 1, 0, 0, 0, y);
      }
      // aircraft and rockets aloft: a smaller dot at their height
      for (const f of this.game.fleet?.air || []) {
        if (n >= max) break;
        if (!f.alive || Math.abs(f.x - cx) > R || Math.abs(f.z - cz) > R) continue;
        const sc = base * (f.cls === 'space' ? 0.9 : 0.6);
        const c = f.cls === 'space' ? this._white || (this._white = new THREE.Color(1.2, 1.15, 1.05)) : this._kingdomColor(f.kingdom);
        cr = c.r;
        cg = c.g;
        cb = c.b;
        quad(f.x - sc, f.z - sc, f.x + sc, f.z - sc, f.x + sc, f.z + sc, f.x - sc, f.z + sc, 0, 0, 1, 0, 1, 1, 0, 1, 4, 1, 1, 0, 0, 0, Math.max(f.y, 1) + dist * 0.004);
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

  // Catapult stones: a dark tumbling stone on its arc, trailing a thin smoke.
  _stones(F, alpha) {
    let n = 0;
    const L = F.stones;
    if (L.length) {
      const mesh = this._growProp('stones', L.length);
      const step = this.game.simStep || TICK;
      const at = (st, u) => {
        const x = st.x0 + (st.x1 - st.x0) * u,
          z = st.z0 + (st.z1 - st.z0) * u;
        return [x, st.y0 + (st.y1 - st.y0) * u + 4 * st.peak * u * (1 - u), z];
      };
      for (const st of L) {
        const u = Math.max(0, Math.min(1, (st.t + alpha * step) / st.dur));
        const [x, y, z] = at(st, u);
        this._e.set(u * 7, u * 3, u * 5, 'XYZ');
        this._q.setFromEuler(this._e);
        // a stone about a third of the arm's length (the arm is ~1.1 tiles)
        this._m.compose(this._p.set(x, y, z), this._q, this._s.setScalar(STONE_SCALE));
        mesh.setMatrixAt(n++, this._m);
        // a thin grey thread of smoke behind it, laid by distance flown (none
        // while paused) and only once it is well clear of the arm; a stone
        // first seen in mid-flight gets the trail it has already left
        const fx = this.game.fx;
        if (fx?.k && !this.game.paused && u - (st._pu ?? -1) >= 0.025) {
          const from = st._pu == null ? Math.max(0.1, u - 0.4) : u;
          for (let uu = from; uu <= u + 1e-6; uu += 0.025) {
            if (uu < 0.1 || uu > 0.92) continue;
            const [x, y, z] = at(st, uu);
            for (let i = fx.k(1); i > 0; i--) smokePuff(fx, x, y, z, { size: 0.16, ramp: RAMP.SMOKE_LIGHT, rise: 0.12, drift: 0.5, drag: 1.4, grow: 2.6, life: 1.1 + Math.random() * 0.6, lit: 0.9, alpha: 0.7 });
          }
          st._pu = u;
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.stones.count = n;
    this.stones.visible = n > 0;
  }

  // Arrows and fire pots arcing between ships: thin short glowing streaks (a
  // small blazing head for a pot), readable but delicate at any battle zoom.
  _shots(F, alpha, far) {
    let n = 0,
      np = 0;
    const L = F.shots || [];
    if (L.length && !far) {
      const mesh = this._growProp('arrows', L.length);
      const pm = this._growProp('pots', Math.min(L.length, 48));
      const step = this.game.simStep || TICK;
      const dist = this.game.cameraRig?.cur?.dist ?? 30;
      const th = Math.max(0.014, dist * 0.0011);
      const len = 0.22 + dist * 0.013;
      const fx = !this.game.paused && this.game.fx?.emit;
      for (const sh of L) {
        const u = (sh.t + alpha * step) / sh.dur;
        // a gun's muzzle flash and a puff of smoke as the shell leaves
        if (sh.shell && !sh._f && u >= 0 && fx) {
          sh._f = 1;
          this.game.fx.emit('sparks', { x: sh.x0, y: 0.45, z: sh.z0 }, { scale: 0.35 });
          if (Math.random() < 0.5) smokePuff(this.game.fx, sh.x0, 0.5, sh.z0, { size: 0.25, ramp: RAMP.SMOKE_LIGHT, rise: 0.4, drift: 1.2, grow: 2.4, life: 1.6, lit: 0.9, alpha: 0.6 });
        }
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
        const ln = Math.min(len, d * u + 0.2);
        this._m.compose(this._p.set(x, y, z), this._q, this._s.set(sh.pot ? ln * 0.8 : ln, sh.pot ? th * 1.4 : th, sh.pot ? th * 1.4 : th));
        mesh.setMatrixAt(n, this._m);
        mesh.setColorAt(n, sh.pot ? this._cPotTail : sh.shell ? this._cShell : this._cArrow);
        n++;
        if (sh.pot && np < pm.instanceMatrix.count) {
          this._m.compose(this._p, this._q, this._s.setScalar(Math.max(0.05, dist * 0.0026)));
          pm.setMatrixAt(np, this._m);
          pm.setColorAt(np, this._cPot);
          np++;
          if (fx && Math.random() < 0.12) this.game.fx.emit('fire', { x, y, z }, { scale: 0.16 });
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      pm.instanceMatrix.needsUpdate = true;
      if (pm.instanceColor) pm.instanceColor.needsUpdate = true;
    }
    this.arrows.count = n;
    this.arrows.visible = n > 0;
    this.pots.count = np;
    this.pots.visible = np > 0;
  }

  // Faint dashed trade lanes at mid zoom (rebuilt twice a second).
  _lanes(F, dt, dist, far) {
    const z01 = this.game.view?.zoom01 ?? 0.5;
    const on = !far && z01 > 0.12 && dist > 45 && !this.game.settings?.powerSaver;
    this.lanes.visible = on;
    if (!on) return;
    // faint at mid zoom, gone by far zoom (white dashes over the sea read as debug lines)
    const laneFar = 1 - Math.min(1, Math.max(0, (dist - 70) / 30));
    // and gone when the camera looks (nearly) straight down: from above a
    // pale dashed line across open sea reads as a debug line (round 20)
    const rig = this.game.cameraRig;
    const pitch = rig?.pitchFor ? rig.pitchFor(dist) : 0.8;
    const laneTop = 1 - Math.min(1, Math.max(0, (pitch - 0.9) / 0.15)); // 52 to 60 degrees
    // (round 33) a faint trace only: at most 0.05 alpha, dimming with the
    // daylight and gone at night (white dashes crossed the sea at 60-90
    // tiles and shone brightest at night, reading as debug lines)
    const day = this.game.env?.daylight ?? 1;
    const dayK = Math.min(1, Math.max(0, (day - 0.15) / 0.45));
    this.uniforms.uLaneAlpha.value = 0.05 * Math.min(1, (dist - 45) / 20) * laneFar * laneTop * dayK;
    if (laneTop <= 0.01 || this.uniforms.uLaneAlpha.value < 0.004) {
      this.lanes.visible = false;
      return;
    }
    if ((this._laneT -= dt) > 0) return;
    this._laneT = 0.5;
    const geo = this.lanes.geometry;
    const P = geo.attributes.position.array,
      C = geo.attributes.aC.array,
      D = geo.attributes.aUV.array;
    let n = 0;
    // (Round world: a route across the seam runs on past the map's side in
    // one continuous line; it is drawn on the map, split at the seam)
    const W = geoWrapOn(this.game.world) ? this.game.world.w : 0;
    let c = null;
    const seg = (ax, az, bx, bz, d0, d1) => {
      P[n * 3] = ax;
      P[n * 3 + 1] = 0.05;
      P[n * 3 + 2] = az;
      P[n * 3 + 3] = bx;
      P[n * 3 + 4] = 0.05;
      P[n * 3 + 5] = bz;
      // the realm's colour, softened (it was lifted twice, here and in the
      // shader, and drew near-white)
      for (let q = 0; q < 2; q++) {
        C[(n + q) * 3] = c.r * 0.8 + 0.12;
        C[(n + q) * 3 + 1] = c.g * 0.8 + 0.12;
        C[(n + q) * 3 + 2] = c.b * 0.8 + 0.12;
      }
      D[n * 2] = d0;
      D[n * 2 + 2] = d1;
      n += 2;
    };
    for (const lane of F.lanes()) {
      const v = F.get(lane.id);
      const p = lane.path;
      c = this._kingdomColor(lane.kingdom);
      let acc = 0;
      let px = v ? v.x : p[0],
        pz = v ? v.z : p[1];
      for (let i = Math.max(0, (v?.pi ?? 0)); i < p.length; i += 2) {
        if (n + 4 > this._laneMax) break;
        const x = p[i],
          z = p[i + 1];
        const L = Math.hypot(x - px, z - pz);
        const k0 = W ? Math.floor(px / W) : 0,
          k1 = W ? Math.floor(x / W) : 0;
        if (k0 === k1) seg(px - k0 * W, pz, x - k0 * W, z, acc, acc + L);
        else {
          // the seam at x = k * W: up to the edge, then on from the other one
          const k = Math.max(k0, k1);
          const t = (k * W - px) / (x - px || 1);
          const zs = pz + (z - pz) * t;
          seg(px - k0 * W, pz, k * W - k0 * W, zs, acc, acc + L * t);
          seg(k * W - k1 * W, zs, x - k1 * W, z, acc + L * t, acc + L);
        }
        acc += L;
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
    if (!fx?.emit || far || dist > 120 || this.game.paused) return;
    if ((this._fxT -= dt) > 0) return;
    this._fxT = this.game.settings?.powerSaver ? 0.5 : 0.25;
    const R = dist * 1.1 + 12;
    let budget = 6;
    for (const v of F.list) {
      if (!v.alive || budget <= 0) continue;
      if (Math.abs(v.x - cx) > R || Math.abs(v.z - cz) > R) continue;
      // a submarine running submerged shows no fire: flames, smoke and
      // embers over an empty wake read as orange sparks trailing nothing
      if (v.def.sub && v.state !== 'moored' && !(v.sink > 0)) continue;
      if (v.burning > 0.15 || (v.sink > 0 && v.sink < 0.5)) {
        // a burning ship trails a grey-white plume that leans downwind and
        // thins out (one thin puff at the deck, the plume above it, so the
        // hull stays readable) and throws embers
        const L = v.def.length;
        this._plume(fx, v.x, (v.y || 0) + 0.9, v.z, 0.45 + L * 0.15, 0.75);
        if (v.burning > 0.4) for (let i = 0; i < 2; i++) this._plume(fx, v.x, (v.y || 0) + 1.8 + i * 0.6, v.z, 0.7 + L * 0.18, 0.5);
        if (v.burning > 0.2) {
          fx.emit('fire', { x: v.x + (Math.random() - 0.5) * 0.5, y: (v.y || 0) + 0.4, z: v.z }, { scale: 0.5 });
          if (v.burning > 0.45 && Math.random() < 0.3) fx.emit('embers', { x: v.x, y: (v.y || 0) + 0.8, z: v.z }, { count: 1 });
        }
        budget--;
      }
      if (v.sink > 0 && v.sink < 0.6) {
        // going down: spray, and steam where a burning hull meets the sea
        if (v.sink < 0.25) fx.emit('splash', { x: v.x, y: 0, z: v.z }, { scale: 0.5 });
        if (v.burning > 0.05 || v.lastCause === 'fire' || v.lastCause === 'lightning') fx.emit('steam', { x: v.x, y: 0.1, z: v.z }, { scale: 0.5 + v.def.length * 0.2, count: 1 });
        budget--;
      }
    }
    // smoke from the funnels of steamers and warships and from steam engines
    // and tractors at work: a puff from each stack, drifting downwind
    let smoke = this.game.settings?.powerSaver ? 4 : 10;
    const wind = this.game.env?.wind || { x: 1, z: 0 };
    for (const v of F.list) {
      if (smoke <= 0) break;
      const def = v.def;
      if (!v.alive || !def.smoke || v.sink > 0 || (v.speed < 0.05 && v.state !== 'moored' && v.cls === 'sea')) continue;
      if (v.kind === 'train' && (this.game.civ?.kingdoms?.[v.kingdom]?.era ?? 0) >= 6) continue; // diesel by then
      if (Math.abs(v.x - cx) > R || Math.abs(v.z - cz) > R) continue;
      const md = vehicleModel(v.kind);
      if (!md.smoke.length) continue;
      const moored = v.state === 'moored' || v.speed < 0.05;
      if (moored && Math.random() < 0.7) continue; // banked fires in port: a thin wisp
      const c = Math.cos(v.heading),
        s = Math.sin(v.heading);
      const sc = def.scale || 1;
      for (const p of md.smoke) {
        const x = v.x + (c * p.x - s * p.z) * sc,
          z = v.z + (s * p.x + c * p.z) * sc;
        const y = (v.y || 0) + p.y * sc;
        const big = v.cls === 'sea' ? 0.22 + def.length * 0.06 : v.kind === 'train' ? 0.26 : 0.16;
        if (v.cls === 'sea') {
          // over the water: a cool grey that rises and thins out quickly (the
          // warm dark land smoke lay on the sea as brown stains, round 16)
          const coal = v.kind === 'steamer' || v.kind === 'ironclad';
          for (let i = fx.k(1); i > 0; i--) smokePuff(fx, x, y, z, { size: big * 0.85, ramp: RAMP.SMOKE_LIGHT, color: coal ? 0xa6abb2 : PLUME_TINT, alpha: moored ? 0.28 : 0.5, rise: 1.25, drift: 1.1 + Math.hypot(wind.x, wind.z) * 0.6, drag: 0.7, grow: 2.3, life: 1.6 + Math.random() * 0.9, lit: 0.75 });
        } else for (let i = fx.k(1); i > 0; i--) smokePuff(fx, x, y, z, { size: big, ramp: v.kind === 'train' ? RAMP.SMOKE_DARK : RAMP.SMOKE_LIGHT, rise: 0.6, drift: 1.6 + Math.hypot(wind.x, wind.z), drag: 0.8, grow: 2.6, life: 2.4 + Math.random() * 1.4, lit: 0.85, alpha: moored ? 0.35 : 0.7 });
        smoke--;
      }
    }
  }

  // One puff of a combat plume over the water: light grey-white (never the
  // warm dark land smoke, which reads as brown over the sea), carried off
  // with the wind more than it rises, swelling and fading as it goes.
  _plume(fx, x, y, z, size, alpha) {
    for (let i = fx.k(1); i > 0; i--) smokePuff(fx, x, y, z, { size, ramp: RAMP.SMOKE_LIGHT, color: PLUME_TINT, alpha, rise: 0.75, drift: 2.8, drag: 0.7, grow: 2.9, life: 3.2 + Math.random() * 1.6, lit: 0.9 });
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
