import * as THREE from 'three';
import { TILE_INFO, SEA_LEVEL } from '../../world/constants.js';

// BASELINE implementation (to be replaced by the Landscape owner).
// A single vertex-coloured heightfield mesh with one vertex per tile centre,
// rebuilt in the dirty rect when 'world:height' / 'world:type' fire.
export class Terrain {
  constructor(game) {
    this.game = game;
    const w = game.world.w,
      h = game.world.h;
    const geo = new THREE.PlaneGeometry(w - 1, h - 1, w - 1, h - 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(w / 2, 0, h / 2);
    this.colors = new Float32Array(w * h * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    game.scene.add(this.mesh);
    this._dirty = { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
    const mark = (r) => this.mark(r);
    game.events.on('world:height', mark);
    game.events.on('world:type', mark);
    this.rebuild();
  }
  mark(r) {
    if (!this._dirty) this._dirty = { ...r };
    else {
      this._dirty.x0 = Math.min(this._dirty.x0, r.x0);
      this._dirty.y0 = Math.min(this._dirty.y0, r.y0);
      this._dirty.x1 = Math.max(this._dirty.x1, r.x1);
      this._dirty.y1 = Math.max(this._dirty.y1, r.y1);
    }
  }
  reset() {
    this.mark({ x0: 0, y0: 0, x1: this.game.world.w - 1, y1: this.game.world.h - 1 });
  }
  rebuild() {
    const r = this._dirty;
    if (!r) return;
    this._dirty = null;
    const world = this.game.world;
    const pos = this.geo.attributes.position.array;
    const col = new THREE.Color();
    for (let ty = r.y0; ty <= r.y1; ty++) {
      for (let tx = r.x0; tx <= r.x1; tx++) {
        const i = world.idx(tx, ty);
        pos[i * 3] = tx + 0.5;
        pos[i * 3 + 1] = world.height[i];
        pos[i * 3 + 2] = ty + 0.5;
        col.setHex(TILE_INFO[world.type[i]].color).convertSRGBToLinear();
        if (world.height[i] < SEA_LEVEL) col.multiplyScalar(0.8);
        this.colors[i * 3] = col.r;
        this.colors[i * 3 + 1] = col.g;
        this.colors[i * 3 + 2] = col.b;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
  }
  update() {
    this.rebuild();
  }
}
