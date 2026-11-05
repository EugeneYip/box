// BASELINE implementation (to be replaced by the Effects & Disasters owner).
//
// PUBLIC CONTRACT (other modules call these; keep the signatures stable):
//   game.fx.emit(type, pos, opts?)       one-shot effect at a world position
//       pos = {x, y?, z}  (y defaults to the surface height)
//       types: 'smoke' 'fire' 'embers' 'explosion' 'dust' 'splash' 'sparkle'
//              'blood' 'debris' 'heal' 'spawn' 'lightning' 'steam' 'magic'
//              'leaves' 'snowpuff' 'build' 'death'
//       opts: { scale=1, count, color, dir:{x,y,z}, duration }
//   game.fx.burst(type, pos, count, opts?)   convenience: emit many
//   game.fx.addLight(pos, color, intensity, duration)  transient point light
//   game.fx.screenFlash(color, intensity)      brief full-screen flash
// All calls must be cheap no-ops when an effect type is unknown.
export class Effects {
  constructor(game) {
    this.game = game;
  }
  emit(type, pos, opts = {}) {}
  burst(type, pos, count = 8, opts = {}) {
    for (let i = 0; i < count; i++) this.emit(type, pos, opts);
  }
  addLight(pos, color, intensity = 1, duration = 0.5) {}
  screenFlash(color = 0xffffff, intensity = 1) {}
  update(dt) {}
}
