# World scale and performance — contract (round 14, units and vehicles halved in round 24)

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

## Round 24: what moves is half size

User request: "if possible all units needs to be at least 50% smaller to
free up more space." Asked which things, the user chose: **people, animals,
cars, trains, ships and aircraft all halve, so they stay in proportion with
each other; buildings and trees keep their size**, so streets and squares look
emptier and roomier.

- `UNIT.scale` 0.6 → **0.3** (melee reach with it); `VEHICLE.sea`, `land`,
  `air` 0.6 → **0.3**; `VEHICLE.road` 0.69 → **0.345** (1.15 × `land`, so a
  car stays a little over two people long). `BUILDING`, `PROP` and
  `FOOTPRINT` are unchanged (0.6; trees 0.68, shrubs 0.8, grass 0.5).
- `UNIT.rel` and `VEHICLE.rel` (0.5) are the factors relative to round 14:
  gaps and overlays that had been tuned in world units beside a 0.6× person
  multiply by them (icons over heads and their rise, far-zoom dots, arrows,
  talking circles, crowd rings on the square, the bench and stall places,
  the separation pads, the give-way gap between hulls).
- What follows the bodies: the sim's body radius, separation, melee reach,
  conversation circles and square crowds, drill ranks (closed up to at most
  0.75 × `UNIT.scale` between files), vehicle lengths, following and parking
  distances, hull capsules and berths (`hull.js`), the rail gauge, rails,
  sleepers, ballast width, buffer stops and the maglev beam (track sized by
  `VEHICLE.land`, so a train sits on its rails), the height trains ride at
  (`RAIL_Y`), the right-hand lane cars keep (now the right half of the same
  street), benches and the food stall (furniture for the people takes
  `UNIT.scale`; the paved parade square stays with the land).
- What keeps its size: buildings, trees, plots, streets, walls, harbours and
  piers, the parade square, aircraft cruise heights (they must still clear
  roofs and towers), the camera's zoom range.
- Picking: a click keeps a minimum radius of `PICK_PX` (14) screen pixels
  (`Picker.pick` reports world units per pixel at the hit as `hit.px`), with
  a small world floor up close, so a few-pixel person or car is still easy to
  select. Creature LOD is by on-screen pixel height, so half-size people turn
  to the cheaper models and to dots sooner; dots keep a 6 px minimum.

## Round 25: the world fitted round the half-size units

The units stay halved (no size floor for any craft); what stood beside them
was refitted instead.

- Small plants halve with the people: `PROP.shrub` 0.8 → 0.4 (bushes,
  flowers, reeds, cacti, stumps), `PROP.grass` 0.5 → 0.25, and the new
  `PROP.plant` (0.5) for GroundCover's ferns, broad-leaf clumps, meadow
  flowers and tumbleweed. Trees, crops, fences and buildings keep theirs.
- Person-height props take the people's factor: `PROP.kit` (= `UNIT.scale`)
  for scarecrows, benches and the food stall; `PROP.kitRel` (`UNIT.rel`)
  inside building models (the well, the market's stalls).
- Mid zoom (about 18 to 80 tiles): each person on land wears a small bright
  camera-facing mark at least 3.6 px across (one more decal in the existing
  overlay layer), and road vehicles keep at least about 5.5 px of length on
  screen (`FleetRenderer` `MIN_CAR_PX`); up close both keep their true size.
- Ships: a hull with a clearance need needs a channel its beam plus two
  tiles wide; the great hulls (`DEEP_WATER` in `src/sim/fleet/hull.js`:
  carrier, liner, battleship, tanker, container ships) are moved out of
  rivers to open water and berth only in such water. A harbour's berths
  start past its long pier's real end (`pierEnd`), and a hull alongside lies
  off the pier by half its width plus half its beam (`pierHalf`).
- No tree stands on an airport's plot or within two tiles of it.
- Camera, closest zooms: under distance 20 the target sits on the ground
  itself (easing to 60% of the ground height by 40), the pitch rises until
  the line of sight clears the terrain, and buildings between the eye and
  the target open in a dithered cutaway round the middle of the frame
  (`CAM_CUT` in `src/core/CameraRig.js`, read by the building material).

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
