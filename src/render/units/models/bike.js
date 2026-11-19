import { P, limb } from '../ModelBuilder.js';
import { quadBones, pv } from './horse.js';

// Light vehicle for riders from the Modern era on (cavalry and messengers no
// longer ride horses): a military motorbike in eras 5-6 (slot 'kind' 0) and
// a hoverbike with glowing lift pads in the Future era (1). Drawn under the
// rider like the horse, posed with the same quadruped rig (only the body
// bone carries geometry, so it bobs and pitches but has no legs).
// Instance colours: A frame, B trim, C the rider's trousers (shins on the
// footpegs), K the realm colour (a stripe on the tank and the number plate).
export const BIKE_SEAT_Y = 0.3;
export const BIKE_SEAT_Z = -0.05;

export const bikeModel = {
  id: 'bike',
  rig: 'quad',
  height: 0.42,
  radius: 0.36,
  legLen: 0.28,
  halfWidth: 0.08,
  aoHeight: 0.12,
  rim: 0.14,
  gait: { stride: 0.5, walkAmp: 0.0, runAmp: 0.0, bob: 0.006, run: 'walk', grazeX: 0 },
  bones: quadBones(pv),
  slots: ['kind'],
  materials: {
    frame: { src: 'A', rough: 0.45, metal: 0.2 },
    trim: { src: 'B', rough: 0.5 },
    pants: { src: 'C', noise: 'cloth', rough: 0.9 },
    cloth: { src: 'K', color: 0x8a3a2a, rough: 0.6 },
    tire: { color: 0x1c1c1e, rough: 0.8 },
    metal: { color: 0x9aa0a6, rough: 0.3, metal: 0.8 },
    seat: { color: 0x2a2420, rough: 0.7 },
    boot: { color: 0x2a2420, rough: 0.55 },
    lamp: { color: 0xfff2c0, emissive: 1.6, rough: 0.3 },
    glow: { color: 0x7fe6ff, emissive: 2.2, rough: 0.2 },
  },
  build(B) {
    B.with({ bone: 'body' }, () => {
      // ---- motorbike (kind 0): two wheels, fork, engine, exhaust
      B.with({ slot: 'kind', opt: 0 }, () => {
        for (const z of [0.2, -0.19]) {
          B.add(P.torus(0.058, 0.024, 6, 14), { pos: [0, 0.082, z], rot: [0, Math.PI / 2, 0], mat: 'tire' });
          B.add(P.cyl(0.03, 0.03, 0.03, 8), { pos: [0, 0.082, z], rot: [0, 0, Math.PI / 2], mat: 'metal' });
        }
        for (const s of [1, -1]) B.add(P.box(0.012, 0.2, 0.014), { pos: [0.026 * s, 0.17, 0.17], rot: [0.32, 0, 0], mat: 'metal' });
        B.add(P.box(0.07, 0.07, 0.1), { pos: [0, 0.13, 0.0], mat: 'tire' });
        B.add(P.cyl(0.014, 0.012, 0.22, 6), { pos: [0.05, 0.11, -0.1], rot: [Math.PI / 2 - 0.15, 0, 0], mat: 'metal' });
        B.add(P.box(0.1, 0.014, 0.12), { pos: [0, 0.165, -0.19], mat: 'frame' }); // rear mudguard / rack
        B.add(P.box(0.14, 0.05, 0.08), { pos: [0, 0.2, -0.2], mat: 'trim' }); // panniers
      });
      // ---- hoverbike (kind 1): no wheels, two glowing lift pads and fins
      B.with({ slot: 'kind', opt: 1 }, () => {
        for (const z of [0.15, -0.16]) {
          B.add(P.cyl(0.07, 0.08, 0.04, 12), { pos: [0, 0.1, z], mat: 'frame' });
          B.add(P.cyl(0.06, 0.06, 0.012, 12), { pos: [0, 0.078, z], mat: 'glow' });
        }
        for (const s of [1, -1]) B.add(P.box(0.012, 0.06, 0.12), { pos: [0.075 * s, 0.17, -0.12], rot: [0, 0.15 * s, 0], mat: 'trim' });
        B.add(P.box(0.06, 0.03, 0.34), { pos: [0, 0.12, 0], mat: 'trim' });
      });
      // ---- shared: tank and body, seat, handlebars, headlight, realm stripe
      B.add(P.sphere(1, 10, 6), { pos: [0, 0.22, 0.06], scl: [0.06, 0.05, 0.13], mat: 'frame' });
      B.add(P.box(0.07, 0.05, 0.2), { pos: [0, 0.2, -0.06], mat: 'frame' });
      B.add(P.box(0.08, 0.028, 0.15), { pos: [0, BIKE_SEAT_Y - 0.016, BIKE_SEAT_Z], mat: 'seat' });
      B.add(P.box(0.2, 0.016, 0.016), { pos: [0, 0.3, 0.17], mat: 'metal' });
      B.add(P.box(0.016, 0.07, 0.016), { pos: [0, 0.26, 0.17], rot: [0.3, 0, 0], mat: 'metal' });
      B.add(P.sphere(0.022, 8, 6), { pos: [0, 0.25, 0.22], scl: [1, 1, 0.6], mat: 'lamp' });
      for (const s of [1, -1]) B.add(P.box(0.006, 0.026, 0.12), { pos: [0.061 * s, 0.225, 0.05], mat: 'cloth' });
      B.add(P.box(0.06, 0.04, 0.006), { pos: [0, 0.2, -0.27], mat: 'cloth' });
      // the rider's shins and boots on the footpegs
      for (const s of [1, -1]) {
        const sh = limb([0.07 * s, BIKE_SEAT_Y - 0.01, BIKE_SEAT_Z + 0.09], [0.078 * s, 0.12, BIKE_SEAT_Z + 0.07], 0.026, 0.023, 7);
        B.add(sh.geo, { ...sh.o, mat: 'pants' });
        B.add(P.sphere(1, 8, 6), { pos: [0.08 * s, 0.11, BIKE_SEAT_Z + 0.085], scl: [0.028, 0.024, 0.042], mat: 'boot' });
      }
    });
  },
  palette: { combos: [[0x56603a, 0x3a3f2a, 0, 1]] },
};

// Frame and trim colours by era (the renderer picks them per rider).
export const BIKE_COLORS = {
  5: [0x56603a, 0x3a3f2a],
  6: [0x4a5233, 0x2e3324],
  7: [0xe4e8ec, 0x5c6670],
};
