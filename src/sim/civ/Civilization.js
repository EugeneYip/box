// BASELINE implementation (to be replaced by the Civilization owner).
//
// PUBLIC CONTRACT (keep stable, others call these):
//   game.civ.kingdoms                    array of kingdom objects {id, name, color (hex), capital, alive, ...}
//   game.civ.villages                    array of village objects {id, name, kingdom, x, z, population, ...}
//   game.civ.buildings                   array of building objects (see BuildingRenderer)
//   game.civ.kingdomName(id) -> string
//   game.civ.kingdomColor(id) -> hex number
//   game.civ.foundVillage(tx, ty, opts?) -> village|null   (spawns settlers)
//   game.civ.damageArea(x, z, radius, amount, cause)       (buildings take damage / burn)
//   game.civ.seedInitial(n)              create n starting settlements
// Building object fields read by BuildingRenderer:
//   {id, type, tx, ty, w, h (footprint tiles), x, z, rotation, kingdom, village,
//    level, progress (0..1 construction), hp, maxHp, burning (0..1), alive, style}
export class Civilization {
  constructor(game) {
    this.game = game;
    this.kingdoms = [];
    this.villages = [];
    this.buildings = [];
  }
  reset() {
    this.kingdoms.length = 0;
    this.villages.length = 0;
    this.buildings.length = 0;
  }
  kingdomName(id) {
    return this.kingdoms[id]?.name || 'Wanderers';
  }
  kingdomColor(id) {
    return this.kingdoms[id]?.color ?? 0xffffff;
  }
  foundVillage(tx, ty, opts = {}) {
    // Baseline: just spawn a handful of humans.
    const g = this.game;
    for (let i = 0; i < 6; i++) g.units.spawn('human', tx + 0.5 + g.rng.float(-1.5, 1.5), ty + 0.5 + g.rng.float(-1.5, 1.5), { age: g.rng.float(16, 30) });
    return null;
  }
  damageArea(x, z, radius, amount, cause) {}
  seedInitial(n = 3) {}
  tick(step) {}
}
