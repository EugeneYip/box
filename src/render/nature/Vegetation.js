import * as THREE from 'three';
import { FLORA, FLORA_INFO } from '../../world/constants.js';
import { hash2 } from '../../core/Random.js';

// BASELINE implementation (to be replaced by the Nature owner).
// Renders world.flora with one InstancedMesh per flora kind; rebuilds fully
// whenever 'world:flora' fires (the real implementation should use chunks).
export class Vegetation {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    const cone = new THREE.ConeGeometry(0.45, 1.4, 6).translate(0, 1.0, 0);
    const ball = new THREE.IcosahedronGeometry(0.55, 0).translate(0, 0.9, 0);
    const small = new THREE.IcosahedronGeometry(0.25, 0).translate(0, 0.2, 0);
    const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true });
    this.kinds = new Map();
    const def = (id, geo, color) => this.kinds.set(id, { geo, mat: mat(color), mesh: null });
    def(FLORA.OAK, ball, 0x3f8f3a);
    def(FLORA.BIRCH, ball, 0x7fb24a);
    def(FLORA.PINE, cone, 0x2f6b3a);
    def(FLORA.SNOW_PINE, cone, 0xb8d0c8);
    def(FLORA.PALM, ball, 0x5aa040);
    def(FLORA.JUNGLE_TREE, ball, 0x2a8040);
    def(FLORA.ACACIA, ball, 0x8a9a40);
    def(FLORA.SWAMP_TREE, ball, 0x4a6a3a);
    def(FLORA.DEAD_TREE, cone, 0x5a4a3a);
    def(FLORA.BUSH, small, 0x4a8a3a);
    def(FLORA.BERRY_BUSH, small, 0x5a7a3a);
    def(FLORA.FLOWERS, small, 0xe08aa0);
    def(FLORA.CACTUS, cone, 0x4a8a4a);
    def(FLORA.ROCK_SMALL, small, 0x8a8a8a);
    def(FLORA.BOULDER, ball, 0x7a7a7a);
    def(FLORA.REEDS, small, 0x8a9a4a);
    def(FLORA.MUSHROOM, small, 0xc05040);
    def(FLORA.WHEAT, small, 0xd8b850);
    def(FLORA.STUMP, small, 0x6a4a2a);
    this.dirty = true;
    game.events.on('world:flora', () => (this.dirty = true));
    game.events.on('world:height', () => (this.dirty = true));
  }
  reset() {
    this.dirty = true;
  }
  rebuild() {
    this.dirty = false;
    const world = this.game.world;
    const counts = new Map();
    for (let i = 0; i < world.size; i++) {
      const f = world.flora[i];
      if (f) counts.set(f, (counts.get(f) || 0) + 1);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [id, k] of this.kinds) {
      const n = counts.get(id) || 0;
      if (!k.mesh || k.mesh.instanceMatrix.count < n) {
        if (k.mesh) {
          this.group.remove(k.mesh);
          k.mesh.dispose();
        }
        k.mesh = new THREE.InstancedMesh(k.geo, k.mat, Math.max(16, Math.ceil(n * 1.25)));
        k.mesh.castShadow = true;
        k.mesh.receiveShadow = true;
        this.group.add(k.mesh);
      }
      k.mesh.count = 0;
    }
    for (let ty = 0; ty < world.h; ty++) {
      for (let tx = 0; tx < world.w; tx++) {
        const i = world.idx(tx, ty);
        const f = world.flora[i];
        if (!f) continue;
        const k = this.kinds.get(f);
        if (!k) continue;
        const jx = (hash2(tx, ty, 1) - 0.5) * 0.5,
          jz = (hash2(tx, ty, 2) - 0.5) * 0.5;
        const x = tx + 0.5 + jx,
          z = ty + 0.5 + jz;
        p.set(x, world.heightAt(x, z), z);
        q.setFromAxisAngle(up, hash2(tx, ty, 3) * Math.PI * 2);
        const g = 0.35 + 0.65 * world.floraGrowth[i];
        const sc = g * (0.8 + 0.4 * hash2(tx, ty, 4));
        s.set(sc, sc, sc);
        m.compose(p, q, s);
        k.mesh.setMatrixAt(k.mesh.count++, m);
      }
    }
    for (const k of this.kinds.values()) {
      k.mesh.instanceMatrix.needsUpdate = true;
      k.mesh.computeBoundingSphere();
    }
  }
  update() {
    if (this.dirty) this.rebuild();
  }
  inspect(hit) {
    const world = this.game.world;
    const f = world.flora[world.idx(hit.tx, hit.ty)];
    if (!f) return null;
    return { priority: 1, title: FLORA_INFO[f].name, kind: 'flora' };
  }
}
