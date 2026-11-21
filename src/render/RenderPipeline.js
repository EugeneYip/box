import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, SMAAPreset, EdgeDetectionMode, BlendFunction, FXAAEffect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { LinearDepthPass } from './atmosphere/post/LinearDepthPass.js';
import { AtmosphereEffect } from './atmosphere/post/AtmosphereEffect.js';
import { MiniatureDOF } from './atmosphere/post/MiniatureDOF.js';
import { GradeEffect } from './atmosphere/post/GradeEffect.js';

// Owns the WebGLRenderer and the final frame composition (post-processing).
//
// PUBLIC CONTRACT
//   game.pipeline.renderer          the only WebGLRenderer (nobody else makes one)
//   game.pipeline.quality           'low' | 'medium' | 'high' | 'ultra'
//   game.pipeline.setQuality(q)     switch tier at runtime (UI settings)
//   game.pipeline.size              Vector2 CSS-pixel viewport size
//   game.pipeline.resize(w, h)      called by Game on window resize
//   game.pipeline.flash(color, k)   additive full-screen flash, decays quickly
//   game.pipeline.addPass(pass)     insert a pmndrs postprocessing Pass into the
//                                   HDR chain (after AO + haze, before depth of
//                                   field / bloom / grade). Sample
//                                   pipeline.linearDepthTexture for depth (R =
//                                   linear view distance; never the composer's
//                                   depth attachment, which can feedback-loop).
//   game.pipeline.removePass(pass)
//   game.pipeline.beforeRender      array of fn(renderer, dt) run each frame
//                                   before the scene is drawn (offscreen work)
//   game.pipeline.passInfo()        {composer, enabled: [...pass names]}
//
// Detail by zoom and power saving (round 5): as game.view.zoom01 rises the
// pipeline drops AO (and DOF, via the atmosphere's focus params);
// game.settings.powerSaver (event 'powersaver') disables AO and DOF, the
// atmosphere halves the shadow map, and the 3D view renders at 0.75x
// resolution. The canvas (drawing buffer) is never resized for this:
// resizing it stalls for seconds on some GPUs and drivers. Only the
// composer's render targets shrink, and the final pass upscales into the
// full-size canvas, so the DOM UI stays sharp. The switch is applied shortly
// after the toggle, once the camera is still. Dynamic resolution scaling
// (opt-in via game.settings.dynamicResolution) uses the same composer scale.
// The low tier (no composer) keeps its full resolution.
//
// Frame (medium and up):
//   Render (HDR half-float) -> linear depth -> N8AO (high+) -> aerial haze /
//   mist / cloud shadows -> [extra passes] -> miniature DOF + bloom + tone
//   map + grade + vignette -> SMAA (high+) or FXAA (medium), dithered
// Low tier, or if anything fails to initialise: direct render with MSAA,
// ACES tone mapping and THREE.Fog matched to the horizon.

// Pass budget per frame (excluding the scene, shadow map and the tiny cloud
// coverage splat):
//   low    : 0 post passes (direct render, MSAA canvas, THREE.Fog)
//   medium : ~9   linear depth, haze, DOF x3 (half res), bloom x7 (quarter
//                 res and below), lens, FXAA. No AO.
//   high   : ~19  + half-res N8AO (1 denoise iteration), SMAA instead of FXAA
//   ultra  : ~24  full-res N8AO (2 denoise iterations), more bloom levels,
//                 MSAA x4 + SMAA, 4096 shadow map
// power-saver resolution factor (on top of the tier's pixel ratio)
const SAVER_SCALE = 0.75;

export const QUALITY_TIERS = {
  low: { pixelRatio: 1, post: false, shadowMap: 1024, ao: null, dof: 0, bloomLevels: 0, aa: null, msaa: 0 },
  medium: { pixelRatio: 1, post: true, shadowMap: 2048, ao: null, dof: 12, bloomLevels: 4, aa: 'fxaa', msaa: 0 },
  high: { pixelRatio: 1.5, post: true, shadowMap: 2048, ao: { halfRes: true, aoSamples: 12, denoiseSamples: 8, denoiseRadius: 8, denoiseIterations: 1 }, dof: 24, bloomLevels: 5, aa: 'HIGH', msaa: 0 },
  ultra: { pixelRatio: 2, post: true, shadowMap: 4096, ao: { halfRes: false, aoSamples: 24, denoiseSamples: 8, denoiseRadius: 6, denoiseIterations: 2 }, dof: 36, bloomLevels: 7, aa: 'ULTRA', msaa: 4 },
};

