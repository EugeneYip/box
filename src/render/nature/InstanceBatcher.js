import * as THREE from 'three';

// Concatenates per-chunk instance lists into one InstancedMesh per batch key.
//
// Chunks own compact Float32Array lists (matrices + colours) that are only
// rebuilt when their tiles change. Each time the set of visible chunks (or
// their LOD) changes, compact() copies the lists of the visible chunks into
// shared InstancedMeshes, so the draw-call count is bounded by the number of
// distinct (model, variant, LOD) combinations on screen rather than by
// chunks x models. Culling happens per chunk on the CPU before compaction.
export class InstanceBatcher {
  constructor(group, name) {
    this.group = group;
    this.name = name;
    this.batches = new Map();
    this._items = [];
    this.drawn = 0;
  }

  begin() {
    for (const b of this.batches.values()) b.need = 0;
    this._items.length = 0;
  }

  // meta: { geo, material, depth, castShadow, label }
  add(key, list, meta) {
    if (!list.n) return;
    let b = this.batches.get(key);
    if (!b) this.batches.set(key, (b = { mesh: null, need: 0, fill: 0, meta }));
    b.need += list.n;
    this._items.push(key, list);
  }

  end() {
    for (const b of this.batches.values()) {
      const cap = b.mesh ? b.mesh.instanceMatrix.count : 0;
      if (b.need > cap) {
        if (b.mesh) {
          this.group.remove(b.mesh);
          b.mesh.dispose();
        }
        b.mesh = this.create(b.meta, Math.ceil(b.need * 1.3) + 16);
      }
      b.fill = 0;
    }
    const items = this._items;
    for (let k = 0; k < items.length; k += 2) {
      const b = this.batches.get(items[k]);
      const list = items[k + 1];
      b.mesh.instanceMatrix.array.set(list.n * 16 === list.mats.length ? list.mats : list.mats.subarray(0, list.n * 16), b.fill * 16);
      b.mesh.instanceColor.array.set(list.n * 3 === list.cols.length ? list.cols : list.cols.subarray(0, list.n * 3), b.fill * 3);
      b.fill += list.n;
    }
    let drawn = 0;
    for (const b of this.batches.values()) {
      const m = b.mesh;
      if (!m) continue;
      m.count = b.fill;
      m.visible = b.fill > 0;
      if (b.fill) {
        m.instanceMatrix.clearUpdateRanges();
        m.instanceMatrix.addUpdateRange(0, b.fill * 16);
        m.instanceMatrix.needsUpdate = true;
        m.instanceColor.clearUpdateRanges();
        m.instanceColor.addUpdateRange(0, b.fill * 3);
        m.instanceColor.needsUpdate = true;
        drawn += b.fill;
      }
    }
    this.drawn = drawn;
    items.length = 0;
  }

  create(meta, cap) {
    const mesh = new THREE.InstancedMesh(meta.geo, meta.material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    if (meta.depth) mesh.customDepthMaterial = meta.depth;
    mesh.castShadow = !!meta.castShadow;
    mesh.receiveShadow = !meta.layer;
    // shadow-only proxies live on a layer that only light shadow cameras see
    if (meta.layer) mesh.layers.set(meta.layer);
    mesh.frustumCulled = false; // culled per chunk before compaction
    mesh.matrixAutoUpdate = false;
    mesh.name = this.name + '-' + meta.label;
    this.group.add(mesh);
    return mesh;
  }

  // Swap the geometry of a batch (unused here but handy for hot reloads).
  meshes() {
    return [...this.batches.values()].map((b) => b.mesh).filter(Boolean);
  }

  dispose() {
    for (const b of this.batches.values()) {
      if (b.mesh) {
        this.group.remove(b.mesh);
        b.mesh.dispose();
      }
    }
    this.batches.clear();
  }
}
