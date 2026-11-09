import { P } from '../ModelBuilder.js';

// "Tiny" LOD builds (<= 150 triangles) used when a creature is only a few
// dozen pixels tall. They reuse each model's bones and materials, so the
// normal pose functions animate them (legs, arms, heads still move).
const box = (B, w, h, d, pos, bone, mat, o = {}) => B.add(P.box(w, h, d), { pos, bone, mat, ...o });

function human(B) {
  for (const s of [1, -1]) {
    box(B, 0.056, 0.19, 0.062, [0.044 * s, 0.1, 0.005], s > 0 ? 'legL' : 'legR', 'pants');
    box(B, 0.046, 0.17, 0.052, [0.108 * s, 0.29, 0.0], s > 0 ? 'armL' : 'armR', 'cloth');
  }
  box(B, 0.15, 0.25, 0.12, [0, 0.29, 0], 'torso', 'cloth');
  B.add(P.ico(0.098, 0), { pos: [0, 0.5, 0], bone: 'head', mat: 'skin' });
  // head-top: hair, or the hat colour (set per instance by the renderer)
  box(B, 0.19, 0.06, 0.19, [0, 0.575, -0.012], 'head', 'hair');
  // carried loads
  box(B, 0.2, 0.08, 0.06, [0, 0.33, -0.1], 'torso', 'darkwood', { slot: 'back', opt: 1 });
  box(B, 0.11, 0.12, 0.09, [0, 0.33, -0.11], 'torso', 'stone', { slot: 'back', opt: 2 });
  box(B, 0.11, 0.09, 0.1, [0, 0.32, -0.11], 'torso', 'straw', { slot: 'back', opt: 3 });
  box(B, 0.08, 0.09, 0.07, [0, 0.31, -0.1], 'torso', 'gold', { slot: 'back', opt: 4 });
}

// Generic four-legged body: ellipsoid body, box head, four box legs (+ tail).
function quad(spec) {
  return (B) => {
    const m = B.model;
    const bones = m.bones;
    const pv = (n) => bones.find((b) => b.name === n).pivot;
    const [bx, by, bz, hx, hy, hz] = spec.body;
    B.add(P.sphere(1, 6, 4), { pos: [bx, by, bz], scl: [hx, hy, hz], bone: 'body', mat: spec.bodyMat });
    const [cx, cy, cz, chx, chy, chz] = spec.head;
    box(B, chx * 2, chy * 2, chz * 2, [cx, cy, cz], 'head', spec.headMat || spec.bodyMat);
    if (spec.legs !== false) {
      const t = spec.leg;
      for (const [bone, s] of [['legFL', 1], ['legFR', -1], ['legBL', 1], ['legBR', -1]]) {
        const p = pv(bone);
        box(B, t, p[1], t, [p[0], p[1] / 2, p[2]], bone, spec.legMat || spec.bodyMat);
      }
    }
    if (spec.tail) {
      const [tx, ty, tz, thx, thy, thz] = spec.tail;
      box(B, thx * 2, thy * 2, thz * 2, [tx, ty, tz], 'tail', spec.tailMat || spec.bodyMat);
    }
    if (spec.ears) {
      for (const s of [1, -1]) box(B, 0.016, spec.ears[1], 0.012, [spec.ears[0] * s, spec.ears[2], spec.ears[3]], s > 0 ? 'earL' : 'earR', spec.bodyMat);
    }
  };
}

function chicken(B) {
  B.add(P.sphere(1, 6, 4), { pos: [0, 0.125, 0], scl: [0.058, 0.06, 0.08], bone: 'body', mat: 'feather' });
  box(B, 0.05, 0.06, 0.05, [0, 0.2, 0.065], 'head', 'feather');
  box(B, 0.02, 0.025, 0.03, [0, 0.235, 0.06], 'head', 'comb');
  box(B, 0.02, 0.012, 0.03, [0, 0.195, 0.1], 'head', 'beak');
  for (const s of [1, -1]) box(B, 0.012, 0.085, 0.012, [0.022 * s, 0.042, 0], s > 0 ? 'legL' : 'legR', 'leg');
}

