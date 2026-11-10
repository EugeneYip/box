import * as THREE from 'three';
import { craneGeometry } from './archetypes.js';
import { buildArchetype, foundation, scaffold, ruin, wallPost, wallArm, lampPost, frameFor, materialPile, proxyGeometry, PAL, WALL_H } from './archetypes.js';
import { Labels } from './labels.js';
import { createBuildingMaterial, createPropMaterial } from './material.js';
import { emblemAtlas, EMBLEM_IDS, FIELD_IDS } from './emblems.js';
import { bannerGeometry, bannerMaterial, bladesGeometry, boatGeometry, FENCE, scarecrowGeometry, glowTexture, PuffSystem } from './props.js';
import { TerritoryOverlay } from './TerritoryOverlay.js';
import { BUILDING_TYPES } from '../../sim/civ/catalog.js';
import { CULTURES, baseCulture } from '../../sim/civ/cultures.js';
import { SEA_LEVEL, TILE } from '../../world/constants.js';
import { hash2 } from '../../core/Random.js';

// Renders game.civ.buildings as instanced, merged procedural architecture
// (one InstancedMesh per type x style x level x stage), plus waving banners,
// turning windmill sails, bobbing boats, field fences, scarecrows, street
// lanterns, chimney smoke, night window glow, construction stages, fire,
// ruins and the kingdom territory overlay.
//
// Reads building fields: {id, type, tx, ty, w, h, x, y, z, rotation, kingdom,
// village, level, progress, constructing, upgrading, hp, maxHp, burning,
// alive, style, groundMin, seed}.

const DIRS8 = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

class Batch {
  constructor(parent, geo, material, { shadow = true } = {}) {
    this.parent = parent;
    this.base = geo;
    this.material = material;
    this.shadow = shadow;
    this.cap = 0;
    this.mesh = null;
    this.items = [];
  }
  ensure(n) {
    if (n <= this.cap && this.mesh) return;
    const cap = Math.max(8, Math.ceil(n * 1.4));
    const geo = new THREE.BufferGeometry();
    for (const k of Object.keys(this.base.attributes)) geo.setAttribute(k, this.base.attributes[k]);
    geo.boundingSphere = this.base.boundingSphere;
    this.iColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.iState = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.iColor.setUsage(THREE.DynamicDrawUsage);
    this.iState.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iColor', this.iColor);
    geo.setAttribute('iState', this.iState);
    const mesh = new THREE.InstancedMesh(geo, this.material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = this.shadow;
    mesh.receiveShadow = true;
    mesh.count = 0;
    if (this.mesh) {
      this.parent.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.dispose();
    }
    this.mesh = mesh;
    this.cap = cap;
    this.parent.add(mesh);
  }
}

export class BuildingRenderer {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'civ-buildings';
    game.scene.add(this.group);
    this.uniforms = { uTime: { value: 0 }, uNight: { value: 0 }, uWind: { value: 0.35 }, uEmblems: { value: emblemAtlas() } };
    this.mat = createBuildingMaterial(this.uniforms);
    this.matClip = createBuildingMaterial(this.uniforms, { clip: true });
    this.propMat = createPropMaterial();
    this.arche = new Map();
    this.batches = new Map();
    this.overlay = new TerritoryOverlay(game);
    this._ver = -1;
    this._cver = -1;
    this._sver = -1;
    this._fver = -1;
    this._lastRebuild = -1;
    this._lastState = -1;
    this._lastFence = -1;
    this.t = 0;
    this._m = new THREE.Matrix4();
    this._m2 = new THREE.Matrix4();
    this._m3 = new THREE.Matrix4();
    this.lodDist = 150; // beyond this camera distance whole towns draw as one proxy batch per style
    this.propDist = 120; // fences, lanterns, scarecrows, boats culled beyond this
    this._far = false;
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    this._up = new THREE.Vector3(0, 1, 0);
    this._initProps();
    this.chimneys = [];
    this.banners = [];
    this.staffs = [];
    this.labels = new Labels(game, this.group);
    this.blades = [];
    this.boats = [];
    this.burning = [];
    this._fxReal = null;
  }

  reset() {
    this._ver = -1;
    this._fver = -1;
    this.overlay.markAll();
    this.puffs?.clear();
  }

