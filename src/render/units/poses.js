// Procedural animation. Each pose function fills P (16 pose channels, see the
// model files for layouts) and writes root offsets into rs:
//   rs.rootY (world units, unscaled), rs.rootPitch, rs.rootRoll, rs.rootYaw, rs.fade
// c = { now, animDt, idleDt, speed (units/s), run (bool), scale, child (0..1), seed }
const TAU = Math.PI * 2;
const sin = Math.sin,
  cos = Math.cos;

function smooth(t) {
  return t * t * (3 - 2 * t);
}
// Looping keyframe track. keys: [[t, v], ...] with t ascending in [0, 1].
export function track(p, keys) {
  if (p <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (p <= keys[i][0]) {
      const a = keys[i - 1],
        b = keys[i];
      return a[1] + (b[1] - a[1]) * smooth((p - a[0]) / Math.max(1e-6, b[0] - a[0]));
    }
  }
  return keys[keys.length - 1][1];
}
function frac(x) {
  return x - Math.floor(x);
}

// Idle head motion: occasional glances in random directions.
export function updateLook(rs, c, range = 0.9) {
  rs.lookT -= c.idleDt;
  if (rs.lookT <= 0) {
    const r = Math.random();
    rs.lookTY = r < 0.35 ? 0 : (Math.random() * 2 - 1) * range;
    rs.lookTP = (Math.random() - 0.4) * 0.35;
    rs.lookT = 1.2 + Math.random() * 3.5;
  }
  const k = 1 - Math.exp(-c.idleDt * 5);
  rs.lookY += (rs.lookTY - rs.lookY) * k;
  rs.lookP += (rs.lookTP - rs.lookP) * k;
}

function walkPhase(rs, c, cycle) {
  rs.phase += (c.animDt * c.speed * TAU) / Math.max(0.05, cycle * c.scale);
  return rs.phase;
}

// ---------------------------------------------------------------------------
// Humanoids (humans and the stone golem share the rig layout)
const SWING = [[0, -0.6], [0.32, -2.6], [0.52, -0.55], [1, -0.6]];
const SWING_T = [[0, 0], [0.32, 0.38], [0.52, -0.3], [1, 0]];
const SWING_L = [[0, 0.05], [0.32, -0.1], [0.52, 0.3], [1, 0.1]];
const THRUST = [[0, -0.6], [0.3, -0.15], [0.48, -1.55], [1, -0.6]];
const THRUST_T = [[0, 0], [0.3, 0.32], [0.48, -0.28], [1, 0]];
const PUNCH = [[0, -0.5], [0.28, -0.25], [0.45, -1.6], [1, -0.5]];
const CHOP = [[0, -0.6], [0.48, -2.75], [0.6, -0.85], [0.72, -0.95], [1, -0.6]];
const CHOP_LEAN = [[0, 0.05], [0.48, -0.14], [0.6, 0.38], [0.75, 0.3], [1, 0.05]];
const CHOP_TW = [[0, 0.25], [0.48, 0.42], [0.6, -0.12], [1, 0.25]];
const DIG = [[0, -0.6], [0.45, -2.95], [0.58, -0.45], [0.7, -0.5], [1, -0.6]];
const DIG_LEAN = [[0, 0.15], [0.45, -0.05], [0.58, 0.6], [0.75, 0.5], [1, 0.15]];
const HAMMER = [[0, -1.35], [0.5, -2.0], [0.72, -0.7], [0.8, -0.78], [1, -1.35]];
const FLICK = [[0, 0], [0.5, -0.45], [0.72, 0.35], [1, 0]];
const HOE = [[0, -0.85], [0.45, -2.2], [0.6, -0.6], [1, -0.85]];
const HOE_LEAN = [[0, 0.25], [0.45, 0.08], [0.6, 0.5], [1, 0.25]];

