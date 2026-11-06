import * as THREE from 'three';
import { Events } from './Events.js';
import { Random } from './Random.js';
import { CameraRig } from './CameraRig.js';
import { Picker } from './Picker.js';
import { Input } from './Input.js';
import { World } from '../world/World.js';
import { generateWorld } from '../world/worldgen.js';
import { RenderPipeline } from '../render/RenderPipeline.js';
import { Atmosphere } from '../render/atmosphere/Atmosphere.js';
import { Terrain } from '../render/terrain/Terrain.js';
import { Water } from '../render/water/Water.js';
import { Vegetation } from '../render/nature/Vegetation.js';
import { FloraSim } from '../sim/flora/FloraSim.js';
import { Units } from '../sim/units/Units.js';
import { UnitRenderer } from '../render/units/UnitRenderer.js';
import { Civilization } from '../sim/civ/Civilization.js';
import { BuildingRenderer } from '../render/buildings/BuildingRenderer.js';
import { Disasters } from '../sim/disasters/Disasters.js';
import { Effects } from '../render/fx/Effects.js';
import { AudioSystem } from '../audio/Audio.js';
import { UI } from '../ui/UI.js';
import { BrushCursor } from '../ui/BrushCursor.js';
import { getPower } from '../powers/registry.js';
import '../powers/index.js';

export const TICK = 1 / 15; // fixed simulation step (game seconds)
export const YEAR_SECONDS = 30; // game seconds per in-world year
export const DAY_SECONDS = 360; // game seconds per full day/night cycle

// The game context handed to every module. Modules keep a reference and read
// whatever they need: game.world, game.scene, game.events, game.env, ...
export class Game {
  constructor(container, params) {
    this.params = params;
    this.container = container;
    this.events = new Events();
    this.rng = new Random(params.seed);
    this.world = new World(params.size, params.size, this.events);
    generateWorld(this.world, params.seed, { preset: params.preset });

    this.scene = new THREE.Scene();
    this.clock = new THREE.Clock();
    this.time = {
      total: 0, // game seconds simulated
      hour: params.hour ?? 9.5, // 0..24
      day: 1,
      year: 0,
      realTime: 0, // wall-clock seconds since start (for visual animation)
    };
    this.speed = params.speed > 0 ? params.speed : 1;
    this.paused = params.speed === 0;
    this.settings = { dayNight: params.hour == null, autosave: false };
    // Shared environment state. Written by the atmosphere module, read by all.
    this.env = {
      sunDir: new THREE.Vector3(0.5, 0.8, 0.3).normalize(), // direction TO the sun
      daylight: 1, // 0 night .. 1 full day
      sunColor: new THREE.Color(1, 0.96, 0.9),
      weather: { type: params.weather || 'clear', intensity: params.weather ? 1 : 0 },
      wind: { x: 0.8, z: 0.35, strength: 0.35 }, // direction (normalised) and 0..1 strength
      lightning: 0, // flash intensity 0..1 (set by atmosphere / disasters)
    };
    this.brushSize = 4;
    this.activePower = null;
    this.frame = 0;

    this.pipeline = new RenderPipeline(this, container);
    this.cameraRig = new CameraRig(this);
    this.picker = new Picker(this);

    // ---- systems (construction order matters: dependencies first) ----
    this.atmosphere = new Atmosphere(this);
    this.terrain = new Terrain(this);
    this.water = new Water(this);
    this.fx = new Effects(this);
    this.audio = new AudioSystem(this);
    this.vegetation = new Vegetation(this);
    this.flora = new FloraSim(this);
    this.units = new Units(this);
    this.unitRenderer = new UnitRenderer(this);
    this.civ = new Civilization(this);
    this.buildings = new BuildingRenderer(this);
    this.disasters = new Disasters(this);
    this.brushCursor = new BrushCursor(this);
    this.input = new Input(this);
    this.ui = new UI(this);

    this.simSystems = [this.atmosphere, this.flora, this.units, this.civ, this.disasters];
    this.visualSystems = [
      this.atmosphere,
      this.terrain,
      this.water,
      this.vegetation,
      this.unitRenderer,
      this.buildings,
      this.fx,
      this.brushCursor,
      this.audio,
      this.ui,
    ];
    this.allSystems = [...new Set([...this.simSystems, ...this.visualSystems])];
    this._acc = 0;

    const cam = params.cam;
    if (cam && cam.length >= 3) this.cameraRig.set(cam[0], cam[1], cam[2], cam[3] || 0, cam[4]);
    else this.cameraRig.set(this.world.w / 2, this.world.h / 2, this.cameraRig.maxDist * 0.62, 0);

    addEventListener('resize', () => this.resize());
    this.world.flushDirty();
    this.civ.seedInitial?.(params.civs);
    this.units.seedInitial?.();
  }

  resize() {
    const w = innerWidth,
      h = innerHeight;
    this.pipeline.resize(w, h);
    this.cameraRig.resize(w, h);
    for (const s of this.allSystems) s.resize?.(w, h);
  }

