# Worldseed — Architecture & Team Contract

Worldseed is an **original** god-simulation sandbox built with Three.js (r170) and Vite.
The player shapes a living world: sculpting land and sea, painting biomes, seeding
forests and creatures, watching villages grow into rival kingdoms, and unleashing
disasters. The genre bar is set by games like WorldBox, but Worldseed must not copy any
existing game's name, characters, races, art, UI layout, icons, music or text. Our art
direction is our own (see below).

## Art direction — "Living Tabletop Diorama"

- A hand-crafted miniature world seen from above: crisp, readable silhouettes;
  soft, warm sunlight; deep, rich shadows; gentle ambient occlusion; slight tilt-shift
  depth of field when close; atmospheric haze when far.
- Stylized and painterly, not photoreal, and not pixel art. Smooth low-poly forms with
  subtle surface detail produced by procedural shader noise. Flat-shaded faceting is
  used deliberately (rocks, cliffs, tree canopies), never as a lazy default.
- A saturated but harmonious palette: emerald meadows, teal shallows grading to
  sapphire depths, golden beaches, violet dusk, amber lamplight at night.
- Motion everywhere: water shimmer and shore foam, trees swaying in the wind, smoke
  drifting, birds and clouds crossing, villagers bustling. A frozen frame should still
  feel alive.
- Every element is generated procedurally in code: geometry, shaders, canvas textures
  and WebAudio. There are no downloaded assets.

## Running

```bash
npm install
PORT=5173 npm run dev          # http://127.0.0.1:5173/
npm run build                  # static build in dist/
```

URL parameters (`src/core/params.js`): `seed, size, preset, cam=x,z,dist,yawDeg[,pitchDeg],
hour, ff (fast-forward seconds), speed, weather, ui=0, title=0, quality, audio=0, civs`.
`window.game` is the live Game object; `window.__ready`, `window.__frames` and
`window.__error` are set for tooling.

### Screenshots (visual verification is mandatory)

Headless Chromium renders WebGL2 through SwiftShader (CPU), so it is slow (about
5–10 fps), but the output is pixel-correct.

```bash
node tools/shot.mjs --port 5173 --q "seed=7&title=0&ui=0&cam=128,128,45,30&hour=10" --out shots/x.png
node tools/shot.mjs --port 5173 --plan my-plan.json --dir shots/mine
```
Plan entries: `{name, q, eval, after, wait, frames}`. `eval` runs JS after load (for example
`game.usePower('raise', 120, 130, 6)`, `game.fastForward(300)`, `game.units.spawn('human',x,z)`).
Look at every screenshot you take (use the Read tool on the PNG). Shots go in `shots/`
(gitignored).

## Module map & ownership

Every module is a class constructed with `game`, kept as `game.<name>`. Optional hooks:
`tick(step)` (fixed sim step, game seconds; not called while paused), `update(dt)`
(per rendered frame, real seconds), `reset()` (world regenerated), `resize(w,h)`,
`inspect(hit)` returning `{priority, title, subtitle, stats:[[k,v]], ...}`, and
`stats()` returning `{key: value}`.

| Area | Owner | Files |
|---|---|---|
| Core engine (loop, world model, camera, input, picker, registry, params, tools) | Integrator | `src/core/*`, `src/world/World.js`, `src/world/constants.js`, `src/powers/registry.js`, `src/powers/index.js`, `src/main.js`, `tools/*`, `docs/*` |
| Landscape: terrain mesh and shading, water and shores, world generation, terrain powers | Landscape | `src/render/terrain/*`, `src/render/water/*`, `src/world/worldgen.js`, `src/powers/terrainPowers.js` |
| Atmosphere: lights, shadows, sky, fog, clouds, day–night, weather visuals, post-processing | Atmosphere | `src/render/atmosphere/*`, `src/render/RenderPipeline.js` |
| Nature: trees, plants and props rendering, wind sway, flora growth and spread | Nature | `src/render/nature/*`, `src/sim/flora/*`, `src/powers/naturePowers.js` |
| Life: creatures (sim, AI, models, animation), fauna, birds and fish | Life | `src/sim/units/*`, `src/render/units/*`, `src/powers/lifePowers.js` |
| Civilization: villages, kingdoms, buildings, borders, war, diplomacy | Civilization | `src/sim/civ/*`, `src/render/buildings/*`, `src/powers/civPowers.js` |
| Effects and disasters: particles, fire spread, meteors, lightning, quakes, volcanoes and more | Effects | `src/render/fx/*`, `src/sim/disasters/*`, `src/powers/disasterPowers.js` |
| UI/UX: HUD, toolbar, icons, minimap, inspector, title screen, brush cursor, settings | UI | `src/ui/*`, `index.html`, `src/powers/worldPowers.js` |
| Audio: procedural ambience, SFX, music | Audio | `src/audio/*` |

