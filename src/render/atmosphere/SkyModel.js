import * as THREE from 'three';

// Time-of-day + weather palette for the whole atmosphere.
//
// Everything visual about the sky and the lighting derives from a single set
// of keyframes indexed by the sine of the sun's elevation, so sunrise and
// sunset are symmetric and every transition is continuous. Weather is then
// layered on top (overcast greys, fog whites, storm slate).
//
// Output colours are linear (THREE.Color working space).

const C = (hex) => new THREE.Color(hex); // sRGB hex -> linear working colour

// s = sin(sun elevation)
const KEYS = [
  { s: -1.0, zen: '#060f29', hor: '#152447', glow: '#000000', belt: '#000000', halo: '#000000', key: '#000000', keyI: 0, hemiS: '#4c5f86', hemiG: '#1d2230', hemiI: 1.05, exp: 1.72, sky: 1.0 },
  { s: -0.3, zen: '#071029', hor: '#172649', glow: '#000000', belt: '#000000', halo: '#000000', key: '#000000', keyI: 0, hemiS: '#4c5f86', hemiG: '#1d2230', hemiI: 1.15, exp: 1.85, sky: 1.0 },
  { s: -0.17, zen: '#0c1a40', hor: '#253563', glow: '#2c2450', belt: '#000000', halo: '#000000', key: '#000000', keyI: 0, hemiS: '#50628a', hemiG: '#1e2232', hemiI: 1.05, exp: 1.68, sky: 1.0 },
  { s: -0.09, zen: '#172a5e', hor: '#5a5288', glow: '#a8483a', belt: '#33294e', halo: '#40202a', key: '#c04848', keyI: 0.0, hemiS: '#4e5f9c', hemiG: '#2a2430', hemiI: 1.1, exp: 1.7, sky: 1.0 },
  { s: -0.035, zen: '#233d7c', hor: '#a8708c', glow: '#ff5e26', belt: '#5a3a5c', halo: '#a04020', key: '#ff6a40', keyI: 0.35, hemiS: '#6a6ea6', hemiG: '#3a2c30', hemiI: 1.05, exp: 1.55, sky: 1.0 },
  { s: 0.0, zen: '#2c4c90', hor: '#d9846c', glow: '#ff7020', belt: '#3c3346', halo: '#ff7a30', key: '#ff7a44', keyI: 1.0, hemiS: '#7e86b4', hemiG: '#4a3830', hemiI: 1.0, exp: 1.4, sky: 1.0 },
  { s: 0.05, zen: '#4068a8', hor: '#efb07e', glow: '#ff9238', belt: '#30303e', halo: '#ffa050', key: '#ffa25e', keyI: 2.0, hemiS: '#9eacc4', hemiG: '#5a4634', hemiI: 1.0, exp: 1.25, sky: 1.0 },
  // golden hour spans s ~ 0.0 .. 0.34 (about 16:30-19:00 and 06:00-08:00)
  { s: 0.13, zen: '#4a72b0', hor: '#f1bf88', glow: '#ffb058', belt: '#2a3248', halo: '#ffc070', key: '#ffb468', keyI: 2.65, hemiS: '#b8b4bc', hemiG: '#74593a', hemiI: 0.9, exp: 1.12, sky: 1.0 },
  { s: 0.25, zen: '#4f7cbc', hor: '#edc796', glow: '#ffc27a', belt: '#000000', halo: '#ffd498', key: '#ffc47c', keyI: 2.9, hemiS: '#b8bccb', hemiG: '#786044', hemiI: 0.88, exp: 1.06, sky: 1.0 },
  { s: 0.34, zen: '#4a80c8', hor: '#e2d2b4', glow: '#ffd8a0', belt: '#000000', halo: '#ffe0b4', key: '#ffd598', keyI: 3.0, hemiS: '#b0c2da', hemiG: '#766246', hemiI: 0.88, exp: 1.03, sky: 1.0 },
  { s: 0.47, zen: '#4685d2', hor: '#c2d9ec', glow: '#fff0d6', belt: '#000000', halo: '#fff2dc', key: '#fff0dc', keyI: 3.15, hemiS: '#acc9ea', hemiG: '#736444', hemiI: 0.9, exp: 1.0, sky: 1.0 },
  { s: 0.82, zen: '#3b7ad0', hor: '#c4ddf1', glow: '#fff8ee', belt: '#000000', halo: '#fff8ee', key: '#fff6ea', keyI: 3.3, hemiS: '#b0cdee', hemiG: '#776848', hemiI: 0.92, exp: 1.0, sky: 1.0 },
  { s: 1.0, zen: '#3b7ad0', hor: '#c4ddf1', glow: '#fff8ee', belt: '#000000', halo: '#fff8ee', key: '#fff6ea', keyI: 3.3, hemiS: '#b0cdee', hemiG: '#776848', hemiI: 0.92, exp: 1.0, sky: 1.0 },
].map((k) => ({
  ...k,
  zen: C(k.zen),
  hor: C(k.hor),
  glow: C(k.glow),
  belt: C(k.belt),
  halo: C(k.halo),
  key: C(k.key),
  hemiS: C(k.hemiS),
  hemiG: C(k.hemiG),
}));

