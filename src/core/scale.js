// One scale for everything that lives on the land (docs/WORLD-SCALE.md).
//
// Every model file (creatures, buildings, props, vessels) is drawn in its
// round-13 "design" size: one tile = one world unit, a person 0.6 tall, a
// cottage about 1.6 wide on a 2 x 2 plot, a cog 2.2 long. These factors bring
// the designs to the world, so a smaller (or larger) world is one edit here.
// No other file hard-codes these sizes: renderers multiply by the factor that
// owns the thing they draw, the sims read their sizes through it.
//
//   UNIT      creatures: models, poses, overlays, body radius, reach
//   BUILDING  building models and what hangs on them (banners, smoke, lamps,
//             label heights), wall height
//   VEHICLE   land, sea and air craft: hulls, models, wakes
//   PROP      village props (fences, lampposts, scarecrows, boats at a jetty);
//             trees (`tree`, Nature tunes each species on top of it and caps
//             the canopy), shrubs and small plants (`shrub`), crops (`crop`)
//   FOOTPRINT tiles a building or a village occupies: building plots, build
//             radius, territory, streets, field plots, walls, harbours, berths
//
// Modern-era builders: model at the design size and multiply by these.
//
// Round 24 (docs/WORLD-SCALE.md): everything that moves (people, animals,
// cars, trains, ships, aircraft) is half its round-14 size, so streets and
// squares have room to spare; buildings, trees and footprints keep theirs.

const S = 0.6; // the land: buildings, props, footprints (round 14)
const M = 0.3; // what moves: creatures and vehicles (round 24, half of S)

export const UNIT = {
  scale: M,
  // the creature factor relative to the round-14 world (0.6): gaps and
  // overlays that were tuned in world units beside a 0.6x person (talking
  // circles, ranks, icons over heads) multiply by it
  rel: M / S,
  // melee reach shrinks with the bodies (ranged reach is about the world)
  reach(r) {
    return r <= 1.5 ? r * M : r;
  },
};

export const BUILDING = {
  scale: S,
};

export const VEHICLE = {
  sea: M,
  land: M,
  // road vehicles (cars, vans, trucks, buses, trams, ambulances, fire
  // engines, tractors): their designs were drawn small beside a person (a car
  // about as long as a person is tall), so they take a larger factor than
  // `land`: 1.15x, a car a little over two people long and about two thirds
  // of a cottage's width (round 22: at 1.6x a car read 1.6 times too big
  // beside the people and an Industrial sedan was nearly as long as a
  // cottage); round 24 halved them with the people, so a car is now about a
  // third of a cottage's width. Trains (half a house per car), carts and
  // engines of war keep `land`.
  road: M * 1.15,
  air: M,
  // the craft factor relative to the round-14 world (0.6), as UNIT.rel
  rel: M / S,
  of(cls, road = false) {
    return cls === 'land' ? (road ? this.road : this.land) : cls === 'air' ? this.air : this.sea;
  },
};

export const PROP = {
  scale: S,
  // trees a little larger than the buildings (a grown oak about two houses
  // tall), so woods still read as woods at mid and far zoom
  tree: 0.68,
  // bushes, flowers, reeds, cacti, stumps
  shrub: 0.8,
  // crop rows on farm plots (stalk height; the plot itself is a tile)
  crop: S,
  // grass, sedge and meadow tufts (height; they spread by its square root):
  // a tuft about ankle to knee high beside a person, not as tall as one
  grass: 0.5,
};

export const FOOTPRINT = {
  // village distances (build radius, territory, streets, field plots, walls)
  scale: S,
  // a design footprint (tiles at round-13 size) in tiles today; never below one
  tiles(n) {
    return Math.max(1, Math.round(n * S));
  },
  // a design distance in tiles today (keeps a floor so tiny gaps stay open)
  dist(d, min = 1) {
    return Math.max(min, d * S);
  },
  // a design distance in whole tiles (loops and spirals)
  cells(d, min = 1) {
    return Math.max(min, Math.round(d * S));
  },
};

// Design height of a person (world units at scale 1); labels and picking use it.
export const PERSON_H = 0.6;

// Smallest on-screen size (CSS pixels) a creature or craft keeps for picking:
// at half size a person at mid zoom is only a few pixels tall, so a click
// within this many pixels of one still selects it.
export const PICK_PX = 14;
