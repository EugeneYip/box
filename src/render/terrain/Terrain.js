import * as THREE from 'three';
import { TILE_INFO, SEA_LEVEL, MIN_HEIGHT } from '../../world/constants.js';
import { getNoiseTextures } from './noiseTextures.js';
import { patchTerrainMaterial } from './terrainShader.js';
import { landscapeUniforms, refreshLandscapeUniforms } from '../water/waterCommon.js';
import { bakeAO } from './bake.js';

// Terrain renderer (Landscape).
//
// Geometry: the map is split into CHUNK x CHUNK-tile chunks, each a grid with
// RES vertices per tile. Vertex heights are sampled from world.heightAt() so
// the rendered surface matches the CPU heightfield used by every other system;
// normals come from central differences of the same global function, so they
// are continuous across chunk seams. Edits only rebuild touched chunks.
// A skirt ring continues the seabed beyond the map edge into the deep ocean.
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
const CHUNK = 32;
const RES = 2; // vertices per tile (per axis)

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
      uTilePalette: { value: palette },
    };
    // make sure the cloud sampler always has a texture bound
    if (!shared.uCloudTex.value) shared.uCloudTex.value = blank;
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
    patchTerrainMaterial(this.material, this.uniforms);

    // ---- chunks
    this.cw = Math.ceil(W / CHUNK);
    this.ch = Math.ceil(H / CHUNK);
    this.chunks = [];
    this._indexCache = new Map();
    this._hpad = null;
    for (let cy = 0; cy < this.ch; cy++)
      for (let cx = 0; cx < this.cw; cx++) this.chunks.push(this._makeChunk(cx, cy));
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
    for (const c of this.chunks) this._buildChunk(c);
    this._buildSkirt();
    this._dirtyHeight = this._dirtyType = this._dirtyFire = this._aoPending = null;
  }

  _applyHeight(r) {
    this._writeHeights(r);
    // vertices within one tile of the rect depend on these heights
    const x0 = r.x0 - 2,
      y0 = r.y0 - 2,
      x1 = r.x1 + 2,
      y1 = r.y1 + 2;
    let touchesEdge = false;
    for (const c of this.chunks) {
      const cx0 = c.cx * CHUNK,
        cy0 = c.cy * CHUNK;
      if (cx0 > x1 || cy0 > y1 || cx0 + CHUNK < x0 || cy0 + CHUNK < y0) continue;
      this._buildChunk(c);
    }
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

  _indexFor(n) {
    let idx = this._indexCache?.get(n);
    if (idx) return idx;
    const verts = n + 1;
    const arr = new (verts * verts > 65535 ? Uint32Array : Uint16Array)(n * n * 6);
    let k = 0;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const a = j * verts + i,
          b = a + 1,
          c = a + verts,
          d = c + 1;
        // alternate the diagonal in a checkerboard for isotropic shading
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
    idx = new THREE.BufferAttribute(arr, 1);
    if (!this._indexCache) this._indexCache = new Map();
    this._indexCache.set(n, idx);
    return idx;
  }

  _makeChunk(cx, cy) {
    const tilesX = Math.min(CHUNK, this.w - cx * CHUNK);
    const tilesY = Math.min(CHUNK, this.h - cy * CHUNK);
    const nx = tilesX * RES,
      ny = tilesY * RES;
    const geo = new THREE.BufferGeometry();
    const count = (nx + 1) * (ny + 1);
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    // index (grid may be non-square at the map's far edges)
    let index;
    if (nx === ny) index = this._indexFor(nx);
    else {
      const arr = new Uint32Array(nx * ny * 6);
      let k = 0;
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const a = j * (nx + 1) + i,
            b = a + 1,
            c = a + nx + 1,
            d = c + 1;
          arr[k++] = a;
          arr[k++] = c;
          arr[k++] = b;
          arr[k++] = b;
          arr[k++] = c;
          arr[k++] = d;
        }
      index = new THREE.BufferAttribute(arr, 1);
    }
    geo.setIndex(index);
    geo.boundingBox = new THREE.Box3();
    geo.boundingSphere = new THREE.Sphere();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.name = `terrain-chunk-${cx}-${cy}`;
    this.group.add(mesh);
    return { cx, cy, nx, ny, geo, mesh, tilesX, tilesY };
  }

  // Vertex heights come from the same bilinear rule as world.heightAt(); a
  // padded grid (PAD vertices beyond the chunk) gives seam-free normals from
  // central differences averaged over two spans (0.5 and 1.0 world units).
  _buildChunk(c) {
    const world = this.game.world;
    const hgt = world.height;
    const W = world.w,
      H = world.h;
    const pos = c.geo.attributes.position.array;
    const nrm = c.geo.attributes.normal.array;
    const x0 = c.cx * CHUNK,
      z0 = c.cy * CHUNK;
    const step = 1 / RES;
    const PAD = 2;
    const pw = c.nx + 1 + PAD * 2,
      ph = c.ny + 1 + PAD * 2;
    if (!this._hpad || this._hpad.length < pw * ph) this._hpad = new Float32Array(pw * ph);
    const hp = this._hpad;
    for (let j = 0; j < ph; j++) {
      const fz = z0 + (j - PAD) * step - 0.5;
      const zi = Math.floor(fz),
        tz = fz - zi;
      const za = zi < 0 ? 0 : zi >= H ? H - 1 : zi,
        zb = zi + 1 < 0 ? 0 : zi + 1 >= H ? H - 1 : zi + 1;
      for (let i = 0; i < pw; i++) {
        const fx = x0 + (i - PAD) * step - 0.5;
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
    for (let j = 0; j <= c.ny; j++) {
      const z = z0 + j * step;
      const row = (j + PAD) * pw + PAD;
      for (let i = 0; i <= c.nx; i++) {
        const o = row + i;
        const y = hp[o];
        pos[k] = x0 + i * step;
        pos[k + 1] = y;
        pos[k + 2] = z;
        // d/dx over spans 0.5 (+-1 vertex) and 1.0 (+-2 vertices), averaged
        const gx = ((hp[o + 1] - hp[o - 1]) / (2 * step) + (hp[o + 2] - hp[o - 2]) / (4 * step)) * 0.5;
        const gz = ((hp[o + pw] - hp[o - pw]) / (2 * step) + (hp[o + 2 * pw] - hp[o - 2 * pw]) / (4 * step)) * 0.5;
        const inv = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
        nrm[k] = -gx * inv;
        nrm[k + 1] = inv;
        nrm[k + 2] = -gz * inv;
        if (y < ymin) ymin = y;
        if (y > ymax) ymax = y;
        k += 3;
      }
    }
    c.geo.attributes.position.needsUpdate = true;
    c.geo.attributes.normal.needsUpdate = true;
    c.geo.boundingBox.min.set(x0, ymin, z0);
    c.geo.boundingBox.max.set(x0 + c.tilesX, ymax, z0 + c.tilesY);
    c.geo.boundingBox.getBoundingSphere(c.geo.boundingSphere);
  }

  // Seabed skirt from the map edge out into the deep ocean (hidden by water,
  // but it keeps the shallow-to-deep gradient continuous past the edge).
  _buildSkirt() {
    const world = this.game.world;
    const W = this.w,
      H = this.h;
    const perSide = [W * RES, H * RES, W * RES, H * RES];
    const ringN = perSide[0] + perSide[1] + perSide[2] + perSide[3];
    const rings = [0, 1.5, 4, 9, 18, 34, 60, 100];
    const deep = MIN_HEIGHT - 6;
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
        const t = Math.min(1, d / 70);
        const s = t * t * (3 - 2 * t);
        const y = h0 + (deep - h0) * s;
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

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}
function unionRect(a, b) {
  if (!b) return a;
  if (!a) return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}