const COLOR_KEYS = ['zen', 'hor', 'glow', 'belt', 'halo', 'key', 'hemiS', 'hemiG'];
const NUM_KEYS = ['keyI', 'hemiI', 'exp', 'sky'];

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

// Weather sky targets (sRGB, daylight values; scaled by ambient brightness).
const OVERCAST = { zen: C('#7b8794'), hor: C('#a6aeb5') };
const STORM = { zen: C('#353e49'), hor: C('#56616a') };
const SNOWSKY = { zen: C('#97a6b8'), hor: C('#c4ccd6') };
const FOGSKY = { zen: C('#a9b6c2'), hor: C('#d2d7d9') };
const MOON_KEY = C('#aabde6');
const MOON_TWILIGHT = C('#8c7ee0');
const HEAT_HAZE = C('#e9d2a6');
const SEASON_LIGHT = [C('#fffbf4'), C('#fff6e6'), C('#ffe9d2'), C('#f6f7fb')]; // spring..winter

export class SkyModel {
  constructor() {
    this.sunDir = new THREE.Vector3(0.5, 0.8, -0.3).normalize();
    this.moonDir = new THREE.Vector3(-0.5, 0.6, 0.3).normalize();
    this.keyDir = new THREE.Vector3();
    this.zenith = new THREE.Color();
    this.horizon = new THREE.Color();
    this.glow = new THREE.Color();
    this.belt = new THREE.Color();
    this.halo = new THREE.Color();
    this.groundHaze = new THREE.Color();
    this.envGround = new THREE.Color();
    this.keyColor = new THREE.Color();
    this.sunLightColor = new THREE.Color();
    this.hemiSky = new THREE.Color();
    this.hemiGround = new THREE.Color();
    this.sunDisc = new THREE.Color();
    this.mistColor = new THREE.Color();
    this.cloudLit = new THREE.Color();
    this.cloudShade = new THREE.Color();
    this.shadowTint = new THREE.Vector3();
    this.highTint = new THREE.Vector3();
    this.midTint = new THREE.Vector3();
    this.keyIntensity = 1;
    this.hemiIntensity = 1;
    this.exposure = 1;
    this.daylight = 1;
    this.night = 0;
    this.golden = 0;
    this.starVis = 0;
    this.moonVis = 0;
    this.sunVis = 1;
    this.keyIsMoon = false;
    this.saturation = 1;
    this.vibrance = 0.15;
    this.contrast = 1.05;
    this._tmp = new THREE.Color();
    this._tmp2 = new THREE.Color();
    this._k = {};
    for (const k of COLOR_KEYS) this._k[k] = new THREE.Color();
  }

  // Sun path: rises in the east (+X), culminates toward -Z (the far side of
  // the default view, so noon shadows fall gently toward the viewer), sets in
  // the west (-X). Day is 13 h long (05:45 – 18:45).
  // opts: { night: 0..1 (longer nights), lat: extra latitude tilt in deg }
  static sunDirection(hour, out, opts = null) {
    const ln = opts?.night || 0;
    const rise = 5.75 + 1.4 * ln,
      set = 18.75 - 1.4 * ln;
    let theta;
    if (hour >= rise && hour <= set) theta = (Math.PI * (hour - rise)) / (set - rise);
    else {
      let h = hour < rise ? hour + 24 : hour;
      theta = Math.PI + (Math.PI * (h - set)) / (24 - (set - rise));
    }
    const lat = THREE.MathUtils.degToRad(35 + (opts?.lat || 0));
    out.set(Math.cos(theta), Math.sin(theta) * Math.cos(lat), -Math.sin(theta) * Math.sin(lat));
    // a small azimuth twist keeps sunrise/sunset light raking across the view
    const tw = 0.32;
    const x = out.x * Math.cos(tw) - out.z * Math.sin(tw);
    const z = out.x * Math.sin(tw) + out.z * Math.cos(tw);
    out.x = x;
    out.z = z;
    return out.normalize();
  }

