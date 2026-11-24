import * as THREE from 'three';
import { craneGeometry } from './archetypes.js';
import { buildArchetype, foundation, scaffold, ruin, wallPost, wallArm, lampPost, streetLamp, bastionGeometry, frameFor, materialPile, proxyGeometry, PAL, WALL_H } from './archetypes.js';
import { Labels } from './labels.js';
import { createBuildingMaterial, createPropMaterial, withCutaway } from './material.js';
import { emblemAtlas, EMBLEM_IDS, FIELD_IDS } from './emblems.js';
import { bannerGeometry, bannerMaterial, bladesGeometry, turbineBladesGeometry, boatGeometry, FENCE, scarecrowGeometry, glowTexture, PuffSystem } from './props.js';
import { TerritoryOverlay } from './TerritoryOverlay.js';
import { InfraRenderer } from './InfraRenderer.js';
import { GlowSprites, HazeLayer, StackPlumes } from './nightAndHaze.js';
import { BUILDING_TYPES } from '../../sim/civ/catalog.js';
import { CULTURES, baseCulture } from '../../sim/civ/cultures.js';
import { SEA_LEVEL, TILE } from '../../world/constants.js';
import { hash2 } from '../../core/Random.js';
import { BUILDING, PROP, UNIT, FOOTPRINT, VEHICLE } from '../../core/scale.js';
import { padFlagSpot } from '../units/SquareProps.js';

// Models are drawn at their design size (archetypes.js: a cottage for a 2 x 2
// plot) and brought to the world by BUILDING.scale in each instance matrix,
// so shader detail (thatch rows, window grids, construction clip) keeps its
// proportions. Design footprints (def.dw x def.dh) size frames, footings,
// ruins and proxies under the same matrix; def.w x def.h are tiles.
const BS = BUILDING.scale;
const PS = PROP.scale;
// (round 31) street lights stand beside the half-size people: a powered
// street light about two and a half people tall, a lantern post under two
// (at PS they stood four and a half and three people tall)
const LS = PROP.kit * 1.0,
  LP = PROP.kit * 1.2;
// walls run tile to tile: their arms keep their length, the rest shrinks
const _wallS = new THREE.Vector3(1, BS, BS);
const _bS = new THREE.Vector3(BS, BS, BS);
const _bridgeS = new THREE.Vector3(1, BS, 1);
const _zeroM = new THREE.Matrix4().makeScale(0, 0, 0); // a released footing slot
const _X = new THREE.Vector3(1, 0, 0);
const STYLE_N = { vale: 0, dune: 1, frost: 2, mire: 3 };

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

// The archetype of a building: type, style, level, era (+ 'g' when gilded),
// variant, and 'h' for a heritage building (its plaque). A heritage building
// keeps the look of the era it was built in, never the realm's later dress.
// Modern types (catalog `modern`) have one model per kind, culture and era.
// In the modern eras (realm era 4+) the older buildings of a realm show at
// least its previous era (and at least Industrial), so a whole realm reads as
// its era at once while the new era still spreads building by building
// (Civilization: b.era rises one step at a time). Heritage never changes.
export function lookEra(b, realmEra = 0) {
  if (b.heritage) return b.heritage.era ?? b.builtEra ?? b.era ?? 1;
  const e = b.era ?? 1;
  if (realmEra >= 4 && e < realmEra) return Math.max(e, realmEra - 1, 4);
  return e;
}
// a building's own seeded variant (skyscraper towers: six silhouettes, five
// of them per culture, so each culture's skyline has its own mix), and its
// height class by distance from the town's core (tall at the centre,
// stepping down to the edge): variant + 6 * class (modernModels.js)
const TOWER_SETS = { vale: [0, 1, 2, 3, 4], dune: [0, 2, 3, 4, 5], frost: [1, 2, 3, 4, 5], mire: [0, 1, 3, 4, 5] };
let _towerCiv = null;
const towerVariant = (b) => {
  const set = TOWER_SETS[b.style] || TOWER_SETS.vale;
  const v = set[((b.id * 2654435761) >>> 0) % set.length];
  let hc = 1;
  const t = _towerCiv?.villages?.[b.village];
  if (t && Number.isFinite(t.cx)) {
    const r = Math.hypot(b.x - t.cx, b.z - t.cz) / Math.max(4, t.radius || t.buildRadius || 6);
    hc = r < 0.38 ? 0 : r < 0.72 ? 1 : 2;
  }
  return v + 6 * hc;
};
// apartment blocks: three designs per culture
const blockVariant = (b) => ((b.id * 40503) >>> 0) % 3;
function archKey(b, def, lvl, realmEra = 0) {
  const era = lookEra(b, realmEra);
  if (def.modern) return `${b.type}|${b.style}|${lvl}|${Math.max(4, era)}${b.type === 'skyscraper' ? '|' + towerVariant(b) : b.type === 'apartment' ? '|' + blockVariant(b) : ''}`;
  // modern homes come in a few designs per culture (Future: four), picked by the plot's seed
  const vv = b.variant || (b.type === 'house' && era >= 5 ? Math.floor((b.seed || 0) * 997) % (era >= 7 ? 4 : 3) : 0);
  return `${b.type}|${b.style}|${lvl}|${era}${b.gilded ? 'g' : ''}${vv || b.heritage ? '|' + vv : ''}${b.heritage ? '|h' : ''}`;
}

// works whose stacks smoke thickly
const INDUSTRY = new Set(['factory', 'foundry', 'bloomery', 'powerstation', 'cannery', 'kiln']);
// landmarks keep drawing at far zoom; houses and small buildings do not
const LANDMARK = new Set(['hall', 'wonder', 'colossus', 'temple', 'market', 'forum', 'academy', 'skyscraper', 'arcology', 'factory', 'powerstation', 'nuclear', 'fusion', 'airport', 'airfield', 'station', 'campus', 'spaceport', 'launchpad', 'containerport', 'hospital', 'controlspire', 'climatetower', 'radiomast', 'observatory', 'castle', 'bridge', 'docks', 'shipyard', 'skyshield', 'genelab', 'desal']);
function isMinor(b) {
  const def = BUILDING_TYPES[b.type];
  if (!def || def.wall || def.monument || LANDMARK.has(b.type)) return false;
  return true;
}

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

// Every building model of a kind of pass in ONE draw call: a THREE.BatchedMesh
// holds each archetype's geometry once and draws all instances with a single
// multi-draw (per-instance frustum culling against the camera, and against
// the light for the shadow pass, is done by three). Instance colour and state
// live in a float texture read by the building material (material.js).
class DetailBatch {
  constructor(parent, uniforms, { clip = false, shadow = true, name = 'detail' } = {}) {
    this.parent = parent;
    this.inst = { value: null };
    this.material = createBuildingMaterial(uniforms, { clip, inst: this.inst });
    this.shadow = shadow;
    this.name = name;
    this.geoIds = new Map(); // archetype key -> geometry id
    this.vUsed = 0;
    this.cap = 0; // instances
    this.vcap = 0; // vertices
    this.nInst = 0; // instance ids handed out (some may be hidden)
    this.n = 0; // instances in use
    this.mesh = null;
    this.data = null; // 8 floats per instance: colour (rgb_), state
    this.items = [];
    this.extra = [];
    this.keys = [];
    this.minor = [];
    this.free = []; // released instance slots
    this._hideMin = false;
    this._off = new Set(); // archetype keys hidden (lampposts beyond prop range)
    this._mDirty = false;
    this._dDirty = false;
  }
  _texFor(cap) {
    const size = Math.max(4, Math.ceil(Math.sqrt(cap * 2)));
    const data = new Float32Array(size * size * 4);
    if (this.data) data.set(this.data.subarray(0, Math.min(this.data.length, data.length)));
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true;
    this.inst.value?.dispose?.();
    this.inst.value = tex;
    this.data = data;
  }
  _ensure(nInst, vNeed) {
    if (!this.mesh) {
      this.cap = Math.max(64, Math.ceil(nInst * 1.5));
      this.vcap = Math.max(65536, Math.ceil(vNeed * 1.5));
      const m = new THREE.BatchedMesh(this.cap, this.vcap, 0, this.material);
      m.name = 'buildings:' + this.name;
      m.castShadow = this.shadow;
      m.receiveShadow = true;
      m.frustumCulled = false; // three culls each instance itself
      m.perObjectFrustumCulled = true;
      m.sortObjects = false;
      this.mesh = m;
      this._texFor(this.cap);
      this.parent.add(m);
      return;
    }
    if (nInst > this.cap) {
      this.cap = Math.ceil(nInst * 1.5);
      this.mesh.setInstanceCount(this.cap);
      this._texFor(this.cap);
    }
    if (vNeed > this.vcap) {
      this.vcap = Math.ceil(vNeed * 1.5);
      this.mesh.setGeometrySize(this.vcap, 0);
    }
  }
  geometryId(key, geo) {
    let id = this.geoIds.get(key);
    if (id != null) return id;
    const vc = geo.attributes.position.count;
    this._ensure(this.cap, this.vUsed + vc);
    id = this.mesh.addGeometry(geo);
    this.vUsed += vc;
    this.geoIds.set(key, id);
    return id;
  }
  // (round 33) One instance slot that stays until it is released: geometry,
  // matrix (16 numbers), colour; the item and extra its state is read from.
  // A released slot is hidden and handed out again, so a change touches only
  // its own slots.
  alloc(key, geo, e, col, item, extra, minor) {
    const gid = this.geometryId(key, geo);
    let id;
    if (this.free.length) id = this.free.pop();
    else {
      this._ensure(this.nInst + 1, this.vUsed);
      id = this.mesh.addInstance(gid);
      this.nInst++;
    }
    const m = this.mesh;
    if (m.getGeometryIdAt(id) !== gid) m.setGeometryIdAt(id, gid);
    const mats = m._matricesTexture.image.data;
    for (let q = 0; q < 16; q++) mats[id * 16 + q] = e[q];
    const data = this.data;
    data[id * 8] = col.r;
    data[id * 8 + 1] = col.g;
    data[id * 8 + 2] = col.b;
    this.items[id] = item;
    this.extra[id] = extra;
    this.keys[id] = key;
    this.minor[id] = minor;
    const vis = !(minor && this._hideMin) && !this._off.has(key);
    if (m.getVisibleAt(id) !== vis) m.setVisibleAt(id, vis);
    this.n++;
    this._mDirty = true;
    this._dDirty = true;
    return id;
  }
  release(id) {
    if (this.mesh.getVisibleAt(id)) this.mesh.setVisibleAt(id, false);
    this.items[id] = null;
    this.extra[id] = null;
    this.keys[id] = null;
    this.minor[id] = false;
    this.free.push(id);
    this.n--;
  }
  // upload what changed this frame (matrices, colours and states)
  flush() {
    if (!this.mesh) return;
    if (this._mDirty) this.mesh._matricesTexture.needsUpdate = true;
    if (this._dDirty && this.inst.value) this.inst.value.needsUpdate = true;
    this._mDirty = this._dDirty = false;
  }
  // past mid zoom houses and small buildings are hidden (landmarks stay)
  hideMinor(hide) {
    this._hideMin = hide;
    if (!this.mesh) return;
    for (let i = 0; i < this.nInst; i++) {
      if (this.keys[i] == null || !this.minor[i]) continue;
      const vis = !hide && !this._off.has(this.keys[i]);
      if (this.mesh.getVisibleAt(i) !== vis) this.mesh.setVisibleAt(i, vis);
    }
  }
  // per-instance visibility for one archetype key (lampposts beyond prop range)
  showKey(key, on) {
    if (on) this._off.delete(key);
    else this._off.add(key);
    if (!this.mesh) return;
    for (let i = 0; i < this.nInst; i++) {
      if (this.keys[i] !== key) continue;
      const vis = on && !(this.minor[i] && this._hideMin);
      if (this.mesh.getVisibleAt(i) !== vis) this.mesh.setVisibleAt(i, vis);
    }
  }
}

