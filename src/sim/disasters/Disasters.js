// BASELINE implementation (to be replaced by the Effects & Disasters owner).
// Owns: fire spread (world.fire), lava flow, meteors, earthquakes, tornadoes,
// volcanoes, lightning strikes, plague, floods... Gameplay consequences must be
// applied to the world (types, flora, heights) and to units/buildings through
// their public APIs (game.units.damageArea, game.civ.damageArea).
export class Disasters {
  constructor(game) {
    this.game = game;
  }
  tick(step) {}
  // Start a fire at a tile (other modules may call this, e.g. lightning).
  ignite(tx, ty, intensity = 1) {
    this.game.world.setFire(tx, ty, intensity);
  }
}
