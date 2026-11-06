import { P, limb } from '../ModelBuilder.js';

// Quadruped channel layout (shared by every four-legged model):
// 0 bodyX 1 bodyZ 2 bodyScale 3 headX 4 headY 5 tailX 6 tailY
// 7 legFL 8 legFR 9 legBL 10 legBR 11 earL(z) 12 earR(z) 13 jaw 14 - 15 -
function quadBones(p) {
  return [
    { name: 'body', parent: -1, pivot: p.body, ch: [0, -1, 1, 2] },
    { name: 'head', parent: 0, pivot: p.head, ch: [3, 4, -1, -1] },
    { name: 'tail', parent: 0, pivot: p.tail, ch: [5, 6, -1, -1] },
    { name: 'legFL', parent: 0, pivot: p.fl, ch: [7, -1, -1, -1] },
    { name: 'legFR', parent: 0, pivot: [-p.fl[0], p.fl[1], p.fl[2]], ch: [8, -1, -1, -1] },
    { name: 'legBL', parent: 0, pivot: p.bl, ch: [9, -1, -1, -1] },
    { name: 'legBR', parent: 0, pivot: [-p.bl[0], p.bl[1], p.bl[2]], ch: [10, -1, -1, -1] },
    { name: 'earL', parent: 1, pivot: p.ear, ch: [-1, -1, 11, -1] },
    { name: 'earR', parent: 1, pivot: [-p.ear[0], p.ear[1], p.ear[2]], ch: [-1, -1, 12, -1] },
    { name: 'jaw', parent: 1, pivot: p.jaw || p.head, ch: [13, -1, -1, -1] },
  ];
}
const LEGS = [
  ['legFL', 1, 1],
  ['legFR', -1, 1],
  ['legBL', 1, -1],
  ['legBR', -1, -1],
];
// Four legs: each a tapered cylinder from its pivot to the ground plus a hoof/paw.
function legs(B, pv, opt) {
  for (const [bone, sx, sz] of LEGS) {
    const piv = sz > 0 ? pv.fl : pv.bl;
    const x = piv[0] * sx,
      z = piv[2];
    const top = piv[1] + (opt.topExtra ?? 0.02);
    const l = limb([x, top, z], [x * (opt.splay ?? 1), opt.foot ?? 0.03, z + (opt.lean ?? 0)], opt.r0, opt.r1, 7);
    B.add(l.geo, { ...l.o, bone, mat: opt.mat });
    if (opt.hoof) B.add(P.cyl(opt.r1 * 1.12, opt.r1 * 1.18, opt.hoofH ?? 0.03, 8), { pos: [x * (opt.splay ?? 1), (opt.hoofH ?? 0.03) / 2, z + (opt.lean ?? 0)], bone, mat: opt.hoof });
    if (opt.paw) B.add(P.sphere(1, 8, 5), { pos: [x * (opt.splay ?? 1), opt.paw[1] * 0.8, z + (opt.lean ?? 0) + opt.paw[2] * 0.35], scl: opt.paw, bone, mat: opt.pawMat || opt.mat });
  }
}
function eyes(B, x, y, z, r, mat = 'eye') {
  for (const s of [1, -1]) B.add(P.sphere(r, 7, 5), { pos: [x * s, y, z], scl: [0.75, 1.05, 0.9], bone: 'head', mat });
}

const COMMON = {
  eye: { color: 0x15100d, rough: 0.2 },
  hoof: { color: 0x2f2620, rough: 0.5 },
  nose: { color: 0x1e1816, rough: 0.35 },
  pink: { color: 0xe89a98, rough: 0.6 },
  ivory: { color: 0xeadfc4, rough: 0.5 },
  white: { color: 0xf5f3ee, noise: 'fur', rough: 0.85 },
  amber: { color: 0xe8a020, rough: 0.2, emissive: 0.35 },
};

