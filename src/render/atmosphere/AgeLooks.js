import * as THREE from 'three';

// Visual identity of each World Age: sky, fog, key light and colour grade.
// Every age must read at a glance, yet stay beautiful. Values are deltas
// applied on top of the time-of-day / weather palette (SkyModel), scaled by
// the ageIntensity law and eased over a few seconds when an age begins.
//
//   zen / hor / hemi / haze : target colour (sRGB hex) and blend amount
//   key        multiply on the key light colour (sun and moon)
//   keyI hemiI exp          multipliers on key / sky light / exposure
//   sat con                 saturation multiplier / contrast offset
//   mid shd                 midtone / shadow tint offsets (perceptual RGB)
//   hazeD                   extra haze density (world units^-1)
//   vig vigC                vignette strength offset and colour
const LOOKS = {
  dawn: {},
  bounty: {
    hor: ['#f4d79a', 0.28], haze: ['#f0d8a0', 0.25], key: '#ffe6b8', keyI: 1.05, hemi: ['#d8c9a2', 0.2],
    sat: 1.14, con: 0.02, mid: [0.035, 0.022, -0.025], hazeD: 0.0006,
  },
  embers: {
    zen: ['#7d5f55', 0.55], hor: ['#e09a5e', 0.55], haze: ['#b98a66', 0.55], hemi: ['#c99a72', 0.38], key: '#ffbf7a',
    keyI: 1.0, hemiI: 0.9, sat: 0.9, con: 0.05, mid: [0.07, 0.02, -0.06], shd: [0.02, -0.004, -0.03], hazeD: 0.004,
    vig: 0.12, vigC: '#4a2414',
  },
  rime: {
    zen: ['#8fb2df', 0.45], hor: ['#d8e6f6', 0.5], haze: ['#cddcf0', 0.5], hemi: ['#b4cdf0', 0.45], key: '#d9e6ff',
    keyI: 0.78, hemiI: 1.12, sat: 0.78, con: 0.02, mid: [-0.035, 0.0, 0.055], shd: [-0.01, 0.0, 0.05], hazeD: 0.0022,
    vig: 0.05, vigC: '#24344c',
  },
  tempests: {
    zen: ['#4c5562', 0.62], hor: ['#7a838e', 0.6], haze: ['#6d7680', 0.55], hemi: ['#7c8796', 0.45], key: '#d8dde6',
    keyI: 0.55, hemiI: 0.85, exp: 0.86, sat: 0.72, con: 0.09, mid: [-0.012, 0.0, 0.018], shd: [-0.01, 0.0, 0.025],
    hazeD: 0.0018, vig: 0.16, vigC: '#141a24',
  },
  lore: {
    zen: ['#3b86e6', 0.25], hor: ['#d6ecff', 0.2], key: '#fff6e8', keyI: 1.05, sat: 1.1, con: 0.035,
    mid: [0.0, 0.008, 0.012], hazeD: -0.0012,
  },
  blight: {
    zen: ['#8e9468', 0.55], hor: ['#bcb47c', 0.6], haze: ['#a9a873', 0.6], hemi: ['#a8a878', 0.42], key: '#e9e6aa',
    keyI: 0.85, sat: 0.68, con: 0.03, mid: [0.012, 0.034, -0.045], shd: [0.0, 0.018, -0.02], hazeD: 0.0035,
    vig: 0.1, vigC: '#2c2c10',
  },
  twilight: {
    zen: ['#2c2558', 0.72], hor: ['#6a5c9e', 0.65], haze: ['#4c4382', 0.6], hemi: ['#5c4f98', 0.55], key: '#bdb0ff',
    keyI: 0.5, hemiI: 0.72, exp: 0.66, sat: 0.84, con: 0.06, mid: [-0.012, -0.024, 0.06], shd: [-0.006, -0.012, 0.05],
    hazeD: 0.0012, vig: 0.2, vigC: '#120a2c',
  },
  iron: {
    zen: ['#6f8296', 0.4], hor: ['#b6c0ca', 0.4], haze: ['#a2acb6', 0.4], hemi: ['#a4b0bc', 0.3], key: '#eef1f6',
    keyI: 0.92, sat: 0.74, con: 0.07, mid: [-0.014, 0.0, 0.016], shd: [-0.01, 0.0, 0.02], hazeD: 0.0008,
    vig: 0.08, vigC: '#1c2028',
  },
};

