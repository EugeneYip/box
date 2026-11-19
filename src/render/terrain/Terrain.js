import * as THREE from 'three';
import { TILE_INFO, SEA_LEVEL, MIN_HEIGHT } from '../../world/constants.js';
import { getNoiseTextures } from './noiseTextures.js';
import { patchTerrainMaterial } from './terrainShader.js';
import { landscapeUniforms, refreshLandscapeUniforms } from '../water/waterCommon.js';
import { bakeAO } from './bake.js';
import { geoWrapOn } from '../../world/geo.js';

// Terrain renderer (Landscape).
//
// Geometry: the map is split into CHUNK x CHUNK-tile chunks (32, or 64 on Large
// and Huge maps), each a grid with 2, 1 or 0.5 vertices per tile chosen per
// frame by projected size (LOD), skirted against cracks. Heights follow world.heightAt() so
// the rendered surface matches the CPU heightfield used by every other system;
// normals come from central differences of the same global function, so they
// are continuous across chunk seams. Edits only rebuild touched chunks.
// A skirt ring continues the seabed beyond the map edge into the deep ocean.
//
// Far away, whole blocks of chunks (256 x 256 tiles) that are all at the
// coarsest level are drawn as one mesh of the same lattice (no seam, no pop):
// the Vast overview draws its terrain in 8 calls instead of 128.
//
// Round world (docs/ROUND-WORLD.md): while a closer view runs past a side
// edge of the whole Earth, the chunks of the far side (up to two columns)
// are drawn again one map width over, so the land across the seam is in
// view; the shader reads the tiles they copy, and the water reads them in
// the same band.
//
// Shading: one shared MeshStandardMaterial patched with the procedural
// terrain shader (see terrainShader.js), fed by per-tile data textures.
//
// Public API (cross-team contract):
//   terrain.setOverlay(tex | null)   w x h RGBA DataTexture: rgb tint (sRGB bytes,
//                                    e.g. a kingdom's hex colour), a strength
//                                    (0 = none). Texels are read exactly
//                                    (texelFetch), so filtering does not matter.
//                                    Crisp glowing border lines are drawn where
//                                    neighbouring texels differ; set
//                                    tex.needsUpdate = true after edits.
//   terrain.heightTexture            float DataTexture (RedFormat, linear filter)
//                                    of world.height, one texel per tile, kept up
//                                    to date. Sample with uv = worldXZ / (w, h).
//   terrain.typeTexture              R8 DataTexture of world.type (nearest).
//   terrain.noiseTextures            { noise, cells } procedural tileable noise.
// Chunk level of detail: vertices per tile at each LOD. Distant chunks drop to
// 1 and then 0.5 vertices per tile; a short skirt around every chunk hides the
// T-junction cracks where neighbours use different LODs.
const LOD_RES = [2, 1, 0.5];
const SKIRT_DEPTH = 1.8;