// ---------------------------------------------------------------------------
const sheepPV = { body: [0, 0.24, 0], head: [0, 0.29, 0.14], tail: [0, 0.27, -0.17], fl: [0.062, 0.19, 0.1], bl: [0.062, 0.19, -0.1], ear: [0.045, 0.33, 0.19] };
export const sheepModel = {
  id: 'sheep',
  rig: 'quad',
  height: 0.38,
  radius: 0.32,
  legLen: 0.18,
  halfWidth: 0.13,
  aoHeight: 0.12,
  gait: { stride: 0.3, walkAmp: 0.5, runAmp: 0.85, bob: 0.012, run: 'bound', grazeX: 0.95 },
  bones: quadBones(sheepPV),
  slots: [],
  materials: { wool: { src: 'A', noise: 'wool', rough: 0.95 }, face: { src: 'B', noise: 'fur', rough: 0.8 }, ...COMMON },
  build(B) {
    B.with({ bone: 'body', mat: 'wool' }, () => {
      B.add(P.sphere(1, 12, 9), { pos: [0, 0.245, -0.01], scl: [0.122, 0.105, 0.165] });
      const puffs = [[0.07, 0.29, 0.08, 0.072], [-0.07, 0.29, 0.08, 0.072], [0.075, 0.292, -0.06, 0.074], [-0.075, 0.292, -0.06, 0.074], [0, 0.33, 0.0, 0.08], [0, 0.322, -0.1, 0.074], [0, 0.315, 0.1, 0.07], [0.092, 0.23, 0.02, 0.068], [-0.092, 0.23, 0.02, 0.068], [0.08, 0.22, -0.11, 0.064], [-0.08, 0.22, -0.11, 0.064], [0, 0.245, -0.165, 0.07], [0.055, 0.205, 0.12, 0.058], [-0.055, 0.205, 0.12, 0.058], [0, 0.19, 0.0, 0.08]];
      for (const [x, y, z, r] of puffs) B.add(P.ico(r, 1), { pos: [x, y, z], rot: [x * 20, z * 30, 0] });
    });
    legs(B, sheepPV, { r0: 0.019, r1: 0.016, mat: 'face', hoof: 'hoof', hoofH: 0.024 });
    B.with({ bone: 'head' }, () => {
      B.add(P.sphere(1, 12, 9), { pos: [0, 0.3, 0.215], rot: [0.35, 0, 0], scl: [0.05, 0.058, 0.072], mat: 'face' });
      B.add(P.ico(0.052, 1), { pos: [0, 0.352, 0.185], mat: 'wool' });
      B.add(P.sphere(0.01, 6, 4), { pos: [0, 0.272, 0.275], scl: [1.6, 0.8, 0.8], mat: 'nose' });
      eyes(B, 0.039, 0.322, 0.243, 0.0095);
    });
    for (const s of [1, -1]) B.add(P.sphere(1, 8, 5), { pos: [0.077 * s, 0.326, 0.19], rot: [0, 0, -0.35 * s], scl: [0.036, 0.011, 0.019], bone: s > 0 ? 'earL' : 'earR', mat: 'face' });
    B.add(P.ico(0.036, 1), { pos: [0, 0.255, -0.2], bone: 'tail', mat: 'wool' });
  },
  palette: { A: [[0xf3efe5, 50], [0xeadfc4, 20], [0xb9b3aa, 14], [0x4a433f, 8]], B: [[0x3a3330, 55], [0xe6d8c2, 35], [0x8a6a52, 10]] },
};

// ---------------------------------------------------------------------------
const cowPV = { body: [0, 0.34, 0], head: [0, 0.42, 0.24], tail: [0, 0.43, -0.25], fl: [0.083, 0.27, 0.165], bl: [0.083, 0.27, -0.17], ear: [0.06, 0.45, 0.3] };
export const cowModel = {
  id: 'cow',
  rig: 'quad',
  height: 0.52,
  radius: 0.42,
  legLen: 0.26,
  halfWidth: 0.14,
  aoHeight: 0.18,
  gait: { stride: 0.42, walkAmp: 0.42, runAmp: 0.75, bob: 0.01, run: 'gallop', grazeX: 0.85 },
  bones: quadBones(cowPV),
  slots: ['sex'],
  materials: { hide: { src: 'A', src2: 'B', noise: 'spots', rough: 0.75 }, muzzle: { color: 0xe8b8a6, rough: 0.6 }, tuft: { src: 'C', noise: 'fur', rough: 0.9 }, ...COMMON },
  build(B) {
    B.with({ bone: 'body', mat: 'hide' }, () => {
      B.add(P.sphere(1, 14, 10), { pos: [0, 0.34, -0.01], scl: [0.132, 0.125, 0.25] });
      B.add(P.sphere(1, 12, 9), { pos: [0, 0.35, 0.13], scl: [0.128, 0.138, 0.12] });
      B.add(P.sphere(1, 12, 9), { pos: [0, 0.36, -0.16], scl: [0.128, 0.128, 0.11] });
      B.add(P.sphere(1, 10, 7), { pos: [0, 0.225, -0.1], scl: [0.05, 0.035, 0.055], mat: 'pink', slot: 'sex', opt: 0 });
    });
    legs(B, cowPV, { r0: 0.033, r1: 0.026, mat: 'hide', hoof: 'hoof', hoofH: 0.034 });
    B.with({ bone: 'head' }, () => {
      B.add(P.sphere(1, 12, 9), { pos: [0, 0.425, 0.33], rot: [0.32, 0, 0], scl: [0.068, 0.072, 0.1], mat: 'hide' });
      B.add(P.sphere(1, 10, 8), { pos: [0, 0.376, 0.405], scl: [0.064, 0.048, 0.048], mat: 'muzzle' });
      for (const s of [1, -1]) {
        B.add(P.sphere(0.008, 5, 4), { pos: [0.022 * s, 0.38, 0.452], mat: 'nose', minor: true });
        const h = P.tube([[0.045 * s, 0.475, 0.31], [0.085 * s, 0.5, 0.305], [0.1 * s, 0.53, 0.3]], (t) => 0.014 * (1 - t * 0.8), 6, 5);
        B.add(h, { mat: 'ivory' });
      }
      eyes(B, 0.056, 0.442, 0.352, 0.011);
      B.add(P.sphere(1, 8, 6), { pos: [0, 0.478, 0.31], scl: [0.04, 0.02, 0.03], mat: 'tuft' });
    });
    for (const s of [1, -1]) B.add(P.sphere(1, 8, 5), { pos: [0.088 * s, 0.448, 0.295], rot: [0, 0, -0.3 * s], scl: [0.045, 0.013, 0.026], bone: s > 0 ? 'earL' : 'earR', mat: 'hide' });
    B.with({ bone: 'tail' }, () => {
      B.add(P.tube([[0, 0.43, -0.255], [0, 0.36, -0.285], [0, 0.25, -0.285]], 0.008, 8, 5), { mat: 'hide' });
      B.add(P.sphere(1, 7, 5), { pos: [0, 0.235, -0.284], scl: [0.018, 0.035, 0.018], mat: 'tuft' });
    });
  },
  palette: {
    combos: [
      [0xf4efe6, 0x2a2626, 0x2a2626, 40],
      [0x8a5634, 0xf2ece2, 0x5a3420, 25],
      [0xc8955c, 0xf2ece2, 0x7a5030, 20],
      [0x2c2828, 0xf0ebe2, 0x1c1a1a, 15],
    ],
  },
};

