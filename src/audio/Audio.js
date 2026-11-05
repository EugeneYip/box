// BASELINE implementation (to be replaced by the Audio owner).
//
// PUBLIC CONTRACT (other modules call these; keep signatures stable):
//   game.audio.play(name, opts?)  one-shot sound. opts: { pos:{x,z}, volume=1, pitch=1 }
//     names: 'ui-click' 'ui-hover' 'ui-open' 'raise' 'lower' 'paint' 'plant'
//            'splash' 'explosion' 'thunder' 'fire-start' 'meteor' 'quake'
//            'build' 'chop' 'mine' 'hit' 'death' 'birth' 'spawn' 'magic'
//            'war-horn' 'bell' 'coin' 'growl' 'bleat' 'error'
//   game.audio.setMuted(bool), game.audio.setVolume(0..1)
// Must never throw and must work before the user has interacted (queue/ignore
// until the AudioContext is unlocked by a user gesture).
export class AudioSystem {
  constructor(game) {
    this.game = game;
    this.muted = !game.params.audio;
    this.volume = 0.8;
  }
  play(name, opts = {}) {}
  setMuted(m) {
    this.muted = m;
  }
  setVolume(v) {
    this.volume = v;
  }
  update(dt) {}
}
