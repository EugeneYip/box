import * as THREE from 'three';
import { Pass } from 'postprocessing';
import { SEA_LEVEL } from '../../world/constants.js';

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

const _pm = new THREE.Matrix4();
const _fr = new THREE.Frustum();
const _d = new THREE.Vector3();
const _b = new THREE.Box3();

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
  // Ships and carts move too (Fleets): drawn in the dynamic pass with their
  // own depth materials (animated sails and oars, hidden model variants).
  fleetRoot() {
    return this.game.fleetRenderer?.group || null;
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
    let refresh = changed || modeFlip || !this.valid || !sizeOk || worldDue || heartbeat || this.game.frame < 4;
    const stale = !refresh && !far && this._cullStale();
    refresh = refresh || stale;
    // refresh-trigger counters (inspect game.atmosphere.shadowCache.stats)
    const st = this.stats || (this.stats = { frames: 0, refresh: 0, changed: 0, world: 0, heartbeat: 0, invalid: 0, culled: 0 });
    st.frames++;
    if (refresh) {
      st.refresh++;
      if (changed) st.changed++;
      else if (!this.valid || !sizeOk) st.invalid++;
      else if (worldDue) st.world++;
      else if (heartbeat) st.heartbeat++;
      else if (stale) st.culled++;
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
      off(this.fleetRoot());
      // power saver: the terrain (hundreds of chunks on big maps) receives
      // but does not cast; trees and buildings still give the land depth
      if (ps) off(this.game.terrain?.group || this.game.scene.getObjectByName('terrain'));
      if (this.cullList) this.cullList.length = 0;
      if (this.farMode) {
        const g = this.game;
        off(g.vegetation?.group || g.scene.getObjectByName('vegetation'));
        off(g.buildings?.group || g.scene.getObjectByName('civ-buildings'));
        // the whole map in view: the terrain's own cast shadows are a pixel or
        // two at most, while each of its chunks (a hundred and more on big
        // maps) is a draw call in every refresh; relief comes from its
        // shading instead (docs/WORLD-SCALE.md: shadows only near the camera)
        off(g.terrain?.group || g.scene.getObjectByName('terrain'));
      } else if (!ps) {
        this._cullTerrain();
        this._takeTerrain();
      }
    } else {
      sh.needsUpdate = false;
      this.phase = sizeOk ? 'cached' : null;
    }
  }

  // (round 33) Terrain chunks whose shadow cannot reach the view stay out of
  // the static shadow pass. A chunk's shadow falls away from the sun, so the
  // chunk's box swept along the light down to the lowest ground must meet
  // the camera's view, widened by a margin for the slack the cached map
  // allows before it is drawn again (the window may slide 1.5% and changes
  // size in 6% steps). The fitted shadow window covers the whole ground
  // footprint of the view plus a margin, so at mid zoom it held a third more
  // chunks than the view itself (35 shadow draws against 26 in the view); a
  // chunk that cannot shade anything on screen is no longer drawn into it.
  _cullTerrain() {
    const T = this.game.terrain;
    const list = (this.cullList = this.cullList || []);
    list.length = 0;
    this.culled = 0;
    if (!T?.chunks || !this._viewFrustum(0.08)) return;
    const test = (mesh, box) => {
      if (!mesh || !mesh.visible || !mesh.castShadow || box.isEmpty()) return;
      // a chunk all deeper than 1.8 under the water casts only onto deep
      // seabed, where sun shadows are faded to a tenth (terrainShader
      // tShFade): left out wherever the view is
      const deep = box.max.y < SEA_LEVEL - 1.8;
      if (!deep && this._shadesView(box)) return;
      mesh.castShadow = false;
      this.dyn.push(mesh); // (restored after the capture, with the units)
      if (!deep) list.push(box);
      this.culled++;
    };
    for (const c of T.chunks) test(c.mesh, c.box);
    for (const b of T.blocks || []) test(b.mesh, b.box);
  }

  // (round 35) The terrain chunks still casting after the cull (25-30 at mid
  // zoom on Medium, each a draw call in every refresh) are left out of
  // three's shadow pass and drawn into the map as one merged mesh of their
  // own geometry (composite), so the shadows are exactly as before. Chunks
  // drawn through a transform (none today) stay with three's pass.
  _takeTerrain() {
    const T = this.game.terrain;
    const list = (this.mergeList = this.mergeList || []);
    list.length = 0;
    if (!T?.chunks || this.noMerge) return;
    const take = (m) => {
      if (!m || !m.visible || !m.castShadow || !m.geometry?.index || !m.geometry.attributes.position) return;
      for (let p = m.parent; p; p = p.parent) if (!p.visible) return;
      const e = m.matrixWorld.elements;
      if (e[0] !== 1 || e[5] !== 1 || e[10] !== 1 || e[12] !== 0 || e[13] !== 0 || e[14] !== 0 || e[1] || e[2] || e[4] || e[6] || e[8] || e[9]) return;
      m.castShadow = false;
      this.dyn.push(m); // (restored after the capture, with the units)
      list.push(m);
    };
    for (const c of T.chunks) take(c.mesh);
    for (const b of T.blocks || []) take(b.mesh);
  }

  // the merged terrain caster: the taken chunks inside the shadow window,
  // their positions and indices copied into one geometry, drawn with the
  // same depth material and culling side as three's pass
  _drawTerrain(renderer, sh, map) {
    const list = this.mergeList;
    if (!list || !list.length) return;
    const cam = sh.camera;
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _fr.setFromProjectionMatrix(_pm);
    let nv = 0,
      ni = 0;
    const use = [];
    for (const m of list) {
      const geo = m.geometry;
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      if (!_fr.intersectsSphere(geo.boundingSphere)) continue;
      use.push(m);
      nv += geo.attributes.position.count;
      ni += geo.index.count;
    }
    list.length = 0;
    if (!use.length) return;
    let mg = this.mergeGeo;
    if (!mg || mg.userData.nv < nv || mg.userData.ni < ni) {
      mg?.dispose();
      mg = this.mergeGeo = new THREE.BufferGeometry();
      const cv = Math.ceil(nv * 1.25),
        ci = Math.ceil(ni * 1.25);
      mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cv * 3), 3));
      mg.setIndex(new THREE.BufferAttribute(new Uint32Array(ci), 1));
      mg.userData = { nv: cv, ni: ci };
      if (!this.mergeMesh) {
        this.mergeScene = Object.assign(new THREE.Scene(), { matrixWorldAutoUpdate: false });
        this.mergeScene.overrideMaterial = this.dynScene.overrideMaterial;
        this.mergeMesh = new THREE.Mesh(mg, this.dynScene.overrideMaterial);
        this.mergeMesh.frustumCulled = false;
        this.mergeMesh.matrixAutoUpdate = false;
        this.mergeScene.add(this.mergeMesh);
      } else this.mergeMesh.geometry = mg;
    }
    const P = mg.attributes.position.array,
      I = mg.index.array;
    let ov = 0,
      oi = 0;
    for (const m of use) {
      const geo = m.geometry;
      const src = geo.attributes.position.array,
        cnt = geo.attributes.position.count;
      P.set(cnt * 3 === src.length ? src : src.subarray(0, cnt * 3), ov * 3);
      const idx = geo.index.array,
        n = geo.index.count;
      for (let k = 0; k < n; k++) I[oi + k] = idx[k] + ov;
      ov += cnt;
      oi += n;
    }
    mg.attributes.position.needsUpdate = true;
    mg.attributes.position.updateRanges.length = 0;
    mg.attributes.position.addUpdateRange(0, ov * 3);
    mg.index.needsUpdate = true;
    mg.index.updateRanges.length = 0;
    mg.index.addUpdateRange(0, oi);
    mg.setDrawRange(0, oi);
    renderer.setRenderTarget(map);
    renderer.render(this.mergeScene, cam);
  }

  // the camera's view frustum, widened by `slack` of the shadow window's
  // size (plus two tiles); the light's direction toward the ground
  _viewFrustum(slack) {
    const cam = this.game.cameraRig?.camera;
    if (!cam) return false;
    cam.updateMatrixWorld();
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _fr.setFromProjectionMatrix(_pm);
    const sc = this.light.shadow.camera;
    const margin = slack * Math.max(sc.right - sc.left, sc.top - sc.bottom) + 2;
    for (const p of _fr.planes) p.constant += margin;
    _d.subVectors(this.light.target.position, this.light.position).normalize();
    return true;
  }

  // whether a box or its shadow on the lowest ground can fall in that view
  _shadesView(box) {
    const yLow = -1.5;
    const drop = Math.max(0, box.max.y - yLow) / Math.max(0.12, -_d.y);
    const ox = _d.x * drop,
      oz = _d.z * drop;
    _b.min.set(Math.min(box.min.x, box.min.x + ox), yLow, Math.min(box.min.z, box.min.z + oz));
    _b.max.set(Math.max(box.max.x, box.max.x + ox), box.max.y, Math.max(box.max.z, box.max.z + oz));
    return _fr.intersectsBox(_b);
  }

  // A chunk left out of the cached map whose shadow could now reach the
  // view (the camera turned or slid without moving the shadow window
  // enough to redraw it): the map is drawn again at once, so a shadow never
  // pops in late at the edge of the screen.
  _cullStale() {
    const list = this.cullList;
    if (!list || !list.length || !this._viewFrustum(0.02)) return false;
    for (const box of list) if (this._shadesView(box)) return true;
    return false;
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
        this._drawTerrain(renderer, sh, map);
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
      const froot = this.fleetRoot();
      if (froot && froot.visible && near) {
        const fs = this.fleetScene || (this.fleetScene = Object.assign(new THREE.Scene(), { matrixWorldAutoUpdate: false }));
        const list = fs.children;
        list.length = 0;
        const swapped = [];
        froot.traverseVisible((o) => {
          if (!o.castShadow || !o.isMesh || (o.isInstancedMesh && o.count === 0)) return;
          swapped.push([o, o.material]);
          o.material = o.customDepthMaterial || this.dynScene.overrideMaterial;
          list.push(o);
        });
        try {
          if (list.length) {
            renderer.setRenderTarget(map);
            renderer.render(fs, sh.camera);
            this.mapHasDyn = true;
          }
        } finally {
          for (const [o, m] of swapped) o.material = m;
          list.length = 0;
        }
      }
    } catch (err) {
      console.warn('[atmosphere] shadow cache disabled', err);
      this.disabled = true;
    }
    renderer.autoClear = prevAuto;
    renderer.setRenderTarget(prevTarget);
  }
}