// ---------------------------------------------------------------------------
const pigPV = { body: [0, 0.18, 0], head: [0, 0.2, 0.12], tail: [0, 0.21, -0.17], fl: [0.058, 0.11, 0.085], bl: [0.058, 0.11, -0.09], ear: [0.04, 0.26, 0.17] };
export const pigModel = {
  id: 'pig',
  rig: 'quad',
  height: 0.3,
  radius: 0.3,
  legLen: 0.1,
  halfWidth: 0.11,
  aoHeight: 0.1,
  gait: { stride: 0.22, walkAmp: 0.5, runAmp: 0.8, bob: 0.01, run: 'gallop', grazeX: 0.5 },
  bones: quadBones(pigPV),
  slots: [],
  materials: { skin: { src: 'A', src2: 'B', noise: 'spots', rough: 0.6 }, snout: { src: 'C', rough: 0.55 }, ...COMMON },
  build(B) {
    B.add(P.sphere(1, 14, 10), { pos: [0, 0.18, -0.01], scl: [0.106, 0.1, 0.165], bone: 'body', mat: 'skin' });
    legs(B, pigPV, { r0: 0.024, r1: 0.021, mat: 'skin', hoof: 'hoof', hoofH: 0.02, topExtra: 0.0 });
    B.with({ bone: 'head' }, () => {
      B.add(P.sphere(1, 12, 9), { pos: [0, 0.205, 0.16], scl: [0.078, 0.075, 0.075], mat: 'skin' });
      B.add(P.cyl(0.036, 0.038, 0.045, 12), { pos: [0, 0.188, 0.232], rot: [Math.PI / 2, 0, 0], mat: 'snout' });
      for (const s of [1, -1]) B.add(P.sphere(0.008, 5, 4), { pos: [0.013 * s, 0.19, 0.256], scl: [1, 1.3, 0.5], mat: 'nose', minor: true });
      eyes(B, 0.04, 0.228, 0.215, 0.0085);
    });
    for (const s of [1, -1]) B.add(P.cone(0.03, 0.055, 6), { pos: [0.048 * s, 0.272, 0.185], rot: [0.9, 0, -0.4 * s], scl: [1, 1, 0.45], bone: s > 0 ? 'earL' : 'earR', mat: 'skin' });
    B.add(P.torus(0.018, 0.0055, 4, 10, Math.PI * 1.7), { pos: [0, 0.215, -0.185], rot: [0, Math.PI / 2, 0], bone: 'tail', mat: 'skin' });
  },
  palette: {
    combos: [
      [0xf2aaa2, 0xf2aaa2, 0xe8807e, 50],
      [0xf6c4b8, 0x5a4a48, 0xe8908a, 22],
      [0x8a6450, 0x4a3428, 0x6a4a3c, 14],
      [0xf0d0c4, 0xf0d0c4, 0xe89a90, 14],
    ],
  },
};