export function poseHumanoid(u, rs, c, P, model) {
  const now = c.now;
  const heavy = model.id === 'golem';
  const sd = c.seed * 10;
  P.fill(0);
  rs.rootY = 0;
  rs.rootPitch = 0;
  rs.rootRoll = 0;
  rs.rootYaw = 0;
  rs.k = 16;
  P[11] = sin(now * (heavy ? 1.1 : 2.1) + sd) * (heavy ? 0.006 : 0.013);
  P[12] = c.child * 0.3;
  updateLook(rs, c, heavy ? 0.5 : 0.9);
  const tool = rs.tool || 0;
  const shield = rs.shield;
  const st = u.state;
  const sinceAtk = now - (u.lastAttack ?? -99);

  if (u.sleeping || st === 'sleep') {
    if (heavy) {
      // dormant: crouched into a boulder
      rs.rootY = -0.42;
      P[0] = 0.75;
      P[3] = 0.55;
      P[5] = -0.5;
      P[7] = -0.5;
      P[6] = 0.35;
      P[8] = -0.35;
      P[9] = -1.2;
      P[10] = -1.2;
      return;
    }
    // curled on one side
    const side = rs.side;
    rs.rootRoll = side * (Math.PI / 2);
    rs.rootY = 0.095;
    P[9] = -0.95;
    P[10] = -0.75;
    P[5] = -1.05;
    P[7] = -1.0;
    P[3] = 0.45;
    P[11] = sin(now * 1.2 + sd) * 0.02;
    return;
  }
  if (u.swimming) {
    const ph = (rs.phase += c.animDt * 3.2);
    P[0] = 0.32;
    P[3] = -0.42;
    P[5] = -1.45 + 0.5 * cos(ph);
    P[6] = 0.55 + 0.45 * sin(ph);
    P[7] = -1.45 + 0.5 * cos(ph);
    P[8] = -(0.55 + 0.45 * sin(ph));
    P[9] = 0.4 * sin(ph * 2);
    P[10] = -0.4 * sin(ph * 2);
    P[4] = rs.lookY * 0.4;
    rs.k = 12;
    return;
  }
  const fighting = st === 'attack' || sinceAtk < 0.55;
  if (fighting) {
    rs.k = 34;
    // guard stance
    P[0] = 0.14;
    P[9] = -0.28;
    P[10] = 0.24;
    P[5] = shield ? -0.75 : -0.45;
    P[6] = shield ? 0.12 : 0.15;
    P[7] = -0.6;
    P[8] = -0.12;
    rs.rootY = Math.abs(sin(now * 5 + sd)) * 0.008;
    if (sinceAtk < 0.55) {
      const p = sinceAtk / 0.55;
      if (tool === 5) {
        P[7] = track(p, THRUST);
        P[1] = track(p, THRUST_T);
        P[0] = 0.14 + 0.15 * sin(p * Math.PI);
      } else if (tool === 9) {
        P[5] = -1.5;
        P[6] = 0;
        P[7] = track(p, [[0, -1.5], [0.4, -1.35], [0.55, -1.5], [1, -1.5]]);
        P[8] = track(p, [[0, -0.1], [0.4, -0.75], [0.5, -0.1], [1, -0.1]]);
        P[1] = 0.6;
      } else if (tool === 0 && !heavy) {
        P[7] = track(p, PUNCH);
        P[1] = track(p, THRUST_T);
      } else {
        P[7] = track(p, SWING);
        P[1] = track(p, SWING_T);
        P[0] = track(p, SWING_L) + 0.14;
        P[14] = track(p, FLICK) * 0.6;
        if (heavy) {
          // golem slams with both fists
          P[5] = P[7];
          P[6] = -0.25;
          P[8] = 0.25;
        }
      }
    }
    P[3] = -0.08;
    return;
  }
  if (st === 'work') {
    rs.k = 28;
    const anim = u.data?.workAnim || 'hammer';
    P[9] = -0.18;
    P[10] = 0.18;
    if (anim === 'chop' || anim === 'dig') {
      const T = anim === 'chop' ? 1.2 : 1.05;
      const p = frac(now / T + c.seed);
      const arm = track(p, anim === 'chop' ? CHOP : DIG);
      P[7] = arm;
      P[5] = arm + 0.15;
      P[6] = -0.42;
      P[8] = 0.18;
      P[0] = track(p, anim === 'chop' ? CHOP_LEAN : DIG_LEAN);
      P[1] = anim === 'chop' ? track(p, CHOP_TW) : 0;
      P[3] = 0.15;
      P[14] = track(p, FLICK) * 0.4;
    } else if (anim === 'harvest' && (tool === 2 || tool === 1)) {
      const p = frac(now / 1.3 + c.seed);
      const arm = track(p, HOE);
      P[7] = arm;
      P[5] = arm + 0.2;
      P[6] = -0.4;
      P[8] = 0.15;
      P[0] = track(p, HOE_LEAN);
      P[3] = 0.25;
    } else if (anim === 'harvest') {
      const p = (now / 1.6 + c.seed) * TAU;
      P[0] = 0.72;
      P[3] = 0.32;
      P[5] = -1.15 + 0.38 * sin(p);
      P[7] = -1.15 + 0.38 * sin(p + Math.PI);
      P[6] = -0.1;
      P[8] = 0.1;
      P[9] = -0.32;
      P[10] = 0.12;
    } else if (anim === 'fish') {
      const cast = frac(now / 9 + c.seed);
      P[7] = cast > 0.9 ? track((cast - 0.9) * 10, [[0, -0.95], [0.4, -2.3], [0.7, -0.7], [1, -0.95]]) : -0.95 + 0.04 * sin(now * 1.3);
      P[5] = -0.75;
      P[6] = -0.3;
      P[8] = 0.1;
      P[0] = 0.04;
      P[3] = 0.15;
    } else {
      const p = frac(now / 0.58 + c.seed);
      P[7] = track(p, HAMMER);
      P[14] = track(p, FLICK);
      P[5] = -0.9;
      P[6] = -0.25;
      P[0] = 0.28;
      P[3] = 0.38;
    }
    return;
  }
  const moving = c.speed > 0.06;
  if (moving) {
    const run = c.run;
    const cycle = heavy ? 1.5 : run ? 0.72 : 0.5;
    const ph = walkPhase(rs, c, cycle);
    const s = sin(ph);
    const legA = heavy ? 0.42 : run ? 0.95 : 0.55;
    const armA = heavy ? 0.5 : run ? 1.0 : 0.5;
    P[9] = -s * legA;
    P[10] = s * legA;
    P[5] = s * armA;
    P[6] = run ? 0.18 : 0.07;
    P[7] = tool && !run ? -0.28 - s * armA * 0.35 : -s * armA;
    P[8] = run ? -0.18 : -0.07;
    P[0] = heavy ? 0.12 : run ? 0.3 : 0.06;
    P[1] = s * (run ? 0.14 : 0.09);
    P[3] = run ? -0.18 : -0.03;
    P[4] = -s * 0.06 + rs.lookY * 0.25;
    rs.rootY = Math.abs(cos(ph)) * (heavy ? 0.06 : run ? 0.032 : 0.015);
    if (heavy) rs.rootRoll = s * 0.07;
    if (st === 'flee') {
      P[5] += 0.4;
      P[6] = 0.5;
      P[8] = -0.5;
      P[3] = -0.25;
    }
    rs.k = run ? 26 : 20;
    return;
  }
  // ---- idle variants
  const act = u.activity;
  P[2] = sin(now * 0.55 + sd) * 0.025;
  P[5] = sin(now * 1.3 + sd) * 0.04;
  P[6] = 0.06;
  P[7] = tool ? -0.22 : -sin(now * 1.3 + sd) * 0.04;
  P[8] = -0.06;
  P[3] = rs.lookP;
  P[4] = rs.lookY * (act === 'look' ? 1.4 : 1);
  if (shield) P[5] = -0.15;
  if (heavy) {
    P[0] = 0.15;
    P[5] = -0.1;
    P[7] = -0.1;
  }
  if (act === 'talk') {
    P[7] = -0.55 + 0.35 * sin(now * 3.1 + sd);
    P[8] = -0.28 - 0.18 * sin(now * 2.3 + sd);
    P[5] = -0.15 + 0.2 * sin(now * 2.7 + sd);
    P[3] = 0.06 * sin(now * 4.2 + sd);
    P[4] *= 0.3;
    P[1] = 0.08 * sin(now * 1.7 + sd);
  } else if (st === 'eat') {
    P[7] = -2.05 + 0.15 * sin(now * 6 + sd);
    P[8] = 0.25;
    P[3] = 0.12;
  } else if (u.combat) {
    P[0] = 0.12;
    P[3] = -0.35;
  }
}

