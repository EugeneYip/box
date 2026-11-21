import * as THREE from 'three';
import { craneGeometry } from './archetypes.js';
import { buildArchetype, foundation, scaffold, ruin, wallPost, wallArm, lampPost, streetLamp, bastionGeometry, frameFor, materialPile, proxyGeometry, PAL, WALL_H } from './archetypes.js';
import { Labels } from './labels.js';
import { createBuildingMaterial, createPropMaterial } from './material.js';
import { emblemAtlas, EMBLEM_IDS, FIELD_IDS } from './emblems.js';
import { bannerGeometry, bannerMaterial, bladesGeometry, boatGeometry, FENCE, scarecrowGeometry, glowTexture, PuffSystem } from './props.js';
import { TerritoryOverlay } from './TerritoryOverlay.js';
import { InfraRenderer } from './InfraRenderer.js';
import { GlowSprites, HazeLayer, StackPlumes } from './nightAndHaze.js';
import { BUILDING_TYPES } from '../../sim/civ/catalog.js';
import { CULTURES, baseCulture } from '../../sim/civ/cultures.js';
import { SEA_LEVEL, TILE } from '../../world/constants.js';
import { hash2 } from '../../core/Random.js';
import { BUILDING, PROP, UNIT, FOOTPRINT, VEHICLE } from '../../core/scale.js';

// Models are drawn at their design size (archetypes.js: a cottage for a 2 x 2
// plot) and brought to the world by BUILDING.scale in each instance matrix,
// so shader detail (thatch rows, window grids, construction clip) keeps its
// proportions. Design footprints (def.dw x def.dh) size frames, footings,
// ruins and proxies under the same matrix; def.w x def.h are tiles.
const BS = BUILDING.scale;
const PS = PROP.scale;
// walls run tile to tile: their arms keep their length, the rest shrinks
const _wallS = new THREE.Vector3(1, BS, BS);
const _bS = new THREE.Vector3(BS, BS, BS);
const _bridgeS = new THREE.Vector3(1, BS, 1);

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
  // list: {key, geo, m (Float32Array/Array of 16 at offset o), o, col: [r,g,b], item, extra}
  set(L) {
    const n = L.length;
    this._ensure(Math.max(n, 1), this.vUsed);
    // geometry ids first (may grow the vertex store)
    const gids = new Int32Array(n);
    for (let i = 0; i < n; i++) gids[i] = this.geometryId(L[i].key, L[i].geo);
    const m = this.mesh;
    while (this.nInst < n) m.addInstance(gids[this.nInst++]);
    const mats = m._matricesTexture.image.data;
    for (let i = 0; i < n; i++) {
      const e = L[i];
      if (m.getGeometryIdAt(i) !== gids[i]) m.setGeometryIdAt(i, gids[i]);
      if (!m.getVisibleAt(i)) m.setVisibleAt(i, true);
      for (let q = 0; q < 16; q++) mats[i * 16 + q] = e.m[e.o + q];
      this.data[i * 8] = e.col[0];
      this.data[i * 8 + 1] = e.col[1];
      this.data[i * 8 + 2] = e.col[2];
    }
    for (let i = n; i < this.nInst; i++) if (m.getVisibleAt(i)) m.setVisibleAt(i, false);
    m._matricesTexture.needsUpdate = true;
    this.items = L.map((e) => e.item);
    this.extra = L.map((e) => e.extra);
    this.keys = L.map((e) => e.key);
    this.minor = L.map((e) => !!e.minor);
    this.n = n;
    m.visible = n > 0;
  }
  // past mid zoom houses and small buildings are hidden (landmarks stay)
  hideMinor(hide) {
    if (!this.mesh || !this.minor) return;
    for (let i = 0; i < this.n; i++) if (this.minor[i] && this.mesh.getVisibleAt(i) === hide) this.mesh.setVisibleAt(i, !hide);
  }
  // per-instance visibility for one archetype key (lampposts beyond prop range)
  showKey(key, on) {
    if (!this.mesh) return;
    for (let i = 0; i < this.n; i++) if (this.keys[i] === key && this.mesh.getVisibleAt(i) !== on) this.mesh.setVisibleAt(i, on);
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
}