// ---------------------------------------------------------------------------
// Chicken (biped): 0 bodyX 1 bodyZ 2 bodyScale 3 headX 4 headY 5 tailX 7 legL 8 legR 9 wingL 10 wingR
export const chickenModel = {
  id: 'chicken',
  rig: 'chicken',
  height: 0.24,
  radius: 0.2,
  legLen: 0.08,
  halfWidth: 0.06,
  aoHeight: 0.08,
  gait: { stride: 0.12, walkAmp: 0.6, runAmp: 0.9, bob: 0.008 },
  bones: [
    { name: 'body', parent: -1, pivot: [0, 0.12, 0], ch: [0, -1, 1, 2] },
    { name: 'head', parent: 0, pivot: [0, 0.16, 0.045], ch: [3, 4, -1, -1] },
    { name: 'tail', parent: 0, pivot: [0, 0.15, -0.06], ch: [5, -1, -1, -1] },
    { name: 'legL', parent: -1, pivot: [0.022, 0.085, 0], ch: [7, -1, -1, -1] },
    { name: 'legR', parent: -1, pivot: [-0.022, 0.085, 0], ch: [8, -1, -1, -1] },
    { name: 'wingL', parent: 0, pivot: [0.05, 0.15, 0.02], ch: [-1, -1, 9, -1] },
    { name: 'wingR', parent: 0, pivot: [-0.05, 0.15, 0.02], ch: [-1, -1, 10, -1] },
  ],
  slots: ['sex'],
  materials: {
    feather: { src: 'A', noise: 'feather', rough: 0.85 },
    sickle: { src: 'B', noise: 'feather', rough: 0.4 },
    comb: { color: 0xd8302a, rough: 0.5 },
    beak: { color: 0xf0b030, rough: 0.45 },
    leg: { color: 0xe8a830, rough: 0.6 },
    ...COMMON,
  },
  build(B) {
    B.with({ bone: 'body', mat: 'feather' }, () => {
      B.add(P.sphere(1, 12, 9), { pos: [0, 0.125, -0.005], scl: [0.058, 0.06, 0.08] });
      B.add(P.sphere(1, 10, 8), { pos: [0, 0.118, 0.045], scl: [0.05, 0.052, 0.045] });
    });
    B.with({ bone: 'tail' }, () => {
      B.add(P.sphere(1, 8, 6), { pos: [0, 0.172, -0.072], rot: [-0.55, 0, 0], scl: [0.02, 0.05, 0.034], mat: 'feather', slot: 'sex', opt: 0 });
      for (const [x, r] of [[0.008, 0.25], [-0.008, -0.25], [0, 0]]) B.add(P.tube([[x, 0.15, -0.06], [x * 2, 0.22, -0.09], [x * 3, 0.24, -0.14], [x * 3, 0.2, -0.17]], (t) => 0.012 * (1 - t * 0.6), 8, 4), { mat: 'sickle', slot: 'sex', opt: 1, rot: [0, r, 0] });
    });
    B.with({ bone: 'head' }, () => {
      B.add(P.sphere(1, 8, 6), { pos: [0, 0.17, 0.05], scl: [0.03, 0.04, 0.03], mat: 'feather' });
      B.add(P.sphere(0.034, 10, 8), { pos: [0, 0.202, 0.065], mat: 'feather' });
      B.add(P.cone(0.012, 0.032, 6), { pos: [0, 0.198, 0.104], rot: [Math.PI / 2, 0, 0], scl: [1, 1, 0.7], mat: 'beak' });
      B.add(P.sphere(1, 6, 5), { pos: [0, 0.178, 0.094], scl: [0.008, 0.015, 0.008], mat: 'comb' });
      for (const [y, z, r] of [[0.236, 0.078, 0.012], [0.242, 0.062, 0.013], [0.235, 0.046, 0.011]]) {
        B.add(P.sphere(r, 6, 5), { pos: [0, y, z], scl: [0.6, 1, 1], mat: 'comb', slot: 'sex', opt: 0 });
        B.add(P.sphere(r * 1.45, 6, 5), { pos: [0, y + 0.006, z], scl: [0.6, 1, 1], mat: 'comb', slot: 'sex', opt: 1 });
      }
      eyes(B, 0.026, 0.208, 0.083, 0.0065);
    });
    for (const s of [1, -1]) {
      B.add(P.sphere(1, 9, 7), { pos: [0.054 * s, 0.13, -0.005], rot: [-0.15, 0, 0], scl: [0.014, 0.042, 0.064], bone: s > 0 ? 'wingL' : 'wingR', mat: 'feather' });
      const leg = s > 0 ? 'legL' : 'legR';
      B.add(P.cyl(0.006, 0.0055, 0.075, 5), { pos: [0.022 * s, 0.05, 0], bone: leg, mat: 'leg' });
      for (const a of [-0.5, 0, 0.5]) B.add(P.box(0.006, 0.004, 0.03), { pos: [0.022 * s + Math.sin(a) * 0.012, 0.003, Math.cos(a) * 0.012], rot: [0, a, 0], bone: leg, mat: 'leg', minor: true });
    }
  },
  palette: { combos: [[0xf6f2ea, 0x2a4a3a, 0, 40], [0xb0663a, 0x1e3a30, 0, 30], [0x2c2a2a, 0x24443a, 0, 12], [0xdaa456, 0x6a2a20, 0, 18]] },
};

