import { P, limb } from '../ModelBuilder.js';

// Original fantasy creatures and ambient fauna models.

// ---------------------------------------------------------------------------
// Stone Golem ("Cairnwarden"): a mossy boulder giant with a glowing heart
// crystal. Uses the humanoid channel layout so it can share poseHumanoid.
export const golemModel = {
  id: 'golem',
  rig: 'humanoid',
  height: 1.75,
  radius: 1.2,
  aoHeight: 0.4,
  aoMin: 0.75,
  bump: 1.4,
  rim: 0.32,
  bones: [
    { name: 'pelvis', parent: -1, pivot: [0, 0.58, 0] },
    { name: 'torso', parent: -1, pivot: [0, 0.6, 0], ch: [0, 1, 2, 11] },
    { name: 'head', parent: 1, pivot: [0, 1.3, 0.08], ch: [3, 4, -1, 12] },
    { name: 'armL', parent: 1, pivot: [0.43, 1.18, 0], ch: [5, -1, 6, -1] },
    { name: 'armR', parent: 1, pivot: [-0.43, 1.18, 0], ch: [7, 13, 8, -1] },
    { name: 'legL', parent: -1, pivot: [0.19, 0.56, 0], ch: [9, -1, -1, -1] },
    { name: 'legR', parent: -1, pivot: [-0.19, 0.56, 0], ch: [10, -1, -1, -1] },
    { name: 'tool', parent: 4, pivot: [-0.52, 0.36, 0.04], ch: [14, -1, -1, -1] },
  ],
  slots: [],
  materials: {
    stone: { src: 'A', noise: 'stone', rough: 0.8, emissive: 0.1 },
    dark: { src: 'B', noise: 'stone', rough: 0.8, emissive: 0.08 },
    moss: { src: 'C', noise: 'wool', rough: 1.0 },
    glow: { color: 0x4fe6d0, emissive: 1.8, rough: 0.2 },
    crystal: { color: 0x3fd8c8, emissive: 1.5, rough: 0.1, metal: 0.2 },
    rune: { color: 0x2fc8e0, emissive: 1.3, rough: 0.3 },
    petal: { color: 0xf2a6c8, rough: 0.7 },
    petal2: { color: 0xf8e070, rough: 0.7 },
    grass: { color: 0x6aa84a, rough: 0.9 },
  },
  build(B) {
    const rock = (r, o) => B.add(P.dodeca(r, 0), { flat: true, ...o });
    for (const s of [1, -1]) {
      const leg = s > 0 ? 'legL' : 'legR';
      rock(0.18, { pos: [0.19 * s, 0.38, 0], scl: [1, 1.35, 1], rot: [0.3, s, 0.2], bone: leg, mat: 'stone' });
      rock(0.18, { pos: [0.2 * s, 0.12, 0.05], scl: [1.1, 0.68, 1.35], rot: [0.1, s * 0.5, 0], bone: leg, mat: 'dark' });
    }
    rock(0.26, { pos: [0, 0.62, 0], scl: [1.3, 0.72, 1.0], rot: [0.2, 0.4, 0], bone: 'pelvis', mat: 'dark' });
    B.with({ bone: 'torso' }, () => {
      rock(0.44, { pos: [0, 0.98, 0], scl: [1.12, 1.0, 0.86], rot: [0.15, 0.3, 0.05], mat: 'stone' });
      rock(0.3, { pos: [0.02, 1.18, -0.1], scl: [1.3, 0.8, 1], rot: [0.5, 0.1, 0.2], mat: 'stone' });
      B.add(P.octa(0.1), { pos: [0, 1.0, 0.36], scl: [0.85, 1.3, 0.6], mat: 'crystal', flat: true });
      // glowing rune cracks across the chest and back
      for (const [x, y, z, rz, l] of [[-0.18, 1.08, 0.33, 0.6, 0.18], [0.2, 0.9, 0.33, -0.5, 0.16], [0.05, 1.22, 0.28, 1.4, 0.14], [-0.1, 0.82, 0.32, -1.2, 0.12], [0.0, 1.05, -0.36, 0.3, 0.22], [0.16, 0.92, -0.33, -0.9, 0.14]])
        B.add(P.box(0.045, l * 1.3, 0.03), { pos: [x, y, z], rot: [0, 0, rz], mat: 'rune' });
      for (const [x, y, z, r] of [[0.13, 0.86, 0.33, 0.035], [-0.16, 1.1, 0.31, 0.03], [0.2, 1.14, 0.27, 0.028]]) B.add(P.octa(r), { pos: [x, y, z], rot: [x * 9, y, z], mat: 'crystal', flat: true });
      // moss cap and shoulders
      B.add(P.sphere(1, 10, 6), { pos: [0, 1.3, -0.08], scl: [0.3, 0.09, 0.3], mat: 'moss' });
      for (const s of [1, -1]) B.add(P.sphere(1, 9, 6), { pos: [0.34 * s, 1.24, 0], scl: [0.16, 0.07, 0.18], mat: 'moss' });
      // grass tufts and little flowers growing on the back
      for (let i = 0; i < 7; i++) {
        const a = i * 2.3,
          x = Math.cos(a) * 0.2,
          z = -0.12 + Math.sin(a) * 0.15;
        B.add(P.cone(0.025, 0.12, 4), { pos: [x, 1.4, z], rot: [Math.sin(a) * 0.4, 0, Math.cos(a) * 0.4], mat: 'grass' });
      }
      for (const [x, z, m] of [[0.12, -0.05, 'petal'], [-0.1, -0.18, 'petal2'], [0.02, -0.25, 'petal']]) B.add(P.sphere(0.03, 6, 4), { pos: [x, 1.43, z], mat: m });
    });
    B.with({ bone: 'head' }, () => {
      rock(0.18, { pos: [0, 1.4, 0.14], scl: [1.1, 0.85, 1], rot: [0.3, 0.2, 0], mat: 'dark' });
      rock(0.1, { pos: [0, 1.5, 0.22], scl: [1.8, 0.5, 0.7], rot: [0, 0, 0.1], mat: 'stone' });
      for (const s of [1, -1]) B.add(P.sphere(0.042, 8, 6), { pos: [0.07 * s, 1.41, 0.29], scl: [1.2, 0.8, 0.6], mat: 'glow' });
    });
    for (const s of [1, -1]) {
      const arm = s > 0 ? 'armL' : 'armR';
      B.with({ bone: arm }, () => {
        rock(0.2, { pos: [0.46 * s, 1.17, 0], rot: [0.4, s, 0.3], mat: 'stone' });
        B.add(P.sphere(1, 8, 5), { pos: [0.47 * s, 1.31, 0], scl: [0.14, 0.06, 0.15], mat: 'moss' });
        rock(0.14, { pos: [0.5 * s, 0.9, 0], scl: [1, 1.55, 1], rot: [0.1, s * 0.7, 0.1], mat: 'dark' });
        rock(0.15, { pos: [0.52 * s, 0.62, 0.02], scl: [1, 1.45, 1], rot: [0.3, s * 0.2, 0.2], mat: 'stone' });
        B.add(P.sphere(1, 8, 5), { pos: [0.55 * s, 0.68, 0.05], scl: [0.08, 0.12, 0.1], mat: 'moss' });
        B.add(P.box(0.04, 0.26, 0.03), { pos: [0.58 * s, 0.9, 0.1], rot: [0.2, 0, 0.3 * s], mat: 'rune' });
        rock(0.19, { pos: [0.53 * s, 0.36, 0.04], scl: [1.05, 0.95, 1.1], rot: [0.6, s * 0.4, 0], mat: 'dark' });
      });
    }
  },
  palette: { combos: [[0x8e8a84, 0x6a6660, 0x6a9a3a, 40], [0xb09a7a, 0x857258, 0x7aa040, 25], [0x707684, 0x50545e, 0x5a8a5a, 20], [0x9a6e5a, 0x6e4c40, 0x7a9a3a, 15]] },
};