// Mid-distance human (~400 triangles): smooth silhouette without the hidden
// variant geometry of the full model. Hats show as a coloured cap (head-top
// colour from the renderer), carried loads stay readable.
function humanMid(B) {
  for (const s of [1, -1]) {
    const leg = s > 0 ? 'legL' : 'legR';
    B.add(P.capsule(0.03, 0.13, 1, 5), { pos: [0.044 * s, 0.105, 0.004], bone: leg, mat: 'pants' });
    B.add(P.sphere(1, 5, 3), { pos: [0.045 * s, 0.026, 0.014], scl: [0.03, 0.026, 0.042], bone: leg, mat: 'boot' });
    const arm = s > 0 ? 'armL' : 'armR';
    B.add(P.capsule(0.026, 0.12, 1, 5), { pos: [0.106 * s, 0.295, 0.002], bone: arm, mat: 'cloth' });
    B.add(P.sphere(0.024, 5, 3), { pos: [0.111 * s, 0.205, 0.004], bone: arm, mat: 'skin' });
  }
  B.add(P.lathe([[0.0, 0.15], [0.086, 0.15], [0.07, 0.24], [0.079, 0.34], [0.055, 0.392], [0.0, 0.41]], 7), { scl: [1, 1, 0.82], bone: 'torso', mat: 'cloth' });
  B.add(P.torus(0.071, 0.013, 3, 8), { pos: [0, 0.245, 0], rot: [Math.PI / 2, 0, 0], scl: [1, 0.82, 1], bone: 'torso', mat: 'sash' });
  B.add(P.sphere(0.1, 8, 6), { pos: [0, 0.5, 0], scl: [1, 0.95, 0.94], bone: 'head', mat: 'skin' });
  B.add(P.dome(0.108, 8, 3, 0.52), { pos: [0, 0.5, 0], rot: [-0.45, 0, 0], scl: [1.02, 1, 1.01], bone: 'head', mat: 'hair' });
  for (const s of [1, -1]) B.add(P.box(0.018, 0.026, 0.01), { pos: [0.036 * s, 0.508, 0.09], bone: 'head', mat: 'eye' });
  box(B, 0.2, 0.08, 0.06, [0, 0.33, -0.1], 'torso', 'darkwood', { slot: 'back', opt: 1 });
  box(B, 0.11, 0.12, 0.09, [0, 0.33, -0.11], 'torso', 'stone', { slot: 'back', opt: 2 });
  box(B, 0.11, 0.09, 0.1, [0, 0.32, -0.11], 'torso', 'straw', { slot: 'back', opt: 3 });
  box(B, 0.08, 0.09, 0.07, [0, 0.31, -0.1], 'torso', 'gold', { slot: 'back', opt: 4 });
  B.add(P.box(0.035, 0.42, 0.015), { pos: [0, 0.31, -0.1], rot: [0, 0, 0.55], bone: 'torso', mat: 'metal', slot: 'back', opt: 5 });
  // kingdom tabard (cape slot 2) and royal cape (1)
  for (const s of [1, -1]) box(B, 0.11, 0.2, 0.01, [0, 0.27, 0.084 * s], 'torso', 'sash', { slot: 'cape', opt: 2 });
  B.add(P.lathe([[0.122, 0.336], [0.088, 0.383], [0.05, 0.398]], 7), { scl: [1, 1, 0.86], bone: 'torso', mat: 'sash', slot: 'cape', opt: 2 });
  box(B, 0.18, 0.28, 0.01, [0, 0.25, -0.09], 'torso', 'cloth', { slot: 'cape', opt: 1 });
  // held tools / weapons, chunky enough to read (tool frame: handle along +Z)
  const H = [-0.111, 0.205, 0.004];
  const tool = (opt, tilt, parts) => {
    for (const [w, h, d, z, y, mat] of parts) B.add(P.box(w, h, d), { pos: [H[0], H[1] + Math.sin(-tilt) * z + Math.cos(tilt) * y, H[2] + Math.cos(tilt) * z + Math.sin(tilt) * y], rot: [tilt, 0, 0], bone: 'tool', slot: 'tool', opt, mat });
  };
  tool(1, -0.3, [[0.016, 0.016, 0.42, 0.14, 0, 'wood'], [0.016, 0.085, 0.06, 0.33, -0.03, 'metal']]); // axe
  tool(2, -0.7, [[0.015, 0.015, 0.6, 0.18, 0, 'wood'], [0.07, 0.06, 0.012, 0.47, -0.03, 'metal']]); // hoe
  tool(3, -0.35, [[0.016, 0.016, 0.4, 0.14, 0, 'wood'], [0.016, 0.15, 0.02, 0.34, 0, 'metal']]); // pickaxe
  tool(4, -0.4, [[0.016, 0.016, 0.3, 0.1, 0, 'wood'], [0.05, 0.1, 0.05, 0.26, 0, 'metal']]); // hammer / mace
  tool(5, -1.3, [[0.014, 0.014, 0.9, 0.12, 0, 'wood'], [0.03, 0.02, 0.09, 0.62, 0, 'metal']]); // spear
  tool(6, -0.85, [[0.01, 0.01, 0.78, 0.33, 0, 'wood']]); // rod
  tool(7, -1.05, [[0.014, 0.014, 0.3, 0.1, 0, 'gold'], [0.04, 0.04, 0.04, 0.28, 0, 'gem']]); // scepter
  tool(8, -0.55, [[0.014, 0.034, 0.34, 0.2, 0, 'metal'], [0.1, 0.018, 0.018, 0.03, 0, 'gold'], [0.016, 0.016, 0.08, -0.03, 0, 'leather']]); // sword
  tool(9, 0, [[0.012, 0.46, 0.02, 0.06, 0, 'wood']]); // bow
  // shield on the left arm (offhand slot)
  box(B, 0.016, 0.2, 0.2, [0.145, 0.27, 0.02], 'armL', 'cloth', { slot: 'offhand', opt: 1 });
  box(B, 0.02, 0.06, 0.06, [0.155, 0.27, 0.02], 'armL', 'metal', { slot: 'offhand', opt: 1 });
}