export class Terrain {
  constructor(game) {
    this.game = game;
    const world = game.world;
    this.w = world.w;
    this.h = world.h;
    const W = this.w,
      H = this.h;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    game.scene.add(this.group);

    // ---- data textures
    const renderer = game.pipeline?.renderer;
    const floatLinear = renderer?.extensions?.has?.('OES_texture_float_linear') !== false;
    this.heightData = new Float32Array(W * H);
    this.heightTexture = new THREE.DataTexture(this.heightData, W, H, THREE.RedFormat, THREE.FloatType);
    this.heightTexture.magFilter = this.heightTexture.minFilter = floatLinear ? THREE.LinearFilter : THREE.NearestFilter;
    this.heightTexture.wrapS = this.heightTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.heightTexture.generateMipmaps = false;
    this.heightTexture.colorSpace = THREE.NoColorSpace;
    this.heightTexture.needsUpdate = true;

    this.typeData = new Uint8Array(W * H);
    this.typeTexture = new THREE.DataTexture(this.typeData, W, H, THREE.RedFormat, THREE.UnsignedByteType);
    this.typeTexture.magFilter = this.typeTexture.minFilter = THREE.NearestFilter;
    this.typeTexture.generateMipmaps = false;
    this.typeTexture.colorSpace = THREE.NoColorSpace;
    this.typeTexture.needsUpdate = true;

    // moisture, temperature, ambient occlusion, fire
    this.climData = new Uint8Array(W * H * 4);
    this.climTexture = new THREE.DataTexture(this.climData, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.climTexture.magFilter = this.climTexture.minFilter = THREE.LinearFilter;
    this.climTexture.wrapS = this.climTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.climTexture.generateMipmaps = false;
    this.climTexture.colorSpace = THREE.NoColorSpace;
    this.climTexture.needsUpdate = true;
    this.ao = new Float32Array(W * H).fill(1);

    // settlement: R = town (FloraSim.town: inner core / outer ring of every
    // village's build radius), G = cultivated fields around towns on low flat
    // grassland (World Map worlds). Linear filtering softens both outlines.
    this.settleData = new Uint8Array(W * H * 4);
    this.settleTexture = new THREE.DataTexture(this.settleData, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.settleTexture.magFilter = this.settleTexture.minFilter = THREE.LinearFilter;
    this.settleTexture.wrapS = this.settleTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.settleTexture.generateMipmaps = false;
    this.settleTexture.colorSpace = THREE.NoColorSpace;
    this.settleTexture.needsUpdate = true;
    this._settleDirty = true;
    this._settleT = 0;

    this.noiseTextures = getNoiseTextures();
    const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    blank.needsUpdate = true;
    this._blank = blank;

    // ---- material
    const shared = landscapeUniforms(game);
    shared.uHeightTex.value = this.heightTexture;
    const palette = [];
    for (let i = 0; i < 32; i++) {
      const info = TILE_INFO[i];
      palette.push(new THREE.Color(info ? info.color : 0x808080).convertSRGBToLinear());
    }
    this.uniforms = {
      ...shared,
      uTypeTex: { value: this.typeTexture },
      uClimTex: { value: this.climTexture },
      uNoise: { value: this.noiseTextures.noise },
      uCells: { value: this.noiseTextures.cells },
      uOverlay: { value: blank },
      uOverlayOn: { value: 0 },
      uOverlaySize: { value: new THREE.Vector2(1, 1) },
      // water shore field (distance to land, local water width); the Water
      // module points this at its own texture. Fallback: wide open water
      uShoreTex: { value: this._openShore() },
      uSettleTex: { value: this.settleTexture },
      uTilePalette: { value: palette },
      // 1 when the float height texture filters linearly (else the shader
      // interpolates its four texels itself)
      uHeightLin: { value: floatLinear ? 1 : 0 },
    };
    // make sure the cloud sampler always has a texture bound
    if (!shared.uCloudTex.value) shared.uCloudTex.value = blank;
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
    patchTerrainMaterial(this.material, this.uniforms);

    // ---- chunks (bigger chunks on big maps keep draw calls at Medium levels)
    this.CHUNK = Math.max(W, H) >= 384 ? 64 : 32;
    this.cw = Math.ceil(W / this.CHUNK);
    this.ch = Math.ceil(H / this.CHUNK);
    this.chunks = [];
    this._indexCache = new Map();
    this._hpad = null;
    for (let cy = 0; cy < this.ch; cy++)
      for (let cx = 0; cx < this.cw; cx++) this.chunks.push(this._makeChunk(cx, cy));
    this.blocks = this._makeBlocks();
    this.ghosts = []; // seam copies (pool)
    this._v3 = new THREE.Vector3();
    this.skirt = null;

    this._dirtyHeight = null;
    this._dirtyType = null;
    this._dirtyFire = null;
    this._aoPending = null;
    this._aoTimer = 0;
    this._fullRefresh();

    const ev = game.events;
    ev.on('world:height', (r) => (this._dirtyHeight = unionRect(this._dirtyHeight, r)));
    ev.on('world:type', (r) => (this._dirtyType = unionRect(this._dirtyType, r)));
    ev.on('world:fire', (r) => (this._dirtyFire = unionRect(this._dirtyFire, r)));
    ev.on('flora:town', () => (this._settleDirty = true));
  }

  // ------------------------------------------------------------ public API
  setOverlay(tex) {
    if (tex && tex.image) {
      this.uniforms.uOverlay.value = tex;
      this.uniforms.uOverlayOn.value = 1;
      // texels are read with texelFetch, so the texture's own filtering is irrelevant
      this.uniforms.uOverlaySize.value.set(tex.image.width || this.w, tex.image.height || this.h);
    } else {
      this.uniforms.uOverlay.value = this._blank;
      this.uniforms.uOverlayOn.value = 0;
    }
  }
  get overlay() {
    return this.uniforms.uOverlayOn.value ? this.uniforms.uOverlay.value : null;
  }

  reset() {
    this._fullRefresh();
  }

  update(dt) {
    const g = this.game;
    refreshLandscapeUniforms(g, dt);
    this._updateDetail();
    this._updateLods();
    this._updateSeam();
    if (this._dirtyHeight) {
      const r = this._dirtyHeight;
      this._dirtyHeight = null;
      this._applyHeight(r);
    }
    if (this._dirtyType) {
      const r = this._dirtyType;
      this._dirtyType = null;
      this._applyType(r);
    }
    if (this._dirtyFire) {
      const r = this._dirtyFire;
      this._dirtyFire = null;
      this._applyFire(r);
    }
    // towns and their fields: rebuilt when a town changes shape (at most
    // every 1.5 s; FloraSim refreshes the outlines every few game seconds)
    this._settleT -= dt;
    if (this._settleDirty && this._settleT <= 0) {
      this._settleDirty = false;
      this._settleT = 1.5;
      this._writeSettle();
    }
    // AO is a broader bake; throttle it while the player is sculpting
    if (this._aoPending) {
      this._aoTimer -= dt;
      if (this._aoTimer <= 0) {
        const r = this._aoPending;
        this._aoPending = null;
        this._bakeAORect(r);
      }
    }
  }

  inspect(hit) {
    if (!hit) return null;
    const world = this.game.world;
    const i = world.idx(hit.tx, hit.ty);
    const info = TILE_INFO[world.type[i]];
    const hgt = world.height[i];
    const water = hgt < SEA_LEVEL;
    return {
      priority: 0,
      title: water ? (hgt < SEA_LEVEL - 1.6 ? 'Deep Water' : 'Shallow Water') : info?.name || 'Land',
      subtitle: water ? `Seabed of ${info?.name?.toLowerCase() || 'sand'}` : 'Terrain',
      stats: [
        [water ? 'Depth' : 'Elevation', `${Math.abs(hgt).toFixed(1)} m`],
        ['Temperature', `${Math.round(world.temperature[i] * 100)}%`],
        ['Moisture', `${Math.round(world.moisture[i] * 100)}%`],
      ],
    };
  }

  // ------------------------------------------------------------ internals
  _fullRefresh() {
    const all = { x0: 0, y0: 0, x1: this.w - 1, y1: this.h - 1 };
    this._writeHeights(all);
    this._writeTypes(all);
    this._writeClimate(all);
    this.ao = bakeAO(this.game.world, null, this.ao);
    this._writeAO(all);
    for (const c of this.chunks) {
      c.dirty.fill(true);
      this._setLod(c, c.lod >= 0 ? c.lod : 1, true);
    }
    for (const b of this.blocks) {
      b.dirty = true;
      if (b.on) this._buildBlock(b);
    }
    this._buildSkirt();
    this._dirtyHeight = this._dirtyType = this._dirtyFire = this._aoPending = null;
    this._settleDirty = true;
  }

  _applyHeight(r) {
    this._writeHeights(r);
    // vertices within one tile of the rect depend on these heights
    const x0 = r.x0 - 2,
      y0 = r.y0 - 2,
      x1 = r.x1 + 2,
      y1 = r.y1 + 2;
    let touchesEdge = false;
    const CH = this.CHUNK;
    for (const c of this.chunks) {
      const cx0 = c.cx * CH,
        cy0 = c.cy * CH;
      if (cx0 > x1 || cy0 > y1 || cx0 + CH < x0 || cy0 + CH < y0) continue;
      c.dirty.fill(true);
      this._setLod(c, c.lod, true);
      if (c.block) c.block.dirty = true;
    }
    for (const b of this.blocks) if (b.on && b.dirty) this._buildBlock(b);
    if (x0 <= 1 || y0 <= 1 || x1 >= this.w - 2 || y1 >= this.h - 2) touchesEdge = true;
    if (touchesEdge) this._buildSkirt();
    const pad = 20;
    this._aoPending = unionRect(this._aoPending, { x0: r.x0 - pad, y0: r.y0 - pad, x1: r.x1 + pad, y1: r.y1 + pad });
    this._aoTimer = Math.max(this._aoTimer, 0.12);
  }
  _applyType(r) {
    this._writeTypes(r);
  }
  _applyFire(r) {
    const world = this.game.world;
    const d = this.climData;
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++) {
        const i = y * this.w + x;
        d[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(world.fire[i] * 255)));
      }
    this.climTexture.needsUpdate = true;
  }