// ---------------------------------------------------------------------------
// Quadrupeds
const GAITS = {
  walk: [0, 0.5, 0.5, 0], // FL FR BL BR (cycle offsets)
  amble: [0, 0.5, 0.25, 0.75],
  gallop: [0, 0.1, 0.55, 0.65],
  bound: [0, 0.05, 0.5, 0.55],
  hop: [0, 0, 0.12, 0.12],
};

export function poseQuad(u, rs, c, P, model) {
  const now = c.now;
  const g = model.gait;
  const sd = c.seed * 10;
  P.fill(0);
  rs.rootY = 0;
  rs.rootPitch = 0;
  rs.rootRoll = 0;
  rs.rootYaw = 0;
  rs.k = 16;
  updateLook(rs, c, 0.7);
  P[2] = sin(now * 2.4 + sd) * 0.012;
  // ear twitches
  rs.earT -= c.idleDt;
  if (rs.earT <= 0) {
    rs.earT = 1 + Math.random() * 4;
    rs.earKick = Math.random() < 0.5 ? 1 : -1;
    rs.earAt = now;
  }
  const tw = Math.max(0, 1 - (now - rs.earAt) * 6);
  P[11] = 0.08 * sin(now * 1.3 + sd) + (rs.earKick > 0 ? tw * 0.5 : 0);
  P[12] = -0.08 * sin(now * 1.3 + sd) - (rs.earKick < 0 ? tw * 0.5 : 0);
  P[6] = sin(now * 1.4 + sd) * 0.18;
  const st = u.state;
  const sinceAtk = now - (u.lastAttack ?? -99);
  const L = model.legLen;

  if (u.sleeping || st === 'sleep') {
    rs.rootY = -L * 0.78;
    P[7] = P[8] = 1.45;
    P[9] = P[10] = -1.45;
    P[3] = 0.4;
    P[4] = 0.5 * (rs.side || 1);
    P[6] = 0.9 * (rs.side || 1);
    P[5] = 0.3;
    P[11] = -0.3;
    P[12] = 0.3;
    P[2] = sin(now * 1.1 + sd) * 0.02;
    rs.rootRoll = 0.12 * (rs.side || 1);
    return;
  }
  if (u.swimming) {
    const ph = (rs.phase += c.animDt * 7);
    P[7] = -0.7 * sin(ph);
    P[8] = 0.7 * sin(ph);
    P[9] = 0.7 * sin(ph);
    P[10] = -0.7 * sin(ph);
    P[3] = -0.45;
    P[0] = -0.12;
    return;
  }
  if (st === 'attack' || sinceAtk < 0.5) {
    rs.k = 32;
    const p = Math.min(1, sinceAtk / 0.5);
    if (model.id === 'bear') {
      // rear up and swipe
      rs.rootPitch = -track(p, [[0, 0.1], [0.3, 0.75], [0.55, 0.0], [1, 0.1]]);
      P[7] = track(p, [[0, 0], [0.3, -1.4], [0.55, -0.4], [1, 0]]);
      P[8] = track(p, [[0, 0], [0.3, -1.1], [0.6, -0.6], [1, 0]]);
      P[13] = track(p, [[0, 0.1], [0.3, 0.5], [0.6, 0.2], [1, 0.1]]);
      P[3] = -0.2;
      return;
    }
    // lunge and bite / headbutt
    P[0] = track(p, [[0, 0.05], [0.25, -0.12], [0.45, 0.22], [1, 0.05]]);
    P[3] = track(p, [[0, 0.1], [0.25, -0.3], [0.45, 0.35], [1, 0.1]]);
    P[13] = track(p, [[0, 0.05], [0.25, 0.55], [0.45, 0.0], [1, 0.05]]);
    P[7] = P[8] = track(p, [[0, 0], [0.25, -0.35], [0.45, 0.3], [1, 0]]);
    P[9] = P[10] = 0.25;
    P[5] = 0.4;
    rs.fwd = track(p, [[0, 0], [0.45, 0.08], [1, 0]]);
    return;
  }
  if (st === 'eat') {
    if (u.activity === 'pounce') {
      const p = frac(u.stateTime / 1.6);
      rs.rootY = Math.max(0, sin(p * Math.PI * 1.2)) * 0.12;
      P[0] = track(p, [[0, -0.2], [0.4, -0.4], [0.8, 0.5], [1, 0.1]]);
      P[3] = track(p, [[0, -0.2], [0.6, 0.2], [0.85, 0.7], [1, 0.4]]);
      P[7] = P[8] = track(p, [[0, 0.2], [0.4, -0.8], [0.85, -0.6], [1, 0]]);
      P[9] = P[10] = track(p, [[0, -0.4], [0.3, 0.9], [0.7, 0.3], [1, 0]]);
      P[5] = 0.5;
      rs.k = 26;
      return;
    }
    if (u.activity === 'fish') {
      const p = frac(now / 2.2 + c.seed);
      P[7] = track(p, [[0, 0], [0.6, 0], [0.75, -1.1], [0.85, 0.2], [1, 0]]);
      P[3] = 0.55;
      P[0] = 0.1;
      return;
    }
    P[3] = g.grazeX + 0.05 * sin(now * 7 + sd);
    P[13] = 0.08 * Math.max(0, sin(now * 9 + sd));
    P[0] = 0.07;
    P[7] = P[8] = -0.06;
    P[5] = model.id === 'cow' ? 0 : 0.1;
    P[6] = sin(now * (model.id === 'cow' ? 1.3 : 2.5) + sd) * 0.35;
    return;
  }
  const moving = c.speed > 0.05;
  if (moving) {
    const run = c.run;
    const type = model.hop ? 'hop' : run ? g.run || 'gallop' : g.amble ? 'amble' : 'walk';
    const cycle = (run ? 1.55 : 1) * g.stride * (model.hop ? 1 : 1);
    const ph = walkPhase(rs, c, cycle);
    const amp = run ? g.runAmp : g.walkAmp;
    const off = GAITS[type];
    for (let i = 0; i < 4; i++) P[7 + i] = -amp * sin(ph + off[i] * TAU);
    if (type === 'hop') {
      const h = sin(ph);
      rs.rootY = Math.max(0, h) * (run ? 0.11 : 0.065);
      P[0] = -0.3 * cos(ph);
      P[7] = P[8] = -0.6 * cos(ph) - 0.2;
      P[9] = P[10] = 0.9 * cos(ph) + 0.2;
      P[11] = P[12] = 0;
      P[3] = 0.2 * cos(ph);
      rs.k = 30;
    } else if (type === 'gallop' || type === 'bound') {
      P[0] = 0.14 * sin(ph + 0.5);
      rs.rootY = Math.abs(sin(ph)) * L * (type === 'bound' ? 0.38 : 0.2);
      P[3] = -0.12 + 0.1 * sin(ph);
      P[5] = g.wag ? 0.35 : 0.2;
      P[6] = 0;
      rs.k = 30;
    } else {
      rs.rootY = Math.abs(sin(ph * 2)) * g.bob;
      P[3] = 0.06 * sin(ph * 2) + (st === 'hunt' ? 0.2 : 0);
      if (type === 'amble') {
        rs.rootRoll = sin(ph) * 0.05;
        P[4] = sin(ph) * 0.08;
      }
      rs.k = 22;
    }
    if (st === 'flee') P[5] = 0.5;
    return;
  }
  // idle
  P[3] = rs.lookP * 0.8;
  P[4] = rs.lookY * 0.7;
  if (g.wag && !u.combat && Math.sin(now * 0.2 + sd) > 0.6) P[6] = sin(now * 11 + sd) * 0.45;
  // canines sit after standing still a while
  if ((model.id === 'wolf' || model.id === 'fox') && u.stateTime > 5 && st === 'idle') {
    P[0] = -0.45;
    P[9] = P[10] = -1.25;
    P[7] = P[8] = 0.42;
    P[3] = -0.3 + rs.lookP;
    rs.rootY = -L * 0.32;
    P[5] = -0.5;
  }
  if (model.hop) {
    P[11] = P[12] = 0;
    P[0] = -0.08;
    P[3] = -0.1 + rs.lookP;
  }
}