**Rules**
1. Edit only the files your area owns. If you need a change elsewhere (a new event, a
   new field, a core fix), do not make it; describe it in your final report. Additive,
   backwards-compatible helpers in your own files are fine.
2. You may create new files inside your own directories freely.
3. `src/world/constants.js` may only be appended to (new TILE or FLORA ids at the end),
   and only by the Integrator. Ask in your report.
4. Do not add npm dependencies. Everything is procedural. (`three`, `postprocessing`,
   `n8ao`, `simplex-noise` and the bundled fonts are already installed.)
5. Never break the public contracts below. Other teams code against them in parallel.
6. Performance budget, measured on a mid-range laptop GPU at 1080p: 60 fps with 1,000
   units, 25k vegetation instances and 300 buildings on a 256² map. Use InstancedMesh,
   chunking, typed arrays and dirty rects. Never rebuild whole-world meshes on a small
   edit.
7. Code must not throw. Guard optional cross-module calls, for example
   `game.civ.damageArea?.(…)`.

## Public contracts (summary — read the source headers for details)

- **World** (`src/world/World.js`): typed arrays `height, type, flora, floraGrowth, fire, owner,
  building, temperature, moisture, wetness`; `heightAt(x,z)` (bilinear between tile centres —
  the rendered terrain must match it), `surfaceAt`, `normalAt`, `isWater/isLand/isWalkable/isBuildable`,
  setters (`setHeight/setType/setFlora/setOwner/setFire`) or direct array writes followed by
  `markDirty(layer, x0,y0,x1,y1)`. Dirty rects are flushed once per frame as
  `'world:height' | 'world:type' | 'world:flora' | 'world:owner' | 'world:fire'` events.
  Water is height `< SEA_LEVEL` (0). Tile (tx,ty) centre is (tx+0.5, ty+0.5); the world is
  `w × h` world units (default 256).
- **Events** (`src/core/Events.js` header lists the well-known events).
- **Environment** `game.env`: `sunDir, daylight (0..1), sunColor, weather {type, intensity},
  wind {x, z, strength}, lightning`. Written by Atmosphere, read by everyone (vegetation sway,
  smoke drift, window lights at night, ...).
- **Time** `game.time`: `total` (game s), `hour` (0–24), `day`, `year`, `realTime`.
  `YEAR_SECONDS=30`, `DAY_SECONDS=360` (in `src/core/Game.js`).
- **Units** (`src/sim/units/Units.js` header): `spawn, kill, damage, damageArea, query, nearest,
  moveTo, registerBrain, count`, species registry `registerSpecies`.
- **Civilization** (`src/sim/civ/Civilization.js` header): `kingdoms, villages, buildings,
  kingdomName, kingdomColor, foundVillage, damageArea, seedInitial`.
- **Effects** (`src/render/fx/Effects.js` header): `emit(type,pos,opts)`, `burst`, `addLight`,
  `screenFlash`.
- **Audio** (`src/audio/Audio.js` header): `play(name, {pos, volume, pitch})`, `setMuted`, `setVolume`.
- **Disasters** (`src/sim/disasters/Disasters.js`): `ignite(tx,ty,intensity)`.
- **Powers** (`src/powers/registry.js` header): `registerPower({id, name, category, description,
  mode, brush, interval, apply(game, ctx)})`. Categories: `terrain, biome, nature, life, civ,
  disaster, world`. The UI renders icons by power id.
- **Camera** `game.cameraRig`: `set(x,z,dist,yawDeg,pitchDeg)`, `zoom`, `panPixels`, `addShake(a)`,
  `follow = unit`. **Picker** `game.picker.pick(clientX, clientY)` → `{x,y,z,tx,ty,water}`.
- **Game helpers**: `usePower(id,tx,ty,radius)`, `fastForward(s)`, `notify(text, kind, pos)`,
  `focus(x,z,dist)`, `regenerate(seed,preset,civs)`, `setSpeed`, `setPaused`, `selectPower`,
  `inspect(hit)`, `stats()`.

## Quality bar

"AAA" here means a frame captured at any moment would hold up as a store-page screenshot:
cohesive art direction, no z-fighting, no visible tiling or seams, no popping, no
placeholder primitives, no unlit or untextured-looking surfaces, no aliasing shimmer,
pleasing composition at every zoom level, satisfying feedback on every action, and
readable UI with clear hierarchy. Review your own work as a harsh art director would,
and iterate until it is excellent.
