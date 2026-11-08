import { SEA_LEVEL, FLORA_INFO } from '../../world/constants.js';
import { law, regionName, rand, ageMod, fireFactor, withAge } from './util.js';

// Natural calamities (World Law `calamityNatural`, default off): a scheduler
// that now and then strikes a land location with an earthquake, tornado,
// meteor, volcano, lightning storm or wildfire, posting one 'disaster'
// notice per strike. It runs on game time, never strikes in the first few
// minutes of a world, keeps strikes well apart (rate scaled by
// `calamityFrequency` and map size) and waits while a big set piece is
// still playing, so the world is shaken rather than wrecked.

const FIRST_STRIKE = 240; // game seconds of peace after a world starts
const BASE_GAP = 170; // mean game seconds between strikes at frequency 1 (256 map)

const KINDS = [
  ['earthquake', 1],
  ['tornado', 1],
  ['meteor', 1.2],
  ['volcano', 0.45],
  ['storm', 1],
  ['wildfire', 1.2],
];

const LINES = {
  earthquake: 'The ground heaves and splits beneath %.',
  tornado: 'A tornado spins out of the sky over %.',
  meteor: 'A falling star crashes into %.',
  volcano: 'The earth tears open and a volcano rises in %.',
  storm: 'A lightning storm rakes %.',
  wildfire: 'A wildfire breaks out in %.',
  blizzard: 'A howling blizzard buries %.',
  plague: 'A plague breaks out in %.',
};

export class Calamities {
  constructor(ds) {
    this.ds = ds;
    this.game = ds.game;
    this.next = -1;
    this.log = []; // {t, kind, x, z, text} for tooling / chronicle
    this.rng = this.game.rng.fork('calamity');
  }

  reset() {
    this.next = -1;
    this.log.length = 0;
  }

  _gap() {
    const g = this.game;
    const f = Math.max(0.1, Number(law(g, 'calamityFrequency', 1)) || 1);
    const scale = Math.sqrt(Math.max(0.25, (g.world.w * g.world.h) / (256 * 256)));
    return (BASE_GAP / f / scale) * (0.65 + this.rng.next() * 0.7);
  }

  tick(step) {
    const g = this.game;
    if (!law(g, 'calamityNatural', false)) {
      this.next = -1;
      return;
    }
    const now = g.time.total;
    if (this.next < 0) this.next = Math.max(now + this._gap(), FIRST_STRIKE + this.rng.next() * 60);
    if (now < this.next) return;
    // let a running set piece finish first (but never stall for long)
    if (this.ds.active.some((e) => !e.isAftermath)) {
      if (this._waitSince == null) this._waitSince = now;
      if (now - this._waitSince < 60) {
        this.next = now + 15;
        return;
      }
    }
    this._waitSince = null;
    this.next = now + this._gap();
    this.strike();
  }

  // Base weights bent by the current World Age: Embers favours wildfire and
  // eruptions, Tempests storms and tornadoes, Rime blizzards (and few
  // fires), Blight plague outbreaks, Twilight falling stars...
  _weights() {
    const g = this.game;
    const m = (k, d = 1) => ageMod(g, k, d);
    const temp = m('temperature', 0);
    const fire = fireFactor(g);
    const id = g.age?.id;
    const w = Object.fromEntries(KINDS);
    w.wildfire *= fire;
    w.volcano *= temp > 0.1 ? 1.8 : 1;
    w.storm *= m('storms') * Math.sqrt(m('lightning'));
    w.tornado *= Math.pow(m('storms'), 0.8);
    w.meteor *= id === 'twilight' ? 2 : 1;
    w.earthquake *= id === 'iron' ? 1.5 : 1;
    w.blizzard = temp < -0.2 ? 2.4 : 0;
    w.plague = m('plague') > 1.3 ? 0.9 * m('plague') : 0;
    return w;
  }

  _pickKind() {
    const w = this._weights();
    let tot = 0;
    for (const k in w) tot += w[k];
    let r = this.rng.next() * tot;
    for (const k in w) {
      r -= w[k];
      if (r <= 0) return k;
    }
    return 'meteor';
  }

  // A random land location; `pred` refines the choice (e.g. forests).
  _pickSpot(pred) {
    const w = this.game.world;
    const m = 10;
    let fallback = null;
    for (let k = 0; k < 160; k++) {
      const tx = m + Math.floor(this.rng.next() * (w.w - 2 * m)),
        ty = m + Math.floor(this.rng.next() * (w.h - 2 * m));
      const i = w.idx(tx, ty);
      const h = w.height[i];
      if (h < SEA_LEVEL + 0.4 || h > 12) continue;
      // keep away from the previous strike
      const last = this.log[this.log.length - 1];
      if (last && Math.hypot(tx - last.x, ty - last.z) < 30) continue;
      if (!fallback) fallback = [tx, ty];
      if (!pred || pred(tx, ty, i)) return [tx, ty];
    }
    return fallback;
  }

