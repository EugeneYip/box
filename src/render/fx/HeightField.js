import * as THREE from 'three';

// GPU copy of world.height (one float texel per tile) so particle and decal
// shaders can conform to / fade against the terrain without a depth buffer.
// Sampling matches World.heightAt(): bilinear between tile centres.
export const HEIGHT_GLSL = /* glsl */ `
uniform sampler2D uHeight;
uniform vec2 uWorldSize;
float fxHeightTexel(ivec2 c) {
  c = clamp(c, ivec2(0), ivec2(uWorldSize) - 1);
  return texelFetch(uHeight, c, 0).r;
}
float fxGroundAt(vec2 xz) {
  vec2 f = xz - 0.5;
  vec2 i = floor(f);
  vec2 t = f - i;
  ivec2 c = ivec2(i);
  float h00 = fxHeightTexel(c);
  float h10 = fxHeightTexel(c + ivec2(1, 0));
  float h01 = fxHeightTexel(c + ivec2(0, 1));
  float h11 = fxHeightTexel(c + ivec2(1, 1));
  return mix(mix(h00, h10, t.x), mix(h01, h11, t.x), t.y);
}
float fxSurfaceAt(vec2 xz) { return max(fxGroundAt(xz), 0.0); }
`;

export class HeightField {
  constructor(game) {
    this.game = game;
    const w = game.world.w,
      h = game.world.h;
    this.data = new Float32Array(w * h);
    this.texture = new THREE.DataTexture(this.data, w, h, THREE.RedFormat, THREE.FloatType);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.flipY = false;
    this.size = new THREE.Vector2(w, h);
    this.dirty = true;
    this._cool = 0;
    game.events.on('world:height', () => (this.dirty = true));
    game.events.on('world:regenerated', () => (this.dirty = true));
  }
  reset() {
    this.dirty = true;
    this._cool = 0;
  }
  update(dt) {
    this._cool -= dt;
    if (!this.dirty || this._cool > 0) return;
    this.dirty = false;
    this._cool = 0.12; // at most ~8 uploads per second while terrain is edited
    this.data.set(this.game.world.height);
    this.texture.needsUpdate = true;
  }
  uniforms() {
    return { uHeight: { value: this.texture }, uWorldSize: { value: this.size } };
  }
}