// ---------------------------------------------------------------------------
// Tidewyrm: long sea serpent with coral fin frills and luminous spots.
function serpentRadius(t) {
  // t: 0 at the neck, 1 at the tail tip
  return 0.17 * (1 - Math.pow(t, 1.35) * 0.88) * (t < 0.06 ? 0.85 + t * 2.5 : 1);
}
export const serpentModel = {
  id: 'serpent',
  rig: 'serpent',
  height: 1.2,
  radius: 3,
  aoHeight: 0,
  aoMin: 1,
  rim: 0.22,
  bones: [
    { name: 'spine', parent: -1, pivot: [0, 0, 0.3], ch: [0, 1, 2, 3], spine: { k: 2.3, L: 3.4, e0: 0.12 } },
    { name: 'head', parent: 0, pivot: [0, 0.0, 0.32], ch: [4, 5, -1, -1] },
    { name: 'jaw', parent: 1, pivot: [0, -0.02, 0.46], ch: [6, -1, -1, -1] },
    { name: 'finL', parent: 1, pivot: [0.12, 0.06, 0.42], ch: [-1, -1, 7, -1] },
    { name: 'finR', parent: 1, pivot: [-0.12, 0.06, 0.42], ch: [-1, -1, 8, -1] },
  ],
  slots: [],
  materials: {
    scales: { src: 'A', src2: 'B', noise: 'scales', rough: 0.35 },
    belly: { src: 'B', rough: 0.5 },
    // fins carry the accent colour and glow faintly; photophores run down both flanks
    fin: { src: 'C', rough: 0.5, emissive: 0.55 },
    glow: { color: 0x9ff8ff, emissive: 3.2 },
    eye: { color: 0xfff0a0, emissive: 3.4 },
    ivory: { color: 0xeee4cc, rough: 0.4 },
  },
  build(B) {
    const pts = [];
    for (let i = 0; i <= 10; i++) pts.push([0, 0, 0.32 - (i / 10) * 3.4]);
    B.add(P.tube(pts, (t) => serpentRadius(t), 56, 12), { bone: 'spine', mat: 'scales' });
    // dorsal fins and glowing spots
    for (let i = 0; i < 14; i++) {
      const t = 0.04 + i * 0.065;
      const z = 0.32 - t * 3.4;
      const r = serpentRadius(t);
      const h = 0.16 * (1 - t * 0.8);
      B.add(P.slab([[0, 0], [h * 1.4, 0], [h * 0.2, h]], 0.012), { pos: [0, r * 0.85, z + h * 0.7], rot: [0, Math.PI / 2, 0], bone: 'spine', mat: 'fin' });
      for (const s of [1, -1]) B.add(P.sphere((i % 2 ? 0.024 : 0.036) * (1 - t * 0.55), 6, 4), { pos: [r * 0.96 * s, r * 0.12, z], bone: 'spine', mat: 'glow' });
      // a glowing dorsal bead at each fin
      B.add(P.sphere(0.02 * (1 - t * 0.5), 5, 4), { pos: [0, r * 0.98, z], bone: 'spine', mat: 'glow', minor: true });
    }
    // tail fluke
    B.add(P.leaf([[0, 0], [0.1, -0.15], [0.02, -0.4], [0, -0.22], [-0.02, -0.4], [-0.1, -0.15]], 0.012), { pos: [0, 0, -3.08], rot: [Math.PI / 2, 0, 0], bone: 'spine', mat: 'fin' });
    B.with({ bone: 'head' }, () => {
      B.add(P.sphere(1, 14, 10), { pos: [0, 0.045, 0.5], scl: [0.155, 0.125, 0.25], mat: 'scales' });
      B.add(P.sphere(1, 12, 8), { pos: [0, 0.02, 0.73], scl: [0.11, 0.08, 0.17], mat: 'scales' });
      for (const s of [1, -1]) {
        B.add(P.sphere(0.034, 8, 6), { pos: [0.105 * s, 0.11, 0.6], scl: [0.8, 1, 1.2], mat: 'eye' });
        B.add(P.tube([[0.06 * s, 0.13, 0.52], [0.1 * s, 0.2, 0.38], [0.12 * s, 0.24, 0.22]], (t) => 0.026 * (1 - t * 0.85), 8, 5), { mat: 'ivory' });
        B.add(P.sphere(0.012, 5, 4), { pos: [0.035 * s, 0.05, 0.89], mat: 'belly' });
      }
    });
    B.with({ bone: 'jaw' }, () => {
      B.add(P.sphere(1, 12, 8), { pos: [0, -0.07, 0.63], scl: [0.1, 0.05, 0.22], mat: 'belly' });
      for (let i = 0; i < 5; i++) for (const s of [1, -1]) B.add(P.cone(0.012, 0.04, 4), { pos: [0.07 * s * (1 - i * 0.12), -0.02, 0.56 + i * 0.065], mat: 'ivory', minor: true });
    });
    for (const s of [1, -1])
      B.add(P.leaf([[0, 0], [0.22, 0.1], [0.3, 0.0], [0.24, -0.12], [0.02, -0.1]], 0.012), {
        pos: [0.12 * s, 0.06, 0.42],
        rot: [-Math.PI / 2 + 0.2, s > 0 ? 0 : Math.PI, s > 0 ? 0.3 : -0.3],
        bone: s > 0 ? 'finL' : 'finR',
        mat: 'fin',
      });
  },
  palette: { combos: [[0x1d6a7c, 0xd8eedc, 0xff7a4a, 50], [0x2a4c78, 0xe2e8f0, 0xffb040, 30], [0x2e6a4a, 0xe8f0d0, 0xff6080, 20]] },
};

