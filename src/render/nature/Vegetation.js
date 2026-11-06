import * as THREE from 'three';
import { FLORA, FLORA_INFO, TILE, SEA_LEVEL } from '../../world/constants.js';
import { hash2 } from '../../core/Random.js';
import { buildAllModels } from './models.js';
import { createSharedUniforms, createMaterials } from './floraMaterial.js';
import { GroundCover } from './GroundCover.js';
import { InstanceBatcher } from './InstanceBatcher.js';
import { stageName, isTreeId, isMineral } from '../../sim/flora/species.js';

// Vegetation renderer (Nature).
//
// * Chunked instancing: the world is split into CHUNK x CHUNK tile chunks;
//   each chunk caches one compact instance list per (species, variant).
//   'world:flora' / 'world:height' only rebuild the chunks they touch, within
//   a per-frame time budget. Chunks are frustum-culled on the CPU (with a
//   margin for off-screen shadow casters) and the visible lists are packed
//   into one InstancedMesh per (species, variant, LOD) by InstanceBatcher, so
//   draw calls stay ~constant regardless of how many chunks are on screen.
// * LOD: distant chunks swap to LOD1 geometry (same silhouette, ~1/5 of the
//   vertices); tiny props are hidden when far away.
// * Per-tile state texture (RGBA8, one texel per tile) read in the vertex
//   shader: R displayed growth, G fire, B scorch, A drought stress. Growth,
//   fire and stress changes never rebuild instance buffers; they are eased
//   per tile and written to the texture, so plants grow smoothly instead of
//   popping, and burning forests char without any CPU geometry work.
// * Ground cover (grass, ferns, pebbles) lives in GroundCover.js.
export const CHUNK = 32;
const LOD_FAR = 115;
const LOD_HYST = 10;
const SKIP_FAR = 150;
const FLOWER_SKIP = 52; // petals have faded out (shader) well before this
const POLL_PER_FRAME = 4096;
const REBUILD_BUDGET_MS = 4;

// Kinds that do not grow: rendered at full size regardless of floraGrowth.
const STATIC = new Uint8Array(32);
for (const f of [FLORA.ROCK_SMALL, FLORA.BOULDER, FLORA.STUMP, FLORA.DEAD_TREE]) STATIC[f] = 1;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _n = new THREE.Vector3();
const _e = new THREE.Euler();
const _col = new THREE.Color();
const _box = new THREE.Box3();

