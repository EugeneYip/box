import * as THREE from 'three';
import { P, limb } from '../ModelBuilder.js';

// Human: ~0.6 units tall, faces +Z, feet at y = 0. Character's left is +X.
// Channels: 0 torsoX 1 torsoY 2 torsoZ 3 headX 4 headY 5 armLX 6 armLZ
// 7 armRX 8 armRZ 9 legLX 10 legRX 11 torsoScale 12 headScale 13 armRY 14 toolX 15 -
export const HAND_R = [-0.111, 0.205, 0.004];
export const HAND_L = [0.111, 0.205, 0.004];

export const humanModel = {
  id: 'human',
  rig: 'humanoid',
  height: 0.6,
  radius: 0.45,
  aoHeight: 0.16,
  aoMin: 0.62,
  rim: 0.16,
  bones: [
    { name: 'pelvis', parent: -1, pivot: [0, 0.2, 0] },
    { name: 'torso', parent: -1, pivot: [0, 0.2, 0], ch: [0, 1, 2, 11] },
    { name: 'head', parent: 1, pivot: [0, 0.405, 0], ch: [3, 4, -1, 12] },
    { name: 'armL', parent: 1, pivot: [0.1, 0.372, 0], ch: [5, -1, 6, -1] },
    { name: 'armR', parent: 1, pivot: [-0.1, 0.372, 0], ch: [7, 13, 8, -1] },
    { name: 'legL', parent: -1, pivot: [0.042, 0.19, 0], ch: [9, -1, -1, -1] },
    { name: 'legR', parent: -1, pivot: [-0.042, 0.19, 0], ch: [10, -1, -1, -1] },
    { name: 'tool', parent: 4, pivot: HAND_R, ch: [14, -1, -1, -1] },
  ],
  slots: ['hair', 'hat', 'beard', 'tool', 'offhand', 'back', 'cape', 'outfit', 'armor'],
  // secondary palette (index in iCol2.a): trousers / hoods / sashes
  secondary: [0x6b4a32, 0x4a4a52, 0x5d5a3a, 0x3a4660, 0x8f7658, 0x6a3438, 0x3e5a3a, 0x333338],
  materials: {
    skin: { src: 'A', rough: 0.62 },
    cloth: { src: 'B', noise: 'cloth', rough: 0.88 },
    hair: { src: 'C', noise: 'fur', rough: 0.55 },
    pants: { src: 'D', noise: 'cloth', rough: 0.9 },
    leather: { color: 0x5b3a26, rough: 0.6 },
    boot: { color: 0x3f2a1e, rough: 0.55 },
    wood: { color: 0x9a6a3c, noise: 'fur', rough: 0.8 },
    darkwood: { color: 0x6a4428, noise: 'fur', rough: 0.8 },
    metal: { color: 0xc4ccd6, rough: 0.3, metal: 0.85 },
    gold: { color: 0xf2c14e, rough: 0.28, metal: 1 },
    eye: { color: 0x1a120e, rough: 0.2 },
    straw: { color: 0xe6c870, noise: 'cloth', rough: 0.9 },
    band: { color: 0xb8402a, rough: 0.7 },
    stone: { color: 0x9a968f, noise: 'stone', rough: 0.9 },
    burlap: { color: 0xbca06c, noise: 'cloth', rough: 0.95 },
    white: { color: 0xf2efe8, rough: 0.6 },
    apple: { color: 0xd8402c, rough: 0.4 },
    greens: { color: 0x6aae46, rough: 0.7 },
    lamp: { color: 0xffc070, emissive: 2.4, rough: 0.3 },
    blush: { color: 0xf09080, rough: 0.7 },
    linen: { color: 0xeee2c6, noise: 'cloth', rough: 0.9 },
    ermine: { color: 0xf8f5ee, color2: 0x1c1c1c, noise: 'spots', rough: 0.9 },
    oilskin: { color: 0xf0c030, rough: 0.4 },
    gem: { color: 0xd02448, rough: 0.15, emissive: 0.25 },
    wheat: { color: 0xe8c45a, noise: 'cloth', rough: 0.9 },
  },
  build(B) {
    // ---- legs & boots
    for (const s of [1, -1]) {
      const leg = s > 0 ? 'legL' : 'legR';
      const l = limb([0.042 * s, 0.19, 0], [0.045 * s, 0.05, 0.0], 0.029, 0.026, 8, true);
      B.add(l.geo, { ...l.o, bone: leg, mat: 'pants' });
      B.add(P.sphere(1, 10, 6), { pos: [0.045 * s, 0.026, 0.014], scl: [0.031, 0.027, 0.045], bone: leg, mat: 'boot' });
      B.add(P.cyl(0.031, 0.03, 0.03, 10), { pos: [0.045 * s, 0.055, 0.002], bone: leg, mat: 'boot', minor: true });
    }
    B.add(P.sphere(1, 10, 6), { pos: [0, 0.19, 0], scl: [0.074, 0.04, 0.056], bone: 'pelvis', mat: 'pants' });
    // ---- torso variants (outfit slot)
    const tunic = [[0.0, 0.15], [0.086, 0.15], [0.083, 0.175], [0.072, 0.22], [0.068, 0.25], [0.074, 0.3], [0.079, 0.34], [0.074, 0.37], [0.054, 0.392], [0.03, 0.405], [0.0, 0.41]];
    const dress = [[0.0, 0.055], [0.112, 0.055], [0.106, 0.085], [0.088, 0.15], [0.07, 0.22], [0.066, 0.25], [0.074, 0.3], [0.079, 0.34], [0.074, 0.37], [0.054, 0.392], [0.03, 0.405], [0.0, 0.41]];
    const robe = [[0.0, 0.012], [0.104, 0.012], [0.1, 0.05], [0.088, 0.14], [0.074, 0.23], [0.074, 0.3], [0.08, 0.34], [0.076, 0.37], [0.056, 0.392], [0.03, 0.405], [0.0, 0.41]];
    B.with({ bone: 'torso', slot: 'outfit' }, () => {
      B.add(P.lathe(tunic, 14), { scl: [1, 1, 0.82], mat: 'cloth', opt: 0 });
      B.add(P.torus(0.07, 0.009, 5, 16), { pos: [0, 0.245, 0], rot: [Math.PI / 2, 0, 0], scl: [1, 0.82, 1], mat: 'leather', opt: 0 });
      B.add(P.box(0.024, 0.018, 0.008), { pos: [0, 0.245, 0.059], mat: 'gold', opt: 0, minor: true });
      B.add(P.torus(0.085, 0.006, 4, 16), { pos: [0, 0.153, 0], rot: [Math.PI / 2, 0, 0], scl: [1, 0.82, 1], mat: 'pants', opt: 0, minor: true });
      B.add(P.lathe(dress, 14), { scl: [1, 1, 0.82], mat: 'cloth', opt: 1 });
      B.add(P.torus(0.068, 0.012, 5, 16), { pos: [0, 0.243, 0], rot: [Math.PI / 2, 0, 0], scl: [1, 0.82, 1], mat: 'pants', opt: 1 });
      B.add(P.slab([[-0.05, 0.09], [0.05, 0.09], [0.042, 0.235], [-0.042, 0.235]], 0.006), { pos: [0, 0, 0.074], rot: [-0.11, 0, 0], mat: 'linen', opt: 1 });
      B.add(P.lathe(robe, 14), { scl: [1, 1, 0.84], mat: 'cloth', opt: 2 });
      B.add(P.torus(0.102, 0.008, 4, 18), { pos: [0, 0.018, 0], rot: [Math.PI / 2, 0, 0], scl: [1, 0.84, 1], mat: 'gold', opt: 2 });
      B.add(P.torus(0.072, 0.01, 5, 16), { pos: [0, 0.245, 0], rot: [Math.PI / 2, 0, 0], scl: [1, 0.84, 1], mat: 'gold', opt: 2 });
    });
    // armour plates
    B.with({ bone: 'torso', slot: 'armor', opt: 1, mat: 'metal' }, () => {
      B.add(P.lathe([[0.076, 0.235], [0.081, 0.29], [0.084, 0.34], [0.078, 0.37], [0.058, 0.39], [0.04, 0.398]], 14), { scl: [1, 1, 0.86] });
      for (const s of [1, -1]) B.add(P.dome(0.042, 10, 4, 0.5), { pos: [0.094 * s, 0.366, 0], rot: [0, 0, -0.5 * s], scl: [1, 0.8, 1.05] });
      B.add(P.torus(0.074, 0.011, 5, 16), { pos: [0, 0.243, 0], rot: [Math.PI / 2, 0, 0], scl: [1, 0.86, 1], mat: 'leather' });
    });
    // neck
    B.add(P.cyl(0.026, 0.028, 0.05, 8), { pos: [0, 0.415, 0], bone: 'torso', mat: 'skin' });
    // ---- arms
    for (const s of [1, -1]) {
      const arm = s > 0 ? 'armL' : 'armR';
      B.add(P.sphere(0.031, 8, 6), { pos: [0.098 * s, 0.37, 0], bone: arm, mat: 'cloth' });
      const up = limb([0.1 * s, 0.37, 0], [0.106 * s, 0.29, 0.002], 0.027, 0.025, 8, true);
      B.add(up.geo, { ...up.o, bone: arm, mat: 'cloth' });
      const fo = limb([0.106 * s, 0.29, 0.002], [0.11 * s, 0.226, 0.004], 0.021, 0.02, 8, true);
      B.add(fo.geo, { ...fo.o, bone: arm, mat: 'skin' });
      B.add(P.sphere(0.024, 8, 6), { pos: s > 0 ? HAND_L : HAND_R, scl: [0.95, 1.05, 1.05], bone: arm, mat: 'skin' });
    }
    // ---- head
    B.with({ bone: 'head' }, () => {
      B.add(P.sphere(0.1, 16, 12), { pos: [0, 0.5, 0], scl: [1, 0.95, 0.94], mat: 'skin' });
      for (const s of [1, -1]) {
        B.add(P.sphere(0.0155, 8, 6), { pos: [0.036 * s, 0.508, 0.087], scl: [1, 1.3, 0.55], mat: 'eye' });
        B.add(P.sphere(0.02, 6, 5), { pos: [0.098 * s, 0.497, 0.0], scl: [0.55, 1, 0.8], mat: 'skin' });
        B.add(P.sphere(0.017, 6, 4), { pos: [0.058 * s, 0.475, 0.08], scl: [1, 0.6, 0.3], mat: 'blush', minor: true });
      }
      B.add(P.sphere(0.014, 6, 5), { pos: [0, 0.487, 0.097], mat: 'skin' });
      B.add(P.box(0.022, 0.004, 0.004), { pos: [0, 0.462, 0.091], mat: 'eye', minor: true });
      // hair styles
      const cap = (opt) => B.add(P.dome(0.108, 14, 6, 0.52), { pos: [0, 0.5, 0], rot: [-0.45, 0, 0], scl: [1.02, 1, 1.01], mat: 'hair', slot: 'hair', opt });
      for (const o of [0, 1, 2, 4, 5]) cap(o);
      B.with({ slot: 'hair', mat: 'hair' }, () => {
        // short: little fringe
        B.add(P.sphere(1, 8, 5), { pos: [0.03, 0.578, 0.07], scl: [0.05, 0.022, 0.03], rot: [0.3, 0, 0.3], opt: 0, minor: true });
        // long
        B.add(P.sphere(1, 10, 8), { pos: [0, 0.445, -0.055], scl: [0.098, 0.11, 0.052], opt: 1 });
        for (const s of [1, -1]) B.add(P.sphere(1, 8, 6), { pos: [0.083 * s, 0.455, 0.012], scl: [0.026, 0.075, 0.04], opt: 1 });
        // bun
        B.add(P.sphere(0.044, 10, 8), { pos: [0, 0.59, -0.065], opt: 2 });
        // balding horseshoe
        B.add(P.torus(0.097, 0.022, 5, 12, Math.PI), { pos: [0, 0.478, 0], rot: [-Math.PI / 2, 0, 0], scl: [1, 1.05, 1], opt: 3 });
        // ponytail
        B.add(P.tube([[0, 0.55, -0.095], [0, 0.5, -0.135], [0, 0.44, -0.13], [0, 0.39, -0.115]], (t) => 0.026 - t * 0.014, 10, 6), { opt: 4 });
        // tufty (children)
        for (const [x, z, r] of [[0, 0.03, 0.2], [0.035, -0.01, -0.5], [-0.035, -0.02, 0.6]]) B.add(P.cone(0.022, 0.06, 6), { pos: [x, 0.6, z], rot: [r * 0.6 - 0.2, 0, -x * 9], opt: 5 });
      });
      // hats
      B.with({ slot: 'hat' }, () => {
        // 1 straw hat
        B.add(P.cyl(0.165, 0.168, 0.012, 20), { pos: [0, 0.566, -0.008], rot: [-0.12, 0, 0], mat: 'straw', opt: 1 });
        B.add(P.cyl(0.068, 0.084, 0.066, 14), { pos: [0, 0.604, -0.012], rot: [-0.12, 0, 0], mat: 'straw', opt: 1 });
        B.add(P.cyl(0.0855, 0.0855, 0.016, 14), { pos: [0, 0.58, -0.01], rot: [-0.12, 0, 0], mat: 'band', opt: 1 });
        // 2 helmet with plume in kingdom colour
        B.add(P.dome(0.113, 14, 6, 0.56), { pos: [0, 0.5, 0], rot: [-0.12, 0, 0], mat: 'metal', opt: 2 });
        B.add(P.torus(0.111, 0.007, 4, 18), { pos: [0, 0.49, 0.004], rot: [Math.PI / 2 - 0.12, 0, 0], mat: 'metal', opt: 2 });
        B.add(P.box(0.014, 0.065, 0.012), { pos: [0, 0.5, 0.11], mat: 'metal', opt: 2 });
        B.add(P.tube([[0, 0.6, 0.06], [0, 0.645, 0.0], [0, 0.63, -0.07], [0, 0.575, -0.125]], (t) => 0.014 + Math.sin(t * Math.PI) * 0.012, 12, 6), { mat: 'cloth', opt: 2 });
        // 3 crown
        B.add(P.cyl(0.084, 0.08, 0.032, 16, 1, true), { pos: [0, 0.582, 0], mat: 'gold', opt: 3 });
        B.add(P.cyl(0.08, 0.08, 0.004, 16), { pos: [0, 0.568, 0], mat: 'gold', opt: 3 });
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          B.add(P.cone(0.016, 0.04, 5), { pos: [Math.sin(a) * 0.08, 0.615, Math.cos(a) * 0.08], mat: 'gold', opt: 3 });
          B.add(P.sphere(0.009, 6, 4), { pos: [Math.sin(a) * 0.084, 0.585, Math.cos(a) * 0.084], mat: 'gem', opt: 3, minor: true });
        }
        // 4 hood (secondary colour)
        B.add(P.dome(0.118, 14, 7, 0.6), { pos: [0, 0.5, -0.004], rot: [-0.38, 0, 0], mat: 'pants', opt: 4 });
        B.add(P.cone(0.045, 0.09, 8), { pos: [0, 0.548, -0.12], rot: [-2.1, 0, 0], mat: 'pants', opt: 4 });
        B.add(P.lathe([[0.098, 0.345], [0.09, 0.372], [0.066, 0.395], [0.05, 0.41]], 14), { scl: [1, 1, 0.86], mat: 'pants', opt: 4, bone: 'torso' });
        // 5 miner cap with lamp
        B.add(P.dome(0.111, 14, 5, 0.45), { pos: [0, 0.505, 0], rot: [-0.18, 0, 0], mat: 'leather', opt: 5 });
        B.add(P.cyl(0.02, 0.022, 0.026, 10), { pos: [0, 0.575, 0.098], rot: [Math.PI / 2 - 0.5, 0, 0], mat: 'metal', opt: 5 });
        B.add(P.sphere(0.016, 8, 6), { pos: [0, 0.585, 0.112], scl: [1, 1, 0.5], mat: 'lamp', opt: 5 });
        // 6 headband
        B.add(P.torus(0.101, 0.011, 5, 18), { pos: [0, 0.535, 0], rot: [Math.PI / 2 - 0.25, 0, 0], mat: 'band', opt: 6 });
        B.add(P.sphere(1, 6, 4), { pos: [0, 0.52, -0.105], scl: [0.02, 0.016, 0.012], mat: 'band', opt: 6 });
        // 7 fisher's oilskin hat
        B.add(P.lathe([[0.168, 0.548], [0.12, 0.568], [0.085, 0.585], [0.075, 0.62], [0.04, 0.64], [0.0, 0.642]], 16), { rot: [-0.18, 0, 0], mat: 'oilskin', opt: 7 });
      });
      // beards
      B.with({ slot: 'beard', mat: 'hair' }, () => {
        B.add(P.sphere(1, 10, 8), { pos: [0, 0.448, 0.064], scl: [0.07, 0.062, 0.052], opt: 1 });
        B.add(P.sphere(1, 8, 5), { pos: [0, 0.47, 0.092], scl: [0.04, 0.012, 0.016], opt: 1 });
        B.add(P.sphere(1, 8, 5), { pos: [0, 0.47, 0.094], scl: [0.04, 0.012, 0.016], opt: 2 });
      });
    });
    // ---- tools (held in the right hand; tool frame: handle along +Z, head below)
    const tool = (geo, opt, o, tilt) => {
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(...(o.pos || [0, 0, 0])),
        o.quat || new THREE.Quaternion().setFromEuler(new THREE.Euler(...(o.rot || [0, 0, 0]))),
        new THREE.Vector3(...(Array.isArray(o.scl) ? o.scl : [o.scl ?? 1, o.scl ?? 1, o.scl ?? 1])),
      );
      geo.applyMatrix4(m);
      B.add(geo, { pos: HAND_R, rot: [tilt, 0, 0], bone: 'tool', slot: 'tool', opt, mat: o.mat });
    };
    const handle = (z0, z1, r, opt, tilt, mat = 'wood') => tool(P.cyl(r, r, z1 - z0, 6), opt, { pos: [0, 0, (z0 + z1) / 2], rot: [Math.PI / 2, 0, 0], mat }, tilt);
    // 1 axe
    handle(-0.05, 0.27, 0.0085, 1, -0.3);
    tool(P.slab([[-0.016, 0.012], [0.02, 0.012], [0.036, -0.06], [-0.03, -0.062]], 0.011), 1, { pos: [0, -0.008, 0.248], rot: [0, Math.PI / 2, 0], mat: 'metal' }, -0.3);
    // 2 hoe
    handle(-0.12, 0.36, 0.0085, 2, -0.7);
    tool(P.box(0.052, 0.05, 0.007), 2, { pos: [0, -0.024, 0.36], mat: 'metal' }, -0.7);
    // 3 pickaxe
    handle(-0.04, 0.27, 0.0085, 3, -0.35);
    tool(P.cone(0.012, 0.075, 6), 3, { pos: [0, 0.036, 0.262], rot: [-0.25, 0, 0], mat: 'metal' }, -0.35);
    tool(P.cone(0.012, 0.075, 6), 3, { pos: [0, -0.036, 0.262], rot: [Math.PI + 0.25, 0, 0], mat: 'metal' }, -0.35);
    // 4 hammer
    handle(-0.03, 0.2, 0.0085, 4, -0.4);
    tool(P.box(0.036, 0.075, 0.036), 4, { pos: [0, -0.008, 0.2], mat: 'metal' }, -0.4);
    // 5 spear
    handle(-0.24, 0.43, 0.008, 5, -1.3, 'darkwood');
    tool(P.octa(1), 5, { pos: [0, 0, 0.47], scl: [0.02, 0.012, 0.055], mat: 'metal' }, -1.3);
    tool(P.slab([[0, 0], [0.07, -0.012], [0.07, -0.042], [0, -0.03]], 0.004), 5, { pos: [0, 0, 0.39], rot: [0, -Math.PI / 2, 0], mat: 'cloth' }, -1.3);
    // 6 fishing rod
    tool(P.cyl(0.003, 0.007, 0.6, 5), 6, { pos: [0, 0, 0.26], rot: [Math.PI / 2, 0, 0], mat: 'wood' }, -0.85);
    tool(P.sphere(0.012, 6, 4), 6, { pos: [0, -0.02, -0.025], mat: 'darkwood' }, -0.85);
    // 7 scepter
    handle(-0.04, 0.2, 0.0075, 7, -1.05, 'gold');
    tool(P.sphere(0.022, 10, 8), 7, { pos: [0, 0, 0.215], mat: 'gem' }, -1.05);
    tool(P.torus(0.016, 0.005, 4, 10), 7, { pos: [0, 0, 0.195], mat: 'gold' }, -1.05);
    // 8 sword
    tool(P.box(0.009, 0.026, 0.25), 8, { pos: [0, 0, 0.15], mat: 'metal' }, -0.55);
    tool(P.cone(0.013, 0.035, 4), 8, { pos: [0, 0, 0.29], rot: [Math.PI / 2, Math.PI / 4, 0], scl: [0.7, 1, 1.8], mat: 'metal' }, -0.55);
    tool(P.box(0.075, 0.013, 0.013), 8, { pos: [0, 0, 0.022], mat: 'gold' }, -0.55);
    handle(-0.045, 0.02, 0.008, 8, -0.55, 'leather');
    tool(P.sphere(0.013, 6, 5), 8, { pos: [0, 0, -0.05], mat: 'gold' }, -0.55);
    // 9 bow
    tool(P.tube([[0, 0.17, 0.0], [0, 0.09, 0.045], [0, 0, 0.06], [0, -0.09, 0.045], [0, -0.17, 0]], 0.0065, 14, 5), 9, { mat: 'wood' }, 0);
    tool(P.cyl(0.0018, 0.0018, 0.34, 3), 9, { pos: [0, 0, 0.0], mat: 'white' }, 0);
    // ---- shield on the left forearm
    B.with({ bone: 'armL', slot: 'offhand', opt: 1 }, () => {
      B.add(P.cyl(0.086, 0.086, 0.012, 18), { pos: [0.142, 0.268, 0.02], rot: [0, 0, Math.PI / 2], mat: 'cloth' });
      B.add(P.torus(0.086, 0.008, 4, 20), { pos: [0.142, 0.268, 0.02], rot: [0, Math.PI / 2, 0], mat: 'metal' });
      B.add(P.box(0.004, 0.17, 0.026), { pos: [0.1495, 0.268, 0.02], mat: 'linen' });
      B.add(P.sphere(0.024, 10, 6), { pos: [0.15, 0.268, 0.02], scl: [0.7, 1, 1], mat: 'metal' });
    });
    // ---- carried loads on the back
    B.with({ bone: 'torso', slot: 'back' }, () => {
      // 1 wood logs
      for (const [x, y] of [[-0.023, 0.31], [0.023, 0.31], [0, 0.348]]) {
        B.add(P.cyl(0.022, 0.022, 0.21, 8), { pos: [x, y, -0.104], rot: [0, 0, Math.PI / 2], mat: 'darkwood', opt: 1 });
        for (const s of [1, -1]) B.add(P.cyl(0.018, 0.018, 0.004, 8), { pos: [0.106 * s, y, -0.104], rot: [0, 0, Math.PI / 2], mat: 'straw', opt: 1, minor: true });
      }
      B.add(P.torus(0.06, 0.006, 4, 12), { pos: [0, 0.325, -0.1], rot: [0, Math.PI / 2, 0], scl: [1, 0.9, 1.1], mat: 'leather', opt: 1 });
      // 2 stone sack
      B.add(P.sphere(1, 10, 8), { pos: [0, 0.31, -0.112], scl: [0.064, 0.075, 0.052], mat: 'burlap', opt: 2 });
      B.add(P.dodeca(0.03), { pos: [0.015, 0.388, -0.11], rot: [0.4, 0.3, 0], mat: 'stone', opt: 2, flat: true });
      B.add(P.dodeca(0.024), { pos: [-0.025, 0.378, -0.098], rot: [0.1, 0.9, 0.3], mat: 'stone', opt: 2, flat: true });
      B.add(P.torus(0.03, 0.007, 4, 10), { pos: [0, 0.372, -0.112], rot: [Math.PI / 2, 0, 0], mat: 'leather', opt: 2 });
      // 3 food basket
      B.add(P.cyl(0.062, 0.046, 0.075, 12, 1, true), { pos: [0, 0.31, -0.115], mat: 'straw', opt: 3 });
      B.add(P.cyl(0.046, 0.046, 0.004, 12), { pos: [0, 0.274, -0.115], mat: 'straw', opt: 3 });
      B.add(P.torus(0.062, 0.006, 4, 14), { pos: [0, 0.348, -0.115], rot: [Math.PI / 2, 0, 0], mat: 'darkwood', opt: 3 });
      B.add(P.sphere(0.024, 8, 6), { pos: [0.02, 0.345, -0.105], mat: 'apple', opt: 3 });
      B.add(P.sphere(0.026, 8, 6), { pos: [-0.022, 0.343, -0.125], mat: 'greens', opt: 3 });
      B.add(P.sphere(0.021, 8, 6), { pos: [-0.004, 0.35, -0.09], mat: 'apple', opt: 3 });
      for (let i = 0; i < 5; i++) B.add(P.cyl(0.004, 0.004, 0.12, 4), { pos: [0.02 - i * 0.008, 0.385, -0.13], rot: [-0.25, 0, (i - 2) * 0.1], mat: 'wheat', opt: 3, minor: true });
      // 4 gold pouch
      B.add(P.sphere(1, 10, 8), { pos: [0, 0.3, -0.105], scl: [0.048, 0.056, 0.04], mat: 'leather', opt: 4 });
      B.add(P.cyl(0.018, 0.026, 0.02, 8), { pos: [0, 0.358, -0.105], mat: 'leather', opt: 4 });
      for (const [x, y, z] of [[0.012, 0.372, -0.1], [-0.01, 0.378, -0.11], [0.0, 0.384, -0.098]]) B.add(P.cyl(0.011, 0.011, 0.004, 8), { pos: [x, y, z], rot: [0.5, 0, 0.3], mat: 'gold', opt: 4, minor: true });
    });
    // ---- royal cape
    B.with({ bone: 'torso', slot: 'cape', opt: 1 }, () => {
      B.add(P.slab([[-0.07, 0.385], [0.07, 0.385], [0.105, 0.09], [0.0, 0.075], [-0.105, 0.09]], 0.01), { pos: [0, 0, -0.082], rot: [0.12, 0, 0], mat: 'cloth' });
      B.add(P.torus(0.06, 0.024, 6, 16), { pos: [0, 0.39, -0.004], rot: [Math.PI / 2, 0, 0], scl: [1.1, 0.9, 1], mat: 'ermine' });
    });
  },
};

// ---- appearance palettes ------------------------------------------------------
export const SKIN = [0xf7d7bd, 0xefc3a2, 0xdca47d, 0xbd8058, 0x91603e, 0x6b432c];
export const HAIR = [0x2a1d16, 0x4a2e1c, 0x7a4a26, 0xa8502a, 0xd8b26a, 0xe8d6a0, 0x1c1a1e, 0x5a3a2a];
export const HAIR_OLD = [0xc4c0b8, 0xe8e6e0, 0x9a948c];
export const NEUTRAL_CLOTH = [0xcdb994, 0x8a6a4a, 0x7f8f6a, 0xa0583a, 0x6f7f8f, 0xc09a4a, 0x8a7a9a, 0x5f7a6a];
export const TOOL_OPT = { none: 0, axe: 1, hoe: 2, pickaxe: 3, hammer: 4, spear: 5, rod: 6, scepter: 7, sword: 8, bow: 9 };
export const HAT_OPT = { none: 0, straw: 1, helmet: 2, crown: 3, hood: 4, miner: 5, headband: 6, oilskin: 7 };
export const BACK_OPT = { none: 0, wood: 1, stone: 2, food: 3, gold: 4 };
