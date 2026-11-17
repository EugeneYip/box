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
//             trees stay as Nature sets them (`tree`)
//   FOOTPRINT tiles a building or a village occupies: building plots, build
//             radius, territory, streets, field plots, walls, harbours, berths
//
// Modern-era builders: model at the design size and multiply by these.

const S = 0.6;

export const UNIT = {
  scale: S,
  // melee reach shrinks with the bodies (ranged reach is about the world)
  reach(r) {
    return r <= 1.5 ? r * S : r;
  },
};

export const BUILDING = {
  scale: S,
};

export const VEHICLE = {
  sea: S,
  land: S,
  air: S,
  of(cls) {
    return cls === 'land' ? this.land : cls === 'air' ? this.air : this.sea;
  },
};

export const PROP = {
  scale: S,
  tree: 1,
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