  strike(kind = this._pickKind()) {
    const g = this.game;
    const ds = this.ds;
    const w = g.world;
    const forest = (tx, ty) => {
      let n = 0;
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const f = w.flora[w.idx(w.clampTx(tx + dx), w.clampTy(ty + dy))];
          if (f && FLORA_INFO[f].isTree) n++;
        }
      return n > 12;
    };
    const flatish = (tx, ty) => w.slopeAt(tx, ty) < 1.2;
    const spot = this._pickSpot(kind === 'wildfire' ? forest : kind === 'volcano' || kind === 'earthquake' ? flatish : null);
    if (!spot) return null;
    const x = spot[0] + 0.5,
      z = spot[1] + 0.5;
    try {
      if (kind === 'earthquake') ds.earthquake(x, z, rand(10, 16));
      else if (kind === 'tornado') ds.tornado(x, z);
      else if (kind === 'meteor') ds.meteor(x, z, { size: rand(2.5, 5) });
      else if (kind === 'volcano') ds.volcano(x, z, rand(7, 9));
      else if (kind === 'storm') ds.add(new StormStrikes(ds, x, z));
      else if (kind === 'wildfire') {
        // a dry-lightning strike sparks the blaze
        ds.lightning(x, z, { natural: true, ignite: true });
        for (let k = 0; k < 4; k++) ds.ignite(spot[0] + Math.round(rand(-2, 2)), spot[1] + Math.round(rand(-2, 2)), 1);
      } else if (kind === 'blizzard') {
        // a howling snowstorm: snow weather, fires snuffed out, the cold bites
        if (law(g, 'skyWeather', true) !== false) g.atmosphere?.setWeather?.('snow', 1, 60);
        w.forEachInRadius(x, z, 26, (tx, ty, d, i) => {
          if (w.fire[i] > 0) ds.extinguish(tx, ty);
        });
        for (const u of g.units?.query?.(x, z, 26) || []) g.units.addStatus?.(u, 'chilled', 40);
      } else if (kind === 'plague') {
        // an outbreak in the nearest settlement (or wherever people are)
        const v = (g.civ?.villages || []).filter((v) => v && v.alive !== false && (v.x ?? v.cx) != null);
        const pick = v.length ? v[Math.floor(this.rng.next() * v.length)] : null;
        const px = pick ? pick.x ?? pick.cx : x,
          pz = pick ? pick.z ?? pick.cz : z;
        if (!ds.plague(px, pz, 4)) return null;
        spot[0] = Math.floor(px);
        spot[1] = Math.floor(pz);
      }
    } catch (err) {
      console.error('[calamity]', kind, err);
      return null;
    }
    const text = withAge(g, kind, LINES[kind].replace('%', regionName(g, spot[0] + 0.5, spot[1] + 0.5)));
    this.log.push({ t: g.time.total, kind, x: spot[0], z: spot[1], text });
    if (this.log.length > 64) this.log.shift();
    try {
      g.notify?.(text, 'disaster', { x, z });
    } catch (e) {
      /* the feed is optional */
    }
    return kind;
  }
}

// A passing lightning storm: a handful of strikes scattered around a point
// over ~12 s, with storm weather if the atmosphere supports it. Whether the
// strikes ignite the land follows the `calamityLightning` law.
class StormStrikes {
  constructor(ds, x, z) {
    this.ds = ds;
    this.game = ds.game;
    this.x = x;
    this.z = z;
    this.t = 0;
    this.n = 4 + Math.floor(Math.random() * 5);
    this.nextT = 0.5;
    try {
      if (law(this.game, 'skyWeather', true) !== false) this.game.atmosphere?.setWeather?.('storm', 1, 45);
    } catch (e) {
      /* weather is optional */
    }
  }
  update(vt) {
    if (vt <= 0) return true;
    this.t += vt;
    if (this.t >= this.nextT && this.n > 0) {
      this.n--;
      this.nextT = this.t + rand(1.2, 3);
      const a = Math.random() * Math.PI * 2,
        r = Math.sqrt(Math.random()) * 14;
      const w = this.game.world;
      const x = Math.min(w.w - 2, Math.max(2, this.x + Math.cos(a) * r)),
        z = Math.min(w.h - 2, Math.max(2, this.z + Math.sin(a) * r));
      this.ds.lightning(x, z, { natural: true });
    }
    return this.n > 0;
  }
}