  // ------------------------------------------------------------------ props
  _initProps() {
    const scene = this.group;
    // stone footings that keep every building grounded on uneven terrain
    const fgeo = new THREE.BoxGeometry(1, 1, 1).translate(0, -0.5, 0);
    this.footing = new THREE.InstancedMesh(fgeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }), 64);
    this.footing.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3), 3);
    this.footing.castShadow = false;
    this.footing.receiveShadow = true;
    this.footing.count = 0;
    scene.add(this.footing);
    this.bannerMat = bannerMaterial(this.uniforms);
    this.bannerMeshes = new Map();
    this.bladeMeshes = new Map();
    this.boatMeshes = new Map();
    for (const st of ['vale', 'dune', 'frost', 'mire']) {
      this.bannerMeshes.set(st, this._inst(bannerGeometry(st), this.bannerMat, 32, false));
      this.bladeMeshes.set(st, this._inst(bladesGeometry(st), this.propMat, 8, false));
      this.boatMeshes.set(st, this._inst(boatGeometry(st), this.propMat, 16, false));
    }
    // ground glow under lanterns & doors at night
    const dgeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.decalMat = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffb060, opacity: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    this.decals = new THREE.InstancedMesh(dgeo, this.decalMat, 256);
    this.decals.count = 0;
    this.decals.renderOrder = 3;
    this.decals.frustumCulled = false;
    scene.add(this.decals);
    // fences
    this.fenceMeshes = new Map();
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    for (const st of Object.keys(FENCE)) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 });
      const posts = new THREE.InstancedMesh(box, mat, 64);
      const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, 64);
      for (const m of [posts, rails]) {
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3), 3);
        m.castShadow = true;
        m.receiveShadow = true;
        m.count = 0;
        scene.add(m);
      }
      this.fenceMeshes.set(st, { posts, rails, cap: 64 });
    }
    // tall staffs for capital standards and army standard-bearers
    this.staffGeo = new THREE.CylinderGeometry(0.03, 0.04, 1, 6).translate(0, 0.5, 0);
    this.staffMesh = this._inst(this.staffGeo, new THREE.MeshStandardMaterial({ color: 0x5a3c24, roughness: 0.8 }), 16, true);
    this.staffMap = new Map([['s', this.staffMesh]]);
    this.scarecrows = new Map();
    for (const st of ['vale', 'frost', 'mire']) this.scarecrows.set(st, this._inst(scarecrowGeometry(st), this.propMat, 16, false));
    // selection ring
    const ring = new THREE.RingGeometry(0.92, 1.0, 64).rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.ring.visible = false;
    this.ring.renderOrder = 4;
    scene.add(this.ring);
    this.pickRing = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.pickRing.visible = false;
    this.pickRing.renderOrder = 4;
    scene.add(this.pickRing);
  }

  _inst(geo, mat, cap, shadow) {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = shadow;
    m.receiveShadow = true;
    m.count = 0;
    m.frustumCulled = false;
    m.userData.geo = geo;
    m.userData.mat = mat;
    m.userData.shadow = shadow;
    this.group.add(m);
    return m;
  }
  _grow(map, key, n) {
    let m = map.get(key);
    if (m.instanceMatrix.count >= n) return m;
    const nm = new THREE.InstancedMesh(m.userData.geo, m.userData.mat, Math.ceil(n * 1.5));
    nm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    nm.castShadow = m.userData.shadow;
    nm.receiveShadow = true;
    nm.frustumCulled = false;
    nm.userData = m.userData;
    if (m.instanceColor) nm.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.ceil(n * 1.5) * 3), 3);
    this.group.remove(m);
    m.dispose();
    this.group.add(nm);
    map.set(key, nm);
    return nm;
  }

  // ------------------------------------------------------------------ archetypes
  _arch(key) {
    let a = this.arche.get(key);
    if (a) return a;
    const [kind, p1, p2, p3, p4] = key.split('|');
    if (kind === 'found') a = { geo: foundation(+p1, +p2), anchors: null, maxY: 0.3 };
    else if (kind === 'scaf') a = { geo: scaffold(+p1, +p2, +p3), anchors: null, maxY: +p3 };
    else if (kind === 'ruin') a = { geo: ruin(p1, +p2, +p3, +p4), anchors: null, maxY: 0.6 };
    else if (kind === 'wpost') a = { geo: wallPost(p1), anchors: null, maxY: WALL_H + 0.1 };
    else if (kind === 'warm') a = { geo: wallArm(p1, 0.5), anchors: null, maxY: WALL_H + 0.1 };
    else if (kind === 'wdiag') a = { geo: wallArm(p1, Math.SQRT1_2), anchors: null, maxY: WALL_H + 0.1 };
    else if (kind === 'frame') {
      // generic timber frame for a footprint and finished height
      const w = +p1,
        h = +p2,
        my = +p3;
      const pseudo = { geo: { boundingBox: { min: { x: -w * 0.42, z: -h * 0.42 }, max: { x: w * 0.42, z: h * 0.42 } } }, base: null, maxY: my };
      a = { geo: frameFor(pseudo), anchors: null, maxY: my };
    } else if (kind === 'pile') a = { geo: materialPile('vale'), anchors: null, maxY: 0.3 };
    else if (kind === 'crane') a = craneGeometry();
    else if (kind === 'proxy') a = { geo: proxyGeometry(p1), anchors: null, maxY: 1 };
    else if (kind === 'lamppost') {
      const l = lampPost();
      a = { geo: l.geo, anchors: l.anchors, maxY: 0.8 };
    } else a = buildArchetype(kind, p1, +p2, p3 == null ? 1 : +p3, p4 == null ? 0 : +p4);
    this.arche.set(key, a);
    return a;
  }

  _batch(key, clip = false) {
    const bk = clip ? key + '|clip' : key;
    let b = this.batches.get(bk);
    if (!b) {
      const a = this._arch(key);
      const small = /^(well|pile|found|ruin|lamppost)/.test(key);
      b = new Batch(this.group, a.geo, clip ? this.matClip : this.mat, { shadow: !clip && !small });
      this.batches.set(bk, b);
    }
    return b;
  }

  // ------------------------------------------------------------------ rebuild
  _stage(b) {
    if (!b.alive) return 'ruin';
    if (b.constructing) return b.progress < 0.12 ? 'found' : b.progress < 0.4 ? 'frame' : 'build';
    return b.upgrading ? 'upg' : 'done';
  }

  _rebuild() {
    const g = this.game;
    const civ = g.civ;
    const world = g.world;
    const lists = new Map();
    const push = (key, clip, m, color, b, extra = null) => {
      const bk = clip ? key + '|clip' : key;
      let L = lists.get(bk);
      if (!L) lists.set(bk, (L = { key, clip, m: [], col: [], bs: [], extra: [] }));
      for (let i = 0; i < 16; i++) L.m.push(m.elements[i]);
      L.col.push(color.r, color.g, color.b);
      L.bs.push(b);
      L.extra.push(extra);
    };
    const footings = [];
    this.chimneys.length = 0;
    this.banners.length = 0;
    this.blades.length = 0;
    this.boats.length = 0;
    const decals = [];
    const col = new THREE.Color();
    // wall connectivity
    const wallAt = new Map();
    for (const b of civ.buildings) if (!b.gone && b.alive && BUILDING_TYPES[b.type]?.wall) wallAt.set(b.ty * world.w + b.tx, b);

    for (const b of civ.buildings) {
      if (b.gone) continue;
      const def = BUILDING_TYPES[b.type];
      if (!def) continue;
      col.setHex(civ.kingdomColor(b.kingdom));
      const stage = this._stage(b);
      b._stage = stage;
      const M = this._m.makeRotationY(b.rotation || 0).setPosition(b.x, b.y, b.z);
      if (stage === 'ruin') {
        if (def.wall) continue;
        push(`ruin|${b.style}|${def.w}|${def.h}|1`, false, M, col, b);
        continue;
      }
      if (def.wall) {
        const clip = b.constructing;
        if (b.type === 'wall') push(`wpost|${b.style}`, clip, this._m2.makeTranslation(b.x, b.y, b.z), col, b, { wall: true });
        else {
          const a = this._arch(`${b.type}|${b.style}|1`);
          push(`${b.type}|${b.style}|1`, clip, M, col, b, { maxY: a.maxY });
          if (!clip) this._collectAnchors(b, a, M, col, decals);
        }
        // arms toward connected neighbours
        for (const [dx, dy] of DIRS8) {
          const nb = wallAt.get((b.ty + dy) * world.w + b.tx + dx);
          if (!nb || nb.village !== b.village) continue;
          if (dx && dy && (wallAt.has(b.ty * world.w + b.tx + dx) || wallAt.has((b.ty + dy) * world.w + b.tx))) continue;
          const yaw = Math.atan2(-dy, dx);
          const am = this._m2.makeRotationY(yaw).setPosition(b.x, b.y, b.z);
          if (dx && dy) am.multiply(this._m3.makeScale(Math.SQRT2, 1, 1));
          push(`warm|${b.style}`, clip, am, col, b, { wall: true });
        }
        continue;
      }
      const lvl = Math.min(b.level || 1, def.levels);
      const akey = `${b.type}|${b.style}|${lvl}|${b.era ?? 1}${b.variant ? '|' + b.variant : ''}`;
      const a = this._arch(akey);
      if (stage === 'found' || stage === 'frame' || stage === 'build') {
        // footings, then a timber frame, then walls rising, then the roof;
        // timber and stone stacked by the site until it is done
        if (stage === 'found') push(`found|${def.w}|${def.h}`, false, M, col, b);
        else push(`frame|${def.w}|${def.h}|${Math.min(3, Math.max(1, Math.round(a.maxY * 2) / 2))}`, false, M, col, b);
        if (stage === 'build') push(akey, true, M, col, b, { maxY: a.maxY });
        const pm = this._m2.copy(M).multiply(new THREE.Matrix4().makeTranslation(def.w / 2 - 0.35, 0, def.h / 2 - 0.3));
        push(`pile`, false, pm, col, b);
        // Engineering: a tower crane over the larger sites
        if (stage !== 'found' && def.w * def.h >= 4 && civ.hasTech?.(b.kingdom, 'engineering')) {
          const cm = new THREE.Matrix4().copy(M).multiply(new THREE.Matrix4().makeTranslation(-def.w / 2 + 0.25, 0, -def.h / 2 + 0.25));
          push('crane', false, cm, col, null);
          civ._firstUse?.(civ.kingdoms[b.kingdom], 'crane', { x: b.x, z: b.z });
        }
      } else {
        push(akey, false, M, col, b);
        if (stage === 'upg') push(`scaf|${def.w}|${def.h}|${Math.min(3, Math.round(a.maxY * 2) / 2)}`, false, M, col, b);
        this._collectAnchors(b, a, M, col, decals);
      }
      if (a.base && !a.stilts && stage !== 'found') {
        const bx = a.base.x || 0,
          bz = a.base.z || 0;
        const top = b.y + 0.04;
        const bottom = Math.min(b.groundMin ?? b.y, b.y) - 0.35;
        const fm = new THREE.Matrix4().makeRotationY(b.rotation || 0);
        fm.setPosition(b.x, top, b.z);
        fm.multiply(new THREE.Matrix4().makeTranslation(bx, 0, bz));
        fm.multiply(new THREE.Matrix4().makeScale(a.base.w + 0.04, top - bottom, a.base.d + 0.04));
        footings.push({ m: fm, style: b.style });
      }
    }
    // the realm's standard flies over every capital
    this.staffs = [];
    for (const k of civ.kingdoms) {
      if (!k.alive) continue;
      const v = civ.villages[k.capital];
      const h = v?.hall;
      if (!v || !v.alive || !h || !h.alive || h.constructing) continue;
      const r = h.rotation || 0;
      const side = 1.75;
      const x = h.x + Math.cos(r) * side + Math.sin(r) * 1.2,
        z = h.z - Math.sin(r) * side + Math.cos(r) * 1.2;
      const gy = world.heightAt(x, z);
      this.staffs.push([x, gy, z, 3.2]);
      this.banners.push({ x: x + 0.03, y: gy + 3.15, z, s: 2.4, style: h.style, color: civ.kingdomColor(k.id), k: k.id });
    }
    // lampposts along town streets
    for (const v of civ.villages) {
      if (!v.alive || v.tier < 1) continue;
      col.setHex(civ.kingdomColor(v.kingdom));
      // a realm of masters lights more of its streets
      const lampP = 0.11 + Math.min(0.12, (civ.kingdoms[v.kingdom]?.mastery || 0) * 0.015);
      for (const i of v.roadTiles) {
        if (civ.use?.[i] !== 2) continue;
        const tx = i % world.w,
          ty = (i / world.w) | 0;
        if (hash2(tx, ty, 91) > lampP) continue;
        if (Math.hypot(tx + 0.5 - v.cx, ty + 0.5 - v.cz) > v.radius * 0.8) continue;
        // stand on the road edge next to a building or plot
        let ox = 0,
          oz = 0;
        for (const [dx, dy] of DIRS8.slice(0, 4)) {
          const j = (ty + dy) * world.w + tx + dx;
          if (world.building[j] >= 0) {
            ox = dx * 0.38;
            oz = dy * 0.38;
            break;
          }
        }
        if (!ox && !oz) continue;
        const x = tx + 0.5 + ox,
          z = ty + 0.5 + oz;
        const lm = this._m2.makeRotationY(Math.atan2(-oz, ox) + Math.PI).setPosition(x, world.heightAt(x, z), z);
        push('lamppost', false, lm, col, null);
        decals.push([x - ox * 0.4, world.heightAt(x, z), z - oz * 0.4, 0.6]);
      }
    }
    // write batches
    const used = new Set();
    for (const [bk, L] of lists) {
      used.add(bk);
      const batch = this._batch(L.key, L.clip);
      const n = L.bs.length;
      batch.ensure(n);
      const mesh = batch.mesh;
      mesh.instanceMatrix.array.set(L.m);
      batch.iColor.array.set(L.col);
      batch.items = L.bs;
      batch.extra = L.extra;
      mesh.count = n;
      mesh.visible = n > 0;
      this._writeStates(batch);
      mesh.instanceMatrix.needsUpdate = true;
      batch.iColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    for (const [bk, batch] of this.batches) if (!used.has(bk) && batch.mesh) batch.mesh.count = 0;
    // far-zoom proxies
    const proxies = new Map();
    for (const b of civ.buildings) {
      if (b.gone || !b.alive) continue;
      const def = BUILDING_TYPES[b.type];
      if (!def) continue;
      const key = 'proxy|' + b.style;
      let L = proxies.get(key);
      if (!L) proxies.set(key, (L = { m: [], col: [], bs: [] }));
      const a = this._arch(def.wall ? `wpost|${b.style}` : `${b.type}|${b.style}|${Math.min(b.level || 1, def.levels)}|${b.era ?? 1}${b.variant ? '|' + b.variant : ''}`);
      const hgt = def.wall ? 1.1 : Math.max(0.5, Math.min(def.monument ? 12 : 3, a.maxY)) * (b.constructing ? Math.max(0.2, b.progress) : 1);
      const pm = this._m2.makeRotationY(b.rotation || 0).setPosition(b.x, b.y, b.z).multiply(this._m3.makeScale(def.w * 0.82, hgt, def.h * 0.82));
      for (let i = 0; i < 16; i++) L.m.push(pm.elements[i]);
      col.setHex(civ.kingdomColor(b.kingdom));
      L.col.push(col.r, col.g, col.b);
      L.bs.push(b);
    }
    this.proxyBatches = this.proxyBatches || new Map();
    for (const [key, L] of proxies) {
      let batch = this.proxyBatches.get(key);
      if (!batch) {
        batch = new Batch(this.group, this._arch(key).geo, this.mat, { shadow: true });
        this.proxyBatches.set(key, batch);
      }
      batch.ensure(L.bs.length);
      batch.mesh.instanceMatrix.array.set(L.m);
      batch.iColor.array.set(L.col);
      batch.items = L.bs;
      batch.extra = [];
      batch.mesh.count = L.bs.length;
      this._writeStates(batch);
      for (let i = 0; i < L.bs.length; i++) batch.iState.array[i * 4 + 3] = 99;
      batch.mesh.instanceMatrix.needsUpdate = true;
      batch.iColor.needsUpdate = true;
      batch.mesh.computeBoundingSphere();
    }
    for (const [key, batch] of this.proxyBatches) if (!proxies.has(key) && batch.mesh) batch.mesh.count = 0;
    this._applyLod(true);
    // footings
    if (footings.length > this.footing.instanceMatrix.count) {
      const nm = new THREE.InstancedMesh(this.footing.geometry, this.footing.material, Math.ceil(footings.length * 1.5));
      nm.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.ceil(footings.length * 1.5) * 3), 3);
      nm.receiveShadow = true;
      this.group.remove(this.footing);
      this.footing.dispose();
      this.footing = nm;
      this.group.add(nm);
    }
    for (let i = 0; i < footings.length; i++) {
      this.footing.setMatrixAt(i, footings[i].m);
      this._c.setHex(PAL[footings[i].style]?.stone2 ?? 0x847c70);
      this.footing.setColorAt(i, this._c);
    }
    this.footing.count = footings.length;
    this.footing.instanceMatrix.needsUpdate = true;
    if (this.footing.instanceColor) this.footing.instanceColor.needsUpdate = true;
    this.footing.computeBoundingSphere();
    // decals
    if (decals.length > this.decals.instanceMatrix.count) {
      const nm = new THREE.InstancedMesh(this.decals.geometry, this.decalMat, Math.ceil(decals.length * 1.5));
      nm.renderOrder = 3;
      nm.frustumCulled = false;
      this.group.remove(this.decals);
      this.decals.dispose();
      this.decals = nm;
      this.group.add(nm);
    }
    for (let i = 0; i < decals.length; i++) {
      const [x, y, z, r] = decals[i];
      this._m.compose(this._p.set(x, y + 0.03, z), this._q.identity(), this._s.set(r * 2, 1, r * 2));
      this.decals.setMatrixAt(i, this._m);
    }
    this.decals.count = decals.length;
    this.decals.instanceMatrix.needsUpdate = true;
    this._updateBoatsAndBlades(0, true);
  }

  _collectAnchors(b, a, M, col, decals) {
    const an = a.anchors;
    if (!an) return;
    const world = this.game.world;
    const p = this._p;
    for (const c of an.chimneys) {
      p.set(c.x, c.y, c.z).applyMatrix4(M);
      this.chimneys.push({ x: p.x, y: p.y, z: p.z, rate: c.rate || 1, forge: !!c.forge, b, t: Math.random() * 3 });
    }
    for (const c of an.banners) {
      p.set(c.x, c.y, c.z).applyMatrix4(M);
      this.banners.push({ x: p.x, y: p.y, z: p.z, s: c.s || 1, style: b.style, color: col.getHex(), k: b.kingdom });
    }
    for (const c of an.blades) {
      const bm = new THREE.Matrix4().copy(M).multiply(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z));
      this.blades.push({ m: bm, style: b.style, phase: b.seed * 10 });
    }
    const moreShips = b.type === 'docks' && (this.game.civ?.kingdoms?.[b.kingdom]?.mastery || 0) >= 8;
    for (const c of moreShips ? [...an.boats, ...an.boats.map((o) => ({ ...o, x: o.x + 0.55, z: o.z + 0.35, ship: true }))] : an.boats) {
      p.set(c.x, c.y, c.z).applyMatrix4(M);
      const tx = Math.floor(p.x),
        tz = Math.floor(p.z);
      if (!world.inBounds(tx, tz) || world.height[tz * world.w + tx] >= SEA_LEVEL) continue;
      this.boats.push({ x: p.x, z: p.z, ry: (b.rotation || 0) + (c.ry || 0), style: c.ship ? (b.style === 'frost' || b.style === 'vale' ? 'frost' : 'dune') : b.style, phase: b.seed * 20 + this.boats.length, s: c.ship ? 1.75 : 1 });
    }
    for (const c of an.lamps) {
      if (c.water) continue;
      p.set(c.x, c.y, c.z).applyMatrix4(M);
      const tx = Math.floor(p.x),
        tz = Math.floor(p.z);
      if (!world.inBounds(tx, tz)) continue;
      const ti = tz * world.w + tx;
      if (world.height[ti] < SEA_LEVEL + 0.05 || world.type[ti] === TILE.FARMLAND) continue;
      if (world.slopeAt(tx, tz) > 0.5) continue;
      decals.push([p.x, world.heightAt(p.x, p.z), p.z, Math.min(0.75, (c.r || 1) * 0.5)]);
    }
  }

  _writeStates(batch) {
    const arr = batch.iState.array;
    const items = batch.items;
    let burning = false;
    for (let i = 0; i < items.length; i++) {
      const b = items[i];
      const k = i * 4;
      if (!b) {
        arr[k] = 0;
        arr[k + 1] = 0;
        arr[k + 2] = 0.37;
        arr[k + 3] = 99;
        continue;
      }
      const hpf = b.maxHp ? b.hp / b.maxHp : 1;
      let dmg = b.alive ? Math.max(0, 1 - hpf - 0.12) / 0.88 : 0.7;
      if (b.constructing) dmg = 0;
      arr[k] = Math.min(1, dmg);
      arr[k + 1] = b.burning || 0;
      arr[k + 2] = b.seed || 0;
      let clipY = 99;
      if (b.constructing && b.progress >= 0.4) {
        const maxY = batch.extra?.[i]?.maxY ?? (BUILDING_TYPES[b.type]?.wall ? WALL_H + 0.1 : 2);
        const t = (b.progress - 0.4) / 0.6;
        clipY = batch.extra?.[i]?.wall ? -0.5 + (WALL_H + 0.65) * b.progress : -0.1 + (maxY + 0.15) * t;
      } else if (b.constructing && batch.extra?.[i]?.wall) clipY = -0.5 + (WALL_H + 0.65) * b.progress;
      arr[k + 3] = clipY;
      if (b.burning > 0.02) burning = true;
    }
    batch.iState.needsUpdate = true;
    return burning;
  }

  _updateStates() {
    const civ = this.game.civ;
    // stage changes need a structural rebuild
    for (const b of civ.buildings) if (!b.gone && b._stage && b._stage !== this._stage(b)) return this._rebuild();
    for (const batch of this.batches.values()) if (batch.mesh && batch.mesh.count) this._writeStates(batch);
  }

  // ------------------------------------------------------------------ fences & fields
  _rebuildFences() {
    const g = this.game;
    const civ = g.civ;
    const world = g.world;
    const per = new Map();
    const scare = new Map();
    for (const st of this.fenceMeshes.keys()) per.set(st, { posts: [], rails: [] });
    for (const st of this.scarecrows.keys()) scare.set(st, []);
    const q = this._q;
    for (const v of civ.villages) {
      if (!v.alive) continue;
      const st = CULTURES[baseCulture(v.culture)]?.style || 'vale';
      const F = FENCE[st];
      const P = per.get(st);
      for (const p of v.plots) {
        let tilled = 0;
        for (const i of p.tiles) if (world.type[i] === TILE.FARMLAND) tilled++;
        if (tilled < 2) continue;
        const set = new Set(p.tiles);
        const inPlot = (x, y) => world.inBounds(x, y) && set.has(y * world.w + x);
        // gate: the edge closest to the village centre
        const gx = Math.max(p.x0, Math.min(p.x1, Math.floor(v.cx))),
          gy = Math.max(p.y0, Math.min(p.y1, Math.floor(v.cz)));
        const edges = [];
        for (const i of p.tiles) {
          const x = i % world.w,
            y = (i / world.w) | 0;
          if (!inPlot(x, y - 1)) edges.push([x, y, x + 1, y, x === gx && y === p.y0 && v.cz < p.y0]);
          if (!inPlot(x, y + 1)) edges.push([x, y + 1, x + 1, y + 1, x === gx && y === p.y1 && v.cz > p.y1]);
          if (!inPlot(x - 1, y)) edges.push([x, y, x, y + 1, y === gy && x === p.x0 && v.cx < p.x0]);
          if (!inPlot(x + 1, y)) edges.push([x + 1, y, x + 1, y + 1, y === gy && x === p.x1 && v.cx > p.x1]);
        }
        const postSet = new Set();
        const inset = 0.08;
        const cx = (p.x0 + p.x1 + 1) / 2,
          cz = (p.y0 + p.y1 + 1) / 2;
        const ins = (x, z) => [x + Math.sign(cx - x) * inset, z + Math.sign(cz - z) * inset];
        for (const [x0, z0, x1, z1, gate] of edges) {
          if (gate) continue;
          const [ax, az] = ins(x0, z0),
            [bx, bz] = ins(x1, z1);
          const ay = world.heightAt(ax, az),
            by = world.heightAt(bx, bz);
          for (const [px, py, pz] of [
            [ax, ay, az],
            [bx, by, bz],
          ]) {
            const key = Math.round(px * 10) * 100000 + Math.round(pz * 10);
            if (postSet.has(key)) continue;
            postSet.add(key);
            if (!F.wall || true) P.posts.push([px, py, pz]);
          }
          for (const ry of F.wall ? [F.rail[1] * 0.5] : F.rails) P.rails.push([ax, ay + ry, az, bx, by + ry, bz]);
        }
        if (st !== 'dune' && p.tiles.length >= 12) {
          const ci = Math.floor(cz) * world.w + Math.floor(cx);
          if (world.type[ci] === TILE.FARMLAND) scare.get(st)?.push([cx + 0.1, world.heightAt(cx, cz), cz, hash2(p.x0, p.y0, 5) * 6]);
        }
      }
    }
    const dir = new THREE.Vector3();
    const X = new THREE.Vector3(1, 0, 0);
    for (const [st, P] of per) {
      const F = FENCE[st];
      let fm = this.fenceMeshes.get(st);
      const need = Math.max(P.posts.length, P.rails.length);
      if (need > fm.cap) {
        const cap = Math.ceil(need * 1.5);
        for (const k of ['posts', 'rails']) {
          const old = fm[k];
          const nm = new THREE.InstancedMesh(old.geometry, old.material, cap);
          nm.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
          nm.castShadow = true;
          nm.receiveShadow = true;
          this.group.remove(old);
          old.dispose();
          this.group.add(nm);
          fm[k] = nm;
        }
        fm.cap = cap;
      }
      const base = new THREE.Color(F.color);
      for (let i = 0; i < P.posts.length; i++) {
        const [x, y, z] = P.posts[i];
        const s = F.post;
        this._m.compose(this._p.set(x, y - 0.06, z), q.setFromAxisAngle(this._up, hash2(Math.round(x * 7), Math.round(z * 7), 3) * 0.4), this._s.set(s[0], s[1] + 0.06, s[2]));
        fm.posts.setMatrixAt(i, this._m);
        this._c.copy(base).multiplyScalar(0.85 + hash2(i, 7, 1) * 0.3);
        fm.posts.setColorAt(i, this._c);
      }
      for (let i = 0; i < P.rails.length; i++) {
        const [ax, ay, az, bx, by, bz] = P.rails[i];
        dir.set(bx - ax, by - ay, bz - az);
        const len = dir.length();
        dir.normalize();
        q.setFromUnitVectors(X, dir);
        const th = F.rail;
        this._m.compose(this._p.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), q, this._s.set(len + (F.wall ? th[0] * 0.5 : 0.02), th[1], th[0]));
        fm.rails.setMatrixAt(i, this._m);
        this._c.copy(base).multiplyScalar(0.8 + hash2(i, 9, 2) * 0.35);
        fm.rails.setColorAt(i, this._c);
      }
      fm.posts.count = F.wall ? 0 : P.posts.length;
      fm.rails.count = P.rails.length;
      for (const k of ['posts', 'rails']) {
        fm[k].instanceMatrix.needsUpdate = true;
        if (fm[k].instanceColor) fm[k].instanceColor.needsUpdate = true;
        fm[k].computeBoundingSphere();
      }
    }
    for (const [st, list] of scare) {
      const m = this._grow(this.scarecrows, st, list.length);
      for (let i = 0; i < list.length; i++) {
        const [x, y, z, r] = list[i];
        this._m.compose(this._p.set(x, y, z), q.setFromAxisAngle(this._up, r), this._s.set(1, 1, 1));
        m.setMatrixAt(i, this._m);
      }
      m.count = list.length;
      m.instanceMatrix.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------------ animation
  _updateBanners() {
    const env = this.game.env;
    const civ = this.game.civ;
    const units = this.game.units;
    const wind = env.wind || { x: 1, z: 0, strength: 0.3 };
    const yaw = Math.atan2(-(wind.z || 0), wind.x || 1);
    const per = new Map();
    for (const b of this.banners) {
      let L = per.get(b.style);
      if (!L) per.set(b.style, (L = []));
      L.push(b);
    }
    // army standards follow their bearers
    const staffs = this.staffs.slice();
    for (const a of civ.armies || []) {
      const u = units.byId?.get(a.bearer);
      if (!u || !u.alive) continue;
      const h = Math.sin(u.heading || 0),
        c = Math.cos(u.heading || 0);
      const x = u.x + c * 0.14,
        z = u.z - h * 0.14;
      const y = (u.y ?? this.game.world.surfaceAt(u.x, u.z)) + 0.15;
      staffs.push([x, y, z, 1.85]);
      const st = CULTURES[baseCulture(civ.kingdoms[a.kingdom]?.culture)]?.style || 'vale';
      let L = per.get(st);
      if (!L) per.set(st, (L = []));
      L.push({ x: x + 0.02, y: y + 1.8, z, s: 1.7, style: st, color: civ.kingdomColor(a.kingdom), k: a.kingdom });
    }
    const sm = this._grow(this.staffMap, 's', staffs.length);
    for (let i = 0; i < staffs.length; i++) {
      const [x, y, z, hgt] = staffs[i];
      this._m.compose(this._p.set(x, y, z), this._q.identity(), this._s.set(1, hgt, 1));
      sm.setMatrixAt(i, this._m);
    }
    sm.count = staffs.length;
    sm.instanceMatrix.needsUpdate = true;
    for (const [st, mesh0] of this.bannerMeshes) {
      const L = per.get(st) || [];
      const mesh = this._grow(this.bannerMeshes, st, L.length);
      if (mesh !== mesh0 && !mesh.instanceColor) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 3), 3);
      // the realm's emblem and field pattern ride on each flag
      let ea = mesh.geometry.getAttribute('aEmblem');
      if (!ea || ea.count < mesh.instanceMatrix.count) {
        ea = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 2).fill(-1), 2);
        ea.setUsage(THREE.DynamicDrawUsage);
        mesh.geometry.setAttribute('aEmblem', ea);
      }
      for (let i = 0; i < L.length; i++) {
        const b = L[i];
        const kb = b.k != null ? civ.kingdoms[b.k] : null;
        const ban = kb?.banner;
        ea.setXY(i, ban ? EMBLEM_IDS.indexOf(ban.symbol) : -1, ban ? Math.max(0, FIELD_IDS.indexOf(ban.field)) : 0);
        if (kb) b.color = kb.color;
        const wob = Math.sin(this.t * 0.7 + b.x * 0.3) * 0.25 * (1 - Math.min(1, wind.strength || 0.3));
        this._q.setFromAxisAngle(this._up, yaw + wob);
        this._m.compose(this._p.set(b.x, b.y, b.z), this._q, this._s.set(b.s, b.s, b.s));
        mesh.setMatrixAt(i, this._m);
        mesh.setColorAt(i, this._c.setHex(b.color));
      }
      mesh.count = L.length;
      mesh.instanceMatrix.needsUpdate = true;
      ea.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  _updateBoatsAndBlades(dt, force = false) {
    const wind = this.game.env.wind || { strength: 0.3 };
    const per = new Map();
    for (const b of this.blades) {
      let L = per.get(b.style);
      if (!L) per.set(b.style, (L = []));
      L.push(b);
    }
    const spin = this.t * (0.5 + (wind.strength ?? 0.3) * 2.2);
    for (const st of this.bladeMeshes.keys()) {
      const L = per.get(st) || [];
      const mesh = this._grow(this.bladeMeshes, st, L.length);
      for (let i = 0; i < L.length; i++) {
        this._m.copy(L[i].m).multiply(this._m2.makeRotationZ(spin + L[i].phase));
        mesh.setMatrixAt(i, this._m);
      }
      mesh.count = L.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
    const bp = new Map();
    for (const b of this.boats) {
      let L = bp.get(b.style);
      if (!L) bp.set(b.style, (L = []));
      L.push(b);
    }
    for (const st of this.boatMeshes.keys()) {
      const L = bp.get(st) || [];
      const mesh = this._grow(this.boatMeshes, st, L.length);
      for (let i = 0; i < L.length; i++) {
        const b = L[i];
        const t = this.t + b.phase;
        const bob = Math.sin(t * 1.6) * 0.025;
        this._q.setFromEuler(new THREE.Euler(Math.sin(t * 1.3) * 0.05, b.ry + Math.PI / 2 + Math.sin(t * 0.3) * 0.08, Math.sin(t * 1.1 + 1) * 0.04));
        this._m.compose(this._p.set(b.x + Math.sin(t * 0.25) * 0.08, SEA_LEVEL - 0.03 + bob, b.z), this._q, this._s.set(b.s || 1, b.s || 1, b.s || 1));
        mesh.setMatrixAt(i, this._m);
      }
      mesh.count = L.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
    void dt;
    void force;
  }

  // Far zoom: one proxy batch per style instead of dozens of detailed batches.
  // Mid zoom: small props are culled beyond propDist.
  _applyLod(force = false) {
    const D = this.game.cameraRig?.cur?.dist ?? 60;
    const z01 = this.game.view?.zoom01 ?? 0;
    const far = this._far ? D > this.lodDist - 12 : D > this.lodDist || !!this.game.view?.far;
    const props = D <= this.propDist && z01 < 0.42;
    if (!force && far === this._far && props === this._props) return;
    this._far = far;
    this._props = props;
    for (const b of this.batches.values()) if (b.mesh) b.mesh.visible = !far && b.mesh.count > 0;
    for (const b of (this.proxyBatches || new Map()).values()) if (b.mesh) b.mesh.visible = far && b.mesh.count > 0;
    if (this.footing) this.footing.visible = !far;
    const lp = this.batches.get('lamppost');
    if (lp?.mesh) lp.mesh.visible = props && lp.mesh.count > 0;
    for (const fm of this.fenceMeshes.values()) {
      fm.posts.visible = props && fm.posts.count > 0;
      fm.rails.visible = props && fm.rails.count > 0;
    }
    for (const m of this.scarecrows.values()) m.visible = props && m.count > 0;
    for (const m of this.boatMeshes.values()) m.visible = D < this.lodDist && m.count > 0;
    for (const m of this.bladeMeshes.values()) m.visible = !far && m.count > 0;
    for (const m of this.bannerMeshes.values()) m.visible = !far && m.count > 0;
    if (this.decals) this.decals.visible = props && this.decalMat.opacity > 0.01;
  }

  // civ-related draw calls (meshes that will render, plus shadow casters)
  drawStats() {
    let draws = 0,
      shadows = 0;
    this.group.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      let v = o;
      while (v) {
        if (!v.visible) return;
        v = v.parent;
      }
      if (o.isInstancedMesh && o.count === 0) return;
      draws++;
      if (o.castShadow) shadows++;
    });
    return { draws, shadows };
  }

  _fxIsReal() {
    if (this._fxReal != null) return this._fxReal;
    const fx = this.game.fx;
    let real = false;
    try {
      const src = String(fx?.emit || '').replace(/\s+/g, '');
      real = !!fx?.emit && src.length > 60;
    } catch {
      real = false;
    }
    this._fxReal = real;
    if (!real && !this.puffs) this.puffs = new PuffSystem(this.group);
    return real;
  }

  _smoke(dt) {
    const g = this.game;
    const rig = g.cameraRig;
    const cx = rig.cur.x,
      cz = rig.cur.z;
    const R = rig.cur.dist * 1.25 + 12;
    const R2 = R * R;
    const real = this._fxIsReal();
    const fx = g.fx;
    let budget = 10;
    const close = rig.cur.dist < 140;
    if (close) {
      for (const c of this.chimneys) {
        c.t -= dt;
        if (c.t > 0) continue;
        c.t = ((c.forge ? 0.55 : 2.4 + Math.random() * 2.6) / (c.rate || 1)) * (g.settings?.powerSaver ? 2 : 1);
        const b = c.b;
        if (!b.alive || b.constructing) continue;
        if ((c.x - cx) ** 2 + (c.z - cz) ** 2 > R2) continue;
        if (budget-- <= 0) break;
        if (real) fx.emit?.('smoke', { x: c.x, y: c.y, z: c.z }, { scale: c.forge ? 0.6 : 0.42 });
        else this.puffs.emit(c.x, c.y, c.z, 'smoke', c.forge ? 0.85 : 0.6);
      }
    }
    // burning buildings
    this._burnT = (this._burnT || 0) - dt;
    if (this._burnT <= 0) {
      this._burnT = g.settings?.powerSaver ? 0.36 : 0.18;
      let n = 0;
      for (const b of g.civ.buildings) {
        if (b.gone) continue;
        const damaged = b.alive && !b.constructing && b.hp < b.maxHp * 0.7;
        if (!(b.burning > 0.05) && !damaged) continue;
        if ((b.x - cx) ** 2 + (b.z - cz) ** 2 > R2) continue;
        if (n++ > 18) break;
        if (!(b.burning > 0.05)) {
          // battered but not burning: a steady plume of smoke from the wreckage
          if (Math.random() < 0.35) {
            const sx = b.x + (Math.random() - 0.5) * b.w * 0.5,
              sz = b.z + (Math.random() - 0.5) * b.h * 0.5;
            if (real) fx.emit?.('smoke', { x: sx, y: b.y + 0.8, z: sz }, { scale: 0.5 + (1 - b.hp / b.maxHp) });
            else this.puffs.emit(sx, b.y + 0.8, sz, 'soot', 0.7);
          }
          continue;
        }
        const x = b.x + (Math.random() - 0.5) * b.w * 0.7,
          z = b.z + (Math.random() - 0.5) * b.h * 0.7;
        const y = b.y + (b.alive ? 0.4 + Math.random() * 0.8 : 0.15);
        if (real) {
          if (b.alive) fx.emit?.('fire', { x, y, z }, { scale: 0.6 + b.burning * 0.6 });
          if (Math.random() < 0.5) fx.emit?.('smoke', { x, y: y + 0.4, z }, { scale: 0.8 + b.burning });
          if (Math.random() < 0.08) fx.addLight?.({ x, y: y + 0.5, z }, 0xff7a30, 1.5 * b.burning, 0.6);
        } else {
          if (b.alive) this.puffs.emit(x, y, z, 'fire', 0.7 + b.burning * 0.5);
          if (Math.random() < 0.6) this.puffs.emit(x, y + 0.3, z, 'soot', 0.8 + b.burning * 0.5);
        }
      }
    }
    if (this.puffs) this.puffs.update(dt, g.env.wind || { x: 1, z: 0, strength: 0.3 });
  }

  _selection() {
    const g = this.game;
    const sel = g.selected;
    const b = sel && sel.kind === 'building' ? sel.ref : null;
    if (b && !b.gone) {
      const r = Math.max(b.w, b.h) * 0.75 + 0.3;
      this.ring.visible = true;
      this.ring.position.set(b.x, b.y + 0.06, b.z);
      const pulse = 1 + Math.sin(this.t * 4) * 0.04;
      this.ring.scale.set(r * pulse, 1, r * pulse);
    } else this.ring.visible = false;
    const pick = g.civ?.powerPick;
    if (pick && pick.kingdom != null && g.time.realTime - (pick.t ?? 0) < 30) {
      const k = g.civ.kingdoms[pick.kingdom];
      const v = k && g.civ.villages[k.capital];
      if (v && v.alive) {
        this.pickRing.visible = true;
        this.pickRing.material.color.setHex(k.color);
        const r = v.radius * (1 + Math.sin(this.t * 3) * 0.03);
        this.pickRing.position.set(v.cx, g.world.surfaceAt(v.cx, v.cz) + 0.15, v.cz);
        this.pickRing.scale.set(r, 1, r);
      } else this.pickRing.visible = false;
    } else this.pickRing.visible = false;
  }

  // ------------------------------------------------------------------ frame
  update(dt) {
    const g = this.game;
    const civ = g.civ;
    if (!civ) return;
    this.t += dt;
    const env = g.env;
    this.uniforms.uTime.value = this.t;
    const day = env.daylight ?? 1;
    const night = 1 - THREE.MathUtils.smoothstep(day, 0.12, 0.62);
    this.uniforms.uNight.value += (night - this.uniforms.uNight.value) * Math.min(1, dt * 3 + (this._first ? 0 : 1));
    this._first = true;
    this.uniforms.uWind.value = env.wind?.strength ?? 0.35;
    this.decalMat.opacity = this.uniforms.uNight.value * 0.42;
    this.decals.visible = this._props !== false && this.decalMat.opacity > 0.01;
    const now = g.time.realTime;
    if ((civ.version !== this._ver || civ.colorVersion !== this._cver) && now - this._lastRebuild > 0.2) {
      this._ver = civ.version;
      this._cver = civ.colorVersion;
      this._sver = civ.stateVersion;
      this._lastRebuild = now;
      this._rebuild();
    } else if (civ.stateVersion !== this._sver && now - this._lastState > 0.12) {
      this._sver = civ.stateVersion;
      this._lastState = now;
      this._updateStates();
    }
    if (civ.fieldVersion !== this._fver && now - this._lastFence > 1) {
      this._fver = civ.fieldVersion;
      this._lastFence = now;
      this._rebuildFences();
    }
    this._applyLod();
    this._updateBanners();
    this._updateBoatsAndBlades(dt);
    this._smoke(dt);
    this._selection();
    this.overlay.update();
    this.labels.update(dt);
  }

  inspect() {
    return null;
  }
}