  _writeHeights(r) {
    const src = this.game.world.height;
    for (let y = r.y0; y <= r.y1; y++) {
      const o = y * this.w;
      for (let x = r.x0; x <= r.x1; x++) this.heightData[o + x] = src[o + x];
    }
    this.heightTexture.needsUpdate = true;
  }
  _writeTypes(r) {
    const src = this.game.world.type;
    for (let y = r.y0; y <= r.y1; y++) {
      const o = y * this.w;
      for (let x = r.x0; x <= r.x1; x++) this.typeData[o + x] = src[o + x];
    }
    this.typeTexture.needsUpdate = true;
  }
  _writeClimate(r) {
    const world = this.game.world;
    const d = this.climData;
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++) {
        const i = y * this.w + x;
        d[i * 4] = clamp255(world.moisture[i] * 255);
        d[i * 4 + 1] = clamp255(world.temperature[i] * 255);
        d[i * 4 + 3] = clamp255(world.fire[i] * 255);
      }
    this.climTexture.needsUpdate = true;
  }
  _writeSettle() {
    const g = this.game,
      world = g.world;
    const W = this.w,
      H = this.h;
    const d = this.settleData;
    d.fill(0);
    const town = g.flora?.town;
    if (town) for (let i = 0; i < W * H; i++) if (town[i]) d[i * 4] = town[i] >= 2 ? 255 : 120;
    // fields: a mosaic of farmed plots on low, flat grassland around every
    // town of a World Map world, fading out a couple of build radii away
    // (square maps farm their own FARMLAND tiles)
    if (world.meta?.preset === 'earth') {
      const hgt = world.height,
        type = world.type;
      for (const v of g.civ?.villages || []) {
        if (!v || v.alive === false || !Number.isFinite(v.cx)) continue;
        const r0 = Math.max(4, v.buildRadius || 4);
        const r1 = r0 * 1.2 + 3,
          r2 = r0 * 2.6 + 8;
        const x0 = Math.max(1, Math.floor(v.cx - r2)),
          x1 = Math.min(W - 2, Math.ceil(v.cx + r2)),
          y0 = Math.max(1, Math.floor(v.cz - r2)),
          y1 = Math.min(H - 2, Math.ceil(v.cz + r2));
        for (let y = y0; y <= y1; y++)
          for (let x = x0; x <= x1; x++) {
            const i = y * W + x;
            const t = type[i];
            if (t !== 1 && t !== 4) continue; // grass, savanna
            const h = hgt[i];
            if (h < 0.02 || h > 1.5) continue;
            const sl = Math.max(Math.abs(hgt[i + 1] - hgt[i - 1]), Math.abs(hgt[i + W] - hgt[i - W])) * 0.5;
            if (sl > 0.3) continue;
            const dx = x + 0.5 - v.cx,
              dz = y + 0.5 - v.cz;
            const dd = Math.sqrt(dx * dx + dz * dz);
            if (dd > r2) continue;
            let k = dd < r1 ? 1 : 1 - (dd - r1) / (r2 - r1);
            k *= Math.min(1, (1.5 - h) / 0.5) * Math.min(1, (0.3 - sl) / 0.12);
            const val = Math.round(k * 255);
            if (val > d[i * 4 + 1]) d[i * 4 + 1] = val;
          }
      }
    }
    this.settleTexture.needsUpdate = true;
  }
  _writeAO(r) {
    const d = this.climData;
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++) {
        const i = y * this.w + x;
        d[i * 4 + 2] = clamp255(this.ao[i] * 255);
      }
    this.climTexture.needsUpdate = true;
  }
  _bakeAORect(r) {
    const rr = {
      x0: Math.max(0, r.x0),
      y0: Math.max(0, r.y0),
      x1: Math.min(this.w - 1, r.x1),
      y1: Math.min(this.h - 1, r.y1),
    };
    bakeAO(this.game.world, rr, this.ao);
    this._writeAO(rr);
  }

  _openShore() {
    const t = new THREE.DataTexture(new Uint8Array([255, 255, 0, 255]), 1, 1);
    t.needsUpdate = true;
    return t;
  }

  // Shader detail tier: fine noise layers, caustics and foam micro detail fade
  // out as the camera pulls back (game.view.zoom01), sooner in power-saver mode.
  _updateDetail() {
    const g = this.game;
    const z = g.view?.zoom01 ?? 0.3;
    const saver = !!g.settings?.powerSaver;
    const u = this.uniforms;
    u.uDetail.value = saver ? 1 - smooth01((z - 0.12) / 0.2) : 1 - smooth01((z - 0.5) / 0.3);
    u.uPower.value = saver ? 1 : 0;
  }

  // Pick a LOD per chunk from its projected tile size (pixels per world unit at
  // the chunk's nearest point), with hysteresis so chunks don't flicker.
  _updateLods() {
    const g = this.game;
    const cam = g.cameraRig?.camera;
    if (!cam) return;
    const vh = g.pipeline?.size?.y || (typeof innerHeight !== 'undefined' ? innerHeight : 720);
    const k = (vh * 0.5) / Math.tan((cam.fov * Math.PI) / 360);
    const bias = g.settings?.powerSaver ? 1.7 : 1.0;
    const cp = cam.position;
    // full density (2 vertices per tile) only where a tile spans >= 12 px;
    // denser meshes cost triangles without visible gain
    const T0 = 12.0 * bias,
      T1 = 4.0 * bias;
    // (Round world: a chunk is as near as its copy across the seam)
    const wrapW = geoWrapOn(g.world) ? this.w : 0;
    for (const c of this.chunks) {
      const b = c.box;
      let dx = Math.max(b.min.x - cp.x, 0, cp.x - b.max.x);
      if (wrapW && dx > 0) dx = Math.min(dx, Math.max(b.min.x + wrapW - cp.x, 0, cp.x - b.max.x - wrapW), Math.max(b.min.x - wrapW - cp.x, 0, cp.x - b.max.x + wrapW));
      const dy = Math.max(b.min.y - cp.y, 0, cp.y - b.max.y);
      const dz = Math.max(b.min.z - cp.z, 0, cp.z - b.max.z);
      const ppu = k / Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz));
      let want = c.lod;
      if (c.lod === 0) {
        if (ppu < T0 * 0.88) want = ppu > T1 ? 1 : 2;
      } else if (c.lod === 1) {
        if (ppu > T0 * 1.12) want = 0;
        else if (ppu < T1 * 0.88) want = 2;
      } else {
        if (ppu > T1 * 1.12) want = ppu > T0 ? 0 : 1;
      }
      if (want !== c.lod) this._setLod(c, want, false);
    }
    // a block whose chunks are all at the coarsest level draws as one mesh
    for (const b of this.blocks) {
      let on = true;
      for (const c of b.chunks) if (c.lod !== 2) on = false;
      if (on && b.dirty) this._buildBlock(b);
      if (on === b.on) continue;
      b.on = on;
      b.mesh.visible = on;
      for (const c of b.chunks) c.mesh.visible = !on;
    }
  }

  // Blocks of BLOCK x BLOCK full-size chunks (256 tiles a side) sharing the
  // coarsest lattice (0.5 vertices per tile), so one block mesh is exactly
  // its chunks' coarse meshes joined.
  _makeBlocks() {
    const CH = this.CHUNK,
      B = Math.max(2, Math.round(256 / CH));
    const out = [];
    for (let by = 0; by * B < this.ch; by++)
      for (let bx = 0; bx * B < this.cw; bx++) {
        const list = [];
        for (let cy = by * B; cy < Math.min(this.ch, (by + 1) * B); cy++)
          for (let cx = bx * B; cx < Math.min(this.cw, (bx + 1) * B); cx++) list.push(this.chunks[cy * this.cw + cx]);
        if (list.length < 2 || list.some((c) => c.tilesX !== CH || c.tilesY !== CH)) continue;
        const nCx = Math.min(this.cw, (bx + 1) * B) - bx * B,
          nCy = Math.min(this.ch, (by + 1) * B) - by * B;
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.visible = false;
        mesh.name = `terrain-block-${bx}-${by}`;
        this.group.add(mesh);
        const b = { cx: bx * B, cy: by * B, tilesX: nCx * CH, tilesY: nCy * CH, mesh, chunks: list, geo: null, dirty: true, on: false, box: new THREE.Box3() };
        for (const c of list) c.block = b;
        out.push(b);
      }
    return out;
  }
  _buildBlock(b) {
    if (!b.geo) {
      const res = LOD_RES[2];
      const nx = Math.round(b.tilesX * res),
        ny = Math.round(b.tilesY * res);
      const geo = new THREE.BufferGeometry();
      const count = (nx + 1) * (ny + 1) + 2 * (nx + ny);
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      geo.setIndex(this._indexFor(nx, ny));
      geo.boundingBox = new THREE.Box3();
      geo.boundingSphere = new THREE.Sphere();
      geo.userData = { nx, ny };
      b.geo = geo;
      b.mesh.geometry = geo;
    }
    this._buildChunk(b, b.geo);
    b.dirty = false;
  }

  // Round world: the visible ground's east-west extent (screen corners cast
  // onto sea level), and the far side's chunks (up to two columns of them)
  // drawn past whichever side edge it runs over, with the band they cover
  // told to the water.
  _updateSeam() {
    const g = this.game;
    const W = this.w;
    const band = this.uniforms.uWrapBand?.value;
    const want = [];
    let bl = 0,
      br = 0;
    const wrap = geoWrapOn(g.world);
    const cam = g.cameraRig?.camera;
    // (close views copy up to two columns of chunks; from farther out, whole
    // coarse blocks up to 256 tiles, so the overview shows the land running
    // on past both edges in a few calls instead of streaks or a cut edge)
    const near = (g.cameraRig?.cur?.dist ?? 1e9) < 0.35 * Math.max(W, this.h);
    if (wrap && cam) {
      const o = cam.position,
        v = this._v3;
      let x0 = Infinity,
        x1 = -Infinity;
      for (let k = 0; k < 6; k++) {
        v.set(k & 1 ? 1 : -1, k < 2 ? -1 : k < 4 ? 1 : 0.2, 0.5).unproject(cam).sub(o).normalize();
        const t = v.y < -0.02 ? Math.min(o.y / -v.y, W) : W;
        const x = o.x + v.x * t;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
      const CH = this.CHUNK,
        cap = near ? 2 * CH : Math.max(2 * CH, 256);
      const needR = x1 > W ? Math.min(cap, x1 - W + 2) : 0,
        needL = x0 < 0 ? Math.min(cap, 2 - x0) : 0;
      const seen = new Set();
      for (const c of this.chunks) {
        const u = !near && c.block && c.block.on ? c.block : c;
        if (seen.has(u)) continue;
        seen.add(u);
        const ux0 = u.cx * CH,
          ux1 = ux0 + u.tilesX;
        if (needR > 0 && ux0 < needR) want.push(u, W), (br = Math.max(br, ux1));
        if (needL > 0 && ux1 > W - needL) want.push(u, -W), (bl = Math.max(bl, W - ux0));
      }
    }
    // (the skirt's sides sink out of sight only while the copies cover them)
    const sink = want.length > 0;
    if (sink !== !!this._skirtSink) {
      this._skirtSink = sink;
      this._buildSkirt();
    }
    band?.set(wrap ? W : 0, bl, br);
    let n = 0;
    for (let k = 0; k < want.length; k += 2) {
      const u = want[k],
        dx = want[k + 1];
      let m = this.ghosts[n];
      if (!m) {
        m = new THREE.Mesh(u.mesh.geometry, this.material);
        m.matrixAutoUpdate = false;
        m.castShadow = false;
        m.receiveShadow = true;
        m.name = 'terrain-seam-copy';
        m.userData.dx = 0;
        this.group.add(m);
        this.ghosts.push(m);
      }
      m.geometry = u.mesh.geometry;
      if (m.userData.dx !== dx) {
        m.matrix.makeTranslation(dx, 0, 0);
        m.matrixWorldNeedsUpdate = true;
        m.userData.dx = dx;
      }
      m.visible = true;
      n++;
    }
    for (let k = n; k < this.ghosts.length; k++) this.ghosts[k].visible = false;
  }

  // Shared index buffer for an nx x ny grid plus its (double-sided) skirt.
  _indexFor(nx, ny) {
    const key = nx + 'x' + ny;
    let idx = this._indexCache.get(key);
    if (idx) return idx;
    const vx = nx + 1;
    const G = vx * (ny + 1);
    const P = 2 * (nx + ny);
    const arr = new (G + P > 65535 ? Uint32Array : Uint16Array)(nx * ny * 6 + P * 12);
    let k = 0;
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const a = j * vx + i,
          b = a + 1,
          c = a + vx,
          d = c + 1;
        if ((i + j) & 1) {
          arr[k++] = a;
          arr[k++] = c;
          arr[k++] = b;
          arr[k++] = b;
          arr[k++] = c;
          arr[k++] = d;
        } else {
          arr[k++] = a;
          arr[k++] = c;
          arr[k++] = d;
          arr[k++] = a;
          arr[k++] = d;
          arr[k++] = b;
        }
      }
    const per = perimeter(nx, ny);
    for (let q = 0; q < P; q++) {
      const t0 = per[q],
        t1 = per[(q + 1) % P];
      const b0 = G + q,
        b1 = G + ((q + 1) % P);
      // both windings: the skirt must hide cracks seen from either side
      arr[k++] = t0;
      arr[k++] = b0;
      arr[k++] = t1;
      arr[k++] = t1;
      arr[k++] = b0;
      arr[k++] = b1;
      arr[k++] = t0;
      arr[k++] = t1;
      arr[k++] = b0;
      arr[k++] = t1;
      arr[k++] = b1;
      arr[k++] = b0;
    }
    idx = new THREE.BufferAttribute(arr, 1);
    this._indexCache.set(key, idx);
    return idx;
  }

  _makeChunk(cx, cy) {
    const CH = this.CHUNK;
    const tilesX = Math.min(CH, this.w - cx * CH);
    const tilesY = Math.min(CH, this.h - cy * CH);
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.name = `terrain-chunk-${cx}-${cy}`;
    this.group.add(mesh);
    const box = new THREE.Box3(new THREE.Vector3(cx * CH, -10, cy * CH), new THREE.Vector3(cx * CH + tilesX, 25, cy * CH + tilesY));
    return { cx, cy, tilesX, tilesY, mesh, box, geos: [null, null, null], dirty: [true, true, true], lod: -1 };
  }

  // Make sure the chunk's geometry for `lod` exists and is up to date, then use it.
  _setLod(c, lod, force) {
    if (lod < 0) lod = 1;
    let geo = c.geos[lod];
    if (!geo) {
      const res = LOD_RES[lod];
      const nx = Math.max(1, Math.round(c.tilesX * res)),
        ny = Math.max(1, Math.round(c.tilesY * res));
      geo = new THREE.BufferGeometry();
      const count = (nx + 1) * (ny + 1) + 2 * (nx + ny);
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      geo.setIndex(this._indexFor(nx, ny));
      geo.boundingBox = new THREE.Box3();
      geo.boundingSphere = new THREE.Sphere();
      geo.userData = { nx, ny };
      c.geos[lod] = geo;
      c.dirty[lod] = true;
    }
    if (c.dirty[lod] || force) {
      this._buildChunk(c, geo);
      c.dirty[lod] = false;
    }
    c.mesh.geometry = geo;
    c.lod = lod;
  }

  // Vertex heights come from the same bilinear rule as world.heightAt(); a
  // padded grid (PAD vertices beyond the chunk) gives seam-free normals from
  // central differences averaged over one and two vertex spans.
  _buildChunk(c, geo) {
    const world = this.game.world;
    const hgt = world.height;
    const W = world.w,
      H = world.h;
    const { nx, ny } = geo.userData;
    const pos = geo.attributes.position.array;
    const nrm = geo.attributes.normal.array;
    const CH = this.CHUNK;
    const x0 = c.cx * CH,
      z0 = c.cy * CH;
    const sx = c.tilesX / nx,
      sz = c.tilesY / ny;
    const PAD = 2;
    const pw = nx + 1 + PAD * 2,
      ph = ny + 1 + PAD * 2;
    if (!this._hpad || this._hpad.length < pw * ph) this._hpad = new Float32Array(pw * ph);
    const hp = this._hpad;
    for (let j = 0; j < ph; j++) {
      const fz = z0 + (j - PAD) * sz - 0.5;
      const zi = Math.floor(fz),
        tz = fz - zi;
      const za = zi < 0 ? 0 : zi >= H ? H - 1 : zi,
        zb = zi + 1 < 0 ? 0 : zi + 1 >= H ? H - 1 : zi + 1;
      for (let i = 0; i < pw; i++) {
        const fx = x0 + (i - PAD) * sx - 0.5;
        const xi = Math.floor(fx),
          tx = fx - xi;
        const xa = xi < 0 ? 0 : xi >= W ? W - 1 : xi,
          xb = xi + 1 < 0 ? 0 : xi + 1 >= W ? W - 1 : xi + 1;
        const h00 = hgt[za * W + xa],
          h10 = hgt[za * W + xb],
          h01 = hgt[zb * W + xa],
          h11 = hgt[zb * W + xb];
        hp[j * pw + i] = (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
      }
    }
    let ymin = Infinity,
      ymax = -Infinity;
    let k = 0;
    for (let j = 0; j <= ny; j++) {
      const z = z0 + j * sz;
      const row = (j + PAD) * pw + PAD;
      for (let i = 0; i <= nx; i++) {
        const o = row + i;
        const y = hp[o];
        pos[k] = x0 + i * sx;
        pos[k + 1] = y;
        pos[k + 2] = z;
        const gx = ((hp[o + 1] - hp[o - 1]) / (2 * sx) + (hp[o + 2] - hp[o - 2]) / (4 * sx)) * 0.5;
        const gz = ((hp[o + pw] - hp[o - pw]) / (2 * sz) + (hp[o + 2 * pw] - hp[o - 2 * pw]) / (4 * sz)) * 0.5;
        const inv = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
        nrm[k] = -gx * inv;
        nrm[k + 1] = inv;
        nrm[k + 2] = -gz * inv;
        if (y < ymin) ymin = y;
        if (y > ymax) ymax = y;
        k += 3;
      }
    }
    // skirt: perimeter vertices pushed straight down, same normals
    const per = perimeter(nx, ny);
    const G = (nx + 1) * (ny + 1);
    for (let q = 0; q < per.length; q++) {
      const s3 = per[q] * 3,
        d3 = (G + q) * 3;
      pos[d3] = pos[s3];
      pos[d3 + 1] = pos[s3 + 1] - SKIRT_DEPTH;
      pos[d3 + 2] = pos[s3 + 2];
      nrm[d3] = nrm[s3];
      nrm[d3 + 1] = nrm[s3 + 1];
      nrm[d3 + 2] = nrm[s3 + 2];
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    geo.boundingBox.min.set(x0, ymin - SKIRT_DEPTH, z0);
    geo.boundingBox.max.set(x0 + c.tilesX, ymax, z0 + c.tilesY);
    geo.boundingBox.getBoundingSphere(geo.boundingSphere);
    c.box.copy(geo.boundingBox);
  }

  // Seabed skirt from the map edge out into the deep ocean (hidden by water,
  // but it keeps the shallow-to-deep gradient continuous past the edge).
  _buildSkirt() {
    const world = this.game.world;
    const W = this.w,
      H = this.h;
    const RES = 1; // under deep water: one vertex per tile edge is plenty
    const perSide = [W * RES, H * RES, W * RES, H * RES];
    const ringN = perSide[0] + perSide[1] + perSide[2] + perSide[3];
    const ringScale = Math.max(1, Math.max(W, H) / 256);
    const rings = [0, 1.5, 4, 9, 18, 34, 60, 100].map((r) => r * ringScale);
    const deep = MIN_HEIGHT - 6;
    const seam = !!this._skirtSink;
    const count = ringN * rings.length;
    let geo = this.skirt?.geometry;
    if (!geo) {
      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      const idx = new Uint32Array(ringN * (rings.length - 1) * 6);
      let k = 0;
      for (let r = 0; r < rings.length - 1; r++)
        for (let i = 0; i < ringN; i++) {
          const a = r * ringN + i,
            b = r * ringN + ((i + 1) % ringN),
            c = a + ringN,
            d = b + ringN;
          idx[k++] = a;
          idx[k++] = b;
          idx[k++] = c;
          idx[k++] = b;
          idx[k++] = d;
          idx[k++] = c;
        }
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.name = 'terrain-skirt';
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      this.skirt = mesh;
    }
    const pos = geo.attributes.position.array;
    // perimeter points (counter-clockwise when viewed from above: +x, +z, -x, -z)
    const edge = new Float32Array(ringN * 2);
    const outward = new Float32Array(ringN * 2);
    let k = 0;
    for (let i = 0; i < perSide[0]; i++, k++) {
      edge[k * 2] = i / RES;
      edge[k * 2 + 1] = 0;
      outward[k * 2] = 0;
      outward[k * 2 + 1] = -1;
    }
    for (let i = 0; i < perSide[1]; i++, k++) {
      edge[k * 2] = W;
      edge[k * 2 + 1] = i / RES;
      outward[k * 2] = 1;
      outward[k * 2 + 1] = 0;
    }
    for (let i = 0; i < perSide[2]; i++, k++) {
      edge[k * 2] = W - i / RES;
      edge[k * 2 + 1] = H;
      outward[k * 2] = 0;
      outward[k * 2 + 1] = 1;
    }
    for (let i = 0; i < perSide[3]; i++, k++) {
      edge[k * 2] = 0;
      edge[k * 2 + 1] = H - i / RES;
      outward[k * 2] = -1;
      outward[k * 2 + 1] = 0;
    }
    for (let r = 0; r < rings.length; r++) {
      const d = rings[r];
      for (let i = 0; i < ringN; i++) {
        const ex = edge[i * 2],
          ez = edge[i * 2 + 1];
        // corners: push diagonally so rings stay square
        let ox = outward[i * 2],
          oz = outward[i * 2 + 1];
        if ((ex === 0 || ex === W) && (ez === 0 || ez === H)) {
          ox = ex === 0 ? -1 : 1;
          oz = ez === 0 ? -1 : 1;
        }
        const h0 = world.heightAt(ex, ez);
        const t = Math.min(1, d / (70 * ringScale));
        const s = t * t * (3 - 2 * t);
        // (Round world: past the side edges the far side's chunks are drawn,
        // so the skirt there drops straight out of sight beneath them)
        const y = seam && (ex === 0 || ex === W) ? deep - 40 : h0 + (deep - h0) * s;
        const o = (r * ringN + i) * 3;
        pos[o] = ex + ox * d;
        pos[o + 1] = r === 0 ? h0 : y;
        pos[o + 2] = ez + oz * d;
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  }
}

function smooth01(t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}
// Grid indices around the border of an nx x ny vertex grid, in order.
const _perCache = new Map();
function perimeter(nx, ny) {
  const key = nx + 'x' + ny;
  let p = _perCache.get(key);
  if (p) return p;
  const vx = nx + 1;
  p = [];
  for (let i = 0; i < nx; i++) p.push(i);
  for (let j = 0; j < ny; j++) p.push(j * vx + nx);
  for (let i = nx; i > 0; i--) p.push(ny * vx + i);
  for (let j = ny; j > 0; j--) p.push(j * vx);
  _perCache.set(key, p);
  return p;
}
function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}
function unionRect(a, b) {
  if (!b) return a;
  if (!a) return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}