// ---------------------------------------------------------------------------
const deerPV = { body: [0, 0.34, 0], head: [0, 0.4, 0.15], tail: [0, 0.39, -0.18], fl: [0.054, 0.29, 0.12], bl: [0.054, 0.29, -0.13], ear: [0.035, 0.575, 0.21] };
export const deerModel = {
  id: 'deer',
  rig: 'quad',
  height: 0.62,
  radius: 0.4,
  legLen: 0.29,
  halfWidth: 0.09,
  aoHeight: 0.2,
  gait: { stride: 0.42, walkAmp: 0.4, runAmp: 0.95, bob: 0.01, run: 'bound', grazeX: 1.1 },
  bones: quadBones(deerPV),
  slots: ['antlers', 'young'],
  materials: { coat: { src: 'A', src2: 'B', noise: 'counter', rough: 0.85 }, cream: { src: 'B', noise: 'fur', rough: 0.85 }, ...COMMON },
  build(B) {
    B.with({ bone: 'body', mat: 'coat' }, () => {
      B.add(P.sphere(1, 14, 10), { pos: [0, 0.34, 0], scl: [0.084, 0.098, 0.185] });
      B.add(P.sphere(1, 12, 9), { pos: [0, 0.35, 0.11], scl: [0.085, 0.104, 0.09] });
      B.add(P.sphere(1, 10, 8), { pos: [0, 0.37, -0.168], scl: [0.06, 0.07, 0.03], mat: 'cream' });
      // fawn spots
      for (let i = 0; i < 12; i++) {
        const x = (i % 2 ? 1 : -1) * (0.03 + (i % 3) * 0.012),
          z = -0.13 + (i / 12) * 0.25;
        B.add(P.sphere(0.011, 5, 4), { pos: [x, 0.425 - Math.abs(x) * 0.6, z], mat: 'white', slot: 'young', opt: 1 });
      }
    });
    legs(B, deerPV, { r0: 0.018, r1: 0.012, mat: 'coat', hoof: 'hoof', hoofH: 0.022 });
    B.with({ bone: 'head' }, () => {
      B.add(P.sphere(1, 10, 8), { pos: [0, 0.462, 0.18], rot: [-0.55, 0, 0], scl: [0.044, 0.105, 0.05], mat: 'coat' });
      B.add(P.sphere(1, 12, 9), { pos: [0, 0.545, 0.232], rot: [0.28, 0, 0], scl: [0.046, 0.048, 0.07], mat: 'coat' });
      B.add(P.sphere(1, 9, 7), { pos: [0, 0.527, 0.29], scl: [0.03, 0.03, 0.042], mat: 'coat' });
      B.add(P.sphere(0.012, 6, 5), { pos: [0, 0.528, 0.328], mat: 'nose' });
      eyes(B, 0.038, 0.556, 0.252, 0.0095);
      B.with({ slot: 'antlers', opt: 1, mat: 'ivory' }, () => {
        for (const s of [1, -1]) {
          B.add(P.tube([[0.028 * s, 0.582, 0.215], [0.065 * s, 0.64, 0.2], [0.095 * s, 0.7, 0.17], [0.105 * s, 0.765, 0.14]], (t) => 0.009 * (1 - t * 0.55), 10, 5));
          B.add(P.tube([[0.07 * s, 0.648, 0.2], [0.072 * s, 0.69, 0.23], [0.068 * s, 0.725, 0.25]], (t) => 0.006 * (1 - t * 0.5), 6, 4));
          B.add(P.tube([[0.097 * s, 0.71, 0.168], [0.12 * s, 0.745, 0.19], [0.135 * s, 0.77, 0.2]], (t) => 0.006 * (1 - t * 0.5), 6, 4));
        }
      });
    });
    for (const s of [1, -1]) B.add(P.sphere(1, 8, 6), { pos: [0.07 * s, 0.585, 0.205], rot: [0, 0, -0.35 * s], scl: [0.046, 0.014, 0.025], bone: s > 0 ? 'earL' : 'earR', mat: 'coat' });
    B.add(P.sphere(1, 7, 5), { pos: [0, 0.38, -0.19], scl: [0.022, 0.036, 0.016], bone: 'tail', mat: 'cream' });
  },
  palette: { combos: [[0xa86c3e, 0xf2e4c8, 0, 55], [0x8a5a36, 0xe8d8bc, 0, 30], [0xc08a5a, 0xf6ecd8, 0, 15]] },
};