// ---------------------------------------------------------------------------
// Chicken
export function poseChicken(u, rs, c, P, model) {
  const now = c.now;
  const sd = c.seed * 10;
  P.fill(0);
  rs.rootY = 0;
  rs.rootPitch = 0;
  rs.rootRoll = 0;
  rs.rootYaw = 0;
  rs.k = 24;
  // jerky head glances
  rs.lookT -= c.idleDt;
  if (rs.lookT <= 0) {
    rs.lookT = 0.3 + Math.random() * 1.2;
    rs.lookTY = (Math.random() * 2 - 1) * 0.9;
  }
  rs.lookY += (rs.lookTY - rs.lookY) * Math.min(1, c.idleDt * 25);
  P[4] = rs.lookY;
  P[2] = sin(now * 3 + sd) * 0.015;
  const st = u.state;
  if (u.sleeping || st === 'sleep') {
    rs.rootY = -0.07;
    P[3] = 0.5;
    P[4] = 1.4;
    P[0] = 0.1;
    return;
  }
  if (st === 'eat') {
    const peck = Math.max(0, sin(now * 9 + sd));
    P[0] = 0.45 + peck * 0.2;
    P[3] = 0.55 + peck * 0.5;
    P[5] = -0.2;
    return;
  }
  const moving = c.speed > 0.04;
  if (moving) {
    const ph = walkPhase(rs, c, c.run ? 0.2 : 0.13);
    P[7] = -sin(ph) * (c.run ? 0.9 : 0.6);
    P[8] = sin(ph) * (c.run ? 0.9 : 0.6);
    P[1] = sin(ph) * 0.08;
    P[3] = 0.25 * sin(ph * 2);
    P[4] *= 0.3;
    rs.rootY = Math.abs(cos(ph)) * 0.01;
    if (c.run || st === 'flee') {
      P[9] = 0.6 + 0.5 * sin(now * 28);
      P[10] = -P[9];
      P[0] = 0.15;
    }
    return;
  }
  // idle: occasional wing ruffle
  if (sin(now * 0.4 + sd) > 0.95) {
    P[9] = 0.5 + 0.3 * sin(now * 30);
    P[10] = -P[9];
  }
}

