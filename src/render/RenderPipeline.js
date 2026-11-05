import * as THREE from 'three';

// Owns the WebGLRenderer and the final frame composition (post-processing).
// Contract: every module renders through game.pipeline; nobody else creates a
// renderer. Other modules may call pipeline.addPass()/hooks once the
// atmosphere module exposes them. Quality tiers: low | medium | high | ultra.
export class RenderPipeline {
  constructor(game, container) {
    this.game = game;
    this.quality = game.params.quality || (matchMedia('(pointer: coarse)').matches ? 'medium' : 'high');
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
      stencil: false,
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, this.quality === 'ultra' ? 2 : 1.5));
    renderer.setSize(innerWidth, innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = this.quality !== 'low';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    renderer.domElement.id = 'game-canvas';
    this.renderer = renderer;
    this.size = new THREE.Vector2(innerWidth, innerHeight);
  }

  resize(w, h) {
    this.size.set(w, h);
    this.renderer.setSize(w, h);
  }

  render(dt) {
    this.renderer.render(this.game.scene, this.game.cameraRig.camera);
  }
}