export class Vegetation {
  constructor(game) {
    this.game = game;
    const world = (this.world = game.world);
    const n = world.size;
    this.group = new THREE.Group();
    this.group.name = 'vegetation';
    this.group.matrixAutoUpdate = false;
    game.scene.add(this.group);

    const t0 = performance.now();
    this.models = buildAllModels();
    this.buildMs = performance.now() - t0;

    // Per-tile state texture
    this.stateData = new Uint8Array(n * 4);
    this.stateTex = new THREE.DataTexture(this.stateData, world.w, world.h, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.stateTex.minFilter = this.stateTex.magFilter = THREE.NearestFilter;
    this.stateTex.generateMipmaps = false;
    this.stateTex.needsUpdate = true;
    this.uniforms = createSharedUniforms(this.stateTex, world.w, world.h);
    const mats = createMaterials(this.uniforms);
    this.mat = mats.flora;
    this.groundMat = mats.ground;

    this.builtFlora = new Uint8Array(n);
    this.dispGrowth = new Float32Array(n);
    this.dispFire = new Float32Array(n);
    this.scorch = new Float32Array(n);
    this.dispDry = new Float32Array(n);
    this.animFlag = new Uint8Array(n);
    this.animList = [];
    this._poll = 0;
    this._texDirty = true;

    this.cw = Math.ceil(world.w / CHUNK);
    this.ch = Math.ceil(world.h / CHUNK);
    this.chunks = [];
    for (let cy = 0; cy < this.ch; cy++) {
      for (let cx = 0; cx < this.cw; cx++) {
        this.chunks.push({
          cx,
          cy,
          x0: cx * CHUNK,
          y0: cy * CHUNK,
          x1: Math.min(world.w, (cx + 1) * CHUNK) - 1,
          y1: Math.min(world.h, (cy + 1) * CHUNK) - 1,
          lists: new Map(),
          dirty: true,
          lod: 0,
          skip: false,
          state: -1,
          sphere: new THREE.Sphere(),
          count: 0,
        });
      }
    }
    this.initialized = false;
    this._scratch = new Map();
    this._leafT = 0;
    this._dirtyQueue = [];
    this.batcher = new InstanceBatcher(this.group, 'flora');
    this._frustum = new THREE.Frustum();
    this._projScreen = new THREE.Matrix4();
    this._needCompact = true;
    this._compactT = 0;

    const ev = game.events;
    ev.on('world:flora', (r) => this.onFlora(r));
    ev.on('world:height', (r) => this.markChunks(r, true));
    ev.on('world:fire', (r) => this.touchRect(r));
    ev.on('world:type', (r) => this.touchRect(r));

    this.ground = new GroundCover(this);
    this.syncAll(true);
  }

  // ---- change tracking ---------------------------------------------------
  chunkAt(tx, ty) {
    return this.chunks[Math.floor(ty / CHUNK) * this.cw + Math.floor(tx / CHUNK)];
  }
  markChunks(r, force) {
    const cx0 = Math.max(0, Math.floor((r.x0 - 1) / CHUNK)),
      cx1 = Math.min(this.cw - 1, Math.floor((r.x1 + 1) / CHUNK));
    const cy0 = Math.max(0, Math.floor((r.y0 - 1) / CHUNK)),
      cy1 = Math.min(this.ch - 1, Math.floor((r.y1 + 1) / CHUNK));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) this.chunks[cy * this.cw + cx].dirty = true;
  }
  onFlora(r) {
    const world = this.world;
    for (let ty = r.y0; ty <= r.y1; ty++) {
      let row = ty * world.w;
      for (let tx = r.x0; tx <= r.x1; tx++) {
        const i = row + tx;
        if (world.flora[i] !== this.builtFlora[i]) this.chunkAt(tx, ty).dirty = true;
        this.enqueue(i);
      }
    }
  }
  touchRect(r) {
    const w = this.world.w;
    const area = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
    if (area > 40000) return; // the rolling poll will catch up on huge rects
    for (let ty = r.y0; ty <= r.y1; ty++) for (let tx = r.x0; tx <= r.x1; tx++) this.enqueue(ty * w + tx);
  }
  enqueue(i) {
    if (this.animFlag[i]) return;
    this.animFlag[i] = 1;
    this.animList.push(i);
  }

  growthTarget(i) {
    const f = this.world.flora[i];
    if (!f) return 0;
    if (STATIC[f]) return 1;
    const g = this.world.floraGrowth[i];
    return g > 0 ? (g < 1 ? g : 1) : 0.02;
  }
  dryTarget(i) {
    const s = this.game.flora?.stress;
    return s ? s[i] : 0;
  }
  scorchTarget(i) {
    return this.world.type[i] === TILE.ASH ? 0.85 : 0;
  }

  // Snap the per-tile state to the world (initial build / regenerate).
  syncAll(snap) {
    const world = this.world;
    for (let i = 0; i < world.size; i++) {
      this.dispGrowth[i] = this.growthTarget(i);
      this.dispFire[i] = world.fire[i];
      this.scorch[i] = Math.max(this.scorchTarget(i), world.fire[i]);
      this.dispDry[i] = this.dryTarget(i);
      this.writeState(i);
    }
    this._texDirty = true;
    for (const c of this.chunks) c.dirty = true;
    this.initialized = !snap ? this.initialized : false;
  }
  writeState(i) {
    const o = i * 4;
    const d = this.stateData;
    d[o] = Math.round(this.dispGrowth[i] * 255);
    d[o + 1] = Math.round(Math.min(1, this.dispFire[i]) * 255);
    d[o + 2] = Math.round(this.scorch[i] * 255);
    d[o + 3] = Math.round(Math.min(1, this.dispDry[i]) * 255);
  }

