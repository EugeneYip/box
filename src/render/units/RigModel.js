import * as THREE from 'three';
import { ModelBuilder, P } from './ModelBuilder.js';
import { makeRigMaterial } from './RigMaterial.js';

// One instanced, rig-animated creature model (one draw call + one shadow call).
// Usage per frame: begin(); for each visible creature: write(...); end().
export class RigModel {
  constructor(parent, def, detail = 1, shared = null) {
    this.def = def;
    this.parent = parent;
    this.detail = detail;
    const B = new ModelBuilder(def);
    P.D = detail;
    try {
      def.build(B);
    } finally {
      P.D = 1;
    }
    this.baseGeo = B.build();
    const { material, depth, uniforms } = shared || makeRigMaterial(def);
    this.material = material;
    this.depth = depth;
    this.uniforms = uniforms;
    this.cap = 0;
    this.n = 0;
    this.mesh = null;
    this._grow(16);
  }

  get vertexCount() {
    return this.baseGeo.attributes.position.count;
  }

  _grow(cap) {
    const geo = this.baseGeo.clone();
    const mk = (n) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    const old = this.mesh;
    const attrs = ['iPose0', 'iPose1', 'iPose2', 'iPose3', 'iCol0', 'iCol1', 'iCol2', 'iVar'];
    for (const k of attrs) {
      const a = mk(4);
      if (old) a.array.set(old.geometry.attributes[k].array.subarray(0, Math.min(old.geometry.attributes[k].array.length, a.array.length)));
      geo.setAttribute(k, a);
    }
    const mesh = new THREE.InstancedMesh(geo, this.material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (old) mesh.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, Math.min(old.instanceMatrix.array.length, cap * 16)));
    mesh.castShadow = this.def.castShadow !== false;
    mesh.receiveShadow = this.def.receiveShadow !== false;
    mesh.customDepthMaterial = this.depth;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.name = 'units:' + this.def.id + (this.detail < 1 ? ':lo' : '');
    this.parent.add(mesh);
    if (old) {
      this.parent.remove(old);
      old.geometry.dispose();
      old.dispose?.();
    }
    this.mesh = mesh;
    this.cap = cap;
    const ga = geo.attributes;
    this.aMat = mesh.instanceMatrix.array;
    this.aP0 = ga.iPose0.array;
    this.aP1 = ga.iPose1.array;
    this.aP2 = ga.iPose2.array;
    this.aP3 = ga.iPose3.array;
    this.aC0 = ga.iCol0.array;
    this.aC1 = ga.iCol1.array;
    this.aC2 = ga.iCol2.array;
    this.aV = ga.iVar.array;
  }

  begin() {
    this.n = 0;
  }

  // m: THREE.Matrix4, P: Float32Array(16), ap: appearance {a:[r,g,b], b, c, sec, var:[4]}
  write(m, P, ap, flash, fade, glow) {
    if (this.n >= this.cap) this._grow(this.cap * 2);
    const i = this.n++;
    const e = m.elements;
    const M = this.aMat;
    const o = i * 16;
    for (let k = 0; k < 16; k++) M[o + k] = e[k];
    const j = i * 4;
    this.aP0[j] = P[0];
    this.aP0[j + 1] = P[1];
    this.aP0[j + 2] = P[2];
    this.aP0[j + 3] = P[3];
    this.aP1[j] = P[4];
    this.aP1[j + 1] = P[5];
    this.aP1[j + 2] = P[6];
    this.aP1[j + 3] = P[7];
    this.aP2[j] = P[8];
    this.aP2[j + 1] = P[9];
    this.aP2[j + 2] = P[10];
    this.aP2[j + 3] = P[11];
    this.aP3[j] = P[12];
    this.aP3[j + 1] = P[13];
    this.aP3[j + 2] = P[14];
    this.aP3[j + 3] = P[15];
    const a = ap.a,
      b = ap.b,
      c = ap.c;
    this.aC0[j] = a[0];
    this.aC0[j + 1] = a[1];
    this.aC0[j + 2] = a[2];
    this.aC0[j + 3] = flash;
    this.aC1[j] = b[0];
    this.aC1[j + 1] = b[1];
    this.aC1[j + 2] = b[2];
    this.aC1[j + 3] = fade;
    this.aC2[j] = c[0];
    this.aC2[j + 1] = c[1];
    this.aC2[j + 2] = c[2];
    this.aC2[j + 3] = (ap.sec || 0) + Math.min(1, Math.max(0, glow)) * 0.9;
    const v = ap.var;
    this.aV[j] = v[0];
    this.aV[j + 1] = v[1];
    this.aV[j + 2] = v[2];
    this.aV[j + 3] = v[3];
  }

  end() {
    const mesh = this.mesh;
    mesh.count = this.n;
    if (!this.n) return;
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, this.n * 16);
    mesh.instanceMatrix.needsUpdate = true;
    const ga = mesh.geometry.attributes;
    for (const k of ['iPose0', 'iPose1', 'iPose2', 'iPose3', 'iCol0', 'iCol1', 'iCol2', 'iVar']) {
      const at = ga[k];
      at.clearUpdateRanges();
      at.addUpdateRange(0, this.n * 4);
      at.needsUpdate = true;
    }
  }

  setRim(color, amount) {
    this.uniforms.uRimCol.value.copy(color);
    if (amount != null) this.uniforms.uRim.value = amount;
  }
}