// ---------------------------------------------------------------------------
// Birds (ambient gulls / songbirds). Channels: 0 bodyX 1 bodyZ 3 headX 4 headY
// 5 wingL 6 wingR 7 tail 8 tipL 9 tipR
export function poseFlyer(b, P, now, flap, climb) {
  P.fill(0);
  const ph = b.phase;
  if (b.landed) {
    P[5] = -1.25;
    P[6] = 1.25;
    P[8] = -0.3;
    P[9] = 0.3;
    P[3] = b.peck ? 0.7 * Math.max(0, sin(now * 8 + b.seed * 9)) : 0;
    P[4] = sin(now * 1.7 + b.seed * 7) * 0.6;
    P[0] = -0.15;
    return;
  }
  if (flap > 0.5) {
    const s = sin(ph);
    P[5] = 0.15 + 0.85 * s;
    P[6] = -P[5];
    P[8] = 0.45 * sin(ph - 0.9);
    P[9] = -P[8];
  } else {
    P[5] = 0.12 + 0.05 * sin(now * 2 + b.seed);
    P[6] = -P[5];
    P[8] = -0.1;
    P[9] = 0.1;
  }
  P[0] = -climb * 0.5;
  P[7] = -climb * 0.3;
}

// Fish: spine bone channels 0 phase 1 lateral amplitude
export function poseFish(f, P) {
  P.fill(0);
  P[0] = f.phase;
  P[1] = 0.035 + Math.min(0.05, f.speed * 0.03);
}