// ---------------------------------------------------------------------------
// Skywyrm: a serpentine flyer with two pairs of leaf-shaped wings, an ember
// crest and a flame-fin tail.
function wyrmRadius(t) {
  return 0.15 * (1 - Math.pow(t, 1.15) * 0.9) * (t < 0.08 ? 0.75 + t * 3 : 1);
}
const wingPts = [[0, 0.1], [0.3, 0.26], [0.72, 0.22], [1.08, 0.02], [0.82, -0.12], [0.45, -0.2], [0.12, -0.16]];
const wingPts2 = wingPts.map(([x, y]) => [x * 0.68, y * 0.75]);
export const wyrmModel = {
  id: 'skywyrm',
  rig: 'wyrm',
  height: 1.0,
  radius: 2.6,
  aoHeight: 0,
  aoMin: 1,
  rim: 0.24,
  bones: [
    { name: 'spine', parent: -1, pivot: [0, 0, 0.45], ch: [0, 1, 2, 3], spine: { k: 2.4, L: 2.5, e0: 0.1 } },
    { name: 'head', parent: 0, pivot: [0, 0.02, 0.5], ch: [4, 5, -1, -1] },
    { name: 'jaw', parent: 1, pivot: [0, 0.0, 0.66], ch: [6, -1, -1, -1] },
    { name: 'wingL1', parent: 0, pivot: [0.1, 0.06, 0.18], ch: [-1, -1, 7, -1] },
    { name: 'wingR1', parent: 0, pivot: [-0.1, 0.06, 0.18], ch: [-1, -1, 8, -1] },
    { name: 'wingL2', parent: 0, pivot: [0.08, 0.05, -0.5], ch: [-1, -1, 9, -1] },
    { name: 'wingR2', parent: 0, pivot: [-0.08, 0.05, -0.5], ch: [-1, -1, 10, -1] },
    { name: 'tipL', parent: 3, pivot: [0.62, 0.06, 0.18], ch: [-1, -1, 11, -1] },
    { name: 'tipR', parent: 4, pivot: [-0.62, 0.06, 0.18], ch: [-1, -1, 12, -1] },
  ],
  slots: [],
  materials: {
    scales: { src: 'A', src2: 'B', noise: 'scales', rough: 0.4 },
    belly: { src: 'B', rough: 0.5, emissive: 0.35 },
    membrane: { src: 'C', rough: 0.6, emissive: 0.18 },
    vein: { src: 'A', rough: 0.5 },
    ember: { color: 0xffa040, emissive: 2.2, rough: 0.3 },
    eye: { color: 0xffe060, emissive: 3 },
    horn: { color: 0x3a3036, rough: 0.4 },
    claw: { color: 0xe8dcc4, rough: 0.4 },
  },
  build(B) {
    const pts = [];
    for (let i = 0; i <= 8; i++) pts.push([0, 0, 0.5 - (i / 8) * 2.4]);
    B.add(P.tube(pts, (t) => wyrmRadius(t), 44, 12), { bone: 'spine', mat: 'scales' });
    // ember spines along the back
    for (let i = 0; i < 16; i++) {
      const t = 0.03 + i * 0.055;
      const z = 0.5 - t * 2.4;
      B.add(P.cone(0.022 * (1 - t * 0.6), 0.09 * (1 - t * 0.6), 4), { pos: [0, wyrmRadius(t) * 0.9, z], rot: [-0.9, 0, 0], bone: 'spine', mat: 'ember' });
    }
    // flame fin at the tail
    B.add(P.leaf([[0, 0], [0.08, -0.12], [0.03, -0.32], [0, -0.42], [-0.03, -0.32], [-0.08, -0.12]], 0.012), { pos: [0, 0.0, -1.86], rot: [Math.PI / 2, 0, 0], scl: [1, 1, 1], bone: 'spine', mat: 'ember' });
    B.add(P.leaf([[0, 0], [0.12, -0.12], [0.05, -0.3], [0, -0.36], [-0.05, -0.3], [-0.12, -0.12]], 0.012), { pos: [0, 0.0, -1.86], rot: [Math.PI / 2, 0, Math.PI / 2], bone: 'spine', mat: 'ember' });
    // tucked legs with claws
    for (const [z, s] of [[0.22, 1], [0.22, -1], [-0.45, 1], [-0.45, -1]]) {
      B.add(P.sphere(1, 8, 6), { pos: [0.1 * s, -0.12, z], scl: [0.04, 0.05, 0.08], bone: 'spine', mat: 'scales' });
      for (const dz of [-0.02, 0.0, 0.02]) B.add(P.cone(0.008, 0.035, 4), { pos: [0.1 * s + dz, -0.17, z + 0.06], rot: [Math.PI * 0.75, 0, 0], bone: 'spine', mat: 'claw', minor: true });
    }
    // wings: two pairs, leaf-shaped membranes with veins
    const wing = (pts, x, z, bone, tipBone, s, scale) => {
      const P2 = pts.map(([px, py]) => [px * s, py]);
      const split = 0.6 * scale;
      // inner panel on the wing bone, outer on the tip bone (cut at x = split)
      const inner = P2.map(([px, py]) => [Math.abs(px) > split ? split * s : px, py]);
      const outer = P2.map(([px, py]) => [Math.abs(px) < split ? split * s : px, py]);
      B.add(P.leaf(inner, 0.014), { pos: [x * s, 0.06, z], rot: [Math.PI / 2, 0, 0], bone, mat: 'membrane' });
      B.add(P.leaf(outer, 0.014), { pos: [x * s, 0.06, z], rot: [Math.PI / 2, 0, 0], bone: tipBone || bone, mat: 'membrane' });
      for (const [vx, vz] of [[0.95, 0.04], [0.7, -0.14], [0.6, 0.2]]) {
        const ex = vx * scale,
          ez = vz * scale;
        const mid = [(x + ex * 0.5) * s, 0.07, z + ez * 0.5];
        const end = [(x + Math.min(ex, split)) * s, 0.07, z + ez * Math.min(1, split / ex)];
        B.add(P.tube([[x * s, 0.07, z], mid, end], 0.012 * scale, 6, 4), { bone, mat: 'vein' });
        if (ex > split) B.add(P.tube([end, [(x + ex) * s, 0.07, z + ez]], 0.008 * scale, 4, 4), { bone: tipBone || bone, mat: 'vein' });
      }
    };
    wing(wingPts, 0.1, 0.18, 'wingL1', 'tipL', 1, 1);
    wing(wingPts, 0.1, 0.18, 'wingR1', 'tipR', -1, 1);
    wing(wingPts2, 0.08, -0.5, 'wingL2', null, 1, 0.68);
    wing(wingPts2, 0.08, -0.5, 'wingR2', null, -1, 0.68);
    B.with({ bone: 'head' }, () => {
      B.add(P.sphere(1, 12, 9), { pos: [0, 0.05, 0.7], scl: [0.1, 0.085, 0.16], mat: 'scales' });
      B.add(P.sphere(1, 10, 8), { pos: [0, 0.025, 0.86], scl: [0.068, 0.052, 0.12], mat: 'scales' });
      for (const s of [1, -1]) {
        B.add(P.sphere(0.024, 7, 5), { pos: [0.072 * s, 0.09, 0.78], scl: [0.8, 0.8, 1.3], mat: 'eye' });
        B.add(P.tube([[0.05 * s, 0.11, 0.7], [0.09 * s, 0.17, 0.56], [0.11 * s, 0.22, 0.42]], (t) => 0.022 * (1 - t * 0.85), 8, 5), { mat: 'horn' });
        B.add(P.sphere(0.008, 5, 4), { pos: [0.025 * s, 0.055, 0.97], mat: 'horn' });
      }
      for (let i = 0; i < 4; i++) B.add(P.cone(0.02 - i * 0.003, 0.08 - i * 0.012, 4), { pos: [0, 0.12, 0.72 - i * 0.07], rot: [-1.0, 0, 0], mat: 'ember' });
    });
    B.add(P.sphere(1, 10, 7), { pos: [0, -0.035, 0.8], scl: [0.062, 0.028, 0.13], bone: 'jaw', mat: 'belly' });
  },
  palette: { combos: [[0x4a3060, 0xffa040, 0xe8803a, 50], [0x24384e, 0x6ff0e0, 0x4ab0c0, 25], [0x5a2420, 0xffc060, 0xd84a2a, 25]] },
};

