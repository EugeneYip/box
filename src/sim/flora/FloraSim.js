import { FLORA, TILE } from '../../world/constants.js';

// BASELINE implementation (to be replaced by the Nature owner).
// Plant growth / spreading / seasonal behaviour. Currently: saplings grow.
export class FloraSim {
  constructor(game) {
    this.game = game;
    this._cursor = 0;
  }
  reset() {
    this._cursor = 0;
  }
  tick(step) {
    const world = this.game.world;
    // Process a slice of tiles per tick so the cost is spread out.
    const n = Math.ceil(world.size / 120);
    for (let k = 0; k < n; k++) {
      const i = this._cursor;
      this._cursor = (this._cursor + 1) % world.size;
      if (world.flora[i] && world.floraGrowth[i] < 1) {
        world.floraGrowth[i] = Math.min(1, world.floraGrowth[i] + 0.02);
        world.markDirty('flora', i % world.w, Math.floor(i / world.w));
      }
    }
  }
  stats() {
    const world = this.game.world;
    let trees = 0;
    for (let i = 0; i < world.size; i++) if (world.flora[i] && world.flora[i] <= FLORA.SWAMP_TREE && world.flora[i] !== FLORA.BUSH && world.flora[i] !== FLORA.FLOWERS && world.flora[i] !== FLORA.CACTUS) trees++;
    return { trees };
  }
}
export { TILE };
