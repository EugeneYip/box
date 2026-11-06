import * as THREE from 'three';
import { SkyModel } from './SkyModel.js';
import { SkyDome } from './SkyDome.js';
import { Clouds } from './Clouds.js';
import { Precipitation } from './Precipitation.js';
import { Lightning } from './Lightning.js';
import { Weather, WEATHER_TYPES } from './Weather.js';
import { noise1, smoothstep, mulberry32, approach } from './util.js';

// Atmosphere: sun / moon / sky lighting, camera-fitted stable shadows, the
// procedural sky, clouds and cloud shadows, day-night cycle, weather visuals
// and state, lightning, and the per-frame "look" parameters consumed by the
// render pipeline's post-processing.
//
// PUBLIC CONTRACT
//   game.atmosphere.setWeather(type, intensity = 1, duration = null)
//       type: 'clear' | 'rain' | 'storm' | 'snow' | 'fog'; duration in game
//       seconds (null = until changed). Transitions ease in over a few seconds.
//   game.atmosphere.strike(x, z, opts?)  draws a lightning bolt + flash at a
//       world position. opts: { sound = true, intensity = 1 }. No gameplay
//       damage (the caller applies it).
//   game.atmosphere.weather   the Weather state object (type, intensity, mix)
//   game.settings.autoWeather  (default true) lets weather change by itself.
//
// game.env (written every frame, read by everyone). All colours linear.
//   DIRECT LIGHT (use these for diffuse sun terms, specular glints, ice):
//     lightDir    direction TO the current key light (sun by day, moon by
//                 night; elevation clamped >= ~10deg)
//     lightColor  key light colour x intensity, in three.js punctual-light
//                 units (~3.3 at clear noon, ~0.5 under storm, ~0.6 moon).
//                 Already reduced by overcast / storm / fog.
//     sunColor    sun-only colour x relative strength (1 = clear noon; 0 at
//                 night; drops with overcast). Legacy: sunColor * daylight.
//     cloudShadow {texture, params: Vector4(offX, offZ, 1/scale, strength)}
//                 multiply DIRECT light by 1 - strength * texture.r at
//                 uv = (worldXZ + off) * (1/scale). Not applied in post.
//   SKY / AMBIENT (radiance, use for reflections and fill):
//     skyColor    zenith radiance       horizonColor  horizon radiance
//     fogColor    haze colour toward the horizon (also scene.background)
//     ambientColor hemisphere sky irradiance (colour x intensity)
//   OTHER: sunDir (true sun, kept >= ~2deg up), daylight (0 night .. 1 day,
//   dimmed by overcast), night, golden (golden-hour 0..1), moonDir,
//   sunIntensity, weather {type, intensity}, wind {x, z, strength} (gusty),
//   lightning (flash 0..1; others may raise it, it is merged), wetness,
//   snowCover, mist, cloudCover, overcast.

const UP = new THREE.Vector3(0, 1, 0);

export class Atmosphere {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    if (game.settings.autoWeather === undefined) game.settings.autoWeather = true;
    scene.background = new THREE.Color(0x0b1424);
    scene.fog = null;

    this.model = new SkyModel();
    this.weather = new Weather(game);
    this.rng = mulberry32(((game.params.seed || 1) * 2654435761) >>> 0);