export const MID = { human: humanMid };

export const TINY = {
  human,
  sheep: quad({ body: [0, 0.25, 0, 0.13, 0.11, 0.18], bodyMat: 'wool', head: [0, 0.3, 0.21, 0.045, 0.05, 0.06], headMat: 'face', leg: 0.034, legMat: 'face' }),
  cow: quad({ body: [0, 0.34, 0, 0.13, 0.13, 0.25], bodyMat: 'hide', head: [0, 0.41, 0.34, 0.065, 0.065, 0.09], leg: 0.055, tail: [0, 0.34, -0.27, 0.01, 0.08, 0.01] }),
  pig: quad({ body: [0, 0.18, 0, 0.105, 0.1, 0.17], bodyMat: 'skin', head: [0, 0.2, 0.18, 0.07, 0.07, 0.07], leg: 0.042 }),
  deer: quad({ body: [0, 0.34, 0, 0.084, 0.098, 0.185], bodyMat: 'coat', head: [0, 0.53, 0.22, 0.045, 0.05, 0.07], leg: 0.03, ears: [0.06, 0.02, 0.585, 0.205] }),
  rabbit: quad({ body: [0, 0.085, -0.01, 0.055, 0.056, 0.075], bodyMat: 'fur', head: [0, 0.13, 0.07, 0.038, 0.037, 0.04], legs: false, ears: [0.02, 0.1, 0.21, 0.06], tail: [0, 0.095, -0.088, 0.02, 0.02, 0.02], tailMat: 'tail' }),
  wolf: quad({ body: [0, 0.255, 0, 0.072, 0.082, 0.2], bodyMat: 'fur', head: [0, 0.32, 0.26, 0.05, 0.05, 0.08], leg: 0.034, tail: [0, 0.23, -0.3, 0.03, 0.03, 0.09] }),
  bear: quad({ body: [0, 0.34, 0, 0.145, 0.15, 0.26], bodyMat: 'fur', head: [0, 0.4, 0.32, 0.08, 0.075, 0.09], headMat: 'fur', leg: 0.085 }),
  fox: quad({ body: [0, 0.172, 0, 0.052, 0.056, 0.14], bodyMat: 'fur', head: [0, 0.215, 0.18, 0.045, 0.04, 0.06], leg: 0.024, legMat: 'leg', tail: [0, 0.15, -0.24, 0.036, 0.036, 0.1], ears: [0.03, 0.05, 0.27, 0.155] }),
  chicken,
};
