import * as THREE from 'three';

// BASELINE implementation (to be replaced by the Life owner).
// One instanced capsule per species, tinted by kingdom colour when present.
export class UnitRenderer {
  constructor(game) {
    this.game = game;
    this.meshes = new Map();
    this.geo = new THREE.CapsuleGeometry(0.14, 0.3, 3, 8).translate(0, 0.3, 0);
    this.colors = { human: 0xe0b090, sheep: 0xf4f0e8, wolf: 0x6a6a72 };
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(1, 1, 1);
    this._p = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }
  meshFor(species, n) {
    let m = this.meshes.get(species);
    if (!m || m.instanceMatrix.count < n) {
      if (m) {
        this.game.scene.remove(m);
        m.dispose();
      }
      const mat = new THREE.MeshStandardMaterial({ color: this.colors[species] ?? 0xff00ff, roughness: 0.8 });
      m = new THREE.InstancedMesh(this.geo, mat, Math.max(64, n * 2));
      m.castShadow = true;
      m.frustumCulled = false;
      this.game.scene.add(m);
      this.meshes.set(species, m);
    }
    return m;
  }
  update() {
    const groups = new Map();
    for (const u of this.game.units.list) {
      let a = groups.get(u.species);
      if (!a) groups.set(u.species, (a = []));
      a.push(u);
    }
    for (const [sp, m] of this.meshes) if (!groups.has(sp)) m.count = 0;
    for (const [sp, arr] of groups) {
      const m = this.meshFor(sp, arr.length);
      let i = 0;
      for (const u of arr) {
        const s = (u.age < u.def.maturity ? 0.6 : 1) * u.def.size;
        this._s.set(s, s, s);
        this._q.setFromAxisAngle(this._up, u.heading);
        this._p.set(u.x, u.y + (u.moving ? Math.abs(Math.sin(u.anim * 9)) * 0.05 : 0), u.z);
        this._m.compose(this._p, this._q, this._s);
        m.setMatrixAt(i++, this._m);
      }
      m.count = i;
      m.instanceMatrix.needsUpdate = true;
    }
  }
}
