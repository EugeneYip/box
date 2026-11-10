import { P, limb } from '../ModelBuilder.js';

// Riding horse (Horsemanship): drawn under mounted riders, never on its own.
// Shares the quadruped rig and pose (poseQuad). Same units as the human
// (a person is ~0.6 tall); the saddle top sits at SADDLE_Y.
// Instance colours: A coat, B mane and tail, C the rider's trousers (the shins
// and boots in the stirrups), K the realm colour (saddle cloth and browband).
export const SADDLE_Y = 0.43;
export const SADDLE_Z = -0.035;

const pv = { body: [0, 0.35, 0], head: [0, 0.46, 0.2], tail: [0, 0.42, -0.25], fl: [0.06, 0.29, 0.15], bl: [0.06, 0.29, -0.16], ear: [0.03, 0.65, 0.31] };

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
    { name: 'jaw', parent: 1, pivot: p.head, ch: [13, -1, -1, -1] },
  ];
}

export const horseModel = {
  id: 'horse',
  rig: 'quad',
  height: 0.7,
  radius: 0.42,
  legLen: 0.28,
  halfWidth: 0.11,
  aoHeight: 0.2,
  rim: 0.14,
  gait: { stride: 0.5, walkAmp: 0.42, runAmp: 0.9, bob: 0.012, run: 'gallop', grazeX: 1.0 },
  bones: quadBones(pv),
  slots: [],
  materials: {
    coat: { src: 'A', noise: 'fur', rough: 0.7 },
    mane: { src: 'B', noise: 'fur', rough: 0.85 },
    pants: { src: 'C', noise: 'cloth', rough: 0.9 },
    cloth: { src: 'K', color: 0x8a3a2a, noise: 'cloth', rough: 0.8 },
    leather: { color: 0x5b3a26, rough: 0.55 },
    boot: { color: 0x3f2a1e, rough: 0.55 },
    brass: { color: 0xe0b050, rough: 0.3, metal: 0.8 },
    hoof: { color: 0x2f2620, rough: 0.5 },
    eye: { color: 0x15100d, rough: 0.2 },
    nose: { color: 0x3a2a26, rough: 0.5 },
  },
  build(B) {
    // ---- barrel, chest and haunches
    B.with({ bone: 'body', mat: 'coat' }, () => {
      B.add(P.sphere(1, 14, 10), { pos: [0, 0.35, -0.01], scl: [0.1, 0.1, 0.235] });
      B.add(P.sphere(1, 12, 9), { pos: [0, 0.37, 0.15], scl: [0.096, 0.112, 0.105] });
      B.add(P.sphere(1, 12, 9), { pos: [0, 0.375, -0.17], scl: [0.104, 0.108, 0.1] });
      // neck: a tapered limb from the withers up to the poll
      const n = limb([0, 0.42, 0.15], [0, 0.56, 0.27], 0.068, 0.045, 10);
      B.add(n.geo, { ...n.o });
    });
    // mane along the neck crest
    B.add(P.tube([[0, 0.48, 0.13], [0, 0.55, 0.2], [0, 0.61, 0.25]], (t) => 0.024 * (1 - t * 0.35), 10, 5), { pos: [0, 0.0, -0.022], bone: 'body', mat: 'mane' });
    // ---- legs with hooves and feathered fetlocks
    for (const [bone, sx, front] of [['legFL', 1, 1], ['legFR', -1, 1], ['legBL', 1, 0], ['legBR', -1, 0]]) {
      const p = front ? pv.fl : pv.bl;
      const x = p[0] * sx,
        z = p[2];
      const up = limb([x, p[1] + 0.03, z], [x, 0.16, z + (front ? 0.004 : -0.012)], front ? 0.032 : 0.038, 0.02, 8);
      B.add(up.geo, { ...up.o, bone, mat: 'coat' });
      const lo = limb([x, 0.165, z + (front ? 0.004 : -0.012)], [x, 0.035, z], 0.019, 0.017, 7);
      B.add(lo.geo, { ...lo.o, bone, mat: 'coat' });
      B.add(P.sphere(1, 7, 5), { pos: [x, 0.042, z - 0.004], scl: [0.024, 0.02, 0.026], bone, mat: 'mane', minor: true });
      B.add(P.cyl(0.02, 0.024, 0.03, 8), { pos: [x, 0.015, z + 0.003], bone, mat: 'hoof' });
    }
    // ---- head
    B.with({ bone: 'head' }, () => {
      B.add(P.sphere(1, 12, 9), { pos: [0, 0.6, 0.31], rot: [0.95, 0, 0], scl: [0.046, 0.052, 0.11], mat: 'coat' });
      B.add(P.sphere(1, 10, 8), { pos: [0, 0.535, 0.385], rot: [0.95, 0, 0], scl: [0.04, 0.04, 0.052], mat: 'coat' });
      for (const s of [1, -1]) {
        B.add(P.sphere(0.008, 5, 4), { pos: [0.018 * s, 0.515, 0.42], mat: 'nose', minor: true });
        B.add(P.sphere(0.009, 6, 5), { pos: [0.041 * s, 0.618, 0.315], scl: [0.75, 1, 0.9], mat: 'eye' });
      }
      // forelock, bridle, browband (realm colour) and bit ring
      B.add(P.sphere(1, 7, 5), { pos: [0, 0.655, 0.315], scl: [0.024, 0.016, 0.03], mat: 'mane' });
      B.add(P.torus(0.047, 0.006, 4, 12), { pos: [0, 0.6, 0.33], rot: [0.95 + Math.PI / 2, 0, 0], scl: [1, 1.2, 1], mat: 'leather', minor: true });
      B.add(P.torus(0.043, 0.0065, 4, 12), { pos: [0, 0.535, 0.39], rot: [0.95 + Math.PI / 2, 0, 0], mat: 'leather', minor: true });
      B.add(P.box(0.088, 0.012, 0.016), { pos: [0, 0.647, 0.29], rot: [0.5, 0, 0], mat: 'cloth' });
      for (const s of [1, -1]) B.add(P.torus(0.009, 0.0025, 3, 8), { pos: [0.043 * s, 0.51, 0.4], rot: [0, Math.PI / 2, 0], mat: 'brass', minor: true });
    });
    for (const s of [1, -1]) B.add(P.cone(0.014, 0.05, 6), { pos: [0.03 * s, 0.67, 0.29], rot: [-0.3, 0, -0.25 * s], bone: s > 0 ? 'earL' : 'earR', mat: 'coat' });
    // ---- tail
    B.add(P.tube([[0, 0.43, -0.265], [0, 0.39, -0.3], [0, 0.3, -0.31], [0, 0.22, -0.3]], (t) => 0.022 + 0.012 * Math.sin(t * Math.PI), 10, 6), { bone: 'tail', mat: 'mane' });
    // ---- tack: saddle cloth in the realm colour, saddle, girth, reins
    B.with({ bone: 'body' }, () => {
      B.add(P.box(0.235, 0.012, 0.15), { pos: [0, SADDLE_Y + 0.0, SADDLE_Z], mat: 'cloth' });
      for (const s of [1, -1]) {
        B.add(P.box(0.012, 0.11, 0.15), { pos: [0.112 * s, SADDLE_Y - 0.05, SADDLE_Z], rot: [0, 0, 0.12 * s], mat: 'cloth' });
        B.add(P.box(0.014, 0.012, 0.15), { pos: [0.121 * s, SADDLE_Y - 0.108, SADDLE_Z], rot: [0, 0, 0.12 * s], mat: 'brass', minor: true });
      }
      B.add(P.sphere(1, 10, 6), { pos: [0, SADDLE_Y + 0.008, SADDLE_Z], scl: [0.07, 0.022, 0.085], mat: 'leather' });
      B.add(P.box(0.06, 0.035, 0.02), { pos: [0, SADDLE_Y + 0.02, SADDLE_Z + 0.07], mat: 'leather' });
      B.add(P.box(0.08, 0.03, 0.018), { pos: [0, SADDLE_Y + 0.016, SADDLE_Z - 0.075], mat: 'leather' });
      B.add(P.torus(0.105, 0.007, 4, 18), { pos: [0, 0.35, SADDLE_Z + 0.02], rot: [0, Math.PI / 2, 0], scl: [1, 1.0, 1], mat: 'leather', minor: true });
      for (const s of [1, -1]) B.add(P.tube([[0.03 * s, SADDLE_Y + 0.03, SADDLE_Z + 0.11], [0.04 * s, 0.5, 0.25], [0.043 * s, 0.53, 0.37]], 0.0045, 6, 3), { mat: 'leather', minor: true });
      // the rider's shins and boots in the stirrups (the thighs sit on the saddle)
      for (const s of [1, -1]) {
        const sh = limb([0.098 * s, SADDLE_Y - 0.01, SADDLE_Z + 0.035], [0.112 * s, 0.265, SADDLE_Z + 0.055], 0.027, 0.024, 7);
        B.add(sh.geo, { ...sh.o, mat: 'pants' });
        B.add(P.sphere(1, 8, 6), { pos: [0.114 * s, 0.255, SADDLE_Z + 0.07], scl: [0.03, 0.026, 0.044], mat: 'boot' });
        B.add(P.torus(0.018, 0.004, 3, 8), { pos: [0.114 * s, 0.238, SADDLE_Z + 0.06], rot: [0, Math.PI / 2, 0], mat: 'brass', minor: true });
      }
    });
  },
  palette: {
    combos: [
      [0x7a4526, 0x1e1714, 0, 26], // bay
      [0xa4582c, 0x8a4220, 0, 18], // chestnut
      [0x2a2420, 0x16120f, 0, 12], // black
      [0xb9b5ad, 0x86827c, 0, 12], // grey
      [0xc8a064, 0x34261c, 0, 12], // dun
      [0xd9b468, 0xf1e8cc, 0, 10], // palomino
      [0xe6e0d4, 0xcfc6b6, 0, 6], // white
      [0x5a3a26, 0x2a1e18, 0, 4], // liver
    ],
  },
};
