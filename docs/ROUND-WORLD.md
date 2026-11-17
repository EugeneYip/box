# Round World Map — contract (round 14)

User request: on the whole-Earth World Map (not the regional maps), let
units travel across the Atlantic through the map's left and right edges,
because the real Earth is round and the route exists, while the map stays
flat for easy play.

## Setting

- New World option for the World Map's whole-Earth sizes (Large, Huge, Vast):
  **"Round world: sail across the map's edge"**, default **on**. Hidden for
  regional maps and square presets, where the edges stay closed.
- Also a World Law `worldWrap` (world group, World Map only) so it can be
  switched during play. URL `wrap=0|1`. The setting is saved with the world.
- `geoInfo(world).wrap` already marks the whole Earth (src/world/geo.js); the
  setting turns travel across that seam on or off.

## Behaviour when on

- The seam is the map's left and right edge (longitude −30°, mid-Atlantic,
  crossing Greenland and Antarctica). Tiles at x = 0 and x = w − 1 are
  neighbours.
- Ships (all sea kinds) route across the seam when that is shorter: the water
  graph links the two edges; voyages, trade routes, colonisation targets,
  naval patrols and wars measure distance around the globe.
- Aircraft and the air layer use the shorter of the two horizontal distances.
- People and land vehicles may cross where land touches both edges
  (Greenland, Antarctica); armies plan with wrapped distances.
- Civ: war targets, trade partners, alliances, colonisation and "nearest"
  queries use wrapped distance on the World Map (a helper in `src/world/geo.js`,
  e.g. `geoDelta(world, ax, az, bx, bz)` and `geoDist`, used everywhere
  distances are compared across the map).
- Rendering: a vessel leaving one edge appears at the other without a visible
  jump: it fades out over the last few tiles and in on the other side, or is
  drawn twice near the seam. Trade routes drawn at mid zoom split at the seam.
  The minimap shows the crossing. The camera may stay clamped (no seamless
  camera wrap required this round); if time allows, panning past an edge
  continues on the other side.

## When off

Behaviour is exactly as round 13 (edges closed).

## Acceptance

- On Vast with the setting on, trade or colonisation voyages cross the
  Atlantic seam between the Americas and Europe or Africa within 150 years,
  and at least one ship is seen crossing without a visible jump.
- With the setting off, no unit crosses the seam.
- Regional maps never show the option and never wrap.
