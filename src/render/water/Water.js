import * as THREE from 'three';
import { SEA_LEVEL } from '../../world/constants.js';
import { landscapeUniforms, refreshLandscapeUniforms } from './waterCommon.js';
import { patchWaterMaterial } from './waterShader.js';
import { getNoiseTextures } from '../terrain/noiseTextures.js';
import { seaIceOf } from '../../world/seaIce.js';

// Water surface (Landscape).
//
// A single flat sheet at SEA_LEVEL that reaches far past the map edge to the
// horizon (picking assumes the surface is at y = 0, so there is no vertex
// displacement). Colour is depth based, read from terrain.heightTexture; the
// seabed seen through the surface is tinted by the terrain shader with the
// same optics (waterCommon.js), so both agree everywhere.
//
// A CPU "shore field" (distance from each water tile to the nearest land
// tile, and the local width of the water body) shapes the foam bands so they
// follow coastlines in open water and stay subtle in narrow rivers.
export class Water {
  constructor(game) {
    this.game = game;
    const world = game.world;
    this.w = world.w;
    this.h = world.h;
    const W = this.w,
      H = this.h;

    this.shoreData = new Uint8Array(W * H * 4);
    this.shoreTexture = new THREE.DataTexture(this.shoreData, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.shoreTexture.magFilter = this.shoreTexture.minFilter = THREE.LinearFilter;
    this.shoreTexture.wrapS = this.shoreTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.shoreTexture.generateMipmaps = false;
    this.shoreTexture.colorSpace = THREE.NoColorSpace;
    this._dist = new Float32Array(W * H);
    this._tmp = new Float32Array(Math.max(W, H) + 2);

    // sea ice: per-tile freeze keys (R) and icebergs (G), read with exact
    // fetches; the same field keeps the ships off the ice (seaIce.js)
    this.iceData = new Float32Array(W * H * 2);
    this.iceTexture = new THREE.DataTexture(this.iceData, W, H, THREE.RGFormat, THREE.FloatType);
    this.iceTexture.magFilter = this.iceTexture.minFilter = THREE.NearestFilter;
    this.iceTexture.wrapS = this.iceTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.iceTexture.generateMipmaps = false;
    this.iceTexture.colorSpace = THREE.NoColorSpace;
    this._iceVer = -1;
    this._iceWait = 0;

    const shared = landscapeUniforms(game);
    const noise = getNoiseTextures();
    const terrain = game.terrain;
    this.uniforms = {
      ...shared,
      uHeightTex: { value: terrain?.heightTexture || shared.uHeightTex.value },
      uTypeTex: { value: terrain?.typeTexture || null },
      uShoreTex: { value: this.shoreTexture },
      uNoise: { value: noise.noise },
      uCells: { value: noise.cells },
      uCamFar: { value: 2000 },
      uClimTex: { value: terrain?.climTexture || null },
      uIceKey: { value: this.iceTexture },
    };
    // the terrain reads the same shore field (river banks at map zoom)
    if (terrain?.uniforms?.uShoreTex) terrain.uniforms.uShoreTex.value = this.shoreTexture;
    if (!this.uniforms.uClimTex.value) {
      const t = new THREE.DataTexture(new Uint8Array([128, 128, 255, 0]), 1, 1);
      t.needsUpdate = true;
      this.uniforms.uClimTex.value = t;
    }
    if (!this.uniforms.uTypeTex.value) {
      const t = new THREE.DataTexture(new Uint8Array(W * H), W, H, THREE.RedFormat, THREE.UnsignedByteType);
      t.needsUpdate = true;
      this.uniforms.uTypeTex.value = t;
    }
    if (!shared.uCloudTex.value) {
      const b = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
      b.needsUpdate = true;
      shared.uCloudTex.value = b;
    }

    const mat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.1, metalness: 0 });
    mat.transparent = true;
    mat.depthWrite = true;
    mat.blending = THREE.CustomBlending;
    mat.blendEquation = THREE.AddEquation;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneMinusSrcAlphaFactor;
    mat.blendSrcAlpha = THREE.OneFactor;
    mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    patchWaterMaterial(mat, this.uniforms);
    this.material = mat;

    // Inner, denser grid over the map and a coarse outer apron to the horizon.
    const R = 9000;
    const geo = new THREE.PlaneGeometry(R * 2, R * 2, 96, 96);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(W / 2, SEA_LEVEL, H / 2);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.renderOrder = -5; // first among transparents: particles/clouds draw over it
    this.mesh.frustumCulled = false;
    this.mesh.name = 'water';
    game.scene.add(this.mesh);