// ---------------------------------------------------------------------------
const rabbitPV = { body: [0, 0.08, 0], head: [0, 0.11, 0.05], tail: [0, 0.09, -0.08], fl: [0.024, 0.065, 0.045], bl: [0.036, 0.055, -0.04], ear: [0.015, 0.16, 0.065] };
export const rabbitModel = {
  id: 'rabbit',
  rig: 'quad',
  hop: true,
  height: 0.24,
  radius: 0.16,
  legLen: 0.04,
  halfWidth: 0.055,
  aoHeight: 0.05,
  gait: { stride: 0.32, walkAmp: 0.7, runAmp: 1.0, bob: 0.0, run: 'hop', grazeX: 0.4 },
  bones: quadBones(rabbitPV),
  slots: [],
  materials: { fur: { src: 'A', src2: 'B', noise: 'counter', rough: 0.9 }, tail: { src: 'B', noise: 'wool', rough: 0.95 }, ...COMMON },
  build(B) {
    B.with({ bone: 'body', mat: 'fur' }, () => {
      B.add(P.sphere(1, 12, 9), { pos: [0, 0.085, -0.012], scl: [0.054, 0.056, 0.074] });
      for (const s of [1, -1]) B.add(P.sphere(1, 9, 7), { pos: [0.034 * s, 0.07, -0.04], scl: [0.03, 0.04, 0.045] });
    });
    for (const s of [1, -1]) {
      B.add(P.cyl(0.0095, 0.009, 0.06, 5), { pos: [0.024 * s, 0.035, 0.048], bone: s > 0 ? 'legFL' : 'legFR', mat: 'fur' });
      B.add(P.sphere(1, 7, 5), { pos: [0.04 * s, 0.013, -0.025], scl: [0.015, 0.013, 0.038], bone: s > 0 ? 'legBL' : 'legBR', mat: 'fur' });
    }
    B.with({ bone: 'head' }, () => {
      B.add(P.sphere(1, 11, 9), { pos: [0, 0.13, 0.072], scl: [0.038, 0.037, 0.042], mat: 'fur' });
      B.add(P.sphere(0.0075, 5, 4), { pos: [0, 0.127, 0.112], mat: 'pink' });
      eyes(B, 0.028, 0.142, 0.09, 0.0075);
    });
    for (const s of [1, -1]) B.add(P.sphere(1, 8, 6), { pos: [0.02 * s, 0.215, 0.058], rot: [-0.25, 0, -0.18 * s], scl: [0.015, 0.058, 0.0075], bone: s > 0 ? 'earL' : 'earR', mat: 'fur' });
    B.add(P.ico(0.021, 1), { pos: [0, 0.098, -0.09], bone: 'tail', mat: 'tail' });
  },
  palette: { combos: [[0x9c8670, 0xf0ece4, 0, 45], [0xb8b0a8, 0xf4f2ee, 0, 20], [0xf4f2ee, 0xffffff, 0, 15], [0xc89a6a, 0xf2e6d4, 0, 20]] },
};