// Small repeated props of one material (windmill sails, boats, scarecrows;
// field fences) in ONE draw call, and one shadow draw for casters: a
// THREE.BatchedMesh holds each prop geometry once (reduced to position,
// normal and, for vertex-coloured materials, colour) and its instances are
// rewritten in order between begin() and end(). Before, every style of every
// prop was its own instanced draw.
class PropBatch {
  constructor(parent, material, { shadow = false, name = 'props', vertexColors = false } = {}) {
    this.parent = parent;
    this.material = material;
    this.shadow = shadow;
    this.name = name;
    this.vertexColors = vertexColors;
    this.geoIds = new Map();
    this.vUsed = 0;
    this.cap = 0;
    this.vcap = 0;
    this.nInst = 0;
    this.k = 0;
    this.shown = 0;
    this.mesh = null;
    this.free = []; // slot mode
    this.live = 0;
  }
  _prep(geo) {
    const src = geo.index ? geo.toNonIndexed() : geo;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', src.attributes.position);
    if (src.attributes.normal) g.setAttribute('normal', src.attributes.normal);
    else g.computeVertexNormals();
    if (this.vertexColors) {
      const c = src.attributes.color;
      if (c && c.itemSize === 3) g.setAttribute('color', c);
      else g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(src.attributes.position.count * 3).fill(1), 3));
    }
    return g;
  }
  _ensure(nInst, vNeed) {
    if (!this.mesh) {
      this.cap = Math.max(64, Math.ceil(nInst * 1.5));
      this.vcap = Math.max(8192, Math.ceil(vNeed * 1.5));
      const m = new THREE.BatchedMesh(this.cap, this.vcap, 0, this.material);
      m.name = 'buildings:' + this.name;
      m.castShadow = this.shadow;
      m.receiveShadow = true;
      m.frustumCulled = false; // three culls each instance itself
      m.perObjectFrustumCulled = true;
      m.sortObjects = false;
      m.visible = false;
      this.mesh = m;
      this.parent.add(m);
      return;
    }
    if (nInst > this.cap) {
      this.cap = Math.ceil(nInst * 1.5);
      this.mesh.setInstanceCount(this.cap);
    }
    if (vNeed > this.vcap) {
      this.vcap = Math.ceil(vNeed * 1.5);
      this.mesh.setGeometrySize(this.vcap, 0);
    }
  }
  geometryId(key, geo) {
    let id = this.geoIds.get(key);
    if (id != null) return id;
    const g = this._prep(geo);
    const vc = g.attributes.position.count;
    this._ensure(this.cap, this.vUsed + vc);
    id = this.mesh.addGeometry(g);
    this.vUsed += vc;
    this.geoIds.set(key, id);
    return id;
  }
  begin() {
    this.k = 0;
    this.shown = 0;
  }
  push(key, geo, matrix, color = null, visible = true) {
    const gid = this.geometryId(key, geo);
    const i = this.k++;
    const m = this.mesh;
    if (i >= this.nInst) {
      this._ensure(i + 1, this.vUsed);
      m.addInstance(gid);
      this.nInst++;
    } else if (m.getGeometryIdAt(i) !== gid) m.setGeometryIdAt(i, gid);
    if (!visible) {
      // (round 33) hidden (out of view or out of range): nothing else to write
      if (m.getVisibleAt(i)) m.setVisibleAt(i, false);
      return;
    }
    m.setMatrixAt(i, matrix);
    if (color) m.setColorAt(i, color);
    if (m.getVisibleAt(i) !== visible) m.setVisibleAt(i, visible);
    if (visible) this.shown++;
  }
  end() {
    const m = this.mesh;
    if (!m) return;
    for (let i = this.k; i < this.nInst; i++) if (m.getVisibleAt(i)) m.setVisibleAt(i, false);
    m.visible = this.shown > 0;
  }
  // (round 33) slot mode (the field fences, town by town): an instance that
  // stays until it is released; not mixed with begin/push/end in one batch
  alloc(key, geo, matrix, color = null) {
    const gid = this.geometryId(key, geo);
    let i;
    if (this.free.length) i = this.free.pop();
    else {
      this._ensure(this.nInst + 1, this.vUsed);
      i = this.mesh.addInstance(gid);
      this.nInst++;
    }
    const m = this.mesh;
    if (m.getGeometryIdAt(i) !== gid) m.setGeometryIdAt(i, gid);
    m.setMatrixAt(i, matrix);
    if (color) m.setColorAt(i, color);
    if (!m.getVisibleAt(i)) m.setVisibleAt(i, true);
    this.live++;
    return i;
  }
  release(i) {
    this.mesh.setVisibleAt(i, false);
    this.free.push(i);
    this.live--;
  }
}