// ---------------------------------------------------------------------------
// Ambient birds. Channels: 0 bodyX 1 bodyZ 3 headX 4 headY 5 wingL 6 wingR 7 tail 8 tipL 9 tipR
function flyerBones(span) {
  return [
    { name: 'body', parent: -1, pivot: [0, 0, 0], ch: [0, -1, 1, -1] },
    { name: 'head', parent: 0, pivot: [0, 0.01, 0.06 * span], ch: [3, 4, -1, -1] },
    { name: 'wingL', parent: 0, pivot: [0.02 * span, 0.01, 0], ch: [-1, -1, 5, -1] },
    { name: 'wingR', parent: 0, pivot: [-0.02 * span, 0.01, 0], ch: [-1, -1, 6, -1] },
    { name: 'tail', parent: 0, pivot: [0, 0, -0.07 * span], ch: [7, -1, -1, -1] },
    { name: 'tipL', parent: 2, pivot: [0.13 * span, 0.01, 0], ch: [-1, -1, 8, -1] },
    { name: 'tipR', parent: 3, pivot: [-0.13 * span, 0.01, 0], ch: [-1, -1, 9, -1] },
  ];
}
function buildFlyer(B, k, beakLen) {
  B.add(P.sphere(1, 10, 7), { pos: [0, 0, 0], scl: [0.034 * k, 0.034 * k, 0.085 * k], bone: 'body', mat: 'body' });
  B.add(P.sphere(1, 8, 6), { pos: [0, -0.008 * k, 0.03 * k], scl: [0.03 * k, 0.03 * k, 0.04 * k], bone: 'body', mat: 'breast' });
  B.add(P.sphere(0.03 * k, 9, 7), { pos: [0, 0.024 * k, 0.085 * k], bone: 'head', mat: 'head' });
  B.add(P.cone(0.009 * k, beakLen * k, 5), { pos: [0, 0.02 * k, (0.11 + beakLen / 2) * k], rot: [Math.PI / 2, 0, 0], bone: 'head', mat: 'beak' });
  for (const s of [1, -1]) B.add(P.sphere(0.006 * k, 5, 4), { pos: [0.022 * k * s, 0.032 * k, 0.1 * k], bone: 'head', mat: 'eye' });
  B.add(P.leaf([[0, 0], [0.035, -0.02], [0.03, -0.07], [0, -0.06], [-0.03, -0.07], [-0.035, -0.02]].map(([x, y]) => [x * k, y * k]), 0.006 * k), { pos: [0, 0.004 * k, -0.06 * k], rot: [Math.PI / 2, 0, 0], bone: 'tail', mat: 'body' });
  for (const s of [1, -1]) {
    const inner = [[0, 0.045], [0.07, 0.05], [0.13, 0.035], [0.13, -0.03], [0.06, -0.035], [0, -0.03]].map(([x, y]) => [x * s * k, y * k]);
    const outer = [[0.13, 0.035], [0.2, 0.025], [0.27, -0.005], [0.22, -0.03], [0.13, -0.03]].map(([x, y]) => [x * s * k, y * k]);
    B.add(P.leaf(inner, 0.008 * k), { pos: [0.02 * s * k, 0.01 * k, 0], rot: [Math.PI / 2, 0, 0], bone: s > 0 ? 'wingL' : 'wingR', mat: 'wing' });
    B.add(P.leaf(outer, 0.007 * k), { pos: [0.02 * s * k, 0.01 * k, 0], rot: [Math.PI / 2, 0, 0], bone: s > 0 ? 'tipL' : 'tipR', mat: 'tip' });
  }
}
export const gullModel = {
  id: 'gull',
  rig: 'flyer',
  height: 0.1,
  radius: 0.4,
  aoHeight: 0,
  aoMin: 1,
  bones: flyerBones(1.3),
  slots: [],
  materials: {
    body: { color: 0xf6f6f2, noise: 'feather', rough: 0.8 },
    breast: { color: 0xffffff, rough: 0.8 },
    head: { color: 0xfafaf6, rough: 0.8 },
    wing: { src: 'A', noise: 'feather', rough: 0.8 },
    tip: { src: 'B', rough: 0.8 },
    beak: { color: 0xf2c030, rough: 0.4 },
    eye: { color: 0x101010, rough: 0.2 },
  },
  build(B) {
    buildFlyer(B, 1.3, 0.04);
  },
};
export const songbirdModel = {
  id: 'songbird',
  rig: 'flyer',
  height: 0.06,
  radius: 0.2,
  aoHeight: 0,
  aoMin: 1,
  bones: flyerBones(0.55),
  slots: [],
  materials: {
    body: { src: 'A', noise: 'feather', rough: 0.8 },
    breast: { src: 'B', rough: 0.8 },
    head: { src: 'A', rough: 0.8 },
    wing: { src: 'C', noise: 'feather', rough: 0.8 },
    tip: { src: 'C', rough: 0.8 },
    beak: { color: 0x2a2420, rough: 0.4 },
    eye: { color: 0x101010, rough: 0.2 },
  },
  build(B) {
    buildFlyer(B, 0.55, 0.035);
  },
};

