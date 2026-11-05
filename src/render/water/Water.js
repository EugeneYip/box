import * as THREE from 'three';
import { SEA_LEVEL } from '../../world/constants.js';

// BASELINE implementation (to be replaced by the Landscape owner).
export class Water {
  constructor(game) {
    this.game = game;
    const w = game.world.w,
      h = game.world.h;
    const geo = new THREE.PlaneGeometry(w * 3, h * 3, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0x2a7fb8, transparent: true, opacity: 0.78, roughness: 0.15, metalness: 0.1 }),
    );
    this.mesh.position.set(w / 2, SEA_LEVEL, h / 2);
    this.mesh.receiveShadow = true;
    game.scene.add(this.mesh);
  }
  update() {}
}
