import * as THREE from 'three';
import { SEA_LEVEL } from '../../world/constants.js';

// Kingdom territory: a w x h RGBA DataTexture (one texel per tile, RGB =
// heraldic colour, A = strength) handed to the terrain shader through
// game.terrain.setOverlay(tex). If the terrain module does not provide the
// hook, a draped fallback mesh draws tint + crisp borders itself.
export class TerritoryOverlay {
  constructor(game) {
    this.game = game;
    this._alloc();
    this.dirty = { x0: 0, y0: 0, x1: game.world.w - 1, y1: game.world.h - 1 };
    this._colorVer = -1;
    game.events.on('world:owner', (r) => this.mark(r));
    game.events.on('world:regenerated', () => this.markAll());
    game.events.on('world:height', (r) => this._heightDirty(r));
    this.hooked = false;
    this.fallback = null;
  }

  _alloc() {
    const w = this.game.world;
    this.data = new Uint8Array(w.w * w.h * 4);
    this.tex = new THREE.DataTexture(this.data, w.w, w.h, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;
  }

  mark(r) {
    const d = this.dirty;
    if (!d) this.dirty = { ...r };
    else {
      d.x0 = Math.min(d.x0, r.x0);
      d.y0 = Math.min(d.y0, r.y0);
      d.x1 = Math.max(d.x1, r.x1);
      d.y1 = Math.max(d.y1, r.y1);
    }
  }
  markAll() {
    const w = this.game.world;
    this.mark({ x0: 0, y0: 0, x1: w.w - 1, y1: w.h - 1 });
    if (this.fallback) this._hd = { x0: 0, y0: 0, x1: w.w - 1, y1: w.h - 1 };
  }

  _hook() {
    const t = this.game.terrain;
    if (t && typeof t.setOverlay === 'function') {
      try {
        t.setOverlay(this.tex);
        this.hooked = true;
        if (this.fallback) {
          this.game.scene.remove(this.fallback);
          this.fallback.geometry.dispose();
          this.fallback = null;
        }
        return;
      } catch (e) {
        console.warn('[civ] setOverlay failed, using fallback', e);
      }
    }
    if (!this.fallback) this._makeFallback();
  }

  update() {
    if (!this.hooked && !this._tried) {
      this._tried = true;
      this._hook();
    }
    const civ = this.game.civ;
    if (civ && civ.colorVersion !== this._colorVer) {
      this._colorVer = civ.colorVersion;
      this.markAll();
    }
    if (this.dirty) this._refresh();
    if (this.fallback) this._updateFallback();
  }

  _refresh() {
    const w = this.game.world;
    const civ = this.game.civ;
    const r = this.dirty;
    this.dirty = null;
    const cols = new Map();
    for (let ty = r.y0; ty <= r.y1; ty++)
      for (let tx = r.x0; tx <= r.x1; tx++) {
        const i = ty * w.w + tx;
        const o = w.owner[i];
        const k = i * 4;
        if (o < 0 || w.height[i] < SEA_LEVEL) {
          this.data[k + 3] = 0;
          continue;
        }
        let rgb = cols.get(o);
        if (!rgb) {
          // heraldic colour as sRGB bytes
          const hex = civ?.kingdomColor?.(o) ?? 0xffffff;
          rgb = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
          cols.set(o, rgb);
        }
        this.data[k] = rgb[0];
        this.data[k + 1] = rgb[1];
        this.data[k + 2] = rgb[2];
        const war = civ?.warCount?.(o) > 0;
        this.data[k + 3] = war ? 170 : 150;
      }
    this.tex.needsUpdate = true;
  }

  // ------------------------------------------------------------ fallback mesh
  _makeFallback() {
    const g = this.game;
    const w = g.world;
    const geo = new THREE.PlaneGeometry(w.w, w.h, w.w, w.h);
    geo.rotateX(-Math.PI / 2);
    geo.translate(w.w / 2, 0, w.h / 2);
    this.fbGeo = geo;
    this._hd = { x0: 0, y0: 0, x1: w.w - 1, y1: w.h - 1 };
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      uniforms: { uTex: { value: this.tex }, uSize: { value: new THREE.Vector2(w.w, w.h) }, uTime: { value: 0 } },
      vertexShader: `varying vec2 vXZ; void main(){ vXZ = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform sampler2D uTex; uniform vec2 uSize; uniform float uTime; varying vec2 vXZ;
        vec4 at(vec2 t){ return texture2D(uTex, (floor(t) + 0.5) / uSize); }
        void main(){
          vec2 t = vXZ;
          vec4 c = at(t);
          vec2 f = fract(t);
          float edge = 0.0;
          vec3 ec = c.rgb;
          vec4 nl = at(t + vec2(-1.0, 0.0)), nr = at(t + vec2(1.0, 0.0)), nd = at(t + vec2(0.0, -1.0)), nu = at(t + vec2(0.0, 1.0));
          float lw = 0.16;
          if (c.a > 0.0) {
            if (distance(nl, c) > 0.01) edge = max(edge, 1.0 - smoothstep(0.0, lw, f.x));
            if (distance(nr, c) > 0.01) edge = max(edge, 1.0 - smoothstep(0.0, lw, 1.0 - f.x));
            if (distance(nd, c) > 0.01) edge = max(edge, 1.0 - smoothstep(0.0, lw, f.y));
            if (distance(nu, c) > 0.01) edge = max(edge, 1.0 - smoothstep(0.0, lw, 1.0 - f.y));
          }
          float a = c.a * 0.32 + edge * 0.85;
          if (a < 0.003) discard;
          vec3 lc = pow(c.rgb, vec3(2.2));
          vec3 col = mix(lc, mix(lc, vec3(1.0), 0.35), edge);
          gl_FragColor = vec4(col, a);
          #include <colorspace_fragment>
        }`,
    });
    this.fallback = new THREE.Mesh(geo, mat);
    this.fallback.renderOrder = 1;
    this.fallback.frustumCulled = false;
    g.scene.add(this.fallback);
  }

  _heightDirty(r) {
    if (!this.fallback) return;
    const d = this._hd;
    if (!d) this._hd = { ...r };
    else {
      d.x0 = Math.min(d.x0, r.x0);
      d.y0 = Math.min(d.y0, r.y0);
      d.x1 = Math.max(d.x1, r.x1);
      d.y1 = Math.max(d.y1, r.y1);
    }
  }

  _updateFallback() {
    this.fallback.material.uniforms.uTime.value = this.game.time.realTime;
    const r = this._hd;
    if (!r) return;
    this._hd = null;
    const w = this.game.world;
    const pos = this.fbGeo.attributes.position;
    const W1 = w.w + 1;
    for (let y = Math.max(0, r.y0 - 1); y <= Math.min(w.h, r.y1 + 2); y++)
      for (let x = Math.max(0, r.x0 - 1); x <= Math.min(w.w, r.x1 + 2); x++) {
        const i = y * W1 + x;
        pos.setY(i, Math.max(SEA_LEVEL, w.heightAt(x, y)) + 0.05);
      }
    pos.needsUpdate = true;
    this.fbGeo.computeBoundingSphere();
  }

  dispose() {
    if (this.fallback) this.game.scene.remove(this.fallback);
  }
}