// Fish: one spine bone that wiggles. Channels: 0 phase 1 amplitude
export const fishModel = {
  id: 'fish',
  rig: 'fish',
  height: 0.06,
  radius: 0.25,
  aoHeight: 0,
  aoMin: 1,
  rim: 0.05,
  bones: [{ name: 'spine', parent: -1, pivot: [0, 0, 0.07], ch: [0, 1, -1, -1], spine: { k: 16, L: 0.22, e0: 0.08 } }],
  slots: [],
  materials: {
    scale: { src: 'A', src2: 'B', noise: 'counter', rough: 0.3, metal: 0.25 },
    fin: { src: 'C', rough: 0.4 },
    eye: { color: 0x0a0a0a, rough: 0.1 },
  },
  build(B) {
    B.with({ bone: 'spine' }, () => {
      B.add(P.sphere(1, 10, 7), { pos: [0, 0, 0], scl: [0.024, 0.042, 0.11], mat: 'scale' });
      B.add(P.leaf([[0, 0], [0.05, -0.05], [0.07, -0.02], [0.05, 0.0], [0.07, 0.03], [0.05, 0.05]].map(([x, y]) => [y, -x]), 0.006), { pos: [0, 0, -0.1], rot: [0, Math.PI / 2, 0], mat: 'fin' });
      B.add(P.slab([[0, 0], [0.07, 0], [0.01, 0.035]], 0.005), { pos: [0, 0.036, 0.03], rot: [0, Math.PI / 2, 0], mat: 'fin' });
      for (const s of [1, -1]) B.add(P.sphere(0.008, 5, 4), { pos: [0.018 * s, 0.01, 0.075], mat: 'eye' });
    });
  },
};

export const MONSTER_MODELS = [golemModel, serpentModel, wyrmModel];
export const AMBIENT_MODELS = [gullModel, songbirdModel, fishModel];