  // ---- controls ---------------------------------------------------------
  setSpeed(s) {
    this.speed = s;
    this.paused = false;
    this.events.emit('speed', { speed: this.speed, paused: this.paused });
  }
  setPaused(p) {
    this.paused = p;
    this.events.emit('speed', { speed: this.speed, paused: this.paused });
  }
  setBrushSize(n) {
    const p = this.activePower;
    const min = p?.brush?.min ?? 1,
      max = p?.brush?.max ?? 30;
    this.brushSize = Math.max(min, Math.min(max, Math.round(n)));
    this.events.emit('brush', { size: this.brushSize });
  }
  selectPower(p) {
    if (typeof p === 'string') p = getPower(p);
    if (this.activePower === p) return;
    this.activePower?.onDeselect?.(this);
    this.activePower = p || null;
    if (p?.brush) this.brushSize = Math.max(p.brush.min ?? 1, Math.min(p.brush.max ?? 30, p.brush.size ?? this.brushSize));
    p?.onSelect?.(this);
    this.events.emit('power:select', { power: this.activePower });
    this.events.emit('brush', { size: this.brushSize });
  }
  applyPower(p, ctx) {
    if (typeof p === 'string') p = getPower(p);
    if (!p) return;
    try {
      p.apply(this, ctx);
    } catch (err) {
      console.error(`[power ${p.id}]`, err);
    }
    this.events.emit('power:apply', { power: p, ...ctx });
  }
  // Script helper: apply a power at a tile (used by tooling / tests).
  usePower(id, tx, ty, radius = null) {
    const p = getPower(id);
    if (!p) throw new Error('unknown power ' + id);
    this.applyPower(p, { x: tx + 0.5, z: ty + 0.5, tx, ty, radius: radius ?? p.brush?.size ?? 0, dt: 0.1, first: true, button: 0, shift: false, strength: 1 });
    this.world.flushDirty();
  }
  notify(text, kind = 'info', pos = null) {
    this.events.emit('notify', { text, kind, x: pos?.x, z: pos?.z, time: this.time.total });
  }
  focus(x, z, dist = null) {
    this.cameraRig.goal.x = x;
    this.cameraRig.goal.z = z;
    if (dist) this.cameraRig.goal.dist = dist;
  }

  regenerate(seed = Math.floor(Math.random() * 1e9), preset = this.params.preset, civs = this.params.civs) {
    this.params.seed = seed;
    this.params.preset = preset;
    this.rng = new Random(seed);
    generateWorld(this.world, seed, { preset });
    for (const s of this.allSystems) s.reset?.();
    this.world.flushDirty();
    this.events.emit('world:regenerated', {});
    this.civ.seedInitial?.(civs);
    this.units.seedInitial?.();
  }

  // ---- loop -------------------------------------------------------------
  tick(step) {
    this.time.total += step;
    this.time.year = this.time.total / YEAR_SECONDS;
    if (this.settings.dayNight) {
      this.time.hour += (step / DAY_SECONDS) * 24;
      if (this.time.hour >= 24) {
        this.time.hour -= 24;
        this.time.day++;
      }
    }
    for (const s of this.simSystems) s.tick?.(step);
  }

  // Simulate quickly without rendering (for screenshots / tests).
  fastForward(seconds) {
    const n = Math.ceil(seconds / TICK);
    for (let i = 0; i < n; i++) {
      this.tick(TICK);
      if (i % 30 === 0) this.world.flushDirty();
    }
    this.world.flushDirty();
  }

  frameStep(dt) {
    this.time.realTime += dt;
    if (!this.paused) {
      this._acc += dt * this.speed;
      // Budget simulation by wall-clock time, not tick count, so high game
      // speeds on slow machines degrade gracefully (the sim runs slower than
      // requested) instead of spiralling into ever-longer frames.
      const budgetMs = this.simBudgetMs ?? 9;
      const t0 = performance.now();
      while (this._acc >= TICK) {
        this.tick(TICK);
        this._acc -= TICK;
        if (performance.now() - t0 > budgetMs) {
          this._acc = Math.min(this._acc, TICK); // drop the backlog
          break;
        }
      }
    }
    this.input.update(dt);
    this.cameraRig.update(dt);
    this.world.flushDirty();
    for (const s of this.visualSystems) s.update?.(dt);
    this.pipeline.render(dt);
    this.frame++;
  }

  start() {
    if (this.params.ff > 0) this.fastForward(this.params.ff);
    let last = performance.now();
    const loop = (now) => {
      // Tooling hook: window.__hold = true freezes rendering so headless
      // screenshots can capture the last presented frame without starving.
      if (window.__hold) {
        last = now;
        requestAnimationFrame(loop);
        return;
      }
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      try {
        this.frameStep(dt);
      } catch (err) {
        console.error(err);
        window.__error = String(err && err.stack ? err.stack : err);
      }
      window.__frames = this.frame;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // Aggregate inspector information under a picked point. Each system may
  // implement inspect(hit) -> {priority, title, subtitle?, stats?:[[k,v]], unit?, building?} | null
  inspect(hit) {
    const results = [];
    for (const s of this.allSystems) {
      const r = s.inspect?.(hit);
      if (r) results.push(r);
    }
    results.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return results;
  }

  // Aggregate world statistics: each system may implement stats() -> {key: value}
  stats() {
    const out = {};
    for (const s of this.allSystems) Object.assign(out, s.stats?.() || {});
    return out;
  }
}
