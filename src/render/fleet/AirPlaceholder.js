import * as THREE from 'three';

// PLACEHOLDER drawing of the air layer (docs/MODERN-ERAS.md) until the
// Fleets renderer gives aircraft, rockets and satellites real models: every
// record in game.fleet.air is a small winged dart in its realm's colour (a
// rocket or starship a white column with a flame), and game.fleet.orbit's
// satellites and stations are points of light crossing the night sky.
// Two draw calls.
export class AirPlaceholder {
  constructor(game, parent) {
    this.game = game;
    const g = new THREE.BufferGeometry();
    // a dart: fuselage along +X, swept wings, a fin (one tile long)
    const P = [0.5, 0, 0, -0.4, 0, 0.08, -0.4, 0, -0.08, 0.05, 0, 0, -0.25, 0, 0.45, -0.25, 0, -0.45, -0.3, 0, 0, -0.45, 0.22, 0, -0.45, 0, 0];
    const I = [0, 1, 2, 0, 2, 1, 3, 4, 5, 3, 5, 4, 6, 7, 8, 6, 8, 7];
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setIndex(I);
    g.computeVertexNormals();
    this.cap = 64;
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }), this.cap);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'air-placeholder';
    parent.add(this.mesh);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(80 * 3), 3));
    this.stars = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xfff6d8, size: 3, sizeAttenuation: false, transparent: true, opacity: 0 }));
    this.stars.frustumCulled = false;
    this.stars.name = 'orbit-placeholder';
    parent.add(this.stars);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  update(night = 0) {
    const g = this.game;
    const F = g.fleet;
    const air = F?.air || [];
    let n = 0;
    for (const f of air) {
      if (!f.alive || n >= this.cap) continue;
      const space = f.cls === 'space';
      const s = space ? 1.2 : f.kind === 'drone' ? 0.35 : f.kind === 'airliner' ? 1.3 : f.kind === 'skytaxi' ? 0.6 : 0.9;
      // a rocket stands on its tail and climbs
      if (space) this._e.set(0, 0, Math.PI / 2);
      else this._e.set(0, -f.heading, f.phase === 'climb' ? 0.15 : f.phase === 'land' ? -0.1 : 0);
      this._q.setFromEuler(this._e);
      this._p.set(f.x, f.y, f.z);
      this._s.set(s, s, s);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(n, this._m);
      this._c.setHex(space ? 0xf4f2ec : g.civ?.kingdomColor?.(f.kingdom) ?? 0xdddddd);
      this.mesh.setColorAt(n, this._c);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    // satellites: a high ring of points over the world, seen at night
    const orbit = F?.orbit || [];
    const pos = this.stars.geometry.attributes.position;
    const W = g.world.w,
      H = g.world.h;
    let m = 0;
    for (const o of orbit) {
      if (m >= 80) break;
      const R = Math.max(W, H) * o.r;
      const x = W / 2 + Math.cos(o.a) * R,
        z = H / 2 + Math.sin(o.a) * R * Math.cos(o.tilt);
      pos.setXYZ(m++, x, Math.max(W, H) * 0.35 + Math.sin(o.a) * Math.sin(o.tilt) * R * 0.2, z);
    }
    this.stars.geometry.setDrawRange(0, m);
    pos.needsUpdate = true;
    this.stars.material.opacity = Math.min(1, night * 1.4);
    this.stars.visible = m > 0 && night > 0.05;
  }
}
