import * as THREE from 'three';

// BASELINE implementation (to be replaced by the UI owner).
// A ring that follows the cursor on the terrain showing the brush radius.
export class BrushCursor {
  constructor(game) {
    this.game = game;
    const seg = 96;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(seg * 3), 3));
    this.seg = seg;
    this.line = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }));
    this.line.renderOrder = 999;
    this.line.frustumCulled = false;
    game.scene.add(this.line);
  }
  update() {
    const g = this.game;
    const hit = g.input.hover;
    const p = g.activePower;
    this.line.visible = !!(hit && p);
    if (!this.line.visible) return;
    const r = p.brush ? g.brushSize : 0.6;
    const pos = this.line.geometry.attributes.position.array;
    for (let i = 0; i < this.seg; i++) {
      const a = (i / this.seg) * Math.PI * 2;
      const x = hit.x + Math.cos(a) * r,
        z = hit.z + Math.sin(a) * r;
      pos[i * 3] = x;
      pos[i * 3 + 1] = g.world.surfaceAt(x, z) + 0.15;
      pos[i * 3 + 2] = z;
    }
    this.line.geometry.attributes.position.needsUpdate = true;
  }
}
