import * as THREE from 'three';
import { Pass } from 'postprocessing';

// Fullscreen helper: draws one material into a target.
export class FSQuad {
  constructor(material) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
    this.mesh = new THREE.Mesh(Pass.fullscreenGeometry, material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }
  get material() {
    return this.mesh.material;
  }
  render(renderer, target) {
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.mesh.material.dispose();
  }
}

export const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

// Converts the hardware depth buffer into linear view distance (world units)
// once per frame. Every atmosphere effect samples this texture instead of the
// composer's depth attachment, which (a) avoids framebuffer feedback loops
// regardless of how passes ping-pong and (b) saves per-tap linearisation.
// Sky / background pixels (window depth >= 0.99999: the dome writes
// 0.999995) store a huge value (65000).
export class LinearDepthPass extends Pass {
  constructor(camera, { float = true } = {}) {
    super('LinearDepthPass');
    this.needsSwap = false;
    this.needsDepthTexture = true;
    this.mainCam = camera;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: float ? THREE.FloatType : THREE.HalfFloatType,
      format: THREE.RedFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });
    this.target.texture.name = 'LinearDepth';
    this.quad = new FSQuad(
      new THREE.ShaderMaterial({
        name: 'LinearDepth',
        uniforms: { tDepth: { value: null }, uNear: { value: 0.5 }, uFar: { value: 1000 } },
        vertexShader: FS_VERT,
        fragmentShader: /* glsl */ `
          uniform highp sampler2D tDepth;
          uniform float uNear;
          uniform float uFar;
          varying vec2 vUv;
          void main() {
            float d = texture2D(tDepth, vUv).r;
            float z = (uNear * uFar) / ((uFar - uNear) * d - uFar);
            gl_FragColor = vec4(d >= 0.99999 ? 65000.0 : -z, 0.0, 0.0, 1.0);
          }`,
        depthTest: false,
        depthWrite: false,
      }),
    );
  }
  get texture() {
    return this.target.texture;
  }
  setDepthTexture(depthTexture) {
    this.quad.material.uniforms.tDepth.value = depthTexture;
  }
  render(renderer) {
    const u = this.quad.material.uniforms;
    u.uNear.value = this.mainCam.near;
    u.uFar.value = this.mainCam.far;
    this.quad.render(renderer, this.target);
  }
  setSize(w, h) {
    this.target.setSize(w, h);
  }
  dispose() {
    this.target.dispose();
    this.quad.dispose();
  }
}