  // w: weather mix {overcast, storm, snow, fog, rain}
  // age: eased age state {night, temp, tint (Color), tintK} (optional)
  // season: game.time.season in [0, 4) (optional)
  update(hour, w, age = null, season = 1.5) {
    const night = age?.night || 0;
    // seasonal sun height: higher in summer, lower in winter
    const sw = (k) => Math.max(0, 1 - Math.min(Math.abs(season - k), 4 - Math.abs(season - k)));
    const summer = sw(1.5),
      winter = sw(3.5);
    const sunOpts = { night, lat: -7 * summer + 9 * winter };
    SkyModel.sunDirection(hour, this.sunDir, sunOpts);
    // Moon: roughly opposite the sun, offset so it rides high at midnight and
    // shows a gibbous phase rather than a flat full disc.
    SkyModel.sunDirection((hour + 12.6) % 24, this.moonDir, sunOpts);
    this.moonDir.y = Math.abs(this.moonDir.y) * 0.85 + 0.12;
    this.moonDir.normalize();

    const s = this.sunDir.y;
    // ---- keyframe interpolation --------------------------------------
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].s < s) i++;
    const a = KEYS[i],
      b = KEYS[i + 1];
    const t = smooth(0, 1, (s - a.s) / (b.s - a.s));
    for (const k of COLOR_KEYS) this._k[k].copy(a[k]).lerp(b[k], t);
    const n = {};
    for (const k of NUM_KEYS) n[k] = lerp(a[k], b[k], t);

    this.daylight = smooth(-0.1, 0.22, s);
    this.night = 1 - smooth(-0.2, -0.03, s);
    this.golden = smooth(-0.04, 0.03, s) * (1 - smooth(0.3, 0.48, s));
    const oc = Math.min(1, w.overcast);
    const storm = w.storm;

    this.zenith.copy(this._k.zen);
    this.horizon.copy(this._k.hor);
    this.glow.copy(this._k.glow);
    this.belt.copy(this._k.belt);
    this.halo.copy(this._k.halo);

    // ---- weather over the sky ----------------------------------------
    // Brightness of the clear sky drives the overcast greys so night storms
    // stay dark and midday rain stays luminous.
    const skyLum = 0.2 + 0.8 * this.daylight;
    const nightK = 0.12 + 0.88 * this.daylight;
    const tz = this._tmp,
      th = this._tmp2;
    tz.copy(OVERCAST.zen).lerp(STORM.zen, storm);
    th.copy(OVERCAST.hor).lerp(STORM.hor, storm);
    if (w.snow > 0) {
      tz.lerp(SNOWSKY.zen, w.snow * (1 - storm));
      th.lerp(SNOWSKY.hor, w.snow * (1 - storm));
    }
    if (w.fog > 0) {
      tz.lerp(FOGSKY.zen, w.fog * 0.8);
      th.lerp(FOGSKY.hor, w.fog * 0.8);
    }
    // keep a hint of the time-of-day hue in the greys (pink dusk overcast)
    tz.lerp(this._k.zen, 0.22).multiplyScalar(nightK);
    th.lerp(this._k.hor, 0.3).multiplyScalar(nightK);
    this.zenith.lerp(tz, oc);
    this.horizon.lerp(th, oc);
    const clearK = (1 - oc) * (1 - oc);
    this.glow.multiplyScalar(clearK * (1 - 0.6 * w.fog));
    this.halo.multiplyScalar(0.25 + 0.75 * clearK);
    this.belt.multiplyScalar(1 - oc);

    this.groundHaze.copy(this.horizon).multiplyScalar(0.78).lerp(this.zenith, 0.12);
    // IBL ground: an earthy bounce rather than horizon haze
    this.envGround.copy(this._k.hemiG).multiplyScalar(0.8 * skyLum);

    // ---- lights ----------------------------------------------------------
    this.sunLightColor.copy(this._k.key);
    {
      // a slight seasonal cast: fresh spring, warm summer, amber autumn, pale winter
      const si = Math.floor(season) % 4;
      const f = season - Math.floor(season);
      const a = SEASON_LIGHT[si],
        b = SEASON_LIGHT[(si + 1) % 4];
      const t = smooth(0.5, 1.0, f); // hold mid-season, blend into the next
      this._tmp.copy(a).lerp(b, t);
      this.sunLightColor.multiply(this._tmp);
    }
    let sunI = n.keyI;
    // overcast / storm / fog block direct sun
    // storms leave ~20% sun so racing cloud shadows can sweep the land
    const block = Math.min(0.92, Math.pow(oc, 0.75) * (0.9 - 0.2 * storm) + w.fog * 0.45);
    sunI *= 1 - block;
    // desaturate the key under clouds
    const lumKey = this.sunLightColor.r * 0.3 + this.sunLightColor.g * 0.59 + this.sunLightColor.b * 0.11;
    this.sunLightColor.lerp(this._tmp.setRGB(lumKey, lumKey * 1.01, lumKey * 1.06), oc * 0.7);

    const moonUp = smooth(-0.02, 0.15, this.moonDir.y);
    const moonI = 0.92 * smooth(-0.04, -0.17, s) * moonUp * (1 - 0.7 * oc) * (1 - 0.2 * night);
    this.moonVis = moonUp * smooth(-0.02, -0.14, s);
    this.keyIsMoon = moonI > sunI;
    if (this.keyIsMoon) {
      // moonlight comes from high up: soft, readable, short shadows
      this.keyDir.copy(this.moonDir);
      this.keyDir.y = Math.max(this.keyDir.y, 0.55);
      this.keyDir.normalize();
      this.keyColor.copy(MOON_KEY);
      if (night > 0) this.keyColor.lerp(age?.tintK ? age.tint : MOON_TWILIGHT, 0.45 * night);
      this.keyIntensity = moonI;
    } else {
      this.keyDir.copy(this.sunDir);
      // clamp the shadow-casting elevation (~10 deg): long but sane shadows
      if (this.keyDir.y < 0.17) {
        const h = Math.hypot(this.keyDir.x, this.keyDir.z) || 1;
        const y = 0.17;
        const k = Math.sqrt(1 - y * y) / h;
        this.keyDir.set(this.keyDir.x * k, y, this.keyDir.z * k);
      }
      this.keyColor.copy(this.sunLightColor);
      this.keyIntensity = sunI;
    }

    this.hemiSky.copy(this._k.hemiS);
    this.hemiGround.copy(this._k.hemiG);
    this.hemiIntensity = n.hemiI * 1.3 * (1 + 0.1 * oc - 0.45 * storm - 0.12 * w.rain);
    // golden hour: warmer, ~40% weaker sky fill so the raking sun dominates
    const gk = this.golden * (1 - oc);
    this.hemiSky.lerp(this._tmp2.setRGB(0.72, 0.56, 0.4), gk * 0.12);
    this.hemiIntensity *= 1 - 0.3 * gk;
    // overcast skylight is greyer
    const hl = this.hemiSky.r * 0.3 + this.hemiSky.g * 0.59 + this.hemiSky.b * 0.11;
    this.hemiSky.lerp(this._tmp.setRGB(hl * 0.96, hl, hl * 1.07), oc * 0.6);
    if (w.snow > 0) this.hemiGround.lerp(this._tmp.setRGB(0.6, 0.62, 0.66), w.snow * 0.5);
    // snow / winter: keep whites white (neutral skylight, no lilac cast)
    const wint = Math.max(w.snow, winter * 0.7);
    if (wint > 0.01) {
      const hl2 = this.hemiSky.r * 0.3 + this.hemiSky.g * 0.59 + this.hemiSky.b * 0.11;
      this.hemiSky.lerp(this._tmp.setRGB(hl2 * 0.97, hl2, hl2 * 1.04), 0.45 * wint);
    }
    this._wint = wint;

    this.exposure = n.exp * (1 - 0.18 * storm) * (1 - 0.14 * night * this.night);

    // ---- visible discs -----------------------------------------------
    this.sunVis = smooth(-0.03, 0.02, s) * (1 - smooth(0.25, 0.75, oc + w.fog * 0.6));
    this.sunDisc.copy(this._k.key).multiplyScalar(30 * (0.3 + 0.7 * smooth(-0.02, 0.2, s)));
    this.starVis = smooth(-0.06, -0.2, s) * (1 - smooth(0.15, 0.6, oc)) * (1 - w.fog * 0.8);

    // ---- mist / clouds ------------------------------------------------
    // Mist is lit by the sky with a little warm sun.
    this.mistColor
      .copy(this.horizon)
      .multiplyScalar(0.85)
      .lerp(this._tmp.copy(this.sunLightColor).multiplyScalar(0.25 + 0.35 * this.golden), 0.18 * this.daylight * (1 - oc));
    this.cloudLit.copy(this.keyColor).multiplyScalar(this.keyIntensity * 0.36);
    this.cloudShade.copy(this.hemiSky).multiplyScalar(this.hemiIntensity * 0.5);

    // ---- grade ----------------------------------------------------------
    const g = this.golden;
    const nt = this.night;
    this.shadowTint.set(-0.012, -0.002, 0.03).multiplyScalar(1 - 0.4 * oc);
    this.shadowTint.z += nt * 0.012;
    this.highTint.set(0.022 + 0.03 * g, 0.012 + 0.008 * g, -0.012 - 0.03 * g).multiplyScalar((1 - nt * 0.8) * (1 - 0.6 * oc));
    // warm midtone lift through golden hour (not only highlights)
    this.midTint.set(0.018, 0.008, -0.012).multiplyScalar(g * (1 - 0.6 * oc));
    // golden hour: the shadow side cools (sky-lit) instead of everything warming
    this.shadowTint.x -= 0.008 * g;
    this.shadowTint.z += 0.022 * g * (1 - 0.6 * oc);
    if (this._wint) this.shadowTint.multiplyScalar(1 - 0.6 * this._wint); // winter whites stay neutral
    this.saturation = (1.06 + 0.06 * g) * (1 - 0.3 * nt) * (1 - 0.16 * oc - 0.08 * storm) * (1 - 0.1 * w.fog);
    this.vibrance = 0.16 * (1 - 0.5 * oc);
    this.contrast = 1.06 + 0.04 * g - 0.03 * w.fog + 0.04 * storm;
    if (age) this.applyAge(age);
  }

  // Ages give the sky, fog, key light and grade a strong identity
  // (AgeLooks.js). Sky colours are scaled to the current daylight so a
  // daytime look never lights up the night.
  applyAge(age) {
    const L = age.look;
    this.ageHazeD = 0;
    this.ageVig = 0;
    if (L) {
      const dayK = 0.18 + 0.82 * this.daylight;
      const t = this._tmp;
      if (L.zen.k > 0.001) this.zenith.lerp(t.copy(L.zen.c).multiplyScalar(dayK), L.zen.k);
      if (L.hor.k > 0.001) {
        this.horizon.lerp(t.copy(L.hor.c).multiplyScalar(dayK), L.hor.k);
        this.glow.multiplyScalar(1 - 0.35 * L.hor.k);
      }
      if (L.haze.k > 0.001) {
        this.groundHaze.lerp(t.copy(L.haze.c).multiplyScalar(dayK), L.haze.k);
        this.mistColor.lerp(t.copy(L.haze.c).multiplyScalar(dayK), L.haze.k);
      }
      if (L.hemi.k > 0.001) this.hemiSky.lerp(L.hemi.c, L.hemi.k);
      this.sunLightColor.multiply(L.key);
      this.keyColor.multiply(L.key);
      // dark ages keep a readable floor at night: moonlight, sky fill and
      // exposure darken less once the sun is down
      const nk = this.night;
      this.keyIntensity *= this.keyIsMoon ? Math.max(L.keyI, 0.9) : L.keyI;
      this.hemiIntensity *= L.hemiI + (Math.max(L.hemiI, 0.95) - L.hemiI) * nk;
      this.exposure *= L.exp + (Math.max(L.exp, 0.9) - L.exp) * nk;
      this.saturation *= L.sat;
      this.contrast += L.con;
      this.midTint.add(L.mid);
      this.shadowTint.add(L.shd);
      this.ageHazeD = L.hazeD;
      this.ageVig = L.vig;
      this.ageVigC = L.vigC;
      this.cloudLit.copy(this.keyColor).multiplyScalar(this.keyIntensity * 0.36);
      this.cloudShade.copy(this.hemiSky).multiplyScalar(this.hemiIntensity * 0.5);
    }
    const nt = (age.night || 0) * this.night;
    if (nt > 0.001) this.saturation *= 1 - 0.1 * nt;
  }
}