    // ---- lights ------------------------------------------------------------
    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5a4a32, 0.9);
    scene.add(this.hemi);

    const key = new THREE.DirectionalLight(0xfff1dc, 3);
    key.name = 'key-light';
    key.castShadow = true;
    const sm = game.pipeline?.tier?.shadowMap || 2048;
    key.shadow.mapSize.set(sm, sm);
    key.shadow.bias = -0.0002;
    key.shadow.normalBias = 0.05;
    scene.add(key);
    scene.add(key.target);
    this.key = key;
    this.sun = key; // legacy alias

    // lightning flash: a second (shadowless) directional light, normally off
    this.flashLight = new THREE.DirectionalLight(0xcfe0ff, 0);
    scene.add(this.flashLight);
    scene.add(this.flashLight.target);

    // ---- sky, clouds, precipitation, lightning --------------------------
    this.sky = new SkyDome(this);
    this.clouds = new Clouds(this);
    this.precip = new Precipitation(this);
    this.lightning = new Lightning(this);

    // ---- env extras ----------------------------------------------------
    const env = game.env;
    env.night = 0;
    env.moonDir = new THREE.Vector3(0, 1, 0);
    env.lightDir = new THREE.Vector3(0, 1, 0);
    env.lightColor = new THREE.Color(1, 1, 1);
    env.sunIntensity = 3;
    env.skyColor = new THREE.Color();
    env.horizonColor = new THREE.Color();
    env.fogColor = new THREE.Color();
    env.ambientColor = new THREE.Color();
    env.wetness = 0;
    env.snowCover = 0;
    env.mist = 0;
    env.cloudCover = 0;
    env.overcast = 0;
    env.golden = 0;
    if (!env.weather) env.weather = { type: 'clear', intensity: 0 };
    if (!env.wind) env.wind = { x: 0.8, z: 0.35, strength: 0.35 };

    // ---- post-processing look parameters (read by RenderPipeline) ----------
    this.post = {
      sky: this.sky.uniforms,
      exposure: 1,
      shadowTint: new THREE.Vector3(),
      highTint: new THREE.Vector3(),
      midTint: new THREE.Vector3(),
      wet: 0,
      lightDir: new THREE.Vector3(0, 1, 0),
      lightColor: new THREE.Color(),
      flash: new THREE.Vector3(),
      grade: new THREE.Vector4(1.08, 0.15, 1.05, 0.45),
      vignette: new THREE.Vector4(0.3, 0.42, 1.0, 0),
      vignetteColor: new THREE.Color(0.3, 0.25, 0.32),
      haze: new THREE.Vector4(300, 0.003, 0.02, 1),
      mist: new THREE.Vector4(0, 0.4, 0, 0.9),
      mistColor: new THREE.Color(),
      cloud: new THREE.Vector4(),
      cloudTex: null,
      fogColor: new THREE.Color(),
      bloom: { threshold: 1.1, smoothing: 0.35, intensity: 0.6 },
      dof: { focus: 50, band: 0.08, ramp: 0.3, maxCoc: 0, nearBoost: 1.4 },
      ao: { radius: 2.5, intensity: 2.5, falloff: 1 },
    };

    this._windAngle = this.rng() * Math.PI * 2;
    this._boltT = 2;
    this._extFlash = 0;
    this._lastFlash = 0;
    this._myFlash = 0;
    this._thunder = [];
    this._focus = 50;
    this._maxH = 22;
    this._maxHDirty = true;
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._ray = new THREE.Ray();
    this._corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this._lx = new THREE.Vector3();
    this._ly = new THREE.Vector3();
    this._lz = new THREE.Vector3();
    this._pts = [];
    for (let i = 0; i < 10; i++) this._pts.push(new THREE.Vector3());
    game.events.on('world:height', () => (this._maxHDirty = true));
    game.events.on('world:regenerated', () => (this._maxHDirty = true));
    this.update(0);
  }

  // ---- public API ---------------------------------------------------------
  setWeather(type, intensity = 1, duration = null) {
    if (!WEATHER_TYPES.includes(type)) return;
    if (type !== this.weather.type) {
      const cue = { storm: ['thunder', 0.7], rain: ['splash', 0.3], snow: ['magic', 0.45], clear: ['magic', 0.4], fog: ['magic', 0.3] }[type];
      try {
        if (cue) this.game.audio?.play?.(cue[0], { volume: cue[1] });
      } catch (e) {
        /* audio is optional */
      }
    }
    this.weather.set(type, intensity, duration);
    // a player's choice holds back auto weather for a while
    const total = this.game.time.total;
    this.weather.autoHeld = total + (duration ?? 240);
    this.weather.nextAuto = Math.max(this.weather.nextAuto, total + (duration ?? 240));
    this.game.env.weather.type = type;
  }

  strike(x, z, opts = {}) {
    const world = this.game.world;
    const y = world.surfaceAt(x, z);
    // the channel enters from above the top edge of the frame
    const cam = this.game.cameraRig.camera;
    let top = y + 30;
    for (let h = 12; h <= 220; h += 6) {
      const p = this._v.set(x, y + h, z).project(cam);
      if (p.z > 1 || p.z < -1) break; // behind the camera / past far
      top = y + h;
      if (p.y > 1.12) break;
    }
    const bolt = this.lightning.spawn(x, y, z, { intensity: opts.intensity ?? 1, top });
    this._boltFlash(bolt, opts.sound !== false);
    return bolt;
  }

  _boltFlash(bolt, sound) {
    const rig = this.game.cameraRig;
    this.flashLight.position.set(bolt.x + 10, bolt.y + 80, bolt.z + 6);
    this.flashLight.target.position.set(bolt.x, bolt.y, bolt.z);
    if (sound) {
      const d = Math.hypot(bolt.x - rig.target.x, bolt.z - rig.target.z) + rig.cur.dist * 0.3;
      this._thunder.push({
        t: 0.15 + d / 140 + this.rng() * 0.2,
        x: bolt.x,
        z: bolt.z,
        volume: THREE.MathUtils.clamp(1.15 - d / 320, 0.25, 1),
      });
    }
  }

  // ---- loop -----------------------------------------------------------------
  tick(step) {
    this.weather.tick(step);
  }

  reset() {
    this._maxHDirty = true;
    this.weather.wetness = 0;
  }

  update(dt) {
    const game = this.game;
    const env = game.env;
    const rig = game.cameraRig;
    const camera = rig.camera;
    const time = game.time.realTime;
    const hour = game.time.hour;
    const W = this.weather;
    const paused = game.paused;

    // ---- weather + wind --------------------------------------------------
    // light valley mist around dawn
    const dawn = smoothstep(4.6, 5.8, hour) * (1 - smoothstep(7.2, 9.0, hour));
    W.morningMist = dawn * 0.32;
    W.update(dt);
    const mix = W.mix;
    this._windAngle += (noise1(time * 0.013, 3) * 0.06 + 0.004) * dt;
    const ang = this._windAngle + noise1(time * 0.031, 5) * 0.5;
    const gust = Math.pow(0.5 + 0.5 * noise1(time * 0.42, 9), 2);
    const flutter = noise1(time * 1.7, 11) * 0.06;
    const strength = THREE.MathUtils.clamp(mix.wind * (0.72 + 0.6 * gust) + flutter * (0.3 + mix.storm), 0, 1);
    env.wind.x = Math.cos(ang);
    env.wind.z = Math.sin(ang);
    env.wind.strength = strength;

    // ---- sky model -----------------------------------------------------------
    const M = this.model;
    M.update(hour, mix);

    // ---- storms & lightning ---------------------------------------------------
    if (!paused && mix.storm > 0.3) {
      this._boltT -= dt;
      if (this._boltT <= 0) {
        this._boltT = (1.2 + this.rng() * 5.5) / Math.max(0.4, mix.storm);
        const span = 20 + rig.cur.dist * 0.75;
        const x = THREE.MathUtils.clamp(rig.target.x + (this.rng() - 0.5) * span * 1.6, 2, game.world.w - 2);
        const z = THREE.MathUtils.clamp(rig.target.z + (this.rng() - 0.65) * span * 1.4, 2, game.world.h - 2);
        // some bolts stay inside the clouds (sheet lightning)
        if (this.rng() < 0.3) this._myFlash = Math.max(this._myFlash, 0.45 + this.rng() * 0.3);
        else this.strike(x, z, { intensity: 0.8 + this.rng() * 0.4 });
      }
    }
    for (const th of this._thunder) th.t -= dt;
    while (this._thunder.length && this._thunder[0].t <= 0) {
      const th = this._thunder.shift();
      try {
        game.audio?.play?.('thunder', { pos: { x: th.x, z: th.z }, volume: th.volume, pitch: 0.85 + this.rng() * 0.3 });
      } catch (e) {
        /* audio is optional */
      }
    }
    const bolts = this.lightning.update(dt, camera, rig.cur.dist);
    const boltFlash = bolts.flash;
    if (bolts.strokes > 0) game.pipeline?.flash?.(0xc4ceff, 0.05);
    this._myFlash = Math.max(0, this._myFlash - dt * 3.5);
    // merge flashes raised by other modules (Effects may write env.lightning)
    if (env.lightning > this._lastFlash + 1e-4) this._extFlash = Math.max(this._extFlash, env.lightning);
    this._extFlash = Math.max(0, this._extFlash - dt * 3);
    const flash = Math.min(1, Math.max(boltFlash, this._myFlash, this._extFlash));
    env.lightning = flash;
    this._lastFlash = flash;

    // ---- lights ------------------------------------------------------------
    const key = this.key;
    key.color.copy(M.keyColor);
    key.intensity = M.keyIntensity;
    this.hemi.color.copy(M.hemiSky);
    this.hemi.groundColor.copy(M.hemiGround);
    this.hemi.intensity = M.hemiIntensity * (1 + flash * 0.6);
    this.flashLight.intensity = flash * 3.2;
    this.fitShadow(camera, M.keyDir);
    game.scene.environmentIntensity = (0.62 + 0.12 * mix.overcast + 0.1 * W.wetness) * (1 - 0.35 * mix.storm);

    // ---- sky, clouds, precipitation ----------------------------------------
    this.sky.sync(M, mix, dt, time);
    this.sky.uniforms.uFlash.value = flash;
    this.sky.uniforms.uCloudOffset.value.set(this.clouds.drift.x / 900, this.clouds.drift.y / 900);
    this.clouds.update(dt, M, mix, env);
    this.precip.update(dt, time, mix, env, M);

    // ---- env -------------------------------------------------------------------
    env.sunDir.copy(M.sunDir);
    if (env.sunDir.y < 0.035) {
      const h = Math.hypot(env.sunDir.x, env.sunDir.z) || 1;
      const k = Math.sqrt(1 - 0.035 * 0.035) / h;
      env.sunDir.set(env.sunDir.x * k, 0.035, env.sunDir.z * k);
    }
    env.daylight = M.daylight * (1 - 0.38 * mix.overcast - 0.12 * mix.storm);
    env.night = M.night;
    env.golden = M.golden;
    env.sunColor.copy(M.sunLightColor).multiplyScalar(M.keyIsMoon ? 0 : Math.min(1.1, M.keyIntensity / 3.3));
    env.sunIntensity = M.keyIsMoon ? 0 : M.keyIntensity;
    env.moonDir.copy(M.moonDir);
    env.lightDir.copy(M.keyDir);
    env.lightColor.copy(M.keyColor).multiplyScalar(M.keyIntensity);
    env.skyColor.copy(M.zenith);
    env.horizonColor.copy(M.horizon);
    env.fogColor.copy(M.horizon).lerp(M.groundHaze, 0.3);
    // safe fallback for anything that samples the background colour
    if (game.scene.background?.isColor) game.scene.background.copy(env.fogColor);
    env.ambientColor.copy(M.hemiSky).multiplyScalar(M.hemiIntensity);
    env.wetness = W.wetness;
    env.snowCover = W.snowCover;
    env.mist = mix.fog;
    env.cloudCover = mix.cover;
    env.overcast = mix.overcast;
    W.report(env.weather);

    this.updatePost(dt, flash);
  }

  // Offscreen work right before the frame is drawn.
  preRender(renderer, dt) {
    const want = this.game.pipeline?.tier?.shadowMap || 2048;
    const sh = this.key.shadow;
    if (sh.mapSize.x !== want) {
      sh.mapSize.set(want, want);
      sh.map?.dispose();
      sh.map = null;
    }
    this.clouds.renderShadow(renderer);
    this.sky.updateEnvironment(renderer, this.game.scene, dt);
    this.shadowBudget(renderer);
    // Warm every program once (hidden weather / lightning meshes included)
    // after the first environment capture, so the first storm doesn't hitch.
    if (!this._warmed && this.game.frame >= 3 && this.game.scene.environment) {
      this._warmed = true;
      try {
        const cam = this.game.cameraRig.camera;
        const parallel = renderer.extensions.has('KHR_parallel_shader_compile');
        if (parallel && renderer.compileAsync) renderer.compileAsync(this.game.scene, cam).catch(() => {});
        else renderer.compile(this.game.scene, cam);
      } catch (err) {
        console.warn('[atmosphere] program warm-up skipped', err);
      }
    }
  }

  // Shadow map budget: the map is re-rendered every frame while the camera
  // or light moves (the fitted frustum changed), otherwise every 2nd frame at
  // mid zoom and every 3rd frame zoomed out, where a frame of lag on moving
  // units' shadows is invisible. Halves to thirds the shadow pass cost.
  shadowBudget(renderer) {
    const sm = renderer.shadowMap;
    sm.autoUpdate = false;
    // compare what fitShadow() set this frame (the shadow camera itself only
    // moves when the map is re-rendered)
    const L = this.key;
    const c = L.shadow.camera;
    const sig = this._shadowSig || (this._shadowSig = new Float32Array(10));
    const lp = L.position,
      tp = L.target.position;
    const now = [lp.x, lp.y, lp.z, tp.x, tp.y, tp.z, c.right - c.left, c.top - c.bottom, c.near, c.far];
    let changed = !this._shadowInit;
    for (let i = 0; i < 10; i++) {
      if (Math.abs(now[i] - sig[i]) > 1e-4) changed = true;
      sig[i] = now[i];
    }
    this._shadowInit = true;
    const d = this.game.cameraRig.cur.dist;
    const interval = d < 70 ? 1 : d < 160 ? 2 : 3;
    this._shadowAge = (this._shadowAge || 0) + 1;
    if (changed || this._shadowAge >= interval || this.game.frame < 4) {
      sm.needsUpdate = true;
      this._shadowAge = 0;
    }
  }

  // ---- shadows --------------------------------------------------------------
  // Fit the key light's orthographic shadow frustum to the camera's ground
  // footprint, in light space, snapped to whole shadow texels so the shadow
  // map never shimmers while panning; extents are quantised so it doesn't
  // breathe over hills either.
  fitShadow(camera, lightDir) {
    const world = this.game.world;
    if (this._maxHDirty) {
      let m = 0;
      const h = world.height;
      for (let i = 0; i < h.length; i++) if (h[i] > m) m = h[i];
      this._maxH = m;
      this._maxHDirty = false;
    }
    const yLow = -1.5;
    const yHigh = Math.min(Math.max(2, this._maxH) + 3, 16);
    const rig = this.game.cameraRig;
    const camPos = camera.position;
    const maxT = rig.cur.dist * 3 + 60;
    const pts = this._pts;
    let n = 0;
    const ndc = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
    camera.updateMatrixWorld();
    for (const [x, y] of ndc) {
      const d = this._v.set(x, y, 0.5).unproject(camera).sub(camPos).normalize();
      for (const plane of [yLow, yHigh]) {
        let t = d.y < -1e-4 ? (plane - camPos.y) / d.y : maxT;
        if (t < 0 || t > maxT) t = maxT;
        pts[n++].copy(camPos).addScaledVector(d, t);
      }
    }
    pts[n++].copy(rig.target);

    const sd = this._shadowDir || (this._shadowDir = lightDir.clone().normalize());
    if (sd.angleTo(lightDir) > 0.004) sd.copy(lightDir).normalize();
    const lz = this._lz.copy(sd);
    const lx = this._lx;
    if (Math.abs(lz.y) > 0.999) lx.set(1, 0, 0);
    else lx.crossVectors(UP, lz).normalize();
    const ly = this._ly.crossVectors(lz, lx);
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity,
      sumZ = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const px = p.dot(lx),
        py = p.dot(ly);
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      sumZ += p.dot(lz);
    }
    const margin = 2 + rig.cur.dist * 0.02;
    const q = (v) => Math.pow(1.06, Math.ceil(Math.log(Math.max(v, 4)) / Math.log(1.06)));
    const w = q(maxX - minX + margin * 2);
    const h = q(maxY - minY + margin * 2);
    const size = this.key.shadow.mapSize.x;
    const tx = w / size,
      ty = h / size;
    const cx = Math.round((minX + maxX) / 2 / tx) * tx;
    const cy = Math.round((minY + maxY) / 2 / ty) * ty;
    const cz = Math.round(sumZ / n); // quantised: stable map while idle
    const D = 300;
    const L = this.key;
    L.target.position.set(0, 0, 0).addScaledVector(lx, cx).addScaledVector(ly, cy).addScaledVector(lz, cz);
    L.position.copy(L.target.position).addScaledVector(lz, D);
    L.target.updateMatrixWorld();
    L.updateMatrixWorld();
    let near = Infinity,
      far = -Infinity;
    for (let i = 0; i < n; i++) {
      const dd = D + cz - pts[i].dot(lz);
      if (dd < near) near = dd;
      if (dd > far) far = dd;
    }
    const lift = (yHigh - yLow) / Math.max(0.12, lz.y) + 8;
    near = Math.max(0.5, Math.floor(near - lift));
    far = Math.ceil(far + 10);
    const c = L.shadow.camera;
    c.left = -w / 2;
    c.right = w / 2;
    c.bottom = -h / 2;
    c.top = h / 2;
    c.near = near;
    c.far = far;
    c.updateProjectionMatrix();
    const texel = Math.max(tx, ty);
    L.shadow.normalBias = texel * 1.3 + 0.01;
    L.shadow.bias = -(texel * 0.5 + 0.015) / (far - near);
  }

  // ---- post parameters --------------------------------------------------------
  updatePost(dt, flash) {
    const game = this.game;
    const M = this.model;
    const W = this.weather.mix;
    const P = this.post;
    const rig = game.cameraRig;
    const dist = rig.cur.dist;

    P.exposure = M.exposure * (1 + 0.04 * flash);
    P.shadowTint.copy(M.shadowTint);
    P.highTint.copy(M.highTint);
    P.grade.set(M.saturation, M.vibrance, M.contrast, 0.45);
    P.midTint.copy(M.midTint);
    // wet sheen on rain-soaked surfaces
    P.wet = Math.min(1, this.weather.wetness * 1.1) * (0.4 + 0.6 * W.rain);
    P.lightDir.copy(M.keyDir);
    P.lightColor.copy(M.keyColor).multiplyScalar(M.keyIntensity);
    P.flash.set(0.5, 0.58, 0.8).multiplyScalar(flash * 0.04);
    P.vignette.set(0.3 + 0.1 * M.night + 0.1 * W.storm, 0.42, 1.02, 0);
    P.vignetteColor.setRGB(0.28, 0.22, 0.34).lerp(this._c1 || (this._c1 = new THREE.Color(0.1, 0.14, 0.3)), M.night * 0.6);

    // haze starts around the focus distance; thicker in rain / fog
    const hazeDensity = 0.0026 + 0.0025 * W.overcast + 0.012 * W.fog + 0.0015 * W.rain + 0.0012 * W.snow;
    P.haze.set(dist * 0.9 + 8, hazeDensity, 0.022, 1);
    // ground mist: dawn wisps, thick in fog weather, a little in snow / rain
    const mistAmt = Math.max(W.fog, this.weather.morningMist);
    const mistDensity = 0.004 + 0.05 * mistAmt * mistAmt + 0.006 * W.rain + 0.006 * W.snow;
    const mistH = 1.5 + 4.5 * W.fog;
    P.mist.set(mistDensity, 1 / mistH, 0.2, 0.55 + 0.4 * W.fog);
    P.mistColor.copy(M.mistColor);
    const cs = game.env.cloudShadow;
    if (cs) {
      P.cloudTex = cs.texture;
    }
    P.fogColor.copy(M.horizon).lerp(M.groundHaze, 0.4);

    // high threshold by day (only true highlights glow), lower at night for lamps
    P.bloom.threshold = (1.7 - 0.7 * M.night) / Math.max(0.5, M.exposure);
    P.bloom.smoothing = 0.4;
    P.bloom.intensity = 0.42 + 0.25 * M.night + 0.3 * flash;

    // depth of field: focus on the ground at the screen centre
    let focus = dist;
    const cam = rig.camera;
    this._ray.origin.copy(cam.position);
    cam.getWorldDirection(this._ray.direction);
    const hit = game.picker?.intersect?.(this._ray, true);
    if (hit) focus = cam.position.distanceTo(this._v.set(hit.x, hit.y, hit.z));
    this._focus = this._focus ? approach(this._focus, focus, 10, dt || 1) : focus;
    // strong only close up; a gentle miniature hint at mid zoom; off far out
    const s = (1 - 0.72 * smoothstep(25, 90, dist)) * (1 - smoothstep(90, 140, dist));
    P.dof.focus = this._focus;
    P.dof.band = 0.13 + 0.03 * (1 - s);
    P.dof.ramp = 0.32;
    P.dof.maxCoc = 6 * s;
    P.dof.nearBoost = 0.8;

    // AO scale follows the zoom: fine contact shadows close, valleys far
    P.ao.radius = THREE.MathUtils.clamp(0.9 + dist * 0.022, 1.0, 6.5);
    P.ao.intensity = 1.5;
    P.ao.falloff = 1.0;
  }
}
