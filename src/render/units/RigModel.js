import * as THREE from 'three';
import { ModelBuilder, P } from './ModelBuilder.js';
import { makeRigMaterial } from './RigMaterial.js';

// One instanced, rig-animated creature model (one draw call + one shadow call).
// Usage per frame: begin(); for each visible creature: write(...); end().
// Instances written with shadow = false are packed after the shadow casters and
// skipped by the shadow pass (onBeforeShadow trims the instance count).
export class RigModel {
  constructor(parent, def, detail = 1, shared = null, buildFn = null) {
    this.def = def;
    this.parent = parent;
    this.detail = detail;
    this.tiny = !!buildFn;
    const B = new ModelBuilder(def);
    P.D = detail;
    try {
      (buildFn || def.build)(B);
    } finally {
      P.D = 1;
    }
    this.nf = 0;
    this.nShadow = 0;
    this._stage = null;
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
    mesh.name = 'units:' + this.def.id + (this.tiny ? ':tiny' : this.detail < 1 ? ':lo' : '');
    mesh.onBeforeShadow = () => {
      mesh.count = this.nShadow;
    };
    mesh.onAfterShadow = () => {
      mesh.count = this.n;
    };
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
    this.nf = 0;
  }

  _stageArrays(cap) {
    const old = this._stage;
    const mk = (n, o) => {
      const a = new Float32Array(cap * n);
      if (o) a.set(o.subarray(0, Math.min(o.length, a.length)));
      return a;
    };
    this._stage = {
      cap,
      M: mk(16, old?.M),
      P0: mk(4, old?.P0),
      P1: mk(4, old?.P1),
      P2: mk(4, old?.P2),
      P3: mk(4, old?.P3),
      C0: mk(4, old?.C0),
      C1: mk(4, old?.C1),
      C2: mk(4, old?.C2),
      V: mk(4, old?.V),
    };
  }

  // m: THREE.Matrix4, P: Float32Array(16), ap: appearance {a:[r,g,b], b, c, sec, var:[4]}
  // shadow = false: rendered but not drawn into the shadow map (distant creatures).
  write(m, P, ap, flash, fade, glow, shadow = true) {
    let i, M, P0, P1, P2, P3, C0, C1, C2, V;
    if (shadow) {
      if (this.n >= this.cap) this._grow(this.cap * 2);
      i = this.n++;
      M = this.aMat;
      P0 = this.aP0;
      P1 = this.aP1;
      P2 = this.aP2;
      P3 = this.aP3;
      C0 = this.aC0;
      C1 = this.aC1;
      C2 = this.aC2;
      V = this.aV;
    } else {
      if (!this._stage || this.nf >= this._stage.cap) this._stageArrays(Math.max(32, (this._stage?.cap || 16) * 2));
      const S = this._stage;
      i = this.nf++;
      M = S.M;
      P0 = S.P0;
      P1 = S.P1;
      P2 = S.P2;
      P3 = S.P3;
      C0 = S.C0;
      C1 = S.C1;
      C2 = S.C2;
      V = S.V;
    }
    this._put(i, m, P, ap, flash, fade, glow, M, P0, P1, P2, P3, C0, C1, C2, V);
  }

  _put(i, m, P, ap, flash, fade, glow, M, P0, P1, P2, P3, C0, C1, C2, V) {
    const e = m.elements;
    const o = i * 16;
    for (let k = 0; k < 16; k++) M[o + k] = e[k];
    const j = i * 4;
    P0[j] = P[0];
    P0[j + 1] = P[1];
    P0[j + 2] = P[2];
    P0[j + 3] = P[3];
    P1[j] = P[4];
    P1[j + 1] = P[5];
    P1[j + 2] = P[6];
    P1[j + 3] = P[7];
    P2[j] = P[8];
    P2[j + 1] = P[9];
    P2[j + 2] = P[10];
    P2[j + 3] = P[11];
    P3[j] = P[12];
    P3[j + 1] = P[13];
    P3[j + 2] = P[14];
    P3[j + 3] = P[15];
    const a = ap.a,
      b = ap.b,
      c = ap.c;
    C0[j] = a[0];
    C0[j + 1] = a[1];
    C0[j + 2] = a[2];
    C0[j + 3] = flash;
    C1[j] = b[0];
    C1[j + 1] = b[1];
    C1[j + 2] = b[2];
    C1[j + 3] = fade;
    C2[j] = c[0];
    C2[j + 1] = c[1];
    C2[j + 2] = c[2];
    C2[j + 3] = (ap.sec || 0) + Math.min(1, Math.max(0, glow)) * 0.9;
    const v = ap.var;
    V[j] = v[0];
    V[j + 1] = v[1];
    V[j + 2] = v[2];
    V[j + 3] = v[3];
  }

  end() {
    // append the non-shadow instances after the shadow casters
    this.nShadow = this.n;
    if (this.nf) {
      const total = this.n + this.nf;
      if (total > this.cap) {
        let c = this.cap;
        while (c < total) c *= 2;
        this._grow(c);
      }
      const S = this._stage,
        n = this.n,
        f = this.nf;
      this.aMat.set(S.M.subarray(0, f * 16), n * 16);
      this.aP0.set(S.P0.subarray(0, f * 4), n * 4);
      this.aP1.set(S.P1.subarray(0, f * 4), n * 4);
      this.aP2.set(S.P2.subarray(0, f * 4), n * 4);
      this.aP3.set(S.P3.subarray(0, f * 4), n * 4);
      this.aC0.set(S.C0.subarray(0, f * 4), n * 4);
      this.aC1.set(S.C1.subarray(0, f * 4), n * 4);
      this.aC2.set(S.C2.subarray(0, f * 4), n * 4);
      this.aV.set(S.V.subarray(0, f * 4), n * 4);
      this.n = total;
      this.nf = 0;
    }
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
