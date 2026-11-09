import { mulberry32, approach, smoothstep } from './util.js';

// Weather state machine. Holds the requested weather and eases a set of
// continuous "mix" channels toward it so every visual (clouds, sky greys,
// rain density, fog) fades in and out smoothly. Auto weather picks the next
// spell by itself when game.settings.autoWeather is on.

export const WEATHER_TYPES = ['clear', 'rain', 'storm', 'snow', 'fog'];

// Target mix channels for each weather type at intensity i (0..1).
function targets(type, i) {
  const t = { cover: 0.52, overcast: 0, rain: 0, snow: 0, storm: 0, fog: 0, wind: 0.32 };
  switch (type) {
    case 'rain':
      t.cover = 0.72 + 0.22 * i;
      t.overcast = 0.5 + 0.3 * i;
      t.rain = i;
      t.fog = 0.12 * i;
      t.wind = 0.42 + 0.2 * i;
      break;
    case 'storm':
      t.cover = 1;
      t.overcast = 0.75 + 0.25 * i;
      t.rain = 0.75 + 0.25 * i;
      t.storm = i;
      t.fog = 0.08;
      t.wind = 0.72 + 0.25 * i;
      break;
    case 'snow':
      t.cover = 0.8;
      t.overcast = 0.42 + 0.3 * i;
      t.snow = i;
      t.fog = 0.18 * i;
      t.wind = 0.3 + 0.15 * i;
      break;
    case 'fog':
      t.cover = 0.3;
      t.overcast = 0.25 + 0.2 * i;
      t.fog = i;
      t.wind = 0.1;
      break;
    default:
      t.cover = 0.5 + 0.14 * i;
      break;
  }
  return t;
}

export class Weather {
  constructor(game) {
    this.game = game;
    this.rng = mulberry32((game.params.seed || 1) * 7 + 13);
    this.type = 'clear';
    this.intensity = 0;
    this.remaining = null; // game seconds left for a timed spell
    this.mix = { cover: 0.42, overcast: 0, rain: 0, snow: 0, storm: 0, fog: 0, wind: 0.32 };
    this.wetness = 0; // global surface wetness 0..1
    this.snowCover = 0; // global snow accumulation 0..1
    this.morningMist = 0;
    this.nextAuto = 150 + this.rng() * 120; // first auto change (game s)
    this.autoHeld = 0;
    this._wetT = 0;
    const p = game.params.weather;
    if (p && p !== 'clear') {
      this.set(p, 1, null);
      this.snap();
      this.autoHeld = 1e9; // a requested weather stays until changed
    }
  }

  set(type, intensity = 1, duration = null) {
    if (!WEATHER_TYPES.includes(type)) type = 'clear';
    this.type = type;
    this.intensity = type === 'clear' ? 0 : Math.max(0, Math.min(1, intensity ?? 1));
    this.remaining = duration != null && duration > 0 ? duration : null;
  }

  // Jump straight to the target (no easing).
  snap() {
    Object.assign(this.mix, targets(this.type, this.intensity || 0));
    if (this.type === 'rain' || this.type === 'storm') this.wetness = 0.8;
    if (this.type === 'snow') this.snowCover = 0.7;
  }

  // Fixed simulation step (game seconds).
  tick(step) {
    const g = this.game;
    if (this.remaining != null) {
      this.remaining -= step;
      if (this.remaining <= 0) {
        this.remaining = null;
        this.set('clear', 0);
        this.nextAuto = g.time.total + this.breakLength(90, 150);
      }
    }
    const auto = (g.laws?.skyWeather ?? g.settings.autoWeather) !== false;
    if (auto && this.remaining == null && g.time.total > this.nextAuto && g.time.total > this.autoHeld) this.autoPick();

    // surface wetness / snow cover (global + per tile)
    const m = this.mix;
    const wetTarget = Math.min(1, m.rain * 1.1);
    const k = wetTarget > this.wetness ? 0.035 : 0.006;
    this.wetness += (wetTarget - this.wetness) * Math.min(1, k * step * 4);
    const snowTarget = m.snow > 0.2 ? 1 : 0;
    this.snowCover += (snowTarget - this.snowCover) * Math.min(1, (snowTarget ? 0.01 : 0.004) * step * 4);

    this._wetT += step;
    if (this._wetT >= 0.5) {
      const dtw = this._wetT;
      this._wetT = 0;
      const world = g.world;
      const wet = world.wetness;
      if (wet) {
        const rate = m.rain * 0.06 * dtw;
        const dry = 0.008 * dtw;
        const temp = world.temperature;
        if (rate > 0.0005) {
          for (let i = 0; i < wet.length; i++) {
            const v = wet[i] + rate - dry * temp[i];
            wet[i] = v > 1 ? 1 : v;
          }
        } else if (this.wetness < 0.999) {
          for (let i = 0; i < wet.length; i++) {
            if (wet[i] > 0) {
              const v = wet[i] - dry * (0.5 + temp[i]);
              wet[i] = v < 0 ? 0 : v;
            }
          }
        }
      }
    }
  }

  // Combined storminess: the age's storm modifier times the weatherStorms law.
  stormFactor() {
    const g = this.game;
    // read the age directly (game time): eased render-side copies would be
    // stale during fastForward, ff boots and slow frames
    return Math.max(0, (g.age?.mods?.storms ?? 1) * (g.laws?.weatherStorms ?? 1));
  }

