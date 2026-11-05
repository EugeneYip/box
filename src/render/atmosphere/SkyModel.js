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
  { s: -1.0, zen: '#060f29', hor: '#152447', glow: '#000000', belt: '#000000', halo: '#000000', key: '#000000', keyI: 0, hemiS: '#3a5c9e', hemiG: '#1b2030', hemiI: 0.95, exp: 1.55, sky: 1.0 },
  { s: -0.3, zen: '#071029', hor: '#172649', glow: '#000000', belt: '#000000', halo: '#000000', key: '#000000', keyI: 0, hemiS: '#3a5c9e', hemiG: '#1b2030', hemiI: 0.95, exp: 1.55, sky: 1.0 },
  { s: -0.17, zen: '#0c1a40', hor: '#253563', glow: '#2c2450', belt: '#000000', halo: '#000000', key: '#000000', keyI: 0, hemiS: '#40609e', hemiG: '#1e2232', hemiI: 0.95, exp: 1.5, sky: 1.0 },
  { s: -0.09, zen: '#172a5e', hor: '#5a5288', glow: '#a8483a', belt: '#3a2c56', halo: '#40202a', key: '#c04848', keyI: 0.0, hemiS: '#4e5f9c', hemiG: '#2a2430', hemiI: 0.95, exp: 1.38, sky: 1.0 },
  { s: -0.035, zen: '#233d7c', hor: '#a8708c', glow: '#ff5e26', belt: '#6e4468', halo: '#a04020', key: '#ff5a3c', keyI: 0.16, hemiS: '#6a6aa4', hemiG: '#3a2c30', hemiI: 0.9, exp: 1.24, sky: 1.0 },
  { s: 0.0, zen: '#2c4c90', hor: '#d9846c', glow: '#ff7020', belt: '#5c4a72', halo: '#ff7a30', key: '#ff7040', keyI: 0.6, hemiS: '#7a7cb0', hemiG: '#4a3830', hemiI: 0.82, exp: 1.12, sky: 1.0 },
  { s: 0.05, zen: '#3a60a4', hor: '#eba377', glow: '#ff9238', belt: '#53587a', halo: '#ffa050', key: '#ff9a58', keyI: 1.45, hemiS: '#8ba0c8', hemiG: '#5a4634', hemiI: 0.8, exp: 1.04, sky: 1.0 },
  { s: 0.13, zen: '#4370b6', hor: '#efc392', glow: '#ffb45a', belt: '#4a5a82', halo: '#ffc070', key: '#ffbe7e', keyI: 2.35, hemiS: '#9ab4d8', hemiG: '#6a5638', hemiI: 0.82, exp: 1.0, sky: 1.0 },
  { s: 0.25, zen: '#487ec6', hor: '#e2d4b6', glow: '#ffd296', belt: '#000000', halo: '#ffe0b0', key: '#ffd8a6', keyI: 2.85, hemiS: '#a6c4e6', hemiG: '#706040', hemiI: 0.86, exp: 1.0, sky: 1.0 },
  { s: 0.42, zen: '#4685d2', hor: '#c2d9ec', glow: '#fff0d6', belt: '#000000', halo: '#fff2dc', key: '#fff0dc', keyI: 3.1, hemiS: '#acc9ea', hemiG: '#736444', hemiI: 0.9, exp: 1.0, sky: 1.0 },
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
const MOON_KEY = C('#8fb0ff');

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
  static sunDirection(hour, out) {
    const rise = 5.75,
      set = 18.75;
    let theta;
    if (hour >= rise && hour <= set) theta = (Math.PI * (hour - rise)) / (set - rise);
    else {
      let h = hour < rise ? hour + 24 : hour;
      theta = Math.PI + (Math.PI * (h - set)) / (24 - (set - rise));
    }
    const lat = THREE.MathUtils.degToRad(35);
    out.set(Math.cos(theta), Math.sin(theta) * Math.cos(lat), -Math.sin(theta) * Math.sin(lat));
    // a small azimuth twist keeps sunrise/sunset light raking across the view
    const tw = 0.32;
    const x = out.x * Math.cos(tw) - out.z * Math.sin(tw);
    const z = out.x * Math.sin(tw) + out.z * Math.cos(tw);
    out.x = x;
    out.z = z;
    return out.normalize();
  }

  update(hour, w) {
    // w: weather mix {overcast, storm, snow, fog, rain}
    SkyModel.sunDirection(hour, this.sunDir);
    // Moon: roughly opposite the sun, offset so it rides high at midnight and
    // shows a gibbous phase rather than a flat full disc.
    SkyModel.sunDirection((hour + 12.6) % 24, this.moonDir);
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
    this.golden = smooth(-0.04, 0.03, s) * (1 - smooth(0.12, 0.3, s));
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
    let sunI = n.keyI;
    // overcast / storm / fog block direct sun
    const block = Math.min(0.92, oc * (0.72 + 0.2 * storm) + w.fog * 0.45);
    sunI *= 1 - block;
    // desaturate the key under clouds
    const lumKey = this.sunLightColor.r * 0.3 + this.sunLightColor.g * 0.59 + this.sunLightColor.b * 0.11;
    this.sunLightColor.lerp(this._tmp.setRGB(lumKey, lumKey * 1.01, lumKey * 1.06), oc * 0.7);

    const moonUp = smooth(-0.02, 0.15, this.moonDir.y);
    const moonI = 0.62 * smooth(-0.04, -0.17, s) * moonUp * (1 - 0.7 * oc);
    this.moonVis = moonUp * smooth(-0.02, -0.14, s);
    this.keyIsMoon = moonI > sunI;
    if (this.keyIsMoon) {
      // moonlight comes from high up: soft, readable, short shadows
      this.keyDir.copy(this.moonDir);
      this.keyDir.y = Math.max(this.keyDir.y, 0.55);
      this.keyDir.normalize();
      this.keyColor.copy(MOON_KEY);
      this.keyIntensity = moonI;
    } else {
      this.keyDir.copy(this.sunDir);
      // clamp the shadow-casting elevation (~7.5 deg): long but sane shadows
      if (this.keyDir.y < 0.13) {
        const h = Math.hypot(this.keyDir.x, this.keyDir.z) || 1;
        const y = 0.13;
        const k = Math.sqrt(1 - y * y) / h;
        this.keyDir.set(this.keyDir.x * k, y, this.keyDir.z * k);
      }
      this.keyColor.copy(this.sunLightColor);
      this.keyIntensity = sunI;
    }

    this.hemiSky.copy(this._k.hemiS);
    this.hemiGround.copy(this._k.hemiG);
    this.hemiIntensity = n.hemiI * (1 + 0.18 * oc - 0.25 * storm);
    // overcast skylight is greyer
    const hl = this.hemiSky.r * 0.3 + this.hemiSky.g * 0.59 + this.hemiSky.b * 0.11;
    this.hemiSky.lerp(this._tmp.setRGB(hl * 0.96, hl, hl * 1.07), oc * 0.6);
    if (w.snow > 0) this.hemiGround.lerp(this._tmp.setRGB(0.55, 0.6, 0.68), w.snow * 0.5);

    this.exposure = n.exp * (1 + 0.06 * oc) * (1 - 0.1 * storm);

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
    this.cloudLit.copy(this.keyColor).multiplyScalar(this.keyIntensity * 0.42);
    this.cloudShade.copy(this.hemiSky).multiplyScalar(this.hemiIntensity * 0.5);

    // ---- grade ----------------------------------------------------------
    const g = this.golden;
    const nt = this.night;
    this.shadowTint.set(-0.012, -0.002, 0.03).multiplyScalar(1 - 0.4 * oc);
    this.shadowTint.z += nt * 0.012;
    this.highTint.set(0.022 + 0.03 * g, 0.012 + 0.008 * g, -0.012 - 0.03 * g).multiplyScalar((1 - nt * 0.8) * (1 - 0.6 * oc));
    this.saturation = (1.06 + 0.06 * g) * (1 - 0.14 * nt) * (1 - 0.16 * oc - 0.08 * storm) * (1 - 0.1 * w.fog);
    this.vibrance = 0.16 * (1 - 0.5 * oc);
    this.contrast = 1.06 + 0.04 * g - 0.03 * w.fog + 0.04 * storm;
  }
}