const COLOR_FIELDS = ['zen', 'hor', 'haze', 'hemi'];
const SCALAR_ONE = ['keyI', 'hemiI', 'exp', 'sat'];
const SCALAR_ZERO = ['con', 'hazeD', 'vig'];

// Eased look state: everything a look can change, as plain numbers.
export class AgeLook {
  constructor() {
    this.cur = AgeLook.neutral();
    this.tgt = AgeLook.neutral();
  }

  static neutral() {
    const n = { key: new THREE.Color(1, 1, 1), vigC: new THREE.Color(0, 0, 0), mid: new THREE.Vector3(), shd: new THREE.Vector3() };
    for (const f of COLOR_FIELDS) n[f] = { c: new THREE.Color(1, 1, 1), k: 0 };
    for (const f of SCALAR_ONE) n[f] = 1;
    for (const f of SCALAR_ZERO) n[f] = 0;
    return n;
  }

  // Build the target from an age id (unknown ids fall back to its mods).
  setTarget(age, intensity) {
    const t = this.tgt;
    const L = LOOKS[age?.id];
    const k = Math.max(0, Math.min(2, intensity ?? 1));
    const def = L || AgeLook.fromMods(age?.mods);
    for (const f of COLOR_FIELDS) {
      const v = def[f];
      if (v) {
        t[f].c.set(v[0]);
        t[f].k = Math.min(0.92, v[1] * k);
      } else t[f].k = 0;
    }
    t.key.set(def.key || '#ffffff').lerp(new THREE.Color(1, 1, 1), 1 - Math.min(1, k));
    for (const f of SCALAR_ONE) t[f] = 1 + ((def[f] ?? 1) - 1) * k;
    for (const f of SCALAR_ZERO) t[f] = (def[f] ?? 0) * k;
    t.mid.fromArray(def.mid || [0, 0, 0]).multiplyScalar(k);
    t.shd.fromArray(def.shd || [0, 0, 0]).multiplyScalar(k);
    t.vigC.set(def.vigC || '#000000');
  }

  // Generic look for ages without a hand-made profile.
  static fromMods(mods) {
    if (!mods) return {};
    const d = {};
    if (mods.skyTint != null) {
      const hex = '#' + new THREE.Color(mods.skyTint).getHexString();
      d.zen = [hex, 0.4];
      d.hor = [hex, 0.4];
      d.haze = [hex, 0.4];
    }
    if (mods.temperature > 0) d.mid = [0.05 * mods.temperature * 2, 0.01, -0.04 * mods.temperature * 2];
    if (mods.temperature < 0) d.mid = [-0.03, 0, 0.05 * -mods.temperature * 2];
    return d;
  }

  // Ease the current look toward the target (k: 0..1 blend this frame).
  ease(k) {
    const c = this.cur,
      t = this.tgt;
    for (const f of COLOR_FIELDS) {
      // colours glide; when a look starts from nothing jump the hue
      if (c[f].k < 0.01) c[f].c.copy(t[f].c);
      else c[f].c.lerp(t[f].c, k);
      c[f].k += (t[f].k - c[f].k) * k;
    }
    c.key.lerp(t.key, k);
    c.vigC.lerp(t.vigC, k);
    c.mid.lerp(t.mid, k);
    c.shd.lerp(t.shd, k);
    for (const f of SCALAR_ONE) c[f] += (t[f] - c[f]) * k;
    for (const f of SCALAR_ZERO) c[f] += (t[f] - c[f]) * k;
  }
}