    this._shoreDirty = true;
    this._shoreTimer = 0;
    // (round 35) the field follows the coastline only: a plot levelled on dry
    // land leaves it as it was. Every height edit used to redo it over the
    // whole map (55-100 ms on the Vast World Map, about once a second in live
    // play as the towns level their plots).
    this._wetSnap = new Uint8Array(W * H);
    game.events.on('world:height', (r) => {
      if (this._shoreDirty || !this._wetChanged(r)) return;
      this._shoreDirty = true;
      this._shoreTimer = Math.max(this._shoreTimer, 0.15);
    });
    this._computeShore();
    this._syncIce(true);
  }

  reset() {
    this._shoreDirty = true;
    this._shoreTimer = 0;
    this._computeShore();
    seaIceOf(this.game).invalidate();
    this._syncIce(true);
  }

  // Upload the sea-ice keys when they changed (rebuilt at most every ~2 s
  // while the water is being edited: an icebreaker cuts a tile at a time).
  _syncIce(now = false, dt = 0) {
    const si = seaIceOf(this.game);
    if (si.dirty) {
      this._iceWait += dt;
      if (!now && this._iceWait < 2) return;
      this._iceWait = 0;
      si.ensure();
    }
    if (si.version === this._iceVer && si.world === this._iceWorld) return;
    this._iceVer = si.version;
    this._iceWorld = si.world;
    const k = si.key,
      b = si.berg,
      d = this.iceData;
    for (let i = 0; i < k.length; i++) {
      d[i * 2] = k[i];
      d[i * 2 + 1] = b[i];
    }
    this.iceTexture.needsUpdate = true;
  }

  update(dt) {
    const g = this.game;
    refreshLandscapeUniforms(g, dt);
    const cam = g.cameraRig?.camera;
    if (cam) this.uniforms.uCamFar.value = cam.far;
    if (g.terrain?.heightTexture && this.uniforms.uHeightTex.value !== g.terrain.heightTexture) {
      this.uniforms.uHeightTex.value = g.terrain.heightTexture;
      this.uniforms.uTypeTex.value = g.terrain.typeTexture;
      if (g.terrain.climTexture) this.uniforms.uClimTex.value = g.terrain.climTexture;
    }
    if (this._shoreDirty) {
      this._shoreTimer -= dt;
      if (this._shoreTimer <= 0) this._computeShore();
    }
    this._syncIce(false, dt);
  }

  // did any tile in the rect turn from land to water or back since the field
  // was last worked out?
  _wetChanged(r) {
    const W = this.w,
      hgt = this.game.world.height,
      s = this._wetSnap;
    for (let y = Math.max(0, r.y0); y <= Math.min(this.h - 1, r.y1); y++)
      for (let i = y * W + Math.max(0, r.x0), e = y * W + Math.min(W - 1, r.x1); i <= e; i++) if ((hgt[i] < SEA_LEVEL ? 1 : 0) !== s[i]) return true;
    return false;
  }

  // Euclidean distance (tiles) from water tiles to the nearest land tile, and
  // a dilated copy ("how wide is the water here").
  _computeShore() {
    this._shoreDirty = false;
    const world = this.game.world;
    const W = this.w,
      H = this.h;
    const INF = 1e9;
    const f = this._dist;
    const snap = this._wetSnap;
    for (let i = 0; i < W * H; i++) {
      const wet = world.height[i] < SEA_LEVEL;
      snap[i] = wet ? 1 : 0;
      f[i] = wet ? INF : 0;
    }
    edt2d(f, W, H, this._tmp);
    const d = this._dist;
    // dilate (max filter) radius 4, separable
    const tmp = new Float32Array(W * H);
    const wide = new Float32Array(W * H);
    const r = 4;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let m = 0;
        for (let k = -r; k <= r; k++) {
          const xx = x + k;
          if (xx < 0 || xx >= W) continue;
          const v = d[y * W + xx];
          if (v > m) m = v;
        }
        tmp[y * W + x] = m;
      }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let m = 0;
        for (let k = -r; k <= r; k++) {
          const yy = y + k;
          if (yy < 0 || yy >= H) continue;
          const v = tmp[yy * W + x];
          if (v > m) m = v;
        }
        wide[y * W + x] = m;
      }
    const out = this.shoreData;
    for (let i = 0; i < W * H; i++) {
      const di = Math.sqrt(d[i]);
      const wi = Math.sqrt(wide[i]);
      out[i * 4] = Math.min(255, Math.round((di / 16) * 255));
      out[i * 4 + 1] = Math.min(255, Math.round((wi / 16) * 255));
      out[i * 4 + 2] = 0;
      out[i * 4 + 3] = 255;
    }
    this.shoreTexture.needsUpdate = true;
  }
}

// Felzenszwalb-Huttenlocher squared Euclidean distance transform (in place).
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}
export function edt2d(grid, W, H) {
  const n = Math.max(W, H);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = grid[y * W + x];
    edt1d(f, H, d, v, z);
    for (let y = 0; y < H; y++) grid[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = grid[y * W + x];
    edt1d(f, W, d, v, z);
    for (let x = 0; x < W; x++) grid[y * W + x] = d[x];
  }
  return grid;
}