  // Ease displayed values toward their targets; drop settled tiles.
  animate(dt) {
    const list = this.animList;
    if (!list.length) return;
    const world = this.world;
    const kG = 1 - Math.exp(-dt * 2.6);
    const kF = 1 - Math.exp(-dt * 5);
    const kD = 1 - Math.exp(-dt * 1.5);
    let w = 0;
    for (let r = 0; r < list.length; r++) {
      const i = list[r];
      let settled = true;
      // growth
      const gT = this.growthTarget(i);
      let g = this.dispGrowth[i];
      if (g !== gT) {
        const dg = gT - g;
        const step = dg * kG + Math.sign(dg) * dt * 0.04;
        g = Math.abs(step) >= Math.abs(dg) ? gT : g + step;
        this.dispGrowth[i] = g;
        if (g !== gT) settled = false;
      }
      // fire
      const fT = world.fire[i];
      let f = this.dispFire[i];
      if (f !== fT) {
        const df = fT - f;
        f = Math.abs(df) < 0.01 ? fT : f + df * kF;
        this.dispFire[i] = f;
        if (f !== fT) settled = false;
      }
      // scorch: rises with fire, lingers, fades slowly unless the tile is ash
      const sT = Math.max(this.scorchTarget(i), f);
      let s = this.scorch[i];
      if (s !== sT) {
        if (sT > s) s = sT;
        else s = Math.max(sT, s - dt * 0.04);
        this.scorch[i] = s;
        if (s !== sT) settled = false;
      }
      // drought / dying
      const dT = this.dryTarget(i);
      let d = this.dispDry[i];
      if (d !== dT) {
        const dd = dT - d;
        d = Math.abs(dd) < 0.01 ? dT : d + dd * kD;
        this.dispDry[i] = d;
        if (d !== dT) settled = false;
      }
      this.writeState(i);
      if (settled) this.animFlag[i] = 0;
      else list[w++] = i;
    }
    list.length = w;
    this._texDirty = true;
  }

  // Rolling verification so changes made without events are still picked up.
  poll() {
    const world = this.world;
    const n = world.size;
    const stress = this.game.flora?.stress;
    let i = this._poll;
    for (let k = 0; k < POLL_PER_FRAME; k++) {
      if (++i >= n) i = 0;
      const f = world.flora[i];
      if (f !== this.builtFlora[i]) {
        this.chunkAt(i % world.w, (i / world.w) | 0).dirty = true;
        this.enqueue(i);
        continue;
      }
      if (this.animFlag[i]) continue;
      if (
        Math.abs(this.growthTarget(i) - this.dispGrowth[i]) > 0.002 ||
        world.fire[i] !== this.dispFire[i] ||
        (stress && Math.abs(stress[i] - this.dispDry[i]) > 0.01) ||
        this.scorch[i] !== Math.max(this.scorchTarget(i), this.dispFire[i])
      )
        this.enqueue(i);
    }
    this._poll = i;
  }

  // ---- chunk building ----------------------------------------------------
  variantOf(tx, ty, f) {
    return Math.floor(hash2(tx, ty, 71 + f) * this.models[f].variants.length);
  }