export class RenderPipeline {
  constructor(game, container) {
    this.game = game;
    let q = game.params.quality;
    if (!QUALITY_TIERS[q]) q = matchMedia('(pointer: coarse)').matches ? 'medium' : 'high';
    this.quality = q;
    this.tier = QUALITY_TIERS[q];
    const renderer = new THREE.WebGLRenderer({
      antialias: q === 'low',
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
      stencil: false,
      alpha: false,
    });
    // (looked up now, so the page teardown can drop the context without a
    // round trip to the GPU side: see Game.dispose)
    this._loseExt = renderer.getContext().getExtension('WEBGL_lose_context');
    this.dynScale = 1; // dynamic resolution factor (opt-in)
    this.saverScale = game.settings?.powerSaver ? SAVER_SCALE : 1; // applied power-saver resolution factor
    this._saverT = 0; // seconds since the saver was toggled
    this._stillT = 0; // seconds the camera has not moved
    this._camSig = new Float32Array(7);
    this._appliedScale = 1;
    this._dt = [];
    this._drsT = 0;
    renderer.setPixelRatio(this.targetPixelRatio());
    renderer.setSize(innerWidth, innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    renderer.domElement.id = 'game-canvas';
    this.renderer = renderer;
    this.size = new THREE.Vector2(innerWidth, innerHeight);
    this.composer = null;
    this.failed = false;
    this.userPasses = [];
    this.beforeRender = [];
    this._flash = new THREE.Vector3();
    this._fog = new THREE.Fog(0x9fc6e8, 300, 900);
    game.events?.on?.('powersaver', () => {
      // no resize here: updateSaverResolution() applies it at a calm moment
      this._saverT = 0;
    });
    this.linearDepthTexture = null;
    const gl = renderer.getContext();
    this.floatTargets = renderer.capabilities.isWebGL2 && !!(renderer.extensions.has('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_float'));
    if (!this.floatTargets && this.tier.post) {
      console.warn('[pipeline] float render targets unavailable: using the low tier');
      this.failed = true;
    }
  }

  get postActive() {
    return !!this.composer;
  }

  setQuality(q) {
    if (!QUALITY_TIERS[q] || q === this.quality) return;
    this.quality = q;
    this.tier = QUALITY_TIERS[q];
    this.destroyComposer();
    if (this.floatTargets) this.failed = false;
    this.renderer.setPixelRatio(this.targetPixelRatio());
    this.renderer.setSize(this.size.x, this.size.y);
    this.game.events?.emit?.('quality', { quality: q });
  }

  get powerSaver() {
    return !!this.game.settings?.powerSaver;
  }

  // canvas pixel ratio: only the tier and the device (never the saver or
  // dynamic resolution, which scale the composer's targets instead)
  targetPixelRatio() {
    return Math.max(0.5, Math.min(devicePixelRatio || 1, this.tier.pixelRatio));
  }

  // composer resolution factor (power saver x dynamic resolution)
  get renderScale() {
    return this.saverScale * this.dynScale;
  }

  // Size the composer's targets to the drawing buffer times renderScale.
  // The canvas keeps its size; the final pass upscales into it.
  sizeComposer() {
    const C = this.composer;
    if (!C) return;
    const db = this.renderer.getDrawingBufferSize(this._db || (this._db = new THREE.Vector2()));
    const s = this.renderScale;
    const w = Math.max(1, Math.round(db.x * s));
    const h = Math.max(1, Math.round(db.y * s));
    this._appliedScale = s;
    if (C.inputBuffer.width === w && C.inputBuffer.height === h) return;
    C.inputBuffer.setSize(w, h);
    C.outputBuffer.setSize(w, h);
    for (const pass of C.passes) pass.setSize(w, h);
  }

  // Power-saver resolution, applied off the toggle: once the saver has been
  // on (or off) for a moment and the camera has been still briefly, switch
  // the pixel ratio in a single step. The one GPU sync that a drawing-buffer
  // resize costs then lands on a still frame instead of the button press.
  updateSaverResolution(dt) {
    const want = this.powerSaver ? SAVER_SCALE : 1;
    const cam = this.game.cameraRig?.camera;
    if (cam) {
      const e = cam.matrixWorld.elements;
      const sig = this._camSig;
      const now = [e[12], e[13], e[14], e[8], e[9], e[10], cam.fov || 0];
      let moved = 0;
      for (let i = 0; i < 7; i++) {
        moved = Math.max(moved, Math.abs(now[i] - sig[i]));
        sig[i] = now[i];
      }
      this._stillT = moved > 1e-3 ? 0 : this._stillT + dt;
    }
    this._saverT += dt;
    if (want === this.saverScale) return;
    const wait = want < 1 ? 1.5 : 0.5; // getting sharp again is wanted sooner
    if (this._saverT < wait || this._stillT < 0.3) return;
    this.saverScale = want;
    this.applyPixelRatio();
  }

  // apply the composer scale (only the composer's targets are reallocated)
  applyPixelRatio() {
    if (this.composer && this._appliedScale !== this.renderScale) this.sizeComposer();
  }

  // Dynamic resolution: keep the rolling frame time inside the budget.
  updateDynamicResolution(dt) {
    const on = !!this.game.settings?.dynamicResolution; // opt-in: each resize syncs the GPU
    if (!on) {
      if (this.dynScale !== 1) {
        this.dynScale = 1;
        this.applyPixelRatio();
      }
      return;
    }
    const cap = this.game.settings?.fpsCap || (this.powerSaver ? 30 : 60);
    const budget = 1 / cap;
    this._dt.push(dt);
    if (this._dt.length > 45) this._dt.shift();
    this._drsT += dt;
    if (this._dt.length < 30) return;
    const avg = this._dt.reduce((a, b) => a + b, 0) / this._dt.length;
    let next = this.dynScale;
    if (avg > budget * 1.3 && this._drsT > 1.5) next = Math.max(0.6, this.dynScale * 0.85);
    else if (avg < budget * 1.08 && this._drsT > 6) next = Math.min(1, this.dynScale * 1.1);
    if (next !== this.dynScale) {
      this.dynScale = next;
      this._drsT = 0;
      this._dt.length = 0;
      this.applyPixelRatio();
    }
  }

  // Once, shortly after boot: render one extra composer frame with AO
  // flipped so the pass-chain variants used by the power saver / far zoom
  // (AO off) are compiled now rather than when the player toggles.
  warmVariants() {
    if (this._variantsWarm || !this.composer || (this.game.frame || 0) < 8) return;
    this._variantsWarm = true;
    const ao = this.passes?.ao;
    if (!ao) return;
    // only the post chain needs compiling: the scene pass draws nothing (no
    // camera layer enabled), so this frame costs the post passes alone
    // instead of a second full scene (it used to double one frame's draws)
    // (the shadow map is left alone: it would be drawn empty for the masked
    // camera; and this runs before the frame's real render, which then
    // overwrites the screen)
    const cam = this.game.cameraRig.camera;
    const mask = cam.layers.mask;
    const sm = this.renderer.shadowMap;
    const au = sm.autoUpdate,
      nu = sm.needsUpdate;
    try {
      cam.layers.disableAll();
      sm.autoUpdate = false;
      sm.needsUpdate = false;
      ao.enabled = !ao.enabled;
      this.composer.render(0);
    } catch (err) {
      console.warn('[pipeline] variant warm-up skipped', err);
    } finally {
      ao.enabled = !ao.enabled;
      cam.layers.mask = mask;
      sm.autoUpdate = au;
      sm.needsUpdate = nu;
    }
  }

  // Shader warm-up (round 23, reworked in round 25): from shortly after boot,
  // in small batches in idle time, compile the shader programs of every
  // material in the scene, hidden ones included (the levels of detail, dots
  // and markers first seen at mid zoom or in the overview), so the first
  // zoom out does not stall for many seconds on shader compiles. Programs are
  // compiled for the render target the scene is drawn into (the composer's
  // input buffer: linear output, no tone mapping), as in a frame.
  // Each batch issues at most one new program (six with
  // KHR_parallel_shader_compile) and waits on a GPU fence before the next, so
  // the GPU side never holds a long queue of compiles: a frame that needs a
  // program of its own (or a page that is leaving) waits for one compile at
  // most, never for the whole set at once (round 24: without the extension
  // the one-shot warm-up blocked the page for 26 s). Every few seconds the
  // scene is looked over again and any material that has no program yet (a
  // new era's buildings and vehicles, new effects) is warmed the same way.
  // (?warm=0 turns it off, for measuring)
  warmPrograms() {
    if (this._progWarm || (this.game.frame || 0) < 24) return;
    this._progWarm = true;
    if (typeof location !== 'undefined' && /[?&]warm=0\b/.test(location.search)) return;
    const r = this.renderer;
    const gl = r.getContext();
    if (!r.compile || !gl.fenceSync) return;
    this._warmQ = [];
    this._warmed = new WeakMap();
    this._warmPar = !!r.extensions?.has?.('KHR_parallel_shader_compile');
    this._warmFull = false; // (round 27) the first look: what is shown now
    this._warmKey = this._warmBandKey();
    this._warmScanAt = 0;
    this.warmInfo = { programs0: r.info.programs?.length ?? 0, batches: 0, compiled: 0, scans: 0, parallel: this._warmPar, t0: performance.now() };
    this._warmLater(0, true);
  }

  // The camera band (close, mid, overview) and the newest era: the warm-up
  // looks over hidden objects (other bands' levels of detail, dots and
  // markers, other eras' models) only when one of these changes.
  _warmBandKey() {
    const d = this.game.cameraRig?.cur?.dist ?? 0;
    const band = d < 40 ? 0 : d < 110 ? 1 : 2;
    let era = 0;
    for (const k of this.game.civ?.kingdoms || []) if (k.alive && k.era > era) era = k.era;
    return band * 100 + era;
  }

  _warmLater(ms, idle = false) {
    if (this._warmTimer || this.game.disposed) return;
    const run = () => {
      this._warmTimer = 0;
      try {
        this._warmSlice();
      } catch (err) {
        console.warn('[pipeline] program warm-up stopped', err);
        this._warmQ = null;
      }
    };
    this._warmIdle = idle && typeof requestIdleCallback === 'function';
    this._warmTimer = this._warmIdle ? requestIdleCallback(run, { timeout: 2000 }) : setTimeout(run, ms);
  }

  _warmCancel() {
    this._warmQ = null;
    if (!this._warmTimer) return;
    if (this._warmIdle) cancelIdleCallback(this._warmTimer);
    else clearTimeout(this._warmTimer);
    this._warmTimer = 0;
  }

  _warmSlice() {
    const g = this.game;
    if (g.disposed || !this._warmQ) return;
    const r = this.renderer;
    const gl = r.getContext();
    if (gl.isContextLost?.()) return;
    // the previous batch first: its fence signals once the GPU side has
    // compiled it (a non-blocking query, updated between tasks)
    if (this._warmFence) {
      if (gl.getSyncParameter(this._warmFence, gl.SYNC_STATUS) !== gl.SIGNALED) return this._warmLater(50);
      gl.deleteSync(this._warmFence);
      this._warmFence = null;
    }
    const now = performance.now();
    const Q = this._warmQ;
    const W = this._warmed;
    const info = this.warmInfo;
    if (!Q.length) {
      if (now < this._warmScanAt) return this._warmLater(this._warmScanAt - now);
      this._warmScanAt = now + 3000;
      // (round 27) the first look and the regular ones cover what is shown
      // (the current camera band and era); hidden objects are looked over
      // only once the camera moves to a new band or a new era arrives (the
      // round-25 first look compiled everything, hidden or not, and ran for
      // 142 s after boot under software GL)
      const key = this._warmBandKey();
      if (key !== this._warmKey) {
        this._warmKey = key;
        this._warmFull = true;
      }
      info.scans++;
      const full = this._warmFull;
      const props = r.properties;
      const look = (o) => {
        if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite) || !o.material || Array.isArray(o.material)) return;
        if (W.get(o) === o.material) return;
        // (a full look compiles every object's program, as a material can
        // need a variant per object; the others only materials with none yet)
        if (!full && props.get(o.material).currentProgram) return W.set(o, o.material);
        Q.push(o);
      };
      if (full) g.scene.traverse(look);
      else g.scene.traverseVisible(look);
      if (full) info.fullLooks = (info.fullLooks || 0) + 1;
      this._warmFull = false;
      if (!Q.length) {
        if (info.doneS == null) info.doneS = +((now - info.t0) / 1000).toFixed(1);
        return this._warmLater(3000);
      }
    }
    const P = r.info.programs;
    const p0 = P?.length ?? 0;
    const maxNew = this._warmPar ? 6 : 1;
    const cam = g.cameraRig.camera;
    const prev = r.getRenderTarget();
    try {
      r.setRenderTarget(this.composer?.inputBuffer ?? null);
      while (Q.length && performance.now() - now < 6) {
        const o = Q.pop();
        if (!o.parent || W.get(o) === o.material) continue; // gone, or seen through a parent
        W.set(o, o.material);
        try {
          r.compile(o, cam, g.scene);
        } catch (err) {
          /* a material that cannot be compiled ahead is compiled when drawn */
        }
        if ((P?.length ?? 0) - p0 >= maxNew) break;
      }
    } finally {
      r.setRenderTarget(prev);
    }
    const made = (P?.length ?? 0) - p0;
    if (made > 0) {
      info.batches++;
      info.compiled += made;
      this._warmFence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
    }
    this._warmLater(made > 0 ? 50 : 16, !Q.length);
  }

  // (round 27) At most one frame of GPU work in flight. Each frame ends with
  // a GPU fence; while the previous frame's fence has not signalled, the game
  // loop skips drawing (a non-blocking query, updated between tasks). On a
  // fast GPU the fence has long signalled by the next animation frame, so
  // nothing changes there; on a slow one (software GL, a heavy frame) the GPU
  // side never holds a queue of frames, so a page that is leaving, a frame
  // that needs a new program or the next page waits for one frame at most.
  gpuBusy() {
    const f = this._frameFence;
    if (!f) return false;
    const gl = this.renderer.getContext();
    if (gl.isContextLost?.()) {
      this._frameFence = null;
      return false;
    }
    if (gl.getSyncParameter(f, gl.SYNC_STATUS) !== gl.SIGNALED) {
      this.framesHeld = (this.framesHeld || 0) + 1;
      return true;
    }
    gl.deleteSync(f);
    this._frameFence = null;
    return false;
  }

  _fenceFrame() {
    if (this._frameFence) return;
    const gl = this.renderer.getContext();
    if (!gl.fenceSync || gl.isContextLost?.()) return;
    this._frameFence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  }

  // Page hidden (another tab, minimised, leaving): stop issuing GPU work that
  // is not a frame (the shader warm-up); resume() picks it up again.
  suspend() {
    this.suspended = true;
    this._warmCancel?.();
  }

  resume() {
    if (!this.suspended) return;
    this.suspended = false;
    if (this._progWarm && this.warmInfo && !this._warmQ) {
      this._warmQ = [];
      this._warmLater(500, true);
    }
  }

  passInfo() {
    const c = this.composer;
    if (!c) return { composer: false, enabled: [] };
    return { composer: true, enabled: c.passes.filter((p) => p.enabled).map((p) => p.name || p.constructor.name) };
  }

  addPass(pass) {
    if (!this.userPasses.includes(pass)) this.userPasses.push(pass);
    this.destroyComposer();
  }
  removePass(pass) {
    const i = this.userPasses.indexOf(pass);
    if (i >= 0) {
      this.userPasses.splice(i, 1);
      this.destroyComposer();
    }
  }

  flash(color = 0xffffff, intensity = 1) {
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    this._flash.x += c.r * intensity;
    this._flash.y += c.g * intensity;
    this._flash.z += c.b * intensity;
  }

  // ---- composer ---------------------------------------------------------
  build() {
    const game = this.game;
    const scene = game.scene;
    const camera = game.cameraRig.camera;
    const t = this.tier;
    const renderer = this.renderer;
    const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: t.msaa || 0 });
    const p = {};
    p.render = new RenderPass(scene, camera);
    composer.addPass(p.render);
    p.depth = new LinearDepthPass(camera, { float: this.floatTargets });
    composer.addPass(p.depth);
    this.linearDepthTexture = p.depth.texture;

    if (t.ao) {
      try {
        const ao = new N8AOPostPass(scene, camera, this.size.x, this.size.y);
        const c = ao.configuration;
        c.transparencyAware = false; // water / particles: skip the extra scene renders
        c.halfRes = t.ao.halfRes;
        c.aoSamples = t.ao.aoSamples;
        c.denoiseSamples = t.ao.denoiseSamples;
        c.denoiseRadius = t.ao.denoiseRadius;
        c.denoiseIterations = t.ao.denoiseIterations;
        c.depthAwareUpsampling = true;
        c.screenSpaceRadius = false;
        c.aoRadius = 2.5;
        c.distanceFalloff = 1.0;
        c.intensity = 2.5;
        c.color = new THREE.Color(0x2a2438);
        composer.addPass(ao);
        p.ao = ao;
      } catch (err) {
        console.warn('[pipeline] N8AO unavailable', err);
      }
    }

    const atm = game.atmosphere;
    const cloudTex = game.env.cloudShadow?.texture || null;
    p.atmos = new AtmosphereEffect(p.depth.texture, cloudTex);
    composer.addPass(new EffectPass(camera, p.atmos));

    for (const up of this.userPasses) composer.addPass(up);

    const lens = [];
    if (t.dof) {
      p.dof = new MiniatureDOF(p.depth.texture, { samples: t.dof });
      lens.push(p.dof);
    }
    if (t.bloomLevels) {
      p.bloom = new BloomEffect({
        blendFunction: BlendFunction.ADD,
        mipmapBlur: true,
        luminanceThreshold: 1.0,
        luminanceSmoothing: 0.35,
        intensity: 0.6,
        radius: 0.6,
        levels: t.bloomLevels,
      });
      lens.push(p.bloom);
    }
    p.grade = new GradeEffect({ tonemap: 0 });
    lens.push(p.grade);
    p.lens = new EffectPass(camera, ...lens);
    composer.addPass(p.lens);
    if (t.aa === 'fxaa') {
      p.aa = new EffectPass(camera, new FXAAEffect());
      p.aa.dithering = true;
      composer.addPass(p.aa);
    } else if (t.aa) {
      p.smaa = new SMAAEffect({ preset: SMAAPreset[t.aa], edgeDetectionMode: EdgeDetectionMode.COLOR });
      p.aa = new EffectPass(camera, p.smaa);
      p.aa.dithering = true;
      composer.addPass(p.aa);
    } else p.lens.dithering = true;

    this.composer = composer;
    this.passes = p;
    composer.setSize(this.size.x, this.size.y);
    this.sizeComposer();
    // the composer owns tone mapping and fog in this mode
    renderer.toneMapping = THREE.NoToneMapping;
    if (scene.fog === this._fog) scene.fog = null;
    atm?.onPipelineChanged?.(this);
  }

  destroyComposer() {
    if (!this.composer) return;
    try {
      for (const up of this.userPasses) {
        const i = this.composer.passes.indexOf(up);
        if (i >= 0) this.composer.passes.splice(i, 1); // keep user passes alive
      }
      this.composer.dispose();
    } catch (err) {
      console.warn('[pipeline] dispose failed', err);
    }
    this.composer = null;
    this.passes = null;
    this.linearDepthTexture = null;
  }

  resize(w, h) {
    this.size.set(w, h);
    // a resize reallocates every target anyway: settle the saver scale now
    this.saverScale = this.powerSaver ? SAVER_SCALE : 1;
    this.renderer.setSize(w, h);
    if (this.composer) {
      this.composer.setSize(w, h);
      this.sizeComposer();
    }
  }

  // Push the atmosphere's per-frame look parameters into the passes.
  syncPost(dt) {
    const P = this.game.atmosphere?.post;
    const p = this.passes;
    if (!P || !p) return;
    const cam = this.game.cameraRig.camera;
    p.atmos.sync(cam, P.sky, P);
    const H = this.renderer.getDrawingBufferSize(this._v2 || (this._v2 = new THREE.Vector2())).y * (this._appliedScale || 1);
    const ps = this.powerSaver;
    const zoom = this.game.view?.zoom01 ?? 0.5;
    if (p.dof) {
      const d = P.dof;
      const maxCoc = ps ? 0 : (d.maxCoc * (H / 1080)) / 2; // half-res px
      p.dof.setFocus(d.focus, d.band, d.ramp, maxCoc, d.nearBoost);
    }
    if (p.ao) {
      // AO only up close (it reads as noise at map scale) and never in power saver
      const want = !ps && zoom < (p.ao.enabled ? 0.62 : 0.56);
      if (p.ao.enabled !== want) p.ao.enabled = want;
    }
    if (p.bloom) {
      // (bloom mip levels stay fixed per tier: re-levelling at runtime
      // rebuilt its materials and recompiled programs on every toggle)
      p.bloom.luminanceMaterial.threshold = P.bloom.threshold;
      p.bloom.luminanceMaterial.smoothing = P.bloom.smoothing;
      p.bloom.intensity = P.bloom.intensity;
    }
    const g = p.grade.uniforms;
    g.get('uExposure').value = P.exposure;
    g.get('uShadowTint').value.copy(P.shadowTint);
    g.get('uHighTint').value.copy(P.highTint);
    if (P.midTint) g.get('uMidTint').value.copy(P.midTint);
    g.get('uGrade').value.copy(P.grade);
    g.get('uVignette').value.copy(P.vignette);
    g.get('uVignetteColor').value.copy(P.vignetteColor);
    g.get('uFlash').value.copy(P.flash).add(this._flash);
    if (p.ao && P.ao) {
      const c = p.ao.configuration;
      const set = (k, v) => {
        if (Math.abs(c[k] - v) > 1e-3) c[k] = v;
      };
      set('aoRadius', P.ao.radius);
      set('intensity', P.ao.intensity);
      set('distanceFalloff', P.ao.falloff);
    }
  }

  syncFallback() {
    const P = this.game.atmosphere?.post;
    const r = this.renderer;
    const scene = this.game.scene;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    if (!P) return;
    r.toneMappingExposure = P.exposure + (this._flash.x + this._flash.y + this._flash.z) * 0.3;
    if (scene.fog !== this._fog) scene.fog = this._fog;
    this._fog.color.copy(P.fogColor);
    this._fog.near = P.haze.x;
    this._fog.far = P.haze.x + 2.3 / Math.max(1e-4, P.haze.y);
  }

  render(dt) {
    const game = this.game;
    const renderer = this.renderer;
    const k = Math.exp(-dt * 7);
    this._flash.multiplyScalar(k);
    this.updateDynamicResolution(dt);
    this.updateSaverResolution(dt);
    try {
      game.atmosphere?.preRender?.(renderer, dt);
      for (const fn of this.beforeRender) fn(renderer, dt);
    } catch (err) {
      console.error('[pipeline] preRender', err);
    }
    if (!this.composer && this.tier.post && !this.failed) {
      try {
        this.build();
      } catch (err) {
        console.error('[pipeline] post-processing failed to initialise; falling back', err);
        this.failed = true;
        this.destroyComposer();
      }
    }
    if (this.composer) {
      try {
        this.syncPost(dt);
        this.warmVariants();
        this.warmPrograms();
        this.composer.render(dt);
        this._fenceFrame();
        return;
      } catch (err) {
        console.error('[pipeline] post-processing failed; falling back', err);
        this.failed = true;
        this.destroyComposer();
      }
    }
    this.syncFallback();
    renderer.setRenderTarget(null);
    renderer.autoClear = true;
    this.warmPrograms();
    renderer.render(game.scene, game.cameraRig.camera);
    this._fenceFrame();
  }
}