  // Fair-weather break after a spell: stormy ages / laws shorten it a lot.
  breakLength(base, spread) {
    const k = Math.max(1, this.stormFactor());
    return (base + this.rng() * spread) / Math.pow(k, 0.9);
  }

  autoPick() {
    const g = this.game;
    if (this.type !== 'clear') {
      // every spell is followed by a fair-weather break
      this.set('clear', 0);
      this.nextAuto = g.time.total + this.breakLength(110, 180);
      return;
    }
    const world = g.world;
    // How cold is the land? (sample a sparse grid)
    let cold = 0,
      n = 0;
    for (let i = 0; i < world.size; i += 97) {
      if (world.height[i] >= 0) {
        cold += world.temperature[i] < 0.3 ? 1 : 0;
        n++;
      }
    }
    cold = n ? cold / n : 0;
    const hour = g.time.hour;
    const sk = this.stormFactor();
    const early = g.time.total < 420 / Math.max(1, sk * sk); // no storms in the first minutes (sooner in stormy ages)
    // seasonal odds: spring showers, summer storms, autumn fog and rain,
    // winter snow; ages and the weatherStorms law bend them
    const season = Math.floor(g.time.season ?? 1.5) % 4;
    const W = [
      { rain: 0.42, storm: 0.06, snow: 0.02, fog: 0.08 },
      { rain: 0.2, storm: 0.22, snow: 0.0, fog: 0.03 },
      { rain: 0.32, storm: 0.07, snow: 0.04, fog: 0.22 },
      { rain: 0.12, storm: 0.03, snow: 0.38, fog: 0.12 },
    ][season];
    const age = this.atm?.ageState;
    const temp = g.age?.mods?.temperature ?? age?.temp ?? 0;
    const stormK = sk;
    const hot = Math.max(0, temp) * 2,
      chill = Math.max(0, -temp) * 2;
    const wet = 1 - 0.7 * hot; // hot ages are clear and dry
    const w = {
      clear: 0.3 + 0.5 * hot,
      rain: W.rain * wet * (1 - 0.5 * chill),
      storm: early ? 0 : (W.storm + 0.06 * Math.max(0, stormK - 1)) * stormK * stormK * (1 - 0.4 * hot),
      snow: (W.snow + 0.25 * chill) * (0.4 + 1.2 * cold + 1.5 * chill) * (1 - hot),
      fog: W.fog * wet * (hour < 10 || hour > 19 ? 1.4 : 0.7),
    };
    let sum = 0;
    for (const v of Object.values(w)) sum += v;
    let r = this.rng() * sum;
    let type = 'clear';
    for (const [k, v] of Object.entries(w)) {
      if ((r -= v) <= 0) {
        type = k;
        break;
      }
    }
    if (type === 'clear') {
      this.nextAuto = g.time.total + this.breakLength(60, 120);
      return;
    }
    const intensity = 0.55 + this.rng() * 0.45;
    const dur = type === 'storm' ? (45 + this.rng() * 50) * Math.min(1.8, 0.8 + 0.25 * stormK) : season === 0 && type === 'rain' ? 35 + this.rng() * 45 : 60 + this.rng() * 100;
    // auto spells carry their own duration, so they end by themselves even
    // when the skyWeather law is switched off mid-spell (then it stays clear)
    this.set(type, intensity, dur);
    this.nextAuto = g.time.total + dur;
  }

  // Per rendered frame: ease the mix channels.
  update(dt) {
    const t = targets(this.type, this.intensity);
    const m = this.mix;
    // clouds build first, then the rain follows; rain stops before skies clear
    m.cover = approach(m.cover, t.cover, 0.22, dt);
    m.overcast = approach(m.overcast, t.overcast, m.overcast < t.overcast ? 0.3 : 0.18, dt);
    const ready = t.overcast > 0 ? smoothstep(0.2, 0.75, m.overcast / Math.max(0.01, t.overcast)) : 1;
    m.rain = approach(m.rain, t.rain * ready, t.rain > m.rain ? 0.35 : 0.6, dt);
    m.snow = approach(m.snow, t.snow * ready, 0.3, dt);
    m.storm = approach(m.storm, t.storm * ready, 0.35, dt);
    m.fog = approach(m.fog, Math.max(t.fog, this.morningMist), 0.25, dt);
    m.wind = approach(m.wind, t.wind, 0.3, dt);
  }

  // What game.env.weather reports: the dominant current weather.
  report(out) {
    const m = this.mix;
    let type = 'clear',
      v = 0;
    if (m.storm > 0.25) {
      type = 'storm';
      v = m.storm;
    } else if (m.rain > 0.05) {
      type = 'rain';
      v = m.rain;
    } else if (m.snow > 0.05) {
      type = 'snow';
      v = m.snow;
    } else if (m.fog > 0.3 && this.type === 'fog') {
      type = 'fog';
      v = m.fog;
    }
    if (this.type !== 'clear' && type === 'clear') {
      // transition in progress: report the requested type, ramping
      type = this.type;
      v = Math.max(m.rain, m.snow, m.storm, this.type === 'fog' ? m.fog : 0, 0.02);
    }
    out.type = type;
    out.intensity = Math.round(Math.min(1, v) * 1000) / 1000;
    return out;
  }
}
