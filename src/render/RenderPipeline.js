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
// game.settings.powerSaver (event 'powersaver') disables AO and DOF and the
// atmosphere halves the shadow map. The pixel ratio never changes on a
// toggle (a drawing-buffer resize stalls the GPU). Dynamic resolution
// scaling is opt-in via game.settings.dynamicResolution.
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
    this.dynScale = 1; // dynamic resolution factor (power saver / opt-in)
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
      this.dynScale = 1;
      this.applyPixelRatio();
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

  targetPixelRatio() {
    let pr = Math.min(devicePixelRatio || 1, this.tier.pixelRatio);
    // (the power saver no longer changes the pixel ratio: resizing the
    // drawing buffer forces a full GPU sync, which stalled the toggle for
    // seconds; the saver sheds AO, DOF, shadow resolution and frame rate)
    return Math.max(0.5, pr * this.dynScale);
  }

  applyPixelRatio() {
    const pr = this.targetPixelRatio();
    if (Math.abs(this.renderer.getPixelRatio() - pr) < 0.01) return;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.size.x, this.size.y);
    this.composer?.setSize(this.size.x, this.size.y);
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
    try {
      ao.enabled = !ao.enabled;
      this.composer.render(0);
    } catch (err) {
      console.warn('[pipeline] variant warm-up skipped', err);
    } finally {
      ao.enabled = !ao.enabled;
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
    this.renderer.setSize(w, h);
    if (this.composer) this.composer.setSize(w, h);
  }

  // Push the atmosphere's per-frame look parameters into the passes.
  syncPost(dt) {
    const P = this.game.atmosphere?.post;
    const p = this.passes;
    if (!P || !p) return;
    const cam = this.game.cameraRig.camera;
    p.atmos.sync(cam, P.sky, P);
    const H = this.renderer.getDrawingBufferSize(this._v2 || (this._v2 = new THREE.Vector2())).y;
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
        this.composer.render(dt);
        this.warmVariants();
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
    renderer.render(game.scene, game.cameraRig.camera);
  }
}