// ---------------------------------------------------------------------------
const wolfPV = { body: [0, 0.25, 0], head: [0, 0.3, 0.17], tail: [0, 0.275, -0.2], fl: [0.048, 0.2, 0.12], bl: [0.048, 0.2, -0.13], ear: [0.03, 0.36, 0.215], jaw: [0, 0.3, 0.255] };
export const wolfModel = {
  id: 'wolf',
  rig: 'quad',
  height: 0.4,
  radius: 0.36,
  legLen: 0.2,
  halfWidth: 0.08,
  aoHeight: 0.14,
  gait: { stride: 0.36, walkAmp: 0.48, runAmp: 0.95, bob: 0.01, run: 'gallop', grazeX: 0.7, wag: true },
  bones: quadBones(wolfPV),
  slots: [],
  materials: { fur: { src: 'A', src2: 'B', noise: 'counter', rough: 0.9 }, belly: { src: 'B', noise: 'fur', rough: 0.9 }, ...COMMON },
  build(B) {
    B.with({ bone: 'body', mat: 'fur' }, () => {
      B.add(P.sphere(1, 14, 10), { pos: [0, 0.255, -0.03], scl: [0.07, 0.078, 0.19] });
      B.add(P.sphere(1, 12, 9), { pos: [0, 0.262, 0.1], scl: [0.078, 0.092, 0.095] });
      B.add(P.sphere(1, 10, 8), { pos: [0, 0.3, 0.16], scl: [0.068, 0.078, 0.06] });
    });
    legs(B, wolfPV, { r0: 0.02, r1: 0.015, mat: 'fur', paw: [0.019, 0.013, 0.026], pawMat: 'belly' });
    B.with({ bone: 'head' }, () => {
      B.add(P.sphere(1, 12, 9), { pos: [0, 0.325, 0.225], scl: [0.055, 0.052, 0.06], mat: 'fur' });
      B.add(P.cyl(0.017, 0.031, 0.09, 8), { pos: [0, 0.312, 0.29], rot: [Math.PI / 2, 0, 0], scl: [1, 1, 0.85], mat: 'fur' });
      B.add(P.sphere(0.013, 6, 5), { pos: [0, 0.318, 0.335], mat: 'nose' });
      eyes(B, 0.031, 0.343, 0.265, 0.0085, 'amber');
    });
    B.add(P.sphere(1, 8, 6), { pos: [0, 0.293, 0.288], scl: [0.02, 0.009, 0.042], bone: 'jaw', mat: 'belly' });
    for (const s of [1, -1]) B.add(P.cone(0.021, 0.055, 5), { pos: [0.034 * s, 0.388, 0.215], rot: [-0.1, 0, -0.25 * s], scl: [1, 1, 0.55], bone: s > 0 ? 'earL' : 'earR', mat: 'fur' });
    B.add(P.tube([[0, 0.275, -0.2], [0, 0.25, -0.29], [0, 0.205, -0.355], [0, 0.165, -0.395]], (t) => 0.02 + Math.sin(Math.PI * Math.pow(t, 0.8)) * 0.022, 12, 7), { bone: 'tail', mat: 'fur' });
  },
  palette: { combos: [[0x8a8a90, 0xdcd8d0, 0, 45], [0x4a4a52, 0x8e8a84, 0, 25], [0xe6e4de, 0xffffff, 0, 12], [0x8a7660, 0xd8ccb8, 0, 18]] },
};

// ---------------------------------------------------------------------------
const bearPV = { body: [0, 0.32, 0], head: [0, 0.38, 0.24], tail: [0, 0.36, -0.27], fl: [0.094, 0.27, 0.17], bl: [0.094, 0.27, -0.16], ear: [0.055, 0.46, 0.28], jaw: [0, 0.37, 0.33] };
export const bearModel = {
  id: 'bear',
  rig: 'quad',
  amble: true,
  height: 0.56,
  radius: 0.45,
  legLen: 0.25,
  halfWidth: 0.15,
  aoHeight: 0.2,
  gait: { stride: 0.4, walkAmp: 0.38, runAmp: 0.7, bob: 0.014, run: 'gallop', grazeX: 0.7, amble: true },
  bones: quadBones(bearPV),
  slots: [],
  materials: { fur: { src: 'A', noise: 'fur', rough: 0.95 }, snout: { src: 'B', noise: 'fur', rough: 0.85 }, paw: { color: 0x2a201a, rough: 0.8 }, ...COMMON },
  build(B) {
    B.with({ bone: 'body', mat: 'fur' }, () => {
      B.add(P.sphere(1, 14, 10), { pos: [0, 0.33, -0.02], scl: [0.145, 0.15, 0.255] });
      B.add(P.sphere(1, 12, 9), { pos: [0, 0.39, 0.12], scl: [0.135, 0.135, 0.12] });
      B.add(P.sphere(1, 12, 9), { pos: [0, 0.335, -0.17], scl: [0.13, 0.13, 0.11] });
      B.add(P.sphere(0.03, 6, 5), { pos: [0, 0.37, -0.28] });
    });
    legs(B, bearPV, { r0: 0.052, r1: 0.044, mat: 'fur', paw: [0.048, 0.03, 0.06], pawMat: 'paw', topExtra: 0.0 });
    B.with({ bone: 'head' }, () => {
      B.add(P.sphere(1, 12, 10), { pos: [0, 0.405, 0.3], scl: [0.085, 0.08, 0.085], mat: 'fur' });
      B.add(P.sphere(1, 10, 8), { pos: [0, 0.378, 0.375], scl: [0.046, 0.04, 0.052], mat: 'snout' });
      B.add(P.sphere(0.017, 7, 5), { pos: [0, 0.39, 0.423], scl: [1.2, 0.9, 0.9], mat: 'nose' });
      eyes(B, 0.042, 0.425, 0.362, 0.0105);
    });
    B.add(P.sphere(1, 8, 6), { pos: [0, 0.355, 0.37], scl: [0.035, 0.014, 0.04], bone: 'jaw', mat: 'snout' });
    for (const s of [1, -1]) B.add(P.sphere(0.03, 8, 6), { pos: [0.064 * s, 0.475, 0.28], scl: [1, 1, 0.6], bone: s > 0 ? 'earL' : 'earR', mat: 'fur' });
  },
  palette: { combos: [[0x6a4630, 0xb08a62, 0, 50], [0x2c2624, 0xa88866, 0, 25], [0x9a6038, 0xc8a070, 0, 25]] },
};