export class BuildingRenderer {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'civ-buildings';
    game.scene.add(this.group);
    this.uniforms = { uTime: { value: 0 }, uNight: { value: 0 }, uSnow: { value: 0 }, uWind: { value: 0.35 }, uEmblems: { value: emblemAtlas() } };
    this.mat = createBuildingMaterial(this.uniforms); // far-zoom proxies
    this.propMat = createPropMaterial();
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
  }

  reset() {
    this._ver = -1;
    this._fver = -1;
    this.infra?.reset();
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
    this.fenceBatch = new PropBatch(this.group, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 }), { shadow: true, name: 'fences' });
    this.postGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.railGeo = new THREE.BoxGeometry(1, 1, 1);
    // tall staffs for capital standards and army standard-bearers
    this.staffGeo = new THREE.CylinderGeometry(0.03, 0.04, 1, 6).translate(0, 0.5, 0);
    this.staffMesh = this._inst(this.staffGeo, new THREE.MeshStandardMaterial({ color: 0x5a3c24, roughness: 0.8 }), 16, true, 'staffs');
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
  _stage(b) {
    if (!b.alive) return 'ruin';
    if (b.constructing) return b.progress < 0.12 ? 'found' : b.progress < 0.4 ? 'frame' : 'build';
    return b.upgrading ? 'upg' : 'done';
  }

  _rebuild() {
    const g = this.game;
    const civ = g.civ;
    const world = g.world;
    const lists = new Map(this.details.map((d) => [d, []]));
    _towerCiv = civ;
    const push = (key, clip, m, color, b, extra = null) => {
      const d = this._detailFor(key, clip);
      lists.get(d).push({ key, geo: this._arch(key).geo, m: m.elements.slice(), o: 0, col: [color.r, color.g, color.b], item: b, extra, minor: b ? isMinor(b) : true });
    };
    const footings = [];
    this.chimneys.length = 0;
    this.lights = []; // x, y, z, size of each glow sprite (street lights, floodlights)
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
      const M = this._m.makeRotationY(b.rotation || 0).scale(b.type === 'bridge' ? _bridgeS : _bS).setPosition(b.x, b.y, b.z);
      const dw = def.dw ?? def.w,
        dh = def.dh ?? def.h;
      if (stage === 'ruin') {
        if (def.wall) continue;
        push(`ruin|${b.style}|${dw}|${dh}|1`, false, M, col, b);
        continue;
      }
      if (def.wall) {
        const clip = b.constructing;
        if (b.type === 'wall') push(`wpost|${b.style}`, clip, this._m2.makeScale(BS, BS, BS).setPosition(b.x, b.y, b.z), col, b, { wall: true });
        else {
          const a = this._arch(`${b.type}|${b.style}|1`);
          push(`${b.type}|${b.style}|1`, clip, M, col, b, { maxY: a.maxY });
          if (!clip) this._collectAnchors(b, a, M, col, decals);
          // Gunpowder: a star-shaped bastion round the tower's foot
          if (b.type === 'tower' && b.bastion) push(`bastion|${b.style}`, clip, this._m2.makeRotationY(0).scale(_bS).setPosition(b.x, b.y, b.z), col, b, { maxY: 0.8 });
        }
        // arms toward connected neighbours
        for (const [dx, dy] of DIRS8) {
          const nb = wallAt.get((b.ty + dy) * world.w + b.tx + dx);
          if (!nb || nb.village !== b.village) continue;
          if (dx && dy && (wallAt.has(b.ty * world.w + b.tx + dx) || wallAt.has((b.ty + dy) * world.w + b.tx))) continue;
          const yaw = Math.atan2(-dy, dx);
          const am = this._m2.makeRotationY(yaw).scale(_wallS).setPosition(b.x, b.y, b.z);
          if (dx && dy) am.multiply(this._m3.makeScale(Math.SQRT2, 1, 1));
          push(`warm|${b.style}`, clip, am, col, b, { wall: true });
        }
        continue;
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
        if (stage === 'found') push(`found|${dw}|${dh}`, false, M, col, b);
        else push(`frame|${dw}|${dh}|${Math.min(3, Math.max(1, Math.round(a.maxY * 2) / 2))}`, false, M, col, b);
        if (stage === 'build') push(akey, true, M, col, b, { maxY: a.maxY });
        const pm = this._m2.copy(M).multiply(new THREE.Matrix4().makeTranslation(dw / 2 - 0.35, 0, dh / 2 - 0.3));
        push(`pile`, false, pm, col, b);
        // Engineering: a tower crane over the larger sites
        if (stage !== 'found' && dw * dh >= 4 && civ.hasTech?.(b.kingdom, 'engineering')) {
          const cm = new THREE.Matrix4().copy(M).multiply(new THREE.Matrix4().makeTranslation(-dw / 2 + 0.25, 0, -dh / 2 + 0.25));
          push('crane', false, cm, col, null);
          civ._firstUse?.(civ.kingdoms[b.kingdom], 'crane', { x: b.x, z: b.z });
        }
      } else {
        push(akey, false, M, col, b);
        if (stage === 'upg') push(`scaf|${dw}|${dh}|${Math.min(3, Math.round(a.maxY * 2) / 2)}`, false, M, col, b);
        this._collectAnchors(b, a, M, col, decals);
        // heritage in a modern realm: floodlights at the front corners
        if (b.heritage && (civ.kingdoms[b.kingdom]?.era ?? 0) >= 5) {
          for (const sx of [-1, 1]) {
            const p = this._p.set(sx * dw * 0.42, 0, dh * 0.5).applyMatrix4(M);
            const gy = world.heightAt(p.x, p.z);
            decals.push([p.x, gy, p.z, 0.55 * BS]);
            this.lights.push(p.x, gy + 0.08, p.z, 0.45);
          }
        }
      }
      if (a.base && !a.stilts && stage !== 'found') {
        const bus = ups ? ups[0] : 1;
        const bx = (a.base.x || 0) * bus,
          bz = (a.base.z || 0) * bus;
        const top = b.y + 0.04;
        const bottom = Math.min(b.groundMin ?? b.y, b.y) - 0.35;
        const fm = new THREE.Matrix4().makeRotationY(b.rotation || 0);
        fm.setPosition(b.x, top, b.z);
        fm.multiply(new THREE.Matrix4().makeTranslation(bx * BS, 0, bz * BS));
        fm.multiply(new THREE.Matrix4().makeScale((a.base.w + 0.04) * BS * bus, top - bottom, (a.base.d + 0.04) * BS * bus));
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
      const side = 1.75 * BS;
      const x = h.x + Math.cos(r) * side + Math.sin(r) * 1.2 * BS,
        z = h.z - Math.sin(r) * side + Math.cos(r) * 1.2 * BS;
      const gy = world.heightAt(x, z);
      this.staffs.push([x, gy, z, 2.5 * BS]);
      this.banners.push({ x: x + 0.03 * BS, y: gy + 2.45 * BS, z, s: 1.45 * BS, style: h.style, color: civ.kingdomColor(k.id), k: k.id });
    }
    // lampposts along town streets
    for (const v of civ.villages) {
      // a town, or a busy village of a realm with electricity (its powered street)
      if (!v.alive) continue;
      if (v.tier < 1 && !(v.pop >= 20 && (v.powered || civ.hasTech?.(v.kingdom, 'electricity')))) continue;
      col.setHex(civ.kingdomColor(v.kingdom));
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
        const lm = this._m2.makeRotationY(Math.atan2(-oz, ox) + Math.PI).scale(this._s.set(PS, PS, PS)).setPosition(x, world.heightAt(x, z), z);
        const gy = world.heightAt(x, z);
        if (lit) {
          push('streetlamp', false, lm, col, null);
          decals.push([x - ox * 0.75, gy, z - oz * 0.75, 0.75 * PS]);
          this.lights.push(x - ox * 0.75 * PS, gy + 1.08 * PS, z - oz * 0.75 * PS, 0.9);
        } else {
          push('lamppost', false, lm, col, null);
          decals.push([x - ox * 0.4, gy, z - oz * 0.4, 0.6 * PS]);
        }
      }
    }
    // write the building models: one batched draw per DetailBatch
    for (const [d, L] of lists) {
      d.set(L);
      this._writeStates(d);
    }
    this._lampsOn = null; // re-apply the lamppost range
    // far-zoom proxies
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
    this.glow.set(this.lights);
    // smoke plumes over the stacks of working industry, steam over cooling towers
    const pl = [];
    for (const c of this.chimneys) {
      if (!(c.stack || c.steam) || !c.b.alive || c.b.constructing) continue;
      const t = c.b.type;
      const soot = t === 'foundry' || t === 'bloomery' || t === 'kiln';
      pl.push({ x: c.x, y: c.y, z: c.z, s: c.steam ? 1.15 : soot ? 0.8 : t === 'powerstation' ? 1.05 : 0.95, tone: c.steam ? 2 : soot ? 0.85 : 0.2 });
    }
    this.plumes.set(pl);
  }

  _collectAnchors(b, a, M, col, decals) {
    const an = a.anchors;
    if (!an) return;
    const world = this.game.world;
    const p = this._p;
    for (const c of an.chimneys) {
      p.set(c.x, c.y, c.z).applyMatrix4(M);
      const stack = !c.steam && INDUSTRY.has(b.type);
      this.chimneys.push({ x: p.x, y: p.y, z: p.z, rate: c.rate || 1, forge: !!c.forge, steam: !!c.steam, stack, b, t: Math.random() * 3 });
    }
    for (const c of an.banners) {
      p.set(c.x, c.y, c.z).applyMatrix4(M);
      this.banners.push({ x: p.x, y: p.y, z: p.z, s: (c.s || 1) * BS, style: b.style, color: col.getHex(), k: b.kingdom });
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
      this.boats.push({ x: p.x, z: p.z, ry: (b.rotation || 0) + (c.ry || 0), style: c.ship ? (b.style === 'frost' || b.style === 'vale' ? 'frost' : 'dune') : b.style, phase: b.seed * 20 + this.boats.length, s: (c.ship ? 1.75 : 1) * VEHICLE.sea }); // (boats are craft: half size since round 24)
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
      decals.push([p.x, world.heightAt(p.x, p.z), p.z, Math.min(0.75, (c.r || 1) * 0.5) * BS]);
    }
  }

  // Per-instance state: damage, burning, seed and the clip height of a
  // building rising in its scaffolding. A DetailBatch keeps it in its
  // instance texture (texel 1 of 2), a proxy Batch in its iState attribute.
  _writeStates(batch) {
    const det = batch instanceof DetailBatch;
    const arr = det ? batch.data : batch.iState.array;
    const stride = det ? 8 : 4,
      off = det ? 4 : 0;
    const items = batch.items;
    let burning = false;
    for (let i = 0; i < items.length; i++) {
      const b = items[i];
      const k = i * stride + off;
      if (!b) {
        if (det) arr[i * 8 + 3] = 0;
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
      if (det) arr[i * 8 + 3] = this._flags(b);
      if (b.burning > 0.02) burning = true;
    }
    if (det) {
      if (batch.inst.value) batch.inst.value.needsUpdate = true;
    } else batch.iState.needsUpdate = true;
    return burning;
  }

  // instance flags for the shader: 1 lit by electricity (a powered town),
  // 2 a floodlit heritage building (its realm in the Modern era or later)
  _flags(b) {
    const civ = this.game.civ;
    let f = civ.villages[b.village]?.powered ? 1 : 0;
    if (b.heritage && (civ.kingdoms[b.kingdom]?.era ?? 0) >= 5) f += 2;
    return f;
  }

  _updateStates() {
    const civ = this.game.civ;
    // stage changes need a structural rebuild
    for (const b of civ.buildings) if (!b.gone && b._stage && b._stage !== this._stage(b)) return this._rebuild();
    for (const d of this.details) if (d.n) this._writeStates(d);
  }

  // ------------------------------------------------------------------ fences & fields
  _rebuildFences() {
    const g = this.game;
    const civ = g.civ;
    const world = g.world;
    const per = new Map();
    const scare = new Map();
    for (const st of Object.keys(FENCE)) per.set(st, { posts: [], rails: [] });
    for (const st of this.scareGeo.keys()) scare.set(st, []);
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
          for (const ry of F.wall ? [F.rail[1] * 0.5] : F.rails) P.rails.push([ax, ay + ry * PS, az, bx, by + ry * PS, bz]);
        }
        if (st !== 'dune' && p.tiles.length >= Math.round(12 * Math.max(0.5, FOOTPRINT.scale ** 2))) {
          const ci = Math.floor(cz) * world.w + Math.floor(cx);
          if (world.type[ci] === TILE.FARMLAND) scare.get(st)?.push([cx + 0.1, world.heightAt(cx, cz), cz, hash2(p.x0, p.y0, 5) * 6]);
        }
      }
    }
    const dir = new THREE.Vector3();
    const X = new THREE.Vector3(1, 0, 0);
    const fb = this.fenceBatch;
    fb.begin();
    for (const [st, P] of per) {
      const F = FENCE[st];
      const base = new THREE.Color(F.color);
      if (!F.wall)
        for (let i = 0; i < P.posts.length; i++) {
          const [x, y, z] = P.posts[i];
          const s = F.post;
          this._m.compose(this._p.set(x, y - 0.06, z), q.setFromAxisAngle(this._up, hash2(Math.round(x * 7), Math.round(z * 7), 3) * 0.4), this._s.set(s[0] * PS, s[1] * PS + 0.06, s[2] * PS));
          this._c.copy(base).multiplyScalar(0.85 + hash2(i, 7, 1) * 0.3);
          fb.push('post', this.postGeo, this._m, this._c);
        }
      for (let i = 0; i < P.rails.length; i++) {
        const [ax, ay, az, bx, by, bz] = P.rails[i];
        dir.set(bx - ax, by - ay, bz - az);
        const len = dir.length();
        dir.normalize();
        q.setFromUnitVectors(X, dir);
        const th = F.rail;
        this._m.compose(this._p.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), q, this._s.set(len + (F.wall ? th[0] * 0.5 * PS : 0.02), th[1] * PS, th[0] * PS));
        this._c.copy(base).multiplyScalar(0.8 + hash2(i, 9, 2) * 0.35);
        fb.push('rail', this.railGeo, this._m, this._c);
      }
    }
    fb.end();
    this._fenceN = fb.k;
    if (fb.mesh) fb.mesh.visible = !!this._props && this._fencesOn !== false && fb.k > 0; // (shown as a whole with the props)
    // scarecrows join the sails and boats (written every frame)
    const sl = (this._scareList = []);
    for (const [st, list] of scare)
      for (let i = 0; i < list.length; i++) {
        const [x, y, z, r] = list[i];
        // (a person-height prop: the people's factor, PROP.kit, round 25)
        sl.push(st, new THREE.Matrix4().compose(this._p.set(x, y, z), q.setFromAxisAngle(this._up, r), this._s.set(PROP.kit, PROP.kit, PROP.kit)));
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
    for (const [st, L] of per) {
      const geo = this.bladeGeo.get(st);
      if (!geo) continue;
      for (let i = 0; i < L.length; i++) {
        this._m.copy(L[i].m).multiply(this._m2.makeRotationZ(spin + L[i].phase));
        pb.push('blades|' + st, geo, this._m, null, showBlades);
      }
    }
    for (const b of this.boats) {
      const geo = this.boatGeo.get(b.style);
      if (!geo) continue;
      const t = this.t + b.phase;
      const bob = Math.sin(t * 1.6) * 0.025;
      this._q.setFromEuler(this._eu.set(Math.sin(t * 1.3) * 0.05, b.ry + Math.PI / 2 + Math.sin(t * 0.3) * 0.08, Math.sin(t * 1.1 + 1) * 0.04));
      this._m.compose(this._p.set(b.x + Math.sin(t * 0.25) * 0.08, SEA_LEVEL - 0.03 + bob, b.z), this._q, this._s.set(b.s || 1, b.s || 1, b.s || 1));
      pb.push('boat|' + b.style, geo, this._m, null, showBoats);
    }
    const sl = this._scareList;
    for (let i = 0; i < sl.length; i += 2) pb.push('scare|' + sl[i], this.scareGeo.get(sl[i]), sl[i + 1], null, showScare);
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
    for (const d of this.details) if (d.mesh) d.mesh.visible = !far && d.n > 0;
    if (this.dSmall.mesh) this.dSmall.mesh.visible = !far && !mid && this.dSmall.n > 0;
    if (force || midChanged) {
      this.dSolid.hideMinor(mid);
      this.dClip.hideMinor(mid);
      this._lampsOn = null;
    }
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
    // which towns have power: street lights and electric windows follow it
    this._powT = (this._powT || 0) - dt;
    if (this._powT <= 0) {
      this._powT = 1;
      let sig = '';
      for (const v of civ.villages) if (v.alive && v.powered) sig += v.id + ',';
      for (const b of civ.buildings) if (b.heritage && !b.gone) sig += 'h' + b.id + (civ.kingdoms[b.kingdom]?.era ?? 0);
      // a realm's era sets the least era its older buildings show (lookEra)
      for (const k of civ.kingdoms) if (k.alive && (k.era ?? 0) >= 4) sig += 'k' + k.id + 'e' + k.era;
      if (sig !== this._powerSig) {
        this._powerSig = sig;
        this._ver = -1;
      }
    }
    this._applyLod();
    this.glow.uniforms.uTime.value = this.t;
    this.glow.update(this.uniforms.uNight.value, !this._far);
    // (null over water: no haze puffs over the sea, lakes or rivers)
    this.plumes.update(this.t, env.wind, day, !this._far && (g.cameraRig?.cur?.dist ?? 60) < 175, g.cameraRig?.cur?.dist ?? 60);
    this.haze.update(dt, civ.haze?.(), (x, z) => (g.world.isWater(Math.floor(x), Math.floor(z)) ? null : Math.max(g.world.heightAt(x, z), SEA_LEVEL)), day, this.t);
    // (the low factory haze is a mid-zoom touch: seen from far above its
    // soft discs lay on the slopes as brown bruises)
    if ((g.cameraRig?.cur?.dist ?? 60) > 85) this.haze.mesh.visible = false;
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