  rebuildChunk(c) {
    c.dirty = false;
    const world = this.world;
    const scratch = this._scratch;
    for (const s of scratch.values()) s.n = 0;
    let minY = Infinity,
      maxY = -Infinity,
      total = 0;
    for (let ty = c.y0; ty <= c.y1; ty++) {
      for (let tx = c.x0; tx <= c.x1; tx++) {
        const i = ty * world.w + tx;
        const f = world.flora[i];
        const prev = this.builtFlora[i];
        if (f !== prev) {
          this.builtFlora[i] = f;
          if (this.initialized && f) {
            // New plants grow in from nothing; remains appear at full size.
            this.dispGrowth[i] = STATIC[f] ? 1 : 0;
            this.writeState(i);
            this._texDirty = true;
          }
          this.enqueue(i);
        }
        if (!f) continue;
        const model = this.models[f];
        if (!model) continue;
        const h0 = world.height[i];
        // small plants never render on cliff faces
        if ((f === FLORA.FLOWERS || f === FLORA.MUSHROOM) && world.slopeAt(tx, ty) > 1.15) continue;
        if (h0 < SEA_LEVEL - (f === FLORA.REEDS ? 0.7 : f === FLORA.BOULDER || f === FLORA.ROCK_SMALL ? 1.2 : 0.15)) continue;
        const cfg = model.cfg;
        const v = this.variantOf(tx, ty, f);
        const key = f * 8 + v;
        let s = scratch.get(key);
        if (!s) scratch.set(key, (s = { f, v, n: 0, mats: new Float32Array(64 * 16), cols: new Float32Array(64 * 3) }));
        if ((s.n + 1) * 16 > s.mats.length) {
          const m2 = new Float32Array(s.mats.length * 2);
          m2.set(s.mats);
          s.mats = m2;
          const c2 = new Float32Array(s.cols.length * 2);
          c2.set(s.cols);
          s.cols = c2;
        }
        const y = this.placeInstance(tx, ty, f, cfg, s.mats, s.n * 16);
        this.tintInstance(tx, ty, f, s.cols, s.n * 3);
        s.n++;
        total++;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    // Keep compact per-chunk lists (copied so scratch can be reused)
    c.lists.clear();
    for (const [key, sc] of scratch) {
      if (!sc.n) continue;
      c.lists.set(key, { f: sc.f, v: sc.v, n: sc.n, mats: sc.mats.slice(0, sc.n * 16), cols: sc.cols.slice(0, sc.n * 3) });
    }
    this._needCompact = true;
    c.count = total;
    if (total) {
      const cxm = (c.x0 + c.x1 + 1) / 2,
        czm = (c.y0 + c.y1 + 1) / 2;
      const half = (c.x1 - c.x0 + 1) / 2 + 1.6;
      const ym = (minY + maxY) / 2 + 1.4;
      const hy = (maxY - minY) / 2 + 2.2;
      c.sphere.center.set(cxm, ym, czm);
      c.sphere.radius = Math.sqrt(half * half * 2 + hy * hy);
    }
    this.applyLod(c);
  }

  // Writes the instance matrix; returns the ground Y.
  placeInstance(tx, ty, f, cfg, arr, off) {
    const world = this.world;
    const h1 = hash2(tx, ty, 11),
      h2 = hash2(tx, ty, 23),
      h3 = hash2(tx, ty, 37),
      h4 = hash2(tx, ty, 51),
      h5 = hash2(tx, ty, 63);
    const j = cfg.jitter;
    const x = tx + 0.5 + (h1 - 0.5) * 2 * j;
    const z = ty + 0.5 + (h2 - 0.5) * 2 * j;
    const ground = world.heightAt(x, z);
    const slope = Math.min(1.5, world.slopeAt(tx, ty));
    let y = ground - cfg.sink - slope * 0.12;
    if (f === FLORA.REEDS) y = Math.max(y, SEA_LEVEL - 0.25);
    const yaw = cfg.snapYaw ? Math.floor(h3 * 4) * (Math.PI / 2) : h3 * Math.PI * 2;
    const sc = cfg.scale[0] + (cfg.scale[1] - cfg.scale[0]) * h4;
    _q.setFromAxisAngle(_up, yaw);
    if (cfg.tilt > 0) {
      world.normalAt(x, z, _n);
      _q2.setFromUnitVectors(_up, _n.set(_n.x * cfg.tilt, 1, _n.z * cfg.tilt).normalize());
      _q.premultiply(_q2);
    } else if (!cfg.snapYaw) {
      // a touch of natural lean
      _e.set((h5 - 0.5) * 0.09, 0, (hash2(tx, ty, 77) - 0.5) * 0.09);
      _q2.setFromEuler(_e);
      _q.premultiply(_q2);
    }
    _p.set(x, y, z);
    _s.set(sc, sc * (0.94 + 0.12 * h5), sc);
    _m.compose(_p, _q, _s);
    _m.toArray(arr, off);
    return y;
  }

  tintInstance(tx, ty, f, arr, off) {
    const a = hash2(tx, ty, 91),
      b = hash2(tx, ty, 97);
    // brightness and a gentle warm/cool hue drift
    const br = 0.88 + 0.22 * a;
    const warm = (b - 0.5) * (isTreeId(f) ? 0.14 : 0.1);
    // regional drift so forests show patches of slightly different greens
    const reg = Math.sin(tx * 0.071 + ty * 0.043) * Math.cos(tx * 0.033 - ty * 0.061) * 0.06;
    arr[off] = br * (1 + warm + reg);
    arr[off + 1] = br * (1 + reg * 0.3);
    arr[off + 2] = br * (1 - warm * 1.4 - reg);
  }

  // Picks LOD / small-prop visibility for a chunk from its camera distance.
  applyLod(c) {
    const cam = this.game.cameraRig.camera.position;
    const d = c.sphere.center.distanceTo(cam) - c.sphere.radius * 0.6;
    if (d > LOD_FAR + LOD_HYST) c.lod = 1;
    else if (d < LOD_FAR - LOD_HYST) c.lod = 0;
    c.skip = d > SKIP_FAR;
    c.flowerSkip = d > FLOWER_SKIP;
  }

  // Cull chunks and repack the visible instance lists when anything changed.
  compactIfNeeded(dt) {
    const cam = this.game.cameraRig.camera;
    cam.updateMatrixWorld();
    this._projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._projScreen);
    const sph = this._sph || (this._sph = new THREE.Sphere());
    let changed = false;
    for (const c of this.chunks) {
      let state = 0;
      if (c.count) {
        this.applyLod(c);
        sph.center.copy(c.sphere.center);
        sph.radius = c.sphere.radius + 7; // off-screen trees still cast shadows in
        if (this._frustum.intersectsSphere(sph)) state = 1 + c.lod * 2 + (c.skip ? 4 : 0) + (c.flowerSkip ? 8 : 0);
      }
      if (state !== c.state) {
        c.state = state;
        changed = true;
      }
    }
    this._compactT -= dt;
    if (!changed && !(this._needCompact && this._compactT <= 0)) return;
    this._needCompact = false;
    this._compactT = 0.12;
    const B = this.batcher;
    B.begin();
    for (const c of this.chunks) {
      if (!c.state) continue;
      for (const [key, list] of c.lists) {
        const model = this.models[list.f];
        const cfg = model.cfg;
        if (c.skip && cfg.far === 'skip') continue;
        if (c.flowerSkip && list.f === FLORA.FLOWERS) continue;
        const lods = model.variants[list.v];
        const L = c.lod && lods[1] ? 1 : 0;
        const bkey = key * 2 + L;
        B.add(bkey, list, { geo: lods[L], material: this.mat.material, depth: this.mat.depth, castShadow: cfg.castShadow, label: FLORA_INFO[list.f].name + '-' + list.v + '-L' + L });
      }
    }
    B.end();
  }

  // ---- frame update ------------------------------------------------------
  update(dt) {
    const g = this.game;
    const u = this.uniforms;
    u.uTime.value = g.time.realTime;
    const wind = g.env.wind || { x: 1, z: 0, strength: 0.3 };
    const wl = Math.hypot(wind.x, wind.z) || 1;
    u.uWind.value.set(wind.x / wl, wind.z / wl, THREE.MathUtils.clamp(wind.strength ?? 0.3, 0, 1.5), 0);
    if (g.env.sunDir) u.uSunDir.value.copy(g.env.sunDir);
    if (g.env.sunColor) u.uSunColor.value.copy(g.env.sunColor);
    u.uDaylight.value = g.env.daylight ?? 1;
    const cs = g.env.cloudShadow;
    if (cs && cs.texture && cs.params) {
      u.uCloudTex.value = cs.texture;
      u.uCloudParams.value.copy(cs.params);
    } else u.uCloudParams.value.w = 0;
    // weather: snow settles slowly, rain wets
    const wt = g.env.weather || {};
    const snowGoal = wt.type === 'snow' ? Math.min(1, (wt.intensity ?? 1) * 0.85) : 0;
    u.uSnowCover.value += (snowGoal - u.uSnowCover.value) * Math.min(1, dt * (snowGoal > u.uSnowCover.value ? 0.05 : 0.12));
    const wetGoal = wt.type === 'rain' || wt.type === 'storm' ? Math.min(1, wt.intensity ?? 1) : 0;
    u.uWet.value += (wetGoal - u.uWet.value) * Math.min(1, dt * (wetGoal > u.uWet.value ? 0.3 : 0.06));

    if (!this.initialized) {
      this.syncAll(true);
      for (const c of this.chunks) this.rebuildChunk(c);
      this.initialized = true;
    } else {
      this.poll();
      this.rebuildDirty();
    }
    this.animate(Math.min(dt, 0.1));
    if (this._texDirty) {
      this.stateTex.needsUpdate = true;
      this._texDirty = false;
    }
    this.compactIfNeeded(dt);
    this.ground.update(dt);
    this.emitLeaves(dt);
  }

  rebuildDirty() {
    const t0 = performance.now();
    const cam = this.game.cameraRig.target;
    const dirty = this._dirtyQueue;
    dirty.length = 0;
    for (const c of this.chunks) if (c.dirty) dirty.push(c);
    if (!dirty.length) return;
    // nearest first
    dirty.sort((a, b) => dist2(a, cam) - dist2(b, cam));
    for (const c of dirty) {
      this.rebuildChunk(c);
      if (performance.now() - t0 > REBUILD_BUDGET_MS) break;
    }
  }

  emitLeaves(dt) {
    const g = this.game;
    const rig = g.cameraRig;
    if (rig.cur.dist > 70 || !g.fx?.emit) return;
    this._leafT -= dt * (0.6 + (g.env.wind?.strength ?? 0.3) * 2.5);
    if (this._leafT > 0) return;
    this._leafT = 0.35 + Math.random() * 0.4;
    const world = this.world;
    for (let tries = 0; tries < 6; tries++) {
      const tx = Math.floor(rig.target.x + (Math.random() - 0.5) * rig.cur.dist * 1.2);
      const ty = Math.floor(rig.target.z + (Math.random() - 0.5) * rig.cur.dist * 0.8);
      if (!world.inBounds(tx, ty)) continue;
      const i = world.idx(tx, ty);
      const f = world.flora[i];
      if (!isTreeId(f) || f === FLORA.PALM || f === FLORA.CACTUS || this.dispGrowth[i] < 0.6 || world.fire[i] > 0) continue;
      const x = tx + 0.5,
        z = ty + 0.5;
      const w = g.env.wind || { x: 1, z: 0, strength: 0.3 };
      g.fx.emit('leaves', { x, y: world.heightAt(x, z) + 1.5, z }, { count: 3, scale: 0.6, dir: { x: w.x * (w.strength ?? 0.3), y: -0.3, z: w.z * (w.strength ?? 0.3) }, color: f === FLORA.BIRCH ? 0xc8d860 : 0x6fa040 });
      break;
    }
  }

  reset() {
    this.animList.length = 0;
    this.animFlag.fill(0);
    this.builtFlora.fill(0);
    this.syncAll(true);
    this.ground.reset();
  }

  inspect(hit) {
    const world = this.world;
    if (!hit || !world.inBounds(hit.tx, hit.ty)) return null;
    const i = world.idx(hit.tx, hit.ty);
    const f = world.flora[i];
    if (!f) return null;
    const g = world.floraGrowth[i];
    const info = FLORA_INFO[f];
    const stats = [];
    const stage = stageName(f, g);
    if (!isMineral(f) && f !== FLORA.STUMP && f !== FLORA.DEAD_TREE) stats.push(['Growth', Math.round(Math.min(1, g) * 100) + '%']);
    const stress = this.game.flora?.stress?.[i] ?? 0;
    if (stress > 0.05) stats.push(['Health', Math.round((1 - stress) * 100) + '%']);
    if (world.fire[i] > 0) stats.push(['Status', 'Burning']);
    if (info.wood) stats.push(['Wood', info.wood]);
    if (info.food) stats.push(['Food', info.food]);
    return { priority: 1, title: info.name, subtitle: stage || undefined, stats, kind: 'flora' };
  }

  stats() {
    let inst = 0;
    for (const c of this.chunks) inst += c.count;
    return { floraInstances: inst, floraDrawn: this.batcher.drawn };
  }
}

function dist2(c, t) {
  const x = (c.x0 + c.x1) / 2 - t.x,
    z = (c.y0 + c.y1) / 2 - t.z;
  return x * x + z * z;
}