// ---------------------------------------------------------------------------
// Tidewyrm. 0 phase 1 ampX 2 ampY 3 lift 4 headX 5 headY 6 jaw 7 finL 8 finR
export function poseSerpent(u, rs, c, P) {
  const now = c.now;
  P.fill(0);
  rs.rootY = 0;
  rs.rootPitch = 0;
  rs.rootRoll = 0;
  rs.rootYaw = 0;
  rs.k = 10;
  const surf = u.data?.surface ?? 1;
  rs.phase += c.animDt * (1.6 + c.speed * 1.6);
  P[0] = rs.phase;
  P[1] = 0.22;
  P[2] = 0.32 * surf + 0.05;
  P[3] = 0.55 * surf + 0.1 * sin(now * 0.9);
  updateLook(rs, c, 0.6);
  P[5] = rs.lookY * 0.6;
  P[4] = 0.1 * sin(now * 0.7);
  P[7] = 0.35 + 0.2 * sin(now * 2.1);
  P[8] = -P[7];
  const sinceAtk = now - (u.lastAttack ?? -99);
  if (sinceAtk < 0.9) {
    const p = sinceAtk / 0.9;
    rs.k = 20;
    P[3] += track(p, [[0, 0], [0.3, 0.6], [0.5, 0.2], [1, 0]]);
    P[4] = track(p, [[0, 0], [0.3, -0.5], [0.5, 0.65], [1, 0]]);
    P[6] = track(p, [[0, 0.1], [0.3, 0.75], [0.5, 0.05], [1, 0.1]]);
    P[7] = 0.9;
    P[8] = -0.9;
  } else if (u.combat) {
    P[6] = 0.25 + 0.1 * sin(now * 3);
    P[3] += 0.25;
  }
  rs.rootY = -0.12 - (1 - surf) * 0.9;
}