export class BuildingRenderer {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'civ-buildings';
    game.scene.add(this.group);
    this.uniforms = { uTime: { value: 0 }, uNight: { value: 0 }, uSnow: { value: 0 }, uWind: { value: 0.35 }, uEmblems: { value: emblemAtlas() } };
    this.mat = createBuildingMaterial(this.uniforms); // far-zoom proxies
    this.propMat = withCutaway(createPropMaterial());
    this.arche = new Map();
    // building models: shadow casters, small pieces (wells, piles, footings,
    // ruins, lampposts) that cast none, and buildings rising in scaffolding
    this.dSolid = new DetailBatch(this.group, this.uniforms, { shadow: true, name: 'solid' });
    this.dSmall = new DetailBatch(this.group, this.uniforms, { shadow: false, name: 'small' });
    this.dClip = new DetailBatch(this.group, this.uniforms, { clip: true, shadow: false, name: 'clip' });
    this.details = [this.dSolid, this.dSmall, this.dClip];
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
    this.minorDist = 90; // beyond this houses and small buildings are hidden (landmarks stay)
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
    this.infra = new InfraRenderer(game, this.uniforms); // rails, maglev, highways, pylons and wires
    this.lights = [];
    this.glow = new GlowSprites(this.group); // street lights and floodlights at night, out to mid zoom
    this.haze = new HazeLayer(this.group); // factory haze over industrial towns
    this.plumes = new StackPlumes(this.group); // rising plumes over works stacks and cooling towers
    this._powerSig = '';
    // (round 33) incremental drawing: a record per building, per town's
    // street lights and per town's fences; the queue of records to draw
    this._recs = new Map();
    this._lrecs = new Map();
    this._frecs = new Map();
    this._qN = { a: [], i: 0 }; // near the camera
    this._qF = { a: [], i: 0 };
    this._qD = { a: [], i: 0 }; // street lights and fences
    this._stamp = 0;
    this._fstamp = 0;
    this._wallAt = new Map();
    this._capBanners = [];
    this._anchorsDirty = false;
    this._scareDirty = false;
    this._proxyDirty = true;
    this._proxyT = -1;
    this._footSlots = [];
    this._footN = 0;
    this._footDirty = false;
    this._full = true;
    this.budgetMs = 4; // drawing time per frame in live play
    this._bc = new THREE.Color();
    this._fc = new THREE.Color();
    this._dir = new THREE.Vector3();
    this._vf = new THREE.Frustum();
    this._vpm = new THREE.Matrix4();
    this._vs = new THREE.Sphere();
    this._vfOk = false;
    // ground reshaped under fields and streets: their fences and street
    // lights are drawn again on the new ground (the rects of the edits,
    // gathered until the next update; past 256 of them, everything)
    this._hRects = [];
    this._hAll = false;
    game.events?.on?.('world:height', (r) => {
      if (this._hAll) return;
      if (this._hRects.length >= 256) this._hAll = true;
      else this._hRects.push({ x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 });
    });
  }

  reset() {
    this._ver = -1;
    this._fver = -1;
    this._full = true;
    this.infra?.reset();
    this.overlay.markAll();
    this.puffs?.clear();
  }

  // ------------------------------------------------------------------ props
  _initProps() {
    const scene = this.group;
    // stone footings that keep every building grounded on uneven terrain
    const fgeo = new THREE.BoxGeometry(1, 1, 1).translate(0, -0.5, 0);
    // (round 31) dressed stone courses and a pale capping course, so a tall
    // footing on a slope reads as a retaining wall of stone, not a brown slab
    const fmat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    fmat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFtW;\nvarying vec3 vFtN;\nvarying float vFtTop;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvFtW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\nvFtN = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);\nvFtTop = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).y;',
        );
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFtW;\nvarying vec3 vFtN;\nvarying float vFtTop;').replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float dy = vFtTop - vFtW.y;
          float row = floor(dy / 0.075);
          float u = (abs(vFtN.x) > abs(vFtN.z) ? vFtW.z : vFtW.x) / 0.16 + row * 0.5;
          float aa = max(fwidth(dy / 0.075), 1e-3);
          float bed = smoothstep(0.0, aa * 1.5, fract(dy / 0.075)) * smoothstep(0.0, aa * 1.5, 1.0 - fract(dy / 0.075));
          float au = max(fwidth(u), 1e-3);
          float head = smoothstep(0.0, au * 1.5, fract(u)) * smoothstep(0.0, au * 1.5, 1.0 - fract(u));
          float tone = 0.9 + 0.14 * fract(sin(dot(vec2(row, floor(u)), vec2(12.9898, 78.233))) * 43758.5453);
          diffuseColor.rgb *= tone * mix(0.72, 1.0, bed * head);
          // the capping course
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.76, 0.72) * tone, step(dy, 0.05) * step(abs(vFtN.y), 0.5));
        }`,
      );
    };
    fmat.customProgramCacheKey = () => 'footing-courses';
    this.footing = new THREE.InstancedMesh(fgeo, fmat, 64);
    this.footing.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3), 3);
    this.footing.castShadow = false;
    this.footing.receiveShadow = true;
    this.footing.frustumCulled = false; // (slots change one by one: no bounding sphere to keep)
    this.footing.count = 0;
    scene.add(this.footing);
    this.bannerMat = withCutaway(bannerMaterial(this.uniforms));
    this.bannerMeshes = new Map();
    // windmill sails, boats and scarecrows of every style: one batched draw
    this.propBatch = new PropBatch(this.group, this.propMat, { name: 'props', vertexColors: true });
    this.bladeGeo = new Map();
    this.boatGeo = new Map();
    this.scareGeo = new Map();
    this._scareList = [];
    this._eu = new THREE.Euler();
    for (const st of ['vale', 'dune', 'frost', 'mire']) {
      this.bannerMeshes.set(st, this._inst(bannerGeometry(st), this.bannerMat, 32, false, 'banners:' + st));
      this.bladeGeo.set(st, bladesGeometry(st));
      this.boatGeo.set(st, boatGeometry(st));
    }
    this.bladeGeo.set('turbine', turbineBladesGeometry());
    // ground glow under lanterns & doors at night
    const dgeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.decalMat = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffb060, opacity: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    this.decals = new THREE.InstancedMesh(dgeo, this.decalMat, 256);
    this.decals.count = 0;
    this.decals.renderOrder = 3;
    this.decals.frustumCulled = false;
    scene.add(this.decals);
    // fences
    // (posts and rails of every style: one batched draw and one shadow draw)
    this.fenceBatch = new PropBatch(this.group, withCutaway(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 })), { shadow: true, name: 'fences' });
    this.postGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.railGeo = new THREE.BoxGeometry(1, 1, 1);
    // tall staffs for capital standards and army standard-bearers
    this.staffGeo = new THREE.CylinderGeometry(0.03, 0.04, 1, 6).translate(0, 0.5, 0);
    this.staffMesh = this._inst(this.staffGeo, withCutaway(new THREE.MeshStandardMaterial({ color: 0x5a3c24, roughness: 0.8 })), 16, true, 'staffs');
    this.staffMap = new Map([['s', this.staffMesh]]);
    for (const st of ['vale', 'frost', 'mire']) this.scareGeo.set(st, scarecrowGeometry(st));
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

  _inst(geo, mat, cap, shadow, name = '') {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.name = name;
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
    nm.name = m.name;
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
    const [kind, p1, p2, p3, p4, p5] = key.split('|');
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
    else if (kind === 'streetlamp') {
      const l = streetLamp();
      a = { geo: l.geo, anchors: l.anchors, maxY: 1.2 };
    } else if (kind === 'lamppost') {
      const l = lampPost();
      a = { geo: l.geo, anchors: l.anchors, maxY: 0.8 };
    } else if (kind === 'bastion') a = { geo: bastionGeometry(p1), anchors: null, maxY: 0.7 };
    else a = buildArchetype(kind, p1, +p2, p3 == null ? 1 : parseInt(p3, 10), p4 == null ? 0 : +p4, p3 != null && p3.endsWith('g'), p5 === 'h');
    this.arche.set(key, a);
    return a;
  }

  // [horizontal, vertical] scale on top of the building scale, or null
  _upscale(b, def, a, civ) {
    const t = b.type;
    if (t === 'colossus') {
      const v = civ.villages?.[b.village];
      return v && (v.tier || 0) < 2 ? [0.72, 0.72] : null;
    }
    // the works of industry fill their plot (a factory read the size of a
    // row house): as wide as the footprint allows, and taller
    const works = t === 'factory' || t === 'foundry' || t === 'powerstation';
    if (!works && t !== 'house' && t !== 'apartment' && t !== 'rowhouse') return null;
    const le = lookEra(b, civ.kingdoms[b.kingdom]?.era ?? 0);
    if (!works && le < 4) return null;
    // as wide as the plot allows (footprints stay as they are)
    if (a._fitK == null) {
      const g = a.geo;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox;
      const hw = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x)) * 2 * BS,
        hd = Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z)) * 2 * BS;
      const dw = def.dw ?? def.w,
        dh = def.dh ?? def.h;
      a._fitK = Math.min((dw * 0.98) / Math.max(0.1, hw), (dh * 0.98) / Math.max(0.1, hd));
    }
    if (works) {
      const k = Math.max(1.15, Math.min(1.6, a._fitK));
      return [k, Math.max(1.3, k * 0.95)];
    }
    // (Industrial terraces: as wide as the plot, so a street of them stands
    // shoulder to shoulder in a row instead of as cottages on big lots)
    if (le === 4) {
      const k4 = Math.max(1, Math.min(1.1, a._fitK));
      return [k4, 1.08];
    }
    const k = Math.max(1, Math.min(1.28, a._fitK));
    return [k, Math.max(k, 1.25)];
  }

  // which DetailBatch draws an archetype (casters, small pieces, rising sites)
  _detailFor(key, clip) {
    if (clip) return this.dClip;
    return /^(well|pile|found|ruin|lamppost|streetlamp)/.test(key) ? this.dSmall : this.dSolid;
  }

  // ------------------------------------------------------------------ rebuild
  // (round 33) The models are kept up to date building by building. Each
  // building has a record of the instance slots it fills (its models and its
  // footing), its chimneys, banners, sails, boats and glows, and a signature
  // of how it looks; when the realm changes (a building placed, rising,
  // finished, upgraded, restyled or lost) only the buildings whose signature
  // changed are drawn again, about 4 ms of them a frame (the rest follow on
  // the next frames, those near the camera first). Street lights and field
  // fences keep a record per town the same way. Live play used to rebuild
  // every model in the world on each drawn frame while towns grew (60-150 ms
  // a frame: the stutter seen during city development). After a jump in time
  // (a fast-forward, a new world) everything that changed is drawn at once.
  _stage(b) {
    if (!b.alive) return 'ruin';
    if (b.constructing) return b.progress < 0.12 ? 'found' : b.progress < 0.4 ? 'frame' : 'build';
    return b.upgrading ? 'upg' : 'done';
  }

  // the arms a wall piece reaches out to its neighbours with (8 bits)
  _wallMask(b, wallAt, W) {
    let mask = 0;
    for (let j = 0; j < 8; j++) {
      const dx = DIRS8[j][0],
        dy = DIRS8[j][1];
      const nb = wallAt.get((b.ty + dy) * W + b.tx + dx);
      if (!nb || nb.village !== b.village) continue;
      if (dx && dy && (wallAt.has(b.ty * W + b.tx + dx) || wallAt.has((b.ty + dy) * W + b.tx))) continue;
      mask |= 1 << j;
    }
    return mask;
  }

  // what a building's models depend on, besides its place and its realm's colour
  _sig(b, def, civ, wallAt, W) {
    const stage = this._stage(b);
    if (stage === 'ruin') return def.wall ? 'r' : 'r' + b.type + '|' + b.style;
    if (def.wall) return 'w' + b.type + '|' + b.style + '|' + (b.constructing ? 1 : 0) + '|' + this._wallMask(b, wallAt, W) + (b.type === 'tower' && b.bastion ? 'b' : '');
    const K = civ.kingdoms[b.kingdom];
    const re = K?.era ?? 0;
    let s = stage + '|' + archKey(b, def, Math.min(b.level || 1, def.levels), re);
    if ((stage === 'found' || stage === 'frame' || stage === 'build') && civ.hasTech?.(b.kingdom, 'engineering')) s += '|E';
    if (b.heritage && re >= 5) s += '|H';
    if (b.type === 'docks' && (K?.mastery || 0) >= 8) s += '|D';
    if (b.type === 'colossus') s += '|t' + (civ.villages?.[b.village]?.tier || 0);
    return s;
  }

  // The scan's fast test: the plain fields the signature is made from, kept
  // on the record (store) or compared with it. Only a building that fails it
  // has its signature string made again. (kEra, kCol: the realms' eras and
  // colours, looked up once per scan)
  _quick(b, def, rec, civ, wallAt, W, store, kEra, kCol) {
    const k = b.kingdom;
    const re = kEra[k] ?? 0;
    const st = !b.alive ? 0 : b.constructing ? (b.progress < 0.12 ? 1 : b.progress < 0.4 ? 2 : 3) : b.upgrading ? 4 : 5;
    let ex = 0;
    if (def.wall) ex = this._wallMask(b, wallAt, W) + (b.bastion ? 256 : 0);
    else if (b.type === 'skyscraper') ex = towerVariant(b);
    else if (b.type === 'colossus') ex = civ.villages?.[b.village]?.tier || 0;
    else if (b.type === 'docks') ex = (civ.kingdoms[k]?.mastery || 0) >= 8 ? 1 : 0;
    if (st >= 1 && st <= 3 && civ.hasTech?.(k, 'engineering')) ex += 1024;
    const col = kCol[k] ?? 0xffffff;
    const rot = b.rotation || 0;
    if (store) {
      rec.qT = b.type;
      rec.qS = b.style;
      rec.qL = b.level;
      rec.qE = b.era;
      rec.qR = re;
      rec.qG = b.gilded;
      rec.qV = b.variant;
      rec.qH = b.heritage;
      rec.qSt = st;
      rec.qX = ex;
      rec.qVil = b.village;
      rec.col = col;
      rec.x = b.x;
      rec.y = b.y;
      rec.z = b.z;
      rec.rot = rot;
      rec.gm = b.groundMin;
      return true;
    }
    return rec.qSt === st && rec.x === b.x && rec.z === b.z && rec.y === b.y && rec.qL === b.level && rec.qE === b.era && rec.qR === re && rec.col === col && rec.qX === ex && rec.qT === b.type && rec.qS === b.style && rec.qG === b.gilded && rec.qV === b.variant && rec.qH === b.heritage && rec.qVil === b.village && rec.rot === rot && rec.gm === b.groundMin;
  }

  _newRec(t, b, v = null) {
    return { t, b, v, sig: null, seen: 0, queued: false, dead: false, stage: null, inst: [], chimneys: [], banners: [], blades: [], boats: [], decals: [], lights: [], scare: [], foot: -1 };
  }

  _enqueue(rec) {
    if (rec.queued) return;
    rec.queued = true;
    const c = this.game.cameraRig?.cur;
    let near = false;
    if (c) {
      const R = c.dist * 1.6 + 24;
      const x = rec.b ? rec.b.x : rec.v.cx,
        z = rec.b ? rec.b.z : rec.v.cz;
      near = Math.abs(x - c.x) < R && Math.abs(z - c.z) < R;
    }
    // (street lights and fences, the decor, wait behind every building)
    (rec.t !== 0 ? this._qD : near ? this._qN : this._qF).a.push(rec);
  }

  // let go of everything a record holds (slots, anchors, footing)
  _clearRec(rec) {
    const L = rec.inst;
    if (rec.t === 2) {
      for (let i = 0; i < L.length; i++) this.fenceBatch.release(L[i]);
      if (rec.scare.length) this._scareDirty = true;
      rec.scare = [];
    } else for (let i = 0; i < L.length; i += 2) L[i].release(L[i + 1]);
    L.length = 0;
    if (rec.chimneys.length || rec.banners.length || rec.blades.length || rec.boats.length || rec.decals.length || rec.lights.length) {
      this._anchorsDirty = true;
      rec.chimneys = [];
      rec.banners = [];
      rec.blades = [];
      rec.boats = [];
      rec.decals = [];
      rec.lights = [];
    }
    if (rec.foot >= 0) {
      this._footRelease(rec.foot);
      rec.foot = -1;
    }
  }

  _dropRec(rec) {
    this._clearRec(rec);
    rec.dead = true;
  }

  // one model instance of a record: its batch slot, colour and state
  _put(rec, key, clip, m, col, item, extra = null) {
    const d = this._detailFor(key, clip);
    const id = d.alloc(key, this._arch(key).geo, m.elements, col, item, extra, item ? isMinor(item) : true);
    this._writeState(d, id);
    rec.inst.push(d, id);
  }

  // Which buildings changed: new ones, lost ones and those whose signature,
  // place or colour moved. Cheap (no matrices, no geometry); the drawing
  // waits in the queue. Also the towns' street lights and the capitals'
  // standards.
  _scan() {
    const g = this.game;
    const civ = g.civ;
    const world = g.world;
    const W = world.w;
    const stamp = ++this._stamp;
    _towerCiv = civ;
    const wallAt = (this._wallAt = new Map());
    for (const b of civ.buildings) if (!b.gone && b.alive && BUILDING_TYPES[b.type]?.wall) wallAt.set(b.ty * W + b.tx, b);
    const kEra = (this._kEra = this._kEra || []),
      kCol = (this._kCol = this._kCol || []);
    kEra.length = kCol.length = 0;
    for (const k of civ.kingdoms) {
      if (!k) continue;
      kEra[k.id] = k.era ?? 0;
      kCol[k.id] = civ.kingdomColor(k.id);
    }
    let changed = false,
      seen = 0;
    for (const b of civ.buildings) {
      if (b.gone) continue;
      const def = BUILDING_TYPES[b.type];
      if (!def) continue;
      let rec = this._recs.get(b);
      if (rec) {
        if (rec.seen !== stamp) seen++;
        rec.seen = stamp;
        if (this._quick(b, def, rec, civ, wallAt, W, false, kEra, kCol)) continue;
      }
      const sig = this._sig(b, def, civ, wallAt, W);
      if (!rec) {
        rec = this._newRec(0, b);
        rec.seen = stamp;
        seen++;
        this._recs.set(b, rec);
      } else if (rec.sig === sig && rec.col === civ.kingdomColor(b.kingdom) && rec.x === b.x && rec.y === b.y && rec.z === b.z && rec.rot === (b.rotation || 0) && rec.gm === b.groundMin) {
        this._quick(b, def, rec, civ, wallAt, W, true, kEra, kCol); // (looks the same: only the fast test's fields moved)
        continue;
      }
      rec.sig = sig;
      this._quick(b, def, rec, civ, wallAt, W, true, kEra, kCol);
      this._enqueue(rec);
      changed = true;
    }
    if (seen !== this._recs.size)
      for (const [b, rec] of this._recs)
        if (rec.seen !== stamp) {
          this._dropRec(rec);
          this._recs.delete(b);
          changed = true;
        }
    // street lights, town by town (and every 15 s all of them again, slowly:
    // a lamp stands by a road tile next to any building, which the signature
    // does not follow tile by tile)
    const now = g.time.realTime;
    const relamp = now - (this._lampT ?? 0) > 15;
    if (relamp) this._lampT = now;
    for (const v of civ.villages) {
      if (!v) continue;
      const sig = this._lampSig(v, civ);
      let vr = this._lrecs.get(v);
      if (!sig) {
        if (vr) {
          this._dropRec(vr);
          this._lrecs.delete(v);
        }
        continue;
      }
      if (!vr) this._lrecs.set(v, (vr = this._newRec(1, null, v)));
      vr.seen = stamp;
      if (vr.sig !== sig || relamp) {
        vr.sig = sig;
        this._enqueue(vr);
      }
    }
    for (const [v, vr] of this._lrecs)
      if (vr.seen !== stamp) {
        this._dropRec(vr);
        this._lrecs.delete(v);
      }
    // the realm's standard flies over every capital
    const staffs = [];
    const cb = [];
    for (const k of civ.kingdoms) {
      if (!k.alive) continue;
      const v = civ.villages[k.capital];
      const h = v?.hall;
      if (!v || !v.alive || !h || !h.alive || h.constructing) continue;
      const r = h.rotation || 0;
      const side = 1.75 * BS;
      const x = h.x + Math.cos(r) * side + Math.sin(r) * 1.2 * BS,
        z = h.z - Math.sin(r) * side + Math.cos(r) * 1.2 * BS;
      const gy = world.heightAt(x, z);
      staffs.push([x, gy, z, 2.5 * BS]);
      cb.push({ x: x + 0.03 * BS, y: gy + 2.45 * BS, z, s: 1.45 * BS, style: h.style, color: civ.kingdomColor(k.id), k: k.id });
    }
    this.staffs = staffs;
    const cs = cb.map((o) => o.k + ',' + o.x + ',' + o.z + ',' + o.color + o.style).join(';');
    if (cs !== this._capSig) {
      this._capSig = cs;
      this._capBanners = cb;
      this._anchorsDirty = true;
    }
    if (changed) this._proxyDirty = true;
  }

  // Drawing what changed, nearest the camera first, until the frame's budget
  // is spent (always at least one record, so a backlog always shrinks)
  _work(budgetMs) {
    const t0 = performance.now();
    let n = 0;
    for (const q of [this._qN, this._qF, this._qD]) {
      while (q.i < q.a.length) {
        if (n > 0 && performance.now() - t0 > budgetMs) break;
        const r = q.a[q.i++];
        r.queued = false;
        if (r.dead) continue;
        if (r.t === 0) this._buildRec(r);
        else if (r.t === 1) this._buildLamps(r);
        else this._buildFences(r);
        n++;
      }
      if (q.i >= q.a.length) {
        q.a.length = 0;
        q.i = 0;
      } else if (q.i > 256) {
        q.a = q.a.slice(q.i);
        q.i = 0;
      }
    }
    if (this._anchorsDirty) this._aggregate();
    if (this._scareDirty) {
      this._scareDirty = false;
      const sl = (this._scareList = []);
      for (const fr of this._frecs.values()) for (let i = 0; i < fr.scare.length; i++) sl.push(fr.scare[i]);
    }
    for (const d of this.details) d.flush();
    if (this._footDirty) {
      this._footDirty = false;
      this.footing.instanceMatrix.needsUpdate = true;
      if (this.footing.instanceColor) this.footing.instanceColor.needsUpdate = true;
    }
    const fb = this.fenceBatch;
    this._fenceN = fb.live;
    if (fb.mesh) fb.mesh.visible = !!this._props && this._fencesOn !== false && fb.live > 0;
    this._meshVis();
    return n;
  }

  // (round 35) The building queues in order of distance from the camera's
  // target: after a jump in time or a camera move of more than a few tiles
  // with records still waiting (each record goes near or far by where the
  // camera was when it was queued).
  _order(force) {
    const c = this.game.cameraRig?.cur;
    if (!c) return;
    const qN = this._qN,
      qF = this._qF;
    const n = qN.a.length - qN.i + qF.a.length - qF.i;
    if (!n) {
      this._ordX = c.x;
      this._ordZ = c.z;
      return;
    }
    const moved = Math.hypot(c.x - (this._ordX ?? 1e9), c.z - (this._ordZ ?? 1e9));
    if (!force && moved < Math.max(8, c.dist * 0.25)) return;
    this._ordX = c.x;
    this._ordZ = c.z;
    const L = [];
    for (const q of [qN, qF])
      for (let i = q.i; i < q.a.length; i++) {
        const r = q.a[i];
        if (r.dead) continue;
        const x = r.b ? r.b.x : r.v.cx,
          z = r.b ? r.b.z : r.v.cz;
        r.qd = Math.max(Math.abs(x - c.x), Math.abs(z - c.z));
        L.push(r);
      }
    L.sort((a, b) => a.qd - b.qd);
    const R = c.dist * 1.6 + 24;
    let k = 0;
    while (k < L.length && L[k].qd < R) k++;
    qN.a = L.slice(0, k);
    qF.a = L.slice(k);
    qN.i = qF.i = 0;
  }

  // (round 35) the town nearest the camera's target (and anything within a
  // few tiles of the target) is drawn now, whatever the budget: the stand-in
  // for a world still filling in round it
  _focusTown() {
    const c = this.game.cameraRig?.cur;
    const civ = this.game.civ;
    if (!c || !civ) return;
    let best = null,
      bd = Infinity;
    for (const v of civ.villages) {
      if (!v?.alive) continue;
      const d = Math.hypot(v.cx - c.x, v.cz - c.z) - (v.buildRadius || 0);
      if (d < bd) (bd = d), (best = v);
    }
    const near = Math.max(6, Math.min(16, c.dist * 0.35));
    const vid = best && bd < Math.max(12, c.dist * 0.6) ? best.id : -1;
    // (and, nearest first, what else stands about as far out as the view
    // reaches round the target, for up to 25 ms more: a neighbouring town at
    // the edge of the screen)
    const view = Math.max(near, Math.min(30, c.dist * 1.1));
    let extra = 0;
    const q = this._qN;
    let w = q.i;
    for (let i = q.i; i < q.a.length; i++) {
      const r = q.a[i];
      if (r.dead || r.t !== 0) {
        q.a[w++] = r;
        continue;
      }
      const must = r.b.village === vid || r.qd < near;
      if (must || (r.qd < view && extra < 25)) {
        const t = must ? 0 : performance.now();
        r.queued = false;
        this._buildRec(r);
        if (!must) extra += performance.now() - t;
      } else q.a[w++] = r;
    }
    q.a.length = w;
  }

  // (round 35) A held frame (the GPU still busy with the last one, as under
  // software GL, where frames come seconds apart) lends its idle time to the
  // backlog, nearest the camera first: the main thread would wait otherwise.
  idle() {
    if (!this.pending() || this._full) return;
    this._order(false);
    this._work(6);
  }

  // backlog of records still to draw
  pending() {
    return this._qN.a.length - this._qN.i + this._qF.a.length - this._qF.i + this._qD.a.length - this._qD.i;
  }

  _buildRec(rec) {
    this._clearRec(rec);
    const b = rec.b;
    const g = this.game;
    const civ = g.civ;
    const world = g.world;
    const def = BUILDING_TYPES[b.type];
    const stage = this._stage(b);
    b._stage = stage;
    rec.stage = stage;
    rec.hp = b.hp;
    rec.burn = b.burning;
    rec.prog = b.progress;
    if (!def || b.gone) return;
    _towerCiv = civ;
    const col = this._bc.setHex(civ.kingdomColor(b.kingdom));
    const push = (key, clip, m, item, extra = null) => this._put(rec, key, clip, m, col, item, extra);
    const decals = rec.decals;
    const M = this._m.makeRotationY(b.rotation || 0).scale(b.type === 'bridge' ? _bridgeS : _bS).setPosition(b.x, b.y, b.z);
    const dw = def.dw ?? def.w,
      dh = def.dh ?? def.h;
    if (stage === 'ruin') {
      if (!def.wall) push(`ruin|${b.style}|${dw}|${dh}|1`, false, M, b);
      return;
    }
    if (def.wall) {
      const clip = b.constructing;
      if (b.type === 'wall') push(`wpost|${b.style}`, clip, this._m2.makeScale(BS, BS, BS).setPosition(b.x, b.y, b.z), b, { wall: true });
      else {
        const a = this._arch(`${b.type}|${b.style}|1`);
        push(`${b.type}|${b.style}|1`, clip, M, b, { maxY: a.maxY });
        if (!clip) this._collectAnchors(b, a, M, col, rec);
        // Gunpowder: a star-shaped bastion round the tower's foot
        if (b.type === 'tower' && b.bastion) push(`bastion|${b.style}`, clip, this._m2.makeRotationY(0).scale(_bS).setPosition(b.x, b.y, b.z), b, { maxY: 0.8 });
      }
      // arms toward connected neighbours
      const wallAt = this._wallAt;
      const W = world.w;
      for (const [dx, dy] of DIRS8) {
        const nb = wallAt.get((b.ty + dy) * W + b.tx + dx);
        if (!nb || nb.village !== b.village) continue;
        if (dx && dy && (wallAt.has(b.ty * W + b.tx + dx) || wallAt.has((b.ty + dy) * W + b.tx))) continue;
        const yaw = Math.atan2(-dy, dx);
        const am = this._m2.makeRotationY(yaw).scale(_wallS).setPosition(b.x, b.y, b.z);
        if (dx && dy) am.multiply(this._m3.makeScale(Math.SQRT2, 1, 1));
        push(`warm|${b.style}`, clip, am, b, { wall: true });
      }
      return;
    }
    const lvl = Math.min(b.level || 1, def.levels);
    const akey = archKey(b, def, lvl, civ.kingdoms[b.kingdom]?.era ?? 0);
    const a = this._arch(akey);
    // Modern and later homes and blocks stand about a quarter larger (a car
    // was 0.8 of a house), as wide as their plot allows; the works of
    // industry rise taller (a factory reads at least twice a house); a
    // colossus is cut to the size of a small town
    const ups = this._upscale(b, def, a, civ);
    if (ups) M.multiply(this._m3.makeScale(ups[0], ups[1], ups[0]));
    if (stage === 'found' || stage === 'frame' || stage === 'build') {
      // footings, then a timber frame, then walls rising, then the roof;
      // timber and stone stacked by the site until it is done
      if (stage === 'found') push(`found|${dw}|${dh}`, false, M, b);
      else push(`frame|${dw}|${dh}|${Math.min(3, Math.max(1, Math.round(a.maxY * 2) / 2))}`, false, M, b);
      if (stage === 'build') push(akey, true, M, b, { maxY: a.maxY });
      const pm = this._m2.copy(M).multiply(new THREE.Matrix4().makeTranslation(dw / 2 - 0.35, 0, dh / 2 - 0.3));
      push(`pile`, false, pm, b);
      // Engineering: a tower crane over the larger sites
      if (stage !== 'found' && dw * dh >= 4 && civ.hasTech?.(b.kingdom, 'engineering')) {
        const cm = new THREE.Matrix4().copy(M).multiply(new THREE.Matrix4().makeTranslation(-dw / 2 + 0.25, 0, -dh / 2 + 0.25));
        push('crane', false, cm, null);
        civ._firstUse?.(civ.kingdoms[b.kingdom], 'crane', { x: b.x, z: b.z });
      }
    } else {
      push(akey, false, M, b);
      if (stage === 'upg') push(`scaf|${dw}|${dh}|${Math.min(3, Math.round(a.maxY * 2) / 2)}`, false, M, b);
      this._collectAnchors(b, a, M, col, rec);
      // heritage in a modern realm: floodlights at the front corners
      if (b.heritage && (civ.kingdoms[b.kingdom]?.era ?? 0) >= 5) {
        for (const sx of [-1, 1]) {
          const p = this._p.set(sx * dw * 0.42, 0, dh * 0.5).applyMatrix4(M);
          const gy = world.heightAt(p.x, p.z);
          decals.push([p.x, gy, p.z, 0.55 * BS]);
          rec.lights.push(p.x, gy + 0.08, p.z, 0.45);
        }
      }
    }
    if (a.base && !a.stilts && stage !== 'found') {
      const bus = ups ? ups[0] : 1;
      const bx = (a.base.x || 0) * bus,
        bz = (a.base.z || 0) * bus;
      const top = b.y + 0.04;
      const bottom = Math.min(b.groundMin ?? b.y, b.y) - 0.35;
      const fm = this._m2.makeRotationY(b.rotation || 0);
      fm.setPosition(b.x, top, b.z);
      fm.multiply(this._m3.makeTranslation(bx * BS, 0, bz * BS));
      fm.multiply(this._m3.makeScale((a.base.w + 0.04) * BS * bus, top - bottom, (a.base.d + 0.04) * BS * bus));
      rec.foot = this._footAlloc(fm, b.style);
    }
    if (rec.chimneys.length || rec.banners.length || rec.blades.length || rec.boats.length || rec.decals.length || rec.lights.length) this._anchorsDirty = true;
  }

  // a town's street lights: a town, or a busy village of a realm with
  // electricity (its powered street)
  _lampSig(v, civ) {
    if (!v.alive) return '';
    const elec = v.tier < 1 && !!civ.hasTech?.(v.kingdom, 'electricity');
    if (v.tier < 1 && !(v.pop >= 20 && (v.powered || elec))) return '';
    const lit = !!v.powered || elec;
    return (lit ? 'L' : 'l') + (v.tier >= 1 ? 1 : 0) + '|' + v.roadTiles.length + '|' + v.buildings.length + '|' + Math.round(v.radius * 4) + '|' + Math.round(v.cx * 2) + '|' + Math.round(v.cz * 2) + '|' + civ.kingdomColor(v.kingdom) + '|' + Math.min(8, civ.kingdoms[v.kingdom]?.mastery || 0);
  }

  _buildLamps(vr) {
    this._clearRec(vr);
    const v = vr.v;
    const civ = this.game.civ;
    const world = this.game.world;
    if (!v.alive) return;
    if (v.tier < 1 && !(v.pop >= 20 && (v.powered || civ.hasTech?.(v.kingdom, 'electricity')))) return;
    const col = this._bc.setHex(civ.kingdomColor(v.kingdom));
    // a realm of masters lights more of its streets; a powered town lights
    // them with electric street lights
    const lit = !!v.powered || (v.tier < 1 && !!civ.hasTech?.(v.kingdom, 'electricity'));
    const lampP = lit ? 0.3 : 0.11 + Math.min(0.12, (civ.kingdoms[v.kingdom]?.mastery || 0) * 0.015);
    for (const i of v.roadTiles) {
      if (civ.use?.[i] !== 2) continue;
      const tx = i % world.w,
        ty = (i / world.w) | 0;
      if (hash2(tx, ty, 91) > lampP) continue;
      if (Math.hypot(tx + 0.5 - v.cx, ty + 0.5 - v.cz) > v.radius * (lit ? 0.95 : 0.8)) continue;
      // stand on the road edge next to a building or plot
      let ox = 0,
        oz = 0;
      for (let j = 0; j < 4; j++) {
        const dx = DIRS8[j][0],
          dy = DIRS8[j][1];
        if (world.building[(ty + dy) * world.w + tx + dx] >= 0) {
          ox = dx * 0.38;
          oz = dy * 0.38;
          break;
        }
      }
      if (!ox && !oz) continue;
      const x = tx + 0.5 + ox,
        z = ty + 0.5 + oz;
      const ls = lit ? LS : LP;
      const gy = world.heightAt(x, z);
      const lm = this._m2.makeRotationY(Math.atan2(-oz, ox) + Math.PI).scale(this._s.set(ls, ls, ls)).setPosition(x, gy, z);
      if (lit) {
        this._put(vr, 'streetlamp', false, lm, col, null);
        vr.decals.push([x - ox * 0.75 * (LS / PS), gy, z - oz * 0.75 * (LS / PS), 0.6 * PS]);
        vr.lights.push(x - ox * 0.75 * LS, gy + 1.08 * LS, z - oz * 0.75 * LS, 0.75);
      } else {
        this._put(vr, 'lamppost', false, lm, col, null);
        vr.decals.push([x - ox * 0.4 * (LP / PS), gy, z - oz * 0.4 * (LP / PS), 0.5 * PS]);
      }
    }
    if (vr.decals.length || vr.lights.length) this._anchorsDirty = true;
  }

  // the flat lists the animation reads (chimneys, banners, sails, boats),
  // the ground glows and the night lights, gathered from the records
  _aggregate() {
    this._anchorsDirty = false;
    const ch = (this.chimneys = []),
      bn = (this.banners = this._capBanners.slice()),
      bl = (this.blades = []),
      bo = (this.boats = []),
      lights = (this.lights = []), // x, y, z, size of each glow sprite (street lights, floodlights)
      decals = [];
    const add = (r) => {
      for (let i = 0; i < r.chimneys.length; i++) ch.push(r.chimneys[i]);
      for (let i = 0; i < r.banners.length; i++) bn.push(r.banners[i]);
      for (let i = 0; i < r.blades.length; i++) bl.push(r.blades[i]);
      for (let i = 0; i < r.boats.length; i++) bo.push(r.boats[i]);
      for (let i = 0; i < r.lights.length; i++) lights.push(r.lights[i]);
      for (let i = 0; i < r.decals.length; i++) decals.push(r.decals[i]);
    };
    for (const r of this._recs.values()) add(r);
    for (const r of this._lrecs.values()) add(r);
    // decals
    if (decals.length > this.decals.instanceMatrix.count) {
      const nm = new THREE.InstancedMesh(this.decals.geometry, this.decalMat, Math.ceil(decals.length * 1.5));
      nm.renderOrder = 3;
      nm.frustumCulled = false;
      nm.visible = this.decals.visible;
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
    this.glow.set(lights);
    // smoke plumes over the stacks of working industry, steam over cooling towers
    const pl = [];
    for (const c of ch) {
      if (!(c.stack || c.steam) || !c.b.alive || c.b.constructing) continue;
      const t = c.b.type;
      const soot = t === 'foundry' || t === 'bloomery' || t === 'kiln';
      pl.push({ x: c.x, y: c.y, z: c.z, s: c.steam ? 1.15 : soot ? 0.8 : t === 'powerstation' ? 1.05 : 0.95, tone: c.steam ? 2 : soot ? 0.85 : 0.2 });
    }
    this.plumes.set(pl);
  }

  // far-zoom proxies: the landmarks as plain blocks, one batch per style
  // (rebuilt only while the far view is shown)
  _rebuildProxies() {
    const civ = this.game.civ;
    this._proxyDirty = false;
    this._proxyT = this.game.time.realTime;
    _towerCiv = civ;
    const col = this._bc;
    const proxies = new Map();
    for (const b of civ.buildings) {
      if (b.gone || !b.alive) continue;
      const def = BUILDING_TYPES[b.type];
      if (!def) continue;
      // (houses and small buildings are not drawn at far zoom: the terrain's
      // urban patch stands for them, and the landmarks mark the town)
      if (isMinor(b)) continue;
      const key = b.type === 'skyscraper' || b.type === 'arcology' ? 'proxy|tower' : 'proxy|' + b.style;
      let L = proxies.get(key);
      if (!L) proxies.set(key, (L = { m: [], col: [], bs: [] }));
      const a = this._arch(def.wall ? `wpost|${b.style}` : archKey(b, def, Math.min(b.level || 1, def.levels), civ.kingdoms[b.kingdom]?.era ?? 0));
      // (towers stand in as stockier light glass blocks: a tall thin shaft
      // cast a long shadow and read as a bollard from the whole map)
      const tower = key === 'proxy|tower';
      const hgt = (def.wall ? 1.1 : Math.max(0.5, Math.min(def.monument ? 12 : b.type === 'arcology' ? 14 : def.modern ? (tower ? 5.2 : 7.5) : 3, a.maxY)) * (b.constructing ? Math.max(0.2, b.progress) : 1)) * BS;
      const pw = def.wall || b.type === 'bridge' ? def.w : (def.dw ?? def.w) * BS,
        ph = def.wall || b.type === 'bridge' ? def.h : (def.dh ?? def.h) * BS;
      const fs = tower ? 0.95 : 0.82;
      const pm = this._m2.makeRotationY(b.rotation || 0).setPosition(b.x, b.y, b.z).multiply(this._m3.makeScale(pw * fs, hgt, ph * fs));
      for (let i = 0; i < 16; i++) L.m.push(pm.elements[i]);
      col.setHex(tower ? 0x9fb2c2 : civ.kingdomColor(b.kingdom));
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
    for (const b of this.proxyBatches.values()) if (b.mesh) b.mesh.visible = !!this._far && b.mesh.count > 0;
  }

  // footings: one slot each in the footing batch (a freed slot is scaled to nothing)
  _footAlloc(m, style) {
    let i = this._footSlots.pop();
    if (i == null) {
      i = this._footN++;
      if (i >= this.footing.instanceMatrix.count) {
        const cap = Math.ceil((i + 1) * 1.5);
        const old = this.footing;
        const nm = new THREE.InstancedMesh(old.geometry, old.material, cap);
        nm.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        nm.instanceMatrix.array.set(old.instanceMatrix.array);
        if (old.instanceColor) nm.instanceColor.array.set(old.instanceColor.array);
        nm.castShadow = false;
        nm.receiveShadow = true;
        nm.frustumCulled = false;
        nm.visible = old.visible;
        this.group.remove(old);
        old.dispose();
        this.group.add(nm);
        this.footing = nm;
      }
      this.footing.count = this._footN;
    }
    this.footing.setMatrixAt(i, m);
    // (round 31) a grey dressed stone, only tinged by the style's own
    this._c.setHex(PAL[style]?.stone2 ?? 0x847c70).lerp(this._fg || (this._fg = new THREE.Color(0x8d8a84)), 0.65);
    this.footing.setColorAt(i, this._c);
    this._footDirty = true;
    return i;
  }

  _footRelease(i) {
    this.footing.setMatrixAt(i, _zeroM);
    this._footSlots.push(i);
    this._footDirty = true;
  }

  _collectAnchors(b, a, M, col, rec) {
    const an = a.anchors;
    if (!an) return;
    const world = this.game.world;
    const p = this._p;
    for (const c of an.chimneys) {
      p.set(c.x, c.y, c.z).applyMatrix4(M);
      const stack = !c.steam && INDUSTRY.has(b.type);
      rec.chimneys.push({ x: p.x, y: p.y, z: p.z, rate: c.rate || 1, forge: !!c.forge, steam: !!c.steam, stack, b, t: Math.random() * 3 });
    }
    for (const c of an.banners) {
      p.set(c.x, c.y, c.z).applyMatrix4(M);
      rec.banners.push({ x: p.x, y: p.y, z: p.z, s: (c.s || 1) * BS, style: b.style, color: col.getHex(), k: b.kingdom });
    }
    for (const c of an.blades) {
      const bm = new THREE.Matrix4().copy(M).multiply(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z));
      rec.blades.push({ m: bm, style: c.turbine ? 'turbine' : b.style, phase: b.seed * 10 });
    }
    const moreShips = b.type === 'docks' && (this.game.civ?.kingdoms?.[b.kingdom]?.mastery || 0) >= 8;
    for (const c of moreShips ? [...an.boats, ...an.boats.map((o) => ({ ...o, x: o.x + 0.55, z: o.z + 0.35, ship: true }))] : an.boats) {
      p.set(c.x, c.y, c.z).applyMatrix4(M);
      const tx = Math.floor(p.x),
        tz = Math.floor(p.z);
      if (!world.inBounds(tx, tz) || world.height[tz * world.w + tx] >= SEA_LEVEL) continue;
      rec.boats.push({ x: p.x, z: p.z, ry: (b.rotation || 0) + (c.ry || 0), style: c.ship ? (b.style === 'frost' || b.style === 'vale' ? 'frost' : 'dune') : b.style, phase: b.seed * 20 + rec.boats.length, s: (c.ship ? 1.75 : 1) * VEHICLE.sea }); // (boats are craft: half size since round 24)
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
      rec.decals.push([p.x, world.heightAt(p.x, p.z), p.z, Math.min(0.75, (c.r || 1) * 0.5) * BS]);
    }
  }

  // Per-instance state: damage, burning, seed and the clip height of a
  // building rising in its scaffolding, and the shader flags. A DetailBatch
  // keeps it in its instance texture (texel 1 of 2).
  _writeState(d, id) {
    const arr = d.data;
    const b = d.items[id];
    const k = id * 8 + 4;
    d._dDirty = true;
    if (!b) {
      arr[id * 8 + 3] = 0;
      arr[k] = 0;
      arr[k + 1] = 0;
      arr[k + 2] = 0.37;
      arr[k + 3] = 99;
      return;
    }
    const ex = d.extra[id];
    const hpf = b.maxHp ? b.hp / b.maxHp : 1;
    let dmg = b.alive ? Math.max(0, 1 - hpf - 0.12) / 0.88 : 0.7;
    if (b.constructing) dmg = 0;
    arr[k] = Math.min(1, dmg);
    arr[k + 1] = b.burning || 0;
    arr[k + 2] = b.seed || 0;
    let clipY = 99;
    if (b.constructing && b.progress >= 0.4) {
      const maxY = ex?.maxY ?? (BUILDING_TYPES[b.type]?.wall ? WALL_H + 0.1 : 2);
      const t = (b.progress - 0.4) / 0.6;
      clipY = ex?.wall ? -0.5 + (WALL_H + 0.65) * b.progress : -0.1 + (maxY + 0.15) * t;
    } else if (b.constructing && ex?.wall) clipY = -0.5 + (WALL_H + 0.65) * b.progress;
    arr[k + 3] = clipY;
    arr[id * 8 + 3] = this._flags(b);
  }

  // the same state for a far-zoom proxy Batch (its iState attribute)
  _writeStates(batch) {
    const arr = batch.iState.array;
    const items = batch.items;
    for (let i = 0; i < items.length; i++) {
      const b = items[i];
      const k = i * 4;
      const hpf = b.maxHp ? b.hp / b.maxHp : 1;
      let dmg = b.alive ? Math.max(0, 1 - hpf - 0.12) / 0.88 : 0.7;
      if (b.constructing) dmg = 0;
      arr[k] = Math.min(1, dmg);
      arr[k + 1] = b.burning || 0;
      arr[k + 2] = b.seed || 0;
      arr[k + 3] = 99;
    }
    batch.iState.needsUpdate = true;
  }

  // instance flags for the shader: 1 lit by electricity (a powered town),
  // 2 a floodlit heritage building (its realm in the Modern era or later)
  _flags(b) {
    const civ = this.game.civ;
    let f = civ.villages[b.village]?.powered ? 1 : 0;
    if (b.heritage && (civ.kingdoms[b.kingdom]?.era ?? 0) >= 5) f += 2;
    return f;
  }

  // Damage, fire and building progress: only the buildings whose numbers
  // moved are written; one that reached a new stage of building is queued
  // to be drawn again. (all: every instance, when the towns' power changed.)
  _statePass(all = false) {
    for (const rec of this._recs.values()) {
      if (rec.queued || rec.dead) continue;
      const b = rec.b;
      if (b.gone) continue;
      if (this._stage(b) !== rec.stage) {
        this._enqueue(rec);
        continue;
      }
      if (!all && b.hp === rec.hp && b.burning === rec.burn && b.progress === rec.prog) continue;
      rec.hp = b.hp;
      rec.burn = b.burning;
      rec.prog = b.progress;
      const L = rec.inst;
      for (let i = 0; i < L.length; i += 2) this._writeState(L[i], L[i + 1]);
    }
    if (this._far && this.proxyBatches) for (const batch of this.proxyBatches.values()) if (batch.mesh?.count) this._writeStates(batch);
  }

  // ------------------------------------------------------------------ fences & fields
  // a town's field fences and scarecrows, redrawn only when its fields change
  // (a number: the town's style and centre, and each tilled plot's bounds,
  // size and whether its middle is tilled; 0 when it has no fences)
  _fenceSig(v, world) {
    if (!v.alive || !v.plots?.length) return 0;
    const FARM = TILE.FARMLAND;
    const type = world.type;
    let h = (STYLE_N[CULTURES[baseCulture(v.culture)]?.style] ?? 0) + 1;
    h = (Math.imul(h, 31) + Math.floor(v.cx) * 4099 + Math.floor(v.cz)) | 0;
    let any = false;
    for (const p of v.plots) {
      let tilled = 0;
      const T = p.tiles;
      for (let j = 0; j < T.length; j++) if (type[T[j]] === FARM && ++tilled >= 2) break;
      if (tilled < 2) continue;
      any = true;
      const ci = Math.floor((p.y0 + p.y1 + 1) / 2) * world.w + Math.floor((p.x0 + p.x1 + 1) / 2);
      h = (Math.imul(h, 31) + p.x0 * 7919 + p.y0 * 104729 + p.x1 * 1299709 + p.y1 * 15485863 + T.length * 2 + (type[ci] === FARM ? 1 : 0)) | 0;
    }
    return any ? h || 1 : 0;
  }

  // fences and street lights of the towns whose ground was reshaped
  _heightPass() {
    const R = this._hRects,
      all = this._hAll;
    this._hRects = [];
    this._hAll = false;
    const hit = (x0, y0, x1, y1) => {
      if (all) return true;
      for (const r of R) if (x1 >= r.x0 && x0 <= r.x1 && y1 >= r.y0 && y0 <= r.y1) return true;
      return false;
    };
    for (const vr of this._lrecs.values()) {
      const v = vr.v,
        rr = (v.radius || 8) + 1;
      if (!vr.queued && hit(v.cx - rr, v.cz - rr, v.cx + rr, v.cz + rr)) this._enqueue(vr);
    }
    for (const fr of this._frecs.values()) {
      if (fr.queued) continue;
      for (const p of fr.v.plots || [])
        if (hit(p.x0 - 1, p.y0 - 1, p.x1 + 1, p.y1 + 1)) {
          this._enqueue(fr);
          break;
        }
    }
  }

  _scanFences() {
    const civ = this.game.civ;
    const world = this.game.world;
    const stamp = ++this._fstamp;
    for (const v of civ.villages) {
      if (!v) continue;
      const sig = this._fenceSig(v, world);
      let fr = this._frecs.get(v);
      if (!sig) {
        if (fr) {
          this._dropRec(fr);
          this._frecs.delete(v);
        }
        continue;
      }
      if (!fr) this._frecs.set(v, (fr = this._newRec(2, null, v)));
      fr.seen = stamp;
      if (fr.sig !== sig) {
        fr.sig = sig;
        this._enqueue(fr);
      }
    }
    for (const [v, fr] of this._frecs)
      if (fr.seen !== stamp) {
        this._dropRec(fr);
        this._frecs.delete(v);
      }
  }

  _buildFences(fr) {
    this._clearRec(fr);
    const v = fr.v;
    const world = this.game.world;
    if (!v.alive) return;
    const st = CULTURES[baseCulture(v.culture)]?.style || 'vale';
    const F = FENCE[st];
    if (!F) return;
    const posts = [],
      rails = [];
    const q = this._q;
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
          posts.push([px, py, pz]);
        }
        for (const ry of F.wall ? [F.rail[1] * 0.5] : F.rails) rails.push([ax, ay + ry * PS, az, bx, by + ry * PS, bz]);
      }
      if (st !== 'dune' && p.tiles.length >= Math.round(12 * Math.max(0.5, FOOTPRINT.scale ** 2))) {
        const ci = Math.floor(cz) * world.w + Math.floor(cx);
        // (a person-height prop: the people's factor, PROP.kit, round 25)
        if (world.type[ci] === TILE.FARMLAND && this.scareGeo.has(st)) fr.scare.push(st, new THREE.Matrix4().compose(this._p.set(cx + 0.1, world.heightAt(cx, cz), cz), q.setFromAxisAngle(this._up, hash2(p.x0, p.y0, 5) * 6), this._s.set(PROP.kit, PROP.kit, PROP.kit)));
      }
    }
    if (fr.scare.length) this._scareDirty = true;
    // (posts and rails of every style: one batched draw and one shadow draw)
    const fb = this.fenceBatch;
    const base = this._fc.setHex(F.color);
    if (!F.wall)
      for (let i = 0; i < posts.length; i++) {
        const [x, y, z] = posts[i];
        const s = F.post;
        this._m.compose(this._p.set(x, y - 0.06, z), q.setFromAxisAngle(this._up, hash2(Math.round(x * 7), Math.round(z * 7), 3) * 0.4), this._s.set(s[0] * PS, s[1] * PS + 0.06, s[2] * PS));
        this._c.copy(base).multiplyScalar(0.85 + hash2(Math.round(x * 7), Math.round(z * 7), 1) * 0.3);
        fr.inst.push(fb.alloc('post', this.postGeo, this._m, this._c));
      }
    const dir = this._dir;
    for (let i = 0; i < rails.length; i++) {
      const [ax, ay, az, bx, by, bz] = rails[i];
      dir.set(bx - ax, by - ay, bz - az);
      const len = dir.length();
      dir.normalize();
      q.setFromUnitVectors(_X, dir);
      const th = F.rail;
      this._m.compose(this._p.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), q, this._s.set(len + (F.wall ? th[0] * 0.5 * PS : 0.02), th[1] * PS, th[0] * PS));
      this._c.copy(base).multiplyScalar(0.8 + hash2(Math.round((ax + bx) * 7), Math.round((az + bz) * 7 + ay * 3), 2) * 0.35);
      fr.inst.push(fb.alloc('rail', this.railGeo, this._m, this._c));
    }
  }

  // ------------------------------------------------------------------ animation
  _updateBanners() {
    // flags and standards are a few pixels past ~75 tiles: not drawn there
    // (5 draws and a shadow draw at mid zoom, one per culture's flag)
    const show = !this._far && (this.game.cameraRig?.cur?.dist ?? 60) < 75;
    this.staffMesh = this.staffMap.get('s');
    this.staffMesh.visible = show;
    for (const m of this.bannerMeshes.values()) m.visible = show && m.count > 0;
    if (!show) return;
    const env = this.game.env;
    const civ = this.game.civ;
    const units = this.game.units;
    const wind = env.wind || { x: 1, z: 0, strength: 0.3 };
    const yaw = Math.atan2(-(wind.z || 0), wind.x || 1);
    const per = new Map();
    for (const b of this.banners) {
      if (!this._inView(b.x, b.y, b.z, b.s * 1.5 + 0.5)) continue; // (round 33: banners cast no shadow)
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
      const US = UNIT.scale;
      const x = u.x + c * 0.14 * US,
        z = u.z - h * 0.14 * US;
      const y = (u.y ?? this.game.world.surfaceAt(u.x, u.z)) + 0.15 * US;
      staffs.push([x, y, z, 1.85 * US]);
      const st = CULTURES[baseCulture(civ.kingdoms[a.kingdom]?.culture)]?.style || 'vale';
      let L = per.get(st);
      if (!L) per.set(st, (L = []));
      L.push({ x: x + 0.02 * US, y: y + 1.8 * US, z, s: 1.7 * US, style: st, color: civ.kingdomColor(a.kingdom), k: a.kingdom });
    }
    // the realm's flag over each parade pad (round 31: it had been a blank
    // flat board about 0.7 by 0.46 tiles; now a standard with the emblem,
    // about 0.6 that size)
    {
      const cam = this.game.cameraRig?.cur;
      for (const v of civ.villages || []) {
        const pd = v && v.alive && v._parade;
        if (!pd || !pd.ok) continue;
        if (cam && (Math.abs(v.cx - cam.x) > 60 || Math.abs(v.cz - cam.z) > 60)) continue;
        const f = padFlagSpot(pd, this.game.world);
        const hgt = 1.05;
        staffs.push([f.x, f.y, f.z, hgt]);
        const st = CULTURES[baseCulture(civ.kingdoms[v.kingdom]?.culture)]?.style || 'vale';
        let L = per.get(st);
        if (!L) per.set(st, (L = []));
        L.push({ x: f.x + 0.02, y: f.y + hgt - 0.04, z: f.z, s: 1.15, style: st, color: civ.kingdomColor(v.kingdom), k: v.kingdom });
      }
    }
    const sm = this._grow(this.staffMap, 's', staffs.length);
    for (let i = 0; i < staffs.length; i++) {
      const [x, y, z, hgt] = staffs[i];
      this._m.compose(this._p.set(x, y, z), this._q.identity(), this._s.set(BS, hgt, BS));
      sm.setMatrixAt(i, this._m);
    }
    sm.count = staffs.length;
    sm.visible = staffs.length > 0;
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
      mesh.visible = L.length > 0;
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
    const D = this.game.cameraRig?.cur?.dist ?? 60;
    const pb = this.propBatch;
    pb.begin();
    const showBlades = !this._far,
      showBoats = D < this.lodDist,
      showScare = !!this._props;
    // (round 33) none of these cast a shadow: those outside the view are
    // only hidden, not written (sails, boats and scarecrows of the whole
    // world were rewritten every frame)
    const K = this._pkeys || (this._pkeys = new Map());
    const key = (a, st) => {
      const k = a + st;
      let v = K.get(k);
      if (v === undefined) K.set(k, (v = a + '|' + st));
      return v;
    };
    for (const [st, L] of per) {
      const geo = this.bladeGeo.get(st);
      if (!geo) continue;
      const kk = key('blades', st);
      for (let i = 0; i < L.length; i++) {
        const e = L[i].m.elements;
        const vis = showBlades && this._inView(e[12], e[13], e[14], 2.5);
        if (vis) this._m.copy(L[i].m).multiply(this._m2.makeRotationZ(spin + L[i].phase));
        pb.push(kk, geo, this._m, null, vis);
      }
    }
    for (const b of this.boats) {
      const geo = this.boatGeo.get(b.style);
      if (!geo) continue;
      const vis = showBoats && this._inView(b.x, SEA_LEVEL, b.z, 1.5);
      if (vis) {
        const t = this.t + b.phase;
        const bob = Math.sin(t * 1.6) * 0.025;
        this._q.setFromEuler(this._eu.set(Math.sin(t * 1.3) * 0.05, b.ry + Math.PI / 2 + Math.sin(t * 0.3) * 0.08, Math.sin(t * 1.1 + 1) * 0.04));
        this._m.compose(this._p.set(b.x + Math.sin(t * 0.25) * 0.08, SEA_LEVEL - 0.03 + bob, b.z), this._q, this._s.set(b.s || 1, b.s || 1, b.s || 1));
      }
      pb.push(key('boat', b.style), geo, this._m, null, vis);
    }
    const sl = this._scareList;
    for (let i = 0; i < sl.length; i += 2) {
      const e = sl[i + 1].elements;
      pb.push(key('scare', sl[i]), this.scareGeo.get(sl[i]), sl[i + 1], null, showScare && this._inView(e[12], e[13], e[14], 1));
    }
    pb.end();
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
    // past about 90 tiles houses and small buildings are hidden (the town
    // reads as its urban patch and its landmarks, not salt and pepper)
    const mid = this._mid ? D > this.minorDist - 6 : D > this.minorDist;
    // field fences go at far zoom (past ~88), where the terrain fills each plot
    const fences = props && D <= 88;
    if (!force && far === this._far && props === this._props && this._lampsOn === props && mid === this._mid && fences === this._fencesOn) return;
    const midChanged = mid !== this._mid;
    this._fencesOn = fences;
    this._far = far;
    this._props = props;
    this._mid = mid;
    this._meshVis();
    if (force || midChanged) {
      this.dSolid.hideMinor(mid);
      this.dClip.hideMinor(mid);
      this._lampsOn = null;
    }
    if (far && this._proxyDirty) this._rebuildProxies();
    for (const b of (this.proxyBatches || new Map()).values()) if (b.mesh) b.mesh.visible = far && b.mesh.count > 0;
    // (footings go with the small buildings: past ~90 tiles they were a
    // field of brown and orange squares on the town's grey patch)
    if (this.footing) this.footing.visible = !far && !mid;
    if (this._lampsOn !== props) {
      this._lampsOn = props;
      this.dSmall.showKey('lamppost', props);
      this.dSmall.showKey('streetlamp', props);
    }
    // fences: shown or hidden as a whole (the sails, boats and scarecrows
    // read the same flags when they are written each frame)
    const fb = this.fenceBatch;
    if (fb.mesh) fb.mesh.visible = fences && (this._fenceN || 0) > 0;
    for (const m of this.bannerMeshes.values()) m.visible = !far && m.count > 0;
    if (this.decals) this.decals.visible = props && this.decalMat.opacity > 0.01;
  }

  // whether a sphere at (x,y,z) of radius r meets this frame's (widened) view
  _inView(x, y, z, r) {
    if (!this._vfOk) return true;
    this._vs.center.set(x, y, z);
    this._vs.radius = r;
    return this._vf.intersectsSphere(this._vs);
  }

  // the model batches are drawn when they hold something and the zoom shows them
  _meshVis() {
    const far = !!this._far;
    for (const d of this.details) if (d.mesh) d.mesh.visible = !far && d.n > 0;
    if (this.dSmall.mesh) this.dSmall.mesh.visible = !far && !this._mid && this.dSmall.n > 0;
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
    const camD = rig.cur.dist;
    if (close) {
      // the stacks of factories, foundries and power stations: a thick,
      // steady plume (they had the same wisp as a cottage, lost in the
      // budget); own budget, so homes' chimneys cannot starve them
      // (now drawn by the plume layer, StackPlumes; the particle puffs were
      // lost at mid zoom). Kept for the fallback puffs only.
      let sb = real ? 0 : 8;
      for (const c of this.chimneys) {
        if (!c.stack || sb <= 0) continue;
        c.t -= dt;
        if (c.t > 0) continue;
        c.t = (0.55 / Math.max(0.6, c.rate)) * (0.8 + Math.random() * 0.4) * (g.settings?.powerSaver ? 2 : 1);
        const b = c.b;
        if (!b.alive || b.constructing) continue;
        if ((c.x - cx) ** 2 + (c.z - cz) ** 2 > R2) continue;
        if (sb-- <= 0) break;
        if (real) fx.emit?.('smoke', { x: c.x, y: c.y, z: c.z }, { scale: 1.05 * BS });
        else this.puffs.emit(c.x, c.y, c.z, 'smoke', 1.3 * BS);
      }
      // home and forge chimneys: only while the houses themselves are drawn
      // (past ~90 tiles their brown wisps were left lying over the town and
      // its ridges as smudges, with no house under them)
      const homes = rig.cur.dist < this.minorDist;
      for (const c of this.chimneys) {
        if (c.stack || !homes) continue;
        c.t -= dt;
        if (c.t > 0) continue;
        c.t = ((c.forge ? 0.55 : 2.4 + Math.random() * 2.6) / (c.rate || 1)) * (g.settings?.powerSaver ? 2 : 1);
        const b = c.b;
        if (!b.alive || b.constructing) continue;
        // (round 25: eight or more puffs hung over ordinary Modern blocks:
        // a Modern or Future town's homes and shops are heated without a
        // fire, so only its works, factories and power stacks smoke)
        if (!c.steam && !c.forge && (g.civ?.kingdoms?.[b.kingdom]?.era || 0) >= 5) continue;
        if ((c.x - cx) ** 2 + (c.z - cz) ** 2 > R2) continue;
        if (budget-- <= 0) break;
        if (c.steam) {
          // cooling towers breathe white steam (the plume layer draws it)
          if (!real) this.puffs.emit(c.x, c.y, c.z, 'smoke', 1.2 * BS);
        } else if (real) fx.emit?.('smoke', { x: c.x, y: c.y, z: c.z }, { scale: (c.forge ? 0.6 : 0.42) * BS });
        else this.puffs.emit(c.x, c.y, c.z, 'smoke', (c.forge ? 0.85 : 0.6) * BS);
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
          // battered but not burning: a thin wisp of pale smoke from the
          // wreckage, only up close and only from a badly damaged building
          // (round 22: a steady dark plume from every battered wall tower
          // drifted along the slopes as black soot on cliffs and brown
          // bruises on ridges at far zoom)
          if (camD < 70 && b.hp < b.maxHp * 0.45 && Math.random() < 0.2) {
            const sx = b.x + (Math.random() - 0.5) * b.w * 0.5,
              sz = b.z + (Math.random() - 0.5) * b.h * 0.5;
            if (real) fx.emit?.('smoke', { x: sx, y: b.y + 1.6 * BS, z: sz }, { scale: (0.4 + 0.6 * (1 - b.hp / b.maxHp)) * BS, dark: false, count: 2 });
            else this.puffs.emit(sx, b.y + 0.8 * BS, sz, 'soot', 0.7 * BS);
          }
          continue;
        }
        const x = b.x + (Math.random() - 0.5) * b.w * 0.7,
          z = b.z + (Math.random() - 0.5) * b.h * 0.7;
        const y = b.y + (b.alive ? 0.4 + Math.random() * 0.8 : 0.15) * BS;
        if (real) {
          if (b.alive) fx.emit?.('fire', { x, y, z }, { scale: (0.6 + b.burning * 0.6) * BS });
          if (Math.random() < 0.5) fx.emit?.('smoke', { x, y: y + 0.4 * BS, z }, { scale: (0.8 + b.burning) * BS });
          if (Math.random() < 0.08) fx.addLight?.({ x, y: y + 0.5 * BS, z }, 0xff7a30, 1.5 * b.burning, 0.6);
        } else {
          if (b.alive) this.puffs.emit(x, y, z, 'fire', (0.7 + b.burning * 0.5) * BS);
          if (Math.random() < 0.6) this.puffs.emit(x, y + 0.3 * BS, z, 'soot', (0.8 + b.burning * 0.5) * BS);
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
    this.infra?.update(dt);
    this.t += dt;
    const env = g.env;
    this.uniforms.uTime.value = this.t;
    const day = env.daylight ?? 1;
    const night = 1 - THREE.MathUtils.smoothstep(day, 0.12, 0.62);
    this.uniforms.uNight.value += (night - this.uniforms.uNight.value) * Math.min(1, dt * 3 + (this._first ? 0 : 1));
    this._first = true;
    this.uniforms.uWind.value = env.wind?.strength ?? 0.35;
    // roofs whiten through the winter (and in a snowfall), as the fields do
    {
      const se = g.time?.season ?? 1.5;
      const wint = THREE.MathUtils.smoothstep(se, 2.9, 3.15) * (1 - THREE.MathUtils.smoothstep(se, 3.8, 3.98));
      const snowing = env.weather?.type === 'snow' ? Math.min(1, 0.4 + (env.weather.intensity ?? 0.5)) : 0;
      const target = Math.max(wint, snowing) * (1 - Math.max(0, (g.age?.mods?.temperature ?? 0) * 2));
      this.uniforms.uSnow.value += (Math.max(0, target) - this.uniforms.uSnow.value) * Math.min(1, dt * 0.5);
    }
    this.decalMat.opacity = this.uniforms.uNight.value * 0.42;
    this.decals.visible = this._props !== false && this.decalMat.opacity > 0.01;
    const now = g.time.realTime;
    // a jump in time (a fast-forward, the first frame, a new world): what
    // changed is drawn at once; in live play a few milliseconds a frame
    const tG = g.time.total;
    if (this._tG != null && tG - this._tG > 30 + 2 * Math.max(0, now - this._tR) * Math.max(1, g.speed || 1)) this._full = true;
    this._tG = tG;
    this._tR = now;
    // which towns have power: street lights and electric windows follow it
    this._powT = (this._powT || 0) - dt;
    if (this._powT <= 0 || this._full) {
      this._powT = 1;
      let sig = '';
      for (const v of civ.villages) if (v.alive && v.powered) sig += v.id + ',';
      for (const b of civ.buildings) if (b.heritage && !b.gone) sig += 'h' + b.id + (civ.kingdoms[b.kingdom]?.era ?? 0);
      // a realm's era sets the least era its older buildings show (lookEra)
      for (const k of civ.kingdoms) if (k.alive && (k.era ?? 0) >= 4) sig += 'k' + k.id + 'e' + k.era;
      if (sig !== this._powerSig) {
        this._powerSig = sig;
        this._ver = -1;
        this._flagsAll = true;
      }
    }
    const tw = performance.now(); // (the scans and the drawing share the frame's budget)
    if ((civ.version !== this._ver || civ.colorVersion !== this._cver) && (now - this._lastRebuild > 0.2 || this._full)) {
      this._ver = civ.version;
      this._cver = civ.colorVersion;
      this._lastRebuild = now;
      this._scan();
    }
    if ((civ.stateVersion !== this._sver && now - this._lastState > 0.12) || this._flagsAll) {
      this._sver = civ.stateVersion;
      this._lastState = now;
      this._statePass(!!this._flagsAll);
      this._flagsAll = false;
    }
    if (civ.fieldVersion !== this._fver && (now - this._lastFence > 1 || this._full)) {
      this._fver = civ.fieldVersion;
      this._lastFence = now;
      this._scanFences();
    }
    if (this._hRects.length || this._hAll) this._heightPass();
    // (frames far apart, as under software GL: each gets a larger share, up
    // to 16 ms, so the queue keeps up with the town)
    const gapR = Math.max(0, now - (this._workR ?? now));
    this._workR = now;
    const budget = Math.min(16, this.budgetMs + 20 * Math.max(0, gapR - 0.05));
    // (round 35) a jump in time used to draw the whole world in one frame
    // (half a second after a fast-forward to Year 200, as the camera came to
    // a town). Now the town before the camera is drawn at once, so the first
    // look shows it whole, and the rest nearest the camera first within the
    // frame's budget; the queue follows the camera when it moves on.
    this._order(this._full);
    if (this._full) this._focusTown();
    this._full = false;
    this._work(budget - (performance.now() - tw));
    this._applyLod();
    if (this._far && this._proxyDirty && now - this._proxyT > 1) this._rebuildProxies();
    // the camera's view this frame, widened by two tiles (for the props and
    // banners that are only written while in view)
    {
      const cam = g.cameraRig?.camera;
      this._vfOk = !!cam;
      if (cam) {
        cam.updateMatrixWorld();
        this._vpm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        this._vf.setFromProjectionMatrix(this._vpm);
        for (const pl of this._vf.planes) pl.constant += 2;
      }
    }
    this.glow.uniforms.uTime.value = this.t;
    this.glow.update(this.uniforms.uNight.value, !this._far);
    // (null over water: no haze puffs over the sea, lakes or rivers)
    this.plumes.update(this.t, env.wind, day, !this._far && (g.cameraRig?.cur?.dist ?? 60) < 175, g.cameraRig?.cur?.dist ?? 60);
    // (the low factory haze is a far-zoom touch, ~35-90 tiles, faded in
    // HazeLayer.update: closer it veiled the town, farther its soft discs lay
    // on the slopes as brown bruises)
    this.haze.update(dt, civ.haze?.(), (x, z) => (g.world.isWater(Math.floor(x), Math.floor(z)) ? null : Math.max(g.world.heightAt(x, z), SEA_LEVEL)), day, this.t, g.cameraRig?.cur?.dist ?? 60, (kid) => civ.kingdoms[kid]?.era ?? 0);
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
