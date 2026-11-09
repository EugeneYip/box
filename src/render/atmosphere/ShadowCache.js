import * as THREE from 'three';
import { Pass } from 'postprocessing';

// Static / dynamic split of the key light's shadow map.
//
// The expensive static casters (terrain, trees, buildings) are rendered into
// the shadow map only when it must change: the fitted light frustum moved, the
// world changed (rate limited), or a slow heartbeat for growth. That result is
// cached. Every other frame the cache is restored into the light's shadow map
// (colour + depth, via gl_FragDepth) and only the dynamic casters (units) are
// drawn on top with depth testing. This removes the periodic full shadow
// redraw spikes while keeping unit shadows exact every frame.
//
// Hook point: the sky dome's onBeforeRender, which three calls inside the
// main render after its shadow pass and before anything else is drawn (the
// same nested-render pattern three's Reflector uses).

const COPY_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const RESTORE_FRAG = /* glsl */ `
#include <packing>
uniform sampler2D tSrc;
varying vec2 vUv;
void main() {
  vec4 p = texture2D(tSrc, vUv);
  gl_FragColor = p;
  gl_FragDepth = unpackRGBAToDepth(p);
}
`;
const COPY_FRAG = /* glsl */ `
uniform sampler2D tSrc;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(tSrc, vUv); }
`;

