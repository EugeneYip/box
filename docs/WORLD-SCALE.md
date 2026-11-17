# World scale and performance — contract (round 14)

User request: units should all be smaller, so that maps of every size (Small
to Vast) have room for more variety and more going on, with ways to lower
CPU and GPU load while everything keeps running.

## One scale for everything that lives on the land

- A single module, `src/core/scale.js`, exports the scale constants every
  renderer and the sim use: `UNIT` (creatures), `BUILDING`, `VEHICLE` (land,
  sea and air), `PROP` (trees stay as Nature sets them unless they look
  out of proportion next to the smaller buildings), and `FOOTPRINT` (tiles a
  building or village occupies). No other file hard-codes these sizes.
- Target: creatures, buildings and vehicles about **0.6×** their round-13
  linear size, so a house takes about one tile, a person stands about a third
  of a tile tall, and a village fits in a noticeably smaller circle. The exact
  factors are tuned by eye so that close-up views still read well (faces,
  tools, sails, flags) and the overview still shows towns.
- Village footprints, building spacing, roads, walls, harbours and jetties,
  farm plots, berths and hull separation scale with `FOOTPRINT` so towns stay
  tidy at the new size. Selection, picking, labels and inspector framing
  follow the new sizes.
- Budgets grow with the freed space: about 1.6–2× as many villages and people
  per map area as round 13 (village budget in Civ `budgets()`, unit caps in
  Life, vessel caps in Fleets), tuned so that the sim cost stays within the
  budgets below.

## Keeping it fast

- GPU: instancing for every repeated mesh (people, animals, vehicles, props,
  repeated building parts), distance LOD (full model, simple model, impostor
  or dot), frustum culling by chunk, shadow casting only near the camera,
  and no per-object materials. Night lights and smoke are batched.
- CPU: update rates by distance from the camera and by importance (people far
  away think and move less often, as round 13 began for creatures), spatial
  hashing for neighbour queries, cached paths, and sim work spread across
  ticks. Fast-forward keeps working.
- Power saver lowers render scale, shadow range and far update rates.

## Budgets (headless SwiftShader numbers as the reference; lower is better)

| Case | Round 13 | Round 14 target |
|---|---|---|
| Medium, close / mid / overview draw calls | 181 / 147 / 130 | at most the same, with more on screen |
| Vast close / overview draw calls | 203 / 222 (309 max) | ≤ 200 at every zoom |
| Medium fine / coarse tick at Year 200 | 8.4 / 13.7 ms | ≤ 9 / 14 ms with the larger population |
| Vast fine / coarse tick at Year 100 | 8.0 / 7.9 ms | ≤ 10 / 10 ms with the larger population |

The systems critic measures these each round.