// ---------------------------------------------------------------------------
const foxPV = { body: [0, 0.17, 0], head: [0, 0.2, 0.12], tail: [0, 0.19, -0.14], fl: [0.034, 0.13, 0.085], bl: [0.034, 0.13, -0.09], ear: [0.026, 0.25, 0.16], jaw: [0, 0.2, 0.19] };
export const foxModel = {
  id: 'fox',
  rig: 'quad',
  height: 0.3,
  radius: 0.3,
  legLen: 0.13,
  halfWidth: 0.06,
  aoHeight: 0.1,
  gait: { stride: 0.28, walkAmp: 0.5, runAmp: 0.95, bob: 0.008, run: 'gallop', grazeX: 0.7, wag: true },
  bones: quadBones(foxPV),
  slots: [],
  materials: {
    fur: { src: 'A', src2: 'B', noise: 'counter', rough: 0.85 },
    leg: { src: 'A', color2: 0x2a2220, noise: 'socks', rough: 0.85 },
    bib: { src: 'B', noise: 'fur', rough: 0.85 },
    earback: { color: 0x2a2220, rough: 0.8 },
    ...COMMON,
  },
  build(B) {
    B.with({ bone: 'body', mat: 'fur' }, () => {
      B.add(P.sphere(1, 12, 9), { pos: [0, 0.172, -0.01], scl: [0.052, 0.056, 0.14] });
      B.add(P.sphere(1, 10, 8), { pos: [0, 0.178, 0.08], scl: [0.056, 0.064, 0.065] });
      B.add(P.sphere(1, 8, 6), { pos: [0, 0.165, 0.12], scl: [0.04, 0.048, 0.03], mat: 'bib' });
    });
    legs(B, foxPV, { r0: 0.0135, r1: 0.011, mat: 'leg', foot: 0.012, paw: [0.012, 0.009, 0.018], pawMat: 'earback', topExtra: 0.0 });
    B.with({ bone: 'head' }, () => {
      B.add(P.sphere(1, 12, 9), { pos: [0, 0.222, 0.165], scl: [0.046, 0.042, 0.048], mat: 'fur' });
      B.add(P.cyl(0.01, 0.024, 0.075, 8), { pos: [0, 0.207, 0.222], rot: [Math.PI / 2, 0, 0], scl: [1, 1, 0.85], mat: 'fur' });
      B.add(P.sphere(0.009, 6, 5), { pos: [0, 0.21, 0.259], mat: 'nose' });
      eyes(B, 0.025, 0.234, 0.197, 0.0072, 'amber');
    });
    for (const s of [1, -1]) {
      B.add(P.cone(0.024, 0.06, 5), { pos: [0.03 * s, 0.278, 0.155], rot: [-0.1, 0, -0.22 * s], scl: [1, 1, 0.5], bone: s > 0 ? 'earL' : 'earR', mat: 'fur' });
      B.add(P.cone(0.02, 0.05, 5), { pos: [0.03 * s, 0.274, 0.15], rot: [-0.1, 0, -0.22 * s], scl: [1, 1, 0.4], bone: s > 0 ? 'earL' : 'earR', mat: 'earback' });
    }
    B.with({ bone: 'tail' }, () => {
      B.add(P.tube([[0, 0.19, -0.14], [0, 0.17, -0.22], [0, 0.13, -0.29], [0, 0.105, -0.325]], (t) => 0.018 + Math.sin(Math.PI * Math.pow(t, 0.75)) * 0.034, 12, 7), { mat: 'fur' });
      B.add(P.sphere(0.024, 8, 6), { pos: [0, 0.102, -0.332], scl: [1, 1, 1.25], mat: 'bib' });
    });
  },
  palette: { combos: [[0xd8662a, 0xf6efe4, 0, 70], [0xb84a22, 0xf2e8dc, 0, 20], [0xb8b4ae, 0xf6f4f0, 0, 10]] },
};

export const ANIMAL_MODELS = [sheepModel, cowModel, pigModel, chickenModel, deerModel, rabbitModel, wolfModel, bearModel, foxModel];