export class ShadowCache {
  constructor(atmosphere) {
    this.atm = atmosphere;
    this.game = atmosphere.game;
    this.light = atmosphere.key;
    this.light.shadow.autoUpdate = false;
    this.rt = null;
    this.valid = false;
    this.phase = null; // 'capture' | 'cached' while a frame is in flight
    this.sinceRefresh = 1e9;
    this.worldDirty = 1; // frames to wait before a world-change refresh (0 = clean)
    this.dyn = [];
    const mk = (frag, depth) =>
      new THREE.Mesh(
        Pass.fullscreenGeometry,
        new THREE.ShaderMaterial({
          uniforms: { tSrc: { value: null } },
          vertexShader: COPY_VERT,
          fragmentShader: frag,
          depthTest: depth,
          depthWrite: depth,
          depthFunc: THREE.AlwaysDepth,
          blending: THREE.NoBlending,
        }),
      );
    this.restoreScene = new THREE.Scene();
    this.restoreQuad = mk(RESTORE_FRAG, true);
    this.restoreQuad.frustumCulled = false;
    this.restoreScene.add(this.restoreQuad);
    this.copyScene = new THREE.Scene();
    this.copyQuad = mk(COPY_FRAG, false);
    this.copyQuad.frustumCulled = false;
    this.copyScene.add(this.copyQuad);
    this.quadCam = new THREE.Camera();
    this.dynScene = new THREE.Scene();
    // same packing and culling side three uses for directional shadow maps
    this.dynScene.overrideMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.BackSide });
    this.dynScene.matrixWorldAutoUpdate = false;
    // Terrain reshaping refreshes quickly. Field / road tile changes and
    // flora growth or felling churn constantly in a grown world and barely
    // change the shadows: they only mark the map stale for a slow (2 s)
    // refresh, as does building construction via the heartbeat.
    const shape = () => (this.worldDirty = Math.min(this.worldDirty || 1e9, 8));
    const churn = () => (this.worldDirty = Math.min(this.worldDirty || 1e9, 120));
    for (const e of ['world:height', 'world:regenerated']) this.game.events.on(e, shape);
    for (const e of ['world:type', 'world:flora']) this.game.events.on(e, churn);
  }

  dynamicRoot() {
    return this.game.unitRenderer?.group || this.game.scene.getObjectByName('units');
  }

  // Called before the frame is drawn. `changed` = the fitted frustum moved.
  begin(renderer, changed) {
    const sm = renderer.shadowMap;
    sm.autoUpdate = false;
    const sh = this.light.shadow;
    this.sinceRefresh++;
    const sizeOk = this.rt && sh.map && this.rt.width === sh.map.width && this.rt.height === sh.map.height;
    const worldDue = this.worldDirty && this.sinceRefresh >= this.worldDirty;
    const heartbeat = this.sinceRefresh >= 240;
    const ps = this.game.settings?.powerSaver;
    const far = (this.game.view?.zoom01 ?? 0) > (this.farMode ? 0.76 : 0.82) - (ps ? 0.3 : 0);
    const modeFlip = far !== !!this.farMode;
    this.farMode = far;
    const refresh = changed || modeFlip || !this.valid || !sizeOk || worldDue || heartbeat || this.game.frame < 4;
    // refresh-trigger counters (inspect game.atmosphere.shadowCache.stats)
    const st = this.stats || (this.stats = { frames: 0, refresh: 0, changed: 0, world: 0, heartbeat: 0, invalid: 0 });
    st.frames++;
    if (refresh) {
      st.refresh++;
      if (changed) st.changed++;
      else if (!this.valid || !sizeOk) st.invalid++;
      else if (worldDue) st.world++;
      else if (heartbeat) st.heartbeat++;
    }
    for (const o of this.dyn) o.castShadow = true; // safety: never leave flags off
    this.dyn.length = 0;
    if (refresh) {
      sh.needsUpdate = true;
      sm.needsUpdate = true;
      this.phase = 'capture';
      this.worldDirty = 0;
      this.sinceRefresh = 0;
      // keep dynamic casters out of the cached map; when the whole map is in
      // view, trees and buildings (1-2 px shadows) are left out as well
      this.dyn.length = 0;
      const off = (root) =>
        root?.traverse((o) => {
          if (o.castShadow) {
            o.castShadow = false;
            this.dyn.push(o);
          }
        });
      off(this.dynamicRoot());
      // power saver: the terrain (hundreds of chunks on big maps) receives
      // but does not cast; trees and buildings still give the land depth
      if (ps) off(this.game.terrain?.group || this.game.scene.getObjectByName('terrain'));
      if (this.farMode) {
        const g = this.game;
        off(g.vegetation?.group || g.scene.getObjectByName('vegetation'));
        off(g.buildings?.group || g.scene.getObjectByName('civ-buildings'));
      }
    } else {
      sh.needsUpdate = false;
      this.phase = sizeOk ? 'cached' : null;
    }
  }

  // Inside the main render, after three's shadow pass.
  composite(renderer) {
    const phase = this.phase;
    if (!phase) return;
    this.phase = null;
    const sh = this.light.shadow;
    const map = sh.map;
    if (!map) return;
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    try {
      if (phase === 'capture') {
        for (const o of this.dyn) o.castShadow = true;
        this.dyn.length = 0;
        if (!this.rt || this.rt.width !== map.width || this.rt.height !== map.height) {
          this.rt?.dispose();
          this.rt = new THREE.WebGLRenderTarget(map.width, map.height, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
          this.rt.texture.name = 'StaticShadowCache';
        }
        this.copyQuad.material.uniforms.tSrc.value = map.texture;
        renderer.setRenderTarget(this.rt);
        renderer.render(this.copyScene, this.quadCam);
        this.valid = true;
        this.mapHasDyn = false;
      } else if (this.mapHasDyn) {
        // last frame's units are baked into the map: restore the static copy
        this.restoreQuad.material.uniforms.tSrc.value = this.rt.texture;
        renderer.setRenderTarget(map);
        renderer.render(this.restoreScene, this.quadCam);
        this.mapHasDyn = false;
      }
      // dynamic casters on top, depth tested against the static map.
      // Zoomed far out units are a few pixels tall: their shadows are
      // skipped (and the clean static map is kept as is).
      const root = this.dynamicRoot();
      const near = this.game.cameraRig.cur.dist < 40 && !this.game.settings?.powerSaver;
      if (root && root.visible && near) {
        const list = this.dynScene.children;
        list.length = 0;
        root.traverseVisible((o) => {
          if (o.castShadow && o.isMesh) list.push(o); // borrowed: parent untouched
        });
        if (list.length) {
          renderer.setRenderTarget(map);
          renderer.render(this.dynScene, sh.camera);
          this.mapHasDyn = true;
        }
        list.length = 0;
      }
    } catch (err) {
      console.warn('[atmosphere] shadow cache disabled', err);
      this.disabled = true;
    }
    renderer.autoClear = prevAuto;
    renderer.setRenderTarget(prevTarget);
  }
}