// Skywyrm. 0 phase 1 ampX 2 ampY 3 lift 4 headX 5 headY 6 jaw 7 wingL1 8 wingR1
// 9 wingL2 10 wingR2 11 tipL 12 tipR
export function poseWyrm(u, rs, c, P) {
  const now = c.now;
  P.fill(0);
  rs.rootY = 0;
  rs.rootPitch = 0;
  rs.rootRoll = 0;
  rs.rootYaw = 0;
  rs.k = 10;
  const breathing = (u.data?.breath ?? 0) > c.simNow;
  if (u.sleeping || u.state === 'sleep' || (u.alt < 0.4 && !u.moving)) {
    rs.phase += c.idleDt * 0.4;
    P[0] = 1.2;
    P[1] = 0.3;
    P[2] = 0.02;
    P[3] = -0.05;
    P[4] = 0.35;
    P[7] = -1.1;
    P[8] = 1.1;
    P[9] = -1.0;
    P[10] = 1.0;
    P[11] = 0.6;
    P[12] = -0.6;
    rs.rootY = 0.16;
    return;
  }
  rs.phase += c.animDt * (2.2 + c.speed * 0.6);
  P[0] = rs.phase;
  P[1] = 0.07;
  P[2] = 0.12;
  P[3] = 0.06;
  // flap, with occasional long glides
  const glide = sin(now * 0.31 + c.seed * 20) > 0.55 && !breathing;
  rs.wingPh = (rs.wingPh || 0) + c.animDt * (glide ? 0 : 4.6);
  const w = rs.wingPh;
  const a1 = glide ? 0.22 + 0.04 * sin(now * 2) : 0.18 + 0.78 * sin(w);
  const a2 = glide ? 0.16 : 0.12 + 0.6 * sin(w - 0.9);
  P[7] = a1;
  P[8] = -a1;
  P[9] = a2;
  P[10] = -a2;
  P[11] = glide ? -0.05 : 0.45 * sin(w - 0.8);
  P[12] = -P[11];
  updateLook(rs, c, 0.5);
  P[5] = rs.lookY * 0.5;
  P[4] = 0.05;
  if (breathing) {
    P[6] = 0.6 + 0.08 * sin(now * 20);
    P[4] = 0.42;
    P[5] = 0;
  }
  rs.rootY = glide ? 0 : -sin(w) * 0.06;
}
